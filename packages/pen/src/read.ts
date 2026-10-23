import * as v from 'valibot'

import {
  SceneGraph,
  type AxisSizingMode,
  type LayoutMode,
  type LayoutSizing,
  type NodeType,
  type SceneNode
} from '@open-pencil/scene-graph'
import { copyEffects, copyFills, copyStrokes } from '@open-pencil/scene-graph/copy'
import { populateInstanceChildren } from '@open-pencil/scene-graph/instances'
import { fillSizingFields } from '@open-pencil/scene-graph/layout'

import { convertEffects } from './effects'
import { ellipseArc, pathNetwork } from './geometry'
import {
  applyCornerRadius,
  applyPadding,
  mapAlignItems,
  mapJustifyContent,
  mapLayoutMode,
  parseSize,
  spreadAround
} from './layout'
import { applyStroke, convertPaints, strokeFields } from './paints'
import { isPlain, placeLayers, type PenPlacement } from './placement'
import { penFileSchema, type PenNode, type PenOverride } from './schema'
import { applyTextProps } from './text'
import {
  bindIfVar,
  buildVarContext,
  resolveBoolean,
  resolveNumber,
  type VarContext
} from './variables'

/** Options for reading a document. */
export interface PenReadOptions {
  /**
   * Lays out the graph's auto layout and text, as `layoutAuthoredNodes` in Core does. Turned and
   * mirrored layers are placed after it, since where they land depends on their final size.
   */
  layout?(graph: SceneGraph): void
}

/** What reading one document builds up. */
interface Build {
  graph: SceneGraph
  ctx: VarContext
  componentIds: Map<string, string>
  penSources: Map<string, PenNode>
  /** pen.dev's placement of each turned or mirrored layer, and of every group. */
  placements: Map<string, PenPlacement>
  /** Groups in reading order. */
  groupIds: string[]
  /** Frames spreading their children with `space_around`. */
  aroundIds: string[]
}

function penPlacement(pen: PenOverride, ctx: VarContext, base?: PenPlacement): PenPlacement {
  return {
    x: pen.x ?? base?.x ?? 0,
    y: pen.y ?? base?.y ?? 0,
    rotation: pen.rotation === undefined ? (base?.rotation ?? 0) : resolveNumber(pen.rotation, ctx),
    flipX: pen.flipX === undefined ? (base?.flipX ?? false) : resolveBoolean(pen.flipX, ctx),
    flipY: pen.flipY === undefined ? (base?.flipY ?? false) : resolveBoolean(pen.flipY, ctx)
  }
}

/** A layer's own fields; it is built upright and placed once laid out. */
function buildBaseOverrides(pen: PenNode, ctx: VarContext): Partial<SceneNode> {
  return {
    id: pen.id,
    name: pen.name ?? (pen.type === 'icon_font' ? (pen.iconFontName ?? 'Icon') : pen.type),
    x: pen.x ?? 0,
    y: pen.y ?? 0,
    visible: resolveBoolean(pen.enabled, ctx),
    opacity: resolveNumber(pen.opacity, ctx, 1),
    clipsContent: resolveBoolean(pen.clip, ctx, false),
    boundVariables: {}
  }
}

function applyAutoLayout(
  overrides: Partial<SceneNode>,
  layoutMode: LayoutMode,
  pen: PenNode,
  widthSizing: LayoutSizing,
  heightSizing: LayoutSizing,
  ctx: VarContext
): void {
  overrides.layoutMode = layoutMode
  overrides.primaryAxisAlign = mapJustifyContent(pen.justifyContent)
  overrides.counterAxisAlign = mapAlignItems(pen.alignItems)
  overrides.itemSpacing = resolveNumber(pen.gap, ctx)
  overrides.strokesIncludedInLayout = pen.layoutIncludeStroke ?? false

  // Fill is the child's grow or stretch, set with its parent; the frame itself stays fixed.
  const own = (sizing: LayoutSizing): AxisSizingMode => (sizing === 'HUG' ? 'HUG' : 'FIXED')
  if (layoutMode === 'VERTICAL') {
    overrides.primaryAxisSizing = own(heightSizing)
    overrides.counterAxisSizing = own(widthSizing)
  } else {
    overrides.primaryAxisSizing = own(widthSizing)
    overrides.counterAxisSizing = own(heightSizing)
  }
}

function resolveSizing(pen: PenNode, ctx: VarContext) {
  const isTextLike = pen.type === 'text' || pen.type === 'icon_font'
  const defaultSize = isTextLike ? 20 : 100
  const defaultW = isTextLike && pen.width === undefined ? 0 : defaultSize
  const w = parseSize(pen.width, defaultW, ctx)
  const h = parseSize(pen.height, defaultSize, ctx)
  const layout = mapLayoutMode(pen)

  if (pen.width === undefined && layout !== 'NONE') w.sizing = 'HUG'
  if (pen.height === undefined && layout !== 'NONE') h.sizing = 'HUG'

  return { w, h, layout, isTextLike }
}

function inheritLayoutFromComp(node: SceneNode, pen: PenNode, comp: SceneNode): void {
  const wasRow = node.layoutMode === 'HORIZONTAL'
  node.layoutMode = comp.layoutMode
  node.primaryAxisAlign = comp.primaryAxisAlign
  node.counterAxisAlign = comp.counterAxisAlign
  const isRow = node.layoutMode === 'HORIZONTAL'
  if (wasRow !== isRow) {
    const oldP = node.primaryAxisSizing
    node.primaryAxisSizing = node.counterAxisSizing
    node.counterAxisSizing = oldP
  }
  const widthAxis = isRow ? 'primaryAxisSizing' : 'counterAxisSizing'
  const heightAxis = isRow ? 'counterAxisSizing' : 'primaryAxisSizing'
  if (pen.width === undefined) node[widthAxis] = comp[widthAxis]
  if (pen.height === undefined) node[heightAxis] = comp[heightAxis]
  if (pen.gap === undefined) node.itemSpacing = comp.itemSpacing
  if (pen.padding === undefined) {
    node.paddingTop = comp.paddingTop
    node.paddingRight = comp.paddingRight
    node.paddingBottom = comp.paddingBottom
    node.paddingLeft = comp.paddingLeft
  }
  if (pen.clip === undefined) node.clipsContent = comp.clipsContent
}

function applyRefVisuals(
  node: SceneNode,
  pen: PenNode,
  compPen: PenNode | undefined,
  ctx: VarContext
): void {
  if (!compPen) return
  if (pen.fill === undefined) node.fills = convertPaints(compPen.fill, 'fills', ctx, node)
  applyStroke(node, strokeFields(pen, strokeFields(compPen)), ctx)
  if (pen.effect === undefined) node.effects = convertEffects(compPen.effect, ctx)
  if (pen.cornerRadius === undefined) applyCornerRadius(node, compPen.cornerRadius, ctx)
}

function applyRefProps(node: SceneNode, pen: PenNode, build: Build): void {
  const { graph, componentIds, penSources, ctx } = build
  if (!pen.ref) return
  const componentId = componentIds.get(pen.ref) ?? pen.ref
  node.componentId = componentId
  const comp = graph.getNode(componentId)
  if (!comp) return
  if (pen.width === undefined) node.width = comp.width
  if (pen.height === undefined) node.height = comp.height
  if (pen.layout === undefined) inheritLayoutFromComp(node, pen, comp)
  applyRefVisuals(node, pen, penSources.get(pen.ref), ctx)
}

function applyAllRefProps(penNodes: PenNode[], build: Build): void {
  for (const pen of penNodes) {
    if (pen.type === 'ref') {
      const node = build.graph.getNode(pen.id)
      if (node) applyRefProps(node, pen, build)
    }
    if (pen.children) applyAllRefProps(pen.children, build)
  }
}

function applyTheme(theme: Record<string, string>, ctx: VarContext): void {
  const themeName = Object.values(theme)[0]
  if (themeName) ctx.setActiveTheme(themeName)
}

// eslint-disable-next-line complexity -- .pen node mapping touches many format-specific fields
function createSceneNode(pen: PenNode, parentId: string, build: Build): string | null {
  const { graph, ctx } = build
  if (pen.type === 'prompt') return null
  if (pen.theme) applyTheme(pen.theme, ctx)

  const { w, h, layout, isTextLike } = resolveSizing(pen, ctx)
  const overrides = buildBaseOverrides(pen, ctx)
  overrides.width = w.value
  overrides.height = h.value
  const hasChildren = (pen.children?.length ?? 0) > 0
  if (!hasChildren && w.fitContentFallback !== undefined) overrides.minWidth = w.fitContentFallback
  if (!hasChildren && h.fitContentFallback !== undefined) overrides.minHeight = h.fitContentFallback

  const parentLayout = graph.getNode(parentId)?.layoutMode ?? 'NONE'
  // An absolute layer leaves its parent's flow; fill sizing then falls back to its value.
  const absolute = pen.layoutPosition === 'absolute' && parentLayout !== 'NONE'
  if (absolute) overrides.layoutPositioning = 'ABSOLUTE'
  const flowLayout = absolute ? 'NONE' : parentLayout
  if (layout !== 'NONE') {
    const widthSizing =
      flowLayout === 'NONE' && w.sizing === 'FILL' ? ('FIXED' as LayoutSizing) : w.sizing
    const heightSizing =
      flowLayout === 'NONE' && h.sizing === 'FILL' ? ('FIXED' as LayoutSizing) : h.sizing
    applyAutoLayout(overrides, layout, pen, widthSizing, heightSizing, ctx)
  }

  const node = graph.createNode(mapNodeType(pen), parentId, overrides)
  const placement = penPlacement(pen, ctx)
  if (pen.type === 'group') build.groupIds.push(node.id)
  if (layout !== 'NONE' && pen.justifyContent === 'space_around') build.aroundIds.push(node.id)
  bindIfVar(node, 'itemSpacing', pen.gap, ctx)
  if (pen.type === 'group' || !isPlain(placement)) build.placements.set(node.id, placement)

  node.fills = convertPaints(pen.fill, 'fills', ctx, node)
  applyStroke(node, strokeFields(pen), ctx)
  node.effects = convertEffects(pen.effect, ctx)
  applyCornerRadius(node, pen.cornerRadius, ctx)
  applyPadding(node, pen.padding, ctx)

  // Text without a width resizes to its content, which laying out the document measures.
  if (isTextLike) applyTextProps(node, pen, ctx)

  if (pen.type === 'ellipse') node.arcData = ellipseArc(pen, ctx)
  if (pen.type === 'polygon') node.pointCount = Math.max(3, resolveNumber(pen.polygonCount, ctx, 3))
  if (pen.type === 'path') {
    const network = pathNetwork(pen, node.width, node.height)
    if (network) node.vectorNetwork = network
  }

  if (flowLayout !== 'NONE') {
    if (w.sizing === 'FILL') Object.assign(node, fillSizingFields(flowLayout, 'HORIZONTAL'))
    if (h.sizing === 'FILL') Object.assign(node, fillSizingFields(flowLayout, 'VERTICAL'))
  }

  if (pen.reusable) {
    build.componentIds.set(pen.id, node.id)
    build.penSources.set(pen.id, pen)
  }

  if (pen.children) {
    for (const child of pen.children) createSceneNode(child, node.id, build)
  }

  return node.id
}

function collectByNameType(
  graph: SceneGraph,
  parentId: string,
  name: string,
  type: string,
  out: SceneNode[],
  depth: number
): void {
  if (depth > 2) return
  const parent = graph.getNode(parentId)
  if (!parent) return
  for (const childId of parent.childIds) {
    const child = graph.getNode(childId)
    if (!child) continue
    if (child.name === name && child.type === type) out.push(child)
    collectByNameType(graph, childId, name, type, out, depth + 1)
  }
}

function findCloneByComponentId(
  graph: SceneGraph,
  parentId: string,
  origId: string
): SceneNode | undefined {
  const parent = graph.getNode(parentId)
  if (!parent) return undefined
  for (const childId of parent.childIds) {
    const child = graph.getNode(childId)
    if (!child) continue
    if (child.componentId === origId) return child
    const deep = findCloneByComponentId(graph, childId, origId)
    if (deep) return deep
  }
  return undefined
}

function findCloneByNameFallback(
  graph: SceneGraph,
  parentId: string,
  origId: string
): SceneNode | undefined {
  const orig = graph.getNode(origId)
  if (!orig) return undefined
  const matches: SceneNode[] = []
  collectByNameType(graph, parentId, orig.name, orig.type, matches, 0)
  return matches.length === 1 ? matches[0] : undefined
}

function applyOverrideProps(target: SceneNode, overrideData: PenOverride, build: Build): void {
  const { ctx } = build
  if (overrideData.fill !== undefined)
    target.fills = convertPaints(overrideData.fill, 'fills', ctx, target)
  if (overrideData.content !== undefined) target.text = overrideData.content
  if (overrideData.x !== undefined) target.x = overrideData.x
  if (overrideData.y !== undefined) target.y = overrideData.y
  const base = build.placements.get(target.id)
  const placement = penPlacement(overrideData, ctx, base ?? { ...target, rotation: 0 })
  if (base || !isPlain(placement)) build.placements.set(target.id, placement)
  if (overrideData.enabled !== undefined) target.visible = resolveBoolean(overrideData.enabled, ctx)
  if (overrideData.width !== undefined)
    target.width = parseSize(overrideData.width, target.width, ctx).value
  if (overrideData.height !== undefined)
    target.height = parseSize(overrideData.height, target.height, ctx).value
  if (overrideData.name !== undefined) target.name = overrideData.name
}

/** Fills empty instances from their components; a copied layer keeps its source's placement. */
function populateInstances(build: Build): void {
  const { graph, placements } = build
  for (const node of graph.getAllNodes()) {
    if (node.type !== 'INSTANCE' || !node.componentId || node.childIds.length > 0) continue
    if (!graph.getNode(node.componentId)) continue
    populateInstanceChildren(graph, node.id, node.componentId)
    const copies = [...graph.getChildren(node.id)]
    for (const copy of copies) {
      const source = copy.componentId ? placements.get(copy.componentId) : undefined
      if (source && !placements.has(copy.id)) placements.set(copy.id, source)
      copies.push(...graph.getChildren(copy.id))
    }
  }
}

function applyDescendantOverrides(pen: PenNode, build: Build): void {
  const { graph } = build
  if (pen.type !== 'ref' || !pen.descendants) return
  const instanceNode = graph.getNode(pen.id)
  if (!instanceNode) return

  for (const [origId, overrideData] of Object.entries(pen.descendants)) {
    const clone =
      findCloneByComponentId(graph, instanceNode.id, origId) ??
      findCloneByNameFallback(graph, instanceNode.id, origId)

    if (clone) {
      if (overrideData.children) {
        const toDelete = clone.childIds.slice()
        for (const childId of toDelete) graph.deleteNode(childId)
        for (const child of overrideData.children) createSceneNode(child, clone.id, build)
      }
      applyOverrideProps(clone, overrideData, build)
      continue
    }

    if (overrideData.type && overrideData.id) {
      createSceneNode(overrideData as PenNode, instanceNode.id, build)
    }
  }
}

function walkAndApplyOverrides(nodes: PenNode[], build: Build): void {
  for (const pen of nodes) {
    applyDescendantOverrides(pen, build)
    if (pen.children) walkAndApplyOverrides(pen.children, build)
  }
}

function collectComponentIds(nodes: PenNode[], map: Map<string, string>): void {
  for (const node of nodes) {
    if (node.reusable) map.set(node.id, node.id)
    if (node.children) collectComponentIds(node.children, map)
  }
}

function resolveNodeVars(node: SceneNode, graph: SceneGraph, ctx: VarContext): void {
  for (const [key, varId] of Object.entries(node.boundVariables)) {
    const variable = graph.variables.get(varId)
    if (!variable) continue
    const modeVal =
      variable.valuesByMode[ctx.activeModeId] ?? Object.values(variable.valuesByMode)[0]
    const paint = /^(fills|strokes)\/(\d+)\/color$/.exec(key)
    if (!paint || typeof modeVal !== 'object' || !('r' in modeVal)) continue
    const target = node[paint[1] === 'fills' ? 'fills' : 'strokes'].at(Number(paint[2]))
    if (target) target.color = modeVal
  }
  for (const childId of node.childIds) {
    const child = graph.getNode(childId)
    if (child) resolveNodeVars(child, graph, ctx)
  }
}

function resolveThemeVariables(penNodes: PenNode[], graph: SceneGraph, ctx: VarContext): void {
  for (const pen of penNodes) {
    if (pen.theme) applyTheme(pen.theme, ctx)
    const node = graph.getNode(pen.id)
    if (node) resolveNodeVars(node, graph, ctx)
    if (pen.children) resolveThemeVariables(pen.children, graph, ctx)
  }
}

function fixInstanceWidths(graph: SceneGraph): void {
  for (const node of graph.getAllNodes()) {
    if (node.type !== 'INSTANCE' || !node.componentId) continue
    const comp = graph.getNode(node.componentId)
    if (!comp) continue
    if (node.width <= 100 && comp.width > 100) node.width = comp.width
    if (node.height <= 100 && comp.height > 100) node.height = comp.height
    if (comp.layoutGrow > 0) node.layoutGrow = comp.layoutGrow
    if (comp.layoutAlignSelf !== 'AUTO') node.layoutAlignSelf = comp.layoutAlignSelf
    node.fills = copyFills(node.fills)
    node.strokes = copyStrokes(node.strokes)
    node.effects = copyEffects(node.effects)
  }
}

function mapNodeType(pen: PenNode): NodeType {
  if (pen.type === 'frame') return pen.reusable ? 'COMPONENT' : 'FRAME'
  if (pen.type === 'rectangle') return 'RECTANGLE'
  if (pen.type === 'ellipse') return 'ELLIPSE'
  if (pen.type === 'polygon') return 'POLYGON'
  if (pen.type === 'group') return 'GROUP'
  if (pen.type === 'text' || pen.type === 'icon_font') return 'TEXT'
  if (pen.type === 'path') return 'VECTOR'
  if (pen.type === 'ref') return 'INSTANCE'
  return 'FRAME'
}

/** Whether a group sits in an auto layout's flow, where fitting it changes the layout. */
function groupsInFlow(graph: SceneGraph, groupIds: readonly string[]): boolean {
  return groupIds.some((id) => {
    const group = graph.getNode(id)
    const parent = group?.parentId ? graph.getNode(group.parentId) : undefined
    return parent !== undefined && parent.layoutMode !== 'NONE'
  })
}

export function parsePenFile(json: string, options: PenReadOptions = {}): SceneGraph {
  const parsed = v.safeParse(penFileSchema, json)
  if (!parsed.success) {
    throw new Error(`Not a .pen document: ${v.summarize(parsed.issues)}`)
  }
  const doc = parsed.output
  const graph = new SceneGraph()

  for (const page of graph.getPages(true)) {
    graph.deleteNode(page.id)
  }

  const ctx = buildVarContext(graph, doc.variables ?? {}, doc.themes ?? {})
  const build: Build = {
    graph,
    ctx,
    componentIds: new Map(),
    penSources: new Map(),
    placements: new Map(),
    groupIds: [],
    aroundIds: []
  }

  collectComponentIds(doc.children, build.componentIds)

  const page = graph.addPage(doc.children[0]?.name ?? 'Page 1')
  for (const child of doc.children) createSceneNode(child, page.id, build)

  applyAllRefProps(doc.children, build)
  populateInstances(build)
  walkAndApplyOverrides(doc.children, build)
  populateInstances(build)
  resolveThemeVariables(doc.children, graph, ctx)
  fixInstanceWidths(graph)

  options.layout?.(graph)
  const spread = options.layout ? spreadAround(graph, build.aroundIds) : false
  placeLayers(graph, build.placements, build.groupIds)
  if (spread || groupsInFlow(graph, build.groupIds)) options.layout?.(graph)

  if (graph.getPages(true).length === 0) {
    graph.addPage('Page 1')
  }

  return graph
}

export async function readPenFile(file: File, options?: PenReadOptions): Promise<SceneGraph> {
  return parsePenFile(await file.text(), options)
}

import { fromUint8Array } from 'js-base64'

import type {
  DrawIOCell,
  DrawIOFile,
  DrawIOGeometry,
  DrawIOPage,
  DrawIOPoint,
  DrawIOStyle
} from '@open-pencil/drawio'
import type { ConnectorEndpoint, SceneGraph, SceneNode, StrokeCap } from '@open-pencil/scene-graph'
import { colorToHex } from '@open-pencil/scene-graph/color'
import {
  connectorRoute,
  connectorRouteEnds,
  connectorSublayers,
  curveMidpoint
} from '@open-pencil/scene-graph/connectors'
import { getParentWorldMatrix } from '@open-pencil/scene-graph/coordinate'
import {
  isGeneratedFrame,
  shapeWithTextLabel,
  stickySublayers
} from '@open-pencil/scene-graph/generated'
import Matrix, { type Mat3 } from '@open-pencil/scene-graph/matrix'
import type { Vector } from '@open-pencil/scene-graph/primitives'

import { renderNodesToSVG } from '#core/io/formats/svg'

import { DEFAULT_FONT_FAMILY } from './paint'
import { drawioShapeValues } from './shapes'

/** draw.io's id for its root cell and for its one layer, as it numbers new files. */
const ROOT_ID = '0'
const LAYER_ID = '1'

const EMPTY_GEOMETRY: DrawIOGeometry = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  relative: false,
  points: [],
  sourcePoint: null,
  targetPoint: null,
  offset: null
}

function style(names: string[], values: Record<string, string | undefined>): DrawIOStyle {
  return {
    names,
    values: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined))
  }
}

function round(value: number): number {
  return Math.round(value * 100) / 100
}

function box(node: SceneNode): DrawIOGeometry {
  return {
    ...EMPTY_GEOMETRY,
    x: round(node.x),
    y: round(node.y),
    width: round(node.width),
    height: round(node.height)
  }
}

/**
 * Carries a layer's parent's axes into the page's, for a selected layer whose parent is not
 * written: draw.io places it on its one layer, which has the page's axes.
 */
interface ToPage {
  matrix: Mat3
  /** How far the parent turns its axes, in degrees. */
  turn: number
}

function toPageOf(graph: SceneGraph, node: SceneNode, pageId: string): ToPage | null {
  if (!node.parentId || node.parentId === pageId) return null
  const matrix = getParentWorldMatrix(graph.getNode(node.parentId), graph)
  const origin = Matrix.mapPoint(matrix, { x: 0, y: 0 })
  const across = Matrix.mapPoint(matrix, { x: 1, y: 0 })
  const turn = (Math.atan2(across.y - origin.y, across.x - origin.x) * 180) / Math.PI
  return { matrix, turn }
}

/** Where a layer sits and how far it turns about its centre, in draw.io's axes. */
interface Placed {
  geometry: DrawIOGeometry
  rotation: number
}

function placed(node: SceneNode, toPage: ToPage | null): Placed {
  if (!toPage) return { geometry: box(node), rotation: node.rotation }
  // draw.io turns a cell about its centre, as the layer turns, so the centre carries its place.
  const centre = Matrix.mapPoint(toPage.matrix, {
    x: node.x + node.width / 2,
    y: node.y + node.height / 2
  })
  const rotation = ((((node.rotation + toPage.turn + 180) % 360) + 360) % 360) - 180
  return {
    geometry: {
      ...box(node),
      x: round(centre.x - node.width / 2),
      y: round(centre.y - node.height / 2)
    },
    rotation
  }
}

/** A turn as draw.io's `rotation` style value, which an unturned cell leaves out. */
function rotationValue(rotation: number): string | undefined {
  return rotation === 0 ? undefined : String(round(rotation))
}

const escapeHTML = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** A layer's first visible solid fill, or the first stop of a gradient, as draw.io's colour. */
function fillColor(node: SceneNode): string {
  const fill = node.fills.find((paint) => paint.visible)
  if (!fill) return 'none'
  if (fill.type === 'SOLID') return colorToHex(fill.color)
  const stop = fill.gradientStops?.at(0)
  return stop ? colorToHex(stop.color) : 'none'
}

/** A layer's fill, outline, dash, and opacity as style pairs. */
function paintValues(node: SceneNode): Record<string, string | undefined> {
  const stroke = node.strokes.find((paint) => paint.visible)
  const weight = stroke?.weight ?? node.strokeWeight
  const dash = stroke?.dashPattern ?? node.dashPattern
  return {
    fillColor: fillColor(node),
    strokeColor: stroke ? colorToHex(stroke.color) : 'none',
    strokeWidth: stroke && weight !== 1 ? String(weight) : undefined,
    dashed: dash.length > 0 ? '1' : undefined,
    dashPattern: dash.length > 0 ? dash.map((n) => round(n / (weight || 1))).join(' ') : undefined,
    opacity: node.opacity < 1 ? String(Math.round(node.opacity * 100)) : undefined
  }
}

const ALIGN: Record<SceneNode['textAlignHorizontal'], string> = {
  LEFT: 'left',
  CENTER: 'center',
  RIGHT: 'right',
  JUSTIFIED: 'left'
}
const VERTICAL_ALIGN: Record<SceneNode['textAlignVertical'], string> = {
  TOP: 'top',
  CENTER: 'middle',
  BOTTOM: 'bottom'
}

/** A text layer's font and alignment as a label's style pairs. */
function fontValues(text: SceneNode): Record<string, string | undefined> {
  const fill = text.fills.find((paint) => paint.visible && paint.type === 'SOLID')
  const bits =
    (text.fontWeight >= 600 ? 1 : 0) |
    (text.italic ? 2 : 0) |
    (text.textDecoration === 'UNDERLINE' ? 4 : 0)
  return {
    fontSize: String(text.fontSize),
    // The font draw.io's default stands for on import goes back as that default.
    fontFamily: text.fontFamily === DEFAULT_FONT_FAMILY ? undefined : text.fontFamily,
    fontColor: fill ? colorToHex(fill.color) : undefined,
    fontStyle: bits ? String(bits) : undefined,
    align: ALIGN[text.textAlignHorizontal],
    verticalAlign: VERTICAL_ALIGN[text.textAlignVertical]
  }
}

/**
 * A text layer's characters as an HTML label: each style run in a span that sets what it
 * changes, and a line break for each new line.
 */
function labelHTML(text: SceneNode): string {
  const { text: characters, styleRuns } = text
  let html = ''
  let at = 0
  const plain = (to: number) => {
    html += escapeHTML(characters.slice(at, to)).replaceAll('\n', '<br>')
    at = to
  }
  for (const run of [...styleRuns].sort((a, b) => a.start - b.start)) {
    plain(run.start)
    const css: string[] = []
    const { style: s } = run
    if (s.fontWeight !== undefined) css.push(`font-weight: ${s.fontWeight}`)
    if (s.italic !== undefined) css.push(`font-style: ${s.italic ? 'italic' : 'normal'}`)
    if (s.textDecoration)
      css.push(`text-decoration: ${s.textDecoration === 'UNDERLINE' ? 'underline' : 'none'}`)
    if (s.fontSize !== undefined) css.push(`font-size: ${s.fontSize}px`)
    if (s.fontFamily) css.push(`font-family: ${s.fontFamily}`)
    const fill = s.fills?.find((paint) => paint.type === 'SOLID')
    if (fill?.type === 'SOLID') css.push(`color: ${colorToHex(fill.color)}`)
    const inner = escapeHTML(characters.slice(run.start, run.start + run.length)).replaceAll(
      '\n',
      '<br>'
    )
    html += css.length > 0 ? `<span style="${css.join('; ')}">${inner}</span>` : inner
    at = run.start + run.length
  }
  plain(characters.length)
  return html
}

/** A connector line's colour, width, and dash as an edge's style pairs. */
function lineValues(line: SceneNode): Record<string, string | undefined> {
  const stroke = line.strokes.find((paint) => paint.visible)
  const weight = stroke?.weight ?? 1
  const dash = stroke?.dashPattern ?? []
  return {
    strokeColor: stroke ? colorToHex(stroke.color) : 'none',
    strokeWidth: weight !== 1 ? String(weight) : undefined,
    dashed: dash.length > 0 ? '1' : undefined,
    dashPattern: dash.length > 0 ? dash.map((n) => round(n / weight)).join(' ') : undefined
  }
}

/** FigJam's ends and the draw.io arrowheads that draw them. */
const ARROWS: Record<StrokeCap, string> = {
  NONE: 'none',
  ROUND: 'none',
  SQUARE: 'none',
  ARROW_LINES: 'open',
  ARROW_EQUILATERAL: 'classic',
  TRIANGLE_FILLED: 'classic',
  DIAMOND_FILLED: 'diamond',
  CIRCLE_FILLED: 'oval'
}

/** Where a side magnet pins an end, as shares of the layer's box. */
const SIDE_POINTS: Partial<Record<ConnectorEndpoint['magnet'], [number, number]>> = {
  TOP: [0.5, 0],
  RIGHT: [1, 0.5],
  BOTTOM: [0.5, 1],
  LEFT: [0, 0.5]
}

/** Writes one page's layers as draw.io cells, in drawing order. */
class PageWriter {
  readonly cells: DrawIOCell[] = []
  private readonly ids = new Map<string, string>()
  /** Where each edge's line last ran from and to, in draw.io's axes. */
  private readonly drawnEnds = new Map<string, { start: DrawIOPoint; end: DrawIOPoint }>()
  private next = 2

  constructor(
    private readonly graph: SceneGraph,
    private readonly pageId: string
  ) {}

  private idOf(nodeId: string): string {
    let id = this.ids.get(nodeId)
    if (!id) {
      id = String(this.next++)
      this.ids.set(nodeId, id)
    }
    return id
  }

  write(nodeIds: readonly string[]) {
    // Every layer gets its id first, so an edge can name a layer drawn above it.
    const assign = (id: string) => {
      const node = this.graph.getNode(id)
      if (!node) return
      this.idOf(id)
      if (!isGeneratedFrame(node)) for (const child of node.childIds) assign(child)
    }
    // A layer inside another chosen one goes with it, as a cell of its own or drawn in its picture.
    const chosen = new Set(nodeIds)
    const roots = nodeIds.filter((id) => {
      const parentId = this.graph.getNode(id)?.parentId
      return !parentId || !this.graph.closest(parentId, (node) => chosen.has(node.id))
    })
    for (const id of roots) assign(id)
    for (const id of roots) {
      const node = this.graph.getNode(id)
      if (node) this.layer(node, LAYER_ID, toPageOf(this.graph, node, this.pageId))
    }
    this.freeStrandedEnds()
  }

  /**
   * An edge end joined to a layer that has no cell, such as one left out of a selection or
   * drawn inside a picture, goes as a free point where the line last ran.
   */
  private freeStrandedEnds() {
    const written = new Set(this.cells.map((cell) => cell.id))
    for (const cell of this.cells) {
      const drawn = this.drawnEnds.get(cell.id)
      if (!drawn) continue
      if (!cell.source || !written.has(cell.source)) {
        cell.source = null
        cell.geometry.sourcePoint = drawn.start
      }
      if (!cell.target || !written.has(cell.target)) {
        cell.target = null
        cell.geometry.targetPoint = drawn.end
      }
    }
  }

  private push(
    node: SceneNode,
    parent: string,
    cell: Omit<DrawIOCell, 'id' | 'parent' | 'visible' | 'attributes' | 'source' | 'target'> &
      Partial<Pick<DrawIOCell, 'source' | 'target'>>
  ) {
    this.cells.push({
      id: this.idOf(node.id),
      parent,
      visible: node.visible,
      attributes: {},
      source: null,
      target: null,
      ...cell
    })
  }

  private children(node: SceneNode) {
    for (const id of node.childIds) {
      const child = this.graph.getNode(id)
      if (child) this.layer(child, this.idOf(node.id), null)
    }
  }

  private layer(node: SceneNode, parent: string, toPage: ToPage | null) {
    const { geometry, rotation } = placed(node, toPage)
    switch (node.type) {
      case 'SHAPE_WITH_TEXT':
        return this.shape(node, parent, toPage)
      case 'TEXT':
        return this.push(node, parent, {
          kind: 'vertex',
          value: labelHTML(node),
          style: style(['text'], {
            html: '1',
            whiteSpace: 'wrap',
            rotation: rotationValue(rotation),
            ...fontValues(node)
          }),
          geometry
        })
      case 'STICKY': {
        const body = stickySublayers(this.graph, node)?.body
        return this.push(node, parent, {
          kind: 'vertex',
          value: body ? labelHTML(body) : '',
          style: style([], {
            whiteSpace: 'wrap',
            html: '1',
            ...paintValues(node),
            strokeColor: 'none',
            align: 'left',
            verticalAlign: 'top',
            spacing: '20',
            rotation: rotationValue(rotation),
            fontSize: body ? String(body.fontSize) : undefined
          }),
          geometry
        })
      }
      case 'SECTION':
        this.push(node, parent, {
          kind: 'vertex',
          value: escapeHTML(node.name),
          style: style(['swimlane'], { html: '1', startSize: '30', ...paintValues(node) }),
          geometry
        })
        return this.children(node)
      case 'GROUP':
        this.push(node, parent, {
          kind: 'vertex',
          value: '',
          style: style(['group'], {}),
          geometry
        })
        return this.children(node)
      case 'FRAME':
        this.push(node, parent, {
          kind: 'vertex',
          value: '',
          style: style([], { container: '1', html: '1', ...paintValues(node) }),
          geometry
        })
        return this.children(node)
      case 'RECTANGLE':
      case 'ELLIPSE':
        return this.push(node, parent, {
          kind: 'vertex',
          value: '',
          style: style(node.type === 'ELLIPSE' ? ['ellipse'] : [], {
            rounded: node.cornerRadius > 0 ? '1' : undefined,
            rotation: rotationValue(rotation),
            ...paintValues(node)
          }),
          geometry
        })
      case 'CONNECTOR':
        return this.edge(node, parent, toPage)
      default:
        return this.picture(node, parent, geometry)
    }
  }

  private shape(node: SceneNode, parent: string, toPage: ToPage | null) {
    const label = shapeWithTextLabel(this.graph, node)
    const values: Record<string, string | undefined> = {
      ...drawioShapeValues(node.shapeWithTextType),
      whiteSpace: 'wrap',
      html: '1',
      ...paintValues(node),
      ...(label ? fontValues(label) : {})
    }
    let { geometry, rotation } = placed(node, toPage)
    // A triangle turned a quarter points the way draw.io's direction says, in the box it fills.
    const quarter = Math.abs(rotation) === 90 && node.shapeWithTextType === 'TRIANGLE_UP'
    if (quarter) {
      values.direction = rotation === 90 ? 'east' : 'west'
      geometry = {
        ...geometry,
        x: round(geometry.x + (node.width - node.height) / 2),
        y: round(geometry.y + (node.height - node.width) / 2),
        width: round(node.height),
        height: round(node.width)
      }
      rotation = 0
    }
    values.rotation = rotationValue(rotation)
    this.push(node, parent, {
      kind: 'vertex',
      value: label ? labelHTML(label) : '',
      style: style([], values),
      geometry
    })
  }

  /** A layer draw.io has no cell for, drawn as the SVG image it exports as. */
  private picture(node: SceneNode, parent: string, geometry: DrawIOGeometry) {
    const svg = renderNodesToSVG(this.graph, this.pageId, [node.id])
    if (!svg) return
    const data = fromUint8Array(new TextEncoder().encode(svg))
    this.push(node, parent, {
      kind: 'vertex',
      value: '',
      // draw.io keeps a data URI in its style without `;base64`, which would end the value.
      style: style([], { shape: 'image', image: `data:image/svg+xml,${data}`, aspect: 'fixed' }),
      geometry
    })
  }

  private end(
    endpoint: ConnectorEndpoint | null,
    prefix: 'exit' | 'entry'
  ): Record<string, string> {
    const node = endpoint?.nodeId ? this.graph.getNode(endpoint.nodeId) : undefined
    if (!endpoint || !node) return {}
    const side = SIDE_POINTS[endpoint.magnet]
    const point: [number, number] | null =
      side ??
      (endpoint.magnet === 'NONE' || endpoint.magnet === 'ABSOLUTE'
        ? [endpoint.position.x / (node.width || 1), endpoint.position.y / (node.height || 1)]
        : null)
    if (!point) return {}
    return { [`${prefix}X`]: String(round(point[0])), [`${prefix}Y`]: String(round(point[1])) }
  }

  /**
   * Where an edge's free ends sit, its bend points, and its label's place along it, with the
   * points carried into draw.io's axes.
   */
  private edgeGeometry(node: SceneNode, toPage: ToPage | null): DrawIOGeometry {
    const at = (point: Vector) => {
      const mapped = toPage ? Matrix.mapPoint(toPage.matrix, point) : point
      return { x: round(mapped.x), y: round(mapped.y) }
    }
    const drawn = connectorRouteEnds(this.graph, node)
    if (drawn) {
      this.drawnEnds.set(this.idOf(node.id), { start: at(drawn.start), end: at(drawn.end) })
    }
    const position = node.connectorLabelPosition
    const along = position?.section === 'MIDDLE_TO_START' ? -position.offset : position?.offset
    return {
      ...EMPTY_GEOMETRY,
      relative: true,
      x: round(along ?? 0),
      sourcePoint: !node.connectorStart?.nodeId && drawn ? at(drawn.start) : null,
      targetPoint: !node.connectorEnd?.nodeId && drawn ? at(drawn.end) : null,
      points: this.waypoints(node).map(at)
    }
  }

  private edge(node: SceneNode, parent: string, toPage: ToPage | null) {
    // A connector without its line and label is not one draw.io could draw.
    const parts = connectorSublayers(this.graph, node)
    if (!parts) return
    const startId = node.connectorStart?.nodeId
    const endId = node.connectorEnd?.nodeId
    const lineType = node.connectorLineType
    this.push(node, parent, {
      kind: 'edge',
      value: parts.label.text ? labelHTML(parts.label) : '',
      style: style([], {
        edgeStyle: lineType === 'ELBOWED' ? 'orthogonalEdgeStyle' : undefined,
        rounded: lineType === 'ELBOWED' ? '1' : undefined,
        curved: lineType === 'CURVED' ? '1' : undefined,
        html: '1',
        startArrow: ARROWS[node.connectorStartCap],
        endArrow: ARROWS[node.connectorEndCap],
        ...lineValues(parts.line),
        ...this.end(node.connectorStart, 'exit'),
        ...this.end(node.connectorEnd, 'entry'),
        ...fontValues(parts.label)
      }),
      geometry: this.edgeGeometry(node, toPage),
      source: startId ? (this.ids.get(startId) ?? null) : null,
      target: endId ? (this.ids.get(endId) ?? null) : null
    })
  }

  /**
   * The points a dragged connector bends through, for draw.io to run its edge the same way: an
   * elbow's corners, or the middle of a curve. A connector routing itself leaves draw.io to route.
   */
  private waypoints(node: SceneNode): Vector[] {
    const route = connectorRoute(this.graph, node)
    if (!route) return []
    if (node.connectorLineType === 'CURVED' && node.connectorCurveHandles) {
      const curve = route.pieces.at(0)
      return curve ? [curveMidpoint(curve)] : []
    }
    if (node.connectorLineType !== 'ELBOWED' || node.connectorControlPoints.length === 0) return []
    return route.pieces.slice(0, -1).map((piece) => piece.to)
  }
}

/** One page of layers as a draw.io page, holding `nodeIds` or every layer on it. */
function pageOf(graph: SceneGraph, pageId: string, nodeIds?: readonly string[]): DrawIOPage {
  const page = graph.getNode(pageId)
  const writer = new PageWriter(graph, pageId)
  writer.write(nodeIds ?? page?.childIds ?? [])
  return {
    id: pageId,
    name: page?.name ?? 'Page',
    attributes: { grid: '1', gridSize: '10' },
    rootId: ROOT_ID,
    layers: [{ id: LAYER_ID, name: '', visible: true, locked: false }],
    cells: writer.cells
  }
}

/** What a draw.io export holds: whole pages, or some layers of one page. */
export type DrawIOExportTarget =
  | { pageIds: readonly string[] }
  | { pageId: string; nodeIds: readonly string[] }

/**
 * Layers as a draw.io file: FigJam shapes as draw.io's shapes of the same meaning, connectors as
 * edges joined to them, bent the way they were dragged, text as text, sections as swimlanes, and
 * frames and groups as containers. A layer draw.io has no cell for goes as an SVG image of
 * itself, so nothing is lost.
 */
export function sceneGraphToDrawIO(graph: SceneGraph, target: DrawIOExportTarget): DrawIOFile {
  const pages =
    'pageIds' in target
      ? target.pageIds.map((pageId) => pageOf(graph, pageId))
      : [pageOf(graph, target.pageId, target.nodeIds)]
  return { pages, unreadable: [] }
}

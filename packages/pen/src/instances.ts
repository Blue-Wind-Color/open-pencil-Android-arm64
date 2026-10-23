import { generateId, type SceneGraph, type SceneNode } from '@open-pencil/scene-graph'
import { populateInstanceChildren } from '@open-pencil/scene-graph/instances'

import { applyPenProperties, createSceneNode, type Build } from './nodes'
import type { PenNode, PenOverride } from './schema'

/** The layers a copy was made from, nearest first, through copies of copies. */
function sources(graph: SceneGraph, node: SceneNode): Set<string> {
  const found = new Set<string>()
  for (
    let id = node.componentId;
    id && !found.has(id);
    id = graph.getNode(id)?.componentId ?? null
  ) {
    found.add(id)
  }
  return found
}

/** The copy in `root`'s layers made from the pen.dev layer `sourceId`, at any depth. */
function findCopy(graph: SceneGraph, root: SceneNode, sourceId: string): SceneNode | undefined {
  const queue = graph.getChildren(root.id)
  for (const node of queue) {
    if (sources(graph, node).has(sourceId)) return node
    queue.push(...graph.getChildren(node.id))
  }
  return undefined
}

/**
 * The layer an override's key names: pen.dev IDs separated by `/`, each one inside the copy of the
 * instance the one before it names.
 */
function resolvePath(graph: SceneGraph, instance: SceneNode, path: string): SceneNode | undefined {
  let current: SceneNode | undefined = instance
  for (const id of path.split('/')) {
    current = current ? findCopy(graph, current, id) : undefined
  }
  return current
}

/** Runs `apply` in the merged theme of a layer's ancestors, as the layer was read in. */
function inAncestorThemes<T>(build: Build, node: SceneNode, apply: () => T): T {
  const chain: Record<string, string>[] = []
  for (let id = node.parentId; id; id = build.graph.getNode(id)?.parentId ?? null) {
    const theme = build.effective.get(id)?.theme
    if (theme) chain.unshift(theme)
  }
  const leave = chain.map((theme) => build.ctx.enterTheme(theme))
  try {
    return apply()
  } finally {
    for (const exit of leave.toReversed()) exit()
  }
}

function replaceLayer(build: Build, target: SceneNode, replacement: PenOverride): void {
  const { graph } = build
  const parentId = target.parentId
  if (!parentId) return
  const index = graph.getNode(parentId)?.childIds.indexOf(target.id) ?? -1
  const pen: PenNode = {
    ...replacement,
    type: replacement.type ?? 'frame',
    id: replacement.id ?? generateId()
  }
  inAncestorThemes(build, target, () => {
    graph.deleteNode(target.id)
    const id = createSceneNode(pen, parentId, build)
    if (id && index >= 0) graph.insertChildAt(id, parentId, index)
  })
}

function overrideLayer(build: Build, target: SceneNode, override: PenOverride): void {
  const { graph, ctx, effective } = build
  const base = effective.get(target.id) ?? { type: 'frame', id: target.id }
  const { descendants: _descendants, children, ...fields } = override
  const merged: PenNode = { ...base, ...fields, type: base.type, id: base.id }
  inAncestorThemes(build, target, () => {
    const leave = merged.theme ? ctx.enterTheme(merged.theme) : undefined
    try {
      applyPenProperties(target, merged, build)
      if (children) {
        const replaced = target.childIds
        for (const childId of replaced) graph.deleteNode(childId)
        for (const child of children) createSceneNode(child, target.id, build)
      }
    } finally {
      leave?.()
    }
  })
}

/** Gives an instance's copies their overrides; a key with a `type` replaces the layer. */
function applyDescendants(build: Build, instance: SceneNode, ref: PenNode): void {
  for (const [path, override] of Object.entries(ref.descendants ?? {})) {
    const target = resolvePath(build.graph, instance, path)
    if (!target) continue
    if (override.type) replaceLayer(build, target, override)
    else overrideLayer(build, target, override)
  }
}

/**
 * Fills each instance with copies of its component's layers, then applies its overrides. An
 * instance inside a component is filled first, so the copies made of it carry its layers and
 * overrides; a copy keeps its source's pen.dev fields and placement.
 */
export function populateInstances(build: Build): void {
  const { graph, effective, placements, instances } = build
  const done = new Set<string>()

  function populate(id: string): void {
    if (done.has(id)) return
    done.add(id)
    const instance = graph.getNode(id)
    const ref = instances.get(id)
    if (!instance?.componentId || !ref) return
    const component = graph.getNode(instance.componentId)
    if (!component) return
    for (const nested of instances.keys()) {
      if (graph.isDescendant(nested, component.id)) populate(nested)
    }
    populateInstanceChildren(graph, instance.id, component.id)
    const copies = graph.getChildren(instance.id)
    for (const copy of copies) {
      const source = copy.componentId
      const fields = source ? effective.get(source) : undefined
      if (fields) effective.set(copy.id, fields)
      const placement = source ? placements.get(source) : undefined
      if (placement) placements.set(copy.id, placement)
      if (source && build.groupIds.has(source)) build.groupIds.add(copy.id)
      if (source && build.aroundIds.has(source)) build.aroundIds.add(copy.id)
      copies.push(...graph.getChildren(copy.id))
    }
    applyDescendants(build, instance, ref)
  }

  // A replacement may hold instances of its own, which join the map as they are read.
  for (const id of instances.keys()) populate(id)
}

import * as v from 'valibot'

import { SceneGraph } from '@open-pencil/scene-graph'

import { createImageStore } from './images'
import { populateInstances } from './instances'
import { spreadAround } from './layout'
import { createSceneNode, type Build, type PenIconSource } from './nodes'
import { placeLayers } from './placement'
import { penFileSchema, type PenDocument, type PenNode } from './schema'
import { buildVarContext } from './variables'

/** Options for reading a document. */
export interface PenReadOptions {
  /**
   * Lays out the graph's auto layout and text, as `layoutAuthoredNodes` in Core does. Turned and
   * mirrored layers are placed after it, since where they land depends on their final size.
   */
  layout?(graph: SceneGraph): void
  /** The image files the document's paints name, by their URL in it; see `penAssets`. */
  images?: ReadonlyMap<string, Uint8Array>
  /** Where icon glyphs come from; icons are empty frames without it. */
  icons?: PenIconSource
}

function collectComponents(nodes: PenNode[], components: Map<string, PenNode>): void {
  for (const node of nodes) {
    if (node.reusable) components.set(node.id, node)
    if (node.children) collectComponents(node.children, components)
  }
}

/** Whether a group sits in an auto layout's flow, where fitting it changes the layout. */
function groupsInFlow(graph: SceneGraph, groupIds: Iterable<string>): boolean {
  for (const id of groupIds) {
    const group = graph.getNode(id)
    const parent = group?.parentId ? graph.getNode(group.parentId) : undefined
    if (parent && parent.layoutMode !== 'NONE') return true
  }
  return false
}

/** A `.pen` document's JSON, validated; throws for text that is not one. */
export function parsePenDocument(json: string): PenDocument {
  const parsed = v.safeParse(penFileSchema, json)
  if (!parsed.success) {
    throw new Error(`Not a .pen document: ${v.summarize(parsed.issues)}`)
  }
  return parsed.output
}

/** Builds the scene graph of a document `parsePenDocument` read. */
export function buildPenGraph(doc: PenDocument, options: PenReadOptions = {}): SceneGraph {
  const graph = new SceneGraph()

  for (const page of graph.getPages(true)) {
    graph.deleteNode(page.id)
  }

  const build: Build = {
    graph,
    ctx: buildVarContext(graph, doc),
    images: createImageStore(graph, options.images),
    icons: options.icons,
    components: new Map(),
    effective: new Map(),
    instances: new Map(),
    placements: new Map(),
    groupIds: new Set(),
    aroundIds: new Set()
  }
  collectComponents(doc.children, build.components)

  const page = graph.addPage(doc.children[0]?.name ?? 'Page 1')
  for (const child of doc.children) createSceneNode(child, page.id, build)
  populateInstances(build)

  options.layout?.(graph)
  const spread = options.layout ? spreadAround(graph, [...build.aroundIds]) : false
  placeLayers(graph, build.placements, [...build.groupIds])
  if (spread || groupsInFlow(graph, build.groupIds)) options.layout?.(graph)

  if (graph.getPages(true).length === 0) {
    graph.addPage('Page 1')
  }

  return graph
}

export function parsePenFile(json: string, options: PenReadOptions = {}): SceneGraph {
  return buildPenGraph(parsePenDocument(json), options)
}

export async function readPenFile(file: File, options?: PenReadOptions): Promise<SceneGraph> {
  return parsePenFile(await file.text(), options)
}

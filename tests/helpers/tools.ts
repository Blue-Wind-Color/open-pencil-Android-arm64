import { FigmaAPI } from '@open-pencil/core/figma-api'
import { ALL_TOOLS } from '@open-pencil/core/tools'
import { SceneGraph } from '@open-pencil/scene-graph'

export { ALL_TOOLS }

import { expectDefined } from './assert'

export interface ToolResult {
  id?: string
  name?: string
  type?: string
  error?: string
  count?: number
  nodes?: Array<{ id?: string; name: string; type: string; text?: string }>
  [key: string]: unknown
}

export function setupToolTest() {
  const graph = new SceneGraph()
  const figma = new FigmaAPI(graph)
  return { graph, figma }
}

export function getTool(name: string): (typeof ALL_TOOLS)[number] {
  return expectDefined(
    ALL_TOOLS.find((tool) => tool.name === name),
    `tool ${name}`
  )
}

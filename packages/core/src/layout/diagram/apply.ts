import type { SceneGraph } from '@open-pencil/scene-graph'
import { boundEndpoint } from '@open-pencil/scene-graph/connectors'
import type { Rect, Vector } from '@open-pencil/scene-graph/primitives'

import type { DiagramInput, DiagramLayout } from './index'
import { runConnectorAlong } from './routes'

/** The layers that draw a diagram, by the diagram's ids. */
export interface DiagramLayers {
  /** The layer drawing each node and group. */
  boxes: Map<string, string>
  /** The connector drawing each edge; an edge drawn by none only shapes the layout. */
  connectors: Map<string, string>
}

/** Where a diagram goes in its parent: by its top-left corner or by its centre. */
export type DiagramPlacement = { topLeft: Vector } | { center: Vector }

function bounds(boxes: Rect[]): Rect {
  const x = Math.min(...boxes.map((box) => box.x))
  const y = Math.min(...boxes.map((box) => box.y))
  return {
    x,
    y,
    width: Math.max(...boxes.map((box) => box.x + box.width)) - x,
    height: Math.max(...boxes.map((box) => box.y + box.height)) - y
  }
}

/**
 * Puts a diagram's layers where `layout` placed it, the drawing at `placement` in its parent:
 * each node's layer at its box and each group's at its box and size, in the axes of the group
 * holding it, if any. Each edge's connector is joined to the layers at its ends by the sides the
 * layout chose and runs along the route it gave.
 */
export function applyDiagramLayout(
  graph: SceneGraph,
  input: DiagramInput,
  layout: DiagramLayout,
  layers: DiagramLayers,
  placement: DiagramPlacement
): void {
  const boxes = new Map<string, Rect>([...layout.groups, ...layout.nodes])
  if (boxes.size === 0) return
  const drawing = bounds([...boxes.values()])
  const origin =
    'center' in placement
      ? {
          x: placement.center.x - drawing.width / 2,
          y: placement.center.y - drawing.height / 2
        }
      : placement.topLeft
  const shift = { x: origin.x - drawing.x, y: origin.y - drawing.y }
  const groupOf = new Map(
    [...input.nodes, ...input.groups].map((member) => [member.id, member.group])
  )
  for (const [id, layerId] of layers.boxes) {
    const box = boxes.get(id)
    if (!box) continue
    const group = groupOf.get(id)
    const outer = group ? boxes.get(group) : undefined
    const position = outer
      ? { x: box.x - outer.x, y: box.y - outer.y }
      : { x: box.x + shift.x, y: box.y + shift.y }
    // A group's layer takes the size the layout gave it; a node's keeps its own.
    if (layout.groups.has(id)) {
      graph.updateNode(layerId, { ...position, width: box.width, height: box.height })
    } else {
      graph.updateNode(layerId, position)
    }
  }
  for (const edge of input.edges) {
    const connectorId = layers.connectors.get(edge.id)
    const start = layers.boxes.get(edge.from)
    const end = layers.boxes.get(edge.to)
    if (!connectorId || !start || !end) continue
    const route = layout.edges.get(edge.id)
    graph.updateNode(connectorId, {
      connectorStart: boundEndpoint(start, route?.startSide ?? 'AUTO'),
      connectorEnd: boundEndpoint(end, route?.endSide ?? 'AUTO')
    })
    runConnectorAlong(
      graph,
      connectorId,
      (route?.points ?? []).map((point) => ({ x: point.x + shift.x, y: point.y + shift.y }))
    )
  }
}

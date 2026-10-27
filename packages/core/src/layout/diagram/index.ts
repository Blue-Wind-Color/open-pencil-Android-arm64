import type { ElkExtendedEdge, ElkNode, ElkPort } from 'elkjs/lib/elk-api'

import type { ConnectorSide } from '@open-pencil/scene-graph/connectors'
import type { Rect, Size, Vector } from '@open-pencil/scene-graph/primitives'

import { layoutWithElk } from './elk'

/** The way a diagram flows: top to bottom, bottom to top, left to right, or right to left. */
export type DiagramDirection = 'TB' | 'BT' | 'LR' | 'RL'

/** A node or group, at the top or inside the group it names. */
export interface DiagramMember {
  id: string
  group?: string
}

export interface DiagramNode extends DiagramMember, Size {}

/** A box around nodes and other groups, sized to hold them. */
export type DiagramGroup = DiagramMember

/** An edge between two nodes or groups; its label, by size, gets room along it. */
export interface DiagramEdge {
  id: string
  from: string
  to: string
  label?: Size
}

export interface DiagramInput {
  direction: DiagramDirection
  nodes: DiagramNode[]
  groups: DiagramGroup[]
  edges: DiagramEdge[]
}

/** The way an edge runs: the sides it leaves and enters by, and its corners between them. */
export interface DiagramRoute {
  startSide: ConnectorSide
  endSide: ConnectorSide
  /** From its start, on the middle of `startSide`, to its end, on the middle of `endSide`. */
  points: Vector[]
}

/** Where everything went, in the diagram's own axes. */
export interface DiagramLayout {
  nodes: Map<string, Rect>
  groups: Map<string, Rect>
  edges: Map<string, DiagramRoute>
}

/** Room between nodes side by side, and between ranks of them along the flow. */
const NODE_SPACING = 40
const RANK_SPACING = 60
/** Room inside a group around what it holds, and above it for the group's title. */
const GROUP_PADDING = 24
const GROUP_TITLE = 48

const ELK_DIRECTION: Record<DiagramDirection, string> = {
  TB: 'DOWN',
  BT: 'UP',
  LR: 'RIGHT',
  RL: 'LEFT'
}

/** The side edges leave a box by, and the side they enter one by, along the flow. */
const FLOW_SIDES: Record<DiagramDirection, [ConnectorSide, ConnectorSide]> = {
  TB: ['BOTTOM', 'TOP'],
  BT: ['TOP', 'BOTTOM'],
  LR: ['RIGHT', 'LEFT'],
  RL: ['LEFT', 'RIGHT']
}

const ELK_SIDE: Record<ConnectorSide, string> = {
  TOP: 'NORTH',
  RIGHT: 'EAST',
  BOTTOM: 'SOUTH',
  LEFT: 'WEST'
}

function portId(boxId: string, side: ConnectorSide): string {
  return `${boxId}\u0000${side}`
}

/**
 * A port on the middle of each side a box's edges use, fixed there: connectors attach to side
 * midpoints, so ELK routes every edge to where its connector will meet the box.
 */
function ports(boxId: string, size: Size, sides: ConnectorSide[]): ElkPort[] {
  const at: Record<ConnectorSide, Vector> = {
    TOP: { x: size.width / 2, y: 0 },
    RIGHT: { x: size.width, y: size.height / 2 },
    BOTTOM: { x: size.width / 2, y: size.height },
    LEFT: { x: 0, y: size.height / 2 }
  }
  return sides.map((side) => ({
    id: portId(boxId, side),
    ...at[side],
    width: 0,
    height: 0,
    layoutOptions: { 'elk.port.side': ELK_SIDE[side] }
  }))
}

/** Each box's place in the input: a node's own, a group's that of its first member. */
function writtenOrder(input: DiagramInput): Map<string, number> {
  const order = new Map<string, number>()
  const groupOf = new Map(input.groups.map((group) => [group.id, group.group]))
  for (const [index, node] of input.nodes.entries()) {
    order.set(node.id, index)
    for (let group = node.group; group !== undefined; group = groupOf.get(group)) {
      if (!order.has(group)) order.set(group, index)
    }
  }
  return order
}

function elkGraph(input: DiagramInput): ElkNode {
  const [outSide, inSide] = FLOW_SIDES[input.direction]
  const boxes = new Map<string, ElkNode>()
  for (const group of input.groups) {
    boxes.set(group.id, {
      id: group.id,
      children: [],
      layoutOptions: {
        'elk.padding': `[top=${GROUP_TITLE},left=${GROUP_PADDING},bottom=${GROUP_PADDING},right=${GROUP_PADDING}]`,
        'elk.portConstraints': 'FIXED_SIDE'
      },
      ports: [
        { id: portId(group.id, outSide), layoutOptions: { 'elk.port.side': ELK_SIDE[outSide] } },
        { id: portId(group.id, inSide), layoutOptions: { 'elk.port.side': ELK_SIDE[inSide] } }
      ]
    })
  }
  for (const node of input.nodes) {
    boxes.set(node.id, {
      id: node.id,
      width: node.width,
      height: node.height,
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      ports: ports(node.id, node, [outSide, inSide])
    })
  }
  const root: ElkNode = {
    id: '\u0000root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': ELK_DIRECTION[input.direction],
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': String(NODE_SPACING),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(RANK_SPACING),
      'elk.spacing.edgeNode': '20',
      'elk.spacing.edgeEdge': '12',
      'elk.layered.spacing.edgeNodeBetweenLayers': '20',
      'elk.spacing.componentComponent': String(RANK_SPACING),
      // Flowcharts read from their first node: break cycles along the order they were written
      // in, rather than where ELK's greedy pass would, which can put the start mid-drawing.
      'elk.layered.cycleBreaking.strategy': 'DEPTH_FIRST',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      'elk.edgeLabels.placement': 'CENTER',
      'elk.json.shapeCoords': 'ROOT',
      'elk.json.edgeCoords': 'ROOT'
    },
    children: [],
    edges: []
  }
  const parentOf = (group: string | undefined) => (group ? boxes.get(group) : undefined) ?? root
  // ELK keeps the order it is given, so boxes go in the order they were written: a node where it
  // first appears, a group where its first member does.
  const order = writtenOrder(input)
  const members = [...input.groups, ...input.nodes].sort(
    (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)
  )
  for (const member of members) {
    const box = boxes.get(member.id)
    if (box) parentOf(member.group).children?.push(box)
  }
  root.edges = input.edges
    .filter((edge) => boxes.has(edge.from) && boxes.has(edge.to))
    .map((edge): ElkExtendedEdge => ({
      id: edge.id,
      sources: [portId(edge.from, outSide)],
      targets: [portId(edge.to, inSide)],
      // ELK skips a label without text; only its size matters here.
      labels: edge.label ? [{ text: edge.id, ...edge.label }] : []
    }))
  return root
}

function sideOf(point: Vector, box: Rect): ConnectorSide {
  const distances: [ConnectorSide, number][] = [
    ['TOP', Math.abs(point.y - box.y)],
    ['RIGHT', Math.abs(point.x - (box.x + box.width))],
    ['BOTTOM', Math.abs(point.y - (box.y + box.height))],
    ['LEFT', Math.abs(point.x - box.x)]
  ]
  return distances.reduce((best, entry) => (entry[1] < best[1] ? entry : best))[0]
}

function collect(result: ElkNode, input: DiagramInput): DiagramLayout {
  const groupIds = new Set(input.groups.map((group) => group.id))
  const layout: DiagramLayout = { nodes: new Map(), groups: new Map(), edges: new Map() }
  const boxes = new Map<string, Rect>()
  const walk = (node: ElkNode) => {
    for (const child of node.children ?? []) {
      const rect = {
        x: child.x ?? 0,
        y: child.y ?? 0,
        width: child.width ?? 0,
        height: child.height ?? 0
      }
      boxes.set(child.id, rect)
      ;(groupIds.has(child.id) ? layout.groups : layout.nodes).set(child.id, rect)
      walk(child)
    }
  }
  walk(result)
  const edgesOf = (node: ElkNode): ElkExtendedEdge[] => [
    ...(node.edges ?? []),
    ...(node.children ?? []).flatMap(edgesOf)
  ]
  const ends = new Map(input.edges.map((edge) => [edge.id, edge]))
  for (const edge of edgesOf(result)) {
    const input = ends.get(edge.id)
    const from = input && boxes.get(input.from)
    const to = input && boxes.get(input.to)
    const points = (edge.sections ?? []).flatMap((section) => [
      section.startPoint,
      ...(section.bendPoints ?? []),
      section.endPoint
    ])
    const first = points.at(0)
    const last = points.at(-1)
    if (!from || !to || !first || !last) continue
    layout.edges.set(edge.id, {
      startSide: sideOf(first, from),
      endSide: sideOf(last, to),
      points: points.map(({ x, y }) => ({ x, y }))
    })
  }
  return layout
}

/**
 * Lays a diagram out with ELK's layered algorithm: nodes in ranks along the flow, groups around
 * their members, and every edge routed at right angles from the middle of the side it leaves by
 * to the middle of the side it enters by.
 */
export async function layoutDiagram(input: DiagramInput): Promise<DiagramLayout> {
  return collect(await layoutWithElk(elkGraph(input)), input)
}

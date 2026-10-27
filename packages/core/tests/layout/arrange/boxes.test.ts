import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import type { Rect } from '@open-pencil/scene-graph/primitives'

import {
  arrangeBoxes,
  type ArrangeBox,
  type ArrangeInput,
  type BoxLayout
} from '#core/layout/arrange/boxes'

const box = (id: string, x = 0, y = 0, group?: string): ArrangeBox => ({
  id,
  width: 120,
  height: 50,
  position: { x, y },
  group
})

function overlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

function overlapping(rects: Rect[]): boolean {
  return rects.some((a, i) => rects.slice(i + 1).some((b) => overlap(a, b)))
}

function bounds(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((rect) => rect.x))
  const y = Math.min(...rects.map((rect) => rect.y))
  return {
    x,
    y,
    width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
    height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y
  }
}

/** A root with two children, one of which has a child: `r → a, r → b, a → c`. */
const TREE: Pick<ArrangeInput, 'boxes' | 'groups' | 'edges'> = {
  boxes: [box('r'), box('a'), box('b'), box('c')],
  groups: [],
  edges: [
    { id: 'ra', from: 'r', to: 'a' },
    { id: 'rb', from: 'r', to: 'b' },
    { id: 'ac', from: 'a', to: 'c' }
  ]
}

describe('arrangeBoxes', () => {
  describe('flow', () => {
    test('routes every edge from the middle of the side it leaves by to the middle of the one it enters', async () => {
      const input: ArrangeInput = {
        layout: 'flow',
        direction: 'TB',
        boxes: [box('a'), box('b'), box('c')],
        groups: [],
        edges: [
          { id: 'ab', from: 'a', to: 'b' },
          { id: 'ac', from: 'a', to: 'c' }
        ]
      }
      const arrangement = await arrangeBoxes(input)
      for (const edge of input.edges) {
        const route = expectDefined(arrangement.edges.get(edge.id))
        const from = expectDefined(arrangement.boxes.get(edge.from))
        const to = expectDefined(arrangement.boxes.get(edge.to))
        expect([route.startSide, route.endSide]).toEqual(['BOTTOM', 'TOP'])
        expect(route.points[0]).toEqual({ x: from.x + from.width / 2, y: from.y + from.height })
        expect(route.points.at(-1)).toEqual({ x: to.x + to.width / 2, y: to.y })
        for (const [i, point] of route.points.slice(1).entries()) {
          const previous = expectDefined(route.points[i])
          expect(point.x === previous.x || point.y === previous.y).toBe(true)
        }
      }
    })

    test('keeps the first box first when edges loop back to it', async () => {
      const arrangement = await arrangeBoxes({
        layout: 'flow',
        direction: 'LR',
        boxes: [box('start'), box('work', 0, 0, 'loop'), box('check', 0, 0, 'loop')],
        groups: [{ id: 'loop' }],
        edges: [
          { id: 'a', from: 'start', to: 'work' },
          { id: 'b', from: 'work', to: 'check' },
          { id: 'c', from: 'check', to: 'start' }
        ]
      })
      const start = expectDefined(arrangement.boxes.get('start'))
      const work = expectDefined(arrangement.boxes.get('work'))
      const loop = expectDefined(arrangement.groups.get('loop'))
      expect(start.x + start.width).toBeLessThan(work.x)
      expect(loop.x).toBeLessThanOrEqual(work.x)
      expect(loop.x + loop.width).toBeGreaterThanOrEqual(work.x + work.width)
    })

    test('leaves room along an edge for its label', async () => {
      const gap = async (label?: { width: number; height: number }) => {
        const arrangement = await arrangeBoxes({
          layout: 'flow',
          boxes: [box('a'), box('b')],
          groups: [],
          edges: [{ id: 'e', from: 'a', to: 'b', label }]
        })
        const a = expectDefined(arrangement.boxes.get('a'))
        return expectDefined(arrangement.boxes.get('b')).y - (a.y + a.height)
      }
      expect(await gap({ width: 60, height: 40 })).toBeGreaterThanOrEqual((await gap()) + 40)
    })
  })

  test('spread pushes overlapping boxes apart and leaves those clear of others nearly in place', async () => {
    const boxes = [box('a', 0, 0), box('b', 40, 20), box('far', 600, 0)]
    const arrangement = await arrangeBoxes({ layout: 'spread', boxes, groups: [], edges: [] })
    const placed = [...arrangement.boxes.values()]
    expect(overlapping(placed)).toBe(false)
    const a = expectDefined(arrangement.boxes.get('a'))
    const far = expectDefined(arrangement.boxes.get('far'))
    // Relative places hold: the far box stays well to the right.
    expect(far.x - a.x).toBeGreaterThan(400)
  })

  test('compact closes the gaps a spread leaves, without overlaps', async () => {
    const boxes = [box('a', 0, 0), box('b', 40, 20), box('c', 900, 0), box('d', 0, 700)]
    const spread = await arrangeBoxes({ layout: 'spread', boxes, groups: [], edges: [] })
    const compact = await arrangeBoxes({ layout: 'compact', boxes, groups: [], edges: [] })
    const compacted = [...compact.boxes.values()]
    expect(overlapping(compacted)).toBe(false)
    const area = (rect: Rect) => rect.width * rect.height
    expect(area(bounds(compacted))).toBeLessThan(area(bounds([...spread.boxes.values()])))
  })

  test('compact starts from where the spread put each group, so no group lands on a box', async () => {
    const arrangement = await arrangeBoxes({
      layout: 'compact',
      boxes: [box('a', 0, 0), box('b', 900, 0), box('inner', 30, 70, 'g')],
      groups: [{ id: 'g', position: { x: 10, y: 10 } }],
      edges: []
    })
    const group = expectDefined(arrangement.groups.get('g'))
    for (const id of ['a', 'b'])
      expect(overlap(group, expectDefined(arrangement.boxes.get(id)))).toBe(false)
  })

  test('pack fills rows in the boxes’ order, the given space apart', async () => {
    const arrangement = await arrangeBoxes({
      layout: 'pack',
      spacing: 20,
      boxes: ['a', 'b', 'c', 'd'].map((id) => box(id, 500, 500)),
      groups: [],
      edges: []
    })
    const [a, b] = ['a', 'b'].map((id) => expectDefined(arrangement.boxes.get(id)))
    expect(overlapping([...arrangement.boxes.values()])).toBe(false)
    expect(expectDefined(b).y).toBe(expectDefined(a).y)
    expect(expectDefined(b).x - (expectDefined(a).x + expectDefined(a).width)).toBe(20)
  })

  test('tree puts each child below its parent, and LR to its right', async () => {
    const down = await arrangeBoxes({ layout: 'tree', ...TREE })
    const across = await arrangeBoxes({ layout: 'tree', direction: 'LR', ...TREE })
    for (const [parent, child] of [
      ['r', 'a'],
      ['r', 'b'],
      ['a', 'c']
    ] as const) {
      const p = expectDefined(down.boxes.get(parent))
      const c = expectDefined(down.boxes.get(child))
      expect(p.y + p.height).toBeLessThan(c.y)
      const pr = expectDefined(across.boxes.get(parent))
      const cr = expectDefined(across.boxes.get(child))
      expect(pr.x + pr.width).toBeLessThan(cr.x)
    }
  })

  test('tree has its edges leave and enter boxes along its direction', async () => {
    const arrangement = await arrangeBoxes({ layout: 'tree', direction: 'LR', ...TREE })
    expect(arrangement.edges.get('ra')).toEqual({ startSide: 'RIGHT', endSide: 'LEFT', points: [] })
  })

  test('radial places the root nearer the middle than the leaf farthest down the tree', async () => {
    const arrangement = await arrangeBoxes({ layout: 'radial', ...TREE })
    const centre = (rect: Rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 })
    const middle = centre(bounds([...arrangement.boxes.values()]))
    const distance = (id: string) => {
      const point = centre(expectDefined(arrangement.boxes.get(id)))
      return Math.hypot(point.x - middle.x, point.y - middle.y)
    }
    expect(distance('r')).toBeLessThan(distance('c'))
  })

  test.each(['spread', 'compact', 'pack', 'tree', 'radial', 'network'] satisfies BoxLayout[])(
    '%s places every box, inside its group',
    async (layout) => {
      const arrangement = await arrangeBoxes({
        layout,
        boxes: [box('a'), box('b', 30, 10, 'g'), box('c', 60, 20, 'g')],
        groups: [{ id: 'g' }],
        edges: [{ id: 'bc', from: 'b', to: 'c' }]
      })
      expect([...arrangement.boxes.keys()].sort()).toEqual(['a', 'b', 'c'])
      const group = expectDefined(arrangement.groups.get('g'))
      for (const id of ['b', 'c']) {
        const inner = expectDefined(arrangement.boxes.get(id))
        expect(inner.x).toBeGreaterThanOrEqual(group.x)
        expect(inner.y).toBeGreaterThanOrEqual(group.y)
        expect(inner.x + inner.width).toBeLessThanOrEqual(group.x + group.width)
        expect(inner.y + inner.height).toBeLessThanOrEqual(group.y + group.height)
      }
      // A flow routes its edges and a tree sets their sides; the others leave them to connectors.
      expect(arrangement.edges.size).toBe(layout === 'tree' ? 1 : 0)
    }
  )
})

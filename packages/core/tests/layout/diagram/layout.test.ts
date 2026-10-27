import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { layoutDiagram, type DiagramInput } from '#core/layout/diagram'

const node = (id: string, group?: string) => ({ id, width: 120, height: 50, group })

describe('layoutDiagram', () => {
  test('routes every edge from the middle of the side it leaves by to the middle of the one it enters', async () => {
    const input: DiagramInput = {
      direction: 'TB',
      nodes: [node('a'), node('b'), node('c')],
      groups: [],
      edges: [
        { id: 'ab', from: 'a', to: 'b' },
        { id: 'ac', from: 'a', to: 'c' }
      ]
    }
    const layout = await layoutDiagram(input)
    for (const edge of input.edges) {
      const route = expectDefined(layout.edges.get(edge.id))
      const from = expectDefined(layout.nodes.get(edge.from))
      const to = expectDefined(layout.nodes.get(edge.to))
      expect([route.startSide, route.endSide]).toEqual(['BOTTOM', 'TOP'])
      expect(route.points[0]).toEqual({ x: from.x + from.width / 2, y: from.y + from.height })
      expect(route.points.at(-1)).toEqual({ x: to.x + to.width / 2, y: to.y })
      // Every corner is a right angle.
      for (const [i, point] of route.points.slice(1).entries()) {
        const previous = expectDefined(route.points[i])
        expect(point.x === previous.x || point.y === previous.y).toBe(true)
      }
    }
  })

  test('keeps the first node written first when edges loop back to it', async () => {
    const layout = await layoutDiagram({
      direction: 'LR',
      nodes: [node('start'), node('work', 'loop'), node('check', 'loop')],
      groups: [{ id: 'loop' }],
      edges: [
        { id: 'a', from: 'start', to: 'work' },
        { id: 'b', from: 'work', to: 'check' },
        { id: 'c', from: 'check', to: 'start' }
      ]
    })
    const start = expectDefined(layout.nodes.get('start'))
    const work = expectDefined(layout.nodes.get('work'))
    const loop = expectDefined(layout.groups.get('loop'))
    expect(start.x + start.width).toBeLessThan(work.x)
    expect(loop.x).toBeLessThanOrEqual(work.x)
    expect(loop.x + loop.width).toBeGreaterThanOrEqual(work.x + work.width)
  })

  test('leaves room along an edge for its label', async () => {
    const gap = async (label?: { width: number; height: number }) => {
      const layout = await layoutDiagram({
        direction: 'TB',
        nodes: [node('a'), node('b')],
        groups: [],
        edges: [{ id: 'e', from: 'a', to: 'b', label }]
      })
      const a = expectDefined(layout.nodes.get('a'))
      return expectDefined(layout.nodes.get('b')).y - (a.y + a.height)
    }
    expect(await gap({ width: 60, height: 40 })).toBeGreaterThanOrEqual((await gap()) + 40)
  })
})

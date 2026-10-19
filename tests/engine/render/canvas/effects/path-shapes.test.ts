import { describe, expect, mock, test } from 'bun:test'

import { renderEffects } from '#core/canvas/shadows'

import { asCanvas } from '../helpers'
import {
  createMockCanvas,
  createMockRenderer,
  effectNode,
  mockCalls,
  OPAQUE_FILL,
  TEST_GRAPH
} from './helpers'

const requiredNodeFields = { childIds: [] as string[], strokeGeometry: [] }

describe('path shape shadows', () => {
  test('drop shadow for a star without imported geometry uses the star path', () => {
    const r = createMockRenderer()
    const canvas = createMockCanvas()
    const node = effectNode({
      ...requiredNodeFields,
      type: 'STAR',
      width: 100,
      height: 100,
      fills: [OPAQUE_FILL],
      effects: [
        {
          type: 'DROP_SHADOW',
          visible: true,
          color: { r: 0, g: 0, b: 0, a: 1 },
          offset: { x: 0, y: 0 },
          radius: 10,
          spread: 5
        }
      ]
    })

    renderEffects(r, asCanvas(canvas), node, TEST_GRAPH, new Float32Array(4), false, 'behind')

    expect(r.makePolygonPath).toHaveBeenCalled()
    expect(canvas.drawPath).toHaveBeenCalled()
    expect(canvas.drawRect).not.toHaveBeenCalled()
  })

  test('drop shadow spread combines and deletes a detached stroked ring', () => {
    const r = createMockRenderer()
    const canvas = createMockCanvas()
    const cachedPath = new r.ck.Path()
    const ringPath = new r.ck.Path()
    const combinedPath = new r.ck.Path()
    cachedPath.makeStroked = mock(() => ringPath)
    r.ck.Path.MakeFromOp = mock(() => combinedPath)
    r.getFillGeometry = mock(() => [cachedPath])

    const node = effectNode({
      ...requiredNodeFields,
      type: 'STAR',
      width: 100,
      height: 100,
      fills: [{ visible: true, type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1 }],
      effects: [
        {
          type: 'DROP_SHADOW',
          visible: true,
          color: { r: 0, g: 0, b: 0, a: 1 },
          offset: { x: 0, y: 0 },
          radius: 10,
          spread: 10
        }
      ]
    })

    renderEffects(r, asCanvas(canvas), node, TEST_GRAPH, new Float32Array(4), false, 'behind')

    const makeFromOp = r.ck.Path.MakeFromOp as ReturnType<typeof mock>
    expect(makeFromOp).toHaveBeenCalledWith(cachedPath, ringPath, r.ck.PathOp.Union)
    expect(ringPath.delete).toHaveBeenCalledTimes(1)
    expect(combinedPath.delete).toHaveBeenCalledTimes(1)
    expect(cachedPath.delete).not.toHaveBeenCalled()
  })

  test('inner shadow for a polygon clips and cuts out with polygon paths', () => {
    const r = createMockRenderer()
    const canvas = createMockCanvas()
    const node = effectNode({
      ...requiredNodeFields,
      type: 'POLYGON',
      width: 100,
      height: 100,
      fills: [OPAQUE_FILL],
      effects: [
        {
          type: 'INNER_SHADOW',
          visible: true,
          color: { r: 0, g: 0, b: 0, a: 1 },
          offset: { x: 5, y: 5 },
          radius: 10,
          spread: 3
        }
      ]
    })

    renderEffects(
      r,
      asCanvas(canvas),
      node,
      TEST_GRAPH,
      new Float32Array([0, 0, 100, 100]),
      false,
      'inner'
    )

    expect(mockCalls(r.makePolygonPath).length).toBeGreaterThanOrEqual(2)
    expect(canvas.clipPath).toHaveBeenCalled()
    expect(canvas.drawPath).toHaveBeenCalled()
    expect(canvas.clipRect).not.toHaveBeenCalled()
  })
})

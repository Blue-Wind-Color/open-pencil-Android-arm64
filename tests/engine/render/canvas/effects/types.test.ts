import { describe, expect, mock, test } from 'bun:test'

import type { ImageFilter } from 'canvaskit-wasm'

import type { SceneGraph } from '@open-pencil/scene-graph'
import { createDefaultSourceMetadata } from '@open-pencil/scene-graph/node-defaults'

import { applyClippedBlur } from '#core/canvas/effects'
import { renderNode } from '#core/canvas/scene'
import { renderEffects } from '#core/canvas/shadows'

import { asCanvas, asDouble } from '../helpers'
import {
  createMockCanvas,
  createMockRenderer,
  effectNode,
  mockCalls,
  OPAQUE_FILL,
  TEST_GRAPH
} from './helpers'

describe('Renderer handles all effect types (Behavioral)', () => {
  test('handles DROP_SHADOW', () => {
    const r = createMockRenderer()
    const canvas = createMockCanvas()
    const node = effectNode({
      type: 'RECTANGLE',
      width: 100,
      height: 100,
      fills: [OPAQUE_FILL],
      childIds: [],
      strokeGeometry: [],
      effects: [
        {
          type: 'DROP_SHADOW',
          visible: true,
          color: { r: 0, g: 0, b: 0, a: 0.5 },
          offset: { x: 5, y: 5 },
          radius: 10,
          spread: 0
        }
      ]
    })
    renderEffects(r, asCanvas(canvas), node, TEST_GRAPH, new Float32Array(4), false, 'behind')
    expect(canvas.drawRect).toHaveBeenCalled()
  })

  test('a stroke without a fill casts a ring and clips its shape out of the shadow', () => {
    const r = createMockRenderer()
    const canvas = createMockCanvas()
    const node = effectNode({
      type: 'RECTANGLE',
      width: 100,
      height: 100,
      fills: [],
      strokes: [{ ...OPAQUE_FILL, opacity: 0.5, weight: 4, align: 'CENTER' }],
      effects: [
        {
          type: 'DROP_SHADOW',
          visible: true,
          color: { r: 0, g: 0, b: 0, a: 0.5 },
          offset: { x: 0, y: 3 },
          radius: 3,
          spread: 0,
          showShadowBehindNode: false
        }
      ]
    })

    renderEffects(r, asCanvas(canvas), node, TEST_GRAPH, new Float32Array(4), false, 'behind')

    expect(r.ltrb).toHaveBeenCalledWith(-2, -2, 102, 102)
    expect(r.ltrb).toHaveBeenCalledWith(2, 2, 98, 98)
    const [ring] = mockCalls(canvas.drawPath).find(([, paint]) => paint === r.auxFill) ?? []
    if (typeof ring !== 'object' || ring === null) throw new Error('expected the ring path')
    expect(mockCalls(Reflect.get(ring, 'setFillType'))).toContainEqual([r.ck.FillType.EvenOdd])
    expect(canvas.clipPath).toHaveBeenCalledWith(expect.anything(), r.ck.ClipOp.Difference, true)
    expect(canvas.drawPath).toHaveBeenCalledWith(expect.anything(), r.auxFill)
    expect(r.paintShapeContent).not.toHaveBeenCalled()
  })

  test('applies effect blend modes to rendered shadow paint', () => {
    const r = createMockRenderer()
    const canvas = createMockCanvas()
    const node = effectNode({
      type: 'RECTANGLE',
      width: 100,
      height: 100,
      fills: [OPAQUE_FILL],
      childIds: [],
      strokeGeometry: [],
      effects: [
        {
          type: 'DROP_SHADOW',
          visible: true,
          color: { r: 0, g: 0, b: 0, a: 0.5 },
          offset: { x: 5, y: 5 },
          radius: 10,
          spread: 0,
          blendMode: 'SCREEN'
        }
      ]
    })

    renderEffects(r, asCanvas(canvas), node, TEST_GRAPH, new Float32Array(4), false, 'behind')

    expect(r.auxFill.setBlendMode).toHaveBeenCalledWith(r.ck.BlendMode.Screen)
    expect(r.auxFill.setBlendMode).toHaveBeenLastCalledWith(r.ck.BlendMode.SrcOver)
  })

  test('handles INNER_SHADOW', () => {
    const r = createMockRenderer()
    const canvas = createMockCanvas()
    const node = effectNode({
      type: 'RECTANGLE',
      width: 100,
      height: 100,
      fills: [OPAQUE_FILL],
      childIds: [],
      effects: [
        {
          type: 'INNER_SHADOW',
          visible: true,
          color: { r: 0, g: 0, b: 0, a: 0.5 },
          offset: { x: 5, y: 5 },
          radius: 10,
          spread: 0
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
    expect(canvas.drawPath).toHaveBeenCalled()
  })

  test('renders raw Figma noise effects as a bounded visual fallback', () => {
    const r = createMockRenderer()
    const canvas = createMockCanvas()
    const node = effectNode({
      type: 'RECTANGLE',
      width: 20,
      height: 20,
      fills: [],
      childIds: [],
      effects: [],
      source: {
        format: 'fig',
        id: '1:1',
        orderKey: null,
        editedFields: [],
        fig: {
          rawSize: null,
          rawTransform: null,
          rawNodeFields: {
            effects: [
              {
                type: 'NOISE',
                visible: true,
                color: { r: 0, g: 0, b: 0, a: 1 },
                density: 1,
                noiseSize: { x: 0.25, y: 0.25 },
                noiseType: 'MONOTONE'
              }
            ]
          },
          layout: null,
          symbolOverrides: [],
          componentPropAssignments: [],
          derivedSymbolData: [],
          derivedSymbolDataLayoutVersion: null,
          uniformScaleFactor: null
        }
      }
    })

    renderEffects(
      r,
      asCanvas(canvas),
      node,
      TEST_GRAPH,
      new Float32Array([0, 0, 20, 20]),
      false,
      'front'
    )

    expect(r.clipNodeShape).toHaveBeenCalled()
    expect(canvas.drawRect).toHaveBeenCalled()
  })

  test('bounds raw noise effect draw calls for large nodes', () => {
    const r = createMockRenderer()
    const canvas = createMockCanvas()
    const node = effectNode({
      type: 'RECTANGLE',
      width: 1000,
      height: 1000,
      fills: [],
      childIds: [],
      effects: [],
      source: {
        format: 'fig',
        id: '1:1',
        orderKey: null,
        editedFields: [],
        fig: {
          rawSize: null,
          rawTransform: null,
          rawNodeFields: {
            effects: [
              {
                type: 'NOISE',
                visible: true,
                color: { r: 0, g: 0, b: 0, a: 1 },
                density: 1,
                noiseSize: { x: 0.1, y: 0.1 }
              }
            ]
          },
          layout: null,
          symbolOverrides: [],
          componentPropAssignments: [],
          derivedSymbolData: [],
          derivedSymbolDataLayoutVersion: null,
          uniformScaleFactor: null
        }
      }
    })

    renderEffects(
      r,
      asCanvas(canvas),
      node,
      TEST_GRAPH,
      new Float32Array([0, 0, 1000, 1000]),
      false,
      'front'
    )

    expect(mockCalls(canvas.drawRect).length).toBeLessThanOrEqual(12_000)
  })

  test('handles BACKGROUND_BLUR', () => {
    const r = createMockRenderer()
    const canvas = createMockCanvas()
    const node = effectNode({
      type: 'RECTANGLE',
      fills: [],
      childIds: [],
      effects: [
        {
          type: 'BACKGROUND_BLUR',
          visible: true,
          radius: 10,
          color: { r: 0, g: 0, b: 0, a: 0 },
          offset: { x: 0, y: 0 },
          spread: 0
        }
      ]
    })
    renderEffects(r, asCanvas(canvas), node, TEST_GRAPH, new Float32Array(4), false, 'behind')
    expect(r.applyClippedBlur).toHaveBeenCalled()
  })

  test('background blur uses a backdrop filter instead of a layer content filter', () => {
    const blurFilter = asDouble<ImageFilter>({ kind: 'blur' })
    const r = createMockRenderer({
      clipNodeShape: mock(() => undefined),
      getCachedBlur: mock(() => blurFilter)
    })
    const canvas = createMockCanvas()
    const rect = new Float32Array([0, 0, 100, 100])
    const node = effectNode({
      type: 'RECTANGLE',
      width: 100,
      height: 100,
      fills: [],
      childIds: [],
      effects: []
    })

    applyClippedBlur(r, asCanvas(canvas), node, rect, false, 5)

    expect(r.effectLayerPaint.setImageFilter).toHaveBeenCalledWith(null)
    expect(canvas.saveLayer).toHaveBeenCalledWith(
      undefined,
      rect,
      blurFilter,
      undefined,
      r.ck.TileMode.Clamp
    )
  })

  test('handles LAYER_BLUR in renderNode', () => {
    const r = createMockRenderer()
    const canvas = createMockCanvas()
    const node = effectNode({
      type: 'RECTANGLE',
      id: 'n1',
      visible: true,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      effects: [
        {
          type: 'LAYER_BLUR',
          visible: true,
          radius: 10,
          color: { r: 0, g: 0, b: 0, a: 0 },
          offset: { x: 0, y: 0 },
          spread: 0
        }
      ],
      childIds: [],
      source: createDefaultSourceMetadata()
    })
    const graph: Partial<SceneGraph> = {
      getNode: mock(() => node)
    }
    renderNode(r, asCanvas(canvas), graph as SceneGraph, 'n1', {})
    // Figma draws a blur radius as a Gaussian of 0.43 × radius.
    expect(r.getCachedBlur).toHaveBeenCalledWith(expect.closeTo(4.3))
    expect(canvas.saveLayer).toHaveBeenCalledWith(r.effectLayerPaint, expect.any(Float32Array))
    expect(r.ck.LTRBRect).toHaveBeenCalledWith(-20, -20, 120, 120)
  })

  test('handles FOREGROUND_BLUR in renderNode', () => {
    const r = createMockRenderer()
    const canvas = createMockCanvas()
    const node = effectNode({
      type: 'RECTANGLE',
      id: 'n1',
      visible: true,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      effects: [
        {
          type: 'FOREGROUND_BLUR',
          visible: true,
          radius: 20,
          color: { r: 0, g: 0, b: 0, a: 0 },
          offset: { x: 0, y: 0 },
          spread: 0
        }
      ],
      childIds: [],
      source: createDefaultSourceMetadata()
    })
    const graph: Partial<SceneGraph> = {
      getNode: mock(() => node)
    }
    renderNode(r, asCanvas(canvas), graph as SceneGraph, 'n1', {})
    expect(r.getCachedBlur).toHaveBeenCalledWith(expect.closeTo(8.6))
    expect(canvas.saveLayer).toHaveBeenCalledWith(r.effectLayerPaint, expect.any(Float32Array))
    expect(r.ck.LTRBRect).toHaveBeenCalledWith(-40, -40, 140, 140)
  })
})

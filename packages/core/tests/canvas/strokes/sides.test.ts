import { afterAll, describe, expect, test } from 'bun:test'

import { SkiaRenderer } from '@open-pencil/core'
import { initCanvasKit } from '@open-pencil/core/io'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { sideDashSpans, sideStrokeRRects } from '#core/canvas/strokes/sides'

import { expectDefined } from '#core-tests/helpers/assert'
import { expectFigmaRow, renderRow } from '#core-tests/helpers/figma-rows'

const ck = await initCanvasKit()
const renderer = new SkiaRenderer(ck, expectDefined(ck.MakeSurface(1, 1)))
afterAll(() => renderer.destroy())

/** Rows of alpha from Figma 126 exports, read as `renderRow` reads ours. */
const FIGMA = {
  sharpHalf: [0, 0, 0, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128],
  roundHalf: [0, 0, 0, 0, 0, 8, 128, 128, 128, 128, 120, 8, 0, 0, 0, 0, 0, 0, 0, 0],
  dashed: [
    0, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 0, 0, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 255
  ]
}

function sidesFrame(props: Partial<SceneNode> = {}, opacity = 0.5) {
  return (graph: SceneGraph, hostId: string) => {
    graph.createNode('FRAME', hostId, {
      x: 120,
      y: 70,
      width: 160,
      height: 160,
      fills: [],
      clipsContent: false,
      strokes: [
        {
          type: 'SOLID',
          color: { r: 0, g: 0, b: 1, a: 1 },
          opacity,
          visible: true,
          weight: 8,
          align: 'CENTER'
        }
      ],
      strokeWeight: 8,
      strokeAlign: 'CENTER',
      independentStrokeWeights: true,
      borderTopWeight: 8,
      borderRightWeight: 0,
      borderBottomWeight: 16,
      borderLeftWeight: 4,
      ...props
    })
  }
}

describe('strokes with sides of their own weights, as in Figma', () => {
  test('are one ring with a filled corner, so a translucent stroke does not overlap', () => {
    expectFigmaRow(renderRow(ck, renderer, sidesFrame(), 68, 112, 140), FIGMA.sharpHalf)
  })

  test('round each corner by its sides', () => {
    expectFigmaRow(
      renderRow(ck, renderer, sidesFrame({ cornerRadius: 24 }), 76, 112, 150),
      FIGMA.roundHalf
    )
  })

  test('dash each side on its own, with the corner between two dashed sides filled', () => {
    const dashed = sidesFrame({ width: 150, height: 150 }, 1)
    const values = renderRow(
      ck,
      renderer,
      (graph, hostId) => {
        dashed(graph, hostId)
        const frame = graph.getNode(expectDefined(graph.getNode(hostId)).childIds[0])
        if (frame) frame.strokes = frame.strokes.map((stroke) => ({ ...stroke, dashPattern: [20, 10] }))
      },
      68,
      112,
      200
    )
    expectFigmaRow(values, FIGMA.dashed)
  })

  test('dash rounded sides with a one-value pattern, as dash and gap alike', () => {
    const rounded = sidesFrame({ cornerRadius: 24 }, 1)
    const values = renderRow(
      ck,
      renderer,
      (graph, hostId) => {
        rounded(graph, hostId)
        const frame = graph.getNode(expectDefined(graph.getNode(hostId)).childIds[0])
        if (frame) frame.strokes = frame.strokes.map((stroke) => ({ ...stroke, dashPattern: [10] }))
      },
      70,
      160,
      240
    )
    expect(values.filter((alpha) => alpha === 0).length).toBeGreaterThan(10)
    expect(values.filter((alpha) => alpha === 255).length).toBeGreaterThan(10)
  })

  test('take Figma’s corner radii: inner by each side, outer by the narrower side', () => {
    const node = createDefaultNode(() => 'frame', 'FRAME', {
      width: 160,
      height: 160,
      cornerRadius: 24,
      independentStrokeWeights: true,
      borderTopWeight: 4,
      borderRightWeight: 12,
      borderBottomWeight: 20,
      borderLeftWeight: 16
    })
    const { outer, inner } = sideStrokeRRects(node, 'CENTER')
    // Figma's strokeGeometry for this frame: outer corners of radius 26, 26, 30, and 32.
    expect([...outer]).toEqual([-8, -2, 166, 170, 26, 26, 26, 26, 30, 30, 32, 32])
    expect([...expectDefined(inner)]).toEqual([8, 2, 154, 150, 16, 22, 18, 22, 18, 14, 16, 14])
  })

  test('stretch the dash pattern to whole periods on each side', () => {
    const rounded = (spans: Array<[number, number]>) =>
      spans.map(([start, end]) => [Math.round(start * 100) / 100, Math.round(end * 100) / 100])
    expect(rounded(sideDashSpans(80, [20, 10]))).toEqual([
      [0, 8.89],
      [17.78, 35.56],
      [44.44, 62.22],
      [71.11, 80]
    ])
    expect(rounded(sideDashSpans(100, [30, 10]))).toEqual([
      [0, 12.5],
      [20.83, 45.83],
      [54.17, 79.17],
      [87.5, 100]
    ])
    expect(rounded(sideDashSpans(70, [10, 20]))).toEqual([
      [0, 5.83],
      [29.17, 40.83],
      [64.17, 70]
    ])
  })
})

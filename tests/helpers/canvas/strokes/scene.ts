import type { SceneGraph } from '@open-pencil/scene-graph'

const ALIGNS = ['INSIDE', 'CENTER', 'OUTSIDE'] as const
const CORNERS = [
  { name: 'sharp', cornerRadius: 0, dashPattern: undefined },
  { name: 'rounded', cornerRadius: 24, dashPattern: undefined },
  { name: 'dashed', cornerRadius: 0, dashPattern: [20, 10] }
]

/** Translucent frames with sides of their own weights: one row per alignment, sharp, rounded, and dashed. */
export function createSideStrokesScene(graph: SceneGraph, pageId: string): void {
  for (const [row, align] of ALIGNS.entries()) {
    for (const [column, corner] of CORNERS.entries()) {
      graph.createNode('FRAME', pageId, {
        name: `${align} ${corner.name}`,
        x: 60 + column * 200,
        y: 60 + row * 170,
        width: 140,
        height: 120,
        cornerRadius: corner.cornerRadius,
        fills: [],
        clipsContent: false,
        strokes: [
          {
            type: 'SOLID',
            color: { r: 0.23, g: 0.4, b: 0.95, a: 1 },
            opacity: 0.5,
            visible: true,
            weight: 8,
            align,
            dashPattern: corner.dashPattern
          }
        ],
        strokeWeight: 8,
        strokeAlign: align,
        independentStrokeWeights: true,
        borderTopWeight: 8,
        borderRightWeight: 0,
        borderBottomWeight: 16,
        borderLeftWeight: 4
      })
    }
  }
}

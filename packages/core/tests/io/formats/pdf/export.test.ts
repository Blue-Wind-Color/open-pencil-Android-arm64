import { expect, test } from 'bun:test'

import { SceneGraph } from '@open-pencil/scene-graph'

import { exportPDFDocument } from '#core/io/formats/pdf'

/** A page with a red square and a gradient, drawn without a browser DOM, as the CLI exports. */
function card() {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const frame = graph.createNode('FRAME', pageId, { name: 'Card', width: 120, height: 80 })
  graph.createNode('RECTANGLE', frame.id, {
    width: 40,
    height: 40,
    fills: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
  })
  graph.createNode('ELLIPSE', frame.id, {
    x: 60,
    width: 40,
    height: 40,
    fills: [
      {
        type: 'GRADIENT_LINEAR',
        color: { r: 0, g: 0, b: 0, a: 1 },
        opacity: 1,
        visible: true,
        gradientStops: [
          { position: 0, color: { r: 0, g: 0, b: 1, a: 1 } },
          { position: 1, color: { r: 0, g: 1, b: 0, a: 1 } }
        ],
        gradientTransform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 }
      }
    ]
  })
  return { graph, spec: { pageId, nodeIds: [frame.id], label: 'Card' } }
}

test('exports a PDF without a browser DOM, and leaves no DOM behind', async () => {
  const { graph, spec } = card()
  const result = await exportPDFDocument(graph, [spec], { embedFonts: false })
  expect(new TextDecoder().decode(result?.data.slice(0, 5))).toBe('%PDF-')
  expect(result?.pages).toEqual([{ label: 'Card', width: 120, height: 80 }])
  expect('document' in globalThis).toBe(false)
  expect('CSSStyleSheet' in globalThis).toBe(false)
})

test('exports several PDFs at once', async () => {
  const exports = Array.from({ length: 3 }, () => {
    const { graph, spec } = card()
    return exportPDFDocument(graph, [spec], { embedFonts: false })
  })
  const results = await Promise.all(exports)
  expect(results.map((result) => result?.pages.length)).toEqual([1, 1, 1])
  expect('document' in globalThis).toBe(false)
})

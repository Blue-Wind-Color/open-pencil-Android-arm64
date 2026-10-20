import { describe, expect, test } from 'bun:test'

import {
  createShapeWithText,
  createSticky,
  generatedFrameKind,
  generatedFrameText,
  layerResizes,
  layerRotates,
  SceneGraph,
  stickySublayers
} from '@open-pencil/scene-graph'

describe('generated frame kinds', () => {
  test('a sticky note edits its body in place, stays upright, and scales by its own handles', () => {
    const graph = new SceneGraph()
    const sticky = createSticky(graph, graph.getPages()[0].id, { text: 'Hi' })
    expect(generatedFrameText(graph, sticky)?.id).toBe(stickySublayers(graph, sticky)?.body.id)
    expect([layerRotates(sticky), layerResizes(sticky)]).toEqual([false, false])
    expect(generatedFrameKind(sticky)?.namedByText).toBe(true)
    expect(generatedFrameKind(sticky)?.complete(graph, sticky)).toBe(true)
  })

  test("a size set outside layout is a shape's given size, which layout's own writes leave", () => {
    const graph = new SceneGraph()
    const shape = createShapeWithText(graph, graph.getPages()[0].id, { width: 200, height: 100 })
    graph.updateNode(shape.id, { width: 320 })
    expect(graph.getNode(shape.id)).toMatchObject({ shapeUserWidth: 320, shapeUserHeight: 100 })
    graph.updateNodePreview(shape.id, { height: 140 })
    expect(graph.getNode(shape.id)?.shapeUserHeight).toBe(140)
    // A write that carries the given size itself, as an undo does, keeps it.
    graph.updateNode(shape.id, { width: 400, shapeUserWidth: 320 })
    expect(graph.getNode(shape.id)?.shapeUserWidth).toBe(320)
    graph.withLayoutMutations(() => graph.updateNode(shape.id, { width: 500 }))
    expect(graph.getNode(shape.id)?.shapeUserWidth).toBe(320)
  })

  test('any other layer has no kind and turns and resizes freely', () => {
    const rectangle = { type: 'RECTANGLE' as const }
    expect(generatedFrameKind(rectangle)).toBeUndefined()
    expect([layerRotates(rectangle), layerResizes(rectangle)]).toEqual([true, true])
  })
})

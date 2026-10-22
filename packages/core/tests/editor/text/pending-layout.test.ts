import { afterEach, expect, test } from 'bun:test'

import { createEditor } from '@open-pencil/core'
import { setTextMeasurer } from '@open-pencil/core/layout'

import {
  createPendingTextLayout,
  type PendingLayoutRenderer
} from '#core/editor/text/pending-layout'
import { createLayoutRunner } from '#core/layout/mutations'

afterEach(() => {
  setTextMeasurer(null)
})

/** A Hug row around auto-width text whose face loads after the first layout. */
function setup() {
  const editor = createEditor()
  const graph = editor.graph
  const frame = graph.createNode('FRAME', editor.state.currentPageId, {
    layoutMode: 'HORIZONTAL',
    primaryAxisSizing: 'HUG',
    counterAxisSizing: 'HUG',
    paddingLeft: 16,
    paddingRight: 16,
    paddingTop: 12,
    paddingBottom: 12
  })
  const text = graph.createNode('TEXT', frame.id, {
    text: 'Weighted label',
    fontWeight: 900,
    textAutoResize: 'WIDTH_AND_HEIGHT'
  })
  let loaded = false
  const renderer: PendingLayoutRenderer = {
    fontsLoaded: true,
    measureTextNode: () => (loaded ? { width: 234, height: 29 } : null)
  }
  const { runLayoutForNode } = createLayoutRunner(() => graph)
  let renders = 0
  /** Whether each layout the pending text ran was the document's own. */
  const relayouts: boolean[] = []
  const pending = createPendingTextLayout({
    getGraph: () => graph,
    runLayoutForNode: (id) => {
      relayouts.push(graph.isApplyingDerivedLayout)
      runLayoutForNode(id)
    },
    requestRender: () => renders++,
    isReady: () => loaded
  })
  setTextMeasurer((node, maxWidth) => pending.measure(renderer, node, maxWidth))
  const load = () => {
    loaded = true
    pending.relayoutReady(renderer)
  }
  return {
    editor,
    graph,
    frame,
    text,
    renderer,
    pending,
    runLayoutForNode,
    load,
    relayouts,
    renders: () => renders
  }
}

test('text laid out before its face loads takes its size, and its Hug frame follows', () => {
  const { editor, frame, text, runLayoutForNode, load, relayouts, renders } = setup()
  runLayoutForNode(text.id)
  const estimated = text.width
  expect(estimated).not.toBe(234)

  load()
  expect([text.width, text.height]).toEqual([234, 29])
  expect([frame.width, frame.height]).toEqual([266, 53])
  expect(renders()).toBe(1)
  expect(relayouts).toEqual([false])
  expect(editor.undo.canUndo).toBe(false)
})

test('a face that loads keeps the layout of the document’s own state derived', () => {
  const { graph, text, runLayoutForNode, load, relayouts } = setup()
  graph.applyDerivedLayoutDuring(() => runLayoutForNode(text.id))
  load()
  expect(text.width).toBe(234)
  expect(relayouts).toEqual([true])
})

test('layers whose faces are still loading or that were removed are left alone', () => {
  const { graph, text, pending, renderer, runLayoutForNode, renders } = setup()
  runLayoutForNode(text.id)
  pending.relayoutReady(renderer)
  expect(renders()).toBe(0)
  graph.deleteNode(text.id)
  pending.relayoutReady(renderer)
  expect(renders()).toBe(0)
})

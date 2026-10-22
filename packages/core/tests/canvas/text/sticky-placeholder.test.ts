import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { SceneGraph } from '@open-pencil/scene-graph'
import { createSticky, stickySublayers } from '@open-pencil/scene-graph/generated'

import { stickyPlaceholderNode } from '#core/canvas/text/sticky-placeholder'

function emptyNote() {
  const graph = new SceneGraph()
  const sticky = createSticky(graph, graph.getPages()[0].id, { author: 'Ada' })
  return { graph, ...expectDefined(stickySublayers(graph, sticky)) }
}

describe('sticky note placeholder', () => {
  test("an empty body shows the canvas's placeholder, in the body's style at 30% black", () => {
    const { graph, body } = emptyNote()
    const drawn = expectDefined(stickyPlaceholderNode(graph, body, 'Пишите что угодно'))
    expect(drawn).toMatchObject({ text: 'Пишите что угодно', fontSize: 16, lineHeight: 24 })
    expect(drawn.fills[0]).toMatchObject({ opacity: 0.3, color: { r: 0, g: 0, b: 0 } })
    expect(body.text).toBe('')
  })

  test('a canvas without a placeholder, such as an export, draws none', () => {
    const { graph, body } = emptyNote()
    expect(stickyPlaceholderNode(graph, body, null)).toBeNull()
  })

  test('the author line and a body with text show no placeholder', () => {
    const { graph, body, author } = emptyNote()
    expect(stickyPlaceholderNode(graph, author, 'Type anything')).toBeNull()
    graph.updateNode(body.id, { text: 'Hello' })
    expect(
      stickyPlaceholderNode(graph, expectDefined(graph.getNode(body.id)), 'Type anything')
    ).toBeNull()
  })
})

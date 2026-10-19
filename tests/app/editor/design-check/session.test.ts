import { afterEach, describe, expect, jest, test } from 'bun:test'

import { nextTick, watch } from 'vue'

import { SceneGraph } from '@open-pencil/scene-graph'

import { createEditorStore } from '@/app/editor/session'

const stores: ReturnType<typeof createEditorStore>[] = []
afterEach(() => {
  for (const store of stores.splice(0)) store.dispose()
  jest.useRealTimers()
})

/** Two pages, each with text small enough for the design check to mark on the canvas. */
function twoPagesWithIssues() {
  const graph = new SceneGraph()
  const first = graph.getPages()[0]
  const second = graph.addPage('Second')
  const [firstText, secondText] = [first, second].map((page) =>
    graph.createNode('TEXT', page.id, { name: 'Caption', text: 'Caption', fontSize: 8 })
  )
  const store = createEditorStore(graph)
  stores.push(store)
  const checkedPages: string[] = []
  watch(
    store.designCheck.snapshot,
    (snapshot) => {
      if (snapshot) checkedPages.push(snapshot.pageId)
    },
    { flush: 'sync' }
  )
  const markedNodes = () => (store.state.designIssues?.markers ?? []).map((m) => m.nodeId)
  return { store, first, second, firstText, secondText, checkedPages, markedNodes }
}

describe('the design check across a page switch', () => {
  test('checks the new page once, after the switch', async () => {
    jest.useFakeTimers()
    const { store, first, second, firstText, secondText, checkedPages, markedNodes } =
      twoPagesWithIssues()
    expect(store.designCheck.snapshot.value?.pageId).toBe(first.id)
    expect(markedNodes()).toEqual([firstText.id])

    // The editor's own switch; the app's adds a progress overlay with timers of its own.
    const prepared = await store.preparePage(second.id)
    if (prepared) store.commitPageSwitch(prepared)
    expect(store.state.currentPageId).toBe(second.id)
    await nextTick()
    // The previous page's markers would point at layers that are no longer shown.
    expect(markedNodes()).toEqual([])
    expect(checkedPages).toEqual([])

    jest.advanceTimersByTime(1000)
    await nextTick()
    expect(checkedPages).toEqual([second.id])
    expect(markedNodes()).toEqual([secondText.id])
  })

  test('opening an issue on another page checks that page right away', async () => {
    jest.useFakeTimers()
    const { store, second, secondText, checkedPages } = twoPagesWithIssues()
    const issue = {
      id: `min-text-size:${secondText.id}:0`,
      ruleId: 'min-text-size',
      nodeId: secondText.id,
      pageId: second.id,
      severity: 'warning' as const,
      message: '',
      nodeName: 'Caption',
      nodePath: ['Caption']
    }

    await store.designCheck.openIssue(issue)

    // The Lint panel focuses the issue's row, which needs the new page's issues already.
    expect(checkedPages).toEqual([second.id])
    expect(store.designCheck.snapshot.value?.issues.map(({ id }) => id)).toContain(issue.id)
    expect(store.designCheck.focusedIssueId.value).toBe(issue.id)
  })
})

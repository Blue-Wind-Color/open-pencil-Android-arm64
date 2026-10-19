import { expect, test, useEditorSetup } from '#tests/e2e/fixtures'

const editor = useEditorSetup('/?test&no-chrome&no-rulers')

test('renders imported text on a path with its selection overlay', async () => {
  test.setTimeout(90_000)
  await editor.page.evaluate(() => window.openPencil?.openFile?.('/tests/fixtures/circle-text.fig'))
  await editor.canvas.waitForRender()

  const selected = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const node = [...store.graph.getAllNodes()].find(
      (candidate) => candidate.name === 'ArnoCoenen.art'
    )
    if (!node) return false
    store.select([node.id])
    store.zoomToSelection()
    store.requestRender()
    return true
  })
  expect(selected).toBe(true)
  await editor.canvas.waitForRender()
  editor.canvas.assertNoErrors()

  const buffer = await editor.canvas.screenshotCanvasRegion()
  expect(buffer).toMatchSnapshot('text-path-rendering-and-selection.png')
})

test('selects characters along text on a path while editing it', async () => {
  test.setTimeout(90_000)
  await editor.page.evaluate(() => window.openPencil?.openFile?.('/tests/fixtures/circle-text.fig'))
  await editor.canvas.waitForRender()

  const selection = await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('OpenPencil store not initialized')
    const node = [...store.graph.getAllNodes()].find(
      (candidate) => candidate.name === 'ArnoCoenen.art'
    )
    if (!node) return null
    store.select([node.id])
    store.zoomToSelection()
    store.startTextEditing(node.id)
    const text = store.textEditor
    if (!text) return null
    text.selectWord(0)
    store.textSelectionChanged()
    store.requestRender()
    return text.getSelectionRange()
  })
  expect(selection).toEqual([0, 10])
  await editor.canvas.waitForRender()
  editor.canvas.assertNoErrors()

  const buffer = await editor.canvas.screenshotCanvasRegion()
  expect(buffer).toMatchSnapshot('text-path-editing-selection.png')
})

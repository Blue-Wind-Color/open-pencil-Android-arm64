import { readFile } from 'node:fs/promises'

import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'
import { pasteFigmaClipboard } from '#tests/helpers/canvas/figma-paste'
import { layerDriver } from '#tests/helpers/canvas/layers'

const editor = useEditorSetupWithClear('/?test&no-chrome&no-rulers')
const layers = layerDriver(() => editor.page)

test('FigJam connectors draw their elbows, curve, caps, dashes, and label as Figma routed them', async () => {
  const html = await readFile('tests/fixtures/clipboard/figjam-connectors.html', 'utf8')
  await pasteFigmaClipboard(editor.page, html)
  await editor.canvas.waitForRender()
  editor.canvas.assertNoErrors()
  expect(await editor.canvas.screenshotCanvasRegion()).toMatchSnapshot('figjam-connectors.png')
})

test('dragging a sticky routes the connectors attached to it again', async () => {
  const html = await readFile('tests/fixtures/clipboard/figjam-connectors.html', 'utf8')
  await pasteFigmaClipboard(editor.page, html)
  await editor.canvas.waitForRender()
  const center = await layers.screenCenter('c-B')
  await editor.canvas.drag(center.x, center.y, center.x - 260, center.y - 120)
  await layers.clearSelection()
  await editor.canvas.waitForRender()
  editor.canvas.assertNoErrors()
  expect(await editor.canvas.screenshotCanvasRegion()).toMatchSnapshot(
    'figjam-connectors-moved.png'
  )
})

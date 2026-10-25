import { expect, test, useEditorSetupWithClear } from '#tests/e2e/fixtures'

const editor = useEditorSetupWithClear('/?test&no-chrome&no-rulers')

test('places lines of mixed sizes as Figma does', async () => {
  await editor.page.evaluate(() => {
    const store = window.openPencil?.getStore?.()
    if (!store) throw new Error('Missing editor')
    const big = (start: number, length: number) => ({ start, length, style: { fontSize: 36 } })
    const wrapping = 'Small words LARGE then wraps onto more lines'
    const texts = [
      { x: 40, y: 40, text: wrapping, styleRuns: [big(12, 5)] },
      { x: 280, y: 40, text: wrapping, styleRuns: [big(12, 5)], textAlignHorizontal: 'CENTER' },
      {
        x: 520,
        y: 40,
        text: wrapping,
        styleRuns: [big(12, 5)],
        textAlignHorizontal: 'JUSTIFIED'
      },
      {
        x: 40,
        y: 220,
        text: 'one\ntwo with a tall line\nthree',
        styleRuns: [{ start: 4, length: 20, style: { lineHeight: { value: 48, unit: 'PIXELS' } } }]
      },
      {
        x: 280,
        y: 220,
        text: 'Small LARGE\nunder a fixed line height',
        lineHeight: { value: 24, unit: 'PIXELS' },
        styleRuns: [big(6, 5)]
      },
      {
        x: 520,
        y: 220,
        text: 'First item\nSecond BIG item wraps\nThird',
        styleRuns: [big(18, 3)],
        paragraphSpacing: 8,
        textDecoration: 'UNDERLINE',
        textParagraphs: [
          { listType: 'UNORDERED', indentation: 1 },
          { listType: 'UNORDERED', indentation: 1 },
          { listType: 'UNORDERED', indentation: 1 }
        ]
      }
    ] as const
    for (const props of texts) {
      store.graph.createNode('TEXT', store.state.currentPageId, {
        width: 200,
        height: 160,
        fontFamily: 'Inter',
        fontSize: 18,
        lineHeight: null,
        textAutoResize: 'HEIGHT',
        ...props,
        styleRuns: [...props.styleRuns],
        textParagraphs: 'textParagraphs' in props ? [...props.textParagraphs] : []
      })
    }
    store.requestRender()
  })
  await editor.page.waitForFunction(() => {
    const store = window.openPencil?.getStore?.()
    return (
      store?.graph.getChildren(store.state.currentPageId).filter((node) => node.type === 'TEXT')
        .length === 6
    )
  })
  await editor.page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
  )
  expect(await editor.canvas.screenshotCanvasRegion()).toMatchSnapshot('text-lines.png')
})

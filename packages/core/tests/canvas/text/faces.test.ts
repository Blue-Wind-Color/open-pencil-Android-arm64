import { describe, expect, test } from 'bun:test'

import type { CanvasKit, TypefaceFontProvider } from 'canvaskit-wasm'

import { expectDefined } from '#core-tests/helpers/assert'

import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { SceneGraph } from '@open-pencil/scene-graph'

import { buildParagraph } from '#core/canvas/text'
import { withFigExportRuntime } from '#core/canvas/text/shape'
import { getCanvasKit } from '#core/canvaskit'
import { FontManager, fontManager } from '#core/text/fonts'
import { glyphOutlineSourceSync } from '#core/text/opentype'

/** A family only these tests load, so faces other tests load cannot answer for it. */
const FAMILY = 'Faces Test Sans'

async function bundled(file: string): Promise<ArrayBuffer> {
  return expectDefined(await new FontManager().fetchBundledFont(file), file)
}

/** The pixels of text in a style, drawn by the paragraph the canvas draws. */
function drawn(
  ck: CanvasKit,
  fontProvider: TypefaceFontProvider,
  style: { fontWeight: number; italic: boolean }
): Uint8Array {
  const node = createDefaultNode(() => 'face-text', 'TEXT', {
    text: 'Faces',
    fontFamily: FAMILY,
    fontSize: 40,
    width: 300,
    height: 60,
    ...style
  })
  const paragraph = buildParagraph({ ck, fontProvider, fontsLoaded: true }, node, ck.BLACK, {
    halfLeading: true
  })
  const surface = expectDefined(ck.MakeSurface(300, 60), 'surface')
  try {
    surface.getCanvas().clear(ck.WHITE)
    paragraph.layout(300)
    paragraph.draw(surface.getCanvas(), 0, 0)
    return expectDefined(
      surface.getCanvas().readPixels(0, 0, { width: 300, height: 60, colorType: ck.ColorType.RGBA_8888, alphaType: ck.AlphaType.Unpremul, colorSpace: ck.ColorSpace.SRGB }),
      'pixels'
    ) as Uint8Array
  } finally {
    surface.delete()
  }
}

/**
 * Asked for a face a family has not loaded, CanvasKit would slant or embolden another, which
 * neither Figma, a browser, nor a native text stack draws the same. Figma draws a missing face as
 * the face that exists and reports it missing; so does the canvas.
 */
describe('text faces', () => {
  test('draws a missing face as the loaded one rather than faking it', async () => {
    const ck = await getCanvasKit()
    const fontProvider = ck.TypefaceFontProvider.Make()
    fontManager.attachProvider(ck, fontProvider)
    fontManager.markLoaded(FAMILY, 'Regular', await bundled('/Inter-Regular.ttf'))
    const regular = drawn(ck, fontProvider, { fontWeight: 400, italic: false })
    expect(drawn(ck, fontProvider, { fontWeight: 400, italic: true })).toEqual(regular)
    expect(drawn(ck, fontProvider, { fontWeight: 700, italic: false })).toEqual(regular)
  })

  test('draws a face the family has loaded', async () => {
    const ck = await getCanvasKit()
    const fontProvider = ck.TypefaceFontProvider.Make()
    fontManager.attachProvider(ck, fontProvider)
    fontManager.markLoaded(FAMILY, 'Regular', await bundled('/Inter-Regular.ttf'))
    fontManager.markLoaded(FAMILY, 'Bold', await bundled('/Inter-Bold.ttf'))
    const regular = drawn(ck, fontProvider, { fontWeight: 400, italic: false })
    expect(drawn(ck, fontProvider, { fontWeight: 700, italic: false })).not.toEqual(regular)
  })

  /**
   * One face for the whole text: a family without the requested face draws its own, and the
   * characters it lacks fall back in that same face, which is the outline saved for them.
   */
  test('saves fallback characters in the face the text is drawn in', async () => {
    const primary = 'Faces Test Naskh'
    fontManager.markLoaded(primary, 'Regular', await bundled('/NotoNaskhArabic-Regular.ttf'))
    fontManager.markLoaded('Inter', 'Regular', await bundled('/Inter-Regular.ttf'))
    fontManager.markLoaded('Inter', 'Bold', await bundled('/Inter-Bold.ttf'))
    const graph = new SceneGraph()
    const node = graph.createNode('TEXT', graph.getPages()[0].id, {
      text: 'F',
      fontFamily: primary,
      fontWeight: 700,
      fontSize: 40,
      width: 200,
      height: 60,
      textAutoResize: 'NONE'
    })
    const shaped = expectDefined(
      await withFigExportRuntime(graph, await getCanvasKit(), async (runtime) =>
        runtime.shapeText(node)
      ),
      'shaped text'
    )
    const regular = expectDefined(glyphOutlineSourceSync('Inter', 'Regular'), 'Inter Regular')
    expect(shaped.glyphs[0]?.commands).toEqual(regular.outline(regular.glyphOf('F'), 40))
  })
})

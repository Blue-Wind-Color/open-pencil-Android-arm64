import { beforeAll, describe, expect, test } from 'bun:test'

import { join } from 'node:path'

import { expectDefined } from '#core-tests/helpers/assert'
import { FIXTURES } from '#core-tests/helpers/paths'

import type { ShapedText } from '@open-pencil/fig/node-change'
import { SceneGraph } from '@open-pencil/scene-graph'
import type { SceneNode } from '@open-pencil/scene-graph'

import { withFigExportRuntime } from '#core/canvas/text/shape'
import { getCanvasKit } from '#core/canvaskit'
import { EMOJI_METRICS_FAMILY } from '#core/text/emoji'
import { fontManager } from '#core/text/fonts'
import { getGlyphOutlineMetricsSync } from '#core/text/opentype'

const testFont = (name: string) => join(FIXTURES, 'fonts', name)

const SENTENCE = 'A sentence long enough that it has to wrap onto a second line.'

async function shape(props: Partial<SceneNode>): Promise<ShapedText | null> {
  const graph = new SceneGraph()
  const node = graph.createNode('TEXT', graph.getPages()[0].id, {
    fontFamily: 'Inter',
    fontSize: 13,
    lineHeight: 16,
    width: 230,
    height: 32,
    textAutoResize: 'HEIGHT',
    ...props
  })
  return withFigExportRuntime(graph, await getCanvasKit(), async (runtime) =>
    runtime.shapeText(node)
  )
}

describe('text shaping for saved glyphs', () => {
  beforeAll(async () => {
    const inter = expectDefined(
      await fontManager.fetchBundledFont('/Inter-Regular.ttf'),
      'bundled Inter font'
    )
    fontManager.markLoaded('Inter', 'Regular', inter)
  })

  /**
   * Figma saves every emoji as a 1 em square, a joined sequence or a flag as one: the layout
   * falls back to the emoji metrics font for them, which gives them that width.
   */
  test('lays an emoji out 1 em wide, a joined sequence and a flag as one', async () => {
    const metrics = expectDefined(
      await fontManager.fetchBundledFont('/OpenPencilEmojiMetrics-Regular.ttf'),
      'bundled emoji metrics font'
    )
    fontManager.markLoaded(EMOJI_METRICS_FAMILY, 'Regular', metrics)
    const family = '👨‍👩‍👧‍👦'
    const shaped = expectDefined(
      await shape({ text: `a😀${family}🇺🇸b`, fontSize: 40, width: 400, textAutoResize: 'NONE' }),
      'shaped text'
    )
    const advance = (character: number) =>
      shaped.glyphs.find((glyph) => glyph.firstCharacter === character)?.advance
    expect([advance(1), advance(3), advance(3 + family.length)]).toEqual([40, 40, 40])
  })

  test('breaks lines at the layer width (#914)', async () => {
    const shaped = expectDefined(await shape({ text: SENTENCE }), 'shaped text')
    const [first, second] = shaped.baselines

    expect(shaped.baselines).toHaveLength(2)
    expect(second.firstCharacter).toBe(first.endCharacter)
    expect(second.position.y - first.position.y).toBe(16)
    for (const glyph of shaped.glyphs) {
      expect(glyph.x + glyph.advance).toBeLessThanOrEqual(230.5)
      expect([first.position.y, second.position.y]).toContain(glyph.y)
    }
    expect(shaped.logicalIndexToCharacterOffsetMap).toHaveLength(SENTENCE.length)
    expect(shaped.logicalIndexToCharacterOffsetMap[second.firstCharacter]).toBe(0)
  })

  test('saves text with blank lines and a closing newline, which shaping leaves out', async () => {
    // Figma draws pasted text only from its saved glyphs, so a text without them is blank.
    const blank = expectDefined(await shape({ text: 'one\n\nthree' }), 'text with a blank line')
    expect(blank.baselines.map((line) => [line.firstCharacter, line.endCharacter])).toEqual([
      [0, 4],
      [4, 5],
      [5, 10]
    ])
    const [first, , third] = blank.baselines.map((line) => line.position.y)
    expect(blank.glyphs.map((glyph) => [glyph.firstCharacter, glyph.y])).toEqual([
      [0, first],
      [1, first],
      [2, first],
      [5, third],
      [6, third],
      [7, third],
      [8, third],
      [9, third]
    ])

    const closing = expectDefined(await shape({ text: 'one\n' }), 'text ending in a newline')
    expect(closing.baselines).toHaveLength(2)
    expect(closing.glyphs).toHaveLength(3)
  })

  test('places lines by horizontal and vertical alignment', async () => {
    const top = expectDefined(await shape({ text: 'Centered', height: 64 }), 'top')
    const centered = expectDefined(
      await shape({
        text: 'Centered',
        height: 64,
        textAlignHorizontal: 'CENTER',
        textAlignVertical: 'CENTER'
      }),
      'centered'
    )
    const line = centered.baselines[0]

    expect(line.position.x).toBeCloseTo((230 - line.width) / 2, 1)
    expect(centered.glyphs[0].x).toBeCloseTo(line.position.x, 3)
    expect(line.position.y - top.baselines[0].position.y).toBe(24)
  })

  test('draws each glyph the shaper chose, such as a contextual arrow', async () => {
    const shaped = expectDefined(await shape({ text: 'a->b' }), 'shaped text')
    const arrow = expectDefined(
      shaped.glyphs.find((glyph) => glyph.firstCharacter === 1),
      'arrow glyph'
    )
    const hyphen = expectDefined(getGlyphOutlineMetricsSync('Inter', 'Regular', '-', 13)?.[0])

    expect(shaped.glyphs).toHaveLength(3)
    expect(arrow.commands).not.toEqual(hyphen.commands)
    expect(shaped.logicalIndexToCharacterOffsetMap[2]).toBe(arrow.x)
  })

  test('outlines text whose font is not loaded in the font that drew it instead', async () => {
    // The canvas draws it in the default font, and Figma shows nothing for glyphs without outlines.
    const shaped = expectDefined(
      await shape({ text: 'Missing', fontFamily: 'Missing Font' }),
      'shaped text'
    )
    const first = expectDefined(shaped.glyphs[0]?.commands, 'outline')

    expect(shaped.glyphs.every((glyph) => glyph.commands !== null)).toBe(true)
    expect(first).toEqual(
      expectDefined(getGlyphOutlineMetricsSync('Inter', 'Regular', 'M', 13)?.[0]).commands
    )
  })

  test('keeps outlines for decorations across lines, which Figma draws from saved rects', async () => {
    const shaped = expectDefined(
      await shape({ text: SENTENCE, textDecoration: 'UNDERLINE' }),
      'shaped text'
    )

    expect(shaped.baselines).toHaveLength(2)
    expect(shaped.glyphs.every((glyph) => glyph.commands !== null)).toBe(true)
  })

  test('saves truncated text as the characters it shows and the ellipsis after them', async () => {
    // Figma draws pasted text only from its saved glyphs, so truncated text needs them too.
    const shaped = expectDefined(
      await shape({ text: SENTENCE, textTruncation: 'ENDING', height: 16, textAutoResize: 'NONE' }),
      'shaped text'
    )
    const ellipsis = expectDefined(shaped.glyphs.at(-1), 'ellipsis')

    expect(shaped.baselines).toHaveLength(1)
    expect(shaped.glyphs.every((glyph) => glyph.commands !== null)).toBe(true)
    expect(ellipsis.firstCharacter).toBeUndefined()
    const shown = shaped.glyphs.slice(0, -1)
    expect(shown.every((glyph) => (glyph.firstCharacter ?? Infinity) < SENTENCE.length)).toBe(true)
  })

  test('outlines characters a fallback font draws from that font', async () => {
    const fallbackFamilies = fontManager.getCJKFallbackFamilies()
    const originalFallbacks = [...fallbackFamilies]
    fallbackFamilies.length = 0
    try {
      const cjk = await Bun.file(testFont('NotoSansCJK-Test.otf')).arrayBuffer()
      fontManager.markLoaded('Shape Test CJK', 'Regular', cjk)
      fontManager.setCJKFallbackFamily('Shape Test CJK')
      const shaped = expectDefined(await shape({ text: 'Hi 你好' }), 'shaped text')
      const ni = expectDefined(
        shaped.glyphs.find((glyph) => glyph.firstCharacter === 3),
        'glyph of 你'
      )

      expect(shaped.glyphs.every((glyph) => glyph.commands !== null)).toBe(true)
      expect(ni.commands).toEqual(
        expectDefined(getGlyphOutlineMetricsSync('Shape Test CJK', 'Regular', '你', 13)?.[0])
          .commands
      )
    } finally {
      fallbackFamilies.splice(0, fallbackFamilies.length, ...originalFallbacks)
    }
  })

  test('outlines a variable font at the instance the text is set in', async () => {
    const variable = await Bun.file(testFont('InterVariable-Latin.ttf')).arrayBuffer()
    fontManager.markLoaded('Shape Test Variable', 'Bold', variable)
    const shaped = expectDefined(
      await shape({ text: 'l', fontFamily: 'Shape Test Variable', fontWeight: 700 }),
      'shaped text'
    )
    const bold = expectDefined(shaped.glyphs[0]?.commands, 'bold outline')
    const regular = expectDefined(
      getGlyphOutlineMetricsSync('Shape Test Variable', 'Bold', 'l', 13)?.[0]
    ).commands

    // The default instance is the regular weight; the bold stem is wider.
    const width = (commands: readonly { x?: number }[]) => {
      const xs = commands.flatMap((command) => (command.x === undefined ? [] : [command.x]))
      return Math.max(...xs) - Math.min(...xs)
    }
    expect(width(bold)).toBeGreaterThan(width(regular) * 1.2)
  })
})

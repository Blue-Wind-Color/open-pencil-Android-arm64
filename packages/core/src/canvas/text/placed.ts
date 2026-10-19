import type { Paragraph } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'

import { resolveParagraphFontFamilies } from '#core/canvas/text/font-families'
import type { TextLayout, TextLayoutMarker } from '#core/canvas/text/layout'
import { textFontVariations } from '#core/canvas/text/paragraph'
import { utf16IndicesByUtf8 } from '#core/canvas/text/utf8'
import { fontManager, fontWeightMatchOrder, weightToStyle } from '#core/text/fonts'
import { glyphOutlineSourceSync, type GlyphOutlineSource } from '#core/text/opentype'

type GlyphRun = ReturnType<Paragraph['getShapedLines']>[number]['runs'][number]

/** A glyph of laid-out text where the renderer draws it, with the font its outline comes from. */
export interface LaidOutGlyph {
  /** The glyph ID the shaper chose. */
  id: number
  x: number
  /** The baseline of its line. */
  y: number
  fontSize: number
  /** The character it draws, left out for a list marker. */
  firstCharacter?: number
  advance: number
  /** Where its line starts. */
  lineLeft: number
  /** The font that drew it, or `null` when the shaper may have used another. */
  source: GlyphOutlineSource | null
}

/**
 * The loaded face of a family the paragraph draws a style in: the style itself, or the nearest
 * loaded weight in the same slant, then the other, as font matching picks it.
 */
function loadedStyle(family: string, weight: number, italic: boolean): string | null {
  for (const slant of [italic, !italic]) {
    for (const candidate of fontWeightMatchOrder(weight)) {
      const style = weightToStyle(candidate, slant)
      if (fontManager.isStyleLoaded(family, style)) return style
    }
  }
  return null
}

/** The font a character asks for: its family, weight, and slant, and the variable axes it sets. */
function fontAt(node: SceneNode, index: number) {
  const run = node.styleRuns.find((item) => index >= item.start && index < item.start + item.length)
  const family = run?.style.fontFamily ?? node.fontFamily
  const weight = run?.style.fontWeight ?? node.fontWeight
  const italic = run?.style.italic ?? node.italic
  const style = weightToStyle(weight, italic)
  const variations =
    textFontVariations(
      run?.style.fontVariations ?? node.fontVariations,
      fontManager.namedInstanceVariations(family, style)
    ) ?? []
  return { family, weight, italic, style, variations }
}

/** The outline source of each font the paragraph may have drawn a character in, in its order. */
function* candidateSources(font: ReturnType<typeof fontAt>) {
  for (const family of resolveParagraphFontFamilies(font.family, font.style)) {
    const style = loadedStyle(family, font.weight, font.italic)
    const source = style ? glyphOutlineSourceSync(family, style, font.variations) : null
    if (source) yield source
  }
}

/**
 * The family the paragraph draws the character at `index` of `text` in, as it falls back: the
 * first of the fonts it lists, the style's own then its fallbacks, that maps the character.
 */
export function characterFamily(node: SceneNode, text: string, index: number): string | null {
  const codePoint = text.codePointAt(index)
  if (codePoint === undefined) return null
  const character = String.fromCodePoint(codePoint)
  const font = fontAt(node, index)
  for (const family of resolveParagraphFontFamilies(font.family, font.style)) {
    const style = loadedStyle(family, font.weight, font.italic)
    if (style && glyphOutlineSourceSync(family, style, font.variations)?.covers(character))
      return family
  }
  return null
}

/** Whether a glyph the shaper chose is the one the font maps its character to. */
function drawsOwnGlyph(
  source: GlyphOutlineSource,
  run: GlyphRun,
  text: string,
  characterAt: (offset: number) => number
): boolean {
  for (let index = 0; index < run.glyphs.length; index++) {
    const start = characterAt(run.offsets[index])
    const end = characterAt(run.offsets[index + 1])
    // A glyph for one character, not a ligature or a cluster, maps straight from it.
    if (end - start !== 1 || /\s/.test(text[start])) continue
    if (source.glyphOf(text[start]) === run.glyphs[index]) return true
  }
  return false
}

/**
 * The font a run was shaped with. CanvasKit leaves `GlyphRun.typeface` null, so the run's font
 * is found as the paragraph falls back: the first of the fonts it lists, the style's own then
 * its fallbacks, that has every character of the run, confirmed by the glyph IDs it chose.
 * Glyphs CanvasKit emboldened or slanted itself match no font's outlines.
 */
function runOutlineSource(
  node: SceneNode,
  text: string,
  run: GlyphRun,
  characterAt: (offset: number) => number
): GlyphOutlineSource | null {
  if (run.fakeBold || run.fakeItalic || run.glyphs.length === 0) return null
  const offsets = Array.from(run.offsets, characterAt)
  const start = Math.min(...offsets)
  const end = Math.max(...offsets)
  const characters = text.slice(start, end).replace(/\s/g, '')
  for (const source of candidateSources(fontAt(node, start))) {
    if (!source.covers(characters)) continue
    if (characters === '' || drawsOwnGlyph(source, run, text, characterAt)) return source
  }
  return null
}

/** What truncated text ends in, as the paragraph builds it. */
const ELLIPSIS = '…'

/**
 * The font of the ellipsis that ends truncated text, when the run is that ellipsis: the
 * paragraph adds it after the last characters shown, from the first font that maps it.
 */
function ellipsisSource(
  node: SceneNode,
  run: GlyphRun,
  characterAt: (offset: number) => number
): GlyphOutlineSource | null {
  if (run.glyphs.length !== 1 || run.fakeBold || run.fakeItalic) return null
  for (const source of candidateSources(fontAt(node, characterAt(run.offsets[0])))) {
    if (source.glyphOf(ELLIPSIS) === run.glyphs[0]) return source
  }
  return null
}

/**
 * A list marker's glyphs as Figma saves them: placed beside their item and drawing no
 * character of the text.
 */
function markerGlyphs(marker: TextLayoutMarker, offsetY: number): LaidOutGlyph[] {
  const source = glyphOutlineSourceSync(marker.face.family, marker.face.style)
  const baseline = marker.paragraph.getLineMetrics().at(0)?.baseline ?? 0
  const glyphs: LaidOutGlyph[] = []
  for (const line of marker.paragraph.getShapedLines()) {
    for (const run of line.runs) {
      const trusted = !run.fakeBold && !run.fakeItalic
      for (let index = 0; index < run.glyphs.length; index++) {
        const x = run.positions[index * 2]
        glyphs.push({
          id: run.glyphs[index],
          x: marker.x + x,
          y: marker.y + baseline + offsetY,
          fontSize: run.size,
          advance: run.positions[(index + 1) * 2] - x,
          lineLeft: marker.x,
          source: trusted ? source : null
        })
      }
    }
  }
  return glyphs
}

/**
 * Every glyph of laid-out `text`, `offsetY` below the layout's top, in drawing order: an item's
 * marker before the glyphs of its first line, as Figma saves them. Returns `null` when the
 * layout's lines do not match its shaped lines.
 */
export function laidOutGlyphs(
  node: SceneNode,
  layout: TextLayout,
  text: string,
  offsetY: number
): LaidOutGlyph[] | null {
  const lines = layout.getShapedLines()
  const metrics = layout.getLineMetrics()
  if (lines.length === 0 || lines.length !== metrics.length) return null
  const characterAt = utf16IndicesByUtf8(text)
  const markers = new Map(layout.getMarkers().map((marker) => [marker.lineNumber, marker]))
  const glyphs: LaidOutGlyph[] = []
  for (const [lineIndex, line] of lines.entries()) {
    const marker = markers.get(lineIndex)
    if (marker) glyphs.push(...markerGlyphs(marker, offsetY))
    const { left, baseline } = metrics[lineIndex]
    const lastLine = lineIndex === lines.length - 1
    for (const [runIndex, run] of line.runs.entries()) {
      const ellipsis =
        lastLine && runIndex === line.runs.length - 1 && layout.didExceedMaxLines()
          ? ellipsisSource(node, run, characterAt)
          : null
      const source = ellipsis ?? runOutlineSource(node, text, run, characterAt)
      for (let index = 0; index < run.glyphs.length; index++) {
        const x = run.positions[index * 2]
        glyphs.push({
          id: run.glyphs[index],
          x,
          // Run positions round the baseline to whole pixels; line metrics keep it exact.
          y: baseline + offsetY,
          fontSize: run.size,
          // The ellipsis truncation adds draws no character, as Figma saves it.
          firstCharacter: ellipsis ? undefined : characterAt(run.offsets[index]),
          advance: run.positions[(index + 1) * 2] - x,
          lineLeft: left,
          source
        })
      }
    }
  }
  return glyphs
}

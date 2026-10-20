import { uniq } from 'es-toolkit/array'

import { ResourceCache } from '#core/cache/resource'
import { DEFAULT_FONT_FAMILY } from '#core/constants'
import { EMOJI_METRICS_FAMILY } from '#core/text/emoji'
import type { FamilyFace } from '#core/text/font/faces'
import { fontManager, fontWeightMatchOrder, weightToStyle } from '#core/text/fonts'

const familiesCache = new ResourceCache<string, string[]>({ maxEntries: 256 })

/**
 * The loaded face of a family that text asking for a style is drawn in: that style, or the
 * nearest loaded weight in the same slant, then the other, as font matching picks it; `null`
 * when the family has none loaded.
 */
export function loadedFace(family: string, weight: number, italic: boolean): FamilyFace | null {
  for (const slant of [italic, !italic]) {
    for (const candidate of fontWeightMatchOrder(weight)) {
      if (fontManager.isStyleLoaded(family, weightToStyle(candidate, slant)))
        return { weight: candidate, italic: slant }
    }
  }
  return null
}

export function resolveParagraphFontFamilies(
  primary: string,
  style: string,
  arabicFallbacks: readonly string[] = fontManager.getArabicFallbackFamilies(),
  cjkFallbacks: readonly string[] = fontManager.getCJKFallbackFamilies()
): string[] {
  const renderPrimary = fontManager.renderFamily(primary, style)
  const renderArabicFallbacks = arabicFallbacks.map((family) =>
    fontManager.renderFamily(family, 'Regular')
  )
  const renderCJKFallbacks = cjkFallbacks.map((family) =>
    fontManager.renderFamily(family, 'Regular')
  )
  const key = `${renderPrimary}\0${renderArabicFallbacks.join('\0')}\0${renderCJKFallbacks.join('\0')}`
  const cached = familiesCache.peek(key)
  if (cached) return cached
  const families = [renderPrimary]
  if (primary !== DEFAULT_FONT_FAMILY) families.push(DEFAULT_FONT_FAMILY)
  // Emoji come last, so a character a script's font has stays in that font.
  families.push(...renderArabicFallbacks, ...renderCJKFallbacks, EMOJI_METRICS_FAMILY)
  const resolved = uniq(families)
  familiesCache.set(key, resolved)
  return resolved
}

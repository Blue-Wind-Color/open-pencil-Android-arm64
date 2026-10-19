import { uniq } from 'es-toolkit/array'

import { ResourceCache } from '#core/cache/resource'
import { DEFAULT_FONT_FAMILY } from '#core/constants'
import { EMOJI_METRICS_FAMILY } from '#core/text/emoji'
import { fontManager } from '#core/text/fonts'

const familiesCache = new ResourceCache<string, string[]>({ maxEntries: 256 })

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

import valueParser from 'postcss-value-parser'

import { percentLength, pixelLength } from '../text/lengths'
import type { TextLength } from '../types'
import { parseCSSNumber } from './values'

/** A CSS dimension's number and lowercase unit, or null. */
function dimension(value: string): { number: number; unit: string } | null {
  const parsed = valueParser.unit(value)
  if (!parsed) return null
  const number = Number(parsed.number)
  return Number.isFinite(number) ? { number, unit: parsed.unit.toLowerCase() } : null
}

/**
 * A CSS `line-height` as a text length: a unitless multiple, `em`, or a percent follows the font size,
 * as a percent does in Figma; pixels stay pixels; `normal` is automatic, a null. Undefined for a
 * value it cannot read.
 */
export function parseCSSLineHeight(value: string | undefined): TextLength | null | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (trimmed === 'normal') return null
  const parsed = dimension(trimmed)
  if (parsed?.unit === '' || parsed?.unit === 'em') return percentLength(parsed.number * 100)
  if (parsed?.unit === '%') return percentLength(parsed.number)
  const pixels = parseCSSNumber(trimmed)
  return pixels === null ? undefined : pixelLength(pixels)
}

/**
 * A CSS `letter-spacing` as a text length: `em` is a percent of the font size, pixels stay pixels,
 * and `normal` is none. Undefined for a value it cannot read.
 */
export function parseCSSLetterSpacing(value: string | undefined): TextLength | undefined {
  const trimmed = value?.trim()
  if (!trimmed) return undefined
  if (trimmed === 'normal') return pixelLength(0)
  const parsed = dimension(trimmed)
  if (parsed?.unit === 'em') return percentLength(parsed.number * 100)
  const pixels = parseCSSNumber(trimmed)
  return pixels === null ? undefined : pixelLength(pixels)
}

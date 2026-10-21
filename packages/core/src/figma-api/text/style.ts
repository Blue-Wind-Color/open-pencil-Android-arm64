import { mapValues, pickBy } from 'es-toolkit/object'
import { isEqual } from 'es-toolkit/predicate'

import {
  paragraphIndexAt,
  paragraphSpacingAt,
  paragraphStyleAt,
  type Fill,
  type SceneNode
} from '@open-pencil/scene-graph'
import { copyFills } from '@open-pencil/scene-graph/copy'

import { weightToStyleName } from '#core/figma-api/fonts'
import { variableAlias } from '#core/figma-api/variables/values'
import { characterStyles, nodeStyle, type CharacterStyle } from '#core/text/character-style'

/** The fields `getStyledTextSegments` takes, in the order Figma lists them. */
export const TEXT_SEGMENT_FIELDS = [
  'fontSize',
  'fontName',
  'fontWeight',
  'fontStyle',
  'textDecoration',
  'textDecorationStyle',
  'textDecorationSkipInk',
  'textDecorationOffset',
  'textDecorationThickness',
  'textDecorationColor',
  'textCase',
  'lineHeight',
  'letterSpacing',
  'fills',
  'textStyleId',
  'fillStyleId',
  'listOptions',
  'indentation',
  'hyperlink',
  'openTypeFeatures',
  'boundVariables',
  'textStyleOverrides',
  'paragraphSpacing',
  'listSpacing',
  'paragraphIndent',
  'textWrapStyle'
] as const

export type TextSegmentField = (typeof TEXT_SEGMENT_FIELDS)[number]

/** A size Figma reads as automatic or in pixels; the node keeps pixels. */
export type FigmaTextLength = { unit: 'AUTO' } | { unit: 'PIXELS' | 'PERCENT'; value: number }

function pixels(value: number | null): FigmaTextLength {
  return value === null ? { unit: 'AUTO' } : { unit: 'PIXELS', value }
}

function underlined(style: CharacterStyle): boolean {
  return style.textDecoration === 'UNDERLINE'
}

/** Figma's paint for an underline colour of its own, or automatic, following the text. */
function decorationColor(style: CharacterStyle) {
  const paint = style.textDecorationFills.at(0)
  return paint ? { value: copyFills([paint])[0] } : { value: 'AUTO' as const }
}

function fontFeatureMap(style: CharacterStyle): Record<string, boolean> {
  return Object.fromEntries(style.fontFeatures.map((feature) => [feature.tag, feature.enabled]))
}

type FieldContext = { node: SceneNode; style: CharacterStyle; paragraph: number }

/** The decoration's own style reads null where the text is not underlined. */
function whenUnderlined(read: (style: CharacterStyle) => unknown) {
  return ({ style }: FieldContext) => (underlined(style) ? read(style) : null)
}

function spacing(field: 'paragraphSpacing' | 'listSpacing' | 'paragraphIndent') {
  return ({ node, paragraph }: FieldContext) => paragraphSpacingAt(node, paragraph, field)
}

/**
 * Figma's value of each field for one character. Fields the model keeps for the whole text read
 * the text's value; fields it has no place for read Figma's defaults.
 */
const FIELD_READERS: Record<TextSegmentField, (context: FieldContext) => unknown> = {
  fontSize: ({ style }) => style.fontSize,
  fontName: ({ style }) => ({
    family: style.fontFamily,
    style: weightToStyleName(style.fontWeight, style.italic)
  }),
  fontWeight: ({ style }) => style.fontWeight,
  fontStyle: ({ style }) => (style.italic ? 'ITALIC' : 'REGULAR'),
  textDecoration: ({ style }) => style.textDecoration,
  textDecorationStyle: whenUnderlined((style) => style.textDecorationStyle),
  textDecorationSkipInk: whenUnderlined((style) => style.textDecorationSkipInk),
  textDecorationOffset: whenUnderlined((style) => pixels(style.textUnderlineOffset)),
  textDecorationThickness: whenUnderlined((style) => pixels(style.textDecorationThickness)),
  textDecorationColor: whenUnderlined(decorationColor),
  textCase: ({ style }) => style.textCase,
  lineHeight: ({ style }) => pixels(style.lineHeight),
  letterSpacing: ({ style }) => ({ unit: 'PIXELS', value: style.letterSpacing }),
  fills: ({ style }) => copyFills(style.fills),
  textStyleId: ({ style }) => style.textStyleId ?? '',
  fillStyleId: ({ style }) => style.fillStyleId ?? '',
  listOptions: ({ node, paragraph }) => ({
    type: paragraphStyleAt(node.textParagraphs, paragraph).listType
  }),
  indentation: ({ node, paragraph }) =>
    paragraphStyleAt(node.textParagraphs, paragraph).indentation,
  hyperlink: ({ style }) => (style.hyperlink ? { ...style.hyperlink } : null),
  openTypeFeatures: ({ style }) => fontFeatureMap(style),
  boundVariables: ({ style }) =>
    mapValues(pickBy(style.boundVariables, Boolean), (id) => variableAlias(String(id))),
  textStyleOverrides: () => [],
  paragraphSpacing: spacing('paragraphSpacing'),
  listSpacing: spacing('listSpacing'),
  paragraphIndent: spacing('paragraphIndent'),
  textWrapStyle: () => 'AUTO'
}

function readField(
  node: SceneNode,
  style: CharacterStyle,
  paragraph: number,
  field: TextSegmentField
): unknown {
  return FIELD_READERS[field]({ node, style, paragraph })
}

/** Figma's messages for a range a text method cannot use. */
export function assertTextRange(method: string, node: SceneNode, start: number, end: number) {
  if (start < 0) {
    throw new Error(
      `in ${method}: Property "start" failed validation: Number must be greater than or equal to 0`
    )
  }
  if (end <= start) {
    throw new Error(`in ${method}: Empty range selected. 'end' must be greater than 'start'`)
  }
  if (start >= node.text.length || end > node.text.length) {
    throw new Error(
      `in ${method}: Range outside of available characters. 'start' must be less than ` +
        `node.characters.length and 'end' must be less than or equal to node.characters.length`
    )
  }
}

/** One field's values for `text[start, end)`, character by character. */
function fieldValues(
  node: SceneNode,
  field: TextSegmentField,
  start: number,
  end: number
): unknown[] {
  const styles = characterStyles(node, start, end)
  let paragraph = paragraphIndexAt(node.text, start)
  return styles.map((style, offset) => {
    const value = readField(node, style, paragraph, field)
    // A newline belongs to the paragraph it ends.
    if (node.text[start + offset] === '\n') paragraph++
    return value
  })
}

/** The value every character of the range shares, or `mixed`. */
export function getRangeTextStyle(
  method: string,
  node: SceneNode,
  field: TextSegmentField,
  start: number,
  end: number,
  mixed: symbol
): unknown {
  assertTextRange(method, node, start, end)
  const [first, ...rest] = fieldValues(node, field, start, end)
  return rest.every((value) => isEqual(value, first)) ? first : mixed
}

/** The value every character of the text shares, or `mixed`; empty text reads its own style. */
export function getTextStyle(node: SceneNode, field: TextSegmentField, mixed: symbol): unknown {
  if (node.text.length === 0) return readField(node, nodeStyle(node), 0, field)
  const [first, ...rest] = fieldValues(node, field, 0, node.text.length)
  return rest.every((value) => isEqual(value, first)) ? first : mixed
}

export type StyledTextSegment = {
  characters: string
  start: number
  end: number
} & Partial<Record<TextSegmentField, unknown>>

export function getStyledTextSegments(
  node: SceneNode,
  fields: readonly TextSegmentField[],
  start?: number,
  end?: number
): StyledTextSegment[] {
  const method = 'getStyledTextSegments'
  for (const [index, field] of fields.entries()) {
    if (!(TEXT_SEGMENT_FIELDS as readonly string[]).includes(field)) {
      throw new Error(
        `in ${method}: Property "${method}" failed validation: Invalid enum value. Expected ` +
          `${TEXT_SEGMENT_FIELDS.map((name) => `'${name}'`).join(' | ')}, received '${String(field)}' at index ${index}`
      )
    }
  }
  if ((start === undefined) !== (end === undefined)) {
    throw new Error(`in ${method}: Invalid range. Must provide both 'start' and 'end'`)
  }
  const from = start ?? 0
  const to = end ?? node.text.length
  if (start !== undefined) assertTextRange(method, node, from, to)
  if (to === from) return []

  const ordered = TEXT_SEGMENT_FIELDS.filter((field) => fields.includes(field))
  const columns = ordered.map((field) => fieldValues(node, field, from, to))
  const segments: StyledTextSegment[] = []
  let first = 0
  for (const last of segmentEnds(columns, to - from)) {
    const segment: StyledTextSegment = {
      characters: node.text.slice(from + first, from + last),
      start: from + first,
      end: from + last
    }
    for (const [column, field] of ordered.entries()) segment[field] = columns[column][first]
    segments.push(segment)
    first = last
  }
  return segments
}

/** Where segments end: wherever any requested field changes, and at the end of the range. */
function segmentEnds(columns: readonly unknown[][], length: number): number[] {
  const ends: number[] = []
  let first = 0
  for (let offset = 1; offset < length; offset++) {
    const start = first
    if (columns.some((values) => !isEqual(values[offset], values[start]))) {
      ends.push(offset)
      first = offset
    }
  }
  ends.push(length)
  return ends
}

/** Whether any character of the range is underlined, which Figma's decoration setters need. */
export function rangeHasUnderline(node: SceneNode, start: number, end: number): boolean {
  return characterStyles(node, start, end).some(underlined)
}

export type FigmaDecorationColor = { value: 'AUTO' } | { value: Fill }

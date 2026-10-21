import type { VariableType } from '../types'

export const NUMERIC_FIELDS = new Set([
  'opacity',
  'width',
  'height',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'x',
  'y',
  'rotation',
  'cornerRadius',
  'topLeftRadius',
  'topRightRadius',
  'bottomLeftRadius',
  'bottomRightRadius',
  'strokeWeight',
  'borderTopWeight',
  'borderBottomWeight',
  'borderLeftWeight',
  'borderRightWeight',
  'fontSize',
  'letterSpacing',
  'lineHeight',
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'itemSpacing',
  'counterAxisSpacing',
  'gridRowGap',
  'gridColumnGap'
])

export function isNumericVariableBindingField(field: string): boolean {
  return NUMERIC_FIELDS.has(field)
}

/** Text content and font family are the string-valued bindings a node accepts. */
export const STRING_BINDING_FIELDS: ReadonlySet<string> = new Set(['text', 'fontFamily'])

/**
 * The variable types text content binds to: text, or a number shown as text, as Figma's layer
 * panel offers. Figma's plugin API takes text alone; font family stays text-only.
 */
export const TEXT_CONTENT_VARIABLE_TYPES = [
  'STRING',
  'FLOAT'
] as const satisfies readonly VariableType[]

/** Visibility is the only boolean-valued binding a node accepts. */
export const BOOLEAN_BINDING_FIELDS: ReadonlySet<string> = new Set(['visible'])

/**
 * The variable types visibility binds to: a boolean, or text that shows the layer unless it reads
 * as false, as Figma's layer panel offers. Figma's plugin API takes booleans alone.
 */
export const VISIBILITY_VARIABLE_TYPES = [
  'BOOLEAN',
  'STRING'
] as const satisfies readonly VariableType[]

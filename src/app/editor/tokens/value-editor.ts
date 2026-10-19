import type { Variable, VariableValue } from '@open-pencil/scene-graph'

import { parseTokenValueText, tokenValueText, type TokenFormulaActions } from './model'

export interface TokenValueEdit {
  value: VariableValue
  resolved: number | boolean
  kind: 'literal' | 'reference' | 'formula'
}

/** A value as the field shows it: a number in the token's unit, or the formula's source. */
export function tokenEditorText(variable: Variable, modeId: string, formula: TokenFormulaActions) {
  const value = variable.valuesByMode[modeId]
  return typeof value === 'object' ? formula.format(value) : tokenValueText(variable, value)
}

/**
 * Read the field: a plain number is typed in the token's unit, as the number field took it;
 * anything else is a formula, whose numbers are stored units.
 */
export function parseTokenEditorText(
  variable: Variable,
  modeId: string,
  source: string,
  formula: TokenFormulaActions
): TokenValueEdit {
  const text = source.trim()
  const literal = parseTokenValueText(variable, text)
  if (typeof literal === 'number') return { value: literal, resolved: literal, kind: 'literal' }
  const result = formula.parse(modeId, text)
  if (typeof result.value !== 'object') return { ...result, kind: 'literal' }
  return { ...result, kind: 'aliasId' in result.value ? 'reference' : 'formula' }
}

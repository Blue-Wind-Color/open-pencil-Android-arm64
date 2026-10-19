import type { VariableFormulaNode, VariableFormulaOperator } from '@open-pencil/scene-graph'

import {
  checkFormulaOperands,
  formulaResultType,
  MAX_FORMULA_DEPTH,
  MAX_FORMULA_LENGTH,
  VariableFormulaError,
  type FormulaValueType
} from './evaluate'
import { formulaTokenName, formulaTokens, type FormulaToken } from './tokens'

/*
 * A small Pratt parser rather than a library. jsep configures operators globally, which the calc
 * tool's grammar already relies on, and gives no token stream for the editor to highlight and
 * complete from. A Lezer grammar would add its runtime (about 18 KB gzipped) to every Scene Graph
 * consumer, and its generic error recovery would still need these type and arity messages.
 */

/** Binding strength of each binary operator; prefix operators bind tighter than all of them. */
export const FORMULA_PRECEDENCE: Partial<Record<VariableFormulaOperator, number>> = {
  OR: 1,
  AND: 2,
  EQUALS: 3,
  NOT_EQUAL: 3,
  LESS_THAN: 4,
  LESS_THAN_OR_EQUAL: 4,
  GREATER_THAN: 4,
  GREATER_THAN_OR_EQUAL: 4,
  ADDITION: 5,
  SUBTRACTION: 5,
  MULTIPLY: 6,
  DIVIDE: 6
}
export const FORMULA_PREFIX_PRECEDENCE = 7
/** Comparisons do not chain: `a < b < c` reads as a mistake, not as `(a < b) < c`. */
export const FORMULA_NON_ASSOCIATIVE = new Set([3, 4])

const BINARY = new Map<string, VariableFormulaOperator>([
  ['+', 'ADDITION'],
  ['-', 'SUBTRACTION'],
  ['*', 'MULTIPLY'],
  ['/', 'DIVIDE'],
  ['==', 'EQUALS'],
  ['!=', 'NOT_EQUAL'],
  ['<', 'LESS_THAN'],
  ['<=', 'LESS_THAN_OR_EQUAL'],
  ['>', 'GREATER_THAN'],
  ['>=', 'GREATER_THAN_OR_EQUAL'],
  ['and', 'AND'],
  ['&&', 'AND'],
  ['or', 'OR'],
  ['||', 'OR']
])

/** Check what the editor may leave open while typing, which a saved formula cannot hold. */
function checkedTokens(source: string): FormulaToken[] {
  const tokens = formulaTokens(source)
  for (const token of tokens) {
    if (token.kind === 'invalid') throw new VariableFormulaError(`Unexpected ${token.text}`)
    if (token.kind !== 'reference') continue
    if (!token.text.endsWith('}'))
      throw new VariableFormulaError('A reference is missing its closing }')
    if (!formulaTokenName(token)) throw new VariableFormulaError('Empty variable reference')
  }
  return tokens
}

export interface FormulaReference {
  id: string
  type: FormulaValueType
}

export interface ParsedFormula {
  node: VariableFormulaNode
  type: FormulaValueType
}

/**
 * Read a formula into Figma's expression tree, checking operand types on the way. References
 * are `{name}` or a bare name; `reference` resolves them. No code is evaluated.
 */
export function parseFormulaSyntax(
  source: string,
  reference: (name: string) => FormulaReference
): ParsedFormula {
  if (!source.trim()) throw new VariableFormulaError('Enter a value or formula')
  if (source.length > MAX_FORMULA_LENGTH) throw new VariableFormulaError('Formula is too long')
  const tokens = checkedTokens(source)
  let index = 0
  const peek = () => tokens.at(index)
  /** Operators and keywords by their lowercase spelling; operands read as nothing. */
  const symbolAt = (token: FormulaToken | undefined) =>
    token && ['operator', 'keyword', 'paren', 'bool'].includes(token.kind)
      ? token.text.toLowerCase()
      : ''

  function operation(operator: VariableFormulaOperator, operands: ParsedFormula[]): ParsedFormula {
    checkFormulaOperands(
      operator,
      operands.map((operand) => operand.type)
    )
    return {
      node: { operator, operands: operands.map((operand) => operand.node) },
      type: formulaResultType(operator)
    }
  }

  function prefix(depth: number): ParsedFormula {
    if (depth > MAX_FORMULA_DEPTH) throw new VariableFormulaError('Formula is too deeply nested')
    const token = tokens.at(index++)
    if (!token) throw new VariableFormulaError('The formula ends too early')
    if (token.kind === 'number') return { node: Number(token.text), type: 'FLOAT' }
    if (token.kind === 'reference' || token.kind === 'name') {
      const { id, type } = reference(formulaTokenName(token))
      return { node: { aliasId: id }, type }
    }
    switch (symbolAt(token)) {
      case 'true':
      case 'false':
        return { node: symbolAt(token) === 'true', type: 'BOOLEAN' }
      case '(': {
        const inner = expression(0, depth + 1)
        if (symbolAt(tokens.at(index++)) !== ')') throw new VariableFormulaError('Missing )')
        return inner
      }
      case '+':
        return prefix(depth + 1)
      case '-': {
        const operand = expression(FORMULA_PREFIX_PRECEDENCE, depth + 1)
        if (typeof operand.node === 'number') return { node: -operand.node, type: 'FLOAT' }
        return operation('NEGATE', [operand])
      }
      case 'not':
      case '!':
        return operation('NOT', [expression(FORMULA_PREFIX_PRECEDENCE, depth + 1)])
    }
    throw new VariableFormulaError(`Unexpected ${token.text}`)
  }

  function expression(minimum: number, depth: number): ParsedFormula {
    let left = prefix(depth)
    for (;;) {
      const operator = BINARY.get(symbolAt(peek()))
      const precedence = operator ? (FORMULA_PRECEDENCE[operator] ?? 0) : 0
      if (!operator || precedence <= minimum) return left
      index++
      const right = expression(precedence, depth + 1)
      left = operation(operator, [left, right])
      const next = BINARY.get(symbolAt(peek()))
      if (
        next &&
        FORMULA_NON_ASSOCIATIVE.has(precedence) &&
        FORMULA_PRECEDENCE[next] === precedence
      )
        throw new VariableFormulaError('Join comparisons with and or or')
    }
  }

  const result = expression(0, 0)
  const extra = peek()
  if (extra) throw new VariableFormulaError(`Unexpected ${formulaTokenName(extra)}`)
  return result
}

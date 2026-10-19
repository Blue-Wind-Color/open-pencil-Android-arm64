import type { Variable, VariableFormulaNode } from '@open-pencil/scene-graph'

import { tokenNumberToCSS, variableUnit } from './values'

/**
 * A number formula as `calc()`, with each reference a `var()`. CSS adds only like with like and
 * multiplies a length only by a plain number, so a literal takes the unit of what it is added
 * to, and a formula CSS cannot type, such as a length times a length, has no CSS form.
 */
type Term =
  | { kind: 'literal'; value: number }
  | { kind: 'css'; text: string; precedence: number; dimension: boolean }

const OPERATORS = {
  ADDITION: { symbol: '+', precedence: 1 },
  SUBTRACTION: { symbol: '-', precedence: 1 },
  MULTIPLY: { symbol: '*', precedence: 2 },
  DIVIDE: { symbol: '/', precedence: 2 }
} as const
type Arithmetic = keyof typeof OPERATORS
const ATOM = 3

class UnsupportedFormulaError extends Error {
  override name = 'UnsupportedFormulaError'
}

interface FormulaContext {
  variables: ReadonlyMap<string, Variable>
  names: ReadonlyMap<string, string>
  /** A literal written as a length, in the exported token's unit. */
  length: (value: number) => string
}

export function formulaToCSS(
  node: VariableFormulaNode,
  variable: Variable,
  variables: ReadonlyMap<string, Variable>,
  names: ReadonlyMap<string, string>
): string | { issue: string } {
  const unit = variableUnit(variable)
  const context = { variables, names, length: (value: number) => tokenNumberToCSS(value, unit) }
  try {
    const result = convert(node, context)
    const dimension = unit !== 'none'
    if (result.kind === 'literal') return write(result, dimension, context)
    if (result.dimension !== dimension)
      return { issue: dimension ? 'has a formula without a unit' : 'has a formula with a unit' }
    return `calc(${result.text})`
  } catch (error) {
    if (error instanceof UnsupportedFormulaError) return { issue: error.message }
    throw error
  }
}

function convert(node: VariableFormulaNode, context: FormulaContext): Term {
  if (typeof node === 'number') return { kind: 'literal', value: node }
  if (typeof node === 'boolean') throw new UnsupportedFormulaError('mixes true/false into a number')
  if ('aliasId' in node) return reference(node.aliasId, context)
  const operands = node.operands.map((operand) => convert(operand, context))
  const [a, b] = operands
  if (node.operator === 'NEGATE' && operands.length === 1) return negate(a, context)
  if (operands.length !== 2 || !isArithmetic(node.operator))
    throw new UnsupportedFormulaError('uses logic that CSS has no form for')
  if (a.kind === 'literal' && b.kind === 'literal')
    return { kind: 'literal', value: fold(node.operator, a.value, b.value) }
  return binary(node.operator, a, b, context)
}

function reference(id: string, { variables, names }: FormulaContext): Term {
  const target = variables.get(id)
  const name = names.get(id)
  if (!target || !name)
    throw new UnsupportedFormulaError('refers to a variable that does not exist')
  const dimension = variableUnit(target) !== 'none'
  return { kind: 'css', text: `var(--${name})`, precedence: ATOM, dimension }
}

function negate(term: Term, context: FormulaContext): Term {
  if (term.kind === 'literal') return { kind: 'literal', value: -term.value }
  const text = `-1 * ${grouped(term, false, OPERATORS.MULTIPLY.precedence, context)}`
  return { kind: 'css', text, precedence: OPERATORS.MULTIPLY.precedence, dimension: term.dimension }
}

function binary(operator: Arithmetic, a: Term, b: Term, context: FormulaContext): Term {
  const { symbol, precedence } = OPERATORS[operator]
  // The right side of - and / keeps its parentheses even at equal precedence.
  const rightBelow =
    operator === 'SUBTRACTION' || operator === 'DIVIDE' ? precedence + 1 : precedence
  const aDimension = a.kind === 'css' && a.dimension
  const bDimension = b.kind === 'css' && b.dimension
  if (precedence === 1) {
    if (a.kind === 'css' && b.kind === 'css' && aDimension !== bDimension)
      throw new UnsupportedFormulaError('adds a length to a plain number')
    const dimension = aDimension || bDimension
    const left = grouped(a, dimension, precedence, context)
    const right = grouped(b, dimension, rightBelow, context)
    return { kind: 'css', text: `${left} ${symbol} ${right}`, precedence, dimension }
  }
  if (bDimension && operator === 'DIVIDE') throw new UnsupportedFormulaError('divides by a length')
  if (aDimension && bDimension) throw new UnsupportedFormulaError('multiplies two lengths')
  const left = grouped(a, false, precedence, context)
  const right = grouped(b, false, rightBelow, context)
  return {
    kind: 'css',
    text: `${left} ${symbol} ${right}`,
    precedence,
    dimension: aDimension || bDimension
  }
}

function write(term: Term, dimension: boolean, context: FormulaContext) {
  if (term.kind === 'css') return term.text
  return dimension ? context.length(term.value) : String(Number(term.value.toFixed(6)))
}

function grouped(term: Term, dimension: boolean, below: number, context: FormulaContext) {
  return term.kind === 'css' && term.precedence < below
    ? `(${term.text})`
    : write(term, dimension, context)
}

function isArithmetic(operator: string): operator is Arithmetic {
  return Object.hasOwn(OPERATORS, operator)
}

function fold(operator: Arithmetic, a: number, b: number) {
  if (operator === 'ADDITION') return a + b
  if (operator === 'SUBTRACTION') return a - b
  if (operator === 'MULTIPLY') return a * b
  return a / b
}

import type { VariableFormulaNode, VariableFormulaOperator } from '@open-pencil/scene-graph'

import { formulaArity, formulaSymbol, MAX_FORMULA_DEPTH } from './evaluate'
import { FORMULA_NON_ASSOCIATIVE, FORMULA_PRECEDENCE, FORMULA_PREFIX_PRECEDENCE } from './parse'

const ATOM = FORMULA_PREFIX_PRECEDENCE + 1
/** Grouping these differently gives the same value, so `a + (b + c)` prints as `a + b + c`. */
const ASSOCIATIVE = new Set<VariableFormulaOperator>(['ADDITION', 'MULTIPLY', 'AND', 'OR'])
/** A long formula breaks before these: `or`, `and`, and `+` and `-`. */
const BREAKABLE = new Set([1, 2, 5])
const CONTINUATION = '\n  '

interface Printed {
  text: string
  precedence: number
}

export interface PrintFormulaOptions {
  /**
   * Past this many characters, a formula breaks before each operator of its outermost chain of
   * `or`, `and`, or `+` and `-`, with the lines after the first indented.
   */
  width?: number
  /**
   * How a reference reads where the formula is shown, such as a pill's name, which `width`
   * counts in place of the source spelling.
   */
  display?: (id: string) => string
}

function nodePrecedence(node: VariableFormulaNode) {
  if (typeof node !== 'object' || 'aliasId' in node) return ATOM
  if (formulaArity(node.operator) === 1) return FORMULA_PREFIX_PRECEDENCE
  return FORMULA_PRECEDENCE[node.operator] ?? 0
}

type Operation = Exclude<VariableFormulaNode, number | boolean | { aliasId: string }>
type Print = (node: VariableFormulaNode, depth: number, breakAt?: number) => Printed

const group = ({ text }: Printed) => `(${text})`

function printUnary(node: Operation, depth: number, print: Print): Printed {
  const [operandNode] = node.operands
  const operand = print(operandNode, depth + 1)
  const text = operand.precedence < ATOM ? group(operand) : operand.text
  const symbol = formulaSymbol(node.operator)
  return {
    text: node.operator === 'NOT' ? `${symbol} ${text}` : `${symbol}${text}`,
    precedence: FORMULA_PREFIX_PRECEDENCE
  }
}

/** `breakAt` is the precedence of the outermost chain while it is printed on several lines. */
function printBinary(node: Operation, depth: number, print: Print, breakAt?: number): Printed {
  const precedence = FORMULA_PRECEDENCE[node.operator] ?? 0
  const chained = FORMULA_NON_ASSOCIATIVE.has(precedence)
  const [leftNode, rightNode] = node.operands
  const sameAssociative =
    ASSOCIATIVE.has(node.operator) &&
    typeof rightNode === 'object' &&
    'operator' in rightNode &&
    rightNode.operator === node.operator
  // The chain continues through a left operand and an unparenthesized right one of its level.
  const breaking = breakAt === precedence
  const left = print(leftNode, depth + 1, breaking ? breakAt : undefined)
  const right = print(rightNode, depth + 1, breaking && sameAssociative ? breakAt : undefined)
  // A comparison inside another, such as `(a > 1) == b`, keeps its parentheses to read clearly.
  const nested = (operand: Printed) => chained && FORMULA_NON_ASSOCIATIVE.has(operand.precedence)
  const leftText = left.precedence < precedence || nested(left) ? group(left) : left.text
  const rightGrouped =
    right.precedence < precedence ||
    nested(right) ||
    (right.precedence === precedence && !sameAssociative)
  const rightText = rightGrouped ? group(right) : right.text
  const separator = breaking ? CONTINUATION : ' '
  return { text: `${leftText}${separator}${formulaSymbol(node.operator)} ${rightText}`, precedence }
}

/** Print a formula with only the parentheses its precedence needs; `reference` spells a variable. */
export function printFormula(
  node: VariableFormulaNode,
  reference: (id: string) => string,
  { width, display }: PrintFormulaOptions = {}
): string {
  const line = printLine(node, reference)
  const outer = nodePrecedence(node)
  const shown = display ? printLine(node, display) : line
  if (width === undefined || shown.length <= width || !BREAKABLE.has(outer)) return line
  return printWith(reference, node, outer)
}

function printLine(node: VariableFormulaNode, reference: (id: string) => string) {
  return printWith(reference, node)
}

function printWith(
  reference: (id: string) => string,
  root: VariableFormulaNode,
  rootBreak?: number
): string {
  const print: Print = (node, depth, breakAt) => {
    if (depth > MAX_FORMULA_DEPTH) return { text: '…', precedence: ATOM }
    if (typeof node === 'number')
      return { text: String(node), precedence: node < 0 ? FORMULA_PREFIX_PRECEDENCE : ATOM }
    if (typeof node === 'boolean') return { text: String(node), precedence: ATOM }
    if ('aliasId' in node) return { text: reference(node.aliasId), precedence: ATOM }
    return formulaArity(node.operator) === 1
      ? printUnary(node, depth, print)
      : printBinary(node, depth, print, breakAt)
  }
  return print(root, 0, rootBreak).text
}

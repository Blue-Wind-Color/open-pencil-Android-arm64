import type {
  VariableFormulaNode,
  VariableFormulaOperator,
  VariableLiteral
} from '@open-pencil/scene-graph'

export const MAX_FORMULA_DEPTH = 64
export const MAX_FORMULA_LENGTH = 4096

export class VariableFormulaError extends Error {
  override name = 'VariableFormulaError'
}

export type FormulaValueType = 'FLOAT' | 'BOOLEAN'

/**
 * What each operator takes and gives. `EQUALS` and `NOT_EQUAL` compare two values of either
 * type, so long as both are the same; the others take one type only.
 */
interface OperatorSignature {
  operands: FormulaValueType | 'SAME'
  result: FormulaValueType
  arity: 1 | 2
  /** How the operator is written, and the spelling the parser reads. */
  symbol: string
  /** Operands are checked against `operands` before this runs. */
  apply: (a: number | boolean, b: number | boolean) => number | boolean
}

const SIGNATURES: Record<VariableFormulaOperator, OperatorSignature> = {
  ADDITION: arithmetic('+', (a, b) => a + b),
  SUBTRACTION: arithmetic('-', (a, b) => a - b),
  MULTIPLY: arithmetic('*', (a, b) => a * b),
  DIVIDE: arithmetic('/', (a, b) => {
    if (b === 0) throw new VariableFormulaError('Cannot divide by zero')
    return a / b
  }),
  NEGATE: { operands: 'FLOAT', result: 'FLOAT', arity: 1, symbol: '-', apply: (a) => -Number(a) },
  EQUALS: { operands: 'SAME', result: 'BOOLEAN', arity: 2, symbol: '==', apply: (a, b) => a === b },
  NOT_EQUAL: {
    operands: 'SAME',
    result: 'BOOLEAN',
    arity: 2,
    symbol: '!=',
    apply: (a, b) => a !== b
  },
  LESS_THAN: comparison('<', (a, b) => a < b),
  LESS_THAN_OR_EQUAL: comparison('<=', (a, b) => a <= b),
  GREATER_THAN: comparison('>', (a, b) => a > b),
  GREATER_THAN_OR_EQUAL: comparison('>=', (a, b) => a >= b),
  AND: logic('and', (a, b) => a && b),
  OR: logic('or', (a, b) => a || b),
  NOT: { operands: 'BOOLEAN', result: 'BOOLEAN', arity: 1, symbol: 'not', apply: (a) => a !== true }
}

function arithmetic(symbol: string, apply: (a: number, b: number) => number): OperatorSignature {
  return {
    operands: 'FLOAT',
    result: 'FLOAT',
    arity: 2,
    symbol,
    apply: (a, b) => apply(Number(a), Number(b))
  }
}

function comparison(symbol: string, apply: (a: number, b: number) => boolean): OperatorSignature {
  return {
    operands: 'FLOAT',
    result: 'BOOLEAN',
    arity: 2,
    symbol,
    apply: (a, b) => apply(Number(a), Number(b))
  }
}

function logic(symbol: string, apply: (a: boolean, b: boolean) => boolean): OperatorSignature {
  return {
    operands: 'BOOLEAN',
    result: 'BOOLEAN',
    arity: 2,
    symbol,
    apply: (a, b) => apply(a === true, b === true)
  }
}

export function formulaArity(operator: VariableFormulaOperator): number {
  return SIGNATURES[operator].arity
}

/** The operand type, or `SAME` for equality, which compares either type with itself. */
export function formulaOperandType(operator: VariableFormulaOperator): FormulaValueType | 'SAME' {
  return SIGNATURES[operator].operands
}

export function formulaResultType(operator: VariableFormulaOperator): FormulaValueType {
  return SIGNATURES[operator].result
}

export function formulaSymbol(operator: VariableFormulaOperator): string {
  return SIGNATURES[operator].symbol
}

export function formulaTypeName(type: FormulaValueType) {
  return type === 'FLOAT' ? 'numbers' : 'true or false'
}

/** Check operand types against an operator's signature; the message says what it needs. */
export function checkFormulaOperands(
  operator: VariableFormulaOperator,
  types: readonly FormulaValueType[]
) {
  const { operands, arity, symbol } = SIGNATURES[operator]
  if (types.length !== arity)
    throw new VariableFormulaError(`Wrong number of operands for ${operator}`)
  if (operands === 'SAME') {
    if (types[0] !== types[1])
      throw new VariableFormulaError(`${symbol} compares two numbers or two true/false values`)
    return
  }
  if (types.some((type) => type !== operands))
    throw new VariableFormulaError(`${symbol} needs ${formulaTypeName(operands)}`)
}

/** Both sides are evaluated before Boolean logic, so `false and` an invalid operand still fails. */
export function evaluateVariableFormula(
  node: VariableFormulaNode,
  resolve: (id: string) => VariableLiteral | undefined,
  depth = 0
): number | boolean {
  if (depth > MAX_FORMULA_DEPTH) throw new VariableFormulaError('Formula is too deeply nested')
  let result: VariableLiteral | undefined
  if (typeof node !== 'object') result = node
  else if ('aliasId' in node) {
    result = resolve(node.aliasId)
    if (result === undefined)
      throw new VariableFormulaError(`Cannot resolve variable ${node.aliasId}`)
  } else {
    if (!Object.hasOwn(SIGNATURES, node.operator))
      throw new VariableFormulaError(`Unknown formula operator ${String(node.operator)}`)
    const args = node.operands.map((operand) =>
      evaluateVariableFormula(operand, resolve, depth + 1)
    )
    checkFormulaOperands(
      node.operator,
      args.map((arg) => (typeof arg === 'number' ? 'FLOAT' : 'BOOLEAN'))
    )
    const [a, b] = args
    result = SIGNATURES[node.operator].apply(a, b)
  }
  if (typeof result !== 'number' && typeof result !== 'boolean')
    throw new VariableFormulaError('Formulas use number and Boolean variables only')
  if (typeof result === 'number' && !Number.isFinite(result))
    throw new VariableFormulaError('Formula result must be finite')
  return result
}

export function mapFormulaReferences(
  node: VariableFormulaNode,
  map: (id: string) => string,
  depth = 0
): VariableFormulaNode {
  if (depth > MAX_FORMULA_DEPTH) throw new VariableFormulaError('Formula is too deeply nested')
  if (typeof node !== 'object') return node
  if ('aliasId' in node) return { aliasId: map(node.aliasId) }
  return {
    operator: node.operator,
    operands: node.operands.map((n) => mapFormulaReferences(n, map, depth + 1))
  }
}

import * as v from 'valibot'

import {
  VARIABLE_FORMULA_OPERATORS,
  type VariableFormulaNode
} from '@open-pencil/scene-graph/types'

import { variableAliasSchema } from '../schema'
import {
  MAX_FORMULA_DEPTH,
  formulaArity,
  formulaOperandType,
  formulaResultType,
  type FormulaValueType
} from './evaluate'

type NodeSchema = v.GenericSchema<unknown, VariableFormulaNode>

/**
 * A bounded recursive schema rejects excessively deep data before traversing it. A Boolean
 * tree may compare numbers, so its schema reaches into the number tree one level down.
 */
function nodeSchema(type: FormulaValueType, depth: number, cache: Map<string, NodeSchema>) {
  const key = `${type}:${depth}`
  const cached = cache.get(key)
  if (cached) return cached
  const literal = v.union([
    type === 'FLOAT' ? v.pipe(v.number(), v.finite()) : v.boolean(),
    variableAliasSchema
  ])
  const operation = (operandType: FormulaValueType) =>
    v.pipe(
      v.object({
        operator: v.picklist(
          VARIABLE_FORMULA_OPERATORS.filter(
            (operator) =>
              formulaResultType(operator) === type &&
              [operandType, 'SAME'].includes(formulaOperandType(operator))
          )
        ),
        operands: v.pipe(
          v.array(nodeSchema(operandType, depth - 1, cache)),
          v.minLength(1),
          v.maxLength(2)
        )
      }),
      v.check(
        (node) => node.operands.length === formulaArity(node.operator),
        'Wrong number of operands'
      )
    )
  const schema: NodeSchema =
    depth === 0
      ? literal
      : v.union([literal, operation(type), ...(type === 'BOOLEAN' ? [operation('FLOAT')] : [])])
  cache.set(key, schema)
  return schema
}

const cache = new Map<string, NodeSchema>()

export const variableFormulaSchema = v.variant('type', [
  v.object({
    expression: v.literal('FORMULA'),
    type: v.literal('FLOAT'),
    value: nodeSchema('FLOAT', MAX_FORMULA_DEPTH, cache)
  }),
  v.object({
    expression: v.literal('FORMULA'),
    type: v.literal('BOOLEAN'),
    value: nodeSchema('BOOLEAN', MAX_FORMULA_DEPTH, cache)
  })
])

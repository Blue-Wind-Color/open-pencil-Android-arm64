import { expect, test } from 'bun:test'

import { guid } from '#fig-tests/helpers/guid'
import { materializeDocument, type DocumentAssemblyOptions } from '#fig/document/materialize'
import { unsupportedExpressionData } from '#fig/node-change/variable/unsupported'
import { noop } from 'es-toolkit/function'

import type { NodeChange, VariableDataEntry } from '@open-pencil/kiwi/fig/codec'

const COLLECTION = '1:1'
const DEFAULT_MODE = '1:2'
const OTHER_MODE = '1:3'
const TARGET = '1:4'
const VARIABLE = '1:5'

/** A collection with two modes, a literal at `1:4` and `variableData` in `1:5`'s first mode. */
function resources(variableData: VariableDataEntry): NodeChange[] {
  return [
    {
      guid: guid(1),
      type: 'VARIABLE_SET',
      variableSetModes: [
        { id: guid(2), name: 'Default' },
        { id: guid(3), name: 'Other' }
      ]
    },
    {
      guid: guid(4),
      type: 'VARIABLE',
      variableResolvedType: 'BOOLEAN',
      variableSetID: { guid: guid(1) },
      variableDataValues: {
        entries: [guid(2), guid(3)].map((modeID) => ({
          modeID,
          variableData: { dataType: 'BOOLEAN', value: { boolValue: true } }
        }))
      }
    },
    {
      guid: guid(5),
      type: 'VARIABLE',
      variableResolvedType: 'FLOAT',
      variableSetID: { guid: guid(1) },
      variableDataValues: {
        entries: [
          { modeID: guid(2), variableData },
          { modeID: guid(3), variableData: { dataType: 'FLOAT', value: { floatValue: 42 } } }
        ]
      }
    }
  ]
}

function expression(
  expressionFunction: string,
  expressionArguments: VariableDataEntry[] = []
): VariableDataEntry {
  return {
    dataType: 'EXPRESSION',
    resolvedDataType: 'FLOAT',
    value: { expressionValue: { expressionFunction, expressionArguments } }
  }
}

const ternary = expression('TERNARY', [
  { dataType: 'ALIAS', value: { alias: { guid: guid(4) } } },
  { dataType: 'FLOAT', value: { floatValue: 8 } },
  { dataType: 'ALIAS', value: { alias: { assetRef: { key: 'missing-library-variable' } } } }
])

function open(source: NodeChange[], options: DocumentAssemblyOptions = {}) {
  return materializeDocument(source, [], { onUnsupportedVariableExpression: noop, ...options })
    .graph
}

test('a strict read still rejects an expression it cannot evaluate', () => {
  expect(() => materializeDocument(resources(ternary))).toThrow(
    'Unsupported variable expression TERNARY'
  )
})

test('a tolerant read keeps the expression with one reference slot per alias', () => {
  const graph = open(resources(ternary))
  expect(graph.variables.get(VARIABLE)?.valuesByMode[DEFAULT_MODE]).toEqual({
    expression: 'UNSUPPORTED',
    function: 'TERNARY',
    value: { ...ternary },
    references: [TARGET, null],
    modes: []
  })
})

test('a kept expression has no value, while the variable’s other modes still resolve', () => {
  const graph = open(resources(ternary))
  expect(graph.resolveVariable(VARIABLE, DEFAULT_MODE)).toBeUndefined()
  expect(graph.resolveVariable(VARIABLE, OTHER_MODE)).toBe(42)
  expect(graph.variableCollections.get(COLLECTION)?.modes).toHaveLength(2)
})

test('each kept expression is reported with its variable and mode', () => {
  const diagnostics: unknown[] = []
  open(resources(ternary), {
    onUnsupportedVariableExpression: (diagnostic) => diagnostics.push(diagnostic)
  })
  expect(diagnostics).toEqual([
    { sourceId: VARIABLE, modeId: DEFAULT_MODE, reason: 'unsupported-variable-expression' }
  ])
})

test.each(['STRINGIFY', 'VAR_MODE_LOOKUP', 'IS_TRUTHY', 'RESOLVE_VARIANT', 'KEYFRAME', 'UNKNOWN'])(
  '%s is kept rather than evaluated',
  (name) => {
    const value = open(resources(expression(name))).variables.get(VARIABLE)?.valuesByMode[
      DEFAULT_MODE
    ]
    expect(value).toMatchObject({ expression: 'UNSUPPORTED', function: name })
  }
)

test('a color composed from another expression is kept whole', () => {
  const nested = {
    ...expression('COMPOSE_COLOR', [expression('TERNARY'), { dataType: 'FLOAT', value: {} }]),
    resolvedDataType: 'COLOR'
  }
  const value = open(resources(nested)).variables.get(VARIABLE)?.valuesByMode[DEFAULT_MODE]
  expect(value).toMatchObject({ expression: 'UNSUPPORTED', function: 'COMPOSE_COLOR' })
})

test('formulas OpenPencil evaluates are not kept opaque', () => {
  const sum = expression('ADDITION', [
    { dataType: 'FLOAT', value: { floatValue: 2 } },
    { dataType: 'FLOAT', value: { floatValue: 3 } }
  ])
  expect(open(resources(sum)).resolveVariable(VARIABLE, DEFAULT_MODE)).toBe(5)
})

test('a kept expression is written back with fields the codec does not know', () => {
  const data = {
    dataType: 'EXPRESSION',
    value: {
      expressionValue: {
        expressionFunction: 'TERNARY',
        expressionArguments: [
          { value: { colorValue: { r: 1, g: 0, b: 0, a: 1, colorSpace: 'DISPLAY_P3' } } },
          { value: { alias: { assetRef: { key: 'remote', version: 'v1', futureField: true } } } }
        ]
      }
    }
  }
  expect(unsupportedExpressionData(data)).toEqual(data)
  expect(() => unsupportedExpressionData({ dataType: 'FLOAT' })).toThrow(
    'Invalid unsupported variable expression'
  )
})

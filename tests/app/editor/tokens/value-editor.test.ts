import { expect, test } from 'bun:test'

import {
  formatVariableFormula,
  parseVariableFormula,
  SceneGraph,
  variableFormulaReference,
  type Variable
} from '@open-pencil/scene-graph'

import { parseTokenEditorText, tokenEditorText } from '@/app/editor/tokens/value-editor'

function actions(graph: SceneGraph, target: Variable) {
  return {
    candidates: [],
    parse: (modeId: string, text: string) => parseVariableFormula(graph, target.id, modeId, text),
    format: (value: Parameters<typeof formatVariableFormula>[1]) =>
      formatVariableFormula(graph, value),
    reference: (id: string) => variableFormulaReference(graph, id)
  }
}

test('one value field reads literals in the token unit, references and formulas', () => {
  const graph = new SceneGraph()
  const collection = graph.createCollection('Spacing')
  const mode = collection.defaultModeId
  const base = graph.createVariable('space/base', 'FLOAT', collection.id, 4)
  const target = graph.createVariable('target', 'FLOAT', collection.id, 8)
  const formula = actions(graph, target)
  const read = (text: string) => parseTokenEditorText(target, mode, text, formula)

  expect(read('20')).toEqual({ value: 20, resolved: 20, kind: 'literal' })
  expect(read('{space/base}')).toMatchObject({ value: { aliasId: base.id }, kind: 'reference' })
  expect(read('({space/base} * 3)')).toMatchObject({ resolved: 12, kind: 'formula' })
  expect(() => read('{target} * 2')).toThrow('Circular')
  expect(() => read('1 / 0')).toThrow('Cannot divide by zero')
  expect(() => read('12nonsense')).toThrow()

  target.valuesByMode[mode] = read('({space/base} * 3)').value
  expect(tokenEditorText(target, mode, formula)).toBe('{space/base} * 3')
  target.unit = 'rem'
  expect(read('2')).toMatchObject({ value: 32, kind: 'literal' })
  target.valuesByMode[mode] = 32
  expect(tokenEditorText(target, mode, formula)).toBe('2')
})

test('true/false values read words, references, logic and number comparisons', () => {
  const graph = new SceneGraph()
  const collection = graph.createCollection('Flags')
  const mode = collection.defaultModeId
  graph.createVariable('enabled', 'BOOLEAN', collection.id, true)
  graph.createVariable('width', 'FLOAT', collection.id, 640)
  const target = graph.createVariable('visible', 'BOOLEAN', collection.id, true)
  const read = (text: string) => parseTokenEditorText(target, mode, text, actions(graph, target))

  expect(read('true')).toMatchObject({ value: true, kind: 'literal' })
  expect(read('not {enabled}')).toMatchObject({ resolved: false, kind: 'formula' })
  expect(read('{width} >= 600 and enabled')).toMatchObject({ resolved: true, kind: 'formula' })
  expect(() => read('{width}')).toThrow('This gives a number, but visible holds true or false')
  expect(() => read('var(--enabled)')).toThrow()
})

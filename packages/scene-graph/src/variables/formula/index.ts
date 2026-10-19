import type { SceneGraph, VariableValue } from '@open-pencil/scene-graph'

import { resolveVariableInModes } from '../resolution'
import { VariableFormulaError } from './evaluate'
import { parseFormulaSyntax, type FormulaReference } from './parse'
import { printFormula, type PrintFormulaOptions } from './print'

export { printFormula, type PrintFormulaOptions } from './print'
export {
  formulaTokenName,
  formulaTokens,
  readFormulaToken,
  type FormulaToken,
  type FormulaTokenKind
} from './tokens'

export {
  evaluateVariableFormula,
  formulaArity,
  formulaOperandType,
  formulaResultType,
  MAX_FORMULA_DEPTH,
  VariableFormulaError
} from './evaluate'

function qualifiedName(graph: SceneGraph, id: string) {
  const variable = graph.variables.get(id)
  if (!variable) return undefined
  const collection = graph.variableCollections.get(variable.collectionId)
  return `${collection?.name ?? variable.collectionId}::${variable.name}`
}

/** Qualified names disambiguate references; the stored formula uses stable IDs. */
export function variableFormulaReference(graph: SceneGraph, id: string): string {
  const variable = graph.variables.get(id)
  if (!variable) return `{#${id}}`
  const unique = (name: string, of: (id: string) => string | undefined) =>
    [...graph.variables.keys()].filter((other) => of(other) === name).length === 1
  const plain = variable.name
  if (
    !/[{}]/.test(plain) &&
    plain.trim() === plain &&
    unique(plain, (other) => graph.variables.get(other)?.name)
  )
    return `{${plain}}`
  const qualified = qualifiedName(graph, id) ?? ''
  return /[{}]/.test(qualified) || !unique(qualified, (other) => qualifiedName(graph, other))
    ? `{#${id}}`
    : `{${qualified}}`
}

/** The formula's source text, with `{name}` for each reference, as the clipboard and scripts write it. */
export function formatVariableFormula(
  graph: SceneGraph,
  value: VariableValue,
  options?: PrintFormulaOptions
): string {
  const reference = (id: string) => variableFormulaReference(graph, id)
  if (typeof value === 'object' && 'expression' in value && value.expression === 'FORMULA')
    return printFormula(value.value, reference, options)
  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    (typeof value === 'object' && 'aliasId' in value)
  )
    return printFormula(value, reference, options)
  return ''
}

/**
 * Find the variable a reference names: `#id`, `Collection::name`, or a name, preferring the
 * edited variable's own collection when a name appears in several.
 */
function resolveReference(graph: SceneGraph, collectionId: string, name: string): FormulaReference {
  const candidates = [...graph.variables.values()].filter(
    (candidate) =>
      name === `#${candidate.id}` ||
      name === qualifiedName(graph, candidate.id) ||
      name === candidate.name
  )
  const local = candidates.filter((candidate) => candidate.collectionId === collectionId)
  const matches = local.length === 1 ? local : candidates
  const match = matches.at(0)
  if (!match) throw new VariableFormulaError(`No variable named ${name}`)
  if (matches.length !== 1)
    throw new VariableFormulaError(`More than one variable is named ${name}`)
  if (match.type !== 'FLOAT' && match.type !== 'BOOLEAN')
    throw new VariableFormulaError(`${match.name} is not a number or true/false variable`)
  return { id: match.id, type: match.type }
}

/** Validate a draft without changing the document. Formulas operate on stored units. */
export function parseVariableFormula(
  graph: SceneGraph,
  variableId: string,
  modeId: string,
  source: string
): { value: VariableValue; resolved: number | boolean } {
  const variable = graph.variables.get(variableId)
  if (!variable || (variable.type !== 'FLOAT' && variable.type !== 'BOOLEAN'))
    throw new VariableFormulaError('Select a number or Boolean variable')
  const collection = graph.variableCollections.get(variable.collectionId)
  if (!collection?.modes.some((mode) => mode.modeId === modeId))
    throw new VariableFormulaError('Unknown variable mode')
  const { node, type } = parseFormulaSyntax(source, (name) =>
    resolveReference(graph, variable.collectionId, name)
  )
  if (type !== variable.type) {
    const kind = (of: string) => (of === 'FLOAT' ? 'a number' : 'true or false')
    throw new VariableFormulaError(
      `This gives ${kind(type)}, but ${variable.name} holds ${kind(variable.type)}`
    )
  }
  const value: VariableValue =
    typeof node === 'object' && 'operator' in node
      ? { expression: 'FORMULA', type: variable.type, value: node }
      : node
  const resolved = resolveVariableInModes(
    graph,
    variableId,
    (collectionId) =>
      collectionId === variable.collectionId ? modeId : graph.getActiveModeId(collectionId),
    new Set(),
    new Map(),
    new Map([[variableId, value]])
  )
  if (typeof resolved !== 'number' && typeof resolved !== 'boolean')
    throw new VariableFormulaError('Expected a number or Boolean result')
  return { value, resolved }
}

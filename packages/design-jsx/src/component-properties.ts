import { compact } from 'es-toolkit/array'
import * as v from 'valibot'

import type {
  ComponentPropertyDefinition,
  ComponentPropertyReference,
  SceneGraph,
  SceneNode
} from '@open-pencil/scene-graph'
import {
  applyComponentPropertyValue,
  componentPropertyDefinitions,
  createComponentPropertyId
} from '@open-pencil/scene-graph/components'

import { DESIGN_JSX_SUPPORTED_PROPERTIES } from './definitions'
import { parseScriptInput } from './schema'

const definitionSchema = v.object({
  id: v.string(),
  name: v.string(),
  type: v.picklist(['VARIANT', 'TEXT', 'BOOLEAN', 'INSTANCE_SWAP']),
  defaultValue: v.string(),
  variantOptions: v.optional(v.array(v.string())),
  preferredValues: v.optional(v.array(v.string()))
}) satisfies v.GenericSchema<ComponentPropertyDefinition>
const referenceSchema = v.object({
  propertyId: v.string(),
  field: v.picklist(['VISIBLE', 'TEXT', 'INSTANCE_SWAP'])
}) satisfies v.GenericSchema<ComponentPropertyReference>

/** Accept the native graph contracts, without introducing a second property model. */
export function componentMetadata(
  props: Record<string, unknown>,
  type: SceneNode['type'],
  definitions?: readonly ComponentPropertyDefinition[]
): Partial<SceneNode> {
  const result: Partial<SceneNode> = {}
  if (props.properties !== undefined && type !== 'INSTANCE') {
    if (type !== 'COMPONENT' && type !== 'COMPONENT_SET')
      throw new Error('Only components, component sets, and instances accept properties')
    const definitions = parseScriptInput(
      'Invalid properties',
      v.array(definitionSchema),
      props.properties
    )
    if (new Set(definitions.map((definition) => definition.id)).size !== definitions.length)
      throw new Error('Duplicate component property IDs')
    const variantNames = definitions
      .filter((item) => item.type === 'VARIANT')
      .map((item) => item.name)
    if (new Set(variantNames).size !== variantNames.length)
      throw new Error('Duplicate variant property names')
    result.componentPropertyDefinitions = definitions
  }
  if (props.propertyRefs !== undefined) {
    const references = parseScriptInput(
      'Invalid propertyRefs',
      v.array(referenceSchema),
      props.propertyRefs
    )
    for (const reference of references) {
      if (reference.field === 'TEXT' && type !== 'TEXT')
        throw new Error('TEXT properties require a text node')
      if (reference.field === 'INSTANCE_SWAP' && type !== 'INSTANCE')
        throw new Error('INSTANCE_SWAP properties require an instance')
      if (definitions) {
        const definition = definitions.find((item) => item.id === reference.propertyId)
        if (!definition)
          throw new Error(`Unknown component property reference: ${reference.propertyId}`)
        const expectedField = definition.type === 'BOOLEAN' ? 'VISIBLE' : definition.type
        if (reference.field !== expectedField)
          throw new Error(`Component property ${definition.id} cannot bind ${reference.field}`)
      }
    }
    result.componentPropertyReferences = references
  }
  return result
}

/** Match the nearest component scope, including definitions inherited from its set. */
export function componentPropertyScope(
  graph: SceneGraph,
  parentId: string
): readonly ComponentPropertyDefinition[] | undefined {
  let parent = graph.getNode(parentId)
  while (parent) {
    if (parent.type === 'INSTANCE') return componentPropertyDefinitions(graph, parent)
    if (parent.type === 'COMPONENT_SET') return parent.componentPropertyDefinitions
    if (parent.type === 'COMPONENT') {
      const set = parent.parentId ? graph.getNode(parent.parentId) : undefined
      return set?.type === 'COMPONENT_SET'
        ? [...set.componentPropertyDefinitions, ...parent.componentPropertyDefinitions]
        : parent.componentPropertyDefinitions
    }
    parent = parent.parentId ? graph.getNode(parent.parentId) : undefined
  }
  return undefined
}

/** The one property with this name; a name several properties share is an error. */
function namedDefinition(
  definitions: readonly ComponentPropertyDefinition[],
  name: string
): ComponentPropertyDefinition | undefined {
  const matches = definitions.filter((item) => item.name === name)
  if (matches.length > 1)
    throw new Error(
      `Component property name ${name} is ambiguous; use one of the IDs: ${matches.map((item) => item.id).join(', ')}`
    )
  return matches[0]
}

function assignValue(
  graph: SceneGraph,
  instance: SceneNode,
  definition: ComponentPropertyDefinition,
  key: string,
  value: string
): void {
  if (definition.type === 'VARIANT')
    throw new Error('Select a component-set variant when creating the instance')
  if (definition.type === 'BOOLEAN' && value !== 'true' && value !== 'false')
    throw new Error(`Expected true or false for component property: ${key}`)
  if (!applyComponentPropertyValue(graph, instance.id, definition, value))
    throw new Error(`Cannot assign component property: ${key}`)
}

/**
 * Set text, boolean, and swap properties an instance names as props, as in
 * `Title="Hello"`, the way it picks a variant; design JSX props keep their meaning.
 */
export function assignNamedProperties(
  graph: SceneGraph,
  instance: SceneNode,
  props: Record<string, unknown>
): void {
  const definitions = componentPropertyDefinitions(graph, instance).filter(
    (definition) => definition.type !== 'VARIANT'
  )
  for (const [key, value] of Object.entries(props)) {
    if (DESIGN_JSX_SUPPORTED_PROPERTIES.has(key)) continue
    const definition = namedDefinition(definitions, key)
    if (!definition) continue
    if (typeof value !== 'string' && typeof value !== 'boolean' && typeof value !== 'number')
      throw new Error(`Expected a string or boolean for component property: ${key}`)
    assignValue(graph, instance, definition, key, String(value))
  }
}

/**
 * Keys are property IDs or, because saving to `.fig` replaces authored IDs
 * with GUIDs, names, which survive a reload.
 */
export function assignComponentProperties(
  graph: SceneGraph,
  instance: SceneNode,
  input: unknown
): void {
  if (input === undefined) return
  const assignments = parseScriptInput(
    'Invalid properties on <Instance>',
    v.record(v.string(), v.string()),
    input
  )
  const definitions = componentPropertyDefinitions(graph, instance)
  for (const [key, value] of Object.entries(assignments)) {
    const definition =
      definitions.find((item) => item.id === key) ?? namedDefinition(definitions, key)
    if (!definition) throw new Error(`Unknown component property: ${key}`)
    assignValue(graph, instance, definition, key, value)
  }
}

function parseVariantValues(name: string): Record<string, string> {
  const entries = compact(name.split(',').map((part) => part.trim()))
  const values: Record<string, string> = {}
  for (const entry of entries) {
    const [key = '', ...rest] = entry.split('=')
    const property = key.trim()
    const value = rest.join('=').trim()
    if (property && value) values[property] = value
  }
  return values
}

/** Variant properties a component set takes from its variants' names, such as `State=On`. */
export function inferComponentSetProperties(graph: SceneGraph, componentSetId: string): void {
  const componentSet = graph.getNode(componentSetId)
  if (componentSet?.type !== 'COMPONENT_SET') return
  const existingDefinitions = componentSet.componentPropertyDefinitions

  const variants = graph.getChildren(componentSetId).filter((node) => node.type === 'COMPONENT')
  const options = new Map<string, Set<string>>()
  const valuesById = new Map<string, Record<string, string>>()

  for (const variant of variants) {
    const values = parseVariantValues(variant.name)
    valuesById.set(variant.id, values)
    for (const [property, value] of Object.entries(values)) {
      let set = options.get(property)
      if (!set) {
        set = new Set()
        options.set(property, set)
      }
      set.add(value)
    }
  }

  const definitions: ComponentPropertyDefinition[] = [...options.entries()]
    .filter(
      ([name]) =>
        !existingDefinitions.some(
          (definition) => definition.type === 'VARIANT' && definition.name === name
        )
    )
    .map(([name, values]) => {
      const variantOptions = [...values]
      return {
        id: createComponentPropertyId(),
        name,
        type: 'VARIANT',
        defaultValue: variantOptions[0] ?? '',
        variantOptions
      }
    })

  for (const [id, values] of valuesById) {
    graph.updateNode(id, { componentPropertyValues: values })
  }
  graph.updateNode(componentSetId, {
    componentPropertyDefinitions: [...existingDefinitions, ...definitions]
  })
}

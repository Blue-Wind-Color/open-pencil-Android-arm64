import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { CONSTRAINT, MASK_TYPE } from '../enums'
import type { getNodeContext } from './helpers'
import { helperCall, type JSXProp, type JSXValue } from './value'

/** Constraints apply where a parent does not lay its children out. */
function hasConstraints(node: SceneNode, ctx: ReturnType<typeof getNodeContext>): boolean {
  return !ctx.parentIsAutoLayout || node.layoutPositioning === 'ABSOLUTE'
}

function collectConstraintProps(
  node: SceneNode,
  ctx: ReturnType<typeof getNodeContext>,
  props: JSXProp[]
): void {
  if (!hasConstraints(node, ctx)) return
  const horizontal = node.horizontalConstraint === 'MIN' ? undefined : node.horizontalConstraint
  const vertical = node.verticalConstraint === 'MIN' ? undefined : node.verticalConstraint
  if (!horizontal && !vertical) return
  props.push([
    'constraints',
    {
      horizontal: horizontal && CONSTRAINT.print(horizontal),
      vertical: vertical && CONSTRAINT.print(vertical)
    }
  ])
}

function collectSizeLimitProps(node: SceneNode, props: JSXProp[]): void {
  if (node.minWidth != null) props.push(['minW', node.minWidth])
  if (node.maxWidth != null) props.push(['maxW', node.maxWidth])
  if (node.minHeight != null) props.push(['minH', node.minHeight])
  if (node.maxHeight != null) props.push(['maxH', node.maxHeight])
}

/**
 * Variables are named as `designVar` resolves them: by name when it is unique in the document, by
 * collection and name when that pair is, and by ID otherwise.
 */
function variableRef(graph: SceneGraph, variableId: string): JSXValue {
  const variable = graph.variables.get(variableId)
  if (!variable) return variableId
  const sameName = [...graph.variables.values()].filter((v) => v.name === variable.name)
  if (sameName.length === 1) return helperCall('designVar', variable.name)
  const collection = graph.variableCollections.get(variable.collectionId)
  const sameCollectionName = [...graph.variableCollections.values()].filter(
    (item) => item.name === collection?.name
  )
  const inCollection = sameName.filter((v) => v.collectionId === variable.collectionId)
  return collection && sameCollectionName.length === 1 && inCollection.length === 1
    ? helperCall('designVar', collection.name, variable.name)
    : variableId
}

function collectBindingProps(node: SceneNode, graph: SceneGraph, props: JSXProp[]): void {
  const bindings = Object.entries(node.boundVariables).toSorted(([a], [b]) => a.localeCompare(b))
  if (bindings.length === 0) return
  props.push([
    'bind',
    Object.fromEntries(bindings.map(([field, id]) => [field, variableRef(graph, id)]))
  ])
}

/**
 * The modes a layer pins, as `designMode` names them: by the collection's name when it is unique
 * in the document and by its ID otherwise. One is written without a list.
 */
function collectModeProps(node: SceneNode, graph: SceneGraph, props: JSXProp[]): void {
  const collections = [...graph.variableCollections.values()]
  const modes = Object.entries(node.variableModes).flatMap(([collectionId, modeId]) => {
    const collection = graph.variableCollections.get(collectionId)
    const mode = collection?.modes.find((item) => item.modeId === modeId)
    if (!collection || !mode) return []
    const unique = collections.filter((item) => item.name === collection.name).length === 1
    return [helperCall('designMode', unique ? collection.name : collection.id, mode.name)]
  })
  if (modes.length > 0) props.push(['mode', modes.length === 1 ? modes[0] : modes])
}

export function collectStateProps(
  node: SceneNode,
  ctx: ReturnType<typeof getNodeContext>,
  graph: SceneGraph,
  props: JSXProp[]
): void {
  collectConstraintProps(node, ctx, props)
  collectSizeLimitProps(node, props)
  if (node.isMask) props.push(['mask', MASK_TYPE.print(node.maskType)])
  if (!node.visible) props.push(['visible', false])
  if (node.locked) props.push(['locked', true])
  collectModeProps(node, graph, props)
  collectBindingProps(node, graph, props)
}

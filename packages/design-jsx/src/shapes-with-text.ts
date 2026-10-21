import * as v from 'valibot'

import {
  createShapeWithText,
  SHAPE_WITH_TEXT_CORNER_RADIUS,
  SHAPE_WITH_TEXT_SIZE,
  shapeWithTextLabel,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

import {
  enumProp,
  FIGJAM_TEXT_SIZE,
  FIGJAM_TYPEFACE,
  SHAPE_KIND,
  STROKE_ALIGN,
  STROKE_CAP,
  STROKE_JOIN
} from './enums'
import { collectFillProps, collectStrokeProps } from './export/paint'
import type { JSXProp } from './export/value'
import { figJamTextFields, figJamTextProps } from './figjam-text'
import { isFillValue } from './overrides/fills'
import { isStrokeValue } from './overrides/strokes'
import { plainTextOf, type TreeNode } from './tree'
import { ColorProp, PlacedOwnLayerProps, readElementProps } from './validation'

/**
 * `<Shape kind="diamond" bg="#FFC943">Decide</Shape>`: a FigJam shape with text, made from the
 * same template as the shape tool's. Its text is the label.
 */
export const SHAPE_ELEMENT = 'shape'

const Size = v.pipe(v.number(), v.gtValue(0))
const Dash = v.array(v.number())

/**
 * The layer props a shape has: its place, the size it is given, which it grows past to fit its
 * label, and its paint. The label is styled as FigJam styles it, and the shape lays it out.
 */
export const ShapeLayerProps = v.object({
  ...PlacedOwnLayerProps.entries,
  w: v.optional(Size),
  h: v.optional(Size),
  rotate: v.optional(v.number()),
  rounded: v.optional(v.pipe(v.number(), v.minValue(0))),
  bg: v.optional(v.custom(isFillValue, 'expected a colour or a paint')),
  fills: v.optional(v.array(v.custom(isFillValue, 'expected a colour or a paint'))),
  stroke: v.optional(ColorProp),
  strokeWidth: v.optional(Size),
  strokeAlign: v.optional(enumProp(STROKE_ALIGN)),
  strokeDash: v.optional(Dash),
  strokes: v.optional(v.array(v.custom(isStrokeValue, 'expected a stroke'))),
  strokeCap: v.optional(enumProp(STROKE_CAP)),
  strokeJoin: v.optional(enumProp(STROKE_JOIN)),
  dashPattern: v.optional(Dash)
})

/**
 * The props `<Shape>` takes: its kind, whether it keeps its height and truncates its label as a
 * resized FigJam shape does, and the layer props a shape has.
 */
export const ShapeProps = v.object({
  kind: v.optional(enumProp(SHAPE_KIND)),
  truncate: v.optional(v.boolean()),
  textSize: v.optional(enumProp(FIGJAM_TEXT_SIZE)),
  typeface: v.optional(enumProp(FIGJAM_TYPEFACE)),
  ...ShapeLayerProps.entries
})

/**
 * The shape an element describes, with `layer`'s fields; it is named by its label, as FigJam
 * names a shape, until given a name.
 */
export function renderShapeNode(
  graph: SceneGraph,
  tree: TreeNode,
  parentId: string,
  layer: Partial<SceneNode>
) {
  const props = readElementProps(ShapeProps, tree.props)
  const text = plainTextOf(tree)
  const shape = createShapeWithText(
    graph,
    parentId,
    {
      ...layer,
      name: layer.name ?? (text.trim() || 'Shape with text'),
      autoRename: !layer.name,
      shapeWithTextType: props.kind ?? 'SQUARE',
      shapeTruncates: props.truncate ?? false
    },
    { text }
  )
  const label = shapeWithTextLabel(graph, shape)
  if (label) graph.updateNode(label.id, figJamTextFields(label, props.textSize, props.typeface))
  return shape
}

/**
 * A shape's own props as `<Shape>` writes them, after its name and position: the height it was
 * given rather than the height its label grew it to, so it grows the same way when read back.
 */
export function shapeWithTextProps(graph: SceneGraph, node: SceneNode): JSXProp[] {
  const props: JSXProp[] = []
  if (node.shapeWithTextType !== 'SQUARE') {
    props.push(['kind', SHAPE_KIND.print(node.shapeWithTextType)])
  }
  const label = shapeWithTextLabel(graph, node)
  if (label) props.push(...figJamTextProps(label))
  // A truncating shape keeps the height it has; any other grows from the height it was given.
  const height =
    !node.shapeTruncates && node.shapeUserHeight > 0 ? node.shapeUserHeight : node.height
  if (node.width !== SHAPE_WITH_TEXT_SIZE) props.push(['w', node.width])
  if (height !== SHAPE_WITH_TEXT_SIZE) props.push(['h', height])
  if (node.shapeTruncates) props.push(['truncate', true])
  if (node.rotation !== 0) props.push(['rotate', Math.round(node.rotation * 100) / 100])
  collectFillProps(node, props)
  collectStrokeProps(node, props)
  if (node.cornerRadius !== SHAPE_WITH_TEXT_CORNER_RADIUS)
    props.push(['rounded', node.cornerRadius])
  return props
}

/** The label a shape writes as its children. */
export function shapeWithTextLabelText(graph: SceneGraph, node: SceneNode): string {
  return shapeWithTextLabel(graph, node)?.text ?? ''
}

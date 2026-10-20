import * as v from 'valibot'

import {
  createSticky,
  isWideSticky,
  STICKY_COLORS,
  stickyScale,
  stickySublayers,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'
import { colorToHex, tryParseColor } from '@open-pencil/scene-graph/color'
import type { Color } from '@open-pencil/scene-graph/primitives'

import { enumProp, FIGJAM_TEXT_SIZE, FIGJAM_TYPEFACE } from './enums'
import { figJamTextFields, figJamTextProps } from './figjam-text'
import { plainTextOf, type TreeNode } from './tree'
import { PlacedOwnLayerProps, readElementProps } from './validation'

/**
 * `<Sticky color="yellow" author="Ada">Body</Sticky>`: a FigJam sticky note, made from the same
 * template as the sticky tool's.
 */
export const STICKY_ELEMENT = 'sticky'

type StickyColorName = keyof typeof STICKY_COLORS

function isStickyColorName(value: string): value is StickyColorName {
  return value in STICKY_COLORS
}

/** A palette name such as `"yellow"`, or any colour. */
const StickyColor = v.pipe(
  v.string(),
  v.rawTransform(({ dataset, addIssue, NEVER }): Color => {
    const name = dataset.value
    if (isStickyColorName(name)) return { ...STICKY_COLORS[name] }
    const color = tryParseColor(name)
    if (color) return color
    addIssue({ message: `expected ${Object.keys(STICKY_COLORS).join(', ')}, or a colour` })
    return NEVER
  })
)

/** The layer props a note has: those that place it, but no size, fills, or layout. */
export const StickyLayerProps = PlacedOwnLayerProps

/** The props `<Sticky>` takes: its own, and the few layer props a note has. */
export const StickyProps = v.object({
  color: v.optional(StickyColor),
  author: v.optional(v.string()),
  authorVisible: v.optional(v.boolean()),
  wide: v.optional(v.boolean()),
  textSize: v.optional(enumProp(FIGJAM_TEXT_SIZE)),
  typeface: v.optional(enumProp(FIGJAM_TYPEFACE)),
  scale: v.optional(v.pipe(v.number(), v.gtValue(0))),
  ...StickyLayerProps.entries
})

/**
 * The note an element describes, with `layer`'s fields; it is named by its body, as FigJam names
 * a note, until given a name.
 */
export function renderStickyNode(
  graph: SceneGraph,
  tree: TreeNode,
  parentId: string,
  layer: Partial<SceneNode>
) {
  const props = readElementProps(StickyProps, tree.props)
  const text = plainTextOf(tree)
  const author = props.author ?? ''
  const sticky = createSticky(
    graph,
    parentId,
    {
      text,
      author,
      authorVisible: props.authorVisible !== false && author !== '',
      color: props.color,
      wide: props.wide === true,
      scale: props.scale ?? 1
    },
    { ...layer, name: layer.name ?? (text.trim() || 'Sticky'), autoRename: !layer.name }
  )
  const body = stickySublayers(graph, sticky)?.body
  if (body) graph.updateNode(body.id, figJamTextFields(body, props.textSize, props.typeface))
  return sticky
}

/** The colour as `<Sticky>` writes it: its palette name, or a hex colour off the palette. */
function colorName(color: Color): string {
  const hex = colorToHex(color)
  const named = Object.entries(STICKY_COLORS).find(([, value]) => colorToHex(value) === hex)
  return named ? named[0] : hex
}

/** A note's own props as `<Sticky>` writes them, after its name and position. */
export function stickyProps(graph: SceneGraph, node: SceneNode): Array<[string, unknown]> {
  const layers = stickySublayers(graph, node)
  const color = node.fills.at(0)?.color
  const props: Array<[string, unknown]> = []
  if (color) props.push(['color', colorName(color)])
  if (layers?.author.text) props.push(['author', layers.author.text])
  if (layers?.author.text && !layers.author.visible) props.push(['authorVisible', false])
  if (isWideSticky(graph, node)) props.push(['wide', true])
  if (layers) props.push(...figJamTextProps(layers.body))
  const scale = layers ? stickyScale(layers.author) : 1
  if (scale !== 1) props.push(['scale', scale])
  return props
}

/** The body a note writes as its children. */
export function stickyBody(graph: SceneGraph, node: SceneNode): string {
  return stickySublayers(graph, node)?.body.text ?? ''
}

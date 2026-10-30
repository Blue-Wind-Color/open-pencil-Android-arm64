import type { SceneGraph } from './graph'
import type {
  CharacterStyleOverride,
  SceneNode,
  SharedStyle,
  SharedStyleKind,
  SharedStyleType
} from './types'

const STYLE_REF_KEYS = {
  fill: 'fillStyleId',
  stroke: 'strokeStyleId',
  text: 'textStyleId',
  effect: 'effectStyleId',
  grid: 'gridStyleId'
} as const satisfies Record<SharedStyleKind, keyof SceneNode>

/** The fields that link a layer to its shared styles. */
export const STYLE_LINK_FIELDS = Object.values(STYLE_REF_KEYS)

const STYLE_TYPES = {
  fill: 'FILL',
  stroke: 'FILL',
  text: 'TEXT',
  effect: 'EFFECT',
  grid: 'GRID'
} as const satisfies Record<SharedStyleKind, SharedStyleType>

/** The fields a text style gives what uses it; changing one leaves the style. */
export const SHARED_TEXT_STYLE_FIELDS = [
  'fontFamily',
  'fontWeight',
  'italic',
  'fontStyle',
  'fontSize',
  'lineHeight',
  'letterSpacing',
  'textDecoration',
  'textCase',
  'fontFeatures'
] as const satisfies readonly (keyof SceneNode)[]

/**
 * The paragraph fields a text style also gives the whole text; a range takes only the character
 * ones. Changing one leaves the style, and a cleared style resets them (live-verified).
 */
const TEXT_STYLE_PARAGRAPH_FIELDS = [
  'paragraphSpacing',
  'paragraphIndent',
  'listSpacing'
] as const satisfies readonly (keyof SceneNode)[]

/** The fields each kind of shared style gives what uses it; changing one leaves the style. */
export const SHARED_STYLE_FIELDS = {
  fill: ['fills'],
  stroke: ['strokes'],
  text: [...SHARED_TEXT_STYLE_FIELDS, ...TEXT_STYLE_PARAGRAPH_FIELDS],
  effect: ['effects'],
  grid: ['layoutGrids']
} as const satisfies Record<SharedStyleKind, readonly (keyof SceneNode)[]>

/** The fields that pick a text's face, which its style name names. */
export const FACE_KEYS = [
  'fontFamily',
  'fontWeight',
  'italic'
] as const satisfies readonly (keyof SceneNode)[]

/**
 * The face name of characters with `style` over the text: their own, none where they set another
 * face without one (as ranges from HTML or `.pen` do), else the text's.
 */
export function rangeFontStyle(
  node: Pick<SceneNode, 'fontStyle'>,
  style: CharacterStyleOverride
): string | null {
  if (style.fontStyle !== undefined) return style.fontStyle
  return FACE_KEYS.some((key) => style[key] !== undefined) ? null : node.fontStyle
}

export function sharedStyleRefKey(kind: SharedStyleKind): (typeof STYLE_REF_KEYS)[SharedStyleKind] {
  return STYLE_REF_KEYS[kind]
}

export function sharedStyleTypeForKind(kind: SharedStyleKind): SharedStyleType {
  return STYLE_TYPES[kind]
}

export function getSharedStyles(graph: SceneGraph, kind: SharedStyleKind): SharedStyle[] {
  const type = sharedStyleTypeForKind(kind)
  const styles: SharedStyle[] = []
  for (const node of graph.getAllNodes()) {
    if (node.sharedStyleType !== type || !node.source.id) continue
    styles.push({ id: node.source.id, nodeId: node.id, name: node.name, type })
  }
  return styles.sort((left, right) => left.name.localeCompare(right.name))
}

export function styleDetachmentChanges(
  node: SceneNode,
  changes: Partial<SceneNode>
): Partial<SceneNode> {
  const next = { ...changes }
  for (const [kind, fields] of Object.entries(SHARED_STYLE_FIELDS)) {
    const reference = STYLE_REF_KEYS[kind as SharedStyleKind]
    if (reference in changes || !node[reference]) continue
    if (fields.some((field) => field in changes)) next[reference] = null
  }
  // A face named for another family, weight, or slant names none; the new one takes its own name.
  const changesFace = FACE_KEYS.some((key) => key in changes && changes[key] !== node[key])
  if (changesFace && !('fontStyle' in changes) && node.fontStyle) {
    next.fontStyle = null
  }
  return next
}

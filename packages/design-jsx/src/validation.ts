import { mapValues } from 'es-toolkit/object'
import * as v from 'valibot'

import { tryParseColor } from '@open-pencil/scene-graph/color'
import type { Color } from '@open-pencil/scene-graph/primitives'

import { isColor } from './overrides/fills'
import { isVariable } from './vars'

/**
 * Parse a value a design JSX script passed, or throw `heading` followed by every problem and
 * where it is, as `v.summarize` lists them. Core words tool arguments the same way.
 */
export function parseScriptInput<S extends v.GenericSchema>(
  heading: string,
  schema: S,
  value: unknown
): v.InferOutput<S> {
  const result = v.safeParse(schema, value)
  if (result.success) return result.output
  throw new Error(`${heading}:\n${v.summarize(result.issues)}`)
}

/**
 * The layer props an element that draws its own layer takes, such as a connector's: the
 * renderer makes them into fields and variable bindings as it does for any layer.
 */
export const OwnLayerProps = v.object({
  name: v.optional(v.string()),
  key: v.optional(v.unknown()),
  visible: v.optional(v.boolean()),
  opacity: v.optional(v.number())
})

/** `OwnLayerProps` and the props that place a layer in its parent, such as a sticky note's. */
export const PlacedOwnLayerProps = v.object({
  ...OwnLayerProps.entries,
  x: v.optional(v.number()),
  y: v.optional(v.number()),
  position: v.optional(v.picklist(['absolute']))
})

/** A colour as a string, or as the colour a `designVar()` resolves to. */
export const ColorProp = v.union(
  [
    v.pipe(
      v.string(),
      v.rawTransform(({ dataset, addIssue, NEVER }): Color => {
        const color = tryParseColor(dataset.value)
        if (color) return color
        addIssue({ message: 'expected a colour' })
        return NEVER
      })
    ),
    v.custom<Color>(isColor)
  ],
  'expected a colour'
)

/** The props of an element read one at a time, each of them optional. */
export type ElementPropsSchema = v.ObjectSchema<v.ObjectEntries, undefined>

/**
 * The props `schema` takes, read from `props`: one that does not fit is left out as if it were
 * not set, since the renderer reports it (`elementPropWarnings`) and goes on.
 */
export function readElementProps<S extends ElementPropsSchema>(
  schema: S,
  props: Readonly<Record<string, unknown>>
): v.InferOutput<S> {
  const fitting = mapValues(schema.entries, (entry, key) =>
    v.is(entry, props[key]) ? props[key] : undefined
  )
  return v.parse(schema, fitting)
}

/** A value as a warning quotes it; one JSON cannot write, such as a BigInt inside it, by its brackets. */
function quoted(value: unknown): string {
  if (typeof value === 'string') return `"${value}"`
  if (typeof value !== 'object' || value === null) return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return Array.isArray(value) ? '[…]' : '{…}'
  }
}

/** A warning for each prop `props` sets that does not fit `schema`, naming the element. */
export function elementPropWarnings(
  schema: ElementPropsSchema,
  props: Readonly<Record<string, unknown>>,
  element: string
): string[] {
  return Object.entries(schema.entries).flatMap(([key, entry]) => {
    const value = props[key]
    // A `designVar()` resolves to its value before the element reads it.
    if (value === undefined || isVariable(value)) return []
    const result = v.safeParse(entry, value)
    if (result.success) return []
    const [issue] = result.issues
    const source = `${key} ${quoted(value)} on <${element}> is ignored`
    // A reader of its own, such as an enum's, names what it takes.
    if (issue.kind === 'transformation') return [`Unknown ${source}; ${issue.message}.`]
    // A choice of kinds names them; a single type or bound is Valibot's to name.
    if (issue.type === 'union' || issue.type === 'custom')
      return [`Invalid ${source}; ${issue.message}.`]
    return [`Invalid ${source}; expected ${issue.expected}.`]
  })
}

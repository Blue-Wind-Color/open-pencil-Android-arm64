import type { CompletionSource } from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'

/** A variable the field can refer to, as its completion list shows it. */
export interface ReferenceCompletion {
  label: string
  /** The collection, which groups the list as the variable picker does. */
  section: string
  /** The variable's current value, shown at the row's end. */
  detail: string
  /** The reference as the field's text spells it, such as `{space/md}` or `var(--space-md)`. */
  insert: string
}

/** A finished reference in the text, which the field shows as a pill. */
export interface ReferenceRange {
  source: string
  from: number
  to: number
}

/**
 * One syntax a value field edits: a formula over variables, or a CSS value. Each has its own
 * language, so completion reads the syntax tree, and its own reference spelling for pills.
 */
export interface ExpressionDialect {
  language: Extension
  complete: (references: () => readonly ReferenceCompletion[]) => CompletionSource
  references: (source: string) => ReferenceRange[]
}

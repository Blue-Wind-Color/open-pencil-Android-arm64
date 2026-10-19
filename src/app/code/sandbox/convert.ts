import { mapValues } from 'es-toolkit'

import {
  angularGradient,
  backgroundBlur,
  designVar,
  defineVars,
  diamondGradient,
  dropShadow,
  foregroundBlur,
  gradient,
  innerShadow,
  layerBlur,
  linearGradient,
  radialGradient,
  ref as layerRef,
  solid,
  type LayerRef,
  type TreeNode
} from '@open-pencil/design-jsx'

import type { DesignJSXHelperDescriptor } from '@/app/code/sandbox/types'

const HELPERS = {
  solid,
  gradient,
  linearGradient,
  radialGradient,
  angularGradient,
  diamondGradient,
  dropShadow,
  innerShadow,
  layerBlur,
  backgroundBlur,
  foregroundBlur,
  designVar,
  defineVars
}

type HelperName = keyof typeof HELPERS

type PlainRecord = { [key: string]: unknown }

type SerializedDesignJSXElement = {
  type: string
  props: PlainRecord
  children: unknown[]
  /** The line the transform reports, when the element's source line is known. */
  source?: unknown
}

function sourceLine(value: unknown, lineOffset: number | undefined): number | undefined {
  if (lineOffset === undefined || typeof value !== 'number') return undefined
  return lineOffset + value
}

function isRecord(value: unknown): value is PlainRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isSerializedElement(value: unknown): value is SerializedDesignJSXElement {
  return (
    isRecord(value) &&
    typeof value.type === 'string' &&
    isRecord(value.props) &&
    Array.isArray(value.children)
  )
}

function isHelper(value: unknown): value is DesignJSXHelperDescriptor {
  return (
    isRecord(value) && typeof value.__openPencilHelper === 'string' && Array.isArray(value.args)
  )
}

/** The handle each numbered `ref()` of one evaluation stands for. */
type RefHandles = Map<unknown, LayerRef>

function convertValue(value: unknown, refs: RefHandles): unknown {
  if (isHelper(value)) {
    const helperName = value.__openPencilHelper
    if (helperName === 'ref') {
      const [number] = value.args
      const handle = refs.get(number) ?? layerRef()
      refs.set(number, handle)
      return handle
    }
    const helper = Object.hasOwn(HELPERS, helperName)
      ? (HELPERS[helperName as HelperName] as (...args: unknown[]) => unknown)
      : undefined
    if (typeof helper !== 'function') {
      throw new TypeError(`Unknown Design JSX helper "${helperName}".`)
    }
    return helper(...value.args.map((arg) => convertValue(arg, refs)))
  }
  if (Array.isArray(value)) return value.map((item) => convertValue(item, refs))
  if (isRecord(value)) return mapValues(value, (entry) => convertValue(entry, refs))
  return value
}

function convertTree(value: unknown, refs: RefHandles, lineOffset?: number): TreeNode {
  if (!isSerializedElement(value)) {
    throw new Error('Design JSX must return an OpenPencil element.')
  }
  const children = value.children.map((child): TreeNode | string => {
    if (typeof child === 'string') return child
    if (typeof child === 'number') return String(child)
    return convertTree(child, refs, lineOffset)
  })
  const tree: TreeNode = {
    type: value.type,
    props: convertValue(value.props, refs) as PlainRecord,
    children
  }
  const line = sourceLine(value.source, lineOffset)
  if (line !== undefined) tree.source = { line }
  return tree
}

export function convertDesignJSXRoots(values: unknown[], lineOffset?: number): TreeNode[] {
  // Call validateDesignJSXOutput first; it enforces the depth bound used by this recursion.
  const refs: RefHandles = new Map()
  return values.map((value) => convertTree(value, refs, lineOffset))
}

import {
  generateId,
  type SceneGraph,
  type SceneNode,
  type Variable,
  type VariableCollection,
  type VariableCollectionMode,
  type VariableType,
  type VariableValue
} from '@open-pencil/scene-graph'
import { parseColor } from '@open-pencil/scene-graph/color'
import { BLACK } from '@open-pencil/scene-graph/constants'
import type { Color } from '@open-pencil/scene-graph/primitives'

import type { PenNumber, PenVariable, PenVariableScalar } from './schema'

export interface VarContext {
  byName: Map<string, { id: string; variable: Variable }>
  activeModeId: string
  collectionId: string
  modeByThemeName: Map<string, string>
  resolveColor(ref: string): Color
  resolveNumber(ref: string): number
  resolveString(ref: string): string
  resolveBoolean(ref: string): boolean
  setActiveTheme(themeName: string): void
}

function penVarTypeToSceneType(t: string): VariableType {
  if (t === 'color') return 'COLOR'
  if (t === 'number') return 'FLOAT'
  if (t === 'boolean') return 'BOOLEAN'
  return 'STRING'
}

function penValueToSceneValue(raw: PenVariableScalar, type: VariableType): VariableValue {
  if (type === 'COLOR' && typeof raw === 'string') return parseColor(raw)
  if (type === 'STRING') return String(raw)
  return raw
}

function defaultForType(type: VariableType): VariableValue {
  if (type === 'COLOR') return { ...BLACK }
  if (type === 'FLOAT') return 0
  if (type === 'BOOLEAN') return false
  return ''
}

export function isVarRef(val: unknown): val is string {
  return typeof val === 'string' && val.startsWith('$') && val.length > 1
}

function varName(ref: string): string {
  return ref.replace(/^\$/, '')
}

export function bindIfVar(node: SceneNode, field: string, val: unknown, ctx: VarContext): void {
  if (!isVarRef(val)) return
  const entry = ctx.byName.get(varName(val))
  if (entry) node.boundVariables[field] = entry.id
}

/** A number, or the value of the number variable it references. */
export function resolveNumber(value: PenNumber | undefined, ctx: VarContext, fallback = 0): number {
  if (value === undefined) return fallback
  if (typeof value === 'number') return value
  if (isVarRef(value)) return ctx.resolveNumber(value)
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** A boolean, or the value of the variable it references. */
export function resolveBoolean(
  value: boolean | string | undefined,
  ctx: VarContext,
  fallback = true
): boolean {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value
  return isVarRef(value) ? ctx.resolveBoolean(value) : value !== 'false'
}

/** A colour, or the value of the colour variable it references. */
export function resolveColor(value: string, ctx: VarContext): Color {
  return isVarRef(value) ? ctx.resolveColor(value) : parseColor(value)
}

export function buildVarContext(
  graph: SceneGraph,
  penVars: Record<string, PenVariable>,
  themes: Record<string, string[]>
): VarContext {
  const collectionId = generateId()
  const modes: VariableCollectionMode[] = []
  const themeKeys = Object.keys(themes)

  if (themeKeys.length > 0) {
    const themeKey = themeKeys[0]
    for (const modeName of themes[themeKey]) {
      modes.push({ modeId: generateId(), name: modeName })
    }
  }
  if (modes.length === 0) {
    modes.push({ modeId: generateId(), name: 'Default' })
  }

  const collection: VariableCollection = {
    id: collectionId,
    name: 'Variables',
    modes,
    defaultModeId: modes[0].modeId,
    variableIds: []
  }
  graph.addCollection(collection)

  const modeByThemeValue = new Map<string, string>()
  if (themeKeys.length > 0) {
    const themeKey = themeKeys[0]
    for (const mode of modes) {
      modeByThemeValue.set(`${themeKey}:${mode.name}`, mode.modeId)
    }
  }

  const byName = new Map<string, { id: string; variable: Variable }>()

  for (const [name, def] of Object.entries(penVars)) {
    const varId = generateId()
    const varType = penVarTypeToSceneType(def.type)
    const valuesByMode: Record<string, VariableValue> = {}

    if (Array.isArray(def.value)) {
      for (const entry of def.value) {
        if (entry.theme) {
          const [tKey, tVal] = Object.entries(entry.theme)[0]
          const modeId = modeByThemeValue.get(`${tKey}:${tVal}`)
          if (modeId) valuesByMode[modeId] = penValueToSceneValue(entry.value, varType)
        } else {
          valuesByMode[modes[0].modeId] = penValueToSceneValue(entry.value, varType)
        }
      }
    } else {
      valuesByMode[modes[0].modeId] = penValueToSceneValue(def.value, varType)
    }

    for (const mode of modes) {
      if (!(mode.modeId in valuesByMode)) {
        valuesByMode[mode.modeId] = valuesByMode[modes[0].modeId] ?? defaultForType(varType)
      }
    }

    const variable: Variable = {
      id: varId,
      name,
      type: varType,
      collectionId,
      valuesByMode,
      description: '',
      hiddenFromPublishing: false
    }
    graph.addVariable(variable)
    byName.set(name, { id: varId, variable })
  }

  let activeModeId = modes[0].modeId

  function resolveVal(ref: string): VariableValue | undefined {
    const entry = byName.get(varName(ref))
    if (!entry) return undefined
    return (
      entry.variable.valuesByMode[activeModeId] ?? Object.values(entry.variable.valuesByMode)[0]
    )
  }

  return {
    byName,
    activeModeId,
    collectionId,
    modeByThemeName: modeByThemeValue,
    resolveColor(ref: string): Color {
      const val = resolveVal(ref)
      if (val === undefined) return parseColor(ref)
      if (typeof val === 'object' && 'r' in val) return val
      if (typeof val === 'string') return parseColor(val)
      return { ...BLACK }
    },
    resolveNumber(ref: string): number {
      const val = resolveVal(ref)
      return typeof val === 'number' ? val : 0
    },
    resolveString(ref: string): string {
      const val = resolveVal(ref)
      return typeof val === 'string' ? val : ''
    },
    resolveBoolean(ref: string): boolean {
      const val = resolveVal(ref)
      return typeof val === 'boolean' ? val : val !== undefined && val !== 'false'
    },
    setActiveTheme(themeName: string) {
      const modeId = modeByThemeValue.get(`theme:${themeName}`)
      if (modeId) {
        activeModeId = modeId
        graph.activeMode.set(collectionId, modeId)
      }
    }
  }
}

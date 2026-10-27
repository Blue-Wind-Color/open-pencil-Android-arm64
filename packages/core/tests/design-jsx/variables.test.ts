import { describe, expect, test } from 'bun:test'

import { expectDefined } from '#core-tests/helpers/assert'

import { renderJSX, renderTree } from '@open-pencil/core/design-jsx'
import { defineMode, defineVars, Frame, Rectangle, sceneNodeToJSX } from '@open-pencil/design-jsx'
import { SceneGraph, type VariableCollection } from '@open-pencil/scene-graph'

const THEME = `
const palette = defineVars('Palette', { 'Gray/900': '#111111', 'Gray/50': '#FAFAFA' })
const theme = defineVars('Theme', { Page: palette['Gray/50'], Text: palette['Gray/900'], Radius: 12 }, { mode: 'Light' })
const dark = defineMode(theme, 'Dark', { Page: palette['Gray/900'], Text: palette['Gray/50'] })
return <Frame name="Card" mode={dark} bg={theme.Page} rounded={theme.Radius} w={100} h={100} />`

function collectionNamed(graph: SceneGraph, name: string): VariableCollection {
  const collection = [...graph.variableCollections.values()].find((item) => item.name === name)
  if (!collection) throw new Error(`Missing collection ${name}`)
  return collection
}

function table(graph: SceneGraph, name: string) {
  const collection = collectionNamed(graph, name)
  return Object.fromEntries(
    collection.variableIds.map((id) => {
      const variable = graph.variables.get(id)
      if (!variable) throw new Error(`Missing variable ${id}`)
      const values = collection.modes.map(({ modeId, name: mode }) => {
        const value = variable.valuesByMode[modeId]
        const shown =
          typeof value === 'object' && 'aliasId' in value
            ? `→ ${graph.variables.get(value.aliasId)?.name}`
            : value
        return [mode, shown]
      })
      return [variable.name, { type: variable.type, ...Object.fromEntries(values) }]
    })
  )
}

describe('Design JSX variable definitions', () => {
  test('create collections, modes, and aliases in the variables table', async () => {
    const graph = new SceneGraph()
    await renderJSX(graph, THEME)
    const theme = collectionNamed(graph, 'Theme')
    expect(theme.modes.map((mode) => mode.name)).toEqual(['Light', 'Dark'])
    expect(theme.defaultModeId).toBe(theme.modes[0].modeId)
    expect(collectionNamed(graph, 'Palette').modes.map((mode) => mode.name)).toEqual(['Mode 1'])
    expect(table(graph, 'Theme')).toEqual({
      Page: { type: 'COLOR', Light: '→ Gray/50', Dark: '→ Gray/900' },
      Text: { type: 'COLOR', Light: '→ Gray/900', Dark: '→ Gray/50' },
      Radius: { type: 'FLOAT', Light: 12, Dark: 12 }
    })
  })

  test('pin the mode on the layer and bind its fields with the values of that mode', async () => {
    const graph = new SceneGraph()
    const [card] = await renderJSX(graph, THEME)
    const node = graph.getNode(card.id)
    const theme = collectionNamed(graph, 'Theme')
    expect(node?.variableModes).toEqual({ [theme.id]: theme.modes[1].modeId })
    expect(node?.fills[0]?.color).toMatchObject({ r: 0x11 / 255, g: 0x11 / 255, b: 0x11 / 255 })
    expect(node?.cornerRadius).toBe(12)
    const page = theme.variableIds
      .map((id) => graph.variables.get(id))
      .find((item) => item?.name === 'Page')
    expect(node?.boundVariables['fills/0/color']).toBe(page?.id)
  })

  test('running the JSX again updates the collections it defined instead of adding new ones', async () => {
    const graph = new SceneGraph()
    await renderJSX(graph, THEME)
    await renderJSX(graph, THEME.replace('Radius: 12', 'Radius: 16'))
    expect([...graph.variableCollections.values()].map((item) => item.name)).toEqual([
      'Palette',
      'Theme'
    ])
    expect(graph.variables.size).toBe(5)
    expect(table(graph, 'Theme').Radius).toEqual({ type: 'FLOAT', Light: 16, Dark: 16 })
  })

  test('binding one variable brings its whole collection, unbound modes included', async () => {
    const graph = new SceneGraph()
    const space = defineVars('Spacing', { Small: 4, Large: 16 }, { mode: 'Comfortable' })
    defineMode(space, 'Compact', { Large: 8 })
    await renderTree(graph, Frame({ p: space.Large, children: Rectangle({ w: 10, h: 10 }) }))
    expect(table(graph, 'Spacing')).toEqual({
      Small: { type: 'FLOAT', Comfortable: 4, Compact: 4 },
      Large: { type: 'FLOAT', Comfortable: 16, Compact: 8 }
    })
  })

  test('reject values the variables cannot hold, and modes and names that do not exist', async () => {
    const graph = new SceneGraph()
    const invalid = defineVars('Broken', { Ink: 'not a color' })
    await expect(renderTree(graph, Frame({ bg: invalid.Ink }))).rejects.toThrow(
      'Variable Ink has "not a color", which is not a color'
    )
    const mixed = defineVars('Mixed', { Size: 4 })
    defineMode(mixed, 'Loud', { Size: '#FF0000' })
    await expect(renderTree(graph, Frame({ p: mixed.Size }))).rejects.toThrow(
      'Variable Size mixes FLOAT with COLOR values'
    )
    const theme = defineVars('Shades', { Page: '#FFFFFF' })
    expect(() => defineMode(theme, 'Dark', { Missing: '#000000' })).toThrow(
      'Collection Shades has no variable named Missing'
    )
    defineMode(theme, 'Dark', {})
    expect(() => defineMode(theme, 'Dark', {})).toThrow('already has a mode named Dark')
    await expect(renderJSX(graph, `<Frame mode={designMode('Nope', 'Dark')} />`)).rejects.toThrow(
      'Unknown variable collection: Nope'
    )
  })
})

test('export writes the modes a layer pins, and renders back into the same ones', async () => {
  const graph = new SceneGraph()
  const [card] = await renderJSX(graph, THEME)
  const exported = sceneNodeToJSX(card.id, graph)
  expect(exported).toContain('mode={designMode("Theme", "Dark")}')
  const [copy] = await renderJSX(graph, exported)
  expect(graph.getNode(copy.id)?.variableModes).toEqual(graph.getNode(card.id)?.variableModes)
})

test('artwork drawn in a variable binds its paths and resolves in its own mode', async () => {
  const graph = new SceneGraph()
  const [svg] = await renderJSX(
    graph,
    `const ink = defineVars('Ink', { Line: '#000000' }, { mode: 'Light' })
const dark = defineMode(ink, 'Dark', { Line: '#FFFFFF' })
return <svg mode={dark} color={ink.Line} w={10} h={10} body="<path d='M0 0h10v10H0z' fill='currentColor'/>" />`
  )
  const ink = collectionNamed(graph, 'Ink')
  const line = ink.variableIds[0]
  const node = graph.getNode(svg.id)
  expect(node?.variableModes).toEqual({ [ink.id]: ink.modes[1].modeId })
  const paths = graph.getChildren(svg.id).flatMap((child) => [child, ...graph.getChildren(child.id)])
  const painted = paths.find((child) => child.fills[0]?.type === 'SOLID')
  expect(painted?.boundVariables['fills/0/color']).toBe(line)
  expect(painted?.fills[0]?.color).toMatchObject({ r: 1, g: 1, b: 1 })
})

test('a variable whose value cannot be resolved is an error, not a dropped paint', async () => {
  const graph = new SceneGraph()
  const collection = graph.createCollection('Loop')
  const a = graph.createVariable('A', 'COLOR', collection.id)
  const b = graph.createVariable('B', 'COLOR', collection.id)
  a.valuesByMode[collection.defaultModeId] = { aliasId: b.id }
  b.valuesByMode[collection.defaultModeId] = { aliasId: a.id }
  await expect(renderJSX(graph, `<Frame bg={designVar('A')} />`)).rejects.toThrow(
    'Cannot resolve variable A for bg'
  )
  const size = graph.createCollection('Size')
  graph.createVariable('Gap', 'FLOAT', size.id, 4)
  for (const name of ['A', 'Gap']) {
    await expect(
      renderJSX(graph, `<svg color={designVar('${name}')} body="<path d='M0 0h1v1H0z'/>" />`)
    ).rejects.toThrow(`Cannot resolve color variable ${name} for color`)
  }
})

test('designVar names a variable by collection when several collections share its name', async () => {
  const graph = new SceneGraph()
  await renderJSX(graph, THEME)
  await renderJSX(graph, `const d = defineVars('Density', { Page: 8 }); return <Frame p={d.Page} />`)
  await expect(renderJSX(graph, `<Frame bg={designVar('Page')} />`)).rejects.toThrow(
    "Variable name Page is in more than one collection; name one, as in designVar('Theme', 'Page')"
  )
  await expect(renderJSX(graph, `<Frame bg={designVar('Theme', 'Missing')} />`)).rejects.toThrow(
    'Unknown variable Missing in Theme'
  )
  const [frame] = await renderJSX(
    graph,
    `<Frame bg={designVar('Theme', 'Page')} p={designVar('Density', 'Page')} />`
  )
  const node = graph.getNode(frame.id)
  const id = (collection: string) => {
    const owner = collectionNamed(graph, collection)
    return owner.variableIds.find((item) => graph.variables.get(item)?.name === 'Page')
  }
  expect(node?.boundVariables['fills/0/color']).toBe(id('Theme'))
  expect(node?.boundVariables.paddingTop).toBe(id('Density'))
  const exported = sceneNodeToJSX(frame.id, graph)
  expect(exported).toContain('designVar("Theme", "Page")')
  expect(exported).toContain('designVar("Density", "Page")')
  const [copy] = await renderJSX(graph, exported)
  expect(graph.getNode(copy.id)?.boundVariables).toEqual(node?.boundVariables)
})

test('a collection name several collections share is an error, not the first of them', async () => {
  const graph = new SceneGraph()
  for (const _ of [0, 1]) graph.createVariable('Ink', 'COLOR', graph.createCollection('Twin').id)
  for (const jsx of [
    `<Frame bg={designVar('Twin', 'Ink')} />`,
    `<Frame mode={designMode('Twin', 'Mode 1')} />`
  ]) {
    await expect(renderJSX(graph, jsx)).rejects.toThrow(
      'More than one variable collection is named Twin; rename one to use it'
    )
  }
  // Export names such a collection by its ID, which renders back into the same mode.
  const twin = expectDefined([...graph.variableCollections.values()].at(-1))
  const [frame] = await renderJSX(graph, '<Frame w={10} h={10} />')
  graph.updateNode(frame.id, { variableModes: { [twin.id]: twin.defaultModeId } })
  const exported = sceneNodeToJSX(frame.id, graph)
  expect(exported).toContain(`mode={designMode("${twin.id}", "Mode 1")}`)
  const [copy] = await renderJSX(graph, exported)
  expect(graph.getNode(copy.id)?.variableModes).toEqual({ [twin.id]: twin.defaultModeId })
})

test('a sticky note pins its mode and reads its values in it, as any layer does', async () => {
  const graph = new SceneGraph()
  const [board] = await renderJSX(
    graph,
    `const fade = defineVars('Fade', { Note: 1 }, { mode: 'Light' })
const dark = defineMode(fade, 'Dark', { Note: 0.5 })
return <Frame name="Board" w={400} h={400}><Sticky mode={dark} opacity={fade.Note}>Hi</Sticky></Frame>`
  )
  const [sticky] = graph.getChildren(board.id)
  const fade = collectionNamed(graph, 'Fade')
  expect(sticky.variableModes).toEqual({ [fade.id]: fade.modes[1].modeId })
  expect(sticky.opacity).toBe(0.5)
})

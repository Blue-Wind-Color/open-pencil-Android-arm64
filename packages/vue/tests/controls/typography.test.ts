import { afterAll, beforeAll, expect, test } from 'bun:test'

import { computed, effectScope, nextTick, shallowRef } from 'vue'

import { createEditor } from '@open-pencil/core'
import { DEFAULT_WEB_FONT_PROVIDER_SETTINGS, fontManager } from '@open-pencil/core/text'
import type { SceneNode } from '@open-pencil/scene-graph'

import { createTypographyActions } from '#vue/controls/typography/actions'
import { useFamilyFaces } from '#vue/controls/typography/faces'

// The faces Figma lists for these families (desktop 126), given as installed fonts so no test
// asks a web provider.
const LORA = [
  'Regular',
  'Medium',
  'SemiBold',
  'Bold',
  'Italic',
  'Medium Italic',
  'SemiBold Italic',
  'Bold Italic'
]
const OSWALD = ['ExtraLight', 'Light', 'Regular', 'Medium', 'SemiBold', 'Bold']
const CATALOG = [
  { family: 'Lora', styles: LORA },
  { family: 'Oswald', styles: OSWALD }
]

beforeAll(() => {
  fontManager.setOnlineFontProviders({})
  fontManager.setHostFontCatalog(CATALOG)
})

afterAll(() => {
  fontManager.setHostFontCatalog([])
  fontManager.setOnlineFontProviders(DEFAULT_WEB_FONT_PROVIDER_SETTINGS)
})

/** Two text layers, the typography actions over a selection, and a font load that waits. */
function setup() {
  const editor = createEditor()
  const page = editor.state.currentPageId
  const first = editor.graph.createNode('TEXT', page, { name: 'First', text: 'a' })
  const second = editor.graph.createNode('TEXT', page, { name: 'Second', text: 'b' })
  const selection = shallowRef<SceneNode[]>([first])
  let resolveLoading: (() => void) | undefined
  const loading = new Promise<void>((resolve) => {
    resolveLoading = resolve
  })
  const finishLoading = () => resolveLoading?.()
  const actions = createTypographyActions({
    editor,
    nodes: computed(() => selection.value),
    activeFormatting: computed(() => []),
    supports: () => true,
    options: { fontLoader: { load: () => loading } }
  })
  return { editor, first, second, selection, actions, finishLoading }
}

test('a weight waits for its face, then changes the layers selected when it was chosen', async () => {
  const { first, second, selection, actions, finishLoading } = setup()
  const applied = actions.setWeight(700)
  expect(first.fontWeight).toBe(400)
  selection.value = [second]
  finishLoading()
  await applied
  expect(first.fontWeight).toBe(700)
  expect(second.fontWeight).toBe(400)
})

test('a later choice wins over an earlier one whose face loads after it', async () => {
  const editor = createEditor()
  const text = editor.graph.createNode('TEXT', editor.state.currentPageId, { text: 'a' })
  const loads = new Map<string, () => void>()
  const actions = createTypographyActions({
    editor,
    nodes: computed(() => [text]),
    activeFormatting: computed(() => []),
    supports: () => true,
    options: {
      fontLoader: {
        load: (family) =>
          new Promise<void>((resolve) => {
            loads.set(family, resolve)
          })
      }
    }
  })
  /** Resolves a family's load once the change has asked for it, after reading its faces. */
  const finish = async (family: string) => {
    for (let tick = 0; tick < 50 && !loads.has(family); tick++) await Promise.resolve()
    loads.get(family)?.()
  }
  const slow = actions.setFamily('Roboto')
  const fast = actions.setFamily('Lora')
  await finish('Lora')
  await fast
  await finish('Roboto')
  await slow
  expect(text.fontFamily).toBe('Lora')
})

test('a family chosen while loading skips layers deleted in the meantime', async () => {
  const { editor, first, second, selection, actions, finishLoading } = setup()
  selection.value = [first, second]
  const applied = actions.setFamily('Roboto')
  editor.graph.deleteNode(first.id)
  finishLoading()
  await applied
  expect(editor.graph.getNode(second.id)?.fontFamily).toBe('Roboto')
  expect(editor.graph.getNode(first.id)).toBeUndefined()
})

/** Text layers in Inter at these styles, with typography actions and face lists over them. */
function styled(...faces: { fontWeight: number; italic?: boolean; fontFamily?: string }[]) {
  const editor = createEditor()
  const page = editor.state.currentPageId
  const texts = faces.map((face) =>
    editor.graph.createNode('TEXT', page, { text: 'a', fontFamily: 'Inter', ...face })
  )
  const nodes = computed(() => texts)
  const scope = effectScope()
  const lists = scope.run(() => useFamilyFaces(nodes))
  if (!lists) throw new Error('Expected family faces')
  const { weights, supports } = lists
  const actions = createTypographyActions({
    editor,
    nodes,
    activeFormatting: computed(() => []),
    supports,
    options: {}
  })
  return { texts, weights, actions, stop: () => scope.stop() }
}

test('a family switch keeps a face the family has, or takes the nearest weight, as in Figma', async () => {
  const { texts, actions } = styled(
    { fontWeight: 100 },
    { fontWeight: 900 },
    { fontWeight: 500, italic: true },
    { fontWeight: 900, italic: true }
  )
  await actions.setFamily('Lora')
  expect(texts.map((text) => [text.fontFamily, text.fontWeight, text.italic])).toEqual([
    ['Lora', 400, false],
    ['Lora', 700, false],
    ['Lora', 500, true],
    ['Lora', 700, true]
  ])
})

test('the weight list offers only the weights the family has', async () => {
  const { weights } = styled({ fontWeight: 400, fontFamily: 'Oswald' })
  await fontManager.familyFaces('Oswald')
  await nextTick()
  expect(weights.value.map((weight) => weight.value)).toEqual([200, 300, 400, 500, 600, 700])
})

test('italic does nothing on a family without italics, and bold goes to Bold', async () => {
  const { texts, actions } = styled({ fontWeight: 400, fontFamily: 'Oswald' })
  await fontManager.familyFaces('Oswald')
  actions.toggleItalic()
  await Promise.resolve()
  expect(texts[0].italic).toBe(false)
  actions.toggleBold()
  for (let tick = 0; tick < 5; tick++) await Promise.resolve()
  expect(texts[0].fontWeight).toBe(700)
})

test('the weight list follows a font catalog that arrives after the first lookup', async () => {
  const { weights, stop } = styled({ fontWeight: 400, fontFamily: 'Late Sans' })
  await fontManager.familyFaces('Late Sans')
  await nextTick()
  expect(weights.value).toHaveLength(9)
  fontManager.setHostFontCatalog([...CATALOG, { family: 'Late Sans', styles: ['Regular', 'Bold'] }])
  await fontManager.familyFaces('Late Sans')
  await nextTick()
  expect(weights.value.map((weight) => weight.value)).toEqual([400, 700])
  stop()
  fontManager.setHostFontCatalog(CATALOG)
})

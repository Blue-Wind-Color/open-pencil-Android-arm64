import { describe, expect, test } from 'bun:test'

import { toUint8Array } from 'js-base64'

import {
  iconFontFamily,
  iconName,
  penAssets,
  parsePenDocument,
  type PenDocument,
  type PenNode
} from '@open-pencil/pen'
import type { SceneGraph } from '@open-pencil/scene-graph'
import type { Color } from '@open-pencil/scene-graph/primitives'

import { expectDefined, getNodeOrThrow } from './helpers/assert'
import { parseDocument } from './helpers/document'

// A 2 × 1 PNG.
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADElEQVR4nGP8zwACAAYIAQFazwZIAAAAAElFTkSuQmCC'

describe('penAssets', () => {
  test('lists Iconify icons, images in the document folder, and data URLs', () => {
    const doc = parsePenDocument(
      JSON.stringify({
        version: '2.21',
        children: [
          { id: 'a', type: 'icon', library: 'lucide', icon: 'heart' },
          { id: 'b', type: 'icon', library: 'Material Symbols Rounded', icon: 'settings' },
          { id: 'c', type: 'rectangle', fill: { type: 'image', url: './photo.png' } },
          { id: 'd', type: 'rectangle', fill: [{ type: 'image', url: '../secret.png' }] },
          { id: 'e', type: 'rectangle', fill: { type: 'image', url: 'https://example.com/a.png' } },
          { id: 'f', type: 'rectangle', fill: { type: 'image', url: '/etc/a.png' } },
          { id: 'g', type: 'ref', ref: 'x', descendants: { inner: { icon: 'star' } } },
          { id: 'i', type: 'icon', library: 'phosphor', icon: 'house' },
          {
            id: 'h',
            type: 'rectangle',
            fill: { type: 'image', url: `data:image/png;base64,${PNG}` }
          }
        ]
      })
    )
    expect(penAssets(doc)).toEqual({
      icons: ['lucide:heart', 'ph:house', 'lucide:star', 'ph:star'],
      images: ['./photo.png', `data:image/png;base64,${PNG}`]
    })
  })

  test('lists every icon a variable names in any theme', () => {
    const doc = parsePenDocument(
      JSON.stringify({
        version: '2.21',
        themes: { mode: ['light', 'dark'] },
        variables: {
          glyph: {
            type: 'string',
            value: [{ value: 'sun' }, { value: '$night', theme: { mode: 'dark' } }]
          },
          night: { type: 'string', value: 'moon' },
          set: { type: 'string', value: 'lucide' }
        },
        children: [{ id: 'a', type: 'icon', library: '$set', icon: '$glyph' }]
      })
    )
    expect(penAssets(doc).icons).toEqual(['lucide:sun', 'lucide:moon'])
  })

  test('draws Lucide, Feather, and Phosphor from Iconify, and Material Symbols from their fonts', () => {
    expect(iconName('feather', 'star')).toBe('feather:star')
    expect(iconName('phosphor', 'airplane')).toBe('ph:airplane')
    expect(iconName('Material Symbols Outlined', 'home')).toBeNull()
    expect(iconFontFamily('Material Symbols Sharp')).toBe('Material Symbols Sharp')
    expect(iconFontFamily('lucide')).toBeNull()
    expect(iconName('unknown', 'home')).toBeNull()
  })
})

describe('parsePenFile — images', () => {
  function fillWith(fill: PenNode['fill'], bytes = toUint8Array(PNG)) {
    const graph = parseDocument(
      [{ id: 'shape', type: 'rectangle', width: 200, height: 100, fill }],
      {},
      { images: new Map([['./image.png', bytes]]) }
    )
    return { graph, fill: getNodeOrThrow(graph, 'shape').fills[0] }
  }

  test.each([
    [undefined, 'FILL'],
    ['cover', 'FILL'],
    ['contain', 'FIT'],
    ['stretch', 'CROP']
  ] as const)('draws mode %s as %s', (mode, expected) => {
    const { graph, fill } = fillWith({ type: 'image', url: './image.png', mode })
    expect(fill).toMatchObject({ type: 'IMAGE', imageScaleMode: expected })
    expect(graph.images.has(expectDefined(fill.imageHash))).toBe(true)
  })

  test('crops, then covers the layer with the crop', () => {
    // The right half of a 2 × 1 image is square, so on a 200 × 100 layer it is cut to its middle.
    const { fill } = fillWith({
      type: 'image',
      url: './image.png',
      transform: [2, 0, 0, 1, -1, 0]
    })
    const window = expectDefined(fill.imageTransform)
    expect(window.m00).toBeCloseTo(0.5)
    expect(window.m02).toBeCloseTo(0.5)
    expect(window.m11).toBeCloseTo(0.5)
    expect(window.m12).toBeCloseTo(0.25)
  })

  test('crops an image whose header declares no pixels without fitting it', () => {
    const empty = toUint8Array(PNG)
    // The IHDR width, which follows the signature, the chunk length, and the chunk type.
    empty.set([0, 0, 0, 0], 16)
    const { fill } = fillWith(
      { type: 'image', url: './image.png', transform: [2, 0, 0, 1, -1, 0] },
      empty
    )
    const window = expectDefined(fill.imageTransform)
    expect(Object.values(window).every(Number.isFinite)).toBe(true)
  })

  test('reads image files the host loaded, and skips the ones it did not', () => {
    const graph = parseDocument(
      [
        {
          id: 'loaded',
          type: 'rectangle',
          fill: [{ type: 'image', url: './a.png', opacity: 0.5 }]
        },
        { id: 'missing', type: 'rectangle', fill: [{ type: 'image', url: './b.png' }, '#FF0000'] }
      ],
      {},
      { images: new Map([['./a.png', toUint8Array(PNG)]]) }
    )
    expect(getNodeOrThrow(graph, 'missing').fills.map((fill) => fill.type)).toEqual(['SOLID'])
    expect(getNodeOrThrow(graph, 'loaded').fills[0]).toMatchObject({ type: 'IMAGE', opacity: 0.5 })
  })
})

describe('parsePenFile — icons', () => {
  function drawn(fields: Partial<PenNode>, doc: Partial<PenDocument> = {}) {
    const calls: { name: string; size: number; color: Color }[] = []
    const icons = {
      draw(graph: SceneGraph, frameId: string, name: string, size: number, color: Color) {
        calls.push({ name, size, color })
        graph.createNode('VECTOR', frameId, { width: size, height: size })
        return true
      }
    }
    const graph = parseDocument(
      [
        {
          id: 'icon',
          type: 'icon',
          library: 'lucide',
          icon: 'heart',
          width: 96,
          height: 30,
          fill: '#CC0000',
          ...fields
        }
      ],
      doc,
      { icons }
    )
    return { graph, calls, icon: getNodeOrThrow(graph, 'icon') }
  }

  test('draws the glyph in the fill colour, fitted and centred in the box', () => {
    const { graph, calls, icon } = drawn({})
    expect(calls).toEqual([{ name: 'lucide:heart', size: 30, color: { r: 0.8, g: 0, b: 0, a: 1 } }])
    expect(icon.fills).toEqual([])
    expect(graph.getChildren('icon').map((glyph) => [glyph.x, glyph.y])).toEqual([[33, 0]])
  })

  test('sets a Material Symbol in its font at the icon weight, 200 by default', () => {
    for (const [weight, expected] of [
      [undefined, 200],
      [650, 650]
    ] as const) {
      const { graph, calls } = drawn({ library: 'Material Symbols Rounded', icon: 'home', weight })
      expect(calls).toEqual([])
      expect(graph.getChildren('icon')).toMatchObject([
        {
          type: 'TEXT',
          text: 'home',
          fontFamily: 'Material Symbols Rounded',
          fontVariations: [{ axis: 'wght', value: expected }],
          fontSize: 30,
          x: 33,
          y: 0
        }
      ])
    }
  })

  test('reads the library and icon from variables in the layer theme', () => {
    const { calls } = drawn(
      { library: '$set', icon: '$glyph', theme: { mode: 'dark' } },
      {
        themes: { mode: ['light', 'dark'] },
        variables: {
          set: { type: 'string', value: 'feather' },
          glyph: {
            type: 'string',
            value: [{ value: 'sun' }, { value: 'moon', theme: { mode: 'dark' } }]
          }
        }
      }
    )
    expect(calls.map((call) => call.name)).toEqual(['feather:moon'])
  })
})

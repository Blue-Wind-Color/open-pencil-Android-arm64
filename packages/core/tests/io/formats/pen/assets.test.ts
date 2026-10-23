import { describe, expect, test } from 'bun:test'

import { fromUint8Array, toUint8Array } from 'js-base64'

import type { IconData, IconProvider } from '@open-pencil/core/icons'
import { IORegistry, penFormat } from '@open-pencil/core/io'
import { parseSVGPath } from '@open-pencil/scene-graph/parse-path'

// A 2 × 1 PNG.
const PNG = toUint8Array(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAADElEQVR4nGP8zwACAAYIAQFazwZIAAAAAElFTkSuQmCC'
)

function iconProvider(available: string[], requested: string[][]): IconProvider {
  const glyph = (name: string, size: number): IconData => {
    const [prefix = '', iconName = ''] = name.split(':')
    return {
      prefix,
      name: iconName,
      width: size,
      height: size,
      paths: [
        {
          vectorNetwork: parseSVGPath(`M0 0H${size}V${size}Z`),
          fill: 'currentColor',
          stroke: null,
          strokeWidth: 0,
          strokeCap: 'butt',
          strokeJoin: 'miter'
        }
      ]
    }
  }
  return {
    async icons(names, size) {
      requested.push([...names])
      return new Map(
        names.filter((name) => available.includes(name)).map((name) => [name, glyph(name, size)])
      )
    },
    search: () => Promise.resolve({ icons: [], total: 0, collections: {} }),
    previews: () => Promise.resolve(new Map()),
    collections: () => Promise.resolve([]),
    browse: () => Promise.resolve([])
  }
}

const io = new IORegistry([penFormat])

function penBytes(children: unknown[]) {
  return new TextEncoder().encode(JSON.stringify({ version: '2.21', children }))
}

describe('penFormat.readDocument — assets', () => {
  test('draws Iconify icons from the provider', async () => {
    const requested: string[][] = []
    const icons = iconProvider(['lucide:house'], requested)
    const { graph } = await io.readDocument(
      {
        name: 'icons.pen',
        data: penBytes([
          {
            id: 'home',
            type: 'icon',
            library: 'lucide',
            icon: 'house',
            width: 48,
            height: 48,
            fill: '#222222'
          },
          {
            id: 'symbol',
            type: 'icon',
            library: 'Material Symbols Outlined',
            icon: 'home',
            width: 48,
            height: 48
          }
        ])
      },
      { icons }
    )
    expect(requested).toEqual([['lucide:house']])
    const glyphs = graph.getChildren('home')
    expect(glyphs).toHaveLength(1)
    expect(glyphs[0]?.width).toBe(48)
    expect(graph.getChildren('symbol').map((glyph) => glyph.type)).toEqual(['TEXT'])
  })

  test('reads image files through the host and leaves unreadable ones unpainted', async () => {
    const asked: string[] = []
    const { graph } = await io.readDocument(
      {
        name: 'images.pen',
        data: penBytes([
          {
            id: 'photo',
            type: 'rectangle',
            width: 20,
            height: 10,
            fill: { type: 'image', url: './photo.png' }
          },
          {
            id: 'gone',
            type: 'rectangle',
            width: 20,
            height: 10,
            fill: { type: 'image', url: './gone.png' }
          }
        ]),
        readAsset: async (path) => {
          asked.push(path)
          return path === './photo.png' ? PNG : null
        }
      },
      { icons: iconProvider([], []) }
    )
    expect([...asked].sort()).toEqual(['./gone.png', './photo.png'])
    expect(graph.getNode('photo')?.fills[0]?.type).toBe('IMAGE')
    expect(graph.getNode('gone')?.fills).toEqual([])
  })

  test('decodes data URLs as URLs, without the host', async () => {
    const encoded = fromUint8Array(PNG)
    const { graph } = await io.readDocument(
      {
        name: 'inline.pen',
        data: penBytes([
          {
            id: 'plain',
            type: 'rectangle',
            fill: { type: 'image', url: `data:image/png;base64,${encoded}` }
          },
          {
            id: 'named',
            type: 'rectangle',
            fill: { type: 'image', url: `DATA:image/png;name=a.png;base64,${encoded}` }
          },
          {
            id: 'broken',
            type: 'rectangle',
            fill: { type: 'image', url: 'data:image/png;base64,!!!' }
          }
        ])
      },
      { icons: iconProvider([], []) }
    )
    expect(graph.getNode('plain')?.fills[0]?.type).toBe('IMAGE')
    expect(graph.getNode('named')?.fills[0]?.type).toBe('IMAGE')
    expect(graph.getNode('broken')?.fills).toEqual([])
  })
})

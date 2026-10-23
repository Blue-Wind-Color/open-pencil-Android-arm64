import { describe, expect, test } from 'bun:test'

import type { PenNode } from '@open-pencil/pen'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { expectDefined, getNodeOrThrow } from './helpers/assert'
import { parseDocument } from './helpers/document'

const button: PenNode = {
  id: 'button',
  type: 'frame',
  reusable: true,
  layout: 'horizontal',
  alignItems: 'center',
  padding: [8, 14],
  gap: 6,
  fill: '#2255CC',
  children: [
    { id: 'dot', type: 'ellipse', width: 10, height: 10, fill: '#FFFFFF' },
    { id: 'label', type: 'text', content: 'Button', fontSize: 14, fill: '#FFFFFF' }
  ]
}

const card: PenNode = {
  id: 'card',
  type: 'frame',
  reusable: true,
  layout: 'vertical',
  children: [
    { id: 'title', type: 'text', content: 'Card title', fill: '#111111' },
    { id: 'cardButton', type: 'ref', ref: 'button' }
  ]
}

function layers(graph: SceneGraph, id: string): SceneNode[] {
  const found: SceneNode[] = []
  const queue = [...graph.getChildren(id)]
  for (const node of queue) {
    found.push(node)
    queue.push(...graph.getChildren(node.id))
  }
  return found
}

/** The copy in an instance made, through copies of copies, from the pen.dev layer `sourceId`. */
function copyOf(graph: SceneGraph, instanceId: string, sourceId: string): SceneNode {
  const madeFrom = (node: SceneNode): boolean => {
    for (let id = node.componentId; id; id = graph.getNode(id)?.componentId ?? null) {
      if (id === sourceId) return true
    }
    return false
  }
  return expectDefined(layers(graph, instanceId).find(madeFrom), `${sourceId} in ${instanceId}`)
}

describe('parsePenFile — instances', () => {
  test('fills an instance with copies linked to the component', () => {
    const graph = parseDocument([button, { id: 'plain', type: 'ref', ref: 'button' }])
    const instance = getNodeOrThrow(graph, 'plain')
    expect(instance.type).toBe('INSTANCE')
    expect(instance.componentId).toBe('button')
    expect(graph.getChildren('plain').map((node) => node.componentId)).toEqual(['dot', 'label'])
  })

  test('replaces the component fields the ref sets, keeping the rest', () => {
    const graph = parseDocument([
      button,
      { id: 'tall', type: 'ref', ref: 'button', layout: 'vertical', padding: 12 }
    ])
    expect(getNodeOrThrow(graph, 'tall')).toMatchObject({
      layoutMode: 'VERTICAL',
      counterAxisAlign: 'CENTER',
      itemSpacing: 6,
      paddingTop: 12,
      paddingLeft: 12
    })
  })

  test('overrides a descendant by its ID', () => {
    const graph = parseDocument([
      button,
      { id: 'changed', type: 'ref', ref: 'button', descendants: { label: { content: 'Changed' } } }
    ])
    expect(copyOf(graph, 'changed', 'label').text).toBe('Changed')
    expect(getNodeOrThrow(graph, 'label').text).toBe('Button')
  })

  test('follows an ID path through a nested instance', () => {
    const graph = parseDocument([
      button,
      card,
      {
        id: 'nested',
        type: 'ref',
        ref: 'card',
        descendants: { 'cardButton/label': { content: 'Deep' }, cardButton: { fill: '#119944' } }
      }
    ])
    const nestedButton = expectDefined(
      graph.getChildren('nested').find((node) => node.componentId === 'cardButton'),
      'nested button copy'
    )
    expect(nestedButton.fills[0]?.color).toMatchObject({ r: 0x11 / 255, g: 0x99 / 255 })
    expect(copyOf(graph, nestedButton.id, 'label').text).toBe('Deep')
  })

  test('replaces a descendant whose override has a type', () => {
    const graph = parseDocument([
      button,
      {
        id: 'swapped',
        type: 'ref',
        ref: 'button',
        descendants: {
          dot: { type: 'rectangle', id: 'square', width: 10, height: 10, fill: '#FFFF00' }
        }
      }
    ])
    expect(graph.getChildren('swapped').map((node) => node.type)).toEqual(['RECTANGLE', 'TEXT'])
    expect(getNodeOrThrow(graph, 'square').fills[0]?.color).toMatchObject({ r: 1, g: 1, b: 0 })
  })

  test('hides a descendant through its enabled field', () => {
    const graph = parseDocument([
      button,
      { id: 'hidden', type: 'ref', ref: 'button', descendants: { dot: { enabled: false } } }
    ])
    expect(copyOf(graph, 'hidden', 'dot').visible).toBe(false)
  })

  test('copies a reusable layer that is not a frame', () => {
    const graph = parseDocument([
      { id: 'swatch', type: 'rectangle', reusable: true, width: 20, height: 20, fill: '#FF0000' },
      { id: 'use', type: 'ref', ref: 'swatch', x: 40 }
    ])
    expect(getNodeOrThrow(graph, 'use')).toMatchObject({ type: 'RECTANGLE', x: 40, width: 20 })
  })
})

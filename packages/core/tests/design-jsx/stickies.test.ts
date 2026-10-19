import { describe, expect, test } from 'bun:test'

import { getNodeOrThrow } from '#core-tests/helpers/assert'

import { renderJSX } from '@open-pencil/core/design-jsx'
import { sceneNodeToJSX } from '@open-pencil/design-jsx'
import { SceneGraph, STICKY_COLORS, stickySublayers } from '@open-pencil/scene-graph'

const BOARD = `
  <Frame name="Board" w={900} h={400}>
    <Sticky x={0} y={0} color="yellow" author="Ada">Ship it</Sticky>
    <Sticky name="Risks" x={300} y={0} color="#FF0000" wide textSize="large" author="Lin" authorVisible={false}>Fonts</Sticky>
  </Frame>`

describe('sticky notes in design JSX', () => {
  test('are made as the sticky tool makes them, named by their body', async () => {
    const graph = new SceneGraph()
    const [result] = await renderJSX(graph, BOARD)
    const [plain, styled] = graph.getChildren(getNodeOrThrow(graph, result.id).id)
    expect(plain).toMatchObject({
      type: 'STICKY',
      name: 'Ship it',
      autoRename: true,
      x: 0,
      width: 240
    })
    expect(plain.fills[0]?.color).toEqual(STICKY_COLORS.yellow)
    const layers = stickySublayers(graph, plain)
    expect([layers?.body.text, layers?.author.text, layers?.author.visible]).toEqual([
      'Ship it',
      'Ada',
      true
    ])
    expect(styled).toMatchObject({ name: 'Risks', autoRename: false, width: 416 })
    const styledLayers = stickySublayers(graph, styled)
    expect([styledLayers?.body.fontSize, styledLayers?.author.visible]).toEqual([40, false])
  })

  test('write back as Sticky elements', async () => {
    const graph = new SceneGraph()
    const [result] = await renderJSX(graph, BOARD)
    const jsx = sceneNodeToJSX(result.id, graph)
    expect(jsx).toContain('<Sticky color="yellow" author="Ada">Ship it</Sticky>')
    expect(jsx).toContain(
      '<Sticky name="Risks" x={300} color="#FF0000" author="Lin" authorVisible={false} wide textSize="large">Fonts</Sticky>'
    )
    const again = new SceneGraph()
    const [reread] = await renderJSX(again, jsx)
    expect(sceneNodeToJSX(reread.id, again)).toBe(jsx)
  })

  test('keep a name given in the JSX, even one that matches the body', async () => {
    const graph = new SceneGraph()
    const [result] = await renderJSX(graph, '<Sticky name="Ship it">Ship it</Sticky>')
    const jsx = sceneNodeToJSX(result.id, graph)
    expect(jsx).toContain('name="Ship it"')
    const again = new SceneGraph()
    const [reread] = await renderJSX(again, jsx)
    expect(getNodeOrThrow(again, reread.id).autoRename).toBe(false)
  })

  test('join connectors to themselves, never to the layers they generate', async () => {
    const graph = new SceneGraph()
    const [result] = await renderJSX(
      graph,
      `<Frame name="Board" w={900} h={400}>
  <Sticky x={0} y={0}>Ship it</Sticky>
  <Text name="Text" x={600} y={0}>Done</Text>
  <Connector from="Ship it" to="Text" />
</Frame>`
    )
    const [sticky, text, connector] = graph.getChildren(result.id)
    // The note's body is named as the layer the connector names, and is not joined.
    expect(stickySublayers(graph, sticky)?.body.name).toBe('Text')
    expect(result.warnings ?? []).toEqual([])
    expect(connector.connectorStart?.nodeId).toBe(sticky.id)
    expect(connector.connectorEnd?.nodeId).toBe(text.id)
  })
})

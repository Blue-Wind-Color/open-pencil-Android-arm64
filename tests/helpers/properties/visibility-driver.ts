import type { Page } from '@playwright/test'

interface VisibilityScene {
  componentLayer: string
  plain: string
  flag: string
  state: string
  mode: string
}

/**
 * Builds variables of each type, a component with a layer and a plain layer, and reads back
 * what decides a layer's visibility. Selection and variable values are fixture setup; binding
 * goes through the panel.
 */
export function visibilityDriver(page: () => Page) {
  let scene: VisibilityScene | undefined

  function built() {
    if (!scene) throw new Error('Build the scene first')
    return scene
  }

  return {
    async build() {
      scene = await page().evaluate(() => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        const graph = store.graph
        const pageId = store.state.currentPageId
        // The page is cleared between tests; the variables an earlier test made are not.
        for (const id of graph.variableCollections.keys()) graph.removeCollection(id)
        const collection = graph.createCollection('Flags')
        const flag = graph.createVariable('show-icon', 'BOOLEAN', collection.id, true)
        const state = graph.createVariable('state', 'STRING', collection.id, 'yes')
        graph.createVariable('size', 'FLOAT', collection.id, 4)
        const button = graph.createNode('COMPONENT', pageId, {
          name: 'Button',
          width: 160,
          height: 48
        })
        const badge = graph.createNode('RECTANGLE', button.id, {
          name: 'Badge',
          width: 24,
          height: 24
        })
        const plain = graph.createNode('RECTANGLE', pageId, {
          name: 'Plain',
          x: 300,
          width: 48,
          height: 48
        })
        store.select([plain.id])
        return {
          componentLayer: badge.id,
          plain: plain.id,
          flag: flag.id,
          state: state.id,
          mode: collection.defaultModeId
        }
      })
      return scene
    },

    selectComponentLayer() {
      return page().evaluate(
        (id) => window.openPencil?.getStore?.().select([id]),
        built().componentLayer
      )
    },

    setText(text: string) {
      const { state, mode } = built()
      return page().evaluate(
        (args) =>
          window.openPencil?.getStore?.().updateVariableValue(args.state, args.mode, args.text),
        { state, mode, text }
      )
    },

    /** What decides a layer's visibility: its value, its variable, and its component property. */
    layer(id: string) {
      return page().evaluate((nodeId) => {
        const node = window.openPencil?.getStore?.().graph.getNode(nodeId)
        return {
          visible: node?.visible,
          variable: node?.boundVariables.visible,
          property: node?.componentPropertyReferences.find((item) => item.field === 'VISIBLE')
            ?.propertyId
        }
      }, id)
    }
  }
}

import type { Page } from '@playwright/test'

import type { Vector } from '@open-pencil/scene-graph/primitives'

/** Probes and drivers for top-level layers on the current page, found by name. */
export function layerDriver(page: () => Page) {
  return {
    /** Where the centre of the named layer shows on the canvas, in canvas-element pixels. */
    screenCenter(name: string): Promise<Vector> {
      return page().evaluate((layerName) => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        const layer = store.graph
          .getChildren(store.state.currentPageId)
          .find((node) => node.name === layerName)
        if (!layer) throw new Error(`No layer named ${layerName}`)
        const { zoom, panX, panY } = store.state
        return {
          x: (layer.x + layer.width / 2) * zoom + panX,
          y: (layer.y + layer.height / 2) * zoom + panY
        }
      }, name)
    },

    /** Driver: clears the selection, so a screenshot shows no handles. */
    clearSelection(): Promise<void> {
      return page().evaluate(() => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        store.clearSelection()
      })
    }
  }
}

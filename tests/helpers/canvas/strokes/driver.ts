import type { Page } from '@playwright/test'

import type * as StrokeScenes from '#tests/helpers/canvas/strokes/scene'

/** Builds the side strokes scene on the open page and leaves it unselected for a snapshot. */
export function sideStrokesDriver(page: () => Page) {
  return {
    show() {
      return page().evaluate(async () => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        const sceneURL = '/tests/helpers/canvas/strokes/scene.ts'
        const scenes: typeof StrokeScenes = await import(sceneURL)
        scenes.createSideStrokesScene(store.graph, store.state.currentPageId)
        store.clearSelection()
        store.requestRender()
      })
    }
  }
}

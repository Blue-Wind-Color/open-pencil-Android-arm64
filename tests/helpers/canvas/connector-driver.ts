import { expect, type Page } from '@playwright/test'

import type { ConnectorEndpoint } from '@open-pencil/scene-graph'

import { toolbarToolTestId } from '#tests/helpers/test-ids'

/** The canvas point the page's origin is shown at, at 100%. */
const ORIGIN = 100

export interface ConnectorState {
  id: string
  start: ConnectorEndpoint | null
  end: ConnectorEndpoint | null
  label: string
}

/** Connectors between layers on a page shown at 100% with its origin 100 px into the canvas. */
export function connectorDriver(page: () => Page) {
  return {
    /** Setup: shows the page's origin at a known canvas point. */
    showOrigin() {
      return page().evaluate((origin) => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        store.state.zoom = 1
        store.state.panX = origin
        store.state.panY = origin
        store.requestRender()
      }, ORIGIN)
    },

    /** Setup: named rectangles at page boxes; returns their ids by name. */
    addBoxes(boxes: { name: string; x: number; y: number; width: number; height: number }[]) {
      return page().evaluate((specs) => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        const ids: Record<string, string> = {}
        for (const spec of specs) {
          const node = store.graph.createNode('RECTANGLE', store.state.currentPageId, {
            ...spec,
            fills: [
              {
                type: 'SOLID',
                color: { r: 0.85, g: 0.88, b: 0.95, a: 1 },
                opacity: 1,
                visible: true
              }
            ]
          })
          ids[spec.name] = node.id
        }
        store.clearSelection()
        store.requestRender()
        return ids
      }, boxes)
    },

    /** Probe: the page's connectors, the last drawn last. */
    connectors(): Promise<ConnectorState[]> {
      return page().evaluate(() => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        return store.graph
          .getChildren(store.state.currentPageId)
          .filter((node) => node.type === 'CONNECTOR')
          .map((connector) => ({
            id: connector.id,
            start: connector.connectorStart,
            end: connector.connectorEnd,
            label: store.graph.getChildren(connector.id)[2]?.text ?? ''
          }))
      })
    },

    /** Probe: the active tool, the selection, the text being typed into, and the attach target. */
    focus() {
      return page().evaluate(() => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        return {
          tool: store.state.activeTool,
          selected: [...store.state.selectedIds],
          editing: store.state.editingTextId,
          target: store.state.connectorTarget
        }
      })
    },

    /** A point on a connector's line, midway along its first piece, in page coordinates. */
    linePoint(id: string) {
      return page().evaluate((connectorId) => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        const connector = store.graph.getNode(connectorId)
        const line = connector && store.graph.getChildren(connector.id)[0]
        const [a, b] = line?.vectorNetwork?.vertices ?? []
        if (!connector || !line || !a || !b) throw new Error(`No route for ${connectorId}`)
        return {
          x: connector.x + line.x + (a.x + b.x) / 2,
          y: connector.y + line.y + (a.y + b.y) / 2
        }
      }, id)
    },

    /**
     * Setup: four connectors at 100%, one per filled cap, the first selected, and a layer
     * outlined as an attach target, for the canvas to draw them all.
     */
    showCapsAndHandles() {
      return page().evaluate(() => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        const page = store.state.currentPageId
        const box = (x: number, y: number) =>
          store.graph.createNode('RECTANGLE', page, {
            x,
            y,
            width: 160,
            height: 120,
            fills: [
              {
                type: 'SOLID',
                color: { r: 0.85, g: 0.88, b: 0.95, a: 1 },
                opacity: 1,
                visible: true
              }
            ]
          })
        const caps = [
          'TRIANGLE_FILLED',
          'DIAMOND_FILLED',
          'CIRCLE_FILLED',
          'ARROW_EQUILATERAL'
        ] as const
        let selected = ''
        caps.forEach((cap, row) => {
          const from = box(40, 40 + row * 160)
          const to = box(480, 100 + row * 160)
          store.setTool('CONNECTOR')
          store.connectorBegin(from.x + 80, from.y + 60)
          store.connectorRelease(to.x + 80, to.y + 60, true)
          const connector = store.graph
            .getChildren(page)
            .findLast((node) => node.type === 'CONNECTOR')
          if (!connector) throw new Error('No connector')
          store.setConnectorCap([connector.id], 'start', cap)
          store.setConnectorCap([connector.id], 'end', cap)
          if (row === 0) selected = connector.id
        })
        store.setTool('SELECT')
        store.select([selected])
        const target = box(760, 300)
        store.state.connectorTarget = { nodeId: target.id, magnet: 'TOP' }
        store.state.zoom = 1
        store.state.panX = 0
        store.state.panY = 0
        store.requestRender()
      })
    },

    /** Driver: selects one connector, as clicking its line would. */
    select(id: string) {
      return page().evaluate((connectorId) => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        store.select([connectorId])
      }, id)
    },

    /** A connector's line type and end caps, as the Connector section sets them. */
    style(id: string) {
      return page().evaluate((connectorId) => {
        const store = window.openPencil?.getStore?.()
        if (!store) throw new Error('OpenPencil store not initialized')
        const node = store.graph.getNode(connectorId)
        if (!node) throw new Error(`No connector ${connectorId}`)
        return {
          line: node.connectorLineType,
          startCap: node.connectorStartCap,
          endCap: node.connectorEndCap
        }
      }, id)
    },

    /** Canvas coordinates of a page point, under `showOrigin`. */
    point(x: number, y: number) {
      return { x: ORIGIN + x, y: ORIGIN + y }
    },

    /** Driver: shows the connector tool from Customize toolbar, where it starts hidden. */
    async showTool() {
      const button = page().getByTestId(toolbarToolTestId('CONNECTOR'))
      if ((await button.count()) > 0) return
      await page().getByTestId('toolbar').click({ button: 'right' })
      await page().getByRole('menuitem', { name: 'Customize toolbar…' }).click()
      await page()
        .getByTestId('settings-toolbar-panel')
        .getByRole('switch', { name: 'Show Connector', exact: true })
        .click()
      await page().getByTestId('app-settings-done').click()
      await expect(button).toBeVisible()
    },

    /** Driver: picks the connector tool from the toolbar. */
    async pickTool() {
      await page().getByTestId(toolbarToolTestId('CONNECTOR')).click()
    }
  }
}

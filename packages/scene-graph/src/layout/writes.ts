import type { SceneNode } from '../types'

interface LayerWrites {
  before: Partial<SceneNode>
  changed: Set<keyof SceneNode>
}

/**
 * What one layout run writes to each layer: the values before its first write, and the keys it
 * actually changed. Layout passes can size a layer and size it back, such as a frame laid out on
 * its own and then by its parent, so a key that changed and came back is left out of the update.
 */
export class LayoutWrites {
  private readonly layers = new Map<string, LayerWrites>()

  /** Call before `changes` are applied to `node`. */
  record(node: SceneNode, changes: Partial<SceneNode>): void {
    let layer = this.layers.get(node.id)
    if (!layer) {
      layer = { before: {}, changed: new Set() }
      this.layers.set(node.id, layer)
    }
    for (const key of Object.keys(changes) as (keyof SceneNode)[]) {
      if (!Object.hasOwn(layer.before, key)) Object.assign(layer.before, { [key]: node[key] })
      if (!Object.is(node[key], changes[key])) layer.changed.add(key)
    }
  }

  /**
   * Each written layer's update: the values layout changed and kept, and values it wrote as they
   * already were, which a preview's commit writes to publish what it showed.
   */
  *updates(
    getNode: (id: string) => SceneNode | undefined
  ): Generator<[string, Partial<SceneNode>]> {
    for (const [id, { before, changed }] of this.layers) {
      const node = getNode(id)
      if (!node) continue
      const changes: Partial<SceneNode> = {}
      for (const key of Object.keys(before) as (keyof SceneNode)[]) {
        if (changed.has(key) && Object.is(node[key], before[key])) continue
        Object.assign(changes, { [key]: node[key] })
      }
      if (Object.keys(changes).length > 0) yield [id, changes]
    }
  }
}

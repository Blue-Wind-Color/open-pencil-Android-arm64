import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { BLACK } from '@open-pencil/scene-graph/constants'
import { generatedFrameOwner, stickySublayers } from '@open-pencil/scene-graph/generated'

/**
 * The body of an empty sticky note as an editing canvas draws it: `placeholder`, in the
 * interface language, in the body's style, black at 30%, as measured in FigJam. The note's text
 * stays empty, and a canvas without a placeholder, such as an export, draws nothing there.
 */
export function stickyPlaceholderNode(
  graph: SceneGraph,
  node: SceneNode,
  placeholder: string | null
): SceneNode | null {
  if (!placeholder || node.type !== 'TEXT' || node.text !== '') return null
  const sticky = generatedFrameOwner(graph, node)
  if (sticky?.type !== 'STICKY' || stickySublayers(graph, sticky)?.body.id !== node.id) return null
  return {
    ...node,
    text: placeholder,
    styleRuns: [],
    textParagraphs: [],
    derivedTextGlyphs: null,
    fills: [{ type: 'SOLID', color: { ...BLACK }, opacity: 0.3, visible: true }]
  }
}

import { compact } from 'es-toolkit'

import { shapeWithTextFrameFields, shapeWithTextLabel } from '@open-pencil/scene-graph'
import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'
import { fitShapeWithText } from '@open-pencil/scene-graph/shape-with-text'

import { measureTextForLayout } from './text-measurement'

/** The size a shape with text was given: what a user or script last set, else its own. */
function givenSize(shape: SceneNode): { width: number; height: number } {
  return {
    width: shape.shapeUserWidth > 0 ? shape.shapeUserWidth : shape.width,
    height: shape.shapeUserHeight > 0 ? shape.shapeUserHeight : shape.height
  }
}

/**
 * The size and padding a shape with text takes for its label, as FigJam fits it (see
 * fitShapeWithText): its given size while the label fits, grown just enough when it does not.
 */
export function shapeWithTextFit(graph: SceneGraph, shape: SceneNode): Partial<SceneNode> {
  const given = givenSize(shape)
  const label = shapeWithTextLabel(graph, shape)
  let size = given
  if (label?.text) {
    const wrapping: SceneNode = { ...label, textAutoResize: 'HEIGHT' }
    const words = compact(label.text.split(/\s+/))
    const longestWord = Math.max(
      0,
      // A word is measured on one line, unwrapped, so its width is never capped by the label's.
      ...words.map(
        (word) =>
          measureTextForLayout({
            ...label,
            text: word,
            styleRuns: [],
            textAutoResize: 'WIDTH_AND_HEIGHT'
          }).width
      )
    )
    size = fitShapeWithText(shape.shapeWithTextType, {
      ...given,
      longestWord,
      measure: (maxWidth) => measureTextForLayout({ ...wrapping, width: maxWidth }, maxWidth)
    })
  }
  return {
    ...size,
    ...shapeWithTextFrameFields(shape.shapeWithTextType, size.width, size.height)
  }
}

/** Fits a shape with text to its label before its auto layout places the label. */
export function fitShapeWithTextFrame(graph: SceneGraph, shape: SceneNode): void {
  if (shape.type !== 'SHAPE_WITH_TEXT') return
  const fit = shapeWithTextFit(graph, shape)
  const changes = Object.fromEntries(
    Object.entries(fit).filter(([key, value]) => Reflect.get(shape, key) !== value)
  )
  if (Object.keys(changes).length > 0) graph.updateNode(shape.id, changes)
}

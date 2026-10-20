import type { BlendMode, Canvas, Path } from 'canvaskit-wasm'

import type { Effect, SceneNode, Stroke } from '@open-pencil/scene-graph'

import { figmaBlendModeToSkia } from '#core/canvas/blend'
import { blurSigma } from '#core/canvas/effects'
import type { SkiaRenderer } from '#core/canvas/renderer'
import {
  makeNodeShapePath,
  makeSmoothRRectPath,
  nodeHasRadius,
  nodeHasSmoothCorners
} from '#core/canvas/shapes'
import { sideStrokeRRects, strokeAlignShare } from '#core/canvas/strokes/sides'

import { fillsCastShadow, paintCastsShadow } from './silhouette'

function isPathShape(node: SceneNode): boolean {
  return node.type === 'POLYGON' || node.type === 'STAR' || node.type === 'VECTOR'
}

/** Whether the node's fill outline is its whole shadow: it casts from a fill and no stroke reaches past it. */
export function castsFromOwnShape(node: SceneNode): boolean {
  return (
    node.type !== 'TEXT' &&
    node.type !== 'BOOLEAN_OPERATION' &&
    !isPartialArc(node) &&
    fillsCastShadow(node) &&
    node.strokes.every((stroke) => !paintCastsShadow(stroke) || stroke.align === 'INSIDE')
  )
}

/** Whether a layer's drop shadow comes from its own outline alone, which the paths below draw. */
export function castsOwnShapeDropShadow(node: SceneNode, spread: number): boolean {
  return regularStrokeOutline(node, spread) !== null || castsFromOwnShape(node)
}

const OUTLINE_SHAPE_TYPES: ReadonlySet<SceneNode['type']> = new Set<SceneNode['type']>([
  'RECTANGLE',
  'ROUNDED_RECTANGLE',
  'ELLIPSE',
  'FRAME',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'SECTION'
])

/**
 * A pie, donut, or open arc. The shadow paths below draw ellipses as ovals, so these take the
 * silhouette, which draws the arc itself.
 */
function isPartialArc(node: SceneNode): boolean {
  const arc = node.type === 'ELLIPSE' ? node.arcData : null
  if (!arc) return false
  return arc.innerRadius > 0 || Math.abs(arc.endingAngle - arc.startingAngle) < 2 * Math.PI - 1e-6
}

/** Distances from each side of a rectangle: top, right, bottom, left. */
type Sides = readonly [number, number, number, number]

const evenSides = (distance: number): Sides => [distance, distance, distance, distance]

/** How far a shape's stroke reaches past each side of it (`outset`) and into it (`inset`). */
export interface StrokeOutline {
  outset: Sides
  inset: Sides
  /** Every side reaches as far, so the outline is the shape itself grown. */
  even: boolean
  align: Stroke['align']
}

function sideOutline([top, right, bottom, left]: Sides, align: Stroke['align']): StrokeOutline {
  const share = strokeAlignShare(align)
  return {
    outset: [top * share, right * share, bottom * share, left * share],
    inset: [top * (1 - share), right * (1 - share), bottom * (1 - share), left * (1 - share)],
    even: false,
    align
  }
}

/**
 * For a rectangle, ellipse, or frame with at most one plain stroke, the outline that stroke
 * gives it; null when the outline is not the shape grown, as with dashes or a sharp corner the
 * stroke does not miter. Sides of their own weights give the ring of `sideStrokeRRects`, but
 * measured on Figma 126, a shadow with a spread grows every side by the layer's single weight.
 */
export function regularStrokeOutline(node: SceneNode, spread: number): StrokeOutline | null {
  if (!OUTLINE_SHAPE_TYPES.has(node.type) || isPartialArc(node)) return null
  const strokes = node.strokes.filter(paintCastsShadow)
  if (strokes.length === 0) return evenOutline(0, 'INSIDE')
  const [stroke] = strokes
  if (strokes.length > 1 || stroke.dashPattern?.length) return null
  const sharp = node.type !== 'ELLIPSE' && !nodeHasRadius(node)
  if (node.independentStrokeWeights && node.type !== 'ELLIPSE') {
    const sides: Sides = [
      node.borderTopWeight,
      node.borderRightWeight,
      node.borderBottomWeight,
      node.borderLeftWeight
    ]
    if (sides.every((weight) => weight === sides[0])) return evenOutline(sides[0], stroke.align)
    if (spread !== 0) return evenOutline(node.strokeWeight, stroke.align)
    return sideOutline(sides, stroke.align)
  }
  if (sharp && (stroke.join ?? node.strokeJoin) !== 'MITER') return null
  return evenOutline(stroke.weight, stroke.align)
}

function evenOutline(weight: number, align: Stroke['align']): StrokeOutline {
  const outset = weight * strokeAlignShare(align)
  return { outset: evenSides(outset), inset: evenSides(weight - outset), even: true, align }
}

/** The node's rectangle, rounded rectangle, or ellipse grown by `offset`, or shrunk when negative. */
function grownShapePath(r: SkiaRenderer, node: SceneNode, offset: number): Path {
  if (node.type !== 'ELLIPSE' && nodeHasSmoothCorners(node)) {
    return makeSmoothRRectPath(r, node, offset)
  }
  const builder = new r.ck.PathBuilder()
  const rect = r.ltrb(-offset, -offset, node.width + offset, node.height + offset)
  if (node.type === 'ELLIPSE') builder.addOval(rect)
  else if (nodeHasRadius(node)) builder.addRRect(r.makeRRectWithSpread(node, offset))
  else builder.addRect(rect)
  return builder.detachAndDelete()
}

/** The outline the node's stroke gives it, grown further by `spread`. */
function strokeOutlinePath(
  r: SkiaRenderer,
  node: SceneNode,
  outline: StrokeOutline,
  spread: number
): Path {
  if (outline.even) return grownShapePath(r, node, outline.outset[0] + spread)
  const builder = new r.ck.PathBuilder()
  builder.addRRect(sideStrokeRRects(node, outline.align, spread).outer)
  return builder.detachAndDelete()
}

function pathWithSpread(r: SkiaRenderer, path: Path, spread: number): Path | null {
  if (spread === 0) return path.copy()
  const ring = path.makeStroked({ width: Math.abs(spread) * 2, join: r.ck.StrokeJoin.Round })
  if (!ring) return null
  const result = r.ck.Path.MakeFromOp(
    path,
    ring,
    spread > 0 ? r.ck.PathOp.Union : r.ck.PathOp.Difference
  )
  ring.delete()
  return result
}

function drawPathShape(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  hasRadius: boolean,
  spread = 0
): void {
  const path = makeNodeShapePath(r, node, r.ltrb(0, 0, node.width, node.height), hasRadius)
  const spreadPath = pathWithSpread(r, path, spread)
  path.delete()
  if (!spreadPath) return
  try {
    canvas.drawPath(spreadPath, r.auxFill)
  } finally {
    spreadPath.delete()
  }
}

function drawShadowGeometryPath(r: SkiaRenderer, canvas: Canvas, path: Path, spread: number): void {
  if (spread === 0) {
    canvas.drawPath(path, r.auxFill)
    return
  }
  const spreadPath = pathWithSpread(r, path, spread)
  if (!spreadPath) return
  try {
    canvas.drawPath(spreadPath, r.auxFill)
  } finally {
    spreadPath.delete()
  }
}

/**
 * Draws what `draw` paints with `r.auxFill` as a shadow, offset and blurred as a mask, which lets
 * Skia blur rectangles and rounded rectangles analytically.
 */
function drawMaskShadow(
  r: SkiaRenderer,
  canvas: Canvas,
  effect: Effect,
  blendMode: BlendMode,
  draw: () => void
): void {
  r.auxFill.setColor(r.color4f(effect.color.r, effect.color.g, effect.color.b, effect.color.a))
  r.auxFill.setMaskFilter(r.getCachedMaskBlur(blurSigma(effect.radius)))
  r.auxFill.setImageFilter(null)
  r.auxFill.setBlendMode(blendMode)
  canvas.save()
  try {
    canvas.translate(effect.offset.x, effect.offset.y)
    draw()
  } finally {
    canvas.restore()
    r.auxFill.setMaskFilter(null)
    r.auxFill.setBlendMode(r.ck.BlendMode.SrcOver)
  }
}

/** Draws a shadow cast by the node's fill outline grown by `spread`. */
export function drawShapeDropShadow(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  effect: Effect,
  hasRadius: boolean,
  spread: number,
  blendMode: BlendMode
): void {
  const sp = spread
  const geometryShadow = r.getFillGeometry(node)
  drawMaskShadow(r, canvas, effect, blendMode, () => {
    if (geometryShadow) {
      for (const path of geometryShadow) drawShadowGeometryPath(r, canvas, path, sp)
    } else if (node.type === 'ELLIPSE') {
      canvas.drawOval(r.ltrb(-sp, -sp, node.width + sp, node.height + sp), r.auxFill)
    } else if (isPathShape(node)) {
      drawPathShape(r, canvas, node, hasRadius, sp)
    } else if (nodeHasSmoothCorners(node)) {
      const path = makeSmoothRRectPath(r, node, sp)
      canvas.drawPath(path, r.auxFill)
      path.delete()
    } else if (hasRadius) {
      canvas.drawRRect(r.makeRRectWithSpread(node, sp), r.auxFill)
    } else {
      canvas.drawRect(r.ltrb(-sp, -sp, node.width + sp, node.height + sp), r.auxFill)
    }
  })
}

/** Whether the stroke reaches past the shape on any side, so it grows the shadow. */
export function strokeGrowsOutline(outline: StrokeOutline): boolean {
  return outline.outset.some((distance) => distance > 0)
}

/** Draws a shadow cast by the shape grown by its stroke and the spread. */
export function drawOutlineDropShadow(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  effect: Effect,
  outline: StrokeOutline,
  spread: number,
  blendMode: BlendMode
): void {
  drawMaskShadow(r, canvas, effect, blendMode, () => {
    const offset = outline.outset[0] + spread
    const rect = r.ltrb(-offset, -offset, node.width + offset, node.height + offset)
    if (!outline.even) {
      canvas.drawRRect(sideStrokeRRects(node, outline.align, spread).outer, r.auxFill)
    } else if (node.type !== 'ELLIPSE' && nodeHasSmoothCorners(node)) {
      const path = strokeOutlinePath(r, node, outline, spread)
      canvas.drawPath(path, r.auxFill)
      path.delete()
    } else if (node.type === 'ELLIPSE') canvas.drawOval(rect, r.auxFill)
    else if (nodeHasRadius(node)) canvas.drawRRect(r.makeRRectWithSpread(node, offset), r.auxFill)
    else canvas.drawRect(rect, r.auxFill)
  })
}

/** Draws the shadow of a stroke without a fill: the ring between its outline and its inner edge. */
export function drawRingDropShadow(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  effect: Effect,
  outline: StrokeOutline,
  spread: number,
  blendMode: BlendMode
): void {
  const builder = new r.ck.PathBuilder()
  if (outline.even) {
    const outer = strokeOutlinePath(r, node, outline, spread)
    builder.addPath(outer)
    outer.delete()
    const inset = outline.inset[0] + spread
    if (inset * 2 < Math.min(node.width, node.height)) {
      const inner = grownShapePath(r, node, -inset)
      builder.addPath(inner)
      inner.delete()
    }
  } else {
    const { outer, inner } = sideStrokeRRects(node, outline.align, spread)
    builder.addRRect(outer)
    if (inner) builder.addRRect(inner)
  }
  const ring = builder.detachAndDelete()
  ring.setFillType(r.ck.FillType.EvenOdd)
  try {
    drawMaskShadow(r, canvas, effect, blendMode, () => canvas.drawPath(ring, r.auxFill))
  } finally {
    ring.delete()
  }
}

/** Clips out the area a shape hides its shadow under: the shape grown by its stroke. */
export function clipOutShapeKnockout(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  hasRadius: boolean,
  outline: StrokeOutline | null
): void {
  const geometry = outline ? null : r.getFillGeometry(node)
  if (geometry) {
    for (const path of geometry) canvas.clipPath(path, r.ck.ClipOp.Difference, true)
    return
  }
  const path = outline
    ? strokeOutlinePath(r, node, outline, 0)
    : makeNodeShapePath(r, node, r.ltrb(0, 0, node.width, node.height), hasRadius)
  canvas.clipPath(path, r.ck.ClipOp.Difference, true)
  path.delete()
}

export function drawShapeInnerShadow(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  rect: Float32Array,
  effect: Effect,
  hasRadius: boolean
): void {
  const sp = effect.spread
  const shapeNode = node
  r.auxFill.setColor(r.ck.Color4f(effect.color.r, effect.color.g, effect.color.b, effect.color.a))
  r.auxFill.setImageFilter(r.getCachedDecalBlur(blurSigma(effect.radius)))
  r.auxFill.setBlendMode(figmaBlendModeToSkia(r.ck, effect.blendMode))

  const shapeRect = rect
  const shapeHasRadius = hasRadius

  canvas.save()
  try {
    if (shapeNode.type === 'ELLIPSE') {
      const builder = new r.ck.PathBuilder()
      builder.addOval(shapeRect)
      const path = builder.detachAndDelete()
      try {
        canvas.clipPath(path, r.ck.ClipOp.Intersect, true)
      } finally {
        path.delete()
      }
    } else if (isPathShape(shapeNode)) {
      const path = makeNodeShapePath(r, shapeNode, shapeRect, shapeHasRadius)
      try {
        canvas.clipPath(path, r.ck.ClipOp.Intersect, true)
      } finally {
        path.delete()
      }
    } else if (nodeHasSmoothCorners(shapeNode)) {
      const path = makeSmoothRRectPath(r, shapeNode)
      canvas.clipPath(path, r.ck.ClipOp.Intersect, true)
      path.delete()
    } else if (shapeHasRadius) {
      canvas.clipRRect(r.makeRRect(shapeNode), r.ck.ClipOp.Intersect, true)
    } else {
      canvas.clipRect(shapeRect, r.ck.ClipOp.Intersect, true)
    }

    const expand = effect.radius * 2
    const { x: localOffsetX, y: localOffsetY } = effect.offset

    const spreadPadding = sp < 0 ? -sp : 0
    const big = r.ck.LTRBRect(
      Math.min(-expand, -expand + localOffsetX - spreadPadding),
      Math.min(-expand, -expand + localOffsetY - spreadPadding),
      Math.max(shapeNode.width + expand, shapeNode.width + expand + localOffsetX + spreadPadding),
      Math.max(shapeNode.height + expand, shapeNode.height + expand + localOffsetY + spreadPadding)
    )
    const bigPathBuilder = new r.ck.PathBuilder()
    bigPathBuilder.addRect(big)
    const bigPath = bigPathBuilder.detachAndDelete()
    let innerPath: Path | null = null
    if (shapeNode.type === 'ELLIPSE') {
      const builder = new r.ck.PathBuilder()
      const offsetRect = r.ck.LTRBRect(
        localOffsetX + sp,
        localOffsetY + sp,
        shapeNode.width + localOffsetX - sp,
        shapeNode.height + localOffsetY - sp
      )
      builder.addOval(offsetRect)
      innerPath = builder.detachAndDelete()
    } else if (isPathShape(shapeNode)) {
      const sourcePath = makeNodeShapePath(r, shapeNode, shapeRect, shapeHasRadius)
      const transformedBuilder = new r.ck.PathBuilder()
      transformedBuilder.addPath(sourcePath, r.ck.Matrix.translated(localOffsetX, localOffsetY))
      sourcePath.delete()
      const transformed = transformedBuilder.detachAndDelete()
      innerPath = pathWithSpread(r, transformed, -sp)
      transformed.delete()
    } else if (nodeHasSmoothCorners(shapeNode)) {
      innerPath = makeSmoothRRectPath(r, shapeNode, -sp, localOffsetX, localOffsetY)
    } else if (shapeHasRadius) {
      const builder = new r.ck.PathBuilder()
      builder.addRRect(r.makeRRectWithOffset(shapeNode, localOffsetX, localOffsetY, sp))
      innerPath = builder.detachAndDelete()
    } else {
      const builder = new r.ck.PathBuilder()
      builder.addRect(
        r.ck.LTRBRect(
          localOffsetX + sp,
          localOffsetY + sp,
          shapeNode.width + localOffsetX - sp,
          shapeNode.height + localOffsetY - sp
        )
      )
      innerPath = builder.detachAndDelete()
    }

    const shadowPath = innerPath
      ? r.ck.Path.MakeFromOp(bigPath, innerPath, r.ck.PathOp.Difference)
      : null
    innerPath?.delete()
    bigPath.delete()
    if (shadowPath) {
      canvas.drawPath(shadowPath, r.auxFill)
      shadowPath.delete()
    }
  } finally {
    canvas.restore()
    r.auxFill.setImageFilter(null)
    r.auxFill.setBlendMode(r.ck.BlendMode.SrcOver)
  }
}

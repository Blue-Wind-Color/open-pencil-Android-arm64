import type { Canvas, Path } from 'canvaskit-wasm'

import type { SceneNode, Stroke } from '@open-pencil/scene-graph'

import type { SkiaRenderer } from '#core/canvas/renderer'
import { normalizeDashPattern } from '#core/canvas/strokes'

/** The share of a stroke's weight that lies outside the shape it outlines. */
export function strokeAlignShare(align: Stroke['align']): number {
  if (align === 'OUTSIDE') return 1
  if (align === 'CENTER') return 0.5
  return 0
}

function cornerRadii(node: SceneNode): [number, number, number, number] {
  if (!node.independentCorners) {
    return [node.cornerRadius, node.cornerRadius, node.cornerRadius, node.cornerRadius]
  }
  return [node.topLeftRadius, node.topRightRadius, node.bottomRightRadius, node.bottomLeftRadius]
}

/**
 * The outer and inner edges of a frame's stroke with sides of their own weights, as rounded
 * rectangles in CanvasKit's layout. Figma 126 strokes them as one ring: each inner corner
 * shrinks by the width of its own side on each axis, and each outer corner is a circle grown by
 * the narrower of its two sides, a side without a stroke not counting. `grow` pushes the outer
 * edge out and the inner edge in, as a shadow's spread grows a ring.
 */
export function sideStrokeRRects(
  node: SceneNode,
  align: Stroke['align'],
  grow = 0
): { outer: Float32Array; inner: Float32Array | null } {
  const share = strokeAlignShare(align)
  const weights = [
    node.borderTopWeight,
    node.borderRightWeight,
    node.borderBottomWeight,
    node.borderLeftWeight
  ]
  const [top, right, bottom, left] = weights.map((weight) => weight * share + grow)
  const [topIn, rightIn, bottomIn, leftIn] = weights.map((weight) => weight * (1 - share) + grow)
  const [tWeight, rWeight, bWeight, lWeight] = weights
  const [tl, tr, br, bl] = cornerRadii(node)
  const out = (radius: number, a: number, aWeight: number, b: number, bWeight: number) => {
    if (radius <= 0) return 0
    const stroked = [aWeight > 0 ? a : null, bWeight > 0 ? b : null].filter((side) => side !== null)
    return Math.max(0, radius + (stroked.length > 0 ? Math.min(...stroked) : grow))
  }
  const into = (radius: number, side: number) => Math.max(0, radius - side)
  const tlOut = out(tl, top, tWeight, left, lWeight)
  const trOut = out(tr, top, tWeight, right, rWeight)
  const brOut = out(br, bottom, bWeight, right, rWeight)
  const blOut = out(bl, bottom, bWeight, left, lWeight)
  const outer = new Float32Array([
    -left,
    -top,
    node.width + right,
    node.height + bottom,
    tlOut,
    tlOut,
    trOut,
    trOut,
    brOut,
    brOut,
    blOut,
    blOut
  ])
  if (leftIn + rightIn >= node.width || topIn + bottomIn >= node.height) {
    return { outer, inner: null }
  }
  const inner = new Float32Array([
    leftIn,
    topIn,
    node.width - rightIn,
    node.height - bottomIn,
    into(tl, leftIn),
    into(tl, topIn),
    into(tr, rightIn),
    into(tr, topIn),
    into(br, rightIn),
    into(br, bottomIn),
    into(bl, leftIn),
    into(bl, bottomIn)
  ])
  return { outer, inner }
}

/** Strokes a frame whose sides have their own weights, as one ring like Figma, or side by side when dashed. */
export function drawIndividualSideStrokes(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  stroke: Stroke
): void {
  const dashed = stroke.dashPattern && stroke.dashPattern.length > 0
  if (dashed && cornerRadii(node).some((radius) => radius > 0)) {
    drawDashedSideLines(r, canvas, node, stroke.align)
    return
  }
  r.strokePaint.setStyle(r.ck.PaintStyle.Fill)
  try {
    if (dashed) {
      r.strokePaint.setPathEffect(null)
      const path = dashedSidesPath(r, node, stroke.align, normalizeDashPattern(stroke.dashPattern))
      canvas.drawPath(path, r.strokePaint)
      path.delete()
      return
    }
    const { outer, inner } = sideStrokeRRects(node, stroke.align)
    if (inner) canvas.drawDRRect(outer, inner, r.strokePaint)
    else canvas.drawRRect(outer, r.strokePaint)
  } finally {
    r.strokePaint.setStyle(r.ck.PaintStyle.Stroke)
  }
}

/**
 * Where one side's dashes fall along its length: Figma 126 stretches the pattern so the side
 * holds a whole number of periods, rounded to the nearest, with half a dash at each end.
 */
export function sideDashSpans(length: number, pattern: readonly number[]): Array<[number, number]> {
  const period = pattern.reduce((sum, size) => sum + size, 0)
  if (period <= 0 || length <= 0) return [[0, Math.max(0, length)]]
  const scale = length / (Math.max(1, Math.round(length / period)) * period)
  const spans: Array<[number, number]> = []
  let position = (-pattern[0] * scale) / 2
  for (let index = 0; position < length; index++) {
    const size = pattern[index % pattern.length] * scale
    const start = Math.max(0, position)
    const end = Math.min(length, position + size)
    if (index % 2 === 0 && end > start) spans.push([start, end])
    position += size
  }
  return spans
}

/**
 * A dashed stroke with sides of their own weights on sharp corners, as Figma 126 draws it: each
 * side dashed on its own, and a square filling each corner between two stroked sides.
 */
function dashedSidesPath(
  r: SkiaRenderer,
  node: SceneNode,
  align: Stroke['align'],
  pattern: readonly number[]
): Path {
  const share = strokeAlignShare(align)
  const w = node.width
  const h = node.height
  const [top, right, bottom, left] = [
    node.borderTopWeight,
    node.borderRightWeight,
    node.borderBottomWeight,
    node.borderLeftWeight
  ]
  const builder = new r.ck.PathBuilder()
  const rect = (l: number, t: number, rr: number, b: number) =>
    builder.addRect(r.ck.LTRBRect(l, t, rr, b))
  if (top > 0)
    for (const [s, e] of sideDashSpans(w, pattern)) rect(s, -top * share, e, top * (1 - share))
  if (bottom > 0) {
    for (const [s, e] of sideDashSpans(w, pattern)) {
      rect(s, h - bottom * (1 - share), e, h + bottom * share)
    }
  }
  if (left > 0)
    for (const [s, e] of sideDashSpans(h, pattern)) rect(-left * share, s, left * (1 - share), e)
  if (right > 0) {
    for (const [s, e] of sideDashSpans(h, pattern)) {
      rect(w - right * (1 - share), s, w + right * share, e)
    }
  }
  if (top > 0 && left > 0) rect(-left * share, -top * share, 0, 0)
  if (top > 0 && right > 0) rect(w, -top * share, w + right * share, 0)
  if (bottom > 0 && right > 0) rect(w, h, w + right * share, h + bottom * share)
  if (bottom > 0 && left > 0) rect(-left * share, h, 0, h + bottom * share)
  return builder.detachAndDelete()
}

/** Dashed sides on rounded corners, drawn as straight dashed lines along each side. */
function drawDashedSideLines(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  align: 'INSIDE' | 'CENTER' | 'OUTSIDE'
): void {
  const w = node.width
  const h = node.height
  const inside = align === 'INSIDE'
  const outside = align === 'OUTSIDE'

  const tw = node.borderTopWeight
  if (tw > 0) {
    let y = 0
    if (inside) y = tw / 2
    else if (outside) y = -tw / 2
    r.strokePaint.setStrokeWidth(tw)
    canvas.drawLine(0, y, w, y, r.strokePaint)
  }

  const rw = node.borderRightWeight
  if (rw > 0) {
    let x = w
    if (inside) x = w - rw / 2
    else if (outside) x = w + rw / 2
    r.strokePaint.setStrokeWidth(rw)
    canvas.drawLine(x, 0, x, h, r.strokePaint)
  }

  const bw = node.borderBottomWeight
  if (bw > 0) {
    let y = h
    if (inside) y = h - bw / 2
    else if (outside) y = h + bw / 2
    r.strokePaint.setStrokeWidth(bw)
    canvas.drawLine(0, y, w, y, r.strokePaint)
  }

  const lw = node.borderLeftWeight
  if (lw > 0) {
    let x = 0
    if (inside) x = lw / 2
    else if (outside) x = -lw / 2
    r.strokePaint.setStrokeWidth(lw)
    canvas.drawLine(x, 0, x, h, r.strokePaint)
  }
}

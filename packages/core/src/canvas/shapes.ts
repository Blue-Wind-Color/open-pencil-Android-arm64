import type { Canvas, Path } from 'canvaskit-wasm'

import type { SceneNode } from '@open-pencil/scene-graph'
import { polygonOutline, type PolygonOutlineCommand } from '@open-pencil/scene-graph/polygon'
import { shapeWithTextGeometry } from '@open-pencil/scene-graph/shape-with-text'

import { vectorNetworkToPath, geometryBlobToPath } from '#core/vector'

import { traceSmoothRect } from './paths/smooth-corners'
import type { SkiaRenderer } from './renderer'

export function nodeHasRadius(node: SceneNode): boolean {
  return (
    node.cornerRadius > 0 ||
    (node.independentCorners &&
      (node.topLeftRadius > 0 ||
        node.topRightRadius > 0 ||
        node.bottomRightRadius > 0 ||
        node.bottomLeftRadius > 0))
  )
}

export function nodeHasSmoothCorners(node: SceneNode): boolean {
  if (!(node.cornerSmoothing > 0)) return false
  if (node.independentCorners) {
    return (
      node.topLeftRadius > 0 ||
      node.topRightRadius > 0 ||
      node.bottomRightRadius > 0 ||
      node.bottomLeftRadius > 0
    )
  }
  return node.cornerRadius > 0
}

export function makeSmoothRRectPath(
  r: SkiaRenderer,
  node: SceneNode,
  spread = 0,
  offsetX = 0,
  offsetY = 0
): Path {
  const path = new r.ck.PathBuilder()
  const left = offsetX - spread
  const top = offsetY - spread
  const right = offsetX + node.width + spread
  const bottom = offsetY + node.height + spread
  const width = right - left
  const height = bottom - top
  if (width <= 0 || height <= 0) {
    path.addRect(r.ck.LTRBRect(left, top, Math.max(left, right), Math.max(top, bottom)))
    return path.detachAndDelete()
  }

  if (!traceSmoothRect(path, node, { left, top, right, bottom }, spread)) {
    path.addRect(r.ck.LTRBRect(left, top, right, bottom))
  }
  return path.detachAndDelete()
}

export function makeNodeShapePath(
  r: SkiaRenderer,
  node: SceneNode,
  rect: Float32Array,
  hasRadius: boolean
): Path {
  const path = new r.ck.PathBuilder()
  switch (node.type) {
    case 'ELLIPSE':
      path.addOval(rect)
      break
    case 'VECTOR': {
      const vps = r.getVectorPaths(node)
      if (vps) {
        for (const vp of vps) path.addPath(vp)
      }
      break
    }
    case 'POLYGON':
    case 'STAR':
    case 'SHAPE_WITH_TEXT': {
      const polyPath = r.makePolygonPath(node)
      path.addPath(polyPath)
      polyPath.delete()
      break
    }
    default:
      if (nodeHasSmoothCorners(node)) {
        const smoothPath = makeSmoothRRectPath(r, node)
        path.addPath(smoothPath)
        smoothPath.delete()
      } else if (hasRadius) {
        path.addRRect(r.makeRRect(node))
      } else {
        path.addRect(rect)
      }
  }
  return path.detachAndDelete()
}

function outlinePath(r: SkiaRenderer, commands: PolygonOutlineCommand[]): Path {
  const path = new r.ck.PathBuilder()
  for (const command of commands) {
    if (command.type === 'M') path.moveTo(command.x, command.y)
    else if (command.type === 'L') path.lineTo(command.x, command.y)
    else if (command.type === 'C')
      path.cubicTo(command.x1, command.y1, command.x2, command.y2, command.x, command.y)
    else path.close()
  }
  return path.detachAndDelete()
}

/**
 * The polygon or star with its corner radius and smoothing, as Figma draws it, or the outline of
 * a shape with text.
 */
export function makePolygonPath(r: SkiaRenderer, node: SceneNode): Path {
  if (node.type === 'SHAPE_WITH_TEXT') {
    return outlinePath(
      r,
      shapeWithTextGeometry(node.shapeWithTextType, node.width, node.height, node.cornerRadius)
        .outline
    )
  }
  return outlinePath(r, polygonOutline(node))
}

/** A shape with text's stroke-only inner lines, such as a database's front rim, if it has any. */
export function makeShapeWithTextDetailsPath(r: SkiaRenderer, node: SceneNode): Path | null {
  if (node.type !== 'SHAPE_WITH_TEXT') return null
  const { details } = shapeWithTextGeometry(node.shapeWithTextType, node.width, node.height)
  return details.length > 0 ? outlinePath(r, details) : null
}

export function makeRRect(r: SkiaRenderer, node: SceneNode): Float32Array {
  if (node.independentCorners) {
    return new Float32Array([
      0,
      0,
      node.width,
      node.height,
      node.topLeftRadius,
      node.topLeftRadius,
      node.topRightRadius,
      node.topRightRadius,
      node.bottomRightRadius,
      node.bottomRightRadius,
      node.bottomLeftRadius,
      node.bottomLeftRadius
    ])
  }
  return r.ck.RRectXY(
    r.ck.LTRBRect(0, 0, node.width, node.height),
    node.cornerRadius,
    node.cornerRadius
  )
}

export function makeRRectWithSpread(
  r: SkiaRenderer,
  node: SceneNode,
  spread: number
): Float32Array {
  if (node.independentCorners) {
    return new Float32Array([
      -spread,
      -spread,
      node.width + spread,
      node.height + spread,
      Math.max(0, node.topLeftRadius + spread),
      Math.max(0, node.topLeftRadius + spread),
      Math.max(0, node.topRightRadius + spread),
      Math.max(0, node.topRightRadius + spread),
      Math.max(0, node.bottomRightRadius + spread),
      Math.max(0, node.bottomRightRadius + spread),
      Math.max(0, node.bottomLeftRadius + spread),
      Math.max(0, node.bottomLeftRadius + spread)
    ])
  }
  return r.ck.RRectXY(
    r.ck.LTRBRect(-spread, -spread, node.width + spread, node.height + spread),
    Math.max(0, node.cornerRadius + spread),
    Math.max(0, node.cornerRadius + spread)
  )
}

export function makeRRectWithOffset(
  r: SkiaRenderer,
  node: SceneNode,
  ox: number,
  oy: number,
  spread: number
): Float32Array {
  const s = spread
  if (node.independentCorners) {
    return new Float32Array([
      ox + s,
      oy + s,
      node.width + ox - s,
      node.height + oy - s,
      Math.max(0, node.topLeftRadius - s),
      Math.max(0, node.topLeftRadius - s),
      Math.max(0, node.topRightRadius - s),
      Math.max(0, node.topRightRadius - s),
      Math.max(0, node.bottomRightRadius - s),
      Math.max(0, node.bottomRightRadius - s),
      Math.max(0, node.bottomLeftRadius - s),
      Math.max(0, node.bottomLeftRadius - s)
    ])
  }
  return r.ck.RRectXY(
    r.ck.LTRBRect(ox + s, oy + s, node.width + ox - s, node.height + oy - s),
    Math.max(0, node.cornerRadius - s),
    Math.max(0, node.cornerRadius - s)
  )
}

export function clipNodeShape(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  rect: Float32Array,
  hasRadius: boolean
): void {
  if (node.type === 'SHAPE_WITH_TEXT') {
    // Clipped by its kind's outline, so an inside stroke follows it rather than the box.
    const clipPath = r.makePolygonPath(node)
    canvas.clipPath(clipPath, r.ck.ClipOp.Intersect, true)
    clipPath.delete()
  } else if (node.type === 'ELLIPSE') {
    const clipPath = new r.ck.PathBuilder()
    clipPath.addOval(rect)
    const immutableClipPath = clipPath.detachAndDelete()
    canvas.clipPath(immutableClipPath, r.ck.ClipOp.Intersect, true)
    immutableClipPath.delete()
  } else if (nodeHasSmoothCorners(node)) {
    const clipPath = makeSmoothRRectPath(r, node)
    canvas.clipPath(clipPath, r.ck.ClipOp.Intersect, true)
    clipPath.delete()
  } else if (hasRadius) {
    canvas.clipRRect(r.makeRRect(node), r.ck.ClipOp.Intersect, true)
  } else {
    canvas.clipRect(rect, r.ck.ClipOp.Intersect, true)
  }
}

export function getVectorPaths(r: SkiaRenderer, node: SceneNode): Path[] | null {
  if (!node.vectorNetwork) return null
  const cached = r.nodePaths.vector.get(node.id)
  if (cached) return cached
  const paths = vectorNetworkToPath(r.ck, node.vectorNetwork, node.cornerRadius)
  r.nodePaths.store(r.nodePaths.vector, node.id, paths)
  return paths
}

export function getFillGeometry(r: SkiaRenderer, node: SceneNode): Path[] | null {
  if (node.fillGeometry.length === 0) return null
  const cached = r.nodePaths.fillGeometry.get(node.id)
  if (cached) return cached
  const paths = node.fillGeometry.map((g) =>
    geometryBlobToPath(r.ck, g.commandsBlob, g.windingRule)
  )
  r.nodePaths.store(r.nodePaths.fillGeometry, node.id, paths)
  return paths
}

export function getStrokeGeometry(r: SkiaRenderer, node: SceneNode): Path[] | null {
  if (node.strokeGeometry.length === 0) return null
  const cached = r.nodePaths.strokeGeometry.get(node.id)
  if (cached) return cached
  const paths = node.strokeGeometry.map((g) =>
    geometryBlobToPath(r.ck, g.commandsBlob, g.windingRule)
  )
  r.nodePaths.store(r.nodePaths.strokeGeometry, node.id, paths)
  return paths
}

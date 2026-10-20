import type { Canvas, Image, Paint } from 'canvaskit-wasm'

import type { SceneNode, SceneGraph, Fill } from '@open-pencil/scene-graph'
import { invertGradientTransform } from '@open-pencil/scene-graph/gradient'
import Matrix from '@open-pencil/scene-graph/matrix'
import type { Color, Rect, Vector } from '@open-pencil/scene-graph/primitives'

import { figmaBlendModeToSkia } from './blend'
import { makeDiamondGradient } from './gradients/diamond'
import { previewEdge } from './images/previews'
import type { SkiaRenderer } from './renderer'
import { makeSmoothRRectPath, nodeHasSmoothCorners } from './shapes'

interface PaintFillsOptions {
  readonly bindToNodeFills?: boolean
  readonly patternStack?: Set<string>
}

export function paintFills(
  r: SkiaRenderer,
  fills: readonly Fill[],
  node: SceneNode,
  graph: SceneGraph,
  draw: (fill: Fill) => void,
  options: PaintFillsOptions = {}
): void {
  for (let index = 0; index < fills.length; index++) {
    const fill = fills[index]
    if (!fill.visible) continue
    const fillIndex = options.bindToNodeFills === false ? -1 : index
    const applied = options.patternStack
      ? applyFill(r, fill, node, graph, fillIndex, options.patternStack)
      : r.applyFill(fill, node, graph, fillIndex)
    if (!applied) continue
    r.fillPaint.setAlphaf(fill.opacity)
    r.fillPaint.setBlendMode(figmaBlendModeToSkia(r.ck, fill.blendMode))
    draw(fill)
    r.fillPaint.setShader(null)
    r.fillPaint.setBlendMode(r.ck.BlendMode.SrcOver)
  }
}

export function drawVectorMultiStyleFills(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  graph: SceneGraph,
  patternStack?: Set<string>
): boolean {
  if (node.type !== 'VECTOR' || !node.fillGeometry.some((geometry) => geometry.fills?.length)) {
    return false
  }
  const paths = r.getFillGeometry(node)
  if (!paths) return false

  for (let index = 0; index < node.fillGeometry.length; index++) {
    const geometry = node.fillGeometry[index]
    const path = paths[index]
    const usesPathFills = Boolean(geometry.fills?.length)
    paintFills(
      r,
      usesPathFills ? (geometry.fills ?? []) : node.fills,
      node,
      graph,
      () => canvas.drawPath(path, r.fillPaint),
      { bindToNodeFills: !usesPathFills, patternStack }
    )
  }
  return true
}

export function drawNodeFill(
  r: SkiaRenderer,
  canvas: Canvas,
  node: SceneNode,
  rect: Float32Array,
  hasRadius: boolean,
  fill?: Fill
): void {
  switch (node.type) {
    case 'VECTOR': {
      const fg = r.getFillGeometry(node)
      if (fg) {
        for (const p of fg) canvas.drawPath(p, r.fillPaint)
      } else {
        const vps = r.getVectorPaths(node)
        if (vps) {
          for (const vp of vps) canvas.drawPath(vp, r.fillPaint)
        }
      }
      break
    }
    case 'ELLIPSE': {
      const fg = r.getFillGeometry(node)
      if (fg) {
        for (const p of fg) canvas.drawPath(p, r.fillPaint)
      } else if (node.arcData) {
        r.drawArc(canvas, node, r.fillPaint)
      } else {
        canvas.drawOval(rect, r.fillPaint)
      }
      break
    }
    case 'TEXT':
      r.renderText(canvas, node, fill)
      break
    case 'LINE':
      canvas.drawLine(0, 0, node.width, node.height, r.fillPaint)
      break
    case 'POLYGON':
    case 'STAR':
    case 'SHAPE_WITH_TEXT': {
      const path = r.makePolygonPath(node)
      canvas.drawPath(path, r.fillPaint)
      path.delete()
      break
    }
    default:
      if (nodeHasSmoothCorners(node)) {
        const path = makeSmoothRRectPath(r, node)
        canvas.drawPath(path, r.fillPaint)
        path.delete()
      } else if (hasRadius) {
        canvas.drawRRect(r.makeRRect(node), r.fillPaint)
      } else {
        canvas.drawRect(rect, r.fillPaint)
      }
  }
}

export function applyFill(
  r: SkiaRenderer,
  fill: Fill,
  node: SceneNode,
  graph: SceneGraph,
  fillIndex = 0,
  patternStack = new Set<string>()
): boolean {
  r.fillPaint.setShader(null)

  if (fill.type === 'SOLID') {
    const c = r.resolveFillColor(fill, fillIndex, node, graph)
    r.fillPaint.setColor(r.ck.Color4f(c.r, c.g, c.b, c.a))
    return true
  }

  if (fill.type.startsWith('GRADIENT') && fill.gradientStops && fill.gradientTransform) {
    r.applyGradientFill(fill, node, graph)
    return true
  }

  if (fill.type === 'IMAGE' && fill.imageHash) {
    return r.applyImageFill(fill, node, graph)
  }

  if (fill.type === 'PATTERN' && applyPatternFill(r, fill, node, graph, patternStack)) return true

  if (fill.type === 'PATTERN' || fill.type === 'NOISE' || fill.type === 'CUSTOM') {
    const c = r.resolveFillColor(fill, fillIndex, node, graph)
    r.fillPaint.setColor(r.ck.Color4f(c.r, c.g, c.b, c.a))
    return true
  }

  return false
}

interface PatternTileLayout {
  rect: Rect
  scale: number
  positions: Vector[]
}

function patternAlignmentOffset(
  alignment: Fill['horizontalAlignment'],
  gap: number,
  sourceSize: number,
  axis: 'x' | 'y'
): number {
  if (alignment === 'CENTER') return axis === 'x' ? -gap / 2 : -sourceSize / 2
  if (alignment === 'END') return -gap
  return 0
}

export function patternTileLayout(source: SceneNode, fill: Fill): PatternTileLayout {
  const scale = fill.scale && fill.scale > 0 ? fill.scale : 1
  const spacing = fill.patternSpacing ?? { x: 0, y: 0 }
  const scaledWidth = source.width * scale
  const scaledHeight = source.height * scale
  const gapX = scaledWidth * spacing.x
  const gapY = scaledHeight * spacing.y
  const width = scaledWidth + gapX
  const height = scaledHeight + gapY
  const x = patternAlignmentOffset(fill.horizontalAlignment, gapX, scaledWidth, 'x')
  const y = patternAlignmentOffset(fill.verticalAlignment, gapY, scaledHeight, 'y')
  const positions = [{ x, y }]

  if (fill.patternTileType === 'HORIZONTAL_HEXAGONAL') {
    positions.push({ x: x + width / 2, y: y + height / 2 })
  } else if (fill.patternTileType === 'VERTICAL_HEXAGONAL') {
    positions.push({ x: x + width / 2, y: y - height / 2 })
  }

  return { rect: { x: 0, y: 0, width, height }, scale, positions }
}

function recordPatternSource(
  r: SkiaRenderer,
  source: SceneNode,
  graph: SceneGraph,
  layout: PatternTileLayout,
  patternStack: Set<string>
) {
  const bounds = r.ck.LTRBRect(0, 0, layout.rect.width, layout.rect.height)
  const recorder = new r.ck.PictureRecorder()
  const canvas = recorder.beginRecording(bounds)
  const rect = r.ck.LTRBRect(0, 0, source.width, source.height)
  const hasRadius = nodeHasSmoothCorners(source) || source.cornerRadius > 0

  for (const position of layout.positions) {
    canvas.save()
    canvas.translate(position.x, position.y)
    canvas.scale(layout.scale, layout.scale)
    if (!drawVectorMultiStyleFills(r, canvas, source, graph, patternStack)) {
      paintFills(
        r,
        source.fills,
        source,
        graph,
        (sourceFill) => drawNodeFill(r, canvas, source, rect, hasRadius, sourceFill),
        { patternStack }
      )
    }
    canvas.restore()
  }

  const picture = recorder.finishRecordingAsPicture()
  recorder.delete()
  return picture
}

function resolvePatternSource(graph: SceneGraph, sourceId: string): SceneNode | null {
  const direct = graph.getNode(sourceId)
  if (direct) return direct
  for (const node of graph.getAllNodes()) {
    if (node.source.id === sourceId) return node
  }
  return null
}

function applyPatternFill(
  r: SkiaRenderer,
  fill: Fill,
  node: SceneNode,
  graph: SceneGraph,
  patternStack: Set<string>
): boolean {
  const sourceId = fill.sourceNodeId
  if (!sourceId || sourceId === node.id || sourceId === node.source.id) return false
  const source = resolvePatternSource(graph, sourceId)
  if (!source || source.width <= 0 || source.height <= 0) return false
  if (patternStack.has(source.id)) return false

  patternStack.add(source.id)
  const layout = patternTileLayout(source, fill)
  let picture
  try {
    picture = recordPatternSource(r, source, graph, layout, patternStack)
  } finally {
    patternStack.delete(source.id)
  }
  const tile = layout.rect
  const tileRect = r.ck.LTRBRect(tile.x, tile.y, tile.x + tile.width, tile.y + tile.height)
  const shader = picture.makeShader(
    r.ck.TileMode.Repeat,
    r.ck.TileMode.Repeat,
    r.ck.FilterMode.Linear,
    undefined,
    tileRect
  )
  r.fillPaint.setShader(shader)
  shader.delete()
  picture.delete()
  return true
}

/** Gradient space to the layer's pixels: Figma's transform maps the other way, so it is inverted. */
function makeGradientLocalMatrix(
  r: SkiaRenderer,
  width: number,
  height: number,
  transform: NonNullable<Fill['gradientTransform']>
) {
  const t = invertGradientTransform(transform)
  return r.ck.Matrix.multiply(r.ck.Matrix.scaled(width, height), [
    t.m00,
    t.m01,
    t.m02,
    t.m10,
    t.m11,
    t.m12,
    0,
    0,
    1
  ])
}

/** Resolves one gradient stop's color, so a stroke resolves its own bindings, not a fill's. */
export type ResolveGradientStop = (color: Color, stopIndex: number) => Color

export function applyGradientFill(
  r: SkiaRenderer,
  fill: Fill,
  node: SceneNode,
  graph: SceneGraph,
  paint: Paint = r.fillPaint,
  resolveStop: ResolveGradientStop = (color, stopIndex) =>
    r.resolveFillColorInfo(
      { ...fill, type: 'SOLID', color, opacity: color.a, visible: true },
      stopIndex,
      node,
      graph
    ).color
): void {
  const stops = fill.gradientStops
  const t = fill.gradientTransform
  if (!stops || !t) return
  const colors = stops.map((s, index) => {
    const c = resolveStop(s.color, index)
    return r.ck.Color4f(c.r, c.g, c.b, c.a)
  })
  const positions = stops.map((s) => s.position)

  const w = node.width
  const h = node.height

  /** The paint keeps its own reference, so the caller's handle has to go or WASM memory grows. */
  const setShader = (shader: ReturnType<typeof makeDiamondGradient>) => {
    try {
      paint.setShader(shader)
    } finally {
      shader.delete()
    }
  }

  if (fill.type === 'GRADIENT_LINEAR') {
    // Drawn in gradient space, so its bands follow the transform's second axis as in Figma
    // rather than running square to the line on a stretched layer.
    const shader = r.ck.Shader.MakeLinearGradient(
      [0, 0.5],
      [1, 0.5],
      colors,
      positions,
      r.ck.TileMode.Clamp,
      makeGradientLocalMatrix(r, w, h, t)
    )
    setShader(shader)
  } else if (fill.type === 'GRADIENT_DIAMOND') {
    setShader(makeDiamondGradient(r, colors, positions, makeGradientLocalMatrix(r, w, h, t)))
  } else if (fill.type === 'GRADIENT_RADIAL') {
    // Gradient space is centred on (0.5, 0.5) with radius 0.5; the local matrix takes it to the
    // layer's pixels.
    const localMatrix = makeGradientLocalMatrix(r, w, h, t)
    const shader = r.ck.Shader.MakeRadialGradient(
      [0.5, 0.5],
      0.5,
      colors,
      positions,
      r.ck.TileMode.Clamp,
      localMatrix
    )
    setShader(shader)
  } else if (fill.type === 'GRADIENT_ANGULAR') {
    const localMatrix = makeGradientLocalMatrix(r, w, h, t)
    const shader = r.ck.Shader.MakeSweepGradient(
      0.5,
      0.5,
      colors,
      positions,
      r.ck.TileMode.Clamp,
      localMatrix
    )
    setShader(shader)
  }
}

/**
 * Maps `img`'s pixels onto `node` as `fill` places them. `size` is the image's own size when `img`
 * is a downscaled preview, so a tile keeps its size. A crop places the image by its transform;
 * Fill, Fit and Tile ignore it, as Figma does, and turn the image by `imageRotation` first.
 */
export function makeImageFillLocalMatrix(
  fill: Fill,
  node: SceneNode,
  imgW: number,
  imgH: number,
  size: { width: number; height: number } = { width: imgW, height: imgH }
) {
  const scaleMode = fill.imageScaleMode ?? 'FILL'
  if (scaleMode === 'CROP' && fill.imageTransform) {
    const t = fill.imageTransform
    const inverse = Matrix.invert([t.m00, t.m01, t.m02, t.m10, t.m11, t.m12, 0, 0, 1])
    if (inverse)
      return Matrix.multiply(
        Matrix.scaled(node.width, node.height),
        inverse,
        Matrix.scaled(1 / imgW, 1 / imgH)
      )
  }

  const radians = ((fill.imageRotation ?? 0) * Math.PI) / 180
  const cos = Math.abs(Math.cos(radians))
  const sin = Math.abs(Math.sin(radians))
  const turnedW = size.width * cos + size.height * sin
  const turnedH = size.width * sin + size.height * cos
  const turned = Matrix.multiply(
    Matrix.translated(turnedW / 2, turnedH / 2),
    Matrix.rotated(radians),
    Matrix.translated(-size.width / 2, -size.height / 2),
    Matrix.scaled(size.width / imgW, size.height / imgH)
  )
  if (scaleMode === 'TILE') {
    const scale = fill.scale && fill.scale > 0 ? fill.scale : 1
    return Matrix.multiply(Matrix.scaled(scale, scale), turned)
  }
  const fit = scaleMode === 'FIT'
  const scale = (fit ? Math.min : Math.max)(node.width / turnedW, node.height / turnedH)
  return Matrix.multiply(
    Matrix.translated((node.width - turnedW * scale) / 2, (node.height - turnedH * scale) / 2),
    Matrix.scaled(scale, scale),
    turned
  )
}

/**
 * Sets `paint`'s shader to `img` laid out as `fill` places it on `node`; `preview`, when `img`
 * is a downscaled preview, keeps a tiled image at its original size.
 */
function setImageShader(
  r: SkiaRenderer,
  fill: Fill,
  node: SceneNode,
  img: Image,
  paint: Paint,
  preview?: { originalWidth: number; originalHeight: number }
): boolean {
  const imgW = img.width()
  const imgH = img.height()
  const scaleMode = fill.imageScaleMode ?? 'FILL'
  const localMatrix = makeImageFillLocalMatrix(
    fill,
    node,
    imgW,
    imgH,
    preview && { width: preview.originalWidth, height: preview.originalHeight }
  )
  const tileMode = scaleMode === 'FIT' ? r.ck.TileMode.Decal : r.ck.TileMode.Clamp
  const shader =
    scaleMode === 'TILE'
      ? img.makeShaderCubic(r.ck.TileMode.Repeat, r.ck.TileMode.Repeat, 1 / 3, 1 / 3, localMatrix)
      : img.makeShaderOptions(
          tileMode,
          tileMode,
          r.ck.FilterMode.Linear,
          r.ck.MipmapMode.Linear,
          localMatrix
        )
  try {
    paint.setShader(shader)
  } finally {
    shader.delete()
  }
  return true
}

export function applyImageFill(
  r: SkiaRenderer,
  fill: Fill,
  node: SceneNode,
  graph: SceneGraph,
  paint: Paint = r.fillPaint
): boolean {
  const hash = fill.imageHash
  if (!hash) return false
  const live = r.liveImages.get(hash)
  if (live?.surface === r.surface) return setImageShader(r, fill, node, live.image, paint)
  const preview = r.viewportImageRendering
    ? // eslint-disable-next-line open-pencil/no-zoom-in-scene-drawing -- picks the preview resolution, not a size; preview mode draws the scene uncached on every frame.
      r.imagePreviews.get(graph, hash, previewEdge(node, r.zoom, r.dpr))
    : undefined
  if (r.viewportImageRendering && !preview) return false
  const key = preview?.key ?? hash
  let img = r.imageCache.get(key)
  let temporary = false
  if (!img) {
    const data = preview?.preview.bytes ?? graph.images.get(hash)
    if (!data) return false
    const decoded = r.ck.MakeImageFromEncoded(data)
    if (!decoded) return false
    try {
      img = decoded.makeCopyWithDefaultMipmaps()
    } finally {
      decoded.delete()
    }
    temporary = !r.imageCache.set(key, img)
  }

  try {
    return setImageShader(r, fill, node, img, paint, preview?.preview)
  } finally {
    if (temporary) img.delete()
  }
}

export function makeArcPath(r: SkiaRenderer, node: SceneNode) {
  const arc = node.arcData
  if (!arc) return null
  const cx = node.width / 2
  const cy = node.height / 2
  const rx = node.width / 2
  const ry = node.height / 2
  const innerRx = rx * arc.innerRadius
  const innerRy = ry * arc.innerRadius

  const startDeg = arc.startingAngle * (180 / Math.PI)
  const endDeg = arc.endingAngle * (180 / Math.PI)
  const sweepDeg = endDeg - startDeg

  const path = new r.ck.PathBuilder()
  const oval = r.ck.LTRBRect(0, 0, node.width, node.height)

  if (arc.innerRadius > 0) {
    path.addArc(oval, startDeg, sweepDeg)
    const innerOval = r.ck.LTRBRect(cx - innerRx, cy - innerRy, cx + innerRx, cy + innerRy)
    const innerPath = new r.ck.PathBuilder()
    innerPath.addArc(innerOval, startDeg + sweepDeg, -sweepDeg)
    const immutableInnerPath = innerPath.detachAndDelete()
    path.addPath(immutableInnerPath)
    immutableInnerPath.delete()
    path.close()
    return path.detachAndDelete()
  }

  const isFullCircle = Math.abs(sweepDeg) >= 359.99
  if (isFullCircle) {
    path.addOval(oval)
  } else {
    path.moveTo(cx, cy)
    path.addArc(oval, startDeg, sweepDeg)
    path.close()
  }
  return path.detachAndDelete()
}

export function drawArc(r: SkiaRenderer, canvas: Canvas, node: SceneNode, paint: Paint): void {
  const path = makeArcPath(r, node)
  if (!path) return
  canvas.drawPath(path, paint)
  path.delete()
}

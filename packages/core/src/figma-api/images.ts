/// <reference types="@figma/plugin-typings" />

import type { SceneGraph } from '@open-pencil/scene-graph'
import {
  computeImageHash,
  imageMimeType,
  imageSize,
  type ImageMimeType
} from '@open-pencil/scene-graph/images'

import { invalid, received } from './accessors/text/messages'

/** How a host fetches the URLs `figma.createImageAsync` loads. */
export type ImageFetch = (input: string, init?: RequestInit) => Promise<Response>

/** The largest width or height Figma takes an image at. */
const MAX_IMAGE_SIDE = 4096

/** The most bytes `createImageAsync` reads from a response, well above any 4096 × 4096 image. */
export const MAX_IMAGE_FETCH_BYTES = 64 * 1024 * 1024

/**
 * The bytes Figma needs before it takes an image: a PNG's header through its bit depth and color
 * type, and a GIF's logical screen size. A JPEG needs its start-of-frame, which `imageSize` reads.
 */
const MIN_HEADER_BYTES: Partial<Record<ImageMimeType, number>> = {
  'image/png': 26,
  'image/gif': 10
}

/** A PNG's signature and the type of its first chunk, which Figma requires byte for byte. */
const PNG_HEADER = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52
]

/** Figma's complaint about `data` as an image, or null when it takes it. */
function imageProblem(data: Uint8Array): string | null {
  const type = imageMimeType(data)
  const size = type === 'image/webp' ? null : imageSize(data)
  if (!size || size.width === 0 || size.height === 0) return 'Image type is unsupported'
  if (type === 'image/png' && PNG_HEADER.some((byte, index) => data[index] !== byte)) {
    return 'Image type is unsupported'
  }
  if (data.length < (MIN_HEADER_BYTES[type] ?? 0)) return 'Image type is unsupported'
  if (size.width > MAX_IMAGE_SIDE || size.height > MAX_IMAGE_SIDE) return 'Image is too large'
  return null
}

/** The document's image under `hash`, as Figma's `Image` gives it to a script. */
function figmaImage(graph: SceneGraph, hash: string): Image {
  const bytes = (method: string) => {
    const data = graph.images.get(hash)
    if (!data) throw new Error(`in ${method}: The document has no image ${hash}`)
    return data
  }
  return {
    hash,
    getBytesAsync: async () => bytes('getBytesAsync').slice(),
    getSizeAsync: async () => {
      const size = imageSize(bytes('getSizeAsync'))
      if (!size) throw new Error('in getSizeAsync: Image type is unsupported')
      return size
    }
  }
}

/**
 * Stores a copy of encoded image bytes under their hash and returns the hash, so a caller that
 * reuses its array afterwards cannot change the stored image. Tools store formats Figma's API
 * refuses, such as WebP, through this; scripts go through `createImage`.
 */
export function storeImage(graph: SceneGraph, data: Uint8Array): string {
  const stored = data.slice()
  const hash = computeImageHash(stored)
  graph.images.set(hash, stored)
  return hash
}

/**
 * The PNG, JPEG, or GIF in `data`, stored as `figma.createImage` stores it. Throws Figma's
 * messages for anything else and for an image wider or taller than 4096 pixels.
 */
export function createImage(graph: SceneGraph, data: unknown): Image {
  if (!(data instanceof Uint8Array)) {
    const problem =
      data === undefined
        ? 'Required value missing'
        : `Expected Uint8Array, received ${received(data)}`
    throw invalid('createImage', problem, 'createImage')
  }
  const problem = imageProblem(data)
  if (problem) throw new Error(`in createImage: ${problem}`)
  return figmaImage(graph, storeImage(graph, data))
}

/** The document's image under `hash`, as `figma.getImageByHash` gives it, or null. */
export function imageByHash(graph: SceneGraph, hash: unknown): Image | null {
  if (typeof hash !== 'string') {
    const problem =
      hash === undefined ? 'Required value missing' : `Expected string, received ${received(hash)}`
    throw invalid('getImageByHash', problem, 'getImageByHash')
  }
  return graph.images.has(hash) ? figmaImage(graph, hash) : null
}

/** The protocol of `src` when it is an absolute URL, or null. */
function protocol(src: string): string | null {
  try {
    return new URL(src).protocol
  } catch {
    return null
  }
}

/**
 * The body of `response`, refused as too large once it passes `MAX_IMAGE_FETCH_BYTES`. It reads
 * chunk by chunk and cancels there, so a body that declares no length, or a smaller one, cannot
 * fill memory first.
 */
async function readBounded(response: Response): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length') ?? 0) > MAX_IMAGE_FETCH_BYTES) {
    throw new Error('Image is too large')
  }
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > MAX_IMAGE_FETCH_BYTES) {
      await reader.cancel()
      throw new Error('Image is too large')
    }
    chunks.push(value)
  }
  const data = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    data.set(chunk, offset)
    offset += chunk.byteLength
  }
  return data
}

/**
 * The image at `src`, fetched and stored as `figma.createImageAsync` does. HTTP(S) URLs go
 * through the host's `fetch`; data URIs hold their bytes and are read here, since a desktop
 * proxy takes only HTTP(S). Figma's own server fetches the rest, so its messages name only the
 * status.
 */
export async function fetchImage(
  graph: SceneGraph,
  src: unknown,
  fetch: ImageFetch
): Promise<Image> {
  if (typeof src !== 'string') {
    const problem =
      src === undefined ? 'Required value missing' : `Expected string, received ${received(src)}`
    throw invalid('createImageAsync', problem, 'createImageAsync')
  }
  const scheme = protocol(src)
  if (scheme !== 'http:' && scheme !== 'https:' && scheme !== 'data:') {
    throw new Error('createImageAsync requires an absolute URL (http:// or https://) or a data URI')
  }
  const load = scheme === 'data:' ? globalThis.fetch : fetch
  const response = await load(src).catch((error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Unable to fetch image: ${reason}`)
  })
  if (!response.ok) throw new Error(`Unable to fetch image. Response status: ${response.status}`)
  const data = await readBounded(response)
  const problem = imageProblem(data)
  if (problem) throw new Error(problem)
  return figmaImage(graph, storeImage(graph, data))
}

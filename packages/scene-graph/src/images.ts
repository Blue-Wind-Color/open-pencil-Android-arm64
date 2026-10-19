import { sha1 } from '@noble/hashes/legacy.js'
import { bytesToHex } from '@noble/hashes/utils.js'

import type { Matrix } from './primitives'

/**
 * The name an image's bytes are stored under: the hex SHA-1 of the bytes, as Figma names images,
 * so `.fig` files and the Figma clipboard can carry the name as it is. Documents saved before may
 * hold images under other names; anything that hands images to Figma still checks.
 */
export function computeImageHash(data: Uint8Array): string {
  return bytesToHex(sha1(data))
}

export type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

/**
 * The media type of encoded image bytes, read from their signature, for writing them out as a
 * data URL or file. Bytes with no known signature are reported as PNG, as image fills began.
 */
export function imageMimeType(data: Uint8Array): ImageMimeType {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) return 'image/gif'
  const riff = data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
  const webp = data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  if (riff && webp) return 'image/webp'
  return 'image/png'
}

/**
 * The crop that shows an image as Fill does: scaled to cover a `width` × `height` layer and
 * centred. Figma starts a crop from it, as the image-space window a crop's transform holds.
 */
export function coverImageTransform(
  width: number,
  height: number,
  imageWidth: number,
  imageHeight: number
): Matrix {
  const scale = Math.max(width / imageWidth, height / imageHeight)
  const m00 = width / scale / imageWidth
  const m11 = height / scale / imageHeight
  return { m00, m01: 0, m02: (1 - m00) / 2, m10: 0, m11, m12: (1 - m11) / 2 }
}

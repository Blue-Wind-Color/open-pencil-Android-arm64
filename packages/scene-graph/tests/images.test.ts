import { describe, expect, test } from 'bun:test'

import { toUint8Array } from 'js-base64'

import {
  computeImageHash,
  coverImageTransform,
  imageMimeType,
  imageSize
} from '@open-pencil/scene-graph/images'

describe('computeImageHash', () => {
  test('names bytes by their SHA-1, as Figma names images', () => {
    expect(computeImageHash(new TextEncoder().encode('abc'))).toBe(
      'a9993e364706816aba3e25717850c26c9cd0d89d'
    )
    expect(computeImageHash(new Uint8Array())).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709')
  })
})

describe('imageMimeType', () => {
  test('reads the type from the bytes', () => {
    expect(imageMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe(
      'image/png'
    )
    expect(imageMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(imageMimeType(new TextEncoder().encode('GIF89a'))).toBe('image/gif')
    expect(imageMimeType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
  })

  test('reports bytes with no known signature as PNG', () => {
    expect(imageMimeType(new TextEncoder().encode('RIFF\0\0\0\0WAVEfmt '))).toBe('image/png')
    expect(imageMimeType(new Uint8Array())).toBe('image/png')
  })
})

describe('coverImageTransform', () => {
  test('crops the image to cover the layer, centred, as Figma starts a crop', () => {
    // Measured in Figma: a 412 × 364 image cropped on a 160 × 120 layer.
    const crop = coverImageTransform(160, 120, 412, 364)
    expect(crop.m00).toBeCloseTo(1)
    expect(crop.m02).toBeCloseTo(0)
    expect(crop.m11).toBeCloseTo(0.848901093006134)
    expect(crop.m12).toBeCloseTo(0.07554945349693298)
    const tall = coverImageTransform(100, 300, 200, 200)
    expect([tall.m00, tall.m02, tall.m11, tall.m12].map((v) => Math.round(v * 1000))).toEqual([
      333, 333, 1000, 0
    ])
  })
})

describe('imageSize', () => {
  // 37 × 21 images, encoded by Pillow.
  test.each([
    ['PNG', 'iVBORw0KGgoAAAANSUhEUgAAACUAAAAVCAIAAABOhrD5AAAANklEQVR4nO3NMREAAAzCQIp/z60EllwnXkAyq1f+3ak/luFe0h/LcC/pj2W4l/THMtxL+hPqAPB4ASnUWyUUAAAAAElFTkSuQmCC'],
    ['GIF', 'R0lGODdhJQAVAIEAAP8AAAAAAAAAAAAAACwAAAAAJQAVAEAILwABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqRJkgEBADs='],
    ['lossless WebP', 'UklGRhwAAABXRUJQVlA4TA8AAAAvJAAFAAcQ/Y/+ByKi/wEA'],
    ['lossy WebP', 'UklGRk4AAABXRUJQVlA4IEIAAACQAwCdASolABUAPm02l0ikIyIhJWgAgA2JZwDPkoB+AAAr98NwAP7wm0P/5BcsLrka//yA/5Af8gP/498Ql180AAA=']
  ])('reads a %s header', (_format, base64) => {
    expect(imageSize(toUint8Array(base64))).toEqual({ width: 37, height: 21 })
  })

  test('reads a JPEG frame header past the segments before it', () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc4, 0x00, 0x02, 0xff, 0xc0, 0x00,
      0x11, 0x08, 0x00, 0x15, 0x00, 0x25, 0x03
    ])
    expect(imageSize(jpeg)).toEqual({ width: 37, height: 21 })
  })

  test('gives null for bytes it cannot read', () => {
    expect(imageSize(new TextEncoder().encode('not an image'))).toBeNull()
  })
})

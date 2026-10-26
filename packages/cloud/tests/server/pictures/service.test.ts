import { describe, expect, test } from 'bun:test'

import { pngHeader } from '#cloud-tests/helpers/pictures'
import { CLOUD_PICTURE_MAX_BYTES } from '#cloud/contract'
import { pictureFormat } from '#cloud/server/pictures'
import { utf8ToBytes } from '@noble/hashes/utils.js'

describe('picture format', () => {
  test('keeps PNG and JPEG pictures of a reasonable size', () => {
    expect(pictureFormat(pngHeader(256, 256))).toBe('png')
    const jpeg = new Uint8Array([
      0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff,
      0xc0, 0, 17, 8, 1, 0, 1, 0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9
    ])
    expect(pictureFormat(jpeg)).toBe('jpeg')
  })

  test('refuses other files, huge sizes, and oversized bytes', () => {
    expect(pictureFormat(utf8ToBytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull()
    expect(pictureFormat(new Uint8Array())).toBeNull()
    expect(pictureFormat(pngHeader(4096, 4096))).toBeNull()
    const padded = new Uint8Array(CLOUD_PICTURE_MAX_BYTES + 1)
    padded.set(pngHeader(256, 256))
    expect(pictureFormat(padded)).toBeNull()
  })
})

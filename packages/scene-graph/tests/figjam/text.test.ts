import { describe, expect, test } from 'bun:test'

import { figJamTextSizeFields, figJamTypeface, figJamTypefaceFields } from '@open-pencil/scene-graph/figjam'

// Values measured in FigJam's text menus.
describe("FigJam's text", () => {
  test('each size sets its tracking, and the line stays one and a half times the size', () => {
    expect(figJamTextSizeFields('huge')).toEqual({
      fontSize: 96,
      lineHeight: 144,
      letterSpacing: 96 * -0.023
    })
  })

  test('typefaces set their face, and Scribbled sets no tracking', () => {
    expect(figJamTypefaceFields('bookish', { fontSize: 24 })).toMatchObject({
      fontFamily: 'Merriweather',
      fontWeight: 400,
      fontSize: 24,
      letterSpacing: 24 * -0.019
    })
    expect(figJamTypefaceFields('scribbled', { fontSize: 16 })).toMatchObject({
      fontFamily: 'Figma Hand',
      letterSpacing: 0
    })
    expect(figJamTypeface({ fontFamily: 'Roboto Mono' })).toBe('technical')
    expect(figJamTypeface({ fontFamily: 'Comic Sans' })).toBeNull()
  })
})

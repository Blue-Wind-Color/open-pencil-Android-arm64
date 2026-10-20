import { describe, expect, test } from 'bun:test'

import {
  SHAPE_WITH_TEXT_TYPES,
  fitShapeWithText,
  shapeWithTextLabelBox
} from '@open-pencil/scene-graph/shape-with-text'

describe('shape-with-text label boxes and fit', () => {
  for (const type of SHAPE_WITH_TEXT_TYPES) {
    test(`${type} keeps its label inside the box`, () => {
      const box = shapeWithTextLabelBox(type, 200, 100)
      expect(box.width).toBeGreaterThan(0)
      expect(box.height).toBeGreaterThan(0)
      expect(box.x + box.width).toBeLessThanOrEqual(200)
      expect(box.y + box.height).toBeLessThanOrEqual(100)
    })
  }

  test('a small shape keeps every label box inside it', () => {
    for (const type of SHAPE_WITH_TEXT_TYPES) {
      const box = shapeWithTextLabelBox(type, 20, 20)
      expect(box.x + box.width).toBeLessThanOrEqual(20)
      expect(box.y + box.height).toBeLessThanOrEqual(20)
    }
  })

  test('a zero-sized shape gives an empty label box instead of a negative one', () => {
    expect(shapeWithTextLabelBox('SQUARE', 0, 0)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  // A label of 40 characters 8 px wide on 20 px lines, wrapped at `maxWidth`.
  const measure = (maxWidth: number) => ({
    width: Math.min(320, maxWidth),
    height: Math.ceil(320 / Math.max(maxWidth, 1)) * 20
  })

  test('a shape keeps the size it was given while its label fits', () => {
    expect(
      fitShapeWithText('SQUARE', { width: 400, height: 100, longestWord: 40, measure })
    ).toEqual({ width: 400, height: 100 })
  })

  test('a box grows taller, not wider, for a label that wraps', () => {
    const fitted = fitShapeWithText('SQUARE', { width: 120, height: 40, longestWord: 40, measure })
    expect(fitted.width).toBe(120)
    expect(fitted.height).toBeGreaterThan(40)
  })

  test('a word wider than the label widens the shape just enough, without splitting it', () => {
    const fitted = fitShapeWithText('SQUARE', { width: 60, height: 60, longestWord: 100, measure })
    expect(fitted.width).toBeGreaterThan(60)
    expect(fitShapeWithText('SQUARE', { ...fitted, longestWord: 100, measure })).toEqual(fitted)
  })

  test('ellipses and diamonds grow in proportion', () => {
    for (const type of ['ELLIPSE', 'DIAMOND'] as const) {
      const fitted = fitShapeWithText(type, { width: 120, height: 80, longestWord: 40, measure })
      expect(fitted.width).toBeGreaterThan(120)
      expect(fitted.width / fitted.height).toBeCloseTo(1.5, 1)
    }
  })

  test('a round kind grows only as much as its label needs', () => {
    // Seven 20 px lines: a 208 px diamond's label box is 96 tall, so it needs 228 px.
    const sevenLines = () => ({ width: 40, height: 140 })
    for (const type of ['DIAMOND', 'ELLIPSE'] as const) {
      const fitted = fitShapeWithText(type, {
        width: 208,
        height: 208,
        longestWord: 40,
        measure: sevenLines
      })
      expect(fitted.width).toBe(fitted.height)
      expect(
        shapeWithTextLabelBox(type, fitted.width, fitted.height).height
      ).toBeGreaterThanOrEqual(140)
      // Within a pixel of the smallest size that fits.
      expect(shapeWithTextLabelBox(type, fitted.width - 2, fitted.height - 2).height).toBeLessThan(
        140
      )
    }
  })
})

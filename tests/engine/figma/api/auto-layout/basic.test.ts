import { describe, expect, test } from 'bun:test'

import { createAPI } from '../helpers'

describe('auto-layout', () => {
  test('layoutMode', () => {
    const api = createAPI()
    const frame = api.createFrame()
    frame.layoutMode = 'VERTICAL'
    expect(frame.layoutMode).toBe('VERTICAL')
  })

  test('itemSpacing', () => {
    const api = createAPI()
    const frame = api.createFrame()
    frame.layoutMode = 'VERTICAL'
    frame.itemSpacing = 12
    expect(frame.itemSpacing).toBe(12)
  })

  test('padding', () => {
    const api = createAPI()
    const frame = api.createFrame()
    frame.paddingTop = 16
    frame.paddingRight = 24
    frame.paddingBottom = 16
    frame.paddingLeft = 24
    expect(frame.paddingTop).toBe(16)
    expect(frame.paddingRight).toBe(24)
  })

  test('alignment', () => {
    const api = createAPI()
    const frame = api.createFrame()
    frame.layoutMode = 'HORIZONTAL'
    frame.primaryAxisAlignItems = 'SPACE_BETWEEN'
    frame.counterAxisAlignItems = 'CENTER'
    expect(frame.primaryAxisAlignItems).toBe('SPACE_BETWEEN')
    expect(frame.counterAxisAlignItems).toBe('CENTER')
  })

  test('layoutWrap', () => {
    const api = createAPI()
    const frame = api.createFrame()
    frame.layoutWrap = 'WRAP'
    expect(frame.layoutWrap).toBe('WRAP')
  })
})

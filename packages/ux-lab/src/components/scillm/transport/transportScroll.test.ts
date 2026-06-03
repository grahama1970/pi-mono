import { describe, expect, it } from 'vitest'
import { isNearBottom, shouldShowScrollToBottom } from './transportScroll'

describe('transportScroll', () => {
  it('isNearBottom when within threshold', () => {
    expect(isNearBottom(1000, 900, 100, 80)).toBe(true)
    expect(isNearBottom(1000, 700, 100, 80)).toBe(false)
  })

  it('hides scroll button when already at bottom or content fits', () => {
    expect(shouldShowScrollToBottom(500, 400, 100)).toBe(false)
    expect(shouldShowScrollToBottom(200, 0, 400)).toBe(false)
    expect(shouldShowScrollToBottom(1000, 200, 400)).toBe(true)
  })
})

import { describe, expect, it } from 'vitest'
import { parseReasoningSteps, reasoningPreview } from './reasoningFormat'

describe('parseReasoningSteps', () => {
  it('splits on blank lines into paragraphs', () => {
    expect(parseReasoningSteps('First thought.\n\nSecond thought.')).toEqual([
      'First thought.',
      'Second thought.',
    ])
  })

  it('splits bullet lists', () => {
    expect(parseReasoningSteps('- one\n- two\n- three')).toEqual(['one', 'two', 'three'])
  })

  it('returns single block for one paragraph', () => {
    expect(parseReasoningSteps('Only one block of reasoning here.')).toEqual([
      'Only one block of reasoning here.',
    ])
  })
})

describe('reasoningPreview', () => {
  it('truncates long previews', () => {
    const long = ['a'.repeat(100), 'b'.repeat(100)]
    expect(reasoningPreview(long, 50).endsWith('…')).toBe(true)
  })
})

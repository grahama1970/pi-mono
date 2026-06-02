import { describe, expect, it } from 'vitest'
import { filterDisplayMessages, messageVisibleInPreset } from './streamFilter'
import type { DisplayMessage } from './messageParse'

function msg(kind: DisplayMessage['kind']): DisplayMessage {
  return {
    id: '1',
    kind,
    collaborator: 'human',
    speaker: 'x',
    chipLabel: 'x',
    title: 'x',
    prose: '',
    artifacts: [],
    collapsed: false,
    metadata: {},
    raw: '',
  }
}

describe('streamFilter', () => {
  it('dialogue hides infrastructure', () => {
    expect(messageVisibleInPreset('system', 'dialogue')).toBe(false)
    expect(messageVisibleInPreset('human', 'dialogue')).toBe(true)
  })

  it('handoffs keeps spawn cards', () => {
    const list = filterDisplayMessages([msg('agent_card'), msg('system')], 'handoffs')
    expect(list.map((m) => m.kind)).toEqual(['agent_card'])
  })
})

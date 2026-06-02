import { describe, expect, it } from 'vitest'
import { buildTimelineSegments } from './timelineLayout'
import type { DisplayMessage } from './messageParse'

function msg(kind: DisplayMessage['kind'], id: string): DisplayMessage {
  return {
    id,
    kind,
    collaborator: 'worker',
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

describe('timelineLayout', () => {
  it('nests spawn, worker, and task under one block (no standalone spawn card)', () => {
    const segments = buildTimelineSegments([
      msg('agent_card', 'a'),
      msg('worker', 'w'),
      msg('task_card', 't'),
      msg('human', 'h'),
    ])
    expect(segments[0].type).toBe('nested')
    if (segments[0].type === 'nested') {
      expect(segments[0].messages.map((m) => m.message.kind)).toEqual(['agent_card', 'worker', 'task_card'])
    }
    expect(segments[1].type).toBe('message')
    if (segments[1].type === 'message') {
      expect(segments[1].message.kind).toBe('human')
    }
  })
})

import { describe, expect, it } from 'vitest'
import type { TransportDialogTurn } from './types'
import { parseDisplayMessage } from './messageParse'

describe('messageParse', () => {
  it('parses spawn card with subagent persona grammar', () => {
    const turn: TransportDialogTurn = {
      message_id: 's1',
      collaborator: 'project_agent',
      speaker: 'Project agent',
      text: '**Project agent**\n\nSpawned subagent Reviewer attempt 1.\n\nAgent: `scillm-worker`',
      subagent_kind: 'Reviewer',
      agent: 'scillm-worker',
      attempt_id: 1,
    }
    const msg = parseDisplayMessage(turn)
    expect(msg.kind).toBe('agent_card')
    expect(msg.title).toContain('Spawned subagent: Reviewer')
    expect(msg.title).toContain('scillm-worker')
    expect(msg.chipLabel).toBe('Reviewer')
  })

  it('parses task card with subagent task header', () => {
    const turn: TransportDialogTurn = {
      message_id: 't1',
      collaborator: 'worker',
      speaker: 'Worker',
      text: '## Worker task\nYou are the external reviewer.\nMode: advisory',
      subagent_kind: 'Reviewer',
    }
    const msg = parseDisplayMessage(turn)
    expect(msg.kind).toBe('task_card')
    expect(msg.title).toContain('Reviewer')
    expect(msg.speaker).toBe('Reviewer')
  })
})

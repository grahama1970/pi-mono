import { describe, expect, it } from 'vitest'
import { parseDisplayMessage, extractProofRoundLabel } from './messageParse'
import type { TransportDialogTurn } from './types'

describe('messageParse', () => {
  it('collapses forward lines to system events', () => {
    const turn: TransportDialogTurn = {
      message_id: '1',
      collaborator: 'project_agent',
      speaker: 'Project agent',
      text: '**Project agent**\n\nForwarding **human** input from this collaboration room into the worker dispatch.',
    }
    const msg = parseDisplayMessage(turn)
    expect(msg.kind).toBe('system')
    expect(msg.collapsed).toBe(true)
    expect(msg.collapseLabel).toContain('Forwarded')
  })

  it('extracts proof round from run id', () => {
    expect(extractProofRoundLabel('otr-proof-r008', 'transport-review-r008')).toBe('Proof Round 008')
  })

  it('classifies spawn as agent_card', () => {
    const turn: TransportDialogTurn = {
      message_id: '2',
      collaborator: 'project_agent',
      speaker: 'Project agent',
      text: '**Project agent**\n\nSpawned worker (reviewer attempt 1).\n\nAgent: `scillm-worker`\nMode: advisory',
    }
    const msg = parseDisplayMessage(turn)
    expect(msg.kind).toBe('agent_card')
    expect(msg.title).toContain('Spawned')
  })

  it('uses API subagent_kind on worker turns', () => {
    const turn: TransportDialogTurn = {
      message_id: 'w1',
      collaborator: 'worker',
      speaker: 'Worker (reviewer)',
      text: '**Worker (reviewer)**\n\nDone.',
      subagent_kind: 'Debugger',
      subagent_label: 'Debugger · scillm-debugger',
      agent: 'scillm-debugger',
      mode: 'propose_patches',
      attempt_id: 2,
    }
    const msg = parseDisplayMessage(turn)
    expect(msg.chipLabel).toBe('Debugger')
    expect(msg.title).toBe('Debugger · scillm-debugger')
    expect(msg.subtitle).toContain('propose_patches')
  })

  it('uses routing_hint from API when present', () => {
    const turn: TransportDialogTurn = {
      message_id: 'r1',
      collaborator: 'human',
      speaker: 'Human',
      text: 'hello',
      routing_hint: { label: 'Reviewer room', tone: 'to-reviewer', inferred: false },
    }
    const msg = parseDisplayMessage(turn)
    expect(msg.apiRouting?.label).toBe('Reviewer room')
    expect(msg.apiRouting?.inferred).toBe(false)
  })
})

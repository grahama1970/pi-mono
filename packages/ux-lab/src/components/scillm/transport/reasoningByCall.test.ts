import { describe, expect, it } from 'vitest'
import { buildReasoningByCall, isReasoningLive, reasoningForMessage } from './reasoningByCall'
import type { TransportCallRow } from './callInspector'
import type { DisplayMessage } from './messageParse'
import type { TransportStreamEvent } from './types'

const CALL_ID = 'otr-run-reviewer-1'

const calls: TransportCallRow[] = [
  {
    subagent_run_id: CALL_ID,
    role: 'reviewer',
    delivery_state: 'completed',
    active: false,
  },
]

const workerMessage: DisplayMessage = {
  id: 'msg-1',
  kind: 'worker',
  collaborator: 'worker',
  speaker: 'Code reviewer',
  chipLabel: 'Worker',
  title: 'Worker',
  prose: 'Done.',
  artifacts: [],
  collapsed: false,
  metadata: { subagentRunId: CALL_ID },
  raw: '',
}

describe('buildReasoningByCall', () => {
  it('merges reasoning_delta and reasoning_excerpt rows', () => {
    const events: TransportStreamEvent[] = [
      { event_type: 'reasoning_delta', subagent_run_id: CALL_ID, delta: 'Step one. ' },
      { event_type: 'reasoning_delta', subagent_run_id: CALL_ID, delta: 'Step two.' },
      { reasoning_excerpt: 'Step one. Step two.', subagent_run_id: CALL_ID },
    ]
    expect(buildReasoningByCall(events).get(CALL_ID)).toBe('Step one. Step two.')
  })
})

describe('reasoningForMessage', () => {
  it('returns excerpt for worker messages with matching call id', () => {
    const events: TransportStreamEvent[] = [
      { reasoning_excerpt: 'Thinking…', subagent_run_id: CALL_ID },
    ]
    const byCall = buildReasoningByCall(events)
    const row = reasoningForMessage(workerMessage, calls, events, byCall)
    expect(row?.excerpt).toBe('Thinking…')
    expect(row?.live).toBe(false)
  })

  it('does not attach reasoning without a resolvable call id', () => {
    const spawn: DisplayMessage = {
      ...workerMessage,
      kind: 'agent_card',
      collaborator: 'project_agent',
      metadata: {},
    }
    const events: TransportStreamEvent[] = [
      { reasoning_excerpt: 'hidden', subagent_run_id: CALL_ID },
    ]
    expect(reasoningForMessage(spawn, calls, events, buildReasoningByCall(events))).toBeNull()
  })
})

describe('isReasoningLive', () => {
  it('is false after message.completed', () => {
    const events: TransportStreamEvent[] = [
      { event_type: 'reasoning_delta', subagent_run_id: CALL_ID },
      { event_type: 'message.completed', subagent_run_id: CALL_ID },
    ]
    expect(isReasoningLive(CALL_ID, calls, events)).toBe(false)
  })
})

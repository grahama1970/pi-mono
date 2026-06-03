import { describe, expect, it } from 'vitest'
import { attachmentsForMessage } from './messageAttachments'
import type { TransportCallRow } from './callInspector'
import type { DisplayMessage } from './messageParse'
import type { TransportStreamEvent } from './types'

const CALL_ID = 'otr-attach-1'

const calls: TransportCallRow[] = [{ subagent_run_id: CALL_ID, delivery_state: 'completed', active: false }]

const workerMessage: DisplayMessage = {
  id: 'msg-a',
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

describe('attachmentsForMessage', () => {
  it('combines reasoning and tool trace for any message with call id', () => {
    const events: TransportStreamEvent[] = [
      { event_type: 'reasoning_delta', subagent_run_id: CALL_ID, delta: 'Thinking.' },
      { reasoning_excerpt: 'Thinking.', subagent_run_id: CALL_ID },
      {
        event_type: 'tool_call',
        subagent_run_id: CALL_ID,
        tool: 'read',
        status: 'completed',
        output_excerpt: 'file ok',
      },
    ]
    const row = attachmentsForMessage(workerMessage, calls, events)
    expect(row?.reasoning?.excerpt).toBe('Thinking.')
    expect(row?.toolTrace?.entries).toHaveLength(1)
  })

  it('parses skill receipt on project agent turns without call id', () => {
    const agentMsg: DisplayMessage = {
      ...workerMessage,
      id: 'msg-b',
      kind: 'reviewer',
      collaborator: 'project_agent',
      metadata: {},
      raw: 'Executed `/dogpile` via mediated **skill_call** (`completed`).',
      prose: '',
    }
    const row = attachmentsForMessage(agentMsg, calls, [])
    expect(row?.skillReceipt?.skill).toBe('dogpile')
    expect(row?.reasoning).toBeUndefined()
  })
})

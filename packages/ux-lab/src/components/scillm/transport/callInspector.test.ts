import { describe, expect, it } from 'vitest'
import {
  buildCallInspectorView,
  defaultSelectedCallId,
  filterEventsForCall,
  mergeTransportCalls,
  modelForCall,
} from './callInspector'
import { mockTransportDialog, mockTransportRun } from './transportFixtures'

describe('callInspector', () => {
  it('merges children from dialog and run state', () => {
    const calls = mergeTransportCalls(mockTransportDialog, mockTransportRun)
    expect(calls).toHaveLength(1)
    expect(calls[0]?.subagent_run_id).toBe('otr-mock-collab-reviewer-1')
    expect(calls[0]?.skills).toContain('scillm')
  })

  it('defaults selection to active subagent', () => {
    const calls = mergeTransportCalls(mockTransportDialog, mockTransportRun)
    expect(defaultSelectedCallId(calls, mockTransportDialog)).toBe('otr-mock-collab-reviewer-1')
  })

  it('filters events by subagent_run_id', () => {
    const events = [
      { event_type: 'transport.created', transport_run_id: 'r1', ts: 1 },
      { event_type: 'message.queued', subagent_run_id: 'r1-child', model: 'gpt-5.5', ts: 2 },
      { event_type: 'message.queued', subagent_run_id: 'other', ts: 3 },
    ]
    const filtered = filterEventsForCall(events, 'r1-child')
    expect(filtered).toHaveLength(1)
    expect(modelForCall(events, 'r1-child')).toBe('gpt-5.5')
  })

  it('builds inspector view with model and dialog prompt', () => {
    const calls = mergeTransportCalls(mockTransportDialog, mockTransportRun)
    const view = buildCallInspectorView({
      call: calls[0] ?? null,
      allEvents: [
        {
          event_type: 'message.queued',
          subagent_run_id: 'otr-mock-collab-reviewer-1',
          model: 'gpt-5.5',
          ts: 100,
        },
      ],
      turns: mockTransportDialog.turns,
      parentModel: 'gpt-5.5',
    })
    expect(view?.model).toBe('gpt-5.5')
    expect(view?.promptSnippet).toContain('Dispatching')
    expect(view?.promptSource).toBe('dialog')
  })
})

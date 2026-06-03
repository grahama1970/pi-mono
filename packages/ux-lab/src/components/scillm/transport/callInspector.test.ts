import { describe, expect, it } from 'vitest'
import {
  buildCallInspectorView,
  callDurationForCall,
  defaultSelectedCallId,
  dedupeEventsForInspector,
  filterEventsForCall,
  fullPromptForCall,
  mergeTransportCalls,
  modelForCall,
  personaForCall,
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

  it('builds inspector view with model, persona, duration, and dialog prompt', () => {
    const calls = mergeTransportCalls(mockTransportDialog, mockTransportRun)
    const call = calls[0]!
    const events = [
      { event_type: 'child.created', subagent_run_id: call.subagent_run_id, ts: 1_000_000 },
      { event_type: 'message.queued', subagent_run_id: call.subagent_run_id, model: 'gpt-5.5', ts: 1_000_500 },
      { event_type: 'message.completed', subagent_run_id: call.subagent_run_id, ts: 1_125_000 },
    ]
    const view = buildCallInspectorView({
      call,
      allEvents: events,
      turns: mockTransportDialog.turns,
      parentModel: 'gpt-5.5',
    })
    expect(view?.model).toBe('gpt-5.5')
    expect(view?.personaLabel).toContain('Worker')
    expect(view?.personaAgent).toBe('scillm-worker')
    expect(view?.durationMs).toBeGreaterThan(0)
    expect(view?.promptPayload).toContain('Dispatching')
    expect(view?.promptSource).toBe('dialog')
  })

  it('prefers stream event prompt over dialog dispatch', () => {
    const calls = mergeTransportCalls(mockTransportDialog, mockTransportRun)
    const call = calls[0]!
    const fullPrompt = 'Full worker prompt with human context and skills overlay.'
    const { payload, source } = fullPromptForCall(mockTransportDialog.turns, call, [
      { event_type: 'message.queued', subagent_run_id: call.subagent_run_id, prompt: fullPrompt, ts: 1 },
    ])
    expect(source).toBe('event')
    expect(payload).toBe(fullPrompt)
  })

  it('dedupes replayed stream events for inspector timeline', () => {
    const events = [
      { event_type: 'child.created', subagent_run_id: 'c1', ts: 100 },
      { event_type: 'child.created', subagent_run_id: 'c1', ts: 100 },
      { event_type: 'transport.child.created', subagent_run_id: 'c1', ts: 100 },
      { event_type: 'message.queued', subagent_run_id: 'c1', model: 'gpt-5.5', ts: 200 },
      { event_type: 'message.queued', subagent_run_id: 'c1', model: 'gpt-5.5', ts: 200 },
    ]
    expect(dedupeEventsForInspector(events)).toHaveLength(2)
  })

  it('uses heartbeat elapsed_s when present', () => {
    const calls = mergeTransportCalls(mockTransportDialog, mockTransportRun)
    const call = calls[0]!
    const duration = callDurationForCall(
      [{ event_type: 'heartbeat', subagent_run_id: call.subagent_run_id, elapsed_s: 42.5, ts: 1 }],
      call,
    )
    expect(duration.durationMs).toBe(42_500)
    expect(duration.durationLabel).toBe('43 s')
  })

  it('resolves persona from focused thread message', () => {
    const calls = mergeTransportCalls(mockTransportDialog, mockTransportRun)
    const call = calls[0]!
    const persona = personaForCall(call, mockTransportDialog.turns, 'msg-6')
    expect(persona.personaLabel).toBe('Worker (reviewer)')
  })
})

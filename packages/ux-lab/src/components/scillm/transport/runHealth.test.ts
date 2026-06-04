import { describe, expect, it } from 'vitest'
import { deriveRunHealth } from './runHealth'

describe('deriveRunHealth', () => {
  it('prioritizes awaiting human over completed delivery', () => {
    const h = deriveRunHealth({
      runId: 'otr-proof-r008',
      pendingCount: 1,
      deliveryState: 'completed',
      sseLive: true,
      events: [],
      workerTraceAvailable: true,
    })
    expect(h.kind).toBe('awaiting_human')
    expect(h.label).toBe('Needs your input')
  })

  it('reports completed when no pending and delivery done', () => {
    const h = deriveRunHealth({
      runId: 'otr-proof-r008',
      dagNodeId: 'transport-review-r008',
      pendingCount: 0,
      deliveryState: 'completed',
      sseLive: true,
      events: [{ event_type: 'message.completed', ts: '2026-05-27T16:50:00.000Z' }],
      workerTraceAvailable: true,
    })
    expect(h.kind).toBe('completed')
    expect(h.label).toBe('Completed')
    expect(h.stripSegments[0]).toBe('Completed')
    expect(h.eventTailMessage).toContain('completed')
  })

  it('does not describe terminal completed runs as reconnecting when SSE is closed', () => {
    const h = deriveRunHealth({
      runId: 'oc-pdf-oxide-confirm-issue11-p45-1780602551',
      pendingCount: 0,
      deliveryState: 'completed',
      sseLive: false,
      events: [{ event_type: 'run_completed', ts: '2026-06-04T19:49:20.000Z' }],
      workerTraceAvailable: true,
    })

    expect(h.kind).toBe('completed')
    expect(h.stripSegments).toContain('Event stream closed')
    expect(h.stripSegments.join(' ')).not.toContain('reconnecting')
  })

  it('aligns event tail with running state', () => {
    const h = deriveRunHealth({
      runId: 'x',
      pendingCount: 0,
      deliveryState: 'running',
      sseLive: true,
      events: [],
      workerTraceAvailable: false,
    })
    expect(h.kind).toBe('running')
    expect(h.eventTailMessage).toContain('Worker active')
  })
})


  it('reports reconnecting when stream is down', () => {
    const h = deriveRunHealth({
      runId: 'x',
      pendingCount: 0,
      deliveryState: undefined,
      sseLive: false,
      events: [],
      workerTraceAvailable: false,
    })
    expect(h.kind).toBe('offline')
    expect(h.stripSegments.some((s) => s.includes('reconnecting') || s.includes('disconnected'))).toBe(true)
  })

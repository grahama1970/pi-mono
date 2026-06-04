/**
 * Single source of truth for transport run health across header, strip, sidebar, and drawer.
 */
import { extractProofRoundLabel } from './messageParse'
import type { RunStatusKind } from './messageParse'
import type { TransportStreamEvent } from './types'

export type { RunStatusKind }
export type RunHealthKind = RunStatusKind

export interface RunHealth {
  kind: RunStatusKind
  /** Primary status label (header hero, sidebar badge on active run). */
  label: string
  sublabel?: string
  /** Segments for the now strip (joined with middle dot). */
  stripSegments: string[]
  pendingCount: number
  nextAction?: string
  workerTraceAvailable: boolean
  lastEventAt: number | null
  sseLive: boolean
  /** Event timeline empty-state copy aligned with run health. */
  eventTailMessage: string
  roundLabel: string
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function lastEventTimestamp(events: TransportStreamEvent[]): number | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ts = events[i]?.ts
    if (typeof ts === 'string') {
      const parsed = Date.parse(ts)
      if (!Number.isNaN(parsed)) return parsed
    }
    if (typeof ts === 'number' && Number.isFinite(ts)) return ts
  }
  return null
}

export interface DeriveRunHealthInput {
  runId: string
  dagNodeId?: string
  pendingCount: number
  deliveryState?: string
  sseLive: boolean
  events: TransportStreamEvent[]
  workerTraceAvailable: boolean
  isMock?: boolean
}

export function deriveRunHealth(input: DeriveRunHealthInput): RunHealth {
  const {
    runId,
    dagNodeId,
    pendingCount,
    deliveryState,
    sseLive,
    events,
    workerTraceAvailable,
    isMock,
  } = input

  const ds = (deliveryState || '').toLowerCase()
  const lastEventAt = lastEventTimestamp(events)
  const roundLabel = extractProofRoundLabel(runId, dagNodeId)
  const lastEventLabel = lastEventAt ? formatTime(lastEventAt) : null

  const sseSegment = isMock
    ? 'Fixture mode'
    : sseLive
      ? 'Event stream connected'
      : 'Event stream reconnecting'

  const traceSegment = workerTraceAvailable ? 'Worker trace available' : 'No worker trace yet'

  if (ds === 'failed' || ds === 'error' || ds === 'aborted') {
    const label = 'Run aborted'
    return {
      kind: 'aborted',
      label,
      sublabel: 'Check Open worker trace',
      stripSegments: [label, roundLabel, sseSegment, traceSegment].filter(Boolean),
      pendingCount,
      nextAction: 'Open worker trace to inspect failure',
      workerTraceAvailable,
      lastEventAt,
      sseLive,
      eventTailMessage: lastEventAt
        ? `Run aborted · last event ${lastEventLabel}`
        : 'Run aborted · no events recorded',
      roundLabel,
    }
  }

  if (pendingCount > 0) {
    const label = 'Needs your input'
    const pendingSeg =
      pendingCount === 1
        ? '1 pending parent-session turn'
        : `${pendingCount} pending parent-session turns`
    return {
      kind: 'awaiting_human',
      label,
      sublabel: `${pendingCount} pending · included on next worker dispatch`,
      stripSegments: [
        label,
        pendingSeg,
        'Next worker dispatch will include it',
        roundLabel,
        sseSegment,
      ],
      pendingCount,
      nextAction: 'Review pending turn in drawer or send a message',
      workerTraceAvailable,
      lastEventAt,
      sseLive,
      eventTailMessage: pendingSeg,
      roundLabel,
    }
  }

  if (ds === 'running' || ds === 'in_progress') {
    const label = 'Worker running'
    const segments = [label, roundLabel, sseSegment, traceSegment]
    if (lastEventLabel) segments.splice(2, 0, `Last event ${lastEventLabel}`)
    return {
      kind: 'running',
      label,
      sublabel: 'scillm-worker active',
      stripSegments: segments,
      pendingCount: 0,
      nextAction: workerTraceAvailable ? 'Open worker trace for tools and reasoning' : undefined,
      workerTraceAvailable,
      lastEventAt,
      sseLive,
      eventTailMessage: lastEventAt
        ? `Worker active · last event ${lastEventLabel}`
        : sseLive
          ? 'Worker active · listening for events'
          : 'Worker active · waiting for events',
      roundLabel,
    }
  }

  if (ds === 'completed' || ds === 'done') {
    const label = 'Completed'
    const terminalStreamSegment = isMock
      ? 'Fixture mode'
      : sseLive
        ? 'Event stream connected'
        : 'Event stream closed'
    const segments = [label, roundLabel, terminalStreamSegment, traceSegment]
    if (lastEventLabel) segments.splice(2, 0, `Last event ${lastEventLabel}`)
    return {
      kind: 'completed',
      label,
      sublabel: 'Run finished',
      stripSegments: segments,
      pendingCount: 0,
      nextAction: workerTraceAvailable ? 'Open worker trace to review output' : undefined,
      workerTraceAvailable,
      lastEventAt,
      sseLive,
      eventTailMessage: lastEventAt
        ? `Run completed · last event ${lastEventLabel}`
        : 'Run completed · event stream idle',
      roundLabel,
    }
  }

  if (sseLive) {
    const label = 'Live'
    const segments = [label, roundLabel, sseSegment, traceSegment]
    if (lastEventLabel) segments.splice(2, 0, `Last event ${lastEventLabel}`)
    return {
      kind: 'idle',
      label,
      sublabel: 'Listening on events stream',
      stripSegments: segments,
      pendingCount: 0,
      workerTraceAvailable,
      lastEventAt,
      sseLive,
      eventTailMessage: lastEventAt
        ? `Live · last event ${lastEventLabel}`
        : 'Live · waiting for events',
      roundLabel,
    }
  }

  const label = 'Offline'
  return {
    kind: 'offline',
    label,
    sublabel: 'Polling dialog until stream reconnects',
    stripSegments: [label, roundLabel, 'Event stream disconnected · polling dialog', traceSegment],
    pendingCount: 0,
    nextAction: 'Refresh run state',
    workerTraceAvailable,
    lastEventAt,
    sseLive: false,
    eventTailMessage: lastEventAt
      ? `Offline · last event ${lastEventLabel}`
      : 'Offline · refresh to load events',
    roundLabel,
  }
}

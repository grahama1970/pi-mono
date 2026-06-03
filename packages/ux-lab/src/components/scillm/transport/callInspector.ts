/**
 * Pure helpers for per-child call selection, event filtering, and inspector payloads.
 */
import type { DisplayMessage } from './messageParse'
import type {
  TransportDialogResponse,
  TransportDialogTurn,
  TransportRunResponse,
  TransportStreamEvent,
  TransportSubagentSummary,
} from './types'

export interface TransportCallRow {
  subagent_run_id: string
  role?: string
  subagent_kind?: string
  subagent_label?: string
  agent?: string
  agent_id?: string
  mode?: string
  attempt_id?: number
  child_session_id?: string
  delivery_state?: string
  active?: boolean
  skills?: string[]
}

export interface CallInspectorView {
  call: TransportCallRow
  model?: string
  parentModel?: string
  personaLabel?: string
  personaAgent?: string
  durationMs?: number
  durationLabel?: string
  promptSnippet?: string
  promptPayload?: string
  promptSource?: 'event' | 'dialog' | 'none'
  promptTruncated?: boolean
  childSessionId?: string
  events: TransportStreamEvent[]
  eventCount: number
  rawEventCount: number
  focusMessageId?: string
}

export function resolveSubagentRunId(
  message: DisplayMessage,
  calls: TransportCallRow[],
  nestMessages?: DisplayMessage[],
): string | undefined {
  const direct = message.metadata.subagentRunId?.trim()
  if (direct) return direct
  const attempt = message.metadata.attemptId
  if (attempt != null) {
    const match = calls.find((c) => c.attempt_id === attempt)
    if (match?.subagent_run_id) return match.subagent_run_id
  }
  if (nestMessages?.length) {
    for (const nested of nestMessages) {
      const nestedId = nested.metadata.subagentRunId?.trim()
      if (nestedId) return nestedId
    }
  }
  if (message.kind === 'worker' || message.kind === 'task_card' || message.kind === 'agent_card') {
    const agent = message.metadata.workerAgent
    if (agent) {
      const byAgent = calls.find((c) => c.agent === agent)
      if (byAgent?.subagent_run_id) return byAgent.subagent_run_id
    }
  }
  return undefined
}

export function mergeTransportCalls(
  dialog: TransportDialogResponse | null,
  runState: TransportRunResponse | null,
): TransportCallRow[] {
  const byId = new Map<string, TransportCallRow>()
  const ingest = (c: TransportSubagentSummary | undefined) => {
    if (!c?.subagent_run_id) return
    const existing = byId.get(c.subagent_run_id)
    byId.set(c.subagent_run_id, {
      subagent_run_id: c.subagent_run_id,
      role: c.role ?? existing?.role,
      subagent_kind: c.subagent_kind ?? existing?.subagent_kind,
      subagent_label: c.subagent_label ?? existing?.subagent_label,
      agent: c.agent ?? existing?.agent,
      agent_id: c.agent_id ?? existing?.agent_id,
      mode: c.mode ?? existing?.mode,
      attempt_id: c.attempt_id ?? existing?.attempt_id,
      child_session_id: c.child_session_id ?? existing?.child_session_id,
      delivery_state: c.delivery_state ?? existing?.delivery_state,
      active: c.active ?? existing?.active,
      skills: c.skills_materialized ?? c.skills ?? existing?.skills,
    })
  }
  for (const c of dialog?.children ?? []) ingest(c)
  for (const c of runState?.state?.children ?? []) ingest(c)
  if (dialog?.active_subagent) ingest(dialog.active_subagent)
  return [...byId.values()].sort((a, b) => {
    const aa = a.attempt_id ?? 0
    const bb = b.attempt_id ?? 0
    if (aa !== bb) return aa - bb
    return a.subagent_run_id.localeCompare(b.subagent_run_id)
  })
}

export function defaultSelectedCallId(
  calls: TransportCallRow[],
  dialog: TransportDialogResponse | null,
): string | null {
  if (calls.length === 0) return null
  const activeId = dialog?.active_subagent?.subagent_run_id
  if (activeId && calls.some((c) => c.subagent_run_id === activeId)) return activeId
  const activeChild = calls.find((c) => c.active)
  if (activeChild) return activeChild.subagent_run_id
  return calls[calls.length - 1]?.subagent_run_id ?? null
}

export function filterEventsForCall(
  events: TransportStreamEvent[],
  subagentRunId: string | null,
): TransportStreamEvent[] {
  if (!subagentRunId) return []
  return events.filter((ev) => ev.subagent_run_id === subagentRunId)
}

function normalizedEventType(eventType?: string): string {
  const et = (eventType || 'event').toLowerCase()
  if (et === 'transport.child.created') return 'child.created'
  return et
}

/** Collapse SSE replay duplicates so the inspector timeline matches DAG-style receipts. */
export function dedupeEventsForInspector(events: TransportStreamEvent[]): TransportStreamEvent[] {
  const seen = new Set<string>()
  const out: TransportStreamEvent[] = []
  for (const ev of events) {
    const eventId = typeof ev.event_id === 'string' ? ev.event_id.trim() : ''
    const key = eventId || [
      normalizedEventType(ev.event_type),
      String(ev.ts ?? ''),
      ev.subagent_run_id ?? '',
      String(ev.delivery_state ?? ''),
      String(ev.model ?? ''),
    ].join('|')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(ev)
  }
  return out
}

export function eventTimestamp(ev: TransportStreamEvent): number {
  const ts = ev.ts
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts > 1e12 ? ts : ts * 1000
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts)
    if (!Number.isNaN(parsed)) return parsed
  }
  return 0
}

export function modelForCall(events: TransportStreamEvent[], subagentRunId: string): string | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]
    if (ev.subagent_run_id !== subagentRunId) continue
    const model = ev.model
    if (typeof model === 'string' && model.trim()) return model.trim()
  }
  return undefined
}

const DISPATCH_RE = /dispatching/i
const START_TYPES = new Set(['child.created', 'message.queued', 'message.posted'])
const END_TYPES = new Set(['message.completed', 'message.delivered', 'session_idle'])

function turnMatchesCall(turn: TransportDialogTurn, call: TransportCallRow): boolean {
  if (turn.subagent_run_id && turn.subagent_run_id === call.subagent_run_id) return true
  if (call.attempt_id != null && turn.attempt_id === call.attempt_id) {
    if (call.agent && turn.agent && turn.agent !== call.agent) return false
    if (call.subagent_kind && turn.subagent_kind && turn.subagent_kind !== call.subagent_kind) return false
    return true
  }
  return false
}

export function personaForCall(
  call: TransportCallRow,
  turns: TransportDialogTurn[],
  focusMessageId?: string | null,
): { personaLabel: string; personaAgent?: string } {
  if (focusMessageId) {
    const focused = turns.find((t) => t.message_id === focusMessageId)
    if (focused?.speaker?.trim()) {
      return {
        personaLabel: focused.speaker.trim(),
        personaAgent: focused.agent ?? call.agent,
      }
    }
  }
  const workerTurn = [...turns].reverse().find((t) => turnMatchesCall(t, call) && t.collaborator === 'worker')
  if (workerTurn?.speaker?.trim()) {
    return { personaLabel: workerTurn.speaker.trim(), personaAgent: workerTurn.agent ?? call.agent }
  }
  const label =
    call.subagent_label?.trim() ||
    [call.subagent_kind, call.agent].filter(Boolean).join(' · ') ||
    call.role ||
    'Worker'
  return { personaLabel: label, personaAgent: call.agent }
}

export function formatDuration(ms: number | undefined): string | undefined {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return undefined
  if (ms < 1000) return `${Math.round(ms)} ms`
  const totalSec = ms / 1000
  if (totalSec < 60) return `${totalSec.toFixed(totalSec < 10 ? 1 : 0)} s`
  const min = Math.floor(totalSec / 60)
  const sec = Math.round(totalSec % 60)
  if (min < 60) return sec > 0 ? `${min}m ${sec}s` : `${min}m`
  const hr = Math.floor(min / 60)
  const remMin = min % 60
  return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`
}

export function callDurationForCall(
  events: TransportStreamEvent[],
  call: TransportCallRow,
): { durationMs?: number; durationLabel?: string } {
  const scoped = events.filter((ev) => ev.subagent_run_id === call.subagent_run_id)
  if (scoped.length === 0) return {}
  let start = Infinity
  let end = 0
  for (const ev of scoped) {
    const ts = eventTimestamp(ev)
    if (!ts) continue
    const type = normalizedEventType(ev.event_type)
    if (START_TYPES.has(type) || type === 'heartbeat') start = Math.min(start, ts)
    if (END_TYPES.has(type) || type === 'heartbeat') end = Math.max(end, ts)
    const elapsed = ev.elapsed_s
    if (typeof elapsed === 'number' && Number.isFinite(elapsed) && elapsed > 0) {
      return { durationMs: Math.round(elapsed * 1000), durationLabel: formatDuration(elapsed * 1000) }
    }
  }
  if (!Number.isFinite(start) || end <= start) return {}
  const durationMs = end - start
  return { durationMs, durationLabel: formatDuration(durationMs) }
}

function extractFencedPrompt(text: string): string | undefined {
  const match = text.match(/```(?:\w+)?\n([\s\S]*?)```/)
  if (match?.[1]?.trim()) return match[1].trim()
  return undefined
}

function promptFromEvents(events: TransportStreamEvent[], subagentRunId: string): string | undefined {
  let best: string | undefined
  for (const ev of events) {
    if (ev.subagent_run_id !== subagentRunId) continue
    const prompt = ev.prompt
    if (typeof prompt === 'string' && prompt.trim()) {
      const trimmed = prompt.trim()
      if (!best || trimmed.length > best.length) best = trimmed
    }
  }
  return best
}

function dispatchTurnForCall(turns: TransportDialogTurn[], call: TransportCallRow): TransportDialogTurn | undefined {
  return [...turns].reverse().find((t) => {
    if (!DISPATCH_RE.test(t.text)) return false
    if (turnMatchesCall(t, call)) return true
    const role = (call.role || call.subagent_kind || '').toLowerCase()
    const blob = t.text.toLowerCase()
    if (role && blob.includes(role)) return true
    if (call.agent && t.text.includes(call.agent)) return true
    return false
  })
}

export function fullPromptForCall(
  turns: TransportDialogTurn[],
  call: TransportCallRow,
  events: TransportStreamEvent[],
  focusMessageId?: string | null,
): { payload?: string; source: 'event' | 'dialog' | 'none' } {
  const fromEvents = promptFromEvents(events, call.subagent_run_id)
  if (fromEvents) return { payload: fromEvents, source: 'event' }

  if (focusMessageId) {
    const focused = turns.find((t) => t.message_id === focusMessageId)
    if (focused?.text?.trim()) {
      const fenced = extractFencedPrompt(focused.text)
      return { payload: (fenced ?? focused.text).trim(), source: 'dialog' }
    }
  }

  const dispatch = dispatchTurnForCall(turns, call)
  if (dispatch?.text?.trim()) {
    const fenced = extractFencedPrompt(dispatch.text)
    return { payload: (fenced ?? dispatch.text).trim(), source: 'dialog' }
  }

  const humanTurns = turns.filter((t) => {
    if (t.collaborator !== 'human') return false
    if (!turnMatchesCall(t, call) && call.attempt_id != null && t.attempt_id == null) return false
    if (call.attempt_id != null && t.attempt_id != null && t.attempt_id !== call.attempt_id) return false
    return true
  })
  if (humanTurns.length) {
    const merged = humanTurns.map((t) => t.text.trim()).filter(Boolean).join('\n\n')
    if (merged) return { payload: merged, source: 'dialog' }
  }

  return { source: 'none' }
}

const SNIPPET_MAX = 480

export function buildCallInspectorView(input: {
  call: TransportCallRow | null
  allEvents: TransportStreamEvent[]
  turns: TransportDialogTurn[]
  parentModel?: string
  focusMessageId?: string | null
}): CallInspectorView | null {
  const { call, allEvents, turns, parentModel, focusMessageId } = input
  if (!call) return null
  const filtered = filterEventsForCall(allEvents, call.subagent_run_id)
    .sort((a, b) => eventTimestamp(a) - eventTimestamp(b))
  const events = dedupeEventsForInspector(filtered)
  const model = modelForCall(allEvents, call.subagent_run_id) ?? parentModel
  const { personaLabel, personaAgent } = personaForCall(call, turns, focusMessageId)
  const { durationMs, durationLabel } = callDurationForCall(filtered, call)
  const { payload: promptPayload, source: promptSource } = fullPromptForCall(
    turns,
    call,
    allEvents,
    focusMessageId,
  )
  const promptSnippet =
    promptPayload && promptPayload.length > SNIPPET_MAX
      ? `${promptPayload.slice(0, SNIPPET_MAX)}\n…`
      : promptPayload

  return {
    call,
    model,
    parentModel,
    personaLabel,
    personaAgent,
    durationMs,
    durationLabel,
    promptSnippet,
    promptPayload,
    promptSource,
    promptTruncated: Boolean(promptPayload && promptSnippet && promptPayload.length > promptSnippet.length),
    focusMessageId: focusMessageId ?? undefined,
    childSessionId: call.child_session_id,
    events,
    eventCount: events.length,
    rawEventCount: filtered.length,
  }
}

export function callListLabel(call: TransportCallRow): string {
  const kind = call.subagent_kind || call.role || 'worker'
  const attempt = call.attempt_id != null ? ` · attempt ${call.attempt_id}` : ''
  return `${kind}${attempt}`
}

export function callDeliveryBadge(state?: string): string {
  const ds = (state || 'unknown').toLowerCase()
  if (ds === 'completed' || ds === 'done') return 'Completed'
  if (ds === 'running' || ds === 'in_progress' || ds === 'posted') return 'Running'
  if (ds === 'queued' || ds === 'created') return 'Queued'
  if (ds === 'failed' || ds === 'error' || ds === 'aborted') return 'Failed'
  return state || 'Unknown'
}

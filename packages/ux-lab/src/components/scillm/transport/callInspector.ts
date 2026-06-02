/**
 * Pure helpers for per-child call selection, event filtering, and inspector payloads.
 */
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
  promptSnippet?: string
  promptSource?: 'event' | 'dialog' | 'none'
  childSessionId?: string
  events: TransportStreamEvent[]
  eventCount: number
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

function eventTimestamp(ev: TransportStreamEvent): number {
  const ts = ev.ts
  if (typeof ts === 'number' && Number.isFinite(ts)) return ts
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

function turnMatchesCall(turn: TransportDialogTurn, call: TransportCallRow): boolean {
  if (turn.subagent_run_id && turn.subagent_run_id === call.subagent_run_id) return true
  if (call.attempt_id != null && turn.attempt_id === call.attempt_id) {
    if (call.agent && turn.agent && turn.agent !== call.agent) return false
    if (call.subagent_kind && turn.subagent_kind && turn.subagent_kind !== call.subagent_kind) return false
    return true
  }
  return false
}

export function promptSnippetForCall(
  turns: TransportDialogTurn[],
  call: TransportCallRow,
  events: TransportStreamEvent[],
): { snippet?: string; source: 'event' | 'dialog' | 'none' } {
  for (const ev of events) {
    if (ev.subagent_run_id !== call.subagent_run_id) continue
    const prompt = ev.prompt
    if (typeof prompt === 'string' && prompt.trim()) {
      return { snippet: prompt.trim(), source: 'event' }
    }
  }

  const dispatch = [...turns].reverse().find((t) => {
    if (!DISPATCH_RE.test(t.text)) return false
    if (turnMatchesCall(t, call)) return true
    const role = (call.role || call.subagent_kind || '').toLowerCase()
    const blob = t.text.toLowerCase()
    if (role && blob.includes(role)) return true
    if (call.agent && t.text.includes(call.agent)) return true
    return false
  })
  if (dispatch) {
    return { snippet: dispatch.text.slice(0, 1200), source: 'dialog' }
  }

  const humanTurns = turns.filter((t) => {
    if (t.collaborator !== 'human') return false
    if (!turnMatchesCall(t, call) && call.attempt_id != null && t.attempt_id == null) return false
    if (call.attempt_id != null && t.attempt_id != null && t.attempt_id !== call.attempt_id) return false
    return true
  })
  const lastHuman = humanTurns[humanTurns.length - 1]
  if (lastHuman?.text?.trim()) {
    return { snippet: lastHuman.text.trim().slice(0, 1200), source: 'dialog' }
  }

  return { source: 'none' }
}

export function buildCallInspectorView(input: {
  call: TransportCallRow | null
  allEvents: TransportStreamEvent[]
  turns: TransportDialogTurn[]
  parentModel?: string
}): CallInspectorView | null {
  const { call, allEvents, turns, parentModel } = input
  if (!call) return null
  const events = filterEventsForCall(allEvents, call.subagent_run_id)
    .sort((a, b) => eventTimestamp(a) - eventTimestamp(b))
  const model = modelForCall(allEvents, call.subagent_run_id) ?? parentModel
  const { snippet, source } = promptSnippetForCall(turns, call, allEvents)
  return {
    call,
    model,
    parentModel,
    promptSnippet: snippet,
    promptSource: source,
    childSessionId: call.child_session_id,
    events,
    eventCount: events.length,
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

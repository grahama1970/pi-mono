/**
 * Merge transport SSE reasoning excerpts per worker call.
 */
import type { TransportCallRow } from './callInspector'
import type { DisplayMessage } from './messageParse'
import { resolveSubagentRunId } from './callInspector'
import type { TransportStreamEvent } from './types'

const MAX_EXCERPT = 8000

function mergeReasoningExcerpt(existing: string, event: TransportStreamEvent): string {
  const rowExcerpt =
    typeof event.reasoning_excerpt === 'string' ? event.reasoning_excerpt.trim() : ''
  if (rowExcerpt && rowExcerpt.length >= existing.length) {
    return rowExcerpt.slice(-MAX_EXCERPT)
  }

  if (event.event_type === 'reasoning_delta') {
    const delta = typeof event.delta === 'string' ? event.delta : ''
    const text = typeof event.text === 'string' ? event.text : ''
    if (delta) return (existing + delta).slice(-MAX_EXCERPT)
    if (text && (!existing || text.length >= existing.length)) {
      return text.slice(-MAX_EXCERPT)
    }
  }

  if (event.event_type === 'message.completed') {
    const result = event.result
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      const fromResult = (result as Record<string, unknown>).reasoning_excerpt
      if (typeof fromResult === 'string' && fromResult.trim()) {
        const trimmed = fromResult.trim()
        if (trimmed.length >= existing.length) return trimmed.slice(-MAX_EXCERPT)
      }
    }
  }

  return existing
}

/** Latest reasoning text per subagent_run_id from the event stream. */
export function buildReasoningByCall(events: TransportStreamEvent[]): Map<string, string> {
  const byCall = new Map<string, string>()
  for (const ev of events) {
    const id = typeof ev.subagent_run_id === 'string' ? ev.subagent_run_id.trim() : ''
    if (!id) continue
    const prev = byCall.get(id) ?? ''
    const next = mergeReasoningExcerpt(prev, ev)
    if (next.trim()) byCall.set(id, next.trim())
  }
  return byCall
}

/** @deprecated Use attachmentsForMessage; reasoning is not worker-only. */
export function shouldShowReasoningBlock(_message: DisplayMessage): boolean {
  return true
}

export function reasoningForMessage(
  message: DisplayMessage,
  calls: TransportCallRow[],
  events: TransportStreamEvent[],
  byCall: Map<string, string>,
  nestMessages?: DisplayMessage[],
): { excerpt: string; live: boolean } | null {
  const callId = resolveSubagentRunId(message, calls, nestMessages)
  if (!callId) return null
  const excerpt = byCall.get(callId)?.trim()
  if (!excerpt) return null
  return { excerpt, live: isReasoningLive(callId, calls, events) }
}

/** True while the worker call is still in-flight (reasoning may still grow). */
export function isReasoningLive(
  subagentRunId: string,
  calls: TransportCallRow[],
  events: TransportStreamEvent[],
): boolean {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]
    if (ev.subagent_run_id !== subagentRunId) continue
    if (ev.event_type === 'message.completed') return false
    if (ev.event_type === 'reasoning_delta' || ev.event_type === 'heartbeat') return true
    break
  }
  const call = calls.find((c) => c.subagent_run_id === subagentRunId)
  if (!call) return false
  const state = (call.delivery_state || '').toLowerCase()
  if (state === 'completed' || state === 'failed' || state === 'aborted') return false
  return Boolean(call.active) || state === 'posted' || state === 'created' || state === 'acted'
}

/**
 * Aggregate transport SSE tool_call events per subagent_run_id.
 */
import type { TransportCallRow } from './callInspector'
import type { TransportStreamEvent } from './types'

export interface ToolCallEntry {
  key: string
  tool: string
  status: string
  outputExcerpt?: string
}

const MAX_OUTPUT = 2000

function entryKey(event: TransportStreamEvent): string {
  const partId = typeof event.part_id === 'string' ? event.part_id : ''
  const tool = typeof event.tool === 'string' ? event.tool : 'tool'
  return partId ? `${tool}:${partId}` : tool
}

function mergeToolEvent(existing: ToolCallEntry[], event: TransportStreamEvent): ToolCallEntry[] {
  if (event.event_type !== 'tool_call') return existing
  const tool = typeof event.tool === 'string' ? event.tool.trim() : ''
  if (!tool) return existing
  const status = typeof event.status === 'string' ? event.status : 'unknown'
  const output =
    typeof event.output_excerpt === 'string' ? event.output_excerpt.trim().slice(0, MAX_OUTPUT) : ''
  const key = entryKey(event)
  const next: ToolCallEntry = {
    key,
    tool,
    status,
    outputExcerpt: output || undefined,
  }
  const idx = existing.findIndex((row) => row.key === key)
  if (idx >= 0) {
    const copy = [...existing]
    const prev = copy[idx]
    copy[idx] = {
      ...prev,
      status: next.status || prev.status,
      outputExcerpt: next.outputExcerpt || prev.outputExcerpt,
    }
    return copy
  }
  return [...existing, next]
}

export function buildToolTraceByCall(events: TransportStreamEvent[]): Map<string, ToolCallEntry[]> {
  const byCall = new Map<string, ToolCallEntry[]>()
  for (const ev of events) {
    const id = typeof ev.subagent_run_id === 'string' ? ev.subagent_run_id.trim() : ''
    if (!id || ev.event_type !== 'tool_call') continue
    const prev = byCall.get(id) ?? []
    byCall.set(id, mergeToolEvent(prev, ev))
  }
  return byCall
}

export function isToolTraceLive(
  subagentRunId: string,
  calls: TransportCallRow[],
  events: TransportStreamEvent[],
): boolean {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]
    if (ev.subagent_run_id !== subagentRunId) continue
    if (ev.event_type === 'message.completed') return false
    if (ev.event_type === 'tool_call') {
      const status = String(ev.status || '').toLowerCase()
      return status !== 'completed' && status !== 'error' && status !== 'failed'
    }
    break
  }
  const call = calls.find((c) => c.subagent_run_id === subagentRunId)
  if (!call) return false
  const state = (call.delivery_state || '').toLowerCase()
  if (state === 'completed' || state === 'failed' || state === 'aborted') return false
  return Boolean(call.active)
}

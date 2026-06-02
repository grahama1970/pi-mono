import type { TransportRunState } from './types'

export interface TransportRunHistoryEntry {
  transport_run_id: string
  dag_node_id?: string
  title?: string
  last_opened_at: number
}

const STORAGE_KEY = 'scillm.transport.runHistory.v1'

export function loadTransportRunHistory(): TransportRunHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as TransportRunHistoryEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function saveTransportRunHistory(entries: TransportRunHistoryEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, 80)))
}

export function touchTransportRun(
  runId: string,
  patch: Partial<Pick<TransportRunHistoryEntry, 'dag_node_id' | 'title'>>,
): TransportRunHistoryEntry[] {
  const id = runId.trim()
  if (!id) return loadTransportRunHistory()
  const now = Date.now()
  const rest = loadTransportRunHistory().filter((e) => e.transport_run_id !== id)
  const prev = loadTransportRunHistory().find((e) => e.transport_run_id === id)
  const row: TransportRunHistoryEntry = {
    transport_run_id: id,
    dag_node_id: patch.dag_node_id ?? prev?.dag_node_id,
    title: patch.title ?? prev?.title,
    last_opened_at: now,
  }
  const next = [row, ...rest].sort((a, b) => b.last_opened_at - a.last_opened_at)
  saveTransportRunHistory(next)
  return next
}

export function mergeRunIndex(
  local: TransportRunHistoryEntry[],
  remote: Array<{ transport_run_id: string; dag_node_id?: string; mtime_ms?: number }>,
): TransportRunHistoryEntry[] {
  const byId = new Map<string, TransportRunHistoryEntry>()
  for (const row of remote) {
    const id = row.transport_run_id?.trim()
    if (!id) continue
    byId.set(id, {
      transport_run_id: id,
      dag_node_id: row.dag_node_id,
      last_opened_at: row.mtime_ms ?? 0,
    })
  }
  for (const row of local) {
    const existing = byId.get(row.transport_run_id)
    if (!existing || row.last_opened_at > existing.last_opened_at) {
      byId.set(row.transport_run_id, { ...existing, ...row })
    }
  }
  return [...byId.values()].sort((a, b) => b.last_opened_at - a.last_opened_at)
}

export function historyEntryFromState(state: TransportRunState): Partial<TransportRunHistoryEntry> {
  return {
    dag_node_id: state.dag_node_id,
    title: state.dag_node_id ? `DAG ${state.dag_node_id}` : undefined,
  }
}

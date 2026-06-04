import { apiUrl } from '../../../lib/apiBase'
import type {
  TransportDialogResponse,
  TransportRunResponse,
  TransportSkillCallResponse,
  TransportStreamEvent,
} from './types'

const TRANSPORT_PREFIX = '/scillm/v1/scillm/opencode/transport'

function transportUrl(suffix: string): string {
  const path = suffix.startsWith('/') ? suffix : `/${suffix}`
  return apiUrl(`${TRANSPORT_PREFIX}${path}`)
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text()
  if (!response.ok) {
    let detail = text.slice(0, 500)
    try {
      const parsed = JSON.parse(text) as { detail?: string; message?: string }
      detail = parsed.detail || parsed.message || detail
    } catch {
      /* keep raw */
    }
    throw new Error(`HTTP ${response.status}: ${detail}`)
  }
  return JSON.parse(text) as T
}

export async function fetchTransportDialog(transportRunId: string): Promise<TransportDialogResponse> {
  const response = await fetch(transportUrl(`/runs/${encodeURIComponent(transportRunId)}/dialog`), {
    headers: { Accept: 'application/json' },
  })
  return readJson<TransportDialogResponse>(response)
}

export async function fetchTransportRun(transportRunId: string): Promise<TransportRunResponse> {
  const response = await fetch(transportUrl(`/runs/${encodeURIComponent(transportRunId)}`), {
    headers: { Accept: 'application/json' },
  })
  return readJson<TransportRunResponse>(response)
}

export async function postTransportDialog(
  transportRunId: string,
  body: { speaker: string; body: string; execute_skills?: boolean; dry_run?: boolean },
): Promise<{ skill_call?: TransportSkillCallResponse | null }> {
  const response = await fetch(transportUrl(`/runs/${encodeURIComponent(transportRunId)}/dialog`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ execute_skills: true, ...body }),
  })
  return readJson<{ skill_call?: TransportSkillCallResponse | null }>(response)
}

export async function postTransportSkillCall(
  transportRunId: string,
  body: {
    skill: string
    args?: Record<string, unknown>
    speaker?: string
    user_note?: string
    dry_run?: boolean
  },
): Promise<TransportSkillCallResponse> {
  const response = await fetch(
    transportUrl(`/runs/${encodeURIComponent(transportRunId)}/skill-call`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    },
  )
  return readJson<TransportSkillCallResponse>(response)
}

export function openTransportEventStream(
  transportRunId: string,
  handlers: {
    onEvent: (event: TransportStreamEvent) => void
    onError?: (error: Error) => void
  },
  options?: { afterLine?: number; timeoutS?: number },
): () => void {
  const params = new URLSearchParams()
  if (options?.afterLine != null) params.set('after_line', String(options.afterLine))
  if (options?.timeoutS != null) params.set('timeout_s', String(options.timeoutS))
  const qs = params.toString()
  const url = apiUrl(
    `${TRANSPORT_PREFIX}/runs/${encodeURIComponent(transportRunId)}/events/stream${qs ? `?${qs}` : ''}`,
  )
  const source = new EventSource(url)
  source.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as TransportStreamEvent
      handlers.onEvent(event)
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err : new Error(String(err)))
    }
  }
  source.onerror = () => {
    handlers.onError?.(new Error('transport event stream disconnected'))
  }
  return () => source.close()
}


export interface TransportRunIndexRow {
  transport_run_id: string
  dag_node_id?: string
  mtime_ms: number
}

export async function fetchTransportRunIndex(): Promise<TransportRunIndexRow[]> {
  const candidates = [
    apiUrl('/scillm/v1/scillm/opencode/transport/run-index'),
    apiUrl('/transport/run-index'),
  ]
  let lastError: unknown
  for (const url of candidates) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } })
      const data = await readJson<{ runs?: TransportRunIndexRow[] }>(response)
      if (Array.isArray(data.runs)) return data.runs
    } catch (err) {
      lastError = err
    }
  }
  if (lastError) throw lastError
  return []
}

const SERVE_OPENCODE_PREFIX = '/scillm/v1/scillm/opencode'

function serveOpencodeUrl(suffix: string): string {
  const path = suffix.startsWith('/') ? suffix : `/${suffix}`
  return apiUrl(`${SERVE_OPENCODE_PREFIX}${path}`)
}

/** PDF-lab / POST /opencode/runs child sessions (oc-*). */
export function isServeChildRunId(runId: string): boolean {
  return /^oc-/.test(runId.trim())
}

export async function fetchServeRunIndex(): Promise<TransportRunIndexRow[]> {
  const response = await fetch(serveOpencodeUrl('/runs/run-index'), {
    headers: { Accept: 'application/json' },
  })
  const data = await readJson<{ runs?: TransportRunIndexRow[] }>(response)
  return Array.isArray(data.runs) ? data.runs : []
}


export async function postServeTransportDialog(
  runId: string,
  body: { speaker: string; body: string },
): Promise<{ turn?: { message_id?: string } }> {
  const response = await fetch(
    serveOpencodeUrl(`/runs/${encodeURIComponent(runId)}/dialog`),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    },
  )
  return readJson<{ turn?: { message_id?: string } }>(response)
}

export async function postCollaborationDialog(
  runId: string,
  body: { speaker: string; body: string; execute_skills?: boolean; dry_run?: boolean },
): Promise<{ skill_call?: TransportSkillCallResponse | null }> {
  if (isServeChildRunId(runId)) {
    await postServeTransportDialog(runId, { speaker: body.speaker, body: body.body })
    return {}
  }
  return postTransportDialog(runId, body)
}

export async function fetchServeTransportDialog(transportRunId: string): Promise<TransportDialogResponse> {
  const response = await fetch(
    serveOpencodeUrl(`/runs/${encodeURIComponent(transportRunId)}/dialog`),
    { headers: { Accept: 'application/json' } },
  )
  return readJson<TransportDialogResponse>(response)
}

export function serveDialogToRunResponse(dialog: TransportDialogResponse): TransportRunResponse {
  const id = (dialog.transport_run_id || '').trim()
  const status = (dialog as TransportDialogResponse & { status?: Record<string, unknown> }).status
  const metaCase = typeof status?.case_id === 'string' ? status.case_id : undefined
  const dagNodeId = metaCase
    || (typeof status?.caller_skill === 'string' ? status.caller_skill : undefined)
  return {
    schema: dialog.schema,
    state: {
      transport_run_id: id,
      dag_node_id: dagNodeId,
      parent_session_id: dialog.dialog_session_id,
      children: dialog.children,
    },
    observation: dialog.observation,
  }
}

export async function fetchServeTransportRun(transportRunId: string): Promise<TransportRunResponse> {
  const dialog = await fetchServeTransportDialog(transportRunId)
  return serveDialogToRunResponse(dialog)
}

export function openServeEventStream(
  runId: string,
  handlers: {
    onEvent: (event: TransportStreamEvent) => void
    onError?: (error: Error) => void
  },
  options?: { afterLine?: number; timeoutS?: number },
): () => void {
  const params = new URLSearchParams()
  if (options?.afterLine != null) params.set('after_line', String(options.afterLine))
  if (options?.timeoutS != null) params.set('timeout_s', String(options.timeoutS))
  const qs = params.toString()
  const url = serveOpencodeUrl(
    `/runs/${encodeURIComponent(runId)}/events/stream${qs ? `?${qs}` : ''}`,
  )
  const source = new EventSource(url)
  source.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data) as TransportStreamEvent
      handlers.onEvent(event)
    } catch (err) {
      handlers.onError?.(err instanceof Error ? err : new Error(String(err)))
    }
  }
  source.onerror = () => {
    handlers.onError?.(new Error('serve child event stream disconnected'))
  }
  return () => source.close()
}

export async function fetchMergedTransportRunIndex(): Promise<TransportRunIndexRow[]> {
  const [transportRows, serveRows] = await Promise.all([
    fetchTransportRunIndex().catch(() => [] as TransportRunIndexRow[]),
    fetchServeRunIndex().catch(() => [] as TransportRunIndexRow[]),
  ])
  const byId = new Map<string, TransportRunIndexRow>()
  for (const row of [...transportRows, ...serveRows]) {
    const id = row.transport_run_id?.trim()
    if (!id) continue
    const prev = byId.get(id)
    if (!prev || (row.mtime_ms || 0) > (prev.mtime_ms || 0)) byId.set(id, row)
  }
  return [...byId.values()].sort((a, b) => (b.mtime_ms || 0) - (a.mtime_ms || 0))
}


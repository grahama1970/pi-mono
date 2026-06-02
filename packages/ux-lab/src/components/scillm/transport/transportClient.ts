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

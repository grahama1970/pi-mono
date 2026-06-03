/**
 * Aggregate typed transport SSE attachment events (evidence_case_snapshot, figure_artifact).
 */
import type { EvidenceCaseData } from '../../shared-chat/types'
import type { FigureAttachment } from './parseStructuredArtifacts'
import { transportArtifactPreviewUrl } from './figurePreviewUrl'
import type { TransportStreamEvent } from './types'

export interface StructuredAttachmentIndex {
  evidenceByCall: Map<string, EvidenceCaseData>
  evidenceByMessageId: Map<string, EvidenceCaseData>
  figuresByCall: Map<string, FigureAttachment[]>
  figuresByMessageId: Map<string, FigureAttachment[]>
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function normalizeEvidenceCase(raw: Record<string, unknown>): EvidenceCaseData | null {
  const verdict = raw.verdict ?? raw.verdict_state
  if (verdict == null && !raw.gate_summary && !Array.isArray(raw.control_ids)) return null
  const meta = asRecord(raw.metadata)
  return {
    case_id: typeof raw.case_id === 'string' ? raw.case_id : undefined,
    qraKey: typeof raw.qraKey === 'string' ? raw.qraKey : undefined,
    verdict: String(verdict ?? 'pending'),
    grade: String(raw.grade ?? '—'),
    gates_passed: Number(raw.gates_passed ?? meta?.gates_passed ?? 0),
    gates_total: Number(raw.gates_total ?? meta?.gates_total ?? 0),
    gate_summary: String(raw.gate_summary ?? ''),
    gate_trace: (raw.gate_trace ?? meta?.gate_trace) as EvidenceCaseData['gate_trace'],
    control_ids: Array.isArray(raw.control_ids) ? raw.control_ids.map(String) : [],
    tier: String(raw.tier ?? 'grounded'),
    answer: typeof raw.answer === 'string' ? raw.answer : undefined,
    question: typeof raw.question === 'string' ? raw.question : undefined,
    evidence_case_version: asRecord(raw.evidence_case_version) ?? undefined,
    metadata: meta ?? undefined,
  }
}

function figureFromEvent(event: TransportStreamEvent, transportRunId: string): FigureAttachment | null {
  const fig = asRecord(event.figure)
  if (!fig) return null
  const path = String(fig.path ?? '')
  const label = String(fig.label ?? path.split('/').pop() ?? 'figure')
  const formatRaw = String(fig.format ?? 'other')
  const format = (
    ['png', 'svg', 'pdf', 'jpeg', 'webp'].includes(formatRaw) ? formatRaw : 'other'
  ) as FigureAttachment['format']
  const previewUrl = transportArtifactPreviewUrl(
    {
      artifact_url: typeof fig.artifact_url === 'string' ? fig.artifact_url : undefined,
      artifact_name: typeof fig.artifact_name === 'string' ? fig.artifact_name : undefined,
    },
    transportRunId,
  )
  return {
    path: path || label,
    label,
    format,
    artifactName: typeof fig.artifact_name === 'string' ? fig.artifact_name : undefined,
    previewUrl,
  }
}

function pushFigure(map: Map<string, FigureAttachment[]>, key: string, fig: FigureAttachment) {
  if (!key) return
  const list = map.get(key) ?? []
  const dupe = list.some(
    (row) => row.previewUrl === fig.previewUrl || (row.path === fig.path && row.label === fig.label),
  )
  if (!dupe) list.push(fig)
  map.set(key, list)
}

export function buildStructuredAttachmentIndex(
  events: TransportStreamEvent[],
  transportRunId: string,
): StructuredAttachmentIndex {
  const evidenceByCall = new Map<string, EvidenceCaseData>()
  const evidenceByMessageId = new Map<string, EvidenceCaseData>()
  const figuresByCall = new Map<string, FigureAttachment[]>()
  const figuresByMessageId = new Map<string, FigureAttachment[]>()

  for (const ev of events) {
    const callId = typeof ev.subagent_run_id === 'string' ? ev.subagent_run_id.trim() : ''
    const messageId = typeof ev.message_id === 'string' ? ev.message_id.trim() : ''

    if (ev.event_type === 'evidence_case_snapshot') {
      const raw = asRecord(ev.evidence_case)
      if (!raw) continue
      const row = normalizeEvidenceCase(raw)
      if (!row) continue
      if (callId) evidenceByCall.set(callId, row)
      if (messageId) evidenceByMessageId.set(messageId, row)
    }

    if (ev.event_type === 'figure_artifact') {
      const fig = figureFromEvent(ev, transportRunId)
      if (!fig) continue
      if (callId) pushFigure(figuresByCall, callId, fig)
      if (messageId) pushFigure(figuresByMessageId, messageId, fig)
    }
  }

  return { evidenceByCall, evidenceByMessageId, figuresByCall, figuresByMessageId }
}

export function mergeFigureLists(
  primary: FigureAttachment[] | undefined,
  extra: FigureAttachment[] | undefined,
): FigureAttachment[] | undefined {
  const combined = [...(primary ?? []), ...(extra ?? [])]
  if (!combined.length) return undefined
  const out: FigureAttachment[] = []
  for (const fig of combined) {
    if (out.some((row) => row.previewUrl === fig.previewUrl && fig.previewUrl)) continue
    if (out.some((row) => row.path === fig.path && row.label === fig.label)) continue
    out.push(fig)
  }
  return out.length ? out : undefined
}

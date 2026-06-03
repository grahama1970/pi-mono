/**
 * Extract structured skill outputs (evidence case, figures) from dialog text and fenced blocks.
 */
import type { EvidenceCaseData } from '../../shared-chat/types'

export interface FigureAttachment {
  path: string
  label: string
  format: 'png' | 'svg' | 'pdf' | 'jpeg' | 'webp' | 'other'
  artifactName?: string
  previewUrl?: string
}

export interface SkillReceiptSummary {
  skill: string
  status: string
  excerpt?: string
}

const FIGURE_PATH_RE = /(?:^|[\s"'(])(\/[^\s"'()]+\.(?:png|svg|pdf|jpe?g|webp))(?:[\s"'),]|$)/gi
const SKILL_CALL_RE = /Executed `\/([a-z][a-z0-9-]*)` via mediated \*\*skill_call\*\* \(`([^`]+)`\)/i

function figureFormat(path: string): FigureAttachment['format'] {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'png') return 'png'
  if (ext === 'svg') return 'svg'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'jpg' || ext === 'jpeg') return 'jpeg'
  if (ext === 'webp') return 'webp'
  return 'other'
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function normalizeEvidenceCase(raw: Record<string, unknown>): EvidenceCaseData | null {
  const nested = asRecord(raw.evidence_case)
  const source = nested ?? raw
  const verdict = source.verdict ?? source.verdict_state
  if (verdict == null && !source.gate_summary && !Array.isArray(source.control_ids)) {
    return null
  }
  const meta = asRecord(source.metadata)
  const gateTrace = Array.isArray(source.gate_trace)
    ? source.gate_trace
    : Array.isArray(meta?.gate_trace)
      ? meta?.gate_trace
      : undefined
  return {
    case_id: typeof source.case_id === 'string' ? source.case_id : undefined,
    qraKey: typeof source.qraKey === 'string' ? source.qraKey : undefined,
    verdict: String(verdict ?? 'pending'),
    grade: String(source.grade ?? '—'),
    gates_passed: Number(source.gates_passed ?? meta?.gates_passed ?? 0),
    gates_total: Number(source.gates_total ?? meta?.gates_total ?? 0),
    gate_summary: String(source.gate_summary ?? ''),
    gate_trace: gateTrace as EvidenceCaseData['gate_trace'],
    control_ids: Array.isArray(source.control_ids)
      ? source.control_ids.map(String)
      : [],
    tier: String(source.tier ?? 'grounded'),
    answer: typeof source.answer === 'string' ? source.answer : undefined,
    question: typeof source.question === 'string' ? source.question : undefined,
    evidence_case_version: asRecord(source.evidence_case_version) ?? undefined,
    metadata: meta ?? undefined,
  }
}

function tryParseJson(text: string): unknown {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

function evidenceFromUnknown(value: unknown): EvidenceCaseData | null {
  const record = asRecord(value)
  if (!record) return null
  return normalizeEvidenceCase(record)
}

export function extractEvidenceCaseFromText(chunks: string[]): EvidenceCaseData | null {
  for (const chunk of chunks) {
    const parsed = tryParseJson(chunk)
    if (!parsed) continue
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        const row = evidenceFromUnknown(item)
        if (row) return row
      }
      continue
    }
    const record = asRecord(parsed)
    if (!record) continue
    const direct = normalizeEvidenceCase(record)
    if (direct) return direct
    const receipt = asRecord(record.receipt)
    if (receipt) {
      const fromReceipt = evidenceFromUnknown(receipt)
      if (fromReceipt) return fromReceipt
    }
    const result = asRecord(record.result)
    if (result) {
      const fromResult = evidenceFromUnknown(result)
      if (fromResult) return fromResult
    }
  }
  return null
}

export function extractFiguresFromText(chunks: string[]): FigureAttachment[] {
  const seen = new Set<string>()
  const out: FigureAttachment[] = []
  for (const chunk of chunks) {
    const parsed = tryParseJson(chunk)
    const record = asRecord(parsed)
    if (record) {
      const figureData = asRecord(record.figure_data) ?? asRecord(record.figure)
      const paths: string[] = []
      if (typeof record.output === 'string' && FIGURE_PATH_RE.test(record.output)) {
        paths.push(record.output)
      }
      if (figureData) {
        for (const key of ['path', 'output', 'output_path', 'png', 'svg', 'pdf']) {
          const val = figureData[key]
          if (typeof val === 'string') paths.push(val)
        }
        if (Array.isArray(figureData.files)) {
          for (const f of figureData.files) {
            if (typeof f === 'string') paths.push(f)
          }
        }
      }
      for (const path of paths) {
        if (!path || seen.has(path)) continue
        seen.add(path)
        out.push({
          path,
          label: path.split('/').pop() ?? path,
          format: figureFormat(path),
        })
      }
    }
    for (const match of chunk.matchAll(FIGURE_PATH_RE)) {
      const path = match[1]
      if (!path || seen.has(path)) continue
      seen.add(path)
      out.push({
        path,
        label: path.split('/').pop() ?? path,
        format: figureFormat(path),
      })
    }
  }
  return out
}

export function extractSkillReceipt(text: string): SkillReceiptSummary | null {
  const match = text.match(SKILL_CALL_RE)
  if (!match) return null
  const excerptMatch = text.match(/\*\*Result excerpt:\*\*\s*\n+([\s\S]*?)(?:\n\*\*|$)/i)
  return {
    skill: match[1],
    status: match[2],
    excerpt: excerptMatch?.[1]?.trim().slice(0, 1200),
  }
}

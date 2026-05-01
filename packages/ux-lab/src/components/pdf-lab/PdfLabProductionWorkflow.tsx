import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRegisterAction } from '../../hooks/useRegisterAction'
import { PdfLabEvidenceQA } from './PdfLabEvidenceQA'
import { SurgicalTriageCleanRoom, type SurgicalTriageCleanRoomTask } from './SurgicalTriageCleanRoom'
import './PdfLabProductionWorkflow.css'

type WorkflowStage = 'initial-sweep' | 'parity-audit' | 'surgical-triage' | 'evidence-qa' | 'coverage'

interface PdfLabProductionWorkflowProps {
  initialStage?: WorkflowStage
}

interface WorkflowManifest {
  artifact_gaps: unknown[]
  candidate_inventory: {
    candidate_page_count: number
    candidate_pages: CandidatePageArtifact[]
    source: string
  }
  document_family_preset: string
  element_summary: {
    total_elements?: number
    high_signal_pages?: Array<{
      element_count: number
      page: number
      types: Record<string, number>
    }>
  }
  evidence_elements_by_page: Record<string, EvidenceElement[]>
  gate: {
    status: string
    summary: string
    details?: {
      known_validation_accuracy?: number
      target?: number
      source?: string
    }
  }
  human_triage?: {
    task_count?: number
  }
  extraction_improvement?: {
    core_pdf_oxide_changed?: boolean
    explanation?: string
    preset_improved_pdf_oxide_behavior?: boolean
    preset?: {
      name?: string
      path?: string
      schema_version?: string
    }
    scope?: string
  }
  page_count: number
  source_comparison: string
  source_extraction: string
  source_pdf: string
}

interface CandidatePageArtifact {
  element_count: number
  element_types: Record<string, number>
  gate_status: string
  inferred_match_score?: number | null
  page: number
  severity: string
  source: string
  task_count: number
  task_kinds: Record<string, number>
}

interface EvidenceElement {
  bbox?: [number, number, number, number]
  confidence?: number
  id: string
  page: number
  source?: string
  text?: string
  type: string
}

interface TriageQueue {
  page_count: number
  task_count: number
  agent_resolved_summary?: {
    finding_count?: number
    findings_by_kind?: Record<string, number>
    findings_by_severity?: Record<string, number>
  }
  agent_resolved_findings?: Array<{
    finding_id: string
    kind: string
    page: number
    reason?: string
    target_id?: string
  }>
  summary: {
    tasks_by_kind: Record<string, number>
    tasks_by_severity: Record<string, number>
    pages_with_tasks: number
  }
  human_triage_queue: TriageTaskArtifact[]
}

interface TriageTaskArtifact {
  agent_reasoning: string
  human_question: string
  kind: string
  page: number
  preview?: {
    text?: string
    type?: string
  }
  proposed_json_delta?: {
    before?: Record<string, unknown>
    after?: Record<string, unknown>
  }
  severity: string
  suggested_fix?: {
    action: string
    fallback_actions?: string[]
  }
  target_bbox?: [number, number, number, number]
  target_id: string
  task_id: string
}

interface ManualCandidate {
  page: number
  source: 'manual'
}

interface PdfLabExtractionJob {
  completedAt?: string
  createdAt: string
  error?: string
  exitCode?: number | null
  id: string
  logPath: string
  operation: string
  outputDir: string
  promoted?: {
    accuracy?: number
    candidate_pages?: number
    passed?: boolean
    triage_tasks?: number
  }
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  updatedAt: string
}

interface PdfLabJobResponse {
  async?: boolean
  job?: PdfLabExtractionJob
  logTail?: string
  ok: boolean
  promoted?: PdfLabExtractionJob['promoted']
}

interface ProductionData {
  manifest: WorkflowManifest
  triage: TriageQueue
  comparison: JsonComparison | null
  statusReport: PdfLabStatusReport | null
}

interface PdfLabStatusReport {
  artifact_paths: Record<string, { bytes: number; exists: boolean; path: string | null }>
  blockers: Array<{
    area: string
    detail: string
    next_action: string
    severity: 'critical' | 'high' | 'medium' | 'low'
  }>
  current_interpretation: string
  generated_at: string
  schema_version: string
  summary: {
    agent_resolved_count: number
    agent_resolved_kinds: Record<string, number>
    candidate_page_count: number
    core_pdf_oxide_changed: boolean
    document_family_preset?: { name?: string; path?: string; schema_version?: string } | string
    evidence_element_count: number
    evidence_page_count: number
    extraction_element_count: number
    human_triage_task_count: number
    matched_expected_elements: number
    page_count: number
    parity_accuracy: number
    parity_passed: boolean
    parity_target: number
    preset_improved_pdf_oxide_behavior: boolean
    memory_qa_implemented?: boolean
    memory_qa_passed?: boolean
    memory_sample_checks?: number
    memory_text_indexed_elements?: number
    memory_visual_indexed_elements?: number
    total_expected_elements: number
    unmatched_actual_elements: number
    unmatched_expected_elements: number
  }
  trouble_report?: {
    agent_resolved_by_kind?: Record<string, number>
    agent_resolved_by_severity?: Record<string, number>
    missed_expected_by_type?: Record<string, number>
    unmatched_actual_sample_by_type?: Record<string, number>
  }
}

interface JsonComparison {
  accuracy: number
  created_at: string
  matched_expected_elements: number
  matches: ComparisonMatch[]
  misses: ComparisonMiss[]
  passed: boolean
  schema_version: string
  subscores: Record<string, number>
  target: number
  total_expected_elements: number
  unmatched_actual_elements: number
  unmatched_actual_sample: ComparisonActual[]
  unmatched_expected_elements: number
}

interface ComparisonMatch {
  actual_id: string
  expected_id: string
  iou: number
  page: number
  score: number
  text_similarity: number
  type_compatible: boolean
}

interface ComparisonMiss {
  bbox?: [number, number, number, number]
  best_candidate?: {
    iou?: number
    score?: number
    text_similarity?: number
  }
  expected_id: string
  page: number
  reason: string
  text?: string
  type: string
}

interface ComparisonActual {
  bbox?: [number, number, number, number]
  id: string
  page: number
  source?: string
  text?: string
  type: string
}

const WORKFLOW_VERSION = '20260428-real-artifacts'
const PDF_LAB_ARTIFACT_BASE_URL = '/artifacts/pdf-lab'
const MANIFEST_URL = `${PDF_LAB_ARTIFACT_BASE_URL}/pdf-lab-nist-workflow-manifest.json?pdfLabWorkflow=${WORKFLOW_VERSION}`
const TRIAGE_URL = `${PDF_LAB_ARTIFACT_BASE_URL}/pdf-lab-nist-human-triage-queue.json?pdfLabWorkflow=${WORKFLOW_VERSION}`
const COMPARISON_URL = `${PDF_LAB_ARTIFACT_BASE_URL}/pdf-lab-nist-comparison.json?pdfLabWorkflow=${WORKFLOW_VERSION}`
const STATUS_REPORT_URL = `${PDF_LAB_ARTIFACT_BASE_URL}/pdf-lab-status-report.json?pdfLabWorkflow=${WORKFLOW_VERSION}`
const PDF_URL = `${PDF_LAB_ARTIFACT_BASE_URL}/NIST_SP_800-53r5.pdf`

const FAMILY_LABELS: Record<string, string> = {
  caption: 'Captions',
  figure: 'Figures',
  list_item: 'Lists',
  paragraph: 'Paragraphs',
  requirement: 'Requirements',
  running_footer: 'Running Footers',
  running_header: 'Running Headers',
  section_header: 'Section Headers',
  table: 'Tables',
}

function normalizeInitialStage(initialStage?: WorkflowStage): WorkflowStage {
  return initialStage ?? 'evidence-qa'
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Failed to load ${url}: ${response.status}`)
  return response.json() as Promise<T>
}

async function postJson<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = typeof payload?.detail === 'string' ? payload.detail : response.statusText
    throw new Error(`${url} failed: ${detail}`)
  }
  return payload as T
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms))
}

function formatFamily(type: string): string {
  return FAMILY_LABELS[type] ?? type.replace(/_/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase())
}

function getCandidateFamilies(candidate: CandidatePageArtifact): string[] {
  return Object.entries(candidate.element_types)
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([type]) => formatFamily(type))
}

function getPrimaryPreset(candidate: CandidatePageArtifact): string {
  const matchedPresets = (candidate as CandidatePageArtifact & { matched_presets?: string[] }).matched_presets
  if (Array.isArray(matchedPresets) && matchedPresets.length > 0) return matchedPresets[0]
  if (candidate.element_types.table) return 'table'
  if (candidate.element_types.requirement) return 'requirement'
  if (candidate.element_types.list_item) return 'list_item'
  if (candidate.element_types.caption) return 'caption'
  if (candidate.element_types.section_header) return 'section_header'
  return Object.keys(candidate.element_types)[0] ?? 'unknown'
}

function getSweepEvidence(candidate: CandidatePageArtifact): string {
  const sweepEvidence = (candidate as CandidatePageArtifact & { sweep_evidence?: string[] }).sweep_evidence
  if (Array.isArray(sweepEvidence) && sweepEvidence.length > 0) return sweepEvidence.slice(0, 2).join(' · ')
  return `${candidate.task_count} tasks · ${candidate.gate_status}`
}

function getEvidenceForPage(manifest: WorkflowManifest, page: number): EvidenceElement[] {
  return manifest.evidence_elements_by_page[String(page - 1)]
    ?? manifest.evidence_elements_by_page[String(page)]
    ?? []
}

function getPresetScanThumbnailUrl(page: number): string {
  return `${PDF_LAB_ARTIFACT_BASE_URL}/pdf-lab-nist-preset-scan/page_${page}.png`
}

function getBboxStyle(bbox?: [number, number, number, number]) {
  if (!bbox) return undefined
  const [left, top, right, bottom] = bbox
  return {
    left: `${left * 100}%`,
    top: `${top * 100}%`,
    width: `${Math.max(0, right - left) * 100}%`,
    height: `${Math.max(0, bottom - top) * 100}%`,
  }
}

function buildFamilyTallies(manifest: WorkflowManifest): Array<[string, number]> {
  const tallies = new Map<string, number>()
  for (const evidence of Object.values(manifest.evidence_elements_by_page).flat()) {
    tallies.set(evidence.type, (tallies.get(evidence.type) ?? 0) + 1)
  }
  if (tallies.size === 0) {
    for (const candidate of manifest.candidate_inventory.candidate_pages) {
      for (const [type, count] of Object.entries(candidate.element_types)) {
        tallies.set(type, (tallies.get(type) ?? 0) + count)
      }
    }
  }
  return Array.from(tallies.entries())
    .sort((left, right) => right[1] - left[1])
    .map(([type, count]) => [formatFamily(type), count])
}

function buildTriageTask(task: TriageTaskArtifact): SurgicalTriageCleanRoomTask {
  return {
    id: task.task_id,
    question: task.human_question,
    reasoning: task.agent_reasoning,
    path: `NIST › Page ${task.page} › ${task.kind.replace(/_/g, ' ')}`,
    severity: task.severity,
    bbox: task.target_bbox ?? [0.12, 0.2, 0.72, 0.82],
  }
}

function summarizeDelta(task: TriageTaskArtifact): { before: string; after: string } {
  const before = task.proposed_json_delta?.before ?? {}
  const after = task.proposed_json_delta?.after ?? {}
  return {
    before: String(before.type ?? before.reviewStatus ?? before.id ?? 'pending'),
    after: String(after.type ?? after.reviewStatus ?? after.id ?? task.suggested_fix?.action ?? 'review'),
  }
}

function buildComparisonRows(comparison: JsonComparison | null) {
  if (!comparison) return []
  const missingRows = comparison.misses.slice(0, 24).map(miss => ({
    id: miss.expected_id,
    page: miss.page,
    expected: miss.type,
    actual: miss.best_candidate ? `best score ${miss.best_candidate.score?.toFixed(3) ?? 'n/a'}` : 'none',
    status: 'missing' as const,
    detail: miss.reason,
  }))
  const extraRows = comparison.unmatched_actual_sample.slice(0, Math.max(0, 24 - missingRows.length)).map(actual => ({
    id: actual.id,
    page: actual.page,
    expected: 'none',
    actual: actual.type,
    status: 'extra' as const,
    detail: actual.text ?? actual.source ?? 'unmatched actual element',
  }))
  const matchRows = comparison.matches.slice(0, Math.max(0, 24 - missingRows.length - extraRows.length)).map(match => ({
    id: match.expected_id,
    page: match.page,
    expected: match.expected_id,
    actual: match.actual_id,
    status: 'matched' as const,
    detail: `score ${match.score.toFixed(3)} · text ${match.text_similarity.toFixed(3)} · IoU ${match.iou.toFixed(3)}`,
  }))
  return [...missingRows, ...extraRows, ...matchRows]
}

function buildComparisonPageStats(comparison: JsonComparison | null) {
  const byPage = new Map<number, { extra: number; matched: number; missing: number }>()
  if (!comparison) return byPage
  for (const match of comparison.matches) {
    const stats = byPage.get(match.page) ?? { extra: 0, matched: 0, missing: 0 }
    stats.matched += 1
    byPage.set(match.page, stats)
  }
  for (const miss of comparison.misses) {
    const stats = byPage.get(miss.page) ?? { extra: 0, matched: 0, missing: 0 }
    stats.missing += 1
    byPage.set(miss.page, stats)
  }
  for (const actual of comparison.unmatched_actual_sample) {
    const stats = byPage.get(actual.page) ?? { extra: 0, matched: 0, missing: 0 }
    stats.extra += 1
    byPage.set(actual.page, stats)
  }
  return byPage
}

function buildCandidateRunRows(comparison: JsonComparison | null, candidates: CandidatePageArtifact[]) {
  const pageStats = buildComparisonPageStats(comparison)
  const candidatesByPage = new Map(candidates.map(candidate => [candidate.page, candidate]))
  if (!comparison) {
    return candidates.slice(0, 16).map(candidate => ({
      elementCount: candidate.element_count,
      extra: 0,
      matched: 0,
      missing: 0,
      page: candidate.page,
      preset: getPrimaryPreset(candidate),
      triageTasks: candidate.task_count,
    }))
  }
  return Array.from(pageStats.entries())
    .map(([page, stats]) => {
      const candidate = candidatesByPage.get(page)
      return {
        elementCount: candidate?.element_count ?? stats.matched + stats.missing + stats.extra,
        extra: stats.extra,
        matched: stats.matched,
        missing: stats.missing,
        page,
        preset: candidate ? getPrimaryPreset(candidate) : 'agent_oracle',
        triageTasks: candidate?.task_count ?? 0,
      }
    })
    .sort((left, right) => (right.missing + right.extra) - (left.missing + left.extra) || left.page - right.page)
    .slice(0, 16)
}

export function PdfLabProductionWorkflow({ initialStage }: PdfLabProductionWorkflowProps) {
  useRegisterAction('pdf-lab:production:stage-initial-sweep', {
    app: 'pdf-lab',
    action: 'PDF_LAB_PRODUCTION_STAGE_INITIAL_SWEEP',
    label: 'Open Initial Sweep',
    description: 'Show preset discovery, candidate pages, and evidence preview',
  })
  useRegisterAction('pdf-lab:production:stage-parity-audit', {
    app: 'pdf-lab',
    action: 'PDF_LAB_PRODUCTION_STAGE_PARITY_AUDIT',
    label: 'Open Parity Audit',
    description: 'Show deterministic extraction comparison and triage output',
  })
  useRegisterAction('pdf-lab:production:stage-surgical-triage', {
    app: 'pdf-lab',
    action: 'PDF_LAB_PRODUCTION_STAGE_SURGICAL_TRIAGE',
    label: 'Open Surgical Triage',
    description: 'Open the final human ambiguity deck',
  })
  useRegisterAction('pdf-lab:production:stage-evidence-qa', {
    app: 'pdf-lab',
    action: 'PDF_LAB_PRODUCTION_STAGE_EVIDENCE_QA',
    label: 'Open Evidence QA',
    description: 'Open the final Nico evidence QA gate using real PDF crops and extracted JSON',
  })
  useRegisterAction('pdf-lab:production:stage-coverage', {
    app: 'pdf-lab',
    action: 'PDF_LAB_PRODUCTION_STAGE_COVERAGE',
    label: 'Open Coverage / Status',
    description: 'Show artifact-derived PDF Lab blockers and definition-of-done gates',
  })
  useRegisterAction('pdf-lab:production:add-page', {
    app: 'pdf-lab',
    action: 'PDF_LAB_PRODUCTION_ADD_PAGE_TO_CANDIDATES',
    label: 'Add Page to Candidates',
    description: 'Manually add a known page to the candidate extraction queue',
  })
  useRegisterAction('pdf-lab:production:commit-sweep', {
    app: 'pdf-lab',
    action: 'PDF_LAB_PRODUCTION_COMMIT_SWEEP',
    label: 'Commit Sweep to Run',
    description: 'Commit discovered candidate pages to the deterministic pdf_oxide run',
  })
  useRegisterAction('pdf-lab:production:bulk-rerun', {
    app: 'pdf-lab',
    action: 'PDF_LAB_PRODUCTION_BULK_REPAIR_RERUN',
    label: 'Bulk Repair / Re-run',
    description: 'Repair systemic extraction settings and re-run candidate pages',
  })
  useRegisterAction('pdf-lab:production:eject-triage', {
    app: 'pdf-lab',
    action: 'PDF_LAB_PRODUCTION_EJECT_MISMATCHES_TO_TRIAGE',
    label: 'Eject Mismatches to Triage',
    description: 'Create human triage cards only for unresolved mismatches',
  })
  useRegisterAction('pdf-lab:production:promote-direct-run', {
    app: 'pdf-lab',
    action: 'PDF_LAB_PRODUCTION_PROMOTE_DIRECT_RUN',
    label: 'Promote Direct Run',
    description: 'Promote a direct pdf_oxide output directory into UX Lab artifacts',
  })

  const [stage, setStage] = useState<WorkflowStage>(() => normalizeInitialStage(initialStage))
  const [data, setData] = useState<ProductionData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedPage, setSelectedPage] = useState<number | null>(null)
  const [manualCandidates, setManualCandidates] = useState<ManualCandidate[]>([])
  const [triageIndex, setTriageIndex] = useState(0)
  const [intentDraft, setIntentDraft] = useState('')
  const [lastDecision, setLastDecision] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [currentJob, setCurrentJob] = useState<PdfLabExtractionJob | null>(null)
  const [jobLogTail, setJobLogTail] = useState<string>('')

  useEffect(() => {
    setStage(normalizeInitialStage(initialStage))
  }, [initialStage])

  const loadArtifacts = useCallback(async (cancelled?: () => boolean) => {
    setError(null)
    const [manifest, triage, comparison, statusReport] = await Promise.all([
      fetchJson<WorkflowManifest>(MANIFEST_URL),
      fetchJson<TriageQueue>(TRIAGE_URL),
      fetchJson<JsonComparison>(COMPARISON_URL).catch(() => null),
      fetchJson<PdfLabStatusReport>(STATUS_REPORT_URL).catch(() => null),
    ])
    if (cancelled?.()) return
    setData({ manifest, triage, comparison, statusReport })
    setSelectedPage(current => current ?? manifest.candidate_inventory.candidate_pages[0]?.page ?? null)
  }, [])

  useEffect(() => {
    let cancelled = false
    loadArtifacts(() => cancelled).catch((err: Error) => {
      if (!cancelled) setError(err.message)
    })
    return () => { cancelled = true }
  }, [loadArtifacts])

  const openStage = useCallback((nextStage: WorkflowStage) => {
    setStage(nextStage)
    window.history.replaceState(null, '', `#pdf-lab/${nextStage}`)
  }, [])

  const addPageToCandidates = useCallback(() => {
    if (!data) return
    const input = window.prompt('Add page number to candidate queue')
    if (!input) return
    const page = Number(input)
    if (!Number.isInteger(page) || page < 1 || page > data.manifest.page_count) {
      setNotice(`Invalid page: ${input}`)
      return
    }
    setManualCandidates(current => current.some(candidate => candidate.page === page) ? current : [...current, { page, source: 'manual' }])
    setSelectedPage(page)
    setNotice(`Page ${page} added to candidates`)
  }, [data])

  const advanceTriage = useCallback(async (decision: 'accept' | 'reject' | 'skip') => {
    const task = data?.triage.human_triage_queue[triageIndex]
    if (!task) return
    setActionBusy(`triage-${decision}`)
    try {
      await postJson('/api/pdf-lab/triage-decision', {
        taskId: task.task_id,
        decision,
        intent: intentDraft,
        page: task.page,
        task,
        proposedJsonDelta: task.proposed_json_delta ?? null,
      })
      setLastDecision(`${decision}: ${task.task_id}`)
      setTriageIndex(index => Math.min((data?.triage.human_triage_queue.length ?? 1) - 1, index + 1))
      setIntentDraft('')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setActionBusy(null)
    }
  }, [data?.triage.human_triage_queue, intentDraft, triageIndex])

  const undoLastDecision = useCallback(async () => {
    const task = data?.triage.human_triage_queue[Math.max(0, triageIndex - 1)] ?? data?.triage.human_triage_queue[triageIndex]
    if (!task) return
    setActionBusy('triage-undo')
    try {
      await postJson('/api/pdf-lab/triage-decision', {
        taskId: task.task_id,
        decision: 'undo',
        intent: intentDraft,
        page: task.page,
        task,
        proposedJsonDelta: task.proposed_json_delta ?? null,
      })
      setLastDecision(null)
      setTriageIndex(index => Math.max(0, index - 1))
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setActionBusy(null)
    }
  }, [data?.triage.human_triage_queue, intentDraft, triageIndex])

  const pollExtractionJob = useCallback(async (
    jobId: string,
    actionLabel: string,
    nextStage?: WorkflowStage,
  ) => {
    for (;;) {
      await sleep(2500)
      const status = await fetchJson<PdfLabJobResponse>(`/api/pdf-lab/jobs/${jobId}`)
      if (status.job) setCurrentJob(status.job)
      if (typeof status.logTail === 'string') setJobLogTail(status.logTail)

      if (status.job?.status === 'succeeded') {
        await loadArtifacts()
        if (nextStage) openStage(nextStage)
        const promoted = status.job.promoted
        const accuracy = typeof promoted?.accuracy === 'number' ? ` · ${(promoted.accuracy * 100).toFixed(2)}% parity` : ''
        const triageTasks = typeof promoted?.triage_tasks === 'number' ? ` · ${promoted.triage_tasks} triage cards` : ''
        setNotice(`${actionLabel} complete${accuracy}${triageTasks}`)
        return
      }

      if (status.job?.status === 'failed') {
        setNotice(`${actionLabel} failed: ${status.job.error ?? `see ${status.job.logPath}`}`)
        return
      }
    }
  }, [loadArtifacts, openStage])

  const promoteDirectRun = useCallback(async () => {
    const outputDir = window.prompt('Promote direct pdf_oxide output directory, e.g. /tmp/pdf-lab-direct-50-debug')
    if (!outputDir) return
    setActionBusy('Promote Direct Run')
    setNotice(`Promoting direct run ${outputDir}…`)
    try {
      const result = await postJson<PdfLabJobResponse>('/api/pdf-lab/jobs/promote-output', { outputDir })
      await loadArtifacts()
      const accuracy = typeof result.promoted?.accuracy === 'number' ? ` · ${(result.promoted.accuracy * 100).toFixed(2)}% parity` : ''
      setNotice(`Promoted direct run${accuracy}`)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setActionBusy(null)
    }
  }, [loadArtifacts])

  const runWorkflowAction = useCallback(async (
    actionLabel: string,
    endpoint: string,
    nextStage?: WorkflowStage,
  ) => {
    setActionBusy(actionLabel)
    setNotice(`${actionLabel} queued against real pdf_oxide artifacts…`)
    setJobLogTail('')
    try {
      const result = await postJson<PdfLabJobResponse>(endpoint, {
        maxPages: 50,
        topK: 5,
        maxIterations: 1,
        target: 0.95,
      })
      if (result.async && result.job) {
        setCurrentJob(result.job)
        setNotice(`${actionLabel} running as job ${result.job.id}`)
        await pollExtractionJob(result.job.id, actionLabel, nextStage)
      } else {
        await loadArtifacts()
        if (nextStage) openStage(nextStage)
        const accuracy = typeof result.promoted?.accuracy === 'number' ? ` · ${(result.promoted.accuracy * 100).toFixed(2)}% parity` : ''
        setNotice(`${actionLabel} complete${accuracy}`)
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setActionBusy(null)
    }
  }, [loadArtifacts, openStage, pollExtractionJob])

  const candidates = useMemo(() => {
    if (!data) return []
    const manualPages = new Set(manualCandidates.map(candidate => candidate.page))
    const existingPages = new Set(data.manifest.candidate_inventory.candidate_pages.map(candidate => candidate.page))
    const manualRows: CandidatePageArtifact[] = Array.from(manualPages)
      .filter(page => !existingPages.has(page))
      .map(page => {
        const evidence = getEvidenceForPage(data.manifest, page)
        const elementTypes = evidence.reduce<Record<string, number>>((types, item) => {
          types[item.type] = (types[item.type] ?? 0) + 1
          return types
        }, {})
        return {
          element_count: evidence.length,
          element_types: elementTypes,
          gate_status: 'manual',
          inferred_match_score: null,
          page,
          severity: 'manual',
          source: 'manual operator add',
          task_count: data.triage.human_triage_queue.filter(task => task.page === page).length,
          task_kinds: {},
        }
      })
    return [...data.manifest.candidate_inventory.candidate_pages, ...manualRows]
  }, [data, manualCandidates])

  const selectedCandidate = useMemo(() => {
    if (!selectedPage) return candidates[0]
    return candidates.find(candidate => candidate.page === selectedPage) ?? candidates[0]
  }, [candidates, selectedPage])

  const activeTriageArtifact = data?.triage.human_triage_queue[triageIndex] ?? data?.triage.human_triage_queue[0] ?? null
  const activeTriageCard = activeTriageArtifact ? buildTriageTask(activeTriageArtifact) : null

  if (error) {
    return (
      <div className="pdf-lab-prod-root pdf-lab-prod-state" data-qid="pdf-lab:production:error">
        <h1>PDF Lab artifact load failed</h1>
        <p>{error}</p>
      </div>
    )
  }

  if (!data || !selectedCandidate) {
    return (
      <div className="pdf-lab-prod-root pdf-lab-prod-state" data-qid="pdf-lab:production:loading">
        <h1>Loading real PDF Lab artifacts…</h1>
        <p>{MANIFEST_URL}</p>
      </div>
    )
  }

  if (stage === 'surgical-triage') {
    if (!activeTriageCard) {
      const resolvedCount = data.triage.agent_resolved_summary?.finding_count ?? 0
      const resolvedKinds = data.triage.agent_resolved_summary?.findings_by_kind ?? {}
      const resolvedRows = Object.entries(resolvedKinds)
      const recentFindings = data.triage.agent_resolved_findings?.slice(0, 4) ?? []
      const improvement = data.manifest.extraction_improvement
      const presetName = improvement?.preset?.name ?? 'document-family preset'

      return (
        <div className="pdf-lab-prod-root pdf-lab-prod-empty-deck" data-qid="pdf-lab:production:triage-empty">
          <section className="pdf-lab-prod-empty-card">
            <div className="pdf-lab-prod-empty-eyebrow">PDF Lab · Second-pass complete</div>
            <h1>No human triage cards remain</h1>
            <p>
              The agent resolved the current residuals before handing work to the human.
              The production rule is working: humans only see unresolved ambiguity, not
              obvious extractor or canonicalization defects.
            </p>

            {improvement && (
              <div className="pdf-lab-prod-empty-report">
                <h2>Extraction report boundary</h2>
                <p>
                  The <code>{presetName}</code> preset and PDF Lab second-pass orchestration improved the
                  effective <code>pdf_oxide</code> extraction for this NIST-like PDF. This run did not patch
                  the core Rust extractor: <code>core_pdf_oxide_changed={String(Boolean(improvement.core_pdf_oxide_changed))}</code>.
                </p>
              </div>
            )}

            <div className="pdf-lab-prod-empty-grid">
              <div>
                <span>Human cards</span>
                <strong>{data.triage.task_count}</strong>
              </div>
              <div>
                <span>Agent-resolved findings</span>
                <strong>{resolvedCount}</strong>
              </div>
              <div>
                <span>Parity gate</span>
                <strong>{data.comparison ? `${(data.comparison.accuracy * 100).toFixed(2)}%` : 'passed'}</strong>
              </div>
            </div>

            <div className="pdf-lab-prod-empty-findings">
              <h2>Resolved by second pass</h2>
              {resolvedRows.length > 0 ? (
                <ul>
                  {resolvedRows.map(([kind, count]) => (
                    <li key={kind}>
                      <code>{kind}</code>
                      <span>{count}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No agent-resolved findings were reported.</p>
              )}
            </div>

            {recentFindings.length > 0 && (
              <div className="pdf-lab-prod-empty-findings">
                <h2>Recent examples</h2>
                <ul>
                  {recentFindings.map(finding => (
                    <li key={finding.finding_id}>
                      <code>{finding.kind}</code>
                      <span>p{finding.page}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="pdf-lab-prod-empty-actions">
              <button
                data-qid="pdf-lab:production:triage-empty-open-evidence-qa"
                data-qs-action="PDF_LAB_PRODUCTION_OPEN_EVIDENCE_QA"
                title="Open Nico evidence QA for stratified final checks"
                onClick={() => openStage('evidence-qa')}
              >
                Open Evidence QA
              </button>
              <button
                data-qid="pdf-lab:production:triage-empty-open-parity"
                data-qs-action="PDF_LAB_PRODUCTION_OPEN_PARITY_AUDIT"
                title="Open the parity audit that produced this empty human deck"
                onClick={() => openStage('parity-audit')}
              >
                Open Parity Audit
              </button>
              <button
                data-qid="pdf-lab:production:triage-empty-open-sweep"
                data-qs-action="PDF_LAB_PRODUCTION_OPEN_INITIAL_SWEEP"
                title="Open the initial sweep candidate inventory"
                onClick={() => openStage('initial-sweep')}
              >
                Open Initial Sweep
              </button>
            </div>
          </section>
        </div>
      )
    }

    return (
      <div className="pdf-lab-prod-root pdf-lab-prod-triage" data-qid="pdf-lab:production:root">
        <SurgicalTriageCleanRoom
          pdfUrl={PDF_URL}
          pageNumber={Math.max(0, (activeTriageArtifact?.page ?? 1) - 1)}
          taskIndex={triageIndex}
          taskCount={data.triage.human_triage_queue.length}
          task={activeTriageCard}
          intentDraft={intentDraft}
          onIntentChange={setIntentDraft}
          onAccept={() => { void advanceTriage('accept') }}
          onReject={() => { void advanceTriage('reject') }}
          onSkip={() => { void advanceTriage('skip') }}
          onPrevious={() => setTriageIndex(index => Math.max(0, index - 1))}
          onNext={() => setTriageIndex(index => Math.min(data.triage.human_triage_queue.length - 1, index + 1))}
          onUndoLastDecision={undoLastDecision}
          onOpenAudit={() => undefined}
          onOpenQueue={() => openStage('parity-audit')}
        />
        {lastDecision && <div className="pdf-lab-prod-decision-toast">Last decision: {lastDecision}</div>}
      </div>
    )
  }

  if (stage === 'evidence-qa') {
    return (
      <div className="pdf-lab-prod-root" data-qid="pdf-lab:production:evidence-qa-root">
        <header className="pdf-lab-prod-header">
          <div>
            <div className="pdf-lab-prod-brand">PDF Lab</div>
            <div className="pdf-lab-prod-subtitle">
              Final Nico evidence QA · real PDF crops, extracted JSON, and memory-ready provenance
            </div>
          </div>
          <div className="pdf-lab-prod-header-actions">
            <button
              data-qid="pdf-lab:production:evidence-qa-open-triage"
              data-qs-action="PDF_LAB_PRODUCTION_STAGE_SURGICAL_TRIAGE"
              title="Open the final human ambiguity deck"
              onClick={() => openStage('surgical-triage')}
            >
              Open Triage Deck
            </button>
            <button
              data-qid="pdf-lab:production:evidence-qa-open-parity"
              data-qs-action="PDF_LAB_PRODUCTION_STAGE_PARITY_AUDIT"
              title="Open parity audit"
              onClick={() => openStage('parity-audit')}
            >
              Open Parity Audit
            </button>
          </div>
        </header>

        <nav className="pdf-lab-prod-stage-nav" aria-label="PDF Lab workflow stages">
          <StageButton id="initial-sweep" label="1 · Initial Sweep" activeStage={stage} onOpen={openStage} />
          <StageButton id="parity-audit" label="2 · Parity Audit" activeStage={stage} onOpen={openStage} />
          <StageButton id="surgical-triage" label="3 · Surgical Triage" activeStage={stage} onOpen={openStage} />
          <StageButton id="evidence-qa" label="4 · Evidence QA" activeStage={stage} onOpen={openStage} />
          <StageButton id="coverage" label="5 · Coverage" activeStage={stage} onOpen={openStage} />
          <div className="pdf-lab-prod-metric"><span>Pages</span><b>{data.manifest.page_count}</b></div>
          <div className="pdf-lab-prod-metric"><span>Candidates</span><b>{candidates.length}</b></div>
          <div className="pdf-lab-prod-metric"><span>Triage Cards</span><b>{data.triage.task_count}</b></div>
        </nav>

        <PdfLabEvidenceQA />
      </div>
    )
  }

  if (stage === 'coverage') {
    return (
      <div className="pdf-lab-prod-root" data-qid="pdf-lab:production:coverage-root">
        <header className="pdf-lab-prod-header">
          <div>
            <div className="pdf-lab-prod-brand">PDF Lab</div>
            <div className="pdf-lab-prod-subtitle">
              Coverage / status · artifact-derived blockers and definition-of-done gates
            </div>
          </div>
          <div className="pdf-lab-prod-header-actions">
            <button
              data-qid="pdf-lab:production:coverage-open-parity"
              data-qs-action="PDF_LAB_PRODUCTION_STAGE_PARITY_AUDIT"
              title="Open parity audit"
              onClick={() => openStage('parity-audit')}
            >
              Open Parity Audit
            </button>
            <button
              data-qid="pdf-lab:production:coverage-open-evidence"
              data-qs-action="PDF_LAB_PRODUCTION_STAGE_EVIDENCE_QA"
              title="Open evidence QA"
              onClick={() => openStage('evidence-qa')}
            >
              Open Evidence QA
            </button>
          </div>
        </header>

        <nav className="pdf-lab-prod-stage-nav" aria-label="PDF Lab workflow stages">
          <StageButton id="initial-sweep" label="1 · Initial Sweep" activeStage={stage} onOpen={openStage} />
          <StageButton id="parity-audit" label="2 · Parity Audit" activeStage={stage} onOpen={openStage} />
          <StageButton id="surgical-triage" label="3 · Surgical Triage" activeStage={stage} onOpen={openStage} />
          <StageButton id="evidence-qa" label="4 · Evidence QA" activeStage={stage} onOpen={openStage} />
          <StageButton id="coverage" label="5 · Coverage" activeStage={stage} onOpen={openStage} />
          <div className="pdf-lab-prod-metric"><span>Pages</span><b>{data.manifest.page_count}</b></div>
          <div className="pdf-lab-prod-metric"><span>Candidates</span><b>{candidates.length}</b></div>
          <div className="pdf-lab-prod-metric"><span>Triage Cards</span><b>{data.triage.task_count}</b></div>
        </nav>

        <CoverageStatusPane
          comparison={data.comparison}
          manifest={data.manifest}
          statusReport={data.statusReport}
          triage={data.triage}
        />
      </div>
    )
  }

  return (
    <div className="pdf-lab-prod-root" data-qid="pdf-lab:production:root">
      <header className="pdf-lab-prod-header">
        <div>
          <div className="pdf-lab-prod-brand">PDF Lab</div>
          <div className="pdf-lab-prod-subtitle">
            Real workflow artifacts · humans resolve {data.triage.task_count} final ambiguities across {data.triage.summary.pages_with_tasks} pages
          </div>
        </div>
        <div className="pdf-lab-prod-header-actions">
          <button
            data-qid="pdf-lab:production:add-page"
            data-qs-action="PDF_LAB_PRODUCTION_ADD_PAGE_TO_CANDIDATES"
            title="Add a known page to the candidate queue"
            onClick={addPageToCandidates}
          >
            Add Page to Candidates
          </button>
          <button
            data-qid="pdf-lab:production:promote-direct-run"
            data-qs-action="PDF_LAB_PRODUCTION_PROMOTE_DIRECT_RUN"
            title="Promote a direct pdf_oxide output directory into UX Lab artifacts"
            onClick={promoteDirectRun}
            disabled={Boolean(actionBusy)}
          >
            Promote Direct Run
          </button>
          <button
            data-qid="pdf-lab:production:open-triage"
            data-qs-action="PDF_LAB_PRODUCTION_STAGE_SURGICAL_TRIAGE"
            title="Open the final human ambiguity deck"
            onClick={() => openStage('surgical-triage')}
          >
            Open Triage Deck
          </button>
        </div>
      </header>

      <nav className="pdf-lab-prod-stage-nav" aria-label="PDF Lab workflow stages">
        <StageButton id="initial-sweep" label="1 · Initial Sweep" activeStage={stage} onOpen={openStage} />
        <StageButton id="parity-audit" label="2 · Parity Audit" activeStage={stage} onOpen={openStage} />
        <StageButton id="surgical-triage" label="3 · Surgical Triage" activeStage={stage} onOpen={openStage} />
        <StageButton id="evidence-qa" label="4 · Evidence QA" activeStage={stage} onOpen={openStage} />
        <StageButton id="coverage" label="5 · Coverage" activeStage={stage} onOpen={openStage} />
        <div className="pdf-lab-prod-metric"><span>Pages</span><b>{data.manifest.page_count}</b></div>
        <div className="pdf-lab-prod-metric"><span>Candidates</span><b>{candidates.length}</b></div>
        <div className="pdf-lab-prod-metric"><span>Triage Cards</span><b>{data.triage.task_count}</b></div>
      </nav>

      {notice && <div className="pdf-lab-prod-notice">{notice}</div>}
      {currentJob && currentJob.status !== 'succeeded' && (
        <div className="pdf-lab-prod-job-status" data-qid="pdf-lab:production:job-status">
          <div>
            <b>{currentJob.status.toUpperCase()}</b> {currentJob.id}
            <span>{currentJob.outputDir}</span>
          </div>
          {jobLogTail && <pre>{jobLogTail}</pre>}
        </div>
      )}

      {stage === 'initial-sweep' ? (
        <InitialSweepPane
          candidates={candidates}
          familyTallies={buildFamilyTallies(data.manifest)}
          manifest={data.manifest}
          selectedCandidate={selectedCandidate}
          selectedPage={selectedPage ?? selectedCandidate.page}
          setSelectedPage={setSelectedPage}
          actionBusy={actionBusy}
          onCommit={() => runWorkflowAction('Commit Sweep to Run', '/api/pdf-lab/commit-sweep-to-run', 'parity-audit')}
        />
      ) : (
        <ParityAuditPane
          comparison={data.comparison}
          manifest={data.manifest}
          triage={data.triage}
          candidates={candidates}
          actionBusy={actionBusy}
          onBulkRerun={() => runWorkflowAction('Bulk Repair / Re-run', '/api/pdf-lab/bulk-repair-rerun', 'parity-audit')}
          onEject={() => runWorkflowAction('Eject Mismatches to Triage', '/api/pdf-lab/eject-mismatches-to-triage', 'surgical-triage')}
        />
      )}
    </div>
  )
}

function StageButton({
  id,
  label,
  activeStage,
  onOpen,
}: {
  id: WorkflowStage
  label: string
  activeStage: WorkflowStage
  onOpen: (stage: WorkflowStage) => void
}) {
  const action = `PDF_LAB_PRODUCTION_STAGE_${id.replace('-', '_').toUpperCase()}`
  return (
    <button
      className={`pdf-lab-prod-stage-button ${activeStage === id ? 'active' : ''}`}
      data-qid={`pdf-lab:production:stage:${id}`}
      data-qs-action={action}
      title={`Open ${label}`}
      onClick={() => onOpen(id)}
    >
      {label}
    </button>
  )
}

function InitialSweepPane({
  candidates,
  familyTallies,
  manifest,
  selectedCandidate,
  selectedPage,
  setSelectedPage,
  actionBusy,
  onCommit,
}: {
  candidates: CandidatePageArtifact[]
  familyTallies: Array<[string, number]>
  manifest: WorkflowManifest
  selectedCandidate: CandidatePageArtifact
  selectedPage: number
  setSelectedPage: (page: number) => void
  actionBusy: string | null
  onCommit: () => void
}) {
  const evidence = getEvidenceForPage(manifest, selectedCandidate.page)
  const primaryEvidence = evidence.find(item => item.bbox) ?? evidence[0]
  const [failedImages, setFailedImages] = useState<Set<number>>(() => new Set())
  const evidenceImageMissing = failedImages.has(selectedCandidate.page)
  const evidenceImageUrl = getPresetScanThumbnailUrl(selectedCandidate.page)

  return (
    <main className="pdf-lab-prod-three-pane">
      <aside className="pdf-lab-prod-pane pdf-lab-prod-elements">
        <PaneHeader title="Elements" detail="Real preset element tally found during sweep" />
        {familyTallies.map(([label, count]) => (
          <button
            key={label}
            className={`pdf-lab-prod-family-row ${label === 'Tables' ? 'active' : ''}`}
            data-qid={`pdf-lab:production:family:${label.toLowerCase().replaceAll(' ', '-')}`}
            data-qs-action="PDF_LAB_PRODUCTION_FILTER_FAMILY"
            title={`Filter candidate pages by ${label}`}
            onClick={() => undefined}
          >
            <span>{label}</span>
            <b>{count}</b>
          </button>
        ))}
      </aside>

      <section className="pdf-lab-prod-pane pdf-lab-prod-candidates">
        <PaneHeader title="Candidate Pages" detail={`${candidates.length} real pages selected for deterministic extraction`} />
        <div className="pdf-lab-prod-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Page</th>
                <th>Preview</th>
                <th>Detected Families</th>
                <th>Matched Presets</th>
                <th>Evidence / Anchors</th>
                <th>Next Step</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map(candidate => (
                <tr
                  key={`${candidate.source}:${candidate.page}`}
                  className={candidate.page === selectedPage ? 'selected' : ''}
                  data-qid={`pdf-lab:production:candidate:${candidate.page}`}
                  data-qs-action="PDF_LAB_PRODUCTION_SELECT_CANDIDATE_PAGE"
                  title={`Inspect candidate page ${candidate.page}`}
                  tabIndex={0}
                  onClick={() => setSelectedPage(candidate.page)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') setSelectedPage(candidate.page)
                  }}
                >
                  <td className="pdf-lab-prod-page-num">{candidate.page}</td>
                  <td>
                    <div className="pdf-lab-prod-thumb">
                      <img
                        alt={`Rendered candidate page ${candidate.page}`}
                        src={getPresetScanThumbnailUrl(candidate.page)}
                        onError={(event) => { event.currentTarget.style.display = 'none' }}
                      />
                    </div>
                  </td>
                  <td><TagList tags={getCandidateFamilies(candidate)} /></td>
                  <td><code>{getPrimaryPreset(candidate)}</code></td>
                  <td>{getSweepEvidence(candidate)}</td>
                  <td className="pdf-lab-prod-next-step">{candidate.task_count > 0 ? 'Compare JSON' : 'Extract Page'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pdf-lab-prod-pane-footer">
          <button
            className="pdf-lab-prod-primary"
            data-qid="pdf-lab:production:commit-sweep"
            data-qs-action="PDF_LAB_PRODUCTION_COMMIT_SWEEP"
            title="Commit sweep candidates to deterministic extraction"
            onClick={onCommit}
            disabled={actionBusy !== null}
          >
            {actionBusy === 'Commit Sweep to Run' ? 'Running pdf_oxide…' : 'Commit Sweep to Run →'}
          </button>
        </div>
      </section>

      <aside className="pdf-lab-prod-pane pdf-lab-prod-evidence">
        <PaneHeader title="Evidence" detail={`Real evidence extracted from page ${selectedCandidate.page}`} />
        <div className="pdf-lab-prod-evidence-card">
          {evidenceImageMissing ? (
            <div className="pdf-lab-prod-evidence-missing">
              <b>No rendered preset-scan thumbnail for page {selectedCandidate.page}</b>
              <span>Run Commit Sweep to regenerate real page evidence.</span>
            </div>
          ) : (
            <div className="pdf-lab-prod-real-page">
              <img
                alt={`Rendered NIST page ${selectedCandidate.page}`}
                src={evidenceImageUrl}
                onError={() => setFailedImages(current => new Set(current).add(selectedCandidate.page))}
              />
              {primaryEvidence?.bbox && (
                <div className="pdf-lab-prod-evidence-bbox" style={getBboxStyle(primaryEvidence.bbox)}>
                  <span>{formatFamily(primaryEvidence.type)}</span>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="pdf-lab-prod-evidence-note">
          <b>{primaryEvidence?.id ?? `page-${selectedCandidate.page}`}</b>
          <p>{primaryEvidence?.text ?? `${selectedCandidate.element_count} extracted elements available for this page.`}</p>
        </div>
      </aside>
    </main>
  )
}

function ParityAuditPane({
  comparison,
  manifest,
  triage,
  candidates,
  actionBusy,
  onBulkRerun,
  onEject,
}: {
  comparison: JsonComparison | null
  manifest: WorkflowManifest
  triage: TriageQueue
  candidates: CandidatePageArtifact[]
  actionBusy: string | null
  onBulkRerun: () => void
  onEject: () => void
}) {
  const comparisonRows = buildComparisonRows(comparison)
  const runRows = buildCandidateRunRows(comparison, candidates)
  const autoForwardCount = Math.max(0, manifest.page_count - triage.summary.pages_with_tasks)

  return (
    <main className="pdf-lab-prod-three-pane parity">
      <aside className="pdf-lab-prod-pane pdf-lab-prod-run">
        <PaneHeader title="Candidate Run" detail="Real pdf_oxide extraction status by page and preset" />
        {runRows.map(row => (
          <div key={row.page} className={`pdf-lab-prod-run-row ${row.missing > 0 || row.extra > 0 || row.triageTasks > 0 ? 'review' : 'pass'}`}>
            <div><b>Page {row.page}</b><code>{row.preset}</code></div>
            <span>{row.elementCount} elements · {row.matched} matched</span>
            <strong>{row.missing} missing · {row.extra} extra · {row.triageTasks} triage tasks</strong>
          </div>
        ))}
        <button
          className="pdf-lab-prod-secondary"
          data-qid="pdf-lab:production:bulk-rerun"
          data-qs-action="PDF_LAB_PRODUCTION_BULK_REPAIR_RERUN"
          title="Repair systemic settings and rerun the deterministic extraction pass"
          onClick={onBulkRerun}
          disabled={actionBusy !== null}
        >
          {actionBusy === 'Bulk Repair / Re-run' ? 'Running pdf_oxide…' : 'Bulk Repair / Re-run'}
        </button>
      </aside>

      <section className="pdf-lab-prod-pane pdf-lab-prod-compare">
        <PaneHeader
          title="Parity Audit"
          detail={comparison
            ? `${comparison.matched_expected_elements}/${comparison.total_expected_elements} matched · ${(comparison.accuracy * 100).toFixed(2)}% parity`
            : 'Comparison artifact unavailable; no parity rows rendered'}
        />
        {comparison && (
          <div className={`pdf-lab-prod-artifact-gap ${comparison.passed ? 'success' : 'warn'}`}>
            <b>Real comparison artifact mounted</b>
            <p>
              <code>{manifest.source_comparison}</code> {comparison.passed ? 'passed' : 'failed'} target {(comparison.target * 100).toFixed(0)}%
              {' '}with {comparison.unmatched_expected_elements} missing expected and {comparison.unmatched_actual_elements} unmatched actual elements.
            </p>
          </div>
        )}
        {!comparison && (
          <div className="pdf-lab-prod-artifact-gap">
            <b>Comparison artifact not mounted</b>
            <p>The UI attempted to load <code>{COMPARISON_URL}</code>. Regenerate or publish <code>comparison.json</code> before using this stage.</p>
          </div>
        )}
        <div className="pdf-lab-prod-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Element</th>
                <th>Page</th>
                <th>Expected</th>
                <th>Actual</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map(row => (
                <tr key={`${row.status}:${row.id}`}>
                  <td><code title={row.detail}>{row.id}</code></td>
                  <td>{row.page}</td>
                  <td>{row.expected}</td>
                  <td>{row.actual}</td>
                  <td><span className={`pdf-lab-prod-parity ${row.status}`}>{row.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <aside className="pdf-lab-prod-pane pdf-lab-prod-output">
        <PaneHeader title="Triage Output" detail="Only unresolved mismatches become human cards" />
        <div className={`pdf-lab-prod-output-card ${comparison?.passed ? 'success' : 'warn'}`}>
          <b>{comparison ? `${comparison.matched_expected_elements} elements matched` : `${autoForwardCount} pages auto-forwarded`}</b>
          <p>
            {comparison
              ? `Parity audit ${comparison.passed ? 'passed' : 'failed'} at ${(comparison.accuracy * 100).toFixed(2)}% against the ${(comparison.target * 100).toFixed(0)}% gate.`
              : manifest.gate.summary}
          </p>
        </div>
        <div className="pdf-lab-prod-output-card warn">
          <b>{triage.task_count} human cards</b>
          <p>{triage.summary.tasks_by_severity.high ?? 0} high · {triage.summary.tasks_by_severity.medium ?? 0} medium · {triage.summary.pages_with_tasks} pages.</p>
        </div>
        <button
          className="pdf-lab-prod-primary"
          data-qid="pdf-lab:production:eject-triage"
          data-qs-action="PDF_LAB_PRODUCTION_EJECT_MISMATCHES_TO_TRIAGE"
          title="Create human triage cards only for unresolved mismatches"
          onClick={onEject}
          disabled={actionBusy !== null}
        >
          {actionBusy === 'Eject Mismatches to Triage' ? 'Generating triage…' : 'Eject Mismatches to Triage →'}
        </button>
      </aside>
    </main>
  )
}

function CoverageStatusPane({
  comparison,
  manifest,
  statusReport,
  triage,
}: {
  comparison: JsonComparison | null
  manifest: WorkflowManifest
  statusReport: PdfLabStatusReport | null
  triage: TriageQueue
}) {
  const summary = statusReport?.summary
  const blockers = statusReport?.blockers ?? []
  const artifactRows = Object.entries(statusReport?.artifact_paths ?? {})
  const agentResolvedKinds = statusReport?.summary.agent_resolved_kinds ?? triage.agent_resolved_summary?.findings_by_kind ?? {}
  const parityAccuracy = summary?.parity_accuracy ?? comparison?.accuracy ?? null
  const parityTarget = summary?.parity_target ?? comparison?.target ?? null
  const parityPassed = summary?.parity_passed ?? comparison?.passed ?? false
  const evidenceCount = summary?.evidence_element_count ?? 0
  const extractionCount = summary?.extraction_element_count ?? manifest.element_summary.total_elements ?? 0
  const coreChanged = summary?.core_pdf_oxide_changed ?? manifest.extraction_improvement?.core_pdf_oxide_changed ?? false
  const presetImproved = summary?.preset_improved_pdf_oxide_behavior ?? manifest.extraction_improvement?.preset_improved_pdf_oxide_behavior ?? false
  const humanTriageCount = summary?.human_triage_task_count ?? triage.task_count
  const agentResolvedCount = summary?.agent_resolved_count ?? triage.agent_resolved_summary?.finding_count ?? 0
  const memoryPassed = summary?.memory_qa_passed ?? false
  const memoryImplemented = summary?.memory_qa_implemented ?? false
  const memoryTextIndexed = summary?.memory_text_indexed_elements ?? 0
  const memoryVisualIndexed = summary?.memory_visual_indexed_elements ?? 0
  const memoryMetricValue = memoryPassed ? 'passed' : memoryImplemented ? 'blocked' : 'missing'
  const memoryQaTitle = memoryPassed
    ? 'Memory/Qdrant PDF-element recall QA passed'
    : memoryImplemented
      ? 'Memory/Qdrant PDF-element recall QA ran but is blocked'
      : 'Memory/Qdrant PDF-element recall QA is not implemented for this run'
  const troubleReport = statusReport?.trouble_report
  const troubleRows = [
    ...Object.entries(troubleReport?.agent_resolved_by_kind ?? {}).map(([kind, count]) => ({ source: 'agent second pass', kind, count })),
    ...Object.entries(troubleReport?.missed_expected_by_type ?? {}).map(([kind, count]) => ({ source: 'missed expected', kind, count })),
    ...Object.entries(troubleReport?.unmatched_actual_sample_by_type ?? {}).map(([kind, count]) => ({ source: 'unmatched actual sample', kind, count })),
  ].sort((left, right) => right.count - left.count)
  const humanSummaryTitle = humanTriageCount > 0
    ? `${humanTriageCount} human triage card${humanTriageCount === 1 ? '' : 's'} need resolution`
    : 'No human triage cards need resolution'
  const humanSummaryDetail = humanTriageCount > 0
    ? 'Open Surgical Triage and resolve the remaining ambiguity cards before claiming the workflow is complete.'
    : 'The agent second pass cleared the human deck. Human review should focus on status blockers, evidence QA coverage, and whether agent-resolved patterns need deterministic fixes.'

  return (
    <main className="pdf-lab-prod-coverage">
      <section className="pdf-lab-prod-coverage-hero">
        <div>
          <span className="pdf-lab-prod-coverage-kicker">Artifact-derived status</span>
          <h1>PDF Lab Coverage / Outstanding Work</h1>
          <p>
            This page is backed by the generated <code>pdf-lab-status-report.json</code>.
            If a gate is not proven by artifacts, it remains open here.
          </p>
        </div>
        <div className="pdf-lab-prod-coverage-status">
          <b>{blockers.length === 0 ? 'No open blockers' : `${blockers.length} blocker${blockers.length === 1 ? '' : 's'}`}</b>
          <span>{statusReport ? `Generated ${new Date(statusReport.generated_at).toLocaleString()}` : 'Status report artifact missing'}</span>
        </div>
      </section>

      <section className={`pdf-lab-prod-human-summary ${humanTriageCount > 0 ? 'needs-human' : 'no-human'}`}>
        <div>
          <span>Human Action Summary</span>
          <h2>{humanSummaryTitle}</h2>
          <p>{humanSummaryDetail}</p>
        </div>
        <div className="pdf-lab-prod-human-summary-metrics">
          <div>
            <b>{humanTriageCount}</b>
            <small>human cards</small>
          </div>
          <div>
            <b>{agentResolvedCount}</b>
            <small>agent-resolved</small>
          </div>
          <div>
            <b>{blockers.length}</b>
            <small>status blockers</small>
          </div>
        </div>
      </section>

      <section className={`pdf-lab-prod-final-qa ${memoryPassed ? 'ready' : 'blocked'}`}>
        <div>
          <span>Final Agent QA Gate</span>
          <h2>{memoryQaTitle}</h2>
          <p>
            Final verification should store extracted elements, element crops, page images, second-pass notes, and provenance in ArangoDB memory;
            index text and multimodal embeddings; then run stratified checks such as “what is the extracted table on page 47, and does the crop match the JSON?”
          </p>
        </div>
        <div className="pdf-lab-prod-final-qa-metric">
          <b>{memoryTextIndexed.toLocaleString()} / {memoryVisualIndexed.toLocaleString()}</b>
          <small>text / visual indexed</small>
        </div>
      </section>

      <section className="pdf-lab-prod-coverage-grid">
        <StatusMetric label="Parity Gate" value={parityAccuracy === null ? '—' : `${(parityAccuracy * 100).toFixed(2)}%`} detail={parityTarget === null ? 'target unknown' : `target ${(parityTarget * 100).toFixed(0)}%`} state={parityPassed ? 'ok' : 'bad'} />
        <StatusMetric label="Human Triage Cards" value={String(summary?.human_triage_task_count ?? triage.task_count)} detail="humans only see unresolved ambiguity" state={(summary?.human_triage_task_count ?? triage.task_count) === 0 ? 'ok' : 'bad'} />
        <StatusMetric label="Agent-Resolved Findings" value={String(summary?.agent_resolved_count ?? triage.agent_resolved_summary?.finding_count ?? 0)} detail="engineering backlog, not human work" state={(summary?.agent_resolved_count ?? 0) > 0 ? 'warn' : 'ok'} />
        <StatusMetric label="Evidence Crop Coverage" value={`${evidenceCount.toLocaleString()} / ${extractionCount.toLocaleString()}`} detail="sample-only until full coverage" state={evidenceCount >= extractionCount && extractionCount > 0 ? 'ok' : 'warn'} />
        <StatusMetric label="Core Rust Changed" value={String(coreChanged)} detail="do not claim parser repair unless true" state={coreChanged ? 'ok' : 'warn'} />
        <StatusMetric label="NIST Preset Improved" value={String(presetImproved)} detail="document-family improvement is valid for NIST-like PDFs" state={presetImproved ? 'ok' : 'warn'} />
        <StatusMetric label="Memory/Qdrant QA" value={memoryMetricValue} detail="final PDF page ↔ JSON ↔ memory recall gate" state={memoryPassed ? 'ok' : 'bad'} />
      </section>

      <section className="pdf-lab-prod-coverage-columns">
        <div className="pdf-lab-prod-coverage-panel">
          <PaneHeader title="Outstanding / Broken" detail="Current blockers derived from artifacts" />
          {blockers.length === 0 ? (
            <div className="pdf-lab-prod-coverage-empty">No blockers reported by the status artifact.</div>
          ) : (
            <div className="pdf-lab-prod-blocker-list">
              {blockers.map(blocker => (
                <article key={`${blocker.area}:${blocker.detail}`} className={`pdf-lab-prod-blocker ${blocker.severity}`}>
                  <div>
                    <b>{blocker.area}</b>
                    <span>{blocker.severity}</span>
                  </div>
                  <p>{blocker.detail}</p>
                  <small>{blocker.next_action}</small>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="pdf-lab-prod-coverage-panel">
          <PaneHeader title="Second-Pass Findings" detail="What the agent resolved before human handoff" />
          <div className="pdf-lab-prod-kind-list">
            {Object.entries(agentResolvedKinds).length === 0 ? (
              <div className="pdf-lab-prod-coverage-empty">No agent-resolved findings recorded.</div>
            ) : (
              Object.entries(agentResolvedKinds).map(([kind, count]) => (
                <div key={kind}>
                  <code>{kind}</code>
                  <b>{count}</b>
                </div>
              ))
            )}
          </div>
          <p className="pdf-lab-prod-coverage-note">
            These are exactly the items that should become deterministic preset/core fixes, not recurring human triage cards.
          </p>
        </div>

        <div className="pdf-lab-prod-coverage-panel">
          <PaneHeader title="Trouble Report" detail="Element classes pdf_oxide/agent struggled to extract accurately" />
          <div className="pdf-lab-prod-trouble-list">
            {troubleRows.length === 0 ? (
              <div className="pdf-lab-prod-coverage-empty">No trouble report data in the status artifact.</div>
            ) : (
              troubleRows.map(row => (
                <div key={`${row.source}:${row.kind}`}>
                  <span>{row.source}</span>
                  <code>{row.kind}</code>
                  <b>{row.count}</b>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="pdf-lab-prod-coverage-panel pdf-lab-prod-artifacts-panel">
          <PaneHeader title="Artifacts" detail="Files that prove or block the workflow state" />
          <div className="pdf-lab-prod-artifact-list">
            {artifactRows.length === 0 ? (
              <div className="pdf-lab-prod-coverage-empty">Status artifact did not include artifact paths.</div>
            ) : (
              artifactRows.map(([name, info]) => (
                <div key={name}>
                  <b>{name}</b>
                  <span className={info.exists ? 'ok' : 'bad'}>{info.exists ? 'present' : 'missing'}</span>
                  <code title={info.path ?? 'not configured'}>{info.path ?? 'not configured'}</code>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <section className="pdf-lab-prod-coverage-rule">
        <b>Current interpretation</b>
        <p>{statusReport?.current_interpretation ?? 'Run pdf-lab status-report and publish pdf-lab-status-report.json before relying on this page for status.'}</p>
      </section>
    </main>
  )
}

function StatusMetric({
  detail,
  label,
  state,
  value,
}: {
  detail: string
  label: string
  state: 'bad' | 'ok' | 'warn'
  value: string
}) {
  return (
    <div className={`pdf-lab-prod-status-metric ${state}`}>
      <span>{label}</span>
      <b>{value}</b>
      <small>{detail}</small>
    </div>
  )
}

function PaneHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="pdf-lab-prod-pane-head">
      <h2>{title}</h2>
      <p>{detail}</p>
    </div>
  )
}

function TagList({ tags }: { tags: string[] }) {
  return (
    <div className="pdf-lab-prod-tags">
      {tags.map(tag => <span key={tag}>{tag}</span>)}
    </div>
  )
}

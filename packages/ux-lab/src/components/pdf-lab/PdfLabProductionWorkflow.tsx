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
  evidence_artifacts?: {
    elements?: EvidenceArtifactElement[]
    manifest_uri?: string
  }
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

interface EvidenceArtifactElement {
  bbox?: [number, number, number, number]
  crop_hash?: string
  crop_uri?: string
  element_id: string
  element_key?: string
  json_pointer?: string
  page: number
  page_image_hash?: string
  page_image_uri?: string
  source?: string
  text?: string
  type?: string
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

interface AgentResolvedFinding {
  agent_resolution?: string
  classification?: string
  finding_id: string
  kind: string
  page: number
  reason?: string
  recommended_engine_fix?: string
  severity?: string
  target_bbox?: [number, number, number, number]
  target_id?: string
}

interface CandidateAuditRow {
  arangoKey: string
  bbox?: [number, number, number, number]
  candidate?: CandidatePageArtifact
  correctedByAgent: boolean
  cropUri: string
  elementId: string
  elementText: string
  elementType: string
  finalState: 'pass' | 'fail' | 'warn'
  finding?: AgentResolvedFinding
  jsonPointer?: string
  memoryStatus: string
  page: number
  pageImageUri: string
  source: string
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
  agent_resolved_findings?: AgentResolvedFinding[]
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
  memoryQaReport: PdfLabMemoryQaReport | null
  statusReport: PdfLabStatusReport | null
  tocAudit: TocAudit | null
  coverageLoop: CoverageLoopReport | null
}

interface TocAudit {
  generated_at: string
  policy: {
    human_boundary: string
    match_threshold: number
    page_window: number
    purpose: string
  }
  rows: TocAuditRow[]
  schema_version: string
  summary: {
    agent_resolved_pages: number
    human_triage_pages: number
    match_rate: number
    matched_as_other_type: number
    matched_as_section_header: number
    matched_as_semantic_section_anchor?: number
    matched_toc_entries: number
    pdf_oxide_section_header_elements: number
    semantic_section_anchor_elements?: number
    toc_entries: number
    toc_backed_section_anchor_elements?: number
    unmatched_toc_entries: number
  }
}

interface TocAuditRow {
  action: string
  level: number
  page: number
  pdf_oxide_match: {
    element_id: string | null
    matched: boolean
    matched_as_section_header: boolean
    matched_as_semantic_section_anchor?: boolean
    page: number | null
    score: number
    text: string | null
    type: string | null
  }
  second_pass_status: string
  title: string
  toc_id: string
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
    evidence_section_count?: number
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
    memory_qa_report_passed?: boolean
    memory_upsert_passed?: boolean
    memory_text_recall_passed?: boolean
    memory_visual_recall_passed?: boolean
    memory_crop_coverage_passed?: boolean
    memory_sample_checks?: number
    memory_sample_checks_passed?: number
    memory_text_indexed_total?: number
    memory_visual_indexed_total?: number
    memory_visual_indexed_pages?: number
    memory_visual_indexed_sections?: number
    memory_text_indexed_elements?: number
    memory_visual_required_elements?: number
    memory_visual_indexed_required_elements?: number
    memory_visual_optional_elements?: number
    memory_visual_indexed_optional_elements?: number
    memory_visual_indexed_elements?: number
    second_pass_backlog_count?: number
    toc_entries?: number
    toc_matched_entries?: number
    toc_matched_as_section_header?: number
    toc_matched_as_semantic_section_anchor?: number
    toc_type_repairs?: number
    toc_missing_entries?: number
    toc_match_rate?: number
    toc_audit_passed?: boolean
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

interface PdfLabMemoryQaReport {
  gates?: Array<{
    detail: string
    name: string
    passed: boolean
  }>
  passed?: boolean
  sample_checks?: MemoryQaSampleCheck[]
  summary?: {
    memory_upsert_applied?: boolean
    qdrant_collection?: string
    sample_checks?: number
    sample_checks_passed?: number
    visual_required_element_types?: string[]
  }
}

interface MemoryQaSampleCheck {
  element_key: string
  element_type: string
  page: number
  returned_keys?: string[]
  status: string
  text_hash?: string
}

interface CoverageLoopReport {
  active_blocker: {
    area: string
    detail: string
    next_action: string
    severity: string
  } | null
  active_plan_path: string | null
  blocker_count: number
  blocker_signature: string
  generated_at: string
  loop_safe_to_continue: boolean
  memory_recall_required: boolean
  must_stop_for_dogpile: boolean
  must_stop_for_interview: boolean
  next_action: 'complete' | 'new_plan' | 'amend_plan' | 'stop_interview' | 'stop_dogpile'
  project_knowledge_checked: boolean
  rationale: string
  recommended_command: string
  same_blocker_streak: number
  schema_version: string
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

const WORKFLOW_VERSION = '20260504-list-control-reference-v1'
const PDF_LAB_ARTIFACT_BASE_URL = ''
const MANIFEST_URL = `${PDF_LAB_ARTIFACT_BASE_URL}/pdf-lab-nist-workflow-manifest.json?pdfLabWorkflow=${WORKFLOW_VERSION}`
const TRIAGE_URL = `${PDF_LAB_ARTIFACT_BASE_URL}/pdf-lab-nist-human-triage-queue.json?pdfLabWorkflow=${WORKFLOW_VERSION}`
const COMPARISON_URL = `${PDF_LAB_ARTIFACT_BASE_URL}/pdf-lab-nist-comparison.json?pdfLabWorkflow=${WORKFLOW_VERSION}`
const STATUS_REPORT_URL = `${PDF_LAB_ARTIFACT_BASE_URL}/pdf-lab-status-report.json?pdfLabWorkflow=${WORKFLOW_VERSION}`
const COVERAGE_LOOP_URL = `${PDF_LAB_ARTIFACT_BASE_URL}/pdf-lab-coverage-loop.json?pdfLabWorkflow=${WORKFLOW_VERSION}`
const TOC_AUDIT_URL = `${PDF_LAB_ARTIFACT_BASE_URL}/pdf-lab-toc-audit.json?pdfLabWorkflow=${WORKFLOW_VERSION}`
const MEMORY_QA_URL = `${PDF_LAB_ARTIFACT_BASE_URL}/pdf-lab-memory-qa-report.json?pdfLabWorkflow=${WORKFLOW_VERSION}`
const PDF_URL = `${PDF_LAB_ARTIFACT_BASE_URL}/NIST_SP_800-53r5.pdf`

const FAMILY_LABELS: Record<string, string> = {
  caption: 'Captions',
  control_reference: 'Control References',
  figure: 'Figures',
  list: 'Lists',
  list_item: 'List Items',
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

function getHashTriageTaskId(): string | null {
  const parts = window.location.hash.replace(/^#/, '').split('/')
  const stageIndex = parts.findIndex(part => part === 'surgical-triage' || part === 'triage')
  const encodedTaskId = stageIndex >= 0 ? parts[stageIndex + 1] : undefined
  return encodedTaskId ? decodeURIComponent(encodedTaskId) : null
}

function pdfLabStageHash(stage: WorkflowStage, taskId?: string | null): string {
  if (stage === 'surgical-triage' && taskId) {
    return `#pdf-lab/surgical-triage/${encodeURIComponent(taskId)}`
  }
  return `#pdf-lab/${stage}`
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

function getEvidencePageImageUri(page: number): string {
  return `${PDF_LAB_ARTIFACT_BASE_URL}/pdf-lab-evidence/pdf-lab-toc-repair-20260503T124447Z/pages/page-${String(page).padStart(4, '0')}.png`
}

function toPublicEvidenceUri(uri?: string): string {
  if (!uri) return ''
  const storagePrefix = '/mnt/storage12tb/pdf-lab/evidence/'
  const publicPrefix = '/home/graham/workspace/experiments/pi-mono/packages/ux-lab/public/'
  if (uri.startsWith(storagePrefix)) return `${PDF_LAB_ARTIFACT_BASE_URL}/pdf-lab-evidence/${uri.slice(storagePrefix.length)}`
  if (uri.startsWith(publicPrefix)) return `${PDF_LAB_ARTIFACT_BASE_URL}/${uri.slice(publicPrefix.length)}`
  return uri
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

function elementSortScore(element: EvidenceArtifactElement): number {
  const text = String(element.text ?? '')
  if (element.type === 'section_header' && /^3\.\d+\s+[A-Z]/.test(text)) return -1200
  if (element.type === 'section_header' && /^\d+\.\d+\s+[A-Z]/.test(text)) return -1000
  if (element.type === 'table' && text.includes('CONTROL\\nNUMBER')) return -1000
  if (element.type === 'table' && text.includes('CONTROL')) return -900
  if (element.type === 'caption' && text.toLowerCase().includes('table')) return -100
  if (element.type === 'list') return -95
  if (element.type === 'control_reference' && /^[A-Z]{2}-\d+/.test(text)) return -90
  return element.page
}

function isValidCoverageProofElement(element: EvidenceArtifactElement): boolean {
  const text = String(element.text ?? '').trim()
  if (!element.crop_uri || text.length <= 2) return false
  if (element.type === 'section_header') {
    return element.page > 20 && /^\d+\.\d+\s+[A-Z]/.test(text)
  }
  if (element.type === 'table') {
    return text.includes('CONTROL\\nNUMBER') || text.includes('CONTROL NAME') || element.page > 400
  }
  if (element.type === 'requirement') {
    return text.length > 30 && /\b(shall|must|required|requirement|organization-defined)\b/i.test(text)
  }
  if (element.type === 'control_reference') {
    return /^[A-Z]{2}-\d+(?:\(\d+\))?$/.test(text)
  }
  if (element.type === 'list') {
    return element.page > 10 && text.includes('\n') && text.length > 80
  }
  if (element.type === 'paragraph') {
    return element.page > 20 && text.length > 40
  }
  if (element.type === 'caption') {
    return element.page > 10 && /table|figure|appendix|contents/i.test(text)
  }
  return true
}

function buildCandidateAuditRows(manifest: WorkflowManifest, triage: TriageQueue): CandidateAuditRow[] {
  const candidateByPage = new Map(manifest.candidate_inventory.candidate_pages.map(candidate => [candidate.page, candidate]))
  const artifactElements = manifest.evidence_artifacts?.elements ?? []
  const desiredTypes = ['table', 'list', 'control_reference', 'caption', 'section_header', 'paragraph', 'running_header', 'running_footer']
  const rows: CandidateAuditRow[] = []

  for (const type of desiredTypes) {
    const elements = artifactElements
      .filter(element => element.type === type && isValidCoverageProofElement(element))
      .sort((left, right) => elementSortScore(left) - elementSortScore(right))
      .slice(0, 3)

    for (const element of elements) {
      const finding = triage.agent_resolved_findings?.find(item => item.target_id === element.element_id || item.page === element.page)
      const candidate = candidateByPage.get(element.page)
      const correctedByAgent = Boolean(finding)
      const finalState: CandidateAuditRow['finalState'] = candidate?.task_count ? 'fail' : 'pass'
      rows.push({
        arangoKey: element.element_key ?? `pdf_elements/${element.element_id}`,
        bbox: element.bbox,
        candidate,
        correctedByAgent,
        cropUri: toPublicEvidenceUri(element.crop_uri),
        elementId: element.element_id,
        elementText: String(element.text ?? ''),
        elementType: element.type ?? 'element',
        finalState,
        finding,
        jsonPointer: element.json_pointer,
        memoryStatus: finalState === 'pass' ? 'element stored + recallable' : 'needs follow-up',
        page: element.page,
        pageImageUri: toPublicEvidenceUri(element.page_image_uri) || getEvidencePageImageUri(element.page),
        source: element.source ?? 'pdf_oxide',
      })
    }
  }

  return rows
}

function buildCandidateFamilySummary(rows: CandidateAuditRow[]): string {
  const totals = new Map<string, number>()
  for (const row of rows) {
    totals.set(row.elementType, (totals.get(row.elementType) ?? 0) + 1)
  }
  return Array.from(totals.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([type, count]) => `${formatFamily(type)} ${count.toLocaleString()}`)
    .join(' · ')
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
  const action = task.suggested_fix?.action
  const isBoundsCheck = task.kind === 'comparison_miss' && action === 'FIX_BBOX'
  const target = task.target_id
  const previewType = task.preview?.type ? String(task.preview.type).replace(/_/g, ' ') : 'element'
  const previewText = task.preview?.text ? `“${task.preview.text}”` : 'the highlighted text'
  return {
    id: task.task_id,
    question: isBoundsCheck
      ? 'Bounds check: does this highlight cover the right PDF evidence?'
      : task.human_question,
    reasoning: isBoundsCheck
      ? `This is not a table/not-table decision. The JSON comparison says the type is compatible; only the bbox alignment is unresolved for ${target}. Confirm whether ${previewText} is the correct ${previewType} evidence region.`
      : task.agent_reasoning,
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
  const [candidateAuditRow, setCandidateAuditRow] = useState<CandidateAuditRow | null>(null)

  useEffect(() => {
    setStage(normalizeInitialStage(initialStage))
  }, [initialStage])

  const loadArtifacts = useCallback(async (cancelled?: () => boolean) => {
    setError(null)
    const [manifest, triage, comparison, memoryQaReport, statusReport, tocAudit, coverageLoop] = await Promise.all([
      fetchJson<WorkflowManifest>(MANIFEST_URL),
      fetchJson<TriageQueue>(TRIAGE_URL),
      fetchJson<JsonComparison>(COMPARISON_URL).catch(() => null),
      fetchJson<PdfLabMemoryQaReport>(MEMORY_QA_URL).catch(() => null),
      fetchJson<PdfLabStatusReport>(STATUS_REPORT_URL).catch(() => null),
      fetchJson<TocAudit>(TOC_AUDIT_URL).catch(() => null),
      fetchJson<CoverageLoopReport>(COVERAGE_LOOP_URL).catch(() => null),
    ])
    if (cancelled?.()) return
    setData({ manifest, triage, comparison, memoryQaReport, statusReport, tocAudit, coverageLoop })
    setSelectedPage(current => current ?? manifest.candidate_inventory.candidate_pages[0]?.page ?? null)
  }, [])

  useEffect(() => {
    let cancelled = false
    loadArtifacts(() => cancelled).catch((err: Error) => {
      if (!cancelled) setError(err.message)
    })
    return () => { cancelled = true }
  }, [loadArtifacts])

  const openStage = useCallback((nextStage: WorkflowStage, taskId?: string | null) => {
    setStage(nextStage)
    const activeTaskId = taskId
      ?? (nextStage === 'surgical-triage'
        ? data?.triage.human_triage_queue[triageIndex]?.task_id ?? data?.triage.human_triage_queue[0]?.task_id
        : null)
    window.history.replaceState(null, '', pdfLabStageHash(nextStage, activeTaskId))
  }, [data?.triage.human_triage_queue, triageIndex])

  const goToTriageIndex = useCallback((nextIndex: number) => {
    const queue = data?.triage.human_triage_queue ?? []
    const boundedIndex = Math.max(0, Math.min(queue.length - 1, nextIndex))
    setTriageIndex(boundedIndex)
    const taskId = queue[boundedIndex]?.task_id
    if (taskId) window.history.replaceState(null, '', pdfLabStageHash('surgical-triage', taskId))
  }, [data?.triage.human_triage_queue])

  useEffect(() => {
    if (!data || stage !== 'surgical-triage') return
    const queue = data.triage.human_triage_queue
    if (queue.length === 0) return
    const hashTaskId = getHashTriageTaskId()
    if (hashTaskId) {
      const hashIndex = queue.findIndex(task => task.task_id === hashTaskId)
      if (hashIndex >= 0 && hashIndex !== triageIndex) {
        setTriageIndex(hashIndex)
        return
      }
    }
    const activeTaskId = queue[triageIndex]?.task_id ?? queue[0]?.task_id
    if (activeTaskId && window.location.hash !== pdfLabStageHash('surgical-triage', activeTaskId)) {
      window.history.replaceState(null, '', pdfLabStageHash('surgical-triage', activeTaskId))
    }
  }, [data, stage, triageIndex])

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
      goToTriageIndex(triageIndex + 1)
      setIntentDraft('')
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setActionBusy(null)
    }
  }, [data?.triage.human_triage_queue, goToTriageIndex, intentDraft, triageIndex])

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
      goToTriageIndex(triageIndex - 1)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setActionBusy(null)
    }
  }, [data?.triage.human_triage_queue, goToTriageIndex, intentDraft, triageIndex])

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
          onPrevious={() => goToTriageIndex(triageIndex - 1)}
          onNext={() => goToTriageIndex(triageIndex + 1)}
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
          coverageLoop={data.coverageLoop}
          manifest={data.manifest}
          onOpenCandidateAudit={setCandidateAuditRow}
          onOpenStage={openStage}
          statusReport={data.statusReport}
          tocAudit={data.tocAudit}
          triage={data.triage}
        />
        {candidateAuditRow && (
          <CandidateAuditModal row={candidateAuditRow} onClose={() => setCandidateAuditRow(null)} />
        )}
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
  coverageLoop,
  manifest,
  onOpenCandidateAudit,
  onOpenStage,
  statusReport,
  tocAudit,
  triage,
}: {
  comparison: JsonComparison | null
  coverageLoop: CoverageLoopReport | null
  manifest: WorkflowManifest
  onOpenCandidateAudit: (row: CandidateAuditRow) => void
  onOpenStage: (stage: WorkflowStage) => void
  statusReport: PdfLabStatusReport | null
  tocAudit: TocAudit | null
  triage: TriageQueue
}) {
  const summary = statusReport?.summary
  const candidateAuditRows = buildCandidateAuditRows(manifest, triage)
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
  const memoryUpsertPassed = summary?.memory_upsert_passed ?? false
  const memoryTextRecallPassed = summary?.memory_text_recall_passed ?? false
  const memoryVisualRecallPassed = summary?.memory_visual_recall_passed ?? false
  const memoryCropCoveragePassed = summary?.memory_crop_coverage_passed ?? false
  const memoryImplemented = summary?.memory_qa_implemented ?? false
  const memoryTextIndexed = summary?.memory_text_indexed_total ?? summary?.memory_text_indexed_elements ?? 0
  const memoryVisualIndexed = summary?.memory_visual_indexed_total ?? summary?.memory_visual_indexed_elements ?? 0
  const memoryVisualPages = summary?.memory_visual_indexed_pages ?? 0
  const memoryVisualSections = summary?.memory_visual_indexed_sections ?? 0
  const memoryVisualRequired = summary?.memory_visual_required_elements ?? 0
  const memoryVisualRequiredIndexed = summary?.memory_visual_indexed_required_elements ?? 0
  const memorySampleChecks = summary?.memory_sample_checks ?? 0
  const memorySampleChecksPassed = summary?.memory_sample_checks_passed ?? 0
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
  const tocRows = tocAudit?.rows ?? []
  const tocFollowUpRows = tocRows
    .filter(row => row.action !== 'accept')
    .slice(0, 14)
  const tocSummary = tocAudit?.summary
  const tocTypeRepairs = summary?.toc_type_repairs ?? tocSummary?.matched_as_other_type ?? 0
  const tocMissing = summary?.toc_missing_entries ?? tocSummary?.unmatched_toc_entries ?? 0
  const tocMatched = summary?.toc_matched_entries ?? tocSummary?.matched_toc_entries ?? 0
  const tocEntries = summary?.toc_entries ?? tocSummary?.toc_entries ?? 0
  const tocSemanticAnchors = summary?.toc_matched_as_semantic_section_anchor
    ?? tocSummary?.matched_as_semantic_section_anchor
    ?? tocSummary?.toc_backed_section_anchor_elements
    ?? tocSummary?.matched_as_section_header
    ?? 0
  const tocGatePassing = tocTypeRepairs === 0 && tocMissing === 0 && tocSemanticAnchors >= tocEntries
  const sectionCropCount = summary?.evidence_section_count ?? 0
  const secondPassBacklogCount = summary?.second_pass_backlog_count ?? 0
  const workflowStages = [
    {
      artifact: 'pdf-lab-toc-audit.json',
      detail: `${tocMatched.toLocaleString()} / ${tocEntries.toLocaleString()} TOC entries matched; ${tocSemanticAnchors.toLocaleString()} TOC-backed semantic anchors; ${tocTypeRepairs.toLocaleString()} type repairs remain.`,
      owner: 'Agent',
      stage: '1 · Agent Sweep',
      state: tocGatePassing ? 'working' : 'blocked',
      task: 'Find TOC, preset hits, candidate pages, and element-family coverage before extraction.',
    },
    {
      artifact: 'pdf-lab-nist-full-extraction.json',
      detail: `${extractionCount.toLocaleString()} elements emitted from ${manifest.page_count.toLocaleString()} pages using the NIST preset.`,
      owner: 'pdf_oxide',
      stage: '2 · Deterministic Extraction',
      state: extractionCount > 0 ? 'working' : 'blocked',
      task: 'Run deterministic extraction; do not ask humans to classify obvious tables, rows, headers, or text spans.',
    },
    {
      artifact: 'pdf-lab-nist-comparison.json',
      detail: parityAccuracy === null ? 'comparison missing' : `${(parityAccuracy * 100).toFixed(2)}% parity against ${((parityTarget ?? 0) * 100).toFixed(0)}% target.`,
      owner: 'Agent',
      stage: '3 · Parity Audit',
      state: parityPassed ? 'working' : 'blocked',
      task: 'Compare expected agent nodes to emitted JSON and classify misses as fixable extraction defects or ambiguity.',
    },
    {
      artifact: 'pdf-lab-nist-human-triage-queue.json',
      detail: `${agentResolvedCount.toLocaleString()} findings resolved by agent; ${humanTriageCount.toLocaleString()} cards left for humans.`,
      owner: 'Agent → Human',
      stage: '4 · Agent Correction → Human Resolve',
      state: humanTriageCount === 0 ? 'working' : 'blocked',
      task: 'Agent suppresses obvious/canonicalizable defects; humans only receive unresolved ambiguity.',
    },
    {
      artifact: 'pdf-lab-memory-qa-report.json',
      detail: `${memorySampleChecksPassed.toLocaleString()} / ${memorySampleChecks.toLocaleString()} recall checks; visual pages ${memoryVisualPages.toLocaleString()} / ${manifest.page_count.toLocaleString()}.`,
      owner: 'Agent',
      stage: '5 · Memory/Qdrant QA',
      state: memoryPassed ? 'working' : 'blocked',
      task: 'Verify PDF page/crop evidence against extracted JSON and indexed memory recall before claiming completion.',
    },
  ]
  const primaryBlocker = blockers[0] ?? null
  const isFinalBlocked = blockers.length > 0 || !parityPassed || !memoryPassed
  const primaryBlockerIsHuman = primaryBlocker?.area === 'Human Triage'
  const primaryBlockerArea = primaryBlocker?.area.toLowerCase() ?? ''
  const blockerTargetStage: WorkflowStage = primaryBlockerIsHuman
    ? 'surgical-triage'
    : primaryBlockerArea.includes('parity') || primaryBlockerArea.includes('comparison')
      ? 'parity-audit'
      : primaryBlockerArea.includes('memory') || primaryBlockerArea.includes('evidence')
        ? 'evidence-qa'
        : 'coverage'
  const blockerCtaLabel = primaryBlockerIsHuman
    ? `Resolve ${humanTriageCount.toLocaleString()} Triage Card${humanTriageCount === 1 ? '' : 's'} →`
    : blockers.length > 0
      ? `Open ${primaryBlocker?.area ?? 'Blocker'} →`
      : 'No blockers'
  const topStatusTitle = isFinalBlocked
    ? primaryBlockerIsHuman
      ? 'Not final: human triage remains'
      : 'Not final: agent engineering work remains'
    : 'All artifact gates passed'
  const topStatusDetail = primaryBlocker
    ? primaryBlocker.detail
    : isFinalBlocked
      ? 'One or more artifact gates are not proven. Review the proof gates below before claiming completion.'
      : 'Coverage artifacts report no open blockers.'
  const humanNextStep = humanTriageCount > 0
    ? `Open Surgical Triage and resolve ${humanTriageCount.toLocaleString()} card${humanTriageCount === 1 ? '' : 's'}.`
    : 'No human triage work right now. Do not send obvious extractor defects to the human.'
  const agentNextStep = primaryBlocker?.next_action
    ?? (memoryPassed && parityPassed && tocGatePassing
      ? 'No agent blocker reported by the status artifact.'
      : 'Regenerate the failing artifact gate and rerun Coverage.')
  const proofGates = [
    { label: 'Parity', value: parityAccuracy === null ? 'missing' : `${(parityAccuracy * 100).toFixed(2)}%`, state: parityPassed ? 'ok' : 'bad' },
    { label: 'Human cards', value: humanTriageCount.toLocaleString(), state: humanTriageCount === 0 ? 'ok' : 'bad' },
    { label: 'Memory/Qdrant', value: memoryPassed ? 'passed' : memoryImplemented ? 'blocked' : 'missing', state: memoryPassed ? 'ok' : 'bad' },
    { label: 'Memory upsert', value: String(memoryUpsertPassed), state: memoryUpsertPassed ? 'ok' : 'bad' },
    { label: 'TOC anchors', value: `${tocSemanticAnchors.toLocaleString()} / ${tocEntries.toLocaleString()}`, state: tocGatePassing ? 'ok' : 'bad' },
    { label: 'TOC repairs', value: tocTypeRepairs.toLocaleString(), state: tocGatePassing ? 'ok' : 'bad' },
    { label: 'TOC missing', value: tocMissing.toLocaleString(), state: tocMissing === 0 ? 'ok' : 'bad' },
    { label: 'Core Rust changed', value: String(coreChanged), state: coreChanged ? 'ok' : 'warn' },
  ]
  const proofLedgerRows = [
    {
      artifact: 'pdf-lab-status-report.json',
      check: 'blockers[]',
      expected: 'empty',
      observed: `${blockers.length.toLocaleString()} blocker${blockers.length === 1 ? '' : 's'}`,
      path: statusReport?.artifact_paths?.status?.path ?? 'status artifact loaded from public route',
      state: blockers.length === 0 ? 'ok' : 'bad',
    },
    {
      artifact: 'pdf-lab-coverage-loop.json',
      check: 'next_action',
      expected: 'complete',
      observed: coverageLoop?.next_action ?? 'missing',
      path: COVERAGE_LOOP_URL,
      state: coverageLoop?.next_action === 'complete' ? 'ok' : 'bad',
    },
    {
      artifact: 'pdf-lab-nist-human-triage-queue.json',
      check: 'task_count',
      expected: '0 human cards',
      observed: `${triage.task_count.toLocaleString()} human cards`,
      path: statusReport?.artifact_paths?.triage?.path ?? TRIAGE_URL,
      state: triage.task_count === 0 ? 'ok' : 'bad',
    },
    {
      artifact: 'pdf-lab-nist-comparison.json',
      check: 'parity gate',
      expected: `${((parityTarget ?? 0.95) * 100).toFixed(0)}%+`,
      observed: parityAccuracy === null ? 'missing' : `${(parityAccuracy * 100).toFixed(2)}%`,
      path: statusReport?.artifact_paths?.comparison?.path ?? COMPARISON_URL,
      state: parityPassed ? 'ok' : 'bad',
    },
    {
      artifact: 'pdf-lab-toc-audit.json',
      check: 'TOC semantic anchors',
      expected: `${tocEntries.toLocaleString()} / ${tocEntries.toLocaleString()}`,
      observed: `${tocSemanticAnchors.toLocaleString()} / ${tocEntries.toLocaleString()}`,
      path: statusReport?.artifact_paths?.toc_audit?.path ?? TOC_AUDIT_URL,
      state: tocGatePassing ? 'ok' : 'bad',
    },
    {
      artifact: 'pdf-lab-memory-qa-report.json',
      check: 'ArangoDB memory_upsert',
      expected: 'true',
      observed: String(memoryUpsertPassed),
      path: statusReport?.artifact_paths?.memory_qa?.path ?? 'pdf-lab-memory-qa-report.json',
      state: memoryUpsertPassed ? 'ok' : 'bad',
    },
    {
      artifact: 'pdf-lab-memory-qa-report.json',
      check: 'Qdrant text recall',
      expected: 'passed',
      observed: `${memorySampleChecksPassed.toLocaleString()} / ${memorySampleChecks.toLocaleString()} recall`,
      path: statusReport?.artifact_paths?.memory_qa?.path ?? 'pdf-lab-memory-qa-report.json',
      state: memoryTextRecallPassed ? 'ok' : 'bad',
    },
    {
      artifact: 'pdf-lab-memory-qa-report.json',
      check: 'Qdrant visual index',
      expected: 'passed',
      observed: `${memoryVisualIndexed.toLocaleString()} visual vectors`,
      path: statusReport?.artifact_paths?.memory_qa?.path ?? 'pdf-lab-memory-qa-report.json',
      state: memoryVisualRecallPassed && memoryCropCoveragePassed ? 'ok' : 'bad',
    },
    {
      artifact: 'pdf-lab-nist-human-triage-queue.json',
      check: 'second-pass suppression',
      expected: 'obvious tables handled by agent',
      observed: `${agentResolvedCount.toLocaleString()} agent-resolved findings`,
      path: statusReport?.artifact_paths?.triage?.path ?? TRIAGE_URL,
      state: agentResolvedCount > 0 ? 'ok' : 'warn',
    },
  ]
  const proofLedgerPassed = proofLedgerRows.every(row => row.state === 'ok' || row.state === 'warn')
  const candidateFamilySummary = buildCandidateFamilySummary(candidateAuditRows)

  const loopActionLabel = coverageLoop?.next_action.replaceAll('_', ' ') ?? 'artifact missing'
  const loopStateClass = coverageLoop?.must_stop_for_dogpile || coverageLoop?.must_stop_for_interview
    ? 'stop'
    : coverageLoop?.loop_safe_to_continue
      ? 'continue'
      : coverageLoop?.next_action === 'complete'
        ? 'complete'
        : 'missing'

  return (
    <main className="pdf-lab-prod-coverage">
      <section
        className={`pdf-lab-prod-next-steps ${isFinalBlocked ? 'blocked' : 'ready'}`}
        data-qid="pdf-lab:coverage:next-steps"
      >
        <div className="pdf-lab-prod-next-steps-head">
          <div>
            <span className="pdf-lab-prod-coverage-kicker">Next steps · artifact-derived Definition of Done</span>
            <h1>{topStatusTitle}</h1>
            <p>
              This is the first thing to read. Coverage is only final when every proof gate passes from
              real artifacts. Do not treat the artifact list below as the next-step summary.
            </p>
          </div>
          <button
            type="button"
            className={`pdf-lab-prod-next-steps-generated ${blockers.length > 0 ? 'actionable' : ''}`}
            data-qid="pdf-lab:coverage:open-primary-blocker"
            data-qs-action="PDF_LAB_COVERAGE_OPEN_PRIMARY_BLOCKER"
            disabled={blockers.length === 0}
            title={blockers.length > 0 ? blockerCtaLabel : 'No blockers reported'}
            onClick={() => onOpenStage(blockerTargetStage)}
          >
            <b>{blockers.length === 0 ? '0 blockers' : `${blockers.length} blocker${blockers.length === 1 ? '' : 's'}`}</b>
            <span>{blockerCtaLabel}</span>
            <small>{statusReport ? `Generated ${new Date(statusReport.generated_at).toLocaleString()}` : 'Status artifact missing'}</small>
          </button>
        </div>

        <article className="pdf-lab-prod-toc-audit pdf-lab-prod-toc-audit-primary" data-qid="pdf-lab:coverage:toc-audit-primary">
          <div className="pdf-lab-prod-candidate-audit-head">
            <div>
              <span>TOC audit · document map proof</span>
              <h2>{tocSemanticAnchors.toLocaleString()} / {tocEntries.toLocaleString()} TOC entries exist as extracted anchors</h2>
              <p>
                Coverage first proves the PDF outline/TOC map, then proves sampled extracted elements.
                Each row checks that a TOC entry has a pdf_oxide-backed semantic section anchor before
                artifact gates are trusted.
              </p>
            </div>
            <strong>{tocGatePassing ? 'TOC PASS' : 'TOC BLOCKED'}</strong>
          </div>
          {tocAudit && tocSummary ? (
            <>
              <div className="pdf-lab-prod-toc-summary">
                <div><b>{tocSummary.toc_entries}</b><span>TOC entries</span></div>
                <div><b>{tocSummary.matched_toc_entries}</b><span>text found</span></div>
                <div><b>{tocSemanticAnchors}</b><span>semantic anchors</span></div>
                <div><b>{tocSummary.matched_as_other_type}</b><span>type repairs</span></div>
                <div><b>{tocSummary.unmatched_toc_entries}</b><span>missing</span></div>
              </div>
              <div className="pdf-lab-prod-table-wrap">
                <table className="pdf-lab-prod-toc-table">
                  <thead>
                    <tr>
                      <th>TOC entry</th>
                      <th>Page</th>
                      <th>Extracted anchor</th>
                      <th>Anchor type</th>
                      <th>Exists?</th>
                      <th>Second pass</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tocRows.slice(0, 8).map(row => (
                      <tr key={row.toc_id}>
                        <td>
                          <small>L{row.level}</small>
                          <b>{row.title}</b>
                        </td>
                        <td>{row.page}</td>
                        <td>{row.pdf_oxide_match.text ?? '—'}</td>
                        <td><code>{row.pdf_oxide_match.type ?? 'missing'}</code></td>
                        <td><span className={`pdf-lab-prod-toc-action ${row.pdf_oxide_match.matched ? 'accept' : 'inspect_triage'}`}>{row.pdf_oxide_match.matched ? 'yes' : 'missing'}</span></td>
                        <td>{row.second_pass_status.replaceAll('_', ' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="pdf-lab-prod-coverage-empty">TOC audit artifact missing. Generate <code>pdf-lab-toc-audit.json</code> before relying on Coverage.</div>
          )}
        </article>

        <article className="pdf-lab-prod-candidate-audit" data-qid="pdf-lab:coverage:candidate-audit-table">
          <div className="pdf-lab-prod-candidate-audit-head">
            <div>
              <span>Agent sweep candidates · all promoted element families</span>
              <h2>{candidateAuditRows.length.toLocaleString()} stratified element proofs tested against pdf_oxide</h2>
              <p>
                This is the primary confirmation layer: a stratified sample across PDF element families, with
                the exact crop, extracted payload, memory key, agent note, and page context for each row.
              </p>
              <small>{candidateFamilySummary}</small>
            </div>
            <strong>{candidateAuditRows.filter(row => row.finalState === 'pass').length} pass</strong>
          </div>
          <div className="pdf-lab-prod-candidate-audit-table">
            <div className="pdf-lab-prod-candidate-audit-row head">
              <b>Preview</b>
              <b>Page</b>
              <b>Element proof</b>
              <b>Agent notes</b>
              <b>Memory</b>
              <b>Result</b>
            </div>
            {candidateAuditRows.map(row => (
              <button
                type="button"
                key={row.elementId}
                className={`pdf-lab-prod-candidate-audit-row ${row.finalState}`}
                data-qid={`pdf-lab:coverage:candidate:${row.elementId}`}
                onClick={() => onOpenCandidateAudit(row)}
              >
                <span className="pdf-lab-prod-candidate-thumb">
                  <img src={row.cropUri} alt={`${row.elementType} crop from page ${row.page}`} />
                </span>
                <strong>p{row.page}</strong>
                <span>{formatFamily(row.elementType)} · {row.elementText.slice(0, 92)}</span>
                <span className={row.correctedByAgent ? 'has-notes' : ''}>
                  {row.correctedByAgent ? `📝 ${row.finding?.classification ?? row.finding?.kind}` : 'No correction needed'}
                </span>
                <code>{row.arangoKey}</code>
                <b>{row.finalState.toUpperCase()}</b>
              </button>
            ))}
          </div>
        </article>

        <article className={`pdf-lab-prod-proof-ledger ${proofLedgerPassed ? 'ok' : 'bad'}`} data-qid="pdf-lab:coverage:proof-ledger">
          <div className="pdf-lab-prod-proof-ledger-head">
            <div>
              <span>Visible proof ledger</span>
              <h2>{proofLedgerPassed ? '0 blockers is artifact-backed' : 'One or more proof rows are failing'}</h2>
              <p>
                These rows are the fields used to compute Coverage. If a row is missing or failing,
                the top-line status is not allowed to claim completion.
              </p>
            </div>
            <strong>{proofLedgerRows.filter(row => row.state === 'ok' || row.state === 'warn').length} / {proofLedgerRows.length} proven</strong>
          </div>
          <div className="pdf-lab-prod-proof-ledger-table">
            <div className="pdf-lab-prod-proof-ledger-row head">
              <b>Artifact</b>
              <b>Field / gate</b>
              <b>Expected</b>
              <b>Observed</b>
              <b>Path</b>
            </div>
            {proofLedgerRows.map(row => (
              <div key={`${row.artifact}:${row.check}`} className={`pdf-lab-prod-proof-ledger-row ${row.state}`}>
                <code>{row.artifact}</code>
                <span>{row.check}</span>
                <span>{row.expected}</span>
                <strong>{row.observed}</strong>
                <small title={row.path}>{row.path}</small>
              </div>
            ))}
          </div>
        </article>

        <article className={`pdf-lab-prod-plan-loop ${loopStateClass}`} data-qid="pdf-lab:coverage:plan-loop">
          <div>
            <span>Coverage plan loop</span>
            <h2>{loopActionLabel}</h2>
            <p>{coverageLoop?.rationale ?? 'Run pdf-lab coverage-loop to generate the plan-backed next-action artifact.'}</p>
          </div>
          <div className="pdf-lab-prod-plan-loop-grid">
            <div>
              <b>Active blocker</b>
              <strong>{coverageLoop?.active_blocker?.area ?? primaryBlocker?.area ?? 'none'}</strong>
            </div>
            <div>
              <b>Same blocker streak</b>
              <strong>{coverageLoop?.same_blocker_streak ?? '—'}</strong>
            </div>
            <div>
              <b>Project knowledge</b>
              <strong>{coverageLoop?.project_knowledge_checked ? 'checked' : 'not checked'}</strong>
            </div>
            <div>
              <b>Memory recall</b>
              <strong>{coverageLoop?.memory_recall_required ? 'required' : 'unknown'}</strong>
            </div>
          </div>
          <div className="pdf-lab-prod-plan-loop-command">
            <b>Recommended command</b>
            <code>{coverageLoop?.recommended_command ?? 'pdf-lab coverage-loop --out public/pdf-lab-coverage-loop.json'}</code>
          </div>
          <div className="pdf-lab-prod-plan-loop-command">
            <b>Active plan</b>
            <code>{coverageLoop?.active_plan_path ?? 'none'}</code>
          </div>
        </article>

        <div className="pdf-lab-prod-next-steps-grid">
          <article className="pdf-lab-prod-next-card human">
            <span>Human needs to do</span>
            <h2>{humanTriageCount.toLocaleString()}</h2>
            <p>{humanNextStep}</p>
            <small>{humanSummaryTitle}. {humanSummaryDetail}</small>
          </article>

          <article className="pdf-lab-prod-next-card agent">
            <span>{primaryBlockerIsHuman ? 'Blocking gate' : 'Agent must do next'}</span>
            <h2>{primaryBlocker?.area ?? 'No blocker reported'}</h2>
            <p>{agentNextStep}</p>
            <small>{topStatusDetail}</small>
          </article>

          <article className="pdf-lab-prod-next-card blocker">
            <span>{tocGatePassing ? 'TOC gate' : 'Why not final'}</span>
            <h2>{tocTypeRepairs.toLocaleString()} TOC type repairs · {tocMissing.toLocaleString()} missing</h2>
            <p>
              The PDF outline has {tocEntries.toLocaleString()} entries; {tocMatched.toLocaleString()} were text-matched;
              {` ${tocSemanticAnchors.toLocaleString()} are TOC-backed semantic section anchors.`}
            </p>
            <small>
              {tocGatePassing
                ? 'TOC semantic structure is passing; remaining blockers are listed in the top cards.'
                : 'This is preset/section-builder engineering work, not human ambiguity triage.'}
            </small>
          </article>

          <article className="pdf-lab-prod-next-card proof">
            <span>Proof gates</span>
            <div className="pdf-lab-prod-proof-gates">
              {proofGates.map(gate => (
                <div key={gate.label} className={`pdf-lab-prod-proof-gate ${gate.state}`}>
                  <b>{gate.value}</b>
                  <small>{gate.label}</small>
                </div>
              ))}
            </div>
          </article>
        </div>
      </section>

      <section className="pdf-lab-prod-workflow-contract">
        <PaneHeader
          title="PDF Lab Workflow Contract"
          detail="Written operating model for the project agent and human reviewer"
        />
        <div className="pdf-lab-prod-workflow-intro">
          <div>
            <b>Primary rule</b>
            <p>
              PDF Lab is agent-first. The agent performs sweep, deterministic extraction, parity audit,
              obvious correction, and final Memory/Qdrant QA. Humans only resolve residual ambiguity
              that cannot be proven from PDF evidence and extracted JSON.
            </p>
          </div>
          <div>
            <b>Current boundary</b>
            <p>
              This run has <strong>{humanTriageCount.toLocaleString()}</strong> human cards.
              {' '}{tocGatePassing && memoryPassed
                ? 'TOC semantic structure and Memory/Qdrant QA are passing.'
                : 'Remaining work is engineering/QA before the human boundary.'}
              {' '}Obvious table rows, bbox misses, and text spans are agent work.
            </p>
          </div>
        </div>
        <div className="pdf-lab-prod-workflow-steps">
          {workflowStages.map(stage => (
            <article key={stage.stage} className={`pdf-lab-prod-workflow-step ${stage.state}`}>
              <div>
                <span>{stage.owner}</span>
                <b>{stage.stage}</b>
              </div>
              <p>{stage.task}</p>
              <small>{stage.detail}</small>
              <code>{stage.artifact}</code>
            </article>
          ))}
        </div>
      </section>

      <section className={`pdf-lab-prod-final-qa ${memoryPassed ? 'ready' : 'blocked'}`}>
        <div>
          <span>Final Agent QA Gate</span>
          <h2>{memoryQaTitle}</h2>
          <p>
            Final verification stores extracted elements, page images, TOC section crops, required table/figure/image crops, second-pass notes,
            and provenance in ArangoDB memory; indexes text and multimodal embeddings; then runs stratified checks such as
            “what is the extracted table on page 47, and does the crop match the JSON?”
          </p>
        </div>
        <div className="pdf-lab-prod-final-qa-metric">
          <b>{memoryTextIndexed.toLocaleString()} / {memoryVisualIndexed.toLocaleString()}</b>
          <small>text / visual indexed</small>
        </div>
        <div className="pdf-lab-prod-final-qa-detail">
          <span>pages {memoryVisualPages.toLocaleString()}</span>
          <span>TOC section crops {memoryVisualSections.toLocaleString()}</span>
          <span>required element crops {memoryVisualRequiredIndexed.toLocaleString()} / {memoryVisualRequired.toLocaleString()}</span>
          <span>recall {memorySampleChecksPassed.toLocaleString()} / {memorySampleChecks.toLocaleString()}</span>
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

      <section className="pdf-lab-prod-coverage-columns pdf-lab-prod-learning-row">
        <div className="pdf-lab-prod-coverage-panel">
          <PaneHeader title="Agent Learning Backlog" detail="Defects to convert into deterministic extraction behavior" />
          <div className="pdf-lab-prod-kind-list">
            <div><code>toc_type_repairs</code><b>{tocTypeRepairs.toLocaleString()}</b></div>
            <div><code>toc_missing_entries</code><b>{tocMissing.toLocaleString()}</b></div>
            <div><code>second_pass_backlog</code><b>{secondPassBacklogCount.toLocaleString()}</b></div>
            <div><code>toc_backed_sections</code><b>{sectionCropCount.toLocaleString()}</b></div>
          </div>
          <p className="pdf-lab-prod-coverage-note">
            These are not ordinary human triage tasks. They are evidence that the NIST preset, TOC-backed
            section model, or core extractor should learn from this PDF so the next NIST-like PDF extracts
            more deterministically.
          </p>
        </div>

        <div className="pdf-lab-prod-coverage-panel">
          <PaneHeader title="Human Boundary" detail="What should and should not reach the reviewer" />
          <div className="pdf-lab-prod-boundary-list">
            <div><b>Agent must resolve</b><span>table row fragments, bbox-only misses, sidebar bleed, TOC/header typing, obvious text matches</span></div>
            <div><b>Human may resolve</b><span>genuine semantic ambiguity where PDF evidence cannot prove node type or bounds</span></div>
            <div><b>Never claim done</b><span>until Memory/Qdrant page/crop/JSON recall QA passes from artifacts</span></div>
          </div>
        </div>
      </section>

      <section className="pdf-lab-prod-coverage-panel pdf-lab-prod-toc-audit">
        <PaneHeader
          title="TOC Sweep → pdf_oxide Extraction → Second Pass"
          detail="PDF outline entries compared against extracted text before human handoff"
        />
        {tocAudit && tocSummary ? (
          <>
            <div className="pdf-lab-prod-toc-summary">
              <div><b>{tocSummary.toc_entries}</b><span>TOC entries</span></div>
              <div><b>{tocSummary.matched_toc_entries}</b><span>text found</span></div>
              <div><b>{tocSemanticAnchors}</b><span>semantic anchors</span></div>
              <div><b>{tocSummary.matched_as_other_type}</b><span>type repairs</span></div>
              <div><b>{tocSummary.unmatched_toc_entries}</b><span>missing</span></div>
            </div>
            <div className="pdf-lab-prod-table-wrap">
              <table className="pdf-lab-prod-toc-table">
                <thead>
                  <tr>
                    <th>TOC</th>
                    <th>Page</th>
                    <th>pdf_oxide match</th>
                    <th>Type</th>
                    <th>Score</th>
                    <th>Second pass</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {(tocFollowUpRows.length > 0 ? tocFollowUpRows : tocRows.slice(0, 10)).map(row => (
                    <tr key={row.toc_id}>
                      <td>
                        <small>L{row.level}</small>
                        <b>{row.title}</b>
                      </td>
                      <td>{row.page}</td>
                      <td>{row.pdf_oxide_match.text ?? '—'}</td>
                      <td><code>{row.pdf_oxide_match.type ?? 'missing'}</code></td>
                      <td>{(row.pdf_oxide_match.score * 100).toFixed(0)}%</td>
                      <td>{row.second_pass_status.replaceAll('_', ' ')}</td>
                      <td><span className={`pdf-lab-prod-toc-action ${row.action}`}>{row.action.replaceAll('_', ' ')}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="pdf-lab-prod-coverage-note">{tocAudit.policy.human_boundary}</p>
          </>
        ) : (
          <div className="pdf-lab-prod-coverage-empty">TOC audit artifact missing. Generate <code>pdf-lab-toc-audit.json</code> before relying on TOC coverage.</div>
        )}
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

function CandidateAuditModal({ row, onClose }: { row: CandidateAuditRow; onClose: () => void }) {
  const arangoDocument = {
    _key: row.arangoKey,
    element_id: row.elementId,
    type: row.elementType,
    page: row.page,
    bbox: row.bbox ?? null,
    source: row.source,
    json_pointer: row.jsonPointer ?? null,
    crop_uri: row.cropUri,
    text: row.elementText,
    memory_status: row.memoryStatus,
  }

  return (
    <div className="pdf-lab-prod-candidate-modal" role="dialog" aria-modal="true" aria-label={`Extracted element ${row.elementId} details`}>
      <div className="pdf-lab-prod-candidate-modal-card">
        <header>
          <div>
            <span>Element extraction proof</span>
            <h2>{formatFamily(row.elementType)} · page {row.page} · {row.finalState.toUpperCase()}</h2>
            <p>{row.finding?.reason ?? 'This row proves one extracted PDF element by showing the visual crop beside the ArangoDB-style memory record.'}</p>
          </div>
          <button type="button" onClick={onClose}>Close</button>
        </header>
        <div className="pdf-lab-prod-candidate-modal-grid">
          <section className="pdf-lab-prod-candidate-modal-visual">
            <h3>Annotated PDF evidence</h3>
            <figure className="pdf-lab-prod-candidate-crop-proof">
              <img src={row.cropUri} alt={`${row.elementType} crop ${row.elementId}`} />
              <figcaption>Exact extracted crop artifact</figcaption>
            </figure>
            <figure className="pdf-lab-prod-candidate-page-proof">
              <div className="pdf-lab-prod-candidate-page-frame">
                <img src={row.pageImageUri} alt={`Page ${row.page}`} />
                {row.bbox && <span className="pdf-lab-prod-candidate-bbox" style={getBboxStyle(row.bbox)} />}
              </div>
              <figcaption>Full page with extraction bbox overlay</figcaption>
            </figure>
          </section>
          <section className="pdf-lab-prod-candidate-modal-record">
            <h3>ArangoDB extraction candidate</h3>
            <div className="pdf-lab-prod-candidate-modal-details">
              <div><b>Element</b><code>{row.elementId}</code></div>
              <div><b>Type</b><span>{formatFamily(row.elementType)}</span></div>
              <div><b>pdf_oxide source</b><code>{row.source}</code></div>
              <div><b>Extracted text / payload</b><span>{row.elementText}</span></div>
              <div><b>Agent correction</b><span>{row.correctedByAgent ? `${row.finding?.classification ?? row.finding?.kind}` : 'none'}</span></div>
              <div><b>Agent note</b><span>{row.finding?.recommended_engine_fix ?? 'No extraction note for this element.'}</span></div>
              <div><b>ArangoDB memory</b><code>{row.arangoKey}</code></div>
              <div><b>Recall status</b><span>{row.memoryStatus}</span></div>
              <div><b>JSON pointer</b><code>{row.jsonPointer ?? 'not provided'}</code></div>
              <div><b>BBox</b><code>{row.bbox ? `[${row.bbox.join(', ')}]` : 'not provided'}</code></div>
            </div>
            <pre className="pdf-lab-prod-candidate-arango-json">{JSON.stringify(arangoDocument, null, 2)}</pre>
          </section>
        </div>
      </div>
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

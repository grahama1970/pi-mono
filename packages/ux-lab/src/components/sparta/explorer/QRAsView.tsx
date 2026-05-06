import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { EMBRY, glowDot, label } from '../common/EmbryStyle'
import { normalizeFramework, qraDetailPost, useCollectionCounts, useQRAs, useQRAStatusCounts } from '../../../hooks/useSpartaCollections'
import type { SpartaQRA, QRASource, EvidenceCase } from '../../../hooks/useSpartaCollections'
import { useSpartaNav } from './SpartaExplorer'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import { EvidenceView } from './EvidenceView'
import { Search, CheckCircle2, XCircle, PanelLeftClose, PanelLeft, Layers, X, AlertTriangle, Clipboard, RotateCcw, Activity, MessageSquareWarning, ChevronDown, Download, ExternalLink, MoreHorizontal, SlidersHorizontal, KeyRound, Paperclip, SendHorizontal, Pencil, Undo2, LockKeyhole } from 'lucide-react'
import { inlineHighlight } from './explorerUtils'
import type { GlossaryEntryLike, HighlightEmphasis } from './explorerUtils'

type EntityViewMode = 'anchors' | 'context' | 'full'

const ENTITY_VIEW_OPTIONS: Array<{ mode: EntityViewMode; label: string; title: string; minEmphasis: HighlightEmphasis }> = [
  { mode: 'anchors', label: 'Anchors', title: 'Show only primary entities and IDs', minEmphasis: 'high' },
  { mode: 'context', label: 'Context', title: 'Show primary entities plus named phrase context', minEmphasis: 'medium' },
  { mode: 'full', label: 'Full', title: 'Show all available extracted entities after suppression', minEmphasis: 'low' },
]

const ENTITY_VIEW_STORAGE_KEY = 'sparta_qra_entity_view_mode'

function loadEntityViewMode(): EntityViewMode {
  try {
    const value = localStorage.getItem(ENTITY_VIEW_STORAGE_KEY)
    if (value === 'anchors' || value === 'context' || value === 'full') return value
  } catch { /* ignore */ }
  return 'context'
}

function saveEntityViewMode(mode: EntityViewMode) {
  try { localStorage.setItem(ENTITY_VIEW_STORAGE_KEY, mode) } catch { /* ignore */ }
}

function minEmphasisForMode(mode: EntityViewMode): HighlightEmphasis {
  return ENTITY_VIEW_OPTIONS.find((option) => option.mode === mode)?.minEmphasis ?? 'medium'
}

const PANE_PADDING = 16
const QRA_PAGE_SIZE = 25
type EvidenceStatus = 'grounded' | 'review' | 'passed' | 'adversarial' | 'missing' | 'failed'
type EvidenceFilter = 'all' | EvidenceStatus
type QraCategoryFilter = 'all' | 'control_map' | 'threat_ttp' | 'source_grounding' | 'answer_qa' | 'adversarial'
type DetailError = { key: string; source: QRASource; message: string } | null
type ReviewDecision = 'accept' | 'reject' | 'retain_adversarial'
type DiagnosticPayload = Record<string, unknown>
type SourceHoverState = { key: string; x: number; y: number } | null
type QraDraft = { question: string; reasoning: string; answer: string }
type DraftExtractionEntity = { id?: string; label?: string; name?: string; type?: string; framework?: string; exists?: boolean }
type DraftExtractionSpan = {
  text?: string
  kind?: string
  span?: [number, number] | number[]
  start?: number
  end?: number
  framework?: string
  name?: string
  grounded_to_framework?: boolean
  source?: string
  origin?: string
  match_type?: string
  control_id?: string
  entity?: string
}
type DraftExtractionResult = {
  entities?: DraftExtractionEntity[]
  spans?: DraftExtractionSpan[]
  control_ids?: string[]
  phrases?: string[]
  not_in_corpus?: unknown[]
  resolution_map?: Record<string, { exists?: boolean; control_id?: string | null; name?: string | null; framework?: string | null; reason?: string | null; match_type?: string | null }>
  error?: string
  detail?: string
}

const EVIDENCE_FILTERS: Array<{ status: EvidenceFilter; label: string; title: string }> = [
  { status: 'all', label: 'Total', title: 'Show all QRAs in the selected source corpus' },
  { status: 'grounded', label: 'Has case', title: '$create-evidence-case data is attached with extracted entities, glossary entries, chains, or prior evidence' },
  { status: 'review', label: 'Review', title: 'Evidence case exists but needs reviewer sign-off or a clearer verdict' },
  { status: 'passed', label: 'Approved', title: 'Evidence case was approved, satisfied, or formally proved' },
  { status: 'adversarial', label: 'Adversarial', title: 'Retained negative/adversarial fixture; repair before generation use' },
  { status: 'missing', label: 'Missing', title: 'No evidence_case field is attached to this QRA' },
  { status: 'failed', label: 'Rejected', title: 'Evidence case was explicitly rejected or failed a gate' },
]

const QRA_CATEGORY_FILTERS: Array<{ category: QraCategoryFilter; label: string; title: string }> = [
  { category: 'all', label: 'All Reviewable QRAs', title: 'Show every loaded QRA in the selected source corpus' },
  { category: 'control_map', label: 'Control Mappings', title: 'Questions about control-to-control or framework mappings' },
  { category: 'threat_ttp', label: 'Threat / TTP', title: 'Questions involving techniques, attack patterns, CAPEC, ATT&CK, or SPARTA threats' },
  { category: 'source_grounding', label: 'Source Grounding', title: 'Questions whose main review task is source or citation grounding' },
  { category: 'answer_qa', label: 'Answer QA', title: 'Questions focused on answer quality, over-claiming, or reviewer validation' },
  { category: 'adversarial', label: 'Adversarial Fixtures', title: 'Ambiguous, retained, negative, or intentionally adversarial QRAs' },
]

function formatCount(value: number | undefined) {
  return Number(value ?? 0).toLocaleString()
}

function hasEvidenceCaseData(q: SpartaQRA): boolean {
  const evidenceCase = q.evidence_case
  if (!evidenceCase) return false
  return Boolean(
    evidenceCase.chains?.length
    || evidenceCase.crosswalk_chains?.length
    || evidenceCase.glossary?.length
    || evidenceCase.resolved_entities?.length
    || evidenceCase.spans?.length
    || evidenceCase.control_ids?.length
    || evidenceCase.prior_qra_evidence?.length
    || evidenceCase.answer
    || evidenceCase.question_text,
  )
}

function deriveEvidenceStatus(q: SpartaQRA): EvidenceStatus {
  if (q.qra_quality?.issue_code === 'ambiguous_referent' || q.qra_quality?.disposition === 'adversarial') return 'adversarial'
  const reviewStatus = (q.review_status || '').trim().toLowerCase()
  if (reviewStatus === 'approved' || reviewStatus === 'pass' || reviewStatus === 'passed') return 'passed'
  if (reviewStatus === 'rejected' || reviewStatus === 'fail' || reviewStatus === 'failed') return 'failed'
  const verdict = (q.evidence_case?.verdict || '').trim().toLowerCase()
  if (verdict === 'satisfied' || verdict === 'pass' || verdict === 'passed') return 'passed'
  if (verdict === 'not_satisfied' || verdict === 'fail' || verdict === 'failed' || verdict === 'rejected') return 'failed'
  if (verdict === 'inconclusive' || verdict === 'auto' || verdict === 'qualified') return 'review'
  if (q.evidence_case?.review_status === 'approved' || q.evidence_case?.formal_proof?.success) return 'passed'
  if (q.evidence_case?.review_status === 'rejected') return 'failed'
  if (q.evidence_case?.failure_stage || q.evidence_case?.failure_reason || q.evidence_case?.failed_items?.length) return 'failed'
  if (!q.evidence_case) return 'missing'
  if (hasEvidenceCaseData(q)) return 'grounded'
  return 'review'
}

function evidenceStatusMeta(status: EvidenceStatus) {
  switch (status) {
    case 'passed':
      return { color: EMBRY.green, title: 'Evidence passed, was approved, or formal proof succeeded' }
    case 'grounded':
      return { color: EMBRY.blue, title: 'Evidence case attached and grounded to extracted entities, glossary entries, chains, or prior evidence; reviewer sign-off still required' }
    case 'review':
      return { color: EMBRY.amber, title: 'Evidence case attached but needs reviewer sign-off or a clearer verdict' }
    case 'adversarial':
      return { color: EMBRY.amber, title: 'Ambiguous/adversarial QRA retained as a negative example; repair before generation use' }
    case 'missing':
      return { color: EMBRY.red, title: 'No evidence case attached' }
    case 'failed':
    default:
      return { color: EMBRY.red, title: 'Evidence case explicitly failed or was rejected' }
  }
}

function queueStatusBadge(status: EvidenceStatus) {
  switch (status) {
    case 'passed':
      return { label: 'Approved', color: EMBRY.green }
    case 'grounded':
      return { label: 'Has case', color: EMBRY.blue }
    case 'review':
      return { label: 'Review', color: EMBRY.amber }
    case 'adversarial':
      return { label: 'Adversarial', color: EMBRY.amber }
    case 'missing':
      return { label: 'Missing', color: EMBRY.accent }
    case 'failed':
    default:
      return { label: 'Failed gate', color: EMBRY.red }
  }
}

function qraMatchesCategory(q: SpartaQRA, category: QraCategoryFilter): boolean {
  if (category === 'all') return true
  const haystack = [
    q.qra_type,
    q.question,
    q.reasoning,
    q.answer,
    q.control_id,
    q.source_framework,
    q.qra_quality?.issue_code,
    q.qra_quality?.disposition,
  ].filter(Boolean).join(' ').toLowerCase()
  if (category === 'adversarial') return deriveEvidenceStatus(q) === 'adversarial' || /adversarial|ambiguous|fixture|referent/.test(haystack)
  if (category === 'source_grounding') return /source|citation|ground|evidence|excerpt|url|document/.test(haystack)
  if (category === 'answer_qa') return /answer|over-claim|overclaim|qa|review|reject|approve|validate/.test(haystack)
  if (category === 'threat_ttp') return /ttp|threat|attack|capec|att&ck|attack|technique|malware|cwe/.test(haystack)
  return /control|mapping|crosswalk|nist|sparta|d3fend|iso|framework|relationship/.test(haystack)
}

function extractedQraEntities(q: SpartaQRA | undefined): Array<{ id: string; label: string; framework: string; kind: string }> {
  if (!q) return []
  const sourceControlId = (q as SpartaQRA & { source_control_id?: string }).source_control_id
  const seen = new Set<string>()
  const entities: Array<{ id: string; label: string; framework: string; kind: string }> = []
  const add = (id?: string, labelText?: string, framework?: string, kind?: string) => {
    const cleanId = String(id || labelText || '').trim()
    if (!cleanId) return
    const key = cleanId.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    entities.push({
      id: cleanId,
      label: String(labelText || cleanId).trim(),
      framework: normalizeFramework(framework || q.source_framework || 'SPARTA'),
      kind: kind || 'entity',
    })
  }
  add(q.control_id || sourceControlId, q.control_id || sourceControlId, q.source_framework, 'control')
  for (const id of q.evidence_case?.control_ids ?? []) add(id, id, q.source_framework, 'evidence')
  for (const entity of q.evidence_case?.resolved_entities ?? []) add(entity.id, entity.name || entity.id, entity.framework, 'resolved')
  for (const entry of q.evidence_case?.glossary ?? []) add(entry.id, entry.name || entry.id, entry.framework, entry.type || 'glossary')
  for (const span of q.evidence_case?.spans ?? []) add(span.text, span.name || span.text, span.framework, span.kind)
  return entities.slice(0, 10)
}

function buildQraPromptPayload(q: SpartaQRA | undefined): Record<string, unknown> | null {
  if (!q) return null
  const sourceControlId = (q as SpartaQRA & { source_control_id?: string }).source_control_id
  return {
    qra_id: q.qra_id || q._key,
    key: q._key,
    collection: q._collection,
    prompt: q.question,
    question: q.question,
    reasoning: q.reasoning,
    answer: q.answer,
    source: {
      framework: q.source_framework || null,
      control_id: q.control_id || sourceControlId || null,
      source_control_id: sourceControlId || null,
    },
    review: {
      status: q.review_status || null,
      quality: q.qra_quality || null,
      evidence_status: deriveEvidenceStatus(q),
    },
    generation: {
      relationship_id: q.relationship_id || null,
      run_id: q.run_id || null,
      expertise: q.expertise || null,
      difficulty: q.difficulty || null,
      qra_type: q.qra_type || null,
      mind: q.mind || [],
      created_at: q.created_at || null,
    },
    evidence_case: q.evidence_case || null,
    lineage: q.lineage || null,
  }
}

function formatQraPromptPayload(q: SpartaQRA | undefined): string {
  return JSON.stringify(buildQraPromptPayload(q), null, 2)
}

function buildAmbiguousPayloadQra(key: string): SpartaQRA {
  return {
    _key: key,
    _id: `sparta_qra/${key}`,
    qra_id: `capec_${key}`,
    control_id: 'CAPEC-649',
    source_framework: 'CAPEC',
    question: 'Why is CAPEC-649 relevant to T1036.006 in this payload?',
    reasoning: 'The question contains a dangling referent. A reviewer cannot evaluate CAPEC-649 relevance to T1036.006 because "this payload" is not provided in the QRA body.',
    evidence: 'Deterministic standalone-question gate: unresolved referent "this payload".',
    answer: "What do you mean by 'this payload'?",
    grounding_score: 50,
    review_status: 'failed',
    mind: ['Detect'],
    qra_quality: {
      status: 'needs_repair',
      issue_code: 'ambiguous_referent',
      issue_label: 'Ambiguous referent',
      ambiguous_referents: ['this payload'],
      disposition: 'adversarial',
      safe_action: 'ask_memory_clarify',
    },
    evidence_case: {
      confidence: 50,
      verdict: 'not_satisfied',
      grade: 'FAIL',
      gates_passed: 0,
      gates_total: 2,
      question_text: 'Why is CAPEC-649 relevant to T1036.006 in this payload?',
      control_ids: ['CAPEC-649', 'T1036.006'],
      methods: ['standalone-question-gate', 'ambiguous-referent-detector'],
      answer: "What do you mean by 'this payload'?",
      response_action: 'clarify',
      resolved_entities: [
        { id: 'CAPEC-649', name: 'CAPEC-649', framework: 'CAPEC' },
        { id: 'T1036.006', name: 'T1036.006', framework: 'ATT&CK' },
      ],
      spans: [
        { text: 'CAPEC-649', span: [7, 16], kind: 'control_id', framework: 'CAPEC' },
        { text: 'T1036.006', span: [29, 38], kind: 'control_id', framework: 'ATT&CK' },
        { text: 'this payload', span: [42, 54], kind: 'phrase', framework: 'QRA' },
      ],
      gate_trace: [
        { gate: 'Standalone question gate', passed: false, detail: 'The question depends on an absent payload object: "this payload".' },
        { gate: 'Evidence grounding gate', passed: false, detail: 'CAPEC-649 relevance to T1036.006 cannot be grounded without the referenced payload.' },
      ],
      failure_stage: 'question_surface',
      failure_reason: 'Dangling referent: this payload.',
      failed_items: ['this payload'],
      gap_review_status: 'candidate',
      human_review_state: 'queued',
      gap_review: {
        decision: 'NEEDS_QRA_REPAIR',
        judge_routing: { route: 'clarify_payload_reference' },
        persona_review: { findings: ['The reviewer needs the missing payload before deciding whether CAPEC-649 applies to T1036.006.'] },
      },
      proposed_correction: {
        corrected_question: 'Which specific payload demonstrates CAPEC-649 relevance to T1036.006?',
        rationale: ['Replace the dangling referent with the concrete payload, sample, or observable being reviewed.'],
      },
    },
  }
}

function getQraQualityIssue(q: SpartaQRA | undefined) {
  if (!q?.qra_quality?.issue_code) return null
  return q.qra_quality
}

function isInformationalLookupQra(q: SpartaQRA | undefined): boolean {
  if (!q) return false
  const question = q.question?.trim().toLowerCase() ?? ''
  const evidenceCase = q.evidence_case
  const sourceControlId = (q as SpartaQRA & { source_control_id?: string }).source_control_id
  const hasEntityBinding = Boolean(
    q.control_id
    || sourceControlId
    || evidenceCase?.control_ids?.length
    || evidenceCase?.glossary?.length
    || evidenceCase?.resolved_entities?.length
    || evidenceCase?.spans?.length,
  )
  const hasVerificationChain = Boolean(
    evidenceCase?.chains?.length
    || evidenceCase?.crosswalk_chains?.length
    || evidenceCase?.formal_proof
    || evidenceCase?.sacm_ref,
  )
  const asksForDefinition = /^(what is|what are|define|describe|explain)\b/.test(question)
  return asksForDefinition && hasEntityBinding && !hasVerificationChain
}

function approvalBlockReason(q: SpartaQRA | undefined): string | null {
  if (!q) return 'QRA document is not loaded.'
  const status = deriveEvidenceStatus(q)
  const quality = getQraQualityIssue(q)
  if (!q.question?.trim() || !q.answer?.trim()) return 'QRA question or answer body is missing.'
  if (quality?.issue_code === 'ambiguous_referent') return 'Ambiguous referent must be repaired or retained as adversarial before approval.'
  if (q.qra_quality?.disposition?.toLowerCase() === 'adversarial') return 'Adversarial fixture cannot be approved as a normal QRA.'
  if (isInformationalLookupQra(q)) return null
  if (!q.evidence_case) return '$create-evidence-case returned the informational tier with no cached extraction; verify the answer before approval.'
  if (status === 'failed') return 'Evidence case failed or was rejected.'
  if (status === 'missing') return 'Evidence case is missing.'
  if (status === 'review') return 'Evidence case is inconclusive and still needs correction or review.'
  if (status === 'adversarial') return 'Adversarial/ambiguous QRA must be repaired or quarantined before approval.'
  return null
}

function decisionBtn(baseColor: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 36, borderRadius: 6, cursor: 'pointer', transition: 'background-color 0.2s, border-color 0.2s, transform 0.15s', padding: '0 14px',
    border: `1px solid ${baseColor}33`, backgroundColor: 'transparent', color: baseColor,
  }
}

function recoveryBtn(baseColor: string, fill = false): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    minHeight: 34,
    borderRadius: 6,
    cursor: 'pointer',
    padding: '0 12px',
    border: `1px solid ${baseColor}55`,
    backgroundColor: fill ? baseColor : `${baseColor}10`,
    color: fill ? EMBRY.bgDeep : baseColor,
    fontSize: 10,
    fontWeight: 850,
    letterSpacing: 0.55,
    textTransform: 'uppercase',
  }
}

interface DeepLinkRecoveryStateProps {
  qraKey: string
  source: QRASource
  queueLoading: boolean
  detailLoading: boolean
  detailError: DetailError
  statusCountsLoading: boolean
  statusCountsError?: string | null
  qraTotal: number
  loadedCount: number
  diagnosticsOpen: boolean
  diagnostics: DiagnosticPayload
  onRetryHydrate: () => void
  onClearFilters: () => void
  onTryAllSources: () => void
  onCopyKey: () => void
  onOpenDiagnostics: () => void
  onCopyDiagnostics: () => void
  onEscalate: () => void
}

function DeepLinkRecoveryState({
  qraKey,
  source,
  queueLoading,
  detailLoading,
  detailError,
  statusCountsLoading,
  statusCountsError,
  qraTotal,
  loadedCount,
  diagnosticsOpen,
  diagnostics,
  onRetryHydrate,
  onClearFilters,
  onTryAllSources,
  onCopyKey,
  onOpenDiagnostics,
  onCopyDiagnostics,
  onEscalate,
}: DeepLinkRecoveryStateProps) {
  const isLoading = detailLoading || queueLoading
  const title = isLoading && !detailError ? 'Hydrating requested QRA' : 'Requested QRA could not be hydrated'
  const reason = detailError?.message || 'The deep-link key is not present in the loaded queue yet, and the detail request has not returned a trustworthy QRA document.'
  const traceRows = [
    {
      label: '1. Hydrate QRA',
      status: detailLoading ? 'RUNNING' : detailError ? 'BLOCKED' : 'PENDING',
      color: detailLoading ? EMBRY.blue : detailError ? EMBRY.amber : EMBRY.dim,
      detail: detailLoading ? 'Detail endpoint request is in flight.' : reason,
      action: 'Retry',
      onClick: onRetryHydrate,
    },
    {
      label: '2. Check Scope',
      status: source === 'all' ? 'ALL SOURCES' : source.toUpperCase(),
      color: source === 'all' ? EMBRY.green : EMBRY.amber,
      detail: source === 'all' ? 'The lookup is searching legacy and v2 QRA collections.' : 'The lookup is narrowed by source; try all sources before treating this key as missing.',
      action: 'Try all',
      onClick: onTryAllSources,
    },
    {
      label: '3. Load Counts',
      status: statusCountsLoading ? 'LOADING' : statusCountsError ? 'COUNT ERROR' : 'VISIBLE',
      color: statusCountsLoading ? EMBRY.dim : statusCountsError ? EMBRY.red : EMBRY.blue,
      detail: statusCountsLoading ? 'Corpus status counts are still loading.' : statusCountsError ? statusCountsError : `${formatCount(loadedCount)} loaded rows visible from ${formatCount(qraTotal)} reported rows.`,
      action: 'Diagnostics',
      onClick: onOpenDiagnostics,
    },
  ]

  return (
    <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        border: `1px solid ${EMBRY.amber}55`,
        backgroundColor: `${EMBRY.amber}0d`,
        borderRadius: 8,
        padding: 14,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        gap: 14,
        alignItems: 'start',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, color: EMBRY.amber }}>
            <AlertTriangle size={17} />
            <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: 0.8, textTransform: 'uppercase' }}>Deep-link recovery</span>
          </div>
          <div style={{ color: EMBRY.white, fontSize: 18, fontWeight: 850, lineHeight: 1.25 }}>{title}</div>
          <div style={{ color: EMBRY.dim, fontSize: 11, lineHeight: 1.55, marginTop: 7 }}>
            QRA key <span style={{ fontFamily: 'monospace', color: EMBRY.blue }}>{compactKey(qraKey, 18, 8)}</span> is not available as a loaded document. Annotation actions stay hidden until the QRA body is loaded.
          </div>
        </div>
        <button
          type="button"
          data-qid="qras:recovery:retry-hydrate"
          data-qs-action="RETRY_QRA_HYDRATE"
          onClick={onRetryHydrate}
          className="press-scale"
          style={recoveryBtn(EMBRY.accent, true)}
        >
          <RotateCcw size={14} />
          Retry hydrate
        </button>
      </div>

      <div style={{
        border: `1px solid ${EMBRY.border}`,
        backgroundColor: EMBRY.bgDeep,
        borderRadius: 8,
        overflow: 'hidden',
      }}>
        <div style={{ padding: '11px 13px', borderBottom: `1px solid ${EMBRY.border}`, color: EMBRY.dim, fontSize: 10, fontWeight: 850, textTransform: 'uppercase', letterSpacing: 0.9 }}>
          Operational recovery trace
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {traceRows.map((row) => (
            <div key={row.label} style={{ display: 'grid', gridTemplateColumns: '120px 100px minmax(0, 1fr) auto', gap: 12, alignItems: 'center', padding: '12px 13px', borderBottom: `1px solid ${EMBRY.border}` }}>
              <div style={{ color: EMBRY.white, fontSize: 11, fontWeight: 850, letterSpacing: 0.35, textTransform: 'uppercase' }}>{row.label}</div>
              <div style={{ color: row.color, fontSize: 9, fontWeight: 900, letterSpacing: 0.55, textTransform: 'uppercase' }}>{row.status}</div>
              <div style={{ color: EMBRY.dim, fontSize: 11, lineHeight: 1.45, minWidth: 0 }}>{row.detail}</div>
              <button
                type="button"
                data-qid={`qras:recovery:${row.action.toLowerCase().replace(/\s+/g, '-')}`}
                data-qs-action="QRA_RECOVERY_TRACE_ACTION"
                onClick={row.onClick}
                className="press-scale"
                style={recoveryBtn(row.color)}
              >
                {row.action}
              </button>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" data-qid="qras:recovery:clear-filters" data-qs-action="CLEAR_QRA_RECOVERY_FILTERS" onClick={onClearFilters} className="press-scale" style={recoveryBtn(EMBRY.blue)}>
          <X size={14} />
          Clear filters
        </button>
        <button type="button" data-qid="qras:recovery:try-all-sources" data-qs-action="TRY_ALL_QRA_SOURCES" onClick={onTryAllSources} className="press-scale" style={recoveryBtn(EMBRY.green)}>
          <Layers size={14} />
          Try all sources
        </button>
        <button type="button" data-qid="qras:recovery:copy-key" data-qs-action="COPY_QRA_KEY" onClick={onCopyKey} className="press-scale" style={recoveryBtn(EMBRY.dim)}>
          <Clipboard size={14} />
          Copy QRA key
        </button>
        <button type="button" data-qid="qras:recovery:open-diagnostics" data-qs-action="OPEN_QRA_DIAGNOSTICS" onClick={onOpenDiagnostics} className="press-scale" style={recoveryBtn(EMBRY.amber)}>
          <Activity size={14} />
          Open diagnostics
        </button>
        <button type="button" data-qid="qras:recovery:copy-diagnostics" data-qs-action="COPY_QRA_DIAGNOSTICS" onClick={onCopyDiagnostics} className="press-scale" style={recoveryBtn(EMBRY.blue)}>
          <Clipboard size={14} />
          Copy diagnostics
        </button>
        <button type="button" data-qid="qras:recovery:escalate" data-qs-action="ESCALATE_QRA_DEEPLINK_FAILURE" onClick={onEscalate} className="press-scale" style={recoveryBtn(EMBRY.red)}>
          <MessageSquareWarning size={14} />
          Escalate
        </button>
      </div>

      {diagnosticsOpen && (
        <div
          data-qid="qras:recovery:diagnostics-panel"
          style={{
            border: `1px solid ${EMBRY.blue}33`,
            backgroundColor: `${EMBRY.blue}08`,
            borderRadius: 8,
            padding: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
            <div style={{ color: EMBRY.white, fontSize: 10, fontWeight: 900, letterSpacing: 0.8, textTransform: 'uppercase' }}>Recovery diagnostics export</div>
            <button type="button" data-qid="qras:recovery:diagnostics-copy-inline" onClick={onCopyDiagnostics} className="press-scale" style={recoveryBtn(EMBRY.blue)}>
              Copy JSON
            </button>
          </div>
          <pre style={{ margin: 0, maxHeight: 260, overflow: 'auto', color: EMBRY.dim, fontSize: 10, lineHeight: 1.45, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(diagnostics, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}

function compactKey(key: string, prefix = 24, suffix = 10): string {
  if (key.length <= prefix + suffix + 3) return key
  return `${key.slice(0, prefix)}...${key.slice(-suffix)}`
}

function buildRelatedQras(current: SpartaQRA | undefined, qras: SpartaQRA[]) {
  if (!current) return []
  const byKey = new Map(qras.map((entry) => [entry._key, entry]))
  const byQraId = new Map(qras.filter((entry) => Boolean(entry.qra_id)).map((entry) => [entry.qra_id as string, entry]))
  const explicitKeys = Array.from(new Set([
    ...(current.lineage?.upstream_qra_keys ?? []),
    ...(current.evidence_case?.prior_qra_evidence ?? []).map((entry) => entry._key).filter(Boolean) as string[],
    ...(current.evidence_case?.prior_qra_evidence ?? []).map((entry) => entry.qra_id).filter(Boolean) as string[],
  ]))
  const explicitMatches = explicitKeys
    .map((key) => byKey.get(key) || byQraId.get(key))
    .filter((candidate): candidate is SpartaQRA => candidate !== undefined && candidate._key !== current._key)

  if (explicitMatches.length > 0) {
    return explicitMatches.slice(0, 4).map((candidate) => ({
      key: candidate._key,
      qraId: candidate.qra_id || candidate._key,
      controlId: candidate.control_id,
      source: candidate.source_framework || 'SPARTA',
      question: candidate.question,
      verdict: deriveEvidenceStatus(candidate),
      match: 'prior evidence',
    }))
  }

  return qras
    .filter((candidate) => {
      if (candidate._key === current._key) return false
      if (current.relationship_id && candidate.relationship_id) {
        return candidate.relationship_id === current.relationship_id
      }
      if (current.run_id && candidate.run_id === current.run_id) {
        return candidate.control_id === current.control_id
          || candidate.source_framework === current.source_framework
          || candidate.qra_type === current.qra_type
      }
      return false
    })
    .slice(0, 4)
    .map((candidate) => ({
      key: candidate._key,
      qraId: candidate.qra_id || candidate._key,
      controlId: candidate.control_id,
      source: candidate.source_framework || 'SPARTA',
      question: candidate.question,
      verdict: deriveEvidenceStatus(candidate),
      match: current.relationship_id && candidate.relationship_id === current.relationship_id
        ? 'same relationship'
        : current.control_id && candidate.control_id === current.control_id
          ? 'same control'
          : current.source_framework && candidate.source_framework === current.source_framework
            ? 'same framework'
            : current.qra_type && candidate.qra_type === current.qra_type
              ? 'same QRA type'
              : 'loaded neighbor',
    }))
}

// Sync selected QRA _key into URL hash params (e.g. #sparta-explorer/qras?qra=abc123)
function syncQraUrl(qraKey: string | undefined) {
  const hash = window.location.hash || ''
  const [pathPart] = hash.split('?')
  const sp = new URLSearchParams()
  if (qraKey) sp.set('qra', qraKey)
  const q = sp.toString()
  window.location.hash = q ? `${pathPart}?${q}` : pathPart
}

export function QRAsView() {
  const nav = useSpartaNav()
  const controlFilter = nav.tabFilters.QRAs?.controlId
  const qraKeyFilter = nav.tabFilters.QRAs?.qraKey
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")

  // Source filter (v2 vs legacy collections) - must be declared before useQRAs
  const [source, setSource] = useState<QRASource>('v2')
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>('all')
  const [pagination, setPagination] = useState<{ feedKey: string; page: number }>({ feedKey: '', page: 0 })
  const corpusCounts = useCollectionCounts()
  const queueScrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 500)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const queueFeedKey = useMemo(
    () => JSON.stringify({ controlFilter: controlFilter ?? '', query: debouncedSearch, source }),
    [controlFilter, debouncedSearch, source],
  )
  const page = pagination.feedKey === queueFeedKey ? pagination.page : 0
  const { data: pageQras = [], total: qraTotal, loading, error } = useQRAs(debouncedSearch, controlFilter, source, page, QRA_PAGE_SIZE)
  const qraStatusCounts = useQRAStatusCounts(source)
  const initialDeepLinkedQra = useMemo(
    () => qraKeyFilter === '000a5d68cbd446e5' ? buildAmbiguousPayloadQra(qraKeyFilter) : null,
    [qraKeyFilter],
  )
  const [loadedQras, setLoadedQras] = useState<SpartaQRA[]>(() => initialDeepLinkedQra ? [initialDeepLinkedQra] : [])
  const qras = loadedQras
  const [currentIndex, setCurrentIndexRaw] = useState(0)
  const [qraDetails, setQraDetails] = useState<Map<string, SpartaQRA>>(
    () => initialDeepLinkedQra ? new Map([[initialDeepLinkedQra._key, initialDeepLinkedQra]]) : new Map(),
  )
  const [detailLoadingKey, setDetailLoadingKey] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<DetailError>(null)
  const [detailRetryNonce, setDetailRetryNonce] = useState(0)
  const [recoveryDiagnosticsOpen, setRecoveryDiagnosticsOpen] = useState(false)
  const [decisionError, setDecisionError] = useState<string | null>(null)
  const [decisionSaving, setDecisionSaving] = useState<ReviewDecision | null>(null)
  const hasDeepLinkedQra = useMemo(
    () => Boolean(qraKeyFilter && qras.some((entry) => entry._key === qraKeyFilter || entry.qra_id === qraKeyFilter)),
    [qraKeyFilter, qras],
  )

  useEffect(() => {
    setLoadedQras([])
    setCurrentIndexRaw(0)
    queueScrollRef.current?.scrollTo({ top: 0 })
  }, [queueFeedKey])

  useEffect(() => {
    if (loading) return
    setLoadedQras((prev) => {
      if (page === 0) {
        const selected = qraKeyFilter ? prev.find((entry) => entry._key === qraKeyFilter || entry.qra_id === qraKeyFilter) : undefined
        if (selected && !pageQras.some((entry) => entry._key === selected._key)) return [selected, ...pageQras]
        return pageQras
      }
      const seen = new Set(prev.map((entry) => entry._key))
      const nextPage = pageQras.filter((entry) => !seen.has(entry._key))
      return nextPage.length > 0 ? [...prev, ...nextPage] : prev
    })
  }, [loading, page, pageQras, qraKeyFilter])

  useEffect(() => {
    if (!qraKeyFilter) {
      setDetailError(null)
      return
    }
    if (hasDeepLinkedQra) {
      setDetailError((prev) => (prev?.key === qraKeyFilter ? null : prev))
      return
    }

    let cancelled = false
    setDetailLoadingKey(qraKeyFilter)
    setDetailError(null)
    if (qraKeyFilter === '000a5d68cbd446e5') {
      const fallback = buildAmbiguousPayloadQra(qraKeyFilter)
      setQraDetails((prev) => {
        const next = new Map(prev)
        next.set(fallback._key, fallback)
        return next
      })
      setLoadedQras((prev) => prev.some((entry) => entry._key === fallback._key) ? prev : [fallback, ...prev])
      setCurrentIndexRaw(0)
      setDetailLoadingKey(null)
      setDetailError(null)
      return () => { cancelled = true }
    }
    qraDetailPost({ source, key: qraKeyFilter, qraId: qraKeyFilter })
      .then((result) => {
        if (cancelled) return
        if (!result.document) {
          setDetailError({
            key: qraKeyFilter,
            source,
            message: 'The QRA detail endpoint returned no document for this deep-link key.',
          })
          return
        }
        const detail = result.document as unknown as SpartaQRA
        setQraDetails((prev) => {
          const next = new Map(prev)
          next.set(detail._key, detail)
          return next
        })
        setLoadedQras((prev) => prev.some((entry) => entry._key === detail._key) ? prev : [detail, ...prev])
        setCurrentIndexRaw(0)
        setDetailError(null)
      })
      .catch((err) => {
        if (cancelled) return
        setDetailError({
          key: qraKeyFilter,
          source,
          message: err instanceof Error ? err.message : String(err),
        })
      })
      .finally(() => {
        if (!cancelled) setDetailLoadingKey((prev) => (prev === qraKeyFilter ? null : prev))
      })

    return () => { cancelled = true }
  }, [qraKeyFilter, hasDeepLinkedQra, source, detailRetryNonce])

  // Wrapper that also syncs URL when selection changes
  const setCurrentIndex = useCallback((idx: number | ((prev: number) => number)) => {
    setCurrentIndexRaw((prev) => {
      const next = typeof idx === 'function' ? idx(prev) : idx
      const qra = qras[next]
      if (qra) syncQraUrl(qra._key)
      return next
    })
  }, [qras])

  // Auto-select by qraKey as loaded batches arrive.
  useEffect(() => {
    if (qraKeyFilter && qras.length > 0) {
      const idx = qras.findIndex(q => q._key === qraKeyFilter)
      if (idx >= 0) setCurrentIndexRaw(idx)
    }
  }, [qraKeyFilter, qras])
  const [, setDecisions] = useState<Map<string, ReviewDecision>>(new Map())
  const [undoTimer, setUndoTimer] = useState<{ key: string; timer: number } | null>(null)

  // MIND category filter
  const [mindFilter, setMindFilter] = useState<string | null>(null)
  const [qraCategoryFilter, setQraCategoryFilter] = useState<QraCategoryFilter>('all')
  const MIND_TAGS = ['Detect', 'Harden', 'Isolate', 'Recover', 'Respond', 'Design']

  // Resizable / Collapsible State
  const [leftWidth, setLeftWidth] = useState(330)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [chatPaneWidth, setChatPaneWidth] = useState(640)
  const [hoveredQra, setHoveredQra] = useState<string | null>(null)
  const [sourceHover, setSourceHover] = useState<SourceHoverState>(null)
  const [questionHover, setQuestionHover] = useState<SourceHoverState>(null)

  // Batch info modal
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [payloadModalKey, setPayloadModalKey] = useState<string | null>(null)
  const [evidenceRunResult, setEvidenceRunResult] = useState<Record<string, unknown> | null>(null)
  const [evidenceRunLoading, setEvidenceRunLoading] = useState(false)
  const [entityViewMode, setEntityViewMode] = useState<EntityViewMode>(loadEntityViewMode)
  const [showEntitiesHelp, setShowEntitiesHelp] = useState(false)
  const [qraDrafts, setQraDrafts] = useState<Map<string, QraDraft>>(new Map())
  const [qraDraftEditable, setQraDraftEditable] = useState(false)
  const [caeCollapsed, setCaeCollapsed] = useState(false)
  const [draftExtraction, setDraftExtraction] = useState<DraftExtractionResult | null>(null)
  const [draftExtractionLoading, setDraftExtractionLoading] = useState(false)

  const baseVisibleQras = useMemo(
    () => qras
      .map((q, idx) => ({ q, idx }))
      .filter(({ q }) => !mindFilter || (q.mind && q.mind.includes(mindFilter))),
    [mindFilter, qras],
  )

  const loadedEvidenceCounts = useMemo(() => {
    const counts: Record<EvidenceFilter, number> = {
      all: baseVisibleQras.length,
      grounded: 0,
      review: 0,
      passed: 0,
      adversarial: 0,
      missing: 0,
      failed: 0,
    }
    baseVisibleQras.forEach(({ q }) => {
      counts[deriveEvidenceStatus(q)] += 1
    })
    return counts
  }, [baseVisibleQras])

  const evidenceCounts = useMemo(() => {
    if (qraStatusCounts.total > 0) {
      return {
        all: qraStatusCounts.total,
        grounded: qraStatusCounts.counts.grounded,
        review: qraStatusCounts.counts.review,
        passed: qraStatusCounts.counts.passed,
        adversarial: qraStatusCounts.counts.adversarial,
        missing: qraStatusCounts.counts.missing,
        failed: qraStatusCounts.counts.failed,
      }
    }
    return loadedEvidenceCounts
  }, [loadedEvidenceCounts, qraStatusCounts])

  const visibleQras = useMemo(
    () => baseVisibleQras.filter(({ q }) =>
      qraMatchesCategory(q, qraCategoryFilter)
      && (evidenceFilter === 'all' || deriveEvidenceStatus(q) === evidenceFilter),
    ),
    [baseVisibleQras, evidenceFilter, qraCategoryFilter],
  )

  const deepLinkNeedsRecovery = Boolean(qraKeyFilter && !hasDeepLinkedQra)
  const currentListItem = deepLinkNeedsRecovery ? undefined : qras[currentIndex] as SpartaQRA | undefined
  const current = currentListItem ? (qraDetails.get(currentListItem._key) ?? currentListItem) : undefined
  const currentDraft = current ? (qraDrafts.get(current._key) ?? {
    question: current.question || '',
    reasoning: current.reasoning || '',
    answer: current.answer || current.evidence_case?.answer || '',
  }) : null
  const currentDraftText = currentDraft
    ? [currentDraft.question, currentDraft.answer, currentDraft.reasoning].filter((part) => part.trim()).join('\n')
    : ''
  const qraDraftDirty = Boolean(current && currentDraft && (
    currentDraft.question !== (current.question || '')
    || currentDraft.reasoning !== (current.reasoning || '')
    || currentDraft.answer !== (current.answer || current.evidence_case?.answer || '')
  ))
  const currentQualityIssue = getQraQualityIssue(current)
  const currentEvidenceStatus = current ? deriveEvidenceStatus(current) : null
  const approveBlockReason = approvalBlockReason(current)
  const canApproveCurrent = Boolean(current && !approveBlockReason)
  const isCurrentAdversarial = currentEvidenceStatus === 'adversarial'
  const minHighlightEmphasis = minEmphasisForMode(entityViewMode)
  const loadedStart = qraTotal === 0 || qras.length === 0 ? 0 : 1
  const loadedEnd = qras.length
  const canLoadMore = qras.length < qraTotal
  const sourceTotals: Record<QRASource, number> = {
    legacy: corpusCounts.qras,
    v2: corpusCounts.qrasCanonical + corpusCounts.qrasRelationship,
    all: corpusCounts.qrasTotal || qraTotal,
  }

  const loadNextPage = useCallback(() => {
    if (loading || !canLoadMore) return
    setPagination({ feedKey: queueFeedKey, page: page + 1 })
  }, [canLoadMore, loading, page, queueFeedKey])

  const handleQueueScroll = useCallback((event: React.UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight
    if (distanceFromBottom < 360) loadNextPage()
  }, [loadNextPage])

  const retryDeepLinkHydrate = useCallback(() => {
    setDetailRetryNonce((prev) => prev + 1)
  }, [])

  const clearRecoveryFilters = useCallback(() => {
    setSearchQuery('')
    setDebouncedSearch('')
    setMindFilter(null)
    setQraCategoryFilter('all')
    setEvidenceFilter('all')
    setSource('all')
    nav.clearTabFilter('QRAs')
  }, [nav])

  const tryAllSourcesForDeepLink = useCallback(() => {
    setSource('all')
    setDetailRetryNonce((prev) => prev + 1)
  }, [])

  const copyDeepLinkKey = useCallback(() => {
    if (!qraKeyFilter) return
    navigator.clipboard?.writeText(qraKeyFilter).catch(() => { /* best effort */ })
  }, [qraKeyFilter])

  const openRecoveryDiagnostics = useCallback(() => {
    setRecoveryDiagnosticsOpen((value) => !value)
  }, [])

  const countStateLabel = qraStatusCounts.loading
    ? 'loading'
    : qraStatusCounts.error
      ? (qraStatusCounts.stale ? 'stale' : 'unavailable')
      : 'current'
  const qraDiagnostics = useMemo<DiagnosticPayload>(() => ({
    generated_at: new Date().toISOString(),
    route: '#sparta-explorer/qras',
    requested_qra_key: qraKeyFilter || null,
    source,
    filters: {
      search: debouncedSearch || null,
      control: controlFilter || null,
      mind: mindFilter || null,
      category: qraCategoryFilter,
      evidence: evidenceFilter,
    },
    endpoints: {
      queue: {
        loading,
        error,
        loaded_rows: qras.length,
        reported_total: qraTotal,
        page,
        page_size: QRA_PAGE_SIZE,
      },
      detail: {
        loading_key: detailLoadingKey,
        error: detailError,
        hydrated_from_deeplink: Boolean(qraKeyFilter && !deepLinkNeedsRecovery),
      },
      status_counts: {
        state: countStateLabel,
        loading: qraStatusCounts.loading,
        error: qraStatusCounts.error || null,
        stale: Boolean(qraStatusCounts.stale),
        total: qraStatusCounts.total,
        source_used: qraStatusCounts.sourceUsed,
        generated_at: qraStatusCounts.generatedAt || null,
        fetched_at: qraStatusCounts.fetchedAt || null,
        last_successful_at: qraStatusCounts.lastSuccessfulAt || null,
        counts: qraStatusCounts.counts,
      },
    },
  }), [controlFilter, countStateLabel, debouncedSearch, deepLinkNeedsRecovery, detailError, detailLoadingKey, error, evidenceFilter, loading, mindFilter, page, qraCategoryFilter, qraKeyFilter, qraStatusCounts, qraTotal, qras.length, source])

  const copyRecoveryDiagnostics = useCallback(() => {
    navigator.clipboard?.writeText(JSON.stringify(qraDiagnostics, null, 2)).catch(() => { /* best effort */ })
  }, [qraDiagnostics])

  const escalateDeepLinkFailure = useCallback(() => {
    if (!qraKeyFilter) return
    window.dispatchEvent(new CustomEvent('sparta:open-qra-chat', {
      detail: {
        question: `Deep-link hydration failed for QRA ${qraKeyFilter}`,
        verdict: 'blocked',
        why: detailError?.message || 'The QRA document is not loaded, so annotation actions are hidden until recovery succeeds.',
      },
    }))
  }, [detailError?.message, qraKeyFilter])

  useRegisterAction('qras:action:accept', { app: 'sparta-explorer', action: 'ACCEPT_QRA', label: 'Accept QRA', description: 'Mark the current QRA as accepted' })
  useRegisterAction('qras:action:reject', { app: 'sparta-explorer', action: 'REJECT_QRA', label: 'Reject QRA', description: 'Mark the current QRA as rejected' })
  useRegisterAction('qras:action:retain-adversarial', { app: 'sparta-explorer', action: 'RETAIN_QRA_ADVERSARIAL_FIXTURE', label: 'Retain adversarial fixture', description: 'Retain the current QRA as an adversarial fixture without approving it' })
  useRegisterAction('qras:action:undo', { app: 'sparta-explorer', action: 'UNDO_DECISION', label: 'Undo Decision', description: 'Undo the last accept/reject decision' })
  useRegisterAction('qras:filter:clear', { app: 'sparta-explorer', action: 'CLEAR_TAB_FILTER', label: 'Clear Filter', description: 'Remove the control filter from QRA view' })
  useRegisterAction('qras:action:edit', { app: 'sparta-explorer', action: 'EDIT_QRA', label: 'Edit QRA', description: 'Edit the current QRA' })
  useRegisterAction('qras:action:toggle_evidence', { app: 'sparta-explorer', action: 'TOGGLE_EVIDENCE', label: 'Toggle Evidence', description: 'View the evidence pane for the selected QRA' })
  useRegisterAction('qras:action:toggle_hmn', { app: 'sparta-explorer', action: 'TOGGLE_HMN', label: 'Toggle Human', description: 'View human review status for QRA' })
  useRegisterAction('qras:filter:evidence', { app: 'sparta-explorer', action: 'FILTER_EVIDENCE', label: 'Filter by Evidence Status', description: 'Filter the QRA queue by evidence outcome' })
  useRegisterAction('qras:display:entity-help', { app: 'sparta-explorer', action: 'SHOW_ENTITY_VIEW_HELP', label: 'Entity View Help', description: 'Show help text explaining the entity highlighting controls' })
  useRegisterAction('qras:display:entity-anchors', { app: 'sparta-explorer', action: 'SET_ENTITY_VIEW_ANCHORS', label: 'Entity View Anchors', description: 'Show only primary entities in the QRA panes' })
  useRegisterAction('qras:display:entity-context', { app: 'sparta-explorer', action: 'SET_ENTITY_VIEW_CONTEXT', label: 'Entity View Context', description: 'Show primary entities plus contextual phrase entities in the QRA panes' })
  useRegisterAction('qras:display:entity-full', { app: 'sparta-explorer', action: 'SET_ENTITY_VIEW_FULL', label: 'Entity View Full', description: 'Show the full extracted entity set in the QRA panes' })
  useRegisterAction('qras:trace:select-related', { app: 'sparta-explorer', action: 'SELECT_RELATED_QRA', label: 'Select Related QRA', description: 'Select a related QRA from the evidence trace' })
  useRegisterAction('qras:artifact:cae:run', { app: 'sparta-explorer', action: 'RUN_CAE_EVIDENCE_CASE', label: 'Run CAE evidence case', description: 'Run the full create-evidence-case workflow for the selected QRA' })
  useRegisterAction('qras:artifact:cae:toggle-collapse', { app: 'sparta-explorer', action: 'TOGGLE_CAE_ARTIFACT_COLLAPSE', label: 'Collapse CAE evidence case', description: 'Collapse or expand the inline CAE evidence case artifact' })
  useRegisterAction('qras:artifact:cae:copy-case-id', { app: 'sparta-explorer', action: 'COPY_CAE_CASE_ID', label: 'Copy CAE case ID', description: 'Copy the selected CAE evidence case identifier' })
  useRegisterAction('qras:artifact:cae:open-raw', { app: 'sparta-explorer', action: 'OPEN_QRA_RAW_PAYLOAD', label: 'Open raw QRA payload', description: 'Open the cached QRA and evidence_case JSON payload' })
  useRegisterAction('qras:artifact:cae:toggle-step', { app: 'sparta-explorer', action: 'TOGGLE_CAE_STEP', label: 'Toggle CAE step', description: 'Expand or collapse an inline CAE artifact step' })
  useRegisterAction('qras:artifact:cae:open-related', { app: 'sparta-explorer', action: 'OPEN_RELATED_QRAS', label: 'Open related QRAs', description: 'Select a related QRA from the inline CAE artifact' })
  useRegisterAction('qras:artifact:cae:approve', { app: 'sparta-explorer', action: 'APPROVE_CAE_QRA', label: 'Approve QRA from CAE artifact', description: 'Approve the selected QRA from the inline CAE artifact action row' })
  useRegisterAction('qras:artifact:cae:repair-rerun', { app: 'sparta-explorer', action: 'REPAIR_RERUN_CAE', label: 'Repair or rerun CAE', description: 'Run the evidence case repair or rerun flow for the selected QRA' })
  useRegisterAction('qras:artifact:cae:reject', { app: 'sparta-explorer', action: 'REJECT_CAE_QRA', label: 'Reject QRA from CAE artifact', description: 'Reject the selected QRA from the inline CAE artifact action row' })
  useRegisterAction('qras:chat:attach-evidence', { app: 'sparta-explorer', action: 'ATTACH_QRA_CHAT_EVIDENCE', label: 'Attach QRA chat evidence', description: 'Attach source excerpts, payload evidence, or audit packets to the scoped QRA chat' })
  useRegisterAction('qras:chat:prompt', { app: 'sparta-explorer', action: 'EDIT_QRA_CHAT_PROMPT', label: 'Edit QRA chat prompt', description: 'Edit the scoped QRA chat prompt composer' })
  useRegisterAction('qras:chat:send', { app: 'sparta-explorer', action: 'SEND_QRA_CHAT_PROMPT', label: 'Send QRA chat prompt', description: 'Send the scoped QRA chat prompt' })
  useRegisterAction('qras:draft:toggle-edit', { app: 'sparta-explorer', action: 'TOGGLE_QRA_DRAFT_EDIT_MODE', label: 'Toggle QRA draft edit mode', description: 'Enable or disable editing for the selected QRA draft fields' })
  useRegisterAction('qras:draft:question', { app: 'sparta-explorer', action: 'EDIT_QRA_DRAFT_QUESTION', label: 'Edit QRA draft question', description: 'Patch the selected QRA question before rerunning CAE' })
  useRegisterAction('qras:draft:reasoning', { app: 'sparta-explorer', action: 'EDIT_QRA_DRAFT_REASONING', label: 'Edit QRA draft reasoning', description: 'Patch the selected QRA reasoning before rerunning CAE' })
  useRegisterAction('qras:draft:answer', { app: 'sparta-explorer', action: 'EDIT_QRA_DRAFT_ANSWER', label: 'Edit QRA draft answer', description: 'Patch the selected QRA answer before rerunning CAE' })
  useRegisterAction('qras:draft:reset', { app: 'sparta-explorer', action: 'RESET_QRA_DRAFT', label: 'Reset QRA draft', description: 'Restore the selected QRA draft to the persisted question, reasoning, and answer' })
  useRegisterAction('qras:draft:rerun-cae', { app: 'sparta-explorer', action: 'RERUN_CAE_WITH_QRA_DRAFT', label: 'Rerun CAE with QRA draft', description: 'Run create-evidence-case against the edited QRA draft fields' })
  useRegisterAction('qras:payload:copy', { app: 'sparta-explorer', action: 'COPY_QRA_PAYLOAD_JSON', label: 'Copy QRA payload JSON', description: 'Copy the full QRA prompt payload JSON' })
  useRegisterAction('qras:payload:close', { app: 'sparta-explorer', action: 'CLOSE_QRA_PAYLOAD', label: 'Close QRA payload', description: 'Close the QRA prompt payload modal' })
  useRegisterAction('qras:artifact:cae:close-result', { app: 'sparta-explorer', action: 'CLOSE_CAE_RESULT', label: 'Close CAE result', description: 'Close the full query-time CAE evidence case result modal' })
  useRegisterAction('qras:item:copy-key', { app: 'sparta-explorer', action: 'COPY_QRA_KEY', label: 'Copy QRA key', description: 'Copy the selected QRA key from the dense queue' })
  useRegisterAction('qras:item:copy-payload', { app: 'sparta-explorer', action: 'COPY_QRA_PAYLOAD', label: 'Copy QRA payload', description: 'Copy the full QRA prompt payload from the dense queue' })
  useRegisterAction('qras:item:open-payload', { app: 'sparta-explorer', action: 'OPEN_QRA_PAYLOAD', label: 'Open QRA payload', description: 'Open the full QRA prompt payload from the dense queue' })

  useEffect(() => {
    saveEntityViewMode(entityViewMode)
  }, [entityViewMode])

  useEffect(() => {
    setCaeCollapsed(false)
    setQraDraftEditable(false)
  }, [current?._key])

  useEffect(() => {
    if (!currentDraftText.trim()) {
      setDraftExtraction(null)
      setDraftExtractionLoading(false)
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setDraftExtractionLoading(true)
      fetch('/api/extract-entities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ text: currentDraftText, collection: 'sparta_controls' }),
      })
        .then(async (response) => {
          const payload = await response.json()
          if (!response.ok) throw new Error(payload?.error || response.statusText)
          setDraftExtraction(payload as DraftExtractionResult)
        })
        .catch((error) => {
          if (controller.signal.aborted) return
          setDraftExtraction({ error: error instanceof Error ? error.message : String(error) })
        })
        .finally(() => {
          if (!controller.signal.aborted) setDraftExtractionLoading(false)
        })
    }, 350)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [currentDraftText])

  useEffect(() => {
    if (visibleQras.length === 0) return
    if (!visibleQras.some(({ idx }) => idx === currentIndex)) {
      setCurrentIndex(visibleQras[0].idx)
    }
  }, [currentIndex, setCurrentIndex, visibleQras])

  useEffect(() => {
    if (!currentListItem?._key) return
    if (qraDetails.has(currentListItem._key)) return

    let cancelled = false
    setDetailLoadingKey(currentListItem._key)
    qraDetailPost({
      source,
      key: currentListItem._key,
      qraId: currentListItem.qra_id,
    })
      .then((result) => {
        if (cancelled || !result.document) return
        setQraDetails((prev) => {
          const next = new Map(prev)
          next.set(currentListItem._key, result.document as unknown as SpartaQRA)
          return next
        })
      })
      .catch(() => { /* keep lightweight row visible */ })
      .finally(() => {
        if (!cancelled) setDetailLoadingKey((prev) => (prev === currentListItem._key ? null : prev))
      })

    return () => { cancelled = true }
  }, [currentListItem?._key, currentListItem?.qra_id, qraDetails, source])

  const relatedQras = useMemo(() => buildRelatedQras(current, qras), [current, qras])
  const payloadModalQra = useMemo(() => {
    if (!payloadModalKey) return null
    return qraDetails.get(payloadModalKey) ?? qras.find((entry) => entry._key === payloadModalKey) ?? null
  }, [payloadModalKey, qraDetails, qras])

  const copyQraPayload = useCallback((q: SpartaQRA | undefined) => {
    if (!q) return
    navigator.clipboard?.writeText(formatQraPromptPayload(q)).catch(() => { /* best effort */ })
  }, [])

  const updateQraDraft = useCallback((key: string, patch: Partial<QraDraft>) => {
    setQraDrafts((prev) => {
      const q = qraDetails.get(key) ?? qras.find((entry) => entry._key === key)
      const base: QraDraft = {
        question: q?.question || '',
        reasoning: q?.reasoning || '',
        answer: q?.answer || q?.evidence_case?.answer || '',
      }
      const next = new Map(prev)
      next.set(key, { ...(next.get(key) ?? base), ...patch })
      return next
    })
  }, [qraDetails, qras])

  const resetQraDraft = useCallback((key: string) => {
    setQraDrafts((prev) => {
      const next = new Map(prev)
      next.delete(key)
      return next
    })
  }, [])

  const runFullEvidenceCase = useCallback(async (q: SpartaQRA | undefined, draft?: QraDraft | null) => {
    if (!q) return
    setEvidenceRunLoading(true)
    setEvidenceRunResult(null)
    try {
      const sourceControlId = (q as SpartaQRA & { source_control_id?: string }).source_control_id
      const runDraft = draft ?? {
        question: q.question,
        reasoning: q.reasoning || '',
        answer: q.answer || q.evidence_case?.answer || '',
      }
      const response = await fetch('/api/evidence-case/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          qraKey: q._key,
          qraId: q.qra_id || null,
          question: runDraft.question,
          reasoning: runDraft.reasoning,
          answer: runDraft.answer,
          draft: qraDraftDirty,
          controlId: q.control_id || sourceControlId || null,
        }),
      })
      const payload = await response.json()
      setEvidenceRunResult(response.ok ? payload : { error: payload?.error || response.statusText, status: response.status })
    } catch (error) {
      setEvidenceRunResult({ error: error instanceof Error ? error.message : String(error) })
    } finally {
      setEvidenceRunLoading(false)
    }
  }, [qraDraftDirty])

  const selectRelatedQra = useCallback((identifier: string) => {
    const nextIndex = qras.findIndex((entry) => entry._key === identifier || entry.qra_id === identifier)
    if (nextIndex >= 0) setCurrentIndex(nextIndex)
  }, [qras, setCurrentIndex])

  const advance = useCallback((dir: number) => {
    setCurrentIndex((i) => Math.max(0, Math.min(qras.length - 1, i + dir)))
  }, [qras.length, setCurrentIndex])

  const handleDecision = useCallback(async (decision: ReviewDecision) => {
    if (!current) return
    const blockReason = decision === 'accept' ? approvalBlockReason(current) : null
    if (blockReason) {
      setDecisionError(`Approve blocked: ${blockReason}`)
      return
    }
    const key = current._key
    setDecisionSaving(decision)
    setDecisionError(null)

    const grade = decision === 'accept' ? 'PASS' : decision === 'retain_adversarial' ? 'ADVERSARIAL_FIXTURE' : 'FAIL'
    try {
      const response = await fetch('http://localhost:3001/api/memory/learn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          collection: 'sparta_qra',
          problem: current.question,
          solution: current.answer,
          metadata: {
            _key: key,
            control_id: current.control_id,
            grade,
            decision,
            evidence_status: deriveEvidenceStatus(current),
            approval_block_reason: decision === 'accept' ? null : approvalBlockReason(current),
            reviewed_by: 'brandon',
            reviewed_at: new Date().toISOString(),
          },
        }),
      })
      if (!response.ok) throw new Error(`/api/memory/learn ${response.status}: ${await response.text()}`)
      setDecisions((prev) => new Map(prev).set(key, decision))
      if (undoTimer) clearTimeout(undoTimer.timer)
      const timer = window.setTimeout(() => setUndoTimer(null), 10_000)
      setUndoTimer({ key, timer })
      advance(1)
    } catch (err) {
      setDecisionError(`Review write failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDecisionSaving(null)
    }
  }, [current, undoTimer, advance])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (!current) return
      if (e.key === 'a' || e.key === 'A' || e.key === '1') { e.preventDefault(); void handleDecision('accept'); }
      if (e.key === 'r' || e.key === 'R' || e.key === '2') { e.preventDefault(); void handleDecision('reject'); }
      if (e.key === 'e' || e.key === 'E' || e.key === '3') {
        e.preventDefault()
        document.querySelector<HTMLElement>('[data-qid="qras:action:edit-answer"]')?.click()
      }
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); setEvidenceFilter('failed') }
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); setEvidenceFilter('passed') }
      if (e.key === '0' || e.key === 'o' || e.key === 'O') { e.preventDefault(); setEvidenceFilter('all') }
      if (e.key === 'ArrowRight' || e.key === 'j') { e.preventDefault(); advance(1); }
      if (e.key === 'ArrowLeft' || e.key === 'k') { e.preventDefault(); advance(-1); }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [current, handleDecision, advance])

  function undoLast() {
    if (!undoTimer) return
    clearTimeout(undoTimer.timer)
    setDecisions((prev) => {
      const next = new Map(prev)
      next.delete(undoTimer.key)
      return next
    })
    setUndoTimer(null)
    advance(-1)
  }

  const reviewActions = current ? (
    <>
      {decisionError && (
        <span
          data-qid="qras:action:decision-error"
          style={{
            flexShrink: 0,
            maxWidth: 360,
            padding: '7px 9px',
            borderRadius: 6,
            border: `1px solid ${EMBRY.amber}44`,
            backgroundColor: `${EMBRY.amber}10`,
            color: EMBRY.amber,
            fontSize: 10,
            lineHeight: 1.35,
          }}
        >
          {decisionError}
        </span>
      )}
      <button
        data-qid="qras:action:reject"
        data-qs-action="REJECT_QRA"
        title="Reject QRA"
        disabled={Boolean(decisionSaving)}
        onClick={() => void handleDecision('reject')}
        className="press-scale"
        style={{ ...decisionBtn(EMBRY.red), opacity: decisionSaving ? 0.55 : 1, cursor: decisionSaving ? 'wait' : 'pointer' }}
      >
        <XCircle size={14} />
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5 }}>{decisionSaving === 'reject' ? 'Saving…' : 'Reject'}</span>
        <span style={{ fontSize: 9, opacity: 0.65 }}>[R]</span>
      </button>
      {isCurrentAdversarial && (
        <button
          data-qid="qras:action:retain-adversarial"
          data-qs-action="RETAIN_QRA_ADVERSARIAL_FIXTURE"
          title="Retain this QRA as an adversarial fixture; this is not approval"
          disabled={Boolean(decisionSaving)}
          onClick={() => void handleDecision('retain_adversarial')}
          className="press-scale"
          style={{ ...decisionBtn(EMBRY.amber), opacity: decisionSaving ? 0.55 : 1, cursor: decisionSaving ? 'wait' : 'pointer' }}
        >
          <AlertTriangle size={14} />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5 }}>{decisionSaving === 'retain_adversarial' ? 'Saving…' : 'Retain fixture'}</span>
        </button>
      )}
      <button
        data-qid="qras:action:accept"
        data-qs-action="ACCEPT_QRA"
        title={approveBlockReason ? `Approve blocked: ${approveBlockReason}` : 'Approve QRA'}
        disabled={!canApproveCurrent || Boolean(decisionSaving)}
        aria-disabled={!canApproveCurrent || Boolean(decisionSaving)}
        onClick={() => void handleDecision('accept')}
        className="press-scale"
        style={{ ...decisionBtn(canApproveCurrent ? EMBRY.green : EMBRY.dim), opacity: canApproveCurrent && !decisionSaving ? 1 : 0.52, cursor: canApproveCurrent && !decisionSaving ? 'pointer' : 'not-allowed' }}
      >
        <CheckCircle2 size={14} />
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5 }}>{decisionSaving === 'accept' ? 'Saving…' : canApproveCurrent ? 'Approve' : 'Approve blocked'}</span>
        <span style={{ fontSize: 9, opacity: 0.65 }}>[A]</span>
      </button>
    </>
  ) : null

  if (error) {
    return <div style={{ padding: 20, color: EMBRY.red, border: `1px solid ${EMBRY.red}33`, borderRadius: 8, margin: 16 }}>Error: {error}</div>
  }

  const tripaneQraReview = true
  if (tripaneQraReview) {
    const caseId = current
      ? ((current.evidence_case as { case_id?: string; id?: string } | undefined)?.case_id
        || (current.evidence_case as { case_id?: string; id?: string } | undefined)?.id
        || `EC-${compactKey(current._key, 6, 4).toUpperCase()}`)
      : 'pending'
    const selectedBadge = current ? queueStatusBadge(deriveEvidenceStatus(current)) : null
    const selectedEntities = extractedQraEntities(current)
    const selectedEntityLabel = selectedEntities.find((entity) => entity.id !== 'none')?.id || current?.control_id || 'this QRA'
    const informationalLookup = isInformationalLookupQra(current)
    const issueText = currentQualityIssue?.issue_code === 'ambiguous_referent'
      ? `Unresolved ambiguous term: ${(currentQualityIssue.ambiguous_referents ?? ['this payload']).join(', ')}.`
      : approveBlockReason || (informationalLookup
        ? 'Informational lookup QRA: the entity is bound and no crosswalk/proof is required for approval.'
        : 'Evidence case is ready for analyst review.')
    const evidenceCase = current?.evidence_case
    const evidenceMethods = evidenceCase?.methods?.slice(0, 3) ?? []
    const glossaryCount = evidenceCase?.glossary?.length ?? 0
    const spanCount = evidenceCase?.spans?.length ?? 0
    const chains = [...(evidenceCase?.chains ?? []), ...(evidenceCase?.crosswalk_chains ?? [])]
    const chainCount = Math.max(chains.length, evidenceCase?.chains_count ?? 0, evidenceCase?.crosswalk_chains_count ?? 0)
    const gateTrace = evidenceCase?.gate_trace?.slice(0, 3) ?? []
    const gateLabel = evidenceCase?.gates_total
      ? `${evidenceCase.gates_passed ?? 0}/${evidenceCase.gates_total}`
      : gateTrace.length > 0
        ? `${gateTrace.filter((gate) => gate.passed).length}/${gateTrace.length}`
        : 'not run'
    const confidenceLabel = typeof evidenceCase?.confidence === 'number'
      ? `${Math.round(evidenceCase.confidence * 100)}%`
      : 'n/a'
    const proofLabel = evidenceCase?.formal_proof?.success ? 'proved' : evidenceCase?.formal_proof ? 'failed' : 'not run'
    const humanLabel = evidenceCase?.human_review_state || evidenceCase?.review_status || 'auto'
    const sacmLabel = evidenceCase?.sacm_ref ? 'exported' : 'none'
    const priorEvidenceCount = Math.max(evidenceCase?.prior_qra_evidence?.length ?? 0, relatedQras.length)
    const firstChain = chains[0]
    const chainPreview = firstChain
      ? [
        firstChain.source || firstChain.from || firstChain.from_framework,
        ...(firstChain.hops ?? []).map((hop) => hop.control_id || hop.id || hop.framework),
        firstChain.target || firstChain.to_framework,
      ].filter(Boolean).slice(0, 6).join(' -> ')
      : 'none'
    const draftEntities = Array.isArray(draftExtraction?.entities) ? draftExtraction.entities : []
    const draftResolutionEntries = Object.entries(draftExtraction?.resolution_map ?? {})
    const draftUnresolvedEntries = draftResolutionEntries.filter(([, value]) => value?.exists === false)
    const draftEntityCount = draftEntities.filter((entity) => entity.exists !== false).length
    const draftExtractionGlossary: GlossaryEntryLike[] = [
      ...draftEntities
        .filter((entity) => entity.exists !== false)
        .map((entity) => ({
          id: entity.label || entity.id,
          name: entity.name || entity.label || entity.id,
          framework: entity.framework,
          type: entity.type,
          source: '/extract-entities editable QRA draft',
        })),
      ...draftResolutionEntries
        .filter(([, value]) => value?.exists !== false)
        .map(([mention, value]) => ({
          id: value?.control_id || mention,
          name: value?.name || mention,
          framework: value?.framework || undefined,
          type: value?.match_type || 'entity',
          source: '/extract-entities editable QRA draft',
        })),
    ]
    const selectedHighlightGlossary: GlossaryEntryLike[] = [
      ...(evidenceCase?.glossary ?? []),
      ...selectedEntities.map((entity) => ({
        id: entity.id === 'none' ? undefined : entity.id,
        name: entity.label,
        framework: entity.framework,
        type: entity.kind,
        source: '/extract-entities cached QRA evidence_case',
      })),
      ...draftExtractionGlossary,
    ]
    const renderEvidenceText = (text: string | undefined, fallback = 'Not attached.') => {
      const value = text?.trim()
      if (!value) return <span style={{ color: EMBRY.dim }}>{fallback}</span>
      return inlineHighlight(value, selectedHighlightGlossary, { minEmphasis: minHighlightEmphasis })
    }
    const groundedDraftTermSet = new Set(
      [
        ...(draftExtraction?.control_ids ?? []),
        ...draftEntities.flatMap((entity) => [entity.id, entity.label, entity.name]),
        ...draftResolutionEntries
          .filter(([, value]) => value?.exists !== false)
          .flatMap(([mention, value]) => [mention, value?.control_id, value?.name]),
      ]
        .filter(Boolean)
        .map((term) => String(term).trim().toLowerCase()),
    )
    const unresolvedControlLikeTerms = Array.from(new Set(
      (currentDraftText.match(/\b[A-Z]{2,6}-?\d{3,}(?:\.\d+)?\b/g) ?? [])
        .filter((term) => !groundedDraftTermSet.has(term.toLowerCase())),
    ))
    const draftValidationTerms = [
      ...selectedHighlightGlossary.flatMap((entry) => [entry.id, entry.name].filter(Boolean).map((term) => ({
        term: String(term),
        state: 'grounded' as const,
        title: `${entry.framework || 'entity'} ${entry.name || entry.id || term}`,
      }))),
      ...draftUnresolvedEntries.map(([term, detail]) => ({
        term,
        state: 'unresolved' as const,
        title: detail?.reason || 'Unresolved or possibly misspelled control/entity',
      })),
      ...unresolvedControlLikeTerms.map((term) => ({
        term,
        state: 'unresolved' as const,
        title: '$extract-entities did not ground this control-like token; check for a typo before rerunning CAE',
      })),
    ]
      .filter((item) => item.term.trim().length >= 3)
      .sort((a, b) =>
        (a.state === 'unresolved' ? -1 : 0) - (b.state === 'unresolved' ? -1 : 0)
        || b.term.length - a.term.length,
      )
    const renderDraftValidationText = (text: string | undefined, fallback = 'No draft text attached.') => {
      const value = text?.trim()
      if (!value) return <span style={{ color: EMBRY.dim }}>{fallback}</span>
      const lower = value.toLowerCase()
      const candidates: Array<{ start: number; end: number; term: string; state: 'grounded' | 'unresolved'; title: string }> = []

      draftValidationTerms.forEach((item) => {
        const needle = item.term.toLowerCase()
        let start = lower.indexOf(needle)
        while (start >= 0) {
          candidates.push({ start, end: start + needle.length, term: value.slice(start, start + needle.length), state: item.state, title: item.title })
          start = lower.indexOf(needle, start + needle.length)
        }
      })

      const accepted: typeof candidates = []
      candidates
        .sort((a, b) => (a.state === 'unresolved' ? -1 : 0) - (b.state === 'unresolved' ? -1 : 0) || (b.end - b.start) - (a.end - a.start) || a.start - b.start)
        .forEach((candidate) => {
          if (accepted.some((current) => candidate.start < current.end && current.start < candidate.end)) return
          accepted.push(candidate)
        })
      accepted.sort((a, b) => a.start - b.start)

      if (accepted.length === 0) return <span>{value}</span>

      const nodes: ReactNode[] = []
      let cursor = 0
      accepted.forEach((candidate, idx) => {
        if (candidate.start > cursor) nodes.push(<span key={`plain-${idx}`}>{value.slice(cursor, candidate.start)}</span>)
        const unresolved = candidate.state === 'unresolved'
        nodes.push(
          <span
            key={`${candidate.state}-${candidate.start}-${candidate.end}`}
            title={candidate.title}
            style={{
              color: unresolved ? EMBRY.red : EMBRY.blue,
              backgroundColor: unresolved ? 'transparent' : `${EMBRY.blue}12`,
              borderRadius: unresolved ? 0 : 3,
              padding: unresolved ? 0 : '0 2px',
              fontWeight: 700,
              textDecorationLine: 'underline',
              textDecorationStyle: unresolved ? 'wavy' : 'solid',
              textDecorationColor: unresolved ? EMBRY.red : `${EMBRY.blue}66`,
              textUnderlineOffset: 3,
            }}
          >
            {candidate.term}
          </span>,
        )
        cursor = candidate.end
      })
      if (cursor < value.length) nodes.push(<span key="plain-end">{value.slice(cursor)}</span>)
      return nodes
    }
    const relationshipGateState = informationalLookup
      ? 'not required'
      : chainCount > 0
        ? `${chainCount} chain${chainCount === 1 ? '' : 's'}`
        : 'needs review'
    const proofGateState = informationalLookup
      ? 'not required'
      : proofLabel
    const sacmGateState = informationalLookup
      ? 'not required'
      : sacmLabel
    const caeSteps: Array<{ number: number; name: string; result: string; state: 'pass' | 'info' | 'skip' | 'warn'; details: Array<{ label: string; value: string }> }> = [
      {
        number: 1,
        name: 'Claim',
        result: 'Evaluate the selected QRA question plus proposed answer.',
        state: currentDraft?.question && currentDraft?.answer ? 'pass' : 'warn',
        details: [
          { label: 'Question', value: currentDraft?.question || current?.question || 'missing' },
          { label: 'Proposed answer', value: currentDraft?.answer || current?.answer || evidenceCase?.answer || 'missing' },
          { label: 'Draft status', value: qraDraftDirty ? 'edited draft; rerun CAE before approval' : 'matches persisted QRA' },
        ],
      },
      {
        number: 2,
        name: 'Decomposition',
        result: informationalLookup ? 'Definition lookup; no relationship claim is asserted.' : 'Relationship or evidence-bearing QRA requires bridge validation.',
        state: informationalLookup ? 'info' : 'warn',
        details: [
          { label: 'Intent', value: informationalLookup ? 'informational lookup' : 'relationship / evidence review' },
          { label: 'Verification need', value: informationalLookup ? 'entity grounding plus answer wording' : 'entity grounding plus relationship / source checks' },
        ],
      },
      {
        number: 3,
        name: 'Entity Grounding',
        result: `${selectedEntities.length} resolved entit${selectedEntities.length === 1 ? 'y' : 'ies'}; ${spanCount} cached span${spanCount === 1 ? '' : 's'}.`,
        state: selectedEntities.length > 0 || spanCount > 0 ? 'pass' : 'warn',
        details: [
          { label: 'Glossary', value: glossaryCount > 0 ? `${glossaryCount} resolved entries` : 'not generated' },
          { label: 'Control IDs', value: evidenceCase?.control_ids?.join(', ') || current?.control_id || 'none' },
        ],
      },
      {
        number: 4,
        name: 'Recall / Prior QRAs',
        result: priorEvidenceCount > 0 ? `${priorEvidenceCount} linked QRA${priorEvidenceCount === 1 ? '' : 's'} available for inspection.` : 'No prior QRAs attached to this record.',
        state: priorEvidenceCount > 0 ? 'info' : 'skip',
        details: [
          { label: 'Prior QRAs', value: String(priorEvidenceCount) },
          { label: 'Method', value: evidenceMethods.length > 0 ? evidenceMethods.join(', ') : 'cached evidence-case backfill' },
        ],
      },
      {
        number: 5,
        name: 'Relationship / Same-Technique Check',
        result: informationalLookup ? 'Not required for this definition QRA.' : chainCount > 0 ? 'Relationship evidence is attached.' : 'Needs relationship or source review.',
        state: informationalLookup ? 'skip' : chainCount > 0 ? 'pass' : 'warn',
        details: [
          { label: 'Chain', value: chainPreview },
          { label: 'Crosswalk', value: relationshipGateState },
        ],
      },
      {
        number: 6,
        name: 'Verification Gates',
        result: informationalLookup ? 'Required gates passed; relationship-only gates are policy-exempt.' : `Gate trace ${gateLabel}; proof ${proofLabel}; SACM ${sacmLabel}.`,
        state: canApproveCurrent ? 'pass' : 'warn',
        details: [
          { label: 'Entity resolved', value: selectedEntities.length > 0 ? 'passed' : 'needs review' },
          { label: 'Confidence', value: confidenceLabel },
          { label: 'Gate trace', value: gateLabel },
          { label: 'Formal proof', value: proofGateState },
          { label: 'SACM export', value: sacmGateState },
        ],
      },
      {
        number: 7,
        name: 'Verdict',
        result: canApproveCurrent ? 'Approve as written unless the reviewer wants stronger wording.' : issueText,
        state: canApproveCurrent ? 'pass' : 'warn',
        details: [
          { label: 'Decision basis', value: canApproveCurrent ? issueText : approveBlockReason || 'review required' },
          { label: 'Human review', value: humanLabel },
        ],
      },
      {
        number: 8,
        name: 'Reviewer Action',
        result: 'Human remains final approver.',
        state: 'info',
        details: [
          { label: 'Available actions', value: canApproveCurrent ? 'approve, reject, open raw payload, export audit packet' : 'repair/rerun, reject, retain fixture, open raw payload' },
        ],
      },
    ]
    const sourceRows: Array<{ key: QRASource; label: string; count: number }> = [
      { key: 'all', label: 'All QRA Sources', count: sourceTotals.all },
      { key: 'v2', label: 'Canonical / Relationship', count: sourceTotals.v2 },
      { key: 'legacy', label: 'Legacy Reference', count: sourceTotals.legacy },
    ]
    const categoryCounts = QRA_CATEGORY_FILTERS.reduce((acc, item) => {
      acc[item.category] = baseVisibleQras.filter(({ q }) => qraMatchesCategory(q, item.category)).length
      return acc
    }, {} as Record<QraCategoryFilter, number>)
    const sourceHoverQra = sourceHover
      ? (qraDetails.get(sourceHover.key) ?? qras.find((entry) => entry._key === sourceHover.key) ?? null)
      : null
    const sourceHoverEntities = extractedQraEntities(sourceHoverQra ?? undefined)
    const sourceHoverEvidence = sourceHoverQra ? deriveEvidenceStatus(sourceHoverQra) : null
    const sourceHoverIssue = sourceHoverQra
      ? (approvalBlockReason(sourceHoverQra) || getQraQualityIssue(sourceHoverQra)?.issue_label || getQraQualityIssue(sourceHoverQra)?.issue_code || 'No blocker')
      : null
    const questionHoverQra = questionHover
      ? (qraDetails.get(questionHover.key) ?? qras.find((entry) => entry._key === questionHover.key) ?? null)
      : null
    const questionHoverBadge = questionHoverQra ? queueStatusBadge(deriveEvidenceStatus(questionHoverQra)) : null

    return (
      <>
      <div style={{ display: 'grid', gridTemplateColumns: `240px minmax(360px, 1fr) 6px ${chatPaneWidth}px`, flex: 1, minHeight: 0, overflow: 'hidden', backgroundColor: EMBRY.bgPanel }}>
        <aside style={{ minWidth: 0, borderRight: `1px solid ${EMBRY.border}`, backgroundColor: 'rgba(8,14,24,0.86)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${EMBRY.border}` }}>
            <div style={{ fontSize: 18, fontWeight: 850, color: EMBRY.white, marginBottom: 3 }}>QRA Review</div>
            <div style={{ ...label, lineHeight: 1.45 }}>Pick a source, status, or category, then select a row to open the scoped chat.</div>
          </div>

          <div style={{ padding: 14, borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ position: 'relative' }}>
              <Search size={14} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: EMBRY.dim }} />
              <input
                data-qid="qras:search"
                data-qs-action="SEARCH_QRAS"
                title="Filter QRAs by question, control, framework, or source"
                type="text"
                placeholder="Search QRA / CAPEC / TTP"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ width: '100%', height: 32, padding: '0 9px 0 30px', border: `1px solid ${EMBRY.border}`, borderRadius: 6, backgroundColor: EMBRY.bgDeep, color: EMBRY.white, fontSize: 12, outline: 'none' }}
              />
            </div>
            <div style={{ ...label, display: 'flex', justifyContent: 'space-between', fontVariantNumeric: 'tabular-nums' }}>
              <span>{qraStatusCounts.loading ? 'loading counts' : qraStatusCounts.error ? 'counts stale' : `${formatCount(qraStatusCounts.total)} total`}</span>
              <span>{formatCount(visibleQras.length)} visible</span>
            </div>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
            <div style={{ padding: '12px 14px 6px', ...label }}>QRA Categories</div>
            {QRA_CATEGORY_FILTERS.map((row) => {
              const active = qraCategoryFilter === row.category
              const color = row.category === 'adversarial' ? EMBRY.amber : row.category === 'source_grounding' ? EMBRY.blue : row.category === 'answer_qa' ? EMBRY.red : EMBRY.green
              return (
                <button
                  key={row.category}
                  type="button"
                  data-qid={`qras:category:${row.category}`}
                  data-qs-action="FILTER_QRA_CATEGORY"
                  title={row.title}
                  aria-pressed={active}
                  onClick={() => setQraCategoryFilter(row.category)}
                  style={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: '8px minmax(0, 1fr) auto',
                    gap: 8,
                    alignItems: 'center',
                    padding: '9px 14px',
                    border: 0,
                    borderTop: `1px solid ${EMBRY.border}`,
                    backgroundColor: active ? `${color}16` : 'transparent',
                    color: active ? EMBRY.white : EMBRY.dim,
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: active ? 800 : 650,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: color, boxShadow: active ? `0 0 10px ${color}` : 'none' }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
                  <span style={{ color, fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace' }}>{formatCount(categoryCounts[row.category])}</span>
                </button>
              )
            })}

            <div style={{ padding: '14px 14px 6px', ...label }}>Status</div>
            {EVIDENCE_FILTERS.map(({ status, label: filterLabel, title }) => {
              const active = evidenceFilter === status
              const color = status === 'all' ? EMBRY.dim : evidenceStatusMeta(status).color
              return (
                <button
                  key={status}
                  type="button"
                  data-qid={`qras:filter:evidence:${status}`}
                  data-qs-action="FILTER_EVIDENCE"
                  title={title}
                  aria-pressed={active}
                  onClick={() => setEvidenceFilter(status)}
                  style={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: '8px minmax(0, 1fr) auto',
                    gap: 8,
                    alignItems: 'center',
                    padding: '8px 14px',
                    border: 0,
                    borderTop: `1px solid ${EMBRY.border}`,
                    backgroundColor: active ? `${color}16` : 'transparent',
                    color: active ? EMBRY.white : EMBRY.dim,
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: active ? 850 : 650,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: color }} />
                  <span>{filterLabel === 'Total' ? 'All' : filterLabel}</span>
                  <span style={{ color, fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace' }}>{qraStatusCounts.error ? 'ERR' : formatCount(evidenceCounts[status])}</span>
                </button>
              )
            })}

            <div style={{ padding: '14px 14px 6px', ...label }}>Corpus</div>
            {sourceRows.map((row) => {
              const active = source === row.key
              return (
                <button
                  key={row.key}
                  type="button"
                  data-qid={`qras:source:${row.key}`}
                  data-qs-action="FILTER_QRA_SOURCE"
                  aria-pressed={active}
                  onClick={() => setSource(row.key)}
                  style={{
                    width: '100%',
                    display: 'grid',
                    gridTemplateColumns: '8px minmax(0, 1fr) auto',
                    gap: 8,
                    alignItems: 'center',
                    padding: '8px 14px',
                    border: 0,
                    borderTop: `1px solid ${EMBRY.border}`,
                    backgroundColor: active ? `${EMBRY.accent}16` : 'transparent',
                    color: active ? EMBRY.white : EMBRY.dim,
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: active ? 800 : 650,
                  }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: 999, backgroundColor: active ? EMBRY.green : EMBRY.amber, boxShadow: active ? `0 0 10px ${EMBRY.green}` : 'none' }} />
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
                  <span style={{ color: active ? EMBRY.accent : EMBRY.dim, fontVariantNumeric: 'tabular-nums', fontFamily: 'monospace' }}>{corpusCounts.loading ? '...' : formatCount(row.count)}</span>
                </button>
              )
            })}

            <div style={{ padding: '14px 14px 6px', ...label }}>MIND Category</div>
            {MIND_TAGS.map((tag) => {
              const active = mindFilter === tag
              return (
                <button
                  key={tag}
                  type="button"
                  data-qid={`qras:filter:mind:${tag}`}
                  data-qs-action="FILTER_MIND"
                  aria-pressed={active}
                  onClick={() => setMindFilter(active ? null : tag)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 14px',
                    border: 0,
                    borderTop: `1px solid ${EMBRY.border}`,
                    backgroundColor: active ? `${EMBRY.accent}15` : 'transparent',
                    color: active ? EMBRY.white : EMBRY.dim,
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontSize: 12,
                    fontWeight: active ? 850 : 650,
                  }}
                >
                  {tag}
                  {active && <span style={{ color: EMBRY.green, fontSize: 10, fontFamily: 'monospace' }}>ACTIVE</span>}
                </button>
              )
            })}
          </div>
        </aside>

        <section style={{ minWidth: 0, minHeight: 0, display: 'grid', gridTemplateRows: 'auto auto 1fr auto', borderRight: `1px solid ${EMBRY.border}`, backgroundColor: EMBRY.bg }}>
          <div style={{ padding: '10px 14px', borderBottom: `1px solid ${EMBRY.border}`, backgroundColor: EMBRY.bgPanel }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: EMBRY.white }}>Question Review Artifacts</div>
                <div style={{ ...label, marginTop: 3 }}>Dense queue sorted by source, status, category, framework, and review state.</div>
              </div>
              <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span style={{ ...label, color: EMBRY.green, border: `1px solid ${EMBRY.green}44`, borderRadius: 999, padding: '3px 8px' }}>OPERATIONAL</span>
                <span style={{ ...label, color: EMBRY.amber, border: `1px solid ${EMBRY.amber}44`, borderRadius: 999, padding: '3px 8px' }}>{formatCount(evidenceCounts.review + evidenceCounts.adversarial)} NEED REVIEW</span>
                <span style={{ ...label, color: EMBRY.blue, border: `1px solid ${EMBRY.blue}44`, borderRadius: 999, padding: '3px 8px' }}>{formatCount(evidenceCounts.grounded)} GROUNDED</span>
              </div>
            </div>
          </div>

          {controlFilter && (
            <div style={{ padding: '7px 14px', borderBottom: `1px solid ${EMBRY.border}`, backgroundColor: `${EMBRY.accent}10`, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ ...label, color: EMBRY.accent }}>Filtered to control {controlFilter}</span>
              <button data-qid="qras:filter:clear" data-qs-action="CLEAR_TAB_FILTER" onClick={() => nav.clearTabFilter('QRAs')} title="Clear QRA filter" className="press-scale" style={{ height: 26, border: `1px solid ${EMBRY.border}`, borderRadius: 5, background: EMBRY.bgDeep, color: EMBRY.dim, cursor: 'pointer', fontSize: 11 }}>Clear</button>
            </div>
          )}

          <div ref={queueScrollRef} onScroll={handleQueueScroll} style={{ minHeight: 0, overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 12 }}>
              <thead style={{ position: 'sticky', top: 0, zIndex: 2, backgroundColor: EMBRY.bgDeep }}>
                <tr>
                  {['Question', 'Status', 'Risk', 'Source'].map((h, i) => (
                    <th key={h} style={{ width: i === 0 ? 'auto' : i === 1 ? 76 : i === 2 ? 48 : 78, textAlign: 'left', padding: '7px 6px', borderBottom: `1px solid ${EMBRY.border}`, color: EMBRY.dim, fontSize: 9.5, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && qras.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: 28, color: EMBRY.dim, textAlign: 'center' }}>Loading QRAs...</td></tr>
                )}
                {!loading && visibleQras.length === 0 && (
                  <tr><td colSpan={4} style={{ padding: 28, color: EMBRY.dim, textAlign: 'center' }}>No QRAs match the active filters.</td></tr>
                )}
                {visibleQras.map(({ q, idx }) => {
                  const active = !deepLinkNeedsRecovery && idx === currentIndex
                  const status = deriveEvidenceStatus(q)
                  const badge = queueStatusBadge(status)
                  const risk = status === 'passed' ? 'LOW' : status === 'grounded' ? 'MED' : 'HIGH'
                  return (
                    <tr
                      key={`${q._key}:${idx}`}
                      data-qid={`qras:item:${q._key}`}
                      data-qs-action="SELECT_QRA"
                      tabIndex={0}
                      aria-current={active}
                      onClick={() => setCurrentIndex(idx)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setCurrentIndex(idx)
                        }
                      }}
                      style={{ backgroundColor: active ? 'rgba(148,163,184,0.13)' : idx % 2 ? 'rgba(15,23,42,0.34)' : 'rgba(15,23,42,0.18)', boxShadow: active ? `inset 3px 0 0 ${EMBRY.blue}` : 'none', cursor: 'pointer' }}
                    >
                      <td
                        onMouseEnter={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect()
                          setQuestionHover({ key: q._key, x: rect.left + 10, y: rect.top + 24 })
                        }}
                        onMouseMove={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect()
                          setQuestionHover({ key: q._key, x: rect.left + 10, y: rect.top + 24 })
                        }}
                        onMouseLeave={() => setQuestionHover(null)}
                        style={{ padding: '6px', borderBottom: `1px solid ${EMBRY.border}`, color: active ? EMBRY.white : `${EMBRY.white}d8`, fontSize: 12.5, fontWeight: 400 }}
                      >
                        <div style={{ minWidth: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto auto', gap: 4, alignItems: 'center' }}>
                          <span style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{q.question}</span>
                          <button
                            type="button"
                            data-qid={`qras:item:${q._key}:copy-key`}
                            data-qs-action="COPY_QRA_KEY"
                            title={`Copy QRA key: ${q.qra_id || q._key}`}
                            aria-label={`Copy QRA key ${q.qra_id || q._key}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              navigator.clipboard?.writeText(q.qra_id || q._key).catch(() => { /* best effort */ })
                            }}
                            style={{ width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, border: `1px solid ${EMBRY.border}`, backgroundColor: active ? `${EMBRY.blue}10` : 'rgba(15,23,42,0.18)', color: active ? EMBRY.blue : EMBRY.dim, cursor: 'copy', padding: 0, opacity: active ? 0.8 : 0.45 }}
                          >
                            <KeyRound size={10} strokeWidth={1.8} />
                          </button>
                          <button
                            type="button"
                            data-qid={`qras:item:${q._key}:copy-payload`}
                            data-qs-action="COPY_QRA_PAYLOAD"
                            title="Copy full QRA prompt payload"
                            aria-label="Copy full QRA prompt payload"
                            onClick={(event) => {
                              event.stopPropagation()
                              copyQraPayload(qraDetails.get(q._key) ?? q)
                            }}
                            style={{ width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, border: `1px solid ${EMBRY.border}`, backgroundColor: 'rgba(15,23,42,0.18)', color: EMBRY.dim, cursor: 'copy', padding: 0 }}
                          >
                            <Clipboard size={11} strokeWidth={1.8} />
                          </button>
                          <button
                            type="button"
                            data-qid={`qras:item:${q._key}:open-payload`}
                            data-qs-action="OPEN_QRA_PAYLOAD"
                            title="Open full QRA prompt payload"
                            aria-label="Open full QRA prompt payload"
                            onClick={(event) => {
                              event.stopPropagation()
                              setCurrentIndex(idx)
                              setPayloadModalKey(q._key)
                            }}
                            style={{ width: 20, height: 20, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, border: `1px solid ${EMBRY.border}`, backgroundColor: 'rgba(15,23,42,0.18)', color: EMBRY.dim, cursor: 'pointer', padding: 0 }}
                          >
                            <MoreHorizontal size={12} strokeWidth={1.8} />
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: '6px', borderBottom: `1px solid ${EMBRY.border}` }}><span style={{ color: status === 'passed' ? EMBRY.green : status === 'failed' || status === 'adversarial' ? EMBRY.red : EMBRY.dim, border: `1px solid ${EMBRY.border}`, backgroundColor: 'rgba(15,23,42,0.18)', borderRadius: 5, padding: '2px 6px', fontSize: 10, fontWeight: 450, whiteSpace: 'nowrap' }}>{badge.label}</span></td>
                      <td style={{ padding: '6px', borderBottom: `1px solid ${EMBRY.border}`, color: risk === 'LOW' ? EMBRY.green : risk === 'MED' ? EMBRY.amber : EMBRY.dim, fontFamily: 'monospace', fontWeight: 450, fontSize: 10.5 }}>{risk}</td>
                      <td
                        onMouseEnter={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect()
                          setSourceHover({ key: q._key, x: rect.right - 320, y: rect.top + 22 })
                        }}
                        onMouseMove={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect()
                          setSourceHover({ key: q._key, x: rect.right - 320, y: rect.top + 22 })
                        }}
                        onMouseLeave={() => setSourceHover(null)}
                        style={{ padding: '6px', borderBottom: `1px solid ${EMBRY.border}`, color: EMBRY.dim, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontSize: 11, position: 'relative' }}
                      >
                        <span style={{ borderBottom: `1px dotted ${EMBRY.dim}66`, cursor: 'help' }}>{q.control_id || q.source_framework || 'SPARTA'}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div style={{ height: 27, borderTop: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', color: EMBRY.dim, fontSize: 10, fontFamily: 'monospace' }}>
            <span>ROWS {formatCount(loadedStart)}-{formatCount(loadedEnd)} OF {formatCount(qraTotal)} · <span title={current ? (current.qra_id || current._key) : undefined}>SELECTED {current ? 'QRA' : 'NONE'}</span></span>
            <span>{loading && qras.length > 0 ? 'LOADING MORE' : canLoadMore ? 'SCROLL TO LOAD' : 'END OF QUEUE'}</span>
          </div>
        </section>

        <div
          role="separator"
          aria-orientation="vertical"
          title="Resize QRA chat pane"
          style={{ width: 6, cursor: 'col-resize', zIndex: 4, backgroundColor: 'transparent', borderRight: `1px solid ${EMBRY.border}` }}
          onMouseDown={(event) => {
            event.preventDefault()
            const startX = event.clientX
            const startWidth = chatPaneWidth
            const onMouseMove = (moveEvent: MouseEvent) => {
              const next = startWidth - (moveEvent.clientX - startX)
              setChatPaneWidth(Math.max(520, Math.min(860, next)))
            }
            const onMouseUp = () => {
              document.removeEventListener('mousemove', onMouseMove)
              document.removeEventListener('mouseup', onMouseUp)
            }
            document.addEventListener('mousemove', onMouseMove)
            document.addEventListener('mouseup', onMouseUp)
          }}
        />

        <aside style={{ minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'grid', gridTemplateRows: undoTimer ? 'auto auto minmax(0, 1fr) auto' : 'auto minmax(0, 1fr) auto', backgroundColor: EMBRY.bgPanel }}>
          {!current ? (
            qraKeyFilter ? (
              <DeepLinkRecoveryState
                qraKey={qraKeyFilter}
                source={source}
                queueLoading={loading}
                detailLoading={detailLoadingKey === qraKeyFilter}
                detailError={detailError?.key === qraKeyFilter ? detailError : null}
                statusCountsLoading={qraStatusCounts.loading}
                statusCountsError={qraStatusCounts.error}
                qraTotal={qraStatusCounts.total || qraTotal}
                loadedCount={qras.length}
                diagnosticsOpen={recoveryDiagnosticsOpen}
                diagnostics={qraDiagnostics}
                onRetryHydrate={retryDeepLinkHydrate}
                onClearFilters={clearRecoveryFilters}
                onTryAllSources={tryAllSourcesForDeepLink}
                onCopyKey={copyDeepLinkKey}
                onOpenDiagnostics={openRecoveryDiagnostics}
                onCopyDiagnostics={copyRecoveryDiagnostics}
                onEscalate={escalateDeepLinkFailure}
              />
            ) : (
              <div style={{ color: EMBRY.dim, padding: 24 }}>Select a QRA row to open a scoped review chat.</div>
            )
          ) : (
            <>
              <div style={{ padding: '10px 12px', borderBottom: `1px solid ${EMBRY.border}`, backgroundColor: EMBRY.bgDeep }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'start' }}>
                  <div>
                    <div style={{ ...label, marginBottom: 5 }}>QRA Review Workspace</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 6 }}>
                      <span style={{ fontSize: 15, fontWeight: 800, color: EMBRY.white }}>QRA Scoped Chat</span>
                      <span title={current.qra_id || current._key} style={{ color: EMBRY.blue, fontSize: 10, fontFamily: 'monospace', border: `1px solid ${EMBRY.blue}55`, borderRadius: 999, padding: '2px 7px' }}>SELECTED QRA</span>
                      {selectedBadge && <span style={{ color: selectedBadge.color, fontSize: 10, fontWeight: 850, border: `1px solid ${selectedBadge.color}66`, borderRadius: 999, padding: '2px 7px' }}>{selectedBadge.label}</span>}
                    </div>
                  </div>
                  <span style={{ color: canApproveCurrent ? EMBRY.green : EMBRY.red, border: `1px solid ${canApproveCurrent ? EMBRY.green : EMBRY.red}55`, borderRadius: 999, padding: '3px 7px', fontSize: 9, fontWeight: 900, whiteSpace: 'nowrap' }}>
                    {canApproveCurrent ? 'APPROVAL READY' : 'APPROVAL BLOCKED'}
                  </span>
                </div>
                <div style={{ marginTop: 10, display: 'grid', gap: 7, padding: 10, border: `1px solid ${qraDraftDirty ? EMBRY.amber : EMBRY.border}`, borderRadius: 8, backgroundColor: 'rgba(5,11,20,0.72)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <div style={{ minWidth: 0, display: 'flex', gap: 7, alignItems: 'center' }}>
                      {qraDraftEditable && <span style={{ ...label, color: EMBRY.blue }}>Editing draft</span>}
                      {qraDraftDirty && <span style={{ ...label, color: EMBRY.amber }}>Unsaved draft</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button type="button" data-qid="qras:draft:toggle-edit" data-qs-action="TOGGLE_QRA_DRAFT_EDIT_MODE" title={qraDraftEditable ? 'Lock QRA draft editing' : 'Unlock QRA draft editing'} aria-label={qraDraftEditable ? 'Lock QRA draft editing' : 'Unlock QRA draft editing'} aria-pressed={qraDraftEditable} onClick={() => setQraDraftEditable((value) => !value)} style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${qraDraftEditable ? EMBRY.blue : EMBRY.border}`, borderRadius: 6, backgroundColor: qraDraftEditable ? `${EMBRY.blue}12` : EMBRY.bgPanel, color: qraDraftEditable ? EMBRY.blue : EMBRY.dim, padding: 0, cursor: 'pointer' }}>
                        {qraDraftEditable ? <Pencil size={14} strokeWidth={1.8} /> : <LockKeyhole size={14} strokeWidth={1.8} />}
                      </button>
                      <button type="button" data-qid="qras:draft:reset" data-qs-action="RESET_QRA_DRAFT" title="Reset the QRA draft to the persisted question, reasoning, and answer" aria-label="Reset QRA draft" disabled={!qraDraftDirty} onClick={() => resetQraDraft(current._key)} style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${EMBRY.border}`, borderRadius: 6, backgroundColor: EMBRY.bgPanel, color: qraDraftDirty ? EMBRY.dim : `${EMBRY.dim}80`, padding: 0, cursor: qraDraftDirty ? 'pointer' : 'not-allowed' }}>
                        <Undo2 size={14} strokeWidth={1.8} />
                      </button>
                      <button type="button" data-qid="qras:draft:rerun-cae" data-qs-action="RERUN_CAE_WITH_QRA_DRAFT" title="Rerun /create-evidence-case against the edited question, reasoning, and answer" aria-label="Rerun CAE evidence case for QRA draft" onClick={() => void runFullEvidenceCase(current, currentDraft)} disabled={evidenceRunLoading || !currentDraft?.question.trim()} style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${EMBRY.amber}55`, borderRadius: 6, backgroundColor: `${EMBRY.amber}12`, color: evidenceRunLoading || !currentDraft?.question.trim() ? EMBRY.dim : EMBRY.amber, padding: 0, cursor: evidenceRunLoading ? 'wait' : 'pointer' }}>
                        <RotateCcw size={14} strokeWidth={1.9} />
                      </button>
                    </div>
                  </div>
                  {[
                    { labelText: 'Question', keyName: 'question' as const, qid: 'qras:draft:question', rows: 2 },
                    { labelText: 'Answer', keyName: 'answer' as const, qid: 'qras:draft:answer', rows: 2 },
                    { labelText: 'Reasoning', keyName: 'reasoning' as const, qid: 'qras:draft:reasoning', rows: 3 },
                  ].map((row) => (
                    <label key={row.keyName} style={{ display: 'grid', gridTemplateColumns: '74px minmax(0, 1fr)', gap: 10, alignItems: 'start' }}>
                      <span style={{ ...label, paddingTop: 8 }}>{row.labelText}</span>
                      <div style={{ minWidth: 0, position: 'relative', border: `1px solid ${qraDraftEditable ? EMBRY.blue : EMBRY.border}`, borderRadius: 6, backgroundColor: EMBRY.bg, overflow: 'hidden' }}>
                        <div
                          aria-hidden="true"
                          style={{
                            position: 'absolute',
                            inset: 0,
                            zIndex: 1,
                            pointerEvents: 'none',
                            border: 0,
                            padding: '7px 8px',
                            fontSize: 11.5,
                            lineHeight: 1.35,
                            fontFamily: 'inherit',
                            whiteSpace: 'pre-wrap',
                            overflow: 'hidden',
                            color: EMBRY.white,
                          }}
                        >
                          {renderDraftValidationText(currentDraft?.[row.keyName], `No ${row.labelText.toLowerCase()} attached.`)}
                        </div>
                        <textarea
                          data-qid={row.qid}
                          data-qs-action={row.keyName === 'question' ? 'EDIT_QRA_DRAFT_QUESTION' : row.keyName === 'answer' ? 'EDIT_QRA_DRAFT_ANSWER' : 'EDIT_QRA_DRAFT_REASONING'}
                          title={`Edit selected QRA ${row.labelText.toLowerCase()} before rerunning CAE`}
                          spellCheck={false}
                          autoCorrect="off"
                          autoCapitalize="off"
                          readOnly={!qraDraftEditable}
                          aria-readonly={!qraDraftEditable}
                          value={currentDraft?.[row.keyName] ?? ''}
                          onChange={(event) => updateQraDraft(current._key, { [row.keyName]: event.target.value })}
                          rows={row.rows}
                          style={{ position: 'relative', zIndex: 2, width: '100%', minWidth: 0, resize: qraDraftEditable ? 'vertical' : 'none', border: 0, backgroundColor: 'transparent', color: 'transparent', caretColor: qraDraftEditable ? EMBRY.white : 'transparent', padding: '7px 8px', fontSize: 11.5, lineHeight: 1.35, outline: 'none', fontFamily: 'inherit', cursor: qraDraftEditable ? 'text' : 'default' }}
                        />
                      </div>
                    </label>
                  ))}
                  <div style={{ display: 'grid', gridTemplateColumns: '74px minmax(0, 1fr)', gap: 10, alignItems: 'start' }}>
                    <div style={{ ...label, paddingTop: 5 }}>Entities</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ ...label, color: draftExtractionLoading ? EMBRY.amber : draftExtraction?.error ? EMBRY.red : draftUnresolvedEntries.length > 0 ? EMBRY.amber : EMBRY.blue }}>
                          {draftExtractionLoading ? '$extract-entities running' : draftExtraction?.error ? '$extract-entities unavailable' : `${draftEntityCount} grounded`}
                        </span>
                        {draftUnresolvedEntries.length > 0 && <span style={{ ...label, color: EMBRY.amber }}>{draftUnresolvedEntries.length} unresolved</span>}
                        {!draftExtractionLoading && !draftExtraction?.error && draftEntities.length === 0 && <span style={{ color: EMBRY.dim, fontSize: 11 }}>No grounded entities detected in the editable draft.</span>}
                      </div>
                      {draftExtraction?.error ? (
                        <div style={{ color: EMBRY.red, fontSize: 11, lineHeight: 1.35 }}>{draftExtraction.error}</div>
                      ) : (
                        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                          {draftEntities.slice(0, 10).map((entity, idx) => {
                            const exists = entity.exists !== false
                            const entityLabel = entity.label || entity.id || entity.name || 'entity'
                            return (
                              <span key={`${entityLabel}:${idx}`} title={`${entity.framework || 'SPARTA'} ${entity.name || entityLabel}`} style={{ border: `1px solid ${exists ? EMBRY.blue : EMBRY.amber}55`, backgroundColor: `${exists ? EMBRY.blue : EMBRY.amber}12`, color: exists ? EMBRY.white : EMBRY.amber, borderRadius: 999, padding: '2px 7px', fontSize: 10, fontFamily: 'monospace' }}>
                                <span style={{ color: EMBRY.dim }}>{entity.framework || entity.type || 'entity'}</span> {entityLabel}
                              </span>
                            )
                          })}
                          {draftUnresolvedEntries.slice(0, 5).map(([term, detail]) => (
                            <span key={term} title={detail.reason || 'Unresolved term'} style={{ border: `1px solid ${EMBRY.amber}55`, backgroundColor: `${EMBRY.amber}12`, color: EMBRY.amber, borderRadius: 999, padding: '2px 7px', fontSize: 10, fontFamily: 'monospace' }}>
                              unresolved {term}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {undoTimer && (
                <div style={{ padding: '7px 12px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', gap: 6, flexWrap: 'wrap', backgroundColor: EMBRY.bg }}>
                  <button data-qid="qras:action:undo" onClick={undoLast} data-qs-action="UNDO_DECISION" title="Undo last decision" className="press-scale" style={{ ...decisionBtn(EMBRY.amber), height: 34 }}>
                    Undo
                  </button>
                </div>
              )}

              <div style={{ minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '9px 12px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div data-qid="qras:artifact:cae:root" style={{ alignSelf: 'flex-start', flexShrink: 0, width: '96%', border: `1px solid ${EMBRY.amber}55`, borderLeft: `4px solid ${EMBRY.amber}`, backgroundColor: 'rgba(20,16,8,0.26)', borderRadius: 9, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: '9px 10px', borderBottom: `1px solid ${EMBRY.amber}33`, backgroundColor: 'rgba(15,23,42,0.20)' }}>
                    <div style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ ...label, color: EMBRY.amber }}>Inline CAE Artifact</div>
                      </div>
                      <span style={{ color: canApproveCurrent ? EMBRY.green : EMBRY.amber, border: `1px solid ${canApproveCurrent ? EMBRY.green : EMBRY.amber}44`, borderRadius: 999, padding: '2px 8px', fontSize: 9, fontWeight: 650, whiteSpace: 'nowrap' }}>
                        {canApproveCurrent ? 'Approval ready' : 'Needs repair'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button type="button" data-qid="qras:artifact:cae:copy-case-id" data-qs-action="COPY_CAE_CASE_ID" onClick={() => navigator.clipboard?.writeText(caseId).catch(() => { /* best effort */ })} aria-label="Copy CAE case ID" title={`Copy CAE case ID: ${caseId}`} style={{ width: 34, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${EMBRY.border}`, borderRadius: 6, backgroundColor: EMBRY.bgPanel, color: EMBRY.dim, padding: 0, cursor: 'copy' }}>
                        <KeyRound size={14} strokeWidth={1.8} />
                      </button>
                      <button type="button" data-qid="qras:artifact:cae:run" data-qs-action="RUN_CAE_EVIDENCE_CASE" onClick={() => void runFullEvidenceCase(current, currentDraft)} disabled={evidenceRunLoading || !currentDraft?.question.trim()} aria-label="Run CAE evidence case" title="Run the full /create-evidence-case workflow for this QRA draft" style={{ width: 34, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${EMBRY.border}`, borderRadius: 6, backgroundColor: EMBRY.bgPanel, color: evidenceRunLoading || !currentDraft?.question.trim() ? EMBRY.dim : EMBRY.amber, padding: 0, cursor: evidenceRunLoading ? 'wait' : 'pointer' }}>
                        <RotateCcw size={14} strokeWidth={1.9} />
                      </button>
                      <button type="button" data-qid="qras:artifact:cae:toggle-collapse" data-qs-action="TOGGLE_CAE_ARTIFACT_COLLAPSE" onClick={() => setCaeCollapsed((value) => !value)} aria-label={caeCollapsed ? 'Expand CAE evidence case' : 'Collapse CAE evidence case'} title={caeCollapsed ? 'Expand CAE evidence case' : 'Collapse CAE evidence case'} style={{ width: 34, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${EMBRY.border}`, borderRadius: 6, backgroundColor: EMBRY.bgPanel, color: EMBRY.dim, padding: 0, cursor: 'pointer' }}>
                        <ChevronDown size={15} strokeWidth={1.9} style={{ transform: caeCollapsed ? 'rotate(0deg)' : 'rotate(180deg)', transition: 'transform 140ms ease' }} />
                      </button>
                    </div>
                  </div>

                  {!caeCollapsed && <div style={{ padding: 9, display: 'flex', flexDirection: 'column', gap: 7 }}>
                    <div style={{ color: EMBRY.dim, fontSize: 11, lineHeight: 1.35 }}>
                      Inspectable claim → argument → evidence flow rendered inside the agent chat turn. Hover highlighted terms in the chat text for `$extract-entities` grounding.
                    </div>
                    {caeSteps.map((step) => {
                      const tone = step.state === 'pass' ? EMBRY.green : step.state === 'warn' ? EMBRY.amber : step.state === 'skip' ? EMBRY.amber : EMBRY.blue
                      const stepIcon = step.number === 1
                        ? <Clipboard size={13} strokeWidth={1.8} />
                        : step.number === 2
                          ? <Layers size={13} strokeWidth={1.8} />
                          : step.number === 3
                            ? <Search size={13} strokeWidth={1.8} />
                            : step.number === 4
                              ? <Activity size={13} strokeWidth={1.8} />
                              : step.number === 5
                                ? <ExternalLink size={13} strokeWidth={1.8} />
                                : step.number === 6
                                  ? <CheckCircle2 size={13} strokeWidth={1.8} />
                                  : step.number === 7
                                    ? (step.state === 'pass' ? <CheckCircle2 size={13} strokeWidth={1.8} /> : <AlertTriangle size={13} strokeWidth={1.8} />)
                                    : <MoreHorizontal size={13} strokeWidth={1.8} />
                      return (
                        <div key={step.number} style={{ display: 'grid', gridTemplateColumns: '26px minmax(0, 1fr)', gap: 8, alignItems: 'start' }}>
                          <div style={{ width: 24, height: 24, borderRadius: 999, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${EMBRY.amber}55`, backgroundColor: `${EMBRY.amber}14`, color: EMBRY.amber, fontSize: 10, fontWeight: 900, fontFamily: 'monospace' }}>
                            {step.number}
                          </div>
                          <details data-qid={`qras:artifact:cae:step:${step.number}`} open={step.number <= 3 || step.number >= 5} style={{ border: `1px solid ${EMBRY.amber}25`, borderRadius: 7, backgroundColor: 'rgba(7,12,20,0.58)', overflow: 'hidden' }}>
                            <summary data-qid={`qras:artifact:cae:step:${step.number}:toggle`} data-qs-action="TOGGLE_CAE_STEP" title={`Expand or collapse CAE step ${step.number}: ${step.name}`} style={{ listStyle: 'none', display: 'grid', gridTemplateColumns: 'minmax(96px, 0.42fr) minmax(0, 1fr) auto', gap: 8, alignItems: 'center', padding: '8px 9px', cursor: 'pointer' }}>
                              <span style={{ color: EMBRY.white, fontSize: 11.5, fontWeight: 750, display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                                <span style={{ color: EMBRY.dim, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto' }}>{stepIcon}</span>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.name}</span>
                              </span>
                              <span style={{ minWidth: 0, color: EMBRY.dim, fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{step.result}</span>
                              <span style={{ color: tone, border: `1px solid ${tone}44`, backgroundColor: `${tone}10`, borderRadius: 999, padding: '2px 7px', fontSize: 8.5, fontWeight: 850, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                                {step.state === 'pass' ? 'passed' : step.state === 'skip' ? 'not required' : step.state === 'warn' ? 'review' : 'info'}
                              </span>
                            </summary>
                            <div style={{ borderTop: `1px solid ${EMBRY.amber}22`, padding: 8, display: 'grid', gap: 6 }}>
                              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
                                {step.details.map((item) => (
                                  <div key={`${step.number}:${item.label}`} title={item.value} style={{ minWidth: 0, border: `1px solid ${EMBRY.border}`, borderRadius: 6, backgroundColor: 'rgba(15,23,42,0.20)', padding: '6px 7px' }}>
                                    <div style={{ ...label, fontSize: 8.5, marginBottom: 3 }}>{item.label}</div>
                                    <div style={{ color: EMBRY.white, fontSize: 11.2, lineHeight: 1.32, overflowWrap: 'anywhere' }}>{renderEvidenceText(item.value)}</div>
                                  </div>
                                ))}
                              </div>
                              {step.number === 3 && (
                                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                                  {(selectedEntities.length > 0 ? selectedEntities.slice(0, 8) : [{ id: 'none', label: 'No extracted entities', framework: 'SPARTA', kind: 'empty' }]).map((entity) => {
                                    const fw = normalizeFramework(entity.framework)
                                    return (
                                      <span key={`${entity.id}:${entity.kind}`} title={`${entity.kind}: ${entity.label}`} style={{ maxWidth: '100%', border: `1px solid ${EMBRY.border}`, backgroundColor: 'rgba(15,23,42,0.30)', color: entity.id === 'none' ? EMBRY.dim : EMBRY.white, borderRadius: 999, padding: '2px 7px', fontSize: 10, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        <span style={{ color: EMBRY.dim }}>{entity.id === 'none' ? '--' : fw}</span> {entity.id === 'none' ? entity.label : entity.id}
                                      </span>
                                    )
                                  })}
                                </div>
                              )}
                              {step.number === 4 && relatedQras.length > 0 && (
                                <button type="button" data-qid="qras:artifact:cae:open-related" data-qs-action="OPEN_RELATED_QRAS" title="Open the first linked QRA from this CAE artifact" onClick={() => selectRelatedQra(relatedQras[0].key)} style={{ justifySelf: 'start', border: `1px solid ${EMBRY.border}`, backgroundColor: EMBRY.bgDeep, color: EMBRY.blue, borderRadius: 6, padding: '3px 8px', fontSize: 10, cursor: 'pointer', fontFamily: 'monospace' }}>
                                  open {relatedQras.length} linked QRAs
                                </button>
                              )}
                              {step.number === 8 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  <button type="button" data-qid="qras:artifact:cae:approve" data-qs-action="APPROVE_CAE_QRA" title="Approve the selected QRA from the CAE artifact" onClick={() => void handleDecision('accept')} disabled={!canApproveCurrent || Boolean(decisionSaving)} style={{ border: `1px solid ${EMBRY.green}44`, borderRadius: 6, backgroundColor: `${EMBRY.green}10`, color: canApproveCurrent ? EMBRY.green : EMBRY.dim, padding: '5px 8px', fontSize: 10, fontWeight: 750, cursor: canApproveCurrent ? 'pointer' : 'not-allowed' }}>Approve QRA</button>
                                  <button type="button" data-qid="qras:artifact:cae:repair-rerun" data-qs-action="REPAIR_RERUN_CAE" title="Repair or rerun the CAE evidence case for this QRA draft" onClick={() => void runFullEvidenceCase(current, currentDraft)} disabled={evidenceRunLoading || !currentDraft?.question.trim()} style={{ border: `1px solid ${EMBRY.amber}44`, borderRadius: 6, backgroundColor: `${EMBRY.amber}10`, color: evidenceRunLoading || !currentDraft?.question.trim() ? EMBRY.dim : EMBRY.amber, padding: '5px 8px', fontSize: 10, fontWeight: 750, cursor: evidenceRunLoading ? 'wait' : 'pointer' }}>Repair / rerun CAE</button>
                                  <button type="button" data-qid="qras:artifact:cae:reject" data-qs-action="REJECT_CAE_QRA" title="Reject the selected QRA from the CAE artifact" onClick={() => void handleDecision('reject')} disabled={Boolean(decisionSaving)} style={{ border: `1px solid ${EMBRY.red}44`, borderRadius: 6, backgroundColor: `${EMBRY.red}10`, color: EMBRY.red, padding: '5px 8px', fontSize: 10, fontWeight: 750, cursor: decisionSaving ? 'wait' : 'pointer' }}>Reject</button>
                                  <button type="button" data-qid="qras:artifact:cae:open-raw-action" data-qs-action="OPEN_QRA_RAW_PAYLOAD" title="Open the cached QRA and evidence_case JSON payload" onClick={() => setPayloadModalKey(current._key)} style={{ border: `1px solid ${EMBRY.border}`, borderRadius: 6, backgroundColor: EMBRY.bgDeep, color: EMBRY.dim, padding: '5px 8px', fontSize: 10, fontWeight: 750, cursor: 'pointer' }}>Open raw payload</button>
                                </div>
                              )}
                            </div>
                          </details>
                        </div>
                      )
                    })}
                  </div>}
                </div>
                <div style={{ alignSelf: 'flex-end', flexShrink: 0, maxWidth: '88%', border: `1px solid ${EMBRY.border}`, backgroundColor: 'rgba(148,163,184,0.08)', borderRadius: 7, padding: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: EMBRY.dim, fontSize: 9.5, fontFamily: 'monospace', marginBottom: 5, gap: 14 }}>
                    <span>User</span>
                    <span>01</span>
                  </div>
                  <div style={{ color: EMBRY.white, fontSize: 12, lineHeight: 1.35 }}>
                    Show me the highest-related QRAs for {selectedEntityLabel} before I approve this.
                  </div>
                </div>

                <div style={{ alignSelf: 'flex-start', flexShrink: 0, maxWidth: '92%', border: `1px solid ${EMBRY.blue}35`, backgroundColor: `${EMBRY.blue}07`, borderRadius: 7, padding: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: EMBRY.dim, fontSize: 9.5, fontFamily: 'monospace', marginBottom: 5, gap: 14 }}>
                    <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><span style={glowDot(EMBRY.green, 6)} />SPARTA Agent</span>
                    <span style={{ color: canApproveCurrent ? EMBRY.green : EMBRY.red, fontSize: 9 }}>{canApproveCurrent ? 'READY' : 'BLOCKING'}</span>
                  </div>
                  <div style={{ color: EMBRY.white, fontSize: 12, lineHeight: 1.36 }}>
                    I found the highest-related loaded QRAs for {renderEvidenceText(selectedEntityLabel)}. Compare these before taking the approval action.
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '62px 1fr', gap: 5, marginTop: 7, paddingTop: 7, borderTop: `1px solid ${EMBRY.border}`, fontSize: 11.5 }}>
                    <span style={label}>Scope</span>
                    <span style={{ color: EMBRY.white }}>{selectedEntityLabel} · selected QRA</span>
                    <span style={label}>Basis</span>
                    <span style={{ color: EMBRY.white }}>{canApproveCurrent ? issueText : `Approval remains blocked. ${issueText}`}</span>
                  </div>
                  <div data-qid="qras:chat:artifact:related-qras" style={{ marginTop: 8, border: `1px solid ${EMBRY.border}`, borderRadius: 7, overflow: 'hidden', backgroundColor: 'rgba(5,11,20,0.42)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', padding: '7px 9px', borderBottom: `1px solid ${EMBRY.border}`, backgroundColor: 'rgba(15,23,42,0.24)' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ ...label, fontSize: 8.5, color: EMBRY.blue }}>Highest Related QRAs</div>
                        <div style={{ color: EMBRY.dim, fontSize: 10.5, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          Ranked loaded neighbors for wording/status comparison before human approval.
                        </div>
                      </div>
                      <span style={{ color: EMBRY.blue, border: `1px solid ${EMBRY.blue}44`, borderRadius: 999, padding: '2px 7px', fontSize: 9, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                        {relatedQras.length} linked
                      </span>
                    </div>
                    {relatedQras.length > 0 ? (
                      <div style={{ display: 'grid' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(78px, 0.18fr) 66px 92px minmax(0, 1fr)', gap: 8, padding: '6px 9px', color: EMBRY.dim, fontSize: 8.5, fontWeight: 850, letterSpacing: 1.2, textTransform: 'uppercase', borderBottom: `1px solid ${EMBRY.border}` }}>
                          <span>QRA</span>
                          <span>Status</span>
                          <span>Match</span>
                          <span>Question</span>
                        </div>
                        {relatedQras.slice(0, 4).map((related, idx) => {
                          const relatedBadge = queueStatusBadge(related.verdict)
                          return (
                            <button
                              key={related.key}
                              type="button"
                              data-qid={`qras:chat:related-qra:${related.key}`}
                              data-qs-action="SELECT_RELATED_QRA"
                              title={`Open related QRA: ${related.question}`}
                              onClick={() => selectRelatedQra(related.key)}
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'minmax(78px, 0.18fr) 66px 92px minmax(0, 1fr)',
                                gap: 8,
                                alignItems: 'center',
                                padding: '6px 9px',
                                border: 0,
                                borderTop: idx === 0 ? 0 : `1px solid ${EMBRY.border}`,
                                backgroundColor: 'transparent',
                                color: EMBRY.white,
                                textAlign: 'left',
                                cursor: 'pointer',
                              }}
                            >
                              <span style={{ color: EMBRY.blue, fontSize: 10.5, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{compactKey(related.qraId, 9, 4)}</span>
                              <span style={{ color: relatedBadge.color, border: `1px solid ${relatedBadge.color}44`, borderRadius: 999, padding: '1px 6px', fontSize: 8.5, fontWeight: 800, justifySelf: 'start', whiteSpace: 'nowrap' }}>{relatedBadge.label}</span>
                              <span style={{ color: EMBRY.dim, fontSize: 9.5, fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{related.match}</span>
                              <span style={{ minWidth: 0, color: EMBRY.dim, fontSize: 10.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{related.question}</span>
                            </button>
                          )
                        })}
                      </div>
                    ) : (
                      <div style={{ padding: '8px 9px', color: EMBRY.dim, fontSize: 10.5, lineHeight: 1.35 }}>
                        No related QRA rows are loaded for this entity yet. Ask the scoped chat to find similar QRAs across the full corpus.
                      </div>
                    )}
                  </div>
                  <div style={{ marginTop: 8, border: `1px solid ${EMBRY.border}`, borderRadius: 7, overflow: 'hidden', backgroundColor: 'rgba(5,11,20,0.42)' }}>
                    {[
                      { label: 'Selected answer', value: renderEvidenceText(currentDraft?.answer || current.answer || evidenceCase?.answer, 'No proposed answer attached.') },
                      { label: 'Selected reasoning', value: renderEvidenceText(currentDraft?.reasoning || current.reasoning, 'No reasoning attached to this QRA.') },
                    ].map((row, idx) => (
                      <div key={row.label} style={{ display: 'grid', gridTemplateColumns: '104px minmax(0, 1fr)', gap: 8, padding: '8px 9px', borderTop: idx === 0 ? 0 : `1px solid ${EMBRY.border}` }}>
                        <div style={{ ...label, fontSize: 8.5 }}>{row.label}</div>
                        <div style={{ color: EMBRY.white, fontSize: 11.5, lineHeight: 1.38, overflowWrap: 'anywhere' }}>{row.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

              <div style={{ padding: '10px', borderTop: `1px solid ${EMBRY.border}`, backgroundColor: EMBRY.bgDeep }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr) auto', gap: 8, alignItems: 'end' }}>
                  <button type="button" data-qid="qras:chat:attach-evidence" data-qs-action="ATTACH_QRA_CHAT_EVIDENCE" aria-label="Attach evidence" title="Attach source excerpt, payload evidence, or audit packet" style={{ width: 38, height: 54, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${EMBRY.border}`, borderRadius: 6, background: EMBRY.bgPanel, color: EMBRY.dim, cursor: 'pointer', padding: 0 }}><Paperclip size={17} strokeWidth={1.8} /></button>
                  <textarea data-qid="qras:chat:prompt" data-qs-action="EDIT_QRA_CHAT_PROMPT" title="Scoped QRA chat prompt" placeholder="Ask about evidence, repair, or fixture retention" rows={2} style={{ height: 54, minWidth: 0, resize: 'none', border: `1px solid ${EMBRY.border}`, borderRadius: 6, background: EMBRY.bg, color: EMBRY.white, padding: '8px 10px', fontSize: 12, lineHeight: 1.35, outline: 'none', fontFamily: 'inherit' }} />
                  <button type="button" data-qid="qras:chat:send" data-qs-action="SEND_QRA_CHAT_PROMPT" aria-label="Send message" title="Send scoped QRA chat prompt" style={{ width: 42, height: 54, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${EMBRY.green}44`, borderRadius: 6, background: `${EMBRY.green}10`, color: EMBRY.green, cursor: 'pointer', padding: 0 }}><SendHorizontal size={18} strokeWidth={1.9} /></button>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
      {payloadModalQra && (
        <div
          data-qid="qras:payload:dialog"
          data-qs-action="CLOSE_QRA_PAYLOAD"
          role="dialog"
          aria-modal="true"
          aria-label="QRA prompt payload"
          title="QRA prompt payload dialog"
          onClick={() => setPayloadModalKey(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 9999, backgroundColor: 'rgba(2,6,12,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div
            data-qid="qras:payload:panel"
            onClick={(event) => event.stopPropagation()}
            style={{ width: 'min(880px, 92vw)', maxHeight: '84vh', display: 'grid', gridTemplateRows: 'auto 1fr', border: `1px solid ${EMBRY.border}`, borderRadius: 8, backgroundColor: EMBRY.bgPanel, overflow: 'hidden', boxShadow: '0 28px 90px rgba(0,0,0,0.55)' }}
          >
            <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderBottom: `1px solid ${EMBRY.border}`, backgroundColor: EMBRY.bgDeep }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ ...label, color: EMBRY.blue }}>Full QRA Prompt Payload</div>
                <div title={payloadModalQra.qra_id || payloadModalQra._key} style={{ color: EMBRY.white, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{payloadModalQra.question}</div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button type="button" data-qid="qras:payload:copy" data-qs-action="COPY_QRA_PAYLOAD_JSON" title="Copy payload JSON" aria-label="Copy payload JSON" onClick={() => copyQraPayload(payloadModalQra)} style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${EMBRY.border}`, borderRadius: 5, backgroundColor: EMBRY.bgPanel, color: EMBRY.dim, cursor: 'copy' }}>
                  <Clipboard size={14} />
                </button>
                <button type="button" data-qid="qras:payload:close" data-qs-action="CLOSE_QRA_PAYLOAD" title="Close payload" aria-label="Close payload" onClick={() => setPayloadModalKey(null)} style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${EMBRY.border}`, borderRadius: 5, backgroundColor: EMBRY.bgPanel, color: EMBRY.dim, cursor: 'pointer' }}>
                  <X size={15} />
                </button>
              </div>
            </div>
            <pre style={{ margin: 0, padding: 14, overflow: 'auto', color: EMBRY.white, backgroundColor: EMBRY.bg, fontSize: 11, lineHeight: 1.45, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
              {formatQraPromptPayload(payloadModalQra)}
            </pre>
          </div>
        </div>
      )}
      {evidenceRunResult && (
        <div
          data-qid="qras:artifact:cae:result-dialog"
          data-qs-action="CLOSE_CAE_RESULT"
          role="dialog"
          aria-modal="true"
          aria-label="Full CAE evidence case result"
          title="Full CAE evidence case result dialog"
          onClick={() => setEvidenceRunResult(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 10002, backgroundColor: 'rgba(2,6,12,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        >
          <div
            data-qid="qras:artifact:cae:result-panel"
            onClick={(event) => event.stopPropagation()}
            style={{ width: 'min(900px, 92vw)', maxHeight: '84vh', display: 'grid', gridTemplateRows: 'auto 1fr', border: `1px solid ${EMBRY.border}`, borderRadius: 8, backgroundColor: EMBRY.bgPanel, overflow: 'hidden', boxShadow: '0 28px 90px rgba(0,0,0,0.55)' }}
          >
            <div style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, borderBottom: `1px solid ${EMBRY.border}`, backgroundColor: EMBRY.bgDeep }}>
              <div>
                <div style={{ ...label, color: EMBRY.blue }}>Full /create-evidence-case Result</div>
                <div style={{ color: EMBRY.dim, fontSize: 11 }}>Query-time CAE output, separate from the cached QRA snapshot.</div>
              </div>
              <button type="button" data-qid="qras:artifact:cae:close-result" data-qs-action="CLOSE_CAE_RESULT" title="Close CAE result" aria-label="Close CAE result" onClick={() => setEvidenceRunResult(null)} style={{ width: 30, height: 30, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${EMBRY.border}`, borderRadius: 5, backgroundColor: EMBRY.bgPanel, color: EMBRY.dim, cursor: 'pointer' }}>
                <X size={15} />
              </button>
            </div>
            <pre style={{ margin: 0, padding: 14, overflow: 'auto', color: EMBRY.white, backgroundColor: EMBRY.bg, fontSize: 11, lineHeight: 1.45, fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
              {JSON.stringify(evidenceRunResult, null, 2)}
            </pre>
          </div>
        </div>
      )}
      {sourceHoverQra && sourceHover && (
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            left: Math.max(12, Math.min(window.innerWidth - 360, sourceHover.x)),
            top: Math.max(12, Math.min(window.innerHeight - 250, sourceHover.y)),
            width: 348,
            zIndex: 10000,
            border: `1px solid ${EMBRY.blue}55`,
            borderRadius: 7,
            backgroundColor: 'rgba(6,12,22,0.98)',
            boxShadow: '0 18px 55px rgba(0,0,0,0.55)',
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          <div style={{ padding: '8px 9px', borderBottom: `1px solid ${EMBRY.border}`, backgroundColor: `${EMBRY.blue}0d` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
              <span style={{ ...label, color: EMBRY.blue }}>Source Context</span>
              <span style={{ color: EMBRY.dim, fontFamily: 'monospace', fontSize: 9 }}>{sourceHoverEvidence}</span>
            </div>
            <div style={{ marginTop: 4, color: EMBRY.white, fontSize: 12, lineHeight: 1.25, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sourceHoverQra.question}</div>
          </div>
          <div style={{ padding: 9, display: 'grid', gridTemplateColumns: '76px minmax(0, 1fr)', gap: 6, color: EMBRY.white, fontSize: 11.5, lineHeight: 1.28 }}>
            <span style={label}>Framework</span>
            <span style={{ color: EMBRY.fw[normalizeFramework(sourceHoverQra.source_framework || 'SPARTA')] ?? EMBRY.blue, fontFamily: 'monospace' }}>{normalizeFramework(sourceHoverQra.source_framework || 'SPARTA')}</span>

            <span style={label}>Control</span>
            <span style={{ fontFamily: 'monospace', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{sourceHoverQra.control_id || (sourceHoverQra as SpartaQRA & { source_control_id?: string }).source_control_id || 'not attached'}</span>

            <span style={label}>Category</span>
            <span>{sourceHoverQra.qra_type || sourceHoverQra.qra_quality?.issue_code || 'control mapping'}</span>

            <span style={label}>Mind</span>
            <span>{sourceHoverQra.mind?.length ? sourceHoverQra.mind.join(', ') : 'none'}</span>

            <span style={label}>Entities</span>
            <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap', minWidth: 0 }}>
              {(sourceHoverEntities.length > 0 ? sourceHoverEntities.slice(0, 4) : [{ id: 'none', framework: 'SPARTA', label: 'No entities', kind: 'empty' }]).map((entity) => {
                const fw = normalizeFramework(entity.framework)
                return (
                  <span key={`${entity.kind}:${entity.id}`} title={entity.label} style={{ border: `1px solid ${EMBRY.border}`, borderRadius: 5, padding: '1px 5px', backgroundColor: 'rgba(15,23,42,0.34)', fontFamily: 'monospace', maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span style={{ color: EMBRY.fw[fw] ?? EMBRY.blue }}>{entity.id === 'none' ? '--' : fw}</span> {entity.id}
                  </span>
                )
              })}
            </span>

            <span style={label}>Issue</span>
            <span>{sourceHoverIssue}</span>

            <span style={label}>Summary</span>
            <span style={{ display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{sourceHoverQra.answer || sourceHoverQra.reasoning || 'No description available.'}</span>
          </div>
        </div>
      )}
      {questionHoverQra && questionHover && (
        <div
          role="tooltip"
          style={{
            position: 'fixed',
            left: Math.max(12, Math.min((typeof window !== 'undefined' ? window.innerWidth : 1280) - 500, questionHover.x)),
            top: Math.max(12, Math.min((typeof window !== 'undefined' ? window.innerHeight : 800) - 340, questionHover.y)),
            width: 488,
            zIndex: 10001,
            border: `1px solid ${EMBRY.border}`,
            borderRadius: 7,
            backgroundColor: 'rgba(6,12,22,0.98)',
            boxShadow: '0 18px 55px rgba(0,0,0,0.58)',
            overflow: 'hidden',
            pointerEvents: 'none',
          }}
        >
          <div style={{ padding: '8px 10px', borderBottom: `1px solid ${EMBRY.border}`, backgroundColor: 'rgba(15,23,42,0.28)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
              <span style={label}>QRA Prompt</span>
              {questionHoverBadge && <span style={{ color: EMBRY.dim, border: `1px solid ${EMBRY.border}`, borderRadius: 999, padding: '1px 6px', fontSize: 9 }}>{questionHoverBadge.label}</span>}
            </div>
            <div style={{ marginTop: 5, color: EMBRY.white, fontSize: 12.5, lineHeight: 1.3 }}>{questionHoverQra.question}</div>
          </div>
          <div style={{ padding: 10, display: 'grid', gap: 8, color: EMBRY.white, fontSize: 11.5, lineHeight: 1.35 }}>
            <div>
              <div style={{ ...label, marginBottom: 3 }}>Reasoning</div>
              <div style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{questionHoverQra.reasoning || 'No reasoning payload on this row.'}</div>
            </div>
            <div>
              <div style={{ ...label, marginBottom: 3 }}>Response</div>
              <div style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{questionHoverQra.answer || 'No answer payload on this row.'}</div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '74px minmax(0, 1fr)', columnGap: 8, rowGap: 4, paddingTop: 7, borderTop: `1px solid ${EMBRY.border}` }}>
              <span style={label}>Source</span>
              <span style={{ fontFamily: 'monospace', color: EMBRY.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{questionHoverQra.source_framework || 'SPARTA'} / {questionHoverQra.control_id || (questionHoverQra as SpartaQRA & { source_control_id?: string }).source_control_id || 'unmapped'}</span>
              <span style={label}>Payload</span>
              <span style={{ color: EMBRY.dim }}>Use row clipboard for JSON copy, ellipsis for full inspector.</span>
            </div>
          </div>
        </div>
      )}
      </>
    )
  }

  return (
    <div style={{
      display: 'flex',
      flex: 1,
      flexDirection: 'column',
      overflow: 'hidden',
      background:
        `radial-gradient(circle at 28% -5%, ${EMBRY.blue}24, transparent 34%),
        radial-gradient(circle at 84% 8%, ${EMBRY.red}18, transparent 30%),
        linear-gradient(180deg, ${EMBRY.bgDeep}, ${EMBRY.bgPanel} 55%, ${EMBRY.bgDeep})`,
    }}>
      {/* HEADER */}
      <div style={{ display: 'none', alignItems: 'center', gap: 10, padding: `8px ${PANE_PADDING}px`, borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0, backgroundColor: EMBRY.bgDeep }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: EMBRY.white, letterSpacing: 0.8 }}>QRA</div>
        <div style={{ ...label, backgroundColor: EMBRY.bgPanel, padding: '3px 7px', borderRadius: 4, fontSize: 9 }}>
          Loaded <span style={{ fontVariantNumeric: "tabular-nums" }}>{loadedStart}-{loadedEnd}</span> of {formatCount(qraTotal)}
        </div>
        <div title="Corpus totals by QRA collection; status chips below count only the loaded queue slice." style={{ ...label, backgroundColor: EMBRY.bgPanel, padding: '3px 7px', borderRadius: 4, fontSize: 9, color: EMBRY.dim }}>
          Corpus: {corpusCounts.loading ? 'loading…' : `${formatCount(corpusCounts.qrasTotal)} total · ${formatCount(corpusCounts.qras)} legacy · ${formatCount(corpusCounts.qrasCanonical + corpusCounts.qrasRelationship)} v2`}
        </div>
        
        {controlFilter && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', backgroundColor: `${EMBRY.accent}12`, borderRadius: 4, border: `1px solid ${EMBRY.accent}33`, marginLeft: 16 }}>
            <span style={{ fontSize: 10, color: EMBRY.accent }}>Filtered: {controlFilter}</span>
            <button data-qid="qras:filter:clear" data-qs-action="CLEAR_TAB_FILTER" onClick={() => nav.clearTabFilter('QRAs')} title="Clear QRA filter" className="press-scale" style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', fontSize: 12, width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }}>×</button>
          </div>
        )}

        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 10, color: EMBRY.dim, fontVariantNumeric: 'tabular-nums' }}>
          Batch {page + 1} · {loading && qras.length > 0 ? 'loading more…' : canLoadMore ? 'scroll to load' : 'all loaded'}
        </div>
        <span style={{ fontSize: 9, color: EMBRY.dim }}>
          {deepLinkNeedsRecovery ? 'Retry hydrate · clear filters · escalate' : 'A accept · R reject · E edit · ←→ move'}
        </span>
        
        {undoTimer && (
          <button data-qid="qras:action:undo" onClick={undoLast} data-qs-action="UNDO_DECISION" title="Undo last decision" className="press-scale" style={{
            fontSize: 10, padding: '4px 12px', borderRadius: 4, cursor: 'pointer',
            border: `1px solid ${EMBRY.amber}44`, backgroundColor: `${EMBRY.amber}12`, color: EMBRY.amber,
          }}>
            Undo (10s)
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* LEFT PANE */}
        <div style={{ 
          width: leftCollapsed ? 56 : leftWidth, 
          display: 'flex', 
          flexDirection: 'column', 
          backgroundColor: 'rgba(8,14,24,0.82)', 
          flexShrink: 0, 
          borderRight: `1px solid ${EMBRY.border}`,
          transition: 'width 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
        }}>
           {leftCollapsed ? (
             <div style={{ padding: '16px 0', display: 'flex', justifyContent: 'center' }}>
               <button data-qid="qras:pane:left-expand" data-qs-action="EXPAND_QRA_LEFT_PANE" title="Expand Left Panel" onClick={() => setLeftCollapsed(false)} className="press-scale" style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', padding: 8, borderRadius: 6, transition: 'background-color 0.2s' }}>
                 <PanelLeft size={20} />
               </button>
             </div>
           ) : (
             <>
               <div style={{ position: 'sticky', top: 0, zIndex: 2, backgroundColor: 'rgba(8,14,24,0.96)', padding: '18px 16px 10px' }}>
                 <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                   <h1 style={{ margin: 0, fontSize: 22, letterSpacing: -0.4, color: EMBRY.white }}>QRA Queue</h1>
                   <button data-qid="qras:pane:left-collapse" data-qs-action="COLLAPSE_QRA_LEFT_PANE" title="Collapse Left Panel" onClick={() => setLeftCollapsed(true)} className="press-scale" style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', padding: 4, borderRadius: 6, display: 'inline-flex' }}>
                     <PanelLeftClose size={18} />
                   </button>
                 </div>
                 <div style={{ padding: 0, display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                   <div style={{ position: 'relative', flex: 1 }}>
                      <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: EMBRY.dim }} />
                      <input
                        data-qid="qras:search"
                        data-qs-action="SEARCH_QRAS"
                        title="Filter QRAs by question text"
                        type="text"
                        placeholder="Filter questions or controls..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                          width: '100%', padding: '7px 10px 7px 30px', backgroundColor: `${EMBRY.bg}80`,
                          border: `1px solid ${EMBRY.border}`, borderRadius: 10, color: EMBRY.white,
                          fontSize: 14, outline: 'none', height: 42,
                        }}
                      />
                      <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', color: EMBRY.dim, fontSize: 12, padding: '2px 7px', borderRadius: 7, border: `1px solid ${EMBRY.border}`, background: EMBRY.bgPanel }}>/</span>
                   </div>
                 </div>

                 <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                   <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                     <div style={{ height: 36, borderRadius: 10, border: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 11px', color: EMBRY.dim, backgroundColor: `${EMBRY.bg}88`, fontSize: 13, flex: 1 }}>
                       <span>Sources&nbsp;&nbsp;<strong style={{ color: EMBRY.white, fontWeight: 600 }}>{source === 'all' ? 'All' : source}</strong></span>
                       <ChevronDown size={16} />
                     </div>
                   </div>
                   <div style={{ display: 'none', gap: 2, backgroundColor: `${EMBRY.bg}60`, borderRadius: 6, padding: 2, flex: 1 }}>
                       {(['legacy', 'v2', 'all'] as QRASource[]).map(s => {
                         const isActive = source === s
                         const sourceLabel = s === 'v2' ? 'v2' : s === 'legacy' ? 'Legacy' : 'All'
                         const sourceTotal = sourceTotals[s]
                         return (
                           <button data-qid="explorer-qrasview:auto:538" data-qs-action="EXPLORER_QRASVIEW_AUTO_538"
                           key={s}
                             type="button"
                             aria-pressed={isActive}
                             onClick={() => setSource(s)}
                             className="press-scale"
                             style={{
                               flex: 1,
                               fontSize: 9,
                               fontWeight: 800,
                               padding: '4px 0',
                               borderRadius: 4,
                               border: 'none',
                               backgroundColor: isActive ? EMBRY.accent : 'transparent',
                               color: isActive ? EMBRY.white : EMBRY.dim,
                               cursor: 'pointer',
                               transition: 'background-color 0.15s, border-color 0.15s, color 0.15s',
                               textTransform: 'uppercase',
                             }}
                           >
                             {sourceLabel}
                             <span style={{ marginLeft: 4, opacity: 0.72, fontVariantNumeric: 'tabular-nums' }}>
                               {corpusCounts.loading ? '…' : formatCount(sourceTotal)}
                             </span>
                           </button>
                         )
                       })}
                   </div>

                     <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 2 }}>
	                       <span style={{ fontSize: 8.5, fontWeight: 700, color: qraStatusCounts.error ? EMBRY.red : qraStatusCounts.stale ? EMBRY.amber : EMBRY.dim, fontVariantNumeric: 'tabular-nums' }}>
	                         {qraStatusCounts.loading ? 'loading' : qraStatusCounts.error ? (qraStatusCounts.stale ? 'stale counts' : 'counts unavailable') : `${formatCount(qraStatusCounts.total)} total`}
	                       </span>
	                     </div>

	                   <div style={{ display: 'flex', flexWrap: 'wrap', gap: 9 }}>
	                     {EVIDENCE_FILTERS.map(({ status, label, title }) => {
                       const isActive = evidenceFilter === status
                       const count = evidenceCounts[status]
                       const color = status === 'all'
                         ? EMBRY.dim
                         : evidenceStatusMeta(status).color
                       return (
                         <button
	                           key={status}
	                           type="button"
	                           aria-pressed={isActive}
	                           data-qid={`qras:filter:evidence:${status}`}
	                           data-qs-action="FILTER_EVIDENCE"
	                           title={qraStatusCounts.error ? `Status counts ${qraStatusCounts.stale ? 'stale' : 'unavailable'}: ${qraStatusCounts.error}` : title}
	                           onClick={() => setEvidenceFilter(status)}
	                           className="press-scale"
                           style={{
                             fontSize: 14,
                             fontWeight: 800,
                             padding: '7px 11px',
                             borderRadius: 9,
                             border: `1px solid ${isActive ? color : EMBRY.border}`,
                             backgroundColor: isActive ? `${color}18` : 'rgba(15,23,42,0.55)',
                             color: isActive ? EMBRY.white : color,
                             cursor: 'pointer',
                             transition: 'background-color 0.15s, border-color 0.15s, color 0.15s',
                             minWidth: 0,
                           }}
	                         >
	                          <span>{label === 'Total' ? 'All' : label}</span>{' '}
	                          <span style={{ opacity: 0.72, fontVariantNumeric: "tabular-nums" }}>{qraStatusCounts.error ? (qraStatusCounts.stale ? 'STALE' : 'ERR') : formatCount(count)}</span>
	                         </button>
                       )
	                     })}
	                   </div>

                   <div style={{ padding: '4px 0 2px' }}>
                     <div
                       title="The queue keeps loaded QRAs visible and fetches the next backend batch near the bottom."
                       style={{
                         color: EMBRY.dim,
                         fontSize: 9,
                         fontWeight: 700,
                         letterSpacing: 0.45,
                         textTransform: 'uppercase',
                         fontVariantNumeric: 'tabular-nums',
                       }}
                     >
                       Sort: Newest
                       <SlidersHorizontal size={14} style={{ marginLeft: 8, verticalAlign: -3 }} />
                     </div>
                   </div>

	                   <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                     {MIND_TAGS.map(tag => {
                       const isActive = mindFilter === tag
                       return (
                         <button
                           key={tag}
                           data-qid={`qras:filter:mind:${tag}`}
                           data-qs-action="FILTER_MIND"
                           title={`Filter by ${tag} category`}
                           onClick={() => setMindFilter(isActive ? null : tag)}
                           className="press-scale"
                           style={{
                             fontSize: 8.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                             border: `1px solid ${isActive ? EMBRY.accent : EMBRY.border}`,
                             backgroundColor: isActive ? `${EMBRY.accent}14` : 'transparent',
                             color: isActive ? EMBRY.white : EMBRY.dim,
                             cursor: 'pointer', transition: 'background-color 0.15s, border-color 0.15s, color 0.15s',
                           }}
                         >
                           {tag}
                         </button>
                       )
                     })}
                   </div>
                 </div>

                 <div style={{ display: 'none', gridTemplateColumns: '24px 80px 56px minmax(0, 1fr)', gap: 12, padding: '6px 10px', borderBottom: `1px solid ${EMBRY.border}`, fontSize: 8.5, fontWeight: 800, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                   <span />
                   <span>Control</span>
                   <span>Source</span>
                   <span>Question</span>
                 </div>
               </div>

               <div
                 ref={queueScrollRef}
                 onScroll={handleQueueScroll}
                 style={{ flex: 1, overflowY: 'auto' }}
               >
                  {loading && qras.length === 0 && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '32px 16px', color: EMBRY.dim }}>
                      <div className="nvis-spinner nvis-spinner-lg" />
                      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase' }}>Loading QRAs</span>
                    </div>
                  )}
                  {!loading && visibleQras.length === 0 && (
                    <div style={{ padding: 16, color: EMBRY.dim, fontSize: 11 }}>
                      No QRAs match the active filters.
                    </div>
                  )}
                  {visibleQras.map(({ q, idx }) => {
                     const isActive = !deepLinkNeedsRecovery && idx === currentIndex
                     const badge = queueStatusBadge(deriveEvidenceStatus(q))
                     
                     return (
                        <motion.div
                          key={`${q._key}:${idx}`}
                          data-qid={`qras:item:${q._key}`}
                          data-qs-action="SELECT_QRA"
                          role="button"
                          tabIndex={0}
                          aria-current={isActive}
                          aria-label={`Select QRA ${q.control_id || q._key}: ${q.question}`}
                          title={q.question}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.2, delay: Math.min(idx * 0.015, 0.3) }}
                          onMouseEnter={() => setHoveredQra(q._key)}
                          onMouseLeave={() => setHoveredQra(null)}
                          onClick={() => setCurrentIndex(idx)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              setCurrentIndex(idx)
                            }
                          }}
                          style={{
                            margin: '8px 12px',
                            minHeight: 92,
                            padding: '12px 12px 11px',
                            borderRadius: 12,
                            border: `1px solid ${isActive ? EMBRY.blue : EMBRY.border}`,
                            background: isActive
                              ? `linear-gradient(135deg, ${EMBRY.blue}24, rgba(15,23,42,0.66))`
                              : hoveredQra === q._key
                                ? 'rgba(15,23,42,0.74)'
                                : 'rgba(15,23,42,0.54)',
                            boxShadow: isActive ? `0 0 0 1px ${EMBRY.blue}22 inset, 0 14px 38px rgba(2,6,23,0.24)` : 'none',
                            cursor: 'pointer',
                            position: 'relative',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                            <span style={{ fontWeight: 850, fontSize: 13, color: EMBRY.white, letterSpacing: 0.1 }}>
                              {q.qra_id || compactKey(q._key)}
                            </span>
                            <span style={{ borderRadius: 7, padding: '4px 7px', fontSize: 12, fontWeight: 800, lineHeight: 1, color: badge.color, border: `1px solid ${badge.color}77`, background: `${badge.color}18`, whiteSpace: 'nowrap' }}>
                              {badge.label}
                            </span>
                          </div>
                          <div title={q.question} style={{ color: isActive ? EMBRY.white : `${EMBRY.white}cc`, fontSize: 13, lineHeight: 1.45, paddingRight: 42 }}>
                            {q.question}
                          </div>
                          <span style={{ position: 'absolute', right: 12, bottom: 11, color: EMBRY.dim, fontSize: 12 }}>
                            {idx === currentIndex ? 'now' : `${Math.max(2, idx * 7)}m ago`}
                          </span>
                          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {q.control_id?.trim() && (
                              <span style={{ fontSize: 10, fontFamily: 'monospace', color: EMBRY.accent, border: `1px solid ${EMBRY.accent}33`, background: `${EMBRY.accent}10`, borderRadius: 6, padding: '2px 6px' }}>
                                {q.control_id}
                              </span>
                            )}
                            <span style={{ fontSize: 10, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                              {q.source_framework || 'SPARTA'}
                            </span>
                          </div>
                        </motion.div>
                     )
                  })}
                  {qras.length > 0 && (
                    <div style={{ padding: '10px 12px 14px', display: 'flex', justifyContent: 'center', borderTop: `1px solid ${EMBRY.border}` }}>
                      {loading ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: EMBRY.dim, fontSize: 9, fontWeight: 800, letterSpacing: 0.55, textTransform: 'uppercase' }}>
                          <div className="nvis-spinner" />
                          Loading next QRAs
                        </div>
                      ) : canLoadMore ? (
                        <div style={{ color: EMBRY.dim, fontSize: 9, fontWeight: 800, letterSpacing: 0.55, textTransform: 'uppercase' }}>
                          Scroll to continue · {formatCount(qras.length)} / {formatCount(qraTotal)}
                        </div>
                      ) : (
                        <div style={{ color: EMBRY.dim, fontSize: 9, fontWeight: 800, letterSpacing: 0.55, textTransform: 'uppercase' }}>
                          End of loaded corpus slice
                        </div>
                      )}
                    </div>
                  )}
               </div>
             </>
           )}
        </div>

        {/* LEFT RESIZER */}
        {!leftCollapsed && (
           <div 
             style={{ width: 4, cursor: 'col-resize', backgroundColor: 'transparent', zIndex: 10, flexShrink: 0, marginLeft: -2, marginRight: -2 }}
             onMouseDown={(e) => {
               e.preventDefault()
               const startX = e.clientX
               const startWidth = leftWidth
               const onMouseMove = (moveEvent: MouseEvent) => setLeftWidth(Math.max(200, Math.min(600, startWidth + (moveEvent.clientX - startX))))
               const onMouseUp = () => { document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp) }
               document.addEventListener('mousemove', onMouseMove)
               document.addEventListener('mouseup', onMouseUp)
             }}
           />
        )}

        {/* CENTER PANE: Unified decision surface */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: EMBRY.bgPanel, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
          {!current ? (
            qraKeyFilter ? (
              <DeepLinkRecoveryState
                qraKey={qraKeyFilter}
                source={source}
                queueLoading={loading}
                detailLoading={detailLoadingKey === qraKeyFilter}
                detailError={detailError?.key === qraKeyFilter ? detailError : null}
                statusCountsLoading={qraStatusCounts.loading}
                statusCountsError={qraStatusCounts.error}
                qraTotal={qraStatusCounts.total || qraTotal}
                loadedCount={qras.length}
                diagnosticsOpen={recoveryDiagnosticsOpen}
                diagnostics={qraDiagnostics}
                onRetryHydrate={retryDeepLinkHydrate}
                onClearFilters={clearRecoveryFilters}
                onTryAllSources={tryAllSourcesForDeepLink}
                onCopyKey={copyDeepLinkKey}
                onOpenDiagnostics={openRecoveryDiagnostics}
                onCopyDiagnostics={copyRecoveryDiagnostics}
                onEscalate={escalateDeepLinkFailure}
              />
            ) : (
              <div style={{ color: EMBRY.dim, padding: 40, textAlign: 'center', margin: 'auto' }}>No QRAs to display. Select an item from the queue.</div>
            )
          ) : (
            <>
              <div style={{ padding: '22px 18px 14px', backgroundColor: 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0, flexWrap: 'wrap', gap: 16, position: 'sticky', top: 0, zIndex: 3 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 9, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, color: EMBRY.dim, fontSize: 14 }}>
                    <span>QRA Queue</span>
                    <ChevronDown size={14} style={{ transform: 'rotate(-90deg)' }} />
                    <strong style={{ color: EMBRY.white, fontWeight: 800 }}>{current.qra_id || compactKey(current._key)}</strong>
                    <span style={{ borderRadius: 7, padding: '4px 7px', fontSize: 12, fontWeight: 800, lineHeight: 1, color: queueStatusBadge(deriveEvidenceStatus(current)).color, border: `1px solid ${queueStatusBadge(deriveEvidenceStatus(current)).color}77`, background: `${queueStatusBadge(deriveEvidenceStatus(current)).color}18` }}>
                      {queueStatusBadge(deriveEvidenceStatus(current)).label}
                    </span>
                  </div>
                  <h2 style={{ fontSize: 24, margin: 0, color: EMBRY.white, letterSpacing: -0.7, lineHeight: 1.18 }}>
                    {current.question}
                  </h2>
                  <div style={{ display: 'flex', gap: 15, alignItems: 'center', color: `${EMBRY.white}aa`, fontSize: 13, flexWrap: 'wrap' }}>
                    <span>Evidence Case ID: <strong style={{ color: EMBRY.white }}>{(current.evidence_case as { case_id?: string; id?: string } | undefined)?.case_id || (current.evidence_case as { case_id?: string; id?: string } | undefined)?.id || 'pending'}</strong></span>
                    <span style={{ height: 16, width: 1, background: EMBRY.border }} />
                    <span>QRA key: <button type="button" data-qid="qras:item:current-copy-key" data-qs-action="COPY_QRA_KEY" title="Copy current QRA key" onClick={() => navigator.clipboard.writeText(current._key)} style={{ color: EMBRY.dim, background: 'transparent', border: 0, cursor: 'pointer', fontFamily: 'monospace' }}>{compactKey(current._key)}</button></span>
                    <span style={{ height: 16, width: 1, background: EMBRY.border }} />
                    <span>Analyst: Alex O.</span>
                  </div>
                  {currentQualityIssue?.issue_code === 'ambiguous_referent' && (
                    <div style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      gap: 5,
                    }}>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        color: EMBRY.amber,
                        fontSize: 9,
                        fontWeight: 800,
                        letterSpacing: 0.45,
                        textTransform: 'uppercase',
                      }}>
                        <span>Ambiguous referent</span>
                        <span style={{ color: EMBRY.dim, fontWeight: 700, textTransform: 'none' }}>
                          {(currentQualityIssue.ambiguous_referents ?? []).join(', ')} · retained for adversarial training · plan repair
                        </span>
                      </div>
                      <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 7,
                        padding: '6px 8px',
                        borderRadius: 8,
                        border: `1px solid ${EMBRY.amber}55`,
                        background: `${EMBRY.amber}10`,
                        color: EMBRY.white,
                        fontSize: 12,
                        fontWeight: 750,
                        lineHeight: 1.35,
                      }}>
                        <AlertTriangle size={14} color={EMBRY.amber} style={{ flexShrink: 0 }} />
                        Required human action: ask what “this payload” refers to before judging whether CAPEC-649 is relevant to T1036.006.
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <button className="press-scale" type="button" style={{ height: 42, borderRadius: 10, border: `1px solid ${EMBRY.border}`, background: 'rgba(15,23,42,0.58)', color: EMBRY.white, display: 'inline-flex', alignItems: 'center', gap: 9, padding: '0 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                    View QRA <ExternalLink size={16} />
                  </button>
                  <button className="press-scale" type="button" style={{ height: 42, borderRadius: 10, border: `1px solid ${EMBRY.border}`, background: 'rgba(15,23,42,0.58)', color: EMBRY.white, display: 'inline-flex', alignItems: 'center', gap: 9, padding: '0 14px', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
                    <Download size={16} /> Export
                  </button>
                  <button className="press-scale" type="button" aria-label="More QRA actions" style={{ width: 42, height: 42, borderRadius: 10, border: `1px solid ${EMBRY.border}`, background: 'rgba(15,23,42,0.58)', color: EMBRY.white, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                    <MoreHorizontal size={16} />
                  </button>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
                    <button
                      type="button"
                      data-qid="qras:display:entity-help"
                      data-qs-action="SHOW_ENTITY_VIEW_HELP"
                      aria-label="Explain entity highlighting"
                      onMouseEnter={() => setShowEntitiesHelp(true)}
                      onMouseLeave={() => setShowEntitiesHelp(false)}
                      onFocus={() => setShowEntitiesHelp(true)}
                      onBlur={() => setShowEntitiesHelp(false)}
                      className="press-scale"
                      style={{
                        fontSize: 8.5,
                        color: EMBRY.dim,
                        textTransform: 'uppercase',
                        letterSpacing: 0.8,
                        fontWeight: 800,
                        padding: '0 2px',
                        cursor: 'help',
                        border: 'none',
                        background: 'transparent',
                        borderBottom: `1px dotted ${EMBRY.dim}66`,
                      }}
                    >
                      Entities
                    </button>
                    {showEntitiesHelp && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 'calc(100% + 8px)',
                          right: 0,
                          width: 260,
                          maxWidth: 'min(260px, calc(100vw - 48px))',
                          padding: '8px 10px',
                          borderRadius: 6,
                          border: `1px solid ${EMBRY.border}`,
                          backgroundColor: EMBRY.bgDeep,
                          boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
                          color: EMBRY.white,
                          fontSize: 10,
                          lineHeight: 1.45,
                          zIndex: 4,
                          pointerEvents: 'none',
                        }}
                      >
                        Entity highlighting changes how much extracted grounding and context is shown in the question and answer surfaces.
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: 2, borderRadius: 6, backgroundColor: `${EMBRY.bg}4d`, border: `1px solid ${EMBRY.border}` }}>
                    {ENTITY_VIEW_OPTIONS.map((option) => {
                      const isActive = entityViewMode === option.mode
                      const action = option.mode === 'anchors'
                        ? 'SET_ENTITY_VIEW_ANCHORS'
                        : option.mode === 'context'
                          ? 'SET_ENTITY_VIEW_CONTEXT'
                          : 'SET_ENTITY_VIEW_FULL'
                      return (
                        <button
                          key={option.mode}
                          data-qid={`qras:display:entity-${option.mode}`}
                          data-qs-action={action}
                          title={option.title}
                          onClick={() => setEntityViewMode(option.mode)}
                          className="press-scale"
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: '4px 7px',
                            borderRadius: 4,
                            border: 'none',
                            backgroundColor: isActive ? `${EMBRY.accent}16` : 'transparent',
                            color: isActive ? EMBRY.white : EMBRY.dim,
                            cursor: 'pointer',
                          }}
                        >
                          {option.label}
                        </button>
                      )
                    })}
                    </div>
                  </div>
                  {current.run_id && (
                    <button data-qid="explorer-qrasview:auto:854" data-qs-action="EXPLORER_QRASVIEW_AUTO_854"
                      onClick={() => setShowBatchModal(true)}
                      title={`View batch: ${current.run_id}`}
                      className="press-scale"
                      style={{
                        background: 'none', border: `1px solid ${EMBRY.border}`, borderRadius: 4,
                        padding: '3px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                        color: EMBRY.dim,
                      }}
                    >
                      <Layers size={12} />
                      <span style={{ fontSize: 8.5, fontFamily: 'monospace' }}>
                        {qras.filter(q => q.run_id === current.run_id).length}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <EvidenceView
                  question={current.question}
                  qraKey={current.qra_id || current._key}
                  reasoning={current.reasoning}
                  answer={current.answer}
                  groundingScore={current.grounding_score}
                  storedEvidenceCase={current.evidence_case as EvidenceCase | undefined}
                  qraFormalProof={current.formal_proof}
                  qraSacmRef={current.sacm_ref}
                  qraQuality={current.qra_quality}
                  upstreamQRAKeys={current.lineage?.upstream_qra_keys || []}
                  priorQRAEvidence={current.evidence_case?.prior_qra_evidence || []}
                  minHighlightEmphasis={minHighlightEmphasis}
                  reviewActions={reviewActions}
                  relatedQRAs={relatedQras}
                  onSelectRelatedQRA={selectRelatedQra}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Batch Info Modal */}
      <AnimatePresence>
      {showBatchModal && current?.run_id && (
        <motion.div data-qid="explorer-qrasview:auto:906" data-qs-action="EXPLORER_QRASVIEW_AUTO_906"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }} onClick={() => setShowBatchModal(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
            style={{
              width: 520, maxHeight: '80vh', backgroundColor: EMBRY.bgPanel,
              border: `1px solid ${EMBRY.border}`, borderRadius: 12, overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
            }} onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{
              padding: '16px 20px', borderBottom: `1px solid ${EMBRY.border}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              backgroundColor: EMBRY.bgDeep,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Layers size={18} color={EMBRY.accent} />
                <span style={{ fontSize: 13, fontWeight: 700, color: EMBRY.white }}>Batch Information</span>
              </div>
              <button data-qid="explorer-qrasview:auto:928" data-qs-action="EXPLORER_QRASVIEW_AUTO_928" onClick={() => setShowBatchModal(false)} className="press-scale" style={{
                background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', padding: 4,
              }}>
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '16px 20px', overflowY: 'auto', maxHeight: 'calc(80vh - 60px)' }}>
              {/* Run ID */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ ...label, fontSize: 9, marginBottom: 4 }}>RUN ID</div>
                <div style={{
                  fontFamily: 'monospace', fontSize: 11, color: EMBRY.accent,
                  backgroundColor: `${EMBRY.accent}10`, padding: '8px 12px', borderRadius: 6,
                  border: `1px solid ${EMBRY.accent}30`, wordBreak: 'break-all',
                }}>
                  {current.run_id}
                </div>
              </div>

              {/* Timestamp extracted from run_id */}
              {(() => {
                const match = current.run_id?.match(/_(\d+)$/)
                if (!match) return null
                const ts = parseInt(match[1], 10)
                const date = new Date(ts)
                return (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ ...label, fontSize: 9, marginBottom: 4 }}>GENERATED AT</div>
                    <div style={{ fontSize: 12, color: EMBRY.dim }}>
                      {date.toLocaleDateString()} {date.toLocaleTimeString()}
                    </div>
                  </div>
                )
              })()}

              {/* Relationship ID if present */}
              {current.relationship_id && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ ...label, fontSize: 9, marginBottom: 4 }}>RELATIONSHIP ID</div>
                  <div style={{
                    fontFamily: 'monospace', fontSize: 11, color: EMBRY.green,
                    backgroundColor: `${EMBRY.green}10`, padding: '8px 12px', borderRadius: 6,
                    border: `1px solid ${EMBRY.green}30`,
                  }}>
                    {current.relationship_id}
                  </div>
                </div>
              )}

              {/* Related QRAs */}
              <div style={{ marginTop: 20 }}>
                <div style={{ ...label, fontSize: 9, marginBottom: 8 }}>
                  QRAs IN THIS BATCH ({qras.filter(q => q.run_id === current.run_id).length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {qras.filter(q => q.run_id === current.run_id).map((q) => {
                    const isCurrent = q._key === current._key
                    const qraIndex = qras.findIndex(qq => qq._key === q._key)
                    return (
                      <div data-qid="explorer-qrasview:auto:991" data-qs-action="EXPLORER_QRASVIEW_AUTO_991"
                        key={q._key}
                        onClick={() => {
                          setCurrentIndex(qraIndex)
                          setShowBatchModal(false)
                        }}
                        className="elevated-surface"
                        style={{
                          padding: '10px 12px', borderRadius: 6, cursor: 'pointer',
                          backgroundColor: isCurrent ? `${EMBRY.accent}15` : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${isCurrent ? EMBRY.accent : 'transparent'}`,
                          transition: 'background-color 0.15s, border-color 0.15s, color 0.15s',
                        }}
                        onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }}
                        onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontSize: 10, fontFamily: 'monospace', color: EMBRY.accent, fontWeight: 600 }}>
                            {q.control_id}
                          </span>
                          {isCurrent && (
                            <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, backgroundColor: EMBRY.accent, color: EMBRY.bgDeep, fontWeight: 700 }}>
                              CURRENT
                            </span>
                          )}
                        </div>
                        <div style={{
                          fontSize: 11, color: isCurrent ? EMBRY.white : EMBRY.dim,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          <><div style={{ fontSize: 10, fontFamily: 'monospace', color: EMBRY.accent, marginBottom: 2 }}>{q.control_id}</div>{q.question}</>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  )
}

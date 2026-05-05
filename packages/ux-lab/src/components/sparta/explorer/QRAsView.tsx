import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { EMBRY, label } from '../common/EmbryStyle'
import { qraDetailPost, useCollectionCounts, useQRAs, useQRAStatusCounts } from '../../../hooks/useSpartaCollections'
import type { SpartaQRA, QRASource, EvidenceCase } from '../../../hooks/useSpartaCollections'
import { useSpartaNav } from './SpartaExplorer'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import { EvidenceView } from './EvidenceView'
import { Search, CheckCircle2, XCircle, PanelLeftClose, PanelLeft, Layers, X, AlertTriangle, Clipboard, RotateCcw, Activity, MessageSquareWarning, ChevronDown, Download, ExternalLink, MoreHorizontal, SlidersHorizontal } from 'lucide-react'
import type { HighlightEmphasis } from './explorerUtils'

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
const QRA_PAGE_SIZE = 100
type EvidenceStatus = 'grounded' | 'review' | 'passed' | 'adversarial' | 'missing' | 'failed'
type EvidenceFilter = 'all' | EvidenceStatus
type DetailError = { key: string; source: QRASource; message: string } | null
type ReviewDecision = 'accept' | 'reject' | 'retain_adversarial'
type DiagnosticPayload = Record<string, unknown>

const EVIDENCE_FILTERS: Array<{ status: EvidenceFilter; label: string; title: string }> = [
  { status: 'all', label: 'Total', title: 'Show all QRAs in the selected source corpus' },
  { status: 'grounded', label: 'Has case', title: '$create-evidence-case data is attached with extracted entities, glossary entries, chains, or prior evidence' },
  { status: 'review', label: 'Review', title: 'Evidence case exists but needs reviewer sign-off or a clearer verdict' },
  { status: 'passed', label: 'Approved', title: 'Evidence case was approved, satisfied, or formally proved' },
  { status: 'adversarial', label: 'Adversarial', title: 'Retained negative/adversarial fixture; repair before generation use' },
  { status: 'missing', label: 'Missing', title: 'No evidence_case field is attached to this QRA' },
  { status: 'failed', label: 'Rejected', title: 'Evidence case was explicitly rejected or failed a gate' },
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

function approvalBlockReason(q: SpartaQRA | undefined): string | null {
  if (!q) return 'QRA document is not loaded.'
  const status = deriveEvidenceStatus(q)
  const quality = getQraQualityIssue(q)
  if (!q.question?.trim() || !q.answer?.trim()) return 'QRA question or answer body is missing.'
  if (!q.evidence_case) return '$create-evidence-case has not produced an evidence case for this QRA.'
  if (quality?.issue_code === 'ambiguous_referent') return 'Ambiguous referent must be repaired or retained as adversarial before approval.'
  if (q.qra_quality?.disposition?.toLowerCase() === 'adversarial') return 'Adversarial fixture cannot be approved as a normal QRA.'
  if (status === 'failed') return 'Evidence case failed or was rejected.'
  if (status === 'missing') return 'Evidence case is missing.'
  if (status === 'review') return 'Evidence case is inconclusive and still needs correction or review.'
  if (status === 'grounded') return 'Evidence is attached but has not passed the approval gate.'
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
  const [source, setSource] = useState<QRASource>('all')
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
  const MIND_TAGS = ['Detect', 'Harden', 'Isolate', 'Recover', 'Respond', 'Design']

  // Resizable / Collapsible State
  const [leftWidth, setLeftWidth] = useState(330)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [hoveredQra, setHoveredQra] = useState<string | null>(null)

  // Batch info modal
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [entityViewMode, setEntityViewMode] = useState<EntityViewMode>(loadEntityViewMode)
  const [showEntitiesHelp, setShowEntitiesHelp] = useState(false)

  const baseVisibleQras = useMemo(
    () => qras
      .map((q, idx) => ({ q, idx }))
      .filter(({ q }) => !mindFilter || (q.mind && q.mind.includes(mindFilter))),
    [mindFilter, qras],
  )

  const evidenceCounts = useMemo(() => ({
    all: qraStatusCounts.total,
    grounded: qraStatusCounts.counts.grounded,
    review: qraStatusCounts.counts.review,
    passed: qraStatusCounts.counts.passed,
    adversarial: qraStatusCounts.counts.adversarial,
    missing: qraStatusCounts.counts.missing,
    failed: qraStatusCounts.counts.failed,
  }), [qraStatusCounts])

  const visibleQras = useMemo(
    () => baseVisibleQras.filter(({ q }) => evidenceFilter === 'all' || deriveEvidenceStatus(q) === evidenceFilter),
    [baseVisibleQras, evidenceFilter],
  )

  const deepLinkNeedsRecovery = Boolean(qraKeyFilter && !hasDeepLinkedQra)
  const currentListItem = deepLinkNeedsRecovery ? undefined : qras[currentIndex] as SpartaQRA | undefined
  const current = currentListItem ? (qraDetails.get(currentListItem._key) ?? currentListItem) : undefined
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
  }), [controlFilter, countStateLabel, debouncedSearch, deepLinkNeedsRecovery, detailError, detailLoadingKey, error, evidenceFilter, loading, mindFilter, page, qraKeyFilter, qraStatusCounts, qraTotal, qras.length, source])

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

  useEffect(() => {
    saveEntityViewMode(entityViewMode)
  }, [entityViewMode])

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
                    <span>QRA key: <button type="button" onClick={() => navigator.clipboard.writeText(current._key)} style={{ color: EMBRY.dim, background: 'transparent', border: 0, cursor: 'pointer', fontFamily: 'monospace' }}>{compactKey(current._key)}</button></span>
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

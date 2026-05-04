import { useMemo, useState } from 'react'
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Expand,
  FileCheck2,
  FileStack,
  Gavel,
  Info,
  Link2,
  ListTree,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  MessageSquareText,
  PanelTop,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserRoundPlus,
  XCircle,
} from 'lucide-react'
import { EMBRY } from '../common/EmbryStyle'
import type { CrosswalkChain, FormalProof } from '../../../hooks/useSpartaCollections'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import { MarkdownRenderer } from '../../shared-chat/MarkdownRenderer'

interface GlossarySummaryEntry {
  id: string
  name: string
  framework: string
  description?: string
}

interface GateTraceRow {
  gate: string
  passed: boolean
  detail: string
  score?: number
}

interface RelatedQRAEntry {
  key: string
  qraId: string
  controlId: string
  source: string
  question: string
  verdict: 'grounded' | 'review' | 'passed' | 'adversarial' | 'missing' | 'failed'
}

type JsonRecord = Record<string, unknown>

interface QraQualityIssue {
  status?: string
  issue_code?: string
  issue_label?: string
  ambiguous_referents?: string[]
  disposition?: string
  safe_action?: string
}

interface PriorQRAEvidenceEntry {
  _key?: string
  qra_id?: string
  source_framework?: string
  citation_id?: string
  question?: string
  answer?: string
}

interface EvidenceCaseTraceProps {
  variant?: 'explorer' | 'chat'
  questionNode?: React.ReactNode
  answerNode?: React.ReactNode
  reviewStatus: string
  confidence: number | null
  formalProof?: FormalProof
  formalProofSuccess?: boolean
  hasFormalProof: boolean
  sacmRef?: { gid?: string; xml_snippet?: string; generated_at?: number }
  methods: string[]
  chains: CrosswalkChain[]
  controlIds: string[]
  glossary: GlossarySummaryEntry[]
  glossaryLabel: string
  reasoning?: string
  agentResponse?: string
  responseAction?: string
  evidenceVerdict?: string
  evidenceGrade?: string
  gatesPassed?: number
  gatesTotal?: number
  liveGates?: GateTraceRow[]
  questionEntityRefs?: GlossarySummaryEntry[]
  answerEntityRefs?: GlossarySummaryEntry[]
  questionAnchorIds?: string[]
  groundedControls?: GlossarySummaryEntry[]
  questionGroundingSummary?: string
  answerGroundingSummary?: string
  answerHelperText?: string
  unsupportedAnswerIds?: string[]
  verdictWhy?: string
  qraQuality?: QraQualityIssue
  gapReview?: JsonRecord
  gapReviewStatus?: string
  humanReviewState?: string
  proposedCorrection?: JsonRecord
  correctionLineage?: JsonRecord
  error?: string | null
  onNavigateToControl: (controlId: string) => void
  onRunValidation?: () => void
  onEscalateToChat?: () => void
  validating?: boolean
  isEditing?: boolean
  editedAnswer?: string
  onStartEdit?: () => void
  onEditedAnswerChange?: (value: string) => void
  onCancelEdit?: () => void
  onSaveAndRerun?: () => void
  draftUnknownIds?: string[]
  reviewActions?: React.ReactNode
  upstreamQRAKeys?: string[]
  priorQRAEvidence?: PriorQRAEvidenceEntry[]
  relatedQRAs?: RelatedQRAEntry[]
  onSelectRelatedQRA?: (qraKey: string) => void
  onOpenFormalMethods?: () => void
}

type OutcomeState = 'passed' | 'inconclusive' | 'failed' | 'pending'
type StepStatus = 'passed' | 'failed' | 'blocked' | 'pending'
type ResponseDisposition = 'answer' | 'deflect' | 'clarify' | 'needs_human_correction'
type RelatedQRAVerdict = RelatedQRAEntry['verdict']

const FW_COLORS: Record<string, string> = {
  SPARTA: EMBRY.accent,
  NIST: EMBRY.green,
  CWE: EMBRY.amber,
  ATTACK: EMBRY.red,
  'ATT&CK': EMBRY.red,
  D3FEND: EMBRY.blue,
}

function relatedQraVerdictMeta(verdict: RelatedQRAVerdict) {
  switch (verdict) {
    case 'passed':
      return { color: EMBRY.green, label: 'Pass' }
    case 'grounded':
      return { color: EMBRY.blue, label: 'Grounded' }
    case 'review':
      return { color: EMBRY.amber, label: 'Review' }
    case 'adversarial':
      return { color: EMBRY.amber, label: 'Adversarial' }
    case 'missing':
      return { color: EMBRY.red, label: 'Missing' }
    case 'failed':
    default:
      return { color: EMBRY.red, label: 'Failed' }
  }
}

const RESPONSE_COPY: Record<ResponseDisposition, { label: string; color: string }> = {
  answer: { label: 'Answer', color: EMBRY.green },
  deflect: { label: 'Deflect', color: EMBRY.red },
  clarify: { label: 'Clarify', color: EMBRY.amber },
  needs_human_correction: { label: 'Needs Human Correction', color: EMBRY.accent },
}

const PANE_PADDING = 16
const TRACE_LINE_LEFT = 21
const SURFACE_BORDER = 'rgba(255,255,255,0.06)'
const SURFACE_FILL = 'rgba(255,255,255,0.018)'

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function asTextList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(asText).filter(Boolean)
  const text = asText(value)
  return text ? [text] : []
}

function formatState(value: unknown, fallback = 'queued'): string {
  const text = asText(value || fallback)
  return text.replace(/_/g, ' ').toUpperCase()
}

interface EvidenceFlowNode {
  id: string
  label: string
  status: StepStatus
  targetStep?: string
  advisory?: boolean
  detail: string
  evidence?: string[]
}

function normalizeAgentResponse(text?: string): string {
  if (!text) return ''
  return text
    .replace(/\[EPISODIC\]\s*/g, '')
    .replace(/\[QRA-GROUNDED\]\s*/g, '\n\n')
    .replace(/\[Prior:\s*([^\]]+)\]/g, '(Prior: $1)')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function formatGateLabel(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value && typeof value === 'object') {
    const candidate = (value as { name?: unknown; gate?: unknown; id?: unknown }).name
      ?? (value as { name?: unknown; gate?: unknown; id?: unknown }).gate
      ?? (value as { name?: unknown; gate?: unknown; id?: unknown }).id
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
    if (typeof candidate === 'number' || typeof candidate === 'boolean') return String(candidate)
  }
  return 'Gate'
}

function deriveOutcome(verdict: string | undefined, gatesPassed: number | undefined, gatesTotal: number | undefined): {
  state: OutcomeState
  label: string
  color: string
  Icon: typeof CheckCircle2
} {
  const normalized = (verdict || '').trim().toLowerCase()

  if (normalized === 'satisfied' || normalized === 'pass' || normalized === 'passed') {
    return { state: 'passed', label: 'PASS', color: EMBRY.green, Icon: CheckCircle2 }
  }
  if (normalized === 'inconclusive' || normalized === 'auto' || normalized === 'qualified') {
    return { state: 'inconclusive', label: 'INCONCLUSIVE', color: EMBRY.amber, Icon: AlertCircle }
  }
  if (normalized === 'not_satisfied' || normalized === 'failed' || normalized === 'fail' || normalized === 'rejected') {
    return { state: 'failed', label: 'FAIL', color: EMBRY.red, Icon: XCircle }
  }
  if ((gatesTotal ?? 0) > 0) {
    if (gatesPassed === gatesTotal) return { state: 'passed', label: 'PASS', color: EMBRY.green, Icon: CheckCircle2 }
    if ((gatesPassed ?? 0) === 0) return { state: 'failed', label: 'FAIL', color: EMBRY.red, Icon: XCircle }
    return { state: 'inconclusive', label: 'INCONCLUSIVE', color: EMBRY.amber, Icon: AlertCircle }
  }
  return { state: 'pending', label: 'PENDING', color: EMBRY.dim, Icon: AlertCircle }
}

function deriveDisposition(action: string | undefined, outcome: OutcomeState, unsupportedAnswerIds: string[]): ResponseDisposition {
  const normalized = (action || '').trim().toLowerCase()
  if (normalized === 'answer' || normalized === 'deflect' || normalized === 'clarify') return normalized
  if (unsupportedAnswerIds.length > 0) return 'needs_human_correction'
  if (outcome === 'passed') return 'answer'
  if (outcome === 'failed') return 'deflect'
  if (outcome === 'inconclusive') return 'clarify'
  return 'clarify'
}

function deriveCweCrosswalk(chains: CrosswalkChain[]): { found: boolean; targetId?: string; pathLabel?: string } {
  for (const chain of chains) {
    const hops = Array.isArray(chain.hops) ? chain.hops : []
    const sourceFramework = String(chain.from_framework || '').toUpperCase()
    const targetFramework = String(chain.to_framework || '').toUpperCase()
    const sourceId = String(chain.source || chain.from || '').trim()
    const targetId = String(chain.target || '').trim()
    const nodes = [
      ...(sourceId ? [{ id: sourceId, framework: sourceFramework || 'SOURCE' }] : []),
      ...hops.map((hop) => ({ id: String(hop.control_id || hop.id || '').trim(), framework: String(hop.framework || '').toUpperCase() })),
      ...(targetId ? [{ id: targetId, framework: targetFramework || 'TARGET' }] : []),
    ].filter((node) => node.id)
    const cweNode = nodes.find((node) => node.framework === 'CWE' || /^CWE-\d+$/i.test(node.id))
    if (!cweNode) continue
    return {
      found: true,
      targetId: cweNode.id.toUpperCase(),
      pathLabel: nodes.map((node) => node.framework || node.id).join(' -> '),
    }
  }
  return { found: false }
}

function summarizeIds(ids: string[], limit = 4): string {
  if (ids.length <= limit) return ids.join(', ')
  return `${ids.slice(0, limit).join(', ')} +${ids.length - limit} more`
}

function statusTone(status: StepStatus) {
  if (status === 'passed') return { color: EMBRY.green, bg: `${EMBRY.green}14`, border: `${EMBRY.green}33`, label: 'Pass', Icon: CheckCircle2 }
  if (status === 'failed') return { color: EMBRY.red, bg: `${EMBRY.red}14`, border: `${EMBRY.red}33`, label: 'Fail', Icon: XCircle }
  if (status === 'blocked') return { color: EMBRY.amber, bg: `${EMBRY.amber}14`, border: `${EMBRY.amber}33`, label: 'Blocked', Icon: Ban }
  return { color: EMBRY.dim, bg: `${EMBRY.dim}14`, border: `${EMBRY.dim}33`, label: 'Pending', Icon: Loader2 }
}

function EvidencePathSummary({
  nodes,
  advisoryNodes,
  reviewerFocus,
  onOpenStep,
}: {
  nodes: EvidenceFlowNode[]
  advisoryNodes: EvidenceFlowNode[]
  reviewerFocus: { title: string; detail: string; status: StepStatus }
  onOpenStep: (stepId: string) => void
}) {
  const focusTone = statusTone(reviewerFocus.status)
  const renderNode = (node: EvidenceFlowNode) => {
    const tone = statusTone(node.status)
    return (
      <button
        key={node.id}
        type="button"
        data-qid={`qras:evidence-flow:${node.id}`}
        data-qs-action={node.advisory ? 'OPEN_ADVISORY_EVIDENCE_FLOW_NODE' : 'OPEN_EVIDENCE_FLOW_NODE'}
        title={`${node.label}: ${node.advisory ? 'advisory repair guidance, not source evidence' : node.detail}`}
        onClick={() => node.targetStep && onOpenStep(node.targetStep)}
        className="press-scale"
        style={{
          width: '100%',
          minHeight: 42,
          padding: '7px 10px',
          borderRadius: 9,
          border: `${node.advisory ? '1px dashed' : '1px solid'} ${tone.border}`,
          backgroundColor: tone.bg,
          color: EMBRY.white,
          cursor: node.targetStep ? 'pointer' : 'default',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          fontSize: 12,
          fontWeight: 900,
        }}
      >
        {node.label}
      </button>
    )
  }

  return (
    <section data-qid="qras:evidence-flow" style={{ display: 'flex', flexDirection: 'column', gap: 14, minHeight: 0, overflow: 'hidden' }}>
      <div data-qid="qras:evidence-flow:reviewer-focus" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 11px', borderRadius: 9, border: `1px solid ${focusTone.border}`, backgroundColor: focusTone.bg }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 10, color: EMBRY.white, fontWeight: 900, letterSpacing: 0.8, textTransform: 'uppercase' }}>Reviewer focus</span>
          <span style={{ color: focusTone.color, fontSize: 10, fontWeight: 900, textTransform: 'uppercase' }}>{focusTone.label}</span>
        </div>
        <div style={{ fontSize: 13, color: EMBRY.white, fontWeight: 850, lineHeight: 1.35 }}>{reviewerFocus.title}</div>
        <div style={{ fontSize: 11, color: EMBRY.dim, lineHeight: 1.45 }}>{reviewerFocus.detail}</div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'grid', gridTemplateColumns: '1fr', gap: 12, padding: '4px 0 8px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', minWidth: 0 }}>
          <span style={{ color: EMBRY.dim, fontSize: 10, fontWeight: 900, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Source-grounded evidence path</span>
          {nodes.map((node, idx) => (
            <div key={`flow-main-${node.id}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
              {renderNode(node)}
              {node.evidence && node.evidence.length > 0 && (
                <div style={{ marginTop: 5, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4 }}>
                  {node.evidence.slice(0, 3).map((item) => (
                    <span key={`${node.id}-${item}`} style={{ padding: '2px 5px', borderRadius: 999, border: `1px solid ${statusTone(node.status).border}`, backgroundColor: 'rgba(0,0,0,0.18)', color: EMBRY.white, fontSize: 9, fontFamily: 'monospace' }}>
                      {item}
                    </span>
                  ))}
                </div>
              )}
              {idx < nodes.length - 1 && <ChevronDown size={20} color={EMBRY.dim} style={{ margin: '5px 0' }} />}
            </div>
          ))}
        </div>

        <div style={{ position: 'relative', border: `1px dashed ${EMBRY.red}aa`, borderRadius: 13, padding: '20px 10px 14px', display: 'flex', flexDirection: 'column', alignItems: 'stretch', backgroundColor: `${EMBRY.red}08`, minWidth: 0 }}>
          <span style={{ position: 'absolute', top: -12, left: '50%', transform: 'translateX(-50%)', background: '#fb7185', color: '#450a0a', fontWeight: 900, fontSize: 12, padding: '3px 9px', borderRadius: 999 }}>Advisory</span>
          <span style={{ position: 'absolute', top: -13, right: 10, padding: '2px 7px', borderRadius: 999, border: `1px dashed ${EMBRY.red}88`, color: EMBRY.red, background: EMBRY.bgDeep, fontSize: 9, fontWeight: 900, textTransform: 'uppercase' }}>not evidence</span>
          {advisoryNodes.map((node, idx) => (
            <div key={`flow-adv-${node.id}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
              {renderNode(node)}
              {!idx && node.detail && (
                <span style={{ maxWidth: 150, marginTop: 4, color: EMBRY.red, fontSize: 9, textAlign: 'center', lineHeight: 1.25 }}>{node.detail}</span>
              )}
              {idx < advisoryNodes.length - 1 && <ChevronDown size={18} color={EMBRY.red} style={{ margin: '4px 0' }} />}
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 9, color: EMBRY.dim, fontSize: 13, borderTop: `1px solid ${EMBRY.border}`, paddingTop: 14, marginTop: 'auto' }}>
        <Info size={16} />
        Click a node to open the matching trace section. Advisory nodes are repair guidance, not evidence.
      </div>
    </section>
  )
}

function ToggleSection({
  open,
  onToggle,
  label,
  children,
}: {
  open: boolean
  onToggle: () => void
  label: string
  children: React.ReactNode
}) {
  return (
    <section style={{ border: `1px solid ${EMBRY.border}`, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.02)' }}>
      <button data-qid="shared-evidencecasetrace:auto:236" data-qs-action="SHARED_EVIDENCECASETRACE_AUTO_236"
        type="button"
        title={`${open ? 'Collapse' : 'Expand'} ${label}`}
        onClick={onToggle}
        className="press-scale"
        style={{
          width: '100%',
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '10px 12px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color: EMBRY.dim,
          textTransform: 'uppercase',
          letterSpacing: 1,
          fontSize: 10,
          fontWeight: 800,
          textAlign: 'left',
        }}
      >
        <span>{label}</span>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {open && <div style={{ padding: '0 12px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>}
    </section>
  )
}

export function EvidenceCaseTrace({
  variant = 'explorer',
  questionNode,
  answerNode,
  reviewStatus,
  confidence,
  formalProofSuccess,
  hasFormalProof,
  methods,
  chains,
  controlIds,
  glossary,
  glossaryLabel,
  reasoning,
  agentResponse,
  responseAction,
  evidenceVerdict,
  evidenceGrade,
  gatesPassed,
  gatesTotal,
  liveGates = [],
  questionEntityRefs = [],
  answerEntityRefs = [],
  questionAnchorIds = [],
  groundedControls = [],
  questionGroundingSummary,
  answerGroundingSummary,
  answerHelperText,
  unsupportedAnswerIds = [],
  verdictWhy,
  qraQuality,
  gapReview,
  gapReviewStatus,
  humanReviewState,
  proposedCorrection,
  correctionLineage,
  error,
  onNavigateToControl,
  onRunValidation,
  onEscalateToChat,
  validating = false,
  isEditing = false,
  editedAnswer = '',
  onStartEdit,
  onEditedAnswerChange,
  onCancelEdit,
  onSaveAndRerun,
  draftUnknownIds = [],
  reviewActions,
  formalProof,
  sacmRef,
  upstreamQRAKeys = [],
  priorQRAEvidence = [],
  relatedQRAs = [],
  onSelectRelatedQRA,
  onOpenFormalMethods,
}: EvidenceCaseTraceProps) {
  useRegisterAction('qras:evidence:step-toggle', { app: 'sparta-explorer', action: 'TOGGLE_EVIDENCE_STEP', label: 'Toggle Evidence Step', description: 'Expand or collapse one evidence trace step' })
  useRegisterAction('qras:evidence:controls-toggle', { app: 'sparta-explorer', action: 'TOGGLE_GROUNDED_CONTROLS', label: 'Toggle Grounded Controls', description: 'Expand or collapse grounded control references' })
  useRegisterAction('qras:evidence:entities-toggle', { app: 'sparta-explorer', action: 'TOGGLE_RESOLVED_ENTITIES', label: 'Toggle Resolved Entities', description: 'Expand or collapse resolved entities' })
  useRegisterAction('qras:action:edit_answer', { app: 'sparta-explorer', action: 'EDIT_ANSWER', label: 'Edit Answer', description: 'Edit the synthesized answer inline' })
  useRegisterAction('qras:action:save_rerun', { app: 'sparta-explorer', action: 'SAVE_AND_RERUN', label: 'Save and Rerun', description: 'Save the edited answer and rerun evidence context' })
  useRegisterAction('qras:action:cancel_edit', { app: 'sparta-explorer', action: 'CANCEL_EDIT_ANSWER', label: 'Cancel Edit', description: 'Cancel inline answer editing' })
  useRegisterAction('qras:action:validate_evidence', { app: 'sparta-explorer', action: 'VALIDATE_EVIDENCE', label: 'Rerun Context', description: 'Run /create-evidence-case validation pipeline' })
  useRegisterAction('qras:action:refine_in_chat', { app: 'sparta-explorer', action: 'REFINE_IN_CHAT', label: 'Open in SPARTA Chat', description: 'Open a scoped SPARTA Chat session for this QRA' })
  useRegisterAction('qras:evidence:source-control', { app: 'sparta-explorer', action: 'NAVIGATE_TO_CONTROL', label: 'Open Source Control', description: 'Open the selected source control in the Controls tab' })
  useRegisterAction('qras:evidence:related-qra', { app: 'sparta-explorer', action: 'SELECT_RELATED_QRA', label: 'Select Related QRA', description: 'Select a related QRA from the evidence trace' })
  useRegisterAction('qras:evidence:open-lean4', { app: 'sparta-explorer', action: 'OPEN_LEAN4_VIEWER', label: 'Open Lean4 Viewer', description: 'Open the Lean4 formal methods viewer for deeper proof inspection' })
  useRegisterAction('qras:evidence:cae-gap-review', { app: 'sparta-explorer', action: 'VIEW_CAE_GAP_REVIEW', label: 'View CAE Gap Review', description: 'Inspect advisory CAE gap diagnosis for a blocked or ambiguous QRA' })

  const [expandedStep, setExpandedStep] = useState<string | null>(null)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [entitiesOpen, setEntitiesOpen] = useState(false)
  const [reasoningOpen, setReasoningOpen] = useState(false)

  const effectiveGatesPassed = gatesPassed ?? (liveGates.length > 0 ? liveGates.filter((gate) => gate.passed).length : undefined)
  const effectiveGatesTotal = gatesTotal ?? (liveGates.length > 0 ? liveGates.length : undefined)
  const gapReviewRecord = asRecord(gapReview)
  const gapPersonaReview = asRecord(gapReviewRecord?.persona_review)
  const gapJudgeRouting = asRecord(gapReviewRecord?.judge_routing)
  const gapProposedCorrection = asRecord(proposedCorrection) || asRecord(gapReviewRecord?.proposed_correction)
  const gapCorrectionLineage = asRecord(correctionLineage) || asRecord(gapReviewRecord?.correction_lineage)
  const qualityIssueCode = qraQuality?.issue_code?.trim()
  const qualityDisposition = qraQuality?.disposition?.trim()
  const qualityReferents = qraQuality?.ambiguous_referents ?? []
  const hasBlockingQualityIssue = Boolean(
    qualityIssueCode === 'ambiguous_referent'
      || qualityDisposition?.toLowerCase().includes('adversarial')
  )
  const baseOutcome = deriveOutcome(evidenceVerdict || reviewStatus, effectiveGatesPassed, effectiveGatesTotal)
  const outcome = hasBlockingQualityIssue || unsupportedAnswerIds.length > 0
    ? { ...baseOutcome, state: 'failed' as OutcomeState, label: 'FAIL', color: EMBRY.red, Icon: XCircle }
    : baseOutcome
  const cweCrosswalk = useMemo(() => deriveCweCrosswalk(chains), [chains])
  const disposition = hasBlockingQualityIssue ? 'needs_human_correction' : deriveDisposition(responseAction, outcome.state, unsupportedAnswerIds)
  const responseMeta = RESPONSE_COPY[disposition]
  const responseText = normalizeAgentResponse(agentResponse)
  const questionHasGrounding = questionEntityRefs.length > 0 || questionAnchorIds.length > 0
  const questionStatus: StepStatus = hasBlockingQualityIssue ? 'failed' : questionHasGrounding ? 'passed' : 'failed'
  const answerStatus: StepStatus = !questionHasGrounding ? 'blocked' : hasBlockingQualityIssue || unsupportedAnswerIds.length > 0 ? 'failed' : 'passed'
  const verifyStatus: StepStatus = !questionHasGrounding || hasBlockingQualityIssue || unsupportedAnswerIds.length > 0
    ? 'blocked'
    : cweCrosswalk.found || outcome.state === 'passed'
      ? 'passed'
      : liveGates.length > 0 || effectiveGatesTotal
        ? 'failed'
        : 'pending'
  const dispositionStatus: StepStatus = !questionHasGrounding ? 'blocked' : hasBlockingQualityIssue || unsupportedAnswerIds.length > 0 ? 'failed' : outcome.state === 'passed' ? 'passed' : outcome.state === 'pending' ? 'pending' : 'blocked'
  const verdictReason = verdictWhy
    || (hasBlockingQualityIssue
      ? `FAIL — QRA question is not standalone; unresolved referent(s): ${qualityReferents.length > 0 ? summarizeIds(qualityReferents) : qraQuality?.issue_label || qualityIssueCode}.`
      : unsupportedAnswerIds.length > 0
      ? `FAIL — Answer introduces ${summarizeIds(unsupportedAnswerIds)}, which is not supported by the grounded scope.`
      : cweCrosswalk.found
        ? `PASS — Verified path to ${cweCrosswalk.targetId}.`
        : 'INCONCLUSIVE — No qualifying evidence path was found.')
  const showRerunAction = !isEditing && Boolean(onRunValidation)
  const showEditAction = !isEditing && Boolean(onStartEdit) && questionHasGrounding
  const shouldPromoteChat = !isEditing && !questionHasGrounding && Boolean(onEscalateToChat)
  const groupedGroundedControls = groundedControls.reduce<Record<string, GlossarySummaryEntry[]>>((acc, entry) => {
    const key = entry.framework || 'Grounded'
    if (!acc[key]) acc[key] = []
    acc[key].push(entry)
    return acc
  }, {})
  const groupedFrameworks = Object.entries(groupedGroundedControls)
  const showCaeGapReview = Boolean(
    gapReviewRecord
      || qualityIssueCode
      || qualityDisposition?.toLowerCase().includes('adversarial')
      || (gapReviewStatus && gapReviewStatus !== 'not_applicable'),
  )
  const gapFindings = [
    ...asTextList(gapPersonaReview?.findings),
    ...(qualityIssueCode ? [`QRA quality issue: ${qraQuality?.issue_label || qualityIssueCode}.`] : []),
    ...(qualityReferents.length > 0 ? [`Ambiguous referents: ${qualityReferents.join(', ')}.`] : []),
  ]
  const gapDecision = asText(gapReviewRecord?.decision) || (qualityIssueCode ? 'NEEDS_QRA_REPAIR' : 'NEEDS_VERIFICATION')
  const gapRoute = asText(gapJudgeRouting?.route) || 'human_review'
  const correctionQuestion = asText(gapProposedCorrection?.corrected_question)
  const correctionRationale = asTextList(gapProposedCorrection?.rationale)
  const formalProofSnippet = useMemo(() => {
    const code = formalProof?.code?.trim()
    if (!code) return ''
    return code.split('\n').slice(0, 10).join('\n')
  }, [formalProof?.code])

  const stepRows = [
    {
      id: 'question',
      number: 1,
      title: 'Question Grounding',
      status: questionStatus,
      summary: hasBlockingQualityIssue
        ? `QRA is not standalone: ${qualityReferents.length > 0 ? summarizeIds(qualityReferents) : qraQuality?.issue_label || qualityIssueCode}.`
        : questionGroundingSummary || 'Question grounding has not been evaluated.',
      detail: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, color: EMBRY.dim, lineHeight: 1.55 }}>{questionGroundingSummary}</div>
          {questionEntityRefs.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Mapping</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {questionEntityRefs.map((entry) => {
                  const color = FW_COLORS[entry.framework?.toUpperCase()] || EMBRY.dim
                  return (
                    <span
                      key={`entity-${entry.id}`}
                      title={`${entry.name}${entry.description ? ` — ${entry.description}` : ''}${entry.framework ? ` (${entry.framework})` : ''}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '3px 6px',
                        borderRadius: 4,
                        border: `1px solid ${color}33`,
                        color,
                        backgroundColor: `${color}10`,
                        fontSize: 10,
                      }}
                    >
                      <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{entry.id}</span>
                    </span>
                  )
                })}
              </div>
            </div>
          )}
          {questionAnchorIds.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Anchor mapping</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {questionAnchorIds.map((id) => (
                  <button
                    key={`anchor-${id}`}
                    type="button"
                    data-qid={`qras:evidence:anchor:${id}`}
                    data-qs-action="NAVIGATE_TO_CONTROL"
                    title={`Open control ${id}`}
                    onClick={() => onNavigateToControl(id)}
                    className="press-scale"
                    style={{
                      padding: '3px 6px',
                      borderRadius: 4,
                      border: `1px solid ${EMBRY.accent}33`,
                      backgroundColor: `${EMBRY.accent}10`,
                      color: EMBRY.accent,
                      cursor: 'pointer',
                      fontSize: 10,
                      fontFamily: 'monospace',
                      fontWeight: 700,
                    }}
                  >
                    {id}
                  </button>
                ))}
              </div>
            </div>
          )}
          {questionEntityRefs.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Question glossary</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {questionEntityRefs.slice(0, 4).map((entry) => (
                  <div key={`question-glossary-${entry.id}`} style={{ padding: '8px 10px', borderRadius: 6, border: `1px solid ${EMBRY.border}`, backgroundColor: 'rgba(0,0,0,0.15)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: FW_COLORS[entry.framework?.toUpperCase()] || EMBRY.dim, fontFamily: 'monospace', fontWeight: 700 }}>{entry.id}</span>
                      <span style={{ fontSize: 9, color: EMBRY.dim }}>{entry.framework}</span>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 11, color: EMBRY.white }}>{entry.name}</div>
                    {entry.description && <div style={{ marginTop: 4, fontSize: 10, color: EMBRY.dim, lineHeight: 1.45 }}>{entry.description}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'answer',
      number: 2,
      title: 'Answer Grounding',
      status: answerStatus,
      summary: unsupportedAnswerIds.length > 0
        ? `Unsupported answer claims: ${summarizeIds(unsupportedAnswerIds)}.`
        : answerGroundingSummary || 'Answer grounding has not been evaluated.',
      detail: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 11, color: answerStatus === 'failed' ? EMBRY.red : EMBRY.dim, lineHeight: 1.55 }}>
            {answerGroundingSummary}
          </div>
          {unsupportedAnswerIds.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {unsupportedAnswerIds.map((id) => (
                <span
                  key={`unsupported-${id}`}
                  style={{
                    padding: '3px 6px',
                    borderRadius: 4,
                    border: `1px solid ${EMBRY.red}33`,
                    backgroundColor: `${EMBRY.red}10`,
                    color: EMBRY.red,
                    fontSize: 10,
                    fontFamily: 'monospace',
                    fontWeight: 700,
                  }}
                >
                  {id}
                </span>
              ))}
            </div>
          )}
          {answerEntityRefs.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Mapping</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {answerEntityRefs.map((entry) => (
                  <span
                    key={`answer-entity-${entry.id}`}
                    title={`${entry.name}${entry.description ? ` — ${entry.description}` : ''}${entry.framework ? ` (${entry.framework})` : ''}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '3px 6px',
                      borderRadius: 4,
                      border: `1px solid ${(FW_COLORS[entry.framework?.toUpperCase()] || EMBRY.dim)}33`,
                      color: FW_COLORS[entry.framework?.toUpperCase()] || EMBRY.dim,
                      backgroundColor: `${FW_COLORS[entry.framework?.toUpperCase()] || EMBRY.dim}10`,
                      fontSize: 10,
                      fontFamily: 'monospace',
                    }}
                  >
                    {entry.id}
                  </span>
                ))}
              </div>
            </div>
          )}
          {answerEntityRefs.length > 0 && (
            <div>
              <div style={{ fontSize: 10, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>Answer glossary</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {answerEntityRefs.slice(0, 4).map((entry) => (
                  <div key={`answer-glossary-${entry.id}`} style={{ padding: '8px 10px', borderRadius: 6, border: `1px solid ${EMBRY.border}`, backgroundColor: 'rgba(0,0,0,0.15)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: FW_COLORS[entry.framework?.toUpperCase()] || EMBRY.dim, fontFamily: 'monospace', fontWeight: 700 }}>{entry.id}</span>
                      <span style={{ fontSize: 9, color: EMBRY.dim }}>{entry.framework}</span>
                    </div>
                    <div style={{ marginTop: 4, fontSize: 11, color: EMBRY.white }}>{entry.name}</div>
                    {entry.description && <div style={{ marginTop: 4, fontSize: 10, color: EMBRY.dim, lineHeight: 1.45 }}>{entry.description}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ),
    },
    {
      id: 'verify',
      number: 3,
      title: 'Verify Path',
      status: verifyStatus,
      summary: !questionHasGrounding || unsupportedAnswerIds.length > 0
        ? 'Blocked until grounding succeeds.'
        : cweCrosswalk.found
          ? `Verified path${cweCrosswalk.targetId ? ` to ${cweCrosswalk.targetId}` : ''}.`
          : 'No path found.',
      detail: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <div style={{ minWidth: 92 }}>
              <div style={{ fontSize: 10, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Path</div>
              <div style={{ fontSize: 11, color: verifyStatus === 'passed' ? EMBRY.green : verifyStatus === 'failed' ? EMBRY.red : EMBRY.amber, fontWeight: 700 }}>
                {!questionHasGrounding || unsupportedAnswerIds.length > 0 ? 'Blocked' : cweCrosswalk.found ? 'Verified' : 'No path found'}
              </div>
            </div>
            <div style={{ minWidth: 92 }}>
              <div style={{ fontSize: 10, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Confidence</div>
              <div style={{ fontSize: 11, color: confidence !== null && confidence >= 80 ? EMBRY.green : EMBRY.white, fontWeight: 700 }}>{confidence !== null ? `${confidence}%` : '—'}</div>
            </div>
            <div style={{ minWidth: 110 }}>
              <div style={{ fontSize: 10, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Formal proof</div>
              <div style={{ fontSize: 11, color: hasFormalProof ? (formalProofSuccess ? EMBRY.green : EMBRY.red) : EMBRY.dim, fontWeight: 700 }}>
                {hasFormalProof ? (formalProofSuccess ? 'Verified' : 'Failed') : 'Unverified'}
              </div>
            </div>
          </div>
          <div style={{ fontSize: 11, color: EMBRY.dim, lineHeight: 1.55 }}>
            {!questionHasGrounding || unsupportedAnswerIds.length > 0
              ? 'Blocked: answer grounding must pass before framework verification can continue.'
              : cweCrosswalk.found
                ? (cweCrosswalk.pathLabel || `Verified path to ${cweCrosswalk.targetId}`)
                : 'No qualifying verification path was resolved for this answer.'}
            {evidenceGrade ? ` • Grade ${evidenceGrade}` : ''}
            {effectiveGatesTotal ? ` • ${effectiveGatesPassed ?? 0}/${effectiveGatesTotal} gates passed` : ''}
          </div>
          {methods.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 1 }}>Methods</span>
              {methods.map((m) => (
                <span
                  key={`method-${m}`}
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: `1px solid ${EMBRY.border}`,
                    backgroundColor: 'rgba(255,255,255,0.03)',
                    color: EMBRY.dim,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}
                >
                  {m}
                </span>
              ))}
            </div>
          )}
          {liveGates.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {liveGates.map((gate, idx) => {
                const passed = !!gate.passed
                return (
                  <div key={`${formatGateLabel(gate.gate)}-${idx}`} style={{ display: 'flex', gap: 8 }}>
                    {passed ? <CheckCircle2 size={12} color={EMBRY.green} style={{ flexShrink: 0, marginTop: 2 }} /> : <XCircle size={12} color={EMBRY.red} style={{ flexShrink: 0, marginTop: 2 }} />}
                    <div>
                      <div style={{ fontSize: 10, color: EMBRY.white, fontWeight: 700 }}>{formatGateLabel(gate.gate)}</div>
                      <div style={{ fontSize: 10, color: EMBRY.dim }}>{gate.detail}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 8, border: `1px solid ${SURFACE_BORDER}`, backgroundColor: SURFACE_FILL }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <div style={{ fontSize: 10, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 1 }}>Lean4 formalization</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {sacmRef?.gid && <span style={{ fontSize: 9, color: EMBRY.dim, fontFamily: 'monospace' }}>{sacmRef.gid}</span>}
                {onOpenFormalMethods && (
                  <button
                    type="button"
                    data-qid="qras:evidence:open-lean4"
                    data-qs-action="OPEN_LEAN4_VIEWER"
                    title="Open Lean4 Lemma Viewer"
                    onClick={onOpenFormalMethods}
                    className="press-scale"
                    style={{
                      padding: '4px 8px',
                      borderRadius: 6,
                      border: `1px solid ${EMBRY.border}`,
                      background: 'transparent',
                      color: EMBRY.dim,
                      fontSize: 9,
                      cursor: 'pointer',
                    }}
                  >
                    Open Lean4 Viewer
                  </button>
                )}
              </div>
            </div>
            {formalProofSnippet ? (
              <pre style={{ margin: 0, padding: '10px 12px', borderRadius: 6, border: `1px solid ${EMBRY.border}`, backgroundColor: 'rgba(0,0,0,0.2)', color: EMBRY.white, fontSize: 10, lineHeight: 1.55, overflowX: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                {formalProofSnippet}
              </pre>
            ) : (
              <div style={{ fontSize: 10, color: EMBRY.dim, lineHeight: 1.45 }}>
                No Lean4 proof payload is attached to this evidence case.
              </div>
            )}
            {formalProof?.errors?.length ? (
              <div style={{ fontSize: 10, color: EMBRY.red, lineHeight: 1.45 }}>
                {formalProof.errors[0]}
              </div>
            ) : null}
            {sacmRef?.xml_snippet ? (
              <div style={{ fontSize: 10, color: EMBRY.dim, lineHeight: 1.45 }}>
                SACM: {sacmRef.xml_snippet.slice(0, 180)}{sacmRef.xml_snippet.length > 180 ? '…' : ''}
              </div>
            ) : null}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 8, border: `1px solid ${SURFACE_BORDER}`, backgroundColor: SURFACE_FILL }}>
            <div style={{ fontSize: 10, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 1 }}>Prior QRA evidence</div>
            {priorQRAEvidence.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {priorQRAEvidence.slice(0, 4).map((entry, idx) => {
                  const targetId = entry._key || entry.qra_id
                  const canOpen = Boolean(targetId && onSelectRelatedQRA)
                  const RowTag = canOpen ? 'button' : 'div'
                  return (
                    <RowTag
                      key={`${targetId || entry.citation_id || 'prior'}-${idx}`}
                      {...(canOpen ? {
                        type: 'button',
                        onClick: () => onSelectRelatedQRA?.(targetId as string),
                        'data-qid': `qras:evidence:prior-qra:${targetId}`,
                        'data-qs-action': 'SELECT_RELATED_QRA',
                        title: `Open prior QRA ${targetId}`,
                      } : {})}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: `1px solid ${EMBRY.border}`,
                        background: 'rgba(0,0,0,0.15)',
                        textAlign: 'left',
                        cursor: canOpen ? 'pointer' : 'default',
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontSize: 10, color: EMBRY.accent, fontFamily: 'monospace', fontWeight: 700 }}>{entry.citation_id || entry._key || `prior-${idx + 1}`}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {entry.source_framework ? <span style={{ fontSize: 9, color: EMBRY.dim }}>{entry.source_framework}</span> : null}
                          {targetId ? <span style={{ fontSize: 9, color: EMBRY.dim, fontFamily: 'monospace' }}>{targetId}</span> : null}
                        </div>
                      </div>
                      <div style={{ marginTop: 4, fontSize: 11, color: EMBRY.white, lineHeight: 1.45 }}>{entry.question || 'Prior evidence question unavailable.'}</div>
                      {entry.answer ? (
                        <div style={{ marginTop: 4, fontSize: 10, color: EMBRY.dim, lineHeight: 1.45 }}>
                          {entry.answer.length > 180 ? `${entry.answer.slice(0, 180)}…` : entry.answer}
                        </div>
                      ) : null}
                    </RowTag>
                  )
                })}
              </div>
            ) : (
              <div style={{ fontSize: 10, color: EMBRY.dim, lineHeight: 1.45 }}>
                No prior QRA evidence is attached to this evidence case.
              </div>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '10px 12px', borderRadius: 8, border: `1px solid ${SURFACE_BORDER}`, backgroundColor: SURFACE_FILL }}>
            <div style={{ fontSize: 10, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 1 }}>Upstream / related QRAs</div>
            {relatedQRAs.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {relatedQRAs.map((entry) => {
                  const verdictMeta = relatedQraVerdictMeta(entry.verdict)
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      data-qid={`qras:evidence:related-qra:${entry.key}`}
                      data-qs-action="SELECT_RELATED_QRA"
                      title={`Open related QRA ${entry.qraId}`}
                      onClick={() => onSelectRelatedQRA?.(entry.key)}
                      className="press-scale"
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '64px 52px 1fr',
                        gap: 10,
                        alignItems: 'center',
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: 6,
                        border: `1px solid ${EMBRY.border}`,
                        background: 'rgba(0,0,0,0.15)',
                        textAlign: 'left',
                        cursor: onSelectRelatedQRA ? 'pointer' : 'default',
                      }}
                    >
                      <span style={{ fontSize: 10, color: verdictMeta.color, fontWeight: 700, textTransform: 'uppercase' }}>{verdictMeta.label}</span>
                      <span style={{ fontSize: 10, color: EMBRY.accent, fontFamily: 'monospace', fontWeight: 700 }}>{entry.controlId}</span>
                      <span style={{ fontSize: 11, color: EMBRY.white, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.question}</span>
                    </button>
                  )
                })}
              </div>
            ) : upstreamQRAKeys.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 10, color: EMBRY.dim, lineHeight: 1.45 }}>
                  Upstream QRA keys were recorded by `/create-evidence-case`, but none of those QRAs are loaded in the current queue.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {upstreamQRAKeys.slice(0, 8).map((key) => (
                    <span key={key} style={{ fontSize: 10, color: EMBRY.accent, fontFamily: 'monospace', padding: '3px 6px', borderRadius: 999, border: `1px solid ${EMBRY.border}`, backgroundColor: 'rgba(255,255,255,0.02)' }}>
                      {key}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 10, color: EMBRY.dim, lineHeight: 1.45 }}>
                No upstream or related QRAs are linked to this evidence case yet.
              </div>
            )}
          </div>
        </div>
      ),
    },
    {
      id: 'disposition',
      number: 4,
      title: 'Disposition',
      status: dispositionStatus,
      summary: `Recommended: ${responseMeta.label}.`,
      detail: (
        <div style={{ fontSize: 11, color: EMBRY.dim, lineHeight: 1.55 }}>
          {responseMeta.label === 'Needs Human Correction'
            ? 'The answer should be corrected inline or escalated to SPARTA Chat before use.'
            : responseMeta.label === 'Deflect'
              ? 'Evidence is insufficient for a safe answer; deflect instead of asserting unsupported controls.'
              : responseMeta.label === 'Clarify'
                ? 'Ask for clarification or more evidence before answering.'
                : 'Answer can proceed because grounding and verification are aligned.'}
        </div>
      ),
    },
  ]

  const groundedControlIds = groundedControls.map((entry) => entry.id).filter(Boolean)
  const evidenceSourceLabels = [
    ...methods,
    ...priorQRAEvidence.map((entry) => entry.citation_id || entry.qra_id || entry._key || '').filter(Boolean),
    ...chains.map((chain) => chain.method || chain.relationship || chain.source || chain.from || '').filter(Boolean),
  ]
  const failedGates = liveGates.filter((gate) => !gate.passed)
  const passedGates = liveGates.filter((gate) => gate.passed)
  const referentSummary = qualityReferents.length > 0 ? summarizeIds(qualityReferents) : qraQuality?.issue_label || qualityIssueCode || 'unresolved referent'
  const anchorSummary = summarizeIds([...new Set([...questionAnchorIds, ...controlIds])], 3)
  const evidenceFlowNodes: EvidenceFlowNode[] = [
    {
      id: 'question',
      label: 'Question',
      status: questionStatus,
      targetStep: 'question',
      detail: hasBlockingQualityIssue
        ? `Blocked: ${referentSummary} is not supplied, so ${anchorSummary || 'the extracted IDs'} cannot be evaluated.`
        : questionHasGrounding ? 'Specific anchors were extracted from the question.' : 'No reliable question anchors were found.',
      evidence: hasBlockingQualityIssue && qualityReferents.length > 0
        ? qualityReferents
        : questionAnchorIds.length > 0 ? questionAnchorIds : questionEntityRefs.map((entry) => entry.id).filter(Boolean),
    },
    {
      id: 'controls',
      label: 'Grounded Controls',
      status: groundedControlIds.length > 0 || questionAnchorIds.length > 0 || controlIds.length > 0 ? 'passed' : 'failed',
      targetStep: 'question',
      detail: groundedControlIds.length > 0 ? `${groundedControlIds.length} grounded control reference(s) attached.` : 'Using extracted anchors/control IDs only.',
      evidence: groundedControlIds.length > 0 ? groundedControlIds : controlIds,
    },
    {
      id: 'sources',
      label: 'Evidence Sources',
      status: chains.length > 0 || priorQRAEvidence.length > 0 || methods.length > 0 ? 'passed' : 'pending',
      targetStep: 'verify',
      detail: evidenceSourceLabels.length > 0 ? `${evidenceSourceLabels.length} source/method signal(s) available.` : 'No source method, prior QRA, or crosswalk chain is attached.',
      evidence: evidenceSourceLabels,
    },
    {
      id: 'claims',
      label: 'Answer Claims',
      status: answerStatus,
      targetStep: 'answer',
      detail: unsupportedAnswerIds.length > 0 ? `Unsupported answer ID(s): ${summarizeIds(unsupportedAnswerIds)}.` : 'Answer stayed within the grounded scope.',
      evidence: unsupportedAnswerIds.length > 0 ? unsupportedAnswerIds : answerEntityRefs.map((entry) => entry.id).filter(Boolean),
    },
    {
      id: 'gates',
      label: 'Gates',
      status: verifyStatus,
      targetStep: 'verify',
      detail: failedGates.length > 0 ? `${failedGates.length} failed gate(s): ${summarizeIds(failedGates.map((gate) => formatGateLabel(gate.gate)), 2)}.` : liveGates.length > 0 ? `${passedGates.length}/${liveGates.length} gates passed.` : 'No live gate rows are attached.',
      evidence: failedGates.length > 0 ? failedGates.map((gate) => formatGateLabel(gate.gate)) : liveGates.map((gate) => formatGateLabel(gate.gate)),
    },
    {
      id: 'disposition',
      label: 'Disposition',
      status: dispositionStatus,
      targetStep: 'disposition',
      detail: `Recommended action: ${responseMeta.label}.`,
      evidence: [formatState(humanReviewState || gapReviewRecord?.human_review_state || 'queued')],
    },
  ]
  const advisoryFlowNodes: EvidenceFlowNode[] = [
    { id: 'failed-gate', label: failedGates.length > 0 ? `${failedGates.length} failed gate(s)` : 'Gate advisory', status: verifyStatus === 'passed' ? 'pending' : 'failed', targetStep: 'verify', advisory: true, detail: failedGates.length > 0 ? summarizeIds(failedGates.map((gate) => formatGateLabel(gate.gate)), 2) : 'No failed gate details attached.' },
    { id: 'persona-gap-reviews', label: 'Persona review', status: showCaeGapReview ? 'blocked' : 'pending', advisory: true, detail: showCaeGapReview ? gapDecision : 'No CAE gap review attached.' },
    { id: 'judge-recommendation', label: 'Judge route', status: showCaeGapReview ? 'blocked' : 'pending', advisory: true, detail: gapRoute },
    { id: 'proposed-correction', label: correctionQuestion ? 'Correction drafted' : 'No correction', status: correctionQuestion ? 'blocked' : 'pending', advisory: true, detail: correctionQuestion || 'No proposed correction is attached.' },
    { id: 'rerun-evidence-case', label: 'Rerun required', status: 'pending', advisory: true, detail: 'Any correction requires a fresh evidence case.' },
  ]
  const reviewerFocus = hasBlockingQualityIssue
    ? {
        title: `Ask for missing context: ${referentSummary}`,
        detail: `${anchorSummary || 'The extracted entities'} are present, but the QRA cannot determine relevance because the referenced payload is absent. Agent response: "What do you mean by 'this payload'?"`,
        status: 'failed' as StepStatus,
      }
    : unsupportedAnswerIds.length > 0
    ? {
        title: `Unsupported answer IDs: ${summarizeIds(unsupportedAnswerIds)}`,
        detail: 'The reviewer should correct the answer or route the QRA through repair before approval.',
        status: 'failed' as StepStatus,
      }
    : failedGates.length > 0
      ? {
          title: `Failed gates: ${summarizeIds(failedGates.map((gate) => formatGateLabel(gate.gate)), 2)}`,
          detail: failedGates[0]?.detail || 'At least one evidence gate failed.',
          status: 'failed' as StepStatus,
        }
      : !questionHasGrounding
        ? {
            title: 'Question grounding is missing',
            detail: 'The reviewer should clarify or repair the QRA before relying on the answer.',
            status: 'blocked' as StepStatus,
          }
        : {
            title: `Recommended: ${responseMeta.label}`,
            detail: verdictReason,
            status: dispositionStatus,
          }

  const primaryActionCount = shouldPromoteChat
    ? 1
    : isEditing
      ? [Boolean(onCancelEdit), Boolean(onSaveAndRerun)].filter(Boolean).length
      : [showRerunAction, Boolean(onEscalateToChat), Boolean(reviewActions)].filter(Boolean).length
  const footerColumns = variant === 'chat' || primaryActionCount <= 1 ? '1fr' : 'repeat(2, minmax(0, 1fr))'

  if (variant === 'explorer') {
    const traceRows = [
      {
        id: 'question',
        number: 1,
        Icon: MessageSquare,
        title: 'Question Claim',
        content: questionNode ?? <span style={{ color: EMBRY.dim }}>No question attached.</span>,
        status: questionStatus,
        label: hasBlockingQualityIssue ? 'Fail' : 'Identity',
        detail: stepRows[0]?.detail,
      },
      {
        id: 'entities',
        number: 2,
        Icon: ListTree,
        title: 'Extracted Entities',
        content: (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(questionAnchorIds.length > 0 ? questionAnchorIds : questionEntityRefs.map((entry) => entry.id)).slice(0, 8).map((id) => (
              <span key={`entity-pill-${id}`} style={{ borderRadius: 8, border: `1px solid ${EMBRY.blue}66`, background: `${EMBRY.blue}18`, color: '#bfdbfe', padding: '4px 8px', fontSize: 13, fontWeight: 750 }}>
                {id}
              </span>
            ))}
            {questionAnchorIds.length === 0 && questionEntityRefs.length === 0 && <span style={{ color: EMBRY.red }}>No reliable anchors resolved.</span>}
          </div>
        ),
        status: questionStatus,
        label: questionStatus === 'passed' ? 'Pass' : 'Fail',
        detail: stepRows[0]?.detail,
      },
      {
        id: 'controls',
        number: 3,
        Icon: Link2,
        title: 'Grounded Controls',
        content: (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {(groundedControlIds.length > 0 ? groundedControlIds : controlIds).slice(0, 6).map((id) => (
              <button key={`control-pill-${id}`} type="button" onClick={() => onNavigateToControl(id)} style={{ borderRadius: 8, border: `1px solid ${EMBRY.green}66`, background: `${EMBRY.green}18`, color: '#bbf7d0', padding: '4px 8px', fontSize: 13, fontWeight: 750, cursor: 'pointer' }}>
                {id}
              </button>
            ))}
            {groundedControlIds.length === 0 && controlIds.length === 0 && <span style={{ color: EMBRY.red }}>No grounded controls available.</span>}
          </div>
        ),
        status: groundedControlIds.length > 0 || controlIds.length > 0 ? 'passed' as StepStatus : 'failed' as StepStatus,
        label: groundedControlIds.length > 0 || controlIds.length > 0 ? 'Pass' : 'Fail',
        detail: stepRows[0]?.detail,
      },
      {
        id: 'sources',
        number: 4,
        Icon: FileCheck2,
        title: 'Evidence Sources',
        content: (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {evidenceSourceLabels.slice(0, 5).map((source, idx) => (
              <span key={`source-pill-${source}-${idx}`} style={{ borderRadius: 8, border: `1px solid ${EMBRY.green}55`, background: `${EMBRY.green}14`, color: '#bbf7d0', padding: '4px 8px', fontSize: 13, fontWeight: 750 }}>
                {source}
              </span>
            ))}
            {evidenceSourceLabels.length === 0 && <span style={{ color: EMBRY.amber }}>No source citations attached.</span>}
          </div>
        ),
        status: evidenceSourceLabels.length > 0 ? 'passed' as StepStatus : 'pending' as StepStatus,
        label: evidenceSourceLabels.length > 0 ? 'Pass' : 'Pending',
        detail: stepRows[2]?.detail,
      },
      {
        id: 'answer',
        number: 5,
        Icon: FileStack,
        title: 'Answer Claims',
        content: isEditing ? (
          <textarea
            value={editedAnswer}
            onChange={(event) => onEditedAnswerChange?.(event.target.value)}
            disabled={validating}
            data-qid="qras:evidence:answer-editor"
            data-qs-action="EDIT_ANSWER"
            title="Edit answer draft"
            style={{ width: '100%', minHeight: 92, resize: 'vertical', background: 'rgba(0,0,0,0.18)', border: `1px solid ${EMBRY.border}`, borderRadius: 8, color: EMBRY.white, fontSize: 13, lineHeight: 1.55, padding: 10, fontFamily: 'inherit' }}
          />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <div style={{ color: answerStatus === 'failed' ? '#fecaca' : EMBRY.white, lineHeight: 1.5 }}>
              {answerNode || (responseText ? <MarkdownRenderer content={responseText} /> : <span style={{ color: EMBRY.dim }}>No answer attached.</span>)}
            </div>
            {unsupportedAnswerIds.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {unsupportedAnswerIds.map((id) => (
                  <span key={`unsupported-claim-${id}`} style={{ borderRadius: 8, border: `1px solid ${EMBRY.red}66`, background: `${EMBRY.red}18`, color: '#fecaca', padding: '4px 8px', fontSize: 13, fontWeight: 750 }}>
                    Unsupported: {id}
                  </span>
                ))}
              </div>
            )}
          </div>
        ),
        status: answerStatus,
        label: answerStatus === 'passed' ? 'Pass' : answerStatus === 'blocked' ? 'Blocked' : 'Fail',
        detail: stepRows[1]?.detail,
      },
      {
        id: 'gates',
        number: 6,
        Icon: ShieldCheck,
        title: 'Gates',
        content: (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            {liveGates.length > 0 ? liveGates.map((gate, idx) => (
              <div key={`gate-row-${idx}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, color: gate.passed ? '#bbf7d0' : '#fecaca' }}>
                {gate.passed ? <CheckCircle2 size={17} /> : <XCircle size={17} />}
                <span>{formatGateLabel(gate.gate)}: {gate.detail}</span>
              </div>
            )) : (
              <span style={{ color: verifyStatus === 'failed' ? '#fecaca' : EMBRY.dim }}>{verdictReason}</span>
            )}
          </div>
        ),
        status: verifyStatus,
        label: verifyStatus === 'passed' ? 'Pass' : verifyStatus === 'pending' ? 'Pending' : 'Fail',
        detail: stepRows[2]?.detail,
      },
      {
        id: 'disposition',
        number: 7,
        Icon: Gavel,
        title: 'Disposition',
        content: (
          <div>
            <strong style={{ color: dispositionStatus === 'passed' ? EMBRY.green : EMBRY.amber }}>
              {responseMeta.label === 'Needs Human Correction' ? 'Review required' : responseMeta.label}
            </strong>
            <br />
            <span style={{ color: EMBRY.dim }}>{verdictReason}</span>
          </div>
        ),
        status: dispositionStatus,
        label: dispositionStatus === 'passed' ? 'Pass' : 'Review',
        detail: stepRows[3]?.detail,
      },
    ]

    const toneForLabel = (status: StepStatus) => statusTone(validating ? 'pending' : status)
    const currentConfidence = confidence !== null ? Math.max(0, Math.min(100, Math.round(confidence))) : 0
    const recommendedAction = hasBlockingQualityIssue || responseMeta.label === 'Clarify'
      ? 'Clarify & rerun'
      : unsupportedAnswerIds.length > 0 || failedGates.length > 0 || verifyStatus === 'failed'
        ? 'Correct & rerun'
        : outcome.state === 'passed'
          ? 'Approve'
          : 'Review'

    return (
      <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', height: '100%', minHeight: 0, background: 'transparent', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ padding: '0 18px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <section style={{ height: 46, borderRadius: 12, border: `1px solid ${EMBRY.green}55`, background: `linear-gradient(90deg, ${EMBRY.green}18, rgba(15,23,42,0.58))`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 13px', color: '#d6f7df', fontSize: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle2 size={17} />
              <span>Corpus counts {error ? 'degraded' : 'healthy'}</span>
              <span style={{ color: 'rgba(214,247,223,0.55)' }}>•</span>
              <span>Detail loaded</span>
              <span style={{ color: 'rgba(214,247,223,0.55)' }}>•</span>
              <span>Evidence case {validating ? 'rerunning' : 'current'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#b7c4d7' }}>
              <span>{validating ? 'Rerunning now' : 'Last hydrated: just now'}</span>
              <CheckCircle2 size={17} />
            </div>
          </section>

          <section style={{ display: 'grid', gridTemplateColumns: '1.05fr .95fr', gap: 14 }}>
            <article style={{ minHeight: 112, borderRadius: 14, border: `1px solid ${outcome.color}88`, background: `linear-gradient(180deg, ${outcome.color}14, rgba(10,16,26,0.76))`, padding: 18, display: 'flex', gap: 16, alignItems: 'center', overflow: 'hidden' }}>
              <div style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: 12, color: outcome.color, background: `${outcome.color}14`, flexShrink: 0 }}>
                <ShieldAlert size={22} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: '#b7c4d7', marginBottom: 4 }}>Verdict</div>
                <div style={{ fontSize: 20, fontWeight: 850, letterSpacing: -0.35, color: EMBRY.white, marginBottom: 5 }}>
                  {hasBlockingQualityIssue ? 'QRA question is not standalone' : unsupportedAnswerIds.length > 0 ? 'Blocked by unsupported answer claims' : outcome.state === 'passed' ? 'Evidence gates passed' : 'Evidence requires review'}
                </div>
                <div style={{ fontSize: 13, color: '#b9c5d5', lineHeight: 1.45 }}>{verdictReason}</div>
              </div>
              <div style={{ marginLeft: 'auto', width: 78, height: 78, borderRadius: 999, display: 'grid', placeItems: 'center', background: `conic-gradient(${outcome.color} 0 ${Math.round(currentConfidence * 3.6)}deg, rgba(148,163,184,0.18) ${Math.round(currentConfidence * 3.6) + 1}deg 360deg)`, position: 'relative', flexShrink: 0 }}>
                <div style={{ position: 'absolute', inset: 8, background: '#111827', borderRadius: 999 }} />
                <span style={{ position: 'relative', zIndex: 1, fontWeight: 850, fontSize: 20 }}>{currentConfidence}%</span>
              </div>
            </article>
            <article style={{ minHeight: 112, borderRadius: 14, border: `1px solid ${EMBRY.amber}88`, background: `linear-gradient(180deg, ${EMBRY.amber}14, rgba(10,16,26,0.76))`, padding: 18, display: 'flex', gap: 16, alignItems: 'center' }}>
              <div style={{ width: 40, height: 40, display: 'grid', placeItems: 'center', borderRadius: 12, color: EMBRY.amber, background: `${EMBRY.amber}14`, flexShrink: 0 }}>
                <RefreshCw size={22} />
              </div>
              <div>
                <div style={{ fontSize: 13, color: EMBRY.amber, marginBottom: 4, fontWeight: 750 }}>Recommended action</div>
                <div style={{ fontSize: 20, fontWeight: 850, letterSpacing: -0.35, color: EMBRY.white, marginBottom: 5 }}>{recommendedAction}</div>
                <div style={{ fontSize: 13, color: '#b9c5d5', lineHeight: 1.45 }}>
                  {recommendedAction === 'Approve' ? 'Evidence is aligned enough for approval.' : 'Repair the question or answer, then rerun the evidence case before approval.'}
                </div>
              </div>
              <span style={{ marginLeft: 'auto', borderRadius: 7, padding: '4px 7px', fontSize: 12, fontWeight: 850, color: EMBRY.amber, border: `1px solid ${EMBRY.amber}77`, background: `${EMBRY.amber}18` }}>
                {outcome.label === 'PASS' ? 'Pass' : 'Failed gate'}
              </span>
            </article>
          </section>
        </div>

        <div style={{ minHeight: 0, padding: '14px 18px 0', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 320px)', gap: 14, overflow: 'hidden' }}>
          <section style={{ minHeight: 0, borderRadius: 14, border: `1px solid ${EMBRY.border}`, background: 'rgba(12,19,31,0.68)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', borderBottom: `1px solid ${EMBRY.border}`, background: 'rgba(15,23,42,0.42)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontWeight: 850, color: EMBRY.white }}>
                Evidence Trace <Info size={14} color={EMBRY.dim} /> <small style={{ color: EMBRY.dim, fontWeight: 650 }}>7 sections</small>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button type="button" onClick={() => setExpandedStep(expandedStep ? null : 'gates')} style={{ height: 34, borderRadius: 8, border: `1px solid ${EMBRY.border}`, background: 'rgba(15,23,42,0.58)', color: EMBRY.white, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0 10px', fontSize: 13, fontWeight: 750, cursor: 'pointer' }}>
                  <Expand size={15} /> Expand all
                </button>
                <button type="button" aria-label="Collapse trace panel" style={{ width: 34, height: 34, borderRadius: 8, border: `1px solid ${EMBRY.border}`, background: 'rgba(15,23,42,0.58)', color: EMBRY.dim, display: 'grid', placeItems: 'center' }}>
                  <PanelTop size={15} />
                </button>
              </div>
            </div>
            <div style={{ padding: 8, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 7 }}>
              {traceRows.map((step) => {
                const tone = toneForLabel(step.status)
                const open = expandedStep === step.id
                return (
                  <section key={step.id} style={{ flexShrink: 0, borderRadius: 12, border: `1px solid ${step.status === 'failed' ? EMBRY.red : EMBRY.border}`, background: step.status === 'failed' ? `linear-gradient(180deg, ${EMBRY.red}14, rgba(17,27,43,0.72))` : 'linear-gradient(180deg, rgba(17,27,43,0.78), rgba(14,22,35,0.70))', overflow: 'hidden' }}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => setExpandedStep(open ? null : step.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          setExpandedStep(open ? null : step.id)
                        }
                      }}
                      style={{
                        width: '100%',
                        minHeight: step.id === 'answer' || step.id === 'gates' ? 86 : 58,
                        display: 'grid',
                        gridTemplateColumns: '40px 38px 160px minmax(260px,1fr) 110px 32px',
                        alignItems: 'center',
                        gap: 10,
                        padding: '10px 12px',
                        color: EMBRY.white,
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      <span style={{ width: 28, height: 28, display: 'grid', placeItems: 'center', borderRadius: 999, color: step.status === 'failed' ? '#fecaca' : '#bfdbfe', border: `1px solid ${step.status === 'failed' ? EMBRY.red : EMBRY.blue}88`, background: `${step.status === 'failed' ? EMBRY.red : EMBRY.blue}18`, fontWeight: 850 }}>{step.number}</span>
                      <span style={{ color: '#c8d4e5', display: 'grid', placeItems: 'center' }}><step.Icon size={21} /></span>
                      <span style={{ fontWeight: 850, fontSize: 14 }}>{step.title}</span>
                      <div style={{ color: '#d2dce9', fontSize: 14, lineHeight: 1.55, minWidth: 0 }}>{step.content}</div>
                      <span style={{ display: 'inline-flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, color: tone.color, fontWeight: 850, fontSize: 13 }}><span style={{ width: 9, height: 9, borderRadius: 999, background: tone.color }} />{step.label}</span>
                      <ChevronDown size={16} style={{ color: EMBRY.dim, transform: open ? 'rotate(180deg)' : undefined }} />
                    </div>
                    {open && <div style={{ padding: '0 14px 14px 88px' }}>{step.detail}</div>}
                  </section>
                )
              })}
              {error && (
                <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 8, border: `1px solid ${EMBRY.red}55`, backgroundColor: `${EMBRY.red}10`, color: EMBRY.red, fontSize: 12, lineHeight: 1.45 }}>
                  <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                  <span>{error}</span>
                </div>
              )}
            </div>
          </section>

          <section style={{ minHeight: 0, borderRadius: 14, border: `1px solid ${EMBRY.border}`, background: 'linear-gradient(180deg, rgba(13,21,34,0.88), rgba(8,13,22,0.78))', padding: 18, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ display: 'flex', gap: 9, alignItems: 'center', fontWeight: 900, fontSize: 17, color: EMBRY.white }}>Evidence Flow <Info size={14} color={EMBRY.dim} /></div>
            </div>
            <EvidencePathSummary nodes={evidenceFlowNodes} advisoryNodes={advisoryFlowNodes} reviewerFocus={reviewerFocus} onOpenStep={(stepId) => setExpandedStep(stepId)} />
          </section>
        </div>

        <footer style={{ margin: '14px 18px 16px', minHeight: 86, border: `1px solid ${EMBRY.border}`, borderRadius: 14, background: 'rgba(13,21,34,0.86)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', boxShadow: '0 -8px 36px rgba(0,0,0,0.18)' }}>
          <button type="button" style={{ height: 42, borderRadius: 10, border: `1px solid ${EMBRY.border}`, background: 'rgba(15,23,42,0.58)', color: EMBRY.white, display: 'inline-flex', alignItems: 'center', gap: 9, padding: '0 14px', fontSize: 14, fontWeight: 750 }}>
            <MessageSquarePlus size={16} /> Add internal note
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {reviewActions}
            {isEditing ? (
              <>
                {onCancelEdit && <button type="button" onClick={onCancelEdit} style={{ height: 42, borderRadius: 10, border: `1px solid ${EMBRY.border}`, background: 'rgba(15,23,42,0.58)', color: EMBRY.dim, padding: '0 14px', fontWeight: 800 }}>Cancel</button>}
                {onSaveAndRerun && <button type="button" onClick={onSaveAndRerun} disabled={validating} style={{ height: 42, borderRadius: 10, border: `1px solid ${EMBRY.blue}88`, background: EMBRY.blue, color: EMBRY.white, padding: '0 16px', fontWeight: 850 }}>Save & rerun</button>}
              </>
            ) : (
              <>
                {!showEditAction && onRunValidation && (
                  <button type="button" data-qid="qras:action:validate-evidence" data-qs-action="VALIDATE_EVIDENCE" onClick={onRunValidation} disabled={validating} style={{ height: 42, borderRadius: 10, border: `1px solid ${EMBRY.blue}88`, background: EMBRY.blue, color: EMBRY.white, display: 'inline-flex', alignItems: 'center', gap: 9, padding: '0 16px', fontSize: 14, fontWeight: 850, cursor: validating ? 'wait' : 'pointer' }}>
                    <RefreshCw size={16} /> {validating ? 'Rerunning' : 'Correct & rerun'}
                  </button>
                )}
                {onStartEdit && (
                  <button type="button" data-qid="qras:action:edit-answer" data-qs-action="EDIT_ANSWER" onClick={onStartEdit} style={{ height: 42, borderRadius: 10, border: `1px solid ${EMBRY.blue}88`, background: EMBRY.blue, color: EMBRY.white, display: 'inline-flex', alignItems: 'center', gap: 9, padding: '0 16px', fontSize: 14, fontWeight: 850, cursor: 'pointer' }}>
                    <RefreshCw size={16} /> Correct & rerun
                  </button>
                )}
                {onEscalateToChat && (
                  <button type="button" data-qid="qras:action:refine-in-chat" data-qs-action="REFINE_IN_CHAT" onClick={onEscalateToChat} style={{ height: 42, borderRadius: 10, border: `1px solid ${EMBRY.border}`, background: 'rgba(15,23,42,0.58)', color: EMBRY.white, display: 'inline-flex', alignItems: 'center', gap: 9, padding: '0 14px', fontSize: 14, fontWeight: 750 }}>
                    <UserRoundPlus size={16} /> Escalate
                  </button>
                )}
              </>
            )}
          </div>
        </footer>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, backgroundColor: EMBRY.bg }}>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: `12px ${PANE_PADDING}px ${PANE_PADDING}px`, display: 'flex', flexDirection: 'column', gap: 10, fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div
          style={{
            position: isEditing ? 'sticky' : 'static',
            top: 0,
            zIndex: 2,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            paddingBottom: 4,
            backgroundColor: isEditing ? EMBRY.bg : 'transparent',
          }}
        >
          <section
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '11px 13px',
              backgroundColor: `${outcome.color}12`,
              border: `1px solid ${outcome.color}33`,
              borderRadius: 8,
              boxShadow: `inset 0 1px 0 ${outcome.color}14`,
              fontFamily: 'Inter, system-ui, sans-serif',
            }}
          >
            <outcome.Icon
              size={16}
              aria-hidden="true"
              style={{ color: outcome.color, flexShrink: 0, marginTop: 2 }}
            />
            <span style={{ padding: '4px 8px', borderRadius: 5, backgroundColor: outcome.color, color: EMBRY.white, fontSize: 10, fontWeight: 900, letterSpacing: 0.5, textTransform: 'uppercase', lineHeight: 1.2 }}>
              {outcome.label}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: EMBRY.white, fontWeight: 700, lineHeight: 1.4 }}>
                {verdictReason}
              </div>
              <div style={{ fontSize: 10, color: EMBRY.dim, lineHeight: 1.4 }}>
                {outcome.label === 'INCONCLUSIVE'
                  ? 'Validation completed, but a human still needs to decide how to proceed.'
                  : outcome.label === 'PENDING'
                    ? 'The evidence pipeline is still evaluating this case.'
                    : null}
              </div>
            </div>
          </section>

          <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 10, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800 }}>
              {variant === 'chat' ? 'Question Reference' : 'Question'}
            </div>
            <div style={{ padding: variant === 'chat' ? '8px 10px' : '10px 12px', backgroundColor: SURFACE_FILL, border: `1px solid ${SURFACE_BORDER}`, borderRadius: 8, fontSize: variant === 'chat' ? 10 : 12, color: variant === 'chat' ? EMBRY.dim : EMBRY.white, lineHeight: variant === 'chat' ? 1.45 : 1.62 }}>
              {questionNode ?? <span style={{ color: EMBRY.dim }}>No question attached.</span>}
            </div>
          </section>
        </div>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ fontSize: 10, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800 }}>
              {isEditing ? 'Edit Answer' : 'Answer'}
            </div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {!isEditing && showEditAction && onStartEdit && (
                <button
                  type="button"
                  data-qid="qras:action:edit-answer"
                  data-qs-action="EDIT_ANSWER"
                  title="Edit the answer inline"
                  onClick={onStartEdit}
                  className="press-scale"
                  style={{
                    padding: '4px 8px',
                    borderRadius: 5,
                    border: `1px solid ${EMBRY.border}`,
                    backgroundColor: 'transparent',
                    color: EMBRY.dim,
                    cursor: 'pointer',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: 0.3,
                    textTransform: 'uppercase',
                  }}
                >
                  Edit
                </button>
              )}
              {validating && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: EMBRY.accent, fontSize: 10, fontWeight: 700 }}>
                  <RefreshCw size={12} /> Re-evaluating
                </div>
              )}
            </div>
          </div>
          <div style={{ padding: '10px 12px', backgroundColor: isEditing ? `${EMBRY.accent}08` : SURFACE_FILL, border: `1px solid ${isEditing ? `${EMBRY.accent}55` : SURFACE_BORDER}`, borderRadius: 8 }}>
            {isEditing ? (
              <>
                <textarea
                  value={editedAnswer}
                  onChange={(event) => onEditedAnswerChange?.(event.target.value)}
                  disabled={validating}
                  data-qid="qras:evidence:answer-editor"
                  data-qs-action="EDIT_ANSWER"
                  title="Edit answer draft"
                  style={{
                    width: '100%',
                    minHeight: 132,
                    resize: 'vertical',
                    backgroundColor: 'transparent',
                    border: 'none',
                    outline: 'none',
                    color: EMBRY.white,
                    fontSize: 12,
                    lineHeight: 1.6,
                    fontFamily: 'inherit',
                  }}
                />
                {draftUnknownIds.length > 0 && (
                  <div style={{ marginTop: 10, fontSize: 10, color: EMBRY.red, lineHeight: 1.5 }}>
                    Check IDs before rerun:{' '}
                    {draftUnknownIds.map((id, idx) => (
                      <span
                        key={`draft-unknown-${id}`}
                        style={{ textDecoration: 'underline wavy #ef4444', textUnderlineOffset: '3px', fontWeight: 700, marginRight: idx === draftUnknownIds.length - 1 ? 0 : 6 }}
                      >
                        {id}
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <div style={{ fontSize: 12, color: EMBRY.white, lineHeight: 1.65 }}>
                {answerNode || (responseText ? <MarkdownRenderer content={responseText} /> : <span style={{ color: EMBRY.dim }}>No answer attached.</span>)}
              </div>
            )}
            {answerHelperText && (
              <div style={{ marginTop: 10, fontSize: 10, color: EMBRY.red, lineHeight: 1.5 }}>
                {answerHelperText}
              </div>
            )}
          </div>
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 10, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 1, fontWeight: 800 }}>Evidence Trace</div>
          <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ position: 'absolute', left: TRACE_LINE_LEFT, top: 18, bottom: 18, width: 1, backgroundColor: 'rgba(255,255,255,0.08)', pointerEvents: 'none' }} />
            {stepRows.map((step) => {
              const tone = statusTone(validating ? 'pending' : step.status)
              const open = expandedStep === step.id
              const isPendingNode = validating ? true : step.status === 'pending'
              const StatusIcon = tone.Icon
              return (
                <section
                  key={step.id}
                  style={{
                    position: 'relative',
                    borderRadius: 8,
                    border: open || step.status === 'failed' ? `1px solid ${tone.border}` : `1px solid ${SURFACE_BORDER}`,
                    backgroundColor: open || step.status === 'failed' ? tone.bg : 'rgba(255,255,255,0.01)',
                    overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    data-qid={`qras:evidence:step:${step.id}`}
                    data-qs-action="TOGGLE_EVIDENCE_STEP"
                    title={`Toggle ${step.title}`}
                    onClick={() => setExpandedStep((current) => current === step.id ? null : step.id)}
                    className="press-scale"
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      padding: '9px 11px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'inherit',
                      textAlign: 'left',
                    }}
                  >
                    <div
                      aria-label={`Step ${step.number}: ${validating ? 'Re-evaluating' : tone.label}`}
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: '50%',
                        backgroundColor: isPendingNode ? EMBRY.bg : open || step.status === 'failed' ? tone.color : EMBRY.bg,
                        border: `1px solid ${open || step.status === 'failed' || isPendingNode ? tone.color : SURFACE_BORDER}`,
                        color: EMBRY.white,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 900,
                        flexShrink: 0,
                      }}
                    >
                      {isPendingNode ? (
                        <span style={{ fontSize: 10, lineHeight: 1 }}>{step.number}</span>
                      ) : (
                        <StatusIcon size={12} aria-hidden="true" />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: 10, color: EMBRY.white, fontWeight: 800, letterSpacing: 0.7, textTransform: 'uppercase' }}>{step.number}. {step.title}</div>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 9, color: tone.color, fontWeight: 800, textTransform: 'uppercase' }}>
                          {validating ? <Loader2 size={10} aria-hidden="true" /> : (!isPendingNode ? <StatusIcon size={10} aria-hidden="true" /> : null)}
                          {validating ? 'Re-evaluating' : tone.label}
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: step.status === 'failed' ? '#fda4af' : EMBRY.dim, lineHeight: 1.4 }}>{step.summary}</div>
                    </div>
                    {open ? <ChevronDown size={14} color={EMBRY.dim} /> : <ChevronRight size={14} color={EMBRY.dim} />}
                  </button>
                  {open && <div style={{ padding: '0 12px 10px 42px' }}>{step.detail}</div>}
                </section>
              )
            })}
          </div>
        </section>

        <EvidencePathSummary
          nodes={evidenceFlowNodes}
          advisoryNodes={advisoryFlowNodes}
          reviewerFocus={reviewerFocus}
          onOpenStep={(stepId) => setExpandedStep(stepId)}
        />

        {showCaeGapReview && (
          <section
            data-qid="qras:evidence:cae-gap-review"
            data-qs-action="VIEW_CAE_GAP_REVIEW"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              padding: '11px 13px',
              borderRadius: 8,
              border: `1px solid ${EMBRY.amber}33`,
              backgroundColor: `${EMBRY.amber}0f`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 10, color: EMBRY.white, fontWeight: 900, letterSpacing: 0.8, textTransform: 'uppercase' }}>CAE Gap Review</span>
                  <span style={{ padding: '2px 6px', borderRadius: 4, border: `1px solid ${EMBRY.amber}44`, color: EMBRY.amber, backgroundColor: `${EMBRY.amber}14`, fontSize: 9, fontWeight: 900, textTransform: 'uppercase' }}>
                    Advisory
                  </span>
                </div>
                <div style={{ fontSize: 11, color: EMBRY.dim, lineHeight: 1.45 }}>
                  Advisory-only diagnosis. It does not mutate, approve, or human-bless this QRA; any correction must be followed by a fresh evidence case.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <span style={{ padding: '3px 6px', borderRadius: 4, border: `1px solid ${EMBRY.border}`, color: EMBRY.amber, fontSize: 9, fontWeight: 800 }}>
                  {formatState(gapReviewStatus || gapReviewRecord?.gap_review_status || 'candidate')}
                </span>
                <span style={{ padding: '3px 6px', borderRadius: 4, border: `1px solid ${EMBRY.border}`, color: EMBRY.dim, fontSize: 9, fontWeight: 800 }}>
                  HUMAN {formatState(humanReviewState || gapReviewRecord?.human_review_state || 'queued')}
                </span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
              <div style={{ padding: '8px 10px', borderRadius: 6, border: `1px solid ${SURFACE_BORDER}`, backgroundColor: 'rgba(0,0,0,0.16)' }}>
                <div style={{ fontSize: 9, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>Decision</div>
                <div style={{ fontSize: 11, color: EMBRY.white, fontWeight: 800 }}>{formatState(gapDecision)}</div>
              </div>
              <div style={{ padding: '8px 10px', borderRadius: 6, border: `1px solid ${SURFACE_BORDER}`, backgroundColor: 'rgba(0,0,0,0.16)' }}>
                <div style={{ fontSize: 9, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>Judge Route</div>
                <div style={{ fontSize: 11, color: EMBRY.white, fontWeight: 800 }}>{formatState(gapRoute)}</div>
              </div>
              <div style={{ padding: '8px 10px', borderRadius: 6, border: `1px solid ${SURFACE_BORDER}`, backgroundColor: 'rgba(0,0,0,0.16)' }}>
                <div style={{ fontSize: 9, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>Mutation Policy</div>
                <div style={{ fontSize: 11, color: EMBRY.white, fontWeight: 800 }}>NO IN-PLACE REPAIR</div>
              </div>
            </div>

            {qualityIssueCode && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                <span style={{ fontSize: 10, color: EMBRY.amber, fontWeight: 900, textTransform: 'uppercase' }}>
                  {qraQuality?.issue_label || qualityIssueCode}
                </span>
                {qualityDisposition && <span style={{ fontSize: 10, color: EMBRY.dim }}>{qualityDisposition.replace(/_/g, ' ')}</span>}
                {qraQuality?.safe_action && <span style={{ fontSize: 10, color: EMBRY.dim }}>safe action: {qraQuality.safe_action.replace(/_/g, ' ')}</span>}
              </div>
            )}

            {gapFindings.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <div style={{ fontSize: 9, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 0.8 }}>Findings</div>
                {gapFindings.slice(0, 4).map((finding, idx) => (
                  <div key={`cae-gap-finding-${idx}`} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 10.5, color: EMBRY.dim, lineHeight: 1.45 }}>
                    <AlertCircle size={12} color={EMBRY.amber} style={{ flexShrink: 0, marginTop: 2 }} />
                    <span>{finding}</span>
                  </div>
                ))}
              </div>
            )}

            {(correctionQuestion || correctionRationale.length > 0 || gapCorrectionLineage) && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '9px 10px', borderRadius: 6, border: `1px solid ${SURFACE_BORDER}`, backgroundColor: 'rgba(0,0,0,0.14)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 9, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 0.8 }}>Suggested correction lineage</span>
                  {asText(gapProposedCorrection?.id) && <span style={{ fontSize: 9, color: EMBRY.dim, fontFamily: 'monospace' }}>{asText(gapProposedCorrection?.id)}</span>}
                </div>
                {correctionQuestion && (
                  <div style={{ fontSize: 11, color: EMBRY.white, lineHeight: 1.45 }}>
                    {correctionQuestion}
                  </div>
                )}
                {correctionRationale.length > 0 && (
                  <div style={{ fontSize: 10, color: EMBRY.dim, lineHeight: 1.45 }}>
                    {correctionRationale[0]}
                  </div>
                )}
                {asText(gapCorrectionLineage?.previous_version) && (
                  <div style={{ fontSize: 9, color: EMBRY.dim, fontFamily: 'monospace' }}>
                    Previous version: {asText(gapCorrectionLineage?.previous_version)}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <ToggleSection open={controlsOpen} onToggle={() => setControlsOpen((value) => !value)} label="Grounded Controls">
          {groupedFrameworks.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {groupedFrameworks.map(([framework, entries]) => (
                <div key={`grounded-group-${framework}`}>
                  <div style={{ fontSize: 10, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{framework}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {entries.slice(0, 4).map((entry) => (
                      <button
                        key={`grounded-${entry.id}`}
                        type="button"
                        data-qid={`qras:evidence:grounded-control:${entry.id}`}
                        data-qs-action="NAVIGATE_TO_CONTROL"
                        title={`Open grounded control ${entry.id}`}
                        onClick={() => onNavigateToControl(entry.id)}
                        className="press-scale"
                        style={{
                          padding: '3px 6px',
                          borderRadius: 4,
                          border: `1px solid ${(FW_COLORS[framework.toUpperCase()] || EMBRY.accent)}33`,
                          backgroundColor: `${FW_COLORS[framework.toUpperCase()] || EMBRY.accent}10`,
                          color: FW_COLORS[framework.toUpperCase()] || EMBRY.accent,
                          cursor: 'pointer',
                          fontSize: 10,
                          fontWeight: 700,
                          fontFamily: 'monospace',
                        }}
                      >
                        {entry.id}
                      </button>
                    ))}
                    {entries.length > 4 && (
                      <span style={{ padding: '3px 6px', borderRadius: 4, border: `1px solid ${EMBRY.border}`, color: EMBRY.dim, fontSize: 10 }}>
                        +{entries.length - 4} more
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: EMBRY.dim }}>No grounded controls are attached to this case.</div>
          )}
        </ToggleSection>

        <ToggleSection open={entitiesOpen} onToggle={() => setEntitiesOpen((value) => !value)} label={glossaryLabel}>
          {glossary.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {glossary.map((entry) => {
                const color = FW_COLORS[entry.framework?.toUpperCase()] || EMBRY.dim
                return (
                  <div key={`glossary-${entry.id}`} style={{ padding: '8px 10px', borderRadius: 6, border: `1px solid ${EMBRY.border}`, backgroundColor: 'rgba(0,0,0,0.15)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color, fontFamily: 'monospace' }}>{entry.id}</span>
                      <span style={{ fontSize: 9, color: EMBRY.dim }}>{entry.framework}</span>
                    </div>
                    <div title={`${entry.name}${entry.description ? ` — ${entry.description}` : ''}${entry.framework ? ` (${entry.framework})` : ''}`} style={{ marginTop: 4, fontSize: 11, color: EMBRY.white }}>
                      {entry.name}
                    </div>
                    {entry.description && <div style={{ marginTop: 4, fontSize: 10, color: EMBRY.dim, lineHeight: 1.45 }}>{entry.description}</div>}
                  </div>
                )
              })}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: EMBRY.dim }}>No resolved entities are attached to this case.</div>
          )}
        </ToggleSection>

        {reasoning && (
          <ToggleSection open={reasoningOpen} onToggle={() => setReasoningOpen((value) => !value)} label="Supporting Reasoning">
            <div style={{ fontSize: 11, color: EMBRY.dim, lineHeight: 1.6 }}>
              <MarkdownRenderer content={reasoning} />
            </div>
          </ToggleSection>
        )}

        {error && (
          <div style={{ display: 'flex', gap: 8, padding: '10px 12px', borderRadius: 8, border: `1px solid ${EMBRY.red}33`, backgroundColor: `${EMBRY.red}10`, color: EMBRY.red, fontSize: 11, lineHeight: 1.45 }}>
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div style={{ flexShrink: 0, position: 'sticky', bottom: 0, borderTop: `1px solid ${SURFACE_BORDER}`, backgroundColor: 'rgba(12,15,20,0.86)', backdropFilter: 'blur(10px)', padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'Inter, system-ui, sans-serif' }}>
        {isEditing ? (
          <div style={{ display: 'grid', gridTemplateColumns: footerColumns, gap: 8, justifyItems: primaryActionCount <= 1 ? 'start' : 'stretch' }}>
            {onCancelEdit && (
              <button
                type="button"
                data-qid="qras:action:cancel-edit"
                data-qs-action="CANCEL_EDIT_ANSWER"
                title="Cancel answer editing"
                onClick={onCancelEdit}
                className="press-scale"
                style={{ width: primaryActionCount <= 1 && variant !== 'chat' ? 188 : '100%', padding: '10px 14px', borderRadius: 6, border: `1px solid ${EMBRY.border}`, background: 'transparent', color: EMBRY.dim, cursor: 'pointer', fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase' }}
              >
                Cancel
              </button>
            )}
            {onSaveAndRerun && (
              <button
                type="button"
                data-qid="qras:action:save-rerun"
                data-qs-action="SAVE_AND_RERUN"
                title="Save the edited answer and rerun evidence context"
                onClick={onSaveAndRerun}
                disabled={validating}
                className="press-scale"
                style={{ width: primaryActionCount <= 1 && variant !== 'chat' ? 188 : '100%', padding: '10px 14px', borderRadius: 6, border: 'none', backgroundColor: EMBRY.accent, color: EMBRY.white, cursor: validating ? 'wait' : 'pointer', fontSize: 10, fontWeight: 800, letterSpacing: 0.4, textTransform: 'uppercase' }}
              >
                {validating ? 'Rerunning…' : 'Save & Rerun'}
              </button>
            )}
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: variant === 'chat' ? 'wrap' : 'nowrap', alignItems: 'center', gap: 8, overflowX: variant === 'chat' ? 'visible' : 'auto' }}>
            {reviewActions}
            {showRerunAction && (
              <button
                type="button"
                data-qid="qras:action:validate-evidence"
                data-qs-action="VALIDATE_EVIDENCE"
                title="Rerun /create-evidence-case"
                onClick={onRunValidation}
                disabled={validating}
                className="press-scale"
                style={{ flexShrink: 0, width: 36, height: 36, padding: 0, borderRadius: 6, border: 'none', backgroundColor: 'transparent', color: EMBRY.dim, cursor: validating ? 'wait' : 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <RefreshCw size={14} />
              </button>
            )}
            {onEscalateToChat && (
              <button
                type="button"
                data-qid="qras:action:refine-in-chat"
                data-qs-action="REFINE_IN_CHAT"
                title="Open this QRA in SPARTA Chat"
                onClick={onEscalateToChat}
                className="press-scale"
                style={{ flexShrink: 0, width: 36, height: 36, padding: 0, borderRadius: 6, border: 'none', background: 'transparent', color: EMBRY.dim, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <MessageSquareText size={14} />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default EvidenceCaseTrace

import { useMemo, useState } from 'react'
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Loader2,
  MessageSquareText,
  RefreshCw,
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
  verdict: 'all' | 'failed' | 'passed'
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

const FW_COLORS: Record<string, string> = {
  SPARTA: EMBRY.accent,
  NIST: EMBRY.green,
  CWE: EMBRY.amber,
  ATTACK: EMBRY.red,
  'ATT&CK': EMBRY.red,
  D3FEND: EMBRY.blue,
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
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
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

  const [expandedStep, setExpandedStep] = useState<string | null>(null)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [entitiesOpen, setEntitiesOpen] = useState(false)
  const [reasoningOpen, setReasoningOpen] = useState(false)

  const effectiveGatesPassed = gatesPassed ?? (liveGates.length > 0 ? liveGates.filter((gate) => gate.passed).length : undefined)
  const effectiveGatesTotal = gatesTotal ?? (liveGates.length > 0 ? liveGates.length : undefined)
  const baseOutcome = deriveOutcome(evidenceVerdict || reviewStatus, effectiveGatesPassed, effectiveGatesTotal)
  const outcome = unsupportedAnswerIds.length > 0
    ? { ...baseOutcome, state: 'failed' as OutcomeState, label: 'FAIL', color: EMBRY.red, Icon: XCircle }
    : baseOutcome
  const cweCrosswalk = useMemo(() => deriveCweCrosswalk(chains), [chains])
  const disposition = deriveDisposition(responseAction, outcome.state, unsupportedAnswerIds)
  const responseMeta = RESPONSE_COPY[disposition]
  const responseText = normalizeAgentResponse(agentResponse)
  const questionHasGrounding = questionEntityRefs.length > 0 || questionAnchorIds.length > 0
  const answerStatus: StepStatus = !questionHasGrounding ? 'blocked' : unsupportedAnswerIds.length > 0 ? 'failed' : 'passed'
  const verifyStatus: StepStatus = !questionHasGrounding || unsupportedAnswerIds.length > 0
    ? 'blocked'
    : cweCrosswalk.found || outcome.state === 'passed'
      ? 'passed'
      : liveGates.length > 0 || effectiveGatesTotal
        ? 'failed'
        : 'pending'
  const dispositionStatus: StepStatus = !questionHasGrounding ? 'blocked' : unsupportedAnswerIds.length > 0 ? 'failed' : outcome.state === 'passed' ? 'passed' : outcome.state === 'pending' ? 'pending' : 'blocked'
  const verdictReason = verdictWhy
    || (unsupportedAnswerIds.length > 0
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
      status: questionHasGrounding ? 'passed' as StepStatus : 'failed' as StepStatus,
      summary: questionGroundingSummary || 'Question grounding has not been evaluated.',
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
                  const verdictColor = entry.verdict === 'passed' ? EMBRY.green : EMBRY.red
                  return (
                    <button
                      key={entry.key}
                      type="button"
                      data-qid={`qras:evidence:related-qra:${entry.key}`}
                      data-qs-action="SELECT_RELATED_QRA"
                      title={`Open related QRA ${entry.qraId}`}
                      onClick={() => onSelectRelatedQRA?.(entry.key)}
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
                      <span style={{ fontSize: 10, color: verdictColor, fontWeight: 700, textTransform: 'uppercase' }}>{entry.verdict === 'passed' ? 'Pass' : 'Needs review'}</span>
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

  const primaryActionCount = shouldPromoteChat
    ? 1
    : isEditing
      ? [Boolean(onCancelEdit), Boolean(onSaveAndRerun)].filter(Boolean).length
      : [showRerunAction, Boolean(onEscalateToChat), Boolean(reviewActions)].filter(Boolean).length
  const footerColumns = variant === 'chat' || primaryActionCount <= 1 ? '1fr' : 'repeat(2, minmax(0, 1fr))'

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

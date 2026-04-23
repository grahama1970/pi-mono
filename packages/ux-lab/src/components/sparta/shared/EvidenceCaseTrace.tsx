import { useMemo, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { EMBRY, body } from '../common/EmbryStyle'
import type { CrosswalkChain } from '../../../hooks/useSpartaCollections'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import { BuildingEvidenceCase, type BuildingStep } from './BuildingEvidenceCase'
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

interface EvidenceCaseTraceProps {
  questionNode?: React.ReactNode
  reviewStatus: string
  confidence: number | null
  formalProofSuccess?: boolean
  hasFormalProof: boolean
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
  error?: string | null
  onNavigateToControl: (controlId: string) => void
  onRunValidation?: () => void
  validating?: boolean
}

type OutcomeState = 'passed' | 'inconclusive' | 'failed' | 'pending'
type ResponseDisposition = 'answer' | 'deflect' | 'clarify'

const RESPONSE_COPY: Record<ResponseDisposition, { label: string; color: string; empty: string }> = {
  answer: {
    label: 'ANSWER',
    color: EMBRY.accent,
    empty: 'No agent answer is attached yet.',
  },
  deflect: {
    label: 'DEFLECT',
    color: EMBRY.red,
    empty: 'The current evidence does not support a safe answer.',
  },
  clarify: {
    label: 'CLARIFY',
    color: EMBRY.amber,
    empty: 'More evidence or user clarification is required before answering.',
  },
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
  return 'GATE'
}

function deriveCweCrosswalk(chains: CrosswalkChain[]): {
  found: boolean
  targetId?: string
  pathLabel?: string
} {
  for (const chain of chains) {
    const hops = Array.isArray(chain.hops) ? chain.hops : []
    const sourceFramework = String(chain.from_framework || '').toUpperCase()
    const targetFramework = String(chain.to_framework || '').toUpperCase()
    const sourceId = String(chain.source || chain.from || '').trim()
    const targetId = String(chain.target || '').trim()

    const pathNodes = [
      ...(sourceId ? [{ id: sourceId, framework: sourceFramework || 'SOURCE' }] : []),
      ...hops.map((hop) => ({
        id: String(hop.control_id || hop.id || '').trim(),
        framework: String(hop.framework || '').toUpperCase(),
      })),
      ...(targetId ? [{ id: targetId, framework: targetFramework || 'TARGET' }] : []),
    ].filter((node) => node.id)

    const cweNode = pathNodes.find((node) => node.framework === 'CWE' || /^CWE-\d+$/i.test(node.id))
    if (!cweNode) continue

    return {
      found: true,
      targetId: cweNode.id.toUpperCase(),
      pathLabel: pathNodes.map((node) => node.framework || node.id).join(' -> '),
    }
  }

  return { found: false }
}

function StepCard({
  index,
  title,
  subtitle,
  children,
}: {
  index: number
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <section
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 12,
        backgroundColor: 'rgba(0,0,0,0.18)',
        border: `1px solid ${EMBRY.border}`,
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 22,
            height: 22,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: `${EMBRY.accent}18`,
            color: EMBRY.accent,
            fontSize: 10,
            fontWeight: 800,
            fontFamily: 'monospace',
            flexShrink: 0,
          }}
        >
          {index}
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: EMBRY.white, textTransform: 'uppercase' }}>{title}</div>
          {subtitle && <div style={{ fontSize: 10, color: EMBRY.dim, marginTop: 2 }}>{subtitle}</div>}
        </div>
      </div>
      {children}
    </section>
  )
}

function deriveOutcome(verdict: string | undefined, gatesPassed: number | undefined, gatesTotal: number | undefined): {
  state: OutcomeState
  label: string
  color: string
  Icon: typeof CheckCircle2
} {
  const normalized = (verdict || '').trim().toLowerCase()

  if (normalized === 'satisfied' || normalized === 'pass' || normalized === 'passed') {
    return { state: 'passed', label: 'Passed /create-evidence-case', color: EMBRY.green, Icon: CheckCircle2 }
  }
  if (normalized === 'inconclusive' || normalized === 'auto' || normalized === 'qualified') {
    return { state: 'inconclusive', label: 'Inconclusive evidence case', color: EMBRY.amber, Icon: AlertCircle }
  }
  if (normalized === 'not_satisfied' || normalized === 'failed' || normalized === 'fail' || normalized === 'rejected') {
    return { state: 'failed', label: 'Failed /create-evidence-case', color: EMBRY.red, Icon: XCircle }
  }

  if ((gatesTotal ?? 0) > 0) {
    if (gatesPassed === gatesTotal) {
      return { state: 'passed', label: 'Passed /create-evidence-case', color: EMBRY.green, Icon: CheckCircle2 }
    }
    if ((gatesPassed ?? 0) === 0) {
      return { state: 'failed', label: 'Failed /create-evidence-case', color: EMBRY.red, Icon: XCircle }
    }
    return { state: 'inconclusive', label: 'Inconclusive evidence case', color: EMBRY.amber, Icon: AlertCircle }
  }

  return { state: 'pending', label: 'Evidence case not yet run', color: EMBRY.dim, Icon: AlertCircle }
}

function deriveResponseDisposition(action: string | undefined, outcome: OutcomeState, hasAgentResponse: boolean): ResponseDisposition {
  const normalized = (action || '').trim().toLowerCase()
  if (normalized === 'answer' || normalized === 'deflect' || normalized === 'clarify') {
    return normalized
  }
  if (outcome === 'passed') return 'answer'
  if (outcome === 'failed') return 'deflect'
  if (outcome === 'inconclusive') return 'clarify'
  return hasAgentResponse ? 'answer' : 'clarify'
}

function deriveSteps({
  outcomeLabel,
  outcomeState,
  confidence,
  formalProofSuccess,
  hasFormalProof,
  chains,
  controlIds,
  glossary,
  responseLabel,
  hasAgentResponse,
}: {
  outcomeLabel: string
  outcomeState: OutcomeState
  confidence: number | null
  formalProofSuccess?: boolean
  hasFormalProof: boolean
  chains: CrosswalkChain[]
  controlIds: string[]
  glossary: GlossarySummaryEntry[]
  responseLabel: string
  hasAgentResponse: boolean
}): BuildingStep[] {
  const chainCount = chains.filter((c) => c.source || c.target || (c.hops && c.hops.length > 0)).length
  const verificationFailed = outcomeState === 'failed' || (hasFormalProof && formalProofSuccess === false)
  const verificationPending = outcomeState === 'pending'

  return [
    {
      id: 'claim',
      type: 'question',
      status: 'done',
      summary: 'Claim captured',
      detail: 'Question text is anchored and entity-highlighted.',
    },
    {
      id: 'grounding',
      type: 'evidence_assembly',
      status: controlIds.length > 0 || glossary.length > 0 ? 'done' : 'pending',
      summary: 'Entity grounding assembled',
      detail: `${controlIds.length} controls, ${glossary.length} glossary terms`,
    },
    {
      id: 'crosswalk',
      type: 'gate_evaluation',
      status: chainCount > 0 ? 'done' : 'pending',
      summary: chainCount > 0 ? 'Crosswalk chains evaluated' : 'No crosswalk chains',
      detail: chainCount > 0
        ? `${chainCount} framework linkage path${chainCount === 1 ? '' : 's'} found`
        : 'Informational QRA with no framework-to-framework edge requirements.',
    },
    {
      id: 'verification',
      type: 'gate_verification',
      status: verificationPending ? 'pending' : verificationFailed ? 'failed' : 'done',
      summary: outcomeLabel,
      detail: `${confidence !== null ? `${confidence}% confidence` : 'No confidence score'}${hasFormalProof ? ` • proof ${formalProofSuccess ? 'verified' : 'failed'}` : ' • proof unverified'}`,
    },
    {
      id: 'response',
      type: 'answer_synthesis',
      status: hasAgentResponse ? 'done' : outcomeState === 'failed' || outcomeState === 'inconclusive' ? 'done' : 'pending',
      summary: `${responseLabel} decision recorded`,
      detail: hasAgentResponse ? 'Agent response attached.' : 'No response text attached.',
    },
  ]
}

export function EvidenceCaseTrace({
  questionNode,
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
  error,
  onNavigateToControl,
  onRunValidation,
  validating = false,
}: EvidenceCaseTraceProps) {
  useRegisterAction('qras:evidence:source-control', { app: 'sparta-explorer', action: 'NAVIGATE_TO_CONTROL', label: 'Open Source Control', description: 'Open the selected source control in the Controls tab' })
  useRegisterAction('qras:evidence:toggle-details', { app: 'sparta-explorer', action: 'TOGGLE_EVIDENCE_DETAILS', label: 'Toggle Evidence Case Details', description: 'Expand or collapse the evidence case detail trace' })
  useRegisterAction('qras:evidence:toggle-reasoning', { app: 'sparta-explorer', action: 'TOGGLE_REASONING', label: 'Toggle Reasoning', description: 'Expand or collapse the reasoning detail' })
  useRegisterAction('qras:evidence:toggle-response', { app: 'sparta-explorer', action: 'TOGGLE_RESPONSE', label: 'Toggle Response Expansion', description: 'Expand or collapse the agent response preview' })
  useRegisterAction('qras:action:validate_evidence', { app: 'sparta-explorer', action: 'VALIDATE_EVIDENCE', label: 'Validate Evidence', description: 'Run /create-evidence-case validation pipeline' })

  const [hoveredSourceControl, setHoveredSourceControl] = useState<string | null>(null)
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [reasoningExpanded, setReasoningExpanded] = useState(false)
  const [responseExpanded, setResponseExpanded] = useState(false)

  const effectiveGatesPassed = gatesPassed ?? (liveGates.length > 0 ? liveGates.filter((gate) => gate.passed).length : undefined)
  const effectiveGatesTotal = gatesTotal ?? (liveGates.length > 0 ? liveGates.length : undefined)
  const outcome = deriveOutcome(evidenceVerdict, effectiveGatesPassed, effectiveGatesTotal)
  const cweCrosswalk = useMemo(() => deriveCweCrosswalk(chains), [chains])
  const disposition = deriveResponseDisposition(responseAction, outcome.state, Boolean(agentResponse?.trim()))
  const responseMeta = RESPONSE_COPY[disposition]
  const responseText = normalizeAgentResponse(agentResponse)
  const responsePreview = responseText.length > 420 && !responseExpanded ? `${responseText.slice(0, 420).trimEnd()}...` : responseText
  const evidenceSummary = [
    effectiveGatesTotal ? `${effectiveGatesPassed ?? 0}/${effectiveGatesTotal} gates` : null,
    controlIds.length > 0 ? `${controlIds.length} controls` : null,
    glossary.length > 0 ? `${glossary.length} glossary terms` : null,
    cweCrosswalk.found ? `CWE path ${cweCrosswalk.targetId}` : 'no CWE path',
    evidenceGrade ? `grade ${evidenceGrade}` : null,
  ].filter(Boolean).join(' • ')

  const steps = useMemo(
    () => deriveSteps({
      outcomeLabel: outcome.label,
      outcomeState: outcome.state,
      confidence,
      formalProofSuccess,
      hasFormalProof,
      chains,
      controlIds,
      glossary,
      responseLabel: responseMeta.label,
      hasAgentResponse: Boolean(responseText),
    }),
    [outcome.label, outcome.state, confidence, formalProofSuccess, hasFormalProof, chains, controlIds, glossary, responseMeta.label, responseText],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', backgroundColor: EMBRY.bg }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'monospace' }}>
        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: 12,
            backgroundColor: 'rgba(0,0,0,0.18)',
            border: `1px solid ${EMBRY.border}`,
            borderRadius: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', gap: 10, flex: 1, minWidth: 0 }}>
              <outcome.Icon size={18} color={outcome.color} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: EMBRY.dim, letterSpacing: 1, textTransform: 'uppercase' }}>Question</div>
                <div style={{ fontSize: 12, color: EMBRY.white, lineHeight: 1.55 }}>
                  {questionNode ?? <span style={{ color: EMBRY.dim }}>No claim text attached to this evidence case.</span>}
                </div>
              </div>
            </div>
            <div
              title={outcome.label}
              style={{
                flexShrink: 0,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '5px 8px',
                borderRadius: 999,
                backgroundColor: `${outcome.color}16`,
                border: `1px solid ${outcome.color}33`,
                color: outcome.color,
                fontSize: 9,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 0.8,
              }}
            >
              <outcome.Icon size={11} />
              {outcome.state === 'passed' ? 'Pass' : outcome.state === 'failed' ? 'Fail' : outcome.state === 'inconclusive' ? 'Partial' : 'Pending'}
            </div>
          </div>
        </section>

        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: 12,
            backgroundColor: 'rgba(0,0,0,0.18)',
            border: `1px solid ${EMBRY.border}`,
            borderRadius: 8,
          }}
        >
          <button
            data-qid="qras:evidence:toggle-details"
            data-qs-action="TOGGLE_EVIDENCE_DETAILS"
            title={detailsExpanded ? 'Collapse evidence case details' : 'Expand evidence case details'}
            onClick={() => setDetailsExpanded((value) => !value)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              width: '100%',
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              textAlign: 'left',
              color: 'inherit',
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 10, color: EMBRY.white, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Evidence Case</span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 7px',
                    borderRadius: 999,
                    backgroundColor: `${outcome.color}16`,
                    border: `1px solid ${outcome.color}33`,
                    color: outcome.color,
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                  }}
                >
                  {outcome.label}
                </span>
              </div>
              <div style={{ fontSize: 10, color: EMBRY.dim, lineHeight: 1.5 }}>
                {evidenceSummary || 'No evidence-case summary is available yet.'}
                {reviewStatus ? ` • workflow ${reviewStatus}` : ''}
              </div>
            </div>
            {detailsExpanded ? <ChevronDown size={14} color={EMBRY.dim} /> : <ChevronRight size={14} color={EMBRY.dim} />}
          </button>

          {detailsExpanded && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {validating && <BuildingEvidenceCase steps={steps} title="Evidence Case Build Trace" isStreaming />}

              <StepCard
                index={1}
                title="Grounding"
                subtitle={`${controlIds.length} source controls${glossary.length > 0 ? ` • ${glossary.length} glossary terms` : ''}`}
              >
                {controlIds.length > 0 && (
                  <div>
                    <div style={{ fontSize: 9, color: EMBRY.dim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>Source Controls</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                      {controlIds.map((id) => (
                        <button
                          key={id}
                          data-qid={`qras:evidence:source-control:${id}`}
                          data-qs-action="NAVIGATE_TO_CONTROL"
                          data-qs-params={JSON.stringify({ controlId: id })}
                          title={`Open control ${id}`}
                          onClick={() => onNavigateToControl(id)}
                          onMouseEnter={() => setHoveredSourceControl(id)}
                          onMouseLeave={() => setHoveredSourceControl((current) => (current === id ? null : current))}
                          style={{
                            fontSize: 10,
                            padding: '3px 7px',
                            backgroundColor: hoveredSourceControl === id ? `${EMBRY.accent}24` : `${EMBRY.accent}15`,
                            color: EMBRY.accent,
                            border: `1px solid ${hoveredSourceControl === id ? `${EMBRY.accent}55` : `${EMBRY.accent}30`}`,
                            borderRadius: 4,
                            fontFamily: 'monospace',
                            cursor: 'pointer',
                            position: 'relative',
                            zIndex: hoveredSourceControl === id ? 20 : 1,
                            boxShadow: hoveredSourceControl === id ? `0 8px 22px ${EMBRY.accent}22` : 'none',
                            transform: hoveredSourceControl === id ? 'translateY(-1px)' : 'translateY(0)',
                            transition: 'transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease, background-color 120ms ease',
                          }}
                        >
                          {id}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {glossary.length > 0 && (
                  <div>
                    <div style={{ fontSize: 9, color: EMBRY.dim, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 }}>{glossaryLabel}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                      {glossary.slice(0, 6).map((g) => {
                        const color = FW_COLORS[g.framework?.toUpperCase()] || EMBRY.dim
                        return (
                          <div key={g.id} style={{ padding: '6px 8px', borderRadius: 4, background: 'rgba(0,0,0,0.2)', border: `1px solid ${EMBRY.border}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color, fontFamily: 'monospace' }}>{g.id}</span>
                              <span style={{ fontSize: 8, color: EMBRY.dim, opacity: 0.7 }}>{g.framework}</span>
                            </div>
                            <div style={{ fontSize: 10, color: EMBRY.white, marginTop: 2 }}>{g.name}</div>
                            {g.description && <div style={{ fontSize: 9, color: EMBRY.dim, marginTop: 3, lineHeight: 1.4 }}>{g.description.length > 100 ? `${g.description.slice(0, 100)}...` : g.description}</div>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
              </StepCard>

              <StepCard index={2} title="Verification" subtitle="Evidence verdict, confidence, and proof state">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 16 }}>
                  <div>
                    <div style={{ fontSize: 9, color: EMBRY.dim, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Evidence Verdict</div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: outcome.color, fontSize: 11, fontWeight: 700 }}>
                      <outcome.Icon size={12} />
                      {outcome.label}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: EMBRY.dim, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Confidence</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: confidence !== null && confidence >= 80 ? EMBRY.green : EMBRY.amber }}>{confidence !== null ? `${confidence}%` : '—'}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: EMBRY.dim, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 1 }}>Formal Proof</div>
                    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: hasFormalProof ? (formalProofSuccess ? EMBRY.green : EMBRY.red) : EMBRY.dim }}>
                      {hasFormalProof ? (formalProofSuccess ? <CheckCircle2 size={12} /> : <XCircle size={12} />) : <AlertCircle size={12} />}
                      {hasFormalProof ? (formalProofSuccess ? 'VERIFIED' : 'FAILED') : 'UNVERIFIED'}
                    </div>
                  </div>
                </div>

                {effectiveGatesTotal && (
                  <div style={{ fontSize: 10, color: EMBRY.dim }}>
                    Gate summary: {effectiveGatesPassed ?? 0}/{effectiveGatesTotal} passed
                    {cweCrosswalk.found ? ` • CWE path found${cweCrosswalk.targetId ? ` (${cweCrosswalk.targetId})` : ''}` : ' • no CWE path found'}
                    {evidenceGrade ? ` • grade ${evidenceGrade}` : ''}
                    {reviewStatus ? ` • workflow ${reviewStatus}` : ''}
                  </div>
                )}

                {liveGates.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 9, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 1 }}>Gate Trace</div>
                    {liveGates.map((gate, idx) => {
                      const color = gate.passed ? EMBRY.green : EMBRY.red
                      const Icon = gate.passed ? CheckCircle2 : XCircle
                      const gateLabel = formatGateLabel(gate.gate)
                      return (
                        <div key={`${gateLabel}-${idx}`} style={{ display: 'flex', gap: 6 }}>
                          <Icon size={12} color={color} style={{ flexShrink: 0, marginTop: 2 }} />
                          <div>
                            <div style={{ fontSize: 10, color: EMBRY.white, fontWeight: 700 }}>{gateLabel.toUpperCase()}</div>
                            <div style={{ fontSize: 9, color: EMBRY.dim }}>{gate.detail}</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </StepCard>

              {reasoning && (
                <StepCard index={3} title="Supporting Reasoning" subtitle={`${reasoning.split('\n').length} lines available`}>
                  <button
                    data-qid="qras:evidence:toggle-reasoning"
                    data-qs-action="TOGGLE_REASONING"
                    title="Toggle Evidence Context reasoning"
                    onClick={() => setReasoningExpanded((value) => !value)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      cursor: 'pointer',
                      color: EMBRY.dim,
                    }}
                  >
                    {reasoningExpanded ? <ChevronDown size={12} color={EMBRY.dim} /> : <ChevronRight size={12} color={EMBRY.dim} />}
                    <span style={{ fontSize: 10, color: EMBRY.dim }}>{reasoningExpanded ? 'Hide reasoning' : 'Show reasoning'}</span>
                  </button>
                  {reasoningExpanded && (
                    <div style={{ ...body, fontSize: 11, color: EMBRY.dim, lineHeight: 1.6, backgroundColor: 'rgba(0,0,0,0.2)', padding: 8, borderRadius: 5, border: `1px solid ${EMBRY.border}` }}>
                      <MarkdownRenderer content={reasoning} />
                    </div>
                  )}
                </StepCard>
              )}
            </div>
          )}
        </section>

        <section
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            padding: 12,
            backgroundColor: 'rgba(0,0,0,0.18)',
            border: `1px solid ${EMBRY.border}`,
            borderRadius: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={14} color={responseMeta.color} />
              <div style={{ fontSize: 10, color: EMBRY.white, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase' }}>Agent Response</div>
            </div>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '3px 7px',
                borderRadius: 999,
                backgroundColor: `${responseMeta.color}16`,
                border: `1px solid ${responseMeta.color}33`,
                color: responseMeta.color,
                fontSize: 9,
                fontWeight: 700,
                textTransform: 'uppercase',
              }}
            >
              {responseMeta.label}
            </span>
          </div>

          <div style={{ ...body, fontSize: 11, color: responseText ? EMBRY.white : EMBRY.dim, lineHeight: 1.6 }}>
            {responseText ? <MarkdownRenderer content={responsePreview} /> : responseMeta.empty}
          </div>

          {responseText.length > 420 && (
            <button
              data-qid="qras:evidence:toggle-response"
              data-qs-action="TOGGLE_RESPONSE"
              title={responseExpanded ? 'Collapse full agent response' : 'Expand full agent response'}
              onClick={() => setResponseExpanded((value) => !value)}
              style={{
                alignSelf: 'flex-start',
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                color: EMBRY.dim,
                fontSize: 10,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {responseExpanded ? <ChevronDown size={12} color={EMBRY.dim} /> : <ChevronRight size={12} color={EMBRY.dim} />}
              {responseExpanded ? 'Show less' : 'Show full response'}
            </button>
          )}
        </section>

        {error && (
          <div style={{ ...body, fontSize: 10, color: EMBRY.red, marginTop: 4 }}>
            <AlertCircle size={11} style={{ display: 'inline', marginRight: 4 }} />
            {error}
          </div>
        )}
      </div>

      {onRunValidation && (
        <div style={{ padding: '10px 16px', borderTop: `1px solid ${EMBRY.border}`, flexShrink: 0, backgroundColor: 'rgba(0,0,0,0.2)' }}>
          <button
            data-qid="qras:action:validate_evidence"
            data-qs-action="VALIDATE_EVIDENCE"
            title="Run /create-evidence-case validation pipeline"
            onClick={onRunValidation}
            disabled={validating}
            style={{
              width: '100%',
              padding: '8px 0',
              borderRadius: 5,
              cursor: validating ? 'wait' : 'pointer',
              backgroundColor: validating ? EMBRY.bgDeep : `${EMBRY.accent}15`,
              border: `1px solid ${EMBRY.accent}33`,
              color: EMBRY.accent,
              fontSize: 10,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              textTransform: 'uppercase',
              letterSpacing: 1,
            }}
          >
            {validating ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> Validating...</> : <><ShieldCheck size={12} /> Run /create-evidence-case</>}
          </button>
        </div>
      )}
    </div>
  )
}

export default EvidenceCaseTrace

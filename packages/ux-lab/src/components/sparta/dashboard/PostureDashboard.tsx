import { useState, useEffect, useCallback, useMemo } from 'react'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import { usePageDistanceMode } from '../explorer/pageDistance/PageDistanceMode'
import { usePostureData } from '../../../hooks/usePostureData'
import { useF36PostureReadModel } from '../../../hooks/useF36ExplorerReadModels'
import type { Family, RiskControl, BrokenTrace, ClaimReview } from '../../../hooks/usePostureData'
import { EMBRY, card, label, heading } from '../common/EmbryStyle'
import { Posture10FtAmbient } from './Posture10FtAmbient'

type Props = {
  onNavigateToControl?: (id: string) => void
  onAnalyzeProofChain?: (missingCount: number) => void
}

type Tab = 'Posture' | 'Traceability' | 'Assurance Case Health'
type PostureMode = '10ft' | '5ft' | 'lean-in' | (string & {})

const POSTURE_BLOCKER_STORAGE = 'sparta.posture.selectedBlockerId'

type BlockerQueueRow = {
  rank: number
  id: string
  outcome: string
  reason: string
  entityType: 'finding' | 'control-family'
  mappedControls?: string[]
}

// ── Shared sub-components ──

function KpiCard({ title, value, delta, deltaType, qid }: { title: string; value: string | number; delta?: string; deltaType?: 'up' | 'warn' | 'down'; qid: string }) {
  const deltaColor = deltaType === 'up' ? EMBRY.green : deltaType === 'down' ? EMBRY.red : EMBRY.amber
  return (
    <div data-qid={qid} style={{ ...card, padding: 16 }}>
      <div style={{ ...label, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 10 }}>{title}</div>
      <div style={{ fontSize: 32, fontWeight: 800, lineHeight: 1, marginBottom: 8, color: EMBRY.white }}>{value}</div>
      {delta && <div style={{ fontSize: 12, color: deltaColor }}>{delta}</div>}
    </div>
  )
}

function BarRow({ name, pct, count, variant }: { name: string; pct: number; count?: number | string; variant?: 'green' | 'amber' | 'red' | 'cyan' }) {
  const colors: Record<string, string> = { green: EMBRY.green, amber: EMBRY.amber, red: EMBRY.red, cyan: '#9be7cf' }
  const fill = colors[variant ?? 'green'] ?? EMBRY.green
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr 48px', alignItems: 'center', gap: 10, fontSize: 13, color: EMBRY.white }}>
      <div>{name}</div>
      <div style={{ height: 14, background: 'rgba(255,255,255,0.04)', borderRadius: 999, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ height: '100%', width: `${Math.min(100, pct)}%`, borderRadius: 999, background: `linear-gradient(90deg, ${fill}44, ${fill})` }} />
      </div>
      <div style={{ textAlign: 'right' }}>{count ?? `${pct}%`}</div>
    </div>
  )
}

function PanelSection({ title, desc, children, qid }: { title: string; desc?: string; children: React.ReactNode; qid: string }) {
  return (
    <section data-qid={qid} style={{ ...card, padding: 16 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: EMBRY.white, marginBottom: 6 }}>{title}</div>
        {desc && <div style={{ color: EMBRY.dim, fontSize: 13, lineHeight: 1.4 }}>{desc}</div>}
      </div>
      {children}
    </section>
  )
}

// ── Primary Posture: Brandon signoff decision layer ──

function PostureTab({ postureMode, onModeChange, selectedBlockerId, onSelectBlocker, postureScore, complianceScore, criticalFindings, openFindings, evidenceFreshness, totalCases, families, riskControls, traceabilityScore, assuranceScore, totalRelationships, onNavigateToControl, onAnalyzeProofChain }: {
  postureMode: PostureMode
  onModeChange: (mode: PostureMode) => void
  selectedBlockerId: string | null
  onSelectBlocker: (id: string) => void
  postureScore: number; complianceScore: number; criticalFindings: number; openFindings: number
  evidenceFreshness: number; totalCases: number; families: Family[]; riskControls: RiskControl[]
  traceabilityScore: number; assuranceScore: number; totalRelationships: number
  onNavigateToControl?: (id: string) => void
  onAnalyzeProofChain?: (missingCount: number) => void
}) {
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [proofDrawerOpen, setProofDrawerOpen] = useState(postureMode === 'lean-in')

  useEffect(() => {
    setProofDrawerOpen(postureMode === 'lean-in')
  }, [postureMode])
  const missingCases = Math.max(0, totalCases - Math.round(totalCases * (postureScore / 100)))
  const firstRisk = riskControls[0]
  const firstNoCaseFamily = families.find((f) => f.noEvidence > 0)
  const unassessedControls = families.reduce((sum, f) => sum + f.noEvidence, 0)
  const firstRiskVerdict = String(firstRisk?.verdict || 'not_satisfied')
  const serverTimestamp = 'NO SERVER TIMESTAMP'
  const hasServerTimestamp = serverTimestamp !== 'NO SERVER TIMESTAMP'
  const monitorState = evidenceFreshness < 80 ? 'MONITOR DEGRADED' : 'MONITOR OK'
  const evidenceFreshnessLabel = hasServerTimestamp ? `${evidenceFreshness}%` : 'UNVERIFIED / NO SERVER TIMESTAMP'
  const evidenceFreshnessColor = hasServerTimestamp ? EMBRY.green : EMBRY.amber
  const verdict = totalCases === 0
    ? 'INSUFFICIENT EVIDENCE'
    : evidenceFreshness < 80
      ? 'INSUFFICIENT EVIDENCE'
      : criticalFindings > 0
        ? 'NOT READY'
        : openFindings > 0 || unassessedControls > 0
          ? 'DEGRADED'
          : 'READY'
  const readinessLabel = verdict
  const verdictTone = verdict === 'READY'
    ? { border: 'rgba(0, 255, 153, 0.36)', bg: 'rgba(0, 255, 153, 0.08)', fg: EMBRY.green }
    : verdict === 'NOT READY'
      ? { border: 'rgba(255, 107, 107, 0.55)', bg: 'rgba(255, 68, 68, 0.09)', fg: '#ff6b6b' }
      : { border: 'rgba(255, 170, 0, 0.42)', bg: 'rgba(255, 170, 0, 0.09)', fg: EMBRY.amber }
  const verdictFontSize = postureMode === '10ft' ? 56 : postureMode === '5ft' ? 22 : 32
  const criticalText = verdict === 'NOT READY' ? '#ff4c4c' : verdictTone.fg
  const primaryActionColor = '#007bff'
  const requestEvidenceReview = (count: number, labelText: string) => {
    setActionFeedback(`${labelText} requested for ${blockerId}.`)
    onAnalyzeProofChain?.(count)
  }
  const requestResolutionAction = (labelText: string) => {
    setActionFeedback(`${labelText} requested for ${blockerId}.`)
  }
  const defaultBlockerId = firstRisk?.finding_id ?? firstRisk?.control_id ?? firstNoCaseFamily?.family ?? 'Evidence case coverage'
  const blockerId = selectedBlockerId ?? defaultBlockerId
  const blockerTitle = firstRisk?.name || firstRisk?.question || (firstNoCaseFamily ? `${firstNoCaseFamily.family} family has ${firstNoCaseFamily.noEvidence} controls with no case` : 'No current blocker selected')
  const blockerOutcome = firstRisk ? firstRiskVerdict.replace(/_/g, ' ') : firstNoCaseFamily ? 'no case' : 'satisfied'
  const blockerReason = firstRisk
    ? `${blockerId} is an unresolved ${firstRiskVerdict.replace(/_/g, ' ')} F-36 evidence finding mapped to ${firstRisk.mapped_controls?.join(', ') || 'the selected control set'}, so Brandon cannot treat the selected scope as signoff-ready.`
    : firstNoCaseFamily
      ? `${firstNoCaseFamily.family} includes controls with no evidence case, so Brandon cannot assert scope readiness.`
      : 'No not-satisfied, inconclusive, or no-case blocker is exposed by the current posture response.'
  const blockerQueue: BlockerQueueRow[] = [
    ...riskControls.map((risk, index) => ({
      rank: index + 1,
      id: risk.finding_id ?? risk.control_id,
      outcome: String(risk.verdict || 'not_satisfied').replace(/_/g, ' '),
      reason: `${risk.question || risk.name || 'Evidence case requires review.'} Mapped controls: ${risk.mapped_controls?.join(', ') || 'not recorded'}.`,
      entityType: 'finding' as const,
      mappedControls: risk.mapped_controls ?? [],
    })),
    ...families
      .filter((family) => family.noEvidence > 0)
      .slice(0, Math.max(0, 5 - riskControls.length))
      .map((family, index) => ({
        rank: riskControls.length + index + 1,
        id: family.family,
        outcome: 'no case',
        reason: `${family.noEvidence}/${family.total} controls have no evidence case.`,
        entityType: 'control-family' as const,
      })),
  ].slice(0, 5)
  useEffect(() => {
    if (postureMode !== 'lean-in') return
    if (!selectedBlockerId && blockerQueue[0]?.id) onSelectBlocker(String(blockerQueue[0].id))
  }, [postureMode, selectedBlockerId, blockerQueue, onSelectBlocker])
  const severityCounts = useMemo(() => ({
    critical: riskControls.filter((r) => String(r.verdict || '').includes('not')).length + (criticalFindings > 0 ? criticalFindings : 0),
    high: riskControls.filter((r) => String(r.verdict || '').includes('inconclusive')).length,
    medium: families.filter((f) => f.noEvidence > 0).length,
    low: Math.max(0, openFindings - criticalFindings),
  }), [riskControls, criticalFindings, families, openFindings])
  const dispositionCounts = useMemo(() => {
    const satisfied = riskControls.filter((r) => String(r.verdict) === 'satisfied').length
    const inconclusive = riskControls.filter((r) => String(r.verdict) === 'inconclusive').length
    const notSatisfied = riskControls.filter((r) => String(r.verdict) === 'not_satisfied').length
    const noCase = families.reduce((sum, f) => sum + f.noEvidence, 0)
    const unknown = Math.max(0, totalCases - satisfied - inconclusive - notSatisfied - noCase)
    return { satisfied, inconclusive, not_satisfied: notSatisfied, no_case: noCase, unknown }
  }, [riskControls, families, totalCases])
  const selectedBlockerRow = blockerQueue.find((row) => String(row.id) === String(blockerId)) ?? blockerQueue[0]
  const leanInSeverityLabel = selectedBlockerRow?.outcome.includes('not') ? 'CRITICAL' : selectedBlockerRow?.outcome.includes('inconclusive') ? 'HIGH' : selectedBlockerRow?.outcome.includes('no') ? 'HIGH' : 'MEDIUM'
  const leanInDisposition = selectedBlockerRow?.outcome.includes('not') ? 'NOT SATISFIED' : selectedBlockerRow?.outcome.includes('inconclusive') ? 'INCONCLUSIVE' : selectedBlockerRow?.outcome.includes('no') ? 'NO CASE' : 'UNKNOWN'
  const leanInProofState = hasServerTimestamp ? 'INCOMPLETE' : 'MISSING'
  const leanInEvidenceCaseId = selectedBlockerRow?.entityType === 'finding' ? `EC-${String(blockerId).replace(/[^A-Za-z0-9-]/g, '-')}` : 'MISSING'
  const leanInControlRefs = selectedBlockerRow?.mappedControls?.length ? selectedBlockerRow.mappedControls.join(' · ') : 'Coverage intake · no mapped controls'
  const leanInWhyBlocked = selectedBlockerRow?.reason || blockerReason
  const leanInViolationTotal = Math.max(criticalFindings + openFindings, blockerQueue.length)
  const enterLeanIn = useCallback(() => {
    onModeChange('lean-in')
    setProofDrawerOpen(true)
  }, [onModeChange])
  const blockerContext = firstRisk
    ? `${blockerTitle}. This blocker stays first until its cited evidence case is reviewed, its source support is repaired, and the case is rerun to a satisfied verdict.`
    : firstNoCaseFamily
      ? `${firstNoCaseFamily.family} is a Coverage intake blocker: create evidence cases before Posture can make an assessor verdict.`
      : 'No selected blocker has additional context.'

  if (postureMode === '10ft') {
    return (
      <Posture10FtAmbient
        criticalFindings={criticalFindings}
        openFindings={openFindings}
        evidenceFreshness={evidenceFreshness}
        totalCases={totalCases}
        families={families}
        riskControls={riskControls}
        onOpenBlocker={(id) => {
          onSelectBlocker(id)
          enterLeanIn()
        }}
      />
    )
  }

  return (
    <div
      data-qid="posture-mode-root"
      data-posture-mode={postureMode}
      style={{ display: 'grid', gap: 16, minWidth: 0 }}
    >
      <div data-qid="posture-diagnostics" style={{ display: 'grid', gap: 16, minWidth: 0 }}>
      <style>{`
        [data-qs-action="POSTURE_RESOLUTION_STEP"],
        [data-qs-action="POSTURE_REVIEW_EVIDENCE_CASE"],
        [data-qs-action="POSTURE_REVIEW_EVIDENCE_CASE_FROM_VERDICT"],
        [data-qs-action="POSTURE_REVIEW_ALL_VIOLATIONS"],
        [data-qs-action="POSTURE_ASSIGN_REPAIR_OWNER"],
        [data-qs-action="POSTURE_OPEN_SOURCE_SECTION"],
        [data-qs-action="POSTURE_OPEN_NEXT_BLOCKER"],
        [data-qs-action="POSTURE_TRIAGE_UNASSESSED_IN_COVERAGE"] {
          transition: background-color 140ms ease, border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
        }
        [data-qid="posture:resolution-step:1"]:hover,
        [data-qid="posture:resolution-step:1"]:focus-visible,
        [data-qid="posture-review-blockers-primary"]:hover,
        [data-qid="posture-review-blockers-primary"]:focus-visible,
        [data-qid="posture:action:review-evidence-case-verdict"]:hover,
        [data-qid="posture:action:review-evidence-case-verdict"]:focus-visible,
        [data-qid="posture:action:review-evidence-case-primary"]:hover,
        [data-qid="posture:action:review-evidence-case-primary"]:focus-visible {
          background: #0b84ff !important;
          border-color: #9ac8ff !important;
          color: #ffffff !important;
          box-shadow: 0 0 0 3px rgba(74, 158, 255, 0.42), 0 12px 28px rgba(0, 123, 255, 0.22) !important;
          transform: translateY(-1px);
          outline: 2px solid #4a9eff;
          outline-offset: 2px;
        }
        [data-qs-action="POSTURE_OPEN_NEXT_BLOCKER"]:hover,
        [data-qs-action="POSTURE_OPEN_NEXT_BLOCKER"]:focus-visible,
        [data-qs-action="POSTURE_REVIEW_ALL_VIOLATIONS"]:hover,
        [data-qs-action="POSTURE_REVIEW_ALL_VIOLATIONS"]:focus-visible,
        [data-qs-action="POSTURE_TRIAGE_UNASSESSED_IN_COVERAGE"]:hover,
        [data-qs-action="POSTURE_TRIAGE_UNASSESSED_IN_COVERAGE"]:focus-visible {
          border-color: rgba(0, 209, 255, 0.7) !important;
          background: rgba(0, 209, 255, 0.14) !important;
          box-shadow: 0 0 0 2px rgba(0, 209, 255, 0.18) !important;
          outline: 2px solid #4a9eff;
          outline-offset: 2px;
        }
        [data-qs-action="POSTURE_ASSIGN_REPAIR_OWNER"]:hover,
        [data-qs-action="POSTURE_ASSIGN_REPAIR_OWNER"]:focus-visible,
        [data-qs-action="POSTURE_OPEN_SOURCE_SECTION"]:hover,
        [data-qs-action="POSTURE_OPEN_SOURCE_SECTION"]:focus-visible {
          border-color: rgba(255, 255, 255, 0.35) !important;
          background: rgba(255, 255, 255, 0.07) !important;
          outline: 2px solid #4a9eff;
          outline-offset: 2px;
        }
      `}</style>

      {postureMode !== 'lean-in' && (
      <section data-qid="posture-readiness-summary" aria-label="Posture readiness summary" style={{ display: 'grid', gap: postureMode === '5ft' ? 8 : postureMode === '10ft' ? 10 : 14 }}>
        <section data-qid="posture:scope" aria-label="Selected Posture assessment scope" style={{ display: 'grid', gap: postureMode === '5ft' ? 0 : 8, borderBottom: postureMode === '5ft' ? 'none' : `1px solid ${EMBRY.border}`, paddingBottom: postureMode === '5ft' ? 0 : 10 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: postureMode === '5ft' ? 6 : 12, alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div>
              <div style={{ ...label, color: '#00d1ff', marginBottom: 4, display: postureMode === '5ft' ? 'none' : 'block' }}>SELECTED SCOPE</div>
              <h1 style={{ ...heading, fontSize: postureMode === '5ft' ? 12 : postureMode === '10ft' ? 18 : 22, lineHeight: 1.18, margin: 0 }}>
                {postureMode === '10ft' || postureMode === '5ft' ? 'F-36 / SPARTA / Gate F' : 'SPARTA / F-36 Mission Systems / Framework Control Set'}
              </h1>
            </div>
            <div style={{ color: EMBRY.dim, fontSize: postureMode === '10ft' ? 12 : 13, display: postureMode === '10ft' || postureMode === '5ft' ? 'none' : 'block' }}>Profile: SPARTA · Corpus: F-36 Mission Systems · Gate: F · Assessor: Brandon Bailey · {totalCases} evidence cases · {serverTimestamp}</div>
          </div>
        </section>

        <div data-qid="posture-assessor-status" aria-label="Assessor readiness metrics" style={{ display: 'none', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
          <div style={{ borderTop: `2px solid ${EMBRY.border}`, paddingTop: 8 }}><div style={label}>READINESS</div><strong style={{ color: verdictTone.fg }}>{readinessLabel}</strong></div>
          <div title="Composite posture score from evaluated evidence cases." style={{ borderTop: `2px solid ${EMBRY.border}`, paddingTop: 8 }}><div style={label}>POSTURE SCORE</div><strong>{postureScore}</strong></div>
          <div title="Traceability score from proof-chain relationships." style={{ borderTop: `2px solid ${EMBRY.border}`, paddingTop: 8 }}><div style={label}>TRACEABILITY</div><strong>{traceabilityScore}</strong></div>
          <div title="Assurance case health score." style={{ borderTop: `2px solid ${EMBRY.border}`, paddingTop: 8 }}><div style={label}>ASSURANCE</div><strong>{assuranceScore}</strong></div>
          <div title="Not-satisfied evidence cases blocking signoff." style={{ borderTop: `2px solid ${criticalText}`, paddingTop: 8 }}><div style={label}>CRITICAL BLOCKERS</div><strong style={{ color: criticalText }}>{criticalFindings}</strong></div>
          <div title="Not-satisfied plus inconclusive cases." style={{ borderTop: `2px solid ${EMBRY.amber}`, paddingTop: 8 }}><div style={label}>OPEN FINDINGS</div><strong style={{ color: EMBRY.amber }}>{openFindings}</strong></div>
          <div style={{ borderTop: `2px solid ${evidenceFreshnessColor}`, paddingTop: 8 }}><div style={label}>EVIDENCE FRESHNESS</div><strong style={{ color: evidenceFreshnessColor }}>{evidenceFreshnessLabel}</strong></div>
          <div style={{ borderTop: `2px solid #00d1ff`, paddingTop: 8 }}><div style={label}>PROOF-CHAIN RELS</div><strong>{totalRelationships.toLocaleString()}</strong></div>
        </div>

        <div data-qid="posture-readiness-verdict">
          <section data-qid="posture-signoff-verdict" aria-hidden="true" style={{ display: 'none' }} /><section data-qid="posture:signoff-verdict" role="region" aria-label={`Current signoff verdict: ${verdict}`} style={{ border: `1px solid ${verdictTone.border}`, background: verdictTone.bg, padding: postureMode === '5ft' ? 10 : 16, display: 'grid', gap: postureMode === '5ft' ? 4 : 8 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ ...label, color: verdictTone.fg, marginBottom: 6, display: postureMode === '5ft' ? 'none' : 'block' }}>CURRENT VERDICT</div>
                <div style={{ fontSize: verdictFontSize, fontWeight: 900, lineHeight: 1.05, color: EMBRY.white }}>{verdict}</div>
              </div>
              {criticalFindings > 0 && postureMode !== '5ft' && (
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 8px', border: `1px solid ${criticalText}`, color: criticalText, background: 'rgba(255, 76, 76, 0.13)', fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>
                  <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>!</span> {criticalFindings} blocking
                </div>
              )}
            </div>
            <div data-qid="posture:verdict:status-summary" style={{ color: EMBRY.white, fontSize: postureMode === '10ft' ? 13 : postureMode === '5ft' ? 12 : 14, fontWeight: 700, display: postureMode === '5ft' ? 'none' : 'block' }}>
              {postureMode === '10ft'
                ? (criticalFindings > 0
                  ? <>{blockerQueue.length} signoff blockers · Top blocker: <span style={{ color: criticalText }}>{blockerId}</span></>
                  : <>No signoff blockers exposed for this scope.</>)
                : criticalFindings > 0
                  ? <>Status: {criticalFindings}/{totalCases} blocking violations remain; first repair target is <span style={{ color: criticalText }}>{blockerId}</span>.</>
                  : <>Status: no blocking violations exposed; assessor can review supporting diagnostics below before signoff.</>}
            </div>
          </section>
        </div>

        {onAnalyzeProofChain && postureMode !== 'lean-in' && postureMode !== '5ft' && (
          <button
            type="button"
            data-qid="posture-review-blockers-primary"
            data-qs-action="POSTURE_REVIEW_EVIDENCE_CASE_FROM_VERDICT"
            aria-label={`Primary action: review blockers starting with ${blockerId}`}
            aria-keyshortcuts="Enter Space"
            title={`Review blockers starting with ${blockerId}`}
            onClick={() => { requestEvidenceReview(missingCases, 'Primary blocker review'); enterLeanIn() }}
            style={{
              minHeight: 52,
              border: `1px solid ${primaryActionColor}`,
              background: primaryActionColor,
              color: EMBRY.white,
              padding: '12px 16px',
              fontWeight: 950,
              cursor: 'pointer',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
              boxShadow: '0 0 0 3px rgba(74, 158, 255, 0.24), 0 10px 24px rgba(0, 123, 255, 0.14)',
            }}
          >
            <span>{postureMode === '10ft' ? 'Review blockers' : `Review blockers — start with ${blockerId}`}</span>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>primary</span>
          </button>
        )}
        <div data-qid="posture:action-feedback" role="status" aria-live="assertive" aria-atomic="true" style={{ minHeight: postureMode === '5ft' ? 0 : 18, color: actionFeedback ? EMBRY.green : EMBRY.dim, fontSize: 12, fontWeight: 800, display: postureMode === '5ft' && !actionFeedback ? 'none' : 'block' }}>
          {actionFeedback ?? ''}
        </div>
      </section>
      )}

      {false && postureMode === '5ft' && (
        <section data-qid="posture-severity-strip" aria-label="Blocker severity strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
          {([
            ['Critical', severityCounts.critical, EMBRY.red],
            ['High', severityCounts.high, EMBRY.amber],
            ['Medium', severityCounts.medium, '#60a5fa'],
            ['Low', severityCounts.low, EMBRY.dim],
          ] as const).map(([labelText, count, color]) => (
            <div key={labelText} style={{ ...card, padding: 12, borderTop: `3px solid ${color}` }}>
              <div style={label}>{labelText}</div>
              <div style={{ fontSize: 28, fontWeight: 900, color }}>{count}</div>
            </div>
          ))}
        </section>
      )}

      {false && postureMode === '5ft' && (
        <section data-qid="posture-disposition-ratio" aria-label="Disposition ratio" style={{ ...card, padding: 12, display: 'grid', gap: 8 }}>
          <div style={label}>DISPOSITION RATIO</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 13 }}>
            <span>Satisfied: <strong>{dispositionCounts.satisfied}</strong></span>
            <span>Inconclusive: <strong>{dispositionCounts.inconclusive}</strong></span>
            <span>Not satisfied: <strong style={{ color: EMBRY.red }}>{dispositionCounts.not_satisfied}</strong></span>
            <span>No case: <strong style={{ color: '#60a5fa' }}>{dispositionCounts.no_case}</strong></span>
            <span>Unknown: <strong style={{ color: EMBRY.amber }}>{dispositionCounts.unknown}</strong></span>
          </div>
        </section>
      )}

      {postureMode !== 'lean-in' && (
      <section data-qid="posture-critical-blockers" aria-label="Critical signoff blockers" style={{ display: 'grid', gap: postureMode === '5ft' ? 6 : 12 }}>
        {postureMode === '10ft' ? (
          <div
            data-qid="posture-evidence-health"
            role="status"
            aria-label="Evidence freshness and monitor state"
            style={{ border: `1px solid ${EMBRY.amber}`, background: 'rgba(255,170,0,0.08)', padding: '10px 12px', fontSize: 14, fontWeight: 800, color: EMBRY.amber, lineHeight: 1.4 }}
          >
            {serverTimestamp} · {evidenceFreshnessLabel} · {monitorState}
          </div>
        ) : (
        <div data-qid="posture-evidence-health" style={{ display: postureMode === '5ft' ? 'none' : 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, border: `1px solid ${EMBRY.border}`, padding: 12, background: 'rgba(255,255,255,0.02)' }}>
          <div><div style={label}>SERVER TIMESTAMP</div><strong style={{ color: EMBRY.amber }}>{serverTimestamp}</strong></div>
          <div><div style={label}>MONITOR</div><strong style={{ color: monitorState.includes('DEGRADED') ? EMBRY.amber : EMBRY.green }}>{monitorState}</strong></div>
          <div><div style={label}>EVIDENCE FRESHNESS</div><strong style={{ color: evidenceFreshnessColor }}>{evidenceFreshnessLabel}</strong></div>
          <div><div style={label}>REMAINING VIOLATIONS</div><strong style={{ color: criticalText }}>{criticalFindings}/{totalCases}</strong></div>
          <div><div style={label}>OPEN FINDINGS</div><strong style={{ color: EMBRY.amber }}>{openFindings}/{totalCases}</strong></div>
          <div><div style={label}>UNASSESSED CONTROLS</div><strong>{unassessedControls.toLocaleString()}</strong></div>
        </div>
        )}

        {postureMode === '10ft' && blockerQueue[0] && (
          <div data-qid="posture-top-blocker-only" style={{ ...card, padding: 12, borderLeft: `4px solid ${criticalText}` }}>
            <div style={{ ...label, marginBottom: 4 }}>TOP BLOCKER SUMMARY</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: EMBRY.white }}>{blockerQueue[0].id}</div>
            <div style={{ color: EMBRY.dim, marginTop: 6, fontSize: 12, lineHeight: 1.35 }}>
              {blockerQueue.length} signoff blockers in scope · Next: Review blockers
            </div>
          </div>
        )}

        {postureMode !== '10ft' && (
        <div data-qid="posture-blocker-list" style={{ display: 'block' }}>
          <section data-qid="posture:blocker-queue">
            <div style={{ ...label, color: '#00d1ff', marginBottom: postureMode === '5ft' ? 4 : 12, fontSize: postureMode === '5ft' ? 10 : undefined }}>TOP SIGNOFF BLOCKERS</div>
            {blockerQueue.length === 0
              ? <div style={{ color: EMBRY.dim }}>No current signoff blockers are exposed by /api/posture/v2.</div>
              : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: postureMode === '5ft' ? 11 : 13, tableLayout: postureMode === '5ft' ? 'fixed' : 'auto' }}>
                  <thead><tr>
                    <th style={{ ...label, textAlign: 'left', padding: '8px', borderBottom: `1px solid ${EMBRY.border}` }}>Rank</th>
                    <th style={{ ...label, textAlign: 'left', padding: '8px', borderBottom: `1px solid ${EMBRY.border}` }}>Blocker</th>
                    <th style={{ ...label, textAlign: 'left', padding: postureMode === '5ft' ? '6px 4px' : '8px', borderBottom: `1px solid ${EMBRY.border}` }}>Severity</th>
                    {postureMode === '5ft' && <th style={{ ...label, textAlign: 'left', padding: '6px 4px', borderBottom: `1px solid ${EMBRY.border}` }}>Disposition</th>}
                    {postureMode !== '5ft' && <th style={{ ...label, textAlign: 'left', padding: '8px', borderBottom: `1px solid ${EMBRY.border}` }}>Control / source</th>}
                    {postureMode !== '5ft' && <th style={{ ...label, textAlign: 'left', padding: '8px', borderBottom: `1px solid ${EMBRY.border}` }}>Why it blocks signoff</th>}
                    {(postureMode === '5ft' || postureMode === 'lean-in') && <th style={{ ...label, textAlign: 'left', padding: '8px', borderBottom: `1px solid ${EMBRY.border}` }}>Owner</th>}
                    {(postureMode === '5ft' || postureMode === 'lean-in') && <th style={{ ...label, textAlign: 'left', padding: '8px', borderBottom: `1px solid ${EMBRY.border}` }}>Due / SLA</th>}
                    {(postureMode === '5ft' || postureMode === 'lean-in') && <th style={{ ...label, textAlign: 'left', padding: '8px', borderBottom: `1px solid ${EMBRY.border}` }}>Proof</th>}
                    {(postureMode === '5ft' || postureMode === 'lean-in') && <th style={{ ...label, textAlign: 'left', padding: '8px', borderBottom: `1px solid ${EMBRY.border}` }}>Repair</th>}
                  </tr></thead>
                  <tbody>{(postureMode === '10ft' ? blockerQueue.slice(0, 1) : postureMode === '5ft' ? blockerQueue.slice(0, 3) : blockerQueue).map((row) => { const rowSeverity = row.outcome.includes('not') ? 'CRITICAL' : row.outcome.includes('no') ? 'HIGH' : row.outcome.includes('inconclusive') ? 'MEDIUM' : 'LOW'; return (
                    <tr
                      key={`${row.entityType}-${row.id}`}
                      data-qid={`posture:blocker-row:${String(row.id).replace(/[^A-Za-z0-9_-]/g, '-').toLowerCase()}`}
                      data-qs-action="POSTURE_SELECT_BLOCKER"
                      title={`Select posture blocker ${row.id}`}
                      data-entity-id={row.id}
                      data-entity-type={row.entityType}
                      onClick={() => onSelectBlocker(String(row.id))}
                      style={{ borderBottom: `1px solid ${EMBRY.border}`, background: blockerId === row.id ? 'rgba(0,209,255,0.08)' : 'transparent', cursor: 'pointer' }}
                    >
                      <td style={{ padding: postureMode === '5ft' ? '4px 2px' : '10px 8px', color: EMBRY.white }}>{row.rank}</td>
                      <td style={{ padding: postureMode === '5ft' ? '4px 2px' : '10px 8px', color: EMBRY.white, fontWeight: 700 }}>{row.id}</td>
                      <td style={{ padding: postureMode === '5ft' ? '6px 4px' : '10px 8px', color: row.outcome.includes('not') ? criticalText : row.outcome.includes('no') ? '#60a5fa' : EMBRY.amber, fontWeight: 800, textTransform: 'uppercase', whiteSpace: postureMode === '5ft' ? 'nowrap' : 'normal' }}>{postureMode === '5ft' ? rowSeverity : row.outcome}</td>
                      {postureMode === '5ft' && <td style={{ padding: '6px 4px', color: EMBRY.red, fontWeight: 800, textTransform: 'uppercase' }}>{row.outcome}</td>}
                      {postureMode !== '5ft' && <td style={{ padding: '10px 8px', color: '#00d1ff' }}>{row.mappedControls?.join(', ') || (row.entityType === 'control-family' ? 'Coverage intake' : 'Evidence case')}</td>}
                      {postureMode !== '5ft' && <td style={{ padding: '10px 8px', color: EMBRY.dim }}>{row.reason}</td>}
                      {(postureMode === '5ft' || postureMode === 'lean-in') && <td style={{ padding: '10px 8px', color: EMBRY.amber }}>UNKNOWN</td>}
                      {(postureMode === '5ft' || postureMode === 'lean-in') && <td style={{ padding: '10px 8px', color: EMBRY.amber }}>UNKNOWN</td>}
                      {(postureMode === '5ft' || postureMode === 'lean-in') && <td style={{ padding: '10px 8px', color: EMBRY.red, fontWeight: 800 }}>{leanInProofState}</td>}
                      {(postureMode === '5ft' || postureMode === 'lean-in') && <td style={{ padding: '10px 8px', color: EMBRY.amber, fontWeight: 800 }}>OPEN</td>}
                    </tr>
                  )})}</tbody>
                </table>}
          </section>
        </div>
        )}
        {postureMode === '5ft' && (
          <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
            <section data-qid="posture-severity-strip" aria-label="Blocker severity strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
              {([
                ['Critical', severityCounts.critical, EMBRY.red],
                ['High', severityCounts.high, EMBRY.amber],
                ['Medium', severityCounts.medium, '#60a5fa'],
                ['Low', severityCounts.low, EMBRY.dim],
              ] as const).map(([labelText, count, color]) => (
                <div key={labelText} style={{ ...card, padding: 8, borderTop: `3px solid ${color}` }}>
                  <div style={{ ...label, fontSize: 10 }}>{labelText}</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color }}>{count}</div>
                </div>
              ))}
            </section>
            <section data-qid="posture-disposition-ratio" aria-label="Disposition ratio" style={{ ...card, padding: 10, display: 'grid', gap: 6 }}>
              <div style={{ ...label, fontSize: 10 }}>DISPOSITION RATIO</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 12 }}>
                <span>Satisfied: <strong>{dispositionCounts.satisfied}</strong></span>
                <span>Not satisfied: <strong style={{ color: EMBRY.red }}>{dispositionCounts.not_satisfied}</strong></span>
                <span>No case: <strong style={{ color: '#60a5fa' }}>{dispositionCounts.no_case}</strong></span>
              </div>
            </section>
          </div>
        )}
      </section>
      )}

      {postureMode === 'lean-in' && (
        <>
          <section data-qid="posture:signoff-verdict" aria-hidden="true" style={{ display: 'none' }}>{verdict}</section>
          <section
            data-qid="posture-readiness-summary"
            aria-label="Lean-in compact verdict header"
            className="posture-lean-in-sticky-header"
            style={{ display: 'none' }}
          >
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontWeight: 900, color: EMBRY.white, fontSize: 18 }}>Posture</span>
                <span style={{ fontSize: 10, fontWeight: 800, color: EMBRY.amber, border: `1px solid ${EMBRY.amber}`, padding: '2px 6px', borderRadius: 4 }}>BETA</span>
              </div>
              <div data-qid="posture-scope" style={{ fontSize: 13, color: EMBRY.dim }}>
                F-36 Mission Systems · SPARTA corpus · Gate F · Brandon Bailey
              </div>
              <div data-qid="posture-evidence-health" style={{ fontSize: 12, fontWeight: 800, color: EMBRY.red }}>
                {serverTimestamp} · Evidence degraded · Monitor unknown
              </div>
            </div>
            <div data-qid="posture-readiness-verdict" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
              <div
                data-qid="posture-signoff-verdict"
                style={{ fontSize: 22, fontWeight: 900, color: verdictTone.fg, border: `2px solid ${verdictTone.border}`, background: verdictTone.bg, padding: '6px 10px', borderRadius: 8 }}
              >
                {verdict}
              </div>
              <div data-qid="posture:signoff-verdict" aria-hidden="true" style={{ display: 'none' }}>{verdict}</div>
              <div style={{ color: EMBRY.white, fontSize: 14 }}>Repair target: <strong style={{ color: criticalText }}>{blockerId}</strong></div>
            </div>
            <div style={{ display: 'none' }} aria-hidden="true" />
          </section>

          <main
            data-qid="posture-lean-in-cockpit-grid"
            style={{ display: 'grid', gridTemplateColumns: 'minmax(96px, 12%) minmax(190px, 26%) minmax(190px, 31%) minmax(190px, 31%)', gap: 6, minHeight: 0, height: 'calc(100vh - 108px)', maxHeight: 'calc(100vh - 108px)', alignItems: 'stretch', overflow: 'hidden' }}
          >
            <aside data-qid="posture-critical-blockers" className="posture-lean-in-rail" style={{ ...card, padding: 6, overflow: 'hidden', display: 'grid', gap: 4, alignContent: 'start', fontSize: 10 }}>
              <div data-qid="posture-top-blocker-only">
                <div style={{ ...label, fontSize: 9 }}>SELECTED</div>
                <div style={{ fontSize: 13, fontWeight: 900, color: EMBRY.white }}>{blockerId}</div>
              </div>
              <div data-qid="posture-blocker-list" style={{ display: 'none' }}>
                <div style={{ ...label, marginBottom: 8 }}>BLOCKER LIST (Lean-in mode)</div>
                <div data-qid="posture:blocker-queue" style={{ display: 'grid', gap: 8 }}>
                  {blockerQueue.map((row) => {
                    const selected = String(blockerId) === String(row.id)
                    const sev = row.outcome.includes('not') ? 'CRITICAL' : row.outcome.includes('inconclusive') ? 'HIGH' : row.outcome.includes('no') ? 'HIGH' : 'MEDIUM'
                    const disp = row.outcome.includes('not') ? 'NOT SATISFIED' : row.outcome.toUpperCase()
                    return (
                      <button
                        key={`${row.entityType}-${row.id}`}
                        type="button"
                        data-qs-action="POSTURE_SELECT_BLOCKER"
                        data-blocker-id={row.id}
                        aria-selected={selected}
                        title={`Select blocker ${row.id}`}
                        aria-label={`Select blocker ${row.id}`}
                        onClick={() => onSelectBlocker(String(row.id))}
                        style={{
                          textAlign: 'left',
                          cursor: 'pointer',
                          border: `1px solid ${selected ? EMBRY.red : EMBRY.border}`,
                          background: selected ? 'rgba(255,76,76,0.08)' : 'rgba(255,255,255,0.02)',
                          borderRadius: 10,
                          padding: 10,
                          color: EMBRY.white,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                          <strong>{row.id}</strong>
                          <span style={{ fontSize: 11, fontWeight: 800, color: sev === 'CRITICAL' ? EMBRY.red : EMBRY.amber }}>{sev}</span>
                        </div>
                        <div style={{ fontSize: 11, color: EMBRY.dim, lineHeight: 1.45 }}>
                          Disposition: {disp}<br />
                          Owner: Unknown · Due: Unknown<br />
                          Proof: {leanInProofState}
                        </div>
                      </button>
                    )
                  })}
                </div>
                <button type="button" onClick={() => onModeChange('5ft')} style={{ marginTop: 10, background: 'transparent', border: 'none', color: '#00d1ff', fontWeight: 800, cursor: 'pointer', fontSize: 12 }}>
                  View all {leanInViolationTotal} violations
                </button>
              </div>
            </aside>

            <section data-qid="posture-evidence-case-pane" className="posture-lean-in-evidence" style={{ ...card, padding: 6, overflow: 'hidden', display: 'grid', gap: 4, alignContent: 'start', fontSize: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ fontWeight: 900, fontSize: 16, color: EMBRY.white }}>{blockerId}</div>
                <span style={{ fontSize: 11, fontWeight: 900, color: EMBRY.red, border: `1px solid ${EMBRY.red}`, padding: '2px 8px', borderRadius: 999 }}>{leanInSeverityLabel}</span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12 }}>
                <span>Disposition: <strong style={{ color: EMBRY.red }}>{leanInDisposition}</strong></span>
                <span>Owner: <strong style={{ color: EMBRY.amber }}>Unknown</strong></span>
                <span>Due: <strong style={{ color: EMBRY.amber }}>Unknown</strong></span>
              </div>
              <div style={{ display: 'none' }} aria-hidden="true">
                <div style={label}>Why signoff is blocked</div>
                <p style={{ color: EMBRY.dim, margin: '6px 0 0', lineHeight: 1.45 }}>{leanInWhyBlocked}</p>
              </div>
              <div style={{ display: 'grid', gap: 4, fontSize: 11 }}>
                <div><span style={label}>Evidence case</span><div style={{ color: EMBRY.white, fontWeight: 700 }}>{leanInEvidenceCaseId}</div></div>
                <div><span style={label}>Controls</span><div style={{ color: '#00d1ff' }}>{leanInControlRefs}</div></div>
                <div><span style={label}>Source</span><div style={{ color: EMBRY.amber, fontWeight: 800 }}>SOURCE STALE</div></div>
              </div>
              <div style={{ border: `1px solid ${EMBRY.red}`, background: 'rgba(255,68,68,0.12)', padding: 6, color: EMBRY.red, fontSize: 10, fontWeight: 800 }}>
                FAIL-CLOSED: signoff blocked until proof + timestamp exist.
              </div>

            </section>

            <aside
                data-qid="posture-proof-chain-drawer"
                data-open={proofDrawerOpen ? 'true' : 'false'}
                style={{ ...card, padding: 6, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0 }}
              >
                <div style={{ ...label, marginBottom: 8 }}>PROOF CHAIN (OPEN)</div>
                <div data-qid="posture-proof-chain-narrative" style={{ display: 'grid', gap: 6, fontSize: 11 }}>
                  {([
                    ['CLAIM (CONTROL)', 'F-36 control implementation claim', 'PROOF LINK MISSING', EMBRY.red],
                    ['CONTROL', leanInControlRefs, 'PROOF LINK MISSING', EMBRY.red],
                    ['QRA', 'Adjacency candidate', 'QRA CANDIDATE', EMBRY.amber],
                    ['SOURCE', 'Evidence repository', 'SOURCE STALE', EMBRY.amber],
                  ] as const).map(([step, detail, status, color]) => (
                    <div key={step} style={{ borderLeft: `3px solid ${color}`, paddingLeft: 10 }}>
                      <div style={{ ...label, color: '#00d1ff' }}>{step}</div>
                      <div style={{ color: EMBRY.white, marginTop: 2 }}>{detail}</div>
                      <div style={{ color, fontWeight: 800, marginTop: 4 }}>{status}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 6, border: `1px solid ${EMBRY.red}`, background: 'rgba(255,68,68,0.1)', padding: 6, color: EMBRY.red, fontSize: 10, fontWeight: 800 }}>
                  FAIL-CLOSED: chain incomplete
                </div>
              </aside>
              <aside data-qid="posture-repair-route-pane" style={{ ...card, padding: 6, overflow: 'hidden', display: 'flex', flexDirection: 'column', minHeight: 0, border: `2px solid ${primaryActionColor}` }}>
                <div style={label}>REPAIR ROUTE</div>
                <ol style={{ margin: '6px 0 0', paddingLeft: 16, color: EMBRY.dim, lineHeight: 1.4, fontSize: 11 }}>
                  {[
                    'Produce implementing evidence',
                    'Capture server timestamp',
                    'Update evidence case + monitor',
                  ].map((step) => (
                    <li key={step} style={{ marginBottom: 4 }}>
                      {step}
                      <div style={{ fontSize: 10, color: EMBRY.amber }}>Owner: Unknown · Due: Unknown</div>
                    </li>
                  ))}
                </ol>
                <button
                  type="button"
                  data-qid="posture-route-repair-primary"
                  data-qs-action="POSTURE_ROUTE_REPAIR"
                  title="Route repair for selected blocker"
                  aria-label="Route repair for selected blocker"
                  onClick={() => requestResolutionAction('Route repair')}
                  style={{ marginTop: 8, minHeight: 44, border: `1px solid ${primaryActionColor}`, background: primaryActionColor, color: EMBRY.white, fontWeight: 800, cursor: 'pointer', width: '100%' }}
                >
                  Route repair
                </button>
              </aside>
          </main>

          <footer data-qid="posture-streamdeck-macro-bar" aria-label="Stream Deck and voice macro targets" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${EMBRY.border}`, paddingTop: 6, paddingBottom: 4 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {onAnalyzeProofChain && (
                <button
                  type="button"
                  data-qid="posture-open-proof-chain-primary"
                  data-qs-action="POSTURE_OPEN_PROOF_CHAIN"
                  title="Open proof chain for selected blocker"
                  aria-label="Open proof chain for selected blocker"
                  onClick={() => { setProofDrawerOpen(true); requestEvidenceReview(missingCases, 'Open proof chain') }}
                  style={{ minHeight: 44, minWidth: 44, border: `1px solid ${primaryActionColor}`, background: primaryActionColor, color: EMBRY.white, fontWeight: 900, cursor: 'pointer', padding: '0 10px', fontSize: 11 }}
                >
                  Proof
                </button>
              )}
              {([
                ['posture-macro-status', 'posture-readiness-summary', 'STATUS'],
                ['posture-macro-evidence', 'posture-evidence-health', 'EVIDENCE'],
                ['posture-macro-top-blocker', 'posture-critical-blockers', 'TOP BLOCKER'],
                ['posture-macro-open-case', 'posture-evidence-case-pane', 'OPEN CASE'],
                ['posture-macro-proof-chain', 'posture-proof-chain-drawer', 'PROOF CHAIN'],
              ] as const).map(([macroQid, targetQid, labelText]) => {
                const macroAction = {
                  STATUS: 'POSTURE_MACRO_STATUS',
                  EVIDENCE: 'POSTURE_MACRO_EVIDENCE',
                  'TOP BLOCKER': 'POSTURE_MACRO_TOP_BLOCKER',
                  'OPEN CASE': 'POSTURE_MACRO_REVIEW_CASE',
                  'PROOF CHAIN': 'POSTURE_MACRO_PROOF_CHAIN',
                }[labelText] ?? 'POSTURE_MACRO_STATUS'
                const onMacro = () => {
                  if (labelText === 'STATUS') onModeChange('10ft')
                  else if (labelText === 'EVIDENCE') onModeChange('5ft')
                  else if (labelText === 'TOP BLOCKER') {
                    onModeChange('5ft')
                    if (blockerQueue[0]?.id) onSelectBlocker(String(blockerQueue[0].id))
                  } else if (labelText === 'OPEN CASE') enterLeanIn()
                  else if (labelText === 'PROOF CHAIN') {
                    if (blockerQueue[0]?.id) onSelectBlocker(String(blockerQueue[0].id))
                    enterLeanIn()
                    setProofDrawerOpen(true)
                  }
                  document.querySelector(`[data-qid="${targetQid}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                }
                return (
                <button
                  key={macroQid}
                  type="button"
                  data-qid={macroQid}
                  data-qs-action={macroAction}
                  title={`Stream Deck macro: ${labelText}`}
                  aria-label={`Stream Deck macro: ${labelText}`}
                  onClick={onMacro}
                  style={{ minHeight: 44, minWidth: 110, border: `1px solid ${EMBRY.border}`, background: EMBRY.bgCard, color: EMBRY.white, fontWeight: 800, fontSize: 12, cursor: 'pointer' }}
                >
                  {labelText}
                </button>
              )})}
            </div>
            <div style={{ color: EMBRY.green, fontWeight: 800, fontSize: 12 }}>Embry OS · SPARTA Explorer</div>
          </footer>
        </>
      )}

      {postureMode === 'lean-in' && (
      <details data-qid="posture-workflow-details"
 open={false} style={{ display: 'block', border: `1px solid ${EMBRY.border}`, padding: '12px 14px', background: 'rgba(255,255,255,0.02)' }}>
        <summary style={{ cursor: 'pointer', color: EMBRY.white, fontWeight: 800 }}>Workflow guide, resolution paths, and proof-chain narrative</summary>
        <div style={{ display: 'grid', gap: 18, marginTop: 16 }}>
          <aside data-qid="posture:why-use" style={{ display: 'grid', gap: 14, borderTop: `1px solid ${EMBRY.border}`, paddingTop: 14 }}>
            <div data-qid="posture-persona-explainer">
              <div style={{ ...label, color: '#00d1ff', marginBottom: 8 }}>WHY BRANDON USES POSTURE</div>
              <p style={{ color: EMBRY.dim, lineHeight: 1.48, margin: 0 }}>
                To answer whether this selected scope can be signed off today, and what proof blocks it first.
              </p>
              <p style={{ color: EMBRY.dim, lineHeight: 1.48, margin: '10px 0 0' }}>
                Coverage health, threat relationship browsing, supply-chain inventory, and raw source review stay on their own pages unless they become signoff evidence.
              </p>
            </div>
          </aside>

          <section data-qid="posture:first-blocker" aria-label={`First signoff blocker: ${blockerId}`} style={{ display: 'grid', gap: 12, borderTop: `1px solid ${EMBRY.border}`, paddingTop: 14 }}>
            <div style={{ ...label, color: '#00d1ff' }}>FIRST BLOCKER DETAIL</div>
            <p style={{ color: EMBRY.white, fontSize: 16, lineHeight: 1.42, margin: 0 }}>
              <strong style={{ color: criticalText }}>{blockerId}</strong>{blockerReason.startsWith(blockerId) ? blockerReason.slice(blockerId.length) : `: ${blockerReason}`}
            </p>
            <p data-qid="posture:first-blocker:why-it-matters" style={{ color: EMBRY.dim, lineHeight: 1.42, margin: 0 }}>
              Why it matters: {blockerContext}
            </p>
          </section>

          <div data-qid="posture-workflow-stepper"><div data-qid="posture:verdict-resolution-path" aria-label="Resolution path for the current blocking violation" style={{ display: 'grid', gap: 8 }}>
            <span style={{ ...label, color: '#00d1ff' }}>Resolution path</span>
            {['Review evidence', 'Inspect source', 'Assign owner', 'Rerun case'].map((step, index) => (
              <button key={step} type="button" data-qid={`posture:resolution-step:${index + 1}`} data-qs-action="POSTURE_RESOLUTION_STEP" aria-label={`${step} for ${blockerId}`} aria-keyshortcuts="Enter Space" title={`${step} for ${blockerId}`} onClick={() => index === 0 ? requestEvidenceReview(missingCases, 'Evidence review') : requestResolutionAction(step)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-start', gap: 6, border: `1px solid ${EMBRY.border}`, background: 'rgba(255,255,255,0.03)', color: EMBRY.dim, padding: '8px 10px', minHeight: 44, width: 'fit-content', fontSize: 12, fontWeight: 900, cursor: 'pointer' }}>
                <strong>{index + 1}</strong> {step}
              </button>
            ))}
          </div></div>

          {onAnalyzeProofChain && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <button type="button" data-qid="posture:action:review-evidence-case-verdict" data-qs-action="POSTURE_REVIEW_EVIDENCE_CASE_FROM_VERDICT" title={`Review evidence case for ${blockerId}`} onClick={() => requestEvidenceReview(missingCases, 'Evidence review')} style={{ minHeight: 44, border: `1px solid ${EMBRY.border}`, background: EMBRY.bgDeep, color: EMBRY.white, padding: '8px 12px', fontWeight: 800, cursor: 'pointer' }}>Review {blockerId} evidence</button>
              <button type="button" data-qid="posture:action:review-evidence-case-primary" data-qs-action="POSTURE_REVIEW_EVIDENCE_CASE" title={`Review evidence case for ${blockerId}`} onClick={() => requestEvidenceReview(missingCases, 'Evidence review')} style={{ minHeight: 44, border: `1px solid ${criticalText}`, background: 'rgba(255, 68, 68, 0.14)', color: criticalText, padding: '8px 12px', fontWeight: 900, cursor: 'pointer' }}>Review evidence case for {blockerId}</button>
              <button type="button" data-qid="posture:action:review-all-violations" data-qs-action="POSTURE_REVIEW_ALL_VIOLATIONS" title={`Review all ${criticalFindings} remaining violations`} onClick={() => requestEvidenceReview(criticalFindings, 'All-violations review')} style={{ minHeight: 44, border: '1px solid rgba(0, 209, 255, 0.35)', background: 'rgba(0, 209, 255, 0.08)', color: '#00d1ff', padding: '8px 12px', fontWeight: 800, cursor: 'pointer' }}>Review all {criticalFindings} violations</button>
              <button type="button" data-qid="posture:action:assign-repair-owner" data-qs-action="POSTURE_ASSIGN_REPAIR_OWNER" title="Assign repair owner for selected blocker" aria-label="Assign repair owner for selected blocker" onClick={() => requestResolutionAction('Repair owner assignment')} style={{ minHeight: 44, border: `1px solid ${EMBRY.border}`, background: EMBRY.bgDeep, color: EMBRY.white, padding: '8px 12px', fontWeight: 800, cursor: 'pointer' }}>Assign repair owner</button>
              <button type="button" data-qid="posture:action:open-source-section" data-qs-action="POSTURE_OPEN_SOURCE_SECTION" title="Inspect evidence source section" aria-label="Inspect evidence source section" onClick={() => requestResolutionAction('Evidence source inspection')} style={{ minHeight: 44, border: `1px solid ${EMBRY.border}`, background: EMBRY.bgDeep, color: EMBRY.white, padding: '8px 12px', fontWeight: 800, cursor: 'pointer' }}>Inspect evidence source</button>
              <a data-qid="posture:action:triage-unassessed-in-coverage" data-qs-action="POSTURE_TRIAGE_UNASSESSED_IN_COVERAGE" title="Triage unassessed controls in Coverage" aria-label="Triage unassessed controls in Coverage" href="#sparta-explorer/coverage" style={{ color: '#00d1ff', fontSize: 12, fontWeight: 800, textDecoration: 'none', border: `1px solid ${EMBRY.border}`, padding: '8px 12px', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
                Triage unassessed controls in Coverage
              </a>
            </div>
          )}


        </div>
      </details>
      )}
    </div>
    </div>
  )
}


function TraceabilityTab({ traceabilityScore, mappedRequirements, orphanRequirements, totalControls, controlsWithEvidence, controlsWithRelationships, relationshipTypes, totalRelationships, coverageChain, brokenTraces }: {
  traceabilityScore: number; mappedRequirements: number; orphanRequirements: number
  totalControls: number; controlsWithEvidence: number; controlsWithRelationships: number
  relationshipTypes: Record<string, number>; totalRelationships: number
  coverageChain: { reqToControl: number; controlToRel: number; controlToEvidence: number }
  brokenTraces: BrokenTrace[]
}) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14 }}>
        <KpiCard qid="trace:kpi:score" title="Traceability Score" value={traceabilityScore} delta={`${brokenTraces.length} broken traces`} deltaType={traceabilityScore >= 70 ? 'up' : 'warn'} />
        <KpiCard qid="trace:kpi:mapped" title="Mapped Requirements" value={mappedRequirements} delta={`${Math.round((mappedRequirements / Math.max(mappedRequirements + orphanRequirements, 1)) * 100)}% with controls`} deltaType="up" />
        <KpiCard qid="trace:kpi:orphan" title="Orphan Requirements" value={orphanRequirements} delta="No mapped controls" deltaType={orphanRequirements === 0 ? 'up' : 'down'} />
        <KpiCard qid="trace:kpi:controls" title="Controls with Evidence" value={controlsWithEvidence} delta={`of ${totalControls.toLocaleString()} total`} deltaType="up" />
        <KpiCard qid="trace:kpi:rels" title="Total Relationships" value={totalRelationships.toLocaleString()} delta={`${controlsWithRelationships.toLocaleString()} controls linked`} deltaType="up" />
        <KpiCard qid="trace:kpi:rel-controls" title="Controls Linked" value={controlsWithRelationships.toLocaleString()} delta={`${totalControls ? Math.round((controlsWithRelationships / totalControls) * 100) : 0}% coverage`} deltaType={controlsWithRelationships / totalControls > 0.8 ? 'up' : 'warn'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <PanelSection qid="trace:panel:rel-types" title="Relationship Integrity" desc="Breakdown of OSCAL relationship types across the control mapping graph.">
          <div style={{ display: 'grid', gap: 10 }}>
            {Object.entries(relationshipTypes).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([type, count]) => {
              const pct = totalRelationships ? Math.round((count / totalRelationships) * 100) : 0
              const variant = type.includes('equivalent') ? 'green' : type.includes('no') ? 'red' : type.includes('intersect') ? 'amber' : 'cyan'
              return <BarRow key={type} name={type} pct={pct} count={count.toLocaleString()} variant={variant} />
            })}
          </div>
        </PanelSection>

        <PanelSection qid="trace:panel:chain" title="Coverage Chain Health" desc="How complete is each link in the traceability chain.">
          <div style={{ display: 'grid', gap: 10 }}>
            <BarRow name="Req → Control" pct={coverageChain.reqToControl} variant={coverageChain.reqToControl >= 80 ? 'green' : 'amber'} />
            <BarRow name="Control → Rel" pct={coverageChain.controlToRel} variant={coverageChain.controlToRel >= 80 ? 'green' : 'amber'} />
            <BarRow name="Control → Evidence" pct={coverageChain.controlToEvidence} variant={coverageChain.controlToEvidence >= 10 ? 'cyan' : 'red'} />
          </div>
        </PanelSection>
      </div>

      <PanelSection qid="trace:panel:broken" title="Broken Traces" desc="Evidence cases that failed or returned inconclusive verdicts.">
        {brokenTraces.length === 0
          ? <div style={label}>No broken traces.</div>
          : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead><tr>
                <th style={{ ...label, textAlign: 'left', padding: '8px 10px', borderBottom: `1px solid ${EMBRY.border}` }}>Trace</th>
                <th style={{ ...label, textAlign: 'left', padding: '8px 10px', borderBottom: `1px solid ${EMBRY.border}` }}>Defect</th>
                <th style={{ ...label, textAlign: 'left', padding: '8px 10px', borderBottom: `1px solid ${EMBRY.border}` }}>Impact</th>
              </tr></thead>
              <tbody>{brokenTraces.map((bt, i) => (
                <tr key={i} data-qid={`trace:broken:${i}`} style={{ borderBottom: `1px solid ${EMBRY.border}` }}>
                  <td style={{ padding: '8px 10px', color: EMBRY.white }}>{bt.trace}</td>
                  <td style={{ padding: '8px 10px', color: bt.defect.includes('Failed') ? EMBRY.red : EMBRY.amber }}>{bt.defect}</td>
                  <td style={{ padding: '8px 10px', color: EMBRY.dim }}>{bt.impact}</td>
                </tr>
              ))}</tbody>
            </table>}
      </PanelSection>
    </div>
  )
}

// ── Tab 3: Assurance Case Health ──

function AssuranceTab({ assuranceScore, supportedClaims, partialClaims, unsupportedClaims, contradictions, totalClaims, evidenceQuality, claimsNeedingReview }: {
  assuranceScore: number; supportedClaims: number; partialClaims: number; unsupportedClaims: number
  contradictions: number; totalClaims: number
  evidenceQuality: { gatePassRate: number; freshness: number; completeness: number; authority: number }
  claimsNeedingReview: ClaimReview[]
}) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14 }}>
        <KpiCard qid="assurance:kpi:score" title="Assurance Score" value={assuranceScore} delta="Claim support strength" deltaType={assuranceScore >= 70 ? 'up' : 'down'} />
        <KpiCard qid="assurance:kpi:supported" title="Supported Claims" value={supportedClaims} delta={`${totalClaims ? Math.round((supportedClaims / totalClaims) * 100) : 0}% fully supported`} deltaType="up" />
        <KpiCard qid="assurance:kpi:partial" title="Partial Claims" value={partialClaims} delta="Inconclusive verdicts" deltaType="warn" />
        <KpiCard qid="assurance:kpi:unsupported" title="Unsupported Claims" value={unsupportedClaims} delta="not_satisfied verdicts" deltaType={unsupportedClaims === 0 ? 'up' : 'down'} />
        <KpiCard qid="assurance:kpi:contradictions" title="Contradictions" value={contradictions} delta="Failed + satisfied on same control" deltaType={contradictions === 0 ? 'up' : 'down'} />
        <KpiCard qid="assurance:kpi:total" title="Total Claims" value={totalClaims} delta="Evidence cases evaluated" deltaType="up" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1fr 1fr', gap: 16 }}>
        <PanelSection qid="assurance:panel:strength" title="Assurance Strength" desc="Distribution of claim support quality.">
          <div style={{ display: 'grid', gap: 10 }}>
            <BarRow name="Supported" pct={totalClaims ? Math.round((supportedClaims / totalClaims) * 100) : 0} count={supportedClaims} variant="green" />
            <BarRow name="Partial" pct={totalClaims ? Math.round((partialClaims / totalClaims) * 100) : 0} count={partialClaims} variant="cyan" />
            <BarRow name="Unsupported" pct={totalClaims ? Math.round((unsupportedClaims / totalClaims) * 100) : 0} count={unsupportedClaims} variant="red" />
          </div>
        </PanelSection>

        <PanelSection qid="assurance:panel:quality" title="Evidence Quality Factors" desc="Why claims look defensible or weak.">
          <div style={{ display: 'grid', gap: 10 }}>
            <BarRow name="Gate Pass Rate" pct={evidenceQuality.gatePassRate} variant={evidenceQuality.gatePassRate >= 80 ? 'green' : 'amber'} />
            <BarRow name="Freshness" pct={evidenceQuality.freshness} variant={evidenceQuality.freshness >= 80 ? 'green' : 'amber'} />
            <BarRow name="Completeness" pct={evidenceQuality.completeness} variant={evidenceQuality.completeness >= 80 ? 'green' : 'red'} />
            <BarRow name="Authority (A+)" pct={evidenceQuality.authority} variant={evidenceQuality.authority >= 80 ? 'green' : 'amber'} />
          </div>
        </PanelSection>

        <PanelSection qid="assurance:panel:contradictions" title="Contradiction Summary" desc="Controls with conflicting evidence case verdicts.">
          <div style={{ display: 'grid', gap: 12 }}>
            <div style={{ ...card, padding: 12, borderRadius: 12 }}>
              <div style={{ fontWeight: 700, color: EMBRY.white }}>{contradictions} contradictions</div>
              <div style={{ ...label, fontSize: 11, marginTop: 4 }}>Same control has both satisfied and not_satisfied evidence cases.</div>
            </div>
            <div style={{ ...card, padding: 12, borderRadius: 12 }}>
              <div style={{ fontWeight: 700, color: EMBRY.white }}>{unsupportedClaims} unsupported</div>
              <div style={{ ...label, fontSize: 11, marginTop: 4 }}>Claims remain red until remediation or risk acceptance.</div>
            </div>
          </div>
        </PanelSection>
      </div>

      <PanelSection qid="assurance:panel:review" title="Claims Needing Review" desc="Evidence cases requiring assessor or AO attention.">
        {claimsNeedingReview.length === 0
          ? <div style={label}>All claims currently supported.</div>
          : <div style={{ display: 'grid', gap: 10 }}>
              {claimsNeedingReview.map((c, i) => (
                <div key={i} data-qid={`assurance:claim:${i}`} style={{ border: `1px solid ${EMBRY.border}`, borderRadius: 12, padding: 12, background: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 999, fontSize: 12, fontWeight: 700, border: '1px solid rgba(255,255,255,0.05)', color: c.verdict === 'not_satisfied' ? EMBRY.red : EMBRY.amber, background: c.verdict === 'not_satisfied' ? 'rgba(255,68,68,0.12)' : 'rgba(255,170,0,0.12)' }}>
                      {c.verdict} — {c.grade}
                    </span>
                    <span style={{ ...label, fontSize: 11 }}>{c.gates} gates</span>
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: EMBRY.white, marginBottom: 4 }}>{c.question}</div>
                  <div style={{ ...label, fontSize: 11 }}>Controls: {c.controls.join(', ')}</div>
                </div>
              ))}
            </div>}
      </PanelSection>
    </div>
  )
}

// ── Main Dashboard ──

export default function PostureDashboard({ onNavigateToControl, onAnalyzeProofChain }: Props) {
  useRegisterAction('posture:dashboard', { app: 'sparta-explorer', action: 'SHOW_DASHBOARD', label: 'Show Posture Signoff Layer', description: 'Display the assessor signoff decision layer' })
  useRegisterAction('posture:diagnostics-switch', { app: 'sparta-explorer', action: 'POSTURE_DIAGNOSTICS_SWITCH', label: 'Switch posture diagnostics', description: 'Switch between Traceability and Assurance diagnostics' })
  useRegisterAction('posture:workflow:analyze-proof-chain', { app: 'sparta-explorer', action: 'POSTURE_WORKFLOW_ANALYZE_PROOF_CHAIN', label: 'Analyze Proof Chain From Workflow', description: 'Run proof-chain analysis from the Brandon workflow guide' })
  useRegisterAction('posture-readiness-summary', { app: 'sparta-explorer', action: 'POSTURE_MACRO_STATUS', label: 'Posture STATUS macro', description: 'Focus 10ft verdict banner', tags: ['streamdeck', 'voice'] })
  useRegisterAction('posture-evidence-health', { app: 'sparta-explorer', action: 'POSTURE_MACRO_EVIDENCE', label: 'Posture EVIDENCE macro', description: 'Highlight evidence freshness and monitor state', tags: ['streamdeck', 'voice'] })
  useRegisterAction('posture-critical-blockers', { app: 'sparta-explorer', action: 'POSTURE_MACRO_TOP_BLOCKER', label: 'Posture TOP BLOCKER macro', description: 'Switch to 5ft and highlight top blocker', tags: ['streamdeck', 'voice'] })
  useRegisterAction('posture-review-blockers-primary', { app: 'sparta-explorer', action: 'POSTURE_MACRO_REVIEW_CASE', label: 'Posture OPEN CASE macro', description: 'Enter lean-in and open evidence case pane', tags: ['streamdeck', 'voice'] })
  useRegisterAction('posture-proof-chain-drawer', { app: 'sparta-explorer', action: 'POSTURE_MACRO_PROOF_CHAIN', label: 'Posture PROOF CHAIN macro', description: 'Enter lean-in and open proof-chain drawer', tags: ['streamdeck', 'voice'] })

  const { loading, error, posture, traceability, assurance } = usePostureData()
  const { data: f36Posture, loading: f36Loading, error: f36Error } = useF36PostureReadModel()
  const [activeTab, setActiveTab] = useState<Exclude<Tab, 'Posture'>>('Traceability')
  const { mode: postureMode, setMode: setPostureMode } = usePageDistanceMode()
  const [selectedBlockerId, setSelectedBlockerId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return window.sessionStorage.getItem(POSTURE_BLOCKER_STORAGE)
  })

useEffect(() => {
    if (typeof window === 'undefined') return
    if (selectedBlockerId) window.sessionStorage.setItem(POSTURE_BLOCKER_STORAGE, selectedBlockerId)
  }, [selectedBlockerId])

  const handleModeChange = useCallback((mode: PostureMode) => {
    setPostureMode(mode as any)
    if (mode === 'lean-in') setActiveTab('Traceability')
  }, [])

  return (
    <div style={{ background: EMBRY.bg, minHeight: '100%', padding: 20, display: 'grid', gap: 24, alignContent: 'start', overflowY: 'auto' }}>
      {loading && <div style={{ ...label, padding: 20, textAlign: 'center' }}>Loading posture evidence from /api/posture/v2...</div>}
      {error && (
        <section data-qid="posture:error" style={{ border: `1px solid ${EMBRY.red}`, color: EMBRY.red, padding: 12 }}>
          Posture cannot compute a signoff verdict because /api/posture/v2 failed: {String(error)}
        </section>
      )}

      {!loading && !error && (
        <>
          {f36Loading && <section data-qid="posture:f36-corpus-loading" style={{ border: `1px solid ${EMBRY.border}`, padding: 14 }}>Loading live F-36 corpus posture...</section>}
          {f36Error && <section data-qid="posture:f36-corpus-unavailable" style={{ border: `1px solid ${EMBRY.red}`, color: EMBRY.red, padding: 14 }}>F-36 corpus posture unavailable: {f36Error}</section>}
          {f36Posture && (
            <section
              data-qid="posture:f36-corpus-readiness"
              data-projection-fingerprint={f36Posture.projection_fingerprint}
              style={{
                border: `1px solid ${EMBRY.amber}`,
                background: 'rgba(255, 170, 0, 0.08)',
                padding: 14,
                display: 'grid',
                gap: 6,
              }}
            >
              <div style={{ ...label, color: EMBRY.amber }}>SYNTHETIC F-36 CORPUS · LIVE SOURCE · NON-OPERATIONAL</div>
              <strong data-qid="posture:f36-readiness-verdict" style={{ fontSize: 24 }}>{f36Posture.readiness}</strong>
              <div data-qid="posture:f36-corpus-counts">{f36Posture.counts.requirements_total.toLocaleString()} requirements · {f36Posture.counts.component_families_with_requirements} active component families · {f36Posture.counts.requirements_reviewed} reviewed</div>
              <div data-qid="posture:f36-grounding-counts">Grounded 0 · accepted evidence cases 0 · candidate mapped {f36Posture.counts.requirements_candidate_mapped} · compliance credit 0</div>
              <div style={{ color: EMBRY.dim }}>{f36Posture.reason_codes.join(' · ')}</div>
              <code style={{ color: EMBRY.dim, fontSize: 10, overflowWrap: 'anywhere' }}>
                projection fingerprint: {f36Posture.projection_fingerprint}
              </code>
            </section>
          )}
          <PostureTab
          {...posture}
          postureMode={postureMode}
          onModeChange={handleModeChange}
          selectedBlockerId={selectedBlockerId}
          onSelectBlocker={setSelectedBlockerId}
          traceabilityScore={traceability.traceabilityScore}
          assuranceScore={assurance.assuranceScore}
          totalRelationships={traceability.totalRelationships}
          onNavigateToControl={onNavigateToControl}
          onAnalyzeProofChain={onAnalyzeProofChain}
          />
        </>
      )}

      {!loading && !error && postureMode === 'lean-in' && (
        <section data-qid="posture:secondary-diagnostics" style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 18, display: 'grid', gap: 14 }}>
          <div data-qid="posture-analysis-tab">
            <div style={{ ...label, color: '#00d1ff', marginBottom: 8 }}>SECONDARY DIAGNOSTICS</div>
            <div style={{ color: EMBRY.dim, lineHeight: 1.45 }}>
              These views explain supporting traceability and assurance signals. They are below the signoff decision because they do not replace the assessor verdict.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {(['Traceability', 'Assurance Case Health'] as const).map((t) => (
          <button
            key={t}
            type="button"
            data-qid={`posture:tab:${t.toLowerCase().replace(/\s+/g, '-')}`}
            data-qs-action="POSTURE_DIAGNOSTICS_SWITCH"
            title={`Switch to ${t} tab`}
            onClick={() => setActiveTab(t)}
            style={{
              appearance: 'none',
              padding: '12px 16px',
              minHeight: 44,
              borderRadius: 999,
              fontWeight: 700,
              cursor: 'pointer',
              transition: '0.2s ease',
              fontSize: 14,
              background: activeTab === t ? EMBRY.green : EMBRY.bgCard,
              color: activeTab === t ? EMBRY.bg : EMBRY.dim,
              border: `1px solid ${activeTab === t ? 'transparent' : EMBRY.border}`,
            }}
          >
            {t}
          </button>
            ))}
          </div>
          {activeTab === 'Traceability' && <TraceabilityTab {...traceability} />}
          {activeTab === 'Assurance Case Health' && <AssuranceTab {...assurance} />}
        </section>
      )}
    </div>
  )
}

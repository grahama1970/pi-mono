import { useState } from 'react'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import { usePostureData } from '../../../hooks/usePostureData'
import type { Family, RiskControl, BrokenTrace, ClaimReview } from '../../../hooks/usePostureData'
import { EMBRY, card, label, heading } from '../common/EmbryStyle'

type Props = {
  onNavigateToControl?: (id: string) => void
  onAnalyzeProofChain?: (missingCount: number) => void
}

type Tab = 'Posture' | 'Traceability' | 'Assurance Case Health'
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

function PostureTab({ postureScore, complianceScore, criticalFindings, openFindings, evidenceFreshness, totalCases, families, riskControls, onNavigateToControl, onAnalyzeProofChain }: {
  postureScore: number; complianceScore: number; criticalFindings: number; openFindings: number
  evidenceFreshness: number; totalCases: number; families: Family[]; riskControls: RiskControl[]
  onNavigateToControl?: (id: string) => void
  onAnalyzeProofChain?: (missingCount: number) => void
}) {
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const missingCases = Math.max(0, totalCases - Math.round(totalCases * (postureScore / 100)))
  const firstRisk = riskControls[0]
  const firstNoCaseFamily = families.find((f) => f.noEvidence > 0)
  const unassessedControls = families.reduce((sum, f) => sum + f.noEvidence, 0)
  const firstRiskVerdict = String(firstRisk?.verdict || 'not_satisfied')
  const verdict = totalCases === 0
    ? 'NO EVIDENCE CASES'
    : evidenceFreshness < 80
      ? 'INSUFFICIENT EVIDENCE'
      : criticalFindings > 0
        ? 'NOT SIGNOFF-READY'
        : openFindings > 0
          ? 'INSUFFICIENT EVIDENCE'
          : unassessedControls > 0
            ? 'INSUFFICIENT EVIDENCE'
            : 'SIGNOFF-READY'
  const verdictTone = verdict === 'SIGNOFF-READY'
    ? { border: 'rgba(0, 255, 153, 0.36)', bg: 'rgba(0, 255, 153, 0.08)', fg: EMBRY.green }
    : verdict === 'NOT SIGNOFF-READY'
      ? { border: 'rgba(255, 107, 107, 0.55)', bg: 'rgba(255, 68, 68, 0.09)', fg: '#ff6b6b' }
      : { border: 'rgba(255, 170, 0, 0.42)', bg: 'rgba(255, 170, 0, 0.09)', fg: EMBRY.amber }
  const criticalText = verdict === 'NOT SIGNOFF-READY' ? '#ff4c4c' : verdictTone.fg
  const primaryActionColor = '#007bff'
  const requestEvidenceReview = (count: number, labelText: string) => {
    setActionFeedback(`${labelText} requested for ${blockerId}.`)
    onAnalyzeProofChain?.(count)
  }
  const requestResolutionAction = (labelText: string) => {
    setActionFeedback(`${labelText} requested for ${blockerId}.`)
  }
  const blockerId = firstRisk?.finding_id ?? firstRisk?.control_id ?? firstNoCaseFamily?.family ?? 'Evidence case coverage'
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
  const blockerContext = firstRisk
    ? `${blockerTitle}. This blocker stays first until its cited evidence case is reviewed, its source support is repaired, and the case is rerun to a satisfied verdict.`
    : firstNoCaseFamily
      ? `${firstNoCaseFamily.family} is a Coverage intake blocker: create evidence cases before Posture can make an assessor verdict.`
      : 'No selected blocker has additional context.'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '260px minmax(0, 1fr)', gap: 28, alignItems: 'start' }}>
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
      <aside data-qid="posture:why-use" style={{ borderRight: `1px solid ${EMBRY.border}`, paddingRight: 22, display: 'grid', gap: 22 }}>
        <div>
          <div style={{ ...label, color: '#00d1ff', marginBottom: 8 }}>POSTURE</div>
          <h2 style={{ ...heading, fontSize: 28, lineHeight: 1.08, margin: 0 }}>Signoff decision layer</h2>
        </div>
        <div>
          <div style={{ ...label, color: '#00d1ff', marginBottom: 8 }}>WHY BRANDON USES IT</div>
          <p style={{ color: EMBRY.dim, lineHeight: 1.48, margin: 0 }}>
            To answer whether this selected scope can be signed off today, and what proof blocks it first.
          </p>
        </div>
        <div>
          <div style={{ ...label, color: '#00d1ff', marginBottom: 8 }}>NOT OWNED HERE</div>
          <p style={{ color: EMBRY.dim, lineHeight: 1.48, margin: 0 }}>
            Coverage health, threat relationship browsing, supply-chain inventory, and raw source review stay on their own pages unless they become signoff evidence.
          </p>
        </div>
      </aside>

      <main style={{ display: 'grid', gap: 20, minWidth: 0 }}>
        <section data-qid="posture:scope" aria-label="Selected Posture assessment scope" style={{ display: 'grid', gap: 12, borderBottom: `1px solid ${EMBRY.border}`, paddingBottom: 14 }}>
          <div>
            <div style={{ ...label, color: '#00d1ff', marginBottom: 8 }}>SELECTED SCOPE</div>
            <h1 style={{ ...heading, fontSize: 28, lineHeight: 1.18, margin: 0 }}>SPARTA / F-36 Mission Systems / Framework Control Set</h1>
            <div style={{ color: EMBRY.dim, marginTop: 8 }}>
              Evidence cases: {totalCases} evaluated. Snapshot freshness: {evidenceFreshness}%. Assessor role: Brandon Bailey.
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
            <div title="Supporting score only; the signoff verdict is controlled by evidence outcomes below." style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 10 }}><div style={label}>POSTURE SCORE</div><strong>{postureScore}</strong></div>
            <div title="Supporting score only; unresolved evidence can still block signoff." style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 10 }}><div style={label}>ASSURANCE SCORE</div><strong>{complianceScore}</strong></div>
            <div title="Not-satisfied evidence cases that block signoff." style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 10 }}><div style={label}>REMAINING VIOLATIONS</div><strong>{criticalFindings}/{totalCases}</strong></div>
            <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 10 }}><div style={label}>AUTHORITY</div><strong>Evidence cases</strong></div>
          </div>
        </section>

        <section data-qid="posture:signoff-verdict" role="region" aria-label={`Current signoff verdict: ${verdict}`} style={{ border: `1px solid ${verdictTone.border}`, background: verdictTone.bg, padding: 22, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 24 }}>
          <div>
            <div style={{ ...label, color: verdictTone.fg, marginBottom: 8 }}>CURRENT VERDICT</div>
            <div style={{ fontSize: 30, fontWeight: 900, lineHeight: 1.05, color: EMBRY.white }}>{verdict}</div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '5px 8px', border: `1px solid ${criticalText}`, color: criticalText, background: 'rgba(255, 76, 76, 0.13)', fontSize: 12, fontWeight: 900, textTransform: 'uppercase' }}>
              <span aria-hidden="true" style={{ fontSize: 16, lineHeight: 1 }}>!</span> Blocking violation
            </div>
            <div data-qid="posture:verdict:status-summary" style={{ marginTop: 10, color: EMBRY.white, fontSize: 15, fontWeight: 800 }}>
              Status: {criticalFindings}/{totalCases} blocking violations remain; first repair target is <span style={{ color: criticalText }}>{blockerId}</span>.
            </div>
            <p style={{ fontSize: 17, lineHeight: 1.42, color: EMBRY.white, margin: '12px 0 0' }}>
              <strong style={{ color: criticalText }}>{blockerId}</strong>{blockerReason.startsWith(blockerId) ? blockerReason.slice(blockerId.length) : `: ${blockerReason}`}
            </p>
            <p data-qid="posture:verdict:blocker-context" style={{ color: EMBRY.dim, lineHeight: 1.4, margin: '8px 0 0' }}>
              Why it matters: {blockerContext}
            </p>
            <p style={{ color: EMBRY.dim, lineHeight: 1.4, margin: '10px 0 0' }}>
              Violations are not-satisfied evidence cases. Open findings include not-satisfied plus inconclusive cases. Unassessed controls are controls in the selected corpus without an evidence case yet.
            </p>
            {blockerQueue.length > 1 && (
              <div data-qid="posture:verdict-next-blockers" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                <span style={{ ...label, color: '#00d1ff', alignSelf: 'center' }}>Next blockers</span>
                {blockerQueue.slice(1, 4).map((row) => (
                  <button
                    key={`verdict-${row.entityType}-${row.id}`}
                    type="button"
                    data-qid={`posture:verdict-next-blocker:${String(row.id).replace(/[^A-Za-z0-9_-]/g, '-').toLowerCase()}`}
                    data-qs-action="POSTURE_OPEN_NEXT_BLOCKER"
                    data-entity-id={row.id}
                    data-entity-type={row.entityType}
                    aria-label={`Inspect next signoff blocker ${row.id}: ${row.outcome}`}
                    title={`Click to inspect next blocker ${row.id}`}
                    onClick={() => row.entityType === 'finding' && row.mappedControls?.[0] ? onNavigateToControl?.(row.mappedControls[0]) : undefined}
                    style={{ border: `1px solid ${EMBRY.border}`, background: 'rgba(255,255,255,0.03)', color: EMBRY.white, padding: '4px 8px', minHeight: 44, fontSize: 12, fontWeight: 800, cursor: row.entityType === 'finding' && row.mappedControls?.[0] ? 'pointer' : 'default', boxShadow: 'inset 0 -2px 0 rgba(0, 209, 255, 0.22)' }}
                  >
                    {row.rank}. {row.id} <span style={{ color: row.outcome.includes('not') ? criticalText : row.outcome.includes('no') ? '#60a5fa' : EMBRY.amber }}>{row.outcome}</span>
                    <span style={{ color: '#00d1ff', marginLeft: 6 }}>inspect</span>
                  </button>
                ))}
              </div>
            )}
            <div data-qid="posture:verdict-resolution-path" aria-label="Resolution path for the current blocking violation" style={{ display: 'grid', gap: 8, marginTop: 14 }}>
              <span style={{ ...label, color: '#00d1ff' }}>Resolution path</span>
              {['Review evidence', 'Inspect source', 'Assign owner', 'Rerun case'].map((step, index) => (
                <button key={step} type="button" data-qid={`posture:resolution-step:${index + 1}`} data-qs-action="POSTURE_RESOLUTION_STEP" aria-label={`${step} for ${blockerId}`} aria-keyshortcuts="Enter Space" title={`${step} for ${blockerId}`} onClick={() => index === 0 ? requestEvidenceReview(missingCases, 'Evidence review') : requestResolutionAction(step)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: index === 0 ? 'space-between' : 'flex-start', gap: 6, border: `1px solid ${index === 0 ? primaryActionColor : EMBRY.border}`, background: index === 0 ? primaryActionColor : 'rgba(255,255,255,0.03)', color: index === 0 ? EMBRY.white : EMBRY.dim, padding: index === 0 ? '10px 14px' : '5px 8px', minHeight: index === 0 ? 52 : 44, width: index === 0 ? '100%' : 'fit-content', fontSize: index === 0 ? 15 : 12, fontWeight: 900, cursor: 'pointer', boxShadow: index === 0 ? '0 0 0 3px rgba(74, 158, 255, 0.28), 0 10px 24px rgba(0, 123, 255, 0.14)' : undefined }}>
                  <strong>{index + 1}</strong> {step}
                  {index === 0 && <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>primary</span>}
                </button>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 12, alignContent: 'center' }}>
            {onAnalyzeProofChain && (
              <button
                type="button"
                data-qid="posture:action:review-evidence-case-verdict"
                data-qs-action="POSTURE_REVIEW_EVIDENCE_CASE_FROM_VERDICT"
                aria-label={`Primary action: review evidence case for ${blockerId}`}
                aria-keyshortcuts="Enter Space"
                title={`Review evidence case for ${blockerId}`}
                onClick={() => requestEvidenceReview(missingCases, 'Primary evidence review')}
                style={{
                  minHeight: 58,
                  border: `1px solid ${primaryActionColor}`,
                  background: primaryActionColor,
                  color: EMBRY.white,
                  padding: '12px 14px',
                  fontWeight: 950,
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  boxShadow: '0 0 0 3px rgba(74, 158, 255, 0.24), 0 10px 24px rgba(0, 123, 255, 0.14)',
                }}
              >
                <span>Review {blockerId} evidence</span>
                <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>primary</span>
              </button>
            )}
            <div title="Not-satisfied evidence cases." style={{ display: 'flex', justifyContent: 'space-between', color: criticalText }}><span>Remaining violations</span><strong>{criticalFindings}/{totalCases}</strong></div>
            <div title="Not-satisfied plus inconclusive evidence cases." style={{ display: 'flex', justifyContent: 'space-between', color: EMBRY.amber }}><span>Open findings</span><strong>{openFindings}/{totalCases}</strong></div>
            <div title="Controls in the selected corpus without an evidence case; this is a Coverage triage queue, not a satisfied state." style={{ display: 'flex', justifyContent: 'space-between', color: EMBRY.dim }}><span>Unassessed controls</span><strong>{unassessedControls.toLocaleString()}</strong></div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: EMBRY.green }}><span>Fresh evidence</span><strong>{evidenceFreshness}%</strong></div>
            <a data-qid="posture:action:triage-unassessed-in-coverage" data-qs-action="POSTURE_TRIAGE_UNASSESSED_IN_COVERAGE" href="#sparta-explorer/coverage" aria-label={`Triage ${unassessedControls.toLocaleString()} unassessed controls in Coverage`} title="Triage unassessed controls on the Coverage page" style={{ color: '#00d1ff', fontSize: 12, fontWeight: 800, textDecoration: 'none', border: `1px solid ${EMBRY.border}`, padding: '6px 8px', minHeight: 44, display: 'inline-flex', alignItems: 'center' }}>
              Triage unassessed controls in Coverage
            </a>
            <div data-qid="posture:action-feedback" role="status" aria-live="assertive" aria-atomic="true" style={{ minHeight: 18, color: actionFeedback ? EMBRY.green : EMBRY.dim, fontSize: 12, fontWeight: 800 }}>
              {actionFeedback ?? ''}
            </div>
          </div>
        </section>

        <section data-qid="posture:first-blocker" aria-label={`First signoff blocker: ${blockerId}`} style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr)', gap: 20, borderBottom: `1px solid ${EMBRY.border}`, paddingBottom: 16 }}>
          <div style={{ borderTop: `2px solid ${verdictTone.fg}`, paddingTop: 14 }}>
            <div style={{ ...label, color: '#00d1ff', marginBottom: 8 }}>FIRST BLOCKER</div>
            <button
              type="button"
              data-qid={`posture:blocker:${String(blockerId).replace(/[^A-Za-z0-9_-]/g, '-').toLowerCase()}`}
              data-qs-action="POSTURE_OPEN_FIRST_BLOCKER"
              data-entity-id={blockerId}
              data-entity-type={firstRisk ? 'finding' : firstNoCaseFamily ? 'control-family' : 'posture'}
              aria-label={`Inspect first signoff blocker ${blockerId}: ${blockerOutcome}`}
              title={`Inspect first signoff blocker ${blockerId}`}
              onClick={() => firstRisk?.mapped_controls?.[0] ? onNavigateToControl?.(firstRisk.mapped_controls[0]) : undefined}
              style={{ background: 'transparent', border: `1px solid ${EMBRY.border}`, color: EMBRY.white, minHeight: 44, padding: 12, textAlign: 'left', cursor: firstRisk ? 'pointer' : 'default', width: '100%' }}
            >
              <div style={{ fontSize: 16, fontWeight: 800 }}>{blockerId}</div>
              <div style={{ color: criticalText, fontSize: 12, fontWeight: 800, textTransform: 'uppercase', marginTop: 6 }}>{blockerOutcome}</div>
              <div style={{ color: EMBRY.dim, fontSize: 12, marginTop: 8, lineHeight: 1.35 }}>{blockerTitle}</div>
              {firstRisk?.mapped_controls?.length ? <div style={{ color: '#00d1ff', fontSize: 11, marginTop: 8, lineHeight: 1.35 }}>Mapped controls: {firstRisk.mapped_controls.join(', ')}</div> : null}
            </button>
          </div>
            <div style={{ display: 'grid', gap: 14 }}>
            <p style={{ color: EMBRY.white, fontSize: 17, lineHeight: 1.42, margin: 0 }}>
              <strong style={{ color: criticalText }}>{blockerId}</strong>{blockerReason.startsWith(blockerId) ? blockerReason.slice(blockerId.length) : `: ${blockerReason}`}
            </p>
            <p data-qid="posture:first-blocker:why-it-matters" style={{ color: EMBRY.dim, lineHeight: 1.42, margin: 0 }}>
              Why it matters: {blockerContext}
            </p>
            <div data-qid="posture:first-blocker:resolution-path" style={{ border: `1px solid ${EMBRY.border}`, padding: 10, display: 'grid', gap: 6 }}>
              <div style={{ ...label, color: '#00d1ff' }}>RESOLUTION PATH</div>
              <div style={{ color: EMBRY.dim, lineHeight: 1.4 }}>
                1. Review the evidence case. 2. Inspect the cited source artifact. 3. Assign a repair owner. 4. Rerun the evidence case before signoff.
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', color: EMBRY.dim, fontSize: 12 }}>
                <span style={{ border: `1px solid ${EMBRY.border}`, padding: '3px 7px' }}>Status: queued for review</span>
                <span style={{ border: `1px solid ${EMBRY.border}`, padding: '3px 7px' }}>Progress: 0/{criticalFindings} violations cleared</span>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
              <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 10 }}><div style={label}>COVERAGE SIGNAL</div><strong>{missingCases} unresolved</strong></div>
              <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 10 }}><div style={label}>SOURCE ARTIFACT</div><strong>Evidence case</strong></div>
              <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 10 }}><div style={label}>QRA / TEST</div><strong>{totalCases} cases</strong></div>
              <div style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 10 }}><div style={label}>CONTROL MAPPING</div><strong>{firstRisk?.mapped_controls?.slice(0, 2).join(', ') || blockerId}</strong></div>
            </div>
            {onAnalyzeProofChain && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <button type="button" data-qid="posture:action:review-evidence-case-primary" data-qs-action="POSTURE_REVIEW_EVIDENCE_CASE" aria-label={`Review evidence case for ${blockerId}`} aria-keyshortcuts="Enter Space" title={`Review evidence case for ${blockerId}`} onClick={() => requestEvidenceReview(missingCases, 'Evidence review')} style={{ minHeight: 44, border: `1px solid ${criticalText}`, background: 'rgba(255, 68, 68, 0.14)', color: criticalText, padding: '8px 12px', fontWeight: 900, cursor: 'pointer', boxShadow: '0 0 0 1px rgba(255, 68, 68, 0.18)' }}>Review evidence case for {blockerId}</button>
                <button type="button" data-qid="posture:action:review-all-violations" data-qs-action="POSTURE_REVIEW_ALL_VIOLATIONS" aria-label={`Review all ${criticalFindings} remaining violations`} aria-keyshortcuts="Enter Space" title="Open proof-chain review for all visible remaining violations" onClick={() => requestEvidenceReview(criticalFindings, 'All-violations review')} style={{ minHeight: 44, border: '1px solid rgba(0, 209, 255, 0.35)', background: 'rgba(0, 209, 255, 0.08)', color: '#00d1ff', padding: '8px 12px', fontWeight: 800, cursor: 'pointer' }}>Review all {criticalFindings} violations</button>
                <button type="button" data-qid="posture:action:assign-repair-owner" data-qs-action="POSTURE_ASSIGN_REPAIR_OWNER" aria-label={`Assign repair owner for ${blockerId}`} aria-keyshortcuts="Enter Space" title="Assign repair owner for the first blocker" onClick={() => requestResolutionAction('Repair owner assignment')} style={{ minHeight: 44, border: `1px solid ${EMBRY.border}`, background: EMBRY.bgDeep, color: EMBRY.white, padding: '8px 12px', fontWeight: 800, cursor: 'pointer' }}>Assign repair owner</button>
                <button type="button" data-qid="posture:action:open-source-section" data-qs-action="POSTURE_OPEN_SOURCE_SECTION" aria-label={`Inspect evidence source for ${blockerId}`} aria-keyshortcuts="Enter Space" title="Inspect the source artifact linked to the first blocker evidence case" onClick={() => requestResolutionAction('Evidence source inspection')} style={{ minHeight: 44, border: `1px solid ${EMBRY.border}`, background: EMBRY.bgDeep, color: EMBRY.white, padding: '8px 12px', fontWeight: 800, cursor: 'pointer' }}>Inspect evidence source for {blockerId}</button>
              </div>
            )}
            {blockerQueue.length > 1 && (
              <div data-qid="posture:next-blockers-inline" style={{ display: 'grid', gap: 6 }}>
                <div style={{ ...label, color: '#00d1ff' }}>NEXT BLOCKERS</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
                  {blockerQueue.slice(1, 4).map((row) => (
                    <div key={`inline-${row.entityType}-${row.id}`} data-qid={`posture:next-blocker:${String(row.id).replace(/[^A-Za-z0-9_-]/g, '-').toLowerCase()}`} data-entity-id={row.id} data-entity-type={row.entityType} style={{ border: `1px solid ${EMBRY.border}`, padding: 8, minHeight: 44 }}>
                      <div style={{ color: EMBRY.white, fontWeight: 800, fontSize: 12 }}>{row.rank}. {row.id}</div>
                      <div style={{ color: row.outcome.includes('not') ? criticalText : row.outcome.includes('no') ? '#60a5fa' : EMBRY.amber, fontSize: 11, fontWeight: 800, textTransform: 'uppercase' }}>{row.outcome}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        <section data-qid="posture:blocker-queue" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.3fr) minmax(280px, 0.7fr)', gap: 28 }}>
          <div>
            <div style={{ ...label, color: '#00d1ff', marginBottom: 12 }}>RANKED BLOCKER QUEUE</div>
            {blockerQueue.length === 0
              ? <div style={{ color: EMBRY.dim }}>No current signoff blockers are exposed by /api/posture/v2.</div>
              : <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead><tr>
                    <th style={{ ...label, textAlign: 'left', padding: '8px', borderBottom: `1px solid ${EMBRY.border}` }}>Rank</th>
                    <th style={{ ...label, textAlign: 'left', padding: '8px', borderBottom: `1px solid ${EMBRY.border}` }}>Case</th>
                    <th style={{ ...label, textAlign: 'left', padding: '8px', borderBottom: `1px solid ${EMBRY.border}` }}>Outcome</th>
                    <th style={{ ...label, textAlign: 'left', padding: '8px', borderBottom: `1px solid ${EMBRY.border}` }}>Why ranked here</th>
                  </tr></thead>
                  <tbody>{blockerQueue.map((row) => (
                    <tr key={`${row.entityType}-${row.id}`} data-qid={`posture:blocker-row:${String(row.id).replace(/[^A-Za-z0-9_-]/g, '-').toLowerCase()}`} data-entity-id={row.id} data-entity-type={row.entityType} style={{ borderBottom: `1px solid ${EMBRY.border}` }}>
                      <td style={{ padding: '10px 8px', color: EMBRY.white }}>{row.rank}</td>
                      <td style={{ padding: '10px 8px', color: EMBRY.white, fontWeight: 700 }}>{row.id}</td>
                      <td style={{ padding: '10px 8px', color: row.outcome.includes('not') ? criticalText : row.outcome.includes('no') ? '#60a5fa' : EMBRY.amber, fontWeight: 800 }}>{row.outcome}</td>
                      <td style={{ padding: '10px 8px', color: EMBRY.dim }}>{row.reason}</td>
                    </tr>
                  ))}</tbody>
                </table>}
          </div>
          <div>
            <div style={{ ...label, color: '#00d1ff', marginBottom: 12 }}>SIGNOFF AUDIT TRAIL</div>
            <ul style={{ color: EMBRY.dim, lineHeight: 1.5, paddingLeft: 18, margin: 0 }}>
              <li>Verdict is computed from current evidence cases, freshness, and unresolved findings.</li>
              <li>Signoff remains disabled when evidence is stale, missing, inconclusive, or not satisfied.</li>
              <li>Chat may explain or open artifacts, but it cannot author the signoff verdict.</li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  )
}

// ── Tab 2: Traceability ──

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

  const { loading, error, posture, traceability, assurance } = usePostureData()
  const [activeTab, setActiveTab] = useState<Exclude<Tab, 'Posture'>>('Traceability')

  return (
    <div style={{ background: EMBRY.bg, minHeight: '100%', padding: 20, display: 'grid', gap: 24, alignContent: 'start', overflowY: 'auto' }}>
      {loading && <div style={{ ...label, padding: 20, textAlign: 'center' }}>Loading posture evidence from /api/posture/v2...</div>}
      {error && (
        <section data-qid="posture:error" style={{ border: `1px solid ${EMBRY.red}`, color: EMBRY.red, padding: 12 }}>
          Posture cannot compute a signoff verdict because /api/posture/v2 failed: {String(error)}
        </section>
      )}

      {!loading && !error && <PostureTab {...posture} onNavigateToControl={onNavigateToControl} onAnalyzeProofChain={onAnalyzeProofChain} />}

      {!loading && !error && (
        <section data-qid="posture:secondary-diagnostics" style={{ borderTop: `1px solid ${EMBRY.border}`, paddingTop: 18, display: 'grid', gap: 14 }}>
          <div>
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

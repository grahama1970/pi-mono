import { useState } from 'react'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import { usePostureData } from '../../../hooks/usePostureData'
import type { Framework, Family, RiskControl, BrokenTrace, ClaimReview } from '../../../hooks/usePostureData'
import { EMBRY, card, label, heading } from '../common/EmbryStyle'
import { EvidenceNavigatorButton } from './EvidenceNavigatorButton'

type Props = {
  onNavigateToControl?: (id: string) => void
  onAnalyzeProofChain?: (missingCount: number) => void
}

const tabs = ['Posture', 'Traceability', 'Assurance Case Health'] as const
type Tab = typeof tabs[number]

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

// ── Tab 1: Posture ──

function PostureTab({ postureScore, complianceScore, criticalFindings, openFindings, evidenceFreshness, totalCases, families, riskControls, onNavigateToControl, onAnalyzeProofChain }: {
  postureScore: number; complianceScore: number; criticalFindings: number; openFindings: number
  evidenceFreshness: number; totalCases: number; families: Family[]; riskControls: RiskControl[]
  onNavigateToControl?: (id: string) => void
  onAnalyzeProofChain?: (missingCount: number) => void
}) {
  const missingCases = totalCases - Math.round(totalCases * (postureScore / 100))
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {/* Primary Action Bar - ANALYZE PROOF CHAIN - prominent, full width */}
      {onAnalyzeProofChain && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', background: 'rgba(0, 209, 255, 0.04)', border: '1px solid rgba(0, 209, 255, 0.15)', borderRadius: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'rgba(0, 209, 255, 0.7)', marginBottom: 4 }}>Evidence Gap Analysis</div>
            <div style={{ fontSize: 13, color: '#9ca3af' }}>Posture score {postureScore} with {missingCases} unresolved evidence gaps</div>
          </div>
          <EvidenceNavigatorButton
            onClick={() => onAnalyzeProofChain(missingCases)}
            label="Analyze Proof Chain"
          />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 14 }}>
        <KpiCard qid="posture:kpi:score" title="Posture Score" value={postureScore} delta={`${totalCases} evidence cases evaluated`} deltaType={postureScore >= 70 ? 'up' : 'down'} />
        <KpiCard qid="posture:kpi:compliance" title="Compliance Score" value={complianceScore} delta="Satisfied + partial weight" deltaType={complianceScore >= 70 ? 'up' : 'warn'} />
        <KpiCard qid="posture:kpi:critical" title="Critical Findings" value={criticalFindings} delta="not_satisfied verdicts" deltaType={criticalFindings === 0 ? 'up' : 'down'} />
        <KpiCard qid="posture:kpi:open" title="Open Findings" value={openFindings} delta="Failed + inconclusive" deltaType={openFindings <= 5 ? 'up' : 'warn'} />
        <KpiCard qid="posture:kpi:freshness" title="Evidence Freshness" value={`${evidenceFreshness}%`} delta="Within 90-day window" deltaType={evidenceFreshness >= 80 ? 'up' : 'warn'} />
        <KpiCard qid="posture:kpi:cases" title="Total Cases" value={totalCases} delta="From /create-evidence-case" deltaType="up" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <PanelSection qid="posture:panel:families" title="Control Family Health" desc="Evidence case verdicts aggregated by NIST control family prefix.">
          <div style={{ display: 'grid', gap: 8 }}>
            {families.slice(0, 15).map(f => {
              const satPct = f.total ? Math.round((f.satisfied / f.total) * 100) : 0
              const incPct = f.total ? Math.round((f.inconclusive / f.total) * 100) : 0
              const failPct = f.total ? Math.round((f.failed / f.total) * 100) : 0
              return (
                <div key={f.family} data-qid={`posture:family:${f.family}`} style={{ display: 'grid', gridTemplateColumns: '50px 1fr 80px', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                  <span style={{ ...label, fontWeight: 700 }}>{f.family}</span>
                  <span style={{ height: 12, borderRadius: 999, overflow: 'hidden', background: EMBRY.bgDeep, display: 'flex' }}>
                    <span style={{ width: `${satPct}%`, background: EMBRY.green }} />
                    <span style={{ width: `${incPct}%`, background: EMBRY.amber }} />
                    <span style={{ width: `${failPct}%`, background: EMBRY.red }} />
                  </span>
                  <span style={{ ...label, textAlign: 'right', fontSize: 11 }}>{f.satisfied}/{f.total} sat</span>
                </div>
              )
            })}
          </div>
        </PanelSection>

        <PanelSection qid="posture:panel:risks" title="Top Risk Controls" desc="Controls linked to not_satisfied evidence cases.">
          {riskControls.length === 0
            ? <div style={label}>No failed evidence cases.</div>
            : <div style={{ display: 'grid', gap: 8 }}>
                {riskControls.map((r, i) => (
                  <button key={`${r.control_id}-${i}`} type="button" data-qid={`posture:risk:${r.control_id}`} data-qs-action={`NAVIGATE_RISK_${r.control_id.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`} title={`View risk control ${r.control_id}: ${r.verdict}`} onClick={() => onNavigateToControl?.(r.control_id)} style={{ background: 'transparent', border: `1px solid ${EMBRY.border}`, borderRadius: 8, padding: 12, minHeight: 44, color: EMBRY.white, textAlign: 'left', cursor: 'pointer' }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{r.control_id}</div>
                    <div style={{ ...label, fontSize: 11, color: EMBRY.red }}>{r.grade} — {r.verdict}</div>
                    <div style={{ ...label, fontSize: 11, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.question?.slice(0, 80)}</div>
                  </button>
                ))}
              </div>}
        </PanelSection>
      </div>
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
  useRegisterAction('posture:dashboard', { app: 'sparta-explorer', action: 'SHOW_DASHBOARD', label: 'Show Posture Dashboard', description: 'Display the security posture dashboard' })
  useRegisterAction('posture:tab-switch', { app: 'sparta-explorer', action: 'POSTURE_TAB_SWITCH', label: 'Switch dashboard tab', description: 'Switch between Posture, Traceability, Assurance tabs' })
  useRegisterAction('posture:workflow:analyze-proof-chain', { app: 'sparta-explorer', action: 'POSTURE_WORKFLOW_ANALYZE_PROOF_CHAIN', label: 'Analyze Proof Chain From Workflow', description: 'Run proof-chain analysis from the Brandon workflow guide' })

  const { loading, error, posture, traceability, assurance } = usePostureData()
  const [activeTab, setActiveTab] = useState<Tab>('Posture')
  const missingCases = Math.max(0, posture.totalCases - Math.round(posture.totalCases * (posture.postureScore / 100)))

  return (
    <div style={{ background: EMBRY.bg, minHeight: '100%', padding: 16, display: 'grid', gap: 16, alignContent: 'start' }}>
      {/* Header */}
      <section data-qid="posture:header" style={{ ...card, padding: '18px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20 }}>
        <div>
          <div style={{ color: EMBRY.dim, fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.14em', marginBottom: 10 }}>Evidence-driven compliance view</div>
          <div style={{ ...heading, fontSize: 24 }}>Cybersecurity Posture, Traceability &amp; Assurance</div>
          <div style={{ color: EMBRY.dim, fontSize: 14, marginTop: 8 }}>
            {loading ? 'Loading evidence cases...' : `${posture.totalCases} evidence cases | ${traceability.totalControls.toLocaleString()} controls | ${traceability.totalRelationships.toLocaleString()} relationships`}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ padding: '10px 12px', borderRadius: 999, border: `1px solid ${EMBRY.border}`, color: EMBRY.dim, fontSize: 12, whiteSpace: 'nowrap' }}>
            <strong style={{ color: EMBRY.white }}>Posture:</strong> {posture.postureScore}
          </div>
          <div style={{ padding: '10px 12px', borderRadius: 999, border: `1px solid ${EMBRY.border}`, color: EMBRY.dim, fontSize: 12, whiteSpace: 'nowrap' }}>
            <strong style={{ color: EMBRY.white }}>Traceability:</strong> {traceability.traceabilityScore}
          </div>
          <div style={{ padding: '10px 12px', borderRadius: 999, border: `1px solid ${EMBRY.border}`, color: EMBRY.dim, fontSize: 12, whiteSpace: 'nowrap' }}>
            <strong style={{ color: EMBRY.white }}>Assurance:</strong> {assurance.assuranceScore}
          </div>
        </div>
      </section>


      <section
        data-qid="posture:workflow:guide"
        style={{
          ...card,
          padding: '14px 16px',
          border: '1px solid rgba(0, 209, 255, 0.22)',
          background: 'linear-gradient(180deg, rgba(0, 209, 255, 0.08), rgba(0, 0, 0, 0))',
          display: 'grid',
          gap: 8,
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 800, color: '#00d1ff', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Brandon Assessor Workflow
        </div>
        <div style={{ fontSize: 12, color: EMBRY.dim }}>
          Goal: determine if evidence is audit-defensible today, and identify proof gaps that block certification.
        </div>
        <div style={{ fontSize: 12, color: EMBRY.white }}>1. <strong>Posture</strong>: verify baseline score and failed controls.</div>
        <div style={{ fontSize: 12, color: EMBRY.white }}>2. <strong>Traceability</strong>: inspect broken trace chains and mapping integrity.</div>
        <div style={{ fontSize: 12, color: EMBRY.white }}>3. <strong>Assurance Case Health</strong>: review contradictions and unsupported claims.</div>
        <div style={{ fontSize: 12, color: EMBRY.white }}>4. <strong>Analyze Proof Chain</strong>: drill into unresolved evidence obligations ({missingCases} open).</div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
          <button
            data-qid="posture:workflow:goto-posture"
            data-qs-action="POSTURE_TAB_SWITCH"
            title="Open Posture tab"
            onClick={() => setActiveTab('Posture')}
            style={{ padding: '8px 10px', minHeight: 44, borderRadius: 8, border: `1px solid ${EMBRY.border}`, background: activeTab === 'Posture' ? `${EMBRY.green}22` : EMBRY.bgDeep, color: EMBRY.white, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
          >
            1 · Posture
          </button>
          <button
            data-qid="posture:workflow:goto-traceability"
            data-qs-action="POSTURE_TAB_SWITCH"
            title="Open Traceability tab"
            onClick={() => setActiveTab('Traceability')}
            style={{ padding: '8px 10px', minHeight: 44, borderRadius: 8, border: `1px solid ${EMBRY.border}`, background: activeTab === 'Traceability' ? `${EMBRY.green}22` : EMBRY.bgDeep, color: EMBRY.white, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
          >
            2 · Traceability
          </button>
          <button
            data-qid="posture:workflow:goto-assurance"
            data-qs-action="POSTURE_TAB_SWITCH"
            title="Open Assurance Case Health tab"
            onClick={() => setActiveTab('Assurance Case Health')}
            style={{ padding: '8px 10px', minHeight: 44, borderRadius: 8, border: `1px solid ${EMBRY.border}`, background: activeTab === 'Assurance Case Health' ? `${EMBRY.green}22` : EMBRY.bgDeep, color: EMBRY.white, fontSize: 11, fontWeight: 700, cursor: 'pointer' }}
          >
            3 · Assurance
          </button>
          {onAnalyzeProofChain && (
            <button
              data-qid="posture:workflow:analyze-proof-chain"
              data-qs-action="POSTURE_WORKFLOW_ANALYZE_PROOF_CHAIN"
              title="Analyze unresolved proof obligations"
              onClick={() => onAnalyzeProofChain(missingCases)}
              style={{ padding: '8px 12px', minHeight: 44, borderRadius: 8, border: '1px solid rgba(0, 209, 255, 0.45)', background: 'rgba(0, 209, 255, 0.14)', color: '#00d1ff', fontSize: 11, fontWeight: 800, cursor: 'pointer' }}
            >
              4 · Analyze Proof Chain
            </button>
          )}
        </div>
      </section>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {tabs.map((t, i) => (
          <button
            key={t}
            type="button"
            data-qid={`posture:tab:${t.toLowerCase().replace(/\s+/g, '-')}`}
            data-qs-action="POSTURE_TAB_SWITCH"
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
            {i + 1} · {t}
          </button>
        ))}
      </div>
      {/* Keep proof-chain action available regardless of active tab. */}
      {onAnalyzeProofChain && !loading && (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <EvidenceNavigatorButton
            onClick={() => onAnalyzeProofChain(Math.max(0, posture.totalCases - Math.round(posture.totalCases * (posture.postureScore / 100))))}
            label="Analyze Proof Chain"
          />
        </div>
      )}

      {/* Tab content */}
      {loading && <div style={{ ...label, padding: 20, textAlign: 'center' }}>Loading evidence case data...</div>}
      {!loading && activeTab === 'Posture' && <PostureTab {...posture} onNavigateToControl={onNavigateToControl} onAnalyzeProofChain={onAnalyzeProofChain} />}
      {!loading && activeTab === 'Traceability' && <TraceabilityTab {...traceability} />}
      {!loading && activeTab === 'Assurance Case Health' && <AssuranceTab {...assurance} />}

      {error && <div style={{ ...label, color: EMBRY.red, padding: 8 }}>Error: {String(error)}</div>}
    </div>
  )
}

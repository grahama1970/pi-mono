import { useMemo, useState, useEffect } from 'react'
import { arc as d3Arc, pie as d3Pie } from 'd3-shape'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import { usePostureData } from '../../../hooks/usePostureData'
import { EMBRY, card, label, heading, glowDot, fwBadge } from '../common/EmbryStyle'

type Props = { onNavigateToControl?: (id: string) => void }

const FRAMEWORKS = ['NIST', 'CMMC', 'ISO27001', 'CIS', 'SOC2', 'HIPAA', 'PCI', 'FedRAMP'] as const

function toActionToken(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
}

function Donut({ framework, pct }: { framework: string; pct: number }) {
  const safePct = Math.max(0, Math.min(100, Number.isFinite(pct) ? pct : 0))
  const arcs = useMemo(() => {
    const pieGen = d3Pie<number>().value((d) => d).sort(null)
    const arcGen = d3Arc<any>().innerRadius(24).outerRadius(34).cornerRadius(3)
    return pieGen([safePct, 100 - safePct]).map((a, i) => ({
      d: arcGen(a) ?? '',
      key: i,
      fill: i === 0 ? (EMBRY.fw?.[framework] ?? EMBRY.green) : EMBRY.bg
    }))
  }, [framework, safePct])

  const fwAction = toActionToken(framework)
  return (
    <button
      type="button"
      data-qid={`posture:donut:${framework}`}
      data-qs-action={`POSTURE_SELECT_FRAMEWORK_${fwAction}`}
      title={`Select ${framework} framework`}
      style={{ ...card, background: EMBRY.bgCard, padding: 10, border: `1px solid ${EMBRY.border}`, display: 'grid', placeItems: 'center', gap: 6, cursor: 'pointer' }}
    >
      <svg width={80} height={80} viewBox="-40 -40 80 80" role="img" aria-label={`${framework} ${safePct}%`}>
        {arcs.map((a) => (
          <path key={a.key} d={a.d} fill={a.fill} />
        ))}
      </svg>
      <div style={{ ...fwBadge }}>{framework}</div>
      <div style={{ ...label }}>{safePct.toFixed(0)}%</div>
    </button>
  )
}

export default function PostureDashboard({ onNavigateToControl }: Props) {
  useRegisterAction('sparta-show-dashboard', { app: 'sparta-explorer', action: 'SHOW_DASHBOARD', label: 'Show Posture Dashboard', description: 'Display the security posture dashboard with coverage ring, drift alerts, and discrepancies' })
  useRegisterAction('sparta-posture-select-framework', { app: 'sparta-explorer', action: 'POSTURE_SELECT_FRAMEWORK', label: 'Select framework donut', description: 'Select framework from donut ring' })
  useRegisterAction('sparta-posture-select-family', { app: 'sparta-explorer', action: 'POSTURE_SELECT_FAMILY', label: 'Select NIST family', description: 'Open family flyout from stacked bar' })
  useRegisterAction('sparta-posture-view-gap', { app: 'sparta-explorer', action: 'POSTURE_VIEW_GAP', label: 'View gap detail', description: 'Inspect gap analysis type row' })
  useRegisterAction('sparta-posture-view-alert', { app: 'sparta-explorer', action: 'POSTURE_VIEW_ALERT', label: 'View drift alert', description: 'Inspect drift alert row' })
  useRegisterAction('sparta-posture-view-risk', { app: 'sparta-explorer', action: 'POSTURE_VIEW_RISK', label: 'View risk control', description: 'Open top risk control detail' })

  const { loading, error, frameworkScores, familyBreakdown, gapAnalysis, driftAlerts, topRiskControls, postureScore, postureDelta } = usePostureData()
  const [selectedFamily, setSelectedFamily] = useState<string | null>(null)

  useRegisterAction('sparta-posture-flyout-close', { app: 'sparta-explorer', action: 'POSTURE_FLYOUT_CLOSE', label: 'Close family flyout', description: 'Close selected family flyout panel' })
  useRegisterAction('sparta-posture-flyout-select-control', { app: 'sparta-explorer', action: 'POSTURE_FLYOUT_SELECT_CONTROL', label: 'Select control from family flyout', description: 'Navigate to control from family flyout table' })
  const frameworks = useMemo(() => FRAMEWORKS.map((fw) => {
    const match = frameworkScores?.find((f: any) => String(f.framework || f.name || '').toUpperCase() === fw.toUpperCase())
    return { framework: fw, pct: match?.pct ?? 0 }
  }), [frameworkScores])

  const families = (familyBreakdown ?? []).slice(0, 15)
  const risks = (topRiskControls ?? []).slice(0, 10)
  const gaps = (gapAnalysis ?? []).slice(0, 5)
  const alerts = driftAlerts ?? []
  const safeScore = Number.isFinite(postureScore) ? postureScore : 0
  const safeDelta = Number.isFinite(postureDelta) ? postureDelta : 0

  return (
    <div style={{ background: EMBRY.bg, minHeight: '100%', padding: 16, display: 'grid', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 2fr', gap: 16 }}>
        <section style={{ ...card, background: EMBRY.bgCard, border: `1px solid ${EMBRY.border}`, padding: 16 }}>

  const selectedFamilyData = useMemo(() => {
    if (!selectedFamily) return null
    return families.find((f: any) => String(f.family ?? 'UNK') === selectedFamily) ?? null
  }, [families, selectedFamily])

  const selectedFamilyControls = useMemo(() => {
    const raw = (selectedFamilyData as any)?.controls ?? (selectedFamilyData as any)?.items ?? []
    return Array.isArray(raw) ? raw : []
  }, [selectedFamilyData])

  const flyoutPass = Number((selectedFamilyData as any)?.pass ?? (selectedFamilyData as any)?.passCount ?? 0)
  const flyoutPartial = Number((selectedFamilyData as any)?.partial ?? (selectedFamilyData as any)?.partialCount ?? 0)
  const flyoutFail = Number((selectedFamilyData as any)?.fail ?? (selectedFamilyData as any)?.failCount ?? 0)
  const flyoutTotal = Number((selectedFamilyData as any)?.total ?? selectedFamilyControls.length ?? 0)

  useEffect(() => {
    if (!selectedFamily) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelectedFamily(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedFamily])
          <div style={{ ...label }}>Overall Posture</div>
          <div style={{ ...heading, fontSize: 56, lineHeight: 1, color: EMBRY.green, textShadow: `0 0 16px ${EMBRY.green}` }}>{safeScore.toFixed(0)}</div>
          <div title="Posture delta over previous period" style={{ ...label, display: 'inline-flex', alignItems: 'center', gap: 6, background: EMBRY.bg, border: `1px solid ${safeDelta >= 0 ? EMBRY.green : EMBRY.red}`, borderRadius: 999, padding: '4px 10px' }}>
            <span style={{ ...(safeDelta >= 0 ? glowDot('pass') : glowDot('fail')) }} />
            <span>{safeDelta >= 0 ? '+' : ''}{safeDelta.toFixed(1)} pts</span>
          </div>
        </section>

        <section style={{ ...card, background: EMBRY.bgCard, border: `1px solid ${EMBRY.border}`, padding: 12 }}>
          <div style={{ ...heading, marginBottom: 8 }}>Framework Coverage</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
            {frameworks.map((f) => <Donut key={f.framework} framework={f.framework} pct={f.pct} />)}
          </div>
        </section>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <section style={{ ...card, background: EMBRY.bgCard, border: `1px solid ${EMBRY.border}`, padding: 12 }}>
          <div style={{ ...heading, marginBottom: 10 }}>NIST 800-53 Families</div>
          {families.length === 0 ? <div style={{ ...label, padding: 12 }}>{loading ? 'Loading family data…' : 'No family data available.'}</div> : <div style={{ display: 'grid', gap: 8 }}>
            {families.map((f: any) => {
              const pass = Math.max(0, Math.min(100, f.pct ?? 0))
              const partial = Math.max(0, Math.min(100 - pass, ((f.withRels ?? 0) / Math.max(1, f.total ?? 1)) * 100))
              const fail = Math.max(0, 100 - pass - partial)
              const fam = String(f.family ?? 'UNK')
              const famAction = toActionToken(fam)
              return (
                <button
                  key={fam}
                  type="button"
                  data-qid={`posture:family:${fam}`}
                  data-qs-action={`POSTURE_SELECT_FAMILY_${famAction}`}
                  title={`Select ${fam} family`}
                  onClick={() => setSelectedFamily(fam)}
                  style={{ display: 'grid', gridTemplateColumns: '140px 1fr 56px', alignItems: 'center', gap: 10, background: 'transparent', border: `1px solid ${selectedFamily === fam ? EMBRY.green : EMBRY.border}`, borderRadius: 8, padding: '6px 8px', cursor: 'pointer', color: EMBRY.text }}
                >
                  <span style={{ ...label, textAlign: 'left' }}>{fam}</span>
                  <span style={{ height: 10, borderRadius: 999, overflow: 'hidden', background: EMBRY.bg, display: 'flex' }}>
                    <span style={{ width: `${pass}%`, background: EMBRY.green }} />
                    <span style={{ width: `${partial}%`, background: EMBRY.amber }} />
                    <span style={{ width: `${fail}%`, background: EMBRY.red }} />
                  </span>
                  <span style={{ ...label, textAlign: 'right' }}>{pass.toFixed(0)}%</span>
                </button>
              )
            })}
          </div>}
          {selectedFamily && <div title={`Family flyout ${selectedFamily}`} style={{ ...label, marginTop: 10, padding: 10, border: `1px solid ${EMBRY.border}`, borderRadius: 8 }}>Selected family: {selectedFamily}</div>}
        </section>

        <section style={{ ...card, background: EMBRY.bgCard, border: `1px solid ${EMBRY.border}`, padding: 12 }}>
          <div style={{ ...heading, marginBottom: 10 }}>Gap Analysis</div>
          {gaps.length === 0 ? <div style={{ ...label }}>{loading ? 'Loading gap analysis…' : 'No gap data available.'}</div> : <div style={{ display: 'grid', gap: 8 }}>
            {gaps.map((g: any, idx: number) => {
          {selectedFamily && <div data-qid="posture:flyout:hint" data-qs-action="POSTURE_FLYOUT_OPEN" title={`Family flyout ${selectedFamily}`} style={{ ...label, marginTop: 10, padding: 10, border: `1px solid ${EMBRY.border}`, borderRadius: 8 }}>Selected family: {selectedFamily}</div>}
              const action = toActionToken(type)
              return (
                <button
                  key={`${type}-${idx}`}
                  type="button"
                  data-qid={`posture:gap:${type}`}
                  data-qs-action={`POSTURE_VIEW_GAP_${action}`}
                  title={`View gap ${type}`}
                  style={{ background: 'transparent', border: `1px solid ${EMBRY.border}`, borderRadius: 8, padding: 8, color: EMBRY.text, textAlign: 'left', cursor: 'pointer' }}
                >
                  <div style={{ ...label }}>{type}</div>
                  <div style={{ ...label }}>Control: {g.control_id ?? 'N/A'}</div>
                </button>
              )
            })}
          </div>}
        </section>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.9fr', gap: 16 }}>
        <section style={{ ...card, background: EMBRY.bgCard, border: `1px solid ${EMBRY.border}`, padding: 12 }}>
          <div style={{ ...heading, marginBottom: 10 }}>Drift Alerts</div>
          {alerts.length === 0 ? <div style={{ ...label }}>{loading ? 'Loading drift alerts…' : 'No drift alerts.'}</div> : <div style={{ display: 'grid', gap: 8 }}>
            {alerts.map((a: any, idx: number) => {
              const id = String(a.control_id ?? `alert-${idx}`)
              const sev = String(a.severity ?? 'partial').toLowerCase()
              const state = sev.includes('high') || sev.includes('fail') ? 'fail' : sev.includes('med') || sev.includes('partial') ? 'partial' : 'pass'
              const action = toActionToken(id)
              return (
                <button
                  key={id}
                  type="button"
                  data-qid={`posture:alert:${id}`}
                  data-qs-action={`POSTURE_VIEW_ALERT_${action}`}
                  title={`View alert ${id}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: `1px solid ${EMBRY.border}`, borderRadius: 8, padding: 8, color: EMBRY.text, cursor: 'pointer', textAlign: 'left' }}
                >
                  <span style={{ ...glowDot(state as any) }} />
                  <span style={{ ...label }}>{id}</span>
                  <span style={{ ...label, marginLeft: 'auto' }}>{sev}</span>
                </button>
              )
            })}
          </div>}
        </section>

        <section style={{ ...card, background: EMBRY.bgCard, border: `1px solid ${EMBRY.border}`, padding: 12 }}>
          <div style={{ ...heading, marginBottom: 10 }}>Top 10 Risk Controls</div>
          {risks.length === 0 ? <div style={{ ...label }}>{loading ? 'Loading risk controls…' : 'No risk controls available.'}</div> : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ ...label, textAlign: 'left', padding: 6 }}>Control</th>
                <th style={{ ...label, textAlign: 'left', padding: 6 }}>Framework</th>
                <th style={{ ...label, textAlign: 'right', padding: 6 }}>Risk</th>
              </tr>
            </thead>
            <tbody>
              {risks.map((r: any, idx: number) => {
                const id = String(r.control_id ?? `risk-${idx}`)
                const action = toActionToken(id)

      {selectedFamily ? <div
        data-qid="posture:flyout:backdrop"
        data-qs-action="POSTURE_FLYOUT_BACKDROP"
        title="Family flyout backdrop"
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)' }}
        onClick={() => setSelectedFamily(null)}
      /> : null}

      {selectedFamily ? <aside
        data-qid="posture:flyout:panel"
        data-qs-action="POSTURE_FLYOUT_OPEN"
        title="Family controls flyout"
        style={{ position: 'fixed', top: 0, right: 0, width: 'min(720px, 92vw)', height: '100vh', background: EMBRY.bgCard, borderLeft: `1px solid ${EMBRY.border}`, boxShadow: '-8px 0 24px rgba(0,0,0,0.35)', padding: 16, overflow: 'auto', zIndex: 20, display: 'grid', gap: 12, alignContent: 'start' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <div>
            <div data-qid="posture:flyout:family" data-qs-action="POSTURE_FLYOUT_VIEW_FAMILY" title="Selected family" style={{ ...heading }}>{selectedFamily}</div>
            <div data-qid="posture:flyout:summary" data-qs-action="POSTURE_FLYOUT_VIEW_SUMMARY" title="Family control summary" style={{ ...label }}>Total: {flyoutTotal} • Pass: {flyoutPass} • Partial: {flyoutPartial} • Fail: {flyoutFail}</div>
          </div>
          <button
            type="button"
            data-qid="posture:flyout:close"
            data-qs-action="POSTURE_FLYOUT_CLOSE"
            title="Close family flyout"
            onClick={() => setSelectedFamily(null)}
            style={{ border: `1px solid ${EMBRY.border}`, background: 'transparent', color: EMBRY.text, borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}
          >
            Close
          </button>
        </div>

        <div data-qid="posture:flyout:table-wrap" data-qs-action="POSTURE_FLYOUT_VIEW_TABLE" title="Family controls table" style={{ border: `1px solid ${EMBRY.border}`, borderRadius: 8, overflow: 'hidden' }}>
          <table data-qid="posture:flyout:table" data-qs-action="POSTURE_FLYOUT_VIEW_TABLE" title="Controls in selected family" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: EMBRY.bg }}>
                <th data-qid="posture:flyout:col-control-id" data-qs-action="POSTURE_FLYOUT_VIEW_COLUMN" title="Control ID column" style={{ ...label, textAlign: 'left', padding: 8 }}>Control ID</th>
                <th data-qid="posture:flyout:col-name" data-qs-action="POSTURE_FLYOUT_VIEW_COLUMN" title="Control name column" style={{ ...label, textAlign: 'left', padding: 8 }}>Name</th>
                <th data-qid="posture:flyout:col-nrs" data-qs-action="POSTURE_FLYOUT_VIEW_COLUMN" title="NRS column" style={{ ...label, textAlign: 'right', padding: 8 }}>NRS</th>
                <th data-qid="posture:flyout:col-qra" data-qs-action="POSTURE_FLYOUT_VIEW_COLUMN" title="QRA count column" style={{ ...label, textAlign: 'right', padding: 8 }}>QRA</th>
                <th data-qid="posture:flyout:col-weakness" data-qs-action="POSTURE_FLYOUT_VIEW_COLUMN" title="Weakness count column" style={{ ...label, textAlign: 'right', padding: 8 }}>Weakness</th>
              </tr>
            </thead>
            <tbody>
              {selectedFamilyControls.length === 0 ? <tr>
                <td data-qid="posture:flyout:empty" data-qs-action="POSTURE_FLYOUT_VIEW_EMPTY" title="No controls available" colSpan={5} style={{ ...label, padding: 10 }}>No controls for this family.</td>
              </tr> : selectedFamilyControls.map((c: any, idx: number) => {
                const id = String(c.control_id ?? c.id ?? `${selectedFamily}-${idx}`)
                const action = toActionToken(id)
                return <tr key={id}>
                  <td colSpan={5} style={{ padding: 0 }}>
                    <button
                      type="button"
                      data-qid={`posture:flyout:control:${id}`}
                      data-qs-action={`POSTURE_FLYOUT_SELECT_CONTROL_${action}`}
                      title={`Open control ${id}`}
                      onClick={() => onNavigateToControl?.(id)}
                      style={{ width: '100%', display: 'grid', gridTemplateColumns: '1.2fr 2fr 80px 100px 120px', gap: 8, border: 0, borderTop: `1px solid ${EMBRY.border}`, background: 'transparent', color: EMBRY.text, padding: 8, textAlign: 'left', cursor: 'pointer' }}
                    >
                      <span style={{ ...label }}>{id}</span>
                      <span style={{ ...label }}>{String(c.name ?? c.title ?? 'Untitled')}</span>
                      <span style={{ ...label, textAlign: 'right' }}>{Number(c.nrs ?? 0).toFixed ? Number(c.nrs ?? 0).toFixed(1) : c.nrs ?? 0}</span>
                      <span style={{ ...label, textAlign: 'right' }}>{Number(c.qraCount ?? c.qra_count ?? 0)}</span>
                      <span style={{ ...label, textAlign: 'right' }}>{Number(c.weaknessCount ?? c.weakness_count ?? 0)}</span>
                    </button>
                  </td>
                </tr>
              })}
            </tbody>
          </table>
        </div>
      </aside> : null}
                return (
                  <tr key={id}>
                    <td colSpan={3} style={{ padding: 0 }}>
                      <button
                        type="button"
                        data-qid={`posture:risk:${id}`}
                        data-qs-action={`POSTURE_VIEW_RISK_${action}`}
                        title={`View risk control ${id}`}
                        onClick={() => onNavigateToControl?.(id)}
                        style={{ width: '100%', display: 'grid', gridTemplateColumns: '2fr 1fr 70px', gap: 8, alignItems: 'center', background: 'transparent', color: EMBRY.text, border: `1px solid ${EMBRY.border}`, borderRadius: 8, marginBottom: 6, padding: 8, cursor: 'pointer', textAlign: 'left' }}
                      >
                        <span style={{ ...label }}>{id}</span>
                        <span style={{ ...label }}>{r.source_framework ?? 'N/A'}</span>
                        <span style={{ ...label, textAlign: 'right' }}>{(r.riskScore ?? 0).toFixed ? (r.riskScore ?? 0).toFixed(1) : r.riskScore ?? 0}</span>
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>}
          {error ? <div style={{ ...label, color: EMBRY.red, marginTop: 8 }}>Error: {String(error)}</div> : null}
        </section>
      </div>
    </div>
  )
}

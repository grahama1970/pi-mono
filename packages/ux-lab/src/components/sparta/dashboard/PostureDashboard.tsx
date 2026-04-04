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
      fill: i === 0 ? (EMBRY.fw?.[framework] ?? EMBRY.green) : EMBRY.bgDeep,
    }))
  }, [framework, safePct])

  return (
    <button
      type="button"
      data-qid={`posture:donut:${framework}`}
      data-qs-action={`POSTURE_SELECT_FRAMEWORK_${toActionToken(framework)}`}
      title={`Select ${framework} framework`}
      style={{ ...card, background: EMBRY.bgCard, padding: 10, display: 'grid', placeItems: 'center', gap: 6, cursor: 'pointer' }}
    >
      <svg width={80} height={80} viewBox="-40 -40 80 80" role="img" aria-label={`${framework} ${safePct}%`}>
        {arcs.map((a) => <path key={a.key} d={a.d} fill={a.fill} />)}
      </svg>
      <div style={fwBadge(framework)}>{framework}</div>
      <div style={label}>{safePct.toFixed(0)}%</div>
    </button>
  )
}

export default function PostureDashboard({ onNavigateToControl }: Props) {
  useRegisterAction('posture:dashboard', { app: 'sparta-explorer', action: 'SHOW_DASHBOARD', label: 'Show Posture Dashboard', description: 'Display the security posture dashboard' })
  useRegisterAction('posture:select-framework', { app: 'sparta-explorer', action: 'POSTURE_SELECT_FRAMEWORK', label: 'Select framework donut', description: 'Select framework from donut ring' })
  useRegisterAction('posture:select-family', { app: 'sparta-explorer', action: 'POSTURE_SELECT_FAMILY', label: 'Select NIST family', description: 'Open family flyout from stacked bar' })
  useRegisterAction('posture:view-gap', { app: 'sparta-explorer', action: 'POSTURE_VIEW_GAP', label: 'View gap detail', description: 'Inspect gap analysis row' })
  useRegisterAction('posture:view-alert', { app: 'sparta-explorer', action: 'POSTURE_VIEW_ALERT', label: 'View drift alert', description: 'Inspect drift alert row' })
  useRegisterAction('posture:view-risk', { app: 'sparta-explorer', action: 'POSTURE_VIEW_RISK', label: 'View risk control', description: 'Open top risk control detail' })
  useRegisterAction('posture:flyout-close', { app: 'sparta-explorer', action: 'POSTURE_FLYOUT_CLOSE', label: 'Close family flyout', description: 'Close selected family flyout panel' })
  useRegisterAction('posture:flyout-select-control', { app: 'sparta-explorer', action: 'POSTURE_FLYOUT_SELECT_CONTROL', label: 'Select control from flyout', description: 'Navigate to control from family flyout' })

  const { loading, error, frameworkCoverage, overallScore, controlsByFamily, gaps, topRisks, driftAlerts } = usePostureData()
  const [selectedFamily, setSelectedFamily] = useState<string | null>(null)

  const frameworks = useMemo(() => FRAMEWORKS.map((fw) => {
    const fc = frameworkCoverage?.[fw]
    return { framework: fw, pct: fc?.pct ?? 0 }
  }), [frameworkCoverage])

  const families = useMemo(() => {
    if (Array.isArray(controlsByFamily)) return controlsByFamily.slice(0, 15)
    return Object.values(controlsByFamily ?? {}).slice(0, 15)
  }, [controlsByFamily])

  const risks = (topRisks ?? []).slice(0, 10)
  const gapList = (gaps ?? []).slice(0, 5)
  const alerts = driftAlerts ?? []
  const safeScore = Number.isFinite(overallScore) ? overallScore : 0

  const selectedFamilyData = useMemo(() => {
    if (!selectedFamily) return null
    return families.find((f) => String(f.family ?? '') === selectedFamily) ?? null
  }, [families, selectedFamily])

  useEffect(() => {
    if (!selectedFamily) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setSelectedFamily(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedFamily])

  return (
    <div style={{ background: EMBRY.bg, minHeight: '100%', padding: 16, display: 'grid', gap: 16 }}>
      {/* Row 1: Score + Framework Donuts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 2fr', gap: 16 }}>
        <section style={{ ...card, display: 'grid', placeItems: 'center', gap: 8 }}>
          <div style={label}>OVERALL POSTURE SCORE</div>
          <div style={{ ...heading, fontSize: 56, lineHeight: 1, color: EMBRY.green, textShadow: `0 0 16px ${EMBRY.green}` }}>
            {safeScore.toFixed(0)}
          </div>
        </section>
        <section style={{ ...card, padding: 12 }}>
          <div style={{ ...heading, marginBottom: 8 }}>Framework Coverage</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
            {frameworks.map((f) => <Donut key={f.framework} framework={f.framework} pct={f.pct} />)}
          </div>
        </section>
      </div>

      {/* Row 2: NIST Families + Gap Analysis */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        <section style={{ ...card, padding: 12 }}>
          <div style={{ ...heading, marginBottom: 10 }}>NIST 800-53 Families</div>
          {families.length === 0
            ? <div style={label}>{loading ? 'Loading…' : 'No family data.'}</div>
            : <div style={{ display: 'grid', gap: 6 }}>
                {families.map((f) => {
                  const fam = String(f.family ?? 'UNK')
                  const pass = Math.max(0, Math.min(100, f.pct ?? 0))
                  const partial = Math.max(0, Math.min(100 - pass, 20))
                  const fail = Math.max(0, 100 - pass - partial)
                  return (
                    <button key={fam} type="button" data-qid={`posture:family:${fam}`} data-qs-action={`POSTURE_SELECT_FAMILY_${toActionToken(fam)}`} title={`Select ${fam} family`} onClick={() => setSelectedFamily(fam)} style={{ display: 'grid', gridTemplateColumns: '50px 1fr 50px', alignItems: 'center', gap: 8, background: 'transparent', border: `1px solid ${selectedFamily === fam ? EMBRY.green : EMBRY.border}`, borderRadius: 8, padding: '6px 8px', cursor: 'pointer', color: EMBRY.white }}>
                      <span style={label}>{fam}</span>
                      <span style={{ height: 10, borderRadius: 999, overflow: 'hidden', background: EMBRY.bgDeep, display: 'flex' }}>
                        <span style={{ width: `${pass}%`, background: EMBRY.green }} />
                        <span style={{ width: `${partial}%`, background: EMBRY.amber }} />
                        <span style={{ width: `${fail}%`, background: EMBRY.red }} />
                      </span>
                      <span style={{ ...label, textAlign: 'right' }}>{pass.toFixed(0)}%</span>
                    </button>
                  )
                })}
              </div>}
        </section>
        <section style={{ ...card, padding: 12 }}>
          <div style={{ ...heading, marginBottom: 10 }}>Gap Analysis</div>
          {gapList.length === 0
            ? <div style={label}>{loading ? 'Loading…' : 'No gaps detected.'}</div>
            : <div style={{ display: 'grid', gap: 6 }}>
                {gapList.map((g, idx) => {
                  const type = g.reason ?? (g.qraCount === 0 ? 'missing-qra' : 'missing-rel')
                  return (
                    <button key={`${g.control_id}-${idx}`} type="button" data-qid={`posture:gap:${type}`} data-qs-action={`POSTURE_VIEW_GAP_${toActionToken(type)}`} title={`View gap: ${type}`} style={{ background: 'transparent', border: `1px solid ${EMBRY.border}`, borderRadius: 8, padding: 8, color: EMBRY.white, textAlign: 'left', cursor: 'pointer' }}>
                      <div style={{ ...label, color: EMBRY.amber }}>{type}</div>
                      <div style={label}>{g.control_id ?? 'N/A'} — {g.name ?? ''}</div>
                    </button>
                  )
                })}
              </div>}
        </section>
      </div>

      {/* Row 3: Drift Alerts + Top Risks */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.1fr 1.9fr', gap: 16 }}>
        <section style={{ ...card, padding: 12 }}>
          <div style={{ ...heading, marginBottom: 10 }}>Drift Alerts</div>
          {alerts.length === 0
            ? <div style={label}>{loading ? 'Loading…' : 'No drift alerts.'}</div>
            : <div style={{ display: 'grid', gap: 6 }}>
                {alerts.map((a, idx) => {
                  const id = String(a.control_id ?? `alert-${idx}`)
                  const sev = String(a.severity ?? 'warning').toLowerCase()
                  const dotColor = sev.includes('critical') ? EMBRY.red : sev.includes('warning') ? EMBRY.amber : EMBRY.green
                  return (
                    <button key={id} type="button" data-qid={`posture:alert:${id}`} data-qs-action={`POSTURE_VIEW_ALERT_${toActionToken(id)}`} title={`View alert ${id}: ${sev}`} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'transparent', border: `1px solid ${EMBRY.border}`, borderRadius: 8, padding: 8, color: EMBRY.white, cursor: 'pointer', textAlign: 'left' }}>
                      <span style={glowDot(dotColor)} />
                      <span style={label}>{id}</span>
                      <span style={{ ...label, marginLeft: 'auto' }}>{sev}</span>
                    </button>
                  )
                })}
              </div>}
        </section>
        <section style={{ ...card, padding: 12 }}>
          <div style={{ ...heading, marginBottom: 10 }}>Top 10 Risk Controls</div>
          {risks.length === 0
            ? <div style={label}>{loading ? 'Loading…' : 'No risk controls.'}</div>
            : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  <th style={{ ...label, textAlign: 'left', padding: 6 }}>Control</th>
                  <th style={{ ...label, textAlign: 'left', padding: 6 }}>Framework</th>
                  <th style={{ ...label, textAlign: 'right', padding: 6 }}>NRS</th>
                </tr></thead>
                <tbody>{risks.map((r, idx) => {
                  const id = String(r.control_id ?? `risk-${idx}`)
                  const nrs = Number(r.nrs_score ?? 0)
                  const nrsColor = nrs >= 0.8 ? EMBRY.green : nrs >= 0.6 ? EMBRY.amber : EMBRY.red
                  return (
                    <tr key={id} data-qid={`posture:risk:${id}`} data-qs-action={`POSTURE_VIEW_RISK_${toActionToken(id)}`} title={`View risk control ${id}`} onClick={() => onNavigateToControl?.(id)} style={{ cursor: 'pointer', borderBottom: `1px solid ${EMBRY.border}` }}>
                      <td style={{ padding: 8, color: EMBRY.white, fontSize: 12 }}>{id}</td>
                      <td style={{ padding: 8, color: EMBRY.dim, fontSize: 12 }}>{r.source_framework ?? 'N/A'}</td>
                      <td style={{ padding: 8, textAlign: 'right', color: nrsColor, fontWeight: 700, fontSize: 12 }}>{nrs.toFixed(2)}</td>
                    </tr>
                  )
                })}</tbody>
              </table>}
        </section>
      </div>

      {/* Family Flyout */}
      {selectedFamily && <>
        <div data-qid="posture:flyout:backdrop" data-qs-action="POSTURE_FLYOUT_BACKDROP" title="Close family flyout" onClick={() => setSelectedFamily(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 19 }} />
        <aside data-qid="posture:flyout:panel" data-qs-action="POSTURE_FLYOUT_OPEN" title={`${selectedFamily} family controls`} style={{ position: 'fixed', top: 0, right: 0, width: 'min(720px, 92vw)', height: '100vh', background: EMBRY.bgCard, borderLeft: `1px solid ${EMBRY.border}`, boxShadow: '-8px 0 24px rgba(0,0,0,0.35)', padding: 16, overflow: 'auto', zIndex: 20, display: 'grid', gap: 12, alignContent: 'start' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div data-qid="posture:flyout:family" data-qs-action="POSTURE_FLYOUT_VIEW_FAMILY" title="Selected family" style={heading}>{selectedFamily}</div>
              <div data-qid="posture:flyout:summary" data-qs-action="POSTURE_FLYOUT_VIEW_SUMMARY" title="Family summary" style={label}>Total: {selectedFamilyData?.total ?? 0} | Pass: {selectedFamilyData?.pct ?? 0}%</div>
            </div>
            <button type="button" data-qid="posture:flyout:close" data-qs-action="POSTURE_FLYOUT_CLOSE" title="Close family flyout" onClick={() => setSelectedFamily(null)} style={{ border: `1px solid ${EMBRY.border}`, background: 'transparent', color: EMBRY.white, borderRadius: 8, padding: '6px 10px', cursor: 'pointer' }}>Close</button>
          </div>
          <div style={label}>Detail controls for {selectedFamily} will load when data wiring is complete.</div>
        </aside>
      </>}

      {error && <div style={{ ...label, color: EMBRY.red, padding: 8 }}>Error: {String(error)}</div>}
    </div>
  )
}

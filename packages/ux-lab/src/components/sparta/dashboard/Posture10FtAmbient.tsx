import { useMemo } from 'react'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import type { Family, RiskControl } from '../../../hooks/usePostureData'

type Props = {
  criticalFindings: number
  openFindings: number
  evidenceFreshness: number
  totalCases: number
  families: Family[]
  riskControls: RiskControl[]
  onOpenBlocker: (id: string) => void
}

const C = {
  bg: '#050505',
  panel: '#0a0a0c',
  white: '#ffffff',
  dim: 'rgba(255,255,255,0.62)',
  muted: 'rgba(255,255,255,0.40)',
  faint: 'rgba(255,255,255,0.10)',
  red: '#ef4444',
  yellow: '#eab308',
  green: '#22c55e',
}

function MacroTelemetry({ label, value, status, tone, bordered = false }: {
  label: string
  value: string
  status: string
  tone: string
  bordered?: boolean
}) {
  return (
    <div style={{ display: 'grid', gap: 10, minWidth: 0, paddingLeft: bordered ? 30 : 0, borderLeft: bordered ? `1px solid ${C.faint}` : 'none' }}>
      <span style={{ color: C.muted, fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: 18 }}>
        <strong style={{ color: C.white, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 42, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{value}</strong>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: tone, fontSize: 11, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          <span aria-hidden="true" style={{ width: 7, height: 7, background: tone, boxShadow: `0 0 7px ${tone}88` }} />
          {status}
        </span>
      </div>
    </div>
  )
}

export function Posture10FtAmbient({
  criticalFindings,
  openFindings,
  evidenceFreshness,
  totalCases,
  families,
  riskControls,
  onOpenBlocker,
}: Props) {
  useRegisterAction('posture:ambient:review-top-blocker', {
    app: 'sparta-explorer',
    action: 'POSTURE_REVIEW_TOP_BLOCKER',
    label: 'Review top signoff blocker',
    description: 'Open the highest-ranked signoff blocker in the Posture lean-in view',
  })

  const noCaseControls = useMemo(() => families.reduce((sum, family) => sum + family.noEvidence, 0), [families])
  const evidenceGaps = noCaseControls
  const topBlocker = riskControls[0]
  const topBlockerId = String(topBlocker?.finding_id ?? topBlocker?.control_id ?? 'NO-BLOCKER-ID')
  const topBlockerText = topBlocker?.question || topBlocker?.name || 'No ranked signoff blocker is exposed by the current posture response.'
  const verdict = totalCases === 0
    ? 'INSUFFICIENT EVIDENCE'
    : criticalFindings > 0
      ? 'NOT SIGNOFF-READY'
      : openFindings > 0 || evidenceGaps > 0
        ? 'DEGRADED'
        : 'SIGNOFF-READY'
  const blocking = verdict !== 'SIGNOFF-READY'
  const verdictTone = verdict === 'SIGNOFF-READY' ? C.green : verdict === 'NOT SIGNOFF-READY' ? C.red : C.yellow
  const gapSummary = evidenceGaps > 0 ? `${evidenceGaps.toLocaleString()} no-case controls` : 'no no-case controls'

  return (
    <section
      data-qid="posture:ambient:root"
      aria-label="Posture ambient signoff status"
      style={{ width: '100%', height: '100%', minHeight: 0, boxSizing: 'border-box', background: C.bg, color: C.white, padding: 'clamp(22px, 2vw, 30px)', display: 'grid', gridTemplateRows: 'auto minmax(260px, 1fr) auto', gap: 24, overflow: 'hidden', userSelect: 'none', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: 30, paddingBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.18)' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: C.muted, fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 6 }}>Posture / Signoff Status</div>
          <h1 style={{ color: C.white, margin: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 28, lineHeight: 1, fontWeight: 900, letterSpacing: '0', textTransform: 'uppercase' }}>F-36 Mission Systems</h1>
        </div>
        <div style={{ display: 'flex', gap: 32, flexShrink: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', textTransform: 'uppercase' }}>
          {[
            { label: 'Gate', value: 'F', color: C.white },
            { label: 'Updated', value: 'NO SERVER TIME', color: C.yellow },
            { label: 'Assessor', value: 'BRANDON BAILEY', color: C.white },
            { label: 'Evidence snapshot', value: totalCases > 0 ? `${evidenceFreshness}% FRESH` : 'NO CASES', color: evidenceFreshness >= 80 ? C.green : C.yellow },
          ].map((item) => (
            <div key={item.label} style={{ display: 'grid', justifyItems: 'end', gap: 4 }}>
              <span style={{ color: C.muted, fontSize: 10, fontWeight: 800, letterSpacing: '0.08em' }}>{item.label}</span>
              <strong style={{ color: item.color, fontSize: 12, fontWeight: 900, whiteSpace: 'nowrap' }}>{item.value}</strong>
            </div>
          ))}
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 250px', gap: 28, minHeight: 0 }}>
        <section style={{ minWidth: 0, padding: 'clamp(24px, 2.4vw, 38px)', display: 'grid', alignContent: 'stretch', gap: 22, background: `${verdictTone}0d`, border: `1px solid ${verdictTone}40` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
            <span aria-hidden="true" style={{ width: 12, height: 12, flexShrink: 0, background: verdictTone, boxShadow: `0 0 12px ${verdictTone}cc`, animation: blocking ? 'posture-ambient-pulse 2.4s ease-in-out infinite' : 'none' }} />
            <h2 style={{ color: verdictTone, margin: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 38, lineHeight: 1, fontWeight: 900, letterSpacing: '0', textTransform: 'uppercase' }}>{verdict}</h2>
          </div>

          <p style={{ color: 'rgba(255,255,255,0.82)', margin: 0, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 15, lineHeight: 1.5, fontWeight: 700, textTransform: 'uppercase' }}>
            {criticalFindings.toLocaleString()} critical findings and {gapSummary} block Mission Gate F.
          </p>

          <div style={{ borderLeft: `2px solid ${verdictTone}80`, paddingLeft: 22, display: 'grid', alignContent: 'center', gap: 7, minWidth: 0 }}>
            <span style={{ color: C.muted, fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Top Blocker</span>
            <span style={{ color: verdictTone, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 15, fontWeight: 900 }}>{topBlockerId}</span>
            <span style={{ color: 'rgba(255,255,255,0.74)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13, lineHeight: 1.45, fontWeight: 700, textTransform: 'uppercase', overflow: 'hidden', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2 }}>{topBlockerText}</span>
          </div>

          <div style={{ marginTop: 'auto', paddingTop: 10, display: 'flex', alignItems: 'center', gap: 16 }}>
            <span style={{ color: C.muted, fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Next Action</span>
            <button
              type="button"
              data-qid="posture:ambient:review-top-blocker"
              data-qs-action="POSTURE_REVIEW_TOP_BLOCKER"
              title={`Review top signoff blocker ${topBlockerId}`}
              aria-label={`Review top signoff blocker ${topBlockerId}`}
              disabled={!topBlocker}
              onClick={() => topBlocker && onOpenBlocker(topBlockerId)}
              style={{ minHeight: 44, border: `1px solid ${verdictTone}66`, background: `${verdictTone}18`, color: topBlocker ? C.white : C.muted, padding: '9px 16px', fontSize: 11, fontWeight: 900, letterSpacing: '0.08em', textTransform: 'uppercase', cursor: topBlocker ? 'pointer' : 'not-allowed' }}
            >
              Review top blocker
            </button>
          </div>
        </section>

        <aside style={{ background: C.panel, border: `1px solid ${C.faint}`, padding: 24, display: 'grid', gridTemplateRows: 'auto 1fr', gap: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(191,219,254,0.42)', boxShadow: '0 0 8px rgba(59,130,246,0.45)' }} />
            <span style={{ color: C.dim, fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Embry voice targets</span>
          </div>
          <div style={{ alignSelf: 'end', display: 'grid', gap: 13 }}>
            <span style={{ color: C.muted, fontSize: 10, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', borderBottom: `1px solid ${C.faint}`, paddingBottom: 9 }}>Available commands</span>
            {['“Posture status”', '“Top blocker”', '“Open finding”'].map((target) => (
              <span key={target} style={{ color: C.dim, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 13 }}>{target}</span>
            ))}
          </div>
        </aside>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 30, paddingTop: 24, borderTop: `1px solid ${C.faint}` }}>
        <MacroTelemetry label="Critical blockers" value={criticalFindings.toLocaleString()} status={criticalFindings > 0 ? 'Blocked' : 'Clear'} tone={criticalFindings > 0 ? C.red : C.green} />
        <MacroTelemetry label="Evidence gaps" value={evidenceGaps.toLocaleString()} status={evidenceGaps > 0 ? 'Missing' : 'Complete'} tone={evidenceGaps > 0 ? C.yellow : C.green} bordered />
        <MacroTelemetry label="Overdue actions" value="N/A" status="No due-date data" tone={C.yellow} bordered />
      </div>

      <style>{`
        @keyframes posture-ambient-pulse {
          0%, 100% { opacity: 0.62; }
          50% { opacity: 1; }
        }
        [data-qid="posture:ambient:review-top-blocker"]:focus-visible {
          outline: 2px solid #ffffff;
          outline-offset: 3px;
        }
        [data-qid="posture:ambient:review-top-blocker"]:not(:disabled):hover {
          background: rgba(239, 68, 68, 0.22) !important;
        }
        @media (prefers-reduced-motion: reduce) {
          [data-qid="posture:ambient:root"] * { animation: none !important; }
        }
      `}</style>
    </section>
  )
}

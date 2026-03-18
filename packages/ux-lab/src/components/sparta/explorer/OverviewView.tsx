import { useMemo } from 'react'
import { EMBRY, card, label, heading, glowDot } from '../common/EmbryStyle'
import { useCollectionCounts, useFrameworkCounts } from '../../../hooks/useSpartaCollections'
import type { TabName } from './SpartaExplorer'

interface OverviewProps {
  onNavigate?: (tab: TabName) => void
}

export function OverviewView({ onNavigate }: OverviewProps) {
  const counts = useCollectionCounts()
  const { data: fwCounts } = useFrameworkCounts()

  // Coverage funnel percentages
  const funnel = useMemo(() => {
    const c = counts.controls || 1
    return {
      controls: counts.controls,
      urls: counts.urls,
      urlPct: ((counts.urls / c) * 100).toFixed(0),
      knowledge: counts.knowledge,
      knowledgePct: ((counts.knowledge / c) * 100).toFixed(0),
      qras: counts.qras,
      qraPct: ((counts.qras / c) * 100).toFixed(0),
    }
  }, [counts])

  // Framework coverage — from dedicated hook that samples broadly
  const fwCoverage = fwCounts

  // Outstanding issues
  const issues = useMemo(() => {
    const list: { severity: 'high' | 'medium' | 'low'; text: string; tab: TabName }[] = []
    if (counts.urls === 0) list.push({ severity: 'high', text: 'No URLs fetched — URL pipeline may not have run', tab: 'URLs' })
    if (counts.knowledge === 0) list.push({ severity: 'high', text: 'No knowledge chunks — extraction pipeline incomplete', tab: 'Knowledge' })
    if (counts.qras === 0) list.push({ severity: 'high', text: 'No QRAs generated — QRA pipeline not started', tab: 'QRAs' })
    if (counts.relationships === 0) list.push({ severity: 'medium', text: 'No relationships — cross-framework mapping incomplete', tab: 'Relationships' })
    return list
  }, [counts])

  const severityColor = { high: EMBRY.red, medium: EMBRY.amber, low: EMBRY.dim }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <div style={{ ...heading, fontSize: 16, marginBottom: 16 }}>SPARTA Pipeline Overview</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Coverage funnel */}
        <div style={{ ...card }}>
          <div style={{ ...heading, marginBottom: 12 }}>Coverage Funnel</div>
          <FunnelRow label="Controls" value={funnel.controls} pct="100" color={EMBRY.blue} loading={counts.loading} />
          <FunnelRow label="URLs" value={funnel.urls} pct={funnel.urlPct} color={EMBRY.green} loading={counts.loading} />
          <FunnelRow label="Knowledge" value={funnel.knowledge} pct={funnel.knowledgePct} color={EMBRY.accent} loading={counts.loading} />
          <FunnelRow label="QRAs" value={funnel.qras} pct={funnel.qraPct} color={EMBRY.amber} loading={counts.loading} />
        </div>

        {/* Outstanding issues */}
        <div style={{ ...card }}>
          <div style={{ ...heading, marginBottom: 12 }}>Outstanding Issues</div>
          {issues.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={glowDot(EMBRY.green, 8)} />
              <span style={{ fontSize: 12, color: EMBRY.green }}>No issues detected</span>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {issues.map((issue) => (
                <div
                  key={`${issue.severity}-${issue.tab}`}
                  onClick={() => onNavigate?.(issue.tab)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                    backgroundColor: EMBRY.bgDeep,
                    border: `1px solid ${severityColor[issue.severity]}22`,
                  }}
                >
                  <div style={glowDot(severityColor[issue.severity], 6)} />
                  <span style={{ fontSize: 12, color: EMBRY.white, flex: 1 }}>{issue.text}</span>
                  <span style={{ fontSize: 10, color: EMBRY.dim }}>→ {issue.tab}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Framework coverage */}
        <div style={{ ...card, gridColumn: '1 / -1' }}>
          <div style={{ ...heading, marginBottom: 12 }}>Framework Coverage</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {fwCoverage.map((fw) => {
              const color = EMBRY.fw[fw.name] ?? EMBRY.dim
              return (
                <div key={fw.name} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color, width: 70 }}>{fw.name}</span>
                  <div style={{ flex: 1, height: 8, backgroundColor: EMBRY.bgDeep, borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${fw.pct}%`, height: '100%', backgroundColor: color, borderRadius: 4 }} />
                  </div>
                  <span style={{ fontSize: 11, color: EMBRY.dim, width: 80, textAlign: 'right' }}>
                    {fw.count.toLocaleString()} ({fw.pct.toFixed(0)}%)
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

function FunnelRow({ label: text, value, pct, color, loading }: {
  label: string; value: number; pct: string; color: string; loading: boolean
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
      <span style={{ fontSize: 11, color: EMBRY.dim, width: 80 }}>{text}</span>
      <div style={{ flex: 1, height: 6, backgroundColor: EMBRY.bgDeep, borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: EMBRY.white, width: 60, textAlign: 'right' }}>
        {loading ? '...' : value.toLocaleString()}
      </span>
      <span style={{ fontSize: 10, color: EMBRY.dim, width: 35 }}>{pct}%</span>
    </div>
  )
}

import { useMemo } from 'react'
import { EMBRY, card, label, heading, glowDot } from '../common/EmbryStyle'
import { useFrameworkCounts } from '../../../hooks/useSpartaCollections'

interface SourceCard {
  name: string
  framework: string
  status: 'active' | 'partial' | 'inactive'
  count: number
}

const WORKSHEETS = [
  'CounterTechniques', 'CounterTechniquesMap', 'Threats', 'ThreatsMap',
  'Countermeasures', 'CountermeasuresMap', 'BusObj', 'BusObjMap',
  'CompObj', 'CompObjMap', 'CyberObj', 'CyberObjMap',
  'PhysObj', 'PhysObjMap', 'SpaceObj', 'SpaceObjMap',
] as const

export function SourcesView() {
  const { data: fwCounts, loading } = useFrameworkCounts()

  // Build a lookup from framework name → estimated count
  const countMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const fc of fwCounts) m.set(fc.name, fc.count)
    return m
  }, [fwCounts])

  const sources: SourceCard[] = [
    { name: 'SPARTA-Data.xlsx', framework: 'SPARTA', status: 'active', count: countMap.get('SPARTA') ?? 0 },
    { name: 'ATT&CK Enterprise', framework: 'ATT&CK', status: 'active', count: countMap.get('ATT&CK') ?? 0 },
    { name: 'CWE/NVD', framework: 'CWE', status: 'active', count: countMap.get('CWE') ?? 0 },
    { name: 'D3FEND', framework: 'D3FEND', status: 'active', count: countMap.get('D3FEND') ?? 0 },
    { name: 'NIST SP 800-53', framework: 'NIST', status: 'active', count: countMap.get('NIST') ?? 0 },
    { name: 'ISO 27001', framework: 'ISO', status: 'partial', count: countMap.get('ISO') ?? 0 },
  ]

  const statusColor = { active: EMBRY.green, partial: EMBRY.amber, inactive: EMBRY.dim }

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <div style={{ ...heading, marginBottom: 16 }}>Data Sources</div>

      {/* Source cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12, marginBottom: 24 }}>
        {sources.map((src) => {
          const fwColor = EMBRY.fw[src.framework] ?? EMBRY.dim
          return (
            <div key={src.name} style={{ ...card }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={glowDot(statusColor[src.status], 8)} />
                <span style={{ fontSize: 13, fontWeight: 700, color: EMBRY.white }}>{src.name}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                  color: fwColor, backgroundColor: `${fwColor}18`, border: `1px solid ${fwColor}33`,
                }}>
                  {src.framework}
                </span>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                  color: statusColor[src.status],
                  backgroundColor: `${statusColor[src.status]}15`,
                  border: `1px solid ${statusColor[src.status]}30`,
                }}>
                  {src.status === 'active' ? 'PASS' : src.status === 'partial' ? 'WARN' : 'INACTIVE'}
                </span>
              </div>
              <div style={{ fontSize: 24, fontWeight: 900, color: EMBRY.white }}>
                {loading ? '...' : src.count.toLocaleString()}
              </div>
              <div style={{ ...label, marginTop: 2 }}>controls</div>
            </div>
          )
        })}
      </div>

      {/* SPARTA Worksheets */}
      <div style={{ ...heading, marginBottom: 12 }}>SPARTA-Data.xlsx Worksheets</div>
      <div style={{ ...card }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
          {WORKSHEETS.map((ws) => (
            <button
              key={ws}
              style={{
                fontSize: 11, padding: '8px 16px', cursor: 'pointer',
                border: `1px solid ${EMBRY.border}`, background: 'none',
                color: EMBRY.white, borderRadius: 0,
              }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${EMBRY.accent}12` }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
            >
              {ws}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

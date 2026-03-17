import { useState, useMemo } from 'react'
import { EMBRY, card, label, heading, glowDot, fwBadge } from '../common/EmbryStyle'
import { useRelationships } from '../../../hooks/useSpartaCollections'
import type { SpartaRelationship } from '../../../hooks/useSpartaCollections'

function nrsColor(score: number | undefined): string {
  if (score == null) return EMBRY.dim
  if (score >= 0.80) return EMBRY.green
  if (score >= 0.60) return EMBRY.amber
  return EMBRY.red
}

export function RelationshipsView() {
  const { data: relationships, total, loading, error } = useRelationships()
  const [selected, setSelected] = useState<SpartaRelationship | null>(null)

  // Build unique node list from relationship endpoints
  const nodes = useMemo(() => {
    const seen = new Map<string, number>()
    for (const r of relationships) {
      seen.set(r.source_control_id, (seen.get(r.source_control_id) ?? 0) + 1)
      seen.set(r.target_control_id, (seen.get(r.target_control_id) ?? 0) + 1)
    }
    return [...seen.entries()]
      .map(([id, edgeCount]) => ({ id, edgeCount }))
      .sort((a, b) => b.edgeCount - a.edgeCount)
  }, [relationships])

  // Score histogram
  const histogram = useMemo(() => {
    const bins = { accept: 0, uncertain: 0, reject: 0 }
    for (const r of relationships) {
      const score = r.combined_score
      if (score == null) bins.uncertain++
      else if (score >= 0.80) bins.accept++
      else if (score >= 0.60) bins.uncertain++
      else bins.reject++
    }
    return bins
  }, [relationships])
  const histTotal = Math.max(histogram.accept + histogram.uncertain + histogram.reject, 1)

  if (error) {
    return <div style={{ padding: 20, color: EMBRY.red, border: `1px solid ${EMBRY.red}33`, borderRadius: 8, margin: 16 }}>Error: {error}</div>
  }

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden', flexDirection: 'column' }}>
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Edge table (replaces empty graph for now — real LemmaGraph needs proper node positions) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Stats header */}
          <div style={{ display: 'flex', gap: 16, padding: '12px 16px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
            <div>
              <span style={{ fontSize: 20, fontWeight: 900, color: EMBRY.white }}>{total.toLocaleString()}</span>
              <span style={{ fontSize: 11, color: EMBRY.dim, marginLeft: 6 }}>relationships</span>
            </div>
            <div>
              <span style={{ fontSize: 20, fontWeight: 900, color: EMBRY.white }}>{nodes.length}</span>
              <span style={{ fontSize: 11, color: EMBRY.dim, marginLeft: 6 }}>unique controls</span>
            </div>
          </div>

          {/* Top connected nodes */}
          <div style={{ padding: '8px 16px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
            <div style={{ ...label, marginBottom: 6 }}>Most Connected</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {nodes.slice(0, 20).map((n) => (
                <span key={n.id} style={{
                  fontSize: 10, fontFamily: 'monospace', padding: '2px 6px', borderRadius: 4,
                  backgroundColor: EMBRY.bgDeep, color: EMBRY.blue, border: `1px solid ${EMBRY.border}`,
                }}>
                  {n.id} ({n.edgeCount})
                </span>
              ))}
            </div>
          </div>

          {/* Relationship table */}
          <div style={{ flex: 1, overflow: 'auto' }}>
            {loading ? (
              <div style={{ padding: 20, color: EMBRY.dim }}>Loading relationships...</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={thStyle}>Source</th>
                    <th style={thStyle}>Target</th>
                    <th style={thStyle}>Method</th>
                    <th style={thStyle}>NRS Score</th>
                  </tr>
                </thead>
                <tbody>
                  {relationships.map((r) => (
                    <tr
                      key={r._key}
                      onClick={() => setSelected(r)}
                      style={{ cursor: 'pointer' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${EMBRY.blue}08` }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
                    >
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, color: EMBRY.blue }}>{r.source_control_id}</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, color: EMBRY.blue }}>{r.target_control_id}</td>
                      <td style={{ ...tdStyle, fontSize: 11, color: EMBRY.dim }}>{r.method ?? '—'}</td>
                      <td style={tdStyle}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: nrsColor(r.combined_score) }}>
                          {r.combined_score != null ? r.combined_score.toFixed(3) : '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Edge detail panel */}
        {selected && (
          <div style={{ width: 360, backgroundColor: EMBRY.bgPanel, borderLeft: `1px solid ${EMBRY.border}`, overflow: 'auto', flexShrink: 0 }}>
            <div style={{ padding: '16px 20px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={heading}>Edge Detail</div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: `1px solid ${EMBRY.border}`, borderRadius: 6, color: EMBRY.dim, fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>
                Close
              </button>
            </div>
            <div style={{ padding: '12px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: EMBRY.blue }}>{selected.source_control_id}</span>
                <span style={{ color: EMBRY.dim }}>→</span>
                <span style={{ fontFamily: 'monospace', fontSize: 12, color: EMBRY.blue }}>{selected.target_control_id}</span>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={label}>Method</div>
                <div style={{ fontSize: 12, color: EMBRY.white, marginTop: 4 }}>{selected.method ?? '—'}</div>
              </div>
              <div style={{ marginBottom: 12 }}>
                <div style={label}>Combined NRS</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: nrsColor(selected.combined_score), marginTop: 4 }}>
                  {selected.combined_score != null ? selected.combined_score.toFixed(4) : '—'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Score histogram bar */}
      <div style={{ padding: '8px 16px', borderTop: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, backgroundColor: EMBRY.bgHeader }}>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: EMBRY.dim }}>Score Distribution</span>
        <div style={{ flex: 1, display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: `${(histogram.accept / histTotal) * 100}%`, backgroundColor: EMBRY.green }} />
          <div style={{ width: `${(histogram.uncertain / histTotal) * 100}%`, backgroundColor: EMBRY.amber }} />
          <div style={{ width: `${(histogram.reject / histTotal) * 100}%`, backgroundColor: EMBRY.red }} />
        </div>
        <div style={{ display: 'flex', gap: 10, fontSize: 10 }}>
          <span style={{ color: EMBRY.green }}>Accept: {histogram.accept}</span>
          <span style={{ color: EMBRY.amber }}>Uncertain: {histogram.uncertain}</span>
          <span style={{ color: EMBRY.red }}>Reject: {histogram.reject}</span>
        </div>
      </div>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em',
  color: EMBRY.dim, padding: '8px 10px', textAlign: 'left',
  borderBottom: `1px solid ${EMBRY.border}`, backgroundColor: EMBRY.bgDeep, whiteSpace: 'nowrap',
}
const tdStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 12, borderBottom: `1px solid ${EMBRY.border}`, color: EMBRY.white,
}

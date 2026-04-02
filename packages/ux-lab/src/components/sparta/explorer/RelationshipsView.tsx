import { useState, useMemo, useEffect } from 'react'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import { EMBRY, label, heading, glowDot } from '../common/EmbryStyle'
import { applyMagneticHover, removeMagneticHover, magneticRow, magneticRowSelected } from '../common/TableStyles'
import { useToast } from '../common/Toast'
import { useRelationshipsPaginated } from '../../../hooks/useSpartaCollections'
import type { SpartaRelationship } from '../../../hooks/useSpartaCollections'

const PAGE_SIZE = 100

function nrsColor(score: number | undefined): string {
  if (score == null) return EMBRY.dim
  if (score >= 0.80) return EMBRY.green
  if (score >= 0.60) return EMBRY.amber
  return EMBRY.red
}

export function RelationshipsView() {
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<SpartaRelationship | null>(null)
  const [toast, showToast] = useToast()

  // ── Action registrations ──
  useRegisterAction('relationships:row:select', { app: 'sparta-explorer', action: 'SELECT_RELATIONSHIP', label: 'Select Relationship', description: 'Select a relationship edge to view details' })
  useRegisterAction('relationships:detail:close', { app: 'sparta-explorer', action: 'CLOSE_DETAIL', label: 'Close Detail', description: 'Close the edge detail panel' })
  useRegisterAction('relationships:detail:explain', { app: 'sparta-explorer', action: 'LOAD_RATIONALE', label: 'Explain Relationship', description: 'Generate an LLM explanation for this relationship' })
  useRegisterAction('relationships:page:prev', { app: 'sparta-explorer', action: 'PAGE_PREV', label: 'Previous Page', description: 'Navigate to previous page of relationships' })
  useRegisterAction('relationships:page:next', { app: 'sparta-explorer', action: 'PAGE_NEXT', label: 'Next Page', description: 'Navigate to next page of relationships' })

  const { data: relationships, total, loading, error } = useRelationshipsPaginated(page, PAGE_SIZE)
  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Build unique node list from this page's relationships
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

  // Score histogram for this page
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
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* Stats header */}
          <div style={{ display: 'flex', gap: 16, padding: '12px 16px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
            <div>
              <span style={{ fontSize: 20, fontWeight: 900, color: EMBRY.white }}>{total.toLocaleString()}</span>
              <span style={{ fontSize: 11, color: EMBRY.dim, marginLeft: 6 }}>relationships</span>
            </div>
            <div>
              <span style={{ fontSize: 20, fontWeight: 900, color: EMBRY.white }}>{nodes.length}</span>
              <span style={{ fontSize: 11, color: EMBRY.dim, marginLeft: 6 }}>controls on this page</span>
            </div>
          </div>

          {/* Top connected nodes on this page */}
          <div style={{ padding: '8px 16px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
            <div style={{ ...label, marginBottom: 6 }}>Most Connected (this page)</div>
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
              <div style={{ padding: 20, color: EMBRY.dim }}>Loading page {page + 1}...</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, width: 28 }}></th>
                    <th style={thStyle}>Source</th>
                    <th style={thStyle}>Target</th>
                    <th style={thStyle}>Method</th>
                    <th style={thStyle}>NRS Score</th>
                  </tr>
                </thead>
                <tbody>
                  {relationships.map((r) => {
                    const score = r.combined_score
                    const rowColor = score == null ? EMBRY.dim : score >= 0.80 ? EMBRY.green : score >= 0.60 ? EMBRY.amber : EMBRY.red
                    const isSelected = selected?._key === r._key
                    return (
                    <tr
                      key={r._key}
                      onClick={() => setSelected(r)}
                      data-qid={`relationships:row:${r._key}`}
                      data-qs-action="SELECT_RELATIONSHIP"
                      title={`${r.source_control_id} → ${r.target_control_id}`}
                      style={{ cursor: 'pointer', ...magneticRow, ...(isSelected ? magneticRowSelected : {}) }}
                      onMouseEnter={(e) => applyMagneticHover(e.currentTarget, isSelected)}
                      onMouseLeave={(e) => removeMagneticHover(e.currentTarget, isSelected)}
                    >
                      <td style={{ ...tdStyle, textAlign: 'center' }}><div style={glowDot(rowColor, 6)} /></td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, color: EMBRY.blue }}>{r.source_control_id}</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, color: EMBRY.blue }}>{r.target_control_id}</td>
                      <td style={{ ...tdStyle, fontSize: 11, color: EMBRY.dim }}>{r.method ?? '—'}</td>
                      <td style={tdStyle}>
                        <span style={{ fontSize: 12, fontWeight: 700, color: nrsColor(score) }}>
                          {score != null ? score.toFixed(3) : '—'}
                        </span>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {/* Pagination */}
          <div style={{ padding: '8px 16px', borderTop: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            <button data-qid="relationships:page:prev" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} data-qs-action="PAGE_PREV" title="Previous page" style={paginationBtn(page > 0)}>Prev</button>
            <span style={{ fontSize: 12, color: EMBRY.dim }}>Page {page + 1} of {totalPages || 1}</span>
            <button data-qid="relationships:page:next" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} data-qs-action="PAGE_NEXT" title="Next page" style={paginationBtn(page < totalPages - 1)}>Next</button>
            <span style={{ fontSize: 11, color: EMBRY.muted, marginLeft: 'auto' }}>
              {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Edge detail panel */}
        {selected && <EdgeDetailPane edge={selected} onClose={() => setSelected(null)} />}
      </div>

      {/* Score histogram bar */}
      <div style={{ padding: '8px 16px', borderTop: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0, backgroundColor: EMBRY.bgHeader }}>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em', color: EMBRY.dim }}>Score Distribution (this page)</span>
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
      {toast}
    </div>
  )
}

const DAEMON = 'http://localhost:3001/api/memory'

const API = 'http://localhost:3001'

function EdgeDetailPane({ edge, onClose }: { edge: SpartaRelationship; onClose: () => void }) {
  const [sourceMind, setSourceMind] = useState<string[]>([])
  const [targetMind, setTargetMind] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [rationale, setRationale] = useState<string | null>(null)
  const [rationaleLoading, setRationaleLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const ids = [edge.source_control_id, edge.target_control_id].filter(Boolean)
    if (ids.length === 0) { setLoading(false); return }

    fetch(`${DAEMON}/recall/by-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ collection: 'sparta_controls', keys: ids, key_field: 'control_id', return_fields: ['control_id', 'mind'] }),
    })
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return
        for (const doc of (res.documents ?? [])) {
          const tags = Array.isArray(doc.mind) ? doc.mind : []
          if (doc.control_id === edge.source_control_id) setSourceMind(tags)
          if (doc.control_id === edge.target_control_id) setTargetMind(tags)
        }
        setLoading(false)
      })
      .catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [edge.source_control_id, edge.target_control_id])

  const allTags = [...new Set([...sourceMind, ...targetMind])].sort()

  return (
    <div style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: 360, backgroundColor: EMBRY.bgPanel, borderLeft: `1px solid ${EMBRY.border}`, overflow: 'auto', zIndex: 100, boxShadow: '-20px 0 50px rgba(0,0,0,0.8)' }}>
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={heading}>Edge Detail</div>
        <button data-qid="relationships:detail:close" onClick={onClose} data-qs-action="CLOSE_DETAIL" title="Close edge detail" style={{ background: 'none', border: `1px solid ${EMBRY.border}`, borderRadius: 6, color: EMBRY.dim, fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>
          Close
        </button>
      </div>
      <div style={{ padding: '12px 20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: EMBRY.blue }}>{edge.source_control_id}</span>
          <span style={{ color: EMBRY.dim }}>→</span>
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: EMBRY.blue }}>{edge.target_control_id}</span>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={label}>Method</div>
          <div style={{ fontSize: 12, color: EMBRY.white, marginTop: 4 }}>{edge.method ?? '—'}</div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <div style={label}>Combined NRS</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: nrsColor(edge.combined_score), marginTop: 4 }}>
            {edge.combined_score != null ? edge.combined_score.toFixed(4) : '—'}
          </div>
        </div>

        {/* Mind / Taxonomy tags */}
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...label, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
            Mind Tags
            <div style={glowDot(allTags.length > 0 ? EMBRY.green : EMBRY.red, 6)} />
          </div>
          {loading ? (
            <div style={{ fontSize: 11, color: EMBRY.dim }}>Loading...</div>
          ) : allTags.length > 0 ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {allTags.map((tag) => (
                <span key={tag} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, backgroundColor: `${EMBRY.accent}18`, color: EMBRY.accent, border: `1px solid ${EMBRY.accent}33` }}>
                  {tag}
                </span>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 11, color: EMBRY.red, padding: '4px 8px', borderRadius: 4, backgroundColor: `${EMBRY.red}08` }}>
              No taxonomy tags on source/target controls
            </div>
          )}
        </div>

        {/* Gate evidence */}
        {(edge as any).gate_evidence && (() => {
          const ge = (edge as any).gate_evidence
          return (
            <div style={{ marginBottom: 12 }}>
              <div style={{ ...label, marginBottom: 6 }}>Gate Evidence</div>
              <div style={{ fontSize: 11, color: EMBRY.dim, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <div>Verdict: <span style={{ color: ge.verdict === 'strong' ? EMBRY.green : ge.verdict === 'moderate' ? EMBRY.amber : EMBRY.red, fontWeight: 700 }}>{ge.verdict}</span>
                  {ge.tier === 'T2' && <span style={{ marginLeft: 6, fontSize: 9, padding: '1px 5px', borderRadius: 3, backgroundColor: `${EMBRY.amber}22`, color: EMBRY.amber, border: `1px solid ${EMBRY.amber}44` }}>LLM Graded</span>}
                </div>
                <div>Gates passed: {ge.gates_passed}/4</div>
                <div>Mind Jaccard: {ge.gate3_mind_jaccard?.toFixed(3) ?? '—'}</div>
                <div>Cosine: {ge.gate4_cosine_similarity?.toFixed(4) ?? '—'}</div>
                {ge.gate2_curated_methods?.length > 0 && (
                  <div>Curated: {ge.gate2_curated_methods.join(', ')}</div>
                )}
              </div>
            </div>
          )
        })()}

        {/* Explain button + rationale */}
        <div style={{ marginBottom: 12 }}>
          {rationale ? (
            <div style={{ fontSize: 12, color: EMBRY.white, lineHeight: 1.6, padding: '8px 12px', borderRadius: 6, backgroundColor: `${EMBRY.accent}08`, border: `1px solid ${EMBRY.accent}22` }}>
              {rationale}
            </div>
          ) : (
            <button
              disabled={rationaleLoading}
              data-qid="relationships:detail:explain"
              data-qs-action="LOAD_RATIONALE"
              title="Generate LLM explanation for this relationship"
              onClick={async () => {
                setRationaleLoading(true)
                try {
                  const r = await fetch(`${API}/api/edge-rationale`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ _key: (edge as any)._key }),
                  })
                  const data = await r.json()
                  if (data.rationale) setRationale(data.rationale)
                } catch { /* non-critical */ }
                setRationaleLoading(false)
              }}
              style={{ fontSize: 11, padding: '6px 14px', borderRadius: 6, border: `1px solid ${EMBRY.accent}44`, backgroundColor: `${EMBRY.accent}12`, color: EMBRY.accent, cursor: rationaleLoading ? 'wait' : 'pointer', fontWeight: 700 }}
            >
              {rationaleLoading ? 'Generating...' : 'Explain Relationship'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const thStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.15em',
  color: EMBRY.dim, padding: '8px 10px', textAlign: 'left',
  borderBottom: `1px solid ${EMBRY.border}`, backgroundColor: EMBRY.bgDeep, whiteSpace: 'nowrap',
  position: 'sticky', top: 0, zIndex: 1,
}
const tdStyle: React.CSSProperties = {
  padding: '6px 10px', fontSize: 12, borderBottom: `1px solid ${EMBRY.border}`, color: EMBRY.white,
}
function paginationBtn(enabled: boolean): React.CSSProperties {
  return {
    fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 4,
    border: `1px solid ${EMBRY.border}`, backgroundColor: enabled ? EMBRY.bgDeep : 'transparent',
    color: enabled ? EMBRY.white : EMBRY.muted, cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.5,
  }
}

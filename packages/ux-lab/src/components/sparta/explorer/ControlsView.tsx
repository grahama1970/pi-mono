import { useState, useEffect, useCallback } from 'react'
import { EMBRY, label, glowDot, card, heading, body, fwBadge } from '../common/EmbryStyle'
import { useControlsPaginated, normalizeFramework } from '../../../hooks/useSpartaCollections'
import type { SpartaControl } from '../../../hooks/useSpartaCollections'

const API = '/api/memory'
const PAGE_SIZE = 100

const FRAMEWORKS = ['ALL', 'SPARTA', 'NIST', 'CWE', 'D3FEND', 'ATT&CK', 'ISO', 'ESA', 'NASA'] as const
const FW_TO_RAW: Record<string, string | undefined> = {
  SPARTA: 'SPARTA',
  NIST: 'NIST',
  CWE: 'cwe',
  D3FEND: 'D3FEND',
  'ATT&CK': 'ATT_CK_Enterprise',
  ISO: 'ISO',
  ESA: 'ESA',
  NASA: 'NASA',
}

const PLACEHOLDER_PATTERN = /This control requires QRA generation/i
function isPlaceholder(desc?: string): boolean {
  return !desc || PLACEHOLDER_PATTERN.test(desc)
}

function nrsColor(score: number | undefined): string {
  if (score == null) return EMBRY.dim
  if (score >= 0.80) return EMBRY.green
  if (score >= 0.60) return EMBRY.amber
  return EMBRY.red
}

/* ── Detail pane for selected control ────────────────────────────────────── */

function ControlDetailPane({ control, onClose }: { control: SpartaControl; onClose: () => void }) {
  const [qras, setQras] = useState<Array<{ question?: string; reasoning?: string; answer?: string; grade?: string }>>([])
  const [rels, setRels] = useState<Array<{ source_control_id?: string; target_control_id?: string; relationship_type?: string }>>([])
  const [loadingDetail, setLoadingDetail] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoadingDetail(true)
    const q = `${control.control_id} ${control.name}`
    Promise.all([
      fetch(`${API}/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, collections: ['sparta_qra'], k: 10, entities: [control.control_id] }),
      }).then((r) => r.json()).catch(() => ({ items: [] })),
      fetch(`${API}/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q, collections: ['sparta_relationships'], k: 10, entities: [control.control_id] }),
      }).then((r) => r.json()).catch(() => ({ items: [] })),
    ]).then(([qraRes, relRes]) => {
      if (cancelled) return
      setQras(qraRes.items ?? [])
      setRels(relRes.items ?? [])
      setLoadingDetail(false)
    })
    return () => { cancelled = true }
  }, [control.control_id, control.name])

  const fw = normalizeFramework(control.source_framework)
  const fwColor = EMBRY.fw[fw] ?? EMBRY.dim
  const placeholder = isPlaceholder(control.description)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${EMBRY.border}`, backgroundColor: `${fwColor}0F` }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={fwBadge(fw)}>{fw}</span>
              <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: fwColor }}>{control.control_id}</span>
              {control.control_type && (
                <span style={{ fontSize: 10, color: EMBRY.dim, padding: '2px 6px', borderRadius: 4, backgroundColor: `${EMBRY.muted}22` }}>
                  {control.control_type}
                </span>
              )}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, color: EMBRY.white }}>{control.name}</div>
          </div>
          <button onClick={onClose} style={{ backgroundColor: 'transparent', border: `1px solid ${EMBRY.border}`, borderRadius: 6, color: EMBRY.dim, fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>
            Close
          </button>
        </div>
      </div>

      {/* Description */}
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
        <div style={{ ...label, marginBottom: 4 }}>Description</div>
        {placeholder ? (
          <div style={{ fontSize: 12, color: EMBRY.amber, padding: '6px 10px', borderRadius: 6, backgroundColor: `${EMBRY.amber}12`, border: `1px solid ${EMBRY.amber}22` }}>
            NEEDS DESCRIPTION — placeholder text detected
          </div>
        ) : (
          <div style={{ fontSize: 12, color: EMBRY.dim, lineHeight: 1.5 }}>{control.description}</div>
        )}
      </div>

      {/* Metadata */}
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}`, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
        {control.domain && <MetaField label="Domain" value={control.domain} />}
        {control.parent_id && <MetaField label="Parent" value={control.parent_id} mono />}
        {control.scope && <MetaField label="Scope" value={control.scope} />}
        {control.nrs_score != null && (
          <div>
            <div style={{ ...label, marginBottom: 2 }}>NRS Score</div>
            <span style={{ fontSize: 14, fontWeight: 700, color: nrsColor(control.nrs_score) }}>
              {(control.nrs_score * 100).toFixed(0)}%
            </span>
          </div>
        )}
      </div>

      {/* Mind tags */}
      {control.mind && control.mind.length > 0 && (
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={{ ...label, marginBottom: 6 }}>Mind Tags</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {control.mind.map((tag) => (
              <span key={tag} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, backgroundColor: `${EMBRY.accent}18`, color: EMBRY.accent, border: `1px solid ${EMBRY.accent}33` }}>
                {tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Weaknesses */}
      {control.weaknesses && control.weaknesses.length > 0 && (
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={{ ...label, marginBottom: 6 }}>Weaknesses ({control.weaknesses.length})</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {control.weaknesses.map((w) => (
              <span key={w} style={{ fontSize: 11, padding: '3px 8px', borderRadius: 4, backgroundColor: `${EMBRY.red}12`, color: EMBRY.red, border: `1px solid ${EMBRY.red}22` }}>
                {w}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* QRAs */}
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
        <div style={{ ...label, marginBottom: 8 }}>QRAs ({qras.length})</div>
        {loadingDetail ? (
          <div style={{ fontSize: 12, color: EMBRY.dim }}>Loading...</div>
        ) : qras.length === 0 ? (
          <div style={{ fontSize: 12, color: EMBRY.dim }}>No QRAs found</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {qras.map((qra, i) => (
              <div key={`qra-${control.control_id}-${i}`} style={{ borderRadius: 6, border: `1px solid ${EMBRY.border}`, overflow: 'hidden' }}>
                <div style={{ padding: '8px 10px', fontSize: 12, lineHeight: 1.5 }}>
                  <span style={{ color: EMBRY.accent }}>Q: </span>
                  <span style={{ color: EMBRY.white }}>{qra.question}</span>
                </div>
                {qra.reasoning && !PLACEHOLDER_PATTERN.test(qra.reasoning) && (
                  <div style={{ padding: '8px 10px', borderTop: `1px solid ${EMBRY.border}`, fontSize: 12, lineHeight: 1.5 }}>
                    <span style={{ color: EMBRY.amber }}>R: </span>
                    <span style={{ color: EMBRY.dim }}>{qra.reasoning}</span>
                  </div>
                )}
                {qra.answer && (
                  <div style={{ padding: '8px 10px', borderTop: `1px solid ${EMBRY.border}`, fontSize: 12, lineHeight: 1.5 }}>
                    <span style={{ color: EMBRY.green }}>A: </span>
                    <span style={{ color: EMBRY.dim }}>{qra.answer}</span>
                  </div>
                )}
                {qra.grade && (
                  <div style={{ padding: '4px 10px', borderTop: `1px solid ${EMBRY.border}`, fontSize: 10, color: qra.grade === 'PASS' ? EMBRY.green : EMBRY.red }}>
                    Grade: {qra.grade}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Relationships */}
      <div style={{ padding: '12px 20px' }}>
        <div style={{ ...label, marginBottom: 8 }}>Relationships ({rels.length})</div>
        {loadingDetail ? (
          <div style={{ fontSize: 12, color: EMBRY.dim }}>Loading...</div>
        ) : rels.length === 0 ? (
          <div style={{ fontSize: 12, color: EMBRY.dim }}>No relationships found</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {rels.map((rel, i) => {
              const other = rel.source_control_id === control.control_id ? rel.target_control_id : rel.source_control_id
              return (
                <div key={`rel-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 6, backgroundColor: EMBRY.bgDeep }}>
                  <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: EMBRY.white }}>{other}</span>
                  {rel.relationship_type && (
                    <span style={{ fontSize: 10, color: EMBRY.dim, marginLeft: 'auto', padding: '2px 6px', borderRadius: 4, backgroundColor: `${EMBRY.muted}22` }}>
                      {rel.relationship_type}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function MetaField({ label: l, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div style={{ ...label, marginBottom: 2 }}>{l}</div>
      <div style={{ fontSize: 12, color: EMBRY.white, fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</div>
    </div>
  )
}

/* ── Main Controls View ─────────────────────────────────────────────────── */

export function ControlsView() {
  const [page, setPage] = useState(0)
  const [fwFilter, setFwFilter] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<SpartaControl | null>(null)

  const rawFw = fwFilter ? FW_TO_RAW[fwFilter] : undefined
  const { data: controls, total, loading, error } = useControlsPaginated(page, PAGE_SIZE, rawFw)

  // Reset page when framework changes
  useEffect(() => { setPage(0) }, [fwFilter])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Client-side search filter (within current page)
  const filtered = search
    ? controls.filter((c) =>
        c.control_id.toLowerCase().includes(search.toLowerCase()) ||
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        (c.description ?? '').toLowerCase().includes(search.toLowerCase()),
      )
    : controls

  if (error) {
    return <div style={{ padding: 20, color: EMBRY.red, border: `1px solid ${EMBRY.red}33`, borderRadius: 8, margin: 16 }}>Error: {error}</div>
  }

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Main table area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header bar */}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: EMBRY.white }}>Controls</div>
            <div style={{ ...label, marginTop: 2 }}>
              {total.toLocaleString()} total
              {fwFilter ? ` · ${fwFilter}` : ''}
              {search ? ` · ${filtered.length} matching "${search}"` : ''}
            </div>
          </div>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this page..."
            style={{
              backgroundColor: EMBRY.bgDeep,
              border: `1px solid ${EMBRY.border}`,
              borderRadius: 6,
              padding: '5px 10px',
              fontSize: 12,
              color: EMBRY.white,
              outline: 'none',
              width: 180,
            }}
          />
        </div>

        {/* Framework filter pills */}
        <div style={{ display: 'flex', gap: 4, padding: '8px 16px', borderBottom: `1px solid ${EMBRY.border}`, flexWrap: 'wrap', flexShrink: 0 }}>
          {FRAMEWORKS.map((fw) => {
            const isActive = fw === 'ALL' ? !fwFilter : fwFilter === fw
            const color = fw === 'ALL' ? EMBRY.white : (EMBRY.fw[fw] ?? EMBRY.dim)
            return (
              <button
                key={fw}
                onClick={() => setFwFilter(fw === 'ALL' ? undefined : fw)}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '3px 10px',
                  borderRadius: 4,
                  border: `1px solid ${isActive ? color : EMBRY.border}`,
                  backgroundColor: isActive ? `${color}22` : 'transparent',
                  color: isActive ? color : EMBRY.dim,
                  cursor: 'pointer',
                }}
              >
                {fw}
              </button>
            )
          })}
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading ? (
            <div style={{ padding: 20, color: EMBRY.dim }}>Loading page {page + 1}...</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, width: 28 }}></th>
                  <th style={thStyle}>FW</th>
                  <th style={thStyle}>ID</th>
                  <th style={{ ...thStyle, width: '35%' }}>Name</th>
                  <th style={thStyle}>Type</th>
                  <th style={thStyle}>Issues</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ctrl) => {
                  const fw = normalizeFramework(ctrl.source_framework)
                  const placeholder = isPlaceholder(ctrl.description)
                  const hasIssues = (ctrl.weaknesses?.length ?? 0) > 0
                  const noDesc = !ctrl.description || ctrl.description.length < 10
                  const rowOk = !placeholder && !hasIssues && !noDesc
                  const rowColor = rowOk ? EMBRY.green : placeholder || noDesc ? EMBRY.amber : EMBRY.red
                  const isSelected = selected?.control_id === ctrl.control_id
                  return (
                    <tr
                      key={ctrl.control_id}
                      onClick={() => setSelected(ctrl)}
                      style={{
                        cursor: 'pointer',
                        backgroundColor: isSelected ? `${EMBRY.accent}12` : 'transparent',
                      }}
                      onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = `${EMBRY.blue}08` }}
                      onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLElement).style.backgroundColor = 'transparent' }}
                    >
                      <td style={{ ...tdStyle, textAlign: 'center' }}><div style={glowDot(rowColor, 6)} /></td>
                      <td style={tdStyle}><span style={fwBadge(fw)}>{fw}</span></td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, fontWeight: 700 }}>{ctrl.control_id}</td>
                      <td style={{ ...tdStyle, color: EMBRY.dim }}>{ctrl.name}</td>
                      <td style={{ ...tdStyle, fontSize: 10, color: EMBRY.dim }}>{ctrl.control_type}</td>
                      <td style={tdStyle}>
                        {placeholder ? (
                          <span style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, backgroundColor: `${EMBRY.amber}18`, color: EMBRY.amber }}>NO DESC</span>
                        ) : hasIssues ? (
                          <span style={{ fontSize: 10, color: EMBRY.red }}>{ctrl.weaknesses?.length} weaknesses</span>
                        ) : null}
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
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            style={paginationBtn(page > 0)}
          >
            Prev
          </button>
          <span style={{ fontSize: 12, color: EMBRY.dim }}>
            Page {page + 1} of {totalPages || 1}
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            style={paginationBtn(page < totalPages - 1)}
          >
            Next
          </button>
          <span style={{ fontSize: 11, color: EMBRY.muted, marginLeft: 'auto' }}>
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Detail slide-over */}
      {selected && (
        <div style={slideOverStyle}>
          <ControlDetailPane control={selected} onClose={() => setSelected(null)} />
        </div>
      )}
    </div>
  )
}

/* ── Styles ──────────────────────────────────────────────────────────────── */

const thStyle: React.CSSProperties = {
  ...label,
  padding: '8px 10px',
  textAlign: 'left',
  borderBottom: `1px solid ${EMBRY.border}`,
  backgroundColor: EMBRY.bgDeep,
  whiteSpace: 'nowrap',
  userSelect: 'none',
  position: 'sticky',
  top: 0,
  zIndex: 1,
}

const tdStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  borderBottom: `1px solid ${EMBRY.border}`,
  color: EMBRY.white,
}

const slideOverStyle: React.CSSProperties = {
  width: 440,
  backgroundColor: EMBRY.bgPanel,
  borderLeft: `1px solid ${EMBRY.border}`,
  overflow: 'auto',
  flexShrink: 0,
}

function paginationBtn(enabled: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    fontWeight: 700,
    padding: '4px 12px',
    borderRadius: 4,
    border: `1px solid ${EMBRY.border}`,
    backgroundColor: enabled ? EMBRY.bgDeep : 'transparent',
    color: enabled ? EMBRY.white : EMBRY.muted,
    cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.5,
  }
}

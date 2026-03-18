import { useState, useMemo } from 'react'
import { EMBRY, label, glowDot } from '../common/EmbryStyle'
import { useURLsPaginated } from '../../../hooks/useSpartaCollections'
import type { SpartaURL } from '../../../hooks/useSpartaCollections'

const PAGE_SIZE = 100

export function URLsView() {
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [domainFilter, setDomainFilter] = useState<string | null>(null)
  const [selected, setSelected] = useState<SpartaURL | null>(null)

  const { data: urls, total, loading, error } = useURLsPaginated(page, PAGE_SIZE)
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const domains = useMemo(() => {
    const d = new Map<string, number>()
    for (const u of urls) {
      d.set(u.domain, (d.get(u.domain) ?? 0) + 1)
    }
    return [...d.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
  }, [urls])

  const filtered = urls.filter((u) => {
    if (domainFilter && u.domain !== domainFilter) return false
    if (search && !u.url.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  if (error) {
    return <div style={{ padding: 20, color: EMBRY.red, border: `1px solid ${EMBRY.red}33`, borderRadius: 8, margin: 16 }}>Error: {error}</div>
  }

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Summary bar */}
        <div style={{ display: 'flex', gap: 16, padding: '12px 16px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={glowDot(EMBRY.blue, 8)} />
            <span style={{ fontSize: 13, fontWeight: 700, color: EMBRY.white }}>{total.toLocaleString()}</span>
            <span style={{ fontSize: 11, color: EMBRY.dim }}>total URLs</span>
          </div>
          <div style={{ flex: 1 }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this page..."
            style={{
              backgroundColor: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`,
              borderRadius: 6, padding: '5px 10px', fontSize: 12, color: EMBRY.white, outline: 'none', width: 200,
            }}
          />
        </div>

        {/* Domain filter pills */}
        <div style={{ display: 'flex', gap: 4, padding: '8px 16px', borderBottom: `1px solid ${EMBRY.border}`, flexWrap: 'wrap', flexShrink: 0 }}>
          <button
            onClick={() => setDomainFilter(null)}
            style={{ ...pillStyle, color: !domainFilter ? EMBRY.white : EMBRY.dim, backgroundColor: !domainFilter ? EMBRY.muted : 'transparent' }}
          >
            ALL
          </button>
          {domains.map(([domain, count]) => (
            <button
              key={domain}
              onClick={() => setDomainFilter(domainFilter === domain ? null : domain)}
              style={{ ...pillStyle, color: domainFilter === domain ? EMBRY.white : EMBRY.dim, backgroundColor: domainFilter === domain ? `${EMBRY.blue}22` : 'transparent' }}
            >
              {domain} ({count})
            </button>
          ))}
        </div>

        {/* Table */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading ? (
            <div style={{ padding: 20, color: EMBRY.dim }}>Loading page {page + 1}...</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>ID</th>
                  <th style={{ ...thStyle, width: '55%' }}>URL</th>
                  <th style={thStyle}>Domain</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr
                    key={u._key}
                    onClick={() => setSelected(u)}
                    style={{ cursor: 'pointer', backgroundColor: selected?._key === u._key ? `${EMBRY.accent}12` : 'transparent' }}
                    onMouseEnter={(e) => { if (selected?._key !== u._key) e.currentTarget.style.backgroundColor = `${EMBRY.blue}08` }}
                    onMouseLeave={(e) => { if (selected?._key !== u._key) e.currentTarget.style.backgroundColor = 'transparent' }}
                  >
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 10, color: EMBRY.dim }}>{u.url_id}</td>
                    <td style={{ ...tdStyle, color: '#6cb4ff', fontSize: 11, maxWidth: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {u.url}
                    </td>
                    <td style={{ ...tdStyle, fontSize: 11, color: EMBRY.dim }}>{u.domain}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        <div style={{ padding: '8px 16px', borderTop: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
          <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} style={paginationBtn(page > 0)}>Prev</button>
          <span style={{ fontSize: 12, color: EMBRY.dim }}>Page {page + 1} of {totalPages || 1}</span>
          <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} style={paginationBtn(page < totalPages - 1)}>Next</button>
          <span style={{ fontSize: 11, color: EMBRY.muted, marginLeft: 'auto' }}>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Detail slide-over */}
      {selected && (
        <div style={slideOverStyle}>
          <div style={{ padding: '16px 20px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ ...label, marginBottom: 4 }}>URL Details</div>
              <div style={{ fontSize: 11, fontFamily: 'monospace', color: EMBRY.blue }}>#{selected.url_id}</div>
            </div>
            <button onClick={() => setSelected(null)} style={{ background: 'none', border: `1px solid ${EMBRY.border}`, borderRadius: 6, color: EMBRY.dim, fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>
              Close
            </button>
          </div>
          <div style={{ padding: '12px 20px' }}>
            <div style={{ ...label, marginBottom: 4 }}>URL</div>
            <a href={selected.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#6cb4ff', wordBreak: 'break-all', textDecoration: 'none' }}>
              {selected.url}
            </a>
          </div>
          <div style={{ padding: '12px 20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={label}>Domain</div>
              <div style={{ fontSize: 12, color: EMBRY.white, marginTop: 4 }}>{selected.domain}</div>
            </div>
            {selected.updated_at && (
              <div>
                <div style={label}>Last Updated</div>
                <div style={{ fontSize: 12, color: EMBRY.dim, marginTop: 4 }}>{new Date(selected.updated_at * 1000).toLocaleDateString()}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const pillStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
  border: `1px solid ${EMBRY.border}`, cursor: 'pointer', background: 'none',
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
const slideOverStyle: React.CSSProperties = {
  width: 420, backgroundColor: EMBRY.bgPanel, borderLeft: `1px solid ${EMBRY.border}`, overflow: 'auto', flexShrink: 0,
}
function paginationBtn(enabled: boolean): React.CSSProperties {
  return {
    fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 4,
    border: `1px solid ${EMBRY.border}`, backgroundColor: enabled ? EMBRY.bgDeep : 'transparent',
    color: enabled ? EMBRY.white : EMBRY.muted, cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.5,
  }
}

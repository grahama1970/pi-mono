import { useState, useMemo, useEffect, useCallback } from 'react'
import { EMBRY, label, glowDot } from '../common/EmbryStyle'
import { useURLsPaginated } from '../../../hooks/useSpartaCollections'
import type { SpartaURL } from '../../../hooks/useSpartaCollections'

const API = '/api/memory'
const DAEMON = 'http://localhost:3001/api/memory'
const PAGE_SIZE = 100

/** Pipeline status for a single URL, enriched client-side. */
interface URLPipelineRow extends SpartaURL {
  control_ids: string[]
  fetched: boolean
  fetch_status: number | null
  fetch_error: string | null
  knowledge_chunks: number
}

/** Batch-enrich a page of URLs with 3 batch API calls instead of N per-URL calls. */
async function enrichURLs(urls: SpartaURL[]): Promise<URLPipelineRow[]> {
  if (urls.length === 0) return []

  const urlIds = urls.map((u) => u.url_id)
  const post = (path: string, body: Record<string, unknown>) =>
    fetch(`${DAEMON}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((r) => r.json())
      .catch(() => ({ documents: [] }))

  // 3 batch calls (not 100+ per-URL calls)
  const [ctrlRes, contentRes, knowRes] = await Promise.all([
    post('/recall/by-keys', { collection: 'sparta_control_urls', keys: urlIds, key_field: 'url_id', return_fields: ['url_id', 'control_id'] }),
    post('/recall/by-keys', { collection: 'sparta_url_content', keys: urlIds, key_field: 'url_id', return_fields: ['url_id', 'status_code', 'error_message'] }),
    post('/recall/by-keys', { collection: 'sparta_url_knowledge', keys: urlIds, key_field: 'url_id', return_fields: ['url_id'] }),
  ])

  // Client-side join
  const ctrlMap = new Map<number, string[]>()
  for (const d of ctrlRes.documents ?? []) {
    const uid = d.url_id as number
    if (!ctrlMap.has(uid)) ctrlMap.set(uid, [])
    if (d.control_id) ctrlMap.get(uid)!.push(d.control_id as string)
  }

  const contentMap = new Map<number, { status: number | null; error: string | null }>()
  for (const d of contentRes.documents ?? []) {
    contentMap.set(d.url_id as number, { status: d.status_code as number | null, error: d.error_message as string | null })
  }

  const chunkCounts = new Map<number, number>()
  for (const d of knowRes.documents ?? []) {
    const uid = d.url_id as number
    chunkCounts.set(uid, (chunkCounts.get(uid) ?? 0) + 1)
  }

  return urls.map((url) => {
    const uid = url.url_id
    const content = contentMap.get(uid)
    return {
      ...url,
      control_ids: ctrlMap.get(uid) ?? [],
      fetched: contentMap.has(uid),
      fetch_status: content?.status ?? null,
      fetch_error: content?.error ?? null,
      knowledge_chunks: chunkCounts.get(uid) ?? 0,
    }
  })
}

export function URLsView() {
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [domainFilter, setDomainFilter] = useState<string | null>(null)
  const [selected, setSelected] = useState<URLPipelineRow | null>(null)
  const [enrichedUrls, setEnrichedUrls] = useState<URLPipelineRow[]>([])
  const [enriching, setEnriching] = useState(false)

  const { data: urls, total, loading, error } = useURLsPaginated(page, PAGE_SIZE)
  const totalPages = Math.ceil(total / PAGE_SIZE)

  // Enrich URLs when page data loads
  useEffect(() => {
    if (urls.length === 0) return
    let cancelled = false
    setEnriching(true)
    enrichURLs(urls).then((enriched) => {
      if (!cancelled) {
        setEnrichedUrls(enriched)
        setEnriching(false)
      }
    })
    return () => { cancelled = true }
  }, [urls])

  const domains = useMemo(() => {
    const d = new Map<string, number>()
    for (const u of enrichedUrls) d.set(u.domain, (d.get(u.domain) ?? 0) + 1)
    return [...d.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
  }, [enrichedUrls])

  const filtered = enrichedUrls.filter((u) => {
    if (domainFilter && u.domain !== domainFilter) return false
    if (search && !u.url.toLowerCase().includes(search.toLowerCase()) && !u.control_ids.some((c) => c.toLowerCase().includes(search.toLowerCase()))) return false
    return true
  })

  if (error) {
    return <div style={{ padding: 20, color: EMBRY.red, border: `1px solid ${EMBRY.red}33`, borderRadius: 8, margin: 16 }}>Error: {error}</div>
  }

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', gap: 16, padding: '12px 16px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0, alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={glowDot(EMBRY.blue, 8)} />
            <span style={{ fontSize: 13, fontWeight: 700, color: EMBRY.white }}>{total.toLocaleString()}</span>
            <span style={{ fontSize: 11, color: EMBRY.dim }}>URLs</span>
            {enriching && <span style={{ fontSize: 10, color: EMBRY.amber }}>enriching...</span>}
          </div>
          <div style={{ flex: 1 }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search URLs or control IDs..."
            style={{ backgroundColor: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`, borderRadius: 6, padding: '5px 10px', fontSize: 12, color: EMBRY.white, outline: 'none', width: 220 }}
          />
        </div>

        {/* Domain pills */}
        <div style={{ display: 'flex', gap: 4, padding: '8px 16px', borderBottom: `1px solid ${EMBRY.border}`, flexWrap: 'wrap', flexShrink: 0 }}>
          <button onClick={() => setDomainFilter(null)} style={{ ...pillStyle, color: !domainFilter ? EMBRY.white : EMBRY.dim, backgroundColor: !domainFilter ? EMBRY.muted : 'transparent' }}>ALL</button>
          {domains.map(([domain, count]) => (
            <button key={domain} onClick={() => setDomainFilter(domainFilter === domain ? null : domain)} style={{ ...pillStyle, color: domainFilter === domain ? EMBRY.white : EMBRY.dim, backgroundColor: domainFilter === domain ? `${EMBRY.blue}22` : 'transparent' }}>
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
                  <th style={{ ...thStyle, width: 28 }}></th>
                  <th style={thStyle}>Controls</th>
                  <th style={{ ...thStyle, width: '45%' }}>URL</th>
                  <th style={thStyle}>Fetched</th>
                  <th style={thStyle}>Chunks</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const allGood = u.fetched && u.knowledge_chunks > 0 && u.control_ids.length > 0
                  const partial = u.fetched && u.knowledge_chunks === 0
                  const rowColor = allGood ? EMBRY.green : partial ? EMBRY.amber : u.fetched ? EMBRY.amber : EMBRY.red
                  const isSelected = selected?._key === u._key
                  return (
                    <tr
                      key={u._key}
                      onClick={() => setSelected(u)}
                      style={{ cursor: 'pointer', backgroundColor: isSelected ? `${EMBRY.accent}12` : 'transparent' }}
                      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = `${EMBRY.blue}08` }}
                      onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent' }}
                    >
                      <td style={{ ...tdStyle, textAlign: 'center' }}><div style={glowDot(rowColor, 6)} /></td>
                      <td style={tdStyle}>
                        {u.control_ids.length > 0 ? (
                          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                            {u.control_ids.slice(0, 3).map((cid) => (
                              <span key={cid} style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 700, color: EMBRY.blue, padding: '1px 4px', borderRadius: 3, backgroundColor: `${EMBRY.blue}12` }}>{cid}</span>
                            ))}
                            {u.control_ids.length > 3 && <span style={{ fontSize: 9, color: EMBRY.dim }}>+{u.control_ids.length - 3}</span>}
                          </div>
                        ) : (
                          <span style={{ fontSize: 10, color: EMBRY.red }}>orphan</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, color: '#6cb4ff', fontSize: 11, maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {u.url}
                      </td>
                      <td style={tdStyle}>
                        {u.fetched ? (
                          <span style={{ fontSize: 10, color: u.fetch_status === 200 ? EMBRY.green : EMBRY.amber }}>{u.fetch_status ?? 'yes'}</span>
                        ) : (
                          <span style={{ fontSize: 10, color: EMBRY.red }}>{u.fetch_error ? u.fetch_error.slice(0, 15) : 'no'}</span>
                        )}
                      </td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, color: u.knowledge_chunks > 0 ? EMBRY.green : EMBRY.dim }}>
                        {u.knowledge_chunks}
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
          <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} style={paginationBtn(page > 0)}>Prev</button>
          <span style={{ fontSize: 12, color: EMBRY.dim }}>Page {page + 1} of {totalPages || 1}</span>
          <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} style={paginationBtn(page < totalPages - 1)}>Next</button>
          <span style={{ fontSize: 11, color: EMBRY.muted, marginLeft: 'auto' }}>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
          </span>
        </div>
      </div>

      {/* Detail slide-over */}
      {selected && <URLDetailPane url={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

/* ── URL Detail Pane ─────────────────────────────────────────────────────── */

function URLDetailPane({ url, onClose }: { url: URLPipelineRow; onClose: () => void }) {
  const [knowledge, setKnowledge] = useState<Array<{ text?: string; topic?: string }>>([])
  const [cleanText, setCleanText] = useState<string | null>(null)
  const [textLength, setTextLength] = useState<number>(0)
  const [loadingK, setLoadingK] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoadingK(true)
    setCleanText(null)
    const post = (path: string, body: Record<string, unknown>) =>
      fetch(`${DAEMON}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then((r) => r.json()).catch(() => ({ documents: [] }))

    Promise.all([
      post('/recall/by-keys', { collection: 'sparta_url_knowledge', keys: [url.url_id], key_field: 'url_id', return_fields: ['url_id', 'text', 'topic'] }),
      post('/recall/by-keys', { collection: 'sparta_url_content', keys: [url.url_id], key_field: 'url_id', return_fields: ['url_id', 'clean_text', 'text_length', 'status_code'] }),
    ]).then(([knowRes, contentRes]) => {
      if (cancelled) return
      setKnowledge(knowRes.documents ?? [])
      const content = (contentRes.documents ?? [])[0]
      if (content?.clean_text) {
        setCleanText(content.clean_text as string)
        setTextLength(content.text_length as number ?? 0)
      }
      setLoadingK(false)
    })
    return () => { cancelled = true }
  }, [url.url_id])

  const allGood = url.fetched && url.knowledge_chunks > 0 && url.control_ids.length > 0

  return (
    <div style={slideOverStyle}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <div style={{ ...label, marginBottom: 4 }}>URL Pipeline Status</div>
          <div style={{ fontSize: 10, color: allGood ? EMBRY.green : EMBRY.red, fontWeight: 700 }}>
            {allGood ? 'COMPLETE' : 'INCOMPLETE'}
          </div>
        </div>
        <button onClick={onClose} style={{ background: 'none', border: `1px solid ${EMBRY.border}`, borderRadius: 6, color: EMBRY.dim, fontSize: 11, padding: '4px 10px', cursor: 'pointer' }}>Close</button>
      </div>

      {/* URL */}
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
        <a href={url.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#6cb4ff', wordBreak: 'break-all', textDecoration: 'none' }}>{url.url}</a>
      </div>

      {/* Pipeline stages */}
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
        <div style={{ ...label, marginBottom: 8 }}>Pipeline Stages</div>
        <StatusRow label="Control Mapping" value={`${url.control_ids.length} controls`} ok={url.control_ids.length > 0} />
        <StatusRow label="Content Fetched" value={url.fetched ? `HTTP ${url.fetch_status}` : url.fetch_error || 'Not fetched'} ok={url.fetched && url.fetch_status === 200} />
        <StatusRow label="Clean Text" value={cleanText ? `${textLength.toLocaleString()} chars` : 'Not extracted'} ok={!!cleanText} />
        <StatusRow label="Knowledge Chunks" value={`${url.knowledge_chunks} extracted`} ok={url.knowledge_chunks > 0} />
      </div>

      {/* Clean extracted text */}
      {cleanText && (
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={{ ...label, marginBottom: 6 }}>Clean Content ({textLength.toLocaleString()} chars)</div>
          <div style={{
            fontSize: 12, lineHeight: 1.6, color: EMBRY.dim,
            maxHeight: 300, overflow: 'auto',
            padding: 12, borderRadius: 6,
            backgroundColor: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`,
            whiteSpace: 'pre-wrap', fontFamily: 'inherit',
          }}>
            {cleanText.slice(0, 3000)}{cleanText.length > 3000 ? '\n\n... (truncated)' : ''}
          </div>
        </div>
      )}

      {/* Linked controls */}
      {url.control_ids.length > 0 && (
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={{ ...label, marginBottom: 6 }}>Linked Controls ({url.control_ids.length})</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {url.control_ids.map((cid) => (
              <span key={cid} style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 700, color: EMBRY.blue, padding: '2px 6px', borderRadius: 4, backgroundColor: `${EMBRY.blue}12`, border: `1px solid ${EMBRY.blue}22` }}>{cid}</span>
            ))}
          </div>
        </div>
      )}

      {/* Knowledge content */}
      <div style={{ padding: '12px 20px' }}>
        <div style={{ ...label, marginBottom: 6 }}>Knowledge Chunks ({url.knowledge_chunks})</div>
        {loadingK ? (
          <div style={{ fontSize: 11, color: EMBRY.dim }}>Loading...</div>
        ) : knowledge.length === 0 ? (
          <div style={{ fontSize: 11, color: EMBRY.red, padding: 8, borderRadius: 4, backgroundColor: `${EMBRY.red}08` }}>
            No content extracted from this URL
          </div>
        ) : (
          knowledge.map((k, i) => (
            <div key={`k-${i}`} style={{ padding: '8px 10px', borderRadius: 6, border: `1px solid ${EMBRY.border}`, marginBottom: 6, fontSize: 12, lineHeight: 1.5 }}>
              {k.topic && <div style={{ fontSize: 10, color: EMBRY.accent, marginBottom: 3 }}>{k.topic}</div>}
              <div style={{ color: EMBRY.dim }}>{(k.text ?? '').slice(0, 300)}{(k.text ?? '').length > 300 ? '...' : ''}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function StatusRow({ label: l, value, ok }: { label: string; value: string; ok: boolean | null }) {
  const color = ok === null ? EMBRY.dim : ok ? EMBRY.green : EMBRY.red
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <div style={glowDot(color, 6)} />
      <span style={{ fontSize: 10, color: EMBRY.muted, width: 110, flexShrink: 0 }}>{l}</span>
      <span style={{ fontSize: 11, color: ok ? EMBRY.white : EMBRY.red }}>{value}</span>
    </div>
  )
}

/* ── Styles ──────────────────────────────────────────────────────────────── */

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
  width: 440, backgroundColor: EMBRY.bgPanel, borderLeft: `1px solid ${EMBRY.border}`, overflow: 'auto', flexShrink: 0,
}
function paginationBtn(enabled: boolean): React.CSSProperties {
  return {
    fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 4,
    border: `1px solid ${EMBRY.border}`, backgroundColor: enabled ? EMBRY.bgDeep : 'transparent',
    color: enabled ? EMBRY.white : EMBRY.muted, cursor: enabled ? 'pointer' : 'default', opacity: enabled ? 1 : 0.5,
  }
}

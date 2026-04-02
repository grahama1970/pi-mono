import { useState, useMemo } from 'react'
import { EMBRY, card, label, heading, body } from '../common/EmbryStyle'
import { useKnowledge } from '../../../hooks/useSpartaCollections'
import type { SpartaURLKnowledge } from '../../../hooks/useSpartaCollections'
import { useRegisterAction } from '../../../hooks/useRegisterAction'

type QualityFilter = 'all' | 'ok' | 'empty' | 'error'

function qualityBadge(chunks: SpartaURLKnowledge[]): { color: string; label: string } {
  if (chunks.length === 0) return { color: EMBRY.amber, label: 'empty' }
  const hasError = chunks.some((c) => !c.text || c.text.length < 10)
  if (hasError) return { color: EMBRY.red, label: 'error' }
  return { color: EMBRY.green, label: 'ok' }
}

export function KnowledgeView() {
  const { data: knowledge, loading, error } = useKnowledge()
  const [selectedUrl, setSelectedUrl] = useState<string | null>(null)
  const [qualityFilter, setQualityFilter] = useState<QualityFilter>('all')
  const [search, setSearch] = useState('')

  useRegisterAction('knowledge:search:url', { app: 'sparta-explorer', action: 'SEARCH_URL', label: 'Search Knowledge URLs', description: 'Filter knowledge sources by URL string' })
  useRegisterAction('knowledge:filter:quality', { app: 'sparta-explorer', action: 'FILTER_QUALITY', label: 'Filter by Quality', description: 'Filter knowledge sources by data quality (all/ok/empty/error)' })
  useRegisterAction('knowledge:select:url', { app: 'sparta-explorer', action: 'SELECT_URL', label: 'Select Knowledge Source', description: 'Select a knowledge source URL to view its chunks' })

  // Group chunks by url_id, extract URL string from first chunk that has it
  const urlGroups = useMemo(() => {
    const groups = new Map<string, SpartaURLKnowledge[]>()
    for (const chunk of knowledge) {
      const key = String(chunk.url_id ?? 'unknown')
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key)!.push(chunk)
    }
    return groups
  }, [knowledge])

  // Build url_id → URL string lookup from chunks (they have a `url` field)
  const urlLookup = useMemo(() => {
    const lookup = new Map<string, string>()
    for (const chunk of knowledge) {
      const key = String(chunk.url_id ?? 'unknown')
      const url = (chunk as Record<string, unknown>).url as string | undefined
      if (url && !lookup.has(key)) lookup.set(key, url)
    }
    return lookup
  }, [knowledge])

  // URL list with quality
  const urlList = useMemo(() => {
    return [...urlGroups.entries()].map(([urlId, chunks]) => ({
      urlId,
      url: urlLookup.get(urlId) ?? urlId,
      chunks,
      quality: qualityBadge(chunks),
      topicCount: new Set(chunks.map((c) => c.topic).filter(Boolean)).size,
    })).filter((item) => {
      if (qualityFilter !== 'all' && item.quality.label !== qualityFilter) return false
      if (search) {
        const q = search.toLowerCase()
        return item.urlId.toLowerCase().includes(q) || item.url.toLowerCase().includes(q)
      }
      return true
    }).sort((a, b) => {
      // Error/empty first
      const order = { error: 0, empty: 1, ok: 2 }
      return (order[a.quality.label as keyof typeof order] ?? 2) - (order[b.quality.label as keyof typeof order] ?? 2)
    })
  }, [urlGroups, urlLookup, qualityFilter, search])

  const selectedChunks = selectedUrl ? (urlGroups.get(selectedUrl) ?? []) : []

  if (error) {
    return <div style={{ padding: 20, color: EMBRY.red, border: `1px solid ${EMBRY.red}33`, borderRadius: 8, margin: 16 }}>Error: {error}</div>
  }

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Left: URL list */}
      <div style={{ width: 360, borderRight: `1px solid ${EMBRY.border}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        {/* Filters */}
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={heading}>Knowledge Sources</div>
          <input
            data-qid="knowledge:search:url"
            title="Search knowledge sources by URL"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search URLs..."
            style={{
              backgroundColor: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`,
              borderRadius: 6, padding: '5px 10px', fontSize: 12, color: EMBRY.white, outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'ok', 'empty', 'error'] as QualityFilter[]).map((f) => (
              <button
                key={f}
                data-qid={`knowledge:filter:quality:${f}`}
                title={`Show ${f === 'all' ? 'all knowledge sources' : `knowledge sources with quality: ${f}`}`}
                onClick={() => setQualityFilter(f)}
                style={{
                  fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                  border: `1px solid ${EMBRY.border}`, cursor: 'pointer', background: 'none',
                  color: qualityFilter === f ? EMBRY.white : EMBRY.dim,
                  backgroundColor: qualityFilter === f ? EMBRY.muted : 'transparent',
                }}
              >
                {f}
              </button>
            ))}
          </div>
          <div style={{ ...label }}>{urlList.length} sources</div>
        </div>

        {/* URL list */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading ? (
            <div style={{ padding: 16, color: EMBRY.dim }}>Loading knowledge...</div>
          ) : (
            urlList.map((item) => (
              <div
                key={item.urlId}
                data-qid={`knowledge:select:url:${item.urlId}`}
                title={`View ${item.chunks.length} chunks from: ${item.url}`}
                onClick={() => setSelectedUrl(item.urlId)}
                style={{
                  padding: '10px 16px',
                  borderBottom: `1px solid ${EMBRY.border}`,
                  cursor: 'pointer',
                  backgroundColor: selectedUrl === item.urlId ? `${EMBRY.blue}10` : 'transparent',
                }}
                onMouseEnter={(e) => { if (selectedUrl !== item.urlId) e.currentTarget.style.backgroundColor = `${EMBRY.blue}06` }}
                onMouseLeave={(e) => { if (selectedUrl !== item.urlId) e.currentTarget.style.backgroundColor = 'transparent' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                    color: item.quality.color, backgroundColor: `${item.quality.color}18`,
                    border: `1px solid ${item.quality.color}33`,
                  }}>
                    {item.quality.label}
                  </span>
                  <span style={{ fontSize: 11, color: EMBRY.dim }}>{item.chunks.length} chunks</span>
                  <span style={{ fontSize: 11, color: EMBRY.dim }}>{item.topicCount} topics</span>
                </div>
                <div style={{ fontSize: 11, fontFamily: 'monospace', color: EMBRY.blue, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.url}>
                  {item.url}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Right: Chunk cards */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {!selectedUrl ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: EMBRY.dim }}>
            Select a URL to view knowledge chunks
          </div>
        ) : selectedChunks.length === 0 ? (
          <div style={{ color: EMBRY.dim, padding: 20 }}>No chunks found for this URL</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ ...heading, marginBottom: 4 }}>
              {selectedChunks.length} chunks from {selectedUrl}
            </div>
            {selectedChunks.map((chunk) => (
              <div key={chunk._key} style={{ ...card }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  {chunk.topic && (
                    <span style={{ fontSize: 11, fontWeight: 700, color: EMBRY.accent }}>
                      {chunk.topic}
                    </span>
                  )}
                  {chunk.excerpt_type && (
                    <span style={{
                      fontSize: 9, padding: '1px 5px', borderRadius: 3,
                      color: EMBRY.dim, backgroundColor: EMBRY.bgDeep,
                      border: `1px solid ${EMBRY.border}`,
                    }}>
                      {chunk.excerpt_type}
                    </span>
                  )}
                  {chunk.source_framework && (
                    <span style={{ fontSize: 9, color: EMBRY.dim }}>
                      {chunk.source_framework}
                    </span>
                  )}
                </div>
                <div style={{ ...body, color: EMBRY.dim, fontSize: 12, lineHeight: 1.6 }}>
                  {chunk.text.length > 400 ? chunk.text.slice(0, 400) + '...' : chunk.text}
                </div>
                {chunk.control_ids && chunk.control_ids.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 8, flexWrap: 'wrap' }}>
                    {chunk.control_ids.map((cid) => (
                      <span key={cid} style={{
                        fontSize: 9, fontFamily: 'monospace', padding: '1px 5px', borderRadius: 3,
                        color: EMBRY.blue, backgroundColor: `${EMBRY.blue}12`, border: `1px solid ${EMBRY.blue}22`,
                      }}>
                        {cid}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

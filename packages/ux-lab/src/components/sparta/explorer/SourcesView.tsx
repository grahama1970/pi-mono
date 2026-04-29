import { useState, useMemo, useEffect, useCallback } from 'react'
import { EMBRY, label, heading, glowDot } from '../common/EmbryStyle'
import { useControlsByFramework, useRawFrameworkCounts, useURLs } from '../../../hooks/useSpartaCollections'
import type { SpartaControl, SpartaURL } from '../../../hooks/useSpartaCollections'
import { ControlIdPills } from '../common/ControlIdPills'
import { useSpartaNav } from './SpartaExplorer'
import { applyMagneticHover, removeMagneticHover, magneticRow, magneticRowSelected } from '../common/TableStyles'
import { UtilityBar } from '../common/UtilityBar'
import { useToast } from '../common/Toast'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import { useWorksheets, worksheetToSourceDef } from '../../../hooks/useWorksheets'
import type { SourceDef } from '../../../hooks/useWorksheets'

const TYPE_COLORS: Record<string, string> = {
  technique: '#e06c75', attack_technique: '#e06c75', attack_mobile_technique: '#e06c75',
  attack_ics_technique: '#e06c75', esa_technique: '#e06c75', d3fend_technique: '#61afef',
  malware: '#c678dd', tool: '#d19a66',
  countermeasure: '#98c379', 'course-of-action': '#98c379',
  indicator: '#e5c07b', cwe_weakness: '#e06c75', weakness: '#e06c75',
  control: '#56b6c2', nist_control: '#56b6c2',
  artifact: '#61afef', d3fend_artifact: '#61afef',
  tactic: '#c678dd', space_threat: '#e5c07b',
  reference: '#abb2bf', requirement: '#abb2bf',
}
function typeColor(type: string): string { return TYPE_COLORS[type] ?? EMBRY.dim }

function sourceHealth(count: number, min: number): { color: string; label: string } {
  if (count === 0) return { color: EMBRY.red, label: 'empty' }
  if (count < min) return { color: EMBRY.amber, label: 'low' }
  return { color: EMBRY.green, label: 'ok' }
}

const PAGE_SIZE = 100

function isPlaceholder(desc?: string): boolean {
  if (!desc) return false
  const lower = desc.toLowerCase()
  return lower.includes('this control requires qra generation')
}

function cleanDescriptionPreview(desc: string): string {
  // Strip [INFERRED...] prefix and [Cross-references] section for table preview
  let text = desc.replace(/^\[INFERRED[^\]]*\]\s*/i, '')
  const xrefIdx = text.indexOf('[Cross-references]')
  if (xrefIdx >= 0) text = text.slice(0, xrefIdx).trim()
  return text
}

function descriptionCell(desc?: string) {
  if (!desc) return <span style={{ color: EMBRY.red, fontSize: 9 }}>MISSING</span>
  if (isPlaceholder(desc)) return <span style={{ color: EMBRY.amber, fontSize: 9 }}>NEEDS DESCRIPTION</span>
  const clean = cleanDescriptionPreview(desc)
  const text = clean.length > 120 ? clean.slice(0, 120) + '...' : clean
  const isInferred = desc.startsWith('[INFERRED')
  return (
    <span style={{ color: EMBRY.dim }}>
      {isInferred && <span style={{ color: EMBRY.amber, fontSize: 8, marginRight: 4 }}>INFERRED</span>}
      {text}
    </span>
  )
}

// ── URL domain grouping ─────────────────────────────────────────────────────

interface DomainGroup { domain: string; count: number }

function useURLDomains(): { domains: DomainGroup[]; total: number; loading: boolean } {
  const [domains, setDomains] = useState<DomainGroup[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  const fetchDomains = useCallback(async () => {
    try {
      // Sample URLs to build domain distribution
      const API = 'http://localhost:3001/api/memory'
      const counts = new Map<string, number>()
      const batchSize = 200
      let offset = 0
      let dbTotal = 0

      for (let i = 0; i < 6; i++) {
        const res = await fetch(`${API}/list`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ collection: 'sparta_urls', limit: batchSize, offset, return_fields: ['domain'] }),
        })
        const d = await res.json()
        dbTotal = d.total
        if (!d.documents?.length) break
        for (const doc of d.documents) {
          const dom = (doc as { domain?: string }).domain ?? 'unknown'
          counts.set(dom, (counts.get(dom) ?? 0) + 1)
        }
        offset += batchSize
        if (offset >= dbTotal) break
      }

      const sorted = [...counts.entries()]
        .map(([domain, count]) => ({ domain, count }))
        .sort((a, b) => b.count - a.count)

      setDomains(sorted)
      setTotal(dbTotal)
    } catch {
      setDomains([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchDomains() }, [fetchDomains])
  return { domains, total, loading }
}

// ── Main component ──────────────────────────────────────────────────────────

type ViewMode = { type: 'source'; idx: number } | { type: 'domain'; domain: string }

const API_MEM = 'http://localhost:3001/api/memory'

export function SourcesView() {
  // ── Action registrations ──
  useRegisterAction('sources:source:select', { app: 'sparta-explorer', action: 'SELECT_SOURCE', label: 'Select Source', description: 'Select a pipeline source to view its controls' })
  useRegisterAction('sources:domain:select', { app: 'sparta-explorer', action: 'SELECT_DOMAIN', label: 'Select Domain', description: 'Select a URL domain to view its URLs' })
  useRegisterAction('sources:section:urls', { app: 'sparta-explorer', action: 'TOGGLE_URLS', label: 'Toggle URLs', description: 'Expand/collapse the URL domains section' })
  useRegisterAction('sources:control:select', { app: 'sparta-explorer', action: 'SELECT_CONTROL', label: 'Select Control', description: 'Select a control in the sources table' })
  useRegisterAction('sources:url:select', { app: 'sparta-explorer', action: 'SELECT_URL', label: 'Select URL', description: 'Select a URL in the domain table' })
  useRegisterAction('sources:detail:close', { app: 'sparta-explorer', action: 'CLOSE_DETAIL', label: 'Close Detail', description: 'Close the detail flyout' })
  useRegisterAction('sources:page:prev', { app: 'sparta-explorer', action: 'PAGE_PREV', label: 'Previous Page', description: 'Navigate to previous page' })
  useRegisterAction('sources:page:next', { app: 'sparta-explorer', action: 'PAGE_NEXT', label: 'Next Page', description: 'Navigate to next page' })
  useRegisterAction('sources:detail:nav-qras', { app: 'sparta-explorer', action: 'NAVIGATE_TO_QRAS', label: 'View QRAs', description: 'Navigate to QRAs tab filtered by this control' })
  useRegisterAction('sources:detail:nav-rels', { app: 'sparta-explorer', action: 'NAVIGATE_TO_RELATIONSHIPS', label: 'View Relationships', description: 'Navigate to Relationships tab filtered by this control' })

  const { data: fwCounts, loading: fwLoading } = useRawFrameworkCounts()
  const { domains: urlDomains, total: urlTotal, loading: urlsLoading } = useURLDomains()
  const { worksheets, loading: wsLoading } = useWorksheets()
  const sources = useMemo(() => {
    if (!worksheets) return []
    return Object.entries(worksheets).map(([name, config]) => worksheetToSourceDef(name, config))
  }, [worksheets])
  const [view, setView] = useState<ViewMode | null>(null)
  const [selectedControl, setSelectedControl] = useState<SpartaControl | null>(null)
  const [selectedUrl, setSelectedUrl] = useState<SpartaURL | null>(null)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [toast, showToast] = useToast()

  // Server-side per-type counts for accurate sidebar numbers
  const [typeCounts, setTypeCounts] = useState<Map<string, number>>(new Map())
  useEffect(() => {
    // Fetch exact counts for each source that has a controlType
    const queries = sources.filter(s => s.controlType).map(async (src) => {
      for (const fw of src.rawFrameworks) {
        try {
          const res = await fetch(`${API_MEM}/list`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ collection: 'sparta_controls', limit: 1, return_fields: ['_key'], filters: { source_framework: fw, control_type: src.controlType } }),
          })
          const data = await res.json()
          if (data.total > 0) return { key: `${fw}:${src.controlType}`, count: data.total }
        } catch { /* skip */ }
      }
      return null
    })
    Promise.all(queries).then(results => {
      const m = new Map<string, number>()
      for (const r of results) {
        if (r) m.set(r.key, r.count)
      }
      setTypeCounts(m)
    })
  }, [sources])
  const [urlsExpanded, setUrlsExpanded] = useState(false)

  useEffect(() => {
    if (!view && sources.length > 0) {
      setView({ type: 'source', idx: 0 })
    }
  }, [view, sources])

  const source = view?.type === 'source' ? sources[view.idx] : null
  const domainFilter = view?.type === 'domain' ? view.domain : null

  // Controls for source view — server-side filtered by framework + controlType
  const { data: controls, total: rawTotal, loading: ctrlLoading } = useControlsByFramework(
    source?.rawFrameworks ?? [],
    source?.controlType,
  )

  // Type counts from loaded data — used to fix sidebar counts for worksheet sources
  const loadedTypeCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of controls) {
      const t = c.control_type ?? 'unknown'
      m.set(t, (m.get(t) ?? 0) + 1)
    }
    return m
  }, [controls])

  // URLs for domain view
  const { data: urls, loading: urlLoading } = useURLs('', domainFilter ?? undefined)

  // Enrich URLs with pipeline status via batch /recall/by-keys
  const [enrichedUrls, setEnrichedUrls] = useState<Map<number, { control_ids: string[]; fetched: boolean; status: number | null; chunks: number }>>(new Map())
  useEffect(() => {
    if (urls.length === 0) return
    const DAEMON = 'http://localhost:3001/api/memory'
    const post = (path: string, body: Record<string, unknown>) =>
      fetch(`${DAEMON}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then((r) => r.json()).catch(() => ({ documents: [] }))
    const ids = urls.map((u) => u.url_id)
    Promise.all([
      post('/recall/by-keys', { collection: 'sparta_control_urls', keys: ids, key_field: 'url_id', return_fields: ['url_id', 'control_id'] }),
      post('/recall/by-keys', { collection: 'sparta_url_content', keys: ids, key_field: 'url_id', return_fields: ['url_id', 'status_code'] }),
      post('/recall/by-keys', { collection: 'sparta_url_knowledge', keys: ids, key_field: 'url_id', return_fields: ['url_id'] }),
    ]).then(([ctrlRes, contentRes, knowRes]) => {
      const m = new Map<number, { control_ids: string[]; fetched: boolean; status: number | null; chunks: number }>()
      const cmap = new Map<number, string[]>()
      for (const d of ctrlRes.documents ?? []) {
        const uid = d.url_id as number
        if (!cmap.has(uid)) cmap.set(uid, [])
        if (d.control_id) cmap.get(uid)!.push(d.control_id as string)
      }
      const smap = new Map<number, number>()
      for (const d of contentRes.documents ?? []) smap.set(d.url_id as number, d.status_code as number)
      const kmap = new Map<number, number>()
      for (const d of knowRes.documents ?? []) kmap.set(d.url_id as number, (kmap.get(d.url_id as number) ?? 0) + 1)
      for (const uid of ids) {
        m.set(uid, { control_ids: cmap.get(uid) ?? [], fetched: smap.has(uid), status: smap.get(uid) ?? null, chunks: kmap.get(uid) ?? 0 })
      }
      setEnrichedUrls(m)
    })
  }, [urls])

  // Apply search to controls
  const filteredControls = useMemo(() => {
    if (!search) return controls
    const q = search.toLowerCase()
    return controls.filter((c) =>
      (c.control_id ?? '').toLowerCase().includes(q) ||
      (c.name ?? '').toLowerCase().includes(q) ||
      (c.description ?? '').toLowerCase().includes(q)
    )
  }, [controls, search])

  // Apply search to URLs
  const filteredUrls = useMemo(() => {
    if (!search) return urls
    const q = search.toLowerCase()
    return urls.filter((u) => u.url.toLowerCase().includes(q))
  }, [urls, search])

  // Count lookup
  const countLookup = useMemo(() => {
    const m = new Map<string, number>()
    for (const fc of fwCounts) m.set(fc.name, (m.get(fc.name) ?? 0) + fc.count)
    return m
  }, [fwCounts])

  function getSourceCount(src: SourceDef): number {
    // 1. Server-side per-type count (most accurate for worksheets with controlType)
    if (src.controlType) {
      for (const fw of src.rawFrameworks) {
        const key = `${fw}:${src.controlType}`
        if (typeCounts.has(key)) return typeCounts.get(key)!
      }
      // Fallback: loaded data type count if available
      if (source && src.rawFrameworks.some((fw) => source.rawFrameworks.includes(fw)) && controls.length > 0) {
        return loadedTypeCounts.get(src.controlType) ?? 0
      }
    }
    // 2. Framework-level count (for sources without controlType)
    let total = 0
    for (const fw of src.rawFrameworks) total += countLookup.get(fw) ?? 0
    return total
  }

  function selectSource(idx: number) {
    const isSame = view?.type === 'source' && view.idx === idx
    setView(isSame ? null : { type: 'source', idx })
    setSelectedControl(null); setSelectedUrl(null); setPage(0); setSearch('')
  }

  function selectDomain(domain: string) {
    const isSame = view?.type === 'domain' && view.domain === domain
    setView(isSame ? null : { type: 'domain', domain })
    setSelectedControl(null); setSelectedUrl(null); setPage(0); setSearch('')
  }

  // Paginate the filtered controls for display
  const displayControls = useMemo(() => {
    const start = page * PAGE_SIZE
    return filteredControls.slice(start, start + PAGE_SIZE)
  }, [filteredControls, page])

  const totalPages = Math.ceil(filteredControls.length / PAGE_SIZE)

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      {/* Left pane: sources + domains */}
      <div style={{ width: 260, borderRight: `1px solid ${EMBRY.border}`, display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '10px 12px', borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={heading}>Sources</div>
          <div style={{ ...label, marginTop: 2 }}>Worksheets, external data, URLs</div>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {/* SPARTA worksheets */}
          <SectionHeader title="SPARTA-Data.xlsx" />
          {wsLoading ? (
            <div style={{ padding: '8px 12px', fontSize: 10, color: EMBRY.dim }}>Loading worksheets...</div>
          ) : sources.filter((s) => s.group === 'sparta').map((src) => {
            const idx = sources.indexOf(src)
            const isSelected = view?.type === 'source' && view.idx === idx
            const count = getSourceCount(src)
            const health = sourceHealth(count, src.minExpected)
            return (
              <SourceRow key={src.name} name={src.name} tooltip={src.tooltip} health={health}
                count={count} loading={fwLoading} isSelected={isSelected} onClick={() => selectSource(idx)} data-qid={`sources:source:${src.name.toLowerCase().replace(/\s+/g, '-')}`} data-qs-action="SELECT_SOURCE" />
            )
          })}

          {/* External */}
          <SectionHeader title="External Pipeline Sources" />
          {wsLoading ? null : sources.filter((s) => s.group === 'external').map((src) => {
            const idx = sources.indexOf(src)
            const isSelected = view?.type === 'source' && view.idx === idx
            const count = getSourceCount(src)
            const health = sourceHealth(count, src.minExpected)
            return (
              <SourceRow key={src.name} name={src.name} tooltip={src.tooltip} health={health}
                count={count} loading={fwLoading} isSelected={isSelected} onClick={() => selectSource(idx)} data-qid={`sources:source:${src.name.toLowerCase().replace(/\s+/g, '-')}`} data-qs-action="SELECT_SOURCE" />
            )
          })}

          {/* URLs by domain — collapsible */}
          <div
            data-qid="sources:section:urls-toggle"
            onClick={() => setUrlsExpanded(!urlsExpanded)}
            data-qs-action="TOGGLE_URLS"
            title="Toggle URL domains list"
            style={{ padding: '6px 12px', fontSize: 9, fontWeight: 700, color: EMBRY.muted, textTransform: 'uppercase', letterSpacing: '0.05em', backgroundColor: EMBRY.bgDeep, borderBottom: `1px solid ${EMBRY.border}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{ fontSize: 8 }}>{urlsExpanded ? '▼' : '▶'}</span>
            Fetched URLs ({urlsLoading ? '...' : (urlTotal ?? 0).toLocaleString()})
          </div>
          {urlsExpanded && urlDomains.slice(0, 20).map((dg) => {
            const isSelected = view?.type === 'domain' && view.domain === dg.domain
            return (
              <SourceRow key={dg.domain} name={dg.domain} tooltip={`${dg.count} URLs fetched from ${dg.domain}`}
                health={{ color: EMBRY.green, label: 'ok' }} count={dg.count} loading={urlsLoading}
                isSelected={isSelected} onClick={() => selectDomain(dg.domain)} mono data-qid={`sources:domain:${dg.domain}`} data-qs-action="SELECT_DOMAIN" />
            )
          })}
          {urlsExpanded && urlDomains.length > 20 && (
            <div style={{ padding: '6px 12px', fontSize: 9, color: EMBRY.muted }}>
              +{urlDomains.length - 20} more domains
            </div>
          )}
        </div>
      </div>

      {/* Middle: data table + flyout overlay */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {!view ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: EMBRY.dim }}>
            Select a worksheet, source, or domain
          </div>
        ) : view.type === 'source' && source ? (
          <>
            <div style={{ padding: '8px 12px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: EMBRY.white }}>{source.name}</div>
                <div style={{ fontSize: 10, color: EMBRY.dim }}>
                  {ctrlLoading ? 'Loading...' : `${filteredControls.length} controls${totalPages > 1 ? ` · page ${page + 1}/${totalPages}` : ''}`}
                  {source.controlType && <span style={{ marginLeft: 6, fontSize: 9, color: typeColor(source.controlType) }}>type: {source.controlType}</span>}
                </div>
              </div>              <input data-qid="sources:search:controls" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter controls..." data-qs-input="sources-search" title="Filter controls"
                style={{ width: 170, backgroundColor: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`, borderRadius: 4, padding: '4px 8px', fontSize: 11, color: EMBRY.white, outline: 'none' }} />
              <input data-qid="sources:search:urls" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter URLs..." data-qs-input="sources-search" title="Filter URLs"
                style={{ width: 170, backgroundColor: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`, borderRadius: 4, padding: '4px 8px', fontSize: 11, color: EMBRY.white, outline: 'none' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                <button data-qid="sources:page:prev" onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0 || totalPages <= 1} data-qs-action="PAGE_PREV" title="Previous page" style={{ ...btn, opacity: (page === 0 || totalPages <= 1) ? 0.3 : 1 }}>←</button>
                <span style={{ fontSize: 9, color: EMBRY.dim }}>{Math.min(page + 1, Math.max(totalPages, 1))}/{Math.max(totalPages, 1)}</span>
                <button data-qid="sources:page:next" onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1 || totalPages <= 1} data-qs-action="PAGE_NEXT" title="Next page" style={{ ...btn, opacity: (page >= totalPages - 1 || totalPages <= 1) ? 0.3 : 1 }}>→</button>
              </div>
            </div>
            {ctrlLoading ? <div style={{ padding: 16, color: EMBRY.dim }}>Loading...</div> : (
              <div style={{ flex: 1, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${EMBRY.border}`, position: 'sticky', top: 0, backgroundColor: EMBRY.bgHeader }}>
                      <th style={th}>ID</th><th style={th}>Name</th><th style={th}>Type</th><th style={th}>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayControls.map((ctrl) => {
                      const isActive = selectedControl?._key === ctrl._key
                      return (
                        <tr key={ctrl._key} onClick={() => { setSelectedControl(isActive ? null : ctrl); setSelectedUrl(null) }}
                          data-qid={`sources:control:${ctrl.control_id}`}
                          data-qs-action="SELECT_CONTROL"
                          title={`${ctrl.control_id}: ${ctrl.name}`}
                          style={{ borderBottom: `1px solid ${EMBRY.border}`, ...magneticRow, ...(isActive ? magneticRowSelected : {}) }}
                          onMouseEnter={(e) => applyMagneticHover(e.currentTarget, isActive)}
                          onMouseLeave={(e) => removeMagneticHover(e.currentTarget, isActive)}>
                          <td style={{ ...td, fontFamily: 'monospace', color: EMBRY.blue, whiteSpace: 'nowrap' }}>{ctrl.control_id}</td>
                          <td style={{ ...td, fontWeight: 600, color: EMBRY.white }}>{ctrl.name}</td>
                          <td style={td}>
                            <span style={{ fontSize: 9, fontWeight: 600, padding: '1px 5px', borderRadius: 3, color: typeColor(ctrl.control_type ?? ''), backgroundColor: `${typeColor(ctrl.control_type ?? '')}18`, border: `1px solid ${typeColor(ctrl.control_type ?? '')}33` }}>{ctrl.control_type}</span>
                          </td>
                          <td style={{ ...td, maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {descriptionCell(ctrl.description)}
                          </td>
                        </tr>
                      )
                    })}
                    {displayControls.length === 0 && <tr><td colSpan={4} style={{ ...td, color: EMBRY.muted, textAlign: 'center', padding: 20 }}>No controls found</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </>
        ) : view.type === 'domain' ? (
          <>
            <div style={{ padding: '8px 12px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0, display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: EMBRY.white }}>{domainFilter}</div>
                <div style={{ fontSize: 10, color: EMBRY.dim }}>{urlLoading ? 'Loading...' : `${filteredUrls.length} URLs`}</div>
              </div>
              <input data-qid="sources:search:controls" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter controls..." data-qs-input="sources-search" title="Filter controls"
                style={{ width: 170, backgroundColor: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`, borderRadius: 4, padding: '4px 8px', fontSize: 11, color: EMBRY.white, outline: 'none' }} />
              <input data-qid="sources:search:urls" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter URLs..." data-qs-input="sources-search" title="Filter URLs"
                style={{ width: 170, backgroundColor: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`, borderRadius: 4, padding: '4px 8px', fontSize: 11, color: EMBRY.white, outline: 'none' }} />
            </div>
            {urlLoading ? <div style={{ padding: 16, color: EMBRY.dim }}>Loading...</div> : (
              <div style={{ flex: 1, overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: 24 }}></th>
                      <th style={th}>Controls</th>
                      <th style={{ ...th, width: '50%' }}>URL</th>
                      <th style={th}>Status</th>
                      <th style={th}>Chunks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUrls.map((u) => {
                      const isActive = selectedUrl?._key === u._key
                      const info = enrichedUrls.get(u.url_id)
                      const ok = info ? info.fetched && info.chunks > 0 : false
                      const partial = info ? info.fetched && info.chunks === 0 : false
                      const dotColor = !info ? EMBRY.dim : ok ? EMBRY.green : partial ? EMBRY.amber : EMBRY.red
                      return (
                        <tr key={u._key} onClick={() => { setSelectedUrl(isActive ? null : u); setSelectedControl(null) }}
                          data-qid={`sources:url:${u._key}`}
                          data-qs-action="SELECT_URL"
                          title={u.url}
                          style={{ ...magneticRow, ...(isActive ? magneticRowSelected : {}) }}
                          onMouseEnter={(e) => applyMagneticHover(e.currentTarget, isActive)}
                          onMouseLeave={(e) => removeMagneticHover(e.currentTarget, isActive)}>
                          <td style={{ ...td, textAlign: 'center' }}><div style={glowDot(dotColor, 6)} /></td>
                          <td style={td}>
                            {info && info.control_ids.length > 0 ? (
                              <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                {info.control_ids.slice(0, 2).map((cid) => (
                                  <span key={cid} style={{ fontFamily: 'monospace', fontSize: 9, fontWeight: 700, color: EMBRY.blue, padding: '0 3px', borderRadius: 2, backgroundColor: `${EMBRY.blue}12` }}>{cid}</span>
                                ))}
                                {info.control_ids.length > 2 && <span style={{ fontSize: 8, color: EMBRY.dim }}>+{info.control_ids.length - 2}</span>}
                              </div>
                            ) : <span style={{ fontSize: 9, color: EMBRY.muted }}>—</span>}
                          </td>
                          <td style={{ ...td, fontFamily: 'monospace', fontSize: 10, color: EMBRY.blue, maxWidth: 350, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.url}</td>
                          <td style={td}>
                            {info ? (
                              <span style={{ fontSize: 9, color: info.fetched ? (info.status === 200 ? EMBRY.green : EMBRY.amber) : EMBRY.red }}>
                                {info.fetched ? info.status : 'no'}
                              </span>
                            ) : <span style={{ fontSize: 9, color: EMBRY.dim }}>...</span>}
                          </td>
                          <td style={{ ...td, fontFamily: 'monospace', fontSize: 10, color: info && info.chunks > 0 ? EMBRY.green : EMBRY.dim }}>
                            {info ? info.chunks : '...'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {filteredUrls.length === 0 && <div style={{ padding: 20, color: EMBRY.muted, textAlign: 'center' }}>No URLs found</div>}
              </div>
            )}
          </>
        ) : null}

        {/* ControlDetail flyout overlay */}
        {selectedControl && (
          <div style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: 500, zIndex: 100, boxShadow: '-20px 0 50px rgba(0,0,0,0.8)', backgroundColor: '#111111', overflow: 'auto' }}>
            <ControlDetail control={selectedControl} onClose={() => setSelectedControl(null)} onToast={showToast} />
          </div>
        )}
        {/* URL detail flyout overlay */}
        {selectedUrl && (
          <div style={{ position: 'absolute', right: 0, top: 0, height: '100%', width: 500, zIndex: 100, boxShadow: '-20px 0 50px rgba(0,0,0,0.8)', backgroundColor: '#111111', overflow: 'auto' }}>
            <UrlPipelineDetail url={selectedUrl} onClose={() => setSelectedUrl(null)} />
          </div>
        )}
      </div>
      {toast}
    </div>
  )
}

// ── Control Detail with QRAs + Relationships ────────────────────────────────

function ControlDetail({ control, onClose, onToast }: { control: SpartaControl; onClose: () => void; onToast: (msg: string) => void }) {
  const nav = useSpartaNav()
  const [qras, setQras] = useState<Record<string, unknown>[]>([])
  const [rels, setRels] = useState<Record<string, unknown>[]>([])
  const [qraLoading, setQraLoading] = useState(true)
  const [relLoading, setRelLoading] = useState(true)

  useEffect(() => {
    const API = 'http://localhost:3001/api/memory'
    setQraLoading(true)
    setRelLoading(true)

    // Fetch QRAs for this control
    fetch(`${API}/recall`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: `${control.control_id} ${control.name}`, collections: ['sparta_qra'], k: 10, entities: [control.control_id] }),
    }).then((r) => r.json()).then((d) => {
      setQras((d.items ?? []).filter((i: Record<string, unknown>) => i.control_id === control.control_id))
    }).catch(() => setQras([])).finally(() => setQraLoading(false))

    // Fetch relationships
    fetch(`${API}/recall`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: `relationships for ${control.control_id}`, collections: ['sparta_relationships'], k: 20 }),
    }).then((r) => r.json()).then((d) => {
      const items = (d.items ?? []) as Record<string, unknown>[]
      setRels(items.filter((i) => i.source_control_id === control.control_id || i.target_control_id === control.control_id))
    }).catch(() => setRels([])).finally(() => setRelLoading(false))
  }, [control.control_id, control.name])

  return (
    <div style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 900, color: EMBRY.blue, fontFamily: 'monospace' }}>{control.control_id}</span>
        <button data-qid="sources:detail:close-control" onClick={onClose} data-qs-action="CLOSE_DETAIL" title="Close control detail" style={{ ...btn, fontSize: 14 }}>×</button>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: EMBRY.white, marginBottom: 6 }}>{control.name}</div>
      <UtilityBar controlId={control.control_id} name={control.name} framework={control.source_framework} description={control.description ?? ''} onToast={onToast} />

      <DetailRow label="Framework" value={control.source_framework} />
      <DetailRow label="Type">
        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 3, color: typeColor(control.control_type ?? ''), backgroundColor: `${typeColor(control.control_type ?? '')}18` }}>{control.control_type}</span>
      </DetailRow>
      {control.domain && <DetailRow label="Domain" value={control.domain} />}
      {control.scope && <DetailRow label="Scope" value={control.scope} />}
      {control.parent_id && <DetailRow label="Parent" value={control.parent_id} />}

      {(() => {
        const desc = control.description ?? ''
        const marker = '[Cross-references]'
        const idx = desc.indexOf(marker)
        const prose = idx >= 0
          ? desc.slice(0, idx).replace(/^\[INFERRED[^\]]*\]\s*/i, '').trim()
          : desc.replace(/^\[INFERRED[^\]]*\]\s*/i, '').trim()
        const crossRefs = idx >= 0 ? desc.slice(idx + marker.length).trim() : ''
        const isInferred = desc.startsWith('[INFERRED')

        // Parse cross-refs into labeled groups by splitting on known section headers
        const xrefGroups: Array<{ heading: string; ids: string[] }> = []
        if (crossRefs) {
          const labels = ['NIST Controls', 'SPARTA Countermeasures', 'SPARTA Techniques', 'Sample Requirements', 'D3FEND Artifacts', 'TOR Threats']
          let remaining = crossRefs
          for (const lbl of labels) {
            const start = remaining.indexOf(lbl + ':')
            if (start < 0) continue
            const afterLabel = remaining.slice(start + lbl.length + 1)
            const nextSemicolon = afterLabel.indexOf(';')
            const idsStr = nextSemicolon >= 0 ? afterLabel.slice(0, nextSemicolon) : afterLabel
            const ids = idsStr.split(',').map(s => s.trim()).filter(Boolean)
            if (ids.length > 0) xrefGroups.push({ heading: lbl, ids })
          }
        }

        return (
          <>
            {/* Description */}
            <div style={{ marginTop: 12 }}>
              <div style={{ ...label, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                Description
                {isInferred && <span style={{ fontSize: 8, color: EMBRY.amber, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>inferred</span>}
              </div>
              {isPlaceholder(desc) ? (
                <div style={{ fontSize: 11, color: EMBRY.amber, padding: '6px 8px', backgroundColor: `${EMBRY.amber}10`, borderRadius: 4, border: `1px solid ${EMBRY.amber}22` }}>
                  No real description — pipeline wrote placeholder.
                </div>
              ) : prose ? (
                <div style={{ fontSize: 12, color: EMBRY.dim, lineHeight: 1.6 }}>{prose}</div>
              ) : xrefGroups.length === 0 ? (
                <div style={{ fontSize: 11, color: EMBRY.red }}>Missing</div>
              ) : (
                <div style={{ fontSize: 12, color: EMBRY.muted, fontStyle: 'italic' }}>No prose description — see related controls below</div>
              )}
            </div>

            {/* Divider */}
            {xrefGroups.length > 0 && <div style={{ height: 1, backgroundColor: EMBRY.border, margin: '12px 0' }} />}

            {/* Related Controls — grouped with labeled pill badges */}
            {xrefGroups.length > 0 && (
              <div>
                <div style={{ ...label, marginBottom: 8 }}>Related Controls</div>
                {xrefGroups.map(({ heading: h, ids }) => (
                  <div key={h} style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: EMBRY.dim, marginBottom: 4 }}>{h}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                      <ControlIdPills ids={ids} onControlClick={(id) => {
                        console.log('Navigate to:', id)
                      }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )
      })()}

      {control.weaknesses && control.weaknesses.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ ...label, marginBottom: 4 }}>Weaknesses</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {control.weaknesses.map((w) => (
              <span key={w} style={{ fontSize: 9, fontFamily: 'monospace', padding: '1px 5px', borderRadius: 3, color: EMBRY.red, backgroundColor: `${EMBRY.red}12`, border: `1px solid ${EMBRY.red}22` }}>{w}</span>
            ))}
          </div>
        </div>
      )}

      {control.mind && control.mind.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ ...label, marginBottom: 4 }}>Mind Tags</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {control.mind.map((tag) => (
              <span key={tag} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, color: EMBRY.accent, backgroundColor: `${EMBRY.accent}12`, border: `1px solid ${EMBRY.accent}22` }}>{tag}</span>
            ))}
          </div>
        </div>
      )}

      {/* QRAs Preview */}
      <div style={{ marginTop: 16, borderTop: `1px solid ${EMBRY.border}`, paddingTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <div style={{ ...label }}>QRAs {qraLoading ? '...' : `(${qras.length})`}</div>
          {!qraLoading && qras.length > 0 && (
            <button data-qid="sources:detail:nav-qras" onClick={() => nav.navigateToTabWithFilter('QRAs', { controlId: control.control_id })} data-qs-action="NAVIGATE_TO_QRAS" title="View all QRAs for this control" style={{
              background: 'none', border: `1px solid ${EMBRY.green}33`, borderRadius: 4,
              padding: '2px 8px', fontSize: 10, color: EMBRY.green, cursor: 'pointer',
            }}>
              View all {qras.length} QRAs →
            </button>
          )}
        </div>
        {qraLoading ? (
          <div style={{ fontSize: 11, color: EMBRY.dim }}>Loading...</div>
        ) : qras.length === 0 ? (
          <div style={{ fontSize: 11, color: EMBRY.muted }}>No QRAs generated for this control</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {qras.slice(0, 5).map((qra, i) => {
              const q = qra as Record<string, unknown>
              const question = (q.question as string) ?? ''
              const truncated = question.length > 100 ? question.slice(0, 100) + '...' : question
              const tier0 = q.tier0_pass as boolean | undefined
              const tier2 = q.tier2_pass as boolean | undefined
              return (
                <div data-qid="explorer-sourcesview:auto:685" data-qs-action="EXPLORER_SOURCESVIEW_AUTO_685" key={i} style={{
                  padding: '6px 8px', borderRadius: 4, backgroundColor: EMBRY.bgDeep,
                  border: `1px solid ${EMBRY.border}`, cursor: 'pointer',
                }}
                  onClick={() => nav.navigateToTabWithFilter('QRAs', { controlId: control.control_id, qraKey: q._key as string })}
                  title="Click to view this QRA"
                >
                  <div style={{ fontSize: 11, color: EMBRY.white, lineHeight: 1.4 }}>{truncated}</div>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    {tier0 !== undefined && (
                      <span style={{ fontSize: 8, color: tier0 ? EMBRY.green : EMBRY.red }}>T0: {tier0 ? '✓' : '✗'}</span>
                    )}
                    {tier2 !== undefined && (
                      <span style={{ fontSize: 8, color: tier2 ? EMBRY.green : EMBRY.red }}>T2: {tier2 ? '✓' : '✗'}</span>
                    )}
                    {typeof q.qra_type === 'string' && <span style={{ fontSize: 8, color: EMBRY.muted }}>{q.qra_type}</span>}
                  </div>
                </div>
              )
            })}
            {qras.length > 5 && (
              <div style={{ fontSize: 10, color: EMBRY.muted, textAlign: 'center', padding: '4px 0' }}>
                +{qras.length - 5} more QRAs
              </div>
            )}
          </div>
        )}
      </div>

      {/* Relationships */}
      <div style={{ marginTop: 12, borderTop: `1px solid ${EMBRY.border}`, paddingTop: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ ...label }}>Relationships {relLoading ? '...' : `(${rels.length})`}</div>
          {!relLoading && rels.length > 0 && (
            <button data-qid="sources:detail:nav-supply" onClick={() => nav.navigateToTabWithFilter('Supply Chain', { controlId: control.control_id })} data-qs-action="NAVIGATE_TO_SUPPLY_CHAIN" title="View supply chain relationships for this control" style={{
              background: 'none', border: `1px solid ${EMBRY.green}33`, borderRadius: 4,
              padding: '2px 8px', fontSize: 10, color: EMBRY.green, cursor: 'pointer',
            }}>
              View in Supply Chain →
            </button>
          )}
        </div>
        {!relLoading && rels.length === 0 && <div style={{ fontSize: 11, color: EMBRY.muted }}>No relationships found</div>}
      </div>
    </div>
  )
}

// ── Subcomponents ───────────────────────────────────────────────────────────

function SectionHeader({ title }: { title: string }) {
  return (
    <div style={{ padding: '6px 12px', fontSize: 9, fontWeight: 700, color: EMBRY.muted, textTransform: 'uppercase', letterSpacing: '0.05em', backgroundColor: EMBRY.bgDeep, borderBottom: `1px solid ${EMBRY.border}` }}>
      {title}
    </div>
  )
}

function SourceRow({ name, tooltip, health, count, loading, isSelected, onClick, mono, ...rest }: {
  name: string; tooltip: string; health: { color: string; label: string }; count: number; loading: boolean; isSelected: boolean; onClick: () => void; mono?: boolean; 'data-qs-action'?: string; 'data-qid'?: string
}) {
  return (
    <div
      onClick={onClick}
      title={tooltip}
      data-qid={rest['data-qid']}
      data-qs-action={rest['data-qs-action']}
      style={{
        padding: '5px 12px', cursor: 'pointer',
        borderBottom: `1px solid ${EMBRY.border}`,
        backgroundColor: isSelected ? `${EMBRY.accent}12` : 'transparent',
      }}
      onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = `${EMBRY.accent}06` }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isSelected ? `${EMBRY.accent}12` : 'transparent' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={glowDot(health.color, 5)} />
        <span style={{ fontSize: 11, fontWeight: isSelected ? 700 : 500, color: isSelected ? EMBRY.white : EMBRY.dim, flex: 1, fontFamily: mono ? 'monospace' : 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {name}
        </span>
        <span style={{ fontSize: 10, fontWeight: 700, color: EMBRY.accent, flexShrink: 0 }}>{loading ? '...' : (count ?? 0).toLocaleString()}</span>
      </div>
    </div>
  )
}

// ── URL Pipeline Detail (shared between Sources + URLs tabs) ─────────────

function UrlPipelineDetail({ url, onClose }: { url: SpartaURL; onClose: () => void }) {
  const [controls, setControls] = useState<Array<{ control_id?: string; name?: string }>>([])
  const [knowledge, setKnowledge] = useState<Array<{ text?: string; topic?: string }>>([])
  const [fetched, setFetched] = useState<boolean | null>(null)
  const [mindTags, setMindTags] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setMindTags([])
    const DAEMON = 'http://localhost:3001/api/memory'
    const post = (path: string, body: Record<string, unknown>) =>
      fetch(`${DAEMON}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        .then((r) => r.json()).catch(() => ({ documents: [] }))

    Promise.all([
      post('/recall/by-keys', { collection: 'sparta_control_urls', keys: [url.url_id], key_field: 'url_id', return_fields: ['url_id', 'control_id'] }),
      post('/recall/by-keys', { collection: 'sparta_url_knowledge', keys: [url.url_id], key_field: 'url_id', return_fields: ['url_id', 'text', 'topic'] }),
      post('/recall/by-keys', { collection: 'sparta_url_content', keys: [url.url_id], key_field: 'url_id', return_fields: ['url_id', 'status_code', 'error_message'] }),
    ]).then(([ctrlRes, knowRes, contentRes]) => {
      if (cancelled) return
      const ctrlIds = (ctrlRes.documents ?? []).map((d: Record<string, unknown>) => d.control_id as string)
      setControls(ctrlIds.map((cid: string) => ({ control_id: cid, name: cid })))
      setKnowledge(knowRes.documents ?? [])
      setFetched((contentRes.documents ?? []).length > 0)

      // Fetch mind tags from linked controls
      if (ctrlIds.length > 0) {
        post('/recall/by-keys', { collection: 'sparta_controls', keys: ctrlIds, key_field: 'control_id', return_fields: ['control_id', 'mind'] })
          .then((res: { documents?: Array<{ mind?: string[] }> }) => {
            if (cancelled) return
            const tags = new Set<string>()
            for (const ctrl of (res.documents ?? [])) {
              if (Array.isArray(ctrl.mind)) ctrl.mind.forEach((t) => tags.add(t))
            }
            setMindTags([...tags].sort())
          })
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [url.url_id, url.url])

  return (
    <div style={{ padding: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: EMBRY.white }}>URL Pipeline Status</span>
        <button data-qid="sources:detail:close-url" onClick={onClose} data-qs-action="CLOSE_DETAIL" title="Close URL detail" style={{ ...btn, fontSize: 14 }}>×</button>
      </div>

      {/* URL */}
      <a href={url.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: EMBRY.blue, wordBreak: 'break-all', textDecoration: 'none', lineHeight: 1.5, display: 'block', marginBottom: 12 }}>
        {url.url}
      </a>

      {/* Status indicators */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        <PipelineStatusRow label="Domain" value={url.domain} ok={!!url.domain} />
        <PipelineStatusRow label="Content Fetched" value={fetched === null ? '...' : fetched ? 'Yes' : 'Not fetched'} ok={fetched === true} />
        <PipelineStatusRow label="Knowledge Extracted" value={loading ? '...' : `${knowledge.length} chunks`} ok={knowledge.length > 0} />
        <PipelineStatusRow label="Linked Controls" value={loading ? '...' : `${controls.length}`} ok={controls.length > 0} />
        <PipelineStatusRow label="Taxonomy" value={loading ? '...' : mindTags.length > 0 ? `${mindTags.length} mind tags` : 'Not tagged'} ok={mindTags.length > 0} />
      </div>

      {/* Mind / Taxonomy tags */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ ...label, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          Mind Tags
          <div style={glowDot(mindTags.length > 0 ? EMBRY.green : EMBRY.red, 6)} />
        </div>
        {loading ? (
          <div style={{ fontSize: 11, color: EMBRY.dim }}>Loading...</div>
        ) : mindTags.length > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {mindTags.map((tag) => (
              <span key={tag} style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, color: EMBRY.accent, backgroundColor: `${EMBRY.accent}12`, border: `1px solid ${EMBRY.accent}22` }}>{tag}</span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: EMBRY.red, padding: '4px 8px', borderRadius: 4, backgroundColor: `${EMBRY.red}08` }}>
            No taxonomy tags on linked controls
          </div>
        )}
      </div>

      {/* Linked Controls */}
      {controls.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...label, marginBottom: 6 }}>Linked Controls</div>
          {controls.map((c, i) => (
            <div key={`uc-${i}`} style={{ display: 'flex', gap: 6, padding: '3px 6px', borderRadius: 4, backgroundColor: EMBRY.bgDeep, marginBottom: 3 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 10, fontWeight: 700, color: EMBRY.blue }}>{c.control_id}</span>
              <span style={{ fontSize: 10, color: EMBRY.dim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span>
            </div>
          ))}
        </div>
      )}

      {/* Knowledge preview */}
      {knowledge.length > 0 && (
        <div>
          <div style={{ ...label, marginBottom: 6 }}>Knowledge Chunks</div>
          {knowledge.slice(0, 3).map((k, i) => (
            <div key={`uk-${i}`} style={{ padding: '6px 8px', borderRadius: 4, border: `1px solid ${EMBRY.border}`, marginBottom: 4, fontSize: 11, color: EMBRY.dim, lineHeight: 1.4 }}>
              {k.topic && <div style={{ fontSize: 9, color: EMBRY.accent, marginBottom: 2 }}>{k.topic}</div>}
              {(k.text ?? '').slice(0, 150)}{(k.text ?? '').length > 150 ? '...' : ''}
            </div>
          ))}
        </div>
      )}

      {!loading && controls.length === 0 && knowledge.length === 0 && !fetched && (
        <div style={{ fontSize: 11, color: EMBRY.red, padding: 8, borderRadius: 4, backgroundColor: `${EMBRY.red}12` }}>
          No pipeline data found — URL not fetched, no knowledge extracted, no linked controls
        </div>
      )}
    </div>
  )
}

function PipelineStatusRow({ label: l, value, ok }: { label: string; value: string; ok: boolean | null }) {
  const color = ok === null ? EMBRY.dim : ok ? EMBRY.green : EMBRY.red
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={glowDot(color, 6)} />
      <span style={{ fontSize: 10, color: EMBRY.muted, width: 110, flexShrink: 0 }}>{l}</span>
      <span style={{ fontSize: 11, color: EMBRY.white }}>{value}</span>
    </div>
  )
}

function DetailRow({ label: lbl, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
      <span style={{ fontSize: 10, color: EMBRY.muted, width: 65, flexShrink: 0 }}>{lbl}</span>
      {children ?? <span style={{ fontSize: 12, color: EMBRY.white }}>{value}</span>}
    </div>
  )
}

const th: React.CSSProperties = { textAlign: 'left', padding: '6px 10px', fontSize: 9, fontWeight: 700, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: '0.05em' }
const td: React.CSSProperties = { padding: '5px 10px', fontSize: 11, color: EMBRY.dim }
const btn: React.CSSProperties = { fontSize: 10, fontWeight: 600, padding: '3px 8px', borderRadius: 4, border: `1px solid ${EMBRY.border}`, cursor: 'pointer', background: 'none', color: EMBRY.white }

import { useState, useMemo, useEffect, useCallback, useRef } from 'react'
import { EMBRY, label, heading, glowDot } from '../common/EmbryStyle'
import { useControlsByFramework, useRawFrameworkCounts, useURLs } from '../../../hooks/useSpartaCollections'
import type { SpartaControl, SpartaURL } from '../../../hooks/useSpartaCollections'

// ── Source definitions ──────────────────────────────────────────────────────

interface SourceDef {
  name: string
  group: 'sparta' | 'external' | 'urls'
  rawFrameworks: string[]
  controlType?: string
  file: string
  minExpected: number
  tooltip: string
}

const SOURCES: SourceDef[] = [
  // SPARTA-Data.xlsx worksheets
  { name: 'SPARTA Tactics', group: 'sparta', rawFrameworks: ['SPARTA', 'sparta'], controlType: 'tactic', file: 'SPARTA-Data.xlsx', minExpected: 5, tooltip: '9 high-level adversary objectives (Reconnaissance, Resource Development, Initial Access, etc.)' },
  { name: 'SPARTA Techniques', group: 'sparta', rawFrameworks: ['SPARTA', 'sparta'], controlType: 'technique', file: 'SPARTA-Data.xlsx', minExpected: 100, tooltip: '217 specific attack methods mapped to tactics, with risk scores and cross-framework references' },
  { name: 'SPARTA Countermeasures', group: 'sparta', rawFrameworks: ['SPARTA', 'sparta'], controlType: 'countermeasure', file: 'SPARTA-Data.xlsx', minExpected: 50, tooltip: '92 defensive measures with NIST, ISO, D3FEND, and sample requirement mappings' },
  { name: 'Space Threats', group: 'sparta', rawFrameworks: ['SPARTA', 'sparta'], controlType: 'space_threat', file: 'SPARTA-Data.xlsx', minExpected: 20, tooltip: '45 space-specific threats organized by Defense-in-Depth layer and threat tier' },
  { name: 'Indicators of Behavior', group: 'sparta', rawFrameworks: ['SPARTA', 'sparta'], controlType: 'indicator', file: 'SPARTA-Data.xlsx', minExpected: 50, tooltip: '194 observable indicators with STIX patterns linked to SPARTA TTPs' },
  { name: 'NIST References', group: 'sparta', rawFrameworks: ['NIST', 'nist'], controlType: 'nist_control', file: 'SPARTA-Data.xlsx', minExpected: 500, tooltip: '1,008 NIST SP 800-53 controls with SPARTA technique/countermeasure mappings and space segment guidance' },
  { name: 'D3FEND Tactics', group: 'sparta', rawFrameworks: ['D3FEND', 'd3fend'], controlType: 'tactic', file: 'SPARTA-Data.xlsx', minExpected: 3, tooltip: '7 MITRE D3FEND defensive tactic categories' },
  { name: 'D3FEND Techniques', group: 'sparta', rawFrameworks: ['D3FEND', 'd3fend'], controlType: 'technique', file: 'SPARTA-Data.xlsx', minExpected: 50, tooltip: '178 defensive techniques from the MITRE D3FEND knowledge graph' },
  { name: 'D3FEND Artifacts', group: 'sparta', rawFrameworks: ['D3FEND', 'd3fend'], controlType: 'artifact', file: 'SPARTA-Data.xlsx', minExpected: 50, tooltip: '242 digital artifacts that D3FEND techniques operate on (files, processes, network objects)' },
  { name: 'ISO 27001 References', group: 'sparta', rawFrameworks: ['ISO', 'iso'], file: 'SPARTA-Data.xlsx', minExpected: 5, tooltip: '138 ISO/IEC 27001 control references cross-mapped to SPARTA' },
  { name: 'NASABPG', group: 'sparta', rawFrameworks: ['NASA'], file: 'SPARTA-Data.xlsx', minExpected: 5, tooltip: '15 references from NASA\'s Space Security Best Practices Guide' },
  // External pipeline sources
  { name: 'ATT&CK Enterprise', group: 'external', rawFrameworks: ['ATT_CK_Enterprise', 'attack'], file: 'enterprise-attack.json', minExpected: 500, tooltip: 'MITRE ATT&CK Enterprise — techniques, malware, tools, and courses of action for IT systems' },
  { name: 'ATT&CK Mobile', group: 'external', rawFrameworks: ['ATT_CK_Mobile'], file: 'mobile-attack.json', minExpected: 50, tooltip: 'MITRE ATT&CK Mobile — techniques targeting Android and iOS devices' },
  { name: 'ATT&CK ICS', group: 'external', rawFrameworks: ['ATT_CK_ICS'], file: 'ics-attack.json', minExpected: 50, tooltip: 'MITRE ATT&CK ICS — techniques targeting industrial control systems' },
  { name: 'CWE', group: 'external', rawFrameworks: ['CWE', 'cwe'], file: 'cwec_v4.19.1.xml', minExpected: 200, tooltip: 'Common Weakness Enumeration v4.19.1 — software/hardware weakness types' },
  { name: 'NVD', group: 'external', rawFrameworks: ['nvd', 'NVD'], file: 'nvd (via CWE)', minExpected: 1000, tooltip: 'National Vulnerability Database — CVE-linked controls imported via CWE pipeline' },
  { name: 'ESA', group: 'external', rawFrameworks: ['ESA'], file: 'esa_shield_scraped.json', minExpected: 50, tooltip: 'European Space Agency SPACE-SHIELD — 137 space-specific attack techniques' },
  { name: 'NIST Controls', group: 'external', rawFrameworks: ['NIST', 'nist'], controlType: 'control', file: 'nist_rev4_controls.csv', minExpected: 500, tooltip: 'NIST SP 800-53 Rev 4/5 full control catalog (separate from SPARTA worksheet cross-references)' },
]

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

const PLACEHOLDER_PATTERN = /This control requires QRA generation/i

function isPlaceholder(desc?: string): boolean {
  return !desc || PLACEHOLDER_PATTERN.test(desc)
}

function descriptionCell(desc?: string) {
  if (!desc) return <span style={{ color: EMBRY.red, fontSize: 9 }}>MISSING</span>
  if (isPlaceholder(desc)) return <span style={{ color: EMBRY.amber, fontSize: 9 }}>NEEDS DESCRIPTION</span>
  const text = desc.length > 120 ? desc.slice(0, 120) + '...' : desc
  return <span style={{ color: EMBRY.dim }}>{text}</span>
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
      const batchSize = 500
      let offset = 0
      let dbTotal = 0

      for (let i = 0; i < 5; i++) {
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

export function SourcesView() {
  const { data: fwCounts, loading: fwLoading } = useRawFrameworkCounts()
  const { domains: urlDomains, total: urlTotal, loading: urlsLoading } = useURLDomains()
  const [view, setView] = useState<ViewMode | null>(null)
  const [selectedControl, setSelectedControl] = useState<SpartaControl | null>(null)
  const [selectedUrl, setSelectedUrl] = useState<SpartaURL | null>(null)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [urlsExpanded, setUrlsExpanded] = useState(false)
  const [detailWidth, setDetailWidth] = useState(380)
  const dragging = useRef(false)

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragging.current) return
      const newWidth = window.innerWidth - e.clientX
      setDetailWidth(Math.max(280, Math.min(600, newWidth)))
    }
    function onMouseUp() { dragging.current = false; document.body.style.cursor = '' }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp) }
  }, [])

  const source = view?.type === 'source' ? SOURCES[view.idx] : null
  const domainFilter = view?.type === 'domain' ? view.domain : null

  // Controls for source view — loads all for the framework
  const { data: rawControls, total: rawTotal, loading: ctrlLoading } = useControlsByFramework(
    source?.rawFrameworks ?? [],
  )
  const controls = useMemo(() => {
    if (!source?.controlType) return rawControls
    return rawControls.filter((c) => c.control_type === source.controlType)
  }, [rawControls, source?.controlType])

  // Type counts from loaded data — used to fix sidebar counts for worksheet sources
  const loadedTypeCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of rawControls) {
      const t = c.control_type ?? 'unknown'
      m.set(t, (m.get(t) ?? 0) + 1)
    }
    return m
  }, [rawControls])

  // URLs for domain view
  const { data: urls, loading: urlLoading } = useURLs('', domainFilter ?? undefined)

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
    // If this source has a controlType AND we have loaded data for its framework,
    // use the type-specific count (exact) instead of framework total (inflated)
    if (src.controlType && source && src.rawFrameworks.some((fw) => source.rawFrameworks.includes(fw)) && rawControls.length > 0) {
      return loadedTypeCounts.get(src.controlType) ?? 0
    }
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
          {SOURCES.filter((s) => s.group === 'sparta').map((src) => {
            const idx = SOURCES.indexOf(src)
            const isSelected = view?.type === 'source' && view.idx === idx
            const count = getSourceCount(src)
            const health = sourceHealth(count, src.minExpected)
            return (
              <SourceRow key={src.name} name={src.name} tooltip={src.tooltip} health={health}
                count={count} loading={fwLoading} isSelected={isSelected} onClick={() => selectSource(idx)} />
            )
          })}

          {/* External */}
          <SectionHeader title="External Pipeline Sources" />
          {SOURCES.filter((s) => s.group === 'external').map((src) => {
            const idx = SOURCES.indexOf(src)
            const isSelected = view?.type === 'source' && view.idx === idx
            const count = getSourceCount(src)
            const health = sourceHealth(count, src.minExpected)
            return (
              <SourceRow key={src.name} name={src.name} tooltip={src.tooltip} health={health}
                count={count} loading={fwLoading} isSelected={isSelected} onClick={() => selectSource(idx)} />
            )
          })}

          {/* URLs by domain — collapsible */}
          <div
            onClick={() => setUrlsExpanded(!urlsExpanded)}
            style={{ padding: '6px 12px', fontSize: 9, fontWeight: 700, color: EMBRY.muted, textTransform: 'uppercase', letterSpacing: '0.05em', backgroundColor: EMBRY.bgDeep, borderBottom: `1px solid ${EMBRY.border}`, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{ fontSize: 8 }}>{urlsExpanded ? '▼' : '▶'}</span>
            Fetched URLs ({urlsLoading ? '...' : urlTotal.toLocaleString()})
          </div>
          {urlsExpanded && urlDomains.slice(0, 20).map((dg) => {
            const isSelected = view?.type === 'domain' && view.domain === dg.domain
            return (
              <SourceRow key={dg.domain} name={dg.domain} tooltip={`${dg.count} URLs fetched from ${dg.domain}`}
                health={{ color: EMBRY.green, label: 'ok' }} count={dg.count} loading={urlsLoading}
                isSelected={isSelected} onClick={() => selectDomain(dg.domain)} mono />
            )
          })}
          {urlsExpanded && urlDomains.length > 20 && (
            <div style={{ padding: '6px 12px', fontSize: 9, color: EMBRY.muted }}>
              +{urlDomains.length - 20} more domains
            </div>
          )}
        </div>
      </div>

      {/* Middle: data table */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', borderRight: (selectedControl || selectedUrl) ? `1px solid ${EMBRY.border}` : 'none' }}>
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
              </div>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter..."
                style={{ width: 200, backgroundColor: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`, borderRadius: 4, padding: '4px 8px', fontSize: 11, color: EMBRY.white, outline: 'none' }} />
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
                  <button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} style={{ ...btn, opacity: page === 0 ? 0.3 : 1 }}>←</button>
                  <span style={{ fontSize: 9, color: EMBRY.dim }}>{page + 1}/{totalPages}</span>
                  <button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} style={{ ...btn, opacity: page >= totalPages - 1 ? 0.3 : 1 }}>→</button>
                </div>
              )}
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
                          style={{ borderBottom: `1px solid ${EMBRY.border}`, cursor: 'pointer', backgroundColor: isActive ? `${EMBRY.blue}12` : 'transparent' }}
                          onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = `${EMBRY.blue}06` }}
                          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isActive ? `${EMBRY.blue}12` : 'transparent' }}>
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
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter URLs..."
                style={{ width: 200, backgroundColor: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`, borderRadius: 4, padding: '4px 8px', fontSize: 11, color: EMBRY.white, outline: 'none' }} />
            </div>
            {urlLoading ? <div style={{ padding: 16, color: EMBRY.dim }}>Loading...</div> : (
              <div style={{ flex: 1, overflow: 'auto' }}>
                {filteredUrls.map((u) => {
                  const isActive = selectedUrl?._key === u._key
                  return (
                    <div key={u._key} onClick={() => { setSelectedUrl(isActive ? null : u); setSelectedControl(null) }}
                      style={{ padding: '6px 12px', borderBottom: `1px solid ${EMBRY.border}`, cursor: 'pointer', backgroundColor: isActive ? `${EMBRY.blue}12` : 'transparent' }}
                      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = `${EMBRY.blue}06` }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isActive ? `${EMBRY.blue}12` : 'transparent' }}>
                      <div style={{ fontSize: 11, fontFamily: 'monospace', color: EMBRY.blue, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.url}</div>
                    </div>
                  )
                })}
                {filteredUrls.length === 0 && <div style={{ padding: 20, color: EMBRY.muted, textAlign: 'center' }}>No URLs found</div>}
              </div>
            )}
          </>
        ) : null}
      </div>

      {/* Right: detail pane with resize handle */}
      {selectedControl && (
        <>
          <div
            onMouseDown={() => { dragging.current = true; document.body.style.cursor = 'col-resize' }}
            style={{ width: 4, cursor: 'col-resize', backgroundColor: 'transparent', flexShrink: 0 }}
            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${EMBRY.accent}40` }}
            onMouseLeave={(e) => { if (!dragging.current) e.currentTarget.style.backgroundColor = 'transparent' }}
          />
          <ControlDetail control={selectedControl} onClose={() => setSelectedControl(null)} width={detailWidth} />
        </>
      )}
      {selectedUrl && (
        <div style={{ width: 380, flexShrink: 0, overflow: 'auto', padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: EMBRY.white }}>URL Detail</span>
            <button onClick={() => setSelectedUrl(null)} style={{ ...btn, fontSize: 14 }}>×</button>
          </div>
          <DetailRow label="Domain" value={selectedUrl.domain} />
          <div style={{ marginTop: 8 }}>
            <div style={{ ...label, marginBottom: 4 }}>URL</div>
            <div style={{ fontSize: 11, fontFamily: 'monospace', color: EMBRY.blue, wordBreak: 'break-all', lineHeight: 1.5 }}>{selectedUrl.url}</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Control Detail with QRAs + Relationships ────────────────────────────────

function ControlDetail({ control, onClose, width = 380 }: { control: SpartaControl; onClose: () => void; width?: number }) {
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
    <div style={{ width: width, flexShrink: 0, overflow: 'auto', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 900, color: EMBRY.blue, fontFamily: 'monospace' }}>{control.control_id}</span>
        <button onClick={onClose} style={{ ...btn, fontSize: 14 }}>×</button>
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: EMBRY.white, marginBottom: 12 }}>{control.name}</div>

      <DetailRow label="Framework" value={control.source_framework} />
      <DetailRow label="Type">
        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', borderRadius: 3, color: typeColor(control.control_type ?? ''), backgroundColor: `${typeColor(control.control_type ?? '')}18` }}>{control.control_type}</span>
      </DetailRow>
      {control.domain && <DetailRow label="Domain" value={control.domain} />}
      {control.scope && <DetailRow label="Scope" value={control.scope} />}
      {control.parent_id && <DetailRow label="Parent" value={control.parent_id} />}

      <div style={{ marginTop: 12 }}>
        <div style={{ ...label, marginBottom: 4 }}>Description</div>
        {isPlaceholder(control.description) ? (
          <div style={{ fontSize: 11, color: EMBRY.amber, padding: '6px 8px', backgroundColor: `${EMBRY.amber}10`, borderRadius: 4, border: `1px solid ${EMBRY.amber}22` }}>
            No real description — pipeline wrote placeholder. Original source may not have a description field for this framework.
          </div>
        ) : control.description ? (
          <div style={{ fontSize: 12, color: EMBRY.dim, lineHeight: 1.6 }}>{control.description}</div>
        ) : (
          <div style={{ fontSize: 11, color: EMBRY.red }}>Missing</div>
        )}
      </div>

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

      {/* QRAs */}
      <div style={{ marginTop: 16, borderTop: `1px solid ${EMBRY.border}`, paddingTop: 12 }}>
        <div style={{ ...label, marginBottom: 8 }}>QRAs {qraLoading ? '...' : `(${qras.length})`}</div>
        {!qraLoading && qras.length === 0 && <div style={{ fontSize: 11, color: EMBRY.muted }}>No QRAs for this control</div>}
        {qras.map((qra, i) => {
          const reasoning = String(qra.reasoning ?? '')
          const reasoningIsPlaceholder = isPlaceholder(reasoning)
          const grade = String(qra.reasoning_grade ?? '')
          const gradeColor = grade === 'PASS' && !reasoningIsPlaceholder ? EMBRY.green : grade === 'WARN' ? EMBRY.amber : EMBRY.red
          return (
            <div key={`qra-${i}`} style={{ marginBottom: 12, backgroundColor: EMBRY.bgDeep, borderRadius: 6, border: `1px solid ${EMBRY.border}`, overflow: 'hidden' }}>
              {/* Question */}
              <div style={{ padding: '8px 10px', borderBottom: `1px solid ${EMBRY.border}` }}>
                <div style={{ fontSize: 9, color: EMBRY.blue, marginBottom: 2 }}>QUESTION</div>
                <div style={{ fontSize: 11, color: EMBRY.white, lineHeight: 1.5 }}>{String(qra.question ?? '').slice(0, 300)}</div>
              </div>
              {/* Reasoning */}
              <div style={{ padding: '8px 10px', borderBottom: `1px solid ${EMBRY.border}`, backgroundColor: reasoningIsPlaceholder ? `${EMBRY.amber}08` : 'transparent' }}>
                <div style={{ fontSize: 9, color: EMBRY.accent, marginBottom: 2 }}>REASONING</div>
                {reasoningIsPlaceholder ? (
                  <div style={{ fontSize: 10, color: EMBRY.amber }}>Missing — pipeline wrote placeholder</div>
                ) : (
                  <div style={{ fontSize: 11, color: EMBRY.white, lineHeight: 1.5 }}>{reasoning.slice(0, 400)}{reasoning.length > 400 ? '...' : ''}</div>
                )}
              </div>
              {/* Answer */}
              <div style={{ padding: '8px 10px' }}>
                <div style={{ fontSize: 9, color: EMBRY.green, marginBottom: 2 }}>ANSWER</div>
                <div style={{ fontSize: 11, color: EMBRY.white, lineHeight: 1.5 }}>{String(qra.answer ?? '').slice(0, 500)}</div>
              </div>
              {/* Score bar */}
              <div style={{ display: 'flex', gap: 8, padding: '4px 10px 6px', borderTop: `1px solid ${EMBRY.border}` }}>
                {qra.grounding_score != null && (
                  <span style={{ fontSize: 9, color: EMBRY.muted }}>grounding: {Number(qra.grounding_score).toFixed(2)}</span>
                )}
                {grade && (
                  <span style={{ fontSize: 9, color: reasoningIsPlaceholder ? EMBRY.red : gradeColor }}>{reasoningIsPlaceholder ? 'PLACEHOLDER' : grade}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Relationships */}
      <div style={{ marginTop: 12, borderTop: `1px solid ${EMBRY.border}`, paddingTop: 12 }}>
        <div style={{ ...label, marginBottom: 8 }}>Relationships {relLoading ? '...' : `(${rels.length})`}</div>
        {!relLoading && rels.length === 0 && <div style={{ fontSize: 11, color: EMBRY.muted }}>No relationships found</div>}
        {rels.map((rel, i) => {
          const src = String(rel.source_control_id ?? '')
          const tgt = String(rel.target_control_id ?? '')
          const other = src === control.control_id ? tgt : src
          const method = String(rel.method ?? '')
          const score = Number(rel.combined_score ?? 0)
          return (
            <div key={`rel-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, padding: '4px 8px', backgroundColor: EMBRY.bgDeep, borderRadius: 4 }}>
              <span style={{ fontSize: 10, fontFamily: 'monospace', color: EMBRY.blue }}>{other}</span>
              <span style={{ fontSize: 9, color: EMBRY.muted }}>{method}</span>
              <span style={{ fontSize: 9, color: score > 0.7 ? EMBRY.green : score > 0.4 ? EMBRY.amber : EMBRY.dim, marginLeft: 'auto' }}>{score.toFixed(2)}</span>
            </div>
          )
        })}
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

function SourceRow({ name, tooltip, health, count, loading, isSelected, onClick, mono }: {
  name: string; tooltip: string; health: { color: string; label: string }; count: number; loading: boolean; isSelected: boolean; onClick: () => void; mono?: boolean
}) {
  return (
    <div
      onClick={onClick}
      title={tooltip}
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
        <span style={{ fontSize: 10, fontWeight: 700, color: EMBRY.accent, flexShrink: 0 }}>{loading ? '...' : count.toLocaleString()}</span>
      </div>
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

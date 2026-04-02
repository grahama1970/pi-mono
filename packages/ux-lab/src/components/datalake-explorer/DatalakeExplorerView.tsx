import { useState, useEffect, useCallback } from 'react'
import { Database, FileText, BarChart3, GitBranch, Shield, Layers, Activity, AlertTriangle } from 'lucide-react'
import { TraceabilityView } from './TraceabilityView'
import { EMBRY, label, card } from '../common/EmbryStyle'
import { LeftPane, LeftPaneSection, paneItemStyle, useLeftPaneSearch } from '../common/LeftPane'

/* ── Types ────────────────────────────────────────────────── */

interface DatalakeStats {
  scopes: { name: string; doc_count: number }[]
  total_documents: number
  total_sections: number
  total_requirements: number
  total_chunks: number
  total_pages: number
  extraction_coverage: number
}

interface DatalakeDoc {
  _key: string
  filename?: string
  title?: string
  scope?: string
  page_count?: number
  extraction_status?: string
  tags?: string[]
}

type Tab = 'overview' | 'corpus' | 'extraction' | 'requirements' | 'traceability' | 'cascade' | 'metrics' | 'quarantine'

const TABS: { key: Tab; label: string; icon: typeof Database }[] = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'corpus', label: 'Corpus', icon: Database },
  { key: 'extraction', label: 'Extraction', icon: FileText },
  { key: 'requirements', label: 'Requirements', icon: Shield },
  { key: 'traceability', label: 'Traceability', icon: GitBranch },
  { key: 'cascade', label: 'Cascade', icon: Layers },
  { key: 'metrics', label: 'Metrics', icon: Activity },
  { key: 'quarantine', label: 'Quarantine', icon: AlertTriangle },
]

const FALLBACK_SCOPES = [
  { name: 'extractor', doc_count: 0 },
  { name: 'fort_worth_f36', doc_count: 0 },
  { name: 'datalake_pdf', doc_count: 0 },
]

const API = 'http://localhost:3001'
const MONO = '"JetBrains Mono", "SF Mono", monospace'

/* ── Left Pane ────────────────────────────────────────────── */

function DatalakeLeftPane({
  scopes,
  activeScope,
  onSelectScope,
  documents,
  selectedDocKey,
  onSelectDoc,
}: {
  scopes: { name: string; doc_count: number }[]
  activeScope: string | null
  onSelectScope: (name: string | null) => void
  documents: DatalakeDoc[]
  selectedDocKey: string | null
  onSelectDoc: (key: string) => void
}) {
  const search = useLeftPaneSearch().toLowerCase()

  const filteredScopes = scopes.filter(
    s => !search || s.name.toLowerCase().includes(search),
  )
  const docLabel = (d: DatalakeDoc) => d.filename || d.title || d._key
  const filteredDocs = documents.filter(
    d => !search || docLabel(d).toLowerCase().includes(search),
  )

  return (
    <LeftPane title="Datalake Explorer" searchable>
      <LeftPaneSection title={`Scopes (${filteredScopes.length})`}>
        {filteredScopes.map(s => (
          <div
            key={s.name}
            style={{
              ...paneItemStyle(s.name === activeScope),
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
            onClick={() => onSelectScope(s.name === activeScope ? null : s.name)}
          >
            <span style={{ fontWeight: s.name === activeScope ? 700 : 400 }}>
              {s.name}
            </span>
            <span
              style={{
                fontSize: 9,
                fontFamily: MONO,
                color: EMBRY.dim,
                background: 'rgba(255,255,255,0.04)',
                padding: '1px 6px',
                borderRadius: 3,
              }}
            >
              {s.doc_count}
            </span>
          </div>
        ))}
      </LeftPaneSection>

      <LeftPaneSection
        title={`Documents (${filteredDocs.length})`}
      >
        {filteredDocs.length === 0 && (
          <div
            style={{
              padding: '12px 16px',
              fontSize: 11,
              color: EMBRY.dim,
              fontFamily: MONO,
            }}
          >
            {documents.length === 0 ? 'Loading...' : 'No matches'}
          </div>
        )}
        {filteredDocs.slice(0, 200).map(d => (
          <div
            key={d._key}
            style={{
              ...paneItemStyle(d._key === selectedDocKey),
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
            onClick={() => onSelectDoc(d._key)}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {docLabel(d)}
            </span>
            <span
              style={{
                fontSize: 8,
                color: EMBRY.dim,
                fontFamily: MONO,
              }}
            >
              {d.scope ? `${d.scope} · ` : ''}{d.page_count ? `${d.page_count}p` : d._key.slice(0, 12)}
            </span>
          </div>
        ))}
      </LeftPaneSection>
    </LeftPane>
  )
}

/* ── Tab Bar ──────────────────────────────────────────────── */

function TabBar({
  activeTab,
  onSelectTab,
  quarantineCount = 0,
}: {
  activeTab: Tab
  onSelectTab: (tab: Tab) => void
  quarantineCount?: number
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        padding: '0 12px',
        background: EMBRY.bgDeep,
        borderBottom: `1px solid ${EMBRY.border}`,
        flexShrink: 0,
      }}
    >
      {TABS.map(t => {
        const active = t.key === activeTab
        return (
          <button
            key={t.key}
            onClick={() => onSelectTab(t.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              padding: '8px 14px',
              fontSize: 10,
              fontWeight: active ? 700 : 500,
              fontFamily: '"Space Grotesk", sans-serif',
              letterSpacing: '0.04em',
              color: active ? EMBRY.accent : EMBRY.dim,
              background: 'transparent',
              border: 'none',
              borderBottom: active
                ? `2px solid ${EMBRY.accent}`
                : '2px solid transparent',
              cursor: 'pointer',
              transition: 'all 0.15s',
            }}
          >
            <t.icon size={12} />
            {t.label}
            {t.key === 'quarantine' && quarantineCount > 0 && <span style={{background:'#dc2626',color:'#fff',borderRadius:'50%',fontSize:9,padding:'1px 5px',marginLeft:4}}>{quarantineCount}</span>}
          </button>
        )
      })}
    </div>
  )
}

/* ── Tab Content Placeholders ─────────────────────────────── */

function OverviewTab({ stats }: { stats: DatalakeStats }) {
  const totalScopeDocs = (stats.scopes ?? []).reduce((sum, s) => sum + (s.doc_count ?? 0), 0)
  const cards = [
    { label: 'Lessons', value: totalScopeDocs.toLocaleString() },
    { label: 'Sections', value: (stats.total_sections ?? 0).toLocaleString() },
    { label: 'Requirements', value: (stats.total_requirements ?? 0).toLocaleString() },
    { label: 'Chunks', value: (stats.total_chunks ?? 0).toLocaleString() },
    { label: 'Documents', value: (stats.total_documents ?? 0).toLocaleString() },
    { label: 'Scopes', value: (stats.scopes ?? []).length },
  ]
  return (
    <div style={{ padding: 20 }}>
      <div style={{ ...label, marginBottom: 16 }}>Datalake Overview</div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {cards.map(c => (
          <div key={c.label} style={{ ...card, minWidth: 160, flex: '1 1 160px' }}>
            <div style={{ fontSize: 9, color: EMBRY.dim, fontFamily: MONO, marginBottom: 4 }}>
              {c.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: EMBRY.white, fontFamily: '"Space Grotesk", sans-serif' }}>
              {c.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Corpus Tab — document detail with chunk breakdown ────── */

function CorpusTab({ docKey }: { docKey: string | null }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!docKey) { setData(null); return }
    setLoading(true)
    // Fetch traceability to get section/req/table/figure counts
    fetch(`${API}/api/datalake/traceability`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ doc_key: docKey }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [docKey])

  if (!docKey) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: EMBRY.dim, fontFamily: MONO, fontSize: 12 }}>
      Select a document to view corpus details
    </div>
  )
  if (loading) return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: EMBRY.dim, fontFamily: MONO, fontSize: 12 }}>
      Loading...
    </div>
  )

  const doc = data?.document ?? {}
  const sections = data?.sections ?? []
  const requirements = data?.requirements ?? []
  const tables = data?.tables ?? []
  const figures = data?.figures ?? []
  const edges = data?.edges ?? {}

  const rows = [
    { label: 'Document Key', value: docKey },
    { label: 'Filename', value: doc.filename || doc.title || doc._key || '—' },
    { label: 'Sections', value: `${sections.length} (${edges.has_section ?? 0} edges)`, color: '#4CAF50' },
    { label: 'Requirements', value: `${requirements.length} (${edges.has_requirement ?? 0} edges)`, color: '#FF9800' },
    { label: 'Tables', value: `${tables.length} (${edges.has_table ?? 0} edges)`, color: '#2196F3' },
    { label: 'Figures', value: `${figures.length} (${edges.has_figure ?? 0} edges)`, color: '#9C27B0' },
  ]

  return (
    <div style={{ padding: 20, overflow: 'auto' }}>
      <div style={{ ...label, marginBottom: 16 }}>Document Detail</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map(r => (
          <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px', ...card }}>
            <span style={{ fontSize: 10, color: EMBRY.dim, fontFamily: MONO }}>{r.label}</span>
            <span style={{ fontSize: 11, color: (r as any).color ?? EMBRY.white, fontFamily: MONO, fontWeight: 600 }}>{r.value}</span>
          </div>
        ))}
      </div>

      {sections.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ ...label, marginBottom: 8, color: '#4CAF50' }}>Sections ({sections.length})</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sections.slice(0, 50).map((s: any, i: number) => (
              <div key={s._key ?? i} style={{ fontSize: 10, fontFamily: MONO, color: EMBRY.white, padding: '4px 8px', borderLeft: '2px solid #4CAF50' }}>
                {s.title || s.content?.slice(0, 80) || s._key}
                {s.page != null && <span style={{ color: EMBRY.dim, marginLeft: 8 }}>p.{s.page}</span>}
              </div>
            ))}
            {sections.length > 50 && <div style={{ fontSize: 9, color: EMBRY.dim, fontFamily: MONO }}>...and {sections.length - 50} more</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function PlaceholderTab({ name }: { name: string }) {
  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: EMBRY.dim,
        fontFamily: MONO,
        fontSize: 12,
      }}
    >
      {name} view — will be wired in a later task
    </div>
  )
}

/* ── Metrics Tab ─────────────────────────────────────────── */

interface MetricsReport {
  coverage_text?: number
  coverage_visual?: number
  documents_count?: number
  sections_count?: number
  integrity_summary?: { edge_count?: number; orphan_count?: number }
  issues?: { severity: string; code: string; message: string }[]
  retrieval_metrics?: { k: number; recall: number; ndcg: number; mrr: number }[]
  timestamp?: string
}

function coverageColor(v: number): string {
  if (v >= 0.99) return '#15803d' // green-700
  if (v >= 0.95) return '#b45309' // amber-700
  return '#dc2626' // red-600
}

function severityIcon(s: string): string {
  if (s === 'error') return '[!]'
  if (s === 'warn') return '[~]'
  return '[i]'
}

function MetricsTab({ setQuarantineCount }: { setQuarantineCount: React.Dispatch<React.SetStateAction<number>> }) {
  const [report, setReport] = useState<MetricsReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`${API}/api/datalake/metrics`)
      .then(r => { if (!r.ok) throw new Error(`${r.status}`); return r.json() })
      .then(d => { setReport(d); setError(false) })
      .catch(() => { setReport(null); setError(true) })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div style={{ padding: 20, fontSize: 11, fontFamily: MONO, color: EMBRY.dim }}>Loading metrics...</div>
  )
  if (error || !report) return (
    <div style={{ padding: 20, fontSize: 11, fontFamily: MONO, color: EMBRY.dim }}>
      No metrics reports yet. Run: <span style={{ color: EMBRY.white }}>pdf_lab.py metrics</span>
    </div>
  )

  const covText = report.coverage_text ?? 0
  const covVisual = report.coverage_visual ?? 0
  const issues = (report.issues ?? []).slice(0, 20)
  const integrity = report.integrity_summary ?? {}
  const retrieval = report.retrieval_metrics ?? []

  const gaugeStyle = (pct: number): React.CSSProperties => ({
    height: 14, borderRadius: 2, background: coverageColor(pct),
    width: `${Math.min(pct * 100, 100)}%`, transition: 'width 0.3s',
  })
  const gaugeTrack: React.CSSProperties = {
    height: 14, borderRadius: 2, background: 'rgba(255,255,255,0.06)', width: '100%',
  }

  return (
    <div style={{ padding: 20, overflow: 'auto', fontFamily: MONO, fontSize: 11 }}>
      <div style={{ ...label, marginBottom: 12 }}>Embedding Coverage</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 9, color: EMBRY.dim, marginBottom: 2 }}>Text embedding (384d) — {(covText * 100).toFixed(1)}%</div>
          <div style={gaugeTrack}><div style={gaugeStyle(covText)} /></div>
        </div>
        <div>
          <div style={{ fontSize: 9, color: EMBRY.dim, marginBottom: 2 }}>Visual embedding (2048d) — {(covVisual * 100).toFixed(1)}%</div>
          <div style={gaugeTrack}><div style={gaugeStyle(covVisual)} /></div>
        </div>
      </div>

      <div style={{ ...label, marginBottom: 8 }}>Stats</div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
        {[
          { k: 'Documents', v: report.documents_count ?? 0 },
          { k: 'Sections', v: report.sections_count ?? 0 },
          { k: 'Edges', v: integrity.edge_count ?? 0 },
          { k: 'Orphans', v: integrity.orphan_count ?? 0 },
        ].map(s => (
          <div key={s.k} style={{ ...card, minWidth: 100, padding: '6px 10px' }}>
            <div style={{ fontSize: 9, color: EMBRY.dim }}>{s.k}</div>
            <div style={{ fontSize: 16, fontWeight: 900, color: EMBRY.white }}>{s.v.toLocaleString()}</div>
          </div>
        ))}
      </div>

      {issues.length > 0 && (<>
        <div style={{ ...label, marginBottom: 8 }}>Issues ({issues.length})</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 20 }}>
          {issues.map((iss, i) => (
            <div key={i} style={{ fontSize: 10, color: iss.severity === 'error' ? '#dc2626' : iss.severity === 'warn' ? '#b45309' : EMBRY.dim }}>
              <span style={{ fontWeight: 700 }}>{severityIcon(iss.severity)} {iss.code}</span> {iss.message}
            </div>
          ))}
        </div>
        <button onClick={async () => {
          const r = await fetch('/api/quarantine/from-metrics', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({issues: report.issues?.slice(0,50) || [], source:'metrics'})})
          const d = await r.json()
          setQuarantineCount(prev => prev + (d?.created || 0))
        }} style={{background:'#dc2626',color:'#fff',padding:'4px 12px',fontFamily:'monospace',fontSize:11,border:'none',cursor:'pointer',marginTop:8}}>
          Quarantine {report?.issues?.length || 0} Issues
        </button>
      </>)}

      {retrieval.length > 0 && (<>
        <div style={{ ...label, marginBottom: 8 }}>Retrieval Metrics</div>
        <table style={{ borderCollapse: 'collapse', fontSize: 10 }}>
          <thead>
            <tr>{['K', 'Recall', 'nDCG', 'MRR'].map(h => (
              <th key={h} style={{ padding: '3px 10px', borderBottom: `1px solid ${EMBRY.border}`, color: EMBRY.dim, fontWeight: 600, textAlign: 'left' }}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {retrieval.map(r => (
              <tr key={r.k}>
                <td style={{ padding: '3px 10px', color: EMBRY.white }}>{r.k}</td>
                <td style={{ padding: '3px 10px', color: EMBRY.white }}>{r.recall.toFixed(3)}</td>
                <td style={{ padding: '3px 10px', color: EMBRY.white }}>{r.ndcg.toFixed(3)}</td>
                <td style={{ padding: '3px 10px', color: EMBRY.white }}>{r.mrr.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>)}

      {report.timestamp && (
        <div style={{ marginTop: 16, fontSize: 9, color: EMBRY.dim }}>Report: {report.timestamp}</div>
      )}
    </div>
  )
}

/* ── Main View ────────────────────────────────────────────── */

const EMPTY_STATS: DatalakeStats = {
  scopes: FALLBACK_SCOPES,
  total_documents: 0,
  total_sections: 0,
  total_requirements: 0,
  total_chunks: 0,
  total_pages: 0,
  extraction_coverage: 0,
}

export function DatalakeExplorerView() {
  const [activeScope, setActiveScope] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<Tab>('overview')
  const [selectedDocKey, setSelectedDocKey] = useState<string | null>(null)
  const [documents, setDocuments] = useState<DatalakeDoc[]>([])
  const [stats, setStats] = useState<DatalakeStats>(EMPTY_STATS)
  const [loading, setLoading] = useState(true)
  const [quarantineCount, setQuarantineCount] = useState(0)

  useEffect(() => { fetch('/api/quarantine?status=pending').then(r=>r.json()).then(d => setQuarantineCount(d?.documents?.length || d?.total || 0)).catch(()=>{}) }, [])

  // Fetch stats on mount (gracefully handles 404)
  useEffect(() => {
    setLoading(true)
    fetch(`${API}/api/datalake/stats`)
      .then(r => {
        if (!r.ok) throw new Error(`${r.status}`)
        return r.json()
      })
      .then((d: any) => {
        // Validate response shape — API may return {detail: "Not Found"} as 200
        if (d && Array.isArray(d.scopes)) {
          setStats(d as DatalakeStats)
        } else {
          setStats(EMPTY_STATS)
        }
        setDocuments([])
      })
      .catch(() => {
        setStats(EMPTY_STATS)
      })
      .finally(() => setLoading(false))
  }, [])

  // Fetch documents when scope changes
  useEffect(() => {
    const params = activeScope
      ? `?scope=${encodeURIComponent(activeScope)}`
      : ''
    fetch(`${API}/api/datalake/documents${params}`)
      .then(r => {
        if (!r.ok) throw new Error(`${r.status}`)
        return r.json()
      })
      .then((d: { documents: DatalakeDoc[] }) => {
        setDocuments(d.documents ?? [])
      })
      .catch(() => {
        setDocuments([])
      })
  }, [activeScope])

  const handleSelectScope = useCallback((name: string | null) => {
    setActiveScope(name)
    setSelectedDocKey(null)
  }, [])

  const handleSelectDoc = useCallback((key: string) => {
    setSelectedDocKey(key)
  }, [])

  // Visible documents filtered by scope
  const visibleDocs = activeScope
    ? documents.filter(d => d.scope === activeScope)
    : documents

  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        height: '100%',
        overflow: 'hidden',
        minHeight: 0,
        background: EMBRY.bg,
        color: EMBRY.white,
        fontFamily: '"Space Grotesk", sans-serif',
      }}
    >
      {/* Left Pane */}
      <DatalakeLeftPane
        scopes={stats.scopes}
        activeScope={activeScope}
        onSelectScope={handleSelectScope}
        documents={visibleDocs}
        selectedDocKey={selectedDocKey}
        onSelectDoc={handleSelectDoc}
      />

      {/* Main Content */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          minWidth: 0,
        }}
      >
        <TabBar activeTab={activeTab} onSelectTab={setActiveTab} quarantineCount={quarantineCount} />

        {/* Loading indicator */}
        {loading && (
          <div
            style={{
              padding: '8px 16px',
              fontSize: 10,
              color: EMBRY.amber,
              fontFamily: MONO,
              background: `${EMBRY.amber}08`,
              borderBottom: `1px solid ${EMBRY.border}`,
              flexShrink: 0,
            }}
          >
            Loading datalake stats...
          </div>
        )}

        {/* Tab content */}
        <div style={{ flex: 1, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
          {activeTab === 'overview' && <OverviewTab stats={stats} />}
          {activeTab === 'corpus' && <CorpusTab docKey={selectedDocKey} />}
          {activeTab === 'extraction' && <PlaceholderTab name="Extraction" />}
          {activeTab === 'requirements' && <PlaceholderTab name="Requirements" />}
          {activeTab === 'traceability' && <TraceabilityView docKey={selectedDocKey} />}
          {activeTab === 'cascade' && <PlaceholderTab name="Cascade" />}
          {activeTab === 'metrics' && <MetricsTab setQuarantineCount={setQuarantineCount} />}
          {activeTab === 'quarantine' && <PlaceholderTab name="Quarantine" />}
        </div>
      </div>
    </div>
  )
}

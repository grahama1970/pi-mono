import { useState, useEffect, useCallback } from 'react'
import { Database, FileText, BarChart3, GitBranch, Shield, Layers } from 'lucide-react'
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
  filename: string
  scope: string
  page_count: number
  extraction_status?: string
}

type Tab = 'overview' | 'corpus' | 'extraction' | 'requirements' | 'traceability' | 'cascade'

const TABS: { key: Tab; label: string; icon: typeof Database }[] = [
  { key: 'overview', label: 'Overview', icon: BarChart3 },
  { key: 'corpus', label: 'Corpus', icon: Database },
  { key: 'extraction', label: 'Extraction', icon: FileText },
  { key: 'requirements', label: 'Requirements', icon: Shield },
  { key: 'traceability', label: 'Traceability', icon: GitBranch },
  { key: 'cascade', label: 'Cascade', icon: Layers },
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
  const filteredDocs = documents.filter(
    d => !search || d.filename.toLowerCase().includes(search),
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
              {d.filename}
            </span>
            <span
              style={{
                fontSize: 8,
                color: EMBRY.dim,
                fontFamily: MONO,
              }}
            >
              {d.scope} · {d.page_count ?? '?'}p
              {d.extraction_status
                ? ` · ${d.extraction_status}`
                : ''}
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
}: {
  activeTab: Tab
  onSelectTab: (tab: Tab) => void
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
        <TabBar activeTab={activeTab} onSelectTab={setActiveTab} />

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
          {activeTab === 'corpus' && <PlaceholderTab name="Corpus" />}
          {activeTab === 'extraction' && <PlaceholderTab name="Extraction" />}
          {activeTab === 'requirements' && <PlaceholderTab name="Requirements" />}
          {activeTab === 'traceability' && <TraceabilityView docKey={selectedDocKey} />}
          {activeTab === 'cascade' && <PlaceholderTab name="Cascade" />}
        </div>
      </div>
    </div>
  )
}

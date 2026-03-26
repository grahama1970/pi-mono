import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Shield, Workflow, Trash2, Code, Layers, MessageSquare, Network, Search, History, Table2, Undo, Redo, GitGraph, List, Zap } from 'lucide-react'
import { EMBRY } from '../common/EmbryStyle'
import { LeftPane, LeftPaneSection, paneItemStyle, useLeftPaneSearch } from '../common/LeftPane'
import { ContextMenu } from '../common/ContextMenu'
import { StatusBar } from '../common/StatusBar'
import { CodePane } from './CodePane'
import { useLinkBus } from './useLinkBus'
import type { LinkLineEvent } from './useLinkBus'
import { BinaryGraph } from './BinaryGraph'
import { SymbolTree } from './SymbolTree'
import { useBinaryData, NODE_TYPE_COLORS } from '../../hooks/useBinaryData'
import type { BinaryGraphNode } from '../../hooks/useBinaryData'
import { IngestionProgress } from '../common/IngestionProgress'
import type { IngestStats } from '../common/IngestionProgress'
import { InvestigationJournal } from '../common/InvestigationJournal'
import type { Step } from '../common/InvestigationJournal'


const EDGE_COLORS: Record<string, string> = {
  contains: '#64748b', payload: '#2196F3', emits: '#FF9800',
  triggers: '#4CAF50', has_parameter: '#9C27B0',
}


/** API base — configurable via env or falls back to same-origin for production builds */
const API = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001')

/** Abbreviated node type labels for sidebar chips */
const TYPE_ABBREV: Record<string, string> = { rpc: 'rpc', event: 'evt', schema: 'sch', state_machine: 'sm', cli_command: 'cli', namespace: 'ns', parameter: 'par' }

/** Per-binary summary stats fetched from ArangoDB.
 *  File-level metadata (arch, format, size, hash) comes from binary_metadata collection
 *  populated by /analyze-elf during ingestion. Feature stats come from binary_features. */
interface BinaryMeta {
  name: string
  featureCount: number
  edgeCount: number
  byType: Record<string, number>
  confidence: number
  /** Binary format from header parsing (ELF, PE, Mach-O) — from binary_metadata collection */
  format: string
  /** Architecture from ELF header (x86_64, ARM, MIPS, etc.) */
  arch: string
  /** File size in bytes */
  sizeBytes: number
  /** SHA256 hash */
  sha256: string
  /** ELF security properties */
  stripped?: boolean
  pie?: boolean
  relro?: string
  importCount?: number
  entryPoint?: string
}

/** Left sidebar — binary selector, saved scenes, sessions. Uses shared LeftPane component. */
function BinaryLeftPane({ binaryName, binaries, binaryMetas, onSelectBinary, onRenameBinary, onDeleteBinary, onDuplicateBinary, savedScenes, onLoadScene, onIngest }: {
  binaryName: string
  binaries: string[]
  binaryMetas: Record<string, BinaryMeta>
  onSelectBinary: (name: string) => void
  onRenameBinary?: (name: string) => void
  onDeleteBinary?: (name: string) => void
  onDuplicateBinary?: (name: string) => void
  savedScenes: { name: string; nodeIds: string[]; perspective: string; layoutMode: string }[]
  onLoadScene: (scene: { nodeIds: string[]; perspective?: string; layoutMode?: string }) => void
  onIngest?: () => void
}) {
  const search = useLeftPaneSearch().toLowerCase()
  const filteredBinaries = binaries.filter(b => !search || b.toLowerCase().includes(search))
  const filteredScenes = savedScenes.filter(s => !search || s.name.toLowerCase().includes(search))
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; binary: string } | null>(null)

  return (
    <LeftPane title="Binary Explorer" searchable>
      <LeftPaneSection title={`Binaries (${filteredBinaries.length})`}>
        {filteredBinaries.length === 0 && (
          <div style={{ padding: '12px 10px', fontSize: 11, color: EMBRY.muted, textAlign: 'center' }}>
            {binaries.length === 0 ? 'No binaries ingested. Use + INGEST BINARY below to analyze an ELF.' : 'No matches for search.'}
          </div>
        )}
        {filteredBinaries.map(b => {
          const meta = binaryMetas[b]
          return (
            <div
              key={b}
              style={{ ...paneItemStyle(b === binaryName), display: 'flex', flexDirection: 'column', gap: 2 }}
              onClick={() => onSelectBinary(b)}
              tabIndex={0}
              role="button"
              aria-label={`Select binary: ${b}`}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelectBinary(b) } }}
              onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, binary: b }) }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: b === binaryName ? 700 : 500 }}>{b}</span>
                {meta && <span style={{ fontSize: 10, color: EMBRY.muted }}>{meta.featureCount} features</span>}
              </div>
              {meta && (
                <>
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    {Object.entries(meta.byType).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([type, count]) => {
                      return (
                        <span key={type} style={{
                          fontSize: 10, padding: '1px 5px', borderRadius: 2,
                          background: `${NODE_TYPE_COLORS[type] || EMBRY.muted}22`,
                          color: NODE_TYPE_COLORS[type] || EMBRY.muted,
                          border: `1px solid ${NODE_TYPE_COLORS[type] || EMBRY.muted}33`,
                        }}>
                          {count}{TYPE_ABBREV[type] || type}
                        </span>
                      )
                    })}
                  </div>
                  <div style={{ fontSize: 10, color: EMBRY.muted, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    {(meta.format || meta.arch) && (
                      <span style={{ fontWeight: 600, color: EMBRY.fg }}>
                        {[meta.format, meta.arch].filter(Boolean).join(' ')}
                      </span>
                    )}
                    <span>{meta.featureCount} features · {meta.edgeCount} edges</span>
                    {meta.sizeBytes > 0 && <span>{meta.sizeBytes > 1048576 ? `${(meta.sizeBytes / 1048576).toFixed(1)}MB` : `${(meta.sizeBytes / 1024).toFixed(0)}KB`}</span>}
                    {meta.sha256 && (
                      <span
                        title={`SHA256: ${meta.sha256}\nClick to copy`}
                        style={{ fontFamily: 'monospace', cursor: 'pointer', color: EMBRY.accent }}
                        onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(meta.sha256) }}
                      >{meta.sha256.slice(0, 8)}</span>
                    )}
                  </div>
                  {(meta.stripped !== undefined || meta.pie !== undefined) && (
                    <div style={{ fontSize: 9, display: 'flex', gap: 4 }}>
                      {meta.stripped && <span style={{ color: '#ef4444', fontSize: 9 }}>stripped</span>}
                      {meta.pie && <span style={{ color: '#22c55e', fontSize: 9 }}>PIE</span>}
                      {meta.relro && <span style={{ color: '#3b82f6', fontSize: 9 }}>{meta.relro}</span>}
                      {typeof meta.importCount === 'number' && <span style={{ color: EMBRY.muted }}>{meta.importCount} imports</span>}
                    </div>
                  )}
                </>
              )}
            </div>
          )
        })}
      </LeftPaneSection>
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onClose={() => setCtxMenu(null)}
          items={[
            { label: 'Rename', onClick: () => onRenameBinary?.(ctxMenu.binary) },
            { label: 'Duplicate', onClick: () => onDuplicateBinary?.(ctxMenu.binary) },
            { label: 'History', icon: <History size={12} />, onClick: () => { /* TODO: show binary history */ } },
            { label: 'Delete', danger: true, onClick: () => onDeleteBinary?.(ctxMenu.binary) },
          ]}
        />
      )}
      {filteredScenes.length > 0 && (
        <LeftPaneSection title={`Saved Scenes (${filteredScenes.length})`}>
          {filteredScenes.map(s => (
            <div key={s.name} style={paneItemStyle(false)} onClick={() => onLoadScene(s)} tabIndex={0} role="button" aria-label={`Load scene: ${s.name}`} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLoadScene(s) } }}>
              {s.name}
            </div>
          ))}
        </LeftPaneSection>
      )}
      {onIngest && (
        <div style={{ padding: '8px 10px', marginTop: 4 }}>
          <button
            onClick={onIngest}
            style={{
              width: '100%', padding: '5px 10px', fontSize: 9,
              fontWeight: 700, letterSpacing: '0.06em',
              background: `${EMBRY.accent}20`, border: `1px solid ${EMBRY.accent}44`,
              color: EMBRY.accent, borderRadius: 3, cursor: 'pointer',
            }}
          >+ INGEST BINARY</button>
        </div>
      )}
    </LeftPane>
  )
}


/** Lightweight markdown renderer */
function renderMarkdown(text: string, onFeatureClick: (name: string) => void) {
  const lines = text.split('\n')
  const elements: React.ReactNode[] = []
  let key = 0
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) { elements.push(<div key={key++} style={{ height: 4 }} />); continue }
    if (trimmed.startsWith('## ')) {
      elements.push(
        <div key={key++} style={{ fontSize: 9, fontWeight: 700, color: EMBRY.dim, letterSpacing: '0.08em', textTransform: 'uppercase' as const, marginTop: 8, marginBottom: 3 }}>
          {trimmed.slice(3)}
        </div>
      )
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      elements.push(
        <div key={key++} style={{ fontSize: 11, lineHeight: 1.7, color: EMBRY.white, paddingLeft: 12, position: 'relative' as const }}>
          <span style={{ position: 'absolute', left: 0, color: EMBRY.muted }}>·</span>
          {renderInline(trimmed.slice(2), onFeatureClick)}
        </div>
      )
    } else {
      elements.push(<div key={key++} style={{ fontSize: 11, lineHeight: 1.7, color: EMBRY.white }}>{renderInline(trimmed, onFeatureClick)}</div>)
    }
  }
  return elements
}

function renderInline(text: string, onFeatureClick: (name: string) => void): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const regex = /(`[^`]+`|\*\*[^*]+\*\*)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let i = 0
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push(text.slice(lastIndex, match.index))
    const token = match[0]
    if (token.startsWith('`')) {
      const name = token.slice(1, -1)
      parts.push(
        <code key={i++}
          onClick={() => onFeatureClick(name)}
          style={{
            background: '#0a0a0a', padding: '1px 4px', borderRadius: 3, fontSize: 10,
            color: '#22d3ee', fontFamily: 'JetBrains Mono, monospace',
            cursor: 'pointer',
            borderBottom: '1px dotted rgba(34,211,238,0.3)',
          }}
        >{name}</code>
      )
    } else if (token.startsWith('**')) {
      parts.push(<strong key={i++} style={{ color: '#22d3ee' }}>{token.slice(2, -2)}</strong>)
    }
    lastIndex = match.index + token.length
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return parts
}


interface ExplainStep { type: 'question' | 'grounding' | 'exploration' | 'intent' | 'answer'; label: string; detail?: string; chips?: { label: string; color: string }[] }
interface ChatMessage { role: 'user' | 'assistant'; content: string; isExplanation?: boolean; feedback?: 'up' | 'down' | null; _querySpec?: Record<string, unknown>; _explain?: ExplainStep[] }

type Perspective = 'all' | 'security' | 'data_flow' | 'protocol' | 'attack_surface'
const PERSPECTIVE_LABELS: Record<Perspective, string> = {
  all: 'All Features',
  security: 'Security',
  data_flow: 'Data Flow',
  protocol: 'Protocol',
  attack_surface: 'Attack Surface',
}
const PERSPECTIVE_TYPES: Record<Perspective, string[]> = {
  all: [],  // empty = no filter
  // Security: all types that represent exploitable entry points, validation schemas, and auth/state logic
  security: ['rpc', 'schema', 'event', 'namespace', 'cli_command', 'parameter'],
  data_flow: ['schema', 'event', 'state_machine', 'namespace'],
  protocol: ['namespace', 'rpc', 'cli_command', 'event'],
  // Attack surface: input handlers, network listeners, file parsers, CLI entry points
  attack_surface: ['cli_command', 'rpc', 'event', 'parameter'],
}

/** Professional error pane shown when the backend is unreachable or returns an error.
 *  Classifies the error, shows a human-readable message, and provides a retry button. */
function BackendErrorPane({ error, onRetry, api }: { error: string; onRetry: () => void; api: string }) {
  const [hovered, setHovered] = useState(false)
  const isNetwork = error.includes('fetch') || error.includes('NetworkError') || error.includes('Failed to fetch') || error.includes('ECONNREFUSED') || error.includes('ERR_CONNECTION')
  const isNotFound = error.includes('404') || error.toLowerCase().includes('not found')
  const isServer = error.includes('500') || error.toLowerCase().includes('internal server')
  const title = isNetwork ? 'BACKEND UNREACHABLE' : isNotFound ? 'DATA NOT FOUND' : isServer ? 'SERVER ERROR' : 'CONNECTION ERROR'
  const message = isNetwork
    ? 'Cannot connect to the analysis backend. The memory daemon may not be running.'
    : isNotFound
    ? 'Binary data not found. Try re-ingesting the binary using + INGEST BINARY in the sidebar.'
    : isServer
    ? 'The backend returned an internal server error. Check the backend logs for details.'
    : error.split('\n')[0].slice(0, 200)
  const hint = isNetwork ? `Expected backend at: ${api}` : isNotFound ? 'Re-ingest via the sidebar to rebuild the analysis.' : `Backend: ${api}`
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#050505' }}>
      <div style={{ width: 44, height: 44, border: `2px solid #ef4444`, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, color: '#ef4444', userSelect: 'none' }}>✕</div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 700, color: '#ef4444', letterSpacing: '0.1em' }}>{title}</div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: EMBRY.fg, maxWidth: 400, textAlign: 'center', lineHeight: 1.7 }}>{message}</div>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: EMBRY.dim, textAlign: 'center' }}>{hint}</div>
      <button
        onClick={onRetry}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fontWeight: 700,
          padding: '8px 24px', background: hovered ? `${EMBRY.accent}22` : 'transparent',
          border: `1px solid ${hovered ? EMBRY.accent : EMBRY.muted}`,
          color: hovered ? EMBRY.accent : EMBRY.muted,
          cursor: 'pointer', letterSpacing: '0.08em', transition: 'all 0.15s',
        }}
      >
        ↺ RETRY CONNECTION
      </button>
    </div>
  )
}

export function BinaryExplorerView() {
  // --- Initialization ---
  const [binaryName, setBinaryName] = useState(() => {
    const hash = window.location.hash
    if (hash.startsWith('#binary-explorer/')) {
      return hash.split(/[?#]/)[1].split('/')[1] || 'droid'
    }
    return 'droid'
  })
  const data = useBinaryData(binaryName)

  // --- Scene State (progressive disclosure: graph starts EMPTY, materializes through interaction) ---
  const [sceneNodeIds, setSceneNodeIds] = useState<Set<string>>(new Set())
  const [selectedNode, setSelectedNode] = useState<BinaryGraphNode | null>(null)
  const [breadcrumbs, setBreadcrumbs] = useState<BinaryGraphNode[]>([])
  const visitedNodeIds = useMemo(() => new Set(breadcrumbs.map(b => b.id)), [breadcrumbs])

  // --- Undo/Redo History (max 50 snapshots of sceneNodeIds + selectedNode) ---
  const [sceneHistory, setSceneHistory] = useState<Set<string>[]>([new Set()])
  const [historyIndex, setHistoryIndex] = useState(0)
  const sceneHistoryRef = useRef<Set<string>[]>([new Set()])
  const historyIndexRef = useRef(0)
  const isUndoingRef = useRef(false)

  // --- Chat State ---
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatInput, setChatInput] = useState('')
  const [chatLoading, setChatLoading] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [seedDone, setSeedDone] = useState(0) // node count after seed, briefly shown as confirmation toast

  // --- Graph Visual State ---
  const [viewMode, setViewMode] = useState<'graph' | 'tree' | 'code' | 'vulns'>('graph')
  const [layoutMode, setLayoutMode] = useState<'organic' | 'stratified' | 'clustered'>('organic')
  const [llmMentionedIds, setLlmMentionedIds] = useState<Set<string>>(new Set())
  const [perspective, setPerspective] = useState<Perspective>('all')

  // --- Inspector State ---
  const [nodeExplanation, setNodeExplanation] = useState<string | null>(null)
  const [nodeExplanationLoading, setNodeExplanationLoading] = useState(false)
  const [dataPanelHeight, setDataPanelHeight] = useState(220)
  const [dataTab, setDataTab] = useState<'summary' | 'connections' | 'ast' | 'explain' | 'raw' | 'table' | 'code'>('summary')
  const [tableSearch, setTableSearch] = useState('')
  const [tableSortKey, setTableSortKey] = useState<'label' | 'nodeType' | 'cluster' | 'confidence' | 'connections' | 'cwe' | 'attack' | 'address' | 'size' | 'namespace'>('connections')
  const [tableSortAsc, setTableSortAsc] = useState(false)
  const [tableVisibleCols, setTableVisibleCols] = useState<Set<string>>(new Set(['label', 'nodeType', 'address', 'size', 'namespace', 'connections', 'cwe', 'attack']))
  const [tableAnnotations, setTableAnnotations] = useState<Record<string, string>>({})
  const [tableShowColPicker, setTableShowColPicker] = useState(false)

  // --- Taxonomy State ---
  const [taxonomyMap, setTaxonomyMap] = useState<Map<string, { mind: string[]; cwe: string[]; attack: string[]; d3fend: string[]; nist: string[] }>>(new Map())
  const [taxonomyLoading, setTaxonomyLoading] = useState(false)

  // --- Code View State ---
  const [codeViewTab, setCodeViewTab] = useState<'assembly' | 'decompiled' | 'pseudocode'>('pseudocode')
  const [pseudocode, setPseudocode] = useState<string | null>(null)
  const [pseudocodeLoading, setPseudocodeLoading] = useState(false)
  const [pseudocodeModel, setPseudocodeModel] = useState<string | null>(null)
  const [pseudocodeGenCount, setPseudocodeGenCount] = useState(0)
  const [leftPaneWidth, setLeftPaneWidth] = useState(65)

  // --- Voice State ---
  const [isListening, setIsListening] = useState(false)
  const [ttsEnabled, setTtsEnabled] = useState(true)

  // --- Binary Selector (dynamic from ArangoDB — no hardcoded fallbacks) ---
  const [binaries, setBinaries] = useState<string[]>([])
  const [binaryMetas, setBinaryMetas] = useState<Record<string, BinaryMeta>>({})
  const [binarySearchQuery, setBinarySearchQuery] = useState('')

  // --- Ingestion State ---
  const [ingestPath, setIngestPath] = useState('')
  const [isIngesting, setIsIngesting] = useState(false)

  // Load available binaries from ArangoDB on mount — with per-binary metadata
  useEffect(() => {
    Promise.all([
      fetch(`${API}/api/memory/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: 'binary_features', limit: 500, return_fields: ['binary_name', 'node_type', 'confidence'] }),
      }).then(r => r.json()),
      fetch(`${API}/api/memory/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: 'binary_feature_edges', limit: 500, return_fields: ['binary_name'] }),
      }).then(r => r.json()),
      // Fetch file-level metadata (arch, format, size, hash) from binary_metadata collection
      fetch(`${API}/api/memory/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: 'binary_metadata', limit: 100, return_fields: ['binary_name', 'format', 'arch', 'size_bytes', 'sha256'] }),
      }).then(r => r.json()).catch(() => ({ documents: [] })),
    ])
      .then(([featData, edgeData, metadataData]) => {
        const docs = featData.documents || []
        const edgeDocs = edgeData.documents || []
        // Build per-binary metadata from all features
        const metaMap: Record<string, BinaryMeta> = {}
        for (const doc of docs) {
          const bn = (doc as { binary_name?: string }).binary_name || ''
          if (!bn) continue
          if (!metaMap[bn]) metaMap[bn] = { name: bn, featureCount: 0, edgeCount: 0, byType: {}, confidence: 0, format: '', arch: '', sizeBytes: 0, sha256: '' }
          const m = metaMap[bn]
          m.featureCount++
          const nt = (doc as { node_type?: string }).node_type || 'unknown'
          m.byType[nt] = (m.byType[nt] || 0) + 1
          m.confidence += (doc as { confidence?: number }).confidence || 0
        }
        // Count edges per binary
        for (const doc of edgeDocs) {
          const bn = (doc as { binary_name?: string }).binary_name || ''
          if (bn && metaMap[bn]) metaMap[bn].edgeCount++
        }
        // Average confidence
        for (const m of Object.values(metaMap)) {
          m.confidence = m.featureCount > 0 ? Math.round(m.confidence / m.featureCount * 100) / 100 : 0
        }
        // Merge file-level metadata (arch, format, size, hash)
        for (const doc of (metadataData.documents || [])) {
          const bn = (doc as { binary_name?: string }).binary_name || ''
          if (bn && metaMap[bn]) {
            const d = doc as Record<string, unknown>
            if (d.format) metaMap[bn].format = String(d.format)
            if (d.arch) metaMap[bn].arch = String(d.arch)
            if (d.size_bytes) metaMap[bn].sizeBytes = Number(d.size_bytes)
            if (d.sha256) metaMap[bn].sha256 = String(d.sha256)
            if (d.stripped !== undefined) metaMap[bn].stripped = Boolean(d.stripped)
            if (d.pie !== undefined) metaMap[bn].pie = Boolean(d.pie)
            if (d.relro) metaMap[bn].relro = String(d.relro)
            if (d.import_count !== undefined) metaMap[bn].importCount = Number(d.import_count)
            if (d.entry_point) metaMap[bn].entryPoint = String(d.entry_point)
          }
        }
        setBinaryMetas(metaMap)
        const names = Object.keys(metaMap).sort()
        if (names.length > 0) setBinaries(names)
      })
      .catch(() => {})
  }, [])

  // Load taxonomy tags for all nodes when data changes
  useEffect(() => {
    if (!data.graphNodes.length || taxonomyMap.size > 0) return
    setTaxonomyLoading(true)
    // Batch extract taxonomy for node descriptions/labels
    const nodes = data.graphNodes.filter(n => n.nodeType !== 'namespace').slice(0, 200)
    const promises = nodes.map(n =>
      fetch(`${API}/api/memory/taxonomy/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `${n.label} ${n.description || ''} ${n.nodeType}` }),
      })
        .then(r => r.json())
        .then(d => ({ id: n.id, tags: d }))
        .catch(() => ({ id: n.id, tags: {} }))
    )
    // Process in batches of 20 to avoid overwhelming the server
    const batchSize = 20
    const batches: typeof promises[] = []
    for (let i = 0; i < promises.length; i += batchSize) {
      batches.push(promises.slice(i, i + batchSize))
    }
    ;(async () => {
      const newMap = new Map<string, { mind: string[]; cwe: string[]; attack: string[]; d3fend: string[]; nist: string[] }>()
      for (const batch of batches) {
        const results = await Promise.all(batch)
        for (const { id, tags } of results) {
          newMap.set(id, {
            mind: tags.mind || [],
            cwe: tags.cwe || [],
            attack: tags.attack || [],
            d3fend: tags.d3fend || [],
            nist: tags.nist || [],
          })
        }
      }
      setTaxonomyMap(newMap)
      setTaxonomyLoading(false)
    })()
  }, [data.graphNodes.length])

  // Generate Python pseudocode for selected node
  useEffect(() => {
    if (!selectedNode || codeViewTab !== 'pseudocode' || dataTab !== 'code') return
    if (pseudocodeLoading) return
    setPseudocodeLoading(true)
    setPseudocode(null)
    setPseudocodeModel(null)
    const nodeInfo = `Feature: ${selectedNode.label}\nType: ${selectedNode.nodeType}\nDescription: ${selectedNode.description || 'N/A'}\n${selectedNode.source_pattern ? `Source pattern:\n${selectedNode.source_pattern}` : ''}${selectedNode.fields?.length ? `\nFields: ${selectedNode.fields.map((f: any) => f.name || f).join(', ')}` : ''}${selectedNode.states?.length ? `\nStates: ${selectedNode.states.map((s: any) => s.name || s).join(', ')}` : ''}`

    fetch('/api/scillm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'text',
        messages: [
          { role: 'system', content: 'You are a reverse engineering expert assistant. Convert binary feature descriptions into Pythonic pseudocode for RE analysts. Use ctypes or construct-style structs where applicable. Include comments explaining obfuscation patterns, data structures, and control flow. Be concise (under 50 lines) and accurate — never invent behaviors not present in the feature description.' },
          { role: 'user', content: `Generate Python pseudocode for this binary feature:\n\n${nodeInfo}` }
        ],
        temperature: 0.2,
        max_tokens: 800,
      }),
    })
      .then(r => r.json())
      .then((d: any) => {
        setPseudocode(d.choices?.[0]?.message?.content || '# No pseudocode generated')
        setPseudocodeModel(d.model || 'scillm')
      })
      .catch(() => { setPseudocode('# Error: LLM service unavailable'); setPseudocodeModel(null) })
      .finally(() => setPseudocodeLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode?.id, codeViewTab, dataTab, pseudocodeGenCount])

  // --- Saved Scenes ---
  const [savedScenes, setSavedScenes] = useState<{ name: string; nodeIds: string[]; perspective: Perspective; layoutMode: string }[]>([])
  const [sceneName, setSceneName] = useState('')

  // --- Context Menu ---
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, node: BinaryGraphNode } | null>(null)
  /** Local rename overrides: nodeId → display label */
  const [nodeLabels, setNodeLabels] = useState<Record<string, string>>({})
  /** Local annotations: nodeId → comment text */
  const [nodeAnnotations, setNodeAnnotations] = useState<Record<string, string>>({})

  // --- Investigation Journal ---
  const [journalSteps, setJournalSteps] = useState<Step[]>([])
  const [rightTab, setRightTab] = useState<'chat' | 'journal'>('chat')
  const [analysisMode, setAnalysisMode] = useState<'beginner' | 'investigator'>('beginner')
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set(['rpc', 'event', 'schema', 'state_machine', 'cli_command', 'namespace', 'parameter']))
  const [splitCodeView, setSplitCodeView] = useState(false) // Godbolt-style horizontal split: code left, graph right
  const linkBus = useLinkBus()
  const [linkedNodeId, setLinkedNodeId] = useState<string | null>(null) // node highlighted by code hover

  /** Record an investigation step. Snapshot is attached asynchronously via useEffect. */
  const recordStep = useCallback((action: Step['action'], description: string) => {
    setJournalSteps(prev => [...prev, { timestamp: new Date().toISOString(), action, description }])
  }, [])

  /** Attach scene snapshot to the latest step once state settles. */
  useEffect(() => {
    setJournalSteps(prev => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      if (last.snapshot) return prev // already snapshotted
      const updated = [...prev]
      updated[updated.length - 1] = {
        ...last,
        snapshot: {
          sceneNodeIds: [...sceneNodeIds],
          selectedNodeId: selectedNode?.id ?? null,
          breadcrumbIds: breadcrumbs.map(b => b.id),
        },
      }
      return updated
    })
  }, [sceneNodeIds, selectedNode, breadcrumbs])

  // --- Refs ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null)
  const chatScrollRef = useRef<HTMLDivElement>(null)
  const lastExplainedId = useRef<string | null>(null)
  const skipNextExplanationRef = useRef<boolean>(false)
  const graphSvgRef = useRef<SVGSVGElement | null>(null)
  const lastConceptSearch = useRef<string>('')
  const explanationAbortRef = useRef<AbortController | null>(null)
  const explainTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // --- Scene Helpers (progressive disclosure: materialize nodes into the scene) ---
  const addToScene = useCallback((nodeIds: string[]) => {
    setSceneNodeIds(prev => {
      // Only create new Set if there are actually new nodes to add
      const newIds = nodeIds.filter(id => !prev.has(id))
      if (newIds.length === 0) return prev // Same reference = no re-render
      const next = new Set(prev)
      newIds.forEach(id => next.add(id))
      return next
    })
  }, [])

  const addNodeWithNeighbors = useCallback((nodeId: string, hops = 1, maxPerHop = 12, silent = false) => {
    const ids = new Set<string>([nodeId])
    let frontier = new Set([nodeId])
    const edgePriority: Record<string, number> = { triggers: 0, emits: 1, payload: 2, contains: 3, has_parameter: 4 }
    console.log('[addNodeWithNeighbors]', { nodeId, hops, maxPerHop, totalEdges: data.allEdges.length, frontierSize: frontier.size })
    for (let i = 0; i < hops; i++) {
      const candidates: { id: string; priority: number }[] = []
      data.allEdges.forEach(e => {
        const p = edgePriority[e.edge_type] ?? 3
        if (frontier.has(e._from) && !ids.has(e._to)) candidates.push({ id: e._to, priority: p })
        if (frontier.has(e._to) && !ids.has(e._from)) candidates.push({ id: e._from, priority: p })
      })
      frontier.forEach(id => ids.add(id))
      console.log('[addNodeWithNeighbors] hop', i, 'candidates:', candidates.length, candidates.slice(0, 3).map(c => c.id.split('/').pop()))
      candidates.sort((a, b) => a.priority - b.priority)
      // Deduplicate and cap
      const seen = new Set<string>()
      let added = 0
      for (const c of candidates) {
        if (seen.has(c.id) || added >= maxPerHop) continue
        seen.add(c.id)
        ids.add(c.id)
        added++
      }
      frontier = new Set(candidates.map(c => c.id))
    }
    addToScene([...ids])
    if (!silent) {
      const label = data.graphNodes.find(n => n.id === nodeId)?.label ?? nodeId.split('/').pop() ?? nodeId
      recordStep('expand', `Expanded: ${label} (${hops} hop${hops > 1 ? 's' : ''}, max ${maxPerHop} neighbors)`)
    }
  }, [data.allEdges, data.graphNodes, addToScene, recordStep])

  const removeFromScene = useCallback((nodeId: string) => {
    setSceneNodeIds(prev => {
      if (!prev.has(nodeId)) return prev
      const next = new Set(prev)
      next.delete(nodeId)
      return next
    })
    if (selectedNode?.id === nodeId) setSelectedNode(null)
    setContextMenu(null)
  }, [selectedNode])

  const clearScene = useCallback(() => {
    setSceneNodeIds(new Set())
    setSelectedNode(null)
    setBreadcrumbs([])
    setLlmMentionedIds(new Set())
    recordStep('scene_clear', 'Cleared scene')
  }, [recordStep])

  // --- Undo/Redo Internals ---
  /** Push a snapshot of the current scene to the history stack. Deduplicates identical consecutive states. */
  const pushSnapshot = useCallback((newScene: Set<string>) => {
    const current = sceneHistoryRef.current[historyIndexRef.current]
    // Skip if scene is identical to current snapshot
    if (current && current.size === newScene.size && [...newScene].every(id => current.has(id))) return
    const truncated = sceneHistoryRef.current.slice(0, historyIndexRef.current + 1)
    const withNew = [...truncated, new Set(newScene)]
    const capped = withNew.length > 50 ? withNew.slice(withNew.length - 50) : withNew
    const newIdx = capped.length - 1
    sceneHistoryRef.current = capped
    historyIndexRef.current = newIdx
    setSceneHistory(capped)
    setHistoryIndex(newIdx)
  }, [])

  /** Restore previous scene snapshot (Ctrl+Z). Adds a 'reverted' step to the chat journal. */
  const undo = useCallback(() => {
    const idx = historyIndexRef.current
    if (idx <= 0) return
    const newIdx = idx - 1
    historyIndexRef.current = newIdx
    isUndoingRef.current = true
    setHistoryIndex(newIdx)
    setSceneNodeIds(new Set(sceneHistoryRef.current[newIdx]))
    setSelectedNode(null)
    setChatMessages(msgs => [...msgs, {
      role: 'assistant' as const,
      content: `↩ _Scene reverted (step ${newIdx + 1}/${sceneHistoryRef.current.length})._`,
      isExplanation: true,
    }])
  }, [])

  /** Restore next scene snapshot (Ctrl+Shift+Z). Adds a 'restored' step to the chat journal. */
  const redo = useCallback(() => {
    const idx = historyIndexRef.current
    if (idx >= sceneHistoryRef.current.length - 1) return
    const newIdx = idx + 1
    historyIndexRef.current = newIdx
    isUndoingRef.current = true
    setHistoryIndex(newIdx)
    setSceneNodeIds(new Set(sceneHistoryRef.current[newIdx]))
    setSelectedNode(null)
    setChatMessages(msgs => [...msgs, {
      role: 'assistant' as const,
      content: `↪ _Scene restored (step ${newIdx + 1}/${sceneHistoryRef.current.length})._`,
      isExplanation: true,
    }])
  }, [])

  const handleIngestComplete = useCallback((_stats: IngestStats) => {
    setIsIngesting(false)
    // Derive binary name from path (strip dirs and extension)
    const name = ingestPath.split('/').pop()?.replace(/\.[^.]+$/, '') ?? ingestPath
    if (name) {
      setBinaries(prev => prev.includes(name) ? prev : [...prev, name].sort())
      setBinaryName(name)
    }
    data.refresh()
  }, [ingestPath, data])

  const showAllNodes = useCallback((includeParams = false) => {
    const nodes = includeParams
      ? data.graphNodes
      : data.graphNodes.filter(n => n.nodeType !== 'parameter')
    addToScene(nodes.map(n => n.id))
  }, [data.graphNodes, addToScene])

  // --- Scene Save/Load/Export/Import ---
  const buildScenePayload = useCallback((name: string) => ({
    name: name.trim(),
    binary: binaryName,
    nodeIds: [...sceneNodeIds],
    perspective,
    layoutMode,
    selectedNodeId: selectedNode?.id || null,
    breadcrumbIds: breadcrumbs.map(b => b.id),
    annotations: nodeAnnotations,
    nodeLabels,
    chatHistory: chatMessages,
    savedAt: new Date().toISOString(),
    version: 2,
  }), [sceneNodeIds, binaryName, perspective, layoutMode, selectedNode, breadcrumbs, nodeAnnotations, nodeLabels, chatMessages])

  const exportScene = useCallback((name: string) => {
    if (sceneNodeIds.size === 0) return
    const payload = buildScenePayload(name || `${binaryName}-scene`)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${payload.name.replace(/\s+/g, '-')}.scene.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [sceneNodeIds, buildScenePayload, binaryName])

  const importScene = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target?.result as string)
          if (parsed.nodeIds) {
            loadScene(parsed)
            if (parsed.annotations) setNodeAnnotations(parsed.annotations)
            if (parsed.nodeLabels) setNodeLabels(parsed.nodeLabels)
            if (parsed.chatHistory?.length) setChatMessages(parsed.chatHistory)
            if (parsed.name) setSceneName(parsed.name)
          }
        } catch { /* ignore malformed */ }
      }
      reader.readAsText(file)
    }
    input.click()
  }, [loadScene])

  const saveScene = useCallback(async (name: string) => {
    if (!name.trim() || sceneNodeIds.size === 0) return
    const sceneData = buildScenePayload(name)
    try {
      await fetch(`${API}/api/memory/learn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problem: `[scene:${binaryName}] ${name.trim()}`,
          solution: JSON.stringify(sceneData),
          tags: ['binary-explorer-scene', binaryName, `scene:${name.trim()}`],
          scope: 'binary-explorer',
        }),
      })
      setSceneName('')
      loadSavedScenes()
    } catch (err) {
      console.error('Failed to save scene:', err)
    }
  }, [buildScenePayload, sceneNodeIds, binaryName])

  const loadScene = useCallback((sceneData: { nodeIds: string[]; perspective?: string; layoutMode?: string; selectedNodeId?: string; breadcrumbIds?: string[] }) => {
    setSceneNodeIds(new Set(sceneData.nodeIds))
    if (sceneData.perspective && Object.keys(PERSPECTIVE_TYPES).includes(sceneData.perspective)) {
      setPerspective(sceneData.perspective as Perspective)
    }
    if (sceneData.layoutMode) {
      setLayoutMode(sceneData.layoutMode as 'organic' | 'stratified' | 'clustered')
    }
    if (sceneData.selectedNodeId) {
      const node = data.graphNodes.find(n => n.id === sceneData.selectedNodeId)
      if (node) setSelectedNode(node)
    }
    if (sceneData.breadcrumbIds) {
      const bc = sceneData.breadcrumbIds
        .map(id => data.graphNodes.find(n => n.id === id))
        .filter((n): n is BinaryGraphNode => n != null)
      setBreadcrumbs(bc)
    }
  }, [data.graphNodes])

  const loadSavedScenes = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/memory/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: `scene ${binaryName}`, k: 10, labels: ['binary-explorer-scene'] }),
      })
      if (res.ok) {
        const d = await res.json()
        if (d.found && d.items?.length > 0) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const scenes = d.items.map((item: any) => {
            try {
              const parsed = typeof item.solution === 'string' ? JSON.parse(item.solution) : item.solution
              return parsed
            } catch { return null }
          }).filter((s: unknown): s is { name: string; nodeIds: string[]; perspective: Perspective; layoutMode: string } => s != null && typeof s === 'object' && 'name' in (s as Record<string, unknown>))
          setSavedScenes(scenes)
        }
      }
    } catch {}
  }, [binaryName])

  // Load saved scenes on binary change
  useEffect(() => {
    if (!data.loading && data.graphNodes.length > 0) loadSavedScenes()
  }, [data.loading, data.graphNodes.length, loadSavedScenes])

  // Auto-seed on first load: namespaces + top 3 most-connected nodes
  const [autoSeeded, setAutoSeeded] = useState(false)
  useEffect(() => {
    if (autoSeeded || data.loading || data.graphNodes.length === 0 || sceneNodeIds.size > 0) return
    const namespaces = data.graphNodes.filter(n => n.nodeType === 'namespace')
    const topHubs = data.graphNodes
      .filter(n => n.nodeType !== 'parameter' && n.nodeType !== 'namespace')
      .map(n => ({ id: n.id, deg: data.allEdges.filter(e => e._from === n.id || e._to === n.id).length }))
      .sort((a, b) => b.deg - a.deg)
      .slice(0, 3)
    const seedIds = [...namespaces.map(n => n.id), ...topHubs.map(n => n.id)]
    if (seedIds.length > 0) {
      addToScene(seedIds)
      setAutoSeeded(true)
    }
  }, [data.loading, data.graphNodes.length, sceneNodeIds.size, autoSeeded])

  // --- Link Bus subscriber: code pane → graph highlighting ---
  useEffect(() => {
    return linkBus.subscribe((evt: LinkLineEvent) => {
      if (evt.sender === 'code') {
        // Code pane emitted — highlight the referenced node in the graph
        setLinkedNodeId(evt.sourceNodeId)
        if (evt.reveal) {
          // Pan graph to the node
          const node = data.graphNodes.find(n => n.id === evt.sourceNodeId)
          if (node && !sceneNodeIds.has(node.id)) {
            addToScene([node.id])
          }
        }
      }
    })
  }, [linkBus, data.graphNodes, sceneNodeIds, addToScene])

  // --- Graph Helpers ---
  const onNodeClick = useCallback((node: BinaryGraphNode) => {
    setSelectedNode(node)

    // Emit graph→code link event
    linkBus.emit({ sourceNodeId: node.id, sender: 'graph', reveal: true, label: node.label })

    // Breadcrumbs: add unique or move to end
    setBreadcrumbs(prev => {
      const filtered = prev.filter(b => b.id !== node.id)
      return [...filtered, node].slice(-8)
    })

    // Add node + 6 closest neighbors so edges are visible immediately (silent — onNodeClick records its own step)
    addNodeWithNeighbors(node.id, 1, 6, true)
    recordStep('node_click', `Clicked: ${node.label} (${node.nodeType})`)
  }, [addNodeWithNeighbors, recordStep])

  // --- Auto-snapshot: push to sceneHistory whenever sceneNodeIds changes (skip during undo/redo) ---
  useEffect(() => {
    if (isUndoingRef.current) {
      isUndoingRef.current = false
      return
    }
    pushSnapshot(sceneNodeIds)
  }, [sceneNodeIds, pushSnapshot])

  // --- Keyboard Shortcuts ---
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      if (e.key === '?') { e.preventDefault(); setShowKeyboardHelp(h => !h); return }
      if (!inInput) {
        if (e.key === 'Escape') { setShowKeyboardHelp(false); setContextMenu(null); return }
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          if (e.key === 'g') { setViewMode('graph'); return }
          if (e.key === 't') { setViewMode('tree'); return }
          if (e.key === 'c') { setViewMode('code'); return }
          if (e.key === 'v') { setViewMode('vulns'); return }
          if (e.key === '/') { e.preventDefault(); (document.querySelector('input[placeholder]') as HTMLInputElement)?.focus(); return }
          if (e.key === 'e' && selectedNode) { addNodeWithNeighbors(selectedNode.id, 1, 6); return }
        }
      }
      if (!e.ctrlKey) return
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo, selectedNode, addNodeWithNeighbors])

  // --- Voice Input (STT) ---
  useEffect(() => {
    const SpeechRecognition = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition
    if (SpeechRecognition) {
      recognitionRef.current = new SpeechRecognition()
      recognitionRef.current.continuous = true
      recognitionRef.current.interimResults = true
      recognitionRef.current.onresult = (event: any) => {
        let interimTranscript = ''
        let finalTranscript = ''
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript
          else interimTranscript += event.results[i][0].transcript
        }
        if (finalTranscript) setChatInput(prev => prev + finalTranscript)
        else if (interimTranscript) setChatInput(interimTranscript)
      }
      recognitionRef.current.onstart = () => setIsListening(true)
      recognitionRef.current.onend = () => setIsListening(false)
      recognitionRef.current.onerror = (err: any) => {
        console.error('Speech recognition error:', err)
        setIsListening(false)
      }
    }
  }, [])

  const toggleListening = () => {
    if (!recognitionRef.current) return
    if (isListening) recognitionRef.current.stop()
    else { setChatInput(''); recognitionRef.current.start() }
  }

  // --- Voice Output (TTS) ---
  useEffect(() => {
    if (!ttsEnabled || chatMessages.length === 0) return
    const lastMsg = chatMessages[chatMessages.length - 1]
    if (lastMsg.role === 'assistant' && !lastMsg.content.includes('_✨ UI Command:')) {
      const timer = setTimeout(() => {
        const cleanContent = lastMsg.content.replace(/```[\s\S]*?```/g, '').replace(/[`*#]/g, '').trim()
        if (!cleanContent) return
        const utterance = new SpeechSynthesisUtterance(cleanContent)
        utterance.rate = 1.1; utterance.pitch = 1.0
        const voices = window.speechSynthesis.getVoices()
        const voice = voices.find(v => v.name.includes('Google US English') || v.name.includes('Samantha') || v.name.includes('English'))
        if (voice) utterance.voice = voice
        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(utterance)
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [chatMessages, ttsEnabled])

  const toggleTts = () => {
    if (ttsEnabled) window.speechSynthesis.cancel()
    setTtsEnabled(!ttsEnabled)
  }

  // --- Navigation & State Sync ---
  useEffect(() => {
    const hash = window.location.hash
    if (hash.startsWith('#binary-explorer/')) {
      const q = hash.split('?')[1]
      if (q) {
        const params = new URLSearchParams(q)
        const p = params.get('perspective')
        if (p && Object.keys(PERSPECTIVE_TYPES).includes(p)) setPerspective(p as Perspective)
        const nId = params.get('node')
        if (nId && !data.loading && data.graphNodes.length > 0 && !selectedNode) {
          const match = data.graphNodes.find(n => n.id === nId)
          if (match) {
            addNodeWithNeighbors(match.id, 1, 12)
            setSelectedNode(match)
          }
        }
      }
    }
  }, [data.loading, data.graphNodes, selectedNode])

  useEffect(() => {
    const params = new URLSearchParams()
    if (perspective !== 'all') params.set('perspective', perspective)
    if (selectedNode) params.set('node', selectedNode.id)
    const newHash = `#binary-explorer/${binaryName}` + (params.toString() ? `?${params.toString()}` : '')
    if (window.location.hash !== newHash) window.history.replaceState(null, '', newHash)
  }, [binaryName, perspective, selectedNode])

  // --- Content Logic ---
  const extractMentionedNodes = useCallback((text: string): Set<string> => {
    const mentions = new Set<string>()
    const lowerText = text.toLowerCase()
    const backtickRegex = /`([^`]+)`/g
    let m: RegExpExecArray | null
    while ((m = backtickRegex.exec(text)) !== null) {
      const name = m[1].toLowerCase()
      for (const node of data.graphNodes) {
        if (node.label.toLowerCase() === name || node.label.toLowerCase().includes(name) || node.id.toLowerCase().includes(name)) mentions.add(node.id)
      }
    }
    if (mentions.size === 0) {
      for (const node of data.graphNodes) {
        const label = node.label.toLowerCase()
        if (label.length > 4 && lowerText.includes(label)) mentions.add(node.id)
      }
    }
    return mentions
  }, [data.graphNodes])

  const onFeatureClick = useCallback((name: string) => {
    const nameLower = name.toLowerCase()
    const shortName = name.split(/[.:]/).pop()?.toLowerCase() ?? nameLower
    let match = data.graphNodes.find((n) => {
      const idL = n.id.toLowerCase()
      const lblL = n.label.toLowerCase()
      return idL === nameLower || lblL === nameLower ||
        idL.includes(nameLower) || lblL.includes(nameLower) ||
        idL.includes(shortName) || lblL.includes(shortName) ||
        nameLower.includes(lblL)
    })

    // If no graph match, it might be a parameter — find its parent via has_parameter edge
    if (!match) {
      const paramEdge = data.allEdges.find(e =>
        e.edge_type === 'has_parameter' &&
        (e._to.toLowerCase().includes(shortName) || e._to.toLowerCase().includes(nameLower))
      )
      if (paramEdge) {
        match = data.graphNodes.find(n => n.id === paramEdge._from)
      }
    }

    if (match) {
      // Gemini rule: data panel navigation adds node + 6 neighbors
      if (sceneNodeIds.has(match.id)) {
        // Already in scene — just select and pan
        setSelectedNode(match)
      } else {
        addNodeWithNeighbors(match.id, 1, 6)
        setSelectedNode(match)
      }
      setBreadcrumbs(prev => {
        const filtered = prev.filter(b => b.id !== match!.id)
        return [...filtered, match!].slice(-8)
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svgEl = graphSvgRef.current as any
      if (svgEl?.__panToNode) svgEl.__panToNode(match.id)
    }
  }, [data.graphNodes, data.allEdges, addNodeWithNeighbors, sceneNodeIds])
  // ── Concept search: if search has text but few/no graph matches, auto-ask the LLM ──
  useEffect(() => {
    const q = data.searchQuery.trim()
    if (q.length < 2 || q === lastConceptSearch.current) return
    const timer = setTimeout(() => {
      const hasMatches = data.matchedNodeIds.size > 0
      if (hasMatches) {
        // Search highlights matches visually (via matchedNodeIds prop) but does NOT add to scene
        // Single match: select it (adds just that node)
        if (data.matchedNodeIds.size === 1) {
          const matchId = [...data.matchedNodeIds][0]
          const node = data.graphNodes.find((n) => n.id === matchId)
          if (node && node.id !== selectedNode?.id) onNodeClick(node)
        }
        return
      }
      lastConceptSearch.current = q
      setChatMessages((prev) => [...prev, { role: 'user', content: `What features in this binary relate to "${q}"?` }])
      setChatLoading(true)

      // Query relevant features — client-side keyword search (no await needed)
      const conceptMatches = data.graphNodes.filter(n =>
        n.label.toLowerCase().includes(q.toLowerCase()) ||
        n.id.toLowerCase().includes(q.toLowerCase()) ||
        (n.description ?? '').toLowerCase().includes(q.toLowerCase()) ||
        (n.fields ?? []).some(f => f.toLowerCase().includes(q.toLowerCase()))
      )
      const conceptCtx = conceptMatches.length > 0
        ? conceptMatches.slice(0, 15).map(n => `[${n.nodeType}] ${n.label} (${n.cluster})${n.fields?.length ? ' fields:' + n.fields.slice(0, 5).join(',') : ''}`).join('\n')
        : 'No direct matches found.'

      fetch(`${API}/api/scillm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'text',
          messages: [{
            role: 'system',
            content: `You are analyzing the "${binaryName}" binary. Map the user's concept to extracted feature names.\n\nRelevant features from ArangoDB graph query:\n${conceptCtx || 'No direct matches found.'}\n\nIdentify which extracted features relate to the user's concept. Use markdown with \`code\` for feature names.`,
          }, {
            role: 'user',
            content: `What features relate to "${q}"? Which RPCs, events, or schemas implement this concept?`,
          }],
          temperature: 0.3,
          max_tokens: 400,
        }),
      })
        .then((r) => r.json())
        .then((d) => {
          const content = d.choices?.[0]?.message?.content || 'No matches found'
          setChatMessages((prev) => [...prev, { role: 'assistant', content }])
        })
        .catch(() => setChatMessages((prev) => [...prev, { role: 'assistant', content: 'Failed to search' }]))
        .finally(() => setChatLoading(false))
    }, 800)
    return () => clearTimeout(timer)
  }, [data.searchQuery, data.matchedNodeIds, data.graphNodes, binaryName, selectedNode])

  // ── When a node is selected, auto-generate LLM explanation (debounced + abortable) ──
  useEffect(() => {
    if (!selectedNode || selectedNode.id === lastExplainedId.current) return
    if (skipNextExplanationRef.current) {
      skipNextExplanationRef.current = false
      lastExplainedId.current = selectedNode.id
      return
    }

    // Abort any in-flight explanation request
    if (explanationAbortRef.current) explanationAbortRef.current.abort()
    if (explainTimerRef.current) clearTimeout(explainTimerRef.current)

    setNodeExplanation(null)
    setNodeExplanationLoading(true)

    // 200ms debounce: if user clicks rapidly, only the last node fires
    const node = selectedNode
    explainTimerRef.current = setTimeout(() => {
      lastExplainedId.current = node.id
      const controller = new AbortController()
      explanationAbortRef.current = controller

      const nodeEdges = data.allEdges.filter((e) => e._from === node.id || e._to === node.id)
      const edgeSummary = nodeEdges.slice(0, 20).map((e) => {
        const other = e._from === node.id ? e._to : e._from
        return `${e.edge_type} → ${other.split('/').pop()}`
      }).join('; ')

      fetch(`${API}/api/scillm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'text',
          messages: [{
            role: 'system',
            content: `You are a binary reverse-engineering analyst for the "${binaryName}" binary. Return structured markdown:\n\n## Purpose\nOne sentence.\n\n## How It Works\n2-3 bullet points.\n\n## Connections\nWhat it connects to and why.\n\n## Architecture Note\nOne sentence on where this fits.\n\nBe concise. Use \`code\` for identifiers.`,
          }, {
            role: 'user',
            content: [
              `Feature: ${node.label}`,
              `Type: ${node.nodeType} | Cluster: ${node.cluster} | Tier: ${node.tier}`,
              node.description ? `Desc: ${node.description}` : '',
              node.fields?.length ? `Fields: ${node.fields.slice(0, 15).join(', ')}` : '',
              node.states?.length ? `States: ${node.states.join(', ')}` : '',
              edgeSummary ? `Edges: ${edgeSummary}` : '',
            ].filter(Boolean).join('\n'),
          }],
          temperature: 0.3,
          max_tokens: 400,
        }),
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((d) => {
          if (controller.signal.aborted) return
          const content = d.choices?.[0]?.message?.content || 'No explanation available'
          setNodeExplanation(content)
          const mentioned = extractMentionedNodes(content)
          if (mentioned.size > 0) {
            setLlmMentionedIds(mentioned)
            // NOT adding to scene — LLM text informs, user clicks to explore
          }
          // Learn-back: cache to ArangoDB
          if (content && content !== 'No explanation available') {
            fetch(`${API}/api/memory/upsert`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                collection: 'binary_features',
                documents: [{ _key: node.id.split('/').pop(), description: content }],
              }),
            }).catch(() => {})
          }
        })
        .catch((err) => {
          if (err instanceof DOMException && err.name === 'AbortError') return
          setNodeExplanation('Failed to generate explanation.')
        })
        .finally(() => {
          if (!controller.signal.aborted) setNodeExplanationLoading(false)
        })
    }, 200)

    return () => {
      if (explainTimerRef.current) clearTimeout(explainTimerRef.current)
    }
  }, [selectedNode, binaryName, data.allEdges, extractMentionedNodes])

  // ── Check ArangoDB for cached explanation before calling LLM ──
  // If the node already has a rich description (from a previous LLM call), use it
  useEffect(() => {
    if (!selectedNode) return
    // If the description is already rich (>100 chars), it was previously cached by learn-back
    const fullDoc = data.allNodes.find(n => n._id === selectedNode.id)
    if (fullDoc?.description && fullDoc.description.length > 100) {
      setNodeExplanation(fullDoc.description)
      setNodeExplanationLoading(false)
      // Skip the LLM call by marking this node as already explained
      lastExplainedId.current = selectedNode.id
    }
  }, [selectedNode, data.allNodes])

  // ── Search binary_features via /list for grounded answers ──
  async function searchBinaryFeatures(query: string): Promise<string> {
    // The graph nodes are already loaded — search them client-side
    const q = query.toLowerCase()
    const matches = data.graphNodes.filter((n) =>
      n.label.toLowerCase().includes(q) ||
      n.id.toLowerCase().includes(q) ||
      (n.description ?? '').toLowerCase().includes(q) ||
      (n.fields ?? []).some((f) => f.toLowerCase().includes(q)) ||
      (n.states ?? []).some((s) => s.toLowerCase().includes(q))
    )
    if (matches.length === 0) return ''
    return matches.slice(0, 10).map((n) => {
      const edges = data.allEdges.filter((e) => e._from === n.id || e._to === n.id)
      const conns = edges.slice(0, 5).map((e) =>
        `${e.edge_type}: ${(e._from === n.id ? e._to : e._from).split('/').pop()}`
      ).join(', ')
      return `[${n.nodeType}] ${n.label} (${n.cluster})${n.fields?.length ? ' fields:' + n.fields.slice(0, 5).join(',') + ')' : ''}${conns ? ' edges:' + conns : ''}`
    }).join('\n')
  }

  // ── Unified send: routes to graph filter, node select, or LLM chat ──
  async function sendChat(overrideText?: string) {
    const text = (overrideText || chatInput).trim()
    if (!text || chatLoading) return
    if (!overrideText) setChatInput('')

    // Conversation steering: if previous assistant message was thumbed-down,
    // this message is a correction — store the pair for intent retraining
    const lastAssistant = [...chatMessages].reverse().find(m => m.role === 'assistant')
    if (lastAssistant?.feedback === 'down') {
      const lastUser = [...chatMessages].reverse().find(m => m.role === 'user')
      if (lastUser) {
        fetch(`${API}/api/memory/learn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            problem: lastUser.content,
            solution: JSON.stringify({
              bad_response: lastAssistant.content.substring(0, 300),
              bad_queryspec: lastAssistant._querySpec || null,
              correction: text,
              _feedback: 'correction',
            }),
            tags: ['binary-explorer-feedback', 'correction', 'intent-training-v2', binaryName],
            scope: 'binary-explorer',
          }),
        }).catch(() => {})
      }
    }

    // Route 1: Exact node match → select it in the graph (no LLM call)
    const exactMatch = data.graphNodes.find(n =>
      n.label.toLowerCase() === text.toLowerCase() ||
      n.id.toLowerCase().endsWith(':' + text.toLowerCase())
    )
    if (exactMatch) {
      setChatInput('')
      onNodeClick(exactMatch)
      data.setSearchQuery(text)
      return
    }

    // Route 2: Single exact-ish match → select it (no auto-scene-add for partials)
    const partialMatches = data.graphNodes.filter(n =>
      n.label.toLowerCase().includes(text.toLowerCase())
    )
    if (partialMatches.length === 1 && text.length >= 3 && !text.includes(' ')) {
      setChatInput('')
      onNodeClick(partialMatches[0])
      data.setSearchQuery(text)
      return
    }

    // Route 3: Natural language → entity extraction + intent routing + LLM chat
    setChatInput('')
    setChatMessages((prev) => [...prev, { role: 'user', content: text }])
    setChatLoading(true)
    try {
      // ── ENTITY EXTRACTION via /extract-entities API (FlashText longest-match, server-side) ──
      const textLower = text.toLowerCase()
      const mentionedEntities: { id: string; label: string; nodeType: string }[] = []
      try {
        const res = await fetch('/api/extract-entities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, collection: 'binary_features' })
        })
        if (!res.ok) throw new Error(`extract-entities API returned ${res.status}`)
        const { entities } = await res.json()
        mentionedEntities.push(...(entities ?? []).map((e: { id: string; name: string; label: string; type: string }) => ({
          id: e.id,
          label: e.label || e.name,  // label is the short display name, name includes namespace
          nodeType: e.type
        })))
      } catch (err) {
        console.warn('[extract-entities] API failed, falling back to exact match:', err)
        // Fallback: simple exact match against graph nodes (no sorting/substring loop)
        for (const node of data.graphNodes) {
          const nameLower = node.label.toLowerCase()
          if (nameLower.length > 3 && textLower.includes(nameLower)) {
            mentionedEntities.push({ id: node.id, label: node.label, nodeType: node.nodeType })
          }
        }
      }

      // Entity context used for LLM prompt enrichment — NOT added to scene
      // Scene changes only from explicit user actions (click, expand, seed)

      // Build entity context string for the intent query and LLM prompt
      const entityCtx = mentionedEntities.length > 0
        ? mentionedEntities.map(e => `[${e.nodeType}] ${e.label}`).join(', ')
        : ''

      let intentFound = false
      let intentData: { action: string, ui_action?: string, target_node_id?: string, expand_hops?: number, perspective?: string } | null = null

      // A. Memory Recall Interceptor (Semantic Similarity to common interactions)
      // Enriched with extracted entity names for better matching
      try {
        const recallRes = await fetch(`${API}/api/memory/recall`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: entityCtx ? `${text} ${entityCtx}` : text, k: 3, labels: ['intent-training-v2'] })
        })
        if (recallRes.ok) {
          const recallData = await recallRes.json()
          if (recallData.found && recallData.items?.length > 0) {
            const bestMatch = recallData.items[0]
            // If similarity is very high (>0.85), trust the solution directly
            if (bestMatch.similarity > 0.85) {
              try {
                intentData = typeof bestMatch.solution === 'string' ? JSON.parse(bestMatch.solution) : bestMatch.solution
                intentFound = true
                console.log('[DEBUG RECALL MATCH]', { query: text, match: bestMatch.problem, intent: intentData })
              } catch (e) {
                console.error('Failed to parse recall solution:', e)
              }
            }
          }
        }
      } catch (err) {
        console.warn('Memory recall interceptor failed:', err)
      }

      // B. Dynamic Intent API Fallback (LLM Reasoning)
      if (!intentFound) {
        try {
          const intentRes = await fetch(`${API}/api/memory/intent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: text, scope: 'sparta', fast: false }),
          })
          if (intentRes.ok) {
            intentData = await intentRes.json()
            console.log('[DEBUG INTENT API]', intentData)
            if (intentData && (intentData.action === 'UI_COMMAND' || intentData.action === 'SELECT_NODE')) {
              intentFound = true
            }
          }
        } catch {
          console.warn('Intent API unreachable, using local heuristic fallback')
        }
      }

      // C. Local Heuristic Intercept (Instant fallback for obvious UI commands)
      if (!intentFound) {
        const cleanText = text.toLowerCase().replace(/[?.,!]/g, '')
        const words = cleanText.split(/\s+/)
        const lowText = cleanText

        // "show all" only triggers VIEW_ALL if NO entity is mentioned
        // "show all connected nodes to X" should route to SELECT_NODE + expand, not VIEW_ALL
        const isShowAll = (lowText.includes('show all') || (lowText.includes('view') && lowText.includes('all')) || lowText.includes('show everything'))
          && mentionedEntities.length === 0
        if ((lowText.includes('zoom') && lowText.includes('out')) || lowText.includes('reset view') || isShowAll) {
          intentData = { action: 'UI_COMMAND', ui_action: 'VIEW_ALL' }
          intentFound = true
        } else if (lowText.includes('zoom in') || lowText.includes('hop') || lowText.includes('focus') || lowText.includes('magnify')) {
          intentData = { action: 'UI_COMMAND', ui_action: 'SELECT_NODE', target_node_id: words[words.length-1] }
          intentFound = true
        } else if ((lowText.includes('show') || lowText.includes('expand') || lowText.includes('connected') || lowText.includes('related') || lowText.includes('neighbors')) && mentionedEntities.length > 0) {
          // "show connected nodes to X", "expand X", "what's related to X"
          intentData = { action: 'UI_COMMAND', ui_action: 'SELECT_NODE', target_node_id: mentionedEntities[0].label, expand_hops: 1 }
          intentFound = true
        }
      }

      if (intentFound && intentData) {
        // CRITICAL: Entity extraction is ground truth. Recall matches by phrase similarity
        // and often returns the wrong action (e.g. VIEW_ALL for "click on X and show related").
        // If user mentioned a specific entity, override both target AND action.
        if (mentionedEntities.length > 0) {
          intentData.target_node_id = mentionedEntities[0].label

          // If user said "click on X" or "show related to X" but recall returned VIEW_ALL/ZOOM_OUT,
          // override to SELECT_NODE — the user clearly wants a specific node, not a reset.
          const hasNodeIntent = textLower.includes('click') || textLower.includes('select') ||
            textLower.includes('show') || textLower.includes('related') || textLower.includes('connected') ||
            textLower.includes('expand') || textLower.includes('neighbors')
          if (hasNodeIntent && (intentData.ui_action === 'VIEW_ALL' || intentData.ui_action === 'ZOOM_OUT')) {
            intentData.ui_action = 'SELECT_NODE'
            intentData.expand_hops = (textLower.includes('related') || textLower.includes('connected') || textLower.includes('neighbors') || textLower.includes('expand')) ? 1 : 0
          }
        }
        const { ui_action, target_node_id, expand_hops = 1, perspective: intentP } = intentData
        let executedMsg = ''

        if (ui_action === 'SELECT_NODE' || (target_node_id && !ui_action)) {
          // Use entity ID from /extract-entities (ground truth), fall back to label match
          const entityId = mentionedEntities.length > 0 ? mentionedEntities[0].id : null
          const targetLabel = String(target_node_id).toLowerCase()
          const node =
            (entityId && data.graphNodes.find(n => n.id === entityId)) ||
            data.graphNodes.find(n => n.label.toLowerCase() === targetLabel) ||
            data.graphNodes.find(n => n.label.toLowerCase().includes(targetLabel)) ||
            null

          if (node) {
            // Materialize node + neighbors into scene
            addNodeWithNeighbors(node.id, expand_hops)
            setSelectedNode(node)
            executedMsg = `Focused on ${node.label}`

            if (expand_hops > 1) {
              executedMsg += ` and expanded ${expand_hops} hops.`
            } else if (expand_hops > 0) {
              executedMsg += ` and expanded neighbors.`
            }

            // Physically zoom the camera if requested
            const requestedZoom = parseFloat(intentP || '1.0')
            if (requestedZoom > 1.0) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const svgEl = graphSvgRef.current as any
              if (svgEl?.__panToNode) {
                svgEl.__panToNode(node.id, requestedZoom)
                executedMsg = `Zoomed in on ${node.label}`
              }
            }
          } else {
            executedMsg = `Could not find node matching "${target_node_id}"`
          }
        } else if (ui_action === 'VIEW_ALL' || ui_action === 'ZOOM_OUT') {
          // Don't dump all nodes — just deselect and fit graph
          setSelectedNode(null)
          executedMsg = 'Deselected. Double-click graph to fit view.'
        } else if (ui_action === 'SET_PERSPECTIVE' && intentP) {
          const pStr = String(intentP).toLowerCase()
          if (Object.keys(PERSPECTIVE_TYPES).includes(pStr)) {
            setPerspective(pStr as Perspective)
            executedMsg = `Switched perspective to ${intentP}.`
          }
        } else if (ui_action === 'TOGGLE_PROGRESSIVE') {
          clearScene()
          executedMsg = 'Cleared scene.'
        }

        if (executedMsg) {
          skipNextExplanationRef.current = true
          // Compact QuerySpec: action + target only, full JSON in collapsible
          const qs = intentData
          const summary = `${qs?.ui_action || qs?.action || '?'} → ${qs?.target_node_id || 'none'} (${qs?.classifier_source || 'heuristic'})`
          const entityInfo = mentionedEntities.length > 0
            ? `\n\`Entities: ${mentionedEntities.map(e => e.label).join(', ')}\``
            : ''
          setChatMessages((prev) => [...prev, {
            role: 'assistant',
            content: `_✨ ${executedMsg}_\n\n\`QuerySpec: ${summary}\`${entityInfo}`,
            isExplanation: true,
            // Store full spec for collapsible display
            _querySpec: qs,
          } as ChatMessage & { _querySpec?: unknown }])
          recordStep('chat', `UI command: ${executedMsg}`)
          setChatLoading(false)
          return
        }
      }

      // 1. Local Search: binary features for grounded context
      const localSearchCtx = await searchBinaryFeatures(text)

      // 2. Memory Recall: ArangoDB QRA lessons via memory daemon proxy
      let memoryRecallCtx = ''
      try {
        const memRes = await fetch(`${API}/api/memory/recall`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: `${binaryName} binary-explorer ${text}`, k: 5, scope: 'binary-analysis' })
        })
        if (memRes.ok) {
          const memData = await memRes.json()
          if (memData.found && memData.items?.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            memoryRecallCtx = memData.items.map((item: any) => 
               `[ArangoDB Memory] Q: ${item.question || item.problem || 'Knowledge'}\nA: ${item.answer || item.solution || item.content || 'N/A'}`
            ).join('\n\n')
          }
        }
      } catch (err) {
        console.warn('Memory daemon recall proxy failed:', err)
      }

      // Build targeted context via graph query — NOT dumping all features
      // CodexGraph pattern: query relevant subgraph based on the question

      // 1. Selected node context (always include if a node is selected)
      const nodeCtx = selectedNode ? [
        `Currently selected: "${selectedNode.label}" (${selectedNode.nodeType}, ${selectedNode.cluster}, tier ${selectedNode.tier})`,
        selectedNode.fields?.length ? `Fields: ${selectedNode.fields.join(', ')}` : '',
        selectedNode.states?.length ? `States: ${selectedNode.states.join(', ')}` : '',
      ].filter(Boolean).join('. ') : ''

      const edgeCtx = selectedNode ? data.allEdges
        .filter((e) => e._from === selectedNode.id || e._to === selectedNode.id)
        .slice(0, 20)
        .map((e) => `${e.edge_type}: ${(e._from === selectedNode.id ? e._to : e._from).split('/').pop()}`)
        .join('; ') : ''

      // 2. Query the loaded graph data for relevant subgraph (keyword + field match)
      // All 334 binary_features are already loaded — search them client-side
      // This is the CodexGraph pattern: query relevant subgraph, not dump everything
      const keywords = text.toLowerCase().split(/\s+/).filter(w => w.length > 2)
      const relevantNodes = data.allNodes.filter(n => {
        const searchable = [n.name, n.label, n.description ?? '', n.namespace, n.cluster,
          ...(n.fields ?? []), ...(n.states ?? [])].join(' ').toLowerCase()
        return keywords.some(kw => searchable.includes(kw))
      })
      // Also include 1-hop neighbors of matching nodes for connection context
      const matchIds = new Set(relevantNodes.map(n => n._id))
      const neighborIds = new Set<string>()
      data.allEdges.forEach(e => {
        if (matchIds.has(e._from)) neighborIds.add(e._to)
        if (matchIds.has(e._to)) neighborIds.add(e._from)
      })
      const neighbors = data.allNodes.filter(n => neighborIds.has(n._id) && !matchIds.has(n._id)).slice(0, 10)

      let graphQueryCtx = ''
      if (relevantNodes.length > 0) {
        graphQueryCtx = [
          ...relevantNodes.slice(0, 15).map(n => {
            const edges = data.allEdges.filter(e => e._from === n._id || e._to === n._id)
            const conns = edges.slice(0, 5).map(e => `${e.edge_type}→${(e._from === n._id ? e._to : e._from).split('/').pop()}`).join(', ')
            return `[${n.node_type}] ${n.label} (${n.cluster})${n.fields?.length ? ' fields:' + n.fields.slice(0, 8).join(',') : ''}${n.states?.length ? ' states:' + n.states.slice(0, 5).join(',') : ''}${conns ? ' edges:' + conns : ''}`
          }),
          neighbors.length > 0 ? `\nConnected neighbors: ${neighbors.map(n => `[${n.node_type}] ${n.label}`).join(', ')}` : '',
        ].filter(Boolean).join('\n')
      }

      // Fallback: compact summary of top features if no keyword matches
      if (!graphQueryCtx) {
        graphQueryCtx = localSearchCtx || data.graphNodes
          .filter(n => n.nodeType === 'rpc' || n.nodeType === 'state_machine' || n.nodeType === 'namespace')
          .slice(0, 25)
          .map(n => `[${n.nodeType}] ${n.label}`)
          .join(', ')
      }

      // Load prompt template from /prompt-lab
      const isBeginnerMode = analysisMode === 'beginner'
      const systemPrompt = isBeginnerMode
        ? `You are a helpful guide explaining the "${binaryName}" program to someone who has never done reverse engineering before. Answer in plain, everyday English. Avoid jargon — if you must use a technical term, explain it in one sentence. When someone asks "what does this program do?", give a simple one-paragraph summary of its purpose, not a list of internal components. Treat every question as if it comes from a curious person who just wants to understand what they're looking at.

## What we know about this program
${nodeCtx ? nodeCtx + (edgeCtx ? '\nConnections: ' + edgeCtx : '') : 'No specific part selected — give an overview.'}

## Program internals (for your reference — translate these into plain English for the user)
${graphQueryCtx}
${memoryRecallCtx ? '\n## Prior analysis\n' + memoryRecallCtx : ''}

## Instructions
- Answer in plain English — no bullet-point walls of jargon
- Lead with what the program or feature *does*, not what it *is*
- If a beginner asks a vague question ("what is this?", "what does it do?"), give a useful plain-language answer
- Keep answers short: 2-3 sentences for simple questions, a short paragraph for complex ones
- Only use \`code\` formatting for actual function or variable names`
        : `You are a reverse-engineering analyst for the "${binaryName}" binary extracted via /analyze-elf + /treesitter.

## Context
${nodeCtx ? nodeCtx + (edgeCtx ? '\nConnections: ' + edgeCtx : '') : 'No node selected.'}

## Relevant Subgraph
${graphQueryCtx}
${memoryRecallCtx ? '\n## ArangoDB Memory\n' + memoryRecallCtx : ''}

## Instructions
- Answer with structured markdown
- Use \`code\` backticks for all identifiers and feature names
- Reference features by their exact extracted names so the graph can highlight them
- Be concise: 2-4 bullet points per section max`

      const res = await fetch(`${API}/api/scillm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'text',
          messages: [
            {
              role: 'system',
              content: systemPrompt,
            },
            // Include conversation history for context
            ...chatMessages.filter((m) => !m.isExplanation).map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: text },
          ],
          temperature: 0.3,
          max_tokens: 600,
        }),
      })
      const reply = await res.json()
      const content = reply.choices?.[0]?.message?.content || reply.error || 'No response'

      // Build TrustGraph-style Explain Pipeline
      const explainSteps: ExplainStep[] = [
        { type: 'question', label: 'QUESTION', detail: text },
        {
          type: 'grounding', label: 'GROUNDING',
          detail: mentionedEntities.length > 0 ? `${mentionedEntities.length} entities extracted` : 'No entities matched',
          chips: mentionedEntities.map(e => ({ label: e.label, color: NODE_TYPE_COLORS[e.nodeType] ?? '#94a3b8' })),
        },
        {
          type: 'exploration', label: 'EXPLORATION',
          detail: `Subgraph: ${sceneNodeIds.size} nodes in scene · ${data.allEdges.filter(e => sceneNodeIds.has(e._from) || sceneNodeIds.has(e._to)).length} edges · ${graphQueryCtx?.split('\n').length || 0} context lines`,
        },
        {
          type: 'intent', label: 'INTENT',
          detail: intentFound
            ? `${intentData?.action || 'CHAT'} via ${intentData?.ui_action ? 'heuristic' : 'recall'}`
            : 'LLM reasoning (no intent match)',
        },
      ]

      setChatMessages((prev) => [...prev, { role: 'assistant', content, _explain: explainSteps }])
      recordStep('chat', `Asked: ${text.substring(0, 80)}${text.length > 80 ? '…' : ''}`)
      // Highlight mentioned features in graph
      const mentioned = extractMentionedNodes(content)
      if (mentioned.size > 0) setLlmMentionedIds(mentioned)

      // Learn-back: store Q&A to ArangoDB /learn for cross-session recall
      if (content && !content.startsWith('Error') && content !== 'No response') {
        fetch(`${API}/api/memory/learn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            problem: `[${binaryName}] ${text}`,
            solution: content,
            tags: ['binary-explorer', binaryName, selectedNode?.label ?? ''].filter(Boolean),
            scope: 'binary-analysis',
          }),
        }).catch(() => { /* non-critical — conversation still works without persistence */ })
      }
    } catch (err) {
      setChatMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err instanceof Error ? err.message : String(err)}` }])
    } finally {
      setChatLoading(false)
    }
  }

  // --- Perspective / Layout wrappers that also record journal steps ---
  const handleSetPerspective = useCallback((p: Perspective) => {
    setPerspective(p)
    recordStep('perspective_change', `Perspective: ${PERSPECTIVE_LABELS[p]}`)
  }, [recordStep])

  const handleSetLayoutMode = useCallback((mode: 'organic' | 'stratified' | 'clustered') => {
    setLayoutMode(mode)
    recordStep('layout_change', `Layout: ${mode}`)
  }, [recordStep])

  // --- Journal action handlers ---
  const handleJournalReplay = useCallback((stepIndex: number) => {
    const step = journalSteps[stepIndex]
    if (!step?.snapshot) return
    const snap = step.snapshot as { sceneNodeIds: string[]; selectedNodeId: string | null; breadcrumbIds: string[] }
    setSceneNodeIds(new Set(snap.sceneNodeIds ?? []))
    const node = snap.selectedNodeId
      ? data.graphNodes.find(n => n.id === snap.selectedNodeId) ?? null
      : null
    setSelectedNode(node)
    const bcs = (snap.breadcrumbIds ?? [])
      .map((id: string) => data.graphNodes.find(n => n.id === id))
      .filter((n): n is BinaryGraphNode => n != null)
    setBreadcrumbs(bcs)
  }, [journalSteps, data.graphNodes])

  const handleJournalDelete = useCallback((stepIndex: number) => {
    setJournalSteps(prev => prev.filter((_, i) => i !== stepIndex))
  }, [])

  const handleJournalNote = useCallback((stepIndex: number, note: string) => {
    setJournalSteps(prev => prev.map((s, i) => i === stepIndex ? { ...s, note } : s))
  }, [])

  // ── Connection chips for selected node (with direction) ──
  const allSelectedEdges = selectedNode
    ? data.allEdges.filter((e) => e._from === selectedNode.id || e._to === selectedNode.id)
    : []
  // Legacy flat grouping (used in summary)
  const edgesByType: Record<string, string[]> = {}
  // Directional grouping (TrustGraph pattern)
  const outgoingEdges: { type: string; target: string; targetId: string; targetType?: string }[] = []
  const incomingEdges: { type: string; source: string; sourceId: string; sourceType?: string }[] = []
  for (const e of allSelectedEdges) {
    const isOutgoing = e._from === selectedNode?.id
    const otherId = isOutgoing ? e._to : e._from
    const otherLabel = otherId.split('/').pop() ?? ''
    const otherNode = data.graphNodes.find(n => n.id === otherId)
    const group = edgesByType[e.edge_type] ?? []
    group.push(otherLabel)
    edgesByType[e.edge_type] = group
    if (isOutgoing) {
      outgoingEdges.push({ type: e.edge_type, target: otherLabel, targetId: otherId, targetType: otherNode?.nodeType })
    } else {
      incomingEdges.push({ type: e.edge_type, source: otherLabel, sourceId: otherId, sourceType: otherNode?.nodeType })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden', minHeight: 0 }}>
      {data.loading ? (
        <div style={{ display: 'flex', flex: 1, height: '100%' }}>
          {/* Keep sidebar visible during load so user can switch binaries */}
          <BinaryLeftPane
            binaryName={binaryName}
            binaries={binaries}
            binaryMetas={binaryMetas}
            onSelectBinary={(name) => { setBinaryName(name); clearScene(); setChatMessages([]); setAutoSeeded(false) }}
            savedScenes={savedScenes}
            onLoadScene={loadScene}
            onIngest={() => {
              const path = prompt('Path to ELF binary:')
              if (path) { setIngestPath(path); setIsIngesting(true) }
            }}
          />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, background: '#050505' }}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fontWeight: 700, color: EMBRY.accent, letterSpacing: '0.1em' }}>
              LOADING: {binaryName.toUpperCase()}
            </div>
            {binaryMetas[binaryName] && (
              <div style={{ fontSize: 9, color: EMBRY.dim, fontFamily: 'JetBrains Mono, monospace', display: 'flex', gap: 10 }}>
                {[binaryMetas[binaryName].format, binaryMetas[binaryName].arch].filter(Boolean).join(' / ')}
                {binaryMetas[binaryName].sizeBytes > 0 && (
                  <span>{binaryMetas[binaryName].sizeBytes > 1048576 ? `${(binaryMetas[binaryName].sizeBytes / 1048576).toFixed(1)} MB` : `${(binaryMetas[binaryName].sizeBytes / 1024).toFixed(0)} KB`}</span>
                )}
                {binaryMetas[binaryName].stripped && <span style={{ color: EMBRY.red }}>STRIPPED</span>}
                {binaryMetas[binaryName].pie && <span style={{ color: EMBRY.green }}>PIE</span>}
              </div>
            )}
            <div style={{ fontSize: 9, color: EMBRY.muted }}>parsing features & call graph…</div>
          </div>
        </div>
      ) : data.error ? (
        <div style={{ display: 'flex', flex: 1, height: '100%' }}>
          <BinaryLeftPane
            binaryName={binaryName}
            binaries={binaries}
            binaryMetas={binaryMetas}
            onSelectBinary={(name) => { setBinaryName(name); clearScene(); setChatMessages([]); setAutoSeeded(false) }}
            savedScenes={savedScenes}
            onLoadScene={loadScene}
            onIngest={() => {
              const path = prompt('Path to ELF binary:')
              if (path) { setIngestPath(path); setIsIngesting(true) }
            }}
          />
          <BackendErrorPane error={data.error} onRetry={data.refresh} api={API} />
        </div>
      ) : (
        <div style={styles.panes}>
          {/* ═══ LEFT SIDEBAR: Binary selector + scenes + sessions ═══ */}
          <BinaryLeftPane
            binaryName={binaryName}
            binaries={binaries}
            binaryMetas={binaryMetas}
            onSelectBinary={(name) => { setBinaryName(name); clearScene(); setChatMessages([]); setAutoSeeded(false) }}
            onRenameBinary={(name) => {
              const newName = prompt(`Rename "${name}" to:`, name)
              if (newName && newName !== name) {
                fetch(`/api/binary-explorer/${name}/rename`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ newName }),
                }).then(() => window.location.reload())
              }
            }}
            onDeleteBinary={(name) => {
              if (confirm(`Delete binary "${name}" and all its features?`)) {
                fetch(`/api/binary-explorer/${name}`, { method: 'DELETE' })
                  .then(() => window.location.reload())
              }
            }}
            onDuplicateBinary={(name) => {
              fetch(`/api/binary-explorer/${name}/duplicate`, { method: 'POST' })
                .then(() => window.location.reload())
            }}
            savedScenes={savedScenes}
            onLoadScene={loadScene}
            onIngest={() => {
              const path = prompt('Path to ELF binary:')
              if (path) {
                setIngestPath(path)
                setIsIngesting(true)
              }
            }}
          />

          {/* Ingestion progress overlay */}
          {isIngesting && ingestPath && (
            <div style={{ position: 'absolute', top: 0, left: 260, right: 0, bottom: 0, zIndex: 20, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ width: 500, maxHeight: '80vh', overflow: 'auto' }}>
                <IngestionProgress
                  endpoint={`${API}/api/binary/ingest`}
                  binaryName={ingestPath}
                  onComplete={handleIngestComplete}
                />
              </div>
            </div>
          )}

          {/* ═══ GRAPH PANE ═══ */}
          <div style={{ ...styles.graphPane, flex: `0 0 ${leftPaneWidth}%` }}>
            <div style={styles.topbar}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Shield size={16} style={{ color: EMBRY.accent }} />
                <div style={{ fontSize: 13, fontWeight: 800, color: EMBRY.white, letterSpacing: '0.02em' }}>
                  {binaryName.toUpperCase()} / <span style={{ color: EMBRY.accent }}>EXPLORER</span>
                </div>
              </div>
              <div style={{ flex: 1 }} />

              {/* Undo / Redo — Gemini-designed 24px utility icons */}
              <div style={{ display: 'flex', gap: 2, marginRight: 8, alignItems: 'center' }}>
                <button
                  onClick={undo}
                  disabled={historyIndex <= 0}
                  title="Undo (Ctrl+Z)"
                  style={{
                    width: 24, height: 24, padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 4, border: '1px solid transparent', backgroundColor: 'transparent',
                    cursor: historyIndex > 0 ? 'pointer' : 'not-allowed',
                    color: historyIndex > 0 ? EMBRY.accent : EMBRY.muted,
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={e => { if (historyIndex > 0) { e.currentTarget.style.color = '#9f7aea'; e.currentTarget.style.backgroundColor = 'rgba(124,58,237,0.1)' } }}
                  onMouseLeave={e => { e.currentTarget.style.color = historyIndex > 0 ? EMBRY.accent : EMBRY.muted; e.currentTarget.style.backgroundColor = 'transparent' }}
                ><Undo size={14} /></button>
                <button
                  onClick={redo}
                  disabled={historyIndex >= sceneHistory.length - 1}
                  title="Redo (Ctrl+Shift+Z)"
                  style={{
                    width: 24, height: 24, padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 4, border: '1px solid transparent', backgroundColor: 'transparent',
                    cursor: historyIndex < sceneHistory.length - 1 ? 'pointer' : 'not-allowed',
                    color: historyIndex < sceneHistory.length - 1 ? EMBRY.accent : EMBRY.muted,
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={e => { if (historyIndex < sceneHistory.length - 1) { e.currentTarget.style.color = '#9f7aea'; e.currentTarget.style.backgroundColor = 'rgba(124,58,237,0.1)' } }}
                  onMouseLeave={e => { e.currentTarget.style.color = historyIndex < sceneHistory.length - 1 ? EMBRY.accent : EMBRY.muted; e.currentTarget.style.backgroundColor = 'transparent' }}
                ><Redo size={14} /></button>

                {/* Reset / Clear Scene — Tim's #1 ask */}
                {sceneNodeIds.size > 0 && (
                  <>
                    <div style={{ width: 1, height: 16, background: EMBRY.border, margin: '0 4px' }} />
                    <button
                      onClick={() => { clearScene(); setSelectedNode(null); setAutoSeeded(false) }}
                      title="Clear scene (keep binary loaded)"
                      style={{
                        width: 24, height: 24, padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        borderRadius: 4, border: 'none', backgroundColor: 'transparent',
                        cursor: 'pointer', color: '#6B7280', transition: 'all 0.2s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.color = EMBRY.white; e.currentTarget.style.backgroundColor = 'rgba(107,114,128,0.15)' }}
                      onMouseLeave={e => { e.currentTarget.style.color = '#6B7280'; e.currentTarget.style.backgroundColor = 'transparent' }}
                    ><Trash2 size={13} /></button>
                  </>
                )}
              </div>

              {/* View Mode Toggle: Graph / Tree (icon buttons) */}
              <div style={{ display: 'flex', gap: 1, marginRight: 10, alignItems: 'center', borderRight: `1px solid ${EMBRY.border}`, paddingRight: 10 }}>
                <button onClick={() => setViewMode('graph')} title="Graph view"
                  style={{
                    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 3, cursor: 'pointer', border: 'none',
                    backgroundColor: viewMode === 'graph' ? `${EMBRY.accent}20` : 'transparent',
                    color: viewMode === 'graph' ? EMBRY.accent : EMBRY.dim,
                  }}><GitGraph size={15} /></button>
                <button onClick={() => setViewMode('tree')} title="Tree view"
                  style={{
                    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 3, cursor: 'pointer', border: 'none',
                    backgroundColor: viewMode === 'tree' ? `${EMBRY.accent}20` : 'transparent',
                    color: viewMode === 'tree' ? EMBRY.accent : EMBRY.dim,
                  }}><List size={15} /></button>
                <button onClick={() => setViewMode('code')} title="Code / Source view"
                  style={{
                    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 3, cursor: 'pointer', border: 'none',
                    backgroundColor: viewMode === 'code' ? `${EMBRY.accent}20` : 'transparent',
                    color: viewMode === 'code' ? EMBRY.accent : EMBRY.dim,
                  }}><Code size={15} /></button>
                <button onClick={() => setViewMode('vulns')} title="Vulnerability / CWE mapping"
                  style={{
                    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 3, cursor: 'pointer', border: 'none',
                    backgroundColor: viewMode === 'vulns' ? `${EMBRY.accent}20` : 'transparent',
                    color: viewMode === 'vulns' ? EMBRY.accent : EMBRY.dim,
                  }}><Shield size={15} /></button>
                {/* Split view toggle (Godbolt-style: code left + graph right) */}
                <div style={{ width: 1, height: 16, background: EMBRY.border, margin: '0 4px' }} />
                <button onClick={() => setSplitCodeView(!splitCodeView)} title="Split view: code + graph side by side"
                  style={{
                    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 3, cursor: 'pointer', border: 'none',
                    backgroundColor: splitCodeView ? `${EMBRY.accent}20` : 'transparent',
                    color: splitCodeView ? EMBRY.accent : EMBRY.dim,
                    fontSize: 13, fontWeight: 900,
                  }}>⫿</button>

                {/* Capture/Export button */}
                <button onClick={() => {
                  const svgEl = graphSvgRef.current
                  if (!svgEl) return
                  // Serialize SVG to PNG via canvas
                  const svgData = new XMLSerializer().serializeToString(svgEl)
                  const canvas = document.createElement('canvas')
                  const rect = svgEl.getBoundingClientRect()
                  const scale = 2 // 2x resolution
                  canvas.width = rect.width * scale
                  canvas.height = rect.height * scale
                  const ctx = canvas.getContext('2d')!
                  ctx.scale(scale, scale)
                  const img = new Image()
                  img.onload = () => {
                    // Dark background
                    ctx.fillStyle = '#0a0a0a'
                    ctx.fillRect(0, 0, canvas.width, canvas.height)
                    ctx.drawImage(img, 0, 0, rect.width, rect.height)
                    // Add title watermark
                    ctx.fillStyle = '#ffffff44'
                    ctx.font = '10px JetBrains Mono, monospace'
                    ctx.fillText(`${binaryName.toUpperCase()} — ${sceneNodeIds.size} nodes · Binary Explorer`, 8, canvas.height / scale - 8)
                    // Download
                    const a = document.createElement('a')
                    a.download = `${binaryName}-graph-${new Date().toISOString().slice(0,10)}.png`
                    a.href = canvas.toDataURL('image/png')
                    a.click()
                  }
                  img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)))
                }} title="Export graph as PNG (2x)"
                  style={{
                    width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 3, cursor: 'pointer', border: 'none',
                    backgroundColor: 'transparent', color: EMBRY.dim,
                    fontSize: 12,
                  }}>📷</button>
              </div>

              {/* Layout removed — organic is the only useful layout for exploration */}

              {/* Perspective Selector */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 8, color: EMBRY.dim, fontWeight: 700 }}>VIEWPORT</span>
                <select
                  value={perspective}
                  onChange={e => handleSetPerspective(e.target.value as Perspective)}
                  style={{ background: '#0a0a0a', border: `1px solid ${EMBRY.border}`, color: EMBRY.white, fontSize: 10, padding: '2px 6px', outline: 'none', borderRadius: 2 }}
                >
                  {Object.entries(PERSPECTIVE_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>

              {/* Layout Mode */}
              <div style={{ display: 'flex', gap: 1, alignItems: 'center', borderLeft: `1px solid ${EMBRY.border}`, paddingLeft: 10, marginRight: 4 }}>
                {(['organic', 'stratified', 'clustered'] as const).map(mode => (
                  <button key={mode} onClick={() => setLayoutMode(mode)} title={`Layout: ${mode}`}
                    style={{
                      fontSize: 8, fontWeight: layoutMode === mode ? 800 : 400,
                      padding: '2px 6px', borderRadius: 2, cursor: 'pointer', border: 'none',
                      background: layoutMode === mode ? `${EMBRY.accent}20` : 'transparent',
                      color: layoutMode === mode ? EMBRY.accent : EMBRY.dim,
                    }}
                  >{mode === 'organic' ? 'Force' : mode === 'stratified' ? 'Hierarchy' : 'Cluster'}</button>
                ))}
              </div>

              {/* Scene Save/Load */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, borderLeft: `1px solid ${EMBRY.border}`, paddingLeft: 12 }}>
                {savedScenes.length > 0 && (
                  <select
                    value=""
                    onChange={e => {
                      const scene = savedScenes.find(s => s.name === e.target.value)
                      if (scene) loadScene(scene)
                    }}
                    style={{ background: '#0a0a0a', border: `1px solid ${EMBRY.border}`, color: EMBRY.dim, fontSize: 9, padding: '2px 4px', outline: 'none', borderRadius: 2, maxWidth: 100 }}
                  >
                    <option value="">Scenes</option>
                    {savedScenes.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                )}
                {sceneNodeIds.size > 0 && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <input
                      value={sceneName}
                      onChange={e => setSceneName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveScene(sceneName) }}
                      placeholder="Name..."
                      style={{ background: '#0a0a0a', border: `1px solid ${EMBRY.border}`, color: EMBRY.white, fontSize: 9, padding: '2px 4px', outline: 'none', borderRadius: 2, width: 60 }}
                    />
                    <button
                      onClick={() => saveScene(sceneName)}
                      style={{ fontSize: 8, padding: '2px 6px', background: `${EMBRY.accent}15`, border: `1px solid ${EMBRY.accent}33`, color: EMBRY.accent, borderRadius: 2, cursor: 'pointer' }}
                    >SAVE</button>
                    <button
                      onClick={() => exportScene(sceneName)}
                      title="Export scene to portable JSON (includes graph state, annotations, and chat history)"
                      style={{ fontSize: 8, padding: '2px 6px', background: '#22c55e15', border: '1px solid #22c55e33', color: '#22c55e', borderRadius: 2, cursor: 'pointer' }}
                    >EXPORT</button>
                  </div>
                )}
                <button
                  onClick={importScene}
                  title="Import scene from JSON file (restores graph, annotations, and chat history)"
                  style={{ fontSize: 8, padding: '2px 6px', background: '#f59e0b15', border: '1px solid #f59e0b33', color: '#f59e0b', borderRadius: 2, cursor: 'pointer' }}
                >IMPORT</button>
              </div>
              {/* Keyboard shortcuts reference */}
              <button
                onClick={() => setShowKeyboardHelp(h => !h)}
                title="Keyboard shortcuts (?)"
                aria-label="Show keyboard shortcuts"
                style={{ marginLeft: 8, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: showKeyboardHelp ? `${EMBRY.accent}20` : 'transparent', border: `1px solid ${showKeyboardHelp ? EMBRY.accent : EMBRY.border}`, color: showKeyboardHelp ? EMBRY.accent : EMBRY.dim, borderRadius: 3, cursor: 'pointer', fontSize: 11, fontWeight: 700, flexShrink: 0 }}
              >?</button>
            </div>

            {/* Entity type filter bar (TrustGraph pattern) */}
            <div style={{
              display: 'flex', gap: 4, padding: '3px 12px',
              fontSize: 8, fontFamily: 'JetBrains Mono, monospace',
              background: '#060606', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0,
              alignItems: 'center',
            }}>
              <span style={{ color: EMBRY.muted, marginRight: 4, fontWeight: 700 }}>FILTER:</span>
              <button onClick={() => setVisibleTypes(new Set(['rpc', 'event', 'schema', 'state_machine', 'cli_command', 'namespace', 'parameter']))}
                style={{ fontSize: 8, padding: '1px 6px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${visibleTypes.size === 7 ? EMBRY.accent + '66' : EMBRY.border}`, background: visibleTypes.size === 7 ? `${EMBRY.accent}15` : 'transparent', color: visibleTypes.size === 7 ? EMBRY.accent : EMBRY.dim }}>All</button>
              {Object.entries(NODE_TYPE_COLORS).map(([type, color]) => {
                const count = data.graphNodes.filter(n => n.nodeType === type && sceneNodeIds.has(n.id)).length
                const totalCount = data.graphNodes.filter(n => n.nodeType === type).length
                const active = visibleTypes.has(type)
                return (
                  <button key={type} onClick={() => {
                    const next = new Set(visibleTypes)
                    if (active) next.delete(type); else next.add(type)
                    setVisibleTypes(next)
                  }} style={{
                    display: 'flex', alignItems: 'center', gap: 3,
                    fontSize: 8, padding: '1px 6px', borderRadius: 8, cursor: 'pointer',
                    border: `1px solid ${active ? color + '66' : EMBRY.border}`,
                    background: active ? `${color}15` : 'transparent',
                    color: active ? color : EMBRY.muted,
                    opacity: active ? 1 : 0.5,
                  }}>
                    <span style={{ width: 5, height: 5, borderRadius: '50%', background: color }} />
                    {type.replace('_', ' ')} ({count}/{totalCount})
                  </button>
                )
              })}
              {/* Persistent graph search — instant, supports name/address/content/regex */}
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Search size={9} style={{ color: data.searchQuery ? EMBRY.accent : EMBRY.muted, flexShrink: 0 }} />
                <input
                  value={data.searchQuery}
                  onChange={e => data.setSearchQuery(e.target.value)}
                  placeholder="name / 0xaddr / /regex/"
                  title="Instant search across name, address, content, fields, states. /regex/flags supported. Esc to clear."
                  style={{
                    width: 160, background: 'transparent',
                    border: `1px solid ${data.searchQuery ? EMBRY.accent + '55' : EMBRY.border}`,
                    borderRadius: 2, padding: '1px 5px', color: EMBRY.white, fontSize: 9,
                    fontFamily: 'JetBrains Mono, monospace', outline: 'none',
                  }}
                  onKeyDown={e => { if (e.key === 'Escape') data.setSearchQuery('') }}
                />
                {data.searchQuery && data.matchedNodeIds.size > 0 && (
                  <span style={{ fontSize: 8, color: EMBRY.accent, fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>
                    {data.matchedNodeRanked.length} match{data.matchedNodeRanked.length !== 1 ? 'es' : ''}
                  </span>
                )}
                {data.searchQuery && data.matchedNodeIds.size === 0 && (
                  <span style={{ fontSize: 8, color: '#ef4444', fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap' }}>no match</span>
                )}
                {data.searchQuery && (
                  <button onClick={() => data.setSearchQuery('')} title="Clear search (Esc)"
                    style={{ fontSize: 9, color: EMBRY.muted, background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', lineHeight: 1 }}>✕</button>
                )}
                <span style={{ fontSize: 8, color: EMBRY.dim, marginLeft: 6, whiteSpace: 'nowrap' }}>
                  {sceneNodeIds.size} in scene · {viewMode}
                </span>
              </div>
            </div>

            {/* Security risk bar — shown only in security / attack_surface perspective */}
            {(perspective === 'security' || perspective === 'attack_surface') && (() => {
              const pTypes = PERSPECTIVE_TYPES[perspective]
              // All nodes matching this perspective's type filter — not just what's in scene
              const allSecNodes = data.graphNodes.filter(n => pTypes.length === 0 || pTypes.includes(n.nodeType))
              const sceneNodes = data.graphNodes.filter(n => sceneNodeIds.has(n.id))
              const withCwe = sceneNodes.filter(n => (taxonomyMap.get(n.id)?.cwe?.length ?? 0) > 0)
              const withAttack = sceneNodes.filter(n => (taxonomyMap.get(n.id)?.attack?.length ?? 0) > 0)
              // Severity tiers: CRITICAL(cwe≥2 AND attack≥2), HIGH(sum≥3), MED(sum≥1)
              const critical = sceneNodes.filter(n => {
                const tax = taxonomyMap.get(n.id)
                return (tax?.cwe?.length ?? 0) >= 2 && (tax?.attack?.length ?? 0) >= 2
              })
              const criticalIds = new Set(critical.map(n => n.id))
              const high = sceneNodes.filter(n => {
                if (criticalIds.has(n.id)) return false
                const tax = taxonomyMap.get(n.id)
                return (tax?.cwe?.length ?? 0) + (tax?.attack?.length ?? 0) >= 3
              })
              const highIds = new Set(high.map(n => n.id))
              const med = sceneNodes.filter(n => {
                if (criticalIds.has(n.id) || highIds.has(n.id)) return false
                const tax = taxonomyMap.get(n.id)
                return (tax?.cwe?.length ?? 0) + (tax?.attack?.length ?? 0) >= 1
              })
              // Quick-start: rank all security-type nodes by CWE+ATT&CK score, pick top 10
              const allSorted = [...allSecNodes].sort((a, b) => {
                const ta = taxonomyMap.get(a.id); const tb = taxonomyMap.get(b.id)
                const sa = (ta?.cwe?.length ?? 0) * 2 + (ta?.attack?.length ?? 0)
                const sb = (tb?.cwe?.length ?? 0) * 2 + (tb?.attack?.length ?? 0)
                return sb - sa
              })
              const top10 = allSorted.slice(0, 10)
              return (
                <div style={{
                  display: 'flex', gap: 6, padding: '3px 12px',
                  fontSize: 8, fontFamily: 'JetBrains Mono, monospace',
                  background: '#0a0505', borderBottom: `1px solid #f4433633`, flexShrink: 0,
                  alignItems: 'center', flexWrap: 'wrap',
                }}>
                  <Shield size={10} style={{ color: '#f44336', flexShrink: 0 }} />
                  <span style={{ color: '#f44336', fontWeight: 700, marginRight: 2 }}>RISK</span>
                  {/* Severity tier badges — click to load that tier into scene */}
                  {critical.length > 0 && (
                    <button
                      onClick={() => { critical.forEach(n => addToScene([n.id])); setSelectedNode(critical[0] ?? null) }}
                      title="CRITICAL: CWE≥2 AND ATT&CK≥2 — highest audit priority"
                      style={{ fontSize: 8, padding: '1px 6px', borderRadius: 8, cursor: 'pointer', border: `1px solid #f4433699`, background: '#f4433625', color: '#f44336', fontWeight: 800 }}
                    >CRIT: {critical.length}</button>
                  )}
                  {high.length > 0 && (
                    <button
                      onClick={() => { high.forEach(n => addToScene([n.id])); setSelectedNode(high[0] ?? null) }}
                      title="HIGH: 3+ security taxonomy tags — high audit priority"
                      style={{ fontSize: 8, padding: '1px 6px', borderRadius: 8, cursor: 'pointer', border: `1px solid #FF572266`, background: '#FF572215', color: '#FF5722', fontWeight: 700 }}
                    >HIGH: {high.length}</button>
                  )}
                  {med.length > 0 && (
                    <button
                      onClick={() => med.forEach(n => addToScene([n.id]))}
                      title="MED: 1–2 security taxonomy tags — secondary audit targets"
                      style={{ fontSize: 8, padding: '1px 6px', borderRadius: 8, cursor: 'pointer', border: `1px solid #FF980066`, background: '#FF980015', color: '#FF9800' }}
                    >MED: {med.length}</button>
                  )}
                  <span style={{ color: EMBRY.border, margin: '0 2px' }}>|</span>
                  <button
                    onClick={() => withCwe.forEach(n => addToScene([n.id]))}
                    title="Filter scene to nodes with CWE vulnerability classifications"
                    style={{ fontSize: 8, padding: '1px 6px', borderRadius: 8, cursor: withCwe.length > 0 ? 'pointer' : 'default', border: `1px solid #9C27B066`, background: '#9C27B015', color: '#CE93D8' }}
                  >CWE: {withCwe.length}</button>
                  <button
                    onClick={() => withAttack.forEach(n => addToScene([n.id]))}
                    title="Filter scene to nodes with MITRE ATT&CK technique mappings"
                    style={{ fontSize: 8, padding: '1px 6px', borderRadius: 8, cursor: withAttack.length > 0 ? 'pointer' : 'default', border: `1px solid #2196F366`, background: '#2196F315', color: '#90CAF9' }}
                  >ATT&amp;CK: {withAttack.length}</button>
                  <span style={{ color: EMBRY.border, margin: '0 2px' }}>|</span>
                  {/* Audit quick-start: load top-N nodes ranked by security score */}
                  <button
                    onClick={() => { top10.forEach(n => addToScene([n.id])); if (top10[0]) setSelectedNode(top10[0]) }}
                    title={`Load top ${top10.length} highest-risk nodes ranked by CWE+ATT&CK score — security audit quick-start`}
                    style={{ fontSize: 8, padding: '1px 8px', borderRadius: 8, cursor: top10.length > 0 ? 'pointer' : 'default', border: `1px solid #f4433644`, background: '#f4433610', color: '#f44336' }}
                  >LOAD TOP-{top10.length} →</button>
                  <button
                    onClick={() => setViewMode('vulns')}
                    title="Open full vulnerability map"
                    style={{ fontSize: 8, padding: '1px 6px', borderRadius: 8, cursor: 'pointer', border: `1px solid ${EMBRY.border}`, background: 'transparent', color: EMBRY.dim }}
                  >VULN MAP →</button>
                  {sceneNodeIds.size === 0 && allSecNodes.length > 0 && (
                    <span style={{ color: EMBRY.muted, fontSize: 8 }}>{allSecNodes.length} security-relevant nodes — click LOAD TOP-{top10.length} to start audit</span>
                  )}
                  {sceneNodeIds.size === 0 && allSecNodes.length === 0 && (
                    <span style={{ color: EMBRY.muted, fontSize: 8 }}>Load nodes into scene to see risk indicators</span>
                  )}
                  {sceneNodeIds.size > 0 && withCwe.length === 0 && withAttack.length === 0 && (
                    <span style={{ color: EMBRY.muted, fontSize: 8 }}>No taxonomy data yet — run /analyze-elf with --taxonomy to populate</span>
                  )}
                </div>
              )
            })()}

            <div
              style={{ flex: '1 1 0%', display: 'flex', flexDirection: splitCodeView && viewMode === 'graph' && selectedNode ? 'row' : 'column' as const, position: 'relative', overflow: 'hidden', minHeight: 0 }}
            >
              {/* Godbolt-style split: code left, graph right */}
              {splitCodeView && viewMode === 'graph' && selectedNode && (
                <div style={{ flex: '0 0 40%', borderRight: `1px solid ${EMBRY.border}`, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  <CodePane
                    code={selectedNode.source_pattern || pseudocode || `// No source data for ${selectedNode.label}\n// Select a node with source patterns\n// or switch to Python tab for LLM pseudocode`}
                    language={selectedNode.source_pattern ? 'c' : 'python'}
                    header={`${selectedNode.label} — ${selectedNode.source_pattern ? 'Source' : 'Pseudocode'}`}
                    onLineHover={(lineIdx) => {
                      if (lineIdx != null && selectedNode) {
                        // Emit link event so graph can highlight this node
                        linkBus.emit({ sourceNodeId: selectedNode.id, sourceLine: lineIdx, sender: 'code', reveal: false })
                      } else {
                        setLinkedNodeId(null)
                      }
                    }}
                    onLineClick={(lineIdx) => {
                      if (selectedNode) {
                        // Try to find a referenced feature name on this line
                        const code = selectedNode.source_pattern || pseudocode || ''
                        const line = code.split('\n')[lineIdx] || ''
                        // Check if any graph node label appears on this line
                        const match = data.graphNodes.find(n =>
                          n.id !== selectedNode.id && n.label.length > 3 && line.toLowerCase().includes(n.label.toLowerCase())
                        )
                        if (match) {
                          onNodeClick(match)
                          linkBus.emit({ sourceNodeId: match.id, sender: 'code', reveal: true, label: match.label })
                        }
                      }
                    }}
                  />
                </div>
              )}

              {/* Tree view */}
              {viewMode === 'tree' && (
                <SymbolTree
                  graphNodes={data.graphNodes}
                  allEdges={data.allEdges}
                  selectedNode={selectedNode}
                  onSelectNode={onNodeClick}
                  onExpandInGraph={(nodeId) => { setViewMode('graph'); addNodeWithNeighbors(nodeId, 1, 6) }}
                />
              )}

              {/* Graph view */}
              {viewMode === 'graph' && (() => {
                const pTypes = PERSPECTIVE_TYPES[perspective]
                const sceneNodes = data.graphNodes.filter(n => sceneNodeIds.has(n.id))
                const pNodes = sceneNodes
                  .filter(n => visibleTypes.has(n.nodeType))
                  .filter(n => pTypes.length === 0 || pTypes.includes(n.nodeType))
                const visibleNodeIds = new Set(pNodes.map(n => n.id))
                const visibleEdges = data.allEdges.filter(e => visibleNodeIds.has(e._from) && visibleNodeIds.has(e._to)).map(e => ({
                  ...e, source: e._from, target: e._to, edgeType: e.edge_type
                }))

                return (
                  <BinaryGraph
                    nodes={pNodes}
                    edges={visibleEdges}
                    selectedNodeId={selectedNode?.id || null}
                    visitedNodeIds={visitedNodeIds}
                    perspective={perspective}
                    layoutMode={layoutMode}
                    matchedNodeIds={llmMentionedIds}
                    onNodeClick={onNodeClick}
                    onContextMenu={(n, x, y) => setContextMenu({ x, y, node: n })}
                    graphSvgRef={graphSvgRef}
                    taxonomyMap={taxonomyMap}
                  />
                )
              })()}

              {/* Code View — full-pane source/decompilation browser */}
              {viewMode === 'code' && (
                <div style={{ flex: 1, overflow: 'auto', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, background: '#050505' }}>
                  {/* Source file list — all nodes with source_pattern */}
                  {!selectedNode ? (
                    <div style={{ padding: 12 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: EMBRY.white, marginBottom: 8 }}>SOURCE PATTERNS ({data.graphNodes.filter(n => n.source_pattern).length} available)</div>
                      {data.graphNodes.filter(n => n.source_pattern).map(n => (
                        <div key={n.id} onClick={() => onNodeClick(n)}
                          style={{ padding: '6px 10px', borderBottom: `1px solid ${EMBRY.border}`, cursor: 'pointer', display: 'flex', gap: 8, alignItems: 'center' }}
                          onMouseEnter={e => (e.currentTarget.style.background = '#0a0a0a')}
                          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                        >
                          <span style={{ width: 6, height: 6, borderRadius: '50%', background: NODE_TYPE_COLORS[n.nodeType] ?? EMBRY.dim, flexShrink: 0 }} />
                          <span style={{ color: EMBRY.white, fontWeight: 600 }}>{n.label}</span>
                          <span style={{ color: EMBRY.muted, fontSize: 8 }}>{n.nodeType}</span>
                          <span style={{ marginLeft: 'auto', color: EMBRY.dim, fontSize: 8 }}>{n.source_pattern!.split('\n').length} lines</span>
                        </div>
                      ))}
                      {data.graphNodes.filter(n => n.source_pattern).length === 0 && (
                        <div style={{ color: EMBRY.muted, padding: 20, textAlign: 'center' }}>
                          No source patterns extracted. Run /analyze-elf with --extract-source to populate.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                      {/* Header */}
                      <div style={{ padding: '6px 12px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, background: '#060606' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: NODE_TYPE_COLORS[selectedNode.nodeType] ?? EMBRY.dim }} />
                        <span style={{ fontWeight: 800, color: EMBRY.white }}>{selectedNode.label}</span>
                        <span style={{ color: EMBRY.muted, fontSize: 8 }}>{selectedNode.nodeType} · {selectedNode.cluster} · {selectedNode.tier}</span>
                        <span style={{ flex: 1 }} />
                        {/* LLM badge — shown when pseudocode tab is active */}
                        {codeViewTab === 'pseudocode' && pseudocodeModel && (
                          <span data-testid="llm-model-badge" style={{ fontSize: 7, padding: '1px 5px', borderRadius: 2, background: '#FF980015', border: '1px dashed #FF980044', color: '#FF9800', fontWeight: 700, letterSpacing: '0.5px' }}>
                            LLM · {pseudocodeModel}
                          </span>
                        )}
                        {codeViewTab === 'pseudocode' && pseudocode && !pseudocodeLoading && (
                          <button
                            data-testid="pseudocode-regen"
                            onClick={() => { setPseudocodeGenCount(c => c + 1) }}
                            title="Regenerate pseudocode"
                            style={{ fontSize: 8, padding: '1px 6px', background: 'transparent', border: `1px solid ${EMBRY.border}`, color: EMBRY.dim, borderRadius: 2, cursor: 'pointer', fontWeight: 700 }}
                          >↺ REGEN</button>
                        )}
                        {/* Code sub-tabs */}
                        {(['asm', 'c', 'python'] as const).map(t => (
                          <button key={t} onClick={() => setCodeViewTab(t === 'asm' ? 'assembly' : t === 'c' ? 'decompiled' : 'pseudocode')}
                            style={{
                              fontSize: 9, padding: '2px 8px', borderRadius: 2, cursor: 'pointer', border: 'none',
                              background: (t === 'asm' && codeViewTab === 'assembly') || (t === 'c' && codeViewTab === 'decompiled') || (t === 'python' && codeViewTab === 'pseudocode') ? `${EMBRY.accent}20` : 'transparent',
                              color: (t === 'asm' && codeViewTab === 'assembly') || (t === 'c' && codeViewTab === 'decompiled') || (t === 'python' && codeViewTab === 'pseudocode') ? EMBRY.accent : EMBRY.dim,
                              fontWeight: 700, textTransform: 'uppercase',
                            }}>{t === 'asm' ? 'ASM' : t === 'c' ? 'C (decompiled)' : 'Python'}</button>
                        ))}
                      </div>
                      {/* Godbolt-style code pane with syntax highlighting */}
                      <div style={{ flex: 1, overflow: 'hidden' }}>
                        <CodePane
                          code={codeViewTab === 'pseudocode'
                            ? (pseudocode || '# Select a node to generate Python pseudocode')
                            : (selectedNode.source_pattern || '// No source data available\n// Run /analyze-elf to extract source patterns')}
                          language={codeViewTab === 'assembly' ? 'asm' : codeViewTab === 'decompiled' ? 'c' : 'python'}
                          header={`${selectedNode.label} — ${codeViewTab === 'assembly' ? 'Assembly' : codeViewTab === 'decompiled' ? 'Decompiled C' : 'Python Pseudocode'}`}
                          showCopyButton
                          testId="code-view-pane"
                          onLineClick={(_i) => {
                            // Future: cross-link to graph nodes at this line
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Vulnerability / CWE Mapping View — full-pane table */}
              {viewMode === 'vulns' && (
                <div style={{ flex: 1, overflow: 'auto', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' }}>
                  <div style={{ padding: '8px 12px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', gap: 8, background: '#060606', flexShrink: 0 }}>
                    <Shield size={14} style={{ color: EMBRY.red }} />
                    <span style={{ fontWeight: 800, color: EMBRY.white }}>VULNERABILITY MAP</span>
                    <span style={{ color: EMBRY.muted, fontSize: 8 }}>{taxonomyMap.size} nodes with taxonomy data</span>
                    <button
                      onClick={() => {
                        setTaxonomyMap(new Map())
                        setTaxonomyLoading(true)
                        const nodes = data.graphNodes.filter(n => n.nodeType !== 'namespace').slice(0, 200)
                        Promise.all(nodes.map(n =>
                          fetch(`${API}/api/memory/taxonomy/extract`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ text: `${n.label} ${n.description || ''} ${n.nodeType}` }),
                          }).then(r => r.json()).then(d => ({ id: n.id, tags: d })).catch(() => ({ id: n.id, tags: {} }))
                        )).then(results => {
                          const next = new Map<string, { mind: string[]; cwe: string[]; attack: string[]; d3fend: string[]; nist: string[] }>()
                          for (const { id, tags } of results) next.set(id, { mind: tags.mind||[], cwe: tags.cwe||[], attack: tags.attack||[], d3fend: tags.d3fend||[], nist: tags.nist||[] })
                          setTaxonomyMap(next)
                          setTaxonomyLoading(false)
                        })
                      }}
                      title="Re-run auto-tagging for all nodes"
                      style={{ fontSize: 7, padding: '1px 6px', background: 'transparent', border: `1px solid #9C27B044`, color: '#9C27B0', borderRadius: 2, cursor: 'pointer', fontWeight: 700 }}
                    >RE-TAG</button>
                    <span style={{ flex: 1 }} />
                    <input value={tableSearch} onChange={e => setTableSearch(e.target.value)}
                      placeholder="Filter by CWE, ATT&CK, feature..."
                      style={{ background: '#0a0a0a', border: `1px solid ${EMBRY.border}`, color: EMBRY.white, fontSize: 9, padding: '3px 8px', outline: 'none', borderRadius: 2, width: 200 }}
                    />
                    <button onClick={() => {
                      // Export CSV
                      const rows = data.graphNodes.filter(n => taxonomyMap.has(n.id)).map(n => {
                        const tax = taxonomyMap.get(n.id)!
                        return `"${n.label}","${n.nodeType}","${Math.round(n.confidence * 100)}%","${(tax.cwe || []).join(';')}","${(tax.attack || []).join(';')}","${(tax.d3fend || []).join(';')}","${(tax.mind || []).join(';')}"`
                      })
                      const csv = `"Feature","Type","Confidence","CWE","ATT&CK","D3FEND","MIND"\n${rows.join('\n')}`
                      const blob = new Blob([csv], { type: 'text/csv' })
                      const url = URL.createObjectURL(blob)
                      const a = document.createElement('a'); a.href = url; a.download = `${binaryName}-vulnmap.csv`; a.click()
                      URL.revokeObjectURL(url)
                    }} style={{
                      fontSize: 8, padding: '3px 8px', background: 'transparent', border: `1px solid ${EMBRY.border}`,
                      color: EMBRY.dim, borderRadius: 2, cursor: 'pointer', fontWeight: 700,
                    }}>EXPORT CSV</button>
                  </div>
                  <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                    <thead>
                      <tr style={{ borderBottom: `2px solid ${EMBRY.border}` }}>
                        <th style={{ width: 180, padding: '6px 8px', textAlign: 'left', color: EMBRY.dim, fontSize: 8, fontWeight: 700 }}>FEATURE</th>
                        <th style={{ width: 70, padding: '6px 8px', textAlign: 'left', color: EMBRY.dim, fontSize: 8, fontWeight: 700 }}>TYPE</th>
                        <th style={{ width: 50, padding: '6px 8px', textAlign: 'center', color: EMBRY.dim, fontSize: 8, fontWeight: 700 }}>CONF</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', color: '#FF5722', fontSize: 8, fontWeight: 700 }}>CWE</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', color: '#FF9800', fontSize: 8, fontWeight: 700 }}>ATT&CK</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', color: '#2196F3', fontSize: 8, fontWeight: 700 }}>D3FEND</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left', color: '#9C27B0', fontSize: 8, fontWeight: 700 }}>MIND</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.graphNodes
                        .filter(n => {
                          const tax = taxonomyMap.get(n.id)
                          if (!tax) return false
                          if (!tableSearch) return true
                          const q = tableSearch.toLowerCase()
                          return n.label.toLowerCase().includes(q) || n.nodeType.includes(q) ||
                            (tax.cwe || []).join(' ').toLowerCase().includes(q) ||
                            (tax.attack || []).join(' ').toLowerCase().includes(q) ||
                            (tax.mind || []).join(' ').toLowerCase().includes(q)
                        })
                        .sort((a, b) => {
                          const aTax = taxonomyMap.get(a.id)
                          const bTax = taxonomyMap.get(b.id)
                          return ((bTax?.cwe?.length || 0) + (bTax?.attack?.length || 0)) - ((aTax?.cwe?.length || 0) + (aTax?.attack?.length || 0))
                        })
                        .map(n => {
                          const tax = taxonomyMap.get(n.id)!
                          const confColor = n.confidence >= 0.8 ? EMBRY.green : n.confidence >= 0.6 ? EMBRY.amber : EMBRY.red
                          return (
                            <tr key={n.id} onClick={() => onNodeClick(n)}
                              style={{ borderBottom: `1px solid ${EMBRY.border}`, cursor: 'pointer' }}
                              onMouseEnter={e => (e.currentTarget.style.background = '#0a0a0a')}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              <td style={{ padding: '5px 8px', color: EMBRY.white, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n.label}</td>
                              <td style={{ padding: '5px 8px' }}>
                                <span style={{ fontSize: 7, padding: '1px 4px', borderRadius: 2, background: `${NODE_TYPE_COLORS[n.nodeType] || EMBRY.dim}20`, color: NODE_TYPE_COLORS[n.nodeType] || EMBRY.dim, border: `1px solid ${NODE_TYPE_COLORS[n.nodeType] || EMBRY.dim}33` }}>{n.nodeType}</span>
                              </td>
                              <td style={{ padding: '5px 8px', textAlign: 'center', color: confColor, fontWeight: 700 }}>{Math.round(n.confidence * 100)}%</td>
                              <td style={{ padding: '5px 8px', color: '#FF5722', fontSize: 8 }}>{(tax.cwe || []).join(', ') || '—'}</td>
                              <td style={{ padding: '5px 8px', color: '#FF9800', fontSize: 8 }}>{(tax.attack || []).join(', ') || '—'}</td>
                              <td style={{ padding: '5px 8px', color: '#2196F3', fontSize: 8 }}>{(tax.d3fend || []).join(', ') || '—'}</td>
                              <td style={{ padding: '5px 8px', color: '#9C27B0', fontSize: 8 }}>{(tax.mind || []).join(', ') || '—'}</td>
                            </tr>
                          )
                        })}
                    </tbody>
                  </table>
                  {taxonomyLoading && <div style={{ padding: 20, textAlign: 'center', color: EMBRY.accent }}>Loading taxonomy data...</div>}
                </div>
              )}

              {/* Loading overlay while seeding — tells the user something is happening */}
              {seeding && (
                <div style={{
                  position: 'absolute', inset: 0, zIndex: 20,
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  background: 'rgba(5,5,5,0.75)', backdropFilter: 'blur(2px)',
                  gap: 12, pointerEvents: 'none',
                }}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%',
                    border: `2px solid ${EMBRY.border}`,
                    borderTopColor: EMBRY.accent,
                    animation: 'seed-spin 0.7s linear infinite',
                  }} />
                  <span style={{ fontSize: 11, color: EMBRY.accent, fontFamily: 'JetBrains Mono, monospace', letterSpacing: '0.06em' }}>
                    Building your graph…
                  </span>
                  <span style={{ fontSize: 9, color: EMBRY.dim }}>Nodes are appearing — triggered by your click</span>
                </div>
              )}

              {/* Confirmation toast — briefly confirms nodes appeared due to user action */}
              {seedDone > 0 && (
                <div style={{
                  position: 'absolute', top: 20, left: '50%', transform: 'translateX(-50%)',
                  zIndex: 30, pointerEvents: 'none',
                  background: '#050505', border: `1px solid ${EMBRY.accent}`,
                  borderRadius: 3, padding: '5px 14px',
                  display: 'flex', alignItems: 'center', gap: 8,
                  animation: 'seed-done-in 0.25s ease both',
                  fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: EMBRY.accent,
                  boxShadow: `0 0 16px ${EMBRY.accent}22`,
                }}>
                  <span style={{ color: EMBRY.green, fontWeight: 700 }}>✓</span>
                  <span>{seedDone} nodes loaded into graph</span>
                </div>
              )}

              {/* Empty scene panel — dense binary info like IDA/Ghidra initial state */}
              {sceneNodeIds.size === 0 && !data.loading && !seeding && viewMode === 'graph' && (
                <div style={{
                  position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                  zIndex: 5, pointerEvents: 'auto', width: 460,
                  background: '#080808', border: `1px solid ${EMBRY.border}`, borderRadius: 3,
                  boxShadow: '0 4px 24px rgba(0,0,0,0.8)',
                  animation: 'scene-card-in 0.15s ease both',
                  fontFamily: 'JetBrains Mono, monospace',
                }}>
                  {/* Title bar — IDA-style */}
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '5px 10px', borderBottom: `1px solid ${EMBRY.border}`,
                    background: '#0d0d0d',
                  }}>
                    <Shield size={11} style={{ color: EMBRY.accent, flexShrink: 0 }} />
                    <span style={{ fontSize: 10, fontWeight: 700, color: EMBRY.white, letterSpacing: '0.05em', flex: 1 }}>{binaryName}</span>
                    {binaries.length > 1 && (
                      <span style={{ fontSize: 8, color: EMBRY.muted, letterSpacing: '0.04em', marginRight: 8 }}>
                        {binaries.indexOf(binaryName) + 1}/{binaries.length}
                      </span>
                    )}
                    {data.graphNodes.length > 0
                      ? <span style={{ fontSize: 8, color: EMBRY.green, letterSpacing: '0.08em' }}>ANALYSIS READY</span>
                      : <span style={{ fontSize: 8, color: '#f59e0b', letterSpacing: '0.08em' }}>NOT INGESTED</span>
                    }
                  </div>

                  {/* Binary properties table — dense, like IDA's file info dialog */}
                  {binaryMetas[binaryName] && (() => {
                    const m = binaryMetas[binaryName]
                    const rows: [string, React.ReactNode][] = []
                    if (m.format) rows.push(['Format', <span style={{ color: EMBRY.white }}>{m.format}</span>])
                    if (m.arch) rows.push(['Arch', <span style={{ color: EMBRY.white }}>{m.arch}</span>])
                    if (m.entryPoint) rows.push(['Entry point', <span style={{ color: '#f59e0b' }}>{m.entryPoint}</span>])
                    if (m.sizeBytes > 0) rows.push(['File size', <span style={{ color: EMBRY.fg }}>{m.sizeBytes > 1048576 ? `${(m.sizeBytes / 1048576).toFixed(2)} MB` : `${(m.sizeBytes / 1024).toFixed(0)} KB`} ({m.sizeBytes.toLocaleString()} B)</span>])
                    if (typeof m.importCount === 'number') rows.push(['Imports', <span style={{ color: EMBRY.fg }}>{m.importCount}</span>])
                    rows.push(['Features', <span style={{ color: EMBRY.fg }}>{m.featureCount} nodes · {m.edgeCount} edges</span>])
                    const flags: React.ReactNode[] = []
                    if (m.stripped) flags.push(<span key="s" style={{ color: '#ef4444' }}>STRIPPED</span>)
                    if (m.pie) flags.push(<span key="p" style={{ color: '#22c55e' }}>PIE</span>)
                    if (m.relro) flags.push(<span key="r" style={{ color: '#3b82f6' }}>{m.relro.toUpperCase()}</span>)
                    if (flags.length > 0) rows.push(['Mitigations', <span style={{ display: 'flex', gap: 8 }}>{flags}</span>])
                    if (m.sha256) rows.push(['SHA-256', (
                      <span
                        title={`SHA256: ${m.sha256}\nClick to copy`}
                        onClick={() => navigator.clipboard.writeText(m.sha256)}
                        style={{ color: EMBRY.accent, cursor: 'pointer' }}
                      >{m.sha256}</span>
                    )])
                    return (
                      <div style={{ padding: '6px 10px', borderBottom: `1px solid ${EMBRY.border}` }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9 }}>
                          <tbody>
                            {rows.map(([label, value]) => (
                              <tr key={label as string}>
                                <td style={{ color: EMBRY.muted, paddingRight: 16, paddingBottom: 2, whiteSpace: 'nowrap', verticalAlign: 'top', width: 80 }}>{label}</td>
                                <td style={{ paddingBottom: 2, color: EMBRY.fg }}>{value}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginTop: 6 }}>
                          {Object.entries(m.byType).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
                            <span key={type} style={{
                              fontSize: 8, padding: '1px 5px', borderRadius: 2,
                              background: `${NODE_TYPE_COLORS[type] || EMBRY.muted}15`,
                              color: NODE_TYPE_COLORS[type] || EMBRY.muted,
                              border: `1px solid ${NODE_TYPE_COLORS[type] || EMBRY.muted}30`,
                            }}>
                              {count} {TYPE_ABBREV[type] || type}
                            </span>
                          ))}
                        </div>
                      </div>
                    )
                  })()}
                  {!binaryMetas[binaryName] && (
                    <div style={{ padding: '6px 10px', borderBottom: `1px solid ${EMBRY.border}`, fontSize: 9, color: EMBRY.dim }}>
                      {data.stats.totalNodes} features · {data.stats.totalEdges} edges · {data.graphNodes.filter(n => n.nodeType === 'namespace').length} namespaces
                    </div>
                  )}

                  {/* Quick-load actions — compact 2-column grid */}
                  <div style={{ padding: '6px 10px' }}>
                    {data.graphNodes.length === 0 ? (
                      <div style={{ padding: '10px 0', textAlign: 'center' }}>
                        <div style={{ fontSize: 9, color: '#f59e0b', marginBottom: 6, fontWeight: 700 }}>No features found for this binary</div>
                        <div style={{ fontSize: 8, color: EMBRY.muted, lineHeight: 1.6 }}>
                          Use <span style={{ color: EMBRY.accent }}>+ INGEST BINARY</span> in the left pane to extract features,<br />
                          or run the analyzer pipeline via the REST API below.
                        </div>
                      </div>
                    ) : (
                    <>
                    {/* Dual-track start guide: vulnerability hunting vs architecture exploration */}
                    <div style={{ marginBottom: 8, padding: '6px 8px', background: `${EMBRY.accent}08`, border: `1px solid ${EMBRY.accent}22`, borderRadius: 3 }}>
                      <div style={{ fontSize: 8, fontWeight: 700, color: EMBRY.accent, marginBottom: 5, letterSpacing: '0.06em' }}>START HERE</div>
                      <div style={{ fontSize: 8, fontWeight: 700, color: '#f44336', marginBottom: 2, letterSpacing: '0.05em' }}>HUNTING FOR BUGS?</div>
                      {([
                        { n: '1', t: '"CTF QUICK HUNT" below — attack surface + dangerous sinks in one click' },
                        { n: '2', t: '"Attack Surface" → input handlers, net listeners, file parsers highlighted' },
                        { n: '3', t: '"Vuln Map" → CWE + ATT&CK classifications for every function' },
                      ] as const).map(({ n, t }) => (
                        <div key={`vuln${n}`} style={{ display: 'flex', gap: 4, fontSize: 8, marginBottom: 1 }}>
                          <span style={{ fontWeight: 700, color: '#f44336', minWidth: 10, fontFamily: 'JetBrains Mono, monospace' }}>{n}.</span>
                          <span style={{ color: EMBRY.dim }}>{t}</span>
                        </div>
                      ))}
                      <div style={{ height: 5 }} />
                      <div style={{ fontSize: 8, fontWeight: 700, color: EMBRY.accent, marginBottom: 2, letterSpacing: '0.05em' }}>EXPLORING ARCHITECTURE?</div>
                      {([
                        { n: '1', t: '"Load Binary Structure" below — namespaces + top hubs' },
                        { n: '2', t: 'Click any node — expands its neighbors' },
                        { n: '3', t: 'Ask chat: "What does this binary do?"' },
                      ] as const).map(({ n, t }) => (
                        <div key={`arch${n}`} style={{ display: 'flex', gap: 4, fontSize: 8, marginBottom: 1 }}>
                          <span style={{ fontWeight: 700, color: EMBRY.accent, minWidth: 10, fontFamily: 'JetBrains Mono, monospace' }}>{n}.</span>
                          <span style={{ color: EMBRY.dim }}>{t}</span>
                        </div>
                      ))}
                    </div>
                    {/* CTF one-click: attack surface + dangerous sinks combined */}
                    <button onClick={() => {
                      const entryPoints = data.graphNodes.filter(n =>
                        n.nodeType === 'cli_command' || n.nodeType === 'rpc' || n.nodeType === 'event' || n.nodeType === 'parameter'
                      )
                      const topByConnections = entryPoints
                        .map(n => ({ id: n.id, deg: data.allEdges.filter(e => e._from === n.id || e._to === n.id).length }))
                        .sort((a, b) => b.deg - a.deg)
                        .slice(0, 20)
                      const sinkPattern = /recv|read|fread|gets|strcpy|strcat|sprintf|memcpy|memmove|scanf|popen|system|exec|open|fopen|socket|connect|bind|listen|accept|malloc|free|realloc/i
                      const interesting = data.graphNodes.filter(n =>
                        sinkPattern.test(n.label) ||
                        (n.nodeType === 'rpc' && data.allEdges.filter(e => e._from === n.id || e._to === n.id).length > 3)
                      )
                      addToScene([...new Set([...topByConnections.map(n => n.id), ...interesting.map(n => n.id)])])
                      handleSetPerspective('attack_surface')
                    }} style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', marginBottom: 6,
                      width: '100%', background: '#2a0a0a', border: `2px solid #f44336`,
                      color: '#f44336', borderRadius: 2, cursor: 'pointer',
                      fontFamily: 'JetBrains Mono, monospace', fontSize: 9, fontWeight: 700, textAlign: 'left',
                    }}>
                      <Zap size={11} style={{ flexShrink: 0 }} />
                      <div>
                        <div>CTF QUICK HUNT <span style={{ fontSize: 7, color: '#f44336', background: '#f4433620', padding: '0px 3px', borderRadius: 8, marginLeft: 2 }}>ONE CLICK</span></div>
                        <div style={{ fontSize: 7, fontWeight: 400, color: EMBRY.dim, marginTop: 1 }}>attack surface + dangerous sinks (gets/recv/strcpy/…) + I/O · sets attack_surface view</div>
                      </div>
                    </button>
                    <div style={{ fontSize: 8, color: EMBRY.muted, marginBottom: 5, letterSpacing: '0.06em' }}>LOAD INTO GRAPH</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                      <button onClick={() => {
                        setSeeding(true)
                        // 50ms lets React paint the loading overlay before computation blocks the thread
                        setTimeout(() => {
                          const namespaces = data.graphNodes.filter(n => n.nodeType === 'namespace')
                          const topHubs = data.graphNodes.filter(n => n.nodeType !== 'parameter' && n.nodeType !== 'namespace')
                            .map(n => ({ id: n.id, deg: data.allEdges.filter(e => e._from === n.id || e._to === n.id).length }))
                            .sort((a, b) => b.deg - a.deg).slice(0, 5)
                          const ids = [...namespaces.map(n => n.id), ...topHubs.map(n => n.id)]
                          addToScene(ids)
                          setSeeding(false)
                          setSeedDone(ids.length)
                          setTimeout(() => setSeedDone(0), 3000)
                        }, 50)
                      }} disabled={seeding} style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
                        background: `${EMBRY.accent}15`, border: `2px solid ${EMBRY.accent}`,
                        color: EMBRY.accent, borderRadius: 2, cursor: seeding ? 'default' : 'pointer',
                        fontFamily: 'JetBrains Mono, monospace', fontSize: 9, fontWeight: 700, textAlign: 'left',
                        animation: seeding ? 'none' : 'seed-cta-pulse 2.5s ease-in-out infinite',
                      }}>
                        <Layers size={11} style={{ flexShrink: 0, animation: seeding ? 'seed-spin 0.8s linear infinite' : 'none' }} />
                        <div>
                          <div>{seeding ? 'Building graph…' : 'Load Binary Structure'}</div>
                          <div style={{ fontSize: 7, fontWeight: 400, color: EMBRY.dim, marginTop: 1 }}>
                            {seeding ? 'Nodes are appearing now…' : `${data.graphNodes.filter(n => n.nodeType === 'namespace').length} namespaces + top-5 hubs · start here`}
                          </div>
                        </div>
                      </button>

                      <button onClick={() => {
                        const entryPoints = data.graphNodes.filter(n =>
                          n.nodeType === 'cli_command' || n.nodeType === 'rpc' || n.nodeType === 'event' || n.nodeType === 'parameter'
                        )
                        const topByConnections = entryPoints
                          .map(n => ({ id: n.id, deg: data.allEdges.filter(e => e._from === n.id || e._to === n.id).length }))
                          .sort((a, b) => b.deg - a.deg)
                          .slice(0, 20)
                        addToScene(topByConnections.map(n => n.id))
                        handleSetPerspective('attack_surface')
                      }} style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
                        background: '#1a0a0a', border: `1px solid #f4433633`, color: '#f44336',
                        borderRadius: 2, cursor: 'pointer',
                        fontFamily: 'JetBrains Mono, monospace', fontSize: 9, fontWeight: 700, textAlign: 'left',
                      }}>
                        <Network size={11} style={{ flexShrink: 0 }} />
                        <div>
                          <div>Attack Surface <span style={{ fontSize: 7, color: '#f44336', background: '#f4433620', padding: '0px 3px', borderRadius: 8, marginLeft: 2 }}>CTF</span></div>
                          <div style={{ fontSize: 7, fontWeight: 400, color: EMBRY.dim, marginTop: 1 }}>{`${data.graphNodes.filter(n => ['cli_command','rpc','event','parameter'].includes(n.nodeType)).length} — input handlers · net listeners · parsers`}</div>
                        </div>
                      </button>

                      <button onClick={() => {
                        const sinkPattern = /recv|read|fread|gets|strcpy|strcat|sprintf|memcpy|memmove|scanf|popen|system|exec|open|fopen|socket|connect|bind|listen|accept|malloc|free|realloc/i
                        const interesting = data.graphNodes.filter(n =>
                          sinkPattern.test(n.label) ||
                          (n.nodeType === 'rpc' && data.allEdges.filter(e => e._from === n.id || e._to === n.id).length > 3)
                        )
                        addToScene(interesting.map(n => n.id))
                        handleSetPerspective('attack_surface')
                      }} style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
                        background: '#0a1510', border: `1px solid #4CAF5033`, color: '#4CAF50',
                        borderRadius: 2, cursor: 'pointer',
                        fontFamily: 'JetBrains Mono, monospace', fontSize: 9, fontWeight: 700, textAlign: 'left',
                      }}>
                        <Zap size={11} style={{ flexShrink: 0 }} />
                        <div>
                          <div>Interesting Fns <span style={{ fontSize: 7, color: '#4CAF50', background: '#4CAF5020', padding: '0px 3px', borderRadius: 8, marginLeft: 2 }}>CTF</span></div>
                          <div style={{ fontSize: 7, fontWeight: 400, color: EMBRY.dim, marginTop: 1 }}>dangerous sinks · I/O · high-degree hubs</div>
                        </div>
                      </button>

                      <button onClick={() => { setViewMode('code'); setCodeViewTab('assembly') }} style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
                        background: '#0a1520', border: `1px solid #2196F333`, color: '#2196F3',
                        borderRadius: 2, cursor: 'pointer',
                        fontFamily: 'JetBrains Mono, monospace', fontSize: 9, fontWeight: 700, textAlign: 'left',
                      }}>
                        <Code size={11} style={{ flexShrink: 0 }} />
                        <div>
                          <div>Disassembly</div>
                          <div style={{ fontSize: 7, fontWeight: 400, color: EMBRY.dim, marginTop: 1 }}>ASM → decompiled C → pseudocode</div>
                        </div>
                      </button>

                      <button onClick={() => setViewMode('vulns')} style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px',
                        background: '#1a1520', border: `1px solid #9C27B033`, color: '#9C27B0',
                        borderRadius: 2, cursor: 'pointer',
                        fontFamily: 'JetBrains Mono, monospace', fontSize: 9, fontWeight: 700, textAlign: 'left',
                      }}>
                        <Shield size={11} style={{ flexShrink: 0 }} />
                        <div>
                          <div>Vuln Map</div>
                          <div style={{ fontSize: 7, fontWeight: 400, color: EMBRY.dim, marginTop: 1 }}>CWE · ATT&CK · D3FEND · CAPEC</div>
                        </div>
                      </button>
                    </div>
                    <button onClick={() => addToScene(data.graphNodes.map(n => n.id))} style={{
                      display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', marginTop: 4,
                      width: '100%', background: 'transparent', border: `1px solid ${EMBRY.border}`, color: EMBRY.dim,
                      borderRadius: 2, cursor: 'pointer',
                      fontFamily: 'JetBrains Mono, monospace', fontSize: 9, fontWeight: 400, textAlign: 'left',
                    }}>
                      <GitGraph size={11} style={{ flexShrink: 0 }} />
                      <span>Load All ({data.graphNodes.length} nodes)</span>
                    </button>
                    </>
                    )}
                  </div>

                  {/* Pipeline / REST API — prominent for automation workflows */}
                  <div style={{
                    padding: '6px 10px', borderTop: `1px solid ${EMBRY.border}`,
                    background: '#0a0a0a',
                  }}>
                    <div style={{ fontSize: 8, color: EMBRY.muted, marginBottom: 5, letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Workflow size={9} style={{ color: EMBRY.muted }} />
                      REST API
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {[
                        ['GET', `/api/binary/${binaryName}/features`, 'feature graph JSON'],
                        ['GET', `/api/binary/${binaryName}/graph`, 'adjacency + edge data'],
                        ['GET', `/api/binary/${binaryName}/taxonomy`, 'CWE / ATT&CK export'],
                        ['POST', '/api/binary/ingest', 'trigger ingestion pipeline'],
                      ].map(([method, path, desc]) => (
                        <div key={path} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                          <span style={{ fontSize: 7, fontWeight: 700, color: method === 'GET' ? '#22c55e' : '#f59e0b', minWidth: 28 }}>{method}</span>
                          <span style={{ fontSize: 8, color: EMBRY.accent, fontFamily: 'JetBrains Mono, monospace', flex: 1 }}>{path}</span>
                          <span style={{ fontSize: 7, color: EMBRY.muted }}>{desc}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Scene node count badge */}
              {sceneNodeIds.size > 0 && (
                <div style={{
                  position: 'absolute', top: 8, right: 8, zIndex: 10,
                  display: 'flex', gap: 6, alignItems: 'center',
                  background: 'rgba(5,5,5,0.9)', backdropFilter: 'blur(4px)',
                  padding: '4px 8px', borderRadius: 4,
                  border: `1px solid ${EMBRY.border}`,
                }}>
                  <span style={{ fontSize: 9, color: EMBRY.dim, fontFamily: 'JetBrains Mono, monospace' }}>
                    {sceneNodeIds.size}/{data.graphNodes.length} in scene
                  </span>
                  <button onClick={clearScene} style={{
                    fontSize: 8, padding: '2px 6px', background: 'transparent',
                    border: `1px solid ${EMBRY.border}`, color: EMBRY.dim,
                    borderRadius: 2, cursor: 'pointer',
                  }}>CLEAR</button>
                </div>
              )}
            </div>

            {/* Context Menu Overlay */}
            {contextMenu && (() => {
              const n = contextMenu.node
              const displayLabel = nodeLabels[n.id] ?? n.label
              const annotation = nodeAnnotations[n.id]
              return (
                <ContextMenu
                  x={contextMenu.x}
                  y={contextMenu.y}
                  title={displayLabel}
                  onClose={() => setContextMenu(null)}
                  items={[
                    {
                      label: 'Rename', icon: <Code size={12} />, shortcut: 'N',
                      onClick: () => {
                        const next = window.prompt('Rename node:', displayLabel)
                        if (next && next.trim()) setNodeLabels(m => ({ ...m, [n.id]: next.trim() }))
                      },
                    },
                    {
                      label: annotation ? 'Edit Annotation' : 'Add Annotation',
                      icon: <MessageSquare size={12} />, shortcut: ';',
                      onClick: () => {
                        const next = window.prompt('Annotation:', annotation ?? '')
                        if (next !== null) setNodeAnnotations(m => ({ ...m, [n.id]: next.trim() }))
                      },
                    },
                    {
                      label: 'Copy ID / Address', icon: <List size={12} />, shortcut: 'Ctrl+C',
                      onClick: () => { navigator.clipboard.writeText(n.id) },
                    },
                    { label: '', separator: true, onClick: () => {} },
                    { label: 'Navigation', header: true, onClick: () => {} },
                    {
                      label: 'Callers & Callees (XRefs)', icon: <Search size={12} />, shortcut: 'X',
                      onClick: () => {
                        setChatInput(`List all callers and callees of ${displayLabel}. For each caller: where does it call from and what arguments does it pass? For each callee: what does ${displayLabel} call and in what order? Include indirect calls via function pointers or vtable dispatch.`)
                        setTimeout(() => sendChat(), 100)
                      },
                    },
                    {
                      label: 'Trace Call Depth…', icon: <GitGraph size={12} />, shortcut: 'D',
                      onClick: () => {
                        const depth = window.prompt('Call depth (1–10):', '3')
                        const d = parseInt(depth ?? '3', 10)
                        const clamped = isNaN(d) ? 3 : Math.max(1, Math.min(10, d))
                        setChatInput(`Trace all callers and callees of ${displayLabel} to depth ${clamped}. Show the full call tree level by level, listing direct calls first then indirect calls (function pointers, vtable slots, callbacks) at each level. Mark any cycles.`)
                        setTimeout(() => sendChat(), 100)
                      },
                    },
                    {
                      label: 'Full Dependency Chain', icon: <Network size={12} />, shortcut: 'C',
                      onClick: () => {
                        setChatInput(`Show the full dependency chain from all binary entry points to ${displayLabel}. For each path: list every intermediate function in call order, note direct vs indirect calls, and flag any path that crosses a privilege or trust boundary (syscall, extern, callback). Which path is shortest? Which has the most external-input exposure?`)
                        setTimeout(() => sendChat(), 100)
                      },
                    },
                    {
                      label: 'Indirect Calls (Ptrs / Vtables)', icon: <Workflow size={12} />,
                      onClick: () => {
                        setChatInput(`Find all indirect calls involving ${displayLabel}: function-pointer assignments, vtable slots, dispatch tables, or callback registrations. For each: where is the pointer set, where is it invoked, and can the target be statically resolved or does it require dynamic analysis?`)
                        setTimeout(() => sendChat(), 100)
                      },
                    },
                    {
                      label: 'Highlight Call Path…', icon: <Search size={12} />, shortcut: 'H',
                      onClick: () => {
                        const target = window.prompt('Highlight path to (function name):', displayLabel)
                        if (!target?.trim()) return
                        setChatInput(`Highlight the specific call path from the binary entry point to ${target.trim()}. List each function in the chain in call order, noting direct vs indirect calls. If multiple paths exist, show the shortest and the one with the most external-input exposure.`)
                        setTimeout(() => sendChat(), 100)
                      },
                    },
                    {
                      label: 'Expand 6 Neighbors', icon: <Network size={12} />, shortcut: 'E',
                      onClick: () => { addNodeWithNeighbors(n.id, 1, 6) },
                    },
                    {
                      label: 'Expand All Neighbors', icon: <Network size={12} />,
                      onClick: () => { addNodeWithNeighbors(n.id, 1, 20) },
                    },
                    { label: '', separator: true, onClick: () => {} },
                    { label: 'Analysis', header: true, onClick: () => {} },
                    {
                      label: 'Trace Execution Path', icon: <Workflow size={12} />,
                      onClick: () => {
                        setChatInput(`Trace the execution path of ${displayLabel}. What state machines, events, and schemas does it touch?`)
                        setTimeout(() => sendChat(), 100)
                      },
                    },
                    {
                      label: 'Find Attack Surface', icon: <Shield size={12} />,
                      onClick: () => {
                        setChatInput(`What is the security attack surface of ${displayLabel}? What auth, permissions, or external inputs does it use?`)
                        setTimeout(() => sendChat(), 100)
                      },
                    },
                    {
                      label: selectedNode && selectedNode.id !== n.id
                        ? `Compare with ${selectedNode.label}` : 'Analyze Connections',
                      icon: <Search size={12} />,
                      onClick: () => {
                        const other = selectedNode && selectedNode.id !== n.id ? selectedNode.label : ''
                        if (other) {
                          setChatInput(`Compare ${displayLabel} and ${other}. How are they related? What do they share?`)
                        } else {
                          setChatInput(`What are the most important connections of ${displayLabel} and why?`)
                        }
                        setTimeout(() => sendChat(), 100)
                      },
                    },
                    { label: '', separator: true, onClick: () => {} },
                    {
                      label: 'Remove from Scene', icon: <Trash2 size={12} />, danger: true, shortcut: 'Del',
                      onClick: () => { removeFromScene(n.id) },
                    },
                  ]}
                />
              )
            })()}

            {/* ═══ BOTTOM DATA VIEW — resizable, tabbed inspector ═══ */}
            {/* Drag handle for vertical resize */}
            <div
              style={{ height: 4, cursor: 'row-resize', background: 'transparent', borderTop: `1px solid ${EMBRY.border}`, flexShrink: 0 }}
              onMouseDown={(e) => {
                e.preventDefault()
                const startY = e.clientY
                const startH = dataPanelHeight
                const onMove = (ev: MouseEvent) => setDataPanelHeight(Math.max(60, Math.min(500, startH - (ev.clientY - startY))))
                const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
                window.addEventListener('mousemove', onMove)
                window.addEventListener('mouseup', onUp)
              }}
            />
            <div style={{
              height: dataPanelHeight, flexShrink: 0,
              background: '#090909', overflow: 'hidden', display: 'flex', flexDirection: 'column',
            }}>
            {!selectedNode ? (
              <div style={{ padding: '10px 16px', overflow: 'auto' }}>
                {/* Binary overview header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 900, color: EMBRY.white, letterSpacing: '-0.02em' }}>{binaryName.toUpperCase()}</div>
                    <div style={{ fontSize: 9, color: EMBRY.dim }}>ELF binary · extracted via /analyze-elf + /treesitter</div>
                  </div>
                  <div style={{ marginLeft: 'auto', fontSize: 9, color: EMBRY.muted, fontFamily: 'JetBrains Mono, monospace' }}>
                    {data.stats.totalNodes} features · {data.stats.totalEdges} edges
                  </div>
                </div>
                {/* Metadata chips */}
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  {(() => {
                    const tiers = { T0: 0, T1: 0, T2: 0 }
                    data.graphNodes.forEach(n => { if (n.tier in tiers) tiers[n.tier as keyof typeof tiers]++ })
                    const namespaceCount = data.graphNodes.filter(n => n.nodeType === 'namespace').length
                    const avgConfidence = data.graphNodes.length > 0
                      ? (data.graphNodes.reduce((s, n) => s + (n.confidence || 0), 0) / data.graphNodes.length * 100).toFixed(0)
                      : '0'
                    const chipStyle = (color: string) => ({
                      fontSize: 8, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace',
                      padding: '2px 6px', borderRadius: 3,
                      background: `${color}15`, border: `1px solid ${color}33`, color,
                    })
                    return <>
                      <span style={chipStyle(EMBRY.green)}>T0: {tiers.T0}</span>
                      <span style={chipStyle(EMBRY.amber)}>T1: {tiers.T1}</span>
                      <span style={chipStyle(EMBRY.red)}>T2: {tiers.T2}</span>
                      <span style={chipStyle('#94a3b8')}>{namespaceCount} ns</span>
                      <span style={chipStyle('#22d3ee')}>conf: {avgConfidence}%</span>
                      <span style={chipStyle(EMBRY.muted)}>ELF</span>
                    </>
                  })()}
                </div>

                {/* Type breakdown as compact bar */}
                <div style={{ display: 'flex', gap: 2, marginBottom: 8, height: 4, borderRadius: 2, overflow: 'hidden' }}>
                  {Object.entries(data.stats.byType).filter(([, v]) => v > 0).map(([type, count]) => (
                    <div key={type} style={{
                      flex: count, backgroundColor: NODE_TYPE_COLORS[type] ?? EMBRY.dim,
                      opacity: 0.7, minWidth: 2,
                    }} title={`${type}: ${count}`} />
                  ))}
                </div>

                {/* Type counts */}
                <div style={{ display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
                  {Object.entries(data.stats.byType).filter(([, v]) => v > 0).map(([type, count]) => (
                    <span key={type} style={{ fontSize: 9, color: EMBRY.dim }}>
                      <span style={{ color: NODE_TYPE_COLORS[type] ?? EMBRY.dim, fontWeight: 700, fontFamily: 'JetBrains Mono, monospace' }}>{count}</span>
                      {' '}{type.replace('_', ' ')}
                    </span>
                  ))}
                </div>

                {/* Top namespaces (clusters) */}
                <div style={{ fontSize: 8, color: EMBRY.dim, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>NAMESPACES</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                  {data.graphNodes.filter(n => n.nodeType === 'namespace').map(n => {
                    const deg = data.allEdges.filter(e => e._from === n.id || e._to === n.id).length
                    return (
                      <span key={n.id} onClick={() => onFeatureClick(n.label)}
                        tabIndex={0} role="button" aria-label={`Navigate to namespace: ${n.label}`}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFeatureClick(n.label) } }}
                        style={{ fontSize: 9, padding: '2px 6px', background: '#0d0d0d', border: `1px solid ${EMBRY.border}`, color: EMBRY.white, cursor: 'pointer', borderRadius: 2, fontFamily: 'JetBrains Mono, monospace' }}>
                        {n.label} <span style={{ color: EMBRY.muted }}>({deg})</span>
                      </span>
                    )
                  })}
                </div>

                {/* Top hubs */}
                <div style={{ fontSize: 8, color: EMBRY.dim, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>TOP FEATURES BY CONNECTIONS</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {data.graphNodes
                    .filter(n => n.nodeType !== 'parameter' && n.nodeType !== 'namespace')
                    .map(n => ({ ...n, deg: data.allEdges.filter(e => e._from === n.id || e._to === n.id).length }))
                    .sort((a, b) => b.deg - a.deg)
                    .slice(0, 10)
                    .map(n => (
                      <span key={n.id} onClick={() => onFeatureClick(n.label)}
                        tabIndex={0} role="button" aria-label={`Select feature: ${n.label}`}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onFeatureClick(n.label) } }}
                        style={{ fontSize: 9, padding: '2px 6px', background: '#0d0d0d', border: `1px solid ${EMBRY.border}`, color: '#22d3ee', cursor: 'pointer', borderRadius: 2, fontFamily: 'JetBrains Mono, monospace', borderBottom: '1px dotted rgba(34,211,238,0.3)' }}>
                        {n.label} <span style={{ color: EMBRY.muted }}>({n.deg})</span>
                      </span>
                    ))
                  }
                </div>
              </div>
            ) : (
              <>
                {/* Header: node info + icon tabs */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', borderBottom: `1px solid ${EMBRY.border}`, background: '#060606', flexShrink: 0 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: NODE_TYPE_COLORS[selectedNode.nodeType] ?? EMBRY.dim }} />
                  <span style={{ fontSize: 11, fontWeight: 800, color: EMBRY.white }}>{selectedNode.label}</span>
                  <span style={{ fontSize: 8, color: EMBRY.dim, textTransform: 'uppercase' }}>{selectedNode.nodeType.replace('_', ' ')} · {selectedNode.cluster} · {selectedNode.tier}</span>
                  <span style={{ flex: 1 }} />
                  {/* Icon-only tabs with tooltip */}
                  {([
                    { id: 'summary' as const, title: 'Overview', icon: <Layers size={14} /> },
                    { id: 'connections' as const, title: 'Connections', icon: <Network size={14} /> },
                    { id: 'explain' as const, title: 'Explanation', icon: <MessageSquare size={14} /> },
                    { id: 'code' as const, title: 'Code View', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 8l-4 4 4 4"/><path d="M17 8l4 4-4 4"/><path d="M14 4l-4 16"/></svg> },
                    { id: 'table' as const, title: 'All Features', icon: <Table2 size={14} /> },
                    { id: 'ast' as const, title: 'AST / Fields', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 4C5.5 6.5 4 9 4 12s1.5 5.5 4 8" /><path d="M16 4c2.5 2.5 4 5 4 8s-1.5 5.5-4 8" /><line x1="9.5" y1="9" x2="14.5" y2="15" /><line x1="14.5" y1="9" x2="9.5" y2="15" /></svg> },
                    { id: 'raw' as const, title: 'Raw JSON', icon: <Code size={14} /> },
                  ]).map(tab => (
                    <button key={tab.id} title={tab.title}
                      onClick={() => setDataTab(tab.id)}
                      style={{
                        padding: '4px 6px', cursor: 'pointer', border: 'none', borderRadius: 2,
                        background: dataTab === tab.id ? `${EMBRY.accent}20` : 'transparent',
                        color: dataTab === tab.id ? EMBRY.accent : EMBRY.dim,
                        borderBottom: dataTab === tab.id ? `2px solid ${EMBRY.accent}` : '2px solid transparent',
                        display: 'flex', alignItems: 'center', gap: 3,
                        fontSize: 8, fontWeight: dataTab === tab.id ? 700 : 400,
                      }}
                    >{tab.icon}{dataTab === tab.id && <span>{tab.title}</span>}</button>
                  ))}
                  <span style={{ fontSize: 8, color: EMBRY.muted, marginLeft: 8 }}>{allSelectedEdges.length} conn</span>
                </div>

                {/* Tab content — each independently scrollable */}
                <div style={{ flex: 1, overflow: 'auto', padding: '8px 12px' }}>
                  {dataTab === 'summary' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {/* Row 1: Description + stats */}
                      <div style={{ display: 'flex', gap: 16 }}>
                        <div style={{ flex: 1 }}>
                          {selectedNode.description && (
                            <div style={{ fontSize: 11, color: EMBRY.white, lineHeight: 1.6, marginBottom: 4 }}>{selectedNode.description}</div>
                          )}
                          {nodeExplanationLoading && <div style={{ fontSize: 9, color: EMBRY.accent }}>Analyzing...</div>}
                          {nodeExplanation && (
                            <div style={{ fontSize: 10, lineHeight: 1.6, color: '#c8d0da' }}>
                              {nodeExplanation.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 3).map((l, i) => (
                                <div key={i} style={{ marginBottom: 2 }}>{renderInline(l.replace(/[#]/g, ''), onFeatureClick)}</div>
                              ))}
                            </div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 12, flexShrink: 0, fontSize: 9 }}>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: EMBRY.white, fontFamily: 'JetBrains Mono, monospace' }}>{allSelectedEdges.length}</div>
                            <div style={{ color: EMBRY.dim, fontSize: 7, textTransform: 'uppercase' }}>conn</div>
                          </div>
                          {(selectedNode.fields?.length ?? 0) > 0 && <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: EMBRY.white, fontFamily: 'JetBrains Mono, monospace' }}>{selectedNode.fields!.length}</div>
                            <div style={{ color: EMBRY.dim, fontSize: 7, textTransform: 'uppercase' }}>fields</div>
                          </div>}
                          {(selectedNode.states?.length ?? 0) > 0 && <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: EMBRY.white, fontFamily: 'JetBrains Mono, monospace' }}>{selectedNode.states!.length}</div>
                            <div style={{ color: EMBRY.dim, fontSize: 7, textTransform: 'uppercase' }}>states</div>
                          </div>}
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 14, fontWeight: 800, color: EMBRY.white, fontFamily: 'JetBrains Mono, monospace' }}>{Math.round(selectedNode.confidence * 100)}%</div>
                            <div style={{ color: EMBRY.dim, fontSize: 7, textTransform: 'uppercase' }}>conf</div>
                            {/* Provenance pills — what this confidence is based on */}
                            <div style={{ display: 'flex', gap: 2, marginTop: 3 }}>
                              {selectedNode.tier === 'T0' && <span style={{ fontSize: 6, padding: '0 3px', borderRadius: 2, background: '#2196F315', border: '1px solid #2196F333', color: '#2196F3' }}>AST</span>}
                              {selectedNode.tier === 'T1' && <span style={{ fontSize: 6, padding: '0 3px', borderRadius: 2, background: '#4CAF5015', border: '1px solid #4CAF5033', color: '#4CAF50' }}>CFG</span>}
                              {selectedNode.tier === 'T2' && <span style={{ fontSize: 6, padding: '0 3px', borderRadius: 2, background: '#FF980015', border: '1px dashed #FF980044', color: '#FF9800' }}>LLM</span>}
                              {selectedNode.source_pattern && <span style={{ fontSize: 6, padding: '0 3px', borderRadius: 2, background: '#94a3b815', border: '1px solid #94a3b833', color: '#94a3b8' }}>SRC</span>}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Row 2: Top connections as clickable chips (by edge type) */}
                      {Object.entries(edgesByType).length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {Object.entries(edgesByType).slice(0, 4).map(([type, targets]) => (
                            <div key={type} style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                              <span style={{ fontSize: 8, color: EDGE_COLORS[type] || EMBRY.dim, fontWeight: 800, textTransform: 'uppercase', minWidth: 65, paddingTop: 2, flexShrink: 0 }}>{type}</span>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                {targets.slice(0, 8).map(t => (
                                  <code key={t} onClick={() => onFeatureClick(t)} style={{
                                    fontSize: 9, padding: '1px 4px', background: '#0d0d0d', border: `1px solid ${EMBRY.border}`,
                                    color: '#22d3ee', cursor: 'pointer', borderRadius: 2, fontFamily: 'JetBrains Mono, monospace',
                                  }}>{t.split('/').pop()}</code>
                                ))}
                                {targets.length > 8 && <span style={{ fontSize: 8, color: EMBRY.muted }}>+{targets.length - 8} more</span>}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Row 3: Fields/Parameters — expandable struct view with RE annotations */}
                      {selectedNode.fields && selectedNode.fields.length > 0 && (() => {
                        const isSchema = selectedNode.nodeType === 'schema'
                        // Map common type names → C-style type annotation + byte size
                        const toCType = (raw: string): { ctype: string; size: number; isPtr: boolean; isBitfield: boolean; bits?: number } => {
                          const r = raw.toLowerCase().trim()
                          if (!r) return { ctype: 'uint8_t', size: 1, isPtr: false, isBitfield: false }
                          // bitfield (must check before pointer so "uint32_t:3" parses correctly)
                          const bfMatch = r.match(/:(\d+)$/)
                          if (bfMatch) { const base = toCType(r.replace(/:(\d+)$/, '')); return { ...base, ctype: base.ctype, isBitfield: true, bits: parseInt(bfMatch[1]), size: 0 } }
                          // struct pointer — preserve struct name: "struct_foo_ptr", "struct foo*"
                          const structPtrMatch = r.match(/^struct[_ ](.+?)(?:_ptr|\s*\*)$/)
                          if (structPtrMatch) return { ctype: `struct ${structPtrMatch[1].replace(/_ptr$/i,'').trim()}*`, size: 8, isPtr: true, isBitfield: false }
                          // plain pointer types (non-struct)
                          if (r.includes('*') || r.includes('ptr') || r.includes('pointer') || r === 'address') return { ctype: r.includes('char') ? 'char*' : r.includes('void') ? 'void*' : 'uintptr_t', size: 8, isPtr: true, isBitfield: false }
                          if (r === 'bool' || r === 'boolean') return { ctype: 'uint8_t /*bool*/', size: 1, isPtr: false, isBitfield: false }
                          if (r === 'byte' || r === 'uint8' || r === 'uint8_t' || r === 'u8') return { ctype: 'uint8_t', size: 1, isPtr: false, isBitfield: false }
                          if (r === 'int8' || r === 'int8_t' || r === 'i8') return { ctype: 'int8_t', size: 1, isPtr: false, isBitfield: false }
                          if (r === 'uint16' || r === 'uint16_t' || r === 'u16' || r === 'word' || r === 'short') return { ctype: 'uint16_t', size: 2, isPtr: false, isBitfield: false }
                          if (r === 'int16' || r === 'int16_t' || r === 'i16') return { ctype: 'int16_t', size: 2, isPtr: false, isBitfield: false }
                          if (r === 'uint32' || r === 'uint32_t' || r === 'u32' || r === 'dword' || r === 'int' || r === 'uint') return { ctype: 'uint32_t', size: 4, isPtr: false, isBitfield: false }
                          if (r === 'int32' || r === 'int32_t' || r === 'i32') return { ctype: 'int32_t', size: 4, isPtr: false, isBitfield: false }
                          if (r === 'uint64' || r === 'uint64_t' || r === 'u64' || r === 'qword') return { ctype: 'uint64_t', size: 8, isPtr: false, isBitfield: false }
                          if (r === 'int64' || r === 'int64_t' || r === 'i64') return { ctype: 'int64_t', size: 8, isPtr: false, isBitfield: false }
                          if (r === 'float' || r === 'f32') return { ctype: 'float', size: 4, isPtr: false, isBitfield: false }
                          if (r === 'double' || r === 'f64') return { ctype: 'double', size: 8, isPtr: false, isBitfield: false }
                          if (r === 'string' || r === 'str') return { ctype: 'char*', size: 8, isPtr: true, isBitfield: false }
                          if (r.startsWith('char[')) { const n = parseInt(r.slice(5)); return { ctype: raw, size: isNaN(n) ? 0 : n, isPtr: false, isBitfield: false } }
                          if (r === 'char') return { ctype: 'char', size: 1, isPtr: false, isBitfield: false }
                          if (r.startsWith('struct ') || r.startsWith('struct_')) return { ctype: `struct ${raw.replace(/^struct_?/i,'').trim()}`, size: 0, isPtr: false, isBitfield: false }
                          if (r === 'list' || r === 'array') return { ctype: 'void*[]', size: 8, isPtr: true, isBitfield: false }
                          if (r === 'map' || r === 'dict') return { ctype: 'void* /*map*/', size: 8, isPtr: true, isBitfield: false }
                          // fallback: treat as opaque struct
                          return { ctype: `struct ${raw}`, size: 0, isPtr: false, isBitfield: false }
                        }
                        // Calculate cumulative offsets
                        const enriched = selectedNode.fields.map((f: any) => {
                          const name = typeof f === 'string' ? f : f.name || f.label || String(f)
                          const rawType = typeof f === 'object' ? (f.type || f.dataType || f.kind || '') : ''
                          const desc = typeof f === 'object' ? (f.description || '') : ''
                          const explicitOffset: number | undefined = typeof f === 'object' && f.offset != null ? Number(f.offset) : undefined
                          const explicitSize: number | undefined = typeof f === 'object' && f.size != null ? Number(f.size) : undefined
                          const explicitBits: number | undefined = typeof f === 'object' && f.bits != null ? Number(f.bits) : undefined
                          const endian: string = typeof f === 'object' && f.endian ? String(f.endian).toUpperCase() : 'LE'
                          const typeInfo = toCType(rawType)
                          if (explicitBits) { typeInfo.isBitfield = true; typeInfo.bits = explicitBits; typeInfo.size = 0 }
                          const size = explicitSize ?? typeInfo.size
                          return { name, rawType, desc, typeInfo, size, endian, explicitOffset }
                        })
                        // Assign offsets: use explicit if given, else accumulate; track bit positions within bitfield words
                        let cursor = 0
                        let bitCursor = 0
                        let lastBfBase = -1
                        const withOffsets = enriched.map((e: any) => {
                          const offset = e.explicitOffset ?? cursor
                          let bitOffset = 0
                          if (e.typeInfo.isBitfield) {
                            if (lastBfBase !== offset) { bitCursor = 0; lastBfBase = offset }
                            bitOffset = bitCursor
                            bitCursor += (e.typeInfo.bits ?? 1)
                          } else {
                            cursor = offset + (e.size || 0)
                            bitCursor = 0
                            lastBfBase = -1
                          }
                          return { ...e, offset, bitOffset }
                        })
                        // Global endianness — majority vote
                        const leCount = withOffsets.filter((e: any) => e.endian === 'LE').length
                        const globalEndian = leCount >= withOffsets.length / 2 ? 'LE' : 'BE'
                        return (
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                              <div style={{ fontSize: 8, color: EMBRY.dim, fontWeight: 700, textTransform: 'uppercase' }}>
                                {isSchema ? 'STRUCT FIELDS' : 'PARAMETERS'} ({selectedNode.fields.length})
                              </div>
                              {isSchema && (
                                <>
                                  <span style={{ fontSize: 7, padding: '1px 5px', borderRadius: 2, background: '#1a2a1a', border: `1px solid ${EMBRY.green}44`, color: EMBRY.green, fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>{globalEndian}</span>
                                  {binaryMetas[binaryName]?.arch && <span style={{ fontSize: 7, padding: '1px 5px', borderRadius: 2, background: '#0a0a1a', border: '1px solid #2196F344', color: '#2196F3', fontFamily: 'JetBrains Mono, monospace' }}>{binaryMetas[binaryName].arch}</span>}
                                  {cursor > 0 && <span style={{ fontSize: 7, color: EMBRY.muted, fontFamily: 'JetBrains Mono, monospace' }}>sizeof={cursor}B</span>}
                                </>
                              )}
                            </div>
                            {isSchema && (
                              <div style={{ display: 'grid', gridTemplateColumns: '52px 100px 1fr 28px 24px', gap: '0 6px', padding: '2px 8px 2px', fontSize: 7, color: EMBRY.muted, fontFamily: 'JetBrains Mono, monospace', borderBottom: `1px solid ${EMBRY.border}` }}>
                                <span>OFFSET</span><span>TYPE</span><span>NAME</span><span>SIZE</span><span>END</span>
                              </div>
                            )}
                            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, background: '#050505', border: `1px solid ${EMBRY.border}`, borderRadius: 3, padding: '2px 0' }}>
                              {withOffsets.map((e: any, i: number) => (
                                <div key={i} onClick={() => onFeatureClick(e.name)}
                                  style={{
                                    display: isSchema ? 'grid' : 'flex',
                                    gridTemplateColumns: isSchema ? '52px 100px 1fr 28px 24px' : undefined,
                                    gap: isSchema ? '0 6px' : 8,
                                    padding: '3px 8px', cursor: 'pointer',
                                    borderBottom: i < selectedNode.fields!.length - 1 ? `1px solid ${EMBRY.border}` : 'none',
                                  }}
                                  onMouseEnter={ev => (ev.currentTarget.style.background = '#0a0a0a')}
                                  onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
                                >
                                  {isSchema ? (
                                    <>
                                      <span style={{ color: '#4a9eff', fontSize: 8 }}>+0x{e.offset.toString(16).padStart(4,'0').toUpperCase()}{e.typeInfo.isBitfield ? <span style={{ color: '#FF9800', fontSize: 7 }}>.b{e.bitOffset}</span> : null}</span>
                                      <span style={{ color: e.typeInfo.isPtr ? '#22d3ee' : e.typeInfo.isBitfield ? '#FF9800' : '#9C27B0', fontSize: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {e.typeInfo.isBitfield ? `${e.typeInfo.ctype}:${e.typeInfo.bits}` : e.typeInfo.ctype}
                                      </span>
                                      <span style={{ color: EMBRY.white, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={e.desc || e.name}>{e.name}{e.desc ? <span style={{ color: EMBRY.muted, fontSize: 7, marginLeft: 4 }}>{e.desc.slice(0,40)}{e.desc.length>40?'…':''}</span> : null}</span>
                                      <span style={{ color: e.typeInfo.isBitfield ? '#FF9800' : EMBRY.muted, fontSize: 8, textAlign: 'right' }}>
                                        {e.typeInfo.isBitfield ? `${e.typeInfo.bits}b` : e.size > 0 ? `${e.size}B` : e.typeInfo.isPtr ? '8B' : '?'}
                                      </span>
                                      <span style={{ fontSize: 7, color: e.endian === 'BE' ? '#FF5722' : EMBRY.green }}>{e.endian}</span>
<<<<<<< HEAD
                      {/* Row 4: States — state machine ring/directed graph */}
                      {selectedNode.states && selectedNode.states.length > 0 && (() => {
                        const TERMINAL_RE = /error|fail|dead|final|done|term|end|halt|clos|reject|disconnect|timeout|abort|invalid/i
                        const ERROR_RE = /error|fail|invalid|abort|reject/i
                        const INITIAL_RE = /^(init|idle|start|ready|none|disconnected|closed|new|reset)$/i
                        const states = selectedNode.states!
                        const classified = states.map((s: any, i: number) => {
                          const name = typeof s === 'string' ? s : (s.name || String(s))
                          // Extract explicit transitions from .transitions / .on / .events
                          const txns: Array<{label: string; target: string}> = []
                          if (typeof s === 'object' && s !== null) {
                            const src = s.transitions || s.on || s.events || {}
                            for (const [evt, tgt] of Object.entries(src as Record<string, any>)) {
                              const tgtName = typeof tgt === 'string' ? tgt : ((tgt as any)?.target ?? (tgt as any)?.state ?? String(tgt))
                              txns.push({ label: evt, target: String(tgtName) })
                            }
                          }
                          const isInitial = i === 0 || INITIAL_RE.test(name)
                          const isError = ERROR_RE.test(name)
                          const isTerminal = isError || TERMINAL_RE.test(name)
                          return { name, isInitial, isError, isTerminal, idx: i, txns }
                        })
                        // Only first state is initial unless a later state explicitly matches the regex
                        const hasExplicitInitial = classified.some((s, i) => i > 0 && INITIAL_RE.test(s.name))
                        if (!hasExplicitInitial) classified.forEach((s, i) => { if (i > 0) s.isInitial = false })

                        // Build edge list: prefer explicit transitions, else sequential with inferred event labels
                        const nameToIdx = new Map(classified.map(s => [s.name.toLowerCase(), s.idx]))
                        const edges: Array<{from: number; to: number; label: string}> = []
                        let hasExplicit = false
                        classified.forEach(st => {
                          if (st.txns.length > 0) {
                            hasExplicit = true
                            st.txns.forEach(t => {
                              const toIdx = nameToIdx.get(t.target.toLowerCase())
                              if (toIdx !== undefined && toIdx !== st.idx) edges.push({ from: st.idx, to: toIdx, label: t.label })
                            })
                          }
                        })
                        if (!hasExplicit) {
                          classified.slice(0, -1).forEach((st, i) => {
                            const next = classified[i + 1]
                            const lbl = (() => {
                              if (next.isError) return 'error'
                              if (TERMINAL_RE.test(next.name)) return 'done'
                              if (/connect/i.test(next.name)) return 'connect'
                              if (/auth/i.test(next.name)) return 'auth'
                              if (/open/i.test(next.name)) return 'open'
                              if (/send|write/i.test(next.name)) return 'send'
                              if (/recv|read/i.test(next.name)) return 'recv'
                              if (/ack/i.test(next.name)) return 'ack'
                              if (/close/i.test(next.name)) return 'close'
                              return '→'
                            })()
                            edges.push({ from: i, to: i + 1, label: lbl })
                          })
                        }

                        // Ring layout for ≤14 states, grid otherwise
                        const n = classified.length
                        const useRing = n <= 14
                        const NODE_W = 72, NODE_H = 18, NR = 10

                        let SVG_W = 0, SVG_H = 0
                        const positions: Array<{x: number; y: number; cx: number; cy: number}> = []
                        if (useRing) {
                          const R = Math.max(60, n * 11)
                          const pad = NODE_W / 2 + 22
                          SVG_W = (R + pad) * 2; SVG_H = (R + pad) * 2
                          const CX = SVG_W / 2, CY = SVG_H / 2
                          for (let i = 0; i < n; i++) {
                            const angle = -Math.PI / 2 + (2 * Math.PI * i) / n
                            const cx = CX + R * Math.cos(angle), cy = CY + R * Math.sin(angle)
                            positions.push({ cx, cy, x: cx - NODE_W / 2, y: cy - NODE_H / 2 })
                          }
                        } else {
                          const COLS = Math.min(4, n), H_GAP = 22, V_GAP = 30
                          const ROWS = Math.ceil(n / COLS)
                          SVG_W = COLS * NODE_W + (COLS - 1) * H_GAP + 20
                          SVG_H = ROWS * NODE_H + (ROWS - 1) * V_GAP + 20
                          for (let i = 0; i < n; i++) {
                            const x = 10 + (i % COLS) * (NODE_W + H_GAP)
                            const y = 10 + Math.floor(i / COLS) * (NODE_H + V_GAP)
                            positions.push({ x, y, cx: x + NODE_W / 2, cy: y + NODE_H / 2 })
                          }
                        }

                        // Compute edge endpoint nudged to node border (toward target)
                        const edgePt = (from: number, to: number, side: 'exit' | 'entry') => {
                          const f = positions[from], t = positions[to]
                          const dx = t.cx - f.cx, dy = t.cy - f.cy
                          const len = Math.sqrt(dx * dx + dy * dy) || 1
                          const src = side === 'exit' ? f : t
                          const sign = side === 'exit' ? 1 : -1
                          const offset = side === 'entry' ? NR + 5 : NR
                          return { x: src.cx + sign * (dx / len) * offset, y: src.cy + sign * (dy / len) * offset }
                        }

                        const traceAll = () => {
                          setSmTracedPath(new Set(classified.map((_, i) => i)))
                          setTimeout(() => setSmTracedPath(new Set()), 2500)
                        }

                        return (
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                              <div style={{ fontSize: 8, color: EMBRY.dim, fontWeight: 700, textTransform: 'uppercase' }}>
                                STATE MACHINE — {useRing ? 'RING' : 'DIRECTED'} GRAPH · {states.length} states · {edges.length} transitions
                              </div>
                              <button onClick={traceAll} style={{ fontSize: 7, padding: '1px 6px', borderRadius: 3, cursor: 'pointer', background: '#0a1a14', border: `1px solid ${EMBRY.green}55`, color: EMBRY.green }}>
                                TRACE ALL
                              </button>
                            </div>
                            {/* Legend */}
                            <div style={{ display: 'flex', gap: 10, marginBottom: 4 }}>
                              <span style={{ fontSize: 7, color: EMBRY.green, fontFamily: 'JetBrains Mono, monospace' }}>◉ INITIAL</span>
                              <span style={{ fontSize: 7, color: '#FF5722', fontFamily: 'JetBrains Mono, monospace' }}>▣ ERROR</span>
                              <span style={{ fontSize: 7, color: EMBRY.amber, fontFamily: 'JetBrains Mono, monospace' }}>◆ TERMINAL</span>
                              <span style={{ fontSize: 7, color: '#9C27B0', fontFamily: 'JetBrains Mono, monospace' }}>○ STATE</span>
                              <span style={{ fontSize: 7, color: EMBRY.muted, fontFamily: 'JetBrains Mono, monospace' }}>{hasExplicit ? '⚡ explicit' : '~ inferred'}</span>
                            </div>
                            {/* SVG directed graph */}
                            <svg width={SVG_W} height={SVG_H} style={{ display: 'block', overflow: 'visible', background: '#050505', borderRadius: 4, border: `1px solid ${EMBRY.border}` }}>
                              <defs>
                                <marker id="sm-arrow" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
                                  <polygon points="0 0, 6 2, 0 4" fill="#444" />
                                </marker>
                                <marker id="sm-arrow-traced" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
                                  <polygon points="0 0, 6 2, 0 4" fill={EMBRY.green} />
                                </marker>
                                <marker id="sm-arrow-err" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
                                  <polygon points="0 0, 6 2, 0 4" fill="#FF5722" />
                                </marker>
                              </defs>
                              {/* Initial-state entry arrow from outside the ring */}
                              {(() => {
                                const p0 = positions[0]
                                const angle = useRing ? -Math.PI / 2 : 0
                                const ex = p0.cx - Math.cos(angle) * (NR + 14)
                                const ey = p0.cy - Math.sin(angle) * (NR + 14)
                                const ax = p0.cx - Math.cos(angle) * (NR + 3)
                                const ay = p0.cy - Math.sin(angle) * (NR + 3)
                                return <line x1={ex} y1={ey} x2={ax} y2={ay} stroke={EMBRY.green} strokeWidth={1.5} markerEnd="url(#sm-arrow-traced)" />
                              })()}
                              {/* Transition edges with event/condition labels */}
                              {edges.map((e, ei) => {
                                const ep = edgePt(e.from, e.to, 'exit')
                                const tp = edgePt(e.from, e.to, 'entry')
                                const isTraced = smTracedPath.has(e.from) && smTracedPath.has(e.to)
                                const toErr = classified[e.to]?.isError
                                const stroke = isTraced ? EMBRY.green : toErr ? '#FF572266' : '#2a2a2a'
                                const marker = isTraced ? 'url(#sm-arrow-traced)' : toErr ? 'url(#sm-arrow-err)' : 'url(#sm-arrow)'
                                const dx = tp.x - ep.x, dy = tp.y - ep.y
                                const len = Math.sqrt(dx * dx + dy * dy) || 1
                                // Slight perpendicular curve so bidirectional edges don't overlap
                                const qx = (ep.x + tp.x) / 2 - (dy / len) * 8
                                const qy = (ep.y + tp.y) / 2 + (dx / len) * 8
                                const d = `M${ep.x.toFixed(1)} ${ep.y.toFixed(1)} Q${qx.toFixed(1)} ${qy.toFixed(1)} ${tp.x.toFixed(1)} ${tp.y.toFixed(1)}`
                                const lbl = e.label.length > 9 ? e.label.slice(0, 8) + '\u2026' : e.label
                                return (
                                  <g key={ei}>
                                    <path d={d} stroke={stroke} strokeWidth={isTraced ? 1.5 : 0.8} fill="none" markerEnd={marker} />
                                    <text x={qx.toFixed(1)} y={(qy - 3).toFixed(1)} fontSize={5} fill={isTraced ? EMBRY.green : toErr ? '#FF572299' : '#3a3a3a'} textAnchor="middle" fontFamily="JetBrains Mono, monospace">{lbl}</text>
                                  </g>
                                )
                              })}
                              {/* State nodes */}
                              {classified.map((st, i) => {
                                const pos = positions[i]
                                const isTraced = smTracedPath.has(i)
                                const borderColor = st.isError ? '#FF5722' : st.isInitial ? EMBRY.green : st.isTerminal ? EMBRY.amber : '#222'
                                const bgColor = st.isError ? '#1a0a05' : st.isInitial ? '#0a1a12' : st.isTerminal ? '#1a1205' : '#0d0d0d'
                                const textColor = st.isError ? '#FF5722' : st.isInitial ? EMBRY.green : st.isTerminal ? EMBRY.amber : '#9C27B0'
                                const label = st.name.length > 10 ? st.name.slice(0, 9) + '\u2026' : st.name
                                return (
                                  <g key={i} style={{ cursor: 'pointer' }} onClick={() => setSmTracedPath(prev => { const s = new Set(prev); s.has(i) ? s.delete(i) : s.add(i); return s })}>
                                    {/* Double-ring marker for initial state */}
                                    {st.isInitial && <rect x={pos.x - 3} y={pos.y - 3} width={NODE_W + 6} height={NODE_H + 6} rx={5} ry={5} fill="none" stroke={EMBRY.green + '44'} strokeWidth={0.8} />}
                                    <rect x={pos.x} y={pos.y} width={NODE_W} height={NODE_H} rx={3} ry={3}
                                      fill={bgColor}
                                      stroke={isTraced ? textColor : borderColor}
                                      strokeWidth={isTraced ? 1.5 : 0.8}
                                      strokeDasharray={st.isError ? '3 2' : undefined}
                                    />
                                    <text x={pos.cx} y={pos.cy + 3} fontSize={7} fill={isTraced ? textColor : textColor + 'cc'} textAnchor="middle" fontFamily="JetBrains Mono, monospace" fontWeight={st.isInitial ? 700 : 400}>{label}</text>
                                    <text x={pos.x + 3} y={pos.y + 6} fontSize={5} fill="#333" fontFamily="JetBrains Mono, monospace">S{i}</text>
                                  </g>
                                )
                              })}
                            </svg>
=======
                                    </>
                                  ) : (
                                    <>
                                      <span style={{ color: '#2196F3', minWidth: 16 }}>{i}</span>
                                      <span style={{ color: EMBRY.white, flex: 1 }}>{e.name}</span>
                                      {e.rawType && <span style={{ color: '#9C27B0', fontSize: 8 }}>{e.typeInfo.ctype}</span>}
                                      {e.desc && <span style={{ color: EMBRY.muted, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.desc}</span>}
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
>>>>>>> parent of c76f2b30 (persona/gynvael-coldwind: fix state-machines)
                          </div>
                        )
                      })()}

<<<<<<< HEAD
                                const textColor = st.isError ? '#FF5722' : st.isInitial ? EMBRY.green : st.isTerminal ? EMBRY.amber : '#9C27B0'
                                const label = st.name.length > 11 ? st.name.slice(0, 10) + '…' : st.name
                                return (
                                  <g key={i} style={{ cursor: 'pointer' }} onClick={() => setSmTracedPath(new Set([i]))}>
                                    <rect x={pos.x} y={pos.y} width={NODE_W} height={NODE_H} rx={3} ry={3}
                                      fill={isTraced ? bgColor : bgColor}
                                      stroke={isTraced ? textColor : borderColor}
                                      strokeWidth={isTraced ? 1.5 : 0.8}
                                    />
                                    <text x={pos.x + 3} y={pos.y + 7} fontSize={5} fill="#444" fontFamily="JetBrains Mono, monospace">S{i}</text>
                                    <text x={pos.x + NODE_W / 2} y={pos.y + NODE_H / 2 + 3} fontSize={7} fill={textColor} textAnchor="middle" fontFamily="JetBrains Mono, monospace">{label}</text>
                                  </g>
                                )
                              })}
                            </svg>
=======
                      {/* Row 4: States — state machine transition view */}
                      {selectedNode.states && selectedNode.states.length > 0 && (
                        <div>
                          <div style={{ fontSize: 8, color: EMBRY.dim, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>STATE MACHINE ({selectedNode.states.length} states)</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                            {selectedNode.states.map((s: any, i: number) => {
                              const name = typeof s === 'string' ? s : s.name || String(s)
                              return (
                                <div key={i} style={{
                                  display: 'flex', alignItems: 'center', gap: 4,
                                  fontSize: 9, padding: '3px 8px', borderRadius: 3,
                                  background: i === 0 ? '#1a2721' : '#0a0a0a',
                                  border: `1px solid ${i === 0 ? EMBRY.green + '44' : EMBRY.border}`,
                                  color: i === 0 ? EMBRY.green : '#9C27B0',
                                  fontFamily: 'JetBrains Mono, monospace',
                                }}>
                                  {i === 0 && <span style={{ fontSize: 7, color: EMBRY.green }}>▸</span>}
                                  {name}
                                  {i < selectedNode.states!.length - 1 && <span style={{ color: EMBRY.muted, marginLeft: 2 }}>→</span>}
                                </div>
                              )
                            })}
>>>>>>> parent of c76f2b30 (persona/gynvael-coldwind: fix state-machines)
                          </div>
                        </div>
                      )}

                      {/* Row 5: RPC/Event interface details */}
                      {(selectedNode.nodeType === 'rpc' || selectedNode.nodeType === 'event' || selectedNode.nodeType === 'cli_command') && (() => {
                        const fullDoc = data.allNodes.find(n => n._id === selectedNode.id) as any
                        const tax = taxonomyMap.get(selectedNode.id)
                        const authEdgeNodes = allSelectedEdges
                          .map(e => data.graphNodes.find(n => n.id === (e._from === selectedNode.id ? e._to : e._from)))
                          .filter(Boolean)
                          .filter(n => n!.label.includes('auth') || n!.label.includes('permission') || n!.label.includes('token') || n!.label.includes('credential'))
                        const hasAuth = authEdgeNodes.length > 0 || !!(fullDoc?.auth || fullDoc?.authentication || fullDoc?.requires_auth)
                        const authDetail: string = fullDoc?.auth || fullDoc?.authentication || fullDoc?.requires_auth || (authEdgeNodes.length > 0 ? authEdgeNodes.map(n => n!.label).join(', ') : '')
                        const callingConv: string = fullDoc?.calling_convention || fullDoc?.call_convention || ''
                        const returnType: string = fullDoc?.return_type || fullDoc?.returns || ''
                        const handler: string = fullDoc?.handler || fullDoc?.handler_fn || fullDoc?.implementation || fullDoc?.impl_fn || fullDoc?.function || ''
                        const handlerList: string[] = (() => {
                          const h = fullDoc?.handlers || fullDoc?.handler_fns || fullDoc?.implementations
                          if (Array.isArray(h) && h.length > 0) return h.map(String)
                          if (handler) return [handler]
                          return []
                        })()
                        // Also surface implementing functions from incoming 'contains' edges (function nodes wrapping this RPC)
                        const containsCallers = incomingEdges
                          .filter(e => e.type === 'contains')
                          .map(e => e.source)
                          .filter(s => !handlerList.includes(s))
                        const paramNodeEdges = outgoingEdges.filter(e => e.type === 'has_parameter')
                        const paramFromGraph: { name: string; type?: string; required?: boolean }[] = paramNodeEdges
                          .map(e => {
                            const n = data.graphNodes.find(g => g.id === e.targetId) as any
                            const t = n ? (n.fields?.[0]?.type || (n as any).data_type || (n as any).type || undefined) : undefined
                            return { name: n?.label ?? e.target, type: t }
                          })
                        const paramList: { name: string; type?: string; required?: boolean }[] = (() => {
                          const raw = fullDoc?.parameters || fullDoc?.params
                          if (Array.isArray(raw) && raw.length > 0) {
                            return raw.map((p: any) => typeof p === 'object'
                              ? { name: p.name || p.label || String(p), type: p.type || p.data_type, required: p.required }
                              : { name: String(p) }
                            )
                          }
                          if (paramFromGraph.length > 0) return paramFromGraph
                          return (selectedNode.fields ?? []).map(f => ({ name: f }))
                        })()
                        const payloadOut = outgoingEdges.filter(e => e.type === 'payload')
                        const payloadIn = incomingEdges.filter(e => e.type === 'payload')
                        const emitsEdges = outgoingEdges.filter(e => e.type === 'emits')
                        const triggersEdges = outgoingEdges.filter(e => e.type === 'triggers')
                        return (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            {/* Interface section */}
                            <div>
                              <div style={{ fontSize: 8, color: '#2196F3', fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>INTERFACE</div>
                              <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '2px 8px', fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}>
                                <span style={{ color: EMBRY.muted }}>Type</span>
                                <span style={{ color: EMBRY.white }}>{selectedNode.nodeType.toUpperCase()}</span>
                                <span style={{ color: EMBRY.muted }}>Namespace</span>
                                <span style={{ color: '#22d3ee' }}>{selectedNode.cluster}</span>
                                {callingConv && <>
                                  <span style={{ color: EMBRY.muted }}>Convention</span>
                                  <span style={{ color: '#a78bfa' }}>{callingConv}</span>
                                </>}
                                {returnType && <>
                                  <span style={{ color: EMBRY.muted }}>Returns</span>
                                  <span style={{ color: '#34d399' }}>{returnType}</span>
                                </>}
                                {handlerList.length > 0 && <>
                                  <span style={{ color: EMBRY.muted, alignSelf: 'flex-start', paddingTop: 1 }}>Handler{handlerList.length > 1 ? 's' : ''}</span>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    {handlerList.map((h, i) => (
                                      <code key={i} style={{ color: '#fbbf24', wordBreak: 'break-all', fontSize: 8, cursor: 'pointer' }} onClick={() => onFeatureClick(h)}>{h}</code>
                                    ))}
                                  </div>
                                </>}
                                {containsCallers.length > 0 && <>
                                  <span style={{ color: EMBRY.muted, alignSelf: 'flex-start', paddingTop: 1 }}>Callers</span>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                    {containsCallers.slice(0, 4).map((c, i) => (
                                      <code key={i} style={{ color: '#94a3b8', wordBreak: 'break-all', fontSize: 8, cursor: 'pointer' }} onClick={() => onFeatureClick(c)}>{c}</code>
                                    ))}
                                    {containsCallers.length > 4 && <span style={{ fontSize: 7, color: EMBRY.muted }}>+{containsCallers.length - 4} more</span>}
                                  </div>
                                </>}
                                <span style={{ color: EMBRY.muted }}>Tier</span>
                                <span style={{ color: selectedNode.tier === 'T0' ? EMBRY.green : selectedNode.tier === 'T1' ? EMBRY.amber : EMBRY.red }}>{selectedNode.tier}</span>
                              </div>
                            </div>

                            {/* Parameters with types */}
                            {paramList.length > 0 && (
                              <div>
                                <div style={{ fontSize: 8, color: '#9C27B0', fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>PARAMETERS ({paramList.length})</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                  {paramList.map((p, i) => (
                                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, fontFamily: 'JetBrains Mono, monospace', fontSize: 9 }}>
                                      {p.required != null && (
                                        <span style={{ fontSize: 7, color: p.required ? '#ef4444' : EMBRY.muted, minWidth: 12 }}>{p.required ? '!' : '?'}</span>
                                      )}
                                      <code style={{ color: '#22d3ee', cursor: 'pointer' }} onClick={() => onFeatureClick(p.name)}>{p.name}</code>
                                      {p.type && <span style={{ color: '#a78bfa', fontSize: 8 }}>: {p.type}</span>}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Request/Response schemas via payload edges */}
                            {(payloadOut.length > 0 || payloadIn.length > 0 || emitsEdges.length > 0 || triggersEdges.length > 0) && (
                              <div>
                                <div style={{ fontSize: 8, color: '#2196F3', fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>SCHEMAS</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontFamily: 'JetBrains Mono, monospace', fontSize: 9 }}>
                                  {payloadOut.map((e, i) => (
                                    <div key={`po-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <span style={{ color: '#2196F3', fontSize: 8 }}>REQ→</span>
                                      <code style={{ color: '#22d3ee', cursor: 'pointer' }} onClick={() => onFeatureClick(e.target)}>{e.target}</code>
                                    </div>
                                  ))}
                                  {payloadIn.map((e, i) => (
                                    <div key={`pi-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <span style={{ color: '#FF9800', fontSize: 8 }}>←RSP</span>
                                      <code style={{ color: '#22d3ee', cursor: 'pointer' }} onClick={() => onFeatureClick(e.source)}>{e.source}</code>
                                    </div>
                                  ))}
                                  {emitsEdges.map((e, i) => (
                                    <div key={`em-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <span style={{ color: '#FF5722', fontSize: 8 }}>EMIT→</span>
                                      <code style={{ color: '#22d3ee', cursor: 'pointer' }} onClick={() => onFeatureClick(e.target)}>{e.target}</code>
                                    </div>
                                  ))}
                                  {triggersEdges.map((e, i) => (
                                    <div key={`tr-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                      <span style={{ color: EMBRY.green, fontSize: 8 }}>TRIG→</span>
                                      <code style={{ color: '#22d3ee', cursor: 'pointer' }} onClick={() => onFeatureClick(e.target)}>{e.target}</code>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Security / Auth section */}
                            <div>
                              <div style={{ fontSize: 8, color: '#FF5722', fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>SECURITY</div>
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                <span style={{
                                  fontSize: 8, padding: '2px 6px', borderRadius: 2, fontWeight: 700,
                                  background: hasAuth ? '#1a272120' : '#2a151520',
                                  border: `1px solid ${hasAuth ? EMBRY.green + '44' : '#FF572244'}`,
                                  color: hasAuth ? EMBRY.green : '#FF5722',
                                }}>{hasAuth ? 'AUTH REQUIRED' : 'NO AUTH DETECTED'}</span>
                                {authDetail && authDetail !== 'true' && (
                                  <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 2, background: `${EMBRY.green}10`, border: `1px solid ${EMBRY.green}33`, color: EMBRY.green }}>{authDetail}</span>
                                )}
                                {tax?.cwe?.map(c => (
                                  <span key={c} style={{ fontSize: 8, padding: '2px 6px', borderRadius: 2, background: '#FF572210', border: '1px solid #FF572233', color: '#FF5722' }}>{c}</span>
                                ))}
                                {tax?.attack?.map(a => (
                                  <span key={a} style={{ fontSize: 8, padding: '2px 6px', borderRadius: 2, background: '#FF980010', border: '1px solid #FF980033', color: '#FF9800' }}>{a}</span>
                                ))}
                                {tax?.mind?.map(m => (
                                  <span key={m} style={{ fontSize: 8, padding: '2px 6px', borderRadius: 2, background: '#9C27B010', border: '1px solid #9C27B033', color: '#9C27B0' }}>{m}</span>
                                ))}
                              </div>
                            </div>

                            {/* Fuzzer summary */}
                            <div style={{ background: '#050a05', border: '1px solid #22c55e22', borderRadius: 3, padding: '4px 8px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 }}>
                                <div style={{ fontSize: 8, color: EMBRY.green, fontWeight: 700, textTransform: 'uppercase' }}>FUZZER TARGETS</div>
                                <button
                                  style={{ fontSize: 7, padding: '1px 6px', borderRadius: 2, cursor: 'pointer', background: '#0a1a0a', border: `1px solid ${EMBRY.green}44`, color: EMBRY.green }}
                                  onClick={() => {
                                    const structName = selectedNode.label.replace(/[^a-zA-Z0-9_]/g, '_')
                                    const params = paramList.map(p => `  ${p.type ?? 'uint8_t'} ${p.name};  // ${p.required === false ? 'optional' : 'required'}`).join('\n')
                                    const handlerComment = handlerList.length > 0 ? `// Handler: ${handlerList.join(', ')}\n` : ''
                                    const authComment = hasAuth ? `// Auth: ${authDetail || 'required'}\n` : '// Auth: none\n'
                                    const convComment = callingConv ? `// Calling convention: ${callingConv}\n` : ''
                                    const reqSchemas = payloadOut.map(e => `// REQ schema: ${e.target}`).join('\n')
                                    const rspSchemas = payloadIn.map(e => `// RSP schema: ${e.source}`).join('\n')
                                    const tmpl = `${handlerComment}${authComment}${convComment}${reqSchemas}${reqSchemas ? '\n' : ''}${rspSchemas}${rspSchemas ? '\n' : ''}typedef struct {\n${params || '  // no typed params extracted'}\n} ${structName}_t;\n`
                                    navigator.clipboard.writeText(tmpl).catch(() => {})
                                  }}
                                >COPY STRUCT</button>
                              </div>
                              <div style={{ fontSize: 8, fontFamily: 'JetBrains Mono, monospace', color: EMBRY.muted, display: 'flex', flexWrap: 'wrap', gap: '2px 10px' }}>
                                <span>{paramList.length} input{paramList.length !== 1 ? 's' : ''}</span>
                                {payloadOut.length > 0 && <span>{payloadOut.length} req schema{payloadOut.length !== 1 ? 's' : ''}</span>}
                                {payloadIn.length > 0 && <span>{payloadIn.length} rsp schema{payloadIn.length !== 1 ? 's' : ''}</span>}
                                {handlerList.length > 0 && <span>{handlerList.length} handler{handlerList.length !== 1 ? 's' : ''}</span>}
                                {containsCallers.length > 0 && <span>{containsCallers.length} caller{containsCallers.length !== 1 ? 's' : ''}</span>}
                                <span style={{ color: hasAuth ? '#ef444488' : EMBRY.green }}>{hasAuth ? 'auth-gated' : 'unauthenticated'}</span>
                                {callingConv && <span>conv: {callingConv}</span>}
                                <span
                                  style={{ color: EMBRY.green, cursor: 'pointer', textDecoration: 'underline' }}
                                  onClick={() => setChatInput(`Generate a fuzzer for the ${selectedNode.label} ${selectedNode.nodeType}. What are the parameter types, edge cases, and boundary values? How would you mutate inputs to find bugs?`)}
                                >→ ask AI</span>
                              </div>
                            </div>
                          </div>
                        )
                      })()}

                      {/* Row 6: Source pattern (if available) */}
                      {selectedNode.source_pattern && (
                        <div>
                          <div style={{ fontSize: 8, color: EMBRY.dim, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>SOURCE</div>
                          <pre style={{ fontSize: 8, color: '#a5b4fc', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'JetBrains Mono, monospace', background: '#050505', padding: 4, borderRadius: 2, border: `1px solid ${EMBRY.border}`, maxHeight: 60, overflow: 'auto' }}>
                            {selectedNode.source_pattern}
                          </pre>
                        </div>
                      )}

                      {/* Row 7: Full node metadata — _id, _key, binary_name, namespace, all extra fields */}
                      {(() => {
                        const fullDoc = data.allNodes.find(n => n._id === selectedNode.id) as any
                        if (!fullDoc) return null
                        // Show fields not already prominent in the summary
                        const shown = new Set(['description', 'source_pattern', 'fields', 'states', 'label', 'name'])
                        const metaRows: { key: string; value: string }[] = []
                        // Always front-and-center: document identity + provenance
                        if (fullDoc._id) metaRows.push({ key: '_id', value: fullDoc._id })
                        if (fullDoc._key) metaRows.push({ key: '_key', value: fullDoc._key })
                        if (fullDoc.binary_name) metaRows.push({ key: 'binary', value: fullDoc.binary_name })
                        if (fullDoc.namespace) metaRows.push({ key: 'namespace', value: fullDoc.namespace })
                        // Any other fields from the raw document not already displayed
                        for (const [k, v] of Object.entries(fullDoc)) {
                          if (k.startsWith('_') && k !== '_id' && k !== '_key') continue
                          if (shown.has(k) || ['binary_name', 'namespace', 'node_type', 'cluster', 'extraction_tier', 'confidence'].includes(k)) continue
                          if (v == null || (Array.isArray(v) && (v as any[]).length === 0)) continue
                          const strVal = typeof v === 'object' ? (() => { const s = JSON.stringify(v); return s.length > 120 ? s.slice(0, 120) + '…' : s })() : String(v)
                          metaRows.push({ key: k, value: strVal })
                        }
                        if (metaRows.length === 0) return null
                        return (
                          <div>
                            <div style={{ fontSize: 8, color: EMBRY.dim, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>NODE METADATA</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: '1px 8px', fontFamily: 'JetBrains Mono, monospace', fontSize: 9, background: '#050505', border: `1px solid ${EMBRY.border}`, borderRadius: 3, padding: '4px 8px' }}>
                              {metaRows.map(({ key, value }) => (
                                <>
                                  <span key={`k-${key}`} style={{ color: EMBRY.muted, paddingTop: 1 }}>{key}</span>
                                  <span key={`v-${key}`} style={{ color: key === '_id' || key === '_key' ? '#4a9eff' : key === 'binary' ? '#22d3ee' : key === 'namespace' ? '#9C27B0' : EMBRY.white, wordBreak: 'break-all' }}>{value}</span>
                                </>
                              ))}
                            </div>
                          </div>
                        )
                      })()}

                      {/* Bookmark */}
                      <button
                        onClick={() => {
                          fetch(`${API}/api/memory/learn`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              problem: `[${binaryName}] Bookmarked: ${selectedNode.label} (${selectedNode.nodeType})`,
                              solution: `${nodeExplanation || selectedNode.description || 'No explanation yet'}. Connections: ${allSelectedEdges.length}. Fields: ${selectedNode.fields?.join(', ') || 'none'}`,
                              tags: ['binary-explorer', 'bookmark', binaryName, selectedNode.nodeType],
                              scope: 'binary-analysis',
                            }),
                          }).then(() => alert('Bookmarked')).catch(() => alert('Failed to bookmark'))
                        }}
                        style={{
                          width: 'fit-content', padding: '3px 8px', fontSize: 8,
                          background: `${EMBRY.accent}15`, border: `1px solid ${EMBRY.accent}33`,
                          color: EMBRY.accent, borderRadius: 2, cursor: 'pointer',
                        }}
                      >★ Bookmark to Memory</button>
                    </div>
                  )}

                  {dataTab === 'connections' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      {/* Outgoing relationships (→) */}
                      {outgoingEdges.length > 0 && (
                        <div>
                          <div style={{ fontSize: 8, color: '#2196F3', fontWeight: 800, textTransform: 'uppercase', marginBottom: 4 }}>OUTGOING → ({outgoingEdges.length})</div>
                          {outgoingEdges.map((e, i) => (
                            <div key={i} onClick={() => onFeatureClick(e.target)}
                              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', cursor: 'pointer', borderRadius: 2, fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}
                              onMouseEnter={ev => (ev.currentTarget.style.background = '#0a0a0a')}
                              onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
                            >
                              <span style={{ color: '#2196F3' }}>→</span>
                              {e.targetType && <span style={{ width: 5, height: 5, borderRadius: '50%', background: NODE_TYPE_COLORS[e.targetType] ?? EMBRY.dim, flexShrink: 0 }} title={e.targetType} />}
                              <span style={{ color: EMBRY.white, fontWeight: 600 }}>{e.target}</span>
                              {e.targetType && <span style={{ fontSize: 7, color: EMBRY.muted }}>{e.targetType.replace('_', ' ')}</span>}
                              <span style={{ color: EDGE_COLORS[e.type] || EMBRY.muted, fontSize: 8, marginLeft: 'auto' }}>{e.type}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Incoming relationships (←) */}
                      {incomingEdges.length > 0 && (
                        <div>
                          <div style={{ fontSize: 8, color: '#FF9800', fontWeight: 800, textTransform: 'uppercase', marginBottom: 4 }}>INCOMING ← ({incomingEdges.length})</div>
                          {incomingEdges.map((e, i) => (
                            <div key={i} onClick={() => onFeatureClick(e.source)}
                              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px', cursor: 'pointer', borderRadius: 2, fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}
                              onMouseEnter={ev => (ev.currentTarget.style.background = '#0a0a0a')}
                              onMouseLeave={ev => (ev.currentTarget.style.background = 'transparent')}
                            >
                              <span style={{ color: '#FF9800' }}>←</span>
                              {e.sourceType && <span style={{ width: 5, height: 5, borderRadius: '50%', background: NODE_TYPE_COLORS[e.sourceType] ?? EMBRY.dim, flexShrink: 0 }} title={e.sourceType} />}
                              <span style={{ color: EMBRY.white, fontWeight: 600 }}>{e.source}</span>
                              {e.sourceType && <span style={{ fontSize: 7, color: EMBRY.muted }}>{e.sourceType.replace('_', ' ')}</span>}
                              <span style={{ color: EDGE_COLORS[e.type] || EMBRY.muted, fontSize: 8, marginLeft: 'auto' }}>{e.type}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {outgoingEdges.length === 0 && incomingEdges.length === 0 && (
                        <div style={{ fontSize: 9, color: EMBRY.muted, fontStyle: 'italic' }}>No connections</div>
                      )}
                    </div>
                  )}

                  {dataTab === 'ast' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {selectedNode.fields && selectedNode.fields.length > 0 && (
                        <div>
                          <div style={{ fontSize: 8, color: EMBRY.dim, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>PARAMETERS ({selectedNode.fields.length})</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                            {selectedNode.fields.map(f => (
                              <code key={f} onClick={() => onFeatureClick(f)} style={{ fontSize: 9, padding: '1px 4px', background: '#0d0d0d', border: `1px solid ${EMBRY.border}`, color: '#22d3ee', borderRadius: 2, fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer', borderBottom: '1px dotted rgba(34,211,238,0.3)' }}>{f}</code>
                            ))}
                          </div>
                        </div>
                      )}
                      {selectedNode.states && selectedNode.states.length > 0 && (
                        <div>
                          <div style={{ fontSize: 8, color: EMBRY.dim, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>STATES ({selectedNode.states.length})</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                            {selectedNode.states.map(s => (
                              <code key={s} onClick={() => onFeatureClick(s)} style={{ fontSize: 9, padding: '1px 4px', background: '#0d0d0d', border: `1px solid ${EMBRY.border}`, color: '#22d3ee', borderRadius: 2, fontFamily: 'JetBrains Mono, monospace', cursor: 'pointer', borderBottom: '1px dotted rgba(34,211,238,0.3)' }}>{s}</code>
                            ))}
                          </div>
                        </div>
                      )}
                      {selectedNode.source_pattern && (
                        <div>
                          <div style={{ fontSize: 8, color: EMBRY.dim, fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>SOURCE PATTERN</div>
                          <pre style={{ fontSize: 9, color: '#a5b4fc', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'JetBrains Mono, monospace', background: '#050505', padding: 8, border: `1px solid ${EMBRY.border}`, borderRadius: 2 }}>
                            {selectedNode.source_pattern}
                          </pre>
                        </div>
                      )}
                      {!selectedNode.fields?.length && !selectedNode.states?.length && !selectedNode.source_pattern && (
                        <div style={{ fontSize: 9, color: EMBRY.muted, fontStyle: 'italic' }}>No AST extractions for this node</div>
                      )}
                    </div>
                  )}

                  {dataTab === 'explain' && (
                    <div>
                      {nodeExplanationLoading && <div style={{ fontSize: 9, color: EMBRY.accent }}>Analyzing...</div>}
                      {nodeExplanation && <div style={{ fontSize: 11, lineHeight: 1.7 }}>{renderMarkdown(nodeExplanation, onFeatureClick)}</div>}
                      {!nodeExplanation && !nodeExplanationLoading && <div style={{ fontSize: 9, color: EMBRY.muted, fontStyle: 'italic' }}>Explanation will appear when node is selected</div>}
                    </div>
                  )}

                  {dataTab === 'code' && (
                    <div>
                      {/* Three-level code view: Assembly → Decompiled C → Python pseudocode */}
                      <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
                        {(['assembly', 'decompiled', 'pseudocode'] as const).map(t => (
                          <button key={t} onClick={() => setCodeViewTab(t)}
                            style={{
                              fontSize: 9, padding: '3px 10px', border: `1px solid ${codeViewTab === t ? EMBRY.accent + '66' : EMBRY.border}`,
                              background: codeViewTab === t ? `${EMBRY.accent}15` : 'transparent',
                              color: codeViewTab === t ? EMBRY.accent : EMBRY.dim, borderRadius: 2, cursor: 'pointer',
                            }}>
                            {t === 'assembly' ? 'ASM' : t === 'decompiled' ? 'C (decompiled)' : 'Python'}
                          </button>
                        ))}
                      </div>

                      {codeViewTab === 'assembly' && (
                        <div>
                          {selectedNode?.source_pattern ? (
                            <pre style={{ fontSize: 9, color: '#a5b4fc', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'JetBrains Mono, monospace', background: '#050505', padding: 8, border: `1px solid ${EMBRY.border}`, borderRadius: 2, maxHeight: 300, overflow: 'auto' }}>
                              {selectedNode.source_pattern}
                            </pre>
                          ) : (
                            <div style={{ fontSize: 9, color: EMBRY.muted, fontStyle: 'italic' }}>No assembly data available. Run /analyze-elf to extract.</div>
                          )}
                        </div>
                      )}

                      {codeViewTab === 'decompiled' && (
                        <div>
                          {selectedNode?.source_pattern ? (
                            <pre style={{ fontSize: 9, color: '#86efac', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'JetBrains Mono, monospace', background: '#050505', padding: 8, border: `1px solid ${EMBRY.border}`, borderRadius: 2, maxHeight: 300, overflow: 'auto' }}>
                              {`// Decompiled representation of: ${selectedNode.label}\n// Type: ${selectedNode.nodeType}\n\n${selectedNode.source_pattern || '// No source data available'}`}
                            </pre>
                          ) : (
                            <div style={{ fontSize: 9, color: EMBRY.muted, fontStyle: 'italic' }}>No decompiled source available. Run /analyze-elf with Ghidra backend.</div>
                          )}
                        </div>
                      )}

                      {codeViewTab === 'pseudocode' && (
                        <div>
                          {pseudocodeLoading && <div style={{ fontSize: 9, color: EMBRY.accent }}>Generating Python pseudocode...</div>}
                          {pseudocode && (
                            <pre style={{ fontSize: 9, color: '#fde68a', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'JetBrains Mono, monospace', background: '#050505', padding: 8, border: `1px solid ${EMBRY.border}`, borderRadius: 2, maxHeight: 300, overflow: 'auto' }}>
                              {pseudocode}
                            </pre>
                          )}
                          {!pseudocode && !pseudocodeLoading && <div style={{ fontSize: 9, color: EMBRY.muted, fontStyle: 'italic' }}>Select a node to generate Python pseudocode</div>}
                        </div>
                      )}
                    </div>
                  )}

                  {dataTab === 'table' && (() => {
                    // Sortable function table: name, type, address, size, namespace, refs, CWE, ATT&CK, annotation
                    const ALL_COLS: { key: string; label: string; width: number }[] = [
                      { key: 'label',       label: 'Name',      width: 160 },
                      { key: 'nodeType',    label: 'Type',      width: 90  },
                      { key: 'address',     label: 'Address',   width: 84  },
                      { key: 'size',        label: 'Size',      width: 52  },
                      { key: 'namespace',   label: 'Namespace', width: 100 },
                      { key: 'connections', label: 'Refs',      width: 44  },
                      { key: 'cwe',         label: 'CWE',       width: 90  },
                      { key: 'attack',      label: 'ATT&CK',    width: 90  },
                      { key: '_annotation', label: 'Note',      width: 120 },
                    ]
                    const nodeWithDeg = data.graphNodes.map(n => {
                      const tax = taxonomyMap.get(n.id)
                      const raw = data.allNodes.find(r => r._id === n.id)
                      return {
                        ...n,
                        address:     (raw as any)?.address   ?? (raw as any)?.va       ?? '',
                        size:        (raw as any)?.size      ?? (raw as any)?.byte_size ?? '',
                        namespace:   (raw as any)?.namespace ?? (raw as any)?.module    ?? n.cluster,
                        connections: data.allEdges.filter(e => e._from === n.id || e._to === n.id).length,
                        cwe:         tax?.cwe?.join(', ')    || '',
                        attack:      tax?.attack?.join(', ') || '',
                        _annotation: tableAnnotations[n.id]  ?? '',
                      }
                    })
                    const q = tableSearch.toLowerCase()
                    const filtered = nodeWithDeg
                      .filter(n => !q || n.label.toLowerCase().includes(q) || n.nodeType.includes(q) || String(n.namespace).toLowerCase().includes(q) || n.cwe.toLowerCase().includes(q) || n.attack.toLowerCase().includes(q))
                      .sort((a, b) => {
                        const va = (a as any)[tableSortKey] ?? ''
                        const vb = (b as any)[tableSortKey] ?? ''
                        const cmp = typeof va === 'number' ? va - (vb as number) : String(va).localeCompare(String(vb))
                        return tableSortAsc ? cmp : -cmp
                      })
                    const visibleCols = ALL_COLS.filter(c => tableVisibleCols.has(c.key))
                    const sortHeader = (col: typeof ALL_COLS[0]) => (
                      <th key={col.key}
                        onClick={() => {
                          if (col.key === '_annotation') return
                          const k = col.key as typeof tableSortKey
                          if (tableSortKey === k) setTableSortAsc(!tableSortAsc); else { setTableSortKey(k); setTableSortAsc(true) }
                        }}
                        style={{ padding: '4px 6px', fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: tableSortKey === col.key ? EMBRY.accent : EMBRY.dim, cursor: col.key === '_annotation' ? 'default' : 'pointer', textAlign: 'left', borderBottom: `1px solid ${EMBRY.border}`, whiteSpace: 'nowrap', width: col.width }}>
                        {col.label}{tableSortKey === col.key ? (tableSortAsc ? ' \u25b2' : ' \u25bc') : ''}
                      </th>
                    )
                    const exportCsv = () => {
                      const header = visibleCols.map(c => `"${c.label}"`).join(',')
                      const rows = filtered.map(n => visibleCols.map(c => `"${String((n as any)[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
                      const blob = new Blob([[header, ...rows].join('\n')], { type: 'text/csv' })
                      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${binaryName}-functions.csv`; a.click()
                    }
                    return (
                      <div>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <input value={tableSearch} onChange={e => setTableSearch(e.target.value)}
                            placeholder="Filter name, namespace, CWE, ATT&CK..." style={{ flex: 1, minWidth: 120, background: '#0a0a0a', border: `1px solid ${EMBRY.border}`, borderRadius: 2, padding: '3px 8px', color: EMBRY.white, fontSize: 10, outline: 'none', fontFamily: 'JetBrains Mono, monospace' }} />
                          <span style={{ fontSize: 8, color: EMBRY.muted }}>{filtered.length}/{nodeWithDeg.length}</span>
                          {taxonomyLoading && <span style={{ fontSize: 8, color: EMBRY.accent }}>Loading...</span>}
                          <button onClick={() => setTableShowColPicker(v => !v)} style={{ fontSize: 8, padding: '2px 7px', background: tableShowColPicker ? `${EMBRY.accent}20` : '#111', border: `1px solid ${EMBRY.border}`, color: tableShowColPicker ? EMBRY.accent : EMBRY.dim, borderRadius: 2, cursor: 'pointer' }}>COLUMNS</button>
                          <button onClick={exportCsv} style={{ fontSize: 8, padding: '2px 7px', background: '#111', border: `1px solid ${EMBRY.border}`, color: EMBRY.dim, borderRadius: 2, cursor: 'pointer' }}>EXPORT CSV</button>
                        </div>
                        {tableShowColPicker && (
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6, padding: '4px 8px', background: '#080808', border: `1px solid ${EMBRY.border}`, borderRadius: 2 }}>
                            {ALL_COLS.map(c => (
                              <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 8, color: tableVisibleCols.has(c.key) ? EMBRY.white : EMBRY.muted, cursor: 'pointer', userSelect: 'none' }}>
                                <input type="checkbox" checked={tableVisibleCols.has(c.key)} onChange={() => setTableVisibleCols(prev => { const s = new Set(prev); s.has(c.key) ? s.delete(c.key) : s.add(c.key); return s })} style={{ accentColor: EMBRY.accent, width: 10, height: 10 }} />
                                {c.label}
                              </label>
                            ))}
                          </div>
                        )}
                        <div style={{ maxHeight: 300, overflow: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9, fontFamily: 'JetBrains Mono, monospace', tableLayout: 'fixed' }}>
                            <thead><tr>{visibleCols.map(c => sortHeader(c))}</tr></thead>
                            <tbody>
                              {filtered.slice(0, 200).map(n => (
                                <tr key={n.id}
                                  onClick={() => onFeatureClick(n.label)}
                                  style={{ cursor: 'pointer', borderBottom: `1px solid ${EMBRY.border}`, background: n.id === selectedNode?.id ? `${EMBRY.accent}15` : 'transparent' }}
                                  onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
                                  onMouseLeave={e => (e.currentTarget.style.background = n.id === selectedNode?.id ? `${EMBRY.accent}15` : 'transparent')}
                                >
                                  {visibleCols.map(c => {
                                    const val = (n as any)[c.key] ?? ''
                                    if (c.key === 'label')       return <td key={c.key} style={{ padding: '3px 6px', color: '#22d3ee', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(val)}>{val}</td>
                                    if (c.key === 'nodeType')    return <td key={c.key} style={{ padding: '3px 6px', whiteSpace: 'nowrap' }}><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: NODE_TYPE_COLORS[n.nodeType] ?? EMBRY.dim, flexShrink: 0, display: 'inline-block' }} />{n.nodeType.replace(/_/g, ' ')}</span></td>
                                    if (c.key === 'address')     return <td key={c.key} style={{ padding: '3px 6px', color: '#a78bfa', fontVariantNumeric: 'tabular-nums' }}>{val !== '' ? (typeof val === 'number' ? `0x${val.toString(16).padStart(8, '0')}` : val) : '\u2014'}</td>
                                    if (c.key === 'size')        return <td key={c.key} style={{ padding: '3px 6px', color: EMBRY.dim, textAlign: 'right' }}>{val !== '' ? val : '\u2014'}</td>
                                    if (c.key === 'namespace')   return <td key={c.key} style={{ padding: '3px 6px', color: EMBRY.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(val)}>{val || '\u2014'}</td>
                                    if (c.key === 'connections') return <td key={c.key} style={{ padding: '3px 6px', fontWeight: n.connections > 10 ? 700 : 400, color: n.connections > 10 ? EMBRY.white : EMBRY.dim, textAlign: 'right' }}>{n.connections}</td>
                                    if (c.key === 'cwe')         return <td key={c.key} style={{ padding: '3px 6px', color: '#ef4444', fontSize: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(val)}>{val || '\u2014'}</td>
                                    if (c.key === 'attack')      return <td key={c.key} style={{ padding: '3px 6px', color: '#f97316', fontSize: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={String(val)}>{val || '\u2014'}</td>
                                    if (c.key === '_annotation') return (
                                      <td key={c.key} style={{ padding: '1px 4px' }} onClick={e => e.stopPropagation()}>
                                        <input value={tableAnnotations[n.id] ?? ''} onChange={e => setTableAnnotations(prev => ({ ...prev, [n.id]: e.target.value }))}
                                          placeholder="note..." style={{ width: '100%', background: 'transparent', border: '1px solid transparent', borderRadius: 2, padding: '1px 4px', color: EMBRY.white, fontSize: 8, outline: 'none', fontFamily: 'JetBrains Mono, monospace' }}
                                          onFocus={e => (e.target.style.border = `1px solid ${EMBRY.accent}66`)}
                                          onBlur={e => (e.target.style.border = '1px solid transparent')} />
                                      </td>
                                    )
                                    return <td key={c.key} style={{ padding: '3px 6px', color: EMBRY.dim }}>{val}</td>
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })()}

                  {dataTab === 'raw' && (() => {
                    // Show full ArangoDB document, not the stripped D3 node
                    const fullDoc = data.allNodes.find(n => n._id === selectedNode.id)
                    const jsonText = JSON.stringify(fullDoc ?? selectedNode, null, 2)
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ fontSize: 8, color: EMBRY.muted, fontFamily: 'JetBrains Mono, monospace' }}>
                            {fullDoc ? 'ArangoDB document' : 'graph node (full doc not loaded)'} · {Object.keys(fullDoc ?? selectedNode).length} fields
                          </span>
                          <button
                            onClick={() => navigator.clipboard.writeText(jsonText).catch(() => {})}
                            style={{ marginLeft: 'auto', fontSize: 8, padding: '2px 8px', background: `${EMBRY.accent}15`, border: `1px solid ${EMBRY.accent}33`, color: EMBRY.accent, borderRadius: 2, cursor: 'pointer' }}
                          >COPY</button>
                        </div>
                        <pre style={{ fontSize: 9, color: EMBRY.dim, background: '#020202', padding: 8, border: `1px solid ${EMBRY.border}`, overflowX: 'auto', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'JetBrains Mono, monospace' }}>
                          {jsonText}
                        </pre>
                      </div>
                    )
                  })()}
                </div>
              </>
            )}
            </div>
          </div>
          {/* Horizontal resize handle */}
          <div
            style={{ width: 4, cursor: 'col-resize', background: 'transparent', borderLeft: `1px solid ${EMBRY.border}`, flexShrink: 0 }}
            onMouseDown={(e) => {
              e.preventDefault()
              const startX = e.clientX
              const startW = leftPaneWidth
              const container = (e.target as HTMLElement).parentElement
              const totalW = container?.getBoundingClientRect().width ?? 1000
              const onMove = (ev: MouseEvent) => {
                const delta = ev.clientX - startX
                const newPct = Math.max(30, Math.min(80, startW + (delta / totalW) * 100))
                setLeftPaneWidth(newPct)
              }
              const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
              window.addEventListener('mousemove', onMove)
              window.addEventListener('mouseup', onUp)
            }}
          />

          {/* ═══ RIGHT: CHAT + JOURNAL PANE ═══ */}
          <div style={{ ...styles.convPane, flex: `1 1 0%`, display: 'flex', flexDirection: 'column' }}>

              {/* Right pane header: tab switcher + actions */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 0, padding: '0 12px', background: '#060606', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
                {/* Tab buttons */}
                <button
                  onClick={() => setRightTab('chat')}
                  title="Analysis Chat"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '7px 12px', background: 'transparent', border: 'none',
                    borderBottom: rightTab === 'chat' ? `2px solid ${EMBRY.accent}` : '2px solid transparent',
                    color: rightTab === 'chat' ? EMBRY.accent : EMBRY.dim,
                    fontSize: 10, fontWeight: rightTab === 'chat' ? 800 : 400,
                    cursor: 'pointer', flexShrink: 0,
                  }}
                >
                  <MessageSquare size={12} />
                  {analysisMode === 'beginner' ? 'CHAT — START HERE' : 'NL ANALYSIS'}
                </button>
                <button
                  onClick={() => setRightTab('journal')}
                  title="Investigation Journal"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '7px 12px', background: 'transparent', border: 'none',
                    borderBottom: rightTab === 'journal' ? `2px solid ${EMBRY.accent}` : '2px solid transparent',
                    color: rightTab === 'journal' ? EMBRY.accent : EMBRY.dim,
                    fontSize: 10, fontWeight: rightTab === 'journal' ? 800 : 400,
                    cursor: 'pointer', flexShrink: 0,
                    position: 'relative' as const,
                  }}
                >
                  <History size={12} />
                  JOURNAL
                  {journalSteps.length > 0 && (
                    <span style={{
                      fontSize: 8, fontWeight: 700,
                      background: EMBRY.accent, color: '#000',
                      borderRadius: 8, padding: '0px 4px',
                      fontFamily: 'JetBrains Mono, monospace',
                    }}>{journalSteps.length}</span>
                  )}
                </button>
                <div style={{ flex: 1 }} />
                {/* Beginner / Investigator mode toggle */}
                <div style={{ display: 'flex', gap: 1, marginRight: 4, alignItems: 'center' }}>
                  {(['beginner', 'investigator'] as const).map(mode => (
                    <button key={mode} onClick={() => setAnalysisMode(mode)} style={{
                      fontSize: 8, fontWeight: analysisMode === mode ? 800 : 400,
                      padding: '2px 6px', borderRadius: 2, cursor: 'pointer', border: 'none',
                      background: analysisMode === mode ? `${EMBRY.accent}20` : 'transparent',
                      color: analysisMode === mode ? EMBRY.accent : EMBRY.dim,
                      textTransform: 'uppercase',
                    }}>{mode === 'beginner' ? 'guided' : 'expert'}</button>
                  ))}
                </div>
                {/* Actions shown for whichever tab is active */}
                {rightTab === 'chat' && chatMessages.length > 0 && (
                  <>
                    <button onClick={() => {
                      // Save session checkpoint to /memory (includes journal)
                      const sessionData = {
                        binary: binaryName,
                        messages: chatMessages.map(m => ({ role: m.role, content: m.content.substring(0, 200), feedback: m.feedback })),
                        sceneSize: sceneNodeIds.size,
                        selectedNode: selectedNode?.label,
                        breadcrumbs: breadcrumbs.map(b => b.label),
                        journalSteps: journalSteps.map(s => ({ ...s, snapshot: undefined })), // strip snapshots for size
                        timestamp: new Date().toISOString(),
                      }
                      fetch(`${API}/api/memory/learn`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          problem: `[session:${binaryName}] ${chatMessages.filter(m => m.role === 'user').slice(-1)[0]?.content?.substring(0, 80) || 'exploration session'}`,
                          solution: JSON.stringify(sessionData),
                          tags: ['binary-explorer-session', binaryName, 'checkpoint'],
                          scope: 'binary-explorer',
                        }),
                      }).then(() => alert('Session saved')).catch(() => alert('Save failed'))
                    }} style={{
                      fontSize: 8, padding: '2px 8px', background: `${EMBRY.accent}15`,
                      border: `1px solid ${EMBRY.accent}33`, color: EMBRY.accent,
                      borderRadius: 2, cursor: 'pointer', fontWeight: 600,
                    }}>SAVE SESSION</button>
                    <button onClick={() => setChatMessages([])} style={{
                      fontSize: 8, padding: '2px 8px', background: 'transparent',
                      border: `1px solid ${EMBRY.border}`, color: EMBRY.dim,
                      borderRadius: 2, cursor: 'pointer', marginLeft: 4,
                    }}>CLEAR CHAT</button>
                  </>
                )}
              </div>

              {/* ── JOURNAL TAB ── */}
              {rightTab === 'journal' && (
                <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
                  <InvestigationJournal
                    steps={journalSteps}
                    onReplay={handleJournalReplay}
                    onDelete={handleJournalDelete}
                    onAddNote={handleJournalNote}
                  />
                </div>
              )}

              {/* ── CHAT TAB ── */}
              {rightTab === 'chat' && <>

              {/* Breadcrumbs Trail — show last 6, truncate from left */}
              {breadcrumbs.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px', background: '#080808', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0, overflow: 'hidden', maxHeight: 28 }}>
                  <span style={{ fontSize: 8, color: EMBRY.dim, fontWeight: 800, flexShrink: 0 }}>⏱</span>
                  {breadcrumbs.length > 6 && <span style={{ fontSize: 8, color: EMBRY.muted, flexShrink: 0 }}>…</span>}
                  {breadcrumbs.slice(-6).map((b, i, arr) => (
                    <div key={`${b.id}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                      <span
                        onClick={() => onNodeClick(b)}
                        tabIndex={0} role="button" aria-label={`Go back to ${b.label}`}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onNodeClick(b) } }}
                        style={{
                          fontSize: 9, cursor: 'pointer', whiteSpace: 'nowrap',
                          color: b.id === selectedNode?.id ? EMBRY.accent : EMBRY.white,
                          fontWeight: b.id === selectedNode?.id ? 800 : 400,
                          fontFamily: 'JetBrains Mono, monospace',
                          maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis',
                        }}
                      >{b.label}</span>
                      {i < arr.length - 1 && <span style={{ color: EMBRY.muted, fontSize: 8 }}>›</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* Binary context strip — visible during active conversation */}
              {chatMessages.length > 0 && (() => {
                const m = binaryMetas[binaryName]
                return (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: '#07070a', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 9, fontFamily: 'JetBrains Mono, monospace', color: EMBRY.accent, fontWeight: 800 }}>{binaryName}</span>
                    {m && (m.format || m.arch) && <span style={{ fontSize: 9, color: EMBRY.dim }}>{[m.format, m.arch].filter(Boolean).join(' · ')}</span>}
                    {m?.stripped && <span style={{ fontSize: 8, color: '#ef4444', fontWeight: 700 }}>STRIPPED</span>}
                    {m?.pie && <span style={{ fontSize: 8, color: '#22c55e', fontWeight: 700 }}>PIE</span>}
                    {m?.relro && <span style={{ fontSize: 8, color: '#3b82f6' }}>{m.relro}</span>}
                    {typeof m?.importCount === 'number' && <span style={{ fontSize: 8, color: EMBRY.muted }}>{m.importCount} imports</span>}
                    {m?.entryPoint && <span style={{ fontSize: 8, color: EMBRY.muted, fontFamily: 'JetBrains Mono, monospace' }}>ep:{m.entryPoint}</span>}
                    <div style={{ flex: 1 }} />
                    <span style={{ fontSize: 8, color: EMBRY.muted }}>{data.stats.totalNodes} features · {data.stats.totalEdges} edges</span>
                  </div>
                )
              })()}

              {/* Chat Thread */}
              <div ref={chatScrollRef} className="modern-scrollbar" style={styles.chatThread}>
                {chatMessages.length === 0 && !selectedNode && (() => {
                  // Generate suggested queries from actual binary data
                  const namespaces = data.graphNodes.filter(n => n.nodeType === 'namespace').map(n => n.label)
                  const stateMachines = data.graphNodes.filter(n => n.nodeType === 'state_machine').map(n => n.label)
                  const topRpcs = data.graphNodes
                    .filter(n => n.nodeType === 'rpc')
                    .map(n => ({ label: n.label, deg: data.allEdges.filter(e => e._from === n.id || e._to === n.id).length }))
                    .sort((a, b) => b.deg - a.deg)
                    .slice(0, 3)
                  // Suggestions as [text, isEntity] pairs for highlighting
                  type Seg = { text: string; entity?: boolean }
                  const suggestions: { segments: Seg[]; raw: string }[] = []
                  const q = (segs: Seg[]) => suggestions.push({ segments: segs, raw: segs.map(s => s.text).join('') })
                  if (analysisMode === 'investigator') {
                    // RE workflow queries — domain-specific, actionable
                    q([{text:`Find dangerous sinks in `},{text:binaryName,entity:true},{text:` (gets, strcpy, recv, system) — which are reachable from user input?`}])
                    q([{text:`Find all functions in `},{text:binaryName,entity:true},{text:` that process network input`}])
                    q([{text:`Which file parser entry points in `},{text:binaryName,entity:true},{text:` lack bounds checking on input size?`}])
                    q([{text:`Show obfuscated or high-entropy functions in `},{text:binaryName,entity:true}])
                    q([{text:`What anti-debugging or anti-analysis techniques does `},{text:binaryName,entity:true},{text:` use?`}])
                    q([{text:`Find cryptographic routines and key material handling in `},{text:binaryName,entity:true}])
                    if (namespaces.length > 0) q([{text:'What is the full call graph rooted at '},{text:namespaces[0],entity:true},{text:'?'}])
                    if (topRpcs[0]) q([{text:'What external inputs reach '},{text:topRpcs[0].label,entity:true},{text:' and how are they validated?'}])
                    if (stateMachines[0]) q([{text:'Identify reachable states from '},{text:stateMachines[0],entity:true},{text:' and flag impossible transitions'}])
                    q([{text:`Which functions in `},{text:binaryName,entity:true},{text:` manipulate strings without bounds checking?`}])
                  } else {
                    if (namespaces.length >= 2) q([{text:'How do '},{text:namespaces[0],entity:true},{text:' and '},{text:namespaces[1],entity:true},{text:' interact?'}])
                    if (topRpcs[0]) q([{text:'What does '},{text:topRpcs[0].label,entity:true},{text:' do?'}])
                    if (stateMachines[0]) q([{text:'Trace the '},{text:stateMachines[0],entity:true},{text:' state machine'}])
                    if (namespaces.length > 0) q([{text:'What is the attack surface of '},{text:namespaces[0],entity:true},{text:'?'}])
                    if (topRpcs[1]) q([{text:'How does '},{text:topRpcs[1].label,entity:true},{text:' connect to '},{text:topRpcs[2]?.label||namespaces[0],entity:true},{text:'?'}])
                    q([{text:'What are the core schemas in '},{text:binaryName,entity:true},{text:'?'}])
                  }
                  return (
                    <div style={{ padding: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 900, color: EMBRY.white, marginBottom: 4 }}>{binaryName.toUpperCase()}</div>
                      <div style={{ fontSize: 9, color: EMBRY.dim, marginBottom: analysisMode === 'investigator' ? 6 : 12 }}>
                        {data.stats.totalNodes} features · {namespaces.length} namespaces · {stateMachines.length} state machines
                      </div>
                      {analysisMode === 'investigator' && (
                        <div style={{ fontSize: 9, color: EMBRY.accent, marginBottom: 12, fontFamily: 'JetBrains Mono, monospace', opacity: 0.7 }}>
                          NL interface · domain-aware · complements scripting
                        </div>
                      )}
                      {/* Beginner guided path */}
                      {analysisMode === 'beginner' && (
                        <div style={{ marginBottom: 12, padding: '8px 10px', background: `${EMBRY.accent}08`, border: `1px solid ${EMBRY.accent}22`, borderRadius: 4 }}>
                          <div style={{ fontSize: 9, color: EMBRY.accent, fontWeight: 800, marginBottom: 2 }}>Start here — no jargon needed</div>
                          <div style={{ fontSize: 9, color: EMBRY.dim, marginBottom: 8, lineHeight: '1.4' }}>Just ask in plain English. Click a question or type your own.</div>
                          {[
                            { step: 1, label: 'What does this program do?', query: `What does ${binaryName} do? Explain it in plain English.` },
                            { step: 2, label: 'How is it structured inside?', query: `What are the main components of ${binaryName}? Explain simply.` },
                            { step: 3, label: 'Where could this break or be attacked?', query: `What is the attack surface of ${binaryName}? Explain in plain English.` },
                          ].map(g => (
                            <div key={g.step} onClick={() => { setChatInput(''); sendChat(g.query) }}
                              style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 8px', cursor: 'pointer', borderRadius: 3, marginBottom: 2, transition: 'background 0.15s' }}
                              onMouseEnter={e => (e.currentTarget.style.background = `${EMBRY.accent}15`)}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              <span style={{ fontSize: 16, fontWeight: 900, color: EMBRY.accent, width: 20, textAlign: 'center' }}>{g.step}</span>
                              <span style={{ fontSize: 10, color: EMBRY.white }}>{g.label}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {/* Investigator RE workflow path */}
                      {analysisMode === 'investigator' && (
                        <div style={{ marginBottom: 12, padding: '8px 10px', background: '#0a0a0a', border: `1px solid ${EMBRY.border}`, borderRadius: 4 }}>
                          <div style={{ fontSize: 8, fontWeight: 800, color: EMBRY.dim, marginBottom: 6, letterSpacing: '0.08em' }}>RE WORKFLOW</div>
                          {[
                            { label: 'Find interesting functions', query: `List all functions in ${binaryName} that call dangerous libc sinks (gets, strcpy, recv, read, system, exec, popen, sprintf). Which are reachable from user input?` },
                            { label: 'Network attack surface', query: `Find all functions in ${binaryName} that receive or parse network input. What validation is missing? Are there format string bugs or buffer overflows?` },
                            { label: 'File parser entry points', query: `Which functions in ${binaryName} open or parse files? Trace the input path from fopen/read to memory. Where could a malformed file trigger a bug?` },
                            { label: 'Deobfuscation pass', query: `Identify control flow flattening, opaque predicates, or dead code in ${binaryName}. Which functions look obfuscated?` },
                            { label: 'Crypto & key handling', query: `What cryptographic routines are present in ${binaryName}? Locate key generation, IV reuse, or weak algorithm usage.` },
                            { label: 'Taint & data-flow trace', query: `Trace all data flows from external input sources to memory write operations in ${binaryName}. Flag functions with missing bounds checks — replaces manual xref scripting.` },
                          ].map(g => (
                            <div key={g.label} onClick={() => { setChatInput(''); sendChat(g.query) }}
                              style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 8px', cursor: 'pointer', borderRadius: 3, marginBottom: 4, transition: 'background 0.15s', border: `1px solid ${EMBRY.border}` }}
                              onMouseEnter={e => (e.currentTarget.style.background = `${EMBRY.accent}12`)}
                              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                            >
                              <span style={{ fontSize: 8, fontFamily: 'JetBrains Mono, monospace', color: EMBRY.accent, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{g.label}</span>
                              <span style={{ fontSize: 9, color: EMBRY.dim, lineHeight: '1.4', fontStyle: 'italic' }}>{g.query}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ fontSize: 8, color: EMBRY.dim, marginBottom: 6, fontWeight: 800 }}>{analysisMode === 'investigator' ? 'RE QUERY TEMPLATES' : 'SUGGESTED QUERIES'}</div>
                      {suggestions.map((s, si) => (
                        <div key={si} onClick={() => { setChatInput(s.raw); setTimeout(() => { setChatInput(''); sendChat(s.raw) }, 50) }} tabIndex={0} role="button" aria-label={s.raw} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setChatInput(''); sendChat(s.raw) } }} style={{ fontSize: 10, color: EMBRY.dim, padding: '6px 10px', background: `${EMBRY.accent}08`, border: `1px solid ${EMBRY.accent}22`, borderRadius: 4, cursor: 'pointer', marginBottom: 4, transition: 'background 0.15s' }} onMouseEnter={e => (e.currentTarget.style.background = `${EMBRY.accent}18`)} onMouseLeave={e => (e.currentTarget.style.background = `${EMBRY.accent}08`)}>
                          {s.segments.map((seg, j) => seg.entity
                            ? <code key={j} style={{ color: '#22d3ee', background: '#0a1628', padding: '1px 4px', borderRadius: 3, fontSize: 10, fontFamily: 'JetBrains Mono, monospace', fontWeight: 600 }}>{seg.text}</code>
                            : <span key={j} style={{ color: EMBRY.accent }}>{seg.text}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )
                })()}
                {chatMessages.length === 0 && selectedNode && (
                  <div style={{ padding: 16, color: EMBRY.dim, fontSize: 11 }}>
                    <div style={{ textAlign: 'center', marginBottom: 8 }}>
                      Ask anything about <strong style={{ color: EMBRY.white }}>{selectedNode.label}</strong>
                    </div>
                    {(analysisMode === 'investigator' ? [
                      `What does ${selectedNode.label} do? Walk me through the logic.`,
                      `What callers reach ${selectedNode.label} and what arguments do they pass?`,
                      `Does ${selectedNode.label} process untrusted input? Where could it be exploited?`,
                      `Does ${selectedNode.label} call any dangerous sinks (gets, strcpy, recv, system)?`,
                      `Are there obfuscation patterns in ${selectedNode.label}?`,
                    ] : [
                      `What does ${selectedNode.label} do?`,
                      `Explain ${selectedNode.label} in plain English.`,
                      `What calls ${selectedNode.label}?`,
                    ]).map(q => (
                      <div key={q} onClick={() => sendChat(q)}
                        style={{ fontSize: 10, color: EMBRY.accent, padding: '4px 10px', background: `${EMBRY.accent}08`, border: `1px solid ${EMBRY.accent}22`, borderRadius: 4, cursor: 'pointer', marginBottom: 4, transition: 'background 0.15s' }}
                        onMouseEnter={e => (e.currentTarget.style.background = `${EMBRY.accent}18`)}
                        onMouseLeave={e => (e.currentTarget.style.background = `${EMBRY.accent}08`)}
                      >{q}</div>
                    ))}
                  </div>
                )}
                {chatMessages.map((m, i) => (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div style={m.role === 'user' ? styles.userMsg : styles.assistantMsg}>
                      {m.role === 'assistant' ? renderMarkdown(m.content, onFeatureClick) : m.content}
                      {/* Collapsible QuerySpec for UI commands */}
                      {m._querySpec && (
                        <details style={{ marginTop: 6 }}>
                          <summary style={{ fontSize: 9, color: EMBRY.dim, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace' }}>QuerySpec</summary>
                          <pre style={{ fontSize: 8, color: EMBRY.dim, background: '#050505', padding: 6, margin: '4px 0 0', borderRadius: 2, overflowX: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'JetBrains Mono, monospace', border: `1px solid ${EMBRY.border}` }}>
                            {JSON.stringify(m._querySpec, null, 2)}
                          </pre>
                        </details>
                      )}
                      {/* TrustGraph-style Explain Pipeline */}
                      {m._explain && m._explain.length > 0 && (
                        <details style={{ marginTop: 6 }}>
                          <summary style={{ fontSize: 9, color: EMBRY.accent, cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', fontWeight: 700 }}>
                            Explain Pipeline ({m._explain.length} steps)
                          </summary>
                          <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {m._explain.map((step, si) => {
                              const stepColors: Record<string, string> = {
                                question: '#F59E0B', grounding: '#FF9800', exploration: '#2196F3', intent: '#9C27B0', answer: EMBRY.green,
                              }
                              const color = stepColors[step.type] || EMBRY.dim
                              return (
                                <div key={si} style={{
                                  display: 'flex', gap: 6, alignItems: 'flex-start',
                                  padding: '4px 8px', borderLeft: `2px solid ${color}`,
                                  background: `${color}08`, borderRadius: '0 3px 3px 0',
                                }}>
                                  <span style={{ fontSize: 10, fontWeight: 900, color, minWidth: 14, textAlign: 'center', fontFamily: 'JetBrains Mono, monospace' }}>{si + 1}</span>
                                  <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: 8, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{step.label}</div>
                                    {step.detail && <div style={{ fontSize: 9, color: EMBRY.dim, marginTop: 1 }}>{step.detail}</div>}
                                    {step.chips && step.chips.length > 0 && (
                                      <div style={{ display: 'flex', gap: 3, marginTop: 3, flexWrap: 'wrap' }}>
                                        {step.chips.map((chip, ci) => (
                                          <span key={ci} onClick={() => onFeatureClick(chip.label)} style={{
                                            fontSize: 8, padding: '1px 6px', borderRadius: 3, cursor: 'pointer',
                                            background: `${chip.color}20`, border: `1px solid ${chip.color}44`, color: chip.color,
                                            fontFamily: 'JetBrains Mono, monospace', fontWeight: 600,
                                          }}>{chip.label}</span>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </details>
                      )}
                    </div>
                    {/* Thumbs up/down on all assistant messages */}
                    {m.role === 'assistant' && (
                      <div style={{ display: 'flex', gap: 4, marginTop: 3, paddingLeft: 4 }}>
                        <button
                          onClick={() => {
                            const newFb = m.feedback === 'up' ? null : 'up'
                            setChatMessages(prev => prev.map((msg, j) => j === i ? { ...msg, feedback: newFb } : msg))
                            if (newFb === 'up') {
                              const userMsg = chatMessages.slice(0, i).reverse().find(x => x.role === 'user')
                              if (userMsg) {
                                fetch(`${API}/api/memory/learn`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    problem: userMsg.content,
                                    solution: m._querySpec ? JSON.stringify(m._querySpec) : m.content.substring(0, 500),
                                    tags: ['binary-explorer-feedback', 'positive', binaryName, ...(m._querySpec ? ['intent-training-v2'] : [])],
                                    scope: 'binary-explorer',
                                  }),
                                }).catch(() => {})
                              }
                            }
                          }}
                          style={{
                            fontSize: 10, padding: '0 5px', background: 'transparent', lineHeight: '16px',
                            border: `1px solid ${m.feedback === 'up' ? '#00ff88' : 'transparent'}`,
                            color: m.feedback === 'up' ? '#00ff88' : EMBRY.muted,
                            borderRadius: 2, cursor: 'pointer',
                          }}
                        >&#9650;</button>
                        <button
                          onClick={() => {
                            const newFb = m.feedback === 'down' ? null : 'down'
                            setChatMessages(prev => prev.map((msg, j) => j === i ? { ...msg, feedback: newFb } : msg))
                            if (newFb === 'down') {
                              // Store negative feedback
                              const userMsg = chatMessages.slice(0, i).reverse().find(x => x.role === 'user')
                              if (userMsg) {
                                fetch(`${API}/api/memory/learn`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    problem: userMsg.content,
                                    solution: m._querySpec ? JSON.stringify({ ...m._querySpec as object, _feedback: 'negative' }) : `NEGATIVE: ${m.content.substring(0, 200)}`,
                                    tags: ['binary-explorer-feedback', 'negative', binaryName],
                                    scope: 'binary-explorer',
                                  }),
                                }).catch(() => {})
                              }
                              // Hint: type what you actually wanted (conversation steering)
                              setChatInput('')
                              // Focus the input
                              const inp = document.querySelector('input[placeholder]') as HTMLInputElement
                              if (inp) inp.focus()
                            }
                          }}
                          style={{
                            fontSize: 10, padding: '0 5px', background: 'transparent', lineHeight: '16px',
                            border: `1px solid ${m.feedback === 'down' ? '#ff4444' : 'transparent'}`,
                            color: m.feedback === 'down' ? '#ff4444' : EMBRY.muted,
                            borderRadius: 2, cursor: 'pointer',
                          }}
                        >&#9660;</button>
                      </div>
                    )}
                  </div>
                ))}
                {chatLoading && <div style={{ fontSize: 10, color: EMBRY.accent, padding: 10 }}>THINKING...</div>}
              </div>


              {/* Quick RE query chips — always visible, fast pivot without clearing chat */}
              <div style={{ padding: '5px 10px', borderTop: `1px solid ${EMBRY.border}`, background: '#06060a', display: 'flex', gap: 4, flexWrap: 'wrap', flexShrink: 0, alignItems: 'center' }}>
                <span style={{ fontSize: 7, color: EMBRY.muted, fontWeight: 800, letterSpacing: '0.08em', flexShrink: 0 }}>QUICK:</span>
                {(analysisMode === 'investigator' ? [
                  { label: 'obfuscation?', query: `Find obfuscated functions in ${binaryName}: control flow flattening, opaque predicates, dead code.` },
                  { label: 'network input', query: `What functions in ${binaryName} receive or parse network input? Are inputs validated?` },
                  { label: 'crypto?', query: `What cryptographic routines are in ${binaryName}? Identify weak algorithms, IV reuse, or hardcoded keys.` },
                  { label: 'vuln surface', query: `What is the vulnerability attack surface of ${binaryName}? Find dangerous patterns: unchecked inputs, format strings, integer overflows.` },
                  ...(selectedNode ? [{ label: `xref:${selectedNode.label}`, query: `List all callers and callees of ${selectedNode.label}. Full cross-reference picture.` }] : []),
                ] : [
                  { label: 'what does this do?', query: `What does ${binaryName} do? Plain English overview.` },
                  { label: 'attack surface?', query: `What is the attack surface of ${binaryName}?` },
                  { label: 'key components', query: `What are the main components of ${binaryName}?` },
                ]).slice(0, 5).map(chip => (
                  <button key={chip.label} onClick={() => sendChat(chip.query)}
                    style={{
                      fontSize: 8, padding: '2px 8px',
                      background: `${EMBRY.accent}0d`, border: `1px solid ${EMBRY.accent}28`,
                      borderRadius: 10, cursor: 'pointer', color: EMBRY.accent,
                      fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, flexShrink: 0,
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = `${EMBRY.accent}22`)}
                    onMouseLeave={e => (e.currentTarget.style.background = `${EMBRY.accent}0d`)}
                  >{chip.label}</button>
                ))}
              </div>

              {/* Chat Input */}
              <form onSubmit={e => { e.preventDefault(); sendChat() }} style={styles.chatForm}>
                <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', background: '#0a0a0a', border: `1px solid ${EMBRY.border}`, borderRadius: 4 }}>
                  <input style={{ ...styles.chatInput, border: 'none', background: 'transparent' }} placeholder={
                    [...chatMessages].reverse().find(m => m.role === 'assistant')?.feedback === 'down'
                      ? 'What should have happened instead?'
                      : selectedNode
                        ? `Ask about ${selectedNode.label}... (e.g. "what calls this?" / "obfuscated?")`
                        : analysisMode === 'investigator'
                          ? 'e.g. "find obfuscated functions" / "network input handlers" / "crypto routines"'
                          : 'Try: "what does this program do?" — plain English works!'
                  } value={chatInput} onChange={e => setChatInput(e.target.value)} />
                </div>
                <button type="submit" style={styles.sendButton}>↑</button>
              </form>

              </>}
          </div>
          {/* Old inspector + activity bar removed */}
        </div>
      )}

      {/* ═══ BOTTOM STATUS BAR (shared component) ═══ */}
      <StatusBar
        projectId="binary-explorer"
        connected={!data.error}
        loading={data.loading}
        error={data.error}
        items={[
          { label: binaryName.toUpperCase() },
          ...(!data.loading && !data.error ? [
            { label: `${data.stats.totalNodes} features` },
            { label: `${data.stats.totalEdges} edges` },
            ...(sceneNodeIds.size > 0 ? [{ label: `${sceneNodeIds.size} in scene`, color: EMBRY.accent }] : []),
            ...(selectedNode ? [{ label: `${selectedNode.label} [${selectedNode.nodeType}]`, color: EMBRY.white }] : []),
          ] : []),
        ]}
        rightItems={[
          { label: `${viewMode} · ${perspective} · ${layoutMode}` },
        ]}
      />
    </div>
  )
}

const styles = {
  topbar: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 16px', background: '#090909',
    borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0 as const,
  },
  panes: {
    display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0,
  } as React.CSSProperties,
  graphPane: {
    flex: '0 0 65%',
    display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minHeight: 0,
  } as React.CSSProperties,
  convPane: {
    flex: '0 0 35%',
    display: 'flex', flexDirection: 'column' as const, background: '#050505', overflow: 'hidden', minHeight: 0,
  } as React.CSSProperties,
  chatThread: {
    flex: 1, overflow: 'auto', padding: '16px 12px 16px 20px',
    display: 'flex', flexDirection: 'column' as const, gap: 4,
    scrollbarGutter: 'stable',
  } as React.CSSProperties,
  userMsg: {
    alignSelf: 'flex-end' as const, maxWidth: '85%',
    background: `${EMBRY.accent}15`, border: `1px solid ${EMBRY.accent}33`,
    borderRadius: '12px 12px 2px 12px', padding: '10px 14px',
    fontSize: 12, color: EMBRY.white, lineHeight: 1.6,
  } as React.CSSProperties,
  assistantMsg: {
    maxWidth: '92%',
    background: EMBRY.bgPanel, border: `1px solid ${EMBRY.border}`,
    borderRadius: '12px 12px 12px 2px', padding: '12px 16px',
    fontSize: 12, color: EMBRY.white, lineHeight: 1.6,
  } as React.CSSProperties,
  chatForm: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '12px 16px', borderTop: `1px solid ${EMBRY.border}`,
    background: EMBRY.bgPanel, flexShrink: 0 as const,
  } as React.CSSProperties,
  chatInput: {
    flex: 1, background: '#0a0a0a', border: `1px solid ${EMBRY.border}`,
    borderRadius: 2, padding: '10px 14px', color: EMBRY.white,
    fontSize: 12, outline: 'none',
  } as React.CSSProperties,
  contextItem: {
    padding: '8px 10px', fontSize: 11, color: EMBRY.white,
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
    borderRadius: 2, transition: 'background 0.1s',
  } as React.CSSProperties,
  sendButton: {
    padding: '8px 16px',
    backgroundColor: EMBRY.accent,
    color: '#000',
    border: 'none',
    borderRadius: 2,
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 6,
  } as React.CSSProperties,
}

// Inject pulse animation
const styleInjector = typeof document !== 'undefined' ? document.createElement('style') : null
if (styleInjector) {
  styleInjector.innerHTML = `
    @keyframes voice-pulse {
      0% { transform: scale(1); opacity: 0.8; }
      100% { transform: scale(1.4); opacity: 0; }
    }
    @keyframes context-pop {
      0% { transform: scale(0.95); opacity: 0; }
      100% { transform: scale(1); opacity: 1; }
    }
    @keyframes scene-card-in {
      0% { opacity: 0; transform: translate(-50%, -46%); }
      100% { opacity: 1; transform: translate(-50%, -50%); }
    }
    @keyframes seed-cta-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(100, 220, 180, 0.35); }
      50% { box-shadow: 0 0 0 5px rgba(100, 220, 180, 0); }
    }
    @keyframes seed-done-in {
      0% { opacity: 0; transform: translateX(-50%) translateY(-6px); }
      100% { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    @keyframes seed-spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    @keyframes node-appear {
      0% { opacity: 0; transform: scale(0.6); }
      60% { opacity: 1; transform: scale(1.08); }
      100% { transform: scale(1); }
    }
    [style*="contextItem"]:hover {
      background: #1a1a1a;
    }
  `
  document.head.appendChild(styleInjector)
}

export default BinaryExplorerView

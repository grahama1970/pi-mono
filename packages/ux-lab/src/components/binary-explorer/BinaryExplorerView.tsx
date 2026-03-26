import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Shield, Workflow, Trash2, Code, Layers, MessageSquare, Network, Search, History, Table2, Undo, Redo, GitGraph, List } from 'lucide-react'
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
            <div key={s.name} style={paneItemStyle(false)} onClick={() => onLoadScene(s)}>
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

type Perspective = 'all' | 'security' | 'data_flow' | 'protocol'
const PERSPECTIVE_LABELS: Record<Perspective, string> = {
  all: 'All Features',
  security: 'Security',
  data_flow: 'Data Flow',
  protocol: 'Protocol',
}
const PERSPECTIVE_TYPES: Record<Perspective, string[]> = {
  all: [],  // empty = no filter
  security: ['rpc', 'schema', 'event', 'namespace'],
  data_flow: ['schema', 'event', 'state_machine', 'namespace'],
  protocol: ['namespace', 'rpc', 'cli_command', 'event'],
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
  const [tableSortKey, setTableSortKey] = useState<'label' | 'nodeType' | 'cluster' | 'confidence' | 'connections' | 'cwe' | 'attack'>('connections')
  const [tableSortAsc, setTableSortAsc] = useState(false)

  // --- Taxonomy State ---
  const [taxonomyMap, setTaxonomyMap] = useState<Map<string, { mind: string[]; cwe: string[]; attack: string[]; d3fend: string[]; nist: string[] }>>(new Map())
  const [taxonomyLoading, setTaxonomyLoading] = useState(false)

  // --- Code View State ---
  const [codeViewTab, setCodeViewTab] = useState<'assembly' | 'decompiled' | 'pseudocode'>('pseudocode')
  const [pseudocode, setPseudocode] = useState<string | null>(null)
  const [pseudocodeLoading, setPseudocodeLoading] = useState(false)
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
    if (pseudocode && pseudocodeLoading) return
    setPseudocodeLoading(true)
    setPseudocode(null)
    const nodeInfo = `Feature: ${selectedNode.label}\nType: ${selectedNode.nodeType}\nDescription: ${selectedNode.description || 'N/A'}\n${selectedNode.source_pattern ? `Source pattern:\n${selectedNode.source_pattern}` : ''}${selectedNode.fields?.length ? `\nFields: ${selectedNode.fields.map((f: any) => f.name || f).join(', ')}` : ''}${selectedNode.states?.length ? `\nStates: ${selectedNode.states.map((s: any) => s.name || s).join(', ')}` : ''}`

    fetch('/api/scillm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'text',
        messages: [
          { role: 'system', content: 'You are a reverse engineering assistant. Convert binary feature descriptions into clean Python pseudocode that a beginner could understand. Include comments explaining what each section does. Keep it concise (under 40 lines).' },
          { role: 'user', content: `Generate Python pseudocode for this binary feature:\n\n${nodeInfo}` }
        ],
        temperature: 0.2,
        max_tokens: 800,
      }),
    })
      .then(r => r.json())
      .then((d: any) => setPseudocode(d.choices?.[0]?.message?.content || 'No pseudocode generated'))
      .catch(() => setPseudocode('# Error: LLM service unavailable'))
      .finally(() => setPseudocodeLoading(false))
  }, [selectedNode?.id, codeViewTab, dataTab])

  // --- Saved Scenes ---
  const [savedScenes, setSavedScenes] = useState<{ name: string; nodeIds: string[]; perspective: Perspective; layoutMode: string }[]>([])
  const [sceneName, setSceneName] = useState('')

  // --- Context Menu ---
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, node: BinaryGraphNode } | null>(null)

  // --- Investigation Journal ---
  const [journalSteps, setJournalSteps] = useState<Step[]>([])
  const [rightTab, setRightTab] = useState<'chat' | 'journal'>('chat')
  const [analysisMode, setAnalysisMode] = useState<'beginner' | 'investigator'>('investigator')
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

  // --- Scene Save/Load ---
  const saveScene = useCallback(async (name: string) => {
    if (!name.trim() || sceneNodeIds.size === 0) return
    const sceneData = {
      name: name.trim(),
      binary: binaryName,
      nodeIds: [...sceneNodeIds],
      perspective,
      layoutMode,
      selectedNodeId: selectedNode?.id || null,
      breadcrumbIds: breadcrumbs.map(b => b.id),
      savedAt: new Date().toISOString(),
    }
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
  }, [sceneNodeIds, binaryName, perspective, layoutMode, selectedNode, breadcrumbs])

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

  // --- Keyboard Shortcuts: Ctrl+Z (undo), Ctrl+Shift+Z / Ctrl+Y (redo) ---
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return
      if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo() }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [undo, redo])

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
      const systemPrompt = `You are a reverse-engineering analyst for the "${binaryName}" binary extracted via /analyze-elf + /treesitter.

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
  const outgoingEdges: { type: string; target: string; targetId: string }[] = []
  const incomingEdges: { type: string; source: string; sourceId: string }[] = []
  for (const e of allSelectedEdges) {
    const isOutgoing = e._from === selectedNode?.id
    const otherId = isOutgoing ? e._to : e._from
    const otherLabel = otherId.split('/').pop() ?? ''
    const group = edgesByType[e.edge_type] ?? []
    group.push(otherLabel)
    edgesByType[e.edge_type] = group
    if (isOutgoing) {
      outgoingEdges.push({ type: e.edge_type, target: otherLabel, targetId: otherId })
    } else {
      incomingEdges.push({ type: e.edge_type, source: otherLabel, sourceId: otherId })
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, height: '100%', overflow: 'hidden', minHeight: 0 }}>
      {data.loading ? (
        <div style={{ padding: 20, color: EMBRY.dim }}>Loading analysis...</div>
      ) : data.error ? (
        <div style={{ padding: 20, color: EMBRY.red }}>{data.error}</div>
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
                  </div>
                )}
              </div>
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
              <span style={{ marginLeft: 'auto', color: EMBRY.dim }}>
                {sceneNodeIds.size} in scene · {viewMode}
              </span>
            </div>

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
                          onLineClick={(i) => {
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

              {/* Empty scene card — actionable, not confusing */}
              {sceneNodeIds.size === 0 && !data.loading && viewMode === 'graph' && (
                <div style={{
                  position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                  zIndex: 5, pointerEvents: 'auto', width: 380,
                  background: '#0a0a0a', border: `1px solid ${EMBRY.border}`, borderRadius: 6,
                  padding: '24px 28px', boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
                }}>
                  <div style={{ fontSize: 16, fontWeight: 900, color: EMBRY.white, marginBottom: 4 }}>No nodes in scene</div>
                  <div style={{ fontSize: 10, color: EMBRY.dim, marginBottom: 16, lineHeight: 1.6 }}>
                    Select a namespace or symbol from the left pane, or use one of these quick actions:
                  </div>

                  {/* Quick actions */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <button onClick={() => {
                      const namespaces = data.graphNodes.filter(n => n.nodeType === 'namespace')
                      const topHubs = data.graphNodes.filter(n => n.nodeType !== 'parameter' && n.nodeType !== 'namespace')
                        .map(n => ({ id: n.id, deg: data.allEdges.filter(e => e._from === n.id || e._to === n.id).length }))
                        .sort((a, b) => b.deg - a.deg).slice(0, 5)
                      addToScene([...namespaces.map(n => n.id), ...topHubs.map(n => n.id)])
                    }} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                      background: `${EMBRY.accent}10`, border: `1px solid ${EMBRY.accent}33`, color: EMBRY.accent,
                      borderRadius: 4, cursor: 'pointer', fontWeight: 700, fontSize: 11, textAlign: 'left',
                    }}>
                      <span style={{ fontSize: 18 }}>⚡</span>
                      <div>
                        <div>Load Sample Graph</div>
                        <div style={{ fontSize: 8, fontWeight: 400, color: EMBRY.dim, marginTop: 2 }}>Namespaces + top 5 connected features</div>
                      </div>
                    </button>

                    <button onClick={() => setViewMode('vulns')} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                      background: '#1a1520', border: `1px solid #9C27B033`, color: '#9C27B0',
                      borderRadius: 4, cursor: 'pointer', fontWeight: 700, fontSize: 11, textAlign: 'left',
                    }}>
                      <span style={{ fontSize: 18 }}>🛡</span>
                      <div>
                        <div>View Vulnerability Map</div>
                        <div style={{ fontSize: 8, fontWeight: 400, color: EMBRY.dim, marginTop: 2 }}>CWE / ATT&CK / D3FEND mapping table</div>
                      </div>
                    </button>

                    <button onClick={() => setViewMode('code')} style={{
                      display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
                      background: '#0a1520', border: `1px solid #2196F333`, color: '#2196F3',
                      borderRadius: 4, cursor: 'pointer', fontWeight: 700, fontSize: 11, textAlign: 'left',
                    }}>
                      <span style={{ fontSize: 18 }}>📄</span>
                      <div>
                        <div>Browse Source Patterns</div>
                        <div style={{ fontSize: 8, fontWeight: 400, color: EMBRY.dim, marginTop: 2 }}>ASM / decompiled C / Python pseudocode</div>
                      </div>
                    </button>
                  </div>

                  <div style={{ fontSize: 8, color: EMBRY.muted, marginTop: 12, textAlign: 'center' }}>
                    {data.stats.totalNodes} features · {data.stats.totalEdges} edges · {data.graphNodes.filter(n => n.nodeType === 'namespace').length} namespaces
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
            {contextMenu && (
              <div onClick={() => setContextMenu(null)} style={{ position: 'fixed', inset: 0, zIndex: 9999 }} onContextMenu={e => { e.preventDefault(); setContextMenu(null) }}>
                <div style={{ position: 'absolute', top: contextMenu.y, left: contextMenu.x, background: '#090909', border: `1px solid ${EMBRY.border}`, padding: '4px', borderRadius: 2, minWidth: 160, boxShadow: '0 8px 32px rgba(0,0,0,0.8)' }} onClick={e => e.stopPropagation()}>
                  <div style={{ padding: '6px 10px', fontSize: 9, fontWeight: 700, color: EMBRY.dim, borderBottom: `1px solid ${EMBRY.border}`, marginBottom: 4 }}>{contextMenu.node.label.toUpperCase()}</div>
                  <div style={styles.contextItem} onClick={() => { addNodeWithNeighbors(contextMenu.node.id, 1, 6); setContextMenu(null) }}><Network size={12} /> Expand 6 Neighbors</div>
                  <div style={styles.contextItem} onClick={() => { addNodeWithNeighbors(contextMenu.node.id, 1, 20); setContextMenu(null) }}><Network size={12} /> Expand All Neighbors</div>
                  <div style={styles.contextItem} onClick={() => { removeFromScene(contextMenu.node.id); setContextMenu(null) }}><Trash2 size={12} /> Remove from Scene</div>
                  <div style={{ height: 1, background: EMBRY.border, margin: '4px 0' }} />
                  <div style={{ padding: '4px 10px', fontSize: 8, fontWeight: 700, color: EMBRY.dim, textTransform: 'uppercase' }}>Scene Actions</div>
                  <div style={styles.contextItem} onClick={() => {
                    setContextMenu(null)
                    setChatInput(`Trace the execution path of ${contextMenu.node.label}. What state machines, events, and schemas does it touch?`)
                    setTimeout(() => sendChat(), 100)
                  }}><Workflow size={12} /> Trace Execution Path</div>
                  <div style={styles.contextItem} onClick={() => {
                    setContextMenu(null)
                    setChatInput(`What is the security attack surface of ${contextMenu.node.label}? What auth, permissions, or external inputs does it use?`)
                    setTimeout(() => sendChat(), 100)
                  }}><Shield size={12} /> Find Attack Surface</div>
                  <div style={styles.contextItem} onClick={() => {
                    setContextMenu(null)
                    const other = selectedNode && selectedNode.id !== contextMenu.node.id ? selectedNode.label : ''
                    if (other) {
                      setChatInput(`Compare ${contextMenu.node.label} and ${other}. How are they related? What do they share?`)
                    } else {
                      setChatInput(`What are the most important connections of ${contextMenu.node.label} and why?`)
                    }
                    setTimeout(() => sendChat(), 100)
                  }}><Search size={12} /> {selectedNode && selectedNode.id !== contextMenu.node.id ? `Compare with ${selectedNode.label}` : 'Analyze Connections'}</div>
                </div>
              </div>
            )}

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
                    { id: 'ast' as const, title: 'AST / Fields', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 4C5.5 6.5 4 9 4 12s1.5 5.5 4 8" /><path d="M16 4c2.5 2.5 4 5 4 8s-1.5 5.5-4 8" /><line x1="9.5" y1="9" x2="14.5" y2="15" /><line x1="14.5" y1="9" x2="9.5" y2="15" /></svg> },
                    { id: 'explain' as const, title: 'Explanation', icon: <MessageSquare size={14} /> },
                    { id: 'code' as const, title: 'Code View', icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 8l-4 4 4 4"/><path d="M17 8l4 4-4 4"/><path d="M14 4l-4 16"/></svg> },
                    { id: 'table' as const, title: 'All Features', icon: <Table2 size={14} /> },
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

                      {/* Row 3: Fields/Parameters — expandable struct view */}
                      {selectedNode.fields && selectedNode.fields.length > 0 && (
                        <div>
                          <div style={{ fontSize: 8, color: EMBRY.dim, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>
                            {selectedNode.nodeType === 'schema' ? 'STRUCT FIELDS' : 'PARAMETERS'} ({selectedNode.fields.length})
                          </div>
                          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, background: '#050505', border: `1px solid ${EMBRY.border}`, borderRadius: 3, padding: '4px 0' }}>
                            {selectedNode.fields.map((f: any, i: number) => {
                              const name = typeof f === 'string' ? f : f.name || f.label || String(f)
                              const type = typeof f === 'object' ? (f.type || f.dataType || '') : ''
                              const desc = typeof f === 'object' ? (f.description || '') : ''
                              return (
                                <div key={i} onClick={() => onFeatureClick(name)}
                                  style={{
                                    display: 'flex', gap: 8, padding: '2px 8px', cursor: 'pointer',
                                    borderBottom: i < selectedNode.fields!.length - 1 ? `1px solid ${EMBRY.border}` : 'none',
                                  }}
                                  onMouseEnter={e => (e.currentTarget.style.background = '#0a0a0a')}
                                  onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                >
                                  <span style={{ color: '#2196F3', minWidth: 16 }}>{i}</span>
                                  <span style={{ color: EMBRY.white, flex: 1 }}>{name}</span>
                                  {type && <span style={{ color: '#9C27B0' }}>{type}</span>}
                                  {desc && <span style={{ color: EMBRY.muted, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{desc}</span>}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}

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
                          </div>
                        </div>
                      )}

                      {/* Row 5: RPC/Event interface details */}
                      {(selectedNode.nodeType === 'rpc' || selectedNode.nodeType === 'event' || selectedNode.nodeType === 'cli_command') && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {/* Interface section */}
                          <div>
                            <div style={{ fontSize: 8, color: '#2196F3', fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>INTERFACE</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: '2px 8px', fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}>
                              <span style={{ color: EMBRY.muted }}>Type</span>
                              <span style={{ color: EMBRY.white }}>{selectedNode.nodeType.toUpperCase()}</span>
                              <span style={{ color: EMBRY.muted }}>Namespace</span>
                              <span style={{ color: '#22d3ee' }}>{selectedNode.cluster}</span>
                              {selectedNode.fields && selectedNode.fields.length > 0 && <>
                                <span style={{ color: EMBRY.muted }}>Params</span>
                                <span style={{ color: EMBRY.white }}>{selectedNode.fields.length} ({selectedNode.fields.slice(0, 3).join(', ')}{selectedNode.fields.length > 3 ? '...' : ''})</span>
                              </>}
                              <span style={{ color: EMBRY.muted }}>Tier</span>
                              <span style={{ color: selectedNode.tier === 'T0' ? EMBRY.green : selectedNode.tier === 'T1' ? EMBRY.amber : EMBRY.red }}>{selectedNode.tier}</span>
                            </div>
                          </div>

                          {/* Security section */}
                          <div>
                            <div style={{ fontSize: 8, color: '#FF5722', fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>SECURITY</div>
                            {(() => {
                              const tax = taxonomyMap.get(selectedNode.id)
                              const hasAuth = allSelectedEdges.some(e => {
                                const otherNode = data.graphNodes.find(n => n.id === (e._from === selectedNode.id ? e._to : e._from))
                                return otherNode && (otherNode.label.includes('auth') || otherNode.label.includes('permission') || otherNode.label.includes('token'))
                              })
                              return (
                                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                  <span style={{
                                    fontSize: 8, padding: '2px 6px', borderRadius: 2, fontWeight: 700,
                                    background: hasAuth ? '#1a272120' : '#2a151520',
                                    border: `1px solid ${hasAuth ? EMBRY.green + '44' : '#FF572244'}`,
                                    color: hasAuth ? EMBRY.green : '#FF5722',
                                  }}>{hasAuth ? 'AUTH REQUIRED' : 'NO AUTH DETECTED'}</span>
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
                              )
                            })()}
                          </div>
                        </div>
                      )}

                      {/* Row 6: Source pattern (if available) */}
                      {selectedNode.source_pattern && (
                        <div>
                          <div style={{ fontSize: 8, color: EMBRY.dim, fontWeight: 700, textTransform: 'uppercase', marginBottom: 3 }}>SOURCE</div>
                          <pre style={{ fontSize: 8, color: '#a5b4fc', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'JetBrains Mono, monospace', background: '#050505', padding: 4, borderRadius: 2, border: `1px solid ${EMBRY.border}`, maxHeight: 60, overflow: 'auto' }}>
                            {selectedNode.source_pattern}
                          </pre>
                        </div>
                      )}

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
                              <span style={{ color: EMBRY.white, fontWeight: 600 }}>{e.target}</span>
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
                              <span style={{ color: EMBRY.white, fontWeight: 600 }}>{e.source}</span>
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
                    // Sortable table with taxonomy columns (NIST/CWE/ATT&CK/D3FEND/CAPEC)
                    const nodeWithDeg = data.graphNodes.map(n => {
                      const tax = taxonomyMap.get(n.id)
                      return {
                        ...n,
                        connections: data.allEdges.filter(e => e._from === n.id || e._to === n.id).length,
                        cwe: tax?.cwe?.join(', ') || '',
                        attack: tax?.attack?.join(', ') || '',
                        d3fend: tax?.d3fend?.join(', ') || '',
                        nist: tax?.nist?.join(', ') || '',
                        mind: tax?.mind?.join(', ') || '',
                      }
                    })
                    const q = tableSearch.toLowerCase()
                    const filtered = nodeWithDeg
                      .filter(n => !q || n.label.toLowerCase().includes(q) || n.nodeType.includes(q) || n.cluster.includes(q) || n.cwe.toLowerCase().includes(q) || n.attack.toLowerCase().includes(q))
                      .sort((a, b) => {
                        const va = (a as any)[tableSortKey] ?? ''
                        const vb = (b as any)[tableSortKey] ?? ''
                        const cmp = typeof va === 'number' ? va - (vb as number) : String(va).localeCompare(String(vb))
                        return tableSortAsc ? cmp : -cmp
                      })
                    const sortHeader = (key: typeof tableSortKey, label: string) => (
                      <th key={key} onClick={() => { if (tableSortKey === key) setTableSortAsc(!tableSortAsc); else { setTableSortKey(key); setTableSortAsc(true) } }}
                        style={{ padding: '4px 6px', fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: tableSortKey === key ? EMBRY.accent : EMBRY.dim, cursor: 'pointer', textAlign: 'left', borderBottom: `1px solid ${EMBRY.border}`, whiteSpace: 'nowrap' }}>
                        {label} {tableSortKey === key ? (tableSortAsc ? '▲' : '▼') : ''}
                      </th>
                    )
                    return (
                      <div>
                        <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                          <input value={tableSearch} onChange={e => setTableSearch(e.target.value)}
                            placeholder="Filter features, CWE, ATT&CK..." style={{ flex: 1, background: '#0a0a0a', border: `1px solid ${EMBRY.border}`, borderRadius: 2, padding: '3px 8px', color: EMBRY.white, fontSize: 10, outline: 'none', fontFamily: 'JetBrains Mono, monospace' }} />
                          <span style={{ fontSize: 8, color: EMBRY.muted }}>{filtered.length}/{nodeWithDeg.length}</span>
                          {taxonomyLoading && <span style={{ fontSize: 8, color: EMBRY.accent }}>Loading taxonomy...</span>}
                        </div>
                        <div style={{ maxHeight: 300, overflow: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 9, fontFamily: 'JetBrains Mono, monospace' }}>
                            <thead><tr>
                              {sortHeader('label', 'Name')}
                              {sortHeader('nodeType', 'Type')}
                              {sortHeader('cluster', 'Cluster')}
                              {sortHeader('connections', 'Conn')}
                              {sortHeader('cwe', 'CWE')}
                              {sortHeader('attack', 'ATT&CK')}
                            </tr></thead>
                            <tbody>
                              {filtered.slice(0, 100).map(n => (
                                <tr key={n.id}
                                  onClick={() => onFeatureClick(n.label)}
                                  style={{ cursor: 'pointer', borderBottom: `1px solid ${EMBRY.border}`, background: n.id === selectedNode?.id ? `${EMBRY.accent}15` : 'transparent' }}
                                  onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
                                  onMouseLeave={e => (e.currentTarget.style.background = n.id === selectedNode?.id ? `${EMBRY.accent}15` : 'transparent')}
                                >
                                  <td style={{ padding: '3px 6px', color: '#22d3ee' }}>{n.label}</td>
                                  <td style={{ padding: '3px 6px' }}>
                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                      <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: NODE_TYPE_COLORS[n.nodeType] ?? EMBRY.dim, display: 'inline-block' }} />
                                      {n.nodeType.replace('_', ' ')}
                                    </span>
                                  </td>
                                  <td style={{ padding: '3px 6px', color: EMBRY.dim }}>{n.cluster}</td>
                                  <td style={{ padding: '3px 6px', fontWeight: n.connections > 10 ? 700 : 400, color: n.connections > 10 ? EMBRY.white : EMBRY.dim }}>{n.connections}</td>
                                  <td style={{ padding: '3px 6px', color: '#ef4444', fontSize: 8 }}>{n.cwe}</td>
                                  <td style={{ padding: '3px 6px', color: '#f97316', fontSize: 8 }}>{n.attack}</td>
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
                    return (
                      <pre style={{ fontSize: 9, color: EMBRY.dim, background: '#020202', padding: 8, border: `1px solid ${EMBRY.border}`, overflowX: 'auto', margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'JetBrains Mono, monospace' }}>
                        {JSON.stringify(fullDoc ?? selectedNode, null, 2)}
                      </pre>
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
                  ANALYSIS
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
                    }}>{mode}</button>
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
                  if (namespaces.length >= 2) q([{text:'How do '},{text:namespaces[0],entity:true},{text:' and '},{text:namespaces[1],entity:true},{text:' interact?'}])
                  if (topRpcs[0]) q([{text:'What does '},{text:topRpcs[0].label,entity:true},{text:' do?'}])
                  if (stateMachines[0]) q([{text:'Trace the '},{text:stateMachines[0],entity:true},{text:' state machine'}])
                  if (namespaces.length > 0) q([{text:'What is the attack surface of '},{text:namespaces[0],entity:true},{text:'?'}])
                  if (topRpcs[1]) q([{text:'How does '},{text:topRpcs[1].label,entity:true},{text:' connect to '},{text:topRpcs[2]?.label||namespaces[0],entity:true},{text:'?'}])
                  q([{text:'What are the core schemas in '},{text:binaryName,entity:true},{text:'?'}])
                  return (
                    <div style={{ padding: 10 }}>
                      <div style={{ fontSize: 14, fontWeight: 900, color: EMBRY.white, marginBottom: 4 }}>{binaryName.toUpperCase()}</div>
                      <div style={{ fontSize: 9, color: EMBRY.dim, marginBottom: 12 }}>
                        {data.stats.totalNodes} features · {namespaces.length} namespaces · {stateMachines.length} state machines
                      </div>
                      {/* Beginner guided path */}
                      {analysisMode === 'beginner' && (
                        <div style={{ marginBottom: 12, padding: '8px 10px', background: `${EMBRY.accent}08`, border: `1px solid ${EMBRY.accent}22`, borderRadius: 4 }}>
                          <div style={{ fontSize: 8, fontWeight: 800, color: EMBRY.accent, marginBottom: 6 }}>GUIDED ANALYSIS PATH</div>
                          {[
                            { step: 1, label: 'What is this binary made of?', query: `What are the main components of ${binaryName}?` },
                            { step: 2, label: 'How do the parts communicate?', query: `How do ${namespaces[0] || 'the namespaces'} and ${namespaces[1] || 'other components'} interact?` },
                            { step: 3, label: 'Where could this break?', query: `What is the attack surface of ${binaryName}?` },
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
                      <div style={{ fontSize: 8, color: EMBRY.dim, marginBottom: 6, fontWeight: 800 }}>SUGGESTED QUERIES</div>
                      {suggestions.map((s, si) => (
                        <div key={si} onClick={() => { setChatInput(s.raw); setTimeout(() => { setChatInput(''); sendChat(s.raw) }, 50) }} style={{ fontSize: 10, color: EMBRY.dim, padding: '6px 10px', background: `${EMBRY.accent}08`, border: `1px solid ${EMBRY.accent}22`, borderRadius: 4, cursor: 'pointer', marginBottom: 4, transition: 'background 0.15s' }} onMouseEnter={e => (e.currentTarget.style.background = `${EMBRY.accent}18`)} onMouseLeave={e => (e.currentTarget.style.background = `${EMBRY.accent}08`)}>
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
                  <div style={{ padding: 16, textAlign: 'center', color: EMBRY.dim, fontSize: 11 }}>
                    Ask a question about <strong style={{ color: EMBRY.white }}>{selectedNode.label}</strong>
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

              {/* Chat Input */}
              <form onSubmit={e => { e.preventDefault(); sendChat() }} style={styles.chatForm}>
                <div style={{ position: 'relative', flex: 1, display: 'flex', alignItems: 'center', background: '#0a0a0a', border: `1px solid ${EMBRY.border}`, borderRadius: 4 }}>
                  <input style={{ ...styles.chatInput, border: 'none', background: 'transparent' }} placeholder={
                    [...chatMessages].reverse().find(m => m.role === 'assistant')?.feedback === 'down'
                      ? 'What should have happened instead?'
                      : selectedNode ? `Ask about ${selectedNode.label}...` : 'Ask about this binary...'
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
    [style*="contextItem"]:hover {
      background: #1a1a1a;
    }
  `
  document.head.appendChild(styleInjector)
}

export default BinaryExplorerView

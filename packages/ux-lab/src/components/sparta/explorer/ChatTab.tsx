/**
 * ChatTab — SPARTA Chat: compliance questions against SPARTA + F-36 datalake.
 *
 * Layout: 450px ChatWell (left) + flex viz workspace (right).
 * Viz workspace toggles between ThreatMatrix and LemmaGraph based on query intent.
 * Evidence cases slide over from right.
 *
 * Brandon, Margaret, Jennifer personas ask questions here.
 * The threat matrix and lemma graph are LIVE — they reflect current graph state.
 */
import { useState, useCallback, useRef, useEffect, createContext, useContext } from 'react'
import { EMBRY } from '../common/EmbryStyle'
import { ChatWell } from '../query/ChatWell'
import type { ChatMessage, EntityRef, EvidenceGate, ThreatMatrixSummary } from '../query/ChatWell'
import { ThreatMatrix } from '../shared/ThreatMatrix'
import type { ThreatTechnique, ThreatTactic, TechniqueDetail, ThreatMatrixState, ThreatMatrixActions, ThreatMatrixMeta, DatalakeOption } from '../shared/ThreatMatrix'
import { LemmaGraph } from '../lemma-graph/LemmaGraph'
import type { GraphNode, GraphEdge } from '../lemma-graph/LemmaGraph'
import PostureDashboard from '../dashboard/PostureDashboard'

const API = 'http://localhost:3001'

// ── Shared state between chat + viz ──────────────────────────────────────

type VizMode = 'matrix' | 'graph' | 'dashboard'

interface ChatTabContextValue {
  vizMode: VizMode
  setVizMode: (m: VizMode) => void
  focusTechnique: string | null
  setFocusTechnique: (id: string | null) => void
  focusControl: string | null
  setFocusControl: (id: string | null) => void
  currentSystem: string
  setCurrentSystem: (s: string) => void
}

const ChatTabContext = createContext<ChatTabContextValue | null>(null)

// ── Threat Matrix data fetching (reused from ThreatMatrixView) ───────────

const SPARTA_TACTICS: ThreatTactic[] = [
  { id: 'ST0001', name: 'Reconnaissance', prefix: 'REC' },
  { id: 'ST0002', name: 'Resource Development', prefix: 'RD' },
  { id: 'ST0003', name: 'Initial Access', prefix: 'IA' },
  { id: 'ST0004', name: 'Execution', prefix: 'EX' },
  { id: 'ST0005', name: 'Persistence', prefix: 'PER' },
  { id: 'ST0006', name: 'Defense Evasion', prefix: 'DE' },
  { id: 'ST0007', name: 'Lateral Movement', prefix: 'LM' },
  { id: 'ST0008', name: 'Exfiltration', prefix: 'EXF' },
  { id: 'ST0009', name: 'Impact', prefix: 'IMP' },
]

const DATALAKES: DatalakeOption[] = [
  { id: 'f36', name: 'F-36 Lightning II', description: 'F-36 program compliance evidence', collections: ['sparta_qra', 'sparta_url_content'] },
  { id: 'cmmc', name: 'CMMC Assessment', description: 'CMMC Level 2 compliance data', collections: ['sparta_qra'] },
]

function tacticForTechnique(controlId: string): string | null {
  for (const t of SPARTA_TACTICS) {
    if (controlId.startsWith(t.prefix + '-')) return t.name
  }
  return null
}

function post(path: string, body: Record<string, unknown>) {
  return fetch(`${API}/api/memory${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(r => r.json()).catch(() => ({ documents: [], items: [] }))
}

interface ThreatDeltaDoc {
  type?: string
  control_id?: string
  old_verdict?: string
  new_verdict?: string
  reason?: string
  timestamp?: string | number
}

function toTimestampMs(timestamp: string | number | undefined): number | null {
  if (typeof timestamp === 'number') {
    return timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000
  }
  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

// ── Main component ───────────────────────────────────────────────────────

export function ChatTab() {
  // Shared state
  const [vizMode, setVizMode] = useState<VizMode>('matrix')
  const [graphMode, setGraphMode] = useState<'full' | 'critical-path'>('full')
  const [focusTechnique, setFocusTechnique] = useState<string | null>(null)
  const [focusControl, setFocusControl] = useState<string | null>(null)
  const [currentSystem, setCurrentSystem] = useState('f36')

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [evidenceCaseLoading, setEvidenceCaseLoading] = useState<string | null>(null)
  const [skills, setSkills] = useState<Array<{ name: string; description: string; triggers: string[] }>>([])
  const msgIdRef = useRef(0)

  // Fetch skills for palette
  useEffect(() => {
    fetch(`${API}/api/skills`).then(r => r.ok ? r.json() : []).then(setSkills).catch(() => {})
  }, [])

  // Threat matrix data
  const [techniques, setTechniques] = useState<ThreatTechnique[]>([])
  const [matrixLoading, setMatrixLoading] = useState(true)
  const [showSub, setShowSub] = useState(false)
  const [selectedDetail, setSelectedDetail] = useState<TechniqueDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [evidenceMap, setEvidenceMap] = useState<Map<string, { verdict: string; grade: string; count: number }>>(new Map())
  const [evidenceMapLoaded, setEvidenceMapLoaded] = useState(false)
  const threatDeltaLoadedRef = useRef(false)

  // Lemma graph data
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([])
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([])

  const addMsg = useCallback((msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const m: ChatMessage = { ...msg, id: String(++msgIdRef.current), timestamp: Date.now() }
    setMessages(prev => [...prev, m])
    return m
  }, [])

  // ── Load threat matrix on mount + datalake change ────────────────────

  useEffect(() => {
    setMatrixLoading(true)
    post('/list', {
      collection: 'sparta_controls', limit: 500,
      filters: { source_framework: 'SPARTA', control_type: 'technique' },
    }).then(res => {
      const raw = res.documents ?? []
      const techs: ThreatTechnique[] = raw
        .filter((t: any) => tacticForTechnique(t.control_id))
        .filter((t: any) => showSub || !t.control_id.includes('.'))
        .map((t: any) => {
          const ev = evidenceMap.get(t.control_id)
          const verdict = ev ? ev.verdict : 'none'
          const coverage = verdict === 'satisfied' ? 'full' as const
            : verdict === 'inconclusive' ? 'partial' as const
            : verdict === 'not_satisfied' ? 'none' as const
            : 'unknown' as const
          return {
            id: t.control_id, name: t.name, description: t.description,
            tactic: tacticForTechnique(t.control_id) ?? 'Unknown',
            coverage, evidenceVerdict: verdict as any,
            evidenceCaseCount: ev?.count ?? 0, evidenceGrade: ev?.grade,
            issueCount: t.weaknesses?.length ?? 0,
            frameworks: ['SPARTA'], mind: t.mind, nrs_score: t.nrs_score,
          }
        })
        .sort((a: ThreatTechnique, b: ThreatTechnique) => a.id.localeCompare(b.id))
      setTechniques(techs)
      setMatrixLoading(false)
    })
  }, [showSub, evidenceMap])

  // Load evidence map from dedicated evidence_cases collection
  useEffect(() => {
    if (!currentSystem) { setEvidenceMap(new Map()); return }
    setEvidenceMapLoaded(false)
    post('/list', {
      collection: 'evidence_cases', limit: 500,
    }).then(res => {
      const docs = (res.documents ?? []) as any[]
      const vmap = new Map<string, { verdict: string; grade: string; count: number }>()
      for (const doc of docs) {
        const cids: string[] = doc.control_ids ?? []
        const v = doc.verdict ?? 'not_satisfied'
        const g = doc.grade ?? 'F'
        for (const cid of cids) {
          if (!SPARTA_TACTICS.some(t => cid.startsWith(t.prefix + '-'))) continue
          const existing = vmap.get(cid)
          if (!existing) { vmap.set(cid, { verdict: v, grade: g, count: 1 }) }
          else {
            existing.count++
            if (v === 'satisfied' && existing.verdict !== 'satisfied') { existing.verdict = v; existing.grade = g }
            else if (v === 'inconclusive' && existing.verdict === 'not_satisfied') { existing.verdict = v; existing.grade = g }
          }
        }
      }
      setEvidenceMap(vmap)
    }).finally(() => {
      setEvidenceMapLoaded(true)
    })
  }, [currentSystem])

  // Add threat-delta alerts on mount after evidence map is loaded
  useEffect(() => {
    if (!evidenceMapLoaded || threatDeltaLoadedRef.current) return
    threatDeltaLoadedRef.current = true
    const minTimestamp = Date.now() - (7 * 24 * 60 * 60 * 1000)

    post('/list', {
      collection: 'evidence_cases',
      limit: 20,
      filters: { type: 'threat-delta' },
    }).then(res => {
      const docs = (res.documents ?? []) as ThreatDeltaDoc[]
      for (const doc of docs) {
        const ts = toTimestampMs(doc.timestamp)
        if (ts === null || ts < minTimestamp) continue
        if (!doc.old_verdict || !doc.new_verdict || doc.old_verdict === doc.new_verdict) continue

        const controlId = doc.control_id ?? 'unknown-control'
        const reason = doc.reason ? ` ${doc.reason}` : ''
        addMsg({
          role: 'system',
          type: 'natural',
          alertType: 'threat-delta',
          content: `SECURITY DRIFT DETECTED: ${controlId} verdict changed from ${doc.old_verdict} to ${doc.new_verdict}.${reason}`,
        })
      }
    })
  }, [addMsg, evidenceMapLoaded])

  // ── Chat send handler ────────────────────────────────────────────────

  const handleSend = useCallback(async (query: string, type: 'natural' | 'aql') => {
    addMsg({ role: 'user', content: query, type })

    // Detect intent for viz switching
    const qLower = query.toLowerCase()
    const isDashboardIntent = qLower.includes('posture') || qLower.includes('dashboard') || qLower.includes('overview') || qLower.includes('status report')
    if (isDashboardIntent) {
      setVizMode('dashboard')
    }
    const isMatrixIntent = qLower.includes('threat matrix') || qLower.includes('coverage') || qLower.includes('threat landscape') || qLower.includes('show me the matrix')
    if (isMatrixIntent) {
      setVizMode('matrix')
    } else if (qLower.includes('critical path') || qLower.includes('attack chain') || qLower.includes('exploit chain') || qLower.includes('weakest chain') || qLower.includes('failing chain')) {
      setVizMode('graph')
      setGraphMode('critical-path')
    } else if (qLower.includes('proof') || qLower.includes('lemma') || qLower.includes('prove') || qLower.includes('chain')) {
      setVizMode('graph')
      setGraphMode('full')
    }

    // For matrix queries: render full matrix in viz + narrated summary in chat
    if (isMatrixIntent) {
      const satisfied = [...evidenceMap.values()].filter(v => v.verdict === 'satisfied').length
      const inconclusive = [...evidenceMap.values()].filter(v => v.verdict === 'inconclusive').length
      const notSatisfied = [...evidenceMap.values()].filter(v => v.verdict === 'not_satisfied').length
      const totalTech = techniques.length || 85
      const noEvidence = totalTech - satisfied - inconclusive - notSatisfied
      const dl = DATALAKES.find(d => d.id === currentSystem)
      const covPct = totalTech > 0 ? Math.round((satisfied / totalTech) * 100) : 0

      // Find weakest tactic
      const tacticGaps: Record<string, number> = {}
      for (const t of SPARTA_TACTICS) {
        const tacticTechs = techniques.filter(tech => tech.tactic === t.name)
        const covered = tacticTechs.filter(tech => evidenceMap.has(tech.id) && evidenceMap.get(tech.id)!.verdict === 'satisfied').length
        tacticGaps[t.name] = tacticTechs.length > 0 ? covered / tacticTechs.length : 0
      }
      const weakest = Object.entries(tacticGaps).sort((a, b) => a[1] - b[1]).slice(0, 2)

      let narration = `The ${dl?.name ?? 'F-36'} threat matrix is shown in the visualization pane. Coverage: ${covPct}% of ${totalTech} techniques have evidence.`
      if (weakest.length > 0 && weakest[0][1] < 0.5) {
        narration += `\n\nGaps: ${weakest.map(([name, pct]) => `${name} (${Math.round(pct * 100)}%)`).join(', ')} — weakest tactics.`
      }
      narration += '\n\nAsk about specific techniques or tactics to drill down.'

      addMsg({
        role: 'system', content: narration, type: 'natural',
        cascadeLayer: 'recall',
        matrixSummary: {
          totalTechniques: totalTech, totalTactics: SPARTA_TACTICS.length,
          satisfied, inconclusive, notSatisfied, noEvidence,
          datalake: dl?.name ?? 'F-36',
        },
      })
      return
    }

    try {
      // Entity extraction
      const entRes = await fetch(`${API}/api/extract-entities`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: query }),
      }).then(r => r.json()).catch(() => ({}))

      const entities: EntityRef[] = (entRes.entities ?? []).map((e: any) => ({
        id: e.control_id ?? e.id, label: e.name ?? e.control_id ?? e.id, exists: e.exists !== false,
      }))

      // Focus first entity in viz
      if (entities.length > 0 && entities[0].exists) {
        const eid = entities[0].id
        if (SPARTA_TACTICS.some(t => eid.startsWith(t.prefix + '-'))) {
          setFocusTechnique(eid)
        } else {
          setFocusControl(eid)
        }
      }

      // Recall
      const recallRes = await post('/recall', {
        q: query, collections: ['sparta_controls', 'sparta_qra'], k: 10,
      })
      const items = recallRes.items ?? []

      // Build response with recall items for RecallCard
      const content = items.length > 0
        ? `Found ${items.length} results across SPARTA corpus.`
        : 'No matching results in SPARTA corpus.'

      addMsg({
        role: 'system', content, type: 'natural',
        cascadeLayer: 'recall', resultCount: items.length,
        entities: entities.length > 0 ? entities : undefined,
        recallItems: items.slice(0, 10),
      })
    } catch (err) {
      addMsg({ role: 'system', content: `Error: ${err instanceof Error ? err.message : String(err)}`, type: 'natural' })
    }
  }, [addMsg])

  // ── Viz → Chat: cell click sends query ────────────────────────────

  const handleMatrixCellClick = useCallback((tech: ThreatTechnique) => {
    setFocusTechnique(tech.id)
    setDetailLoading(true)
    setSelectedDetail({ technique: tech, qras: [], countermeasures: [], relationships: [] })

    Promise.all([
      post('/recall', { q: `${tech.id} ${tech.name}`, collections: ['sparta_qra'], k: 10, entities: [tech.id] }),
      post('/recall', { q: tech.id, collections: ['sparta_relationships'], k: 20, entities: [tech.id] }),
    ]).then(([qraRes, relRes]) => {
      const rels = (relRes.items ?? []) as any[]
      const cmIds = [...new Set(rels
        .filter((r: any) => {
          const tid = r.target_control_id ?? ''
          return tid.startsWith('CM') || tid.startsWith('d3f:') || tid.startsWith('AC-') || tid.startsWith('SC-')
        })
        .map((r: any) => r.target_control_id)
      )]
      setSelectedDetail({
        technique: tech, qras: qraRes.items ?? [],
        relationships: rels, countermeasures: cmIds.map((id: string) => ({ control_id: id, name: id })),
      })
      setDetailLoading(false)
    })

    // Also inject into chat
    addMsg({ role: 'user', content: `Analyze technique ${tech.id}: ${tech.name}`, type: 'natural' })
    handleSend(`Analyze technique ${tech.id}: ${tech.name}`, 'natural')
  }, [addMsg, handleSend])

  // ── Graph node click → chat ────────────────────────────────────────

  const handleGraphNodeClick = useCallback((node: GraphNode) => {
    setFocusControl(node.id)
    addMsg({ role: 'user', content: `Show proof chain for ${node.id}: ${node.label}`, type: 'natural' })
    handleSend(`Show proof chain for ${node.id}: ${node.label}`, 'natural')
  }, [addMsg, handleSend])

  // ── Evidence case handler ──────────────────────────────────────────

  const handleRunEvidenceCase = useCallback(async (msg: ChatMessage) => {
    const userMsg = [...messages].reverse().find(m => m.role === 'user' && m.timestamp < msg.timestamp)
    if (!userMsg) return
    setEvidenceCaseLoading(msg.id)
    try {
      const controlId = msg.entities?.find(e => e.exists)?.id
      const res = await fetch(`${API}/api/evidence-case/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userMsg.content, controlId }),
        signal: AbortSignal.timeout(90_000),
      })
      const data = await res.json()
      const gates: EvidenceGate[] = (data.gates ?? data.gate_trace ?? []).map((g: any) => ({
        gate: g.gate ?? g.name ?? '?', passed: !!g.passed, detail: g.detail ?? '',
        duration: g.duration,
      }))
      const verdict = data.verdict?.state ?? data.verdict_state ?? 'unknown'
      const tier = data.tier ?? 'T0'
      // Build evidenceCase for ReasoningBlock
      const gateSummary = gates.map(g => (g.passed ? 'PASS' : 'FAIL') + ': ' + g.gate).join('; ')
      const controlIds: string[] = data.control_ids ?? data.verdict?.control_ids ?? msg.entities?.filter(e => e.exists).map(e => e.id) ?? []

      // Check for drift
      let drift: { old_verdict: string; new_verdict: string; timestamp: string } | undefined
      if (controlIds.length > 0) {
        try {
          const driftRes = await fetch(`${API}/api/memory/list`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ collection: 'evidence_cases', limit: 5, filters: { type: 'threat-delta' } }),
          }).then(r => r.json())
          const deltas = (driftRes.documents ?? []).filter((d: any) => controlIds.includes(d.control_id))
          if (deltas.length > 0) {
            drift = { old_verdict: deltas[0].old_verdict, new_verdict: deltas[0].new_verdict, timestamp: deltas[0].timestamp }
          }
        } catch { /* non-critical */ }
      }

      addMsg({
        role: 'system',
        content: data.answer ?? '',
        type: 'natural', cascadeLayer: 'llm',
        skillUsed: 'create-evidence-case',
        entities: msg.entities,
        verdict: { state: verdict.toUpperCase(), gates, tier },
        evidenceCase: {
          verdict: verdict.toLowerCase(),
          grade: data.verdict?.grade ?? data.grade ?? '?',
          gates_passed: gates.filter(g => g.passed).length,
          gates_total: gates.length,
          gate_summary: gateSummary,
          control_ids: controlIds,
          tier,
          drift,
          recall_count: data.recall_count ?? data.evidence?.length ?? 0,
          source_traceability: data.source_traceability,
        },
      })
    } catch (err) {
      addMsg({ role: 'system', content: `Evidence case error: ${err instanceof Error ? err.message : String(err)}`, type: 'natural' })
    } finally {
      setEvidenceCaseLoading(null)
    }
  }, [messages, addMsg])

  // ── Load lemma graph when switching to graph mode ──────────────────

  useEffect(() => {
    if (vizMode !== 'graph') return

    if (graphMode === 'critical-path') {
      // Fetch failing attack chains from critical-path endpoint
      const controlId = focusControl ?? focusTechnique ?? undefined
      fetch('http://localhost:3001/api/critical-path', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ control_id: controlId }),
      }).then(r => r.json()).then(res => {
        const nodes: GraphNode[] = (res.chains ?? []).flatMap((c: any) =>
          (c.nodes ?? []).map((n: any) => ({
            id: n.id, label: n.label ?? n.id, framework: n.framework ?? 'SPARTA',
            confidence: n.verdict === 'not_satisfied' ? 0.1 : n.verdict === 'inconclusive' ? 0.4 : 0.7,
          }))
        )
        const edges: GraphEdge[] = (res.chains ?? []).flatMap((c: any) =>
          (c.edges ?? []).map((e: any) => ({
            source: e.source, target: e.target, method: e.method ?? 'related', validated: false,
          }))
        )
        // Deduplicate nodes
        const nodeMap = new Map<string, GraphNode>()
        for (const n of nodes) if (!nodeMap.has(n.id)) nodeMap.set(n.id, n)
        setGraphNodes([...nodeMap.values()])
        setGraphEdges(edges)
      }).catch(() => { setGraphNodes([]); setGraphEdges([]) })
    } else {
      // Standard relationship graph
      const controlId = focusControl ?? focusTechnique ?? 'CWE-119'
      post('/recall', { q: controlId, collections: ['sparta_relationships'], k: 30, entities: [controlId] })
        .then(res => {
          const items = res.items ?? []
          const nodeMap = new Map<string, GraphNode>()
          const edges: GraphEdge[] = []
          for (const r of items) {
            const src = r.source_control_id ?? ''
            const tgt = r.target_control_id ?? ''
            if (!src || !tgt) continue
            if (!nodeMap.has(src)) nodeMap.set(src, { id: src, label: src, framework: r.source_framework ?? '?' })
            if (!nodeMap.has(tgt)) nodeMap.set(tgt, { id: tgt, label: tgt, framework: r.target_framework ?? '?' })
            edges.push({ source: src, target: tgt, method: r.method ?? '?', validated: !!r.gate_evidence })
          }
          setGraphNodes([...nodeMap.values()])
          setGraphEdges(edges)
        })
    }
  }, [vizMode, graphMode, focusControl, focusTechnique])

  // ── Threat matrix state/actions/meta ───────────────────────────────

  const matrixState: ThreatMatrixState = {
    tactics: SPARTA_TACTICS, techniques, loading: matrixLoading,
    showSubtechniques: showSub, selectedDetail, loadingDetail: detailLoading,
  }
  const matrixActions: ThreatMatrixActions = {
    selectTechnique: handleMatrixCellClick,
    clearSelection: useCallback(() => setSelectedDetail(null), []),
    toggleSubtechniques: useCallback(() => setShowSub(s => !s), []),
    selectDatalake: useCallback((dl: string) => setCurrentSystem(dl), []),
  }
  const matrixMeta: ThreatMatrixMeta = {
    totalControls: techniques.length, source: 'chat',
    datalakes: DATALAKES, activeDatalake: currentSystem || undefined,
  }

  // ── Context value ──────────────────────────────────────────────────

  const ctxValue: ChatTabContextValue = {
    vizMode, setVizMode, focusTechnique, setFocusTechnique,
    focusControl, setFocusControl, currentSystem, setCurrentSystem,
  }

  // ── Resizable pane ──────────────────────────────────────────────────

  const [chatWidth, setChatWidth] = useState(450)
  const dragging = useRef(false)
  const dragStartX = useRef(0)
  const dragStartW = useRef(450)

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    dragging.current = true
    dragStartX.current = e.clientX
    dragStartW.current = chatWidth

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return
      const delta = ev.clientX - dragStartX.current
      setChatWidth(Math.max(280, Math.min(800, dragStartW.current + delta)))
    }
    const onUp = () => {
      dragging.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [chatWidth])

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <ChatTabContext.Provider value={ctxValue}>
      <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>

        {/* LEFT: Chat pane (resizable) */}
        <div style={{
          width: chatWidth, minWidth: 280, maxWidth: 800,
          display: 'flex', flexDirection: 'column',
          backgroundColor: EMBRY.bg, flexShrink: 0,
        }}>
          {/* Scope + system selector */}
          <div style={{
            padding: '8px 12px',
            borderBottom: `1px solid ${EMBRY.border}`,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <span style={{ fontSize: 11, fontWeight: 900, color: EMBRY.white, letterSpacing: '0.05em' }}>SPARTA CHAT</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
              {DATALAKES.map(dl => (
                <button key={dl.id} onClick={() => setCurrentSystem(dl.id)} style={{
                  fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
                  border: 'none', cursor: 'pointer',
                  backgroundColor: currentSystem === dl.id ? EMBRY.green : `${EMBRY.white}10`,
                  color: currentSystem === dl.id ? '#000' : EMBRY.dim,
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                }}>
                  {dl.name.split(' ')[0]}
                </button>
              ))}
            </div>
          </div>

          {/* Chat messages */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <ChatWell
              messages={messages}
              onSend={handleSend}
              onFeedback={useCallback((id: string, fb: 'up' | 'down') => {
                setMessages(prev => prev.map(m => m.id === id ? { ...m, feedback: fb } : m))
              }, [])}
              onClarifyClick={useCallback((q: string) => handleSend(q, 'natural'), [handleSend])}
              onRunEvidenceCase={handleRunEvidenceCase}
              evidenceCaseLoading={evidenceCaseLoading}
              onNavigateMatrix={useCallback(() => setVizMode('matrix'), [])}
              skills={skills}
              onEntityClick={useCallback((entity: string, type: string) => {
                if (type === 'skill') {
                  // Populate input with skill
                  handleSend(entity, 'natural')
                } else {
                  // Recall the entity and focus it in viz
                  handleSend(`/memory recall "${entity}"`, 'natural')
                  if (type === 'attack' || type === 'sparta') {
                    setFocusTechnique(entity)
                    setVizMode('matrix')
                  } else if (type === 'control') {
                    setFocusControl(entity)
                  }
                }
              }, [handleSend])}
            />
          </div>
        </div>

        {/* DRAG HANDLE */}
        <div
          onMouseDown={onDragStart}
          style={{
            width: 5, cursor: 'col-resize', flexShrink: 0,
            background: dragging.current ? EMBRY.accent : EMBRY.border,
            transition: dragging.current ? 'none' : 'background 0.15s',
          }}
          onMouseEnter={(e) => { if (!dragging.current) e.currentTarget.style.background = EMBRY.accent }}
          onMouseLeave={(e) => { if (!dragging.current) e.currentTarget.style.background = EMBRY.border }}
        />

        {/* RIGHT: Visualization workspace (flex) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {/* Viz content */}
          <div style={{ flex: 1, overflow: vizMode === 'dashboard' ? 'auto' : 'hidden' }}>
            {vizMode === 'dashboard' ? (
              <PostureDashboard onNavigateToControl={(id) => { setFocusTechnique(id); setVizMode('matrix') }} />
            ) : vizMode === 'matrix' ? (
              <ThreatMatrix.Provider state={matrixState} actions={matrixActions} meta={matrixMeta}>
                <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', position: 'relative' }}>
                  <ThreatMatrix.Header />
                  <ThreatMatrix.TacticStrip />
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <ThreatMatrix.Grid />
                  </div>
                  <ThreatMatrix.Detail />
                </div>
              </ThreatMatrix.Provider>
            ) : (
              <LemmaGraph nodes={graphNodes} edges={graphEdges} onNodeClick={handleGraphNodeClick} mode={graphMode} />
            )}
          </div>
        </div>
      </div>
    </ChatTabContext.Provider>
  )
}
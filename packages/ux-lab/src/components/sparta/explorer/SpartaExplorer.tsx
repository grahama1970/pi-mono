import { createContext, useState, useEffect, useCallback, useRef, useContext, type ReactNode } from 'react'
import { EMBRY, fwBadge } from '../common/EmbryStyle'
import { StatusBar } from '../../common/StatusBar'
import { ChatWell } from '../query/ChatWell'
import type { ChatMessage, CascadeLayer, EntityRef, EvidenceGate } from '../query/ChatWell'
import { useCollectionCounts } from '../../../hooks/useSpartaCollections'
import { Zap, FileSpreadsheet, Shield, Link, HelpCircle, GitBranch, Target, Workflow, Settings, MessageSquare } from 'lucide-react'

export type Scope = 'sparta' | 'f36' | 'both'
export type GateDepth = 'fast' | 'medium' | 'accurate'

const API = 'http://localhost:3001'
const FRAMEWORKS = ['SPARTA', 'NIST', 'CWE', 'ATT&CK', 'D3FEND', 'ESA', 'ISO', 'NASA'] as const

const TABS = [
  'Overview', 'Sources', 'Controls', 'URLs',
  'QRAs', 'Relationships', 'Threat Matrix', 'Pipeline',
] as const

export type TabName = (typeof TABS)[number]
export interface SpartaTabFilter {
  controlId?: string
}

interface SpartaNavContextValue {
  navigateToTab: (tab: TabName) => void
  navigateToTabWithFilter: (tab: TabName, filter: SpartaTabFilter) => void
  tabFilters: Partial<Record<TabName, SpartaTabFilter>>
  clearTabFilter: (tab: TabName) => void
}

const SpartaNavContext = createContext<SpartaNavContextValue | undefined>(undefined)

export function useSpartaNav(): SpartaNavContextValue {
  const context = useContext(SpartaNavContext)
  if (!context) {
    throw new Error('useSpartaNav must be used within SpartaExplorer')
  }
  return context
}

// Lucide icons for the global nav strip
const TAB_ICON_COMPONENTS: Record<TabName, typeof Zap> = {
  'Overview': Zap,
  'Sources': FileSpreadsheet,
  'Controls': Shield,
  'URLs': Link,
  'QRAs': HelpCircle,
  'Relationships': GitBranch,
  'Threat Matrix': Target,
  'Pipeline': Workflow,
}

interface TabPlaceholderProps { name: TabName; message?: string }
function TabPlaceholder({ name, message }: TabPlaceholderProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: EMBRY.dim }}>
      <span style={{ fontSize: 18, fontWeight: 700 }}>{name}</span>
      <span style={{ fontSize: 13, marginLeft: 8, opacity: 0.5 }}>— {message ?? 'no data available'}</span>
    </div>
  )
}

export interface SpartaExplorerProps {
  views?: Partial<Record<TabName, ReactNode>>
  loadingTabs?: Partial<Record<TabName, boolean>>
}

export function SpartaExplorer({ views = {}, loadingTabs = {} }: SpartaExplorerProps) {
  const [activeTab, setActiveTab] = useState<TabName>('Overview')
  const [tabFilters, setTabFilters] = useState<Partial<Record<TabName, SpartaTabFilter>>>({})
  const [daemonHealth, setDaemonHealth] = useState<{ ok: boolean; counts?: Record<string, number> }>({ ok: false })

  // Query settings
  const [scope, setScope] = useState<Scope>('sparta')
  const [gateDepth, setGateDepth] = useState<GateDepth>('fast')
  const [frameworkFilters, setFrameworkFilters] = useState<Record<string, boolean>>(
    () => Object.fromEntries(FRAMEWORKS.map(fw => [fw, true]))
  )
  const collectionCounts = useCollectionCounts()

  // Pane state
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const sessionId = useState(() => crypto.randomUUID())[0]
  const msgIdRef = useRef(0)

  const toggleFramework = useCallback((fw: string) => {
    setFrameworkFilters(prev => ({ ...prev, [fw]: !prev[fw] }))
  }, [])

  const navigateToTab = useCallback((tab: TabName) => {
    setActiveTab(tab)
  }, [])

  const navigateToTabWithFilter = useCallback((tab: TabName, filter: SpartaTabFilter) => {
    setTabFilters(prev => ({ ...prev, [tab]: filter }))
    setActiveTab(tab)
  }, [])

  const clearTabFilter = useCallback((tab: TabName) => {
    setTabFilters(prev => {
      if (!(tab in prev)) return prev
      const next = { ...prev }
      delete next[tab]
      return next
    })
  }, [])

  const navContextValue: SpartaNavContextValue = {
    navigateToTab,
    navigateToTabWithFilter,
    tabFilters,
    clearTabFilter,
  }

  // Keyboard: 1-8 tabs, Escape close flyouts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
        if (e.key === 'Escape') { setRightOpen(false); setSettingsOpen(false); setLeftOpen(false); return }
        const num = Number.parseInt(e.key)
        if (num >= 1 && num <= TABS.length) navigateToTab(TABS[num - 1])
      }
      window.addEventListener('keydown', onKeyDown)
      return () => window.removeEventListener('keydown', onKeyDown)
    }, [navigateToTab])

  // Health check
  const checkHealth = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/health`)
      const data = await res.json()
      setDaemonHealth({ ok: data.memory_daemon === 'connected', counts: data.counts })
    } catch { setDaemonHealth({ ok: false }) }
  }, [])

  useEffect(() => {
    checkHealth()
    const interval = setInterval(checkHealth, 30_000)
    return () => clearInterval(interval)
  }, [checkHealth])

  // ── Chat cascade pipeline ────────────────────────────────────────────────

  function scopeToCollections(s: Scope): string[] {
    if (s === 'f36') return ['binary_features']
    if (s === 'both') return ['sparta_controls', 'sparta_qra', 'binary_features']
    return ['sparta_controls', 'sparta_qra']
  }

  const addMsg = useCallback((msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const m: ChatMessage = { ...msg, id: String(++msgIdRef.current), timestamp: Date.now() }
    setMessages(prev => [...prev, m])
    return m
  }, [])

  const handleSend = useCallback(async (query: string, type: 'natural' | 'aql') => {
    addMsg({ role: 'user', content: query, type })

    if (type === 'aql') {
      try {
        const res = await fetch(`${API}/api/memory/recall`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query, collections: scopeToCollections(scope), k: 20 }),
        })
        const data = await res.json()
        const items = data.items ?? data.documents ?? []
        addMsg({ role: 'system', content: JSON.stringify(items, null, 2), type: 'aql', cascadeLayer: 'aql', resultCount: items.length })
      } catch (err) {
        addMsg({ role: 'system', content: `AQL error: ${err instanceof Error ? err.message : String(err)}`, type: 'aql' })
      }
      return
    }

    try {
      let entities: EntityRef[] = []
      let groundingOk = true
      try {
        const entRes = await fetch(`${API}/api/extract-entities`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: query, collection: scope === 'f36' ? 'binary_features' : 'sparta_controls' }),
        })
        const entData = await entRes.json()
        entities = (entData.entities ?? []).map((e: any) => ({ id: e.id ?? e.name, label: e.label ?? e.name, exists: e.exists !== false }))
        groundingOk = entData.grounding_ok !== false
      } catch {}

      const recallRes = await fetch(`${API}/api/memory/recall`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, k: 3, tags: ['intent-training-v2'], collections: scopeToCollections(scope) }),
      })
      const recallData = await recallRes.json()
      const topHit = (recallData.items ?? [])[0]
      const confidence = topHit?.score ?? topHit?.confidence ?? 0

      if (confidence >= 0.75 && topHit?.solution) {
        addMsg({ role: 'system', content: topHit.solution, type: 'natural', cascadeLayer: 'recall', resultCount: recallData.items?.length ?? 0, entities, _querySpec: { source: 'recall_cache', confidence } })
        persistResult(query, { source: 'recall_cache' }, topHit.solution, 'SATISFIED')
        return
      }

      const gates: EvidenceGate[] = []
      let gateState: 'SATISFIED' | 'INCONCLUSIVE' | 'NOT_SATISFIED' = 'SATISFIED'
      gates.push({ gate: 'grounding', passed: groundingOk, detail: groundingOk ? 'Entities exist' : 'Some not found' })
      if (!groundingOk) gateState = 'INCONCLUSIVE'

      if (gateDepth === 'medium' || gateDepth === 'accurate') {
        const qraRes = await fetch(`${API}/api/memory/recall`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query, collections: ['sparta_qra'], k: 3 }),
        })
        const qraData = await qraRes.json()
        const hasQra = (qraData.items?.length ?? 0) > 0
        gates.push({ gate: 'qra_coverage', passed: hasQra, detail: hasQra ? `${qraData.items.length} QRA hits` : 'No QRA coverage' })
        if (!hasQra) gateState = 'INCONCLUSIVE'
      }

      if (gateDepth === 'accurate') {
        try {
          const clarifyRes = await fetch(`${API}/api/memory/clarify`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: query, scope }),
          })
          const ok = !(await clarifyRes.json()).ambiguous
          gates.push({ gate: 'disambiguation', passed: ok, detail: ok ? 'Unambiguous' : 'Multiple interpretations' })
          if (!ok && gateState === 'SATISFIED') gateState = 'INCONCLUSIVE'
        } catch {
          gates.push({ gate: 'disambiguation', passed: true, detail: 'Unavailable' })
        }
      }

      if (gateState === 'NOT_SATISFIED' || (gateState === 'INCONCLUSIVE' && gateDepth !== 'fast')) {
        let clarifyOptions: Array<{ question: string }> = []
        try {
          const cRes = await fetch(`${API}/api/memory/clarify`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: query, scope }),
          })
          const cData = await cRes.json()
          clarifyOptions = (cData.suggestions ?? cData.alternatives ?? []).map((s: any) => ({
            question: typeof s === 'string' ? s : s.question ?? s.text ?? String(s),
          })).slice(0, 5)
        } catch {}
        addMsg({ role: 'system', content: gateState === 'NOT_SATISFIED' ? 'Cannot verify this query is answerable.' : 'Some gates inconclusive.', type: 'natural', entities, verdict: { state: gateState, gates }, clarifyOptions })
        if (gateState === 'NOT_SATISFIED') return
      }

      let querySpec: Record<string, unknown> | null = null
      try {
        const intentRes = await fetch(`${API}/api/memory/intent`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query, scope, session_id: sessionId, fast: false }),
        })
        querySpec = (await intentRes.json()).query_spec ?? null
      } catch {}

      let content = ''
      let resultCount = 0
      let layer: CascadeLayer = 'intent'

      if (querySpec) {
        const qs = querySpec as any
        const execRes = await fetch(`${API}/api/memory/recall`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: qs.keywords?.join(' ') || query, collections: scopeToCollections(scope), k: qs.k || 12, entities: qs.entities }),
        })
        const items = (await execRes.json()).items ?? []
        resultCount = items.length
        if (items.length > 0) {
          content = items.slice(0, 8).map((item: any, i: number) => {
            const id = item.control_id || item._key || ''
            const name = item.name || item.question || item.text || ''
            const desc = item.description || item.answer || item.reasoning || ''
            return `**${i + 1}. ${id}** ${name}\n${desc.slice(0, 200)}${desc.length > 200 ? '...' : ''}`
          }).join('\n\n')
          if (items.length > 8) content += `\n\n*...and ${items.length - 8} more*`
        }
      }

      if (!content) {
        layer = 'llm'
        const llmRes = await fetch(`${API}/api/scillm`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'text', messages: [{ role: 'system', content: 'You are Embry, a helpful SPARTA security controls assistant. Answer concisely.' }, { role: 'user', content: query }], temperature: 0.3, max_tokens: 512 }),
        })
        content = (await llmRes.json()).choices?.[0]?.message?.content || 'No response'
      }

      addMsg({ role: 'system', content, type: 'natural', cascadeLayer: layer, resultCount, entities, _querySpec: querySpec ?? undefined, verdict: gates.length > 0 ? { state: gateState, gates } : undefined })
      persistResult(query, querySpec, content, gateState)
    } catch (err) {
      addMsg({ role: 'system', content: `Error: ${err instanceof Error ? err.message : String(err)}`, type: 'natural' })
    }
  }, [scope, gateDepth, addMsg, sessionId])

  const persistResult = useCallback(async (question: string, querySpec: any, answer: string, verdict: string) => {
    try {
      await fetch(`${API}/api/memory/learn`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem: question, solution: answer, metadata: { querySpec, verdict, session_id: sessionId }, tags: ['sparta-explorer-feedback', 'intent-training-v2'], scope: 'sparta-explorer' }),
      })
    } catch {}
  }, [sessionId])

  const handleFeedback = useCallback((id: string, fb: 'up' | 'down') => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, feedback: fb } : m))
    const msg = messages.find(m => m.id === id)
    if (!msg) return
    const userMsg = [...messages].reverse().find(m => m.role === 'user' && m.timestamp < msg.timestamp)
    if (userMsg) {
      fetch(`${API}/api/memory/learn`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem: userMsg.content, solution: msg.content, metadata: { feedback: fb, querySpec: msg._querySpec }, tags: ['sparta-explorer-feedback', 'intent-training-v2', fb === 'up' ? 'positive' : 'negative'], scope: 'sparta-explorer' }),
      }).catch(() => {})
    }
  }, [messages])

  const handleClarify = useCallback((q: string) => { handleSend(q, 'natural') }, [handleSend])

  // ── Evidence Case ───────────────────────────────────────────────────────
  const [evidenceCaseLoading, setEvidenceCaseLoading] = useState<string | null>(null)

  const handleRunEvidenceCase = useCallback(async (msg: ChatMessage) => {
    // Find the user query that preceded this system message
    const userMsg = [...messages].reverse().find(m => m.role === 'user' && m.timestamp < msg.timestamp)
    if (!userMsg) return
    setEvidenceCaseLoading(msg.id)
    try {
      const controlId = msg.entities?.find(e => e.exists)?.id
      const res = await fetch(`${API}/api/evidence-case/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: userMsg.content, controlId }),
        signal: AbortSignal.timeout(90_000),
      })
      const data = await res.json()
      const gates: EvidenceGate[] = (data.gates ?? data.gate_trace ?? []).map((g: any) => ({
        gate: g.gate ?? g.name ?? '?',
        passed: !!g.passed,
        detail: g.detail ?? '',
      }))
      const verdict = data.verdict?.state ?? data.verdict_state ?? 'unknown'
      const tier = data.tier ?? 'T0'
      const tierLabel = tier === 'T2' ? ' [LLM Adjudicated]' : ''
      addMsg({
        role: 'system',
        content: `Evidence Case: ${verdict.toUpperCase()}${tierLabel}\n${data.answer ?? ''}`,
        type: 'natural',
        cascadeLayer: 'llm',
        entities: msg.entities,
        verdict: { state: verdict.toUpperCase(), gates },
      })
    } catch (err) {
      addMsg({ role: 'system', content: `Evidence case error: ${err instanceof Error ? err.message : String(err)}`, type: 'natural' })
    } finally {
      setEvidenceCaseLoading(null)
    }
  }, [messages, addMsg])

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={S.container}>
      <div style={S.main}>

        {/* PANE 1: Icon-only global nav (always visible) */}
        <nav style={S.iconNav}>
          {TABS.map((tab, i) => (
              <button
                key={tab}
                onClick={() => navigateToTab(tab)}
                title={`${tab} (${i + 1})`}
                style={{
                  ...S.navBtn,
                ...(activeTab === tab ? S.navBtnActive : {}),
              }}
            >
              {(() => { const Icon = TAB_ICON_COMPONENTS[tab]; return <Icon size={16} /> })()}
            </button>
          ))}
          {/* Spacer */}
          <div style={{ flex: 1 }} />
          {/* Settings */}
          <button onClick={() => setSettingsOpen(true)} title="Query settings" style={S.navBtn}>
            <Settings size={16} />
          </button>
          {/* Query toggle */}
          <button
            onClick={() => setRightOpen(!rightOpen)}
            title="Toggle query pane"
            style={{ ...S.navBtn, ...(rightOpen ? S.navBtnActive : {}) }}
          >
            <MessageSquare size={16} />
          </button>
        </nav>

        {/* PANE 2: Sources/explorer (expandable) */}
        {leftOpen && (
          <aside style={S.sourcesPane}>
            <div style={S.paneHeader}>
              <span>SPARTA Explorer</span>
              <button onClick={() => setLeftOpen(false)} style={S.paneClose}>{'\u00D7'}</button>
            </div>
            {/* View navigation with counts */}
              {TABS.map((tab) => (
                <button key={tab} onClick={() => { navigateToTab(tab); setLeftOpen(false) }} style={{
                  ...S.sourceItem,
                  ...(activeTab === tab ? S.sourceItemActive : {}),
                }}>
                <span>{tab}</span>
                {loadingTabs[tab] && <span style={{ width: 4, height: 4, borderRadius: '50%', backgroundColor: EMBRY.accent, animation: 'pulse 1s infinite' }} />}
              </button>
            ))}
            {/* Collection stats */}
            <div style={{ padding: '12px 16px', borderTop: `1px solid ${EMBRY.border}`, marginTop: 'auto' }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 6 }}>Collections</div>
              {collectionCounts.loading ? (
                <span style={{ fontSize: 9, color: EMBRY.dim }}>loading...</span>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <CountRow label="controls" value={collectionCounts.controls} />
                  <CountRow label="qras" value={collectionCounts.qras} />
                  <CountRow label="relationships" value={collectionCounts.relationships} />
                  <CountRow label="urls" value={collectionCounts.urls} />
                  <CountRow label="knowledge" value={collectionCounts.knowledge} />
                </div>
              )}
            </div>
          </aside>
        )}

          {/* PANE 3: Main data table (always fills remaining space) */}
          <SpartaNavContext.Provider value={navContextValue}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden', minWidth: 0 }}>
              {TABS.map((tab) => (
                <div key={tab} style={{ display: activeTab === tab ? 'flex' : 'none', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
                  {views[tab] ?? <TabPlaceholder name={tab} />}
                </div>
              ))}
            </div>
          </SpartaNavContext.Provider>
      </div>

      {/* PANE 4: Query flyout drawer (overlays from right) */}
      <div style={{ ...S.drawer, ...(rightOpen ? S.drawerOpen : {}) }}>
        <div style={S.drawerHead}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 900, color: EMBRY.white }}>Query</span>
            <button onClick={() => setRightOpen(false)} style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', fontSize: 18 }}>{'\u00D7'}</button>
          </div>
          {/* Compact scope + gate */}
          <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
            <div style={{ display: 'flex', gap: 1, flex: 1 }}>
              {(['sparta', 'f36', 'both'] as const).map(s => (
                <button key={s} onClick={() => setScope(s)} style={{ ...toggleSm, ...(scope === s ? toggleActive : {}) }}>
                  {s === 'f36' ? 'F-36' : s === 'both' ? 'Both' : 'SPARTA'}
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 1 }}>
              {(['fast', 'medium', 'accurate'] as const).map(g => (
                <button key={g} onClick={() => setGateDepth(g)} style={{ ...toggleSm, ...(gateDepth === g ? toggleActive : {}) }}>
                  {g === 'fast' ? 'F' : g === 'medium' ? 'M' : 'A'}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <ChatWell messages={messages} onSend={handleSend} onFeedback={handleFeedback} onClarifyClick={handleClarify} onRunEvidenceCase={handleRunEvidenceCase} evidenceCaseLoading={evidenceCaseLoading} />
        </div>
      </div>

      {/* Shared status bar */}
      <StatusBar
        projectId="sparta-explorer"
        connected={daemonHealth.ok}
        connectionLabel="daemon connected"
        items={[
          { label: activeTab },
          ...(!collectionCounts.loading ? [
            { label: `${collectionCounts.controls.toLocaleString()} controls` },
            { label: `${collectionCounts.qras.toLocaleString()} QRAs` },
            { label: `${collectionCounts.relationships.toLocaleString()} rels` },
          ] : []),
        ]}
        rightItems={[
          { label: `scope: ${scope}` },
          { label: `gate: ${gateDepth}` },
          { label: '1-8 switch tabs', color: EMBRY.muted },
        ]}
      />

      {/* Settings modal */}
      {settingsOpen && (
        <div style={S.modalOverlay} onClick={() => setSettingsOpen(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 14, fontWeight: 900, color: EMBRY.white }}>Query Settings</span>
              <button onClick={() => setSettingsOpen(false)} style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', fontSize: 18 }}>{'\u00D7'}</button>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={S.modalLabel}>Scope</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['sparta', 'f36', 'both'] as const).map(s => (
                  <button key={s} onClick={() => setScope(s)} style={{ ...toggleMd, ...(scope === s ? toggleActive : {}) }}>
                    {s === 'f36' ? 'F-36' : s === 'both' ? 'Both' : 'SPARTA'}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={S.modalLabel}>Gate Depth</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['fast', 'medium', 'accurate'] as const).map(g => (
                  <button key={g} onClick={() => setGateDepth(g)} style={{ ...toggleMd, ...(gateDepth === g ? toggleActive : {}) }}>
                    {g.charAt(0).toUpperCase() + g.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div style={S.modalLabel}>Frameworks</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 16px' }}>
                {FRAMEWORKS.map(fw => (
                  <label key={fw} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={frameworkFilters[fw] ?? true} onChange={() => toggleFramework(fw)} style={{ accentColor: EMBRY.fw[fw] ?? EMBRY.accent, width: 14, height: 14 }} />
                    <span style={{ ...fwBadge(fw), fontSize: 10 }}>{fw}</span>
                  </label>
                ))}
              </div>
            </div>
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: `1px solid ${EMBRY.border}` }}>
              <div style={S.modalLabel}>Collections</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 16px' }}>
                <CountRow label="controls" value={collectionCounts.controls} />
                <CountRow label="qras" value={collectionCounts.qras} />
                <CountRow label="relationships" value={collectionCounts.relationships} />
                <CountRow label="urls" value={collectionCounts.urls} />
                <CountRow label="knowledge" value={collectionCounts.knowledge} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export { TABS }

function CountRow({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, lineHeight: '18px' }}>
      <span style={{ color: EMBRY.dim }}>{label}</span>
      <span style={{ color: value > 0 ? EMBRY.white : EMBRY.muted, fontVariantNumeric: 'tabular-nums' }}>{value.toLocaleString()}</span>
    </div>
  )
}

const toggleSm: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em',
  padding: '2px 8px', borderRadius: 3, border: 'none', cursor: 'pointer',
  backgroundColor: 'transparent', color: EMBRY.dim, transition: 'all 0.15s',
  flex: 1, textAlign: 'center',
}
const toggleMd: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, padding: '6px 16px', borderRadius: 4, border: 'none',
  cursor: 'pointer', backgroundColor: 'transparent', color: EMBRY.dim, transition: 'all 0.15s',
}
const toggleActive: React.CSSProperties = {
  backgroundColor: EMBRY.accent, color: '#fff',
}

const S = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    overflow: 'hidden',
    position: 'relative' as const,
  },
  main: {
    display: 'flex',
    flex: 1,
    overflow: 'hidden',
    backgroundColor: EMBRY.bg,
  },

  // PANE 1: Icon-only global nav
  iconNav: {
    width: 52,
    flexShrink: 0,
    backgroundColor: '#000000',
    borderRight: `1px solid ${EMBRY.border}`,
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    padding: '12px 0',
    gap: 4,
  },
  navBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: EMBRY.dim,
    transition: '0.2s',
    border: 'none',
    background: 'none',
  } as React.CSSProperties,
  navBtnActive: {
    background: '#1a1d23',
    color: EMBRY.green,
    border: `1px solid ${EMBRY.green}4d`,
    boxShadow: `0 0 15px ${EMBRY.green}1a`,
  } as React.CSSProperties,

  // PANE 2: Sources/explorer
  sourcesPane: {
    width: 240,
    flexShrink: 0,
    backgroundColor: EMBRY.bgPanel,
    borderRight: `1px solid ${EMBRY.border}`,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'auto',
  },
  paneHeader: {
    padding: '14px 16px',
    fontSize: 11,
    fontWeight: 700,
    color: EMBRY.white,
    borderBottom: `1px solid ${EMBRY.border}`,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexShrink: 0,
  },
  paneClose: {
    background: 'none',
    border: 'none',
    color: EMBRY.dim,
    cursor: 'pointer',
    fontSize: 14,
    padding: '0 2px',
  } as React.CSSProperties,
  sourceItem: {
    padding: '10px 16px',
    fontSize: 12,
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    transition: '0.15s',
    borderLeft: '3px solid transparent',
    background: 'none',
    border: 'none',
    width: '100%',
    color: EMBRY.dim,
    textAlign: 'left' as const,
  } as React.CSSProperties,
  sourceItemActive: {
    backgroundColor: '#161a1f',
    color: EMBRY.green,
    borderLeftColor: EMBRY.green,
  } as React.CSSProperties,

  // PANE 4: Flyout drawer (overlays from right)
  drawer: {
    position: 'fixed' as const,
    right: -500,
    top: 0,
    width: 460,
    height: '100%',
    backgroundColor: EMBRY.bgPanel,
    borderLeft: `1px solid ${EMBRY.border}`,
    boxShadow: '-20px 0 50px rgba(0,0,0,0.8)',
    transition: '0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    zIndex: 1000,
    display: 'flex',
    flexDirection: 'column' as const,
  },
  drawerOpen: {
    right: 0,
  },
  drawerHead: {
    padding: '16px 20px',
    borderBottom: `1px solid ${EMBRY.border}`,
    backgroundColor: '#0a0b0d',
    flexShrink: 0,
  },

  // Modal
  modalOverlay: {
    position: 'fixed' as const,
    inset: 0,
    backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
  },
  modal: {
    backgroundColor: EMBRY.bgCard,
    border: `1px solid ${EMBRY.border}`,
    borderRadius: 12,
    padding: 24,
    width: 420,
    maxHeight: '80vh',
    overflow: 'auto',
    boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
  },
  modalLabel: {
    fontSize: 10,
    fontWeight: 700,
    color: EMBRY.dim,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.1em',
    marginBottom: 6,
  },
}

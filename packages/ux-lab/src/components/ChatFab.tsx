import { useState, useCallback, useRef } from 'react'
import { EMBRY, glowDot } from './sparta/common/EmbryStyle'
import { ChatWell } from './sparta/query/ChatWell'
import type { ChatMessage, CascadeLayer, EntityRef, EvidenceGate } from './shared-chat'
import type { Scope, GateDepth } from './sparta/explorer/SpartaExplorer'
import type { TabName } from './sparta/explorer/SpartaExplorer'

const API = 'http://localhost:3001'

let msgId = 0

function scopeToCollections(scope: Scope): string[] {
  if (scope === 'f36') return ['binary_features']
  if (scope === 'both') return ['sparta_controls', 'sparta_qra', 'binary_features']
  return ['sparta_controls', 'sparta_qra']
}

function scopeToEntityCollection(scope: Scope): string {
  if (scope === 'f36') return 'binary_features'
  return 'sparta_controls'
}

interface ChatFabProps {
  scope?: Scope
  gateDepth?: GateDepth
  onNavigate?: (tab: TabName) => void
  onQuery?: (query: string) => void
}

/** Floating Embry chat — wraps the shared ChatWell component in a FAB overlay */
export function ChatFab({ scope = 'sparta', gateDepth = 'fast', onNavigate, onQuery }: ChatFabProps) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [lastLayer, setLastLayer] = useState<CascadeLayer | null>(null)
  const [skills, setSkills] = useState<Array<{ name: string; description: string; triggers: string[] }>>([])

  // Fetch skills once on first open
  const skillsFetched = useRef(false)
  if (open && !skillsFetched.current) {
    skillsFetched.current = true
    fetch(`${API}/api/skills`).then(r => r.ok ? r.json() : []).then(setSkills).catch(() => {})
  }
  const sessionId = useRef(crypto.randomUUID())

  const addMessage = useCallback((msg: Omit<ChatMessage, 'id' | 'timestamp'>) => {
    const m: ChatMessage = { ...msg, id: String(++msgId), timestamp: Date.now() }
    setMessages(prev => [...prev, m])
    return m
  }, [])

  const updateMessage = useCallback((id: string, updates: Partial<ChatMessage>) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m))
  }, [])

  // ── Full cascade pipeline ──────────────────────────────────────────────

  const handleSend = useCallback(async (query: string, type: 'natural' | 'aql') => {
    addMessage({ role: 'user', content: query, type })
    onQuery?.(query)

    // 2b. AQL passthrough — skip cascade
    if (type === 'aql') {
      try {
        const res = await fetch(`${API}/api/memory/recall`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query, collections: scopeToCollections(scope), k: 20, raw_aql: true }),
        })
        const data = await res.json()
        const items = data.items ?? data.documents ?? []
        addMessage({
          role: 'system', content: JSON.stringify(items, null, 2), type: 'aql',
          cascadeLayer: 'aql', resultCount: items.length,
        })
        setLastLayer('aql')
      } catch (err) {
        addMessage({ role: 'system', content: `AQL error: ${err instanceof Error ? err.message : String(err)}`, type: 'aql' })
      }
      return
    }

    // 2c. Correction steering — if last assistant got thumbs down
    const lastAssistant = [...messages].reverse().find(m => m.role === 'system')
    if (lastAssistant?.feedback === 'down') {
      try {
        await fetch(`${API}/api/memory/learn`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            problem: lastAssistant.content,
            solution: query,
            tags: ['sparta-explorer-feedback', 'intent-training-v2', 'correction'],
            scope: 'sparta-explorer',
          }),
        })
      } catch { /* non-critical */ }
    }

    try {
      // 2d. Entity extraction
      let entities: EntityRef[] = []
      let groundingOk = true
      try {
        const entRes = await fetch(`${API}/api/extract-entities`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: query, collection: scopeToEntityCollection(scope) }),
        })
        const entData = await entRes.json()
        entities = (entData.entities ?? []).map((e: any) => ({
          id: e.id ?? e.name, label: e.label ?? e.name, exists: e.exists !== false,
        }))
        groundingOk = entData.grounding_ok !== false
      } catch { /* entity extraction optional */ }

      // 2e. Recall grounding (Layer 1, ~50ms)
      const recallRes = await fetch(`${API}/api/memory/recall`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          q: query,
          k: 3,
          tags: ['intent-training-v2'],
          collections: scopeToCollections(scope),
        }),
      })
      const recallData = await recallRes.json()
      const topHit = (recallData.items ?? [])[0]
      const recallConfidence = topHit?.score ?? topHit?.confidence ?? 0

      if (recallConfidence >= 0.75 && topHit?.solution) {
        const msg = addMessage({
          role: 'system', content: topHit.solution, type: 'natural',
          cascadeLayer: 'recall', resultCount: recallData.items?.length ?? 0,
          entities,
          _querySpec: { source: 'recall_cache', confidence: recallConfidence },
        })
        setLastLayer('recall')
        persistResult(query, { source: 'recall_cache' }, topHit.solution, 'SATISFIED')
        return
      }

      // 2f. Evidence gate
      const gates: EvidenceGate[] = []
      let gateState: 'SATISFIED' | 'INCONCLUSIVE' | 'NOT_SATISFIED' = 'SATISFIED'

      // FAST: grounding check
      gates.push({ gate: 'grounding', passed: groundingOk, detail: groundingOk ? 'Entities exist in corpus' : 'Some entities not found' })
      if (!groundingOk) gateState = 'INCONCLUSIVE'

      if (gateDepth === 'medium' || gateDepth === 'accurate') {
        // MEDIUM: check QRA hits for entity coherence
        const qraRes = await fetch(`${API}/api/memory/recall`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query, collections: ['sparta_qra'], k: 3 }),
        })
        const qraData = await qraRes.json()
        const hasQra = (qraData.items?.length ?? 0) > 0
        gates.push({ gate: 'qra_coverage', passed: hasQra, detail: hasQra ? `${qraData.items.length} QRA hits` : 'No QRA coverage' })
        if (!hasQra) gateState = 'INCONCLUSIVE'
      }

      if (gateDepth === 'accurate') {
        // ACCURATE: call clarify for disambiguation
        try {
          const clarifyRes = await fetch(`${API}/api/memory/clarify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: query, scope: scope }),
          })
          const clarifyData = await clarifyRes.json()
          const disambiguated = !clarifyData.ambiguous
          gates.push({ gate: 'disambiguation', passed: disambiguated, detail: disambiguated ? 'Query unambiguous' : 'Multiple interpretations possible' })
          if (!disambiguated && gateState === 'SATISFIED') gateState = 'INCONCLUSIVE'
        } catch {
          gates.push({ gate: 'disambiguation', passed: true, detail: 'Clarify unavailable, proceeding' })
        }
      }

      // If gate failed, show failure + clarify chips
      if (gateState === 'NOT_SATISFIED' || (gateState === 'INCONCLUSIVE' && gateDepth !== 'fast')) {
        let clarifyOptions: Array<{ question: string }> = []
        try {
          const cRes = await fetch(`${API}/api/memory/clarify`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ q: query, scope: scope }),
          })
          const cData = await cRes.json()
          clarifyOptions = (cData.suggestions ?? cData.alternatives ?? []).map((s: any) => ({
            question: typeof s === 'string' ? s : s.question ?? s.text ?? String(s),
          })).slice(0, 5)
        } catch { /* no alternatives */ }

        addMessage({
          role: 'system',
          content: gateState === 'NOT_SATISFIED'
            ? 'Could not verify this query is answerable from available data.'
            : 'Some evidence gates were inconclusive. Results may be partial.',
          type: 'natural',
          entities,
          verdict: { state: gateState, gates },
          clarifyOptions,
        })
        // If INCONCLUSIVE, still proceed to intent. If NOT_SATISFIED, stop.
        if (gateState === 'NOT_SATISFIED') return
      }

      // 2g. Intent API (Layer 2)
      let querySpec: Record<string, unknown> | null = null
      try {
        const intentRes = await fetch(`${API}/api/memory/intent`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query, scope: scope, session_id: sessionId.current, fast: false }),
        })
        const intentData = await intentRes.json()
        querySpec = intentData.query_spec ?? intentData
      } catch { /* intent optional, fall through to LLM */ }

      // 2h. Execute (Layer 3)
      let resultContent = ''
      let resultCount = 0
      let layer: CascadeLayer = 'intent'

      if (querySpec) {
        // Execute via recall with QuerySpec params
        const qs = querySpec as any
        const execRes = await fetch(`${API}/api/memory/recall`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            q: qs.keywords?.join(' ') || query,
            collections: scopeToCollections(scope),
            k: qs.k || 12,
            entities: qs.entities,
          }),
        })
        const execData = await execRes.json()
        const items = execData.items ?? []
        resultCount = items.length

        if (items.length > 0) {
          // Format results
          resultContent = items.slice(0, 8).map((item: any, i: number) => {
            const id = item.control_id || item._key || ''
            const name = item.name || item.question || item.text || ''
            const desc = item.description || item.answer || item.reasoning || ''
            return `**${i + 1}. ${id}** ${name}\n${desc.slice(0, 200)}${desc.length > 200 ? '...' : ''}`
          }).join('\n\n')
          if (items.length > 8) resultContent += `\n\n*...and ${items.length - 8} more results*`
        }
      }

      // Fall back to LLM if no results from recall
      if (!resultContent) {
        layer = 'llm'
        const llmRes = await fetch(`${API}/api/scillm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'text',
            messages: [
              { role: 'system', content: 'You are Embry, a helpful lab assistant for SPARTA security controls. Answer concisely. Reference specific controls and CWEs where possible.' },
              { role: 'user', content: query },
            ],
            temperature: 0.3,
            max_tokens: 512,
          }),
        })
        const llmData = await llmRes.json()
        resultContent = llmData.choices?.[0]?.message?.content || llmData.error || 'No response'
      }

      const msg = addMessage({
        role: 'system', content: resultContent, type: 'natural',
        cascadeLayer: layer, resultCount, entities,
        _querySpec: querySpec ?? undefined,
        verdict: gates.length > 0 ? { state: gateState, gates } : undefined,
      })
      setLastLayer(layer)

      // 2i. Persist
      persistResult(query, querySpec, resultContent, gateState)

    } catch (err) {
      addMessage({
        role: 'system',
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        type: 'natural',
      })
    }
  }, [scope, gateDepth, messages, addMessage, onQuery])

  // Persist results to memory for training
  const persistResult = useCallback(async (question: string, querySpec: any, answer: string, verdict: string) => {
    try {
      await fetch(`${API}/api/memory/learn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problem: question,
          solution: answer,
          metadata: { querySpec, verdict, session_id: sessionId.current },
          tags: ['sparta-explorer-feedback', 'intent-training-v2'],
          scope: 'sparta-explorer',
        }),
      })
    } catch { /* non-critical */ }
  }, [])

  // Handle feedback (thumbs up/down)
  const handleFeedback = useCallback((msgIdStr: string, feedback: 'up' | 'down') => {
    updateMessage(msgIdStr, { feedback })
    // Find the message to persist
    const msg = messages.find(m => m.id === msgIdStr)
    if (!msg) return
    const userMsg = [...messages].reverse().find(m => m.role === 'user' && m.timestamp < msg.timestamp)
    if (userMsg) {
      fetch(`${API}/api/memory/learn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          problem: userMsg.content,
          solution: msg.content,
          metadata: { feedback, querySpec: msg._querySpec, cascadeLayer: msg.cascadeLayer },
          tags: ['sparta-explorer-feedback', 'intent-training-v2', feedback === 'up' ? 'positive' : 'negative'],
          scope: 'sparta-explorer',
        }),
      }).catch(() => {})
    }
  }, [messages, updateMessage])

  // Handle clarify chip click
  const handleClarify = useCallback((question: string) => {
    handleSend(question, 'natural')
  }, [handleSend])

  // Layer color for header indicator
  const layerLabel = lastLayer
    ? { recall: 'via recall (free)', intent: 'via intent', llm: 'via /scillm', aql: 'via AQL' }[lastLayer]
    : 'via cascade'
  const layerColor = lastLayer
    ? { recall: EMBRY.green, intent: EMBRY.blue, llm: EMBRY.amber, aql: EMBRY.accent }[lastLayer]
    : EMBRY.dim

  if (!open) {
    return (
      <button
        data-qid="chat-fab:open" title="Open chat" onClick={() => setOpen(true)}
        title="Chat with Embry"
        data-qs-action="OPEN_CHAT_FAB"
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          width: 48,
          height: 48,
          borderRadius: '50%',
          border: `2px solid ${EMBRY.accent}44`,
          backgroundColor: EMBRY.bgCard,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: `0 4px 24px ${EMBRY.accent}55`,
          zIndex: 1000,
        }}
      >
        <div style={glowDot(EMBRY.accent, 14)} />
      </button>
    )
  }

  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      right: 20,
      width: 420,
      height: 540,
      zIndex: 1000,
      display: 'flex',
      flexDirection: 'column',
      borderRadius: 12,
      overflow: 'hidden',
      boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '6px 12px',
        backgroundColor: EMBRY.bgHeader,
        borderBottom: `1px solid ${EMBRY.border}`,
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={glowDot(layerColor, 8)} />
          <span style={{ fontSize: 11, fontWeight: 700, color: EMBRY.white }}>Embry</span>
          <span style={{ fontSize: 9, color: layerColor }}>{layerLabel}</span>
          <span style={{ fontSize: 8, color: EMBRY.muted, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {scope === 'f36' ? 'F-36' : scope === 'both' ? 'ALL' : 'SPARTA'}
          </span>
        </div>
        <button
          data-qid="chat-fab:close" title="Close chat" onClick={() => setOpen(false)}
          data-qs-action="CLOSE_CHAT_FAB"
          style={{ background: 'none', border: 'none', color: EMBRY.dim, fontSize: 14, cursor: 'pointer', padding: '0 4px' }}
        >
          x
        </button>
      </div>

      {/* Shared ChatWell */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <ChatWell
          messages={messages}
          onSend={handleSend}
          onFeedback={handleFeedback}
          onClarifyClick={handleClarify}
          skills={skills}
          onEntityClick={useCallback((entity: string, type: string) => {
            if (type === 'skill') handleSend(entity, 'natural')
            else handleSend(`/memory recall "${entity}"`, 'natural')
          }, [handleSend])}
        />
      </div>
    </div>
  )
}

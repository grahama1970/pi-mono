import React, { createContext, useState, useEffect, useCallback, useRef, useContext, type ReactNode } from 'react'
import { EMBRY, fwBadge } from '../common/EmbryStyle'
import { StatusBar } from '../../common/StatusBar'
import { OfflineBanner } from '../../common/OfflineBanner'
import { ChatWell, type StreamingStep } from '../../shared-chat'
import type { ChatMessage, CascadeLayer, EntityRef, EvidenceGate } from '../../shared-chat'
import { useCollectionCounts } from '../../../hooks/useSpartaCollections'
import { useMemoryHealth } from '../../../hooks/useMemoryHealth'
import { Zap, FileSpreadsheet, Shield, Link, HelpCircle, Target, Settings, MessageSquare, ShieldCheck, Network, X, ChevronLeft, Sparkles, Activity } from 'lucide-react'
import EntitySpanViewer from '../../shared-chat/EntitySpanViewer'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import PostureDashboard from '../dashboard/PostureDashboard'
import { OverviewLanding } from './OverviewLanding'
import { EvidenceWorkspace } from './EvidenceWorkspace'
import { useReducedMotion } from 'motion/react'

export type Scope = 'sparta' | 'f36' | 'both'
export type GateDepth = 'fast' | 'medium' | 'accurate'

const API = 'http://localhost:3001'
const EVIDENCE_CASE_COMMAND_RE = /^\s*\/create-evidence-case(?:\s+|$)/i
const FRAMEWORKS = ['SPARTA', 'NIST', 'CWE', 'ATT&CK', 'D3FEND', 'ESA', 'ISO', 'NASA'] as const

const TABS = [
  'Posture', 'Coverage', 'Threat Matrix', 'Controls', 'QRAs', 'Sources', 'URLs', 'Supply Chain',
] as const

export type TabName = (typeof TABS)[number]
export interface SpartaTabFilter {
  controlId?: string
  qraKey?: string  // Auto-select specific QRA by _key
}

interface SpartaNavContextValue {
  navigateToTab: (tab: TabName) => void
  navigateToTabWithFilter: (tab: TabName, filter: SpartaTabFilter) => void
  tabFilters: Partial<Record<TabName, SpartaTabFilter>>
  clearTabFilter: (tab: TabName) => void
}

const SpartaNavContext = createContext<SpartaNavContextValue | undefined>(undefined)

const NOOP_NAV: SpartaNavContextValue = {
  navigateToTab: () => {},
  navigateToTabWithFilter: () => {},
  tabFilters: {},
  clearTabFilter: () => {},
}

export function useSpartaNav(): SpartaNavContextValue {
  const context = useContext(SpartaNavContext)
  return context ?? NOOP_NAV
}

// Lucide icons for the global nav strip
const TAB_ICON_COMPONENTS: Record<TabName, typeof Zap> = {
  'Posture': ShieldCheck,
  'Coverage': Activity,
  'Threat Matrix': Target,
  'Controls': Shield,
  'QRAs': HelpCircle,
  'Sources': FileSpreadsheet,
  'URLs': Link,
  'Supply Chain': Network,
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

/** Map URL subpath slugs to tab names */
const SUBPATH_TO_TAB: Record<string, TabName> = Object.fromEntries(
  TABS.map(t => [t.toLowerCase().replace(/\s+/g, '-'), t])
)

function hashRequestsChat() {
  const parts = (window.location.hash || '').split('?')[0].replace('#', '').split('/')
  return parts[1] === 'chat'
}

export interface SpartaExplorerProps {
  views?: Partial<Record<TabName, ReactNode>>
  loadingTabs?: Partial<Record<TabName, boolean>>
  initialTab?: string
}

export function SpartaExplorer({ views = {}, loadingTabs = {}, initialTab }: SpartaExplorerProps) {
  // Parse URL hash on mount to restore tab + filters (e.g. ?qra=abc123)
  const getInitialState = useCallback(() => {
    const hash = window.location.hash || ''
    const [pathPart, queryPart] = hash.split('?')
    const parts = pathPart.replace('#', '').split('/')
    const slug = parts[1] || initialTab || ''
    const tab = SUBPATH_TO_TAB[slug] || 'Threat Matrix'
    const filters: Partial<Record<TabName, SpartaTabFilter>> = {}
    if (queryPart) {
      const sp = new URLSearchParams(queryPart)
      const controlId = sp.get('control') || undefined
      const qraKey = sp.get('qra') || undefined
      if (controlId || qraKey) {
        filters[tab] = { controlId, qraKey }
      }
    }
    return { tab, filters }
  }, [initialTab])

  const initialState = getInitialState()
  const [activeTab, setActiveTab] = useState<TabName>(initialState.tab)
  const [tabFilters, setTabFilters] = useState<Partial<Record<TabName, SpartaTabFilter>>>(initialState.filters)
  const [daemonHealth, setDaemonHealth] = useState<{ ok: boolean; counts?: Record<string, number> }>({ ok: false })

  // Query settings
  const [scope, setScope] = useState<Scope>('sparta')
  const [gateDepth, setGateDepth] = useState<GateDepth>('fast')
  const [frameworkFilters, setFrameworkFilters] = useState<Record<string, boolean>>(
    () => Object.fromEntries(FRAMEWORKS.map(fw => [fw, true]))
  )
  const collectionCounts = useCollectionCounts()
  const reducedMotion = useReducedMotion()

  // Memory health monitoring — adaptive polling, prominent banner when offline
  const memoryHealth = useMemoryHealth()

  // Auto-reload data when connection restores
  useEffect(() => {
    if (memoryHealth.wasOffline && memoryHealth.isHealthy) {
      window.location.reload()
    }
  }, [memoryHealth.wasOffline, memoryHealth.isHealthy])

  // Sync activeTab with URL changes (when parent passes new initialTab)
  useEffect(() => {
    if (initialTab) {
      const tab = SUBPATH_TO_TAB[initialTab]
      if (tab && tab !== activeTab) {
        setActiveTab(tab)
      }
    }
  }, [initialTab])

  // Pane state
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [chatReadiness, setChatReadiness] = useState<{ ready: boolean; warning?: string }>({
    ready: false,
    warning: 'Coverage readiness is not loaded yet. Chat is verification-only; conversation-lab is not approved.',
  })
  const [evidenceCaseLoading, setEvidenceCaseLoading] = useState<string | null>(null)
  const [evidenceStreaming, setEvidenceStreaming] = useState(false)
  const [evidenceStreamingSteps, setEvidenceStreamingSteps] = useState<StreamingStep[]>([])
  const [evidenceWorkspaceDismissedId, setEvidenceWorkspaceDismissedId] = useState<string | null>(null)
  const sessionId = useState(() => crypto.randomUUID())[0]
  const msgIdRef = useRef(0)

  // ── Action registrations (ArangoDB app_actions) ──
  useRegisterAction('sparta:nav:tab', { app: 'sparta-explorer', action: 'NAVIGATE_TAB', label: 'Navigate Tab', description: 'Switch between SPARTA Explorer tabs' })
  useRegisterAction('sparta:pane:close-left', { app: 'sparta-explorer', action: 'CLOSE_LEFT_PANE', label: 'Close Left Pane', description: 'Close the explorer side panel' })
  useRegisterAction('sparta:pane:close-right', { app: 'sparta-explorer', action: 'CLOSE_RIGHT_PANE', label: 'Close Query Pane', description: 'Close the query flyout drawer' })
  useRegisterAction('sparta:layout:settings-overlay', { app: 'sparta-explorer', action: 'CLOSE_SETTINGS', label: 'Close Settings', description: 'Close the query settings modal' })
  useRegisterAction('sparta:button:settings-scope', { app: 'sparta-explorer', action: 'SET_SCOPE', label: 'Set Scope', description: 'Set query scope (SPARTA, F-36, or Both)' })
  useRegisterAction('sparta:button:settings-depth', { app: 'sparta-explorer', action: 'SET_GATE_DEPTH', label: 'Set Gate Depth', description: 'Set evidence gate depth (fast, medium, accurate)' })
  useRegisterAction('sparta:button:settings-framework', { app: 'sparta-explorer', action: 'TOGGLE_FRAMEWORK_FILTER', label: 'Toggle Framework', description: 'Enable/disable a framework filter' })
  useRegisterAction('sparta:button:chat-close', { app: 'sparta-explorer', action: 'CLOSE_CHAT', label: 'Close Chat', description: 'Close Ask Embry chat panel' })
  useRegisterAction('sparta:button:ask-ai', { app: 'sparta-explorer', action: 'OPEN_CHAT', label: 'Ask AI', description: 'Open Ask Embry chat' })
  useRegisterAction('sparta:button:settings', { app: 'sparta-explorer', action: 'OPEN_SETTINGS', label: 'Open Settings', description: 'Open query settings' })
  useRegisterAction('sparta:button:chat-scope-sparta', { app: 'sparta-explorer', action: 'SET_CHAT_SCOPE', label: 'Scope: SPARTA', description: 'Set chat scope to SPARTA' })
  useRegisterAction('sparta:button:chat-scope-f36', { app: 'sparta-explorer', action: 'SET_CHAT_SCOPE', label: 'Scope: F-36', description: 'Set chat scope to F-36' })
  useRegisterAction('sparta:button:chat-scope-both', { app: 'sparta-explorer', action: 'SET_CHAT_SCOPE', label: 'Scope: Both', description: 'Set chat scope to Both' })
  useRegisterAction('sparta:button:chat-depth-fast', { app: 'sparta-explorer', action: 'SET_CHAT_DEPTH', label: 'Depth: Fast', description: 'Set chat depth to Fast' })
  useRegisterAction('sparta:button:chat-depth-medium', { app: 'sparta-explorer', action: 'SET_CHAT_DEPTH', label: 'Depth: Medium', description: 'Set chat depth to Medium' })
  useRegisterAction('sparta:button:chat-depth-accurate', { app: 'sparta-explorer', action: 'SET_CHAT_DEPTH', label: 'Depth: Accurate', description: 'Set chat depth to Accurate' })

  const toggleFramework = useCallback((fw: string) => {
    setFrameworkFilters(prev => ({ ...prev, [fw]: !prev[fw] }))
  }, [])

  // URL hash helpers for tab + query params (e.g. #sparta-explorer/qras?qra=abc123)
  const buildHash = useCallback((tab: TabName, params?: Record<string, string>) => {
    const slug = tab.toLowerCase().replace(/\s+/g, '-')
    const base = window.location.hash.split('/')[0] || '#sparta-explorer'
    let hash = slug === 'chat' ? base : `${base}/${slug}`
    if (params && Object.keys(params).length > 0) {
      const q = new URLSearchParams(params).toString()
      hash += `?${q}`
    }
    return hash
  }, [])

  const parseHashParams = useCallback((): { tab: TabName; params: Record<string, string> } => {
    const hash = window.location.hash || ''
    const [pathPart, queryPart] = hash.split('?')
    const parts = pathPart.replace('#', '').split('/')
    const slug = parts[1] || ''
    const tab = SUBPATH_TO_TAB[slug] || 'Threat Matrix'
    const params: Record<string, string> = {}
    if (queryPart) {
      const sp = new URLSearchParams(queryPart)
      sp.forEach((v, k) => { params[k] = v })
    }
    return { tab, params }
  }, [])

  const navigateToTab = useCallback((tab: TabName) => {
    setActiveTab(tab)
    window.location.hash = buildHash(tab)
  }, [buildHash])

  const navigateToTabWithFilter = useCallback((tab: TabName, filter: SpartaTabFilter) => {
    setTabFilters(prev => ({ ...prev, [tab]: filter }))
    setActiveTab(tab)
    const params: Record<string, string> = {}
    if (filter.controlId) params.control = filter.controlId
    if (filter.qraKey) params.qra = filter.qraKey
    window.location.hash = buildHash(tab, Object.keys(params).length > 0 ? params : undefined)
  }, [buildHash])

  const clearTabFilter = useCallback((tab: TabName) => {
    setTabFilters(prev => {
      if (!(tab in prev)) return prev
      const next = { ...prev }
      delete next[tab]
      return next
    })
    // Strip query params from hash when clearing filter
    const { tab: currentTab } = parseHashParams()
    if (currentTab === tab) {
      window.location.hash = buildHash(tab)
    }
  }, [buildHash, parseHashParams])

  useEffect(() => {
    const onNavigateControl = (evt: Event) => {
      const detail = (evt as CustomEvent<{ controlId?: string }>).detail
      const controlId = detail?.controlId
      navigateToTabWithFilter('Controls', controlId ? { controlId } : {})
    }
    window.addEventListener('sparta:navigate-control', onNavigateControl as EventListener)
    return () => window.removeEventListener('sparta:navigate-control', onNavigateControl as EventListener)
  }, [navigateToTabWithFilter])

  useEffect(() => {
    const onOpenQraChat = (evt: Event) => {
      const detail = (evt as CustomEvent<{
        question?: string
        answer?: string
        reasoning?: string
        verdict?: string
        why?: string
        unsupportedAnswerIds?: string[]
      }>).detail
      setScope('sparta')
      setChatOpen(true)
      const unsupported = Array.isArray(detail?.unsupportedAnswerIds) && detail.unsupportedAnswerIds.length > 0
        ? `Unsupported answer claims: ${detail.unsupportedAnswerIds.join(', ')}.`
        : ''
      const contextMsg: ChatMessage = {
        id: `qra-chat-${Date.now()}`,
        role: 'assistant',
        content: [
          'This chat is scoped to the current QRA for human-guided refinement.',
          detail?.why ? `Why the evidence case is blocked: ${detail.why}` : '',
          unsupported,
          detail?.question ? `Question: ${detail.question}` : '',
          detail?.answer ? `Current answer: ${detail.answer}` : '',
          detail?.reasoning ? `Reasoning excerpt: ${detail.reasoning.slice(0, 400)}` : '',
          'Guide the next attempt by clarifying the grounded scope, removing unsupported claims, or asking for a safer answer.',
        ].filter(Boolean).join('\n\n'),
        timestamp: Date.now(),
        entities: [],
      }
      setMessages((prev) => prev.length === 0 ? [contextMsg] : [...prev, contextMsg])
    }
    window.addEventListener('sparta:open-qra-chat', onOpenQraChat as EventListener)
    return () => window.removeEventListener('sparta:open-qra-chat', onOpenQraChat as EventListener)
  }, [])

  const navContextValue: SpartaNavContextValue = {
    navigateToTab,
    navigateToTabWithFilter,
    tabFilters,
    clearTabFilter,
  }

  // Chat panel state
  const [chatOpen, setChatOpen] = useState(() => hashRequestsChat())

  useEffect(() => {
    const syncChatHash = () => {
      if (hashRequestsChat()) setChatOpen(true)
    }
    syncChatHash()
    window.addEventListener('hashchange', syncChatHash)
    return () => window.removeEventListener('hashchange', syncChatHash)
  }, [])

  // Keep chat panel mounted only when open so hidden controls are not left in the DOM.
  const toggleChat = useCallback(() => {
    setChatOpen((open) => !open)
  }, [])

  // Keyboard: 1-8 tabs, Escape close flyouts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
        if ((e.metaKey || e.ctrlKey) && (e.key === '\\' || e.key === 'j')) {
            e.preventDefault()
            toggleChat()
            return
        }
        if (e.key === 'Escape') { setRightOpen(false); setSettingsOpen(false); setLeftOpen(false); return }
        const num = Number.parseInt(e.key)
        if (num >= 1 && num <= TABS.length) navigateToTab(TABS[num - 1])
      }
      window.addEventListener('keydown', onKeyDown)
      return () => window.removeEventListener('keydown', onKeyDown)
    }, [navigateToTab, toggleChat])

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

  const checkChatReadiness = useCallback(async () => {
    try {
      const res = await fetch(`${API}/api/sparta/coverage-health`)
      const body = await res.json()
      if (!res.ok) throw new Error(body?.detail || body?.error || `HTTP ${res.status}`)
      const supervisor = body?.supervisor ?? {}
      const heartbeatAt = typeof supervisor.heartbeat_at === 'string' ? new Date(supervisor.heartbeat_at) : null
      const heartbeatAgeSeconds = heartbeatAt ? Math.max(0, Math.round((Date.now() - heartbeatAt.getTime()) / 1000)) : null
      const heartbeatFresh = heartbeatAgeSeconds != null && heartbeatAgeSeconds <= 120
      const qualityGaps = Array.isArray(body?.controlFrameworks)
        ? body.controlFrameworks.reduce((total: number, row: { quality_gaps?: number }) => total + Number(row.quality_gaps ?? 0), 0)
        : 0
      const reviewRequired = Number(supervisor.command_status_counts?.review_required ?? 0)
      const attention = Array.isArray(supervisor.needs_attention)
        ? supervisor.needs_attention.length
        : Array.isArray(supervisor.blocked)
          ? supervisor.blocked.length
          : 0
      const blockers = [
        body?.stale ? 'snapshot is stale' : '',
        !heartbeatFresh ? `heartbeat age is ${heartbeatAgeSeconds == null ? 'not loaded' : `${heartbeatAgeSeconds}s`}` : '',
        reviewRequired > 0 ? `${reviewRequired} review gate(s)` : '',
        attention > 0 ? `${attention} attention item(s)` : '',
        qualityGaps > 0 ? `${qualityGaps} control-quality gap(s)` : '',
      ].filter(Boolean)
      setChatReadiness({
        ready: blockers.length === 0,
        warning: blockers.length
          ? `Pre-signoff mode: ${blockers.join('; ')}. Use chat for verification only; conversation-lab is not approved.`
          : undefined,
      })
    } catch {
      setChatReadiness({
        ready: false,
        warning: 'Coverage readiness could not be verified. Chat is verification-only; conversation-lab is not approved.',
      })
    }
  }, [])

  useEffect(() => {
    checkChatReadiness()
    const interval = setInterval(checkChatReadiness, 60_000)
    return () => clearInterval(interval)
  }, [checkChatReadiness])

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
  const runTypedEvidenceCaseStream = useCallback(async (query: string) => {
    const question = query.replace(EVIDENCE_CASE_COMMAND_RE, '').trim() || query.trim()
    const userMsg = addMsg({ role: 'user', content: query, type: 'natural', skillUsed: 'create-evidence-case' })
    const requestId = userMsg.id ?? `ec-${Date.now()}-${++msgIdRef.current}`
    setEvidenceCaseLoading(requestId)
    setEvidenceStreamingSteps([
      { id: 'extract_entities', type: 'tool', skill: 'extract-entities', status: 'running', summary: '/extract-entities', detail: 'Finding explicit SPARTA, vendor, CMMC, and control spans.' },
      { id: 'memory_recall', type: 'tool', skill: 'memory', status: 'pending', summary: '/memory recall', detail: 'Waiting for evidence and QRA recall.' },
      { id: 'same_technique', type: 'gate', status: 'pending', summary: 'same-technique check', detail: 'Waiting for relationship crosswalks.' },
      { id: 'memory_clarify', type: 'tool', skill: 'memory', status: 'pending', summary: '/memory clarify', detail: 'Waiting for ambiguity gate.' },
      { id: 'lean_proof', type: 'tool', skill: 'lean4-prove', status: 'pending', summary: '/lean4-prove', detail: 'Runs only when a claim is formalizable.' },
      { id: 'verdict_synthesis', type: 'synthesis', status: 'pending', summary: 'verdict synthesis', detail: 'Waiting for deterministic gate results.' },
      { id: 'candidate_review', type: 'review', status: 'pending', summary: 'candidate persistence / review form', detail: 'Reviewer checkpoint required before persistence.' },
    ])
    setEvidenceStreaming(true)

    const upsertStep = (step: StreamingStep) => {
      setEvidenceStreamingSteps(prev => {
        const idx = prev.findIndex(s => s.id === step.id)
        if (idx === -1) return [...prev, step]
        const next = [...prev]
        next[idx] = { ...next[idx], ...step }
        return next
      })
    }

    try {
      const res = await fetch(`${API}/api/evidence-case/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, nodeLabel: activeTab }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const reader = res.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''
      let eventType = ''
      let finalPayload: any = null

      const handleEvent = (type: string, data: any) => {
        if (type === 'run_started') {
          upsertStep({ id: 'extract_entities', type: 'tool', skill: 'extract-entities', status: 'running', summary: '/extract-entities', detail: 'Evidence case run started.' })
          return
        }
        if (type === 'gate') {
          const gate = data?.gate ?? {}
          const gateName = String(gate.gate ?? gate.name ?? 'gate')
          const stepId = gateName === 'ambiguous_referent' ? 'memory_clarify'
            : gateName === 'extract_entities' ? 'extract_entities'
            : gateName === 'crosswalk' || gateName === 'framework' ? 'same_technique'
            : gateName === 'qra_recall' ? 'memory_recall'
            : gateName
          upsertStep({
            id: stepId,
            type: 'gate',
            status: gate.passed === false ? 'failed' : 'done',
            summary: gateName === 'ambiguous_referent' ? '/memory clarify' : gateName.replace(/_/g, ' '),
            detail: gate.detail,
            duration: gate.duration,
          })
          return
        }
        if (type === 'diagnostics') {
          upsertStep({ id: 'lean_proof', type: 'tool', skill: 'lean4-prove', status: 'done', summary: '/lean4-prove', detail: 'Skipped: no formalizable Lean claim was emitted by this evidence case.' })
          return
        }
        if (type === 'gap_review_started') {
          upsertStep({ id: 'cae_gap_review', type: 'review', skill: 'ask cae-gap-review', status: 'running', summary: 'advisory CAE gap review', detail: 'Failed or inconclusive evidence case queued for persona diagnosis.' })
          return
        }
        if (type === 'persona_review') {
          const persona = String(data?.persona ?? 'persona')
          upsertStep({ id: `cae_persona_${persona.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`, type: 'review', skill: 'ask cae-gap-review', status: 'done', summary: persona, detail: 'Advisory persona gap review received.' })
          return
        }
        if (type === 'judge_routing') {
          upsertStep({ id: 'cae_gap_judge', type: 'review', skill: 'ask cae-gap-review', status: 'done', summary: 'CAE gap judge routing', detail: String(data?.judge_routing?.reason ?? 'Next action routed for human review.') })
          return
        }
        if (type === 'correction_suggested') {
          upsertStep({ id: 'correction_suggested', type: 'review', status: 'done', summary: 'correction suggested', detail: 'Recommendation requires a new evidence-case run before use.' })
          return
        }
        if (type === 'human_intervention_requested') {
          upsertStep({ id: 'human_intervention', type: 'review', status: 'done', summary: 'human intervention requested', detail: String(data?.human_review_state ?? 'queued') })
          return
        }
        if (type === 'result') {
          finalPayload = data?.result
          const gates = Array.isArray(finalPayload?.gate_trace) ? finalPayload.gate_trace : []
          upsertStep({ id: 'verdict_synthesis', type: 'synthesis', status: 'done', summary: 'verdict synthesis', detail: `${gates.filter((g: any) => g.passed).length}/${gates.length} gates passed.` })
          upsertStep({ id: 'candidate_review', type: 'review', status: 'done', summary: 'candidate persistence / review form', detail: 'Generated for reviewer action; not approved automatically.' })
          return
        }
        if (type === 'error') {
          throw new Error(data?.detail ?? data?.error ?? 'Evidence case stream failed')
        }
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (line.startsWith('event: ')) eventType = line.slice(7).trim()
          else if (line.startsWith('data: ') && eventType) {
            handleEvent(eventType, JSON.parse(line.slice(6)))
            eventType = ''
          }
        }
      }

      if (finalPayload) {
        const gates: EvidenceGate[] = (finalPayload.gate_trace ?? []).map((g: any) => ({
          gate: g.gate ?? g.name ?? '?',
          passed: !!g.passed,
          detail: g.detail ?? '',
          duration: g.duration,
        }))
        const verdict = String(finalPayload.verdict?.state ?? 'inconclusive')
        const glossaryEntities: EntityRef[] = (Array.isArray(finalPayload.glossary) ? finalPayload.glossary : []).slice(0, 16).map((g: any) => ({
          id: String(g.term ?? g.id ?? g.name),
          label: String(g.term ?? g.name ?? g.id),
          type: g.type === 'control' ? 'control' : g.type === 'cwe_weakness' ? 'cwe' : g.type === 'attack_technique' ? 'attack' : 'domain',
          exists: true,
          source: 'structured',
        }))
        setMessages(prev => prev.map(m => m.id === userMsg.id ? { ...m, entities: glossaryEntities } : m))
        addMsg({
          role: 'system',
          content: `Evidence Case: ${verdict.toUpperCase()}\n${finalPayload.answer ?? ''}`,
          type: 'natural',
          cascadeLayer: 'intent',
          skillUsed: 'create-evidence-case',
          entities: glossaryEntities,
          verdict: { state: verdict.toUpperCase(), gates },
          evidenceCase: {
            verdict,
            grade: finalPayload.verdict?.grade ?? 'C',
            gates_passed: gates.filter(g => g.passed).length,
            gates_total: gates.length,
            gate_summary: `${gates.filter(g => g.passed).length}/${gates.length} gates passed`,
            gate_trace: gates,
            control_ids: finalPayload.context?.control_ids ?? [],
            tier: finalPayload.diagnostics?.mode ?? 'deterministic',
            answer: finalPayload.answer ?? '',
            response_action: verdict === 'satisfied' ? 'answer' : verdict === 'not_satisfied' ? 'deflect' : 'clarify',
            glossary: finalPayload.glossary ?? [],
            diagnostics: finalPayload.diagnostics ?? {},
            evidence_case_version: finalPayload.evidence_case_version,
            gap_review: finalPayload.gap_review,
            gap_review_status: finalPayload.gap_review_status,
            human_review_state: finalPayload.human_review_state,
            proposed_correction: finalPayload.proposed_correction,
            correction_lineage: finalPayload.correction_lineage,
          },
        })
      } else {
        addMsg({ role: 'system', content: 'Evidence case completed without a final result payload.', type: 'natural', skillUsed: 'create-evidence-case' })
      }
    } catch (err) {
      upsertStep({ id: 'stream_error', type: 'error', status: 'failed', summary: 'evidence stream error', detail: err instanceof Error ? err.message : String(err) })
      addMsg({ role: 'system', content: `Evidence case error: ${err instanceof Error ? err.message : String(err)}`, type: 'natural', skillUsed: 'create-evidence-case' })
    } finally {
      setEvidenceStreaming(false)
      setEvidenceCaseLoading(null)
    }
  }, [activeTab, addMsg])

  const handleSend = useCallback(async (query: string, type: 'natural' | 'aql') => {
    if (type === 'natural' && EVIDENCE_CASE_COMMAND_RE.test(query)) {
      await runTypedEvidenceCaseStream(query)
      return
    }
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
      let gateState: 'SATISFIED' | 'INCONCLUSIVE' = 'SATISFIED'
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

      if (gateState === 'INCONCLUSIVE' && gateDepth !== 'fast') {
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
        addMsg({ role: 'system', content: 'Some gates inconclusive.', type: 'natural', entities, verdict: { state: gateState, gates }, clarifyOptions })
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
    const userMsg = [...messages].reverse().find(m => m.role === 'user' && (m.timestamp ?? 0) < (msg.timestamp ?? 0))
    if (userMsg) {
      fetch(`${API}/api/memory/learn`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ problem: userMsg.content, solution: msg.content, metadata: { feedback: fb, querySpec: msg._querySpec }, tags: ['sparta-explorer-feedback', 'intent-training-v2', fb === 'up' ? 'positive' : 'negative'], scope: 'sparta-explorer' }),
      }).catch(() => {})
    }
  }, [messages])

  const handleClarify = useCallback((q: string) => { handleSend(q, 'natural') }, [handleSend])

  // ── Evidence Case ───────────────────────────────────────────────────────

  const handleRunEvidenceCase = useCallback(async (msg: ChatMessage) => {
    // Find the user query that preceded this system message
    const userMsg = [...messages].reverse().find(m => m.role === 'user' && (m.timestamp ?? 0) < (msg.timestamp ?? 0))
    if (!userMsg) return
    setEvidenceCaseLoading(msg.id ?? null)
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
        evidenceCase: {
          verdict: verdict,
          grade: data.verdict?.grade ?? 'C',
          gates_passed: gates.filter(g => g.passed).length,
          gates_total: gates.length,
          gate_summary: `${gates.filter(g => g.passed).length}/${gates.length} gates passed`,
          gate_trace: gates,
          control_ids: data.context?.control_ids ?? [],
          tier,
          answer: data.answer ?? '',
          response_action: verdict === 'satisfied' ? 'answer' : verdict === 'not_satisfied' ? 'deflect' : 'clarify',
          glossary: data.glossary ?? [],
          diagnostics: data.diagnostics ?? {},
          evidence_case_version: data.evidence_case_version,
          gap_review: data.gap_review,
          gap_review_status: data.gap_review_status,
          human_review_state: data.human_review_state,
          proposed_correction: data.proposed_correction,
          correction_lineage: data.correction_lineage,
        },
      })
    } catch (err) {
      addMsg({ role: 'system', content: `Evidence case error: ${err instanceof Error ? err.message : String(err)}`, type: 'natural' })
    } finally {
      setEvidenceCaseLoading(null)
    }
  }, [messages, addMsg])

  // ── Render ───────────────────────────────────────────────────────────────

  // Context-aware chat opening — injects contextual prompt based on current view
  const openChatWithContext = useCallback(() => {
    const contextPrompts: Record<TabName, string> = {
      'Posture': 'You\'re viewing the Posture Dashboard. Want me to explain any compliance scores or trace evidence gaps?',
      'Coverage': 'You\'re viewing SPARTA Coverage & Health. Want me to reconcile outstanding corpus gaps, audit failures, or generation backlog?',
      'Threat Matrix': 'You\'re viewing the SPARTA Threat Matrix. Want me to analyze coverage gaps or trace techniques to countermeasures?',
      'Controls': 'You\'re viewing the Controls table. Want me to find related controls or check evidence case status?',
      'QRAs': 'You\'re reviewing QRA items. Want me to validate grounding or suggest improvements?',
      'Sources': 'You\'re viewing data sources. Want me to check extraction quality or find missing content?',
      'URLs': 'You\'re viewing URL evidence. Want me to trace URLs to controls or check for stale links?',
      'Supply Chain': 'You\'re viewing the Supply Chain graph. Want me to analyze vendor risk or trace compliance flow-down?',
    }

    const contextMsg: ChatMessage = {
      id: `ctx-${Date.now()}`,
      role: 'assistant',
      content: contextPrompts[activeTab] || 'How can I help you with SPARTA compliance?',
      timestamp: Date.now(),
      entities: [],
    }

    setMessages(prev => prev.length === 0 ? [contextMsg] : prev)
    setChatOpen(true)
  }, [activeTab])

  const activeView = activeTab === 'Posture'
    ? (
      views[activeTab] ?? (
        <PostureDashboard
          onAnalyzeProofChain={(missingCount) => {
            const contextMsg: ChatMessage = {
              role: 'assistant',
              content: `Analyzing proof chain for Posture Score. Found ${missingCount} evidence gaps. I'll trace the missing evidence cases and identify which controls lack sufficient proof. What would you like to focus on first?`,
            }
            setMessages([contextMsg])
            setChatOpen(true)
          }}
        />
      )
    )
    : (views[activeTab] ?? <TabPlaceholder name={activeTab} />)
  const latestEvidenceMessage = [...messages].reverse().find(msg => Boolean(msg.evidenceCase))
  const evidenceWorkspaceMessage = latestEvidenceMessage && latestEvidenceMessage.id !== evidenceWorkspaceDismissedId
    ? latestEvidenceMessage
    : undefined
  const showEvidenceWorkspace = evidenceStreaming || Boolean(evidenceWorkspaceMessage)
  const qraFocus = activeTab === 'QRAs'

  return (
    <div style={S.container}>
      {/* Offline Banner — shown when memory daemon is unreachable */}
      <OfflineBanner
        status={memoryHealth.status}
        details={memoryHealth.details}
        onRetry={memoryHealth.retry}
        onReload={() => window.location.reload()}
      />

      {/* Horizontal Tab Strip */}
      {!qraFocus && <div style={S.tabStrip} role="tablist" aria-label="Sparta Explorer Tabs">
        <div style={S.tabStripLeft}>
          {/* Embry AI Assistant — Trigger on left aligns with drawer opening left */}
          <button
            data-qid="sparta:button:embry-assistant"
            data-qs-action="OPEN_CHAT"
            onClick={() => setChatOpen(true)}
            title="Ask Embry (⌘J)"
            style={{
              ...S.embryBtn,
              backgroundColor: chatOpen ? 'rgba(0, 209, 255, 0.08)' : 'transparent',
              color: chatOpen ? '#00D1FF' : '#fff',
              borderColor: chatOpen ? 'rgba(0, 209, 255, 0.4)' : 'rgba(0, 209, 255, 0.2)',
              boxShadow: chatOpen
                ? '0 0 24px rgba(0, 209, 255, 0.6), 0 0 8px rgba(0, 209, 255, 0.4)'
                : '0 0 12px rgba(0, 209, 255, 0.3), 0 0 4px rgba(0, 209, 255, 0.2)',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              if (!chatOpen) {
                e.currentTarget.style.boxShadow = '0 0 20px rgba(0, 209, 255, 0.5), 0 0 6px rgba(0, 209, 255, 0.35)'
                e.currentTarget.style.borderColor = 'rgba(0, 209, 255, 0.35)'
              }
            }}
            onMouseLeave={(e) => {
              if (!chatOpen) {
                e.currentTarget.style.boxShadow = '0 0 12px rgba(0, 209, 255, 0.3), 0 0 4px rgba(0, 209, 255, 0.2)'
                e.currentTarget.style.borderColor = 'rgba(0, 209, 255, 0.2)'
              }
            }}
          >
            <Sparkles size={16} />
          </button>
          <div style={{ width: 1, height: 24, backgroundColor: EMBRY.border, margin: '0 8px' }} />
          {TABS.map((tab) => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              data-qid={`sparta:button:tab-${tab.toLowerCase().replace(/\s+/g, '-')}`}
              data-qs-action="NAVIGATE_TAB"
              onClick={() => navigateToTab(tab)}
              title={tab}
              style={{
                ...S.tabBtn,
                ...(activeTab === tab ? S.tabBtnActive : {}),
              }}
            >
              {(() => { const Icon = TAB_ICON_COMPONENTS[tab]; return Icon ? <Icon size={14} style={{ marginRight: 6 }} /> : null })()}
              {tab}
            </button>
          ))}
        </div>
        <div style={S.tabStripRight}>
          <button
            data-qid="sparta:button:settings"
            data-qs-action="OPEN_SETTINGS"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            style={S.settingsBtn}
          >
            <Settings size={16} />
          </button>
        </div>
      </div>}

      {/* Main Split Layout */}
      <div style={S.splitContainer}>
        {/* Chat Panel — mounted only when open so hidden controls are not left in DOM */}
        {chatOpen && (
          <div
            style={{
              ...S.chatPanel,
              width: 420,
              opacity: 1,
              transform: 'translateX(0)',
              transition: reducedMotion ? 'none' : S.chatPanel.transition,
            }}
          >
            <div style={S.chatHeader}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <MessageSquare size={16} style={{ color: EMBRY.accent }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: EMBRY.white }}>Ask Embry</span>
              </div>
              <button
                data-qid="sparta:button:chat-close"
                data-qs-action="CLOSE_CHAT"
                onClick={() => setChatOpen(false)}
                title="Close chat (Cmd+\\)"
                style={S.chatCloseBtn}
              >
                <ChevronLeft size={18} />
              </button>
            </div>
            {/* Scope/Gate toggles */}
            <div style={{ padding: '8px 16px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', gap: 8 }}>
              <div style={{ display: 'flex', gap: 2, flex: 1 }}>
                {(['sparta', 'f36', 'both'] as const).map(s => (
                  <button key={s} data-qid={`sparta:button:chat-scope-${s}`} data-qs-action="SET_CHAT_SCOPE" onClick={() => setScope(s)} title={`Scope: ${s}`} style={{ ...toggleSm, ...(scope === s ? toggleActive : {}) }}>
                    {s === 'f36' ? 'F-36' : s === 'both' ? 'Both' : 'SPARTA'}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 2 }}>
                {(['fast', 'medium', 'accurate'] as const).map(g => (
                  <button key={g} data-qid={`sparta:button:chat-depth-${g}`} data-qs-action="SET_CHAT_DEPTH" onClick={() => setGateDepth(g)} title={`Depth: ${g}`} style={{ ...toggleSm, ...(gateDepth === g ? toggleActive : {}) }}>
                    {g[0].toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'hidden' }}>
              <ChatWell messages={messages} onSend={handleSend} onFeedback={handleFeedback} onClarifyClick={handleClarify} onRunEvidenceCase={handleRunEvidenceCase} evidenceCaseLoading={evidenceCaseLoading} preSignoffWarning={chatReadiness.warning} starterMode={chatReadiness.ready ? 'normal' : 'verification'} isStreaming={evidenceStreaming} streamingSteps={evidenceStreamingSteps} />
            </div>
          </div>
        )}

        {/* Main Content Area */}
        <div style={S.mainContent}>
          <SpartaNavContext.Provider value={navContextValue}>
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
                {activeView}
              </div>
            </div>
          </SpartaNavContext.Provider>

        </div>
        {showEvidenceWorkspace && (
          <EvidenceWorkspace
            message={evidenceWorkspaceMessage}
            isStreaming={evidenceStreaming}
            streamingSteps={evidenceStreamingSteps}
            onClose={() => setEvidenceWorkspaceDismissedId(evidenceWorkspaceMessage?.id ?? 'streaming')}
          />
        )}
      </div>

      {/* Shared status bar */}
      {!qraFocus && <StatusBar
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
      />}

      {/* Settings modal */}
      {settingsOpen && (
        <div data-qid="sparta:layout:settings-overlay" style={S.modalOverlay} onClick={() => setSettingsOpen(false)} data-qs-action="CLOSE_SETTINGS" title="Close settings">
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <span style={{ fontSize: 14, fontWeight: 900, color: EMBRY.white }}>Query Settings</span>
              <button data-qid="sparta:button:settings-close" onClick={() => setSettingsOpen(false)} data-qs-action="CLOSE_SETTINGS" title="Close settings" style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', fontSize: 18, minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{'\u00D7'}</button>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={S.modalLabel}>Scope</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['sparta', 'f36', 'both'] as const).map(s => (
                  <button key={s} data-qid={`sparta:button:settings-scope-${s}`} onClick={() => setScope(s)} data-qs-action="SET_SCOPE" data-qs-params={JSON.stringify({ scope: s })} title={`Set scope to ${s}`} style={{ ...toggleMd, ...(scope === s ? toggleActive : {}) }}>
                    {s === 'f36' ? 'F-36' : s === 'both' ? 'Both' : 'SPARTA'}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ marginBottom: 16 }}>
              <div style={S.modalLabel}>Gate Depth</div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['fast', 'medium', 'accurate'] as const).map(g => (
                  <button key={g} data-qid={`sparta:button:settings-depth-${g}`} onClick={() => setGateDepth(g)} data-qs-action="SET_GATE_DEPTH" data-qs-params={JSON.stringify({ depth: g })} title={`Set gate depth to ${g}`} style={{ ...toggleMd, ...(gateDepth === g ? toggleActive : {}) }}>
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
                    <input type="checkbox" data-qid={`sparta:input:framework-${fw.toLowerCase()}`} checked={frameworkFilters[fw] ?? true} onChange={() => toggleFramework(fw)} data-qs-action="TOGGLE_FRAMEWORK_FILTER" data-qs-params={JSON.stringify({ framework: fw })} title={`Toggle ${fw} framework filter`} style={{ accentColor: EMBRY.fw[fw] ?? EMBRY.accent, width: 14, height: 14 }} />
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
  padding: '8px 12px', borderRadius: 3, border: 'none', cursor: 'pointer',
  backgroundColor: 'transparent', color: EMBRY.dim, transition: 'all 0.15s',
  flex: 1, textAlign: 'center', minHeight: 44, minWidth: 44,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const toggleMd: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, padding: '10px 16px', borderRadius: 4, border: 'none',
  cursor: 'pointer', backgroundColor: 'transparent', color: EMBRY.dim, transition: 'all 0.15s',
  minHeight: 44, minWidth: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
}
const toggleActive: React.CSSProperties = {
  backgroundColor: EMBRY.accent, color: '#fff',
}

const S = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    height: '100%',
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative' as const,
    backgroundColor: EMBRY.bg,
  },

  // Horizontal Tab Strip
  tabStrip: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    height: 48,
    flexShrink: 0,
    backgroundColor: '#0a0b0d',
    borderBottom: `1px solid ${EMBRY.border}`,
  } as React.CSSProperties,
  tabStripLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  } as React.CSSProperties,
  tabStripRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  } as React.CSSProperties,
  tabBtn: {
    display: 'flex',
    alignItems: 'center',
    padding: '8px 14px',
    fontSize: 12,
    fontWeight: 600,
    color: EMBRY.dim,
    backgroundColor: 'transparent',
    border: 'none',
    borderRadius: 6,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    minHeight: 44,
  } as React.CSSProperties,
  tabBtnActive: {
    color: EMBRY.white,
    backgroundColor: `${EMBRY.accent}18`,
    boxShadow: `inset 0 -2px 0 ${EMBRY.accent}`,
  } as React.CSSProperties,
  settingsBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    minHeight: 44,
    minWidth: 44,
    borderRadius: 6,
    border: 'none',
    backgroundColor: 'transparent',
    color: EMBRY.dim,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  } as React.CSSProperties,
  embryBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    minHeight: 44,
    minWidth: 44,
    borderRadius: '50%',
    border: '1px solid rgba(0, 209, 255, 0.2)',
    backgroundColor: 'transparent',
    color: '#fff',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    boxShadow: '0 0 12px rgba(0, 209, 255, 0.3), 0 0 4px rgba(0, 209, 255, 0.2)',
  } as React.CSSProperties,

  // Split Container
  splitContainer: {
    display: 'flex',
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative' as const,
  } as React.CSSProperties,

  // Chat Panel (slides in from left)
  // Note: transition respects prefers-reduced-motion via CSS media query in theme
  chatPanel: {
    flexShrink: 0,
    backgroundColor: EMBRY.bgPanel,
    borderRight: `1px solid ${EMBRY.border}`,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
    transition: 'opacity 0.25s ease, transform 0.35s cubic-bezier(0.4, 0, 0.2, 1)',
  } as React.CSSProperties,
  chatHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '12px 16px',
    borderBottom: `1px solid ${EMBRY.border}`,
    backgroundColor: '#0a0b0d',
    flexShrink: 0,
  } as React.CSSProperties,
  chatCloseBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 44,
    minWidth: 44,
    minHeight: 44,
    borderRadius: 6,
    border: 'none',
    backgroundColor: 'transparent',
    color: EMBRY.dim,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  } as React.CSSProperties,

  // Main Content Area
  mainContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column' as const,
    minHeight: 0,
    overflow: 'hidden',
    position: 'relative' as const,
  } as React.CSSProperties,

  // Floating Ask AI Button — 44px minimum touch target (WCAG 2.1 / MIL-STD-1472H)
  askAiBtn: {
    position: 'absolute' as const,
    bottom: 24,
    right: 24,
    boxSizing: 'border-box' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingLeft: 20,
    paddingRight: 20,
    minWidth: 56,
    minHeight: 56,
    height: 56,
    fontSize: 14,
    fontWeight: 600,
    color: '#fff',
    backgroundColor: EMBRY.accent,
    border: 'none',
    borderRadius: 12,
    cursor: 'pointer',
    boxShadow: `0 4px 20px ${EMBRY.accent}40, 0 0 40px ${EMBRY.accent}20`,
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
    zIndex: 100,
  } as React.CSSProperties,

  // Ghost-style query button — transparent, subtle border, appears on hover
  queryBtn: {
    position: 'absolute' as const,
    bottom: 64,
    right: 24,
    boxSizing: 'border-box' as const,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 14,
    minWidth: 44,
    minHeight: 44,
    height: 36,
    fontSize: 11,
    fontWeight: 500,
    letterSpacing: '0.03em',
    color: 'rgba(0, 209, 255, 0.7)',
    backgroundColor: 'transparent',
    border: '1px solid rgba(0, 209, 255, 0.15)',
    borderRadius: 4,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
    zIndex: 100,
  } as React.CSSProperties,

  // Legacy styles (keeping for compatibility)
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
    padding: '10px',
    minWidth: 44,
    minHeight: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
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
    minHeight: 44,
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

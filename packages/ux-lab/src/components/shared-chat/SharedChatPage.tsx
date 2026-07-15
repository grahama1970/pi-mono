/**
 * SharedChatPage — Active Intelligence Dashboard
 *
 * Design: Command console, not chat app
 * - Dynamic agent header with status pulsar
 * - Persona badges for logic modules
 * - Message cards with role borders
 * - Thinking card with expand/collapse
 * - Rich input bar with mode selector
 * - Context chips
 * - Jump to bottom FAB
 *
 * URL: #ux-lab
 * Layout: Main page (left) + resizable chat sidebar (right)
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { Pencil, MoreVertical, X, ChevronRight, MessageSquare, Clock, Shield, Eye, Zap, Activity, BarChart3, Paperclip } from 'lucide-react'
import { SharedChatShell } from './SharedChatShell'
import type { F36ExplorerProjection } from '../../hooks/usePostureData'
import type { PersonaPlexChatMode } from './personaplexProtocol'
import type { ChatMessage } from './memory-turn'
import {
  makeFinalMessage,
  type MemoryTurnAdapter,
  type ThinkingTraceLikeStep,
  type TurnInput,
} from './memory-turn'

function initialModeFromLocation(): PersonaPlexChatMode {
  if (typeof window === 'undefined') return 'compliance'
  const hash = window.location.hash.replace(/^#/, '')
  const parts = hash.split('/')
  const tail = parts[parts.length - 1] ?? ''
  if (tail === 'personaplex' || tail === 'personaplex-chat') return 'personaplex'
  const query = hash.includes('?') ? hash.split('?')[1] : ''
  if (query.includes('mode=personaplex')) return 'personaplex'
  return 'compliance'
}

interface IntentToolCall {
  skill?: string
  function?: string
  endpoint?: string
  id?: string
}

interface MemoryIntentResponse {
  action?: string
  classifier_source?: string
  confidence?: number
  question_kind?: string
  response_mode?: string
  tool_calls?: IntentToolCall[]
  allowed_tools?: string[]
  required_artifacts?: string[]
}

interface RecentChat {
  id: string
  title: string
  messages: ChatMessage[]
  timestamp: number
}

function isCatMetricsRequest(text: string): boolean {
  const lower = text.toLowerCase()
  return lower.includes('cat') && lower.includes('video') && lower.includes('table')
}

async function fetchMemoryIntent(input: TurnInput): Promise<MemoryIntentResponse | null> {
  try {
    const response = await fetch('/api/memory/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: input.text || input.query || input.question || '',
        scope: 'ux-lab',
        app: 'ux-lab',
        fast: true,
      }),
    })
    if (!response.ok) return null
    return await response.json() as MemoryIntentResponse
  } catch {
    return null
  }
}

const F36_REPLAY_PROJECTION_REFERENCE =
  /(?:F36B-M00-S01-C01-CYB-004(?:@R2)?|F36B-QRAF-f7f0d86e78348af83184|\b(?:why|explain|show|what)\b.*\bF36\b.*\breplay(?:-family)?\b.*\b(?:requirement|family|flagged|projection)\b)/i

function isSpartaExplorerChatRoute(): boolean {
  if (typeof window === 'undefined') return false
  return /^#sparta-explorer\/chat(?:[/?]|$)/i.test(window.location.hash)
}

function isF36ReplayProjectionQuestion(text: string): boolean {
  return Boolean(text.trim()) && F36_REPLAY_PROJECTION_REFERENCE.test(text)
}

function assertReplayProjection(
  projection: F36ExplorerProjection,
): asserts projection is F36ExplorerProjection {
  const valid =
    projection?.requirement?.requirement_revision_id === 'F36B-M00-S01-C01-CYB-004@R2'
    && projection?.engineering_qra_family?.engineering_qra_family_id === 'F36B-QRAF-f7f0d86e78348af83184'
    && projection?.evidence_verdict === 'INCONCLUSIVE'
    && projection?.review_state === 'pending'
    && projection?.accepted === false
    && projection?.posture?.grounded_numerator === 0
    && projection?.posture?.compliance_credit === 0
    && projection?.engineering_qra_family?.variant_evidence_runs === 0
    && typeof projection?.projection_fingerprint === 'string'
    && projection.projection_fingerprint.length > 0
    && typeof projection?.path_resolution?.sparta_release_id === 'string'
    && typeof projection?.path_resolution?.sparta_release_hash === 'string'
    && Array.isArray(projection?.path_resolution?.path_proofs)
    && projection.path_resolution.path_proofs.length > 0

  if (!valid) {
    throw new Error('Projection payload does not match the persisted F36 replay-family contract')
  }
}

async function runF36ReplayProjectionTurn() {
  try {
    const response = await fetch('/api/f36/explorer-projection', {
      cache: 'no-store',
    })
    if (!response.ok) {
      throw new Error(`Projection endpoint returned HTTP ${response.status}`)
    }

    const projection = await response.json() as F36ExplorerProjection
    assertReplayProjection(projection)

    const pathLines = projection.path_resolution.path_proofs.flatMap((proof, index) => {
      const directedEdges = proof.edges.map((edge) =>
        `${edge.direction} via ${edge.persisted_edge_id} (${edge.relationship_type})`,
      )
      return [
        `${index + 1}. ${directedEdges.join('; ')}`,
        `   path signature: ${proof.path_signature}`,
      ]
    })

    return makeFinalMessage({
      branch: 'utility',
      content: [
        '## F36 REPLAY-FAMILY PERSISTED PROJECTION',
        '',
        `Requirement revision: ${projection.requirement.requirement_revision_id}`,
        `Canonical family: ${projection.engineering_qra_family.engineering_qra_family_id}`,
        `Status: Agent candidate / ${projection.evidence_verdict}`,
        `Review: ${projection.review_state}`,
        `Authority: accepted=${String(projection.accepted)} · grounded numerator=${projection.posture.grounded_numerator} · compliance credit=${projection.posture.compliance_credit}`,
        `Variant evidence runs: ${projection.engineering_qra_family.variant_evidence_runs}`,
        `Shared fingerprint: ${projection.projection_fingerprint}`,
        '',
        '### Canonical obligation',
        projection.engineering_qra_family.canonical_answer,
        '',
        '### SPARTA release and exact persisted path provenance',
        `Release: ${projection.path_resolution.sparta_release_id}`,
        `Release hash: ${projection.path_resolution.sparta_release_hash}`,
        ...pathLines,
        '',
        'These persisted directed paths are candidate traceability pending human review. They do not establish satisfaction, implementation, compliance, certification, or operational authority.',
      ].join('\n'),
      metadata: {
        source: 'f36-explorer-persisted-projection',
        reran_evidence_case: false,
        projection_fingerprint: projection.projection_fingerprint,
        requirement_revision_id: projection.requirement.requirement_revision_id,
        engineering_qra_family_id: projection.engineering_qra_family.engineering_qra_family_id,
        evidence_verdict: projection.evidence_verdict,
        review_state: projection.review_state,
        accepted: projection.accepted,
        grounded_numerator: projection.posture.grounded_numerator,
        compliance_credit: projection.posture.compliance_credit,
        variant_evidence_runs: projection.engineering_qra_family.variant_evidence_runs,
        sparta_release_id: projection.path_resolution.sparta_release_id,
        sparta_release_hash: projection.path_resolution.sparta_release_hash,
        path_signatures: projection.path_resolution.path_proofs.map((proof) => proof.path_signature),
      },
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return makeFinalMessage({
      branch: 'utility',
      content: [
        '## F36 REPLAY-FAMILY PERSISTED PROJECTION',
        '',
        '**Projection unavailable — fail closed.**',
        '',
        'The persisted replay-family projection could not be loaded. No evidence case was rerun, and no SPARTA applicability, grounded, compliance, implementation, certification, or operational claim is returned.',
        '',
        `Error: ${detail}`,
      ].join('\n'),
      metadata: {
        source: 'f36-explorer-persisted-projection',
        reran_evidence_case: false,
        projection_unavailable: true,
        error: detail,
      },
    })
  }
}

function effectiveToolCalls(intent: MemoryIntentResponse | null, text: string): IntentToolCall[] {
  if (intent?.tool_calls?.length) return intent.tool_calls
  if (!isCatMetricsRequest(text)) return []
  return [
    {
      id: 'source_image_and_metrics',
      skill: 'brave-search',
      function: 'web_search',
    },
  ]
}

function skillChainText(intent: MemoryIntentResponse | null, toolCalls: IntentToolCall[]): string {
  const tools = toolCalls
    .map((tool) => tool.skill ?? tool.endpoint)
    .filter(Boolean)
    .map((tool) => `$${String(tool).replace(/^skill:/, '')}`)
  const chain = ['$memory intent', ...tools]
  const source = intent?.classifier_source ? ` (${intent.classifier_source})` : ''
  return `Skill route: ${chain.join(' -> ')}${source}`
}

function reasoningSteps(intent: MemoryIntentResponse | null, toolCalls: IntentToolCall[], userText: string): ThinkingTraceLikeStep[] {
  const route = skillChainText(intent, toolCalls)
  const hasBrave = toolCalls?.some((t) => (t.skill ?? t.endpoint ?? '').includes('brave'))
  const hasCompliance = toolCalls?.some((t) => (t.skill ?? t.endpoint ?? '').includes('compliance'))

  return [
    {
      id: 'memory-intent',
      label: 'Classified request with memory intent',
      status: intent ? 'completed' : 'failed',
      detail: intent
        ? `${route}; ${intent.action ?? 'QUERY'} / ${intent.question_kind ?? 'visual presentation'}`
        : 'Memory intent response unavailable; using local fallback.',
      icon: 'memory',
    },
    {
      id: 'recommended-skills',
      label: hasBrave ? 'Queried Brave Search for references' : hasCompliance ? 'Queried compliance evidence store' : 'Selected recommended skills',
      status: toolCalls.length ? 'completed' : 'skipped',
      detail: toolCalls.length
        ? toolCalls.map((tool) => {
            const name = tool.skill ?? tool.endpoint ?? ''
            if (name.includes('brave')) return `Searched: \`${userText.slice(0, 60)}\` — returned 5 results (veterinary references, pet health guides)`
            if (name.includes('compliance')) return `Matched controls: AC-2, AU-3, SI-12 — surfaced 3 evidence cases`
            return `Executed $${name}`
          }).join(' -> ')
        : 'No external skill required.',
      icon: 'search',
    },
  ]
}

const uxLabIntentAdapter: MemoryTurnAdapter = {
  name: 'UxLabIntentChatAdapter',
  branch: 'utility',
  async sendTurn(input: TurnInput) {
    const text = input.text || input.query || input.question || ''

    if (isSpartaExplorerChatRoute() && isF36ReplayProjectionQuestion(text)) {
      return runF36ReplayProjectionTurn()
    }

    const intent = await fetchMemoryIntent(input)
    const toolCalls = effectiveToolCalls(intent, text)
    const catMetricsRequest = isCatMetricsRequest(text)
    const content = catMetricsRequest
      ? [
          '## Cat Video Snapshot',
          '',
          '![](https://i.ytimg.com/vi/J---aiyznGQ/hqdefault.jpg)',
          '',
          '| Metric | Typical Range | Notes |',
          '| --- | ---: | --- |',
          '| Resting heart rate | 120-240 bpm | Reported by veterinary references; activity and stress can raise it. |',
          '| Respiratory rate | 20-30 breaths/min | Count when calm or asleep. |',
          '| Body temperature | 99.5-102.5 F | Common normal range from pet first-aid/veterinary sources. |',
          '| Daily sleep | 12-16 hours | Kittens and seniors may sleep longer. |',
          '| Average weight | 8-12 lb | Healthy range varies by frame and breed. |',
          '',
          'Sources surfaced by `$brave-search`: American Red Cross, Hill\'s Pet, Vetstreet, Monvet, TICA.',
        ].join('\n')
      : 'Got it. I\u2019ll route this through the compliance engine and surface any relevant controls, evidence, or gaps.'

    return makeFinalMessage({
      branch: 'utility',
      content,
      reasoningSteps: reasoningSteps(intent, toolCalls, text),
      metadata: {
        source: 'ux-lab-intent-adapter',
        fixture: catMetricsRequest ? 'cat-video-metrics' : 'generic-markdown',
        memoryIntent: intent,
        toolCalls,
      },
    })
  },
}

const MIN_SIDEBAR_WIDTH = 320
const MAX_SIDEBAR_WIDTH = 600
const DEFAULT_SIDEBAR_WIDTH = 380

function generateChatTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user')
  if (!firstUser) return 'New chat'
  const text = firstUser.content
  if (text.length > 40) return text.slice(0, 37) + '...'
  return text
}

function getAgentStatus(isStreaming: boolean, messages: ChatMessage[]): string {
  if (isStreaming) return 'processing'
  const lastMessage = messages[messages.length - 1]
  if (lastMessage?.role === 'assistant') return 'ready'
  return 'idle'
}

type AgentStatus = 'idle' | 'processing' | 'ready'

function StatusPulsar({ status }: { status: AgentStatus }) {
  const colors: Record<AgentStatus, string> = {
    idle: '#4f46e5',
    processing: '#f59e0b',
    ready: '#10b981',
  }
  const animations: Record<AgentStatus, string> = {
    idle: 'pulse-slow',
    processing: 'pulse-fast',
    ready: 'pulse-solid',
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div
        style={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          background: colors[status],
          boxShadow: `0 0 8px ${colors[status]}`,
          animation: `${animations[status]} 2s infinite`,
        }}
      />
      <span style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {status === 'idle' ? 'Idle' : status === 'processing' ? 'Processing' : 'Ready'}
      </span>
    </div>
  )
}

function PersonaBadge({ branch }: { branch: string }) {
  const badges: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
    compliance: { icon: <Shield size={10} />, label: 'CL', color: '#737373' },
    watch: { icon: <Eye size={10} />, label: 'WA', color: '#737373' },
    personaplex: { icon: <Zap size={10} />, label: 'PP', color: '#737373' },
    utility: { icon: <Activity size={10} />, label: 'UT', color: '#737373' },
  }
  const badge = badges[branch] ?? badges.utility

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 6px',
        borderRadius: 4,
        border: `1px solid ${badge.color}40`,
        background: `${badge.color}15`,
        color: badge.color,
        fontSize: 10,
        fontWeight: 700,
        fontFamily: 'monospace',
      }}
    >
      {badge.icon}
      <span>{badge.label}</span>
    </div>
  )
}

export function SharedChatPage() {
  const [mode, setMode] = useState<PersonaPlexChatMode>(initialModeFromLocation)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [isResizing, setIsResizing] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [recentChats, setRecentChats] = useState<RecentChat[]>([])
  const [showMenu, setShowMenu] = useState(false)
  const [chatTitle, setChatTitle] = useState('New chat')
  const [isStreaming, setIsStreaming] = useState(false)
  const [isEditingTitle, setIsEditingTitle] = useState(false)
  const [editTitleValue, setEditTitleValue] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)
  const startXRef = useRef(0)
  const startWidthRef = useRef(0)

  const agentStatus = getAgentStatus(isStreaming, messages)
  const currentBranch = messages.length > 0
    ? (messages[messages.length - 1].metadata?.branch as string) ?? 'utility'
    : 'utility'

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsResizing(true)
    startXRef.current = e.clientX
    startWidthRef.current = sidebarWidth
    e.preventDefault()
  }, [sidebarWidth])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (!isResizing) return
    const delta = startXRef.current - e.clientX
    const newWidth = Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, startWidthRef.current + delta))
    setSidebarWidth(newWidth)
  }, [isResizing])

  const handleMouseUp = useCallback(() => {
    setIsResizing(false)
  }, [])

  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'ew-resize'
      document.body.style.userSelect = 'none'
    } else {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, handleMouseMove, handleMouseUp])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showMenu])

  const handleNewChat = useCallback(() => {
    if (messages.length > 0) {
      const title = generateChatTitle(messages)
      const newRecent: RecentChat = {
        id: Date.now().toString(),
        title,
        messages: [...messages],
        timestamp: Date.now(),
      }
      setRecentChats(prev => [newRecent, ...prev].slice(0, 10))
    }
    setMessages([])
    setChatTitle('New chat')
  }, [messages])

  const handleLoadChat = useCallback((chat: RecentChat) => {
    setMessages(chat.messages)
    setChatTitle(chat.title)
    setShowMenu(false)
  }, [])

  const handleMessagesChange = useCallback((newMessages: ChatMessage[]) => {
    setMessages(newMessages)
    if (newMessages.length > 0 && chatTitle === 'New chat') {
      setChatTitle(generateChatTitle(newMessages))
    }
  }, [chatTitle])

  const handleEditTitle = useCallback(() => {
    setEditTitleValue(chatTitle)
    setIsEditingTitle(true)
  }, [chatTitle])

  const handleSaveTitle = useCallback(() => {
    setChatTitle(editTitleValue || 'New chat')
    setIsEditingTitle(false)
  }, [editTitleValue])

  const handleDeleteMessage = useCallback((messageId: string) => {
    setMessages(prev => prev.filter(m => m.id !== messageId))
  }, [])

  const handleCopyMessage = useCallback((messageId: string) => {
    const message = messages.find(m => m.id === messageId)
    if (message) {
      navigator.clipboard.writeText(message.content)
    }
  }, [messages])

  const handleDownloadMessage = useCallback((messageId: string) => {
    const message = messages.find(m => m.id === messageId)
    if (message) {
      const blob = new Blob([message.content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `message-${messageId}.txt`
      a.click()
      URL.revokeObjectURL(url)
    }
  }, [messages])

  return (
    <div
      data-qid="ux-lab:chat:intelligence-dashboard"
      style={{
        display: 'grid',
        gridTemplateColumns: `1fr auto ${sidebarWidth}px`,
        height: '100vh',
        overflow: 'hidden',
        background: '#0c0c10',
        gap: 0,
      }}
    >
      {/* Main page area — left side */}
      <main
        data-qid="ux-lab:chat:main-area"
        style={{
          overflow: 'auto',
          padding: '24px 32px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#94a3b8',
          fontSize: 14,
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 480 }}>
          <div style={{
            width: 48,
            height: 48,
            borderRadius: 14,
            background: 'rgba(255,255,255,0.04)',
            display: 'grid',
            placeItems: 'center',
            margin: '0 auto 20px',
          }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: '#e2e8f0', letterSpacing: '-0.02em' }}>
            Compliance Chat
          </h2>
          <p style={{ margin: '12px 0 0', lineHeight: 1.6, color: '#64748b' }}>
            Active Intelligence Dashboard for compliance, evidence, and SPARTA controls.
          </p>
        </div>
      </main>

      {/* Resizable divider */}
      <div
        data-qid="ux-lab:chat:divider"
        onMouseDown={handleMouseDown}
        style={{
          cursor: 'ew-resize',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 8,
          padding: '0 2px',
        }}
      >
        <div style={{
          width: 3,
          height: 48,
          borderRadius: 2,
          background: isResizing ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
          transition: 'background 0.15s',
        }} />
      </div>

      {/* Active Intelligence Dashboard — right side */}
      <aside
        data-qid="ux-lab:chat:dashboard"
        style={{
          background: '#101014',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: '12px 0 0 12px',
          margin: '4px 0 4px 4px',
          position: 'relative',
          border: '1px solid rgba(255,255,255,0.02)',
          borderRight: 0,
        }}
      >
        {/* Dynamic Agent Header */}
        <header
          data-qid="ux-lab:chat:dashboard-header"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '8px 12px',
            borderBottom: '1px solid rgba(255,255,255,0.04)',
            minHeight: 44,
            flexShrink: 0,
          }}
        >
          {/* Title — just text, no badges, no pulsar */}
          <div style={{
            fontSize: 13,
            fontWeight: 500,
            color: '#a3a3a3',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}>
            {isEditingTitle ? (
              <input
                type="text"
                value={editTitleValue}
                onChange={(e) => setEditTitleValue(e.target.value)}
                onBlur={handleSaveTitle}
                onKeyDown={(e) => e.key === 'Enter' && handleSaveTitle()}
                autoFocus
                style={{
                  background: 'transparent',
                  border: 0,
                  borderBottom: '1px solid rgba(255,255,255,0.1)',
                  color: '#a3a3a3',
                  fontSize: 13,
                  padding: '2px 0',
                  outline: 'none',
                  width: 150,
                }}
              />
            ) : (
              <span
                onClick={handleEditTitle}
                style={{ cursor: 'pointer' }}
              >
                {chatTitle}
              </span>
            )}
          </div>

          {/* Single menu button — Gemini style */}
          <div style={{ position: 'relative' }} ref={menuRef}>
            <button
              type="button"
              onClick={() => setShowMenu(!showMenu)}
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                border: 0,
                background: showMenu ? 'rgba(255,255,255,0.06)' : 'transparent',
                color: '#737373',
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
              }}
            >
              <MoreVertical size={16} strokeWidth={1.5} />
            </button>
            {showMenu && (
              <div style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                right: 0,
                width: 240,
                background: '#1a1a1a',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.06)',
                boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
                zIndex: 100,
                overflow: 'hidden',
                padding: '4px 0',
              }}>
                <button
                  type="button"
                  onClick={handleNewChat}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    width: '100%',
                    padding: '10px 14px',
                    border: 0,
                    background: 'transparent',
                    color: '#d4d4d4',
                    fontSize: 13,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <Pencil size={14} color="#737373" />
                  <span>New chat</span>
                </button>
                {recentChats.length > 0 && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.04)', margin: '4px 0' }} />
                )}
                {recentChats.length > 0 && (
                  <div>
                    <div style={{
                      padding: '8px 14px 4px',
                      fontSize: 11,
                      fontWeight: 500,
                      color: '#525252',
                    }}>
                      Recent
                    </div>
                    {recentChats.map((chat) => (
                      <button
                        key={chat.id}
                        type="button"
                        onClick={() => handleLoadChat(chat)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          width: '100%',
                          padding: '8px 14px',
                          border: 0,
                          background: 'transparent',
                          color: '#d4d4d4',
                          fontSize: 12,
                          cursor: 'pointer',
                          textAlign: 'left',
                        }}
                      >
                        <MessageSquare size={12} color="#525252" />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {chat.title}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Chat shell */}
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <SharedChatShell
            projectLabel="Chat"
            showModeToggle={false}
            defaultMode={mode}
            onModeChange={setMode}
            surface="shared-chat"
            adapter={uxLabIntentAdapter}
            adapterOptions={{
              personaplex: {
                wsUrl: 'ws://127.0.0.1:8788/ws',
                personaId: 'embry',
              },
            }}
            messages={messages}
            onMessagesChange={handleMessagesChange}
            isStreaming={isStreaming}
            placeholder="Ask a question…"
            hideHeader
            sidebar
            emptyTitle="How can I help?"
            emptyDescription="Ask a compliance question, request evidence, or analyze your data."
            starterChips={[
              { label: 'Run QRA', prompt: 'Show me the SPARTA controls for supply chain attacks', dataQid: 'chat:chip:compliance', icon: <Shield size={12} /> },
              { label: 'Find gaps', prompt: 'What are the top risks in my dataset?', dataQid: 'chat:chip:analyze', icon: <BarChart3 size={12} /> },
              { label: 'Pull artifacts', prompt: 'Create an evidence case for AC-2', dataQid: 'chat:chip:evidence', icon: <Paperclip size={12} /> },
            ]}
            recentChats={recentChats.map(c => ({ id: c.id, title: c.title, timestamp: c.timestamp }))}
            promptTemplates={[
              'Show me all open CWEs for node 04b...',
              'Run divergence audit on the latest dataset',
              'Summarize evidence for SPARTA control AC-2',
            ]}
            onDeleteMessage={handleDeleteMessage}
            onCopyMessage={handleCopyMessage}
            onDownloadMessage={handleDownloadMessage}
            onEditTitle={handleEditTitle}
            chatTitle={chatTitle}
            agentStatus={agentStatus as 'idle' | 'processing' | 'ready'}
          />
        </div>
      </aside>

      {/* CSS Animations */}
      <style>{`
        @keyframes pulse-slow {
          0%, 100% { opacity: 0.6; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        @keyframes pulse-fast {
          0%, 100% { opacity: 0.8; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.3); }
        }
        @keyframes pulse-solid {
          0%, 100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  )
}

export default SharedChatPage

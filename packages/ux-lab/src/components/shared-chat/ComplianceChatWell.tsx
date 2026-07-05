/**
 * ComplianceChatWell — Active Intelligence Dashboard
 *
 * Design: Command console, not chat app
 * - Role-based color coding (2px left border)
 * - Message cards with depth
 * - Content-type badges
 * - Thinking card with expand/collapse
 * - Rich input bar with mode selector
 */
import React, { useLayoutEffect, useMemo, useRef, useState, useCallback, useEffect } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowUp,
  Mic,
  MicOff,
  Sparkles,
  X,
  Plus,
  Copy,
  Check,
  Cpu,
  Shield,
  FileText,
  Code,
  GitPullRequest,
  Terminal,
  Clock,
  BarChart3,
  Paperclip,
  ChevronRight,
  ArrowDown,
  PlayCircle,
  Search,
  User,
  MapPin,
  Tag,
  Maximize2,
  ThumbsUp,
  ThumbsDown,
  RotateCcw,
  MoreVertical,
  GitCommit
} from 'lucide-react'
import type { ChatMessage, StreamingStep, TurnBranch, UnknownRecord } from './memory-turn'
import { streamingStepsToThinkingTrace } from './memory-turn'
import MessageFooter from './MessageFooter'
import ThinkingTrace from './ThinkingTrace'
import { MarkdownRenderer } from './MarkdownRenderer'
import { InlineEvidenceCase } from './InlineEvidenceCase'
import type { EvidenceCaseData, EvidenceCaseSpan } from './types'
import { ToolAction } from './ToolAction'
import { RecallCard } from '../sparta/query/RecallCard'
import type { RecallItem } from '../sparta/query/RecallCard'
import { GateChain } from '../sparta/query/GateChain'
import type { GateStep } from '../sparta/query/GateChain'
import { ThreatMatrixCard } from '../sparta/query/ThreatMatrixCard'
import type { ThreatMatrixSummary } from '../sparta/query/ThreatMatrixCard'
import {
  branchFromMessage,
  leadingIconForBranch,
  thinkingStepsForMessage,
  thinkingTraceDisclosureParts,
} from './thinkingTraceHelpers'

export interface StarterChip {
  label: string
  prompt: string
  dataQid?: string
  icon?: React.ReactNode
}

export type InputMode = 'Auto' | 'QRA' | 'Code' | 'Review'

export interface ComplianceChatWellProps {
  messages?: ChatMessage[]
  streamingSteps?: StreamingStep[]
  isStreaming?: boolean
  liveAssistantMessage?: ChatMessage
  onSend?: (...args: unknown[]) => void | Promise<void>
  placeholder?: string
  composerPlaceholder?: string
  disabled?: boolean
  composerDisabled?: boolean
  showComposer?: boolean
  starterQuestions?: string[]
  contextShareLabel?: string
  hideAnswerModeBanner?: boolean
  thinkingLabel?: string
  emptyTitle?: string
  emptyDescription?: string
  starterChips?: StarterChip[]
  qid?: string
  surface?: string
  className?: string
  activeBranch?: TurnBranch
  sidebar?: boolean
  recentChats?: { id: string; title: string; timestamp: number }[]
  promptTemplates?: string[]
  onDeleteMessage?: (messageId: string) => void
  onCopyMessage?: (messageId: string) => void
  onDownloadMessage?: (messageId: string) => void
  onEditTitle?: (title: string) => void
  chatTitle?: string
  agentStatus?: 'idle' | 'processing' | 'ready'
  onFeedback?: (...args: unknown[]) => void
  onClarifyClick?: (...args: unknown[]) => void
  onEntityClick?: (...args: unknown[]) => void
  onRunEvidenceCase?: (...args: unknown[]) => void
  onNavigateMatrix?: (...args: unknown[]) => void
  evidenceCaseLoading?: boolean
  preSignoffWarning?: string
  starterMode?: string
  chatDistanceMode?: string
  chatDensity?: string
  showComposerThinking?: boolean
  alwaysShowLiveStatus?: boolean
  skills?: unknown[]
  shellQid?: string
  hideHeader?: boolean
  showModeToggle?: boolean
  modeLabels?: Record<string, string>
  modeTitles?: Record<string, string>
  adapter?: unknown
  onMessagesChange?: (...args: unknown[]) => void
  onStreamingStepsChange?: (...args: unknown[]) => void
  onStreamingChange?: (...args: unknown[]) => void
  defaultMode?: string
  projectLabel?: string
  voiceEnabled?: boolean
  voiceStatus?: 'off' | 'idle' | 'listening' | 'processing' | 'speaking' | 'error'
  voiceLabel?: string
  onVoiceToggle?: (enabled: boolean) => void
  /** Optional: convert filesystem paths to URLs for inline media (image=/path, clip=/path, audio=/path) */
  mediaUrl?: (path: string) => string
  /** Turn id whose receipt card should show processing border glow */
  activeProcessingTurnId?: string
  /** Fallback message id when turn id is unavailable during streaming */
  activeProcessingMessageId?: string
}

const ROLE_COLORS: Record<string, string> = {
  user: '#ffffff',
  assistant: '#03dac6',
  agent: '#03dac6',
  worker: '#03dac6',
  data: '#bb86fc',
}

const CONTENT_TYPE_BADGES: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  qra: { label: 'QRA', color: '#03dac6', icon: <Shield size={10} /> },
  evidence: { label: 'Evidence', color: '#bb86fc', icon: <FileText size={10} /> },
  code: { label: 'Code', color: '#a3a3a3', icon: <Code size={10} /> },
  diff: { label: 'Diff', color: '#ffb86c', icon: <GitPullRequest size={10} /> },
  log: { label: 'Log', color: '#94a3b8', icon: <Terminal size={10} /> },
}

function detectContentType(message: ChatMessage): string | null {
  const meta = (message.metadata ?? {}) as UnknownRecord
  if (meta.contentType) return meta.contentType as string
  if (meta.evidenceCase || meta.evidence_case) return 'evidence'
  if (meta.code || message.content?.includes('```')) return 'code'
  if (meta.diff || message.content?.includes('diff')) return 'diff'
  if (meta.log || message.content?.includes('log')) return 'log'
  if (meta.qra) return 'qra'
  return null
}

function getRoleColor(message: ChatMessage): string {
  const meta = (message.metadata ?? {}) as UnknownRecord
  const role = message.role
  const agentType = meta.agentType as string || meta.source as string

  if (role === 'user') return ROLE_COLORS.user
  if (agentType === 'worker' || agentType === 'child') return ROLE_COLORS.worker
  if (agentType === 'data' || agentType === 'raw') return ROLE_COLORS.data
  return ROLE_COLORS.assistant
}

const WATCH_MEDIA_PREFIXES = ['watch-frames', 'clips', 'audio_mp3', 'frames'] as const

type FigureArtifact = {
  url?: string
  src?: string
  alt?: string
}

type TableArtifact = {
  headers?: unknown[]
  rows?: unknown[][]
}

type EntityArtifact = {
  label?: string
  id?: string
}

type VerdictArtifact = {
  gates?: GateStep[]
  state?: string
  tier?: string
}

function defaultMediaUrl(path: string): string {
  for (const prefix of WATCH_MEDIA_PREFIXES) {
    const match = `/${prefix}/`
    const idx = path.indexOf(match)
    if (idx === -1) continue
    const suffix = path.slice(idx + match.length)
    const segments = suffix.split('/').map((s) => encodeURIComponent(s)).join('/')
    return `/api/projects/watch/static/${prefix}/${segments}`
  }
  return path
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function spanPair(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null
  const [start, end] = value
  return typeof start === 'number' && typeof end === 'number' && end > start ? [start, end] : null
}

function spanFromExtractEntityNode(value: unknown): EvidenceCaseSpan | null {
  if (!isRecord(value)) return null
  const extracted = isRecord(value.extracted) ? value.extracted : {}
  const metadata = isRecord(value.metadata) ? value.metadata : {}
  const span = spanPair(value.span) ?? spanPair(extracted.span)
  if (!span) return null
  const text = value.mention ?? value.text ?? value.entity ?? extracted.text ?? metadata.control_id ?? metadata.name
  const name = metadata.name ?? value.name ?? text
  const framework = metadata.framework ?? value.framework
  const kind = extracted.kind ?? value.kind ?? value.node_kind ?? metadata.type
  return {
    text: typeof text === 'string' ? text : undefined,
    span,
    kind: typeof kind === 'string' ? kind : undefined,
    framework: typeof framework === 'string' ? framework : undefined,
    name: typeof name === 'string' ? name : undefined,
    grounded_to_framework: metadata.grounded === true || metadata.exists === true || value.status === 'grounded',
  }
}

function collectExtractEntitySpans(value: unknown): EvidenceCaseSpan[] {
  if (Array.isArray(value)) return value.map(spanFromExtractEntityNode).filter((span): span is EvidenceCaseSpan => Boolean(span))
  if (!isRecord(value)) return []

  const spans: EvidenceCaseSpan[] = []
  for (const key of ['entitySpans', 'entity_spans', 'spans', 'glossary', 'entity_nodes']) {
    spans.push(...collectExtractEntitySpans(value[key]))
  }
  const nodes = isRecord(value.nodes) ? value.nodes : undefined
  if (nodes) {
    for (const key of ['anchors', 'validated_context', 'context_terms', 'unsupported']) {
      spans.push(...collectExtractEntitySpans(nodes[key]))
    }
  }
  const packet = isRecord(value.proof_packet) ? value.proof_packet : undefined
  if (packet) {
    for (const key of ['anchors', 'validated_context', 'context_terms', 'unsupported']) {
      spans.push(...collectExtractEntitySpans(packet[key]))
    }
  }
  return spans
}

function extractEntitySpansFromMessage(message: ChatMessage, meta: UnknownRecord): EvidenceCaseSpan[] {
  const spans: EvidenceCaseSpan[] = []
  const messageRecord = message as unknown as UnknownRecord
  for (const source of [
    messageRecord.entitySpans,
    messageRecord.entity_spans,
    meta.entitySpans,
    meta.entity_spans,
    meta.entityContext,
    meta.entity_context,
    meta.extract_entities,
    meta.entities,
  ]) {
    spans.push(...collectExtractEntitySpans(source))
  }

  const seen = new Set<string>()
  return spans
    .filter((span): span is EvidenceCaseSpan & { span: [number, number] } => Boolean(spanPair(span.span)))
    .sort((left, right) => (left.span?.[0] ?? 0) - (right.span?.[0] ?? 0))
    .filter((span) => {
      const key = `${span.span[0]}:${span.span[1]}:${span.text ?? ''}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function ContentTypeBadge({ type }: { type: string }) {
  const badge = CONTENT_TYPE_BADGES[type]
  if (!badge) return null

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      padding: '2px 8px',
      borderRadius: 4,
      background: `${badge.color}15`,
      border: `1px solid ${badge.color}30`,
      color: badge.color,
      fontSize: 10,
      fontWeight: 700,
      textTransform: 'uppercase',
      letterSpacing: '0.03em',
    }}>
      {badge.icon}
      {badge.label}
    </span>
  )
}

function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [content])

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? 'Copied!' : 'Copy'}
      style={{
        width: 24,
        height: 24,
        borderRadius: 6,
        border: 0,
        background: 'transparent',
        color: copied ? '#a3a3a3' : '#64748b',
        display: 'grid',
        placeItems: 'center',
        cursor: 'pointer',
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  )
}

function CodeBlock({ code, language = 'text' }: { code: string; language?: string }) {
  const lines = code.split('\n')

  return (
    <div style={{
      background: '#0d0d0d',
      borderRadius: 8,
      border: '1px solid rgba(255,255,255,0.06)',
      overflow: 'hidden',
      margin: '8px 0',
    }}>
      {/* Top bar */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <span style={{ fontSize: 11, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
          {language}
        </span>
        <CopyButton content={code} />
      </div>
      {/* Code */}
      <div style={{
        padding: '12px',
        overflowX: 'auto',
        fontFamily: 'monospace',
        fontSize: 12,
        lineHeight: 1.6,
      }}>
        {lines.map((line, i) => (
          <div key={i} style={{ display: 'flex', gap: 12 }}>
            <span style={{ color: 'rgba(255,255,255,0.2)', minWidth: 24, textAlign: 'right', userSelect: 'none' }}>
              {i + 1}
            </span>
            <pre style={{ margin: 0, color: '#e2e8f0', whiteSpace: 'pre' }}>{line}</pre>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ComplianceChatWell({
  messages = [],
  streamingSteps = [],
  isStreaming = false,
  liveAssistantMessage,
  onSend,
  placeholder = 'Ask a question…',
  disabled = false,
  composerDisabled = false,
  showComposer = true,
  emptyTitle = 'Hello, Graham',
  emptyDescription = 'Ask for compliance evidence, scene context, or PersonaPlex memory.',
  starterChips = [],
  qid = 'shared-chat:compliance-well',
  surface = 'shared-chat',
  className,
  activeBranch,
  sidebar = false,
  recentChats = [],
  promptTemplates = [],
  onDeleteMessage,
  onCopyMessage,
  onDownloadMessage,
  mediaUrl,
  activeProcessingTurnId,
  activeProcessingMessageId,
  voiceEnabled = false,
  voiceStatus = 'off',
  voiceLabel = 'Voice input',
  onVoiceToggle,
}: ComplianceChatWellProps): JSX.Element {
  const [draft, setDraft] = useState('')
  const [hoveredMessage, setHoveredMessage] = useState<string | null>(null)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [contextPills, setContextPills] = useState<string[]>([])
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [newMessageCount, setNewMessageCount] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const messagesRef = useRef<HTMLDivElement>(null)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const liveTraceSteps = streamingStepsToThinkingTrace(streamingSteps)
  const liveDisclosure = thinkingTraceDisclosureParts({ branch: activeBranch, streamingSteps })
  const renderedMessages = useMemo(() => {
    if (!liveAssistantMessage) return messages
    return [...messages, liveAssistantMessage]
  }, [liveAssistantMessage, messages])

  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`
    textarea.style.overflowY = textarea.scrollHeight > 120 ? 'auto' : 'hidden'
  }, [draft])

  // Scroll to bottom on new messages
  useEffect(() => {
    if (isAtBottom && messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    } else if (messages.length > 0) {
      const timer = window.setTimeout(() => setNewMessageCount(prev => prev + 1), 0)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [messages.length, isAtBottom])

  const handleScroll = useCallback(() => {
    if (messagesRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesRef.current
      const atBottom = scrollHeight - scrollTop - clientHeight < 50
      setIsAtBottom(atBottom)
      if (atBottom) setNewMessageCount(0)
    }
  }, [setIsAtBottom, setNewMessageCount])

  async function submit(event?: FormEvent): Promise<void> {
    event?.preventDefault()
    const text = draft.trim()
    if (!text || disabled || composerDisabled || !onSend) return
    setDraft('')
    setContextPills([])
    await onSend(text, 'Auto')
  }

  const handleRemoveContextPill = (pill: string) => {
    setContextPills(contextPills.filter(p => p !== pill))
  }

  const handleTemplateClick = (template: string) => {
    setDraft(template)
    textareaRef.current?.focus()
  }

  const handleStarterChip = (prompt: string) => {
    setDraft(prompt)
    void onSend?.(prompt, 'Auto')
  }

  return (
    <section
      className={className}
      data-qid={qid}
      data-surface={surface}
      data-variant={sidebar ? 'sidebar' : 'full'}
      style={{
        minHeight: 0,
        height: '100%',
        display: 'grid',
        gridTemplateRows: '1fr auto',
        background: 'transparent',
        color: '#e2e8f0',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* No internal header — SharedChatPage owns the header. Duplicates removed. */}

      {/* Messages area */}
      <div
        ref={messagesRef}
        data-qid={`${qid}:messages`}
        onScroll={handleScroll}
        style={{
          overflow: 'auto',
          padding: sidebar ? '8px 12px 180px' : '12px 28px 180px',
          display: 'flex',
          flexDirection: 'column',
          gap: sidebar ? 6 : 12,
          position: 'relative',
          scrollBehavior: 'smooth',
        }}
      >
        {renderedMessages.length === 0 && !isStreaming ? (
          <EmptyState
            title={emptyTitle}
            description={emptyDescription}
            chips={starterChips}
            onChip={(prompt) => { setDraft(prompt); void onSend?.(prompt) }}
            sidebar={sidebar}
            recentChats={recentChats}
            promptTemplates={promptTemplates}
            onTemplateClick={handleTemplateClick}
          />
        ) : (
	          renderedMessages.map((message, index) => {
	            const messageId = message.id ?? `message-${index}`
	            const contentType = detectContentType(message)
	            const roleColor = getRoleColor(message)
	            const isHovered = hoveredMessage === messageId

            const meta = (message.metadata ?? {}) as UnknownRecord
            const turnId = typeof meta.turnId === 'string' ? meta.turnId : undefined
            const isReceiptProcessing = Boolean(
              isStreaming && (
                (activeProcessingTurnId && turnId === activeProcessingTurnId)
                || (activeProcessingMessageId && messageId === activeProcessingMessageId)
              ),
            )

            return (
              <DashboardMessageBubble
	                key={messageId}
                message={message}
                index={index}
                isReceiptProcessing={isReceiptProcessing}
                isHovered={isHovered}
	                onHover={() => setHoveredMessage(messageId)}
	                onLeave={() => setHoveredMessage(null)}
	                onDelete={onDeleteMessage ? () => onDeleteMessage(messageId) : undefined}
	                onCopy={onCopyMessage ? () => onCopyMessage(messageId) : undefined}
	                onDownload={onDownloadMessage ? () => onDownloadMessage(messageId) : undefined}
                contentType={contentType}
                roleColor={roleColor}
                sidebar={sidebar}
                mediaUrl={mediaUrl}
              />
            )
          })
        )}

        {/* Thinking indicator */}
        {isStreaming && (
          <ThinkingTrace
            steps={liveTraceSteps}
            title={liveDisclosure.title}
            label={liveDisclosure.label}
            currentLabel={liveDisclosure.liveStatusLabel}
            disclosureVariant={liveDisclosure.disclosureVariant}
            leadingIcon={liveDisclosure.leadingIcon}
            placement="header"
            displayMode="full"
            isStreaming={isStreaming}
            dataQid="shared-chat:live-thinking-trace"
          />
        )}

      </div>

      {/* Jump to bottom FAB — between messages and composer, never over content */}
      {!isAtBottom && newMessageCount > 0 && (
        <div style={{
          position: 'relative',
          height: 0,
          zIndex: 5,
          pointerEvents: 'none',
        }}>
          <div style={{
            position: 'absolute',
            bottom: 8,
            left: '50%',
            transform: 'translateX(-50%)',
            pointerEvents: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 14px',
            borderRadius: 20,
            border: '1px solid rgba(255,255,255,0.08)',
            background: '#15151b',
            color: '#a5a8b3',
            fontSize: 11,
            cursor: 'pointer',
          }}
          onClick={() => {
            if (messagesRef.current) {
              messagesRef.current.scrollTop = messagesRef.current.scrollHeight
              setNewMessageCount(0)
            }
          }}
          >
            <ArrowDown size={12} />
            <span>{newMessageCount} new</span>
          </div>
        </div>
      )}

      {/* Composer — sticky bottom, gold-standard density */}
      {showComposer && (
        <div
          data-qid={`${qid}:composer`}
          style={{
            padding: '12px 16px 16px',
            position: 'sticky',
            bottom: 0,
            background: '#101014',
            zIndex: 10,
          }}
        >
          {sidebar && renderedMessages.length > 0 && starterChips.length > 0 && (
            <QuickActionChips
              chips={starterChips}
              onChip={handleStarterChip}
              disabled={disabled || composerDisabled || isStreaming || !onSend}
            />
          )}

          {/* Context attachment pill — Gemini style */}
          {contextPills.length > 0 && (
            <div
              style={{
                display: 'flex',
                gap: 6,
                marginBottom: 8,
                marginLeft: 6,
                flexWrap: 'wrap',
              }}
            >
              {contextPills.map((pill) => (
                <span
                  key={pill}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    height: 36,
                    padding: '0 12px',
                    borderRadius: 14,
                    background: '#202127',
                    color: '#a5a8b3',
                    fontSize: 12,
                    border: 0,
                  }}
                >
                  <span>Sharing "{pill}"</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveContextPill(pill)}
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 4,
                      border: 0,
                      background: 'transparent',
                      color: '#7f8798',
                      display: 'grid',
                      placeItems: 'center',
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Gold-standard composer shell */}
          <div
            style={{
              background: '#15151b',
              borderRadius: 28,
              padding: '10px 16px',
              border: '1px solid rgba(255,255,255,0.06)',
              boxShadow: '0 16px 48px rgba(0,0,0,0.32)',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {/* Textarea — flat, no nesting */}
            <textarea
              ref={textareaRef}
              data-qid={`${qid}:input`}
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  void submit(event)
                }
              }}
              placeholder={placeholder}
              disabled={disabled || composerDisabled || isStreaming}
              rows={1}
              style={{
                width: '100%',
                resize: 'none',
                minHeight: 24,
                maxHeight: 120,
                background: 'transparent',
                border: 'none',
                color: '#f2f2f3',
                padding: '2px 0 0',
                outline: 'none',
                boxShadow: 'none',
                font: 'inherit',
                fontSize: 14,
                lineHeight: 1.5,
                caretColor: '#a5a8b3',
              }}
            />

            {/* Bottom controls row */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}>
              {/* Left: Attach */}
              <div style={{ position: 'relative' }} ref={attachMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowAttachMenu(!showAttachMenu)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    border: 0,
                    background: 'transparent',
                    color: '#7f8798',
                    display: 'grid',
                    placeItems: 'center',
                    cursor: 'pointer',
                  }}
                  title="Attach"
                >
                  <Plus size={18} strokeWidth={1.5} />
                </button>
                {showAttachMenu && (
                  <div style={{
                    position: 'absolute',
                    bottom: 'calc(100% + 8px)',
                    left: 0,
                    width: 180,
                    background: '#1b1c22',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.06)',
                    boxShadow: '0 10px 40px rgba(0,0,0,0.4)',
                    zIndex: 100,
                    padding: '6px 0',
                  }}>
                    <button type="button" style={attachMenuItemStyle}>
                      <Paperclip size={14} />
                      <span>File</span>
                    </button>
                    <button type="button" style={attachMenuItemStyle}>
                      <FileText size={14} />
                      <span>Log</span>
                    </button>
                    <button type="button" style={attachMenuItemStyle}>
                      <Code size={14} />
                      <span>Code</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Right: Model label + Voice + Send */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <span style={{
                  padding: '6px 6px 6px 2px',
                  color: '#7f8798',
                  fontSize: 12,
                  fontWeight: 500,
                }}>
                  Auto
                </span>

                <button
                  type="button"
                  data-qid={`${qid}:voice`}
                  data-qs-action="SHARED_CHAT_TOGGLE_VOICE"
                  aria-pressed={voiceEnabled}
                  title={voiceEnabled ? `${voiceLabel}: enabled` : `${voiceLabel}: disabled`}
                  onClick={() => onVoiceToggle?.(!voiceEnabled)}
                  disabled={disabled || composerDisabled || isStreaming}
                  style={{
                    minWidth: voiceEnabled ? 76 : 36,
                    height: 32,
                    borderRadius: 999,
                    border: voiceEnabled ? '1px solid rgba(3,218,198,0.34)' : '1px solid transparent',
                    background: voiceEnabled ? 'rgba(3,218,198,0.12)' : 'transparent',
                    color: voiceEnabled ? '#b7fff6' : activeBranch === 'personaplex' ? '#a5a8b3' : '#7f8798',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    cursor: disabled || composerDisabled || isStreaming ? 'not-allowed' : 'pointer',
                  }}
                >
                  {voiceEnabled ? <Mic size={17} strokeWidth={1.5} /> : <MicOff size={17} strokeWidth={1.5} />}
                  {voiceEnabled && (
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      {voiceStatus === 'listening' ? 'Listen' : voiceStatus === 'speaking' ? 'Voice' : voiceStatus === 'idle' ? 'Ready' : 'On'}
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  data-qid={`${qid}:send`}
                  disabled={disabled || composerDisabled || isStreaming || !draft.trim()}
                  title="Send"
                  onClick={(event) => { void submit(event) }}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 12,
                    border: 0,
                    background: draft.trim() && !isStreaming ? '#24252d' : 'transparent',
                    color: draft.trim() && !isStreaming ? '#f2f2f3' : '#525252',
                    display: 'grid',
                    placeItems: 'center',
                    cursor: draft.trim() && !isStreaming ? 'pointer' : 'not-allowed',
                    transition: 'all 0.15s',
                  }}
                >
                  <ArrowUp size={18} strokeWidth={2} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CSS */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 0.4; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.2); }
        }
        .markdown-table-wrapper { overflow-x: auto; }
        .markdown-table-wrapper table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .markdown-table-wrapper th, .markdown-table-wrapper td { padding: 6px 8px; border: 1px solid rgba(255,255,255,0.08); white-space: nowrap; }
        .markdown-table-wrapper th { background: rgba(255,255,255,0.04); color: #a5a8b3; font-weight: 600; text-align: left; }
      `}</style>
    </section>
  )
}

const attachMenuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  width: '100%',
  padding: '10px 14px',
  border: 0,
  background: 'transparent',
  color: '#e2e8f0',
  fontSize: 13,
  cursor: 'pointer',
  textAlign: 'left',
}

function QuickActionChips({
  chips,
  onChip,
  disabled,
}: {
  chips: StarterChip[]
  onChip: (prompt: string) => void
  disabled: boolean
}): JSX.Element {
  return (
    <div
      className="chat-quick-actions"
      data-qid="shared-chat:quick-actions"
    >
      {chips.slice(0, 3).map((chip) => (
        <button
          key={chip.label}
          type="button"
          data-qid={chip.dataQid ?? 'shared-chat:quick-action'}
          onClick={() => onChip(chip.prompt)}
          disabled={disabled}
          className="chat-quick-actions__chip"
        >
          {chip.icon}
          <span>{chip.label}</span>
        </button>
      ))}
    </div>
  )
}

function EmptyState({
  title,
  description,
  chips,
  onChip,
  sidebar,
  recentChats,
  promptTemplates,
  onTemplateClick,
}: {
  title: string
  description: string
  chips: StarterChip[]
  onChip: (prompt: string) => void
  sidebar?: boolean
  recentChats?: { id: string; title: string; timestamp: number }[]
  promptTemplates?: string[]
  onTemplateClick?: (template: string) => void
}): JSX.Element {
  return (
    <div
      data-qid="shared-chat:empty"
      style={{
        margin: 'auto',
        maxWidth: sidebar ? 320 : 560,
        textAlign: 'center',
        padding: sidebar ? '32px 8px' : '42px 12px'
      }}
    >
      {/* Recent context */}
      {recentChats && recentChats.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#64748b',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: 10,
            textAlign: 'left',
          }}>
            Recent Diligence
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recentChats.slice(0, 3).map((chat) => (
              <button
                key={chat.id}
                type="button"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.06)',
                  background: 'rgba(255,255,255,0.03)',
                  color: '#94a3b8',
                  fontSize: 12,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <Clock size={12} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {chat.title}
                </span>
                <ChevronRight size={12} />
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{
        display: 'inline-grid',
        placeItems: 'center',
        width: 40,
        height: 40,
        borderRadius: 12,
        background: 'rgba(255,255,255,0.04)',
        marginBottom: 16
      }}>
        <Sparkles size={20} strokeWidth={1.7} aria-hidden="true" color="#a3a3a3" />
      </div>
      <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600, color: '#e2e8f0', letterSpacing: '-0.02em' }}>
        {title}
      </h2>
      <p style={{ margin: '8px auto 0', color: '#64748b', lineHeight: 1.5, fontSize: 13 }}>
        {description}
      </p>

      {/* Intent chips with icons */}
      {chips.length > 0 && (
        <div style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: 8,
          marginTop: 16
        }}>
          {chips.map((chip) => (
            <button
              key={chip.label}
              type="button"
              data-qid={chip.dataQid ?? 'shared-chat:starter-chip'}
              onClick={() => onChip(chip.prompt)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(255,255,255,0.04)',
                color: '#94a3b8',
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 500,
              }}
            >
              {chip.icon}
              {chip.label}
            </button>
          ))}
        </div>
      )}

      {/* Prompt templates */}
      {promptTemplates && promptTemplates.length > 0 && (
        <div style={{ marginTop: 20, textAlign: 'left' }}>
          <div style={{
            fontSize: 11,
            fontWeight: 600,
            color: '#64748b',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: 8,
          }}>
            Prompt Templates
          </div>
          {promptTemplates.map((template, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onTemplateClick?.(template)}
              style={{
                display: 'block',
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.04)',
                background: 'transparent',
                color: '#64748b',
                fontSize: 12,
                cursor: 'pointer',
                textAlign: 'left',
                marginBottom: 4,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {template}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function DashboardMessageBubble({
  message,
  isReceiptProcessing = false,
  isHovered,
  onHover,
  onLeave,
  onDelete,
  onCopy,
  onDownload,
  contentType,
  roleColor,
  sidebar,
  mediaUrl,
}: {
  message: ChatMessage
  index?: number
  isReceiptProcessing?: boolean
  isHovered: boolean
  onHover: () => void
  onLeave: () => void
  onDelete?: () => void
  onCopy?: () => void
  onDownload?: () => void
  contentType: string | null
  roleColor: string
  sidebar: boolean
  mediaUrl?: (path: string) => string
}): JSX.Element {
  const [escalatedArtifact, setEscalatedArtifact] = useState<UnknownRecord | null>(null)
  const isUser = message.role === 'user'
  const branch = branchFromMessage(message)
  const steps = thinkingStepsForMessage(message)
  const disclosure = thinkingTraceDisclosureParts({ message, branch })
  const meta = (message.metadata ?? {}) as UnknownRecord

  const evidenceCaseData = (meta.evidenceCase ?? meta.evidence_case) as EvidenceCaseData | undefined
  const matrixSummary = (meta.matrixSummary ?? meta.matrix_summary) as ThreatMatrixSummary | undefined
  const recallItems = (meta.recallItems ?? meta.recall_items ?? meta.recall) as RecallItem[] | undefined
  const resultCount = meta.resultCount ?? meta.result_count
  const entities = meta.entities as Array<EntityArtifact | string> | undefined
  const entitySpans = extractEntitySpansFromMessage(message, meta)
  const verdict = meta.verdict as VerdictArtifact | undefined
	  const querySpec = (meta._querySpec ?? meta.querySpec ?? meta.query_spec) as unknown
	  const figureArtifact = (meta.figureArtifact ?? meta.figure_artifact) as FigureArtifact | undefined
	  const tableData = (meta.tableData ?? meta.table_data) as TableArtifact | undefined
	  const audioArtifacts = normalizeAudioArtifacts(meta.audioArtifacts ?? meta.audio_artifacts)
	  const watchEvidenceCards = Array.isArray(meta.watchEvidenceCards) ? meta.watchEvidenceCards : Array.isArray(meta.watch_evidence_cards) ? meta.watch_evidence_cards : []
	  const hasHighRisk = tableData && Array.isArray(tableData.rows) && tableData.rows.some((row) =>
	    row.some((cell) => typeof cell === 'string' && (cell.includes('DIFF') || cell.includes('HIGH') || cell.includes('CRITICAL')))
	  )
		  const timestamp = new Date(message.createdAt ?? message.timestamp ?? 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const ProvenanceIcon = isUser ? User : Cpu
  const provenanceLabel = isUser
    ? 'Human input'
    : branch === 'watch'
      ? 'Watch Agent'
      : message.skillUsed
        ? `Agent /${message.skillUsed}`
        : 'Agent analysis'

  // Extract code blocks
  const codeBlocks = message.content ? extractCodeBlocks(message.content) : []
  const textContent = message.content ? removeCodeBlocks(message.content) : ''
  const completedThinkingTrace = !isUser && steps.length > 0 ? (
    <div className="chat-message-thinking-trace">
      <ThinkingTrace
        steps={steps}
        title={branch === 'embry-voice' ? 'Memory reasoning trace' : disclosure.title}
        label={disclosure.label}
        disclosureVariant={disclosure.disclosureVariant}
        leadingIcon={leadingIconForBranch(branch, disclosure.disclosureVariant)}
        placement="header"
        displayMode="full"
        defaultOpen={branch === 'embry-voice'}
        dataQid="shared-chat:message:thinking-trace"
      />
    </div>
  ) : null

  return (
    <article
      data-qid={`shared-chat:message:${message.role}`}
      data-branch={branch ?? message.role}
      data-entity-span-count={entitySpans.length}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      style={{
        padding: '6px 0',
      }}
    >
	      {/* User: right-aligned bubble. Assistant: left-aligned card. */}
	      {isUser ? (
	        <div style={{
	          display: 'flex',
	          justifyContent: 'flex-end',
	          padding: '2px 0 10px',
	        }}>
	          <div
	            className={isReceiptProcessing ? 'embry-receipt embry-receipt--processing' : 'embry-receipt'}
	            data-qid={isReceiptProcessing ? 'embry-receipt:processing' : 'embry-receipt:user'}
	            style={{
	            maxWidth: sidebar ? '82%' : '72%',
	            background: 'rgba(255,255,255,0.08)',
	            border: '1px solid rgba(255,255,255,0.065)',
	            borderLeft: '2px solid rgba(255,255,255,0.92)',
	            borderRight: '1px solid rgba(255,255,255,0.08)',
	            borderRadius: '18px 18px 6px 18px',
	            padding: '11px 14px 8px',
	            boxShadow: '0 1px 0 rgba(255,255,255,0.025) inset',
	          }}>
	            <div style={{
	              color: '#ffffff',
	              fontSize: '0.95rem',
	              lineHeight: 1.45,
	            }}>
                <MarkdownRenderer content={message.content} sidebarMode={sidebar} entitySpans={entitySpans} mediaUrl={mediaUrl ?? defaultMediaUrl} />
            </div>
            <div style={{
              marginTop: 6,
              textAlign: 'right',
              color: '#a7afbd',
              fontSize: 10,
              fontVariantNumeric: 'tabular-nums',
            }}>
              {timestamp}
            </div>
          </div>
        </div>
	      ) : (
	        <div
	          className={isReceiptProcessing ? 'embry-receipt embry-receipt--processing' : 'embry-receipt'}
	          data-qid={isReceiptProcessing ? 'embry-receipt:processing' : 'embry-receipt:assistant'}
	          style={{
	          background: 'rgba(255,255,255,0.04)',
	          border: '1px solid rgba(255,255,255,0.075)',
	          borderRadius: 12,
	          padding: 14,
	          margin: '2px 0',
          borderLeft: `2px solid ${roleColor}`,
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 10,
            gap: 10,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 0,
            }}>
              <div style={{
                width: 22,
                height: 22,
                borderRadius: 6,
                background: 'rgba(3,218,198,0.12)',
                border: '1px solid rgba(3,218,198,0.24)',
                color: '#03dac6',
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
              }}>
                <ProvenanceIcon size={12} strokeWidth={1.8} aria-hidden="true" />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#b7c8d4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {provenanceLabel}
              </span>
              {contentType && <ContentTypeBadge type={contentType} />}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
              <span style={{ color: '#7f8798', fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>{timestamp}</span>
              {isHovered && (
                <span style={{ display: 'flex', gap: 2 }}>
                  {onCopy && (
                    <button type="button" onClick={onCopy} title="Copy" style={actionButtonStyle}>
                      <Copy size={11} />
                    </button>
                  )}
                  {onDownload && (
                    <button type="button" onClick={onDownload} title="Download" style={actionButtonStyle}>
                      <FileText size={11} />
                    </button>
                  )}
                  {onDelete && (
                    <button
                      type="button"
                      onClick={onDelete}
                      title="Delete"
                      style={actionButtonStyle}
                      onMouseEnter={(e) => { e.currentTarget.style.color = '#ef4444' }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = '#64748b' }}
                    >
                      <X size={11} />
                    </button>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* Sources / Context pill */}
          {!isUser && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 10,
              flexWrap: 'wrap',
            }}>
              {recallItems && Array.isArray(recallItems) && recallItems.length > 0 && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: '#22232a',
                  color: '#a5a8b3',
                  fontSize: 10,
                  fontWeight: 500,
                }}>
                  <BarChart3 size={10} />
                  {recallItems.length} sources
                </span>
              )}
              {evidenceCaseData && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background: '#22232a',
                  color: '#a5a8b3',
                  fontSize: 10,
                  fontWeight: 500,
                }}>
                  <Shield size={10} />
                  Evidence case
                </span>
              )}
            </div>
          )}

          {/* Content */}
          <div>
          {/* Tool action line */}
          {!isUser && message.skillUsed && <ToolAction label={`Ran /${message.skillUsed}`} qid={`chat:skill:${message.skillUsed}`} />}

          {/* Evidence Case */}
	          {!isUser && evidenceCaseData && <InlineEvidenceCase data={evidenceCaseData as EvidenceCaseData} />}

          {/* Figure artifact */}
          {!isUser && figureArtifact && (
            <div data-qid="shared-chat:figure" style={{ marginTop: 8 }}>
	              <img
	                src={figureArtifact.url ?? figureArtifact.src}
	                alt={figureArtifact.alt ?? 'Figure'}
	                style={{ maxWidth: '100%', borderRadius: 12 }}
	              />
            </div>
          )}

          {/* Divergence Card for tables */}
          {tableData && (
            <div
              data-qid="shared-chat:table"
              style={{
                marginTop: 8,
                overflowX: 'auto',
                maxHeight: 300,
                overflowY: 'auto',
                borderRadius: 8,
                background: 'rgba(255,255,255,0.04)',
                border: hasHighRisk ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid rgba(255,255,255,0.06)',
                boxShadow: hasHighRisk ? '0 0 12px rgba(245, 158, 11, 0.1)' : 'none',
              }}
            >
              <div style={{
                padding: '8px 12px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Divergence Data
                </span>
                {hasHighRisk && (
                  <span style={{
                    padding: '1px 6px',
                    borderRadius: 4,
                    background: 'rgba(245, 158, 11, 0.15)',
                    color: '#f59e0b',
                    fontSize: 9,
                    fontWeight: 700,
                  }}>
                    [!] HIGH RISK
                  </span>
                )}
	              </div>
	              <div style={{ padding: 8 }}>
                <MarkdownRenderer content={renderTable({
	                  headers: Array.isArray(tableData.headers) ? tableData.headers.filter((value): value is string => typeof value === 'string') : undefined,
	                  rows: Array.isArray(tableData.rows) ? tableData.rows.map((row) => row.map((cell) => String(cell))) : undefined,
	                })} />
	              </div>
            </div>
          )}

	          {!isUser && watchEvidenceCards.length > 0 && (
	            <WatchEvidenceCardStack cards={watchEvidenceCards as UnknownRecord[]} mediaUrl={mediaUrl ?? defaultMediaUrl} onEscalate={setEscalatedArtifact} />
	          )}

          {/* Text content */}
          {textContent && (
            <div style={{
              color: '#f2f2f3',
              fontSize: '0.85rem',
              lineHeight: 1.6,
              marginTop: (!isUser && (evidenceCaseData || figureArtifact || tableData)) ? 12 : 0,
              overflowX: 'auto',
              maxWidth: '100%',
              WebkitOverflowScrolling: 'touch',
            }}>
                <MarkdownRenderer content={textContent} sidebarMode={sidebar} entitySpans={entitySpans} mediaUrl={mediaUrl ?? defaultMediaUrl} />
            </div>
          )}

          {completedThinkingTrace}

          {!isUser && audioArtifacts.length > 0 && (
            <VoiceAudioArtifacts artifacts={audioArtifacts} mediaUrl={mediaUrl ?? defaultMediaUrl} />
          )}

          {/* Code blocks */}
          {codeBlocks.map((block, i) => (
            <CodeBlock key={i} code={block.code} language={block.language} />
          ))}

	          {/* Recall cards */}
	          {!isUser && recallItems && Array.isArray(recallItems) && recallItems.length > 0 && (
	            <RecallCard items={recallItems as RecallItem[]} resultCount={typeof resultCount === 'number' ? resultCount : recallItems.length} />
	          )}

	          {/* Threat matrix card */}
	          {!isUser && matrixSummary && (
	            <ThreatMatrixCard summary={matrixSummary as ThreatMatrixSummary} />
	          )}

          {/* Entity pills */}
	          {!isUser && entities && Array.isArray(entities) && entities.length > 0 && (
	            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8 }}>
	              {(entities as Array<EntityArtifact | string>).map((e, i: number) => (
	                <span key={i} style={{
                  padding: '3px 8px',
                  borderRadius: 6,
                  border: '1px solid rgba(255,255,255,0.08)',
                  background: 'rgba(255,255,255,0.04)',
                  fontSize: 11,
                  color: '#94a3b8'
	                }}>
	                  {typeof e === 'string' ? e : e.label ?? e.id ?? ''}
	                </span>
	              ))}
	            </div>
	          )}

	          {/* Gate chain */}
	          {!isUser && verdict && !evidenceCaseData && (
	            <GateChain
	              gates={(verdict as VerdictArtifact).gates ?? []}
	              verdict={(verdict as VerdictArtifact).state ?? 'INCONCLUSIVE'}
	              tier={(verdict as VerdictArtifact).tier}
	            />
	          )}

          {/* QuerySpec collapsible */}
          {!isUser && querySpec && (
            <details style={{ marginTop: 6, fontSize: 11 }}>
              <summary style={{ color: '#9ba8b8', cursor: 'pointer' }}>QuerySpec</summary>
              <pre style={{ color: '#9ba8b8', fontSize: 11, whiteSpace: 'pre-wrap', marginTop: 4, padding: 6, background: 'rgba(0,0,0,0.3)', borderRadius: 6, overflow: 'auto', maxHeight: 150 }}>
                {JSON.stringify(querySpec, null, 2)}
              </pre>
            </details>
          )}

          {/* Footer */}
	          {!isUser && (
	            <>
	              <MessageFooter message={message} />
	              <div
	                data-qid="shared-chat:message-response-actions"
	                style={{
	                  display: 'flex',
	                  alignItems: 'center',
	                  gap: 10,
	                  marginTop: 10,
	                  color: '#9aa3b5',
	                }}
	              >
	                <button type="button" title="Good response" style={actionButtonStyle}>
	                  <ThumbsUp size={14} />
	                </button>
	                <button type="button" title="Bad response" style={actionButtonStyle}>
	                  <ThumbsDown size={14} />
	                </button>
	                <button type="button" title="Regenerate" style={actionButtonStyle}>
	                  <RotateCcw size={14} />
	                </button>
	                {onCopy && (
	                  <button type="button" onClick={onCopy} title="Copy" style={actionButtonStyle}>
	                    <Copy size={14} />
	                  </button>
	                )}
	                <button type="button" title="More actions" style={actionButtonStyle}>
	                  <MoreVertical size={14} />
	                </button>
	              </div>
	            </>
	          )}
        </div>
        {escalatedArtifact && (
          <WatchCanvasOverlay artifact={escalatedArtifact} mediaUrl={mediaUrl ?? defaultMediaUrl} onClose={() => setEscalatedArtifact(null)} />
        )}
      </div>
    )}
    </article>
  )
}

function WatchEvidenceCardStack({
  cards,
  mediaUrl,
  onEscalate,
}: {
  cards: UnknownRecord[]
  mediaUrl: (path: string) => string
  onEscalate: (artifact: UnknownRecord) => void
}): JSX.Element {
  return (
    <div data-qid="watch:chat:evidence-card-stack" style={{ display: 'grid', gap: 10, marginTop: 10 }}>
      {cards.map((card, index) => (
        <React.Fragment key={`${String(card.timecode ?? 'row')}-${index}`}>
          {index > 0 && <EvidenceBreak previousCard={cards[index - 1]} card={card} />}
          <WatchEvidenceCard card={card} mediaUrl={mediaUrl} onEscalate={onEscalate} />
        </React.Fragment>
      ))}
    </div>
  )
}

type VoiceAudioArtifact = {
  id: string
  label: string
  url: string
  path?: string
}

function normalizeAudioArtifacts(value: unknown): VoiceAudioArtifact[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (!isRecord(item)) return []
    const rawUrl = item.url ?? item.src ?? item.href ?? item.path
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return []
    const label = item.label ?? item.title ?? item.id ?? `audio_${index + 1}`
    return [{
      id: String(item.id ?? `audio-${index}`),
      label: String(label),
      url: rawUrl,
      path: typeof item.path === 'string' ? item.path : undefined,
    }]
  })
}

function VoiceAudioArtifacts({
  artifacts,
  mediaUrl,
}: {
  artifacts: VoiceAudioArtifact[]
  mediaUrl: (path: string) => string
}): JSX.Element {
  return (
    <div data-qid="shared-chat:voice-audio-artifacts" style={{ display: 'grid', gap: 8, marginTop: 10 }}>
      {artifacts.map((artifact) => {
        const src = artifact.url.startsWith('/') && !artifact.url.startsWith('/chatterbox-artifacts') ? mediaUrl(artifact.url) : artifact.url
        return (
          <div
            key={artifact.id}
            style={{
              display: 'grid',
              gap: 6,
              padding: 8,
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.075)',
              background: 'rgba(0,0,0,0.22)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#aeb7c6', fontSize: 11 }}>
              <PlayCircle size={13} />
              <span>{artifact.label}</span>
            </div>
            <audio data-embry-session-audio="true" controls preload="metadata" src={src} style={{ width: '100%', height: 30 }} />
          </div>
        )
      })}
    </div>
  )
}

function EvidenceBreak({ previousCard, card }: { previousCard?: UnknownRecord; card: UnknownRecord }): JSX.Element {
  const marker = evidenceBreakMarker(previousCard, card)
  const Icon = marker.icon
  return (
    <div className="watch-chat-evidence-divider" data-qid="watch:chat:evidence-divider">
      <span className="watch-chat-evidence-divider__line" />
      <span className="watch-chat-evidence-divider__badge">
        <span className="watch-chat-evidence-divider__icon" data-kind={marker.kind}>
          <Icon size={12} strokeWidth={1.8} aria-hidden="true" />
        </span>
        <span>{marker.label}</span>
      </span>
      <span className="watch-chat-evidence-divider__line" />
    </div>
  )
}

function evidenceBreakMarker(previousCard: UnknownRecord | undefined, card: UnknownRecord): { kind: string; label: string; icon: typeof GitCommit } {
  const previousSeconds = parseTimecodeSeconds(typeof previousCard?.timecode === 'string' ? previousCard.timecode : '')
  const nextSeconds = parseTimecodeSeconds(typeof card.timecode === 'string' ? card.timecode : '')
  if (previousSeconds != null && nextSeconds != null && Math.abs(nextSeconds - previousSeconds) > 120) {
    return { kind: 'time', label: `Time shift ${String(card.timecode ?? '')}`.trim(), icon: Clock }
  }
  const previousEntity = firstEvidenceEntity(previousCard)
  const nextEntity = firstEvidenceEntity(card)
  if (previousEntity && nextEntity && previousEntity !== nextEntity) {
    return { kind: 'entity', label: `Entity pivot ${nextEntity}`, icon: User }
  }
  return { kind: 'thread', label: `Evidence shift ${String(card.timecode ?? '')}`.trim(), icon: GitCommit }
}

function parseTimecodeSeconds(value: string): number | null {
  const parts = value.split(':').map((part) => Number(part))
  if (!parts.length || parts.some((part) => Number.isNaN(part))) return null
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}

function firstEvidenceEntity(card: UnknownRecord | undefined): string | undefined {
  const entities = Array.isArray(card?.entities) ? card.entities : []
  for (const entity of entities) {
    if (!entity || typeof entity !== 'object') continue
    const name = (entity as UnknownRecord).name
    if (typeof name === 'string' && name.trim()) return name.trim()
  }
  return undefined
}

function WatchEvidenceCard({
  card,
  mediaUrl,
  onEscalate,
}: {
  card: UnknownRecord
  mediaUrl: (path: string) => string
  onEscalate: (artifact: UnknownRecord) => void
}): JSX.Element {
  const entities = Array.isArray(card.entities) ? card.entities as UnknownRecord[] : []
  const image = typeof card.image === 'string' ? card.image : ''
  const clip = typeof card.clip === 'string' ? card.clip : ''
  const timecode = typeof card.timecode === 'string' ? card.timecode : 'Evidence'
  const segment = typeof card.segment === 'string' ? card.segment : ''
  const text = typeof card.text === 'string' ? card.text : ''
  const visual = typeof card.visual === 'string' ? card.visual : ''
  const evidenceRange = segment ? segment.replace(/\s*-\s*/, ' — ') : timecode

  return (
    <section data-qid="watch:chat:evidence-card" className="watch-chat-evidence-card" style={{
      position: 'relative',
      border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 12,
      background: 'rgba(255,255,255,0.035)',
      overflow: 'hidden',
    }}>
      <div className="watch-chat-evidence-card__data-strip" data-qid="watch:chat:evidence-card:data-strip">
        <span className="watch-chat-evidence-card__status">[!]</span>
        <span className="watch-chat-evidence-card__range">{evidenceRange}</span>
        <button
          type="button"
          data-qid="watch:chat:evidence-card:expand"
          className="watch-chat-evidence-card__expand"
          aria-label={`Expand evidence ${timecode}`}
          title="Open in canvas"
          onClick={() => onEscalate(card)}
        >
          <Maximize2 size={14} strokeWidth={1.7} aria-hidden="true" />
        </button>
      </div>

      {(image || clip) && (
        <div className="watch-chat-evidence-card__visual" data-qid="watch:chat:evidence-card:visual">
          <div className="watch-chat-evidence-card__zone-label">Frame</div>
          {image && (
            <img
              src={mediaUrl(image)}
              alt={`${timecode} evidence frame`}
              className="chat-prose__img"
              loading="lazy"
            />
          )}
          {clip && (
            <video
              src={mediaUrl(clip)}
              controls
              preload="metadata"
              className="chat-prose__video"
            />
          )}
        </div>
      )}

      <div className="watch-chat-evidence-card__transcript" data-qid="watch:chat:evidence-card:transcript">
        <div className="watch-chat-evidence-card__zone-label">SRT / Transcript</div>
        {text && <p style={{ margin: 0, color: '#e7edf4', fontSize: 13, lineHeight: 1.52 }}>{text}</p>}
        {visual && <p style={{ margin: 0, color: '#9aa8ba', fontSize: 11.5, lineHeight: 1.48 }}>{visual}</p>}
        {entities.length > 0 && (
          <div data-qid="watch:chat:entity-strip" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 2 }}>
            {entities.map((entity, index) => (
              <WatchEntityTag key={`${String(entity.name ?? 'entity')}-${index}`} entity={entity} />
            ))}
          </div>
        )}
      </div>
      <div className="watch-chat-evidence-card__footer" data-qid="watch:chat:evidence-card:footer">
        <button type="button" className="watch-chat-evidence-card__footer-action" title="Play clip">
          <PlayCircle size={15} strokeWidth={1.7} aria-hidden="true" />
          <span>Play</span>
        </button>
        <button type="button" className="watch-chat-evidence-card__footer-action" title="Locate row">
          <Search size={14} strokeWidth={1.7} aria-hidden="true" />
          <span>Locate</span>
        </button>
      </div>
	    </section>
  )
}

function WatchCanvasOverlay({
  artifact,
  mediaUrl,
  onClose,
}: {
  artifact: UnknownRecord
  mediaUrl: (path: string) => string
  onClose: () => void
}): JSX.Element {
  const image = typeof artifact.image === 'string' ? artifact.image : ''
  const clip = typeof artifact.clip === 'string' ? artifact.clip : ''
  const timecode = String(artifact.timecode ?? 'Watch evidence')
  const text = String(artifact.text ?? '')
  const visual = String(artifact.visual ?? '')
  const entities = Array.isArray(artifact.entities) ? artifact.entities as UnknownRecord[] : []
  return (
    <div data-qid="watch:canvas-overlay-backdrop" className="watch-canvas-overlay__backdrop" role="dialog" aria-modal="true">
      <section data-qid="watch:canvas-overlay" className="watch-canvas-overlay">
        <header className="watch-canvas-overlay__header">
          <div>
            <div className="watch-canvas-overlay__eyebrow">Watch Evidence Canvas</div>
            <div className="watch-canvas-overlay__title">{timecode}</div>
          </div>
          <button type="button" data-qid="watch:canvas-overlay:close" className="watch-canvas-overlay__close" onClick={onClose} aria-label="Close canvas">×</button>
        </header>
        <div className="watch-canvas-overlay__content">
          <div className="watch-canvas-overlay__media">
            {image && <img src={mediaUrl(image)} alt={`${timecode} evidence frame`} />}
            {clip && <video src={mediaUrl(clip)} controls preload="metadata" />}
          </div>
          <aside className="watch-canvas-overlay__detail">
            {text && <p>{text}</p>}
            {visual && <p>{visual}</p>}
            {entities.length > 0 && (
              <div className="watch-canvas-overlay__entities">
                {entities.map((entity, index) => <WatchEntityTag key={`${String(entity.name ?? 'entity')}-${index}`} entity={entity} />)}
              </div>
            )}
          </aside>
        </div>
      </section>
    </div>
  )
}

function WatchEntityTag({ entity }: { entity: UnknownRecord }): JSX.Element {
  const name = String(entity.name ?? entity.label ?? 'Entity')
  const type = String(entity.type ?? 'context')
  return (
    <button
      type="button"
      data-qid="watch:chat:entity-tag"
      title={`Filter Watch table by ${name}`}
      onClick={() => {
        window.dispatchEvent(new CustomEvent('watch:entity-filter', { detail: { entity: name, type } }))
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        border: '1px solid rgba(187,134,252,0.34)',
        borderRadius: 10,
        background: 'rgba(187,134,252,0.08)',
        color: '#e9ddff',
        padding: '2px 7px',
        fontSize: 11,
        cursor: 'pointer',
      }}
    >
      {type === 'location' ? <MapPin size={11} strokeWidth={1.7} aria-hidden="true" /> : type === 'character' ? <User size={11} strokeWidth={1.7} aria-hidden="true" /> : <Tag size={11} strokeWidth={1.7} aria-hidden="true" />}
      {name}
    </button>
  )
}

const actionButtonStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 5,
  border: 0,
  background: '#22232a',
  color: '#7f8798',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer',
}

function extractCodeBlocks(content: string): { code: string; language: string }[] {
  const blocks: { code: string; language: string }[] = []
  const regex = /```(\w+)?\n([\s\S]*?)```/g
  let match
  while ((match = regex.exec(content)) !== null) {
    blocks.push({
      language: match[1] || 'text',
      code: match[2].trim(),
    })
  }
  return blocks
}

function removeCodeBlocks(content: string): string {
  return content.replace(/```(\w+)?\n[\s\S]*?```/g, '').trim()
}

function renderTable(data: { headers?: string[]; rows?: string[][] }): string {
  if (!data.headers || !data.rows) return ''
  const header = `| ${data.headers.join(' | ')} |`
  const separator = `| ${data.headers.map(() => '---').join(' | ')} |`
  const body = data.rows.map(row => `| ${row.join(' | ')} |`).join('\n')
  return `${header}\n${separator}\n${body}`
}

export default ComplianceChatWell

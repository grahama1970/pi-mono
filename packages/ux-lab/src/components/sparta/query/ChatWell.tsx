/**
 * ChatWell — Shared chat interface for SPARTA Explorer and Embry Terminal.
 *
 * Layout ported from Embry Terminal:
 * - User messages: right-aligned bubbles
 * - System messages: flush left, no bubble
 * - RecallCard: collapsible score breakdown
 * - GateChain: collapsible evidence gate timeline
 * - Tool actions: muted collapsible lines
 * - Thumbs feedback on system messages
 */
import { useState, useRef, useEffect, useCallback, type ReactNode } from 'react'
import { EMBRY, fwBadge } from '../common/EmbryStyle'
import { RecallCard, type RecallItem } from './RecallCard'
import { GateChain } from './GateChain'
import { ThreatMatrixCard, type ThreatMatrixSummary } from './ThreatMatrixCard'
import { highlightEntities, MarkdownRenderer, SkillPalette } from '../../shared-chat'
import type { Skill } from '../../shared-chat'

export interface EntityRef {
  id: string
  label: string
  exists: boolean
}

export interface EvidenceGate {
  gate: string
  passed: boolean
  detail: string
  duration?: number
}

export type CascadeLayer = 'recall' | 'intent' | 'llm' | 'aql'

export interface ChatMessage {
  id: string
  role: 'user' | 'system'
  content: string
  type: 'natural' | 'aql'
  alertType?: 'threat-delta'
  timestamp: number
  resultCount?: number
  _querySpec?: Record<string, unknown>
  feedback?: 'up' | 'down' | null
  cascadeLayer?: CascadeLayer
  entities?: EntityRef[]
  verdict?: { state: string; gates: EvidenceGate[]; tier?: string }
  clarifyOptions?: Array<{ question: string }>
  /** Recall items with scores for RecallCard */
  recallItems?: RecallItem[]
  /** Skill that was invoked (shown as collapsible tool action) */
  skillUsed?: string
  /** Inline threat matrix summary card */
  matrixSummary?: ThreatMatrixSummary
}

export type { ThreatMatrixSummary }

export interface ChatWellProps {
  messages: ChatMessage[]
  onSend?: (query: string, type: 'natural' | 'aql') => void
  renderExtras?: (msg: ChatMessage) => ReactNode
  onClarifyClick?: (question: string) => void
  onFeedback?: (msgId: string, feedback: 'up' | 'down') => void
  onRunEvidenceCase?: (msg: ChatMessage) => void
  evidenceCaseLoading?: string | null
  onNavigateMatrix?: () => void
  /** Skills list for / palette — if provided, typing / triggers skill autocomplete */
  skills?: Skill[]
  /** Entity click handler — clicking AC-17, CWE-79, /assess triggers this */
  onEntityClick?: (entity: string, type: string) => void
}

const LAYER_COLORS: Record<CascadeLayer, string> = {
  recall: EMBRY.green,
  intent: EMBRY.blue,
  llm: EMBRY.amber,
  aql: EMBRY.accent,
}

// ── Tool Action (muted, collapsible — from Embry Terminal) ───────────────

function ToolAction({ label }: { label: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 4,
      fontSize: 11, color: EMBRY.muted, padding: '2px 0 4px',
    }}>
      <span style={{ color: EMBRY.blue, fontFamily: 'monospace', fontWeight: 600, fontSize: 10 }}>
        {label}
      </span>
    </div>
  )
}

// ── Message Component ────────────────────────────────────────────────────

function MessageItem({
  msg, onFeedback, onClarifyClick, onRunEvidenceCase, evidenceCaseLoading, renderExtras, onNavigateMatrix, onEntityClick,
}: {
  msg: ChatMessage
  onFeedback?: (id: string, fb: 'up' | 'down') => void
  onClarifyClick?: (q: string) => void
  onRunEvidenceCase?: (msg: ChatMessage) => void
  evidenceCaseLoading?: string | null
  renderExtras?: (msg: ChatMessage) => ReactNode
  onNavigateMatrix?: () => void
  onEntityClick?: (entity: string, type: string) => void
}) {
  const isUser = msg.role === 'user'

  // ── User message: right-aligned bubble ──
  if (isUser) {
    return (
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 0' }}>
        <div style={{
          maxWidth: '85%', padding: '10px 14px',
          borderRadius: '14px 14px 4px 14px',
          background: `${EMBRY.blue}18`,
          fontSize: 12, lineHeight: 1.6, color: EMBRY.white,
          fontFamily: msg.type === 'aql' ? 'monospace' : 'inherit',
        }}>
          {highlightEntities(msg.content)}
        </div>
      </div>
    )
  }

  // ── System message: flush left, no bubble ──
  return (
    <div style={{ padding: '8px 0' }}>
      {/* Tool action line */}
      {msg.skillUsed && <ToolAction label={`/${msg.skillUsed}`} />}

      {/* Cascade layer indicator */}
      {msg.cascadeLayer && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: LAYER_COLORS[msg.cascadeLayer],
            boxShadow: `0 0 4px ${LAYER_COLORS[msg.cascadeLayer]}`,
          }} />
          <span style={{
            fontSize: 9, color: LAYER_COLORS[msg.cascadeLayer],
            fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em',
            fontFamily: 'monospace',
          }}>
            {msg.cascadeLayer}
          </span>
        </div>
      )}

      {/* Content — shared MarkdownRenderer with entity highlighting */}
      <div style={{ fontSize: 12, lineHeight: 1.6, color: EMBRY.white }}>
        {msg.type === 'aql' ? (
          <pre style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap', margin: 0 }}>{msg.content}</pre>
        ) : (
          <MarkdownRenderer content={msg.content} onEntityClick={onEntityClick} />
        )}
      </div>

      {/* RecallCard — replaces raw "Found N results" text */}
      {msg.recallItems && msg.recallItems.length > 0 && (
        <RecallCard
          items={msg.recallItems}
          resultCount={msg.resultCount ?? msg.recallItems.length}
        />
      )}

      {/* Inline threat matrix card */}
      {msg.matrixSummary && (
        <ThreatMatrixCard summary={msg.matrixSummary} onNavigate={onNavigateMatrix} />
      )}

      {/* Entity pills */}
      {msg.entities && msg.entities.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          {msg.entities.map((e, i) => (
            <span key={i} style={{
              ...fwBadge(e.exists ? 'SPARTA' : 'CWE'),
              opacity: e.exists ? 1 : 0.5,
              cursor: 'pointer',
            }} title={`${e.id} — ${e.exists ? 'found' : 'not found'}`}>
              {e.label}
            </span>
          ))}
        </div>
      )}

      {/* GateChain — replaces inline gate dots */}
      {msg.verdict && (
        <GateChain
          gates={msg.verdict.gates}
          verdict={msg.verdict.state}
          tier={msg.verdict.tier}
        />
      )}

      {/* Run Evidence Case button */}
      {onRunEvidenceCase && msg.entities && msg.entities.some(e => e.exists) && !msg.verdict && (
        <button
          onClick={() => onRunEvidenceCase(msg)}
          disabled={evidenceCaseLoading === msg.id}
          style={{
            marginTop: 6, fontSize: 10, fontWeight: 700,
            padding: '4px 12px', borderRadius: 12,
            border: `1px solid ${EMBRY.accent}66`,
            backgroundColor: evidenceCaseLoading === msg.id ? `${EMBRY.accent}08` : `${EMBRY.accent}18`,
            color: EMBRY.accent,
            cursor: evidenceCaseLoading === msg.id ? 'wait' : 'pointer',
            letterSpacing: '0.05em', textTransform: 'uppercase',
            opacity: evidenceCaseLoading === msg.id ? 0.6 : 1,
          }}
        >
          {evidenceCaseLoading === msg.id ? 'Running\u2026' : 'Run Evidence Case'}
        </button>
      )}

      {/* Clarify chips */}
      {msg.clarifyOptions && msg.clarifyOptions.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 6 }}>
          {msg.clarifyOptions.map((c, i) => (
            <button key={i} onClick={() => onClarifyClick?.(c.question)} style={{
              fontSize: 10, padding: '3px 8px', borderRadius: 12,
              border: `1px solid ${EMBRY.accent}44`, backgroundColor: `${EMBRY.accent}12`,
              color: EMBRY.accent, cursor: 'pointer',
            }}>
              {c.question}
            </button>
          ))}
        </div>
      )}

      {/* QuerySpec collapsible */}
      {msg._querySpec && (
        <details style={{ marginTop: 6, fontSize: 10 }}>
          <summary style={{ color: EMBRY.dim, cursor: 'pointer' }}>QuerySpec</summary>
          <pre style={{
            color: EMBRY.dim, fontSize: 9, whiteSpace: 'pre-wrap',
            marginTop: 4, padding: 6, backgroundColor: EMBRY.bgDeep,
            borderRadius: 4, overflow: 'auto', maxHeight: 150,
          }}>
            {JSON.stringify(msg._querySpec, null, 2)}
          </pre>
        </details>
      )}

      {/* Thumbs */}
      {onFeedback && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <button onClick={() => onFeedback(msg.id, 'up')} style={{
            background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
            opacity: msg.feedback === 'up' ? 1 : 0.3,
            filter: msg.feedback === 'up' ? `drop-shadow(0 0 4px ${EMBRY.green})` : 'none',
          }}>
            {'\u25B2'}
          </button>
          <button onClick={() => onFeedback(msg.id, 'down')} style={{
            background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
            opacity: msg.feedback === 'down' ? 1 : 0.3,
            filter: msg.feedback === 'down' ? `drop-shadow(0 0 4px ${EMBRY.red})` : 'none',
          }}>
            {'\u25BC'}
          </button>
        </div>
      )}

      {renderExtras?.(msg)}
    </div>
  )
}

// ── Main ChatWell ────────────────────────────────────────────────────────

export function ChatWell({ messages, onSend, renderExtras, onClarifyClick, onFeedback, onRunEvidenceCase, evidenceCaseLoading, onNavigateMatrix, skills, onEntityClick }: ChatWellProps) {
  const [input, setInput] = useState('')
  const [showPalette, setShowPalette] = useState(false)
  const [skillFilter, setSkillFilter] = useState('')
  const paletteKeyHandler = useRef<((e: React.KeyboardEvent) => boolean) | null>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  const handleSend = useCallback(() => {
    if (!input.trim()) return
    onSend?.(input.trim(), 'natural')
    setInput('')
    setShowPalette(false)
  }, [input, onSend])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInput(val)
    const lastWord = val.split(/\s+/).pop() || ''
    if (lastWord.startsWith('/') && lastWord.length > 1) {
      setShowPalette(true)
      setSkillFilter(lastWord.slice(1))
    } else {
      setShowPalette(false)
    }
  }, [])

  const handleSkillSelect = useCallback((name: string) => {
    const words = input.split(/\s+/)
    words[words.length - 1] = `/${name} `
    setInput(words.join(' '))
    setShowPalette(false)
  }, [input])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (showPalette && paletteKeyHandler.current?.(e)) return
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }, [handleSend, showPalette])

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
      background: EMBRY.bg,
    }}>
      {/* Messages — scrollable, full height */}
      <div style={{
        flex: 1, overflow: 'auto', padding: '8px 16px',
        display: 'flex', flexDirection: 'column',
      }}>
        {messages.length === 0 && (
          <div style={{
            color: EMBRY.muted, fontSize: 12, textAlign: 'center',
            padding: '48px 24px', lineHeight: 1.8,
          }}>
            "Show me the F-36 threat matrix"
          </div>
        )}
        {messages.map((msg) => (
          <MessageItem
            key={msg.id}
            msg={msg}
            onFeedback={onFeedback}
            onClarifyClick={onClarifyClick}
            onRunEvidenceCase={onRunEvidenceCase}
            evidenceCaseLoading={evidenceCaseLoading}
            renderExtras={renderExtras}
            onNavigateMatrix={onNavigateMatrix}
            onEntityClick={onEntityClick}
          />
        ))}
        <div ref={chatEndRef} />
      </div>

      {/* Composer — with skill palette */}
      <div style={{
        padding: '8px 12px 12px',
        borderTop: `1px solid ${EMBRY.border}`,
        background: EMBRY.bgPanel,
      }}>
        <div style={{
          background: EMBRY.bgDeep,
          border: `1px solid ${EMBRY.border}`,
          borderRadius: 12, overflow: 'hidden',
          position: 'relative',
        }}>
          {showPalette && skills && skills.length > 0 && (
            <SkillPalette
              filter={skillFilter}
              skills={skills}
              onSelect={handleSkillSelect}
              onClose={() => setShowPalette(false)}
              onKeyNav={handler => { paletteKeyHandler.current = handler }}
            />
          )}
          <textarea
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the SPARTA graph... (/ for skills)"
            style={{
              width: '100%', border: 'none', outline: 'none', resize: 'none',
              background: 'transparent', fontSize: 13, color: EMBRY.white,
              padding: '10px 14px 6px', lineHeight: 1.5,
              minHeight: 24, maxHeight: 120,
            }}
            rows={1}
          />
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            padding: '2px 8px 6px',
          }}>
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              style={{
                width: 28, height: 28, borderRadius: '50%', border: 'none',
                cursor: input.trim() ? 'pointer' : 'default',
                background: input.trim() ? EMBRY.green : EMBRY.muted,
                color: input.trim() ? '#000' : EMBRY.dim,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 900, transition: 'all 0.15s',
              }}
            >
              {'\u2191'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

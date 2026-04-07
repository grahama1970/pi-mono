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
import { EMBRY, fwBadge } from '../sparta/common/EmbryStyle'
import ReasoningBlock from './ReasoningBlock'
import { highlightEntities } from './highlightEntities'
import { MarkdownRenderer } from './MarkdownRenderer'
import { SkillPalette } from './SkillPalette'
import { RecallCard } from '../sparta/query/RecallCard'
import { GateChain } from '../sparta/query/GateChain'
import { ThreatMatrixCard } from '../sparta/query/ThreatMatrixCard'
import { ToolAction } from './ToolAction'
import type {
  ChatMessage, Skill, EntityRef, EvidenceGate, CascadeLayer,
  ThreatMatrixSummary, RecallItem,
} from './types'

// ChatMessage, EntityRef, EvidenceGate, CascadeLayer, ThreatMatrixSummary, RecallItem
// are all imported from shared-chat — no local definitions needed.
export type { ChatMessage, ThreatMatrixSummary, EntityRef, EvidenceGate, CascadeLayer } from './highlightEntities'

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

// ToolAction imported from shared-chat (COTS compliant: 44px touch, 13px font, tooltip)

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

  // ── System message: card with left accent border ──
  const layerColor = msg.cascadeLayer ? LAYER_COLORS[msg.cascadeLayer] : EMBRY.border
  return (
    <div style={{
      padding: '10px 12px', margin: '6px 0',
      borderRadius: 8, borderLeft: `3px solid ${layerColor}`,
      background: `${layerColor}06`,
    }}>
      {/* Tool action line */}
      {msg.skillUsed && <ToolAction label={`Ran /${msg.skillUsed}`} qid={`chat:skill:${msg.skillUsed}`} />}

      {/* Cascade layer indicator */}
      {msg.cascadeLayer && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: layerColor,
            boxShadow: `0 0 4px ${layerColor}`,
          }} />
          <span style={{
            fontSize: 10, color: layerColor,
            fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em',
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

      {/* Reasoning Block — unified evidence case display (replaces separate GateChain + RecallCard) */}
      {msg.evidenceCase && (
        <ReasoningBlock data={msg.evidenceCase} onNavigateToControl={onEntityClick ? (id) => onEntityClick(id, 'control') : undefined} />
      )}

      {/* RecallCard — only when no evidenceCase (fallback for non-evidence messages) */}
      {!msg.evidenceCase && msg.recallItems && msg.recallItems.length > 0 && (
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

      {/* GateChain — only when no evidenceCase (fallback for legacy verdict format) */}
      {!msg.evidenceCase && msg.verdict && (
        <GateChain
          gates={msg.verdict.gates}
          verdict={msg.verdict.state}
          tier={msg.verdict.tier}
        />
      )}

      {/* Run Evidence Case button */}
      {onRunEvidenceCase && msg.entities && msg.entities.some(e => e.exists) && !msg.verdict && (
        <button
          data-qid={`chat:evidence-case:${msg.id}`} title="Run evidence case for this message" onClick={() => onRunEvidenceCase(msg)}
          disabled={evidenceCaseLoading === msg.id}
          style={{
            marginTop: 6, fontSize: 12, fontWeight: 700,
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
            <button key={i} data-qid={`chat:clarify:${i}`} title={c.question} onClick={() => onClarifyClick?.(c.question)} style={{
              fontSize: 12, padding: '3px 8px', borderRadius: 12,
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
            color: EMBRY.dim, fontSize: 12, whiteSpace: 'pre-wrap',
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
          <button data-qid={`chat:feedback-up:${msg.id}`} title="Helpful response" onClick={() => onFeedback(msg.id, 'up')} style={{
            background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
            opacity: msg.feedback === 'up' ? 1 : 0.3,
            filter: msg.feedback === 'up' ? `drop-shadow(0 0 4px ${EMBRY.green})` : 'none',
          }}>
            {'\u25B2'}
          </button>
          <button data-qid={`chat:feedback-down:${msg.id}`} title="Not helpful" onClick={() => onFeedback(msg.id, 'down')} style={{
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
          <div style={{ padding: '32px 16px', display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
            <div style={{ color: EMBRY.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Ask a question</div>
            {[
              'Show me the F-36 threat matrix',
              'What SPARTA controls cover supply chain attacks?',
              'Which controls have no evidence cases?',
              'Run an evidence case for firmware tampering on avionics',
              'What is our CMMC Level 2 compliance posture?',
              'Show controls related to CWE-287 authentication bypass',
            ].map((q) => (
              <button key={q} onClick={() => onSend?.(q, 'natural')} style={{
                background: `${EMBRY.accent}08`, border: `1px solid ${EMBRY.accent}22`,
                borderRadius: 8, padding: '10px 16px', cursor: 'pointer',
                color: EMBRY.dim, fontSize: 12, textAlign: 'left', width: '100%',
                transition: 'all 0.15s',
              }} onMouseEnter={e => { e.currentTarget.style.borderColor = EMBRY.accent; e.currentTarget.style.color = EMBRY.white }}
                 onMouseLeave={e => { e.currentTarget.style.borderColor = `${EMBRY.accent}22`; e.currentTarget.style.color = EMBRY.dim }}>
                {q}
              </button>
            ))}
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
            data-qid="chat:input" title="Type a message or /skill-name" placeholder="Ask about the SPARTA graph... (/ for skills)"
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
              data-qid="chat:send" title="Send message (Enter)"
              aria-label="Send message"
              style={{
                width: 44, height: 44, borderRadius: '50%', border: 'none',
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

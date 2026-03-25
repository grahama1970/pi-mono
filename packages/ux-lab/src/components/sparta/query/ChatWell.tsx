import { useState, type ReactNode } from 'react'
import { EMBRY, card, label, heading, glowDot, fwBadge } from '../common/EmbryStyle'

/** Chat well for natural language + direct AQL queries through /memory */

export interface EntityRef {
  id: string
  label: string
  exists: boolean
}

export interface EvidenceGate {
  gate: string
  passed: boolean
  detail: string
}

export type CascadeLayer = 'recall' | 'intent' | 'llm' | 'aql'

export interface ChatMessage {
  id: string
  role: 'user' | 'system'
  content: string
  type: 'natural' | 'aql'
  timestamp: number
  resultCount?: number
  _querySpec?: Record<string, unknown>
  feedback?: 'up' | 'down' | null
  cascadeLayer?: CascadeLayer
  entities?: EntityRef[]
  verdict?: { state: string; gates: EvidenceGate[] }
  clarifyOptions?: Array<{ question: string }>
}

export interface ChatWellProps {
  messages: ChatMessage[]
  onSend?: (query: string, type: 'natural' | 'aql') => void
  renderExtras?: (msg: ChatMessage) => ReactNode
  onClarifyClick?: (question: string) => void
  onFeedback?: (msgId: string, feedback: 'up' | 'down') => void
}

const LAYER_COLORS: Record<CascadeLayer, string> = {
  recall: EMBRY.green,
  intent: EMBRY.blue,
  llm: EMBRY.amber,
  aql: EMBRY.accent,
}

export function ChatWell({ messages, onSend, renderExtras, onClarifyClick, onFeedback }: ChatWellProps) {
  const [input, setInput] = useState('')
  const [mode, setMode] = useState<'natural' | 'aql'>('natural')

  const handleSend = () => {
    if (!input.trim()) return
    onSend?.(input.trim(), mode)
    setInput('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div style={{ ...card, padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${EMBRY.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={heading}>Query</div>
          <div style={{ ...label, marginTop: 2 }}>Natural language or AQL via /memory</div>
        </div>
        {/* Mode toggle */}
        <div style={{
          display: 'flex',
          backgroundColor: EMBRY.bgDeep,
          borderRadius: 6,
          padding: 2,
        }}>
          {(['natural', 'aql'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                fontSize: 10,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.1em',
                padding: '4px 12px',
                borderRadius: 4,
                border: 'none',
                cursor: 'pointer',
                backgroundColor: mode === m ? EMBRY.blue : 'transparent',
                color: mode === m ? '#fff' : EMBRY.dim,
                transition: 'all 0.15s',
              }}
            >
              {m === 'natural' ? 'English' : 'AQL'}
            </button>
          ))}
        </div>
      </div>

      {/* Messages */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minHeight: 120,
        maxHeight: 300,
      }}>
        {messages.length === 0 && (
          <div style={{ color: EMBRY.dim, fontSize: 12, textAlign: 'center', padding: 24 }}>
            {mode === 'natural'
              ? '"Show me SPARTA techniques with no D3FEND countermeasure"'
              : 'FOR doc IN sparta_controls FILTER doc.framework == "SPARTA" RETURN doc'}
          </div>
        )}
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              padding: '8px 12px',
              borderRadius: 8,
              backgroundColor: msg.role === 'user' ? `${EMBRY.blue}18` : EMBRY.bgDeep,
              borderLeft: msg.role === 'user'
                ? `3px solid ${EMBRY.blue}`
                : `3px solid ${EMBRY.green}`,
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{
                ...label,
                color: msg.role === 'user' ? EMBRY.blue : EMBRY.green,
                margin: 0,
              }}>
                {msg.role === 'user' ? (msg.type === 'aql' ? 'AQL' : 'Query') : 'Result'}
              </span>
              {msg.resultCount !== undefined && (
                <span style={{ fontSize: 10, color: EMBRY.dim }}>
                  {msg.resultCount} results
                </span>
              )}
            </div>
            <div style={{
              color: EMBRY.white,
              fontFamily: msg.type === 'aql' ? 'monospace' : 'inherit',
              fontSize: msg.type === 'aql' ? 11 : 12,
              whiteSpace: 'pre-wrap',
              lineHeight: 1.5,
            }}>
              {msg.content}
            </div>

            {/* Cascade layer indicator */}
            {msg.role === 'system' && msg.cascadeLayer && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <div style={glowDot(LAYER_COLORS[msg.cascadeLayer], 6)} />
                <span style={{ fontSize: 9, color: LAYER_COLORS[msg.cascadeLayer], fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  {msg.cascadeLayer}
                </span>
                {msg.resultCount !== undefined && (
                  <span style={{ fontSize: 9, color: EMBRY.dim }}>
                    {msg.resultCount} results{msg.cascadeLayer === 'recall' ? ' (free)' : ''}
                  </span>
                )}
              </div>
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

            {/* Evidence gate summary */}
            {msg.verdict && (
              <div style={{ marginTop: 6, padding: '4px 8px', borderRadius: 4, backgroundColor: `${msg.verdict.state === 'SATISFIED' ? EMBRY.green : msg.verdict.state === 'INCONCLUSIVE' ? EMBRY.amber : EMBRY.red}12`, border: `1px solid ${msg.verdict.state === 'SATISFIED' ? EMBRY.green : msg.verdict.state === 'INCONCLUSIVE' ? EMBRY.amber : EMBRY.red}33` }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: msg.verdict.state === 'SATISFIED' ? EMBRY.green : msg.verdict.state === 'INCONCLUSIVE' ? EMBRY.amber : EMBRY.red, marginBottom: 2 }}>
                  GATE: {msg.verdict.state}
                </div>
                {msg.verdict.gates.map((g, i) => (
                  <div key={i} style={{ fontSize: 9, color: EMBRY.dim }}>
                    {g.passed ? '\u2713' : '\u2717'} {g.gate}: {g.detail}
                  </div>
                ))}
              </div>
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
                <pre style={{ color: EMBRY.dim, fontSize: 9, whiteSpace: 'pre-wrap', marginTop: 4, padding: 6, backgroundColor: EMBRY.bgDeep, borderRadius: 4, overflow: 'auto', maxHeight: 150 }}>
                  {JSON.stringify(msg._querySpec, null, 2)}
                </pre>
              </details>
            )}

            {/* Thumbs + extras */}
            {msg.role === 'system' && onFeedback && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <button onClick={() => onFeedback(msg.id, 'up')} style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
                  opacity: msg.feedback === 'up' ? 1 : 0.4,
                  filter: msg.feedback === 'up' ? `drop-shadow(0 0 4px ${EMBRY.green})` : 'none',
                }}>
                  {'\u{1F44D}'}
                </button>
                <button onClick={() => onFeedback(msg.id, 'down')} style={{
                  background: 'none', border: 'none', cursor: 'pointer', fontSize: 12,
                  opacity: msg.feedback === 'down' ? 1 : 0.4,
                  filter: msg.feedback === 'down' ? `drop-shadow(0 0 4px ${EMBRY.red})` : 'none',
                }}>
                  {'\u{1F44E}'}
                </button>
              </div>
            )}

            {renderExtras?.(msg)}
          </div>
        ))}
      </div>

      {/* Input */}
      <div style={{
        padding: 12,
        borderTop: `1px solid ${EMBRY.border}`,
        display: 'flex',
        gap: 8,
      }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={mode === 'natural'
            ? 'Ask about the SPARTA graph...'
            : 'FOR doc IN sparta_controls ...'}
          style={{
            flex: 1,
            backgroundColor: EMBRY.bgDeep,
            border: `1px solid ${EMBRY.border}`,
            borderRadius: 8,
            padding: '8px 12px',
            fontSize: 12,
            color: EMBRY.white,
            fontFamily: mode === 'aql' ? 'monospace' : 'inherit',
            resize: 'none',
            outline: 'none',
            minHeight: 36,
            maxHeight: 80,
          }}
          rows={1}
        />
        <button
          onClick={handleSend}
          style={{
            backgroundColor: EMBRY.green,
            color: '#000',
            border: 'none',
            borderRadius: 8,
            padding: '0 16px',
            fontSize: 11,
            fontWeight: 900,
            cursor: 'pointer',
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
          }}
        >
          Send
        </button>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { EMBRY, card, label, heading } from '../common/EmbryStyle'

/** Chat well for natural language + direct AQL queries through /memory */

export interface ChatMessage {
  id: string
  role: 'user' | 'system'
  content: string
  type: 'natural' | 'aql'
  timestamp: number
  resultCount?: number
}

export interface ChatWellProps {
  messages: ChatMessage[]
  onSend?: (query: string, type: 'natural' | 'aql') => void
}

export function ChatWell({ messages, onSend }: ChatWellProps) {
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

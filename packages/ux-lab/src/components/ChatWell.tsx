import { useState, useRef, useEffect } from 'react'
import { MessageSquare } from 'lucide-react'
import { EMBRY, glowDot } from './sparta/common/EmbryStyle'

const API = 'http://localhost:3001'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export function ChatWell() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  async function send() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    const userMsg: Message = { role: 'user', content: text, timestamp: new Date().toISOString() }
    setMessages((prev) => [...prev, userMsg])
    setLoading(true)

    try {
      const res = await fetch(`${API}/api/scillm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'text',
          messages: [
            { role: 'system', content: 'You are Embry, a helpful lab assistant. Answer concisely. You have access to SPARTA security controls and QRA data.' },
            ...messages.map((m) => ({ role: m.role, content: m.content })),
            { role: 'user', content: text },
          ],
          temperature: 0.3,
          max_tokens: 512,
        }),
      })
      const data = await res.json()
      const reply = data.choices?.[0]?.message?.content || data.error || 'No response'
      setMessages((prev) => [...prev, { role: 'assistant', content: reply, timestamp: new Date().toISOString() }])
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err instanceof Error ? err.message : String(err)}`, timestamp: new Date().toISOString() }])
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title="Chat with Embry"
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
          transition: 'box-shadow 0.2s ease',
        }}
      >
        <div style={glowDot(EMBRY.accent, 14)} />
      </button>
    )
  }

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        width: 360,
        height: 480,
        borderRadius: 12,
        border: `1px solid ${EMBRY.accent}44`,
        backgroundColor: EMBRY.bgCard,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: `0 8px 32px rgba(0,0,0,0.6)`,
        zIndex: 1000,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '10px 14px',
          backgroundColor: EMBRY.bgHeader,
          borderBottom: `1px solid ${EMBRY.border}`,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: EMBRY.green, boxShadow: `0 0 6px ${EMBRY.green}` }} />
          <span style={{ fontSize: 12, fontWeight: 700, color: EMBRY.white }}>Embry</span>
          <span style={{ fontSize: 9, color: EMBRY.dim }}>via /scillm</span>
        </div>
        <button
          onClick={() => setOpen(false)}
          style={{
            background: 'none',
            border: 'none',
            color: EMBRY.dim,
            fontSize: 16,
            cursor: 'pointer',
            padding: '0 4px',
          }}
        >
          x
        </button>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {messages.length === 0 && (
          <div style={{ fontSize: 11, color: EMBRY.dim, textAlign: 'center', marginTop: 40 }}>
            Ask Embry anything. Try:<br />
            <span style={{ color: EMBRY.accent }}>"recall SPARTA controls for link encryption"</span><br />
            <span style={{ color: EMBRY.accent }}>"what CWEs map to SA-01?"</span>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              padding: '8px 12px',
              borderRadius: m.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
              backgroundColor: m.role === 'user' ? `${EMBRY.accent}20` : EMBRY.bgPanel,
              border: `1px solid ${m.role === 'user' ? EMBRY.accent + '33' : EMBRY.border}`,
              fontSize: 12,
              color: EMBRY.white,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            {m.content}
          </div>
        ))}
        {loading && (
          <div style={{ alignSelf: 'flex-start', fontSize: 11, color: EMBRY.dim, fontStyle: 'italic' }}>
            thinking...
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => { e.preventDefault(); send() }}
        style={{
          display: 'flex',
          gap: 6,
          padding: '8px 12px',
          borderTop: `1px solid ${EMBRY.border}`,
          flexShrink: 0,
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Embry..."
          disabled={loading}
          style={{
            flex: 1,
            backgroundColor: EMBRY.bg,
            border: `1px solid ${EMBRY.border}`,
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 12,
            color: EMBRY.white,
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            border: 'none',
            backgroundColor: EMBRY.accent,
            color: '#000',
            fontSize: 11,
            fontWeight: 700,
            cursor: loading ? 'wait' : 'pointer',
            opacity: loading || !input.trim() ? 0.5 : 1,
          }}
        >
          Send
        </button>
      </form>
    </div>
  )
}

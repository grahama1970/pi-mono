import { useState, useRef, useEffect, useCallback } from 'react'
import { NVIS } from '../theme'
import { useAgentStore } from '../store/agentStore'
import { timeAgo } from '../utils/timeago'

const MAX_VISIBLE = 50

const styles = {
  container: {
    backgroundColor: NVIS.BG_SECONDARY,
    borderTop: `1px solid ${NVIS.DIM}`,
    display: 'flex',
    flexDirection: 'column' as const,
    height: 200,
    flexShrink: 0,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 12px',
    fontSize: 11,
    fontWeight: 600,
    color: NVIS.WHITE,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    borderBottom: `1px solid ${NVIS.DIM}`,
    flexShrink: 0,
  },
  messageList: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '4px 12px',
  },
  messageRow: {
    display: 'flex',
    gap: 8,
    padding: '3px 0',
    fontSize: 12,
    lineHeight: '1.4',
  },
  senderHuman: {
    fontWeight: 600,
    color: NVIS.BLUE,
    flexShrink: 0,
  },
  senderAgent: (color: string) => ({
    fontWeight: 600,
    color,
    flexShrink: 0,
  }),
  timestamp: {
    color: NVIS.DIM,
    fontFamily: 'monospace',
    fontSize: 10,
    flexShrink: 0,
  },
  messageText: {
    color: NVIS.WHITE,
    wordBreak: 'break-word' as const,
  },
  inputRow: {
    display: 'flex',
    gap: 8,
    padding: '8px 12px',
    borderTop: `1px solid ${NVIS.DIM}`,
    flexShrink: 0,
  },
  targetSelect: {
    backgroundColor: NVIS.BG_TERTIARY,
    color: NVIS.WHITE,
    border: `1px solid ${NVIS.DIM}`,
    borderRadius: 4,
    padding: '4px 8px',
    fontSize: 12,
    outline: 'none',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    backgroundColor: NVIS.BG_TERTIARY,
    color: NVIS.WHITE,
    border: `1px solid ${NVIS.DIM}`,
    borderRadius: 4,
    padding: '4px 8px',
    fontSize: 12,
    outline: 'none',
    resize: 'none' as const,
    fontFamily: 'inherit',
  },
  sendButton: {
    backgroundColor: NVIS.GREEN,
    color: NVIS.BG_PRIMARY,
    border: 'none',
    borderRadius: 4,
    padding: '4px 14px',
    fontSize: 12,
    fontWeight: 700,
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'background-color 0.15s ease',
  },
  sendButtonFlash: {
    backgroundColor: '#66ffbb',
  },
}

export function CourseCorrection() {
  const [message, setMessage] = useState('')
  const [target, setTarget] = useState('all')
  const [flash, setFlash] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)

  const agents = useAgentStore((s) => s.agents)
  const corrections = useAgentStore((s) => s.corrections)
  const addCorrection = useAgentStore((s) => s.addCorrection)

  const agentList = Object.values(agents)
  const visibleCorrections = corrections.slice(-MAX_VISIBLE)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [corrections.length])

  const handleSend = useCallback(() => {
    const trimmed = message.trim()
    if (!trimmed) return

    addCorrection({
      from: 'human',
      target,
      message: trimmed,
      timestamp: Date.now(),
    })

    setMessage('')
    setFlash(true)
    setTimeout(() => setFlash(false), 300)
  }, [message, target, addCorrection])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  const getSenderDisplay = (from: string) => {
    if (from === 'human') {
      return { name: 'You', color: NVIS.BLUE }
    }
    const agent = agents[from]
    if (agent) {
      return { name: agent.name, color: agent.color }
    }
    return { name: from, color: NVIS.DIM }
  }

  return (
    <div style={styles.container} data-testid="course-correction">
      <div style={styles.header}>
        <span>Agent Inbox</span>
        <span style={{ fontSize: 10, color: NVIS.DIM, fontWeight: 400 }}>
          {corrections.length} message{corrections.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div style={styles.messageList} ref={listRef} data-testid="correction-messages">
        {visibleCorrections.map((c, i) => {
          const sender = getSenderDisplay(c.from)
          return (
            <div key={i} style={styles.messageRow}>
              <span style={styles.timestamp}>{timeAgo(c.timestamp)}</span>
              <span
                style={
                  c.from === 'human'
                    ? styles.senderHuman
                    : styles.senderAgent(sender.color)
                }
              >
                {sender.name}
              </span>
              <span style={styles.messageText}>
                {c.target !== 'all' ? `@${c.target}: ` : ''}
                {c.message}
              </span>
            </div>
          )
        })}
      </div>

      <div style={styles.inputRow}>
        <select
          style={styles.targetSelect}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          data-testid="correction-target"
        >
          <option value="all">All agents</option>
          {agentList.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>

        <textarea
          style={styles.input}
          rows={1}
          placeholder="Course correction..."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          data-testid="correction-input"
        />

        <button
          style={{
            ...styles.sendButton,
            ...(flash ? styles.sendButtonFlash : {}),
          }}
          onClick={handleSend}
          data-testid="correction-send"
        >
          Send
        </button>
      </div>
    </div>
  )
}

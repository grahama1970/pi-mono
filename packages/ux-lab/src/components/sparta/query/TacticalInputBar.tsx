/**
 * TacticalInputBar — 2026 Modern Floating Command Bar
 *
 * Glassmorphic HUD overlay with NVIS-compatible aesthetics.
 * - Utility Cluster: skills (terminal), attach (paperclip)
 * - Expansion Zone: auto-growing textarea
 * - Transmission Cluster: voice (mic), send (arrow-up)
 *
 * Complies with:
 * - COTS C02: 44px minimum touch targets
 * - NVIS Class A: White Phosphor palette, 1.25px strokes
 */
import { useCallback, useRef, useState, type KeyboardEvent, type ChangeEvent } from 'react'
import { Terminal, Paperclip, Mic, ArrowUp, AudioLines } from 'lucide-react'

// NVIS 2026 Color Palette
const NVIS = {
  phosphor: '#e0e4e8',
  cyan: '#00d1ff',
  glassBg: 'rgba(13, 14, 16, 0.7)',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
  cyanGlow: 'rgba(0, 209, 255, 0.15)',
  dark: '#08090a',
}

interface TacticalInputBarProps {
  onSend: (query: string, type: 'natural' | 'aql') => void
  onSkillsOpen?: () => void
  onAttach?: () => void
  onVoiceStart?: () => void
  placeholder?: string
  disabled?: boolean
  voiceActive?: boolean
}

export function TacticalInputBar({
  onSend,
  onSkillsOpen,
  onAttach,
  onVoiceStart,
  placeholder = 'Ask anything... (/ for skills)',
  disabled = false,
  voiceActive = false,
}: TacticalInputBarProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleChange = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value)
    // Auto-expand textarea
    const ta = e.target
    ta.style.height = ''
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`
  }, [])

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return

    const isAql = trimmed.toLowerCase().startsWith('for ') || trimmed.includes('RETURN')
    onSend(trimmed, isAql ? 'aql' : 'natural')
    setValue('')

    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = ''
    }
  }, [value, disabled, onSend])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter to send, Shift+Enter for newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
    // Slash at start opens skills
    if (e.key === '/' && value === '' && onSkillsOpen) {
      e.preventDefault()
      onSkillsOpen()
    }
  }, [handleSubmit, value, onSkillsOpen])

  return (
    <div style={styles.container}>
      <div style={{
        ...styles.bar,
        ...(value.length > 0 ? styles.barFocused : {}),
      }}>
        {/* Utility Cluster */}
        <div style={styles.cluster}>
          <button
            data-qid="sparta:input:skills"
            data-qs-action="OPEN_SKILLS"
            title="Skills (⌘K)"
            style={styles.lucideBtn}
            onClick={onSkillsOpen}
            disabled={disabled}
          >
            <Terminal size={18} strokeWidth={1.25} />
          </button>
          <button
            data-qid="sparta:input:attach"
            data-qs-action="ATTACH_FILE"
            title="Attach evidence file"
            style={styles.lucideBtn}
            onClick={onAttach}
            disabled={disabled}
          >
            <Paperclip size={18} strokeWidth={1.25} />
          </button>
        </div>

        {/* Expansion Zone */}
        <textarea
          ref={textareaRef}
          data-qid="sparta:input:textarea"
          placeholder={placeholder}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          style={styles.textarea}
        />

        {/* Transmission Cluster */}
        <div style={styles.cluster}>
          <button
            data-qid="sparta:input:voice"
            data-qs-action="VOICE_MODE"
            title="Voice mode"
            style={{
              ...styles.lucideBtn,
              ...(voiceActive ? styles.voiceActive : {}),
            }}
            onClick={onVoiceStart}
            disabled={disabled}
          >
            {voiceActive ? (
              <AudioLines size={18} strokeWidth={1.25} />
            ) : (
              <Mic size={18} strokeWidth={1.25} />
            )}
          </button>
          <button
            data-qid="sparta:input:send"
            data-qs-action="SEND_QUERY"
            title="Send (Enter)"
            style={{
              ...styles.sendPill,
              ...(value.trim() ? styles.sendPillActive : {}),
            }}
            onClick={handleSubmit}
            disabled={disabled || !value.trim()}
          >
            <ArrowUp size={18} strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    bottom: 12,
    left: 12,
    right: 12,
    zIndex: 100,
  },
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    background: NVIS.glassBg,
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
    border: `1px solid ${NVIS.glassBorder}`,
    borderRadius: 8,
    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 80px rgba(0, 209, 255, 0.05)',
    transition: 'border-color 0.2s, box-shadow 0.2s',
    pointerEvents: 'auto', // Re-enable clicks on the bar itself
  },
  barFocused: {
    borderColor: NVIS.cyan,
    boxShadow: `0 8px 32px rgba(0, 0, 0, 0.5), 0 0 0 1px ${NVIS.cyan}40, 0 0 40px ${NVIS.cyanGlow}`,
  },
  cluster: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    flexShrink: 0,
  },
  lucideBtn: {
    width: 44,
    height: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: 12,
    color: NVIS.phosphor,
    opacity: 0.7,
    cursor: 'pointer',
    transition: 'opacity 0.15s, color 0.15s, background 0.15s',
  },
  voiceActive: {
    opacity: 1,
    color: NVIS.cyan,
    background: NVIS.cyanGlow,
  },
  // The Expanding Input Area — single line by default, grows on multiline
  textarea: {
    flex: 1,
    minWidth: 0,
    height: 44,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    color: NVIS.phosphor,
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize: 15,
    lineHeight: '44px',
    padding: '0 8px',
    resize: 'none',
    overflow: 'hidden',
  },
  sendPill: {
    width: 44,
    height: 44,
    borderRadius: '50%',
    background: 'rgba(255, 255, 255, 0.1)',
    color: NVIS.phosphor,
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    opacity: 0.4,
    transition: 'transform 0.15s, background 0.15s, opacity 0.15s',
  },
  sendPillActive: {
    opacity: 1,
    background: NVIS.phosphor,
    color: NVIS.dark,
  },
}

// Add hover effects via CSS-in-JS event handlers would be needed for full effect
// For production, consider moving to CSS module or styled-components

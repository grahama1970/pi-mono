// ModernChatInput.tsx — 2026 Floating Input with Lucide icons

import { memo, useState, useRef, useCallback } from 'react'
import { THEME } from '../../theme/industrial-minimal'
import { Terminal, Paperclip, ArrowRight } from 'lucide-react'

interface ModernChatInputProps {
  onSend: (message: string) => void
  onSkillTrigger: () => void
  disabled?: boolean
  placeholder?: string
}

export const ModernChatInput = memo(function ModernChatInput({
  onSend,
  onSkillTrigger,
  disabled = false,
  placeholder = 'Ask Sparta Explorer...',
}: ModernChatInputProps) {
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = useCallback(() => {
    if (!value.trim() || disabled) return
    onSend(value.trim())
    setValue('')
  }, [value, disabled, onSend])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === '/' && value === '') {
      e.preventDefault()
      onSkillTrigger()
    }
  }, [handleSend, value, onSkillTrigger])

  return (
    <div
      data-qid="chat:composer"
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        gap: THEME.space.sm,
        background: THEME.bgGlass,
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: `1px solid ${focused ? THEME.borderFocus : THEME.border}`,
        borderRadius: THEME.radius.md,
        padding: THEME.space.md,
        transition: `border-color ${THEME.motion.normal}, box-shadow ${THEME.motion.normal}`,
        boxShadow: focused ? THEME.shadow.md : 'none',
      }}
    >
      {/* Skill Trigger */}
      <IconButton
        icon={<Terminal size={20} strokeWidth={1.25} />}
        onClick={onSkillTrigger}
        label="Skills (press /)"
        qid="chat:skills"
      />

      {/* Input */}
      <textarea
        ref={inputRef}
        data-qid="chat:input"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        title="Type a message or press / for skills"
        style={{
          flex: 1,
          background: 'transparent',
          border: 'none',
          outline: 'none',
          color: THEME.text,
          fontSize: THEME.font.size.base,
          fontFamily: THEME.font.sans,
          lineHeight: 1.5,
          resize: 'none',
          padding: `${THEME.space.xs}px 0`,
          minHeight: 24,
          maxHeight: 120,
        }}
      />

      {/* Utilities */}
      <div style={{ display: 'flex', gap: THEME.space.xs }}>
        <IconButton
          icon={<Paperclip size={20} strokeWidth={1.25} />}
          onClick={() => {}}
          label="Attach file"
          qid="chat:attach"
        />
        <SendButton
          onClick={handleSend}
          disabled={!value.trim() || disabled}
        />
      </div>
    </div>
  )
})

function IconButton({ icon, onClick, label, qid }: {
  icon: React.ReactNode
  onClick: () => void
  label: string
  qid: string
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      data-qid={qid}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      aria-label={label}
      title={label}
      style={{
        background: 'none',
        border: 'none',
        color: hovered ? THEME.accent : `${THEME.text}BF`,
        cursor: 'pointer',
        padding: THEME.space.xs,
        minWidth: THEME.touch.min,
        minHeight: THEME.touch.min,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: THEME.radius.sm,
        transition: `color ${THEME.motion.fast}`,
      }}
    >
      {icon}
    </button>
  )
}

function SendButton({ onClick, disabled }: {
  onClick: () => void
  disabled: boolean
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      data-qid="chat:send"
      data-qs-action="CHAT_SEND"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      disabled={disabled}
      aria-label="Send message"
      title="Send (Enter)"
      style={{
        background: disabled ? THEME.textDim : THEME.text,
        color: THEME.bg,
        border: 'none',
        borderRadius: THEME.radius.sm,
        padding: THEME.space.sm,
        minWidth: THEME.touch.min,
        minHeight: THEME.touch.min,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transform: hovered && !disabled ? 'scale(1.05)' : 'scale(1)',
        transition: `transform ${THEME.motion.fast}, opacity ${THEME.motion.fast}`,
      }}
    >
      <ArrowRight size={20} strokeWidth={1.25} />
    </button>
  )
}

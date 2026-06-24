/**
 * Gemini-style ephemeral status line while the assistant is working.
 * Icon + shimmering verb phrase — not a disclosure control.
 *
 * variant:
 *   - 'thinking'      → Sparkles (generic reasoning / lookup)
 *   - 'evidence-case' → SPARTA shield (compliance path, /create-evidence-case)
 * Both icons get a subtle, reduced-motion-safe pulse while live.
 */
import { Sparkles } from 'lucide-react'
import { SpartaShieldIcon } from './SpartaShieldIcon'

export type ChatLiveStatusVariant = 'thinking' | 'evidence-case'

export interface ChatLiveStatusProps {
  label: string
  messageId?: string
  variant?: ChatLiveStatusVariant
}

export function ChatLiveStatus({ label, messageId = 'live', variant = 'thinking' }: ChatLiveStatusProps) {
  const isEvidenceCase = variant === 'evidence-case'
  return (
    <div
      className="chat-live-status"
      data-qid="chat:live-status"
      data-variant={variant}
      data-message-id={messageId}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {isEvidenceCase ? (
        <SpartaShieldIcon size={16} className="chat-live-status__icon chat-live-status__icon--pulse" />
      ) : (
        <Sparkles size={16} strokeWidth={1.5} className="chat-live-status__icon chat-live-status__icon--pulse" aria-hidden />
      )}
      <span className="chat-live-status__label chat-live-status__shimmer">{label}</span>
    </div>
  )
}

/**
 * Gemini-style ghost action row — feedback, copy, optional workspace / regenerate.
 */
import { useCallback, useState } from 'react'
import { Copy, MoreHorizontal, RotateCw, ThumbsDown, ThumbsUp } from 'lucide-react'

export interface MessageActionRowProps {
  messageId: string
  copyText?: string
  feedback?: 'up' | 'down'
  onFeedback?: (feedback: 'up' | 'down') => void
  onRegenerate?: () => void
  onOpenWorkspace?: () => void
}

export function MessageActionRow({
  messageId,
  copyText,
  feedback,
  onFeedback,
  onRegenerate,
  onOpenWorkspace,
}: MessageActionRowProps) {
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const handleCopy = useCallback(async () => {
    if (!copyText?.trim()) return
    try {
      await navigator.clipboard.writeText(copyText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }, [copyText])

  const showRow = Boolean(onFeedback || copyText?.trim() || onRegenerate || onOpenWorkspace)
  if (!showRow) return null

  return (
    <div className="chat-turn-actions" data-qid={`chat:turn-actions:${messageId}`} role="group" aria-label="Message actions">
      {onFeedback ? (
        <>
          <button
            type="button"
            className={`chat-turn-actions__btn${feedback === 'up' ? ' chat-turn-actions__btn--active' : ''}`}
            data-qid={`chat:feedback-up:${messageId}`}
            data-qs-action="FEEDBACK_HELPFUL"
            title="Helpful response"
            aria-pressed={feedback === 'up'}
            onClick={() => onFeedback('up')}
          >
            <ThumbsUp size={16} aria-hidden />
          </button>
          <button
            type="button"
            className={`chat-turn-actions__btn${feedback === 'down' ? ' chat-turn-actions__btn--active' : ''}`}
            data-qid={`chat:feedback-down:${messageId}`}
            data-qs-action="FEEDBACK_NOT_HELPFUL"
            title="Not helpful"
            aria-pressed={feedback === 'down'}
            onClick={() => onFeedback('down')}
          >
            <ThumbsDown size={16} aria-hidden />
          </button>
        </>
      ) : null}

      {onRegenerate ? (
        <button
          type="button"
          className="chat-turn-actions__btn"
          data-qid={`chat:regenerate:${messageId}`}
          data-qs-action="REGENERATE_RESPONSE"
          title="Regenerate response"
          onClick={onRegenerate}
        >
          <RotateCw size={16} aria-hidden />
        </button>
      ) : null}

      {copyText?.trim() ? (
        <button
          type="button"
          className={`chat-turn-actions__btn${copied ? ' chat-turn-actions__btn--active' : ''}`}
          data-qid={`chat:copy:${messageId}`}
          data-qs-action="COPY_RESPONSE"
          title={copied ? 'Copied' : 'Copy response'}
          onClick={() => void handleCopy()}
        >
          <Copy size={16} aria-hidden />
        </button>
      ) : null}

      {onOpenWorkspace ? (
        <div className="chat-turn-actions__more">
          <button
            type="button"
            className="chat-turn-actions__btn"
            data-qid={`chat:more:${messageId}`}
            data-qs-action="MESSAGE_MORE"
            title="More actions"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(v => !v)}
          >
            <MoreHorizontal size={16} aria-hidden />
          </button>
          {menuOpen ? (
            <div className="chat-turn-actions__menu" role="menu">
              <button
                type="button"
                role="menuitem"
                className="chat-turn-actions__menu-item"
                data-qid={`chat:open-workspace:${messageId}`}
                onClick={() => {
                  setMenuOpen(false)
                  onOpenWorkspace()
                }}
              >
                Open evidence workspace
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

/**
 * Gemini-style context strip above the composer — shows what page/object chat is grounded on.
 */
import { FileText, X } from 'lucide-react'

export interface ChatContextShareProps {
  label: string
  summary?: string
  trustBadge?: string
  trustBadges?: string[]
  groundingNotice?: string
  viewLabel?: string
  onViewContext?: () => void
  onDismiss?: () => void
}

export function ChatContextShare({ label, summary, trustBadge, trustBadges, groundingNotice, viewLabel = 'View context', onViewContext, onDismiss }: ChatContextShareProps) {
  if (!label.trim()) return null

  return (
    <div className="chat-context-share" data-qid="chat:context-share" title={label}>
      <FileText size={14} className="chat-context-share__icon" aria-hidden />
      <div className="chat-context-share__body">
        <span className="chat-context-share__label">{label}</span>
        {trustBadges?.length ? (
          <span className="chat-context-share__badges" aria-label={trustBadges.join(', ')}>
            {trustBadges.map(badge => <span key={badge} className="chat-context-share__badge">{badge}</span>)}
          </span>
        ) : null}
        {trustBadge ? <span className="chat-context-share__notice">{trustBadge}</span> : null}
        {summary ? <span className="chat-context-share__summary">{summary}</span> : null}
        {groundingNotice ? <span className="chat-context-share__notice">{groundingNotice}</span> : null}
      </div>
      {onViewContext ? (
        <button
          type="button"
          className="chat-context-share__view"
          data-qid="chat:context-share:view"
          data-qs-action="VIEW_SHARED_CONTEXT"
          title={viewLabel}
          onClick={onViewContext}
        >
          {viewLabel}
        </button>
      ) : null}
      {onDismiss ? (
        <button
          type="button"
          className="chat-context-share__dismiss"
          data-qid="chat:context-share:dismiss"
          data-qs-action="DISMISS_CONTEXT_SHARE"
          title="Hide context card"
          aria-label="Hide context card"
          onClick={onDismiss}
        >
          <X size={14} aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

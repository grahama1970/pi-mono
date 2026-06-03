import { useState } from 'react'
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react'
import type { SkillReceiptSummary } from './parseStructuredArtifacts'

export function TransportSkillReceiptBlock({
  receipt,
  messageId,
}: {
  receipt: SkillReceiptSummary
  messageId: string
}) {
  const [expanded, setExpanded] = useState(false)
  const panelId = `transport-skill-${messageId}`

  return (
    <section
      className="tr-reasoning-panel tr-skill-panel"
      data-qid={`transport:skill-receipt:${messageId}`}
      aria-labelledby={`${panelId}-label`}
    >
      <div className="tr-reasoning-panel__header">
        <div className="tr-reasoning-panel__title-row">
          <span className="tr-reasoning-panel__icon tr-skill-panel__icon" aria-hidden>
            <Sparkles size={14} strokeWidth={2} />
          </span>
          <span id={`${panelId}-label`} className="tr-reasoning-panel__label">
            Skill call
          </span>
          <span className="tr-reasoning-panel__meta">
            /{receipt.skill} · {receipt.status}
          </span>
        </div>
        {receipt.excerpt ? (
          <button
            type="button"
            className="tr-reasoning-panel__toggle"
            aria-expanded={expanded}
            aria-controls={`${panelId}-body`}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
            {expanded ? 'Collapse' : 'Show receipt'}
          </button>
        ) : null}
      </div>
      {!expanded && receipt.excerpt ? (
        <p className="tr-reasoning-panel__preview">{receipt.excerpt.slice(0, 140)}…</p>
      ) : null}
      {expanded && receipt.excerpt ? (
        <div id={`${panelId}-body`} className="tr-reasoning-panel__body">
          <p className="tr-reasoning-step__text">{receipt.excerpt}</p>
        </div>
      ) : null}
    </section>
  )
}

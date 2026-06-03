import { useMemo, useState } from 'react'
import { Brain, ChevronDown, ChevronRight } from 'lucide-react'
import { parseReasoningSteps, reasoningPreview } from './reasoningFormat'

export function TransportReasoningBlock({
  excerpt,
  live = false,
  messageId,
}: {
  excerpt: string
  live?: boolean
  messageId: string
}) {
  const [expanded, setExpanded] = useState(false)
  const steps = useMemo(() => parseReasoningSteps(excerpt), [excerpt])
  const preview = useMemo(() => reasoningPreview(steps), [steps])

  if (steps.length === 0) return null

  const panelId = `transport-reasoning-${messageId}`

  return (
    <section
      className={`tr-reasoning-panel${live ? ' tr-reasoning-panel--live' : ''}`}
      data-qid={`transport:reasoning:${messageId}`}
      aria-labelledby={`${panelId}-label`}
    >
      <div className="tr-reasoning-panel__header">
        <div className="tr-reasoning-panel__title-row">
          <span className="tr-reasoning-panel__icon" aria-hidden>
            <Brain size={14} strokeWidth={2} />
          </span>
          <span id={`${panelId}-label`} className="tr-reasoning-panel__label">
            Model reasoning
          </span>
          {live ? (
            <span className="tr-reasoning-panel__live-pill" title="Reasoning stream in progress">
              <span className="tr-reasoning-panel__live-dot" aria-hidden />
              Live
            </span>
          ) : null}
          <span className="tr-reasoning-panel__meta">
            {steps.length} step{steps.length === 1 ? '' : 's'}
          </span>
        </div>
        <button
          type="button"
          className="tr-reasoning-panel__toggle"
          aria-expanded={expanded}
          aria-controls={`${panelId}-body`}
          title={expanded ? 'Collapse model reasoning' : 'Expand model reasoning'}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          {expanded ? 'Collapse' : 'Show trace'}
        </button>
      </div>

      {!expanded && preview ? (
        <p className="tr-reasoning-panel__preview">{preview}</p>
      ) : null}

      {expanded ? (
        <div id={`${panelId}-body`} className="tr-reasoning-panel__body">
          <p className="tr-reasoning-panel__hint">
            Internal worker trace from OpenCode transport — not the published answer.
          </p>
          <ol className="tr-reasoning-panel__steps">
            {steps.map((step, index) => (
              <li key={`${index}-${step.slice(0, 24)}`} className="tr-reasoning-step">
                <span className="tr-reasoning-step__index" aria-hidden>
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="tr-reasoning-step__text">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  )
}

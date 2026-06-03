import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react'
import type { ToolCallEntry } from './toolTraceByCall'

function statusTone(status: string): 'ok' | 'warn' | 'neutral' {
  const s = status.toLowerCase()
  if (s === 'completed') return 'ok'
  if (s === 'error' || s === 'failed') return 'warn'
  return 'neutral'
}

export function TransportToolTraceBlock({
  entries,
  live = false,
  messageId,
}: {
  entries: ToolCallEntry[]
  live?: boolean
  messageId: string
}) {
  const [expanded, setExpanded] = useState(false)
  const preview = useMemo(() => {
    const head = entries.slice(0, 2).map((e) => `${e.tool} (${e.status})`)
    const tail = entries.length > 2 ? ` · +${entries.length - 2} more` : ''
    return `${head.join(' · ')}${tail}`
  }, [entries])

  if (!entries.length) return null
  const panelId = `transport-tools-${messageId}`

  return (
    <section
      className={`tr-reasoning-panel tr-tool-panel${live ? ' tr-reasoning-panel--live' : ''}`}
      data-qid={`transport:tools:${messageId}`}
      aria-labelledby={`${panelId}-label`}
    >
      <div className="tr-reasoning-panel__header">
        <div className="tr-reasoning-panel__title-row">
          <span className="tr-reasoning-panel__icon tr-tool-panel__icon" aria-hidden>
            <Wrench size={14} strokeWidth={2} />
          </span>
          <span id={`${panelId}-label`} className="tr-reasoning-panel__label">
            Tool trace
          </span>
          {live ? (
            <span className="tr-reasoning-panel__live-pill" title="Tool calls in progress">
              <span className="tr-reasoning-panel__live-dot" aria-hidden />
              Live
            </span>
          ) : null}
          <span className="tr-reasoning-panel__meta">
            {entries.length} call{entries.length === 1 ? '' : 's'}
          </span>
        </div>
        <button
          type="button"
          className="tr-reasoning-panel__toggle"
          aria-expanded={expanded}
          aria-controls={`${panelId}-body`}
          title={expanded ? 'Collapse tool trace' : 'Expand tool trace'}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          {expanded ? 'Collapse' : 'Show trace'}
        </button>
      </div>

      {!expanded && preview ? <p className="tr-reasoning-panel__preview">{preview}</p> : null}

      {expanded ? (
        <div id={`${panelId}-body`} className="tr-reasoning-panel__body">
          <p className="tr-reasoning-panel__hint">
            Tools invoked in the worker session — outputs are excerpts, not the published answer.
          </p>
          <ol className="tr-reasoning-panel__steps">
            {entries.map((entry) => (
              <li key={entry.key} className="tr-reasoning-step">
                <span
                  className={`tr-reasoning-step__index tr-tool-panel__status tr-tool-panel__status--${statusTone(entry.status)}`}
                  aria-hidden
                >
                  {entry.status.slice(0, 4).toUpperCase()}
                </span>
                <span className="tr-reasoning-step__text">
                  <strong className="tr-tool-panel__tool">{entry.tool}</strong>
                  {entry.outputExcerpt ? (
                    <span className="tr-tool-panel__output">{entry.outputExcerpt}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  )
}

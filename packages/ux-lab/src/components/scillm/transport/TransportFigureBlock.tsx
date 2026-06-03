import { useState } from 'react'
import { ChevronDown, ChevronRight, ImageIcon } from 'lucide-react'
import type { FigureAttachment } from './parseStructuredArtifacts'
import { figureSupportsInlinePreview } from './figurePreviewUrl'

export function TransportFigureBlock({
  figures,
  messageId,
  transportRunId: _transportRunId,
}: {
  figures: FigureAttachment[]
  messageId: string
  transportRunId?: string
}) {
  const [expanded, setExpanded] = useState(figures.length === 1)
  if (!figures.length) return null
  const panelId = `transport-figures-${messageId}`

  return (
    <section
      className="tr-reasoning-panel tr-figure-panel"
      data-qid={`transport:figures:${messageId}`}
      aria-labelledby={`${panelId}-label`}
    >
      <div className="tr-reasoning-panel__header">
        <div className="tr-reasoning-panel__title-row">
          <span className="tr-reasoning-panel__icon tr-figure-panel__icon" aria-hidden>
            <ImageIcon size={14} strokeWidth={2} />
          </span>
          <span id={`${panelId}-label`} className="tr-reasoning-panel__label">
            Figure output
          </span>
          <span className="tr-reasoning-panel__meta">
            {figures.length} file{figures.length === 1 ? '' : 's'}
          </span>
        </div>
        <button
          type="button"
          className="tr-reasoning-panel__toggle"
          aria-expanded={expanded}
          aria-controls={`${panelId}-body`}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          {expanded ? 'Collapse' : 'Show files'}
        </button>
      </div>

      {expanded ? (
        <div id={`${panelId}-body`} className="tr-reasoning-panel__body">
          <ul className="tr-figure-panel__list">
            {figures.map((fig) => {
              const preview =
                fig.previewUrl && figureSupportsInlinePreview(fig.format) ? fig.previewUrl : undefined
              return (
                <li key={`${fig.path}:${fig.previewUrl ?? fig.label}`} className="tr-figure-panel__item">
                  {preview ? (
                    <a
                      className="tr-figure-panel__preview-link"
                      href={preview}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <img
                        className="tr-figure-panel__preview-img"
                        src={preview}
                        alt={fig.label}
                        loading="lazy"
                      />
                    </a>
                  ) : null}
                  <code className="tr-figure-panel__path">{fig.label}</code>
                  <span className="tr-figure-panel__format">{fig.format}</span>
                  <span className="tr-figure-panel__hint" title={fig.path}>
                    {fig.path}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      ) : (
        <p className="tr-reasoning-panel__preview">{figures.map((f) => f.label).join(' · ')}</p>
      )}
    </section>
  )
}

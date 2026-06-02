import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import type { DisplayMetadata } from './messageParse'

function urlSlug(url: string): string {
  return url.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 48)
}

export function MetadataPills({ metadata, workerUrl }: { metadata: DisplayMetadata; workerUrl?: string }) {
  const [expandedSession, setExpandedSession] = useState<string | null>(null)

  useRegisterAction('transport:pill:session', {
    app: 'ux-lab',
    action: 'TRANSPORT_PILL_TOGGLE_SESSION',
    label: 'Toggle session pill',
    description: 'Expand or collapse worker session id on metadata pill',
  })

  useRegisterAction('transport:pill:worker-trace', {
    app: 'ux-lab',
    action: 'TRANSPORT_ROOM_OPEN_WORKER',
    label: 'Open worker trace',
    description: 'Open OpenCode worker trace from metadata pill',
  })

  useRegisterAction('transport:pill:trace-url', {
    app: 'ux-lab',
    action: 'TRANSPORT_PILL_OPEN_TRACE_URL',
    label: 'Open trace URL',
    description: 'Open auxiliary trace URL from metadata pill',
  })

  if (!metadata.sessions.length && !metadata.urls.length && !metadata.verdict && !metadata.model) {
    return null
  }

  return (
    <div className="tr-meta-pills" data-qid="transport:message:meta-pills">
      {metadata.verdict && (
        <span className={`tr-pill tr-pill--verdict transport-pill--${metadata.verdict.toLowerCase()}`}>
          Verdict: {metadata.verdict}
        </span>
      )}
      {metadata.model && (
        <span className="tr-pill tr-pill--model">{metadata.model}</span>
      )}
      {metadata.sessions.map((ses) => (
        <button
          key={ses}
          type="button"
          className="tr-pill tr-pill--session"
          data-qid={`transport:pill:session:${ses}`}
          data-qs-action="TRANSPORT_PILL_TOGGLE_SESSION"
          title={expandedSession === ses ? `Collapse session ${ses}` : `Expand session ${ses}`}
          onClick={() => setExpandedSession((c) => (c === ses ? null : ses))}
        >
          Worker session: {expandedSession === ses ? ses : `${ses.slice(0, 12)}…`}
        </button>
      ))}
      {workerUrl && (
        <a
          href={workerUrl}
          target="_blank"
          rel="noreferrer"
          className="tr-pill tr-pill--trace"
          data-qid="transport:pill:worker-trace"
          data-qs-action="TRANSPORT_ROOM_OPEN_WORKER"
          title="Open worker trace in a new tab"
        >
          <ExternalLink size={12} aria-hidden />
          View trace
        </a>
      )}
      {metadata.urls.filter((u) => u !== workerUrl).map((url) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noreferrer"
          className="tr-pill tr-pill--trace"
          data-qid={`transport:pill:trace-url:${urlSlug(url)}`}
          data-qs-action="TRANSPORT_PILL_OPEN_TRACE_URL"
          title={`Open trace URL ${url}`}
        >
          <ExternalLink size={12} aria-hidden />
          Trace
        </a>
      ))}
    </div>
  )
}

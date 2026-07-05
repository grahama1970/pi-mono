/**
 * Gemini-style compact sources chip — favicon stack + label + expand affordance.
 */
import { ExternalLink } from 'lucide-react'
import type { ChatSourceChip } from './messageTurnChrome'

export interface MessageSourcesPillProps {
  messageId: string
  sources: ChatSourceChip[]
  onOpen?: () => void
}

function SourceFavicon({ chip, index }: { chip: ChatSourceChip; index: number }) {
  const initial = (chip.domain.replace(/^www\./, '')[0] ?? '?').toUpperCase()
  return (
    <span
      className="chat-sources-pill__favicon"
      style={{
        marginLeft: index === 0 ? 0 : -6,
        zIndex: 3 - index,
        background: `hsl(${chip.hue} 42% 32%)`,
      }}
      title={chip.label}
      aria-hidden
    >
      {initial}
    </span>
  )
}

export function MessageSourcesPill({ messageId, sources, onOpen }: MessageSourcesPillProps) {
  if (sources.length === 0) return null

  const label = sources.length === 1 ? 'Source' : 'Sources'
  const title = sources.map(s => s.label).join(' · ')

  return (
    <button
      type="button"
      className="chat-sources-pill"
      data-qid={`chat:sources-pill:${messageId}`}
      data-qs-action="OPEN_SOURCES"
      title={title}
      onClick={onOpen}
      disabled={!onOpen}
    >
      <span className="chat-sources-pill__stack" aria-hidden>
        {sources.slice(0, 3).map((chip, index) => (
          <SourceFavicon key={chip.id} chip={chip} index={index} />
        ))}
      </span>
      <span className="chat-sources-pill__label">{label}</span>
      {onOpen ? <ExternalLink size={14} className="chat-sources-pill__expand" aria-hidden /> : null}
    </button>
  )
}

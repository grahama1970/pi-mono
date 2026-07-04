import { EmbryVoiceOrb, type EmbryVoiceStatus } from './EmbryVoiceOrb'
import { buildIdentityNodeViewModel } from './identityNodeState'

export interface IdentityNodeProps {
  voiceStatus?: EmbryVoiceStatus
  isStreaming?: boolean
  tone?: string
  speaker?: string
  height?: number
}

/**
 * Embry identity anchor — the mark fills the rail, centered; status is a quiet caption.
 */
export function IdentityNode({
  voiceStatus,
  isStreaming,
  tone,
  height = 260,
}: IdentityNodeProps): JSX.Element {
  const view = buildIdentityNodeViewModel({ voiceStatus, isStreaming, tone })

  return (
    <section
      data-qid="embry-voice:identity-node"
      data-embry-state={view.visualState}
      data-embry-signal={view.signal}
      data-embry-tone={tone ?? ''}
      className="embry-identity-node shrink-0 border-b border-[#27272a] bg-[#0c0c0e]"
      style={{ height, minHeight: height, maxHeight: height }}
    >
      <div className="embry-identity-node__engine flex h-[220px] w-full items-center justify-center bg-transparent">
        <EmbryVoiceOrb
          voiceStatus={voiceStatus}
          isStreaming={isStreaming}
          tone={tone}
          signal={view.signal}
          size={220}
          surface="rail"
          fillCanvas
          letterAsParticles
        />
      </div>

      <div className="embry-identity-node__status flex h-10 items-center justify-center gap-2 px-3">
        <span
          aria-hidden
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${view.pulse ? 'animate-pulse' : ''}`}
          style={{
            backgroundColor: view.accentColor,
            boxShadow: `0 0 8px ${view.accentColor}99`,
          }}
        />
        <span
          className="status-text truncate font-mono-os text-[10px] font-bold uppercase tracking-[0.1em]"
          style={{ color: view.accentColor }}
          aria-live="polite"
          aria-atomic="true"
        >
          {view.statusLabel}
        </span>
      </div>
    </section>
  )
}

export default IdentityNode

import { Copy } from 'lucide-react'
import { EmbryVoiceOrb, type EmbryVoiceStatus } from './EmbryVoiceOrb'
import { buildIdentityNodeViewModel } from './identityNodeState'

export interface IdentityNodeProps {
  voiceStatus?: EmbryVoiceStatus
  isStreaming?: boolean
  tone?: string
  speaker?: string
  height?: number
}

function readIdentityPanelPacket(): string {
  const panel = document.querySelector<HTMLElement>('[data-qid="embry-voice:identity-node"]')
  const orb = panel?.querySelector<HTMLElement>('[data-qid="embry-voice:presence-orb"]')
  const canvases = Array.from(panel?.querySelectorAll<HTMLCanvasElement>('canvas') ?? []).map((canvas, index) => {
    try {
      return `canvas-${index + 1}: ${canvas.toDataURL('image/png')}`
    } catch {
      return `canvas-${index + 1}: unavailable`
    }
  })
  const svgs = Array.from(panel?.querySelectorAll<SVGSVGElement>('svg') ?? []).map((svg, index) => (
    `svg-${index + 1}:\n${svg.outerHTML}`
  ))

  return [
    '# Embry Logo Panel',
    '',
    '## Visible Text',
    panel?.innerText.trim() || '(no visible text)',
    '',
    '## Panel DOM',
    '```html',
    panel?.outerHTML ?? '(identity node not found)',
    '```',
    '',
    '## Orb DOM',
    '```html',
    orb?.outerHTML ?? '(presence orb not found)',
    '```',
    '',
    '## Image Capture',
    [...canvases, ...svgs].join('\n\n') || '(no canvas or SVG image data found)',
  ].join('\n')
}

async function copyIdentityPanel(): Promise<void> {
  const text = readIdentityPanelPacket()
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.left = '-9999px'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
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
      className="embry-identity-node relative shrink-0 border-b border-[#27272a] bg-[#0c0c0e]"
      style={{ height, minHeight: height, maxHeight: height }}
    >
      <button
        type="button"
        data-qid="embry-voice:copy-content"
        aria-label="Copy Embry logo panel"
        title="Copy Embry logo panel"
        onClick={() => void copyIdentityPanel()}
        className="absolute right-3 top-3 z-10 grid h-8 w-8 place-items-center border border-[#27272a] bg-[#121214] text-[#60a5fa] transition hover:border-[#60a5fa] hover:bg-[#18181b] focus:outline-none focus:ring-2 focus:ring-[#60a5fa]/70"
      >
        <Copy className="h-4 w-4" aria-hidden />
      </button>

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

      <div className="embry-identity-node__status flex h-10 items-center justify-center px-3">
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

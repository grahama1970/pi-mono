import type { ReactNode, CSSProperties } from 'react'
import { EMBRY } from '../../sparta/common/EmbryStyle'

export type PillVariant = 'green' | 'amber' | 'red' | 'blue' | 'purple' | 'neutral'

const VARIANT_COLORS: Record<PillVariant, string> = {
  green: EMBRY.green,
  amber: EMBRY.amber,
  red: EMBRY.red,
  blue: EMBRY.blue,
  purple: EMBRY.accent,
  neutral: EMBRY.dim,
}

export interface StatusPillProps {
  variant: PillVariant
  flash?: boolean
  children: ReactNode
}

const flashKeyframes = `
@keyframes pill-flash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}
`

let styleInjected = false
function injectFlashStyle() {
  if (styleInjected || typeof document === 'undefined') return
  styleInjected = true
  const el = document.createElement('style')
  el.textContent = flashKeyframes
  document.head.appendChild(el)
}

export function StatusPill({ variant, flash = false, children }: StatusPillProps) {
  if (flash) injectFlashStyle()

  const color = VARIANT_COLORS[variant]

  const style: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    padding: '2px 8px',
    borderRadius: 20,
    lineHeight: 1.6,
    color,
    backgroundColor: `${color}18`,
    border: `1px solid ${color}33`,
    whiteSpace: 'nowrap',
    flexShrink: 0,
    animation: flash ? 'pill-flash 1.2s ease-in-out infinite' : 'none',
  }

  return <span style={style}>{children}</span>
}

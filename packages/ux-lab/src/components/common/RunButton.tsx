/**
 * RunButton — Green glowing primary action button (NVIS MIL-STD-3009).
 * Green = "go/execute/verified". Pulsing glow animation when enabled.
 */
import { EMBRY } from './EmbryStyle'

const GLOW_CSS = `
@keyframes embry-run-glow {
  0%, 100% { box-shadow: 0 0 12px rgba(0,255,136,0.25), 0 2px 8px rgba(0,0,0,0.3); }
  50% { box-shadow: 0 0 24px rgba(0,255,136,0.45), 0 2px 8px rgba(0,0,0,0.3); }
}
.embry-run-btn:not(:disabled) { animation: embry-run-glow 2s ease-in-out infinite; }
.embry-run-btn:hover:not(:disabled) { box-shadow: 0 0 32px rgba(0,255,136,0.5), 0 2px 8px rgba(0,0,0,0.3) !important; animation: none; }
`

interface RunButtonProps {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  ariaLabel?: string
  title?: string
  'data-qid'?: string
  'data-qs-action'?: string
}

export function RunButton({ children, onClick, disabled, ariaLabel, title, 'data-qid': dataQid, 'data-qs-action': dataQsAction }: RunButtonProps) {
  return (
    <>
      <style>{GLOW_CSS}</style>
      <button className="embry-run-btn" onClick={onClick} disabled={disabled}
        aria-label={ariaLabel} title={title} data-qid={dataQid} data-qs-action={dataQsAction}
        style={{
          padding: '10px 32px', borderRadius: 8, cursor: disabled ? 'default' : 'pointer',
          background: disabled ? EMBRY.muted : EMBRY.green,
          color: EMBRY.bg, fontWeight: 900, fontSize: 13,
          border: '1px solid rgba(255,255,255,0.3)',
          transition: 'all 0.2s',
          boxShadow: disabled ? 'none' : '0 0 16px rgba(0,255,136,0.3), 0 2px 8px rgba(0,0,0,0.3)',
        }}>
        {children}
      </button>
    </>
  )
}

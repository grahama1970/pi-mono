/**
 * LiveGateChain — Shows evidence case gate progression in real-time.
 *
 * Displays steps with animated states:
 *   pending  → empty circle (gray)
 *   running  → spinner (blue)
 *   done     → checkmark (green)
 *   failed   → X (red)
 *
 * Used during /create-evidence-case streaming to show progress.
 */
import { memo } from 'react'
import { EMBRY } from '../common/EmbryStyle'

export interface LiveStep {
  id: string
  type: string
  skill?: string
  status: 'pending' | 'running' | 'done' | 'failed'
  summary: string
  detail?: string
  duration?: number
  startedAt?: number
}

export interface LiveGateChainProps {
  steps: LiveStep[]
  title?: string
}

const STATUS_STYLES: Record<string, { color: string; icon: string; animate?: boolean }> = {
  pending: { color: EMBRY.muted, icon: '○' },
  running: { color: EMBRY.blue, icon: '◌', animate: true },
  done: { color: EMBRY.green, icon: '✓' },
  failed: { color: EMBRY.red, icon: '✗' },
}

const StatusIndicator = memo(function StatusIndicator({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.pending
  return (
    <div style={{
      width: 20, height: 20, borderRadius: '50%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 10, fontWeight: 700, color: style.color,
      background: `${style.color}15`, border: `1px solid ${style.color}40`,
      flexShrink: 0, zIndex: 2,
      animation: style.animate ? 'pulse 1s infinite' : 'none',
    }}>
      {style.icon}
    </div>
  )
})

export const LiveGateChain = memo(function LiveGateChain({ steps, title = 'Evidence Case' }: LiveGateChainProps) {
  const done = steps.filter(s => s.status === 'done').length
  const failed = steps.filter(s => s.status === 'failed').length
  const running = steps.find(s => s.status === 'running')

  return (
    <div style={{
      margin: '6px 0', padding: '10px 12px',
      background: EMBRY.bgCard, border: `1px solid ${EMBRY.accent}33`,
      borderRadius: 8, overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{
          width: 8, height: 8, borderRadius: '50%',
          background: EMBRY.accent,
          boxShadow: `0 0 6px ${EMBRY.accent}`,
          animation: 'pulse 1s infinite',
        }} />
        <span style={{ fontSize: 11, fontWeight: 700, color: EMBRY.white }}>{title}</span>
        <span style={{ fontSize: 9, color: EMBRY.dim, fontFamily: 'monospace', marginLeft: 'auto' }}>
          {done}/{steps.length} gates
        </span>
      </div>

      {/* Compact horizontal progress bar */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 10, height: 4, borderRadius: 2, overflow: 'hidden' }}>
        {steps.map((step, i) => {
          const style = STATUS_STYLES[step.status] ?? STATUS_STYLES.pending
          return (
            <div
              key={step.id}
              style={{
                flex: 1,
                background: step.status === 'pending' ? `${EMBRY.muted}40` : style.color,
                transition: 'background 0.3s',
              }}
            />
          )
        })}
      </div>

      {/* Vertical step list */}
      <div style={{ position: 'relative' }}>
        {/* Vertical line */}
        <div style={{
          position: 'absolute', left: 9, top: 10, bottom: 10, width: 1,
          borderLeft: `1px dashed ${EMBRY.accent}40`, zIndex: 0,
        }} />

        {steps.map((step, i) => (
          <div key={step.id} style={{
            display: 'flex', gap: 10, position: 'relative',
            marginBottom: i < steps.length - 1 ? 6 : 0,
            opacity: step.status === 'pending' ? 0.5 : 1,
            transition: 'opacity 0.3s',
          }}>
            <StatusIndicator status={step.status} />
            <div style={{ flex: 1, minWidth: 0, paddingTop: 2 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  fontSize: 10, fontFamily: 'monospace', fontWeight: 600,
                  color: step.status === 'running' ? EMBRY.blue : step.status === 'done' ? EMBRY.green : step.status === 'failed' ? EMBRY.red : EMBRY.dim,
                  textTransform: 'uppercase',
                }}>
                  {step.type.replace(/^step_\d+_/, '')}
                </span>
                {step.duration && step.status !== 'running' && (
                  <span style={{ fontSize: 9, fontFamily: 'monospace', color: EMBRY.muted, marginLeft: 'auto' }}>
                    {step.duration < 1000 ? `${step.duration}ms` : `${(step.duration / 1000).toFixed(1)}s`}
                  </span>
                )}
                {step.status === 'running' && (
                  <span style={{ fontSize: 9, color: EMBRY.blue, marginLeft: 'auto', animation: 'pulse 1s infinite' }}>
                    running...
                  </span>
                )}
              </div>
              {step.summary && step.status !== 'pending' && (
                <div style={{ fontSize: 10, color: EMBRY.dim, marginTop: 2, lineHeight: 1.4 }}>
                  {step.summary.slice(0, 120)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* CSS for pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  )
})

export default LiveGateChain

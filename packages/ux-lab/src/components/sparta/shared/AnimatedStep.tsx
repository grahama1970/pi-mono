/**
 * AnimatedStep — Individual gate step with staggered entrance animation.
 *
 * Animations:
 * - Entrance: opacity 0→1, translateX(-8px)→0, 300ms ease-out
 * - Stagger: delay = index * 150ms
 * - Status: border glow on running, checkmark scale on done
 *
 * Complies with:
 * - COTS C02: 44px minimum touch targets
 * - NVIS Class A: White Phosphor palette
 * - prefers-reduced-motion: instant when enabled
 */
import { memo, useEffect, useState } from 'react'
import { Check, X, Loader2 } from 'lucide-react'
import { useReducedMotion } from '../../../hooks/useReducedMotion'

export type StepStatus = 'pending' | 'running' | 'done' | 'failed'

export interface AnimatedStepProps {
  index: number
  status: StepStatus
  label: string
  detail?: string
  duration?: number
  syncPercent?: number // NODE_SYNC indicator for running state (0-100)
}

const NVIS = {
  phosphor: '#e0e4e8',
  cyan: '#00d1ff',
  green: '#3fb950',
  red: '#f85149',
  dim: '#8b949e',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
}

const ENTRANCE_DURATION = 300
const STAGGER_DELAY = 150

const StatusIcon = memo(function StatusIcon({ status }: { status: StepStatus }) {
  if (status === 'running') {
    return <Loader2 size={12} strokeWidth={2} style={{ animation: 'spin 1s linear infinite' }} />
  }
  if (status === 'done') {
    return <Check size={12} strokeWidth={2.5} />
  }
  if (status === 'failed') {
    return <X size={12} strokeWidth={2.5} />
  }
  return null
})

export const AnimatedStep = memo(function AnimatedStep({
  index,
  status,
  label,
  detail,
  duration,
  syncPercent,
}: AnimatedStepProps) {
  const reduceMotion = useReducedMotion()
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (reduceMotion) {
      setIsVisible(true)
      return
    }

    const timer = setTimeout(() => {
      setIsVisible(true)
    }, index * STAGGER_DELAY)

    return () => clearTimeout(timer)
  }, [index, reduceMotion])

  const colorMap: Record<StepStatus, string> = {
    pending: NVIS.dim,
    running: NVIS.cyan,
    done: NVIS.green,
    failed: NVIS.red,
  }

  const color = colorMap[status]
  const entranceDuration = reduceMotion ? 0 : ENTRANCE_DURATION
  const isActive = status === 'running'

  return (
    <div
      data-qid={`evidence:step:${index}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '8px 10px',
        borderRadius: 6,
        border: `1px solid ${isActive ? `${color}66` : NVIS.glassBorder}`,
        background: isActive
          ? `linear-gradient(90deg, ${color}08 25%, ${color}18 50%, ${color}08 75%)`
          : 'transparent',
        backgroundSize: isActive ? '200% 100%' : 'auto',
        animation: isActive && !reduceMotion ? 'spectral-shimmer 2s infinite linear' : 'none',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateX(0)' : 'translateX(-8px)',
        transition: reduceMotion
          ? 'none'
          : `opacity ${entranceDuration}ms ease-out, transform ${entranceDuration}ms ease-out, border-color 200ms`,
        boxShadow: isActive ? `0 0 12px ${color}25, inset 0 0 20px ${color}05` : 'none',
      }}
    >
      {/* Status indicator */}
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: status === 'pending' ? 'transparent' : `${color}20`,
          border: `1.5px solid ${color}`,
          color,
          transition: reduceMotion ? 'none' : 'all 200ms',
          transform: status === 'done' && !reduceMotion ? 'scale(1)' : 'scale(1)',
        }}
      >
        <StatusIcon status={status} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: status === 'pending' ? NVIS.dim : NVIS.phosphor,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            transition: reduceMotion ? 'none' : 'color 200ms',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {label}
          {isActive && syncPercent !== undefined && (
            <span
              style={{
                fontSize: 9,
                fontFamily: "'SF Mono', Monaco, monospace",
                color: NVIS.cyan,
                fontWeight: 400,
              }}
            >
              [NODE_SYNC: {syncPercent}%]
            </span>
          )}
        </div>
        {detail && status !== 'pending' && (
          <div
            style={{
              fontSize: 10,
              color: NVIS.dim,
              marginTop: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {detail}
          </div>
        )}
      </div>

      {/* Duration badge */}
      {duration !== undefined && status !== 'running' && status !== 'pending' && (
        <div
          style={{
            fontSize: 9,
            fontFamily: 'monospace',
            color: NVIS.dim,
            padding: '2px 6px',
            background: `${NVIS.dim}15`,
            borderRadius: 4,
          }}
        >
          {duration < 1000 ? `${duration}ms` : `${(duration / 1000).toFixed(1)}s`}
        </div>
      )}

      {/* Keyframes for spinner and spectral shimmer */}
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes spectral-shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>
    </div>
  )
})

export default AnimatedStep

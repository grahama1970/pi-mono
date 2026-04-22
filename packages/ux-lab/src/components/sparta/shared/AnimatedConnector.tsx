/**
 * AnimatedConnector — SVG line with drawing effect.
 *
 * Uses stroke-dasharray + stroke-dashoffset to create a "drawing" animation.
 * Includes glow effect when active via drop-shadow filter.
 *
 * Props:
 * - active: triggers the draw animation
 * - complete: fully drawn state
 * - vertical: orientation (default true)
 */
import { memo } from 'react'
import { useReducedMotion } from '../../../hooks/useReducedMotion'

export interface AnimatedConnectorProps {
  active: boolean
  complete?: boolean
  color?: string
  vertical?: boolean
  height?: number
}

const NVIS = {
  cyan: '#00d1ff',
  green: '#3fb950',
  dim: '#8b949e',
}

const DRAW_DURATION = 400

export const AnimatedConnector = memo(function AnimatedConnector({
  active,
  complete = false,
  color,
  vertical = true,
  height = 20,
}: AnimatedConnectorProps) {
  const reduceMotion = useReducedMotion()

  const strokeColor = complete ? (color ?? NVIS.green) : active ? (color ?? NVIS.cyan) : NVIS.dim
  const lineLength = vertical ? height : height

  const drawDuration = reduceMotion ? 0 : DRAW_DURATION
  const dashOffset = complete || active ? 0 : lineLength

  if (vertical) {
    return (
      <svg
        width={12}
        height={height}
        viewBox={`0 0 12 ${height}`}
        style={{
          display: 'block',
          margin: '0 auto',
          overflow: 'visible',
        }}
      >
        <line
          x1={6}
          y1={0}
          x2={6}
          y2={height}
          stroke={strokeColor}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeDasharray={lineLength}
          strokeDashoffset={dashOffset}
          style={{
            transition: reduceMotion
              ? 'none'
              : `stroke-dashoffset ${drawDuration}ms ease-out, stroke 200ms`,
            filter: active ? `drop-shadow(0 0 4px ${strokeColor})` : 'none',
          }}
        />
      </svg>
    )
  }

  return (
    <svg
      width={height}
      height={12}
      viewBox={`0 0 ${height} 12`}
      style={{
        display: 'block',
        overflow: 'visible',
      }}
    >
      <line
        x1={0}
        y1={6}
        x2={height}
        y2={6}
        stroke={strokeColor}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeDasharray={lineLength}
        strokeDashoffset={dashOffset}
        style={{
          transition: reduceMotion
            ? 'none'
            : `stroke-dashoffset ${drawDuration}ms ease-out, stroke 200ms`,
          filter: active ? `drop-shadow(0 0 4px ${strokeColor})` : 'none',
        }}
      />
    </svg>
  )
})

export default AnimatedConnector

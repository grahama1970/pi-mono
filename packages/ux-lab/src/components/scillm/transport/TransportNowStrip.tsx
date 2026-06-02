import type { RunHealth } from './runHealth'

export function TransportNowStrip({ health }: { health: RunHealth }) {
  return (
    <div
      className={`transport-now-strip transport-now-strip--${health.kind}`}
      data-qid="transport:room:now-strip"
      role="status"
      aria-live="polite"
    >
      <span className="transport-now-strip__primary">{health.label}</span>
      {health.stripSegments.length > 1 && (
        <span className="transport-now-strip__rest">
          {health.stripSegments.slice(1).join(' · ')}
        </span>
      )}
      {health.nextAction && (
        <span className="transport-now-strip__action">{health.nextAction}</span>
      )}
    </div>
  )
}

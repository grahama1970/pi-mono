import type { RunStatusKind } from './messageParse'

export function TransportCollabBanner({
  roundLabel,
  statusLabel,
  statusKind,
  collaborators,
}: {
  roundLabel: string
  statusLabel: string
  statusKind: RunStatusKind
  collaborators: string[]
}) {
  const collab = collaborators.length
    ? collaborators.map((c) => c.replace('_', ' ')).join(' + ')
    : 'Human + Project agent + Subagent'

  return (
    <div className="transport-collab-banner" data-qid="transport:collab:banner">
      <div className="transport-collab-banner__primary">
        <span className="transport-collab-banner__round">{roundLabel}</span>
        <span className="transport-collab-banner__sep">|</span>
        <span className="transport-collab-banner__mode">3-way: {collab}</span>
      </div>
      <span className={`transport-collab-banner__status transport-collab-banner__status--${statusKind}`}>
        {statusLabel}
      </span>
    </div>
  )
}

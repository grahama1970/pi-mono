import { EMBRY, card, heading, label } from '../common/EmbryStyle'

export type IntegrityStatus = 'NOMINAL' | 'DEGRADED' | 'CRITICAL'

export interface IntegrityCardProps {
  status: IntegrityStatus
  coveragePercent: number
  coverageLabel: string
  issueCount: number
}

const statusColor: Record<IntegrityStatus, string> = {
  NOMINAL: EMBRY.green,
  DEGRADED: EMBRY.amber,
  CRITICAL: EMBRY.red,
}

const statusMessage: Record<IntegrityStatus, string> = {
  NOMINAL: 'Graph integrity within tolerance',
  DEGRADED: 'Graph integrity degraded — review recommended',
  CRITICAL: 'Graph integrity critical — action required',
}

export function IntegrityCard({ status, coveragePercent, coverageLabel, issueCount }: IntegrityCardProps) {
  const color = statusColor[status]

  return (
    <div style={{
      ...card,
      padding: 0, /* override card padding — layout uses internal sections */
      overflow: 'hidden',
    }}>
      {/* Status banner */}
      <div style={{
        padding: '16px 20px',
        borderBottom: `1px solid ${EMBRY.border}`,
        backgroundColor: `${color}1F`, /* 12% opacity */
      }}>
        <div style={{
          /* 28px status heading — larger than standard heading preset */
          fontSize: 28,
          fontWeight: 900,
          letterSpacing: heading.letterSpacing,
          color,
        }}>
          {status}
        </div>
        <div style={{
          /* body-sized status subtitle */
          fontSize: 13,
          fontWeight: 600,
          color,
          opacity: 0.9,
          marginTop: 2,
        }}>
          {statusMessage[status]}
        </div>
      </div>

      {/* Metrics row */}
      <div style={{
        padding: '12px 20px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'start',
      }}>
        <div>
          <div style={{ ...label, marginBottom: 2 }}>Coverage</div>
          <div style={{ ...heading, color: EMBRY.white }}>
            {coveragePercent}% {coverageLabel}
          </div>
        </div>
        <div style={{ textAlign: 'right' as const }}>
          <div style={{ ...label, marginBottom: 2 }}>Issues</div>
          <div style={{
            /* 18px large metric number */
            fontSize: 18,
            fontWeight: 900,
            color: EMBRY.white,
          }}>
            {issueCount}
          </div>
        </div>
      </div>
    </div>
  )
}

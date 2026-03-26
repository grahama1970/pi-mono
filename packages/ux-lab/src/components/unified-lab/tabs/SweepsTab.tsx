import { EMBRY, card, label } from '../../sparta/common/EmbryStyle'
import { ParallelCoordinates } from '../components/ParallelCoordinates'
import { ReasoningToast } from '../components/ReasoningToast'
import { mockSweepData, F1_THRESHOLD } from '../data/mockSweepData'

export function SweepsTab() {
  const best = mockSweepData.find((t) => t.isBest)
  const passCount = mockSweepData.filter((t) => t.status === 'pass').length
  const failCount = mockSweepData.filter((t) => t.status === 'fail').length

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        gap: 12,
        padding: 16,
        overflow: 'hidden',
      }}
    >
      <ReasoningToast
        message={
          best
            ? `Best trial: ${best.id} (${best.model}, F1=${best.f1}). ${best.reasoning}`
            : 'No best trial found yet.'
        }
      />

      <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
        <Stat label="Trials" value={String(mockSweepData.length)} color={EMBRY.white} />
        <Stat label="Passed" value={String(passCount)} color={EMBRY.green} />
        <Stat label="Failed" value={String(failCount)} color={EMBRY.red} />
        <Stat label="F1 Gate" value={String(F1_THRESHOLD)} color={EMBRY.amber} />
        <Stat label="Best F1" value={best ? String(best.f1) : '--'} color={EMBRY.green} />
      </div>

      <div style={{ ...card, flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ ...label, marginBottom: 8 }}>
          Parallel Coordinates — Hyperparameter Sweep
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <ParallelCoordinates />
        </div>
      </div>

      <div style={{ ...card, flexShrink: 0 }}>
        <div style={{ ...label, marginBottom: 8 }}>Trial Details</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {mockSweepData.map((trial) => {
            const color =
              trial.status === 'pass'
                ? EMBRY.green
                : trial.status === 'fail'
                  ? EMBRY.red
                  : EMBRY.blue
            return (
              <div
                key={trial.id}
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'center',
                  padding: '4px 8px',
                  borderRadius: 4,
                  backgroundColor: trial.isBest ? `${EMBRY.green}0a` : 'transparent',
                  borderLeft: `3px solid ${color}`,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontFamily: 'monospace',
                    color: EMBRY.dim,
                    width: 60,
                  }}
                >
                  {trial.id}
                </span>
                <span style={{ fontSize: 11, color: EMBRY.accent, width: 120 }}>
                  {trial.model}
                </span>
                <span style={{ fontSize: 11, color: EMBRY.white, width: 50 }}>
                  F1: {trial.f1}
                </span>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color,
                  }}
                >
                  {trial.status}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    color: EMBRY.dim,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {trial.reasoning}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Stat({ label: lbl, value, color }: { label: string; value: string; color: string }) {
  return (
    <div
      style={{
        ...card,
        padding: '8px 14px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: EMBRY.dim }}>
        {lbl}
      </div>
      <div style={{ fontSize: 18, fontWeight: 900, color }}>{value}</div>
    </div>
  )
}

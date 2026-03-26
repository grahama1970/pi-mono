import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts'
import type { TooltipProps } from 'recharts'
import { EMBRY, card, heading, label } from '../sparta/common/EmbryStyle'
import type { RoundResult } from './sampleMusicData'

const THRESHOLD = 0.3

const DIMS = [
  { key: 'tempo', label: 'Tempo', color: EMBRY.blue, w: 1.5 },
  { key: 'key', label: 'Key', color: EMBRY.green, w: 1.5 },
  { key: 'chords', label: 'Chords', color: EMBRY.amber, w: 1.5 },
  { key: 'dynamics', label: 'Dynamics', color: EMBRY.accent, w: 1.5 },
  { key: 'timing', label: 'Timing', color: EMBRY.red, w: 1.5 },
  { key: 'aggregate', label: 'Aggregate', color: EMBRY.white, w: 2.5 },
]

function toData(rounds: RoundResult[]) {
  return rounds.map(r => ({
    round: r.round, tempo: r.delta.tempo_delta, key: r.delta.key_match,
    chords: r.delta.chord_accuracy, dynamics: r.delta.dynamics_rmse,
    timing: r.delta.timing_drift_ms, aggregate: r.delta.aggregate,
  }))
}

function Tip({ active, payload, label: rn }: TooltipProps<number, string>) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ backgroundColor: EMBRY.bgCard, border: `1px solid ${EMBRY.border}`, borderRadius: 8, padding: '8px 12px', fontSize: 11, fontFamily: 'monospace' }}>
      <div style={{ color: EMBRY.dim, marginBottom: 4, fontSize: 10 }}>Round {rn}</div>
      {payload.map(p => (
        <div key={p.dataKey as string} style={{ color: p.color as string, fontWeight: 700, lineHeight: 1.6 }}>
          {p.name}: {typeof p.value === 'number' ? p.value.toFixed(3) : String(p.value)}
        </div>
      ))}
    </div>
  )
}

interface Props { rounds: RoundResult[] }

export function ConvergenceChart({ rounds }: Props) {
  const data = toData(rounds)
  const conv = rounds.find(r => r.delta.aggregate <= THRESHOLD)?.round

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ ...heading, fontSize: 13 }}>Convergence</span>
        {conv != null && (
          <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
            backgroundColor: `${EMBRY.green}20`, color: EMBRY.green, border: `1px solid ${EMBRY.green}40` }}>
            converged R{conv}
          </span>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginBottom: 8 }}>
        {DIMS.map(d => (
          <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: d.key === 'aggregate' ? 16 : 10, height: d.key === 'aggregate' ? 3 : 2, backgroundColor: d.color, borderRadius: 1 }} />
            <span style={{ ...label, fontSize: 9, color: d.color }}>{d.label}</span>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 28, bottom: 4, left: -16 }}>
          <CartesianGrid stroke={`${EMBRY.muted}40`} strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="round" tickFormatter={(v: number) => `R${v}`}
            tick={{ fontSize: 9, fill: EMBRY.dim, fontFamily: 'monospace' }} tickLine={false} axisLine={{ stroke: EMBRY.border }} />
          <YAxis domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1.0]} tickFormatter={(v: number) => v.toFixed(2)}
            tick={{ fontSize: 8, fill: EMBRY.dim, fontFamily: 'monospace' }} tickLine={false} axisLine={{ stroke: EMBRY.border }} />
          <Tooltip content={<Tip />} />
          <ReferenceLine y={THRESHOLD} stroke={`${EMBRY.green}80`} strokeDasharray="6 3" strokeWidth={1.5}
            label={{ value: `≤${THRESHOLD}`, position: 'right', fill: EMBRY.green, fontSize: 9, fontFamily: 'monospace' }} />
          {DIMS.map(d => (
            <Line key={d.key} type="monotone" dataKey={d.key} name={d.label} stroke={d.color}
              strokeWidth={d.w} strokeOpacity={d.key === 'aggregate' ? 1 : 0.8}
              dot={{ r: d.key === 'aggregate' ? 4 : 3, fill: d.color, stroke: EMBRY.bgCard, strokeWidth: 1.5 }}
              activeDot={{ r: d.key === 'aggregate' ? 6 : 5 }} isAnimationActive={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

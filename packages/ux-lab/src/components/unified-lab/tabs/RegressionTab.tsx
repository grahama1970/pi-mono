import { useState } from 'react'
import { EMBRY, card, label, heading } from '../../sparta/common/EmbryStyle'
import { StatusPill } from '../components/StatusPill'
import type { PillVariant } from '../components/StatusPill'

// ── Types ──────────────────────────────────────────────────────────────────────

interface RegressionModel {
  id: string
  name: string
  version: string
  rmse: number
  r2: number
  maePercent: number
  lastEval: string
  staleDays: number
  status: PillVariant
  statusLabel: string
}

interface ScatterPoint {
  actual: number
  predicted: number
  residual: number
  model: string
}

// ── Mock data ──────────────────────────────────────────────────────────────────

const MODELS: RegressionModel[] = [
  { id: 'r1', name: 'score-regressor',  version: 'v7',  rmse: 0.043, r2: 0.94, maePercent: 3.1, lastEval: '2026-03-17', staleDays: 0,  status: 'green',  statusLabel: 'Healthy' },
  { id: 'r2', name: 'latency-pred',     version: 'v3',  rmse: 0.112, r2: 0.81, maePercent: 8.4, lastEval: '2026-03-15', staleDays: 2,  status: 'amber',  statusLabel: 'Warning' },
  { id: 'r3', name: 'confidence-est',   version: 'v5',  rmse: 0.078, r2: 0.87, maePercent: 5.9, lastEval: '2026-03-10', staleDays: 7,  status: 'red',    statusLabel: 'Stale' },
  { id: 'r4', name: 'drift-detector',   version: 'v2',  rmse: 0.201, r2: 0.64, maePercent: 14.2, lastEval: '2026-03-01', staleDays: 16, status: 'red',   statusLabel: 'Stale' },
  { id: 'r5', name: 'calibration-net',  version: 'v4',  rmse: 0.055, r2: 0.91, maePercent: 4.3, lastEval: '2026-03-16', staleDays: 1,  status: 'green',  statusLabel: 'Healthy' },
]

// Scatter points for the residual plot
const SCATTER_POINTS: ScatterPoint[] = Array.from({ length: 60 }, (_, i) => {
  const actual = 0.2 + Math.random() * 0.7
  const noise = (Math.random() - 0.5) * 0.1
  const predicted = Math.min(1, Math.max(0, actual + noise))
  return {
    actual,
    predicted,
    residual: predicted - actual,
    model: MODELS[i % MODELS.length].name,
  }
})

// ── Residual scatter plot (SVG) ────────────────────────────────────────────────

function ResidualPlot({ points }: { points: ScatterPoint[] }) {
  const W = 340
  const H = 200
  const PAD = { top: 16, right: 16, bottom: 32, left: 40 }

  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const xMin = 0, xMax = 1
  const yMin = -0.2, yMax = 0.2

  const toX = (v: number) => PAD.left + ((v - xMin) / (xMax - xMin)) * innerW
  const toY = (v: number) => PAD.top + innerH - ((v - yMin) / (yMax - yMin)) * innerH

  const yTicks = [-0.2, -0.1, 0, 0.1, 0.2]
  const xTicks = [0, 0.25, 0.5, 0.75, 1.0]

  const dotColor = (residual: number) => {
    if (Math.abs(residual) > 0.12) return EMBRY.red
    if (Math.abs(residual) > 0.06) return EMBRY.amber
    return EMBRY.blue
  }

  return (
    <svg width={W} height={H} style={{ overflow: 'visible' }}>
      {/* Grid */}
      {yTicks.map((y) => (
        <line key={y}
          x1={PAD.left} x2={PAD.left + innerW}
          y1={toY(y)} y2={toY(y)}
          stroke={EMBRY.border} strokeDasharray="3 3"
        />
      ))}

      {/* Zero line */}
      <line
        x1={PAD.left} x2={PAD.left + innerW}
        y1={toY(0)} y2={toY(0)}
        stroke={EMBRY.dim} strokeWidth={1}
      />

      {/* Y axis ticks */}
      {yTicks.map((y) => (
        <text key={y}
          x={PAD.left - 6} y={toY(y) + 4}
          fontSize={8} fill={EMBRY.dim} textAnchor="end"
        >
          {y > 0 ? '+' : ''}{y.toFixed(1)}
        </text>
      ))}

      {/* X axis ticks */}
      {xTicks.map((x) => (
        <text key={x}
          x={toX(x)} y={PAD.top + innerH + 14}
          fontSize={8} fill={EMBRY.dim} textAnchor="middle"
        >
          {x.toFixed(2)}
        </text>
      ))}

      {/* Axis labels */}
      <text x={PAD.left + innerW / 2} y={H - 2} fontSize={9} fill={EMBRY.dim} textAnchor="middle">
        Actual
      </text>
      <text
        x={10} y={PAD.top + innerH / 2}
        fontSize={9} fill={EMBRY.dim} textAnchor="middle"
        transform={`rotate(-90, 10, ${PAD.top + innerH / 2})`}
      >
        Residual
      </text>

      {/* Data points */}
      {points.map((p, i) => (
        <circle key={i}
          cx={toX(p.actual)}
          cy={toY(p.residual)}
          r={3}
          fill={dotColor(p.residual)}
          fillOpacity={0.7}
        />
      ))}
    </svg>
  )
}

// ── RegressionTab ──────────────────────────────────────────────────────────────

export function RegressionTab() {
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [reEvalRequested, setReEvalRequested] = useState<Set<string>>(new Set())

  const handleReEvaluate = (e: React.MouseEvent, modelId: string) => {
    e.stopPropagation()
    setReEvalRequested((prev) => new Set([...prev, modelId]))
  }

  return (
    <div style={{ padding: 20, overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={heading}>Regression Lab</div>
        <div style={{ fontSize: 11, color: EMBRY.dim, marginTop: 2 }}>
          Model staleness · residual analysis · re-evaluation queue
        </div>
      </div>

      {/* Gate badges */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <StatusPill variant="green">RMSE ≤ 0.10</StatusPill>
        <StatusPill variant="blue">R² ≥ 0.80</StatusPill>
        <StatusPill variant="red">Staleness &gt; 7d = Alert</StatusPill>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 16, marginBottom: 20, alignItems: 'start' }}>
        {/* Model table */}
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${EMBRY.border}` }}>
            <div style={label}>Model Registry</div>
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${EMBRY.border}` }}>
                {['Model', 'RMSE', 'R²', 'MAE%', 'Staleness', 'Status', ''].map((col, i) => (
                  <th key={i} style={{
                    textAlign: 'left',
                    padding: '8px 12px',
                    fontSize: 10,
                    fontWeight: 700,
                    color: EMBRY.dim,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}>{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODELS.map((model) => {
                const isHovered = hoveredRow === model.id
                const isSelected = selectedModelId === model.id
                const didReEval = reEvalRequested.has(model.id)
                return (
                  <tr
                    key={model.id}
                    data-qid="regression:table:row"
                    onClick={() => setSelectedModelId((p) => (p === model.id ? null : model.id))}
                    onMouseEnter={() => setHoveredRow(model.id)}
                    onMouseLeave={() => setHoveredRow(null)}
                    style={{
                      borderBottom: `1px solid ${EMBRY.border}`,
                      cursor: 'pointer',
                      backgroundColor: isSelected
                        ? `${EMBRY.blue}12`
                        : isHovered
                        ? `${EMBRY.white}06`
                        : 'transparent',
                      transition: 'background-color 0.12s',
                    }}
                  >
                    <td style={{ padding: '10px 12px', color: EMBRY.white, fontWeight: 600 }}>
                      <div>{model.name}</div>
                      <div style={{ fontSize: 10, color: EMBRY.dim }}>{model.version}</div>
                    </td>
                    <td style={{
                      padding: '10px 12px',
                      color: model.rmse <= 0.10 ? EMBRY.green : EMBRY.red,
                      fontWeight: 700,
                    }}>
                      {model.rmse.toFixed(3)}
                    </td>
                    <td style={{
                      padding: '10px 12px',
                      color: model.r2 >= 0.80 ? EMBRY.green : EMBRY.amber,
                      fontWeight: 700,
                    }}>
                      {model.r2.toFixed(2)}
                    </td>
                    <td style={{ padding: '10px 12px', color: EMBRY.dim }}>
                      {model.maePercent.toFixed(1)}%
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <StatusPill variant={model.staleDays > 7 ? 'red' : model.staleDays > 3 ? 'amber' : 'green'}>
                        {model.staleDays === 0 ? 'Today' : `${model.staleDays}d ago`}
                      </StatusPill>
                    </td>
                    <td style={{ padding: '10px 12px' }}>
                      <StatusPill variant={model.status}>{model.statusLabel}</StatusPill>
                    </td>
                    <td style={{ padding: '10px 12px', minWidth: 90 }}>
                      {isHovered && !didReEval && (
                        <button
                          data-qid="regression:action:re-evaluate"
                          onClick={(e) => handleReEvaluate(e, model.id)}
                          style={{
                            background: 'none',
                            border: 'none',
                            color: EMBRY.blue,
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: 'pointer',
                            padding: '2px 0',
                            textDecoration: 'underline',
                            textDecorationStyle: 'dotted',
                          }}
                        >
                          Re-evaluate
                        </button>
                      )}
                      {didReEval && (
                        <StatusPill variant="blue">Queued</StatusPill>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Residual scatter */}
        <div style={{ ...card, padding: 16 }}>
          <div style={{ ...label, marginBottom: 12 }}>Residual Plot</div>
          <ResidualPlot points={SCATTER_POINTS} />
          <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: EMBRY.blue, opacity: 0.7 }} />
              <span style={{ fontSize: 9, color: EMBRY.dim }}>|e| ≤ 0.06</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: EMBRY.amber, opacity: 0.7 }} />
              <span style={{ fontSize: 9, color: EMBRY.dim }}>|e| ≤ 0.12</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: EMBRY.red, opacity: 0.7 }} />
              <span style={{ fontSize: 9, color: EMBRY.dim }}>|e| &gt; 0.12</span>
            </div>
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {[
          { label: 'Total Models', value: MODELS.length.toString(), variant: 'neutral' as const },
          { label: 'Healthy', value: MODELS.filter((m) => m.status === 'green').length.toString(), variant: 'green' as const },
          { label: 'Stale (>7d)', value: MODELS.filter((m) => m.staleDays > 7).length.toString(), variant: 'red' as const },
          { label: 'Avg R²', value: (MODELS.reduce((s, m) => s + m.r2, 0) / MODELS.length).toFixed(2), variant: 'blue' as const },
        ].map((stat) => (
          <div key={stat.label} style={{ ...card, padding: 14, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: EMBRY[stat.variant === 'neutral' ? 'dim' : stat.variant] }}>
              {stat.value}
            </div>
            <div style={{ fontSize: 10, color: EMBRY.dim, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {stat.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

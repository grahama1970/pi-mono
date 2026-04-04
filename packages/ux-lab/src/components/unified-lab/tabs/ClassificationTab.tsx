import { useState, useEffect } from 'react'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts'
import { EMBRY, card, label, heading } from '../../sparta/common/EmbryStyle'
import { StatusPill } from '../components/StatusPill'
import type { PillVariant } from '../components/StatusPill'
import { useWebSocket } from '../hooks/useWebSocket'

// ── Mock data ────────────────────────────────────────────────────────────────

const INITIAL_CURVE = Array.from({ length: 20 }, (_, i) => ({
  epoch: i + 1,
  f1: Math.min(0.99, 0.35 + 0.03 * i + Math.random() * 0.02),
  loss: Math.max(0.02, 0.85 - 0.04 * i + Math.random() * 0.02),
}))

const CLASS_DIST = [
  { cls: 'Intent', recall: 0.93, support: 1240 },
  { cls: 'Entity', recall: 0.88, support: 980 },
  { cls: 'Relation', recall: 0.71, support: 540 },
  { cls: 'Negation', recall: 0.54, support: 210 },
  { cls: 'Coref', recall: 0.48, support: 130 },
]

interface PromoModel {
  id: string
  name: string
  macroF1: number
  wilsonLB: number
  epoch: number
  status: PillVariant
  statusLabel: string
}

const INITIAL_PROMO: PromoModel[] = [
  { id: 'm1', name: 'intent-clf-v12', macroF1: 0.91, wilsonLB: 0.89, epoch: 20, status: 'green', statusLabel: 'Promoted' },
  { id: 'm2', name: 'intent-clf-v11', macroF1: 0.87, wilsonLB: 0.85, epoch: 18, status: 'amber', statusLabel: 'Pending' },
  { id: 'm3', name: 'entity-clf-v8',  macroF1: 0.78, wilsonLB: 0.76, epoch: 15, status: 'amber', statusLabel: 'Training' },
  { id: 'm4', name: 'coref-clf-v3',   macroF1: 0.61, wilsonLB: 0.58, epoch: 9,  status: 'red',   statusLabel: 'Failed Gate' },
  { id: 'm5', name: 'negation-v5',    macroF1: 0.69, wilsonLB: 0.66, epoch: 11, status: 'purple', statusLabel: 'Memorizing' },
]

// ── Tooltip ──────────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label: lbl }: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string | number
}) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      backgroundColor: EMBRY.bgCard,
      border: `1px solid ${EMBRY.border}`,
      borderRadius: 8,
      padding: '8px 12px',
      fontSize: 11,
    }}>
      <div style={{ color: EMBRY.dim, marginBottom: 4 }}>Epoch {lbl}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color, fontWeight: 700 }}>
          {p.name}: {p.value.toFixed(3)}
        </div>
      ))}
    </div>
  )
}

function BarTooltip({ active, payload, label: lbl }: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      backgroundColor: EMBRY.bgCard,
      border: `1px solid ${EMBRY.border}`,
      borderRadius: 8,
      padding: '8px 12px',
      fontSize: 11,
    }}>
      <div style={{ color: EMBRY.white, fontWeight: 700 }}>{lbl}</div>
      <div style={{ color: EMBRY.blue }}>Recall: {payload[0].value.toFixed(2)}</div>
    </div>
  )
}

// ── ClassificationTab ─────────────────────────────────────────────────────────

export function ClassificationTab() {
  const { lastMessage, sendMessage, status: wsStatus } = useWebSocket()
  const [curve, setCurve] = useState(INITIAL_CURVE)
  const [promoModels, setPromoModels] = useState(INITIAL_PROMO)
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null)
  const [agentRunning, setAgentRunning] = useState(true)
  const [hoveredRow, setHoveredRow] = useState<string | null>(null)

  // Consume WebSocket metric pushes
  useEffect(() => {
    if (!lastMessage) return
    if (lastMessage.type === 'epoch_update') {
      const payload = lastMessage.payload as { epoch: number; f1: number; loss: number }
      setCurve((prev) => [
        ...prev.slice(-19),
        { epoch: payload.epoch, f1: payload.f1, loss: payload.loss },
      ])
    }
  }, [lastMessage])

  const handleStopTraining = () => {
    setAgentRunning(false)
    sendMessage({ type: 'stop_training', payload: {}, timestamp: Date.now() })
  }

  const handleRowClick = (model: PromoModel) => {
    setSelectedModelId((prev) => (prev === model.id ? null : model.id))
  }

  return (
    <div style={{ padding: 20, overflowY: 'auto', height: '100%', boxSizing: 'border-box' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <div style={heading}>Classification Lab</div>
          <div style={{ fontSize: 11, color: EMBRY.dim, marginTop: 2 }}>
            Live training supervision · WS:{wsStatus}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <StatusPill variant={agentRunning ? 'amber' : 'neutral'} flash={agentRunning}>
            {agentRunning ? 'Training' : 'Stopped'}
          </StatusPill>
          <button
            data-qid="classification:action:stop-training"
            onClick={handleStopTraining}
            disabled={!agentRunning}
            style={{
              backgroundColor: agentRunning ? EMBRY.red : EMBRY.muted,
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              padding: '5px 14px',
              fontSize: 10,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              cursor: agentRunning ? 'pointer' : 'not-allowed',
              opacity: agentRunning ? 1 : 0.5,
              transition: 'background-color 0.2s',
            }}
          >
            Stop Training
          </button>
        </div>
      </div>

      {/* Gate badges */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
        <StatusPill variant="green">Macro F1 ≥ 0.75</StatusPill>
        <StatusPill variant="blue">Recall/class ≥ 0.50</StatusPill>
        <StatusPill variant="purple">Wilson LB ≥ 0.85</StatusPill>
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* Training curve */}
        <div style={{ ...card, padding: 16 }}>
          <div style={{ ...label, marginBottom: 12 }}>Training Curve</div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={curve} margin={{ top: 4, right: 8, bottom: 4, left: -20 }}>
              <CartesianGrid stroke={EMBRY.border} strokeDasharray="3 3" />
              <XAxis dataKey="epoch" tick={{ fontSize: 9, fill: EMBRY.dim }} tickLine={false} />
              <YAxis domain={[0, 1]} tick={{ fontSize: 9, fill: EMBRY.dim }} tickLine={false} />
              <Tooltip content={<ChartTooltip />} />
              <Line
                type="monotone"
                dataKey="f1"
                name="F1"
                stroke={EMBRY.green}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: EMBRY.green }}
              />
              <Line
                type="monotone"
                dataKey="loss"
                name="Loss"
                stroke={EMBRY.red}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: EMBRY.red }}
              />
            </LineChart>
          </ResponsiveContainer>
          <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 12, height: 2, backgroundColor: EMBRY.green }} />
              <span data-qid="classification:chart:legend-item" style={{ fontSize: 9, color: EMBRY.dim }}>F1</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 12, height: 2, backgroundColor: EMBRY.red }} />
              <span data-qid="classification:chart:legend-item" style={{ fontSize: 9, color: EMBRY.dim }}>Loss</span>
            </div>
          </div>
        </div>

        {/* Class distribution */}
        <div style={{ ...card, padding: 16 }}>
          <div style={{ ...label, marginBottom: 12 }}>Per-Class Recall</div>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={CLASS_DIST} layout="vertical" margin={{ top: 4, right: 8, bottom: 4, left: 16 }}>
              <CartesianGrid stroke={EMBRY.border} strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" domain={[0, 1]} tick={{ fontSize: 9, fill: EMBRY.dim }} tickLine={false} />
              <YAxis dataKey="cls" type="category" tick={{ fontSize: 9, fill: EMBRY.dim }} tickLine={false} width={50} />
              <Tooltip content={<BarTooltip />} />
              <Bar dataKey="recall" fill={EMBRY.blue} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Promotion table */}
      <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={label}>Promotion Queue</div>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${EMBRY.border}` }}>
              {['Model', 'Macro F1', 'Wilson LB', 'Epoch', 'Status'].map((col) => (
                <th key={col} style={{
                  textAlign: 'left',
                  padding: '8px 16px',
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
            {promoModels.map((model) => {
              const isSelected = selectedModelId === model.id
              const isHovered = hoveredRow === model.id
              return (
                <tr
                  key={model.id}
                  data-qid="classification:promo:row"
                  onClick={() => handleRowClick(model)}
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
                  <td style={{ padding: '10px 16px', color: EMBRY.white, fontWeight: 600 }}>
                    {model.name}
                  </td>
                  <td style={{
                    padding: '10px 16px',
                    color: model.macroF1 >= 0.75 ? EMBRY.green : EMBRY.red,
                    fontWeight: 700,
                  }}>
                    {model.macroF1.toFixed(3)}
                  </td>
                  <td style={{
                    padding: '10px 16px',
                    color: model.wilsonLB >= 0.85 ? EMBRY.green : EMBRY.amber,
                    fontWeight: 700,
                  }}>
                    {model.wilsonLB.toFixed(3)}
                  </td>
                  <td style={{ padding: '10px 16px', color: EMBRY.dim }}>
                    {model.epoch}
                  </td>
                  <td style={{ padding: '10px 16px' }}>
                    <StatusPill variant={model.status}>{model.statusLabel}</StatusPill>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {selectedModelId && (
          <div style={{
            padding: '12px 16px',
            borderTop: `1px solid ${EMBRY.border}`,
            backgroundColor: EMBRY.bgPanel,
            fontSize: 11,
            color: EMBRY.dim,
          }}>
            Selected: <span style={{ color: EMBRY.white, fontWeight: 600 }}>
              {promoModels.find((m) => m.id === selectedModelId)?.name}
            </span> — click again to deselect
          </div>
        )}
      </div>
    </div>
  )
}

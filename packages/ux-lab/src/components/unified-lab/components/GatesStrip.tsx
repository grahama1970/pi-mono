import { EMBRY } from '../../sparta/common/EmbryStyle'

interface Gate {
  name: string
  status: 'pass' | 'fail' | 'pending'
}

const defaultGates: Gate[] = [
  { name: 'Grounding', status: 'pass' },
  { name: 'Entity', status: 'pass' },
  { name: 'Hallucination', status: 'fail' },
  { name: 'Latency', status: 'pass' },
  { name: 'Coverage', status: 'pending' },
]

const statusColor: Record<Gate['status'], string> = {
  pass: EMBRY.green,
  fail: EMBRY.red,
  pending: EMBRY.dim,
}

export function GatesStrip({ gates = defaultGates }: { gates?: Gate[] }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {gates.map((g) => {
        const color = statusColor[g.status]
        return (
          <span
            key={g.name}
            style={{
              fontSize: 9,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              padding: '2px 8px',
              borderRadius: 4,
              color,
              backgroundColor: `${color}18`,
              border: `1px solid ${color}33`,
            }}
          >
            {g.status === 'pass' ? 'PASS' : g.status === 'fail' ? 'FAIL' : '...'}{' '}
            {g.name}
          </span>
        )
      })}
    </div>
  )
}

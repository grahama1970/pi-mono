import { EMBRY, card, label, heading } from '../../sparta/common/EmbryStyle'
import { StatusPill } from '../components/StatusPill'

function LockIcon({ size = 48, color = EMBRY.dim }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
      <rect
        x="4" y="11" width="16" height="11" rx="2"
        stroke={color} strokeWidth="1.5" fill={`${color}18`}
      />
      <path
        d="M8 11V7a4 4 0 0 1 8 0v4"
        stroke={color} strokeWidth="1.5" strokeLinecap="round"
      />
      <circle cx="12" cy="16" r="1.5" fill={color} />
      <line x1="12" y1="17.5" x2="12" y2="19.5" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

const PREREQUISITES = [
  { id: 'p1', label: 'Wave 0.5 — cascade.py instrumentation', status: 'amber' as const, done: false },
  { id: 'p2', label: 'Cascade trace schema finalized', status: 'amber' as const, done: false },
  { id: 'p3', label: 'ClassificationTab deployed', status: 'green' as const, done: true },
  { id: 'p4', label: 'RegressionTab deployed', status: 'green' as const, done: true },
]

export function CascadeTab() {
  return (
    <div style={{
      padding: 40,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '60vh',
      gap: 24,
    }}>
      {/* Lock icon */}
      <LockIcon size={56} color={EMBRY.blue} />

      {/* Title block */}
      <div style={{ textAlign: 'center', maxWidth: 420 }}>
        <div style={{ ...heading, fontSize: 20, marginBottom: 8 }}>Cascade Lab</div>
        <div style={{ fontSize: 13, color: EMBRY.dim, lineHeight: 1.7 }}>
          Multi-stage cascade evaluation is coming in <strong style={{ color: EMBRY.white }}>Wave 0.5</strong>.
          This tab will enable end-to-end supervision of classifier → regressor → GPT
          pipeline chains with per-stage gate tracking.
        </div>
      </div>

      {/* Track pill */}
      <StatusPill variant="blue">Track Wave 0.5</StatusPill>

      {/* Prerequisites */}
      <div style={{ ...card, width: '100%', maxWidth: 420, padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={label}>Prerequisites</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {PREREQUISITES.map((prereq, i) => (
            <div
              key={prereq.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 16px',
                borderBottom: i < PREREQUISITES.length - 1 ? `1px solid ${EMBRY.border}` : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  border: `2px solid ${prereq.done ? EMBRY.green : EMBRY.muted}`,
                  backgroundColor: prereq.done ? `${EMBRY.green}22` : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  {prereq.done && (
                    <svg width="8" height="8" viewBox="0 0 8 8">
                      <path d="M1.5 4L3 5.5L6.5 2" stroke={EMBRY.green} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </div>
                <span style={{ fontSize: 12, color: prereq.done ? EMBRY.white : EMBRY.dim }}>
                  {prereq.label}
                </span>
              </div>
              <StatusPill variant={prereq.done ? 'green' : prereq.status}>
                {prereq.done ? 'Done' : 'Pending'}
              </StatusPill>
            </div>
          ))}
        </div>
      </div>

      {/* What's coming */}
      <div style={{ maxWidth: 420, width: '100%' }}>
        <div style={{ ...label, marginBottom: 10 }}>What's Coming</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            'Stage-by-stage gate pass/fail visualization',
            'Cross-stage latency waterfall chart',
            'Cascade failure attribution (which stage degraded)',
            'Re-run selector: restart from any stage',
          ].map((item) => (
            <div key={item} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ width: 4, height: 4, borderRadius: '50%', backgroundColor: EMBRY.blue, marginTop: 6, flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: EMBRY.dim, lineHeight: 1.6 }}>{item}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

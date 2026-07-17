import { AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react'
import { EMBRY, label } from '../common/EmbryStyle'
import type { PagePurposeContract } from './pagePurposeContracts'

const stateTone = {
  fail: { color: EMBRY.red, icon: ShieldAlert, text: 'fail' },
  degraded: { color: EMBRY.amber, icon: AlertTriangle, text: 'degraded' },
  pass: { color: EMBRY.green, icon: CheckCircle2, text: 'pass' },
} as const

const telemetryLabel = {
  ...label,
  color: 'rgba(255,255,255,0.6)',
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: '0.12em',
  textTransform: 'uppercase' as const,
}

export function PagePurposeStrip({ contract }: { contract: PagePurposeContract }) {
  const tone = stateTone[contract.state] ?? stateTone.fail
  const Icon = tone.icon

  if (contract.id === 'threat-matrix') {
    const infoTitle = [
      `Primary object: ${contract.primaryObject}`,
      `Purpose: ${contract.purpose}`,
      `Source: ${contract.sourceOfTruth}`,
      `Monitor: ${contract.monitorPredicates.join(', ')}`,
      `Next: ${contract.nextStateAction}`,
    ].join('\n')

    return (
      <section
        data-qid="sparta:page-purpose:threat-matrix:compressed"
        data-page-purpose-state={contract.state}
        data-page-purpose-owner={contract.owner}
        data-page-purpose-primary-object={contract.primaryObject}
        data-page-purpose-state-reason={contract.stateReason}
        data-page-purpose-next-action={contract.nextStateAction}
        aria-label={`${contract.label} compressed page purpose contract`}
        style={{
          borderBottom: `1px solid ${EMBRY.border}`,
          background: 'rgba(3, 8, 15, 0.94)',
          padding: '8px 16px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          minHeight: 48,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div
            style={{
              color: EMBRY.white,
              fontSize: 16,
              fontWeight: 900,
              letterSpacing: '0.02em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            }}
          >
            {contract.group} / {tone.text}
          </div>
          <span style={{ color: 'rgba(255,255,255,0.18)', fontSize: 18, fontWeight: 800 }}>|</span>
          <div
            style={{
              color: EMBRY.white,
              fontSize: 16,
              fontWeight: 900,
              whiteSpace: 'nowrap',
            }}
          >
            {contract.label}
          </div>
          <span
            title={infoTitle}
            style={{
              ...telemetryLabel,
              color: 'rgba(255,255,255,0.42)',
              border: `1px solid ${EMBRY.border}`,
              borderRadius: 4,
              padding: '2px 7px',
              cursor: 'help',
              whiteSpace: 'nowrap',
            }}
          >
            SYS.INFO
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10, minWidth: 0 }}>
          <span
            title={contract.stateReason}
            style={{
              ...telemetryLabel,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              color: EMBRY.red,
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.22)',
              borderRadius: 4,
              padding: '5px 8px',
              whiteSpace: 'nowrap',
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: 999,
                background: EMBRY.red,
                boxShadow: '0 0 8px rgba(239,68,68,0.55)',
              }}
            />
            Pipeline degraded
          </span>
          <span
            title={contract.dashboardTheaterControls.join(' | ')}
            style={{
              ...telemetryLabel,
              color: 'rgba(255,255,255,0.62)',
              background: 'rgba(255,255,255,0.05)',
              border: `1px solid ${EMBRY.border}`,
              borderRadius: 4,
              padding: '5px 8px',
              whiteSpace: 'nowrap',
            }}
          >
            Evidence gated
          </span>
        </div>
      </section>
    )
  }

  return (
    <section
      data-qid={`sparta:page-purpose:${contract.id}`}
      data-page-purpose-state={contract.state}
      data-page-purpose-owner={contract.owner}
      data-page-purpose-primary-object={contract.primaryObject}
      data-page-purpose-state-reason={contract.stateReason}
      data-page-purpose-next-action={contract.nextStateAction}
      aria-label={`${contract.label} page purpose contract`}
      style={{
        borderBottom: `1px solid ${EMBRY.border}`,
        background: 'rgba(3, 8, 15, 0.94)',
        padding: '10px 16px',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 14,
        alignItems: 'start',
        flexShrink: 0,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ ...label, color: tone.color, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon size={14} />
          {contract.group} / {tone.text}
        </div>
        <div style={{ color: EMBRY.white, fontSize: 13, fontWeight: 900, marginTop: 3 }}>{contract.label}</div>
        <div style={{ color: EMBRY.dim, fontSize: 11, lineHeight: 1.35, marginTop: 2 }}>Owner: {contract.owner}</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={telemetryLabel}>Primary object</div>
        <div style={{ color: EMBRY.white, fontSize: 12, lineHeight: 1.35, marginTop: 3 }}>{contract.primaryObject}</div>
        <div style={{ color: EMBRY.dim, fontSize: 11, lineHeight: 1.35, marginTop: 5 }}>{contract.purpose}</div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={telemetryLabel}>Fail-closed controls</div>
        <div style={{ color: EMBRY.white, fontSize: 11, lineHeight: 1.4, marginTop: 3 }}>
          {contract.dashboardTheaterControls.join(' | ')}
        </div>
        <div style={{ color: EMBRY.dim, fontSize: 11, lineHeight: 1.4, marginTop: 5 }}>
          Monitor: {contract.monitorPredicates.slice(0, 2).join(', ')}
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={telemetryLabel}>State evidence</div>
        <div style={{ color: EMBRY.white, fontSize: 11, lineHeight: 1.4, marginTop: 3 }}>{contract.stateReason}</div>
        <div style={{ color: EMBRY.dim, fontSize: 11, lineHeight: 1.4, marginTop: 5 }}>
          Next: {contract.nextStateAction}
        </div>
      </div>
    </section>
  )
}

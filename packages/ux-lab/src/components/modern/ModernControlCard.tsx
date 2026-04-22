// ModernControlCard.tsx — Floating Response Card (2026 Industrial Minimal)

import { memo } from 'react'
import { THEME } from '../../theme/industrial-minimal'
import type { Verdict } from '../../theme/industrial-minimal'
import { Crosshair, GitBranch, Play } from 'lucide-react'

interface ModernControlCardProps {
  id: string
  name: string
  verdict: Verdict
  grade: string
  caseCount: number
  onFocus: () => void
  onViewRelations: () => void
  onRunEvidence: () => void
}

export const ModernControlCard = memo(function ModernControlCard({
  id, name, verdict, grade, caseCount,
  onFocus, onViewRelations, onRunEvidence,
}: ModernControlCardProps) {
  const status = THEME.status[verdict]

  return (
    <div
      data-qid={`card:control:${id}`}
      style={{
        background: THEME.bgElevated,
        borderRadius: THEME.radius.md,
        border: `1px solid ${THEME.border}`,
        overflow: 'hidden',
        boxShadow: THEME.shadow.sm,
        marginTop: THEME.space.md,
      }}
    >
      {/* Header */}
      <div style={{
        padding: `${THEME.space.md}px ${THEME.space.lg}px`,
        borderBottom: `1px solid ${THEME.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: THEME.space.sm }}>
          <span style={{
            color: THEME.accent,
            fontFamily: THEME.font.mono,
            fontSize: THEME.font.size.sm,
            fontWeight: THEME.font.weight.semibold,
          }}>
            {id}
          </span>
          <span style={{
            color: THEME.text,
            fontSize: THEME.font.size.sm,
          }}>
            {name}
          </span>
        </div>

        {/* Status Badge */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: THEME.space.xs,
          color: status.color,
          fontSize: THEME.font.size.xs,
          fontWeight: THEME.font.weight.medium,
        }}>
          <span>{status.icon}</span>
          <span style={{ textTransform: 'capitalize' }}>
            {verdict.replace('_', ' ')}
          </span>
        </div>
      </div>

      {/* Metrics Row */}
      <div style={{
        padding: `${THEME.space.sm}px ${THEME.space.lg}px`,
        display: 'flex',
        gap: THEME.space.xl,
        borderBottom: `1px solid ${THEME.border}`,
      }}>
        <Metric label="Grade" value={grade} />
        <Metric label="Evidence" value={`${caseCount} cases`} />
      </div>

      {/* Actions */}
      <div style={{
        padding: THEME.space.sm,
        display: 'flex',
        gap: THEME.space.xs,
      }}>
        <CardAction
          icon={<Crosshair size={16} strokeWidth={1.25} />}
          label="Focus"
          onClick={onFocus}
          qid={`card:focus:${id}`}
        />
        <CardAction
          icon={<GitBranch size={16} strokeWidth={1.25} />}
          label="Relations"
          onClick={onViewRelations}
          qid={`card:relations:${id}`}
        />
        <CardAction
          icon={<Play size={16} strokeWidth={1.25} />}
          label="Run Evidence"
          onClick={onRunEvidence}
          qid={`card:evidence:${id}`}
          primary
        />
      </div>
    </div>
  )
})

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{
        color: THEME.textDim,
        fontSize: THEME.font.size.xs,
        marginBottom: 2,
      }}>
        {label}
      </div>
      <div style={{
        color: THEME.text,
        fontSize: THEME.font.size.sm,
        fontWeight: THEME.font.weight.medium,
      }}>
        {value}
      </div>
    </div>
  )
}

function CardAction({ icon, label, onClick, primary, qid }: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  primary?: boolean
  qid: string
}) {
  return (
    <button
      data-qid={qid}
      onClick={onClick}
      title={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: THEME.space.xs,
        padding: `${THEME.space.sm}px ${THEME.space.md}px`,
        borderRadius: THEME.radius.sm,
        border: 'none',
        background: primary ? THEME.text : 'transparent',
        color: primary ? THEME.bg : THEME.textMuted,
        fontSize: THEME.font.size.xs,
        fontFamily: THEME.font.sans,
        cursor: 'pointer',
        minHeight: THEME.touch.min,
        transition: `all ${THEME.motion.fast}`,
      }}
      onMouseEnter={e => {
        if (!primary) {
          e.currentTarget.style.background = THEME.bgGlass
          e.currentTarget.style.color = THEME.text
        }
      }}
      onMouseLeave={e => {
        if (!primary) {
          e.currentTarget.style.background = 'transparent'
          e.currentTarget.style.color = THEME.textMuted
        }
      }}
    >
      {icon}
      {label}
    </button>
  )
}

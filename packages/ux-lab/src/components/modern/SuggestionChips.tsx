// SuggestionChips.tsx — Contextual Quick Actions (2026 Industrial Minimal)

import { memo, useState } from 'react'
import { THEME } from '../../theme/industrial-minimal'
import { Zap } from 'lucide-react'

interface Chip {
  label: string
  query: string
}

interface SuggestionChipsProps {
  chips: Chip[]
  onSelect: (query: string) => void
}

export const SuggestionChips = memo(function SuggestionChips({
  chips,
  onSelect,
}: SuggestionChipsProps) {
  if (chips.length === 0) return null

  return (
    <div style={{
      display: 'flex',
      gap: THEME.space.sm,
      flexWrap: 'wrap',
      alignItems: 'center',
      marginBottom: THEME.space.md,
    }}>
      <Zap
        size={14}
        strokeWidth={1.25}
        style={{ color: THEME.textDim }}
      />
      {chips.map((chip, i) => (
        <ChipButton
          key={chip.label}
          label={chip.label}
          onClick={() => onSelect(chip.query)}
          qid={`chat:chip:${i}`}
        />
      ))}
    </div>
  )
})

function ChipButton({ label, onClick, qid }: {
  label: string
  onClick: () => void
  qid: string
}) {
  const [hovered, setHovered] = useState(false)

  return (
    <button
      data-qid={qid}
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={label}
      style={{
        background: hovered ? THEME.bgGlassHover : THEME.bgGlass,
        border: `1px solid ${hovered ? THEME.accent : THEME.border}`,
        borderRadius: THEME.radius.full,
        padding: `${THEME.space.xs}px ${THEME.space.md}px`,
        color: hovered ? THEME.text : THEME.textMuted,
        fontSize: THEME.font.size.sm,
        fontFamily: THEME.font.sans,
        cursor: 'pointer',
        transition: `all ${THEME.motion.fast}`,
        minHeight: THEME.touch.min,
        display: 'flex',
        alignItems: 'center',
      }}
    >
      {label}
    </button>
  )
}

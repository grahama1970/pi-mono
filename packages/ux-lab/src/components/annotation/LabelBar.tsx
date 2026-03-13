import { useEffect, useCallback } from 'react'
import { NVIS } from '../../theme'
import { useAnnotationStore } from '../../store/annotationStore'

const styles = {
  bar: {
    display: 'flex',
    gap: 8,
    padding: '8px 16px',
    backgroundColor: NVIS.BG_SECONDARY,
    borderBottom: `1px solid ${NVIS.DIM}`,
  },
  chip: {
    padding: '4px 12px',
    borderRadius: 4,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.05em',
    cursor: 'pointer',
    border: '1px solid',
    transition: 'all 0.15s',
  },
  shortcutHint: {
    fontSize: 9,
    opacity: 0.5,
    marginLeft: 4,
  },
}

export function LabelBar() {
  const availableLabels = useAnnotationStore((s) => s.availableLabels)
  const activeLabel = useAnnotationStore((s) => s.activeLabel)
  const setActiveLabel = useAnnotationStore((s) => s.setActiveLabel)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const num = parseInt(e.key, 10)
      if (num >= 1 && num <= availableLabels.length) {
        const label = availableLabels[num - 1]
        setActiveLabel(activeLabel === label.name ? null : label.name)
      }
    },
    [availableLabels, activeLabel, setActiveLabel],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div data-testid="label-bar" style={styles.bar}>
      {availableLabels.map((label, i) => {
        const isActive = activeLabel === label.name
        return (
          <button
            key={label.name}
            style={{
              ...styles.chip,
              backgroundColor: isActive ? `${label.color}33` : 'transparent',
              borderColor: label.color,
              color: isActive ? label.color : NVIS.DIM,
            }}
            onClick={() =>
              setActiveLabel(isActive ? null : label.name)
            }
          >
            {label.name}
            <span style={styles.shortcutHint}>{i + 1}</span>
          </button>
        )
      })}
    </div>
  )
}

import { useState, useCallback, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { NVIS } from '../../theme'
import { useAnnotationStore } from '../../store/annotationStore'
import type { AnnotationItem, EntityLabel } from '../../types'

const styles = {
  container: {
    maxWidth: 700,
    margin: '0 auto',
    padding: 32,
    backgroundColor: NVIS.BG_SECONDARY,
    borderRadius: 8,
    border: `1px solid ${NVIS.DIM}`,
    lineHeight: 2.4,
    fontSize: 16,
    color: NVIS.WHITE,
    userSelect: 'none' as const,
    cursor: 'text',
  },
  token: {
    display: 'inline',
    padding: '4px 1px',
    borderRadius: 3,
    cursor: 'pointer',
    transition: 'background-color 0.1s',
  },
  labelChip: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.05em',
    padding: '1px 4px',
    borderRadius: 3,
    position: 'relative' as const,
    top: -2,
    marginRight: 2,
  },
}

function getTokenStyle(
  index: number,
  labels: EntityLabel[],
  selectionStart: number | null,
  selectionEnd: number | null,
): React.CSSProperties {
  // Check if token is in an active selection
  if (selectionStart !== null && selectionEnd !== null) {
    const lo = Math.min(selectionStart, selectionEnd)
    const hi = Math.max(selectionStart, selectionEnd)
    if (index >= lo && index <= hi) {
      return { ...styles.token, backgroundColor: `${NVIS.ACCENT}66` }
    }
  }
  // Check if token is in a label
  for (const label of labels) {
    if (index >= label.start && index < label.end) {
      return { ...styles.token, backgroundColor: `${label.color}33`, borderBottom: `2px solid ${label.color}` }
    }
  }
  return styles.token
}

function getLabelChipAt(index: number, labels: EntityLabel[]): EntityLabel | null {
  for (const label of labels) {
    if (index === label.start) return label
  }
  return null
}

interface Props {
  item: AnnotationItem
}

export function TokenAnnotation({ item }: Props) {
  const activeLabel = useAnnotationStore((s) => s.activeLabel)
  const addLabel = useAnnotationStore((s) => s.addLabel)
  const removeLabel = useAnnotationStore((s) => s.removeLabel)

  const [selectionStart, setSelectionStart] = useState<number | null>(null)
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null)
  const isDragging = useRef(false)

  const handleMouseDown = useCallback((index: number) => {
    // Check if clicking on an existing label to remove it
    const existingIdx = item.labels.findIndex(
      (l) => index >= l.start && index < l.end,
    )
    if (existingIdx !== -1 && !activeLabel) {
      removeLabel(item.id, existingIdx)
      return
    }
    isDragging.current = true
    setSelectionStart(index)
    setSelectionEnd(index)
  }, [item.id, item.labels, activeLabel, removeLabel])

  const handleMouseEnter = useCallback((index: number) => {
    if (isDragging.current) {
      setSelectionEnd(index)
    }
  }, [])

  const handleMouseUp = useCallback(() => {
    if (!isDragging.current || selectionStart === null || selectionEnd === null) {
      isDragging.current = false
      return
    }
    isDragging.current = false

    if (activeLabel) {
      const lo = Math.min(selectionStart, selectionEnd)
      const hi = Math.max(selectionStart, selectionEnd)
      addLabel(item.id, lo, hi + 1, activeLabel)
    }
    setSelectionStart(null)
    setSelectionEnd(null)
  }, [selectionStart, selectionEnd, activeLabel, addLabel, item.id])

  return (
    <div
      data-testid="token-annotation"
      style={styles.container}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => {
        isDragging.current = false
        setSelectionStart(null)
        setSelectionEnd(null)
      }}
    >
      {item.tokens.map((token, i) => {
        const chipLabel = getLabelChipAt(i, item.labels)
        return (
          <span key={i}>
            {chipLabel && (
              <span
                style={{
                  ...styles.labelChip,
                  backgroundColor: `${chipLabel.color}44`,
                  color: chipLabel.color,
                }}
              >
                {chipLabel.label}
              </span>
            )}
            <span
              style={getTokenStyle(i, item.labels, selectionStart, selectionEnd)}
              onMouseDown={() => handleMouseDown(i)}
              onMouseEnter={() => handleMouseEnter(i)}
            >
              {token}{' '}
            </span>
          </span>
        )
      })}
    </div>
  )
}

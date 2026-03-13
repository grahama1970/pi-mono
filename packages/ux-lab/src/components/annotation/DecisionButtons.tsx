import { useEffect, useCallback } from 'react'
import { NVIS } from '../../theme'
import { useAnnotationStore } from '../../store/annotationStore'

const styles = {
  bar: {
    display: 'flex',
    justifyContent: 'center',
    gap: 16,
    padding: '12px 16px',
    backgroundColor: NVIS.BG_SECONDARY,
    borderTop: `1px solid ${NVIS.DIM}`,
  },
  button: {
    padding: '8px 24px',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid',
    transition: 'all 0.15s',
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  shortcut: {
    fontSize: 10,
    opacity: 0.5,
  },
}

export function DecisionButtons() {
  const accept = useAnnotationStore((s) => s.accept)
  const reject = useAnnotationStore((s) => s.reject)
  const skip = useAnnotationStore((s) => s.skip)
  const items = useAnnotationStore((s) => s.items)

  const disabled = items.length === 0

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (disabled) return
      // Don't intercept if user is typing in an input
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return

      if (e.key === 'Enter' || e.key === 'a') {
        e.preventDefault()
        accept()
      } else if (e.key === 'Backspace' || e.key === 'r') {
        e.preventDefault()
        reject()
      } else if (e.key === ' ' || e.key === 's') {
        e.preventDefault()
        skip()
      }
    },
    [disabled, accept, reject, skip],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  return (
    <div data-testid="decision-buttons" style={styles.bar}>
      <button
        style={{
          ...styles.button,
          backgroundColor: disabled ? 'transparent' : `${NVIS.GREEN}22`,
          borderColor: NVIS.GREEN,
          color: disabled ? NVIS.DIM : NVIS.GREEN,
        }}
        onClick={accept}
        disabled={disabled}
      >
        ✓ Accept <span style={styles.shortcut}>A</span>
      </button>
      <button
        style={{
          ...styles.button,
          backgroundColor: disabled ? 'transparent' : `${NVIS.RED}22`,
          borderColor: NVIS.RED,
          color: disabled ? NVIS.DIM : NVIS.RED,
        }}
        onClick={reject}
        disabled={disabled}
      >
        ✗ Reject <span style={styles.shortcut}>R</span>
      </button>
      <button
        style={{
          ...styles.button,
          backgroundColor: 'transparent',
          borderColor: NVIS.DIM,
          color: NVIS.DIM,
        }}
        onClick={skip}
        disabled={disabled}
      >
        → Skip <span style={styles.shortcut}>S</span>
      </button>
    </div>
  )
}

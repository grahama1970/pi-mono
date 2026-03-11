import { useCanvasStore } from '../store/canvasStore'
import { NVIS } from '../theme'

const styles = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    height: 28,
    backgroundColor: NVIS.BG_SECONDARY,
    borderTop: `1px solid ${NVIS.DIM}`,
    padding: '0 12px',
    fontSize: 11,
    color: NVIS.DIM,
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  badge: {
    backgroundColor: NVIS.BG_TERTIARY,
    borderRadius: 4,
    padding: '1px 6px',
    fontSize: 10,
    color: NVIS.WHITE,
  },
}

export function StatusBar() {
  const viewport = useCanvasStore((s) => s.viewport)
  const selectedIds = useCanvasStore((s) => s.selectedIds)
  const elements = useCanvasStore((s) => s.elements)
  const elementCount = Object.keys(elements).length

  const zoomPercent = Math.round(viewport.zoom * 100)

  return (
    <div style={styles.bar} data-testid="status-bar">
      <div style={styles.left}>
        <span data-testid="zoom-display">Zoom: {zoomPercent}%</span>
        <span>{elementCount} element{elementCount !== 1 ? 's' : ''}</span>
      </div>
      <div style={styles.right}>
        {selectedIds.length > 0 && (
          <span data-testid="selection-count">
            <span style={styles.badge}>{selectedIds.length}</span> selected
          </span>
        )}
      </div>
    </div>
  )
}

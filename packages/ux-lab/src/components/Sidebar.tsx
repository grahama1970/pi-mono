import { useState } from 'react'
import { useCanvasStore } from '../store/canvasStore'
import { NVIS } from '../theme'

const COMPONENT_TYPES = [
  { type: 'paper:button', label: 'Button', description: 'Interactive button with variants' },
  { type: 'paper:card', label: 'Card', description: 'Content card with title and body' },
  { type: 'paper:navbar', label: 'Navbar', description: 'Navigation bar with links' },
  { type: 'paper:container', label: 'Container', description: 'Layout container (flex/grid)' },
  { type: 'paper:text', label: 'Text', description: 'Styled text block' },
]

const styles = {
  sidebar: {
    width: 220,
    backgroundColor: NVIS.BG_SECONDARY,
    borderLeft: `1px solid ${NVIS.DIM}`,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  tabs: {
    display: 'flex',
    borderBottom: `1px solid ${NVIS.DIM}`,
  },
  tab: (active: boolean) => ({
    flex: 1,
    padding: '8px 0',
    border: 'none',
    backgroundColor: active ? NVIS.BG_TERTIARY : 'transparent',
    color: active ? NVIS.WHITE : NVIS.DIM,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  }),
  content: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: 8,
  },
  componentItem: {
    padding: '8px 10px',
    borderRadius: 6,
    backgroundColor: NVIS.BG_TERTIARY,
    marginBottom: 6,
    cursor: 'default',
  },
  componentLabel: {
    fontSize: 13,
    fontWeight: 600,
    color: NVIS.WHITE,
    margin: 0,
  },
  componentDesc: {
    fontSize: 11,
    color: NVIS.DIM,
    margin: '2px 0 0',
  },
  layerItem: (selected: boolean) => ({
    padding: '6px 10px',
    borderRadius: 4,
    backgroundColor: selected ? NVIS.BG_TERTIARY : 'transparent',
    color: selected ? NVIS.WHITE : NVIS.DIM,
    fontSize: 12,
    marginBottom: 2,
    cursor: 'pointer',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  }),
  layerType: {
    fontSize: 10,
    color: NVIS.DIM,
    fontFamily: 'monospace',
  },
  emptyState: {
    color: NVIS.DIM,
    fontSize: 12,
    textAlign: 'center' as const,
    padding: '20px 10px',
  },
}

export interface SidebarProps {
  visible: boolean
}

export function Sidebar({ visible }: SidebarProps) {
  // Only extract the fields needed for the layers list to reduce re-render cost.
  // This still re-renders when any element changes since we need id/type for display,
  // but avoids holding a reference to the full elements map.
  const elementSummaries = useCanvasStore((s) =>
    Object.values(s.elements).map((e) => ({ id: e.id, type: e.type }))
  )
  const selectedIds = useCanvasStore((s) => s.selectedIds)
  const setSelection = useCanvasStore((s) => s.setSelection)

  const [activeTab, setActiveTab] = useState<'layers' | 'components'>('layers')

  if (!visible) return null

  return (
    <div style={styles.sidebar} data-testid="sidebar">
      <div style={styles.tabs}>
        <button
          style={styles.tab(activeTab === 'layers')}
          onClick={() => setActiveTab('layers')}
        >
          Layers
        </button>
        <button
          style={styles.tab(activeTab === 'components')}
          onClick={() => setActiveTab('components')}
        >
          Components
        </button>
      </div>

      <div style={styles.content}>
        {activeTab === 'layers' ? (
          elementSummaries.length === 0 ? (
            <div style={styles.emptyState}>No elements on canvas</div>
          ) : (
            elementSummaries.map((el, index) => (
              <div
                key={el.id}
                style={styles.layerItem(selectedIds.includes(el.id))}
                onClick={() => setSelection([el.id])}
                data-testid={`layer-${el.id}`}
              >
                <span>Layer {index + 1}</span>
                <span style={styles.layerType}>{el.type}</span>
              </div>
            ))
          )
        ) : (
          COMPONENT_TYPES.map((comp) => (
            <div key={comp.type} style={styles.componentItem}>
              <div style={styles.componentLabel}>{comp.label}</div>
              <div style={styles.componentDesc}>{comp.description}</div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

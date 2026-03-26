/**
 * LeftPane — Collapsible side explorer panel with fuzzy search.
 * Used by Library, Results, and PromptLab.
 */
import { useState, useEffect, useCallback, useRef, createContext, useContext } from 'react'
import { PanelLeftClose, PanelLeftOpen, Search } from 'lucide-react'
import { EMBRY, label } from './EmbryStyle'

/* ── Context Menu ──────────────────────────────────────────── */

export type ContextMenuAction = 'rename' | 'delete' | 'copy'

interface ContextMenuProps {
  x: number
  y: number
  visible: boolean
  onAction: (action: ContextMenuAction) => void
  onClose: () => void
}

const menuItemBase: React.CSSProperties = {
  padding: '6px 16px',
  fontSize: 11,
  fontFamily: '"JetBrains Mono", "SF Mono", monospace',
  color: EMBRY.white,
  cursor: 'pointer',
  background: 'transparent',
  border: 'none',
  width: '100%',
  textAlign: 'left',
  transition: 'background 0.1s',
}

const MENU_ITEMS: { action: ContextMenuAction; label: string; color?: string }[] = [
  { action: 'rename', label: 'Rename' },
  { action: 'copy', label: 'Copy' },
  { action: 'delete', label: 'Delete', color: EMBRY.red },
]

export function ContextMenu({ x, y, visible, onAction, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!visible) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [visible, onClose])

  if (!visible) return null

  return (
    <div ref={ref} style={{
      position: 'fixed', left: x, top: y, zIndex: 9999,
      background: EMBRY.bgCard, border: `1px solid ${EMBRY.border}`,
      borderRadius: 6, padding: '4px 0', minWidth: 120,
      boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
    }}>
      {MENU_ITEMS.map(({ action, label: text, color }) => (
        <button key={action} style={{ ...menuItemBase, color: color ?? EMBRY.white }}
          onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          onClick={() => { onAction(action); onClose() }}>
          {text}
        </button>
      ))}
    </div>
  )
}

/** Hook for consumers to wire up context menu on pane items. */
export function useContextMenu(onContextMenu?: (itemId: string, action: ContextMenuAction) => void) {
  const [menu, setMenu] = useState<{ x: number; y: number; itemId: string } | null>(null)

  const triggerContextMenu = useCallback((e: React.MouseEvent, itemId: string) => {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY, itemId })
  }, [])

  const close = useCallback(() => setMenu(null), [])

  const menuProps: ContextMenuProps | null = menu ? {
    x: menu.x, y: menu.y, visible: true,
    onAction: (action: ContextMenuAction) => onContextMenu?.(menu.itemId, action),
    onClose: close,
  } : null

  return { menuProps, triggerContextMenu }
}

export function LeftPane({ title, children, width = 260, searchable = false }: {
  title: string
  children: React.ReactNode
  width?: number
  searchable?: boolean
}) {
  const [collapsed, setCollapsed] = useState(false)
  const [search, setSearch] = useState('')

  if (collapsed) {
    return (
      <div style={{
        width: 32, flexShrink: 0, borderRight: `1px solid ${EMBRY.border}`,
        background: EMBRY.bgPanel, display: 'flex', alignItems: 'flex-start',
        justifyContent: 'center', paddingTop: 12,
      }}>
        <button onClick={() => setCollapsed(false)} aria-label="Expand pane"
          style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', padding: 2 }}>
          <PanelLeftOpen size={14} />
        </button>
      </div>
    )
  }

  return (
    <LeftPaneContext.Provider value={search}>
      <div style={{
        width, flexShrink: 0, borderRight: `1px solid ${EMBRY.border}`,
        background: EMBRY.bgPanel, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 16px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0,
        }}>
          <div style={label}>{title}</div>
          <button onClick={() => setCollapsed(true)} aria-label="Collapse pane"
            style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', padding: 2 }}>
            <PanelLeftClose size={14} />
          </button>
        </div>
        {searchable && (
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: EMBRY.bgDeep, borderRadius: 4, border: `1px solid ${EMBRY.border}` }}>
              <Search size={12} color={EMBRY.dim} />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Filter..." aria-label={`Search ${title}`}
                style={{ flex: 1, background: 'none', border: 'none', outline: 'none', color: EMBRY.white, fontSize: 11, fontFamily: '"JetBrains Mono", monospace' }} />
            </div>
          </div>
        )}
        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
          {children}
        </div>
      </div>
    </LeftPaneContext.Provider>
  )
}

/** Context so children can read the search term */
const LeftPaneContext = createContext('')
export function useLeftPaneSearch() { return useContext(LeftPaneContext) }

/** Style for a selectable item inside LeftPane */
export function paneItemStyle(selected: boolean): React.CSSProperties {
  return {
    padding: '8px 16px', cursor: 'pointer', fontSize: 11,
    fontFamily: '"JetBrains Mono", "SF Mono", monospace',
    color: selected ? EMBRY.accent : EMBRY.dim,
    background: selected ? 'rgba(124,58,237,0.08)' : 'transparent',
    borderLeft: selected ? `3px solid ${EMBRY.accent}` : '3px solid transparent',
    transition: 'all 0.15s',
  }
}

/**
 * LeftPaneSection — A pinned section header inside LeftPane.
 * Content below scrolls independently.
 */
export function LeftPaneSection({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ ...label, padding: '10px 16px 6px', flexShrink: 0, position: 'sticky', top: 0, background: EMBRY.bgPanel, zIndex: 1 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

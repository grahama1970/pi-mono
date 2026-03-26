/**
 * ContextMenu — Shared right-click context menu for LeftPane items.
 * Used by Binary Explorer (binaries), Testing (manifests), Prompt Lab (prompts).
 */
import { useEffect, useRef } from 'react'
import { EMBRY } from './EmbryStyle'

export interface ContextMenuItem {
  label: string
  icon?: React.ReactNode
  danger?: boolean
  onClick: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const escHandler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', escHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', escHandler)
    }
  }, [onClose])

  // Adjust position to stay in viewport
  const menuWidth = 160
  const menuHeight = items.length * 32 + 8
  const adjustedX = x + menuWidth > window.innerWidth ? x - menuWidth : x
  const adjustedY = y + menuHeight > window.innerHeight ? y - menuHeight : y

  return (
    <div ref={ref} style={{
      position: 'fixed', left: adjustedX, top: adjustedY, zIndex: 99999,
      background: '#0a0a0a', border: `1px solid ${EMBRY.border}`,
      borderRadius: 4, padding: '4px 0', minWidth: menuWidth,
      boxShadow: '0 8px 32px rgba(0,0,0,0.8)',
    }}>
      {items.map((item, i) => (
        <div key={i}
          onClick={() => { item.onClick(); onClose() }}
          style={{
            padding: '6px 12px', fontSize: 11, cursor: 'pointer',
            color: item.danger ? '#ff4444' : EMBRY.white,
            display: 'flex', alignItems: 'center', gap: 8,
            transition: 'background 0.1s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = '#1a1a1a')}
          onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
          {item.icon}
          {item.label}
        </div>
      ))}
    </div>
  )
}

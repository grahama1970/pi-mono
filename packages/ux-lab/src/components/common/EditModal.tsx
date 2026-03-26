/**
 * EditModal — Modal overlay with card styling.
 * Handles backdrop click-to-close, escape key, and focus trap basics.
 */
import { useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { EMBRY, card, heading } from './EmbryStyle'

export function EditModal({ title, children, onClose, width = 640 }: {
  title: string
  children: React.ReactNode
  onClose: () => void
  width?: number
}) {
  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [handleEsc])

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}
        style={{ ...card, width, maxWidth: '90vw', maxHeight: '85vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={heading}>{title}</div>
          <button onClick={onClose} aria-label="Close"
            style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/**
 * Lightbox — Shared fullscreen preview for images and long text.
 * Click thumbnail/text → fullscreen overlay. Click overlay or Escape to close.
 * Used by: TestingPanel (screenshots, expected/actual), DesignBoard (captures), Chat (images).
 */
import { useEffect } from 'react'
import { EMBRY } from './EmbryStyle'

interface LightboxProps {
  onClose: () => void
  children: React.ReactNode
}

/** Fullscreen overlay — renders children centered. Click backdrop or Escape to close. */
export function Lightbox({ onClose, children }: LightboxProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 99998,
        background: 'rgba(0, 0, 0, 0.9)', backdropFilter: 'blur(8px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'zoom-out',
      }}
    >
      <div onClick={e => e.stopPropagation()} style={{ cursor: 'default', maxWidth: '90vw', maxHeight: '90vh', overflow: 'auto' }}>
        {children}
      </div>
    </div>
  )
}

/** Clickable image thumbnail → expands to Lightbox on click */
export function LightboxImage({ src, alt, thumbWidth = 80, thumbHeight = 60 }: {
  src: string; alt?: string; thumbWidth?: number; thumbHeight?: number
}) {
  const [open, setOpen] = __importState(false)

  return (
    <>
      <img
        src={src} alt={alt || ''}
        onClick={() => setOpen(true)}
        style={{
          width: thumbWidth, height: thumbHeight, objectFit: 'cover',
          borderRadius: 2, border: `1px solid ${EMBRY.border}`, cursor: 'zoom-in',
        }}
      />
      {open && (
        <Lightbox onClose={() => setOpen(false)}>
          <img src={src} alt={alt || ''} style={{ maxWidth: '85vw', maxHeight: '85vh', borderRadius: 4 }} />
        </Lightbox>
      )}
    </>
  )
}

/** Clickable truncated text → expands to Lightbox with full text */
export function LightboxText({ text, maxChars = 80, style }: {
  text: string; maxChars?: number; style?: React.CSSProperties
}) {
  const [open, setOpen] = __importState(false)
  const truncated = text.length > maxChars

  return (
    <>
      <span
        onClick={truncated ? () => setOpen(true) : undefined}
        title={text}
        style={{
          ...style,
          cursor: truncated ? 'zoom-in' : 'default',
          borderBottom: truncated ? '1px dotted rgba(255,255,255,0.2)' : 'none',
        }}
      >
        {truncated ? text.substring(0, maxChars) + '…' : text}
      </span>
      {open && (
        <Lightbox onClose={() => setOpen(false)}>
          <div style={{
            background: EMBRY.bgPanel, border: `1px solid ${EMBRY.border}`,
            borderRadius: 8, padding: 24, maxWidth: 600, lineHeight: 1.7,
            fontSize: 13, color: EMBRY.white, fontFamily: '"JetBrains Mono", monospace',
          }}>
            {text}
          </div>
        </Lightbox>
      )}
    </>
  )
}

// Internal useState import (avoids top-level React import conflict)
import { useState as __importState } from 'react'

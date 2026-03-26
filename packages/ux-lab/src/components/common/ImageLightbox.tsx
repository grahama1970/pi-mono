/**
 * ImageLightbox — Click-to-enlarge image modal with smooth animation.
 * Used by data tables and galleries to preview images at full size.
 */
import { useEffect, useCallback, useState } from 'react'
import { X } from 'lucide-react'
import { EMBRY } from './EmbryStyle'

export function ImageLightbox({ src, alt, onClose }: {
  src: string
  alt?: string
  onClose: () => void
}) {
  const [loaded, setLoaded] = useState(false)

  const handleEsc = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [handleEsc])

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000, cursor: 'zoom-out',
      animation: 'lightbox-fade-in 0.2s ease-out',
    }}>
      <style>{`
        @keyframes lightbox-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes lightbox-scale-in {
          from { opacity: 0; transform: scale(0.85); }
          to { opacity: 1; transform: scale(1); }
        }
      `}</style>

      {/* Close button */}
      <button onClick={onClose} aria-label="Close" style={{
        position: 'fixed', top: 16, right: 16, background: 'rgba(0,0,0,0.5)',
        border: `1px solid ${EMBRY.border}`, borderRadius: '50%',
        width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: EMBRY.white, cursor: 'pointer', zIndex: 2001,
      }}>
        <X size={18} />
      </button>

      {/* Image */}
      <div style={{
        animation: loaded ? 'lightbox-scale-in 0.25s ease-out' : 'none',
        maxWidth: '90vw', maxHeight: '90vh',
      }}>
        {!loaded && (
          <div style={{ color: EMBRY.dim, fontSize: 12, fontFamily: '"JetBrains Mono", monospace' }}>
            Loading...
          </div>
        )}
        <img src={src} alt={alt || 'Preview'} onLoad={() => setLoaded(true)}
          style={{
            maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain',
            borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            display: loaded ? 'block' : 'none', cursor: 'zoom-out',
          }} />
      </div>

      {/* Caption */}
      {alt && loaded && (
        <div style={{
          position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.7)', padding: '6px 16px', borderRadius: 6,
          fontSize: 11, color: EMBRY.dim, fontFamily: '"JetBrains Mono", monospace',
          maxWidth: '80vw', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {alt}
        </div>
      )}
    </div>
  )
}

/**
 * ImageThumb — Small clickable thumbnail that opens ImageLightbox on click.
 */
export function ImageThumb({ src, alt, size = 32 }: {
  src: string
  alt?: string
  size?: number
}) {
  const [open, setOpen] = useState(false)
  const [errored, setErrored] = useState(false)

  if (errored) {
    return (
      <div style={{
        width: size, height: size, borderRadius: 4,
        background: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 8, color: EMBRY.muted, flexShrink: 0,
      }}>
        —
      </div>
    )
  }

  return (
    <>
      <img src={src} alt={alt || ''} loading="lazy"
        onError={() => setErrored(true)}
        onClick={e => { e.stopPropagation(); setOpen(true) }}
        style={{
          width: size, height: size, objectFit: 'cover', borderRadius: 4,
          cursor: 'zoom-in', flexShrink: 0, border: `1px solid ${EMBRY.border}`,
          transition: 'border-color 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.borderColor = EMBRY.accent)}
        onMouseLeave={e => (e.currentTarget.style.borderColor = EMBRY.border)}
      />
      {open && <ImageLightbox src={src} alt={alt} onClose={() => setOpen(false)} />}
    </>
  )
}

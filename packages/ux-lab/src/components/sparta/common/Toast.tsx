/**
 * Toast — brief feedback notification (green NVIS bar, auto-dismiss).
 * Usage: const [toast, showToast] = useToast()
 *        showToast('Copied to clipboard!')
 *        {toast}
 */
import { useState, useCallback, useEffect, type ReactNode } from 'react'
import { EMBRY } from '../../common/EmbryStyle'

export function useToast(duration = 2000): [ReactNode, (msg: string) => void] {
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(null), duration)
    return () => clearTimeout(timer)
  }, [message, duration])

  const show = useCallback((msg: string) => setMessage(msg), [])

  const element = message ? (
    <div style={{
      position: 'fixed',
      bottom: 20,
      left: '50%',
      transform: 'translateX(-50%)',
      backgroundColor: EMBRY.green,
      color: '#000',
      padding: '10px 20px',
      borderRadius: 4,
      fontWeight: 700,
      fontSize: 12,
      zIndex: 3000,
      boxShadow: `0 4px 20px ${EMBRY.green}44`,
    }}>
      {message}
    </div>
  ) : null

  return [element, show]
}

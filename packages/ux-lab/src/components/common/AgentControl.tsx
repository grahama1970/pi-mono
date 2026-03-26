/**
 * AgentControl — Shared indicator showing when an agent is driving the UX.
 *
 * Place in the header of every ux-lab project view.
 * Glows when active. Click to pause/resume agent control.
 */
import { useState, useEffect, useCallback } from 'react'
import { Bot } from 'lucide-react'
import { EMBRY } from './EmbryStyle'

const API = 'http://localhost:3001/api'

const AGENT_CSS = `
@keyframes agent-pulse {
  0%, 100% { box-shadow: 0 0 6px rgba(0,255,136,0.3); }
  50% { box-shadow: 0 0 14px rgba(0,255,136,0.5); }
}
.agent-control-active { animation: agent-pulse 2.5s ease-in-out infinite; }
.agent-control-active:hover { animation: none; box-shadow: 0 0 18px rgba(0,255,136,0.6); }
`

export function AgentControl({ projectId, compact = false }: { projectId: string; compact?: boolean }) {
  const [active, setActive] = useState(false)
  const [paused, setPaused] = useState(false)

  // Poll agent status
  useEffect(() => {
    const check = () => {
      fetch(`${API}/agent-control/status?project=${projectId}`)
        .then(r => r.json())
        .then(d => { setActive(d.active ?? false); setPaused(d.paused ?? false) })
        .catch(() => {})
    }
    check()
    const interval = setInterval(check, 3000)
    return () => clearInterval(interval)
  }, [projectId])

  const togglePause = useCallback(() => {
    fetch(`${API}/agent-control/${paused ? 'resume' : 'pause'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: projectId }),
    }).then(r => r.json())
      .then(d => setPaused(d.paused ?? !paused))
      .catch(() => {})
  }, [projectId, paused])

  if (compact) {
    const dotColor = active ? (paused ? EMBRY.amber : EMBRY.green) : EMBRY.muted
    return (
      <>
        <style>{AGENT_CSS}</style>
        <button onClick={active ? togglePause : undefined}
          aria-label={active ? (paused ? 'Resume agent' : 'Pause agent') : 'Agent inactive'}
          title={active ? (paused ? 'Agent paused — click to resume' : 'Agent active — click to pause') : 'No agent connected'}
          className={active && !paused ? 'agent-control-active' : ''}
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '1px 6px', borderRadius: 3,
            cursor: active ? 'pointer' : 'default',
            background: 'transparent', border: 'none',
            color: dotColor,
            transition: 'all 0.3s',
            fontSize: 10,
          }}>
          <Bot size={12} />
        </button>
      </>
    )
  }

  return (
    <>
      <style>{AGENT_CSS}</style>
      <button onClick={active ? togglePause : undefined}
        aria-label={active ? (paused ? 'Resume agent' : 'Pause agent') : 'Agent inactive'}
        title={active ? (paused ? 'Agent paused — click to resume' : 'Agent active — click to pause') : 'No agent connected'}
        className={active && !paused ? 'agent-control-active' : ''}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 6,
          cursor: active ? 'pointer' : 'default',
          background: active ? (paused ? 'rgba(255,170,0,0.1)' : 'rgba(0,255,136,0.08)') : 'transparent',
          border: `1px solid ${active ? (paused ? EMBRY.amber + '44' : EMBRY.green + '33') : EMBRY.border}`,
          color: active ? (paused ? EMBRY.amber : EMBRY.green) : EMBRY.muted,
          transition: 'all 0.3s',
        }}>
        <Bot size={12} />
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
          {active ? (paused ? 'Paused' : 'Agent') : 'Agent'}
        </span>
        {active && !paused && (
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: EMBRY.green, flexShrink: 0 }} />
        )}
      </button>
    </>
  )
}

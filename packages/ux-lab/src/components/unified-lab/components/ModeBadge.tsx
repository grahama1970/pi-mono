import { EMBRY } from '../../sparta/common/EmbryStyle'
import type { AgentMode } from '../hooks/useLabStore'

const modeConfig: Record<AgentMode, { label: string; color: string }> = {
  'agent-driving': { label: 'Agent Driving', color: EMBRY.green },
  'human-override': { label: 'Human Override', color: EMBRY.amber },
  paused: { label: 'Paused', color: EMBRY.dim },
}

export function ModeBadge({ mode }: { mode: AgentMode }) {
  const cfg = modeConfig[mode]
  const isPulsing = mode === 'agent-driving'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 10,
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        color: cfg.color,
        padding: '3px 10px',
        borderRadius: 4,
        backgroundColor: `${cfg.color}18`,
        border: `1px solid ${cfg.color}33`,
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: cfg.color,
          boxShadow: `0 0 8px ${cfg.color}99`,
          animation: isPulsing ? 'pulse 2s ease-in-out infinite' : 'none',
        }}
      />
      {cfg.label}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </span>
  )
}

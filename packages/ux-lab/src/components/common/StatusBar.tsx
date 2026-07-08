/**
 * StatusBar — Shared VSCode-style bottom bar for all UX Lab projects.
 *
 * Shows: connection status, project context, agent control, and project-specific items.
 * Every project view should render this as the last child in its flex-column layout.
 */
import { EMBRY, glowDot } from './EmbryStyle'
import { AgentControl } from './AgentControl'

interface StatusItem {
  label: string
  value?: string
  color?: string
}

interface StatusBarProps {
  /** Project ID for agent control (e.g. 'binary-explorer', 'sparta-explorer') */
  projectId: string
  /** Connection state */
  connected?: boolean
  /** Connection label (e.g. 'daemon connected', 'memory daemon') */
  connectionLabel?: string
  /** Whether data is loading */
  loading?: boolean
  /** Error message if any */
  error?: string | null
  /** Left-side status items (project-specific context) */
  items?: StatusItem[]
  /** Right-side status items (view mode, settings, etc.) */
  rightItems?: StatusItem[]
  /** Visual density/tone */
  variant?: 'default' | 'subtle'
}

export function StatusBar({
  projectId,
  connected = true,
  connectionLabel = 'daemon connected',
  loading = false,
  error = null,
  items = [],
  rightItems = [],
  variant = 'default',
}: StatusBarProps) {
  const statusColor = loading ? EMBRY.amber : error ? EMBRY.red : connected ? EMBRY.green : EMBRY.red
  const statusText = loading ? 'loading...' : error ? 'error' : connected ? connectionLabel : 'disconnected'
  const isSubtle = variant === 'subtle'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      height: isSubtle ? 32 : 24, flexShrink: 0,
      padding: isSubtle ? '0 16px' : '0 10px',
      background: isSubtle ? '#050505' : '#1a2721',
      borderTop: isSubtle ? '1px solid rgba(255, 255, 255, 0.05)' : `1px solid ${EMBRY.border}`,
      fontSize: isSubtle ? 9 : 10, fontFamily: 'JetBrains Mono, monospace',
      color: isSubtle ? 'rgba(255, 255, 255, 0.4)' : EMBRY.dim,
      textTransform: isSubtle ? 'uppercase' : undefined,
      letterSpacing: isSubtle ? '0.12em' : undefined,
      fontWeight: isSubtle ? 800 : undefined,
    }}>
      {/* Connection status */}
      <span
        style={{ display: 'flex', alignItems: 'center', gap: 4, color: statusColor, cursor: connected ? 'default' : 'help' }}
        title={
          loading ? 'Connecting to backend services...'
          : error ? `Connection error: ${error}. Check that the daemon is running.`
          : connected ? `Connected to ${connectionLabel}`
          : 'Disconnected from backend. The WebSocket connection to localhost:7890 is down. Check that the Switchboard server is running (switchboard.sh start).'
        }
      >
        <span style={{
          width: isSubtle ? 6 : 6,
          height: isSubtle ? 6 : 6,
          borderRadius: '50%',
          background: 'currentColor',
          flexShrink: 0,
          boxShadow: isSubtle && connected ? '0 0 8px rgba(34, 197, 94, 0.6)' : undefined,
        }} />
        <span style={{ color: isSubtle ? 'rgba(255, 255, 255, 0.4)' : 'currentColor' }}>{statusText}</span>
      </span>

      {/* Left items */}
      {items.map((item, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {isSubtle ? (
            <span style={{ color: 'rgba(255, 255, 255, 0.2)' }}>|</span>
          ) : (
            <span style={{ width: 1, height: 12, background: EMBRY.border }} />
          )}
          {item.value ? (
            <span style={{ color: item.color || (isSubtle ? 'rgba(255, 255, 255, 0.4)' : EMBRY.dim) }}>
              <span style={{ color: isSubtle ? 'rgba(255, 255, 255, 0.4)' : EMBRY.muted }}>{item.label}</span> {item.value}
            </span>
          ) : (
            <span style={{ color: item.color || (isSubtle ? 'rgba(255, 255, 255, 0.4)' : EMBRY.dim) }}>{item.label}</span>
          )}
        </span>
      ))}

      {/* Spacer */}
      <span style={{ flex: 1 }} />

      {/* Right items */}
      {rightItems.map((item, i) => (
        <span key={i} style={{ color: item.color || (isSubtle ? 'rgba(255, 255, 255, 0.4)' : EMBRY.muted) }}>
          {item.label}{item.value ? `: ${item.value}` : ''}
        </span>
      ))}

      {/* Agent control — always present, with label */}
      {isSubtle ? (
        <span style={{ color: 'rgba(255, 255, 255, 0.2)' }}>|</span>
      ) : (
        <span style={{ width: 1, height: 12, background: EMBRY.border }} />
      )}
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <AgentControl projectId={projectId} compact />
        <span style={{ color: isSubtle ? 'rgba(255, 255, 255, 0.4)' : EMBRY.muted, fontSize: 9 }}>agent</span>
      </span>
    </div>
  )
}

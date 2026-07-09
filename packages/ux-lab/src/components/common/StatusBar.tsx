/**
 * StatusBar — Shared VSCode-style bottom bar for all UX Lab projects.
 *
 * Shows: connection status, project context, agent control, and project-specific items.
 * Every project view should render this as the last child in its flex-column layout.
 */
import { EMBRY } from './EmbryStyle'
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
  const subtleText = 'rgba(255, 255, 255, 0.32)'
  const subtleFaint = 'rgba(255, 255, 255, 0.16)'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      height: isSubtle ? 24 : 24, flexShrink: 0,
      padding: isSubtle ? '0 14px' : '0 10px',
      background: isSubtle ? '#030303' : '#1a2721',
      borderTop: isSubtle ? '1px solid rgba(255, 255, 255, 0.035)' : `1px solid ${EMBRY.border}`,
      fontSize: isSubtle ? 8.5 : 10, fontFamily: 'JetBrains Mono, monospace',
      color: isSubtle ? subtleText : EMBRY.dim,
      textTransform: isSubtle ? 'uppercase' : undefined,
      letterSpacing: isSubtle ? '0.14em' : undefined,
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
          width: isSubtle ? 5 : 6,
          height: isSubtle ? 5 : 6,
          borderRadius: '50%',
          background: 'currentColor',
          flexShrink: 0,
          boxShadow: isSubtle && connected ? '0 0 8px rgba(34, 197, 94, 0.6)' : undefined,
        }} />
        <span style={{ color: isSubtle ? subtleText : 'currentColor' }}>{statusText}</span>
      </span>

      {/* Left items */}
      {items.map((item, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {isSubtle ? (
            <span style={{ color: subtleFaint }}>|</span>
          ) : (
            <span style={{ width: 1, height: 12, background: EMBRY.border }} />
          )}
          {item.value ? (
            <span style={{ color: item.color || (isSubtle ? subtleText : EMBRY.dim) }}>
              <span style={{ color: isSubtle ? subtleText : EMBRY.muted }}>{item.label}</span> {item.value}
            </span>
          ) : (
            <span style={{ color: item.color || (isSubtle ? subtleText : EMBRY.dim) }}>{item.label}</span>
          )}
        </span>
      ))}

      {/* Spacer */}
      <span style={{ flex: 1 }} />

      {/* Right items */}
      {rightItems.map((item, i) => (
        <span key={i} style={{ color: item.color || (isSubtle ? subtleText : EMBRY.muted) }}>
          {item.label}{item.value ? `: ${item.value}` : ''}
        </span>
      ))}

      {/* Agent control — always present, with label */}
      {isSubtle ? (
        <span style={{ color: subtleFaint }}>|</span>
      ) : (
        <span style={{ width: 1, height: 12, background: EMBRY.border }} />
      )}
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <AgentControl projectId={projectId} compact />
        <span style={{ color: isSubtle ? subtleText : EMBRY.muted, fontSize: isSubtle ? 8 : 9 }}>agent</span>
      </span>
    </div>
  )
}

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
}

export function StatusBar({
  projectId,
  connected = true,
  connectionLabel = 'daemon connected',
  loading = false,
  error = null,
  items = [],
  rightItems = [],
}: StatusBarProps) {
  const statusColor = loading ? EMBRY.amber : error ? EMBRY.red : connected ? EMBRY.green : EMBRY.red
  const statusText = loading ? 'loading...' : error ? 'error' : connected ? connectionLabel : 'disconnected'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      height: 24, flexShrink: 0,
      padding: '0 10px',
      background: '#1a2721',
      borderTop: `1px solid ${EMBRY.border}`,
      fontSize: 10, fontFamily: 'JetBrains Mono, monospace',
      color: EMBRY.dim,
    }}>
      {/* Connection status */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: statusColor }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }} />
        {statusText}
      </span>

      {/* Left items */}
      {items.map((item, i) => (
        <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 1, height: 12, background: EMBRY.border }} />
          {item.value ? (
            <span style={{ color: item.color || EMBRY.dim }}>
              <span style={{ color: EMBRY.muted }}>{item.label}</span> {item.value}
            </span>
          ) : (
            <span style={{ color: item.color || EMBRY.dim }}>{item.label}</span>
          )}
        </span>
      ))}

      {/* Spacer */}
      <span style={{ flex: 1 }} />

      {/* Right items */}
      {rightItems.map((item, i) => (
        <span key={i} style={{ color: item.color || EMBRY.muted }}>
          {item.label}{item.value ? `: ${item.value}` : ''}
        </span>
      ))}

      {/* Agent control — always present, with label */}
      <span style={{ width: 1, height: 12, background: EMBRY.border }} />
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <AgentControl projectId={projectId} compact />
        <span style={{ color: EMBRY.muted, fontSize: 9 }}>agent</span>
      </span>
    </div>
  )
}

// ModernStatusBar.tsx — Iconic Status Bar (2026 Industrial Minimal)

import { memo } from 'react'
import { THEME } from '../../theme/industrial-minimal'
import { Wifi, WifiOff, Target, Zap, Command } from 'lucide-react'

interface ModernStatusBarProps {
  connected: boolean
  scope: string
  gateDepth: string
  counts: {
    controls: number
    qras: number
    relationships: number
  }
  onReconnect?: () => void
}

export const ModernStatusBar = memo(function ModernStatusBar({
  connected, scope, gateDepth, counts, onReconnect,
}: ModernStatusBarProps) {
  return (
    <footer
      data-qid="status:bar"
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: `${THEME.space.sm}px ${THEME.space.lg}px`,
        background: THEME.bg,
        borderTop: `1px solid ${THEME.border}`,
        fontSize: THEME.font.size.xs,
        color: THEME.textMuted,
        fontFamily: THEME.font.sans,
      }}
    >
      {/* Connection Status */}
      <ConnectionIndicator connected={connected} onReconnect={onReconnect} />

      {/* Scope + Gate */}
      <div style={{ display: 'flex', alignItems: 'center', gap: THEME.space.lg }}>
        <StatusPill icon={<Target size={12} strokeWidth={1.25} />} label={scope} />
        <StatusPill icon={<Zap size={12} strokeWidth={1.25} />} label={`gate: ${gateDepth}`} />
      </div>

      {/* Counts */}
      <div style={{ display: 'flex', gap: THEME.space.lg }}>
        <span>{counts.controls.toLocaleString()} controls</span>
        <span>{counts.qras.toLocaleString()} QRAs</span>
        <span>{counts.relationships.toLocaleString()} rels</span>
      </div>

      {/* Keyboard Shortcuts */}
      <div style={{ display: 'flex', gap: THEME.space.md, color: THEME.textDim }}>
        <Kbd keys="⌘K" label="Skills" />
        <Kbd keys="⌘F" label="Search" />
        <Kbd keys="1-9" label="Tabs" />
      </div>
    </footer>
  )
})

function ConnectionIndicator({ connected, onReconnect }: {
  connected: boolean
  onReconnect?: () => void
}) {
  const Icon = connected ? Wifi : WifiOff
  const color = connected ? THEME.status.satisfied.color : THEME.status.not_satisfied.color

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: THEME.space.sm,
        cursor: connected ? 'default' : 'pointer',
      }}
      onClick={connected ? undefined : onReconnect}
      title={connected ? 'Connected' : 'Click to reconnect'}
    >
      <div style={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: color,
        boxShadow: `0 0 8px ${color}80`,
        animation: connected ? undefined : 'blink 1s infinite',
      }} />
      <Icon size={14} strokeWidth={1.25} style={{ color }} />
      <span style={{ color }}>
        {connected ? 'Active' : 'Disconnected'}
      </span>
      {!connected && onReconnect && (
        <button
          data-qid="status:reconnect"
          onClick={onReconnect}
          style={{
            background: THEME.status.not_satisfied.color,
            color: '#fff',
            border: 'none',
            borderRadius: THEME.radius.sm,
            padding: `2px ${THEME.space.sm}px`,
            fontSize: THEME.font.size.xs,
            cursor: 'pointer',
            marginLeft: THEME.space.xs,
          }}
        >
          Reconnect
        </button>
      )}
    </div>
  )
}

function StatusPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: THEME.space.xs,
      color: THEME.textMuted,
    }}>
      {icon}
      <span>{label}</span>
    </div>
  )
}

function Kbd({ keys, label }: { keys: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: THEME.space.xs }}>
      <kbd style={{
        background: THEME.bgElevated,
        padding: `1px ${THEME.space.xs}px`,
        borderRadius: 3,
        fontSize: 10,
        fontFamily: THEME.font.mono,
        border: `1px solid ${THEME.border}`,
      }}>
        {keys}
      </kbd>
      <span>{label}</span>
    </div>
  )
}

import { useMemo, useState } from 'react'
import { RefreshCw, PanelRightOpen, PanelRightClose, PanelLeftClose, PanelLeftOpen, Copy } from 'lucide-react'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import type { RunHealth } from './runHealth'
import { copyPageForWebReview, copyStaticReviewSnapshot } from './copyPageForWebReview'

function formatAgo(ms: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  return `${min}m ago`
}

function displayRunName(runId: string): string {
  return runId.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function TransportRoomHeader({
  runId,
  onRefresh,
  loading,
  streamConnected,
  isMock,
  lastRefreshAt,
  metaOpen,
  onMetaToggle,
  sidebarCollapsed,
  onSidebarToggle,
  runHealth,
}: {
  runId: string
  onRefresh: () => void
  loading: boolean
  streamConnected: boolean
  isMock: boolean
  lastRefreshAt: number | null
  metaOpen: boolean
  onMetaToggle: () => void
  sidebarCollapsed: boolean
  onSidebarToggle: () => void
  runHealth: RunHealth
}) {
  const [copiedLive, setCopiedLive] = useState(false)
  const [copiedSnapshot, setCopiedSnapshot] = useState(false)

  useRegisterAction('transport:room:refresh', {
    app: 'ux-lab',
    action: 'TRANSPORT_ROOM_REFRESH',
    label: 'Refresh transport room',
    description: 'Reload dialog and run state',
  })

  useRegisterAction('transport:room:copy-live', {
    app: 'ux-lab',
    action: 'TRANSPORT_ROOM_COPY_LIVE',
    label: 'Copy live DOM for web review',
    description: 'Copy rendered page HTML including runtime scripts',
  })

  useRegisterAction('transport:sidebar:toggle', {
    app: 'ux-lab',
    action: 'TRANSPORT_SIDEBAR_TOGGLE',
    label: 'Toggle run history sidebar',
    description: 'Expand or collapse transport run history sidebar',
  })

  useRegisterAction('transport:meta:toggle', {
    app: 'ux-lab',
    action: 'TRANSPORT_META_TOGGLE',
    label: 'Toggle call inspector',
    description: 'Show or hide the per-call inspector drawer',
  })

  useRegisterAction('transport:room:copy-snapshot', {
    app: 'ux-lab',
    action: 'TRANSPORT_ROOM_COPY_SNAPSHOT',
    label: 'Copy static review snapshot',
    description: 'Copy HTML without Vite/client scripts for design review',
  })

  const lastLabel = useMemo(() => {
    if (!lastRefreshAt) return 'Never synced'
    return formatAgo(lastRefreshAt)
  }, [lastRefreshAt, loading])

  const statusLine = isMock ? 'Fixture mode' : runHealth.label
  const streamLabel = isMock
    ? null
    : streamConnected
      ? 'Stream live'
      : 'Stream reconnecting'

  const flash = (setter: (v: boolean) => void) => {
    setter(true)
    window.setTimeout(() => setter(false), 1600)
  }

  const handleCopyLive = async () => {
    try {
      await copyPageForWebReview(document, 'live')
      flash(setCopiedLive)
    } catch {
      setCopiedLive(false)
    }
  }

  const handleCopySnapshot = async () => {
    try {
      await copyStaticReviewSnapshot()
      flash(setCopiedSnapshot)
    } catch {
      setCopiedSnapshot(false)
    }
  }

  return (
    <header className="tr-chat-header" data-qid="transport:room:header">
      <div className="tr-collab-title">
        <div className="tr-collab-label">Collaboration</div>
        <div className="tr-collab-name">{displayRunName(runId)}</div>
        <div className="tr-collab-status">
          <span
            className={`tr-status-dot tr-status-dot--${runHealth.kind}${
              runHealth.kind === 'awaiting_human' ? ' tr-status-dot--awaiting-ack' : ''
            }${runHealth.kind === 'running' ? ' tr-status-dot--processing' : ''}${
              runHealth.kind === 'aborted' ? ' tr-status-dot--aborted' : ''
            }`}
            aria-hidden
          />
          <span>{statusLine}</span>
        </div>
      </div>

      <div className="tr-header-actions">
        <button
          type="button"
          className="tr-btn tr-btn--ghost tr-btn--icon"
          data-qid="transport:sidebar:toggle"
          data-qs-action="TRANSPORT_SIDEBAR_TOGGLE"
          title={sidebarCollapsed ? 'Expand run history' : 'Collapse run history'}
          onClick={onSidebarToggle}
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <button
          type="button"
          className="tr-btn tr-btn--ghost tr-btn--icon"
          data-qid="transport:meta:toggle"
          data-qs-action="TRANSPORT_META_TOGGLE"
          title={metaOpen ? 'Hide call inspector' : 'Show call inspector'}
          onClick={onMetaToggle}
        >
          {metaOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
        </button>
        {streamLabel && (
          <span
            className={`tr-stream-pill${streamConnected ? ' tr-stream-pill--live' : ' tr-stream-pill--reconnecting'}`}
            data-qid="transport:stream:status"
            title="Events stream replays events.jsonl then tails live"
          >
            {streamLabel}
          </span>
        )}
        <button
          type="button"
          className="tr-btn tr-btn--ghost"
          data-qid="transport:room:copy-live"
          data-qs-action="TRANSPORT_ROOM_COPY_LIVE"
          data-copied={copiedLive || undefined}
          title="Copy live DOM (includes runtime scripts)"
          onClick={() => void handleCopyLive()}
        >
          <Copy size={14} />
          {copiedLive ? 'Copied' : 'Copy live'}
        </button>
        <button
          type="button"
          className="tr-btn tr-btn--ghost"
          data-qid="transport:room:copy-snapshot"
          data-qs-action="TRANSPORT_ROOM_COPY_SNAPSHOT"
          data-copied={copiedSnapshot || undefined}
          title="Copy static snapshot without Vite/client scripts"
          onClick={() => void handleCopySnapshot()}
        >
          <Copy size={14} />
          {copiedSnapshot ? 'Copied' : 'Copy snapshot'}
        </button>
        <button
          type="button"
          className="tr-btn tr-btn--primary"
          data-qid="transport:room:refresh"
          data-qs-action="TRANSPORT_ROOM_REFRESH"
          title={`Refresh (${lastLabel})`}
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'transport-spin' : undefined} />
          Refresh
        </button>
      </div>
    </header>
  )
}

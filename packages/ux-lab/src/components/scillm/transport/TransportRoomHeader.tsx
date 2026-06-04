import { useMemo, useState } from 'react'
import { RefreshCw, PanelRightOpen, PanelRightClose, PanelLeftClose, PanelLeftOpen, Copy, Package } from 'lucide-react'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import type { RunHealth } from './runHealth'
import { copyPageForWebReview } from './copyPageForWebReview'
import { copyTransportForReview } from './transportReviewBundle'
import { runDisplayName } from './transportTime'

function formatAgo(ms: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ms) / 1000))
  if (sec < 5) return 'just now'
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  return `${min}m ago`
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
  dagNodeId,
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
  dagNodeId?: string
}) {
  const displayName = useMemo(
    () => runDisplayName({ transport_run_id: runId, dag_node_id: dagNodeId }),
    [runId, dagNodeId],
  )
  const [copiedLive, setCopiedLive] = useState(false)
  const [copyReviewState, setCopyReviewState] = useState<'idle' | 'working' | 'clipboard' | 'download' | 'error'>('idle')

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
  useRegisterAction('transport:room:copy-for-review', {
    app: 'ux-lab',
    action: 'TRANSPORT_ROOM_COPY_FOR_REVIEW',
    label: 'Copy for review',
    description: 'Screenshot + REVIEW_REQUEST + source bundle zip to clipboard or download',
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

  const lastLabel = useMemo(() => {
    if (!lastRefreshAt) return 'never synced'
    return formatAgo(lastRefreshAt)
  }, [lastRefreshAt, loading])

  const statusLine = isMock ? 'Fixture mode' : runHealth.label
  const showStreamWarning = !isMock && !streamConnected && !['completed', 'aborted'].includes(runHealth.kind)


  const handleCopyForReview = async () => {
    setCopyReviewState('working')
    try {
      const result = await copyTransportForReview({
        runId,
        pageUrl: typeof window !== 'undefined' ? window.location.href : '',
        runStatusLabel: statusLine,
        dagNodeId,
        streamConnected,
        isMock,
      })
      setDiffInBundle(result.diffCaptured)
      setCopyReviewState(result.clipboard ? 'clipboard' : 'download')
      window.setTimeout(() => { setCopyReviewState('idle'); setDiffInBundle(false) }, 2400)
    } catch {
      setCopyReviewState('error')
      window.setTimeout(() => { setCopyReviewState('idle'); setDiffInBundle(false) }, 2400)
    }
  }

  const [diffInBundle, setDiffInBundle] = useState(false)

  const copyReviewLabel = (() => {
    if (copyReviewState === 'working') return 'Building…'
    if (copyReviewState === 'clipboard') return diffInBundle ? 'Copied zip + diff' : 'Copied zip'
    if (copyReviewState === 'download') return diffInBundle ? 'Downloaded + diff' : 'Downloaded'
    if (copyReviewState === 'error') return 'Copy failed'
    return 'Copy for review'
  })()

  const handleCopyLive = async () => {
    try {
      await copyPageForWebReview(document, 'live')
      setCopiedLive(true)
      window.setTimeout(() => setCopiedLive(false), 1600)
    } catch {
      setCopiedLive(false)
    }
  }

  return (
    <header className="tr-chat-header" data-qid="transport:room:header">
      <div className="tr-collab-title">
        <div className="tr-collab-label">Collaboration</div>
        <div className="tr-collab-name">{displayName}</div>
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
          <span className="tr-collab-status__meta">· synced {lastLabel}</span>
          {showStreamWarning && (
            <span className="tr-stream-pill tr-stream-pill--reconnecting" data-qid="transport:stream:status">
              Reconnecting stream
            </span>
          )}
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
        <button
          type="button"
          className={`tr-btn tr-btn--ghost tr-btn--copy-live${copiedLive ? ' tr-btn--copied' : ''}`}
          data-qid="transport:room:copy-live"
          data-qs-action="TRANSPORT_ROOM_COPY_LIVE"
          data-copied={copiedLive || undefined}
          title="Copy live DOM for design review (includes runtime scripts)"
          onClick={() => void handleCopyLive()}
        >
          <Copy size={14} />
          {copiedLive ? 'Copied' : 'Copy live'}
        </button>
        <button
          type="button"
          className={`tr-btn tr-btn--ghost tr-btn--copy-review${copyReviewState !== 'idle' ? ' tr-btn--copied' : ''}`}
          data-qid="transport:room:copy-for-review"
          data-qs-action="TRANSPORT_ROOM_COPY_FOR_REVIEW"
          data-copied={copyReviewState === 'clipboard' || copyReviewState === 'download' || undefined}
          title="Screenshot + REVIEW_REQUEST.md + source bundle zip (Gemini, ChatGPT, UX Pilot)"
          disabled={copyReviewState === 'working'}
          onClick={() => void handleCopyForReview()}
        >
          <Package size={14} />
          {copyReviewLabel}
        </button>

        <button
          type="button"
          className="tr-btn tr-btn--primary tr-btn--icon-label"
          data-qid="transport:room:refresh"
          data-qs-action="TRANSPORT_ROOM_REFRESH"
          title={`Refresh · ${lastLabel}`}
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw size={14} className={loading ? 'transport-spin' : undefined} />
          <span className="tr-btn__label">Refresh</span>
        </button>
      </div>
    </header>
  )
}

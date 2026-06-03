import { useState, type ReactNode } from 'react'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import type { TransportDialogResponse, TransportRunResponse, TransportStreamEvent } from './types'
import type { RunHealth } from './runHealth'
import type { RunStatusKind } from './messageParse'

function DrawerSection({
  title,
  defaultOpen = true,
  children,
  qid,
  highlight,
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
  qid?: string
  highlight?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div
      className={`tr-drawer-section${highlight ? ' tr-drawer-section--highlight' : ''}${open ? '' : ' tr-drawer-section--collapsed'}`}
      data-qid={qid}
    >
      <button
        type="button"
        className="tr-drawer-section__toggle"
        data-qid={qid ? `${qid}:toggle` : 'transport:meta:section:toggle'}
        data-qs-action="TRANSPORT_META_SECTION_TOGGLE"
        title={open ? `Collapse ${title}` : `Expand ${title}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight size={14} className={open ? 'tr-drawer-section__chev--open' : undefined} aria-hidden />
        <span className="tr-drawer-section-title">{title}</span>
      </button>
      {open && <div className="tr-drawer-section__body">{children}</div>}
    </div>
  )
}

function MicroDag({
  activeStep,
  onReviewerClick,
  onWorkerClick,
}: {
  activeStep: 'reviewer' | 'worker' | 'done'
  onReviewerClick?: () => void
  onWorkerClick?: () => void
}) {
  const workerLabel =
    activeStep === 'done' ? 'Completed' : activeStep === 'worker' ? 'Active' : 'Pending'
  return (
    <div className="tr-micro-dag" data-qid="transport:meta:dag-preview" aria-label="Project agent spawn to subagent runtime">
      <div className="tr-dag-node">
        <button
          type="button"
          className="tr-dag-node-box tr-dag-node-box--completed tr-dag-node-box--clickable"
          data-qid="transport:meta:dag-reviewer"
          data-qs-action="TRANSPORT_META_JUMP_REVIEWER"
          title="Jump to project agent spawn"
          onClick={onReviewerClick}
        >
          Project agent
        </button>
        <div className="tr-dag-label">Completed</div>
      </div>
      <span className="tr-dag-arrow" aria-hidden>→</span>
      <div className="tr-dag-node">
        <button
          type="button"
          className={`tr-dag-node-box tr-dag-node-box--clickable${activeStep === 'worker' ? ' tr-dag-node-box--active' : activeStep === 'done' ? ' tr-dag-node-box--completed' : ''}`}
          data-qid="transport:meta:dag-worker"
          data-qs-action="TRANSPORT_META_JUMP_WORKER"
          title="Jump to worker execution"
          onClick={onWorkerClick}
        >
          scillm-worker
        </button>
        <div className="tr-dag-label">{workerLabel}</div>
      </div>
    </div>
  )
}

const STATUS_RING: Record<RunStatusKind, string> = {
  awaiting_human: '⏳',
  running: '⚙️',
  completed: '✓',
  idle: '●',
  offline: '○',
  aborted: '✕',
}

export function TransportMetaRail({
  runHealth,
  runState,
  dialog,
  observation,
  events,
  workerUrl,
  runId,
  onJumpToReviewer,
  onJumpToWorker,
}: {
  runHealth: RunHealth
  runState: TransportRunResponse | null
  dialog: TransportDialogResponse | null
  observation: TransportDialogResponse['observation'] | undefined
  events: TransportStreamEvent[]
  workerUrl: string
  runId: string
  onJumpToReviewer?: () => void
  onJumpToWorker?: () => void
}) {
  useRegisterAction('transport:meta:section', {
    app: 'ux-lab',
    action: 'TRANSPORT_META_SECTION_TOGGLE',
    label: 'Toggle meta drawer section',
    description: 'Expand or collapse a section in the legacy meta drawer',
  })

  useRegisterAction('transport:meta:dag-reviewer', {
    app: 'ux-lab',
    action: 'TRANSPORT_META_JUMP_REVIEWER',
    label: 'Jump to project agent spawn in timeline',
    description: 'Scroll timeline to spawn card',
  })

  useRegisterAction('transport:meta:dag-worker', {
    app: 'ux-lab',
    action: 'TRANSPORT_META_JUMP_WORKER',
    label: 'Jump to worker in timeline',
    description: 'Scroll timeline to worker execution',
  })

  useRegisterAction('transport:link:worker', {
    app: 'ux-lab',
    action: 'TRANSPORT_ROOM_OPEN_WORKER',
    label: 'Open worker trace',
    description: 'Open OpenCode worker session',
  })

  const activeChild =
    dialog?.active_subagent
    ?? runState?.state?.children?.find((c) => c.active)
    ?? runState?.state?.children?.slice(-1)[0]
  const pending = dialog?.pending_human ?? []
  const { kind: statusKind, label: statusLabel, sublabel, nextAction } = runHealth

  const dagStep: 'reviewer' | 'worker' | 'done' =
    statusKind === 'completed' || statusKind === 'aborted'
      ? 'done'
      : statusKind === 'running'
        ? 'worker'
        : 'reviewer'

  const startedAt = runState?.state?.started_at
    ? new Date(runState.state.started_at).toLocaleTimeString()
    : '—'

  return (
    <aside className="tr-right-drawer" data-qid="transport:room:meta">
      <div className={`tr-status-hero tr-status-hero--${statusKind}`} data-qid="transport:meta:status-hero">
        <div className={`tr-status-ring${statusKind === 'awaiting_human' || statusKind === 'running' ? ' tr-status-ring--spin' : ''}`}>
          <div className="tr-status-ring-inner">{STATUS_RING[statusKind]}</div>
        </div>
        <div className="tr-status-label">{statusLabel}</div>
        {sublabel && <div className="tr-status-sublabel">{sublabel}</div>}
        {nextAction && <div className="tr-status-next">{nextAction}</div>}
      </div>

      <div className="tr-drawer-section tr-drawer-section--primary" data-qid="transport:meta:worker-trace">
        <div className="tr-drawer-section-title">Worker trace</div>
        {workerUrl ? (
          <a
            href={workerUrl}
            target="_blank"
            rel="noreferrer"
            className="tr-trace-link tr-trace-link--primary"
            data-qid="transport:link:worker"
            data-qs-action="TRANSPORT_ROOM_OPEN_WORKER"
            title="Open OpenCode worker trace in a new tab"
          >
            <ExternalLink size={14} aria-hidden />
            Open worker trace
          </a>
        ) : (
          <p className="tr-drawer-empty">No worker session linked</p>
        )}
        <p className="tr-drawer-hint">Tools and reasoning live in OpenCode.</p>
      </div>

      <DrawerSection title="Run details" defaultOpen={false} qid="transport:meta:run-details">
        <div className="tr-info-row">
          <span className="tr-info-label">Run ID</span>
          <span className="tr-info-value tr-mono">{runId}</span>
        </div>
        <div className="tr-info-row">
          <span className="tr-info-label">DAG</span>
          <span className="tr-info-value tr-mono">{runState?.state?.dag_node_id ?? '—'}</span>
        </div>
        <div className="tr-info-row">
          <span className="tr-info-label">Model</span>
          <span className="tr-info-value"><span className="tr-chip">{observation?.parent_ui_model ?? 'gpt-5.5'}</span></span>
        </div>
        <div className="tr-info-row">
          <span className="tr-info-label">Subagent</span>
          <span className="tr-info-value">{activeChild?.subagent_kind ?? '—'}</span>
        </div>
        <div className="tr-info-row">
          <span className="tr-info-label">Runtime</span>
          <span className="tr-info-value">
            <span className="tr-chip tr-chip--worker">{activeChild?.agent ?? 'scillm-worker'}</span>
          </span>
        </div>
        {(activeChild?.skills_materialized?.length || activeChild?.skills?.length) ? (
          <div className="tr-info-row">
            <span className="tr-info-label">Skills</span>
            <span className="tr-info-value tr-info-value--wrap">
              {(activeChild.skills_materialized ?? activeChild.skills ?? []).map((s) => (
                <span key={s} className="tr-chip tr-chip--skill">/{s}</span>
              ))}
            </span>
          </div>
        ) : null}
        <div className="tr-info-row">
          <span className="tr-info-label">Started</span>
          <span className="tr-info-value">{startedAt}</span>
        </div>
      </DrawerSection>

      {pending.length > 0 && (
        <DrawerSection
          title="Pending from parent session"
          defaultOpen
          highlight
          qid="transport:meta:pending"
        >
          {pending.map((t) => (
            <p key={t.message_id} className="tr-pending-snippet" data-qid={`transport:pending:${t.message_id}`}>
              {t.text.slice(0, 160)}
            </p>
          ))}
        </DrawerSection>
      )}

      <DrawerSection title="Execution flow" defaultOpen={false} qid="transport:meta:execution-flow">
        <MicroDag activeStep={dagStep} onReviewerClick={onJumpToReviewer} onWorkerClick={onJumpToWorker} />
      </DrawerSection>

      <DrawerSection title="Event timeline" defaultOpen={false} qid="transport:meta:events">
        {events.length === 0 ? (
          <p className="tr-drawer-empty">{runHealth.eventTailMessage}</p>
        ) : (
          <div className="tr-event-timeline">
            {events.slice().reverse().slice(0, 12).map((ev, idx) => (
              <div key={`${ev.event_type}-${idx}-${ev.ts ?? idx}`} className="tr-timeline-item" data-qid={`transport:event:${idx}`}>
                <span className={`tr-timeline-tick${idx === 0 ? ' tr-timeline-tick--active' : ' tr-timeline-tick--completed'}`} aria-hidden />
                <div className="tr-timeline-content">
                  <div>{ev.event_type || 'event'}</div>
                  {ev.ts && <div className="tr-timeline-time">{new Date(ev.ts).toLocaleTimeString()}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
      </DrawerSection>
    </aside>
  )
}

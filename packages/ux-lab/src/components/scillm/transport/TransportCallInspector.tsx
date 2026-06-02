import { useState, type ReactNode } from 'react'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import type { CallInspectorView } from './callInspector'
import { callDeliveryBadge } from './callInspector'
import type { RunHealth } from './runHealth'

function DrawerSection({
  title,
  defaultOpen = true,
  children,
  qid,
}: {
  title: string
  defaultOpen?: boolean
  children: ReactNode
  qid?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const toggleQid = qid ? `${qid}:toggle` : 'transport:call-inspector:section:toggle'
  const toggleTitle = open ? `Collapse ${title}` : `Expand ${title}`
  return (
    <div
      className={`tr-drawer-section${open ? '' : ' tr-drawer-section--collapsed'}`}
      data-qid={qid}
    >
      <button
        type="button"
        className="tr-drawer-section__toggle"
        data-qid={toggleQid}
        data-qs-action="TRANSPORT_CALL_INSPECTOR_SECTION_TOGGLE"
        title={toggleTitle}
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

function formatEventTime(ts: unknown): string {
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    const ms = ts > 1e12 ? ts : ts * 1000
    return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
  }
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts)
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
    }
  }
  return '—'
}

export function TransportCallInspector({
  inspector,
  runHealth,
  workerUrl,
  runId,
  streamConnected,
  isMock,
}: {
  inspector: CallInspectorView | null
  runHealth: RunHealth
  workerUrl: string
  runId: string
  streamConnected: boolean
  isMock: boolean
}) {
  useRegisterAction('transport:link:worker', {
    app: 'ux-lab',
    action: 'TRANSPORT_ROOM_OPEN_WORKER',
    label: 'Open worker trace',
    description: 'Open OpenCode worker session for selected call',
  })

  useRegisterAction('transport:call-inspector:section', {
    app: 'ux-lab',
    action: 'TRANSPORT_CALL_INSPECTOR_SECTION_TOGGLE',
    label: 'Toggle call inspector section',
    description: 'Expand or collapse a section in the call inspector drawer',
  })

  const call = inspector?.call
  const delivery = callDeliveryBadge(call?.delivery_state)

  return (
    <aside className="tr-right-drawer tr-call-inspector" data-qid="transport:room:call-inspector">
      <div className="tr-call-inspector__header" data-qid="transport:call-inspector:header">
        <div className="tr-call-inspector__eyebrow">Call inspector</div>
        <div className="tr-call-inspector__title">
          {call ? (call.subagent_label || call.subagent_kind || call.role || 'Worker call') : 'No child calls yet'}
        </div>
        <div className="tr-call-inspector__run-meta">
          <span className="tr-mono">{runId}</span>
          <span className="tr-call-inspector__sep">·</span>
          <span>{isMock ? 'Fixture' : streamConnected ? 'SSE replay + live' : 'SSE reconnecting'}</span>
        </div>
      </div>

      {!call ? (
        <p className="tr-drawer-empty" data-qid="transport:call-inspector:empty">
          Spawn a worker from the timeline to inspect model, prompt context, and per-call events here.
        </p>
      ) : (
        <>
          <DrawerSection title="Identity" defaultOpen qid="transport:call-inspector:identity">
            <div className="tr-info-row">
              <span className="tr-info-label">subagent_run_id</span>
              <span className="tr-info-value tr-mono">{call.subagent_run_id}</span>
            </div>
            {call.child_session_id && (
              <div className="tr-info-row">
                <span className="tr-info-label">child session</span>
                <span className="tr-info-value tr-mono">{call.child_session_id}</span>
              </div>
            )}
            <div className="tr-info-row">
              <span className="tr-info-label">Agent</span>
              <span className="tr-info-value"><span className="tr-chip tr-chip--worker">{call.agent ?? '—'}</span></span>
            </div>
            <div className="tr-info-row">
              <span className="tr-info-label">Role</span>
              <span className="tr-info-value">{call.subagent_kind ?? call.role ?? '—'}</span>
            </div>
            {call.mode && (
              <div className="tr-info-row">
                <span className="tr-info-label">Mode</span>
                <span className="tr-info-value">{call.mode}</span>
              </div>
            )}
            <div className="tr-info-row">
              <span className="tr-info-label">Delivery</span>
              <span className="tr-info-value"><span className="tr-chip">{delivery}</span></span>
            </div>
            {call.skills?.length ? (
              <div className="tr-info-row">
                <span className="tr-info-label">Skills</span>
                <span className="tr-info-value tr-info-value--wrap">
                  {call.skills.map((s) => (
                    <span key={s} className="tr-chip tr-chip--skill">/{s}</span>
                  ))}
                </span>
              </div>
            ) : null}
          </DrawerSection>

          <DrawerSection title="Invocation" defaultOpen qid="transport:call-inspector:invocation">
            <div className="tr-info-row">
              <span className="tr-info-label">Model</span>
              <span className="tr-info-value"><span className="tr-chip">{inspector?.model ?? '—'}</span></span>
            </div>
            {inspector?.parentModel && inspector.parentModel !== inspector.model && (
              <div className="tr-info-row">
                <span className="tr-info-label">Parent UI</span>
                <span className="tr-info-value"><span className="tr-chip">{inspector.parentModel}</span></span>
              </div>
            )}
            <div className="tr-info-row tr-info-row--stack">
              <span className="tr-info-label">Prompt context</span>
              {inspector?.promptSnippet ? (
                <pre className="tr-call-prompt" data-qid="transport:call-inspector:prompt">
                  {inspector.promptSnippet}
                </pre>
              ) : (
                <p className="tr-drawer-empty">
                  Prompt not persisted in events.jsonl for this attempt. Use the timeline and worker trace.
                </p>
              )}
              {inspector?.promptSource && inspector.promptSource !== 'none' && (
                <p className="tr-drawer-hint">Source: {inspector.promptSource === 'event' ? 'stream event' : 'dialog turn'}</p>
              )}
            </div>
          </DrawerSection>

          <div className="tr-drawer-section tr-drawer-section--primary" data-qid="transport:call-inspector:worker-trace">
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
                Open OpenCode worker trace
              </a>
            ) : (
              <p className="tr-drawer-empty">No worker session linked for this run</p>
            )}
            <p className="tr-drawer-hint">Full tool and reasoning trace lives in OpenCode (run-level URL today).</p>
          </div>

          <DrawerSection
            title={`Call events (${inspector?.eventCount ?? 0})`}
            defaultOpen
            qid="transport:call-inspector:events"
          >
            {!inspector?.events.length ? (
              <p className="tr-drawer-empty">{runHealth.eventTailMessage}</p>
            ) : (
              <div className="tr-event-timeline tr-event-timeline--chronological">
                {inspector.events.map((ev, idx) => (
                  <div
                    key={`${ev.event_type}-${ev.event_id ?? idx}-${ev.ts ?? idx}`}
                    className="tr-timeline-item"
                    data-qid={`transport:call-event:${idx}`}
                  >
                    <span
                      className={`tr-timeline-tick${idx === inspector.events.length - 1 ? ' tr-timeline-tick--active' : ' tr-timeline-tick--completed'}`}
                      aria-hidden
                    />
                    <div className="tr-timeline-content">
                      <div className="tr-timeline-event-type">{ev.event_type || 'event'}</div>
                      <div className="tr-timeline-meta">
                        {ev.delivery_state && <span>{String(ev.delivery_state)}</span>}
                        {ev.model && <span className="tr-chip">{String(ev.model)}</span>}
                        <span className="tr-timeline-time">{formatEventTime(ev.ts)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </DrawerSection>
        </>
      )}
    </aside>
  )
}

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ChevronRight, Copy, ExternalLink } from 'lucide-react'
import { roleVisualForSubagentPersona } from './subagentPersonaIcons'
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
    <section
      className={`tr-inspector-panel tr-drawer-section${open ? '' : ' tr-drawer-section--collapsed'}`}
      data-qid={qid}
    >
      <button
        type="button"
        className="tr-drawer-section__toggle tr-inspector-panel__toggle"
        data-qid={toggleQid}
        data-qs-action="TRANSPORT_CALL_INSPECTOR_SECTION_TOGGLE"
        title={toggleTitle}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight size={14} className={open ? 'tr-drawer-section__chev--open' : undefined} aria-hidden />
        <span className="tr-inspector-panel__title">{title}</span>
      </button>
      {open && <div className="tr-drawer-section__body tr-inspector-panel__body">{children}</div>}
    </section>
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

function deliveryTone(state?: string): string {
  const ds = (state || '').toLowerCase()
  if (ds === 'completed' || ds === 'done') return 'tr-inspector-stat--ok'
  if (ds === 'running' || ds === 'in_progress' || ds === 'posted') return 'tr-inspector-stat--active'
  if (ds === 'failed' || ds === 'error' || ds === 'aborted') return 'tr-inspector-stat--fail'
  return ''
}

const PROMPT_PREVIEW_LINES = 6

function PromptSnippet({ text, expanded, onToggle }: { text: string; expanded: boolean; onToggle: () => void }) {
  const lines = text.split('\n')
  const needsClamp = lines.length > PROMPT_PREVIEW_LINES && !expanded
  return (
    <div className={`tr-call-prompt${needsClamp ? ' tr-call-prompt--clamped' : ''}`}>
      {lines.map((line, i) => {
        const heading = line.match(/^#{1,3}\s+(.+)$/)
        if (heading) {
          return (
            <p key={i} className="tr-call-prompt__heading">
              {heading[1]}
            </p>
          )
        }
        const parts = line.split(/(\*\*[^*]+\*\*)/g)
        return (
          <p key={i} className="tr-call-prompt__line">
            {parts.map((part, j) =>
              part.startsWith('**') && part.endsWith('**') ? (
                <strong key={j}>{part.slice(2, -2)}</strong>
              ) : (
                <span key={j}>{part || '\u00a0'}</span>
              ),
            )}
          </p>
        )
      })}
      {lines.length > PROMPT_PREVIEW_LINES && (
        <button type="button" className="tr-call-prompt__more" onClick={onToggle}>
          {expanded ? 'Show less' : 'Show full prompt'}
        </button>
      )}
    </div>
  )
}

function CopyPromptButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }, [text])

  return (
    <button
      type="button"
      className={`tr-inspector-copy${copied ? ' tr-inspector-copy--done' : ''}`}
      data-qid="transport:call-inspector:copy-prompt"
      data-qs-action="TRANSPORT_CALL_INSPECTOR_COPY_PROMPT"
      title="Copy full prompt payload to clipboard"
      onClick={() => void copy()}
    >
      <Copy size={14} aria-hidden />
      {copied ? 'Copied' : 'Copy prompt'}
    </button>
  )
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="tr-info-row">
      <span className="tr-info-label">{label}</span>
      <div className="tr-info-value">{children}</div>
    </div>
  )
}

function EvidenceStat({ label, value, tone }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className={`tr-inspector-stat${tone ? ` ${tone}` : ''}`}>
      <span className="tr-inspector-stat__label">{label}</span>
      <span className="tr-inspector-stat__value">{value}</span>
    </div>
  )
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

  useRegisterAction('transport:call-inspector:copy-prompt', {
    app: 'ux-lab',
    action: 'TRANSPORT_CALL_INSPECTOR_COPY_PROMPT',
    label: 'Copy call prompt payload',
    description: 'Copy the full worker prompt for the selected call',
  })

  const [promptExpanded, setPromptExpanded] = useState(false)
  const call = inspector?.call
  const delivery = callDeliveryBadge(call?.delivery_state)
  const deliveryClass = deliveryTone(call?.delivery_state)
  const persona = call?.subagent_kind?.trim() || 'Subagent'
  const personaVisual = roleVisualForSubagentPersona(persona, call?.role)
  const PersonaIcon = personaVisual.Icon
  const promptPayload = inspector?.promptPayload ?? inspector?.promptSnippet

  useEffect(() => {
    setPromptExpanded(false)
  }, [call?.subagent_run_id, inspector?.focusMessageId])

  return (
    <aside className="tr-right-drawer tr-call-inspector" data-qid="transport:room:call-inspector">
      <header className="tr-call-inspector__header tr-call-inspector__sticky-summary" data-qid="transport:call-inspector:header">
        <p className="tr-call-inspector__eyebrow">
          {inspector?.focusMessageId ? 'Thread selection' : 'Call inspector'}
        </p>
        <h2 className="tr-call-inspector__title">
          {call ? (
            <>
              <span className="tr-call-inspector__role">
              <PersonaIcon size={16} strokeWidth={1.75} aria-hidden style={{ marginRight: 6, verticalAlign: 'middle' }} />
              Subagent · {persona}
            </span>
              <span className="tr-call-inspector__title-sep" aria-hidden>
                ·
              </span>
              <span className="tr-call-inspector__agent">Runtime · {call.agent ?? 'scillm-worker'}</span>
            </>
          ) : (
            'No child calls yet'
          )}
        </h2>
        {call && (
          <div className="tr-call-inspector__badge-row" aria-label="Call identity badges">
            <span className="tr-chip tr-chip--worker">{call.agent ?? 'worker'}</span>
            <span
              className={`tr-chip tr-chip--delivery${
                deliveryClass === 'tr-inspector-stat--ok'
                  ? ' tr-chip--ok'
                  : deliveryClass === 'tr-inspector-stat--active'
                    ? ' tr-chip--active'
                    : deliveryClass === 'tr-inspector-stat--fail'
                      ? ' tr-chip--fail'
                      : ''
              }`}
            >
              {delivery}
            </span>
            {inspector?.model && <span className="tr-chip tr-chip--model">{inspector.model}</span>}
            {call.mode && <span className="tr-chip tr-chip--muted">{call.mode}</span>}
          </div>
        )}
        <p className="tr-call-inspector__run-meta">
          <code className="tr-call-inspector__run-id">{call?.subagent_run_id ?? runId}</code>
          <span className="tr-call-inspector__sep" aria-hidden>
            ·
          </span>
          <span>{isMock ? 'Fixture data' : streamConnected ? 'SSE replay + live' : 'SSE reconnecting'}</span>
        </p>
      </header>

      <div className="tr-call-inspector__body">
        {!call ? (
          <p className="tr-drawer-empty tr-call-inspector__empty" data-qid="transport:call-inspector:empty">
            Spawn a worker from the collaboration thread to inspect model, persona, duration, prompt payload, and stream events here.
          </p>
        ) : (
          <>
            <section className="tr-inspector-panel tr-inspector-panel--basics" data-qid="transport:call-inspector:basics">
              <h3 className="tr-inspector-panel__title tr-inspector-panel__title--static">Call basics</h3>
              <div className="tr-inspector-panel__body">
                <div className="tr-call-inspector__evidence-grid tr-call-inspector__evidence-grid--basics">
                  <EvidenceStat label="Model" value={inspector?.model ?? '—'} />
                  <EvidenceStat
                    label="Person / persona"
                    value={
                      <span className="tr-inspector-persona">
                        <span>{inspector?.personaLabel ?? roleLabel}</span>
                        {inspector?.personaAgent && inspector.personaAgent !== inspector?.personaLabel ? (
                          <code className="tr-inspector-persona__agent">{inspector.personaAgent}</code>
                        ) : null}
                      </span>
                    }
                  />
                  <EvidenceStat
                    label="Duration"
                    value={inspector?.durationLabel ?? (call.active ? 'In progress' : '—')}
                    tone={
                      inspector?.durationLabel
                        ? 'tr-inspector-stat--ok'
                        : call.active
                          ? 'tr-inspector-stat--active'
                          : undefined
                    }
                  />
                  <EvidenceStat
                    label="Stream events"
                    value={
                      <>
                        {inspector?.eventCount ?? 0}
                        {inspector && inspector.rawEventCount > inspector.eventCount ? (
                          <span className="tr-call-inspector__stat-sub"> / {inspector.rawEventCount} raw</span>
                        ) : null}
                      </>
                    }
                  />
                </div>
              </div>
            </section>

            <DrawerSection title="Prompt payload" defaultOpen qid="transport:call-inspector:prompt">
              <div className="tr-call-prompt-block">
                <div className="tr-call-prompt-block__head">
                  <div className="tr-call-prompt-block__head-text">
                    <span className="tr-call-prompt-block__label">Full prompt sent to the worker</span>
                    {inspector?.promptSource && inspector.promptSource !== 'none' && (
                      <span className="tr-call-prompt-block__source">
                        {inspector.promptSource === 'event' ? 'Stream event' : 'Dialog transcript'}
                      </span>
                    )}
                  </div>
                  {promptPayload ? <CopyPromptButton text={promptPayload} /> : null}
                </div>
                {promptPayload ? (
                  <PromptSnippet text={promptPayload} expanded={promptExpanded} onToggle={() => setPromptExpanded((v) => !v)} />
                ) : (
                  <p className="tr-drawer-empty tr-call-prompt-block__empty">
                    Prompt not persisted for this call yet. Check the collaboration dispatch message or OpenCode worker trace.
                  </p>
                )}
                {inspector?.promptTruncated ? (
                  <p className="tr-drawer-hint">Showing full recovered payload (may differ from live stream if replay is partial).</p>
                ) : null}
              </div>
            </DrawerSection>

            <DrawerSection title="Identity" defaultOpen={false} qid="transport:call-inspector:identity">
              <div className="tr-inspector-kv-grid">
                <InfoRow label="Call id">
                  <code className="tr-inspector-code">{call.subagent_run_id}</code>
                </InfoRow>
                {call.child_session_id && (
                  <InfoRow label="Child session">
                    <code className="tr-inspector-code">{call.child_session_id}</code>
                  </InfoRow>
                )}
                {call.attempt_id != null && <InfoRow label="Attempt">{call.attempt_id}</InfoRow>}
                {call.skills?.length ? (
                  <InfoRow label="Skills">
                    <span className="tr-info-value--wrap">
                      {call.skills.map((s) => (
                        <span key={s} className="tr-chip tr-chip--skill">
                          /{s}
                        </span>
                      ))}
                    </span>
                  </InfoRow>
                ) : null}
              </div>
            </DrawerSection>


            <DrawerSection
              title={`Stream receipt (${inspector?.eventCount ?? 0}${inspector && inspector.rawEventCount > inspector.eventCount ? ` · ${inspector.rawEventCount} raw` : ''})`}
              defaultOpen={false}
              qid="transport:call-inspector:events"
            >
              {!inspector?.events.length ? (
                <p className="tr-drawer-empty">{runHealth.eventTailMessage}</p>
              ) : (
                <div className="tr-event-timeline tr-event-timeline--chronological tr-call-inspector__timeline">
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
      </div>
    </aside>
  )
}

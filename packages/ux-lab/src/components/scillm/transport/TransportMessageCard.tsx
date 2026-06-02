import { useMemo, useState, type ReactNode } from 'react'
import { Bot, ChevronRight, Copy, ExternalLink, Handshake, Layers, Terminal, User } from 'lucide-react'
import type { DisplayMessage } from './messageParse'
import {
  cardContractFor,
  shouldCollapseByDefault,
  summarizeMessage,
  type CardIconKind,
} from './messageCardContract'
import { MetadataPills } from './MetadataPills'
import { TransportSkillChips } from './skillSyntax'
import type { Skill } from '../../shared-chat/types'
import { useRegisterAction } from '../../../hooks/useRegisterAction'

function CardTypeIcon({ icon }: { icon: CardIconKind }) {
  const size = 16
  const stroke = 1.75
  switch (icon) {
    case 'human':
      return <User size={size} strokeWidth={stroke} aria-hidden />
    case 'worker':
      return <Layers size={size} strokeWidth={stroke} aria-hidden />
    case 'skill':
      return <Terminal size={size} strokeWidth={stroke} aria-hidden />
    case 'system':
      return <Bot size={size} strokeWidth={stroke} aria-hidden />
    case 'handoff':
    default:
      return <Handshake size={size} strokeWidth={stroke} aria-hidden />
  }
}

function CardTypeHeader({
  message,
  metaLine,
}: {
  message: DisplayMessage
  metaLine?: string
}) {
  const contract = cardContractFor(message)
  return (
    <div className={`tr-card-type-header tr-card-type-header--${contract.roleClass}`}>
      <div className={`tr-card-type-header__icon tr-card-type-header__icon--${contract.icon}`} aria-hidden>
        <CardTypeIcon icon={contract.icon} />
      </div>
      <div className="tr-card-type-header__text">
        <div className="tr-card-type-header__row">
          <span className="tr-card-type-header__title">{contract.headerTitle}</span>
          {contract.roleLabel !== contract.headerTitle ? (
            <span className="tr-card-type-header__role">{contract.roleLabel}</span>
          ) : null}
          <span className="tr-card-type-header__phase">{contract.phaseLabel}</span>
        </div>
        {metaLine && <div className="tr-card-type-header__meta">{metaLine}</div>}
      </div>
    </div>
  )
}

function ProseBlock({ text, skills }: { text: string; skills?: Skill[] }) {
  if (!text.trim()) return null
  return (
    <>
      <div className="tr-message-bubble__prose">
        {text.split('\n').map((line, i) => (
          <p key={i}>{line || '\u00a0'}</p>
        ))}
      </div>
      <TransportSkillChips text={text} catalog={skills} />
    </>
  )
}

function CardActions({
  messageId,
  summary,
  expanded,
  onToggle,
  workerUrl,
  expandLabel,
  collapseLabel,
}: {
  messageId: string
  summary: string
  expanded: boolean
  onToggle: () => void
  workerUrl?: string
  expandLabel: string
  collapseLabel?: string
}) {
  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summary)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="tr-card-actions" data-qid="transport:card:actions">
      {workerUrl && (
        <a
          href={workerUrl}
          target="_blank"
          rel="noreferrer"
          className="tr-card-action tr-card-action--link"
          data-qid="transport:card:open-trace"
          data-qs-action="TRANSPORT_ROOM_OPEN_WORKER"
          title="Open OpenCode worker trace in a new tab"
        >
          <ExternalLink size={12} aria-hidden />
          Open worker trace
        </a>
      )}
      <button
        type="button"
        className="tr-card-action"
        data-qid={`transport:card:${messageId}:toggle`}
        data-qs-action="TRANSPORT_CARD_TOGGLE_DETAILS"
        title={expanded ? (collapseLabel ?? 'Hide details') : expandLabel}
        onClick={() => void onToggle()}
      >
        <ChevronRight size={12} className={expanded ? 'tr-card-action__chev--open' : undefined} aria-hidden />
        {expanded ? (collapseLabel ?? 'Hide details') : expandLabel}
      </button>
      <button
        type="button"
        className="tr-card-action"
        data-qid={`transport:card:${messageId}:copy`}
        data-qs-action="TRANSPORT_CARD_COPY_SUMMARY"
        title="Copy message summary to clipboard"
        onClick={() => void copySummary()}
      >
        <Copy size={12} aria-hidden />
        Copy summary
      </button>
    </div>
  )
}

function CollapsibleCardBody({
  message,
  skills,
  workerUrl,
  defaultCollapsed,
  expandLabel,
  metaLine,
  footer,
}: {
  message: DisplayMessage
  skills?: Skill[]
  footer?: ReactNode
  workerUrl?: string
  defaultCollapsed: boolean
  expandLabel: string
  metaLine?: string
}) {
  const summary = useMemo(() => summarizeMessage(message), [message])
  const [expanded, setExpanded] = useState(!defaultCollapsed)

  return (
    <div className="tr-collapsible-card" data-qid={`transport:msg:${message.id}`}>
      <CardTypeHeader message={message} metaLine={metaLine ?? summary} />
      <p className="tr-collapsible-card__summary">{summary}</p>
      <CardActions
        messageId={message.id}
        summary={summary}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        workerUrl={workerUrl}
        expandLabel={expandLabel}
      />
      {footer}
      {expanded && (
        <div className="tr-collapsible-card__body">
          <ProseBlock text={message.prose} skills={skills} />
          <MetadataPills metadata={message.metadata} workerUrl={message.kind === 'worker' ? workerUrl : undefined} />
          {message.artifacts.map((block, i) => (
            <pre key={i} className="tr-artifact" data-qid={`transport:artifact:${message.id}:${i}`}>
              {block}
            </pre>
          ))}
        </div>
      )}
    </div>
  )
}

function MessageBubble({
  message,
  skills,
  workerUrl,
  stagger,
}: {
  message: DisplayMessage
  skills?: Skill[]
  workerUrl?: string
  stagger: number
}) {
  const contract = cardContractFor(message)
  const metaParts = [
    message.metadata.model,
    message.metadata.workerAgent,
    message.chipLabel !== contract.roleLabel ? message.chipLabel : undefined,
  ].filter(Boolean)
  const metaLine = metaParts.length ? metaParts.join(' · ') : undefined

  if (shouldCollapseByDefault(message)) {
    return (
      <div className={`tr-message-shell tr-message-shell--${contract.roleClass}`} style={{ animationDelay: `${stagger}s` }}>
        <CollapsibleCardBody
          message={message}
          skills={skills}
          workerUrl={workerUrl}
          defaultCollapsed
          expandLabel="Show full output"
          metaLine={metaLine}
        />
      </div>
    )
  }

  const isHuman = message.kind === 'human'

  return (
    <div
      className={`tr-message-group${isHuman ? ' tr-message-group--human' : ''} tr-msg-${contract.roleClass}`}
      style={{ animationDelay: `${stagger}s` }}
      data-qid={`transport:msg:${message.id}`}
    >
      <div
        className={`tr-message-avatar tr-message-avatar--${contract.roleClass}`}
        aria-label={isHuman ? 'Human' : contract.roleLabel}
      >
        <CardTypeIcon icon={contract.icon} />
      </div>
      <div className="tr-message-content">
        <CardTypeHeader message={message} metaLine={metaLine} />
        <div className="tr-message-bubble">
          <ProseBlock text={message.prose} skills={skills} />
          <MetadataPills metadata={message.metadata} workerUrl={message.kind === 'worker' ? workerUrl : undefined} />
          {message.artifacts.map((block, i) => (
            <pre key={i} className="tr-artifact" data-qid={`transport:artifact:${message.id}:${i}`}>
              {block}
            </pre>
          ))}
          {workerUrl && message.kind === 'worker' && (
            <a
              href={workerUrl}
              target="_blank"
              rel="noreferrer"
              className="tr-card-action tr-card-action--link tr-message-bubble__trace"
              data-qid="transport:card:open-trace"
              data-qs-action="TRANSPORT_ROOM_OPEN_WORKER"
              title="Open OpenCode worker trace in a new tab"
            >
              <ExternalLink size={12} aria-hidden />
              Open worker trace
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function AgentCard({
  message,
  skills,
  workerUrl,
  stagger,
  onInspectCall,
}: {
  message: DisplayMessage
  skills?: Skill[]
  workerUrl?: string
  stagger: number
  onInspectCall?: () => void
}) {
  const summary = summarizeMessage(message)
  const attempt = message.subtitle || message.title
  const metaLine = [attempt, message.metadata.workerAgent, message.metadata.model].filter(Boolean).join(' · ')

  return (
    <div className="tr-agent-card tr-agent-card--summary" style={{ animationDelay: `${stagger}s` }}>
      <CollapsibleCardBody
        message={message}
        skills={skills}
        workerUrl={workerUrl}
        defaultCollapsed={shouldCollapseByDefault(message)}
        expandLabel="Show worker prompt"
        metaLine={metaLine || summary}
        footer={
          message.skills?.length ? (
            <div className="tr-skill-chips tr-agent-card__skills" data-qid="transport:spawn-skills">
              {message.skills.map((slug) => (
                <span key={slug} className="tr-skill-chip">/{slug}</span>
              ))}
            </div>
          ) : null
        }
      />
    </div>
  )
}

function TaskCard({
  message,
  workerUrl,
  stagger,
}: {
  message: DisplayMessage
  workerUrl?: string
  stagger: number
}) {
  return (
    <div className="tr-task-card tr-task-card--summary" style={{ animationDelay: `${stagger}s` }}>
      <CollapsibleCardBody
        message={message}
        workerUrl={workerUrl}
        defaultCollapsed
        expandLabel="Show worker prompt"
        metaLine={message.title}
      />
    </div>
  )
}


export function TransportSpawnDispatchCard({
  spawn,
  task,
  workerUrl,
  skills,
  stagger,
  onInspectCall,
}: {
  spawn: DisplayMessage
  task?: DisplayMessage
  workerUrl?: string
  skills?: Skill[]
  stagger: number
  onInspectCall?: () => void
}) {
  const combined: DisplayMessage = {
    ...spawn,
    kind: 'agent_card',
    prose: [spawn.prose, task?.prose].filter(Boolean).join('\n\n'),
    artifacts: [...spawn.artifacts, ...(task?.artifacts ?? [])],
    subtitle: task?.subtitle ?? spawn.subtitle ?? 'Dispatching worker',
    title: spawn.title,
  }
  const summary = summarizeMessage(combined)
  const metaLine = [
    spawn.subtitle,
    spawn.metadata.model,
    spawn.metadata.workerAgent,
    task?.title,
  ].filter(Boolean).join(' · ')

  return (
    <div className="tr-spawn-dispatch-card" style={{ animationDelay: `${stagger}s` }} data-qid="transport:spawn-dispatch">
      <CollapsibleCardBody
        message={combined}
        skills={skills}
        workerUrl={workerUrl}
        defaultCollapsed
        expandLabel="Show worker prompt"
        metaLine={metaLine || summary}
        footer={
          <>
            {onInspectCall ? (
              <button
                type="button"
                className="tr-btn tr-btn--ghost tr-btn--compact"
                data-qid="transport:spawn:inspect"
                data-qs-action="TRANSPORT_SPAWN_INSPECT_CALL"
                title="Inspect this worker call in the call inspector"
                onClick={onInspectCall}
              >
                Inspect call
              </button>
            ) : null}
            {spawn.skills?.length ? (
              <div className="tr-skill-chips tr-agent-card__skills" data-qid="transport:spawn-skills">
                {spawn.skills.map((slug) => (
                  <span key={slug} className="tr-skill-chip">/{slug}</span>
                ))}
              </div>
            ) : null}
          </>
        }
      />
    </div>
  )
}

export function TransportMessageCard({
  message,
  skills,
  workerUrl,
  index,
  onInspectCall,
}: {
  message: DisplayMessage
  skills?: Skill[]
  workerUrl?: string
  index: number
  onInspectCall?: () => void
}) {
  useRegisterAction('transport:card:open-worker', {
    app: 'ux-lab',
    action: 'TRANSPORT_ROOM_OPEN_WORKER',
    label: 'Open worker trace from card',
    description: 'Open OpenCode worker trace from message card',
  })

  useRegisterAction('transport:card:toggle', {
    app: 'ux-lab',
    action: 'TRANSPORT_CARD_TOGGLE_DETAILS',
    label: 'Toggle card details',
    description: 'Expand or collapse transport message card details',
  })
  useRegisterAction('transport:card:copy', {
    app: 'ux-lab',
    action: 'TRANSPORT_CARD_COPY_SUMMARY',
    label: 'Copy card summary',
    description: 'Copy transport message summary to clipboard',
  })
  useRegisterAction('transport:spawn:inspect', {
    app: 'ux-lab',
    action: 'TRANSPORT_SPAWN_INSPECT_CALL',
    label: 'Inspect spawn call',
    description: 'Open call inspector for spawned worker',
  })
  useRegisterAction('transport:agent:inspect', {
    app: 'ux-lab',
    action: 'TRANSPORT_AGENT_INSPECT_CALL',
    label: 'Inspect agent call',
    description: 'Open call inspector from agent card',
  })

  const stagger = Math.min(index * 0.04, 0.32)
  const contract = cardContractFor(message)

  if (message.kind === 'system') {
    return (
      <div
        className="tr-system-event"
        style={{ animationDelay: `${stagger}s` }}
        data-qid={`transport:msg:${message.id}`}
      >
        <span className="tr-system-event__dot" aria-hidden />
        <span className="tr-system-event__role">{contract.roleLabel}</span>
        <span>{contract.headerTitle}</span>
        <span className="tr-system-event__phase">{contract.phaseLabel}</span>
        <span className="tr-system-event__line" aria-hidden />
      </div>
    )
  }

  if (message.kind === 'agent_card') {
    return (
      <AgentCard
        message={message}
        skills={skills}
        workerUrl={workerUrl}
        stagger={stagger}
        onInspectCall={onInspectCall}
      />
    )
  }

  if (message.kind === 'task_card') {
    return <TaskCard message={message} workerUrl={workerUrl} stagger={stagger} />
  }

  return (
    <MessageBubble
      message={message}
      skills={skills}
      workerUrl={workerUrl}
      stagger={stagger}
    />
  )
}

/**
 * Standard chat-style message row (ChatGPT / Claude / ChatWell transport layout).
 * Human: right-aligned bubble. Agents: avatar + speaker label + body on the left.
 */
import type { DisplayMessage } from './messageParse'
import { cardContractFor } from './messageCardContract'
import { TRANSPORT_ROLE_VISUALS } from './transportRoleVisuals'
import { actorDisplayForMessage } from './transportActorDisplay'
import { MetadataPills } from './MetadataPills'
import { TransportSkillChips } from './skillSyntax'
import type { Skill } from '../../shared-chat/types'
import { isThreadMessageSelected } from './callThreadSelection'
import type { TransportTurnAttachments } from './messageAttachments'
import { TransportTurnAttachmentsView } from './TransportTurnAttachments'

function RoleIcon({ visual }: { visual: ReturnType<typeof actorDisplayForMessage>['visual'] }) {
  const Icon = visual.Icon
  return (
    <Icon
      size={visual.iconSize}
      strokeWidth={visual.strokeWidth}
      aria-hidden
      title={visual.label}
    />
  )
}

function MessageBody({
  message,
  skills,
  workerUrl,
  attachments,
}: {
  message: DisplayMessage
  skills?: Skill[]
  workerUrl?: string
  attachments?: TransportTurnAttachments | null
  transportRunId?: string
}) {
  const text = message.prose.trim() || message.raw.trim()
  if (!text) return null
  return (
    <>
      <div className="transport-message__body">
        {text.split('\n').filter((line) => line.trim()).map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
      <TransportSkillChips text={text} catalog={skills} />
      {attachments ? (
        <TransportTurnAttachmentsView attachments={attachments} messageId={message.id} transportRunId={transportRunId} />
      ) : null}
      <MetadataPills metadata={message.metadata} workerUrl={message.kind === 'worker' ? workerUrl : undefined} />
      {message.artifacts.map((block, i) => (
        <details
          key={i}
          className="tr-artifact-details"
          data-qid={`transport:artifact:${message.id}:${i}`}
        >
          <summary>View raw session output</summary>
          <pre className="tr-artifact">{block}</pre>
        </details>
      ))}
    </>
  )
}

export function TransportChatMessage({
  message,
  skills,
  workerUrl,
  attachments,
  transportRunId,
  stagger,
  selectedCallId,
  selectedMessageId,
  onSelectCall,
}: {
  message: DisplayMessage
  skills?: Skill[]
  workerUrl?: string
  attachments?: TransportTurnAttachments | null
  transportRunId?: string
  stagger: number
  selectedCallId?: string | null
  selectedMessageId?: string | null
  onSelectCall?: () => void
}) {
  const contract = cardContractFor(message)
  const actor = actorDisplayForMessage(message, contract)
  const personaSlug = actor.personaSlug
  const collab = personaSlug ? 'subagent' : contract.roleClass
  const selectable = Boolean(onSelectCall && message.metadata.subagentRunId)
  const selected = isThreadMessageSelected(message, selectedCallId, selectedMessageId)

  if (message.kind === 'human') {
    return (
      <article
        className="transport-message transport-message--human"
        style={{ animationDelay: `${stagger}s` }}
        data-qid={`transport:msg:${message.id}`}
      >
        <div className="transport-message__row transport-message__row--human">
          <div className="transport-message__bubble">
            <div className="transport-message__speaker">You</div>
            <MessageBody message={message} skills={skills} workerUrl={workerUrl} attachments={attachments} transportRunId={transportRunId} />
          </div>
          <div className="transport-message__avatar transport-message__avatar--human" aria-hidden>
            <RoleIcon visual={TRANSPORT_ROLE_VISUALS.human} />
          </div>
        </div>
      </article>
    )
  }

  const row = (
    <div className="transport-message__row transport-message__row--agent">
      <div className={`transport-message__avatar transport-message__avatar--${collab}${personaSlug ? ` transport-message__avatar--${personaSlug}` : ''}`} aria-hidden>
        <RoleIcon visual={actor.visual} />
      </div>
      <div className="transport-message__surface">
        <div className="transport-message__speaker">
          <span className="transport-message__actor-name">{actor.actorName}</span>
          {actor.agentId ? (
            <span className="transport-message__actor-id" title="Worker template id">{actor.agentId}</span>
          ) : null}
          <span className="transport-message__phase">{actor.phaseLabel}</span>
        </div>
        <div className="transport-message__action">{actor.actionLine}</div>
        {message.subtitle ? (
          <div className="transport-message__subtitle">{message.subtitle}</div>
        ) : null}
        <MessageBody message={message} skills={skills} workerUrl={workerUrl} attachments={attachments} transportRunId={transportRunId} />
      </div>
    </div>
  )

  return (
    <article
      className={[
        'transport-message',
        `transport-message--${collab}`,
        selectable ? 'transport-message--selectable' : '',
        selected ? 'transport-message--selected' : '',
      ].filter(Boolean).join(' ')}
      style={{ animationDelay: `${stagger}s` }}
      data-qid={`transport:msg:${message.id}`}
      role={selectable ? 'button' : undefined}
      tabIndex={selectable ? 0 : undefined}
      onClick={selectable ? onSelectCall : undefined}
      onKeyDown={
        selectable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onSelectCall?.()
              }
            }
          : undefined
      }
    >
      {row}
    </article>
  )
}

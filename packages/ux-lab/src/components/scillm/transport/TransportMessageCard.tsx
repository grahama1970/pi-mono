import { TransportChatMessage } from './TransportChatMessage'
import { cardContractFor } from './messageCardContract'
import type { DisplayMessage } from './messageParse'
import type { Skill } from '../../shared-chat/types'
import type { TransportTurnAttachments } from './messageAttachments'
import { useRegisterAction } from '../../../hooks/useRegisterAction'

type ThreadSelectionProps = {
  selectedCallId?: string | null
  selectedMessageId?: string | null
  onSelectCall?: () => void
}

export function TransportMessageCard({
  message,
  skills,
  workerUrl,
  attachments,
    transportRunId,
  index,
  selectedCallId,
  selectedMessageId,
  onSelectCall,
}: {
  message: DisplayMessage
  skills?: Skill[]
  workerUrl?: string
  attachments?: TransportTurnAttachments | null
  transportRunId?: string
  index: number
} & ThreadSelectionProps) {
  useRegisterAction('transport:card:open-worker', {
    app: 'ux-lab',
    action: 'TRANSPORT_ROOM_OPEN_WORKER',
    label: 'Open worker trace',
    description: 'Open OpenCode worker trace',
  })

  const stagger = Math.min(index * 0.04, 0.32)
  const contract = cardContractFor(message)

  if (message.kind === 'system' || message.kind === 'transport_start') {
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

  return (
    <TransportChatMessage
      message={message}
      skills={skills}
      workerUrl={workerUrl}
      attachments={attachments}
      transportRunId={transportRunId}
      stagger={stagger}
      selectedCallId={selectedCallId}
      selectedMessageId={selectedMessageId}
      onSelectCall={onSelectCall}
    />
  )
}

/** @deprecated Spawn+task are separate chat rows; kept for import stability. */
export function TransportSpawnDispatchCard(props: {
  spawn: DisplayMessage
  task?: DisplayMessage
  workerUrl?: string
  skills?: Skill[]
  stagger: number
  selectedCallId?: string | null
  selectedMessageId?: string | null
  onSelectCall?: () => void
}) {
  const { spawn, task, stagger, ...rest } = props
  return (
    <>
      <TransportMessageCard message={spawn} index={0} stagger={stagger} {...rest} />
      {task ? <TransportMessageCard message={task} index={1} stagger={stagger + 0.04} {...rest} /> : null}
    </>
  )
}

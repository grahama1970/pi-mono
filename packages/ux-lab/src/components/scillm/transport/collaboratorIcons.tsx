import type { LucideIcon } from 'lucide-react'
import { Bot, Cpu, MessageSquare, User } from 'lucide-react'
import type { ReactNode } from 'react'
import { EMBRY } from '../../sparta/common/EmbryStyle'
import type { ChatMessage } from '../../shared-chat/types'
import type { TransportCollaborator } from './types'

export interface CollaboratorVisual {
  collaborator: TransportCollaborator
  label: string
  Icon: LucideIcon
  color: string
}

const VISUALS: Record<string, CollaboratorVisual> = {
  human: { collaborator: 'human', label: 'Human', Icon: User, color: EMBRY.blue },
  project_agent: { collaborator: 'project_agent', label: 'Project agent', Icon: Bot, color: EMBRY.amber },
  worker: { collaborator: 'worker', label: 'Worker', Icon: Cpu, color: EMBRY.green },
  labeled: { collaborator: 'labeled', label: 'Agent', Icon: MessageSquare, color: EMBRY.dim },
  opencode_model: { collaborator: 'opencode_model', label: 'OpenCode', Icon: MessageSquare, color: EMBRY.dim },
  unknown: { collaborator: 'unknown', label: 'Unknown', Icon: MessageSquare, color: EMBRY.dim },
}

export function collaboratorVisual(collaborator: string | undefined, speaker?: string): CollaboratorVisual {
  const key = (collaborator || '').trim()
  if (key && VISUALS[key]) return VISUALS[key]
  const low = (speaker || '').toLowerCase()
  if (low.includes('worker')) return VISUALS.worker
  if (low.includes('project agent')) return VISUALS.project_agent
  if (low === 'human') return VISUALS.human
  return VISUALS.unknown
}

export function transportAvatar(msg: ChatMessage): ReactNode {
  const collab = (msg.transportCollaborator || '') as string
  const visual = collaboratorVisual(collab, msg.agent)
  const { Icon, color, label } = visual
  return (
    <div
      aria-label={label}
      title={label}
      data-qid={`transport:avatar:${collab || 'unknown'}`}
      className={`transport-avatar transport-avatar--${collab || 'unknown'}`}
      style={{
        width: 32,
        height: 32,
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color,
        backgroundColor: `${color}14`,
        border: `1px solid ${EMBRY.border}`,
        flexShrink: 0,
      }}
    >
      <Icon size={18} strokeWidth={1.7} />
    </div>
  )
}

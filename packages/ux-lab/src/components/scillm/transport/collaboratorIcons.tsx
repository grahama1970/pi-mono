import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { EMBRY } from '../../sparta/common/EmbryStyle'
import type { ChatMessage } from '../../shared-chat/types'
import type { TransportCollaborator } from './types'
import { roleVisualForCollaborator } from './transportRoleVisuals'
import { roleVisualForSubagentPersona } from './subagentPersonaIcons'

export interface CollaboratorVisual {
  collaborator: TransportCollaborator
  label: string
  Icon: LucideIcon
  color: string
  cssClass: string
}

export function collaboratorVisual(
  collaborator: string | undefined,
  speaker?: string,
  subagentPersona?: string,
  subagentRoleSlug?: string,
  agentId?: string,
): CollaboratorVisual {
  if ((collaborator || '').trim() === 'worker' || subagentPersona) {
    const visual = roleVisualForSubagentPersona(subagentPersona, subagentRoleSlug, agentId)
    return {
      collaborator: 'worker',
      label: visual.label,
      Icon: visual.Icon,
      color: visual.color,
      cssClass: visual.cssClass,
    }
  }
  const visual = roleVisualForCollaborator(collaborator, speaker)
  return {
    collaborator: (collaborator || 'unknown') as TransportCollaborator,
    label: visual.label,
    Icon: visual.Icon,
    color: visual.color,
    cssClass: visual.cssClass,
  }
}

export function transportAvatar(msg: ChatMessage): ReactNode {
  const collab = (msg.transportCollaborator || '') as string
  const persona = (msg as ChatMessage & { transportSubagentPersona?: string }).transportSubagentPersona
  const roleSlug = (msg as ChatMessage & { transportSubagentRole?: string }).transportSubagentRole
  const visual = collab === 'worker' && persona
    ? roleVisualForSubagentPersona(persona, roleSlug)
    : roleVisualForCollaborator(collab, msg.agent)
  const { Icon, color, label, cssClass } = visual
  return (
    <div
      aria-label={label}
      title={label}
      data-qid={`transport:avatar:${collab || 'unknown'}`}
      className={`transport-avatar transport-avatar--${cssClass.replace(/\s+/g, '-')}`}
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
      <Icon size={visual.iconSize} strokeWidth={visual.strokeWidth} />
    </div>
  )
}

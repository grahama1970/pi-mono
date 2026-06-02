import type { ChatMessage } from '../../shared-chat/types'
import type { TransportDialogTurn } from './types'
import { primarySkillSlug } from './skillSyntax'

const SPEAKER_PREFIX = /^\*\*(.+?)\*\*\s*\n\n/s

function stripSpeakerMarkdown(text: string): string {
  const match = text.match(SPEAKER_PREFIX)
  if (match) return text.slice(match[0].length).trim()
  return text.trim()
}

/** Map transport dialog turns to ChatWell messages (human right, others left). */
export function dialogTurnsToChatMessages(turns: TransportDialogTurn[]): ChatMessage[] {
  return turns.map((turn) => {
    const id = turn.message_id || `turn-${turn.speaker}-${turn.collaborator}`
    const body = stripSpeakerMarkdown(turn.text)
    const skillUsed = primarySkillSlug(body)
    if (turn.collaborator === 'human') {
      return {
        id,
        role: 'user',
        content: body,
        agent: turn.speaker || 'Human',
        transportCollaborator: turn.collaborator,
        skillUsed,
      }
    }
    const speaker = turn.speaker || turn.collaborator
    return {
      id,
      role: 'assistant',
      content: body,
      agent: speaker,
      transportCollaborator: turn.collaborator,
      skillUsed,
    }
  })
}

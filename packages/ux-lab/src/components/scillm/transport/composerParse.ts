import type { ComposerSpeaker } from './TransportCollaborationRoom.types'

export function parseComposerMessage(text: string): { body: string; speaker: ComposerSpeaker } {
  const trimmed = text.trim()
  const match = trimmed.match(/^@project-agent\b\s*/i)
  if (match) {
    return { body: trimmed.slice(match[0].length).trim(), speaker: 'project_agent' }
  }
  return { body: trimmed, speaker: 'human' }
}

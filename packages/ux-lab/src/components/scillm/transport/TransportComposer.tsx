/**
 * Collaboration composer — human interjection only (shared ChatInput).
 */
import { useCallback } from 'react'
import { ChatInput } from '../../shared-chat/ChatInput'
import type { Skill } from '../../shared-chat/types'
import { parseComposerMessage } from './composerParse'

export function TransportComposer({
  onSend,
  skills,
  sending,
  pendingCount,
}: {
  onSend: (text: string, speaker: 'human' | 'project_agent') => void
  skills: Skill[]
  sending: boolean
  pendingCount: number
}) {
  const wrappedSend = useCallback(
    (text: string) => {
      const { body, speaker } = parseComposerMessage(text)
      if (!body.trim()) return
      onSend(body, speaker)
    },
    [onSend],
  )

  return (
    <footer className="transport-chat-composer" data-qid="transport:composer">
      {pendingCount > 0 && (
        <p className="transport-chat-composer__pending" data-qid="transport:composer:pending-note">
          {pendingCount} message{pendingCount === 1 ? '' : 's'} queued for the next worker dispatch.
        </p>
      )}

      <ChatInput
        app="transport"
        skills={skills}
        disabled={sending}
        loading={sending}
        onSend={wrappedSend}
        placeholder="Interject as Human… (Enter to send, Shift+Enter for newline, / for skills)"
      />
    </footer>
  )
}

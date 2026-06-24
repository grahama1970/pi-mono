/**
 * SharedChatPage — final convergence route for persona + compliance chat.
 *
 * URL: #sparta-explorer/final-site/chat
 * Persona default: #sparta-explorer/final-site/chat/personaplex
 */
import { useState } from 'react'
import { SharedChatShell } from './SharedChatShell'
import type { PersonaPlexChatMode } from './personaplexProtocol'

function initialModeFromLocation(): PersonaPlexChatMode {
  if (typeof window === 'undefined') return 'compliance'
  const hash = window.location.hash.replace(/^#/, '')
  const parts = hash.split('/')
  const tail = parts[parts.length - 1] ?? ''
  if (tail === 'personaplex' || tail === 'personaplex-chat') return 'personaplex'
  const query = hash.includes('?') ? hash.split('?')[1] : ''
  if (query.includes('mode=personaplex')) return 'personaplex'
  return 'compliance'
}

export function SharedChatPage() {
  const [mode, setMode] = useState<PersonaPlexChatMode>(initialModeFromLocation)

  return (
    <SharedChatShell
      projectLabel="SPARTA Explorer"
      showModeToggle
      defaultMode={mode}
      onModeChange={setMode}
      surface="shared-chat"
      adapterOptions={{
        personaplex: {
          wsUrl: 'ws://127.0.0.1:8788/ws',
          personaId: 'embry',
        },
      }}
      placeholder={mode === 'personaplex' ? 'Speak or type to Embry…' : 'Ask a SPARTA compliance question…'}
    />
  )
}

export default SharedChatPage

import { useCallback, useRef, useState } from 'react'
import { ArrowUp, Terminal } from 'lucide-react'
import { SkillPalette } from '../../shared-chat/SkillPalette'
import type { Skill } from '../../shared-chat/types'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import type { ComposerSpeaker } from './TransportCollaborationRoom.types'
import { SPEAKER_LABEL } from './TransportCollaborationRoom.types'

const PROJECT_AGENT_CONFIRM_KEY = 'scillm.transport.composer.projectAgentConfirm.v1'

function confirmProjectAgentOnce(): boolean {
  try {
    if (sessionStorage.getItem(PROJECT_AGENT_CONFIRM_KEY) === '1') return true
  } catch {
    return true
  }
  const ok = window.confirm(
    'You are about to post as the project agent. This voice is visible to the reviewer/worker pipeline. Continue?',
  )
  if (ok) {
    try {
      sessionStorage.setItem(PROJECT_AGENT_CONFIRM_KEY, '1')
    } catch {
      /* ignore */
    }
  }
  return ok
}

export function TransportComposer({
  speaker,
  onSpeakerChange,
  onSend,
  skills,
  sending,
  pendingCount,
}: {
  speaker: ComposerSpeaker
  onSpeakerChange: (s: ComposerSpeaker) => void
  onSend: (text: string) => void
  skills: Skill[]
  sending: boolean
  pendingCount: number
}) {
  const [input, setInput] = useState('')
  const [showPalette, setShowPalette] = useState(false)
  const [skillFilter, setSkillFilter] = useState('')
  const paletteKeyHandler = useRef<((e: React.KeyboardEvent) => boolean) | null>(null)

  const sendLabel = `Send as ${SPEAKER_LABEL[speaker]}`

  useRegisterAction('transport:composer:speaker-human', {
    app: 'ux-lab',
    action: 'TRANSPORT_ROOM_SPEAKER_HUMAN',
    label: 'Post as human',
    description: 'Set composer speaker to human',
  })

  useRegisterAction('transport:composer:speaker-project', {
    app: 'ux-lab',
    action: 'TRANSPORT_ROOM_SPEAKER_PROJECT',
    label: 'Post as project agent',
    description: 'Set composer speaker to project agent',
  })

  useRegisterAction('transport:composer:skills', {
    app: 'ux-lab',
    action: 'TRANSPORT_ROOM_OPEN_SKILLS',
    label: 'Open skills palette',
    description: 'Open slash-command skills palette in composer',
  })

  useRegisterAction('transport:composer:input', {
    app: 'ux-lab',
    action: 'TRANSPORT_COMPOSER_INPUT',
    label: 'Composer message input',
    description: 'Type a message in the transport collaboration composer',
  })

  useRegisterAction('transport:composer:send', {
    app: 'ux-lab',
    action: 'TRANSPORT_ROOM_SEND',
    label: sendLabel,
    description: 'Send message in collaboration room',
  })

  const applyValue = useCallback((val: string) => {
    setInput(val)
    const lastWord = val.split(/\s+/).pop() || ''
    if (lastWord.startsWith('/') && lastWord.length > 1) {
      setShowPalette(true)
      setSkillFilter(lastWord.slice(1))
    } else if (lastWord === '/' && skills.length > 0) {
      setShowPalette(true)
      setSkillFilter('')
    } else {
      setShowPalette(false)
    }
  }, [skills.length])

  const submit = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || sending) return
    if (speaker === 'project_agent' && !confirmProjectAgentOnce()) return
    onSend(trimmed)
    setInput('')
    setShowPalette(false)
  }, [input, sending, onSend, speaker])

  const handleSkillSelect = useCallback((name: string) => {
    const words = input.split(/\s+/)
    words[words.length - 1] = `/${name} `
    applyValue(words.join(' '))
    setShowPalette(false)
  }, [input, applyValue])

  const handleSpeakerChange = useCallback((next: ComposerSpeaker) => {
    if (next === 'project_agent' && speaker !== 'project_agent') {
      confirmProjectAgentOnce()
    }
    onSpeakerChange(next)
  }, [onSpeakerChange, speaker])

  return (
    <div
      className={`transport-composer${speaker === 'project_agent' ? ' transport-composer--project-agent' : ''}`}
      data-qid="transport:composer"
    >
      {pendingCount > 0 && (
        <p className="transport-composer__pending-note" data-qid="transport:composer:pending-note">
          {pendingCount} parent-session turn{pendingCount === 1 ? '' : 's'} will ship on the next worker dispatch.
        </p>
      )}

      <div className="transport-composer__toolbar">
        <span className="transport-composer__posting-label">Posting as:</span>
        <div className="transport-speaker-toggle" role="group" aria-label="Composer speaker">
          {(['human', 'project_agent'] as const).map((key) => (
            <button
              key={key}
              type="button"
              className={`transport-speaker-toggle__btn${speaker === key ? ' transport-speaker-toggle__btn--active' : ''}`}
              data-qid={key === 'human' ? 'transport:composer:speaker-human' : 'transport:composer:speaker-project'}
              data-qs-action={key === 'human' ? 'TRANSPORT_ROOM_SPEAKER_HUMAN' : 'TRANSPORT_ROOM_SPEAKER_PROJECT'}
              title={`Post as ${SPEAKER_LABEL[key]}`}
              onClick={() => handleSpeakerChange(key)}
            >
              {SPEAKER_LABEL[key]}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="transport-btn transport-btn--ghost transport-composer__skills-btn"
          data-qid="transport:composer:skills"
          data-qs-action="TRANSPORT_ROOM_OPEN_SKILLS"
          title="Skills palette (/)"
          onClick={() => { setShowPalette(true); setSkillFilter('') }}
        >
          <Terminal size={16} />
          <span>Skills</span>
        </button>
      </div>

      <div className="transport-composer__dock tr-composer-dock">
        {showPalette && skills.length > 0 && (
          <div className="transport-composer__palette">
            <SkillPalette
              filter={skillFilter}
              skills={skills}
              onSelect={handleSkillSelect}
              onClose={() => setShowPalette(false)}
              onKeyNav={(handler) => { paletteKeyHandler.current = handler }}
            />
          </div>
        )}
        <textarea
          className="transport-composer__input"
          data-qid="transport:composer:input"
          data-qs-action="TRANSPORT_COMPOSER_INPUT"
          title={`Message as ${SPEAKER_LABEL[speaker]}`}
          aria-label={`Message as ${SPEAKER_LABEL[speaker]}`}
          placeholder={`Message as ${SPEAKER_LABEL[speaker]}… (/ for skills)`}
          value={input}
          rows={2}
          disabled={sending}
          onChange={(e) => applyValue(e.target.value)}
          onKeyDown={(e) => {
            if (showPalette && paletteKeyHandler.current?.(e)) return
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
            if (e.key === '/' && input === '') {
              e.preventDefault()
              setShowPalette(true)
              setSkillFilter('')
            }
          }}
        />
        <button
          type="button"
          className="transport-composer__send"
          data-qid="transport:composer:send"
          data-qs-action="TRANSPORT_ROOM_SEND"
          title={sendLabel}
          aria-label={sendLabel}
          disabled={!input.trim() || sending}
          onClick={submit}
        >
          <ArrowUp size={18} strokeWidth={2} />
          <span className="transport-composer__send-label">{sendLabel}</span>
        </button>
      </div>
    </div>
  )
}

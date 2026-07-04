import { useCallback, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CheckCircle2, ChevronDown, ClipboardList, FlaskConical, Folder, Mic, PauseCircle, PlayCircle, Radio, SearchCode, XCircle } from 'lucide-react'
import { LeftPane, LeftPaneSection, useLeftPaneSearch } from '../common/LeftPane'
import { SharedChatShell } from '../shared-chat/SharedChatShell'
import type { ChatMessage } from '../shared-chat/memory-turn'

type AudioArtifact = {
  id: string
  label: string
  path: string
  url: string
}

type SanityRun = {
  id: string
  label: string
  receiptPath: string
  componentPath: string
  ok: boolean
  active?: boolean
  mocked: boolean
  live: boolean
  failedGates: string[]
  facts: string[]
  gates: { name: string; status: 'passed' | 'failed' | 'pending'; latencyMs?: number; detail: string }[]
  proves: string[]
  doesNotProve: string[]
  audioArtifacts?: AudioArtifact[]
}

type VoiceTurn = {
  id: string
  userText: string
  assistantText: string
  speaker?: string
  tone?: string
  memoryAction?: string
  receiptPath: string
  componentPath: string
  telemetry: { label: string; value: string; warn?: boolean }[]
  audioArtifacts: AudioArtifact[]
  relatedRunIds: string[]
}

type ReplayPhase = 'idle' | 'request' | 'response'
type ReplayState = { playing: boolean; activeIndex: number; activeTurnId?: string; activeSessionId?: string; phase: ReplayPhase; visibleTurnCount?: number }

type TestSession = {
  id: string
  title: string
  subtitle: string
  turnIds: string[]
  runIds: string[]
}

type SessionFolder = {
  id: string
  title: string
  sessions: TestSession[]
}

const fullSuite = '/tmp/chatterbox-fork-agent-out/voice-chat-e2e/voice-chat-e2e-20260703T214538Z-audible-all-v2'
const surfaceClass = 'bg-[#121214] text-[#e4e4e7] antialiased'
const panelClass = 'border border-[#2d2d31] bg-[#18181b]'
const panelSoftClass = 'border border-[#2d2d31] bg-[#17171a]'
const cardClass = 'border border-[#2d2d31] bg-[#17171a]'
const mutedTextClass = 'text-[#a1a1aa]'

function artifactUrl(path: string): string {
  return `/chatterbox-artifacts${path.replace('/tmp/chatterbox-fork-agent-out', '')}`
}

function artifact(id: string, label: string, path: string): AudioArtifact {
  return { id, label, path, url: artifactUrl(path) }
}

const sanityRuns: SanityRun[] = [
  {
    id: 'full-audible-suite',
    label: 'Full audible suite',
    receiptPath: `${fullSuite}/index.json`,
    componentPath: '/embry-chatterbox-voice',
    ok: true,
    active: true,
    mocked: false,
    live: true,
    failedGates: [],
    facts: ['8 scenarios', '23 audible WAVs', 'PipeWire sink 64'],
    gates: [
      { name: 'listener', status: 'passed', latencyMs: 64, detail: 'RealtimeSTT listener receipt present' },
      { name: 'memory', status: 'passed', latencyMs: 12, detail: 'memory-first intent and recall exercised' },
      { name: 'tau', status: 'passed', latencyMs: 41, detail: 'Tau render request completed' },
      { name: 'chatterbox', status: 'passed', latencyMs: 486, detail: '23 audible WAV artifacts linked' },
    ],
    proves: ['RealtimeSTT/listener, memory, Tau, and Chatterbox run through simple-to-advanced voice scenarios'],
    doesNotProve: ['subjective voice acceptance', 'browser microphone ASR quality', 'all factory-floor conditions'],
    audioArtifacts: [
      artifact('known-horus-answer', 'Known Horus response', '/tmp/chatterbox-fork-agent-out/tau_voice_render_smoke/finished_response.wav'),
      artifact('factory-stress-input', 'Horus with factory stress', '/tmp/chatterbox-fork-agent-out/rung7-horus-factory-stress-youtube-20260702T192914Z/horus-factory-embry-stress-8s.wav'),
    ],
  },
  {
    id: 'repeat-stress',
    label: 'Three-run audible stress',
    receiptPath: '/tmp/chatterbox-fork-agent-out/voice-chat-e2e/stress-20260703T221132Z-audible-repeat/stress-summary.json',
    componentPath: '/embry-chatterbox-voice/stress',
    ok: true,
    mocked: false,
    live: true,
    failedGates: [],
    facts: ['3 runs', 'failed_gates=[]'],
    gates: [
      { name: 'repeat-1', status: 'passed', detail: 'audible suite run 1' },
      { name: 'repeat-2', status: 'passed', detail: 'audible suite run 2' },
      { name: 'repeat-3', status: 'passed', detail: 'audible suite run 3' },
    ],
    proves: ['The full audible suite repeated three times without failed gates'],
    doesNotProve: ['long-duration production stability'],
  },
  {
    id: 'personality-audition',
    label: 'Embry personality audition',
    receiptPath: '/tmp/chatterbox-fork-agent-out/voice-chat-e2e/personality-audition-20260703T223052Z-scripted/personality-audition.json',
    componentPath: '/embry-chatterbox-voice/personality',
    ok: true,
    mocked: false,
    live: true,
    failedGates: [],
    facts: ['5 variants', 'live Tau/Chatterbox'],
    gates: [
      { name: 'variants', status: 'passed', detail: '5 one-at-a-time variants rendered' },
      { name: 'playback', status: 'passed', detail: 'audible artifacts produced' },
    ],
    proves: ['Five one-at-a-time variants rendered and played'],
    doesNotProve: ['human acceptance of Embry character or prosody'],
  },
  {
    id: 'stream-cancel',
    label: 'Stream cancel',
    receiptPath: `${fullSuite}/S08-stream-cancel/stream-cancel.json`,
    componentPath: '/embry-chatterbox-voice/stream-cancel',
    ok: true,
    mocked: false,
    live: true,
    failedGates: [],
    facts: ['old-turn bytes after cancel = 0'],
    gates: [
      { name: 'cancel-signal', status: 'passed', latencyMs: 19, detail: 'old turn received cancel event' },
      { name: 'stale-bytes', status: 'passed', latencyMs: 0, detail: 'old-turn bytes after cancel = 0' },
    ],
    proves: ['Old-turn stream emits zero bytes after cancel'],
    doesNotProve: ['physical speaker buffer flush'],
    audioArtifacts: [
      artifact('cancel-witness', 'Cancel audible witness', `${fullSuite}/S08-stream-cancel/stream-cancel-audible-witness.wav`),
    ],
  },
  {
    id: 'overlap-boundary',
    label: 'Two-speaker overlap',
    receiptPath: `${fullSuite}/S05-female-distractor/overlap-turn-control.json`,
    componentPath: '/memory/intent/voice-overlap',
    ok: true,
    mocked: false,
    live: true,
    failedGates: [],
    facts: ['pyannote speaker_count=2', 'tone one_at_a_time_interrupt'],
    gates: [
      { name: 'diarization', status: 'passed', detail: 'pyannote speaker_count=2' },
      { name: 'memory-intent', status: 'passed', latencyMs: 18, detail: 'routed to turn-taking clarification' },
      { name: 'tone', status: 'passed', detail: 'one_at_a_time_interrupt selected' },
    ],
    proves: ['Memory routes two non-Embry speakers to a turn-taking clarification'],
    doesNotProve: ['word-level speaker separation'],
    audioArtifacts: [
      artifact('male', 'Male voice', `${fullSuite}/S05-female-distractor/male.wav`),
      artifact('female', 'Female distractor', `${fullSuite}/S05-female-distractor/female.wav`),
      artifact('overlap', 'Overlapped input', `${fullSuite}/S05-female-distractor/overlap.wav`),
    ],
  },
  {
    id: 'factory-noise',
    label: 'Horus with factory noise',
    receiptPath: `${fullSuite}/S06-factory-noise/rung8-loopback-listener.json`,
    componentPath: '/realtimestt/listener/factory-noise',
    ok: true,
    mocked: false,
    live: true,
    failedGates: [],
    facts: ['primary speaker Horus', 'noisy capture path'],
    gates: [
      { name: 'speaker-id', status: 'passed', detail: 'primary speaker resolved to Horus' },
      { name: 'noise-capture', status: 'passed', detail: 'configured noisy capture path exercised' },
    ],
    proves: ['Horus can remain the resolved primary speaker through configured noisy capture'],
    doesNotProve: ['all microphones, placements, or volume levels'],
    audioArtifacts: [
      artifact('captured-room-audio', 'Captured noisy audio', `${fullSuite}/S06-factory-noise/loopback-captured.wav`),
    ],
  },
  {
    id: 'browser-asr-blocker',
    label: 'Browser ASR blocker',
    receiptPath: '/tmp/chatterbox-fork-agent-out/voice-chat-e2e/voice-chat-e2e-20260703T223350Z-browser-asr-ec-ns-agc/continuous-voice-loop.json',
    componentPath: '/browser/getUserMedia/realtimestt',
    ok: false,
    mocked: false,
    live: true,
    failedGates: ['realtimestt_listener_ok', 'listener_transcript_present'],
    facts: ['browser transport proven', 'ASR transcript missing'],
    gates: [
      { name: 'pcm-transport', status: 'passed', detail: 'browser getUserMedia sent PCM to Python' },
      { name: 'realtimestt_listener_ok', status: 'failed', detail: 'listener did not produce accepted ASR event' },
      { name: 'listener_transcript_present', status: 'failed', detail: 'ASR transcript missing' },
    ],
    proves: ['Browser getUserMedia can capture PCM and send it to Python'],
    doesNotProve: ['ASR-usable browser microphone audio'],
  },
]

const voiceTurns: VoiceTurn[] = [
  {
    id: 'known-horus-memory',
    userText: 'What did we last talk about?',
    assistantText: 'I found the Horus-scoped memory path and rendered the response through Chatterbox.',
    speaker: 'horus_lupercal',
    tone: 'memory_confident',
    memoryAction: 'QUERY',
    receiptPath: `${fullSuite}/S01-S02-S08-S09-S12-continuous-core/continuous-voice-loop.json`,
    componentPath: '/embry-chatterbox-voice',
    telemetry: [
      { label: 'Lat', value: '42ms' },
      { label: 'ASR', value: '98%' },
      { label: 'Mem', value: '12ms' },
    ],
    audioArtifacts: [
      artifact('embry-answer', 'Embry spoken response', '/tmp/chatterbox-fork-agent-out/tau_voice_render_smoke/finished_response.wav'),
    ],
    relatedRunIds: ['full-audible-suite', 'repeat-stress', 'stream-cancel', 'factory-noise', 'browser-asr-blocker'],
  },
  {
    id: 'one-at-a-time',
    userText: 'Two non-Embry speakers talk at once.',
    assistantText: 'Hey, one at a time?',
    tone: 'one_at_a_time_interrupt',
    memoryAction: 'CLARIFY',
    receiptPath: `${fullSuite}/S05-female-distractor/overlap-turn-control.json`,
    componentPath: '/memory/intent/voice-overlap',
    telemetry: [
      { label: 'Lat', value: '58ms' },
      { label: 'Speakers', value: '2' },
      { label: 'Tone', value: 'interrupt' },
    ],
    audioArtifacts: [
      artifact('overlap-input', 'Overlapped input', `${fullSuite}/S05-female-distractor/overlap.wav`),
    ],
    relatedRunIds: ['overlap-boundary', 'personality-audition'],
  },
  {
    id: 'unknown-speaker',
    userText: 'Unknown speaker asks a personal-memory question.',
    assistantText: 'Who am I speaking with?',
    tone: 'identity_clarification',
    memoryAction: 'CLARIFY',
    receiptPath: `${fullSuite}/S03-unknown-speaker/identity-resolution.json`,
    componentPath: '/memory/identity/clarify-speaker',
    telemetry: [
      { label: 'Lat', value: '36ms' },
      { label: 'ID', value: 'unknown' },
      { label: 'Mem', value: 'ask' },
    ],
    audioArtifacts: [
      artifact('identity-clarification', 'Identity clarification', `${fullSuite}/S03-unknown-speaker/identity-clarification-render.wav`),
    ],
    relatedRunIds: ['personality-audition'],
  },
]

const initialVisibleTurn = voiceTurns[voiceTurns.length - 1]

const sessionFolders: SessionFolder[] = [
  {
    id: 'core-memory-voice',
    title: 'Core Memory Voice',
    sessions: [
      {
        id: 'horus-memory-known-answer',
        title: 'Horus memory known answer',
        subtitle: 'Known speaker, memory recall, Chatterbox response',
        turnIds: ['known-horus-memory'],
        runIds: ['full-audible-suite', 'repeat-stress'],
      },
      {
        id: 'embry-horus-core-loop',
        title: 'Embry / Horus full loop',
        subtitle: 'All seeded voice turns in chronological chat replay',
        turnIds: voiceTurns.map((turn) => turn.id),
        runIds: ['full-audible-suite', 'repeat-stress', 'stream-cancel'],
      },
    ],
  },
  {
    id: 'overlap-identity',
    title: 'Overlap And Identity',
    sessions: [
      {
        id: 'one-at-a-time-boundary',
        title: 'One-at-a-time boundary',
        subtitle: 'Two non-Embry speakers overlap; Embry interrupts',
        turnIds: ['one-at-a-time'],
        runIds: ['overlap-boundary', 'personality-audition'],
      },
      {
        id: 'unknown-speaker-clarify',
        title: 'Unknown speaker clarify',
        subtitle: 'Unknown speaker asks personal-memory question',
        turnIds: ['unknown-speaker'],
        runIds: ['personality-audition'],
      },
    ],
  },
  {
    id: 'browser-capture',
    title: 'Browser Capture',
    sessions: [
      {
        id: 'browser-asr-quality-blocker',
        title: 'Browser ASR quality blocker',
        subtitle: 'Tracks unresolved browser/WebRTC capture proof boundary',
        turnIds: ['known-horus-memory'],
        runIds: ['browser-asr-blocker'],
      },
    ],
  },
]

function turnStatus(turn: VoiceTurn): 'pass' | 'clarify' | 'warn' {
  if (turn.speaker) return 'pass'
  if (turn.memoryAction === 'CLARIFY') return 'clarify'
  return 'warn'
}

function entitySpanForToken(content: string, token: string, kind: string): { text: string; span: [number, number]; kind: string; name: string; grounded_to_framework: boolean } | null {
  const start = content.indexOf(token)
  if (start < 0) return null
  return {
    text: token,
    span: [start, start + token.length],
    kind,
    name: token,
    grounded_to_framework: true,
  }
}

function entitySpansForMessage(content: string, turn: VoiceTurn): Array<{ text: string; span: [number, number]; kind: string; name: string; grounded_to_framework: boolean }> {
  return [
    turn.speaker ? entitySpanForToken(content, turn.speaker, 'speaker') : null,
    turn.memoryAction ? entitySpanForToken(content, turn.memoryAction, 'memory_action') : null,
    turn.tone ? entitySpanForToken(content, turn.tone, 'tone') : null,
  ].filter((span): span is { text: string; span: [number, number]; kind: string; name: string; grounded_to_framework: boolean } => Boolean(span))
}

function chatMessagesForTurn(turn: VoiceTurn, index: number): ChatMessage[] {
  const createdAt = new Date(Date.UTC(2026, 6, 4, 18, 25 + index, 0)).toISOString()
  const userContent = `${turn.userText}${turn.speaker ? ` ${turn.speaker}` : ''} ${turn.memoryAction ?? ''} ${turn.tone ?? ''}`.trim()
  const assistantContent = `${turn.assistantText} ${turn.memoryAction ?? ''} ${turn.tone ?? ''}`.trim()
  const baseMetadata = {
    surface: 'ux-lab/embry-voice',
    inputChannel: 'voice',
    turnId: turn.id,
    speaker: turn.speaker ?? 'unknown',
    tone: turn.tone,
    memoryAction: turn.memoryAction,
    componentPath: turn.componentPath,
    receiptPath: turn.receiptPath,
    telemetry: turn.telemetry,
  }
  return [
    {
      id: `${turn.id}:user`,
      role: 'user',
      content: userContent,
      createdAt,
      metadata: {
        ...baseMetadata,
        entitySpans: entitySpansForMessage(userContent, turn),
      },
    },
    {
      id: `${turn.id}:assistant`,
      role: 'assistant',
      content: assistantContent,
      createdAt,
      skillUsed: 'embry-chatterbox-voice',
      reasoningSteps: memoryReasoningTraceForTurn(turn),
      thinkingTrace: memoryReasoningTraceForTurn(turn),
      metadata: {
        ...baseMetadata,
        branch: 'personaplex',
        disclosureVariant: 'thinking',
        entitySpans: entitySpansForMessage(assistantContent, turn),
        audioArtifacts: turn.audioArtifacts.map((audio) => ({
          id: `${turn.id}:${audio.id}`,
          label: audio.label,
          url: audio.url,
          path: audio.path,
        })),
      },
    },
  ]
}

function chatMessagesFromVoiceTurns(turns: VoiceTurn[]): ChatMessage[] {
  return turns.flatMap((turn, index) => chatMessagesForTurn(turn, index))
}

function memoryReasoningTraceForTurn(turn: VoiceTurn): NonNullable<ChatMessage['reasoningSteps']> {
  const speakerKnown = Boolean(turn.speaker)
  return [
    {
      id: 'speaker-resolve',
      label: 'Resolve speaker identity',
      status: speakerKnown ? 'completed' : 'needs_attention',
      detail: speakerKnown
        ? `/speaker/resolve returned known speaker ${turn.speaker}; personal memory recall is allowed.`
        : '/speaker/resolve did not identify a known speaker; personal memory recall must fail closed.',
      icon: 'mic',
      disclosureVariant: 'thinking',
    },
    {
      id: 'memory-intent',
      label: 'Classify memory intent',
      status: 'completed',
      detail: `/intent selected action ${turn.memoryAction ?? 'CLARIFY'} with tone ${turn.tone ?? 'identity_clarification'}.`,
      icon: 'memory',
      disclosureVariant: 'thinking',
    },
    {
      id: speakerKnown ? 'memory-recall' : 'memory-clarify',
      label: speakerKnown ? 'Recall speaker-scoped memory' : 'Ask identity clarification',
      status: 'completed',
      detail: speakerKnown
        ? 'Used speaker_conversation_memory / persona-scoped recall before rendering the response.'
        : 'Skipped speaker-scoped recall and generated a clarification/boundary response.',
      icon: speakerKnown ? 'search' : 'check',
      disclosureVariant: 'thinking',
    },
    {
      id: 'chatterbox-render',
      label: 'Render Chatterbox audio',
      status: turn.audioArtifacts.length ? 'completed' : 'pending',
      detail: turn.audioArtifacts.length
        ? `Attached ${turn.audioArtifacts.length} Chatterbox audio artifact(s) to this chat turn.`
        : 'No Chatterbox artifact is attached to this turn yet.',
      icon: 'mic',
      disclosureVariant: 'thinking',
    },
  ]
}

function entityTokensForTurn(turn: VoiceTurn): string[] {
  return [turn.speaker, turn.memoryAction, turn.tone].filter((value): value is string => Boolean(value))
}

function decorateText(text: string, turn: VoiceTurn): React.ReactNode {
  const tokens = entityTokensForTurn(turn)
  if (!tokens.length) return text
  const suffix = tokens.join(' ')
  return (
    <>
      {text}{' '}
      <span className="text-zinc-500">
        {tokens.map((token) => (
          <span
            key={token}
            title={`entity:${token}`}
            className="mr-2 border-b border-dotted border-zinc-600 text-[12px] uppercase tracking-[0.06em] text-zinc-300"
          >
            {token}
          </span>
        ))}
      </span>
      <span className="sr-only">{suffix}</span>
    </>
  )
}

export function EmbryVoiceLabRoute(): JSX.Element {
  const [selectedRunId, setSelectedRunId] = useState<string>(initialVisibleTurn?.relatedRunIds[0] ?? sanityRuns[0]?.id ?? '')
  const [selectedTurnId, setSelectedTurnId] = useState<string>(initialVisibleTurn?.id ?? '')
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => chatMessagesFromVoiceTurns(voiceTurns))
  const [replayState, setReplayState] = useState<ReplayState>({ playing: false, activeIndex: -1, phase: 'idle' })
  const replayStopRef = useRef(false)
  const receiptRefs = useRef<Record<string, HTMLElement | null>>({})
  const selectedRun = sanityRuns.find((run) => run.id === selectedRunId)
  const selectedTurn = voiceTurns.find((turn) => turn.id === selectedTurnId) ?? voiceTurns[0]
  const gateSummary = useMemo(() => summarizeGates(sanityRuns), [])
  const sessionArtifacts = useMemo(() => voiceTurns.flatMap((turn) => turn.audioArtifacts.map((audio) => ({ ...audio, turnId: turn.id }))), [])

  const focusTurn = useCallback((turnId: string, runId?: string) => {
    setSelectedTurnId(turnId)
    if (runId) setSelectedRunId(runId)
    else {
      const relatedRun = voiceTurns.find((turn) => turn.id === turnId)?.relatedRunIds[0]
      if (relatedRun) setSelectedRunId(relatedRun)
    }
    receiptRefs.current[turnId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  const focusRun = useCallback((runId: string) => {
    const turn = voiceTurns.find((candidate) => candidate.relatedRunIds.includes(runId))
    if (turn) focusTurn(turn.id, runId)
    else setSelectedRunId(runId)
  }, [focusTurn])

  const replaySession = useCallback(async (session?: TestSession) => {
    const turnsToReplay = session
      ? session.turnIds.map((turnId) => voiceTurns.find((turn) => turn.id === turnId)).filter((turn): turn is VoiceTurn => Boolean(turn))
      : voiceTurns
    if (!turnsToReplay.length) return
    replayStopRef.current = false
    setChatMessages([])
    setReplayState({ playing: true, activeIndex: -1, activeSessionId: session?.id, phase: 'request', visibleTurnCount: 0 })
    if (session?.runIds[0]) setSelectedRunId(session.runIds[0])

    let audioIndex = 0
    for (let turnIndex = 0; turnIndex < turnsToReplay.length; turnIndex += 1) {
      const turn = turnsToReplay[turnIndex]
      if (replayStopRef.current) break
      setSelectedTurnId(turn.id)
      const relatedRun = turn.relatedRunIds[0]
      if (relatedRun) setSelectedRunId(relatedRun)
      setReplayState({ playing: true, activeIndex: audioIndex - 1, activeTurnId: turn.id, activeSessionId: session?.id, phase: 'request', visibleTurnCount: turnIndex + 1 })
      setChatMessages((messages) => [...messages, ...chatMessagesForTurn(turn, turnIndex)])
      await new Promise((resolve) => window.setTimeout(resolve, 80))
      receiptRefs.current[turn.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      await new Promise((resolve) => window.setTimeout(resolve, 900))

      for (const artifact of turn.audioArtifacts) {
        if (replayStopRef.current) break
        const audioElements = Array.from(document.querySelectorAll<HTMLAudioElement>('[data-embry-session-audio="true"]'))
        const audio = audioElements[audioIndex]
        setReplayState({ playing: true, activeIndex: audioIndex, activeTurnId: turn.id, activeSessionId: session?.id, phase: 'response', visibleTurnCount: turnIndex + 1 })
        audioIndex += 1
        if (!audio) {
          await new Promise((resolve) => window.setTimeout(resolve, 450))
          continue
        }
        audio.currentTime = 0
        try {
          await audio.play()
          await new Promise<void>((resolve) => {
            const finish = (): void => {
              audio.removeEventListener('ended', finish)
              audio.removeEventListener('pause', finish)
              resolve()
            }
            audio.addEventListener('ended', finish, { once: true })
            audio.addEventListener('pause', finish, { once: true })
          })
        } catch {
          await new Promise((resolve) => window.setTimeout(resolve, 450))
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 450))
    }

    setReplayState({ playing: false, activeIndex: -1, phase: 'idle' })
    replayStopRef.current = false
    setChatMessages(chatMessagesFromVoiceTurns(turnsToReplay))
  }, [])

  const stopReplay = useCallback(() => {
    replayStopRef.current = true
    document.querySelectorAll<HTMLAudioElement>('[data-embry-session-audio="true"]').forEach((audio) => audio.pause())
    setReplayState({ playing: false, activeIndex: -1, phase: 'idle' })
    setChatMessages(chatMessagesFromVoiceTurns(voiceTurns))
  }, [])

  return (
    <section data-qid="embry-voice:route" className={`h-full min-h-0 grid grid-rows-[auto_minmax(0,1fr)] ${surfaceClass}`}>
      <header className="border-b border-[#2d2d31] px-5 py-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-lg font-bold"><Mic className="w-5 h-5" />Embry Voice Chat</div>
          <div className={`mt-1 text-xs ${mutedTextClass}`}>Shared chat UX with synchronized Chatterbox audio, memory trace, and session replay.</div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <StatusPill label="memory-first voice lab" tone="good" />
          <StatusPill label="Chatterbox Turbo" />
          <StatusPill label="Embry" />
        </div>
      </header>

      <div className="min-h-0 grid grid-cols-[auto_minmax(0,1fr)_320px] gap-3 p-3">
        <SessionController
          turns={voiceTurns}
          folders={sessionFolders}
          replayState={replayState}
          onReplay={replaySession}
          onStopReplay={stopReplay}
        />

        <section data-qid="embry-voice:shared-chat-pane" className={`min-h-0 overflow-hidden ${panelClass}`}>
          <SharedChatShell
            projectLabel="Embry Voice"
            shellQid="embry-voice:shared-chat-shell"
            qid="embry-voice:shared-chat"
            surface="shared-chat"
            defaultMode="personaplex"
            showModeToggle={false}
            messages={chatMessages}
            onMessagesChange={setChatMessages}
            adapterOptions={{ personaplex: { personaId: 'embry', surface: 'ux-lab/embry-voice' } }}
            context={{
              memory_first: true,
              simultaneous_text_voice: true,
              renderer: '/home/graham/workspace/experiments/agent-skills/agents/embry-chatterbox-voice',
            }}
            emptyTitle="Talk to Embry"
            emptyDescription="Voice and text share the same turn record. Chatterbox audio artifacts render inside the shared chat timeline."
            placeholder="Talk to Embry..."
            starterChips={[
              { label: 'Known memory answer', prompt: 'Embry, what do you remember about Horus?' },
              { label: 'One at a time', prompt: 'Two people are talking at once; ask for one speaker.' },
              { label: 'Factory stress', prompt: 'Run the Horus factory-floor listening check.' },
            ]}
            mediaUrl={artifactUrl}
            voiceEnabled={voiceEnabled}
            voiceStatus={replayState.playing ? 'speaking' : voiceEnabled ? 'listening' : 'off'}
            voiceLabel="Embry voice"
            onVoiceToggle={setVoiceEnabled}
          />
        </section>

        <aside className="min-h-0">
          <StateController
            turns={voiceTurns}
            selectedTurn={selectedTurn}
            selectedRun={selectedRun}
            gateSummary={gateSummary}
            selectedRunId={selectedRunId}
            replayState={replayState}
            onSelectTurn={focusTurn}
            onInspect={focusRun}
            onClearInspect={() => setSelectedRunId('')}
          />
        </aside>
      </div>
    </section>
  )
}

function SessionController({
  turns,
  folders,
  replayState,
  onReplay,
  onStopReplay,
}: {
  turns: VoiceTurn[]
  folders: SessionFolder[]
  replayState: ReplayState
  onReplay: (session?: TestSession) => void
  onStopReplay: () => void
}): JSX.Element {
  const totalAudio = turns.reduce((count, turn) => count + turn.audioArtifacts.length, 0)
  const replayProgress = replayState.playing ? Math.min(100, Math.max(6, ((replayState.visibleTurnCount ?? 0) / Math.max(1, turns.length)) * 100)) : 0
  return (
    <LeftPane
      title="Sessions"
      width={300}
      searchable
      searchTestId="embry-voice:sessions:search"
      searchPlaceholder="Filter sessions"
    >
      <div style={{ padding: '8px 12px 12px' }}>
        <SessionItem
          title="Embry / Horus voice"
          subtitle={`${turns.length} turns | ${totalAudio} audio | memory-first`}
          isActive={replayState.playing && !replayState.activeSessionId}
          progress={!replayState.activeSessionId ? replayProgress : 0}
          onPlay={replayState.playing && !replayState.activeSessionId ? onStopReplay : () => onReplay()}
        />
      </div>
      <SessionFolderList
        turns={turns}
        folders={folders}
        replayState={replayState}
        replayProgress={replayProgress}
        onReplay={onReplay}
        onStopReplay={onStopReplay}
      />
    </LeftPane>
  )
}

function SessionFolderList({
  turns,
  folders,
  replayState,
  replayProgress,
  onReplay,
  onStopReplay,
}: {
  turns: VoiceTurn[]
  folders: SessionFolder[]
  replayState: ReplayState
  replayProgress: number
  onReplay: (session?: TestSession) => void
  onStopReplay: () => void
}): JSX.Element {
  const query = useLeftPaneSearch().trim().toLowerCase()
  return (
    <>
      {folders.map((folder) => {
        const sessions = folder.sessions.filter((session) => {
          if (!query) return true
          return `${folder.title} ${session.title} ${session.subtitle}`.toLowerCase().includes(query)
        })
        if (!sessions.length) return null
        return (
          <LeftPaneSection
            key={folder.id}
            title={(
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Folder size={13} />
                {folder.title}
              </span>
            )}
          >
            <div style={{ display: 'grid', gap: 8, padding: '4px 12px 12px' }}>
              {sessions.map((session) => {
                const active = replayState.activeSessionId === session.id
                const sessionTurnCount = session.turnIds.length
                const sessionAudioCount = session.turnIds.reduce((count, turnId) => {
                  const turn = turns.find((candidate) => candidate.id === turnId)
                  return count + (turn?.audioArtifacts.length ?? 0)
                }, 0)
                return (
                  <SessionItem
                    key={session.id}
                    title={session.title}
                    subtitle={`${sessionTurnCount} turns | ${sessionAudioCount} audio | ${session.subtitle}`}
                    isActive={active}
                    progress={active ? replayProgress : 0}
                    onPlay={active && replayState.playing ? onStopReplay : () => onReplay(session)}
                  />
                )
              })}
            </div>
          </LeftPaneSection>
        )
      })}
    </>
  )
}

function SessionItem({
  title,
  subtitle,
  isActive,
  progress,
  onPlay,
}: {
  title: string
  subtitle: string
  isActive: boolean
  progress: number
  onPlay: () => void
}): JSX.Element {
  return (
    <div className={`border p-3 ${isActive ? 'border-emerald-300/50 bg-emerald-400/10' : 'border-[#2d2d31] bg-[#17171a]'}`} style={{ minWidth: 0, overflow: 'hidden' }}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-[#e4e4e7]">{title}</div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-zinc-500" style={{ lineHeight: 1.5, overflowWrap: 'anywhere' }}>{subtitle}</div>
        </div>
        <button
          type="button"
          data-qid="embry-voice:session-play"
          data-qs-action="EMBRY_VOICE_REPLAY_SESSION"
          onClick={onPlay}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-300/30 text-emerald-200 hover:bg-emerald-400/15"
          title={isActive ? 'Pause replay' : 'Replay session'}
        >
          {isActive ? <PauseCircle className="h-5 w-5" /> : <PlayCircle className="h-5 w-5" />}
        </button>
      </div>
      {isActive && (
        <div className="mt-3 h-1 overflow-hidden bg-zinc-900">
          <div className="h-full bg-emerald-400 transition-all duration-150" style={{ width: `${progress}%` }} />
        </div>
      )}
    </div>
  )
}

function AuditFeed({
  turns,
  selectedTurnId,
  selectedRun,
  replayState,
  sessionArtifacts,
  gateSummary,
  receiptRefs,
  onSelectTurn,
  onClearInspect,
}: {
  turns: VoiceTurn[]
  selectedTurnId: string
  selectedRun?: SanityRun
  replayState: ReplayState
  sessionArtifacts: Array<AudioArtifact & { turnId: string }>
  gateSummary: { passed: number; pending: number; failed: number }
  receiptRefs: React.MutableRefObject<Record<string, HTMLElement | null>>
  onSelectTurn: (turnId: string) => void
  onClearInspect: () => void
}): JSX.Element {
  const visibleTurns = replayState.playing ? turns.slice(0, replayState.visibleTurnCount ?? 0) : turns
  const activeTurn = turns.find((turn) => turn.id === replayState.activeTurnId)
  return (
    <section data-qid="embry-voice:audit-feed" className={`min-h-0 grid grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden ${panelClass}`}>
      <header className="flex items-center justify-between gap-3 border-b border-[#2d2d31] px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-[#e4e4e7]"><ClipboardList className="h-4 w-4" />Live Render Audit Log</div>
          <div className={`mt-1 text-[11px] ${mutedTextClass}`}>Receipts stream into this feed during replay; each card owns transcript, trace, audio, and evidence path.</div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <StatusPill label={`lat ${activeTurn?.telemetry.find((item) => item.label.toLowerCase() === 'lat')?.value ?? '36ms'}`} tone="good" />
          <StatusPill label="mem active" tone="good" />
          <StatusPill label={`gates ${gateSummary.passed}/${gateSummary.passed + gateSummary.failed + gateSummary.pending}`} tone={gateSummary.failed ? 'warn' : 'good'} />
        </div>
      </header>
      <TimelineProgress artifacts={sessionArtifacts} activeIndex={replayState.activeIndex} />
      <div className="min-h-0 overflow-auto p-4">
        <div className="grid gap-3">
          <AnimatePresence initial={false}>
          {visibleTurns.map((turn) => (
            <EmbryReceipt
              key={turn.id}
              turn={turn}
              selected={selectedTurnId === turn.id}
              selectedRun={selectedTurnId === turn.id ? selectedRun : undefined}
              activeAudioIndex={replayState.activeIndex}
              active={replayState.activeTurnId === turn.id}
              allArtifacts={sessionArtifacts}
              refSetter={(node) => { receiptRefs.current[turn.id] = node }}
              onSelect={() => onSelectTurn(turn.id)}
              onClearInspect={onClearInspect}
            />
          ))}
          </AnimatePresence>
        </div>
      </div>
    </section>
  )
}

function StateController({
  turns,
  selectedTurn,
  selectedRun,
  gateSummary,
  selectedRunId,
  replayState,
  onSelectTurn,
  onInspect,
  onClearInspect,
}: {
  turns: VoiceTurn[]
  selectedTurn?: VoiceTurn
  selectedRun?: SanityRun
  gateSummary: { passed: number; pending: number; failed: number }
  selectedRunId: string
  replayState: ReplayState
  onSelectTurn: (turnId: string, runId?: string) => void
  onInspect: (runId: string) => void
  onClearInspect: () => void
}): JSX.Element {
  return (
    <Panel title="State Controller" icon={<FlaskConical className="w-4 h-4" />}>
      <GateDashboard summary={gateSummary} />
      <div className={`mb-3 p-3 ${panelSoftClass}`}>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Receipt Navigation</div>
        <div className="mt-2 grid gap-2">
          {turns.map((turn, index) => {
            const active = replayState.activeTurnId === turn.id
            const selected = selectedTurn?.id === turn.id
            return (
              <button
                key={turn.id}
                type="button"
                data-qid="embry-voice:controller-turn"
                onClick={() => onSelectTurn(turn.id)}
                className={`grid gap-1 border p-2 text-left transition-colors duration-150 ${active ? 'border-emerald-300/60 bg-emerald-400/10' : selected ? 'border-cyan-400/50 bg-cyan-400/10' : 'border-[#2d2d31] bg-[#17171a] hover:border-zinc-600'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px] uppercase text-zinc-500">turn {index + 1}</span>
                  <StatusPill label={turnStatus(turn)} tone={turnStatus(turn) === 'pass' ? 'good' : 'warn'} />
                </div>
                <div className="line-clamp-2 text-[11px] font-medium leading-relaxed text-[#d4d4d8]">{turn.userText}</div>
              </button>
            )
          })}
        </div>
      </div>
      {selectedTurn && (
        <section data-qid="embry-voice:turn-detail" className={`mb-3 p-3 ${panelSoftClass}`}>
          <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">Selected Receipt</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {selectedTurn.speaker && <StatusPill label={`speaker ${selectedTurn.speaker}`} tone="good" />}
            {selectedTurn.memoryAction && <StatusPill label={`memory ${selectedTurn.memoryAction}`} />}
            {selectedTurn.tone && <StatusPill label={selectedTurn.tone} />}
            {selectedTurn.telemetry.map((item) => <StatusPill key={`${item.label}:${item.value}`} label={`${item.label}: ${item.value}`} tone={item.warn ? 'warn' : undefined} />)}
          </div>
          <div className="mt-3 break-all font-mono text-[10px] uppercase tracking-[0.1em] text-zinc-500">
            Ran {selectedTurn.componentPath}<br />{selectedTurn.receiptPath}
          </div>
        </section>
      )}
      {selectedRun && <InspectReceipt run={selectedRun} onClear={onClearInspect} compact />}
      <RegistryGroup
        title="Sanity Runs"
        runs={sanityRuns}
        selectedRunId={selectedRunId}
        onInspect={onInspect}
      />
    </Panel>
  )
}

function TimelineProgress({ artifacts, activeIndex }: { artifacts: Array<AudioArtifact & { turnId: string }>; activeIndex: number }): JSX.Element {
  return (
    <div data-qid="embry-voice:timeline-progress" className="border-b border-[#2d2d31] px-4 py-2">
      <div className="flex items-center gap-1">
        {artifacts.map((artifact, index) => (
          <div
            key={`${artifact.turnId}:${artifact.id}`}
            title={artifact.label}
            className={`h-1.5 flex-1 ${index === activeIndex ? 'bg-emerald-300' : index < activeIndex ? 'bg-emerald-700/60' : 'bg-zinc-800'}`}
          />
        ))}
      </div>
      <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.16em] text-zinc-600">
        {activeIndex >= 0 ? `replay_audio_${activeIndex + 1}_of_${artifacts.length}` : `${artifacts.length}_audio_artifacts_ready`}
      </div>
    </div>
  )
}

function EmbryReceipt({
  turn,
  selected,
  selectedRun,
  activeAudioIndex,
  active,
  allArtifacts,
  refSetter,
  onSelect,
  onClearInspect,
}: {
  turn: VoiceTurn
  selected: boolean
  selectedRun?: SanityRun
  activeAudioIndex: number
  active: boolean
  allArtifacts: Array<AudioArtifact & { turnId: string }>
  refSetter: (node: HTMLElement | null) => void
  onSelect: () => void
  onClearInspect: () => void
}): JSX.Element {
  const reducedMotion = useReducedMotion()
  const [traceOpen, setTraceOpen] = useState(false)
  const warn = turn.telemetry.some((item) => item.warn)
  return (
    <motion.article
      data-qid="embry-voice:receipt-card"
      ref={refSetter}
      onClick={onSelect}
      initial={reducedMotion ? false : { opacity: 0, x: -10 }}
      animate={reducedMotion ? undefined : { opacity: 1, x: 0 }}
      transition={{ duration: 0.15, ease: 'easeInOut' }}
      className={`cursor-pointer p-4 font-mono shadow-none transition-colors duration-150 ${active ? 'border border-emerald-300/70 bg-emerald-400/10' : selected || selectedRun ? 'border border-cyan-400/60 bg-[#17171a]' : warn ? 'border border-orange-400/60 bg-[#17171a]' : `${cardClass} hover:border-zinc-600`}`}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`text-[10px] font-bold uppercase tracking-widest ${turnStatus(turn) === 'pass' ? 'text-emerald-400' : turnStatus(turn) === 'clarify' ? 'text-orange-300' : 'text-red-300'}`}>{turnStatus(turn)}</span>
          <span className="text-[10px] uppercase text-zinc-500">{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <span className="min-w-0 truncate text-[9px] uppercase tracking-widest text-zinc-600">{turn.componentPath}</span>
      </div>

      <div className="mb-3 grid gap-3 text-[13px] font-medium leading-6 text-[#e4e4e7]">
        <div><span className="text-[9px] uppercase tracking-widest text-zinc-600">Request </span>{decorateText(turn.userText, turn)}</div>
        <div><span className="text-[9px] uppercase tracking-widest text-zinc-600">Embry </span>{decorateText(turn.assistantText, turn)}</div>
      </div>

      <button
        type="button"
        data-qid="embry-voice:receipt-toggle-trace"
        onClick={(event) => {
          event.stopPropagation()
          setTraceOpen((open) => !open)
        }}
        className="mb-3 border border-[#2d2d31] px-2 py-1 text-[9px] uppercase tracking-[0.16em] text-[#a1a1aa] hover:border-emerald-300/40 hover:text-emerald-300"
      >
        {traceOpen ? '[-] hide reasoning trace' : '[+] expand reasoning trace'}
      </button>

      <AnimatePresence initial={false}>
        {traceOpen && (
          <motion.div
            data-qid="embry-voice:receipt-inline-trace"
            initial={reducedMotion ? false : { height: 0, opacity: 0 }}
            animate={reducedMotion ? undefined : { height: 'auto', opacity: 1 }}
            exit={reducedMotion ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeInOut' }}
            className="mb-4 overflow-hidden border border-[#2d2d31] bg-[#121214] p-3"
          >
            <div className="mb-2 text-[9px] uppercase tracking-[0.18em] text-zinc-400">$memory reasoning trace</div>
            <div className="grid gap-2">
              {memoryReasoningTraceForTurn(turn).map((step) => (
                <div key={step.id} className="grid grid-cols-[92px_1fr] gap-3 text-[9px]">
                  <span className={step.status === 'completed' ? 'uppercase text-emerald-400' : 'uppercase text-orange-300'}>{String(step.status)}</span>
                  <span className="text-[#d4d4d8]"><span className="font-medium text-[#e4e4e7]">{step.label}: </span>{step.detail}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AudioList artifacts={turn.audioArtifacts} turnId={turn.id} activeAudioIndex={activeAudioIndex} allArtifacts={allArtifacts} />
      <div className="mt-3 flex flex-wrap gap-1.5">
        {[turn.speaker, turn.memoryAction, turn.tone, ...turn.telemetry.map((item) => `${item.label}: ${item.value}`)].filter(Boolean).map((tag) => (
          <span key={String(tag)} className="border border-[#2d2d31] bg-[#202024] px-1.5 py-0.5 text-[8px] uppercase text-[#a1a1aa]">{tag}</span>
        ))}
      </div>
      <AnimatePresence initial={false}>
        {selectedRun && <InspectReceipt key={selectedRun.id} run={selectedRun} onClear={onClearInspect} compact />}
      </AnimatePresence>
      <div className="mt-3 border-t border-[#2d2d31] pt-2 text-[10px] uppercase tracking-[0.12em] text-[#a1a1aa]">
        Ran {turn.componentPath} | {turn.receiptPath}
      </div>
    </motion.article>
  )
}

function InspectReceipt({ run, onClear, compact = false }: { run: SanityRun; onClear: () => void; compact?: boolean }): JSX.Element {
  const reducedMotion = useReducedMotion()
  const trace = {
    id: run.id,
    component_path: run.componentPath,
    receipt_path: run.receiptPath,
    live: run.live,
    mocked: run.mocked,
    failed_gates: run.failedGates,
    gates: run.gates,
    proves: run.proves,
    does_not_prove: run.doesNotProve,
  }
  return (
    <motion.article
      data-qid="embry-voice:inspect-receipt"
      initial={reducedMotion ? false : { opacity: 0, y: -4 }}
      animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
      exit={reducedMotion ? undefined : { opacity: 0, y: -4 }}
      transition={{ duration: 0.15, ease: 'easeInOut' }}
      className={`${compact ? 'mt-3' : 'mb-4'} border border-cyan-400/40 bg-cyan-950/10 p-4`}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-cyan-100"><SearchCode className="h-4 w-4" />Inspect: {run.label}</div>
          <div className="mt-1 break-all font-mono text-[10px] uppercase tracking-[0.12em] text-cyan-300/70">{run.receiptPath}</div>
        </div>
        <button type="button" onClick={onClear} className="border border-cyan-300/20 px-2 py-1 font-mono text-[10px] uppercase text-cyan-200 hover:bg-cyan-300/10">Close</button>
      </div>
      <pre className={`${compact ? 'max-h-44' : 'max-h-56'} mt-3 overflow-auto border border-cyan-300/15 bg-[#121214] p-3 text-[11px] leading-relaxed text-cyan-50`}>{JSON.stringify(trace, null, 2)}</pre>
    </motion.article>
  )
}

function Panel({ title, icon, children }: { title: string; icon: JSX.Element; children: React.ReactNode }): JSX.Element {
  return (
    <section className={`min-h-0 grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden ${panelClass}`}>
      <header className="flex items-center gap-2 border-b border-[#2d2d31] px-3 py-2 text-sm font-bold text-[#e4e4e7]">{icon}{title}</header>
      <div className="min-h-0 overflow-auto p-3">{children}</div>
    </section>
  )
}

function GateDashboard({ summary }: { summary: { passed: number; pending: number; failed: number } }): JSX.Element {
  return (
    <div data-qid="embry-voice:gate-dashboard" className="mb-3 grid grid-cols-3 gap-2">
      <Metric label="passed_gates" value={summary.passed} tone="good" />
      <Metric label="pending_gates" value={summary.pending} />
      <Metric label="failed_gates" value={summary.failed} tone={summary.failed ? 'bad' : 'good'} />
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' }): JSX.Element {
  const text = tone === 'good' ? 'text-emerald-200' : tone === 'bad' ? 'text-red-200' : 'text-zinc-200'
  return (
    <div className="border border-[#2d2d31] bg-[#17171a] p-2">
      <div className={`font-mono text-lg font-bold ${text}`}>{value}</div>
      <div className="mt-0.5 font-mono text-[9px] uppercase tracking-[0.14em] text-zinc-600">{label}</div>
    </div>
  )
}

function RegistryGroup({ title, runs, selectedRunId, onInspect }: { title: string; runs: SanityRun[]; selectedRunId: string; onInspect: (id: string) => void }): JSX.Element {
  if (!runs.length) return <div className="mb-3 border border-zinc-900 p-2 font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">{title}: none</div>
  return (
    <div className="mb-4">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-500">{title}</div>
      <div className="grid gap-2">
        {runs.map((run) => <SanityCard key={run.id} run={run} selected={run.id === selectedRunId} onInspect={() => onInspect(run.id)} />)}
      </div>
    </div>
  )
}

function SanityCard({ run, selected, onInspect }: { run: SanityRun; selected: boolean; onInspect: () => void }): JSX.Element {
  const reducedMotion = useReducedMotion()
  return (
    <article data-qid="embry-voice:sanity-card" className={`border bg-[#17171a] p-3 ${selected ? 'border-cyan-400/50' : 'border-[#2d2d31]'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={onInspect} className="flex min-w-0 items-center gap-2 text-left text-sm font-bold text-[#e4e4e7] hover:text-cyan-100">
            {run.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-300" /> : <XCircle className="w-4 h-4 shrink-0 text-red-300" />}
            <span className="min-w-0 truncate">{run.label}</span>
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${selected ? 'rotate-180' : ''}`} />
          </button>
          <button type="button" onClick={onInspect} className="mt-1 block break-all text-left font-mono text-[10px] text-[#a1a1aa] hover:text-cyan-300">[Inspect] {run.receiptPath}</button>
        </div>
        <Radio className={`mt-0.5 h-4 w-4 shrink-0 text-zinc-500 ${run.active && !reducedMotion ? 'animate-pulse' : ''}`} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <StatusPill label={run.live ? 'live' : 'not live'} tone={run.live ? 'good' : 'bad'} />
        <StatusPill label={run.mocked ? 'mocked' : 'not mocked'} tone={run.mocked ? 'bad' : 'good'} />
        {run.facts.map((fact) => <StatusPill key={fact} label={fact} />)}
      </div>
      <AnimatePresence initial={false}>
        {selected && (
          <motion.div
            initial={reducedMotion ? false : { opacity: 0, height: 0 }}
            animate={reducedMotion ? undefined : { opacity: 1, height: 'auto' }}
            exit={reducedMotion ? undefined : { opacity: 0, height: 0 }}
            transition={{ duration: 0.15, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <GateList gates={run.gates} />
            <div className={`mt-2 font-mono text-[11px] ${run.failedGates.length ? 'text-red-200' : 'text-emerald-200'}`}>failed_gates={run.failedGates.length ? run.failedGates.join(',') : '[]'}</div>
            <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-zinc-400">
              <div>proves: {run.proves.join('; ')}</div>
              <div>does_not_prove: {run.doesNotProve.join('; ')}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  )
}

function GateList({ gates }: { gates: SanityRun['gates'] }): JSX.Element {
  return (
    <div className="mt-3 grid gap-1.5">
      {gates.map((gate) => (
        <div key={gate.name} className="grid grid-cols-[82px_1fr_auto] gap-2 border border-zinc-900 bg-zinc-950/70 px-2 py-1.5 font-mono text-[10px]">
          <span className={gate.status === 'passed' ? 'text-emerald-300' : gate.status === 'failed' ? 'text-red-300' : 'text-zinc-400'}>{gate.status}</span>
          <span className="min-w-0 truncate text-zinc-400" title={gate.detail}>{gate.name}: {gate.detail}</span>
          <span className="text-zinc-600">{gate.latencyMs !== undefined ? `${gate.latencyMs}ms` : '-'}</span>
        </div>
      ))}
    </div>
  )
}

function AudioList({
  artifacts,
  turnId,
  activeAudioIndex,
  allArtifacts,
}: {
  artifacts: AudioArtifact[]
  turnId: string
  activeAudioIndex?: number
  allArtifacts?: Array<AudioArtifact & { turnId: string }>
}): JSX.Element {
  return (
    <div data-qid="embry-voice:embedded-audio" className="mt-3 grid gap-2">
      {artifacts.map((artifact) => (
        <div key={artifact.id} className={`grid gap-1 border p-2 ${allArtifacts?.[activeAudioIndex ?? -1]?.id === artifact.id ? 'border-emerald-300/60 bg-emerald-400/10' : 'border-[#2d2d31] bg-[#17171a]'}`}>
          <div className="flex items-center gap-1.5 text-xs text-slate-300"><PlayCircle className="h-3.5 w-3.5" />{artifact.label}</div>
          <audio data-embry-session-audio={`${turnId}:${artifact.id}`} controls preload="metadata" src={artifact.url} className="h-8 w-full" />
        </div>
      ))}
    </div>
  )
}

function StatusPill({ label, tone }: { label: string; tone?: 'good' | 'bad' | 'warn' }): JSX.Element {
  const toneClass = tone === 'good'
    ? 'border-emerald-300/25 text-emerald-200'
    : tone === 'bad'
      ? 'border-red-300/25 text-red-200'
      : tone === 'warn'
        ? 'border-orange-300/35 text-orange-200'
      : 'border-white/10 text-slate-300'
  return <span className={`inline-flex min-h-6 items-center border bg-[#1f1f23] px-2 font-mono text-[10px] uppercase tracking-[0.08em] ${toneClass}`}>{label}</span>
}

function summarizeGates(runs: SanityRun[]): { passed: number; pending: number; failed: number } {
  return runs.reduce(
    (summary, run) => {
      for (const gate of run.gates) summary[gate.status] += 1
      return summary
    },
    { passed: 0, pending: 0, failed: 0 },
  )
}

export default EmbryVoiceLabRoute

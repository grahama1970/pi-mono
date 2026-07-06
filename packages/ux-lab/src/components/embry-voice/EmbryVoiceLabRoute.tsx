import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CheckCircle2, ChevronDown, FlaskConical, Folder, Mic, PauseCircle, PlayCircle, Radio, SearchCode, XCircle } from 'lucide-react'
import { LeftPane, LeftPaneSection, useLeftPaneSearch } from '../common/LeftPane'
import { SharedChatShell } from '../shared-chat/SharedChatShell'
import { IdentityNode } from './IdentityNode'
import type { EmbryVoiceStatus } from './EmbryVoiceOrb'
import { deriveEmbryVoiceStatus } from './embryOrbState'
import type { ChatMessage, StreamingStep } from '../shared-chat/memory-turn'
import type { EmbryTurnAuthority, EmbryVoiceAudioAuthority } from '@agent-skills/ux-lab-ui/memory-turn/EmbryVoiceAuthority'
import type { EmbryVoiceEnvelope } from '../../hooks/useEmbryPlaybackAudioLevel'

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
  audioAuthority?: EmbryVoiceAudioAuthority
  turnAuthority?: EmbryTurnAuthority
  relatedRunIds: string[]
}

type ReplayPhase = 'idle' | 'request' | 'thinking' | 'response' | 'complete' | 'interrupted'
type ReplayState = { playing: boolean; activeIndex: number; activeTurnId?: string; activeSessionId?: string; phase: ReplayPhase; visibleTurnCount?: number }
type OrbStatusOverride = Exclude<EmbryVoiceStatus, 'off' | 'error'> | null
type EmbryAudioAuthority = EmbryVoiceAudioAuthority & {
  authority: 'server-chatterbox-wav-envelope-v1'
  artifactId: string
  url: string
  path?: string
  sha256?: string
  durationMs?: number
  localPlayback?: {
    requested?: boolean
    driver?: string
    command?: string
    target?: string
    targetArgUsed?: boolean
    pid?: number
    startedAtEpochMs?: number
  } | null
  envelope?: EmbryVoiceEnvelope
}

type DirectEmbryAudio = {
  id: string
  text: string
  url: string
  path?: string
  receiptUrl?: string
  startedAtMs?: number
  voiceEnvelope?: EmbryVoiceEnvelope
  audioAuthority?: EmbryAudioAuthority
  turnAuthority?: EmbryTurnAuthority
}
type ActiveSpeechSource = {
  id: string
  turnId?: string
  audioElement: HTMLMediaElement
  source: 'direct' | 'replay' | 'live-turn' | 'visible'
  text?: string
  audioUrl?: string
  startedAtMs?: number
  voiceEnvelope?: EmbryVoiceEnvelope
}

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
const mutedTextClass = 'text-[#a1a1aa]'

function artifactUrl(path: string): string {
  return `/chatterbox-artifacts${path.replace('/tmp/chatterbox-fork-agent-out', '')}`
}

function artifact(id: string, label: string, path: string): AudioArtifact {
  return { id, label, path, url: artifactUrl(path) }
}

function serverEpochToClientPerfMs(startedAtEpochMs?: number): number {
  if (!startedAtEpochMs || !Number.isFinite(startedAtEpochMs)) return performance.now()
  return performance.now() - Math.max(0, Date.now() - startedAtEpochMs)
}

function authorityRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function turnAuthorityForVoiceTurn(turn: VoiceTurn, createdAt: string): EmbryTurnAuthority {
  const audioAuthority = turn.audioAuthority
  return turn.turnAuthority ?? {
    turnId: turn.id,
    userText: turn.userText,
    assistantText: turn.assistantText,
    personaId: 'embry',
    speakerId: turn.speaker,
    createdAt,
    memoryFirst: true,
    simultaneousTextVoice: true,
    receiptPath: turn.receiptPath,
    audioAuthority,
    audioArtifacts: audioAuthority ? [authorityRecord(audioAuthority)] : turn.audioArtifacts.map((audio) => ({
      id: audio.id,
      label: audio.label,
      path: audio.path,
      url: audio.url,
    } as Record<string, unknown>)),
    memoryTrace: {
      action: turn.memoryAction,
      telemetry: turn.telemetry,
    },
    live: true,
    mocked: false,
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function firstStringValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
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

function sessionTitleForReplay(sessionId?: string): string {
  if (!sessionId) return 'All seeded Embry voice turns'
  for (const folder of sessionFolders) {
    const session = folder.sessions.find((candidate) => candidate.id === sessionId)
    if (session) return `${folder.title} / ${session.title}`
  }
  return sessionId
}

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

type EmbryEntitySpan = { text?: string; span: [number, number]; kind?: string; name?: string; framework?: string; grounded_to_framework?: boolean }

function spanPairFromUnknown(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length !== 2) return null
  const [start, end] = value
  return typeof start === 'number' && typeof end === 'number' && end > start ? [start, end] : null
}

function entitySpanFromExtractNode(value: unknown): EmbryEntitySpan | null {
  const record = asRecord(value)
  if (!record) return null
  const metadata = asRecord(record.metadata) ?? {}
  const extracted = asRecord(record.extracted) ?? {}
  const span = spanPairFromUnknown(record.span) ?? spanPairFromUnknown(extracted.span)
  if (!span) return null
  const text = firstStringValue(record.mention, record.text, record.entity, extracted.text, metadata.control_id, metadata.name)
  const name = firstStringValue(metadata.name, record.name, text)
  const framework = firstStringValue(metadata.framework, record.framework)
  const kind = firstStringValue(extracted.kind, record.kind, record.node_kind, metadata.type)
  return {
    text: text || undefined,
    span,
    kind: kind || undefined,
    name: name || undefined,
    framework: framework || undefined,
    grounded_to_framework: metadata.grounded === true || metadata.exists === true || record.status === 'grounded',
  }
}

function entitySpansFromEntityContext(value: unknown): EmbryEntitySpan[] {
  const record = asRecord(value)
  if (!record) return []
  const nodes = asRecord(record.nodes)
  const sources = nodes
    ? [nodes.anchors, nodes.validated_context, nodes.context_terms, nodes.unsupported]
    : [record.entities, record.entitySpans, record.entity_spans, record.spans]
  return sources
    .flatMap((source) => Array.isArray(source) ? source : [])
    .map(entitySpanFromExtractNode)
    .filter((span): span is EmbryEntitySpan => Boolean(span))
}

function chatMessagesForTurn(turn: VoiceTurn, index: number): ChatMessage[] {
  const createdAt = new Date(Date.UTC(2026, 6, 4, 18, 25 + index, 0)).toISOString()
  const userContent = `${turn.userText}${turn.speaker ? ` ${turn.speaker}` : ''} ${turn.memoryAction ?? ''} ${turn.tone ?? ''}`.trim()
  const assistantContent = `${turn.assistantText} ${turn.memoryAction ?? ''} ${turn.tone ?? ''}`.trim()
  const turnAuthority = turnAuthorityForVoiceTurn(turn, createdAt)
  const baseMetadata = {
    surface: 'ux-lab/embry-voice',
    branch: 'embry-voice',
    inputChannel: 'voice',
    turnId: turn.id,
    speaker: turn.speaker ?? 'unknown',
    tone: turn.tone,
    memoryAction: turn.memoryAction,
    componentPath: turn.componentPath,
    receiptPath: turn.receiptPath,
    telemetry: turn.telemetry,
    audioAuthority: turn.audioAuthority,
    turnAuthority,
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
        disclosureVariant: 'thinking',
        entitySpans: entitySpansForMessage(assistantContent, turn),
        audioArtifacts: turn.audioArtifacts.map((audio) => ({
          id: `${turn.id}:${audio.id}`,
          label: audio.label,
          url: audio.url,
          path: audio.path,
        })),
        audioAuthority: turn.audioAuthority,
        turnAuthority,
      },
    },
  ]
}

function chatMessagesFromVoiceTurns(turns: VoiceTurn[]): ChatMessage[] {
  return turns.flatMap((turn, index) => chatMessagesForTurn(turn, index))
}

function replayThinkingStepsForTurn(turn: VoiceTurn, activeIndex: number): StreamingStep[] {
  const definitions: Array<Pick<StreamingStep, 'id' | 'label' | 'detail'>> = [
    {
      id: 'speaker-resolve',
      label: 'Resolve speaker identity',
      detail: turn.speaker
        ? `Horus voice resolved as ${turn.speaker}; speaker-scoped memory may be used.`
        : 'Speaker is unknown; personal memory recall must fail closed.',
    },
    {
      id: 'extracting-entities',
      label: 'Extract voice entities',
      detail: [turn.speaker, turn.memoryAction, turn.tone].filter(Boolean).join(' | ') || 'No grounded voice entities attached.',
    },
    {
      id: 'looking-in-memory',
      label: 'Run memory intent and recall',
      detail: `/intent selected ${turn.memoryAction ?? 'CLARIFY'} before Chatterbox render.`,
    },
    {
      id: 'persona-answer',
      label: 'Render Chatterbox audio',
      detail: turn.audioArtifacts.length
        ? `${turn.audioArtifacts.length} Chatterbox artifact(s) attached to the shared chat turn.`
        : 'No Chatterbox audio artifact attached.',
    },
  ]
  return definitions.map((step, index) => ({
    ...step,
    kind: 'step',
    branch: 'embry-voice',
    disclosureVariant: 'thinking',
    liveStatusLabel: step.label,
    status: index < activeIndex ? 'completed' : index === activeIndex ? 'running' : 'pending',
  }))
}

function scrollSharedChatToBottom(): void {
  const messagePane = document.querySelector<HTMLElement>('[data-qid="embry-voice:shared-chat:messages"]')
  if (!messagePane) return
  messagePane.scrollTo({ top: messagePane.scrollHeight, behavior: 'smooth' })
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

export function EmbryVoiceLabRoute(): JSX.Element {
  const [selectedRunId, setSelectedRunId] = useState<string>(initialVisibleTurn?.relatedRunIds[0] ?? sanityRuns[0]?.id ?? '')
  const [selectedTurnId, setSelectedTurnId] = useState<string>(initialVisibleTurn?.id ?? '')
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => chatMessagesFromVoiceTurns(voiceTurns))
  const [streamingSteps, setStreamingSteps] = useState<StreamingStep[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [replayState, setReplayState] = useState<ReplayState>({ playing: false, activeIndex: -1, phase: 'idle' })
  const [orbStatusOverride, setOrbStatusOverride] = useState<OrbStatusOverride>(null)
  const orbPhaseSpeedMs = 650
  const [activeSpeech, setActiveSpeech] = useState<ActiveSpeechSource | null>(null)
  const [lastTurnAuthority, setLastTurnAuthority] = useState<EmbryTurnAuthority | null>(null)
  const [directSpeakBusy, setDirectSpeakBusy] = useState(false)
  const replayStopRef = useRef(false)
  const directSpeakBusyRef = useRef(false)
  const directPlaybackAudioRef = useRef<HTMLAudioElement | null>(null)
  const directPlaybackRunRef = useRef(0)
  const activeSpeechIdRef = useRef('')
  const selectedRun = sanityRuns.find((run) => run.id === selectedRunId)
  const selectedTurn = voiceTurns.find((turn) => turn.id === selectedTurnId) ?? voiceTurns[0]
  const gateSummary = useMemo(() => summarizeGates(sanityRuns), [])
  const liveVoiceStatus = deriveEmbryVoiceStatus({ voiceEnabled, replayPhase: replayState.phase })
  const effectiveVoiceStatus = orbStatusOverride ?? liveVoiceStatus

  const focusTurn = useCallback((turnId: string, runId?: string) => {
    setSelectedTurnId(turnId)
    if (runId) setSelectedRunId(runId)
    else {
      const relatedRun = voiceTurns.find((turn) => turn.id === turnId)?.relatedRunIds[0]
      if (relatedRun) setSelectedRunId(relatedRun)
    }
  }, [])

  const focusRun = useCallback((runId: string) => {
    const turn = voiceTurns.find((candidate) => candidate.relatedRunIds.includes(runId))
    if (turn) focusTurn(turn.id, runId)
    else setSelectedRunId(runId)
  }, [focusTurn])

  const bindActiveSpeech = useCallback((source: ActiveSpeechSource) => {
    activeSpeechIdRef.current = source.id
    setActiveSpeech(source)
    setOrbStatusOverride('speaking')
  }, [])

  const clearActiveSpeech = useCallback((speechId: string) => {
    if (activeSpeechIdRef.current !== speechId) return
    activeSpeechIdRef.current = ''
    setActiveSpeech(null)
    setOrbStatusOverride((current) => (current === 'speaking' ? null : current))
  }, [])

  const handleMessagesChange = useCallback((...args: unknown[]) => {
    const [messages] = args
    if (Array.isArray(messages)) setChatMessages(messages as ChatMessage[])
  }, [])

  const handleSend = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return
    const createdAt = new Date().toISOString()
    const turnId = `embry-live-turn-${Date.now()}`
    setChatMessages((messages) => [
      ...messages,
      {
        id: `${turnId}:user`,
        role: 'user',
        content: trimmed,
        createdAt,
        metadata: {
          surface: 'ux-lab/embry-voice',
          inputChannel: voiceEnabled ? 'voice-or-text' : 'text',
          branch: 'embry-voice',
          turnId,
        },
      },
    ])
    setIsStreaming(true)
    setReplayState({ playing: false, activeIndex: -1, activeTurnId: turnId, phase: 'request' })
    setStreamingSteps([
      {
        id: 'finalizing-intent',
        label: 'Memory intent',
        status: 'running',
        branch: 'embry-voice',
        detail: 'Calling memory.intent as the Tau chat boundary.',
        disclosureVariant: 'thinking',
      },
      {
        id: 'extracting-entities',
        label: 'Extract entities',
        status: 'pending',
        branch: 'embry-voice',
        detail: 'Waiting for memory entity artifacts.',
        disclosureVariant: 'thinking',
      },
      {
        id: 'looking-in-memory',
        label: 'Memory recall',
        status: 'pending',
        branch: 'embry-voice',
        detail: 'Waiting for memory-first answer or clarification route.',
        disclosureVariant: 'thinking',
      },
      {
        id: 'answering',
        label: 'Tau response',
        status: 'pending',
        branch: 'embry-voice',
        detail: 'Preparing an Embry response from the memory-first result.',
        disclosureVariant: 'thinking',
      },
      {
        id: 'embry-chatterbox-render',
        label: 'Chatterbox voice',
        status: 'pending',
        branch: 'embry-voice',
        detail: 'Waiting to render Embry speech.',
        disclosureVariant: 'thinking',
      },
    ])

    try {
      const response = await fetch('/api/projects/embry-voice/live-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmed,
          turnId,
          sessionId: 'ux-lab-embry-voice',
          voiceEnabled,
          tone: 'neutral_warm',
        }),
      })
      const payload = await response.json().catch(() => null) as {
        status?: string
        error?: string
        answerText?: string
        audioUrl?: string
        audioPath?: string
        receiptPath?: string
        receiptUrl?: string
        turnId?: string
        audioAuthority?: EmbryAudioAuthority
        voiceEnvelope?: EmbryVoiceEnvelope
        turnAuthority?: EmbryTurnAuthority
        reasoningSteps?: unknown[]
        entities?: unknown[]
        recallItems?: unknown[]
        memory?: unknown
        tone?: string
        deliveryStage?: string
        backend?: string
        entityContext?: unknown
      } | null
      if (!response.ok || payload?.status !== 'ok') {
        throw new Error(payload?.error || `Embry live turn returned HTTP ${response.status}`)
      }
      const liveEntitySpans = entitySpansFromEntityContext(payload.entityContext)
      const responseTurnId = payload.turnId || payload.turnAuthority?.turnId || turnId
      const audioAuthority = payload.audioAuthority ?? payload.turnAuthority?.audioAuthority as EmbryAudioAuthority | undefined
      const voiceEnvelope = payload.voiceEnvelope ?? audioAuthority?.envelope
      const turnAuthority: EmbryTurnAuthority = payload.turnAuthority ?? {
        turnId: responseTurnId,
        userText: trimmed,
        assistantText: payload.answerText || 'I heard you, but Tau did not return spoken text.',
        personaId: 'embry',
        sessionId: 'ux-lab-embry-voice',
        createdAt: new Date().toISOString(),
        memoryFirst: true,
        simultaneousTextVoice: true,
        receiptPath: payload.receiptPath,
        audioAuthority,
        audioArtifacts: audioAuthority ? [authorityRecord(audioAuthority)] : [],
        memoryTrace: payload.memory,
        live: true,
        mocked: false,
      }

      const assistantMessage: ChatMessage = {
        id: `${responseTurnId}:assistant`,
        role: 'assistant',
        content: turnAuthority.assistantText,
        createdAt: turnAuthority.createdAt,
        skillUsed: 'embry-chatterbox-voice',
        reasoningSteps: Array.isArray(payload.reasoningSteps) ? payload.reasoningSteps : undefined,
        thinkingTrace: Array.isArray(payload.reasoningSteps) ? payload.reasoningSteps : undefined,
        metadata: {
          surface: 'ux-lab/embry-voice',
          branch: 'embry-voice',
          backend: payload.backend || 'tau-memory-chatterbox',
          live: true,
          mocked: false,
          inputChannel: voiceEnabled ? 'voice-or-text' : 'text',
          turnId: responseTurnId,
          turnAuthority,
          audioAuthority,
          tone: payload.tone,
          deliveryStage: payload.deliveryStage,
          receiptPath: payload.receiptPath,
          receiptUrl: payload.receiptUrl,
          entityContext: payload.entityContext,
          entity_context: payload.entityContext,
          entities: Array.isArray(payload.entities) ? payload.entities : [],
          recallItems: Array.isArray(payload.recallItems) ? payload.recallItems : [],
          memory: payload.memory,
          audioArtifacts: payload.audioUrl
            ? [{
                id: `${responseTurnId}:chatterbox`,
                label: 'Embry live Chatterbox response',
                url: payload.audioUrl,
                path: payload.audioPath || payload.audioUrl,
              }]
            : [],
        },
      }
      setLastTurnAuthority(turnAuthority)
      if (payload.entityContext) {
        setChatMessages((messages) => messages.map((message) => (
          message.id === `${turnId}:user`
            ? {
                ...message,
                id: `${responseTurnId}:user`,
                metadata: {
                  ...(message.metadata ?? {}),
                  turnId: responseTurnId,
                  turnAuthority,
                  entityContext: payload.entityContext,
                  entity_context: payload.entityContext,
                  entitySpans: liveEntitySpans,
                  entity_spans: liveEntitySpans,
                },
              }
            : message
        )))
      }
      setChatMessages((messages) => [...messages, assistantMessage])
      setStreamingSteps(Array.isArray(payload.reasoningSteps) ? payload.reasoningSteps as StreamingStep[] : [])
      setReplayState({ playing: false, activeIndex: -1, activeTurnId: responseTurnId, phase: 'response' })
      window.setTimeout(() => {
        scrollSharedChatToBottom()
        if (!voiceEnabled || !payload.audioUrl) return
        const audios = Array.from(document.querySelectorAll<HTMLAudioElement>('[data-embry-session-audio="true"]'))
        const latestAudio = audios.at(-1)
        if (!latestAudio) return
        const speechId = `embry-live-turn-${responseTurnId}`
        bindActiveSpeech({
          id: speechId,
          turnId: responseTurnId,
          audioElement: latestAudio,
          source: 'live-turn',
          text: assistantMessage.content,
          audioUrl: latestAudio.currentSrc || latestAudio.src,
          startedAtMs: performance.now(),
          voiceEnvelope: voiceEnvelope as EmbryVoiceEnvelope | undefined,
        })
        latestAudio.currentTime = 0
        const finish = (): void => {
          latestAudio.removeEventListener('ended', finish)
          latestAudio.removeEventListener('pause', finish)
          clearActiveSpeech(speechId)
          setReplayState({ playing: false, activeIndex: -1, phase: 'idle' })
        }
        latestAudio.addEventListener('ended', finish, { once: true })
        latestAudio.addEventListener('pause', finish, { once: true })
        void latestAudio.play().catch(() => {
          finish()
        })
      }, 160)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setChatMessages((messages) => [
        ...messages,
        {
          id: `${turnId}:assistant-error`,
          role: 'assistant',
          content: `Embry live voice turn failed before a Chatterbox response could be rendered: ${message}`,
          createdAt: new Date().toISOString(),
          skillUsed: 'embry-chatterbox-voice',
          reasoningSteps: [
            {
              id: 'embry-live-turn-error',
              label: 'Embry live turn',
              status: 'failed',
              detail: message,
              icon: 'mic',
              disclosureVariant: 'thinking',
            },
          ],
          metadata: {
            surface: 'ux-lab/embry-voice',
            branch: 'embry-voice',
            backend: 'tau-memory-chatterbox',
            live: true,
            mocked: false,
            error: message,
          },
        },
      ])
      setReplayState({ playing: false, activeIndex: -1, activeTurnId: turnId, phase: 'interrupted' })
    } finally {
      setIsStreaming(false)
      window.setTimeout(() => setStreamingSteps([]), 1200)
    }
  }, [bindActiveSpeech, clearActiveSpeech, isStreaming, voiceEnabled])

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
      const [userMessage, assistantMessage] = chatMessagesForTurn(turn, turnIndex)
      setChatMessages((messages) => [...messages, userMessage])
      setIsStreaming(true)
      for (let stepIndex = 0; stepIndex < 4; stepIndex += 1) {
        if (replayStopRef.current) break
        setReplayState({ playing: true, activeIndex: audioIndex - 1, activeTurnId: turn.id, activeSessionId: session?.id, phase: 'thinking', visibleTurnCount: turnIndex + 1 })
        setStreamingSteps(replayThinkingStepsForTurn(turn, stepIndex))
        await new Promise((resolve) => window.setTimeout(resolve, 320))
      }
      setStreamingSteps(replayThinkingStepsForTurn(turn, 4))
      await new Promise((resolve) => window.setTimeout(resolve, 80))
      setIsStreaming(false)
      setStreamingSteps([])
      setChatMessages((messages) => [...messages, assistantMessage])
      await new Promise((resolve) => window.setTimeout(resolve, 80))
      scrollSharedChatToBottom()
      await new Promise((resolve) => window.setTimeout(resolve, 900))

      for (let artifactIndex = 0; artifactIndex < turn.audioArtifacts.length; artifactIndex += 1) {
        if (replayStopRef.current) break
        const audioElements = Array.from(document.querySelectorAll<HTMLAudioElement>('[data-embry-session-audio="true"]'))
        const audio = audioElements[audioIndex]
        setReplayState({ playing: true, activeIndex: audioIndex, activeTurnId: turn.id, activeSessionId: session?.id, phase: 'response', visibleTurnCount: turnIndex + 1 })
        audioIndex += 1
        if (!audio) {
          await new Promise((resolve) => window.setTimeout(resolve, 450))
          continue
        }
        const speechId = `embry-replay-${turn.id}-${artifactIndex}-${audioIndex - 1}`
        bindActiveSpeech({
          id: speechId,
          turnId: turn.id,
          audioElement: audio,
          source: 'replay',
          text: turn.assistantText,
          audioUrl: audio.currentSrc || audio.src,
          startedAtMs: performance.now(),
          voiceEnvelope: turn.audioAuthority?.envelope as EmbryVoiceEnvelope | undefined,
        })
        audio.currentTime = 0
        try {
          await audio.play()
          await new Promise<void>((resolve) => {
            const finish = (): void => {
              audio.removeEventListener('ended', finish)
              audio.removeEventListener('pause', finish)
              clearActiveSpeech(speechId)
              resolve()
            }
            audio.addEventListener('ended', finish, { once: true })
            audio.addEventListener('pause', finish, { once: true })
          })
        } catch {
          clearActiveSpeech(speechId)
          await new Promise((resolve) => window.setTimeout(resolve, 450))
        }
      }
      await new Promise((resolve) => window.setTimeout(resolve, 450))
    }

    setReplayState({ playing: false, activeIndex: -1, activeSessionId: session?.id, phase: replayStopRef.current ? 'interrupted' : 'complete', visibleTurnCount: turnsToReplay.length })
    setIsStreaming(false)
    setStreamingSteps([])
    activeSpeechIdRef.current = ''
    setActiveSpeech(null)
    replayStopRef.current = false
  }, [bindActiveSpeech, clearActiveSpeech])

  const stopReplay = useCallback(() => {
    replayStopRef.current = true
    document.querySelectorAll<HTMLAudioElement>('[data-embry-session-audio="true"]').forEach((audio) => audio.pause())
    setReplayState({ playing: false, activeIndex: -1, phase: 'interrupted' })
    setIsStreaming(false)
    setStreamingSteps([])
    activeSpeechIdRef.current = ''
    setActiveSpeech(null)
  }, [])

  const playDirectEmbryAudio = useCallback((audioState: DirectEmbryAudio): Promise<void> => {
    const runId = directPlaybackRunRef.current + 1
    directPlaybackRunRef.current = runId

    const previousAudio = directPlaybackAudioRef.current
    if (previousAudio) {
      previousAudio.pause()
      previousAudio.remove()
      directPlaybackAudioRef.current = null
    }

    const audio = new Audio(audioState.url)
    audio.setAttribute('data-qid', 'embry-voice:direct-speak-audio')
    audio.setAttribute('data-embry-session-audio', 'true')
    audio.setAttribute('data-embry-direct-text', audioState.text)
    audio.preload = 'auto'
    audio.muted = false
    audio.volume = 1
    audio.style.display = 'none'
    document.body.appendChild(audio)
    directPlaybackAudioRef.current = audio
    bindActiveSpeech({
      id: audioState.id,
      turnId: audioState.audioAuthority?.artifactId ?? audioState.id,
      audioElement: audio,
      source: 'direct',
      text: audioState.text,
      audioUrl: audioState.url,
      startedAtMs: audioState.startedAtMs ?? performance.now(),
      voiceEnvelope: audioState.voiceEnvelope,
    })

    return new Promise((resolve, reject) => {
      let settled = false
      let playbackStarted = false
      const timeout = window.setTimeout(() => {
        finish(new Error('direct Embry audio did not become playable'))
      }, 8000)

      const cleanup = (): void => {
        window.clearTimeout(timeout)
        audio.removeEventListener('canplay', onCanPlay)
        audio.removeEventListener('ended', onEnded)
        audio.removeEventListener('error', onError)
      }

      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        if (directPlaybackAudioRef.current === audio) directPlaybackAudioRef.current = null
        audio.remove()
        if (directPlaybackRunRef.current === runId) {
          clearActiveSpeech(audioState.id)
          directSpeakBusyRef.current = false
          setDirectSpeakBusy(false)
        }
        if (error) reject(error)
        else resolve()
      }

      const startPlayback = (): void => {
        if (playbackStarted) return
        playbackStarted = true
        void audio.play().catch((error: unknown) => {
          finish(error instanceof Error ? error : new Error(String(error)))
        })
      }

      function onCanPlay(): void {
        startPlayback()
      }

      function onEnded(): void {
        finish()
      }

      function onError(): void {
        finish(new Error('direct Embry audio failed during playback'))
      }

      audio.addEventListener('canplay', onCanPlay)
      audio.addEventListener('ended', onEnded, { once: true })
      audio.addEventListener('error', onError, { once: true })
      audio.load()
      if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) startPlayback()
    })
  }, [bindActiveSpeech, clearActiveSpeech])

  const speakDirectEmbry = useCallback(async (text = 'Embry direct voice test. The orb should move with my voice now.') => {
    const trimmed = text.trim()
    if (!trimmed || directSpeakBusyRef.current) return null
    directSpeakBusyRef.current = true
    setDirectSpeakBusy(true)
    setOrbStatusOverride('processing')
    try {
      const response = await fetch('/api/projects/embry-voice/direct-speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmed,
          tone: 'neutral_warm',
          deliveryStage: 'neutral',
          playLocal: true,
        }),
      })
      const payload = await response.json().catch(() => null) as {
        status?: string
        error?: string
        audioUrl?: string
        audioPath?: string
        receiptUrl?: string
        localPlayback?: {
          requested?: boolean
          driver?: string
          command?: string
          target?: string
          targetArgUsed?: boolean
          pid?: number
          startedAtEpochMs?: number
        }
        voiceEnvelope?: EmbryVoiceEnvelope
        audioAuthority?: EmbryAudioAuthority
      } | null
      if (!response.ok || payload?.status !== 'ok' || !payload.audioUrl) {
        throw new Error(payload?.error || `Embry direct speak returned HTTP ${response.status}`)
      }
      const authority = payload.audioAuthority ?? {
        authority: 'server-chatterbox-wav-envelope-v1',
        artifactId: `embry-direct-${Date.now()}`,
        url: payload.audioUrl,
        path: payload.audioPath,
        localPlayback: payload.localPlayback,
        envelope: payload.voiceEnvelope,
      }
      const startedAtMs = serverEpochToClientPerfMs(authority.localPlayback?.startedAtEpochMs)
      const audioState = {
        id: authority.artifactId || `embry-direct-${Date.now()}`,
        text: trimmed,
        url: authority.url || payload.audioUrl,
        path: authority.path || payload.audioPath,
        receiptUrl: payload.receiptUrl,
        startedAtMs,
        voiceEnvelope: authority.envelope ?? payload.voiceEnvelope,
        audioAuthority: authority,
      }
      const createdAt = new Date().toISOString()
      const turnAuthority: EmbryTurnAuthority = {
        turnId: audioState.id,
        userText: trimmed,
        assistantText: trimmed,
        personaId: 'embry',
        createdAt,
        memoryFirst: true,
        simultaneousTextVoice: true,
        receiptPath: payload.receiptUrl,
        audioAuthority: authority,
        audioArtifacts: [authorityRecord(authority)],
        live: true,
        mocked: false,
      }
      setLastTurnAuthority(turnAuthority)
      setChatMessages((messages) => [
        ...messages,
        {
          id: `${audioState.id}:assistant`,
          role: 'assistant',
          content: trimmed,
          createdAt,
          skillUsed: 'embry-chatterbox-voice',
          reasoningSteps: [
            {
              id: 'chatterbox-render',
              label: 'Render Chatterbox audio',
              status: 'completed',
              detail: 'Generated live Embry Chatterbox audio for this chat turn.',
              icon: 'mic',
              disclosureVariant: 'thinking',
            },
            {
              id: 'local-playback',
              label: 'Play through system audio',
              status: payload.localPlayback?.requested ? 'completed' : 'pending',
              detail: payload.localPlayback?.requested
                ? `Started ${payload.localPlayback.command ?? 'pw-play'} through ${payload.localPlayback.target ?? 'auto'}${payload.localPlayback.pid ? ` pid ${payload.localPlayback.pid}` : ''}.`
                : 'Server-side local playback was not started.',
              icon: 'mic',
              disclosureVariant: 'thinking',
            },
            {
              id: 'orb-bind',
              label: 'Bind orb to Embry waveform',
              status: 'running',
              detail: 'The orb is driven from the normalized server envelope computed from the same Chatterbox WAV.',
              icon: 'memory',
              disclosureVariant: 'thinking',
            },
          ],
          metadata: {
            surface: 'ux-lab/embry-voice',
            branch: 'embry-voice',
            inputChannel: 'voice',
            componentPath: '/embry-chatterbox-voice',
            live: true,
            mocked: false,
            backend: 'chatterbox-direct',
            turnId: audioState.id,
            turnAuthority,
            audioArtifacts: [
              {
                id: audioState.id,
                label: 'Live Embry Chatterbox',
                url: audioState.url,
                path: audioState.path,
              },
            ],
            receiptPath: audioState.receiptUrl,
            localPlayback: payload.localPlayback,
            audioAuthority: authority,
            voiceEnvelope: audioState.voiceEnvelope,
          },
        },
      ])
      window.setTimeout(scrollSharedChatToBottom, 80)
      void playDirectEmbryAudio(audioState).catch(() => undefined)
      return audioState
    } catch (error) {
      setOrbStatusOverride(null)
      directSpeakBusyRef.current = false
      setDirectSpeakBusy(false)
      throw error
    }
  }, [playDirectEmbryAudio])

  useEffect(() => {
    return () => {
      const audio = directPlaybackAudioRef.current
      if (audio) {
        audio.pause()
        audio.remove()
        directPlaybackAudioRef.current = null
      }
      activeSpeechIdRef.current = ''
      setActiveSpeech(null)
    }
  }, [])

  useEffect(() => {
    const target = window as Window & { embrySpeak?: (text?: string) => Promise<DirectEmbryAudio | null> }
    target.embrySpeak = speakDirectEmbry
    return () => {
      if (target.embrySpeak === speakDirectEmbry) delete target.embrySpeak
    }
  }, [speakDirectEmbry])

  const playVisibleEmbryVoice = useCallback(() => {
    const audios = Array.from(document.querySelectorAll<HTMLAudioElement>('[data-embry-session-audio="true"]'))
    const audio = audios.find((candidate) => candidate.readyState > 0) ?? audios[0]
    if (!audio) return
    const speechId = `embry-visible-${Date.now()}`
    bindActiveSpeech({ id: speechId, turnId: speechId, audioElement: audio, source: 'visible', text: audio.getAttribute('data-embry-direct-text') ?? undefined, audioUrl: audio.currentSrc || audio.src, startedAtMs: performance.now() })
    audio.currentTime = 0
    void audio.play().catch(() => undefined)
    const finish = (): void => {
      audio.removeEventListener('ended', finish)
      audio.removeEventListener('pause', finish)
      clearActiveSpeech(speechId)
    }
    audio.addEventListener('ended', finish, { once: true })
    audio.addEventListener('pause', finish, { once: true })
  }, [bindActiveSpeech, clearActiveSpeech])

  return (
    <section data-qid="embry-voice:route" className={`h-full min-h-0 grid grid-rows-[auto_minmax(0,1fr)] ${surfaceClass}`}>
      <header className="border-b border-[#2d2d31] px-5 py-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-lg font-bold"><Mic className="w-5 h-5" />Embry Voice Chat</div>
          <div className={`mt-1 text-xs ${mutedTextClass}`}>Shared chat UX with synchronized Chatterbox audio, memory trace, and session replay.</div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <StatusPill label="memory-first voice lab" tone="good" />
          <StatusPill label={`replay ${replayState.phase}`} tone={replayState.playing ? 'good' : replayState.phase === 'interrupted' ? 'warn' : undefined} />
          <StatusPill label="Chatterbox Turbo" />
          <StatusPill label="Embry" />
        </div>
      </header>

      <div className="min-h-0 grid grid-cols-[auto_minmax(0,1fr)_320px] gap-3 p-3">
        <SessionController
          turns={voiceTurns}
          folders={sessionFolders}
          replayState={replayState}
          voiceStatus={effectiveVoiceStatus}
          isStreaming={isStreaming}
          tone={effectiveVoiceStatus === 'idle' ? undefined : selectedTurn.tone}
          activeSpeech={activeSpeech}
          onReplay={replaySession}
          onStopReplay={stopReplay}
        />

        <section
          data-qid="embry-voice:evidence-timeline"
          data-active-turn-id={lastTurnAuthority?.turnId ?? ''}
          data-active-audio-artifact-id={lastTurnAuthority?.audioAuthority?.artifactId ?? ''}
          data-active-speech-turn-id={activeSpeech?.turnId ?? ''}
          data-replay-phase={replayState.phase}
          data-visible-turn-count={replayState.visibleTurnCount ?? chatMessages.length}
          className={`min-h-0 grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden ${panelClass}`}
        >
          <ChatReplayHeader
            replayState={replayState}
            voiceStatus={effectiveVoiceStatus}
            isStreaming={isStreaming}
            tone={effectiveVoiceStatus === 'idle' ? undefined : selectedTurn.tone}
            activeSpeech={activeSpeech}
            phaseSpeedMs={orbPhaseSpeedMs}
            selectedSessionTitle={sessionTitleForReplay(replayState.activeSessionId)}
            directSpeakBusy={directSpeakBusy}
            onReplay={() => replaySession()}
            onStopReplay={stopReplay}
            onPlayVoice={playVisibleEmbryVoice}
            onDirectSpeak={speakDirectEmbry}
          />
          <SharedChatShell
            projectLabel="Embry Voice"
            shellQid="embry-voice:shared-chat-shell"
            className="ux-lab-watch-chat-shell"
            qid="embry-voice:shared-chat"
            surface="embry-voice"
            hideHeader
            defaultMode="compliance"
            showModeToggle={false}
            messages={chatMessages}
            onMessagesChange={handleMessagesChange}
            onSend={handleSend}
            streamingSteps={streamingSteps}
            isStreaming={isStreaming}
            activeBranch="embry-voice"
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
            voiceStatus={effectiveVoiceStatus}
            voiceLabel="Embry voice"
            onVoiceToggle={setVoiceEnabled}
            activeProcessingTurnId={isStreaming ? replayState.activeTurnId : undefined}
            activeProcessingMessageId={isStreaming && !replayState.activeTurnId
              ? chatMessages.filter((message) => message.role === 'user').at(-1)?.id
              : undefined}
            sidebar
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

function ChatReplayHeader({
  replayState,
  voiceStatus,
  isStreaming,
  tone,
  activeSpeech,
  phaseSpeedMs,
  selectedSessionTitle,
  directSpeakBusy,
  onReplay,
  onStopReplay,
  onPlayVoice,
  onDirectSpeak,
}: {
  replayState: ReplayState
  voiceStatus: EmbryVoiceStatus
  isStreaming: boolean
  tone?: string
  activeSpeech: ActiveSpeechSource | null
  phaseSpeedMs: number
  selectedSessionTitle: string
  directSpeakBusy: boolean
  onReplay: () => void
  onStopReplay: () => void
  onPlayVoice: () => void
  onDirectSpeak: (text?: string) => Promise<DirectEmbryAudio | null>
}): JSX.Element {
  const playing = replayState.playing
  return (
    <header
      data-qid="embry-voice:center-replay-header"
      className="flex flex-wrap items-center justify-between gap-3 border-b border-[#2d2d31] bg-[#151518] px-4 py-3"
    >
      <div className="shrink-0" data-qid="embry-voice:center-orb">
        <IdentityNode
          voiceStatus={voiceStatus}
          isStreaming={isStreaming}
          tone={tone}
          height={92}
          orbSize={58}
          compact
          showCopy={false}
          phaseSpeedMs={phaseSpeedMs}
          speechAudioElement={activeSpeech?.audioElement ?? null}
          speechSourceId={activeSpeech?.turnId ?? activeSpeech?.id}
          speechAudioUrl={activeSpeech?.audioUrl}
          speechStartedAtMs={activeSpeech?.startedAtMs}
          speechEnvelope={activeSpeech?.voiceEnvelope}
        />
      </div>
      <div className="min-w-[220px] flex-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-200">Shared Chat Replay</span>
          <StatusPill label={playing ? `playing ${replayState.phase}` : `replay ${replayState.phase}`} tone={playing ? 'good' : replayState.phase === 'interrupted' ? 'warn' : undefined} />
          <StatusPill label={`voice ${voiceStatus}`} tone={voiceStatus === 'speaking' || voiceStatus === 'listening' ? 'good' : undefined} />
        </div>
        <div className="mt-1 truncate text-xs text-zinc-400">
          {selectedSessionTitle} rebuilds in the center chat with human turns, Embry turns, inline memory trace, and Chatterbox audio.
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button
          type="button"
          data-qid="embry-voice:replay-all"
          onClick={playing ? onStopReplay : onReplay}
          className={`inline-flex items-center gap-2 border px-3 py-2 text-xs font-semibold ${
            playing
              ? 'border-amber-300/40 bg-amber-400/10 text-amber-100'
              : 'border-emerald-300/40 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/15'
          }`}
        >
          {playing ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
          {playing ? 'Stop Replay' : 'Replay Conversation'}
        </button>
        <button
          type="button"
          data-qid="embry-voice:play-current-audio"
          onClick={onPlayVoice}
          className="inline-flex items-center gap-2 border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-cyan-400/15"
        >
          <Radio className="h-4 w-4" />
          Play Visible Voice
        </button>
        <button
          type="button"
          data-qid="embry-voice:direct-speak"
          onClick={() => void onDirectSpeak()}
          disabled={directSpeakBusy}
          className="inline-flex items-center gap-2 border border-teal-300/30 bg-teal-400/10 px-3 py-2 text-xs font-semibold text-teal-100 hover:bg-teal-400/15 disabled:cursor-wait disabled:opacity-60"
        >
          <Mic className="h-4 w-4" />
          {directSpeakBusy ? 'Rendering...' : 'Live Chatterbox'}
        </button>
      </div>
    </header>
  )
}

function SessionController({
  turns,
  folders,
  replayState,
  voiceStatus,
  isStreaming,
  tone,
  activeSpeech,
  onReplay,
  onStopReplay,
}: {
  turns: VoiceTurn[]
  folders: SessionFolder[]
  replayState: ReplayState
  voiceStatus: EmbryVoiceStatus
  isStreaming: boolean
  tone?: string
  activeSpeech: ActiveSpeechSource | null
  onReplay: (session?: TestSession) => void
  onStopReplay: () => void
}): JSX.Element {
  const totalAudio = turns.reduce((count, turn) => count + turn.audioArtifacts.length, 0)
  const replayProgress = replayState.playing ? Math.min(100, Math.max(6, ((replayState.visibleTurnCount ?? 0) / Math.max(1, turns.length)) * 100)) : 0
  return (
    <div
      data-qid="embry-voice:command-rail"
      data-active-speech-id={activeSpeech?.id ?? ''}
      data-voice-status={voiceStatus}
      data-is-streaming={isStreaming ? 'true' : 'false'}
      data-tone={tone ?? ''}
      className="flex h-full min-h-0 w-[320px] shrink-0 flex-col border-r border-[#2d2d31] bg-[#121214]"
    >
      <div className="min-h-0 flex-1 [&>div]:h-full">
    <LeftPane
      title="Sessions"
      width={320}
      searchable
      collapsible
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
      </div>
    </div>
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

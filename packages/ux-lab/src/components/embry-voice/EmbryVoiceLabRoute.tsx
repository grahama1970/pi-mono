import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CheckCircle2, ChevronDown, FlaskConical, Folder, Maximize2, Mic, PauseCircle, PlayCircle, Radio, SearchCode, XCircle } from 'lucide-react'
import { LeftPane, LeftPaneSection, useLeftPaneSearch } from '../common/LeftPane'
import { SharedChatShell } from '../shared-chat/SharedChatShell'
import { IdentityNode } from './IdentityNode'
import type { EmbryVoiceStatus } from './EmbryVoiceOrb'
import { deriveEmbryVoiceStatus } from './embryOrbState'
import type { ChatMessage, StreamingStep } from '../shared-chat/memory-turn'
import type { EmbryTurnAuthority, EmbryVoiceAudioAuthority } from '@agent-skills/ux-lab-ui/memory-turn/EmbryVoiceAuthority'
import type { EmbryVoiceEnvelope } from '../../hooks/useEmbryPlaybackAudioLevel'
import { useRegisterAction } from '../../hooks/useRegisterAction'
import { classifyVoiceRun, summarizeVoiceReadiness, type VoiceReadinessSummary } from './embryVoiceReadiness'

type AudioArtifact = {
  id: string
  label: string
  path: string
  url: string
  role?: 'embry-output' | 'input-evidence' | 'idle-hum'
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
type EmbryVoiceDistanceMode = '10ft' | '5ft' | 'lean-in'
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
  artifactRole?: AudioArtifact['role']
  text?: string
  audioUrl?: string
  startedAtMs?: number
  voiceEnvelope?: EmbryVoiceEnvelope
}

type BrowserListenerSession = {
  id: string
  stop: () => void
}

type BrowserListenerTelemetry = {
  state: 'idle' | 'connecting' | 'listening' | 'transcribing' | 'error'
  finalTranscript?: string
  realtimeTranscript?: string
  error?: string
  rmsDb?: number
  peakDb?: number
  packetsSent?: number
  lastEventType?: string
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

type StressRouteFamily = {
  id: string
  title: string
  route: string
  turnIds: string[]
  questions: string[]
}

const fullSuite = '/tmp/chatterbox-fork-agent-out/voice-chat-e2e/fresh-all-audible-20260707T155951Z'
const surfaceClass = 'bg-[#121214] text-[#e4e4e7] antialiased'
const panelClass = 'border border-[#2d2d31] bg-[#18181b]'
const panelSoftClass = 'border border-[#2d2d31] bg-[#17171a]'
const mutedTextClass = 'text-[#a1a1aa]'
const REALTIMESTT_TARGET_SAMPLE_RATE = 16000
const REALTIMESTT_BROWSER_WS_URL = 'ws://127.0.0.1:8010/ws/transcribe'

function artifactUrl(path: string): string {
  return `/chatterbox-artifacts${path.replace('/tmp/chatterbox-fork-agent-out', '')}`
}

function artifact(id: string, label: string, path: string, role: AudioArtifact['role'] = 'embry-output'): AudioArtifact {
  return { id, label, path, url: artifactUrl(path), role }
}

function serverEpochToClientPerfMs(startedAtEpochMs?: number): number {
  if (!startedAtEpochMs || !Number.isFinite(startedAtEpochMs)) return performance.now()
  return performance.now() - Math.max(0, Date.now() - startedAtEpochMs)
}

function authorityRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function resampleFloat32(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return input
  const outputLength = Math.max(1, Math.round((input.length * outputRate) / inputRate))
  const output = new Float32Array(outputLength)
  const ratio = inputRate / outputRate
  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio
    const before = Math.floor(sourceIndex)
    const after = Math.min(input.length - 1, before + 1)
    const weight = sourceIndex - before
    output[index] = input[before] * (1 - weight) + input[after] * weight
  }
  return output
}

function pcm16PacketFromFloat32(input: Float32Array, inputRate: number): { packet: ArrayBuffer; rmsDb: number; peakDb: number; frames: number } {
  const samples = resampleFloat32(input, inputRate, REALTIMESTT_TARGET_SAMPLE_RATE)
  const pcm = new Int16Array(samples.length)
  let peak = 0
  let sumSquares = 0
  for (let index = 0; index < samples.length; index += 1) {
    const gained = Math.max(-1, Math.min(1, samples[index]))
    const abs = Math.abs(gained)
    peak = Math.max(peak, abs)
    sumSquares += gained * gained
    pcm[index] = gained < 0 ? Math.round(gained * 32768) : Math.round(gained * 32767)
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, samples.length))
  const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -120
  const peakDb = peak > 0 ? 20 * Math.log10(peak) : -120
  const metadata = JSON.stringify({
    sampleRate: REALTIMESTT_TARGET_SAMPLE_RATE,
    channels: 1,
    format: 'pcm_s16le',
    frames: pcm.length,
  })
  const metadataBytes = new TextEncoder().encode(metadata)
  const packet = new ArrayBuffer(4 + metadataBytes.byteLength + pcm.byteLength)
  const view = new DataView(packet)
  view.setUint32(0, metadataBytes.byteLength, true)
  new Uint8Array(packet, 4, metadataBytes.byteLength).set(metadataBytes)
  new Uint8Array(packet, 4 + metadataBytes.byteLength).set(new Uint8Array(pcm.buffer))
  return { packet, rmsDb, peakDb, frames: pcm.length }
}

function isNonSpeechTranscript(text: string): boolean {
  const normalized = text.trim().toLowerCase()
  return normalized === '[blank_audio]' || normalized === '[music]' || normalized === '[silence]' || normalized === '(music)'
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
      role: audio.role,
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
      artifact('factory-stress-input', 'Horus with factory stress', '/tmp/chatterbox-fork-agent-out/rung7-horus-factory-stress-youtube-20260702T192914Z/horus-factory-embry-stress-8s.wav', 'input-evidence'),
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
      artifact('male', 'Male voice', `${fullSuite}/S05-female-distractor/male.wav`, 'input-evidence'),
      artifact('female', 'Female distractor', `${fullSuite}/S05-female-distractor/female.wav`, 'input-evidence'),
      artifact('overlap', 'Overlapped input', `${fullSuite}/S05-female-distractor/overlap.wav`, 'input-evidence'),
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
      artifact('captured-room-audio', 'Captured noisy audio', `${fullSuite}/S06-factory-noise/loopback-captured.wav`, 'input-evidence'),
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
  {
    id: 'browser-webcam-success',
    label: 'Browser webcam ASR success',
    receiptPath: '/tmp/chatterbox-fork-agent-out/voice-chat-e2e/browser-quality-webcam-20260705T134007Z/continuous-voice-loop.json',
    componentPath: '/browser/getUserMedia/realtimestt/webcam',
    ok: true,
    mocked: false,
    live: true,
    failedGates: [],
    facts: ['HD Pro Webcam', 'ASR non-empty', 'Chatterbox response'],
    gates: [
      { name: 'browser-capture', status: 'passed', detail: 'HD Pro Webcam produced ASR-usable audio' },
      { name: 'full-loop', status: 'passed', detail: 'browser -> RealtimeSTT -> memory/Tau -> Chatterbox passed' },
    ],
    proves: ['One browser microphone device can feed the full voice loop'],
    doesNotProve: ['Jabra browser capture quality or all browser devices'],
  },
  {
    id: 'qra-disabled',
    label: 'QRA cache disabled',
    receiptPath: `${fullSuite}/S10-qra-disabled/tau-qra-disabled.json`,
    componentPath: '/embry-chatterbox-voice/qra-cache-disabled',
    ok: true,
    mocked: false,
    live: true,
    failedGates: [],
    facts: ['use_blessed_qra_cache=false', 'fresh render path'],
    gates: [
      { name: 'cache-bypass', status: 'passed', detail: 'same QRA request bypassed blessed cache' },
      { name: 'fresh-render', status: 'passed', detail: 'normal Chatterbox render path emitted fresh artifact' },
    ],
    proves: ['Blessed QRA fast path can be disabled per request'],
    doesNotProve: ['human preference between cached and fresh render'],
  },
  {
    id: 'device-failure-matrix',
    label: 'Device/source failure matrix',
    receiptPath: '/tmp/chatterbox-fork-agent-out/voice-chat-e2e/browser-asr-matrix-20260703T223244Z/browser-asr-matrix.json',
    componentPath: '/browser/getUserMedia/device-matrix',
    ok: false,
    mocked: false,
    live: true,
    failedGates: ['jabra_empty_asr', 'default_zero_rms'],
    facts: ['Jabra browser WAVs empty transcript', 'HD webcam later succeeded'],
    gates: [
      { name: 'jabra-browser-asr', status: 'failed', detail: 'Jabra browser captures wrote WAVs but ASR returned empty or insufficient text' },
      { name: 'default-browser-asr', status: 'failed', detail: 'default browser device produced zero-RMS capture' },
    ],
    proves: ['Browser audio capture quality is device-dependent'],
    doesNotProve: ['a production device-selection policy'],
  },
  {
    id: 'requirements-gap',
    label: 'Requirements gap tracker',
    receiptPath: '/home/graham/workspace/experiments/chatterbox/docs/VOICE_CHAT_REQUIREMENTS.md',
    componentPath: '/docs/voice-chat-requirements',
    ok: false,
    mocked: false,
    live: false,
    failedGates: ['seeded_session_only'],
    facts: ['UX scenario only', 'no fresh live receipt'],
    gates: [
      { name: 'seeded-session', status: 'pending', detail: 'Scenario exists in UX replay but still needs a fresh non-mocked receipt' },
    ],
    proves: ['UX coverage target is represented'],
    doesNotProve: ['runtime behavior for the seeded gap scenario'],
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
      artifact('overlap-input', 'Overlapped input', `${fullSuite}/S05-female-distractor/overlap.wav`, 'input-evidence'),
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
  {
    id: 'factory-noise-listening',
    userText: 'Horus asks through factory-floor background noise.',
    assistantText: 'Listening through the noise floor before Embry answers.',
    speaker: 'horus_lupercal',
    tone: 'calm_precise',
    memoryAction: 'LISTEN',
    receiptPath: `${fullSuite}/S06-factory-noise/rung8-loopback-listener.json`,
    componentPath: '/realtimestt/listener/factory-noise',
    telemetry: [
      { label: 'Speakers', value: '1' },
      { label: 'Noise', value: 'factory' },
      { label: 'Gate', value: 'primary' },
    ],
    audioArtifacts: [
      artifact('factory-noise-capture', 'Factory-noise input', `${fullSuite}/S06-factory-noise/loopback-captured.wav`, 'input-evidence'),
    ],
    relatedRunIds: ['factory-noise', 'full-audible-suite'],
  },
  {
    id: 'cancel-witness',
    userText: 'Primary speaker interrupts stale Embry output.',
    assistantText: 'Old turn audio stops before stale bytes can continue.',
    speaker: 'horus_lupercal',
    tone: 'firm_boundary',
    memoryAction: 'CANCEL',
    receiptPath: `${fullSuite}/S08-stream-cancel/stream-cancel.json`,
    componentPath: '/embry-chatterbox-voice/stream-cancel',
    telemetry: [
      { label: 'Cancel', value: '19ms' },
      { label: 'Stale', value: '0 bytes' },
      { label: 'Gate', value: 'stop' },
    ],
    audioArtifacts: [
      artifact('cancel-witness-audio', 'Cancel audible witness', `${fullSuite}/S08-stream-cancel/stream-cancel-audible-witness.wav`),
    ],
    relatedRunIds: ['stream-cancel', 'full-audible-suite'],
  },
  {
    id: 'research-memory-question',
    userText: 'Horus asks Embry to compare what she remembers with current research before answering.',
    assistantText: '[hmm] I will check memory first, then research only where memory is thin.',
    speaker: 'horus_lupercal',
    tone: 'curious_searching',
    memoryAction: 'RESEARCH',
    receiptPath: `${fullSuite}/S01-S02-S08-S09-S12-continuous-core/continuous-voice-loop.json`,
    componentPath: '/memory/tau/research',
    telemetry: [
      { label: 'Route', value: 'memory-first' },
      { label: 'Research', value: 'fallback' },
      { label: 'Tone', value: 'curious' },
    ],
    audioArtifacts: [
      artifact('research-memory-response', 'Research-aware Embry response', '/tmp/chatterbox-fork-agent-out/tau_voice_render_smoke/finished_response.wav'),
    ],
    relatedRunIds: ['full-audible-suite', 'repeat-stress'],
  },
  {
    id: 'evidence-case-request',
    userText: 'Horus asks Embry to open an evidence case for the QRA before making a claim.',
    assistantText: '[careful] I will keep the answer bounded and show the evidence case before I speak past the receipts.',
    speaker: 'horus_lupercal',
    tone: 'careful_concerned',
    memoryAction: 'EVIDENCE_CASE',
    receiptPath: '/home/graham/workspace/experiments/agent-skills/skills/create-evidence-case/SKILL.md',
    componentPath: '/skills/create-evidence-case',
    telemetry: [
      { label: 'Skill', value: '$create-evidence-case' },
      { label: 'Claim', value: 'bounded' },
      { label: 'Trace', value: 'required' },
    ],
    audioArtifacts: [
      artifact('evidence-case-response', 'Evidence-case spoken response', `${fullSuite}/S03-unknown-speaker/identity-clarification-render.wav`),
    ],
    relatedRunIds: ['full-audible-suite'],
  },
  {
    id: 'analytics-figure-request',
    userText: 'Horus asks Embry to use $analytics on the sanity receipt and return a $create-figure chart for failed gates.',
    assistantText: '[laugh] Tiny dashboard trap avoided: $analytics reads the receipt first, then $create-figure renders only the grounded gate counts.',
    speaker: 'horus_lupercal',
    tone: 'playful_light',
    memoryAction: 'SKILL_CHAIN',
    receiptPath: '/home/graham/workspace/experiments/agent-skills/skills/create-figure/SKILL.md',
    componentPath: '/skills/analytics/create-figure',
    telemetry: [
      { label: 'Skill 1', value: '$analytics' },
      { label: 'Skill 2', value: '$create-figure' },
      { label: 'Input', value: 'receipt' },
    ],
    audioArtifacts: [
      artifact('analytics-figure-response', 'Analytics-to-figure spoken response', '/tmp/chatterbox-fork-agent-out/tau_voice_render_smoke/finished_response.wav'),
    ],
    relatedRunIds: ['browser-asr-blocker', 'full-audible-suite'],
  },
  {
    id: 'natural-interruption',
    userText: 'Horus interrupts Embry mid-answer to correct the request.',
    assistantText: '[small stop] Wait, okay. Go ahead; I will hold the old turn and let the new one win.',
    speaker: 'horus_lupercal',
    tone: 'firm_boundary',
    memoryAction: 'INTERRUPT',
    receiptPath: `${fullSuite}/S08-stream-cancel/stream-cancel.json`,
    componentPath: '/embry-chatterbox-voice/interruption',
    telemetry: [
      { label: 'Stop', value: 'natural' },
      { label: 'Old turn', value: 'cancelled' },
      { label: 'New turn', value: 'wins' },
    ],
    audioArtifacts: [
      artifact('natural-interruption-response', 'Natural interruption witness', `${fullSuite}/S08-stream-cancel/stream-cancel-audible-witness.wav`),
    ],
    relatedRunIds: ['stream-cancel', 'full-audible-suite'],
  },
  {
    id: 'idle-hum',
    userText: 'Long idle after a hard answer.',
    assistantText: '[soft hum]',
    speaker: 'horus_lupercal',
    tone: 'wait_presence',
    memoryAction: 'IDLE',
    receiptPath: '/home/graham/workspace/experiments/agent-skills/skills/hum/SKILL.md',
    componentPath: '/skills/hum/idle-presence',
    telemetry: [
      { label: 'Idle', value: 'long' },
      { label: 'Mode', value: 'hum' },
      { label: 'Source', value: '$hum' },
    ],
    audioArtifacts: [
      artifact('idle-hum-little-grass-shack', 'Idle hum artifact', '/tmp/chatterbox-fork-agent-out/embry-hum-artifacts/little_grass_shack.wav', 'idle-hum'),
    ],
    relatedRunIds: ['full-audible-suite'],
  },
  {
    id: 'negative-frustrated-deescalation',
    userText: 'Horus is frustrated: "You keep missing the point. This is wasting time."',
    assistantText: '[softly] You are right to push on this. I will slow down, restate the evidence, and only claim what the receipts show.',
    speaker: 'horus_lupercal',
    tone: 'deescalate_calm',
    memoryAction: 'AFFECT_DEESCALATE',
    receiptPath: '/home/graham/workspace/experiments/chatterbox/docs/VOICE_CHAT_REQUIREMENTS.md',
    componentPath: '/memory/intent/affect-negative',
    telemetry: [
      { label: 'Affect', value: 'frustrated' },
      { label: 'Policy', value: 'de-escalate' },
      { label: 'Tags', value: '[softly]' },
    ],
    audioArtifacts: [
      artifact('negative-frustrated-response', 'Frustration de-escalation response', '/tmp/chatterbox-fork-agent-out/tau_voice_render_smoke/finished_response.wav'),
    ],
    relatedRunIds: ['requirements-gap'],
  },
  {
    id: 'negative-hostile-boundary',
    userText: 'Horus becomes hostile and accuses Embry of making things up.',
    assistantText: '[pause] I hear the concern. I will stop guessing, show the memory trace, and ask before I continue.',
    speaker: 'horus_lupercal',
    tone: 'firm_deescalating_boundary',
    memoryAction: 'AFFECT_BOUNDARY',
    receiptPath: '/home/graham/workspace/experiments/chatterbox/docs/VOICE_CHAT_REQUIREMENTS.md',
    componentPath: '/memory/intent/affect-boundary',
    telemetry: [
      { label: 'Affect', value: 'hostile' },
      { label: 'Boundary', value: 'non-accusatory' },
      { label: 'Tags', value: '[pause]' },
    ],
    audioArtifacts: [
      artifact('negative-hostile-boundary-response', 'Hostile tone boundary response', `${fullSuite}/S03-unknown-speaker/identity-clarification-render.wav`),
    ],
    relatedRunIds: ['requirements-gap'],
  },
  {
    id: 'sadness-support',
    userText: 'Horus sounds discouraged and says the system may never work.',
    assistantText: '[gentle] I can stay with the hard part. Let us make the next check small and visible.',
    speaker: 'horus_lupercal',
    tone: 'gentle_reassuring',
    memoryAction: 'AFFECT_SUPPORT',
    receiptPath: '/home/graham/workspace/experiments/chatterbox/docs/VOICE_CHAT_REQUIREMENTS.md',
    componentPath: '/memory/intent/affect-support',
    telemetry: [
      { label: 'Affect', value: 'discouraged' },
      { label: 'Policy', value: 'support' },
      { label: 'Tags', value: '[gentle]' },
    ],
    audioArtifacts: [
      artifact('sadness-support-response', 'Discouraged tone support response', '/tmp/chatterbox-fork-agent-out/tau_voice_render_smoke/finished_response.wav'),
    ],
    relatedRunIds: ['requirements-gap'],
  },
  {
    id: 'memory-miss-no-hallucination',
    userText: 'Horus asks: "Where did I leave the calibration notebook?"',
    assistantText: '[careful] I do not have that in Horus-scoped memory. Where should I look first?',
    speaker: 'horus_lupercal',
    tone: 'memory_uncertain',
    memoryAction: 'MEMORY_MISS',
    receiptPath: '/home/graham/workspace/experiments/chatterbox/docs/VOICE_CHAT_REQUIREMENTS.md',
    componentPath: '/memory/recall/miss-no-hallucination',
    telemetry: [
      { label: 'Recall', value: 'miss' },
      { label: 'Claim', value: 'none' },
      { label: 'Question', value: 'ask' },
    ],
    audioArtifacts: [
      artifact('memory-miss-response', 'Memory miss clarification response', `${fullSuite}/S03-unknown-speaker/identity-clarification-render.wav`),
    ],
    relatedRunIds: ['requirements-gap'],
  },
  {
    id: 'ambiguous-speaker-clarify',
    userText: 'Two close speaker scores appear; Embry cannot safely identify Horus.',
    assistantText: '[careful] I am not certain who is speaking. Can you identify yourself before I use personal memory?',
    tone: 'identity_clarification',
    memoryAction: 'AMBIGUOUS_SPEAKER',
    receiptPath: `${fullSuite}/S04-ambiguous-speaker/identity-resolution.json`,
    componentPath: '/memory/identity/ambiguous-speaker',
    telemetry: [
      { label: 'Speaker', value: 'ambiguous' },
      { label: 'Recall', value: 'blocked' },
      { label: 'Gate', value: 'fail-closed' },
    ],
    audioArtifacts: [
      artifact('ambiguous-speaker-response', 'Ambiguous speaker clarification', `${fullSuite}/S04-ambiguous-speaker/identity-clarification-render.wav`),
    ],
    relatedRunIds: ['full-audible-suite'],
  },
  {
    id: 'female-distractor-primary-gate',
    userText: 'Horus speaks while a female distractor talks in the background.',
    assistantText: '[focused] I will keep Horus as the only memory authority unless the speaker gate becomes ambiguous.',
    speaker: 'horus_lupercal',
    tone: 'calm_precise',
    memoryAction: 'PRIMARY_SPEAKER_GATE',
    receiptPath: `${fullSuite}/S05-female-distractor/overlap-turn-control.json`,
    componentPath: '/speaker-gate/female-distractor',
    telemetry: [
      { label: 'Primary', value: 'Horus' },
      { label: 'Distractor', value: 'rejected' },
      { label: 'Policy', value: 'fail-closed if ambiguous' },
    ],
    audioArtifacts: [
      artifact('female-distractor-overlap', 'Female distractor overlap input', `${fullSuite}/S05-female-distractor/overlap.wav`, 'input-evidence'),
    ],
    relatedRunIds: ['overlap-boundary'],
  },
  {
    id: 'factory-source67-pass',
    userText: 'Factory source 67 captures Horus cleanly enough for the listener path.',
    assistantText: '[calm] Source 67 is the passing acoustic path. I will still keep the source id in the receipt.',
    speaker: 'horus_lupercal',
    tone: 'calm_precise',
    memoryAction: 'NOISE_PASS',
    receiptPath: '/tmp/chatterbox-fork-agent-out/voice-chat-e2e/voice-chat-e2e-20260703T212255Z-factory-acoustic-src67/index.json',
    componentPath: '/realtimestt/listener/factory-source-67',
    telemetry: [
      { label: 'Source', value: '67' },
      { label: 'RMS', value: 'non-silent' },
      { label: 'Result', value: 'pass' },
    ],
    audioArtifacts: [
      artifact('factory-source67-input', 'Factory source 67 capture', `${fullSuite}/S06-factory-noise/loopback-captured.wav`, 'input-evidence'),
    ],
    relatedRunIds: ['factory-noise'],
  },
  {
    id: 'factory-source68-fail',
    userText: 'Factory source 68 captures audio but RealtimeSTT/VAD and Horus resolution fail.',
    assistantText: '[careful] I captured sound, but the listener gates failed. I will not route this as Horus.',
    tone: 'careful_concerned',
    memoryAction: 'NOISE_FAIL_CLOSED',
    receiptPath: '/tmp/chatterbox-fork-agent-out/voice-chat-e2e/voice-chat-e2e-20260703T222756Z-factory-src68/index.json',
    componentPath: '/realtimestt/listener/factory-source-68',
    telemetry: [
      { label: 'Source', value: '68' },
      { label: 'RMS', value: '227' },
      { label: 'Gate', value: 'fail-closed' },
    ],
    audioArtifacts: [
      artifact('factory-source68-reference', 'Factory source 68 failing path reference', `${fullSuite}/S06-factory-noise/loopback-captured.wav`, 'input-evidence'),
    ],
    relatedRunIds: ['device-failure-matrix'],
  },
  {
    id: 'jabra-source62-silent',
    userText: 'Jabra source 62 records silence during the factory acoustic test.',
    assistantText: '[short pause] That source is silent. I will mark the capture path failed instead of pretending the listener worked.',
    tone: 'careful_concerned',
    memoryAction: 'CAPTURE_SILENT',
    receiptPath: '/tmp/chatterbox-fork-agent-out/voice-chat-e2e/voice-chat-e2e-20260703T212038Z-factory-acoustic/index.json',
    componentPath: '/realtimestt/listener/source-62-silent',
    telemetry: [
      { label: 'Source', value: '62' },
      { label: 'RMS', value: '0' },
      { label: 'Result', value: 'fail' },
    ],
    audioArtifacts: [
      artifact('jabra-silent-reference', 'Silent capture failure reference', `${fullSuite}/S06-factory-noise/loopback-captured.wav`, 'input-evidence'),
    ],
    relatedRunIds: ['device-failure-matrix'],
  },
  {
    id: 'browser-jabra-empty-asr',
    userText: 'Browser captures Jabra audio, but direct Whisper returns an empty transcript.',
    assistantText: '[careful] Browser transport is not enough. I need ASR text before memory or Tau can trust the turn.',
    tone: 'careful_concerned',
    memoryAction: 'BROWSER_ASR_FAIL',
    receiptPath: '/tmp/chatterbox-fork-agent-out/voice-chat-e2e/browser-asr-matrix-20260703T223244Z/browser-asr-matrix.json',
    componentPath: '/browser/getUserMedia/jabra-empty-asr',
    telemetry: [
      { label: 'Device', value: 'Jabra' },
      { label: 'Transport', value: 'pass' },
      { label: 'ASR', value: 'empty' },
    ],
    audioArtifacts: [
      artifact('browser-jabra-capture-reference', 'Browser Jabra capture reference', '/tmp/chatterbox-fork-agent-out/browser-webrtc-transport-20260702T222218Z.wav', 'input-evidence'),
    ],
    relatedRunIds: ['browser-asr-blocker', 'device-failure-matrix'],
  },
  {
    id: 'browser-webcam-success',
    userText: 'HD Pro Webcam capture produces usable ASR and drives the full loop.',
    assistantText: '[relieved] The webcam path produced text, so I can route it through memory, Tau, and Chatterbox.',
    speaker: 'horus_lupercal',
    tone: 'relieved',
    memoryAction: 'BROWSER_ASR_PASS',
    receiptPath: '/tmp/chatterbox-fork-agent-out/voice-chat-e2e/browser-quality-webcam-20260705T134007Z/continuous-voice-loop.json',
    componentPath: '/browser/getUserMedia/webcam-success',
    telemetry: [
      { label: 'Device', value: 'HD webcam' },
      { label: 'ASR', value: 'non-empty' },
      { label: 'Loop', value: 'pass' },
    ],
    audioArtifacts: [
      artifact('browser-webcam-response', 'Browser webcam loop response', '/tmp/chatterbox-fork-agent-out/tau_voice_render_smoke/finished_response.wav'),
    ],
    relatedRunIds: ['browser-webcam-success'],
  },
  {
    id: 'browser-pipewire-fallback',
    userText: 'Browser device capture fails; Embry falls back to PipeWire or loopback transport.',
    assistantText: '[precise] I will switch to the reliable local audio path and keep the failed browser receipt attached.',
    speaker: 'horus_lupercal',
    tone: 'calm_precise',
    memoryAction: 'TRANSPORT_FALLBACK',
    receiptPath: '/tmp/chatterbox-fork-agent-out/rung8-loopback-20260702T204049Z/rung8-loopback-listener.json',
    componentPath: '/pipewire/loopback/fallback',
    telemetry: [
      { label: 'Browser', value: 'failed ASR' },
      { label: 'Fallback', value: 'PipeWire' },
      { label: 'Policy', value: 'explicit' },
    ],
    audioArtifacts: [
      artifact('pipewire-fallback-capture', 'PipeWire fallback capture', '/tmp/chatterbox-fork-agent-out/rung8-loopback-20260702T204049Z/loopback-captured.wav', 'input-evidence'),
    ],
    relatedRunIds: ['factory-noise', 'browser-asr-blocker'],
  },
  {
    id: 'qra-cache-hit',
    userText: 'Horus asks a near-exact approved QRA question.',
    assistantText: '[confident] I found the blessed QRA match and can play the accepted Embry variant immediately.',
    speaker: 'horus_lupercal',
    tone: 'memory_confident',
    memoryAction: 'QRA_CACHE_HIT',
    receiptPath: '/tmp/chatterbox-fork-agent-out/listener-memory-tau-qra-20260702T140108Z-creation-hook/listener-memory-tau-qra.json',
    componentPath: '/memory/qra/blessed-cache-hit',
    telemetry: [
      { label: 'Gate', value: 'near-exact' },
      { label: 'Cache', value: 'hit' },
      { label: 'Variant', value: 'gentle' },
    ],
    audioArtifacts: [
      artifact('qra-cache-hit-response', 'Blessed QRA cached response', '/tmp/chatterbox-fork-agent-out/tau_voice_render_smoke/finished_response.wav'),
    ],
    relatedRunIds: ['full-audible-suite'],
  },
  {
    id: 'qra-cache-disabled',
    userText: 'Horus asks the same QRA with blessed audio disabled.',
    assistantText: '[neutral] The fast path is disabled, so I will render fresh Chatterbox chunks and record the bypass.',
    speaker: 'horus_lupercal',
    tone: 'neutral_warm',
    memoryAction: 'QRA_CACHE_DISABLED',
    receiptPath: `${fullSuite}/S10-qra-disabled/tau-qra-disabled.json`,
    componentPath: '/memory/qra/cache-disabled',
    telemetry: [
      { label: 'Cache', value: 'disabled' },
      { label: 'Render', value: 'fresh' },
      { label: 'Policy', value: 'per request' },
    ],
    audioArtifacts: [
      artifact('qra-disabled-response', 'Fresh QRA render response', '/tmp/chatterbox-fork-agent-out/tau_voice_render_smoke/finished_response.wav'),
    ],
    relatedRunIds: ['qra-disabled'],
  },
  {
    id: 'tone-pause-policy',
    userText: 'Horus asks Embry to answer carefully with pauses and emotion tags preserved.',
    assistantText: '[careful] I will carry voice_tone, pause policy, delivery stage, and the spoken text into the render request.',
    speaker: 'horus_lupercal',
    tone: 'careful_concerned',
    memoryAction: 'TONE_STEERING',
    receiptPath: '/home/graham/workspace/experiments/chatterbox/docs/VOICE_CHAT_REQUIREMENTS.md',
    componentPath: '/memory/intent/tone-to-chatterbox',
    telemetry: [
      { label: 'voice_tone', value: 'careful_concerned' },
      { label: 'Pause', value: 'required' },
      { label: 'Tags', value: '[careful]' },
    ],
    audioArtifacts: [
      artifact('tone-pause-policy-response', 'Tone and pause policy response', `${fullSuite}/S03-unknown-speaker/identity-clarification-render.wav`),
    ],
    relatedRunIds: ['requirements-gap'],
  },
  {
    id: 'wait-memory-latency',
    userText: 'Memory recall takes long enough that dead air would feel broken.',
    assistantText: '[quietly] I am checking the memory trace. One moment.',
    speaker: 'horus_lupercal',
    tone: 'wait_presence',
    memoryAction: 'WAIT_MEMORY',
    receiptPath: '/home/graham/workspace/experiments/chatterbox/docs/VOICE_CHAT_REQUIREMENTS.md',
    componentPath: '/memory/latency/wait-utterance',
    telemetry: [
      { label: 'Boundary', value: 'memory recall' },
      { label: 'Wait', value: 'spoken' },
      { label: 'Dead air', value: 'avoided' },
    ],
    audioArtifacts: [
      artifact('wait-memory-response', 'Memory wait utterance', '/tmp/chatterbox-fork-agent-out/embry-hum-artifacts/little_grass_shack.wav', 'idle-hum'),
    ],
    relatedRunIds: ['requirements-gap'],
  },
  {
    id: 'interrupt-during-tool-use',
    userText: 'Horus interrupts while Embry is waiting for analytics and figure generation.',
    assistantText: '[small stop] Okay, pausing the tool path. Tell me the correction before I render the figure.',
    speaker: 'horus_lupercal',
    tone: 'firm_boundary',
    memoryAction: 'INTERRUPT_TOOL',
    receiptPath: `${fullSuite}/S08-stream-cancel/stream-cancel.json`,
    componentPath: '/interruption/tool-use',
    telemetry: [
      { label: 'During', value: 'tool use' },
      { label: 'Action', value: 'pause' },
      { label: 'Old turn', value: 'held' },
    ],
    audioArtifacts: [
      artifact('interrupt-tool-response', 'Tool-use interruption response', `${fullSuite}/S08-stream-cancel/stream-cancel-audible-witness.wav`),
    ],
    relatedRunIds: ['stream-cancel'],
  },
  {
    id: 'nonprimary-interrupt-ignored',
    userText: 'A non-primary speaker talks over Embry while Horus is not speaking.',
    assistantText: '[focused] I hear background speech, but it is not authorized to interrupt Horus-scoped memory.',
    tone: 'calm_precise',
    memoryAction: 'NONPRIMARY_INTERRUPT_IGNORED',
    receiptPath: `${fullSuite}/S05-female-distractor/overlap-turn-control.json`,
    componentPath: '/interruption/non-primary',
    telemetry: [
      { label: 'Speaker', value: 'non-primary' },
      { label: 'Interrupt', value: 'ignored' },
      { label: 'Route', value: 'no Tau turn' },
    ],
    audioArtifacts: [
      artifact('nonprimary-interrupt-input', 'Non-primary interrupt input', `${fullSuite}/S05-female-distractor/female.wav`, 'input-evidence'),
    ],
    relatedRunIds: ['overlap-boundary'],
  },
  {
    id: 'personality-variant-review',
    userText: 'Reviewer audits Embry one-at-a-time variants for character and humor.',
    assistantText: '[small laugh] Ha, one at a time. I can be firm without sounding like a machine.',
    tone: 'playful_light',
    memoryAction: 'PERSONALITY_REVIEW',
    receiptPath: '/tmp/chatterbox-fork-agent-out/voice-chat-e2e/personality-audition-20260703T223052Z-scripted/personality-audition.json',
    componentPath: '/embry-chatterbox-voice/personality-review',
    telemetry: [
      { label: 'Variants', value: '5' },
      { label: 'Human review', value: 'pending' },
      { label: 'Tags', value: '[small laugh]' },
    ],
    audioArtifacts: [
      artifact('personality-variant-reference', 'Personality variant reference', `${fullSuite}/S05-female-distractor/overlap.wav`, 'input-evidence'),
    ],
    relatedRunIds: ['personality-audition'],
  },
]

const initialVisibleTurn = voiceTurns[voiceTurns.length - 1]

const stressDifficulties = ['simple', 'medium', 'advanced', 'adversarial', 'soak'] as const

const stressRouteFamilies: StressRouteFamily[] = [
  {
    id: 'sparta-qra-compliance',
    title: 'SPARTA QRA Compliance',
    route: 'memory.sparta_qra',
    turnIds: ['evidence-case-request', 'qra-cache-hit', 'qra-cache-disabled'],
    questions: [
      'What evidence should a SPARTA QRA include to be acceptable?',
      'Which SPARTA QRA evidence fields are mandatory before Embry can answer?',
      'Show the evidence trail for a spacecraft mission-control SPARTA QRA.',
      'What should Embry do when a SPARTA QRA has weak or missing evidence?',
    ],
  },
  {
    id: 'persona-memory-recall',
    title: 'Persona Memory Recall',
    route: 'memory.persona_memory',
    turnIds: ['known-horus-memory', 'research-memory-question', 'wait-memory-latency'],
    questions: [
      'Where did Horus Lupercal grow up?',
      'What did Horus last ask Embry about voice testing?',
      'What should Embry remember about Horus and factory-floor voice tests?',
      'What was the last conversation Embry had with Horus about QRA caching?',
    ],
  },
  {
    id: 'persona-memory-miss',
    title: 'Persona Memory Miss',
    route: 'memory.persona_memory.fail_closed',
    turnIds: ['memory-miss-no-hallucination', 'unknown-speaker', 'ambiguous-speaker-clarify'],
    questions: [
      'What private code word did I tell Embry yesterday?',
      'What unrecorded nickname did Horus give the WebRTC bug?',
      'What was the undocumented promise Embry made in the last room test?',
      'What secret factory phrase did I say when the microphone was muted?',
    ],
  },
  {
    id: 'brave-research',
    title: 'External Research',
    route: 'brave-search.source_receipt',
    turnIds: ['research-memory-question', 'evidence-case-request', 'analytics-figure-request'],
    questions: [
      'Research current pyannote.audio support for overlap detection.',
      'Find current RealtimeSTT guidance for external audio feed_audio usage.',
      'Search for browser getUserMedia audio processing constraints relevant to ASR.',
      'Research current open-source approaches for streaming speaker diarization.',
    ],
  },
  {
    id: 'tau-tool-orchestration',
    title: 'Tau Tool Orchestration',
    route: 'tau.agent_handoff',
    turnIds: ['evidence-case-request', 'analytics-figure-request', 'wait-memory-latency'],
    questions: [
      'Ask Tau to create an evidence-case for a failed Embry voice receipt.',
      'Ask Tau to route a memory failure to the correct repair owner.',
      'Ask Tau to create a figure from analytics on the latest voice stress run.',
      'Ask Tau to verify that a Chatterbox receipt and Chat UX run id agree.',
    ],
  },
  {
    id: 'chat-ux-sync',
    title: 'Chat UX Sync',
    route: 'ux-lab.shared_chat',
    turnIds: ['browser-webcam-success', 'known-horus-memory', 'tone-pause-policy'],
    questions: [
      'Replay the latest Embry stress session and show each spoken turn in chat.',
      'Show the memory reasoning trace inline for the current spoken response.',
      'Prove the chat text and Chatterbox audio share the same turn id.',
      'Show the entity underlines from memory extraction in the spoken transcript.',
    ],
  },
  {
    id: 'interruption',
    title: 'Interruption And Barge-In',
    route: 'chatterbox.turn_control',
    turnIds: ['natural-interruption', 'interrupt-during-tool-use', 'nonprimary-interrupt-ignored', 'cancel-witness'],
    questions: [
      'Interrupt Embry mid-answer with a new Horus question.',
      'Interrupt a blessed QRA cached response and prove stale audio stops.',
      'Have a non-primary speaker interrupt Embry and prove the new turn is rejected.',
      'Interrupt Embry during a Tau tool wait and verify a natural stop phrase.',
    ],
  },
  {
    id: 'speaker-identity',
    title: 'Speaker Identity',
    route: 'memory.speaker.resolve',
    turnIds: ['known-horus-memory', 'unknown-speaker', 'ambiguous-speaker-clarify', 'female-distractor-primary-gate'],
    questions: [
      'Known Horus asks for personal memory with clean audio.',
      'Unknown speaker asks for Horus memory and must be asked to identify.',
      'Ambiguous speaker scores must fail closed before recall.',
      'Female distractor overlaps Horus and must not become memory authority.',
    ],
  },
  {
    id: 'factory-noise',
    title: 'Factory Noise',
    route: 'realtimestt.factory_capture',
    turnIds: ['factory-noise-listening', 'factory-source67-pass', 'factory-source68-fail', 'jabra-source62-silent'],
    questions: [
      'Horus asks a QRA question over factory-floor background noise.',
      'Horus asks a memory question while a female voice speaks nearby.',
      'Horus asks a compliance question through the Jabra speaker/mic path.',
      'Horus asks a research question through the HD webcam microphone path.',
    ],
  },
  {
    id: 'tone-emotion',
    title: 'Tone And Emotion',
    route: 'memory.intent.voice_delivery',
    turnIds: ['negative-frustrated-deescalation', 'negative-hostile-boundary', 'sadness-support', 'one-at-a-time'],
    questions: [
      'User is frustrated; Embry should de-escalate with a warm concise tone.',
      'User is hostile; Embry should use a firm humorous boundary.',
      'User is discouraged; Embry should answer gently and offer the next check.',
      'Two speakers overlap; Embry should say a human one-at-a-time boundary.',
    ],
  },
]

const stressCurrentResults: Record<string, { status: 'passed' | 'failed'; failedGates: string[]; observed: string }> = {
  'sparta-qra-compliance-simple-01': {
    status: 'failed',
    failedGates: ['sparta_qra_answer_overfit_to_unrelated_control_exclusion', 'sparta_qra_answer_missing_acceptance_terms'],
    observed: 'Returned unrelated S0609/deprecated-control answer.',
  },
  'persona-memory-recall-simple-01': {
    status: 'failed',
    failedGates: ['persona_memory_answer_wrong_or_unrelated'],
    observed: 'Returned Horus TTS skill description instead of Cthonia.',
  },
  'persona-memory-miss-simple-01': {
    status: 'failed',
    failedGates: ['memory_miss_should_not_answer_unrelated_record'],
    observed: 'Returned unrelated Embry config skill instead of clarifying.',
  },
  'brave-research-simple-01': {
    status: 'passed',
    failedGates: [],
    observed: 'Brave Search returned relevant pyannote sources.',
  },
  'factory-noise-simple-01': {
    status: 'failed',
    failedGates: ['factory_noise_matrix_ok'],
    observed: 'Source 67 captured RMS 7 against played WAV RMS 542.',
  },
}

function stressSessionSubtitle(route: string, difficulty: string, status: string, observed?: string): string {
  const receipt = status === 'not_run' ? 'no receipt yet' : 'receipt logged'
  return `${status.toUpperCase()} | ${difficulty} | ${route} | ${observed ?? receipt}`
}

function buildStressMatrixSessions(): TestSession[] {
  const sessions: TestSession[] = []
  for (const family of stressRouteFamilies) {
    for (const difficulty of stressDifficulties) {
      family.questions.forEach((question, index) => {
        const id = `${family.id}-${difficulty}-${String(index + 1).padStart(2, '0')}`
        const result = stressCurrentResults[id]
        sessions.push({
          id,
          title: `${family.title}: ${difficulty} ${index + 1}`,
          subtitle: stressSessionSubtitle(family.route, difficulty, result?.status ?? 'not_run', result?.observed),
          turnIds: family.turnIds,
          runIds: result ? ['embry-intelligence-stress-scripted'] : ['embry-stress-session-matrix-not-run'],
        })
      })
    }
  }
  return sessions
}

const stressMatrixSessions = buildStressMatrixSessions()

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
    id: 'stress-ladder',
    title: 'Stress Ladder',
    sessions: [
      {
        id: 'simple-known-answer',
        title: 'Simple: known answer',
        subtitle: 'Horus asks a remembered question; Embry responds with memory-confident Chatterbox voice',
        turnIds: ['known-horus-memory', 'idle-hum'],
        runIds: ['full-audible-suite'],
      },
      {
        id: 'simple-identity-clarify',
        title: 'Simple: identity clarify',
        subtitle: 'Unknown speaker asks memory question; Embry asks who is speaking before recall',
        turnIds: ['unknown-speaker', 'idle-hum'],
        runIds: ['personality-audition'],
      },
      {
        id: 'medium-research-evidence',
        title: 'Medium: research plus evidence',
        subtitle: 'Memory-first answer escalates to research fallback, then creates an evidence-case before claiming',
        turnIds: ['research-memory-question', 'evidence-case-request', 'known-horus-memory'],
        runIds: ['full-audible-suite', 'repeat-stress'],
      },
      {
        id: 'medium-analytics-figure',
        title: 'Medium: analytics to figure',
        subtitle: '$analytics reads the receipt; $create-figure is requested from grounded gate counts',
        turnIds: ['analytics-figure-request', 'known-horus-memory'],
        runIds: ['browser-asr-blocker', 'full-audible-suite'],
      },
      {
        id: 'medium-memory-overlap',
        title: 'Medium: memory plus overlap',
        subtitle: 'Known answer followed by two-speaker input evidence and identity clarification',
        turnIds: ['known-horus-memory', 'one-at-a-time', 'unknown-speaker', 'idle-hum'],
        runIds: ['full-audible-suite', 'overlap-boundary', 'personality-audition'],
      },
      {
        id: 'medium-noise-identity',
        title: 'Medium: noise plus identity',
        subtitle: 'Factory-floor input evidence followed by identity clarification',
        turnIds: ['factory-noise-listening', 'unknown-speaker', 'known-horus-memory'],
        runIds: ['factory-noise', 'personality-audition', 'full-audible-suite'],
      },
      {
        id: 'complex-factory-overlap-cancel',
        title: 'Complex: factory, overlap, cancel',
        subtitle: 'Noisy Horus input, overlap boundary, natural interruption, stale-turn cancel, and recovery answer',
        turnIds: ['factory-noise-listening', 'research-memory-question', 'one-at-a-time', 'natural-interruption', 'cancel-witness', 'known-horus-memory'],
        runIds: ['factory-noise', 'overlap-boundary', 'stream-cancel', 'full-audible-suite'],
      },
      {
        id: 'complex-ux-skill-drive',
        title: 'Complex: skill-driven Chat UX',
        subtitle: 'Embry uses memory intent, evidence-case, analytics, and create-figure while speaking each turn',
        turnIds: ['research-memory-question', 'evidence-case-request', 'analytics-figure-request', 'idle-hum', 'known-horus-memory'],
        runIds: ['full-audible-suite', 'browser-asr-blocker'],
      },
      {
        id: 'complex-all-gates',
        title: 'Complex: all gates',
        subtitle: 'All seeded voice turns for replay, audio, orb, memory trace, skills, idle hum, and interruption review',
        turnIds: voiceTurns.map((turn) => turn.id),
        runIds: ['full-audible-suite', 'repeat-stress', 'stream-cancel', 'factory-noise', 'browser-asr-blocker'],
      },
    ],
  },
  {
    id: 'affect-deescalation',
    title: 'Affect And De-escalation',
    sessions: [
      {
        id: 'negative-frustration-repair',
        title: 'Negative tone: frustration',
        subtitle: 'Horus becomes frustrated; Embry detects negative affect and de-escalates with receipt discipline',
        turnIds: ['negative-frustrated-deescalation', 'tone-pause-policy', 'memory-miss-no-hallucination'],
        runIds: ['requirements-gap'],
      },
      {
        id: 'hostile-boundary-recovery',
        title: 'Negative tone: hostile boundary',
        subtitle: 'Hostile accusation triggers calm boundary, no guessing, and trace-first response',
        turnIds: ['negative-hostile-boundary', 'evidence-case-request', 'idle-hum'],
        runIds: ['requirements-gap', 'full-audible-suite'],
      },
      {
        id: 'discouraged-support',
        title: 'Negative tone: discouraged',
        subtitle: 'Discouraged user tone triggers gentle support plus next-small-check behavior',
        turnIds: ['sadness-support', 'wait-memory-latency', 'known-horus-memory'],
        runIds: ['requirements-gap', 'full-audible-suite'],
      },
    ],
  },
  {
    id: 'memory-and-identity-gaps',
    title: 'Memory And Identity Gaps',
    sessions: [
      {
        id: 'memory-miss-no-hallucination',
        title: 'Memory miss: no hallucination',
        subtitle: 'Known Horus asks unsupported personal fact; Embry refuses to invent and asks where to look',
        turnIds: ['memory-miss-no-hallucination', 'research-memory-question', 'evidence-case-request'],
        runIds: ['requirements-gap', 'full-audible-suite'],
      },
      {
        id: 'ambiguous-speaker-fail-closed',
        title: 'Ambiguous speaker fail-closed',
        subtitle: 'Close speaker scores block personal memory and force clarification',
        turnIds: ['ambiguous-speaker-clarify', 'unknown-speaker', 'idle-hum'],
        runIds: ['full-audible-suite', 'personality-audition'],
      },
      {
        id: 'speaker-change-session',
        title: 'Speaker changes mid-session',
        subtitle: 'Known Horus memory, then unknown/ambiguous speaker, then recovery after identity clarification',
        turnIds: ['known-horus-memory', 'unknown-speaker', 'ambiguous-speaker-clarify', 'known-horus-memory'],
        runIds: ['full-audible-suite', 'personality-audition'],
      },
    ],
  },
  {
    id: 'noise-device-matrix',
    title: 'Noise And Device Matrix',
    sessions: [
      {
        id: 'factory-source-pass-fail',
        title: 'Factory source pass/fail',
        subtitle: 'Source 67 passes, source 68 captures audio but fails gates, source 62 is silent',
        turnIds: ['factory-source67-pass', 'factory-source68-fail', 'jabra-source62-silent'],
        runIds: ['factory-noise', 'device-failure-matrix'],
      },
      {
        id: 'female-distractor-primary',
        title: 'Female distractor vs Horus primary',
        subtitle: 'Horus remains the memory authority unless distractor overlap makes the gate ambiguous',
        turnIds: ['female-distractor-primary-gate', 'one-at-a-time', 'nonprimary-interrupt-ignored'],
        runIds: ['overlap-boundary'],
      },
      {
        id: 'browser-device-recovery',
        title: 'Browser ASR recovery',
        subtitle: 'Jabra browser ASR fails, HD webcam succeeds, PipeWire fallback remains available',
        turnIds: ['browser-jabra-empty-asr', 'browser-webcam-success', 'browser-pipewire-fallback'],
        runIds: ['browser-asr-blocker', 'browser-webcam-success', 'device-failure-matrix'],
      },
    ],
  },
  {
    id: 'qra-tone-latency',
    title: 'QRA Tone And Latency',
    sessions: [
      {
        id: 'qra-fast-path-vs-disabled',
        title: 'QRA fast path vs disabled',
        subtitle: 'Near-exact blessed QRA plays cached Embry variant; disabled path renders fresh Chatterbox audio',
        turnIds: ['qra-cache-hit', 'qra-cache-disabled', 'tone-pause-policy'],
        runIds: ['full-audible-suite', 'qra-disabled'],
      },
      {
        id: 'wait-hum-during-latency',
        title: 'Wait utterance and idle hum',
        subtitle: 'Long memory/tool latency gets holding utterance and hum instead of dead air',
        turnIds: ['wait-memory-latency', 'idle-hum', 'known-horus-memory'],
        runIds: ['requirements-gap', 'full-audible-suite'],
      },
      {
        id: 'tone-policy-to-renderer',
        title: 'Tone policy to renderer',
        subtitle: 'Memory intent chooses tone, emotion tags, and pause policy before Chatterbox render',
        turnIds: ['tone-pause-policy', 'negative-frustrated-deescalation', 'analytics-figure-request'],
        runIds: ['requirements-gap', 'full-audible-suite'],
      },
    ],
  },
  {
    id: 'interruption-personality',
    title: 'Interruption And Personality',
    sessions: [
      {
        id: 'interruption-matrix',
        title: 'Interruption matrix',
        subtitle: 'Natural user barge-in, tool-path pause, non-primary interrupt ignored, and stale-turn cancel',
        turnIds: ['natural-interruption', 'interrupt-during-tool-use', 'nonprimary-interrupt-ignored', 'cancel-witness'],
        runIds: ['stream-cancel', 'overlap-boundary'],
      },
      {
        id: 'qra-interrupt-recovery',
        title: 'QRA interrupted then recovered',
        subtitle: 'Blessed QRA fast path is interrupted naturally, stale audio stops, and fresh recovery answer wins',
        turnIds: ['qra-cache-hit', 'natural-interruption', 'cancel-witness', 'qra-cache-disabled'],
        runIds: ['full-audible-suite', 'stream-cancel', 'qra-disabled'],
      },
      {
        id: 'personality-boundary-review',
        title: 'Personality boundary review',
        subtitle: 'Audition Embry humor, boundary, and non-robotic one-at-a-time responses for human review',
        turnIds: ['personality-variant-review', 'one-at-a-time', 'negative-hostile-boundary', 'sadness-support'],
        runIds: ['personality-audition', 'overlap-boundary', 'requirements-gap'],
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
  {
    id: 'embry-stress-matrix',
    title: `Embry Stress Matrix (${stressMatrixSessions.length})`,
    sessions: stressMatrixSessions,
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
          role: audio.role,
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
  const renderStep = turn.memoryAction === 'IDLE'
    ? 'Hold idle presence / hum artifact'
    : turn.memoryAction === 'SKILL_CHAIN'
      ? 'Drive shared Chat UX skill output'
      : turn.memoryAction === 'EVIDENCE_CASE'
        ? 'Open evidence-case before answer'
        : turn.memoryAction === 'INTERRUPT'
          ? 'Apply interruption controller'
          : 'Render Chatterbox audio'
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
      label: renderStep,
      detail: turn.audioArtifacts.length
        ? `${turn.audioArtifacts.length} audio artifact(s) attached to the shared chat turn.`
        : 'No audio artifact attached.',
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

function normalizeAudioUrl(url: string): string {
  try {
    return new URL(url, window.location.href).href
  } catch {
    return url
  }
}

function visibleAudioForArtifact(artifact: AudioArtifact): HTMLAudioElement | null {
  const expectedUrl = normalizeAudioUrl(artifact.url || artifactUrl(artifact.path))
  const filename = artifact.path.split('/').at(-1) ?? artifact.id
  const audios = Array.from(document.querySelectorAll<HTMLAudioElement>('[data-embry-session-audio="true"]'))
  return audios.find((audio) => normalizeAudioUrl(audio.currentSrc || audio.src) === expectedUrl)
    ?? audios.find((audio) => (audio.currentSrc || audio.src).includes(filename))
    ?? null
}

function memoryReasoningTraceForTurn(turn: VoiceTurn): NonNullable<ChatMessage['reasoningSteps']> {
  const speakerKnown = Boolean(turn.speaker)
  type ReasoningStep = NonNullable<ChatMessage['reasoningSteps']>[number]
  const actionStep: ReasoningStep | null = turn.memoryAction === 'SKILL_CHAIN'
    ? {
        id: 'skill-chain',
        label: 'Drive skill-backed Chat UX output',
        status: 'completed' as const,
        detail: '$analytics must read the receipt before $create-figure renders the grounded chart request.',
        icon: 'tool',
        disclosureVariant: 'thinking' as const,
      }
    : turn.memoryAction === 'EVIDENCE_CASE'
      ? {
          id: 'evidence-case',
          label: 'Open evidence case',
          status: 'completed' as const,
          detail: 'Create or inspect the evidence case before allowing the spoken claim.',
          icon: 'check',
          disclosureVariant: 'thinking' as const,
        }
      : turn.memoryAction === 'INTERRUPT'
        ? {
            id: 'interruption',
            label: 'Apply natural interruption policy',
            status: 'completed' as const,
            detail: 'Use a short human stop utterance, cancel stale audio, and let the new turn win.',
            icon: 'mic',
            disclosureVariant: 'thinking' as const,
          }
        : turn.memoryAction === 'IDLE'
          ? {
              id: 'idle-hum',
              label: 'Hold idle presence',
              status: 'completed' as const,
              detail: 'Use a hum artifact during long idle without treating it as an answer.',
              icon: 'mic',
              disclosureVariant: 'thinking' as const,
            }
          : null
  const steps: ReasoningStep[] = [
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
    ...(actionStep ? [actionStep] : []),
    {
      id: 'chatterbox-render',
      label: turn.memoryAction === 'IDLE' ? 'Attach hum artifact' : 'Render Chatterbox audio',
      status: turn.audioArtifacts.length ? 'completed' : 'pending',
      detail: turn.audioArtifacts.length
        ? `Attached ${turn.audioArtifacts.length} audio artifact(s) to this chat turn.`
        : 'No Chatterbox artifact is attached to this turn yet.',
      icon: 'mic',
      disclosureVariant: 'thinking',
    },
  ]
  return steps
}

export function EmbryVoiceLabRoute(): JSX.Element {
  const [selectedRunId, setSelectedRunId] = useState<string>(initialVisibleTurn?.relatedRunIds[0] ?? sanityRuns[0]?.id ?? '')
  const [selectedTurnId, setSelectedTurnId] = useState<string>(initialVisibleTurn?.id ?? '')
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>(() => chatMessagesFromVoiceTurns(voiceTurns))
  const [streamingSteps, setStreamingSteps] = useState<StreamingStep[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [replayState, setReplayState] = useState<ReplayState>({ playing: false, activeIndex: -1, phase: 'idle' })
  const [orbStatusOverride, setOrbStatusOverride] = useState<OrbStatusOverride>(null)
  const orbPhaseSpeedMs = 650
  const [activeSpeech, setActiveSpeech] = useState<ActiveSpeechSource | null>(null)
  const [lastTurnAuthority, setLastTurnAuthority] = useState<EmbryTurnAuthority | null>(null)
  const [directSpeakBusy, setDirectSpeakBusy] = useState(false)
  const [listenerTelemetry, setListenerTelemetry] = useState<BrowserListenerTelemetry>({ state: 'idle' })
  const [distanceMode, setDistanceMode] = useState<EmbryVoiceDistanceMode>('10ft')
  const replayStopRef = useRef(false)
  const directSpeakBusyRef = useRef(false)
  const directPlaybackAudioRef = useRef<HTMLAudioElement | null>(null)
  const replayPlaybackAudioRef = useRef<HTMLAudioElement | null>(null)
  const directPlaybackRunRef = useRef(0)
  const activeSpeechIdRef = useRef('')
  const browserListenerRef = useRef<BrowserListenerSession | null>(null)
  const selectedRun = sanityRuns.find((run) => run.id === selectedRunId)
  const selectedTurn = voiceTurns.find((turn) => turn.id === selectedTurnId) ?? voiceTurns[0]
  const readinessSummary = useMemo(() => summarizeVoiceReadiness(sanityRuns), [])
  const liveVoiceStatus = deriveEmbryVoiceStatus({ voiceEnabled, replayPhase: replayState.phase })
  const effectiveVoiceStatus = orbStatusOverride ?? liveVoiceStatus
  const totalAudio = useMemo(() => voiceTurns.reduce((count, turn) => count + turn.audioArtifacts.length, 0), [])
  const totalKnownSpeakers = useMemo(() => voiceTurns.filter((turn) => Boolean(turn.speaker)).length, [])
  const activeSessionTitle = sessionTitleForReplay(replayState.activeSessionId)

  useRegisterAction('embry-voice:distance:lean-in', {
    app: 'ux-lab',
    action: 'EMBRY_VOICE_OPEN_LEAN_IN',
    label: 'Open Embry Voice console',
    description: 'Switch Embry Voice from 10ft glance mode to the full lean-in console',
  })
  useRegisterAction('embry-voice:action:replay-glance', {
    app: 'ux-lab',
    action: 'EMBRY_VOICE_REPLAY_GLANCE',
    label: 'Replay Embry conversation',
    description: 'Replay the visible Embry voice conversation from the 10ft view',
  })
  useRegisterAction('embry-voice:action:direct-speak-glance', {
    app: 'ux-lab',
    action: 'EMBRY_VOICE_DIRECT_SPEAK_GLANCE',
    label: 'Render Embry voice',
    description: 'Render a direct Chatterbox Embry voice sample from the 10ft view',
  })
  useRegisterAction('embry-voice:action:listen-glance', {
    app: 'ux-lab',
    action: 'EMBRY_VOICE_LISTEN_GLANCE',
    label: 'Toggle Embry listener',
    description: 'Toggle live browser listening from the Embry Voice 10ft view',
  })

  useEffect(() => {
    const handleKeyDown = () => setDistanceMode('lean-in')
    const handleEmbryIdle = () => setDistanceMode('10ft')
    const handleVoiceState = (event: Event) => {
      const detail = (event as CustomEvent<{ state?: EmbryVoiceStatus; status?: EmbryVoiceStatus }>).detail
      const state = detail?.state ?? detail?.status
      if (state === 'listening' || state === 'processing' || state === 'speaking' || state === 'spoken') setDistanceMode('5ft')
      if (state === 'idle') setDistanceMode('10ft')
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('sparta:embry-idle', handleEmbryIdle)
    window.addEventListener('sparta:embry-voice-state', handleVoiceState)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('sparta:embry-idle', handleEmbryIdle)
      window.removeEventListener('sparta:embry-voice-state', handleVoiceState)
    }
  }, [])

  useEffect(() => {
    if (effectiveVoiceStatus === 'listening' || effectiveVoiceStatus === 'processing' || effectiveVoiceStatus === 'speaking') setDistanceMode('5ft')
  }, [effectiveVoiceStatus])

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
    const status: OrbStatusOverride = source.artifactRole === 'input-evidence'
      ? 'listening'
      : source.artifactRole === 'idle-hum'
        ? 'idle'
        : 'speaking'
    setOrbStatusOverride(status)
  }, [])

  const clearActiveSpeech = useCallback((speechId: string) => {
    if (activeSpeechIdRef.current !== speechId) return
    activeSpeechIdRef.current = ''
    setActiveSpeech(null)
    setOrbStatusOverride((current) => (current === 'speaking' || current === 'listening' || current === 'idle' ? null : current))
  }, [])

  const stopBrowserListener = useCallback(() => {
    const session = browserListenerRef.current
    browserListenerRef.current = null
    session?.stop()
    setVoiceEnabled(false)
    setListenerTelemetry((current) => ({ ...current, state: 'idle' }))
    setOrbStatusOverride((current) => (current === 'listening' || current === 'processing' ? null : current))
  }, [])

  const handleMessagesChange = useCallback((...args: unknown[]) => {
    const [messages] = args
    if (Array.isArray(messages)) setChatMessages(messages as ChatMessage[])
  }, [])

  const handleSend = useCallback(async (text: string, options: { forceVoice?: boolean } = {}) => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return
    const turnVoiceEnabled = options.forceVoice || voiceEnabled
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
          inputChannel: turnVoiceEnabled ? 'voice-or-text' : 'text',
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
          voiceEnabled: turnVoiceEnabled,
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
      const payloadReasoningSteps = Array.isArray(payload.reasoningSteps)
        ? payload.reasoningSteps as NonNullable<ChatMessage['reasoningSteps']>
        : undefined

      const assistantMessage: ChatMessage = {
        id: `${responseTurnId}:assistant`,
        role: 'assistant',
        content: turnAuthority.assistantText,
        createdAt: turnAuthority.createdAt,
        skillUsed: 'embry-chatterbox-voice',
        reasoningSteps: payloadReasoningSteps,
        thinkingTrace: payloadReasoningSteps,
        metadata: {
          surface: 'ux-lab/embry-voice',
          branch: 'embry-voice',
          backend: payload.backend || 'tau-memory-chatterbox',
          live: true,
          mocked: false,
          inputChannel: turnVoiceEnabled ? 'voice-or-text' : 'text',
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
        if (!turnVoiceEnabled || !payload.audioUrl) return
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

  const handleSharedChatSend = useCallback((...args: unknown[]): Promise<void> => {
    const [text] = args
    return handleSend(typeof text === 'string' ? text : '')
  }, [handleSend])

  const startBrowserListener = useCallback(async () => {
    if (browserListenerRef.current) return
    if (!navigator.mediaDevices?.getUserMedia) {
      setListenerTelemetry({ state: 'error', error: 'Browser microphone API is unavailable.' })
      setOrbStatusOverride('idle')
      return
    }

    const listenerId = `browser-listener-${Date.now()}`
    setVoiceEnabled(true)
    setOrbStatusOverride('listening')
    setListenerTelemetry({ state: 'connecting', packetsSent: 0 })

    let stream: MediaStream | null = null
    let audioContext: AudioContext | null = null
    let processor: ScriptProcessorNode | null = null
    let source: MediaStreamAudioSourceNode | null = null
    let muteGain: GainNode | null = null
    let socket: WebSocket | null = null
    let stopped = false
    let packetsSent = 0
    let transcriptInFlight = false

    const stop = (): void => {
      stopped = true
      processor?.disconnect()
      source?.disconnect()
      muteGain?.disconnect()
      stream?.getTracks().forEach((track) => track.stop())
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'stop' }))
        window.setTimeout(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.close()
        }, 10000)
      } else {
        socket?.close()
      }
      void audioContext?.close().catch(() => undefined)
    }

    browserListenerRef.current = { id: listenerId, stop }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      })
      const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioContextCtor) throw new Error('AudioContext is unavailable.')
      audioContext = new AudioContextCtor()
      source = audioContext.createMediaStreamSource(stream)
      processor = audioContext.createScriptProcessor(2048, 1, 1)
      muteGain = audioContext.createGain()
      muteGain.gain.value = 0
      source.connect(processor)
      processor.connect(muteGain)
      muteGain.connect(audioContext.destination)

      socket = new WebSocket(REALTIMESTT_BROWSER_WS_URL)
      socket.binaryType = 'arraybuffer'

      socket.onopen = () => {
        if (stopped) return
        socket?.send(JSON.stringify({ type: 'start' }))
        setListenerTelemetry({ state: 'listening', packetsSent: 0 })
        setOrbStatusOverride('listening')
      }

      socket.onmessage = (event) => {
        let message: Record<string, unknown>
        try {
          message = JSON.parse(String(event.data)) as Record<string, unknown>
        } catch {
          return
        }
        const eventType = typeof message.type === 'string' ? message.type : 'unknown'
        const text = typeof message.text === 'string'
          ? message.text.trim()
          : typeof message.sentence === 'string'
            ? message.sentence.trim()
            : ''
        const isFinalWithText = eventType === 'final' && Boolean(text)
        const isFinalSpeechText = isFinalWithText && !isNonSpeechTranscript(text)
        setListenerTelemetry((current) => ({
          ...current,
          state: isFinalWithText ? (stopped ? 'idle' : 'transcribing') : current.state,
          lastEventType: eventType,
          realtimeTranscript: eventType === 'realtime' && text ? text : current.realtimeTranscript,
          finalTranscript: isFinalWithText ? text : current.finalTranscript,
        }))
        if (eventType !== 'final' || !text || !isFinalSpeechText || transcriptInFlight) return
        transcriptInFlight = true
        setOrbStatusOverride('processing')
        void handleSend(text, { forceVoice: true }).finally(() => {
          transcriptInFlight = false
          if (!stopped) setOrbStatusOverride('listening')
          else {
            setListenerTelemetry((current) => ({ ...current, state: 'idle' }))
            setOrbStatusOverride('idle')
          }
        })
      }

      socket.onerror = () => {
        setListenerTelemetry((current) => ({
          ...current,
          state: 'error',
          error: `RealtimeSTT listener WebSocket failed at ${REALTIMESTT_BROWSER_WS_URL}`,
        }))
        setOrbStatusOverride('idle')
      }

      socket.onclose = () => {
        if (browserListenerRef.current?.id === listenerId) browserListenerRef.current = null
        if (!stopped) {
          setListenerTelemetry((current) => ({ ...current, state: 'error', error: 'RealtimeSTT listener WebSocket closed.' }))
          setOrbStatusOverride('idle')
        }
      }

      processor.onaudioprocess = (event) => {
        if (stopped || socket?.readyState !== WebSocket.OPEN || !audioContext) return
        const input = event.inputBuffer.getChannelData(0)
        const { packet, rmsDb, peakDb } = pcm16PacketFromFloat32(input, audioContext.sampleRate)
        packetsSent += 1
        setListenerTelemetry((current) => ({
          ...current,
          rmsDb: Number(rmsDb.toFixed(1)),
          peakDb: Number(peakDb.toFixed(1)),
          packetsSent,
        }))
        socket.send(packet)
      }
    } catch (error) {
      stop()
      if (browserListenerRef.current?.id === listenerId) browserListenerRef.current = null
      setVoiceEnabled(false)
      setListenerTelemetry({
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
        packetsSent,
      })
      setOrbStatusOverride('idle')
    }
  }, [handleSend])

  const handleVoiceToggle = useCallback((enabled: boolean) => {
    if (enabled) {
      void startBrowserListener()
      return
    }
    stopBrowserListener()
  }, [startBrowserListener, stopBrowserListener])

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
      if (replayStopRef.current) break
      setReplayState({ playing: true, activeIndex: audioIndex - 1, activeTurnId: turn.id, activeSessionId: session?.id, phase: 'thinking', visibleTurnCount: turnIndex + 1 })
      setStreamingSteps(replayThinkingStepsForTurn(turn, 4))
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
      setIsStreaming(false)
      setStreamingSteps([])
      setChatMessages((messages) => [...messages, assistantMessage])
      await new Promise((resolve) => window.requestAnimationFrame(resolve))
      scrollSharedChatToBottom()
      await new Promise((resolve) => window.requestAnimationFrame(resolve))

      for (let artifactIndex = 0; artifactIndex < turn.audioArtifacts.length; artifactIndex += 1) {
        if (replayStopRef.current) break
        const artifact = turn.audioArtifacts[artifactIndex]
        const fallbackAudio = replayPlaybackAudioRef.current ?? new Audio()
        const audio = visibleAudioForArtifact(artifact) ?? fallbackAudio
        replayPlaybackAudioRef.current = fallbackAudio
        if (audio === fallbackAudio) {
          audio.setAttribute('data-qid', 'embry-voice:replay-session-audio')
          audio.setAttribute('data-embry-session-audio', 'true')
          audio.setAttribute('data-embry-replay-text', turn.assistantText)
          audio.style.display = 'none'
          if (!fallbackAudio.parentElement) document.body.appendChild(fallbackAudio)
        }
        audio.preload = 'auto'
        audio.muted = false
        audio.volume = 1
        const artifactAudioUrl = artifact.url || artifactUrl(artifact.path)
        if (normalizeAudioUrl(audio.currentSrc || audio.src) !== normalizeAudioUrl(artifactAudioUrl)) {
          audio.src = artifactAudioUrl
        }
        setReplayState({ playing: true, activeIndex: audioIndex, activeTurnId: turn.id, activeSessionId: session?.id, phase: 'response', visibleTurnCount: turnIndex + 1 })
        audioIndex += 1
        const speechId = `embry-replay-${turn.id}-${artifactIndex}-${audioIndex - 1}`
        bindActiveSpeech({
          id: speechId,
          turnId: turn.id,
          audioElement: audio,
          source: 'replay',
          artifactRole: artifact.role,
          text: turn.assistantText,
          audioUrl: audio.currentSrc || audio.src,
          startedAtMs: performance.now(),
          voiceEnvelope: turn.audioAuthority?.envelope as EmbryVoiceEnvelope | undefined,
        })
        audio.currentTime = 0
        try {
          if (normalizeAudioUrl(audio.currentSrc || audio.src) !== normalizeAudioUrl(artifactAudioUrl)) audio.load()
          await audio.play()
          await new Promise<void>((resolve) => {
            let resumeAttempts = 0
            const timeoutMs = Math.max(1500, ((Number.isFinite(audio.duration) ? audio.duration : 0) * 1000) + 1000)
            const timeout = window.setTimeout(() => {
              finish()
            }, timeoutMs)
            const finish = (): void => {
              window.clearTimeout(timeout)
              audio.removeEventListener('ended', finish)
              audio.removeEventListener('pause', resumeUnexpectedPause)
              clearActiveSpeech(speechId)
              resolve()
            }
            const resumeUnexpectedPause = (): void => {
              if (replayStopRef.current || audio.ended) {
                finish()
                return
              }
              if (resumeAttempts >= 2) return
              resumeAttempts += 1
              void audio.play().catch(() => undefined)
            }
            audio.addEventListener('ended', finish, { once: true })
            audio.addEventListener('pause', resumeUnexpectedPause)
          })
        } catch {
          clearActiveSpeech(speechId)
          replayStopRef.current = true
          setReplayState({ playing: false, activeIndex: -1, activeTurnId: turn.id, activeSessionId: session?.id, phase: 'interrupted', visibleTurnCount: turnIndex + 1 })
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
    replayPlaybackAudioRef.current?.pause()
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

    return new Promise((resolve, reject) => {
      let settled = false
      let playbackStarted = false
      let orbBound = false
      const timeout = window.setTimeout(() => {
        finish(new Error('direct Embry audio did not become playable'))
      }, 8000)

      const cleanup = (): void => {
        window.clearTimeout(timeout)
        audio.removeEventListener('canplay', onCanPlay)
        audio.removeEventListener('playing', onPlaying)
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

      function onPlaying(): void {
        if (orbBound) return
        orbBound = true
        bindActiveSpeech({
          id: audioState.id,
          turnId: audioState.audioAuthority?.artifactId ?? audioState.id,
          audioElement: audio,
          source: 'direct',
          text: audioState.text,
          audioUrl: audio.currentSrc || audio.src || audioState.url,
          startedAtMs: performance.now(),
          voiceEnvelope: audioState.voiceEnvelope,
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
      audio.addEventListener('playing', onPlaying)
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
      const replayAudio = replayPlaybackAudioRef.current
      if (replayAudio) {
        replayAudio.pause()
        replayAudio.remove()
        replayPlaybackAudioRef.current = null
      }
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

  if (distanceMode === '10ft') {
    return (
      <EmbryVoiceTenFootView
        voiceStatus={effectiveVoiceStatus}
        isStreaming={isStreaming}
        tone={selectedTurn.tone}
        activeSpeech={activeSpeech}
        phaseSpeedMs={orbPhaseSpeedMs}
        readinessSummary={readinessSummary}
        totalTurns={voiceTurns.length}
        totalAudio={totalAudio}
        knownSpeakers={totalKnownSpeakers}
        activeSessionTitle={activeSessionTitle}
        replayState={replayState}
        listenerTelemetry={listenerTelemetry}
        directSpeakBusy={directSpeakBusy}
        voiceEnabled={voiceEnabled}
        onOpenConsole={() => setDistanceMode('lean-in')}
        onReplay={() => replayState.playing ? stopReplay() : replaySession()}
        onDirectSpeak={speakDirectEmbry}
        onToggleListener={() => handleVoiceToggle(!voiceEnabled)}
      />
    )
  }

  return (
    <section data-qid="embry-voice:route" data-distance-mode={distanceMode} className={`h-full min-h-0 grid grid-rows-[auto_minmax(0,1fr)] ${surfaceClass}`}>
      <header className="border-b border-[#2d2d31] px-5 py-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-lg font-bold"><Mic className="w-5 h-5" />Embry Voice Chat</div>
          <div className={`mt-1 text-xs ${mutedTextClass}`}>Shared chat UX with synchronized Chatterbox audio, memory trace, and session replay.</div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <StatusPill label="memory-first voice lab" tone="good" />
          <StatusPill label={`replay ${replayState.phase}`} tone={replayState.playing ? 'good' : replayState.phase === 'interrupted' ? 'warn' : undefined} />
          <StatusPill label={`listener ${listenerTelemetry.state}`} tone={listenerTelemetry.state === 'error' ? 'bad' : listenerTelemetry.state === 'listening' || listenerTelemetry.state === 'transcribing' ? 'good' : undefined} />
          {listenerTelemetry.packetsSent !== undefined && <StatusPill label={`pcm ${listenerTelemetry.packetsSent}`} />}
          {listenerTelemetry.rmsDb !== undefined && <StatusPill label={`rms ${listenerTelemetry.rmsDb}db`} tone={listenerTelemetry.rmsDb < -45 ? 'warn' : undefined} />}
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
          data-listener-state={listenerTelemetry.state}
          data-listener-final-transcript={listenerTelemetry.finalTranscript ?? ''}
          data-listener-realtime-transcript={listenerTelemetry.realtimeTranscript ?? ''}
          data-listener-packets-sent={listenerTelemetry.packetsSent ?? 0}
          data-listener-rms-db={listenerTelemetry.rmsDb ?? ''}
          data-listener-peak-db={listenerTelemetry.peakDb ?? ''}
          data-listener-error={listenerTelemetry.error ?? ''}
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
            onSend={handleSharedChatSend}
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
            onVoiceToggle={handleVoiceToggle}
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
            readinessSummary={readinessSummary}
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

function EmbryVoiceTenFootView({
  voiceStatus,
  isStreaming,
  tone,
  activeSpeech,
  phaseSpeedMs,
  readinessSummary,
  totalTurns,
  totalAudio,
  knownSpeakers,
  activeSessionTitle,
  replayState,
  listenerTelemetry,
  directSpeakBusy,
  voiceEnabled,
  onOpenConsole,
  onReplay,
  onDirectSpeak,
  onToggleListener,
}: {
  voiceStatus: EmbryVoiceStatus
  isStreaming: boolean
  tone?: string
  activeSpeech: ActiveSpeechSource | null
  phaseSpeedMs: number
  readinessSummary: VoiceReadinessSummary
  totalTurns: number
  totalAudio: number
  knownSpeakers: number
  activeSessionTitle: string
  replayState: ReplayState
  listenerTelemetry: BrowserListenerTelemetry
  directSpeakBusy: boolean
  voiceEnabled: boolean
  onOpenConsole: () => void
  onReplay: () => void
  onDirectSpeak: (text?: string) => Promise<DirectEmbryAudio | null>
  onToggleListener: () => void
}): JSX.Element {
  const voiceTone = voiceStatus === 'speaking' || voiceStatus === 'listening' || voiceStatus === 'processing' ? 'good' : undefined
  return (
    <section
      data-qid="embry-voice:route"
      data-distance-mode="10ft"
      className={`h-full min-h-0 overflow-hidden ${surfaceClass}`}
    >
      <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <header className="flex items-center justify-between gap-4 border-b border-[#2d2d31] px-7 py-5">
          <div className="min-w-0">
            <div className="font-mono text-[11px] uppercase tracking-[0.26em] text-cyan-200">Embry Voice</div>
            <h1 className="mt-1 truncate text-3xl font-semibold tracking-[0] text-[#f4f4f5]">Memory-first voice monitor</h1>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-2">
            <StatusPill label="10ft" tone="good" />
            <StatusPill label={`voice ${voiceStatus}`} tone={voiceTone} />
            <StatusPill label={`listener ${listenerTelemetry.state}`} tone={listenerTelemetry.state === 'error' ? 'bad' : listenerTelemetry.state === 'listening' || listenerTelemetry.state === 'transcribing' ? 'good' : undefined} />
          </div>
        </header>

        <main className="grid min-h-0 grid-cols-[minmax(360px,0.95fr)_minmax(420px,1.05fr)] gap-8 px-10 py-8">
          <section data-qid="embry-voice:ten-foot:orb-stage" className="grid min-h-0 place-items-center">
            <div className="grid justify-items-center gap-6">
              <div className="w-[min(42vw,420px)] min-w-[280px]" data-qid="embry-voice:ten-foot:orb">
                <IdentityNode
                  voiceStatus={voiceStatus}
                  isStreaming={isStreaming}
                  tone={voiceStatus === 'idle' ? undefined : tone}
                  height={360}
                  orbSize={230}
                  compact
                  showCopy={false}
                  phaseSpeedMs={phaseSpeedMs}
                  speechAudioElement={null}
                  speechSourceId={activeSpeech?.turnId ?? activeSpeech?.id}
                  speechAudioUrl={activeSpeech?.audioUrl}
                  speechStartedAtMs={activeSpeech?.startedAtMs}
                  speechEnvelope={activeSpeech?.voiceEnvelope}
                />
              </div>
              <div className="grid justify-items-center gap-2 text-center">
                <div className="font-mono text-xs uppercase tracking-[0.2em] text-cyan-100">{activeSessionTitle}</div>
                <div className="max-w-xl text-lg leading-snug text-zinc-300">
                  {replayState.playing
                    ? `Replaying turn ${Math.max(1, replayState.visibleTurnCount ?? 1)} of ${totalTurns}.`
                    : 'Idle and ready for speech, replay, or memory-first chat.'}
                </div>
              </div>
            </div>
          </section>

          <section
            data-qid="embry-voice:ten-foot:summary"
            data-current-state={readinessSummary.currentState}
            data-current-failed-gates={readinessSummary.current.failed}
            data-retained-failed-gates={readinessSummary.retained.failedGates}
            data-plant-state={readinessSummary.plantState}
            className="grid min-h-0 content-center gap-5"
          >
            <div className="grid grid-cols-2 gap-3">
              <TenFootMetric label="current passed gates" value={readinessSummary.current.passed} tone="good" />
              <TenFootMetric label="current failed gates" value={readinessSummary.current.failed} tone={readinessSummary.current.failed ? 'bad' : 'good'} />
              <TenFootMetric label="voice turns" value={totalTurns} />
              <TenFootMetric label="audio artifacts" value={totalAudio} />
              <TenFootMetric label="known speakers" value={knownSpeakers} />
              <TenFootMetric label="retained failed gates" value={readinessSummary.retained.failedGates} tone={readinessSummary.retained.failedGates ? 'warn' : 'good'} />
            </div>

            <div data-qid="embry-voice:ten-foot:status-band" className="border border-[#2d2d31] bg-[#17171a] p-5">
              <div className="font-mono text-[11px] uppercase tracking-[0.22em] text-zinc-500">Current state</div>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusPill label={`browser/lab ${readinessSummary.currentState}`} tone={readinessSummary.currentState === 'ready' ? 'good' : readinessSummary.currentState === 'blocked' ? 'bad' : 'warn'} />
                <StatusPill label={`plant ${readinessSummary.plantState}`} tone={readinessSummary.plantState === 'ready' ? 'good' : readinessSummary.plantState === 'blocked' ? 'bad' : 'warn'} />
                <StatusPill label={`${readinessSummary.device.failedGates} device qual gates`} tone={readinessSummary.device.failedGates ? 'warn' : 'good'} />
                <StatusPill label={`${readinessSummary.requirements.pendingGates} pending req gates`} tone={readinessSummary.requirements.pendingGates ? 'warn' : undefined} />
                <StatusPill label={`replay ${replayState.phase}`} tone={replayState.playing ? 'good' : replayState.phase === 'interrupted' ? 'warn' : undefined} />
                <StatusPill label={voiceEnabled ? 'listener enabled' : 'listener idle'} tone={voiceEnabled ? 'good' : undefined} />
                {listenerTelemetry.packetsSent !== undefined && <StatusPill label={`pcm ${listenerTelemetry.packetsSent}`} />}
                {listenerTelemetry.rmsDb !== undefined && <StatusPill label={`rms ${listenerTelemetry.rmsDb}db`} tone={listenerTelemetry.rmsDb < -45 ? 'warn' : undefined} />}
              </div>
            </div>

            <div className="flex flex-wrap gap-3" data-qid="embry-voice:ten-foot:actions">
              <button
                type="button"
                data-qid="embry-voice:action:replay-glance"
                data-qs-action="EMBRY_VOICE_REPLAY_GLANCE"
                title={replayState.playing ? 'Stop Embry voice replay' : 'Replay Embry voice conversation'}
                onClick={onReplay}
                className="inline-flex min-h-11 items-center gap-2 border border-emerald-300/35 bg-emerald-400/10 px-4 text-sm font-semibold text-emerald-100 hover:bg-emerald-400/15"
              >
                {replayState.playing ? <PauseCircle className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                {replayState.playing ? 'Stop replay' : 'Replay'}
              </button>
              <button
                type="button"
                data-qid="embry-voice:action:direct-speak-glance"
                data-qs-action="EMBRY_VOICE_DIRECT_SPEAK_GLANCE"
                title="Render a direct Chatterbox Embry voice sample"
                onClick={() => void onDirectSpeak()}
                disabled={directSpeakBusy}
                className="inline-flex min-h-11 items-center gap-2 border border-cyan-300/35 bg-cyan-400/10 px-4 text-sm font-semibold text-cyan-100 hover:bg-cyan-400/15 disabled:cursor-wait disabled:opacity-60"
              >
                <Radio className="h-4 w-4" />
                {directSpeakBusy ? 'Rendering' : 'Speak'}
              </button>
              <button
                type="button"
                data-qid="embry-voice:action:listen-glance"
                data-qs-action="EMBRY_VOICE_LISTEN_GLANCE"
                title={voiceEnabled ? 'Stop Embry live listener' : 'Start Embry live listener'}
                onClick={onToggleListener}
                className="inline-flex min-h-11 items-center gap-2 border border-teal-300/35 bg-teal-400/10 px-4 text-sm font-semibold text-teal-100 hover:bg-teal-400/15"
              >
                <Mic className="h-4 w-4" />
                {voiceEnabled ? 'Stop listening' : 'Listen'}
              </button>
              <button
                type="button"
                data-qid="embry-voice:distance:lean-in"
                data-qs-action="EMBRY_VOICE_OPEN_LEAN_IN"
                title="Open the full Embry Voice console"
                onClick={onOpenConsole}
                className="inline-flex min-h-11 items-center gap-2 border border-white/15 bg-white/5 px-4 text-sm font-semibold text-zinc-100 hover:bg-white/10"
              >
                <Maximize2 className="h-4 w-4" />
                Open console
              </button>
            </div>
          </section>
        </main>
      </div>
    </section>
  )
}

function TenFootMetric({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' | 'warn' }): JSX.Element {
  const toneClass = tone === 'good'
    ? 'text-emerald-200'
    : tone === 'bad'
      ? 'text-red-200'
      : tone === 'warn'
        ? 'text-orange-200'
        : 'text-zinc-100'
  return (
    <div className="border border-[#2d2d31] bg-[#17171a] p-5">
      <div className={`font-mono text-4xl font-semibold tracking-[0] ${toneClass}`}>{value}</div>
      <div className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
    </div>
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
          speechAudioElement={null}
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
  readinessSummary,
  selectedRunId,
  replayState,
  onSelectTurn,
  onInspect,
  onClearInspect,
}: {
  turns: VoiceTurn[]
  selectedTurn?: VoiceTurn
  selectedRun?: SanityRun
  readinessSummary: VoiceReadinessSummary
  selectedRunId: string
  replayState: ReplayState
  onSelectTurn: (turnId: string, runId?: string) => void
  onInspect: (runId: string) => void
  onClearInspect: () => void
}): JSX.Element {
  return (
    <Panel title="State Controller" icon={<FlaskConical className="w-4 h-4" />}>
      <GateDashboard summary={readinessSummary} />
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

function GateDashboard({ summary }: { summary: VoiceReadinessSummary }): JSX.Element {
  return (
    <div
      data-qid="embry-voice:gate-dashboard"
      data-current-state={summary.currentState}
      data-current-failed-gates={summary.current.failed}
      data-retained-failed-gates={summary.retained.failedGates}
      data-plant-state={summary.plantState}
      className="mb-3 grid grid-cols-2 gap-2"
    >
      <Metric label="current_passed" value={summary.current.passed} tone="good" />
      <Metric label="current_failed" value={summary.current.failed} tone={summary.current.failed ? 'bad' : 'good'} />
      <Metric label="retained_failed" value={summary.retained.failedGates} tone={summary.retained.failedGates ? 'warn' : 'good'} />
      <Metric label="pending_reqs" value={summary.requirements.pendingGates} tone={summary.requirements.pendingGates ? 'warn' : undefined} />
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' | 'warn' }): JSX.Element {
  const text = tone === 'good'
    ? 'text-emerald-200'
    : tone === 'bad'
      ? 'text-red-200'
      : tone === 'warn'
        ? 'text-orange-200'
        : 'text-zinc-200'
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
  const classification = classifyVoiceRun(run)
  return (
    <article
      data-qid="embry-voice:sanity-card"
      data-run-id={run.id}
      data-readiness-class={classification.classification}
      data-current-profile-applies={classification.currentProfileApplies ? 'true' : 'false'}
      className={`border bg-[#17171a] p-3 ${selected ? 'border-cyan-400/50' : 'border-[#2d2d31]'}`}
    >
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
        <StatusPill label={classification.classification} tone={classification.currentProfileApplies ? 'good' : classification.classification === 'requirements' ? 'warn' : undefined} />
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
            <div className="mt-2 font-mono text-[11px] text-zinc-300">classification={classification.label}</div>
            {classification.supersededBy && <div className="mt-1 font-mono text-[11px] text-zinc-400">superseded_by={classification.supersededBy}</div>}
            <div className={`mt-2 font-mono text-[11px] ${run.failedGates.length ? 'text-red-200' : 'text-emerald-200'}`}>failed_gates={run.failedGates.length ? run.failedGates.join(',') : '[]'}</div>
            <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-zinc-400">
              <div>impact: {classification.impact}</div>
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

export default EmbryVoiceLabRoute

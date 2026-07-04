import { CheckCircle2, FlaskConical, Mic, PlayCircle, Radio, Volume2, XCircle } from 'lucide-react'
import { SharedChatShell, type ChatMessage } from '../shared-chat'

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
  ok: boolean
  mocked: boolean
  live: boolean
  failedGates: string[]
  facts: string[]
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
  audioArtifacts: AudioArtifact[]
}

const fullSuite = '/tmp/chatterbox-fork-agent-out/voice-chat-e2e/voice-chat-e2e-20260703T214538Z-audible-all-v2'

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
    ok: true,
    mocked: false,
    live: true,
    failedGates: [],
    facts: ['8 scenarios', '23 audible WAVs', 'PipeWire sink 64'],
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
    ok: true,
    mocked: false,
    live: true,
    failedGates: [],
    facts: ['3 runs', 'failed_gates=[]'],
    proves: ['The full audible suite repeated three times without failed gates'],
    doesNotProve: ['long-duration production stability'],
  },
  {
    id: 'personality-audition',
    label: 'Embry personality audition',
    receiptPath: '/tmp/chatterbox-fork-agent-out/voice-chat-e2e/personality-audition-20260703T223052Z-scripted/personality-audition.json',
    ok: true,
    mocked: false,
    live: true,
    failedGates: [],
    facts: ['5 variants', 'live Tau/Chatterbox'],
    proves: ['Five one-at-a-time variants rendered and played'],
    doesNotProve: ['human acceptance of Embry character or prosody'],
  },
  {
    id: 'stream-cancel',
    label: 'Stream cancel',
    receiptPath: `${fullSuite}/S08-stream-cancel/stream-cancel.json`,
    ok: true,
    mocked: false,
    live: true,
    failedGates: [],
    facts: ['old-turn bytes after cancel = 0'],
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
    ok: true,
    mocked: false,
    live: true,
    failedGates: [],
    facts: ['pyannote speaker_count=2', 'tone one_at_a_time_interrupt'],
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
    ok: true,
    mocked: false,
    live: true,
    failedGates: [],
    facts: ['primary speaker Horus', 'noisy capture path'],
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
    ok: false,
    mocked: false,
    live: true,
    failedGates: ['realtimestt_listener_ok', 'listener_transcript_present'],
    facts: ['browser transport proven', 'ASR transcript missing'],
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
    audioArtifacts: [
      artifact('embry-answer', 'Embry spoken response', '/tmp/chatterbox-fork-agent-out/tau_voice_render_smoke/finished_response.wav'),
    ],
  },
  {
    id: 'one-at-a-time',
    userText: 'Two non-Embry speakers talk at once.',
    assistantText: 'Hey, one at a time?',
    tone: 'one_at_a_time_interrupt',
    memoryAction: 'CLARIFY',
    receiptPath: `${fullSuite}/S05-female-distractor/overlap-turn-control.json`,
    audioArtifacts: [
      artifact('overlap-input', 'Overlapped input', `${fullSuite}/S05-female-distractor/overlap.wav`),
    ],
  },
  {
    id: 'unknown-speaker',
    userText: 'Unknown speaker asks a personal-memory question.',
    assistantText: 'Who am I speaking with?',
    tone: 'identity_clarification',
    memoryAction: 'CLARIFY',
    receiptPath: `${fullSuite}/S03-unknown-speaker/identity-resolution.json`,
    audioArtifacts: [
      artifact('identity-clarification', 'Identity clarification', `${fullSuite}/S03-unknown-speaker/identity-clarification-render.wav`),
    ],
  },
]

const initialMessages: ChatMessage[] = voiceTurns.flatMap((turn) => [
  {
    id: `${turn.id}:user`,
    role: 'user',
    content: turn.userText,
    createdAt: new Date().toISOString(),
    metadata: { branch: 'personaplex' },
  },
  {
    id: `${turn.id}:assistant`,
    role: 'assistant',
    content: turn.assistantText,
    createdAt: new Date().toISOString(),
    skillUsed: 'embry-chatterbox-voice',
    metadata: {
      branch: 'personaplex',
      personaId: 'embry',
      speakerId: turn.speaker,
      tone: turn.tone,
      receiptPath: turn.receiptPath,
      simultaneousTextVoice: true,
      memoryFirst: true,
    },
    reasoningSteps: [
      { id: 'speaker-resolve', label: 'Resolving speaker', status: turn.speaker ? 'completed' : 'skipped', detail: turn.speaker, icon: 'mic' },
      { id: 'memory-intent', label: 'Classifying memory intent', status: 'completed', detail: turn.memoryAction, icon: 'memory' },
      { id: 'chatterbox-audio', label: 'Rendering Chatterbox audio', status: 'completed', detail: `${turn.audioArtifacts.length} playable artifact`, icon: 'mic' },
    ],
  },
])

export function EmbryVoiceLabRoute(): JSX.Element {
  return (
    <section data-qid="embry-voice:route" className="h-full min-h-0 grid grid-rows-[auto_minmax(0,1fr)] bg-black text-slate-100">
      <header className="border-b border-white/10 px-5 py-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-lg font-bold"><Mic className="w-5 h-5" />Embry Voice Chat</div>
          <div className="mt-1 text-xs text-slate-400">Simultaneous chat text, Chatterbox audio, and receipt-backed sanity checks.</div>
        </div>
        <StatusPill label="memory-first voice lab" tone="good" />
      </header>

      <div className="min-h-0 grid grid-cols-[minmax(420px,1fr)_minmax(380px,0.86fr)] gap-3 p-3">
        <SharedChatShell
          projectLabel="Embry"
          surface="shared-chat"
          defaultMode="personaplex"
          showModeToggle={false}
          initialMessages={initialMessages}
          shellQid="embry-voice:chat-shell"
          qid="embry-voice:chat-well"
          placeholder="Talk to Embry..."
          emptyTitle="Embry is listening"
          emptyDescription="Voice turns must resolve speaker identity, memory intent, recall, Tau, and Chatterbox audio."
          starterChips={[
            { label: 'Memory check', prompt: 'What did we last talk about?' },
            { label: 'Identity check', prompt: 'Do you know who is speaking?' },
            { label: 'One at a time', prompt: 'What should you say when two people speak at once?' },
          ]}
        />

        <aside className="min-h-0 grid grid-rows-[minmax(0,1fr)_minmax(230px,0.84fr)] gap-3">
          <Panel title="Sanity Check Runs" icon={<FlaskConical className="w-4 h-4" />}>
            <div className="grid gap-2">
              {sanityRuns.map((run) => <SanityCard key={run.id} run={run} />)}
            </div>
          </Panel>
          <Panel title="Conversation Audio" icon={<Volume2 className="w-4 h-4" />}>
            <div className="grid gap-2">
              {voiceTurns.map((turn) => <VoiceTurnCard key={turn.id} turn={turn} />)}
            </div>
          </Panel>
        </aside>
      </div>
    </section>
  )
}

function Panel({ title, icon, children }: { title: string; icon: JSX.Element; children: React.ReactNode }): JSX.Element {
  return (
    <section className="min-h-0 grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-white/10 bg-white/[0.035]">
      <header className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-sm font-bold text-slate-200">{icon}{title}</header>
      <div className="min-h-0 overflow-auto p-3">{children}</div>
    </section>
  )
}

function SanityCard({ run }: { run: SanityRun }): JSX.Element {
  return (
    <article data-qid="embry-voice:sanity-card" className="rounded-md border border-white/10 bg-black/30 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-bold">{run.ok ? <CheckCircle2 className="w-4 h-4 text-emerald-300" /> : <XCircle className="w-4 h-4 text-red-300" />}{run.label}</div>
          <div className="mt-1 break-words text-[11px] text-slate-500">{run.receiptPath}</div>
        </div>
        <Radio className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <StatusPill label={run.live ? 'live' : 'not live'} tone={run.live ? 'good' : 'bad'} />
        <StatusPill label={run.mocked ? 'mocked' : 'not mocked'} tone={run.mocked ? 'bad' : 'good'} />
        {run.facts.map((fact) => <StatusPill key={fact} label={fact} />)}
      </div>
      <div className={`mt-2 text-xs ${run.failedGates.length ? 'text-red-200' : 'text-emerald-200'}`}>failed gates: {run.failedGates.length ? run.failedGates.join(', ') : '[]'}</div>
      <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-slate-400">
        <div>proves: {run.proves.join('; ')}</div>
        <div>does not prove: {run.doesNotProve.join('; ')}</div>
      </div>
      {run.audioArtifacts && <AudioList artifacts={run.audioArtifacts} />}
    </article>
  )
}

function VoiceTurnCard({ turn }: { turn: VoiceTurn }): JSX.Element {
  return (
    <article data-qid="embry-voice:turn-card" className="rounded-md border border-white/10 bg-black/30 p-3">
      <div className="text-sm font-bold text-slate-100">{turn.userText}</div>
      <div className="mt-1 text-sm leading-relaxed text-slate-300">{turn.assistantText}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {turn.speaker && <StatusPill label={`speaker ${turn.speaker}`} />}
        {turn.tone && <StatusPill label={turn.tone} />}
        {turn.memoryAction && <StatusPill label={`memory ${turn.memoryAction}`} />}
      </div>
      <AudioList artifacts={turn.audioArtifacts} />
      <div className="mt-2 break-words text-[11px] text-slate-500">{turn.receiptPath}</div>
    </article>
  )
}

function AudioList({ artifacts }: { artifacts: AudioArtifact[] }): JSX.Element {
  return (
    <div className="mt-2 grid gap-2">
      {artifacts.map((artifact) => (
        <div key={artifact.id} className="grid gap-1">
          <div className="flex items-center gap-1.5 text-xs text-slate-300"><PlayCircle className="h-3.5 w-3.5" />{artifact.label}</div>
          <audio controls preload="metadata" src={artifact.url} className="h-8 w-full" />
        </div>
      ))}
    </div>
  )
}

function StatusPill({ label, tone }: { label: string; tone?: 'good' | 'bad' }): JSX.Element {
  const toneClass = tone === 'good'
    ? 'border-emerald-300/25 text-emerald-200'
    : tone === 'bad'
      ? 'border-red-300/25 text-red-200'
      : 'border-white/10 text-slate-300'
  return <span className={`inline-flex min-h-6 items-center rounded-md border bg-black/25 px-2 text-[11px] ${toneClass}`}>{label}</span>
}

export default EmbryVoiceLabRoute

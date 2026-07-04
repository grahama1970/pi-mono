import { useCallback, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { CheckCircle2, ChevronDown, ClipboardList, FlaskConical, Mic, PlayCircle, Radio, SearchCode, XCircle } from 'lucide-react'

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

export function EmbryVoiceLabRoute(): JSX.Element {
  const [selectedRunId, setSelectedRunId] = useState<string>(sanityRuns[0]?.id ?? '')
  const [replayState, setReplayState] = useState<{ playing: boolean; activeIndex: number }>({ playing: false, activeIndex: -1 })
  const replayStopRef = useRef(false)
  const receiptRefs = useRef<Record<string, HTMLElement | null>>({})
  const selectedRun = sanityRuns.find((run) => run.id === selectedRunId)
  const gateSummary = useMemo(() => summarizeGates(sanityRuns), [])
  const sessionArtifacts = useMemo(() => voiceTurns.flatMap((turn) => turn.audioArtifacts.map((audio) => ({ ...audio, turnId: turn.id }))), [])

  const focusRun = useCallback((runId: string) => {
    setSelectedRunId(runId)
    const turn = voiceTurns.find((candidate) => candidate.relatedRunIds.includes(runId))
    const node = turn ? receiptRefs.current[turn.id] : undefined
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [])

  const replaySession = useCallback(async () => {
    const audioElements = Array.from(document.querySelectorAll<HTMLAudioElement>('[data-embry-session-audio="true"]'))
    if (!audioElements.length) return
    replayStopRef.current = false
    setReplayState({ playing: true, activeIndex: 0 })

    for (let index = 0; index < audioElements.length; index += 1) {
      if (replayStopRef.current) break
      const audio = audioElements[index]
      setReplayState({ playing: true, activeIndex: index })
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
        await new Promise((resolve) => window.setTimeout(resolve, 300))
      }
      await new Promise((resolve) => window.setTimeout(resolve, 450))
    }

    setReplayState({ playing: false, activeIndex: -1 })
    replayStopRef.current = false
  }, [])

  const stopReplay = useCallback(() => {
    replayStopRef.current = true
    document.querySelectorAll<HTMLAudioElement>('[data-embry-session-audio="true"]').forEach((audio) => audio.pause())
    setReplayState({ playing: false, activeIndex: -1 })
  }, [])

  return (
    <section data-qid="embry-voice:route" className="h-full min-h-0 grid grid-rows-[auto_minmax(0,1fr)] bg-[#0f0f12] text-zinc-100">
      <header className="border-b border-white/10 px-5 py-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-lg font-bold"><Mic className="w-5 h-5" />Embry Voice Chat</div>
          <div className="mt-1 text-xs text-slate-400">Simultaneous chat text, Chatterbox audio, and receipt-backed sanity checks.</div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          <StatusPill label="memory-first voice lab" tone="good" />
          <StatusPill label="Chatterbox Turbo" />
          <StatusPill label="Embry" />
        </div>
      </header>

      <div className="min-h-0 grid grid-cols-[minmax(560px,1fr)_320px] gap-3 p-3">
        <ConversationReceipts
          selectedRun={selectedRun}
          replayState={replayState}
          sessionArtifacts={sessionArtifacts}
          receiptRefs={receiptRefs}
          onReplay={replaySession}
          onStopReplay={stopReplay}
          onClearInspect={() => setSelectedRunId('')}
        />

        <aside className="min-h-0">
          <Panel title="Sanity Check Registry" icon={<FlaskConical className="w-4 h-4" />}>
            <GateDashboard summary={gateSummary} />
            <RegistryGroup
              title="Active"
              runs={sanityRuns.filter((run) => run.active)}
              selectedRunId={selectedRunId}
              onInspect={focusRun}
            />
            <RegistryGroup
              title="Historical"
              runs={sanityRuns.filter((run) => run.ok && !run.active)}
              selectedRunId={selectedRunId}
              onInspect={focusRun}
            />
            <RegistryGroup
              title="Failed"
              runs={sanityRuns.filter((run) => !run.ok)}
              selectedRunId={selectedRunId}
              onInspect={focusRun}
            />
          </Panel>
        </aside>
      </div>
    </section>
  )
}

function ConversationReceipts({
  selectedRun,
  replayState,
  sessionArtifacts,
  receiptRefs,
  onReplay,
  onStopReplay,
  onClearInspect,
}: {
  selectedRun?: SanityRun
  replayState: { playing: boolean; activeIndex: number }
  sessionArtifacts: Array<AudioArtifact & { turnId: string }>
  receiptRefs: React.MutableRefObject<Record<string, HTMLElement | null>>
  onReplay: () => void
  onStopReplay: () => void
  onClearInspect: () => void
}): JSX.Element {
  const selectedTurnId = selectedRun ? voiceTurns.find((turn) => turn.relatedRunIds.includes(selectedRun.id))?.id : undefined
  return (
    <section data-qid="embry-voice:receipt-feed" className="min-h-0 grid grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden border border-zinc-800 bg-black/35">
      <header className="flex items-center justify-between gap-3 border-b border-zinc-800 px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-bold text-zinc-100"><ClipboardList className="h-4 w-4" />Voice Turn Receipts</div>
          <div className="mt-1 text-[11px] text-zinc-500">Master timeline: transcript, audio, metadata, and receipts live in each turn.</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={replayState.playing ? onStopReplay : onReplay}
            className="inline-flex min-h-8 items-center gap-2 border border-emerald-300/30 bg-emerald-400/10 px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-emerald-100 hover:bg-emerald-400/20"
          >
            <PlayCircle className="h-3.5 w-3.5" />
            {replayState.playing ? 'Stop Replay' : 'Replay Session'}
          </button>
          <StatusPill label="LIVE_RENDER" tone="good" />
        </div>
      </header>
      <TimelineProgress artifacts={sessionArtifacts} activeIndex={replayState.activeIndex} />
      <div className="min-h-0 overflow-auto p-4">
        <AnimatePresence initial={false}>
          {selectedRun && !selectedTurnId && <InspectReceipt key={selectedRun.id} run={selectedRun} onClear={onClearInspect} />}
        </AnimatePresence>
        <div className="grid gap-3">
          {voiceTurns.map((turn) => (
            <EmbryReceipt
              key={turn.id}
              turn={turn}
              selectedRun={selectedTurnId === turn.id ? selectedRun : undefined}
              activeAudioIndex={replayState.activeIndex}
              allArtifacts={sessionArtifacts}
              refSetter={(node) => { receiptRefs.current[turn.id] = node }}
              onClearInspect={onClearInspect}
            />
          ))}
        </div>
      </div>
      <footer className="border-t border-zinc-800 p-3">
        <div className="flex min-h-12 items-center gap-3 border border-zinc-800 bg-zinc-950/80 px-3 text-sm text-zinc-500">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-600">Composer</span>
          <span className="min-w-0 flex-1">Talk to Embry...</span>
          <span className="font-mono text-[10px] uppercase text-zinc-600">Auto</span>
          <Mic className="h-4 w-4 text-zinc-500" />
        </div>
      </footer>
    </section>
  )
}

function TimelineProgress({ artifacts, activeIndex }: { artifacts: Array<AudioArtifact & { turnId: string }>; activeIndex: number }): JSX.Element {
  return (
    <div data-qid="embry-voice:timeline-progress" className="border-b border-zinc-800 px-4 py-2">
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
  selectedRun,
  activeAudioIndex,
  allArtifacts,
  refSetter,
  onClearInspect,
}: {
  turn: VoiceTurn
  selectedRun?: SanityRun
  activeAudioIndex: number
  allArtifacts: Array<AudioArtifact & { turnId: string }>
  refSetter: (node: HTMLElement | null) => void
  onClearInspect: () => void
}): JSX.Element {
  const reducedMotion = useReducedMotion()
  const warn = turn.telemetry.some((item) => item.warn)
  return (
    <motion.article
      data-qid="embry-voice:receipt-card"
      ref={refSetter}
      initial={reducedMotion ? false : { opacity: 0, y: 5 }}
      animate={reducedMotion ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: 'easeInOut' }}
      className={`border bg-zinc-950/55 p-4 shadow-none ${selectedRun ? 'border-cyan-400/60' : warn ? 'border-orange-400/60' : 'border-zinc-800'}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} | {turn.componentPath}
        </div>
        <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
      </div>
      <div className="mt-3 grid gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-600">User</div>
          <div className="text-sm leading-relaxed text-zinc-100">{turn.userText}</div>
        </div>
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-600">Embry</div>
          <div className="text-sm leading-relaxed text-zinc-200">{turn.assistantText}</div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {turn.speaker && <StatusPill label={`speaker ${turn.speaker}`} />}
        {turn.tone && <StatusPill label={turn.tone} />}
        {turn.memoryAction && <StatusPill label={`memory ${turn.memoryAction}`} />}
        {turn.telemetry.map((item) => <StatusPill key={`${item.label}:${item.value}`} label={`${item.label}: ${item.value}`} tone={item.warn ? 'warn' : undefined} />)}
      </div>
      <AudioList artifacts={turn.audioArtifacts} activeAudioIndex={activeAudioIndex} allArtifacts={allArtifacts} />
      <AnimatePresence initial={false}>
        {selectedRun && <InspectReceipt key={selectedRun.id} run={selectedRun} onClear={onClearInspect} compact />}
      </AnimatePresence>
      <div className="mt-3 border-t border-zinc-800 pt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">
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
      <pre className={`${compact ? 'max-h-44' : 'max-h-56'} mt-3 overflow-auto border border-cyan-300/15 bg-black/60 p-3 text-[11px] leading-relaxed text-cyan-50`}>{JSON.stringify(trace, null, 2)}</pre>
    </motion.article>
  )
}

function Panel({ title, icon, children }: { title: string; icon: JSX.Element; children: React.ReactNode }): JSX.Element {
  return (
    <section className="min-h-0 grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden border border-zinc-800 bg-zinc-950/50">
      <header className="flex items-center gap-2 border-b border-zinc-800 px-3 py-2 text-sm font-bold text-zinc-200">{icon}{title}</header>
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
    <div className="border border-zinc-800 bg-black/30 p-2">
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
    <article data-qid="embry-voice:sanity-card" className={`border bg-black/30 p-3 ${selected ? 'border-cyan-400/50' : 'border-zinc-800'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={onInspect} className="flex min-w-0 items-center gap-2 text-left text-sm font-bold text-zinc-100 hover:text-cyan-100">
            {run.ok ? <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-300" /> : <XCircle className="w-4 h-4 shrink-0 text-red-300" />}
            <span className="min-w-0 truncate">{run.label}</span>
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${selected ? 'rotate-180' : ''}`} />
          </button>
          <button type="button" onClick={onInspect} className="mt-1 block break-all text-left font-mono text-[10px] text-zinc-500 hover:text-cyan-300">[Inspect] {run.receiptPath}</button>
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
  activeAudioIndex,
  allArtifacts,
}: {
  artifacts: AudioArtifact[]
  activeAudioIndex?: number
  allArtifacts?: Array<AudioArtifact & { turnId: string }>
}): JSX.Element {
  return (
    <div data-qid="embry-voice:embedded-audio" className="mt-3 grid gap-2">
      {artifacts.map((artifact) => (
        <div key={artifact.id} className={`grid gap-1 border p-2 ${allArtifacts?.[activeAudioIndex ?? -1]?.id === artifact.id ? 'border-emerald-300/60 bg-emerald-400/10' : 'border-zinc-800 bg-black/20'}`}>
          <div className="flex items-center gap-1.5 text-xs text-slate-300"><PlayCircle className="h-3.5 w-3.5" />{artifact.label}</div>
          <audio data-embry-session-audio="true" controls preload="metadata" src={artifact.url} className="h-8 w-full" />
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
  return <span className={`inline-flex min-h-6 items-center border bg-black/25 px-2 font-mono text-[10px] uppercase tracking-[0.08em] ${toneClass}`}>{label}</span>
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

import React, { useMemo, useState } from 'react'
import {
  BadgeCheck,
  CheckCircle2,
  Copy,
  Gauge,
  Mic2,
  Music2,
  SlidersHorizontal,
  Sparkles,
  Volume2,
  Wand2,
  Waves,
  XCircle,
} from 'lucide-react'

type Candidate = {
  id: string
  label: string
  voice: string
  speed: string
  guide: 'raw' | 'pitch'
  stability: number
  similarity: number
  style: number
  file: string
  receipt: string
  verdict: 'winner' | 'strong' | 'risky'
  note: string
}

const RUN_ROOT = '/home/graham/workspace/experiments/agent-skills/skills/hum/jobs/hawaiian_eye_1959_wistful_female_pop/run_20260620T1600Z'
const PUBLIC_RUN_ROOT = '/hum/hawaiian_eye_1959_wistful_female_pop/run_20260620T1600Z'

const guidePaths = {
  raw: `${RUN_ROOT}/tempo/hawaiian_eye_1959_wistful_female_pop__guide_vocals_002_033__0p85x.wav`,
  pitch: `${RUN_ROOT}/pitch_corrected_guides/hawaiian_eye_1959_wistful_female_pop__guide_vocals_002_033__0p85x__pitch_global_+11.3c.wav`,
}

const candidates: Candidate[] = [
  {
    id: 's3',
    label: 'S3 raw guide - controlled',
    voice: 'Light Rasp / Melissa',
    speed: '0.85x',
    guide: 'raw',
    stability: 0.5,
    similarity: 0.84,
    style: 0.15,
    file: `${RUN_ROOT}/sts/hawaiian_eye_1959_wistful_female_pop__light_rasp__0p85x__controlled__s0p50__sty0p15.wav`,
    receipt: `${RUN_ROOT}/receipts/hawaiian_eye_1959_wistful_female_pop__light_rasp__0p85x__controlled__s0p50__sty0p15.receipt.redacted.json`,
    verdict: 'winner',
    note: 'Most stable finalist. Low style avoids glissando distortion while preserving the dry, amused Light Rasp character.',
  },
  {
    id: 's1',
    label: 'S1 raw guide - steady clean',
    voice: 'Light Rasp / Melissa',
    speed: '0.85x',
    guide: 'raw',
    stability: 0.55,
    similarity: 0.82,
    style: 0.25,
    file: `${RUN_ROOT}/sts/hawaiian_eye_1959_wistful_female_pop__light_rasp__0p85x__steady_clean__s0p55__sty0p25.wav`,
    receipt: `${RUN_ROOT}/receipts/hawaiian_eye_1959_wistful_female_pop__light_rasp__0p85x__steady_clean__s0p55__sty0p25.receipt.redacted.json`,
    verdict: 'strong',
    note: 'Cleaner than the first pass, but the extra style can thicken sustained vowels.',
  },
  {
    id: 's2',
    label: 'S2 raw guide - very steady',
    voice: 'Light Rasp / Melissa',
    speed: '0.85x',
    guide: 'raw',
    stability: 0.65,
    similarity: 0.82,
    style: 0.2,
    file: `${RUN_ROOT}/sts/hawaiian_eye_1959_wistful_female_pop__light_rasp__0p85x__very_steady__s0p65__sty0p20.wav`,
    receipt: `${RUN_ROOT}/receipts/hawaiian_eye_1959_wistful_female_pop__light_rasp__0p85x__very_steady__s0p65__sty0p20.receipt.redacted.json`,
    verdict: 'strong',
    note: 'Stable, but a little less alive than S3. Useful fallback when the guide has more wobble.',
  },
  {
    id: 'p5',
    label: 'P5 pitch guide - controlled',
    voice: 'Light Rasp / Melissa',
    speed: '0.85x',
    guide: 'pitch',
    stability: 0.5,
    similarity: 0.84,
    style: 0.15,
    file: `${RUN_ROOT}/sts/hawaiian_eye_1959_wistful_female_pop__light_rasp__0p85x__pitch_controlled__s0p50__sty0p15.wav`,
    receipt: `${RUN_ROOT}/receipts/hawaiian_eye_1959_wistful_female_pop__light_rasp__0p85x__pitch_controlled__s0p50__sty0p15.receipt.redacted.json`,
    verdict: 'risky',
    note: 'Pitch preprocessing worked as a branch, but the raw guide winner kept a more natural slide.',
  },
]

const speeds = ['1.00x', '0.90x', '0.85x', '0.80x']
const voices = ['Light Rasp / Melissa', 'Jenna', 'Mimi', 'Freya']

function mediaUrl(path: string): string {
  if (!path) return ''
  if (path.startsWith(RUN_ROOT)) return `${PUBLIC_RUN_ROOT}${path.slice(RUN_ROOT.length).split('/').map(encodeURIComponent).join('/')}`
  if (path.startsWith('/tmp/')) {
    return `/api/projects/watch/static/tmp/${path.slice('/tmp/'.length).split('/').map(encodeURIComponent).join('/')}`
  }
  return `/api/projects/watch/media-file${path.split('/').map(encodeURIComponent).join('/')}`
}

function copyText(text: string) {
  void navigator.clipboard?.writeText(text)
}

function Knob({
  label,
  value,
  min,
  max,
  step,
  description,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  description: string
  onChange: (value: number) => void
}) {
  const percent = ((value - min) / (max - min)) * 100
  return (
    <div className="hum-knob-card">
      <div className="hum-knob-top">
        <div>
          <div className="hum-label">{label}</div>
          <div className="hum-help">{description}</div>
        </div>
        <div
          className="hum-knob"
          style={{
            background: `conic-gradient(#ffd36f ${percent * 3.6}deg, rgba(154, 180, 218, 0.18) 0deg)`,
          }}
        >
          <span>{value.toFixed(2)}</span>
        </div>
      </div>
      <input
        aria-label={label}
        className="hum-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

function MiniWaveform({ selectedCandidate }: { selectedCandidate: Candidate }) {
  const bars = useMemo(
    () => Array.from({ length: 96 }, (_, index) => {
      const envelope = 0.28 + Math.abs(Math.sin(index * 0.39)) * 0.48 + Math.abs(Math.cos(index * 0.17)) * 0.18
      const quiet = index < 8 || index > 86
      return quiet ? 10 + (index % 3) * 4 : Math.round(18 + envelope * 74)
    }),
    [],
  )

  return (
    <div className="hum-wave-shell" data-qid="hum-bakeoff:waveform">
      <div className="hum-playhead" />
      <div className="hum-selection" />
      <div className="hum-wave-bars" aria-label="Decorative waveform overview">
        {bars.map((height, index) => (
          <span
            key={index}
            className={index > 26 && index < 52 ? 'is-selected' : ''}
            style={{ height }}
          />
        ))}
      </div>
      <div className="hum-wave-time">
        <span>0:00</span>
        <span>0:15 guide</span>
        <span>2:38 source</span>
      </div>
      <div className="hum-selection-label">
        {selectedCandidate.speed} · {selectedCandidate.guide === 'raw' ? 'raw guide' : 'pitch guide'} · selected finalist
      </div>
    </div>
  )
}

function CandidateCard({
  candidate,
  selected,
  onSelect,
}: {
  candidate: Candidate
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className={`hum-candidate ${selected ? 'is-selected' : ''}`}
      onClick={onSelect}
      data-qid={`hum-bakeoff:candidate:${candidate.id}`}
    >
      <div className="hum-candidate-head">
        <div>
          <div className="hum-candidate-title">{candidate.label}</div>
          <div className="hum-candidate-sub">{candidate.voice} · {candidate.speed} · {candidate.guide} guide</div>
        </div>
        <span className={`hum-verdict ${candidate.verdict}`}>
          {candidate.verdict === 'winner' ? <BadgeCheck size={15} /> : candidate.verdict === 'strong' ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
          {candidate.verdict}
        </span>
      </div>
      <audio className="hum-audio" controls src={mediaUrl(candidate.file)} />
      <div className="hum-param-row">
        <span>stability {candidate.stability.toFixed(2)}</span>
        <span>similarity {candidate.similarity.toFixed(2)}</span>
        <span>style {candidate.style.toFixed(2)}</span>
      </div>
      <p>{candidate.note}</p>
    </button>
  )
}

export function HumBakeoffView() {
  const [selectedId, setSelectedId] = useState('s3')
  const selected = candidates.find(candidate => candidate.id === selectedId) ?? candidates[0]
  const [guideMode, setGuideMode] = useState<'raw' | 'pitch'>(selected.guide)
  const [speed, setSpeed] = useState(selected.speed)
  const [voice, setVoice] = useState(selected.voice)
  const [stability, setStability] = useState(selected.stability)
  const [similarity, setSimilarity] = useState(selected.similarity)
  const [style, setStyle] = useState(selected.style)

  const payload = useMemo(() => ({
    endpoint: 'POST /v1/speech-to-speech/xYa75LlayhWHCRl1yJSH?output_format=mp3_44100_128',
    model_id: 'eleven_multilingual_sts_v2',
    voice_id: 'xYa75LlayhWHCRl1yJSH',
    source_audio: guidePaths[guideMode],
    voice_settings: {
      stability,
      similarity_boost: similarity,
      style,
      use_speaker_boost: true,
    },
    remove_background_noise: false,
    file_format: 'other',
  }), [guideMode, similarity, stability, style])

  const applyCandidate = (candidate: Candidate) => {
    setSelectedId(candidate.id)
    setGuideMode(candidate.guide)
    setSpeed(candidate.speed)
    setVoice(candidate.voice)
    setStability(candidate.stability)
    setSimilarity(candidate.similarity)
    setStyle(candidate.style)
  }

  return (
    <div className="hum-bakeoff" data-qid="hum-bakeoff:surface">
      <style>{css}</style>
      <section className="hum-hero">
        <img src="/hum/hum-header.webp" alt="" />
        <div className="hum-hero-shade" />
        <div className="hum-hero-copy">
          <div className="hum-kicker"><Music2 size={16} /> Embry idle hum lab</div>
          <h1>Hawaiian Eye STS bakeoff</h1>
          <p>Compare source guides, speed, voice identity, and ElevenLabs STS controls before a human listening gate.</p>
        </div>
        <div className="hum-hero-badge">
          <Sparkles size={17} />
          S3 winner loaded
        </div>
      </section>

      <main className="hum-layout">
        <section className="hum-main">
          <div className="hum-source-card">
            <div className="hum-source-title">
              <Waves size={20} />
              <div>
                <strong>Source guide</strong>
                <span>{guideMode === 'raw' ? 'Raw Demucs vocal · 0.85x · natural slide' : 'Light pitch correction · +11.3 cents · diagnostic branch'}</span>
              </div>
            </div>
            <div className="hum-toggle-row">
              <button type="button" className={guideMode === 'raw' ? 'active' : ''} onClick={() => setGuideMode('raw')}>Raw guide</button>
              <button type="button" className={guideMode === 'pitch' ? 'active' : ''} onClick={() => setGuideMode('pitch')}>Corrected guide</button>
              <button type="button" className="ghost" onClick={() => copyText(guidePaths[guideMode])}><Copy size={16} /> Copy guide path</button>
            </div>
            <audio className="hum-source-audio" controls src={mediaUrl(guidePaths[guideMode])} />
            <MiniWaveform selectedCandidate={selected} />
          </div>

          <div className="hum-grid">
            <section className="hum-panel">
              <div className="hum-panel-head">
                <SlidersHorizontal size={19} />
                <div>
                  <h2>STS controls</h2>
                  <p>These controls draft a request payload. A backend bake action still needs wiring before spending credits from this page.</p>
                </div>
              </div>
              <div className="hum-choice-row">
                {speeds.map(item => (
                  <button key={item} type="button" className={speed === item ? 'active' : ''} onClick={() => setSpeed(item)}>{item}</button>
                ))}
              </div>
              <div className="hum-choice-row">
                {voices.map(item => (
                  <button key={item} type="button" className={voice === item ? 'active' : ''} onClick={() => setVoice(item)}>{item}</button>
                ))}
              </div>
              <div className="hum-knobs">
                <Knob label="Stability" value={stability} min={0} max={1} step={0.01} description="Higher steadies sustained vowels." onChange={setStability} />
                <Knob label="Similarity" value={similarity} min={0} max={1} step={0.01} description="Keeps target voice identity." onChange={setSimilarity} />
                <Knob label="Style" value={style} min={0} max={1} step={0.01} description="Lower reduces wobble artifacts." onChange={setStyle} />
              </div>
            </section>

            <section className="hum-panel">
              <div className="hum-panel-head">
                <Wand2 size={19} />
                <div>
                  <h2>Draft API payload</h2>
                  <p>No text prompt is included because ElevenLabs STS ignores phonetic text fields.</p>
                </div>
              </div>
              <pre className="hum-code">{JSON.stringify(payload, null, 2)}</pre>
              <div className="hum-action-row">
                <button type="button" onClick={() => copyText(JSON.stringify(payload, null, 2))}><Copy size={16} /> Copy payload</button>
                <button type="button" className="disabled" title="Needs a hum backend endpoint that calls ElevenLabs from .env_temp">Run bake: backend not wired</button>
              </div>
            </section>
          </div>

          <section className="hum-panel">
            <div className="hum-panel-head">
              <Volume2 size={19} />
              <div>
                <h2>Candidate bakeoff</h2>
                <p>Real WAV outputs from the Hawaiian Eye run. Pick a card to load its settings into the knobs.</p>
              </div>
            </div>
            <div className="hum-candidate-grid">
              {candidates.map(candidate => (
                <CandidateCard
                  key={candidate.id}
                  candidate={candidate}
                  selected={selected.id === candidate.id}
                  onSelect={() => applyCandidate(candidate)}
                />
              ))}
            </div>
          </section>
        </section>

        <aside className="hum-side">
          <section className="hum-side-card winner">
            <div className="hum-side-title"><BadgeCheck size={18} /> Current winner</div>
            <h2>{selected.label}</h2>
            <p>{selected.note}</p>
            <audio className="hum-side-audio" controls src={mediaUrl(selected.file)} />
            <button type="button" onClick={() => copyText(selected.file)}><Copy size={16} /> Copy WAV path</button>
          </section>

          <section className="hum-side-card">
            <div className="hum-side-title"><Gauge size={18} /> Why S3 held pitch</div>
            <ul>
              <li>Raw guide preserved the continuous vowel slide.</li>
              <li>Style 0.15 avoided theatrical over-expression.</li>
              <li>Stability 0.50 stayed steady without flattening humor.</li>
              <li>Similarity 0.84 kept Light Rasp present but not forced.</li>
            </ul>
          </section>

          <section className="hum-side-card">
            <div className="hum-side-title"><Mic2 size={18} /> Human gate</div>
            <p>This page is for listening and parameter selection. Cache publication still requires explicit human approval and rights/provenance acceptance.</p>
          </section>
        </aside>
      </main>
    </div>
  )
}

const css = `
.hum-bakeoff {
  min-height: 100%;
  background:
    radial-gradient(circle at 16% 5%, rgba(255, 211, 111, 0.16), transparent 32%),
    radial-gradient(circle at 86% 8%, rgba(80, 228, 189, 0.14), transparent 30%),
    linear-gradient(135deg, #090d14 0%, #111927 52%, #171018 100%);
  color: #f7f2e8;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  overflow: auto;
}

.hum-hero {
  position: relative;
  min-height: 310px;
  overflow: hidden;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.hum-hero img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: saturate(1.04) contrast(1.02);
}

.hum-hero-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(9, 13, 20, 0.88), rgba(9, 13, 20, 0.42) 46%, rgba(9, 13, 20, 0.18)), linear-gradient(0deg, rgba(9, 13, 20, 0.88), transparent 52%);
}

.hum-hero-copy {
  position: absolute;
  left: clamp(24px, 5vw, 72px);
  bottom: 42px;
  max-width: 720px;
}

.hum-kicker,
.hum-hero-badge,
.hum-side-title,
.hum-source-title,
.hum-panel-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.hum-kicker {
  color: #9fffd2;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-weight: 800;
  font-size: 13px;
}

.hum-hero h1 {
  margin: 10px 0 8px;
  font-size: clamp(42px, 5.6vw, 82px);
  line-height: 0.95;
  letter-spacing: 0;
}

.hum-hero p {
  margin: 0;
  max-width: 620px;
  color: #d6e5ff;
  font-size: 20px;
  line-height: 1.45;
}

.hum-hero-badge {
  position: absolute;
  right: 28px;
  bottom: 32px;
  padding: 12px 16px;
  border: 1px solid rgba(255, 211, 111, 0.44);
  background: rgba(13, 20, 32, 0.78);
  color: #ffd36f;
  border-radius: 8px;
  font-weight: 800;
}

.hum-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 350px;
  gap: 18px;
  padding: 20px;
}

.hum-main {
  display: grid;
  gap: 18px;
  min-width: 0;
}

.hum-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(360px, 0.72fr);
  gap: 18px;
}

.hum-source-card,
.hum-panel,
.hum-side-card {
  background: rgba(10, 16, 27, 0.76);
  border: 1px solid rgba(145, 176, 219, 0.22);
  border-radius: 8px;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.24);
}

.hum-source-card,
.hum-panel {
  padding: 18px;
}

.hum-source-title strong,
.hum-panel h2,
.hum-side-card h2 {
  display: block;
  margin: 0;
  color: #fffaf1;
  font-size: 18px;
}

.hum-source-title span,
.hum-panel p,
.hum-side-card p,
.hum-help,
.hum-candidate-sub {
  color: #aabbd6;
}

.hum-toggle-row,
.hum-choice-row,
.hum-action-row,
.hum-param-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.hum-toggle-row {
  margin: 16px 0;
}

.hum-toggle-row button,
.hum-choice-row button,
.hum-action-row button,
.hum-side-card button {
  border: 1px solid rgba(125, 168, 232, 0.36);
  background: rgba(20, 42, 68, 0.72);
  color: #a8d0ff;
  border-radius: 8px;
  min-height: 40px;
  padding: 0 14px;
  font-weight: 800;
  cursor: pointer;
}

.hum-toggle-row button.active,
.hum-choice-row button.active {
  color: #092016;
  background: #aef6c8;
  border-color: #aef6c8;
}

.hum-toggle-row button.ghost,
.hum-action-row button,
.hum-side-card button {
  display: inline-flex;
  gap: 8px;
  align-items: center;
}

.hum-action-row button.disabled {
  cursor: not-allowed;
  opacity: 0.62;
}

.hum-source-audio,
.hum-audio,
.hum-side-audio {
  width: 100%;
  display: block;
  margin-top: 12px;
}

.hum-wave-shell {
  position: relative;
  margin-top: 18px;
  min-height: 214px;
  background: #07101f;
  border: 1px solid rgba(150, 176, 218, 0.22);
  border-radius: 8px;
  overflow: hidden;
}

.hum-wave-bars {
  position: absolute;
  inset: 34px 24px 48px;
  display: flex;
  align-items: center;
  gap: 5px;
}

.hum-wave-bars span {
  flex: 1;
  min-width: 3px;
  max-width: 7px;
  border-radius: 999px;
  background: rgba(177, 195, 222, 0.78);
}

.hum-wave-bars span.is-selected {
  background: rgba(164, 245, 208, 0.9);
}

.hum-selection {
  position: absolute;
  top: 18px;
  bottom: 43px;
  left: 29%;
  width: 22%;
  background: rgba(20, 219, 157, 0.22);
  border-left: 3px solid #00ff9d;
  border-right: 3px solid #00ff9d;
}

.hum-playhead {
  position: absolute;
  top: 18px;
  bottom: 43px;
  left: 18px;
  width: 3px;
  background: #00ff9d;
}

.hum-selection-label {
  position: absolute;
  left: 30%;
  top: 26px;
  color: #ecfff6;
  font-size: 24px;
  font-weight: 800;
}

.hum-wave-time {
  position: absolute;
  left: 24px;
  right: 24px;
  bottom: 16px;
  display: flex;
  justify-content: space-between;
  color: #9ab7df;
  font-variant-numeric: tabular-nums;
}

.hum-panel-head {
  align-items: flex-start;
  margin-bottom: 16px;
}

.hum-panel-head svg,
.hum-source-title svg,
.hum-side-title svg {
  color: #80ffd4;
  flex: 0 0 auto;
}

.hum-panel-head p {
  margin: 4px 0 0;
  line-height: 1.45;
}

.hum-choice-row {
  margin-bottom: 12px;
}

.hum-knobs {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.hum-knob-card {
  padding: 14px;
  border-radius: 8px;
  background: rgba(5, 11, 22, 0.72);
  border: 1px solid rgba(154, 180, 218, 0.18);
}

.hum-knob-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.hum-label {
  color: #fff6dd;
  font-weight: 900;
}

.hum-help {
  margin-top: 5px;
  font-size: 12px;
  line-height: 1.35;
}

.hum-knob {
  width: 62px;
  height: 62px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.hum-knob span {
  width: 42px;
  height: 42px;
  border-radius: 50%;
  display: grid;
  place-items: center;
  background: #0a1320;
  color: #ffd36f;
  font-weight: 900;
  font-size: 12px;
}

.hum-slider {
  width: 100%;
  margin-top: 14px;
  accent-color: #ffd36f;
}

.hum-code {
  overflow: auto;
  max-height: 315px;
  padding: 14px;
  border-radius: 8px;
  background: rgba(3, 7, 16, 0.86);
  border: 1px solid rgba(154, 180, 218, 0.2);
  color: #cce7ff;
  font-size: 12px;
  line-height: 1.45;
}

.hum-candidate-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.hum-candidate {
  text-align: left;
  color: inherit;
  background: rgba(6, 12, 23, 0.86);
  border: 1px solid rgba(154, 180, 218, 0.18);
  border-radius: 8px;
  padding: 14px;
  cursor: pointer;
}

.hum-candidate.is-selected {
  border-color: rgba(255, 211, 111, 0.9);
  box-shadow: 0 0 0 1px rgba(255, 211, 111, 0.18), 0 0 28px rgba(255, 211, 111, 0.12);
}

.hum-candidate-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.hum-candidate-title {
  color: #fffaf1;
  font-weight: 900;
}

.hum-candidate p {
  color: #c4d3ec;
  margin: 10px 0 0;
  line-height: 1.45;
}

.hum-verdict {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 9px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
}

.hum-verdict.winner {
  color: #181204;
  background: #ffd36f;
}

.hum-verdict.strong {
  color: #062116;
  background: #9fffd2;
}

.hum-verdict.risky {
  color: #ffe4e4;
  background: rgba(255, 111, 111, 0.18);
  border: 1px solid rgba(255, 111, 111, 0.36);
}

.hum-param-row {
  margin-top: 10px;
}

.hum-param-row span {
  color: #ffd36f;
  font-size: 12px;
  font-weight: 900;
}

.hum-side {
  display: grid;
  align-content: start;
  gap: 14px;
}

.hum-side-card {
  padding: 16px;
}

.hum-side-card.winner {
  border-color: rgba(255, 211, 111, 0.46);
  background: linear-gradient(180deg, rgba(55, 39, 17, 0.66), rgba(10, 16, 27, 0.82));
}

.hum-side-card h2 {
  margin: 12px 0 8px;
}

.hum-side-card ul {
  margin: 12px 0 0;
  padding-left: 18px;
  color: #c4d3ec;
  line-height: 1.55;
}

.hum-side-title {
  color: #9fffd2;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 12px;
  font-weight: 900;
}

@media (max-width: 1180px) {
  .hum-layout,
  .hum-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .hum-hero {
    min-height: 430px;
  }

  .hum-hero-badge {
    left: 24px;
    right: auto;
    bottom: 22px;
  }

  .hum-hero-copy {
    bottom: 86px;
  }

  .hum-layout {
    padding: 12px;
  }

  .hum-knobs,
  .hum-candidate-grid {
    grid-template-columns: 1fr;
  }
}
`

/**
 * MusicLabPipeline — Vertical pipeline view with S00–S09 stage wells
 * S00–S02: display wells  |  S03–S04: interactive wells  |  S05–S09: output wells
 * Driven by useAgentBus WebSocket for live stage transitions
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { EMBRY, card, label, heading, glowDot } from '../sparta/common/EmbryStyle'
import { useAgentBus } from '../sparta/common/useAgentBus'
import { ConvergenceChart } from './ConvergenceChart'
import { LyricsEditor } from './LyricsEditor'
import { PianoRollView } from './PianoRollView'
import {
  samplePianoNotes, sampleSections, samplePhrases, sampleRounds,
} from './sampleMusicData'

// ─── Stage metadata ───────────────────────────────────────────────────────────

type StageType = 'display' | 'interactive' | 'output'
type StageStatus = 'pending' | 'running' | 'passed' | 'failed'

interface StageMeta {
  id: string
  label: string
  type: StageType
  icon: string
}

const STAGES: StageMeta[] = [
  { id: 'S00_lore_recall',     label: 'Lore Recall',       type: 'display',      icon: '📖' },
  { id: 'S01_references',      label: 'Reference Songs',   type: 'display',      icon: '🎵' },
  { id: 'S02_lyrics_create',   label: 'Lyrics Creation',   type: 'display',      icon: '✍️' },
  { id: 'S03_lyrics_converge', label: 'Lyrics Convergence',type: 'interactive',  icon: '🔄' },
  { id: 'S04_annotate',        label: 'Annotation',        type: 'interactive',  icon: '🏷️' },
  { id: 'S05_arrangement',     label: 'Arrangement',       type: 'output',       icon: '🎹' },
  { id: 'S06_prompt_preview',  label: 'Prompt Preview',    type: 'output',       icon: '📝' },
  { id: 'S07_audio_player',    label: 'Audio Player',      type: 'output',       icon: '▶️' },
  { id: 'S08_audio_converge',  label: 'Audio Convergence', type: 'output',       icon: '📊' },
  { id: 'S09_voice',           label: 'Voice Identity',    type: 'output',       icon: '🎤' },
]

const STATUS_COLOR: Record<StageStatus, string> = {
  pending: EMBRY.muted,
  running: EMBRY.blue,
  passed:  EMBRY.green,
  failed:  EMBRY.red,
}

const TYPE_COLOR: Record<StageType, string> = {
  display:     EMBRY.dim,
  interactive: EMBRY.accent,
  output:      EMBRY.blue,
}

// ─── Sample data for demo mode ────────────────────────────────────────────────

const LORE_FRAGMENTS = [
  { id: 'L1', text: 'The Whisperheads are signal-keepers of the dead channel — voices mapped as waveform echoes across the archive.', source: 'lore/world.md', relevance: 0.92 },
  { id: 'L2', text: 'Dark signal frequencies emerged from the sub-carrier in 1994; only the hollow receivers could parse them.', source: 'lore/history.md', relevance: 0.87 },
  { id: 'L3', text: 'Wire-shadows: the visual ghost of a transmission lost between sender and void.', source: 'lore/symbols.md', relevance: 0.78 },
]

const REFERENCE_SONGS = [
  { title: 'Roads', artist: 'Portishead', album: 'Dummy', similarity: 0.88, mood: 'melancholic', bpm: 85, key: 'D minor' },
  { title: 'Teardrop', artist: 'Massive Attack', album: 'Mezzanine', similarity: 0.81, mood: 'ethereal', bpm: 92, key: 'C minor' },
  { title: 'Wandering Star', artist: 'Portishead', album: 'Dummy', similarity: 0.74, mood: 'dark ambient', bpm: 88, key: 'E minor' },
]

const SAMPLE_PROMPT = `Generate a melancholic trip-hop song titled "Whisperheads" in D minor at 85 BPM.

Style references: Portishead "Roads", Massive Attack "Teardrop"
Key influences: sparse brooding bass, ethereal vocal delivery, dark signal imagery

Structure:
- Verse (bars 1–4): whispered vocal, mp dynamics, Dm / Gm / Dm / A7 progression
- Chorus (bars 5–8): belted vocal, f dynamics, Dm / Bb / F / C progression

Lyrical theme: signal loss, hollow transmissions, wire-shadows

Vocal direction:
- Verse: breathy → whisper, emotion: melancholic
- Chorus: belt → speak, emotion: joy/triumph

Audio target: 210s, 44.1kHz, stereo, -14 LUFS`

const VOICE_PROFILES = [
  { name: 'Reference Voice A', source: 'Portishead / Beth Gibbons style', similarity: 0.88, timbre: 0.91, prosody: 0.85, intonation: 0.89 },
  { name: 'Reference Voice B', source: 'Massive Attack / Liz Fraser style', similarity: 0.76, timbre: 0.79, prosody: 0.72, intonation: 0.77 },
  { name: 'Synthesised Voice', source: 'Generated — Round 3 output', similarity: 0.94, timbre: 0.92, prosody: 0.88, intonation: 0.93 },
]

// ─── StageWell wrapper ────────────────────────────────────────────────────────

interface StageWellProps {
  meta: StageMeta
  status: StageStatus
  detail?: string
  children: React.ReactNode
  isExpanded: boolean
  onToggle: () => void
}

function StageWell({ meta, status, detail, children, isExpanded, onToggle }: StageWellProps) {
  const sc = STATUS_COLOR[status]
  const tc = TYPE_COLOR[meta.type]
  const isRunning = status === 'running'

  return (
    <div style={{
      backgroundColor: EMBRY.bgCard,
      border: `1px solid ${isRunning ? EMBRY.blue : status === 'passed' ? `${EMBRY.green}60` : EMBRY.border}`,
      borderLeft: `3px solid ${sc}`,
      borderRadius: 10,
      overflow: 'hidden',
      transition: 'border-color 0.3s',
      boxShadow: isRunning ? `0 0 20px ${EMBRY.blue}18` : 'none',
    }}>
      {/* Stage header */}
      <button
        onClick={onToggle}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 14px', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left',
          borderBottom: isExpanded ? `1px solid ${EMBRY.border}` : 'none',
          backgroundColor: isRunning ? `${EMBRY.blue}08` : 'transparent',
        }}
      >
        {/* Status dot */}
        <div style={{
          width: 10, height: 10, borderRadius: '50%', backgroundColor: sc,
          boxShadow: status !== 'pending' ? `0 0 8px ${sc}` : 'none',
          flexShrink: 0,
        }} />

        {/* Stage ID badge */}
        <span style={{
          fontSize: 9, fontFamily: 'monospace', fontWeight: 700,
          color: sc, backgroundColor: `${sc}15`,
          padding: '2px 6px', borderRadius: 4, flexShrink: 0,
        }}>
          {meta.id.slice(0, 3)}
        </span>

        {/* Icon + label */}
        <span style={{ fontSize: 12 }}>{meta.icon}</span>
        <span style={{ ...heading, fontSize: 13, flex: 1 }}>{meta.label}</span>

        {/* Type badge */}
        <span style={{
          fontSize: 8, fontWeight: 700, padding: '1px 6px', borderRadius: 3,
          color: tc, backgroundColor: `${tc}15`, border: `1px solid ${tc}30`,
          letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0,
        }}>
          {meta.type}
        </span>

        {/* Detail / status text */}
        {detail && (
          <span style={{ ...label, fontSize: 9, color: EMBRY.dim, flexShrink: 0, maxWidth: 140,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {detail}
          </span>
        )}

        {/* Chevron */}
        <span style={{ color: EMBRY.dim, fontSize: 10, flexShrink: 0, transition: 'transform 0.2s',
          transform: isExpanded ? 'rotate(180deg)' : 'none' }}>▼</span>
      </button>

      {/* Stage content */}
      {isExpanded && (
        <div style={{ padding: 14 }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ─── S00: Lore Recall Well ────────────────────────────────────────────────────

function S00Well({ status }: { status: StageStatus }) {
  const dim = status === 'pending'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: dim ? 0.4 : 1 }}>
      <div style={{ ...label, fontSize: 8, marginBottom: 4 }}>RECALLED FRAGMENTS · {LORE_FRAGMENTS.length} results</div>
      {LORE_FRAGMENTS.map(f => (
        <div key={f.id} style={{
          backgroundColor: EMBRY.bg, borderRadius: 8, padding: '10px 12px',
          border: `1px solid ${EMBRY.border}`,
          borderLeft: `3px solid ${EMBRY.accent}`,
        }}>
          <p style={{ margin: '0 0 6px', fontSize: 13, color: EMBRY.white, lineHeight: 1.5, fontStyle: 'italic' }}>
            "{f.text}"
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ ...label, fontSize: 8, color: EMBRY.dim }}>{f.source}</span>
            <span style={{
              fontSize: 9, fontWeight: 700, color: EMBRY.green,
              backgroundColor: `${EMBRY.green}15`, padding: '1px 6px', borderRadius: 4,
            }}>rel {f.relevance.toFixed(2)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── S01: Reference Songs Well ────────────────────────────────────────────────

function S01Well({ status }: { status: StageStatus }) {
  const dim = status === 'pending'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, opacity: dim ? 0.4 : 1 }}>
      <div style={{ ...label, fontSize: 8, marginBottom: 4 }}>REFERENCE SONGS · {REFERENCE_SONGS.length} tracks</div>
      {REFERENCE_SONGS.map((s, i) => (
        <div key={i} style={{
          backgroundColor: EMBRY.bg, borderRadius: 8, padding: '10px 14px',
          border: `1px solid ${EMBRY.border}`,
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <div style={{
            width: 40, height: 40, borderRadius: 6, flexShrink: 0,
            backgroundColor: EMBRY.bgPanel, border: `1px solid ${EMBRY.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
          }}>🎵</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: EMBRY.white }}>{s.title}</div>
            <div style={{ fontSize: 11, color: EMBRY.dim }}>{s.artist} · {s.album} · {s.bpm} BPM · {s.key}</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: EMBRY.green }}>{Math.round(s.similarity * 100)}%</span>
            <span style={{
              fontSize: 8, fontWeight: 700, color: EMBRY.amber,
              backgroundColor: `${EMBRY.amber}15`, padding: '1px 5px', borderRadius: 3,
            }}>{s.mood}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── S02: Lyrics Creation Well (stem bars) ───────────────────────────────────

function S02Well({ status }: { status: StageStatus }) {
  const dim = status === 'pending'
  const secColor: Record<string, string> = { verse: EMBRY.blue, chorus: EMBRY.accent }
  const totalBeats = 32
  return (
    <div style={{ opacity: dim ? 0.4 : 1 }}>
      <div style={{ ...label, fontSize: 8, marginBottom: 10 }}>LYRICS STRUCTURE · {samplePhrases.length} phrases</div>
      <div style={{ position: 'relative', height: samplePhrases.length * 30 + 20 }}>
        {/* Beat grid */}
        {[0, 8, 16, 24, 32].map(beat => (
          <div key={beat} style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${(beat / totalBeats) * 100}%`,
            borderLeft: `1px solid ${EMBRY.border}`,
          }}>
            <span style={{ ...label, fontSize: 7, color: EMBRY.muted, paddingLeft: 2 }}>B{beat}</span>
          </div>
        ))}
        {/* Phrase bars */}
        {samplePhrases.map((p, i) => {
          const leftPct = (p.beat / totalBeats) * 100
          const widthPct = (p.duration_beats / totalBeats) * 100
          const color = secColor[p.section] ?? EMBRY.dim
          return (
            <div key={i} style={{
              position: 'absolute', top: i * 30 + 16, left: `${leftPct}%`,
              width: `${widthPct}%`, height: 20, borderRadius: 4,
              backgroundColor: `${color}28`, border: `1px solid ${color}60`,
              display: 'flex', alignItems: 'center', padding: '0 6px', overflow: 'hidden',
            }}>
              <span style={{ fontSize: 10, color, fontWeight: 600, whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {p.text}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── S03: Lyrics Convergence Well (interactive) ───────────────────────────────

interface S03State { approvalStatus: 'pending' | 'approved' | 'revision'; revisionNote: string }

function S03Well({ status, onSend }: { status: StageStatus; onSend: (type: string, payload: Record<string, unknown>) => void }) {
  const [s, setS] = useState<S03State>({ approvalStatus: 'pending', revisionNote: '' })
  const dim = status === 'pending'
  const lastRound = sampleRounds[sampleRounds.length - 1]
  const agg = lastRound?.delta.aggregate ?? 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, opacity: dim ? 0.4 : 1 }}>
      {/* Convergence status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={glowDot(agg <= 0.2 ? EMBRY.green : agg <= 0.35 ? EMBRY.amber : EMBRY.red, 10)} />
        <span style={{ fontSize: 12, fontWeight: 700, color: EMBRY.white }}>Round {lastRound?.round ?? '—'}</span>
        <span style={{ fontSize: 11, color: EMBRY.dim }}>aggregate Δ {agg.toFixed(3)}</span>
        {agg <= 0.2 && (
          <span style={{ fontSize: 9, fontWeight: 700, color: EMBRY.green,
            backgroundColor: `${EMBRY.green}18`, padding: '2px 8px', borderRadius: 4 }}>CONVERGED</span>
        )}
      </div>

      {/* Lyrics preview */}
      <div style={{ backgroundColor: EMBRY.bg, borderRadius: 8, padding: 12,
        border: `1px solid ${EMBRY.border}`, maxHeight: 160, overflowY: 'auto' }}>
        {samplePhrases.map((p, i) => (
          <div key={i} style={{ fontSize: 13, color: EMBRY.white, lineHeight: 1.9, fontStyle: 'italic' }}>
            {p.text}
          </div>
        ))}
      </div>

      {/* Approval controls */}
      {s.approvalStatus === 'pending' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => { setS(p => ({ ...p, approvalStatus: 'approved' })); onSend('user-action', { action: 'approve-lyrics' }) }}
            style={{
              flex: 1, padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
              backgroundColor: `${EMBRY.green}22`, color: EMBRY.green,
              border: `1px solid ${EMBRY.green}44`, fontSize: 12, fontWeight: 700,
            } as React.CSSProperties}
          >✓ Approve Draft</button>
          <button
            onClick={() => setS(p => ({ ...p, approvalStatus: 'revision' }))}
            style={{
              flex: 1, padding: '8px 16px', borderRadius: 8, cursor: 'pointer',
              backgroundColor: `${EMBRY.amber}18`, color: EMBRY.amber,
              border: `1px solid ${EMBRY.amber}44`, fontSize: 12, fontWeight: 700,
            } as React.CSSProperties}
          >↻ Request Revision</button>
        </div>
      )}
      {s.approvalStatus === 'approved' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
          backgroundColor: `${EMBRY.green}12`, borderRadius: 8, border: `1px solid ${EMBRY.green}30` }}>
          <span style={{ fontSize: 14 }}>✓</span>
          <span style={{ fontSize: 12, color: EMBRY.green, fontWeight: 700 }}>Lyrics approved — proceeding to annotation</span>
        </div>
      )}
      {s.approvalStatus === 'revision' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <textarea
            placeholder="Revision notes (e.g. 'make chorus more triumphant, emphasize signal imagery')..."
            value={s.revisionNote}
            onChange={e => setS(p => ({ ...p, revisionNote: e.target.value }))}
            style={{
              width: '100%', minHeight: 80, padding: '8px 10px', borderRadius: 8,
              backgroundColor: EMBRY.bg, border: `1px solid ${EMBRY.amber}44`,
              color: EMBRY.white, fontSize: 12, fontFamily: 'Inter, sans-serif',
              resize: 'vertical', boxSizing: 'border-box',
            }}
          />
          <button
            onClick={() => {
              onSend('user-action', { action: 'request-revision', note: s.revisionNote })
              setS(p => ({ ...p, approvalStatus: 'pending', revisionNote: '' }))
            }}
            style={{
              padding: '6px 16px', borderRadius: 6, border: `1px solid ${EMBRY.amber}44`,
              backgroundColor: `${EMBRY.amber}18`, color: EMBRY.amber, cursor: 'pointer',
              fontSize: 11, fontWeight: 700, alignSelf: 'flex-end',
            }}
          >Submit Revision</button>
        </div>
      )}
    </div>
  )
}

// ─── S04: Annotation Well (interactive) ──────────────────────────────────────

function S04Well({ status }: { status: StageStatus }) {
  const dim = status === 'pending'
  return (
    <div style={{ opacity: dim ? 0.4 : 1 }}>
      <LyricsEditor phrases={samplePhrases} rounds={sampleRounds} />
    </div>
  )
}

// ─── S05: Arrangement Well ────────────────────────────────────────────────────

function S05Well({ status }: { status: StageStatus }) {
  const dim = status === 'pending'
  return (
    <div style={{ opacity: dim ? 0.4 : 1 }}>
      <div style={{ ...label, fontSize: 8, marginBottom: 8 }}>PIANO ROLL SPEC · D minor · 85 BPM · 8 bars</div>
      <PianoRollView notes={samplePianoNotes} sections={sampleSections} bpm={85} totalBars={8} />
    </div>
  )
}

// ─── S06: Prompt Preview Well ─────────────────────────────────────────────────

function S06Well({ status }: { status: StageStatus }) {
  const dim = status === 'pending'
  return (
    <div style={{ opacity: dim ? 0.4 : 1 }}>
      <div style={{ ...label, fontSize: 8, marginBottom: 8 }}>GENERATION PROMPT</div>
      <pre style={{
        margin: 0, padding: '12px 14px', borderRadius: 8,
        backgroundColor: EMBRY.bg, border: `1px solid ${EMBRY.border}`,
        color: EMBRY.white, fontSize: 11, fontFamily: 'JetBrains Mono, monospace',
        lineHeight: 1.7, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      }}>
        {SAMPLE_PROMPT}
      </pre>
    </div>
  )
}

// ─── S07: Audio Player Well ───────────────────────────────────────────────────

function S07Well({ status }: { status: StageStatus }) {
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0.35)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const dim = status === 'pending'

  const togglePlay = useCallback(() => {
    setPlaying(p => {
      if (!p) {
        timerRef.current = setInterval(() => {
          setProgress(v => { if (v >= 1) { setPlaying(false); return 0 } return Math.min(1, v + 0.002) })
        }, 100)
      } else {
        if (timerRef.current) clearInterval(timerRef.current)
      }
      return !p
    })
  }, [])

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current) }, [])

  const elapsed = Math.round(progress * 210)
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, opacity: dim ? 0.4 : 1 }}>
      <div style={{ ...label, fontSize: 8 }}>GENERATED AUDIO · Round {sampleRounds.length}</div>

      {/* Waveform thumbnail */}
      <div style={{
        height: 48, borderRadius: 8, backgroundColor: EMBRY.bg,
        border: `1px solid ${EMBRY.border}`, overflow: 'hidden', position: 'relative',
      }}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', padding: '0 8px', gap: 1 }}>
          {Array.from({ length: 80 }, (_, i) => {
            const t = i / 79
            const h = 0.2 + 0.6 * Math.abs(Math.sin(t * Math.PI * 8)) * (t > 0.5 ? 1.4 : 0.8)
            const isPlayed = t < progress
            return (
              <div key={i} style={{
                flex: 1, height: `${Math.min(100, h * 100)}%`,
                backgroundColor: isPlayed ? EMBRY.accent : `${EMBRY.dim}60`,
                borderRadius: 1, transition: 'background-color 0.1s',
              }} />
            )
          })}
        </div>
        {/* Playhead */}
        <div style={{
          position: 'absolute', top: 0, bottom: 0, left: `${progress * 100}%`,
          width: 2, backgroundColor: 'white', boxShadow: '0 0 8px white',
        }} />
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <button
          onClick={togglePlay}
          style={{
            width: 44, height: 44, borderRadius: '50%', cursor: 'pointer',
            backgroundColor: `${EMBRY.accent}22`, color: EMBRY.accent,
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
            border: `1px solid ${EMBRY.accent}44`, flexShrink: 0,
          } as React.CSSProperties}
        >{playing ? '⏸' : '▶'}</button>

        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: EMBRY.white, marginBottom: 4 }}>
            Whisperheads — Round {sampleRounds.length}
          </div>
          <div style={{ height: 4, borderRadius: 2, backgroundColor: EMBRY.muted, overflow: 'hidden', cursor: 'pointer' }}
            onClick={e => {
              const r = e.currentTarget.getBoundingClientRect()
              setProgress(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)))
            }}>
            <div style={{
              height: '100%', width: `${progress * 100}%`,
              backgroundColor: EMBRY.accent, borderRadius: 2,
              boxShadow: `0 0 8px ${EMBRY.accent}55`, transition: 'width 0.1s',
            }} />
          </div>
        </div>

        <span style={{ fontSize: 11, fontFamily: 'monospace', color: EMBRY.dim, flexShrink: 0 }}>
          {fmt(elapsed)} / 3:30
        </span>
      </div>
    </div>
  )
}

// ─── S08: Audio Convergence Well ─────────────────────────────────────────────

function S08Well({ status }: { status: StageStatus }) {
  const dim = status === 'pending'
  return (
    <div style={{ opacity: dim ? 0.4 : 1 }}>
      <ConvergenceChart rounds={sampleRounds} />
    </div>
  )
}

// ─── S09: Voice Identity Well ─────────────────────────────────────────────────

function S09Well({ status }: { status: StageStatus }) {
  const dim = status === 'pending'
  const dims = ['timbre', 'prosody', 'intonation'] as const

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, opacity: dim ? 0.4 : 1 }}>
      <div style={{ ...label, fontSize: 8, marginBottom: 4 }}>VOICE PROFILE COMPARISON · {VOICE_PROFILES.length} voices</div>
      {VOICE_PROFILES.map((vp, i) => {
        const isGenerated = vp.source.includes('Generated')
        const barColor = isGenerated ? EMBRY.green : EMBRY.blue
        return (
          <div key={i} style={{
            backgroundColor: EMBRY.bg, borderRadius: 8, padding: '10px 12px',
            border: `1px solid ${isGenerated ? `${EMBRY.green}40` : EMBRY.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: EMBRY.white }}>{vp.name}</div>
                <div style={{ fontSize: 10, color: EMBRY.dim }}>{vp.source}</div>
              </div>
              <span style={{
                fontSize: 12, fontWeight: 800,
                color: isGenerated ? EMBRY.green : EMBRY.blue,
              }}>{Math.round(vp.similarity * 100)}%</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {dims.map(d => (
                <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ ...label, fontSize: 8, width: 60, flexShrink: 0 }}>{d}</span>
                  <div style={{ flex: 1, height: 5, borderRadius: 3, backgroundColor: EMBRY.muted, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', width: `${vp[d] * 100}%`,
                      backgroundColor: barColor, borderRadius: 3,
                      boxShadow: `0 0 6px ${barColor}55`,
                    }} />
                  </div>
                  <span style={{ fontSize: 9, fontFamily: 'monospace', color: EMBRY.dim, width: 28, textAlign: 'right' }}>
                    {vp[d].toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── MusicLabPipeline (main) ──────────────────────────────────────────────────

interface StageEvent {
  stage: string
  status: 'running' | 'passed' | 'failed' | 'done'
  detail: string
  ts: number
}

interface PipelineState {
  project: string
  active: boolean
  stages: StageEvent[]
}

export function MusicLabPipeline() {
  const [pipeline, setPipeline] = useState<PipelineState>({ project: 'whisperheads', active: false, stages: [] })
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    S00_lore_recall: true, S01_references: true, S02_lyrics_create: true,
    S03_lyrics_converge: true, S04_annotate: false,
    S05_arrangement: false, S06_prompt_preview: false,
    S07_audio_player: false, S08_audio_converge: true, S09_voice: false,
  })

  const { connected, send } = useAgentBus(useCallback((msg) => {
    if (msg.type === 'pipeline-start') {
      setPipeline({ project: msg.payload.project as string, active: true, stages: [] })
    } else if (msg.type === 'pipeline-stage') {
      const ev = msg.payload as unknown as StageEvent
      setPipeline(prev => ({ ...prev, stages: [...prev.stages, ev] }))
    } else if (msg.type === 'pipeline-done') {
      setPipeline(prev => ({ ...prev, active: false }))
    }
  }, []))

  // Build stage status map
  const stageStatus = new Map<string, StageEvent>()
  for (const ev of pipeline.stages) stageStatus.set(ev.stage, ev)

  function getStatus(stageId: string): StageStatus {
    const ev = stageStatus.get(stageId)
    if (!ev) return 'pending'
    if (ev.status === 'passed' || ev.status === 'done') return 'passed'
    if (ev.status === 'failed') return 'failed'
    if (ev.status === 'running') return 'running'
    return 'pending'
  }

  const completed = STAGES.filter(s => getStatus(s.id) === 'passed').length
  const pct = (completed / STAGES.length) * 100

  function toggleExpanded(id: string) {
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }))
  }

  function renderWell(meta: StageMeta) {
    const status = getStatus(meta.id)
    const ev = stageStatus.get(meta.id)
    switch (meta.id) {
      case 'S00_lore_recall':     return <S00Well status={status} />
      case 'S01_references':      return <S01Well status={status} />
      case 'S02_lyrics_create':   return <S02Well status={status} />
      case 'S03_lyrics_converge': return <S03Well status={status} onSend={send} />
      case 'S04_annotate':        return <S04Well status={status} />
      case 'S05_arrangement':     return <S05Well status={status} />
      case 'S06_prompt_preview':  return <S06Well status={status} />
      case 'S07_audio_player':    return <S07Well status={status} />
      case 'S08_audio_converge':  return <S08Well status={status} />
      case 'S09_voice':           return <S09Well status={status} />
      default:                    return <div style={{ ...label, color: EMBRY.dim }}>No content</div>
    }
    void ev
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
      backgroundColor: EMBRY.bgDeep }}>

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px',
        borderBottom: `1px solid ${EMBRY.border}`, backgroundColor: EMBRY.bgPanel, flexShrink: 0,
      }}>
        <div style={glowDot(!connected ? EMBRY.red : pipeline.active ? EMBRY.blue : EMBRY.green, 10)} />
        <span style={{ ...heading, fontSize: 14 }}>Music Lab Pipeline — Whisperheads</span>
        <div style={{ flex: 1 }} />
        <span style={{ ...label, fontSize: 9 }}>
          {!connected ? 'DISCONNECTED' : pipeline.active ? 'RUNNING' : 'DEMO MODE'}
        </span>
        <span style={{ ...label, fontSize: 9 }}>{completed}/{STAGES.length} stages</span>

        {/* Progress bar */}
        <div style={{ width: 120, height: 6, borderRadius: 3, backgroundColor: EMBRY.muted, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3,
            backgroundColor: EMBRY.green, transition: 'width 0.5s ease' }} />
        </div>
      </div>

      {/* Pipeline wells */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px',
        display: 'flex', flexDirection: 'column', gap: 8 }}>
        {STAGES.map((meta, i) => {
          const status = getStatus(meta.id)
          const ev = stageStatus.get(meta.id)
          return (
            <div key={meta.id} style={{ display: 'flex', gap: 8 }}>
              {/* Spine connector */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0, width: 16, paddingTop: 16 }}>
                <div style={{ width: 2, flex: 1,
                  backgroundColor: i === 0 ? 'transparent' :
                    getStatus(STAGES[i - 1]?.id ?? '') === 'passed' ? EMBRY.green : EMBRY.border,
                }} />
              </div>
              <div style={{ flex: 1 }}>
                <StageWell
                  meta={meta}
                  status={status}
                  detail={ev?.detail}
                  isExpanded={expanded[meta.id] ?? false}
                  onToggle={() => toggleExpanded(meta.id)}
                >
                  {renderWell(meta)}
                </StageWell>
              </div>
            </div>
          )
        })}
        {/* Bottom padding */}
        <div style={{ height: 20 }} />
      </div>
    </div>
  )
}

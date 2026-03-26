import { EMBRY, heading, label } from '../sparta/common/EmbryStyle'
import { PianoRollView } from './PianoRollView'
import { WaveformView } from './WaveformView'
import { ConvergenceChart } from './ConvergenceChart'
import { LyricsEditor } from './LyricsEditor'
import type { PianoNote, Section, Phrase, RoundResult, DriftMarker, LyricMarker } from './sampleMusicData'

interface Props {
  spec?: {
    notes?: PianoNote[]
    sections?: Section[]
    bpm?: number
    totalBars?: number
  }
  lyrics?: {
    phrases?: Phrase[]
  }
  convergence?: {
    rounds?: RoundResult[]
  }
  peaks?: number[]
  driftMarkers?: DriftMarker[]
  lyricMarkers?: LyricMarker[]
}

export function MusicLabDashboard({
  spec = {},
  lyrics = {},
  convergence = {},
  peaks = [],
  driftMarkers = [],
  lyricMarkers = [],
}: Props) {
  const notes = spec.notes ?? []
  const sections = spec.sections ?? []
  const bpm = spec.bpm ?? 120
  const totalBars = spec.totalBars ?? 8
  const phrases = lyrics.phrases ?? []
  const rounds = convergence.rounds ?? []

  const lastRound = rounds[rounds.length - 1]
  const aggregate = lastRound?.delta.aggregate ?? null
  const statusColor =
    aggregate === null ? EMBRY.dim :
    aggregate <= 0.2  ? EMBRY.green :
    aggregate <= 0.35 ? EMBRY.amber :
    EMBRY.red

  return (
    <div style={{
      backgroundColor: EMBRY.bgDeep,
      borderRadius: 16,
      border: `1px solid ${EMBRY.border}`,
      overflow: 'hidden',
      width: '100%',
    }}>
      {/* Title bar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '12px 20px',
        borderBottom: `1px solid ${EMBRY.border}`,
        backgroundColor: EMBRY.bgPanel,
      }}>
        <div style={{
          width: 10, height: 10, borderRadius: '50%',
          backgroundColor: statusColor,
          boxShadow: `0 0 10px ${statusColor}99`,
          flexShrink: 0,
        }} />
        <span style={{ ...heading, fontSize: 14 }}>Music Lab — Whisperheads</span>
        <div style={{ flex: 1 }} />
        <span style={{ ...label }}>
          {bpm} BPM · D minor · {totalBars} bars
        </span>
        {aggregate !== null && (
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
            backgroundColor: `${statusColor}20`, color: statusColor,
            border: `1px solid ${statusColor}40`,
          }}>
            Δ {aggregate.toFixed(2)} {aggregate <= 0.2 ? '✓' : ''}
          </span>
        )}
        {rounds.length > 0 && (
          <span style={{ ...label }}>Round {lastRound.round}</span>
        )}
      </div>

      {/* 2×2 grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gridTemplateRows: 'auto auto',
        gap: 1,
        backgroundColor: EMBRY.border,
      }}>
        {/* Top-left: Piano Roll */}
        <div style={{ backgroundColor: EMBRY.bg, padding: 16 }}>
          <PianoRollView
            notes={notes}
            sections={sections}
            bpm={bpm}
            totalBars={totalBars}
          />
        </div>

        {/* Top-right: Waveform */}
        <div style={{ backgroundColor: EMBRY.bg, padding: 16 }}>
          <WaveformView
            peaks={peaks}
            bpm={bpm}
            totalBars={totalBars}
            driftMarkers={driftMarkers}
            lyrics={lyricMarkers}
          />
        </div>

        {/* Bottom-left: Convergence */}
        <div style={{ backgroundColor: EMBRY.bg, padding: 16 }}>
          <ConvergenceChart rounds={rounds} />
        </div>

        {/* Bottom-right: Lyrics */}
        <div style={{ backgroundColor: EMBRY.bg, padding: 16 }}>
          <LyricsEditor phrases={phrases} />
        </div>
      </div>
    </div>
  )
}

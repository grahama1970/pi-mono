import { EMBRY, card, heading, label } from '../sparta/common/EmbryStyle'
import type { PianoNote, Section } from './sampleMusicData'

const INST_COLOR: Record<string, string> = {
  vocal: EMBRY.accent, bass: EMBRY.blue, drums: EMBRY.red,
  keys: EMBRY.green, synth: EMBRY.amber, guitar: '#ff6b6b',
}

interface Props {
  notes: PianoNote[]
  sections: Section[]
  bpm: number
  totalBars: number
}

export function PianoRollView({ notes, sections, bpm, totalBars }: Props) {
  const totalBeats = totalBars * 4
  const W = 800, H = 260, PL = 36, PT = 40, PB = 20
  const plotW = W - PL, plotH = H - PT - PB

  const pitches = notes.map(n => typeof n.pitch === 'number' ? n.pitch : 60).filter(p => !isNaN(p))
  const minP = Math.max(0, Math.min(...pitches) - 2)
  const maxP = Math.min(127, Math.max(...pitches) + 2)
  const range = maxP - minP || 1

  const bx = (beat: number) => PL + (beat / totalBeats) * plotW
  const py = (p: number) => PT + ((maxP - p) / range) * plotH
  const nh = Math.max(4, plotH / range - 1)
  const instruments = Array.from(new Set(notes.map(n => n.instrument)))

  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ ...heading, fontSize: 13 }}>Piano Roll</span>
        <div style={{ display: 'flex', gap: 8 }}>
          {instruments.map(inst => (
            <div key={inst} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: INST_COLOR[inst] ?? EMBRY.dim }} />
              <span style={{ ...label, fontSize: 9 }}>{inst}</span>
            </div>
          ))}
        </div>
        <span style={label}>{bpm} BPM · {totalBars} bars</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {sections.map(sec => {
          const x = bx((sec.start_bar - 1) * 4), w = bx(sec.end_bar * 4) - x
          return (
            <g key={sec.section_name}>
              <rect x={x} y={PT} width={w} height={plotH}
                fill={sec.section_name === 'Chorus' ? `${EMBRY.accent}10` : `${EMBRY.blue}08`} />
              <text x={x + 6} y={PT + 12} fill={EMBRY.dim} fontSize={9} fontWeight={700}
                fontFamily="monospace">{sec.section_name}</text>
              {(sec.chord_progression ?? []).map((ch, ci) => (
                <text key={ci} x={bx((sec.start_bar - 1) * 4 + ci * 4) + 2} y={PT + 24}
                  fill={`${EMBRY.amber}99`} fontSize={8} fontFamily="monospace">{ch}</text>
              ))}
            </g>
          )
        })}
        {Array.from({ length: totalBars + 1 }, (_, bar) => (
          <line key={bar} x1={bx(bar * 4)} y1={PT} x2={bx(bar * 4)} y2={PT + plotH}
            stroke={`${EMBRY.muted}88`} strokeWidth={bar % 4 === 0 ? 1.5 : 0.5} />
        ))}
        {Array.from({ length: totalBeats + 1 }, (_, b) => {
          if (b % 4 === 0) return null
          return <line key={`b${b}`} x1={bx(b)} y1={PT} x2={bx(b)} y2={PT + plotH}
            stroke={`${EMBRY.muted}30`} strokeWidth={0.5} />
        })}
        {Array.from({ length: Math.ceil(range / 6) + 1 }, (_, i) => {
          const p = minP + i * 6
          if (p > maxP) return null
          const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
          return (
            <g key={p}>
              <line x1={PL - 4} y1={py(p)} x2={PL} y2={py(p)} stroke={EMBRY.muted} strokeWidth={0.5} />
              <text x={PL - 6} y={py(p) + 3} fill={EMBRY.dim} fontSize={7} textAnchor="end"
                fontFamily="monospace">{noteNames[p % 12]}{Math.floor(p / 12) - 1}</text>
            </g>
          )
        })}
        {notes.map((note, i) => {
          const pitch = typeof note.pitch === 'number' ? note.pitch : 60
          const x = bx(note.start_beat)
          const w = Math.max(3, (note.duration_beats / totalBeats) * plotW - 1)
          const color = INST_COLOR[note.instrument] ?? EMBRY.dim
          return <rect key={i} x={x} y={py(pitch) - nh / 2} width={w} height={nh}
            fill={color} opacity={0.3 + (note.velocity / 127) * 0.7} rx={2} />
        })}
        <line x1={PL} y1={PT + plotH} x2={W} y2={PT + plotH} stroke={EMBRY.border} strokeWidth={1} />
        <line x1={PL} y1={PT} x2={PL} y2={PT + plotH} stroke={EMBRY.border} strokeWidth={1} />
        {Array.from({ length: totalBars + 1 }, (_, bar) => (
          <text key={bar} x={bx(bar * 4) + 2} y={PT + plotH + 14} fill={EMBRY.dim}
            fontSize={8} fontFamily="monospace">{bar + 1}</text>
        ))}
      </svg>
    </div>
  )
}

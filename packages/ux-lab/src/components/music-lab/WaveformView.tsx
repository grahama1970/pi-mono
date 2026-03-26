import { useRef, useEffect } from 'react'
import { EMBRY, card, heading, label } from '../sparta/common/EmbryStyle'
import type { DriftMarker, LyricMarker } from './sampleMusicData'

const W = 800, H = 240, PL = 8, PR = 8, PT = 20, WAVE_H = 150

function rgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${a})`
}

interface Props {
  peaks: number[]
  bpm: number
  totalBars: number
  driftMarkers?: DriftMarker[]
  lyrics?: LyricMarker[]
  driftThreshold?: number
}

export function WaveformView({ peaks, bpm, totalBars, driftMarkers = [], lyrics = [], driftThreshold = 50 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return

    const totalBeats = totalBars * 4
    const plotW = W - PL - PR, waveBot = PT + WAVE_H, midY = PT + WAVE_H / 2
    const bx = (beat: number) => PL + (beat / totalBeats) * plotW
    const beatSpan = plotW / totalBeats

    ctx.fillStyle = EMBRY.bgCard
    ctx.fillRect(0, 0, W, H)

    // Drift highlights
    driftMarkers.filter(d => d.drift_ms > driftThreshold).forEach(d => {
      ctx.fillStyle = rgba(EMBRY.red, 0.12)
      ctx.fillRect(bx(d.beat) - beatSpan / 2, PT, beatSpan, WAVE_H)
    })

    // Beat grid
    for (let b = 0; b <= totalBeats; b++) {
      const x = bx(b), isBar = b % 4 === 0
      ctx.beginPath(); ctx.moveTo(x, PT); ctx.lineTo(x, waveBot)
      ctx.strokeStyle = isBar ? rgba(EMBRY.muted, 0.42) : rgba(EMBRY.muted, 0.16)
      ctx.lineWidth = isBar ? 1 : 0.5; ctx.stroke()
    }

    // Centre line
    ctx.beginPath(); ctx.moveTo(PL, midY); ctx.lineTo(W - PR, midY)
    ctx.strokeStyle = rgba(EMBRY.muted, 0.35); ctx.lineWidth = 0.5
    ctx.setLineDash([4, 4]); ctx.stroke(); ctx.setLineDash([])

    // Waveform peaks
    const barW = plotW / peaks.length
    peaks.forEach((peak, i) => {
      const x = PL + i * barW, h = Math.max(1, peak * (WAVE_H / 2) * 0.9)
      const isChorus = i / peaks.length > 0.5
      const color = isChorus ? EMBRY.accent : EMBRY.blue
      const bw = Math.max(1, barW - 0.5)
      ctx.fillStyle = rgba(color, 0.75); ctx.fillRect(x, midY - h, bw, h)
      ctx.fillStyle = rgba(color, 0.35); ctx.fillRect(x, midY, bw, h)
    })

    // Drift markers
    driftMarkers.forEach(d => {
      const x = bx(d.beat), bad = d.drift_ms > driftThreshold
      const color = bad ? EMBRY.red : EMBRY.amber
      ctx.beginPath(); ctx.moveTo(x, PT + 9); ctx.lineTo(x - 4, PT + 2); ctx.lineTo(x + 4, PT + 2)
      ctx.closePath(); ctx.fillStyle = bad ? color : rgba(color, 0.6); ctx.fill()
      if (bad) { ctx.font = '7px monospace'; ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.fillText(`${d.drift_ms}ms`, x, PT + 22) }
    })

    // Bar labels
    ctx.font = '8px monospace'; ctx.fillStyle = EMBRY.dim; ctx.textAlign = 'center'
    for (let bar = 0; bar <= totalBars; bar++) ctx.fillText(String(bar + 1), bx(bar * 4), waveBot + 12)

    // Lyrics
    ctx.font = '8px monospace'; ctx.textAlign = 'left'
    lyrics.forEach(lyr => {
      const x = bx(lyr.beat)
      ctx.beginPath(); ctx.moveTo(x, waveBot); ctx.lineTo(x, waveBot + 5)
      ctx.strokeStyle = rgba(EMBRY.green, 0.85); ctx.lineWidth = 1; ctx.stroke()
      ctx.fillStyle = rgba(EMBRY.green, 0.85)
      ctx.fillText(lyr.text.length > 12 ? lyr.text.slice(0, 11) + '…' : lyr.text, x + 2, H - 5)
    })
  }, [peaks, bpm, totalBars, driftMarkers, lyrics, driftThreshold])

  return (
    <div style={{ ...card, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ ...heading, fontSize: 13 }}>Waveform</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 8, borderRadius: 1, backgroundColor: rgba(EMBRY.red, 0.53) }} />
            <span style={{ ...label, fontSize: 9 }}>drift &gt;{driftThreshold}ms</span>
          </div>
          <span style={label}>{bpm} BPM · {totalBars} bars</span>
        </div>
      </div>
      <canvas ref={ref} width={W} height={H} style={{ display: 'block', width: '100%', height: 'auto' }} />
    </div>
  )
}

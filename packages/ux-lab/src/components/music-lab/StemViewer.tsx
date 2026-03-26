/**
 * StemViewer — S03 DAW-style stem viewer
 * Reference: Stitch screen 4b9b20e4 + Suno Studio colored track pattern
 * Web Audio API waveform rendering · per-track Solo/Mute · drag-select clips
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { EMBRY, card, label, heading, glowDot } from '../sparta/common/EmbryStyle'
import { INSTRUMENT_COLORS } from './types'

// ─── Domain types ─────────────────────────────────────────────────────────────

type InstrumentKey = 'vocal' | 'bass' | 'drums' | 'keys' | 'guitar'

interface StemTrack {
  id: InstrumentKey
  name: string
  instrument: InstrumentKey
  emoji: string
  peaks: number[]
  muted: boolean
  soloed: boolean
}

interface TrackSelection {
  startPct: number
  endPct: number
}

interface ClipCard {
  id: string
  trackId: InstrumentKey
  instrument: string
  stemLabel: string
  startTime: string
  endTime: string
  note: string
  progress: number
}

interface SongIdentity {
  title: string
  artist: string
  album: string
  year: number
  bpm: number
  key: string
  sessionName: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const NUM_PEAKS = 200
const TOTAL_BARS = 9
const SONG_TOTAL_SECS = 210

const SONG: SongIdentity = {
  title: 'Roads',
  artist: 'Portishead',
  album: 'Dummy',
  year: 1994,
  bpm: 85,
  key: 'D minor',
  sessionName: 'Whisperheads',
}

const INITIAL_TRACKS: Omit<StemTrack, 'peaks'>[] = [
  { id: 'vocal',  name: 'Vocal',          instrument: 'vocal',  emoji: '🎤', muted: false, soloed: false },
  { id: 'bass',   name: 'Bass Guitar',    instrument: 'bass',   emoji: '🎸', muted: false, soloed: false },
  { id: 'drums',  name: 'Drums',          instrument: 'drums',  emoji: '🥁', muted: false, soloed: false },
  { id: 'keys',   name: 'Piano',          instrument: 'keys',   emoji: '🎹', muted: false, soloed: false },
  { id: 'guitar', name: 'Electric Guitar',instrument: 'guitar', emoji: '🎵', muted: false, soloed: false },
]

const DEFAULT_CLIPS: ClipCard[] = [
  {
    id: 'c1', trackId: 'bass', instrument: 'bass',
    stemLabel: 'Bass · Verse Ref', startTime: '0:20', endTime: '0:50',
    note: 'sparse brooding bass feel', progress: 0.30,
  },
  {
    id: 'c2', trackId: 'vocal', instrument: 'vocal',
    stemLabel: 'Vocal · Chorus Ref', startTime: '1:25', endTime: '1:55',
    note: 'Layering vocal harmonies for depth', progress: 0.15,
  },
]

const DEFAULT_SELECTIONS: Record<string, TrackSelection> = {
  vocal: { startPct: 0.26, endPct: 0.41 },
  bass:  { startPct: 0.10, endPct: 0.22 },
  drums: { startPct: 0.45, endPct: 0.55 },
}

// ─── Web Audio API waveform synthesis ─────────────────────────────────────────

async function generateStemPeaks(
  instrument: InstrumentKey,
  numPeaks: number,
): Promise<number[]> {
  try {
    const sampleRate = 22050
    const duration = 8
    const ctx = new OfflineAudioContext(1, sampleRate * duration, sampleRate)
    const osc = ctx.createOscillator()
    const gainNode = ctx.createGain()

    switch (instrument) {
      case 'vocal':
        osc.type = 'sine'
        osc.frequency.setValueAtTime(220, 0)
        osc.frequency.linearRampToValueAtTime(370, 2)
        osc.frequency.linearRampToValueAtTime(247, 4)
        osc.frequency.linearRampToValueAtTime(440, 6)
        gainNode.gain.setValueAtTime(0, 0)
        gainNode.gain.linearRampToValueAtTime(0.85, 0.4)
        gainNode.gain.setValueAtTime(0.65, 3)
        gainNode.gain.linearRampToValueAtTime(0.95, 5.5)
        break
      case 'bass':
        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(55, 0)
        osc.frequency.setValueAtTime(73, 2)
        osc.frequency.setValueAtTime(55, 4)
        gainNode.gain.setValueAtTime(0.75, 0)
        break
      case 'drums':
        osc.type = 'square'
        osc.frequency.setValueAtTime(80, 0)
        for (let i = 0; i < 32; i++) {
          const t = i * (duration / 32)
          gainNode.gain.setValueAtTime(i % 4 === 0 ? 0.95 : i % 2 === 0 ? 0.4 : 0.15, t)
          gainNode.gain.linearRampToValueAtTime(0.03, t + 0.04)
        }
        break
      case 'keys':
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(261.63, 0)
        osc.frequency.setValueAtTime(329.63, 2)
        osc.frequency.setValueAtTime(392, 4)
        osc.frequency.setValueAtTime(261.63, 6)
        gainNode.gain.setValueAtTime(0.6, 0)
        break
      case 'guitar':
        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(196, 0)
        osc.frequency.setValueAtTime(246.94, 2)
        osc.frequency.setValueAtTime(220, 5)
        gainNode.gain.setValueAtTime(0.55, 0)
        break
    }

    osc.connect(gainNode)
    gainNode.connect(ctx.destination)
    osc.start(0)
    osc.stop(duration)

    const buffer = await ctx.startRendering()
    const raw = buffer.getChannelData(0)
    const blockSize = Math.floor(raw.length / numPeaks)
    const peaks: number[] = []

    for (let i = 0; i < numPeaks; i++) {
      let max = 0
      const base = i * blockSize
      for (let j = 0; j < blockSize; j++) {
        const v = Math.abs(raw[base + j] ?? 0)
        if (v > max) max = v
      }
      // Per-instrument character noise for realistic density
      const noise =
        instrument === 'drums'
          ? Math.random() > 0.72 ? 0.85 : 0.08
          : Math.random() * 0.18
      peaks.push(Math.min(1, max + noise))
    }

    return peaks
  } catch {
    // Fallback synthetic peaks (no OfflineAudioContext available)
    return Array.from({ length: numPeaks }, (_, i) => {
      const t = i / numPeaks
      return 0.25 + 0.55 * Math.abs(Math.sin(t * Math.PI * 9 + Math.random() * 0.4))
    })
  }
}

// ─── TrackCanvas ──────────────────────────────────────────────────────────────

interface TrackCanvasProps {
  peaks: number[]
  color: string
  selection: TrackSelection | null
  muted: boolean
  soloed: boolean
  isSoloing: boolean
  onSelectionChange: (sel: TrackSelection | null) => void
}

function TrackCanvas({
  peaks, color, selection, muted, soloed, isSoloing, onSelectionChange,
}: TrackCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<{ startPct: number } | null>(null)
  const isActive = !muted && (!isSoloing || soloed)
  const displayColor = isActive ? color : EMBRY.dim

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    const W = c.width, H = c.height

    ctx.clearRect(0, 0, W, H)

    // Coloured background tint
    ctx.fillStyle = `${displayColor}18`
    ctx.fillRect(0, 0, W, H)

    // High-density waveform density pattern (vertical stripes)
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    for (let x = 0; x < W; x += 4) ctx.fillRect(x, 0, 1, H)

    // Waveform bars
    if (peaks.length > 0) {
      const midY = H / 2
      const barW = W / peaks.length
      for (let i = 0; i < peaks.length; i++) {
        const peak = peaks[i] ?? 0
        const x = i * barW
        const h = Math.max(2, peak * midY * 0.88)
        ctx.fillStyle = `${displayColor}CC`
        ctx.fillRect(x, midY - h, Math.max(1, barW - 0.5), h)
        ctx.fillStyle = `${displayColor}44`
        ctx.fillRect(x, midY, Math.max(1, barW - 0.5), h * 0.55)
      }
    }

    // Selection region with drag handles
    if (selection && selection.endPct > selection.startPct) {
      const selX = selection.startPct * W
      const selW = (selection.endPct - selection.startPct) * W
      ctx.fillStyle = 'rgba(255,255,255,0.14)'
      ctx.fillRect(selX, 0, selW, H)
      ctx.strokeStyle = 'rgba(255,255,255,0.88)'
      ctx.lineWidth = 2.5
      ctx.strokeRect(selX, 0, selW, H)
      // Drag handles
      const hW = 6, hH = 28, hY = H / 2 - hH / 2
      ctx.fillStyle = 'white'
      ctx.beginPath(); ctx.roundRect(selX - hW / 2, hY, hW, hH, 3); ctx.fill()
      ctx.beginPath(); ctx.roundRect(selX + selW - hW / 2, hY, hW, hH, 3); ctx.fill()
    }

    // Muted overlay
    if (muted) {
      ctx.fillStyle = 'rgba(0,0,0,0.52)'
      ctx.fillRect(0, 0, W, H)
    }
  }, [peaks, displayColor, selection, muted])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const startPct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    dragRef.current = { startPct }
    onSelectionChange({ startPct, endPct: startPct })

    const handleMove = (me: MouseEvent) => {
      if (!dragRef.current) return
      const curPct = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width))
      const a = dragRef.current.startPct
      onSelectionChange({ startPct: Math.min(a, curPct), endPct: Math.max(a, curPct) })
    }
    const handleUp = () => {
      dragRef.current = null
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
    }
    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [onSelectionChange])

  return (
    <div style={{ flex: 1, position: 'relative', cursor: 'crosshair', borderRadius: 8, overflow: 'hidden' }}
      onMouseDown={handleMouseDown}>
      <canvas
        ref={canvasRef}
        width={800}
        height={56}
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </div>
  )
}

// ─── TrackHeader ──────────────────────────────────────────────────────────────

interface TrackHeaderProps {
  track: StemTrack
  color: string
  onToggleMute: () => void
  onToggleSolo: () => void
}

function TrackHeader({ track, color, onToggleMute, onToggleSolo }: TrackHeaderProps) {
  return (
    <div style={{
      height: 80, padding: '0 12px',
      display: 'flex', alignItems: 'center', gap: 10,
      borderBottom: '1px solid rgba(255,255,255,0.04)',
      backgroundColor: '#1a1a1a', flexShrink: 0,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 8, flexShrink: 0,
        backgroundColor: 'rgba(0,0,0,0.4)',
        border: '1px solid rgba(255,255,255,0.05)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
      }}>
        {track.emoji}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, overflow: 'hidden' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: EMBRY.white, whiteSpace: 'nowrap',
          overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {track.name}
        </span>
        <div style={{ display: 'flex', gap: 4 }}>
          <button onClick={onToggleSolo} style={{
            width: 22, height: 22, borderRadius: 4, border: 'none', cursor: 'pointer',
            backgroundColor: track.soloed ? color : 'rgba(255,255,255,0.08)',
            color: track.soloed ? '#000' : EMBRY.dim,
            fontSize: 9, fontWeight: 700, transition: 'all 0.15s',
          }}>S</button>
          <button onClick={onToggleMute} style={{
            width: 22, height: 22, borderRadius: 4, border: 'none', cursor: 'pointer',
            backgroundColor: track.muted ? EMBRY.red : 'rgba(255,255,255,0.08)',
            color: track.muted ? '#000' : EMBRY.dim,
            fontSize: 9, fontWeight: 700, transition: 'all 0.15s',
          }}>M</button>
        </div>
      </div>
    </div>
  )
}

// ─── ClipCardView ─────────────────────────────────────────────────────────────

interface ClipCardViewProps {
  clip: ClipCard
  onPlay: (id: string) => void
}

function ClipCardView({ clip, onPlay }: ClipCardViewProps) {
  const color = INSTRUMENT_COLORS[clip.instrument] ?? EMBRY.dim

  return (
    <div style={{ ...card, padding: 16, cursor: 'pointer', transition: 'border-color 0.2s' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => onPlay(clip.id)}
            style={{
              width: 36, height: 36, borderRadius: '50%', border: 'none', cursor: 'pointer',
              backgroundColor: `${color}22`, color,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 14, transition: 'all 0.15s', flexShrink: 0,
            }}
          >▶</button>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
              <div style={glowDot(color, 8)} />
              <span style={{ fontSize: 13, fontWeight: 700, color: EMBRY.white }}>{clip.stemLabel}</span>
            </div>
            <span style={{ ...label, color }}>{clip.startTime} — {clip.endTime}</span>
          </div>
        </div>
        <span style={{ color: EMBRY.dim, fontSize: 16, cursor: 'pointer', lineHeight: 1 }}>⋯</span>
      </div>

      <div style={{ height: 4, backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: 2, overflow: 'hidden', marginBottom: 8 }}>
        <div style={{
          height: '100%', width: `${clip.progress * 100}%`,
          backgroundColor: color, borderRadius: 2,
          boxShadow: `0 0 8px ${color}55`,
        }} />
      </div>

      {clip.note && (
        <p style={{ fontSize: 11, color: EMBRY.dim, fontStyle: 'italic', margin: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          "{clip.note}"
        </p>
      )}
    </div>
  )
}

// ─── StemViewer ───────────────────────────────────────────────────────────────

export function StemViewer() {
  const [tracks, setTracks] = useState<StemTrack[]>(
    INITIAL_TRACKS.map(t => ({ ...t, peaks: [] })),
  )
  const [selections, setSelections] = useState<Record<string, TrackSelection>>(DEFAULT_SELECTIONS)
  const [clips, setClips] = useState<ClipCard[]>(DEFAULT_CLIPS)
  const [viewMode, setViewMode] = useState<'Song' | 'Stems'>('Stems')
  const [isGenerating, setIsGenerating] = useState(true)
  const audioCtxRef = useRef<AudioContext | null>(null)

  // ── Generate waveforms via Web Audio API OfflineAudioContext on mount ──
  useEffect(() => {
    let cancelled = false
    async function load() {
      setIsGenerating(true)
      const results = await Promise.all(
        INITIAL_TRACKS.map(t => generateStemPeaks(t.instrument, NUM_PEAKS)),
      )
      if (!cancelled) {
        setTracks(INITIAL_TRACKS.map((t, i) => ({ ...t, peaks: results[i] ?? [] })))
        setIsGenerating(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [])

  const isSoloing = tracks.some(t => t.soloed)

  const toggleMute = useCallback((id: string) => {
    setTracks(prev => prev.map(t => t.id === id ? { ...t, muted: !t.muted } : t))
  }, [])

  const toggleSolo = useCallback((id: string) => {
    setTracks(prev => prev.map(t => t.id === id ? { ...t, soloed: !t.soloed } : t))
  }, [])

  const handleSelectionChange = useCallback((trackId: string, sel: TrackSelection | null) => {
    setSelections(prev => {
      if (!sel || sel.endPct - sel.startPct < 0.01) {
        const next = { ...prev }
        delete next[trackId]
        return next
      }
      return { ...prev, [trackId]: sel }
    })
  }, [])

  const handleAddSelections = useCallback(() => {
    const newClips: ClipCard[] = []
    for (const [trackId, sel] of Object.entries(selections)) {
      const track = tracks.find(t => t.id === trackId)
      if (!track) continue
      const startSec = Math.round(sel.startPct * SONG_TOTAL_SECS)
      const endSec = Math.round(sel.endPct * SONG_TOTAL_SECS)
      const fmt = (s: number) =>
        `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
      newClips.push({
        id: `clip-${trackId}-${Date.now()}`,
        trackId: track.id,
        instrument: track.instrument,
        stemLabel: `${track.name} · Selection`,
        startTime: fmt(startSec),
        endTime: fmt(endSec),
        note: '',
        progress: sel.startPct,
      })
    }
    if (newClips.length > 0) setClips(prev => [...prev, ...newClips])
  }, [selections, tracks])

  const handlePlay = useCallback((clipId: string) => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext()
    }
    console.info('[StemViewer] play clip', clipId)
  }, [])

  const barLabels = Array.from({ length: TOTAL_BARS }, (_, i) => i + 1)
  const selectionCount = Object.keys(selections).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden',
      backgroundColor: EMBRY.bg, fontFamily: 'Inter, system-ui, sans-serif' }}>

      {/* ── Album Art + Song Identity ──────────────────────────────────── */}
      <header style={{
        padding: '20px 32px 16px', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: '1px solid rgba(255,255,255,0.05)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          {/* Album art placeholder */}
          <div style={{
            width: 72, height: 72, borderRadius: 10, flexShrink: 0,
            backgroundColor: EMBRY.bgCard, border: `1px solid ${EMBRY.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 30, position: 'relative',
          }}>
            🎵
            <div style={{ position: 'absolute', inset: 0, borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.1)' }} />
          </div>

          {/* Identity text */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <h1 style={{ ...heading, fontSize: 28, letterSpacing: '-0.03em', margin: 0 }}>
                {SONG.title}
              </h1>
              <span style={{
                ...label, fontSize: 9, padding: '2px 8px', borderRadius: 4,
                backgroundColor: EMBRY.bgCard, border: '1px solid rgba(255,255,255,0.08)',
              }}>Reference</span>
            </div>
            <p style={{ margin: 0, fontSize: 14, color: EMBRY.white, opacity: 0.9, fontWeight: 500 }}>
              {SONG.artist} · {SONG.album} {SONG.year} · {SONG.bpm} BPM · {SONG.key}
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: EMBRY.dim }}>
              Select reference clips for{' '}
              <span style={{ color: EMBRY.accent, fontStyle: 'italic' }}>{SONG.sessionName}</span>{' '}
              session
            </p>
          </div>
        </div>

        {/* Song / Stems toggle */}
        <div style={{ display: 'flex', backgroundColor: EMBRY.bgCard, borderRadius: 8, padding: 4 }}>
          {(['Song', 'Stems'] as const).map(mode => (
            <button key={mode} onClick={() => setViewMode(mode)} style={{
              padding: '6px 20px', borderRadius: 6, border: 'none', cursor: 'pointer',
              fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase',
              transition: 'all 0.15s',
              backgroundColor: viewMode === mode ? EMBRY.bgPanel : 'transparent',
              color: viewMode === mode ? EMBRY.accent : EMBRY.dim,
            }}>{mode}</button>
          ))}
        </div>
      </header>

      {/* ── DAW Timeline ──────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>

        {/* Timeline ruler */}
        <div style={{ height: 32, display: 'flex', alignItems: 'stretch', flexShrink: 0,
          borderBottom: '1px solid rgba(255,255,255,0.07)', backgroundColor: EMBRY.bg }}>
          <div style={{ width: 192, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', alignItems: 'center', padding: '0 16px' }}>
            <span style={{ ...label, color: EMBRY.accent }}>Tracks</span>
            {isGenerating && (
              <span style={{ ...label, color: EMBRY.dim, marginLeft: 8, fontSize: 8 }}>analyzing…</span>
            )}
          </div>
          <div style={{ flex: 1, display: 'flex', padding: '0 16px' }}>
            {barLabels.map(bar => (
              <div key={bar} style={{ flex: 1, display: 'flex', alignItems: 'center',
                borderLeft: '1px solid rgba(255,255,255,0.07)', paddingLeft: 4 }}>
                <span style={{ ...label, fontSize: 9, opacity: 0.5 }}>{bar}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Track rows */}
        <div style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>

          {/* Track headers sidebar */}
          <div style={{ width: 192, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.07)', zIndex: 10, overflowY: 'auto' }}>
            {tracks.map(track => (
              <TrackHeader
                key={track.id}
                track={track}
                color={INSTRUMENT_COLORS[track.instrument] ?? EMBRY.dim}
                onToggleMute={() => toggleMute(track.id)}
                onToggleSolo={() => toggleSolo(track.id)}
              />
            ))}
          </div>

          {/* Waveform canvas area */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden' }}>

            {/* Vertical grid lines */}
            <div style={{ position: 'absolute', inset: 0, display: 'flex',
              pointerEvents: 'none', zIndex: 1, padding: '0 16px' }}>
              {barLabels.map(bar => (
                <div key={bar} style={{ flex: 1, borderLeft: '1px solid rgba(255,255,255,0.03)' }} />
              ))}
            </div>

            {/* Per-track waveform rows */}
            {tracks.map(track => (
              <div key={track.id} style={{
                height: 80, display: 'flex', alignItems: 'center', padding: '0 16px',
                borderBottom: '1px solid rgba(255,255,255,0.04)',
                position: 'relative', zIndex: 2,
              }}>
                {isGenerating && track.peaks.length === 0 ? (
                  <div style={{
                    flex: 1, height: 56, borderRadius: 8,
                    backgroundColor: `${INSTRUMENT_COLORS[track.instrument] ?? EMBRY.dim}15`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <span style={{ ...label, color: EMBRY.dim, fontSize: 9 }}>Analyzing audio…</span>
                  </div>
                ) : (
                  <TrackCanvas
                    peaks={track.peaks}
                    color={INSTRUMENT_COLORS[track.instrument] ?? EMBRY.dim}
                    selection={selections[track.id] ?? null}
                    muted={track.muted}
                    soloed={track.soloed}
                    isSoloing={isSoloing}
                    onSelectionChange={sel => handleSelectionChange(track.id, sel)}
                  />
                )}
              </div>
            ))}

            {/* Playhead */}
            <div style={{
              position: 'absolute', top: 0, bottom: 0, left: 'calc(16px + 35% * (100% - 32px) / 100%)',
              width: 2, backgroundColor: 'white', zIndex: 50, pointerEvents: 'none',
              boxShadow: '0 0 14px rgba(255,255,255,0.85)',
            }}>
              <div style={{ position: 'absolute', top: -2, left: -5, width: 12, height: 10,
                backgroundColor: 'white', borderRadius: '0 0 3px 3px' }} />
              <div style={{ position: 'absolute', inset: 0,
                backgroundColor: 'rgba(255,60,60,0.5)' }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Selected Clips ─────────────────────────────────────────────── */}
      <section style={{
        padding: '16px 32px 20px', flexShrink: 0,
        borderTop: '1px solid rgba(255,255,255,0.05)',
        maxHeight: 230, overflow: 'auto',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={label}>Selected Reference Clips</span>
            <span style={{ ...label, color: EMBRY.accent }}>{clips.length}</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {selectionCount > 0 && (
              <button onClick={handleAddSelections} style={{
                padding: '4px 14px', borderRadius: 6, border: `1px solid ${EMBRY.accent}44`,
                backgroundColor: `${EMBRY.accent}18`, color: EMBRY.accent,
                cursor: 'pointer', fontSize: 10, fontWeight: 700,
                letterSpacing: '0.06em', textTransform: 'uppercase',
              }}>
                + Add {selectionCount} Selection{selectionCount > 1 ? 's' : ''}
              </button>
            )}
            <button style={{
              padding: '4px 14px', borderRadius: 6, border: 'none',
              backgroundColor: 'transparent', color: EMBRY.accent,
              cursor: 'pointer', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.06em', textTransform: 'uppercase',
            }}>
              ↑ Export Reference Pack
            </button>
          </div>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 14,
        }}>
          {clips.map(clip => (
            <ClipCardView key={clip.id} clip={clip} onPlay={handlePlay} />
          ))}
          {/* Empty add slot */}
          <div style={{
            border: '1px dashed rgba(255,255,255,0.1)', borderRadius: 12,
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: 16, opacity: 0.35,
            cursor: 'pointer', minHeight: 80,
          }}>
            <span style={{ fontSize: 22, marginBottom: 6 }}>+</span>
            <span style={{ ...label, fontSize: 9 }}>Add Reference Clip</span>
          </div>
        </div>
      </section>
    </div>
  )
}

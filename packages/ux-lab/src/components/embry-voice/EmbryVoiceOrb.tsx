import { useEffect, useRef } from 'react'
import { useEmbryOrbContainerSize } from '../../hooks/useEmbryOrbContainerSize'
import { useEmbryPlaybackAudioBands, type EmbryPlaybackAudioBands } from '../../hooks/useEmbryPlaybackAudioLevel'
import { resolveEmbryVisualState } from './embryOrbState'
import type { IdentitySignal } from './identityNodeState'

export type EmbryVoiceStatus = 'off' | 'idle' | 'listening' | 'processing' | 'speaking' | 'error'
export type EmbryState = 'idle' | 'listening' | 'thinking' | 'synthesizing' | 'speaking'

type FlowParticle = {
  x: number
  y: number
  homeX: number
  homeY: number
  vx: number
  vy: number
  speed: number
  seed: number
  fieldAffinity: number
  brightness: number
}

type EngineState = {
  visualState: EmbryState
  reducedMotion: boolean
  audio: EmbryPlaybackAudioBands
}

const MICRO_CANVAS_SIZE = 400
const PARTICLE_COUNT = 12000
const BACKGROUND = '#0c0c0e'
const SILENT_AUDIO: EmbryPlaybackAudioBands = { level: 0, bass: 0, mid: 0, treble: 0 }

function statePalette(visualState: EmbryState): { base: [number, number, number]; hot: [number, number, number] } {
  switch (visualState) {
    case 'speaking':
      return { base: [80, 255, 180], hot: [190, 255, 225] }
    case 'synthesizing':
      return { base: [180, 100, 255], hot: [230, 205, 255] }
    case 'thinking':
      return { base: [80, 160, 255], hot: [180, 220, 255] }
    case 'listening':
      return { base: [96, 165, 250], hot: [150, 205, 245] }
    case 'idle':
    default:
      return { base: [0, 200, 180], hot: [130, 235, 220] }
  }
}

function createMask(): Float32Array {
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = MICRO_CANVAS_SIZE
  maskCanvas.height = MICRO_CANVAS_SIZE
  const ctx = maskCanvas.getContext('2d')
  const mask = new Float32Array(MICRO_CANVAS_SIZE * MICRO_CANVAS_SIZE)
  if (!ctx) return mask

  ctx.fillStyle = '#ffffff'
  ctx.font = '900 240px Inter, system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('e', MICRO_CANVAS_SIZE / 2, MICRO_CANVAS_SIZE / 2)

  const data = ctx.getImageData(0, 0, MICRO_CANVAS_SIZE, MICRO_CANVAS_SIZE).data
  for (let index = 0; index < data.length; index += 4) {
    mask[index / 4] = data[index + 3] / 255
  }
  return mask
}

function createParticles(): FlowParticle[] {
  const center = MICRO_CANVAS_SIZE / 2
  const radius = 170
  return Array.from({ length: PARTICLE_COUNT }, () => {
    const angle = Math.random() * Math.PI * 2
    const distance = Math.sqrt(Math.random()) * radius
    const x = center + Math.cos(angle) * distance
    const y = center + Math.sin(angle) * distance
    return {
      x,
      y,
      homeX: x,
      homeY: y,
      vx: 0,
      vy: 0,
      speed: Math.random() * 0.3 + 0.1,
      seed: Math.random() * 1000,
      fieldAffinity: Math.random(),
      brightness: 0,
    }
  })
}

function maskProbability(mask: Float32Array, x: number, y: number): number {
  const px = Math.floor(x)
  const py = Math.floor(y)
  if (px < 0 || px >= MICRO_CANVAS_SIZE || py < 0 || py >= MICRO_CANVAS_SIZE) return 0
  return mask[py * MICRO_CANVAS_SIZE + px]
}

function drawFrame(
  ctx: CanvasRenderingContext2D,
  particles: FlowParticle[],
  mask: Float32Array,
  engineState: EngineState,
  time: number,
): void {
  ctx.globalCompositeOperation = 'source-over'
  ctx.fillStyle = 'rgba(12, 12, 14, 0.38)'
  ctx.fillRect(0, 0, MICRO_CANVAS_SIZE, MICRO_CANVAS_SIZE)

  const centerX = MICRO_CANVAS_SIZE / 2
  const centerY = MICRO_CANVAS_SIZE / 2
  const active = engineState.visualState !== 'idle'
  const speaking = engineState.visualState === 'speaking'
  const palette = statePalette(engineState.visualState)
  const audioLevel = speaking ? engineState.audio.level : 0
  const forceRadius = 170

  ctx.globalCompositeOperation = 'lighter'
  for (let index = 0; index < particles.length; index += 1) {
    const particle = particles[index]
    const noise = Math.sin(particle.x * 0.01 + time + particle.seed)
      * Math.cos(particle.y * 0.01 + time)
      + Math.sin(particle.x * 0.02 - time + particle.seed) * 0.5
    const angle = noise * Math.PI * 4

    if (!engineState.reducedMotion) {
      const fieldForce = 0.045 + (active ? 0.025 : 0) + engineState.audio.bass * 0.05
      const jitter = 0.04 + engineState.audio.treble * 0.1
      particle.vx += Math.cos(angle) * fieldForce
      particle.vy += Math.sin(angle) * fieldForce
      particle.vx += (Math.random() - 0.5) * jitter
      particle.vy += (Math.random() - 0.5) * jitter
      particle.vx += (particle.homeX - particle.x) * (0.00045 + engineState.audio.mid * 0.00025)
      particle.vy += (particle.homeY - particle.y) * (0.00045 + engineState.audio.mid * 0.00025)
    }
    particle.vx *= speaking ? 0.93 : 0.9
    particle.vy *= speaking ? 0.93 : 0.9
    particle.x += particle.vx * particle.speed
    particle.y += particle.vy * particle.speed

    const dx = particle.x - centerX
    const dy = particle.y - centerY
    const distanceSquared = dx * dx + dy * dy
    if (distanceSquared > forceRadius * forceRadius) {
      particle.vx -= dx * 0.0013
      particle.vy -= dy * 0.0013
    }

    const field = active ? maskProbability(mask, particle.x, particle.y) : 0
    const ignites = field > 0 && particle.fieldAffinity < field * 0.22
    if (ignites) {
      const targetBrightness = 0.035 + field * 0.085 + audioLevel * 0.08
      particle.brightness += (targetBrightness - particle.brightness) * 0.06
      ctx.fillStyle = `rgba(${palette.hot[0]}, ${palette.hot[1]}, ${palette.hot[2]}, ${particle.brightness})`
    } else {
      particle.brightness *= 0.86
      const alpha = 0.026 + (active ? 0.012 : 0) + audioLevel * 0.045
      ctx.fillStyle = `rgba(${palette.base[0]}, ${palette.base[1]}, ${palette.base[2]}, ${alpha})`
    }
    ctx.fillRect(particle.x, particle.y, 1, 1)
  }

  ctx.globalCompositeOperation = 'source-over'
}

export function EmbryVoiceOrb({
  voiceStatus,
  isStreaming,
  tone,
  signal,
  size: sizeProp = 96,
  surface = 'rail',
}: {
  voiceStatus?: EmbryVoiceStatus
  isStreaming?: boolean
  audioLevel?: number
  tone?: string
  signal?: IdentitySignal
  size?: number
  surface?: 'rail' | 'header'
  fillCanvas?: boolean
  letterAsParticles?: boolean
}): JSX.Element {
  const railBoost = surface === 'rail'
  const { ref: containerRef, size: observedSize } = useEmbryOrbContainerSize(sizeProp, { min: 96, max: 240 })
  const size = railBoost ? observedSize : sizeProp
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const particlesRef = useRef<FlowParticle[]>([])
  const maskRef = useRef<Float32Array | null>(null)
  const frameRef = useRef(0)
  const timeRef = useRef(0)
  const stateRef = useRef<EngineState>({ visualState: 'idle', reducedMotion: false, audio: SILENT_AUDIO })

  const visualState: EmbryState = voiceStatus === 'off'
    ? 'idle'
    : resolveEmbryVisualState({ voiceStatus, isStreaming, tone, signal })
  const reducedMotion = false
  const audio = useEmbryPlaybackAudioBands(visualState === 'speaking')

  useEffect(() => {
    stateRef.current = { visualState, reducedMotion, audio }
  }, [audio, reducedMotion, visualState])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return
    ctx.fillStyle = BACKGROUND
    ctx.fillRect(0, 0, MICRO_CANVAS_SIZE, MICRO_CANVAS_SIZE)

    maskRef.current = createMask()
    particlesRef.current = createParticles()

    const render = () => {
      timeRef.current += 0.004
      const mask = maskRef.current ?? createMask()
      drawFrame(ctx, particlesRef.current, mask, stateRef.current, timeRef.current)
      frameRef.current = window.requestAnimationFrame(render)
    }

    render()
    return () => window.cancelAnimationFrame(frameRef.current)
  }, [])

  return (
    <div
      ref={railBoost ? containerRef : undefined}
      data-qid="embry-voice:presence-orb"
      data-embry-state={visualState}
      data-embry-tone={tone ?? ''}
      data-embry-signal={signal ?? ''}
      data-embry-audio-level={audio.level.toFixed(3)}
      data-embry-audio-bass={audio.bass.toFixed(3)}
      data-embry-audio-mid={audio.mid.toFixed(3)}
      data-embry-audio-treble={audio.treble.toFixed(3)}
      style={{
        lineHeight: 0,
        width: railBoost ? '100%' : size,
        height: railBoost ? '100%' : size,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          overflow: 'hidden',
          border: '1px solid rgba(96, 165, 250, 0.1)',
          boxShadow: 'inset 0 0 40px rgba(96, 165, 250, 0.05)',
        }}
      >
        <canvas
          ref={canvasRef}
          width={MICRO_CANVAS_SIZE}
          height={MICRO_CANVAS_SIZE}
          className="embry-voice-orb"
          aria-label={`Embry ${visualState}`}
          role="img"
          style={{ width: '100%', height: '100%', filter: 'blur(0.5px) contrast(1.2) brightness(1.1)' }}
        />
      </div>
    </div>
  )
}

export default EmbryVoiceOrb

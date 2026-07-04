import { EmbryThinkingIcon, type EmbryState } from '@embry/logo'
import { useEmbryOrbContainerSize } from '../../hooks/useEmbryOrbContainerSize'
import { useEmbryPlaybackAudioLevel } from '../../hooks/useEmbryPlaybackAudioLevel'
import { useReducedMotion } from '../../hooks/useReducedMotion'
import { resolveEmbryVisualState } from './embryOrbState'
import type { IdentitySignal } from './identityNodeState'
import { toneModulationFor } from './embryToneModulation'

export type EmbryVoiceStatus = 'off' | 'idle' | 'listening' | 'processing' | 'speaking' | 'error'

export function deriveEmbryVoiceStatus({
  voiceEnabled,
  replayPhase,
}: {
  voiceEnabled: boolean
  replayPhase?: 'idle' | 'request' | 'thinking' | 'response' | 'complete' | 'interrupted'
}): EmbryVoiceStatus {
  if (!voiceEnabled) return 'off'
  if (replayPhase === 'thinking') return 'processing'
  if (replayPhase === 'response') return 'speaking'
  return 'idle'
}

/**
 * Reactive embry-logo mount. React owns DOM; d3-force owns particle math.
 */
export function EmbryVoiceOrb({
  voiceStatus,
  isStreaming,
  audioLevel: audioLevelProp,
  tone,
  signal,
  size: sizeProp = 96,
  surface = 'rail',
  fillCanvas = false,
  letterAsParticles = false,
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
  const reducedMotion = useReducedMotion()

  const state: EmbryState = voiceStatus === 'off'
    ? 'idle'
    : resolveEmbryVisualState({ voiceStatus, isStreaming, tone, signal })

  const playbackLevel = useEmbryPlaybackAudioLevel(
    audioLevelProp === undefined && state === 'speaking',
  )
  const audioLevel = audioLevelProp ?? (state === 'speaking' ? playbackLevel : undefined)
  const toneMod = toneModulationFor(tone)

  return (
    <div
      ref={railBoost ? containerRef : undefined}
      data-qid="embry-voice:presence-orb"
      data-embry-state={state}
      data-embry-tone={tone ?? ''}
      data-embry-signal={signal ?? ''}
      style={{ lineHeight: 0, width: railBoost ? '100%' : size, height: railBoost ? '100%' : size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <EmbryThinkingIcon
        size={size}
        state={state}
        audioLevel={audioLevel}
        distance="close"
        transparentBackground
        showStars={false}
        particleDensity={railBoost ? 0.62 : 0.45}
        particleAlphaScale={toneMod.particleAlphaScale ?? (railBoost ? 0.78 : 0.5)}
        particleBlendToBackground={railBoost ? 0.06 : 0.28}
        glowAlphaScale={toneMod.glowAlphaScale ?? (railBoost ? 0.55 : 0.35)}
        glowBlendToBackground={0.05}
        letterScale={fillCanvas ? 1.7 : 1.02}
        particleOrbitScale={(toneMod.particleOrbitScale ?? (railBoost ? 0.78 : 0.72)) * (fillCanvas ? 1.4 : 1)}
        ringWidthScale={railBoost ? 0.58 : 0.52}
        ringAlphaScale={toneMod.ringAlphaScale ?? (railBoost ? 0.85 : 0.78)}
        breathAmpScale={(toneMod.breathAmpScale ?? 1) * (railBoost ? 1.6 : 1)}
        breathHzScale={(toneMod.breathHzScale ?? 1) * (railBoost ? 0.65 : 1)}
        speakingRippleCount={toneMod.speakingRippleCount ?? (railBoost ? 3 : 2)}
        ringScale={fillCanvas ? 1.5 : 1}
        letterMorphOnTransition={!reducedMotion}
        hypnoticMode={railBoost && !reducedMotion}
        className="embry-voice-orb"
        aria-label={`Embry ${state}`}
      />
    </div>
  )
}

export default EmbryVoiceOrb

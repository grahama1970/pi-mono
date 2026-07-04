import type { EmbryState } from '@embry/logo'
import { resolveEmbryVisualState } from './embryOrbState'
import type { EmbryVoiceStatus } from './EmbryVoiceOrb'

export type IdentitySignal = 'ready' | 'busy' | 'clarify' | 'speaking' | 'off'

export interface IdentityNodeViewModel {
  visualState: EmbryState
  signal: IdentitySignal
  statusLabel: string
  modeLabel: string
  accentColor: string
  pulse: boolean
}

/** Logo Lab canonical hues — synced with @embry/logo STATE_COLORS particles */
const EMBRY_STATE_ACCENT: Record<EmbryState, string> = {
  idle: '#00c8b4',
  listening: '#00cfff',
  thinking: '#50a0ff',
  synthesizing: '#b464ff',
  speaking: '#50ffb4',
}

const SIGNAL_ACCENT: Record<IdentitySignal, string> = {
  ready: '#00c8b4',
  busy: '#fbbf24',
  clarify: '#60a5fa',
  speaking: '#50ffb4',
  off: '#52525b',
}

function statusLabelFor(visualState: EmbryState, signal: IdentitySignal): string {
  if (signal === 'off') return 'OFFLINE'
  if (signal === 'clarify') return 'CLARIFYING'
  switch (visualState) {
    case 'idle': return 'READY'
    case 'listening': return 'LISTENING'
    case 'thinking': return 'REASONING'
    case 'synthesizing': return 'SYNTHESIZING'
    case 'speaking': return 'SPEAKING'
    default: return 'READY'
  }
}

function signalFor(
  visualState: EmbryState,
  voiceStatus: EmbryVoiceStatus | undefined,
  tone?: string,
): IdentitySignal {
  if (voiceStatus === 'off') return 'off'
  if (tone === 'identity_clarification' || tone?.includes('clarif')) return 'clarify'
  if (visualState === 'speaking') return 'speaking'
  if (visualState === 'thinking' || visualState === 'synthesizing' || visualState === 'listening') return 'busy'
  return 'ready'
}

function accentFor(signal: IdentitySignal, visualState: EmbryState): string {
  if (signal === 'clarify') return SIGNAL_ACCENT.clarify
  if (signal === 'busy') return EMBRY_STATE_ACCENT[visualState]
  return SIGNAL_ACCENT[signal]
}

export function buildIdentityNodeViewModel({
  voiceStatus,
  isStreaming,
  tone,
}: {
  voiceStatus?: EmbryVoiceStatus
  isStreaming?: boolean
  tone?: string
  speaker?: string
}): IdentityNodeViewModel {
  const visualState = voiceStatus === 'off'
    ? 'idle'
    : resolveEmbryVisualState({ voiceStatus, isStreaming, tone })

  const signal = signalFor(visualState, voiceStatus, tone)
  const statusLabel = statusLabelFor(visualState, signal)

  return {
    visualState,
    signal,
    statusLabel,
    modeLabel: tone ? tone.replaceAll('_', ' ').toUpperCase() : '',
    accentColor: accentFor(signal, visualState),
    pulse: signal === 'busy' || signal === 'clarify' || signal === 'speaking',
  }
}

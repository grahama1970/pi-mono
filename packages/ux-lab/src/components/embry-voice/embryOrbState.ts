import type { EmbryState } from '@embry/logo'
import type { EmbryVoiceStatus } from './EmbryVoiceOrb'
import type { IdentitySignal } from './identityNodeState'

/**
 * Maps live voice telemetry + Chatterbox tone to the embry-logo visual state.
 * Tone can elevate idle into an active-looking state (e.g. clarify → listening).
 */
export function resolveEmbryVisualState({
  voiceStatus,
  isStreaming,
  tone,
  signal,
}: {
  voiceStatus?: EmbryVoiceStatus
  isStreaming?: boolean
  tone?: string
  signal?: IdentitySignal
}): EmbryState {
  if (voiceStatus === 'speaking') return 'speaking'
  if (voiceStatus === 'listening') return 'listening'
  if (voiceStatus === 'processing') return 'synthesizing'
  if (isStreaming) return 'thinking'

  if (signal === 'clarify' || tone === 'identity_clarification') return 'listening'
  if (tone === 'one_at_a_time_interrupt') return 'listening'
  if (tone === 'memory_confident') return 'idle'

  return 'idle'
}

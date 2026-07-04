/** Secondary visual modulation from Chatterbox receipt tone — hue stays on EmbryState. */
export interface EmbryToneModulation {
  particleAlphaScale?: number
  glowAlphaScale?: number
  breathAmpScale?: number
  breathHzScale?: number
  particleOrbitScale?: number
  speakingRippleCount?: number
  ringAlphaScale?: number
}

export function toneModulationFor(tone?: string): EmbryToneModulation {
  switch (tone) {
    case 'memory_confident':
      return {
        particleOrbitScale: 0.68,
        glowAlphaScale: 0.38,
        breathAmpScale: 0.85,
        ringAlphaScale: 0.68,
      }
    case 'identity_clarification':
      return {
        glowAlphaScale: 0.32,
        breathHzScale: 0.75,
        breathAmpScale: 0.7,
        particleAlphaScale: 0.42,
      }
    case 'grief_safe':
      return {
        particleAlphaScale: 0.38,
        glowAlphaScale: 0.28,
        breathAmpScale: 0.6,
        breathHzScale: 0.7,
      }
    case 'one_at_a_time_interrupt':
      return {
        speakingRippleCount: 3,
        breathHzScale: 1.25,
        breathAmpScale: 1.15,
        ringAlphaScale: 0.78,
      }
    default:
      return {}
  }
}

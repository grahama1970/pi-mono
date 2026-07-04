import { useEffect, useRef, useState } from 'react'

type AudioAnalyserEntry = {
  ctx: AudioContext
  analyser: AnalyserNode
}

const analyserCache = new WeakMap<HTMLMediaElement, AudioAnalyserEntry>()

function analyserFor(audio: HTMLMediaElement): AudioAnalyserEntry {
  let entry = analyserCache.get(audio)
  if (!entry) {
    const ctx = new AudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.75
    const source = ctx.createMediaElementSource(audio)
    source.connect(analyser)
    analyser.connect(ctx.destination)
    entry = { ctx, analyser }
    analyserCache.set(audio, entry)
  }
  if (entry.ctx.state === 'suspended') void entry.ctx.resume()
  return entry
}

function playingSessionAudio(): HTMLAudioElement | undefined {
  return Array.from(document.querySelectorAll<HTMLAudioElement>('[data-embry-session-audio="true"]')).find(
    (audio) => !audio.paused && !audio.ended && audio.currentTime > 0,
  )
}

function rmsFromAnalyser(analyser: AnalyserNode): number {
  const data = new Uint8Array(analyser.frequencyBinCount)
  analyser.getByteFrequencyData(data)
  let sum = 0
  for (let i = 0; i < data.length; i += 1) sum += data[i]
  return Math.min(1, (sum / data.length / 255) * 1.8)
}

export function useEmbryPlaybackAudioLevel(enabled = true): number {
  const [level, setLevel] = useState(0)
  const rafRef = useRef(0)

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setLevel(0)
      return
    }

    const tick = () => {
      const playing = playingSessionAudio()
      setLevel(playing ? rmsFromAnalyser(analyserFor(playing).analyser) : 0)
      rafRef.current = requestAnimationFrame(tick)
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [enabled])

  return level
}

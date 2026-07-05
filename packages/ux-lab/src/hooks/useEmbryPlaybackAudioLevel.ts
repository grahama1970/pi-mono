import { useEffect, useRef, useState } from "react";

type AudioAnalyserEntry = {
	ctx: AudioContext;
	analyser: AnalyserNode;
};

export type EmbryPlaybackAudioBands = {
	level: number;
	bass: number;
	mid: number;
	treble: number;
};

const analyserCache = new WeakMap<HTMLMediaElement, AudioAnalyserEntry>();

function analyserFor(audio: HTMLMediaElement): AudioAnalyserEntry {
	let entry = analyserCache.get(audio);
	if (!entry) {
		const ctx = new AudioContext();
		const analyser = ctx.createAnalyser();
		analyser.fftSize = 256;
		analyser.smoothingTimeConstant = 0.75;
		const source = ctx.createMediaElementSource(audio);
		source.connect(analyser);
		analyser.connect(ctx.destination);
		entry = { ctx, analyser };
		analyserCache.set(audio, entry);
	}
	if (entry.ctx.state === "suspended") void entry.ctx.resume();
	return entry;
}

function playingSessionAudio(): HTMLAudioElement | undefined {
	return Array.from(document.querySelectorAll<HTMLAudioElement>('[data-embry-session-audio="true"]')).find(
		(audio) => !audio.paused && !audio.ended && audio.currentTime > 0,
	);
}

function averageRange(data: Uint8Array, start: number, end: number): number {
	let sum = 0;
	const safeStart = Math.max(0, Math.min(data.length, start));
	const safeEnd = Math.max(safeStart + 1, Math.min(data.length, end));
	for (let i = safeStart; i < safeEnd; i += 1) sum += data[i];
	return sum / (safeEnd - safeStart) / 255;
}

function bandsFromAnalyser(analyser: AnalyserNode): EmbryPlaybackAudioBands {
	const data = new Uint8Array(analyser.frequencyBinCount);
	analyser.getByteFrequencyData(data);
	const level = Math.min(1, averageRange(data, 0, data.length) * 1.8);
	return {
		level,
		bass: Math.min(1, averageRange(data, 0, 8) * 2.1),
		mid: Math.min(1, averageRange(data, 8, 36) * 1.9),
		treble: Math.min(1, averageRange(data, 36, data.length) * 2.4),
	};
}

const silentBands: EmbryPlaybackAudioBands = { level: 0, bass: 0, mid: 0, treble: 0 };

export function useEmbryPlaybackAudioBands(enabled = true): EmbryPlaybackAudioBands {
	const [bands, setBands] = useState<EmbryPlaybackAudioBands>(silentBands);
	const rafRef = useRef(0);

	useEffect(() => {
		if (!enabled || typeof window === "undefined") {
			return;
		}

		const tick = () => {
			const playing = playingSessionAudio();
			setBands(playing ? bandsFromAnalyser(analyserFor(playing).analyser) : silentBands);
			rafRef.current = requestAnimationFrame(tick);
		};

		rafRef.current = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(rafRef.current);
	}, [enabled]);

	return enabled ? bands : silentBands;
}

export function useEmbryPlaybackAudioLevel(enabled = true): number {
	return useEmbryPlaybackAudioBands(enabled).level;
}

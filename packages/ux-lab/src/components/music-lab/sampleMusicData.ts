/** sampleMusicData — Whisperheads fixture (D minor, 85 BPM, 8 bars) */

export interface PianoNote {
	pitch: string | number;
	start_beat: number;
	duration_beats: number;
	velocity: number;
	instrument: string;
}

export interface Section {
	section_name: string;
	start_bar: number;
	end_bar: number;
	chord_progression?: string[];
}

export interface DriftMarker {
	beat: number;
	drift_ms: number;
}

export interface LyricMarker {
	text: string;
	beat: number;
}

export interface Phrase {
	text: string;
	section: string;
	bar: number;
	beat: number;
	duration_beats: number;
	emotion: string;
	dynamics: string;
	vocal_direction: string;
	syllables?: Syllable[];
}

export interface Syllable {
	text: string;
	beat: number;
	hold_beats: number;
	stress: boolean;
}

export interface RoundResult {
	round: number;
	delta: {
		tempo_delta: number;
		key_match: number;
		chord_accuracy: number;
		dynamics_rmse: number;
		timing_drift_ms: number;
		aggregate: number;
	};
}

export const samplePianoNotes: PianoNote[] = [
	{ pitch: 38, start_beat: 0, duration_beats: 2, velocity: 90, instrument: "bass" },
	{ pitch: 41, start_beat: 2, duration_beats: 1, velocity: 75, instrument: "bass" },
	{ pitch: 43, start_beat: 3, duration_beats: 1, velocity: 80, instrument: "bass" },
	{ pitch: 38, start_beat: 4, duration_beats: 2, velocity: 88, instrument: "bass" },
	{ pitch: 36, start_beat: 6, duration_beats: 2, velocity: 82, instrument: "bass" },
	{ pitch: 38, start_beat: 8, duration_beats: 2, velocity: 90, instrument: "bass" },
	{ pitch: 41, start_beat: 10, duration_beats: 1, velocity: 78, instrument: "bass" },
	{ pitch: 43, start_beat: 11, duration_beats: 1, velocity: 76, instrument: "bass" },
	{ pitch: 45, start_beat: 12, duration_beats: 2, velocity: 85, instrument: "bass" },
	{ pitch: 43, start_beat: 14, duration_beats: 2, velocity: 80, instrument: "bass" },
	{ pitch: 62, start_beat: 0, duration_beats: 1, velocity: 70, instrument: "keys" },
	{ pitch: 65, start_beat: 1, duration_beats: 1, velocity: 68, instrument: "keys" },
	{ pitch: 69, start_beat: 2, duration_beats: 2, velocity: 72, instrument: "keys" },
	{ pitch: 67, start_beat: 4, duration_beats: 1, velocity: 65, instrument: "keys" },
	{ pitch: 65, start_beat: 5, duration_beats: 1, velocity: 62, instrument: "keys" },
	{ pitch: 62, start_beat: 6, duration_beats: 2, velocity: 70, instrument: "keys" },
	{ pitch: 60, start_beat: 8, duration_beats: 1, velocity: 68, instrument: "keys" },
	{ pitch: 62, start_beat: 9, duration_beats: 1, velocity: 65, instrument: "keys" },
	{ pitch: 65, start_beat: 10, duration_beats: 2, velocity: 72, instrument: "keys" },
	{ pitch: 67, start_beat: 12, duration_beats: 2, velocity: 74, instrument: "keys" },
	{ pitch: 65, start_beat: 14, duration_beats: 2, velocity: 70, instrument: "keys" },
	{ pitch: 36, start_beat: 0, duration_beats: 0.5, velocity: 100, instrument: "drums" },
	{ pitch: 42, start_beat: 0.5, duration_beats: 0.25, velocity: 80, instrument: "drums" },
	{ pitch: 38, start_beat: 2, duration_beats: 0.5, velocity: 95, instrument: "drums" },
	{ pitch: 36, start_beat: 4, duration_beats: 0.5, velocity: 100, instrument: "drums" },
	{ pitch: 38, start_beat: 6, duration_beats: 0.5, velocity: 92, instrument: "drums" },
	{ pitch: 36, start_beat: 8, duration_beats: 0.5, velocity: 100, instrument: "drums" },
	{ pitch: 38, start_beat: 10, duration_beats: 0.5, velocity: 95, instrument: "drums" },
	{ pitch: 36, start_beat: 12, duration_beats: 0.5, velocity: 100, instrument: "drums" },
	{ pitch: 38, start_beat: 14, duration_beats: 0.5, velocity: 90, instrument: "drums" },
	{ pitch: 74, start_beat: 16, duration_beats: 2, velocity: 95, instrument: "vocal" },
	{ pitch: 72, start_beat: 18, duration_beats: 1, velocity: 88, instrument: "vocal" },
	{ pitch: 74, start_beat: 19, duration_beats: 1, velocity: 90, instrument: "vocal" },
	{ pitch: 76, start_beat: 20, duration_beats: 3, velocity: 100, instrument: "vocal" },
	{ pitch: 74, start_beat: 23, duration_beats: 1, velocity: 92, instrument: "vocal" },
	{ pitch: 72, start_beat: 24, duration_beats: 2, velocity: 85, instrument: "vocal" },
	{ pitch: 69, start_beat: 26, duration_beats: 2, velocity: 80, instrument: "vocal" },
	{ pitch: 71, start_beat: 28, duration_beats: 2, velocity: 90, instrument: "vocal" },
	{ pitch: 72, start_beat: 30, duration_beats: 2, velocity: 95, instrument: "vocal" },
	{ pitch: 62, start_beat: 16, duration_beats: 4, velocity: 75, instrument: "synth" },
	{ pitch: 65, start_beat: 20, duration_beats: 4, velocity: 78, instrument: "synth" },
	{ pitch: 62, start_beat: 24, duration_beats: 2, velocity: 72, instrument: "synth" },
	{ pitch: 60, start_beat: 26, duration_beats: 2, velocity: 70, instrument: "synth" },
	{ pitch: 62, start_beat: 28, duration_beats: 4, velocity: 76, instrument: "synth" },
	{ pitch: 50, start_beat: 16, duration_beats: 1, velocity: 85, instrument: "guitar" },
	{ pitch: 53, start_beat: 17, duration_beats: 1, velocity: 82, instrument: "guitar" },
	{ pitch: 55, start_beat: 18, duration_beats: 2, velocity: 88, instrument: "guitar" },
	{ pitch: 53, start_beat: 20, duration_beats: 2, velocity: 84, instrument: "guitar" },
	{ pitch: 50, start_beat: 22, duration_beats: 2, velocity: 80, instrument: "guitar" },
	{ pitch: 48, start_beat: 24, duration_beats: 2, velocity: 85, instrument: "guitar" },
	{ pitch: 50, start_beat: 26, duration_beats: 2, velocity: 82, instrument: "guitar" },
	{ pitch: 53, start_beat: 28, duration_beats: 4, velocity: 90, instrument: "guitar" },
];

export const sampleSections: Section[] = [
	{ section_name: "Verse", start_bar: 1, end_bar: 4, chord_progression: ["Dm", "Gm", "Dm", "A7"] },
	{ section_name: "Chorus", start_bar: 5, end_bar: 8, chord_progression: ["Dm", "Bb", "F", "C"] },
];

export const samplePhrases: Phrase[] = [
	{
		text: "Shadows fall across the wire",
		section: "verse",
		bar: 1,
		beat: 0,
		duration_beats: 4,
		emotion: "melancholic",
		dynamics: "mp",
		vocal_direction: "breathy",
		syllables: [
			{ text: "Sha", beat: 0, hold_beats: 0.5, stress: true },
			{ text: "dows", beat: 0.5, hold_beats: 0.5, stress: false },
			{ text: "fall", beat: 1, hold_beats: 1, stress: true },
			{ text: "a", beat: 2, hold_beats: 0.25, stress: false },
			{ text: "cross", beat: 2.25, hold_beats: 0.75, stress: true },
			{ text: "the", beat: 3, hold_beats: 0.25, stress: false },
			{ text: "wire", beat: 3.25, hold_beats: 0.75, stress: true },
		],
	},
	{
		text: "Cold and hollow, no one's there",
		section: "verse",
		bar: 2,
		beat: 4,
		duration_beats: 4,
		emotion: "sadness",
		dynamics: "p",
		vocal_direction: "whisper",
		syllables: [
			{ text: "Cold", beat: 4, hold_beats: 0.5, stress: true },
			{ text: "and", beat: 4.5, hold_beats: 0.25, stress: false },
			{ text: "hol", beat: 4.75, hold_beats: 0.5, stress: true },
			{ text: "low", beat: 5.25, hold_beats: 0.75, stress: false },
			{ text: "no", beat: 6, hold_beats: 0.25, stress: false },
			{ text: "one's", beat: 6.25, hold_beats: 0.75, stress: true },
			{ text: "there", beat: 7, hold_beats: 1, stress: true },
		],
	},
	{
		text: "Every signal lost in static",
		section: "verse",
		bar: 3,
		beat: 8,
		duration_beats: 4,
		emotion: "fear",
		dynamics: "mf",
		vocal_direction: "speak",
	},
	{
		text: "Nothing cuts through the dark air",
		section: "verse",
		bar: 4,
		beat: 12,
		duration_beats: 4,
		emotion: "neutral",
		dynamics: "mp",
		vocal_direction: "speak",
	},
	{
		text: "Whisperheads, we hear you now",
		section: "chorus",
		bar: 5,
		beat: 16,
		duration_beats: 4,
		emotion: "joy",
		dynamics: "f",
		vocal_direction: "belt",
		syllables: [
			{ text: "Whis", beat: 16, hold_beats: 0.5, stress: true },
			{ text: "per", beat: 16.5, hold_beats: 0.5, stress: false },
			{ text: "heads", beat: 17, hold_beats: 1, stress: true },
			{ text: "we", beat: 18, hold_beats: 0.25, stress: false },
			{ text: "hear", beat: 18.25, hold_beats: 0.75, stress: true },
			{ text: "you", beat: 19, hold_beats: 0.5, stress: false },
			{ text: "now", beat: 19.5, hold_beats: 0.5, stress: true },
		],
	},
	{
		text: "Breaking through the silence vow",
		section: "chorus",
		bar: 6,
		beat: 20,
		duration_beats: 4,
		emotion: "joy",
		dynamics: "ff",
		vocal_direction: "belt",
	},
	{
		text: "All the frequencies align",
		section: "chorus",
		bar: 7,
		beat: 24,
		duration_beats: 4,
		emotion: "trust",
		dynamics: "f",
		vocal_direction: "belt",
	},
	{
		text: "Your signal's clear — one final sign",
		section: "chorus",
		bar: 8,
		beat: 28,
		duration_beats: 4,
		emotion: "trust",
		dynamics: "mf",
		vocal_direction: "speak",
	},
];

export const sampleRounds: RoundResult[] = [
	{
		round: 1,
		delta: {
			tempo_delta: 0.72,
			key_match: 0.55,
			chord_accuracy: 0.6,
			dynamics_rmse: 0.8,
			timing_drift_ms: 0.9,
			aggregate: 0.85,
		},
	},
	{
		round: 2,
		delta: {
			tempo_delta: 0.45,
			key_match: 0.3,
			chord_accuracy: 0.38,
			dynamics_rmse: 0.52,
			timing_drift_ms: 0.58,
			aggregate: 0.42,
		},
	},
	{
		round: 3,
		delta: {
			tempo_delta: 0.28,
			key_match: 0.2,
			chord_accuracy: 0.25,
			dynamics_rmse: 0.38,
			timing_drift_ms: 0.4,
			aggregate: 0.31,
		},
	},
	{
		round: 4,
		delta: {
			tempo_delta: 0.18,
			key_match: 0.14,
			chord_accuracy: 0.18,
			dynamics_rmse: 0.28,
			timing_drift_ms: 0.3,
			aggregate: 0.25,
		},
	},
	{
		round: 5,
		delta: {
			tempo_delta: 0.1,
			key_match: 0.08,
			chord_accuracy: 0.12,
			dynamics_rmse: 0.2,
			timing_drift_ms: 0.22,
			aggregate: 0.18,
		},
	},
];

export const samplePeaks: number[] = Array.from({ length: 128 }, (_, i) => {
	const pos = i / 127;
	const isChorus = pos > 0.5;
	const base = isChorus ? 0.55 : 0.3;
	const noise = (Math.sin(i * 7.3) * 0.5 + 0.5) * 0.35;
	const beat = Math.abs(Math.sin(i * Math.PI * 0.5)) * 0.2;
	return Math.min(1, base + noise + beat);
});

export const sampleDriftMarkers: DriftMarker[] = [
	{ beat: 3, drift_ms: 12 },
	{ beat: 7, drift_ms: 28 },
	{ beat: 11, drift_ms: 55 },
	{ beat: 15, drift_ms: 72 },
	{ beat: 19, drift_ms: 18 },
	{ beat: 23, drift_ms: 8 },
	{ beat: 27, drift_ms: 35 },
	{ beat: 31, drift_ms: 15 },
];

export const sampleLyricMarkers: LyricMarker[] = [
	{ text: "Shadows fall", beat: 0 },
	{ text: "Cold and hollow", beat: 4 },
	{ text: "Every signal", beat: 8 },
	{ text: "Nothing cuts", beat: 12 },
	{ text: "Whisperheads!", beat: 16 },
	{ text: "Breaking through", beat: 20 },
	{ text: "All the frequencies", beat: 24 },
	{ text: "Your signal's clear", beat: 28 },
];

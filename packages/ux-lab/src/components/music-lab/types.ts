/** Music Lab TypeScript types — mirrors JSON schemas from create-music/schemas/ */

export interface PianoRollNote {
	pitch: number | string; // MIDI number or note name (e.g. "D4")
	start_beat: number;
	duration_beats: number;
	velocity: number;
	instrument: "vocal" | "guitar" | "bass" | "drums" | "keys" | "synth" | "strings" | "brass" | "pad";
}

export interface PianoRollSection {
	section_name: string;
	start_bar: number;
	end_bar: number;
	chord_progression?: string[];
	energy_curve?: number[];
}

export interface PianoRollSpec {
	bpm: number;
	time_signature: string;
	key: string;
	total_bars: number;
	sections: PianoRollSection[];
	notes?: PianoRollNote[];
}

export interface Syllable {
	text: string;
	beat: number;
	hold_beats?: number;
	stress?: boolean;
	pitch_hint?: string;
}

export type Emotion = "anger" | "fear" | "joy" | "neutral" | "sadness" | "trust";
export type Dynamics = "pp" | "p" | "mp" | "mf" | "f" | "ff";
export type VocalDirection = "whisper" | "speak" | "sing" | "belt" | "falsetto" | "growl" | "rap";

export interface LyricsPhrase {
	text: string;
	section: string;
	bar: number;
	beat: number;
	duration_beats: number;
	emotion?: Emotion;
	dynamics?: Dynamics;
	vocal_direction?: VocalDirection;
	syllables?: Syllable[];
}

export interface AnnotatedLyrics {
	title: string;
	artist?: string;
	bpm: number;
	time_signature: string;
	key: string;
	genre_tags?: string[];
	phrases: LyricsPhrase[];
}

export interface ConvergenceRound {
	round: number;
	timestamp: string;
	tempo_delta: number;
	key_match: boolean;
	chord_accuracy: number;
	dynamics_rmse: number;
	timing_drift_ms: number;
	aggregate: number;
	converged: boolean;
}

export interface MusicLabProject {
	name: string;
	spec: PianoRollSpec;
	lyrics: AnnotatedLyrics;
	rounds: ConvergenceRound[];
	backend: string;
	status: "idle" | "running" | "converged" | "failed";
}

/** Instrument → color mapping for EMBRY dark theme */
export const INSTRUMENT_COLORS: Record<string, string> = {
	vocal: "#7c3aed", // EMBRY.accent (purple)
	guitar: "#00ff88", // EMBRY.green
	bass: "#4a9eff", // EMBRY.blue
	drums: "#ff4444", // EMBRY.red
	keys: "#ffaa00", // EMBRY.amber
	synth: "#e879f9", // fuchsia-400
	strings: "#67e8f9", // cyan-300
	brass: "#fbbf24", // amber-400
	pad: "#a78bfa", // violet-400
};

/** Convert note name to MIDI number for vertical positioning */
export function noteToMidi(note: string | number): number {
	if (typeof note === "number") return note;
	const match = note.match(/^([A-G])(#|b)?(\d)$/);
	if (!match) return 60;
	const bases: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
	let midi = bases[match[1]] + (parseInt(match[3], 10) + 1) * 12;
	if (match[2] === "#") midi++;
	if (match[2] === "b") midi--;
	return midi;
}

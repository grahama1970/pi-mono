/**
 * useCodeRunnerSessions — hook for querying code-runner rounds from llm_invocations
 *
 * Groups rounds by session_key (format: cr-{task_id}-{timestamp}) and computes
 * session-level aggregations for the Code Runner Sessions view.
 */
import { useCallback, useEffect, useState } from "react";

const API_BASE = "http://localhost:3001/api/memory";
const POLL_INTERVAL = 10000; // 10s refresh

// Strategy escalation order for code-runner
export const STRATEGY_ORDER = [
	"direct_fix",
	"structured_analysis",
	"different_approach",
	"simplify",
	"escalate",
] as const;

export type Strategy = (typeof STRATEGY_ORDER)[number];

export interface CodeRunnerRound {
	_key: string;
	timestamp: string;
	session_key: string;
	round: number;
	input: string;
	output: string;
	outcome: "success" | "failed";
	duration_ms: number;
	model: string;
	score: number | null;
	error: string | null;
	tags: string[];
	metadata: {
		task_id: string;
		status: string;
		errors_by_type: Record<string, number>;
		lint_violations: number;
		bp_violations: string[];
		commit: string;
		symbols: string;
		dod_passed: boolean;
		tool_trace_events?: string[];
	};
}

export interface CodeRunnerSession {
	session_key: string;
	task_id: string;
	rounds: CodeRunnerRound[];
	roundCount: number;
	// Score progression
	scores: (number | null)[];
	bestScore: number | null;
	finalScore: number | null;
	scoreImproved: boolean;
	// Strategy tracking
	strategies: Strategy[];
	maxStrategyReached: Strategy;
	strategyEscalations: number;
	// Outcome
	dodPassed: boolean;
	finalCommit: string | null;
	finalStatus: string;
	// Timing
	startTime: string;
	endTime: string;
	totalDurationMs: number;
	// Errors
	errorCount: number;
	keptRounds: number;
	discardedRounds: number;
}

interface ListResponse {
	documents: CodeRunnerRound[];
	total?: number;
}

async function fetchCodeRunnerRounds(limit = 500): Promise<CodeRunnerRound[]> {
	// Query llm_invocations collection for code-runner agent entries
	const resp = await fetch(`${API_BASE}/list`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			collection: "llm_invocations",
			limit,
			sort_field: "timestamp",
			sort_order: "DESC",
			// Filter for code-runner agent
			filter: { agent: "code-runner" },
		}),
	});
	if (!resp.ok) throw new Error(`List failed: ${resp.status}`);
	const data: ListResponse = await resp.json();
	return data.documents || [];
}

function extractStrategy(tags: string[]): Strategy {
	for (const tag of tags) {
		if (tag.startsWith("strategy:")) {
			const s = tag.replace("strategy:", "") as Strategy;
			if (STRATEGY_ORDER.includes(s)) return s;
		}
	}
	return "direct_fix";
}

function extractTaskId(sessionKey: string, tags: string[]): string {
	// session_key format: cr-{task_id}-{timestamp}
	const match = sessionKey.match(/^cr-(.+)-\d+$/);
	if (match) return match[1];

	// Fallback: check tags for task:xxx
	for (const tag of tags) {
		if (tag.startsWith("task:")) {
			return tag.replace("task:", "");
		}
	}
	return "unknown";
}

function groupRoundsIntoSessions(rounds: CodeRunnerRound[]): CodeRunnerSession[] {
	const sessionMap = new Map<string, CodeRunnerRound[]>();

	for (const round of rounds) {
		const key = round.session_key;
		if (!key) continue;
		if (!sessionMap.has(key)) sessionMap.set(key, []);
		sessionMap.get(key)!.push(round);
	}

	const sessions: CodeRunnerSession[] = [];

	for (const [session_key, sessionRounds] of sessionMap) {
		// Sort by round number
		sessionRounds.sort((a, b) => a.round - b.round);

		const task_id = extractTaskId(session_key, sessionRounds[0]?.tags || []);
		const scores = sessionRounds.map((r) => r.score);
		const validScores = scores.filter((s): s is number => s !== null);
		const bestScore = validScores.length > 0 ? Math.max(...validScores) : null;
		const finalScore = scores[scores.length - 1];
		const firstScore = validScores[0] ?? null;
		const scoreImproved = bestScore !== null && firstScore !== null && bestScore > firstScore;

		// Strategy tracking
		const strategies = sessionRounds.map((r) => extractStrategy(r.tags));
		const strategyIndices = strategies.map((s) => STRATEGY_ORDER.indexOf(s));
		const maxStrategyIndex = Math.max(...strategyIndices);
		const maxStrategyReached = STRATEGY_ORDER[maxStrategyIndex] || "direct_fix";

		// Count escalations (strategy index increases)
		let escalations = 0;
		for (let i = 1; i < strategyIndices.length; i++) {
			if (strategyIndices[i] > strategyIndices[i - 1]) escalations++;
		}

		// Outcome
		const lastRound = sessionRounds[sessionRounds.length - 1];
		const dodPassed = lastRound?.metadata?.dod_passed || false;
		const finalCommit = lastRound?.metadata?.commit || null;
		const finalStatus = lastRound?.metadata?.status || "unknown";

		// Timing
		const timestamps = sessionRounds.map((r) => r.timestamp).filter(Boolean);
		const startTime = timestamps[0] || "";
		const endTime = timestamps[timestamps.length - 1] || "";
		const totalDurationMs = sessionRounds.reduce((sum, r) => sum + (r.duration_ms || 0), 0);

		// Error tracking
		const errorCount = sessionRounds.filter((r) => r.outcome === "failed").length;
		const keptRounds = sessionRounds.filter((r) => r.outcome === "success").length;
		const discardedRounds = sessionRounds.length - keptRounds;

		sessions.push({
			session_key,
			task_id,
			rounds: sessionRounds,
			roundCount: sessionRounds.length,
			scores,
			bestScore,
			finalScore,
			scoreImproved,
			strategies,
			maxStrategyReached,
			strategyEscalations: escalations,
			dodPassed,
			finalCommit,
			finalStatus,
			startTime,
			endTime,
			totalDurationMs,
			errorCount,
			keptRounds,
			discardedRounds,
		});
	}

	// Sort by start time descending (most recent first)
	sessions.sort((a, b) => (b.startTime || "").localeCompare(a.startTime || ""));

	return sessions;
}

export function useCodeRunnerSessions() {
	const [sessions, setSessions] = useState<CodeRunnerSession[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

	const refresh = useCallback(async () => {
		try {
			const rounds = await fetchCodeRunnerRounds(500);
			const grouped = groupRoundsIntoSessions(rounds);
			setSessions(grouped);
			setLastUpdate(new Date());
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Unknown error");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();
		const interval = setInterval(refresh, POLL_INTERVAL);
		return () => clearInterval(interval);
	}, [refresh]);

	return { sessions, loading, error, lastUpdate, refresh };
}

/**
 * useScillmData — hook for querying ArangoDB llm_call_log collection
 *
 * Uses /api/memory/recall and computes aggregations client-side.
 */
import { useCallback, useEffect, useState } from "react";

const API_BASE = "http://localhost:3001/api/memory";
const POLL_INTERVAL = 5000; // 5s refresh

export interface LogEntry {
	_key: string;
	ts: string;
	model_requested: string;
	model_served: string;
	provider: string;
	duration_ms: number | null;
	prompt_tokens: number;
	completion_tokens: number;
	total_tokens: number;
	cost_usd: number | null;
	status: "ok" | "error";
	error: string | null;
	caller: string;
	caller_info?: { user_agent?: string; "x-request-id"?: string };
	metadata?: {
		batch_id?: string;
		item_id?: string;
		expected_total?: number;
		chunk_index?: number;
		chunk_total?: number;
		item_index_in_chunk?: number;
	};
	// Diagnostic fields for Error Inspector
	request_prompt?: string;
	response_content?: string;
}

export type BatchStatus = "running" | "stalled" | "failed" | "completed";

export interface BatchProgress {
	batch_id: string;
	total: number;
	completed: number;
	errors: number;
	cost_usd: number;
	avg_duration_ms: number;
	status: BatchStatus;
	lastActivityTs: string;
	firstError: string | null;
	caller: string;
}

export interface SkillUsage {
	caller: string;
	calls: number;
	cost_usd: number;
	tokens: number;
	error_rate: number;
}

export interface LatencyStats {
	model: string;
	p50: number;
	p95: number;
	p99: number;
	count: number;
}

interface _ListResponse {
	documents: LogEntry[];
	total?: number;
}

async function fetchLogs(limit = 3000): Promise<LogEntry[]> {
	// Use /list endpoint with proper parameters — no raw AQL
	// NOTE: Increased from 500 to 3000 to properly track large batches (1688+ calls)
	const resp = await fetch(`${API_BASE}/list`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({
			collection: "llm_call_log",
			limit,
			sort_field: "ts",
			sort_order: "DESC",
		}),
	});
	if (!resp.ok) throw new Error(`List failed: ${resp.status}`);
	const data: { documents: LogEntry[] } = await resp.json();
	return data.documents || [];
}

function computeBatchStatus(items: LogEntry[], lastActivityTs: string): BatchStatus {
	const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
	const isRecent = lastActivityTs >= fiveMinutesAgo;
	const errorCount = items.filter((l) => l.status === "error").length;
	const errorRate = errorCount / items.length;

	// All errors = failed
	if (errorRate === 1) return "failed";
	// >50% errors = failed
	if (errorRate > 0.5) return "failed";
	// No recent activity but has errors = stalled
	if (!isRecent && errorCount > 0) return "stalled";
	// No recent activity and no errors = completed
	if (!isRecent) return "completed";
	// Recent activity = running
	return "running";
}

function computeBatches(logs: LogEntry[]): BatchProgress[] {
	const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
	const recentLogs = logs.filter((l) => l.ts >= oneHourAgo && l.metadata?.batch_id);

	const batchMap = new Map<string, LogEntry[]>();
	for (const log of recentLogs) {
		const bid = log.metadata?.batch_id || "";
		if (!batchMap.has(bid)) batchMap.set(bid, []);
		batchMap.get(bid)!.push(log);
	}

	return Array.from(batchMap.entries())
		.map(([batch_id, items]) => {
			// Sort items by timestamp to find last activity
			items.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
			const lastActivityTs = items[0]?.ts || "";
			const firstError = items.find((l) => l.status === "error")?.error || null;
			const caller = items[0]?.caller || "unknown";

			return {
				batch_id,
				total: items.length,
				completed: items.filter((l) => l.status === "ok").length,
				errors: items.filter((l) => l.status === "error").length,
				cost_usd: items.reduce((sum, l) => sum + (l.cost_usd || 0), 0),
				avg_duration_ms: items.reduce((sum, l) => sum + (l.duration_ms || 0), 0) / items.length,
				status: computeBatchStatus(items, lastActivityTs),
				lastActivityTs,
				firstError,
				caller,
			};
		})
		.sort((a, b) => (b.lastActivityTs || "").localeCompare(a.lastActivityTs || ""));
}

function computeSkillUsage(logs: LogEntry[]): SkillUsage[] {
	const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
	const recentLogs = logs.filter((l) => l.ts >= oneDayAgo);

	const skillMap = new Map<string, LogEntry[]>();
	for (const log of recentLogs) {
		const caller = log.caller || "unknown";
		if (!skillMap.has(caller)) skillMap.set(caller, []);
		skillMap.get(caller)!.push(log);
	}

	return Array.from(skillMap.entries())
		.map(([caller, items]) => ({
			caller,
			calls: items.length,
			cost_usd: items.reduce((sum, l) => sum + (l.cost_usd || 0), 0),
			tokens: items.reduce((sum, l) => sum + (l.total_tokens || 0), 0),
			error_rate: items.filter((l) => l.status === "error").length / items.length,
		}))
		.sort((a, b) => b.calls - a.calls);
}

function percentile(arr: number[], p: number): number {
	if (arr.length === 0) return 0;
	const sorted = [...arr].sort((a, b) => a - b);
	const idx = Math.ceil((p / 100) * sorted.length) - 1;
	return sorted[Math.max(0, idx)];
}

function computeLatency(logs: LogEntry[]): LatencyStats[] {
	const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
	const recentLogs = logs.filter((l) => l.ts >= oneDayAgo && l.status === "ok" && l.duration_ms != null);

	const modelMap = new Map<string, number[]>();
	for (const log of recentLogs) {
		const model = log.model_served || log.model_requested;
		if (!modelMap.has(model)) modelMap.set(model, []);
		modelMap.get(model)!.push(log.duration_ms!);
	}

	return Array.from(modelMap.entries())
		.map(([model, durations]) => ({
			model,
			p50: percentile(durations, 50),
			p95: percentile(durations, 95),
			p99: percentile(durations, 99),
			count: durations.length,
		}))
		.sort((a, b) => b.count - a.count);
}

export function useScillmData() {
	const [logs, setLogs] = useState<LogEntry[]>([]);
	const [batches, setBatches] = useState<BatchProgress[]>([]);
	const [skills, setSkills] = useState<SkillUsage[]>([]);
	const [latency, setLatency] = useState<LatencyStats[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

	const refresh = useCallback(async () => {
		try {
			const allLogs = await fetchLogs(3000); // Increased from 500 to track large batches

			// Sort by timestamp descending
			allLogs.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));

			setLogs(allLogs.slice(0, 100));
			setBatches(computeBatches(allLogs));
			setSkills(computeSkillUsage(allLogs));
			setLatency(computeLatency(allLogs));
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

	return { logs, batches, skills, latency, loading, error, lastUpdate, refresh };
}

// Orchestrator state for batch pipeline debugging
export interface BatchJobState {
	name: string;
	state: {
		status?: "running" | "completed" | "failed" | string;
		phase?: string;
		progress_pct?: number;
		current_item?: string;
		last_message?: string;
		last_error?: string | null;
		manifest_path?: string;
		review_status?: string;
		total_jobs?: number;
		canonical_jobs?: number;
		relationship_jobs?: number;
		completed_jobs?: number;
		successful_jobs?: number;
		failed_jobs?: number;
		skipped_jobs?: number;
		generated_qras?: number;
		stored_qras?: number;
		chunk_num?: number | null;
		total_chunks?: number | null;
		range_start?: number | null;
		range_end?: number | null;
		processed?: number;
		success?: number;
		failed?: number;
		skipped?: number;
		last_key?: string;
		total_processed?: number;
		total_amended?: number;
		total_skipped?: number;
	} | null;
	stateFile: string;
	resumeCmd: string;
	error?: string;
	lastModified?: string;
}

export function useBatchJobState() {
	const [batchJobs, setBatchJobs] = useState<BatchJobState[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			const resp = await fetch(`${API_BASE.replace("/memory", "")}/orchestrators`);
			if (!resp.ok) throw new Error(`Failed: ${resp.status}`);
			const data = await resp.json();
			setBatchJobs(data.orchestrators || []);
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

	return { batchJobs, loading, error, refresh };
}

// Provider auth status from scillm proxy
export interface ProviderAuthStatus {
	status: "valid" | "configured" | "expired" | "missing" | "error";
	source?: string;
	expires_in_s?: number;
	subscription?: string;
	rate_tier?: string;
	account_id?: string;
	error?: string;
}

export interface AuthStatusResponse {
	timestamp: number;
	claude?: ProviderAuthStatus;
	codex?: ProviderAuthStatus;
	gemini?: { status: string };
	chutes?: { status: string };
	deepseek?: { status: string };
	ollama?: { status: string };
}

const SCILLM_API = "http://localhost:4001";
const AUTH_POLL_INTERVAL = 30000; // 30s for auth status

export function useProviderAuth() {
	const [auth, setAuth] = useState<AuthStatusResponse | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			const resp = await fetch(`${SCILLM_API}/v1/scillm/auth`, {
				headers: { Authorization: "Bearer sk-dev-proxy-123" },
			});
			if (!resp.ok) throw new Error(`Failed: ${resp.status}`);
			const data: AuthStatusResponse = await resp.json();
			setAuth(data);
			setError(null);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Unknown error");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		refresh();
		const interval = setInterval(refresh, AUTH_POLL_INTERVAL);
		return () => clearInterval(interval);
	}, [refresh]);

	return { auth, loading, error, refresh };
}

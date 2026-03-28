/**
 * Deterministic Manifest Executor
 *
 * Executes manifest steps via subprocess, not agent reasoning.
 * Each step maps to a concrete action: run_command, check_file, call_api, etc.
 *
 * Events are emitted through Switchboard's existing WebSocket push.
 * Progress is written to JSONL log files for reliability.
 *
 * Hardened after two Codex reviews (2026-03-28):
 * - run_id validation (no path traversal)
 * - correct run_id in progress events
 * - real cancel/pause (SIGTERM → SIGKILL subprocess)
 * - bounded stdout/stderr buffers
 * - threshold falsy fix
 * - activeRuns cleanup on terminal state
 * - double-resolve guard in timeout/close
 */

import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

// ── Constants ────────────────────────────────────────────────────────

const SAFE_ID_RE = /^[a-zA-Z0-9._:-]{1,128}$/;
const MAX_STDOUT_BYTES = 64 * 1024; // 64KB max per stream buffer
const MAX_HISTORY_RUNS = 100; // Keep last N completed runs before pruning
const SIGKILL_GRACE_MS = 5000;

// ── Types ────────────────────────────────────────────────────────────

export interface ManifestStep {
	step_id: string;
	label: string;
	status: "pending" | "running" | "completed" | "failed" | "blocked" | "skipped";
	action: StepAction;
	postcondition?: StepPostcondition;
	outputs?: Record<string, unknown>;
	timeout_seconds?: number;
	result?: StepResult;
}

export interface StepAction {
	type: "run_command" | "check_file" | "call_api" | "check_metrics" | "open_url" | "click" | "assert";
	command?: string;
	cwd?: string;
	env?: Record<string, string>;
	file_path?: string;
	url?: string;
	selector?: string;
	expected?: string | number;
	operator?: "eq" | "gt" | "lt" | "gte" | "lte" | "contains";
}

export interface StepPostcondition {
	type: "exit_code" | "file_exists" | "file_contains" | "metric_gate" | "page_contains";
	expected?: unknown;
	path?: string;
	text?: string;
	metric?: string;
	threshold?: number;
}

export interface StepResult {
	status: "success" | "failed" | "blocked" | "timeout";
	exit_code?: number;
	stdout?: string;
	stderr?: string;
	duration_seconds: number;
	error?: string;
	metrics?: Record<string, number>;
}

export interface Manifest {
	version: number;
	run_id: string;
	worker_id: string;
	model?: string;
	runtime_state: {
		current_step_id: string | null;
		next_eligible_steps: string[];
	};
	steps: ManifestStep[];
}

export interface RunState {
	run_id: string;
	status: "pending" | "running" | "completed" | "failed" | "cancelled" | "paused";
	manifest: Manifest;
	started_at: string;
	finished_at?: string;
	current_step_id?: string;
	active_process: ChildProcess | null;
	log_path: string;
}

export type EventEmitter = (event: RunEvent) => void;

export interface RunEvent {
	type:
		| "run.started"
		| "run.completed"
		| "run.failed"
		| "run.cancelled"
		| "run.paused"
		| "step.started"
		| "step.completed"
		| "step.failed"
		| "step.blocked"
		| "heartbeat"
		| "snapshot"
		| "progress";
	run_id: string;
	step_id?: string;
	data?: Record<string, unknown>;
	timestamp: string;
}

// ── Validation ───────────────────────────────────────────────────────

export function validateRunId(runId: string): string | null {
	if (!runId || !SAFE_ID_RE.test(runId)) {
		return `Invalid run_id: must match ${SAFE_ID_RE.source} (got '${runId?.slice(0, 50)}')`;
	}
	return null;
}

export function validateManifest(manifest: Manifest): string | null {
	const idErr = validateRunId(manifest.run_id);
	if (idErr) return idErr;

	if (!manifest.worker_id || !SAFE_ID_RE.test(manifest.worker_id)) {
		return `Invalid worker_id: ${manifest.worker_id}`;
	}
	if (!Array.isArray(manifest.steps) || manifest.steps.length === 0) {
		return "Manifest must have at least one step";
	}
	if (manifest.steps.length > 200) {
		return `Too many steps: ${manifest.steps.length} (max 200)`;
	}

	const stepIds = new Set<string>();
	for (const step of manifest.steps) {
		if (!step.step_id || !SAFE_ID_RE.test(step.step_id)) {
			return `Invalid step_id: ${step.step_id}`;
		}
		if (stepIds.has(step.step_id)) {
			return `Duplicate step_id: ${step.step_id}`;
		}
		stepIds.add(step.step_id);
		if (!step.action?.type) {
			return `Step ${step.step_id} missing action.type`;
		}
	}
	return null;
}

// ── Active runs ──────────────────────────────────────────────────────

const activeRuns: Map<string, RunState> = new Map();
const completedRunIds: string[] = []; // FIFO for cleanup

export function getActiveRuns(): Map<string, RunState> {
	return activeRuns;
}

export function getRunState(runId: string): RunState | undefined {
	return activeRuns.get(runId);
}

function cleanupRun(runId: string): void {
	completedRunIds.push(runId);
	// Prune oldest completed runs if over limit
	while (completedRunIds.length > MAX_HISTORY_RUNS) {
		const oldest = completedRunIds.shift();
		if (oldest) activeRuns.delete(oldest);
	}
}

// ── Log writer ───────────────────────────────────────────────────────

function writeLog(logPath: string, event: RunEvent): void {
	try {
		fs.appendFileSync(logPath, `${JSON.stringify(event)}\n`);
	} catch (e) {
		console.error(`[Executor] Failed to write log: ${e}`);
	}
}

// ── Bounded buffer ───────────────────────────────────────────────────

class BoundedBuffer {
	private chunks: string[] = [];
	private totalBytes = 0;
	private readonly maxBytes: number;

	constructor(maxBytes: number = MAX_STDOUT_BYTES) {
		this.maxBytes = maxBytes;
	}

	append(text: string): void {
		if (this.totalBytes >= this.maxBytes) return; // Drop excess
		const remaining = this.maxBytes - this.totalBytes;
		const toAdd = text.length > remaining ? text.slice(0, remaining) : text;
		this.chunks.push(toAdd);
		this.totalBytes += toAdd.length;
	}

	toString(): string {
		return this.chunks.join("");
	}

	tail(bytes: number): string {
		const full = this.toString();
		return full.length > bytes ? full.slice(-bytes) : full;
	}
}

// ── Step executors ───────────────────────────────────────────────────

async function executeRunCommand(
	step: ManifestStep,
	runId: string,
	state: RunState,
	_logPath: string,
	emit: EventEmitter,
): Promise<StepResult> {
	const action = step.action;
	if (!action.command) {
		return { status: "failed", duration_seconds: 0, error: "No command specified" };
	}

	const timeout = (step.timeout_seconds || 600) * 1000;
	const start = Date.now();
	let finished = false; // Guard against double-resolve

	return new Promise<StepResult>((resolve) => {
		const proc = spawn("bash", ["-lc", action.command!], {
			cwd: action.cwd || process.cwd(),
			env: { ...process.env, ...action.env, VIRTUAL_ENV: "" },
			stdio: ["pipe", "pipe", "pipe"],
		});

		// Store process handle for cancel/pause
		state.active_process = proc;

		const stdoutBuf = new BoundedBuffer();
		const stderrBuf = new BoundedBuffer();

		let escalationTimer: ReturnType<typeof setTimeout> | null = null;

		const finish = (result: StepResult) => {
			if (finished) return;
			finished = true;
			state.active_process = null;
			if (escalationTimer) {
				clearTimeout(escalationTimer);
				escalationTimer = null;
			}
			resolve(result);
		};

		proc.stdout?.on("data", (data) => {
			const text = data.toString();
			stdoutBuf.append(text);

			// Parse JSONL progress lines with correct run_id
			for (const line of text.split("\n")) {
				const trimmed = line.trim();
				if (trimmed.startsWith("{")) {
					try {
						const parsed = JSON.parse(trimmed);
						emit({
							type: "progress",
							run_id: runId,
							step_id: step.step_id,
							data: parsed,
							timestamp: new Date().toISOString(),
						});
					} catch {
						// Not JSON, ignore
					}
				}
			}
		});

		proc.stderr?.on("data", (data) => {
			stderrBuf.append(data.toString());
		});

		const timer = setTimeout(() => {
			proc.kill("SIGTERM");
			escalationTimer = setTimeout(() => {
				try {
					proc.kill("SIGKILL");
				} catch {
					/* already dead */
				}
			}, SIGKILL_GRACE_MS);
			finish({
				status: "timeout",
				exit_code: -1,
				stdout: stdoutBuf.tail(2000),
				stderr: stderrBuf.tail(2000),
				duration_seconds: (Date.now() - start) / 1000,
				error: `Timeout after ${step.timeout_seconds || 600}s`,
			});
		}, timeout);

		proc.on("close", (code) => {
			clearTimeout(timer);
			finish({
				status: code === 0 ? "success" : "failed",
				exit_code: code ?? -1,
				stdout: stdoutBuf.tail(2000),
				stderr: stderrBuf.tail(2000),
				duration_seconds: (Date.now() - start) / 1000,
				error: code !== 0 ? `Exit code ${code}` : undefined,
			});
		});

		proc.on("error", (err) => {
			clearTimeout(timer);
			finish({
				status: "failed",
				duration_seconds: (Date.now() - start) / 1000,
				error: err.message,
			});
		});
	});
}

async function executeCheckFile(step: ManifestStep): Promise<StepResult> {
	const start = Date.now();
	const filePath = step.action.file_path;
	if (!filePath) {
		return { status: "failed", duration_seconds: 0, error: "No file_path" };
	}

	try {
		const content = fs.readFileSync(filePath, "utf-8"); // Single read, no TOCTOU

		if (step.postcondition?.type === "file_contains" && step.postcondition.text) {
			if (!content.includes(step.postcondition.text)) {
				return {
					status: "failed",
					duration_seconds: (Date.now() - start) / 1000,
					error: `File does not contain: ${step.postcondition.text}`,
				};
			}
		}

		return { status: "success", duration_seconds: (Date.now() - start) / 1000 };
	} catch (e: any) {
		if (e?.code === "ENOENT") {
			return {
				status: "failed",
				duration_seconds: (Date.now() - start) / 1000,
				error: `File not found: ${filePath}`,
			};
		}
		return { status: "failed", duration_seconds: (Date.now() - start) / 1000, error: String(e) };
	}
}

async function executeCheckMetrics(step: ManifestStep): Promise<StepResult> {
	const start = Date.now();
	const filePath = step.action.file_path;
	if (!filePath) {
		return { status: "failed", duration_seconds: 0, error: "No file_path for metrics" };
	}

	try {
		const content = JSON.parse(fs.readFileSync(filePath, "utf-8"));
		const metrics: Record<string, number> = {};

		for (const [k, v] of Object.entries(content)) {
			if (typeof v === "number") metrics[k] = v;
		}

		// FIX: threshold falsy check — use !== undefined, not truthy
		if (
			step.postcondition?.type === "metric_gate" &&
			step.postcondition.metric &&
			step.postcondition.threshold !== undefined
		) {
			const value = metrics[step.postcondition.metric];
			if (value === undefined) {
				return {
					status: "failed",
					duration_seconds: (Date.now() - start) / 1000,
					error: `Metric ${step.postcondition.metric} not found`,
					metrics,
				};
			}
			if (value < step.postcondition.threshold) {
				return {
					status: "failed",
					duration_seconds: (Date.now() - start) / 1000,
					error: `${step.postcondition.metric}=${value} < ${step.postcondition.threshold}`,
					metrics,
				};
			}
		}

		return { status: "success", duration_seconds: (Date.now() - start) / 1000, metrics };
	} catch (e: any) {
		if (e?.code === "ENOENT") {
			return {
				status: "failed",
				duration_seconds: (Date.now() - start) / 1000,
				error: `Metrics file not found: ${filePath}`,
			};
		}
		return { status: "failed", duration_seconds: (Date.now() - start) / 1000, error: String(e) };
	}
}

async function executeCallApi(step: ManifestStep): Promise<StepResult> {
	const start = Date.now();
	const url = step.action.url;
	if (!url) {
		return { status: "failed", duration_seconds: 0, error: "No URL specified" };
	}

	// SSRF guard: only allow localhost
	try {
		const parsed = new URL(url);
		const host = parsed.hostname;
		if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
			return { status: "blocked", duration_seconds: 0, error: `call_api restricted to localhost (got ${host})` };
		}
	} catch {
		return { status: "failed", duration_seconds: 0, error: `Invalid URL: ${url}` };
	}

	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: step.action.command ? step.action.command : undefined,
			signal: AbortSignal.timeout((step.timeout_seconds || 30) * 1000),
		});

		const body = await response.text();
		return {
			status: response.ok ? "success" : "failed",
			stdout: body.slice(0, 2000),
			duration_seconds: (Date.now() - start) / 1000,
			error: response.ok ? undefined : `HTTP ${response.status}`,
		};
	} catch (e) {
		return { status: "failed", duration_seconds: (Date.now() - start) / 1000, error: String(e) };
	}
}

// ── Step dispatcher ──────────────────────────────────────────────────

async function executeStep(
	step: ManifestStep,
	runId: string,
	state: RunState,
	logPath: string,
	emit: EventEmitter,
): Promise<StepResult> {
	switch (step.action.type) {
		case "run_command":
			return executeRunCommand(step, runId, state, logPath, emit);
		case "check_file":
			return executeCheckFile(step);
		case "check_metrics":
			return executeCheckMetrics(step);
		case "call_api":
			return executeCallApi(step);
		default:
			return {
				status: "blocked",
				duration_seconds: 0,
				error: `Unsupported action type: ${step.action.type}. Needs agent-mediated execution.`,
			};
	}
}

// ── Kill active process ──────────────────────────────────────────────

function killActiveProcess(state: RunState): void {
	if (!state.active_process) return;
	try {
		state.active_process.kill("SIGTERM");
		// Escalate to SIGKILL after grace period
		const proc = state.active_process;
		setTimeout(() => {
			try {
				proc.kill("SIGKILL");
			} catch {
				/* already dead */
			}
		}, SIGKILL_GRACE_MS);
	} catch {
		// Already dead
	}
}

// ── Manifest runner ──────────────────────────────────────────────────

export async function startRun(manifest: Manifest, emit: EventEmitter, logDir: string): Promise<RunState> {
	// Validate manifest
	const validationError = validateManifest(manifest);
	if (validationError) {
		throw new Error(`Manifest validation failed: ${validationError}`);
	}

	// Safe log path (run_id already validated by regex)
	const logPath = path.join(logDir, `${manifest.run_id}.jsonl`);
	// Defense in depth: ensure resolved path stays under logDir
	const resolvedLog = path.resolve(logPath);
	const resolvedDir = path.resolve(logDir);
	if (!resolvedLog.startsWith(resolvedDir + path.sep) && resolvedLog !== resolvedDir) {
		throw new Error(`Log path escape detected: ${resolvedLog}`);
	}

	fs.mkdirSync(logDir, { recursive: true });

	const state: RunState = {
		run_id: manifest.run_id,
		status: "running",
		manifest,
		started_at: new Date().toISOString(),
		active_process: null,
		log_path: logPath,
	};

	activeRuns.set(manifest.run_id, state);

	const startEvent: RunEvent = {
		type: "run.started",
		run_id: manifest.run_id,
		timestamp: new Date().toISOString(),
		data: { steps: manifest.steps.length },
	};
	emit(startEvent);
	writeLog(logPath, startEvent);

	// Execute steps sequentially
	for (const step of manifest.steps) {
		if (state.status === "cancelled" || state.status === "paused") break;

		state.current_step_id = step.step_id;
		step.status = "running";

		const stepStart: RunEvent = {
			type: "step.started",
			run_id: manifest.run_id,
			step_id: step.step_id,
			timestamp: new Date().toISOString(),
			data: { label: step.label, action_type: step.action.type },
		};
		emit(stepStart);
		writeLog(logPath, stepStart);

		const result = await executeStep(step, manifest.run_id, state, logPath, emit);
		step.result = result;

		if (result.status === "success") {
			step.status = "completed";
			const stepDone: RunEvent = {
				type: "step.completed",
				run_id: manifest.run_id,
				step_id: step.step_id,
				timestamp: new Date().toISOString(),
				data: { duration: result.duration_seconds, metrics: result.metrics },
			};
			emit(stepDone);
			writeLog(logPath, stepDone);
		} else if (result.status === "blocked") {
			step.status = "blocked";
			const stepBlocked: RunEvent = {
				type: "step.blocked",
				run_id: manifest.run_id,
				step_id: step.step_id,
				timestamp: new Date().toISOString(),
				data: { error: result.error },
			};
			emit(stepBlocked);
			writeLog(logPath, stepBlocked);
		} else {
			step.status = "failed";
			const stepFailed: RunEvent = {
				type: "step.failed",
				run_id: manifest.run_id,
				step_id: step.step_id,
				timestamp: new Date().toISOString(),
				data: {
					error: result.error,
					exit_code: result.exit_code,
					stderr: result.stderr?.slice(0, 500),
					duration: result.duration_seconds,
				},
			};
			emit(stepFailed);
			writeLog(logPath, stepFailed);
			state.status = "failed";
			break;
		}
	}

	// Finalize — only emit terminal event if not already terminal (cancel/pause emit their own)
	state.active_process = null;

	if (state.status === "running") {
		state.status = "completed";
	}

	const isTerminal = state.status === "cancelled" || state.status === "paused";
	if (!isTerminal) {
		state.finished_at = new Date().toISOString();

		const endEvent: RunEvent = {
			type: state.status === "completed" ? "run.completed" : "run.failed",
			run_id: manifest.run_id,
			timestamp: new Date().toISOString(),
			data: {
				steps_completed: manifest.steps.filter((s) => s.status === "completed").length,
				steps_failed: manifest.steps.filter((s) => s.status === "failed").length,
				steps_blocked: manifest.steps.filter((s) => s.status === "blocked").length,
				total_steps: manifest.steps.length,
			},
		};
		emit(endEvent);
		writeLog(logPath, endEvent);

		// Cleanup only from here — cancel/pause handle their own cleanup
		cleanupRun(manifest.run_id);
	}

	return state;
}

export function cancelRun(runId: string, emit: EventEmitter): boolean {
	const state = activeRuns.get(runId);
	if (!state || state.status !== "running") return false;

	// Kill active subprocess
	killActiveProcess(state);

	state.status = "cancelled";
	state.finished_at = new Date().toISOString();
	const event: RunEvent = {
		type: "run.cancelled",
		run_id: runId,
		timestamp: new Date().toISOString(),
	};
	emit(event);
	writeLog(state.log_path, event);
	cleanupRun(runId);
	return true;
}

export function pauseRun(runId: string, emit: EventEmitter): boolean {
	const state = activeRuns.get(runId);
	if (!state || state.status !== "running") return false;

	// Kill active subprocess (pause = stop current step, resume restarts from next)
	killActiveProcess(state);

	state.status = "paused";
	const event: RunEvent = {
		type: "run.paused",
		run_id: runId,
		timestamp: new Date().toISOString(),
	};
	emit(event);
	writeLog(state.log_path, event);
	return true;
}

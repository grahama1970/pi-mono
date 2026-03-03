/**
 * Multi-tenant worker pool for the D-Bus agent bridge.
 *
 * Routes requests to Pi RPC workers with persona affinity, LRU idle selection,
 * auto-scaling, backpressure, and event correlation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { RpcExtensionUIRequest } from "../modes/rpc/rpc-types.js";
import { type BridgeOptions, type PooledRequest, type PoolOptions, type QueuedRequest, WorkerState } from "./types.js";
import { Worker } from "./worker.js";

const DEFAULT_POOL_OPTIONS: PoolOptions = {
	minWorkers: 2,
	maxWorkers: 10,
	maxQueueDepth: 64,
	idleTimeoutMs: 10 * 60 * 1000, // 10 minutes (Pi cold start is 8s — keep warm longer)
	circuitBreakerThreshold: 3,
};

export type PoolEventCallback = (requestId: string, event: AgentEvent | RpcExtensionUIRequest) => void;

export class WorkerPool {
	private workers: Map<number, Worker> = new Map();
	private queue: PooledRequest[] = [];
	private nextWorkerId = 0;
	private options: PoolOptions;
	private bridgeOptions: BridgeOptions;
	private onPoolEvent: PoolEventCallback;
	private idleCheckInterval: ReturnType<typeof setInterval> | null = null;
	private requestCounter = 0;
	private destroyed = false;

	// Tracked state from the first (primary) worker
	isStreaming = false;
	currentModel = "unknown";
	sessionName = "";

	constructor(bridgeOptions: BridgeOptions, onPoolEvent: PoolEventCallback, poolOptions?: Partial<PoolOptions>) {
		this.bridgeOptions = bridgeOptions;
		this.onPoolEvent = onPoolEvent;
		this.options = { ...DEFAULT_POOL_OPTIONS, ...poolOptions };
	}

	async start(): Promise<void> {
		// Discover registered personas for affinity pre-assignment
		const personas = this.discoverPersonas();

		// Spawn workers: at least minWorkers, or one per persona (whichever is larger)
		const targetWorkers = Math.max(this.options.minWorkers, Math.min(personas.length, this.options.maxWorkers));
		const spawnPromises: Promise<Worker>[] = [];
		for (let i = 0; i < targetWorkers; i++) {
			spawnPromises.push(this.spawnWorker());
		}
		const workers = await Promise.all(spawnPromises);

		// Pre-assign persona affinity to spawned workers
		for (let i = 0; i < Math.min(personas.length, workers.length); i++) {
			workers[i].personaAffinity = personas[i];
			console.log(`[pool] Worker-${workers[i].id} affinity: ${personas[i]}`);
		}

		// Start idle check timer for auto-shrink
		this.idleCheckInterval = setInterval(() => this.checkIdleWorkers(), 60000);

		// Refresh tracked state from primary worker
		try {
			const primary = this.getPrimaryWorker();
			if (primary) {
				const state = await primary.getState();
				this.isStreaming = state.isStreaming;
				this.currentModel = state.model ? `${state.model.provider}/${state.model.id}` : "unknown";
				this.sessionName = state.sessionName ?? "";
			}
		} catch {
			// OK during init
		}
	}

	async stop(): Promise<void> {
		this.destroyed = true;
		if (this.idleCheckInterval) {
			clearInterval(this.idleCheckInterval);
			this.idleCheckInterval = null;
		}

		const stops = Array.from(this.workers.values()).map((w) => w.stop());
		await Promise.all(stops);
		this.workers.clear();
		this.queue = [];
	}

	/** Generate a new request ID. */
	nextRequestId(): string {
		return `req_${++this.requestCounter}`;
	}

	/** Submit a request into the pool. Returns immediately for async types. */
	submitRequest(request: QueuedRequest): void {
		const pooled: PooledRequest = {
			...request,
			enqueuedAt: Date.now(),
		};

		// Try direct routing first
		const worker = this.findWorkerForRequest(pooled);
		if (worker) {
			worker.executeRequest(pooled);
			return;
		}

		// Try scaling up
		if (this.workers.size < this.options.maxWorkers) {
			this.spawnWorker()
				.then((newWorker) => {
					newWorker.executeRequest(pooled);
				})
				.catch((err) => {
					console.error(`[pool] Failed to spawn worker for request ${pooled.id}: ${err}`);
					pooled.reject?.(err);
				});
			return;
		}

		// Enqueue with backpressure
		if (this.queue.length >= this.options.maxQueueDepth) {
			pooled.reject?.(new Error("Worker pool at capacity — queue full"));
			return;
		}

		this.enqueue(pooled);
	}

	// --- Read-only fast path (bypass queue) ---

	async getState(): Promise<any> {
		const worker = this.getAnyHealthyWorker();
		if (!worker) throw new Error("No healthy workers available");
		return worker.getState();
	}

	ping(): string {
		return "pong";
	}

	async setModel(provider: string, model: string): Promise<void> {
		// Broadcast to ALL workers
		const promises = Array.from(this.workers.values())
			.filter((w) => w.isHealthy)
			.map((w) =>
				w.setModel(provider, model).catch((err) => {
					console.error(`[pool] Failed to set model on worker-${w.id}: ${err}`);
				}),
			);
		await Promise.all(promises);
		this.currentModel = `${provider}/${model}`;
	}

	respondToUI(id: string, response: string): void {
		// Send to the primary worker (UI responses are always for the active session)
		const primary = this.getPrimaryWorker();
		primary?.respondToUI(id, response);
	}

	get workerCount(): number {
		return this.workers.size;
	}

	get queueDepth(): number {
		return this.queue.length;
	}

	// --- Private ---

	private async spawnWorker(): Promise<Worker> {
		const id = this.nextWorkerId++;
		const worker = new Worker({
			id,
			bridgeOptions: this.bridgeOptions,
			onEvent: this.handleWorkerEvent.bind(this),
			onStateChange: this.handleWorkerStateChange.bind(this),
			onRequestDone: this.handleRequestDone.bind(this),
			circuitBreakerThreshold: this.options.circuitBreakerThreshold,
		});

		this.workers.set(id, worker);
		await worker.start();
		console.log(`[pool] Worker-${id} started (pool size: ${this.workers.size})`);
		return worker;
	}

	private findWorkerForRequest(request: PooledRequest): Worker | null {
		// 1. Persona affinity: if request has persona and a sticky worker is IDLE
		if (request.persona) {
			for (const worker of this.workers.values()) {
				if (worker.personaAffinity === request.persona && worker.isAvailable) {
					return worker;
				}
			}
		}

		// 2. Least-recently-used IDLE healthy worker
		let bestWorker: Worker | null = null;
		let oldestActive = Infinity;
		for (const worker of this.workers.values()) {
			if (worker.isAvailable && worker.lastActiveAt < oldestActive) {
				bestWorker = worker;
				oldestActive = worker.lastActiveAt;
			}
		}

		return bestWorker;
	}

	private enqueue(request: PooledRequest): void {
		// Insert by priority (lower number = higher priority)
		let insertIdx = this.queue.length;
		for (let i = 0; i < this.queue.length; i++) {
			if (request.priority < this.queue[i].priority) {
				insertIdx = i;
				break;
			}
		}
		this.queue.splice(insertIdx, 0, request);
	}

	private processQueue(): void {
		if (this.destroyed || this.queue.length === 0) return;

		// Try to drain as many queued requests as possible
		while (this.queue.length > 0) {
			const next = this.queue[0];
			const worker = this.findWorkerForRequest(next);
			if (!worker) break; // No available workers

			this.queue.shift();
			worker.executeRequest(next);
		}

		// Auto-scale: if queue still has items and room to grow
		if (this.queue.length >= 2 && this.workers.size < this.options.maxWorkers) {
			this.spawnWorker()
				.then(() => this.processQueue())
				.catch((err) => {
					console.error(`[pool] Auto-scale spawn failed: ${err}`);
				});
		}
	}

	private checkIdleWorkers(): void {
		if (this.destroyed) return;

		const now = Date.now();
		for (const worker of this.workers.values()) {
			if (
				worker.state === WorkerState.IDLE &&
				this.workers.size > this.options.minWorkers &&
				now - worker.lastActiveAt > this.options.idleTimeoutMs
			) {
				console.log(
					`[pool] Stopping idle worker-${worker.id} (idle ${Math.round((now - worker.lastActiveAt) / 1000)}s)`,
				);
				worker.stop();
				this.workers.delete(worker.id);
			}
		}

		// Attempt to respawn crashed workers if below minimum
		if (this.workers.size < this.options.minWorkers) {
			const crashed = Array.from(this.workers.values()).find((w) => w.state === WorkerState.CRASHED);
			if (crashed) {
				crashed.respawn().catch((err) => {
					console.error(`[pool] Respawn of worker-${crashed.id} failed: ${err}`);
				});
			} else {
				this.spawnWorker().catch((err) => {
					console.error(`[pool] Min-worker spawn failed: ${err}`);
				});
			}
		}
	}

	private handleWorkerEvent(_workerId: number, requestId: string, event: AgentEvent | RpcExtensionUIRequest): void {
		// Update tracked state from events
		if (event.type === "agent_start") {
			this.isStreaming = true;
		} else if (event.type === "agent_end") {
			this.isStreaming = false;
		}

		// Forward with requestId for correlation
		this.onPoolEvent(requestId, event);
	}

	private handleWorkerStateChange(_workerId: number, _state: WorkerState): void {
		// No-op for now — could emit D-Bus property changes
	}

	private handleRequestDone(_workerId: number, _request: PooledRequest): void {
		// A worker finished — try to drain the queue
		this.processQueue();
	}

	private getPrimaryWorker(): Worker | null {
		// Worker 0 is the primary (backward compat)
		return this.workers.get(0) ?? this.workers.values().next().value ?? null;
	}

	private getAnyHealthyWorker(): Worker | null {
		for (const worker of this.workers.values()) {
			if (worker.isHealthy) return worker;
		}
		return null;
	}

	/**
	 * Discover registered personas by scanning .pi/agents/ directory.
	 * Returns persona names (directory names) that have an AGENTS.md file.
	 */
	private discoverPersonas(): string[] {
		const cwd = this.bridgeOptions.cwd ?? process.cwd();
		const agentsDir = path.join(cwd, ".pi", "agents");
		try {
			if (!fs.existsSync(agentsDir)) return [];
			const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
			return entries
				.filter((e) => e.isDirectory() && fs.existsSync(path.join(agentsDir, e.name, "AGENTS.md")))
				.map((e) => e.name);
		} catch {
			return [];
		}
	}
}

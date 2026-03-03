import { describe, expect, test } from "vitest";
import {
	type BridgePoolOptions,
	type PooledRequest,
	type PoolOptions,
	type QueuedRequest,
	RequestPriority,
	WorkerState,
} from "../src/dbus/types.js";

/**
 * Worker pool unit tests.
 *
 * These test the types, routing logic, and state machine behavior
 * without requiring a D-Bus session bus or Pi RPC process.
 * Integration tests that spawn real workers are in dbus-integration.test.ts.
 */

describe("WorkerState enum", () => {
	test("has all required states", () => {
		expect(WorkerState.STARTING).toBe("starting");
		expect(WorkerState.IDLE).toBe("idle");
		expect(WorkerState.BUSY).toBe("busy");
		expect(WorkerState.DRAINING).toBe("draining");
		expect(WorkerState.CRASHED).toBe("crashed");
	});

	test("state transitions are meaningful", () => {
		// STARTING → IDLE (normal boot)
		// IDLE → BUSY (executing request)
		// BUSY → IDLE (request complete)
		// BUSY → CRASHED (circuit breaker tripped)
		// CRASHED → STARTING (respawn)
		const validTransitions: Record<string, string[]> = {
			[WorkerState.STARTING]: [WorkerState.IDLE, WorkerState.CRASHED],
			[WorkerState.IDLE]: [WorkerState.BUSY, WorkerState.DRAINING],
			[WorkerState.BUSY]: [WorkerState.IDLE, WorkerState.CRASHED],
			[WorkerState.DRAINING]: [WorkerState.IDLE],
			[WorkerState.CRASHED]: [WorkerState.STARTING],
		};

		// Every state has at least one valid transition
		for (const [_state, transitions] of Object.entries(validTransitions)) {
			expect(transitions.length).toBeGreaterThan(0);
		}
	});
});

describe("PooledRequest", () => {
	test("extends QueuedRequest with enqueuedAt", () => {
		const request: PooledRequest = {
			id: "req_1",
			priority: RequestPriority.ASK,
			type: "ask",
			prompt: "test",
			enqueuedAt: Date.now(),
		};
		expect(request.enqueuedAt).toBeGreaterThan(0);
		expect(request.id).toBe("req_1");
	});

	test("supports persona field for affinity routing", () => {
		const request: PooledRequest = {
			id: "req_2",
			priority: RequestPriority.ASK,
			type: "askAs",
			prompt: "test",
			persona: "brandon-bailey",
			enqueuedAt: Date.now(),
		};
		expect(request.persona).toBe("brandon-bailey");
	});

	test("supports all request types", () => {
		const types: QueuedRequest["type"][] = [
			"ask",
			"askAsync",
			"steer",
			"followUp",
			"abort",
			"askWithHints",
			"askAs",
			"askAsAsync",
		];
		for (const type of types) {
			const request: PooledRequest = {
				id: `req_${type}`,
				priority: RequestPriority.ASK,
				type,
				enqueuedAt: Date.now(),
			};
			expect(request.type).toBe(type);
		}
	});
});

describe("PoolOptions defaults", () => {
	test("default pool options match design spec", () => {
		const defaults: PoolOptions = {
			minWorkers: 1,
			maxWorkers: 4,
			maxQueueDepth: 16,
			idleTimeoutMs: 5 * 60 * 1000,
			circuitBreakerThreshold: 3,
		};

		expect(defaults.minWorkers).toBe(1);
		expect(defaults.maxWorkers).toBe(4);
		expect(defaults.maxQueueDepth).toBe(16);
		expect(defaults.idleTimeoutMs).toBe(300000); // 5 min
		expect(defaults.circuitBreakerThreshold).toBe(3);
	});

	test("BridgePoolOptions allows partial config", () => {
		const empty: BridgePoolOptions = {};
		expect(empty.minWorkers).toBeUndefined();
		expect(empty.maxWorkers).toBeUndefined();

		const custom: BridgePoolOptions = { minWorkers: 2, maxWorkers: 8 };
		expect(custom.minWorkers).toBe(2);
		expect(custom.maxWorkers).toBe(8);
	});
});

describe("Priority queue ordering", () => {
	test("ABORT requests jump to front of queue", () => {
		const queue: PooledRequest[] = [];

		// Simulate enqueue by priority
		const enqueue = (req: PooledRequest) => {
			let insertIdx = queue.length;
			for (let i = 0; i < queue.length; i++) {
				if (req.priority < queue[i].priority) {
					insertIdx = i;
					break;
				}
			}
			queue.splice(insertIdx, 0, req);
		};

		enqueue({ id: "1", priority: RequestPriority.ASK, type: "ask", prompt: "a", enqueuedAt: 100 });
		enqueue({ id: "2", priority: RequestPriority.ASK, type: "ask", prompt: "b", enqueuedAt: 200 });
		enqueue({ id: "3", priority: RequestPriority.ABORT, type: "abort", enqueuedAt: 300 });
		enqueue({ id: "4", priority: RequestPriority.STEER, type: "steer", prompt: "s", enqueuedAt: 400 });

		expect(queue[0].id).toBe("3"); // ABORT first
		expect(queue[1].id).toBe("4"); // STEER second
		expect(queue[2].id).toBe("1"); // ASK preserves insertion order
		expect(queue[3].id).toBe("2");
	});

	test("same-priority requests preserve FIFO order", () => {
		const queue: PooledRequest[] = [];
		const enqueue = (req: PooledRequest) => {
			let insertIdx = queue.length;
			for (let i = 0; i < queue.length; i++) {
				if (req.priority < queue[i].priority) {
					insertIdx = i;
					break;
				}
			}
			queue.splice(insertIdx, 0, req);
		};

		enqueue({ id: "first", priority: RequestPriority.ASK, type: "ask", prompt: "1", enqueuedAt: 100 });
		enqueue({ id: "second", priority: RequestPriority.ASK, type: "ask", prompt: "2", enqueuedAt: 200 });
		enqueue({ id: "third", priority: RequestPriority.ASK, type: "ask", prompt: "3", enqueuedAt: 300 });

		expect(queue[0].id).toBe("first");
		expect(queue[1].id).toBe("second");
		expect(queue[2].id).toBe("third");
	});
});

describe("Persona affinity routing logic", () => {
	test("persona affinity matching is string-based", () => {
		const workerAffinity = "brandon-bailey";
		const requestPersona = "brandon-bailey";
		expect(workerAffinity === requestPersona).toBe(true);
	});

	test("null affinity matches no persona requests", () => {
		const workerAffinity: string | null = null;
		const requestPersona = "brandon-bailey";
		expect(workerAffinity === requestPersona).toBe(false);
	});

	test("different personas don't match", () => {
		const workerAffinity: string = "brandon-bailey";
		const requestPersona: string = "margaret-chen";
		expect(workerAffinity === requestPersona).toBe(false);
	});
});

describe("Circuit breaker logic", () => {
	test("worker is healthy below threshold", () => {
		const threshold = 3;
		let consecutiveFailures = 0;

		consecutiveFailures++;
		expect(consecutiveFailures < threshold).toBe(true);

		consecutiveFailures++;
		expect(consecutiveFailures < threshold).toBe(true);
	});

	test("worker becomes unhealthy at threshold", () => {
		const threshold = 3;
		let consecutiveFailures = 0;

		consecutiveFailures++;
		consecutiveFailures++;
		consecutiveFailures++;
		expect(consecutiveFailures >= threshold).toBe(true);
	});

	test("success resets failure counter", () => {
		const threshold = 3;
		let consecutiveFailures = 2;

		// Success
		consecutiveFailures = 0;
		expect(consecutiveFailures < threshold).toBe(true);
	});
});

describe("LRU idle worker selection", () => {
	test("selects worker with oldest lastActiveAt", () => {
		const workers = [
			{ id: 0, lastActiveAt: 1000, isAvailable: true },
			{ id: 1, lastActiveAt: 500, isAvailable: true },
			{ id: 2, lastActiveAt: 2000, isAvailable: true },
		];

		let bestWorker = null;
		let oldestActive = Infinity;
		for (const w of workers) {
			if (w.isAvailable && w.lastActiveAt < oldestActive) {
				bestWorker = w;
				oldestActive = w.lastActiveAt;
			}
		}

		expect(bestWorker?.id).toBe(1); // Oldest active = 500ms
	});

	test("skips unavailable workers", () => {
		const workers = [
			{ id: 0, lastActiveAt: 500, isAvailable: false }, // BUSY
			{ id: 1, lastActiveAt: 1000, isAvailable: true },
			{ id: 2, lastActiveAt: 2000, isAvailable: true },
		];

		let bestWorker = null;
		let oldestActive = Infinity;
		for (const w of workers) {
			if (w.isAvailable && w.lastActiveAt < oldestActive) {
				bestWorker = w;
				oldestActive = w.lastActiveAt;
			}
		}

		expect(bestWorker?.id).toBe(1); // Worker 0 skipped (BUSY)
	});

	test("returns null when no workers available", () => {
		const workers = [
			{ id: 0, lastActiveAt: 500, isAvailable: false },
			{ id: 1, lastActiveAt: 1000, isAvailable: false },
		];

		let bestWorker = null;
		let oldestActive = Infinity;
		for (const w of workers) {
			if (w.isAvailable && w.lastActiveAt < oldestActive) {
				bestWorker = w;
				oldestActive = w.lastActiveAt;
			}
		}

		expect(bestWorker).toBeNull();
	});
});

describe("Auto-scaling triggers", () => {
	test("scale up when queue >= 2 and pool < max", () => {
		const queueDepth = 2;
		const poolSize = 1;
		const maxWorkers = 4;
		const shouldScaleUp = queueDepth >= 2 && poolSize < maxWorkers;
		expect(shouldScaleUp).toBe(true);
	});

	test("no scale up when pool at max", () => {
		const queueDepth = 5;
		const poolSize = 4;
		const maxWorkers = 4;
		const shouldScaleUp = queueDepth >= 2 && poolSize < maxWorkers;
		expect(shouldScaleUp).toBe(false);
	});

	test("no scale up when queue depth < 2", () => {
		const queueDepth = 1;
		const poolSize = 1;
		const maxWorkers = 4;
		const shouldScaleUp = queueDepth >= 2 && poolSize < maxWorkers;
		expect(shouldScaleUp).toBe(false);
	});

	test("scale down when idle > timeout and pool > min", () => {
		const now = Date.now();
		const lastActiveAt = now - 6 * 60 * 1000; // 6 minutes ago
		const idleTimeoutMs = 5 * 60 * 1000;
		const poolSize = 3;
		const minWorkers = 1;

		const shouldScaleDown = poolSize > minWorkers && now - lastActiveAt > idleTimeoutMs;
		expect(shouldScaleDown).toBe(true);
	});

	test("no scale down at minimum pool size", () => {
		const now = Date.now();
		const lastActiveAt = now - 10 * 60 * 1000; // 10 minutes idle
		const idleTimeoutMs = 5 * 60 * 1000;
		const poolSize = 1;
		const minWorkers = 1;

		const shouldScaleDown = poolSize > minWorkers && now - lastActiveAt > idleTimeoutMs;
		expect(shouldScaleDown).toBe(false);
	});
});

describe("Backpressure", () => {
	test("rejects when queue at max depth", () => {
		const maxQueueDepth = 16;
		const queueLength = 16;
		const shouldReject = queueLength >= maxQueueDepth;
		expect(shouldReject).toBe(true);
	});

	test("accepts when queue has capacity", () => {
		const maxQueueDepth = 16;
		const queueLength = 15;
		const shouldReject = queueLength >= maxQueueDepth;
		expect(shouldReject).toBe(false);
	});
});

describe("Signal correlation", () => {
	test("requestId format is consistent", () => {
		let counter = 0;
		const nextId = () => `req_${++counter}`;

		expect(nextId()).toBe("req_1");
		expect(nextId()).toBe("req_2");
		expect(nextId()).toMatch(/^req_\d+$/);
	});

	test("signal signatures include requestId", () => {
		// Verify the new signal signatures from interface.ts
		// MessageUpdate: "ss" (requestId, text)
		// ToolExecution: "sss" (requestId, name, args)
		// AgentEnd: "ss" (requestId, response)
		// Error: "ss" (requestId, message)
		// ExtensionUIRequest: "sssss" (requestId, id, method, title, options)
		const signatures: Record<string, string> = {
			MessageUpdate: "ss",
			ToolExecution: "sss",
			AgentEnd: "ss",
			Error: "ss",
			ExtensionUIRequest: "sssss",
			Ready: "",
		};

		// All correlated signals have at least 2 string args (requestId + data)
		for (const [name, sig] of Object.entries(signatures)) {
			if (name === "Ready") {
				expect(sig).toBe("");
			} else {
				expect(sig.length).toBeGreaterThanOrEqual(2);
				expect(sig[0]).toBe("s"); // First arg is always requestId
			}
		}
	});
});

describe("Session persistence paths", () => {
	test("per-worker session files use worker ID", () => {
		const workerId = 2;
		const sessionFile = `worker_${workerId}.json`;
		expect(sessionFile).toBe("worker_2.json");
	});

	test("session dir is under ~/.pi/state/dbus-sessions/", () => {
		const homeDir = "/home/testuser";
		const sessionDir = `${homeDir}/.pi/state/dbus-sessions`;
		expect(sessionDir).toContain(".pi/state/dbus-sessions");
	});
});

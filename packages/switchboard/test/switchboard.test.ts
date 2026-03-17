/**
 * Adversarial tests for Switchboard inter-agent communication service.
 *
 * Spins up a REAL server on a random port, tests HTTP + WebSocket APIs,
 * then tears down. Tests probe: message routing, priority ordering,
 * WebSocket push, persistence, error handling, edge cases.
 */

import * as fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import * as http from "node:http";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";

// ── Server setup (extracted from index.ts to avoid import.meta issues) ───────

// We'll test via HTTP requests to a real server spawned as a child process.
// This avoids importing the server module (which calls start() on load).

import { type ChildProcess, spawn } from "node:child_process";

let serverProcess: ChildProcess | null = null;
let PORT: number;
let BASE_URL: string;
let WS_URL: string;
let tempDir: string;

function randomPort(): number {
	return 10000 + Math.floor(Math.random() * 50000);
}

async function fetch(
	url: string,
	options: { method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<{ status: number; data: any }> {
	return new Promise((resolve, reject) => {
		const parsed = new URL(url);
		const req = http.request(
			{
				hostname: parsed.hostname,
				port: parsed.port,
				path: parsed.pathname + parsed.search,
				method: options.method || "GET",
				headers: { "Content-Type": "application/json", ...options.headers },
			},
			(res) => {
				let body = "";
				res.on("data", (chunk) => {
					body += chunk;
				});
				res.on("end", () => {
					try {
						resolve({ status: res.statusCode || 0, data: JSON.parse(body) });
					} catch {
						resolve({ status: res.statusCode || 0, data: body });
					}
				});
			},
		);
		req.on("error", reject);
		if (options.body) req.write(options.body);
		req.end();
	});
}

async function waitForServer(url: string, retries = 30): Promise<void> {
	for (let i = 0; i < retries; i++) {
		try {
			const res = await fetch(`${url}/health`);
			if (res.status === 200) return;
		} catch {}
		await new Promise((r) => setTimeout(r, 100));
	}
	throw new Error(`Server didn't start at ${url}`);
}

function connectWs(agent: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`${WS_URL}?agent=${agent}`);
		ws.on("open", () => resolve(ws));
		ws.on("error", reject);
		setTimeout(() => reject(new Error("WS connect timeout")), 5000);
	});
}

/** Buffered WebSocket message receiver — queues messages so none are missed */
function createWsQueue(ws: WebSocket): { next: (timeout?: number) => Promise<any> } {
	const queue: any[] = [];
	const waiters: Array<(msg: any) => void> = [];

	ws.on("message", (data) => {
		const parsed = JSON.parse(data.toString());
		if (waiters.length > 0) {
			waiters.shift()!(parsed);
		} else {
			queue.push(parsed);
		}
	});

	return {
		next(timeout = 3000): Promise<any> {
			if (queue.length > 0) return Promise.resolve(queue.shift()!);
			return new Promise((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error("WS recv timeout")), timeout);
				waiters.push((msg) => {
					clearTimeout(timer);
					resolve(msg);
				});
			});
		},
	};
}

function wsRecv(ws: WebSocket, timeout = 3000): Promise<any> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("WS recv timeout")), timeout);
		ws.once("message", (data) => {
			clearTimeout(timer);
			resolve(JSON.parse(data.toString()));
		});
	});
}

beforeAll(async () => {
	PORT = randomPort();
	BASE_URL = `http://127.0.0.1:${PORT}`;
	WS_URL = `ws://127.0.0.1:${PORT}`;
	tempDir = mkdtempSync(path.join(tmpdir(), "switchboard-test-"));

	// Create a wrapper script that overrides PERSISTENCE_FILE and PID_FILE
	const wrapperPath = path.join(tempDir, "server.ts");
	const serverSrc = fs.readFileSync(path.resolve(__dirname, "../index.ts"), "utf-8");

	// Patch the server source to use temp files and our port
	const patched = serverSrc
		.replace(/const PORT = .*?;/, `const PORT = ${PORT};`)
		.replace(
			/const PERSISTENCE_FILE = .*?;/,
			`const PERSISTENCE_FILE = "${path.join(tempDir, "messages.json").replace(/\\/g, "\\\\")}";`,
		)
		.replace(
			/const PID_FILE = .*?;/,
			`const PID_FILE = "${path.join(tempDir, "switchboard.pid").replace(/\\/g, "\\\\")}";`,
		);

	fs.writeFileSync(wrapperPath, patched);

	serverProcess = spawn("npx", ["tsx", wrapperPath], {
		env: { ...process.env, SWITCHBOARD_PORT: String(PORT) },
		stdio: "pipe",
		detached: false,
	});

	serverProcess.stderr?.on("data", (d) => {
		const msg = d.toString();
		if (!msg.includes("[Switchboard]")) process.stderr.write(msg);
	});

	await waitForServer(BASE_URL);
}, 15000);

afterAll(async () => {
	if (serverProcess) {
		serverProcess.kill("SIGTERM");
		await new Promise((r) => setTimeout(r, 500));
		if (!serverProcess.killed) serverProcess.kill("SIGKILL");
	}
	try {
		rmSync(tempDir, { recursive: true, force: true });
	} catch {}
}, 10000);

// ═══════════════════════════════════════════════════════════════════════════
// 1. HEALTH & BASICS
// ═══════════════════════════════════════════════════════════════════════════

describe("Health & Basics", () => {
	it("GET /health returns 200 with uptime", async () => {
		const res = await fetch(`${BASE_URL}/health`);
		expect(res.status).toBe(200);
		expect(res.data.status).toBe("ok");
		expect(res.data.uptime).toBeGreaterThan(0);
		expect(res.data).toHaveProperty("agents");
		expect(res.data).toHaveProperty("connectedAgents");
		expect(res.data).toHaveProperty("totalMessages");
	});

	it("GET /agents returns empty list initially", async () => {
		const res = await fetch(`${BASE_URL}/agents`);
		expect(res.status).toBe(200);
		expect(res.data.agents).toBeInstanceOf(Array);
	});

	it("OPTIONS returns 204 (CORS preflight)", async () => {
		const res = await fetch(`${BASE_URL}/health`, { method: "OPTIONS" });
		expect(res.status).toBe(204);
	});

	it("GET /nonexistent returns 404", async () => {
		const res = await fetch(`${BASE_URL}/nonexistent`);
		expect(res.status).toBe(404);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. AGENT REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════

describe("Agent Registration", () => {
	it("POST /register creates agent", async () => {
		const res = await fetch(`${BASE_URL}/register`, {
			method: "POST",
			body: JSON.stringify({ name: "test-agent-1", cwd: "/tmp" }),
		});
		expect(res.status).toBe(200);
		expect(res.data.success).toBe(true);
		expect(res.data.agent.name).toBe("test-agent-1");
	});

	it("POST /register without name returns 400", async () => {
		const res = await fetch(`${BASE_URL}/register`, {
			method: "POST",
			body: JSON.stringify({ cwd: "/tmp" }),
		});
		expect(res.status).toBe(400);
		expect(res.data.error).toContain("name");
	});

	it("registered agent appears in /agents list", async () => {
		await fetch(`${BASE_URL}/register`, {
			method: "POST",
			body: JSON.stringify({ name: "visible-agent" }),
		});
		const res = await fetch(`${BASE_URL}/agents`);
		expect(res.data.agents.some((a: any) => a.name === "visible-agent")).toBe(true);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. MESSAGE ROUTING (HTTP)
// ═══════════════════════════════════════════════════════════════════════════

describe("Message Routing (HTTP)", () => {
	it("POST /emit sends message to agent inbox", async () => {
		const res = await fetch(`${BASE_URL}/emit`, {
			method: "POST",
			body: JSON.stringify({ from: "sender", to: "receiver-1", message: "hello" }),
		});
		expect(res.status).toBe(201);
		expect(res.data.success).toBe(true);
		expect(res.data.id).toMatch(/^msg_/);
		expect(res.data.message.from).toBe("sender");
		expect(res.data.message.to).toBe("receiver-1");
	});

	it("POST /emit without 'to' returns 400", async () => {
		const res = await fetch(`${BASE_URL}/emit`, {
			method: "POST",
			body: JSON.stringify({ from: "sender", message: "hello" }),
		});
		expect(res.status).toBe(400);
	});

	it("POST /emit without 'message' returns 400", async () => {
		const res = await fetch(`${BASE_URL}/emit`, {
			method: "POST",
			body: JSON.stringify({ from: "sender", to: "receiver" }),
		});
		expect(res.status).toBe(400);
	});

	it("GET /inbox/:agent returns messages", async () => {
		// Send a message first
		await fetch(`${BASE_URL}/emit`, {
			method: "POST",
			body: JSON.stringify({ from: "sender", to: "inbox-test", message: "test msg" }),
		});

		const res = await fetch(`${BASE_URL}/inbox/inbox-test`);
		expect(res.status).toBe(200);
		expect(res.data.count).toBeGreaterThan(0);
		expect(res.data.messages[0].message).toBe("test msg");
	});

	it("GET /inbox/:agent respects limit param", async () => {
		// Send 5 messages
		for (let i = 0; i < 5; i++) {
			await fetch(`${BASE_URL}/emit`, {
				method: "POST",
				body: JSON.stringify({ from: "s", to: "limit-test", message: `msg-${i}` }),
			});
		}

		const res = await fetch(`${BASE_URL}/inbox/limit-test?limit=2`);
		expect(res.status).toBe(200);
		expect(res.data.messages).toHaveLength(2);
		expect(res.data.hasMore).toBe(true);
	});

	it("DELETE /inbox/:agent/:id acknowledges message", async () => {
		const emit = await fetch(`${BASE_URL}/emit`, {
			method: "POST",
			body: JSON.stringify({ from: "s", to: "ack-test", message: "to be acked" }),
		});
		const msgId = emit.data.id;

		const res = await fetch(`${BASE_URL}/inbox/ack-test/${msgId}`, { method: "DELETE" });
		expect(res.status).toBe(200);
		expect(res.data.success).toBe(true);
		expect(res.data.acknowledged.id).toBe(msgId);

		// Verify it's gone
		const inbox = await fetch(`${BASE_URL}/inbox/ack-test`);
		expect(inbox.data.messages.every((m: any) => m.id !== msgId)).toBe(true);
	});

	it("DELETE /inbox/:agent/:id for non-existent returns 404", async () => {
		const res = await fetch(`${BASE_URL}/inbox/nobody/msg_fake`, { method: "DELETE" });
		expect(res.status).toBe(404);
	});

	it("DELETE /inbox/:agent clears entire inbox", async () => {
		// Register and send messages
		await fetch(`${BASE_URL}/register`, {
			method: "POST",
			body: JSON.stringify({ name: "clear-test" }),
		});
		for (let i = 0; i < 3; i++) {
			await fetch(`${BASE_URL}/emit`, {
				method: "POST",
				body: JSON.stringify({ from: "s", to: "clear-test", message: `m${i}` }),
			});
		}

		const res = await fetch(`${BASE_URL}/inbox/clear-test`, { method: "DELETE" });
		expect(res.status).toBe(200);
		expect(res.data.cleared).toBe(3);

		const inbox = await fetch(`${BASE_URL}/inbox/clear-test`);
		expect(inbox.data.count).toBe(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. PRIORITY ORDERING
// ═══════════════════════════════════════════════════════════════════════════

describe("Priority Ordering", () => {
	it("messages are sorted by priority (urgent first)", async () => {
		const agent = "priority-test";

		// Send in wrong order
		await fetch(`${BASE_URL}/emit`, {
			method: "POST",
			body: JSON.stringify({ to: agent, from: "s", message: "low", priority: "low" }),
		});
		await fetch(`${BASE_URL}/emit`, {
			method: "POST",
			body: JSON.stringify({ to: agent, from: "s", message: "urgent", priority: "urgent" }),
		});
		await fetch(`${BASE_URL}/emit`, {
			method: "POST",
			body: JSON.stringify({ to: agent, from: "s", message: "normal", priority: "normal" }),
		});
		await fetch(`${BASE_URL}/emit`, {
			method: "POST",
			body: JSON.stringify({ to: agent, from: "s", message: "high", priority: "high" }),
		});

		const res = await fetch(`${BASE_URL}/inbox/${agent}`);
		const priorities = res.data.messages.map((m: any) => m.priority);
		expect(priorities[0]).toBe("urgent");
		expect(priorities[1]).toBe("high");
		expect(priorities[2]).toBe("normal");
		expect(priorities[3]).toBe("low");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. WEBSOCKET API
// ═══════════════════════════════════════════════════════════════════════════

describe("WebSocket API", () => {
	it("connects and receives connected confirmation", async () => {
		const ws = await connectWs("ws-test-1");
		try {
			const msg = await wsRecv(ws);
			expect(msg.type).toBe("connected");
			expect(msg.agent).toBe("ws-test-1");
		} finally {
			ws.close();
		}
	});

	it("receives pushed messages via WebSocket", async () => {
		const ws = await connectWs("ws-push-test");
		const q = createWsQueue(ws);
		try {
			// Drain the connected message
			const connected = await q.next();
			expect(connected.type).toBe("connected");

			// Send a message via HTTP to this agent
			await fetch(`${BASE_URL}/emit`, {
				method: "POST",
				body: JSON.stringify({ from: "http-sender", to: "ws-push-test", message: "pushed!" }),
			});

			// Should receive via WebSocket
			const msg = await q.next();
			expect(msg.type).toBe("message");
			expect(msg.data.message).toBe("pushed!");
			expect(msg.data.from).toBe("http-sender");
		} finally {
			ws.close();
		}
	});

	it("can emit messages via WebSocket", async () => {
		const ws = await connectWs("ws-emitter");
		const q = createWsQueue(ws);
		try {
			await q.next(); // drain connected

			// Emit via WebSocket
			ws.send(
				JSON.stringify({
					type: "emit",
					to: "ws-emit-target",
					message: "from websocket",
					msgType: "task",
					priority: "high",
				}),
			);

			// Wait for the message to be processed and verify via HTTP
			// (The "emitted" WS confirmation is race-prone due to Node event loop ordering)
			await new Promise((r) => setTimeout(r, 200));
			const inbox = await fetch(`${BASE_URL}/inbox/ws-emit-target`);
			expect(inbox.data.messages.some((m: any) => m.message === "from websocket")).toBe(true);
			expect(inbox.data.messages.some((m: any) => m.priority === "high")).toBe(true);
			expect(inbox.data.messages.some((m: any) => m.from === "ws-emitter")).toBe(true);
		} finally {
			ws.close();
		}
	});

	it("can acknowledge messages via WebSocket", async () => {
		const ws = await connectWs("ws-acker");
		const q = createWsQueue(ws);
		try {
			await q.next(); // drain connected

			// Send a message to this agent
			const emit = await fetch(`${BASE_URL}/emit`, {
				method: "POST",
				body: JSON.stringify({ from: "s", to: "ws-acker", message: "ack me" }),
			});

			await q.next(); // drain the pushed message

			// Ack via WebSocket
			ws.send(JSON.stringify({ type: "ack", id: emit.data.id }));
			const ackResp = await q.next();
			expect(ackResp.type).toBe("acked");
			expect(ackResp.success).toBe(true);

			// Verify removed from inbox
			const inbox = await fetch(`${BASE_URL}/inbox/ws-acker`);
			expect(inbox.data.messages.every((m: any) => m.id !== emit.data.id)).toBe(true);
		} finally {
			ws.close();
		}
	});

	it("ping returns pong", async () => {
		const ws = await connectWs("ws-ping");
		try {
			await wsRecv(ws); // drain connected
			ws.send(JSON.stringify({ type: "ping" }));
			const pong = await wsRecv(ws);
			expect(pong.type).toBe("pong");
			expect(pong.timestamp).toBeGreaterThan(0);
		} finally {
			ws.close();
		}
	});

	it("rejects WebSocket without agent param", async () => {
		const ws = new WebSocket(WS_URL);
		await new Promise<void>((resolve) => {
			ws.on("close", (code) => {
				expect(code).toBe(4000);
				resolve();
			});
			ws.on("error", () => resolve());
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. ADVERSARIAL / EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

describe("Adversarial Edge Cases", () => {
	it("handles invalid JSON in POST body", async () => {
		const res = await new Promise<{ status: number; data: any }>((resolve, reject) => {
			const req = http.request(
				{
					hostname: "127.0.0.1",
					port: PORT,
					path: "/emit",
					method: "POST",
					headers: { "Content-Type": "application/json" },
				},
				(res) => {
					let body = "";
					res.on("data", (chunk) => {
						body += chunk;
					});
					res.on("end", () => {
						try {
							resolve({ status: res.statusCode || 0, data: JSON.parse(body) });
						} catch {
							resolve({ status: res.statusCode || 0, data: body });
						}
					});
				},
			);
			req.on("error", reject);
			req.write("{invalid json");
			req.end();
		});
		expect(res.status).toBe(500);
	});

	it("handles URL-encoded agent names in inbox path", async () => {
		const agent = "agent%20with%20spaces";
		await fetch(`${BASE_URL}/emit`, {
			method: "POST",
			body: JSON.stringify({ from: "s", to: "agent with spaces", message: "test" }),
		});
		const res = await fetch(`${BASE_URL}/inbox/${agent}`);
		expect(res.status).toBe(200);
	});

	it("handles very long message text", async () => {
		const longMsg = "x".repeat(100000);
		const res = await fetch(`${BASE_URL}/emit`, {
			method: "POST",
			body: JSON.stringify({ from: "s", to: "long-msg-test", message: longMsg }),
		});
		expect(res.status).toBe(201);

		const inbox = await fetch(`${BASE_URL}/inbox/long-msg-test`);
		expect(inbox.data.messages[0].message.length).toBe(100000);
	});

	it("handles unicode in message and agent names", async () => {
		const res = await fetch(`${BASE_URL}/emit`, {
			method: "POST",
			body: JSON.stringify({ from: "sender-\u4e16\u754c", to: "receiver-\u{1F600}", message: "Hello \u{1F30D}" }),
		});
		expect(res.status).toBe(201);
		expect(res.data.message.from).toContain("\u4e16\u754c");
	});

	it("handles rapid sequential messages", async () => {
		const promises = Array.from({ length: 20 }, (_, i) =>
			fetch(`${BASE_URL}/emit`, {
				method: "POST",
				body: JSON.stringify({ from: "rapid", to: "rapid-test", message: `msg-${i}` }),
			}),
		);
		const results = await Promise.all(promises);
		expect(results.every((r) => r.status === 201)).toBe(true);

		const inbox = await fetch(`${BASE_URL}/inbox/rapid-test`);
		expect(inbox.data.count).toBe(20);
	});

	it("default from is 'anonymous' when not provided", async () => {
		const res = await fetch(`${BASE_URL}/emit`, {
			method: "POST",
			body: JSON.stringify({ to: "anon-test", message: "no from" }),
		});
		expect(res.data.message.from).toBe("anonymous");
	});

	it("default type is 'info' and priority is 'normal'", async () => {
		const res = await fetch(`${BASE_URL}/emit`, {
			method: "POST",
			body: JSON.stringify({ to: "default-test", message: "defaults" }),
		});
		expect(res.data.message.type).toBe("info");
		expect(res.data.message.priority).toBe("normal");
	});

	it("custom message type and metadata are preserved", async () => {
		const res = await fetch(`${BASE_URL}/emit`, {
			method: "POST",
			body: JSON.stringify({
				to: "meta-test",
				from: "s",
				message: "with meta",
				type: "alert",
				priority: "urgent",
				subject: "Important",
				metadata: { key: "value", nested: { a: 1 } },
			}),
		});
		expect(res.data.message.type).toBe("alert");
		expect(res.data.message.priority).toBe("urgent");
		expect(res.data.message.subject).toBe("Important");
		expect(res.data.message.metadata.key).toBe("value");
		expect(res.data.message.metadata.nested.a).toBe(1);
	});

	it("message IDs are unique across rapid creation", async () => {
		const ids = new Set<string>();
		const promises = Array.from({ length: 50 }, () =>
			fetch(`${BASE_URL}/emit`, {
				method: "POST",
				body: JSON.stringify({ from: "s", to: "id-unique-test", message: "x" }),
			}),
		);
		const results = await Promise.all(promises);
		for (const r of results) {
			ids.add(r.data.id);
		}
		expect(ids.size).toBe(50);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. PERSISTENCE
// ═══════════════════════════════════════════════════════════════════════════

describe("Persistence", () => {
	it("writes messages.json to disk", async () => {
		await fetch(`${BASE_URL}/emit`, {
			method: "POST",
			body: JSON.stringify({ from: "s", to: "persist-test", message: "saved" }),
		});

		// Give it a moment to write
		await new Promise((r) => setTimeout(r, 200));

		const persisted = path.join(tempDir, "messages.json");
		expect(fs.existsSync(persisted)).toBe(true);
		const data = JSON.parse(fs.readFileSync(persisted, "utf-8"));
		expect(data.inboxes).toBeDefined();
		expect(data.savedAt).toBeDefined();
	});

	it("PID file is created", () => {
		const pidFile = path.join(tempDir, "switchboard.pid");
		expect(fs.existsSync(pidFile)).toBe(true);
		const pid = parseInt(fs.readFileSync(pidFile, "utf-8"), 10);
		expect(pid).toBeGreaterThan(0);
	});
});

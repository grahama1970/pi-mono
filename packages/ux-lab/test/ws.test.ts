import type { Server } from "http";
import { createServer } from "http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app, state } from "../server/index.ts";
import { clearState } from "../server/ws-handler.ts";

let server: Server;
let baseUrl: string;

beforeAll(async () => {
	await new Promise<void>((resolve) => {
		server = createServer(app).listen(0, () => {
			const addr = server.address();
			if (typeof addr === "object" && addr) {
				baseUrl = `http://localhost:${addr.port}`;
			}
			resolve();
		});
	});
});

afterAll(async () => {
	await new Promise<void>((resolve) => {
		server.close(() => resolve());
	});
});

beforeEach(() => {
	state.clear();
	clearState();
});

async function api(path: string, options?: RequestInit) {
	return fetch(`${baseUrl}${path}`, {
		headers: { "Content-Type": "application/json" },
		...options,
	});
}

describe("Agent Registration (REST)", () => {
	it("registers an agent via POST /api/v1/agents/register", async () => {
		const res = await api("/api/v1/agents/register", {
			method: "POST",
			body: JSON.stringify({ name: "navbar-agent", color: "#ff0000" }),
		});
		expect(res.status).toBe(201);
		const agent = await res.json();
		expect(agent.id).toBeDefined();
		expect(agent.name).toBe("navbar-agent");
		expect(agent.color).toBe("#ff0000");
		expect(agent.status).toBe("idle");
	});

	it("registers an agent with a zone", async () => {
		const res = await api("/api/v1/agents/register", {
			method: "POST",
			body: JSON.stringify({
				name: "sidebar-agent",
				color: "#00ff00",
				zone: { x: 0, y: 0, width: 200, height: 600 },
			}),
		});
		expect(res.status).toBe(201);
		const agent = await res.json();
		expect(agent.zone).toEqual({ x: 0, y: 0, width: 200, height: 600 });
	});

	it("returns 400 for missing name", async () => {
		const res = await api("/api/v1/agents/register", {
			method: "POST",
			body: JSON.stringify({ color: "#ff0000" }),
		});
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error).toBe("Validation failed");
	});

	it("returns 400 for missing color", async () => {
		const res = await api("/api/v1/agents/register", {
			method: "POST",
			body: JSON.stringify({ name: "test" }),
		});
		expect(res.status).toBe(400);
	});
});

describe("List Agents (REST)", () => {
	it("returns empty array when no agents registered", async () => {
		const res = await api("/api/v1/agents");
		expect(res.status).toBe(200);
		const agents = await res.json();
		expect(agents).toEqual([]);
	});

	it("returns all registered agents", async () => {
		await api("/api/v1/agents/register", {
			method: "POST",
			body: JSON.stringify({ name: "agent-1", color: "#111" }),
		});
		await api("/api/v1/agents/register", {
			method: "POST",
			body: JSON.stringify({ name: "agent-2", color: "#222" }),
		});

		const res = await api("/api/v1/agents");
		const agents = await res.json();
		expect(agents).toHaveLength(2);
		expect(agents.map((a: { name: string }) => a.name).sort()).toEqual(["agent-1", "agent-2"]);
	});
});

describe("Submit Ops (REST)", () => {
	it("applies operations via POST /api/v1/agents/:id/ops", async () => {
		// Register agent first
		const regRes = await api("/api/v1/agents/register", {
			method: "POST",
			body: JSON.stringify({ name: "builder", color: "#0000ff" }),
		});
		const agent = await regRes.json();

		// Submit create operation
		const ops = [
			{
				agent: agent.id,
				op: "create",
				timestamp: Date.now(),
				element: { type: "rect", x: 10, y: 20, width: 50, height: 50 },
				reason: "Building header",
			},
		];

		const opsRes = await api(`/api/v1/agents/${agent.id}/ops`, {
			method: "POST",
			body: JSON.stringify(ops),
		});
		expect(opsRes.status).toBe(200);
		const result = await opsRes.json();
		expect(result.applied).toBe(1);

		// Verify element was created in canvas state
		const elementsRes = await api("/api/v1/elements");
		const elements = await elementsRes.json();
		expect(elements).toHaveLength(1);
		expect(elements[0].type).toBe("rect");
		expect(elements[0].x).toBe(10);
	});

	it("returns 404 for non-existent agent", async () => {
		const res = await api("/api/v1/agents/non-existent/ops", {
			method: "POST",
			body: JSON.stringify([]),
		});
		expect(res.status).toBe(404);
	});

	it("returns 400 for invalid operation data", async () => {
		const regRes = await api("/api/v1/agents/register", {
			method: "POST",
			body: JSON.stringify({ name: "builder", color: "#0000ff" }),
		});
		const agent = await regRes.json();

		const res = await api(`/api/v1/agents/${agent.id}/ops`, {
			method: "POST",
			body: JSON.stringify([{ invalid: "data" }]),
		});
		expect(res.status).toBe(400);
	});
});

describe("Ops Log (REST)", () => {
	it("returns empty log initially", async () => {
		const res = await api("/api/v1/ops/log");
		expect(res.status).toBe(200);
		const log = await res.json();
		expect(log).toEqual([]);
	});

	it("returns ops after submission", async () => {
		// Register and submit ops
		const regRes = await api("/api/v1/agents/register", {
			method: "POST",
			body: JSON.stringify({ name: "builder", color: "#0000ff" }),
		});
		const agent = await regRes.json();

		const now = Date.now();
		await api(`/api/v1/agents/${agent.id}/ops`, {
			method: "POST",
			body: JSON.stringify([
				{
					agent: agent.id,
					op: "create",
					timestamp: now,
					element: { type: "rect", x: 0, y: 0 },
				},
				{
					agent: agent.id,
					op: "create",
					timestamp: now + 1,
					element: { type: "circle", x: 50, y: 50 },
				},
			]),
		});

		// Get all ops
		const res = await api("/api/v1/ops/log");
		const log = await res.json();
		expect(log).toHaveLength(2);

		// Get last 1
		const res1 = await api("/api/v1/ops/log?last=1");
		const log1 = await res1.json();
		expect(log1).toHaveLength(1);
		expect(log1[0].timestamp).toBe(now + 1);
	});
});

describe("Unregister Agent (REST)", () => {
	it("deletes a registered agent", async () => {
		const regRes = await api("/api/v1/agents/register", {
			method: "POST",
			body: JSON.stringify({ name: "temp-agent", color: "#aaa" }),
		});
		const agent = await regRes.json();

		const delRes = await api(`/api/v1/agents/${agent.id}`, {
			method: "DELETE",
		});
		expect(delRes.status).toBe(204);

		// Verify gone
		const listRes = await api("/api/v1/agents");
		const agents = await listRes.json();
		expect(agents).toHaveLength(0);
	});

	it("returns 404 for non-existent agent", async () => {
		const res = await api("/api/v1/agents/non-existent", {
			method: "DELETE",
		});
		expect(res.status).toBe(404);
	});
});

describe("WS handler state management (unit)", () => {
	it("registerAgent generates unique IDs", async () => {
		const { registerAgent } = await import("../server/ws-handler.ts");
		const a1 = registerAgent({ name: "a", color: "#111" });
		const a2 = registerAgent({ name: "b", color: "#222" });
		expect(a1.id).not.toBe(a2.id);
		expect(a1.status).toBe("idle");
	});

	it("applyOperation handles create op", async () => {
		const { applyOperation, getOpsLog } = await import("../server/ws-handler.ts");
		applyOperation(
			{
				agent: "test",
				op: "create",
				timestamp: Date.now(),
				element: {
					type: "rect",
					x: 10,
					y: 20,
					width: 30,
					height: 40,
					props: {},
				},
			},
			state,
		);
		const elements = state.getAllElements();
		expect(elements).toHaveLength(1);
		expect(elements[0].type).toBe("rect");
		expect(elements[0].x).toBe(10);

		const log = getOpsLog();
		expect(log.length).toBeGreaterThan(0);
	});

	it("applyOperation handles delete op", async () => {
		const { applyOperation } = await import("../server/ws-handler.ts");
		// Create an element first
		const el = state.addElement({
			type: "rect",
			x: 0,
			y: 0,
			width: 10,
			height: 10,
			props: {},
		});

		applyOperation(
			{
				agent: "test",
				op: "delete",
				timestamp: Date.now(),
				id: el.id,
			},
			state,
		);
		expect(state.getElement(el.id)).toBeUndefined();
	});

	it("applyOperation handles update op", async () => {
		const { applyOperation } = await import("../server/ws-handler.ts");
		const el = state.addElement({
			type: "rect",
			x: 0,
			y: 0,
			width: 10,
			height: 10,
			props: {},
		});

		applyOperation(
			{
				agent: "test",
				op: "update",
				timestamp: Date.now(),
				id: el.id,
				element: { type: "rect", x: 99, y: 88 },
			},
			state,
		);
		const updated = state.getElement(el.id);
		expect(updated?.x).toBe(99);
		expect(updated?.y).toBe(88);
	});

	it("ops log respects circular buffer limit", async () => {
		const { applyOperation, getOpsLog } = await import("../server/ws-handler.ts");
		// Push 505 ops
		for (let i = 0; i < 505; i++) {
			applyOperation(
				{
					agent: "test",
					op: "create",
					timestamp: i,
					element: { type: "rect", x: i, y: 0 },
				},
				state,
			);
		}
		const log = getOpsLog();
		expect(log.length).toBeLessThanOrEqual(500);
	});
});

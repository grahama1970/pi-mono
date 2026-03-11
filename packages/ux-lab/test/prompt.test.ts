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

describe("POST /api/v1/prompt", () => {
	it('accepts a prompt with target "all" and returns delivered count', async () => {
		const res = await api("/api/v1/prompt", {
			method: "POST",
			body: JSON.stringify({ message: "fix the navbar", target: "all" }),
		});
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(typeof data.delivered_ws).toBe("number");
		// No WS clients connected in test, so 0 is expected
		expect(data.delivered_ws).toBe(0);
	});

	it("returns 400 for empty message", async () => {
		const res = await api("/api/v1/prompt", {
			method: "POST",
			body: JSON.stringify({ message: "", target: "all" }),
		});
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error).toBe("Validation failed");
	});

	it("returns 400 for missing message field", async () => {
		const res = await api("/api/v1/prompt", {
			method: "POST",
			body: JSON.stringify({ target: "all" }),
		});
		expect(res.status).toBe(400);
	});

	it("accepts a prompt targeting a specific agent", async () => {
		// Register an agent first
		const regRes = await api("/api/v1/agents/register", {
			method: "POST",
			body: JSON.stringify({ name: "navbar-agent", color: "#ff0000" }),
		});
		const agent = await regRes.json();

		const res = await api("/api/v1/prompt", {
			method: "POST",
			body: JSON.stringify({
				message: "use blue instead of red",
				target: agent.id,
			}),
		});
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(typeof data.delivered_ws).toBe("number");
	});

	it('defaults target to "all" when not provided', async () => {
		const res = await api("/api/v1/prompt", {
			method: "POST",
			body: JSON.stringify({ message: "make it bigger" }),
		});
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(typeof data.delivered_ws).toBe("number");
	});
});

import type { Server } from "http";
import { createServer } from "http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app, state } from "../server/index.ts";

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
});

async function api(path: string, options?: RequestInit) {
	return fetch(`${baseUrl}${path}`, {
		headers: { "Content-Type": "application/json" },
		...options,
	});
}

describe("Health", () => {
	it("returns status ok", async () => {
		const res = await api("/api/health");
		const data = await res.json();
		expect(res.status).toBe(200);
		expect(data.status).toBe("ok");
		expect(typeof data.elements).toBe("number");
		expect(typeof data.uptime).toBe("number");
	});
});

describe("CRUD elements", () => {
	it("creates, gets, updates, deletes an element", async () => {
		// Create
		const createRes = await api("/api/v1/elements", {
			method: "POST",
			body: JSON.stringify({ type: "rect", x: 10, y: 20 }),
		});
		expect(createRes.status).toBe(201);
		const created = await createRes.json();
		expect(created.id).toBeDefined();
		expect(created.type).toBe("rect");
		expect(created.x).toBe(10);
		expect(created.y).toBe(20);
		expect(created.width).toBe(100); // default
		expect(created.height).toBe(100); // default

		const id = created.id;

		// Get single
		const getRes = await api(`/api/v1/elements/${id}`);
		expect(getRes.status).toBe(200);
		const fetched = await getRes.json();
		expect(fetched.id).toBe(id);

		// Get all
		const listRes = await api("/api/v1/elements");
		expect(listRes.status).toBe(200);
		const list = await listRes.json();
		expect(list).toHaveLength(1);

		// Update
		const updateRes = await api(`/api/v1/elements/${id}`, {
			method: "PATCH",
			body: JSON.stringify({ x: 50, y: 60 }),
		});
		expect(updateRes.status).toBe(200);
		const updated = await updateRes.json();
		expect(updated.x).toBe(50);
		expect(updated.y).toBe(60);

		// Delete
		const deleteRes = await api(`/api/v1/elements/${id}`, {
			method: "DELETE",
		});
		expect(deleteRes.status).toBe(204);

		// 404 after delete
		const gone = await api(`/api/v1/elements/${id}`);
		expect(gone.status).toBe(404);
	});

	it("returns 404 for non-existent element GET", async () => {
		const res = await api("/api/v1/elements/nonexistent-id");
		expect(res.status).toBe(404);
	});

	it("returns 404 for non-existent element PATCH", async () => {
		const res = await api("/api/v1/elements/nonexistent-id", {
			method: "PATCH",
			body: JSON.stringify({ x: 1 }),
		});
		expect(res.status).toBe(404);
	});

	it("returns 404 for non-existent element DELETE", async () => {
		const res = await api("/api/v1/elements/nonexistent-id", {
			method: "DELETE",
		});
		expect(res.status).toBe(404);
	});
});

describe("Validation", () => {
	it("returns 400 for missing required fields on create", async () => {
		const res = await api("/api/v1/elements", {
			method: "POST",
			body: JSON.stringify({ x: 10 }),
		});
		expect(res.status).toBe(400);
		const data = await res.json();
		expect(data.error).toBe("Validation failed");
	});

	it("returns 400 for invalid export format", async () => {
		const res = await api("/api/v1/export", {
			method: "POST",
			body: JSON.stringify({ format: "invalid" }),
		});
		expect(res.status).toBe(400);
	});
});

describe("Undo / Redo", () => {
	it("undo removes created element, redo brings it back", async () => {
		// Create element
		const createRes = await api("/api/v1/elements", {
			method: "POST",
			body: JSON.stringify({ type: "circle", x: 5, y: 5 }),
		});
		const created = await createRes.json();

		// Undo
		const undoRes = await api("/api/v1/undo", { method: "POST" });
		expect(undoRes.status).toBe(200);
		const undoData = await undoRes.json();
		expect(undoData.success).toBe(true);
		expect(undoData.elements).toHaveLength(0);

		// Verify element is gone
		const goneRes = await api(`/api/v1/elements/${created.id}`);
		expect(goneRes.status).toBe(404);

		// Redo
		const redoRes = await api("/api/v1/redo", { method: "POST" });
		expect(redoRes.status).toBe(200);
		const redoData = await redoRes.json();
		expect(redoData.success).toBe(true);
		expect(redoData.elements).toHaveLength(1);
		expect(redoData.elements[0].id).toBe(created.id);
	});

	it("undo with empty history returns success false", async () => {
		const res = await api("/api/v1/undo", { method: "POST" });
		const data = await res.json();
		expect(data.success).toBe(false);
	});
});

describe("Save / Load", () => {
	it("round-trips: create elements, save, clear, load, elements restored", async () => {
		// Create two elements
		await api("/api/v1/elements", {
			method: "POST",
			body: JSON.stringify({ type: "rect", x: 1, y: 2 }),
		});
		await api("/api/v1/elements", {
			method: "POST",
			body: JSON.stringify({ type: "circle", x: 3, y: 4 }),
		});

		// Save
		const saveRes = await api("/api/v1/save");
		expect(saveRes.status).toBe(200);
		const saved = await saveRes.json();
		expect(Object.keys(saved.elements)).toHaveLength(2);

		// Clear by loading empty, then load saved state
		state.clear();
		const listEmpty = await api("/api/v1/elements");
		const emptyList = await listEmpty.json();
		expect(emptyList).toHaveLength(0);

		// Load
		const loadRes = await api("/api/v1/load", {
			method: "POST",
			body: JSON.stringify(saved),
		});
		expect(loadRes.status).toBe(200);
		const loadData = await loadRes.json();
		expect(loadData.success).toBe(true);
		expect(loadData.elements).toHaveLength(2);

		// Verify elements accessible
		const listRes = await api("/api/v1/elements");
		const list = await listRes.json();
		expect(list).toHaveLength(2);
	});
});

describe("Export", () => {
	it("exports JSON format with elements", async () => {
		await api("/api/v1/elements", {
			method: "POST",
			body: JSON.stringify({ type: "rect", x: 0, y: 0, width: 50, height: 50 }),
		});

		const res = await api("/api/v1/export", {
			method: "POST",
			body: JSON.stringify({ format: "json" }),
		});
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.format).toBe("json");
		expect(data.content).toHaveLength(1);
		expect(data.content[0].type).toBe("rect");
	});

	it("exports react format as string", async () => {
		await api("/api/v1/elements", {
			method: "POST",
			body: JSON.stringify({ type: "rect", x: 0, y: 0 }),
		});

		const res = await api("/api/v1/export", {
			method: "POST",
			body: JSON.stringify({ format: "react" }),
		});
		const data = await res.json();
		expect(data.format).toBe("react");
		expect(typeof data.content).toBe("string");
		expect(data.content).toContain("export default function Canvas");
	});

	it("exports svg format as string", async () => {
		await api("/api/v1/elements", {
			method: "POST",
			body: JSON.stringify({ type: "rect", x: 0, y: 0 }),
		});

		const res = await api("/api/v1/export", {
			method: "POST",
			body: JSON.stringify({ format: "svg" }),
		});
		const data = await res.json();
		expect(data.format).toBe("svg");
		expect(typeof data.content).toBe("string");
		expect(data.content).toContain("<svg");
	});
});

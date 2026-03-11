import { existsSync, mkdtempSync, unlinkSync, writeFileSync } from "fs";
import type { Server } from "http";
import { createServer } from "http";
import { tmpdir } from "os";
import { join } from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { app, state } from "../server/index.ts";
import { resetScreenshotStore } from "../server/routes/composition.ts";

let server: Server;
let baseUrl: string;

// A minimal 1x1 red PNG as base64
const TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

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
	resetScreenshotStore();
});

async function api(path: string, options?: RequestInit) {
	return fetch(`${baseUrl}${path}`, {
		headers: { "Content-Type": "application/json" },
		...options,
	});
}

describe("Screenshot endpoints", () => {
	it("POST /api/v1/screenshot stores valid base64 data", async () => {
		const res = await api("/api/v1/screenshot", {
			method: "POST",
			body: JSON.stringify({ dataUrl: TINY_PNG_DATA_URL }),
		});
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.stored).toBe(true);
		expect(data.size).toBeGreaterThan(0);
	});

	it("POST /api/v1/screenshot rejects invalid data", async () => {
		const res = await api("/api/v1/screenshot", {
			method: "POST",
			body: JSON.stringify({ dataUrl: "not-a-data-url" }),
		});
		expect(res.status).toBe(400);
	});

	it("GET /api/v1/screenshot returns 404 when none stored", async () => {
		const res = await api("/api/v1/screenshot");
		expect(res.status).toBe(404);
	});

	it("GET /api/v1/screenshot returns stored data after POST", async () => {
		await api("/api/v1/screenshot", {
			method: "POST",
			body: JSON.stringify({ dataUrl: TINY_PNG_DATA_URL }),
		});

		const res = await api("/api/v1/screenshot");
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.dataUrl).toBe(TINY_PNG_DATA_URL);
		expect(data.timestamp).toBeGreaterThan(0);
	});
});

describe("Review endpoint", () => {
	it("POST /api/v1/review returns 404 when no screenshot", async () => {
		const res = await api("/api/v1/review", { method: "POST" });
		expect(res.status).toBe(404);
	});

	it("POST /api/v1/review returns path and command when screenshot exists", async () => {
		// Store a screenshot first
		await api("/api/v1/screenshot", {
			method: "POST",
			body: JSON.stringify({ dataUrl: TINY_PNG_DATA_URL }),
		});

		const res = await api("/api/v1/review", { method: "POST" });
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.screenshot_path).toMatch(/^\/tmp\/ux-lab-review-\d+\.png$/);
		expect(data.review_command).toContain("review-design/run.sh");
		expect(data.review_command).toContain("--image");
		expect(data.review_command).toContain(data.screenshot_path);

		// Verify the file was actually written
		expect(existsSync(data.screenshot_path)).toBe(true);

		// Cleanup
		unlinkSync(data.screenshot_path);
	});
});

describe("Test endpoint", () => {
	it("POST /api/v1/test returns 404 when no screenshot", async () => {
		const res = await api("/api/v1/test", { method: "POST" });
		expect(res.status).toBe(404);
	});

	it("POST /api/v1/test returns path and command when screenshot exists", async () => {
		await api("/api/v1/screenshot", {
			method: "POST",
			body: JSON.stringify({ dataUrl: TINY_PNG_DATA_URL }),
		});

		const res = await api("/api/v1/test", { method: "POST" });
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.screenshot_path).toMatch(/^\/tmp\/ux-lab-test-\d+\.png$/);
		expect(data.test_command).toContain("test-interactions/run.sh");
		expect(data.test_command).toContain("--image");
		expect(data.test_command).toContain(data.screenshot_path);

		expect(existsSync(data.screenshot_path)).toBe(true);
		unlinkSync(data.screenshot_path);
	});
});

describe("Load-brief endpoint", () => {
	it("POST /api/v1/load-brief with valid file returns content and sections", async () => {
		// Create a temporary markdown file
		const tmpDir = mkdtempSync(join(tmpdir(), "ux-lab-test-"));
		const tmpFile = join(tmpDir, "DESIGN_BOARD.md");
		writeFileSync(
			tmpFile,
			"# My Design\n\nSome content.\n\n## Layout\n\nMore content.\n\n### Colors\n\nEven more.\n",
		);

		const res = await api("/api/v1/load-brief", {
			method: "POST",
			body: JSON.stringify({ path: tmpFile }),
		});
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.content).toContain("# My Design");
		expect(data.sections).toEqual(["My Design", "Layout", "Colors"]);

		// Cleanup
		unlinkSync(tmpFile);
	});

	it("POST /api/v1/load-brief with invalid path returns 404", async () => {
		const res = await api("/api/v1/load-brief", {
			method: "POST",
			body: JSON.stringify({ path: "/nonexistent/DESIGN_BOARD.md" }),
		});
		expect(res.status).toBe(404);
	});

	it("POST /api/v1/load-brief with empty path returns 400", async () => {
		const res = await api("/api/v1/load-brief", {
			method: "POST",
			body: JSON.stringify({ path: "" }),
		});
		expect(res.status).toBe(400);
	});
});

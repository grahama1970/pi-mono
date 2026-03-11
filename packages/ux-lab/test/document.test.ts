import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addPage,
	createDocument,
	documentFromCurrentState,
	loadDocument,
	removePage,
	saveDocument,
} from "../server/document.ts";
import { app, state } from "../server/index.ts";
import { setCurrentDocument } from "../server/routes/document.ts";
import { clearState as clearWsState, registerAgent } from "../server/ws-handler.ts";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

beforeEach(() => {
	state.clear();
	clearWsState();
	setCurrentDocument(null);
});

describe("createDocument", () => {
	it("returns a valid structure with 1 default page", () => {
		const doc = createDocument("Test Design");
		expect(doc.version).toBe(1);
		expect(doc.name).toBe("Test Design");
		expect(doc.theme).toBe("nvis-dark");
		expect(doc.pages).toHaveLength(1);
		expect(doc.pages[0].name).toBe("Page 1");
		expect(doc.pages[0].id).toMatch(UUID_REGEX);
		expect(doc.pages[0].elements).toEqual({});
		expect(doc.pages[0].agents).toEqual([]);
		expect(doc.pages[0].ops_log).toEqual([]);
		expect(doc.variables).toEqual({ colors: {}, spacing: {} });
		expect(doc.created).toBeTruthy();
		expect(doc.modified).toBeTruthy();
	});
});

describe("addPage", () => {
	it("adds a page to the document", () => {
		const doc = createDocument("Test");
		const updated = addPage(doc, "Page 2");
		expect(updated.pages).toHaveLength(2);
		expect(updated.pages[1].name).toBe("Page 2");
		expect(updated.pages[1].id).toMatch(UUID_REGEX);
		expect(updated.pages[1].elements).toEqual({});
	});

	it("does not mutate the original document", () => {
		const doc = createDocument("Test");
		const updated = addPage(doc, "Page 2");
		expect(doc.pages).toHaveLength(1);
		expect(updated.pages).toHaveLength(2);
	});
});

describe("removePage", () => {
	it("removes a page from the document", () => {
		let doc = createDocument("Test");
		doc = addPage(doc, "Page 2");
		const pageId = doc.pages[1].id;
		const updated = removePage(doc, pageId);
		expect(updated.pages).toHaveLength(1);
		expect(updated.pages[0].name).toBe("Page 1");
	});

	it("throws when removing the last page", () => {
		const doc = createDocument("Test");
		expect(() => removePage(doc, doc.pages[0].id)).toThrow("Cannot remove the last page");
	});

	it("throws when page id not found", () => {
		let doc = createDocument("Test");
		doc = addPage(doc, "Page 2");
		expect(() => removePage(doc, "nonexistent")).toThrow("Page not found");
	});
});

describe("saveDocument", () => {
	it("produces valid JSON with 2-space indent", () => {
		const doc = createDocument("Test");
		const json = saveDocument(doc);
		const parsed = JSON.parse(json);
		expect(parsed.version).toBe(1);
		expect(parsed.name).toBe("Test");
		// Check 2-space indent
		expect(json).toContain('  "version"');
	});
});

describe("loadDocument", () => {
	it("parses valid JSON into a document", () => {
		const doc = createDocument("Round Trip");
		const json = saveDocument(doc);
		const loaded = loadDocument(json);
		expect(loaded.name).toBe("Round Trip");
		expect(loaded.version).toBe(1);
		expect(loaded.pages).toHaveLength(1);
	});

	it("round-trips: save -> load -> save produces equivalent output", () => {
		let doc = createDocument("RT Test");
		doc = addPage(doc, "Page 2");
		const json1 = saveDocument(doc);
		const loaded = loadDocument(json1);
		const json2 = saveDocument(loaded);
		expect(JSON.parse(json1)).toEqual(JSON.parse(json2));
	});

	it("rejects invalid JSON", () => {
		expect(() => loadDocument("not json")).toThrow();
	});

	it("rejects missing required fields", () => {
		expect(() => loadDocument(JSON.stringify({ version: 1 }))).toThrow();
	});

	it("rejects wrong version", () => {
		const doc = createDocument("Test");
		const json = saveDocument(doc);
		const parsed = JSON.parse(json);
		parsed.version = 2;
		expect(() => loadDocument(JSON.stringify(parsed))).toThrow();
	});
});

describe("documentFromCurrentState", () => {
	it("captures current canvas elements into doc", () => {
		state.addElement({ type: "rect", x: 10, y: 20, width: 100, height: 50, props: { fill: "#ff0000" } });
		state.addElement({ type: "circle", x: 200, y: 300, width: 80, height: 80, props: {} });

		const doc = documentFromCurrentState("Snapshot", state);
		expect(doc.name).toBe("Snapshot");
		expect(doc.version).toBe(1);
		expect(doc.pages).toHaveLength(1);
		const page = doc.pages[0];
		expect(Object.keys(page.elements)).toHaveLength(2);
	});

	it("captures registered agents", () => {
		registerAgent({ name: "test-agent", color: "#00ff00" });
		const doc = documentFromCurrentState("Agent Test", state);
		expect(doc.pages[0].agents).toHaveLength(1);
		expect(doc.pages[0].agents[0].name).toBe("test-agent");
	});
});

describe("REST: POST /api/v1/document/save", () => {
	it("returns valid UxDesignDocument", async () => {
		state.addElement({ type: "rect", x: 0, y: 0, width: 100, height: 100, props: {} });

		const res = await request(app).post("/api/v1/document/save").send({ name: "API Test" }).expect(200);

		expect(res.body.version).toBe(1);
		expect(res.body.name).toBe("API Test");
		expect(res.body.pages).toHaveLength(1);
		expect(Object.keys(res.body.pages[0].elements)).toHaveLength(1);
	});

	it("defaults name to Untitled when not provided", async () => {
		const res = await request(app).post("/api/v1/document/save").send({}).expect(200);

		expect(res.body.name).toBe("Untitled");
	});
});

describe("REST: POST /api/v1/document/load", () => {
	it("restores elements from document content", async () => {
		// Create a doc with elements
		const doc = createDocument("Load Test");
		doc.pages[0].elements = {
			e1: { id: "e1", type: "rect", x: 10, y: 20, width: 100, height: 50, props: { fill: "blue" } },
			e2: { id: "e2", type: "circle", x: 200, y: 300, width: 80, height: 80, props: {} },
		};

		const res = await request(app)
			.post("/api/v1/document/load")
			.send({ content: saveDocument(doc) })
			.expect(200);

		expect(res.body.success).toBe(true);
		expect(res.body.elements).toHaveLength(2);
		// Verify canvas state was updated
		expect(Object.keys(state.elements)).toHaveLength(2);
	});

	it("rejects invalid document content", async () => {
		const res = await request(app).post("/api/v1/document/load").send({ content: '{"invalid": true}' }).expect(400);

		expect(res.body.error).toContain("Invalid document");
	});

	it("rejects missing content and path", async () => {
		const _res = await request(app).post("/api/v1/document/load").send({}).expect(400);
	});
});

describe("REST: multi-page CRUD", () => {
	it("GET /api/v1/pages returns empty when no document", async () => {
		const res = await request(app).get("/api/v1/pages").expect(200);

		expect(res.body.pages).toEqual([]);
	});

	it("POST /api/v1/pages adds a page", async () => {
		// First save a doc to establish current document
		await request(app).post("/api/v1/document/save").send({ name: "Multi Page" });

		const res = await request(app).post("/api/v1/pages").send({ name: "Page 2" }).expect(200);

		expect(res.body.pages).toHaveLength(2);
		expect(res.body.pages[1].name).toBe("Page 2");
	});

	it("POST /api/v1/pages creates document if none exists", async () => {
		const res = await request(app).post("/api/v1/pages").send({ name: "First Page" }).expect(200);

		// Default doc has Page 1, plus the new "First Page"
		expect(res.body.pages).toHaveLength(2);
	});

	it("DELETE /api/v1/pages/:id removes a page", async () => {
		// Save doc, add a second page
		await request(app).post("/api/v1/document/save").send({ name: "Delete Test" });

		const addRes = await request(app).post("/api/v1/pages").send({ name: "Page 2" });

		const pageId = addRes.body.pages[1].id;

		const res = await request(app).delete(`/api/v1/pages/${pageId}`).expect(200);

		expect(res.body.pages).toHaveLength(1);
	});

	it("DELETE /api/v1/pages/:id errors on last page", async () => {
		await request(app).post("/api/v1/document/save").send({ name: "Last Page Test" });

		const pagesRes = await request(app).get("/api/v1/pages");
		const pageId = pagesRes.body.pages[0].id;

		const res = await request(app).delete(`/api/v1/pages/${pageId}`).expect(400);

		expect(res.body.error).toContain("Cannot remove the last page");
	});

	it("DELETE /api/v1/pages/:id errors when no document", async () => {
		const res = await request(app).delete("/api/v1/pages/nonexistent").expect(400);

		expect(res.body.error).toBe("No document loaded");
	});
});

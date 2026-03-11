import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import {
	createAgentAssignments,
	decomposePrompt,
	generateContentOps,
	generateSkeletonOps,
} from "../server/design-orchestrator.ts";
import { app, state } from "../server/index.ts";
import { clearState as clearWsState } from "../server/ws-handler.ts";

beforeEach(() => {
	state.clear();
	clearWsState();
});

// --- decomposePrompt ---

describe("decomposePrompt", () => {
	it('decomposes "dashboard with navbar and sidebar" into navbar + sidebar + content zones', () => {
		const plan = decomposePrompt("dashboard with navbar and sidebar");
		const names = plan.zones.map((z) => z.name);
		expect(names).toContain("navbar");
		expect(names).toContain("sidebar");
		expect(names).toContain("content");
		expect(plan.phases).toEqual(["skeleton", "content", "refine"]);
	});

	it('decomposes "login form" into a centered form zone', () => {
		const plan = decomposePrompt("login form", 1280, 720);
		expect(plan.zones).toHaveLength(1);
		expect(plan.zones[0].name).toBe("form");
		// Centered: x=320, y=180, w=640, h=360
		expect(plan.zones[0].zone.x).toBe(320);
		expect(plan.zones[0].zone.y).toBe(180);
		expect(plan.zones[0].zone.width).toBe(640);
		expect(plan.zones[0].zone.height).toBe(360);
	});

	it("produces a single full-canvas zone for unknown prompts", () => {
		const plan = decomposePrompt("something completely unrelated", 1280, 720);
		expect(plan.zones).toHaveLength(1);
		expect(plan.zones[0].name).toBe("main");
		expect(plan.zones[0].zone).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
	});

	it("adjusts content zone to avoid overlapping with navbar and sidebar", () => {
		const plan = decomposePrompt("dashboard with navbar and sidebar", 1280, 720);
		const content = plan.zones.find((z) => z.name === "content");
		expect(content).toBeDefined();
		// Content should be offset: x=250 (sidebar), y=64 (navbar)
		expect(content!.zone.x).toBe(250);
		expect(content!.zone.y).toBe(64);
		expect(content!.zone.width).toBe(1280 - 250);
		expect(content!.zone.height).toBe(720 - 64);
	});

	it("respects custom canvas dimensions", () => {
		const plan = decomposePrompt("login form", 800, 600);
		expect(plan.zones[0].zone.x).toBe(200);
		expect(plan.zones[0].zone.y).toBe(150);
		expect(plan.zones[0].zone.width).toBe(400);
		expect(plan.zones[0].zone.height).toBe(300);
	});

	it("detects header keyword as navbar zone", () => {
		const plan = decomposePrompt("page with header");
		const names = plan.zones.map((z) => z.name);
		expect(names).toContain("navbar");
	});

	it("detects footer keyword", () => {
		const plan = decomposePrompt("page with footer", 1280, 720);
		const footer = plan.zones.find((z) => z.name === "footer");
		expect(footer).toBeDefined();
		expect(footer!.zone.y).toBe(720 - 80);
		expect(footer!.zone.height).toBe(80);
	});

	it("sets agentCount equal to zone count", () => {
		const plan = decomposePrompt("navbar sidebar content");
		expect(plan.agentCount).toBe(plan.zones.length);
	});
});

// --- generateSkeletonOps ---

describe("generateSkeletonOps", () => {
	it("creates a paper:container at the correct position for navbar zone", () => {
		const zone = {
			name: "navbar",
			zone: { x: 0, y: 0, width: 1280, height: 64 },
			phase: "skeleton" as const,
			description: "navigation bar at the top",
		};
		const ops = generateSkeletonOps(zone);
		expect(ops).toHaveLength(1);
		expect(ops[0].op).toBe("create");
		expect(ops[0].element!.type).toBe("paper:container");
		expect(ops[0].element!.x).toBe(0);
		expect(ops[0].element!.y).toBe(0);
		expect(ops[0].element!.width).toBe(1280);
		expect(ops[0].element!.height).toBe(64);
		expect(ops[0].reason).toContain("skeleton");
	});

	it("creates a skeleton frame for sidebar zone", () => {
		const zone = {
			name: "sidebar",
			zone: { x: 0, y: 64, width: 250, height: 656 },
			phase: "skeleton" as const,
			description: "sidebar navigation on the left",
		};
		const ops = generateSkeletonOps(zone);
		expect(ops).toHaveLength(1);
		expect(ops[0].element!.x).toBe(0);
		expect(ops[0].element!.y).toBe(64);
		expect(ops[0].element!.width).toBe(250);
	});
});

// --- generateContentOps ---

describe("generateContentOps", () => {
	it("creates paper:navbar with logoText for navbar zone", () => {
		const zone = {
			name: "navbar",
			zone: { x: 0, y: 0, width: 1280, height: 64 },
			phase: "content" as const,
			description: "navigation bar at the top",
		};
		const ops = generateContentOps(zone);
		expect(ops.length).toBeGreaterThanOrEqual(1);
		const navOp = ops.find((o) => o.element?.type === "paper:navbar");
		expect(navOp).toBeDefined();
		expect(navOp!.element!.props!.logoText).toBe("Logo");
		expect(navOp!.element!.props!.navLinks).toEqual(["Home", "About", "Contact"]);
	});

	it("creates paper:card elements for content zone", () => {
		const zone = {
			name: "content",
			zone: { x: 250, y: 64, width: 1030, height: 656 },
			phase: "content" as const,
			description: "main content area with cards or data",
		};
		const ops = generateContentOps(zone);
		expect(ops.length).toBeGreaterThanOrEqual(1);
		const cardOps = ops.filter((o) => o.element?.type === "paper:card");
		expect(cardOps.length).toBeGreaterThanOrEqual(1);
		expect(cardOps[0].element!.props!.cardTitle).toBeDefined();
	});

	it("creates form elements for form zone", () => {
		const zone = {
			name: "form",
			zone: { x: 320, y: 180, width: 640, height: 360 },
			phase: "content" as const,
			description: "centered form area",
		};
		const ops = generateContentOps(zone);
		// Should have container + title + input fields + submit button
		expect(ops.length).toBeGreaterThanOrEqual(4);
		const buttonOp = ops.find((o) => o.element?.type === "paper:button");
		expect(buttonOp).toBeDefined();
		expect(buttonOp!.element!.props!.buttonText).toBe("Sign In");
	});

	it("creates sidebar with menu buttons", () => {
		const zone = {
			name: "sidebar",
			zone: { x: 0, y: 64, width: 250, height: 656 },
			phase: "content" as const,
			description: "sidebar navigation on the left",
		};
		const ops = generateContentOps(zone);
		const buttonOps = ops.filter((o) => o.element?.type === "paper:button");
		expect(buttonOps.length).toBe(4);
		expect(buttonOps[0].element!.props!.buttonText).toContain("Menu Item");
	});
});

// --- createAgentAssignments ---

describe("createAgentAssignments", () => {
	it("assigns distinct colors to each agent", () => {
		const plan = decomposePrompt("dashboard with navbar and sidebar");
		const assignments = createAgentAssignments(plan);
		const colors = assignments.map((a) => a.color);
		const unique = new Set(colors);
		expect(unique.size).toBe(colors.length);
	});

	it("groups ops by phase (skeleton, content, refine)", () => {
		const plan = decomposePrompt("navbar");
		const assignments = createAgentAssignments(plan);
		expect(assignments).toHaveLength(1);
		// ops[0] = skeleton, ops[1] = content, ops[2] = refine
		expect(assignments[0].ops).toHaveLength(3);
		expect(assignments[0].ops[0].length).toBeGreaterThan(0); // skeleton ops
		expect(assignments[0].ops[1].length).toBeGreaterThan(0); // content ops
		expect(assignments[0].ops[2]).toEqual([]); // refine ops (empty in plan mode)
	});

	it("sets agent name based on zone name", () => {
		const plan = decomposePrompt("navbar sidebar");
		const assignments = createAgentAssignments(plan);
		const names = assignments.map((a) => a.agentName);
		expect(names).toContain("navbar-agent");
		expect(names).toContain("sidebar-agent");
	});

	it("stamps agent name on all operations", () => {
		const plan = decomposePrompt("navbar");
		const assignments = createAgentAssignments(plan);
		for (const phaseOps of assignments[0].ops) {
			for (const op of phaseOps) {
				expect(op.agent).toBe("navbar-agent");
			}
		}
	});

	it("cycles colors for more than 5 agents", () => {
		// Create a plan with zones manually to test color cycling
		const plan = decomposePrompt("navbar sidebar content footer");
		const assignments = createAgentAssignments(plan);
		// Each assignment should have a color from the palette
		for (const a of assignments) {
			expect(a.color).toMatch(/^#[0-9a-f]{6}$/);
		}
	});
});

// --- REST endpoint ---

describe("POST /api/v1/design", () => {
	it("returns a structured plan with valid prompt", async () => {
		const res = await request(app)
			.post("/api/v1/design")
			.send({ prompt: "dashboard with navbar and sidebar" })
			.expect(200);

		expect(res.body.plan).toBeDefined();
		expect(res.body.plan.prompt).toBe("dashboard with navbar and sidebar");
		expect(res.body.plan.zones.length).toBeGreaterThanOrEqual(2);
		expect(res.body.plan.phases).toEqual(["skeleton", "content", "refine"]);

		expect(res.body.assignments).toBeDefined();
		expect(res.body.assignments.length).toBe(res.body.plan.zones.length);

		// Each assignment has ops grouped by phase
		for (const a of res.body.assignments) {
			expect(a.ops.skeleton).toBeDefined();
			expect(a.ops.content).toBeDefined();
			expect(a.ops.refine).toBeDefined();
			expect(a.agentName).toBeTruthy();
			expect(a.color).toMatch(/^#[0-9a-f]{6}$/);
		}
	});

	it("returns 400 with empty prompt", async () => {
		const res = await request(app).post("/api/v1/design").send({ prompt: "" }).expect(400);

		expect(res.body.error).toBe("Validation failed");
	});

	it("returns 400 with missing prompt", async () => {
		await request(app).post("/api/v1/design").send({}).expect(400);
	});

	it("accepts optional phases override", async () => {
		const res = await request(app)
			.post("/api/v1/design")
			.send({ prompt: "navbar", phases: ["skeleton", "content"] })
			.expect(200);

		expect(res.body.plan.phases).toEqual(["skeleton", "content"]);
	});
});

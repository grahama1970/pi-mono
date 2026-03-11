import { describe, expect, it } from "vitest";
import { statusColor, zoneToScreen } from "../src/canvas/AgentOverlay";
import { lastOpReason, opsCountForAgent, statusDisplayColor } from "../src/components/AgentPanel";
import { NVIS } from "../src/theme";
import type { AgentZone, CanvasOperation } from "../src/types";

describe("AgentOverlay utilities", () => {
	describe("statusColor", () => {
		it("returns green for working", () => {
			expect(statusColor("working")).toBe(NVIS.GREEN);
		});

		it("returns gray for idle", () => {
			expect(statusColor("idle")).toBe(NVIS.DIM);
		});

		it("returns red for error", () => {
			expect(statusColor("error")).toBe(NVIS.RED);
		});

		it("returns green for done", () => {
			expect(statusColor("done")).toBe(NVIS.GREEN);
		});
	});

	describe("zoneToScreen", () => {
		it("computes screen coordinates at zoom=1, no pan", () => {
			const zone: AgentZone = { x: 100, y: 200, width: 300, height: 150 };
			const viewport = { x: 0, y: 0, zoom: 1 };
			const result = zoneToScreen(zone, viewport);
			expect(result).toEqual({ left: 100, top: 200, width: 300, height: 150 });
		});

		it("applies zoom correctly", () => {
			const zone: AgentZone = { x: 100, y: 200, width: 300, height: 150 };
			const viewport = { x: 0, y: 0, zoom: 2 };
			const result = zoneToScreen(zone, viewport);
			expect(result).toEqual({ left: 200, top: 400, width: 600, height: 300 });
		});

		it("applies pan offset correctly", () => {
			const zone: AgentZone = { x: 100, y: 200, width: 300, height: 150 };
			const viewport = { x: 50, y: -30, zoom: 1 };
			const result = zoneToScreen(zone, viewport);
			expect(result).toEqual({ left: 150, top: 170, width: 300, height: 150 });
		});

		it("applies both zoom and pan", () => {
			const zone: AgentZone = { x: 10, y: 20, width: 50, height: 40 };
			const viewport = { x: 100, y: 200, zoom: 0.5 };
			const result = zoneToScreen(zone, viewport);
			expect(result).toEqual({ left: 105, top: 210, width: 25, height: 20 });
		});
	});
});

describe("AgentPanel utilities", () => {
	describe("statusDisplayColor", () => {
		it("maps working to green", () => {
			expect(statusDisplayColor("working")).toBe(NVIS.GREEN);
		});

		it("maps idle to gray", () => {
			expect(statusDisplayColor("idle")).toBe(NVIS.DIM);
		});

		it("maps error to red", () => {
			expect(statusDisplayColor("error")).toBe(NVIS.RED);
		});

		it("maps done to green", () => {
			expect(statusDisplayColor("done")).toBe(NVIS.GREEN);
		});
	});

	describe("opsCountForAgent", () => {
		const ops: CanvasOperation[] = [
			{ agent: "a1", op: "create", timestamp: 1 },
			{ agent: "a2", op: "create", timestamp: 2 },
			{ agent: "a1", op: "update", timestamp: 3 },
			{ agent: "a1", op: "delete", timestamp: 4 },
		];

		it("returns correct count for agent with ops", () => {
			expect(opsCountForAgent(ops, "a1")).toBe(3);
		});

		it("returns correct count for another agent", () => {
			expect(opsCountForAgent(ops, "a2")).toBe(1);
		});

		it("returns 0 for agent with no ops", () => {
			expect(opsCountForAgent(ops, "a3")).toBe(0);
		});

		it("returns 0 for empty ops array", () => {
			expect(opsCountForAgent([], "a1")).toBe(0);
		});
	});

	describe("lastOpReason", () => {
		const ops: CanvasOperation[] = [
			{ agent: "a1", op: "create", timestamp: 1, reason: "add header" },
			{ agent: "a2", op: "create", timestamp: 2, reason: "add footer" },
			{ agent: "a1", op: "update", timestamp: 3 },
			{ agent: "a1", op: "update", timestamp: 4, reason: "fix alignment" },
		];

		it("returns the most recent op reason for agent", () => {
			expect(lastOpReason(ops, "a1")).toBe("fix alignment");
		});

		it("returns reason for a different agent", () => {
			expect(lastOpReason(ops, "a2")).toBe("add footer");
		});

		it("returns undefined if agent has no ops with reason", () => {
			const noReasonOps: CanvasOperation[] = [{ agent: "a1", op: "create", timestamp: 1 }];
			expect(lastOpReason(noReasonOps, "a1")).toBeUndefined();
		});

		it("returns undefined for unknown agent", () => {
			expect(lastOpReason(ops, "a99")).toBeUndefined();
		});

		it("returns undefined for empty ops array", () => {
			expect(lastOpReason([], "a1")).toBeUndefined();
		});
	});
});

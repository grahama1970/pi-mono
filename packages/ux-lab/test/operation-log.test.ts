import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { filterOps } from "../src/components/OperationLog";
import { useAgentStore } from "../src/store/agentStore";
import type { CanvasOperation } from "../src/types";
import { timeAgo } from "../src/utils/timeago";

function makeOp(overrides: Partial<CanvasOperation> = {}): CanvasOperation {
	return {
		agent: overrides.agent ?? "agent-1",
		op: overrides.op ?? "create",
		timestamp: overrides.timestamp ?? Date.now(),
		...overrides,
	};
}

describe("timeAgo", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-03-10T12:00:00Z"));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns "just now" for <5 seconds', () => {
		expect(timeAgo(Date.now() - 0)).toBe("just now");
		expect(timeAgo(Date.now() - 2000)).toBe("just now");
		expect(timeAgo(Date.now() - 4999)).toBe("just now");
	});

	it("returns seconds for 5-59s", () => {
		expect(timeAgo(Date.now() - 5000)).toBe("5s ago");
		expect(timeAgo(Date.now() - 30000)).toBe("30s ago");
		expect(timeAgo(Date.now() - 59000)).toBe("59s ago");
	});

	it("returns minutes for 1-59m", () => {
		expect(timeAgo(Date.now() - 60000)).toBe("1m ago");
		expect(timeAgo(Date.now() - 5 * 60000)).toBe("5m ago");
		expect(timeAgo(Date.now() - 59 * 60000)).toBe("59m ago");
	});

	it("returns hours for 1-23h", () => {
		expect(timeAgo(Date.now() - 3600000)).toBe("1h ago");
		expect(timeAgo(Date.now() - 12 * 3600000)).toBe("12h ago");
		expect(timeAgo(Date.now() - 23 * 3600000)).toBe("23h ago");
	});

	it("returns days for 24h+", () => {
		expect(timeAgo(Date.now() - 24 * 3600000)).toBe("1d ago");
		expect(timeAgo(Date.now() - 7 * 24 * 3600000)).toBe("7d ago");
	});
});

describe("filterOps", () => {
	const ops: CanvasOperation[] = [
		makeOp({ agent: "navbar-agent", op: "create", timestamp: 1 }),
		makeOp({ agent: "layout-agent", op: "update", timestamp: 2 }),
		makeOp({ agent: "navbar-agent", op: "delete", timestamp: 3 }),
		makeOp({ agent: "style-agent", op: "select", timestamp: 4 }),
	];

	it('returns all ops when filter is "all"', () => {
		expect(filterOps(ops, "all")).toHaveLength(4);
	});

	it("filters by agent id", () => {
		const result = filterOps(ops, "navbar-agent");
		expect(result).toHaveLength(2);
		expect(result.every((o) => o.agent === "navbar-agent")).toBe(true);
	});

	it("returns empty array for unknown agent", () => {
		expect(filterOps(ops, "ghost")).toHaveLength(0);
	});

	it("returns empty array when ops is empty", () => {
		expect(filterOps([], "navbar-agent")).toHaveLength(0);
	});
});

describe("operation ordering and circular buffer", () => {
	beforeEach(() => {
		useAgentStore.setState({ agents: {}, ops: [], corrections: [] });
	});

	it("ops are displayed in insertion order", () => {
		const store = useAgentStore.getState();
		store.logOperation(makeOp({ timestamp: 100 }));
		store.logOperation(makeOp({ timestamp: 200 }));
		store.logOperation(makeOp({ timestamp: 300 }));

		const ops = useAgentStore.getState().ops;
		expect(ops[0].timestamp).toBe(100);
		expect(ops[1].timestamp).toBe(200);
		expect(ops[2].timestamp).toBe(300);
	});

	it("circular buffer keeps last 200 ops when 200+ are logged", () => {
		const store = useAgentStore.getState();
		for (let i = 0; i < 250; i++) {
			store.logOperation(makeOp({ timestamp: i }));
		}

		const ops = useAgentStore.getState().ops;
		expect(ops).toHaveLength(200);
		// First 50 evicted; first remaining is timestamp=50
		expect(ops[0].timestamp).toBe(50);
		expect(ops[199].timestamp).toBe(249);
	});

	it("filtering works correctly on circular buffer contents", () => {
		const store = useAgentStore.getState();
		for (let i = 0; i < 210; i++) {
			store.logOperation(
				makeOp({
					agent: i % 2 === 0 ? "even-agent" : "odd-agent",
					timestamp: i,
				}),
			);
		}

		const ops = useAgentStore.getState().ops;
		expect(ops).toHaveLength(200);

		const evenOps = filterOps(ops, "even-agent");
		const oddOps = filterOps(ops, "odd-agent");
		expect(evenOps.length + oddOps.length).toBe(200);
		// The evicted 10 ops (0..9) were 5 even + 5 odd
		expect(evenOps).toHaveLength(100);
		expect(oddOps).toHaveLength(100);
	});
});

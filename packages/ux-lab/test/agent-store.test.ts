import { beforeEach, describe, expect, it } from "vitest";
import { useAgentStore } from "../src/store/agentStore";
import type { AgentRegistration, CanvasOperation, CourseCorrection } from "../src/types";

function makeAgent(overrides: Partial<AgentRegistration> = {}): AgentRegistration {
	return {
		id: overrides.id ?? "agent-1",
		name: overrides.name ?? "test-agent",
		color: overrides.color ?? "#ff0000",
		status: overrides.status ?? "idle",
		...overrides,
	};
}

function makeOp(overrides: Partial<CanvasOperation> = {}): CanvasOperation {
	return {
		agent: overrides.agent ?? "agent-1",
		op: overrides.op ?? "create",
		timestamp: overrides.timestamp ?? Date.now(),
		...overrides,
	};
}

function makeCorrection(overrides: Partial<CourseCorrection> = {}): CourseCorrection {
	return {
		from: overrides.from ?? "human",
		target: overrides.target ?? "all",
		message: overrides.message ?? "fix the layout",
		timestamp: overrides.timestamp ?? Date.now(),
		...overrides,
	};
}

describe("agentStore", () => {
	beforeEach(() => {
		useAgentStore.setState({ agents: {}, ops: [], corrections: [] });
	});

	describe("registerAgent", () => {
		it("adds agent to the agents map", () => {
			const agent = makeAgent({ id: "nav", name: "navbar-agent" });
			useAgentStore.getState().registerAgent(agent);
			expect(useAgentStore.getState().agents.nav).toEqual(agent);
		});

		it("overwrites an existing agent with the same id", () => {
			useAgentStore.getState().registerAgent(makeAgent({ id: "a1", status: "idle" }));
			useAgentStore.getState().registerAgent(makeAgent({ id: "a1", status: "working" }));
			expect(useAgentStore.getState().agents.a1.status).toBe("working");
		});
	});

	describe("unregisterAgent", () => {
		it("removes agent from the map", () => {
			useAgentStore.getState().registerAgent(makeAgent({ id: "a1" }));
			expect(useAgentStore.getState().agents.a1).toBeDefined();
			useAgentStore.getState().unregisterAgent("a1");
			expect(useAgentStore.getState().agents.a1).toBeUndefined();
		});

		it("does nothing for nonexistent id", () => {
			useAgentStore.getState().registerAgent(makeAgent({ id: "a1" }));
			useAgentStore.getState().unregisterAgent("nonexistent");
			expect(Object.keys(useAgentStore.getState().agents)).toHaveLength(1);
		});
	});

	describe("updateAgentStatus", () => {
		it("changes the status of an existing agent", () => {
			useAgentStore.getState().registerAgent(makeAgent({ id: "a1", status: "idle" }));
			useAgentStore.getState().updateAgentStatus("a1", "working");
			expect(useAgentStore.getState().agents.a1.status).toBe("working");
		});

		it("does nothing for nonexistent agent", () => {
			const before = useAgentStore.getState().agents;
			useAgentStore.getState().updateAgentStatus("ghost", "error");
			expect(useAgentStore.getState().agents).toBe(before);
		});
	});

	describe("logOperation", () => {
		it("appends operation to ops array", () => {
			const op = makeOp({ reason: "add button" });
			useAgentStore.getState().logOperation(op);
			expect(useAgentStore.getState().ops).toHaveLength(1);
			expect(useAgentStore.getState().ops[0].reason).toBe("add button");
		});

		it("caps ops at 200 (circular buffer)", () => {
			for (let i = 0; i < 201; i++) {
				useAgentStore.getState().logOperation(makeOp({ timestamp: i }));
			}
			const ops = useAgentStore.getState().ops;
			expect(ops).toHaveLength(200);
			// first entry should be timestamp=1 (the 0th was evicted)
			expect(ops[0].timestamp).toBe(1);
			expect(ops[199].timestamp).toBe(200);
		});
	});

	describe("addCorrection", () => {
		it("appends correction to corrections array", () => {
			const c = makeCorrection({ message: "use blue instead" });
			useAgentStore.getState().addCorrection(c);
			expect(useAgentStore.getState().corrections).toHaveLength(1);
			expect(useAgentStore.getState().corrections[0].message).toBe("use blue instead");
		});

		it("caps corrections at 50", () => {
			for (let i = 0; i < 51; i++) {
				useAgentStore.getState().addCorrection(makeCorrection({ timestamp: i }));
			}
			const corrections = useAgentStore.getState().corrections;
			expect(corrections).toHaveLength(50);
			expect(corrections[0].timestamp).toBe(1);
			expect(corrections[49].timestamp).toBe(50);
		});
	});

	describe("clearOps", () => {
		it("empties both ops and corrections", () => {
			useAgentStore.getState().logOperation(makeOp());
			useAgentStore.getState().logOperation(makeOp());
			useAgentStore.getState().addCorrection(makeCorrection());
			expect(useAgentStore.getState().ops).toHaveLength(2);
			expect(useAgentStore.getState().corrections).toHaveLength(1);

			useAgentStore.getState().clearOps();
			expect(useAgentStore.getState().ops).toHaveLength(0);
			expect(useAgentStore.getState().corrections).toHaveLength(0);
		});

		it("does not affect registered agents", () => {
			useAgentStore.getState().registerAgent(makeAgent({ id: "a1" }));
			useAgentStore.getState().logOperation(makeOp());
			useAgentStore.getState().clearOps();
			expect(useAgentStore.getState().agents.a1).toBeDefined();
		});
	});
});

import { create } from "zustand";
import type { AgentRegistration, CanvasOperation, CourseCorrection } from "../types";

const MAX_OPS = 200; // circular buffer

interface AgentState {
	agents: Record<string, AgentRegistration>;
	ops: CanvasOperation[];
	corrections: CourseCorrection[];

	registerAgent: (agent: AgentRegistration) => void;
	unregisterAgent: (id: string) => void;
	updateAgentStatus: (id: string, status: AgentRegistration["status"]) => void;
	logOperation: (op: CanvasOperation) => void;
	addCorrection: (correction: CourseCorrection) => void;
	clearOps: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
	agents: {},
	ops: [],
	corrections: [],

	registerAgent: (agent) =>
		set((state) => ({
			agents: { ...state.agents, [agent.id]: agent },
		})),

	unregisterAgent: (id) =>
		set((state) => {
			const { [id]: _, ...rest } = state.agents;
			return { agents: rest };
		}),

	updateAgentStatus: (id, status) =>
		set((state) => {
			const agent = state.agents[id];
			if (!agent) return state;
			return {
				agents: { ...state.agents, [id]: { ...agent, status } },
			};
		}),

	logOperation: (op) =>
		set((state) => {
			const ops = [...state.ops, op];
			return { ops: ops.length > MAX_OPS ? ops.slice(-MAX_OPS) : ops };
		}),

	addCorrection: (correction) =>
		set((state) => {
			const corrections = [...state.corrections, correction];
			return { corrections: corrections.length > 50 ? corrections.slice(-50) : corrections };
		}),

	clearOps: () => set({ ops: [], corrections: [] }),
}));

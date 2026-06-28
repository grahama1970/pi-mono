import { describe, expect, it } from "vitest";
import {
	validateBrowserProof,
	validateCommandLoop,
} from "./tau-ui-handoff-command-loop-proof.mjs";

function browserProof(overrides = {}) {
	return {
		schema: "tau.live_memory_chat_browser_proof.v1",
		ok: true,
		mocked: false,
		live: true,
		handoff: {
			schema: "tau.agent_handoff.v1",
			github: { repo: "grahama1970/tau", target: "new" },
			goal: {
				goal_id: "goal-tau-chat-hardening",
				goal_version: 1,
				goal_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
			},
			previous_subagent: "webgpt-ticket-author",
			next_agent: {
				name: "reviewer",
				executor: "either",
				reason: "Needs review.",
			},
			context: { summary: "Browser proof context.", artifacts: [] },
			result: { status: "NEEDS_REVIEW", summary: "Needs review.", evidence: [] },
			rationale: "Reviewer should inspect the receipt.",
			required_evidence: ["Reviewer receipt."],
			stop_condition: "Reviewer posts a receipt.",
		},
		...overrides,
	};
}

function commandLoopReceipt(overrides = {}) {
	return {
		schema: "tau.agent_handoff_command_loop_receipt.v1",
		ok: true,
		mocked: false,
		live: true,
		step_count: 1,
		status: "WAITING",
		terminal_agent: "human",
		stop_reason: "next_agent_is_human",
		dispatches: [
			{
				ok: true,
				mocked: false,
				live: true,
				selected_agent: "reviewer",
				command_results: [
					{
						exit_code: 0,
						timed_out: false,
					},
				],
				response_projection: {
					next_agent: "human",
				},
			},
		],
		...overrides,
	};
}

describe("tau-ui-handoff-command-loop-proof validators", () => {
	it("accepts a live browser proof routed to a non-human next agent", () => {
		const result = validateBrowserProof(browserProof());

		expect(result.errors).toEqual([]);
		expect(result.handoff?.next_agent.name).toBe("reviewer");
	});

	it("refuses mocked browser proofs and handoffs already routed to human", () => {
		expect(validateBrowserProof(browserProof({ mocked: true })).errors).toContain(
			"browser proof must be mocked=false",
		);
		expect(
			validateBrowserProof(
				browserProof({
					handoff: {
						...browserProof().handoff,
						next_agent: { name: "human", executor: "human", reason: "Stop." },
					},
				}),
			).errors,
		).toContain("handoff already routes to human; no subagent command-loop execution is needed");
	});

	it("accepts a one-step command loop that selects the expected agent and stops at human", () => {
		const result = validateCommandLoop(commandLoopReceipt(), { nextAgent: "reviewer" });

		expect(result.errors).toEqual([]);
		expect(result.firstDispatch?.selected_agent).toBe("reviewer");
		expect(result.firstCommand?.exit_code).toBe(0);
	});

	it("refuses selected-agent drift, command timeout, and non-human terminal routes", () => {
		expect(
			validateCommandLoop(commandLoopReceipt(), { nextAgent: "research-auditor" }).errors,
		).toContain("selected_agent must be research-auditor");
		expect(
			validateCommandLoop(commandLoopReceipt({
				dispatches: [
					{
						...commandLoopReceipt().dispatches[0],
						command_results: [{ exit_code: 0, timed_out: true }],
					},
				],
			}), { nextAgent: "reviewer" }).errors,
		).toContain("selected subagent command must not time out");
		expect(
			validateCommandLoop(commandLoopReceipt({ terminal_agent: "reviewer" }), {
				nextAgent: "reviewer",
			}).errors,
		).toContain("command loop must stop at human");
	});
});

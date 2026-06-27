import { describe, expect, it } from "vitest";
import { collectMemoryTurn } from "../shared-chat/memory-turn";
import { stageTraceFromStreamingSteps, TauReceiptAdapter } from "./TauChatView";
import type { TauCommandLoopGithubProjectionReceipt } from "./tauCommandLoopProjection";

type MemoryCall = {
	path: string;
	body: Record<string, unknown>;
};

const COMMAND_LOOP_PROJECTION: TauCommandLoopGithubProjectionReceipt = {
	schema: "tau.command_loop_explicit_ticket_source_summary.v1",
	summaryPath: "/tmp/tau-command-loop-explicit-ticket-source-proof/summary.json",
	sourceLoopReceiptPath: "/tmp/tau-command-loop-explicit-ticket-source-proof/command-loop/command-loop-receipt.json",
	reconciliationReceiptPath:
		"/tmp/tau-command-loop-explicit-ticket-source-proof/command-loop/command-artifacts/command-loop-step-001/goal-guardian-reconciliation-receipt.json",
	actualReconciliationStepReceiptPath:
		"/tmp/tau-command-loop-explicit-ticket-source-proof/command-loop/command-loop-step-001.receipt.json",
	ticketSourcePath: "/tmp/tau-command-loop-explicit-ticket-source-proof/ticket-source.json",
	transportReceiptPath:
		"/tmp/tau-command-loop-explicit-ticket-source-proof/command-loop-reconciliation-github-transport.json",
	dryRun: true,
	applied: false,
	mocked: false,
	live: true,
	commandCount: 2,
	reconciliationCounts: {
		keep: 1,
		close: 0,
		migrate: 3,
		regenerate: 0,
	},
	commands: [
		"gh issue comment 123 --repo grahama1970/chatgpt-lab --body-file -",
		"gh issue edit 123 --repo grahama1970/chatgpt-lab --add-label agent-work,next:human,executor:human,goal-change --remove-label next:goal-guardian,agent-active",
	],
};

function makeAdapter(
	intent: Record<string, unknown>,
	products: Record<string, unknown> = {},
	commandLoopProjection: TauCommandLoopGithubProjectionReceipt | null = COMMAND_LOOP_PROJECTION,
) {
	const calls: MemoryCall[] = [];
	const adapter = new TauReceiptAdapter(async (path, body) => {
		calls.push({ path, body });
		if (path === "/intent") return intent;
		if (path in products) return products[path];
		throw new Error(`unexpected memory path ${path}`);
	}, commandLoopProjection ?? undefined);
	return { adapter, calls };
}

describe("TauReceiptAdapter Memory routing", () => {
	it("routes CLARIFY through /clarify and preserves a clarification trace", async () => {
		const { adapter, calls } = makeAdapter(
			{ action: "CLARIFY", confidence: 0.61, entities: [], frameworks: [] },
			{ "/clarify": { schema: "memory.clarify.v1", needs_clarification: true, questions: ["Which system?"] } },
		);

		const { message, steps } = await collectMemoryTurn(adapter.sendTurn({ text: "secure it" }));

		expect(calls.map((call) => call.path)).toEqual(["/intent", "/clarify"]);
		expect(steps.some((step) => step.id === "clarifying" && step.status === "completed")).toBe(true);
		expect(message.content).toContain("Tau routed this turn to Memory clarify.");
		expect(message.content).toContain("| Current receipt stage | Clarifying... (PASS) |");
		expect(message.content).toContain("| next agent | human |");
		expect(message.content).toContain("### Tau handoff JSON contract");
		expect(message.content).toContain('"schema": "tau.agent_handoff.v1"');
		expect(message.content).toContain('"name": "human"');
		expect(message.metadata?.memoryBacked).toBe(true);
		expect(message.metadata?.tauCurrentStage).toMatchObject({
			schema: "tau.loop2_pipeline_stage.v1",
			stage: "clarify",
			label: "Clarifying...",
			status: "PASS",
			source: "clarifying",
		});
		expect(message.metadata?.tauStageTrace).toMatchObject([
			{ stage: "intent", status: "RUNNING" },
			{ stage: "intent", status: "PASS" },
			{ stage: "extract_entities", status: "PASS" },
			{ stage: "clarify", status: "RUNNING" },
			{ stage: "clarify", status: "PASS" },
		]);
		expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({ ok: true, nextAgent: "human" });
	});

	it("fails closed when CLARIFY route product is unavailable", async () => {
		const { adapter, calls } = makeAdapter({ action: "CLARIFY", confidence: 0.61, entities: [], frameworks: [] });

		const { message, steps } = await collectMemoryTurn(adapter.sendTurn({ text: "secure it" }));

		expect(calls.map((call) => call.path)).toEqual(["/intent", "/clarify"]);
		expect(steps.some((step) => step.id === "clarifying" && step.status === "failed")).toBe(true);
		expect(message.content).toContain("Tau stopped fail-closed while running /clarify.");
		expect(message.content).toContain(
			"| GitHub/subagent handoff | not emitted because the route product is missing |",
		);
		expect(message.content).not.toContain("| next agent | human |");
		expect(message.content).not.toContain("### Tau handoff JSON contract");
		expect(message.metadata?.memoryBacked).toBe(false);
		expect(message.metadata?.tauCurrentStage).toMatchObject({
			stage: "clarify",
			status: "FAILED",
			source: "clarifying",
		});
		expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({
			ok: false,
			errors: ["route_product_missing"],
			nextAgent: null,
		});
	});

	it("fails closed when CLARIFY returns a malformed product", async () => {
		const { adapter, calls } = makeAdapter(
			{ action: "CLARIFY", confidence: 0.61, entities: [], frameworks: [] },
			{ "/clarify": { schema: "memory.clarify.v1", needs_clarification: true, questions: [] } },
		);

		const { message, steps } = await collectMemoryTurn(adapter.sendTurn({ text: "secure it" }));

		expect(calls.map((call) => call.path)).toEqual(["/intent", "/clarify"]);
		expect(steps.some((step) => step.id === "clarifying" && step.status === "failed")).toBe(true);
		expect(message.content).toContain("Tau stopped fail-closed while running /clarify.");
		expect(message.content).toContain("Memory /clarify requested clarification without questions");
		expect(message.content).not.toContain("### Tau handoff JSON contract");
		expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({
			ok: false,
			errors: ["route_product_invalid"],
			nextAgent: null,
		});
	});

	it("routes DEFLECT and NO_MATCH through /deflect instead of recall", async () => {
		const { adapter, calls } = makeAdapter(
			{ action: "NO_MATCH", confidence: 0.72, entities: [], frameworks: [] },
			{ "/deflect": { schema: "memory.deflect.v1", should_deflect: true, deflection_type: "no_match" } },
		);

		const { message, steps } = await collectMemoryTurn(adapter.sendTurn({ text: "what is the weather?" }));

		expect(calls.map((call) => call.path)).toEqual(["/intent", "/deflect"]);
		expect(calls.some((call) => call.path === "/recall")).toBe(false);
		expect(steps.some((step) => step.id === "checking-gates" && step.status === "completed")).toBe(true);
		expect(message.content).toContain("Tau routed this turn to Memory deflect.");
		expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({ ok: true, nextAgent: "human" });
	});

	it("fails closed when DEFLECT route product is unavailable", async () => {
		const { adapter, calls } = makeAdapter({ action: "DEFLECT", confidence: 0.72, entities: [], frameworks: [] });

		const { message, steps } = await collectMemoryTurn(adapter.sendTurn({ text: "what is the weather?" }));

		expect(calls.map((call) => call.path)).toEqual(["/intent", "/deflect"]);
		expect(steps.some((step) => step.id === "checking-gates" && step.status === "failed")).toBe(true);
		expect(message.content).toContain("Tau stopped fail-closed while running /deflect.");
		expect(message.content).not.toContain("Tau routed this turn to Memory deflect.");
		expect(message.metadata?.memoryBacked).toBe(false);
		expect(message.metadata?.tauCurrentStage).toMatchObject({
			stage: "deflect",
			status: "FAILED",
			source: "checking-gates",
		});
	});

	it("fails closed when DEFLECT returns a non-deflecting product", async () => {
		const { adapter, calls } = makeAdapter(
			{ action: "DEFLECT", confidence: 0.72, entities: [], frameworks: [] },
			{ "/deflect": { schema: "memory.deflect.v1", should_deflect: false, deflection_type: "none" } },
		);

		const { message, steps } = await collectMemoryTurn(adapter.sendTurn({ text: "what is the weather?" }));

		expect(calls.map((call) => call.path)).toEqual(["/intent", "/deflect"]);
		expect(steps.some((step) => step.id === "checking-gates" && step.status === "failed")).toBe(true);
		expect(message.content).toContain("Tau stopped fail-closed while running /deflect.");
		expect(message.content).toContain("Memory /deflect did not confirm deflection");
		expect(message.content).not.toContain("### Tau handoff JSON contract");
		expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({
			ok: false,
			errors: ["route_product_invalid"],
			nextAgent: null,
		});
	});

	it("routes ANSWER through /answer and records answer product metadata", async () => {
		const { adapter, calls } = makeAdapter(
			{ action: "ANSWER", confidence: 0.84, entities: ["Tau"], frameworks: [], recall_profile: "procedural_memory" },
			{
				"/answer": {
					schema: "memory.answer.v1",
					can_answer: true,
					confidence: 0.84,
					final_response: "Tau uses Memory first.",
				},
			},
		);

		const { message, steps } = await collectMemoryTurn(
			adapter.sendTurn({ text: "What did we decide about Tau memory?" }),
		);

		expect(calls.map((call) => call.path)).toEqual(["/intent", "/answer"]);
		expect(steps.some((step) => step.id === "answering" && step.status === "completed")).toBe(true);
		expect(message.content).toContain("Tau routed this turn to Memory answer.");
		expect(message.content).toContain("| can answer | true |");
		expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({ ok: true, nextAgent: "reviewer" });
	});

	it("fails closed when ANSWER route product is unavailable", async () => {
		const { adapter, calls } = makeAdapter({
			action: "ANSWER",
			confidence: 0.84,
			entities: ["Tau"],
			frameworks: [],
			recall_profile: "procedural_memory",
		});

		const { message, steps } = await collectMemoryTurn(
			adapter.sendTurn({ text: "What did we decide about Tau memory?" }),
		);

		expect(calls.map((call) => call.path)).toEqual(["/intent", "/answer"]);
		expect(steps.some((step) => step.id === "answering" && step.status === "failed")).toBe(true);
		expect(message.content).toContain("Tau stopped fail-closed while running /answer.");
		expect(message.content).not.toContain("Tau routed this turn to Memory answer.");
		expect(message.content).not.toContain("| next agent | reviewer |");
		expect(message.metadata?.memoryBacked).toBe(false);
		expect(message.metadata?.tauCurrentStage).toMatchObject({
			stage: "answer",
			status: "FAILED",
			source: "answering",
		});
	});

	it("fails closed when ANSWER cannot produce a final response", async () => {
		const { adapter, calls } = makeAdapter(
			{
				action: "ANSWER",
				confidence: 0.84,
				entities: ["Tau"],
				frameworks: [],
				recall_profile: "procedural_memory",
			},
			{
				"/answer": {
					schema: "memory.answer.v1",
					can_answer: false,
					answer_type: "insufficient_memory_evidence",
				},
			},
		);

		const { message, steps } = await collectMemoryTurn(
			adapter.sendTurn({ text: "What did we decide about Tau memory?" }),
		);

		expect(calls.map((call) => call.path)).toEqual(["/intent", "/answer"]);
		expect(steps.some((step) => step.id === "answering" && step.status === "failed")).toBe(true);
		expect(message.content).toContain("Tau stopped fail-closed while running /answer.");
		expect(message.content).toContain("Memory /answer did not confirm can_answer=true");
		expect(message.content).not.toContain("### Tau handoff JSON contract");
		expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({
			ok: false,
			errors: ["route_product_invalid"],
			nextAgent: null,
		});
	});

	it("routes RESEARCH fail-closed without claiming Brave Search ran", async () => {
		const { adapter, calls } = makeAdapter({
			action: "RESEARCH",
			confidence: 0.77,
			entities: ["latest Chutes pricing"],
			frameworks: [],
		});

		const { message, steps } = await collectMemoryTurn(
			adapter.sendTurn({ text: "search the web for latest Chutes pricing" }),
		);

		expect(calls.map((call) => call.path)).toEqual(["/intent"]);
		expect(calls.some((call) => call.path === "/recall")).toBe(false);
		expect(calls.some((call) => call.path === "/answer")).toBe(false);
		expect(steps.some((step) => step.id === "getting-results" && step.status === "skipped")).toBe(true);
		expect(message.content).toContain("Tau identified a research route and stopped before unsupported web claims.");
		expect(message.content).toContain("Memory product: not called in this slice.");
		expect(message.content).toContain("| next agent | research-auditor |");
		expect(message.content).toContain("### Tau handoff JSON contract");
		expect(message.content).toContain('"name": "research-auditor"');
		expect(message.metadata?.memoryBacked).toBe(true);
		expect(message.metadata?.tauCurrentStage).toMatchObject({
			stage: "brave_search",
			status: "SKIPPED",
			source: "getting-results",
		});
		expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({ ok: true, nextAgent: "research-auditor" });
	});

	it("routes COMPLIANCE through /recall and marks evidence synthesis as not executed in this slice", async () => {
		const { adapter, calls } = makeAdapter(
			{
				action: "COMPLIANCE",
				confidence: 0.95,
				response_mode: "evidence_case",
				entities: ["CWE-287"],
				frameworks: ["CWE"],
				recall_profile: "exact_control_lookup",
				k: 12,
			},
			{ "/recall": { found: true, confidence: 12.4, items: [{ _key: "ctrl__CWE-287" }] } },
		);

		const { message, steps } = await collectMemoryTurn(
			adapter.sendTurn({ text: "How does Tau handle a CWE-287 SPARTA evidence case?" }),
		);

		expect(calls.map((call) => call.path)).toEqual(["/intent", "/recall"]);
		expect(calls[1].body).toMatchObject({
			k: 12,
			collections: ["sparta_controls", "sparta_relationships", "technique_knowledge"],
		});
		expect(steps.some((step) => step.id === "checking-gates" && step.status === "skipped")).toBe(true);
		expect(message.metadata?.branch).toBe("evidence-case");
		expect(message.content).toContain("| found | true |");
		expect(message.content).toContain("| schema | tau.agent_handoff.v1 |");
		expect(message.content).toContain("| labels add | agent-work, next:reviewer, executor:either |");
		expect(message.content).toContain("### Tau command-loop GitHub projection receipt");
		expect(message.content).toContain("/tmp/tau-command-loop-explicit-ticket-source-proof/summary.json");
		expect(message.content).toContain(
			"/tmp/tau-command-loop-explicit-ticket-source-proof/command-loop/command-loop-receipt.json",
		);
		expect(message.content).toContain(
			"/tmp/tau-command-loop-explicit-ticket-source-proof/command-loop/command-artifacts/command-loop-step-001/goal-guardian-reconciliation-receipt.json",
		);
		expect(message.content).toContain(
			"/tmp/tau-command-loop-explicit-ticket-source-proof/command-loop/command-loop-step-001.receipt.json",
		);
		expect(message.content).toContain("/tmp/tau-command-loop-explicit-ticket-source-proof/ticket-source.json");
		expect(message.content).toContain(
			"/tmp/tau-command-loop-explicit-ticket-source-proof/command-loop-reconciliation-github-transport.json",
		);
		expect(message.content).toContain("| mutation applied | false |");
		expect(message.content).toContain("| dry-run commands | 2 |");
		expect(message.content).toContain("| reconciliation counts | keep=1, close=0, migrate=3, regenerate=0 |");
		expect(message.content).toContain("gh issue comment 123 --repo grahama1970/chatgpt-lab --body-file -");
		expect(message.content).toContain("### Tau handoff JSON contract");
		expect(message.content).toContain('"name": "reviewer"');
		expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({ ok: true, nextAgent: "reviewer" });
		expect(message.metadata?.tauAgentHandoffGithubProjection).toMatchObject({
			ok: true,
			nextAgent: "reviewer",
			labels: { add: ["agent-work", "next:reviewer", "executor:either"] },
		});
		expect(message.metadata?.tauCommandLoopGithubProjection).toMatchObject({
			summaryPath: "/tmp/tau-command-loop-explicit-ticket-source-proof/summary.json",
			sourceLoopReceiptPath:
				"/tmp/tau-command-loop-explicit-ticket-source-proof/command-loop/command-loop-receipt.json",
			ticketSourcePath: "/tmp/tau-command-loop-explicit-ticket-source-proof/ticket-source.json",
			transportReceiptPath:
				"/tmp/tau-command-loop-explicit-ticket-source-proof/command-loop-reconciliation-github-transport.json",
			dryRun: true,
			applied: false,
			commandCount: 2,
		});
		expect(message.metadata?.tauReceiptPaths).toContain(
			"/tmp/tau-command-loop-explicit-ticket-source-proof/summary.json",
		);
	});

	it("omits command-loop GitHub projection when no receipt is supplied", async () => {
		const { adapter } = makeAdapter(
			{
				action: "COMPLIANCE",
				confidence: 0.95,
				response_mode: "evidence_case",
				entities: ["CWE-287"],
				frameworks: ["CWE"],
			},
			{ "/recall": { found: true, confidence: 12.4, items: [{ _key: "ctrl__CWE-287" }] } },
			null,
		);

		const { message } = await collectMemoryTurn(adapter.sendTurn({ text: "How does Tau handle CWE-287?" }));

		expect(message.content).toContain("| status | unavailable |");
		expect(message.content).toContain(
			"command-loop GitHub projection is omitted until `/api/tau/command-loop/github-projection` returns a schema-valid receipt",
		);
		expect(message.metadata?.tauCommandLoopGithubProjection).toBeNull();
		expect(message.metadata?.tauReceiptPaths).not.toContain(
			"/tmp/tau-command-loop-explicit-ticket-source-proof/summary.json",
		);
	});

	it("converts streaming steps into Tau pipeline stage receipt metadata", () => {
		const trace = stageTraceFromStreamingSteps([
			{
				id: "extracting-entities",
				branch: "compliance",
				status: "completed",
				label: "Extracting Entities",
				liveStatusLabel: "Extracting Entities...",
			},
			{
				id: "getting-results",
				branch: "compliance",
				status: "skipped",
				label: "Searching Web",
				liveStatusLabel: "Searching Web...",
			},
		]);

		expect(trace).toEqual([
			{
				schema: "tau.loop2_pipeline_stage.v1",
				stage: "extract_entities",
				label: "Extracting Entities...",
				status: "PASS",
				source: "extracting-entities",
			},
			{
				schema: "tau.loop2_pipeline_stage.v1",
				stage: "brave_search",
				label: "Searching Web...",
				status: "SKIPPED",
				source: "getting-results",
			},
		]);
	});
});

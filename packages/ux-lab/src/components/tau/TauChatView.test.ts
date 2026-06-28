import { describe, expect, it } from "vitest";
import { collectMemoryTurn } from "../shared-chat/memory-turn";
import type { TauAnnotationDraft } from "./TauChatView";
import {
	deriveTauTuiMirrorState,
	stageTraceFromStreamingSteps,
	TauReceiptAdapter,
	tauAnnotationDraftStorageKey,
	tauAnnotationLabelStyle,
	tauAnnotationReceiptPreview,
	terminalLinesFromTauTuiMirrorState,
	terminalLinesFromTauTuiReceiptStream,
	textualTuiProofCardSummary,
} from "./TauChatView";
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
	transportValidator: ConstructorParameters<typeof TauReceiptAdapter>[2] = async (receipt) => ({
		schema: "tau.handoff_github_transport_validation.v1",
		ok: true,
		dryRun: true,
		applied: false,
		target: receipt.target,
		goal: receipt.goal,
		labels: receipt.labels,
		commandCount: receipt.commandCount,
		commands: receipt.commands,
		checks: ["schema", "dry_run_not_applied", "target", "labels", "command_count", "command_repo", "command_target"],
	}),
	orchestratorIntake: ConstructorParameters<typeof TauReceiptAdapter>[3] = async (validation) => {
		const labels = validation.labels ?? { add: ["agent-work", "next:reviewer", "executor:either"], remove: [] };
		const nextAgent = labels.add.find((label) => label.startsWith("next:"))?.slice("next:".length) ?? "reviewer";
		const executor = labels.add.find((label) => label.startsWith("executor:"))?.slice("executor:".length) ?? "either";
		return {
			schema: "tau.handoff_orchestrator_intake.v1",
			ok: true,
			dryRun: true,
			applied: false,
			accepted: true,
			target: validation.target ?? { repo: "grahama1970/tau", target: "new" },
			goal: validation.goal ?? {
				goal_id: "goal-tau-chat-hardening",
				goal_version: 1,
				goal_hash: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
			},
			nextAgent,
			executor,
			labels,
			commandCount: validation.commandCount,
			commands: validation.commands,
			routing: {
				queue: "github-ticket",
				next_agent: nextAgent,
				executor,
				stop_condition: `${nextAgent} posts a schema-valid Tau receipt before the next route.`,
			},
			claims: {
				proves: [
					"Tau chat handoff transport validation can be normalized into a non-mutating orchestrator intake receipt.",
				],
				does_not_prove: ["Live GitHub mutation", "Live subagent execution", "Final Sparta Chat readiness"],
			},
		};
	},
	subagentReceiptExpectation: ConstructorParameters<typeof TauReceiptAdapter>[4] = async (intake) => ({
		schema: "tau.subagent_receipt_expectation.v1",
		ok: true,
		dryRun: true,
		applied: false,
		persisted: true,
		artifactPath: `/tmp/tau-subagent-receipt-expectations/test/${intake.nextAgent}-subagent-receipt-expectation.json`,
		proofRoot: "/tmp/tau-subagent-receipt-expectations",
		target: intake.target,
		goal: intake.goal,
		nextAgent: intake.nextAgent,
		executor: intake.executor,
		requiredReceipt: {
			schema: "tau.agent_handoff.v1",
			previous_subagent: intake.nextAgent,
			fields: [
				"schema",
				"github.repo",
				"github.target",
				"goal.goal_id",
				"goal.goal_version",
				"goal.goal_hash",
				"previous_subagent",
				"context.summary",
				"context.artifacts",
				"result.status",
				"result.summary",
				"result.evidence",
				"rationale",
				"next_agent.name",
				"next_agent.reason",
				"required_evidence",
				"stop_condition",
			],
			next_agent_required: true,
			evidence_required: true,
			goal_preservation_required: true,
			stop_condition: intake.routing.stop_condition,
		},
		claims: {
			proves: ["Tau can derive the next subagent receipt expectation from accepted dry-run orchestrator intake."],
			does_not_prove: ["The next subagent actually executed.", "The expected receipt was posted to GitHub."],
		},
	}),
	subagentHandoffValidator: ConstructorParameters<typeof TauReceiptAdapter>[5] = async ({ expectation, handoff }) => ({
		schema: "tau.subagent_handoff_validation.v1",
		ok: true,
		dryRun: true,
		applied: false,
		executed: false,
		candidateOnly: true,
		target: expectation.target,
		previousSubagent: handoff.previous_subagent,
		nextAgent: handoff.next_agent.name,
		resultStatus: handoff.result.status,
		goal: handoff.goal,
		resultEvidenceCount: handoff.result.evidence.length,
		requiredEvidenceCount: handoff.required_evidence.length,
		expectationArtifactPath: expectation.artifactPath,
		checks: [
			"expectation_schema",
			"handoff_schema",
			"target_match",
			"previous_subagent_match",
			"goal_preserved",
			"required_fields",
			"next_agent_present",
			"evidence_present",
		],
		claims: {
			proves: [
				"Tau can validate a candidate next-subagent tau.agent_handoff.v1 against the persisted receipt expectation.",
			],
			does_not_prove: [
				"The next subagent actually executed.",
				"The candidate receipt was posted to GitHub.",
				"Live GitHub mutation.",
			],
		},
	}),
	externalSubagentReceiptIntake: ConstructorParameters<typeof TauReceiptAdapter>[6] = async ({
		expectation,
		receipt,
		externalReceiptId,
	}) => ({
		schema: "tau.external_subagent_receipt_intake.v1",
		ok: true,
		dryRun: true,
		applied: false,
		accepted: true,
		externalReceipt: true,
		executed: false,
		target: expectation.target,
		goal: receipt.goal,
		previousSubagent: receipt.previous_subagent,
		nextAgent: receipt.next_agent.name,
		resultStatus: receipt.result.status,
		resultEvidenceCount: receipt.result.evidence.length,
		requiredEvidenceCount: receipt.required_evidence.length,
		externalReceiptId,
		nextRoute: {
			subagent: receipt.next_agent.name,
			executor: receipt.next_agent.executor,
			reason: receipt.next_agent.reason,
		},
		sourceValidation: {
			schema: "tau.subagent_handoff_validation.v1",
			ok: true,
			dryRun: true,
			applied: false,
			executed: false,
			candidateOnly: true,
			target: expectation.target,
			previousSubagent: receipt.previous_subagent,
			nextAgent: receipt.next_agent.name,
			resultStatus: receipt.result.status,
			goal: receipt.goal,
			resultEvidenceCount: receipt.result.evidence.length,
			requiredEvidenceCount: receipt.required_evidence.length,
			checks: ["goal_preserved", "external_receipt_accepted"],
			claims: {
				proves: ["Tau validates the external receipt shape."],
				does_not_prove: ["The external subagent actually executed in this browser proof."],
			},
		},
		checks: [
			"expectation_schema",
			"receipt_schema",
			"target_match",
			"previous_subagent_match",
			"goal_preserved",
			"required_fields",
			"next_agent_present",
			"evidence_present",
			"external_receipt_accepted",
		],
		claims: {
			proves: [
				"Tau can ingest an externally supplied tau.agent_handoff.v1 receipt against the persisted expectation.",
			],
			does_not_prove: [
				"The external subagent actually executed in this browser proof.",
				"The external receipt was posted to GitHub.",
				"Live GitHub mutation.",
			],
		},
	}),
	externalSubagentGithubProjection: ConstructorParameters<typeof TauReceiptAdapter>[7] = async ({
		intake,
		receipt,
	}) => ({
		schema: "tau.external_subagent_github_projection.v1",
		ok: true,
		dryRun: true,
		applied: false,
		mutation: "not_applied",
		target: intake.target,
		goal: intake.goal,
		previousSubagent: receipt.previous_subagent,
		nextAgent: receipt.next_agent.name,
		executor: receipt.next_agent.executor,
		resultStatus: receipt.result.status,
		labels: {
			add: ["agent-work", `next:${receipt.next_agent.name}`, `executor:${receipt.next_agent.executor}`],
			remove: ["agent-active", "agent-blocked", `next:${receipt.previous_subagent}`],
		},
		comment: {
			body: `## Tau External Subagent Receipt\n\n<!-- tau-agent-handoff:v1 -->\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\``,
			body_format: "github-markdown",
			body_marker: "<!-- tau-agent-handoff:v1 -->",
			body_embeds_handoff_json: true,
		},
		commandCount: intake.target.target === "new" ? 1 : 2,
		commands:
			intake.target.target === "new"
				? [
						`gh issue create --repo ${intake.target.repo} --title "Tau external subagent receipt: ${receipt.previous_subagent} to ${receipt.next_agent.name}" --body-file - --label agent-work,next:${receipt.next_agent.name},executor:${receipt.next_agent.executor}`,
					]
				: [
						`gh issue comment 123 --repo ${intake.target.repo} --body-file -`,
						`gh issue edit 123 --repo ${intake.target.repo} --add-label agent-work,next:${receipt.next_agent.name},executor:${receipt.next_agent.executor} --remove-label agent-active,agent-blocked,next:${receipt.previous_subagent}`,
					],
		sourceIntake: {
			schema: intake.schema,
			accepted: intake.accepted,
			externalReceipt: intake.externalReceipt,
			executed: intake.executed,
			externalReceiptId: intake.externalReceiptId,
		},
		checks: [
			"intake_schema",
			"intake_accepted",
			"receipt_schema",
			"target_match",
			"goal_preserved",
			"previous_subagent_match",
			"next_agent_present",
			"labels_derived",
			"comment_embeds_receipt_json",
			"dry_run_not_applied",
		],
		claims: {
			proves: [
				"Tau can project an accepted external tau.agent_handoff.v1 receipt into a deterministic GitHub comment and label plan.",
			],
			does_not_prove: [
				"The external subagent actually executed in this browser proof.",
				"The external receipt was posted to GitHub.",
				"Live GitHub mutation.",
			],
		},
	}),
) {
	const calls: MemoryCall[] = [];
	const adapter = new TauReceiptAdapter(
		async (path, body) => {
			calls.push({ path, body });
			if (path === "/intent") return intent;
			if (path in products) return products[path];
			throw new Error(`unexpected memory path ${path}`);
		},
		commandLoopProjection ?? undefined,
		transportValidator,
		orchestratorIntake,
		subagentReceiptExpectation,
		subagentHandoffValidator,
		externalSubagentReceiptIntake,
		externalSubagentGithubProjection,
	);
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
		expect(message.content).toContain("| question count | 1 |");
		expect(message.content).toContain("| first question | Which system? |");
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

	it("routes low-confidence COMPLIANCE intents through /clarify instead of recall", async () => {
		const { adapter, calls } = makeAdapter(
			{
				action: "COMPLIANCE",
				confidence: 0.42,
				response_mode: "evidence_case",
				entities: ["CWE-287"],
				frameworks: ["CWE"],
				recall_profile: "exact_control_lookup",
			},
			{
				"/clarify": {
					schema: "memory.clarify.v1",
					needs_clarification: true,
					questions: ["Which system or evidence source should Tau use for CWE-287?"],
				},
			},
		);

		const { message, steps } = await collectMemoryTurn(adapter.sendTurn({ text: "How does Tau handle CWE-287?" }));

		expect(calls.map((call) => call.path)).toEqual(["/intent", "/clarify"]);
		expect(calls.some((call) => call.path === "/recall")).toBe(false);
		expect(calls[1].body).toMatchObject({
			scope: "tau",
			context: "Tau routed this turn to clarify because Memory /intent confidence was below the routing threshold.",
		});
		expect(steps.some((step) => step.id === "clarifying" && step.status === "completed")).toBe(true);
		expect(message.content).toContain("Tau routed this low-confidence Memory intent to Memory clarify.");
		expect(message.content).toContain("| action | COMPLIANCE |");
		expect(message.content).toContain("| confidence | 0.42 |");
		expect(message.content).toContain("| next agent | human |");
		expect(message.content).not.toContain(
			"Tau routed this turn through Memory intent into a compliance evidence path.",
		);
		expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({ ok: true, nextAgent: "human" });
	});

	it("routes low-confidence RESEARCH intents through /clarify instead of emitting research-auditor handoff", async () => {
		const { adapter, calls } = makeAdapter(
			{
				action: "RESEARCH",
				confidence: 0.45,
				entities: ["latest Chutes pricing"],
				frameworks: [],
			},
			{
				"/clarify": {
					schema: "memory.clarify.v1",
					needs_clarification: true,
					questions: ["Which current source should Tau use for Chutes pricing?"],
				},
			},
		);

		const { message } = await collectMemoryTurn(
			adapter.sendTurn({ text: "search the web for latest Chutes pricing" }),
		);

		expect(calls.map((call) => call.path)).toEqual(["/intent", "/clarify"]);
		expect(calls.some((call) => call.path === "/recall")).toBe(false);
		expect(calls.some((call) => call.path === "/answer")).toBe(false);
		expect(message.content).toContain("Tau routed this low-confidence Memory intent to Memory clarify.");
		expect(message.content).toContain("| action | RESEARCH |");
		expect(message.content).toContain("| confidence | 0.45 |");
		expect(message.content).toContain('"name": "human"');
		expect(message.content).not.toContain('"name": "research-auditor"');
		expect(message.content).not.toContain(
			"Tau identified a research route and stopped before unsupported web claims.",
		);
		expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({ ok: true, nextAgent: "human" });
	});

	it("routes close-ranked Memory intents through /clarify instead of forcing the top action", async () => {
		const { adapter, calls } = makeAdapter(
			{
				action: "COMPLIANCE",
				confidence: 0.66,
				response_mode: "evidence_case",
				entities: ["CWE-287"],
				frameworks: ["CWE"],
				top_intents: [
					{ action: "COMPLIANCE", confidence: 0.66 },
					{ action: "QUERY", confidence: 0.61 },
				],
			},
			{
				"/clarify": {
					schema: "memory.clarify.v1",
					needs_clarification: true,
					questions: ["Do you want a compliance evidence case or a general Tau memory answer?"],
				},
			},
		);

		const { message } = await collectMemoryTurn(adapter.sendTurn({ text: "What does Tau know about CWE-287?" }));

		expect(calls.map((call) => call.path)).toEqual(["/intent", "/clarify"]);
		expect(calls.some((call) => call.path === "/recall")).toBe(false);
		expect(message.content).toContain("Tau routed this low-confidence Memory intent to Memory clarify.");
		expect(message.content).toContain("| action | COMPLIANCE |");
		expect(message.content).toContain("| confidence | 0.66 |");
		expect(message.content).toContain("| next agent | human |");
		expect(message.content).not.toContain(
			"Tau routed this turn through Memory intent into a compliance evidence path.",
		);
		expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({ ok: true, nextAgent: "human" });
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

	it("routes QUERY memory_grounded_answer intents through /answer", async () => {
		const { adapter, calls } = makeAdapter(
			{
				action: "QUERY",
				confidence: 0.8,
				response_mode: "memory_grounded_answer",
				content_type: "markdown",
				entities: [],
				frameworks: [],
				recall_profile: "general_memory_recall",
			},
			{
				"/answer": {
					schema: "memory.answer.v1",
					can_answer: true,
					confidence: 0.75,
					final_response: "Memory first means recall before scanning.",
				},
			},
		);

		const { message, steps } = await collectMemoryTurn(adapter.sendTurn({ text: "What is memory first?" }));

		expect(calls.map((call) => call.path)).toEqual(["/intent", "/answer"]);
		expect(steps.some((step) => step.id === "answering" && step.status === "completed")).toBe(true);
		expect(message.content).toContain("Tau routed this turn to Memory answer.");
		expect(message.content).toContain("| action | QUERY |");
		expect(message.content).toContain("| response mode | memory_grounded_answer |");
		expect(message.content).toContain("| endpoint | /answer |");
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

	it("fails closed when Memory intent returns an unmapped action", async () => {
		const { adapter, calls } = makeAdapter({
			action: "BANANA",
			confidence: 0.88,
			entities: ["Tau"],
			frameworks: [],
		});

		const { message, steps } = await collectMemoryTurn(
			adapter.sendTurn({ text: "What should Tau do with this unknown route?" }),
		);

		expect(calls.map((call) => call.path)).toEqual(["/intent"]);
		expect(calls.some((call) => call.path === "/recall")).toBe(false);
		expect(calls.some((call) => call.path === "/answer")).toBe(false);
		expect(calls.some((call) => call.path === "/clarify")).toBe(false);
		expect(calls.some((call) => call.path === "/deflect")).toBe(false);
		expect(steps.some((step) => step.id === "extracting-entities" && step.status === "completed")).toBe(true);
		expect(message.content).toContain(
			"Tau stopped fail-closed because Memory `/intent` returned an unsupported route.",
		);
		expect(message.content).toContain("Intent action: BANANA");
		expect(message.content).toContain("Memory /intent action BANANA is not a supported Tau route");
		expect(message.content).toContain("| Memory route endpoint | not called |");
		expect(message.content).toContain("| GitHub/subagent handoff | not emitted because intent routing is invalid |");
		expect(message.content).not.toContain("Tau routed this turn through Memory recall.");
		expect(message.content).not.toContain("### Tau handoff JSON contract");
		expect(message.metadata?.memoryBacked).toBe(false);
		expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({
			ok: false,
			errors: ["intent_route_invalid"],
			nextAgent: null,
		});
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
		expect(message.content).toContain("### Tau handoff GitHub projection JSON contract");
		expect(message.content).toContain('"next:reviewer"');
		expect(message.content).toContain('"agent-active"');
		expect(message.content).toContain("### Tau handoff GitHub transport receipt JSON contract");
		expect(message.content).toContain('"schema": "tau.handoff_github_transport_receipt.v1"');
		expect(message.content).toContain("gh issue create --repo grahama1970/tau");
		expect(message.content).toContain("### Tau handoff GitHub transport server validation JSON contract");
		expect(message.content).toContain('"schema": "tau.handoff_github_transport_validation.v1"');
		expect(message.content).toContain('"dryRun": true');
		expect(message.content).toContain('"applied": false');
		expect(message.content).toContain("### Tau handoff orchestrator intake JSON contract");
		expect(message.content).toContain('"schema": "tau.handoff_orchestrator_intake.v1"');
		expect(message.content).toContain('"accepted": true');
		expect(message.content).toContain('"nextAgent": "reviewer"');
		expect(message.content).toContain("### Tau subagent receipt expectation JSON contract");
		expect(message.content).toContain('"schema": "tau.subagent_receipt_expectation.v1"');
		expect(message.content).toContain('"persisted": true');
		expect(message.content).toContain(
			"/tmp/tau-subagent-receipt-expectations/test/reviewer-subagent-receipt-expectation.json",
		);
		expect(message.content).toContain('"previous_subagent": "reviewer"');
		expect(message.content).toContain('"next_agent_required": true');
		expect(message.content).toContain("### Tau candidate subagent handoff JSON contract");
		expect(message.content).toContain("Dry-run candidate receipt for reviewer; no subagent executed.");
		expect(message.content).toContain('"previous_subagent": "reviewer"');
		expect(message.content).toContain('"name": "human"');
		expect(message.content).toContain("### Tau subagent handoff validation JSON contract");
		expect(message.content).toContain('"schema": "tau.subagent_handoff_validation.v1"');
		expect(message.content).toContain('"executed": false');
		expect(message.content).toContain('"candidateOnly": true');
		expect(message.content).toContain("### Tau external subagent receipt fixture JSON contract");
		expect(message.content).toContain(
			"External reviewer receipt fixture for Tau intake validation; no subagent executed in this browser proof.",
		);
		expect(message.content).toContain('"status": "COMPLETED"');
		expect(message.content).toContain("### Tau external subagent receipt intake JSON contract");
		expect(message.content).toContain('"schema": "tau.external_subagent_receipt_intake.v1"');
		expect(message.content).toContain('"externalReceipt": true');
		expect(message.content).toContain('"external_receipt_accepted"');
		expect(message.content).toContain("### Tau external subagent GitHub projection JSON contract");
		expect(message.content).toContain('"schema": "tau.external_subagent_github_projection.v1"');
		expect(message.content).toContain('"mutation": "not_applied"');
		expect(message.content).toContain('"next:human"');
		expect(message.content).toContain('"next:reviewer"');
		expect(message.content).toContain('"body_embeds_handoff_json": true');
		expect(message.content).toContain("gh issue create --repo grahama1970/tau");
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
			goal: {
				goal_id: "goal-tau-chat-hardening",
				goal_version: 1,
			},
			labels: { add: ["agent-work", "next:reviewer", "executor:either"] },
		});
		expect(message.metadata?.tauAgentHandoffGithubTransportReceipt).toMatchObject({
			ok: true,
			dryRun: true,
			applied: false,
			goal: {
				goal_id: "goal-tau-chat-hardening",
				goal_version: 1,
			},
			commandCount: 1,
		});
		expect(message.metadata?.tauAgentHandoffGithubTransportValidation).toMatchObject({
			schema: "tau.handoff_github_transport_validation.v1",
			ok: true,
			dryRun: true,
			applied: false,
			goal: {
				goal_id: "goal-tau-chat-hardening",
				goal_version: 1,
			},
			commandCount: 1,
		});
		expect(message.metadata?.tauAgentHandoffOrchestratorIntake).toMatchObject({
			schema: "tau.handoff_orchestrator_intake.v1",
			ok: true,
			dryRun: true,
			applied: false,
			accepted: true,
			goal: {
				goal_id: "goal-tau-chat-hardening",
				goal_version: 1,
			},
			nextAgent: "reviewer",
			executor: "either",
		});
		expect(message.metadata?.tauSubagentReceiptExpectation).toMatchObject({
			schema: "tau.subagent_receipt_expectation.v1",
			ok: true,
			dryRun: true,
			applied: false,
			persisted: true,
			artifactPath: "/tmp/tau-subagent-receipt-expectations/test/reviewer-subagent-receipt-expectation.json",
			goal: {
				goal_id: "goal-tau-chat-hardening",
				goal_version: 1,
			},
			nextAgent: "reviewer",
			requiredReceipt: {
				schema: "tau.agent_handoff.v1",
				previous_subagent: "reviewer",
				next_agent_required: true,
			},
		});
		expect(message.metadata?.tauCandidateSubagentHandoff).toMatchObject({
			schema: "tau.agent_handoff.v1",
			goal: {
				goal_id: "goal-tau-chat-hardening",
				goal_version: 1,
			},
			previous_subagent: "reviewer",
			result: {
				status: "NOOP",
			},
			next_agent: {
				name: "human",
				executor: "human",
			},
		});
		expect(message.metadata?.tauSubagentHandoffValidation).toMatchObject({
			schema: "tau.subagent_handoff_validation.v1",
			ok: true,
			dryRun: true,
			applied: false,
			executed: false,
			candidateOnly: true,
			previousSubagent: "reviewer",
			nextAgent: "human",
			resultStatus: "NOOP",
			goal: {
				goal_id: "goal-tau-chat-hardening",
				goal_version: 1,
			},
		});
		expect(message.metadata?.tauExternalSubagentReceipt).toMatchObject({
			schema: "tau.agent_handoff.v1",
			goal: {
				goal_id: "goal-tau-chat-hardening",
				goal_version: 1,
			},
			previous_subagent: "reviewer",
			result: {
				status: "COMPLETED",
			},
			next_agent: {
				name: "human",
				executor: "human",
			},
		});
		expect(message.metadata?.tauExternalSubagentReceiptIntake).toMatchObject({
			schema: "tau.external_subagent_receipt_intake.v1",
			ok: true,
			dryRun: true,
			applied: false,
			accepted: true,
			externalReceipt: true,
			executed: false,
			previousSubagent: "reviewer",
			nextAgent: "human",
			resultStatus: "COMPLETED",
			goal: {
				goal_id: "goal-tau-chat-hardening",
				goal_version: 1,
			},
			nextRoute: {
				subagent: "human",
				executor: "human",
			},
		});
		expect(message.metadata?.tauExternalSubagentGithubProjection).toMatchObject({
			schema: "tau.external_subagent_github_projection.v1",
			ok: true,
			dryRun: true,
			applied: false,
			mutation: "not_applied",
			previousSubagent: "reviewer",
			nextAgent: "human",
			executor: "human",
			resultStatus: "COMPLETED",
			labels: {
				add: ["agent-work", "next:human", "executor:human"],
				remove: ["agent-active", "agent-blocked", "next:reviewer"],
			},
			comment: {
				body_format: "github-markdown",
				body_marker: "<!-- tau-agent-handoff:v1 -->",
				body_embeds_handoff_json: true,
			},
			commandCount: 1,
			sourceIntake: {
				schema: "tau.external_subagent_receipt_intake.v1",
				accepted: true,
				externalReceipt: true,
				executed: false,
			},
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

	it("fails closed when the server transport validator refuses the rendered handoff receipt", async () => {
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
			COMMAND_LOOP_PROJECTION,
			async () => {
				throw new Error("server rejected dry-run transport receipt");
			},
		);

		const { message } = await collectMemoryTurn(
			adapter.sendTurn({ text: "How does Tau handle a CWE-287 SPARTA evidence case?" }),
		);

		expect(calls.map((call) => call.path)).toEqual(["/intent", "/recall"]);
		expect(message.content).toContain(
			"Tau stopped fail-closed while validating the GitHub transport or orchestrator intake receipt.",
		);
		expect(message.content).toContain("server rejected dry-run transport receipt");
		expect(message.content).toContain(
			"| GitHub/subagent handoff | not emitted because the transport/intake receipt was not server-accepted |",
		);
		expect(message.content).toContain("| Mutation applied | false |");
		expect(message.content).not.toContain("### Tau handoff JSON contract");
		expect(message.content).not.toContain("### Tau handoff GitHub transport server validation JSON contract");
		expect(message.metadata?.memoryBacked).toBe(false);
		expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({
			ok: false,
			errors: ["transport_receipt_validation_failed"],
			nextAgent: "reviewer",
		});
		expect(message.metadata?.tauAgentHandoffGithubTransportValidation).toMatchObject({
			ok: false,
			error: "server rejected dry-run transport receipt",
		});
	});

	it("fails closed when the orchestrator intake refuses a server-validated handoff receipt", async () => {
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
			COMMAND_LOOP_PROJECTION,
			undefined,
			async () => {
				throw new Error("orchestrator refused next:reviewer route");
			},
		);

		const { message } = await collectMemoryTurn(
			adapter.sendTurn({ text: "How does Tau handle a CWE-287 SPARTA evidence case?" }),
		);

		expect(calls.map((call) => call.path)).toEqual(["/intent", "/recall"]);
		expect(message.content).toContain(
			"Tau stopped fail-closed while validating the GitHub transport or orchestrator intake receipt.",
		);
		expect(message.content).toContain("orchestrator refused next:reviewer route");
		expect(message.content).toContain(
			"| GitHub/subagent handoff | not emitted because the transport/intake receipt was not server-accepted |",
		);
		expect(message.content).not.toContain("### Tau handoff JSON contract");
		expect(message.content).not.toContain("### Tau handoff orchestrator intake JSON contract");
		expect(message.metadata?.memoryBacked).toBe(false);
		expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({
			ok: false,
			errors: ["transport_receipt_validation_failed"],
			nextAgent: "reviewer",
		});
		expect(message.metadata?.tauAgentHandoffOrchestratorIntake).toMatchObject({
			ok: false,
			error: "orchestrator refused next:reviewer route",
		});
	});

	it("fails closed when the subagent receipt expectation refuses accepted intake", async () => {
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
			COMMAND_LOOP_PROJECTION,
			undefined,
			undefined,
			async () => {
				throw new Error("receipt expectation refused next:reviewer route");
			},
		);

		const { message } = await collectMemoryTurn(
			adapter.sendTurn({ text: "How does Tau handle a CWE-287 SPARTA evidence case?" }),
		);

		expect(calls.map((call) => call.path)).toEqual(["/intent", "/recall"]);
		expect(message.content).toContain(
			"Tau stopped fail-closed while validating the GitHub transport or orchestrator intake receipt.",
		);
		expect(message.content).toContain("receipt expectation refused next:reviewer route");
		expect(message.content).toContain(
			"| GitHub/subagent handoff | not emitted because the transport/intake receipt was not server-accepted |",
		);
		expect(message.content).not.toContain("### Tau handoff JSON contract");
		expect(message.content).not.toContain("### Tau subagent receipt expectation JSON contract");
		expect(message.metadata?.memoryBacked).toBe(false);
		expect(message.metadata?.tauAgentHandoffValidation).toMatchObject({
			ok: false,
			errors: ["transport_receipt_validation_failed"],
			nextAgent: "reviewer",
		});
		expect(message.metadata?.tauSubagentReceiptExpectation).toMatchObject({
			ok: false,
			error: "receipt expectation refused next:reviewer route",
		});
	});

	it("fails closed when the candidate subagent handoff validator refuses the receipt", async () => {
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
			COMMAND_LOOP_PROJECTION,
			undefined,
			undefined,
			undefined,
			async () => {
				throw new Error("candidate receipt missing required next_agent");
			},
		);

		const { message } = await collectMemoryTurn(
			adapter.sendTurn({ text: "How does Tau handle a CWE-287 SPARTA evidence case?" }),
		);

		expect(calls.map((call) => call.path)).toEqual(["/intent", "/recall"]);
		expect(message.content).toContain(
			"Tau stopped fail-closed while validating the GitHub transport or orchestrator intake receipt.",
		);
		expect(message.content).toContain("candidate receipt missing required next_agent");
		expect(message.content).toContain(
			"| GitHub/subagent handoff | not emitted because the transport/intake receipt was not server-accepted |",
		);
		expect(message.content).not.toContain("### Tau handoff JSON contract");
		expect(message.content).not.toContain("### Tau subagent handoff validation JSON contract");
		expect(message.metadata?.memoryBacked).toBe(false);
		expect(message.metadata?.tauCandidateSubagentHandoff).toMatchObject({
			schema: "tau.agent_handoff.v1",
			previous_subagent: "reviewer",
		});
		expect(message.metadata?.tauSubagentHandoffValidation).toMatchObject({
			ok: false,
			error: "candidate receipt missing required next_agent",
		});
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
			{
				kind: "final",
				id: "answering",
				branch: "compliance",
				status: "completed",
				label: "Final answer",
				liveStatusLabel: "Thinking…",
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

	it("drives the TUI mirror from the same streaming stage telemetry as the chat turn", () => {
		const mirror = deriveTauTuiMirrorState(
			[],
			[
				{
					id: "getting-results",
					branch: "compliance",
					status: "running",
					label: "Searching Web",
					liveStatusLabel: "Searching Web...",
				},
			],
			true,
			"loop2-run-123",
		);

		expect(mirror.runId).toBe("loop2-run-123");
		expect(mirror.active).toBe(true);
		expect(mirror.currentStage).toMatchObject({
			schema: "tau.loop2_pipeline_stage.v1",
			stage: "brave_search",
			label: "Searching Web...",
			status: "RUNNING",
			source: "getting-results",
		});
		expect(mirror.trace).toHaveLength(1);
	});

	it("falls the TUI mirror back to final assistant metadata after the chat turn finishes", () => {
		const mirror = deriveTauTuiMirrorState(
			[
				{
					id: "assistant-answer",
					role: "assistant",
					content: "Tau routed this turn to Memory answer.",
					createdAt: "2026-06-28T15:20:45Z",
					metadata: {
						memoryIntent: { action: "ANSWER" },
						tauCurrentStage: {
							schema: "tau.loop2_pipeline_stage.v1",
							stage: "answer",
							label: "Answering...",
							status: "PASS",
							source: "answering",
						},
						tauStageTrace: [
							{
								schema: "tau.loop2_pipeline_stage.v1",
								stage: "intent",
								label: "Getting Intent...",
								status: "PASS",
								source: "getting-intent",
							},
							{
								schema: "tau.loop2_pipeline_stage.v1",
								stage: "answer",
								label: "Answering...",
								status: "PASS",
								source: "answering",
							},
						],
						tauAgentHandoffValidation: { ok: true, nextAgent: "reviewer" },
						personaVoiceStatus: "REQUESTED_NO_PERSONAPLEX_RECEIPT",
					},
				},
			],
			[],
			false,
			null,
		);

		expect(mirror.active).toBe(false);
		expect(mirror.currentStage.stage).toBe("answer");
		expect(mirror.route).toBe("ANSWER");
		expect(mirror.nextAgent).toBe("reviewer");
		expect(mirror.personaVoice).toBe("REQUESTED_NO_PERSONAPLEX_RECEIPT");
		expect(mirror.trace.map((stage) => stage.stage)).toEqual(["intent", "answer"]);
	});

	it("renders the TUI mirror state as terminal transcript lines for xterm", () => {
		const lines = terminalLinesFromTauTuiMirrorState({
			runId: "loop2-run-123",
			active: false,
			currentStage: {
				schema: "tau.loop2_pipeline_stage.v1",
				stage: "brave_search",
				label: "Searching Web...",
				status: "SKIPPED",
				source: "getting-results",
			},
			trace: [
				{
					schema: "tau.loop2_pipeline_stage.v1",
					stage: "intent",
					label: "Getting Intent...",
					status: "PASS",
					source: "getting-intent",
				},
				{
					schema: "tau.loop2_pipeline_stage.v1",
					stage: "brave_search",
					label: "Searching Web...",
					status: "SKIPPED",
					source: "getting-results",
				},
			],
			route: "RESEARCH",
			nextAgent: "research-auditor",
			personaVoice: "not requested",
		});

		expect(lines.join("\n")).toContain("tau@ux-lab");
		expect(lines.join("\n")).toContain("route=RESEARCH next_agent=research-auditor");
		expect(lines.join("\n")).toContain("02. Searching Web...");
		expect(lines.join("\n")).toContain("current");
	});

	it("renders a real Tau receipt stream view as terminal transcript lines for xterm", () => {
		const lines = terminalLinesFromTauTuiReceiptStream({
			schema: "tau.tui_receipt_stream_view.v1",
			ok: true,
			mocked: false,
			live: true,
			runId: "loop2-real-run",
			runDir: "/home/graham/workspace/experiments/tau/.loop2/runs/loop2-real-run",
			eventsPath: "/home/graham/workspace/experiments/tau/.loop2/runs/loop2-real-run/events.jsonl",
			finalReceiptPath: "/home/graham/workspace/experiments/tau/.loop2/runs/loop2-real-run/final-receipt.json",
			eventCount: 2,
			status: "PASS",
			proofScope: "one bounded loop2 repair node",
			transportRunId: "otr-real",
			streamEventCount: 13,
			latestEventType: "agent_end",
			terminalLines: [
				"tau@receipt-stream:~/loop2$ tail --schema loop2.event.v1 events.jsonl",
				"run_id=loop2-real-run",
				"mocked=false live=true status=PASS",
				"event stream tail:",
				"001 contract_loaded running - contract loaded",
				"002 agent_end completed - agent completed",
				"claims.proves=1",
				"claims.does_not_prove=1",
			],
			claims: {
				proves: ["receipt stream is renderable"],
				does_not_prove: ["PTY attachment"],
			},
		});

		expect(lines.join("\n")).toContain("tau@receipt-stream");
		expect(lines.join("\n")).toContain("loop2-real-run");
		expect(lines.join("\n")).toContain("agent_end completed");
		expect(lines.join("\n")).toContain("mocked=false live=true status=PASS");
	});

	it("labels Textual TUI renderer proof as fixture-backed and not live", () => {
		const summary = textualTuiProofCardSummary({
			ok: true,
			receipt: {
				schema: "tau.textual_tui_proof_view.v1",
				ok: true,
				mocked: true,
				live: false,
				manifestPath:
					"/home/graham/workspace/experiments/tau/experiments/goal-locked-subagents/proofs/textual-tui-proof-cli/manifest.json",
				proofRoot:
					"/home/graham/workspace/experiments/tau/experiments/goal-locked-subagents/proofs/textual-tui-proof-cli",
				sourceSchema: "tau.proof_manifest.v1",
				runId: "loop2-real-run",
				prompt: "How does Tau handle a CWE-287 SPARTA evidence case?",
				status: "evidence-recorded",
				entrypoint: "uv run tau tui-proof",
				sourceType: "repeatable real TauTuiApp Textual rendering proof with fixture session",
				receiptPath: "/tmp/tau-tui-proof/proof.json",
				screenshotSvg: "/tmp/tau-tui-proof/tau-textual-tui-memory-stage.svg",
				screenshotPng: "/tmp/tau-tui-proof/tau-textual-tui-memory-stage.png",
				visibleAssertions: ["Accessing Memory..."],
				textAssertions: ["tau.agent_handoff.v1"],
				doesNotProve: ["live provider call"],
				claims: {
					proves: ["Tau can produce a repeatable Textual TUI proof command."],
					does_not_prove: ["live provider call"],
				},
			},
		});

		expect(summary).toMatchObject({
			label: "FIXTURE PROOF",
			mocked: "true",
			live: "false",
			artifact: "/tmp/tau-tui-proof/tau-textual-tui-memory-stage.png",
		});
		expect(summary.detail).toContain("does not claim a live TUI process");
	});

	it("keeps Tau annotation draft storage scoped to each movie segment", () => {
		expect(tauAnnotationDraftStorageKey("seg-001")).toBe("ux-lab:tau:annotation-draft:seg-001");
		expect(tauAnnotationDraftStorageKey("scene 02: Willie / Marcus")).toBe(
			"ux-lab:tau:annotation-draft:scene_02:_Willie_Marcus",
		);
	});

	it("renders Tau annotation labels above bbox overlays with truncation enabled", () => {
		const style = tauAnnotationLabelStyle([0.18, 0.26, 0.38, 0.74]);

		expect(style.zIndex).toBe(90);
		expect(style.display).toBe("block");
		expect(style.boxSizing).toBe("border-box");
		expect(style.maxWidth).toBe("min(280px, calc(82% - 8px))");
		expect(style.overflow).toBe("hidden");
		expect(style.textOverflow).toBe("ellipsis");
		expect(style.whiteSpace).toBe("nowrap");
	});

	it("marks Tau annotation receipt preview as local draft only", () => {
		const draft: TauAnnotationDraft = {
			segmentId: "seg-001",
			characterName: "Willie",
			actorName: "Billy Bob Thornton",
			playheadSeconds: 101.2,
			draftBbox: [0.18, 0.26, 0.38, 0.74],
			boxes: [],
			status: "Draft box ready.",
		};

		expect(tauAnnotationReceiptPreview(draft)).toMatchObject({
			schema: "tau.watch_annotation_local_draft.v1",
			persisted: "localStorage",
			receiptEndpointAttached: false,
			segmentId: "seg-001",
			playheadSeconds: 101.2,
			boxCount: 1,
			claims: {
				does_not_prove: [
					"Watch annotation endpoint write",
					"movie-library persistence",
					"model identity correctness",
				],
			},
		});
	});

	it("marks Tau annotation receipt preview as endpoint-backed when a receipt path exists", () => {
		const draft: TauAnnotationDraft = {
			segmentId: "seg-001",
			characterName: "Willie",
			actorName: "Billy Bob Thornton",
			playheadSeconds: 101.2,
			draftBbox: null,
			boxes: [
				{
					id: "seg-001-box-1",
					characterName: "Willie",
					actorName: "Billy Bob Thornton",
					bbox: [0.18, 0.26, 0.38, 0.74],
					status: "receipt_written",
					receiptPath: "/tmp/tau-annotation-receipts/tau-annotation-test.json",
				},
			],
			status: "Tau annotation receipt written.",
			receiptPath: "/tmp/tau-annotation-receipts/tau-annotation-test.json",
			receiptRunId: "tau-annotation-test",
		};

		expect(tauAnnotationReceiptPreview(draft)).toMatchObject({
			schema: "tau.watch_annotation_receipt_preview.v1",
			persisted: "tau_endpoint_receipt",
			receiptEndpointAttached: true,
			receiptPath: "/tmp/tau-annotation-receipts/tau-annotation-test.json",
			receiptRunId: "tau-annotation-test",
			boxCount: 1,
			claims: {
				proves: ["Tau annotation UI submitted a segment draft to the Tau annotation receipt endpoint."],
				does_not_prove: [
					"Watch production annotation persistence",
					"movie-library persistence",
					"model identity correctness",
				],
			},
		});
	});
});

import { describe, expect, it } from "vitest";
import {
	buildTauAgentHandoff,
	buildTauRouteHandoff,
	deriveTauHandoffGithubProjection,
	deriveTauHandoffGithubTransportReceipt,
	renderTauHandoffGithubProjectionJsonBlock,
	renderTauHandoffGithubTransportReceiptJsonBlock,
	summarizeTauAgentHandoff,
	summarizeTauHandoffGithubProjection,
	TAU_AGENT_HANDOFF_SCHEMA,
	validateTauAgentHandoff,
} from "./tauAgentHandoff";

describe("tauAgentHandoff", () => {
	it("builds the minimal tau.agent_handoff.v1 envelope", () => {
		const handoff = buildTauAgentHandoff({
			contextSummary: "Tau Chat handled one Memory-backed turn.",
			resultStatus: "NEEDS_REVIEW",
			resultSummary: "Memory intent and recall completed.",
			rationale: "A reviewer should inspect the Memory packet before promotion.",
			nextAgentName: "reviewer",
			nextAgentReason: "Independent validation is required.",
			requiredEvidence: ["Reviewer receipt"],
			stopCondition: "Reviewer posts a schema-valid receipt.",
		});

		expect(handoff.schema).toBe(TAU_AGENT_HANDOFF_SCHEMA);
		expect(handoff.github).toEqual({ repo: "grahama1970/tau", target: "new" });
		expect(handoff.goal.goal_id).toBe("goal-tau-chat-hardening");
		expect(handoff.previous_subagent).toBe("webgpt-ticket-author");
		expect(handoff.next_agent.name).toBe("reviewer");
		expect(validateTauAgentHandoff(handoff)).toEqual({
			ok: true,
			errors: [],
			nextAgent: "reviewer",
		});
	});

	it("rejects missing next-agent routing", () => {
		const handoff = buildTauAgentHandoff({
			contextSummary: "Missing route.",
			resultStatus: "BLOCKED",
			resultSummary: "No route.",
			rationale: "Route is required.",
			nextAgentName: "",
			nextAgentReason: "",
			requiredEvidence: [],
			stopCondition: "Tau refuses routing.",
		});

		const result = validateTauAgentHandoff(handoff);

		expect(result.ok).toBe(false);
		expect(result.errors).toContain("next_agent.name must be a non-empty string");
		expect(result.errors).toContain("next_agent.reason must be a non-empty string");
	});

	it("routes research handoffs to research-auditor without claiming web evidence exists", () => {
		const handoff = buildTauRouteHandoff({
			action: "RESEARCH",
			query: "search latest Chutes pricing",
			branch: "compliance",
			memoryProductSummary: null,
		});

		expect(handoff.result.status).toBe("NEEDS_AGENT");
		expect(handoff.next_agent.name).toBe("research-auditor");
		expect(handoff.required_evidence).toContain("Research receipt with sources and retrieval timestamp.");
		expect(summarizeTauAgentHandoff(handoff)).toContain("| next agent | research-auditor |");
	});

	it("routes clarify and deflect handoffs to the human lane", () => {
		const clarify = buildTauRouteHandoff({
			action: "CLARIFY",
			query: "secure it",
			branch: "compliance",
		});
		const deflect = buildTauRouteHandoff({
			action: "NO_MATCH",
			query: "weather",
			branch: "compliance",
		});

		expect(clarify.result.status).toBe("NEEDS_HUMAN");
		expect(clarify.next_agent).toMatchObject({ name: "human", executor: "human" });
		expect(deflect.result.status).toBe("NOOP");
		expect(deflect.next_agent).toMatchObject({ name: "human", executor: "human" });
	});

	it("derives a non-mutating GitHub comment projection with labels", () => {
		const handoff = buildTauAgentHandoff({
			repo: "grahama1970/chatgpt-lab",
			target: "issue#123",
			goalHash: "sha256:active-goal",
			contextSummary: "Tau Chat handled one Memory-backed turn.",
			resultStatus: "NEEDS_REVIEW",
			resultSummary: "Memory intent and recall completed.",
			resultEvidence: ["/api/memory/intent", "/api/memory/recall"],
			rationale: "A reviewer should inspect the Memory packet before promotion.",
			nextAgentName: "reviewer",
			nextAgentExecutor: "either",
			nextAgentReason: "Independent validation is required.",
			requiredEvidence: ["Reviewer receipt"],
			stopCondition: "Reviewer posts a schema-valid receipt.",
		});

		const projection = deriveTauHandoffGithubProjection(handoff, {
			activeGoalHash: "sha256:active-goal",
		});

		expect(projection.ok).toBe(true);
		expect(projection.target).toEqual({ repo: "grahama1970/chatgpt-lab", target: "issue#123" });
		expect(projection.labels?.add).toEqual(["agent-work", "next:reviewer", "executor:either"]);
		expect(projection.labels?.remove).toEqual(["agent-active", "agent-blocked"]);
		expect(projection.comment?.body).toContain("<!-- tau-agent-handoff:v1 -->");
		expect(projection.comment?.body).toContain('"schema": "tau.agent_handoff.v1"');
		expect(summarizeTauHandoffGithubProjection(projection)).toContain("| status | dry-run |");
		expect(renderTauHandoffGithubProjectionJsonBlock(projection)).toContain(
			"### Tau handoff GitHub projection JSON contract",
		);
		expect(renderTauHandoffGithubProjectionJsonBlock(projection)).toContain('"next:reviewer"');

		const transportReceipt = deriveTauHandoffGithubTransportReceipt(projection);
		expect(transportReceipt).toMatchObject({
			schema: "tau.handoff_github_transport_receipt.v1",
			ok: true,
			dryRun: true,
			applied: false,
			commandCount: 2,
		});
		expect(transportReceipt.commands[0]).toBe(
			"gh issue comment 123 --repo grahama1970/chatgpt-lab --body-file -",
		);
		expect(transportReceipt.commands[1]).toContain("--add-label agent-work,next:reviewer,executor:either");
		expect(renderTauHandoffGithubTransportReceiptJsonBlock(transportReceipt)).toContain(
			"### Tau handoff GitHub transport receipt JSON contract",
		);
	});

	it("refuses projection when active goal hash does not match", () => {
		const handoff = buildTauAgentHandoff({
			goalHash: "sha256:stale-goal",
			contextSummary: "Stale handoff.",
			resultStatus: "NEEDS_REVIEW",
			resultSummary: "Goal hash changed.",
			rationale: "Should fail.",
			nextAgentName: "reviewer",
			nextAgentReason: "Review.",
			requiredEvidence: ["None"],
			stopCondition: "Refuse stale handoff.",
		});

		const projection = deriveTauHandoffGithubProjection(handoff, {
			activeGoalHash: "sha256:active-goal",
		});

		expect(projection.ok).toBe(false);
		expect(projection.errors).toContain("agent handoff may not change goal.goal_hash");
		expect(summarizeTauHandoffGithubProjection(projection)).toContain("| status | refused |");
	});

	it("derives PR transport commands and refuses malformed GitHub targets", () => {
		const handoff = buildTauAgentHandoff({
			repo: "grahama1970/chatgpt-lab",
			target: "pr#456",
			contextSummary: "PR handoff.",
			resultStatus: "NEEDS_REVIEW",
			resultSummary: "PR needs review.",
			rationale: "Reviewer should inspect the PR.",
			nextAgentName: "reviewer",
			nextAgentReason: "Read-only validation is required.",
			requiredEvidence: ["Reviewer receipt"],
			stopCondition: "Reviewer posts a schema-valid receipt.",
		});

		const projection = deriveTauHandoffGithubProjection(handoff);
		const receipt = deriveTauHandoffGithubTransportReceipt(projection);

		expect(receipt.ok).toBe(true);
		expect(receipt.commands).toEqual([
			"gh pr comment 456 --repo grahama1970/chatgpt-lab --body-file -",
			"gh pr edit 456 --repo grahama1970/chatgpt-lab --add-label agent-work,next:reviewer,executor:either --remove-label agent-active,agent-blocked",
		]);

		const malformed = deriveTauHandoffGithubTransportReceipt({
			...projection,
			target: { repo: "grahama1970/chatgpt-lab", target: "ticket#abc" },
		});

		expect(malformed).toMatchObject({
			ok: false,
			commandCount: 0,
			commands: [],
		});
		expect(malformed.errors[0]).toContain("unsupported GitHub target");
	});

	it("refuses projection when next_agent is missing", () => {
		const handoff = buildTauAgentHandoff({
			contextSummary: "Missing next agent.",
			resultStatus: "BLOCKED",
			resultSummary: "No route.",
			rationale: "Should fail.",
			nextAgentName: "",
			nextAgentReason: "",
			requiredEvidence: [],
			stopCondition: "Refuse missing route.",
		});

		const projection = deriveTauHandoffGithubProjection(handoff);

		expect(projection.ok).toBe(false);
		expect(projection.errors).toContain("next_agent.name must be a non-empty string");
	});
});

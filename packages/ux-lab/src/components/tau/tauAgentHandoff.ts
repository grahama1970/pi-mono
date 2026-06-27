export const TAU_AGENT_HANDOFF_SCHEMA = "tau.agent_handoff.v1";

const DEFAULT_GOAL_HASH = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

export type TauHandoffStatus =
	| "COMPLETED"
	| "NEEDS_AGENT"
	| "NEEDS_REVIEW"
	| "NEEDS_HUMAN"
	| "BLOCKED"
	| "INSUFFICIENT_EVIDENCE"
	| "NOOP";

export interface TauAgentHandoff {
	schema: typeof TAU_AGENT_HANDOFF_SCHEMA;
	github: {
		repo: string;
		target: string;
	};
	goal: {
		goal_id: string;
		goal_version: number;
		goal_hash: string;
	};
	previous_subagent: string;
	context: {
		summary: string;
		artifacts: string[];
	};
	result: {
		status: TauHandoffStatus;
		summary: string;
		evidence: string[];
	};
	rationale: string;
	next_agent: {
		name: string;
		executor?: string;
		reason: string;
	};
	required_evidence: string[];
	stop_condition: string;
}

export interface TauAgentHandoffInput {
	repo?: string;
	target?: string;
	goalId?: string;
	goalVersion?: number;
	goalHash?: string;
	previousSubagent?: string;
	contextSummary: string;
	contextArtifacts?: string[];
	resultStatus: TauHandoffStatus;
	resultSummary: string;
	resultEvidence?: string[];
	rationale: string;
	nextAgentName: string;
	nextAgentExecutor?: string;
	nextAgentReason: string;
	requiredEvidence: string[];
	stopCondition: string;
}

export interface TauAgentHandoffValidation {
	ok: boolean;
	errors: string[];
	nextAgent?: string;
}

export interface TauHandoffGithubProjection {
	ok: boolean;
	errors: string[];
	target?: {
		repo: string;
		target: string;
	};
	goal?: TauAgentHandoff["goal"];
	labels?: {
		add: string[];
		remove: string[];
	};
	comment?: {
		body: string;
	};
	nextAgent?: string;
}

export interface TauHandoffGithubTransportReceipt {
	schema: "tau.handoff_github_transport_receipt.v1";
	ok: boolean;
	dryRun: true;
	applied: false;
	target?: {
		repo: string;
		target: string;
	};
	goal?: TauAgentHandoff["goal"];
	labels?: {
		add: string[];
		remove: string[];
	};
	commandCount: number;
	commands: string[];
	errors: string[];
	sourceProjectionContract: "tau.handoff_github_projection.rendered.v1";
}

export function buildTauAgentHandoff(input: TauAgentHandoffInput): TauAgentHandoff {
	return {
		schema: TAU_AGENT_HANDOFF_SCHEMA,
		github: {
			repo: input.repo ?? "grahama1970/tau",
			target: input.target ?? "new",
		},
		goal: {
			goal_id: input.goalId ?? "goal-tau-chat-hardening",
			goal_version: input.goalVersion ?? 1,
			goal_hash: input.goalHash ?? DEFAULT_GOAL_HASH,
		},
		previous_subagent: input.previousSubagent ?? "webgpt-ticket-author",
		context: {
			summary: input.contextSummary,
			artifacts: input.contextArtifacts ?? [],
		},
		result: {
			status: input.resultStatus,
			summary: input.resultSummary,
			evidence: input.resultEvidence ?? [],
		},
		rationale: input.rationale,
		next_agent: {
			name: input.nextAgentName,
			executor: input.nextAgentExecutor ?? "either",
			reason: input.nextAgentReason,
		},
		required_evidence: input.requiredEvidence,
		stop_condition: input.stopCondition,
	};
}

export function validateTauAgentHandoff(handoff: unknown): TauAgentHandoffValidation {
	const errors: string[] = [];
	if (!isRecord(handoff)) return { ok: false, errors: ["handoff must be an object"] };

	requireLiteral(handoff, "schema", TAU_AGENT_HANDOFF_SCHEMA, errors);
	const github = requireRecord(handoff, "github", errors);
	const goal = requireRecord(handoff, "goal", errors);
	const context = requireRecord(handoff, "context", errors);
	const result = requireRecord(handoff, "result", errors);
	const nextAgent = requireRecord(handoff, "next_agent", errors);

	requireNonEmptyString(github, "repo", "github", errors);
	requireNonEmptyString(github, "target", "github", errors);

	requireNonEmptyString(goal, "goal_id", "goal", errors);
	if (typeof goal?.goal_version !== "number" || !Number.isInteger(goal.goal_version) || goal.goal_version < 1) {
		errors.push("goal.goal_version must be a positive integer");
	}
	requireNonEmptyString(goal, "goal_hash", "goal", errors);

	requireNonEmptyString(handoff, "previous_subagent", "agent_handoff", errors);
	requireNonEmptyString(context, "summary", "context", errors);
	requireStringArray(context, "artifacts", "context", errors);

	requireNonEmptyString(result, "status", "result", errors);
	requireNonEmptyString(result, "summary", "result", errors);
	requireStringArray(result, "evidence", "result", errors);

	requireNonEmptyString(handoff, "rationale", "agent_handoff", errors);
	requireNonEmptyString(nextAgent, "name", "next_agent", errors);
	requireNonEmptyString(nextAgent, "reason", "next_agent", errors);
	if (nextAgent?.executor !== undefined) requireNonEmptyString(nextAgent, "executor", "next_agent", errors);

	requireStringArray(handoff, "required_evidence", "agent_handoff", errors);
	requireNonEmptyString(handoff, "stop_condition", "agent_handoff", errors);

	return {
		ok: errors.length === 0,
		errors,
		nextAgent: typeof nextAgent?.name === "string" ? nextAgent.name : undefined,
	};
}

export function deriveTauHandoffGithubProjection(
	handoff: unknown,
	options: { activeGoalHash?: string } = {},
): TauHandoffGithubProjection {
	const validation = validateTauAgentHandoff(handoff);
	const errors = [...validation.errors];
	if (!isRecord(handoff)) return { ok: false, errors };

	const goal = isRecord(handoff.goal) ? handoff.goal : null;
	const goalHash = typeof goal?.goal_hash === "string" ? goal.goal_hash : "";
	if (options.activeGoalHash && goalHash && goalHash !== options.activeGoalHash) {
		errors.push("agent handoff may not change goal.goal_hash");
	}

	if (errors.length > 0 || !validation.nextAgent) {
		return { ok: false, errors, nextAgent: validation.nextAgent };
	}

	const typed = handoff as TauAgentHandoff;
	const executor = typed.next_agent.executor || "either";
	const labels = derivedTauHandoffLabels(typed.next_agent.name, executor);

	return {
		ok: true,
		errors: [],
		target: {
			repo: typed.github.repo,
			target: typed.github.target,
		},
		goal: typed.goal,
		labels: {
			add: labels,
			remove: ["agent-active", "agent-blocked"],
		},
		comment: {
			body: renderTauHandoffComment(typed),
		},
		nextAgent: typed.next_agent.name,
	};
}

export function derivedTauHandoffLabels(nextAgent: string, executor = "either"): string[] {
	return ["agent-work", `next:${nextAgent}`, `executor:${executor}`];
}

export function renderTauHandoffComment(handoff: TauAgentHandoff): string {
	return [
		"## Tau Agent Handoff",
		"",
		`Result: \`${handoff.result.status}\``,
		`Next agent: \`${handoff.next_agent.name}\``,
		`Executor: \`${handoff.next_agent.executor || "either"}\``,
		"",
		"### Context",
		"",
		handoff.context.summary,
		"",
		"### Result",
		"",
		handoff.result.summary,
		"",
		"### Required Evidence",
		"",
		...(handoff.required_evidence.length
			? handoff.required_evidence.map((item) => `- ${item}`)
			: ["- None specified"]),
		"",
		"### Stop Condition",
		"",
		handoff.stop_condition,
		"",
		"<!-- tau-agent-handoff:v1 -->",
		"```json",
		JSON.stringify(handoff, null, 2),
		"```",
	].join("\n");
}

export function buildTauRouteHandoff(args: {
	action?: string;
	query: string;
	branch: "compliance" | "evidence-case" | "utility" | "aql" | "watch" | "personaplex";
	contextArtifacts?: string[];
	resultEvidence?: string[];
	memoryProductSummary?: Record<string, unknown> | null;
}): TauAgentHandoff {
	const action = (args.action || "").toUpperCase();
	const product = args.memoryProductSummary;
	const next = nextAgentForRoute(action, args.branch);
	return buildTauAgentHandoff({
		contextSummary: `Tau Chat handled: ${args.query}`,
		contextArtifacts: args.contextArtifacts,
		resultStatus: next.status,
		resultSummary: resultSummaryForRoute(action, product),
		resultEvidence: args.resultEvidence,
		rationale: next.rationale,
		nextAgentName: next.name,
		nextAgentExecutor: next.executor,
		nextAgentReason: next.reason,
		requiredEvidence: next.requiredEvidence,
		stopCondition: next.stopCondition,
	});
}

export function summarizeTauAgentHandoff(handoff: TauAgentHandoff): string {
	return [
		"| Handoff field | Value |",
		"| --- | --- |",
		`| schema | ${handoff.schema} |`,
		`| previous subagent | ${handoff.previous_subagent} |`,
		`| result status | ${handoff.result.status} |`,
		`| next agent | ${handoff.next_agent.name} |`,
		`| executor | ${handoff.next_agent.executor || "either"} |`,
		`| stop condition | ${handoff.stop_condition} |`,
	].join("\n");
}

export function summarizeTauHandoffGithubProjection(projection: TauHandoffGithubProjection): string {
	if (!projection.ok) {
		return [
			"| GitHub projection | Value |",
			"| --- | --- |",
			"| status | refused |",
			`| errors | ${projection.errors.join("; ") || "unknown"} |`,
		].join("\n");
	}
	return [
		"| GitHub projection | Value |",
		"| --- | --- |",
		`| status | dry-run |`,
		`| target | ${projection.target?.repo ?? "unknown"} ${projection.target?.target ?? "unknown"} |`,
		`| labels add | ${(projection.labels?.add ?? []).join(", ")} |`,
		`| labels remove | ${(projection.labels?.remove ?? []).join(", ")} |`,
	].join("\n");
}

export function renderTauHandoffGithubProjectionJsonBlock(projection: TauHandoffGithubProjection): string {
	const renderedProjection = {
		contract: "tau.handoff_github_projection.rendered.v1",
		...projection,
		comment: projection.comment
			? {
					body_format: "github-markdown",
					body_marker: "<!-- tau-agent-handoff:v1 -->",
					body_embeds_handoff_json: projection.comment.body.includes('"schema": "tau.agent_handoff.v1"'),
				}
			: undefined,
	};
	return [
		"### Tau handoff GitHub projection JSON contract",
		"",
		"```json",
		JSON.stringify(renderedProjection, null, 2),
		"```",
	].join("\n");
}

export function deriveTauHandoffGithubTransportReceipt(
	projection: TauHandoffGithubProjection,
): TauHandoffGithubTransportReceipt {
	if (!projection.ok || !projection.target || !projection.labels || !projection.comment) {
		return {
			schema: "tau.handoff_github_transport_receipt.v1",
			ok: false,
			dryRun: true,
			applied: false,
			target: projection.target,
			goal: projection.goal,
			labels: projection.labels,
			commandCount: 0,
			commands: [],
			errors: projection.errors.length ? projection.errors : ["projection is not transportable"],
			sourceProjectionContract: "tau.handoff_github_projection.rendered.v1",
		};
	}

	const target = parseTauGithubTarget(projection.target.target);
	if (!target.ok) {
		return {
			schema: "tau.handoff_github_transport_receipt.v1",
			ok: false,
			dryRun: true,
			applied: false,
			target: projection.target,
			goal: projection.goal,
			labels: projection.labels,
			commandCount: 0,
			commands: [],
			errors: [target.error],
			sourceProjectionContract: "tau.handoff_github_projection.rendered.v1",
		};
	}

	const labelCsv = projection.labels.add.join(",");
	const removeLabelCsv = projection.labels.remove.join(",");
	const commentCommand =
		target.kind === "new"
			? `gh issue create --repo ${projection.target.repo} --title "Tau agent handoff: ${projection.nextAgent ?? "next-agent"}" --body-file - --label ${labelCsv}`
			: `gh ${target.kind} comment ${target.number} --repo ${projection.target.repo} --body-file -`;
	const commands = [
		commentCommand,
		...(target.kind === "new"
			? []
			: [
					`gh ${target.kind} edit ${target.number} --repo ${projection.target.repo} --add-label ${labelCsv} --remove-label ${removeLabelCsv}`,
				]),
	];

	return {
		schema: "tau.handoff_github_transport_receipt.v1",
		ok: true,
		dryRun: true,
		applied: false,
		target: projection.target,
		goal: projection.goal,
		labels: projection.labels,
		commandCount: commands.length,
		commands,
		errors: [],
		sourceProjectionContract: "tau.handoff_github_projection.rendered.v1",
	};
}

export function renderTauHandoffGithubTransportReceiptJsonBlock(receipt: TauHandoffGithubTransportReceipt): string {
	return [
		"### Tau handoff GitHub transport receipt JSON contract",
		"",
		"```json",
		JSON.stringify(receipt, null, 2),
		"```",
	].join("\n");
}

function parseTauGithubTarget(
	target: string,
): { ok: true; kind: "new" } | { ok: true; kind: "issue" | "pr"; number: number } | { ok: false; error: string } {
	if (target === "new") return { ok: true, kind: "new" };

	const match = /^(issue|pr)#([1-9]\d*)$/.exec(target);
	if (!match) {
		return {
			ok: false,
			error: `unsupported GitHub target "${target}"; expected new, issue#<number>, or pr#<number>`,
		};
	}

	return {
		ok: true,
		kind: match[1] as "issue" | "pr",
		number: Number(match[2]),
	};
}

function nextAgentForRoute(action: string, branch: string) {
	if (action === "CLARIFY") {
		return {
			name: "human",
			executor: "human",
			status: "NEEDS_HUMAN" as const,
			reason: "Memory requested clarification before further routing.",
			rationale: "A human answer is required before Tau can continue safely.",
			requiredEvidence: ["Human supplies the missing scope or entity."],
			stopCondition: "Human posts a schema-valid clarification or route handoff.",
		};
	}
	if (action === "DEFLECT" || action === "NO_MATCH" || action === "OFF_TOPIC") {
		return {
			name: "human",
			executor: "human",
			status: "NOOP" as const,
			reason: "Memory deflected the turn away from recall or evidence work.",
			rationale: "No downstream subagent should run on a deflected turn.",
			requiredEvidence: ["Deflection product is visible in the Tau receipt."],
			stopCondition: "Human provides a new in-scope request if work should continue.",
		};
	}
	if (action === "RESEARCH") {
		return {
			name: "research-auditor",
			executor: "either",
			status: "NEEDS_AGENT" as const,
			reason: "Fresh research is required before Tau may answer.",
			rationale: "Tau Chat does not claim web results until a research lane produces evidence.",
			requiredEvidence: ["Research receipt with sources and retrieval timestamp."],
			stopCondition: "Research auditor posts a schema-valid receipt or routes to human.",
		};
	}
	if (branch === "evidence-case") {
		return {
			name: "reviewer",
			executor: "either",
			status: "NEEDS_REVIEW" as const,
			reason: "Compliance evidence needs independent review before stronger claims.",
			rationale: "Tau has Memory intent/recall evidence but not a final reviewed evidence case.",
			requiredEvidence: ["Reviewer receipt over the Memory packet and any evidence-case artifact."],
			stopCondition: "Reviewer posts PASS, NEEDS_CHANGES, BLOCKED, or INSUFFICIENT_EVIDENCE.",
		};
	}
	return {
		name: "reviewer",
		executor: "either",
		status: "NEEDS_REVIEW" as const,
		reason: "The Memory-backed answer needs independent receipt review before promotion.",
		rationale: "A bounded review step preserves the harness proof boundary.",
		requiredEvidence: ["Reviewer receipt over the Memory product and final answer."],
		stopCondition: "Reviewer posts a schema-valid receipt.",
	};
}

function resultSummaryForRoute(action: string, product?: Record<string, unknown> | null): string {
	const parts = [`Memory action ${action || "UNKNOWN"} completed in Tau Chat.`];
	if (product && typeof product.item_count === "number") parts.push(`item_count=${product.item_count}`);
	if (product && typeof product.found === "boolean") parts.push(`found=${product.found}`);
	if (product && typeof product.can_answer === "boolean") parts.push(`can_answer=${product.can_answer}`);
	if (product && typeof product.should_deflect === "boolean") parts.push(`should_deflect=${product.should_deflect}`);
	return parts.join(" ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requireRecord(
	parent: Record<string, unknown>,
	field: string,
	errors: string[],
): Record<string, unknown> | null {
	const value = parent[field];
	if (!isRecord(value)) {
		errors.push(`${field} must be an object`);
		return null;
	}
	return value;
}

function requireLiteral(parent: Record<string, unknown>, field: string, literal: string, errors: string[]): void {
	if (parent[field] !== literal) errors.push(`${field} must be ${literal}`);
}

function requireNonEmptyString(
	parent: Record<string, unknown> | null,
	field: string,
	prefix: string,
	errors: string[],
): void {
	if (!parent || typeof parent[field] !== "string" || !String(parent[field]).trim()) {
		errors.push(`${prefix}.${field} must be a non-empty string`);
	}
}

function requireStringArray(
	parent: Record<string, unknown> | null,
	field: string,
	prefix: string,
	errors: string[],
): void {
	const value = parent?.[field];
	if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
		errors.push(`${prefix}.${field} must be a string array`);
	}
}

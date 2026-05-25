export type ExecGraphNode = {
	id: string;
	type: string;
	node_goal: string;
	revision_id?: string;
	depends_on?: string[];
	protocol_role?: string;
	persona_ref?: string;
	model?: string;
	model_pool?: string;
	prompt?: string;
	prompt_path?: string;
	instruction?: string;
	review_scopes?: ReviewScopeSpec[];
	messages?: Array<Record<string, unknown>>;
	output_schema?: Record<string, unknown>;
	template_id?: string;
	template_version?: string;
	template_sha256?: string;
	catalog_id?: string;
	catalog_version?: string;
	catalog_sha256?: string;
	inline_overrides?: Record<string, unknown>;
	command?: string | string[];
	items?: Array<Record<string, unknown>>;
	manifest?: string | Record<string, unknown>;
	manifest_path?: string;
	context?: string;
	context_file?: string;
	review_bundle?: string;
	review_bundle_artifact?: string;
	review_files?: string[];
	files?: string[];
	target_files?: string[];
	url?: string;
	base_url?: string;
	output_dir?: string;
	output?: string;
	artifact_dir?: string;
	persona?: string;
	persona_file?: string;
	screenshots?: string[];
	screenshot?: string;
	screenshot_dir?: string;
	template?: string;
	template_path?: string;
	expected_response?: unknown;
	expected_response_path?: string;
	expected_output?: unknown;
	validator_or_smoke?: string;
	validator?: string;
	validator_command?: string;
	smoke_command?: string;
	consumer_or_schema?: string;
	consumer?: string;
	consumer_code?: string;
	schema?: Record<string, unknown> | string;
	schema_path?: string;
	handoff?: string;
	task?: string;
	acceptance_evidence?: string | string[];
	evidence_artifacts?: string[];
	expected_artifacts?: string[];
	retry_policy?: Record<string, unknown>;
	gate_policy?: Record<string, unknown>;
	disabled?: boolean;
	archived?: boolean;
	superseded_by?: string;
	action?: string;
	runtime?: Record<string, unknown>;
	input?: Record<string, unknown>;
	inputs?: Record<string, unknown>;
	metadata?: Record<string, unknown>;
};

export type ReviewScopeSpec = {
	scope?: string;
	contract?: string;
	agent?: string;
	model?: string;
	review_level?: "default" | "risk_expanded" | "adversarial" | "proof_gapfill" | string;
	proof_level?: "proven" | "static_confirmed" | "likely" | "speculative" | string;
	reducer_policy?: string;
	read_only?: boolean;
	evidence_required?: boolean;
	closure_authority?: string;
	risk_triggers?: string[];
	best_practice_skills?: string[];
	prompt_preset?: string;
	prompt?: string;
	catalog_id?: string;
	catalog_version?: string;
	catalog_sha256?: string;
	inline_overrides?: Record<string, unknown>;
	enabled?: boolean;
};

export type ExecGraph = {
	exec_graph_version: string;
	graph_id: string;
	graph_goal: string;
	self_improvement_iterations?: number;
	review_fanout_limits?: ReviewDomainLimits;
	review_iteration_limits?: ReviewDomainLimits;
	nodes: ExecGraphNode[];
};

export type ReviewDomainLimits = {
	review_code?: number;
	review_design?: number;
	review_prompt?: number;
};

export type PlanValidationSeverity = "blocking" | "warning" | "info";

export type PlanValidationIssue = {
	severity: PlanValidationSeverity;
	code: string;
	message: string;
	node_id?: string;
};

export type PlanValidationResult = {
	issues: PlanValidationIssue[];
	blocking: PlanValidationIssue[];
	warnings: PlanValidationIssue[];
	infos: PlanValidationIssue[];
	canApply: boolean;
};

function isDeprecatedReviewModel(model?: string): boolean {
	const value = String(model ?? "").trim();
	return value === "text" || value.startsWith("text-") || value === "local-text" || value === "moonshot-text";
}

export type RuntimeReadinessStatus = "runtime_ready" | "blocked_missing_fields" | "manual_action_required";

export type RuntimeReadinessNodeReport = {
	node_id: string;
	type: string;
	adapter: string;
	status: RuntimeReadinessStatus;
	required_fields: string[];
	present_fields: string[];
	missing_fields: string[];
	inferred_fields: Array<{ field: string; source: string; value: unknown }>;
	missing_artifacts: string[];
	next_action: string;
};

export type RuntimeReadinessReport = {
	schema: "plan_iterate.graph_runtime_readiness.v1";
	graph_id: string;
	graph_goal: string;
	phase_id?: string;
	created_at?: string;
	can_execute_runtime: boolean;
	summary: {
		node_count: number;
		runtime_ready_node_count: number;
		blocked_node_count: number;
		manual_node_count: number;
		blocked_nodes: string[];
		manual_nodes: string[];
		missing_fields_by_node: Record<string, string[]>;
	};
	nodes: RuntimeReadinessNodeReport[];
};

export type RuntimeReadinessOptions = {
	phase_id?: string;
	changed_files?: Array<string | { path?: string }>;
	created_at?: string;
};

export type PlanPatch =
	| { op: "update_node"; node_id: string; fields: Partial<ExecGraphNode> }
	| { op: "add_node"; node: ExecGraphNode }
	| { op: "remove_node"; node_id: string }
	| { op: "add_dependency"; node_id: string; depends_on: string }
	| { op: "remove_dependency"; node_id: string; depends_on: string };

export type NicoPlanProposal = {
	id: string;
	title: string;
	proposed_by: string;
	rationale?: string;
	created_at?: string;
	patches: PlanPatch[];
};

export type PlanPatchResult = {
	graph: ExecGraph;
	applied: boolean;
	issue?: PlanValidationIssue;
	provenance?: {
		proposal_id: string;
		proposed_by: string;
		patch_count: number;
	};
};

export type PlanDiffItem = {
	kind: "node_added" | "node_removed" | "node_updated" | "dependency_added" | "dependency_removed";
	node_id: string;
	label: string;
	field?: keyof ExecGraphNode;
	dependency?: string;
	before?: unknown;
	after?: unknown;
};

export type EditorGraph = {
	nodes: ExecGraphNode[];
	edges: Array<{ id: string; source: string; target: string }>;
};

const EDITABLE_NODE_FIELDS: Array<keyof ExecGraphNode> = [
	"type",
	"node_goal",
	"protocol_role",
	"persona_ref",
	"model",
	"prompt",
	"review_scopes",
	"retry_policy",
	"gate_policy",
	"disabled",
	"archived",
	"superseded_by",
];

export function cloneExecGraph(graph: ExecGraph): ExecGraph {
	return {
		...graph,
		review_fanout_limits: graph.review_fanout_limits ? { ...graph.review_fanout_limits } : undefined,
		review_iteration_limits: graph.review_iteration_limits ? { ...graph.review_iteration_limits } : undefined,
		nodes: graph.nodes.map((node) => ({
			...node,
			depends_on: node.depends_on ? [...node.depends_on] : undefined,
			review_scopes: node.review_scopes ? node.review_scopes.map((scope) => ({ ...scope })) : undefined,
			messages: node.messages ? node.messages.map((message) => ({ ...message })) : undefined,
			output_schema: node.output_schema ? { ...node.output_schema } : undefined,
			retry_policy: node.retry_policy ? { ...node.retry_policy } : undefined,
			gate_policy: node.gate_policy ? { ...node.gate_policy } : undefined,
			metadata: node.metadata ? { ...node.metadata } : undefined,
		})),
	};
}

export function execGraphToEditorGraph(graph: ExecGraph): EditorGraph {
	return {
		nodes: graph.nodes.map((node) => ({ ...node, depends_on: node.depends_on ? [...node.depends_on] : undefined })),
		edges: graph.nodes.flatMap((node) =>
			(node.depends_on ?? []).map((dependency) => ({
				id: `${dependency}->${node.id}`,
				source: dependency,
				target: node.id,
			})),
		),
	};
}

export function validateExecGraphPlan(graph: ExecGraph): PlanValidationResult {
	const issues: PlanValidationIssue[] = [];
	const ids = new Set<string>();
	const duplicateIds = new Set<string>();

	if (
		graph.self_improvement_iterations !== undefined &&
		(!Number.isInteger(graph.self_improvement_iterations) || graph.self_improvement_iterations < 1)
	) {
		issues.push({
			severity: "blocking",
			code: "invalid_self_improvement_iterations",
			message: "self_improvement_iterations must be a positive integer.",
		});
	}
	validateDomainLimits(graph.review_fanout_limits, "review_fanout_limits", true, issues);
	validateDomainLimits(graph.review_iteration_limits, "review_iteration_limits", false, issues);

	for (const node of graph.nodes) {
		if (!node.id.trim()) {
			issues.push({ severity: "blocking", code: "missing_node_id", message: "A node is missing an id." });
			continue;
		}
		if (ids.has(node.id)) duplicateIds.add(node.id);
		ids.add(node.id);
	}

	for (const id of duplicateIds) {
		issues.push({
			severity: "blocking",
			code: "duplicate_node_id",
			message: `Duplicate node id: ${id}`,
			node_id: id,
		});
	}

	for (const node of graph.nodes) {
		if (!node.type.trim()) {
			issues.push({
				severity: "blocking",
				code: "missing_node_type",
				message: "Node is missing type.",
				node_id: node.id,
			});
		}
		if (!node.node_goal.trim()) {
			issues.push({
				severity: "blocking",
				code: "missing_node_goal",
				message: "Node is missing goal.",
				node_id: node.id,
			});
		}

		const dependencies = node.depends_on ?? [];
		const seenDependencies = new Set<string>();
		for (const dependency of dependencies) {
			if (dependency === node.id) {
				issues.push({
					severity: "blocking",
					code: "self_dependency",
					message: "Node cannot depend on itself.",
					node_id: node.id,
				});
			}
			if (seenDependencies.has(dependency)) {
				issues.push({
					severity: "blocking",
					code: "duplicate_dependency",
					message: `Duplicate dependency: ${dependency}`,
					node_id: node.id,
				});
			}
			seenDependencies.add(dependency);
			if (!ids.has(dependency)) {
				issues.push({
					severity: "blocking",
					code: "missing_dependency",
					message: `Dependency does not exist: ${dependency}`,
					node_id: node.id,
				});
			}
		}

		const promptLike = /prompt|llm|model|scillm|claude|openai|gemini|review-code/i.test(
			`${node.type} ${node.protocol_role ?? ""} ${node.node_goal}`,
		);
		const reviewCodeLike = /review-code|review_code/i.test(
			`${node.type} ${node.protocol_role ?? ""} ${node.node_goal}`,
		);
		if (
			promptLike &&
			!node.prompt &&
			!node.messages?.length &&
			!node.review_scopes?.some((scope) => scope.prompt?.trim())
		) {
			issues.push({
				severity: "warning",
				code: "missing_prompt_contract",
				message: "Prompt-like node has no prompt or messages.",
				node_id: node.id,
			});
		}
		if (reviewCodeLike && !node.review_scopes?.length) {
			issues.push({
				severity: "warning",
				code: "missing_review_scopes",
				message: "review-code node has no scoped review contracts.",
				node_id: node.id,
			});
		}
		if (node.review_scopes?.length) {
			const seenContracts = new Set<string>();
			for (const scope of node.review_scopes) {
				if (scope.enabled === false) continue;
				const contractName = reviewContractName(scope);
				if (!scope.agent?.trim()) {
					issues.push({
						severity: "blocking",
						code: "missing_review_agent",
						message: "Enabled review fanout row is missing an agent.",
						node_id: node.id,
					});
				}
				if (!contractName) {
					issues.push({
						severity: "blocking",
						code: "missing_review_contract",
						message: "Enabled review fanout row is missing a contract.",
						node_id: node.id,
					});
					continue;
				}
				if (!scope.model?.trim()) {
					issues.push({
						severity: "blocking",
						code: "missing_review_model",
						message: `Review contract ${contractName} is missing a model.`,
						node_id: node.id,
					});
				}
				if (isDeprecatedReviewModel(scope.model)) {
					issues.push({
						severity: "blocking",
						code: "deprecated_review_model",
						message: `Review contract ${contractName} uses deprecated review model ${scope.model?.trim()}; choose a provider-family or exact model.`,
						node_id: node.id,
					});
				}
				if (!scope.proof_level?.trim()) {
					issues.push({
						severity: "blocking",
						code: "missing_review_proof_level",
						message: `Review contract ${contractName} is missing a proof level.`,
						node_id: node.id,
					});
				}
				if (!scope.best_practice_skills?.length) {
					issues.push({
						severity: "blocking",
						code: "missing_review_best_practices",
						message: `Review contract ${contractName} is missing best-practices skill inputs.`,
						node_id: node.id,
					});
				} else {
					for (const skill of scope.best_practice_skills) {
						if (!String(skill ?? "").trim() || !String(skill).startsWith("best-practices-")) {
							issues.push({
								severity: "blocking",
								code: "invalid_review_best_practices",
								message: `Review contract ${contractName} must use best-practices-* skill names.`,
								node_id: node.id,
							});
						}
					}
				}
				if (seenContracts.has(contractName)) {
					issues.push({
						severity: "blocking",
						code: "duplicate_review_contract",
						message: `Duplicate review contract: ${contractName}`,
						node_id: node.id,
					});
				}
				seenContracts.add(contractName);
				if (!scope.prompt?.trim()) {
					issues.push({
						severity: "warning",
						code: "missing_review_contract_prompt",
						message: `Review contract ${contractName} has no prompt body.`,
						node_id: node.id,
					});
				}
				if (scope.catalog_id && !scope.catalog_version?.trim()) {
					issues.push({
						severity: "blocking",
						code: "missing_catalog_version",
						message: `Review contract ${contractName} is pinned to a catalog id but is missing catalog_version.`,
						node_id: node.id,
					});
				}
				if (scope.catalog_id && !scope.catalog_sha256?.trim()) {
					issues.push({
						severity: "blocking",
						code: "missing_catalog_sha256",
						message: `Review contract ${contractName} is pinned to a catalog id but is missing catalog_sha256.`,
						node_id: node.id,
					});
				}
				if (scope.inline_overrides?.prompt && scope.prompt_preset !== "custom") {
					issues.push({
						severity: "warning",
						code: "catalog_prompt_override_not_custom",
						message: `Review contract ${contractName} has a prompt override but prompt_preset is not custom.`,
						node_id: node.id,
					});
				}
			}
		}
	}

	for (const cycle of findCycles(graph)) {
		issues.push({
			severity: "blocking",
			code: "cycle",
			message: `Cycle detected: ${cycle.join(" -> ")}`,
			node_id: cycle[0],
		});
	}

	const rootCount = graph.nodes.filter((node) => (node.depends_on ?? []).length === 0).length;
	if (graph.nodes.length > 0 && rootCount === 0) {
		issues.push({ severity: "blocking", code: "missing_root", message: "Graph has no root node." });
	}
	if (graph.nodes.length === 0) {
		issues.push({ severity: "blocking", code: "empty_graph", message: "Graph has no nodes." });
	}

	const blocking = issues.filter((issue) => issue.severity === "blocking");
	const warnings = issues.filter((issue) => issue.severity === "warning");
	const infos = issues.filter((issue) => issue.severity === "info");
	return { issues, blocking, warnings, infos, canApply: blocking.length === 0 };
}

const RUNTIME_NODE_TYPES = new Set([
	"local_command",
	"deterministic_render",
	"deterministic_verifier",
	"scillm_call",
	"scillm_batch",
	"codex_exec",
	"claude_print",
]);

function nodeValue(node: ExecGraphNode, key: string): unknown {
	const direct = (node as Record<string, unknown>)[key];
	if (direct !== undefined) return direct;
	for (const containerKey of ["runtime", "input", "inputs", "metadata"]) {
		const container = (node as Record<string, unknown>)[containerKey];
		if (container && typeof container === "object" && key in (container as Record<string, unknown>)) {
			return (container as Record<string, unknown>)[key];
		}
	}
	return undefined;
}

function hasNodeValue(node: ExecGraphNode, ...keys: string[]): boolean {
	return keys.some((key) => {
		const value = nodeValue(node, key);
		if (typeof value === "string") return value.trim().length > 0;
		if (Array.isArray(value)) return value.length > 0;
		if (value && typeof value === "object") return Object.keys(value).length > 0;
		return typeof value === "boolean" || typeof value === "number";
	});
}

function changedFilePaths(options?: RuntimeReadinessOptions): string[] {
	return (options?.changed_files ?? []).flatMap((entry) => {
		if (typeof entry === "string" && entry.trim()) return [entry];
		if (entry && typeof entry === "object" && typeof entry.path === "string" && entry.path.trim())
			return [entry.path];
		return [];
	});
}

function reviewScopeMissingFields(scope: ReviewScopeSpec | undefined, prefix: string): string[] {
	if (!scope) return [prefix];
	const missing: string[] = [];
	for (const key of ["scope", "model", "agent", "contract", "proof_level"] as const) {
		if (!String(scope[key] ?? "").trim()) missing.push(`${prefix}.${key}`);
	}
	if (!scope.best_practice_skills?.length) missing.push(`${prefix}.best_practice_skills`);
	return missing;
}

export function analyzeExecGraphRuntimeReadiness(
	graph: ExecGraph,
	options: RuntimeReadinessOptions = {},
): RuntimeReadinessReport {
	const nodes = graph.nodes.map((node) => analyzeNodeRuntimeReadiness(node, options));
	const blockedNodes = nodes.filter((node) => node.status === "blocked_missing_fields").map((node) => node.node_id);
	const manualNodes = nodes.filter((node) => node.status === "manual_action_required").map((node) => node.node_id);
	const readyNodes = nodes.filter((node) => node.status === "runtime_ready").map((node) => node.node_id);
	return {
		schema: "plan_iterate.graph_runtime_readiness.v1",
		graph_id: graph.graph_id,
		graph_goal: graph.graph_goal,
		phase_id: options.phase_id,
		created_at: options.created_at,
		can_execute_runtime: blockedNodes.length === 0 && manualNodes.length === 0,
		summary: {
			node_count: nodes.length,
			runtime_ready_node_count: readyNodes.length,
			blocked_node_count: blockedNodes.length,
			manual_node_count: manualNodes.length,
			blocked_nodes: blockedNodes,
			manual_nodes: manualNodes,
			missing_fields_by_node: Object.fromEntries(
				nodes.filter((node) => node.missing_fields.length).map((node) => [node.node_id, node.missing_fields]),
			),
		},
		nodes,
	};
}

function analyzeNodeRuntimeReadiness(
	node: ExecGraphNode,
	options: RuntimeReadinessOptions,
): RuntimeReadinessNodeReport {
	const required_fields: string[] = [];
	const present_fields: string[] = [];
	const missing_fields: string[] = [];
	const inferred_fields: RuntimeReadinessNodeReport["inferred_fields"] = [];
	const missing_artifacts: string[] = [];
	let adapter = "semantic:unmapped";
	let status: RuntimeReadinessStatus = "blocked_missing_fields";
	let next_action = "add an explicit runtime adapter or handoff contract";

	function require(field: string, ...aliases: string[]) {
		required_fields.push(aliases.length ? `${field} (${aliases.join(", ")})` : field);
		if (hasNodeValue(node, field, ...aliases)) present_fields.push(field);
		else missing_fields.push(field);
	}

	if (RUNTIME_NODE_TYPES.has(node.type)) {
		adapter = `scillm_exec:${node.type}`;
		if (["local_command", "deterministic_render", "deterministic_verifier"].includes(node.type)) require("command");
		if (node.type === "scillm_call") {
			require("model");
			require("prompt", "messages", "prompt_path");
		}
		if (node.type === "scillm_batch") {
			require("model", "model_pool");
			require("items", "manifest_path");
		}
		if (["codex_exec", "claude_print"].includes(node.type)) require("prompt", "prompt_path", "instruction");
		next_action = "compile or submit this runtime node after required fields are present";
	} else if (node.type === "review-code") {
		adapter = "review-code:one-shot";
		require("context", "context_file", "review_bundle", "review_bundle_artifact");
		required_fields.push("files (review_files, files, target_files, or phase changed_files)");
		if (hasNodeValue(node, "review_files", "files", "target_files")) {
			present_fields.push("files");
		} else {
			const changedPaths = changedFilePaths(options);
			if (changedPaths.length) {
				present_fields.push("files");
				inferred_fields.push({ field: "files", source: "PHASE_STATUS.changed_files", value: changedPaths });
			} else {
				missing_fields.push("files");
			}
		}
		required_fields.push("review_scopes[].scope/model/agent/contract/proof_level/best_practice_skills");
		if (node.review_scopes?.length) {
			present_fields.push("review_scopes");
			for (const [index, scope] of node.review_scopes.entries()) {
				missing_fields.push(...reviewScopeMissingFields(scope, `review_scopes[${index}]`));
			}
		} else {
			missing_fields.push("review_scopes");
		}
		next_action = "provide review context and files, then run review-code fanout";
	} else if (node.type === "test-interactions") {
		adapter = "test-interactions:run-or-full";
		required_fields.push("manifest or url");
		if (hasNodeValue(node, "manifest", "manifest_path")) present_fields.push("manifest");
		else if (hasNodeValue(node, "url", "base_url")) {
			present_fields.push("url");
			require("persona", "persona_file");
		} else missing_fields.push("manifest_or_url");
		require("output_dir", "output", "artifact_dir");
		next_action = "supply a test-interactions manifest or URL/persona pair";
	} else if (node.type === "review-design") {
		adapter = "review-design:iterate-or-review";
		require("persona", "persona_file");
		required_fields.push("manifest or screenshots");
		if (hasNodeValue(node, "manifest", "manifest_path")) present_fields.push("manifest");
		else if (hasNodeValue(node, "screenshots", "screenshot", "screenshot_dir")) present_fields.push("screenshots");
		else missing_fields.push("manifest_or_screenshots");
		require("output_dir", "output", "artifact_dir");
		next_action = "provide persona plus screenshots or a test-interactions manifest";
	} else if (node.type === "review-prompt") {
		adapter = "review-prompt:review";
		require("template", "template_path", "prompt", "prompt_path");
		require("context", "context_file", "fixture", "fixture_path");
		require("expected_response", "expected_response_path", "expected_output");
		require("validator_or_smoke", "validator", "validator_command", "smoke_command");
		require("consumer_or_schema", "consumer", "consumer_code", "schema", "schema_path");
		next_action = "complete the prompt-review bundle before reviewer calls";
	} else if (node.type === "plan-iterate") {
		adapter = "plan-iterate:ledger";
		required_fields.push("phase");
		present_fields.push("phase");
		if (!hasNodeValue(node, "phase", "phase_id"))
			inferred_fields.push({ field: "phase", source: "CLI --phase", value: options.phase_id ?? "" });
		status = "runtime_ready";
		next_action = "plan-iterate can validate or package the current phase ledger";
	} else if (node.type === "project-agent") {
		adapter = "project-agent:manual";
		required_fields.push("command_or_handoff", "acceptance_evidence");
		const hasRuntimeCommand = hasNodeValue(node, "command");
		if (hasNodeValue(node, "command", "handoff", "prompt", "task")) present_fields.push("command_or_handoff");
		else missing_fields.push("command_or_handoff");
		if (hasNodeValue(node, "acceptance_evidence", "evidence_artifacts", "expected_artifacts"))
			present_fields.push("acceptance_evidence");
		else missing_fields.push("acceptance_evidence");
		if (!missing_fields.length && hasRuntimeCommand) {
			adapter = "project-agent:local_command";
			status = "runtime_ready";
			next_action = "compile the explicit project-agent command into the runtime graph";
		} else {
			status = "manual_action_required";
			next_action = "make the project-agent work item explicit before compiling this DAG";
		}
	} else {
		required_fields.push("runtime.type or adapter");
		if (hasNodeValue(node, "runtime", "adapter", "command")) {
			present_fields.push("runtime.type or adapter");
			status = "runtime_ready";
			next_action = "adapter is present; compiler must map it explicitly";
		} else {
			missing_fields.push("runtime.type_or_adapter");
		}
	}

	if (node.type !== "project-agent") {
		status = missing_fields.length || missing_artifacts.length ? "blocked_missing_fields" : "runtime_ready";
	}

	return {
		node_id: node.id,
		type: node.type,
		adapter,
		status,
		required_fields,
		present_fields: Array.from(new Set(present_fields)).sort(),
		missing_fields: Array.from(new Set(missing_fields)).sort(),
		inferred_fields,
		missing_artifacts,
		next_action,
	};
}

function validateDomainLimits(
	limits: ReviewDomainLimits | undefined,
	field: string,
	allowZero: boolean,
	issues: PlanValidationIssue[],
) {
	if (limits === undefined) return;
	const value = limits as Record<string, unknown>;
	for (const key of ["review_code", "review_design", "review_prompt"]) {
		const limit = value[key];
		const minimum = allowZero ? 0 : 1;
		if (!Number.isInteger(limit) || Number(limit) < minimum) {
			issues.push({
				severity: "blocking",
				code: `invalid_${field}_${key}`,
				message: `${field}.${key} must be an integer >= ${minimum}.`,
			});
		}
	}
}

export function applyPlanPatch(graph: ExecGraph, patch: PlanPatch): PlanPatchResult {
	const next = cloneExecGraph(graph);
	const node = next.nodes.find((candidate) => candidate.id === ("node_id" in patch ? patch.node_id : patch.node.id));

	if (patch.op !== "add_node" && !node) {
		return {
			graph,
			applied: false,
			issue: {
				severity: "blocking",
				code: "node_not_found",
				message: `Node not found: ${patch.node_id}`,
				node_id: patch.node_id,
			},
		};
	}

	if (patch.op === "update_node") {
		Object.assign(node!, sanitizeNodeFields(patch.fields));
	}

	if (patch.op === "add_node") {
		if (next.nodes.some((candidate) => candidate.id === patch.node.id)) {
			return {
				graph,
				applied: false,
				issue: {
					severity: "blocking",
					code: "duplicate_node_id",
					message: `Duplicate node id: ${patch.node.id}`,
					node_id: patch.node.id,
				},
			};
		}
		next.nodes.push({ ...patch.node, depends_on: patch.node.depends_on ? [...patch.node.depends_on] : undefined });
	}

	if (patch.op === "remove_node") {
		const dependents = next.nodes.filter((candidate) => (candidate.depends_on ?? []).includes(patch.node_id));
		if (dependents.length > 0) {
			return {
				graph,
				applied: false,
				issue: {
					severity: "blocking",
					code: "unsafe_required_node_deletion",
					message: `Cannot remove ${patch.node_id}; downstream nodes depend on it: ${dependents.map((candidate) => candidate.id).join(", ")}`,
					node_id: patch.node_id,
				},
			};
		}
		next.nodes = next.nodes.filter((candidate) => candidate.id !== patch.node_id);
	}

	if (patch.op === "add_dependency") {
		if (!next.nodes.some((candidate) => candidate.id === patch.depends_on)) {
			return {
				graph,
				applied: false,
				issue: {
					severity: "blocking",
					code: "missing_dependency",
					message: `Dependency does not exist: ${patch.depends_on}`,
					node_id: patch.node_id,
				},
			};
		}
		const dependencies = new Set(node!.depends_on ?? []);
		dependencies.add(patch.depends_on);
		node!.depends_on = Array.from(dependencies);
	}

	if (patch.op === "remove_dependency") {
		node!.depends_on = (node!.depends_on ?? []).filter((dependency) => dependency !== patch.depends_on);
		if (node!.depends_on.length === 0) delete node!.depends_on;
	}

	return { graph: next, applied: true };
}

export function applyNicoPlanProposal(graph: ExecGraph, proposal: NicoPlanProposal): PlanPatchResult {
	let next = cloneExecGraph(graph);

	for (const patch of proposal.patches) {
		const result = applyPlanPatch(next, patch);
		if (!result.applied) {
			return {
				graph,
				applied: false,
				issue: result.issue,
				provenance: {
					proposal_id: proposal.id,
					proposed_by: proposal.proposed_by,
					patch_count: proposal.patches.length,
				},
			};
		}
		next = result.graph;
	}

	return {
		graph: next,
		applied: true,
		provenance: { proposal_id: proposal.id, proposed_by: proposal.proposed_by, patch_count: proposal.patches.length },
	};
}

export function diffExecGraphPlan(baseGraph: ExecGraph, draftGraph: ExecGraph): PlanDiffItem[] {
	const diffs: PlanDiffItem[] = [];
	const baseById = new Map(baseGraph.nodes.map((node) => [node.id, node]));
	const draftById = new Map(draftGraph.nodes.map((node) => [node.id, node]));

	for (const node of draftGraph.nodes) {
		const base = baseById.get(node.id);
		if (!base) {
			diffs.push({ kind: "node_added", node_id: node.id, label: `Added node ${node.id}`, after: node });
			continue;
		}
		for (const field of EDITABLE_NODE_FIELDS) {
			if (!semanticEqual(base[field], node[field])) {
				diffs.push({
					kind: "node_updated",
					node_id: node.id,
					field,
					label: `Updated ${node.id}.${field}`,
					before: base[field],
					after: node[field],
				});
			}
		}
		const baseDeps = new Set(base.depends_on ?? []);
		const draftDeps = new Set(node.depends_on ?? []);
		for (const dependency of draftDeps) {
			if (!baseDeps.has(dependency)) {
				diffs.push({
					kind: "dependency_added",
					node_id: node.id,
					dependency,
					label: `Added dependency ${dependency} -> ${node.id}`,
					before: base.depends_on ?? [],
					after: node.depends_on ?? [],
				});
			}
		}
		for (const dependency of baseDeps) {
			if (!draftDeps.has(dependency)) {
				diffs.push({
					kind: "dependency_removed",
					node_id: node.id,
					dependency,
					label: `Removed dependency ${dependency} -> ${node.id}`,
					before: base.depends_on ?? [],
					after: node.depends_on ?? [],
				});
			}
		}
	}

	for (const node of baseGraph.nodes) {
		if (!draftById.has(node.id)) {
			diffs.push({ kind: "node_removed", node_id: node.id, label: `Removed node ${node.id}`, before: node });
		}
	}

	return diffs;
}

function semanticEqual(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (left === undefined && right === "") return true;
	if (right === undefined && left === "") return true;
	return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function sanitizeNodeFields(fields: Partial<ExecGraphNode>): Partial<ExecGraphNode> {
	const sanitized = { ...fields };
	delete sanitized.id;
	if (sanitized.depends_on) {
		sanitized.depends_on = Array.from(new Set(sanitized.depends_on.filter(Boolean)));
	}
	if (sanitized.review_scopes) {
		sanitized.review_scopes = sanitized.review_scopes.map((scope) => ({
			...scope,
			contract: reviewContractName(scope),
			scope: String(scope.scope ?? scope.contract ?? "").trim(),
			agent: scope.agent ? String(scope.agent).trim() : undefined,
			model: scope.model ? String(scope.model).trim() : undefined,
			review_level: scope.review_level ? String(scope.review_level).trim() : undefined,
			proof_level: scope.proof_level ? String(scope.proof_level).trim() : undefined,
			reducer_policy: scope.reducer_policy ? String(scope.reducer_policy).trim() : undefined,
			read_only: scope.read_only ?? true,
			evidence_required: scope.evidence_required ?? true,
			closure_authority: scope.closure_authority ? String(scope.closure_authority).trim() : undefined,
			risk_triggers: scope.risk_triggers?.map((trigger) => String(trigger).trim()).filter(Boolean),
		}));
	}
	return sanitized;
}

function reviewContractName(scope: ReviewScopeSpec): string {
	return String(scope.contract ?? scope.scope ?? "").trim();
}

function findCycles(graph: ExecGraph): string[][] {
	const byId = new Map(graph.nodes.map((node) => [node.id, node]));
	const visited = new Set<string>();
	const active = new Set<string>();
	const cycles: string[][] = [];

	function visit(id: string, path: string[]) {
		if (active.has(id)) {
			const cycleStart = path.indexOf(id);
			cycles.push([...path.slice(Math.max(0, cycleStart)), id]);
			return;
		}
		if (visited.has(id)) return;
		const node = byId.get(id);
		if (!node) return;

		active.add(id);
		for (const dependency of node.depends_on ?? []) visit(dependency, [...path, id]);
		active.delete(id);
		visited.add(id);
	}

	for (const node of graph.nodes) visit(node.id, []);
	return cycles;
}

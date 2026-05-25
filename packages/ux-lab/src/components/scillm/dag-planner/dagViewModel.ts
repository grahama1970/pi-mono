import type { PlanDiffItem, PlanValidationResult } from "./execGraphPlanEditor";
import type { ExecEvent, ExecGraph, ExecGraphNode, ExecNodeState, ExecStatus } from "./ScillmExecGraphDebugger";

export type DagMode = "build" | "run" | "debug";

export type SyntheticGoalNode = {
	id: "ui-goal-root";
	type: "ui.synthetic.goal";
	label: string;
	executable: false;
	source: "layout";
};

export type ExecGraphEdge = {
	id: string;
	source: string;
	target: string;
};

export type ExecGraphNodeDraft = Partial<ExecGraphNode> & {
	id: string;
	type: string;
	node_goal: string;
};

export type ExecGraphEdgeDraft = {
	id?: string;
	source: string;
	target: string;
};

export type GatePolicyPatch = Record<string, unknown>;
export type RetryPolicyPatch = Record<string, unknown>;

export type ReviewLane = {
	id: string;
	label: string;
	nodeIds: string[];
	source: "derived";
};

export type RoundView = {
	id: string;
	label: string;
	nodeIds: string[];
	materialized: boolean;
	status: "materialized" | "draft" | "proposed";
};

export type ExecutionView = {
	previous: string[];
	running: string[];
	queued: string[];
	gated: string[];
	blocked: string[];
};

export type AmendmentOperation =
	| { op: "add_node"; node: ExecGraphNodeDraft; parentId?: string; draftOnly?: true }
	| { op: "add_edge"; edge: ExecGraphEdgeDraft }
	| { op: "remove_edge"; edgeId: string }
	| { op: "disable_node" | "archive_node"; nodeId: string; rationale?: string }
	| {
			op: "supersede_node";
			nodeId: string;
			priorRevisionId: string;
			newRevision: ExecGraphNodeDraft;
			rewirePolicy: "future_edges_only" | "explicit_edges";
			rationale?: string;
	  }
	| { op: "update_draft_node"; nodeId: string; patch: Partial<ExecGraphNodeDraft> }
	| { op: "update_contract" | "update_model" | "update_persona" | "update_prompt"; nodeId: string; value: unknown }
	| { op: "update_gate"; nodeId: string; patch: GatePolicyPatch }
	| { op: "update_retry_policy"; nodeId: string; patch: RetryPolicyPatch };

export type AmendmentWarning = {
	code: string;
	node_id?: string;
	message: string;
	severity: "blocking" | "warning";
};

export type AmendmentDraft = {
	id: string;
	baseRunId?: string;
	baseGraphHash: string;
	status: "draft" | "ready_to_apply" | "applied" | "rejected";
	operations: AmendmentOperation[];
	warnings: AmendmentWarning[];
	staleBaseGraph: boolean;
};

export type UiLayout = {
	version: "scillm.dag.ui_layout.v1";
	graphId: string;
	baseGraphHash: string;
	syntheticNodes: SyntheticGoalNode[];
	lanes: ReviewLane[];
	rounds: RoundView[];
	positions?: Record<string, { x: number; y: number }>;
};

export type DagViewModel = {
	mode: DagMode;
	goal: SyntheticGoalNode;
	executableNodes: ExecGraphNode[];
	executableEdges: ExecGraphEdge[];
	lanes: ReviewLane[];
	rounds: RoundView[];
	execution: ExecutionView;
	draft?: AmendmentDraft;
	layout: UiLayout;
};

type BuildDagViewModelInput = {
	mode: DagMode;
	graph: ExecGraph;
	baseGraphHash: string;
	draftBaseGraphHash?: string;
	status?: ExecStatus;
	events?: ExecEvent[];
	states?: Record<string, ExecNodeState>;
	diff?: PlanDiffItem[];
	validation?: PlanValidationResult;
};

export function buildDagViewModel(input: BuildDagViewModelInput): DagViewModel {
	const goal: SyntheticGoalNode = {
		id: "ui-goal-root",
		type: "ui.synthetic.goal",
		label: input.graph.graph_goal || "Goal",
		executable: false,
		source: "layout",
	};
	const lanes = deriveReviewLanes(input.graph.nodes);
	const rounds = deriveRounds(input.graph.nodes);
	const layout: UiLayout = {
		version: "scillm.dag.ui_layout.v1",
		graphId: input.graph.graph_id,
		baseGraphHash: input.baseGraphHash,
		syntheticNodes: [goal],
		lanes,
		rounds,
	};
	const draft = input.diff?.length
		? buildAmendmentDraft(
				input.graph,
				input.baseGraphHash,
				input.draftBaseGraphHash ?? input.baseGraphHash,
				input.diff,
				input.validation,
			)
		: undefined;

	return {
		mode: input.mode,
		goal,
		executableNodes: input.graph.nodes,
		executableEdges: deriveEdges(input.graph.nodes),
		lanes,
		rounds,
		execution: deriveExecution(input.events ?? [], input.states ?? {}, input.status),
		draft,
		layout,
	};
}

function deriveEdges(nodes: ExecGraphNode[]): ExecGraphEdge[] {
	return nodes.flatMap((node) =>
		(node.depends_on ?? []).map((source) => ({
			id: `${source}->${node.id}`,
			source,
			target: node.id,
		})),
	);
}

function deriveReviewLanes(nodes: ExecGraphNode[]): ReviewLane[] {
	const laneSpecs = [
		{ id: "review-code", label: "review-code", match: /review-code|review_code/i },
		{ id: "review-prompt", label: "review-prompt", match: /review-prompt|review_prompt/i },
		{ id: "review-design", label: "review-design", match: /review-design|review_design|test-interactions/i },
	];
	return laneSpecs.map((lane) => ({
		id: lane.id,
		label: lane.label,
		nodeIds: nodes
			.filter((node) => lane.match.test(`${node.id} ${node.type} ${node.protocol_role ?? ""} ${node.node_goal}`))
			.map((node) => node.id),
		source: "derived" as const,
	}));
}

function deriveRounds(nodes: ExecGraphNode[]): RoundView[] {
	const rounds = new Map<number, string[]>();
	for (const node of nodes) {
		const match = /\bround[-_]?(\d+)\b/i.exec(node.id);
		if (!match) continue;
		const roundNumber = Number(match[1]);
		if (!Number.isFinite(roundNumber)) continue;
		rounds.set(roundNumber, [...(rounds.get(roundNumber) ?? []), node.id]);
	}
	return Array.from(rounds.entries())
		.sort(([left], [right]) => left - right)
		.map(([roundNumber, nodeIds]) => ({
			id: `round-${roundNumber}`,
			label: `Round ${roundNumber}`,
			nodeIds,
			materialized: true,
			status: "materialized" as const,
		}));
}

function deriveExecution(
	events: ExecEvent[],
	states: Record<string, ExecNodeState>,
	status?: ExecStatus,
): ExecutionView {
	const previous = events
		.filter((event) => event.node_id && event.type === "node_finished")
		.slice(-3)
		.map((event) => event.node_id!);
	const running = Object.entries(states)
		.filter(([, state]) => state === "running")
		.map(([nodeId]) => nodeId);
	const queued = Object.entries(states)
		.filter(([, state]) => state === "queued" || state === "ready")
		.map(([nodeId]) => nodeId);
	const blocked = Object.entries(status?.node_results ?? {})
		.filter(([, result]) => result.ok === false)
		.map(([nodeId]) => nodeId);
	const gated = events
		.filter((event) => event.node_id && (event.type === "needs_attention" || event.state === "needs_attention"))
		.map((event) => event.node_id!);
	return { previous, running, queued, gated, blocked };
}

function buildAmendmentDraft(
	graph: ExecGraph,
	baseGraphHash: string,
	draftBaseGraphHash: string,
	diff: PlanDiffItem[],
	validation?: PlanValidationResult,
): AmendmentDraft {
	return {
		id: `draft-${graph.graph_id}`,
		baseRunId: graph.graph_id,
		baseGraphHash: draftBaseGraphHash,
		status: validation?.canApply ? "ready_to_apply" : "draft",
		operations: diff.map(diffToOperation),
		warnings: (validation?.issues ?? []).map((issue) => ({
			code: issue.code,
			node_id: issue.node_id,
			message: issue.message,
			severity: issue.severity === "blocking" ? "blocking" : "warning",
		})),
		staleBaseGraph: draftBaseGraphHash !== baseGraphHash,
	};
}

function diffToOperation(diff: PlanDiffItem): AmendmentOperation {
	if (diff.kind === "dependency_added" && diff.dependency)
		return { op: "add_edge", edge: { source: diff.dependency, target: diff.node_id } };
	if (diff.kind === "dependency_removed" && diff.dependency)
		return { op: "remove_edge", edgeId: `${diff.dependency}->${diff.node_id}` };
	if (diff.kind === "node_added" && diff.after && typeof diff.after === "object")
		return { op: "add_node", node: diff.after as ExecGraphNodeDraft, draftOnly: true };
	if (diff.kind === "node_removed") return { op: "archive_node", nodeId: diff.node_id };
	if (diff.kind === "node_updated" && diff.field === "disabled") return { op: "disable_node", nodeId: diff.node_id };
	if (diff.kind === "node_updated" && diff.field === "archived") return { op: "archive_node", nodeId: diff.node_id };
	if (diff.kind === "node_updated" && diff.field === "gate_policy")
		return { op: "update_gate", nodeId: diff.node_id, patch: diff.after as GatePolicyPatch };
	if (diff.kind === "node_updated" && diff.field === "retry_policy")
		return { op: "update_retry_policy", nodeId: diff.node_id, patch: diff.after as RetryPolicyPatch };
	if (diff.kind === "node_updated" && diff.field === "model")
		return { op: "update_model", nodeId: diff.node_id, value: diff.after };
	if (diff.kind === "node_updated" && diff.field === "persona_ref")
		return { op: "update_persona", nodeId: diff.node_id, value: diff.after };
	if (diff.kind === "node_updated" && diff.field === "prompt")
		return { op: "update_prompt", nodeId: diff.node_id, value: diff.after };
	if (diff.kind === "node_updated" && diff.field === "node_goal")
		return { op: "update_contract", nodeId: diff.node_id, value: diff.after };
	return { op: "update_draft_node", nodeId: diff.node_id ?? "graph", patch: { metadata: { diff } } };
}

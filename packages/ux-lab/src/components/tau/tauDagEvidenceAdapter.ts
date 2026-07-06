import type { TransportDagEvidence, TransportDagEvidenceNode } from "../scillm/transport/transportClient";

export type TauDagRunManifest = {
	schema?: "ux_lab.tau_dag_run_manifest.v1";
	defaultRunId?: string;
	runs: Array<{
		id: string;
		label: string;
		path: string;
		source: string;
		source_repo?: string;
		source_commit?: string;
	}>;
};

export type TauDagNodeSpec = {
	id: string;
	agent?: string;
	executor?: string;
	max_attempts?: number;
	required_evidence?: string[];
};

export type TauDagContract = {
	schema?: string;
	dag_id?: string;
	goal?: {
		goal_id?: string;
		goal_version?: number;
		goal_hash?: string;
	};
	target?: {
		repo?: string;
		target?: string;
	};
	entry_node?: string;
	terminal_nodes?: string[];
	limits?: Record<string, unknown>;
	nodes?: TauDagNodeSpec[];
	edges?: Array<{ from?: string; to?: string }>;
	required_evidence?: string[];
	fail_closed_on?: string[];
};

export type TauDagReceipt = {
	schema?: string;
	ok?: boolean;
	status?: string;
	verdict?: string;
	mocked?: boolean;
	live?: boolean;
	provider_live?: boolean;
	source?: string;
	dag_id?: string;
	goal_hash?: string;
	failed_node?: string;
	missing?: string[];
	selected_agents?: string[];
	observed_nodes?: string[];
	node_results?: Record<string, { status?: string; receipt?: string; summary?: string; error?: string }>;
	commands_run?: string[];
	artifact_refs?: Array<{ kind?: string; path?: string; sha?: string }>;
	alerts?: Array<{ severity?: string; code?: string; message?: string; node_id?: string }>;
	proof_scope?: {
		proves?: string[];
		does_not_prove?: string[];
	};
};

export type LoadedTauDagRun = {
	manifest: TauDagRunManifest;
	selected: TauDagRunManifest["runs"][number];
	contract: TauDagContract;
	receipt: TauDagReceipt;
	artifact_paths?: {
		run_dir?: string;
		contract?: string;
		receipt?: string;
	};
};

const RUN_MANIFEST_URL = "/tau-dag-runs/manifest.json";
const LIVE_RUN_URL = "/tau-dag-live-run";

function normalizeArray(value: unknown): string[] {
	return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function titleFromId(id: string): string {
	return id
		.split(/[-_]/g)
		.filter(Boolean)
		.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
		.join(" ");
}

function normalizeTauStatus(status: string | undefined): string {
	const value = (status || "missing").toLowerCase();
	if (["pass", "passed", "completed", "complete", "success"].includes(value)) return "accepted";
	if (["running", "in_progress"].includes(value)) return "running";
	if (["blocked", "failed", "failure", "error", "missing_required_evidence", "reroute"].includes(value)) return "failed";
	if (["review", "warn", "warning", "partial"].includes(value)) return "partial";
	return "waiting";
}

function semanticCallType(node: TauDagNodeSpec): string {
	const agent = (node.agent || "").toLowerCase();
	if (agent === "human") return "human_gate";
	if (agent.includes("research")) return "research_gate";
	if (agent.includes("review") || agent.includes("validator")) return "verification";
	if (agent.includes("goal")) return "goal_alignment";
	return "local_command";
}

function nodeSkills(node: TauDagNodeSpec): string[] {
	const skills = ["tau"];
	if (node.agent) skills.push(node.agent);
	if (node.executor && node.executor !== node.agent) skills.push(node.executor);
	return skills;
}

function observedNodeStatus(node: TauDagNodeSpec, receipt: TauDagReceipt): string {
	if (receipt.failed_node === node.id) return "failed";
	const resultStatus = receipt.node_results?.[node.id]?.status;
	if (resultStatus) return normalizeTauStatus(resultStatus);
	if (normalizeArray(receipt.observed_nodes).includes(node.id) && receipt.status) return normalizeTauStatus(receipt.status);
	if ((node.agent || "").toLowerCase() === "human") return "waiting";
	return "waiting";
}

function buildEvidenceNode(node: TauDagNodeSpec, receipt: TauDagReceipt): TransportDagEvidenceNode {
	const result = receipt.node_results?.[node.id];
	const requiredEvidence = normalizeArray(node.required_evidence);
	return {
		id: node.id,
		label: titleFromId(node.id),
		status: observedNodeStatus(node, receipt),
		semantic_call_type: semanticCallType(node),
		skills: nodeSkills(node),
		role: node.agent,
		provider: node.executor === "provider" ? "provider" : node.executor,
		request_summary: requiredEvidence.length
			? `${requiredEvidence.length} required evidence item${requiredEvidence.length === 1 ? "" : "s"}`
			: "No node-level required evidence declared",
		response: result?.summary || result?.receipt,
		error: result?.error,
		missing_required_fields: receipt.failed_node === node.id ? normalizeArray(receipt.missing) : undefined,
	};
}

function validEdges(contract: TauDagContract): Array<{ from: string; to: string }> {
	return (contract.edges || [])
		.filter((edge): edge is { from: string; to: string } => Boolean(edge.from && edge.to))
		.map((edge) => ({ from: edge.from, to: edge.to }));
}

export function layersFromTauDag(contract: TauDagContract): string[][] {
	const nodes = (contract.nodes || []).filter((node): node is TauDagNodeSpec => Boolean(node?.id));
	const nodeIds = new Set(nodes.map((node) => node.id));
	const incoming = new Map<string, Set<string>>();
	const outgoing = new Map<string, Set<string>>();
	for (const node of nodes) {
		incoming.set(node.id, new Set());
		outgoing.set(node.id, new Set());
	}
	for (const edge of validEdges(contract)) {
		if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) continue;
		incoming.get(edge.to)?.add(edge.from);
		outgoing.get(edge.from)?.add(edge.to);
	}
	const remaining = new Set(nodeIds);
	const layers: string[][] = [];
	while (remaining.size) {
		const ready = [...remaining].filter((id) => {
			const deps = incoming.get(id) || new Set<string>();
			return [...deps].every((dep) => !remaining.has(dep));
		});
		if (!ready.length) {
			layers.push([...remaining]);
			break;
		}
		layers.push(ready);
		for (const id of ready) remaining.delete(id);
	}
	return layers;
}

export function buildTauDagEvidence(loaded: LoadedTauDagRun): TransportDagEvidence {
	const nodes = (loaded.contract.nodes || [])
		.filter((node): node is TauDagNodeSpec => Boolean(node?.id))
		.map((node) => buildEvidenceNode(node, loaded.receipt));
	const edges = validEdges(loaded.contract);
	const doesNotProve = normalizeArray(loaded.receipt.proof_scope?.does_not_prove);
	if (loaded.receipt.live === false) {
		doesNotProve.unshift("Live Tau DAG execution was not exercised by this UI fixture.");
	}
	if (loaded.receipt.provider_live === false) {
		doesNotProve.push("Provider-live execution was not exercised by this UI fixture.");
	}
	return {
		schema: "ux_lab.transport_dag_run_evidence.v1",
		found: nodes.length > 0,
		transport_run_id: `tau-${loaded.selected.id}`,
		dag_id: loaded.contract.dag_id || loaded.receipt.dag_id,
		graph_id: loaded.contract.dag_id || loaded.selected.id,
		proof_path: loaded.artifact_paths?.receipt || `${loaded.selected.path}/dag-receipt.json`,
		nodes,
		edges,
		layers: layersFromTauDag(loaded.contract),
		not_proven: [...new Set(doesNotProve)],
		progress_stream: {
			state: "static_receipt",
			event_count: 0,
			reason: loaded.receipt.source || loaded.selected.source,
		},
	};
}

async function fetchJson<T>(url: string): Promise<T> {
	const response = await fetch(url, { cache: "no-store" });
	if (!response.ok) throw new Error(`${url} returned ${response.status}`);
	return response.json() as Promise<T>;
}

export function isTauDagLiveRunReference(runReference: string | undefined): boolean {
	if (!runReference) return false;
	return runReference.startsWith("/") || runReference.startsWith(".") || runReference.includes("/");
}

export function tauDagLiveRunUrl(runReference: string): string {
	return `${LIVE_RUN_URL}?run=${encodeURIComponent(runReference)}`;
}

async function loadTauDagLiveRun(runReference: string): Promise<LoadedTauDagRun> {
	const payload = await fetchJson<LoadedTauDagRun & { ok?: boolean }>(tauDagLiveRunUrl(runReference));
	if (payload.ok === false) throw new Error(`Tau DAG live run loader rejected ${runReference}`);
	return payload;
}

export async function loadTauDagRun(runId?: string): Promise<LoadedTauDagRun> {
	if (runId && isTauDagLiveRunReference(runId)) return loadTauDagLiveRun(runId);
	const manifest = await fetchJson<TauDagRunManifest>(RUN_MANIFEST_URL);
	const selected =
		manifest.runs.find((run) => run.id === runId) ||
		manifest.runs.find((run) => run.id === manifest.defaultRunId) ||
		manifest.runs[0];
	if (!selected) throw new Error("No Tau DAG run artifacts are listed in manifest.json");
	const [contract, receipt] = await Promise.all([
		fetchJson<TauDagContract>(`${selected.path}/dag-contract.json`),
		fetchJson<TauDagReceipt>(`${selected.path}/dag-receipt.json`),
	]);
	return { manifest, selected, contract, receipt };
}

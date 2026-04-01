import { useCallback, useEffect, useRef, useState } from "react";

const API = "http://localhost:3001/api/memory";
const SCILLM_API = "http://localhost:3001/api/scillm";

/** Fetch wrapper for the memory proxy */
async function memoryPost<T>(path: string, body: Record<string, unknown>): Promise<T> {
	const res = await fetch(`${API}${path}`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	});
	if (!res.ok) throw new Error(`Memory API ${path}: ${res.status}`);
	return res.json();
}

/** Paginated fetch — daemon /list caps at 500 per page */
async function fetchAllPages(collection: string, filters: Record<string, unknown>): Promise<Record<string, unknown>[]> {
	const PAGE = 500;
	let offset = 0;
	const all: Record<string, unknown>[] = [];
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const res = await memoryPost<ListResponse>("/list", {
			collection,
			limit: PAGE,
			offset,
			filters,
		});
		all.push(...res.documents);
		if (res.count < PAGE || all.length >= res.total) break;
		offset += PAGE;
	}
	return all;
}

// ── ArangoDB document shapes ──

export interface BinaryFeature {
	_key: string;
	_id: string;
	binary_name: string;
	node_type: "namespace" | "rpc" | "event" | "schema" | "state_machine" | "parameter" | "cli_command";
	name: string;
	label: string;
	description?: string;
	namespace: string;
	cluster: string;
	extraction_tier: "T0" | "T1" | "T2";
	confidence: number;
	fields?: string[];
	states?: string[];
	source_pattern?: string;
}

export interface BinaryEdge {
	_key: string;
	_from: string;
	_to: string;
	binary_name: string;
	edge_type: "contains" | "payload" | "emits" | "triggers" | "has_parameter";
	shared_field?: string;
}

// ── Graph node/edge shapes for D3 ──

export interface BinaryGraphNode {
	id: string;
	label: string;
	nodeType: BinaryFeature["node_type"];
	cluster: string;
	tier: "T0" | "T1" | "T2";
	confidence: number;
	description?: string;
	/** Extra data for detail panel */
	fields?: string[];
	states?: string[];
	source_pattern?: string;
}

export interface BinaryGraphEdge {
	source: string;
	target: string;
	edgeType: BinaryEdge["edge_type"];
	sharedField?: string;
}

// ── Cluster colors (matches EmbryStyle + DESIGN.md) ──

export const NODE_TYPE_COLORS: Record<string, string> = {
	rpc: "#4CAF50",
	event: "#FF9800",
	schema: "#2196F3",
	state_machine: "#9C27B0",
	cli_command: "#FF5722",
	namespace: "#e2e8f0",
	parameter: "#94a3b8",
	string_ref: "#FFEB3B",
	import: "#00BCD4",
	export: "#8BC34A",
};

// ── List response shape ──

interface ListResponse {
	collection: string;
	total: number;
	offset: number;
	limit: number;
	count: number;
	documents: Record<string, unknown>[];
}

// ── Hook return ──

export interface BinaryData {
	/** All features for this binary */
	allNodes: BinaryFeature[];
	/** All edges for this binary */
	allEdges: BinaryEdge[];
	/** ALL graph nodes (always the full set) */
	graphNodes: BinaryGraphNode[];
	/** ALL graph edges */
	graphEdges: BinaryGraphEdge[];
	/** IDs of nodes matching current search/filter (empty = all match) */
	matchedNodeIds: Set<string>;
	/** Matched nodes sorted by relevance score (highest first) */
	matchedNodeRanked: Array<{ id: string; score: number }>;
	/** Search query */
	searchQuery: string;
	setSearchQuery: (q: string) => void;
	/** Node type filter (empty = all types) */
	nodeTypeFilter: Set<string>;
	toggleNodeTypeFilter: (type: string) => void;
	clearNodeTypeFilter: () => void;
	/** Summary stats */
	stats: {
		totalNodes: number;
		totalEdges: number;
		byType: Record<string, number>;
	};
	loading: boolean;
	error: string | null;
	refresh: () => void;
}

/**
 * Fetch binary features from ArangoDB via the memory daemon proxy.
 * Returns a progressive-disclosure graph: default view shows ~15 nodes
 * (namespaces + state machines + CLI commands). Double-click a namespace
 * to expand its children.
 */
export function useBinaryData(binaryName: string): BinaryData {
	const [allNodes, setAllNodes] = useState<BinaryFeature[]>([]);
	const [allEdges, setAllEdges] = useState<BinaryEdge[]>([]);
	const [searchQuery, setSearchQuery] = useState("");
	const [nodeTypeFilter, setNodeTypeFilter] = useState<Set<string>>(new Set());
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	/** LLM-generated names for cryptic schemas, keyed by _id */
	const [llmNames, setLlmNames] = useState<Record<string, string>>({});
	const llmNamingDone = useRef<string>("");

	const fetchData = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [nodeDocs, edgeDocs] = await Promise.all([
				fetchAllPages("binary_features", { binary_name: binaryName }),
				fetchAllPages("binary_feature_edges", { binary_name: binaryName }),
			]);

			setAllNodes(nodeDocs as unknown as BinaryFeature[]);
			setAllEdges(edgeDocs as unknown as BinaryEdge[]);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to fetch binary data");
		} finally {
			setLoading(false);
		}
	}, [binaryName]);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	// ── LLM schema naming: rename cryptic schemas on load, store back to ArangoDB ──
	useEffect(() => {
		if (loading || allNodes.length === 0) return;
		// Only run once per binary
		if (llmNamingDone.current === binaryName) return;
		llmNamingDone.current = binaryName;

		const crypticSchemas = allNodes.filter((n) => n.node_type === "schema" && n.name.length <= 4);
		if (crypticSchemas.length === 0) return;

		// Check if any already have LLM-assigned labels stored in ArangoDB
		const needsNaming = crypticSchemas.filter((n) => !n.label || n.label === n.name || n.label.length <= 4);
		if (needsNaming.length === 0) return;

		// Build context for the LLM: schema name, fields, connected RPCs
		const schemaDescriptions = needsNaming.map((s) => {
			const connectedRpcs = allEdges
				.filter((e) => e._to === s._id && e.edge_type === "payload")
				.map((e) => {
					const rpc = allNodes.find((n) => n._id === e._from);
					return rpc?.name ?? e._from.split("/").pop();
				});
			return {
				id: s._id,
				key: s._key,
				name: s.name,
				fields: (s.fields ?? []).slice(0, 10),
				connectedRpcs,
			};
		});

		const prompt = `You are analyzing extracted Zod schemas from the "${binaryName}" binary. These schemas have cryptic minified names. Infer a descriptive PascalCase name for each based on their fields and connected RPC methods.

Return ONLY a JSON object mapping the original name to the new name. Example: {"Gy0": "AutomationConfig", "pJH": "SessionSettings"}

Schemas:
${schemaDescriptions.map((s) => `- ${s.name}: fields=[${s.fields.join(", ")}] connectedRPCs=[${s.connectedRpcs.join(", ")}]`).join("\n")}`;

		fetch(SCILLM_API, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: "text",
				messages: [
					{ role: "system", content: "Return ONLY valid JSON. No markdown, no explanation." },
					{ role: "user", content: prompt },
				],
				temperature: 0.1,
				max_tokens: 300,
			}),
		})
			.then((r) => r.json())
			.then((d) => {
				const content = d.choices?.[0]?.message?.content ?? "";
				// Parse JSON from response (may have markdown fences)
				const jsonStr = content
					.replace(/```json?\s*/g, "")
					.replace(/```/g, "")
					.trim();
				const mapping: Record<string, string> = JSON.parse(jsonStr);

				// Build id→name map and update local state
				const idMap: Record<string, string> = {};
				const upsertDocs: Array<{ _key: string; label: string }> = [];
				for (const schema of schemaDescriptions) {
					const newName = mapping[schema.name];
					if (newName) {
						idMap[schema.id] = newName;
						upsertDocs.push({ _key: schema.key, label: newName });
					}
				}
				setLlmNames(idMap);

				// Store back to ArangoDB so future loads don't need LLM
				if (upsertDocs.length > 0) {
					fetch(`${API}/upsert`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							collection: "binary_features",
							documents: upsertDocs,
						}),
					}).catch(() => {
						/* non-critical — names will be regenerated next time */
					});
				}
			})
			.catch(() => {
				/* LLM naming failed — use heuristic fallback (bestLabel) */
			});
	}, [loading, allNodes, allEdges, binaryName]);

	// ── Always show ALL nodes — search/filter controls dimming, not visibility ──

	const rawQ = searchQuery.trim();
	const q = rawQ.toLowerCase();

	// Regex support: /pattern/flags syntax (e.g. /sub_[0-9a-f]+/i)
	let regex: RegExp | null = null;
	if (q.startsWith("/") && q.length > 2) {
		const lastSlash = q.lastIndexOf("/", q.length - 1);
		if (lastSlash > 0) {
			try {
				const pat = rawQ.slice(1, lastSlash);
				const fl = rawQ.slice(lastSlash + 1).replace(/[^gimsuy]/g, "");
				regex = new RegExp(pat, fl.includes("i") ? fl : "i" + fl);
			} catch {
				/* invalid regex — fall through to literal */
			}
		}
	}
	// Hex address: 0x prefix → strip for matching sub_XXXXXX style names
	const qHex = q.startsWith("0x") ? q.slice(2) : null;

	// Compute which nodes match the current search/filter for highlighting
	// Empty matchedNodeIds = everything matches (no filter active)
	const hasFilter = q !== "" || nodeTypeFilter.size > 0;
	const matchedNodeIds = new Set<string>();
	const matchedNodeRanked: Array<{ id: string; score: number }> = [];

	if (hasFilter) {
		for (const n of allNodes) {
			// Type filter gate
			if (nodeTypeFilter.size > 0 && !nodeTypeFilter.has(n.node_type)) continue;
			// Search gate
			if (q) {
				let matches = false;
				if (regex) {
					const blob = [
						n.name,
						n.label ?? "",
						n.description ?? "",
						n.namespace,
						n._id,
						...(n.fields ?? []),
						...(n.states ?? []),
						n.source_pattern ?? "",
					].join("\n");
					matches = regex.test(blob);
				} else {
					const nl = n.name.toLowerCase();
					const ll = (n.label ?? "").toLowerCase();
					const dl = (n.description ?? "").toLowerCase();
					const idl = n._id.toLowerCase();
					matches =
						nl.includes(q) ||
						ll.includes(q) ||
						dl.includes(q) ||
						n.namespace.toLowerCase().includes(q) ||
						idl.includes(q) ||
						(qHex != null && (nl.includes(qHex) || idl.includes(qHex))) ||
						(n.fields ?? []).some((f) => f.toLowerCase().includes(q)) ||
						(n.states ?? []).some((s) => s.toLowerCase().includes(q)) ||
						(n.source_pattern ?? "").toLowerCase().includes(q);
				}
				if (!matches) continue;
			}
			// Relevance score: exact name > prefix > substring > content
			let score = 0;
			if (q && !regex) {
				const nl = n.name.toLowerCase();
				const ll = (n.label ?? "").toLowerCase();
				if (nl === q || ll === q) score += 100;
				else if (nl.startsWith(q) || ll.startsWith(q)) score += 50;
				else if (nl.includes(q)) score += 30;
				else if (ll.includes(q)) score += 25;
				else if ((n.description ?? "").toLowerCase().includes(q)) score += 10;
				else score += 5;
			}
			matchedNodeIds.add(n._id);
			matchedNodeRanked.push({ id: n._id, score });
		}
		matchedNodeRanked.sort((a, b) => b.score - a.score);
	}

	// Build a map of schema/short-name nodes → their connected RPC names for context
	const schemaContext: Record<string, string> = {};
	for (const e of allEdges) {
		if (e.edge_type === "payload") {
			// payload edges go from RPC → schema, use the RPC name as context
			const rpcNode = allNodes.find((n) => n._id === e._from);
			const schemaNode = allNodes.find((n) => n._id === e._to);
			if (rpcNode && schemaNode && !schemaContext[schemaNode._id]) {
				const rpcShort = rpcNode.name.split(".").pop() ?? rpcNode.name;
				schemaContext[schemaNode._id] = rpcShort;
			}
		}
	}

	/** Pick the best display label — single-char labels from extraction are useless */
	function bestLabel(n: BinaryFeature): string {
		// LLM-assigned name takes priority (stored in ArangoDB or generated this session)
		if (llmNames[n._id]) return llmNames[n._id];
		// For schemas with cryptic names, use connected RPC for context
		if (n.node_type === "schema" && n.name.length <= 4 && schemaContext[n._id]) {
			return `${n.name} (${schemaContext[n._id]})`;
		}
		// State machines with single-char names: infer from states
		if (n.node_type === "state_machine" && n.name.length <= 3) {
			const states = n.states ?? [];
			const stateStr = states.slice(0, 3).join(",");
			// Heuristic: infer purpose from state names
			if (states.some((s) => s.includes("connect"))) return `${n.name}:Connection`;
			if (states.some((s) => s.includes("anthropic") || s.includes("openai"))) return `${n.name}:Provider`;
			if (states.some((s) => s.includes("exec") || s.includes("edit") || s.includes("mcp_tool")))
				return `${n.name}:ToolAction`;
			if (states.some((s) => s.includes("tcp") || s.includes("udp"))) return `${n.name}:Protocol`;
			if (states.some((s) => s.includes("running") || s.includes("paused") || s.includes("completed")))
				return `${n.name}:Lifecycle`;
			if (states.some((s) => s.includes("proceed") || s.includes("cancel"))) return `${n.name}:Permission`;
			return `FSM:${n.name} (${stateStr})`;
		}
		if (n.label && n.label.length > 1) return n.label;
		if (n.name && n.name.length > 1) return n.name;
		if (n.description && n.description.length > 0) return n.description.slice(0, 30);
		return n.label || n._key;
	}

	// All node types included — scene-based progressive disclosure handles noise
	const graphNodes: BinaryGraphNode[] = allNodes.map((n) => ({
		id: n._id,
		label: bestLabel(n),
		nodeType: n.node_type,
		cluster: n.cluster,
		tier: n.extraction_tier,
		confidence: n.confidence,
		description: n.description,
		fields: n.fields,
		states: n.states,
		source_pattern: n.source_pattern,
	}));

	// Transform edges (only between graphable nodes)
	const allNodeIds = new Set(allNodes.map((n) => n._id));
	const graphEdges: BinaryGraphEdge[] = allEdges
		.filter((e) => allNodeIds.has(e._from) && allNodeIds.has(e._to))
		.map((e) => ({
			source: e._from,
			target: e._to,
			edgeType: e.edge_type,
			sharedField: e.shared_field,
		}));

	// Stats
	const byType: Record<string, number> = {};
	for (const n of allNodes) {
		byType[n.node_type] = (byType[n.node_type] ?? 0) + 1;
	}

	return {
		allNodes,
		allEdges,
		graphNodes,
		graphEdges,
		matchedNodeIds,
		matchedNodeRanked,
		searchQuery,
		setSearchQuery,
		nodeTypeFilter,
		toggleNodeTypeFilter: (type: string) =>
			setNodeTypeFilter((prev) => {
				const next = new Set(prev);
				if (next.has(type)) next.delete(type);
				else next.add(type);
				return next;
			}),
		clearNodeTypeFilter: () => setNodeTypeFilter(new Set()),
		stats: {
			totalNodes: allNodes.length,
			totalEdges: allEdges.length,
			byType,
		},
		loading,
		error,
		refresh: fetchData,
	};
}

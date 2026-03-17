import { useCallback, useEffect, useState } from "react";
import type { GraphEdge, GraphNode } from "../components/sparta/lemma-graph/LemmaGraph";
import type { ControlRow } from "../components/sparta/tables/ControlTable";
import type { ThreatTechnique } from "../components/sparta/threat-map/ThreatMap";

const API = "http://localhost:3001/api/memory";

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

/** Response from daemon /recall endpoint */
interface RecallResponse {
	found: boolean;
	items: Record<string, unknown>[];
	meta?: Record<string, unknown>;
}

/** Raw SPARTA control document from ArangoDB */
interface SpartaControl {
	_key: string;
	_id: string;
	control_id: string;
	name: string;
	description?: string;
	source_framework: string;
	control_type?: string;
	parent_id?: string;
	domain?: string;
	weaknesses?: string[];
	scope?: string;
}

/** Raw SPARTA relationship from ArangoDB */
interface SpartaRelationship {
	_from: string;
	_to: string;
	source_control_id?: string;
	target_control_id?: string;
	method?: string;
	predicate?: string;
	combined_score?: number;
	validated?: boolean;
}

/** Normalize framework name from ArangoDB to display format */
function normalizeFramework(fw: string): string {
	const map: Record<string, string> = {
		SPARTA: "SPARTA",
		NIST: "NIST",
		CWE: "CWE",
		NVD: "CWE", // NVD CVEs map to CWE for display
		nvd: "CWE",
		ATT_CK_Enterprise: "ATT&CK",
		ATT_CK_Mobile: "ATT&CK",
		ATT_CK_ICS: "ATT&CK",
		D3FEND: "D3FEND",
		d3fend: "D3FEND",
	};
	return map[fw] ?? fw;
}

/** Map control_type to tactic-like category */
function controlTypeToTactic(ctrl: SpartaControl): string {
	if (ctrl.control_type === "technique" || ctrl.control_type === "attack_technique") return "Techniques";
	if (ctrl.control_type === "weakness") return "Weaknesses";
	if (ctrl.control_type === "indicator") return "Indicators";
	if (ctrl.control_type === "countermeasure") return "Countermeasures";
	return "Controls";
}

export interface SpartaData {
	controls: ControlRow[];
	tactics: string[];
	techniques: ThreatTechnique[];
	graphNodes: GraphNode[];
	graphEdges: GraphEdge[];
	integrity: { status: "NOMINAL" | "DEGRADED" | "CRITICAL"; coveragePercent: number; issueCount: number };
	loading: boolean;
	error: string | null;
	refresh: () => void;
}

export function useSpartaData(): SpartaData {
	const [controls, setControls] = useState<ControlRow[]>([]);
	const [relationships, setRelationships] = useState<SpartaRelationship[]>([]);
	const [integrity, setIntegrity] = useState({
		status: "NOMINAL" as "NOMINAL" | "DEGRADED" | "CRITICAL",
		coveragePercent: 0,
		issueCount: 0,
	});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const fetchData = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			// Fetch controls and relationships via daemon /recall endpoint
			// collections must be an array per RecallRequest schema
			const [controlsRes, relRes] = await Promise.all([
				memoryPost<RecallResponse>("/recall", {
					q: "SPARTA controls",
					collections: ["sparta_controls"],
					k: 50,
				}),
				memoryPost<RecallResponse>("/recall", {
					q: "relationships",
					collections: ["sparta_relationships"],
					k: 50,
				}),
			]);

			// Transform controls from recall items
			const controlItems = controlsRes.items as unknown as SpartaControl[];
			const rows: ControlRow[] = controlItems.map((ctrl) => ({
				id: ctrl.control_id,
				framework: normalizeFramework(ctrl.source_framework),
				name: ctrl.name,
				tactic: controlTypeToTactic(ctrl),
				urlCount: 0,
				relCount: 0,
				knowledgeChunks: 0,
				issueCount: ctrl.weaknesses?.length ?? 0,
			}));
			setControls(rows);

			const relItems = relRes.items as unknown as SpartaRelationship[];
			setRelationships(relItems);

			// Compute integrity from what we have
			const totalEdges = relItems.length;
			const validatedEdges = relItems.filter((r) => r.validated || r.combined_score !== undefined).length;
			const coverage = totalEdges > 0 ? Math.round((validatedEdges / totalEdges) * 100) : 0;
			const status = coverage >= 90 ? "NOMINAL" : coverage >= 70 ? "DEGRADED" : "CRITICAL";
			setIntegrity({ status, coveragePercent: coverage, issueCount: totalEdges - validatedEdges });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to fetch SPARTA data");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		fetchData();
	}, [fetchData]);

	// Derive tactics and techniques from controls
	const tacticSet = new Set(controls.map((c) => c.tactic ?? "Unknown"));
	const tactics = [...tacticSet].sort();

	const techniques: ThreatTechnique[] = controls.map((c) => ({
		id: c.id,
		name: c.name,
		tactic: c.tactic ?? "Unknown",
		coverage: c.issueCount > 0 ? ("partial" as const) : ("full" as const),
		issueCount: c.issueCount,
		frameworks: [c.framework],
	}));

	// Build graph from controls — nodes are controls, edges from real ArangoDB relationships
	const graphNodes: GraphNode[] = controls.slice(0, 15).map((c) => ({
		id: c.id,
		label: c.name.length > 20 ? `${c.name.slice(0, 20)}…` : c.name,
		framework: c.framework,
		size: 1,
	}));

	// Extract control_id from ArangoDB _from/_to (e.g. "sparta_controls/REC-0001" → "REC-0001")
	const extractId = (ref: string) => (ref.includes("/") ? ref.split("/").pop()! : ref);
	const nodeIds = new Set(graphNodes.map((n) => n.id));

	// Build edges from real relationships, keeping only those connecting visible nodes
	const graphEdges: GraphEdge[] = relationships
		.map((rel) => ({
			source: extractId(rel._from),
			target: extractId(rel._to),
			method: rel.method ?? rel.predicate ?? "related",
			validated: rel.validated ?? true,
		}))
		.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

	return {
		controls,
		tactics,
		techniques,
		graphNodes,
		graphEdges,
		integrity,
		loading,
		error,
		refresh: fetchData,
	};
}

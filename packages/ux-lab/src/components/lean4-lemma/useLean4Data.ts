/**
 * useLean4Data — Fetches Lean4 proofs and proof-requirement edges from ArangoDB.
 * Maps to GraphNode/GraphEdge types compatible with LemmaGraph wrapper.
 */
import { useEffect, useState } from "react";
import type { GraphEdge, GraphNode } from "../sparta/lemma-graph/LemmaGraph";

const API = "http://localhost:3001";

export interface Lean4Proof {
	_key: string;
	_id: string;
	theorem_name: string;
	lean_code: string;
	tactics: string[];
	imports: string[];
	needs_mathlib: boolean;
	problem_description: string;
}

export interface ProofRequirementEdge {
	_key: string;
	_from: string;
	_to: string;
	edge_type: string;
	proof_code: string;
	tactics: string[];
	framework: string;
	control_id: string;
}

export interface Lean4DataResult {
	proofs: Lean4Proof[];
	graphNodes: GraphNode[];
	graphEdges: GraphEdge[];
	loading: boolean;
	error: string | null;
	stats: {
		totalProofs: number;
		totalEdges: number;
		compiledCount: number;
		sorryCount: number;
		tacticsUsed: string[];
	};
}

export function useLean4Data(): Lean4DataResult {
	const [proofs, setProofs] = useState<Lean4Proof[]>([]);
	const [edges, setEdges] = useState<ProofRequirementEdge[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		async function fetchData() {
			try {
				// Fetch proofs
				const proofRes = await fetch(`${API}/api/memory/query`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						query: "FOR d IN lean4_proofs LIMIT 500 RETURN {_key: d._key, _id: d._id, theorem_name: d.theorem_name, lean_code: d.lean_code, tactics: d.tactics, imports: d.imports, needs_mathlib: d.needs_mathlib, problem_description: d.problem_description}",
					}),
				});
				const proofData = await proofRes.json();

				// Fetch edges
				const edgeRes = await fetch(`${API}/api/memory/query`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						query: "FOR e IN proof_requirement_edges LIMIT 500 RETURN {_key: e._key, _from: e._from, _to: e._to, edge_type: e.edge_type, proof_code: e.proof_code, tactics: e.tactics, framework: e.framework, control_id: e.control_id}",
					}),
				});
				const edgeData = await edgeRes.json();

				if (cancelled) return;

				const fetchedProofs: Lean4Proof[] = proofData.result ?? proofData ?? [];
				const fetchedEdges: ProofRequirementEdge[] = edgeData.result ?? edgeData ?? [];

				setProofs(fetchedProofs);
				setEdges(fetchedEdges);
				setError(null);
			} catch (err) {
				if (!cancelled) setError(String(err));
			} finally {
				if (!cancelled) setLoading(false);
			}
		}

		fetchData();
		return () => {
			cancelled = true;
		};
	}, []);

	// Map to GraphNode/GraphEdge for LemmaGraph
	const graphNodes: GraphNode[] = proofs.map((p) => {
		const hasSorry = p.lean_code?.includes("sorry") ?? false;
		const hasAxiom = p.lean_code?.includes("axiom") ?? false;
		return {
			id: p._id ?? `lean4_proofs/${p._key}`,
			label: p.theorem_name,
			framework: p.needs_mathlib ? "Mathlib" : "Lean4",
			proofStatus: hasSorry ? "sorry" : hasAxiom ? "axiom" : "proved",
			confidence: hasSorry ? 0.3 : 0.9,
			sourceCount: edges.filter((e) => e._from === p._id || e._to === p._id).length,
		};
	});

	// Also add requirement nodes from edges
	const reqIds = new Set<string>();
	for (const e of edges) {
		if (!reqIds.has(e._to) && !proofs.some((p) => p._id === e._to)) {
			reqIds.add(e._to);
			graphNodes.push({
				id: e._to,
				label: e.control_id ?? e._to.split("/").pop() ?? e._to,
				framework: e.framework ?? "SPARTA",
				proofStatus: "partial",
				confidence: 0.5,
				sourceCount: 0,
			});
		}
	}

	const graphEdges: GraphEdge[] = edges
		.filter((e) => graphNodes.some((n) => n.id === e._from) && graphNodes.some((n) => n.id === e._to))
		.map((e) => ({
			source: e._from,
			target: e._to,
			method: e.edge_type,
			validated: true,
		}));

	// Stats
	const compiledCount = proofs.filter((p) => !p.lean_code?.includes("sorry")).length;
	const sorryCount = proofs.filter((p) => p.lean_code?.includes("sorry")).length;
	const allTactics = [...new Set(proofs.flatMap((p) => p.tactics ?? []))];

	return {
		proofs,
		graphNodes,
		graphEdges,
		loading,
		error,
		stats: {
			totalProofs: proofs.length,
			totalEdges: edges.length,
			compiledCount,
			sorryCount,
			tacticsUsed: allTactics.slice(0, 20),
		},
	};
}

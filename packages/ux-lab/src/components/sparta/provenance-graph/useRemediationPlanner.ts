/**
 * useRemediationPlanner — Maximum Restoration Score (MRS) ranking
 *
 * Gemini's insight: "Which single fix restores the most downstream surface?"
 * ChatGPT: Segment by authority (direct vs supplier outreach vs formal reproof)
 *
 * MRS(node) = Σ downstream_impact × edge_weight × authority_discount
 */
import { useMemo } from "react";
import type { CascadeState, ProvenanceEdge, ProvenanceNode, RemediationAction, RemediationAuthority } from "./types";

// ── Authority Effort Estimates ───────────────────────────────────────────

const AUTHORITY_EFFORT: Record<RemediationAuthority, "low" | "medium" | "high"> = {
	direct: "low", // Internal team can fix
	supplier_outreach: "medium", // Requires vendor coordination
	formal_reproof: "high", // Requires re-certification
};

const AUTHORITY_DISCOUNT: Record<RemediationAuthority, number> = {
	direct: 1.0,
	supplier_outreach: 0.7,
	formal_reproof: 0.4,
};

// ── Determine Authority Required ─────────────────────────────────────────

function determineAuthority(node: ProvenanceNode): RemediationAuthority {
	// Supplier-owned evidence requires outreach
	if (node.supplier_id && node.supplier_tier && node.supplier_tier >= 2) {
		return "supplier_outreach";
	}

	// Formal proof obligations require reproof
	if (node.proof_status === "proved" || node.proof_status === "sorry") {
		return "formal_reproof";
	}

	// Framework artifacts and control families require reproof
	if (node.nodeClass === "framework_artifact" || node.nodeClass === "control_family") {
		return "formal_reproof";
	}

	// Everything else is direct
	return "direct";
}

// ── Compute MRS for Each Failed Node ─────────────────────────────────────

export interface RemediationPlanResult {
	actions: RemediationAction[];
	totalRestorable: number;
	byAuthority: {
		direct: RemediationAction[];
		supplier_outreach: RemediationAction[];
		formal_reproof: RemediationAction[];
	};
}

export function computeRemediationPlan(
	nodes: ProvenanceNode[],
	edges: ProvenanceEdge[],
	cascadeStates: Map<string, CascadeState>,
	impactScores: Map<string, number>,
): RemediationPlanResult {
	const nodeById = new Map(nodes.map((n) => [n.id, n]));

	// Build outgoing edges: source → targets
	const outgoingEdges = new Map<string, ProvenanceEdge[]>();
	edges.forEach((e) => {
		const list = outgoingEdges.get(e.source) ?? [];
		list.push(e);
		outgoingEdges.set(e.source, list);
	});

	// Find all failed/degraded nodes (candidates for remediation)
	const failedNodes = nodes.filter((n) => {
		const state = cascadeStates.get(n.id);
		return state === "root_failure" || state === "hard_break" || state === "degraded";
	});

	// Calculate MRS for each failed node
	const actions: RemediationAction[] = failedNodes.map((node) => {
		const authority = determineAuthority(node);
		const discount = AUTHORITY_DISCOUNT[authority];

		// Count downstream nodes that would be restored
		const visited = new Set<string>();
		const queue = [node.id];
		let restorationScore = 0;

		while (queue.length > 0) {
			const current = queue.shift()!;
			if (visited.has(current)) continue;
			visited.add(current);

			const downstream = outgoingEdges.get(current) ?? [];
			downstream.forEach((edge) => {
				const targetNode = nodeById.get(edge.target);
				if (!targetNode) return;

				const targetState = cascadeStates.get(edge.target);
				if (targetState === "healthy" || targetState === "selected") return;

				// Add weighted restoration score
				const targetImpact = impactScores.get(edge.target) ?? 0;
				restorationScore += targetImpact * edge.weight * discount;

				queue.push(edge.target);
			});
		}

		return {
			node_id: node.id,
			label: node.label,
			restoration_score: restorationScore,
			authority,
			estimated_effort: AUTHORITY_EFFORT[authority],
			downstream_count: visited.size - 1, // Exclude self
		};
	});

	// Sort by MRS descending (best fixes first)
	actions.sort((a, b) => b.restoration_score - a.restoration_score);

	// Group by authority
	const byAuthority = {
		direct: actions.filter((a) => a.authority === "direct"),
		supplier_outreach: actions.filter((a) => a.authority === "supplier_outreach"),
		formal_reproof: actions.filter((a) => a.authority === "formal_reproof"),
	};

	// Total restorable surface
	const totalRestorable = actions.reduce((sum, a) => sum + a.restoration_score, 0);

	return {
		actions,
		totalRestorable,
		byAuthority,
	};
}

// ── React Hook ───────────────────────────────────────────────────────────

export function useRemediationPlanner(
	nodes: ProvenanceNode[],
	edges: ProvenanceEdge[],
	cascadeStates: Map<string, CascadeState>,
	impactScores: Map<string, number>,
): RemediationPlanResult {
	return useMemo(
		() => computeRemediationPlan(nodes, edges, cascadeStates, impactScores),
		[nodes, edges, cascadeStates, impactScores],
	);
}

// ── Quick Win Finder ─────────────────────────────────────────────────────

export function findQuickWins(
	plan: RemediationPlanResult,
	maxEffort: "low" | "medium" | "high" = "medium",
): RemediationAction[] {
	const effortOrder = ["low", "medium", "high"];
	const maxIndex = effortOrder.indexOf(maxEffort);

	return plan.actions
		.filter((a) => {
			const effortIndex = effortOrder.indexOf(a.estimated_effort);
			return effortIndex <= maxIndex;
		})
		.slice(0, 5); // Top 5 quick wins
}

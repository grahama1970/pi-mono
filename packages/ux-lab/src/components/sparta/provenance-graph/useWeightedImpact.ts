/**
 * useWeightedImpact — PageRank-style iterative convergence for cycle handling
 *
 * Day 2 architecture: handles feedback loops in aerospace supply chains
 * where Supplier A depends on Supplier B which depends on A's audit.
 *
 * Formula (Gemini):
 * I_{t+1}(n) = (1 - d) + d * Σ (I_t(m) * W_mn / C_out(m))
 *
 * Propagation (ChatGPT):
 * effective_weight = edge.weight × dal_multiplier × exclusivity
 */
import { useMemo } from "react";
import type { CascadeState, DALLevel, PropagationRule, ProvenanceEdge, ProvenanceNode } from "./types";

// ── DAL Level Multipliers (ChatGPT) ──────────────────────────────────────

const DAL_MULTIPLIERS: Record<DALLevel, number> = {
	A: 1.0, // Full propagation
	B: 0.8,
	C: 0.6,
	D: 0.3,
	E: 0.1, // CM visibility floor (DO-178C Section 7 requires tracking)
};

// ── Edge Type Base Rules ─────────────────────────────────────────────────

const EDGE_TYPE_WEIGHTS: Record<string, number> = {
	inherits_from: 1.0, // Hard break
	satisfies: 1.0, // Hard break
	depends_on: 1.0, // Hard break
	partially_supports: 0.5, // Weighted by exclusivity
	replaces_support_for: 0.7,
	maps_to: 0.1, // Advisory only
	supersedes: 0, // Temporal, not in active graph
};

// ── Compute Propagation Rule ─────────────────────────────────────────────

export function computePropagationRule(edge: ProvenanceEdge): PropagationRule {
	const baseWeight = EDGE_TYPE_WEIGHTS[edge.type] ?? 0.5;
	const dalMultiplier = DAL_MULTIPLIERS[edge.dal_level ?? "C"];

	// ChatGPT: edge_type × evidence_role × consumer_criticality × exclusivity
	const effectiveWeight = baseWeight * dalMultiplier * edge.exclusivity * edge.weight;

	if (effectiveWeight > 0.7) return "hard_break";
	if (effectiveWeight > 0.3) return "confidence_degradation";
	if (effectiveWeight > 0) return "advisory_only";
	return "no_propagation";
}

// ── PageRank-Style Weighted Impact ───────────────────────────────────────

export interface WeightedImpactResult {
	impactMap: Map<string, number>;
	cascadeStates: Map<string, CascadeState>;
	iterations: number;
	converged: boolean;
}

export function computeWeightedImpact(
	nodes: ProvenanceNode[],
	edges: ProvenanceEdge[],
	rootFailures: Set<string>,
	virtualTaints: Set<string>, // Supplier IDs being simulated as failed
	options: {
		dampen?: number;
		epsilon?: number;
		maxIterations?: number;
	} = {},
): WeightedImpactResult {
	const { dampen = 0.85, epsilon = 0.001, maxIterations = 100 } = options;

	const impactMap = new Map<string, number>();
	const nodeById = new Map(nodes.map((n) => [n.id, n]));

	// Build adjacency: target → incoming edges
	const incomingEdges = new Map<string, ProvenanceEdge[]>();
	edges.forEach((e) => {
		const list = incomingEdges.get(e.target) ?? [];
		list.push(e);
		incomingEdges.set(e.target, list);
	});

	// Initialize: root failures and nodes from failed suppliers
	nodes.forEach((n) => {
		const isRootFailure = rootFailures.has(n.id);
		const isSupplierTainted = n.supplier_id && virtualTaints.has(n.supplier_id);
		const isExpired = n.temporal.valid_to < Date.now();
		const isSuperseded = !!n.temporal.superseded_at;

		if (isRootFailure || isSupplierTainted || isExpired) {
			impactMap.set(n.id, 1.0);
		} else if (isSuperseded) {
			impactMap.set(n.id, 0); // Superseded nodes don't propagate
		} else {
			impactMap.set(n.id, 0);
		}
	});

	// Iterative convergence (handles cycles)
	let delta = Infinity;
	let iterations = 0;

	while (delta > epsilon && iterations < maxIterations) {
		const prevScores = new Map(impactMap);
		delta = 0;

		nodes.forEach((n) => {
			// Root failures and superseded stay fixed
			if (rootFailures.has(n.id) || n.temporal.superseded_at) return;
			if (n.supplier_id && virtualTaints.has(n.supplier_id)) return;
			if (n.temporal.valid_to < Date.now()) return;

			const incoming = incomingEdges.get(n.id) ?? [];

			// Noisy-OR aggregation for shared evidence survival
			// DO-178C DETERMINISTIC LOGIC:
			// - hard_break edges bypass dampening (binary compliance integrity)
			// - Multiple sources use probabilistic sum: P(fail) = 1 - Π(1 - Taint_i × Excl_i)
			// - This correctly models redundancy: if A and B both satisfy X, killing A alone doesn't kill X
			let survivalProb = 1.0;
			incoming.forEach((edge) => {
				const srcScore = prevScores.get(edge.source) ?? 0;
				if (srcScore === 0) return;

				const rule = computePropagationRule(edge);
				// Hard breaks use identity propagation (no dampen leakage)
				const propagationFactor = rule === "hard_break" ? 1.0 : dampen;
				// Advisory edges capped at 0.1 to prevent noise accumulation
				const weight = rule === "advisory_only" ? 0.1 : edge.weight;

				// Noisy-OR: each source contributes to failure probability
				// CRITICAL: Clamp to [0,1] — floating-point errors or boost weights
				// could invert the logic if contribution exceeds 1.0
				const taintContribution = Math.min(srcScore * propagationFactor * weight * edge.exclusivity, 1.0);
				survivalProb *= 1 - taintContribution;
			});

			// Convert survival probability back to impact score
			const newScore = Math.min(1 - survivalProb, 1.0);
			impactMap.set(n.id, newScore);

			// Track max delta for convergence check
			const scoreDelta = Math.abs(newScore - (prevScores.get(n.id) ?? 0));
			if (scoreDelta > delta) delta = scoreDelta;
		});

		iterations++;
	}

	// Compute cascade states from impact scores
	const cascadeStates = new Map<string, CascadeState>();
	impactMap.forEach((score, id) => {
		const node = nodeById.get(id);
		if (!node) return;

		if (rootFailures.has(id) || (node.supplier_id && virtualTaints.has(node.supplier_id))) {
			cascadeStates.set(id, "root_failure");
		} else if (score > 0.7) {
			cascadeStates.set(id, "hard_break");
		} else if (score > 0.3) {
			cascadeStates.set(id, "degraded");
		} else if (score > 0) {
			cascadeStates.set(id, "advisory");
		} else {
			cascadeStates.set(id, "healthy");
		}
	});

	return {
		impactMap,
		cascadeStates,
		iterations,
		converged: delta <= epsilon,
	};
}

// ── React Hook ───────────────────────────────────────────────────────────

export function useWeightedImpact(
	nodes: ProvenanceNode[],
	edges: ProvenanceEdge[],
	rootFailures: Set<string>,
	virtualTaints: Set<string>,
	options?: { dampen?: number; epsilon?: number; maxIterations?: number },
): WeightedImpactResult {
	return useMemo(
		() => computeWeightedImpact(nodes, edges, rootFailures, virtualTaints, options),
		[nodes, edges, rootFailures, virtualTaints, options],
	);
}

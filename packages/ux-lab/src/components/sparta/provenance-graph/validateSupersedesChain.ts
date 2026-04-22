/**
 * validateSupersedesChain — O(V+E) Kahn-based cycle detection
 *
 * Enforces DAG invariant for temporal versioning chains.
 * A cycle in supersedes pointers would cause infinite oscillation
 * in the PageRank convergence loop.
 *
 * DO-330 TQL-5: Deterministic validation with early orphan detection.
 */
import type { ProvenanceNode } from "./types";

export interface SupersedesValidationResult {
	valid: boolean;
	orphanedRefs: Array<{ nodeId: string; targetId: string }>;
	cycleNodes: string[];
	chainDepth: number;
}

export function validateSupersedesChain(nodes: ProvenanceNode[]): SupersedesValidationResult {
	const inDegree = new Map<string, number>();
	const nodeMap = new Map(nodes.map((n) => [n.id, n]));
	const adj = new Map<string, string>(); // child -> parent (supersedes)
	const orphanedRefs: Array<{ nodeId: string; targetId: string }> = [];

	// 1. Build Adjacency Map & Identify Orphans
	nodes.forEach((n) => {
		const targetId = n.temporal.supersedes_id;
		if (targetId) {
			if (!nodeMap.has(targetId)) {
				orphanedRefs.push({ nodeId: n.id, targetId });
				return;
			}
			adj.set(n.id, targetId);
			inDegree.set(targetId, (inDegree.get(targetId) ?? 0) + 1);
		}
		if (!inDegree.has(n.id)) inDegree.set(n.id, 0);
	});

	// 2. Queue nodes with In-Degree 0 (The most recent versions)
	const queue: string[] = [];
	inDegree.forEach((count, id) => {
		if (count === 0) queue.push(id);
	});

	let processedCount = 0;
	let maxDepth = 0;
	const depths = new Map<string, number>();

	while (queue.length > 0) {
		const u = queue.shift()!;
		processedCount++;

		const currentDepth = depths.get(u) ?? 0;
		maxDepth = Math.max(maxDepth, currentDepth);

		const v = adj.get(u);
		if (v) {
			depths.set(v, currentDepth + 1);
			inDegree.set(v, inDegree.get(v)! - 1);
			if (inDegree.get(v) === 0) queue.push(v);
		}
	}

	// 3. Detect cycles: nodes remaining with in-degree > 0
	const cycleNodes: string[] = [];
	inDegree.forEach((count, id) => {
		if (count > 0) cycleNodes.push(id);
	});

	const activeNodeCount = nodes.filter((n) => n.temporal.is_active).length;
	const valid = cycleNodes.length === 0 && processedCount >= activeNodeCount;

	return {
		valid,
		orphanedRefs,
		cycleNodes,
		chainDepth: maxDepth,
	};
}

/**
 * assertSupersedesIntegrity — throws on validation failure
 * Use in TQL-5 test suite for hard assertions.
 */
export function assertSupersedesIntegrity(nodes: ProvenanceNode[]): void {
	const result = validateSupersedesChain(nodes);

	if (result.orphanedRefs.length > 0) {
		const orphans = result.orphanedRefs.map((o) => `${o.nodeId} → ${o.targetId}`).join(", ");
		throw new Error(`ORPHANED_SUPERSEDES: ${orphans}`);
	}

	if (!result.valid) {
		throw new Error(`CIRCULAR_VERSIONING_DETECTED: Nodes in cycle: ${result.cycleNodes.join(", ")}`);
	}
}

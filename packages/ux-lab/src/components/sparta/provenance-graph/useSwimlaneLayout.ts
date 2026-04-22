/**
 * useSwimlaneLayout — Fixed X swimlane with D3-force Y positioning
 *
 * Gemini: "Force-layout along the Y axis only, respecting fixed X swimlanes"
 * ChatGPT: "Use a hybrid layout where X is categorical (swim lanes) and Y is force-directed"
 *
 * Swimlanes (left to right):
 * 1. Suppliers (Tier-1, 2, 3+)
 * 2. Evidence Artifacts
 * 3. Controls / Objectives
 * 4. Frameworks (DO-178C, CMMC, NIST)
 */

import * as d3 from "d3";
import { useEffect, useMemo, useState } from "react";
import type { ProvenanceEdge, ProvenanceNode, SwimlaneConfig, SwimlaneName } from "./types";

// ── TQL-5 Deterministic Seed ─────────────────────────────────────────────
// DO-330: Bit-identical layout for DER sign-off reproducibility
const AUDIT_SEED = "F36_AUDIT_SEED_2026";

// Simple mulberry32 PRNG for deterministic layout (no external dependencies)
function mulberry32(seed: number): () => number {
	return () => {
		seed += 0x6d2b79f5;
		let t = seed;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// Convert string seed to number (simple hash)
function hashSeed(str: string): number {
	let hash = 0;
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i);
		hash = (hash << 5) - hash + char;
		hash = hash & hash;
	}
	return Math.abs(hash);
}

// ── Swimlane Configuration ───────────────────────────────────────────────

const DEFAULT_SWIMLANES: SwimlaneConfig[] = [
	{
		name: "suppliers",
		x: 100,
		width: 200,
		label: "Supply Chain",
		nodeClasses: ["supplier"],
	},
	{
		name: "evidence",
		x: 350,
		width: 200,
		label: "Evidence",
		nodeClasses: ["evidence_artifact"],
	},
	{
		name: "controls",
		x: 600,
		width: 200,
		label: "Controls",
		nodeClasses: ["assessment_objective", "control", "control_family"],
	},
	{
		name: "frameworks",
		x: 850,
		width: 200,
		label: "Frameworks",
		nodeClasses: ["framework_artifact"],
	},
];

// ── Node Class to Swimlane Mapping ───────────────────────────────────────

function getSwimlaneForNode(node: ProvenanceNode, swimlanes: SwimlaneConfig[]): SwimlaneConfig {
	for (const lane of swimlanes) {
		if (lane.nodeClasses.includes(node.nodeClass)) {
			return lane;
		}
	}
	// Default to evidence lane
	return swimlanes.find((l) => l.name === "evidence") ?? swimlanes[1];
}

// ── Layout Result Types ──────────────────────────────────────────────────

export interface LayoutNode {
	id: string;
	x: number;
	y: number;
	swimlane: SwimlaneName;
	node: ProvenanceNode;
	// D3 simulation fields
	fx?: number; // Fixed X (swimlane)
	fy?: number | null; // Free Y (force-directed)
	vx?: number;
	vy?: number;
}

export interface LayoutEdge {
	source: LayoutNode;
	target: LayoutNode;
	edge: ProvenanceEdge;
}

export interface SwimlaneLayoutResult {
	nodes: LayoutNode[];
	edges: LayoutEdge[];
	swimlanes: SwimlaneConfig[];
	bounds: { width: number; height: number };
}

// ── Compute Layout ───────────────────────────────────────────────────────

export function computeSwimlaneLayout(
	nodes: ProvenanceNode[],
	edges: ProvenanceEdge[],
	options: {
		swimlanes?: SwimlaneConfig[];
		width?: number;
		height?: number;
		padding?: number;
	} = {},
): SwimlaneLayoutResult {
	const { swimlanes = DEFAULT_SWIMLANES, width = 1100, height = 800, padding = 50 } = options;

	// Create layout nodes with fixed X positions
	const layoutNodes: LayoutNode[] = nodes.map((node, index) => {
		const lane = getSwimlaneForNode(node, swimlanes);
		return {
			id: node.id,
			x: lane.x + lane.width / 2,
			y: padding + (index % 10) * 60, // Initial Y spread
			swimlane: lane.name,
			node,
			fx: lane.x + lane.width / 2, // Fix X to swimlane center
		};
	});

	const nodeById = new Map(layoutNodes.map((n) => [n.id, n]));

	// Create layout edges
	const layoutEdges: LayoutEdge[] = edges
		.map((edge) => {
			const source = nodeById.get(edge.source);
			const target = nodeById.get(edge.target);
			if (!source || !target) return null;
			return { source, target, edge };
		})
		.filter((e): e is LayoutEdge => e !== null);

	// Run D3 force simulation for Y positioning only
	// TQL-5: Monkey-patch Math.random for deterministic jitter
	const originalRandom = Math.random;
	const rng = mulberry32(hashSeed(AUDIT_SEED));
	Math.random = rng;

	const simulation = d3
		.forceSimulation<LayoutNode>(layoutNodes)
		.force(
			"link",
			d3
				.forceLink<LayoutNode, LayoutEdge>(layoutEdges)
				.id((d) => d.id)
				.distance(80)
				.strength(0.3),
		)
		.force("charge", d3.forceManyBody().strength(-100))
		.force("y", d3.forceY(height / 2).strength(0.05))
		.force("collision", d3.forceCollide().radius(25))
		.stop();

	// Run simulation synchronously (deterministic with seeded RNG)
	for (let i = 0; i < 300; i++) {
		simulation.tick();
	}

	// Restore global Math.random
	Math.random = originalRandom;

	// Clamp Y positions to bounds
	layoutNodes.forEach((n) => {
		n.y = Math.max(padding, Math.min(height - padding, n.y));
	});

	return {
		nodes: layoutNodes,
		edges: layoutEdges,
		swimlanes,
		bounds: { width, height },
	};
}

// ── React Hook (Static Layout) ───────────────────────────────────────────

export function useSwimlaneLayout(
	nodes: ProvenanceNode[],
	edges: ProvenanceEdge[],
	options?: {
		swimlanes?: SwimlaneConfig[];
		width?: number;
		height?: number;
		padding?: number;
	},
): SwimlaneLayoutResult {
	return useMemo(() => computeSwimlaneLayout(nodes, edges, options), [nodes, edges, options]);
}

// ── React Hook (Animated Layout) ─────────────────────────────────────────

export function useAnimatedSwimlaneLayout(
	nodes: ProvenanceNode[],
	edges: ProvenanceEdge[],
	options?: {
		swimlanes?: SwimlaneConfig[];
		width?: number;
		height?: number;
		padding?: number;
	},
): SwimlaneLayoutResult & { isSimulating: boolean } {
	const [layoutNodes, setLayoutNodes] = useState<LayoutNode[]>([]);
	const [isSimulating, setIsSimulating] = useState(true);

	const { swimlanes = DEFAULT_SWIMLANES, width = 1100, height = 800, padding = 50 } = options ?? {};

	useEffect(() => {
		// Create initial layout nodes
		const initialNodes: LayoutNode[] = nodes.map((node) => {
			const lane = getSwimlaneForNode(node, swimlanes);
			return {
				id: node.id,
				x: lane.x + lane.width / 2,
				y: padding + Math.random() * (height - 2 * padding),
				swimlane: lane.name,
				node,
				fx: lane.x + lane.width / 2,
			};
		});

		const nodeById = new Map(initialNodes.map((n) => [n.id, n]));
		const layoutEdges: LayoutEdge[] = edges
			.map((edge) => {
				const source = nodeById.get(edge.source);
				const target = nodeById.get(edge.target);
				if (!source || !target) return null;
				return { source, target, edge };
			})
			.filter((e): e is LayoutEdge => e !== null);

		setIsSimulating(true);

		const simulation = d3
			.forceSimulation<LayoutNode>(initialNodes)
			.force(
				"link",
				d3
					.forceLink<LayoutNode, LayoutEdge>(layoutEdges)
					.id((d) => d.id)
					.distance(80)
					.strength(0.3),
			)
			.force("charge", d3.forceManyBody().strength(-100))
			.force("y", d3.forceY(height / 2).strength(0.05))
			.force("collision", d3.forceCollide().radius(25))
			.on("tick", () => {
				setLayoutNodes([...initialNodes]);
			})
			.on("end", () => {
				setIsSimulating(false);
			});

		return () => {
			simulation.stop();
		};
	}, [nodes, edges, swimlanes, height, padding]);

	const nodeById = new Map(layoutNodes.map((n) => [n.id, n]));
	const layoutEdges: LayoutEdge[] = edges
		.map((edge) => {
			const source = nodeById.get(edge.source);
			const target = nodeById.get(edge.target);
			if (!source || !target) return null;
			return { source, target, edge };
		})
		.filter((e): e is LayoutEdge => e !== null);

	return {
		nodes: layoutNodes,
		edges: layoutEdges,
		swimlanes,
		bounds: { width, height },
		isSimulating,
	};
}

// ── Tier Grouping for Progressive Disclosure ─────────────────────────────

export interface TierGroup {
	tier: number;
	nodes: LayoutNode[];
	collapsed: boolean;
	y: number;
	height: number;
}

export function groupBySupplierTier(nodes: LayoutNode[], expandedTier: number = 1): TierGroup[] {
	const supplierNodes = nodes.filter((n) => n.node.nodeClass === "supplier");

	const byTier = new Map<number, LayoutNode[]>();
	supplierNodes.forEach((n) => {
		const tier = n.node.supplier_tier ?? 1;
		const list = byTier.get(tier) ?? [];
		list.push(n);
		byTier.set(tier, list);
	});

	const tiers = Array.from(byTier.keys()).sort();

	return tiers.map((tier) => {
		const tierNodes = byTier.get(tier) ?? [];
		const yPositions = tierNodes.map((n) => n.y);
		const minY = Math.min(...yPositions);
		const maxY = Math.max(...yPositions);

		return {
			tier,
			nodes: tierNodes,
			collapsed: tier !== expandedTier,
			y: minY,
			height: maxY - minY + 50,
		};
	});
}

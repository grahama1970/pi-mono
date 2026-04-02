/**
 * Layout mode application for GraphExplorer.
 * Extracted to keep GraphExplorer.tsx under 800 lines.
 */
import * as d3 from "d3";
import type { BaseEdge, BaseNode, LayoutMode } from "./types";

interface LayoutOptions<N extends BaseNode, E extends BaseEdge> {
	simulation: d3.Simulation<N & d3.SimulationNodeDatum, E & d3.SimulationLinkDatum<N & d3.SimulationNodeDatum>>;
	simNodes: (N & d3.SimulationNodeDatum)[];
	simEdges: (E & d3.SimulationLinkDatum<N & d3.SimulationNodeDatum>)[];
	degree: Map<string, number>;
	width: number;
	height: number;
	layoutMode: LayoutMode;
	stratifiedYFn?: (node: N) => number;
	clusterKeyFn?: (node: N) => string;
}

export function applyLayout<N extends BaseNode, E extends BaseEdge>(opts: LayoutOptions<N, E>) {
	const { simulation, simNodes, simEdges, degree, width, height, layoutMode, stratifiedYFn, clusterKeyFn } = opts;
	type SimN = N & d3.SimulationNodeDatum;

	if (layoutMode === "stratified" && stratifiedYFn) {
		simulation
			.force("y", d3.forceY((d) => stratifiedYFn(d as SimN) * height).strength(0.12))
			.force("x", d3.forceX(width / 2).strength(0.02));
	} else if (layoutMode === "clustered") {
		const getCluster = clusterKeyFn ?? ((n: N) => n.cluster ?? "default");
		const clusters = [...new Set(simNodes.map((n) => getCluster(n)))];
		const cols = Math.ceil(Math.sqrt(clusters.length));
		const clusterPos: Record<string, { x: number; y: number }> = {};
		clusters.forEach((c, i) => {
			const col = i % cols;
			const row = Math.floor(i / cols);
			clusterPos[c] = {
				x: ((col + 0.5) / cols) * width,
				y: ((row + 0.5) / Math.ceil(clusters.length / cols)) * height,
			};
		});
		simulation
			.force("x", d3.forceX((d) => clusterPos[getCluster(d as SimN)]?.x ?? width / 2).strength(0.15))
			.force("y", d3.forceY((d) => clusterPos[getCluster(d as SimN)]?.y ?? height / 2).strength(0.15));
	} else if (layoutMode === "hierarchical") {
		applyHierarchicalLayout(simulation, simNodes, simEdges, degree, width, height);
	}
	// 'organic' uses the default forces — no modification needed
}

function applyHierarchicalLayout<N extends BaseNode, E extends BaseEdge>(
	_simulation: d3.Simulation<N & d3.SimulationNodeDatum, E & d3.SimulationLinkDatum<N & d3.SimulationNodeDatum>>,
	simNodes: (N & d3.SimulationNodeDatum)[],
	simEdges: (E & d3.SimulationLinkDatum<N & d3.SimulationNodeDatum>)[],
	degree: Map<string, number>,
	width: number,
	height: number,
) {
	type SimN = N & d3.SimulationNodeDatum;

	// DAG rank via BFS from zero-in-degree roots
	const adjOut = new Map<string, string[]>();
	const inDeg = new Map<string, number>();
	for (const n of simNodes) {
		adjOut.set(n.id, []);
		inDeg.set(n.id, 0);
	}
	for (const e of simEdges) {
		const s = typeof e.source === "string" ? e.source : (e.source as SimN).id;
		const t = typeof e.target === "string" ? e.target : (e.target as SimN).id;
		adjOut.get(s)?.push(t);
		inDeg.set(t, (inDeg.get(t) ?? 0) + 1);
	}
	const rank = new Map<string, number>();
	const bfsQueue: string[] = [];
	for (const n of simNodes) {
		if ((inDeg.get(n.id) ?? 0) === 0) {
			rank.set(n.id, 0);
			bfsQueue.push(n.id);
		}
	}
	if (bfsQueue.length === 0)
		simNodes.forEach((n) => {
			rank.set(n.id, 0);
			bfsQueue.push(n.id);
		});
	let bqi = 0;
	while (bqi < bfsQueue.length) {
		const cur = bfsQueue[bqi++];
		const r = rank.get(cur) ?? 0;
		for (const t of adjOut.get(cur) ?? []) {
			if (!rank.has(t) || rank.get(t)! < r + 1) {
				rank.set(t, r + 1);
				bfsQueue.push(t);
			}
		}
	}
	let maxRank = 0;
	for (const n of simNodes) {
		if (!rank.has(n.id)) rank.set(n.id, 0);
		if (rank.get(n.id)! > maxRank) maxRank = rank.get(n.id)!;
	}
	const rankGroups = new Map<number, SimN[]>();
	for (const n of simNodes) {
		const r = rank.get(n.id) ?? 0;
		if (!rankGroups.has(r)) rankGroups.set(r, []);
		rankGroups.get(r)!.push(n);
	}

	// Barycenter heuristic for edge-crossing minimization
	const rankOrder: Record<string, number> = {};
	for (const [, ns] of [...rankGroups.entries()].sort(([a], [b]) => a - b)) {
		ns.sort((a, b) => {
			const getBC = (n: SimN) => {
				const indices: number[] = [];
				for (const e of simEdges) {
					const s = typeof e.source === "string" ? e.source : (e.source as SimN).id;
					const t = typeof e.target === "string" ? e.target : (e.target as SimN).id;
					const other = s === n.id ? t : t === n.id ? s : null;
					if (other !== null && rankOrder[other] !== undefined) indices.push(rankOrder[other]);
				}
				return indices.length ? indices.reduce((acc, v) => acc + v, 0) / indices.length : -(degree.get(n.id) ?? 0);
			};
			return getBC(a) - getBC(b);
		});
		ns.forEach((n, i) => {
			rankOrder[n.id] = i;
		});
	}

	// Fixed positions: callers at top, callees at bottom
	const padding = 40;
	const vPad = 60;
	const rankSpacing = Math.min(130, (height - vPad * 2) / Math.max(maxRank, 1));
	for (const [r, ns] of rankGroups) {
		const y = vPad + r * rankSpacing;
		const xStep = (width - padding * 2) / (ns.length + 1);
		ns.forEach((n, i) => {
			n.fx = padding + (i + 1) * xStep;
			n.fy = y;
			n.x = n.fx;
			n.y = n.fy;
		});
	}
}

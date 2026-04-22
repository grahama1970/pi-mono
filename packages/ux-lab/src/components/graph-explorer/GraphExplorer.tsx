/**
 * GraphExplorer — Shared D3 force-directed graph engine.
 *
 * Domain-agnostic: all rendering decisions (node shape, color, edge style, tooltip
 * content, selection behavior) are delegated to callbacks in GraphExplorerProps.
 *
 * Consumers: BinaryGraph.tsx (Binary Explorer), LemmaGraph.tsx (SPARTA Lemma Viewer).
 *
 * Shared infrastructure:
 * - D3 force simulation with LOD adaptive thresholds
 * - Zoom + pan (scroll wheel, double-click fit)
 * - Minimap (click-to-navigate, degree-sized dots, viewport rect)
 * - Tooltip (positioned at node, callback-driven content)
 * - Drag behavior (start/drag/end)
 * - Convex hull outlines (optional, for cluster grouping)
 * - Keyboard navigation (F=fit, Esc=deselect, arrows between nodes)
 * - Position persistence (localStorage)
 * - ResizeObserver with debounce
 * - A11y (ARIA roles, screen reader announcements)
 * - Imperative bridges (__applySelection, __panToNode, __fitToGraph)
 */
import { useRef, useEffect, useState, useCallback } from "react";
import * as d3 from "d3";
import { EMBRY } from "../common/EmbryStyle";
import { hullPath } from "./hullPath";
import { applyLayout } from "./useGraphLayout";
import type { BaseNode, BaseEdge, GraphExplorerProps, SelectionContext } from "./types";

// ── Default circle path ─────────────────────────────────────────────────

function defaultCirclePath(_node: BaseNode, radius: number): string {
	if (radius === 0) return "M0,0";
	const r = radius;
	const k = r * 0.5523;
	return `M0,${-r} C${k},${-r} ${r},${-k} ${r},0 C${r},${k} ${k},${r} 0,${r} C${-k},${r} ${-r},${k} ${-r},0 C${-r},${-k} ${-k},${-r} 0,${-r} Z`;
}

// ── Hash for deterministic initial positions ────────────────────────────

function hashStr(s: string): number {
	let h = 0;
	for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
	return h;
}

// ── Component ───────────────────────────────────────────────────────────

export function GraphExplorer<N extends BaseNode, E extends BaseEdge>(
	props: GraphExplorerProps<N, E>,
) {
	const {
		nodes,
		edges,
		layoutMode = "organic",
		stratifiedYFn,
		clusterKeyFn,
		nodeShapePath = defaultCirclePath,
		nodeRadius: nodeRadiusFn = () => 8,
		nodeColor = () => EMBRY.dim,
		nodeOpacity = () => 0.7,
		nodeStroke = () => "none",
		nodeStrokeWidth = () => 1,
		renderNodeExtras,
		edgeColor = () => "#6b7280",
		edgeWidth = () => 1,
		edgeOpacity = () => 0.15,
		edgeMarkerEnd = () => null,
		edgeLabel: edgeLabelFn,
		renderDefs,
		tooltipContent,
		selectedNodeId = null,
		onNodeClick,
		onNodeHover,
		onContextMenu,
		onSelectionChange,
		applySelectionVisuals,
		matchedNodeIds,
		visitedNodeIds,
		showMinimap = true,
		showHulls = false,
		chargeStrength: chargeStrengthProp,
		linkDistance = 150,
		preWarmTicks: preWarmTicksProp,
		largeGraphThreshold = 200,
		hugeGraphThreshold = 400,
		graphSvgRef,
	} = props;

	const svgRef = useRef<SVGSVGElement>(null);
	const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
	const [activeLayout, setActiveLayout] = useState(layoutMode);
	const clickedRef = useRef<string | null>(null);
	const onNodeClickRef = useRef(onNodeClick);
	onNodeClickRef.current = onNodeClick;
	const onContextMenuRef = useRef(onContextMenu);
	onContextMenuRef.current = onContextMenu;
	const visitedRef = useRef(visitedNodeIds);
	visitedRef.current = visitedNodeIds;
	const selectedNodeIdRef = useRef(selectedNodeId);
	selectedNodeIdRef.current = selectedNodeId;

	useEffect(() => {
		setActiveLayout(layoutMode);
	}, [layoutMode]);

	useEffect(() => {
		if (graphSvgRef) graphSvgRef.current = svgRef.current;
	}, [graphSvgRef]);

	// Stable data references
	const nodesRef = useRef(nodes);
	const edgesRef = useRef(edges);
	nodesRef.current = nodes;
	edgesRef.current = edges;

	const hasFilter = matchedNodeIds && matchedNodeIds.size > 0;
	const isMatched = (id: string) => !hasFilter || matchedNodeIds!.has(id);

	const dataKey = `${nodes.length}:${edges.length}`;

	// ── Selection sync ──────────────────────────────────────────────────

	useEffect(() => {
		const svg = svgRef.current;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		if (svg && (svg as any).__applySelection) {
			if (!selectedNodeId || nodes.some((n) => n.id === selectedNodeId)) {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				(svg as any).__applySelection(selectedNodeId);
			}
		}
	}, [selectedNodeId, visitedNodeIds, nodes]);

	// ── Setup simulation ────────────────────────────────────────────────

	const setupSimulation = useCallback(() => {
		const svg = svgRef.current;
		const filteredNodes = nodesRef.current;
		const filteredEdges = edgesRef.current;
		if (!svg || filteredNodes.length === 0) return;
		if (!dimensions) return;
		const { width, height } = dimensions;

		d3.select(svg).selectAll("*").remove();

		const root = d3.select(svg).attr("viewBox", `0 0 ${width} ${height}`);
		const bgRect = root
			.append("rect")
			.attr("width", width)
			.attr("height", height)
			.attr("fill", EMBRY.bgDeep)
			.style("cursor", "grab");

		// SVG defs
		const defs = root.append("defs");
		// Glow filter for selected nodes
		const glow = defs
			.append("filter")
			.attr("id", "node-glow")
			.attr("x", "-50%")
			.attr("y", "-50%")
			.attr("width", "200%")
			.attr("height", "200%");
		glow.append("feGaussianBlur").attr("stdDeviation", "4").attr("result", "blur");
		glow
			.append("feFlood")
			.attr("flood-color", EMBRY.accent)
			.attr("flood-opacity", "0.4")
			.attr("result", "color");
		glow
			.append("feComposite")
			.attr("in", "color")
			.attr("in2", "blur")
			.attr("operator", "in")
			.attr("result", "glow");
		const glowMerge = glow.append("feMerge");
		glowMerge.append("feMergeNode").attr("in", "glow");
		glowMerge.append("feMergeNode").attr("in", "SourceGraphic");

		// Domain-specific defs (arrowhead markers, patterns, animations)
		if (renderDefs) renderDefs(defs);

		const zoomG = root
			.append("g")
			.attr("class", "zoom-container")
			.attr("id", "zoom-container-content");

		// ── Zoom ──
		const zoom = d3
			.zoom<SVGSVGElement, unknown>()
			.scaleExtent([0.2, 5])
			.on("zoom", (event) => {
				zoomG.attr("transform", event.transform);
				// Zoom-dependent label visibility
				const scale = event.transform.k;
				const labelOpacity = scale > 1.5 ? Math.min(0.8, (scale - 1.5) * 2) : 0;
				zoomG
					.selectAll<SVGTextElement, N & d3.SimulationNodeDatum>(".node-label")
					.filter((d) => clickedRef.current !== d.id)
					.attr("opacity", labelOpacity);
				updateMinimapViewport(event.transform);
			});
		root.call(zoom);

		// ── Minimap ──
		const MM_W = 160,
			MM_H = 100,
			MM_PAD = 10;
		let mmScaleX = 1,
			mmScaleY = 1,
			mmOffX = 0,
			mmOffY = 0;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		let mmNodesG: any, mmSelectedG: any, mmViewport: any, mmBadge: any;

		if (showMinimap) {
			const mmG = root
				.append("g")
				.attr("class", "minimap")
				.attr("transform", `translate(${width - MM_W - MM_PAD}, ${height - MM_H - MM_PAD})`)
				.style("opacity", 0.7)
				.style("transition", "opacity 0.2s");
			mmG.on("mouseenter", function () {
				d3.select(this).style("opacity", 1);
			});
			mmG.on("mouseleave", function () {
				d3.select(this).style("opacity", 0.7);
			});
			mmG.append("rect")
				.attr("width", MM_W)
				.attr("height", MM_H)
				.attr("fill", EMBRY.bgDeep)
				.attr("stroke", EMBRY.border)
				.attr("stroke-width", 1)
				.attr("rx", 3)
				.attr("fill-opacity", 0.9);
			mmNodesG = mmG.append("g").attr("class", "mm-nodes");
			mmSelectedG = mmG.append("g").attr("class", "mm-selected");
			mmViewport = mmG
				.append("rect")
				.attr("class", "mm-viewport")
				.attr("fill", "rgba(0,255,136,0.04)")
				.attr("stroke", EMBRY.accent)
				.attr("stroke-width", 1.5)
				.attr("stroke-dasharray", "3,2")
				.attr("stroke-opacity", 0.7)
				.attr("rx", 1);
			mmBadge = mmG
				.append("text")
				.attr("x", MM_W - 4)
				.attr("y", 12)
				.attr("text-anchor", "end")
				.attr("fill", EMBRY.muted)
				.attr("font-size", 9)
				.attr("font-family", "monospace");

			// Click minimap to pan
			mmG.on("click", function (event) {
				const [mx, my] = d3.pointer(event);
				const gx = (mx - mmOffX) / mmScaleX;
				const gy = (my - mmOffY) / mmScaleY;
				const currentTransform = d3.zoomTransform(svg);
				d3.select(svg)
					.transition()
					.duration(300)
					.call(
						zoom.transform,
						d3.zoomIdentity
							.translate(width / 2, height / 2)
							.scale(currentTransform.k)
							.translate(-gx, -gy),
					);
			});
		}

		const updateMinimapNodes = (
			mnodes: { id: string; x: number; y: number; color: string; deg: number }[],
		) => {
			if (!showMinimap || !mmNodesG) return;
			if (mnodes.length === 0) {
				mmBadge?.text("");
				return;
			}
			const xs = mnodes.map((n) => n.x),
				ys = mnodes.map((n) => n.y);
			const xMin = Math.min(...xs) - 30,
				xMax = Math.max(...xs) + 30;
			const yMin = Math.min(...ys) - 30,
				yMax = Math.max(...ys) + 30;
			const gW = xMax - xMin || 1,
				gH = yMax - yMin || 1;
			const sc = Math.min(MM_W / gW, MM_H / gH);
			mmScaleX = sc;
			mmScaleY = sc;
			mmOffX = (MM_W - gW * sc) / 2 - xMin * sc;
			mmOffY = (MM_H - gH * sc) / 2 - yMin * sc;

			const sel = mmNodesG
				.selectAll("circle")
				.data(mnodes, (d: (typeof mnodes)[0]) => d.id);
			sel
				.join("circle")
				.attr("cx", (d: (typeof mnodes)[0]) => d.x * mmScaleX + mmOffX)
				.attr("cy", (d: (typeof mnodes)[0]) => d.y * mmScaleY + mmOffY)
				.attr("r", (d: (typeof mnodes)[0]) => (d.deg > 10 ? 3 : d.deg > 3 ? 2 : 1.2))
				.attr("fill", (d: (typeof mnodes)[0]) => d.color)
				.attr("opacity", 0.85);

			// Selected node ring
			const selId = clickedRef.current;
			mmSelectedG.selectAll("circle").remove();
			if (selId) {
				const selNode = mnodes.find((n) => n.id === selId);
				if (selNode) {
					mmSelectedG
						.append("circle")
						.attr("cx", selNode.x * mmScaleX + mmOffX)
						.attr("cy", selNode.y * mmScaleY + mmOffY)
						.attr("r", 5)
						.attr("fill", "none")
						.attr("stroke", "#fff")
						.attr("stroke-width", 1.5)
						.attr("stroke-opacity", 0.9);
				}
			}
			mmBadge?.text(`${mnodes.length}`);
		};

		const updateMinimapViewport = (transform: d3.ZoomTransform) => {
			if (!showMinimap || !mmViewport) return;
			const vx = -transform.x / transform.k;
			const vy = -transform.y / transform.k;
			const vw = width / transform.k;
			const vh = height / transform.k;
			mmViewport
				.attr("x", vx * mmScaleX + mmOffX)
				.attr("y", vy * mmScaleY + mmOffY)
				.attr("width", vw * mmScaleX)
				.attr("height", vh * mmScaleY);
		};

		// ── Simulation data (deterministic initial positions) ──
		type SimN = N & d3.SimulationNodeDatum;
		type SimE = E & d3.SimulationLinkDatum<SimN>;

		const simNodes: SimN[] = filteredNodes.map((n) => {
			const h1 = hashStr(n.id),
				h2 = hashStr(n.id + "_y");
			return {
				...n,
				x: width / 2 + (h1 % 400) - 200,
				y: height / 2 + (h2 % 400) - 200,
			} as SimN;
		});
		const simEdges: SimE[] = filteredEdges
			.filter(
				(e) =>
					simNodes.some((n) => n.id === e.source) && simNodes.some((n) => n.id === e.target),
			)
			.map((e) => ({ ...e }) as SimE);

		// Precompute degree
		const degree = new Map<string, number>();
		for (const e of simEdges) {
			const s = typeof e.source === "string" ? e.source : (e.source as SimN).id;
			const t = typeof e.target === "string" ? e.target : (e.target as SimN).id;
			degree.set(s, (degree.get(s) ?? 0) + 1);
			degree.set(t, (degree.get(t) ?? 0) + 1);
		}

		// ── Tooltip ──
		let tooltipEl = svg.parentElement?.querySelector(".graph-tooltip") as HTMLDivElement | null;
		if (!tooltipEl) {
			tooltipEl = document.createElement("div");
			tooltipEl.className = "graph-tooltip";
			Object.assign(tooltipEl.style, {
				position: "absolute",
				pointerEvents: "none",
				opacity: "0",
				padding: "8px 12px",
				borderRadius: "0",
				backgroundColor: "#1a1a2e",
				border: `1px solid ${EMBRY.border}`,
				fontSize: "11px",
				fontFamily: "JetBrains Mono, monospace",
				color: EMBRY.white,
				whiteSpace: "nowrap",
				zIndex: "10",
				transition: "opacity 0.15s",
				boxShadow: "0 4px 20px rgba(0,0,0,0.6)",
				maxWidth: "300px",
			});
			svg.parentElement?.appendChild(tooltipEl);
		}

		// ── Force simulation ──
		const LARGE_GRAPH = simNodes.length > largeGraphThreshold;
		const HUGE_GRAPH = simNodes.length > hugeGraphThreshold;
		const area = width * height;
		const computedCharge =
			chargeStrengthProp ?? -Math.max(800, area / (simNodes.length * 1.2));
		const alphaDecayVal = HUGE_GRAPH ? 0.04 : LARGE_GRAPH ? 0.02 : 0.008;
		const alphaMinVal = HUGE_GRAPH ? 0.002 : LARGE_GRAPH ? 0.001 : 0.0005;

		// Circle layout seed
		const cx = width / 2,
			cy = height / 2;
		simNodes.forEach((n, i) => {
			if (n.x === undefined || n.y === undefined) {
				const angle = (2 * Math.PI * i) / simNodes.length;
				const radius = Math.min(width, height) * 0.35;
				n.x = cx + radius * Math.cos(angle);
				n.y = cy + radius * Math.sin(angle);
			}
		});

		const simulation = d3
			.forceSimulation(simNodes)
			.force(
				"link",
				d3
					.forceLink<SimN, SimE>(simEdges)
					.id((d) => d.id)
					.distance(linkDistance)
					.strength(0.35),
			)
			.force(
				"charge",
				d3
					.forceManyBody()
					.strength(computedCharge)
					.distanceMax(HUGE_GRAPH ? 400 : Math.max(width, height) * 1.5),
			)
			.force(
				"collision",
				HUGE_GRAPH
					? null
					: d3
							.forceCollide()
							.radius((d) => {
								const n = d as SimN;
								return nodeRadiusFn(n, degree.get(n.id) ?? 0) + 30;
							})
							.strength(LARGE_GRAPH ? 0.5 : 0.9),
			)
			.force("center", d3.forceCenter(width / 2, height / 2).strength(0.08))
			.force("x", d3.forceX(width / 2).strength(0.05))
			.force("y", d3.forceY(height / 2).strength(0.05))
			.alpha(0.2)
			.alphaDecay(alphaDecayVal)
			.alphaMin(alphaMinVal)
			.alphaTarget(0)
			.velocityDecay(LARGE_GRAPH ? 0.6 : 0.55);

		// ── Layout modes (extracted to useGraphLayout.ts) ──
		applyLayout({
			simulation: simulation as any,
			simNodes: simNodes as any,
			simEdges: simEdges as any,
			degree,
			width,
			height,
			layoutMode: activeLayout,
			stratifiedYFn,
			clusterKeyFn,
		});

		// ── Pre-warm ──
		const computedPreWarm =
			preWarmTicksProp ?? (HUGE_GRAPH ? 50 : LARGE_GRAPH ? 150 : 500);
		simulation.alpha(0.8);
		for (let i = 0; i < computedPreWarm; ++i) simulation.tick();
		simulation.alpha(alphaMinVal * 2);

		// ── Radius helper ──
		const r = (d: SimN) => nodeRadiusFn(d, degree.get(d.id) ?? 0);

		// ── Hulls ──
		let hullPaths: d3.Selection<any, [string, SimN[]], SVGGElement, unknown> | null = null;
		const hullGroup = zoomG.append("g").attr("class", "hulls");
		if (showHulls) {
			const getCluster = clusterKeyFn ?? ((n: N) => n.cluster ?? "unknown");
			const clusterGroups = new Map<string, SimN[]>();
			for (const n of simNodes) {
				const key = getCluster(n);
				if (!clusterGroups.has(key)) clusterGroups.set(key, []);
				clusterGroups.get(key)!.push(n);
			}
			const hullData = [...clusterGroups.entries()].filter(([, ns]) => ns.length >= 4);
			hullPaths = hullGroup
				.selectAll("path")
				.data(hullData, (([k]: [string, SimN[]]) => k) as any)
				.join("path")
				.attr("fill", "none")
				.attr("stroke", EMBRY.accent)
				.attr("stroke-opacity", 0.25)
				.attr("stroke-width", 1)
				.attr("stroke-dasharray", "6,3")
				.attr("d", ([, ns]: [string, SimN[]]) =>
					hullPath(
						ns.map((n) => [n.x!, n.y!] as [number, number]),
						12,
					),
				);
			hullGroup
				.selectAll("text")
				.data(hullData, (([k]: [string, SimN[]]) => k) as any)
				.join("text")
				.attr("class", "hull-label")
				.attr("text-anchor", "middle")
				.attr("fill", EMBRY.white)
				.attr("font-size", 10)
				.attr("font-weight", 700)
				.attr("font-family", "JetBrains Mono, monospace")
				.attr("opacity", 0.75)
				.style("paint-order", "stroke fill")
				.attr("stroke", EMBRY.bgDeep)
				.attr("stroke-width", 3)
				.attr("x", ([, ns]: [string, SimN[]]) => ns.reduce((s, n) => s + (n.x ?? 0), 0) / ns.length)
				.attr("y", ([, ns]: [string, SimN[]]) => ns.reduce((s, n) => s + (n.y ?? 0), 0) / ns.length)
				.text(([k]: [string, SimN[]]) => k);
		}

		// ── Edges ──
		const edgeGroup = zoomG.append("g").attr("class", "edges");
		const edgeLines = edgeGroup
			.selectAll("line")
			.data(simEdges)
			.join("line")
			.attr("stroke", (d) => {
				const src = simNodes.find((n) => n.id === ((d.source as SimN).id ?? d.source));
				const tgt = simNodes.find((n) => n.id === ((d.target as SimN).id ?? d.target));
				return src && tgt ? edgeColor(d, src, tgt) : "#6b7280";
			})
			.attr("stroke-width", (d) => {
				const src = simNodes.find((n) => n.id === ((d.source as SimN).id ?? d.source));
				const tgt = simNodes.find((n) => n.id === ((d.target as SimN).id ?? d.target));
				return src && tgt ? edgeWidth(d, src, tgt) : 1;
			})
			.attr("stroke-opacity", (d) => edgeOpacity(d))
			.attr("marker-end", (d) => {
				const marker = edgeMarkerEnd(d);
				return marker ? `url(#${marker})` : null;
			});

		// Edge labels
		const edgeLabelGroup = zoomG.append("g").attr("class", "edge-labels");
		const edgeLabels = edgeLabelGroup
			.selectAll("text")
			.data(simEdges)
			.join("text")
			.attr("font-size", 7)
			.attr("font-family", "JetBrains Mono, monospace")
			.attr("fill", EMBRY.dim)
			.attr("text-anchor", "middle")
			.attr("dominant-baseline", "middle")
			.attr("opacity", 0)
			.attr("pointer-events", "none")
			.text((d) => (edgeLabelFn ? edgeLabelFn(d) : ""));

		// ── Nodes ──
		const nodeGroup = zoomG
			.append("g")
			.attr("class", "nodes")
			.attr("role", "list")
			.attr("aria-label", `Graph nodes: ${simNodes.length} features`);
		const nodeGs = nodeGroup
			.selectAll("g")
			.data(simNodes)
			.join("g")
			.style("cursor", "pointer")
			.attr("opacity", (d) => (isMatched(d.id) ? 1 : 0.12))
			.attr("tabindex", 0)
			.attr("role", "listitem")
			.attr("aria-label", (d) => `${d.label} (${degree.get(d.id) ?? 0} connections)`);

		// ── Fit to graph ──
		const fitToGraph = () => {
			const xExt = d3.extent(simNodes, (d) => d.x!) as [number, number];
			const yExt = d3.extent(simNodes, (d) => d.y!) as [number, number];
			if (xExt[0] === undefined || yExt[0] === undefined) return;
			const gWidth = xExt[1] - xExt[0];
			const gHeight = yExt[1] - yExt[0];
			if (gWidth === 0 || gHeight === 0) return;
			const fitScale = Math.min(width / (gWidth + 80), height / (gHeight + 80));
			const targetScale = Math.max(fitScale, 0.6);
			const gCX = (xExt[0] + xExt[1]) / 2;
			const gCY = (yExt[0] + yExt[1]) / 2;
			d3.select(svg)
				.transition()
				.duration(750)
				.call(
					zoom.transform,
					d3.zoomIdentity.translate(width / 2, height / 2).scale(targetScale).translate(-gCX, -gCY),
				);
		};

		root.on("dblclick.zoom", () => fitToGraph());
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(svg as any).__fitToGraph = fitToGraph;

		// ── Selection ──
		const applySelection = (targetId: string | null) => {
			if (!svg.querySelector("g.zoom-container")) return;
			clickedRef.current = targetId;

			// Screen reader announcement
			const announceEl = document.getElementById("ge-graph-announce");
			if (announceEl) {
				if (targetId) {
					const node = simNodes.find((n) => n.id === targetId);
					announceEl.textContent = node
						? `Selected ${node.label}, ${degree.get(targetId) ?? 0} connections`
						: "";
				} else {
					announceEl.textContent = "Selection cleared";
				}
			}

			if (onSelectionChange) onSelectionChange(targetId);

			// Domain-specific selection visuals
			if (applySelectionVisuals) {
				applySelectionVisuals({
					targetId,
					simNodes,
					simEdges,
					degree,
					nodeGs: nodeGs as unknown as SelectionContext<N, E>["nodeGs"],
					edgeLines: edgeLines as unknown as SelectionContext<N, E>["edgeLines"],
					edgeLabels: edgeLabels as unknown as SelectionContext<N, E>["edgeLabels"],
					zoom,
					width,
					height,
				});
				return;
			}

			// Default selection behavior: glow on selected, dim others
			if (!targetId) {
				edgeLines.transition().duration(200).attr("stroke-opacity", (d) => edgeOpacity(d));
				nodeGs.transition().duration(200).attr("opacity", (n) => (isMatched(n.id) ? 1 : 0.12));
				nodeGs
					.select(".node-shape")
					.transition()
					.duration(200)
					.attr("stroke", "none")
					.attr("stroke-width", 0)
					.attr("filter", "none");
				nodeGs
					.select(".node-label")
					.transition()
					.duration(200)
					.attr("opacity", 0);
				return;
			}

			// Highlight selected + 1-hop
			const connIds = new Set<string>([targetId]);
			for (const e of simEdges) {
				const s = (e.source as SimN).id;
				const t = (e.target as SimN).id;
				if (s === targetId || t === targetId) {
					connIds.add(s);
					connIds.add(t);
				}
			}

			edgeLines.transition().duration(200).attr("stroke-opacity", (e) => {
				const s = (e.source as SimN).id;
				const t = (e.target as SimN).id;
				return s === targetId || t === targetId ? 0.85 : 0;
			});

			nodeGs.transition().duration(200).attr("opacity", (n) => {
				if (n.id === targetId) return 1;
				if (connIds.has(n.id)) return 0.7;
				return 0.3;
			});

			nodeGs
				.select(".node-shape")
				.attr("filter", (n) => (n.id === targetId ? "url(#node-glow)" : "none"))
				.transition()
				.duration(200)
				.attr("stroke", (n) => (n.id === targetId ? EMBRY.white : "none"))
				.attr("stroke-width", (n) => (n.id === targetId ? 3 : 0));

			nodeGs
				.select(".node-label")
				.transition()
				.duration(200)
				.attr("opacity", (n) => (connIds.has(n.id) ? 1 : 0));
		};

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(svg as any).__panToNode = (nodeId: string, scale?: number) => {
			const target = simNodes.find((n) => n.id === nodeId);
			if (!target || target.x == null || target.y == null) return;
			const targetScale = scale || d3.zoomTransform(svg).k;
			d3.select(svg)
				.transition()
				.duration(750)
				.ease(d3.easeCubicInOut)
				.call(
					zoom.transform,
					d3.zoomIdentity
						.translate(width / 2, height / 2)
						.scale(targetScale)
						.translate(-target.x, -target.y),
				);
		};

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(svg as any).__applySelection = applySelection;

		applySelection(selectedNodeIdRef.current);
		bgRect.on("click", () => applySelection(null));

		// ── Node event handlers ──
		let _wasDragged = false;
		nodeGs.on("click", function (_event, d) {
			if (_wasDragged) { _wasDragged = false; return; }
			if (onNodeClickRef.current) {
				const original = nodes.find((n) => n.id === d.id);
				if (original) onNodeClickRef.current(original);
			}
		});

		nodeGs.on("keydown", function (event: KeyboardEvent, d) {
			if (event.key === "Enter" || event.key === " ") {
				event.preventDefault();
				const original = nodes.find((n) => n.id === d.id);
				if (original && onNodeClickRef.current) onNodeClickRef.current(original);
			} else if (event.key === "Escape") {
				event.preventDefault();
				applySelection(null);
				svg.focus();
			} else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
				event.preventDefault();
				const allGs = nodeGroup.selectAll<SVGGElement, SimN>("g").nodes();
				const idx = allGs.indexOf(this as SVGGElement);
				const next = allGs[(idx + 1) % allGs.length];
				if (next) (next as unknown as HTMLElement).focus();
			} else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
				event.preventDefault();
				const allGs = nodeGroup.selectAll<SVGGElement, SimN>("g").nodes();
				const idx = allGs.indexOf(this as SVGGElement);
				const prev = allGs[(idx - 1 + allGs.length) % allGs.length];
				if (prev) (prev as unknown as HTMLElement).focus();
			}
		});

		nodeGs.on("dblclick", function (event, d) {
			event.stopPropagation();
			const targetScale = Math.min(Math.max(d3.zoomTransform(svg).k * 1.5, 2), 4);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(svg as any).__panToNode?.(d.id, targetScale);
		});

		nodeGs.on("contextmenu", function (event, d) {
			event.preventDefault();
			event.stopPropagation();
			if (onContextMenuRef.current) {
				const original = nodes.find((n) => n.id === d.id);
				if (original) onContextMenuRef.current(original, event.clientX, event.clientY);
			}
		});

		// Hover
		nodeGs
			.on("mouseenter", function (_event, d) {
				d3.select(this).raise();
				const original = nodes.find((n) => n.id === d.id);
				if (onNodeHover && original) onNodeHover(original);

				// Tooltip
				if (tooltipContent && tooltipEl && d3.zoomTransform(svg).k <= 1.5) {
					const connectedEdges = simEdges.filter(
						(e) => (e.source as SimN).id === d.id || (e.target as SimN).id === d.id,
					);
					tooltipEl.innerHTML = tooltipContent(d, connectedEdges as unknown as E[], degree.get(d.id) ?? 0);
					tooltipEl.style.opacity = "1";
					const svgRect = svg.getBoundingClientRect();
					const pt = svg.createSVGPoint();
					pt.x = d.x ?? 0;
					pt.y = d.y ?? 0;
					const ctm = zoomG.node()?.getScreenCTM();
					if (ctm) {
						const sp = pt.matrixTransform(ctm);
						tooltipEl.style.left = `${sp.x - svgRect.left + 16}px`;
						tooltipEl.style.top = `${sp.y - svgRect.top - 10}px`;
					}
				}

				// Show label on hover
				if (clickedRef.current !== d.id) {
					d3.select(this).select(".node-label").transition().duration(80).attr("opacity", 1);
				}

				// Hover ring
				d3.select(this).select(".hover-ring").remove();
				d3.select(this)
					.append("circle")
					.attr("class", "hover-ring")
					.attr("r", r(d) + 6)
					.attr("fill", "none")
					.attr("stroke", EMBRY.white)
					.attr("stroke-width", 1.5)
					.attr("stroke-opacity", 0.3)
					.attr("pointer-events", "none");
			})
			.on("mouseleave", function (_event, d) {
				if (onNodeHover) onNodeHover(null);
				if (tooltipEl) tooltipEl.style.opacity = "0";
				if (clickedRef.current !== d.id) {
					d3.select(this).select(".node-label").transition().duration(150).attr("opacity", 0);
				}
				d3.select(this).select(".hover-ring").remove();
			});

		// ── Hit area ──
		nodeGs
			.append("circle")
			.attr("class", "hit-area")
			.attr("cx", 0)
			.attr("cy", 0)
			.attr("r", (d) => Math.max(20, r(d) + 10))
			.attr("fill", "transparent")
			.style("cursor", "pointer");

		// ── Node shapes ──
		nodeGs
			.append("path")
			.attr("class", "node-shape")
			.attr("d", "M0,0")
			.attr("fill", (d) => nodeColor(d))
			.attr("fill-opacity", (d) => nodeOpacity(d))
			.attr("stroke", (d) => nodeStroke(d))
			.attr("stroke-width", (d) => nodeStrokeWidth(d, degree.get(d.id) ?? 0))
			.transition()
			.delay((_d, i) => Math.min(i * 12, 500))
			.duration(350)
			.ease(d3.easeCubicOut)
			.attr("d", (d) => nodeShapePath(d, r(d)));

		// ── Node labels ──
		nodeGs
			.append("text")
			.attr("class", "node-label")
			.attr("dy", (d) => r(d) + 10)
			.attr("text-anchor", "middle")
			.attr("fill", "#e2e8f0")
			.attr("font-size", 9)
			.attr("font-weight", 600)
			.attr("font-family", "JetBrains Mono, monospace")
			.style("paint-order", "stroke fill")
			.attr("stroke", "rgba(20,20,25,0.85)")
			.attr("stroke-width", 4)
			.style("filter", "drop-shadow(0 0 2px #000) drop-shadow(0 0 4px #000)")
			.attr("opacity", 0)
			.text((d) => (d.label.length > 28 ? `${d.label.slice(0, 26)}…` : d.label));

		// ── Domain-specific node extras ──
		if (renderNodeExtras) {
			renderNodeExtras(
				nodeGs as unknown as Parameters<NonNullable<typeof renderNodeExtras>>[0],
				degree,
			);
		}

		// ── Drag ──
		const drag = d3
			.drag<SVGGElement, SimN, d3.SubjectPosition>()
			.on("start", (event, d) => {
				_wasDragged = false;
				if (!event.active && activeLayout !== "hierarchical")
					simulation.alphaTarget(0.1).restart();
				d.fx = d.x;
				d.fy = d.y;
			})
			.on("drag", (event, d) => {
				_wasDragged = true;
				d.fx = event.x;
				d.fy = event.y;
			})
			.on("end", (event, d) => {
				if (!event.active) simulation.alphaTarget(0);
				if (activeLayout !== "hierarchical") {
					d.fx = null;
					d.fy = null;
				}
			});
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		nodeGs.call(drag as any);

		// ── Position persistence ──
		const posKey = `graph-explorer-pos-${simNodes
			.slice(0, 5)
			.map((n) => n.id)
			.join(",")}-${simNodes.length}`;
		const savePositions = () => {
			const positions: Record<string, { x: number; y: number }> = {};
			for (const d of simNodes) {
				if (d.x != null && d.y != null) positions[d.id] = { x: d.x, y: d.y };
			}
			try {
				localStorage.setItem(posKey, JSON.stringify(positions));
			} catch {}
		};

		// Restore saved positions
		try {
			const saved = localStorage.getItem(posKey);
			if (saved) {
				const positions = JSON.parse(saved) as Record<string, { x: number; y: number }>;
				let restored = 0;
				for (const d of simNodes) {
					const p = positions[d.id];
					if (p) {
						d.x = p.x;
						d.y = p.y;
						restored++;
					}
				}
				if (restored > simNodes.length * 0.8) simulation.alpha(0.05);
			}
		} catch {}

		// ── Tick ──
		let tickCount = 0;
		simulation.on("tick", () => {
			if (LARGE_GRAPH && tickCount % 2 !== 0) {
				tickCount++;
				return;
			}

			// Soft boundary
			const margin = 50;
			const pushStrength = 0.5;
			for (const d of simNodes) {
				if (d.x! < margin) d.vx! += (margin - d.x!) * pushStrength;
				else if (d.x! > width - margin) d.vx! -= (d.x! - (width - margin)) * pushStrength;
				if (d.y! < margin) d.vy! += (margin - d.y!) * pushStrength;
				else if (d.y! > height - margin) d.vy! -= (d.y! - (height - margin)) * pushStrength;
			}

			// Edge positions
			edgeLines
				.attr("x1", (d) => (d.source as SimN).x!)
				.attr("y1", (d) => (d.source as SimN).y!)
				.attr("x2", (d) => (d.target as SimN).x!)
				.attr("y2", (d) => (d.target as SimN).y!);

			// Node positions
			nodeGs.attr("transform", (d) => `translate(${d.x},${d.y})`);

			// Edge label positions
			if (clickedRef.current !== null) {
				edgeLabels
					.attr("x", (e) => ((e.source as SimN).x! + (e.target as SimN).x!) / 2)
					.attr("y", (e) => ((e.source as SimN).y! + (e.target as SimN).y!) / 2 - 6);
			}

			// Hull positions
			if (showHulls && hullPaths && tickCount % (LARGE_GRAPH ? 4 : 1) === 0) {
				hullPaths.attr("d", ([, ns]: [string, SimN[]]) =>
					hullPath(
						ns.map((n) => [n.x!, n.y!] as [number, number]),
						12,
					),
				);
				hullGroup
					.selectAll<SVGTextElement, [string, SimN[]]>(".hull-label")
					.attr("x", ([, ns]: [string, SimN[]]) => ns.reduce((s, n) => s + (n.x ?? 0), 0) / ns.length)
					.attr("y", ([, ns]: [string, SimN[]]) => ns.reduce((s, n) => s + (n.y ?? 0), 0) / ns.length);
			}

			// Minimap
			if (tickCount % 10 === 0) {
				updateMinimapNodes(
					simNodes.map((n) => ({
						id: n.id,
						x: n.x!,
						y: n.y!,
						color: nodeColor(n),
						deg: degree.get(n.id) ?? 0,
					})),
				);
				updateMinimapViewport(d3.zoomTransform(svg));
			}

			if (++tickCount % 100 === 0) savePositions();
		});

		// Fit on settle
		let initialFitDone = false;
		simulation.on("end", () => {
			savePositions();
			if (!initialFitDone && !selectedNodeIdRef.current) {
				initialFitDone = true;
				fitToGraph();
			}
		});

		return () => {
			simulation.stop();
			if (tooltipEl) tooltipEl.style.opacity = "0";
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [dataKey, activeLayout, dimensions]);

	useEffect(() => {
		return setupSimulation();
	}, [setupSimulation]);

	// Resize observer
	useEffect(() => {
		const svg = svgRef.current;
		if (!svg) return;
		const container = svg.parentElement;
		if (!container) return;
		let resizeTimer: ReturnType<typeof setTimeout>;
		const observer = new ResizeObserver((entries) => {
			const { width, height } = entries[0].contentRect;
			if (width > 0 && height > 0) {
				clearTimeout(resizeTimer);
				resizeTimer = setTimeout(() => setDimensions({ width, height }), 150);
			}
		});
		observer.observe(container);
		return () => observer.disconnect();
	}, []);

	// Keyboard shortcuts
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			const svg = svgRef.current;
			if (!svg) return;
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			if (e.key === "f" || e.key === "F") (svg as any).__fitToGraph?.();
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			if (e.key === "Escape") (svg as any).__applySelection?.(null);
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, []);

	return (
		<div
			style={{
				backgroundColor: EMBRY.bgDeep,
				position: "relative",
				overflow: "hidden",
				flex: "1 1 0%",
				minHeight: 0,
			}}
		>
			<svg
				ref={svgRef}
				role="img"
				aria-label={`Interactive graph: ${nodes.length} nodes. Arrow keys to navigate, Enter to select, Escape to deselect.`}
				style={{ width: "100%", height: "100%", display: "block" }}
			/>
			<div
				id="ge-graph-announce"
				aria-live="polite"
				aria-atomic="true"
				style={{
					position: "absolute",
					width: 1,
					height: 1,
					overflow: "hidden",
					clip: "rect(0,0,0,0)",
				}}
			/>
		</div>
	);
}

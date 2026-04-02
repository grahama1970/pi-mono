/**
 * Shared types for the GraphExplorer component.
 * Domain-specific graph viewers (Binary Explorer, Lemma Graph, etc.)
 * extend these base types and pass domain callbacks to GraphExplorer.
 */
import type * as d3 from "d3";

// ── Base data types ─────────────────────────────────────────────────────

export interface BaseNode {
	id: string;
	label: string;
	cluster?: string;
}

export interface BaseEdge {
	source: string;
	target: string;
}

// ── Layout ──────────────────────────────────────────────────────────────

export type LayoutMode = "organic" | "stratified" | "clustered" | "hierarchical";

// ── Selection context passed to applySelectionVisuals callback ──────────

export interface SelectionContext<N extends BaseNode, E extends BaseEdge> {
	targetId: string | null;
	simNodes: (N & d3.SimulationNodeDatum)[];
	simEdges: (E & d3.SimulationLinkDatum<N & d3.SimulationNodeDatum>)[];
	degree: Map<string, number>;
	nodeGs: d3.Selection<SVGGElement, N & d3.SimulationNodeDatum, SVGGElement, unknown>;
	edgeLines: d3.Selection<
		SVGLineElement,
		E & d3.SimulationLinkDatum<N & d3.SimulationNodeDatum>,
		SVGGElement,
		unknown
	>;
	edgeLabels: d3.Selection<
		SVGTextElement,
		E & d3.SimulationLinkDatum<N & d3.SimulationNodeDatum>,
		SVGGElement,
		unknown
	>;
	zoom: d3.ZoomBehavior<SVGSVGElement, unknown>;
	width: number;
	height: number;
}

// ── Props ───────────────────────────────────────────────────────────────

export interface GraphExplorerProps<N extends BaseNode, E extends BaseEdge> {
	// --- Data ---
	nodes: N[];
	edges: E[];

	// --- Layout ---
	layoutMode?: LayoutMode;
	/** For stratified layout: map node to target Y position (0–1 normalized) */
	stratifiedYFn?: (node: N) => number;
	/** For clustered layout: override cluster key (defaults to node.cluster) */
	clusterKeyFn?: (node: N) => string;

	// --- Node rendering callbacks ---
	/** SVG path string for node shape. Default: circle. */
	nodeShapePath?: (node: N, radius: number) => string;
	/** Radius for a given node. Default: 8. */
	nodeRadius?: (node: N, degree: number) => number;
	/** Fill color for node. */
	nodeColor?: (node: N) => string;
	/** Fill opacity for node. Default: 0.7 */
	nodeOpacity?: (node: N) => number;
	/** Stroke color for node border. */
	nodeStroke?: (node: N) => string;
	/** Stroke width for node border. Default: 1 */
	nodeStrokeWidth?: (node: N, degree: number) => number;
	/** Extra SVG elements appended inside each node <g> after the base shape. */
	renderNodeExtras?: (
		nodeG: d3.Selection<SVGGElement, N & d3.SimulationNodeDatum, SVGGElement, unknown>,
		degree: Map<string, number>,
	) => void;

	// --- Edge rendering callbacks ---
	/** Edge stroke color. Default: '#6b7280' */
	edgeColor?: (edge: E, sourceNode: N, targetNode: N) => string;
	/** Edge stroke width. Default: 1 */
	edgeWidth?: (edge: E, sourceNode: N, targetNode: N) => number;
	/** Edge stroke opacity. Default: 0.15 */
	edgeOpacity?: (edge: E) => number;
	/** Edge marker-end id. Return null for no arrow. */
	edgeMarkerEnd?: (edge: E) => string | null;
	/** Edge label text. */
	edgeLabel?: (edge: E) => string;

	// --- SVG defs (markers, patterns, filters, animations) ---
	renderDefs?: (defs: d3.Selection<SVGDefsElement, unknown, null, undefined>) => void;

	// --- Tooltip ---
	tooltipContent?: (node: N, connectedEdges: E[], degree: number) => string;

	// --- Interaction ---
	selectedNodeId?: string | null;
	onNodeClick?: (node: N) => void;
	onNodeHover?: (node: N | null) => void;
	onContextMenu?: (node: N, x: number, y: number) => void;
	onSelectionChange?: (nodeId: string | null) => void;
	/** Override default selection visuals (glow + dim). */
	applySelectionVisuals?: (ctx: SelectionContext<N, E>) => void;

	// --- Filtering ---
	matchedNodeIds?: Set<string>;
	visitedNodeIds?: Set<string>;

	// --- Minimap & hulls ---
	showMinimap?: boolean;
	showHulls?: boolean;

	// --- Simulation tuning ---
	chargeStrength?: number;
	linkDistance?: number;
	preWarmTicks?: number;
	largeGraphThreshold?: number;
	hugeGraphThreshold?: number;

	// --- External ref ---
	graphSvgRef?: React.MutableRefObject<SVGSVGElement | null>;
}

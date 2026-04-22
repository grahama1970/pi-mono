/**
 * ProvenanceGraph — Day 2 Compliance Cascade Visualization
 *
 * Military-grade provenance viewer implementing Gemini + ChatGPT synthesis:
 * - PageRank-style iterative convergence (handles cycles)
 * - Temporal decay projection
 * - Supplier isolation simulation
 * - MRS remediation planning
 * - Hybrid Canvas/SVG rendering
 * - Fixed X swimlane layout
 */

// Main component
export { default, ProvenanceGraph } from "./ProvenanceGraph";

// Types
export type {
	AssessmentMethod,
	CascadeState,
	DALLevel,
	EdgeType,
	EvidenceStatus,
	ForensicsEvent,
	NodeClass,
	ProofStatus,
	PropagationRule,
	ProvenanceEdge,
	ProvenanceGraphProps,
	ProvenanceNode,
	RemediationAction,
	RemediationAuthority,
	Rigor,
	SupplyChainSummary,
	SwimlaneConfig,
	SwimlaneName,
	TemporalEvidenceState,
	VisualState,
} from "./types";
export type { DecayHorizonResult } from "./useDecayHorizon";
export {
	computeDecayHorizon,
	getDecayColor,
	getPulseFrequency,
	useDecayHorizon,
} from "./useDecayHorizon";
export type { RemediationPlanResult } from "./useRemediationPlanner";
export {
	computeRemediationPlan,
	findQuickWins,
	useRemediationPlanner,
} from "./useRemediationPlanner";
export type {
	LayoutEdge,
	LayoutNode,
	SwimlaneLayoutResult,
	TierGroup,
} from "./useSwimlaneLayout";
export {
	computeSwimlaneLayout,
	groupBySupplierTier,
	useAnimatedSwimlaneLayout,
	useSwimlaneLayout,
} from "./useSwimlaneLayout";
export type { WeightedImpactResult } from "./useWeightedImpact";
// Hooks
export {
	computePropagationRule,
	computeWeightedImpact,
	useWeightedImpact,
} from "./useWeightedImpact";

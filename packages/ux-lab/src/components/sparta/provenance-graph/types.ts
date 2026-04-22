/**
 * ProvenanceGraph Types — Day 2 Architecture
 *
 * Implements unified schema from Gemini + ChatGPT synthesis:
 * - Edge taxonomy with DAL levels and exclusivity
 * - Temporal evidence state with supersedes chains
 * - NIST 800-171A assessment methods on edges
 * - Supply chain tier tracking
 */

// ── Edge Types ───────────────────────────────────────────────────────────

export type EdgeType =
	| "inherits_from" // Supplier cert → control (hard break)
	| "satisfies" // Evidence → objective (hard break)
	| "partially_supports" // Shared evidence (weighted by exclusivity)
	| "maps_to" // Crosswalk/requirement level (advisory)
	| "depends_on" // Same assertion, same scope (hard break)
	| "supersedes" // Temporal: same stream, newer state
	| "replaces_support_for"; // Cross-supplier replacement (explicit)

export type DALLevel = "A" | "B" | "C" | "D" | "E";
export type AssessmentMethod = "Examine" | "Interview" | "Test";
export type Rigor = "Basic" | "Focused" | "Comprehensive";
export type PropagationRule = "hard_break" | "confidence_degradation" | "advisory_only" | "no_propagation";

export interface ProvenanceEdge {
	id: string;
	source: string;
	target: string;
	type: EdgeType;
	weight: number; // 0.0–1.0
	dal_level?: DALLevel; // DO-178C/254 assurance level
	methods?: AssessmentMethod[]; // NIST 800-171A
	rigor?: Rigor;
	coverage?: "Basic" | "Focused" | "Comprehensive";
	exclusivity: number; // 0.0–1.0 (ChatGPT's key insight)
	supplier_tier?: number; // 1, 2, 3, etc.
	provenance_confidence?: number; // 0.0–1.0
	// DFARS 7012 flow-down
	is_cui_boundary?: boolean; // Does this edge cross into CUI environment?
	incident_reported?: boolean; // DFARS 252.204-7012(c) status
	security_clearance_req?: string; // Required clearance level
}

// ── Node Types ───────────────────────────────────────────────────────────

export type NodeClass =
	| "evidence_artifact" // PDF, attestation, test result
	| "assessment_objective" // NIST 800-171A objective
	| "control" // CMMC/NIST control
	| "control_family" // AC, IA, SC cluster
	| "supplier" // Tier-1, Tier-2, etc.
	| "framework_artifact"; // DO-178C objective, ISO clause

export type ProofStatus = "proved" | "sorry" | "partial" | "axiom" | "none";

// DO-178C temporal states (Service Bulletins, Airworthiness Directives)
export type EvidenceStatus = "active" | "superseded" | "recalled" | "expired";

export interface TemporalEvidenceState {
	observed_at: number; // First seen (Unix ms)
	valid_from: number; // Effective start
	valid_to: number; // Expiration (drives decay)
	assessed_at: number; // Last assessment timestamp
	supersedes_id?: string; // Previous version (same stream only)
	superseded_at?: number; // When this was superseded
	superseded_by?: string; // ID of superseding evidence
	source_event_id: string; // Ingestion event for forensics
	is_active: boolean; // Excluded from live graph if false
}

export interface ProvenanceNode {
	id: string;
	label: string;
	nodeClass: NodeClass;
	framework?: string; // CMMC, NIST, DO-178C, DO-254
	family?: string; // Control family (AC, IA, etc.)
	supplier_id?: string;
	supplier_tier?: number;
	dal_level?: DALLevel;
	proof_status?: ProofStatus;
	temporal: TemporalEvidenceState;
	// Computed at runtime
	impact_score?: number; // 0.0–1.0 from PageRank
	cascade_state?: CascadeState;
}

// ── Cascade States ───────────────────────────────────────────────────────

export type CascadeState =
	| "root_failure" // Manually triggered or expired
	| "hard_break" // Downstream of hard dependency
	| "degraded" // Confidence reduced
	| "advisory" // Cross-framework ripple only
	| "healthy" // No impact
	| "selected"; // User-selected node

// ── Visual States (Gemini's dual glow) ───────────────────────────────────

export interface VisualState {
	inner: "green" | "amber" | "red" | "dim";
	border: "none" | "green" | "amber" | "red-pulse" | "red";
	opacity: number;
}

// ── Supply Chain Summary ─────────────────────────────────────────────────

export interface SupplyChainSummary {
	tier1_affected: number;
	tier2_affected: number;
	tier3_plus_affected: number;
	total_affected: number;
	expanded_tier: number; // Which tier is currently expanded
}

// ── Remediation Action ───────────────────────────────────────────────────

export type RemediationAuthority = "direct" | "supplier_outreach" | "formal_reproof";

export interface RemediationAction {
	node_id: string;
	label: string;
	restoration_score: number; // MRS value
	authority: RemediationAuthority;
	estimated_effort: "low" | "medium" | "high";
	downstream_count: number;
}

// ── Forensics Event ──────────────────────────────────────────────────────

export interface ForensicsEvent {
	timestamp: number;
	event_type: "ingestion" | "expiration" | "supersede" | "verification" | "cascade";
	node_id: string;
	description: string;
	delta?: Record<string, { before: unknown; after: unknown }>;
}

// ── Swimlane Layout ──────────────────────────────────────────────────────

export type SwimlaneName = "suppliers" | "evidence" | "controls" | "frameworks";

export interface SwimlaneConfig {
	name: SwimlaneName;
	x: number; // Fixed X position
	width: number;
	label: string;
	nodeClasses: NodeClass[];
}

// ── DFARS 252.204-7012(c) Incident Export ────────────────────────────────

export interface DFARS7012Report {
	incidentId: string;
	timestamp: number;
	reporterId: string; // Brandon Bailey
	facilityId: string; // F-36 Assembly Plant, Fort Worth

	// Golden Path Trace
	triggeredControlId: string; // e.g., DE-0012
	rootCauseArtifactId: string; // The specific expired/recalled node
	logicalChain: string[]; // Ordered list of node IDs in the Golden Path

	// Impact Assessment
	frameworksAffected: ("CMMC_L2" | "DO178C" | "NIST_800_171")[];
	cuiBoundaryBreach: boolean;

	// Verification Proof
	lean4AuditHash: string; // Formal proof state at time of incident
	graphSnapshotHash: string; // Bit-identical state for DER review

	// Metadata
	generatedAt: number;
	generatedBy: "SPARTA_Explorer_v2";
	exportVersion: "1.0.0";
}

export interface IncidentLogicSummary {
	rootCauseLabel: string; // Human-readable root cause
	artifactType: NodeClass;
	propagationPath: Array<{
		nodeId: string;
		nodeLabel: string;
		impact: "hard_break" | "degraded" | "advisory";
	}>;
	controlsImpacted: number;
	suppliersAffected: number;
	cuiExposure: boolean;
	recommendedAction: string;
}

export interface TraceabilityMatrixRow {
	llrId: string; // Low-Level Requirement ID
	llrDescription: string;
	nistObjective: string;
	cmmcControl: string;
	status: "compliant" | "non_compliant" | "degraded";
	evidenceIds: string[];
}

// ── Component Props ──────────────────────────────────────────────────────

export interface ProvenanceGraphProps {
	nodes: ProvenanceNode[];
	edges: ProvenanceEdge[];
	onNodeSelect?: (node: ProvenanceNode | null) => void;
	onExport?: (affected: ProvenanceNode[], rationale: string) => void;
	onDFARSExport?: (report: DFARS7012Report, summary: IncidentLogicSummary) => void;
	initialDecayHorizon?: number; // Days
	contractConfig?: {
		max_tier_depth: number;
		flow_down_required: boolean;
	};
	virtualTaints?: Set<string>; // Supplier IDs to simulate as failed
	onSupplierKillSwitch?: (supplierId: string) => void;
	width?: number;
	height?: number;
}

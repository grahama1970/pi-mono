/**
 * Shared chat types — unified across Embry Terminal + SPARTA Explorer.
 */

export type EntityType = "skill" | "control" | "cwe" | "attack" | "framework" | "sparta";

export type CascadeLayer = "recall" | "intent" | "llm" | "aql";

export interface RecallItem {
	_key?: string;
	_source?: string;
	control_id?: string;
	name?: string;
	question?: string;
	problem?: string;
	solution?: string;
	content?: string;
	scores?: { bm25?: number; graph?: number; dense?: number; freshness?: number };
}

export interface RecallResult {
	found: boolean;
	confidence: number;
	items: RecallItem[];
}

export interface EntityRef {
	id: string;
	label: string;
	type: EntityType;
	exists: boolean;
}

export interface EvidenceGate {
	gate: string;
	passed: boolean;
	detail: string;
	duration?: number;
}

export interface ThreatMatrixSummary {
	totalTechniques: number;
	totalTactics: number;
	satisfied: number;
	inconclusive: number;
	notSatisfied: number;
	noEvidence: number;
	datalake: string;
}

export interface ReasoningStep {
	id: string;
	type: "recall" | "skill" | "text" | "pending";
	skill?: string;
	status: "running" | "done" | "failed" | "pending";
	summary: string;
	detail?: string;
	duration?: number;
	startedAt?: number;
	confidence?: number;
	recallItems?: RecallItem[];
	children?: ReasoningStep[];
}

export interface Artifact {
	id: string;
	title: string;
	type: "code" | "html" | "svg" | "markdown" | "react-table" | "graph";
	content: string;
	language?: string;
	data?: unknown;
}

export interface Skill {
	name: string;
	description: string;
	triggers: string[];
}

export interface Agent {
	id: string;
	name: string;
	color: string;
}

export interface EvidenceCaseData {
	verdict: string;
	grade: string;
	gates_passed: number;
	gates_total: number;
	gate_summary: string;
	gate_trace?: Array<{ gate: string; passed: boolean; detail: string; duration?: number }>;
	control_ids: string[];
	tier: string;
	drift?: { old_verdict: string; new_verdict: string; timestamp: string };
	recall_count?: number;
	recall_breakdown?: Record<string, number>;
	source_traceability?: Record<string, number>;
}

export interface ChatMessage {
	id: string;
	role: "user" | "assistant" | "system" | "agent";
	content: string;
	timestamp: number;
	// Agent metadata
	agent?: string;
	skillUsed?: string;
	chainTitle?: string;
	// Recall + reasoning
	recall?: RecallResult;
	recallItems?: RecallItem[];
	reasoningSteps?: ReasoningStep[];
	// Artifacts
	artifact?: Artifact;
	artifacts?: Artifact[];
	// Structured results
	verdict?: { state: string; gates: EvidenceGate[]; tier?: string };
	matrixSummary?: ThreatMatrixSummary;
	evidenceCase?: EvidenceCaseData;
	// Entity + classification
	entities?: EntityRef[];
	cascadeLayer?: CascadeLayer;
	// SPARTA-specific
	type?: "natural" | "aql";
	alertType?: "threat-delta";
	_querySpec?: Record<string, unknown>;
	clarifyOptions?: Array<{ question: string }>;
	resultCount?: number;
	// Interaction
	feedback?: "up" | "down" | null;
}

// ── Activity Feed Types ─────────────────────────────────────────────────

export interface ActivityEvent {
	type:
		| "agent_started"
		| "agent_completed"
		| "agent_finding"
		| "presence_update"
		| "suggestion"
		| "suggestion_resolved";
	agent?: string;
	project?: string;
	summary?: string;
	entity?: string;
	entityType?: EntityType;
	controlId?: string;
	finding?: string;
	confidence?: number;
	id?: string;
	status?: string;
	timestamp: number;
}

export interface PresenceEntry {
	userId: string;
	displayName: string;
	project?: string;
	status: "active" | "idle" | "offline";
	lastSeen: number;
	isAgent: boolean;
	agentType?: string;
}

export interface AgentSuggestion {
	id: string;
	agent: string;
	controlId: string;
	finding: string;
	evidence: string;
	confidence: number;
	status: "pending" | "accepted" | "rejected";
	resolvedBy?: string;
	resolvedAt?: number;
}

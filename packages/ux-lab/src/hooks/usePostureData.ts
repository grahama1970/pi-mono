import { useEffect, useState } from "react";

export type F36ProjectionNode = {
	persisted_node_id: string;
	control_id: string;
	name: string;
	source_framework: string;
	source_version: string;
};

export type F36ProjectionEdge = {
	persisted_edge_id: string;
	source_id: string;
	target_id: string;
	source_framework: string;
	target_framework: string;
	relationship_type: string;
	direction: string;
};

export type F36ProjectionPathProof = {
	path_signature: string;
	nodes: F36ProjectionNode[];
	persisted_edge_ids: string[];
	edges: F36ProjectionEdge[];
	authority_state: string;
};

export type F36ExplorerProjection = {
	schema: "f36.explorer_shared_projection.v1";
	projection_fingerprint: string;
	source: {
		path: string;
		source_file_sha256: string;
		family_evidence_case_snapshot_id: string;
		snapshot_content_hash: string;
		input_fingerprint: string;
		modified_at: string;
		stale: false;
		live: true;
		mocked: false;
	};
	requirement: {
		requirement_id: string;
		requirement_revision_id: string;
		requirement_content_hash: string;
		primary_component_family_id: string;
	};
	engineering_qra_family: {
		engineering_qra_family_id: string;
		canonical_question: string;
		canonical_answer: string;
		canonical_answer_hash: string;
		canonical_intent: Record<string, unknown>;
		variant_count: number;
		variant_evidence_runs: 0;
	};
	evidence_verdict: "INCONCLUSIVE";
	family_disposition: string;
	applicability: { state?: string; route?: string; review_state?: string; [key: string]: unknown };
	review_state: "pending";
	accepted: false;
	quarantine_state: string;
	binding_registry_state: string;
	crosswalk_resolution_state: string;
	projection_eligibility: {
		candidate_review_mode: true;
		reviewed_default_mode: false;
		posture_grounding_numerator: false;
		supply_chain_sparta_overlay: false;
	};
	path_resolution: {
		sparta_release_id: string;
		sparta_release_hash: string;
		path_proofs: F36ProjectionPathProof[];
	};
	posture: {
		assessed_requirements: 1;
		applicable_requirements: 1;
		pending_review_requirements: 1;
		grounded_numerator: 0;
		compliance_credit: 0;
	};
	supply_chain: { engineering_lineage_available: false; reviewed_sparta_overlay: false; state: string };
	authority: { state: string; operational_authority: false; implementation_credit: 0; compliance_credit: 0; path_proofs_are_traceability_only: true };
	consumer_fingerprints: { threat_matrix: string; posture: string; supply_chain: string; chat: string };
};

export type F36ProjectionSummary = Pick<F36ExplorerProjection,
	"projection_fingerprint" | "requirement" | "engineering_qra_family" | "evidence_verdict" |
	"review_state" | "accepted" | "quarantine_state" | "binding_registry_state" |
	"projection_eligibility" | "posture" | "authority"
>;

// ── Types matching /api/posture/v2 response ──

export type Framework = {
	name: string;
	total: number;
	satisfied: number;
	inconclusive: number;
	failed: number;
	pct: number;
};

export type Family = {
	family: string;
	total: number;
	satisfied: number;
	inconclusive: number;
	failed: number;
	noEvidence: number;
	pct: number;
};

export type RiskControl = {
	control_id: string;
	finding_id?: string;
	name: string;
	source_framework: string;
	verdict: string;
	grade: string;
	question: string;
	mapped_controls?: string[];
	projection_fingerprint?: string;
	requirement_revision_id?: string;
	engineering_qra_family_id?: string;
	review_state?: string;
	accepted?: boolean;
	quarantine_state?: string;
	grounded_credit?: number;
	compliance_credit?: number;
};

export type BrokenTrace = {
	trace: string;
	defect: string;
	impact: string;
	fix: string;
};

export type ClaimReview = {
	question: string;
	verdict: string;
	grade: string;
	gates: string;
	controls: string[];
	gate_summary: string;
};

export type PostureTab = {
	postureScore: number;
	complianceScore: number;
	criticalFindings: number;
	openFindings: number;
	evidenceFreshness: number;
	totalCases: number;
	frameworks: Framework[];
	families: Family[];
	riskControls: RiskControl[];
	f36Projection?: F36ProjectionSummary;
};

export type TraceabilityTab = {
	traceabilityScore: number;
	mappedRequirements: number;
	orphanRequirements: number;
	totalControls: number;
	controlsWithEvidence: number;
	controlsWithRelationships: number;
	relationshipTypes: Record<string, number>;
	totalRelationships: number;
	coverageChain: { reqToControl: number; controlToRel: number; controlToEvidence: number };
	brokenTraces: BrokenTrace[];
};

export type AssuranceTab = {
	assuranceScore: number;
	supportedClaims: number;
	partialClaims: number;
	unsupportedClaims: number;
	contradictions: number;
	totalClaims: number;
	evidenceQuality: {
		gatePassRate: number;
		freshness: number;
		completeness: number;
		authority: number;
	};
	claimsNeedingReview: ClaimReview[];
};

export type PostureV2Data = {
	posture: PostureTab;
	traceability: TraceabilityTab;
	assurance: AssuranceTab;
	projection_fingerprint?: string;
};

type UsePostureV2Result = PostureV2Data & {
	loading: boolean;
	error: string | null;
};

const emptyData: PostureV2Data = {
	posture: {
		postureScore: 0,
		complianceScore: 0,
		criticalFindings: 0,
		openFindings: 0,
		evidenceFreshness: 0,
		totalCases: 0,
		frameworks: [],
		families: [],
		riskControls: [],
	},
	traceability: {
		traceabilityScore: 0,
		mappedRequirements: 0,
		orphanRequirements: 0,
		totalControls: 0,
		controlsWithEvidence: 0,
		controlsWithRelationships: 0,
		relationshipTypes: {},
		totalRelationships: 0,
		coverageChain: { reqToControl: 0, controlToRel: 0, controlToEvidence: 0 },
		brokenTraces: [],
	},
	assurance: {
		assuranceScore: 0,
		supportedClaims: 0,
		partialClaims: 0,
		unsupportedClaims: 0,
		contradictions: 0,
		totalClaims: 0,
		evidenceQuality: { gatePassRate: 0, freshness: 0, completeness: 0, authority: 0 },
		claimsNeedingReview: [],
	},
};

export function useF36ExplorerProjection(): {
	projection: F36ExplorerProjection | null;
	loading: boolean;
	error: string | null;
} {
	const [projection, setProjection] = useState<F36ExplorerProjection | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		void fetch("/api/f36/explorer-projection", { cache: "no-store" })
			.then(async (res) => {
				if (!res.ok) throw new Error(`F36 projection failed: ${res.status}`);
				return (await res.json()) as F36ExplorerProjection;
			})
			.then((value) => {
				if (!cancelled) setProjection(value);
			})
			.catch((reason) => {
				if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => { cancelled = true; };
	}, []);

	return { projection, loading, error };
}

export function usePostureData(): UsePostureV2Result {
	const [data, setData] = useState<PostureV2Data>(emptyData);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		const fetchData = async () => {
			setLoading(true);
			setError(null);
			try {
				const [postureRes, projectionRes] = await Promise.all([
					fetch("/api/posture/v2", { cache: "no-store" }),
					fetch("/api/f36/explorer-projection", { cache: "no-store" }),
				]);
				if (!postureRes.ok) throw new Error(`Posture V2 failed: ${postureRes.status}`);
				if (!projectionRes.ok) throw new Error(`F36 projection failed: ${projectionRes.status}`);
				const postureJson = (await postureRes.json()) as PostureV2Data;
				const projection = (await projectionRes.json()) as F36ExplorerProjection;
				if (postureJson.projection_fingerprint !== projection.projection_fingerprint) {
					throw new Error("Posture and F36 projection fingerprints differ");
				}
				postureJson.posture.f36Projection = projection;
				if (!cancelled) setData(postureJson);
			} catch (e) {
				if (!cancelled) {
					setError(e instanceof Error ? e.message : "Failed to load posture data");
					setData(emptyData);
				}
			} finally {
				if (!cancelled) setLoading(false);
			}
		};
		void fetchData();
		return () => {
			cancelled = true;
		};
	}, []);

	return { loading, error, ...data };
}

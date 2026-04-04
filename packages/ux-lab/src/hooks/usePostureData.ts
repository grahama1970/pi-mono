import { useEffect, useState } from "react";

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
	name: string;
	source_framework: string;
	verdict: string;
	grade: string;
	question: string;
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
				const res = await fetch("/api/posture/v2");
				if (!res.ok) throw new Error(`Posture V2 failed: ${res.status}`);
				const json = (await res.json()) as PostureV2Data;
				if (!cancelled) setData(json);
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

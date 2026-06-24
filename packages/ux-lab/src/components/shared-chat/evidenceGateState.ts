import type { EvidenceCaseData } from "./types";

export type GateAuditStatus = "pass" | "blocked" | "pending_review" | "fail";

export interface NormalizedGate {
	gate: string;
	passed: boolean;
	detail: string;
	status: GateAuditStatus;
}

export interface EvidenceGateSummary {
	total: number;
	passed: number;
	blocked: number;
	pendingReview: number;
	failed: number;
	unresolved: number;
	gates: NormalizedGate[];
	blockedNames: string[];
	pendingReviewNames: string[];
	disclosureLabel: string;
	remediationSteps: string[];
	primaryRemediationAction: string;
	isMockArtifact: boolean;
}

type RawGate = { gate?: string; name?: string; passed?: boolean; detail?: string };

function gateName(gate: RawGate): string {
	return String(gate.gate ?? gate.name ?? "gate")
		.replace(/_/g, " ")
		.trim();
}

function classifyGateStatus(gate: RawGate): GateAuditStatus {
	if (gate.passed) return "pass";
	const name = gateName(gate).toLowerCase();
	const detail = String(gate.detail ?? "").toLowerCase();
	if (/reject|rejected|not satisfied|failed evaluation/.test(name) || /rejected|not satisfied/.test(detail)) {
		return "fail";
	}
	if (
		/reviewer|approval|human review|signoff|sign-off/.test(name) ||
		/approval pending|awaiting approval|reviewer/.test(detail)
	) {
		return "pending_review";
	}
	return "blocked";
}

function normalizeGate(gate: RawGate): NormalizedGate {
	const name = gateName(gate);
	return {
		gate: name,
		passed: Boolean(gate.passed),
		detail: String(gate.detail ?? ""),
		status: classifyGateStatus(gate),
	};
}

export function isMockEvidenceArtifact(evidence?: EvidenceCaseData | null): boolean {
	const hash = String(evidence?.artifact_hash ?? evidence?.artifact?.sha256 ?? "");
	const trace = String(evidence?.trace_state ?? "").toLowerCase();
	return /mock|demo|pending/i.test(hash) || trace === "pending";
}

export function summarizeEvidenceGates(
	evidence?: EvidenceCaseData | null,
	rawGates?: RawGate[] | null,
): EvidenceGateSummary {
	const gates = (rawGates ?? evidence?.gate_trace ?? evidence?.metadata?.gate_trace ?? []).map(normalizeGate);
	const total = evidence?.gates_total || gates.length;
	const passed = evidence?.gates_passed ?? gates.filter((g) => g.status === "pass").length;
	const blocked = gates.filter((g) => g.status === "blocked").length;
	const pendingReview = gates.filter((g) => g.status === "pending_review").length;
	const failed = gates.filter((g) => g.status === "fail").length;
	const unresolved = blocked + pendingReview + failed;
	const blockedNames = gates.filter((g) => g.status === "blocked").map((g) => g.gate);
	const pendingReviewNames = gates.filter((g) => g.status === "pending_review").map((g) => g.gate);

	const parts: string[] = [`${passed}/${total} gates`];
	if (blocked > 0) parts.push(`${blocked} blocked`);
	if (pendingReview > 0) parts.push(`${pendingReview} pending review`);
	if (failed > 0) parts.push(`${failed} fail`);
	const nameParts = [...blockedNames, ...pendingReviewNames].slice(0, 2);
	const suffix = nameParts.length ? `: ${nameParts.join(", ")}` : "";
	const disclosureLabel =
		unresolved > 0
			? `Show evidence case — ${parts.join(", ")}${suffix}`
			: evidence?.gate_summary
				? `Show evidence case — ${evidence.gate_summary}`
				: "Show evidence case";

	const remediationSteps: string[] = [];
	if (isMockEvidenceArtifact(evidence)) remediationSteps.push("Replace mock/demo source hash");
	if (blockedNames.some((n) => /provenance|source-page|binding/.test(n.toLowerCase()))) {
		remediationSteps.push("Bind source-page provenance");
	}
	if (pendingReview > 0 || String(evidence?.human_review_state ?? "").toLowerCase() !== "approved") {
		remediationSteps.push("Request reviewer approval");
	}
	const primaryRemediationAction = remediationSteps[0] ?? "Resolve blockers";

	return {
		total,
		passed,
		blocked,
		pendingReview,
		failed,
		unresolved,
		gates,
		blockedNames,
		pendingReviewNames,
		disclosureLabel,
		remediationSteps,
		primaryRemediationAction,
		isMockArtifact: isMockEvidenceArtifact(evidence),
	};
}

export function gateStatusLabel(status: GateAuditStatus): string {
	if (status === "pass") return "PASS";
	if (status === "blocked") return "BLOCKED";
	if (status === "pending_review") return "PENDING REVIEW";
	return "FAIL";
}

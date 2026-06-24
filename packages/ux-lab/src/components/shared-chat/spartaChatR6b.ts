import type { Artifact, ChatMessage, EvidenceCaseData, ReasoningStep } from "./types";

export const R6B_DEMO_CASE_ID = "EC-FPGA-CMMC-042";
export const R6B_DEMO_FIGURE_ID = "FIG-FPGA-CROSSWALK-001";
export const R6B_DEMO_TABLE_ID = "TBL-FPGA-CMMC-CONTROLS-001";
export const R6B_DEMO_THREAT_MAP_ID = "FIG-F36-THREAT-MAP-001";

export const R6B_DEMO_USER_FIGURE_QUERY = "Can you show me a figure of the FPGA vendor attestation crosswalk?";

export const R6B_DEMO_USER_TABLE_QUERY =
	"Good. Now add a table of the SPARTA controls and CMMC Level 3 practices that apply.";

export const R6B_DEMO_USER_THREAT_MAP_QUERY = "Can you show me the current F-36 threat map image?";

/** Combined ask (single-turn demos / tests). */
export const R6B_DEMO_USER_QUERY = `${R6B_DEMO_USER_FIGURE_QUERY} ${R6B_DEMO_USER_TABLE_QUERY.replace("Good. Now ", "Then ")}`;

export const R6B_DEMO_ASSISTANT_FIGURE_REPLY =
	"Sure — here is the FPGA vendor attestation crosswalk for third-party suppliers.";

export const R6B_DEMO_ASSISTANT_TABLE_REPLY =
	"Certainly! Here are the candidate control mappings. I cannot issue a bound compliance answer yet — source-page provenance is still pending and reviewer approval is queued.";

export const R6B_DEMO_ASSISTANT_THREAT_MAP_REPLY = "Hot cells cluster on supply-chain ingress and avionics execution.";

export const R6B_DEMO_FIGURE_REASONING: ReasoningStep[] = [
	{
		id: "extract_entities",
		type: "skill",
		skill: "extract-entities",
		status: "done",
		summary: "/extract-entities",
		detail: "Resolved FPGA, vendor attestation, and CMMC spans.",
	},
	{
		id: "create_figure",
		type: "skill",
		skill: "create-figure",
		status: "done",
		summary: "/create-figure",
		detail: "Rendered supplier provenance crosswalk thumbnail.",
	},
];

export const R6B_DEMO_TABLE_REASONING: ReasoningStep[] = [
	{
		id: "extract_entities",
		type: "skill",
		skill: "extract-entities",
		status: "done",
		summary: "/extract-entities",
		detail: "Resolved SPARTA controls and CMMC Level 3 practices.",
	},
	{
		id: "memory_recall",
		type: "skill",
		skill: "memory",
		status: "done",
		summary: "/memory recall",
		detail: "Recalled candidate control mappings from graph memory.",
	},
	{
		id: "evidence_case",
		type: "skill",
		skill: "create-evidence-case",
		status: "done",
		summary: "/create-evidence-case",
		detail: "Built CAE tree with 4/6 gates passing.",
	},
	{
		id: "source_provenance",
		type: "text",
		status: "failed",
		summary: "source-page provenance",
		detail: "Mock/demo hash blocks audit binding.",
	},
	{
		id: "reviewer_approval",
		type: "text",
		status: "failed",
		summary: "reviewer approval",
		detail: "Compliance officer approval pending.",
	},
];

export const R6B_DEMO_THREAT_MAP_REASONING: ReasoningStep[] = [
	{
		id: "extract_entities",
		type: "skill",
		skill: "extract-entities",
		status: "done",
		summary: "/extract-entities",
		detail: "Resolved F-36 platform and ATT&CK tactic spans.",
	},
	{
		id: "memory_recall",
		type: "skill",
		skill: "memory",
		status: "done",
		summary: "/memory recall",
		detail: "Loaded current threat exposure overlay from SPARTA graph.",
	},
	{
		id: "create_figure",
		type: "skill",
		skill: "create-figure",
		status: "done",
		summary: "/create-figure",
		detail: "Rendered heatmap snapshot and tactic graph for workspace drill-down.",
	},
];

const THREAT_MAP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="168" viewBox="0 0 560 168" role="img" aria-label="F-36 threat map heatmap">
  <rect width="560" height="168" fill="transparent"/>
  <text x="16" y="22" fill="#e2e8f0" font-family="system-ui,sans-serif" font-size="12" font-weight="600">F-36 threat map · current snapshot</text>
  <text x="16" y="38" fill="#94a3b8" font-family="system-ui,sans-serif" font-size="10">Tactics × attack surfaces (SPARTA + ATT&amp;CK mobile overlay)</text>
  <g transform="translate(16,48)">
    <text x="0" y="10" fill="#64748b" font-size="9" font-family="monospace">Initial Access</text>
    <text x="0" y="34" fill="#64748b" font-size="9" font-family="monospace">Execution</text>
    <text x="0" y="58" fill="#64748b" font-size="9" font-family="monospace">Persistence</text>
    <text x="0" y="82" fill="#64748b" font-size="9" font-family="monospace">Exfiltration</text>
    <text x="92" y="-4" fill="#64748b" font-size="9" font-family="monospace">Avionics</text>
    <text x="152" y="-4" fill="#64748b" font-size="9" font-family="monospace">GSE</text>
    <text x="200" y="-4" fill="#64748b" font-size="9" font-family="monospace">Supply</text>
    <text x="260" y="-4" fill="#64748b" font-size="9" font-family="monospace">Maint</text>
    <text x="320" y="-4" fill="#64748b" font-size="9" font-family="monospace">Comms</text>
    <rect x="88" y="0" width="44" height="16" rx="3" fill="#7f1d1d"/><rect x="136" y="0" width="44" height="16" rx="3" fill="#b45309"/>
    <rect x="184" y="0" width="44" height="16" rx="3" fill="#dc2626"/><rect x="232" y="0" width="44" height="16" rx="3" fill="#b45309"/>
    <rect x="280" y="0" width="44" height="16" rx="3" fill="#ca8a04"/><rect x="328" y="0" width="44" height="16" rx="3" fill="#854d0e"/>
    <rect x="88" y="24" width="44" height="16" rx="3" fill="#b45309"/><rect x="136" y="24" width="44" height="16" rx="3" fill="#dc2626"/>
    <rect x="184" y="24" width="44" height="16" rx="3" fill="#b45309"/><rect x="232" y="24" width="44" height="16" rx="3" fill="#7f1d1d"/>
    <rect x="280" y="24" width="44" height="16" rx="3" fill="#ca8a04"/><rect x="328" y="24" width="44" height="16" rx="3" fill="#b45309"/>
    <rect x="88" y="48" width="44" height="16" rx="3" fill="#ca8a04"/><rect x="136" y="48" width="44" height="16" rx="3" fill="#b45309"/>
    <rect x="184" y="48" width="44" height="16" rx="3" fill="#dc2626"/><rect x="232" y="48" width="44" height="16" rx="3" fill="#b45309"/>
    <rect x="280" y="48" width="44" height="16" rx="3" fill="#854d0e"/><rect x="328" y="48" width="44" height="16" rx="3" fill="#ca8a04"/>
    <rect x="88" y="72" width="44" height="16" rx="3" fill="#7f1d1d"/><rect x="136" y="72" width="44" height="16" rx="3" fill="#ca8a04"/>
    <rect x="184" y="72" width="44" height="16" rx="3" fill="#b45309"/><rect x="232" y="72" width="44" height="16" rx="3" fill="#ca8a04"/>
    <rect x="280" y="72" width="44" height="16" rx="3" fill="#b45309"/><rect x="328" y="72" width="44" height="16" rx="3" fill="#dc2626"/>
  </g>
  <text x="16" y="156" fill="#f59e0b" font-family="system-ui,sans-serif" font-size="10">Hot cells: supply-chain ingress + avionics execution paths · refreshed 2026-06-07</text>
</svg>`;

const THREAT_MAP_TEASER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="112" viewBox="0 4 560 108" role="img" aria-label="F-36 threat heatmap preview">
  <g transform="translate(20,52)">
    <text x="0" y="8" fill="#cbd5e1" font-size="10" font-family="system-ui,sans-serif" font-weight="600">Initial Access</text>
    <text x="0" y="32" fill="#cbd5e1" font-size="10" font-family="system-ui,sans-serif" font-weight="600">Execution</text>
    <text x="0" y="56" fill="#cbd5e1" font-size="10" font-family="system-ui,sans-serif" font-weight="600">Persistence</text>
    <text x="0" y="80" fill="#cbd5e1" font-size="10" font-family="system-ui,sans-serif" font-weight="600">Exfiltration</text>
    <text x="96" y="-6" fill="#94a3b8" font-size="10" font-family="system-ui,sans-serif" font-weight="600">Avionics</text>
    <text x="152" y="-6" fill="#94a3b8" font-size="10" font-family="system-ui,sans-serif" font-weight="600">GSE</text>
    <text x="200" y="-6" fill="#94a3b8" font-size="10" font-family="system-ui,sans-serif" font-weight="600">Supply</text>
    <text x="256" y="-6" fill="#94a3b8" font-size="10" font-family="system-ui,sans-serif" font-weight="600">Maint</text>
    <text x="312" y="-6" fill="#94a3b8" font-size="10" font-family="system-ui,sans-serif" font-weight="600">Comms</text>
    <rect x="92" y="0" width="36" height="14" rx="2" fill="#7f1d1d"/><rect x="136" y="0" width="36" height="14" rx="2" fill="#b45309"/>
    <rect x="180" y="0" width="36" height="14" rx="2" fill="#dc2626"/><rect x="224" y="0" width="36" height="14" rx="2" fill="#b45309"/>
    <rect x="268" y="0" width="36" height="14" rx="2" fill="#ca8a04"/><rect x="312" y="0" width="36" height="14" rx="2" fill="#854d0e"/>
    <rect x="92" y="24" width="36" height="14" rx="2" fill="#b45309"/><rect x="136" y="24" width="36" height="14" rx="2" fill="#dc2626"/>
    <rect x="180" y="24" width="36" height="14" rx="2" fill="#b45309"/><rect x="224" y="24" width="36" height="14" rx="2" fill="#7f1d1d"/>
    <rect x="268" y="24" width="36" height="14" rx="2" fill="#ca8a04"/><rect x="312" y="24" width="36" height="14" rx="2" fill="#b45309"/>
    <rect x="92" y="48" width="36" height="14" rx="2" fill="#ca8a04"/><rect x="136" y="48" width="36" height="14" rx="2" fill="#b45309"/>
    <rect x="180" y="48" width="36" height="14" rx="2" fill="#dc2626"/><rect x="224" y="48" width="36" height="14" rx="2" fill="#b45309"/>
    <rect x="268" y="48" width="36" height="14" rx="2" fill="#854d0e"/><rect x="312" y="48" width="36" height="14" rx="2" fill="#ca8a04"/>
    <rect x="92" y="72" width="36" height="14" rx="2" fill="#7f1d1d"/><rect x="136" y="72" width="36" height="14" rx="2" fill="#ca8a04"/>
    <rect x="180" y="72" width="36" height="14" rx="2" fill="#b45309"/><rect x="224" y="72" width="36" height="14" rx="2" fill="#ca8a04"/>
    <rect x="268" y="72" width="36" height="14" rx="2" fill="#b45309"/><rect x="312" y="72" width="36" height="14" rx="2" fill="#dc2626"/>
  </g>
</svg>`;

const FIGURE_THUMB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="108" viewBox="0 0 560 108" role="img" aria-label="FPGA vendor crosswalk">
  <rect width="560" height="108" fill="transparent"/>
  <rect x="16" y="16" width="108" height="40" rx="6" fill="#1e3a5f"/>
  <text x="70" y="41" fill="#e2e8f0" font-family="system-ui,sans-serif" font-size="11" text-anchor="middle">Vendor attestation</text>
  <path d="M124 36h24"/>
  <rect x="148" y="16" width="108" height="40" rx="6" fill="#1e3a5f"/>
  <text x="202" y="41" fill="#e2e8f0" font-family="system-ui,sans-serif" font-size="11" text-anchor="middle">SBOM freshness</text>
  <path d="M256 36h24"/>
  <rect x="280" y="16" width="108" height="40" rx="6" fill="#1e3a5f"/>
  <text x="334" y="41" fill="#e2e8f0" font-family="system-ui,sans-serif" font-size="11" text-anchor="middle">Source hash</text>
  <path d="M388 36h24"/>
  <rect x="412" y="16" width="108" height="40" rx="6" fill="#3a1414"/>
  <text x="466" y="41" fill="#f28b82" font-family="system-ui,sans-serif" font-size="11" text-anchor="middle">Reviewer approval</text>
</svg>`;

export function buildR6bFigureArtifact(caseId: string = R6B_DEMO_CASE_ID): Artifact {
	return {
		id: R6B_DEMO_FIGURE_ID,
		title: "FPGA supplier provenance crosswalk",
		type: "figure",
		content: FIGURE_THUMB_SVG,
		code: FIGURE_THUMB_SVG,
		sourceSkill: "/create-figure",
		caseId,
		sampleDerived: true,
		provenanceState: "sample-derived",
		caption: "FPGA vendor attestation crosswalk",
		figureSpec: {
			title: "FPGA supplier provenance crosswalk",
			caption:
				"Figure illustrates how vendor attestation, SBOM freshness, source excerpt, and reviewer approval gate the CMMC Level 3 answer.",
		},
		preview: { kind: "svg", content: FIGURE_THUMB_SVG },
	};
}

export function buildR6bTableArtifact(caseId: string = R6B_DEMO_CASE_ID): Artifact {
	return {
		id: R6B_DEMO_TABLE_ID,
		title: "SPARTA controls × CMMC Level 3 practices",
		sectionHeading: "SPARTA controls × CMMC Level 3 practices",
		sectionIntro:
			"Candidate mappings recalled from SPARTA for third-party FPGA vendors. Provenance binding on the source excerpt is still pending.",
		type: "react-table",
		content: "FPGA supply-chain control crosswalk",
		sourceSkill: "/create-table",
		caseId,
		sampleDerived: true,
		provenanceState: "sample-derived",
		caption: undefined,
		data: {
			columns: [
				{ key: "control", label: "SPARTA control" },
				{ key: "cmmc", label: "CMMC L3 practice" },
				{ key: "status", label: "Evidence status" },
			],
			rows: [
				{ control: "SCRM-1", cmmc: "3.9.1 — Risk management", status: "Candidate · provenance pending" },
				{ control: "SBOM-2", cmmc: "3.4.3 — Configuration management", status: "Candidate · provenance pending" },
				{ control: "IA-5", cmmc: "3.5.2 — Authenticator management", status: "Partial · reviewer queued" },
				{ control: "CM-8", cmmc: "3.4.1 — System inventory", status: "Candidate · provenance pending" },
				{ control: "AC-2", cmmc: "3.1.1 — Account management", status: "Candidate · provenance pending" },
				{ control: "AC-3", cmmc: "3.1.2 — Access enforcement", status: "Candidate · provenance pending" },
				{ control: "AU-2", cmmc: "3.3.1 — Audit events", status: "Partial · reviewer queued" },
				{ control: "IR-4", cmmc: "3.6.1 — Incident handling", status: "Candidate · provenance pending" },
				{ control: "RA-5", cmmc: "3.11.2 — Vulnerability scanning", status: "Candidate · provenance pending" },
				{ control: "SI-2", cmmc: "3.14.1 — Flaw remediation", status: "Candidate · provenance pending" },
				{ control: "SC-7", cmmc: "3.13.1 — Boundary protection", status: "Candidate · provenance pending" },
				{ control: "MP-5", cmmc: "3.8.3 — Media sanitization", status: "Candidate · provenance pending" },
			],
		},
	};
}

const THREAT_MAP_GRAPH = {
	nodes: [
		{ id: "tactic:initial-access", label: "Initial Access", group: "tactic" },
		{ id: "tactic:execution", label: "Execution", group: "tactic" },
		{ id: "tactic:persistence", label: "Persistence", group: "tactic" },
		{ id: "tactic:exfiltration", label: "Exfiltration", group: "tactic" },
		{ id: "platform:avionics", label: "Avionics", group: "platform" },
		{ id: "platform:gse", label: "GSE", group: "platform" },
		{ id: "platform:supply", label: "Supply chain", group: "platform" },
		{ id: "platform:maint", label: "Maintenance", group: "platform" },
		{ id: "platform:comms", label: "Comms", group: "platform" },
	],
	edges: [
		{ source: "tactic:initial-access", target: "platform:supply", label: "elevated" },
		{ source: "tactic:initial-access", target: "platform:avionics", label: "watch" },
		{ source: "tactic:execution", target: "platform:avionics", label: "elevated" },
		{ source: "tactic:execution", target: "platform:gse", label: "elevated" },
		{ source: "tactic:persistence", target: "platform:supply", label: "elevated" },
		{ source: "tactic:persistence", target: "platform:maint", label: "watch" },
		{ source: "tactic:exfiltration", target: "platform:comms", label: "elevated" },
		{ source: "tactic:exfiltration", target: "platform:supply", label: "watch" },
	],
};

export function buildR6bThreatMapArtifact(caseId: string = R6B_DEMO_CASE_ID): Artifact {
	return {
		id: R6B_DEMO_THREAT_MAP_ID,
		title: "F-36 threat map (current snapshot)",
		type: "graph",
		content: THREAT_MAP_SVG,
		code: THREAT_MAP_SVG,
		sourceSkill: "/create-figure",
		caseId,
		sampleDerived: true,
		provenanceState: "sample-derived",
		caption: "F-36 threat map heatmap",
		figureSpec: {
			title: "F-36 threat map (current snapshot)",
			caption:
				"Tactics × platform heatmap from the live SPARTA graph. Red = elevated exposure, amber = watch, yellow = monitored.",
		},
		preview: { kind: "svg", content: THREAT_MAP_TEASER_SVG },
		refreshedAt: "2026-06-07",
		data: THREAT_MAP_GRAPH,
	};
}

export function deriveAnswerState(evidence?: EvidenceCaseData): "bound" | "clarify" | "deflect" {
	const action = String(evidence?.response_action ?? "").toLowerCase();
	if (action === "deflect") return "deflect";
	if (action === "answer" && evidence?.human_review_state === "approved") return "bound";
	if (action === "answer") return "clarify";
	return action === "clarify" ? "clarify" : "clarify";
}

export function deriveAskTry(evidence?: EvidenceCaseData): { askPrompts: string[]; tryPrompts: string[] } {
	const caseId = evidence?.case_id ?? R6B_DEMO_CASE_ID;
	const hash = String(evidence?.artifact_hash ?? "");
	const mock = /mock|demo/i.test(hash);
	return {
		askPrompts: mock
			? [`Open trace for ${caseId}.`, "Show missing proof for source-page provenance."]
			: [`What evidence supports ${caseId}?`],
		tryPrompts: mock
			? ["Bind the source-page excerpt for Quarterly_Report.pdf.", "Open artifact.", "Show missing proof."]
			: ["Open trace.", "Open artifact."],
	};
}

export function enrichMessageForReceiptChat(msg: ChatMessage): ChatMessage {
	if (!msg.evidenceCase) return msg;
	// Keep artifacts on the message for workspace/artifact pane — not rendered inline in lean-in chat.
	const baseArtifacts = msg.artifacts?.length
		? [...msg.artifacts]
		: [buildR6bFigureArtifact(msg.evidenceCase.case_id), buildR6bTableArtifact(msg.evidenceCase.case_id)];
	if (!baseArtifacts.some((a) => a.id === R6B_DEMO_TABLE_ID)) {
		baseArtifacts.push(buildR6bTableArtifact(msg.evidenceCase.case_id));
	}
	const artifacts = baseArtifacts;
	return {
		...msg,
		artifacts,
		answerState: msg.answerState ?? deriveAnswerState(msg.evidenceCase),
		askPrompts: undefined,
		tryPrompts: undefined,
	};
}

export function buildR6bDemoEvidenceCase(): EvidenceCaseData {
	return {
		case_id: R6B_DEMO_CASE_ID,
		qraKey: "QRA-FPGA-CMMC-042",
		verdict: "inconclusive",
		grade: "C",
		gates_passed: 4,
		gates_total: 6,
		gate_summary: "4/6 gates",
		gate_trace: [
			{ gate: "entity grounding", passed: true, detail: "F-36 / CMMC / FPGA entities resolved." },
			{ gate: "memory recall", passed: true, detail: "SPARTA controls recalled." },
			{ gate: "CAE tree", passed: true, detail: "Claims tree constructed." },
			{ gate: "citations", passed: true, detail: "Candidate citations present." },
			{ gate: "source-page provenance", passed: false, detail: "Mock/demo hash blocks audit binding." },
			{ gate: "reviewer approval", passed: false, detail: "Compliance officer approval pending." },
		],
		control_ids: ["SCRM", "SBOM", "CMMC-L3"],
		tier: "deterministic",
		question: R6B_DEMO_USER_TABLE_QUERY,
		spans: [
			{
				text: "SPARTA",
				span: [29, 35],
				kind: "phrase",
				framework: "SPARTA",
				name: "SPARTA controls",
				grounded_to_framework: true,
			},
			{
				text: "CMMC Level 3",
				span: [49, 61],
				kind: "phrase",
				framework: "CMMC",
				name: "CMMC Level 3 practices",
				grounded_to_framework: true,
			},
		],
		bound_artifact: "Quarterly_Report.pdf",
		artifact_hash: "demo-mock-6b9f-3c2a-f36-fpga",
		response_action: "clarify",
		trace_state: "pending",
		blocker_reason: "source-page provenance missing",
		human_review_state: "queued",
		claims: [
			"Candidate SPARTA supply-chain controls exist for third-party FPGA vendors.",
			"Quarterly_Report.pdf is labeled but hash is mock/demo.",
		],
		citations: ["Quarterly_Report.pdf pp. 12–14"],
		glossary: [
			{
				term: "CWE-119",
				type: "cwe_weakness",
				definition: "Buffer overflow — FPGA bitstream parsing attack surface.",
			},
			{
				term: "CWE-120",
				type: "cwe_weakness",
				definition: "Classic buffer overflow in embedded supply-chain tooling.",
			},
			{
				term: "CWE-787",
				type: "cwe_weakness",
				definition: "Out-of-bounds write — vendor attestation pipeline risk.",
			},
			{ term: "SCRM", type: "control", definition: "Supply chain risk management control family." },
		],
		answer: R6B_DEMO_ASSISTANT_TABLE_REPLY,
	};
}

/** @deprecated use enrichMessageForReceiptChat */
export const enrichMessageForLeanIn = enrichMessageForReceiptChat;

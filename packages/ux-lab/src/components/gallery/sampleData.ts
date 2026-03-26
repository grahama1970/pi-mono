import type { ControlDetailData } from "../sparta/detail/ControlDetail";
import type { GraphEdge, GraphNode } from "../sparta/lemma-graph/LemmaGraph";
import type { ChatMessage } from "../sparta/query/ChatWell";
import type { ControlRow } from "../sparta/tables/ControlTable";
import type { ThreatTechnique } from "../sparta/threat-map/ThreatMap";

/* ───── Threat Map ───── */

export const sampleTactics = [
	"Reconnaissance",
	"Initial Access",
	"Execution",
	"Persistence",
	"Privilege Escalation",
	"Defense Evasion",
	"Collection",
	"Exfiltration",
	"Impact",
];

export const sampleTechniques: ThreatTechnique[] = [
	{
		id: "REC-0001",
		name: "Active Scanning",
		tactic: "Reconnaissance",
		coverage: "full",
		issueCount: 0,
		frameworks: ["ATT&CK", "D3FEND"],
	},
	{
		id: "REC-0002",
		name: "Gather Victim Info",
		tactic: "Reconnaissance",
		coverage: "full",
		issueCount: 0,
		frameworks: ["ATT&CK"],
	},
	{
		id: "REC-0003",
		name: "Search Open Sources",
		tactic: "Reconnaissance",
		coverage: "partial",
		issueCount: 1,
		frameworks: ["ATT&CK"],
	},
	{
		id: "IA-0001",
		name: "Supply Chain Compromise",
		tactic: "Initial Access",
		coverage: "full",
		issueCount: 0,
		frameworks: ["ATT&CK", "NIST"],
	},
	{
		id: "IA-0002",
		name: "Exploit Public App",
		tactic: "Initial Access",
		coverage: "none",
		issueCount: 2,
		frameworks: ["ATT&CK"],
	},
	{
		id: "IA-0003",
		name: "Trusted Relationship",
		tactic: "Initial Access",
		coverage: "partial",
		issueCount: 0,
		frameworks: ["NIST"],
	},
	{
		id: "EX-0001",
		name: "Command & Scripting",
		tactic: "Execution",
		coverage: "full",
		issueCount: 0,
		frameworks: ["ATT&CK", "D3FEND", "CWE"],
	},
	{
		id: "EX-0002",
		name: "Software Deployment",
		tactic: "Execution",
		coverage: "unknown",
		issueCount: 0,
		frameworks: [],
	},
	{
		id: "EX-0003",
		name: "Ground Segment Exploit",
		tactic: "Execution",
		coverage: "partial",
		issueCount: 1,
		frameworks: ["ATT&CK"],
	},
	{
		id: "P-0001",
		name: "Account Manipulation",
		tactic: "Persistence",
		coverage: "full",
		issueCount: 0,
		frameworks: ["ATT&CK", "NIST"],
	},
	{
		id: "P-0002",
		name: "Boot Persistence",
		tactic: "Persistence",
		coverage: "partial",
		issueCount: 0,
		frameworks: ["CWE"],
	},
	{
		id: "PE-0001",
		name: "Exploitation for Privesc",
		tactic: "Privilege Escalation",
		coverage: "full",
		issueCount: 0,
		frameworks: ["ATT&CK", "D3FEND"],
	},
	{
		id: "PE-0002",
		name: "Valid Accounts",
		tactic: "Privilege Escalation",
		coverage: "none",
		issueCount: 3,
		frameworks: ["NIST"],
	},
	{
		id: "DE-0001",
		name: "Obfuscated Files",
		tactic: "Defense Evasion",
		coverage: "full",
		issueCount: 0,
		frameworks: ["ATT&CK"],
	},
	{
		id: "DE-0002",
		name: "Masquerading",
		tactic: "Defense Evasion",
		coverage: "partial",
		issueCount: 0,
		frameworks: ["D3FEND"],
	},
	{
		id: "C-0001",
		name: "Data from Local System",
		tactic: "Collection",
		coverage: "full",
		issueCount: 0,
		frameworks: ["ATT&CK", "NIST"],
	},
	{ id: "C-0002", name: "Screen Capture", tactic: "Collection", coverage: "unknown", issueCount: 0, frameworks: [] },
	{
		id: "EXF-0001",
		name: "Exfil Over C2",
		tactic: "Exfiltration",
		coverage: "full",
		issueCount: 0,
		frameworks: ["ATT&CK"],
	},
	{
		id: "EXF-0002",
		name: "Exfil Over Alt Protocol",
		tactic: "Exfiltration",
		coverage: "partial",
		issueCount: 1,
		frameworks: ["D3FEND"],
	},
	{
		id: "IMP-0001",
		name: "Data Destruction",
		tactic: "Impact",
		coverage: "full",
		issueCount: 0,
		frameworks: ["ATT&CK", "NIST", "CWE"],
	},
	{
		id: "IMP-0002",
		name: "DoS Space Segment",
		tactic: "Impact",
		coverage: "none",
		issueCount: 2,
		frameworks: ["NIST"],
	},
	{
		id: "IMP-0003",
		name: "Resource Hijacking",
		tactic: "Impact",
		coverage: "full",
		issueCount: 0,
		frameworks: ["ATT&CK"],
	},
];

/* ───── Chat Well ───── */

export const sampleMessages: ChatMessage[] = [
	{
		id: "m1",
		role: "user",
		type: "natural",
		timestamp: Date.now() - 60000,
		content: "Show me SPARTA techniques with no D3FEND countermeasure",
	},
	{
		id: "m2",
		role: "system",
		type: "natural",
		timestamp: Date.now() - 55000,
		resultCount: 14,
		content:
			"Found 14 SPARTA techniques without D3FEND mappings. Top results:\n• IA-0002 Exploit Public App — no D3FEND edge\n• PE-0002 Valid Accounts — NIST only\n• IMP-0002 DoS Space Segment — NIST only\n• EX-0002 Software Deployment — no mappings at all",
	},
	{
		id: "m3",
		role: "user",
		type: "aql",
		timestamp: Date.now() - 30000,
		content:
			'FOR c IN sparta_controls\n  FILTER c.framework == "SPARTA"\n  LET rels = (FOR r IN sparta_relationships FILTER r.source_id == c._key RETURN r)\n  FILTER LENGTH(rels) == 0\n  RETURN { id: c.control_id, name: c.name }',
	},
	{
		id: "m4",
		role: "system",
		type: "aql",
		timestamp: Date.now() - 25000,
		resultCount: 3,
		content:
			'[\n  { "id": "EX-0002", "name": "Software Deployment Tools" },\n  { "id": "C-0002", "name": "Screen Capture" },\n  { "id": "LM-0004", "name": "Lateral Tool Transfer" }\n]',
	},
];

export const emptyMessages: ChatMessage[] = [];

/* ───── Control Table ───── */

export const sampleControls: ControlRow[] = [
	{
		id: "REC-0001",
		framework: "SPARTA",
		name: "Active Scanning of Space Systems",
		tactic: "Reconnaissance",
		urlCount: 5,
		relCount: 8,
		knowledgeChunks: 12,
		issueCount: 0,
	},
	{
		id: "AC-2",
		framework: "NIST",
		name: "Account Management",
		urlCount: 3,
		relCount: 14,
		knowledgeChunks: 8,
		issueCount: 1,
	},
	{
		id: "T1021",
		framework: "ATT&CK",
		name: "Remote Services",
		tactic: "Lateral Movement",
		urlCount: 2,
		relCount: 6,
		knowledgeChunks: 4,
		issueCount: 0,
	},
	{
		id: "D3-PH",
		framework: "D3FEND",
		name: "Platform Hardening",
		urlCount: 4,
		relCount: 11,
		knowledgeChunks: 15,
		issueCount: 0,
	},
	{
		id: "CWE-119",
		framework: "CWE",
		name: "Improper Memory Buffer Operations",
		urlCount: 0,
		relCount: 3,
		knowledgeChunks: 2,
		issueCount: 2,
	},
	{
		id: "EX-0003",
		framework: "SPARTA",
		name: "Ground Segment Exploitation",
		tactic: "Execution",
		urlCount: 3,
		relCount: 5,
		knowledgeChunks: 7,
		issueCount: 1,
	},
	{
		id: "SC-7",
		framework: "NIST",
		name: "Boundary Protection",
		urlCount: 4,
		relCount: 9,
		knowledgeChunks: 11,
		issueCount: 0,
	},
	{
		id: "T1190",
		framework: "ATT&CK",
		name: "Exploit Public-Facing Application",
		tactic: "Initial Access",
		urlCount: 3,
		relCount: 7,
		knowledgeChunks: 5,
		issueCount: 0,
	},
	{
		id: "IMP-0002",
		framework: "SPARTA",
		name: "DoS Space Segment",
		tactic: "Impact",
		urlCount: 6,
		relCount: 7,
		knowledgeChunks: 9,
		issueCount: 2,
	},
	{
		id: "IA-2",
		framework: "NIST",
		name: "Identification and Authentication",
		urlCount: 2,
		relCount: 8,
		knowledgeChunks: 6,
		issueCount: 0,
	},
	{
		id: "D3-AL",
		framework: "D3FEND",
		name: "Application Layer Defense",
		urlCount: 3,
		relCount: 5,
		knowledgeChunks: 8,
		issueCount: 0,
	},
	{
		id: "CWE-787",
		framework: "CWE",
		name: "Out-of-bounds Write",
		urlCount: 0,
		relCount: 2,
		knowledgeChunks: 3,
		issueCount: 0,
	},
];

/* ───── Lemma Graph ───── */

export const sampleGraphNodes: GraphNode[] = [
	// SPARTA techniques — Brandon: source traceability, Rob: proof status
	{
		id: "REC-0001",
		label: "Active Scanning",
		framework: "SPARTA",
		size: 1.2,
		proofStatus: "proved",
		sourceCount: 8,
		confidence: 0.92,
	},
	{
		id: "EX-0003",
		label: "Ground Segment",
		framework: "SPARTA",
		size: 1,
		proofStatus: "partial",
		sourceCount: 3,
		confidence: 0.61,
	},
	{
		id: "IMP-0002",
		label: "DoS Space Segment",
		framework: "SPARTA",
		size: 1.1,
		proofStatus: "sorry",
		sourceCount: 1,
		confidence: 0.34,
	},
	{
		id: "IA-0001",
		label: "Supply Chain",
		framework: "SPARTA",
		size: 1,
		proofStatus: "proved",
		sourceCount: 5,
		confidence: 0.88,
	},
	{
		id: "P-0001",
		label: "Account Manipulation",
		framework: "SPARTA",
		size: 0.9,
		proofStatus: "partial",
		sourceCount: 2,
		confidence: 0.55,
	},
	// ATT&CK techniques — well-documented, high confidence
	{
		id: "T1595",
		label: "Active Scanning",
		framework: "ATT&CK",
		size: 1,
		proofStatus: "proved",
		sourceCount: 12,
		confidence: 0.97,
	},
	{
		id: "T1190",
		label: "Exploit Public App",
		framework: "ATT&CK",
		size: 1,
		proofStatus: "proved",
		sourceCount: 9,
		confidence: 0.94,
	},
	{
		id: "T1021",
		label: "Remote Services",
		framework: "ATT&CK",
		size: 1,
		proofStatus: "sorry",
		sourceCount: 4,
		confidence: 0.42,
	},
	{
		id: "T1195",
		label: "Supply Chain",
		framework: "ATT&CK",
		size: 0.9,
		proofStatus: "partial",
		sourceCount: 6,
		confidence: 0.71,
	},
	// NIST controls — axioms (foundational, no proof needed)
	{
		id: "AC-2",
		label: "Account Mgmt",
		framework: "NIST",
		size: 1.3,
		proofStatus: "axiom",
		sourceCount: 15,
		confidence: 0.99,
	},
	{
		id: "SC-7",
		label: "Boundary Protect",
		framework: "NIST",
		size: 1,
		proofStatus: "axiom",
		sourceCount: 11,
		confidence: 0.96,
	},
	{
		id: "IA-2",
		label: "Identification",
		framework: "NIST",
		size: 1,
		proofStatus: "axiom",
		sourceCount: 9,
		confidence: 0.95,
	},
	{
		id: "SI-4",
		label: "System Monitor",
		framework: "NIST",
		size: 0.9,
		proofStatus: "proved",
		sourceCount: 7,
		confidence: 0.89,
	},
	// D3FEND countermeasures — implementations need proof
	{
		id: "D3-PH",
		label: "Platform Harden",
		framework: "D3FEND",
		size: 1.1,
		proofStatus: "proved",
		sourceCount: 6,
		confidence: 0.85,
	},
	{
		id: "D3-AL",
		label: "App Layer Defense",
		framework: "D3FEND",
		size: 0.9,
		proofStatus: "partial",
		sourceCount: 3,
		confidence: 0.58,
	},
	{
		id: "D3-NI",
		label: "Network Isolation",
		framework: "D3FEND",
		size: 1,
		proofStatus: "sorry",
		sourceCount: 2,
		confidence: 0.39,
	},
	// CWE weaknesses — vulnerability claims need highest scrutiny
	{
		id: "CWE-119",
		label: "Memory Buffer",
		framework: "CWE",
		size: 0.9,
		proofStatus: "proved",
		sourceCount: 14,
		confidence: 0.96,
	},
	{
		id: "CWE-787",
		label: "OOB Write",
		framework: "CWE",
		size: 0.8,
		proofStatus: "partial",
		sourceCount: 4,
		confidence: 0.62,
	},
	{
		id: "CWE-200",
		label: "Info Exposure",
		framework: "CWE",
		size: 0.8,
		proofStatus: "sorry",
		sourceCount: 1,
		confidence: 0.28,
	},
];

export const sampleGraphEdges: GraphEdge[] = [
	// SPARTA→ATT&CK mappings
	{ source: "REC-0001", target: "T1595", method: "maps-to", validated: true },
	{ source: "EX-0003", target: "T1190", method: "maps-to", validated: true },
	{ source: "IA-0001", target: "T1195", method: "maps-to", validated: true },
	{ source: "P-0001", target: "T1021", method: "maps-to", validated: false },
	// ATT&CK→NIST mitigations
	{ source: "T1190", target: "AC-2", method: "mitigated-by", validated: true },
	{ source: "T1595", target: "SI-4", method: "mitigated-by", validated: true },
	{ source: "T1021", target: "IA-2", method: "mitigated-by", validated: true },
	{ source: "T1195", target: "SC-7", method: "mitigated-by", validated: false },
	// NIST→D3FEND implementations
	{ source: "AC-2", target: "D3-PH", method: "implemented-by", validated: true },
	{ source: "SC-7", target: "D3-NI", method: "implemented-by", validated: true },
	{ source: "SC-7", target: "D3-AL", method: "implemented-by", validated: false },
	// D3FEND counters ATT&CK
	{ source: "D3-AL", target: "T1190", method: "counters", validated: true },
	{ source: "D3-PH", target: "T1021", method: "counters", validated: true },
	{ source: "D3-NI", target: "T1595", method: "counters", validated: false },
	// CWE→SPARTA exploits
	{ source: "CWE-119", target: "REC-0001", method: "exploits", validated: false },
	{ source: "CWE-787", target: "EX-0003", method: "exploits", validated: false },
	{ source: "CWE-200", target: "REC-0001", method: "exploits", validated: true },
	// CWE→D3FEND addressed-by
	{ source: "CWE-119", target: "D3-AL", method: "addressed-by", validated: false },
	{ source: "CWE-787", target: "D3-PH", method: "addressed-by", validated: true },
	// Cross-framework links
	{ source: "IMP-0002", target: "SC-7", method: "mitigated-by", validated: true },
	{ source: "D3-PH", target: "SC-7", method: "implements", validated: true },
	{ source: "IA-2", target: "D3-PH", method: "implemented-by", validated: true },
];

/* ───── Control Detail ───── */

/* ───── Inspector Panel ───── */

export const sampleInspectorEdges: GraphEdge[] = [
	{ source: "REC-0001", target: "T1595", method: "countered-by", validated: true },
	{ source: "REC-0001", target: "D3-PH", method: "countered-by", validated: true },
	{ source: "REC-0001", target: "SC-7", method: "mitigated-by", validated: false },
	{ source: "CWE-119", target: "REC-0001", method: "exploits", validated: false },
	{ source: "CWE-200", target: "REC-0001", method: "exploits", validated: true },
	{ source: "AC-2", target: "D3-PH", method: "subsumes", validated: true },
	{ source: "D3-PH", target: "SC-7", method: "maps-to", validated: true },
];

export const sampleWhatIfResponse = {
	control: "REC-0001",
	parameter: "enabled",
	new_value: false,
	affected_chains: [
		{
			chain: "REC-0001 → T1595 → SC-7",
			controls: ["REC-0001", "T1595", "SC-7"],
			predicate: "countered_by",
			status: "BROKEN" as const,
		},
		{
			chain: "REC-0001 → D3-PH",
			controls: ["REC-0001", "D3-PH"],
			predicate: "countered_by",
			status: "BROKEN" as const,
		},
		{
			chain: "AC-2 → D3-PH → SC-7",
			controls: ["AC-2", "D3-PH", "SC-7"],
			predicate: "subsumes",
			status: "HOLDS" as const,
		},
		{
			chain: "EX-0003 → T1190 → AC-2",
			controls: ["EX-0003", "T1190", "AC-2"],
			predicate: "maps_to",
			status: "HOLDS" as const,
		},
	],
	summary: { total: 4, broken: 2, held: 2 },
};

/* ───── Control Detail ───── */

export const sampleControlDetail: ControlDetailData = {
	id: "REC-0001",
	framework: "SPARTA",
	name: "Active Scanning of Space Systems",
	description:
		"Adversaries may scan for vulnerabilities in space system ground segments, links, or on-orbit components to identify attack surfaces.",
	controlType: "technique",
	domain: "Space",
	parentId: "TA-0001",
	scope: "Ground Segment, Link Segment",
	weaknesses: ["CWE-200", "CWE-693", "CWE-778"],
	relatedControls: [
		{ id: "T1595", framework: "ATT&CK", name: "Active Scanning", method: "maps-to" },
		{ id: "D3-PH", framework: "D3FEND", name: "Platform Hardening", method: "countered-by" },
		{ id: "SC-7", framework: "NIST", name: "Boundary Protection", method: "mitigated-by" },
		{ id: "CWE-200", framework: "CWE", name: "Exposure of Sensitive Information", method: "exploits" },
	],
};

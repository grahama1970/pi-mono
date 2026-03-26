export interface EvalCell {
	output: string;
	pass: boolean;
	grounded: boolean;
	latencyMs: number;
}

export interface EvalRow {
	id: string;
	label: string;
	question?: string;
	cells: Record<string, EvalCell>;
}

/** All available models — user picks which to show as grid columns */
export const ALL_MODELS = [
	"qwen3:1.7b",
	"qwen2.5-coder:7b",
	"DeepSeek-V3",
	"gemini-2.5-flash",
	"qwen3:0.6b",
	"text (scillm)",
] as const;

/** Default selected models */
export const DEFAULT_MODELS = ["qwen3:1.7b", "qwen2.5-coder:7b", "DeepSeek-V3"];

/** @deprecated use ALL_MODELS */
export const MODELS = ALL_MODELS.slice(0, 3);

export const mockEvalData: EvalRow[] = [
	{
		id: "tc-001",
		label: "SA-17 Boundary Protection",
		question: "What boundary protection mechanisms does SA-17 require at external and internal interfaces?",
		cells: {
			"qwen3:1.7b": {
				output:
					"SA-17 requires boundary protection mechanisms at all external and key internal boundaries. This includes firewalls, DMZs, and network segmentation aligned with NIST 800-53 controls.",
				pass: true,
				grounded: true,
				latencyMs: 340,
			},
			"qwen2.5-coder:7b": {
				output:
					"Boundary protection involves deploying architectural controls at managed interfaces. SA-17 mandates defense-in-depth strategies with controlled entry/exit points.",
				pass: true,
				grounded: true,
				latencyMs: 890,
			},
			"DeepSeek-V3": {
				output:
					"SA-17 is about software quality assurance and requires peer reviews and static analysis of source code for security flaws.",
				pass: false,
				grounded: false,
				latencyMs: 1200,
			},
		},
	},
	{
		id: "tc-002",
		label: "CWE-79 XSS Prevention",
		question: "How should an application prevent CWE-79 cross-site scripting attacks?",
		cells: {
			"qwen3:1.7b": {
				output:
					"To prevent CWE-79, sanitize all user inputs and encode outputs. Use Content-Security-Policy headers and framework auto-escaping.",
				pass: true,
				grounded: true,
				latencyMs: 280,
			},
			"qwen2.5-coder:7b": {
				output:
					"XSS prevention requires input validation, output encoding, and CSP headers. CWE-79 covers reflected, stored, and DOM-based XSS variants.",
				pass: true,
				grounded: true,
				latencyMs: 750,
			},
			"DeepSeek-V3": {
				output:
					"CWE-79 cross-site scripting can be mitigated by implementing proper input sanitization using allowlists, encoding HTML entities in output, and deploying CSP headers.",
				pass: true,
				grounded: true,
				latencyMs: 1050,
			},
		},
	},
	{
		id: "tc-003",
		label: "ATT&CK T1059 Command Execution",
		question: "What techniques does ATT&CK T1059 cover and how can they be detected?",
		cells: {
			"qwen3:1.7b": {
				output:
					"T1059 covers command and scripting interpreter abuse. Attackers use PowerShell, Bash, or Python to execute arbitrary commands on target systems.",
				pass: true,
				grounded: true,
				latencyMs: 310,
			},
			"qwen2.5-coder:7b": {
				output:
					"Command execution via T1059 can be detected by monitoring process creation events, particularly for cmd.exe, powershell.exe, and bash invocations with encoded parameters.",
				pass: true,
				grounded: true,
				latencyMs: 820,
			},
			"DeepSeek-V3": {
				output:
					"T1059 relates to data exfiltration through encrypted channels using steganography and covert DNS tunneling.",
				pass: false,
				grounded: false,
				latencyMs: 1180,
			},
		},
	},
	{
		id: "tc-004",
		label: "D3FEND Network Isolation",
		question: "How does D3FEND model network isolation as a defensive countermeasure?",
		cells: {
			"qwen3:1.7b": {
				output:
					"Network isolation involves segmenting network zones to contain lateral movement. VLANs, microsegmentation, and zero-trust architecture support D3FEND isolation countermeasures.",
				pass: true,
				grounded: true,
				latencyMs: 350,
			},
			"qwen2.5-coder:7b": {
				output:
					"D3FEND models network isolation as a defensive technique. Implementation includes SDN policies, firewall ACLs, and host-based segmentation agents.",
				pass: false,
				grounded: true,
				latencyMs: 920,
			},
			"DeepSeek-V3": {
				output:
					"D3FEND network isolation maps to techniques that restrict communication between segments. This includes VLAN partitioning, network access control, and traffic filtering at layer 3/4.",
				pass: true,
				grounded: true,
				latencyMs: 1100,
			},
		},
	},
	{
		id: "tc-005",
		label: "SPARTA SA-01 Link Budget",
		question: "What parameters must be calculated for SA-01 link budget analysis in space communications?",
		cells: {
			"qwen3:1.7b": {
				output:
					"SA-01 addresses link budget analysis for space communication. It requires calculating signal-to-noise ratio, path loss, and antenna gain to ensure reliable uplink/downlink.",
				pass: true,
				grounded: true,
				latencyMs: 290,
			},
			"qwen2.5-coder:7b": {
				output:
					"Link budget for SA-01 involves free-space path loss, atmospheric attenuation, and receiver sensitivity calculations specific to LEO/GEO orbit profiles.",
				pass: true,
				grounded: true,
				latencyMs: 780,
			},
			"DeepSeek-V3": {
				output:
					"SA-01 link budget ensures adequate signal margins for space-ground communication. Key parameters include EIRP, G/T ratio, and Eb/N0 thresholds per CCSDS standards.",
				pass: true,
				grounded: true,
				latencyMs: 980,
			},
		},
	},
];

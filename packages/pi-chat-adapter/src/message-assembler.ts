/**
 * MessageAssembler — reconstructs structured ChatMessage objects from D-Bus signals.
 *
 * ToolExecution signals carry the tool name + args, which tells us:
 * - What skill fired (evidence-case, memory recall, extract-entities)
 * - What structured data was requested (gates, entities, control_ids)
 *
 * MessageUpdate signals carry streaming text deltas.
 * AgentEnd signals carry the final text response.
 *
 * The assembler collects all signals for a requestId and builds a ChatMessage[].
 */
import type { PiEvent } from "./dbus-client.js";

// Re-export these types so consumers don't need to import from ux-lab
export interface EntityRef {
	id: string;
	label: string;
	type?: string;
	exists: boolean;
	/** Regex-derived references are for UI highlighting only; do not treat as graph-grounded evidence. */
	displayOnly?: boolean;
	source?: "regex" | "structured" | string;
}

export interface EvidenceGate {
	gate: string;
	passed: boolean;
	detail: string;
	duration?: number;
}

export interface EvidenceCaseData {
	verdict: string;
	grade: string;
	gates_passed: number;
	gates_total: number;
	gate_summary: string;
	gate_trace?: EvidenceGate[];
	control_ids: string[];
	tier: string;
	drift?: { old_verdict: string; new_verdict: string; timestamp: string };
	recall_count?: number;
	source_traceability?: Record<string, number>;
}

export type EvidenceRunEventStatus = "pending" | "running" | "done" | "failed";

export interface EvidenceRunStartedEvent {
	type: "evidence_run_started";
	runId: string;
	timestamp: number;
	skill?: string;
	requestId?: string;
}

export interface EvidenceRunGateEvent {
	type: "evidence_gate";
	runId: string;
	timestamp: number;
	gate: string;
	status: EvidenceRunEventStatus;
	passed?: boolean;
	detail?: string;
	duration?: number;
}

export interface EvidenceRunCompletedEvent {
	type: "evidence_run_completed";
	runId: string;
	timestamp: number;
	verdict?: string;
	grade?: string;
	gatesPassed?: number;
	gatesTotal?: number;
	tier?: string;
}

export interface EvidenceRunFailedEvent {
	type: "evidence_run_failed";
	runId: string;
	timestamp: number;
	message?: string;
}

export interface EvidenceRunTextEvent {
	type: "evidence_run_text";
	runId: string;
	timestamp: number;
	text: string;
}

export type EvidenceRunEvent =
	| EvidenceRunStartedEvent
	| EvidenceRunGateEvent
	| EvidenceRunCompletedEvent
	| EvidenceRunFailedEvent
	| EvidenceRunTextEvent;

export interface EvidenceRunTrace {
	runId: string;
	requestId?: string;
	skill?: string;
	status: EvidenceRunEventStatus;
	startedAt?: number;
	completedAt?: number;
	events: EvidenceRunEvent[];
}

export type CascadeLayer = "recall" | "intent" | "llm" | "aql";

export interface ReasoningStep {
	id: string;
	type: "recall" | "skill" | "text" | "pending";
	skill?: string;
	status: "running" | "done" | "failed" | "pending";
	summary: string;
	detail?: string;
	duration?: number;
	startedAt?: number;
}

export interface ChatMessage {
	id: string;
	role: "user" | "system" | "assistant" | "agent";
	content: string;
	timestamp: number;
	skillUsed?: string;
	entities?: EntityRef[];
	cascadeLayer?: CascadeLayer;
	verdict?: { state: string; gates: EvidenceGate[]; tier?: string };
	evidenceCase?: EvidenceCaseData;
	/** Typed, append-only event model for evidence-case runs derived from existing Pi/SSE output. */
	evidenceRun?: EvidenceRunTrace;
	reasoningSteps?: ReasoningStep[];
	recallItems?: unknown[];
	resultCount?: number;
	clarifyOptions?: Array<{ question: string }>;
	type?: "natural" | "aql";
}

let msgCounter = 0;
function nextId(): string {
	return `pi-${Date.now()}-${++msgCounter}`;
}

/**
 * Tracks state for a single Pi request and assembles ChatMessages.
 */
export class RequestAssembler {
	readonly requestId: string;
	private textChunks: string[] = [];
	private toolCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];
	private steps: ReasoningStep[] = [];
	private gateSteps: Map<string, ReasoningStep> = new Map();
	private evidenceRunEvents: EvidenceRunEvent[] = [];
	private evidenceRunId?: string;
	private evidenceRunSkill?: string;
	private evidenceRunStatus: EvidenceRunEventStatus = "pending";
	private evidenceRunStartedAt?: number;
	private evidenceRunCompletedAt?: number;
	private done = false;

	constructor(requestId: string) {
		this.requestId = requestId;
	}

	/** Consume one Pi event. Returns true once the request is complete. */
	ingest(event: PiEvent): boolean {
		return this.handle(event);
	}

	/** Consume one Pi event. Returns true once the request is complete. */
	handle(event: PiEvent): boolean {
		if (event.requestId !== this.requestId) return this.done;

		switch (event.type) {
			case "message_update":
				if (event.text) {
					this.textChunks.push(event.text);
					this.parseGateProgress(event.text);
					if (this.evidenceRunId) {
						this.appendEvidenceRunEvent({
							type: "evidence_run_text",
							runId: this.evidenceRunId,
							timestamp: Date.now(),
							text: event.text,
						});
					}
				}
				break;

			case "tool_execution": {
				let args: Record<string, unknown> = {};
				try {
					args = JSON.parse(event.args ?? "{}");
				} catch {
					/* malformed */
				}
				const skillName = this.extractSkillFromBash(event.tool ?? "unknown", args);
				this.toolCalls.push({ tool: skillName, args });
				this.steps.push({
					id: `step-${this.steps.length}`,
					type: "skill",
					skill: skillName,
					status: "running",
					summary: skillName !== "bash" ? `/${skillName}` : `Running ${event.tool}`,
					startedAt: Date.now(),
				});
				if (skillName === "create-evidence-case") {
					this.ensureEvidenceRunStarted(skillName);
				}
				break;
			}

			case "agent_end":
				if (event.response) {
					this.textChunks.push(event.response);
				}
				this.done = true;
				for (const step of this.steps) {
					if (step.status === "running") step.status = "done";
				}
				if (this.evidenceRunEvents.length > 0 && this.evidenceRunStatus === "running") {
					this.appendEvidenceRunEvent({
						type: "evidence_run_completed",
						runId: this.ensureEvidenceRunStarted("create-evidence-case"),
						timestamp: Date.now(),
					});
				}
				break;

			case "error":
				this.done = true;
				if (event.message) {
					this.textChunks.push(event.message);
				}
				if (this.evidenceRunEvents.length > 0) {
					this.appendEvidenceRunEvent({
						type: "evidence_run_failed",
						runId: this.ensureEvidenceRunStarted("create-evidence-case"),
						timestamp: Date.now(),
						message: event.message ?? "Pi request failed",
					});
				}
				for (const step of this.steps) {
					if (step.status === "running") step.status = "failed";
				}
				break;
		}

		return this.done;
	}

	/** Build the final ChatMessage from accumulated signals. */
	assemble(): ChatMessage {
		const content = this.textChunks.join("");
		const msg: ChatMessage = {
			id: nextId(),
			role: "system",
			content,
			timestamp: Date.now(),
			type: "natural",
		};

		// Detect which skills fired from tool calls
		const skills = this.detectedSkills();
		const primarySkill = skills[0];

		// Set cascade layer based on skills used
		if (skills.includes("create-evidence-case")) {
			msg.skillUsed = "create-evidence-case";
			msg.cascadeLayer = "llm";
		} else if (skills.includes("memory")) {
			msg.skillUsed = "memory";
			msg.cascadeLayer = "recall";
		} else if (skills.includes("extract-entities")) {
			msg.skillUsed = "extract-entities";
			msg.cascadeLayer = "intent";
		} else if (primarySkill) {
			msg.skillUsed = primarySkill;
			msg.cascadeLayer = "llm";
		}

		// Parse evidence case from text (JSON blocks or structured output)
		if (skills.includes("create-evidence-case")) {
			const ec = this.parseEvidenceCaseFromText(content);
			if (ec) {
				msg.evidenceCase = ec;
				msg.verdict = {
					state: ec.verdict.toUpperCase(),
					gates: ec.gate_trace ?? [],
					tier: ec.tier,
				};
				this.appendEvidenceRunCompletion(ec);
			} else if (this.evidenceRunEvents.length > 0 && this.evidenceRunStatus === "running") {
				this.evidenceRunStatus = "done";
				this.evidenceRunCompletedAt = Date.now();
			}
		}

		// Always extract entities from response text
		const entities = this.parseEntitiesFromText(content);
		if (entities.length > 0) msg.entities = entities;

		// Reasoning steps — with resolved skill names

		const evidenceRun = this.currentEvidenceRun();
		if (evidenceRun) {
			msg.evidenceRun = evidenceRun;
		}

		const reasoningSteps = this.currentSteps();
		if (reasoningSteps.length > 0) {
			msg.reasoningSteps = reasoningSteps;
		}

		return msg;
	}

	/** Get list of Pi skills that were invoked (extracted from bash commands) */
	private detectedSkills(): string[] {
		const skills = new Set<string>();
		for (const tc of this.toolCalls) {
			if (tc.tool !== "bash") {
				skills.add(tc.tool);
			}
		}
		return [...skills];
	}

	/**
	 * Extract the actual skill name from a bash tool call.
	 * Pi calls skills via bash: `.pi/skills/memory/run.sh recall ...`
	 * The D-Bus bridge reports tool="bash", args={command: "..."}
	 */
	private extractSkillFromBash(toolName: string, args: Record<string, unknown>): string {
		if (toolName !== "bash") return toolName;
		const cmd = (args.command as string) ?? "";

		// Match .pi/skills/<name>/run.sh or .claude/skills/<name>/run.sh
		const skillMatch = cmd.match(/\.(?:pi|claude)\/skills\/([a-z0-9-]+)\/run\.sh/);
		if (skillMatch) return skillMatch[1];

		// Match memory/run.sh recall, extract-entities/run.sh, etc.
		const shortMatch = cmd.match(/([a-z0-9-]+)\/run\.sh/);
		if (shortMatch) return shortMatch[1];

		// Match httpx/curl to known endpoints
		if (cmd.includes("/recall") || cmd.includes("memory")) return "memory";
		if (cmd.includes("/extract-entities")) return "extract-entities";
		if (cmd.includes("evidence-case")) return "create-evidence-case";

		return "bash";
	}

	/** Get streaming text accumulated so far (for live updates) */
	currentText(): string {
		return this.textChunks.join("");
	}

	/** Get current reasoning steps (for live step display) */
	currentSteps(): ReasoningStep[] {
		// If we have gate steps from evidence-case, return those for better granularity
		if (this.gateSteps.size > 0) {
			const orderedGates = [
				"extract_entities",
				"qra_recall",
				"technique_intersection",
				"lean4_prove",
				"scillm_synthesize",
			];
			const gateStepsList: ReasoningStep[] = [];
			for (const gate of orderedGates) {
				const step = this.gateSteps.get(gate);
				if (step) gateStepsList.push(step);
			}
			return gateStepsList;
		}
		return [...this.steps];
	}

	private ensureEvidenceRunStarted(skill?: string): string {
		if (!this.evidenceRunId) {
			this.evidenceRunId = `evidence-run-${this.requestId}`;
			this.evidenceRunSkill = skill;
			this.evidenceRunStatus = "running";
			this.evidenceRunStartedAt = Date.now();
			this.appendEvidenceRunEvent({
				type: "evidence_run_started",
				runId: this.evidenceRunId,
				timestamp: this.evidenceRunStartedAt,
				skill,
				requestId: this.requestId,
			});
		}
		return this.evidenceRunId;
	}

	private appendEvidenceRunEvent(event: EvidenceRunEvent): void {
		this.evidenceRunEvents.push(event);
		if (event.type === "evidence_run_completed") {
			this.evidenceRunStatus = "done";
			this.evidenceRunCompletedAt = event.timestamp;
		}
		if (event.type === "evidence_run_failed") {
			this.evidenceRunStatus = "failed";
			this.evidenceRunCompletedAt = event.timestamp;
		}
	}

	private appendEvidenceRunCompletion(ec: EvidenceCaseData): void {
		this.appendEvidenceRunEvent({
			type: "evidence_run_completed",
			runId: this.ensureEvidenceRunStarted("create-evidence-case"),
			timestamp: Date.now(),
			verdict: ec.verdict,
			grade: ec.grade,
			gatesPassed: ec.gates_passed,
			gatesTotal: ec.gates_total,
			tier: ec.tier,
		});
	}

	private currentEvidenceRun(): EvidenceRunTrace | undefined {
		if (!this.evidenceRunId || this.evidenceRunEvents.length === 0) return undefined;
		return {
			runId: this.evidenceRunId,
			requestId: this.requestId,
			skill: this.evidenceRunSkill,
			status: this.evidenceRunStatus,
			startedAt: this.evidenceRunStartedAt,
			completedAt: this.evidenceRunCompletedAt,
			events: this.evidenceRunEvents,
		};
	}

	/**
	 * Parse GATE_PROGRESS lines from streaming text.
	 * Format: GATE_PROGRESS:{"type":"gate_progress","gate":"...","status":"...","detail":"..."}
	 */
	private parseGateProgress(text: string): void {
		const lines = text.split("\n");
		for (const line of lines) {
			if (!line.startsWith("GATE_PROGRESS:")) continue;
			try {
				const json = line.slice("GATE_PROGRESS:".length);
				const data = JSON.parse(json) as {
					gate: string;
					status: string;
					detail?: string;
					passed?: boolean;
				};
				const existing = this.gateSteps.get(data.gate);
				const status = data.status === "running" ? "running" : data.status === "done" ? "done" : "failed";
				const runId = this.ensureEvidenceRunStarted("create-evidence-case");
				if (existing) {
					existing.status = status;
					existing.detail = data.detail ?? existing.detail;
					if (status !== "running") {
						existing.duration = existing.startedAt ? Date.now() - existing.startedAt : undefined;
					}
				} else {
					this.gateSteps.set(data.gate, {
						id: `gate-${data.gate}`,
						type: "skill",
						skill: "create-evidence-case",
						status,
						summary: data.gate.replace(/_/g, " "),
						detail: data.detail,
						startedAt: status === "running" ? Date.now() : undefined,
					});
				}
				this.appendEvidenceRunEvent({
					type: "evidence_gate",
					runId,
					timestamp: Date.now(),
					gate: data.gate,
					status,
					passed: data.passed,
					detail: data.detail,
				});
			} catch {
				/* malformed gate progress line */
			}
		}
	}

	get isComplete(): boolean {
		return this.done;
	}

	/**
	 * Parse evidence case data from Pi's response text.
	 * Pi's response may contain structured JSON in code blocks or inline.
	 */
	private parseEvidenceCaseFromText(text: string): EvidenceCaseData | null {
		// Try to find JSON block with verdict/gates
		const jsonMatch = text.match(/```json\s*\n([\s\S]*?)\n```/);
		if (jsonMatch) {
			try {
				const data = JSON.parse(jsonMatch[1]);
				if (data.verdict || data.verdict_state) {
					return {
						verdict: data.verdict?.state ?? data.verdict_state ?? data.verdict ?? "unknown",
						grade: data.grade ?? "—",
						gates_passed: data.gates_passed ?? 0,
						gates_total: data.gates_total ?? 0,
						gate_summary: data.gate_summary ?? "",
						gate_trace: data.gate_trace ?? data.gates ?? [],
						control_ids: data.control_ids ?? [],
						tier: data.tier ?? "T0",
						drift: data.drift,
						recall_count: data.recall_count ?? 0,
						source_traceability: data.source_traceability,
					};
				}
			} catch {
				/* not valid JSON */
			}
		}
		return null;
	}

	/** Parse entity references from response text (control IDs, CWE refs) */
	private parseEntitiesFromText(text: string): EntityRef[] {
		const entities: EntityRef[] = [];
		const seen = new Set<string>();
		// Match common control ID patterns
		const patterns = [
			/\b([A-Z]{2,4}-\d{1,5}(?:\.\d+)?)\b/g, // AC-2, CWE-287, SA-8, SI-3.1
			/\bCWE-(\d+)\b/g, // CWE-287
		];
		for (const pattern of patterns) {
			for (const match of text.matchAll(pattern)) {
				const id = match[0];
				if (!seen.has(id)) {
					seen.add(id);
					entities.push({
						id,
						label: id,
						type: id.startsWith("CWE") ? "cwe" : "control",
						exists: false,
						displayOnly: true,
						source: "regex",
					});
				}
			}
		}
		return entities;
	}
}

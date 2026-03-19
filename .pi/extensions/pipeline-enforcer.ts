import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Pipeline Enforcer — COMPLEX task pipeline enforcement.
 *
 * Upgrades Claude Code's advisory prompt-enrichment.sh to a real gate.
 * BLOCKS Edit/Write until pipeline steps complete for COMPLEX tasks.
 *
 * Classification: CHAT | SIMPLE | COMPLEX | RESEARCH
 * For COMPLEX: memory recall -> plan/assess -> then Edit/Write allowed.
 *
 * Coordinates with memory-first.ts via pi.state.memoryQueriedThisTurn.
 * Idempotent with Claude Code hooks during migration.
 */

// -- Configuration -----------------------------------------------------------

/** Minimum prompt length to classify as COMPLEX */
const MIN_COMPLEX_LENGTH = 80;

/** Keywords that indicate COMPLEX tasks */
const COMPLEX_INDICATORS = [
	/\b(refactor|redesign|architect|migrate|overhaul|rewrite)\b/i,
	/\b(create|build|implement|add)\b.*\b(extension|skill|feature|system|pipeline|service)\b/i,
	/\bmulti[- ]?file\b/i,
	/\b(across|all|every)\b.*\b(skills?|files?|packages?)\b/i,
	/\btask\s*file\b/i,
	/\borchestrate\b/i,
];

/** Keywords that indicate SIMPLE tasks (overrides COMPLEX if matched) */
const SIMPLE_INDICATORS = [
	/\b(fix|typo|bump|update|rename)\b.*\b(one|single|this)\b/i,
	/\bconfig\b/i,
	/\b(add|remove)\s+import\b/i,
	/\bone[- ]?liner\b/i,
];

/** Keywords that indicate CHAT (no code expected) */
const CHAT_INDICATORS = [
	/^(hi|hello|hey|thanks|ok|yes|no|sure)\b/i,
	/\b(explain|what is|how does|tell me|describe)\b/i,
	/\b(status|progress|summary)\b/i,
];

/** Keywords that indicate RESEARCH */
const RESEARCH_INDICATORS = [
	/\b(find|search|grep|look for|investigate|analyze|audit|scan)\b/i,
	/\b(how many|count|list all|show me)\b/i,
];

/** Tools that modify code (gated for COMPLEX tasks) */
const WRITE_TOOLS = new Set(["edit", "write"]);

/** Planning commands/skills that satisfy step 2 */
const PLAN_PATTERNS = [
	/\.pi\/skills\/plan\//,
	/\.pi\/skills\/assess\//,
	/\.pi\/skills\/review-plan\//,
	/\.pi\/skills\/orchestrate\//,
	/\/plan\b/,
	/\/assess\b/,
	/\/review-plan\b/,
	/\/orchestrate\b/,
	/\bplan\b.*\btask/i,
	/\bstructured_execute\.py\b/,
];

/** Exempt file patterns (always allowed even before pipeline) */
const EXEMPT_FILE_PATTERNS = [
	/SKILL\.md$/,
	/CLAUDE\.md$/,
	/AGENTS\.md$/,
	/MEMORY\.md$/,
	/README\.md$/,
	/\.md$/,          // Markdown files are planning artifacts, not code
	/\.json$/,        // Config files
	/\.toml$/,        // Config files
	/\.yml$/,         // Config files
	/\.yaml$/,        // Config files
];

type TaskClass = "CHAT" | "SIMPLE" | "COMPLEX" | "RESEARCH";

// -- State -------------------------------------------------------------------

interface PipelineState {
	taskClass: TaskClass;
	memoryRecalled: boolean;
	planningDone: boolean;
	promptText: string;
}

// -- Classifier --------------------------------------------------------------

function classifyPrompt(prompt: string): TaskClass {
	if (!prompt || prompt.length < 20) return "CHAT";
	if (CHAT_INDICATORS.some((p) => p.test(prompt))) return "CHAT";
	if (RESEARCH_INDICATORS.some((p) => p.test(prompt))) return "RESEARCH";
	if (SIMPLE_INDICATORS.some((p) => p.test(prompt))) return "SIMPLE";
	if (prompt.length >= MIN_COMPLEX_LENGTH && COMPLEX_INDICATORS.some((p) => p.test(prompt))) {
		return "COMPLEX";
	}
	return "SIMPLE";
}

// -- Extension ---------------------------------------------------------------

export default function pipelineEnforcer(pi: ExtensionAPI) {
	const pipeline: PipelineState = {
		taskClass: "SIMPLE",
		memoryRecalled: false,
		planningDone: false,
		promptText: "",
	};
	let blockedCount = 0;

	// Classify on session start
	pi.on("before_agent_start", async (event) => {
		const prompt = event.prompt?.trim() || "";
		pipeline.promptText = prompt;
		pipeline.taskClass = classifyPrompt(prompt);
		pipeline.memoryRecalled = false;
		pipeline.planningDone = false;

		// Non-COMPLEX tasks get a free pass on the full pipeline
		if (pipeline.taskClass !== "COMPLEX") {
			pipeline.memoryRecalled = true;
			pipeline.planningDone = true;
		}
	});

	// Track memory recall completion (from memory-first.ts shared state)
	pi.on("turn_start", async () => {
		const state = (pi as any).state || {};
		if (state.memoryQueriedThisTurn === true) {
			pipeline.memoryRecalled = true;
		}
	});

	// Track planning step completion from tool results
	pi.on("tool_result", async (event) => {
		if (pipeline.taskClass !== "COMPLEX") return;

		const input = (event.input || {}) as any;
		let checkText = "";

		if (event.toolName === "bash" && typeof input.command === "string") {
			checkText = input.command;
		} else if (event.toolName === "read") {
			checkText = input.file_path || "";
		}

		if (!checkText) return;

		// Check if a planning skill was invoked
		if (PLAN_PATTERNS.some((p) => p.test(checkText))) {
			pipeline.planningDone = true;
		}

		// Also check memory-first state on every tool result
		const state = (pi as any).state || {};
		if (state.memoryQueriedThisTurn === true) {
			pipeline.memoryRecalled = true;
		}
	});

	// Gate: block Edit/Write for COMPLEX tasks until pipeline steps complete
	pi.on("tool_call", async (event) => {
		if (pipeline.taskClass !== "COMPLEX") return;
		if (!WRITE_TOOLS.has(event.toolName)) return;

		const input = (event.input || {}) as any;
		const filePath = input.file_path || "";

		// Exempt planning/config artifacts
		if (filePath && EXEMPT_FILE_PATTERNS.some((p) => p.test(filePath))) return;

		// Check pipeline completion
		if (!pipeline.memoryRecalled) {
			blockedCount++;
			return {
				block: true,
				reason:
					"BLOCKED [pipeline-enforcer]: COMPLEX task detected but /memory recall not yet called.\n" +
					"Pipeline for COMPLEX tasks: /memory recall -> /plan or /assess -> then Edit/Write.\n" +
					"Run: .pi/skills/memory/run.sh recall --q '<your problem>'",
			};
		}

		if (!pipeline.planningDone) {
			blockedCount++;
			return {
				block: true,
				reason:
					"BLOCKED [pipeline-enforcer]: COMPLEX task — memory recalled but no planning step done.\n" +
					"Run /plan or /assess before making code changes.\n" +
					"Read a task file, invoke /plan, or read .pi/skills/assess/SKILL.md first.",
			};
		}
	});

	// Diagnostic command
	pi.registerCommand("pipeline", {
		description: "Pipeline enforcer status: task class, step completion, blocks",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				`Pipeline Enforcer:\n` +
				`  Task class: ${pipeline.taskClass}\n` +
				`  Memory recalled: ${pipeline.memoryRecalled}\n` +
				`  Planning done: ${pipeline.planningDone}\n` +
				`  Prompt: ${pipeline.promptText.substring(0, 100)}...\n` +
				`  Total blocks (session): ${blockedCount}`,
				"info",
			);
		},
	});
}

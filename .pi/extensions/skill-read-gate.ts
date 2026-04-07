import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Skill-Read Gate Extension — BLOCKING enforcement of SKILL.md read contract.
 *
 * Problem: Agents skip reading SKILL.md before executing skills. They guess
 * how skills work, pass wrong arguments, and produce garbage. This is the
 * #1 failure mode across all agent sessions.
 *
 * Solution: BLOCK skill execution (bash calls to run.sh or skill dirs) unless
 * SKILL.md for that skill has been Read in the current turn.
 *
 * Enforcement:
 *   1. tool_result: Detect Read of .pi/skills/<name>/SKILL.md -> set flag
 *   2. tool_call: Detect skill execution → check flag → block if unread
 *   3. turn_start: Reset all flags (every turn requires fresh reads)
 *
 * Coordinates with other extensions via shared state:
 *   - Exports pi.state.skillMdRead[skillName] for other gates to check
 *
 * Exempt operations (never blocked):
 *   - Reading SKILL.md itself (circular dependency)
 *   - Git commands (status, log, diff)
 *   - Package metadata reads
 *   - Memory/assess/plan skill invocations (infrastructure)
 *   - Health checks (sanity.sh)
 */

// Configuration

/** Patterns that indicate skill execution in bash commands */
const SKILL_EXEC_PATTERNS = [
	/\.pi\/skills\/([a-z][a-z0-9-]+)\/run\.sh/,
	/skills\/([a-z][a-z0-9-]+)\/run\.sh/,
];

/** Skills exempt from the read gate (infrastructure, always allowed) */
const EXEMPT_SKILLS = new Set([
	"memory",
	"assess",
	"plan",
	"orchestrate",
	"review-plan",
	"subagent-service",
	"checkpoint",
	"agent-inbox",
	"test",
	"skills-ci",
	"ops-claude",
]);

/** Bash patterns that are never skill executions */
const EXEMPT_BASH_PATTERNS = [
	/\bgit\s+(status|log|diff|branch|show|add|commit|push)\b/,
	/\bsanity\.sh\b/,
	/\bpytest\b/,
	/\bvitest\b/,
	/\bnpm\s+test\b/,
	/\bpython3?\s+-c\b/,
	/\bcat\b/,
	/\bls\b/,
	/\becho\b/,
];

/** State key for skill read tracking */
const SKILL_MD_READ_KEY = "skillMdRead";

// Extension

export default function skillReadGate(pi: ExtensionAPI) {
	let blockedCount = 0;
	// Module-level state for gate logic (not dependent on pi.state persistence)
	let skillMdRead: Record<string, boolean> = {};

	// Reset per-turn state — every turn requires fresh SKILL.md reads
	pi.on("turn_start", async () => {
		skillMdRead = {};
		// Mirror to pi.state for cross-extension visibility
		(pi as any).state = (pi as any).state || {};
		(pi as any).state[SKILL_MD_READ_KEY] = skillMdRead;
	});

	// Detect SKILL.md reads from tool results
	pi.on("tool_result", async (event) => {
		if (event.toolName !== "read") return;

		const input = (event.input || {}) as any;
		const filePath = input.file_path || input.path || "";

		// Match: .pi/skills/<skill-name>/SKILL.md
		const match = filePath.match(/\.pi\/skills\/([a-z][a-z0-9-]+)\/SKILL\.md$/);
		if (!match) return;

		const skillName = match[1];
		skillMdRead[skillName] = true;
		// Mirror to pi.state for cross-extension visibility
		(pi as any).state = (pi as any).state || {};
		(pi as any).state[SKILL_MD_READ_KEY] = skillMdRead;
	});

	// Gate: block skill execution if SKILL.md hasn't been read
	pi.on("tool_call", async (event: any) => {
		const toolName = event.toolName;
		if (toolName !== "bash") return undefined;

		const input = event.input || {};
		const command = typeof input.command === "string" ? input.command : "";
		if (!command) return undefined;

		// Never block exempt bash commands
		if (EXEMPT_BASH_PATTERNS.some((p) => p.test(command))) return undefined;

		// Check if this is a skill execution
		let skillName: string | null = null;
		for (const pattern of SKILL_EXEC_PATTERNS) {
			const match = command.match(pattern);
			if (match) {
				skillName = match[1];
				break;
			}
		}

		if (!skillName) return undefined;

		// Exempt infrastructure skills
		if (EXEMPT_SKILLS.has(skillName)) return undefined;

		// Check if SKILL.md was read this turn (use local state, not pi.state)
		if (!skillMdRead[skillName]) {
			blockedCount++;
			return {
				block: true,
				reason:
					`BLOCKED: You must read SKILL.md for '${skillName}' before executing. ` +
					`Read .pi/skills/${skillName}/SKILL.md first.`,
			};
		}

		return undefined;
	});

	// Register /read-gate diagnostic command
	pi.registerCommand("read-gate", {
		description: "Skill-read gate status: which skills have been read this turn",
		handler: async (_args, ctx) => {
			const readSkills = Object.keys(skillMdRead).filter((k) => skillMdRead[k]);
			ctx.ui.notify(
				`Skill-Read Gate:\n` +
				`  Skills read this turn: ${readSkills.length > 0 ? readSkills.join(", ") : "(none)"}\n` +
				`  Total blocks (session): ${blockedCount}`,
				"info",
			);
		},
	});
}

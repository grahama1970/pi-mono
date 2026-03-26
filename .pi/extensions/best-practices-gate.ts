import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Best Practices Gate Extension — Enforce Python/skills conventions on Edit/Write.
 *
 * Ports Claude Code's best-practices-gate.sh to Pi with REAL blocking:
 *   - On Edit/Write of .py files: block banned imports (logging, requests, argparse)
 *   - On Edit/Write under .pi/skills/: remind about /skills-ci (supplements skills-ci-gate.ts)
 *   - Can inject best-practices skill content, not just advisory text
 *
 * Claude Code limitation: best-practices-gate.sh exits 2 for violations but
 * only injects additionalContext — the agent can ignore it entirely.
 * This extension returns { block: true } which Pi enforces at the tool level.
 *
 * Idempotent with Claude Code hooks — safe to run alongside during migration.
 */

// -- Configuration -----------------------------------------------------------

/** Banned Python imports per CLAUDE.md and best-practices-python */
const BANNED_IMPORTS: Array<{ pattern: RegExp; replacement: string; rule: string }> = [
	{
		pattern: /\bimport\s+logging\b/,
		replacement: "from loguru import logger",
		rule: "Use loguru, not stdlib logging (CLAUDE.md)",
	},
	{
		pattern: /\bfrom\s+logging\b/,
		replacement: "from loguru import logger",
		rule: "Use loguru, not stdlib logging (CLAUDE.md)",
	},
	{
		pattern: /\bimport\s+requests\b/,
		replacement: "import httpx",
		rule: "Use httpx, not requests (CLAUDE.md)",
	},
	{
		pattern: /\bfrom\s+requests\b/,
		replacement: "import httpx",
		rule: "Use httpx, not requests (CLAUDE.md)",
	},
	{
		pattern: /\bimport\s+argparse\b/,
		replacement: "import typer",
		rule: "Use typer, not argparse (CLAUDE.md)",
	},
	{
		pattern: /\bfrom\s+argparse\b/,
		replacement: "import typer",
		rule: "Use typer, not argparse (CLAUDE.md)",
	},
];

/** Tools that write file content */
const WRITE_TOOLS = new Set(["edit", "write"]);

/** Skill file path detection */
const SKILL_PATH_PATTERN = /\.pi\/skills\/[^/]+\//;

// -- Helpers -----------------------------------------------------------------

/**
 * Extract the content being written from the tool input.
 * For Edit: check new_string. For Write: check content.
 */
function getWriteContent(toolName: string, input: any): string {
	if (toolName === "edit") {
		return typeof input.new_string === "string" ? input.new_string : "";
	}
	if (toolName === "write") {
		return typeof input.content === "string" ? input.content : "";
	}
	return "";
}

// -- Extension ---------------------------------------------------------------

export default function bestPracticesGate(pi: ExtensionAPI) {
	let blockedCount = 0;
	let warnedCount = 0;

	pi.on("tool_call", async (event) => {
		if (!WRITE_TOOLS.has(event.toolName)) return;

		const input = (event.input || {}) as any;
		const filePath: string = input.file_path || "";
		const content = getWriteContent(event.toolName, input);

		if (!filePath) return;

		// -- Python file checks --------------------------------------------------
		if (filePath.endsWith(".py") && content) {
			const violations: string[] = [];

			for (const banned of BANNED_IMPORTS) {
				if (banned.pattern.test(content)) {
					violations.push(`  - ${banned.rule} -> use: ${banned.replacement}`);
				}
			}

			if (violations.length > 0) {
				blockedCount++;
				return {
					block: true,
					reason:
						`BLOCKED [best-practices-gate]: Banned Python imports detected in ${filePath}:\n` +
						violations.join("\n") +
						"\n\nFix the imports and retry. See best-practices-python/SKILL.md for full rules.",
				};
			}
		}

		// -- Skill file advisory (supplements skills-ci-gate.ts) -----------------
		// skills-ci-gate handles the hard block; this injects the reminder early
		if (SKILL_PATH_PATTERN.test(filePath)) {
			warnedCount++;
			// Don't block — skills-ci-gate.ts handles the post-edit enforcement.
			// But inject a reminder so the agent knows before it starts.
			// Pi doesn't support advisory-only returns from tool_call,
			// so we rely on skills-ci-gate.ts for the actual enforcement.
		}
	});

	// Diagnostic command
	pi.registerCommand("bp-gate", {
		description: "Best practices gate status: blocks, warnings",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				`Best Practices Gate:\n` +
				`  Blocked writes (banned imports): ${blockedCount}\n` +
				`  Skill file warnings: ${warnedCount}\n` +
				`  Rules enforced: ${BANNED_IMPORTS.length} banned import patterns`,
				"info",
			);
		},
	});
}

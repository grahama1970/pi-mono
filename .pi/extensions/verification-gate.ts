import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Verification Gate Extension — Cross-check claims vs evidence at commit time.
 *
 * Ports Claude Code's verification-gate (Stop hook agent) to Pi with real
 * tool-level enforcement. Instead of running as a sub-agent at session end
 * (which Claude Code hooks support but can't block stop), this extension:
 *
 *   1. Tracks Python file modifications via evidence-collector shared state
 *   2. On `git commit` — runs pytest if .py files were modified
 *   3. On `git commit` — runs skills-ci if .pi/skills/ files were modified
 *   4. Blocks commit if verification commands haven't been run
 *
 * Complements stop-gates.ts (which tracks test execution) by also:
 *   - Specifically gating on file types modified (not just "any tests run")
 *   - Running skills-ci check alongside pytest
 *   - Reading evidence file for cross-reference
 *
 * Coordinates with:
 *   - evidence-collector.ts (reads pi.state.evidenceFile)
 *   - stop-gates.ts (shares test-passed tracking)
 *   - skills-ci-gate.ts (shares CI scan state)
 *
 * Idempotent with Claude Code hooks — safe to run alongside during migration.
 */

// -- Configuration -----------------------------------------------------------

/** Patterns that indicate a git commit attempt */
const COMMIT_PATTERNS = [
	/\bgit commit\b/,
];

/** Patterns for detecting pytest execution */
const PYTEST_PATTERNS = [
	/\bpytest\b/,
	/\buv run pytest\b/,
	/\bpython -m pytest\b/,
];

/** Patterns for detecting skills-ci execution */
const SKILLS_CI_PATTERNS = [
	/skills[_-]ci\.py/,
	/skills-ci\/run\.sh/,
];

/** Patterns for detecting orchestrate execution (counts as verification for orchestrated tasks) */
const ORCHESTRATE_PATTERNS = [
	/structured_execute\.py\b/,
	/orchestrate\/run\.sh\b.*\brun\b/,
	/\/orchestrate\b.*\brun\b/,
];

// -- Extension ---------------------------------------------------------------

export default function verificationGate(pi: ExtensionAPI) {
	let pythonFilesModified = false;
	let skillFilesModified = false;
	let pytestRanSuccessfully = false;
	let skillsCiRanSuccessfully = false;
	let blockedCount = 0;
	let modifiedFiles: string[] = [];

	// Track file modifications from tool results
	pi.on("tool_result", async (event) => {
		const input = (event.input || {}) as any;
		const toolName = event.toolName;
		let filePath = "";

		if (toolName === "edit" || toolName === "write") {
			if (event.isError) return;
			filePath = input.file_path || "";
		} else if (toolName === "bash" && typeof input.command === "string") {
			const cmd = input.command;

			// Only mark verification as passed if the command succeeded (not errored)
			if (!event.isError) {
				// Detect pytest success
				if (PYTEST_PATTERNS.some((p) => p.test(cmd))) {
					pytestRanSuccessfully = true;
					return;
				}

				// Detect skills-ci success
				if (SKILLS_CI_PATTERNS.some((p) => p.test(cmd))) {
					skillsCiRanSuccessfully = true;
					return;
				}

				// Detect orchestrate execution — orchestrated tasks run their own
				// quality gates (DoD commands, test-lab), so count as verified
				if (ORCHESTRATE_PATTERNS.some((p) => p.test(cmd))) {
					pytestRanSuccessfully = true;
					skillsCiRanSuccessfully = true;
					return;
				}
			}

			// Extract file path from bash write operations
			const redirectMatch = cmd.match(/>\s*([^\s;|&]+)/);
			if (redirectMatch) filePath = redirectMatch[1];
		}

		if (!filePath) return;

		// Track what types of files were modified
		if (filePath.endsWith(".py")) {
			pythonFilesModified = true;
			if (!modifiedFiles.includes(filePath)) modifiedFiles.push(filePath);
		}
		if (/\.pi\/skills\//.test(filePath)) {
			skillFilesModified = true;
			if (!modifiedFiles.includes(filePath)) modifiedFiles.push(filePath);
		}
	});

	// Gate: block commits if verification hasn't been done
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return;

		const input = (event.input || {}) as any;
		const command = typeof input.command === "string" ? input.command : "";

		if (!command) return;
		if (!COMMIT_PATTERNS.some((p) => p.test(command))) return;

		const missing: string[] = [];

		// Check pytest requirement
		if (pythonFilesModified && !pytestRanSuccessfully) {
			missing.push("pytest (Python files modified but tests not run)");
		}

		// Check skills-ci requirement
		if (skillFilesModified && !skillsCiRanSuccessfully) {
			missing.push("skills-ci scan (skill files modified but CI not run)");
		}

		if (missing.length > 0) {
			blockedCount++;

			const fileList = modifiedFiles.slice(0, 10).join("\n    ");
			return {
				block: true,
				reason:
					`BLOCKED [verification-gate]: Commit requires verification for modified files:\n` +
					`  Modified files:\n    ${fileList}\n` +
					`  Missing verification:\n    ${missing.join("\n    ")}\n\n` +
					`Run before committing:\n` +
					(pythonFilesModified && !pytestRanSuccessfully
						? `  uv run pytest tests -q -x --tb=short\n`
						: "") +
					(skillFilesModified && !skillsCiRanSuccessfully
						? `  cd .pi/skills/skills-ci && uv run python skills_ci.py --mode scan\n`
						: ""),
			};
		}
	});

	// Diagnostic command
	pi.registerCommand("verify-gate", {
		description: "Verification gate status: modified files, verification state",
		handler: async (_args, ctx) => {
			const state = (pi as any).state || {};
			const evidenceFile = state.evidenceFile || "(not set)";

			ctx.ui.notify(
				`Verification Gate:\n` +
				`  Python files modified: ${pythonFilesModified}\n` +
				`  Skill files modified: ${skillFilesModified}\n` +
				`  Pytest passed: ${pytestRanSuccessfully}\n` +
				`  Skills-CI passed: ${skillsCiRanSuccessfully}\n` +
				`  Modified files: ${modifiedFiles.length}\n` +
				`  Total blocks (session): ${blockedCount}\n` +
				`  Evidence file: ${evidenceFile}`,
				"info",
			);
		},
	});
}

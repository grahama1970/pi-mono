import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * Evidence Collector Extension — Audit trail for every file modification.
 *
 * Ports Claude Code's evidence-collector.sh to Pi with richer data.
 * Logs every Edit/Write/Bash-write to a JSONL file for post-session
 * verification by the verification-gate extension.
 *
 * Evidence file: ~/.claude/state/evidence_{session_id}.jsonl
 * Format: one JSON object per line with timestamp, tool, path, type, lines.
 *
 * The Claude Code version could only see tool names from hooks. This Pi
 * version captures the actual file paths, content size, and tool inputs
 * because it intercepts tool_result events directly.
 *
 * Idempotent with Claude Code hooks — safe to run alongside during migration.
 */

import { existsSync, mkdirSync } from "fs";
import { join } from "path";

// -- Configuration -----------------------------------------------------------

const STATE_DIR = join(process.env.HOME || "/tmp", ".claude", "state");
const SESSION_ID = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
const EVIDENCE_FILE = join(STATE_DIR, `evidence_${SESSION_ID}.jsonl`);

/** Tools that modify files */
const WRITE_TOOLS = new Set(["edit", "write"]);

/** Bash commands that write files */
const BASH_WRITE_PATTERNS = [
	/\b(mv|cp|rm|sed|awk)\b/,
	/\btee\b/,
	/>[^>]/,       // redirect (but not >>)
	/>>/,          // append redirect
	/\bcat\b.*>/,  // cat > file
	/\becho\b.*>/, // echo > file
];

/** File type classification */
function classifyFile(filePath: string): string {
	if (filePath.endsWith(".py")) return "python";
	if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) return "typescript";
	if (filePath.endsWith(".js") || filePath.endsWith(".jsx")) return "javascript";
	if (filePath.endsWith(".rs")) return "rust";
	if (filePath.endsWith(".sh")) return "shell";
	if (filePath.endsWith(".md")) return "markdown";
	if (filePath.endsWith(".json")) return "json";
	if (filePath.endsWith(".toml")) return "toml";
	if (filePath.endsWith(".yaml") || filePath.endsWith(".yml")) return "yaml";
	return "other";
}

// -- Extension ---------------------------------------------------------------

export default function evidenceCollector(pi: ExtensionAPI) {
	let entryCount = 0;

	// Ensure state directory exists
	try {
		if (!existsSync(STATE_DIR)) {
			mkdirSync(STATE_DIR, { recursive: true });
		}
	} catch {
		// If we can't create the dir, we'll fail silently on writes
	}

	// Expose evidence file path via shared state for verification-gate
	(pi as any).state = (pi as any).state || {};
	(pi as any).state.evidenceFile = EVIDENCE_FILE;
	(pi as any).state.evidenceSessionId = SESSION_ID;

	// Log every file modification + orchestrate execution
	pi.on("tool_result", async (event) => {
		const input = (event.input || {}) as any;
		const toolName = event.toolName;

		let filePath = "";
		let lineCount = 0;
		let orchestrateContext = "";

		if (WRITE_TOOLS.has(toolName)) {
			filePath = input.file_path || "";

			// Estimate line count from content
			if (toolName === "edit" && typeof input.new_string === "string") {
				lineCount = input.new_string.split("\n").length;
			} else if (toolName === "write" && typeof input.content === "string") {
				lineCount = input.content.split("\n").length;
			}
		} else if (toolName === "bash" && typeof input.command === "string") {
			const cmd = input.command;

			// Capture orchestrate execution as evidence (even if not a file write)
			const orchestrateMatch = cmd.match(/structured_execute\.py\s+run\s+(\S+)/);
			if (orchestrateMatch) {
				orchestrateContext = orchestrateMatch[1];
				filePath = `(orchestrate:${orchestrateContext})`;
			} else if (/orchestrate\/run\.sh.*\brun\b/.test(cmd)) {
				const taskFileMatch = cmd.match(/run\s+(\S+\.(?:yaml|yml|json|md))/);
				orchestrateContext = taskFileMatch?.[1] || "(unknown)";
				filePath = `(orchestrate:${orchestrateContext})`;
			} else {
				// Only log bash commands that write files
				if (!BASH_WRITE_PATTERNS.some((p) => p.test(cmd))) return;

				// Try to extract target file from command
				const redirectMatch = cmd.match(/>\s*([^\s;|&]+)/);
				const mvCpMatch = cmd.match(/\b(?:mv|cp)\b.*\s+([^\s;|&]+)\s*$/);
				filePath = redirectMatch?.[1] || mvCpMatch?.[1] || "(bash-write)";
			}
		} else {
			return; // Not a write operation
		}

		if (!filePath) return;

		const entry: Record<string, unknown> = {
			ts: new Date().toISOString(),
			tool: toolName,
			file: filePath,
			type: classifyFile(filePath),
			lines: lineCount,
			error: event.isError || false,
			session: SESSION_ID,
		};
		if (orchestrateContext) {
			entry.orchestrate_task_file = orchestrateContext;
		}

		entryCount++;

		// Append to evidence file (fire-and-forget, never block the agent)
		try {
			const line = JSON.stringify(entry);
			await pi.exec("bash", [
				"-c",
				`echo '${line.replace(/'/g, "'\\''")}' >> "${EVIDENCE_FILE}"`,
			], { timeout: 1000 });
		} catch {
			// Evidence collection should NEVER block or fail the agent
		}
	});

	// Diagnostic command
	pi.registerCommand("evidence", {
		description: "Evidence collector status: entry count, file path",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				`Evidence Collector:\n` +
				`  Session ID: ${SESSION_ID}\n` +
				`  Evidence file: ${EVIDENCE_FILE}\n` +
				`  Entries logged: ${entryCount}`,
				"info",
			);
		},
	});
}

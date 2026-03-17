/**
 * Tests for enforcement gate extensions:
 * - skill-first-gate.ts (memory-first blocking)
 * - skills-ci-gate.ts (CI scan enforcement after skill edits)
 *
 * Uses the same discoverAndLoadExtensions + ExtensionRunner pattern
 * as extensions-runner.test.ts.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.js";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.js";
import { ExtensionRunner } from "../src/core/extensions/runner.js";
import { ModelRegistry } from "../src/core/model-registry.js";
import { SessionManager } from "../src/core/session-manager.js";

// Read the actual extension source files
const EXTENSIONS_DIR = path.resolve(__dirname, "../../../.pi/extensions");

describe("enforcement gates", () => {
	let tempDir: string;
	let extensionsDir: string;
	let sessionManager: SessionManager;
	let modelRegistry: ModelRegistry;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-gates-test-"));
		extensionsDir = path.join(tempDir, "extensions");
		fs.mkdirSync(extensionsDir);
		sessionManager = SessionManager.inMemory();
		const authStorage = AuthStorage.create(path.join(tempDir, "auth.json"));
		modelRegistry = new ModelRegistry(authStorage);
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	async function loadRunner(...extNames: string[]): Promise<ExtensionRunner> {
		for (const name of extNames) {
			const src = fs.readFileSync(path.join(EXTENSIONS_DIR, name), "utf-8");
			fs.writeFileSync(path.join(extensionsDir, name), src);
		}
		const result = await discoverAndLoadExtensions([], tempDir, tempDir);
		return new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
	}

	describe("skill-first-gate", () => {
		it("blocks code exploration when memory has not been queried", async () => {
			const runner = await loadRunner("skill-first-gate.ts");

			// Simulate turn_start (resets state)
			await runner.emit({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });

			// Try to grep a .py file — should be blocked
			const result = await runner.emitToolCall({
				type: "tool_call",
				toolCallId: "tc-1",
				toolName: "grep",
				input: { pattern: "def foo", path: "/src/main.py" },
			});

			expect(result).toBeDefined();
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("Memory-first");
		});

		it("does not block when path is not code exploration", async () => {
			// Each extension gets its own pi proxy, so cross-extension state
			// sharing (memory-first → skill-first-gate) can't be tested in
			// isolation. Instead, test that non-code paths are never blocked.
			const runner = await loadRunner("skill-first-gate.ts");

			await runner.emit({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });

			// Reading a JSON config file — not code exploration
			const result = await runner.emitToolCall({
				type: "tool_call",
				toolCallId: "tc-2",
				toolName: "read",
				input: { file_path: "/home/user/.pi/scheduler/jobs.json" },
			});

			expect(result?.block).not.toBe(true);
		});

		it("always allows reading SKILL.md files", async () => {
			const runner = await loadRunner("skill-first-gate.ts");

			await runner.emit({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });

			// Reading a SKILL.md should be exempt even without memory query
			const result = await runner.emitToolCall({
				type: "tool_call",
				toolCallId: "tc-3",
				toolName: "read",
				input: { file_path: ".pi/skills/memory/SKILL.md" },
			});

			expect(result?.block).not.toBe(true);
		});

		it("always allows git commands", async () => {
			const runner = await loadRunner("skill-first-gate.ts");

			await runner.emit({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });

			const result = await runner.emitToolCall({
				type: "tool_call",
				toolCallId: "tc-4",
				toolName: "bash",
				input: { command: "git status" },
			});

			expect(result?.block).not.toBe(true);
		});

		it("does not block non-code-exploration tools", async () => {
			const runner = await loadRunner("skill-first-gate.ts");

			await runner.emit({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });

			// A non-code bash command should pass
			const result = await runner.emitToolCall({
				type: "tool_call",
				toolCallId: "tc-5",
				toolName: "bash",
				input: { command: "echo hello" },
			});

			expect(result?.block).not.toBe(true);
		});
	});

	describe("skills-ci-gate", () => {
		it("blocks after skill file edit until skills-ci runs", async () => {
			const runner = await loadRunner("skills-ci-gate.ts");

			await runner.emit({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });

			// Simulate editing a skill file (detected via tool_result)
			await runner.emitToolResult({
				type: "tool_result",
				toolCallId: "tr-1",
				toolName: "edit",
				input: { file_path: ".pi/skills/scheduler/executor.py" },
				content: [{ type: "text", text: "file edited" }],
				isError: false,
				details: undefined,
			});

			// Now any non-exempt code tool should be blocked
			// Use a path that doesn't match EXEMPT_PATTERNS
			const result = await runner.emitToolCall({
				type: "tool_call",
				toolCallId: "tc-6",
				toolName: "bash",
				input: { command: "rg 'def execute' packages/coding-agent/src/main.ts" },
			});

			expect(result).toBeDefined();
			expect(result?.block).toBe(true);
			expect(result?.reason).toContain("skills-ci");
		});

		it("unblocks after skills-ci is executed", async () => {
			const runner = await loadRunner("skills-ci-gate.ts");

			await runner.emit({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });

			// Edit a skill file
			await runner.emitToolResult({
				type: "tool_result",
				toolCallId: "tr-2",
				toolName: "edit",
				input: { file_path: ".pi/skills/memory/recall.py" },
				content: [{ type: "text", text: "file edited" }],
				isError: false,
				details: undefined,
			});

			// Run skills-ci (detected via tool_result for bash)
			await runner.emitToolResult({
				type: "tool_result",
				toolCallId: "tr-3",
				toolName: "bash",
				input: { command: "cd .pi/skills/skills-ci && uv run python skills_ci.py --mode scan" },
				content: [{ type: "text", text: "scan complete" }],
				isError: false,
				details: undefined,
			});

			// Now code tools should be allowed
			const result = await runner.emitToolCall({
				type: "tool_call",
				toolCallId: "tc-7",
				toolName: "bash",
				input: { command: "rg 'def recall' .pi/skills/memory/recall.py" },
			});

			expect(result?.block).not.toBe(true);
		});

		it("does not block when no skill files were edited", async () => {
			const runner = await loadRunner("skills-ci-gate.ts");

			await runner.emit({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });

			// Edit a non-skill file
			await runner.emitToolResult({
				type: "tool_result",
				toolCallId: "tr-4",
				toolName: "edit",
				input: { file_path: "src/main.ts" },
				content: [{ type: "text", text: "file edited" }],
				isError: false,
				details: undefined,
			});

			// Code tools should not be blocked
			const result = await runner.emitToolCall({
				type: "tool_call",
				toolCallId: "tc-8",
				toolName: "grep",
				input: { pattern: "import", path: "src/main.ts" },
			});

			expect(result?.block).not.toBe(true);
		});

		it("always exempts running skills-ci itself", async () => {
			const runner = await loadRunner("skills-ci-gate.ts");

			await runner.emit({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });

			// Edit a skill file
			await runner.emitToolResult({
				type: "tool_result",
				toolCallId: "tr-5",
				toolName: "edit",
				input: { file_path: ".pi/skills/memory/recall.py" },
				content: [{ type: "text", text: "file edited" }],
				isError: false,
				details: undefined,
			});

			// Running skills-ci should NOT be blocked
			const result = await runner.emitToolCall({
				type: "tool_call",
				toolCallId: "tc-9",
				toolName: "bash",
				input: { command: "cd .pi/skills/skills-ci && uv run python skills_ci.py --mode scan" },
			});

			expect(result?.block).not.toBe(true);
		});
	});
});

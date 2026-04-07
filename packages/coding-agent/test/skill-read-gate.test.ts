/**
 * Tests for skill-read-gate.ts extension.
 *
 * Enforces: agents must Read SKILL.md before executing a skill's run.sh.
 * Uses the same discoverAndLoadExtensions + ExtensionRunner pattern
 * as enforcement-gates.test.ts.
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

const EXTENSIONS_DIR = path.resolve(__dirname, "../../../.pi/extensions");

describe("skill-read-gate", () => {
	let tempDir: string;
	let extensionsDir: string;
	let sessionManager: SessionManager;
	let modelRegistry: ModelRegistry;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-read-gate-test-"));
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
		if (result.errors.length > 0) {
			throw new Error(`Extension load errors: ${result.errors.map((e) => `${e.path}: ${e.error}`).join("; ")}`);
		}
		expect(result.extensions.length).toBe(extNames.length);
		return new ExtensionRunner(result.extensions, result.runtime, tempDir, sessionManager, modelRegistry);
	}

	it("blocks skill execution without prior SKILL.md read", async () => {
		const runner = await loadRunner("skill-read-gate.ts");

		await runner.emit({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });

		// Try to run dogpile without reading its SKILL.md first
		const result = await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "tc-1",
			toolName: "bash",
			input: { command: ".pi/skills/dogpile/run.sh search --q 'test query'" },
		});

		expect(result).toBeDefined();
		expect(result?.block).toBe(true);
		expect(result?.reason).toContain("BLOCKED");
		expect(result?.reason).toContain("dogpile");
		expect(result?.reason).toContain("SKILL.md");
	});

	it("allows skill execution after SKILL.md is read", async () => {
		const runner = await loadRunner("skill-read-gate.ts");

		await runner.emit({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });

		// Simulate reading SKILL.md (tool_result from a Read call)
		await runner.emitToolResult({
			type: "tool_result",
			toolCallId: "tc-read",
			toolName: "read",
			input: { file_path: ".pi/skills/dogpile/SKILL.md" },
			content: [{ type: "text", text: "# dogpile\nDeep research..." }],
			isError: false,
			details: undefined,
		});

		// Now run the skill — should be allowed
		const result = await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "tc-2",
			toolName: "bash",
			input: { command: ".pi/skills/dogpile/run.sh search --q 'test query'" },
		});

		expect(result?.block).not.toBe(true);
	});

	it("resets read state on new turn", async () => {
		const runner = await loadRunner("skill-read-gate.ts");

		// Turn 0: read SKILL.md
		await runner.emit({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });
		await runner.emitToolResult({
			type: "tool_result",
			toolCallId: "tc-read",
			toolName: "read",
			input: { file_path: ".pi/skills/dogpile/SKILL.md" },
			content: [{ type: "text", text: "# dogpile" }],
			isError: false,
			details: undefined,
		});

		// Turn 1: state should be reset — block again
		await runner.emit({ type: "turn_start", turnIndex: 1, timestamp: Date.now() });

		const result = await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "tc-3",
			toolName: "bash",
			input: { command: ".pi/skills/dogpile/run.sh search --q 'test'" },
		});

		expect(result).toBeDefined();
		expect(result?.block).toBe(true);
	});

	it("exempts infrastructure skills (memory, assess, plan)", async () => {
		const runner = await loadRunner("skill-read-gate.ts");

		await runner.emit({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });

		// Memory skill should always be allowed without reading SKILL.md
		const memResult = await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "tc-mem",
			toolName: "bash",
			input: { command: ".pi/skills/memory/run.sh recall --q 'test'" },
		});
		expect(memResult?.block).not.toBe(true);

		// Assess skill exempt too
		const assessResult = await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "tc-assess",
			toolName: "bash",
			input: { command: ".pi/skills/assess/run.sh" },
		});
		expect(assessResult?.block).not.toBe(true);

		// Checkpoint exempt
		const cpResult = await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "tc-cp",
			toolName: "bash",
			input: { command: ".pi/skills/checkpoint/run.sh save -t test --grade clean --resume test" },
		});
		expect(cpResult?.block).not.toBe(true);
	});

	it("does not block non-skill bash commands", async () => {
		const runner = await loadRunner("skill-read-gate.ts");

		await runner.emit({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });

		// Git command — not a skill execution
		const gitResult = await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "tc-git",
			toolName: "bash",
			input: { command: "git status" },
		});
		expect(gitResult?.block).not.toBe(true);

		// ls command
		const lsResult = await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "tc-ls",
			toolName: "bash",
			input: { command: "ls -la /home/user/workspace" },
		});
		expect(lsResult?.block).not.toBe(true);

		// Python compile check
		const pyResult = await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "tc-py",
			toolName: "bash",
			input: { command: "python3 -c 'import json; print(json.dumps({}))'" },
		});
		expect(pyResult?.block).not.toBe(true);
	});

	it("does not block non-bash tool calls", async () => {
		const runner = await loadRunner("skill-read-gate.ts");

		await runner.emit({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });

		// Read tool — not bash, should not be blocked
		const result = await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "tc-read",
			toolName: "read",
			input: { file_path: "/home/user/workspace/src/main.py" },
		});
		expect(result?.block).not.toBe(true);
	});

	it("tracks multiple skills independently", async () => {
		const runner = await loadRunner("skill-read-gate.ts");

		await runner.emit({ type: "turn_start", turnIndex: 0, timestamp: Date.now() });

		// Read dogpile SKILL.md
		await runner.emitToolResult({
			type: "tool_result",
			toolCallId: "tc-r1",
			toolName: "read",
			input: { file_path: ".pi/skills/dogpile/SKILL.md" },
			content: [{ type: "text", text: "# dogpile" }],
			isError: false,
			details: undefined,
		});

		// Dogpile should be allowed
		const dogpileResult = await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "tc-d",
			toolName: "bash",
			input: { command: ".pi/skills/dogpile/run.sh search --q 'test'" },
		});
		expect(dogpileResult?.block).not.toBe(true);

		// But surf should still be blocked (haven't read its SKILL.md)
		const surfResult = await runner.emitToolCall({
			type: "tool_call",
			toolCallId: "tc-s",
			toolName: "bash",
			input: { command: ".pi/skills/surf/run.sh go --url http://example.com" },
		});
		expect(surfResult).toBeDefined();
		expect(surfResult?.block).toBe(true);
		expect(surfResult?.reason).toContain("surf");
	});
});

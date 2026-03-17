/**
 * E2E Readiness Tests for Pi Migration
 *
 * Tests via CLI invocations and filesystem checks ONLY.
 * NO imports from src/ (jiti hangs on import.meta.url in config.ts).
 */

import { execSync } from "child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { afterEach, describe, expect, it } from "vitest";

const PI_CLI = resolve(__dirname, "../dist/cli.js");
const EXTENSIONS_DIR = resolve(__dirname, "../../../.pi/extensions");
const AGENTS_DIR = resolve(__dirname, "../../../.pi/agents");
const SKILLS_DIR = resolve(__dirname, "../../../.pi/skills");

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "pi-e2e-"));
}

function pi(
	args: string[],
	opts: { timeout?: number; env?: Record<string, string> } = {},
): {
	stdout: string;
	stderr: string;
	exit: number;
} {
	try {
		const out = execSync(`node ${PI_CLI} ${args.join(" ")}`, {
			timeout: opts.timeout || 15000,
			encoding: "utf-8",
			env: { ...process.env, ...opts.env },
			stdio: ["pipe", "pipe", "pipe"],
		});
		return { stdout: out, stderr: "", exit: 0 };
	} catch (e: any) {
		return { stdout: e.stdout?.toString() || "", stderr: e.stderr?.toString() || "", exit: e.status ?? 1 };
	}
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. BOOTSTRAP
// ═══════════════════════════════════════════════════════════════════════════

describe("1. Bootstrap", () => {
	it("cli.js exists", () => {
		expect(existsSync(PI_CLI)).toBe(true);
	});

	it("--help exits 0", () => {
		const r = pi(["--help"]);
		expect(r.exit).toBe(0);
		expect(r.stdout).toContain("--provider");
	});

	it("non-TTY exits gracefully", () => {
		const r = pi([], { timeout: 5000, env: { PI_STDIN_TIMEOUT_MS: "200" } });
		expect(r.exit).toBeLessThan(128);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. PROVIDERS
// ═══════════════════════════════════════════════════════════════════════════

describe("2. Providers", () => {
	it("invalid provider does not crash", () => {
		const r = pi(["--provider", "nonexistent", "-p", '"hi"', "--no-session"], { timeout: 10000 });
		expect(r.exit).toBeLessThan(128);
	});

	it("anthropic responds", () => {
		if (!process.env.ANTHROPIC_API_KEY) return;
		const r = pi(
			[
				"--provider",
				"anthropic",
				"--model",
				"claude-sonnet-4-20250514",
				"-p",
				'"Say PONG"',
				"--no-session",
				"--no-tools",
			],
			{ timeout: 30000 },
		);
		expect(r.exit).toBe(0);
		expect(r.stdout.toLowerCase()).toContain("pong");
	});

	it("google responds", () => {
		if (!process.env.GEMINI_API_KEY) return;
		const r = pi(
			["--provider", "google", "--model", "gemini-2.5-flash", "-p", '"Say PONG"', "--no-session", "--no-tools"],
			{ timeout: 30000 },
		);
		expect(r.exit).toBe(0);
		expect(r.stdout.toLowerCase()).toContain("pong");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. TOOLS (read a file via Claude)
// ═══════════════════════════════════════════════════════════════════════════

describe("3. Tools", () => {
	let dir: string;
	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it("can read a file via tool use", () => {
		if (!process.env.ANTHROPIC_API_KEY) return;
		dir = tempDir();
		writeFileSync(join(dir, "canary.txt"), "CANARY_99887");
		const r = pi(
			[
				"--provider",
				"anthropic",
				"--model",
				"claude-sonnet-4-20250514",
				"-p",
				`"Read ${join(dir, "canary.txt")} and reply with just its contents"`,
				"--no-session",
			],
			{ timeout: 60000 },
		);
		expect(r.exit).toBe(0);
		expect(r.stdout).toContain("CANARY_99887");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. SKILLS (filesystem checks, no src/ imports)
// ═══════════════════════════════════════════════════════════════════════════

describe("4. Skills", () => {
	it("canonical skills dir has 100+ skills", () => {
		const skills = readdirSync(SKILLS_DIR).filter((d) => existsSync(join(SKILLS_DIR, d, "SKILL.md")));
		expect(skills.length).toBeGreaterThan(100);
	});

	it("core skills exist (memory, assess, plan, orchestrate, dogpile)", () => {
		for (const s of ["memory", "assess", "plan", "orchestrate", "dogpile", "checkpoint"]) {
			expect(existsSync(join(SKILLS_DIR, s, "SKILL.md")), `missing: ${s}`).toBe(true);
		}
	});

	it("no duplicate SKILL.md names", () => {
		const skills = readdirSync(SKILLS_DIR).filter((d) => existsSync(join(SKILLS_DIR, d, "SKILL.md")));
		expect(skills.length).toBe(new Set(skills).size);
	});

	it("all SKILL.md have frontmatter with description", () => {
		const skills = readdirSync(SKILLS_DIR).filter((d) => existsSync(join(SKILLS_DIR, d, "SKILL.md")));
		const failures: string[] = [];
		for (const s of skills) {
			const content = readFileSync(join(SKILLS_DIR, s, "SKILL.md"), "utf-8");
			if (!content.startsWith("---")) failures.push(`${s}: no frontmatter`);
			else if (!content.match(/description:\s*[>|]?\s*\S/)) failures.push(`${s}: no description`);
		}
		expect(failures, failures.join("\n")).toHaveLength(0);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. EXTENSIONS
// ═══════════════════════════════════════════════════════════════════════════

describe("5. Extensions", () => {
	it("10+ active extensions", () => {
		const exts = readdirSync(EXTENSIONS_DIR).filter((f) => f.endsWith(".ts") && !f.includes(".disabled"));
		expect(exts.length).toBeGreaterThan(10);
	});

	it("critical extensions exist", () => {
		for (const e of ["skill-selector.ts", "best-practices-gate.ts", "verification-gate.ts", "memory-first.ts"]) {
			expect(existsSync(join(EXTENSIONS_DIR, e)), `missing: ${e}`).toBe(true);
		}
	});

	it("skill-selector has CORE_SKILLS with memory/assess/plan", () => {
		const content = readFileSync(join(EXTENSIONS_DIR, "skill-selector.ts"), "utf-8");
		expect(content).toContain("memory");
		expect(content).toContain("assess");
		expect(content).toContain("plan");
		expect(content).toContain("before_agent_start");
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. AGENTS
// ═══════════════════════════════════════════════════════════════════════════

describe("6. Agents", () => {
	it("5+ persona agents", () => {
		const agents = readdirSync(AGENTS_DIR).filter((d) => existsSync(join(AGENTS_DIR, d, "AGENTS.md")));
		expect(agents.length).toBeGreaterThan(5);
	});

	it("all AGENTS.md have name in frontmatter", () => {
		const agents = readdirSync(AGENTS_DIR).filter((d) => existsSync(join(AGENTS_DIR, d, "AGENTS.md")));
		for (const a of agents) {
			const content = readFileSync(join(AGENTS_DIR, a, "AGENTS.md"), "utf-8");
			expect(content.startsWith("---"), `${a}: no frontmatter`).toBe(true);
			expect(content, `${a}: no name`).toMatch(/name:\s+\S/);
		}
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. SKILL-SELECTOR REGEX
// ═══════════════════════════════════════════════════════════════════════════

describe("7. Skill-Selector Logic", () => {
	function parseSlashRefs(prompt: string): string[] {
		const matches: string[] = [];
		const skip = new Set(["home", "tmp", "dev", "etc", "usr", "var", "mnt", "opt", "proc", "sys"]);
		const re = /\/([a-z][a-z0-9-]{1,63})(?:\s|$|[.,;:!?)])/gi;
		for (const m of prompt.matchAll(re)) {
			if (!skip.has(m[1].toLowerCase())) matches.push(m[1].toLowerCase());
		}
		const endRe = /\/([a-z][a-z0-9-]{1,63})$/gi;
		for (const m of prompt.matchAll(endRe)) {
			if (!skip.has(m[1].toLowerCase()) && !matches.includes(m[1].toLowerCase())) matches.push(m[1].toLowerCase());
		}
		return matches;
	}

	it("extracts /memory", () => expect(parseSlashRefs("/memory recall")).toContain("memory"));
	it("extracts hyphenated /create-design-board", () =>
		expect(parseSlashRefs("/create-design-board x")).toContain("create-design-board"));
	it("extracts multiple", () => {
		const r = parseSlashRefs("/dogpile then /review-plan");
		expect(r).toContain("dogpile");
		expect(r).toContain("review-plan");
	});
	it("skips /home /tmp /dev", () => {
		expect(parseSlashRefs("/home/graham")).not.toContain("home");
		expect(parseSlashRefs("/tmp/x")).not.toContain("tmp");
	});
	it("empty for no slashes", () => expect(parseSlashRefs("no skills")).toHaveLength(0));
	it("end of string", () => expect(parseSlashRefs("run /checkpoint")).toContain("checkpoint"));
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. EDGE CASES
// ═══════════════════════════════════════════════════════════════════════════

describe("8. Edge Cases", () => {
	it("empty prompt no crash", () => {
		const r = pi(["-p", '""', "--no-session", "--no-tools"], { timeout: 10000 });
		expect(r.exit).toBeLessThan(128);
	});

	it("unicode no crash", () => {
		const r = pi(["-p", '"你好"', "--no-session", "--no-tools"], { timeout: 10000 });
		expect(r.exit).toBeLessThan(128);
	});
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. NO SYSTEM-REMINDER RE-INJECTION
// ═══════════════════════════════════════════════════════════════════════════

describe("9. No Skill Re-Injection (the Claude Code bug)", () => {
	it("Pi source has no system-reminder pattern", () => {
		const srcDir = resolve(__dirname, "../src");
		const result = execSync(`grep -rl "system-reminder" ${srcDir} 2>/dev/null || true`, { encoding: "utf-8" });
		expect(result.trim()).toBe("");
	});

	it("Pi source builds system prompt as a string, not per-message callback", () => {
		const content = readFileSync(resolve(__dirname, "../src/core/system-prompt.ts"), "utf-8");
		// buildSystemPrompt returns string, called once
		expect(content).toContain("export function buildSystemPrompt");
		expect(content).toContain("return prompt");
		// NOT a per-message generator
		expect(content).not.toContain("yield");
		expect(content).not.toContain("AsyncGenerator");
	});
});

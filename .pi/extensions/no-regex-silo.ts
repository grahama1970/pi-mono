import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

/**
 * No Regex Silo Extension — Block the regex-as-classification anti-pattern.
 *
 * Ports Claude Code's no-regex-silo.sh to Pi with REAL blocking.
 *
 * Problem: Agents love building giant frozensets, re.compile() dictionaries,
 * and stopword lists as classification engines inside Python files. This is
 * the #1 anti-pattern in Embry OS — it creates unmaintainable silos that
 * duplicate what /taxonomy, /extract-entities, and /assistant already provide.
 *
 * Detection heuristics:
 *   1. Large frozensets (>30 elements) — usually entity classification
 *   2. Multiple re.compile() calls (>5) — usually regex-based routing
 *   3. Stopword/keyword lists (>50 items) — usually hand-rolled NLP
 *   4. Dict literals with >20 regex patterns — entity/type classification
 *
 * Claude Code limitation: exit 2 injects advisory text that agents ignore.
 * This extension returns { block: true } on Edit/Write of .py files.
 *
 * Idempotent with Claude Code hooks — safe to run alongside during migration.
 */

// -- Configuration -----------------------------------------------------------

/** Tools that write file content */
const WRITE_TOOLS = new Set(["edit", "write"]);

/** Minimum frozenset element count to flag */
const FROZENSET_THRESHOLD = 30;

/** Minimum re.compile() count to flag */
const RECOMPILE_THRESHOLD = 5;

/** Minimum list/set literal element count to flag (stopwords, keywords) */
const LIST_THRESHOLD = 50;

/** Minimum dict entries with regex-like values to flag */
const REGEX_DICT_THRESHOLD = 20;

// -- Detection ---------------------------------------------------------------

interface Violation {
	rule: string;
	detail: string;
}

function detectRegexSilo(content: string): Violation[] {
	const violations: Violation[] = [];

	// 1. Large frozensets: frozenset({...}) or frozenset([...]) with many items
	const frozensetMatch = content.match(/frozenset\s*\(\s*[\[{]([\s\S]*?)[\]}]\s*\)/g);
	if (frozensetMatch) {
		for (const match of frozensetMatch) {
			const commaCount = (match.match(/,/g) || []).length;
			if (commaCount >= FROZENSET_THRESHOLD) {
				violations.push({
					rule: "large-frozenset",
					detail: `frozenset with ~${commaCount + 1} elements. Use /taxonomy or /extract-entities instead of hand-rolled classification.`,
				});
			}
		}
	}

	// 2. Multiple re.compile() calls — regex-based routing/classification
	const reCompileMatches = content.match(/re\.compile\s*\(/g);
	if (reCompileMatches && reCompileMatches.length >= RECOMPILE_THRESHOLD) {
		violations.push({
			rule: "regex-classification",
			detail: `${reCompileMatches.length} re.compile() calls detected. Use /taxonomy or /assistant classifier instead of regex-based entity routing.`,
		});
	}

	// 3. Large list/set literals (stopwords, keywords, entity lists)
	//    Match: SOMETHING = [...] or SOMETHING = {...} with many string items
	const largeLiteralPattern = /(?:STOP|KEY|ENTITY|WORD|TERM|CLASSIF|CATEGOR|TYPE|TAG|LABEL)\w*\s*[:=]\s*[\[{]([\s\S]*?)[\]}]/gi;
	let literalMatch;
	while ((literalMatch = largeLiteralPattern.exec(content)) !== null) {
		const body = literalMatch[1];
		const itemCount = (body.match(/["']/g) || []).length / 2; // rough count of string items
		if (itemCount >= LIST_THRESHOLD) {
			violations.push({
				rule: "large-keyword-list",
				detail: `~${Math.round(itemCount)} string items in a classification list. Use /taxonomy tags or /assistant classifier.`,
			});
		}
	}

	// 4. Dict literals mapping strings to regex patterns
	const dictPatterns = content.match(/r["'][^"']*\\[bdwsBDWS][^"']*["']\s*:/g);
	if (dictPatterns && dictPatterns.length >= REGEX_DICT_THRESHOLD) {
		violations.push({
			rule: "regex-dict-classification",
			detail: `${dictPatterns.length} regex patterns in a dict. Use /taxonomy or /extract-entities skill.`,
		});
	}

	return violations;
}

// -- Extension ---------------------------------------------------------------

export default function noRegexSilo(pi: ExtensionAPI) {
	let blockedCount = 0;

	pi.on("tool_call", async (event) => {
		if (!WRITE_TOOLS.has(event.toolName)) return;

		const input = (event.input || {}) as any;
		const filePath: string = input.file_path || "";

		// Only check Python files
		if (!filePath.endsWith(".py")) return;

		// Get the content being written
		let content = "";
		if (event.toolName === "edit" && typeof input.new_string === "string") {
			content = input.new_string;
		} else if (event.toolName === "write" && typeof input.content === "string") {
			content = input.content;
		}

		if (!content || content.length < 100) return;

		const violations = detectRegexSilo(content);

		if (violations.length > 0) {
			blockedCount++;
			const details = violations
				.map((v) => `  - [${v.rule}] ${v.detail}`)
				.join("\n");

			return {
				block: true,
				reason:
					`BLOCKED [no-regex-silo]: Regex-as-classification anti-pattern detected in ${filePath}:\n` +
					details +
					"\n\nExisting skills handle classification:\n" +
					"  /taxonomy — Federated Taxonomy tag extraction\n" +
					"  /extract-entities — Entity extraction from documents\n" +
					"  /assistant — GPT classifier for structured routing\n" +
					"Refactor to use these skills instead of hand-rolled regex/frozenset silos.",
			};
		}
	});

	// Diagnostic command
	pi.registerCommand("regex-silo", {
		description: "No-regex-silo gate status: blocked count",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				`No Regex Silo Gate:\n` +
				`  Total blocks (session): ${blockedCount}\n` +
				`  Thresholds: frozenset>${FROZENSET_THRESHOLD}, re.compile>${RECOMPILE_THRESHOLD}, list>${LIST_THRESHOLD}, regex-dict>${REGEX_DICT_THRESHOLD}`,
				"info",
			);
		},
	});
}

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const MEMORY_SKILL = ".pi/skills/memory/run.sh";
const MAX_PROMPT_LENGTH = 200;
const SKIP_PATTERNS = [/^\//, /^help\b/i, /^clear\b/i];
const MIN_DENSE_SCORE = 0.45;
const API = "http://localhost:3001";

export default function memoryFirst(pi: ExtensionAPI) {
	(pi as any).state = (pi as any).state || {};

	pi.on("before_agent_start", async (event, ctx) => {
		const prompt = event.prompt?.trim();
		if (!prompt || prompt.length < 10) {
			(pi as any).state.memoryQueriedThisTurn = true;
			return;
		}

		if (SKIP_PATTERNS.some((p) => p.test(prompt))) {
			(pi as any).state.memoryQueriedThisTurn = true;
			return;
		}

		try {
			// Step 1: Intent classification — is this even a memory query?
			let shouldRecall = false;
			try {
				const intentRes = await fetch(`${API}/api/memory/intent`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ q: prompt.substring(0, MAX_PROMPT_LENGTH), scope: "" }),
					signal: AbortSignal.timeout(5000),
				});
				if (intentRes.ok) {
					const intent = await intentRes.json();
					const action = intent.action ?? "NO_MATCH";
					// Only recall for QUERY actions — skip commands, chat, emotions, complaints
					shouldRecall = action === "QUERY";
				}
			} catch {
				// Intent service unavailable — skip recall silently
				(pi as any).state.memoryQueriedThisTurn = true;
				return;
			}

			if (!shouldRecall) {
				(pi as any).state.memoryQueriedThisTurn = true;
				return;
			}

			// Step 2: Recall with relevance filtering
			const queryText = prompt.substring(0, MAX_PROMPT_LENGTH);
			const result = await pi.exec("bash", [
				"-c",
				`${MEMORY_SKILL} recall --q "${queryText.replace(/"/g, '\\"')}" 2>/dev/null || echo '{"found":false}'`,
			]);

			(pi as any).state.memoryQueriedThisTurn = true;

			if (!result.stdout) return;

			const lines = result.stdout.trim().split("\n");
			let parsed: any = null;
			for (let i = lines.length - 1; i >= 0; i--) {
				try {
					parsed = JSON.parse(lines[i]);
					break;
				} catch {
					continue;
				}
			}

			if (!parsed) return;

			const items = parsed.items || parsed.results || [];
			if (items.length === 0) return;

			// Filter by dense relevance score
			const relevant = items.filter((item: any) => {
				const dense = item.scores?.dense ?? 0;
				return dense >= MIN_DENSE_SCORE;
			});

			if (relevant.length === 0) return;

			// Build concise output — NO embeddings, NO float arrays
			const solutions = relevant
				.slice(0, 3)
				.map((item: any) => {
					const problem = item.problem || item.fact || "";
					const solution = item.solution || item.playbook || item.content || "";
					const trimmed = solution.length > 500 ? solution.substring(0, 500) + "..." : solution;
					return `Problem: ${problem}\nSolution: ${trimmed}`;
				})
				.join("\n\n");

			if (!solutions) return;

			return {
				message: {
					customType: "memory-recall",
					content: `[Memory Recall] Found ${relevant.length} relevant result(s):\n\n${solutions}`,
					display: false,
					details: {
						source: "memory-first-extension",
						results_count: relevant.length,
						min_dense_score: MIN_DENSE_SCORE,
					},
				},
			};
		} catch {
			(pi as any).state.memoryQueriedThisTurn = true;
		}
	});
}

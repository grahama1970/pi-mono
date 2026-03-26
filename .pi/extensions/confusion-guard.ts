/**
 * Pi extension: Confusion Guard
 *
 * Detects the search → fail → reimplement pattern and forces the agent
 * to ask the human before writing bespoke code.
 *
 * Pattern:
 *   1. Agent searched for a skill/capability (Grep/Glob tool calls)
 *   2. Got empty or unexpected results
 *   3. Next tool call is Edit/Write creating new implementation
 *
 * This extension tracks recent search failures and intercepts writes
 * that look like reimplementations of existing skills.
 *
 * Only works in Pi — Claude Code hooks are stateless and can't see
 * the search→fail→write sequence across tool calls.
 */

interface SearchContext {
  query: string;
  tool: string;
  timestamp: number;
  hadResults: boolean;
}

// Rolling window of recent search results
const recentSearches: SearchContext[] = [];
const WINDOW_MS = 60_000; // 60 second window

// Skills that should never be reimplemented
const PROTECTED_CAPABILITIES: Record<string, string[]> = {
  "/scillm": ["chat/completions", "v1/messages", "api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com"],
  "/memory": ["_api/cursor", "arangosh", "AQL", "FOR.*IN.*FILTER.*RETURN"],
  "/prompt-lab": ["system_prompt", "SYSTEM_PROMPT", "you are a", "your role is"],
  "/treesitter": ["ast.walk", "ast.parse", "ast.Import"],
  "/taxonomy": ["frozenset", "re.compile.*categories", "re.search.*if.*re.search.*if"],
};

// Files that are ALLOWED to implement these (they ARE the skill)
const EXEMPT_PATHS = [
  "skills/scillm", "skills/subagent-service", "skills/prompt-lab",
  "skills/memory", "skills/treesitter", "skills/taxonomy",
  "skills/assistant", "skills/skills-ci", "skills/test-lab",
  "graph_memory", "treesitter_tools",
];

function pruneOldSearches(): void {
  const cutoff = Date.now() - WINDOW_MS;
  while (recentSearches.length > 0 && recentSearches[0].timestamp < cutoff) {
    recentSearches.shift();
  }
}

function hasRecentSearchFailure(): boolean {
  pruneOldSearches();
  return recentSearches.some(s => !s.hadResults);
}

function isExemptPath(filePath: string): boolean {
  return EXEMPT_PATHS.some(p => filePath.includes(p));
}

function detectReimplementation(content: string): string | null {
  for (const [skill, patterns] of Object.entries(PROTECTED_CAPABILITIES)) {
    for (const pattern of patterns) {
      if (content.includes(pattern)) {
        return skill;
      }
    }
  }
  return null;
}

export default {
  name: "confusion-guard",

  hooks: {
    /**
     * PostToolUse: Track search results to detect empty/failed searches.
     */
    PostToolUse: async (event: any) => {
      const toolName = event?.tool_name;
      if (!toolName) return;

      // Track Grep/Glob results
      if (toolName === "Grep" || toolName === "Glob") {
        const output = event?.output || "";
        const query = event?.input?.pattern || event?.input?.query || "";
        const hadResults = output.length > 10 && !output.includes("No files found") && !output.includes("No matches");

        recentSearches.push({
          query,
          tool: toolName,
          timestamp: Date.now(),
          hadResults,
        });

        // Keep window manageable
        if (recentSearches.length > 20) {
          recentSearches.splice(0, recentSearches.length - 20);
        }
      }
    },

    /**
     * PreToolUse: Block writes that reimplement protected skills after search failures.
     */
    PreToolUse: async (event: any) => {
      const toolName = event?.tool_name;
      if (toolName !== "Edit" && toolName !== "Write") return;

      const filePath = event?.input?.file_path || "";
      if (!filePath.endsWith(".py")) return;
      if (isExemptPath(filePath)) return;

      const content = event?.input?.content || event?.input?.new_string || "";
      if (!content) return;

      const reimplSkill = detectReimplementation(content);
      if (!reimplSkill && !hasRecentSearchFailure()) return;

      if (reimplSkill) {
        return {
          decision: "block",
          reason: [
            `CONFUSION GUARD: You appear to be reimplementing ${reimplSkill} in ${filePath}.`,
            ``,
            `STOP. Ask the human: "I need ${reimplSkill}'s capability but can't find what I need. Should I extend it or is there another way?"`,
            ``,
            `Do NOT reimplement existing skills. The human will tell you the right path.`,
          ].join("\n"),
        };
      }
    },
  },
};

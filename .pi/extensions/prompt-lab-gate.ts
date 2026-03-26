/**
 * Pi extension: prompt-lab enforcement gate.
 *
 * Blocks writes of Python files containing inline LLM prompts (>200 chars
 * with 2+ prompt indicators). Forces use of /prompt-lab for all prompts.
 *
 * Also warns when prompt .txt files are written without a prompt-lab hash header.
 *
 * Works in both Pi and Claude Code (via equivalent bash hook).
 */

import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";

const PROMPT_INDICATORS = [
  "you are", "you're a", "as an ai", "as a helpful",
  "system message", "system prompt", "your role is", "your task is",
  "respond with", "respond in", "answer the following",
  "given the following", "instructions:", "you must",
  "do not hallucinate",
];

const HASH_PREFIX = "# prompt-lab-hash: sha256:";

export default {
  name: "prompt-lab-gate",
  event: "PostToolUse",
  matcher: /^(Edit|Write)$/,

  async handler(event: any) {
    const filePath = event?.input?.file_path;
    if (!filePath) return;

    // Check 1: Python files with inline prompts
    if (filePath.endsWith(".py") && existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8");
        // Quick check: find string literals >200 chars with prompt indicators
        // Use a simple heuristic — the real check is in treesitter/skills-ci
        const tripleQuoteBlocks = content.match(/"""[\s\S]{200,}?"""|'''[\s\S]{200,}?'''/g) || [];
        const fStringBlocks = content.match(/f"""[\s\S]{200,}?"""|f'''[\s\S]{200,}?'''/g) || [];
        const allBlocks = [...tripleQuoteBlocks, ...fStringBlocks];

        for (const block of allBlocks) {
          const lower = block.toLowerCase();
          const hits = PROMPT_INDICATORS.filter(ind => lower.includes(ind)).length;
          if (hits >= 2) {
            return {
              decision: "block",
              reason: `Inline LLM prompt detected in ${filePath} (${block.length} chars, ${hits} indicators). Use /prompt-lab to create, evaluate, and seal prompts.`,
            };
          }
        }
      } catch {
        // File read error — skip
      }
    }

    // Check 2: Prompt .txt files should have hash header
    if (filePath.includes("/prompts/") && filePath.endsWith(".txt") && existsSync(filePath)) {
      try {
        const content = readFileSync(filePath, "utf-8");
        const firstLine = content.split("\n")[0] || "";
        if (!firstLine.startsWith(HASH_PREFIX)) {
          // Warning only — prompt needs sealing after eval
          console.error(
            `WARNING: Prompt file ${filePath} has no prompt-lab hash. ` +
            `Run: python prompt_hash.py seal ${filePath} --score <eval-score>`
          );
        }
      } catch {
        // Skip
      }
    }

    return undefined; // Allow
  },
};

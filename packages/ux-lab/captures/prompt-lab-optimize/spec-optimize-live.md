# Prompt Lab — Optimize Live Tab Spec

## What It Is
Developer tool for iterating LLM system prompts. Shows prompt evolution round-by-round until the prompt produces correct output in ONE request with ZERO corrections.

## Who Uses It
ML engineer evaluating 2-3 models simultaneously. Needs to see: which model converges fastest, what the optimized prompt looks like, whether to approve/reject.

## Layout
Side-by-side independent model lanes (like VS Code split editors or Weights & Biases parallel coordinates). Each lane scrolls independently. Thick purple divider between lanes.

### Each lane contains (top to bottom):
1. **Lane header**: Model name (DeepSeek-V3 / qwen2.5:7b) + status badge (Running/Converged/Failed) + round counter "Round 2/5"
2. **Ground truth** (shown once): 3 test cases with colored tag pills (purple=conceptual, blue=tactical)
3. **Round sections** (repeat per round):
   - Round number badge
   - System prompt text (monospace, full text). On round 2+, show diff highlighting (green=added, red strikethrough=removed)
   - Results: compact table — case name | predicted tags | F1 score | pass/fail icon
   - Failure brief (red-tinted box): "Hallucinated: Evade (×2). Missing: Persist"
   - Agent rewrite explanation (amber box): "Added negative example for Evade disambiguation"
   - Score comparison: big numbers "0.619 → 0.929" with green delta arrow
4. **Convergence banner**: Green "CONVERGED" or amber "STILL OPTIMIZING"
5. **Bottom bar**: Approve & Save All (green) | Reject (outline) buttons

## Real Data (populate with this)
- Prompt: "You are a cybersecurity taxonomy classifier. Extract conceptual and tactical bridge tags..."
- Test cases: T1547.001 Registry Run Keys (expected: Corruption, Persist), SI-2 Flaw Remediation (expected: Resilience, Fragility, Harden), d3f:NetworkIsolation (expected: Resilience, Isolate)
- DeepSeek-V3: converges in 2 rounds (F1: 0.619 → 0.929)
- qwen2.5:7b: needs 4 rounds (F1: 0.333 → 0.619 → 0.762 → 0.881)

## Theme
NVIS MIL-STD-3009 dark: bg #0b1220, surface #111827, border #1e293b, text #e2e8f0, accent purple #7c3aed, green #00ff88, red #ff4444, amber #ffaa00. Font: Inter + SF Mono.

## What NOT To Do
- No tabs within this view (it IS a tab in the parent explorer)
- No charts or graphs
- No sidebar navigation
- No marketing copy
- Don't synchronize round numbers between lanes
- Don't repeat ground truth in every round

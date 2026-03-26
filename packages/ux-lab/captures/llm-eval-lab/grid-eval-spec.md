# LLM Eval Lab — Grid Evaluation View

## What This Is
A model benchmarking dashboard that displays question-by-model comparison grids. Shows which LLM models pass or fail on specific test questions, with retry counts and error states. Helps engineers pick the smallest model that works for their task.

## The User
An ML engineer or architect comparing 3-8 LLM models across 5-20 test questions. They want to scan the grid, see the pattern, and pick a model in under 10 seconds.

## Real Data

**Models (column headers):**
- Qwen2.5-3B (1.7B, local)
- Qwen2.5-7B (7B, local)
- Qwen2.5-14B (14B, local)
- Qwen3-4B (4B, local)
- Qwen3-8B (8B, local)
- DeepSeek-V3 (671B, chutes)

**Questions (rows):**
| # | Short | Expected |
|---|-------|----------|
| 1 | Simple math | 42 |
| 2 | Multi-step word problem | 25 |
| 3 | Basic coding | def is_palindrome |
| 4 | JSON output | valid JSON |
| 5 | Factual QA | Paris |
| 6 | Instruction following | 3 items |
| 7 | Reasoning | no |
| 8 | Safety refusal | refuses |
| 9 | Translation | hola mundo |
| 10 | Summarization | non-empty |

**Cell states:**
- Pass (green) — correct on first try
- Pass/2 (amber) — correct on 2nd retry
- Pass/3 (amber) — correct on 3rd retry
- Fail (red) — wrong after all retries
- Err (magenta) — model timeout/unreachable

**Footer row:** Totals per model: "8/10 (1r)" means 8 passed, 1 retry needed

**Recommendation banner:** "Minimum viable: Qwen2.5-7B (9/10, 1 retry, 7B)"

## Layout

```
┌─────────────────────────────────────────────────────────┐
│ [Result file dropdown ▼]  Threshold: [===●===] 80%      │
├─────────────────────────────────────────────────────────┤
│ #  Question        Expected   Q2.5-3B  Q2.5-7B  Q3-4B  │
│ 1  Simple math     42         Pass     Pass     Pass    │
│ 2  Multi-step      25         Fail     Pass     Pass/2  │
│ 3  Basic coding    def is..   Fail     Pass     Pass    │
│ ...                                                      │
│    TOTAL                      4/10     9/10     9/10(1r)│
├─────────────────────────────────────────────────────────┤
│ ★ Minimum viable: Qwen2.5-7B (9/10, 1 retry, 7B)      │
│   Most reliable: Qwen3-8B (10/10, 0 retries)           │
└─────────────────────────────────────────────────────────┘
```

## What NOT To Create
- No config panel for system prompts or model selection (agent handles that)
- No run button (results come from pre-computed JSON files)
- No emoji icons for pass/fail (use colored text like PromptFoo)
- No hover tooltips with full model output (keep it scannable)
- No pie charts or bar graphs

---
from: memory
type: request
priority: normal
date: 2026-03-15
---

# FEATURE: Extract skill_chain field from session transcripts

`/episodic-archiver` and `/mine-transcripts` should extract the winning skill chain as a first-class field when processing session transcripts.

## Problem

Skill chains used to solve problems are buried in raw transcript tool call sequences. Not extracted as structured data. Agents pick skills via vibes-based system prompt pattern matching instead of consulting proven execution history.

## Proposed Change

1. `/episodic-archiver`: At session end, the agent should summarize which `/skill-name` invocations formed the winning solution chain (vs dead ends/retries). Store as a `skill_chain` field on the episode document.

2. `/mine-transcripts`: When mining past transcripts, emit `{problem, solution, skill_chain}` tuples where chain comes from actual tool calls.

3. Both should call `/memory learn` with the skill chain in the solution field:
   ```
   /memory learn --problem "..." --solution "skill chain: /X -> /Y -> /Z. Rationale: ..." --tag skill-chain --tag session-end
   ```

## Why This Matters

- `/memory recall` then returns battle-tested chains for similar problems -- supersedes `/recommend-skill-chain` for warm-start routing
- `chain-rationale` GPT (T1.5 in `/assistant`) becomes cold-start fallback only
- The `chain_miner` that trained the chain-rationale GPT from 668 transcripts did this retrospectively -- it should happen live every session
- Only the AGENT can distinguish winning chain from dead ends -- a deterministic parser cannot

## Reference

See `memory/project_skill_chain_capture.md` in the memory project for full architectural context.

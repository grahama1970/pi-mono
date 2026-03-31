---
name: No regex for intent/command parsing
description: NEVER use regex or .includes() heuristics for NL→action classification. Use /memory intent endpoint.
type: feedback
---

All NL→action routing goes through `/memory intent` endpoint (IntentMapper 8-step cascade).
No regex, no `.includes()` heuristics, no bespoke string matching for commands like zoom/expand/filter.

**Why:** Agent built regex heuristic tier C (lines 1263-1284) that second-guessed the /memory intent result. Also built regex overrides (lines 1276-1282) that overrode LLM intent with `.includes('click')` checks. Both removed 2026-03-30. Regex intent parsing has 0% long-term success rate per project feedback.

**How to apply:** Binary Explorer chat uses two tiers only:
1. Fast cache: `/memory recall` with `intent-training-v2` labels (>0.85 = instant)
2. Full pipeline: `POST /memory/intent` with `scope: 'binary-explorer'`
All Embry OS apps use the same `/memory intent` endpoint with different `scope` values.

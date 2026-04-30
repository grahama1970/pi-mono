# /ask scillm grounding verifier review

## Reviewer Instructions

Review this as a code review request for Web GPT or another external reviewer.
Focus on correctness, regression risk, security, maintainability, test coverage, and mismatches between the stated intent and the actual diff.
Do not rewrite the entire implementation unless the diff is fundamentally unsafe.
Return findings first, grouped by severity, with concrete file/function references where possible.


## Decision Needed

Is branch ask-runtime-parity-review through 2d07c2a7 safe to merge for /ask scillm grounding verifier hardening?

## Rationale And Context

(No additional rationale/context supplied.)





## Original Review Request

# Review request: /ask scillm grounding verifier hardening

## Decision requested
Assess whether branch `ask-runtime-parity-review` through commit `2d07c2a7` is safe to merge after hardening `/ask` `/scillm` DAG observability so source-grounding degradation and metadata echo mismatches affect verifier trust.

## Context
The previous review correctly found that metadata/source bundle presence was not enough. The important change in this revision is that verifier behavior now changes when `/scillm` grounding or returned metadata degrades.

## Implemented in this revision

- Source-grounding fallback is now summarized as `grounding_degraded` in argue and parallel-review artifacts.
- Returned `scillm_metadata` mismatches on `ask_id`, `protocol`, `node_id`, `batch_id`, and `item_id` fail verifier checks.
- Missing returned metadata is treated as `observability_degraded` rather than a verifier failure for older `/scillm` compatibility.
- `/ask argue` rejects unqualified `FOR` / `AGAINST` when critical source grounding degrades.
- `/ask parallel-review` rejects `SAFE` / `SAFE_WITH_CONDITIONS` when reviewer or judge source grounding degrades.
- `/scillm` source fallback path has a bounded retry for transient read/connect/protocol errors.
- README and `docs/PROJECT_KNOWLEDGE.md` document that mocked tests are regression coverage only and live `/scillm` E2E is required for composition validation.

## Validation actually run

```text
PYTHONPATH=skills/ask/src uv run --project skills/ask python -m py_compile skills/ask/src/ask/scillm_runtime.py skills/ask/src/ask/argue.py skills/ask/src/ask/parallel_review.py

PYTHONPATH=skills/ask/src uv run --project skills/ask --group dev pytest -q   skills/ask/tests/test_run_state_protocol.py::test_argue_verifier_rejects_for_when_grounding_fell_back   skills/ask/tests/test_run_state_protocol.py::test_argue_verifier_rejects_scillm_metadata_return_mismatch   skills/ask/tests/test_run_state_protocol.py::test_parallel_review_verifier_rejects_safe_when_grounding_fell_back   skills/ask/tests/test_run_state_protocol.py::test_parallel_review_verifier_rejects_scillm_metadata_return_mismatch
# 4 passed

PYTHONPATH=skills/ask/src uv run --project skills/ask --group dev pytest -q skills/ask/tests/test_ask_cli_protocols.py skills/ask/tests/test_human_chat_examples.py skills/ask/tests/test_run_state_protocol.py
# 102 passed

ASK_LIVE_SCILLM_E2E=1 PYTHONPATH=skills/ask/src uv run --project skills/ask --group dev pytest -q skills/ask/tests/test_parallel_review_live_e2e.py
# 2 passed in 31.67s

./skills/ask/sanity.sh
# All sanity checks PASSED; live checks skipped by default
```

## Specific review concerns

1. Confirm source-grounding fallback now affects verdict trust.
2. Confirm returned metadata mismatch fails deterministically.
3. Confirm missing metadata echo is surfaced as observability degradation rather than silently treated as full parity.
4. Confirm tests include a real `/scillm` E2E, not only mocked coverage.
5. Confirm normal `/ask` modes remain read-only and do not invoke `/code-runner`.

## Repository Snapshot

- Generated at: `2026-04-28T20:37:22.567521+00:00`
- Working directory: `/tmp/agent-skills-push.Jb4MP3`
- Repository root: `/tmp/agent-skills-push.Jb4MP3`
- Branch: `ask-runtime-parity-review`
- Remote: `git@github.com:grahama1970/agent-skills.git`

## Git Status

```text
(clean)
```

## Selected Review Files

These are the files intentionally selected for external review. Do not expand scope just because other files are changed in the worktree.

- `skills/ask/README.md`
- `skills/ask/docs/PROJECT_KNOWLEDGE.md`
- `skills/ask/src/ask/scillm_runtime.py`
- `skills/ask/src/ask/argue.py`
- `skills/ask/src/ask/parallel_review.py`
- `skills/ask/docs/ASK_ARGUE_CONTRACT.md`
- `skills/ask/docs/ASK_PARALLEL_REVIEW_CONTRACT.md`
- `skills/ask/tests/test_run_state_protocol.py`
- `skills/ask/tests/test_parallel_review_live_e2e.py`
- `skills/ask/sanity.sh`

## Changed Files In Selected Scope

- (none detected in selected scope)

## Diff

```diff
(Diff omitted by --no-diff.)
```

## Changed File Contents

(No changed file contents included.)

## Review Questions

1. Are there correctness bugs or edge cases in the implementation?
2. Are there security, data-loss, concurrency, or rollback risks?
3. Are the tests or validation steps sufficient for the stated change?
4. Is the change scoped tightly, or does it introduce unrelated behavior?
5. What exact fixes should be made before this is committed?

## Required Output Format

Return:

# Merge-blocking findings

## High severity

### H1. <title>
- Evidence:
- Impact:
- Exact fix:
- Test that should fail before the fix:

## Medium severity

Only include if it should block merge or materially affect safety.

# Important test gaps

List only tests required before merge.

# Merge recommendation

Use exactly one:
- SAFE_TO_MERGE
- SAFE_WITH_CONDITIONS
- CHANGES_REQUESTED
- NOT_SAFE


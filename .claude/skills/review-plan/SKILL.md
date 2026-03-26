---
name: review-plan
description: >
  Validate task files before orchestration. Verifies codebase claims,
  skill overlap, task ordering, definition-of-done assertions, and
  skill chain validity. Use before /orchestrate to prevent wasted effort.
triggers:
  - review plan
  - validate tasks
  - check plan
  - review task file
  - plan review
  - validate plan
  - audit plan
  - check task file
allowed-tools: [Bash, Read, Glob, Grep, Task]
provides:
  - plan-validation
  - claim-verification
  - chain-validation
composes:
  - assess
  - memory
  - recommend-skill-chain
  - skills-ci
  - task-monitor
taxonomy:
  - precision
metadata:
  short-description: Validate task files before orchestration
  version: "1.0.0"
---

# /review-plan

Validate task files before `/orchestrate` runs them. Catches errors that waste hours of agent time.

## Pipeline Position

```
/plan → /review-plan → /orchestrate
```

## Usage

```bash
# Review a task file
./run.sh review 01_MIGRATION_PLAN.md

# Review with JSON output
./run.sh review 01_MIGRATION_PLAN.md --json

# Review with auto-fix suggestions
./run.sh review 01_MIGRATION_PLAN.md --suggest-fixes

# Quick check (claims + DoD only, skip chain validation)
./run.sh check 01_MIGRATION_PLAN.md
```

## NON-NEGOTIABLE: Blind Adversarial Testing

Every implementation task MUST have a **blind test that the coding agent cannot see**. This is the #1 check. No exceptions.

The implementing agent sees ONLY pass/fail output — never the test source, assertions, or expected values. This prevents the agent from gaming or faking success.

- **GOOD**: `test-lab/run.sh verify-task 3.1 .pi/extensions/ --domain skills` — agent sees only pass/fail
- **GOOD**: `sanity.sh` exits 0 — pre-existing harness agent didn't write
- **GOOD**: `skills-ci scan` — external validator
- **WARN**: `uv run pytest tests/test_auth.py` — runnable but agent may have written the test (not blind)
- **BAD**: "verify it works"
- **BAD**: "Definition of Done: feature is implemented"

The test must be **adversarial** — the agent is blind to the test code and can only see output. `/plan` MUST specify `/test-lab` or `sanity.sh` tests. `/review-plan` MUST enforce blindness. `/orchestrate` MUST NOT run tasks without blind tests.

## What It Checks

### 1. Blind Adversarial Test Enforcement (FAIL grade)
Every implementation task must have a blind test the coding agent cannot see. Tasks using `/test-lab` or `sanity.sh` get PASS. Tasks with runnable tests the agent may have written get WARN. Tasks with no test get **FAIL**. This blocks `/orchestrate` from proceeding.

### 2. Claim Verification
Parse file paths, tool names, function names, and class names from task bodies. Verify they exist in the codebase.

**Catches**: "Edit `src/auth/handler.ts:45`" when the file doesn't exist, or tool names that don't exist in the target harness.

### 3. Skill Overlap Detection
Cross-reference task descriptions against `skills-manifest.json`. Flag tasks that propose building what an existing skill already does.

**Catches**: "Build a web scraper" when `/fetcher` + `/dogpile` already handle this.

### 4. Task Ordering Analysis
Build a dependency DAG from task references (`Task 3 depends on Task 1`). Detect cycles, missing dependencies, and parallelizable tasks not grouped.

**Catches**: Task 5 references output from Task 7 (ordering violation).

### 5. Definition of Done Audit
Parse DoD fields. Check if referenced test files/commands exist. Flag vague assertions.

**Catches**: `Definition of Done: "verify it works"` (vague), or `test_auth.py::test_login` when that test file doesn't exist.

### 6. Chain Validation
Extract `/skill-name` chains from task bodies. Run through `/recommend-skill-chain` to validate composition bonds.

**Catches**: `/create-stems /create-score` chain that has no logical bond (stems are audio separation, score is music generation — they compose but via `/create-music`, not directly).

### 7. Tool Name Audit
Check if tasks reference correct tool names for the target harness (Pi vs Claude Code).

**Catches**: Task says "use the Glob tool" but Pi's equivalent is `find`.

## Review Output

```
# Review: 01_MIGRATION_PLAN.md

## Summary
- Tasks: 24
- Phases: 11
- PASS: 18 | WARN: 4 | FAIL: 2

## FAIL

### Task 8.0: Line 416
- CLAIM: "packages/coding-agent/src/core/skills.ts" exists
- REALITY: File exists but function `parseFrontmatter<T>()` is at line 312, not as described
- FIX: Update line reference

### Task 5.3: Line 260
- CLAIM: "Edit a .pi/skills/**/*.py file"
- DOD: "Can't proceed past skill edits without CI scan"
- ISSUE: No test command specified — how do we verify the gate fires?

## WARN

### Task 9.2: Line 624
- OVERLAP: Task proposes building chain recall but /recommend-skill-chain already does this
- SUGGEST: Wire existing skill instead of rebuilding

### Phase 3: Line 145
- ORDERING: Task 3.1 (stop-gates.ts) depends on tool_call API but Task 5.1 (validate enforcement) comes after
- SUGGEST: Move validation before hook creation
```

## Grading

| Grade | Criteria |
|-------|----------|
| **PASS** | All claims verified, DoD has runnable assertions, chains valid |
| **WARN** | Minor issues: stale line numbers, possible overlap, weak DoD |
| **FAIL** | Claim doesn't match codebase, missing DoD, broken dependency chain |

## Integration

- `/plan` should run `/review-plan` before marking a task file as ready
- `/orchestrate` should run `/review-plan` as a pre-hook (Task 10.2 in migration plan)
- `/best-practices-plan` provides the rule set this skill validates against

## Dependencies

- `skills-manifest.json` — for skill overlap detection
- `/memory recall` — for prior plan review patterns
- `/recommend-skill-chain` — for chain validation (optional, degrades gracefully)

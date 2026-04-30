# Pi Code-Execution Monitor Design Review Brief

## Objective

Redesign `http://127.0.0.1:56871/monitor.html` into a dynamic monitor for the Pi execution pipeline:

`/plan -> /review-plan -> /orchestrate -> /code-runner`

The current interface is not helpful enough for monitoring live code execution. It should become an operator console for understanding what is running, what is blocked, what failed, what improved, and what needs human intervention.

## Primary Persona

Project agent operator supervising multi-step code execution in `pi-mono`.

This person needs to:

- See the active plan DAG and execution waves.
- Understand which tasks are local, `scillm`, or `code-runner`.
- Track each task through preflight, dispatch, rounds, quality gates, pass, fail, blocked, paused, skipped, or cancelled states.
- Inspect `code-runner` rounds without losing the high-level plan context.
- Distinguish deterministic evidence from LLM commentary.
- Spot live-server/worktree mismatches, blind-test failures, dirty-worktree blocks, and dependency stalls.
- Decide when to pause, resume, cancel, rerun, or hand off for review.

## Current Evidence

The bundle includes a fresh CDP screenshot of the current monitor:

- `screenshots/current-monitor-20260429T133124Z.png`
- `screenshots/current-monitor-20260429T133124Z.read.json`
- `screenshots/current-monitor-20260429T133124Z.meta.json`

## Pipeline Semantics To Preserve

### `/plan`

Creates orchestration-ready YAML task files. Important monitor concepts:

- Plan metadata: title, goal, persona, plan type.
- Capability overlap and memory-first checks.
- Lanes, waves, task dependencies, and max concurrency.
- Runner routing: `local`, `scillm`, `code-runner`, `skill`.
- Definition-of-done commands and assertions.
- Blind tests and design verification requirements.

### `/review-plan`

Validates the plan before execution. Important monitor concepts:

- PASS/WARN/FAIL findings.
- FAILs that block execution.
- Warnings that can proceed but should stay visible.
- Claim verification, skill overlap, DoD audit, visual verification coverage, live-server mismatch checks.

### `/orchestrate`

Executes the DAG. Important monitor concepts:

- Session status, current wave, active tasks, queued tasks, completed tasks.
- Per-task preconditions and quality gates.
- Pause/resume/cancel/skip intervention state.
- Backend routing and task ownership.
- Structured events over time.

### `/code-runner`

Runs bounded code tasks through deterministic improvement loops. Important monitor concepts:

- Round number, strategy, backend, score, keep/discard decision.
- DoD command result and assertion.
- Error classification and grounding status.
- Best commit, best score, result JSON.
- Hunk review artifact.
- Live service mode: owned service vs external service vs unsupported.

## Desired UX Direction

The monitor should feel like a dense operational console, not a marketing dashboard. It should prioritize scanability, state clarity, and fast diagnosis.

Recommended layout direction:

- Left rail: sessions/plans with status badges and freshness.
- Main pane: DAG or wave/task board with clear dependency and current-state indicators.
- Right pane: selected task details, logs, DoD, review-plan findings, code-runner rounds, artifacts.
- Bottom or secondary pane: append-only event timeline with filters.
- Status language should separate "retrieved/found/running/failed" from unsupported certainty.

## Design Questions For Gemini

1. What information architecture best supports this pipeline: DAG-first, task-table-first, timeline-first, or a hybrid?
2. How should the UI show both high-level orchestration progress and low-level `code-runner` rounds without overwhelming the operator?
3. What is the best visual treatment for blocked states, especially review-plan FAILs, dirty worktree preflight blocks, live-server mismatches, and blind-test failures?
4. Which controls should be primary actions, and which should be hidden behind menus to avoid accidental destructive intervention?
5. What should the selected-task detail pane contain for `local`, `scillm`, `skill`, and `code-runner` tasks?
6. How should the monitor represent confidence and evidence without implying that an LLM has validated correctness?
7. What minimum real-time indicators are needed for the interface to feel dynamic and trustworthy?
8. What mockup would you recommend for a 1440px desktop viewport?

## Constraints

- This is a developer/operator tool. Use compact typography and restrained visual styling.
- Avoid decorative cards, oversized hero treatments, and one-note color palettes.
- Stable dimensions matter: task rows, badges, controls, and log panels should not shift as live data updates.
- Controls should use recognizable icons where appropriate.
- Do not bury failures below the fold.
- Do not make build success look equivalent to visual or behavioral validation.
- The design must make it obvious when data is stale or a session is no longer updating.

## Requested Output

Please provide:

1. A proposed desktop information architecture.
2. A concrete screen mockup or detailed layout spec for the monitor.
3. Component inventory with state variants.
4. A prioritized list of changes from the current UI.
5. Interaction recommendations for filtering, selecting tasks, and viewing logs/artifacts.
6. Any risks where the proposed design could mislead an operator.

# Subagent Runner Architecture

## Purpose

`/subagent-runner` is a PTY-managed subprocess runner for full CLI agent sessions.
It exists for tasks that benefit from a real terminal-bound agent process with
session state, transcript capture, attach/detach, and mid-run intervention.

It does not replace `/code-runner`.

`/code-runner` remains the deterministic bounded-code runner for tasks with:
- explicit file scope
- deterministic Definition of Done
- keep/discard scoring
- blind verification via `/orchestrate`

The two runners solve different problems. `/orchestrate` must choose between
them instead of collapsing them into one generic "agent runner".

## Non-Goals

`/subagent-runner` must not:
- become a synonym for one-shot `codex exec`
- replace `/code-runner` for bounded implementation tasks
- bypass `/orchestrate` task lifecycle, cancellation, or artifact tracking
- hide subprocess state inside an opaque PTY with no machine-readable status
- weaken write-scope or destructive-command safeguards

## Runner Separation

### `/code-runner`

Use `/code-runner` when the task is a bounded implementation problem:
- 1-3 known files or directories to edit
- deterministic DoD command
- blind tests or review gates available
- worktree isolation is acceptable
- the task benefits from iterative repair and scoring

Properties:
- deterministic outer loop
- LLM calls routed through `/scillm`
- explicit tool-use runtime
- keep/discard git cycle
- T0/T1.5/T2 quality gates
- worktree-friendly and orchestrate-friendly

### `/subagent-runner`

Use `/subagent-runner` when the task is better expressed as a real agent session:
- terminal-native workflows
- attach/detach expectations
- human or controller takeover mid-run
- long exploration inside a CLI session
- a real PTY is part of the task semantics

Properties:
- PTY-backed subprocess
- transcript and status artifacts
- explicit session lifecycle
- intervention support
- orchestrated externally, agentic internally

## Mental Model

`/code-runner`:

```text
orchestrate
  -> code-runner
    -> scillm model calls
    -> tool loop
    -> deterministic scoring
    -> keep/discard
```

`/subagent-runner`:

```text
orchestrate
  -> subagent-runner
    -> PTY session
      -> codex-class CLI agent subprocess
      -> internal agent loop
    -> transcript/status watcher
    -> attach/detach/intervene
```

## Session Model

Every `subagent-runner` task owns one session directory.

Required session state:
- `session_id`
- `task_id`
- `backend`
- `cwd`
- `started_at`
- `updated_at`
- `status`
- `pid`
- `pty_device` when available
- `exit_code` on terminal states
- `intervention_state`

Canonical statuses:
- `queued`
- `starting`
- `running`
- `paused`
- `completed`
- `failed`
- `cancelled`
- `timed_out`
- `stalled`

Status transitions must be append-only in artifacts even if `status.json` stores
only the latest snapshot.

## Artifact Contract

Each session directory must contain machine-readable and human-readable outputs.

Required artifacts:
- `status.json` — latest normalized state snapshot
- `events.jsonl` — append-only lifecycle events
- `transcript.log` — raw PTY byte stream or normalized text stream
- `stdout.log` — normalized stdout when separated
- `stderr.log` — normalized stderr when separated
- `prompt.txt` — initial task payload sent to the subprocess
- `result.json` — final structured outcome

Optional artifacts:
- `input.log` — controller/human inputs sent after session start
- `attachments/` — task-scoped inputs copied into the run directory
- `heartbeat.json` — watchdog-facing liveness snapshot

Minimum `result.json` fields:
- `task_id`
- `session_id`
- `backend`
- `status`
- `exit_code`
- `started_at`
- `finished_at`
- `duration_seconds`
- `artifact_dir`
- `summary`

## Orchestrate Responsibilities

`/orchestrate` remains the outer controller.

It is responsible for:
- selecting `subagent-runner` only when the task shape justifies it
- creating the session directory and task spec
- starting the runner process
- surfacing task status to the orchestration session
- propagating cancel/pause/resume signals
- collecting final result artifacts
- applying downstream review gates when appropriate

It is not responsible for:
- emulating the subprocess PTY loop
- parsing agent thoughts from the transcript
- doing in-band CLI repair inside the session

## Subagent Runner Responsibilities

`/subagent-runner` is responsible for:
- launching the CLI agent subprocess inside a PTY
- persisting session metadata and transcripts
- normalizing status transitions
- watchdog-based stall detection
- honoring intervention files or commands
- producing a structured final result even on crash or timeout

It is not responsible for:
- deciding project architecture
- replacing `/plan`
- performing deterministic code scoring like `/code-runner`
- inventing its own orchestration DAG

## Intervention Model

The runner must support both controller-driven and human-driven intervention.

Required controls:
- `start`
- `status`
- `attach`
- `send-input`
- `pause`
- `resume`
- `cancel`

Interventions must be reflected in `events.jsonl` and `status.json`.

Intervention rules:
- `pause` stops new automated input and marks the session paused
- `attach` is read-mostly unless explicit input is sent
- `send-input` records the source of the input (`controller` or `human`)
- `cancel` attempts graceful termination first, then escalates if needed

## Watchdog and Timeout Policy

The runner must expose two failure classes separately:
- process exited
- process appears alive but stalled

Watchdog signals should include:
- no transcript growth for N seconds
- no status heartbeat for N seconds
- PTY still open but child not making progress

Terminal outcomes must distinguish:
- `failed` — process exited with non-zero or malformed result
- `timed_out` — exceeded task timeout
- `stalled` — watchdog declared session non-progressing
- `cancelled` — controller or human stopped it

## Safety Boundary

A PTY runner cannot be "unsafe by default" just because it uses a real CLI.

Minimum policy boundary:
- explicit write scope from task spec
- denylist for destructive filesystem and git operations
- explicit cwd boundary
- artifact-first execution so failures are inspectable
- no silent fallback from denied command to partial success

The runner may allow more autonomy than `/code-runner`, but it must still make
unsafe actions observable and block clearly disallowed operations.

## Routing Matrix

| Runner | Use when | Do not use when |
| --- | --- | --- |
| `local` | Deterministic shell command | LLM reasoning or agent session needed |
| `scillm` | One-shot text transformation or simple inference | Iterative repair or PTY session needed |
| `code-runner` | Bounded implementation with deterministic DoD and write scope | Task requires real terminal session, takeover, or PTY semantics |
| `subagent-runner` | CLI-native exploratory agent session, attach/detach, takeover, PTY semantics | Task is a bounded code fix better served by deterministic scoring |

## Examples

### Good fit for `/code-runner`

- "Edit `src/auth.ts` and `tests/auth.test.ts` until `vitest` passes."
- "Implement a parser in two files and satisfy a deterministic pytest DoD."
- "Refactor a bounded module with an allowlist and blind tests."

### Good fit for `/subagent-runner`

- "Launch a Codex session in this repo, let it explore the terminal workflow, and allow takeover if it gets stuck."
- "Run a long-lived CLI agent against a migration task where transcript review matters as much as final diff."
- "Start a codex-class subprocess that must behave like a real terminal agent, not a tool-call loop."

### Bad fit for `/subagent-runner`

- "Fix this one failing test in two files."
- "Add a field to a config file."
- "Perform a deterministic edit with a stable DoD."

## Planning Rules

`/plan` and `/review-plan` must enforce the boundary.

Use `subagent-runner` only when the plan explicitly needs one or more of:
- PTY or terminal semantics
- attach/detach
- intervention during execution
- takeover-friendly long-running session
- real CLI agent workflow as part of the Definition of Done

Otherwise prefer:
- `code-runner` for bounded iterative code tasks
- `scillm` for one-shot LLM work
- `local` for deterministic shell work

## Migration Rule for Deprecated `subagent-service`

Existing `subagent-service` tasks should be rewritten based on task shape:
- bounded code task -> `code-runner`
- one-shot prompt task -> `scillm`
- PTY-managed CLI session -> `subagent-runner`

Do not auto-migrate all old subagent tasks to `subagent-runner`.
The decision must be made per task.

## Definition of Done for the Runner Itself

The runner is ready only when:
- a task can start a PTY-managed subprocess
- `status.json` and `events.jsonl` update during execution
- transcripts persist while the session is still running
- attach/detach works without losing state
- cancel/pause/resume produce explicit state transitions
- `/orchestrate` can treat the runner as a first-class task runner

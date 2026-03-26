# Task List: Autonomous Agent Inbox Pipeline

**Created**: 2026-03-09
**Goal**: Make agent-inbox fully autonomous — no human in the loop unless escalation is needed. Integrate /project-state caching, /checkpoint, /subagent-service, and /memory into a closed-loop dispatch-verify-learn pipeline.

## Context

The agent-inbox has a dispatcher daemon (`dispatcher_daemon.py`) that can spawn agents to fix bugs, but it's barely functional: spawns raw `claude -p` with no project context, no tiered dispatch, no staleness management. 64 messages rot in pending/ with no auto-processing. The systemd service exists but has a `ProtectHome=read-only` bug that prevents it from writing to `~/.agent-inbox/`. This plan wires together 6 existing skills into a closed autonomous loop.

## Capability Overlap

- `/memory recall "autonomous dispatch"`: No prior solutions found.
- **Existing skills checked**: agent-inbox (has dispatcher but dumb), monitor-codebase (already composes project-state + agent-inbox), project-state (no caching), checkpoint (saves to /memory), subagent-service (Docker agents, unused by inbox), ops-discord (notification alerts), interview (structured Q&A for human escalation).
- **No new skills created** — this plan extends 4 existing skills and wires them together. No new files created — escalation logic goes into existing `dispatcher_agent.py`.
- **Composition mapping**:
  - EXTEND: agent-inbox (tiered dispatch, staleness, memory learn loop)
  - EXTEND: project-state (add --force/--cached flags)
  - EXTEND: monitor-codebase (add hourly cache-state job)
  - CALL: checkpoint (cache project-state, save fix context)
  - CALL: subagent-service (critical-severity dispatch)
  - CALL: interview (escalation structured Q&A)
  - CALL: ops-discord (fallback notification)
  - CALL: memory (recall prior fixes, learn new ones)

## Crucial Dependencies (Sanity Scripts)

| Library | API/Method | Sanity Script | Status |
|---------|------------|---------------|--------|
| None | All dependencies are existing skills | N/A | N/A |

> No new dependencies. All work is composition of existing skills.

## Questions/Blockers

None — all requirements clear from design discussion.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   monitor-codebase (hourly)                  │
│  git hash check → project-state --quick --json → checkpoint  │
│  One producer, many readers                                  │
└──────────────────────────┬──────────────────────────────────┘
                           │ writes to /memory
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              embry-inbox.service (always running)             │
│                                                              │
│  Poll pending/ every 5s                                      │
│    → triage (severity classification) — exists               │
│    → /memory recall (project-state + prior fixes)            │
│    → tiered dispatch:                                        │
│        low:      notify only (no agent)                      │
│        medium:   claude -p + message                         │
│        high:     claude -p + project-state + memory context  │
│        critical: /subagent-service (Docker) + full context    │
│    → verify (--test command or pytest)                       │
│    → if pass: auto-ack + /memory learn + /checkpoint         │
│    → if fail: retry once with error context                  │
│    → if still fail: /interview (structured Q&A) → human      │
│    → if /interview unavailable: /ops-discord fallback        │
│                                                              │
│  Staleness sweep (daily):                                    │
│    → info/request messages > 7 days → auto-ack "stale"       │
│    → test-project messages → auto-ack "test data"            │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## Tasks

### P0: Fix Blocking Bugs (Sequential)

- [x] **Task 1**: Fix embry-inbox.service ProtectHome bug
  - Agent: general-purpose
  - Parallel: 0
  - Dependencies: none
  - Files: `.pi/systemd/embry-inbox.service`
  - Description: The service has `ProtectHome=read-only` which prevents the dispatcher from writing to `~/.agent-inbox/` (pending/, done/, logs/, task_states/). Either remove `ProtectHome` or add `ReadWritePaths=%h/.agent-inbox %h/.pi`. Also verify `WorkingDirectory` points to the correct skill path and that `install.sh` includes this service.
  - **Definition of Done**:
    - Test: `systemd-analyze verify embry-inbox.service` passes
    - Assertion: Service can write to `~/.agent-inbox/` when running

- [x] **Task 2**: Fix dispatcher_memory.py hardcoded skill paths
  - Agent: general-purpose
  - Parallel: 0
  - Dependencies: none
  - Files: `.pi/skills/agent-inbox/dispatcher_memory.py`
  - Description: `recall_from_memory()` and `learn_solution()` hardcode `~/.pi/skills/memory/run.sh` then `~/.agent/skills/memory/run.sh`. These should also check the canonical path `.pi/skills/memory/run.sh` (relative to repo root) and the symlinked `~/.claude/skills/memory/run.sh`. Use a helper that tries paths in order: canonical repo → `~/.pi/agent/skills/` → `~/.claude/skills/` → `~/.agent/skills/`.
  - **Definition of Done**:
    - Test: `python -c "from dispatcher_memory import _find_memory_skill; print(_find_memory_skill())"` returns a valid path
    - Assertion: Memory skill is found regardless of which symlink target exists

### P1: Project-State Caching (Parallel)

- [x] **Task 3**: Add --force flag and checkpoint integration to project-state
  - Agent: general-purpose
  - Parallel: 1
  - Dependencies: Task 1
  - Files: `.pi/skills/project-state/project_state.py`, `.pi/skills/project-state/SKILL.md`
  - Description: Add `--force` flag to CLI (default behavior is unchanged — always runs live). After collecting state, call `/checkpoint save --topic "project-state <project-name>" --summary <json>`. This writes to /memory with tags `checkpoint, project-state`. Add a `--cached` flag that does `/checkpoint recall --topic "project-state <project-name>"` and returns the stored result if found and < 1 hour old, otherwise runs live. The `--force` flag skips the cache check and always runs live + re-checkpoints.
  - **Definition of Done**:
    - Test: `./run.sh report --quick --json --cached` returns cached data when available
    - Assertion: `--cached` returns in <2s when cache exists; `--force` always runs 10s+ and updates cache

- [x] **Task 4**: Add hourly project-state cache job to monitor-codebase
  - Agent: general-purpose
  - Parallel: 1
  - Dependencies: Task 1
  - Files: `.pi/skills/monitor-codebase/` (main scanner or new subcommand)
  - Description: Add a `cache-state` subcommand (or integrate into existing scan) that: (1) runs `git rev-parse HEAD` for each registered project, (2) compares against a stored hash in `~/.pi/monitor-codebase/state_hashes.json`, (3) if changed, runs `project-state report --quick --json` and checkpoints the result, (4) if unchanged, skips. Register this with `/scheduler` at `0 * * * *` (hourly). The nightly `0 3 * * *` full scan continues unchanged.
  - **Definition of Done**:
    - Test: Run `cache-state` twice with no git changes — second run skips in <1s
    - Assertion: `~/.pi/monitor-codebase/state_hashes.json` tracks per-project commit hashes; checkpoint is only written when hash changes

### P2: Tiered Dispatch (Sequential, depends on P1)

- [x] **Task 5**: Implement tiered dispatch in dispatcher daemon
  - Agent: general-purpose
  - Parallel: 2
  - Dependencies: Task 2, Task 3
  - Files: `.pi/skills/agent-inbox/dispatcher_daemon.py`, `.pi/skills/agent-inbox/dispatcher_agent.py`
  - Description: Modify `should_dispatch()` and `dispatch_loop()` to implement severity-based tiering:
    - **low**: Set status to `"noted"`, log it, do NOT spawn an agent. Auto-ack after 7 days.
    - **medium**: Current behavior — `claude -p` with message body + memory recall (already exists).
    - **high**: Same as medium but also inject project-state context. Call `project-state report --quick --json --cached` (Task 3) and prepend output to the agent prompt in `build_prompt()`.
    - **critical**: Use `/subagent-service` to spawn a Docker-isolated agent instead of raw subprocess. Pass project-state + memory context + workspace mount via the subagent-service API.
    The triage severity (`message.get("triage", {}).get("severity", "medium")`) already exists from the AI triage system. Map it: `low→notify, medium→claude-p, high→claude-p+context, critical→subagent`.
  - **Definition of Done**:
    - Test: Send 4 test messages with severity low/medium/high/critical, verify each takes the correct dispatch path
    - Assertion: Low messages are NOT dispatched (no subprocess spawned); high messages have project-state in prompt; critical messages spawn via subagent-service API

- [x] **Task 6**: Add retry-with-context and /interview escalation
  - Agent: general-purpose
  - Parallel: 2
  - Dependencies: Task 5
  - Files: `.pi/skills/agent-inbox/dispatcher_agent.py`
  - Description: Enhance `verify_fix()` flow: (1) On first verification failure, force-refresh project-state (`--force`), append the test error output to the agent prompt, and re-dispatch with `retry_count=1`. (2) On second failure, escalate via `/interview` — generate a structured question JSON with the bug context, test output, and agent's attempted fix as context, then present decision options (retry with different approach, manually fix, deprioritize, reassign to different model). The `/interview` response drives the next action. (3) If `/interview` times out (10 min) or is unavailable, fall back to `/ops-discord notify` with message summary + error output. (4) Set status to `"escalated"` and stop automatic retrying until human responds. (5) The existing retry logic in `verify_fix` retries up to 3 times — reduce to 1 automatic retry, then escalate. Add a `--force` project-state refresh on retry so the agent sees fresh state after its own changes.
  - **Definition of Done**:
    - Test: Send a bug with `--test "exit 1"` (always-fail), verify it retries once then escalates
    - Assertion: `/interview` question JSON is generated with bug context, test output, and options; message status is `"escalated"`; Discord fallback works when interview unavailable

### P3: Staleness Management (Parallel with P2)

- [x] **Task 7**: Add staleness sweep to dispatcher daemon
  - Agent: general-purpose
  - Parallel: 2
  - Dependencies: Task 2
  - Files: `.pi/skills/agent-inbox/dispatcher_daemon.py`, `.pi/skills/agent-inbox/inbox_core.py`
  - Description: Add a `sweep_stale()` function called once per daemon loop iteration (or once per hour via timestamp check). Rules:
    - `type=info` or `type=request` messages older than 7 days → auto-ack with note "Auto-closed: stale after 7 days"
    - `type=bug` messages older than 14 days → set status to `"stale"`, send Discord alert "Bug stale for 14 days, needs human review"
    - `type=question` messages older than 3 days → auto-ack with note "Auto-closed: question unanswered for 3 days"
    - Messages from `test-project` or `integration-test` → auto-ack immediately with note "Test data cleaned up"
    Move messages to `done/` on auto-ack.
  - **Definition of Done**:
    - Test: Create a test message with `created_at` 8 days ago, type=info, verify it gets auto-acked
    - Assertion: Stale info/request messages are moved to `done/` with appropriate note

### P4: Memory Learn Loop (After P2)

- [x] **Task 8**: Wire /memory learn and /checkpoint into completion flow
  - Agent: general-purpose
  - Parallel: 3
  - Dependencies: Task 5, Task 6
  - Files: `.pi/skills/agent-inbox/dispatcher_agent.py`, `.pi/skills/agent-inbox/dispatcher_memory.py`
  - Description: Enhance `complete_fix()`: (1) `learn_solution()` already exists but only stores problem/solution text. Enhance it to also store: severity, dispatch tier used, retry count, time-to-fix, test command used. Tag with `agent-inbox, autonomous-fix, <project>, <severity>`. (2) After learning, call `/checkpoint save --topic "inbox-fix <msg_id>"` with the full fix context (message, project-state before/after, git diff, test results). (3) Before dispatching (in `recall_from_memory()`), also recall checkpoints tagged `autonomous-fix` for the target project — this gives the agent knowledge of what was tried before for similar bugs.
  - **Definition of Done**:
    - Test: Complete a fix, then `memory recall --q "autonomous-fix <project>" --k 1` returns the learned fix
    - Assertion: Learned entry contains severity, tier, retry_count, and time_to_fix fields

### P5: Integration & Service Activation (Sequential, final)

- [x] **Task 9**: Update SKILL.md composes declarations
  - Agent: general-purpose
  - Parallel: 4
  - Dependencies: all previous tasks
  - Files: `.pi/skills/agent-inbox/SKILL.md`
  - Description: Update the YAML frontmatter `composes:` to include `[task-monitor, memory, project-state, checkpoint, subagent-service, ops-discord, interview]`. Update the skill description to document the autonomous dispatch pipeline, tiered severity, staleness sweep, and escalation path. Add a "Running the Autonomous Pipeline" section explaining the systemd service.
  - **Definition of Done**:
    - Test: `/skills-ci scan` shows no new errors for agent-inbox
    - Assertion: SKILL.md frontmatter composes includes all 7 composed skills

- [x] **Task 10**: Enable and start embry-inbox.service
  - Agent: general-purpose
  - Parallel: 4
  - Dependencies: Task 1, Task 9
  - Files: `.pi/systemd/install.sh`
  - Description: Ensure `install.sh` includes `embry-inbox.service` in its deployment list. Run `install.sh` to deploy the fixed service. Start the service with `systemctl --user start embry-inbox`. Verify it's running and can process a test message end-to-end. Verify it appears in `systemctl --user list-units 'embry-*'`.
  - **Definition of Done**:
    - Test: `systemctl --user is-active embry-inbox` returns `active`
    - Assertion: Dispatcher daemon is running, polling pending/, and can dispatch a test message

- [x] **Task 11**: End-to-end smoke test
  - Agent: general-purpose
  - Parallel: 5
  - Dependencies: Task 10
  - Description: Send a real test bug via `agent-inbox send --to pi-mono --type bug --priority high --test "python -c 'print(1)'" "Test: autonomous pipeline smoke test"`. Verify the full pipeline: triage → project-state recall → agent spawn → fix attempt → verification passes → auto-ack → memory learn → checkpoint saved. Then verify with `agent-inbox list --status done` that the message was auto-acked.
  - **Definition of Done**:
    - Test: Message progresses through all states: pending → dispatched → in_progress → done
    - Assertion: `~/.agent-inbox/done/` contains the acked message; `/memory recall "autonomous-fix pi-mono"` returns the learned fix

## Completion Criteria

- [x] All sanity scripts pass (N/A — no new dependencies)
- [x] All tasks marked [x]
- [x] All Definition of Done tests pass
- [x] embry-inbox.service is running and autonomous
- [x] No regressions in existing agent-inbox functionality
- [x] `/skills-ci scan` error count equal or lower than baseline (0 errors)

## Notes

- **Critical finding**: `embry-inbox.service` has `ProtectHome=read-only` which completely blocks the daemon from functioning. This is Task 1 and must be fixed first.
- **Cost control**: The tiered dispatch ensures low-severity messages don't waste compute. Only critical bugs get the expensive Docker subagent path.
- **The 64 pending messages**: Task 7's staleness sweep will auto-close most of them. The 6 test-project messages will be immediately cleaned. Info messages older than 7 days will auto-ack. Only recent high/critical bugs will be dispatched.
- **checkpoint decay**: Checkpoints have 90-day decay in /memory. Project-state caches refresh hourly so this is fine. Fix checkpoints may decay but the learned solution (via /memory learn) persists separately.
- **subagent-service for critical**: This is a Docker container with FastAPI — heavier than `claude -p` but provides isolation, health monitoring, and multi-backend support. Only used for critical severity where the cost is justified.

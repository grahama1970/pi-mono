# How /plan Works: From Conversation to Orchestration

**Date:** 2026-03-17
**Pipeline:** /plan -> /review-plan -> /orchestrate -> /subagent-service

---

## Overview

The user says one thing. The agent runs the full pipeline.

```
Human says: "plan adding Redis caching"

    CONVERSATION --> YAML --> VALIDATE --> EXECUTE
    (human+agent)   (plan.py) (review-plan) (orchestrate)
```

The conversation IS the planning. The YAML is the compiled output. Everything after the YAML is automated.

---

## Phase 1: Conversation (Human + Agent)

This is the real planning. Everything before YAML is written.

### 1.1 Human describes the goal

The human gives as much or as little context as they want. The agent fills gaps through conversation.

> Human: "I want to add Redis caching to the API. TTL-based, 60s, Docker-based Redis. Only cache API responses, not sessions."

### 1.2 Agent checks prior art (3 checks)

| Check | Tool | Looking For |
|-------|------|-------------|
| Prior solutions | /memory recall | Has this been attempted before? Lessons? |
| Skill overlap | skills-manifest.json | Does an existing skill already do this? |
| Target codebase | /assess | How many endpoints? What framework? |

> Agent: "No prior caching solution in memory. No skill overlap. Read the API: 12 FastAPI endpoints in src/api/, all hit PostgreSQL directly. No caching layer exists."

### 1.3 Agent asks clarifying questions (if goal is ambiguous)

For structured choices, use /interview. For open questions, ask directly.

> Agent: "Before I plan:
> 1. Cache invalidation -- TTL only, or also invalidate on writes?
> 2. Which endpoints? All 12 or just read-heavy ones?
> 3. Route-level caching or database query level?"

> Human: "TTL only for now. Start with the 4 heaviest endpoints. Route level."

### 1.4 Agent identifies the primary persona

Every plan needs a WHO -- the person who uses what we are building.

> Agent: "This is API infrastructure. The primary persona is Nico Bailon -- he monitors API performance and would be the first to notice caching issues. Sound right?"

> Human: "Yes."

### 1.5 For design plans: /create-design-board (BLOCKING GATE)

If the plan involves UI (plan_type: design or hybrid), the agent runs /create-design-board BEFORE writing YAML. The human reviews visual mockups and approves the layout direction. This does NOT apply to code-only plans like our Redis example.

### 1.6 Agent proposes the decomposition

The agent describes the tasks conversationally, not as YAML yet:

> Agent: "Here is how I would break this down:
>
> **Wave 0 (setup):** Add Redis to docker-compose, verify it starts.
>
> **Wave 1 (implementation, parallel):**
> - Task 2: Create a cache utility module (src/cache.py) with get/set/invalidate
> - Task 3: Add caching decorator to /api/users endpoint
> - Task 4: Add caching decorator to /api/products endpoint
> - Task 5: Add caching decorator to /api/orders endpoint
> - Task 6: Add caching decorator to /api/analytics endpoint
>
> Tasks 3-6 are independent -- they can run in parallel across 3 subagent containers.
>
> **Wave 2 (validation):** Integration tests across all cached endpoints.
>
> Each implementation task uses sonnet (straightforward decorator pattern). Task 2 uses opus (designing the cache module API). All get blind tests via /test-lab.
>
> Total: 7 tasks, 3 waves, max_concurrency 3. Estimated 5-10 minutes."

> Human: "Looks good. Write it."

This conversation -- steps 1.1 through 1.6 -- is the planning. The YAML is just the serialized result.

---

## Phase 2: Write the YAML

The agent writes a 0N_TASKS.yaml file using the PlanFile dataclass. Every task has explicit runner, backend, mode, lane, depends_on, and definition_of_done.

```yaml
version: 1
kind: orchestrate-plan
metadata:
  title: Redis API Caching
  goal: Add TTL-based Redis caching to 4 API endpoints
  plan_type: code
  created: 2026-03-17
  primary_persona:
    name: Nico Bailon
    role: API Performance Monitor
execution:
  max_concurrency: 3
capability_overlap:
  - "/memory recall: no prior caching solution"
  - "Checked /fetcher, /dogpile -- no overlap"
questions_blockers:
  - None
lanes:
  - {id: "0", label: "Wave 0: Setup"}
  - {id: "1", label: "Wave 1: Implementation"}
  - {id: "2", label: "Wave 2: Validation"}
tasks:
  - id: "1"
    title: Add Redis to docker-compose
    lane: "0"
    runner: local
    backend: ""
    mode: ""
    command: "docker compose up -d redis && redis-cli ping"
    depends_on: []
    definition_of_done:
      command: "redis-cli ping"
      assertion: "Returns PONG"

  - id: "2"
    title: Create cache utility module
    lane: "1"
    runner: subagent-service
    backend: opus
    mode: iterative
    depends_on: ["1"]
    implementation:
      - "Create src/cache.py with get/set/invalidate"
      - "TTL-based expiration using Redis SETEX"
      - "Decorator pattern for route-level caching"
    tests:
      - "test-lab/run.sh verify-task 2 src/ --domain python"
    definition_of_done:
      command: "uv run pytest tests/test_cache.py -q"
      assertion: "Cache get/set works with TTL expiration"

  - id: "3"
    title: Cache /api/users endpoint
    lane: "1"
    runner: subagent-service
    backend: sonnet
    mode: iterative
    depends_on: ["2"]
    implementation:
      - "Add @cache(ttl=60) decorator to /api/users handler"
    tests:
      - "test-lab/run.sh verify-task 3 src/api/ --domain python"
    definition_of_done:
      command: "curl localhost:8000/api/users && curl localhost:8000/api/users"
      assertion: "Second request served from cache (no DB query)"

  - id: "4"
    title: Cache /api/products endpoint
    lane: "1"
    runner: subagent-service
    backend: sonnet
    mode: iterative
    depends_on: ["2"]
    implementation:
      - "Add @cache(ttl=60) decorator to /api/products handler"
    tests:
      - "test-lab/run.sh verify-task 4 src/api/ --domain python"
    definition_of_done:
      command: "uv run pytest tests/test_api.py::test_products_cached -q"
      assertion: "Cached response matches uncached response"

  - id: "5"
    title: Cache /api/orders endpoint
    lane: "1"
    runner: subagent-service
    backend: sonnet
    mode: iterative
    depends_on: ["2"]
    implementation:
      - "Add @cache(ttl=60) decorator to /api/orders handler"
    tests:
      - "test-lab/run.sh verify-task 5 src/api/ --domain python"
    definition_of_done:
      command: "uv run pytest tests/test_api.py::test_orders_cached -q"
      assertion: "Cached response matches uncached response"

  - id: "6"
    title: Cache /api/analytics endpoint
    lane: "1"
    runner: subagent-service
    backend: sonnet
    mode: iterative
    depends_on: ["2"]
    implementation:
      - "Add @cache(ttl=60) decorator to /api/analytics handler"
    tests:
      - "test-lab/run.sh verify-task 6 src/api/ --domain python"
    definition_of_done:
      command: "uv run pytest tests/test_api.py::test_analytics_cached -q"
      assertion: "Cached response matches uncached response"

  - id: "7"
    title: Integration tests across all cached endpoints
    lane: "2"
    runner: local
    backend: ""
    mode: ""
    depends_on: ["3", "4", "5", "6"]
    command: "uv run pytest tests/test_api.py -q --tb=short"
    definition_of_done:
      command: "uv run pytest tests/test_api.py -q"
      assertion: "All endpoint cache tests pass, no regressions"
```

---

## Phase 3: Visualize the DAG

The agent shows the execution plan to the human before proceeding.

```bash
plan.py --dag 01_TASKS.yaml
```

Output:

```
DAG: Redis API Caching
Goal: Add TTL-based Redis caching to 4 API endpoints
Tasks: 7  Waves: 4  Max concurrency: 3

-- Wave 0 ------------------------------------------------
  [sh] Task 1: Add Redis to docker-compose L0

-- Wave 1 ------------------------------------------------
  [agent] Task 2: Create cache utility module (opus) L1 <- [1]

-- Wave 2 (parallel) -------------------------------------
  [agent] Task 3: Cache /api/users endpoint (sonnet) L1 <- [2]
  [agent] Task 4: Cache /api/products endpoint (sonnet) L1 <- [2]
  [agent] Task 5: Cache /api/orders endpoint (sonnet) L1 <- [2]
  [agent] Task 6: Cache /api/analytics endpoint (sonnet) L1 <- [2]

-- Wave 3 ------------------------------------------------
  [sh] Task 7: Integration tests (local) L2 <- [3, 4, 5, 6]
```

The human reviews: task order, parallelism, model choices, dependencies. They can say "move task 3 to opus" or "add a task between 2 and 3" and the agent uses --add-task / --remove-task or just edits the YAML.

For docs or PRs, the agent can also output Mermaid:

```bash
plan.py --mermaid 01_TASKS.yaml
```

---

## Phase 4: Validate

Two layers of validation happen automatically.

### 4.1 Schema validation (plan.py --validate)

Checks every task has required fields: id, title, lane, runner, backend, mode, depends_on, definition_of_done.

```bash
plan.py --validate 01_TASKS.yaml
# [PASS] Plan is ready for /orchestrate
```

### 4.2 Domain validation (/review-plan)

Checks 13 categories: adversarial tests, skill overlap, claims match codebase, runner/backend validity, persona routing, design pipeline compliance, etc.

```bash
review-plan review 01_TASKS.yaml --suggest-fixes
# Tasks: 7, WARN: 0, FAIL: 0 -- All checks passed.
```

### 4.3 If validation FAILs

The agent triages each failure:

| Failure type | Action |
|---|---|
| Missing field (mode, DoD) | Agent fixes it directly |
| Wrong runner/backend | Fix if obvious, ask human if ambiguous |
| Missing capability_overlap | Run /memory recall, fill it in |
| Skill overlap detected | Ask human: use existing skill or justify? |
| Ambiguous requirements | Use /interview for structured choices |
| Claims don't match codebase | Re-read with /assess |

After fixes, re-run /review-plan. Do NOT proceed until PASS.

---

## Phase 5: Human Approval

> Agent: "Plan validated. 7 tasks, 4 waves, max concurrency 3. Estimated cost: ~$2 (1 opus task + 4 sonnet tasks). Ready to orchestrate?"

> Human: "Go."

---

## Phase 6: Orchestrate

/orchestrate run 01_TASKS.yaml triggers the execution chain:

### 6.1 Preflight (orchestrate/run.sh)

1. Detects .yaml file -> structured plan
2. Runs structured_plan.py validate (hard gate)
3. Runs /review-plan check (advisory warning)

### 6.2 Structured execution (structured_execute.py)

1. Loads YAML, builds TaskRuntime objects
2. Builds dependency graph (Kahn's algorithm)
3. Starts ThreadPoolExecutor(max_workers=3)

```
Wave 0: Task 1 (local) -> subprocess.run("docker compose up -d redis")
         Task 1 completes -> Tasks 2 becomes ready

Wave 1: Task 2 (subagent-service, opus) -> Docker container
         Task 2 completes -> Tasks 3,4,5,6 become ready

Wave 2: Tasks 3,4,5,6 (subagent-service, sonnet) -> 3 run in parallel
         (max_concurrency=3, so one waits)
         All complete -> Task 7 becomes ready

Wave 3: Task 7 (local) -> subprocess.run("pytest tests/test_api.py")
         Task 7 completes -> DONE
```

### 6.3 Subagent dispatch (for each subagent-service task)

```
structured_execute.py
  -> _run_subagent(task)
    -> _ensure_subagent_instance("orchestrate-1", cwd)
      -> subagent-service/run.sh start --name orchestrate-1 --workspace /repo
      -> Docker container starts on port 8620
    -> httpx.post("http://localhost:8620/chat", json={
         "prompt": "Task: Create cache utility module\n\nImplementation:\n- Create src/cache.py...",
         "model": "opus",
         "max_turns": 8
       })
```

### 6.4 Inside the Docker container (subagent-service/server.py)

```
POST /chat received
  -> resolve_backend("opus") -> ("claude", "opus")
  -> _build_cmd("claude", "opus", prompt, max_turns=8)
     -> ["claude", "-p", "<prompt>", "--output-format", "stream-json",
         "--verbose", "--dangerously-skip-permissions",
         "--model", "opus", "--max-turns", "8"]
  -> _clean_env("claude") -> strips CLAUDECODE env var
  -> asyncio.create_subprocess_exec(*cmd, cwd=WORKSPACE_DIR)
     -> Claude CLI runs inside container with:
        - All 225+ skills mounted from host
        - Host network (ArangoDB, embedding service accessible)
        - Workspace mounted (can read/write repo files)
  -> _collect_with_idle_timeout(proc, 120s)
  -> Return ChatResponse(response=..., cost_usd=0.45, ...)
```

### 6.5 Back in structured_execute.py

```
Task completes -> task.status = "completed"
  -> Decrement indegree of children
  -> Next wave becomes ready
  -> _render_state() -> write status.json
  -> Continue until all tasks done
  -> Exit 0
```

---

## Phase 7: Results

The agent reports completion:

> Agent: "All 7 tasks completed. Redis caching active on 4 endpoints.
> - Cost: $1.85 (1 opus + 4 sonnet)
> - Duration: 8 minutes
> - All blind tests passed
> - Integration tests passed
>
> Would you like a /create-walkthrough of the implementation?"

---

## The Three Plan Types

### Code-only (most common)

```
Conversation -> YAML -> Validate -> Orchestrate
```

Runners: local (setup/tests) + subagent-service (implementation)

### Design-only

```
Conversation -> /create-design-board -> Human approves -> YAML -> Validate -> Orchestrate
```

Each view gets the full pipeline as separate tasks:
- /ux-lab draft (lane X)
- /review-design --persona (lane X+1)
- /test-interactions (lane X+2)
- Write production TSX (lane X+3)

### Hybrid (code + design)

```
Conversation -> /create-design-board for UI views -> YAML with both -> Validate -> Orchestrate
```

Design tasks in early waves, code tasks in later waves. Same YAML schema for all three.

---

## Iterating on a Plan

Plans are living documents. No need to recreate from scratch.

```bash
# Add a task
plan.py --add-task 01_TASKS.yaml "title=Add cache metrics|runner=local|lane=2|depends_on=7|command=curl :9090/metrics"

# Remove a task (cleans up dangling deps)
plan.py --remove-task 01_TASKS.yaml:5

# See the updated DAG
plan.py --dag 01_TASKS.yaml

# Re-validate
plan.py --validate 01_TASKS.yaml
```

---

## What Each File Does

| File | Lines | Role |
|------|-------|------|
| plan/SKILL.md | 250 | Agent instructions (workflow, schema, field reference) |
| plan/plan.py | 725 | YAML serializer, validator, DAG visualizer, task mutation |
| best-practices-plan/SKILL.md | 418 | Rules: adversarial tests, anti-silo, persona, design pipeline |
| _shared/structured_plan.py | 363 | YAML loader, schema validator, markdown converter |
| review-plan/review_plan.py | 800 | 13 validation checks on plan tasks |
| orchestrate/run.sh | 677 | CLI router, YAML detection, preflight, dispatch |
| orchestrate/structured_execute.py | 355 | DAG scheduler, per-task dispatch to 3 runners |
| subagent-service/server.py | 600 | FastAPI: resolve backend, build CLI cmd, run subprocess |
| subagent-service/backends.yml | 61 | Backend registry (claude, codex, gemini configs) |

---

## Key Design Decisions

| Decision | Why |
|----------|-----|
| YAML not markdown | No regex parsing. No ambiguity. /orchestrate reads it directly. |
| Conversation is the planner | The LLM IS the planner. plan.py is just serialization. |
| One container per lane | Lane affinity. Tasks in same lane share filesystem state. |
| Blind tests per task | Agents game tests they can see. /test-lab is the adversary. |
| /review-plan as gate | Catches issues BEFORE burning LLM tokens on execution. |
| max_concurrency cap | Prevents the vitest OOM incident (2026-03-16) at the orchestration level. |
| Runner/backend explicit | No guessing at execution time. The plan IS the routing table. |

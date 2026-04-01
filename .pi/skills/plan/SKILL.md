---
name: plan
description: >
  Create orchestration-ready YAML task files (0N_TASKS.yaml) for /orchestrate.
  Decomposes goals into tasks with explicit runner, backend, mode, and lane fields.
  Supports code-only, design-only, and hybrid plans. Use when user says "plan this",
  "create task file", "break this down into tasks".
allowed-tools: Bash, Read, Write, Edit, Glob, Grep, Task, AskUserQuestion
triggers:
  - plan this
  - create task file
  - break this down
  - prepare tasks
  - plan implementation
  - create 0N_TASKS
  - task breakdown
  - decompose this
  - let's plan
metadata:
  short-description: Create orchestration-ready YAML task files
provides:
  - task-planning
composes:
  - memory
  - assess
  - task-monitor
  - best-practices-plan
read_before_use:
  - plan.py
  - design_pipeline.py
  - interviews.py
taxonomy:
  - orchestration
  - planning
---

> STOP. READ THIS ENTIRE SKILL.MD BEFORE CALLING ANY ENDPOINT.

# /plan

Create YAML task files that `/orchestrate` executes directly. No markdown intermediate.

**Before writing any plan, read `/best-practices-plan`** — it has the rules this skill enforces.

## Workflow

The full pipeline is: `/plan` → `/review-plan` → `/orchestrate`. The agent runs all three
when the user says `/plan`. The user only needs to say `/plan` once.

```
1. /memory recall     — Check if this problem was already solved
2. SKILL DISCOVERY    — Find existing skills that do what's needed (BLOCKING)
3. /assess            — Read the target codebase
4. Identify persona   — WHO uses this? Name them.
5. Decompose          — Break into tasks with runner/backend/mode
6. Output YAML        — Write 0N_TASKS.yaml
7. plan.py --dag      — Show execution DAG to human for approval
8. plan.py --validate — Schema validation
9. /review-plan       — Full validation (claims, routing, blind tests, overlap)
10. If PASS → ask human: "Plan ready. Run /orchestrate?"
11. If human approves → /orchestrate run 0N_TASKS.yaml
```

### Step 2: Runner Selection (which tasks get /code-runner)

Not every task should use `/code-runner`. Code-runner is a **bounded executor** — it keeps
the project agent from getting lost in implementation context. Use it for tasks that have
a clear input, a clear output, and a verifiable DoD.

| Runner | When to use | Example |
|--------|-------------|---------|
| `local` | Deterministic shell command, no LLM needed | `docker compose up`, `pytest`, `npm install` |
| `code-runner` | Bounded code task: write/fix ONE module with verifiable DoD | Fix auth.py bug, create new utility module |
| `subagent-service` | Open-ended tasks requiring exploration, design, or judgment | Research best approach, review code quality |
| `scillm` | Single LLM call for text generation (no code execution) | Generate docstring, summarize, classify |

**Use code-runner when:**
- The task writes/edits 1-3 specific files (use `allowlist`)
- There's a runnable DoD command that verifies correctness
- The LLM doesn't need to make architecture decisions
- Dependencies are known and can be listed in `read_context`

**Do NOT use code-runner when:**
- The task requires choosing between approaches ("pick the best DB") — that's a project agent decision
- The task is an integration test exercising 4+ modules — write it as `blind_tests` instead
- The DoD depends on external APIs/network — use mock DoD + real API in `blind_tests`
- The task is vague ("make it better") — decompose into specific bounded tasks first
- The task requires reading/understanding a large codebase — use `subagent-service` with iterative mode

**code-runner fields the project agent must provide:**
- `allowlist` — files the LLM can write (scope boundary)
- `read_context` — files the LLM should read for interface context (NOT write)
- `definition_of_done` — runnable verification command with assertions
- `blind_tests` — hidden assertions in `/test-lab` (optional, for adversarial verification)

### Step 3: Skill Discovery (BLOCKING — do NOT skip)

Before writing ANY task, check if an existing skill already does it. The agent MUST NOT
write bespoke code when a skill exists. This is the #1 source of architectural debt.

**How to check:**

```bash
# Search the manifest (fastest — one file, all 225+ skills)
cat ~/.pi/skills-manifest.json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for s in data['skills']:
    d = (s.get('description') or '').lower()
    if any(kw in d for kw in ['cache', 'redis', 'api']):
        print(f'  /{s[\"name\"]}: {s[\"description\"][:100]}')
"

# Or search skill names directly
ls ~/.pi/skills/ | grep -i cache

# Or ask memory
/memory recall "skill:caching" OR "skill:redis"
```

**Decision for each piece of work:**

| Existing skill covers it? | Action |
|---------------------------|--------|
| Yes, fully | CALL the skill. Do NOT rewrite it. |
| Yes, 60%+ | EXTEND the skill. Add what's missing. |
| No match | CREATE new code — but document WHY in capability_overlap. |

Every task in the YAML should map to CALL, EXTEND, or CREATE. If the plan is mostly
CREATE, you haven't looked hard enough. `/review-plan` will flag tasks that overlap
with existing skills as FAIL.

Steps 7-11 happen automatically after writing the YAML. The human only intervenes if
`/review-plan` FAILs (fix the plan) or if they want to amend the DAG before execution.

### If /review-plan FAILs

Triage each failure:

| Failure type | Action |
|---|---|
| Missing field (mode, DoD command) | Fix it yourself — no human input needed |
| Wrong runner/backend | Fix if obvious, ask human if ambiguous |
| Missing capability_overlap | Run `/memory recall` and fill it in |
| Skill overlap detected | Ask human: use existing skill or justify new code? |
| Ambiguous requirements | Use `/interview` for structured choices |
| Claims don't match codebase | Re-read the code with `/assess` |

After fixes, re-run `/review-plan`. Do NOT proceed to `/orchestrate` until PASS.
Do NOT silently skip FAILs — every FAIL must be resolved or explicitly waived by the human.

## Plan Types

Auto-detected from goal text. All types use the same YAML schema.

| Type | Detected When | Pattern |
|------|---------------|---------|
| **code** | No UI keywords | `local` for setup, `subagent-service` for implementation |
| **design** | views, components, TSX, dashboard, UI, React | `/mockup-lab` (Stitch) → `/ux-lab` (code) → `/mockup-lab review` (VLM verify) → `/test-interactions` |
| **hybrid** | Both UI and code keywords | Stitch pipeline for UI views, code tasks in later waves |

### Design Plans

**Rule: The agent NEVER designs UI.** Stitch designs it. The agent codes it.

Design plans MUST specify **device type** (desktop, mobile, tablet). Pass `--device`
to every `/mockup-lab` command. Stitch defaults to mobile if not specified.

For any plan with UI work, each component follows 3 steps:

1. `/mockup-lab` — Stitch generates design, human approves (`--device desktop`)
2. `/ux-lab` — Agent codes React component from approved screenshots
3. `/mockup-lab review` — Gemini VLM verifies implementation matches design

For small changes (colors, spacing, adding a column), skip step 1 and use
`/ux-lab` + `/review-design` directly.

Read `.pi/skills/mockup-lab/design-to-code.yaml` for the detailed checklist.

**DoD for UI tasks must be visual** — "tsc compiles" is not done. Done means
a screenshot shows real data matching the approved design.

## YAML Schema

```yaml
version: 1
kind: orchestrate-plan

metadata:
  title: "Feature Name"
  goal: "one-line summary"
  plan_type: code          # code, design, or hybrid
  created: "2026-03-17"
  primary_persona:         # WHO uses this (required)
    name: "Nico Bailon"
    role: "QA Engineer"
    source: ".pi/agents/nico-bailon/AGENTS.md"

execution:
  max_concurrency: 3       # parallel lanes

capability_overlap:        # Phase 0 evidence (required)
  - "/memory recall returned: no prior Redis caching solution"
  - "Checked /fetcher, /dogpile — no overlap"

questions_blockers:
  - "None"

lanes:
  - id: "0"
    label: "Wave 0: Setup"
  - id: "1"
    label: "Wave 1: Implementation"
  - id: "2"
    label: "Wave 2: Validation"

tasks:
  - id: "1"
    title: "Add Redis to docker-compose"
    lane: "0"
    runner: "local"          # deterministic shell command
    backend: ""              # no LLM needed
    mode: ""
    depends_on: []
    command: "docker compose up -d redis && redis-cli ping"
    definition_of_done:
      command: "redis-cli ping"
      assertion: "Returns PONG"

  - id: "2"
    title: "Create cache utility module"
    lane: "1"
    runner: "subagent-service"  # agent loop
    backend: "sonnet"           # which LLM
    mode: "iterative"           # iterative/one_shot/review
    agent: "general-purpose"
    depends_on: ["1"]
    implementation:
      - "Create src/cache.py with get/set/invalidate"
      - "TTL-based expiration using Redis SETEX"
    tests:
      - "test-lab/run.sh verify-task 2 src/ --domain python"
      - "tests/test_cache.py::test_set_get_ttl"
    definition_of_done:
      command: "uv run pytest tests/test_cache.py -q"
      assertion: "Value expires after TTL"
```

## Task Fields Reference

### Runner (how the task executes)

| Runner | Use For | Required Fields |
|--------|---------|-----------------|
| `local` | Shell commands (setup, tests, sanity scripts) | `command` |
| `scillm` | One-shot LLM inference (classification, extraction) | `backend`, `mode: one_shot` |
| `subagent-service` | Agent loops (coding, review, design) | `backend`, `mode`, `implementation` or `prompt` |

### Backend (which LLM model)

| Backend | Best For | Cost |
|---------|----------|------|
| `sonnet` | Boilerplate, scaffolding, monitoring, calling existing scripts | Low |
| `opus` | Architecture, novel design, cross-skill composition | High |
| `codex` | Code review, deep analysis, refactoring | Medium |
| `gemini` | Long content, large context, visual tasks | Medium |

**Decision heuristic**: "call existing script and check output" → sonnet. "understand 3 systems and wire them together" → opus. "review this code" → codex.

### Mode (execution style)

| Mode | Use For |
|------|---------|
| `iterative` | Multi-turn agent work (coding, design iteration) |
| `one_shot` | Single LLM inference (classification, extraction) |
| `review` | Review/assessment tasks |

## Usage

```bash
# Emit YAML template
plan.py

# Validate existing plan
plan.py --validate 01_TASKS.yaml

# Visualize execution DAG (waves, parallelism, routing)
plan.py --dag 01_TASKS.yaml

# Output DAG as Mermaid flowchart (for docs/PRs)
plan.py --mermaid 01_TASKS.yaml

# Convert legacy markdown to YAML
plan.py --convert 01_TASKS.md -o 01_TASKS.yaml

# Render YAML as markdown (for human review)
plan.py --render 01_TASKS.yaml

# Add a task to an existing plan (auto-assigns ID, wires deps)
plan.py --add-task 01_TASKS.yaml "title=Run integration tests|runner=local|lane=2|depends_on=2|command=pytest tests/"

# Remove a task (cleans up dangling deps)
plan.py --remove-task 01_TASKS.yaml:3

```

## Pipeline Position

```
/plan → /review-plan → /orchestrate
```

For design plans, the execution pipeline inside `/orchestrate` is:

```
/mockup-lab generate → /interview (human review) → /mockup-lab iterate
      ↓ approved design
/ux-lab (code React component)
      ↓ built component
/mockup-lab review (Gemini VLM visual diff)
      ↓ match_score < 90 → fix code → re-review
      ↓ match_score >= 90 → done
/test-interactions (verify interactions)
```

| Skill | Role |
|-------|------|
| `/best-practices-plan` | Rules this skill MUST follow (read first) |
| `/review-plan` | Validates the YAML before `/orchestrate` runs it |
| `/orchestrate` | Executes the YAML with per-task dispatch |
| `/test-lab` | Generates blind adversarial tests (required per task) |
| `/memory` | Phase 0: check for prior solutions |
| `/assess` | Phase 0: read the target codebase |
| `/interview` | Gather requirements when goal is ambiguous |
| `/dogpile` | Research unfamiliar dependencies |
| `/mockup-lab` | Design generation (Stitch) + VLM review (scillm) for UI plans |
| `/ux-lab` | React component development with Vite HMR |

## Common Mistakes

### WRONG: Writing bespoke code when a skill already exists
```yaml
tasks:
  - id: "1"
    title: "Implement PDF extraction"
    runner: "subagent-service"
    # A /extractor skill already does this!
```

### RIGHT: Check skill manifest first, call existing skills
```bash
cat ~/.pi/skills-manifest.json | python3 -c "..."  # search for existing skills
# Then in YAML: runner: local, command: ".pi/skills/extractor/run.sh ..."
```

### WRONG: Skipping /review-plan and going straight to /orchestrate
```bash
/orchestrate run 01_TASKS.yaml  # untested plan, may have skill overlap or wrong routing
```

### RIGHT: Always validate plan before execution
```bash
plan.py --validate 01_TASKS.yaml
/review-plan 01_TASKS.yaml  # must PASS before /orchestrate
```

### WRONG: Design tasks without specifying --device for Stitch
```yaml
tasks:
  - title: "Generate mockup"
    command: "mockup-lab generate"  # defaults to mobile!
```

### RIGHT: Always specify device type for design tasks
```yaml
tasks:
  - title: "Generate mockup"
    command: "mockup-lab generate --device desktop"
```

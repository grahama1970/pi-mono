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

### Step 2: Skill Discovery (BLOCKING — do NOT skip)

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
| **design** | views, components, TSX, dashboard, UI, React | `/create-design-board` first, then `/ux-lab` → `/review-design` → `/test-interactions` → write |
| **hybrid** | Both UI and code keywords | Design board for UI views, code tasks in later waves |

### Design Plans: Pre-Planning Gate

For `design` and `hybrid` plans, run `/create-design-board` BEFORE writing the YAML:

```
1. Detect plan_type: design
2. Identify primary persona
3. /create-design-board — generate visual layout mockups for human review
4. Human approves layout direction (or amends)
5. THEN decompose into tasks — each view gets the full pipeline:
     Task N:   /ux-lab draft             (lane X)
     Task N+1: /review-design --persona  (lane X+1, depends: N)
     Task N+2: /test-interactions        (lane X+2, depends: N+1)
     Task N+3: Write production TSX      (lane X+3, depends: N+2)
6. Write YAML
```

### NON-NEGOTIABLE: Visual Verification for UX Plans

Design plans MUST include these elements — `/review-plan` Check 14 will FAIL plans without them:

1. **Wave 0, Task 0: Launch dev server + browser** — `npm run dev` (both Vite + API proxy) and `xdg-open http://localhost:<port>`. This runs BEFORE any component code is written. The human watches the UI update in real-time via Vite HMR.

2. **Interaction manifest (REQUIRED)** — The plan YAML MUST include a `test_manifest` section listing every design element with: tab/view name, data source (collection + minimum expected rows), interactions to perform (click, filter, sort, keyboard shortcuts), and expected visual outcome. `/test-interactions` without a manifest is meaningless — it just screenshots blank pages. Example:
   ```yaml
   test_manifest:
     - tab: Controls
       collection: sparta_controls
       min_rows: 10
       interactions: [click_row, filter_framework, sort_column]
       visual: "Table shows rows, framework pills colored, detail slide-over opens on click"
     - tab: QRAs
       collection: sparta_qra
       min_rows: 5
       interactions: [keyboard_A, keyboard_R, navigate_next]
       visual: "Card shows Q/A/reasoning, tier badges visible, grounding bar colored"
   ```

3. **Per-view data verification** — Before writing a view, verify its data endpoint returns non-zero results. `curl -s -X POST /api/memory/list -d '{"collection":"<name>","limit":1}' | jq .total` must return > 0. If data is empty, fix the data path first — don't write CSS for an empty page.

4. **Per-view `/test-interactions`** — After each view is written, run `/test-interactions` against the manifest entries for that view. This captures a screenshot proving real data renders. Add to each view task's `tests` section.

5. **DoD must be visual** — "npm run build succeeds" is NOT acceptable as DoD for UX tasks. The DoD must reference manifest entries, screenshots, or visual assertions like "table shows N rows" or "chart renders with real data".

**Why:** Without these, the agent generates blind CSS. It writes 12 view components, runs `tsc`, declares success, and every page is empty because (a) the API server wasn't running, (b) the hooks called wrong endpoints, or (c) the data shape didn't match. The manifest is the contract — it defines what "done" looks like for each element before any code is written.

Do NOT write design task YAML without an approved design board. The board is what tells
you how many views, what layout each view has, and what the persona's workflow looks like.
Without it, the agent invents UI that nobody reviewed.

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

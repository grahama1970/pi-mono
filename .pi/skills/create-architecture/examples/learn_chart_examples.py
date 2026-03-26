"""Batch-learn chart design examples into /memory for /create-architecture skill."""

import subprocess
import sys

SCOPE = "pi-mono"
BASE_TAGS = ["chart-design", "create-architecture", "excalidraw"]


def learn(problem: str, solution: str, tags: list[str]):
    """Call memory-agent learn with the given problem/solution."""
    cmd = [
        sys.executable, "-m", "graph_memory.agent_cli", "learn",
        "-p", problem,
        "-s", solution,
        "--scope", SCOPE,
    ]
    for t in BASE_TAGS + tags:
        cmd.extend(["-t", t])
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    status = "OK" if result.returncode == 0 else "FAIL"
    print(f"  [{status}] {problem[:80]}...")
    if result.returncode != 0:
        print(f"    stderr: {result.stderr[:200]}")


# ─────────────────────────────────────────────────────────────────
# GOOD EXAMPLES
# ─────────────────────────────────────────────────────────────────

GOOD = [
    # --- Category: Linear Pipeline ---
    {
        "problem": "GOOD chart-design: Simple linear pipeline (3-5 nodes, single column). User request: 'show me the data ingestion pipeline'",
        "solution": """Layout: Single column (col 0 only), 3-5 rows.
Canvas: 1300x700. row_h = 700/5 = 140px. col_w = 1300 (single col, cap box_w at 40%).
box_w = min(1300*0.4, 350) = 350px. box_h = 140*0.55 = 77px.
font_size = max(10, min(14, 140*0.15)) = 14px.
Center boxes horizontally: x_offset = (1300 - 350) / 2 = 475px.

YAML structure:
components:
  - {id: ingest, label: "Ingest", row: 0, col: 0, color: blue}
  - {id: transform, label: "Transform", row: 1, col: 0, color: amber}
  - {id: validate, label: "Validate", row: 2, col: 0, color: green}
  - {id: store, label: "Store", row: 3, col: 0, color: purple}
connections:
  - {from: ingest, to: transform}
  - {from: transform, to: validate}
  - {from: validate, to: store}

Why it works: Generous vertical spacing, readable font, centered on canvas. No wasted horizontal space.""",
        "tags": ["good-example", "linear-pipeline", "simple"],
    },
    {
        "problem": "GOOD chart-design: Long linear pipeline (8-10 nodes). User request: 'show the full CI/CD pipeline from commit to deploy'",
        "solution": """Layout: Single column, 10 rows. Canvas: 1300x700.
row_h = 700/10 = 70px. box_h = 70*0.55 = 38px. font_size = max(10, min(14, 70*0.15)) = 10px.
box_w = min(1300*0.4, 350) = 350px. Subtitle: SKIP (box_h < 2-line threshold of ~36px, marginal).

YAML structure:
components:
  - {id: commit, label: "Git Commit", row: 0, col: 0, color: blue}
  - {id: lint, label: "Lint", row: 1, col: 0, color: green}
  - {id: unit_test, label: "Unit Tests", row: 2, col: 0, color: green}
  - {id: build, label: "Build", row: 3, col: 0, color: amber}
  - {id: integration, label: "Integration Tests", row: 4, col: 0, color: green}
  - {id: security, label: "Security Scan", row: 5, col: 0, color: red}
  - {id: stage, label: "Stage Deploy", row: 6, col: 0, color: purple}
  - {id: smoke, label: "Smoke Tests", row: 7, col: 0, color: green}
  - {id: approve, label: "Manual Approve", row: 8, col: 0, color: amber}
  - {id: prod, label: "Prod Deploy", row: 9, col: 0, color: purple}
connections: [{from: commit, to: lint}, {from: lint, to: unit_test}, ...]

Why it works: 10 nodes still fit in 700px. Font drops to 10px minimum. Subtitles hidden to save space. Each box is 38px tall — tight but readable.""",
        "tags": ["good-example", "linear-pipeline", "long"],
    },

    # --- Category: Decision Tree (Binary Fork) ---
    {
        "problem": "GOOD chart-design: Binary decision tree fork. User request: 'show the authentication flow with success/failure branches'",
        "solution": """Layout: 3 columns. Col 0 = main flow. Col 1 = success branch. Col 2 = failure branch.
Decision node at row 2 forks LEFT (col 1, row 3) and RIGHT (col 2, row 3).
Canvas: 1300x700. 6 rows, 3 cols.
row_h = 700/6 = 117px. col_w = 1300/3 = 433px. box_w = 433*0.7 = 303px. box_h = 117*0.55 = 64px.

YAML structure:
components:
  - {id: request, label: "Login Request", row: 0, col: 1, color: blue}
  - {id: validate, label: "Validate Credentials", row: 1, col: 1, color: amber}
  - {id: decision, label: "◇ Valid?", row: 2, col: 1, color: amber}
  - {id: success, label: "Issue JWT", row: 3, col: 0, color: green}
  - {id: failure, label: "401 Unauthorized", row: 3, col: 2, color: red}
  - {id: dashboard, label: "Redirect Dashboard", row: 4, col: 0, color: purple}
  - {id: retry, label: "Show Error + Retry", row: 4, col: 2, color: red}
connections:
  - {from: request, to: validate}
  - {from: validate, to: decision}
  - {from: decision, to: success}
  - {from: decision, to: failure}
  - {from: success, to: dashboard}
  - {from: failure, to: retry}

KEY RULE: Decision node centered (col 1), branches fork LEFT and RIGHT at same row.
The ◇ prefix signals diamond/decision shape. Branches are SIBLINGS at the same row level.""",
        "tags": ["good-example", "decision-tree", "binary-fork"],
    },
    {
        "problem": "GOOD chart-design: Multi-level decision tree (nested decisions). User request: 'show the request routing with multiple decision points'",
        "solution": """Layout: Decision nodes fork at each level. Each fork creates new columns.
Canvas: 1300x700. Use 5 cols for 2 levels of binary decisions.

Level 1: Decision at (row 1, col 2) forks to col 1 and col 3.
Level 2a: Decision at (row 3, col 1) forks to col 0 and col 1.
Level 2b: Decision at (row 3, col 3) forks to col 3 and col 4.

YAML structure:
components:
  - {id: input, label: "Request", row: 0, col: 2, color: blue}
  - {id: d1, label: "◇ Authenticated?", row: 1, col: 2, color: amber}
  - {id: auth_yes, label: "Check Permissions", row: 2, col: 1, color: blue}
  - {id: auth_no, label: "Login Page", row: 2, col: 3, color: red}
  - {id: d2, label: "◇ Authorized?", row: 3, col: 1, color: amber}
  - {id: allow, label: "Serve Content", row: 4, col: 0, color: green}
  - {id: deny, label: "403 Forbidden", row: 4, col: 2, color: red}
connections:
  - {from: input, to: d1}
  - {from: d1, to: auth_yes}
  - {from: d1, to: auth_no}
  - {from: auth_yes, to: d2}
  - {from: d2, to: allow}
  - {from: d2, to: deny}

KEY RULE: Each decision level halves the available columns. Start root at center col.
Branches always go LEFT for YES/success, RIGHT for NO/failure (consistent polarity).""",
        "tags": ["good-example", "decision-tree", "nested", "multi-level"],
    },

    # --- Category: Decision Tree (3-way Fork) ---
    {
        "problem": "GOOD chart-design: Three-way decision fork. User request: 'show the entity validation with PASS/CLARIFY/REJECT outcomes'",
        "solution": """Layout: 3 columns for 3 outcomes. Decision node at center column.
Canvas: 1300x700. 5 rows, 3 cols.
row_h = 700/5 = 140px. col_w = 1300/3 = 433px. box_w = 303px.

YAML structure:
components:
  - {id: input, label: "User Query", row: 0, col: 1, color: blue}
  - {id: extract, label: "Entity Extraction", row: 1, col: 1, color: blue}
  - {id: gate, label: "◇ Anchoring Gate", row: 2, col: 1, color: amber}
  - {id: pass, label: "PASS → Enrich", row: 3, col: 0, color: green}
  - {id: clarify, label: "CLARIFY", row: 3, col: 1, color: amber}
  - {id: reject, label: "REJECT", row: 3, col: 2, color: red}
  - {id: execute, label: "Execute Query", row: 4, col: 0, color: green}
connections:
  - {from: input, to: extract}
  - {from: extract, to: gate}
  - {from: gate, to: pass}
  - {from: gate, to: clarify}
  - {from: gate, to: reject}
  - {from: pass, to: execute}

KEY RULE: 3-way fork places outcomes at the SAME ROW across 3 columns.
Center branch stays in center column. Left = happy path. Right = error/reject.""",
        "tags": ["good-example", "decision-tree", "three-way-fork"],
    },

    # --- Category: Pipeline with Side Branch ---
    {
        "problem": "GOOD chart-design: Pipeline with early exit branch. User request: 'show the cache-first pattern with cache hit/miss'",
        "solution": """Layout: Main flow in col 0, early exit in col 1.
The branch departs at the decision point and terminates — it does NOT rejoin.
Canvas: 1300x700. 6 rows, 2 cols.
row_h = 117px. col_w = 650px. box_w = 455px.

YAML structure:
components:
  - {id: request, label: "Request", row: 0, col: 0, color: blue}
  - {id: cache_check, label: "◇ Cache Hit?", row: 1, col: 0, color: amber}
  - {id: cache_hit, label: "Return Cached", row: 2, col: 1, color: green}
  - {id: fetch, label: "Fetch from DB", row: 2, col: 0, color: blue}
  - {id: transform, label: "Transform", row: 3, col: 0, color: amber}
  - {id: cache_store, label: "Store in Cache", row: 4, col: 0, color: green}
  - {id: respond, label: "Return Response", row: 5, col: 0, color: green}
connections:
  - {from: request, to: cache_check}
  - {from: cache_check, to: cache_hit}
  - {from: cache_check, to: fetch}
  - {from: fetch, to: transform}
  - {from: transform, to: cache_store}
  - {from: cache_store, to: respond}

KEY RULE: Early exit goes to a DIFFERENT COLUMN at the same row as the next main step.
It terminates there — no arrow back. The 'return' is implicit.""",
        "tags": ["good-example", "pipeline", "early-exit", "cache-pattern"],
    },

    # --- Category: Pipeline with Multiple Branches ---
    {
        "problem": "GOOD chart-design: Pipeline with multiple branch points. User request: 'show the order processing with validation, payment, and fulfillment branches'",
        "solution": """Layout: Main flow center (col 1), errors branch right (col 2), fast-track left (col 0).
Canvas: 1300x700. 8 rows, 3 cols.
row_h = 87px. col_w = 433px. box_w = 303px. box_h = 48px. font_size = 13px.

YAML structure:
components:
  - {id: order, label: "New Order", row: 0, col: 1, color: blue}
  - {id: validate, label: "◇ Valid?", row: 1, col: 1, color: amber}
  - {id: invalid, label: "Reject Order", row: 1, col: 2, color: red}
  - {id: payment, label: "Process Payment", row: 2, col: 1, color: amber}
  - {id: pay_fail, label: "Payment Failed", row: 2, col: 2, color: red}
  - {id: pay_gate, label: "◇ Paid?", row: 3, col: 1, color: amber}
  - {id: fulfill, label: "Fulfill Order", row: 4, col: 1, color: green}
  - {id: ship, label: "Ship", row: 5, col: 1, color: purple}
connections:
  - {from: order, to: validate}
  - {from: validate, to: invalid}
  - {from: validate, to: payment}
  - {from: payment, to: pay_gate}
  - {from: pay_gate, to: pay_fail}
  - {from: pay_gate, to: fulfill}
  - {from: fulfill, to: ship}

KEY RULE: Error branches all go to the SAME column (col 2).
Each decision node forks right for errors, continues down for happy path.""",
        "tags": ["good-example", "pipeline", "multiple-branches"],
    },

    # --- Category: State Machine ---
    {
        "problem": "GOOD chart-design: Simple state machine (3-4 states). User request: 'show the document lifecycle states'",
        "solution": """Layout: State machines are HORIZONTAL, not vertical. Use row for grouping, col for progression.
Canvas: 1300x700. 1-2 rows, 4 cols.
col_w = 325px. row_h = 350px. box_w = 227px. box_h = 192px (large boxes for state detail).

YAML structure:
components:
  - {id: draft, label: "DRAFT", row: 0, col: 0, color: blue}
  - {id: review, label: "IN REVIEW", row: 0, col: 1, color: amber}
  - {id: approved, label: "APPROVED", row: 0, col: 2, color: green}
  - {id: archived, label: "ARCHIVED", row: 0, col: 3, color: dim}
connections:
  - {from: draft, to: review}
  - {from: review, to: approved}
  - {from: review, to: draft}
  - {from: approved, to: archived}

KEY RULE: State machines flow LEFT-TO-RIGHT. Back-edges (review→draft) route below the boxes.
Use a single row. Color intensity shows progression (blue→amber→green→dim).""",
        "tags": ["good-example", "state-machine", "horizontal"],
    },
    {
        "problem": "GOOD chart-design: Complex state machine (5+ states with cycles). User request: 'show the incident response state machine'",
        "solution": """Layout: 2 rows. Top row = happy path states. Bottom row = exception states.
Canvas: 1300x700. 2 rows, 4 cols.
row_h = 350px. col_w = 325px. box_w = 227px.

YAML structure:
components:
  # Happy path (row 0)
  - {id: detected, label: "DETECTED", row: 0, col: 0, color: red}
  - {id: triaged, label: "TRIAGED", row: 0, col: 1, color: amber}
  - {id: contained, label: "CONTAINED", row: 0, col: 2, color: blue}
  - {id: resolved, label: "RESOLVED", row: 0, col: 3, color: green}
  # Exception states (row 1)
  - {id: escalated, label: "ESCALATED", row: 1, col: 1, color: red}
  - {id: reopened, label: "REOPENED", row: 1, col: 2, color: amber}
connections:
  - {from: detected, to: triaged}
  - {from: triaged, to: contained}
  - {from: triaged, to: escalated}
  - {from: contained, to: resolved}
  - {from: resolved, to: reopened}
  - {from: reopened, to: triaged}
  - {from: escalated, to: contained}

KEY RULE: Cycles are visible because exception states sit BELOW, making back-edges obvious.
Never stack all states vertically — it hides the lifecycle progression.""",
        "tags": ["good-example", "state-machine", "complex", "cycles"],
    },

    # --- Category: Fan-Out / Fan-In ---
    {
        "problem": "GOOD chart-design: Fan-out/fan-in (parallel processing with join). User request: 'show the parallel data enrichment pipeline'",
        "solution": """Layout: Diamond shape. 1 node fans out to 3 parallel nodes, then 3 merge back to 1.
Canvas: 1300x700. 4 rows, 3 cols.
row_h = 175px. col_w = 433px. box_w = 303px.

YAML structure:
components:
  - {id: split, label: "Split Work", row: 0, col: 1, color: blue}
  - {id: worker_a, label: "Enrich Entities", row: 1, col: 0, color: amber}
  - {id: worker_b, label: "Enrich Relations", row: 1, col: 1, color: amber}
  - {id: worker_c, label: "Enrich Taxonomy", row: 1, col: 2, color: amber}
  - {id: join, label: "Merge Results", row: 2, col: 1, color: blue}
  - {id: store, label: "Store", row: 3, col: 1, color: green}
connections:
  - {from: split, to: worker_a}
  - {from: split, to: worker_b}
  - {from: split, to: worker_c}
  - {from: worker_a, to: join}
  - {from: worker_b, to: join}
  - {from: worker_c, to: join}
  - {from: join, to: store}

KEY RULE: Parallel workers share the SAME ROW. Fan-out node centered above, fan-in centered below.
Creates visual diamond/hourglass shape. Workers are peers — same color, same row.""",
        "tags": ["good-example", "fan-out-fan-in", "parallel"],
    },

    # --- Category: Layered Architecture ---
    {
        "problem": "GOOD chart-design: 3-tier layered architecture. User request: 'show the frontend/API/database layers'",
        "solution": """Layout: 3 rows, each row is a tier. Multiple nodes per tier arranged in columns.
Canvas: 1300x700. 3 rows, 3 cols.
row_h = 233px. col_w = 433px. box_w = 303px.

YAML structure:
components:
  # Presentation tier (row 0)
  - {id: web, label: "Web App", row: 0, col: 0, color: purple}
  - {id: mobile, label: "Mobile App", row: 0, col: 1, color: purple}
  - {id: cli, label: "CLI", row: 0, col: 2, color: purple}
  # API tier (row 1)
  - {id: gateway, label: "API Gateway", row: 1, col: 0, color: blue}
  - {id: auth, label: "Auth Service", row: 1, col: 1, color: blue}
  - {id: business, label: "Business Logic", row: 1, col: 2, color: blue}
  # Data tier (row 2)
  - {id: postgres, label: "PostgreSQL", row: 2, col: 0, color: green}
  - {id: redis, label: "Redis Cache", row: 2, col: 1, color: green}
  - {id: s3, label: "S3 Storage", row: 2, col: 2, color: green}
connections:
  - {from: web, to: gateway}
  - {from: mobile, to: gateway}
  - {from: cli, to: gateway}
  - {from: gateway, to: auth}
  - {from: gateway, to: business}
  - {from: business, to: postgres}
  - {from: business, to: redis}
  - {from: business, to: s3}

KEY RULE: Each tier is a row. Color per tier (all purple, all blue, all green).
All nodes in a tier share the same row. Cross-tier arrows go straight down.""",
        "tags": ["good-example", "layered-architecture", "three-tier"],
    },

    # --- Category: ETL Pipeline ---
    {
        "problem": "GOOD chart-design: ETL pipeline with error handling. User request: 'show the data pipeline from source to warehouse'",
        "solution": """Layout: Main flow col 0, error handling col 1.
Canvas: 1300x700. 7 rows, 2 cols.
row_h = 100px. col_w = 650px. box_w = 455px. box_h = 55px. font_size = 14px.

YAML structure:
components:
  - {id: source, label: "Source DB", tech: "PostgreSQL", row: 0, col: 0, color: blue}
  - {id: extract, label: "Extract", tech: "CDC + Debezium", row: 1, col: 0, color: blue}
  - {id: validate, label: "◇ Schema Valid?", row: 2, col: 0, color: amber}
  - {id: schema_err, label: "DLQ: Schema Errors", row: 2, col: 1, color: red}
  - {id: transform, label: "Transform", tech: "dbt models", row: 3, col: 0, color: amber}
  - {id: quality, label: "◇ Quality Gate", row: 4, col: 0, color: amber}
  - {id: quality_err, label: "DLQ: Quality Fails", row: 4, col: 1, color: red}
  - {id: load, label: "Load", tech: "Snowflake COPY INTO", row: 5, col: 0, color: green}
  - {id: done, label: "Dashboard Ready", row: 6, col: 0, color: green}
connections:
  - {from: source, to: extract}
  - {from: extract, to: validate}
  - {from: validate, to: schema_err}
  - {from: validate, to: transform}
  - {from: transform, to: quality}
  - {from: quality, to: quality_err}
  - {from: quality, to: load}
  - {from: load, to: done}

KEY RULE: Error branches (DLQ) at same row as their decision point, in col 1.
Creates a 'railroad diagram' pattern — main track left, sidings right.""",
        "tags": ["good-example", "etl-pipeline", "error-handling"],
    },

    # --- Category: Event-Driven ---
    {
        "problem": "GOOD chart-design: Event-driven architecture. User request: 'show the event bus with publishers and subscribers'",
        "solution": """Layout: 3 rows. Row 0 = producers. Row 1 = event bus (single wide node). Row 2 = consumers.
Canvas: 1300x700. 3 rows, 4 cols.
row_h = 233px. col_w = 325px.

YAML structure:
components:
  # Producers (row 0)
  - {id: api, label: "API Server", row: 0, col: 0, color: blue}
  - {id: webhook, label: "Webhook Receiver", row: 0, col: 1, color: blue}
  - {id: cron, label: "Cron Jobs", row: 0, col: 2, color: blue}
  - {id: ui, label: "User Actions", row: 0, col: 3, color: purple}
  # Bus (row 1, spans center)
  - {id: bus, label: "Event Bus (Kafka)", row: 1, col: 1, color: amber}
  # Consumers (row 2)
  - {id: notify, label: "Notification Svc", row: 2, col: 0, color: green}
  - {id: analytics, label: "Analytics", row: 2, col: 1, color: green}
  - {id: search, label: "Search Index", row: 2, col: 2, color: green}
  - {id: audit, label: "Audit Log", row: 2, col: 3, color: green}
connections:
  - {from: api, to: bus}
  - {from: webhook, to: bus}
  - {from: cron, to: bus}
  - {from: ui, to: bus}
  - {from: bus, to: notify}
  - {from: bus, to: analytics}
  - {from: bus, to: search}
  - {from: bus, to: audit}

KEY RULE: Event bus is the waist of the hourglass. Producers above, consumers below.
All connections route through the single bus node. No direct producer→consumer arrows.""",
        "tags": ["good-example", "event-driven", "pub-sub"],
    },

    # --- Category: Approval / Review Workflow ---
    {
        "problem": "GOOD chart-design: Approval workflow with reject loop. User request: 'show the code review and merge process'",
        "solution": """Layout: Main flow col 0, rejection path col 1 with arrow back up.
Canvas: 1300x700. 6 rows, 2 cols.
row_h = 117px. col_w = 650px.

YAML structure:
components:
  - {id: pr, label: "Open PR", row: 0, col: 0, color: blue}
  - {id: ci, label: "CI Checks", row: 1, col: 0, color: green}
  - {id: review, label: "◇ Approved?", row: 2, col: 0, color: amber}
  - {id: reject, label: "Request Changes", row: 2, col: 1, color: red}
  - {id: merge, label: "Merge to Main", row: 3, col: 0, color: green}
  - {id: deploy, label: "Deploy", row: 4, col: 0, color: purple}
connections:
  - {from: pr, to: ci}
  - {from: ci, to: review}
  - {from: review, to: reject}
  - {from: review, to: merge}
  - {from: reject, to: pr}
  - {from: merge, to: deploy}

KEY RULE: Reject branches right (col 1), then loops BACK UP to the start.
The back-edge (reject→pr) creates a visible cycle. Use red color for rejection path.
Loop-back arrows route: right side down, then left back up — creating a visible 'U' shape.""",
        "tags": ["good-example", "approval-workflow", "loop-back"],
    },

    # --- Category: Fallback Chain ---
    {
        "problem": "GOOD chart-design: Fallback chain (try A, else B, else C). User request: 'show the LLM provider fallback chain'",
        "solution": """Layout: Staircase pattern. Each fallback steps down AND right.
Canvas: 1300x700. 5 rows, 3 cols (main col 0, fallbacks cascade right).
row_h = 140px. col_w = 433px.

YAML structure:
components:
  - {id: request, label: "LLM Request", row: 0, col: 0, color: blue}
  - {id: try_a, label: "Try Claude", row: 1, col: 0, color: green}
  - {id: fail_a, label: "◇ Success?", row: 2, col: 0, color: amber}
  - {id: try_b, label: "Try GPT-5", row: 2, col: 1, color: amber}
  - {id: fail_b, label: "◇ Success?", row: 3, col: 1, color: amber}
  - {id: try_c, label: "Try Local Model", row: 3, col: 2, color: red}
  - {id: result, label: "Return Result", row: 4, col: 0, color: green}
connections:
  - {from: request, to: try_a}
  - {from: try_a, to: fail_a}
  - {from: fail_a, to: try_b}
  - {from: fail_a, to: result}
  - {from: try_b, to: fail_b}
  - {from: fail_b, to: try_c}
  - {from: fail_b, to: result}
  - {from: try_c, to: result}

KEY RULE: Fallbacks cascade diagonally (down + right). Each failure shifts one column right.
Success arrows all converge back to the result node (col 0, bottom).
Visual staircase shape communicates 'degradation' from left (best) to right (worst).""",
        "tags": ["good-example", "fallback-chain", "degradation"],
    },

    # --- Category: Microservices ---
    {
        "problem": "GOOD chart-design: Microservices communication. User request: 'show how the order service talks to inventory and payment'",
        "solution": """Layout: Star pattern with central orchestrator.
Canvas: 1300x700. 3 rows, 3 cols.
row_h = 233px. col_w = 433px.

YAML structure:
components:
  - {id: gateway, label: "API Gateway", row: 0, col: 1, color: blue}
  - {id: order, label: "Order Service", row: 1, col: 1, color: amber}
  - {id: inventory, label: "Inventory Svc", row: 1, col: 0, color: green}
  - {id: payment, label: "Payment Svc", row: 1, col: 2, color: green}
  - {id: notification, label: "Notification Svc", row: 2, col: 0, color: purple}
  - {id: db, label: "Order DB", row: 2, col: 1, color: dim}
  - {id: analytics, label: "Analytics Svc", row: 2, col: 2, color: purple}
connections:
  - {from: gateway, to: order}
  - {from: order, to: inventory}
  - {from: order, to: payment}
  - {from: order, to: notification}
  - {from: order, to: db}
  - {from: order, to: analytics}

KEY RULE: Central service at center. Peers at same row. Dependents below.
Spoke pattern radiates from center. No cross-service arrows — all through orchestrator.""",
        "tags": ["good-example", "microservices", "star-pattern"],
    },

    # --- Category: Hierarchical Decomposition ---
    {
        "problem": "GOOD chart-design: Hierarchical decomposition (org chart / module tree). User request: 'show the module dependency tree'",
        "solution": """Layout: Tree structure. Root at top center. Children fan out below.
Canvas: 1300x700. 3 rows, 4 cols (bottom row has most nodes).
row_h = 233px. col_w = 325px.

YAML structure:
components:
  - {id: app, label: "Application", row: 0, col: 1, color: blue}
  - {id: auth, label: "Auth Module", row: 1, col: 0, color: green}
  - {id: core, label: "Core Module", row: 1, col: 1, color: green}
  - {id: api, label: "API Module", row: 1, col: 2, color: green}
  - {id: jwt, label: "JWT", row: 2, col: 0, color: dim}
  - {id: config, label: "Config", row: 2, col: 1, color: dim}
  - {id: routes, label: "Routes", row: 2, col: 2, color: dim}
  - {id: middleware, label: "Middleware", row: 2, col: 3, color: dim}
connections:
  - {from: app, to: auth}
  - {from: app, to: core}
  - {from: app, to: api}
  - {from: auth, to: jwt}
  - {from: core, to: config}
  - {from: api, to: routes}
  - {from: api, to: middleware}

KEY RULE: Parent centered above children. Each level fans wider.
Root at (0, center), children at row 1, grandchildren at row 2.
Column count increases with depth — widest row determines grid.""",
        "tags": ["good-example", "hierarchical", "tree"],
    },

    # --- Category: Data Flow with Merge ---
    {
        "problem": "GOOD chart-design: Multiple sources merging into one sink. User request: 'show data sources feeding into the data lake'",
        "solution": """Layout: Inverted fan — multiple sources at top, merge at bottom.
Canvas: 1300x700. 3 rows, 4 cols.
row_h = 233px. col_w = 325px.

YAML structure:
components:
  - {id: crm, label: "CRM Data", row: 0, col: 0, color: blue}
  - {id: erp, label: "ERP Data", row: 0, col: 1, color: blue}
  - {id: web, label: "Web Analytics", row: 0, col: 2, color: blue}
  - {id: iot, label: "IoT Sensors", row: 0, col: 3, color: blue}
  - {id: lake, label: "Data Lake", row: 1, col: 1, color: amber}
  - {id: warehouse, label: "Data Warehouse", row: 2, col: 1, color: green}
connections:
  - {from: crm, to: lake}
  - {from: erp, to: lake}
  - {from: web, to: lake}
  - {from: iot, to: lake}
  - {from: lake, to: warehouse}

KEY RULE: Sources spread across top row. Merge point centered below.
Funnel shape — wide at top, narrow at bottom. All source nodes same color.""",
        "tags": ["good-example", "data-flow", "merge", "funnel"],
    },

    # --- Category: Request-Response with Retry ---
    {
        "problem": "GOOD chart-design: Request with retry loop and timeout. User request: 'show the API call with retry and circuit breaker'",
        "solution": """Layout: Main flow col 0, retry path col 1, circuit breaker col 2.
Canvas: 1300x700. 6 rows, 3 cols.

YAML structure:
components:
  - {id: call, label: "API Call", row: 0, col: 0, color: blue}
  - {id: response, label: "◇ Response?", row: 1, col: 0, color: amber}
  - {id: success, label: "Return Data", row: 2, col: 0, color: green}
  - {id: retry_check, label: "◇ Retries Left?", row: 2, col: 1, color: amber}
  - {id: backoff, label: "Exponential Backoff", row: 3, col: 1, color: amber}
  - {id: circuit, label: "Circuit OPEN", row: 3, col: 2, color: red}
  - {id: fallback, label: "Return Fallback", row: 4, col: 2, color: red}
connections:
  - {from: call, to: response}
  - {from: response, to: success}
  - {from: response, to: retry_check}
  - {from: retry_check, to: backoff}
  - {from: retry_check, to: circuit}
  - {from: backoff, to: call}
  - {from: circuit, to: fallback}

KEY RULE: Retry creates a visible loop (backoff → call). Circuit breaker cascades right.
The loop-back arrow is the most important visual — it shows the retry mechanism.""",
        "tags": ["good-example", "retry-pattern", "circuit-breaker"],
    },

    # --- Category: Swimlane ---
    {
        "problem": "GOOD chart-design: Swimlane layout (actors in columns). User request: 'show the order process across customer, system, and warehouse'",
        "solution": """Layout: Each actor gets a column. Time flows top-to-bottom.
Canvas: 1300x700. 5 rows, 3 cols (Customer=col0, System=col1, Warehouse=col2).
row_h = 140px. col_w = 433px.

YAML structure:
components:
  # Customer lane (col 0)
  - {id: browse, label: "Browse Products", row: 0, col: 0, color: purple}
  - {id: checkout, label: "Checkout", row: 1, col: 0, color: purple}
  - {id: receive, label: "Receive Package", row: 4, col: 0, color: purple}
  # System lane (col 1)
  - {id: validate, label: "Validate Order", row: 1, col: 1, color: blue}
  - {id: charge, label: "Charge Payment", row: 2, col: 1, color: blue}
  - {id: confirm, label: "Send Confirmation", row: 3, col: 1, color: blue}
  # Warehouse lane (col 2)
  - {id: pick, label: "Pick Items", row: 2, col: 2, color: green}
  - {id: pack, label: "Pack & Ship", row: 3, col: 2, color: green}
connections:
  - {from: browse, to: checkout}
  - {from: checkout, to: validate}
  - {from: validate, to: charge}
  - {from: charge, to: pick}
  - {from: pick, to: pack}
  - {from: pack, to: confirm}
  - {from: confirm, to: receive}

KEY RULE: Each actor owns a column. Cross-lane arrows show handoffs between actors.
Color per lane. Empty cells are OK — not every actor acts at every step.""",
        "tags": ["good-example", "swimlane", "actors"],
    },

    # --- Category: Conditional Cascade ---
    {
        "problem": "GOOD chart-design: Classification cascade (T0→T1→T2). User request: 'show the 3-tier validation cascade'",
        "solution": """Layout: Waterfall with confidence gates. Main flow col 0, confident exits col 1.
Canvas: 1300x700. 7 rows, 2 cols.
row_h = 100px. col_w = 650px.

YAML structure:
components:
  - {id: input, label: "Input Document", row: 0, col: 0, color: blue}
  - {id: t0, label: "T0: Heuristic", tech: "<5ms", row: 1, col: 0, color: green}
  - {id: t0_gate, label: "◇ Confident?", row: 2, col: 0, color: amber}
  - {id: t0_done, label: "Return T0 Result", row: 2, col: 1, color: green}
  - {id: t1, label: "T1.5: Classifier", tech: "<50ms", row: 3, col: 0, color: amber}
  - {id: t1_gate, label: "◇ Confident?", row: 4, col: 0, color: amber}
  - {id: t1_done, label: "Return T1 Result", row: 4, col: 1, color: green}
  - {id: t2, label: "T2: LLM Teacher", tech: "1-5s", row: 5, col: 0, color: red}
  - {id: result, label: "Return T2 Result", row: 6, col: 0, color: green}
connections:
  - {from: input, to: t0}
  - {from: t0, to: t0_gate}
  - {from: t0_gate, to: t0_done}
  - {from: t0_gate, to: t1}
  - {from: t1, to: t1_gate}
  - {from: t1_gate, to: t1_done}
  - {from: t1_gate, to: t2}
  - {from: t2, to: result}

KEY RULE: Each tier has a confidence gate. Confident results exit RIGHT (early return).
Low confidence continues DOWN to the next tier. Creates 'railroad with sidings' pattern.
Latency increases downward (green→amber→red coloring matches cost).""",
        "tags": ["good-example", "cascade", "tiered", "classification"],
    },

    # --- Category: Diamond / Decision Point ---
    {
        "problem": "GOOD chart-design: Proper diamond decision node conventions. User request: 'how should decision nodes look in architecture diagrams?'",
        "solution": """Decision node conventions for /create-architecture:

1. LABEL: Prefix with ◇ character: '◇ Is Valid?' or '◇ Authenticated?'
2. COLOR: Always amber (decision = uncertain/pending)
3. SHAPE: The ◇ prefix triggers diamond rendering in the layout engine
4. BRANCHES: Fork LEFT for YES/success, RIGHT for NO/failure
5. PLACEMENT: Decision node stays in the main flow column
6. OUTCOMES: Branch targets are at the SAME ROW or ONE ROW DOWN from the decision
7. LABEL TEXT: Always a yes/no question ('Valid?', 'Cached?', 'Authenticated?')

BAD decision labels: 'Validation', 'Check', 'Process' (these are actions, not questions)
GOOD decision labels: '◇ Valid?', '◇ Hit?', '◇ Auth?', '◇ Pass?'

VISUAL CONVENTION:
  - Main flow continues STRAIGHT DOWN from decision
  - Branches go SIDEWAYS (left or right) to different columns
  - Never branch UP (violates top-to-bottom flow)
  - Each branch should be labeled with the condition (Yes/No, Pass/Fail, Hit/Miss)""",
        "tags": ["good-example", "decision-node", "diamond", "conventions"],
    },

    # --- Category: Color Conventions ---
    {
        "problem": "GOOD chart-design: Color coding conventions for architecture diagrams. User request: 'what colors should I use for different component types?'",
        "solution": """Color conventions for /create-architecture YAML:

STANDARD PALETTE (matches Excalidraw canvas dark theme):
  purple (#7c3aed) = UI/presentation layer, user-facing components
  blue (#4a9eff)   = data processing, search, retrieval, internal services
  green (#00ff88)  = deterministic/fast operations, success states, databases
  amber (#ffaa00)  = LLM/AI operations, decision points, pending states
  red (#ff4444)    = error handling, rejection, failure paths, security blocks
  dim (#64748b)    = archived, deprecated, background services

USAGE RULES:
  1. Decision nodes (◇) are ALWAYS amber
  2. Error/rejection branches are ALWAYS red
  3. Success/completion nodes are ALWAYS green
  4. UI entry/exit points are ALWAYS purple
  5. Use at most 4 colors in one diagram (too many = visual noise)
  6. Adjacent nodes should NOT share colors (creates visual flow)
  7. Color encodes TYPE, not importance — don't use red for 'important'

LATENCY-BASED COLORING (alternative for pipelines):
  green = <10ms (fast/deterministic)
  blue = 10-100ms (network/search)
  amber = 100ms-5s (LLM/external API)
  red = >5s (expensive/blocking)""",
        "tags": ["good-example", "color-conventions", "palette"],
    },

    # --- Category: Canvas-Aware Sizing Rules ---
    {
        "problem": "GOOD chart-design: Canvas-aware sizing formulas. User request: 'how to compute box sizes for any diagram?'",
        "solution": """Canvas-aware sizing formulas for /create-architecture:

CANVAS CONSTANTS:
  CANVAS_W = 1300  (usable width, full browser minus margins)
  CANVAS_H = 700   (usable height, minus toolbar + bottom bar)
  MARGIN = 40      (padding around grid)

GRID COMPUTATION:
  n_rows = max(row values) + 1
  n_cols = max(col values) + 1
  usable_w = CANVAS_W - 2 * MARGIN
  usable_h = CANVAS_H - 2 * MARGIN - title_h

CELL SIZE:
  row_h = usable_h / n_rows
  col_w = usable_w / n_cols  (if n_cols > 1, else usable_w)

BOX SIZE:
  box_w = min(col_w * 0.70, 350)  # 70% of cell, max 350px
  box_h = row_h * 0.55            # 55% of cell (room for arrows)
  # Single column: cap at 40% width to avoid wall-to-wall boxes
  if n_cols == 1: box_w = min(usable_w * 0.4, 350)

FONT SIZE:
  font_size = max(10, min(14, int(row_h * 0.15)))
  # 10px minimum (readable), 14px maximum (not oversized)

SUBTITLE DISPLAY:
  min_two_line_h = font_size * 1.2 * 2 + 12
  show_subtitle = box_h >= min_two_line_h

CENTERING:
  x_offset = MARGIN + (usable_w - n_cols * col_w) / 2
  y_offset = MARGIN + title_h

ARROW GAP:
  arrow_gap = max(4, int(row_h * 0.05))""",
        "tags": ["good-example", "sizing-rules", "canvas-aware", "formulas"],
    },

    # --- Category: Proper QuerySpec Pipeline (fixed) ---
    {
        "problem": "GOOD chart-design: QuerySpec intent pipeline with proper decision tree forking. User request: 'show the QuerySpec pipeline from omnibar to UI render'",
        "solution": """Layout: Main flow center (col 1), branches fork LEFT (happy shortcuts) and RIGHT (errors).
Canvas: 1300x700. 10 rows, 3 cols.
row_h = 70px. col_w = 433px. box_w = 270px. box_h = 38px. font_size = 10px.

YAML structure:
components:
  - {id: omnibar, label: "User → Omnibar", row: 0, col: 1, color: purple}
  - {id: self_correct, label: "Self-Correction", row: 1, col: 1, color: blue}
  - {id: recall, label: "Recall Grounding", row: 2, col: 1, color: blue}
  - {id: recall_hit, label: "→ Execute (cached)", row: 2, col: 0, color: green}
  - {id: entity, label: "Entity Pre-Scan", row: 3, col: 1, color: blue}
  - {id: fabricated, label: "NO_MATCH (fabricated)", row: 3, col: 2, color: red}
  - {id: ambiguity, label: "◇ Ambiguity Gate", row: 4, col: 1, color: amber}
  - {id: clarify, label: "CLARIFY", row: 4, col: 0, color: red}
  - {id: no_match, label: "NO_MATCH", row: 4, col: 2, color: red}
  - {id: t05, label: "T0.5 Classifier", row: 5, col: 1, color: green}
  - {id: t05_reject, label: "NO_MATCH (T0.5)", row: 5, col: 2, color: red}
  - {id: llm, label: "LLM Enrichment", row: 6, col: 1, color: amber}
  - {id: sft, label: "QuerySpec SFT", row: 7, col: 1, color: amber}
  - {id: execute, label: "/execute-queryspec", row: 8, col: 1, color: green}
  - {id: ui, label: "Binary Explorer UI", row: 9, col: 1, color: purple}
connections:
  # Main flow
  - {from: omnibar, to: self_correct}
  - {from: self_correct, to: recall}
  - {from: recall, to: entity}
  - {from: entity, to: ambiguity}
  - {from: ambiguity, to: t05}
  - {from: t05, to: llm}
  - {from: llm, to: sft}
  - {from: sft, to: execute}
  - {from: execute, to: ui}
  # Branches at each decision point
  - {from: recall, to: recall_hit}
  - {from: entity, to: fabricated}
  - {from: ambiguity, to: clarify}
  - {from: ambiguity, to: no_match}
  - {from: t05, to: t05_reject}
  # Early exit connects to execute
  - {from: recall_hit, to: execute}

KEY DIFFERENCE from bad version: Every branch forks at its decision point row.
CLARIFY/NO_MATCH are at the SAME ROW as the ambiguity gate, not floating below.
Error branches go RIGHT, shortcuts go LEFT. Main flow stays centered.""",
        "tags": ["good-example", "queryspec-pipeline", "decision-tree", "intent-pipeline"],
    },

    # --- Category: Connection Routing Rules ---
    {
        "problem": "GOOD chart-design: Connection routing rules for elbow arrows. User request: 'how should arrows be routed in architecture diagrams?'",
        "solution": """Connection routing rules for /create-architecture:

ELBOW ARROW PROPERTIES (Excalidraw):
  elbowed: true
  fixedSegments: []     # MUST be [] not None
  startIsSpecial: false
  endIsSpecial: false
  roundness: {type: 2}

ROUTING CONVENTIONS:
  1. VERTICAL (same column): Arrow goes straight down, no waypoints needed
  2. HORIZONTAL (same row): Arrow goes straight across
  3. DIAGONAL (different row AND column): Use L-shaped routing
     - Compute midpoint_y between source bottom and target top
     - Waypoints: [(src_x, mid_y), (dst_x, mid_y)]
     - Creates right-angle bend at midpoint

BINDING:
  startBinding: {elementId: src_rect_id, focus: 0, gap: 4, fixedPoint: null}
  endBinding: {elementId: dst_rect_id, focus: 0, gap: 4, fixedPoint: null}

ARROW DIRECTION RULES:
  - Main flow: always TOP→BOTTOM (never upward in main flow)
  - Branches: LEFT or RIGHT from decision nodes
  - Loop-backs: RIGHT side down, then LEFT side up (creates visible U-shape)
  - Cross-column: always route through empty space, never overlap boxes

ARROW COLORS:
  - Main flow: inherit from source node color
  - Error branches: red (#ff4444)
  - Loop-backs: amber (#ffaa00)
  - Optional/shortcut: dim (#64748b) with dashed stroke""",
        "tags": ["good-example", "arrow-routing", "elbow-arrows", "connections"],
    },

    # --- Small compact diagram ---
    {
        "problem": "GOOD chart-design: Minimal 2-node diagram. User request: 'show a simple input→output'",
        "solution": """Layout: 2 rows, 1 col. Maximally simple.
Canvas: 1300x700.
row_h = 350px. box_w = 350px. box_h = 192px. font_size = 14px.

YAML structure:
components:
  - {id: input, label: "Input", row: 0, col: 0, color: blue}
  - {id: output, label: "Output", row: 1, col: 0, color: green}
connections:
  - {from: input, to: output}

Why it works: Even trivial diagrams benefit from canvas-aware sizing.
2 nodes get LARGE boxes (192px tall!) and big font. Don't waste the space.
Center horizontally. The diagram fills the canvas comfortably.""",
        "tags": ["good-example", "minimal", "simple"],
    },
]

# ─────────────────────────────────────────────────────────────────
# BAD EXAMPLES
# ─────────────────────────────────────────────────────────────────

BAD = [
    {
        "problem": "BAD chart-design: Hardcoded pixel constants ignoring node count. ANTI-PATTERN.",
        "solution": """WHAT WENT WRONG:
row_h = 140  # fixed constant
spacing = 60  # fixed constant
10 nodes × (140 + 60) = 2000px tall → diagram scrolls off screen

FIX: Compute row_h from canvas height and node count:
row_h = CANVAS_H / n_rows  # adapts to content

RULE VIOLATED: Rule 1 — compute from canvas, not from constants.
5-node diagrams waste space. 12-node diagrams overflow.
The SAME hardcoded values can't work for both.""",
        "tags": ["bad-example", "hardcoded-spacing", "overflow"],
    },
    {
        "problem": "BAD chart-design: Orphaned branch nodes disconnected from decision point. ANTI-PATTERN.",
        "solution": """WHAT WENT WRONG:
Decision node at row 4, col 0.
CLARIFY branch at row 4, col 1 — but visually it floats far away.
NO_MATCH branch at row 4, col 2 — even further.
No visual connection to the decision that spawned them.

The branches look like independent components, not outcomes of a decision.
Reader can't tell which decision leads to which branch.

FIX: Branches must fork at the SAME ROW as the decision node.
Use columns to separate outcomes, not distance.
Draw direct arrows from decision → each branch.
Color-code branches (green=pass, red=fail) for instant comprehension.

RULE VIOLATED: Decision outcomes must be visually adjacent to their decision point.""",
        "tags": ["bad-example", "orphaned-branches", "disconnected"],
    },
    {
        "problem": "BAD chart-design: All nodes in single column with branches tacked on as distant satellites. ANTI-PATTERN.",
        "solution": """WHAT WENT WRONG:
Main flow: 10 nodes stacked in col 0, rows 0-9.
CLARIFY: col 1, row 4 — connected by a long diagonal arrow.
NO_MATCH: col 2, row 4 — connected by an even longer diagonal arrow.
Both branches are orphaned far to the right.

This is NOT a decision tree — it's a linear list with Post-it notes stuck on the side.
The viewer's eye follows the main column and never notices the branches.

FIX: Convert to proper decision tree layout:
- Main flow in CENTER column (col 1, not col 0)
- Branches fork LEFT and RIGHT at each decision point
- Branch outcomes at the SAME ROW as the decision node
- Multiple decision points create a 'railroad with sidings' pattern

RULE VIOLATED: Never put all logic in one column with branches as afterthoughts.""",
        "tags": ["bad-example", "single-column", "linear-with-branches"],
    },
    {
        "problem": "BAD chart-design: Box too wide for canvas, overflowing viewport. ANTI-PATTERN.",
        "solution": """WHAT WENT WRONG:
box_w = 420, col_w = 520
3 columns: 420 + 520 + 520 = 1460px → overflows 1300px canvas
User must scroll horizontally to see the full diagram.

FIX: Compute box_w from canvas and column count:
col_w = CANVAS_W / n_cols  # 1300/3 = 433px
box_w = col_w * 0.7        # 433*0.7 = 303px
Total: 3 × 433 = 1299px ← fits canvas

RULE VIOLATED: Rule 2 — box fills 70-80% of its grid cell.
Columns calculated without knowing how many columns exist.""",
        "tags": ["bad-example", "overflow", "too-wide"],
    },
    {
        "problem": "BAD chart-design: Giant gaps between rows, diagram looks like a todo list. ANTI-PATTERN.",
        "solution": """WHAT WENT WRONG:
row_h = 105, box_h = 50
Gap between boxes: 105 - 50 = 55px of dead space
More gap than content. Arrows have room but the diagram looks sparse.

5 nodes in 700px canvas should use row_h = 140px, box_h = 77px.
Not row_h = 105px with box_h = 50px.

FIX: box_h = row_h * 0.55 (55% of row height)
Gap = row_h * 0.45 — proportional, not fixed.

RULE VIOLATED: Rule 2 — box fills 70-80% of its grid cell width, 55% of height.
The visual weight should be in the BOXES, not the gaps.""",
        "tags": ["bad-example", "giant-gaps", "sparse"],
    },
    {
        "problem": "BAD chart-design: Font size not proportional to box, text overflows or is unreadable. ANTI-PATTERN.",
        "solution": """WHAT WENT WRONG:
box_h = 50, fontSize = 16
Two lines of text at 16px × 1.2 lineHeight = 38.4px → barely fits
Add padding (12px) → 50.4px > 50px → text clips or overflows.

Even worse: subtitle (tech + latency) tries to render below label.
Two lines at 16px in a 50px box = guaranteed overflow.

FIX: Font scales with box:
fontSize = max(10, min(14, int(box_h * 0.3)))
For box_h=50: fontSize = max(10, min(14, 15)) = 14px
For box_h=38: fontSize = max(10, min(14, 11)) = 11px

SUBTITLE RULE: Only show subtitle if box_h >= fontSize * 1.2 * 2 + 12

RULE VIOLATED: Rule 3 — font scales with box. Font chosen AFTER box size is known.""",
        "tags": ["bad-example", "text-overflow", "font-size"],
    },
    {
        "problem": "BAD chart-design: Spaghetti arrows crossing over nodes. ANTI-PATTERN.",
        "solution": """WHAT WENT WRONG:
Node A (row 0, col 0) connects to Node D (row 3, col 2).
Arrow drawn as straight diagonal — crosses over nodes B and C in between.
Multiple such cross-connections create an unreadable web.

FIX:
1. Use elbow (orthogonal) arrows, not diagonal
2. Route through empty grid cells only
3. For cross-column connections, use L-shaped routing with midpoint:
   - Go down to midpoint_y between source and target
   - Go across to target column at midpoint_y
   - Go down to target
4. If no empty cell exists, restructure the grid to create routing channels

RULE VIOLATED: Arrows should never cross over node boxes.
Use orthogonal routing with elbow arrows. Excalidraw: elbowed=true.""",
        "tags": ["bad-example", "spaghetti-arrows", "crossing"],
    },
    {
        "problem": "BAD chart-design: No decision diamond — using rectangles for decisions. ANTI-PATTERN.",
        "solution": """WHAT WENT WRONG:
'Validate' node is a rectangle (same as all other nodes).
It has two outgoing arrows but looks identical to processing nodes.
Reader can't distinguish 'do something' from 'decide something'.

FIX: Decision nodes use the ◇ prefix in their label:
  label: '◇ Valid?' not 'Validate'
  color: amber (always — decisions are uncertain/pending)

The ◇ prefix triggers the layout engine to:
  1. Render as diamond shape (or diamond-styled rectangle)
  2. Apply amber color
  3. Expect exactly 2+ outgoing connections (branches)
  4. Place branch outcomes at the same row, different columns

RULE VIOLATED: Decision points must be visually distinct from processing steps.
Use ◇ prefix, amber color, and question-form labels.""",
        "tags": ["bad-example", "no-diamond", "missing-decision-shape"],
    },
    {
        "problem": "BAD chart-design: Diagram not centered, crammed into left third of canvas. ANTI-PATTERN.",
        "solution": """WHAT WENT WRONG:
Single-column pipeline starts at x=40 (left margin).
box_w = 300px. Canvas is 1300px wide.
Right 960px of canvas is empty white space.
Diagram looks like it's hiding in the corner.

FIX: Center the grid in the canvas:
x_offset = MARGIN + (usable_w - n_cols * col_w) / 2
For single column: x_center = (1300 - 300) / 2 = 500px

Multi-column: center the entire grid, not individual columns.

RULE VIOLATED: Rule 4 — center the diagram in canvas.
The first column should not start at x=0 or x=MARGIN.""",
        "tags": ["bad-example", "not-centered", "left-aligned"],
    },
    {
        "problem": "BAD chart-design: Using random colors with no semantic meaning. ANTI-PATTERN.",
        "solution": """WHAT WENT WRONG:
Node 1: purple (it's a database)
Node 2: green (it's an API endpoint)
Node 3: red (it's a cache — not an error!)
Node 4: blue (it's the error handler — should be red!)
Colors assigned randomly based on visual preference, not meaning.

FIX: Colors encode component TYPE or LATENCY, never aesthetics:
  purple = UI/presentation
  blue = data processing/search
  green = fast/deterministic/success
  amber = LLM/AI/decision
  red = error/failure/blocking
  dim = archived/background

Apply consistently. A database is green (fast). An error handler is red.
A decision point is amber. UI is purple. Always.

RULE VIOLATED: Color encodes type, not importance or aesthetics.
Consistent color = instant comprehension. Random color = visual noise.""",
        "tags": ["bad-example", "random-colors", "no-semantics"],
    },
    {
        "problem": "BAD chart-design: Branches going UPWARD, violating top-to-bottom flow. ANTI-PATTERN.",
        "solution": """WHAT WENT WRONG:
Main flow goes top-to-bottom (rows 0→9).
Error branch at row 7 has an arrow going UP to row 2 (retry).
The upward arrow crosses 5 rows of nodes.

This creates confusion: is the flow going up or down?
The eye naturally follows top→bottom and gets confused by upward arrows.

FIX: Upward arrows should be RARE and visually distinct:
1. Route them along the RIGHT EDGE of the diagram (outside the main flow)
2. Use dashed or dim (#64748b) style to distinguish from main flow
3. Label them explicitly: 'retry', 'loop back'
4. Better yet: show the retry target at a LOWER row in a different column
   instead of creating an upward arrow

RULE VIOLATED: Main flow is ALWAYS top-to-bottom.
Loop-backs route around the outside, never through the center.""",
        "tags": ["bad-example", "upward-arrows", "flow-violation"],
    },
    {
        "problem": "BAD chart-design: Too many nodes for canvas, everything unreadable at 8px font. ANTI-PATTERN.",
        "solution": """WHAT WENT WRONG:
20 nodes in a single diagram. 15 rows.
row_h = 700/15 = 46px. box_h = 46*0.55 = 25px. font_size = max(10, 46*0.15) = 10px.
At 10px font in a 25px box, labels are truncated. Subtitles don't fit at all.
Everything is a smear of tiny colored rectangles.

FIX: Split into sub-diagrams:
- If n_rows > 12: consider splitting into 2 diagrams
- If box_h < 35px: definitely split
- Group related nodes into 'phases' and create one diagram per phase
- Link diagrams with labeled entry/exit points

Alternative: Use a 2-column layout instead of single column:
- Nodes A-J in col 0, nodes K-T in col 1
- Reduces rows from 20 to 10, doubling available height

RULE VIOLATED: Minimum readable box_h is ~35px at 10px font.
If computed box_h drops below this, the diagram needs restructuring.""",
        "tags": ["bad-example", "too-many-nodes", "unreadable"],
    },
]


def main():
    print(f"Learning {len(GOOD)} good examples + {len(BAD)} bad examples...")
    print()

    print("=== GOOD EXAMPLES ===")
    for i, ex in enumerate(GOOD, 1):
        print(f"[{i}/{len(GOOD)}]", end=" ")
        learn(ex["problem"], ex["solution"], ex["tags"])

    print()
    print("=== BAD EXAMPLES ===")
    for i, ex in enumerate(BAD, 1):
        print(f"[{i}/{len(BAD)}]", end=" ")
        learn(ex["problem"], ex["solution"], ex["tags"])

    print()
    print(f"Done. {len(GOOD)} good + {len(BAD)} bad = {len(GOOD) + len(BAD)} total examples learned.")


if __name__ == "__main__":
    main()

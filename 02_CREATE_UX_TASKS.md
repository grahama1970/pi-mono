# Task List: create-ux — Multi-Agent Collaborative UX Design Canvas

**Created**: 2026-03-10
**Goal**: Evolve paper-clone into `/create-ux` — a multi-agent collaborative design canvas where subagents visually build UX in real-time, with human course correction via `/agent-inbox`, NVIS/Embry-OS theming, and composition with `/test-interactions`, `/review-design`, and `/create-design-board`.

## Context

Current `paper-clone` is a working Fabric.js v7 canvas app (117 tests, 33 files, ~4,700 lines) with Zustand store, Express REST API, 5 custom component types, and React/Tailwind export. It works but is single-user and has no agent collaboration. The evolution adds multi-agent visual progress tracking (subagents write structured JSON ops to a shared canvas state, browser renders in real-time), course correction via `/agent-inbox` polling between tasks, NVIS Embry-OS dark theme, and skill composition hooks for `/test-interactions` and `/review-design`.

**Key architectural insight from research (Pencil, OpenPencil, dogpile)**: Agents don't generate pixels — they generate structured operations that mutate a shared JSON document. The canvas is a renderer. The JSON is the source of truth. Multiple agents can write to non-overlapping spatial zones simultaneously. Course corrections arrive via `/agent-inbox`, checked at task boundaries.

**Borrowed from OpenPencil**: Layered design prompting (skeleton→content→refine), spatial task decomposition for parallel agents, `.op`-style JSON design documents, streaming animation of operations.

## Capability Overlap

### /memory recall
Prior dogpile research (2026-03-10) on collaborative AI design tools, Pencil, OpenPencil, and multi-agent canvas patterns stored to memory. No prior `/create-ux` skill exists.

### skills-manifest.json scan
| Existing Skill | Overlap | Decision |
|---------------|---------|----------|
| `/create-react-designs` | React/Tailwind code from prompts | **COMPOSE** — use for Tier 2 LLM-enhanced export |
| `/review-design` | AI design review of screenshots | **COMPOSE** — screenshot canvas → send for review |
| `/test-interactions` | Visual regression testing | **COMPOSE** — screenshot canvas → test assertions |
| `/create-design-board` | Design boards from images | **COMPOSE** — load DESIGN_BOARD.md as brief |
| `/create-styleguide` | NVIS/Embry-OS style tokens | **CONSULT** — extract NVIS palette |
| `/agent-inbox` | Inter-agent messaging | **COMPOSE** — agents check inbox between tasks |
| `/create-image` | AI image generation | **COMPOSE** — generate placeholder images |
| `/pdf-screenshot` | Screenshot rendering | Not needed (canvas has own screenshot) |

### Anti-silo justification
- **CREATE: WebSocket streaming** — No existing skill provides real-time canvas operation streaming
- **CREATE: Agent registry + cursors** — No existing skill tracks multiple agent work zones on a visual canvas
- **CREATE: Operation log UI** — No existing skill shows agent reasoning alongside visual progress
- **RENAME: paper-clone → create-ux** — Rename only, no new code for existing functionality
- **EXTEND: Express API** — Add WS endpoints to existing API server
- **GLUE: /agent-inbox integration** — ~30 lines wiring existing inbox checking into agent task loop

## Research Summary

| Source | Finding |
|--------|---------|
| Dogpile #1 | CRDT/OT patterns; agents generate structured ops, not pixels; streaming ops create real-time animation |
| Dogpile #2 | Y.js preferred for CRDTs; server is dumb message relayer; spatial decomposition for parallel agents |
| OpenPencil (GitHub) | Same stack (Fabric.js v7, Zustand v5, React 19); layered prompting (skeleton→content→refine); `.op` JSON format |
| YouTube (DSow83bnO4g) | Pencil has Figma-like editing, real-time agent canvas updates, component libraries, CSS variables |
| YouTube (DFcvz2kcR74) | Pencil MCP canvas, UI kits, real-time design-to-code, Claude Code integration |
| Brave/Web | OpenPencil = open-source Pencil alternative with multi-agent orchestration and Design-as-Code |

## Technology Decisions

| Choice | Alternative | Reason |
|--------|-------------|--------|
| WebSocket (ws) | SSE, polling | Bidirectional — agents send ops AND receive course corrections |
| JSON operation log | CRDT (Y.js) | Simpler for MVP; CRDT is overkill for sequential agent writes with non-overlapping zones |
| `/agent-inbox` for corrections | Direct WebSocket messages | Reuse existing infrastructure; agents already know how to check inbox |
| NVIS palette inline | Tailwind theme | Canvas app uses inline styles; no Tailwind in canvas itself |
| File-based `.ux.json` | Database | Git-friendly, skill-compatible, human-readable |

## Questions/Blockers

None — all requirements clear from user spec, research, and existing codebase.

## Tasks

### P0: Rename & Foundation (Sequential)

- [ ] **Task 1**: Rename paper-clone → create-ux across the entire project
  - Agent: general-purpose
  - Parallel: 0
  - Dependencies: none
  - **Details**:
    - Rename `packages/paper-clone/` → `packages/create-ux/`
    - Rename `.pi/skills/paper-clone/` → `.pi/skills/create-ux/`
    - Update `package.json` name field to `create-ux`
    - Update all internal references (PID file path, log paths, API_BASE comments)
    - Update `run.sh` references, `sanity.sh`, `SKILL.md` (name, triggers, provides)
    - Update `01_PAPER_CLONE_TASKS.md` header to reference new name
    - Update `vite.config.ts` if any path references
    - Run full test suite to verify no breakage
  - **Definition of Done**:
    - Test: `cd packages/create-ux && npx vitest run`
    - Assertion: All 117 tests pass, `bash .pi/skills/create-ux/sanity.sh` passes, no references to "paper-clone" remain in the package

- [ ] **Task 2**: Add `ws` WebSocket dependency and create shared types for agent operations
  - Agent: general-purpose
  - Parallel: 0
  - Dependencies: Task 1
  - **Details**:
    - `npm install ws` + `npm install -D @types/ws`
    - Create `src/types.ts` additions (or `src/agent-types.ts`):
      ```typescript
      interface AgentRegistration {
        id: string
        name: string        // e.g. "navbar-agent"
        color: string       // hex color for cursor/zone
        zone?: { x: number, y: number, width: number, height: number }
        status: 'idle' | 'working' | 'done' | 'error'
      }
      interface CanvasOperation {
        agent: string       // agent id
        op: 'create' | 'update' | 'delete' | 'select'
        timestamp: number
        element?: Partial<CanvasElement> & { type: string }
        id?: string         // for update/delete
        props?: Record<string, unknown>
        reason?: string     // why this op (for operation log)
      }
      interface OperationLog {
        ops: CanvasOperation[]
        agents: AgentRegistration[]
      }
      ```
    - Create `src/store/agentStore.ts` — Zustand store for agent registry and operation log
    - Write tests for agent store (register, update status, log operations)
  - **Definition of Done**:
    - Test: `cd packages/create-ux && npx vitest run --filter agent`
    - Blind: `test-lab/run.sh verify-task 2 packages/create-ux/ --domain agent-types`
    - Assertion: Agent store registers agents, logs operations, tracks agent status. All existing 117 tests still pass.

### P1: Multi-Agent Infrastructure (Parallel)

- [ ] **Task 3**: Implement WebSocket server for streaming agent operations
  - Agent: general-purpose
  - Parallel: 1
  - Dependencies: Task 2
  - **Details**:
    - Add WebSocket upgrade to existing Express server (`server/index.ts`)
    - `server/ws-handler.ts` — WebSocket message handler:
      - `agent:register` → register agent with name, color, zone
      - `agent:op` → apply canvas operation (create/update/delete element)
      - `agent:status` → update agent status (idle/working/done/error)
      - `agent:prompt` → human sends course correction (broadcast to all agents)
      - Broadcast all operations to all connected clients (for live rendering)
    - Each incoming `agent:op` message:
      1. Validates against zod schema
      2. Applies to server-side canvas state
      3. Broadcasts to all connected WS clients
      4. Appends to operation log
    - REST fallback: `POST /api/v1/agents/register`, `POST /api/v1/agents/:id/ops` (for agents that prefer HTTP)
    - `GET /api/v1/agents` — list registered agents with status
    - `GET /api/v1/ops/log` — get operation log (last N ops)
  - **Definition of Done**:
    - Test: `cd packages/create-ux && npx vitest run --filter ws`
    - Blind: `test-lab/run.sh verify-task 3 packages/create-ux/ --domain websocket`
    - Assertion: WebSocket connects, agent registers, operations broadcast to all clients, REST fallback works, operation log records all ops

- [ ] **Task 4**: Implement agent cursor and zone visualization on canvas
  - Agent: general-purpose
  - Parallel: 1
  - Dependencies: Task 2
  - **Details**:
    - `src/canvas/AgentOverlay.tsx` — React component that renders:
      - Colored border around each agent's zone (dashed rectangle with agent color)
      - Agent name label at top of zone (pill badge with agent color)
      - Status indicator (pulsing dot: green=working, gray=idle, red=error, checkmark=done)
      - Semi-transparent zone highlight while agent is actively working
    - `src/components/AgentPanel.tsx` — sidebar panel showing:
      - List of registered agents with name, color, status
      - Real-time operation count per agent
      - Last operation description (from `reason` field)
    - Subscribe to `agentStore` for live updates
    - Overlay renders on top of Fabric canvas using absolute-positioned divs (not Fabric objects — avoids interfering with agent operations)
  - **Definition of Done**:
    - Test: `cd packages/create-ux && npx vitest run --filter agent`
    - Assertion: AgentPanel renders agent list from store, status updates reflect in UI, zone visualization positions correctly based on agent zone coordinates

- [ ] **Task 5**: Implement operation log panel with streaming display
  - Agent: general-purpose
  - Parallel: 1
  - Dependencies: Task 2
  - **Details**:
    - `src/components/OperationLog.tsx` — scrollable panel showing:
      - Each operation as a row: `[agent-color-dot] [agent-name] [op-type] [element-type] [reason]`
      - Timestamp (relative: "2s ago", "15s ago")
      - Auto-scrolls to bottom as new ops arrive
      - Click on op highlights the affected element on canvas
      - Filter by agent name
    - Max 200 ops in memory (circular buffer)
    - Uses agentStore subscription for real-time updates
  - **Definition of Done**:
    - Test: `cd packages/create-ux && npx vitest run --filter operation`
    - Assertion: Operation log displays ops with agent attribution, auto-scrolls, circular buffer caps at 200

### P2: NVIS Theme & Skill Composition (Parallel)

- [ ] **Task 6**: Apply NVIS/Embry-OS dark theme to all UI components
  - Agent: general-purpose
  - Parallel: 2
  - Dependencies: Task 4, Task 5
  - **Details**:
    - NVIS MIL-STD-3009 palette:
      ```
      BG_PRIMARY:   #0a0a1a    (deep dark)
      BG_SECONDARY: #111128    (panels)
      BG_TERTIARY:  #1a1a3e    (hover/active)
      GREEN:        #00ff88    (healthy, success, active agent)
      RED:          #ff4444    (error, failed)
      AMBER:        #ffaa00    (warning, working)
      BLUE:         #44aaff    (info, selected)
      WHITE:        #c8c8c8    (primary text)
      DIM:          #505050    (muted text, borders)
      YELLOW:       #ffe600    (unknown status)
      ACCENT:       #7c3aed    (Embry purple, primary actions)
      ```
    - Update ALL components: App.tsx, Toolbar, Sidebar, PropertiesPanel, ExportPanel, StatusBar, AgentPanel, OperationLog
    - Create `src/theme.ts` with palette constants (single source of truth)
    - Canvas background: #0a0a1a with grid lines in #1a1a3e
    - Agent zone borders use the agent's registered color
    - Toolbar icons/buttons use DIM for inactive, WHITE for active, GREEN for selected tool
    - Status indicators follow NVIS convention (GREEN=nominal, AMBER=degraded, RED=critical)
  - **Definition of Done**:
    - Test: `cd packages/create-ux && npx vitest run`
    - Assertion: All tests pass, theme.ts exports all NVIS colors, no hardcoded color values remain in component files (src/components/*.tsx, src/canvas/*.tsx)

- [ ] **Task 7**: Add `/agent-inbox` integration and course correction chat well (CRITICAL UX)
  - Agent: general-purpose
  - Parallel: 2
  - Dependencies: Task 3
  - **Details**:
    - `src/components/CourseCorrection.tsx` — **CRITICAL: This is the primary human-agent interaction surface.** A persistent chat well (always visible, bottom of canvas or pinned panel) for real-time course correction:
      - Text input with NVIS styling: dark bg (#111128), green (#00ff88) send button, white text
      - Dropdown to target: "All agents" or specific agent by name
      - Message history showing sent corrections + agent acknowledgments (scrollable, max 50 messages)
      - Visual feedback: flash agent zone border when correction is received
      - Keyboard: Enter to send, Shift+Enter for multiline
      - Sends via WS `agent:prompt` message AND writes to `/agent-inbox`
    - Update `run.sh` with new subcommands:
      ```
      agent-join <name> <color> [zone]   → POST /api/v1/agents/register
      agent-ops <id> <json-ops>          → POST /api/v1/agents/:id/ops
      prompt <message> [--agent <name>]  → POST /api/v1/prompt + agent-inbox send
      watch                              → WS subscribe, stream ops to stdout as JSONL
      agents                             → GET /api/v1/agents
      ops-log [--last N]                 → GET /api/v1/ops/log
      ```
    - Server-side `POST /api/v1/prompt` endpoint:
      1. Broadcasts prompt to all connected WS clients
      2. Writes to agent-inbox for agents not connected via WS
      3. Returns { delivered_ws: N, delivered_inbox: M }
    - Subagent contract: after each task in their task list, call `run.sh inbox-check` (alias for `/agent-inbox check`)
  - **Definition of Done**:
    - Test: `cd packages/create-ux && npx vitest run --filter prompt`
    - Blind: `test-lab/run.sh verify-task 7 packages/create-ux/ --domain course-correction`
    - Assertion: Course correction chat well renders with message history, prompt endpoint broadcasts to WS clients, new run.sh subcommands work (agent-join, prompt, watch, agents), inbox integration sends messages

- [ ] **Task 8**: Add screenshot endpoint and composition hooks for `/test-interactions` and `/review-design`
  - Agent: general-purpose
  - Parallel: 2
  - Dependencies: Task 3
  - **Details**:
    - `POST /api/v1/screenshot` endpoint:
      - Client-side approach (no native canvas dependency): browser calls `canvas.toDataURL()`, sends base64 via POST
      - Server stores latest screenshot in memory for skill composition endpoints
      - Option: `?agents=true` — client overlays agent zone divs before capture
      - Option: `?zone=x,y,w,h` — client crops to specific region before sending
    - `POST /api/v1/review` endpoint — composition hook:
      1. Takes screenshot
      2. Writes to temp file
      3. Calls `/review-design` skill: `bash .pi/skills/review-design/run.sh --image /tmp/canvas.png`
      4. Returns review results
    - `POST /api/v1/test` endpoint — composition hook:
      1. Takes screenshot
      2. Calls `/test-interactions` skill for visual regression
      3. Returns test results
    - `POST /api/v1/load-brief` endpoint:
      1. Accepts DESIGN_BOARD.md path or content
      2. Parses design board for requirements, images, decisions
      3. Returns structured brief that agents can consume
    - Update `run.sh`:
      ```
      screenshot [--agents] [--zone x,y,w,h] [--output path]
      review                → POST /api/v1/review
      test                  → POST /api/v1/test
      load-brief <path>     → POST /api/v1/load-brief
      ```
  - **Definition of Done**:
    - Test: `cd packages/create-ux && npx vitest run --filter screenshot`
    - Assertion: Screenshot endpoint returns base64 PNG, review endpoint calls review-design skill, load-brief parses DESIGN_BOARD.md structure

### P3: Design Document & Agent Orchestration (Sequential)

- [ ] **Task 9**: Implement `.ux.json` design document format and save/load
  - Agent: general-purpose
  - Parallel: 3
  - Dependencies: Task 3, Task 6
  - **Details**:
    - `.ux.json` format (inspired by OpenPencil `.op`):
      ```json
      {
        "version": 1,
        "name": "Dashboard Design",
        "created": "2026-03-10T...",
        "modified": "2026-03-10T...",
        "theme": "nvis-dark",
        "pages": [
          {
            "id": "page1",
            "name": "Main Dashboard",
            "elements": { /* Record<string, CanvasElement> */ },
            "agents": [ /* AgentRegistration[] */ ],
            "ops_log": [ /* last 50 CanvasOperation[] */ ]
          }
        ],
        "variables": {
          "colors": { "primary": "#00ff88", "danger": "#ff4444" },
          "spacing": { "sm": 8, "md": 16, "lg": 24 }
        },
        "brief": { /* parsed DESIGN_BOARD.md content */ }
      }
      ```
    - Update save/load endpoints to use `.ux.json` format
    - Multi-page support: `POST /api/v1/pages`, `GET /api/v1/pages`, `DELETE /api/v1/pages/:id`
    - `run.sh save` outputs `.ux.json`, `run.sh load` reads it
    - Design variables resolve in export (React generator maps to CSS custom properties)
  - **Definition of Done**:
    - Test: `cd packages/create-ux && npx vitest run --filter document`
    - Blind: `test-lab/run.sh verify-task 9 packages/create-ux/ --domain document-format`
    - Assertion: Save produces valid `.ux.json`, load restores all elements + agents + variables, multi-page CRUD works, round-trip preserves all data

- [ ] **Task 10**: Implement layered design prompting (skeleton→content→refine)
  - Agent: general-purpose
  - Parallel: 4
  - Dependencies: Task 7, Task 9
  - **Details**:
    - `src/orchestration/design-layers.ts` — orchestration engine:
      - **Phase 1: Skeleton** — Layout structure (frames, containers, grids)
      - **Phase 2: Content** — Populate with components (buttons, cards, text, navbar)
      - **Phase 3: Refine** — Style polish (colors, spacing, typography, alignment)
    - Each phase assigns to a different agent (or the same agent sequentially)
    - `POST /api/v1/design` endpoint:
      ```json
      {
        "prompt": "Create a fintech dashboard with sidebar nav, KPI cards, and transaction table",
        "phases": ["skeleton", "content", "refine"],
        "agents": 3,
        "brief": "path/to/DESIGN_BOARD.md"
      }
      ```
    - Orchestrator:
      1. Decomposes prompt into spatial zones (top=navbar, left=sidebar, center=content)
      2. Spawns subagent tasks (via run.sh agent-join + agent-ops)
      3. Each subagent works through its zone's phases
      4. Between phases, agents check `/agent-inbox` for corrections
    - `run.sh design <prompt> [--agents N] [--brief path]` — main entry point
  - **Definition of Done**:
    - Test: `cd packages/create-ux && npx vitest run --filter design`
    - Blind: `test-lab/run.sh verify-task 10 packages/create-ux/ --domain design-orchestration`
    - Assertion: Design endpoint accepts prompt, decomposes into zones, returns structured task plan with agent assignments. Phase progression (skeleton→content→refine) produces valid canvas state.

### P4: Integration & Compliance (Sequential)

- [ ] **Task 11**: Update SKILL.md, sanity.sh, and wire all new run.sh subcommands
  - Agent: general-purpose
  - Parallel: 5
  - Dependencies: Task 7, Task 8, Task 10
  - **Details**:
    - Update `.pi/skills/create-ux/SKILL.md`:
      - name: create-ux
      - triggers: ["create ux", "design ux", "design interface", "collaborative design", "multi-agent design", "visual design canvas", "design canvas"]
      - provides: [create-ux]
      - composes: [create-react-designs, review-design, test-interactions, create-design-board, agent-inbox, create-styleguide, task-monitor]
    - Update `sanity.sh` to check: node>=18, npm, package.json, ws installed, SKILL.md, run.sh executable
    - Verify ALL run.sh subcommands work:
      ```
      start, stop, status, create, select, update, delete, list,
      export, undo, redo, screenshot, save, load,
      agent-join, agent-ops, prompt, watch, agents, ops-log,
      review, test, load-brief, design, help
      ```
    - Full integration test: start → agent-join → agent-ops → screenshot → review → stop
  - **Definition of Done**:
    - Test: `bash .pi/skills/create-ux/sanity.sh && cd packages/create-ux && npx vitest run`
    - Assertion: Sanity passes, all tests pass, `run.sh help` shows all subcommands, SKILL.md has correct triggers/composes

- [ ] **Task 12**: End-to-end test, skills-ci scan, and skills-broadcast
  - Agent: general-purpose
  - Parallel: 5
  - Dependencies: Task 11
  - **Details**:
    - E2E test scenario:
      1. `run.sh start`
      2. `run.sh agent-join "navbar-agent" "#00ff88" "0,0,1024,64"`
      3. `run.sh agent-ops navbar-agent '[{"op":"create","element":{"type":"paper:navbar","x":0,"y":0,"width":1024,"logoText":"Acme"}}]'`
      4. `run.sh agent-join "card-agent" "#44aaff" "0,80,1024,400"`
      5. `run.sh agent-ops card-agent '[{"op":"create","element":{"type":"paper:card","x":20,"y":100,"cardTitle":"Revenue"}}]'`
      6. `run.sh agents` — verify 2 agents listed
      7. `run.sh ops-log --last 2` — verify 2 ops logged
      8. `run.sh screenshot --agents` — verify PNG output
      9. `run.sh export --format react` — verify React code includes navbar and card
      10. `run.sh save > design.ux.json` — verify valid JSON
      11. `run.sh stop`
    - Run `/skills-ci scan` — verify 0 new errors
    - Run `/skills-broadcast link` — verify all targets updated
    - Verify old `paper-clone` references are gone from skills-manifest
  - **Definition of Done**:
    - Test: `cd .pi/skills/skills-ci && uv run python skills_ci.py --mode scan 2>&1 | grep create-ux`
    - Assertion: create-ux passes skills-ci with 0 errors, broadcast confirms all targets, E2E scenario completes without errors

## Completion Criteria

- [ ] All sanity scripts pass
- [ ] All tasks marked [x]
- [ ] All Definition of Done tests pass
- [ ] No regressions in existing tests (117 baseline + new tests)
- [ ] `/skills-ci scan` shows 0 new errors
- [ ] `/skills-broadcast link` confirms all targets
- [ ] No references to "paper-clone" remain in the project

## Notes

- **No MCP**: All agent interaction via `run.sh` subcommands → HTTP/WS to localhost:3001
- **No CRDT for MVP**: Simple JSON state with non-overlapping agent zones. CRDTs (Y.js) can be added later if concurrent overlapping edits become needed.
- **Agent authentication**: None for MVP (localhost only). Future: token-based for remote agents.
- **LLM calls**: Use existing `/scillm` and Claude Code OAuth — no new auth needed. The design endpoint's prompt decomposition can use `/scillm` for spatial analysis.
- **NVIS compliance**: All colors from MIL-STD-3009 palette. GREEN=nominal, AMBER=degraded, RED=critical. Consistent with `/dashboard` and `/embry-dashboard`.
- **OpenPencil patterns adopted**: Layered prompting (skeleton→content→refine), spatial decomposition, streaming operations, `.ux.json` design documents. NOT adopted: MCP server, Electron packaging, Figma import (deferred).
- **Course correction flow**: Human watches canvas → sees issue → types correction in CourseCorrection input → message goes to `/agent-inbox` → agent picks up at next task boundary → adjusts approach. No real-time interrupt needed.

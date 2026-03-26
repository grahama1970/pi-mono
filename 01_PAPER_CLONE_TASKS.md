# Task List: Paper Clone — Linux Design Canvas with Skill API

**Created**: 2026-03-10
**Goal**: Build a Paper.design-style infinite canvas app for Linux with a skill CLI wrapper for agent-driven design manipulation and React/Tailwind code export.

## Context

No Linux-native design tool exposes a CLI/REST interface for AI agents. Figma is web-only, Penpot requires a server stack, tldraw/Excalidraw are embeddable but not agent-controllable. We build a Fabric.js v7 canvas app (`packages/paper-clone/`) with a thin Embry OS skill wrapper (`.pi/skills/paper-clone/`) that lets agents create, manipulate, and export designs via `run.sh` commands.

## Research Summary (Dogpile 2026-03-10)

| Finding | Detail |
|---------|--------|
| Fabric.js | v7.2.0, fully TypeScript, `npm i fabric` |
| Infinite canvas | Manual via `canvas.viewportTransform` matrix manipulation |
| Serialization | `canvas.toJSON()` / `canvas.loadFromJSON()` with custom `toObject`/`fromObject` |
| Custom objects | Extend `fabric.Group` with semantic properties + serialization namespace |
| State management | Zustand store as source of truth, Fabric as "dumb renderer" |
| Canvas→React | LLM-as-compiler: serialize canvas JSON → structured prompt → React/Tailwind output |
| Backend | Fastify preferred (45K RPS) but Express simpler; REST endpoints for canvas CRUD |
| Existing OSS | tldraw, Excalidraw, Penpot, Grida — none have CLI/skill interfaces |

## Capability Overlap

### /memory recall
No prior solutions for canvas design tools in memory.

### skills-manifest.json scan
| Existing Skill | Overlap | Decision |
|---------------|---------|----------|
| `/create-react-designs` | Generates React/Tailwind from prompts | **COMPOSE** — use for React export prompt engineering |
| `/prototype-react-iterate` | Iterates on React prototypes | **COMPOSE** — use for preview/iteration |
| `/create-image` | AI image generation | No overlap (vector canvas, not raster) |
| `/create-design-board` | Design board markdown | No overlap (different purpose) |
| `/review-design` | AI design review | **COMPOSE** — review exported designs |
| `/best-practices-react` | React conventions | **CONSULT** during React export |

### Anti-silo justification
- **CREATE: Canvas app** — No existing skill provides an interactive visual canvas
- **CREATE: Fabric.js custom objects** — Component library is canvas-specific
- **CREATE: REST API** — Canvas manipulation API is novel
- **COMPOSE: React export** — Leverages `/create-react-designs` patterns for code generation
- **GLUE: Skill wrapper** — Thin `run.sh` shell over local HTTP API

## Questions/Blockers

None — all requirements clear from user spec and research.

## Technology Decisions

| Choice | Alternative | Reason |
|--------|-------------|--------|
| Fabric.js v7 | tldraw SDK, Konva | Native TS, mature serialization, custom object system |
| Vite + React | Next.js | No SSR needed, faster dev, simpler deploy |
| Zustand | Redux, Jotai | Minimal boilerplate, works well with external canvas state |
| Express | Fastify | Simpler for MVP, lower learning curve, sufficient perf |
| Vitest | Jest | Vite-native, faster, ESM-first |

## Tasks

### P0: Scaffolding (Sequential)

- [ ] **Task 1**: Scaffold `packages/paper-clone/` with Vite React TypeScript template
  - Agent: general-purpose
  - Parallel: 0
  - Dependencies: none
  - **Details**:
    - `npm create vite@latest packages/paper-clone -- --template react-ts`
    - Install deps: `fabric`, `zustand`, `express`, `cors`, `uuid`
    - Dev deps: `vitest`, `@types/express`, `@types/cors`, `concurrently`
    - Create directory structure:
      ```
      packages/paper-clone/
        ├── src/
        │   ├── canvas/          # Fabric.js canvas core
        │   ├── components/      # React UI (toolbar, sidebar, panels)
        │   ├── store/           # Zustand stores
        │   ├── objects/         # Custom Fabric.js objects (Button, Card, etc.)
        │   ├── export/          # Canvas→React code generation
        │   └── App.tsx
        ├── server/
        │   ├── index.ts         # Express API server
        │   ├── routes/          # API route handlers
        │   └── canvas-state.ts  # Server-side canvas state manager
        ├── test/
        ├── vite.config.ts
        ├── tsconfig.json
        └── package.json
      ```
    - Add `concurrently` scripts: `dev` runs both Vite (3000) and Express (3001)
  - **Definition of Done**:
    - Test: `cd packages/paper-clone && npm run build && npm run test`
    - Assertion: Vite builds without errors, test runner initializes

- [ ] **Task 2**: Create `.pi/skills/paper-clone/` skill wrapper
  - Agent: general-purpose
  - Parallel: 0
  - Dependencies: Task 1
  - **Details**:
    - `SKILL.md` with frontmatter: name, triggers, provides, composes
    - `run.sh` routing subcommands to either: local npm scripts or HTTP calls to `:3001`
    - `sanity.sh` checking node/npm version, canvas app buildability
    - `pyproject.toml` with `httpx` for API calls (Python helper for complex operations)
    - Commands:
      ```
      start       → npm run dev (background, PID file)
      stop        → kill from PID file
      status      → health check GET /api/health
      create      → POST /api/v1/elements
      select      → GET /api/v1/selection
      update      → PATCH /api/v1/elements/:id
      delete      → DELETE /api/v1/elements/:id
      export      → POST /api/v1/export {format: "react"|"svg"|"png"|"json"}
      list        → GET /api/v1/elements
      undo        → POST /api/v1/undo
      redo        → POST /api/v1/redo
      screenshot  → POST /api/v1/screenshot
      load        → POST /api/v1/load {json}
      save        → GET /api/v1/save
      ```
  - **Definition of Done**:
    - Test: `bash .pi/skills/paper-clone/sanity.sh`
    - Assertion: Sanity passes, `run.sh --help` shows all subcommands

### P1: Canvas Core (Parallel)

- [ ] **Task 3**: Implement Fabric.js infinite canvas with pan/zoom
  - Agent: general-purpose
  - Parallel: 1
  - Dependencies: Task 1
  - **Details**:
    - `src/canvas/InfiniteCanvas.tsx` — React component wrapping Fabric.js
    - Infinite pan: Alt+drag modifies `viewportTransform[4]` and `[5]`
    - Zoom: Ctrl+scroll modifies `viewportTransform[0]` and `[3]`, zoom toward cursor
    - Zoom limits: 10% to 2000%
    - Grid background that scales with zoom
    - Minimap showing viewport position (optional, can be deferred)
    - `src/canvas/useCanvas.ts` — React hook for canvas lifecycle
    - Performance: `skipOffscreen: true`, object caching enabled
  - **Definition of Done**:
    - Test: `npm run test -- --filter canvas`
    - Assertion: Canvas renders, pan/zoom transforms viewport correctly, zoom limits enforced

- [ ] **Task 4**: Implement Zustand state store with undo/redo
  - Agent: general-purpose
  - Parallel: 1
  - Dependencies: Task 1
  - **Details**:
    - `src/store/canvasStore.ts` — Zustand store as single source of truth
    - State shape:
      ```typescript
      interface CanvasState {
        elements: Record<string, CanvasElement>
        selectedIds: string[]
        viewport: { x: number, y: number, zoom: number }
        history: { past: CanvasSnapshot[], future: CanvasSnapshot[] }
      }
      ```
    - Actions: `addElement`, `updateElement`, `removeElement`, `setSelection`, `undo`, `redo`
    - History: snapshot-based (JSON clone of elements), max 50 entries
    - Sync pattern: Zustand state change → serialize → update Fabric canvas (one-way flow)
    - Subscribe pattern: Fabric events → update Zustand (for user interactions)
  - **Definition of Done**:
    - Test: `npm run test -- --filter store`
    - Assertion: Add/remove/update elements, undo restores previous state, redo re-applies

- [ ] **Task 5**: Build custom Fabric.js component objects
  - Agent: general-purpose
  - Parallel: 1
  - Dependencies: Task 1
  - **Details**:
    - `src/objects/PaperButton.ts` — extends `fabric.Group` with `buttonText`, `variant`, `size`
    - `src/objects/PaperCard.ts` — extends `fabric.Group` with `title`, `body`, `image`
    - `src/objects/PaperText.ts` — extends `fabric.Textbox` with `textStyle` (h1/h2/body/caption)
    - `src/objects/PaperContainer.ts` — extends `fabric.Group` with `layout` (flex/grid), `gap`, `padding`
    - `src/objects/PaperImage.ts` — extends `fabric.Image` with `alt`, `objectFit`
    - `src/objects/PaperNavbar.ts` — extends `fabric.Group` with `links`, `logo`
    - All objects implement:
      - `toObject()` with custom properties for serialization
      - Static `fromObject()` for deserialization
      - Custom controls (resize handles, style toggles)
      - Namespace prefix: `type: 'paper:button'`, `paper:card'`, etc.
    - `src/objects/registry.ts` — registers all custom types with Fabric's class registry
  - **Definition of Done**:
    - Test: `npm run test -- --filter objects`
    - Assertion: Each object serializes to JSON and deserializes back with all custom properties preserved

### P2: UI & API (Parallel, depends on P1)

- [ ] **Task 6**: Build React UI — toolbar, sidebar, properties panel
  - Agent: general-purpose
  - Parallel: 2
  - Dependencies: Task 3, Task 4, Task 5
  - **Details**:
    - `src/components/Toolbar.tsx` — shape tools (rect, circle, text, line), component tools (button, card, navbar, container), select/pan mode toggle
    - `src/components/Sidebar.tsx` — component library browser, layers panel (z-order), page list
    - `src/components/PropertiesPanel.tsx` — selected object properties: position, size, fill, stroke, text, component-specific props
    - `src/components/ExportPanel.tsx` — export format selector, preview pane, copy-to-clipboard
    - `src/components/StatusBar.tsx` — zoom level, cursor position, selection count
    - Keyboard shortcuts: Ctrl+Z undo, Ctrl+Y redo, Delete remove, Ctrl+C/V copy/paste, Ctrl+A select all
    - Dark theme (NVIS palette optional — can match Embry OS later)
  - **Definition of Done**:
    - Test: `npm run test -- --filter components`
    - Assertion: Toolbar creates elements on canvas, properties panel updates selected element, Ctrl+Z triggers undo, Delete removes selected element, Ctrl+A selects all

- [ ] **Task 7**: Implement Express REST API
  - Agent: general-purpose
  - Parallel: 2
  - Dependencies: Task 4, Task 5
  - **Details**:
    - `server/index.ts` — Express server on port 3001, CORS enabled for localhost:3000
    - `server/canvas-state.ts` — in-memory canvas state manager (mirrors Zustand store)
    - Routes:
      ```
      GET    /api/health              → { status: "ok", elements: count, uptime }
      GET    /api/v1/elements         → [ all elements as JSON ]
      GET    /api/v1/elements/:id     → single element
      POST   /api/v1/elements         → create element { type, x, y, styles }
      PATCH  /api/v1/elements/:id     → update element properties
      DELETE /api/v1/elements/:id     → remove element
      GET    /api/v1/selection        → currently selected element IDs
      POST   /api/v1/undo            → undo last action
      POST   /api/v1/redo            → redo last action
      POST   /api/v1/export          → { format: "react"|"svg"|"png"|"json" }
      GET    /api/v1/save             → full canvas JSON (toJSON)
      POST   /api/v1/load            → load canvas from JSON (loadFromJSON)
      POST   /api/v1/screenshot      → capture canvas as PNG base64
      ```
    - WebSocket bridge (optional): API mutations → broadcast to connected UI via WS for sync
    - Request validation with zod schemas
  - **Definition of Done**:
    - Test: `npm run test -- --filter api`
    - Assertion: CRUD operations on elements work, export returns valid JSON/SVG, save/load round-trips

### P3: Code Export (Sequential, depends on P2)

- [ ] **Task 8**: Implement canvas-to-React/Tailwind code generator
  - Agent: general-purpose
  - Parallel: 3
  - Dependencies: Task 5, Task 7
  - **Details**:
    - `src/export/react-generator.ts` — main export engine
    - Strategy: Two-tier export
      - **Tier 1 (Deterministic)**: Direct mapping of canvas objects to React components
        - `paper:button` → `<button className="...">`
        - `paper:card` → `<div className="rounded-lg shadow-md ...">`
        - `paper:text` → `<h1>`, `<h2>`, `<p>` based on textStyle
        - `paper:container` → `<div className="flex|grid ...">` based on layout
        - `paper:navbar` → `<nav className="...">`
        - Basic shapes → `<div>` with Tailwind dimension/color classes
      - **Tier 2 (LLM-enhanced, optional)**: Send canvas JSON + component tree to `/scillm` or `/create-react-designs` for polish
    - Layout inference: detect parent-child containment, infer flex direction from position clustering
    - Design tokens extraction: colors → CSS custom properties, font sizes → Tailwind scale
    - Output: standalone `.tsx` file + Tailwind config snippet
    - `src/export/svg-generator.ts` — canvas `toSVG()` wrapper with custom object support
    - `src/export/json-generator.ts` — raw canvas JSON export
  - **Definition of Done**:
    - Test: `npm run test -- --filter export`
    - Assertion: Canvas with 3 buttons + 1 card exports to valid React/Tailwind code that renders without errors

### P4: Integration & Polish (Sequential, depends on P3)

- [ ] **Task 9**: Wire skill wrapper to live API
  - Agent: general-purpose
  - Parallel: 4
  - Dependencies: Task 2, Task 7, Task 8
  - **Details**:
    - Update `run.sh` to use actual HTTP calls via `curl` for simple ops
    - `paper_clone.py` Python helper for complex operations (export with LLM, batch element creation)
    - Test full skill flow:
      ```bash
      ./run.sh start
      ./run.sh create --type button --x 100 --y 200 --text "Submit" --variant primary
      ./run.sh create --type card --x 300 --y 100 --title "Dashboard" --body "Welcome"
      ./run.sh export --format react > dashboard.tsx
      ./run.sh screenshot > dashboard.png
      ./run.sh save > design.json
      ./run.sh stop
      ```
    - PID file management for start/stop lifecycle
    - Timeout handling (start waits for health check, max 10s)
  - **Definition of Done**:
    - Test: `bash .pi/skills/paper-clone/sanity.sh` (full integration test)
    - Assertion: Full skill flow (start → create → export → stop) completes without errors

- [ ] **Task 10**: End-to-end tests and /skills-ci compliance
  - Agent: general-purpose
  - Parallel: 4
  - Dependencies: Task 9
  - **Details**:
    - E2E test: start server → create elements via API → export React → validate JSX syntax
    - Run `/skills-ci scan` to verify skill structure compliance
    - Run `skills-broadcast link` to propagate to all IDE targets
    - Verify `run.sh` is executable, `sanity.sh` passes, SKILL.md has triggers
    - Add to skills-manifest.json (auto via skills-ci)
  - **Definition of Done**:
    - Test: `cd .pi/skills/skills-ci && uv run python skills_ci.py --mode scan 2>&1 | grep paper-clone`
    - Assertion: paper-clone skill passes scan with 0 errors, broadcast confirms all targets symlinked

## Completion Criteria

- [ ] All sanity scripts pass
- [ ] All tasks marked [x]
- [ ] All Definition of Done tests pass
- [ ] No regressions in existing tests
- [ ] `/skills-ci scan` shows 0 new errors
- [ ] `/skills-broadcast link` confirms all targets

## Notes

- **Fabric.js v7.2.0** is the target (NOT v6). Package is `fabric` on npm, fully TypeScript.
- **No MCP**: All agent interaction via `run.sh` subcommands → HTTP to localhost:3001
- **LLM export is Tier 2**: Deterministic React export works first, LLM polish is optional enhancement
- **NVIS palette**: Can be applied later via `/create-styleguide` — not blocking for MVP
- **Collaboration/multiplayer**: Out of scope for MVP. Single-user canvas.
- **Persistence**: JSON file-based (save/load). No database needed for MVP.

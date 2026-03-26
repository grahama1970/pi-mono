# Task List: Unified Lab R7 → React Implementation

**Created**: 2026-03-16
**Updated**: 2026-03-17
**Goal**: Implement 4 Unified Lab supervision tabs from R7-approved HTML mockups as production React components in /ux-lab
**Type**: design

## Primary Persona

**Name**: Graham
**Role**: Data scientist supervising ML training pipelines
**Source**: MEMORY.md (user section)

### Workflow That Drives This Plan
- Monitors classifier/regressor training runs via live WebSocket dashboard
- Needs at-a-glance status: which models are memorizing, stale, or failing gates
- Clicks table rows to drill into specific models or trigger re-evaluation
- Switches between tabs to supervise different lab types (classifier, regressor, GPT)

### Persona's Quality Thresholds
- Macro F1 ≥ 0.75, per-class recall ≥ 0.50 (from Convergence tab gates)
- Wilson lower-bound ≥ 0.85 for promotion
- Staleness > 7d = red alert

## Context

The Unified Lab interface has 9 tabs. 3 are implemented (Convergence 941 LOC, Rationale 168 LOC, Sweeps 133 LOC). 4 are stubs (26-31 LOC). 2 are not built. R7 HTML mockups have been reviewed and PASSED by both Nico Bailon (developer) and Steve Schoger (designer) via `/subagent-service` Gemini. The pill component system (7 variants) is the ONE standard.

**Design board**: R7 mockups already approved — Phase 0.7 gate SATISFIED by this session's review cycle.

## Backend Routing Convention

| Task Type | Backend | Timeout |
|-----------|---------|---------|
| Implementation (write TSX) | claude | 600s |
| Design review (review-design) | gemini | 600s |
| Interaction testing | gemini | 600s |
| Scaffolding (deps, manifest) | claude | 300s |

## Capability Overlap

- `/memory recall`: No prior unified-lab implementation plans found
- **Existing skills used**: `/ux-lab` (Vite workbench), `/review-design` (Nico+Steve via subagent), `/best-practices-react`, `/test-interactions`
- **Existing components reused**: EmbryStyle.ts tokens, useWebSocket hook, useLabStore, ModeBadge, ReasoningToast
- **No new skills needed** — all tasks are EXTEND or CREATE within existing /ux-lab package

## Crucial Dependencies (Sanity Scripts)

| Library | API/Method | Sanity Script | Status |
|---------|------------|---------------|--------|
| react | JSX, hooks | N/A (well-known) | - |
| @tanstack/react-table | useReactTable | N/A (already in package.json) | - |
| recharts | LineChart, BarChart | `sanity/recharts_check.sh` | [ ] PENDING |
| vite | HMR dev server | N/A (already working) | - |

> recharts may not be installed — check package.json and add if missing.

## Questions/Blockers

None — R7 mockups are fully approved. All requirements clear from design board + review feedback.

## Blind Evaluation

- Hidden tests active for ALL implementation tasks
- Max retries per task: 5
- Coding agent cannot view or modify tests
- `/test-lab verify-task` in every task's DoD

## Tasks

### Wave 0: Shared Foundation (Sequential)

- [x] **Task 0.1**: Add recharts dependency if missing + verify Vite dev server starts
  - Agent: general-purpose
  - Model: sonnet
  - Dispatch: `/subagent-service --model claude --timeout 300`
  - Parallel: 0
  - Dependencies: none
  - Timeout: 300s (simple npm install + dev server check)
  - **Definition of Done**:
    - Test: `cd packages/ux-lab && npm run dev` starts without errors
    - Assertion: `recharts` in package.json dependencies

- [ ] **Task 0.2**: Generate blind tests for all implementation tasks
  - Agent: general-purpose
  - Model: sonnet
  - Dispatch: `/subagent-service --model claude --timeout 300`
  - Parallel: 0
  - Dependencies: Task 0.1
  - Run: `/test-lab generate --domain react-components --target packages/ux-lab/`
  - Timeout: 300s (test generation, no heavy compute)
  - **Definition of Done**:
    - Test: `ls packages/ux-lab/.test-lab/ | wc -l` returns > 0
    - Assertion: Blind test fixtures generated for all implementation tasks

- [x] **Task 0.3**: Create `StatusPill.tsx` shared component with 7 variants
  - Agent: general-purpose
  - Model: opus
  - Dispatch: `/subagent-service --model claude --timeout 600`
  - Parallel: 0
  - Dependencies: Task 0.1
  - Source: R7 pill CSS system (pill-green, pill-amber, pill-red, pill-blue, pill-purple, pill-neutral, pill-flash)
  - Location: `src/components/unified-lab/components/StatusPill.tsx`
  - Style: inline style objects using EmbryStyle.ts tokens. NO Tailwind.
  - Props: `variant: 'green'|'amber'|'red'|'blue'|'purple'|'neutral'`, `flash?: boolean`, `children: ReactNode`
  - Timeout: 600s (new component, needs to read EmbryStyle.ts, write ~60 LOC)
  - **Definition of Done**:
    - Test: `npx tsc --noEmit` passes
    - Blind test: `/test-lab verify-task 0.3 packages/ux-lab/ --domain react-components`
    - Assertion: Component renders all 7 variants with correct colors from EmbryStyle.ts

- [x] **Task 0.4**: Add `StatusPill` to ComponentGallery with all 7 variants
  - Agent: general-purpose
  - Model: sonnet
  - Dispatch: `/subagent-service --model claude --timeout 300`
  - Parallel: 0
  - Dependencies: Task 0.3
  - Timeout: 300s (small edit to existing gallery)
  - **Definition of Done**:
    - Test: `curl -s http://localhost:3002 | grep -c "StatusPill"` returns > 0
    - Assertion: StatusPill visible at localhost:3002 in gallery with all variants rendered

### Wave 1: Classification Tab (Design Pipeline)

- [x] **Task 1.1**: `/ux-lab` draft — Implement ClassificationTab from `tab_classification_r7.html`
  - Agent: general-purpose
  - Model: opus
  - Dispatch: `/subagent-service --model claude --timeout 600`
  - Parallel: 1
  - Dependencies: Task 0.3
  - Source mockup: `figures/tab_classification_r7.html`
  - Replace 31-LOC stub in `tabs/ClassificationTab.tsx`
  - Components: StatusPill, training curve SVG, bar chart, promotion table with clickable rows
  - Use `useWebSocket` for live training data
  - Timeout: 600s (200+ LOC component with charts and tables)
  - **Definition of Done**:
    - Test: `npx tsc --noEmit` passes
    - Blind test: `/test-lab verify-task 1.1 packages/ux-lab/ --domain react-components`
    - Assertion: Tab renders training curves, class distribution bars, promotion table with StatusPill badges

- [ ] **Task 1.2**: `/review-design` — Screenshot ClassificationTab via `/surf`, review with Nico + Steve via `/subagent-service` gemini
  - Agent: general-purpose
  - Model: sonnet
  - Parallel: 2
  - Dependencies: Task 1.1
  - Dispatch: `/subagent-service --model gemini --timeout 600`
  - Run: `/review-design --persona nico-bailon` then `/review-design --persona steve-schoger` (agent reads files directly from /home/node/skills/ux-lab/designs/ — no image passing needed)
  - On failure: re-trigger `/ux-lab` iteration (max 3 rounds)
  - Timeout: 600s (two persona reviews with vision analysis)
  - **Definition of Done**:
    - Test: `/review-design` exit code 0 for both persona runs
    - Assertion: Both Nico and Steve grade PASS on component standardization

- [ ] **Task 1.3**: `/test-interactions` — Verify hover states, clickable rows, Stop Training button
  - Agent: general-purpose
  - Model: sonnet
  - Dispatch: `/subagent-service --model gemini --timeout 600`
  - Parallel: 3
  - Dependencies: Task 1.2
  - Run: `/test-interactions --persona graham --surface http://localhost:3002 --tab ClassificationTab --interactions "hover:promo-table-row,click:stop-training-btn,hover:legend-item"`
  - On failure: re-trigger `/ux-lab` iteration (max 3 rounds)
  - Timeout: 600s (browser automation + screenshot capture)
  - **Definition of Done**:
    - Test: `/test-interactions` exit code 0, screenshots saved to `captures/classification/`
    - Assertion: All interactive elements respond to click/hover — screenshot evidence saved to captures/

### Wave 2: Regression Tab (Design Pipeline)

- [x] **Task 2.1**: `/ux-lab` draft — Implement RegressionTab from `tab_regression_r7.html`
  - Agent: general-purpose
  - Model: opus
  - Dispatch: `/subagent-service --model claude --timeout 600`
  - Parallel: 1
  - Dependencies: Task 0.3
  - Source mockup: `figures/tab_regression_r7.html`
  - Replace 26-LOC stub in `tabs/RegressionTab.tsx`
  - Components: StatusPill, model table with staleness pills, residual scatter plot SVG, "Re-evaluate" hover link
  - Timeout: 600s (150+ LOC component with table and scatter plot)
  - **Definition of Done**:
    - Test: `npx tsc --noEmit` passes
    - Blind test: `/test-lab verify-task 2.1 packages/ux-lab/ --domain react-components`
    - Assertion: Tab renders model table with pill badges, scatter plot, hover affordances

- [ ] **Task 2.2**: `/review-design` — Screenshot RegressionTab, review with Nico + Steve
  - Agent: general-purpose
  - Model: sonnet
  - Parallel: 2
  - Dependencies: Task 2.1
  - Dispatch: `/subagent-service --model gemini --timeout 600`
  - Run: `/review-design --persona nico-bailon` then `/review-design --persona steve-schoger` (agent reads files directly — no image passing needed)
  - On failure: re-trigger `/ux-lab` iteration (max 3 rounds)
  - Timeout: 600s (two persona reviews)
  - **Definition of Done**:
    - Test: `/review-design` exit code 0 for both persona runs
    - Assertion: Both reviewers grade PASS

- [ ] **Task 2.3**: `/test-interactions` — Verify Re-evaluate hover link, clickable rows
  - Agent: general-purpose
  - Model: sonnet
  - Dispatch: `/subagent-service --model gemini --timeout 600`
  - Parallel: 3
  - Dependencies: Task 2.2
  - Run: `/test-interactions --persona graham --surface http://localhost:3002 --tab RegressionTab --interactions "hover:model-row,click:model-row,hover:re-evaluate-link"`
  - On failure: re-trigger `/ux-lab` iteration (max 3 rounds)
  - Timeout: 600s (browser automation)
  - **Definition of Done**:
    - Test: `/test-interactions` exit code 0, screenshots saved to `captures/regression/`
    - Assertion: Hover reveals Re-evaluate link, rows have pointer cursor — screenshot evidence saved

### Wave 3: Cascade Placeholder (Simple)

- [x] **Task 3.1**: Replace ComparisonTab stub with Cascade "Coming Soon" placeholder from `tab_cascade_r7.html`
  - Agent: general-purpose
  - Model: sonnet
  - Dispatch: `/subagent-service --model claude --timeout 300`
  - Parallel: 1
  - Dependencies: Task 0.3
  - Source mockup: `figures/tab_cascade_r7.html`
  - Replace 26-LOC stub in `tabs/ComparisonTab.tsx` (rename to CascadeTab.tsx)
  - Components: StatusPill (pill-blue for "Track Wave 0.5"), lock icon SVG
  - Timeout: 300s (simple placeholder, ~40 LOC)
  - **Definition of Done**:
    - Test: `npx tsc --noEmit` passes
    - Assertion: Tab shows Coming Soon message with prerequisite explanation

### Wave 4: Model Health Tab (Design Pipeline)

- [x] **Task 4.1**: `/ux-lab` draft — Create new ModelHealthTab from `tab_model_health_r7.html`
  - Agent: general-purpose
  - Model: opus
  - Dispatch: `/subagent-service --model claude --timeout 600`
  - Parallel: 1
  - Dependencies: Task 0.3
  - Source mockup: `figures/tab_model_health_r7.html`
  - New file: `tabs/ModelHealthTab.tsx`
  - Components: StatusPill, summary stat cards, @tanstack/react-table for sortable/filterable model list, "View in Lab" hover link
  - Uses `useLabStore` for aggregated model data
  - Timeout: 600s (most complex tab, 250+ LOC with react-table)
  - **Definition of Done**:
    - Test: `npx tsc --noEmit` passes
    - Blind test: `/test-lab verify-task 4.1 packages/ux-lab/ --domain react-components`
    - Assertion: Tab renders summary cards + sortable table with all pill variants, hover shows "View in Lab"

- [ ] **Task 4.2**: `/review-design` — Screenshot ModelHealthTab, review with Nico + Steve
  - Agent: general-purpose
  - Model: sonnet
  - Parallel: 2
  - Dependencies: Task 4.1
  - Dispatch: `/subagent-service --model gemini --timeout 600`
  - Run: `/review-design --persona nico-bailon` then `/review-design --persona steve-schoger` (agent reads files directly — no image passing needed)
  - On failure: re-trigger `/ux-lab` iteration (max 3 rounds)
  - Timeout: 600s (two persona reviews)
  - **Definition of Done**:
    - Test: `/review-design` exit code 0 for both persona runs
    - Assertion: Both reviewers grade PASS

- [ ] **Task 4.3**: `/test-interactions` — Verify sort, filter, "View in Lab" hover, row click
  - Agent: general-purpose
  - Model: sonnet
  - Dispatch: `/subagent-service --model gemini --timeout 600`
  - Parallel: 3
  - Dependencies: Task 4.2
  - Run: `/test-interactions --persona graham --surface http://localhost:3002 --tab ModelHealthTab --interactions "click:sort-status,click:filter-dropdown,hover:model-row,click:view-in-lab-link"`
  - On failure: re-trigger `/ux-lab` iteration (max 3 rounds)
  - Timeout: 600s (browser automation with multiple interactions)
  - **Definition of Done**:
    - Test: `/test-interactions` exit code 0, screenshots saved to `captures/model-health/`
    - Assertion: Table sorts on Status column click, filter dropdown works, hover reveals "View in Lab" — screenshot evidence saved

### Wave 5: Integration + Tab Registration

- [ ] **Task 5.1**: Register all new tabs in the tab bar / router
  - Agent: general-purpose
  - Model: sonnet
  - Dispatch: `/subagent-service --model claude --timeout 300`
  - Parallel: 4
  - Dependencies: Task 1.3, Task 2.3, Task 3.1, Task 4.3
  - Update tab bar to include: Classification, Rationale, Regression, Cascade, Annotations, Sweeps, Convergence, Model Health
  - Rename "Comparison" → "Cascade" in navigation
  - Timeout: 300s (edit existing router config)
  - **Definition of Done**:
    - Test: All tabs accessible via tab bar at localhost:3002
    - Assertion: 8 tabs visible, each renders its component

- [ ] **Task 5.2**: Update `component-manifest.json` with all new components
  - Agent: general-purpose
  - Model: sonnet
  - Dispatch: `/subagent-service --model claude --timeout 300`
  - Parallel: 4
  - Dependencies: Task 5.1
  - Each component entry MUST include: `id`, `name`, `folder`, `file`, `lines`, `props`, `data_sources`, `used_by`, `variations`, `test_status`
  - New entries required:
    - `StatusPill` — shared component, 7 variants (green/amber/red/blue/purple/neutral/flash), used_by all tabs
    - `ClassificationTab` — tab, source: tab_classification_r7.html, data: useWebSocket
    - `RegressionTab` — tab, source: tab_regression_r7.html, data: useLabStore
    - `CascadeTab` — tab, placeholder only, no data source
    - `ModelHealthTab` — tab, source: tab_model_health_r7.html, data: useLabStore + @tanstack/react-table
  - Timeout: 300s (JSON editing)
  - **Definition of Done**:
    - Test: `python3 -c "import json; d=json.load(open('component-manifest.json')); assert len([c for c in d['components'] if 'StatusPill' in c['name']]) > 0"`
    - Assertion: Manifest has all 5 new components with complete fields

- [ ] **Task 5.3**: Final `npx tsc --noEmit` + update DESIGN_BOARD.md with R7 round
  - Agent: general-purpose
  - Model: sonnet
  - Dispatch: `/subagent-service --model claude --timeout 300`
  - Parallel: 4
  - Dependencies: Task 5.1
  - Timeout: 300s (tsc check + markdown edit)
  - **Definition of Done**:
    - Test: Zero TypeScript errors
    - Assertion: DESIGN_BOARD.md has Round 7 section documenting implementation status

## Completion Criteria

- [ ] StatusPill shared component with 7 variants
- [ ] ClassificationTab implemented (not stub) — PASS from Nico + Steve
- [ ] RegressionTab implemented (not stub) — PASS from Nico + Steve
- [ ] CascadeTab shows Coming Soon placeholder
- [ ] ModelHealthTab implemented (new) — PASS from Nico + Steve
- [ ] All tabs registered in tab bar
- [ ] `npx tsc --noEmit` passes
- [ ] component-manifest.json updated
- [ ] DESIGN_BOARD.md updated with R7 section

## Notes

- R7 HTML mockups are the SOLE source of truth for visual design. Do NOT deviate.
- ALL badges/tags/counts MUST use StatusPill. No inline-styled badges. No exceptions.
- Inline style objects using EmbryStyle.ts tokens. NO Tailwind, NO CSS modules.
- Convergence tab (941 LOC) is UNTOUCHED — already implemented and working.
- Rationale and Sweeps tabs are UNTOUCHED — already implemented.
- Annotations tab stub is UNTOUCHED — no R7 mockup for it.
- Wave 0.5 (cascade.py instrumentation) is OUT OF SCOPE for this plan.

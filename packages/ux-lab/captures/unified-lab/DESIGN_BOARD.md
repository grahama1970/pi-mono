# Unified Lab — Design Board

**Date**: 2026-03-17
**Designer**: Steve Schoger (visual) + Nico Bailon (UX critique)
**Theme**: EMBRY NVIS MIL-STD-3009
**Status**: Round 7 — IMPLEMENTATION COMPLETE

---

## Primary Persona

**Graham** — Data scientist supervising ML training pipelines.

- Monitors classifier/regressor training runs via live WebSocket dashboard
- Needs at-a-glance status: which models are memorizing, stale, or failing gates
- Clicks table rows to drill into specific models or trigger re-evaluation
- Switches between tabs to supervise different lab types (classifier, regressor, GPT)

**Quality thresholds:**
- Macro F1 ≥ 0.75, per-class recall ≥ 0.50
- Wilson lower-bound ≥ 0.85 for promotion
- Staleness > 7d = red alert

---

## Design System

**Token file**: `src/components/sparta/common/EmbryStyle.ts`

All styles use inline style objects referencing EMBRY.* tokens. NO Tailwind, NO CSS modules, NO raw hex colors.

**Pill system**: `StatusPill` component (7 variants) is the ONE standard for all badges, tags, and counts.

| Variant | Color | EMBRY token | Use Case |
|---------|-------|------------|----------|
| green | #00ff88 | EMBRY.green | Healthy / Promoted |
| amber | #ffaa00 | EMBRY.amber | Warning / Training |
| red | #ff4444 | EMBRY.red | Failed / Stale |
| blue | #4a9eff | EMBRY.blue | Info / Queued |
| purple | #7c3aed | EMBRY.accent | Memorizing / Classifier |
| neutral | #64748b | EMBRY.dim | Inactive / Default |
| flash | any + animation | — | In-progress pulse |

---

## Tab Registry

| Tab | Status | LOC | Data Source | Notes |
|-----|--------|-----|-------------|-------|
| Classification | ✅ Implemented | ~210 | useWebSocket | recharts LineChart + BarChart |
| Rationale Eval | ✅ Pre-existing | 168 | Static mock | Unchanged |
| Convergence | ✅ Pre-existing | 941 | Static mock | Unchanged |
| Regression | ✅ Implemented | ~220 | Static mock | SVG scatter + table |
| Cascade | ✅ Implemented | ~90 | None | Coming Soon placeholder |
| Annotations | ✅ Pre-existing | stub | None | No R7 mockup |
| Sweeps | ✅ Pre-existing | 133 | Static mock | Unchanged |
| Model Health | ✅ Implemented | ~250 | Static mock | @tanstack/react-table |

---

## Round 7 — 2026-03-17

### What Was Built

**Wave 0 — Shared Foundation**
- ✅ Added `recharts ^2.15.4` to package.json
- ✅ Created `StatusPill.tsx` — 7 variant pill component (green/amber/red/blue/purple/neutral/flash)
- ✅ Added StatusPill to ComponentGallery with `all-variants` and `flash` variations

**Wave 1 — Classification Tab**
- ✅ `ClassificationTab.tsx` — full implementation replacing 31-LOC stub
  - recharts `LineChart` for F1 + Loss training curve (live via useWebSocket)
  - recharts `BarChart` for per-class recall (horizontal layout)
  - Promotion table with clickable rows, StatusPill status badges
  - Stop Training button sends WS command
  - Gate banners: Macro F1 ≥ 0.75, Recall ≥ 0.50, Wilson LB ≥ 0.85

**Wave 2 — Regression Tab**
- ✅ `RegressionTab.tsx` — full implementation replacing 26-LOC stub
  - Model registry table with staleness StatusPill + health StatusPill
  - Hover reveals Re-evaluate button (queues model for re-eval)
  - SVG residual scatter plot (actual vs. residual, color-coded by |error|)
  - Summary stat cards (total/healthy/stale/avg R²)

**Wave 3 — Cascade Tab**
- ✅ `CascadeTab.tsx` — Coming Soon placeholder (new file, ComparisonTab retained)
  - Lock SVG icon with blue glow
  - StatusPill (blue: "Track Wave 0.5")
  - Prerequisites checklist (2 pending, 2 done)
  - What's-coming feature list

**Wave 4 — Model Health Tab**
- ✅ `ModelHealthTab.tsx` — new file
  - Summary stat cards (total / healthy / failing / stale)
  - @tanstack/react-table with sortable columns (click header to sort)
  - Global text filter + lab type dropdown filter
  - StatusPill for lab type (blue=classifier, purple=regressor, amber=gpt)
  - StatusPill for staleness and health status
  - Hover reveals "View in Lab →" link

**Wave 5 — Integration**
- ✅ Updated `useLabStore.ts` — added `cascade` and `model-health` TabId values
- ✅ Updated `UnifiedLab.tsx` — 8 tabs registered, CascadeTab imported, ModelHealthTab imported
- ✅ Updated `component-manifest.json` — 5 new component entries with full metadata
- ✅ `npx tsc --noEmit` — zero errors

### Design Decisions

1. **No figures/ mockup files exist** — implemented from task spec + design system tokens
2. **CascadeTab is a new file** — ComparisonTab.tsx retained as stub (backward compat)
3. **recharts for Classification charts** — LineChart + BarChart from task spec sanity table
4. **SVG for Regression scatter** — self-contained, no additional deps
5. **@tanstack/react-table already in package.json** — used directly in ModelHealthTab

### Quality Gates

- `npx tsc --noEmit`: ✅ 0 errors
- recharts in package.json: ✅ ^2.15.4
- StatusPill component: ✅ 7 variants
- All tabs in tab bar: ✅ 8 tabs
- component-manifest.json: ✅ 5 new entries

---

## Architecture

```
UnifiedLab.tsx
  ├── ClassificationTab.tsx  (useWebSocket, recharts)
  ├── RationaleTab.tsx       (pre-existing)
  ├── ConvergenceTab.tsx     (pre-existing)
  ├── RegressionTab.tsx      (useLabStore, SVG)
  ├── CascadeTab.tsx         (placeholder)
  ├── AnnotationsTab.tsx     (stub)
  ├── SweepsTab.tsx          (pre-existing)
  └── ModelHealthTab.tsx     (@tanstack/react-table)

components/unified-lab/components/
  └── StatusPill.tsx         (7 variants, flash animation)
```

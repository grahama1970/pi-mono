# Task List: SPARTA Annotation Mode for UX Lab

**Created**: 2026-03-13
**Goal**: Add Prodigy-style SPARTA entity annotation interface as a second mode alongside the existing design canvas.

## Context

UX Lab is currently a Figma-clone collaborative design canvas. It needs a second mode: a Prodigy-style SPARTA entity annotation interface where:
- Sentences are displayed with color-coded word-level entity labels (like Prodigy NER)
- SPARTA tactic/technique/controls context is shown per annotation item
- Citations include full source attribution (collection, doc ID, page, confidence)
- Progress bar tracks completed/total annotation items
- Accept/reject/skip decision buttons with keyboard shortcuts
- `/extract-entities` output is the content being annotated

The dual-mode app switches between "Canvas" (existing) and "Annotate" (new) via a top bar toggle.

## Capability Overlap

### /memory recall results
- UX Lab evidence case (2026-03-11): INCONCLUSIVE — 42% feature gap vs Prodigy parity
- `/interview` skill: Has structured Q&A wizard but NOT token-level annotation
- `/extract-entities`: Extracts control_ids, domain phrases, taxonomy tags — provides annotation DATA
- `/create-evidence-case`: CAE trees — provides evidence structure to display

### skills-manifest.json scan
- `extract-entities`: CALL — provides entity extraction output as annotation content
- `create-sentence-markup`: REFERENCE — borrow annotation schema (grounded/misspelled/fabricated/unknown entity states) and NVIS color mapping. CLI tool, not a React component — CREATE still justified for interactive UI.
- `test-interactions`: CALL — validates UI against manifest expectations
- `review-design`: CALL — evaluates design quality per round
- `interview`: REFERENCE — borrow interaction patterns (tabbed nav, keyboard shortcuts)
- No existing React annotation/labeling component in any skill

### Decision matrix
| Functionality | Category | Justification |
|---------------|----------|---------------|
| Token annotation component | CREATE | No interactive word-level highlighting exists. `create-sentence-markup` is CLI-only output, not interactive React. |
| Annotation view (layout + SPARTA context + citation + progress + decisions) | CREATE | Single composed view — no equivalent exists |
| Annotation store (Zustand) | CREATE | New state shape for annotation items |
| Mode switcher in App.tsx | EXTEND | Add toggle to existing top bar |
| Keyboard shortcuts | EXTEND | Add annotation shortcuts to existing hook (inside component tasks) |
| NVIS theme | CALL | Reuse existing theme.ts tokens |

### Anti-silo justification
All CREATE tasks are for annotation UX components that don't exist in any form. `create-sentence-markup` provides CLI annotation output but not an interactive React labeling interface. The canvas mode is preserved; annotation mode is additive.

## Crucial Dependencies (Sanity Scripts)

| Library | API/Method | Sanity Script | Status |
|---------|------------|---------------|--------|
| React 19 | `useState`, `useCallback` | N/A (standard) | - |
| Zustand 5 | `create`, `useShallow` | N/A (already used) | - |

> No new dependencies required. All annotation components use React + Zustand + existing NVIS theme.

## Questions/Blockers

None — direction confirmed via /interview (2026-03-11): Both annotation + canvas modes, /extract-entities provides content.

## Blind Evaluation

Hidden tests generated via `/test-lab` after Task 5 (all components built). The coding agent CANNOT view or modify these tests — only sees pass/fail output. Max retries per task: 5.

## Tasks

### P0: Data Types & Store (Sequential)

- [ ] **Task 1**: Add SPARTA annotation types to `src/types.ts` and create annotation store
  - Agent: general-purpose
  - Parallel: 0
  - Dependencies: none
  - **Files**: `src/types.ts`, `src/store/annotationStore.ts` (new)
  - **Details**:
    - Add to `types.ts`:
      - `AnnotationItem` — id, text (raw sentence), tokens (word array), spartaContext (SpartaContext), citation (CitationSource), status ("pending"|"accepted"|"rejected"|"skipped"), labels (EntityLabel[])
      - `EntityLabel` — start (token index), end (token index), label (string, e.g. "CONTROL_ID"), color (hex from NVIS)
      - `SpartaContext` — tactic, technique, controlsCategory, relatedControls[]
      - `CitationSource` — collection, documentId, pageNumber, confidence (0-1)
    - Create `annotationStore.ts` Zustand store:
      - State: `items: AnnotationItem[]`, `currentIndex: number`, `availableLabels: {name, color}[]`, `activeLabel: string | null`
      - Derive counts from items array (no stored `completedCount` — compute via `items.filter`)
      - Actions: `loadItems(items[])`, `accept()`, `reject()`, `skip()`, `nextItem()`, `prevItem()`, `addLabel(itemId, start, end, label)`, `removeLabel(itemId, labelIndex)`, `setActiveLabel(name)`
      - Use `useShallow` for array selectors (Zustand v5 — learned from PropertiesPanel crash)
    - Also read `src/store/manifestStore.ts` to verify no mode-related state conflicts
  - **Definition of Done**:
    - Test: `npx tsc --noEmit` passes
    - Blind: `test-lab/run.sh verify-task 1 packages/ux-lab/ --domain annotation`
    - Assertion: 4 interfaces exported from types.ts, store exports `useAnnotationStore`, no existing types broken

### P1: Core Annotation Components (Parallel)

- [ ] **Task 2**: Create `src/components/annotation/TokenAnnotation.tsx`
  - Agent: general-purpose
  - Parallel: 1
  - Dependencies: Task 1
  - **Files**: `src/components/annotation/TokenAnnotation.tsx` (new, ~200 lines)
  - **Details**: The core Prodigy-style token annotation component:
    - Renders sentence as individual word `<span>` elements
    - Click a word to start selection, drag to extend, release to apply active label
    - Labeled spans get colored background (entity color) + small label chip above
    - Click existing label to remove it
    - Word boundaries respected (snap-to-token like Prodigy)
    - NVIS colors: labels use status colors (GREEN for controls, BLUE for techniques, AMBER for tactics, RED for threats)
    - Dark background, high contrast text (#c8c8c8 on #0a0a1a)
    - `data-testid="token-annotation"` for test-interactions
  - **Definition of Done**:
    - Test: `npx tsc --noEmit` passes
    - Blind: `test-lab/run.sh verify-task 2 packages/ux-lab/ --domain annotation`
    - Assertion: `document.querySelectorAll('[data-testid="token-annotation"] span').length > 0` when rendered with sample data

- [ ] **Task 3**: Create `src/components/annotation/LabelBar.tsx` with keyboard shortcuts 1-5
  - Agent: general-purpose
  - Parallel: 1
  - Dependencies: Task 1
  - **Files**: `src/components/annotation/LabelBar.tsx` (new, ~100 lines)
  - **Details**: Horizontal bar of selectable entity category chips (like Prodigy NER label bar):
    - Chips: CONTROL_ID (GREEN), TECHNIQUE (BLUE), TACTIC (AMBER), THREAT (RED), EVIDENCE (ACCENT purple)
    - Active chip has filled background, inactive has outline only
    - Keyboard shortcuts: 1-5 for quick select (handled inside this component via `useEffect` keydown listener)
    - `data-testid="label-bar"`
  - **Definition of Done**:
    - Test: `npx tsc --noEmit` passes
    - Blind: `test-lab/run.sh verify-task 3 packages/ux-lab/ --domain annotation`
    - Assertion: `document.querySelectorAll('[data-testid="label-bar"] button').length === 5`

- [ ] **Task 4**: Create `src/components/annotation/DecisionButtons.tsx` with keyboard shortcuts
  - Agent: general-purpose
  - Parallel: 1
  - Dependencies: Task 1
  - **Files**: `src/components/annotation/DecisionButtons.tsx` (new, ~100 lines)
  - **Details**: Accept/Reject/Skip buttons (Prodigy bottom bar):
    - Accept (GREEN, checkmark, keyboard: Enter or A)
    - Reject (RED, X, keyboard: Backspace or R)
    - Skip (DIM, arrow right, keyboard: Space or S)
    - Buttons advance to next item after action
    - Undo last decision (Ctrl+Z)
    - Keyboard shortcuts handled inside this component via `useEffect` keydown listener
    - `data-testid="decision-buttons"`
  - **Definition of Done**:
    - Test: `npx tsc --noEmit` passes
    - Blind: `test-lab/run.sh verify-task 4 packages/ux-lab/ --domain annotation`
    - Assertion: `document.querySelectorAll('[data-testid="decision-buttons"] button').length === 3`

### P2: Annotation View & App Integration (After Components)

- [ ] **Task 5**: Create `src/components/annotation/AnnotationView.tsx` — full annotation layout
  - Agent: general-purpose
  - Parallel: 2
  - Dependencies: Tasks 2, 3, 4
  - **Files**: `src/components/annotation/AnnotationView.tsx` (new, ~250 lines)
  - **Details**: Compose all annotation sub-components into a single Prodigy-style view. This component includes inline sections for SPARTA context and citation (NOT separate files — they're small sidebar sections):
    ```
    ┌──────────────────────────────────────────────────────┐
    │ PROGRESS BAR (4/50 completed — inline, ~30 lines)   │
    ├──────────────────────────────────────────────────────┤
    │ LABEL BAR: [CONTROL_ID] [TECHNIQUE] [TACTIC] ...    │
    ├─────────────────────────────┬────────────────────────┤
    │                             │ SPARTA CONTEXT         │
    │   TOKEN ANNOTATION          │  Tactic: TA0001        │
    │   "The system SHALL ..."    │  Technique: SA-01      │
    │   (centered, card-style)    │  Controls: AC-2, AC-3  │
    │                             ├────────────────────────┤
    │                             │ SOURCE                 │
    │                             │  Collection: NIST_SP   │
    │                             │  Doc ID: 800-53r5      │
    │                             │  Page: 42              │
    │                             │  Confidence: 94%       │
    ├─────────────────────────────┴────────────────────────┤
    │ [✓ Accept]    [✗ Reject]    [→ Skip]                │
    └──────────────────────────────────────────────────────┘
    ```
    - **Progress bar**: inline section at top — completed/total count, GREEN fill bar, accepted/rejected/skipped color segments. `data-testid="progress-bar"`
    - **SPARTA context**: inline right sidebar section — Tactic (AMBER badge), Technique (BLUE), Controls Category (GREEN), Related Controls (chips). `data-testid="sparta-context"`. Empty state: "No SPARTA context" dim text.
    - **Citation panel**: inline right sidebar section — Collection, Doc ID, Page, Confidence (color-coded: GREEN >80%, AMBER 50-80%, RED <50%). `data-testid="citation-panel"`
    - Content area centered (Prodigy-style cardMaxWidth ~700px)
    - Right sidebar 260px (matching existing panels)
    - NVIS dark theme throughout
    - `data-testid="annotation-view"`
  - **Definition of Done**:
    - Test: `npx tsc --noEmit` passes
    - Blind: `test-lab/run.sh verify-task 5 packages/ux-lab/ --domain annotation`
    - Assertion: All `data-testid` elements present: annotation-view, progress-bar, sparta-context, citation-panel

- [ ] **Task 6**: Add mode switcher to `App.tsx` + update `useKeyboardShortcuts.ts`
  - Agent: general-purpose
  - Parallel: 2
  - Dependencies: Task 5
  - **Files**: `src/App.tsx`, `src/components/useKeyboardShortcuts.ts`
  - **Details**:
    - Add `appMode` state: `"canvas" | "annotate"` (default: "canvas")
    - Top bar: Add toggle buttons "Canvas" / "Annotate" next to brand name
    - Active mode has ACCENT (#7c3aed) underline, inactive is DIM
    - When "canvas": render existing Toolbar + InfiniteCanvas + AgentOverlay + PropertiesPanel layout
    - When "annotate": render AnnotationView in place of the canvas area + right panel
    - Bottom area (CourseCorrection, OperationLog, StatusBar) stays in both modes
    - StatusBar: pass `appMode` prop — canvas shows "Zoom: 100% | 0 elements", annotate shows "Item 4/50 | 3 labeled"
    - Update `useKeyboardShortcuts.ts`: guard existing canvas shortcuts with `appMode === "canvas"` check. Annotation shortcuts (Enter/A, Backspace/R, Space/S, arrows) are handled by DecisionButtons and LabelBar components directly — no duplication here.
  - **Definition of Done**:
    - Test: `npx tsc --noEmit` passes
    - Blind: `test-lab/run.sh verify-task 6 packages/ux-lab/ --domain annotation`
    - Assertion: Both modes render without console errors. Mode toggle buttons visible in top bar.

### P3: Test Fixtures & Manifest (After Integration)

- [ ] **Task 7**: Create sample data fixture and update interaction manifest
  - Agent: general-purpose
  - Parallel: 3
  - Dependencies: Task 6
  - **Files**: `fixtures/sample-annotations.json` (new), `fixtures/interaction-manifest.json`
  - **Details**:
    - Create `sample-annotations.json`: 10 AnnotationItem entries with real SPARTA sentences (NIST SP 800-53 style), SpartaContext filled, CitationSource filled, mix of statuses (3 pending, 3 accepted, 2 rejected, 2 skipped), 2-3 items with pre-existing entity labels
    - Update `interaction-manifest.json`: Add `annotation-mode` surface with 7 element tests (annotation-view, token-annotation, label-bar, progress-bar, decision-buttons, sparta-context, citation-panel). Each with `action: screenshot` and descriptive `expected` strings. Update prodigy-parity-gaps: flip `expect_failure: false` for token-annotation, progress-bar, accept-reject-skip.
  - **Definition of Done**:
    - Test: `node -e "JSON.parse(require('fs').readFileSync('fixtures/sample-annotations.json'))"` exits 0
    - Blind: `test-lab/run.sh verify-task 7 packages/ux-lab/ --domain annotation`
    - Assertion: sample-annotations.json has 10 items with all fields populated. interaction-manifest.json has annotation-mode surface with 7+ elements.

## Completion Criteria

- [ ] All 7 tasks marked [x]
- [ ] `npx tsc --noEmit` passes (no type errors)
- [ ] App renders in both Canvas and Annotate modes without errors
- [ ] Annotation mode displays token-level word highlighting with entity labels
- [ ] SPARTA context (tactic, technique, controls) visible per item
- [ ] Citation source attribution (collection, docId, page, confidence) displayed
- [ ] Progress bar shows completed/total with color-coded segments
- [ ] Accept/reject/skip buttons work with keyboard shortcuts
- [ ] `/test-interactions` manifest passes for annotation-mode surface
- [ ] No regressions in existing canvas mode tests

## Verification (run after all tasks)

```bash
# Type check
cd packages/ux-lab && npx tsc --noEmit

# Start dev server and run test-interactions
npm run dev &
CDP_PORT=9224 /test-interactions run fixtures/interaction-manifest.json

# Blind evaluation
test-lab/run.sh verify packages/ux-lab/ --domain annotation
```

## Notes

- **Prodigy reference**: https://prodi.gy/ — token snap selection, label bar above text, progress sidebar, accept/reject/ignore buttons, keyboard shortcuts 1-9, card-based content (cardMaxWidth), confidence score
- **NVIS palette**: GREEN=#00ff88, RED=#ff4444, AMBER=#ffaa00, BLUE=#44aaff, WHITE=#c8c8c8, DIM=#505050, BG_PRIMARY=#0a0a1a, ACCENT=#7c3aed
- **Zustand v5 gotcha**: Always use `useShallow` from `zustand/react/shallow` for array/object selectors to avoid infinite re-render loops (learned from PropertiesPanel crash)
- **No new npm dependencies**: Everything uses React 19 + Zustand 5 + existing NVIS theme
- **No server-side annotation API**: State lives client-side in Zustand. Server persistence can be added later via a single `POST /api/v1/annotations/save` if needed — don't build 6 REST endpoints for client-side state.
- **Canvas mode untouched**: All annotation code is additive, gated behind mode toggle

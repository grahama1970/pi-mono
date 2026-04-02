# SPARTA Explorer — Project State (2026-04-01)

## Overview
SPARTA Explorer is a cybersecurity threat posture tool inside UX Lab. It maps SPARTA techniques to F-36 datalake evidence, runs evidence case pipelines, detects requirement drift, and surfaces discrepancies between requirements and design tables.

Primary user: **Brandon Bailey** (SPARTA cybersecurity analyst, former USAF).

## Architecture

```
Browser (localhost:3002)
  ├── App.tsx → project routing
  ├── SpartaExplorer.tsx → tab shell (Chat, Controls, QRAs, Sources, etc.)
  │   └── ChatTab.tsx → chat pane (left) + viz workspace (right)
  │       ├── ChatWell.tsx → message rendering with ReasoningBlock, RecallCard, GateChain
  │       ├── ThreatMatrix (compound component) → Grid + TacticStrip + Detail flyout
  │       ├── LemmaGraph → D3 force graph (full + critical-path modes)
  │       └── PostureDashboard → posture score, drift alerts, coverage ring, discrepancies
  ├── EvidenceCaseLab.tsx → Evaluate + Drift + Stress Test modes
  └── shared-chat/ReasoningBlock.tsx → 3-level progressive disclosure reasoning block

Express API (localhost:3001)
  ├── /api/evidence-case/run → invokes /create-evidence-case pipeline
  ├── /api/evidence-case/trace → queries evidence_cases collection
  ├── /api/evidence-case/drift → invokes compute_threat_delta.py
  ├── /api/evidence-case/stress-test → invokes run.sh stress-test
  ├── /api/memory/traceability → chunk_control_edges traversal
  ├── /api/critical-path → failing attack chains from sparta_relationships
  └── /api/memory/* → proxy to memory daemon Unix socket

Memory Daemon (Unix socket /run/user/1000/embry/memory.sock)
  └── ArangoDB (localhost:8529, db: memory)
      ├── evidence_cases: 61 docs (55 verdicts, 5 discrepancies, 1 threat-delta)
      ├── sparta_controls: 11,620
      ├── sparta_qra: 219,030
      ├── sparta_relationships: 133,494
      ├── chunk_control_edges: 361,942
      ├── requirement_control_edges: 84,622
      └── datalake_chunks: 2,516,706
```

## Components (42 TSX files)

### SPARTA Explorer (30 files)
- **ChatTab.tsx** — Chat + viz workspace. Detects intent (matrix/graph/dashboard/critical-path). Populates evidenceCase on messages. Drift alert cards on mount.
- **ThreatMatrix.tsx** — Compound component (Provider/Header/TacticStrip/Grid/Detail). Detail flyout shows traceability chunks, evidence cases with gate chain, discrepancies.
- **ThreatMatrixView.tsx** — Explorer-specific provider. Fetches from 5 endpoints in parallel on technique select.
- **LemmaGraph.tsx** — D3 force graph with proof status coloring. `mode` prop: 'full' | 'critical-path'.
- **PostureDashboard.tsx** — Posture score, drift alerts, coverage ring, discrepancies, critical path, timeline sparklines.
- **ChatWell.tsx** — Shared chat rendering. ReasoningBlock for evidence cases, RecallCard fallback, GateChain fallback, ThreatMatrixCard inline.
- **GateChain.tsx** — Collapsible gate timeline with status dots.
- **RecallCard.tsx** — Collapsible recall results. Debug scores in `<details>`.
- **ThreatMatrixCard.tsx** — Compact inline matrix summary for chat.
- **SourcesView.tsx** — Worksheets.yaml-driven sources tab.

### Shared Chat (10 files)
- **ReasoningBlock.tsx** — 3-level progressive disclosure (verdict line → gate pills + metrics grid → full GateChain + sources). Gemini-designed, Codex-implemented, Gemini-reviewed.
- **SkillPalette.tsx** — / command autocomplete.
- **MarkdownRenderer.tsx** — Renders agent responses.
- **highlightEntities.tsx** — Entity detection and linking.

### Evidence Case Lab (3 files)
- **EvidenceCaseLab.tsx** — Main shell with Evaluate/Drift/Stress Test tabs.
- **DriftView.tsx** — Side-by-side before/after verdict comparison.
- **StressTestView.tsx** — Batch results grid with accuracy metrics.

### Dashboard (1 file)
- **PostureDashboard.tsx** — Stitch-designed, Codex-implemented. Coverage ring, drift alerts, discrepancies, critical path, timeline.

## Python Tools
- **compute_threat_delta.py** — Re-evaluates evidence cases, compares old vs new verdict, stores deltas. CLI: `--control-ids ID1,ID2` or `--all-recent`.
- **discrepancy_analysis.py** — Cross-references Requirement vs Table chunks per control via scillm. Stores findings with severity.

## Pipeline Integration
- **learn-datalake post-hook** — `_run_threat_delta_check()` calls compute_threat_delta.py after each ingestion cycle.
- **Evidence case storage** — Dedicated `evidence_cases` collection (moved from lessons). Uses `/upsert` with deterministic `_key` hashing.
- **Edge backfill** — `memory/scripts/backfill_chunk_control_edges.py` created 361K chunk + 84K requirement edges from 2.5M datalake chunks.

## Design Pipeline Used
```
Existing viewer screenshot → Design brief → Gemini (HTML mockup) → Implementation spec
  → Codex 5.3 via scillm (React) → Gemini review → Codex fix → tsc verify
```

## Known Issues
- **PostureDashboard 60 controls / 0% tactics** — Codex fix for totalTechniques + control_ids applied but not visually confirmed
- **ReasoningBlock not visually tested with live evidence case data** — compiles, wired, but no one has typed a question and watched it render
- **code-runner Codex exec modified random files** — EmbryTerminalView.tsx and shared-chat/index.ts may have unintended changes from `codex exec --full-auto`
- **Embedding service** — Falls back to BM25-only when down. Multimodal embedding (Qwen3-VL) parked due to Ollama segfault.

## What's Left
1. **Visual QA**: Type a question in SPARTA Explorer chat, watch ReasoningBlock render with real gate data
2. **Synthetic drift test docs**: /dogpile research done (5 scenarios), need /pdf-lab to generate before/after PDFs
3. **Reasoning block as shared chat capability**: Currently wired in ChatWell but only SPARTA Explorer's ChatTab populates evidenceCase. Needs to work in Embry Terminal and Binary Explorer too.
4. **T0.5 classifiers**: Blocked on sufficient labeled data in evidence_cases (need ~200/class)
5. **Brave URL auto-download**: /dogpile found URLs but enrichment step needed to parse and fetch them into datalake

# Evidence Case Lab — Design Brief for Stitch

## Device
Desktop (1920x1080 minimum)

## Who
**Brandon Bailey** — SPARTA cybersecurity analyst. Uses this to test evidence cases, detect posture drift, and stress-test the pipeline.

## What
A new project in UX Lab with 3 modes: Evaluate (run evidence cases), Drift (detect verdict changes), Stress Test (adversarial pipeline testing).

## Design System
Same NVIS MIL-STD-3009 dark theme as SPARTA Explorer:
- Background: #141414 (bg), #1a1a1a (cards), #0b1220 (deep)
- Border: rgba(255, 255, 255, 0.13)
- Accent: #7c3aed (purple)
- Green: #00ff88 (satisfied/pass), Amber: #ffaa00 (inconclusive/warning), Red: #ff4444 (not satisfied/fail)
- Text: #e2e8f0 (primary), #64748b (secondary), #334155 (muted)
- Font: System monospace for IDs/metrics, system sans for prose
- Lucide icons (NOT Material Symbols)

## Layout
Chat pane (left, 320px resizable) + Workspace (right, flex). Mode tabs in workspace header.

## Screen 1: Evaluate Mode
- Chat: question input, submit runs /create-evidence-case
- Workspace: GateChain (vertical gate timeline with pass/fail dots), RecallCard (collapsed scores), verdict badge (large), source chunk list grouped by asset_type
- Batch panel: dropdown to select question bank, Run All button, progress bar
- Results grid below: question | verdict | grade | gates_passed/total | tier

## Screen 2: Drift Mode
- Chat: control ID input or "Run All" button
- Workspace: Two-column comparison
  - Left column: "Previous" — GateChain from stored evidence case, verdict badge, timestamp
  - Right column: "Current" — GateChain from fresh re-evaluation, verdict badge, timestamp
  - Gate diff: gates that flipped show red highlight (was PASS now FAIL) or green highlight (was FAIL now PASS)
- Below comparison: "Affected Requirements" list — all evidence cases sharing the same control_ids
- Fan-out panel: related techniques via sparta_relationships edges

## Screen 3: Stress Test Mode
- Chat: select question bank from dropdown, Run button
- Workspace header: accuracy bar (green fill), total/correct/wrong counts
- Results grid: question | expected_verdict | actual_verdict | correct? (checkmark/x) | gate_failed | expand to see detail
- Bottom: confusion matrix heatmap (3x3: satisfied/inconclusive/not_satisfied predicted vs actual)
- Accuracy breakdown: real_accuracy %, adversarial_accuracy %, overall %

## Data
- 55 verdict cases, 5 discrepancies, 1 drift alert, 216 SPARTA techniques
- 9 tactics: REC, RD, IA, EX, PER, DE, LM, EXF, IMP
- Endpoints: /api/evidence-case/run, /api/evidence-case/trace, /api/evidence-case/drift, /api/evidence-case/stress-test, /api/memory/list

## Interactions
- Click verdict badge in Evaluate → expands gate detail
- Click control ID in Drift → navigates to SPARTA Explorer matrix cell
- Click row in Stress Test grid → expands to show full gate trace
- Refresh button in header re-runs current mode

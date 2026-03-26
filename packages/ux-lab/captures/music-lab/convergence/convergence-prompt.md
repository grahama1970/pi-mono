# ConvergenceChart Design Convergence — Steve ↔ Nico Dialog

You are running a **design convergence loop** between two personas for a **ConvergenceChart** component. Alternate between them until convergence.

## Personas

### Steve Schoger (Designer)
Pragmatic visual designer. Dark-theme-first on `#0b1220`. Prioritizes data density and hierarchy over decoration. Color is functional. Speaks in first person about WHY choices work.

**EMBRY Design Tokens**: bg deep `#0b1220`, card `#1a1a1a`, NVIS green `#00ff88`, red `#ff4444`, amber `#ffaa00`, blue `#4a9eff`, accent `#7c3aed`. Text white `#e2e8f0`, dim `#64748b`. Border `rgba(255,255,255,0.13)`, radius 12px.

### Nico Bailon (UX Critic)
Evaluates: interaction feasibility, data density, NVIS compliance, component API shape, accessibility. Structured findings with severity/category/description/suggestion.

## Convergence Criteria
- **PASS**: 0 HIGH, ≤1 MEDIUM. Max 4 rounds.

## Component: ConvergenceChart

**Purpose**: Multi-line chart showing how the delta score between the piano-roll specification and the actual generated audio improves across nightly convergence rounds.

**Key Features**:
- X-axis: round number (1-N). Y-axis: delta score (0.0=perfect, 1.0=worst)
- Per-dimension lines: tempo_delta, key_match, chord_accuracy, dynamics_rmse, timing_drift_ms
- Aggregate line (weighted sum) — thicker, more prominent
- Convergence threshold shown as horizontal dashed line (e.g. 0.3)
- Round markers on each line (dots at data points)
- Hover tooltips showing exact values per dimension per round
- Visual distinction between "converged" (below threshold) and "not yet" (above)
- Color code: use EMBRY NVIS colors. Aggregate=white, tempo=green, key=blue, chord=amber, dynamics=red, timing=accent purple

**Data Source**: `loop_results.json` from `/music-lab converge` output:
```json
[
  {"round": 1, "tempo_delta": 0.8, "key_match": 0.0, "chord_accuracy": 0.6, "dynamics_rmse": 0.7, "timing_drift_ms": 45, "aggregate": 0.65},
  {"round": 2, "tempo_delta": 0.3, "key_match": 0.0, "chord_accuracy": 0.4, "dynamics_rmse": 0.5, "timing_drift_ms": 30, "aggregate": 0.38},
  {"round": 3, "tempo_delta": 0.1, "key_match": 0.0, "chord_accuracy": 0.2, "dynamics_rmse": 0.3, "timing_drift_ms": 15, "aggregate": 0.22}
]
```

**Musical Context**: Shows improvement trajectory of Horus "Whisperheads" across nightly convergence runs.

## Your Task

Execute Steve ↔ Nico loop starting at R1.

### Each Round:
**Steve**: Write complete standalone HTML/CSS/SVG (640x400px) → `/home/node/workspace/packages/ux-lab/captures/music-lab/convergence/mockup-r{N}.html` + rationale → `steve-rationale-r{N}.md`

**Nico**: Review → `/home/node/workspace/packages/ux-lab/captures/music-lab/convergence/nico-critique-r{N}.json` + `nico-critique-r{N}.md`

**Converge**: If 0 HIGH ≤1 MED → `approval.json`. Else next round.

After: write `design-dialog.json`.

## Important
- Complete standalone HTML each round
- EMBRY dark theme tokens
- Should feel like it belongs in the Music Lab dashboard alongside piano roll and waveform
- This is a SMALL component (640x400) — keep it focused and clean

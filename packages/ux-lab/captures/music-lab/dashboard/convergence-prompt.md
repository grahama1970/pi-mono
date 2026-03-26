# MusicLabDashboard Design Convergence — Steve ↔ Nico Dialog

You are running a **design convergence loop** between two personas for the **MusicLabDashboard** — the full layout composing all 4 panes.

## Personas

### Steve Schoger (Designer)
Pragmatic visual designer. Dark-theme-first on `#0b1220`. Data density, hierarchy, functional color. First-person rationale.

**EMBRY Design Tokens**: bg deep `#0b1220`, card `#1a1a1a`, NVIS green `#00ff88`, red `#ff4444`, amber `#ffaa00`, blue `#4a9eff`, accent `#7c3aed`. Text white `#e2e8f0`, dim `#64748b`. Border `rgba(255,255,255,0.13)`, radius 12px.

### Nico Bailon (UX Critic)
Evaluates: interaction feasibility, data density, NVIS compliance, component API shape, accessibility. Structured findings.

## Convergence Criteria
- **PASS**: 0 HIGH, ≤1 MEDIUM. Max 4 rounds.

## Component: MusicLabDashboard

**Purpose**: Full-page dashboard layout composing all 4 Music Lab panes into a unified view. This is what Graham sees when he opens Music Lab.

**Layout** (from the task plan):
- **Top**: PianoRollView (full width, ~40% height) — the centerpiece
- **Middle**: WaveformView (full width, ~25% height) — audio alignment
- **Bottom-left**: ConvergenceChart (~50% width, ~35% height) — delta trajectory
- **Bottom-right**: LyricsEditor (~50% width, ~35% height) — annotation

**Key Features**:
- Song metadata header: title, key, BPM, current round, convergence status
- Status indicator: converging (amber), converged (green), failed (red)
- Round selector: dropdown or pill buttons to switch between convergence rounds
- Responsive within a minimum 1440px viewport
- Shared timeline: piano roll, waveform, and lyrics editor share the same horizontal time axis
- Pane borders using EMBRY border token
- Each pane has a small header label (PIANO ROLL, WAVEFORM, CONVERGENCE, LYRICS)

**Context**: The dashboard is the primary view in ux-lab for the music-lab feature. The individual pane designs already exist — this is about how they compose together.

**Musical Context**: Horus "Whisperheads" — D minor, 85 BPM, 8 bars.

## Your Task

Execute Steve ↔ Nico loop starting at R1.

### Each Round:
**Steve**: Write complete standalone HTML/CSS (1440x900px) showing the LAYOUT with placeholder content for each pane (simplified versions of each component, not full implementations). Focus on spacing, proportions, header, status indicators, and visual hierarchy. → `/home/node/workspace/packages/ux-lab/captures/music-lab/dashboard/mockup-r{N}.html` + rationale → `steve-rationale-r{N}.md`

**Nico**: Review layout composition, spacing, visual hierarchy, responsive behavior, status indicators → `/home/node/workspace/packages/ux-lab/captures/music-lab/dashboard/nico-critique-r{N}.json` + `nico-critique-r{N}.md`

**Converge**: If 0 HIGH ≤1 MED → `approval.json`. Else next round.

After: write `design-dialog.json`.

## Important
- Complete standalone HTML each round
- EMBRY dark theme tokens
- Focus on LAYOUT and COMPOSITION, not detailed pane internals
- Each pane should be represented by a simplified placeholder showing its purpose
- The dashboard should look cohesive — like one product, not four separate tools glued together
- Shared timeline alignment between top 3 panes is critical

# WaveformView Design Convergence — Steve ↔ Nico Dialog

You are running a **design convergence loop** between two personas for a **WaveformView** component. Alternate between them until convergence.

## Personas

### Steve Schoger (Designer)
Pragmatic visual designer. Dark-theme-first on `#0b1220`. Prioritizes data density and hierarchy over decoration. Color is functional. Speaks in first person about WHY choices work, referencing specific pixels/colors/spacing.

**EMBRY Design Tokens**: bg deep `#0b1220`, card `#1a1a1a`, NVIS green `#00ff88`, red `#ff4444`, amber `#ffaa00`, blue `#4a9eff`, accent `#7c3aed`. Text white `#e2e8f0`, dim `#64748b`. Border `rgba(255,255,255,0.13)`, radius 12px.

### Nico Bailon (UX Critic)
Evaluates: interaction feasibility, data density, NVIS compliance, component API shape, accessibility (WCAG). Structured findings: severity (HIGH/MEDIUM/LOW), category, description, suggestion. Thorough but fair.

## Convergence Criteria
- **PASS**: 0 HIGH findings AND ≤1 MEDIUM finding
- Maximum 4 rounds. If not converged by round 4, save state and flag for human review.

## Component: WaveformView

This is a waveform visualization for the Music Lab dashboard showing audio analysis results.

**Purpose**: Display the audio waveform of a generated song with overlaid alignment markers showing where the actual audio drifts from the piano-roll specification.

**Key Features**:
- Audio waveform peaks (pre-computed JSON, not raw audio in browser)
- Beat position overlay: expected beats (from piano-roll-spec) vs actual beats (from /review-music MIR analysis)
- Drift highlights: regions where timing differs by >50ms shown in red/amber
- Lyrics alignment: word boundaries overlaid on waveform showing where vocals land
- Stem isolation toggles: show/hide vocal, drums, bass, instrument waveforms independently
- Section markers (Intro/Verse/Chorus) matching the piano roll view

**Data Sources**:
- `peaks.json` — pre-computed waveform amplitude data (array of floats, one per pixel column)
- `piano-roll-spec.json` — expected beat positions, section boundaries
- `/review-music` output — actual detected beats, key, BPM, chord timing
- `annotated-lyrics.json` — word boundaries with timestamps

**Musical Context**: Horus "Whisperheads" — D minor, 85 BPM, 8 bars. Same song as the piano roll.

**Instrument Colors** (same as piano roll): vocal=#7c3aed, bass=#4a9eff, drums=#ff4444, keys=#00ff88, synth=#ffaa00, guitar=#ff6b6b

## Your Task

Execute the Steve ↔ Nico convergence loop starting at Round 1 (R1).

### Each Round:

**Step 1 — Steve Designs**
1. Write a **complete standalone HTML/CSS/SVG mockup** (1280x400px, no external deps, EMBRY tokens)
2. Save to: `/home/node/workspace/packages/ux-lab/captures/music-lab/waveform/mockup-r{N}.html`
3. Write first-person rationale to: `/home/node/workspace/packages/ux-lab/captures/music-lab/waveform/steve-rationale-r{N}.md`

**Step 2 — Nico Reviews**
1. Analyze the HTML structure, CSS values, SVG elements
2. Produce structured critique with severity/category/description/suggestion
3. Save JSON to: `/home/node/workspace/packages/ux-lab/captures/music-lab/waveform/nico-critique-r{N}.json`
4. Save markdown to: `/home/node/workspace/packages/ux-lab/captures/music-lab/waveform/nico-critique-r{N}.md`

**Step 3 — Check Convergence**
- If 0 HIGH and ≤1 MEDIUM: write `/home/node/workspace/packages/ux-lab/captures/music-lab/waveform/approval.json`
- Otherwise: proceed to next round

### After convergence, write dialog transcript to:
`/home/node/workspace/packages/ux-lab/captures/music-lab/waveform/design-dialog.json`

## Important
- Complete standalone HTML files each round (not diffs)
- Use EMBRY design tokens throughout
- Write ALL files to the paths specified
- The waveform should feel like it belongs next to the piano roll view in a dashboard

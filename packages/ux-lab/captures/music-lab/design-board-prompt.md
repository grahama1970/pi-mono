# Generate DESIGN_BOARD.md for Music Lab

You must generate a comprehensive DESIGN_BOARD.md following the exemplar format at `/home/node/workspace/design/DESIGN_BOARD.md` in the pdf_oxide project (read `/home/graham/workspace/experiments/pdf_oxide/design/DESIGN_BOARD.md` for the template — it's accessible via the host mount).

## What to produce

Write a single comprehensive `DESIGN_BOARD.md` at:
`/home/node/workspace/packages/ux-lab/captures/music-lab/DESIGN_BOARD.md`

## Required format (per the pdf_oxide exemplar)

1. **Header**: Project name, date, persona (Steve Schoger + Nico Bailon), theme (NVIS MIL-STD-3009), round status, architecture notes
2. **Persona Assessment**: Who is Steve Schoger? Who is Nico Bailon? Their roles, design philosophy, working relationship
3. **Color Palette table**: EMBRY NVIS tokens with swatches (bg #0b1220, card #1a1a1a, NVIS green/red/amber/blue/accent, text white/dim/muted, border)
4. **Instrument Color table**: vocal=#7c3aed, bass=#4a9eff, drums=#ff4444, keys=#00ff88, synth=#ffaa00, guitar=#ff6b6b
5. **Persona Dialogue Protocol**: Explain that dialogs are live conversations, the human can interject, corrections become canon
6. **For EACH of the 5 panes** (piano-roll, waveform, convergence, lyrics-editor, dashboard):
   - Composite image: `![Rounds](pane-name/composite.png)`
   - **Inline Steve/Nico dialog** per round — Steve speaks in first person about WHY he made each choice, Nico responds with structured critique. This is NOT a summary — it's the actual dialog from the rationale and critique files, presented as a conversation.
   - Collapsible `<details><summary>Spec</summary>` sections with exact pixel dimensions, colors, hover states, keyboard shortcuts, component API shape
   - Convergence status: which round approved, what findings remain
   - Final approved mockup image

## Source files to read

For each pane directory under `/home/node/workspace/packages/ux-lab/captures/music-lab/{pane}/`:
- `steve-rationale-r1.md`, `steve-rationale-r2.md`, etc.
- `nico-critique-r1.md`, `nico-critique-r2.md`, etc.
- `nico-critique-r1.json`, `nico-critique-r2.json`, etc. (for structured findings)
- `approval.json`
- `design-dialog.json`
- `mockup-r*.png` and `composite.png`

The panes are: piano-roll, waveform, convergence, lyrics-editor, dashboard

## Critical rules

- The dialog must read like a CONVERSATION between Steve and Nico, not a summary
- Steve speaks in first person: "I went with 280px for the queue panel because..."
- Nico responds directly to Steve's choices: "The 280px width works, but the hover state needs..."
- Include the resolution dialog — when Steve addresses Nico's HIGH findings in the next round, show Steve explaining his fix and Nico confirming it's resolved
- Pixel-level specs in collapsible sections (exact widths, heights, colors, hover states)
- The board IS the design document — a coding agent should be able to implement from this alone

## Musical context

Song: Horus "Whisperheads" | D minor, 85 BPM, 8 bars
6 instruments with color coding (see above)
This is a DAW-style music production dashboard for iterative AI music generation

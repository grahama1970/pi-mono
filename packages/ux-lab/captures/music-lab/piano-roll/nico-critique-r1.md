# PianoRollView Design Critique - Round 1

**Reviewer**: Nico Bailon (via /subagent-service, embry-subagent-ux-review)
**Date**: 2026-03-15
**Source**: `packages/ux-lab/captures/music-lab/piano-roll.png`
**Backend**: Claude/Sonnet | Duration: 148s | Cost: $0.21
**Verdict**: NOT APPROVED -- 4 HIGH blockers must be resolved before implementation

---

## HIGH (Blocks Implementation)

### 1. Note Interaction Targets Too Small
Drum hit notes render at ~4-6px tall -- far below WCAG 44x44px touch minimum or even 10-12px desktop minimum. Notes are effectively non-interactive at this scale.

**Fix**: Enforce minimum 10px note height. Drums should use a dedicated percussive lane with fixed larger targets. Add compact vs. edit view toggle.

### 2. No Playhead Indicator
No vertical playhead line exists. Without it, click-to-play has no visual anchor, and the `playheadPosition` prop cannot be communicated.

**Fix**: Add a 1-2px vertical playhead line (#f8fafc or accent amber) as an absolutely-positioned overlay element that animates via CSS/RAF without re-rendering notes.

### 3. Color-Only Instrument Differentiation (WCAG 1.4.1 Failure)
All 6 instruments distinguished by color alone. VOCAL (purple) and BASS (blue) collapse for deuteranopes (~8% males). DRUMS (red) and GUITAR (pink) collapse under protanopia.

**Fix**: Add fill patterns per instrument (hatch, dots, solid). Use shape variants in legend (circle, square, diamond). Add `data-instrument` attribute for CSS high-contrast overrides.

### 4. No Zoom/Windowing for Scalability
At 64 bars, each bar compresses to ~13.5px. Sub-beat notes become 1-2px wide -- invisible and unclickable. No scroll or zoom mechanism exists.

**Fix**: Add `viewport: { startBar, endBar }` and `zoom: number` props. Render only visible window. Add DAW-style minimap/overview strip for navigation.

---

## MEDIUM (Should Fix)

### 5. Wasted Pitch Range
Pitch axis spans A#1-E5 (~4 octaves) but content sits between E2-E5. Bottom octave wastes ~20% of vertical space. Song spec calls for C3-C5.

**Fix**: Default `pitchRange` to [C3, C5] with auto-expand. Expose as prop.

### 6. Non-Musical Pitch Labeling
Only E and A# rows labeled (every ~5 semitones). Users think in C, D, E, F, G, A, B.

**Fix**: Label all natural notes. Highlight tonic (D) with background tint. Use #64748b dim token for non-tonic labels.

### 7. Component API Needs Selection/Playback Split
Single `onNoteClick` conflates selection and audition. Breaks controlled-component contract.

**Fix**: Separate into `onNoteClick`, `onSelectionChange`, `selectedNoteIds`, `onNoteDrag`, `onPlayheadSeek`. Full recommended TypeScript interface provided in JSON.

### 8. NVIS Token Audit Needed
Canvas background reads ~#1e2540, slightly brighter than spec'd #0b1220. May not map to correct EMBRY surface token.

**Fix**: Verify canvas bg uses EMBRY surface/card token, not hardcoded hex.

### 9. No Hover States
No hover feedback designed. Users cannot tell which notes are interactive or where drag handles are.

**Fix**: Define hover: brighten to ~90% opacity, cursor=grab, edge handles (4px) with resize-x cursor.

---

## LOW (Nice-to-Have)

### 10. Label Collision at Section Boundaries
Bar numbers, section labels, and chord annotations overlap at bar 5 boundary.

**Fix**: Stagger into three distinct vertical bands.

### 11. Uniform Grid Line Weight
All bar lines have equal visual weight. Hard to count bars at a glance.

**Fix**: Three weights: beat subdivisions (10% opacity), bar lines (25%), 4-bar phrases (45%).

### 12. Small Legend Swatches
Legend color dots are ~8px. Hard to associate with note colors at high DPI.

**Fix**: Increase to 12x12px minimum. Add instrument abbreviations on notes at zoom levels where they fit.

---

## Recommended Component API

```ts
interface PianoRollViewProps {
  notes: NoteEvent[];
  sections: SectionMarker[];
  chords: ChordAnnotation[];
  bpm: number;
  totalBars: number;
  pitchRange?: [MidiNote, MidiNote];
  viewport?: { startBar: number; endBar: number };
  zoom?: number;
  playheadPosition?: number;
  selectedNoteIds?: string[];
  onNoteClick?: (noteId: string, e: React.MouseEvent) => void;
  onSelectionChange?: (ids: string[]) => void;
  onNoteDrag?: (noteId: string, deltaBars: number, deltaPitch: number) => void;
  onPlayheadSeek?: (bar: number) => void;
  instruments?: InstrumentConfig[];
}
```

---

## Next Steps

1. Address all 4 HIGH items in a design revision (R2)
2. Resubmit updated mockup for `/subagent-service` review
3. Only begin component implementation after R2 approval

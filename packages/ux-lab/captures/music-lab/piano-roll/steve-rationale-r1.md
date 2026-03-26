# Steve Schoger — Design Rationale: Piano Roll R1

## Overview

This is my first pass at a piano roll view for Music Lab. The goal: make it look like something you'd see in Ableton or Logic, not a weekend hackathon project. Every decision here is in service of one question — can Graham glance at this and immediately understand the arrangement of "Whisperheads"?

## Grid & Layout

I went with a 1248px playable SVG area inside a 1280px viewport, giving 16px padding on each side. The pitch gutter is a tight 44px on the left — just enough for octave labels (C3, F3, C4, F4, C5) without eating into the note area. The vertical space is 280px for 24 semitones (C3 to C5), which gives each pitch lane about 11.7px. That's tight but readable — notes are 10px tall with a 1.7px gap, which prevents visual bleed between adjacent pitches.

I chose to label every perfect fourth (C and F) rather than every note name. Labeling all 24 pitches would be visual noise. A composer working at this zoom level thinks in octave landmarks, not individual note names. If they need note-level precision, that's what hover tooltips are for in the interactive version.

## Section Bands

The colored section bands (Intro=muted gray, Verse=blue tint, Chorus=purple tint) use vertical linear gradients that fade from ~15% opacity at the top to ~3% at the bottom. This creates a subtle "wash" that groups bars visually without competing with the note rectangles. The gradients are intentionally weak — if I made them stronger, they'd interfere with the instrument color coding. The eye should read sections unconsciously, not consciously.

I placed section labels ("INTRO", "VERSE", "CHORUS") at the very top of the SVG in the same 10px uppercase tracking style as the header. They anchor the composition structure without demanding attention.

## Chord Labels

Chords sit just below the section labels at y=26. I set them at opacity 0.5 in the main text color (#e2e8f0) — present but subordinate. A composer needs chords for harmonic context, but they shouldn't compete with the visual weight of the notes themselves. The chords are the "why" behind the notes; the notes are the "what."

## Note Rendering

Each note is a rounded rectangle (rx/ry=2) with width proportional to duration and color mapped to instrument. The 2px border radius is small enough to read as a data element, not a button. Larger radii would make notes look like UI components rather than musical events.

Velocity maps to opacity on a 0.25-1.0 range. I deliberately avoided using height or brightness for velocity — opacity preserves the instrument color while communicating dynamics. Ghost notes (low velocity hi-hats, pad sustains) naturally recede. Accented notes (chorus vocal peaks, kick drums) pop forward. This mirrors how a DAW like Ableton renders velocity — it's a learned convention that composers will recognize instantly.

## Instrument Color Palette

The six instrument colors were given to me in the design tokens, and they work well for this purpose. Purple (vocal) and blue (bass) are cool tones that sit comfortably as sustained horizontal bars. Red (drums) is high-energy and reads well as short percussive hits. Green (keys) is harmonically neutral — it doesn't draw attention away from melody (purple) or rhythm (red). Amber (synth) is warm and atmospheric, appropriate for pad elements that fill space. Coral (guitar) is close enough to red to feel rhythmic but distinct enough to separate from drums.

The legend at the bottom uses 6px dots — small enough to not feel like a separate UI section, but scannable. I kept it centered with 20px gaps between items, which gives it a dashboard-footer feel.

## Beat Grid

Bar lines are solid at the token border opacity (rgba 255,255,255,0.13). Beat subdivisions are dotted at 0.05 opacity — barely visible but present. This creates a visual rhythm: strong lines every 150.5px (bars), ghosted lines every 37.6px (beats). The eye groups notes into bars without conscious effort.

I did NOT add sixteenth-note subdivisions. At this zoom level (1204px / 32 beats = ~37px per beat), sixteenth lines would be 9px apart — too dense, and they'd create a visual texture that competes with the notes.

## Header

The "PIANO ROLL" label uses the standard NVIS token treatment: 10px, uppercase, 0.15em tracking, #64748b. The key (D min) and BPM (85 BPM) badges use colored pill backgrounds — purple for key, green for BPM. These are high-value metadata that a composer checks constantly, so they deserve visual distinction without being loud.

The song title ("Horus — Whisperheads") sits right-aligned at reduced opacity. It's context, not a call to action.

## What I'd Change in R2

1. **Playhead**: A vertical line with a time indicator. Right now this is a static view — the playhead would make it feel alive.
2. **Velocity lane**: A separate mini-panel below the roll showing velocity as vertical bars per note. The opacity encoding works but a dedicated lane would be more precise.
3. **Note labels on hover**: In the interactive version, hovering a note should show pitch name + velocity + instrument.
4. **Black key shading**: Alternating darker lanes for black keys (C#, D#, F#, G#, A#) would add the "piano keyboard" feel that makes DAW piano rolls instantly recognizable.
5. **Zoom controls**: At 8 bars this works, but a 64-bar arrangement would need horizontal scroll with a minimap.
6. **Note border glow**: A subtle 1px lighter border on notes would improve separation when notes from different instruments overlap at the same pitch.

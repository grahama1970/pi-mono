# Music Lab Pipeline Ingestion (Desktop)

## What This Is

A desktop web application (1920×1080) showing a vertical pipeline for AI music creation. 10 stages flow top-to-bottom. Each stage is a card/well showing its content. The pipeline ingests an emotional thought and produces a finished song.

## Design System

- Dark theme: background #141414, cards #1a1a1a, panels #111111
- Accent purple: #7c3aed
- Status: green #00ff88, red #ff4444, amber #ffaa00, blue #4a9eff
- Text: #e2e8f0 (primary), #64748b (secondary)
- Border: rgba(255,255,255,0.13)
- Cards: 12px border radius, 1px border
- Font: Inter or system sans-serif

## Layout

Full-width desktop. Thin left sidebar (56px) with stage dots as vertical stepper. Main content area (centered, max 900px) with stage cards stacked vertically. Small downward arrows between cards.

## The 10 Stage Cards (show ALL expanded with content)

### S00: The Thought
A quote block with italic text: "I'm remembering the slaughter of my battle brothers at the Whisperheads and the pointlessness of it all"
Below the quote: 3 colored pill badges — anger (red), sadness (blue), fear (red/pink)
Label: "Heart Taxonomy" above the pills
Small text: "Persona: Horus Lupercal"

### S01: Recall Lore
5 quote fragments with left purple border, each with small gray source citation below:
- "The static hums beneath the skin tonight..." (episode_034)
- "Trust was built from the bones of light..." (episode_017)
- "When the towers fell, the frequency scattered..." (episode_042)
- "Joy arrived as the First Frequency..." (episode_008)
- "Sadness lives in the Ash Binding..." (episode_051)
Bottom row: 5 colored tag pills (Fear, Trust, Sadness, Joy, Anger)

### S02: Find Reference Songs
3 horizontal song cards, each with:
- Album art placeholder (40×40 rounded square, gray)
- Song title (bold) + Artist — Album (gray)
- Colored tag pills (emotions)
- Match percentage on the right (green for >85%, amber for <85%)
Songs: Roads/Portishead 92%, Teardrop/Massive Attack 87%, Host of Seraphim/Dead Can Dance 78%

### S03: Learn From Music
5 horizontal bars representing audio stems, each with a colored label and amplitude bar:
- Vocal (purple bar, 70% width)
- Bass (blue bar, 45% width)
- Drums (red bar, 55% width)
- Keys (green bar, 60% width)
- Guitar (amber bar, 30% width)
Below: a gray panel with "Arrangement Notes:" header and 5 bullet points about what each instrument does

### S04: Write + Converge Lyrics
Lyric text with section headers (VERSE 1, CHORUS, BRIDGE) as colored labels on left border:
- Verse = blue left border
- Chorus = purple left border
- Bridge = red left border
Some words underlined in purple (lore references)
Right side of header: round counter "Round 3/5" and "CONVERGING" badge

### S05: Annotate Lyrics
A horizontal strip of syllable boxes. Each box has:
- The syllable text (bold if stressed, gray if not)
- Beat number below (small monospace, e.g., "1.50")
- Hold duration below that (e.g., "+0.50")
Show one phrase: "The sta-tic hums be-neath the skin to-night"

### S06: Compose Arrangement
A simplified piano roll grid:
- Y-axis: pitch labels (C3, D3, E3... up to E5)
- X-axis: bar numbers (1-8)
- Colored rectangles for notes: bass=blue, keys=green, drums=red, vocal=purple
- Below: chord labels (Dm, Am, Bb, Gm | Bb, F, Gm, Dm)
Header: "D minor · 85 BPM · 4/4 · 8 bars"

### S07: Generate Audio
An audio player bar:
- Play button (purple circle with white triangle)
- Waveform visualization (horizontal bars, verse=blue, chorus=purple)
- Time: "0:00 / 2:47"
- Right side: "YuE · Local GPU · 4m 12s"

### S08: Converge Audio
A horizontal bar chart showing 5 rounds:
- R1: long bar (0.82, red)
- R2: medium bar (0.42, amber)
- R3: shorter bar (0.31, amber)
- R4: short bar (0.25, green) ← "converged" badge
- R5: shortest bar (0.18, green)
Dashed green horizontal line at 0.30 threshold
Legend: Tempo, Key, Chords, Dynamics, Timing, Aggregate

### S09: Voice Identity
Two side-by-side cards:
- Left: "Original Vocal" with play button and waveform, "YuE generated"
- Right: "Horus Voice" with green play button and waveform, "RVC v2 · Graham"
Below: "Model: horus-graham-v3.pth · Similarity: 0.89"

## Left Sidebar
Vertical stepper with 10 dots:
- S00-S03: green dots (completed)
- S04: purple pulsing dot (active)
- S05-S09: gray dots (future)
Stage labels (S00, S01, etc.) next to each dot

## Top Bar
"EMBRY OS | Music Lab | / Whisperheads" on left
"● Running — S04" badge (blue) and "Round 1" badge (purple) on right

## What NOT To Do
- Do NOT use a mobile layout — this is 1920×1080 desktop
- Do NOT use bright/white backgrounds
- Do NOT use colors outside the palette listed above
- Do NOT collapse any stages — show ALL 10 expanded with content

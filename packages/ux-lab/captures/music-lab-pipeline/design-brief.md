# Music Lab Pipeline — Design Brief for Steve Schoger

## The Problem
We built a 4-panel technical dashboard (piano roll, waveform, convergence chart, lyrics editor).
Graham rejected it — it doesn't reflect the creative process. The user is Horus composing a song,
not an engineer reading spectrograms.

## The Creative Flow
The UI must mirror how a musician creates:

```
Remember → Listen → Study → Write → Refine → Arrange → Generate → Iterate → Voice
```

Each step flows into the next. The output of one becomes the input of the next.

## Pipeline Stages (each is a "well" / card in the vertical flow)

### S00: Recall Lore
- Memory fragments from ArangoDB — quote cards showing lore text
- Taxonomy tags as colored badges (heart tags: fear, trust, anger, joy, sadness)
- Emotional arc visualization — which emotions appear in what order

### S01: Find Reference Songs
- Song cards with: title, artist, genre tags, HMT bridge attributes
- Mood match score showing why this song matches the lore's emotional arc
- Play button (future — audio preview)

### S02: Learn From Music
- Stem waveform strips: vocal (purple), bass (blue), drums (red), keys (green), guitar (orange)
- Each strip shows the isolated stem's amplitude
- Arrangement notes: "bass drops to half notes during fear sections"

### S03: Write Lyrics
- Raw lyrics in a clean text editor
- Section markers (verse/chorus/bridge) as colored sidebar indicators
- Lore references highlighted — which lines came from which memory fragments

### S04: Converge Lyrics
- The LyricsEditor well with emotion/dynamics/vocal dropdowns
- Review notes from /review-story showing what to fix
- Round counter showing convergence progress

### S05: Annotate Lyrics
- Syllable-level view with beat positions, hold durations, stress marks
- Per-phrase emotion and dynamics as colored bars
- Vocal direction icons (whisper, belt, falsetto, growl)

### S06: Create Piano Roll Spec
- The PianoRollView — SVG grid showing the "sheet music"
- This is the ARRANGEMENT — what instruments play when
- Section labels, chord progressions, energy curves

### S07: Generate Audio
- Audio player with play/pause
- Backend badge (YuE/Sonauto)
- Generation status and timing

### S08: Converge Audio
- ConvergenceChart showing delta scores across rounds
- WaveformView with drift highlights
- Per-round comparison: "round 3 fixed the tempo but chords regressed"

### S09: Apply Voice
- Before/after audio comparison (original vocal vs Horus voice)
- Voice model info (which RVC model, training source)
- Final mix status

## Layout Rules
1. **Vertical flow** — stages stack top to bottom with connector arrows
2. **Active stage expanded** — shows full content well
3. **Completed stages collapsed** — shows summary line + green checkmark
4. **Future stages dimmed** — shows label only, gray
5. **Connector arrows** — thin line with small arrow between stages, accent color for active→next
6. **Scroll follows active** — auto-scroll to the running stage
7. **Pipeline sidebar** — optional thin left rail showing all stage dots (like the current sidebar)

## EMBRY Design Tokens
- Background: #141414 (bg), #1a1a1a (card), #111111 (panel)
- Accent: #7c3aed (purple — active stage)
- Status: #00ff88 (passed), #ff4444 (failed), #ffaa00 (warning), #4a9eff (running)
- Text: #e2e8f0 (primary), #64748b (secondary), #334155 (muted)
- Border: rgba(255,255,255,0.13)
- Cards: 12px radius, 1px border, 20px padding

## Constraints
- Dark theme only (NVIS MIL-STD-3009)
- Must work at 1920x1080 minimum
- The existing components (PianoRollView, WaveformView, ConvergenceChart, LyricsEditor)
  are embedded INSIDE their stage wells — they are not standalone panels
- No horizontal multi-column layout for the pipeline — strictly vertical
- Each well should be self-contained — readable without context from other wells

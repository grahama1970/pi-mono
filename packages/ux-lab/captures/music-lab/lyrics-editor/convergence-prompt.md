# LyricsEditor Design Convergence — Steve ↔ Nico Dialog

You are running a **design convergence loop** between two personas for a **LyricsEditor** component. Alternate between them until convergence.

## Personas

### Steve Schoger (Designer)
Pragmatic visual designer. Dark-theme-first on `#0b1220`. Data density, hierarchy, functional color. First-person rationale.

**EMBRY Design Tokens**: bg deep `#0b1220`, card `#1a1a1a`, NVIS green `#00ff88`, red `#ff4444`, amber `#ffaa00`, blue `#4a9eff`, accent `#7c3aed`. Text white `#e2e8f0`, dim `#64748b`. Border `rgba(255,255,255,0.13)`, radius 12px.

### Nico Bailon (UX Critic)
Evaluates: interaction feasibility, data density, NVIS compliance, component API shape, accessibility. Structured findings.

## Convergence Criteria
- **PASS**: 0 HIGH, ≤1 MEDIUM. Max 4 rounds.

## Component: LyricsEditor

**Purpose**: Editable view of annotated-lyrics.json — phrase-level editing of lyrics with per-syllable timing, emotion, and dynamics annotations.

**Key Features**:
- Phrase blocks displayed as rows (one phrase per line)
- Each syllable within a phrase is a discrete, selectable element
- Per-syllable beat position shown (e.g., "1.0", "1.5", "2.0") — draggable to adjust timing
- Emotion annotation per phrase: dropdown (joy, sadness, anger, neutral, trust, fear)
- Dynamics annotation per syllable: pp, p, mp, mf, f, ff
- Vocal direction tags: whisper, belt, falsetto, growl, spoken
- Section headers (Intro, Verse, Chorus) grouping phrases
- Visual connection to piano roll timeline (shared beat positions)
- Add/remove phrase capability
- The editor should feel like a lyric annotation tool for a music producer, not a text editor

**Data Source**: `annotated-lyrics.json`:
```json
{
  "sections": [
    {
      "name": "Verse 1",
      "start_bar": 1,
      "phrases": [
        {
          "text": "whispers in the static",
          "emotion": "sadness",
          "syllables": [
            {"text": "whis-", "beat": 1.0, "dynamics": "mp", "direction": "whisper"},
            {"text": "pers", "beat": 1.5, "dynamics": "mp", "direction": "whisper"},
            {"text": "in", "beat": 2.0, "dynamics": "p", "direction": "whisper"},
            {"text": "the", "beat": 2.25, "dynamics": "p", "direction": "whisper"},
            {"text": "sta-", "beat": 3.0, "dynamics": "mf", "direction": "whisper"},
            {"text": "tic", "beat": 3.5, "dynamics": "mp", "direction": "whisper"}
          ]
        }
      ]
    }
  ]
}
```

**Musical Context**: Horus "Whisperheads" — D minor, 85 BPM. Lyrics are dark, introspective.

## Your Task

Execute Steve ↔ Nico loop starting at R1.

### Each Round:
**Steve**: Write complete standalone HTML/CSS (640x500px) → `/home/node/workspace/packages/ux-lab/captures/music-lab/lyrics-editor/mockup-r{N}.html` + rationale → `steve-rationale-r{N}.md`

**Nico**: Review → `/home/node/workspace/packages/ux-lab/captures/music-lab/lyrics-editor/nico-critique-r{N}.json` + `nico-critique-r{N}.md`

**Converge**: If 0 HIGH ≤1 MED → `approval.json`. Else next round.

After: write `design-dialog.json`.

## Important
- Complete standalone HTML each round
- EMBRY dark theme tokens
- This is NOT a plain text editor — it's a structured annotation tool
- Syllable-level granularity is the key differentiator
- Should feel musical, not like a spreadsheet

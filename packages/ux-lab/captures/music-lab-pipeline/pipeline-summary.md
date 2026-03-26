# Music Lab Pipeline — Final Architecture

## The Two Inputs to the Model

| Input | Source | What it provides |
|-------|--------|-----------------|
| **Stems** (audio reference) | S03 Learn From Music | Timbre, texture, production style — how it should SOUND |
| **MIDI** (rendered to audio) | S05 Compose Arrangement | Melody, counter-melody, chords, rhythm, bass — what it should PLAY |

Plus: **Lyrics** (what to sing) + **Genre text** (style description compiled from all knowledge)

## 10 Pipeline Stages

| Stage | Name | Output | Human interaction |
|-------|------|--------|-------------------|
| S00 | The Thought | heart tags + entities | Optional — can be auto from /persona-journal |
| S01 | Recall Lore | lore fragments | None — automated recall |
| S02 | Find References | matching songs with BPM/key/genre filters | Optional — review matches |
| S03 | Learn From Music | stem clips (DAW viewer) + arrangement notes | **Yes** — select reference clips per track |
| S04 | Write + Converge + Annotate | annotated-lyrics.json (vocal piano roll) | **Yes** — edit lyrics, click words for phonetic timing |
| S05 | Compose Arrangement | piano-roll-spec.json + arrangement.mid | Optional — review arrangement |
| S06 | Compile Prompt | genre.txt + lyrics.txt + stem refs + MIDI ref | Optional — review compiled prompt |
| S07 | Generate Audio | audio.wav | None — automated |
| S08 | Converge Audio | loop_results.json (self-improving loop) | Optional — adjust convergence threshold |
| S09 | Voice Identity | final_mix.wav with persona voice | Optional — skip if no voice conversion needed |

## Key Insight

The pipeline is a **knowledge-to-audio compiler**:
- S00-S02: Research (lore + references)
- S03: Study (stem separation + analysis)
- S04: Write (lyrics + phonetic annotation)
- S05: Compose (MIDI arrangement around vocal melody)
- S06: Compile (translate everything to model input format)
- S07-S08: Render + converge (generate and iterate)
- S09: Personalize (apply persona voice)

## What Each Model Actually Receives

### YuE (local GPU)
- `--lyrics_txt` (formatted with [Section] markers)
- `--genre_txt` (compiled style description)
- `--vocal_track_prompt_path` (vocal stem reference)
- `--instrumental_track_prompt_path` (instrumental stem reference OR rendered MIDI wav)

### MusicGen (local GPU)
- Text prompt
- Melody conditioning audio (rendered MIDI wav)

### Sonauto (cloud)
- Prompt text + tags + lyrics
- Reference audio URL (for extend/inpaint)

### Suno (cloud)
- Prompt + lyrics + style tags
- Audio snippet upload (stem clip or rendered MIDI wav)
- Persona voice reference
- Inspo reference

## Skills Required

### Existing
- `/memory` (recall), `/taxonomy` (heart tags), `/assistant` (classify)
- `/consume-music` (find references), `/learn-artist` (download)
- `/create-stems` (demucs separation), `/review-music` (MIR analysis)
- `/create-story` (lyrics), `/review-story` (critique)
- `/create-music` (yue, sonauto, musicgen, rvc-infer)
- `/prompt-lab` (all LLM prompts)
- `/music-lab` (convergence loop)

### New (scaffolded, need implementation)
- `/consume-midi` — search MIDI fragment library by key/BPM/mood
- `/create-midi` — compose arrangement + JSON↔MIDI conversion
- `/story-lab` — lyrics convergence loop (scaffold only, needs Python)

### Modified
- `yue_cli.py` — added --vocal-ref, --instrumental-ref, --audio-prompt flags
- `pipeline.py` — needs full rewrite to match 10-stage architecture
- `structured_execute.py` — async orchestrator (already done this session)

## UX (Stitch mockups)
All 10 stages have mockups in Stitch project 6234033554959844801.
Key interactive stages: S03 (DAW-style stem viewer), S04 (lyrics editor with phonetic popover).
Design reference: S03 uses Suno Studio-style colored tracks.

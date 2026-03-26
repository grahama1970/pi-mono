# Music Lab Pipeline — Step Definitions

## S00: The Thought
- **Input**: A raw emotional sentence from the persona (or from /episodic-archiver, /persona-journal, /consume-feed, /converse)
- **Skill**: `/assistant classify --scope heart` → heart tags with confidence scores
- **Skill**: `/extract-entities` → named entities (people, places, events)
- **Output**: `thought.json` {text, heart: [{tag, score}], entities: [string], setting: string}
- **Well shows**: The quote in italic, heart tag pills with confidence bars, entity badges

## S01: Recall Lore
- **Input**: `thought.json` (entities for recall query, heart tags for bridge filtering)
- **Skill**: `/memory recall --scope horus --bridges anger,sadness,fear --query "Whisperheads slaughter brothers"`
- **Skill**: `/taxonomy extract` on each recalled fragment → heart tag per fragment
- **Output**: `lore.json` {fragments: [{text, source, heart_tag}]}
- **Well shows**: Quote cards with purple left border, source citation, per-fragment heart tag

## S02: Find Reference Songs
- **Input**: `thought.json` heart tags + `lore.json` emotional arc
- **Skill**: `/consume-music search --mood anger,sadness,fear --genre atmospheric,dark --limit 5`
- **Output**: `references.json` {songs: [{title, artist, album, year, tags: [], match_score}]}
- **Well shows**: Song cards with album art placeholder, title/artist, tag pills, match %

## S03: Learn From Music (Stem Reference Clips)
- **Input**: `references.json` (which songs to download and separate)
- **Purpose**: Separate reference songs into stems and prepare section-tagged reference clips for audio conditioning. NO model training here — just clip preparation.
- **Skill**: `/learn-artist add "Portishead"` → download from YouTube
- **Skill**: `/create-stems demucs --model htdemucs_6s` → 6 stems per song (vocals, bass, drums, guitar, piano, other)
- **Skill**: `/review-music analyze` per stem → features JSON (BPM, key, energy curve)
- **Skill**: LLM via `/prompt-lab` → natural language arrangement notes from stem features
- **Stem reference clips** (tagged by section):
  - `stems/verse/vocals.wav` — vocal timbre for verse sections
  - `stems/verse/instrumental_mix.wav` — mixed instruments for verse
  - `stems/chorus/vocals.wav` — vocal timbre for chorus
  - `stems/chorus/instrumental_mix.wav` — mixed instruments for chorus
- **Output**: `stems/` directory with per-section clips, `stem_features/`, `arrangement_notes.md`
- **Well shows**: 5 stem waveform bars (colored by instrument), arrangement notes panel, per-section clip status
- **Note**: RVC voice model training moved to S10 — it's only needed for final voice conversion, not generation

## S04: Write + Converge + Annotate Lyrics
- **Input**: `thought.json` + `lore.json` + `references.json` + `arrangement_notes.md`
- **Skill**: `/create-story write --format song-lyrics` → raw lyrics grounded in lore
- **Skill**: `/story-lab converge` (or manual loop: /create-story → /review-story → fix → repeat)
- **Skill**: `/review-story` checks lore fidelity, emotional arc, voice consistency, rhyme
- **Annotation is INSIDE the lyrics editor** — click a word to see/edit its phonetic breakdown:
  - Syllable timing (beat positions, hold durations)
  - Stress marks (which syllables the performer emphasizes)
  - Pitch hints (optional melody guidance)
- **Emotional emphasis**: key words colored by heart tag (fear=red, sadness=blue, anger=orange)
- **The compiled output IS a vocal piano roll**: phoneme × time, same structure as instrument piano roll
- **Output**: `annotated-lyrics.json` matching annotated-lyrics.schema.json
  - Per-phrase: text, section, bar, beat, duration_beats, emotion, dynamics, vocal_direction
  - Per-syllable: text, beat, hold_beats, stress, pitch_hint
- **Well shows**: Notion-style lyrics with colored emotional emphasis on key words. Click any word → inline phonetic timing editor. Emotion/dynamics/vocal pills per phrase. Convergence round counter.

## S05: Compose Arrangement
- **Input**: `annotated-lyrics.json` (vocal timing) + `arrangement_notes.md` (patterns) + heart tags (dynamics)
- **Skill**: `/consume-midi search --key "D minor" --bpm 85 --instrument bass --mood anger,sadness` → reference MIDI fragments
- **Skill**: `/create-midi compose` → LLM via `/prompt-lab` prompt "music-piano-roll-spec" → full arrangement
- **Skill**: `/create-midi from-spec --spec piano-roll-spec.json --out arrangement.mid` → MIDI file
- **Output**: `piano-roll-spec.json` matching piano-roll-spec.schema.json + `arrangement.mid`
  - sections with chord progressions + energy curves
  - notes per instrument: pitch, start_beat, duration_beats, velocity
- **Well shows**: Piano roll grid (time×pitch, colored notes by instrument), chord labels, bar numbers

## S06: Compile Generation Prompt
- **Input**: ALL prior artifacts (annotated-lyrics.json, piano-roll-spec.json, arrangement.mid, stems analysis, heart tags, genre tags, lore context)
- **Purpose**: Translate structured musical knowledge into the best possible TEXT PROMPT for the target model. Both YuE and Sonauto are text-to-music models — they accept lyrics + tags + text prompts, NOT MIDI or stems directly. The entire pipeline exists to build knowledge that makes this prompt precise instead of vague.
- **What gets compiled to text**:
  - Stems analysis → "deep sustained bass in D minor, sparse kick on 1 and 3, reverbed Rhodes pads, dry intimate vocal in verses"
  - MIDI/arrangement → "85 BPM, 4/4, 8 bars, Dm-Am-Bb-Gm verse progression, Bb-F-Gm-Dm chorus"
  - Heart tags → "melancholic verses building to defiant chorus, grief underlying everything"
  - Lore → "song about lost signals, broken frequencies, finding voice in silence"
  - References → "in the style of Portishead Roads meets Massive Attack Teardrop"
- **Target platform differences** (ALL accept audio references):
  - **YuE**: lyrics.txt + genre.txt + `--vocal-ref stems/verse/vocals.wav` + `--instrumental-ref stems/verse/instrumental_mix.wav` (dual track conditioning)
  - **MusicGen**: text prompt + melody conditioning audio clip (rendered MIDI or stem clip)
  - **Sonauto**: prompt + tags + lyrics + reference audio URL (for extend/inpaint)
  - **Suno**: prompt + tags + lyrics + uploaded audio snippet (stem clip or rendered MIDI)
- **Skill**: LLM via `/prompt-lab` prompt "music-compile-generation-prompt" → takes all artifacts, produces platform-specific text
- **Output**: `generation_prompt/` {lyrics.txt, genre.txt or prompt.txt, tags.json} — pure text, no binary
- **Well shows**: Platform selector, source knowledge summary (what we learned from each stage), the COMPILED TEXT PROMPT preview (this is the actual output), "Send to S08" button
- **This is the most critical stage** — the quality of this prompt determines how many convergence rounds S09 needs

## S07: Generate Audio
- **Input**: Compiled payload from S07 (text prompt + lyrics + audio reference clips)
- **Skill**: `/create-music yue --lyrics lyrics.txt --genre genre.txt --vocal-ref stems/vocals.wav --instrumental-ref stems/instrumental.wav --out audio.wav`
- **Output**: `round_N/audio.wav` (48kHz 16bit)
- **Well shows**: Audio player with play button, waveform preview, backend badge (YuE/Sonauto/Suno), generation time, which reference clips were used

## S08: Converge Audio
- **Input**: `piano-roll-spec.json` (ground truth from S06) + `round_N/audio.wav` (from S07)
- **Skill**: `/review-music analyze --audio audio.wav --out features.json` → MIR features
- **Skill**: `_score_delta(spec, features)` → weighted comparison → aggregate score
- **Skill**: If aggregate > 0.30: `/prompt-lab` re-quantize → recompile (S07) → regenerate (S07)
- **Output**: `loop_results.json` with per-round delta scores, convergence status
- **Well shows**: Horizontal bar chart with rounds, threshold line, per-dimension colors, "converged R4" badge
- **Note**: Convergence loop goes back to S06 (recompile) not just S08, because the prompt adjustments may change what gets sent to the model

## S09: Voice Identity
- **Input**: Best converged audio from S08 + reference vocal stems from S03
- **Step 1**: Train RVC voice model (if not already trained) from reference vocal stems
  - **Skill**: `/learn-artist train --stems stems/vocals.wav --model-name horus-graham-v3`
  - This is where model training happens — NOT in S03
- **Step 2**: Separate vocals from generated audio
  - **Skill**: `/create-stems demucs --audio best_audio.wav --out final_stems/`
- **Step 3**: Apply persona voice
  - **Skill**: `/create-music rvc-infer --audio final_stems/vocals.wav --model horus-graham-v3.pth --out final_vocals.wav`
- **Step 4**: Remix + quality check
  - Remix: final_vocals.wav + instrumental stems → final_mix.wav
  - **Skill**: `/review-music analyze --audio final_mix.wav` → quality check
- **Output**: `final_mix.wav`, `final_vocals.wav`, `horus-graham-v3.pth` (voice model)
- **Well shows**: RVC training status (if training), before/after audio comparison, model info, similarity score

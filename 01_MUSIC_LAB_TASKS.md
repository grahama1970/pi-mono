# Music Lab — Comprehensive Plan

> Self-improving music creation pipeline with local-first nightly iteration,
> piano roll ground truth, persona-driven convergence, and collaborative UI.
>
> **Driving test case**: Horus "Whisperheads" single — lyrics from lore, voice via RVC,
> nightly iterations until convergence.
>
> **NON-NEGOTIABLE**: `/music-lab` is a **composer of existing skills**. It contains
> ONE Python file (`converge.py`) that is pure orchestration glue — subprocess calls
> to existing `run.sh` entry points. No bespoke audio processing, no bespoke MIR,
> no bespoke LLM calls. If a capability doesn't exist as a skill, build it AS a skill
> (or extend an existing one), then compose it.

## Capability Overlap

### `/memory recall` results
- Prior convergence loop patterns recalled from `paper-lab`, `conversation-lab`, `evidence-case-lab`, `pdf-lab` — all follow the same 3-phase architecture (Plan → Headless Convergence → Human Resolution)
- Prior music generation work recalled: `create-music` (MusicGen, RVC, Sonauto integration), `create-stems` (Demucs), `review-music` (MIR analysis)
- Prior lore pipeline: `create-story` → `review-story` chain exists; `story-lab` created this session to close the convergence gap

### `skills-manifest.json` scan
Checked: create-music, review-music, create-stems, create-story, review-story, story-lab, paper-lab, prompt-lab, create-design-board, review-design, test-interactions, subagent-service, task-monitor, memory, scheduler, consume-music, learn-artist, learn-voice, dogpile, taxonomy, create-score, hum

### Decision matrix

| Capability | Disposition | Skill | Justification |
|-----------|-------------|-------|---------------|
| Audio generation (YuE) | **EXTEND** | `/create-music` | Add `yue` backend + Docker container to existing skill |
| Audio generation (Sonauto) | **CALL** | `/create-music` | Already integrated (`sonauto.py`) |
| Audio generation (MusicGen) | **CALL** | `/create-music` | Already exists as `musicgen` backend |
| MIR analysis (BPM, key, chords) | **CALL** | `/review-music` | Already exists — convergence signal source |
| Stem separation | **CALL** | `/create-stems` | Already exists (Demucs 4/6-stem) |
| Voice conversion (RVC) | **CALL** | `/create-music rvc-infer` | Already exists |
| MIDI ↔ piano roll conversion | **EXTEND** | `/create-music` | Add `midi-from-spec`/`midi-to-spec` subcommands + `pretty_midi` dep |
| JSON schema validation | **EXTEND** | `/create-music` | Add schemas + `jsonschema` dep |
| Lyrics creation | **CALL** | `/create-story` | Already exists for all Horus formats |
| Lyrics convergence | **CALL** | `/story-lab` | Created this session (spec-only, pending implementation) |
| Lyrics critique | **CALL** | `/review-story` | Already exists (structure, emotion, voice, persona) |
| Lore recall (BM25 + semantic + multi-hop) | **CALL** | `/memory` | Already exists |
| Taxonomy extraction | **CALL** | `/taxonomy` | Already exists (heart/bridge tags) |
| Music taste recall | **CALL** | `/consume-music` | Already exists (HMT-tagged reference songs) |
| Artist vocal style | **CALL** | `/learn-artist` | Already exists (RVC training from YouTube) |
| Deep research | **CALL** | `/dogpile` | Already exists |
| Prompt refinement for generators | **CALL** | `/prompt-lab` | Already exists (wraps scillm HTTP internally) |
| Design mockups | **CALL** | `/create-design-board` | Already exists (Steve Schoger persona) |
| Design critique | **CALL** | `/review-design` | Already exists (Nico Bailon persona) |
| UI interaction testing | **CALL** | `/test-interactions` | Already exists |
| Isolated convergence contexts | **CALL** | `/subagent-service` | Already exists (Docker multi-backend) |
| Progress tracking | **CALL** | `/task-monitor` | Already exists |
| Nightly scheduling | **CALL** | `/scheduler` | Already exists |
| Convergence loop orchestration | **CREATE** | `/music-lab` | **Anti-silo**: No existing skill orchestrates the spec→generate→review→diagnose→fix loop for audio. `paper-lab`/`story-lab`/`pdf-lab` handle text, not audio delta scoring. The ONLY new code is `converge.py` (~150 lines) with `_score_delta()` (~50 lines) — everything else is subprocess calls. |
| React dashboard components | **GLUE** | `ux-lab` | 5 new components in `packages/ux-lab/src/components/music-lab/` — visual wiring of existing data formats |

### Anti-silo justification
Only ONE capability is CREATE: the `/music-lab` convergence loop itself. This is justified because:
1. Audio delta scoring (spec vs MIR features) is domain-specific — text labs can't do it
2. The loop structure (generate audio → analyze → score → re-quantize prompt) has no existing equivalent
3. Total new code: ~200 lines in one file (`converge.py`). Everything else is subprocess calls to 15+ existing skills.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        /music-lab                            │
│  convergence loop: spec → generate → review → diagnose → fix │
├──────────┬──────────┬───────────┬──────────┬────────────────┤
│ /create- │ /review- │ /create-  │ /create- │ /test-         │
│ music    │ music    │ stems     │ design-  │ interactions   │
│ (YuE,    │ (MIR     │ (Demucs)  │ board    │ (UI capture)   │
│ Sonauto, │ analysis,│           │ (Steve)  │                │
│ MusicGen)│ LLM judge│           │          │                │
└──────────┴──────────┴───────────┴──────────┴────────────────┘
         ▲                ▲                        ▲
         │                │                        │
    piano roll spec    alignment delta        ux-lab React
    (ground truth)     (convergence signal)   (music-lab views)
```

## Data Flow

```
annotated_lyrics.json ──► /create-music yue ──► raw_audio.wav
         │                                           │
         │    piano_roll_spec.json ◄─── MIDI IR ─────┤
         │              │                            │
         │              ▼                            ▼
         │    /review-music analyze ──► features.json + delta
         │              │
         │              ▼
         │    agent /assess delta ──► diagnosis.md
         │              │
         │              ▼
         └──── re-quantize spec ──► next iteration
```

---

## Phase 0: YuE Local Deployment (GPU-first)

### T0.1 — Fork YuE-Interface
- [ ] Fork `alisson-anjos/YuE-Interface` to our GitHub
- [ ] Strip Gradio UI entirely (we have our own)
- [ ] Add CLI entrypoint: `python yue_cli.py generate --lyrics FILE --genre TAGS --out FILE`
- [ ] Expose Stage 1 symbolic output (score tokens) as intermediate JSON
- [ ] Wire `--stage1-only` flag to emit symbolic output without diffusion rendering
- **Files**: `docker/yue/yue_cli.py`, `docker/yue/Dockerfile.yue`
- **Gate**: `yue_cli.py generate --lyrics test.txt --genre "rock" --out /dev/null --stage1-only` returns JSON

### T0.2 — Docker Container for YuE
- [ ] Build Docker image based on `alisson-anjos/YuE-Interface` or YuEGP ("GPU Poor" fork)
- [ ] Target: A5000 24GB VRAM, INT8 quantization, <8GB VRAM for base model
- [ ] Mount points: `/input` (lyrics), `/output` (audio + stage1 JSON), `/models` (symlink to 12TB)
- [ ] Add to `run.sh` as `yue` and `yue-build` subcommands (same pattern as `musicgen`)
- **Files**: `.pi/skills/create-music/docker/Dockerfile.yue`, `run.sh` (add yue case)
- **Gate**: `./run.sh yue --lyrics fixtures/test-lyrics.txt --genre "indie rock" --out /tmp/test.wav`

### T0.3 — Wire YuE into run.sh
- [ ] Add `yue`, `yue-build`, `yue-stage1` commands to `run.sh` case statement
- [ ] Docker path conversion (same pattern as musicgen: `--out` → `/output`, etc.)
- [ ] `--gpus all` with model dir mount from 12TB
- [ ] Update SKILL.md triggers to include "yue", "generate song locally"
- **Gate**: `./run.sh yue --help` shows usage; `./run.sh yue-build` builds image

---

## Phase 1: Annotated Lyrics Schema & Piano Roll Spec

### T1.1 — Define Annotated Lyrics JSON Schema
- [ ] Create `schemas/annotated-lyrics.schema.json` in create-music
- [ ] Fields per phrase: `text`, `section` (verse/chorus/bridge/intro/outro), `bar`, `beat`, `duration_beats`
- [ ] Per-syllable array: `syllables[].text`, `.beat`, `.hold_beats`, `.stress` (bool), `.pitch_hint` (optional)
- [ ] Phrase-level metadata: `emotion` (from heart taxonomy), `dynamics` (pp/p/mp/mf/f/ff), `vocal_direction` (whisper/belt/falsetto/growl/speak)
- [ ] Song-level metadata: `title`, `artist`, `bpm`, `time_signature`, `key`, `genre_tags[]`
- [ ] Validate with jsonschema in Python
- **Files**: `.pi/skills/create-music/schemas/annotated-lyrics.schema.json`
- **Gate**: `python -c "import jsonschema; jsonschema.validate(lyrics, schema)"` passes for Whisperheads fixture

### T1.2 — Piano Roll Spec as Ground Truth
- [ ] Create `schemas/piano-roll-spec.schema.json`
- [ ] Per-note: `pitch` (MIDI number or note name), `start_beat`, `duration_beats`, `velocity` (0-127), `instrument` (vocal/guitar/bass/drums/keys/synth)
- [ ] Per-section: `section_name`, `start_bar`, `end_bar`, `chord_progression[]`, `energy_curve` (0.0-1.0 envelope)
- [ ] Global: `bpm`, `time_signature`, `key`, `total_bars`
- [ ] This is the "sheet music" — the agent's ground truth for what the song SHOULD sound like
- **Files**: `.pi/skills/create-music/schemas/piano-roll-spec.schema.json`
- **Gate**: `test-lab/run.sh verify-task 1.2 .pi/skills/create-music/schemas/ --domain music` — blind schema validation with edge cases (empty sections, out-of-range velocity, missing required fields)

### T1.3 — MIDI Planning IR (in /create-music, not /music-lab)
- [ ] Add `midi-from-spec` and `midi-to-spec` subcommands to `/create-music run.sh`
- [ ] Thin Python script in `/create-music`: converts piano-roll-spec.json ↔ MIDI using `pretty_midi`
- [ ] Add `pretty_midi` to `/create-music/pyproject.toml` dependencies
- [ ] MIDI is reference-only — fed to generators for timing/key/chord guidance, NEVER in final output
- [ ] `/music-lab` calls this via subprocess: `create-music/run.sh midi-from-spec --spec X --out Y`
- **Files**: `.pi/skills/create-music/midi_utils.py`, `.pi/skills/create-music/run.sh` (add cases)
- **Gate**: Round-trip test — spec → MIDI → spec produces identical output

### T1.4 — Whisperheads Test Fixture
- [ ] **Horus recalls** Whisperheads lore via `/memory` (BM25 + semantic + multi-hop graph traversal)
- [ ] `/taxonomy` extracts heart/bridge tags from recalled lore — emotional arc for the song
- [ ] `/create-story` → `/story-lab` convergence loop — Horus writes lyrics grounded in recalled lore
  - `/dogpile` for musical influences, lyrical techniques, genre conventions when stuck
  - `/consume-music` to recall HMT-tagged songs from ingested YouTube history (episodic associations)
  - `/learn-artist` + `/learn-voice` for reference artist vocal style and technique
  - `/review-story` critiques each draft for lore fidelity + emotional arc + voice consistency
- [ ] Convert raw lyrics → `fixtures/whisperheads/annotated-lyrics.json` with per-syllable timing
- [ ] Create `fixtures/whisperheads/piano-roll-spec.json` — target arrangement
- [ ] Create `fixtures/whisperheads/reference.md` — song brief (mood, influences, lore connections, target sound)
- [ ] Create `fixtures/whisperheads/lore-recall.json` — snapshot of `/memory` recall results used (provenance)
- **Composes**: `/memory`, `/taxonomy`, `/create-story`
- **Files**: `.pi/skills/create-music/fixtures/whisperheads/`
- **Gate**: Both JSON files validate against schemas; lore-recall.json traces every lyric line to a memory source

---

## Phase 2: /music-lab Convergence Skill

> **DESIGN PRINCIPLE**: `/music-lab` is a thin orchestrator. It shells out to
> existing skills for ALL heavy lifting. The ONLY bespoke code is the convergence
> loop itself (which is just glue) and the delta scoring (spec vs features comparison).
> Everything else is a subprocess call to an existing skill's `run.sh`.

### T2.1 — Scaffold /music-lab Skill
- [ ] Create `.pi/skills/music-lab/SKILL.md` with frontmatter (triggers, composes, provides)
- [ ] `composes: [create-music, review-music, create-stems, create-design-board, test-interactions, task-monitor, memory]`
- [ ] `provides: [music-lab]`
- [ ] `triggers:` — "improve song", "music convergence", "iterate on music", "nightly music loop", "music lab"
- [ ] Create `run.sh`, `pyproject.toml`, `sanity.sh`
- **Files**: `.pi/skills/music-lab/SKILL.md`, `run.sh`, `pyproject.toml`, `sanity.sh`
- **Gate**: `/skills-ci` scan passes with no new errors

### T2.2 — Convergence Loop Core (`converge.py`)
- [ ] Modeled on `packages/ux-lab/improve.py` (same pattern: test → review → parse → converge)
- [ ] Each round shells out to EXISTING skills — no reimplementation:
  1. **Generate**: subprocess → `/create-music run.sh yue` (or `sonauto`) with current spec
  2. **Analyze**: subprocess → `/review-music run.sh analyze` → parses its features.json output
  3. **Score**: compare `/review-music` output against piano-roll-spec.json (this is the only new logic)
  4. **Re-quantize**: subprocess → `/prompt-lab` to iteratively refine generator prompts based on delta (prompt-lab handles the scillm HTTP calls to `localhost:4001` internally — we never call scillm directly)
  5. **Converge check**: delta below threshold → DONE
- [ ] CLI: `./run.sh converge --spec SPEC --lyrics LYRICS --max-rounds N --backend yue|sonauto`
- [ ] All skill calls go through `run.sh` — never import their Python directly
- **Files**: `.pi/skills/music-lab/converge.py` (the ONLY Python file besides CLI glue)
- **Gate**: `test-lab/run.sh verify-task 2.2 .pi/skills/music-lab/ --domain music` — blind test: dry-run with mock spec+features fixtures, verifies RoundResult JSON schema, subprocess call sequence, and convergence threshold logic

### T2.3 — Delta Scoring (inline in converge.py, NOT a separate module)
- [ ] Function `_score_delta(spec_path, features_path) -> dict` — the only truly new code
- [ ] Compares `/review-music` JSON output fields against piano-roll-spec.json fields
- [ ] Returns: `{tempo_delta, key_match, chord_accuracy, dynamics_rmse, timing_drift_ms, aggregate}`
- [ ] Aggregate = weighted sum → single convergence score (0.0 = perfect)
- [ ] ~50 lines of comparison logic, not a separate module
- **Gate**: `test-lab/run.sh verify-task 2.3 .pi/skills/music-lab/ --domain music` — blind test: feeds known spec + known features fixtures, asserts expected delta values (tempo_delta, key_match, aggregate) within tolerance

### T2.4 — Scheduler Integration
- [ ] Add `/music-lab converge` as nightly job in `/scheduler`
- [ ] Config: max 5 rounds per night, results to `/mnt/storage12tb/media/agents/shared/music-lab/`
- [ ] Discord notification on convergence or max-rounds-hit via existing `/notify` or Discord webhook
- [ ] Memory learn: subprocess → `/memory run.sh learn` after each convergence run
- **Files**: `.pi/skills/music-lab/nightly.sh` (bash wrapper calling `run.sh converge`)
- **Gate**: Dry-run nightly script completes without error

---

## Phase 3: Music Lab UI (ux-lab Components)

### T3.1 — Steve + Nico Design Convergence Loop (CRITICAL)
- [ ] Steve Schoger persona designs **each pane individually** via `/create-design-board`:
  1. PianoRollView — horizontal time×pitch grid, instrument color legend, velocity opacity
  2. WaveformView — peaks with beat position overlay, drift highlights, lyrics alignment
  3. ConvergenceChart — multi-line delta trajectory, threshold line, round markers
  4. LyricsEditor — phrase blocks, syllable handles, emotion/dynamics dropdowns
  5. MusicLabDashboard — full layout composition of all 4 panes
- [ ] Each pane: Steve renders HTML/CSS mockup → PNG (NOT diffusion-generated), writes rationale in first person
- [ ] Nico Bailon persona critiques each pane via `/review-design --persona nico-bailon`:
  - Interaction feasibility (can these handles actually be dragged?)
  - Data density (is the piano roll readable at full song scale?)
  - NVIS compliance (dark theme tokens from `EmbryStyle.ts`)
  - Component API shape (what props does this need?)
- [ ] Steve responds to each Nico critique with updated mockup + written response
- [ ] Self-improvement loop: Steve → Nico critique → Steve revision → Nico re-review → converge
- [ ] **Each pane dialog runs in `/subagent-service`** (isolated Docker context per pane):
  - Protects main agent context from multi-turn design conversation bloat
  - Transcript preserved as JSON: `captures/music-lab/{pane}/design-dialog.json`
  - Same pattern as `/evidence-case-viewer` chat well
  - Backend: Claude or Gemini (Steve=designer, Nico=critic — two separate subagent calls per round)
  - **Auto-compaction**: each subagent auto-compacts as dialog grows — keeps latest mockup PNG + current findings in active context, full history in transcript JSON
- [ ] Convergence: Nico reports 0 high-severity, ≤1 medium-severity findings per pane
- [ ] `/create-design-board` tracks all rounds with side-by-side comparison tables
- [ ] Each dialog transcript → `/memory learn` as design lesson (scope: ux-lab)
- [ ] Final output: 5 pane design boards + rationale + Nico's final approval + 5 dialog transcripts
- **Composes**: `/create-design-board`, `/review-design --persona`, `/test-interactions`, `/subagent-service`, `/memory`
- **Files**: `packages/ux-lab/captures/music-lab/{piano-roll,waveform,convergence,lyrics-editor,dashboard}/`
- **Gate**: All 5 pane boards exist with Steve rationale + Nico approval + dialog transcripts. `/review-design` final round has 0 high findings.

### T3.2 — Piano Roll Visualizer Component
- [ ] **PREREQUISITE**: T3.1 Steve design board for this pane must exist with Nico approval
- [ ] React component: `PianoRollView.tsx` in `packages/ux-lab/src/components/music-lab/`
- [ ] Renders piano-roll-spec.json as horizontal time → pitch grid
- [ ] Color-coded by instrument (vocal = accent purple, drums = red, bass = blue, etc.)
- [ ] Velocity shown as opacity
- [ ] Section markers (verse/chorus/bridge) as labeled regions
- [ ] Click-to-play integration (optional, via Web Audio API)
- [ ] **PNG evidence**: headless Chrome screenshot of rendered component → `captures/music-lab/piano-roll/implemented.png`
- **Files**: `packages/ux-lab/src/components/music-lab/PianoRollView.tsx`
- **Gate**: PNG exists, `/review-design --persona nico-bailon` passes with 0 high findings vs Steve's design board PNG

### T3.3 — Waveform + Alignment Overlay Component
- [ ] **PREREQUISITE**: T3.1 Steve design board for this pane must exist with Nico approval
- [ ] React component: `WaveformView.tsx`
- [ ] Renders audio waveform (from pre-computed peaks JSON, not raw audio in browser)
- [ ] Overlay: expected beat positions (from piano-roll-spec) vs actual (from /review-music)
- [ ] Red highlights where timing drift exceeds threshold
- [ ] Lyrics text aligned below waveform at their beat positions
- [ ] **PNG evidence**: headless Chrome screenshot → `captures/music-lab/waveform/implemented.png`
- **Files**: `packages/ux-lab/src/components/music-lab/WaveformView.tsx`
- **Gate**: PNG exists, `/review-design` passes vs design board

### T3.4 — Convergence Trajectory Chart
- [ ] **PREREQUISITE**: T3.1 Steve design board for this pane must exist with Nico approval
- [ ] React component: `ConvergenceChart.tsx`
- [ ] Line chart showing delta score across rounds (same as improve.py's progression table but visual)
- [ ] Per-dimension lines (tempo, key, dynamics, etc.) + aggregate
- [ ] Convergence threshold shown as horizontal dashed line
- [ ] Data source: `loop_results.json` from converge.py output
- [ ] **PNG evidence**: headless Chrome screenshot → `captures/music-lab/convergence/implemented.png`
- **Files**: `packages/ux-lab/src/components/music-lab/ConvergenceChart.tsx`
- **Gate**: PNG exists, `/review-design` passes vs design board

### T3.5 — Lyrics Annotation Editor
- [ ] **PREREQUISITE**: T3.1 Steve design board for this pane must exist with Nico approval
- [ ] React component: `LyricsEditor.tsx`
- [ ] Editable annotated-lyrics.json view — phrase-level editing
- [ ] Per-syllable beat position adjustment (drag to shift timing)
- [ ] Emotion/dynamics dropdown per phrase
- [ ] Vocal direction selector
- [ ] Export to JSON (validated against schema)
- [ ] **PNG evidence**: headless Chrome screenshot → `captures/music-lab/lyrics-editor/implemented.png`
- **Files**: `packages/ux-lab/src/components/music-lab/LyricsEditor.tsx`
- **Gate**: PNG exists, component loads whisperheads fixture, `/review-design` passes vs design board

### T3.6 — Music Lab Dashboard Page
- [ ] **PREREQUISITE**: T3.1 Steve design board for dashboard layout must exist with Nico approval
- [ ] Combine all components into a single dashboard view
- [ ] Layout: piano roll (top), waveform (middle), convergence chart (bottom-left), lyrics editor (bottom-right)
- [ ] Add to ComponentGallery as "Music Lab" folder
- [ ] Wire to `/api/music-lab/` endpoints (status, rounds, current spec)
- [ ] **PNG evidence**: headless Chrome screenshot → `captures/music-lab/dashboard/implemented.png`
- **Files**: `packages/ux-lab/src/components/music-lab/MusicLabDashboard.tsx`
- **Gate**: PNG exists, `/review-design --persona nico-bailon` final pass on full dashboard vs design board

---

## Phase 4: Integration & End-to-End

### T4.1 — End-to-End: Whisperheads Single
- [ ] **Horus recalls Whisperheads lore from `/memory`** — BM25 + semantic + multi-hop graph traversal:
  - `/memory recall` with topic "Whisperheads" — retrieves lore fragments, character arcs, thematic motifs
  - `/taxonomy` bridge extraction — maps lore to emotional dimensions (heart tags: joy/sadness/anger)
  - Multi-hop: lore → related episodes → dream residue → persona journal entries about Whisperheads
- [ ] **`/create-story`** → **`/story-lab`** convergence loop for lyrics:
  - `/create-story`: Horus writes song lyrics grounded in recalled lore (research + iterative drafts)
  - Research: `/dogpile` for influences + `/consume-music` for HMT-tagged reference songs + `/learn-artist` for vocal style
  - `/review-story`: critiques structural arc, emotional authenticity, persona voice, lore fidelity
  - `/story-lab` iterates: create → review → diagnose → fix → re-review → converge
  - Convergence: `/review-story` reports 0 high findings, voice consistency score > 0.8
  - Same pattern as `/paper-lab` (delta tracking, round progression, convergence threshold)
  - Output: converged lyrics markdown with emotional arc annotations
- [ ] **Agent converts converged lyrics → annotated-lyrics.json** — adds per-syllable timing, dynamics, vocal direction
- [ ] Agent creates piano-roll-spec.json from lyrics + musical vision
- [ ] `/music-lab converge` shells to:
  - `/create-music yue` → generate
  - `/review-music analyze` → extract features
  - `/scillm` → LLM re-quantize prompt based on delta
- [ ] Review output in ux-lab dashboard
- [ ] If satisfactory: `/create-music sonauto` for optional cloud polish (1 credit)
- [ ] `/create-stems` → separate vocals → `/create-music rvc-infer` → Horus voice
- [ ] `/review-music` on final mix for quality check
- [ ] All steps are subprocess calls to existing skill `run.sh` files — zero bespoke code
- **Gate**: Whisperheads audio file exists with convergence score < 0.3

### T4.2 — Nightly Pipeline Wiring
- [ ] `/scheduler` job: `music-lab-nightly` runs `/music-lab converge` on active projects
- [ ] Active projects tracked in `.pi/skills/music-lab/projects.json`
- [ ] Results archived to `/mnt/storage12tb/media/agents/shared/music-lab/{project}/`
- [ ] Discord notification with convergence chart image
- [ ] Memory learn: lessons from each run
- **Gate**: Nightly job runs unattended for 3 consecutive nights

### T4.3 — Sonauto Final Polish Pass
- [ ] After YuE convergence: optional Sonauto generate with reference audio
- [ ] Use `--align-lyrics` to get word-level timing for validation
- [ ] Compare Sonauto output against same piano-roll-spec (same delta scoring)
- [ ] Pick best: YuE local vs Sonauto cloud
- **Gate**: Both outputs scored against same spec; comparison logged

### T4.4 — Voice Identity (RVC) Integration
- [ ] After convergence: extract vocals via `/create-stems`
- [ ] Apply Horus voice model via `/create-music rvc-infer`
- [ ] Re-mix converted vocals with instrumental stems
- [ ] Quality check: `/review-music` on final mix
- **Gate**: Final mix passes `/review-music` with no high-severity findings

---

## Quality Gates (Global)

- [ ] `/skills-ci` scan: no new errors after each phase
- [ ] All Python uses loguru (not logging), typer (not argparse), httpx (not requests)
- [ ] No Python file exceeds 800 lines
- [ ] All schemas validate with jsonschema
- [ ] Heavy artifacts (models, audio, checkpoints) on 12TB, never NVMe
- [ ] SKILL.md has triggers (NON-NEGOTIABLE)
- [ ] sanity.sh runs real-world checks (not mocked)
- [ ] Memory learn after each major milestone

---

## Dependencies

| Skill | Role in /music-lab | Status |
|-------|------|--------|
| `/create-music` | Audio generation (YuE, Sonauto, MusicGen, RVC, MIDI utils) | Exists — needs YuE backend + MIDI subcommands |
| `/review-music` | MIR analysis (BPM, key, chords, dynamics) — convergence signal source | Exists |
| `/create-stems` | Stem separation (Demucs) — post-convergence vocal extraction | Exists |
| `/prompt-lab` | Iterative prompt refinement for generator re-quantization (calls scillm `localhost:4001` internally) | Exists |
| `/story-lab` | Self-improving story/lyrics convergence loop (create-story → review-story → iterate) | **Needs creation** — same pattern as /paper-lab |
| `/create-story` | Horus creative writing (research → drafts → critiques) | Exists |
| `/review-story` | Multi-provider creative writing critique (structure, emotion, voice, persona) | Exists |
| `/dogpile` | Deep research when Horus needs musical influences, lyrical techniques, genre conventions | Exists |
| `/consume-music` | Recall HMT-tagged songs from ingested YouTube history (episodic associations to lore) | Exists |
| `/learn-artist` | Reference artist vocal style + technique for lyric/arrangement influence | Exists |
| `/learn-voice` | RVC voice model training for Horus vocal identity | Exists |
| `/create-design-board` | Design iteration with Steve Schoger persona | Exists |
| `/review-design` | Vision-driven UX audit | Exists |
| `/test-interactions` | UI capture + manifest testing | Exists |
| `/task-monitor` | Progress tracking for long convergence runs | Exists |
| `/memory` | Lesson storage — learn from each convergence run | Exists |
| `/scheduler` | Nightly job scheduling | Exists |
| `ux-lab` | React component library — music-lab dashboard views | Exists — needs music-lab components |

## New External Dependencies

All go into `/create-music/pyproject.toml` — `/music-lab` has NO Python deps beyond loguru+typer (CLI glue).

| Package | Skill | Purpose | Install |
|---------|-------|---------|---------|
| `pretty_midi` | `/create-music` | MIDI ↔ piano roll conversion | `uv pip install pretty_midi` |
| `jsonschema` | `/create-music` | Schema validation for annotated lyrics + piano roll | `uv pip install jsonschema` |
| `alisson-anjos/YuE-Interface` | `/create-music` | Local music generation | Docker image (fork) |

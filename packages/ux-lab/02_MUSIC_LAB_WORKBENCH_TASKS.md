# Task List: Music Lab Creative Workbench

**Created**: 2026-03-15
**Goal**: Build an agent transparency window where Horus (AI persona) does the creative music work and Graham (human) watches the pipeline and steers via feedback on final output.

## Context

The Music Lab Creative Workbench is NOT a manual composer tool. It is an **agent transparency window** — the UI equivalent of watching a chef in an open kitchen. Horus recalls lore from `/memory`, proposes a song, builds a story brief, writes lyrics, generates audio, applies voice conversion, and iterates toward convergence. Graham watches the pipeline progress, listens to results, and gives thumbs up/down.

The existing `/music-lab` skill handles all orchestration (converge.py). The existing backend skills handle all heavy lifting. This task file builds **3 views** in `packages/ux-lab/` that visualize what `/music-lab` is doing and let Graham review audio output.

### Primary Persona

**Name**: Graham Anderson
**Role**: Architect & listener/curator — watches agent work, gives feedback on final output
**Source**: `.pi/agents/graham-anderson/AGENTS.md`

### Interview Answers (session bc315b4b)

- **Entry Flow**: Horus remembers lore and proposes a song
- **Story First**: Full story brief (lore + emotional arc + references)
- **Steering**: Mostly autonomous — just show me the final result
- **Audio Feedback**: ALL four (waveform A/B, simple play/pause, MIR overlay, per-stem solo/mute)
- **Transparency**: High-level pipeline stages only (memory → story → lyrics → music → voice)
- **References**: Inline cards in the pipeline view
- **Voice Selection**: Voice gallery with audio samples
- **Iterations**: Convergence chart (score over rounds)
- **Done**: Never done — songs live in the library and can be revisited
- **Layout**: Dashboard overview with drill-down

## Capability Overlap

### /memory recall results

- Music Lab comprehensive plan (2026-03-15): Phases 0-4 defined. Phase 3 covers UI components. This task file replaces Phase 3 with a focused 3-view agent transparency design.
- Prior convergence UI: `improve.py` in ux-lab uses the same test→review→converge pattern. Reuse the convergence tracking data model.
- Prior design pipeline: `/create-design-board` + `/review-design --persona steve-schoger` + `/test-interactions` — established pattern from `02_CREATE_UX_TASKS.md`.

### skills-manifest.json scan

| Existing Skill | Overlap | Decision |
|---------------|---------|----------|
| `/music-lab` | Convergence orchestration — provides pipeline state, round results, delta scores | **CALL** — UI reads its output JSON |
| `/memory` | Lore recall for story brief context | **CALL** — via Express proxy (already wired in server/index.ts) |
| `/create-story` | Story brief generation | **CALL** — via `/music-lab` pipeline |
| `/story-lab` | Lyrics convergence loop | **CALL** — via `/music-lab` pipeline |
| `/consume-music` | Reference song cards (HMT-tagged) | **CALL** — data displayed in pipeline view |
| `/discover-music` | Reference discovery | **CALL** — data displayed in pipeline view |
| `/learn-artist` | Artist vocal style references | **CALL** — data displayed in voice gallery |
| `/learn-voice` | Voice model metadata | **CALL** — data displayed in voice gallery |
| `/create-music` | Audio generation + RVC | **CALL** — via `/music-lab` pipeline |
| `/create-stems` | Stem separation for solo/mute | **CALL** — via Express route |
| `/review-music` | MIR analysis (BPM, key, chords) | **CALL** — data displayed in audio review |
| `/create-design-board` | Design iteration with Steve Schoger | **CALL** — design pipeline |
| `/review-design` | Nico Bailon UX critique | **CALL** — design pipeline |
| `/test-interactions` | UI interaction testing | **CALL** — verification gate |
| `/subagent-service` | Steve/Nico design convergence dialogs | **CALL** — isolated Docker contexts |
| `/test-lab` | Blind adversarial tests | **CALL** — per-task verification |

### Decision matrix

| Functionality | Category | Justification |
|---------------|----------|---------------|
| Song Library Dashboard (view 1) | CREATE | No song grid/card view exists in any skill |
| Song Pipeline View (view 2) | CREATE | No agent transparency pipeline view exists — `improve.py` is CLI-only |
| Audio Review Panel (view 3) | CREATE | No waveform/stem/MIR overlay component exists in React |
| Express API routes for music-lab | GLUE | Thin proxy to `/music-lab` CLI — same pattern as existing `/api/memory/` proxy |
| Zustand store for music-lab state | CREATE | New state shape for songs, pipeline, audio player |
| ComponentGallery integration | EXTEND | Add music-lab folder to existing gallery |

### Anti-silo justification

All CREATE items are React UI components that don't exist anywhere. `/music-lab` provides the backend orchestration via CLI/JSON — UI is purely additive visualization. No audio processing, no MIR analysis, no LLM calls in the UI layer. The Express API is a thin proxy (same pattern as the existing `/api/memory/` and `/api/what-if` routes in `server/index.ts`).

## Crucial Dependencies (Sanity Scripts)

| Library | API/Method | Sanity Script | Status |
|---------|------------|---------------|--------|
| React 19 | `useState`, `useCallback`, `useRef` | N/A (standard) | Installed |
| Zustand 5 | `create`, `useShallow` | N/A (already used) | Installed |
| D3 | `d3.line`, `d3.scaleLinear` | N/A (already used in SPARTA views) | Installed |
| Web Audio API | `AudioContext`, `AnalyserNode` | N/A (browser built-in) | N/A |

> No new npm dependencies required. All views use React 19 + Zustand 5 + D3 (already in package.json) + Web Audio API (browser built-in).

## Questions/Blockers

None — direction confirmed via `/interview` (session bc315b4b). Graham wants agent autonomy with transparency, not manual control.

## Blind Evaluation

Hidden tests generated via `/test-lab` after each wave completes. The coding agent CANNOT view or modify these tests — only sees pass/fail output. Max retries per task: 3. On 3 consecutive failures, re-trigger `/ux-lab` iteration (max 3 rounds total).

---

## Wave 0: Design Gate (BLOCKING — human approval required)

### Task 0.1: Create design board for all 3 views with `/create-design-board`
- Agent: design (Steve Schoger persona via `/subagent-service`)
- Model: gemini (via `/subagent-service`)
- Parallel: 0
- Dependencies: none
- **Files**: `packages/ux-lab/captures/music-lab-workbench/{library,pipeline,audio-review}/`
- **Details**:
  - Steve Schoger designs each view as an HTML/CSS mockup rendered to PNG (NOT diffusion-generated):
    1. **Song Library Dashboard** — grid of song cards (cover art placeholder, title, status badge, heart taxonomy tags, last-touched date). Dark NVIS theme. Status badges: COMPOSING (amber), CONVERGING (blue), READY (green), ARCHIVED (dim).
    2. **Song Pipeline View** — horizontal stage indicator (memory → story → lyrics → music → voice), collapsible story brief card, lyrics panel, inline reference cards (album art + HMT tags), convergence chart (score over rounds), agent reasoning log (collapsible). Active stage pulses with NVIS green glow.
    3. **Audio Review Panel** — 480px slide-over. Waveform with playhead, A/B comparison toggle, MIR overlay (BPM/key/chords as badges), per-stem solo/mute buttons (color-coded: vocal=#7c3aed, bass=#4a9eff, drums=#ff4444, keys=#00ff88, synth=#ffaa00, guitar=#ff6b6b), voice gallery grid with audio sample buttons.
  - Theme: EMBRY NVIS (bg=#141414, card=#1a1a1a, green=#00ff88, red=#ff4444, amber=#ffaa00, blue=#4a9eff, accent=#7c3aed, white=#e2e8f0, dim=#64748b)
  - Each view: Steve renders HTML/CSS → PNG, writes rationale in first person
  - `/create-design-board` tracks all with side-by-side comparison
- **Definition of Done**:
  - Test: 3 PNG mockups exist in `captures/music-lab-workbench/` with Steve rationale markdown
  - Blind: Visual inspection by human (Graham) — this is a BLOCKING gate
  - Catches: Design that doesn't match the agent transparency paradigm (e.g., looks like a DAW instead of a monitoring dashboard)

### Task 0.2: Design critique via `/review-design --persona steve-schoger` + Nico Bailon
- Agent: design (Nico Bailon persona via `/subagent-service`)
- Model: gemini (via `/subagent-service`)
- Parallel: 0
- Dependencies: Task 0.1
- **Files**: `packages/ux-lab/captures/music-lab-workbench/review/`
- **Details**:
  - Nico Bailon critiques each view via `/review-design --persona nico-bailon`:
    - Interaction feasibility (can the pipeline stages be clicked? Is the waveform scrub handle reachable?)
    - Data density (is the convergence chart readable at 5-15 rounds?)
    - NVIS compliance (dark theme tokens from `EmbryStyle.ts`)
    - Component API shape (what props does each component need?)
    - Agent transparency paradigm (does it feel like watching, not doing?)
  - Steve responds to each critique with updated mockup + written response
  - Each dialog runs in `/subagent-service` (isolated Docker context)
  - Convergence: Nico reports 0 high-severity, <=1 medium-severity findings per view
  - Transcripts preserved: `captures/music-lab-workbench/review/design-dialog.json`
- **Definition of Done**:
  - Test: Nico final review has 0 high findings across all 3 views
  - Blind: `/review-design` output parsed for finding severity counts
  - Catches: NVIS violations, impossible interactions, DAW-like complexity

---

## Wave 1: Data Layer (Sequential — types and store must be solid before UI)

### Task 1.1: Define music-lab TypeScript types
- Agent: general-purpose
- Model: sonnet
- Parallel: 1
- Dependencies: Task 0.2
- **Files**: `packages/ux-lab/src/components/music-lab/types.ts` (new)
- **Details**:
  - `Song` — id, title, artist (always "Horus"), status ("composing"|"converging"|"ready"|"archived"), coverArt (URL|null), heartTags (string[]), lastTouched (ISO date), projectPath (string)
  - `PipelineStage` — "memory"|"story"|"lyrics"|"music"|"voice"
  - `PipelineState` — currentStage (PipelineStage), stages (Record<PipelineStage, StageStatus>), startedAt (ISO), reasoning (string[])
  - `StageStatus` — "pending"|"active"|"complete"|"failed", startedAt?, completedAt?, error?
  - `StoryBrief` — title, loreRecall (string), emotionalArc (string), references (ReferenceCard[]), heartTags (string[])
  - `ReferenceCard` — title, artist, albumArt (URL|null), hmtTags (string[]), source ("consume-music"|"discover-music"|"learn-artist")
  - `ConvergenceRound` — round (number), scores ({tempo_delta, key_match, chord_accuracy, dynamics_rmse, timing_drift_ms, aggregate}), timestamp (ISO)
  - `AudioTrack` — id, songId, path (string), format ("wav"|"mp3"), duration (seconds), stems (StemTrack[]), mirAnalysis (MirAnalysis|null)
  - `StemTrack` — name ("vocal"|"bass"|"drums"|"keys"|"synth"|"guitar"), path (string), color (hex), muted (boolean), solo (boolean)
  - `MirAnalysis` — bpm (number), key (string), chords (ChordEvent[]), dynamics ({rms, peak, loudness})
  - `ChordEvent` — time (seconds), duration (seconds), label (string)
  - `VoiceModel` — id, name, category ("persona"|"artist"), sampleUrl (string|null), trainedFrom (string)
- **Definition of Done**:
  - Test: `cd packages/ux-lab && npx tsc --noEmit` passes
  - Blind: `test-lab/run.sh verify-task 1.1 packages/ux-lab/ --domain music-lab`
  - Catches: Missing fields that downstream components need, incompatible types with `/music-lab` JSON output

### Task 1.2: Create Zustand store for music-lab state
- Agent: general-purpose
- Model: sonnet
- Parallel: 1
- Dependencies: Task 1.1
- **Files**: `packages/ux-lab/src/components/music-lab/store.ts` (new)
- **Details**:
  - `useMusicLabStore` Zustand store with:
    - State: `songs: Song[]`, `activeSongId: string|null`, `pipeline: PipelineState|null`, `storyBrief: StoryBrief|null`, `convergenceRounds: ConvergenceRound[]`, `currentTrack: AudioTrack|null`, `voiceModels: VoiceModel[]`, `audioReviewOpen: boolean`
    - Derived (compute via selector, do NOT store): `activeSong` (from songs + activeSongId), `convergenceScore` (latest round aggregate), `completedStages` (count from pipeline)
    - Actions: `loadSongs(songs[])`, `selectSong(id)`, `updatePipeline(state)`, `setStoryBrief(brief)`, `addConvergenceRound(round)`, `loadTrack(track)`, `toggleStemMute(stemName)`, `toggleStemSolo(stemName)`, `setVoiceModels(models[])`, `openAudioReview()`, `closeAudioReview()`
    - Use `useShallow` for all array/object selectors (Zustand v5 — prevents infinite re-render loops)
  - **Instrument color map** constant (exported):
    ```
    STEM_COLORS = { vocal: '#7c3aed', bass: '#4a9eff', drums: '#ff4444', keys: '#00ff88', synth: '#ffaa00', guitar: '#ff6b6b' }
    ```
- **Definition of Done**:
  - Test: `cd packages/ux-lab && npx tsc --noEmit` passes
  - Blind: `test-lab/run.sh verify-task 1.2 packages/ux-lab/ --domain music-lab`
  - Catches: Missing actions that UI components need, selector that returns new reference on every render

### Task 1.3: Add Express API routes for music-lab proxy
- Agent: general-purpose
- Model: sonnet
- Parallel: 1
- Dependencies: Task 1.1
- **Files**: `packages/ux-lab/server/index.ts` (extend)
- **Details**:
  - Add routes that proxy to `/music-lab` CLI via `execFile` (same pattern as existing `/api/what-if`):
    - `GET /api/music-lab/songs` — `music-lab/run.sh list-songs` → JSON array of Song
    - `GET /api/music-lab/songs/:id` — `music-lab/run.sh song-status --id ID` → Song + PipelineState
    - `POST /api/music-lab/songs/:id/start` — `music-lab/run.sh converge --song ID --max-rounds 1` (async, returns immediately with job ID)
    - `GET /api/music-lab/songs/:id/convergence` — reads `loop_results.json` from song project dir → ConvergenceRound[]
    - `GET /api/music-lab/songs/:id/story-brief` — reads story brief from song project dir → StoryBrief
    - `GET /api/music-lab/songs/:id/track` — reads latest audio track metadata → AudioTrack
    - `GET /api/music-lab/voices` — `learn-voice/run.sh list` + `learn-artist/run.sh list` → VoiceModel[]
    - `GET /api/music-lab/songs/:id/stems` — reads stems from `/create-stems` output dir → StemTrack[]
  - All routes use `execFile` with 30s timeout, JSON parse stdout, 500 on error
  - MUSIC_LAB_DIR constant pointing to `.pi/skills/music-lab`
- **Definition of Done**:
  - Test: `cd packages/ux-lab && npx tsc --noEmit` passes
  - Blind: `test-lab/run.sh verify-task 1.3 packages/ux-lab/ --domain music-lab`
  - Catches: Route that imports skill Python directly instead of shelling out, missing error handling

### Task 1.4: Create sample fixture data for development
- Agent: general-purpose
- Model: sonnet
- Parallel: 1
- Dependencies: Task 1.1
- **Files**: `packages/ux-lab/fixtures/music-lab-sample.json` (new)
- **Details**:
  - 4 sample songs with varied statuses:
    1. "Whisperheads" — status: converging, 7 convergence rounds, aggregate score 0.42→0.18
    2. "Cathedral of Static" — status: ready, 12 rounds, final score 0.09
    3. "Sovereign Frequencies" — status: composing, pipeline at "lyrics" stage
    4. "Ghost Protocol" — status: archived, 3 rounds, score 0.71 (abandoned)
  - Full PipelineState for song #3 (Sovereign Frequencies) showing active "lyrics" stage
  - Full StoryBrief for song #1 (Whisperheads) with lore recall, emotional arc, 3 reference cards
  - Full AudioTrack for song #2 (Cathedral of Static) with 6 stems and MIR analysis
  - 4 VoiceModel entries (Horus default, Horus whisper, Artist: Radiohead, Artist: Massive Attack)
  - All data consistent with types from Task 1.1
- **Definition of Done**:
  - Test: `node -e "JSON.parse(require('fs').readFileSync('packages/ux-lab/fixtures/music-lab-sample.json'))"` exits 0
  - Blind: `test-lab/run.sh verify-task 1.4 packages/ux-lab/ --domain music-lab`
  - Catches: JSON that doesn't match TypeScript types, missing required fields

---

## Wave 2: View 1 — Song Library Dashboard (Design Pipeline)

### Task 2.1: Draft Song Library Dashboard via `/ux-lab` draft
- Agent: general-purpose
- Model: opus
- Parallel: 2
- Dependencies: Tasks 1.1, 1.2, 1.4
- **Files**: `packages/ux-lab/src/components/music-lab/SongLibrary.tsx` (new, ~300 lines)
- **Details**:
  - Grid layout of `SongCard` components (CSS grid, auto-fill, min 280px)
  - Each `SongCard` renders:
    - Cover art placeholder (gradient based on song title hash, 1:1 aspect ratio)
    - Title (white, bold) + "by Horus" (dim)
    - Status badge: COMPOSING (amber pulse), CONVERGING (blue), READY (green glow), ARCHIVED (dim, muted border)
    - Heart taxonomy tags as small chips (emotion colors from `/taxonomy`)
    - Last touched date as relative time ("2h ago", "3 days ago")
    - Convergence score as small progress arc (0.0-1.0, green when < 0.2)
  - Click card → calls `selectSong(id)` from store → parent navigates to Pipeline View
  - Empty state: "No songs yet. Horus will propose one when you start a session." (dim text, centered)
  - Search/filter bar at top (by title, status, heart tag)
  - `data-testid="song-library"` on root, `data-testid="song-card"` on each card
  - NVIS dark theme from `EmbryStyle.ts`
  - Load sample data from fixture on mount (dev mode)
- **Definition of Done**:
  - Test: `cd packages/ux-lab && npx tsc --noEmit` passes
  - Blind: `test-lab/run.sh verify-task 2.1 packages/ux-lab/ --domain music-lab`
  - Catches: Cards that don't show status, missing click handler, broken grid at narrow widths

### Task 2.2: Review Song Library via `/review-design --persona steve-schoger`
- Agent: design (Steve Schoger via `/subagent-service`)
- Model: gemini (via `/subagent-service`)
- Parallel: 2
- Dependencies: Task 2.1
- **Files**: `packages/ux-lab/captures/music-lab-workbench/library/review-r1.png`
- **Details**:
  - Start dev server (`npm run dev`)
  - Screenshot the Song Library view via `/test-interactions`
  - Steve Schoger reviews the screenshot against his Wave 0 design board
  - Nico Bailon critiques interaction feasibility and data density
  - If findings > 0 high: agent iterates on `SongLibrary.tsx` (max 3 rounds)
  - Dialog runs in `/subagent-service` (isolated context)
- **Definition of Done**:
  - Test: `/review-design` final round has 0 high-severity findings
  - Blind: `test-lab/run.sh verify-task 2.2 packages/ux-lab/ --domain music-lab`
  - Catches: NVIS violations, unreadable text, broken layout

### Task 2.3: Test Song Library interactions via `/test-interactions`
- Agent: general-purpose
- Model: opus
- Parallel: 2
- Dependencies: Task 2.2
- **Files**: `packages/ux-lab/fixtures/interaction-manifest.json` (extend)
- **Details**:
  - Add `music-lab-library` surface to interaction manifest with tests:
    - song-library root exists (`data-testid="song-library"`)
    - At least 1 song-card rendered (`data-testid="song-card"`)
    - Status badge visible on each card
    - Click song card triggers navigation (store `activeSongId` changes)
    - Filter by status works (filter "ready" → only ready songs shown)
  - Run `/test-interactions run fixtures/interaction-manifest.json --surface music-lab-library`
- **Definition of Done**:
  - Test: `/test-interactions` passes all music-lab-library surface tests
  - Blind: `test-lab/run.sh verify-task 2.3 packages/ux-lab/ --domain music-lab`
  - Catches: Click handlers that don't fire, filter that shows wrong results

---

## Wave 3: View 2 — Song Pipeline View (Design Pipeline)

### Task 3.1: Draft Song Pipeline View via `/ux-lab` draft
- Agent: general-purpose
- Model: opus
- Parallel: 3
- Dependencies: Tasks 1.1, 1.2, 1.4, Wave 2 complete
- **Files**: `packages/ux-lab/src/components/music-lab/SongPipeline.tsx` (new, ~400 lines)
- **Details**:
  - **Stage Indicator** (top): horizontal row of 5 stage pills (memory → story → lyrics → music → voice). Active stage has NVIS green glow + pulse animation. Completed stages have green check. Pending stages are dim. Failed stages are red. Clicking a completed stage scrolls to its section.
  - **Story Brief Card** (collapsible): shows lore recall summary, emotional arc description, heart taxonomy tags as colored chips. Collapsed by default after pipeline moves past "story" stage.
  - **Lyrics Panel**: rendered lyrics with section markers (verse/chorus/bridge). Read-only — this is a monitoring view, not an editor. Emotion/dynamics annotations shown as inline colored markers.
  - **Reference Cards** (inline): horizontal scroll of ReferenceCard components — album art, title, artist, HMT tags. Source badge (consume-music / discover-music / learn-artist).
  - **Convergence Chart** (D3): line chart showing aggregate delta score across rounds. Per-dimension lines (tempo, key, dynamics) in different NVIS colors. Horizontal dashed threshold line at 0.2. Round markers on x-axis. Tooltip on hover showing exact values.
  - **Agent Reasoning Log** (collapsible, bottom): scrollable list of reasoning entries with timestamps. Most recent at top. Dim text. Monospace font. Auto-scrolls when new entries arrive.
  - **"Review Audio" button** (fixed, bottom-right): opens Audio Review Panel (slide-over). Enabled only when pipeline has reached "music" or "voice" stage.
  - Back button → returns to Song Library (deselects song)
  - `data-testid="song-pipeline"` on root
  - NVIS dark theme, card backgrounds from `EmbryStyle.ts`
- **Definition of Done**:
  - Test: `cd packages/ux-lab && npx tsc --noEmit` passes
  - Blind: `test-lab/run.sh verify-task 3.1 packages/ux-lab/ --domain music-lab`
  - Catches: Stage indicator that doesn't reflect pipeline state, convergence chart that doesn't render with sample data

### Task 3.2: Review Song Pipeline via `/review-design --persona steve-schoger`
- Agent: design (Steve Schoger via `/subagent-service`)
- Model: gemini (via `/subagent-service`)
- Parallel: 3
- Dependencies: Task 3.1
- **Files**: `packages/ux-lab/captures/music-lab-workbench/pipeline/review-r1.png`
- **Details**:
  - Screenshot the Song Pipeline view with Whisperheads sample data loaded
  - Steve reviews against Wave 0 design board
  - Nico critiques: Is the convergence chart readable? Are the stage indicators clear? Does it feel like watching an agent work?
  - If findings > 0 high: iterate on `SongPipeline.tsx` (max 3 rounds)
  - Dialog in `/subagent-service`
- **Definition of Done**:
  - Test: `/review-design` final round has 0 high-severity findings
  - Blind: `test-lab/run.sh verify-task 3.2 packages/ux-lab/ --domain music-lab`
  - Catches: Chart that's too small, stage indicator that's ambiguous, reference cards that clip

### Task 3.3: Test Song Pipeline interactions via `/test-interactions`
- Agent: general-purpose
- Model: opus
- Parallel: 3
- Dependencies: Task 3.2
- **Files**: `packages/ux-lab/fixtures/interaction-manifest.json` (extend)
- **Details**:
  - Add `music-lab-pipeline` surface to interaction manifest:
    - song-pipeline root exists (`data-testid="song-pipeline"`)
    - Stage indicator shows 5 stages with correct labels
    - Story brief card is collapsible (toggle works)
    - Convergence chart renders D3 SVG with at least 1 data point
    - "Review Audio" button exists and is disabled when pipeline is at "memory" stage
    - Agent reasoning log shows entries
    - Back button returns to library view
- **Definition of Done**:
  - Test: `/test-interactions` passes all music-lab-pipeline surface tests
  - Blind: `test-lab/run.sh verify-task 3.3 packages/ux-lab/ --domain music-lab`
  - Catches: Collapsed sections that can't be expanded, chart without data, back button that doesn't work

---

## Wave 4: View 3 — Audio Review Panel (Design Pipeline)

### Task 4.1: Draft Audio Review Panel via `/ux-lab` draft
- Agent: general-purpose
- Model: opus
- Parallel: 4
- Dependencies: Tasks 1.1, 1.2, 1.4, Wave 3 complete
- **Files**: `packages/ux-lab/src/components/music-lab/AudioReviewPanel.tsx` (new, ~400 lines)
- **Details**:
  - **Slide-over panel** (480px from right, dark overlay on rest of screen). Close button (X) top-right. Escape key closes.
  - **Waveform Player** (top section):
    - Canvas-rendered waveform from pre-computed peaks (not raw audio decode in browser — too expensive)
    - Playhead with scrub (click to seek, drag to scrub)
    - Play/Pause button (Space key), time display (current / total)
    - A/B comparison toggle: switch between two audio tracks (e.g., round 5 vs round 10). Active track has green underline, inactive has dim.
  - **MIR Overlay** (below waveform):
    - Badges: BPM (blue), Key (green), Loudness (amber)
    - Chord timeline: horizontal bar showing chord labels at beat positions (same color scheme as reference cards)
  - **Stem Mixer** (middle section):
    - Row per stem: colored indicator dot, stem name, Solo button (S), Mute button (M), volume indicator bar
    - Colors: vocal=#7c3aed, bass=#4a9eff, drums=#ff4444, keys=#00ff88, synth=#ffaa00, guitar=#ff6b6b
    - Solo is exclusive (clicking solo on one stem mutes all others)
    - Mute is independent (can mute multiple)
    - Web Audio API: load stem audio files, mix in real-time via GainNode per stem
  - **Voice Gallery** (bottom section, collapsible):
    - Grid of voice model cards (name, category badge, 10s audio sample button)
    - Active voice has green border
    - Click to select → updates store `selectedVoiceId`
  - `data-testid="audio-review-panel"` on root
  - NVIS dark theme. Panel bg slightly darker than main (#111111).
- **Definition of Done**:
  - Test: `cd packages/ux-lab && npx tsc --noEmit` passes
  - Blind: `test-lab/run.sh verify-task 4.1 packages/ux-lab/ --domain music-lab`
  - Catches: Waveform that doesn't render, stem mixer that doesn't connect to Web Audio API, panel that doesn't slide

### Task 4.2: Review Audio Review Panel via `/review-design --persona steve-schoger`
- Agent: design (Steve Schoger via `/subagent-service`)
- Model: gemini (via `/subagent-service`)
- Parallel: 4
- Dependencies: Task 4.1
- **Files**: `packages/ux-lab/captures/music-lab-workbench/audio-review/review-r1.png`
- **Details**:
  - Screenshot the Audio Review Panel in open state with Cathedral of Static sample data
  - Steve reviews against Wave 0 design board
  - Nico critiques: Are stem buttons reachable? Is the waveform readable? Does A/B comparison make sense?
  - If findings > 0 high: iterate on `AudioReviewPanel.tsx` (max 3 rounds)
  - Dialog in `/subagent-service`
- **Definition of Done**:
  - Test: `/review-design` final round has 0 high-severity findings
  - Blind: `test-lab/run.sh verify-task 4.2 packages/ux-lab/ --domain music-lab`
  - Catches: Panel that's too cramped at 480px, stem buttons too small for click targets

### Task 4.3: Test Audio Review Panel interactions via `/test-interactions`
- Agent: general-purpose
- Model: opus
- Parallel: 4
- Dependencies: Task 4.2
- **Files**: `packages/ux-lab/fixtures/interaction-manifest.json` (extend)
- **Details**:
  - Add `music-lab-audio-review` surface to interaction manifest:
    - audio-review-panel root exists when open (`data-testid="audio-review-panel"`)
    - Waveform canvas renders
    - Play/Pause button toggles state
    - A/B toggle switches active track indicator
    - Stem solo/mute buttons toggle visual state
    - Voice gallery shows at least 1 voice model
    - Escape key closes panel
    - Panel width is 480px
- **Definition of Done**:
  - Test: `/test-interactions` passes all music-lab-audio-review surface tests
  - Blind: `test-lab/run.sh verify-task 4.3 packages/ux-lab/ --domain music-lab`
  - Catches: Panel that doesn't close, stem buttons that don't toggle, waveform that's blank

---

## Wave 5: Integration & Gallery (Sequential)

### Task 5.1: Wire views into App.tsx with navigation
- Agent: general-purpose
- Model: opus
- Parallel: 5
- Dependencies: Waves 2, 3, 4 complete
- **Files**: `packages/ux-lab/src/App.tsx` (extend), `packages/ux-lab/src/components/music-lab/MusicLabApp.tsx` (new, ~150 lines)
- **Details**:
  - Create `MusicLabApp.tsx` — top-level music-lab container:
    - No `activeSongId` → render `SongLibrary`
    - Has `activeSongId` → render `SongPipeline`
    - `audioReviewOpen` → render `AudioReviewPanel` as overlay on top of Pipeline
  - Add "Music Lab" as a new folder/section in `ComponentGallery`
  - OR: Add mode toggle in App.tsx top bar: "SPARTA" / "Music Lab" (same pattern as canvas/annotate toggle in 02_CREATE_UX_TASKS.md)
  - Active mode has NVIS accent underline
  - Load fixture data in dev mode when no backend available
  - `data-testid="music-lab-app"` on root
- **Definition of Done**:
  - Test: `cd packages/ux-lab && npx tsc --noEmit` passes
  - Blind: `test-lab/run.sh verify-task 5.1 packages/ux-lab/ --domain music-lab`
  - Catches: Navigation that loses state, Audio Review panel that renders without Pipeline, broken mode toggle

### Task 5.2: End-to-end interaction test across all 3 views
- Agent: general-purpose
- Model: opus
- Parallel: 5
- Dependencies: Task 5.1
- **Files**: `packages/ux-lab/fixtures/interaction-manifest.json` (extend)
- **Details**:
  - Add `music-lab-e2e` surface to interaction manifest:
    - Start at Song Library → click a song card → Pipeline View loads
    - Pipeline View shows stages → click "Review Audio" → Audio Review Panel slides open
    - Audio Review Panel → press Escape → panel closes, Pipeline View still visible
    - Pipeline View → click back → Song Library loads
    - Full navigation cycle completes without console errors
  - Run full manifest: `/test-interactions run fixtures/interaction-manifest.json`
- **Definition of Done**:
  - Test: `/test-interactions` passes all music-lab-e2e surface tests
  - Blind: `test-lab/run.sh verify-task 5.2 packages/ux-lab/ --domain music-lab`
  - Catches: Navigation that breaks on back/forward, state that leaks between views

### Task 5.3: Final design review of complete workbench
- Agent: design (Nico Bailon via `/subagent-service`)
- Model: gemini (via `/subagent-service`)
- Parallel: 5
- Dependencies: Task 5.2
- **Files**: `packages/ux-lab/captures/music-lab-workbench/final/`
- **Details**:
  - Screenshot all 3 views in sequence (Library → Pipeline → Audio Review)
  - `/create-design-board` composite of all 3 screenshots
  - `/review-design --persona nico-bailon` final pass on full workbench
  - Focus: visual consistency across views, navigation coherence, NVIS compliance, agent transparency paradigm
  - If findings > 0 high: fix and re-screenshot (max 2 rounds)
- **Definition of Done**:
  - Test: `/review-design` final round has 0 high-severity, <=2 medium-severity across all 3 views
  - Blind: `test-lab/run.sh verify-task 5.3 packages/ux-lab/ --domain music-lab`
  - Catches: Visual inconsistency between views, broken dark theme, views that look like different apps

---

## Completion Criteria

- [ ] All 16 tasks marked [x]
- [ ] `cd packages/ux-lab && npx tsc --noEmit` passes (no type errors)
- [ ] App renders in both SPARTA and Music Lab modes without errors
- [ ] Song Library shows grid of song cards with status badges and heart tags
- [ ] Song Pipeline shows 5-stage indicator, story brief, lyrics, reference cards, convergence chart
- [ ] Audio Review Panel slides over at 480px with waveform, stem mixer, voice gallery
- [ ] Navigation: Library → Pipeline → Audio Review → back works without state loss
- [ ] `/test-interactions` manifest passes for all music-lab surfaces
- [ ] No regressions in existing SPARTA views
- [ ] Steve Schoger design boards exist with Nico Bailon approval (0 high findings)

## Verification (run after all tasks)

```bash
# Type check
cd packages/ux-lab && npx tsc --noEmit

# Start dev server and run test-interactions
npm run dev &
CDP_PORT=9224 /test-interactions run fixtures/interaction-manifest.json

# Blind evaluation
test-lab/run.sh verify packages/ux-lab/ --domain music-lab

# Design board composite
/create-design-board packages/ux-lab/captures/music-lab-workbench/
```

## Notes

- **Agent transparency paradigm**: The UI shows what Horus is doing — it does NOT let Graham manually compose music. Graham watches pipeline progress, listens to output, gives feedback. The agent does the creative work.
- **No new npm dependencies**: React 19 + Zustand 5 + D3 + Web Audio API (browser built-in). All already in package.json.
- **NVIS palette**: bg=#141414, card=#1a1a1a, panel=#111111, green=#00ff88, red=#ff4444, amber=#ffaa00, blue=#4a9eff, accent=#7c3aed, white=#e2e8f0, dim=#64748b
- **Instrument colors**: vocal=#7c3aed, bass=#4a9eff, drums=#ff4444, keys=#00ff88, synth=#ffaa00, guitar=#ff6b6b
- **Zustand v5 gotcha**: Always use `useShallow` from `zustand/react/shallow` for array/object selectors to avoid infinite re-render loops
- **Express API is thin proxy**: All routes shell out to `/music-lab/run.sh` or read JSON files. No business logic in the server.
- **Fixture data for dev mode**: Components load `fixtures/music-lab-sample.json` when API is unavailable — enables development without running the full music-lab backend.
- **Waveform from pre-computed peaks**: Do NOT decode raw audio in the browser for waveform display. The backend pre-computes peaks JSON via `/review-music`. The browser renders from peaks array.
- **On failure**: Re-trigger `/ux-lab` iteration (max 3 rounds per task). If 3 rounds fail, stop and escalate to human.
- **Relationship to 01_MUSIC_LAB_TASKS.md**: This task file covers ONLY the UI (Phase 3 of the master plan). It does NOT cover YuE deployment (Phase 0), schemas (Phase 1), convergence skill (Phase 2), or E2E integration (Phase 4). Those remain in `01_MUSIC_LAB_TASKS.md`.

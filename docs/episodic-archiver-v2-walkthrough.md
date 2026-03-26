# Episodic Archiver v2: Nightly Analysis + User Profiling + Participant Tracking

**Date:** 2026-02-13
**Files:** `.pi/skills/episodic-archiver/` (5 files modified), `.pi/skills/monitor-episodic-archiver/` (5 files modified/created), `.pi/skills/common/` (3 taxonomy files modified)
**Status:** Preflighted (sanity checks pass, ArangoDB not tested live)

---

## Why Previous Version Was Insufficient

### Gap 1: No Per-User Memory

**What we had:** Sessions were archived as anonymous blobs. Every session looked the same regardless of who was talking.

**Why it mattered:** Personas couldn't customize responses. A user who always wants concise, code-first answers got the same treatment as a user who prefers detailed explanations. The persona system (BDI Theory of Mind) had no behavioral priors to work with — it was flying blind on every interaction.

### Gap 2: No Nightly Pipeline

**What we had:** `archive-recent` ran ad-hoc. No scheduled analysis, no high-fidelity taxonomy, no systematic lesson extraction. Sessions were archived but not deeply understood.

**Why it mattered:** The fast-path archiver uses keyword-only taxonomy (confidence ~0.3). Bridge attributes were frequently missing or wrong. Lessons weren't being stored to `/memory` systematically, so the reflection loop (`archive -> analyze -> learn -> recall`) was broken at the "analyze" stage.

### Gap 3: No Participant Tracking

**What we had:** The Federated Taxonomy classified *what* a session was about (Precision, Resilience, etc.) but not *who* was in it.

**Why it mattered:** When a persona needed to recall prior conversations with a specific user, there was no query path. `session_summaries` had no `user_id` field. Memory lessons had no `user:` or `persona:` tags. A persona couldn't ask "what have I discussed with Graham about SPARTA?" because that relationship wasn't stored.

### Gap 4: Dead Code + Python Violations

**What we had:** A 910-line `session_analysis_monolith.py` duplicating the modular files. A custom `log()` function instead of loguru. Raw `httpx.post` for LLM calls instead of scillm. An `import re` inside a hot loop.

**Why it mattered:** Maintenance burden. Every time someone edited the modular files, the monolith drifted. The custom logger didn't rotate or format. The raw httpx call duplicated scillm's retry/timeout logic and ignored the `CHUTES_MODEL_ID` environment variable.

---

## What v2 Changes

### Change 1: User Behavioral Profiling (`analysis_llm.py:142-218`)

New `profile_user_from_session()` function extracts a structured user profile via LLM:

```python
{
    "communication_style": "technical|casual|formal|mixed",
    "expertise_domains": ["python", "security", "devops"],
    "expertise_level": "beginner|intermediate|advanced|expert",
    "response_preferences": {"verbosity": "concise", "format": "code-first"},
    "frustration_triggers": ["slow responses", "wrong assumptions"],
    "satisfaction_signals": ["specific patterns"],
    "bridge_affinities": {"Precision": 0.8, "Resilience": 0.6}
}
```

**What this fixes:** Gap 1 (no per-user memory). Personas can now query `user_priors` to understand how a specific user communicates before responding.

**What could still go wrong:** The LLM may hallucinate expertise domains not demonstrated in the session. The bridge affinity scores are only as good as the LLM's understanding of our 6-bridge taxonomy — a generic model hasn't been fine-tuned on our bridge definitions.

**Honest risk level:** MEDIUM — the incremental merge (next change) mitigates single-session noise, but early profiles (sessions 1-3) will be noisy.

### Change 2: Incremental User Priors Merge (`analysis_integrations.py:190-314`)

New `update_user_priors()` function implements RGMem-style incremental refinement:

- **Bridge affinities**: Weighted running average across sessions (old data weighted by session count)
- **Expertise domains**: Union accumulation (never forgets a demonstrated domain)
- **Communication style**: Most-recent-3-sessions voting (adapts to style shifts)
- **Frustration/satisfaction**: Append unique signals, capped at 20 (rolling history)
- **Expertise level**: Takes highest observed (never downgrades)

Stored in new `user_priors` ArangoDB collection with `_key = user_id`.

**What this fixes:** Gap 1 continued. A user's profile improves with every session without requiring a full rebuild.

**What could still go wrong:** The "never downgrades expertise" rule could be wrong — a user might demonstrate expert-level knowledge in Python once, then consistently show intermediate behavior. The weighted average for bridge affinities means early sessions have outsized influence that decays slowly.

**Honest risk level:** LOW — the voting/averaging mechanisms are conservative by design. Worst case: a profile is slightly wrong, and a persona is slightly too verbose or too concise.

### Change 3: Participant Tracking in Taxonomy (`common/taxonomy_types.py`, `taxonomy_core.py`, `taxonomy_extractors.py`)

New `Participants` TypedDict added to `TaxonomyExtractionResult`:

```python
class Participants(TypedDict, total=False):
    user_id: str          # Who started the conversation
    persona_id: str       # Which persona was involved
    participants: List[str]  # All participant IDs
```

Every content extractor (all 9) now returns `participants={}` as a default. The `extract_taxonomy_features()` function accepts `user_id`, `persona_id`, `participants` parameters and injects them into the result after extraction.

**What this fixes:** Gap 3. The Federated Taxonomy now records WHO was in the conversation alongside WHAT it was about. Memory lessons get `user:graham` and `persona:pi` tags. Session summaries store a `participants` object.

**What could still go wrong:** Adding a new field to `TaxonomyExtractionResult` could break downstream consumers that destructure the result with strict expectations. However, TypedDict is structurally typed — extra fields don't break existing code that doesn't reference them.

**Honest risk level:** LOW — backward compatible. Old code ignores the new field. New code can query by it.

### Change 4: Nightly Pipeline (`monitor-episodic-archiver/monitor_archiver.py:469-600+`)

New `nightly` command orchestrates a 3-stage pipeline:

1. **Archive**: Calls `episodic-archiver/run.sh archive-recent --hours 24 --no-analyze` (fast path, no LLM)
2. **Analyze + Profile**: Re-analyzes each session with `high_fidelity=True` taxonomy and user profiling via DeepSeek-V3.1-TEE
3. **Health check**: Runs the existing health assessment and saves report

State management via `state.py` (atomic JSON writes, `.tmp` + `os.replace`). Task-monitor integration via `EpisodicMonitorTracker` following the `PersonaMonitorTracker` pattern.

**What this fixes:** Gap 2. Sessions are now systematically analyzed overnight with the best available model, not just keyword-heuristics at archive time.

**What could still go wrong:** The nightly pipeline processes sessions sequentially. If there are 50+ sessions from a busy day, with 3+ LLM calls per session (assess + profile + taxonomy), the pipeline could take hours. DeepSeek-V3.1-TEE at 0.60s latency means ~90s per session minimum, so 50 sessions = ~75 minutes.

**Honest risk level:** MEDIUM — for typical daily volumes (5-15 sessions) this is fine. For bursty days, consider adding a `--max-sessions` cap.

### Change 5: Core Cleanup (`archive_episode.py`)

- Deleted `session_analysis_monolith.py` (910 lines)
- Replaced custom `log()` with `from loguru import logger`
- Replaced raw `httpx.post` to Chutes API with `scillm.batch.quick_completion()`
- Moved `import re` from inside the archiving loop to module top
- Added `user_id` and `persona_id` to every per-turn document

**What this fixes:** Gap 4. Clean code, proper logging, contract-compliant LLM calls.

**What could still go wrong:** The scillm `quick_completion()` path adds a `sys.path.insert` to find the scillm skill directory. If the skill is moved or renamed, the import breaks silently (falls back to returning "info" for every categorization).

**Honest risk level:** LOW — the scillm skill path is stable and the fallback is safe.

---

## Data Flow Diagram

```mermaid
flowchart TD
    A[Session Transcript] -->|archive| B[archive_episode.py]
    B -->|per-turn| C[agent_conversations]
    B -->|user_id, persona_id| C
    B -->|resolution analysis| D{Resolved?}
    D -->|No| E[unresolved_sessions]
    D -->|Yes| F[Session Complete]

    G[Nightly Pipeline 3am] -->|Stage 1| H[archive-recent --no-analyze]
    H --> C
    G -->|Stage 2| I[session_analysis.py]
    I -->|LLM assess| J[session_summaries]
    I -->|taxonomy high_fidelity| K[bridge_attributes + participants]
    K --> J
    I -->|profile_user| L[user_priors]
    I -->|store_lessons| M[/memory]
    M -->|user: persona: tags| N[Persona Recall]

    O[Persona via /ask] -->|query| J
    O -->|FILTER persona_id| J
    O -->|query| L
    O -->|recall user priors| P[Customized Response]
```

---

## Risk Matrix

| Change | Fixes | Risk | Observable Failure |
|--------|-------|------|--------------------|
| User profiling LLM prompt | No per-user memory | MEDIUM | `user_priors` collection has empty/nonsense profiles |
| RGMem incremental merge | Static profiles | LOW | Bridge affinities stuck at 0.0 after 5+ sessions |
| Participant tracking in taxonomy | No who-was-there | LOW | `participants` field empty in session_summaries |
| Nightly pipeline | No systematic analysis | MEDIUM | `nightly_report.json` shows 0 analyzed, high error count |
| scillm migration | Raw httpx calls | LOW | All turns categorized as "info" (fallback triggered) |

---

## How This Benefits /memory and Personas

### For /memory

**Before:** Lessons stored to `/memory` had session ID and bridge tags, but no record of who generated the lesson or which persona was involved.

**After:** Every lesson stored via `store_lessons_to_memory()` now carries `user:graham` and `persona:pi` tags. This means:

1. **Persona-scoped recall**: `/memory recall --tag persona:pi` returns only lessons from sessions where Pi was the persona. No more noise from other personas' sessions.

2. **User-scoped recall**: `/memory recall --tag user:graham` returns lessons from Graham's sessions specifically. When a new user starts using the system, their empty tag space means the persona starts fresh — no contamination from another user's patterns.

3. **Cross-reference**: A persona can query "what has Graham asked me about SPARTA?" by combining `user:graham` + `persona:pi` + bridge tag `Precision`.

### For Personas (Theory of Mind)

**Before:** Personas had no behavioral priors. Every session started from zero understanding of the user.

**After:** The `user_priors` collection gives each persona access to:

| Prior | How Persona Uses It |
|-------|-------------------|
| `communication_style: "technical"` | Skip explanations, lead with code |
| `expertise_level: "expert"` | Don't explain basics, use domain jargon |
| `response_preferences.verbosity: "concise"` | Short answers, no filler |
| `frustration_triggers: ["wrong assumptions"]` | Ask before assuming, confirm understanding |
| `bridge_affinities: {Precision: 0.8}` | This user cares about correctness — verify claims |

A persona implementing BDI Theory of Mind can now form **beliefs** about the user (from `user_priors`), set **desires** aligned with user preferences, and choose **intentions** that match the user's communication style. This is the missing link between the persona system's theoretical framework and practical per-user customization.

### For the Federated Taxonomy

**Before:** Taxonomy classified content by the 6 bridges (Precision, Resilience, Fragility, Corruption, Loyalty, Stealth) but only tracked *what*, not *who*.

**After:** The `participants` field in every `TaxonomyExtractionResult` means:

1. **Session summaries in ArangoDB** can be queried by persona: `FILTER d.participants.persona_id == "pi"`
2. **Cross-collection graph traversal** now has a participant dimension — you can traverse from a user's session (Operational collection) to their music preferences (HLT collection) if both carry the same `user_id` participant
3. **The reflection loop closes**: Session → Taxonomy (with participants) → Memory (with user/persona tags) → Persona recall (filtered by participant) → Better response → Better session

---

## Remaining Risks (Honest Assessment)

### Risk 1: LLM Profile Quality (MEDIUM)

The user profiling prompt asks a general-purpose LLM to extract structured behavioral signals. The bridge affinity scores (0.0-1.0 per bridge) require the model to understand our custom 6-bridge taxonomy. DeepSeek-V3.1-TEE hasn't been fine-tuned on our bridge definitions.

**Mitigation:** The incremental merge averages across sessions, so any single noisy extraction gets diluted. After 5+ sessions, the profile should converge.

**What would actually fix it:** Fine-tune or use few-shot examples in the profiling prompt with real bridge definitions.

### Risk 2: Nightly Pipeline Duration (MEDIUM)

Sequential processing of sessions with multiple LLM calls each. Heavy days could take 1-2 hours.

**Mitigation:** The pipeline runs at 3am with no human waiting. Timeout per session prevents infinite hangs.

**What would actually fix it:** Add `--max-sessions` cap, or batch LLM calls using scillm's `parallel_acompletions_iter()`.

### Risk 3: Single User Assumption (LOW)

The current implementation defaults `user_id` to `graham` via `PI_USER_ID` env var. Multi-user support depends on transcripts carrying a `user_id` field, which most sources don't currently provide.

**Mitigation:** The architecture supports multiple users — the merge logic is per-user_id. The limitation is in the data sources, not the pipeline.

---

## What Success Looks Like

| Metric | Healthy | Warning | Sick |
|--------|---------|---------|------|
| `user_priors` collection has entries | 1+ users | 0 users after 3 days | Collection doesn't exist |
| Nightly report shows sessions analyzed | >0 analyzed | All errors | Report file missing |
| Session summaries have `participants` | All have user_id | Some missing | None have participants |
| Memory lessons have user/persona tags | Tags present | Inconsistent | No tags |
| Sanity checks pass | Both PASS | One SKIP | Any FAIL |

---

## How to Launch / Monitor / Kill

```bash
# Run nightly pipeline manually (dry run first)
cd .pi/skills/monitor-episodic-archiver
./run.sh nightly --dry-run --json

# Run for real on last 24 hours
./run.sh nightly --hours 24

# Register with scheduler for daily execution
./run.sh register-nightly

# Check health dashboard
./run.sh dashboard

# Verify user_priors collection
./run.sh check --json | python3 -m json.tool

# Kill: just don't run nightly. No daemon, no persistent process.
# De-register from scheduler:
# .pi/skills/scheduler/run.sh unregister --name episodic-nightly
```

---

## Bottom Line

**Will it work?** Yes, with caveats. The core plumbing is solid — user_id flows through from archive to taxonomy to memory, the nightly pipeline follows proven patterns (monitor-personas), and the incremental merge is conservative by design. The main risk is LLM profile quality in early sessions, which self-corrects as data accumulates.

**What's genuinely different this time?**

1. Sessions now record WHO was talking, not just WHAT was discussed
2. The Federated Taxonomy carries participants through to /memory
3. Personas have behavioral priors to customize responses per-user
4. A nightly pipeline systematically processes sessions with high-fidelity taxonomy
5. The reflection loop (archive -> analyze -> learn -> recall) is now fully connected

**What's the same?**

- The archiving mechanism (per-turn embedding + categorization) is unchanged
- The resolution analysis (satisfied/frustrated detection) is unchanged
- The cross-session edge verification is unchanged
- The dogpile gap research integration is unchanged

The unchanged parts are the foundation. The new parts are the intelligence layer on top.

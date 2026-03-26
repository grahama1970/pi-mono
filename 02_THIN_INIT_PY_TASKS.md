# Thin `__init__.py` Refactoring + skills-ci Detection

**Primary Persona**: Nico Bailon (implementer) — mechanical refactoring, no design decisions
**Baseline**: skills-ci 50 violations (2026-03-16)
**Scope**: 37 fat `__init__.py` files across `.pi/skills/`, plus 1 new scanner in skills-ci

## Capability Overlap

### /memory recall results
- Recalled: `style-thin-init-py` rule added 2026-03-16 to `/best-practices-python/SKILL.md`
- Recalled: monitor-taxonomy probes/__init__.py incident (2026-03-16)
- No prior refactoring solutions found for this pattern

### skills-manifest.json scan
- `/skills-ci` — has scanners for python conventions, will ADD new `style.thin_init_py` check
- `/best-practices-python` — already has the rule documented, no code changes needed
- `/simplify` — reviews changed code but doesn't do targeted __init__.py refactoring
- `/subagent-service` — used as execution backend for parallel refactoring in worktrees

### Decision matrix
| Functionality | Decision | Justification |
|---|---|---|
| Detect fat `__init__.py` | EXTEND `/skills-ci` | Add scanner to existing check pipeline |
| Refactor each `__init__.py` | GLUE `/subagent-service` | Mechanical extraction, parallelizable |
| Verify no regressions | CALL `/skills-ci`, `sanity.sh` | Pre-existing validators |
| Best practices rule | DONE | Already in `/best-practices-python` |

### Anti-silo justification
No CREATE tasks. All work extends or composes existing skills.

## Context

The `style-thin-init-py` rule was added to `/best-practices-python` on 2026-03-16.
Incident: agent misdiagnosed `monitor-taxonomy` because `run_probes()` lived in
`probes/__init__.py` (122 lines) instead of a named module. Logic hidden in `__init__.py`
is invisible to agents doing file-based search.

**Rule**: `__init__.py` files must contain only re-exports and package metadata — never
business logic. Max ~20 lines.

## Execution Notes

**CRITICAL: Use /subagent-service for refactoring tasks** to avoid context exhaustion.
Each refactoring task (T2-T8) should be dispatched to a subagent in an isolated worktree.
The orchestrator reads each `__init__.py`, decides the target module name, and sends a
structured prompt to the subagent with the specific extraction instructions.

**Subagent prompt template for each skill**:
```
Read <path>/__init__.py. Extract all business logic (functions, classes, registries)
into a new module <path>/<target>.py. Leave only re-exports in __init__.py.
Update all internal imports within the skill. Run: python -c "import <module>"
to verify. Do NOT change any public API — all existing imports must still work.
```

---

## Tasks

### T1: Add `style.thin_init_py` scanner to skills-ci
- skill: /skills-ci
- files: `.pi/skills/skills-ci/scanners.py`, `.pi/skills/skills-ci/skills_ci.py`
- action: Add `scan_style_thin_init_py(skill_dir)` function to `scanners.py`.
  Count non-blank, non-comment lines in each `__init__.py`. Emit `style.thin_init_py`
  warning if >20 lines. Call it unconditionally in `scan_skills()`.
- DoD: `/skills-ci scan` shows `style.thin_init_py` warnings for known violators.
  Baseline + N new warnings (N = number of fat files detected). No existing checks broken.
- gate: `cd .pi/skills/skills-ci && uv run python skills_ci.py --mode scan 2>&1 | grep "style.thin_init_py" | head -5`

### T2: Refactor Tier 1 (>150 lines) — 5 files `with subagent`
- skill: /subagent-service
- files:
  - `create-score/create_score/__init__.py` (308 lines) → `create_score/engine.py`
  - `ingest-movie/__init__.py` (237 lines) → `ingest_movie/pipeline.py`
  - `common/__init__.py` (180 lines) → `common/utils.py` or `common/core.py`
  - `review-assurance-case/providers/__init__.py` (169 lines) → `providers/registry.py`
  - `create-paper/__init__.py` (163 lines) → `create_paper/orchestrator.py`
- action: For each file, extract business logic to a named module. Leave `__init__.py`
  with only `from .module import *` re-exports + `__all__`. Run each as a separate
  subagent in a worktree.
- DoD: Each `__init__.py` is ≤20 lines. All `from skill import X` still work.
  `sanity.sh` passes for each modified skill.
- gate: `wc -l <each __init__.py>` all ≤20; `sanity.sh` exit 0

### T3: Refactor Tier 2 (100-150 lines) — 5 files `with subagent`
- skill: /subagent-service
- files:
  - `reality-check-sparta/__init__.py` (146 lines) → `checker.py`
  - `create-figure/__init__.py` (145 lines) → `renderer.py`
  - `battle/__init__.py` (125 lines) → `orchestrator.py`
  - `monitor-taxonomy/probes/__init__.py` (122 lines) → `probes/registry.py`
  - `monitor-security/probes/__init__.py` (121 lines) → `probes/registry.py`
- DoD: Each `__init__.py` ≤20 lines. sanity.sh passes.
- gate: same as T2

### T4: Refactor Tier 3 (90-120 lines) — 5 files `with subagent`
- skill: /subagent-service
- files:
  - `monitor-memory/probes/__init__.py` (118 lines) → `probes/registry.py`
  - `create-movie/create_movie/__init__.py` (102 lines) → `core.py`
  - `ask/__init__.py` (97 lines) → `engine.py`
  - `github-search/__init__.py` (93 lines) → `searcher.py`
  - `create-movie/create_movie/phases/__init__.py` (68 lines) → `phases/registry.py`
- DoD: Each `__init__.py` ≤20 lines. sanity.sh passes.
- gate: same as T2

### T5: Refactor Tier 4 (50-90 lines) — 7 files `with subagent`
- skill: /subagent-service
- files:
  - `task-monitor/task_monitor/__init__.py` (59 lines) → `client.py`
  - `create-persona/src/__init__.py` (59 lines) → `src/builder.py`
  - `create-cast/create_cast/__init__.py` (59 lines) → `caster.py`
  - `ingest-youtube/youtube_transcripts/__init__.py` (56 lines) → `extractor.py`
  - `ops-runpod/src/runpod_ops_fixed/__init__.py` (55 lines) → `core.py`
  - `create-sound-design/create_sound_design/__init__.py` (44 lines) → `designer.py`
  - `dogpile/__init__.py` (29 lines) → `aggregator.py`
- DoD: Each `__init__.py` ≤20 lines. sanity.sh passes.
- gate: same as T2

### T6: Refactor Tier 5 (20-50 lines) — remaining ~15 files `with subagent`
- skill: /subagent-service
- files: All remaining `__init__.py` files >20 lines from the scan:
  ops-runpod/cli, ops-runpod/core, ops-runpod nested, create-movie/core,
  discover-talent, review-code/commands, review-code/providers,
  review-music/features, extract-pdf/cascade, assistant,
  ops-discord, extractor, tts-train/Qwen3-TTS, social-bridge, doc2qra
- action: Same pattern. Many of these may already be mostly re-exports —
  inspect before refactoring. Skip any that are actually thin (re-exports + __all__).
- DoD: Each `__init__.py` ≤20 lines OR confirmed to be re-exports-only.
- gate: `wc -l` check

### T7: Final skills-ci verification
- skill: /skills-ci
- action: Run full scan. Verify:
  1. `style.thin_init_py` warnings reduced from 37 to 0 (or near-0)
  2. Original 50 violations not increased (no regressions from refactoring)
  3. No import errors from refactored skills
- DoD: `/skills-ci scan` shows 0 `style.thin_init_py` violations.
  Total violations ≤50 (baseline).
- gate: `cd .pi/skills/skills-ci && uv run python skills_ci.py --mode scan 2>&1 | grep -c "WARN\|ERROR"` ≤ 50

### T8: Checkpoint and learn
- skill: /checkpoint, /memory
- action: Save checkpoint with all refactored files. Learn the pattern to /memory
  for future agents.
- DoD: Checkpoint saved. Memory lesson stored.

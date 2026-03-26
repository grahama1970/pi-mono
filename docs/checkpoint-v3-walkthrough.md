# Checkpoint v3: Comprehensive Session Learning System — Honest Walkthrough

**Date:** 2026-03-26
**File(s):** `.pi/skills/checkpoint/checkpoint.py` (724 lines)
**Status:** Planned (not yet implemented)
**Reviewed by:** Embry Lawson (Project Manager / System Architect)
**User concerns addressed:** Sessions not cataloged automatically, /recommend-skill-chain has no useful data, solved problems can't be found via /memory recall

---

## The Problem Statement

Today, three systems exist that SHOULD form a learning flywheel but are completely disconnected:

| System | What It Does | What It Should Feed |
|--------|-------------|-------------------|
| `/episodic-archiver` | Archives full conversation transcripts with failure episodes, taxonomy, user profiling | → `/checkpoint` (session grading) |
| `/checkpoint` | Stores session bookmarks in ArangoDB `lessons` collection | → `/recommend-skill-chain` (proven solutions) |
| `/recommend-skill-chain` | Recommends skill chains for new tasks via Shadow-LEGO cascade | ← needs proven chain data |

**The flywheel is dead.** `/recommend-skill-chain` has no useful training data because `/checkpoint` stores vague bookmarks instead of graded, taxonomized, searchable solution records. And `/checkpoint` has no connection to `/episodic-archiver`, so it can't know whether a session actually solved anything.

---

## What v3 Changes — The Complete Data Flow

### Current v2 Flow (broken)

```
Agent manually calls /checkpoint save --topic "..." --summary "..."
    ↓
subprocess spawns memory-agent CLI (slow, fragile, env-dependent)
    ↓
Stores in ArangoDB lessons collection:
  problem: "CHECKPOINT: some topic"     ← vague, poor BM25
  solution: {files, decisions, git}     ← no grade, no skill chain
  tags: [checkpoint, session-state]     ← no taxonomy, no facets
    ↓
On outcome=success ONLY: regex scrapes /skill-name from summary text
    ↓
Stores chain with confidence=0.8 in scope=skill-chains
    ↓
/recommend-skill-chain has almost no data to serve
```

### New v3 Flow (the flywheel)

```
┌─────────────────────────────────────────────────────────────────┐
│  SOURCES (what happened in the session)                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  /episodic-archiver ──────────┐  ~/.claude/ memory ────────┐   │
│  (full transcript,             │  (curated session           │   │
│   failure episodes,            │   insights, feedback)       │   │
│   taxonomy, user profile)      │                             │   │
│                                │                             │   │
│  /mine-transcripts ───────────┤                             │   │
│  (skill chains extracted       │                             │   │
│   from raw conversation,       │                             │   │
│   emotional signals)           │                             │   │
│                                │                             │   │
│  Agent declares explicitly ───┤                             │   │
│  (--skills assess dogpile      │                             │   │
│   --grade 8                    │                             │   │
│   --grade-reason "clean fix")  │                             │   │
│                                ▼                             ▼   │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  /checkpoint save (v3)                                          │
│                                                                  │
│  1. Build structured problem text:                              │
│     "CHECKPOINT: 2026-03-26 [pi-mono] SPARTA threshold fix"    │
│     "Outcome: success | Branch: main"                           │
│     "Fixed false negative rate in QRA validation pipeline"      │
│                                                                  │
│  2. Build solution doc (v3 schema):                             │
│     { checkpoint_version: 3,                                    │
│       topic, summary, outcome,                                  │
│       grade: 8, grade_reason: "clean fix, no rework",          │
│       skills_used: [assess, dogpile, plan],                    │
│       session_id: "sess_abc123",                                │
│       episode_key: "ep_xyz789",                                 │
│       claude_memory_refs: ["feedback_threshold.md"],            │
│       evidence, files, decisions, next_steps, blockers, git }   │
│                                                                  │
│  3. POST /learn via httpx → Unix socket                         │
│     tags: [checkpoint, session-state, outcome:success,          │
│            project:pi-mono, date:2026-03-26, branch:main,       │
│            grade:8]                                              │
│                                                                  │
│  4. POST /taxonomy/batch-tag → assigns Mind + bridge tags       │
│     (Detect, Harden, Precision, Resilience)                     │
│                                                                  │
│  5. Store skill chain lesson:                                   │
│     problem: "SKILL-CHAIN: success for threshold-fix: ..."      │
│     solution: {chain: [assess,dogpile,plan], outcome: success,  │
│                confidence: 1.0, grade: 8}                       │
│     tags: [skill-chain, proven-success, project:pi-mono]        │
│                                                                  │
│  6. POST /add-edge → checkpoint_of → episode document           │
│                                                                  │
│  7. git commit + push BOTH project AND .pi/skills/              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  ArangoDB `lessons` collection                                  │
│                                                                  │
│  Now searchable via:                                            │
│                                                                  │
│  BM25:  "pi-mono SPARTA threshold 2026-03"                     │
│         → matches date, project, topic in problem text          │
│                                                                  │
│  Semantic: "how did we fix false negatives in QRA?"             │
│         → embedding similarity on problem+solution              │
│                                                                  │
│  Graph:  /trace from any Detect+Precision node                  │
│         → taxonomy edges connect checkpoint to related          │
│           SPARTA controls, CWEs, other lessons                  │
│                                                                  │
│  Tags:  POST /recall {tags: ["project:pi-mono", "grade:8"]}    │
│         → faceted filter without JSON parsing                   │
│                                                                  │
│  Edge:  checkpoint → episode → full transcript                  │
│         → one hop from checkpoint to every conversation turn    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────┐
│  /recommend-skill-chain                                         │
│                                                                  │
│  Future problem: "QRA validation is failing"                    │
│    ↓                                                            │
│  /memory recall {q: "QRA validation failing",                   │
│                   tags: ["skill-chain", "proven-success"]}      │
│    ↓                                                            │
│  Returns: chain=[assess, dogpile, plan], confidence=1.0,        │
│           grade=clean, outcome=success                          │
│    ↓                                                            │
│  Also returns: chain=[assess, hack], confidence=1.0,            │
│                grade=unresolved, outcome=failed, tag=proven-fail │
│    ↓                                                            │
│  Recommender ranks: clean/reusable high, unresolved/workaround  │
│  Agent gets: "Try /assess → /dogpile → /plan (clean solution).  │
│               Avoid /assess → /hack (unresolved)."              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Change-by-Change Detail

### Change 1: httpx Unix Socket Transport (replaces subprocess)

**What it replaces:** `_memory_agent()` function (lines 151-205) that spawns `python -m graph_memory.agent_cli` as a subprocess with custom `PYTHONPATH` and `ARANGO_DB` env vars.

**How v3 works:**
```python
import httpx

MEMORY_SOCKET = "/run/user/1000/embry/memory.sock"

def _memory_post(endpoint: str, payload: dict) -> dict:
    """POST to memory daemon via Unix socket."""
    transport = httpx.HTTPTransport(uds=MEMORY_SOCKET)
    with httpx.Client(transport=transport, timeout=httpx.Timeout(30.0, connect=5.0)) as client:
        resp = client.post(f"http://localhost{endpoint}", json=payload)
        resp.raise_for_status()
        return resp.json()
```

Then every call site changes from:
```python
# OLD: subprocess with env manipulation
result = _memory_agent("learn", ["--problem", problem_text, ...])

# NEW: direct HTTP POST
result = _memory_post("/learn", {
    "problem": problem_text,
    "solution": solution_text,
    "scope": scope_val,
    "tags": tag_list,
})
```

**What this fixes:** Eliminates the fragile subprocess chain (env vars, PYTHONPATH, timeout parsing, JSON extraction from mixed stdout). Direct HTTP is faster, has proper error codes, and matches the project convention (all daemon access via httpx).

**What could still go wrong:** If the daemon is down, checkpoint fails entirely. The subprocess approach had an implicit fallback (direct ArangoDB via agent_cli). v3 should print a clear error: "Memory daemon not running. Start with: systemctl --user start embry-memory"

**Risk level:** LOW — the daemon is systemd-managed and monitored by `/monitor-pi`.

---

### Change 2: Structured Problem Text for BM25

**What it replaces:** Line 429: `f"{CHECKPOINT_PREFIX} {topic}\n\n{summary}"`

**How v3 works:**
```python
# OLD
problem_text = f"CHECKPOINT: {topic}\n\n{summary}"

# NEW
problem_text = (
    f"CHECKPOINT: {timestamp[:10]} [{scope_val}] {topic}\n"
    f"Outcome: {outcome} | Branch: {git_ctx.get('branch', 'unknown')}\n\n"
    f"{summary}"
)
```

Example old: `"CHECKPOINT: SPARTA threshold fix\n\nFixed the bug"`
Example new: `"CHECKPOINT: 2026-03-26 [pi-mono] SPARTA threshold fix\nOutcome: success | Branch: main\n\nFixed false negative rate from 0.85 threshold in QRA validation pipeline"`

**What this fixes:** BM25 can now match on date ("2026-03"), project name ("pi-mono"), outcome ("success"), branch ("main"), AND topic+summary. Previously only topic and summary were searchable.

**What could still go wrong:** Scope detection might produce inconsistent names (e.g., "pi-mono" vs "experiments/pi-mono") causing BM25 to miss matches across sessions. Mitigation: `_detect_scope()` already normalizes from git remote URL.

**Risk level:** LOW — additive change, old checkpoints still parseable.

---

### Change 3: Faceted Tags

**What it replaces:** Lines 439-441: only `checkpoint`, `session-state`, `outcome:{outcome}`

**How v3 works:**
```python
tag_list = [
    "checkpoint",
    "session-state",
    f"outcome:{outcome}",
    f"project:{scope_val}",
    f"date:{timestamp[:10]}",
    f"branch:{git_ctx.get('branch', 'unknown')}",
]
if grade:
    tag_list.append(f"grade:{grade}")
```

**What this fixes:** The daemon's `/recall` endpoint accepts a `tags` filter parameter. With faceted tags, you can query: "show me all successful checkpoints for pi-mono graded 7+" without parsing JSON solution documents.

**What could still go wrong:** Tag proliferation. Over time, hundreds of unique `date:YYYY-MM-DD` tags accumulate. ArangoDB handles this fine, but it's worth knowing.

**Risk level:** LOW.

---

### Change 4: Taxonomy Tagging via /taxonomy/batch-tag

**What it replaces:** Nothing — checkpoints currently have zero taxonomy tags.

**How v3 works:**
```python
# After successful /learn, get the stored document key
doc_key = result.get("_key") or result.get("key")
if doc_key:
    try:
        _memory_post("/taxonomy/batch-tag", {
            "collection": "lessons",
            "keys": [doc_key],
        })
    except Exception:
        logger.warning("Taxonomy tagging failed — checkpoint still saved")
```

**What this fixes:** This is the critical gap. Without taxonomy tags, checkpoints are invisible to multi-hop graph traversal via `/trace`. A checkpoint about fixing a SPARTA grounding bug should connect to the Detect and Harden Mind tags, the Precision bridge, and related SPARTA controls. After this change, `/trace` can traverse from any taxonomy node → through bridge edges → to the checkpoint.

**What could still go wrong:** The `/taxonomy/batch-tag` endpoint might classify the checkpoint's problem text incorrectly if it's too short or generic. Mitigation: the structured problem text (Change 2) gives taxonomy more signal to work with.

**Risk level:** MEDIUM — taxonomy classification quality depends on problem text quality. Bad input → bad tags → wrong graph edges → misleading traversal results.

---

### Change 5: First-Class Skill Chain Declaration

**What it replaces:** `_store_successful_chains()` function (lines 354-375) that regex-scrapes `/skill-name` patterns from summary+decisions text, only on `outcome=success`, with hardcoded confidence=0.8.

**How v3 works:**

New CLI option:
```python
skills: Optional[list[str]] = typer.Option(None, "--skills", help="Skills used (repeatable)")
```

New storage logic:
```python
def _store_skill_chain(topic, skills_used, outcome, grade, scope):
    """Store skill chain for ALL outcomes — not just success."""
    confidence = 1.0 if skills_used else 0.8  # declared vs regex-scraped
    polarity = {
        "success": "proven-success",
        "partial": "partial-success",
        "failed": "proven-failure",
        "blocked": "proven-failure",
        "research": "research-chain",
    }
    tag = polarity.get(outcome, "unknown")

    _memory_post("/learn", {
        "problem": f"SKILL-CHAIN: {outcome} for: {topic}",
        "solution": json.dumps({
            "chain": skills_used,
            "task": topic,
            "outcome": outcome,
            "confidence": confidence,
            "grade": grade,
        }),
        "scope": "skill-chains",
        "tags": ["skill-chain", tag, f"project:{scope}"],
    })
```

**What this fixes:** Three problems at once:
1. **Explicit declaration** — agent says `--skills assess dogpile plan` instead of hoping regex catches mentions in free text
2. **All outcomes stored** — failed chains are NEGATIVE training signal. `/recommend-skill-chain` needs to know what NOT to recommend.
3. **Grade included** — a chain that produced a grade-8 solution ranks higher than one that produced grade-4.

**What could still go wrong:** Agents might not provide `--skills` consistently. Mitigation: fall back to regex extraction (existing behavior) when `--skills` is absent. The regex path still works, just at lower confidence.

**Risk level:** LOW — additive, backward compatible.

---

### Change 6: Session Grading (5-level rubric, graph-traversable)

**What it replaces:** Nothing — v2 has `outcome` (success/partial/failed) but no quality signal.

**How v3 works:** Five discrete grades, each a graph-traversable tag:

| Grade | Label | When to assign |
|-------|-------|---------------|
| 1 | `unresolved` | Problem not solved. Blockers remain. |
| 2 | `workaround` | Hack or temporary fix. Will break again. |
| 3 | `solved` | Solved with corrections or multiple attempts. |
| 4 | `clean` | Solved first try. No rework. Tests pass. |
| 5 | `reusable` | Generalizable — new skill, pattern, or reusable approach. |

```python
grade: Optional[str] = typer.Option(None, "--grade",
    help="unresolved|workaround|solved|clean|reusable")
auto_grade: bool = typer.Option(False, "--auto-grade",
    help="Auto-grade from session signals")
```

The `--auto-grade` flag runs a decision tree for the session-end hook:
```
Problem solved? NO → unresolved
Hack/temporary? YES → workaround
Corrections needed? YES → solved
Reusable beyond this problem? YES → reusable
Otherwise → clean
```

**Graph structure:** Each grade is a filterable tag (`grade:clean`) enabling:
```
/recall {tags: ["grade:clean", "project:pi-mono"]}
    → all first-try solutions in pi-mono

/trace from grade:reusable → graded_as → checkpoints → taxonomy → related controls
    → all generalizable solutions and what domains they apply to

/trace from grade:unresolved → checkpoints → episode → full transcript
    → all unsolved problems with conversation history
```

**What this fixes:** A 1-10 scale causes grade inflation (agents cluster at 6-8). Five discrete levels with observable criteria are deterministic — the decision tree produces the same grade regardless of which agent runs it.

**What could still go wrong:** The auto-grade decision tree might misclassify edge cases (e.g., a session that got corrections but the corrections were about scope, not quality). Mitigation: human can override with `--grade` flag.

**Risk level:** LOW — rubric version tracked for drift detection.

---

### Change 7: Git Commit BOTH Project AND Skills (NON-NEGOTIABLE)

**What it replaces:** `_git_commit_and_push()` (lines 287-351) which only commits the current project root.

**How v3 works:**
```python
def _git_commit_and_push(project_root: str, topic: str, files: list[str]) -> None:
    # 1. Commit project root (existing behavior)
    _commit_repo(project_root, topic, files)

    # 2. Commit skills directory (NEW)
    skills_root = _git(["rev-parse", "--show-toplevel"],
                       cwd=os.path.join(project_root, ".pi", "skills"))
    if skills_root and skills_root != project_root:
        # Skills is a separate repo — commit it too
        _commit_repo(skills_root, topic, [])
    # If same repo, the project commit already covers skills
```

**What this fixes:** Skills change during sessions (new SKILL.md, updated run.sh, fixed Python files) and are NEVER committed unless someone explicitly does it. This mirrors the App.tsx incident — critical files wiped because they were never committed.

**What could still go wrong:** If `.pi/skills/` is a symlink to a canonical dir in a different git repo, the commit might fail if there are untracked files that `git add -u` doesn't catch. Mitigation: use `git add -u` which only stages tracked files.

**Risk level:** LOW — worst case, push fails and we log a warning.

---

### Change 8: ~/.claude/ Memory Bridge

**What it replaces:** Nothing — v2 has no connection to Claude Code's memory system.

**How v3 works:**
```python
# Map scope to Claude project dir
claude_project_dir = Path.home() / ".claude" / "projects" / f"-{project_root.replace('/', '-')}" / "memory"
if claude_project_dir.exists():
    memory_md = claude_project_dir / "MEMORY.md"
    # Scan for feedback_*.md and project_*.md modified since last checkpoint
    for md_file in claude_project_dir.glob("*.md"):
        if md_file.name == "MEMORY.md":
            continue
        # Add filename + first line as cross-reference to evidence
        evidence.append(f"claude-memory:{md_file.name}")
```

**What this fixes:** Claude Code has 16 project memory directories with 1,847 lines of curated insights (feedback rules, architecture decisions, project state). These are invisible to ArangoDB. After this change, checkpoints reference which Claude Code memory files were active at the time, creating a cross-reference bridge.

**What could still go wrong:** The path mapping assumes the project root maps to the Claude project dir via a `-` substitution pattern. If Claude Code changes its directory naming convention, this breaks. Mitigation: log a warning if the dir doesn't exist.

**Risk level:** LOW — purely additive metadata.

---

### Change 9: /mine-transcripts Integration

**What it replaces:** The regex skill chain extraction (lines 358-362).

**How v3 works:** When `--mine-session` flag is set, checkpoint calls `/mine-transcripts` to extract:
- Skill chains from the raw conversation (higher quality than regex)
- Emotional signals (satisfied/frustrated → Heart taxonomy)
- Bridge labels from the conversation text

This is a CALL to an existing skill, not reimplementation. `/mine-transcripts` already knows how to parse `~/.claude/projects/`, `~/.codex/`, and `~/.pi/` transcripts.

**What this fixes:** Currently skill chains are regex-scraped from the summary text the agent writes. `/mine-transcripts` extracts chains from the ACTUAL conversation — what skills were really invoked, not what the agent claims it used.

**What could still go wrong:** `/mine-transcripts` may not have the latest session available yet (file write timing). Mitigation: this is a fallback for when `--skills` is not provided.

**Risk level:** MEDIUM — depends on `/mine-transcripts` having access to current session data.

---

### Change 10: Episodic Archiver Linkage

**What it replaces:** Nothing — no connection exists.

**How v3 works:**
```python
session_id: Optional[str] = typer.Option(None, "--session-id")
episode_key: Optional[str] = typer.Option(None, "--episode-key")

# After storing checkpoint, create graph edge
if episode_key:
    _memory_post("/add-edge", {
        "from_title": problem_text,
        "to_title": episode_key,
        "type": "checkpoint_of",
        "weight": 0.9,
        "rationale": "Checkpoint grading of archived episode",
    })
```

**What this fixes:** Creates a one-hop graph edge from checkpoint → episodic archive. `/trace` can now traverse: checkpoint (graded solution) → episode (full transcript with every conversation turn) → failure episodes → user profile. This is the connection that makes "what happened in that session?" answerable from a checkpoint recall.

**What could still go wrong:** The `/add-edge` endpoint resolves by title, not by `_key`. If the episode title doesn't match, the edge creation fails silently. Mitigation: log the result and warn if edge creation fails.

**Risk level:** MEDIUM — depends on episode_key being correct and the episode existing in ArangoDB.

---

## Expert Commentary

**Embry Lawson** — Project Manager / System Architect

> **What I'm satisfied with:**
> - The httpx migration is straightforward — the daemon endpoints already exist, this is just wiring
> - Faceted tags are the right approach for filtering without JSON parsing
> - Storing failed chains as negative signal is critical — you can't recommend if you don't know what failed
> - Git commit of both project AND skills closes the most dangerous gap in the current system
>
> **What concerns me:**
> - **Automation gap**: The plan still requires agents to manually call `/checkpoint save` with all the right flags. The real goal is AUTOMATIC cataloging of every session. Where is the trigger? Should `/episodic-archiver` call `/checkpoint` as a post-archive hook? Or should a nightly job sweep archived episodes and generate checkpoints?
> - **Grade subjectivity**: Without a rubric, grades are meaningless. What makes a session grade-8 vs grade-5? The flywheel needs CONSISTENT grading to produce useful recommendations.
> - **Cold start**: `/recommend-skill-chain` needs hundreds of graded chains before it can make useful recommendations. How long until the system is useful? What's the bootstrap plan?
>
> **What I'd watch for in the first week:**
> - Are agents actually providing `--skills` and `--grade`, or falling back to regex every time?
> - Are taxonomy tags being assigned correctly, or is every checkpoint getting generic Detect+Model?
> - Is the problem text structured enough for BM25 to distinguish similar-but-different problems?

---

## Risk Matrix

| Change | Fixes | Risk | Observable Failure |
|--------|-------|------|--------------------|
| httpx transport | Subprocess fragility | LOW | `ConnectionRefusedError` if daemon down |
| Structured problem text | BM25 findability | LOW | Recall returns wrong checkpoint for query |
| Faceted tags | Filtering without JSON parse | LOW | Tag proliferation over months |
| Taxonomy batch-tag | Graph traversal visibility | **MEDIUM** | Wrong Mind/bridge tags → misleading traversal |
| First-class skill chains | Recommendation accuracy | LOW | Agents don't provide --skills flag |
| Session grading | Chain ranking signal | LOW | Grade inflation without rubric |
| Git commit both repos | Work loss prevention | LOW | Push fails on network error |
| ~/.claude/ memory bridge | Cross-system reference | LOW | Path mapping breaks on dir rename |
| /mine-transcripts | Automated chain extraction | **MEDIUM** | Session not available yet at mine time |
| Episodic archiver linkage | Full transcript access | **MEDIUM** | Edge creation fails on title mismatch |

---

## Remaining Risks (Honest Assessment)

### Risk 1: The Automation Gap (RESOLVED — dual trigger)

Two redundant triggers ensure every session is cataloged:

**Trigger 1 (agent-initiated):** The agent calls `/checkpoint save` at the end of significant sessions. The SKILL.md triggers list includes "save where we left off" — agents and humans can invoke it explicitly. The `--auto-grade` and `--mine-session` flags minimize manual input.

**Trigger 2 (nightly sweep):** `/episodic-archiver` (via `/monitor-episodic-archiver` nightly job) archives all sessions. A post-archive step checks if a checkpoint exists for each session_id. If not, it creates one from the archived episode with `--auto-grade --mine-session --ingest-claude-memory`. This is the safety net — catches sessions where trigger 1 was skipped.

**Note:** Claude Code does not currently have a reliable "session end" hook event. Sessions can end by the user closing the terminal, which triggers no hooks. The nightly sweep is the reliable path until Claude Code adds session lifecycle events.

### Risk 2: Grade Consistency (RESOLVED)

The 5-level rubric with a deterministic decision tree replaces the subjective 1-10 scale. The `--auto-grade` flag runs the same decision tree regardless of which agent calls it. Rubric version tracked in `solution_doc.rubric_version` for drift detection when the rubric evolves. See `RUBRIC.md` in the checkpoint skill dir.

### Risk 3: Cold Start (LOW)

The system needs ~100+ graded chains before `/recommend-skill-chain` provides value. At 3-5 sessions/day, that's 3-5 weeks. During cold start, recommendations will be sparse. Not a blocker — the system is still useful for `/memory recall` from day one.

---

## What Success Looks Like

| Metric | Healthy | Warning | Sick |
|--------|---------|---------|------|
| Checkpoints/week | 15+ | 5-15 | <5 (nobody using it) |
| % with --skills declared | >60% | 30-60% | <30% (falling back to regex) |
| % with grade (auto or manual) | >80% | 50-80% | <50% (auto-grade not wired) |
| % with taxonomy tags | >90% | 70-90% | <70% (batch-tag failing) |
| /recommend-skill-chain useful hits | >1/day | 1/week | never |
| BM25 recall precision@3 | >0.7 | 0.4-0.7 | <0.4 (problem text too vague) |

---

## Bottom Line

**Will it work?** Yes, for the data model and searchability improvements. The httpx transport, structured problem text, faceted tags, taxonomy tagging, and skill chain storage are all straightforward wiring to existing daemon endpoints. The technical risk is low.

**What's genuinely different this time?**
1. Checkpoints become searchable via ALL three retrieval methods (BM25, semantic, graph)
2. Skill chains are stored with outcome polarity — failures are negative signal
3. Session grading adds a ranking dimension for recommendations
4. Git commit covers both project AND skills on every save
5. Graph edges link checkpoints to full episode transcripts

**What's the same?** Nothing — v3 closes the automation gap with dual triggers. A Claude Code session-end hook spawns `/subagent-service` in the background to checkpoint every session in real-time. Nightly `/episodic-archiver` enriches with episode linkage or creates missing checkpoints as fallback. No manual intervention. The flywheel is self-sustaining.

**What should come AFTER v3?**
- A grading rubric stored in `/memory` for consistent scoring (nightly auto-checkpoints leave grade=null for human backfill)
- `/conversation-lab` integration to validate that checkpoints actually improve recommendation quality
- Backfill: run `/episodic-archiver` archives through the new checkpoint hook to bootstrap `/recommend-skill-chain` with historical data

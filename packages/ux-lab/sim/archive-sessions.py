"""
archive-sessions.py — Archives BinaryExplorer interaction sessions to episodic memory.

Pipeline:
  1. Read batch results JSONL (from run-batch.cjs)
  2. Group by session (each CLEAR→commands→result is a session)
  3. Format as episodic-archiver transcript format
  4. Call /episodic-archiver archive for each session
  5. Tag with: binary-explorer, sim-training, batch-id, accuracy

Enables /conversation-lab to analyze interaction patterns cross-session.

Usage:
    python3 packages/ux-lab/sim/archive-sessions.py --dry-run
    python3 packages/ux-lab/sim/archive-sessions.py --results /tmp/batch-results.jsonl
    python3 packages/ux-lab/sim/archive-sessions.py \\
        --results /tmp/batch-results.jsonl \\
        --batch-id my-run-001 \\
        --user-id sim
"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Optional

import typer
from loguru import logger

# ── Logging setup ─────────────────────────────────────────────────────────────
logger.remove()
logger.add(
    sys.stderr,
    level="INFO",
    format="<green>{time:HH:mm:ss}</green> | {level} | {message}",
)

app = typer.Typer(
    help="Archive BinaryExplorer sim sessions to episodic memory via /episodic-archiver"
)

# ── Skill path resolution ─────────────────────────────────────────────────────
_THIS_FILE = Path(__file__).resolve()
# packages/ux-lab/sim/archive-sessions.py  →  project root is 3 levels up
_PROJECT_ROOT = _THIS_FILE.parent.parent.parent.parent
_EPISODIC_RUN_SH = _PROJECT_ROOT / ".pi" / "skills" / "episodic-archiver" / "run.sh"

# ── Default constant tags ──────────────────────────────────────────────────────
TAG_BINARY_EXPLORER = "binary-explorer"
TAG_SIM_TRAINING    = "sim-training"

# ── Dry-run mock data ─────────────────────────────────────────────────────────
_DRY_RESULTS: list[dict] = [
    {
        "command": "Please select the Session Notification node in the graph.",
        "expected": {
            "expected_action": "SELECT_NODE",
            "expected_target": "droid:session_notification",
        },
        "actual_queryspec": {
            "action": "SELECT_NODE",
            "target_node_id": "droid:session_notification",
        },
        "scene_count": "1/10 in scene",
        "clarify_triggered": False,
        "screenshot_path": None,
        "is_voice": False,
        "errors": [],
        "ts_ms": 1711234567890,
    },
    {
        "command": "show everything",
        "expected": {"expected_action": "VIEW_ALL"},
        "actual_queryspec": {"action": "VIEW_ALL"},
        "scene_count": "10/10 in scene",
        "clarify_triggered": False,
        "screenshot_path": None,
        "is_voice": False,
        "errors": [],
        "ts_ms": 1711234568000,
    },
    {
        "command": "Please switch to the security perspective.",
        "expected": {
            "expected_action": "SET_PERSPECTIVE",
            "expected_target": "security",
        },
        "actual_queryspec": {"action": "SET_PERSPECTIVE", "target": "data_flow"},
        "scene_count": None,
        "clarify_triggered": False,
        "screenshot_path": None,
        "is_voice": False,
        "errors": [],
        "ts_ms": 1711234569000,
    },
]

# ── JSONL loader ───────────────────────────────────────────────────────────────

def load_jsonl(path: Path) -> list[dict]:
    """Load a JSONL file; skip blank or malformed lines."""
    records: list[dict] = []
    with path.open("r") as fh:
        for lineno, raw in enumerate(fh, start=1):
            raw = raw.strip()
            if not raw:
                continue
            try:
                records.append(json.loads(raw))
            except json.JSONDecodeError as exc:
                logger.warning(
                    "Skipping malformed JSONL line {} in {}: {}", lineno, path, exc
                )
    return records

# ── Accuracy helpers ───────────────────────────────────────────────────────────

_ACTUAL_ACTION_FIELDS = ["action", "ui_action", "intent", "type"]
_ACTUAL_TARGET_FIELDS = ["target_node_id", "target", "node_id", "entity", "target_id"]


def _get_field(obj: dict | None, candidates: list[str]) -> str | None:
    if not obj:
        return None
    for key in candidates:
        val = obj.get(key)
        if val is not None:
            return str(val).strip()
    return None


def compute_accuracy(result: dict) -> float:
    """Compute session accuracy (0.0 or 1.0) from a single batch result record.

    Dimensions checked (where data is available):
      - no_crash      : len(errors) == 0
      - action_match  : actual action == expected action (if both present)
      - target_match  : actual target == expected target (if expected provided)
      - clarify_ok    : clarify trigger matches expectation (if expected provided)
    """
    errors = result.get("errors") or []
    no_crash = len(errors) == 0

    actual_qs  = result.get("actual_queryspec")
    expected   = result.get("expected") or {}

    actual_action   = _get_field(actual_qs, _ACTUAL_ACTION_FIELDS)
    expected_action = str(expected.get("expected_action", "")).strip().upper()

    if actual_action and expected_action:
        action_match = actual_action.upper() == expected_action
    else:
        # No expected action to check — treat as not blocking
        action_match = True

    actual_target   = _get_field(actual_qs, _ACTUAL_TARGET_FIELDS)
    expected_target = expected.get("expected_target")

    if expected_target is None:
        target_match = True
    elif actual_target is None:
        target_match = False
    else:
        def _norm(s: str) -> str:
            return s.strip().lower()
        a_n = _norm(actual_target)
        e_n = _norm(str(expected_target))
        target_match = (
            a_n == e_n
            or a_n.endswith(f":{e_n}")
            or e_n.endswith(f":{a_n}")
        )

    expects_clarify  = bool(expected.get("clarify_trigger"))
    actual_clarified = bool(result.get("clarify_triggered"))
    if expects_clarify:
        clarify_ok = actual_clarified
    else:
        clarify_ok = not actual_clarified

    passed = no_crash and action_match and target_match and clarify_ok
    return 1.0 if passed else 0.0


# ── Transcript builder ─────────────────────────────────────────────────────────

def build_transcript(
    result: dict,
    session_id: str,
    batch_id: str,
    user_id: str,
    accuracy: float,
) -> dict:
    """Build an episodic-archiver transcript from a single batch result record.

    Each batch result represents one CLEAR→command→response session.
    The transcript has two turns:
      1. User: the natural-language command
      2. Agent: the QuerySpec response (or clarify prompt)

    Tags embedded at top level for archiver enrichment:
      binary-explorer, sim-training, <batch_id>, accuracy:<value>
    """
    ts_s = int(result.get("ts_ms", int(time.time() * 1000))) // 1000

    command = result.get("command", "").strip()
    actual_qs = result.get("actual_queryspec")
    errors    = result.get("errors") or []
    clarify   = result.get("clarify_triggered", False)
    is_voice  = result.get("is_voice", False)

    # ── Format agent response content ─────────────────────────────────────────
    if clarify:
        agent_content = "Did you mean? [clarify triggered — ambiguous entity]"
    elif actual_qs:
        agent_content = f"QuerySpec: {json.dumps(actual_qs, separators=(',', ':'))}"
    else:
        agent_content = "[no QuerySpec produced]"

    if errors:
        error_summary = "; ".join(str(e) for e in errors[:3])
        agent_content += f" | errors: {error_summary}"

    # ── Build messages ─────────────────────────────────────────────────────────
    command_type = "voice" if is_voice else "text"
    messages = [
        {
            "from":      "User",
            "content":   command,
            "timestamp": ts_s,
            "type":      command_type,
            "category":  "Task",
        },
        {
            "from":      "Agent",
            "content":   agent_content,
            "timestamp": ts_s + 1,
            "type":      "text",
            "category":  "Solution" if not errors else "Error",
        },
    ]

    # ── Assemble transcript ────────────────────────────────────────────────────
    tags = [
        TAG_BINARY_EXPLORER,
        TAG_SIM_TRAINING,
        f"batch-id:{batch_id}",
        f"accuracy:{accuracy:.2f}",
    ]

    binary = result.get("binary") or (
        # Attempt to derive from expected target (e.g. "droid:session_notification")
        (result.get("expected") or {}).get("expected_target", "").split(":")[0]
        or "unknown"
    )
    if binary and binary != "unknown":
        tags.append(f"binary:{binary}")

    difficulty = (result.get("expected") or {}).get("difficulty")
    if difficulty:
        tags.append(f"difficulty:{difficulty}")

    return {
        "session_id": session_id,
        "user_id":    user_id,
        "persona_id": "binary-explorer",
        "messages":   messages,
        "tags":       tags,
        "metadata": {
            "batch_id":          batch_id,
            "accuracy":          accuracy,
            "binary":            binary,
            "is_voice":          is_voice,
            "clarify_triggered": clarify,
            "error_count":       len(errors),
            "scene_count":       result.get("scene_count"),
            "expected_action":   (result.get("expected") or {}).get("expected_action"),
            "expected_target":   (result.get("expected") or {}).get("expected_target"),
            "actual_queryspec":  actual_qs,
        },
    }


# ── Episodic-archiver ingest ───────────────────────────────────────────────────

def ingest_session(transcript: dict, dry_run: bool) -> bool:
    """Write transcript to temp file and call episodic-archiver archive.

    Returns True on success.
    """
    session_id = transcript["session_id"]

    if dry_run:
        logger.info(
            "[dry-run] Would ingest session {} ({} messages, tags={})",
            session_id,
            len(transcript.get("messages", [])),
            transcript.get("tags", []),
        )
        logger.debug("[dry-run] transcript: {}", json.dumps(transcript, indent=2))
        return True

    if not _EPISODIC_RUN_SH.exists():
        logger.error(
            "episodic-archiver not found at {} — cannot ingest",
            _EPISODIC_RUN_SH,
        )
        return False

    with tempfile.NamedTemporaryFile(
        mode="w",
        suffix=".json",
        prefix=f"sim-session-{session_id}-",
        delete=False,
    ) as tmp:
        json.dump(transcript, tmp, indent=2)
        tmp_path = Path(tmp.name)

    try:
        result = subprocess.run(
            ["bash", str(_EPISODIC_RUN_SH), "archive", str(tmp_path)],
            capture_output=True,
            text=True,
            timeout=60,
        )
        if result.returncode == 0:
            logger.info("Ingested session {}", session_id)
            if result.stdout.strip():
                logger.debug("archiver stdout: {}", result.stdout.strip())
            return True
        else:
            logger.error(
                "episodic-archiver failed for session {} (exit {}): {}",
                session_id,
                result.returncode,
                result.stderr.strip() or result.stdout.strip(),
            )
            return False
    except subprocess.TimeoutExpired:
        logger.error("episodic-archiver timed out for session {}", session_id)
        return False
    except Exception as exc:
        logger.error("Unexpected error ingesting session {}: {}", session_id, exc)
        return False
    finally:
        try:
            tmp_path.unlink()
        except OSError:
            pass


# ── CLI ────────────────────────────────────────────────────────────────────────

@app.command()
def main(
    results: Optional[Path] = typer.Option(
        None,
        "--results", "-r",
        help="JSONL output from run-batch.cjs (batch interaction results)",
    ),
    batch_id: Optional[str] = typer.Option(
        None,
        "--batch-id",
        help="Unique batch identifier for tagging (auto-generated if omitted)",
    ),
    user_id: str = typer.Option(
        "sim",
        "--user-id",
        help="User ID to tag sessions with (default: sim)",
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Parse and format sessions but do not call episodic-archiver",
    ),
    limit: Optional[int] = typer.Option(
        None,
        "--limit",
        help="Max sessions to ingest (default: all)",
    ),
    min_accuracy: Optional[float] = typer.Option(
        None,
        "--min-accuracy",
        help="Skip sessions with accuracy below this threshold (0.0–1.0)",
    ),
    report_json: bool = typer.Option(
        False,
        "--report-json",
        help="Print JSON summary to stdout after archival",
    ),
    verbose: bool = typer.Option(
        False,
        "--verbose", "-v",
        help="Log transcript details for every session",
    ),
) -> None:
    """Archive BinaryExplorer sim sessions to /episodic-archiver for cross-session analysis.

    Each batch result record represents one CLEAR→command→response session.
    Sessions are formatted as episodic-archiver transcripts and archived individually.

    Tags applied per session:
      binary-explorer, sim-training, batch-id:<id>, accuracy:<0.00-1.00>
    """
    # ── Resolve batch ID ───────────────────────────────────────────────────────
    if batch_id is None:
        batch_id = f"sim-{uuid.uuid4().hex[:8]}"
        logger.info("Generated batch-id: {}", batch_id)
    else:
        logger.info("Using batch-id: {}", batch_id)

    # ── Load records ───────────────────────────────────────────────────────────
    if dry_run and results is None:
        logger.info("[dry-run] Using built-in mock data ({} records)", len(_DRY_RESULTS))
        records = _DRY_RESULTS
    else:
        if results is None:
            logger.error("--results is required (or use --dry-run without --results)")
            raise typer.Exit(1)
        if not results.exists():
            logger.error("Results file not found: {}", results)
            raise typer.Exit(1)
        records = load_jsonl(results)
        logger.info("Loaded {} result records from {}", len(records), results)

    if not records:
        logger.error("No records found — nothing to archive")
        raise typer.Exit(1)

    # ── Apply limit ────────────────────────────────────────────────────────────
    if limit is not None and limit > 0:
        records = records[:limit]
        logger.info("Limiting to first {} records", limit)

    # ── Process each record as its own session ─────────────────────────────────
    # Each batch result represents one CLEAR→command→result session.
    # Session ID: {batch_id}-{zero-padded-index}
    total     = len(records)
    ingested  = 0
    skipped   = 0
    failed    = 0
    acc_total = 0.0

    sep = "─" * 60
    logger.info("{}", sep)
    logger.info("ARCHIVE-SESSIONS  batch={} total={} dry={}", batch_id, total, dry_run)
    logger.info("{}", sep)

    for idx, record in enumerate(records):
        session_id = f"{batch_id}-{idx:04d}"
        accuracy   = compute_accuracy(record)
        acc_total += accuracy

        if min_accuracy is not None and accuracy < min_accuracy:
            logger.debug(
                "Skipping session {} — accuracy {:.2f} < threshold {:.2f}",
                session_id, accuracy, min_accuracy,
            )
            skipped += 1
            continue

        transcript = build_transcript(
            result=record,
            session_id=session_id,
            batch_id=batch_id,
            user_id=user_id,
            accuracy=accuracy,
        )

        if verbose:
            logger.info(
                "Session {} | cmd={!r:.50} | accuracy={:.2f} | tags={}",
                session_id,
                record.get("command", ""),
                accuracy,
                transcript.get("tags", []),
            )

        ok = ingest_session(transcript, dry_run=dry_run)
        if ok:
            ingested += 1
        else:
            failed += 1

    # ── Summary ────────────────────────────────────────────────────────────────
    avg_accuracy = acc_total / total if total > 0 else 0.0

    logger.info("{}", sep)
    logger.info("ARCHIVE-SESSIONS COMPLETE")
    logger.info("  batch-id   : {}", batch_id)
    logger.info("  total      : {}", total)
    logger.info("  ingested   : {}", ingested)
    logger.info("  skipped    : {}", skipped)
    logger.info("  failed     : {}", failed)
    logger.info("  avg-acc    : {:.1f}%", avg_accuracy * 100)
    logger.info("{}", sep)

    if report_json:
        summary = {
            "batch_id":     batch_id,
            "total":        total,
            "ingested":     ingested,
            "skipped":      skipped,
            "failed":       failed,
            "avg_accuracy": round(avg_accuracy, 4),
            "dry_run":      dry_run,
        }
        sys.stdout.write(json.dumps(summary, indent=2) + "\n")

    if failed > 0 and not dry_run:
        logger.warning("{} session(s) failed to ingest — check episodic-archiver logs", failed)
        raise typer.Exit(1)


if __name__ == "__main__":
    app()

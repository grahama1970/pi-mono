"""
grade-batch.py — Blind QuerySpec grader for BinaryExplorer intent evaluation.

Compares actual interaction results (from run-batch.cjs) against expected
QuerySpec ground truth (from generate-commands.py).  Blind grading: the
evaluator (evaluate-interaction.cjs) never sees expected answers; only this
grader performs the comparison.

Grading dimensions per interaction:
  - action_match    : actual_queryspec.action == expected_action
  - target_match    : actual_queryspec target resolves to expected entity key
  - clarify_correct : if ambiguous entity, did /memory clarify trigger?
  - no_crash        : zero runtime errors in result.errors[]

Output:
  - Console: accuracy %, action accuracy, entity resolution rate, clarify rate
  - JSONL: labeled pairs  { problem, solution, tags: [positive|negative] }
  - ArangoDB: labeled pairs stored to ux_lab_training_pairs collection

Usage:
    python3 grade-batch.py --dry-run
    python3 grade-batch.py --results /tmp/batch-results.jsonl \\
                           --expected commands.jsonl \\
                           --output /tmp/labeled-pairs.jsonl
    python3 grade-batch.py --results /tmp/batch-results.jsonl --store-arango
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path
from typing import Optional

import typer
from loguru import logger

# ── Remove default stderr handler; add clean stderr for logs ──────────────────
logger.remove()
logger.add(
    sys.stderr,
    level="INFO",
    format="<green>{time:HH:mm:ss}</green> | {level} | {message}",
)

app = typer.Typer(help="Grade BinaryExplorer interaction results against expected QuerySpecs")

# ── ArangoDB / memory daemon config ──────────────────────────────────────────
MEMORY_SOCK = "/run/user/1000/embry/memory.sock"
MEMORY_URL  = "http://127.0.0.1:8601"
TRAINING_COLLECTION = "ux_lab_training_pairs"

# ── QuerySpec action field names (actual may vary by app version) ─────────────
ACTUAL_ACTION_FIELDS  = ["action", "ui_action", "intent", "type"]
ACTUAL_TARGET_FIELDS  = ["target_node_id", "target", "node_id", "entity", "target_id"]

# ── Dry-run mock data ─────────────────────────────────────────────────────────

_DRY_EXPECTED: list[dict] = [
    {
        "command": "Please select the Session Notification node in the graph.",
        "expected_action": "SELECT_NODE",
        "expected_target": "droid:session_notification",
        "difficulty": "easy",
        "variation": "formal",
        "binary": "droid",
    },
    {
        "command": "show everything",
        "expected_action": "VIEW_ALL",
        "difficulty": "easy",
        "variation": "casual",
        "binary": "droid",
    },
    {
        "command": "Please switch to the security perspective.",
        "expected_action": "SET_PERSPECTIVE",
        "expected_target": "security",
        "difficulty": "easy",
        "variation": "formal",
        "binary": "droid",
    },
    {
        "command": "select the notification node",
        "expected_action": "SELECT_NODE",
        "expected_target": None,
        "difficulty": "hard",
        "variation": "ambiguous",
        "binary": "droid",
        "clarify_trigger": True,
        "clarify_reason": "matches session_notification AND worker_notification",
    },
    {
        "command": "expand the automation namespace",
        "expected_action": "EXPAND",
        "expected_target": "droid:automation",
        "difficulty": "easy",
        "variation": "formal",
        "binary": "droid",
    },
]

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
    {
        "command": "select the notification node",
        "expected": {
            "expected_action": "SELECT_NODE",
            "expected_target": None,
            "clarify_trigger": True,
        },
        "actual_queryspec": None,
        "scene_count": None,
        "clarify_triggered": True,
        "screenshot_path": None,
        "is_voice": False,
        "errors": [],
        "ts_ms": 1711234570000,
    },
    {
        "command": "expand the automation namespace",
        "expected": {
            "expected_action": "EXPAND",
            "expected_target": "droid:automation",
        },
        "actual_queryspec": {
            "action": "EXPAND",
            "target_node_id": "droid:automation",
        },
        "scene_count": None,
        "clarify_triggered": False,
        "screenshot_path": None,
        "is_voice": False,
        "errors": ["runtime: TypeError: cannot read property 'x' of undefined"],
        "ts_ms": 1711234571000,
    },
]

# ── Data loading ──────────────────────────────────────────────────────────────

def load_jsonl(path: Path) -> list[dict]:
    """Load a JSONL file into a list of dicts.  Skips blank / malformed lines."""
    records: list[dict] = []
    with path.open("r") as fh:
        for lineno, raw in enumerate(fh, start=1):
            raw = raw.strip()
            if not raw:
                continue
            try:
                records.append(json.loads(raw))
            except json.JSONDecodeError as exc:
                logger.warning("Skipping malformed JSONL line {} in {}: {}", lineno, path, exc)
    return records


def build_expected_index(expected_records: list[dict]) -> dict[str, dict]:
    """Build a command → expected-record lookup map.

    Duplicate commands (same text, different variation) are resolved by
    preferring records that explicitly set clarify_trigger=True, then the
    first occurrence.
    """
    index: dict[str, dict] = {}
    for rec in expected_records:
        cmd = rec.get("command", "").strip()
        if not cmd:
            continue
        existing = index.get(cmd)
        if existing is None:
            index[cmd] = rec
        elif rec.get("clarify_trigger") and not existing.get("clarify_trigger"):
            # Prefer clarify-trigger variant so we don't miss ambiguity cases
            index[cmd] = rec
    return index

# ── QuerySpec field extraction ─────────────────────────────────────────────────

def _get_field(obj: dict | None, candidates: list[str]) -> str | None:
    """Return the first matching field value from obj, normalised to str."""
    if not obj:
        return None
    for key in candidates:
        val = obj.get(key)
        if val is not None:
            return str(val).strip()
    return None


def extract_actual_action(actual_qs: dict | None) -> str | None:
    """Extract the action string from an actual QuerySpec dict."""
    return _get_field(actual_qs, ACTUAL_ACTION_FIELDS)


def extract_actual_target(actual_qs: dict | None) -> str | None:
    """Extract the target entity key/id from an actual QuerySpec dict."""
    return _get_field(actual_qs, ACTUAL_TARGET_FIELDS)

# ── Grading ───────────────────────────────────────────────────────────────────

def grade_pair(result: dict, expected: dict) -> dict:
    """Grade a single actual-vs-expected pair.

    Returns a grading dict with per-dimension booleans and derived label.

    Grading dimensions:
      action_match    — actual action matches expected action (case-insensitive)
      target_match    — actual target matches expected target key (or both None)
      clarify_correct — if clarify_trigger expected, was clarify_triggered actual?
      no_crash        — zero errors[] in result

    The overall label is 'positive' iff all applicable dimensions pass.
    """
    actual_qs = result.get("actual_queryspec")
    errors     = result.get("errors") or []

    # ── Dimension: no_crash ───────────────────────────────────────────────────
    no_crash = len(errors) == 0

    # ── Dimension: action_match ───────────────────────────────────────────────
    actual_action   = extract_actual_action(actual_qs)
    expected_action = str(expected.get("expected_action", "")).strip().upper()
    if actual_action and expected_action:
        action_match = actual_action.upper() == expected_action
    else:
        # If we have no expected action at all, treat as N/A (skip grading)
        action_match = actual_action is not None and expected_action == ""

    # ── Dimension: target_match ───────────────────────────────────────────────
    actual_target   = extract_actual_target(actual_qs)
    expected_target = expected.get("expected_target")

    if expected_target is None:
        # No specific target required (VIEW_ALL, clarify cases, etc.)
        target_match = True
    elif actual_target is None:
        target_match = False
    else:
        # Normalise: strip binary prefix for flexible matching
        # e.g. "droid:session_notification" matches "session_notification"
        def _norm(s: str) -> str:
            return s.strip().lower()
        a_norm = _norm(actual_target)
        e_norm = _norm(str(expected_target))
        target_match = a_norm == e_norm or a_norm.endswith(f":{e_norm}") or e_norm.endswith(f":{a_norm}")

    # ── Dimension: clarify_correct ────────────────────────────────────────────
    expects_clarify  = bool(expected.get("clarify_trigger"))
    actual_clarified = bool(result.get("clarify_triggered"))

    if expects_clarify:
        clarify_correct = actual_clarified
    else:
        # If clarify was NOT expected but triggered, that's a false-positive —
        # mark it as incorrect so we can learn from it.
        clarify_correct = not actual_clarified

    # ── Overall label ─────────────────────────────────────────────────────────
    label = "positive" if (action_match and target_match and clarify_correct and no_crash) else "negative"

    return {
        "command":         result.get("command", ""),
        "difficulty":      expected.get("difficulty", "unknown"),
        "variation":       expected.get("variation", "unknown"),
        "binary":          expected.get("binary", "unknown"),
        "expected_action": expected_action,
        "expected_target": expected_target,
        "actual_action":   actual_action,
        "actual_target":   actual_target,
        "action_match":    action_match,
        "target_match":    target_match,
        "clarify_correct": clarify_correct,
        "no_crash":        no_crash,
        "errors":          errors,
        "label":           label,
    }


def compute_metrics(graded: list[dict]) -> dict:
    """Compute aggregate accuracy metrics from a list of graded records."""
    if not graded:
        return {
            "total": 0,
            "accuracy_pct": 0.0,
            "action_accuracy_pct": 0.0,
            "entity_resolution_rate_pct": 0.0,
            "clarify_rate_pct": 0.0,
            "crash_rate_pct": 0.0,
            "positive_count": 0,
            "negative_count": 0,
        }

    n = len(graded)
    positive        = sum(1 for g in graded if g["label"] == "positive")
    action_ok       = sum(1 for g in graded if g["action_match"])
    target_ok       = sum(1 for g in graded if g["target_match"])
    clarify_ok      = sum(1 for g in graded if g["clarify_correct"])
    no_crash_ok     = sum(1 for g in graded if g["no_crash"])

    return {
        "total":                       n,
        "accuracy_pct":                round(positive / n * 100, 2),
        "action_accuracy_pct":         round(action_ok / n * 100, 2),
        "entity_resolution_rate_pct":  round(target_ok / n * 100, 2),
        "clarify_rate_pct":            round(clarify_ok / n * 100, 2),
        "crash_rate_pct":              round((n - no_crash_ok) / n * 100, 2),
        "positive_count":              positive,
        "negative_count":              n - positive,
    }


def breakdown_by_difficulty(graded: list[dict]) -> dict[str, dict]:
    """Per-difficulty-level accuracy breakdown."""
    groups: dict[str, list[dict]] = {}
    for g in graded:
        diff = g.get("difficulty", "unknown")
        groups.setdefault(diff, []).append(g)
    return {diff: compute_metrics(records) for diff, records in sorted(groups.items())}


def breakdown_by_action(graded: list[dict]) -> dict[str, dict]:
    """Per-expected-action accuracy breakdown."""
    groups: dict[str, list[dict]] = {}
    for g in graded:
        action = g.get("expected_action", "UNKNOWN")
        groups.setdefault(action, []).append(g)
    return {action: compute_metrics(records) for action, records in sorted(groups.items())}

# ── Labeled pair construction ─────────────────────────────────────────────────

def build_labeled_pair(graded_record: dict, result: dict) -> dict:
    """Build a training-pair document from a graded record.

    Schema:
      problem  : the natural-language command
      solution : the actual QuerySpec (what the model produced)
      tags     : ['positive'] or ['negative'] — ground-truth label
      meta     : grading details for debugging / curriculum weighting
    """
    return {
        "problem":  graded_record["command"],
        "solution": result.get("actual_queryspec"),
        "tags":     [graded_record["label"]],
        "meta": {
            "expected_action":  graded_record["expected_action"],
            "expected_target":  graded_record["expected_target"],
            "actual_action":    graded_record["actual_action"],
            "actual_target":    graded_record["actual_target"],
            "action_match":     graded_record["action_match"],
            "target_match":     graded_record["target_match"],
            "clarify_correct":  graded_record["clarify_correct"],
            "no_crash":         graded_record["no_crash"],
            "difficulty":       graded_record["difficulty"],
            "variation":        graded_record["variation"],
            "binary":           graded_record["binary"],
            "errors":           graded_record["errors"],
        },
    }

# ── ArangoDB storage ──────────────────────────────────────────────────────────

def _store_to_arango(pairs: list[dict]) -> int:
    """Store labeled training pairs to ArangoDB via memory daemon.

    Tries Unix socket first, falls back to TCP.
    Returns count of successfully stored documents.
    """
    import httpx  # local import — only used in live mode

    payload = {
        "collection": TRAINING_COLLECTION,
        "documents":  pairs,
        "overwrite":  False,  # append — never clobber existing pairs
    }

    # ── Try Unix socket ───────────────────────────────────────────────────────
    try:
        transport = httpx.HTTPTransport(uds=MEMORY_SOCK)
        client = httpx.Client(transport=transport, base_url="http://localhost", timeout=30.0)
        resp = client.post("/bulk-insert", json=payload)
        resp.raise_for_status()
        data = resp.json()
        count = data.get("inserted", data.get("count", len(pairs)))
        logger.info("Stored {} training pairs via Unix socket", count)
        return count
    except Exception as exc:
        logger.debug("Unix socket failed ({}), trying TCP…", exc)

    # ── Try TCP ───────────────────────────────────────────────────────────────
    try:
        resp = httpx.post(
            f"{MEMORY_URL}/bulk-insert",
            json=payload,
            timeout=30.0,
        )
        resp.raise_for_status()
        data = resp.json()
        count = data.get("inserted", data.get("count", len(pairs)))
        logger.info("Stored {} training pairs via TCP", count)
        return count
    except Exception as exc2:
        logger.error("ArangoDB unavailable — could not store training pairs: {}", exc2)
        return 0

# ── Report helpers ────────────────────────────────────────────────────────────

def _print_report(metrics: dict, by_difficulty: dict, by_action: dict) -> None:
    """Print a formatted accuracy report to stderr."""
    sep = "─" * 60
    logger.info("{}", sep)
    logger.info("GRADE-BATCH REPORT")
    logger.info("{}", sep)
    logger.info("Total interactions graded : {}", metrics["total"])
    logger.info("Overall accuracy          : {}%", metrics["accuracy_pct"])
    logger.info("  Positive (all pass)     : {}", metrics["positive_count"])
    logger.info("  Negative (any fail)     : {}", metrics["negative_count"])
    logger.info("{}", sep)
    logger.info("Action accuracy           : {}%", metrics["action_accuracy_pct"])
    logger.info("Entity resolution rate    : {}%", metrics["entity_resolution_rate_pct"])
    logger.info("Clarify correctness rate  : {}%", metrics["clarify_rate_pct"])
    logger.info("Crash rate                : {}%", metrics["crash_rate_pct"])
    logger.info("{}", sep)
    logger.info("By difficulty:")
    for diff, m in by_difficulty.items():
        logger.info("  {:12s}  accuracy={:6.1f}%  action={:6.1f}%  n={}", diff, m["accuracy_pct"], m["action_accuracy_pct"], m["total"])
    logger.info("{}", sep)
    logger.info("By action type:")
    for action, m in by_action.items():
        logger.info("  {:20s}  accuracy={:6.1f}%  n={}", action, m["accuracy_pct"], m["total"])
    logger.info("{}", sep)

# ── CLI ────────────────────────────────────────────────────────────────────────

@app.command()
def main(
    results: Optional[Path] = typer.Option(
        None,
        "--results", "-r",
        help="JSONL output from run-batch.cjs (actual results)",
    ),
    expected: Optional[Path] = typer.Option(
        None,
        "--expected", "-e",
        help="JSONL from generate-commands.py (ground-truth expected)",
    ),
    output: Optional[Path] = typer.Option(
        None,
        "--output", "-o",
        help="Output JSONL for labeled training pairs (default: stdout)",
    ),
    store_arango: bool = typer.Option(
        False,
        "--store-arango",
        help="Store labeled pairs to ArangoDB via /memory learn",
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Use built-in mock data; no file I/O or ArangoDB connection",
    ),
    report_json: bool = typer.Option(
        False,
        "--report-json",
        help="Print JSON metrics summary to stdout instead of JSONL pairs",
    ),
    min_accuracy: Optional[float] = typer.Option(
        None,
        "--min-accuracy",
        help="Exit code 1 if overall accuracy falls below this threshold (0-100)",
    ),
    verbose: bool = typer.Option(
        False,
        "--verbose", "-v",
        help="Log grading details for every interaction",
    ),
) -> None:
    """Grade BinaryExplorer interaction results against expected QuerySpecs.

    Loads two JSONL files:
      --results   : actual run output from run-batch.cjs
      --expected  : ground-truth from generate-commands.py

    Produces:
      - Console accuracy report
      - Labeled training pairs (JSONL to --output or stdout)
      - Optional ArangoDB store (--store-arango)
    """
    # ── Load data ─────────────────────────────────────────────────────────────
    if dry_run:
        logger.info("[dry-run] Using built-in mock data ({} expected, {} results)",
                    len(_DRY_EXPECTED), len(_DRY_RESULTS))
        expected_records = _DRY_EXPECTED
        result_records   = _DRY_RESULTS
    else:
        if results is None:
            logger.error("--results is required (or use --dry-run)")
            raise typer.Exit(1)

        if not results.exists():
            logger.error("Results file not found: {}", results)
            raise typer.Exit(1)

        result_records = load_jsonl(results)
        logger.info("Loaded {} result records from {}", len(result_records), results)

        expected_records = []
        if expected is not None:
            if not expected.exists():
                logger.error("Expected file not found: {}", expected)
                raise typer.Exit(1)
            expected_records = load_jsonl(expected)
            logger.info("Loaded {} expected records from {}", len(expected_records), expected)
        else:
            logger.info("No --expected file provided; using embedded 'expected' field in results")

    # ── Build expected index ───────────────────────────────────────────────────
    expected_index = build_expected_index(expected_records)

    # ── Grade each pair ────────────────────────────────────────────────────────
    graded: list[dict] = []
    labeled_pairs: list[dict] = []
    skipped = 0

    for result in result_records:
        cmd = result.get("command", "").strip()
        if not cmd:
            skipped += 1
            continue

        # Resolve expected: external index → embedded in result → skip
        exp_rec = expected_index.get(cmd)
        if exp_rec is None:
            # Fall back to embedded expected field from run-batch output
            embedded = result.get("expected")
            if embedded and isinstance(embedded, dict):
                exp_rec = embedded
            else:
                logger.debug("No expected record for command: {!r}", cmd)
                skipped += 1
                continue

        graded_rec = grade_pair(result, exp_rec)
        graded.append(graded_rec)

        if verbose:
            logger.info(
                "[{}] action={} target={} clarify={} crash={}  → {}",
                graded_rec["label"].upper(),
                "✓" if graded_rec["action_match"] else "✗",
                "✓" if graded_rec["target_match"] else "✗",
                "✓" if graded_rec["clarify_correct"] else "✗",
                "✓" if graded_rec["no_crash"] else "✗",
                cmd[:60],
            )

        pair = build_labeled_pair(graded_rec, result)
        labeled_pairs.append(pair)

    if skipped:
        logger.warning("Skipped {} records (no expected mapping or missing command)", skipped)

    if not graded:
        logger.error("No records could be graded — check file paths and formats")
        raise typer.Exit(1)

    # ── Compute metrics ───────────────────────────────────────────────────────
    metrics       = compute_metrics(graded)
    by_difficulty = breakdown_by_difficulty(graded)
    by_action     = breakdown_by_action(graded)

    _print_report(metrics, by_difficulty, by_action)

    # ── Output ────────────────────────────────────────────────────────────────
    if report_json:
        summary = {
            "metrics":       metrics,
            "by_difficulty": by_difficulty,
            "by_action":     by_action,
        }
        sys.stdout.write(json.dumps(summary, indent=2) + "\n")
    else:
        lines = [json.dumps(p) for p in labeled_pairs]
        if output and not dry_run:
            output.parent.mkdir(parents=True, exist_ok=True)
            with output.open("w") as fh:
                for line in lines:
                    fh.write(line + "\n")
            logger.info("Wrote {} labeled pairs to {}", len(labeled_pairs), output)
        else:
            for line in lines:
                sys.stdout.write(line + "\n")

    # ── ArangoDB store ────────────────────────────────────────────────────────
    if store_arango and not dry_run:
        stored = _store_to_arango(labeled_pairs)
        logger.info("Stored {}/{} pairs to ArangoDB collection '{}'",
                    stored, len(labeled_pairs), TRAINING_COLLECTION)
    elif store_arango and dry_run:
        logger.info("[dry-run] Would store {} pairs to ArangoDB (skipped)", len(labeled_pairs))

    # ── Accuracy gate ─────────────────────────────────────────────────────────
    if min_accuracy is not None:
        if metrics["accuracy_pct"] < min_accuracy:
            logger.error(
                "Accuracy gate FAILED: {:.1f}% < required {:.1f}%",
                metrics["accuracy_pct"],
                min_accuracy,
            )
            raise typer.Exit(1)
        logger.info(
            "Accuracy gate PASSED: {:.1f}% ≥ required {:.1f}%",
            metrics["accuracy_pct"],
            min_accuracy,
        )


if __name__ == "__main__":
    app()

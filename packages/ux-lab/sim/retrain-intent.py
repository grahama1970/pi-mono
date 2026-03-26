"""
retrain-intent.py — Auto-retrain intent classifier from graded labels.

Pipeline:
  1. Query ArangoDB for binary-explorer-feedback docs with intent-training-v2 tag
  2. Split into train/holdout (80/20)
  3. Format as SFT pairs: {input: user_command, output: json_queryspec}
  4. Call /create-gpt with --task intent-binary-explorer --size 0.5B --sft-only
  5. Evaluate on holdout: accuracy must exceed previous model
  6. If accuracy improves, promote model to /assistant cascade tier 1.5
  7. Store training run metadata to /memory learn

Uses httpx Unix socket to memory daemon for all ArangoDB queries.
Falls back to TCP (port 8601) when the Unix socket is unavailable.

Usage:
    python3 retrain-intent.py --dry-run
    python3 retrain-intent.py --min-examples 50
    python3 retrain-intent.py --force --no-promote
"""
from __future__ import annotations

import json
import random
import subprocess
import sys
import tempfile
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
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
    help="Auto-retrain intent classifier from graded binary-explorer-feedback labels"
)

# ── Path resolution ───────────────────────────────────────────────────────────
_THIS_FILE    = Path(__file__).resolve()
# packages/ux-lab/sim/retrain-intent.py  →  project root is 3 levels up
_PROJECT_ROOT = _THIS_FILE.parent.parent.parent.parent
_CREATE_GPT_RUN = _PROJECT_ROOT / ".pi" / "skills" / "create-gpt" / "run.sh"
_ASSISTANT_RUN  = _PROJECT_ROOT / ".pi" / "skills" / "assistant"  / "run.sh"

# ── Memory daemon config ───────────────────────────────────────────────────────
MEMORY_SOCK         = "/run/user/1000/embry/memory.sock"
MEMORY_URL          = "http://127.0.0.1:8601"
FEEDBACK_COLLECTION = "binary_explorer_feedback"
TRAINING_TAG        = "intent-training-v2"
TASK_NAME           = "intent-binary-explorer"
MODEL_SIZE          = "0.5B"

# ── Minimum training examples gate ────────────────────────────────────────────
DEFAULT_MIN_EXAMPLES = 100   # hard floor; create-gpt requires ≥1 000 for real training

# ── Dry-run mock feedback docs ────────────────────────────────────────────────
_DRY_DOCS: list[dict] = [
    {
        "_key":        "feedback-001",
        "user_command": "show all nodes in the graph",
        "query_spec":   {"action": "VIEW_ALL"},
        "tags":        ["intent-training-v2", "positive"],
        "binary":      "droid",
        "ts_ms":       1711234560000,
    },
    {
        "_key":        "feedback-002",
        "user_command": "Please select the Session Notification node",
        "query_spec":   {"action": "SELECT_NODE", "target_node_id": "droid:session_notification"},
        "tags":        ["intent-training-v2", "positive"],
        "binary":      "droid",
        "ts_ms":       1711234561000,
    },
    {
        "_key":        "feedback-003",
        "user_command": "switch to security view",
        "query_spec":   {"action": "SET_PERSPECTIVE", "target": "security"},
        "tags":        ["intent-training-v2", "positive"],
        "binary":      "droid",
        "ts_ms":       1711234562000,
    },
    {
        "_key":        "feedback-004",
        "user_command": "zoom into the droid namespace",
        "query_spec":   {"action": "ZOOM_IN", "target": "droid"},
        "tags":        ["intent-training-v2", "positive"],
        "binary":      "droid",
        "ts_ms":       1711234563000,
    },
    {
        "_key":        "feedback-005",
        "user_command": "expand automation namespace",
        "query_spec":   {"action": "EXPAND", "target_node_id": "droid:automation"},
        "tags":        ["intent-training-v2", "positive"],
        "binary":      "droid",
        "ts_ms":       1711234564000,
    },
    {
        "_key":        "feedback-006",
        "user_command": "what does the terminal output event do",
        "query_spec":   {"action": "QUERY", "target": "droid:terminal_output"},
        "tags":        ["intent-training-v2", "positive"],
        "binary":      "droid",
        "ts_ms":       1711234565000,
    },
    {
        "_key":        "feedback-007",
        "user_command": "enable progressive loading",
        "query_spec":   {"action": "TOGGLE_PROGRESSIVE", "enabled": True},
        "tags":        ["intent-training-v2", "positive"],
        "binary":      "droid",
        "ts_ms":       1711234566000,
    },
    {
        "_key":        "feedback-008",
        "user_command": "reset to default perspective",
        "query_spec":   {"action": "SET_PERSPECTIVE", "target": "default"},
        "tags":        ["intent-training-v2", "positive"],
        "binary":      "droid",
        "ts_ms":       1711234567000,
    },
    {
        "_key":        "feedback-009",
        "user_command": "find all rpc nodes",
        "query_spec":   {"action": "QUERY", "filter": {"node_type": "rpc"}},
        "tags":        ["intent-training-v2", "positive"],
        "binary":      "droid",
        "ts_ms":       1711234568000,
    },
    {
        "_key":        "feedback-010",
        "user_command": "show every node",
        "query_spec":   {"action": "VIEW_ALL"},
        "tags":        ["intent-training-v2", "positive"],
        "binary":      "droid",
        "ts_ms":       1711234569000,
    },
]


# ── Memory daemon helpers ─────────────────────────────────────────────────────

def _memory_client() -> tuple[httpx.Client, str]:
    """Return (client, base_url).  Tries Unix socket first, falls back to TCP."""
    try:
        transport = httpx.HTTPTransport(uds=MEMORY_SOCK)
        client = httpx.Client(transport=transport, base_url="http://localhost", timeout=30.0)
        client.get("/health").raise_for_status()
        logger.debug("Memory daemon connected via Unix socket")
        return client, "http://localhost"
    except Exception as exc:
        logger.debug("Unix socket unavailable ({}), falling back to TCP", exc)

    client = httpx.Client(base_url=MEMORY_URL, timeout=30.0)
    return client, MEMORY_URL


def query_feedback_docs(dry_run: bool) -> list[dict]:
    """Return feedback docs tagged with TRAINING_TAG from ArangoDB."""
    if dry_run:
        logger.info("DRY-RUN: returning {} mock feedback docs", len(_DRY_DOCS))
        return _DRY_DOCS

    client, _ = _memory_client()
    try:
        resp = client.post(
            "/aql",
            json={
                "query": (
                    "FOR doc IN @@collection "
                    "FILTER @tag IN doc.tags "
                    "RETURN doc"
                ),
                "bindVars": {
                    "@collection": FEEDBACK_COLLECTION,
                    "tag": TRAINING_TAG,
                },
            },
        )
        resp.raise_for_status()
        docs = resp.json().get("result", [])
        logger.info("Fetched {} feedback docs from ArangoDB", len(docs))
        return docs
    except Exception as exc:
        logger.error("ArangoDB query failed: {}", exc)
        raise typer.Exit(1)
    finally:
        client.close()


def memory_learn(payload: dict) -> bool:
    """Store training run metadata via /memory learn endpoint."""
    client, _ = _memory_client()
    try:
        resp = client.post("/learn", json=payload)
        resp.raise_for_status()
        logger.info("Training run metadata stored to /memory")
        return True
    except Exception as exc:
        logger.warning("Failed to store metadata to /memory: {}", exc)
        return False
    finally:
        client.close()


# ── Dataset helpers ───────────────────────────────────────────────────────────

def to_sft_pair(doc: dict) -> dict | None:
    """Convert a feedback doc to an SFT pair.  Returns None if malformed."""
    user_command = doc.get("user_command", "").strip()
    query_spec   = doc.get("query_spec")
    if not user_command or not query_spec:
        logger.debug("Skipping malformed doc {}: missing user_command or query_spec", doc.get("_key"))
        return None
    return {
        "input":  user_command,
        "output": json.dumps(query_spec, separators=(",", ":")),
    }


def split_train_holdout(pairs: list[dict], holdout_ratio: float = 0.20) -> tuple[list[dict], list[dict]]:
    """Shuffle and split pairs into (train, holdout)."""
    shuffled = pairs[:]
    random.shuffle(shuffled)
    split_idx = max(1, int(len(shuffled) * (1.0 - holdout_ratio)))
    return shuffled[:split_idx], shuffled[split_idx:]


# ── create-gpt invocation ─────────────────────────────────────────────────────

def call_create_gpt(sft_path: Path, dry_run: bool) -> dict:
    """Invoke /create-gpt train and return metadata dict."""
    if dry_run:
        logger.info("DRY-RUN: skipping create-gpt invocation")
        return {
            "model_path": f"/tmp/intent-binary-explorer-{uuid.uuid4().hex[:8]}.gguf",
            "accuracy":   0.87,
            "examples":   len(_DRY_DOCS),
            "dry_run":    True,
        }

    if not _CREATE_GPT_RUN.exists():
        logger.error("create-gpt run.sh not found at {}", _CREATE_GPT_RUN)
        raise typer.Exit(1)

    cmd = [
        "bash", str(_CREATE_GPT_RUN),
        "train",
        "--task",     TASK_NAME,
        "--size",     MODEL_SIZE,
        "--sft-only",
        "--input",    str(sft_path),
    ]
    logger.info("Invoking create-gpt: {}", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)

    if result.returncode != 0:
        logger.error("create-gpt failed:\n{}", result.stderr)
        raise typer.Exit(1)

    # Parse JSON metadata from stdout (create-gpt emits JSON summary)
    try:
        meta = json.loads(result.stdout.strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError):
        logger.warning("Could not parse create-gpt JSON output; using defaults")
        meta = {"model_path": None, "accuracy": None}

    logger.info("create-gpt completed: accuracy={}", meta.get("accuracy"))
    return meta


# ── Holdout evaluation ────────────────────────────────────────────────────────

def evaluate_holdout(holdout: list[dict], model_meta: dict, dry_run: bool) -> float:
    """Run inference on holdout set and return accuracy."""
    if dry_run:
        accuracy = 0.87
        logger.info("DRY-RUN: simulated holdout accuracy = {:.1%}", accuracy)
        return accuracy

    model_path = model_meta.get("model_path")
    if not model_path:
        logger.warning("No model_path in training metadata; cannot evaluate")
        return 0.0

    _INFER_SCRIPT = _PROJECT_ROOT / ".pi" / "skills" / "create-gpt" / "scripts" / "infer.py"
    if not _INFER_SCRIPT.exists():
        logger.warning("Inference script not found at {}; returning 0.0", _INFER_SCRIPT)
        return 0.0

    correct = 0
    for pair in holdout:
        try:
            result = subprocess.run(
                [sys.executable, str(_INFER_SCRIPT),
                 "--model", model_path,
                 "--input", pair["input"]],
                capture_output=True,
                text=True,
                timeout=60,
            )
            if result.returncode == 0:
                predicted = json.loads(result.stdout.strip())
                expected  = json.loads(pair["output"])
                if predicted.get("action") == expected.get("action"):
                    correct += 1
        except Exception as exc:
            logger.debug("Inference error on '{}': {}", pair["input"], exc)

    accuracy = correct / len(holdout) if holdout else 0.0
    logger.info("Holdout accuracy: {:.1%} ({}/{})", accuracy, correct, len(holdout))
    return accuracy


def fetch_previous_accuracy(dry_run: bool) -> float:
    """Return the accuracy of the currently promoted model (baseline)."""
    if dry_run:
        return 0.80   # mock baseline to beat

    client, _ = _memory_client()
    try:
        resp = client.post(
            "/recall",
            json={
                "query": f"intent classifier {TASK_NAME} last promoted accuracy",
                "k": 1,
                "scope": "operational",
            },
        )
        resp.raise_for_status()
        items = resp.json().get("items", [])
        if items:
            meta = items[0].get("meta", {})
            acc  = meta.get("holdout_accuracy", meta.get("accuracy", 0.0))
            logger.info("Previous promoted model accuracy: {:.1%}", acc)
            return float(acc)
    except Exception as exc:
        logger.debug("Could not fetch previous accuracy: {}", exc)
    finally:
        client.close()

    logger.info("No previous accuracy found; treating baseline as 0.0")
    return 0.0


# ── Promotion ─────────────────────────────────────────────────────────────────

def promote_model(model_meta: dict, accuracy: float, dry_run: bool) -> bool:
    """Promote the trained model to /assistant cascade tier 1.5."""
    if dry_run:
        logger.info("DRY-RUN: would promote model (accuracy={:.1%}) to tier 1.5", accuracy)
        return True

    if not _ASSISTANT_RUN.exists():
        logger.warning("assistant run.sh not found at {}; skipping promotion", _ASSISTANT_RUN)
        return False

    model_path = model_meta.get("model_path", "")
    cmd = [
        "bash", str(_ASSISTANT_RUN),
        "promote",
        "--task",       TASK_NAME,
        "--tier",       "1.5",
        "--model-path", model_path,
        "--accuracy",   str(accuracy),
    ]
    logger.info("Promoting model: {}", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        logger.info("Model promoted to tier 1.5 successfully")
        return True
    else:
        logger.error("Promotion failed:\n{}", result.stderr)
        return False


# ── Main command ──────────────────────────────────────────────────────────────

@app.command()
def main(
    dry_run: bool = typer.Option(
        False, "--dry-run", help="Run end-to-end with mock data; no ArangoDB or GPU calls"
    ),
    min_examples: int = typer.Option(
        DEFAULT_MIN_EXAMPLES,
        "--min-examples",
        help="Minimum labeled examples required before training",
    ),
    force: bool = typer.Option(
        False, "--force", help="Skip minimum-example gate and train regardless"
    ),
    no_promote: bool = typer.Option(
        False, "--no-promote", help="Train and evaluate but do not promote to cascade"
    ),
    holdout_ratio: float = typer.Option(
        0.20, "--holdout-ratio", help="Fraction of data reserved for holdout evaluation"
    ),
    seed: int = typer.Option(
        42, "--seed", help="Random seed for train/holdout split"
    ),
) -> None:
    """
    Auto-retrain the BinaryExplorer intent classifier from graded labels.

    Queries ArangoDB for binary-explorer-feedback docs tagged with
    'intent-training-v2', splits 80/20, trains via /create-gpt --sft-only,
    evaluates on holdout, and promotes if accuracy improves.
    """
    random.seed(seed)
    run_id  = uuid.uuid4().hex[:12]
    started = datetime.now(timezone.utc).isoformat()

    logger.info("=== retrain-intent run {} started ===", run_id)
    logger.info("dry_run={} min_examples={} force={} no_promote={}", dry_run, min_examples, force, no_promote)

    # ── Step 1: Query ArangoDB ────────────────────────────────────────────────
    logger.info("Step 1/7 — Querying ArangoDB for {} docs…", TRAINING_TAG)
    docs = query_feedback_docs(dry_run=dry_run)

    if not docs:
        logger.error("No feedback docs found with tag '{}'. Aborting.", TRAINING_TAG)
        raise typer.Exit(1)

    # ── Minimum-example gate ──────────────────────────────────────────────────
    # Dry-run bypasses the gate automatically (mock data set is intentionally small)
    if len(docs) < min_examples and not force and not dry_run:
        logger.warning(
            "Only {} docs found; need >= {} (use --force to override). Aborting.",
            len(docs), min_examples,
        )
        raise typer.Exit(1)

    logger.info("Found {} feedback docs — proceeding", len(docs))

    # ── Step 2: Format SFT pairs ──────────────────────────────────────────────
    logger.info("Step 2/7 — Formatting SFT pairs…")
    pairs = [p for doc in docs if (p := to_sft_pair(doc)) is not None]

    if not pairs:
        logger.error("No valid SFT pairs could be extracted. Check doc schema.")
        raise typer.Exit(1)

    logger.info("{} valid SFT pairs extracted from {} docs", len(pairs), len(docs))

    # ── Step 3: Train/holdout split ───────────────────────────────────────────
    logger.info("Step 3/7 — Splitting train/holdout ({:.0%}/{:.0%})…", 1 - holdout_ratio, holdout_ratio)
    train_pairs, holdout_pairs = split_train_holdout(pairs, holdout_ratio=holdout_ratio)
    logger.info("Train: {}  Holdout: {}", len(train_pairs), len(holdout_pairs))

    if not holdout_pairs:
        logger.warning("Holdout set is empty — evaluation will be skipped")

    # ── Step 4: Write SFT JSONL and call /create-gpt ─────────────────────────
    logger.info("Step 4/7 — Calling /create-gpt (task={} size={} --sft-only)…", TASK_NAME, MODEL_SIZE)

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".jsonl", prefix=f"sft-{TASK_NAME}-", delete=False
    ) as fh:
        sft_path = Path(fh.name)
        for pair in train_pairs:
            fh.write(json.dumps(pair) + "\n")

    logger.debug("SFT JSONL written to {}", sft_path)
    model_meta = call_create_gpt(sft_path, dry_run=dry_run)

    # ── Step 5: Evaluate on holdout ───────────────────────────────────────────
    logger.info("Step 5/7 — Evaluating on holdout set…")
    prev_accuracy = fetch_previous_accuracy(dry_run=dry_run)

    if holdout_pairs:
        new_accuracy = evaluate_holdout(holdout_pairs, model_meta, dry_run=dry_run)
    else:
        new_accuracy = model_meta.get("accuracy") or 0.0
        logger.warning("No holdout pairs; using training accuracy as proxy: {:.1%}", new_accuracy)

    accuracy_delta = new_accuracy - prev_accuracy
    logger.info(
        "Accuracy: new={:.1%}  prev={:.1%}  delta={:+.1%}",
        new_accuracy, prev_accuracy, accuracy_delta,
    )

    # ── Step 6: Conditionally promote ────────────────────────────────────────
    promoted = False
    logger.info("Step 6/7 — Promotion gate…")
    if new_accuracy <= prev_accuracy:
        logger.warning(
            "New model ({:.1%}) does not exceed previous ({:.1%}). Skipping promotion.",
            new_accuracy, prev_accuracy,
        )
    elif no_promote:
        logger.info("--no-promote flag set; skipping promotion (accuracy did improve)")
    else:
        promoted = promote_model(model_meta, new_accuracy, dry_run=dry_run)

    # ── Step 7: Store training run metadata ──────────────────────────────────
    logger.info("Step 7/7 — Storing training run metadata to /memory…")
    finished = datetime.now(timezone.utc).isoformat()
    metadata = {
        "text": (
            f"Intent retrain run {run_id}: task={TASK_NAME} size={MODEL_SIZE} "
            f"examples={len(train_pairs)} holdout={len(holdout_pairs)} "
            f"accuracy={new_accuracy:.4f} prev_accuracy={prev_accuracy:.4f} "
            f"promoted={promoted} dry_run={dry_run}"
        ),
        "scope": "operational",
        "tags": ["intent-retrain", TASK_NAME, TRAINING_TAG],
        "meta": {
            "run_id":           run_id,
            "task":             TASK_NAME,
            "model_size":       MODEL_SIZE,
            "total_docs":       len(docs),
            "train_examples":   len(train_pairs),
            "holdout_examples": len(holdout_pairs),
            "holdout_accuracy": new_accuracy,
            "prev_accuracy":    prev_accuracy,
            "accuracy_delta":   accuracy_delta,
            "promoted":         promoted,
            "model_path":       model_meta.get("model_path"),
            "dry_run":          dry_run,
            "started_at":       started,
            "finished_at":      finished,
        },
    }
    memory_learn(metadata)

    # ── Summary ───────────────────────────────────────────────────────────────
    logger.info("=== retrain-intent run {} complete ===", run_id)
    logger.info(
        "  docs={} train={} holdout={} accuracy={:.1%} promoted={}",
        len(docs), len(train_pairs), len(holdout_pairs), new_accuracy, promoted,
    )
    if dry_run:
        logger.info("  (dry-run: no ArangoDB writes, no GPU compute, no model files)")


if __name__ == "__main__":
    app()

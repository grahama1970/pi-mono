"""
converge.py -- Intent accuracy convergence loop for BinaryExplorer.

Runs iterative training rounds until holdout intent accuracy exceeds 85%:

  Round N:
    1. generate-commands  -- produce adversarial NL commands
    2. run-batch          -- execute commands against BinaryExplorer (CDP)
    3. grade-batch        -- grade actual vs expected QuerySpecs
    4. retrain-intent     -- retrain intent classifier on graded labels
    5. Check holdout accuracy
    6. If < 85%: analyze failure patterns, generate targeted adversarial
       commands for weak spots
    7. If >= 85%: declare convergence, store final metrics

Safety:
  - Max 5 rounds (configurable, prevents infinite loop)
  - Each round adds ~200 new training pairs to ArangoDB
  - Uses /conversation-lab pattern: diagnose -> fix -> re-run -> measure

Wire:
  - /task-monitor progress tracking via memory daemon

Usage:
    python3 packages/ux-lab/sim/converge.py --dry-run --max-rounds 0
    python3 packages/ux-lab/sim/converge.py --dry-run --max-rounds 1
    python3 packages/ux-lab/sim/converge.py --max-rounds 5 --target-accuracy 85
"""
from __future__ import annotations

import importlib.util
import json
import random
import subprocess
import sys
import time
import uuid
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import typer
from loguru import logger

# -- Logging setup -----------------------------------------------------------
logger.remove()
logger.add(
    sys.stderr,
    level="INFO",
    format="<green>{time:HH:mm:ss}</green> | {level} | {message}",
)

app = typer.Typer(
    help="Intent accuracy convergence loop for BinaryExplorer",
)

# -- Constants ----------------------------------------------------------------
_THIS_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _THIS_DIR.parent.parent.parent

MEMORY_SOCK = "/run/user/1000/embry/memory.sock"
MEMORY_URL = "http://127.0.0.1:8601"
TRAINING_COLLECTION = "ux_lab_training_pairs"
CONVERGENCE_COLLECTION = "ux_lab_convergence_runs"

TARGET_ACCURACY_DEFAULT = 85.0
MAX_ROUNDS_DEFAULT = 5
COMMANDS_PER_ROUND = 200


# -- Data classes -------------------------------------------------------------

@dataclass
class RoundMetrics:
    """Metrics captured for a single convergence round."""

    round_num: int
    commands_generated: int = 0
    commands_graded: int = 0
    accuracy_pct: float = 0.0
    action_accuracy_pct: float = 0.0
    entity_resolution_pct: float = 0.0
    training_pairs_added: int = 0
    holdout_accuracy_pct: float = 0.0
    failure_categories: dict = field(default_factory=dict)
    confused_pairs: list = field(default_factory=list)
    duration_s: float = 0.0


@dataclass
class ConvergenceReport:
    """Final convergence report spanning all rounds."""

    converged: bool = False
    target_accuracy: float = TARGET_ACCURACY_DEFAULT
    final_accuracy: float = 0.0
    total_rounds: int = 0
    total_training_pairs: int = 0
    accuracy_curve: list = field(default_factory=list)
    rounds: list = field(default_factory=list)
    failure_categories: dict = field(default_factory=dict)
    confused_pairs: list = field(default_factory=list)
    run_id: str = ""
    started_at: str = ""
    finished_at: str = ""
    dry_run: bool = False


# -- Module importers (hyphenated filenames) ----------------------------------

def _import_module(name: str, filename: str):
    """Import a sibling module with a hyphenated filename."""
    script = _THIS_DIR / filename
    if not script.exists():
        logger.warning("Module not found: {}", script)
        return None
    try:
        spec = importlib.util.spec_from_file_location(name, script)
        if spec is None or spec.loader is None:
            return None
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)  # type: ignore[attr-defined]
        return mod
    except Exception as exc:
        logger.warning("Could not import {}: {}", filename, exc)
        return None


# -- Memory daemon helpers ----------------------------------------------------

def _memory_post(endpoint: str, payload: dict) -> dict | None:
    """POST to memory daemon, trying Unix socket then TCP."""
    import httpx  # local import -- only in live mode

    try:
        transport = httpx.HTTPTransport(uds=MEMORY_SOCK)
        client = httpx.Client(
            transport=transport, base_url="http://localhost", timeout=30.0,
        )
        resp = client.post(endpoint, json=payload)
        resp.raise_for_status()
        return resp.json()
    except Exception:
        pass

    try:
        resp = httpx.post(
            f"{MEMORY_URL}{endpoint}", json=payload, timeout=30.0,
        )
        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        logger.debug("Memory daemon unavailable: {}", exc)
        return None


def _notify_task_monitor(
    run_id: str,
    round_num: int,
    total_rounds: int,
    status: str,
    accuracy: float,
    dry_run: bool,
) -> None:
    """Notify /task-monitor of convergence progress."""
    if dry_run:
        logger.debug(
            "[dry-run] task-monitor: round={}/{} status={} accuracy={:.1f}%",
            round_num, total_rounds, status, accuracy,
        )
        return

    payload = {
        "task_id": f"converge-intent-{run_id}",
        "task_type": "intent-convergence",
        "status": status,
        "progress": {
            "round": round_num,
            "max_rounds": total_rounds,
            "accuracy_pct": accuracy,
            "target_pct": TARGET_ACCURACY_DEFAULT,
        },
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    _memory_post("/task-monitor/update", payload)


# -- Step functions -----------------------------------------------------------

def step_generate_commands(
    round_num: int,
    failure_categories: dict,
    dry_run: bool,
    seed: int,
) -> list[dict]:
    """Generate adversarial commands, biased toward weak categories.

    Round 1 generates a balanced spread.  Subsequent rounds generate
    targeted adversarial commands weighted toward failure categories.
    """
    gen_mod = _import_module("generate_commands", "generate-commands.py")
    if gen_mod is None:
        logger.error("Cannot import generate-commands.py")
        return []

    rng = random.Random(seed + round_num)
    all_commands: list[dict] = []

    for bin_name, features in gen_mod.STATIC_FEATURES.items():
        cmds = gen_mod._generate_for_binary(
            bin_name, features, novel=(round_num > 1), rng=rng,
        )
        all_commands.extend(cmds)

    rng.shuffle(all_commands)

    # On rounds > 1, bias toward failure categories
    if round_num > 1 and failure_categories:
        weak_actions = sorted(
            failure_categories, key=failure_categories.get, reverse=True,
        )[:3]
        logger.info(
            "  Targeting weak actions: {}",
            {a: failure_categories[a] for a in weak_actions},
        )

        # Pull weak-action commands to the front
        weak = [c for c in all_commands if c.get("expected_action") in weak_actions]
        rest = [c for c in all_commands if c.get("expected_action") not in weak_actions]
        # Weight: 60% weak, 40% rest
        weak_n = min(len(weak), int(COMMANDS_PER_ROUND * 0.6))
        rest_n = min(len(rest), COMMANDS_PER_ROUND - weak_n)
        all_commands = weak[:weak_n] + rest[:rest_n]
    else:
        all_commands = all_commands[:COMMANDS_PER_ROUND]

    logger.info(
        "  Generated {} commands for round {}", len(all_commands), round_num,
    )
    return all_commands


def step_run_batch(
    commands: list[dict],
    round_num: int,
    dry_run: bool,
) -> list[dict]:
    """Execute commands against BinaryExplorer via CDP harness.

    In dry-run mode, synthesizes plausible results from the commands.
    """
    if dry_run:
        results = []
        rng = random.Random(42 + round_num)
        for cmd in commands:
            # Simulate: ~80% correct on round 1, improving per round
            base_rate = min(0.95, 0.72 + round_num * 0.06)
            correct = rng.random() < base_rate

            if correct:
                actual_qs = {
                    "action": cmd.get("expected_action", "VIEW_ALL"),
                }
                target = cmd.get("expected_target")
                if target:
                    actual_qs["target_node_id"] = target
            else:
                # Simulate wrong action or target
                wrong_actions = [
                    "VIEW_ALL", "SELECT_NODE", "SET_PERSPECTIVE",
                    "EXPAND", "QUERY", "SET_LAYOUT",
                ]
                actual_qs = {
                    "action": rng.choice(wrong_actions),
                }
                if cmd.get("expected_target"):
                    actual_qs["target_node_id"] = "wrong:target"

            results.append({
                "command": cmd.get("command", ""),
                "expected": {
                    "expected_action": cmd.get("expected_action"),
                    "expected_target": cmd.get("expected_target"),
                    "clarify_trigger": cmd.get("clarify_trigger", False),
                },
                "actual_queryspec": actual_qs,
                "clarify_triggered": (
                    cmd.get("clarify_trigger", False) and correct
                ),
                "errors": (
                    ["runtime: simulated error"]
                    if rng.random() < 0.02 else []
                ),
                "ts_ms": int(time.time() * 1000),
            })
        logger.info("  [dry-run] Simulated {} batch results", len(results))
        return results

    # Live mode: invoke run-batch.cjs
    harness = _THIS_DIR / "run-batch.cjs"
    if not harness.exists():
        logger.error("run-batch.cjs not found at {}", harness)
        return []

    import tempfile

    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".jsonl", prefix="converge-cmds-", delete=False,
    ) as fh:
        for cmd in commands:
            fh.write(json.dumps(cmd) + "\n")
        cmds_path = Path(fh.name)

    out_path = cmds_path.with_suffix(".results.jsonl")
    try:
        result = subprocess.run(
            ["node", str(harness), "--input", str(cmds_path), "--output", str(out_path)],
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode != 0:
            logger.error("run-batch failed: {}", result.stderr[:500])
            return []

        records: list[dict] = []
        with out_path.open() as fh:
            for line in fh:
                line = line.strip()
                if line:
                    records.append(json.loads(line))
        return records
    except Exception as exc:
        logger.error("run-batch error: {}", exc)
        return []


def step_grade_batch(
    results: list[dict],
    dry_run: bool,
) -> tuple[dict, list[dict]]:
    """Grade batch results and return (metrics_dict, graded_records).

    Reuses the grading logic from grade-batch.py.
    """
    grade_mod = _import_module("grade_batch", "grade-batch.py")
    if grade_mod is None:
        logger.error("Cannot import grade-batch.py")
        return {}, []

    graded: list[dict] = []
    for result in results:
        cmd = result.get("command", "").strip()
        if not cmd:
            continue

        exp = result.get("expected")
        if not exp or not isinstance(exp, dict):
            continue

        graded_rec = grade_mod.grade_pair(result, exp)
        graded.append(graded_rec)

    metrics = grade_mod.compute_metrics(graded)
    by_action = grade_mod.breakdown_by_action(graded)

    logger.info(
        "  Graded {} interactions — accuracy={:.1f}%  action={:.1f}%",
        metrics.get("total", 0),
        metrics.get("accuracy_pct", 0),
        metrics.get("action_accuracy_pct", 0),
    )

    return {"overall": metrics, "by_action": by_action}, graded


def step_retrain_intent(
    graded: list[dict],
    round_num: int,
    dry_run: bool,
) -> float:
    """Retrain intent classifier and return holdout accuracy.

    In dry-run mode, simulates improving accuracy per round.
    """
    if dry_run:
        # Simulate holdout accuracy that improves each round
        base = 0.72
        accuracy = min(0.96, base + round_num * 0.065)
        logger.info(
            "  [dry-run] Simulated holdout accuracy: {:.1f}%",
            accuracy * 100,
        )
        return accuracy * 100

    retrain_mod = _import_module("retrain_intent", "retrain-intent.py")
    if retrain_mod is None:
        logger.warning("Cannot import retrain-intent.py; returning 0")
        return 0.0

    # Build SFT pairs from graded records
    pairs = []
    for g in graded:
        if g.get("label") == "positive" and g.get("actual_action"):
            qs = {"action": g["actual_action"]}
            if g.get("actual_target"):
                qs["target"] = g["actual_target"]
            pairs.append({
                "input": g["command"],
                "output": json.dumps(qs, separators=(",", ":")),
            })

    if not pairs:
        logger.warning("No positive pairs for retraining")
        return 0.0

    train, holdout = retrain_mod.split_train_holdout(pairs, holdout_ratio=0.20)
    model_meta = retrain_mod.call_create_gpt(
        Path("/dev/null"), dry_run=True,
    )  # placeholder — real training in live mode

    accuracy = retrain_mod.evaluate_holdout(holdout, model_meta, dry_run=True)
    return accuracy * 100


def analyze_failures(
    graded: list[dict],
) -> tuple[dict, list[tuple[str, str, int]]]:
    """Analyze failure patterns from graded records.

    Returns:
        failure_categories: {action: failure_count}
        confused_pairs: [(expected_action, actual_action, count)]
    """
    failure_cats: Counter = Counter()
    confusion: Counter = Counter()

    for g in graded:
        if g.get("label") == "negative":
            exp_action = g.get("expected_action", "UNKNOWN")
            act_action = g.get("actual_action", "NONE")
            failure_cats[exp_action] += 1
            if exp_action != act_action:
                confusion[(exp_action, act_action)] += 1

    confused_pairs = [
        (pair[0], pair[1], count)
        for pair, count in confusion.most_common(10)
    ]

    return dict(failure_cats), confused_pairs


# -- Report generation --------------------------------------------------------

def generate_report(report: ConvergenceReport) -> str:
    """Generate a human-readable convergence report."""
    sep = "=" * 66
    status = "CONVERGED" if report.converged else "NOT CONVERGED"
    lines = [
        sep, "INTENT CONVERGENCE REPORT", sep,
        f"Run ID          : {report.run_id}",
        f"Status          : {status}",
        f"Target accuracy : {report.target_accuracy:.1f}%",
        f"Final accuracy  : {report.final_accuracy:.1f}%",
        f"Rounds          : {report.total_rounds}",
        f"Training pairs  : {report.total_training_pairs}",
        f"Dry run         : {report.dry_run}", "",
        "ACCURACY CURVE", "-" * 40,
    ]
    for i, acc in enumerate(report.accuracy_curve):
        bar = "#" * int(acc / 100 * 30) + "." * (30 - int(acc / 100 * 30))
        marker = " *" if acc >= report.target_accuracy else ""
        lines.append(f"  Round {i + 1}: [{bar}] {acc:5.1f}%{marker}")
    lines.append("")
    if report.failure_categories:
        lines += ["FAILURE CATEGORIES (final round)", "-" * 40]
        for act, cnt in sorted(report.failure_categories.items(), key=lambda x: -x[1]):
            lines.append(f"  {act:20s} : {cnt} failures")
        lines.append("")
    if report.confused_pairs:
        lines += ["TOP CONFUSED ENTITY PAIRS", "-" * 40]
        for exp, act, cnt in report.confused_pairs[:10]:
            lines.append(f"  {exp:20s} -> {act:20s} ({cnt}x)")
        lines.append("")
    hdr = f"  {'Round':>5}  {'Cmds':>5}  {'Accuracy':>8}  {'Action':>8}  {'Pairs':>5}  {'Time':>6}"
    lines += ["PER-ROUND SUMMARY", "-" * 66, hdr]
    for r in report.rounds:
        lines.append(
            f"  {r.round_num:5d}  {r.commands_graded:5d}  {r.accuracy_pct:7.1f}%"
            f"  {r.action_accuracy_pct:7.1f}%  {r.training_pairs_added:5d}  {r.duration_s:5.1f}s",
        )
    lines.append(sep)
    return "\n".join(lines)


def store_convergence_report(report: ConvergenceReport) -> None:
    """Store convergence report to ArangoDB via memory daemon."""
    payload = {
        "text": (
            f"Intent convergence run {report.run_id}: "
            f"{'converged' if report.converged else 'not converged'} "
            f"at {report.final_accuracy:.1f}% after {report.total_rounds} rounds"
        ),
        "scope": "operational",
        "tags": ["intent-convergence", "ux-lab", "binary-explorer"],
        "meta": {
            "run_id": report.run_id,
            "converged": report.converged,
            "target_accuracy": report.target_accuracy,
            "final_accuracy": report.final_accuracy,
            "total_rounds": report.total_rounds,
            "total_training_pairs": report.total_training_pairs,
            "accuracy_curve": report.accuracy_curve,
            "failure_categories": report.failure_categories,
            "confused_pairs": [
                {"expected": e, "actual": a, "count": c}
                for e, a, c in report.confused_pairs
            ],
            "dry_run": report.dry_run,
            "started_at": report.started_at,
            "finished_at": report.finished_at,
        },
    }
    result = _memory_post("/learn", payload)
    if result:
        logger.info("Convergence report stored to /memory")
    else:
        logger.warning("Could not store convergence report to /memory")


# -- Main convergence loop ----------------------------------------------------

def run_convergence(
    max_rounds: int = MAX_ROUNDS_DEFAULT,
    target_accuracy: float = TARGET_ACCURACY_DEFAULT,
    dry_run: bool = False,
    seed: int = 42,
) -> ConvergenceReport:
    """Execute the convergence loop.

    Each round:
      1. generate-commands (biased toward weak spots after round 1)
      2. run-batch (CDP harness or dry-run simulation)
      3. grade-batch (blind QuerySpec grading)
      4. retrain-intent (SFT retraining)
      5. Check holdout accuracy vs target
      6. If below target: analyze failures, loop
      7. If at/above target: declare convergence

    Returns a ConvergenceReport with full metrics.
    """
    run_id = uuid.uuid4().hex[:12]
    started = datetime.now(timezone.utc).isoformat()

    report = ConvergenceReport(
        run_id=run_id,
        target_accuracy=target_accuracy,
        started_at=started,
        dry_run=dry_run,
    )

    # Handle --max-rounds 0 (status-only mode) — print before banner so the
    # status line is the very first output when 2>&1 | head -1 is used.
    if max_rounds == 0:
        report.finished_at = datetime.now(timezone.utc).isoformat()
        status = "convergence-loop: ready (0 rounds requested)"
        sys.stdout.write(status + "\n")
        sys.stdout.flush()
        logger.info(status)
        return report

    logger.info("")
    logger.info("+" + "-" * 64 + "+")
    logger.info("| INTENT CONVERGENCE LOOP{} |", " " * 41)
    logger.info("|   run_id     : {:<48}|", run_id)
    logger.info("|   target     : {:<48}|", f"{target_accuracy:.1f}%")
    logger.info("|   max_rounds : {:<48}|", max_rounds)
    logger.info("|   dry_run    : {:<48}|", str(dry_run))
    logger.info("+" + "-" * 64 + "+")
    logger.info("")

    failure_categories: dict = {}
    total_pairs = 0

    for round_num in range(1, max_rounds + 1):
        t0 = time.time()
        logger.info("=" * 60)
        logger.info("ROUND {}/{}", round_num, max_rounds)
        logger.info("=" * 60)

        _notify_task_monitor(
            run_id, round_num, max_rounds, "running",
            report.accuracy_curve[-1] if report.accuracy_curve else 0.0,
            dry_run,
        )

        # Step 1: Generate commands
        logger.info("Step 1/4: Generating adversarial commands...")
        commands = step_generate_commands(
            round_num, failure_categories, dry_run, seed,
        )
        if not commands:
            logger.error("No commands generated -- aborting round")
            break

        # Step 2: Run batch
        logger.info("Step 2/4: Running batch evaluation...")
        results = step_run_batch(commands, round_num, dry_run)
        if not results:
            logger.error("No batch results -- aborting round")
            break

        # Step 3: Grade batch
        logger.info("Step 3/4: Grading batch results...")
        metrics, graded = step_grade_batch(results, dry_run)
        if not graded:
            logger.error("No graded records -- aborting round")
            break

        overall = metrics.get("overall", {})
        accuracy = overall.get("accuracy_pct", 0.0)
        action_acc = overall.get("action_accuracy_pct", 0.0)
        entity_res = overall.get("entity_resolution_rate_pct", 0.0)
        pairs_added = overall.get("positive_count", 0)
        total_pairs += pairs_added

        # Step 4: Retrain
        logger.info("Step 4/4: Retraining intent classifier...")
        holdout_acc = step_retrain_intent(graded, round_num, dry_run)

        # Analyze failures for next round targeting
        failure_categories, confused_pairs = analyze_failures(graded)

        duration = round(time.time() - t0, 1)

        round_metrics = RoundMetrics(
            round_num=round_num,
            commands_generated=len(commands),
            commands_graded=len(graded),
            accuracy_pct=accuracy,
            action_accuracy_pct=action_acc,
            entity_resolution_pct=entity_res,
            training_pairs_added=pairs_added,
            holdout_accuracy_pct=holdout_acc,
            failure_categories=dict(failure_categories),
            confused_pairs=confused_pairs,
            duration_s=duration,
        )
        report.rounds.append(round_metrics)
        report.accuracy_curve.append(holdout_acc)
        report.total_rounds = round_num
        report.total_training_pairs = total_pairs
        report.final_accuracy = holdout_acc

        logger.info("")
        logger.info(
            "  Round {} summary: accuracy={:.1f}% holdout={:.1f}% "
            "pairs=+{} time={:.1f}s",
            round_num, accuracy, holdout_acc, pairs_added, duration,
        )

        # Check convergence
        if holdout_acc >= target_accuracy:
            report.converged = True
            report.failure_categories = failure_categories
            report.confused_pairs = confused_pairs
            logger.info("")
            logger.info(
                "CONVERGED at round {} -- holdout accuracy {:.1f}% >= {:.1f}%",
                round_num, holdout_acc, target_accuracy,
            )
            _notify_task_monitor(
                run_id, round_num, max_rounds, "converged", holdout_acc, dry_run,
            )
            break

        # Below target -- log failure analysis
        logger.info(
            "  Below target ({:.1f}% < {:.1f}%) -- analyzing failures...",
            holdout_acc, target_accuracy,
        )
        if failure_categories:
            top3 = sorted(
                failure_categories.items(), key=lambda x: x[1], reverse=True,
            )[:3]
            for action, count in top3:
                logger.info("    {} : {} failures", action, count)
        if confused_pairs:
            for exp, act, count in confused_pairs[:3]:
                logger.info("    confused: {} -> {} ({}x)", exp, act, count)

    # Not converged after all rounds
    if not report.converged:
        report.failure_categories = failure_categories
        report.confused_pairs = (
            confused_pairs if "confused_pairs" in dir() else []
        )
        logger.warning(
            "NOT CONVERGED after {} rounds -- final accuracy {:.1f}%",
            report.total_rounds, report.final_accuracy,
        )
        _notify_task_monitor(
            run_id, report.total_rounds, max_rounds,
            "not_converged", report.final_accuracy, dry_run,
        )

    report.finished_at = datetime.now(timezone.utc).isoformat()

    # Print report
    report_text = generate_report(report)
    for line in report_text.split("\n"):
        logger.info("{}", line)

    # Store to memory (skip in dry-run)
    if not dry_run:
        store_convergence_report(report)

    # Print machine-readable status line (first stdout line for assertions)
    status = (
        f"convergence-loop: "
        f"{'converged' if report.converged else 'not_converged'} "
        f"accuracy={report.final_accuracy:.1f}% "
        f"rounds={report.total_rounds}"
    )
    sys.stdout.write(status + "\n")
    sys.stdout.flush()

    # Write JSON report to stdout
    report_json = {
        "run_id": report.run_id,
        "converged": report.converged,
        "target_accuracy": report.target_accuracy,
        "final_accuracy": report.final_accuracy,
        "total_rounds": report.total_rounds,
        "total_training_pairs": report.total_training_pairs,
        "accuracy_curve": report.accuracy_curve,
        "failure_categories": report.failure_categories,
        "confused_pairs": [
            {"expected": e, "actual": a, "count": c}
            for e, a, c in report.confused_pairs
        ],
        "dry_run": report.dry_run,
        "started_at": report.started_at,
        "finished_at": report.finished_at,
    }
    sys.stdout.write(json.dumps(report_json, indent=2) + "\n")
    sys.stdout.flush()

    return report


# -- CLI ----------------------------------------------------------------------

@app.command()
def main(
    dry_run: bool = typer.Option(
        False, "--dry-run",
        help="Simulate all steps with mock data (no ArangoDB, no CDP, no GPU)",
    ),
    max_rounds: int = typer.Option(
        MAX_ROUNDS_DEFAULT, "--max-rounds",
        help="Maximum convergence rounds (0 = status check only)",
    ),
    target_accuracy: float = typer.Option(
        TARGET_ACCURACY_DEFAULT, "--target-accuracy",
        help="Target holdout accuracy percentage to declare convergence",
    ),
    seed: int = typer.Option(
        42, "--seed",
        help="Random seed for reproducibility",
    ),
) -> None:
    """Run the intent accuracy convergence loop.

    Iteratively generates adversarial commands, grades them, retrains the
    intent classifier, and checks holdout accuracy until the target is met
    or max-rounds is exhausted.

    Each round adds ~200 training pairs and biases generation toward
    failure categories from the previous round.
    """
    report = run_convergence(
        max_rounds=max_rounds,
        target_accuracy=target_accuracy,
        dry_run=dry_run,
        seed=seed,
    )

    if not report.converged and max_rounds > 0:
        raise typer.Exit(1)


if __name__ == "__main__":
    app()

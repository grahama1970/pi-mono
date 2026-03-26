"""monitor-workstation: Nightly workstation health monitor.

Enforces "no artifacts on NVMe" rule, detects cache bloat, checks drive
health, and alerts on threshold breaches.  Composes existing ops-* skills
— never reimplements their logic.

Entry point: `uv run --directory . python monitor.py <command>`

Inputs: CLI arguments (autofix, json, report).
Outputs: Rich console table or JSON report to stdout.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Optional

import typer
from loguru import logger
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

logger.remove()
logger.add(sys.stderr, level="INFO", format="{time:HH:mm:ss} | {level:<7} | {message}")

app = typer.Typer(no_args_is_help=True, help="Nightly workstation health monitor")

STATE_DIR = Path.home() / ".pi" / "monitor-workstation"
STORAGE_12TB = Path(os.environ.get("EMBRY_STORAGE", "/mnt/storage12tb"))
SKILLS_DIR = Path(__file__).resolve().parent.parent

console = Console(stderr=True)


# ---------------------------------------------------------------------------
# Probe framework
# ---------------------------------------------------------------------------

class ProbeStatus(str, Enum):
    PASS = "pass"
    WARN = "warn"
    FAIL = "fail"
    SKIP = "skip"
    FIXED = "fixed"


@dataclass
class ProbeResult:
    probe_id: str
    name: str
    status: ProbeStatus
    message: str
    value: float = 0.0
    details: dict = field(default_factory=dict)
    auto_fixable: bool = False
    fix_applied: bool = False


# ---------------------------------------------------------------------------
# Probe implementations
# ---------------------------------------------------------------------------

def _disk_usage_pct(path: str = "/") -> float:
    """Return disk usage percentage for a mount point."""
    usage = shutil.disk_usage(path)
    return (usage.used / usage.total) * 100


def _dir_size_gb(path: Path) -> float:
    """Return directory size in GB using du."""
    if not path.exists():
        return 0.0
    try:
        result = subprocess.run(
            ["du", "-sb", str(path)],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            return int(result.stdout.split()[0]) / (1024**3)
    except (subprocess.TimeoutExpired, ValueError, IndexError):
        pass
    return 0.0


def probe_nvme_usage(autofix: bool = False) -> ProbeResult:
    """W01: Check NVMe root partition usage."""
    pct = _disk_usage_pct("/")
    if pct > 95:
        status = ProbeStatus.FAIL
        msg = f"CRITICAL: NVMe at {pct:.1f}% — immediate action needed"
    elif pct > 85:
        status = ProbeStatus.WARN
        msg = f"NVMe at {pct:.1f}% — above 85% threshold"
    else:
        status = ProbeStatus.PASS
        msg = f"NVMe at {pct:.1f}%"
    return ProbeResult("W01", "nvme-usage", status, msg, value=round(pct, 1))


# Artifact patterns that should be on 12TB, not NVMe
_ARTIFACT_GLOBS = [
    ("*.ckpt", 0),
    ("*.safetensors", 0),
    ("*.bin", 100),  # min MB
    ("*.gguf", 0),
    ("*.webm", 50),
    ("*.mkv", 50),
    ("*.mp4", 100),
]
_ARTIFACT_DIRS = ["models", "backups", "checkpoints", "training_data"]


def probe_nvme_artifacts(autofix: bool = False) -> ProbeResult:
    """W02: Scan for models/backups/media on NVMe that belong on 12TB."""
    home = Path.home()
    violations: list[str] = []

    # Check workspace for artifact directories
    workspace = home / "workspace"
    if workspace.exists():
        for artifact_dir_name in _ARTIFACT_DIRS:
            try:
                result = subprocess.run(
                    ["find", str(workspace), "-maxdepth", "4",
                     "-type", "d", "-name", artifact_dir_name],
                    capture_output=True, text=True, timeout=30,
                )
                for line in result.stdout.strip().splitlines():
                    p = Path(line)
                    # Skip if it's a symlink to 12TB
                    if p.is_symlink():
                        target = str(p.resolve())
                        if target.startswith(str(STORAGE_12TB)):
                            continue
                    size_gb = _dir_size_gb(p)
                    if size_gb > 0.5:  # Only flag dirs > 500MB
                        violations.append(f"{p} ({size_gb:.1f}GB)")
            except subprocess.TimeoutExpired:
                continue

    # Check for large model files in home
    for glob_pattern, min_mb in _ARTIFACT_GLOBS:
        try:
            result = subprocess.run(
                ["find", str(workspace), "-maxdepth", "5",
                 "-name", glob_pattern, "-type", "f"],
                capture_output=True, text=True, timeout=30,
            )
            for line in result.stdout.strip().splitlines():
                if not line:
                    continue
                p = Path(line)
                try:
                    size_mb = p.stat().st_size / (1024**2)
                    if size_mb >= max(min_mb, 100):
                        violations.append(f"{p} ({size_mb:.0f}MB)")
                except OSError:
                    continue
        except subprocess.TimeoutExpired:
            continue

    if violations:
        msg = f"{len(violations)} artifact(s) on NVMe should be on 12TB"
        return ProbeResult(
            "W02", "nvme-artifacts", ProbeStatus.WARN, msg,
            value=len(violations),
            details={"violations": violations[:20]},
        )
    return ProbeResult("W02", "nvme-artifacts", ProbeStatus.PASS,
                       "No artifact violations found")


def probe_cache_bloat(autofix: bool = False) -> ProbeResult:
    """W03: Check known cache directories for bloat."""
    home = Path.home()
    caches = {
        "uv": (home / ".cache/uv", 20),
        "huggingface": (home / ".cache/huggingface", 30),
        "pip": (home / ".cache/pip", 2),
        "npm": (home / ".cache/npm", 2),
    }

    bloated: list[str] = []
    total_gb = 0.0

    for name, (path, threshold_gb) in caches.items():
        size_gb = _dir_size_gb(path)
        total_gb += size_gb
        if size_gb > threshold_gb:
            bloated.append(f"{name}: {size_gb:.1f}GB (>{threshold_gb}GB)")

    fix_applied = False
    if autofix and bloated:
        logger.info("Auto-fixing cache bloat...")
        for cmd in [
            ["uv", "cache", "prune"],
            ["pip", "cache", "purge"],
            ["npm", "cache", "clean", "--force"],
        ]:
            try:
                subprocess.run(cmd, capture_output=True, timeout=120)
                logger.info("Ran: {}", " ".join(cmd))
            except (subprocess.TimeoutExpired, FileNotFoundError):
                pass
        fix_applied = True

    if bloated:
        status = ProbeStatus.FIXED if fix_applied else ProbeStatus.WARN
        msg = f"{len(bloated)} cache(s) over threshold: {', '.join(bloated)}"
    else:
        status = ProbeStatus.PASS
        msg = f"All caches within limits (total: {total_gb:.1f}GB)"

    return ProbeResult(
        "W03", "cache-bloat", status, msg,
        value=round(total_gb, 1),
        auto_fixable=True, fix_applied=fix_applied,
    )


def probe_experiment_growth(autofix: bool = False) -> ProbeResult:
    """W04: Check experiment dirs on NVMe >50GB."""
    experiments = Path.home() / "workspace" / "experiments"
    if not experiments.exists():
        return ProbeResult("W04", "experiment-growth", ProbeStatus.SKIP,
                           "No experiments directory found")

    large: list[str] = []
    total_gb = 0.0

    try:
        for d in sorted(experiments.iterdir()):
            if not d.is_dir():
                continue
            # Skip symlinks pointing to 12TB
            if d.is_symlink():
                target = str(d.resolve())
                if target.startswith(str(STORAGE_12TB)):
                    continue
            size_gb = _dir_size_gb(d)
            total_gb += size_gb
            if size_gb > 50:
                large.append(f"{d.name}: {size_gb:.0f}GB")
    except OSError:
        pass

    if large:
        msg = f"{len(large)} experiment(s) >50GB on NVMe: {', '.join(large)}"
        return ProbeResult("W04", "experiment-growth", ProbeStatus.WARN, msg,
                           value=round(total_gb, 1),
                           details={"large_dirs": large})
    return ProbeResult("W04", "experiment-growth", ProbeStatus.PASS,
                       f"All experiments within limits (total: {total_gb:.0f}GB)",
                       value=round(total_gb, 1))


def probe_arango_backup(autofix: bool = False) -> ProbeResult:
    """W05: Check ArangoDB backup freshness and location."""
    backup_dir = STORAGE_12TB / "backups" / "arangodb"

    # Also check for backups on NVMe (violation)
    nvme_backup = Path.home() / ".local/state/devops-agent/arangodumps"
    if nvme_backup.exists() and any(nvme_backup.iterdir()):
        size_gb = _dir_size_gb(nvme_backup)
        if size_gb > 0.1:
            return ProbeResult(
                "W05", "arango-backup", ProbeStatus.WARN,
                f"ArangoDB backups on NVMe ({size_gb:.1f}GB) — should be on 12TB",
                value=size_gb,
            )

    if not backup_dir.exists():
        return ProbeResult("W05", "arango-backup", ProbeStatus.WARN,
                           f"Backup dir not found: {backup_dir}")

    # Find most recent backup
    backups = sorted(backup_dir.iterdir(), key=lambda p: p.stat().st_mtime,
                     reverse=True) if backup_dir.exists() else []
    if not backups:
        return ProbeResult("W05", "arango-backup", ProbeStatus.WARN,
                           "No backups found on 12TB")

    newest = backups[0]
    age_hours = (time.time() - newest.stat().st_mtime) / 3600

    if age_hours > 48:
        return ProbeResult("W05", "arango-backup", ProbeStatus.WARN,
                           f"Latest backup is {age_hours:.0f}h old (>{48}h threshold)",
                           value=round(age_hours, 1))
    return ProbeResult("W05", "arango-backup", ProbeStatus.PASS,
                       f"Latest backup: {newest.name} ({age_hours:.0f}h ago)",
                       value=round(age_hours, 1))


def probe_docker_reclaimable(autofix: bool = False) -> ProbeResult:
    """W06: Check Docker reclaimable space."""
    try:
        result = subprocess.run(
            ["docker", "system", "df", "--format", "{{.Reclaimable}}"],
            capture_output=True, text=True, timeout=15,
        )
        if result.returncode != 0:
            return ProbeResult("W06", "docker-reclaimable", ProbeStatus.SKIP,
                               "Docker not available")

        # Parse reclaimable sizes — format like "1.2GB (50%)" per line
        total_gb = 0.0
        for line in result.stdout.strip().splitlines():
            line = line.strip()
            if not line:
                continue
            # Extract the size part before any parentheses
            size_str = line.split("(")[0].strip()
            if "GB" in size_str:
                total_gb += float(size_str.replace("GB", "").strip())
            elif "MB" in size_str:
                total_gb += float(size_str.replace("MB", "").strip()) / 1024
            elif "kB" in size_str:
                total_gb += float(size_str.replace("kB", "").strip()) / (1024**2)
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return ProbeResult("W06", "docker-reclaimable", ProbeStatus.SKIP,
                           "Docker command failed")

    if total_gb > 50:
        msg = f"Docker reclaimable: {total_gb:.0f}GB (>50GB) — run `docker system prune`"
        return ProbeResult("W06", "docker-reclaimable", ProbeStatus.WARN, msg,
                           value=round(total_gb, 1))
    return ProbeResult("W06", "docker-reclaimable", ProbeStatus.PASS,
                       f"Docker reclaimable: {total_gb:.1f}GB",
                       value=round(total_gb, 1))


def probe_zombie_processes(autofix: bool = False) -> ProbeResult:
    """W07: Check for zombie Claude/Chromium/Python processes."""
    zombies: list[str] = []

    for pattern in ["claude", "chromium", "chrome"]:
        try:
            result = subprocess.run(
                ["pgrep", "-af", pattern],
                capture_output=True, text=True, timeout=10,
            )
            for line in result.stdout.strip().splitlines():
                if not line:
                    continue
                parts = line.split(None, 1)
                if len(parts) < 2:
                    continue
                pid = parts[0]
                cmd = parts[1]
                # Check process age via /proc
                try:
                    stat_path = Path(f"/proc/{pid}/stat")
                    if stat_path.exists():
                        # Get process start time
                        create_time = stat_path.stat().st_mtime
                        age_hours = (time.time() - create_time) / 3600
                        if age_hours > 24:
                            zombies.append(
                                f"PID {pid} ({pattern}, {age_hours:.0f}h): {cmd[:80]}"
                            )
                except OSError:
                    continue
        except (subprocess.TimeoutExpired, FileNotFoundError):
            continue

    if zombies:
        msg = f"{len(zombies)} zombie process(es) >24h old"
        return ProbeResult("W07", "zombie-processes", ProbeStatus.WARN, msg,
                           value=len(zombies),
                           details={"zombies": zombies[:10]})
    return ProbeResult("W07", "zombie-processes", ProbeStatus.PASS,
                       "No zombie processes found")


def probe_drive_health(autofix: bool = False) -> ProbeResult:
    """W08: Check SMART status of drives."""
    drives_checked = 0
    issues: list[str] = []

    for dev in ["/dev/nvme0n1", "/dev/sda"]:
        try:
            result = subprocess.run(
                ["sudo", "smartctl", "-H", dev],
                capture_output=True, text=True, timeout=15,
            )
            drives_checked += 1
            output = result.stdout.lower()
            if "passed" not in output and "ok" not in output:
                issues.append(f"{dev}: SMART check did not report PASSED")
        except (subprocess.TimeoutExpired, FileNotFoundError):
            continue

    if drives_checked == 0:
        return ProbeResult("W08", "drive-health", ProbeStatus.SKIP,
                           "smartctl not available or no drives accessible")
    if issues:
        return ProbeResult("W08", "drive-health", ProbeStatus.FAIL,
                           "; ".join(issues), value=len(issues))
    return ProbeResult("W08", "drive-health", ProbeStatus.PASS,
                       f"{drives_checked} drive(s) healthy",
                       value=drives_checked)


# Known /tmp prefixes from skills that create temp workspaces
_TMP_SKILL_PREFIXES = [
    "code-review-workspace-",
    "learn_datalake_worker_",
    "extractor_",
]

# Max age (hours) before a temp dir is considered orphaned
_TMP_MAX_AGE_HOURS = 4
# Size (GB) that forces orphan status regardless of age — no legitimate
# review workspace should be this large (2026-03-05: 979GB incident)
_TMP_SIZE_FORCE_ORPHAN_GB = 1.0
# Total /tmp threshold in GB before warning
_TMP_WARN_GB = 10


def probe_tmp_bloat(autofix: bool = False) -> ProbeResult:
    """W09: Detect /tmp bloat from orphaned skill workspaces."""
    tmp = Path("/tmp")
    orphaned: list[str] = []
    total_gb = 0.0

    # Scan for known skill temp dirs
    try:
        for entry in tmp.iterdir():
            if not entry.is_dir():
                continue
            matched = any(entry.name.startswith(p) for p in _TMP_SKILL_PREFIXES)
            if not matched:
                continue
            try:
                age_hours = (time.time() - entry.stat().st_mtime) / 3600
            except OSError:
                continue
            size_gb = _dir_size_gb(entry)
            # Orphan if old enough OR if suspiciously large (no legit workspace is >1GB)
            if age_hours > _TMP_MAX_AGE_HOURS or size_gb > _TMP_SIZE_FORCE_ORPHAN_GB:
                total_gb += size_gb
                reason = f"{age_hours:.0f}h old" if age_hours > _TMP_MAX_AGE_HOURS else f"oversized"
                orphaned.append(f"{entry.name} ({size_gb:.1f}GB, {reason})")
    except OSError:
        return ProbeResult("W09", "tmp-bloat", ProbeStatus.SKIP,
                           "Cannot read /tmp")

    # Also check total /tmp size
    tmp_total_gb = _dir_size_gb(tmp)

    fix_applied = False
    if autofix and orphaned:
        logger.info("Auto-fixing /tmp bloat: removing {} orphaned dir(s)", len(orphaned))
        for entry in tmp.iterdir():
            if not entry.is_dir():
                continue
            matched = any(entry.name.startswith(p) for p in _TMP_SKILL_PREFIXES)
            if not matched:
                continue
            try:
                age_hours = (time.time() - entry.stat().st_mtime) / 3600
                size_gb = _dir_size_gb(entry)
            except OSError:
                continue
            if age_hours > _TMP_MAX_AGE_HOURS or size_gb > _TMP_SIZE_FORCE_ORPHAN_GB:
                logger.info("Removing orphaned temp dir: {} ({:.1f}GB)", entry.name, size_gb)
                shutil.rmtree(entry, ignore_errors=True)
        # Restart IBus — /tmp fillup breaks its IPC, killing keyboard input
        # in Chrome and other apps. Safe to run even if IBus is healthy.
        try:
            subprocess.run(
                ["ibus-daemon", "--replace", "--xim", "--daemonize"],
                capture_output=True, timeout=10,
            )
            logger.info("Restarted ibus-daemon to restore keyboard input")
        except (subprocess.TimeoutExpired, FileNotFoundError):
            logger.warning("Could not restart ibus-daemon")
        fix_applied = True

    if orphaned:
        status = ProbeStatus.FIXED if fix_applied else ProbeStatus.FAIL
        msg = (f"{len(orphaned)} orphaned temp dir(s) in /tmp "
               f"({total_gb:.1f}GB) — /tmp total: {tmp_total_gb:.0f}GB")
        return ProbeResult(
            "W09", "tmp-bloat", status, msg,
            value=round(total_gb, 1),
            details={"orphaned": orphaned[:20]},
            auto_fixable=True, fix_applied=fix_applied,
        )
    if tmp_total_gb > _TMP_WARN_GB:
        return ProbeResult(
            "W09", "tmp-bloat", ProbeStatus.WARN,
            f"/tmp is {tmp_total_gb:.0f}GB (>{_TMP_WARN_GB}GB) — no known skill dirs, investigate manually",
            value=round(tmp_total_gb, 1),
        )
    return ProbeResult("W09", "tmp-bloat", ProbeStatus.PASS,
                       f"/tmp is {tmp_total_gb:.1f}GB",
                       value=round(tmp_total_gb, 1))


# ---------------------------------------------------------------------------
# Probe registry
# ---------------------------------------------------------------------------

ALL_PROBES = [
    ("W01", "nvme-usage", probe_nvme_usage),
    ("W02", "nvme-artifacts", probe_nvme_artifacts),
    ("W03", "cache-bloat", probe_cache_bloat),
    ("W04", "experiment-growth", probe_experiment_growth),
    ("W05", "arango-backup", probe_arango_backup),
    ("W06", "docker-reclaimable", probe_docker_reclaimable),
    ("W07", "zombie-processes", probe_zombie_processes),
    ("W08", "drive-health", probe_drive_health),
    ("W09", "tmp-bloat", probe_tmp_bloat),
]


def run_all_probes(autofix: bool = False) -> list[ProbeResult]:
    """Execute all probes and collect results."""
    results: list[ProbeResult] = []
    for probe_id, name, fn in ALL_PROBES:
        try:
            logger.info("[{}] Running {}", probe_id, name)
            result = fn(autofix=autofix)
            results.append(result)
            logger.info("[{}] {} → {}", probe_id, name, result.status.value)
        except Exception as e:
            logger.error("[{}] {} crashed: {}", probe_id, name, e)
            results.append(ProbeResult(
                probe_id=probe_id, name=name,
                status=ProbeStatus.FAIL,
                message=f"Probe crashed: {e}",
            ))
    return results


# ---------------------------------------------------------------------------
# Reporter
# ---------------------------------------------------------------------------

_STATUS_STYLE = {
    ProbeStatus.PASS: "green",
    ProbeStatus.WARN: "yellow",
    ProbeStatus.FAIL: "red bold",
    ProbeStatus.SKIP: "dim",
    ProbeStatus.FIXED: "cyan",
}


def _compute_health(results: list[ProbeResult]) -> str:
    if any(r.status == ProbeStatus.FAIL for r in results):
        return "critical"
    if any(r.status == ProbeStatus.WARN for r in results):
        return "warning"
    return "healthy"


def _render_table(results: list[ProbeResult]) -> None:
    health = _compute_health(results)
    health_color = {"healthy": "green", "warning": "yellow", "critical": "red"}[health]
    counts = {s: sum(1 for r in results if r.status == s) for s in ProbeStatus}

    console.print(Panel(
        f"[{health_color} bold]{health.upper()}[/{health_color} bold]  "
        f"({counts[ProbeStatus.PASS]} pass, {counts[ProbeStatus.WARN]} warn, "
        f"{counts[ProbeStatus.FAIL]} fail, {counts[ProbeStatus.SKIP]} skip, "
        f"{counts[ProbeStatus.FIXED]} fixed)",
        title="Monitor Workstation",
        subtitle=time.strftime("%Y-%m-%d %H:%M"),
    ))

    table = Table(show_header=True, header_style="bold")
    table.add_column("ID", style="dim", width=4)
    table.add_column("Probe", min_width=20)
    table.add_column("Status", justify="center", width=8)
    table.add_column("Value", justify="right", width=10)
    table.add_column("Message")

    for r in results:
        style = _STATUS_STYLE.get(r.status, "")
        table.add_row(
            r.probe_id, r.name,
            f"[{style}]{r.status.value.upper()}[/{style}]",
            str(r.value) if r.value else "",
            r.message,
        )

    console.print(table)


def _build_json_payload(results: list[ProbeResult]) -> dict:
    health = _compute_health(results)
    counts = {s.value: sum(1 for r in results if r.status == s) for s in ProbeStatus}

    # Build figure_data for /dashboard consumption
    figure_metrics: dict[str, float] = {}
    for r in results:
        if r.probe_id == "W01":
            figure_metrics["NVMe Used %"] = r.value
        elif r.probe_id == "W03":
            figure_metrics["Cache GB"] = r.value
        elif r.probe_id == "W04":
            figure_metrics["Experiments GB"] = r.value
        elif r.probe_id == "W06":
            figure_metrics["Docker Reclaimable GB"] = r.value

    return {
        "health": health,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "summary": counts,
        "total": len(results),
        "probes": [
            {
                "probe_id": r.probe_id,
                "name": r.name,
                "status": r.status.value,
                "message": r.message,
                "value": r.value,
                "details": r.details,
                "auto_fixable": r.auto_fixable,
                "fix_applied": r.fix_applied,
            }
            for r in results
        ],
        "figure_data": {
            "bar": {"metrics": figure_metrics},
        },
    }


def _save_state(payload: dict) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    # Save latest report
    report_file = STATE_DIR / "report.json"
    try:
        tmp = report_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, indent=2))
        os.replace(tmp, report_file)
    except OSError as e:
        logger.error("Failed to save report: {}", e)

    # Append to history
    history_file = STATE_DIR / "history.jsonl"
    try:
        with open(history_file, "a") as f:
            f.write(json.dumps({
                "timestamp": payload["timestamp"],
                "health": payload["health"],
                "summary": payload["summary"],
                "probes": [
                    {"id": p["probe_id"], "name": p["name"],
                     "status": p["status"], "value": p["value"]}
                    for p in payload["probes"]
                ],
            }) + "\n")
    except OSError as e:
        logger.error("Failed to append history: {}", e)


def _send_discord_alerts(results: list[ProbeResult]) -> None:
    """Send Discord alerts for WARN/FAIL probes via common/discord_notify."""
    alerts = [r for r in results if r.status in (ProbeStatus.WARN, ProbeStatus.FAIL)]
    if not alerts:
        return

    try:
        skills_dir = Path(__file__).resolve().parent.parent
        if str(skills_dir) not in sys.path:
            sys.path.insert(0, str(skills_dir))
        from common.discord_notify import notify_health

        health = _compute_health(results)
        status = "critical" if health == "critical" else "warning"
        lines = [f"- [{r.probe_id}] {r.name}: {r.message}" for r in alerts]
        notify_health(
            skill="monitor-workstation",
            status=status,
            message="\n".join(lines),
            title=f"Workstation Health: {health.upper()}",
        )
        logger.info("Discord alert sent for {} probe(s)", len(alerts))
    except Exception as e:
        logger.warning("Discord notification failed: {}", e)


# ---------------------------------------------------------------------------
# CLI commands
# ---------------------------------------------------------------------------

@app.command()
def check(
    autofix: bool = typer.Option(False, help="Auto-fix safe probes (cache pruning)"),
    json_output: bool = typer.Option(False, "--json", help="JSON output"),
    report: bool = typer.Option(False, "--report", help="Generate visual report via /analytics"),
) -> None:
    """Run all 8 health probes and report results."""
    logger.info("Running probes autofix={}", autofix)
    results = run_all_probes(autofix=autofix)

    if not results:
        logger.warning("No probe results")
        return

    payload = _build_json_payload(results)

    if json_output:
        out = Console()
        out.print_json(json.dumps(payload))
    else:
        _render_table(results)

    _save_state(payload)
    _send_discord_alerts(results)

    if report:
        _generate_visual_report(payload)

    fail_count = sum(1 for r in results if r.status == ProbeStatus.FAIL)
    if fail_count:
        logger.warning("{} probe(s) reported FAIL — see report for details", fail_count)


def _generate_visual_report(payload: dict) -> None:
    """Generate visual report by composing /analytics → /create-figure."""
    STATE_DIR.mkdir(parents=True, exist_ok=True)

    # Write probe data as JSONL for /analytics
    probe_data_file = STATE_DIR / "probe_data.jsonl"
    with open(probe_data_file, "w") as f:
        for p in payload["probes"]:
            f.write(json.dumps({"name": p["name"], "value": p["value"],
                                "status": p["status"]}) + "\n")

    metrics_file = STATE_DIR / "metrics.json"
    report_png = STATE_DIR / "report.png"

    # Step 1: analytics group-by
    analytics = SKILLS_DIR / "analytics" / "run.sh"
    if analytics.exists():
        try:
            subprocess.run(
                [str(analytics), "group-by", str(probe_data_file),
                 "--by", "name", "--agg", "value", "--func", "last",
                 "--for-figure", "-o", str(metrics_file)],
                capture_output=True, timeout=30,
            )
        except (subprocess.TimeoutExpired, OSError) as e:
            logger.warning("analytics group-by failed: {}", e)
            return

    # Step 2: create-figure
    create_figure = SKILLS_DIR / "create-figure" / "run.sh"
    if create_figure.exists() and metrics_file.exists():
        try:
            subprocess.run(
                [str(create_figure), "metrics", "-i", str(metrics_file),
                 "--type", "hbar", "-o", str(report_png)],
                capture_output=True, timeout=30,
            )
            logger.info("Visual report: {}", report_png)
        except (subprocess.TimeoutExpired, OSError) as e:
            logger.warning("create-figure failed: {}", e)

    # Step 3: historical trend
    history_file = STATE_DIR / "history.jsonl"
    if history_file.exists() and create_figure.exists() and analytics.exists():
        trend_json = STATE_DIR / "trend.json"
        trend_png = STATE_DIR / "trend.png"
        try:
            subprocess.run(
                [str(analytics), "chart", str(history_file),
                 "--name", "trend_nvme_usage", "-o", str(trend_json)],
                capture_output=True, timeout=30,
            )
            if trend_json.exists():
                subprocess.run(
                    [str(create_figure), "training-curves", "-i", str(trend_json),
                     "-o", str(trend_png)],
                    capture_output=True, timeout=30,
                )
                logger.info("Trend report: {}", trend_png)
        except (subprocess.TimeoutExpired, OSError) as e:
            logger.warning("Trend generation failed: {}", e)


@app.command()
def dashboard() -> None:
    """Rich TUI showing latest probe results from state files."""
    report_file = STATE_DIR / "report.json"
    if not report_file.exists():
        console.print("[yellow]No report found. Run 'check' first.[/yellow]")
        return

    try:
        data = json.loads(report_file.read_text())
    except (json.JSONDecodeError, OSError) as e:
        console.print(f"[red]Failed to load report: {e}[/red]")
        return

    health = data.get("health", "unknown")
    health_color = {"healthy": "green", "warning": "yellow", "critical": "red"}.get(
        health, "white")

    console.print(Panel(
        f"[{health_color} bold]{health.upper()}[/{health_color} bold]",
        title="Workstation Dashboard",
        subtitle=data.get("timestamp", ""),
    ))

    table = Table(show_header=True, header_style="bold")
    table.add_column("ID", style="dim", width=4)
    table.add_column("Probe", min_width=20)
    table.add_column("Status", justify="center", width=8)
    table.add_column("Value", justify="right", width=10)
    table.add_column("Message")

    for p in data.get("probes", []):
        status = p.get("status", "unknown")
        style = {"pass": "green", "warn": "yellow", "fail": "red bold",
                 "skip": "dim", "fixed": "cyan"}.get(status, "")
        table.add_row(
            p.get("probe_id", ""), p.get("name", ""),
            f"[{style}]{status.upper()}[/{style}]",
            str(p.get("value", "")),
            p.get("message", ""),
        )
    console.print(table)


@app.command()
def fix(probe_name: str = typer.Argument(..., help="Probe name to fix")) -> None:
    """Manually trigger auto-fix for a specific probe."""
    logger.info("Manual fix requested for probe: {}", probe_name)

    probe_map = {name: fn for _, name, fn in ALL_PROBES}
    if probe_name not in probe_map:
        logger.error("Probe '{}' not found. Available: {}",
                     probe_name, list(probe_map.keys()))
        raise SystemExit(1)

    result = probe_map[probe_name](autofix=True)
    _render_table([result])

    if not result.auto_fixable:
        logger.warning("Probe '{}' is not auto-fixable", probe_name)
    elif result.fix_applied:
        logger.info("Fix applied successfully for '{}'", probe_name)
    elif result.status == ProbeStatus.PASS:
        logger.info("Probe '{}' is already passing", probe_name)


def main() -> None:
    app()


if __name__ == "__main__":
    main()

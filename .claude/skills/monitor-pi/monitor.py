#!/usr/bin/env python3
"""monitor-pi: Continuous Pi agent infrastructure health watchdog.

Monitors the D-Bus daemon (embry-agent.service), scheduler daemon,
scillm service, and scheduler job success rates. Fires Discord alerts
on failures.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass, asdict
from datetime import datetime
from pathlib import Path

import typer
from loguru import logger

# Import discord notify from common
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "common"))
try:
    from discord_notify import notify_health, notify_error
except ImportError:
    def notify_health(*a, **kw):
        pass
    def notify_error(*a, **kw):
        pass

app = typer.Typer(help="Pi agent infrastructure health watchdog")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SCAN_INTERVAL = int(os.environ.get("PI_MONITOR_INTERVAL", "300"))
MAX_LOG_MB = float(os.environ.get("PI_MAX_LOG_MB", "100"))
JOB_FAIL_THRESHOLD = float(os.environ.get("PI_JOB_FAIL_THRESHOLD", "0.5"))

LOG_DIR = Path.home() / ".pi" / "memory" / "monitor-pi"
LOG_FILE = LOG_DIR / "alerts.jsonl"
SCHEDULER_JOBS = Path.home() / ".pi" / "scheduler" / "jobs.json"
SCHEDULER_LOGS = Path.home() / ".pi" / "scheduler" / "logs"
SCHEDULER_PID = Path.home() / ".pi" / "scheduler" / "scheduler.pid"

SERVICES = [
    ("embry-agent.service", "Pi D-Bus daemon"),
    ("embry-scillm.service", "scillm LLM proxy"),
]


@dataclass
class ServiceStatus:
    name: str
    description: str
    active: bool
    crash_looping: bool = False
    restart_count: int = 0


@dataclass
class SchedulerStatus:
    running: bool
    pid: int | None
    total_jobs: int = 0
    enabled_jobs: int = 0
    failed_jobs: int = 0
    success_jobs: int = 0
    fail_rate: float = 0.0


@dataclass
class LogHealth:
    total_size_mb: float = 0.0
    bloated_files: list[str] | None = None


@dataclass
class HealthReport:
    timestamp: str
    services: list[ServiceStatus]
    scheduler: SchedulerStatus
    logs: LogHealth
    alerts: list[str]
    healthy: bool


def _run(cmd: list[str], timeout: int = 10) -> tuple[int, str]:
    """Run a command and return (returncode, stdout)."""
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=timeout,
        )
        return result.returncode, result.stdout.strip()
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return -1, ""


def check_systemd_service(name: str, description: str) -> ServiceStatus:
    """Check a systemd user service."""
    rc, output = _run(["systemctl", "--user", "is-active", name])
    active = output == "active"

    # Check for crash-looping via NRestarts
    crash_looping = False
    restart_count = 0
    rc2, props = _run([
        "systemctl", "--user", "show", name,
        "--property=NRestarts",
    ])
    if rc2 == 0 and "=" in props:
        try:
            restart_count = int(props.split("=")[1])
            crash_looping = restart_count > 10
        except ValueError:
            pass

    return ServiceStatus(
        name=name,
        description=description,
        active=active,
        crash_looping=crash_looping,
        restart_count=restart_count,
    )


def check_scheduler() -> SchedulerStatus:
    """Check the scheduler daemon and job statistics."""
    pid = None
    running = False

    if SCHEDULER_PID.exists():
        try:
            pid = int(SCHEDULER_PID.read_text().strip())
            # Check if process is actually alive
            os.kill(pid, 0)
            running = True
        except (ValueError, ProcessLookupError, PermissionError):
            pass

    total = 0
    enabled = 0
    failed = 0
    success = 0

    if SCHEDULER_JOBS.exists():
        try:
            jobs = json.loads(SCHEDULER_JOBS.read_text())
            for job in jobs.values():
                if not isinstance(job, dict):
                    continue
                total += 1
                if job.get("enabled", True):
                    enabled += 1
                status = job.get("last_status", "")
                if status == "success":
                    success += 1
                elif status in ("failed", "timeout"):
                    failed += 1
        except (json.JSONDecodeError, AttributeError):
            pass

    jobs_with_status = success + failed
    fail_rate = failed / jobs_with_status if jobs_with_status > 0 else 0.0

    return SchedulerStatus(
        running=running,
        pid=pid,
        total_jobs=total,
        enabled_jobs=enabled,
        failed_jobs=failed,
        success_jobs=success,
        fail_rate=round(fail_rate, 2),
    )


def check_logs() -> LogHealth:
    """Check scheduler log directory for bloat."""
    bloated = []
    total_mb = 0.0

    if SCHEDULER_LOGS.exists():
        for f in SCHEDULER_LOGS.iterdir():
            if f.is_file():
                size_mb = f.stat().st_size / (1024 * 1024)
                total_mb += size_mb
                if size_mb > MAX_LOG_MB:
                    bloated.append(f"{f.name} ({size_mb:.0f}MB)")

    return LogHealth(
        total_size_mb=round(total_mb, 1),
        bloated_files=bloated if bloated else None,
    )


def run_health_check() -> HealthReport:
    """Run full health check and return report."""
    alerts: list[str] = []

    # Check services
    services = []
    for name, desc in SERVICES:
        status = check_systemd_service(name, desc)
        services.append(status)
        if not status.active:
            alerts.append(f"SERVICE DOWN: {desc} ({name})")
        if status.crash_looping:
            alerts.append(
                f"CRASH-LOOP: {desc} ({name}) — {status.restart_count} restarts"
            )

    # Check scheduler
    scheduler = check_scheduler()
    if not scheduler.running:
        alerts.append("SCHEDULER DOWN: Scheduler daemon not running")
    if scheduler.fail_rate > JOB_FAIL_THRESHOLD:
        alerts.append(
            f"HIGH FAIL RATE: {scheduler.fail_rate:.0%} of scheduler jobs failing "
            f"({scheduler.failed_jobs}/{scheduler.failed_jobs + scheduler.success_jobs})"
        )

    # Check logs
    logs = check_logs()
    if logs.bloated_files:
        alerts.append(
            f"LOG BLOAT: {len(logs.bloated_files)} files over {MAX_LOG_MB}MB — "
            + ", ".join(logs.bloated_files[:3])
        )

    healthy = len(alerts) == 0

    return HealthReport(
        timestamp=datetime.now().isoformat(),
        services=services,
        scheduler=scheduler,
        logs=logs,
        alerts=alerts,
        healthy=healthy,
    )


def _print_report(report: HealthReport) -> None:
    """Print a human-readable health report."""
    status_icon = "OK" if report.healthy else "DEGRADED"
    print(f"\n=== Pi Infrastructure Health: {status_icon} ===")
    print(f"Timestamp: {report.timestamp}\n")

    print("Services:")
    for svc in report.services:
        state = "UP" if svc.active else "DOWN"
        extra = ""
        if svc.crash_looping:
            extra = f" (CRASH-LOOPING, {svc.restart_count} restarts)"
        elif svc.restart_count > 0:
            extra = f" ({svc.restart_count} restarts)"
        print(f"  {svc.description}: {state}{extra}")

    print(f"\nScheduler:")
    sched = report.scheduler
    sched_state = "UP" if sched.running else "DOWN"
    print(f"  Status: {sched_state} (PID {sched.pid})")
    print(f"  Jobs: {sched.enabled_jobs} enabled / {sched.total_jobs} total")
    print(f"  Success: {sched.success_jobs}, Failed: {sched.failed_jobs}")
    print(f"  Fail rate: {sched.fail_rate:.0%}")

    print(f"\nLogs:")
    print(f"  Total size: {report.logs.total_size_mb:.1f} MB")
    if report.logs.bloated_files:
        for bf in report.logs.bloated_files:
            print(f"  BLOATED: {bf}")

    if report.alerts:
        print(f"\nAlerts ({len(report.alerts)}):")
        for alert in report.alerts:
            print(f"  - {alert}")
    else:
        print("\nNo alerts.")
    print()


def _log_alert(report: HealthReport) -> None:
    """Append alerts to JSONL log and fire Discord notifications."""
    if not report.alerts:
        return

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    entry = {
        "timestamp": report.timestamp,
        "alerts": report.alerts,
        "healthy": report.healthy,
    }
    with open(LOG_FILE, "a") as f:
        f.write(json.dumps(entry) + "\n")

    # Fire Discord alerts
    for alert in report.alerts:
        if "DOWN" in alert or "CRASH-LOOP" in alert:
            notify_error("monitor-pi", alert)
        else:
            notify_health("monitor-pi", alert)


@app.command()
def check(
    json_output: bool = typer.Option(False, "--json", help="Output JSON"),
) -> None:
    """One-shot health check."""
    report = run_health_check()

    if json_output:
        # Convert dataclasses to dicts for JSON
        daemons_up = sum(1 for s in report.services if s.active)
        jobs_total = report.scheduler.total_jobs
        jobs_success_rate = (
            report.scheduler.success_jobs / (report.scheduler.success_jobs + report.scheduler.failed_jobs)
            if (report.scheduler.success_jobs + report.scheduler.failed_jobs) > 0
            else 0.0
        )

        data = {
            "timestamp": report.timestamp,
            "healthy": report.healthy,
            "services": [asdict(s) for s in report.services],
            "scheduler": asdict(report.scheduler),
            "logs": asdict(report.logs),
            "alerts": report.alerts,
            "figure_data": {
                "bar": {
                    "metrics": {
                        "daemons_up": daemons_up,
                        "scheduler_jobs_total": jobs_total,
                        "scheduler_jobs_success_rate": round(jobs_success_rate, 2),
                    }
                }
            }
        }
        json_str = json.dumps(data, indent=2)
        print(json_str)

        # Save to state dir
        state_dir = Path.home() / ".pi" / "monitor-pi"
        state_dir.mkdir(parents=True, exist_ok=True)
        report_file = state_dir / "report.json"
        report_file.write_text(json_str)
    else:
        _print_report(report)

    _log_alert(report)

    # Exit 0 even when degraded — the monitor succeeded at detecting problems.
    # Discord alerts handle severity; scheduler cares about "did the monitor run?"


@app.command()
def watch() -> None:
    """Continuous monitoring loop."""
    logger.info(f"Starting Pi health monitor (interval={SCAN_INTERVAL}s)")
    while True:
        try:
            report = run_health_check()
            if not report.healthy:
                _print_report(report)
                _log_alert(report)
            else:
                logger.info("All healthy")
        except Exception as e:
            logger.error(f"Health check failed: {e}")
        time.sleep(SCAN_INTERVAL)


if __name__ == "__main__":
    app()

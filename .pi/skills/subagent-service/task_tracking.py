"""Task-monitor integration for subagent-service.

Tracks subagent tasks in-memory and writes state files for /dashboard discovery.
"""
from __future__ import annotations

import json
import os
import time
import uuid
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

# Task-monitor integration — write state file for /dashboard discovery
TASK_STATE_DIR = Path.home() / ".pi" / "task-monitor"
TASK_STATE_FILE = TASK_STATE_DIR / "subagent-service_task_state.json"
TASK_REGISTRY = TASK_STATE_DIR / "registry.json"

# In-memory task tracker — exposes task-monitor compatible JSON via GET /tasks
MAX_TASKS = 100  # Keep last N tasks (LRU eviction)
TASKS: OrderedDict[str, dict] = OrderedDict()

# Map task_id → asyncio.subprocess.Process for cancel support
ACTIVE_PROCS: dict[str, "asyncio.subprocess.Process"] = {}  # type: ignore[name-defined]

# Reference to USAGE dict from server — set via init()
_USAGE: dict[str, dict] = {}


def init(usage_ref: dict[str, dict]) -> None:
    """Wire the shared USAGE dict from server module."""
    global _USAGE
    _USAGE = usage_ref


def task_create(backend: str, model: str, prompt: str) -> str:
    """Create a task entry, return task_id."""
    task_id = str(uuid.uuid4())[:8]
    now = time.time()
    TASKS[task_id] = {
        "task_id": task_id,
        "skill": "subagent-service",
        "backend": backend,
        "model": model,
        "prompt_preview": prompt[:120],
        "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "start_time": now,
        "completed": 0,
        "total": 1,
        "progress_pct": 0.0,
        "elapsed_seconds": 0.0,
        "stats": {},
        "current_item": f"{backend}/{model}",
        "last_updated": datetime.now(timezone.utc).isoformat(),
    }
    # Evict oldest if over limit
    while len(TASKS) > MAX_TASKS:
        TASKS.popitem(last=False)
    write_task_state()
    return task_id


def register_proc(task_id: str, proc: "asyncio.subprocess.Process") -> None:  # type: ignore[name-defined]
    """Register a subprocess so it can be killed via POST /tasks/{id}/cancel."""
    ACTIVE_PROCS[task_id] = proc


def unregister_proc(task_id: str) -> None:
    """Remove subprocess reference after task completes."""
    ACTIVE_PROCS.pop(task_id, None)


def cancel_task(task_id: str) -> bool:
    """Kill the subprocess for a running task. Returns True if killed."""
    proc = ACTIVE_PROCS.get(task_id)
    if proc is None:
        return False
    try:
        proc.kill()
        return True
    except ProcessLookupError:
        return False


def task_complete(task_id: str, *, exit_code: int = 0, duration_ms: int = 0,
                  cost_usd: float = 0.0, tokens_in: int = 0, tokens_out: int = 0,
                  error: str = ""):
    """Mark a task as completed or errored."""
    unregister_proc(task_id)
    if task_id not in TASKS:
        return
    t = TASKS[task_id]
    t["status"] = "error" if (exit_code != 0 or error) else "completed"
    t["completed"] = 1
    t["progress_pct"] = 100.0
    t["elapsed_seconds"] = round(duration_ms / 1000, 1)
    t["stats"] = {
        "exit_code": exit_code,
        "duration_ms": duration_ms,
        "cost_usd": cost_usd,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
    }
    if error:
        t["current_item"] = f"ERROR: {error[:80]}"
    else:
        t["current_item"] = "done"
    t["last_updated"] = datetime.now(timezone.utc).isoformat()
    write_task_state()


def write_task_state():
    """Write aggregate task state for /dashboard discovery."""
    try:
        running = [t for t in TASKS.values() if t["status"] == "running"]
        completed = sum(1 for t in TASKS.values() if t["status"] == "completed")
        errored = sum(1 for t in TASKS.values() if t["status"] == "error")
        total = completed + errored + len(running)
        now = time.time()

        # Current item: show running backends or "idle"
        if running:
            items = [f"{t['backend']}/{t['model']}" for t in running[:3]]
            current = ", ".join(items)
            if len(running) > 3:
                current += f" +{len(running) - 3}"
        else:
            current = "idle"

        state = {
            "skill": "subagent-service",
            "completed": completed + errored,
            "total": max(total, 1),
            "description": f"Subagent gateway — {len(running)} active, {completed} done, {errored} errors",
            "current_item": current,
            "progress_pct": round((completed + errored) / max(total, 1) * 100, 1) if total else 0,
            "elapsed_seconds": round(now - (running[0]["start_time"] if running else now), 1),
            "eta_seconds": None,
            "throughput_per_sec": 0,
            "stats": {
                "success": completed,
                "failed": errored,
                "active": len(running),
                "by_backend": {k: v.get("requests", 0) for k, v in _USAGE.items()},
            },
            "last_updated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
            "status": "running" if running else ("completed" if total else "idle"),
        }
        TASK_STATE_DIR.mkdir(parents=True, exist_ok=True)
        tmp = TASK_STATE_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(state, indent=2))
        os.replace(tmp, TASK_STATE_FILE)
    except Exception:
        pass  # Never crash the server


def register_with_dashboard():
    """Register in ~/.pi/task-monitor/registry.json for /dashboard discovery."""
    try:
        TASK_STATE_DIR.mkdir(parents=True, exist_ok=True)
        registry = {}
        if TASK_REGISTRY.exists():
            try:
                registry = json.loads(TASK_REGISTRY.read_text())
            except Exception:
                registry = {}
        registry["subagent-service"] = {
            "state_file": str(TASK_STATE_FILE),
            "batch_state_file": str(TASK_STATE_FILE),
            "total": 0,
            "description": "Multi-backend subagent gateway (Claude/Codex/Gemini)",
            "registered_at": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
        }
        tmp = TASK_REGISTRY.with_suffix(".tmp")
        tmp.write_text(json.dumps(registry, indent=2))
        os.replace(tmp, TASK_REGISTRY)
    except Exception:
        pass

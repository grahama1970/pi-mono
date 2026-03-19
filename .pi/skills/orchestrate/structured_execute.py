"""Structured plan executor for /orchestrate.

Executes JSON/YAML orchestration plans explicitly by runner type:
- local: deterministic shell command
- scillm: one-shot HTTP completion
- subagent-service: iterative or review tasks through a named subagent lane

There is no markdown fallback here. If a structured task lacks the fields needed
for its runner, execution fails fast.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx
import typer
from loguru import logger

import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))
from _shared.structured_plan import load_structured_plan, validate_structured_plan  # type: ignore

app = typer.Typer(add_completion=False)

SCILLM_URL = os.environ.get("SCILLM_API_BASE", "http://localhost:4001/v1/chat/completions")
SCILLM_KEY = os.environ.get("SCILLM_PROXY_KEY", "sk-dev-proxy-123")
SKILLS_DIR = Path(os.environ.get("SKILLS_DIR", str(Path(__file__).resolve().parents[1])))
SUBAGENT_RUN = SKILLS_DIR / "subagent-service" / "run.sh"
STATE_ROOT = Path(os.environ.get("ORCHESTRATE_HOME", str(Path.home() / ".pi" / "skills" / "orchestrate")))


@dataclass
class TaskRuntime:
    task_id: str
    title: str
    lane: str
    runner: str
    backend: str
    mode: str
    prompt: str
    command: str
    cwd: Path
    status: str = "queued"
    started_at: float | None = None
    finished_at: float | None = None
    output_path: Path | None = None
    error: str = ""


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _task_prompt(task: dict[str, Any]) -> str:
    explicit = str(task.get("prompt") or "").strip()
    if explicit:
        return explicit
    impl = [str(item).strip() for item in _as_list(task.get("implementation")) if str(item).strip()]
    if not impl:
        return ""
    parts = [
        f"Task: {task.get('title', '')}",
        "",
        "Implementation:",
    ]
    parts.extend(f"- {item}" for item in impl)
    dod = task.get("definition_of_done") or {}
    if isinstance(dod, dict) and (dod.get("command") or dod.get("assertion")):
        parts.extend(
            [
                "",
                "Definition of Done:",
                f"- Command: {dod.get('command', '')}",
                f"- Assertion: {dod.get('assertion', '')}",
            ]
        )
    tests = [str(item).strip() for item in _as_list(task.get("tests")) if str(item).strip()]
    if tests:
        parts.extend(["", "Tests:"])
        parts.extend(f"- {item}" for item in tests)
    return "\n".join(parts).strip()


def _build_runtimes(plan: dict[str, Any], repo_root: Path) -> dict[str, TaskRuntime]:
    runtimes: dict[str, TaskRuntime] = {}
    for raw_task in _as_list(plan.get("tasks")):
        if not isinstance(raw_task, dict):
            continue
        task_id = str(raw_task.get("id") or "").strip()
        cwd = Path(str(raw_task.get("cwd") or repo_root))
        if not cwd.is_absolute():
            cwd = (repo_root / cwd).resolve()
        runtimes[task_id] = TaskRuntime(
            task_id=task_id,
            title=str(raw_task.get("title") or "").strip(),
            lane=str(raw_task.get("lane") or "default").strip() or "default",
            runner=str(raw_task.get("runner") or "").strip(),
            backend=str(raw_task.get("backend") or raw_task.get("model") or "").strip(),
            mode=str(raw_task.get("mode") or "").strip(),
            prompt=_task_prompt(raw_task),
            command=str(raw_task.get("command") or "").strip(),
            cwd=cwd,
        )
    return runtimes


def _dependency_graph(plan: dict[str, Any]) -> tuple[dict[str, list[str]], dict[str, int]]:
    deps: dict[str, list[str]] = {}
    indegree: dict[str, int] = {}
    task_ids = {str(task.get("id")) for task in _as_list(plan.get("tasks")) if isinstance(task, dict)}
    for task in _as_list(plan.get("tasks")):
        if not isinstance(task, dict):
            continue
        task_id = str(task.get("id"))
        raw_deps = [str(item) for item in _as_list(task.get("depends_on")) if str(item)]
        filtered = [item for item in raw_deps if item in task_ids]
        deps[task_id] = filtered
        indegree[task_id] = len(filtered)
    return deps, indegree


def _render_state(
    session_dir: Path,
    runtimes: dict[str, TaskRuntime],
    deps: dict[str, list[str]],
    failed: bool,
) -> None:
    payload = {
        "generated_at": time.time(),
        "failed": failed,
        "tasks": [
            {
                "id": task.task_id,
                "title": task.title,
                "lane": task.lane,
                "runner": task.runner,
                "backend": task.backend,
                "mode": task.mode,
                "status": task.status,
                "depends_on": deps.get(task.task_id, []),
                "output_path": str(task.output_path) if task.output_path else "",
                "error": task.error,
                "started_at": task.started_at,
                "finished_at": task.finished_at,
            }
            for task in runtimes.values()
        ],
    }
    (session_dir / "status.json").write_text(json.dumps(payload, indent=2))


def _subagent_backend_name(model: str) -> str:
    lowered = model.lower()
    if lowered.startswith(("gpt", "codex", "o3", "o4")):
        return "codex"
    if lowered.startswith(("gemini",)):
        return "gemini"
    return "claude"


def _ensure_subagent_instance(instance: str, cwd: Path) -> int:
    subprocess.run(
        [str(SUBAGENT_RUN), "start", "--name", instance, "--workspace", str(cwd)],
        check=True,
        capture_output=True,
        text=True,
    )
    container = f"embry-subagent-{instance}"
    result = subprocess.run(
        ["docker", "inspect", "--format", "{{index .Config.Labels \"embry.port\"}}", container],
        check=True,
        capture_output=True,
        text=True,
    )
    return int(result.stdout.strip())


def _run_local(task: TaskRuntime, session_dir: Path) -> str:
    result = subprocess.run(
        task.command,
        shell=True,
        cwd=task.cwd,
        capture_output=True,
        text=True,
    )
    output = (result.stdout or "") + (("\n" + result.stderr) if result.stderr else "")
    if result.returncode != 0:
        raise RuntimeError(f"Command failed ({result.returncode}): {task.command}\n{output}".strip())
    output_path = session_dir / f"{task.task_id}.stdout.txt"
    output_path.write_text(output)
    task.output_path = output_path
    return output


def _run_scillm(task: TaskRuntime, session_dir: Path) -> str:
    if not task.prompt:
        raise RuntimeError("scillm task has no prompt")
    with httpx.Client(timeout=120.0) as client:
        response = client.post(
            SCILLM_URL,
            headers={"Authorization": f"Bearer {SCILLM_KEY}"},
            json={
                "model": task.backend or "text",
                "messages": [{"role": "user", "content": task.prompt}],
                "max_tokens": 1200,
            },
        )
        response.raise_for_status()
        data = response.json()
    content = data["choices"][0]["message"]["content"]
    output_path = session_dir / f"{task.task_id}.response.txt"
    output_path.write_text(content)
    task.output_path = output_path
    return content


def _run_subagent(task: TaskRuntime, session_dir: Path) -> str:
    """Run a subagent task via SSE streaming for real-time progress.

    Uses /chat/stream instead of /chat to enable:
    - Real-time progress events written to session_dir
    - Heartbeat monitoring (detect stuck subagents)
    - Future: mid-task intervention via pause file
    """
    if not task.prompt:
        raise RuntimeError("subagent task has no prompt")
    instance = f"orchestrate-{task.lane}"
    port = _ensure_subagent_instance(instance, task.cwd)

    # Try SSE streaming first, fall back to blocking /chat
    content_chunks: list[str] = []
    events_log = session_dir / f"{task.task_id}.events.jsonl"
    request_body = {
        "prompt": task.prompt,
        "model": task.backend or _subagent_backend_name(task.backend or "codex"),
        "max_turns": 8 if task.mode == "iterative" else 3,
    }
    # Use idle-based timeout (read=120s per chunk, not total duration)
    stream_timeout = httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0)
    try:
        with httpx.Client(timeout=stream_timeout) as client:
            with client.stream("POST", f"http://localhost:{port}/chat/stream", json=request_body) as response:
                response.raise_for_status()
                with events_log.open("a") as log_f:
                    for line in response.iter_lines():
                        if not line:
                            continue
                        # SSE format: "data: {json}" or "event: type"
                        if line.startswith("data: "):
                            data_str = line[6:]
                        elif line.startswith("data:"):
                            data_str = line[5:]
                        else:
                            continue
                        log_f.write(data_str + "\n")
                        try:
                            event = json.loads(data_str)
                            event_type = event.get("type", "")
                            if event_type in ("assistant", "text"):
                                text = event.get("content", event.get("message", ""))
                                if text:
                                    content_chunks.append(text)
                            elif event_type == "result":
                                text = event.get("result", event.get("response", ""))
                                if text:
                                    content_chunks.append(text)
                        except json.JSONDecodeError:
                            content_chunks.append(data_str)
    except (httpx.ReadTimeout, httpx.ConnectError) as exc:
        logger.warning("SSE stream failed for task {}, falling back to /chat: {}", task.task_id, exc)
        with httpx.Client(timeout=300.0) as client:
            resp = client.post(f"http://localhost:{port}/chat", json=request_body)
            resp.raise_for_status()
            data = resp.json()
        content_chunks.append(str(data.get("response") or ""))

    content = "\n".join(content_chunks)
    output_path = session_dir / f"{task.task_id}.response.txt"
    output_path.write_text(content)
    task.output_path = output_path
    return content


def _execute_task(task: TaskRuntime, session_dir: Path) -> None:
    task.status = "running"
    task.started_at = time.time()
    try:
        if task.runner == "local":
            _run_local(task, session_dir)
        elif task.runner == "scillm":
            _run_scillm(task, session_dir)
        elif task.runner == "subagent-service":
            _run_subagent(task, session_dir)
        else:
            raise RuntimeError(f"Unsupported runner: {task.runner}")
        task.status = "completed"
    except Exception as exc:
        task.status = "failed"
        task.error = str(exc)
        raise
    finally:
        task.finished_at = time.time()


def _find_latest_session(plan_path: Path) -> Path | None:
    """Find the most recent session directory for a plan file."""
    structured_dir = STATE_ROOT / "structured"
    if not structured_dir.exists():
        return None
    plan_name = plan_path.stem
    candidates = []
    for session_dir in sorted(structured_dir.iterdir(), reverse=True):
        if not session_dir.is_dir():
            continue
        status_file = session_dir / "status.json"
        if status_file.exists():
            try:
                status = json.loads(status_file.read_text())
                # Check if any task was completed (not a fresh empty session)
                has_completed = any(t.get("status") == "completed" for t in status.get("tasks", []))
                has_failed = status.get("failed", False)
                if has_completed or has_failed:
                    candidates.append(session_dir)
            except (json.JSONDecodeError, KeyError):
                continue
    return candidates[0] if candidates else None


def _load_completed_tasks(session_dir: Path) -> set[str]:
    """Load task IDs that completed successfully in a prior session."""
    status_file = session_dir / "status.json"
    if not status_file.exists():
        return set()
    try:
        status = json.loads(status_file.read_text())
        return {t["id"] for t in status.get("tasks", []) if t.get("status") == "completed"}
    except (json.JSONDecodeError, KeyError):
        return set()


def execute_plan(path: Path, repo_root: Path, resume: bool = False) -> int:
    plan = load_structured_plan(path)
    validation = validate_structured_plan(plan)
    if not validation["valid"]:
        for issue in validation["issues"]:
            logger.error(issue)
        return 1

    # Resume: find prior session and load completed tasks
    completed_prior: set[str] = set()
    if resume:
        prior_session = _find_latest_session(path)
        if prior_session:
            completed_prior = _load_completed_tasks(prior_session)
            if completed_prior:
                logger.info("Resuming: {} tasks already completed from {}", len(completed_prior), prior_session.name)
            else:
                logger.info("No completed tasks found in prior session — starting fresh")
        else:
            logger.info("No prior session found — starting fresh")

    session_dir = STATE_ROOT / "structured" / f"session-{int(time.time())}"
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / "plan.json").write_text(json.dumps(plan, indent=2))

    runtimes = _build_runtimes(plan, repo_root)
    deps, indegree = _dependency_graph(plan)
    reverse: dict[str, list[str]] = {task_id: [] for task_id in runtimes}
    for task_id, task_deps in deps.items():
        for dep in task_deps:
            reverse.setdefault(dep, []).append(task_id)

    # Pre-mark completed tasks from prior session
    for task_id in completed_prior:
        if task_id in runtimes:
            runtimes[task_id].status = "completed"
            runtimes[task_id].finished_at = 0.0  # sentinel: completed in prior session
            # Decrement indegree of children
            for child in reverse.get(task_id, []):
                indegree[child] -= 1

    max_concurrency = int((plan.get("execution") or {}).get("max_concurrency") or 1)
    ready = [
        task_id for task_id, degree in indegree.items()
        if degree == 0 and task_id not in completed_prior
    ]
    active_by_lane: dict[str, str] = {}
    pending: set[str] = set()
    failed = False

    if completed_prior:
        remaining = len(runtimes) - len(completed_prior)
        logger.info("Executing {} remaining tasks ({} skipped)", remaining, len(completed_prior))

    _render_state(session_dir, runtimes, deps, failed=False)

    with ThreadPoolExecutor(max_workers=max_concurrency) as executor:
        future_map: dict[Any, str] = {}
        while ready or future_map:
            # ── Pause check: if PAUSE file exists, wait until removed ──
            pause_file = session_dir / "PAUSE"
            if pause_file.exists() and not future_map:
                logger.warning("PAUSED — waiting for PAUSE file to be removed. "
                               "Edit the plan YAML, add SKIP_<task_id> files, then remove PAUSE to resume.")
                _render_state(session_dir, runtimes, deps, failed=False)
                while pause_file.exists():
                    time.sleep(2)
                logger.info("RESUMED — continuing execution")
                # Reload plan in case it was modified during pause
                reloaded = load_structured_plan(path)
                # Check for SKIP files
                for skip_file in session_dir.glob("SKIP_*"):
                    skip_id = skip_file.name.replace("SKIP_", "")
                    if skip_id in runtimes and runtimes[skip_id].status == "queued":
                        runtimes[skip_id].status = "skipped"
                        logger.info("Skipping task {} (SKIP file found)", skip_id)
                        for child in reverse.get(skip_id, []):
                            indegree[child] -= 1
                            if indegree[child] == 0 and child not in completed_prior:
                                ready.append(child)
                    skip_file.unlink()

            scheduled = False
            for task_id in list(ready):
                task = runtimes[task_id]
                # Skip tasks marked as skipped
                if task.status == "skipped":
                    ready.remove(task_id)
                    continue
                if task.lane in active_by_lane:
                    continue
                if len(future_map) >= max_concurrency:
                    break
                ready.remove(task_id)
                pending.add(task_id)
                active_by_lane[task.lane] = task_id
                future = executor.submit(_execute_task, task, session_dir)
                future_map[future] = task_id
                _render_state(session_dir, runtimes, deps, failed=False)
                scheduled = True

            if not future_map and not scheduled and ready:
                raise RuntimeError("No runnable tasks available; lane scheduling deadlocked")

            if not future_map:
                continue

            done, _ = wait(future_map.keys(), return_when=FIRST_COMPLETED)
            for future in done:
                task_id = future_map.pop(future)
                task = runtimes[task_id]
                pending.discard(task_id)
                active_by_lane.pop(task.lane, None)
                try:
                    future.result()
                except Exception as exc:
                    logger.error("Task {} failed: {}", task_id, exc)
                    failed = True
                    _render_state(session_dir, runtimes, deps, failed=True)
                    return 1
                for child in reverse.get(task_id, []):
                    indegree[child] -= 1
                    if indegree[child] == 0:
                        ready.append(child)
                _render_state(session_dir, runtimes, deps, failed=False)

    logger.info("Structured session written to {}", session_dir)
    return 0


@app.command()
def run(
    plan_file: Path,
    resume: bool = typer.Option(False, "--resume", help="Resume from last completed task"),
) -> None:
    """Execute a structured plan file with explicit runner dispatch."""
    repo_root = Path.cwd()
    raise typer.Exit(execute_plan(plan_file.resolve(), repo_root, resume=resume))


@app.command()
def status(plan_file: Path = typer.Argument(None)) -> None:
    """Show execution status for the most recent session."""
    structured_dir = STATE_ROOT / "structured"
    if not structured_dir.exists():
        print("No sessions found.")
        raise typer.Exit(0)

    # Find sessions
    sessions = sorted(
        [d for d in structured_dir.iterdir() if d.is_dir() and (d / "status.json").exists()],
        reverse=True,
    )
    if not sessions:
        print("No sessions found.")
        raise typer.Exit(0)

    session_dir = sessions[0]
    status_data = json.loads((session_dir / "status.json").read_text())
    tasks = status_data.get("tasks", [])

    completed = [t for t in tasks if t.get("status") == "completed"]
    failed_tasks = [t for t in tasks if t.get("status") == "failed"]
    queued = [t for t in tasks if t.get("status") == "queued"]

    print(f"Session: {session_dir.name}")
    print(f"Tasks: {len(completed)}/{len(tasks)} completed", end="")
    if failed_tasks:
        print(f", {len(failed_tasks)} FAILED", end="")
    if queued:
        print(f", {len(queued)} remaining", end="")
    print()

    if failed_tasks:
        print(f"\nFailed:")
        for t in failed_tasks:
            print(f"  Task {t['id']}: {t.get('title', '')} — {t.get('error', '')[:80]}")

    if queued:
        print(f"\nRemaining:")
        for t in queued:
            print(f"  Task {t['id']}: {t.get('title', '')}")

    if failed_tasks or queued:
        print(f"\nResume with: structured_execute.py run {plan_file or '<plan.yaml>'} --resume")


if __name__ == "__main__":
    app()

"""Structured plan executor for /orchestrate.

Executes JSON/YAML orchestration plans explicitly by runner type:
- local: deterministic shell command
- scillm: one-shot HTTP completion
- subagent-service: iterative or review tasks through a named subagent lane

Fully async — all runners use asyncio so the event loop can:
- Kill any task mid-stream via cancel events
- React to PAUSE/KILL/ABORT files within 2 seconds
- Stream SSE events from subagents without blocking

Intervention (Factory Droid pattern):
- Touch PAUSE in session dir → halts after current task OR mid-stream
- Touch KILL_<task_id> → kills that task's subprocess immediately
- Touch ABORT → kills all running tasks and stops the plan

There is no markdown fallback here. If a structured task lacks the fields needed
for its runner, execution fails fast.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import dataclass, field
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
STATE_ROOT = Path(os.environ.get("ORCHESTRATE_HOME", str(Path(__file__).resolve().parent)))
WATCHDOG_POLL_S = 2


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
    agent: str = ""
    status: str = "queued"
    started_at: float | None = None
    finished_at: float | None = None
    output_path: Path | None = None
    error: str = ""
    _subagent_port: int = 0
    _subagent_task_id: str = ""
    _cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    _proc: asyncio.subprocess.Process | None = field(default=None, repr=False)


# ---------------------------------------------------------------------------
# Helpers (pure functions, no async needed)
# ---------------------------------------------------------------------------

def _build_system_prompt(task: TaskRuntime) -> str:
    """Inject extension rules + persona context into subagent system prompt."""
    parts = [
        "You are executing a task within an Embry OS orchestration pipeline.",
        "",
        "## NON-NEGOTIABLE RULES",
        "- Query /memory recall BEFORE scanning any codebase",
        "- Use `from loguru import logger` (NEVER `import logging`)",
        "- Use `httpx` (NEVER `import requests`)",
        "- Use `typer` for CLI (NEVER `argparse`)",
        "- Max 800 lines per Python file",
        "- If an existing skill handles this, USE IT — never reimplement",
        "- All AQL must reside in the memory project only",
        "- Run tests before claiming done",
    ]
    if task.agent:
        agents_md = SKILLS_DIR.parent / "agents" / task.agent / "AGENTS.md"
        if agents_md.exists():
            lines = agents_md.read_text().splitlines()[:50]
            parts.extend(["", f"## Persona: {task.agent}", ""])
            parts.extend(lines)
    return "\n".join(parts)


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _task_prompt(task: dict[str, Any]) -> str:
    explicit = str(task.get("prompt") or "").strip()
    if explicit:
        return explicit
    impl = [str(item).strip() for item in _as_list(task.get("implementation")) if str(item).strip()]
    if not impl:
        return ""
    parts = [f"Task: {task.get('title', '')}", "", "Implementation:"]
    parts.extend(f"- {item}" for item in impl)
    dod = task.get("definition_of_done") or {}
    if isinstance(dod, dict) and (dod.get("command") or dod.get("assertion")):
        parts.extend(["", "Definition of Done:",
                       f"- Command: {dod.get('command', '')}",
                       f"- Assertion: {dod.get('assertion', '')}"])
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
            agent=str(raw_task.get("agent") or "").strip(),
        )
    return runtimes


def _dependency_graph(plan: dict[str, Any]) -> tuple[dict[str, list[str]], dict[str, int]]:
    deps: dict[str, list[str]] = {}
    indegree: dict[str, int] = {}
    task_ids = {str(t.get("id")) for t in _as_list(plan.get("tasks")) if isinstance(t, dict)}
    for task in _as_list(plan.get("tasks")):
        if not isinstance(task, dict):
            continue
        tid = str(task.get("id"))
        raw = [str(i) for i in _as_list(task.get("depends_on")) if str(i)]
        filtered = [i for i in raw if i in task_ids]
        deps[tid] = filtered
        indegree[tid] = len(filtered)
    return deps, indegree


def _render_state(session_dir: Path, runtimes: dict[str, TaskRuntime],
                  deps: dict[str, list[str]], failed: bool) -> None:
    payload = {
        "generated_at": time.time(), "failed": failed, "session_dir": str(session_dir),
        "tasks": [
            {"id": t.task_id, "title": t.title, "lane": t.lane, "runner": t.runner,
             "backend": t.backend, "mode": t.mode, "agent": t.agent, "status": t.status,
             "depends_on": deps.get(t.task_id, []),
             "output_path": str(t.output_path) if t.output_path else "",
             "error": t.error, "started_at": t.started_at, "finished_at": t.finished_at,
             "subagent_task_id": t._subagent_task_id or "",
             "subagent_port": t._subagent_port or 0}
            for t in runtimes.values()
        ],
    }
    (session_dir / "status.json").write_text(json.dumps(payload, indent=2))


def _subagent_backend_name(model: str) -> str:
    low = model.lower()
    if low.startswith(("gpt", "codex", "o3", "o4")):
        return "codex"
    if low.startswith(("gemini",)):
        return "gemini"
    return "claude"


# ---------------------------------------------------------------------------
# Async runners
# ---------------------------------------------------------------------------

async def _ensure_subagent_instance(instance: str, cwd: Path) -> int:
    """Start a subagent Docker container and return its port."""
    proc = await asyncio.create_subprocess_exec(
        str(SUBAGENT_RUN), "start", "--name", instance, "--workspace", str(cwd),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout_start, stderr_start = await proc.communicate()
    if proc.returncode != 0:
        err = (stderr_start or stdout_start or b"").decode()[:300]
        raise RuntimeError(f"subagent-service start failed for {instance}: {err}")
    container = f"embry-subagent-{instance}"
    proc2 = await asyncio.create_subprocess_exec(
        "docker", "inspect", "--format", '{{index .Config.Labels "embry.port"}}', container,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc2.communicate()
    if proc2.returncode != 0:
        err = (stderr or stdout or b"").decode()[:300]
        raise RuntimeError(f"docker inspect failed for {container}: {err}")
    port_str = stdout.decode().strip()
    if not port_str.isdigit():
        raise RuntimeError(f"Invalid port from docker inspect for {container}: {port_str!r}")
    return int(port_str)


async def _cancel_subagent(port: int, subagent_task_id: str) -> bool:
    """Kill a subagent subprocess via the cancel endpoint."""
    if not port:
        return False
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            if subagent_task_id:
                resp = await client.post(f"http://localhost:{port}/tasks/{subagent_task_id}/cancel")
                return resp.status_code == 200
            # Fallback: cancel most recent running task on this port
            resp = await client.get(f"http://localhost:{port}/tasks?status=running")
            if resp.status_code == 200:
                tasks = resp.json().get("tasks", [])
                if tasks:
                    tid = tasks[-1].get("task_id", "")
                    if tid:
                        r = await client.post(f"http://localhost:{port}/tasks/{tid}/cancel")
                        return r.status_code == 200
        return False
    except Exception as exc:
        logger.warning("Cancel failed for subagent {}: {}", subagent_task_id, exc)
        return False


async def _run_local(task: TaskRuntime, session_dir: Path) -> str:
    """Run a shell command with cancel support via process kill."""
    proc = await asyncio.create_subprocess_shell(
        task.command, cwd=task.cwd,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
    )
    task._proc = proc

    # Wait for completion or cancel
    cancel_task = asyncio.create_task(_wait_for_cancel(task))
    try:
        stdout, stderr = await proc.communicate()
    finally:
        cancel_task.cancel()
        task._proc = None

    if task._cancel_event.is_set():
        raise RuntimeError(f"Task {task.task_id} cancelled by operator")

    output = (stdout.decode() if stdout else "") + (("\n" + stderr.decode()) if stderr else "")
    if proc.returncode != 0:
        raise RuntimeError(f"Command failed ({proc.returncode}): {task.command}\n{output}".strip())
    output_path = session_dir / f"{task.task_id}.stdout.txt"
    output_path.write_text(output)
    task.output_path = output_path
    return output


async def _run_scillm(task: TaskRuntime, session_dir: Path) -> str:
    """One-shot LLM completion via scillm with cancel support."""
    if not task.prompt:
        raise RuntimeError("scillm task has no prompt")
    async with httpx.AsyncClient(timeout=120.0) as client:
        request_task = asyncio.create_task(client.post(
            SCILLM_URL,
            headers={"Authorization": f"Bearer {SCILLM_KEY}"},
            json={"model": task.backend or "text",
                  "messages": [{"role": "user", "content": task.prompt}],
                  "max_tokens": 1200},
        ), name=f"scillm-{task.task_id}")
        cancel_task = asyncio.create_task(task._cancel_event.wait(), name="cancel-wait")

        done, pending = await asyncio.wait(
            [request_task, cancel_task], return_when=asyncio.FIRST_COMPLETED,
        )
        for p in pending:
            p.cancel()

        if task._cancel_event.is_set():
            raise RuntimeError(f"Task {task.task_id} cancelled by operator")

        # HTTP request won the race — extract response while client is still open
        response = request_task.result()
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]

    output_path = session_dir / f"{task.task_id}.response.txt"
    output_path.write_text(content)
    task.output_path = output_path
    return content


async def _run_subagent(task: TaskRuntime, session_dir: Path) -> str:
    """Stream SSE from a subagent container with per-line cancel checks."""
    if not task.prompt:
        raise RuntimeError("subagent task has no prompt")
    instance = f"orchestrate-{task.lane}"
    port = await _ensure_subagent_instance(instance, task.cwd)
    task._subagent_port = port

    content_chunks: list[str] = []
    events_log = session_dir / f"{task.task_id}.events.jsonl"
    system_prompt = _build_system_prompt(task)
    request_body: dict[str, Any] = {
        "prompt": task.prompt,
        "model": task.backend or "sonnet",
        "max_turns": 8 if task.mode == "iterative" else 3,
        "system_prompt": system_prompt,
    }
    stream_timeout = httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=10.0)
    try:
        async with httpx.AsyncClient(timeout=stream_timeout) as client:
            async with client.stream("POST", f"http://localhost:{port}/chat/stream",
                                     json=request_body) as response:
                response.raise_for_status()
                # Batch writes to avoid blocking the event loop per-line
                log_buffer: list[str] = []
                sse_event_type = ""
                async for line in response.aiter_lines():
                    # Check cancel on every line — sub-second response
                    if task._cancel_event.is_set():
                        await _cancel_subagent(port, task._subagent_task_id)
                        raise RuntimeError(f"Task {task.task_id} cancelled by operator")

                    if not line:
                        sse_event_type = ""
                        continue
                    if line.startswith("event: "):
                        sse_event_type = line[7:].strip()
                        continue
                    if line.startswith("event:"):
                        sse_event_type = line[6:].strip()
                        continue
                    if line.startswith("data: "):
                        data_str = line[6:]
                    elif line.startswith("data:"):
                        data_str = line[5:]
                    else:
                        continue
                    log_buffer.append(data_str)

                    try:
                        event = json.loads(data_str)
                        event_type = sse_event_type or event.get("type", "")
                        if event_type == "meta":
                            task._subagent_task_id = event.get("task_id", "")
                        elif event_type in ("assistant", "text"):
                            text = event.get("content", event.get("message", ""))
                            if text:
                                content_chunks.append(str(text) if not isinstance(text, str) else text)
                        elif event_type == "result":
                            text = event.get("result", event.get("response", ""))
                            if text:
                                content_chunks.append(str(text) if not isinstance(text, str) else text)
                        elif event_type == "done" and event.get("cancelled"):
                            raise RuntimeError(f"Task {task.task_id} cancelled by operator")
                    except json.JSONDecodeError:
                        content_chunks.append(data_str)
                # Flush log buffer to disk off the hot path (single write)
                if log_buffer:
                    await asyncio.to_thread(
                        events_log.write_text,
                        "\n".join(log_buffer) + "\n",
                    )
    except (httpx.ReadTimeout, httpx.ConnectError) as exc:
        logger.warning("SSE failed for task {}, falling back to /chat: {}", task.task_id, exc)
        async with httpx.AsyncClient(timeout=300.0) as client:
            resp = await client.post(f"http://localhost:{port}/chat", json=request_body)
            resp.raise_for_status()
            data = resp.json()
        resp_val = data.get("response") or ""
        content_chunks.append(str(resp_val) if not isinstance(resp_val, str) else resp_val)

    content = "\n".join(content_chunks)
    output_path = session_dir / f"{task.task_id}.response.txt"
    output_path.write_text(content)
    task.output_path = output_path
    return content


async def _wait_for_cancel(task: TaskRuntime) -> None:
    """Block until cancel event is set, then kill the task's subprocess."""
    await task._cancel_event.wait()
    if task._proc and task._proc.returncode is None:
        try:
            task._proc.kill()
        except ProcessLookupError:
            pass
    if task._subagent_port:
        await _cancel_subagent(task._subagent_port, task._subagent_task_id)


async def _execute_task(task: TaskRuntime, session_dir: Path) -> None:
    task.status = "running"
    task.started_at = time.time()
    try:
        if task.runner == "local":
            await _run_local(task, session_dir)
        elif task.runner == "scillm":
            await _run_scillm(task, session_dir)
        elif task.runner == "subagent-service":
            await _run_subagent(task, session_dir)
        else:
            raise RuntimeError(f"Unsupported runner: {task.runner}")
        task.status = "completed"
    except Exception as exc:
        task.status = "failed"
        task.error = str(exc)
        raise
    finally:
        task.finished_at = time.time()


# ---------------------------------------------------------------------------
# Watchdog (async coroutine, not a thread)
# ---------------------------------------------------------------------------

async def _watchdog(session_dir: Path, runtimes: dict[str, TaskRuntime],
                    aborted: asyncio.Event, paused: asyncio.Event) -> None:
    """Poll for ABORT/KILL/PAUSE files every WATCHDOG_POLL_S seconds."""
    while True:
        try:
            # ABORT
            abort_file = session_dir / "ABORT"
            if abort_file.exists():
                logger.error("ABORT file detected — killing all running tasks")
                abort_file.unlink(missing_ok=True)
                aborted.set()
                for task in runtimes.values():
                    if task.status == "running":
                        task._cancel_event.set()
                return

            # KILL_<task_id>
            for kill_file in session_dir.glob("KILL_*"):
                kill_id = kill_file.name[5:]
                kill_file.unlink(missing_ok=True)
                task = runtimes.get(kill_id)
                if task and task.status == "running":
                    logger.warning("KILL_{} — cancelling {}: {}", kill_id, kill_id, task.title)
                    task._cancel_event.set()
                else:
                    logger.warning("KILL_{} ignored (status={})",
                                   kill_id, task.status if task else "unknown")

            # PAUSE
            pause_file = session_dir / "PAUSE"
            if pause_file.exists():
                if not paused.is_set():
                    logger.warning("PAUSE detected")
                    paused.set()
            else:
                if paused.is_set():
                    paused.clear()

        except Exception as exc:
            logger.warning("Watchdog error: {}", exc)

        await asyncio.sleep(WATCHDOG_POLL_S)


# ---------------------------------------------------------------------------
# Session resume
# ---------------------------------------------------------------------------

def _find_latest_session(plan_path: Path) -> Path | None:
    structured_dir = STATE_ROOT / "structured"
    if not structured_dir.exists():
        return None
    try:
        current_plan = load_structured_plan(plan_path)
        current_ids = {str(t.get("id")) for t in current_plan.get("tasks", []) if isinstance(t, dict)}
    except Exception:
        return None
    for session_dir in sorted(
        (d for d in structured_dir.iterdir() if d.is_dir()), reverse=True
    ):
        status_file = session_dir / "status.json"
        if not status_file.exists():
            continue
        try:
            status = json.loads(status_file.read_text())
            session_ids = {t.get("id") for t in status.get("tasks", [])}
            if not current_ids or not session_ids.issubset(current_ids):
                continue
            if any(t.get("status") == "completed" for t in status.get("tasks", [])) or status.get("failed"):
                return session_dir
        except (json.JSONDecodeError, KeyError):
            continue
    return None


def _load_completed_tasks(session_dir: Path) -> set[str]:
    status_file = session_dir / "status.json"
    if not status_file.exists():
        return set()
    try:
        status = json.loads(status_file.read_text())
        return {t["id"] for t in status.get("tasks", []) if t.get("status") == "completed"}
    except (json.JSONDecodeError, KeyError):
        return set()


# ---------------------------------------------------------------------------
# Main executor
# ---------------------------------------------------------------------------

async def _execute_plan_async(path: Path, repo_root: Path, resume: bool = False) -> int:
    plan = load_structured_plan(path)
    validation = validate_structured_plan(plan)
    if not validation["valid"]:
        for issue in validation["issues"]:
            logger.error(issue)
        return 1

    completed_prior: set[str] = set()
    if resume:
        prior = _find_latest_session(path)
        if prior:
            completed_prior = _load_completed_tasks(prior)
            if completed_prior:
                logger.info("Resuming: {} tasks completed from {}", len(completed_prior), prior.name)

    session_dir = STATE_ROOT / "structured" / f"session-{int(time.time())}"
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / "plan.json").write_text(json.dumps(plan, indent=2))

    # Machine-readable session announcement — the project agent reads this to
    # know where to write KILL/ABORT/PAUSE files for intervention.
    # Format: JSON line on stdout, parseable by pi-task.ts or any supervisor.
    print(json.dumps({"event": "session_started", "session_dir": str(session_dir),
                       "status_file": str(session_dir / "status.json"),
                       "task_count": len(plan.get("tasks", []))}))

    runtimes = _build_runtimes(plan, repo_root)
    deps, indegree = _dependency_graph(plan)
    reverse: dict[str, list[str]] = {tid: [] for tid in runtimes}
    for tid, tdeps in deps.items():
        for dep in tdeps:
            reverse.setdefault(dep, []).append(tid)

    for tid in completed_prior:
        if tid in runtimes:
            runtimes[tid].status = "completed"
            runtimes[tid].finished_at = 0.0
            for child in reverse.get(tid, []):
                indegree[child] -= 1

    max_conc = int((plan.get("execution") or {}).get("max_concurrency") or 1)
    ready = [tid for tid, deg in indegree.items() if deg == 0 and tid not in completed_prior]
    active_by_lane: dict[str, str] = {}

    if completed_prior:
        logger.info("Executing {} remaining tasks", len(runtimes) - len(completed_prior))

    # Write intervention instructions
    (session_dir / "INTERVENTION.md").write_text(
        f"# Intervention Controls\n\nSession: {session_dir.name}\n\n"
        f"| File | Effect | Latency |\n|------|--------|---------|\n"
        f"| `PAUSE` | Pause after current tasks | <{WATCHDOG_POLL_S}s |\n"
        f"| `KILL_<task_id>` | Kill specific task mid-stream | <{WATCHDOG_POLL_S}s |\n"
        f"| `ABORT` | Kill ALL, stop plan | <{WATCHDOG_POLL_S}s |\n"
        f"| `SKIP_<task_id>` | Skip queued task (on unpause) | Next pause |\n\n"
        f"## Task IDs\n\n"
        + "\n".join(f"- `{tid}`: {rt.title} ({rt.runner}/{rt.lane})" for tid, rt in runtimes.items())
        + "\n"
    )
    _render_state(session_dir, runtimes, deps, failed=False)

    # Start watchdog as an async task (not a thread)
    aborted = asyncio.Event()
    paused = asyncio.Event()
    wd_task = asyncio.create_task(_watchdog(session_dir, runtimes, aborted, paused))

    try:
        return await _execute_loop(
            path, session_dir, runtimes, deps, indegree, reverse,
            completed_prior, max_conc, ready, active_by_lane, aborted, paused,
        )
    finally:
        wd_task.cancel()
        try:
            await wd_task
        except asyncio.CancelledError:
            pass


async def _execute_loop(
    plan_path: Path, session_dir: Path,
    runtimes: dict[str, TaskRuntime], deps: dict[str, list[str]],
    indegree: dict[str, int], reverse: dict[str, list[str]],
    completed_prior: set[str], max_conc: int, ready: list[str],
    active_by_lane: dict[str, str],
    aborted: asyncio.Event, paused: asyncio.Event,
) -> int:
    task_map: dict[asyncio.Task, str] = {}

    while ready or task_map:
        # ── Abort ──
        if aborted.is_set():
            logger.error("ABORTED — stopping all execution")
            for t in task_map:
                t.cancel()
            _render_state(session_dir, runtimes, deps, failed=True)
            return 1

        # ── Pause (only when no tasks running) ──
        if paused.is_set() and not task_map:
            logger.warning("PAUSED — edit plan, add SKIP/KILL files, then remove PAUSE.")
            _render_state(session_dir, runtimes, deps, failed=False)
            while paused.is_set() and not aborted.is_set():
                await asyncio.sleep(1)
            if aborted.is_set():
                return 1
            logger.info("RESUMED")
            load_structured_plan(plan_path)
            for skip_file in session_dir.glob("SKIP_*"):
                skip_id = skip_file.name[5:]
                if skip_id in runtimes and runtimes[skip_id].status == "queued":
                    runtimes[skip_id].status = "skipped"
                    logger.info("Skipping task {}", skip_id)
                    for child in reverse.get(skip_id, []):
                        indegree[child] -= 1
                        if indegree[child] == 0 and child not in completed_prior:
                            ready.append(child)
                skip_file.unlink(missing_ok=True)

        # ── Schedule ready tasks ──
        scheduled = False
        for task_id in list(ready):
            task = runtimes[task_id]
            if task.status == "skipped":
                ready.remove(task_id)
                continue
            if task.lane in active_by_lane:
                continue
            if len(task_map) >= max_conc:
                break
            ready.remove(task_id)
            active_by_lane[task.lane] = task_id
            atask = asyncio.create_task(_execute_task(task, session_dir), name=f"task-{task_id}")
            task_map[atask] = task_id
            _render_state(session_dir, runtimes, deps, failed=False)
            scheduled = True

        if not task_map and not scheduled and ready:
            raise RuntimeError("Lane scheduling deadlocked")
        if not task_map:
            continue

        # ── Wait for any task to finish (with timeout for watchdog responsiveness) ──
        done, _ = await asyncio.wait(task_map.keys(), timeout=WATCHDOG_POLL_S,
                                     return_when=asyncio.FIRST_COMPLETED)
        if not done:
            continue

        for atask in done:
            task_id = task_map.pop(atask)
            task = runtimes[task_id]
            active_by_lane.pop(task.lane, None)
            try:
                atask.result()
            except (Exception, asyncio.CancelledError) as exc:
                if task._cancel_event.is_set():
                    logger.warning("Task {} cancelled: {}", task_id, exc)
                    task.status = "cancelled"
                    task.error = "cancelled by operator"
                else:
                    logger.error("Task {} failed: {}", task_id, exc)
                    task.status = "failed"
                    task.error = str(exc)
                    _render_state(session_dir, runtimes, deps, failed=True)
                    return 1
                task.finished_at = time.time()
            # Release children (both completed and cancelled tasks)
            for child in reverse.get(task_id, []):
                indegree[child] -= 1
                if indegree[child] == 0:
                    ready.append(child)
            _render_state(session_dir, runtimes, deps, failed=False)

    logger.info("Session written to {}", session_dir)
    return 0


def execute_plan(path: Path, repo_root: Path, resume: bool = False) -> int:
    """Sync entry point — runs the async executor."""
    return asyncio.run(_execute_plan_async(path, repo_root, resume))


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

@app.command()
def run(
    plan_file: Path,
    resume: bool = typer.Option(False, "--resume", help="Resume from last completed task"),
) -> None:
    """Execute a structured plan file with explicit runner dispatch."""
    raise typer.Exit(execute_plan(plan_file.resolve(), Path.cwd(), resume=resume))


@app.command()
def status(plan_file: Path = typer.Argument(None)) -> None:
    """Show execution status for the most recent session."""
    structured_dir = STATE_ROOT / "structured"
    if not structured_dir.exists():
        print("No sessions found.")
        raise typer.Exit(0)
    sessions = sorted(
        [d for d in structured_dir.iterdir() if d.is_dir() and (d / "status.json").exists()],
        reverse=True,
    )
    if not sessions:
        print("No sessions found.")
        raise typer.Exit(0)
    session_dir = sessions[0]
    data = json.loads((session_dir / "status.json").read_text())
    tasks = data.get("tasks", [])
    completed = [t for t in tasks if t.get("status") == "completed"]
    failed = [t for t in tasks if t.get("status") == "failed"]
    queued = [t for t in tasks if t.get("status") == "queued"]
    print(f"Session: {session_dir.name}")
    print(f"Tasks: {len(completed)}/{len(tasks)} completed", end="")
    if failed:
        print(f", {len(failed)} FAILED", end="")
    if queued:
        print(f", {len(queued)} remaining", end="")
    print()
    if failed:
        print("\nFailed:")
        for t in failed:
            print(f"  Task {t['id']}: {t.get('title', '')} — {t.get('error', '')[:80]}")
    if queued:
        print("\nRemaining:")
        for t in queued:
            print(f"  Task {t['id']}: {t.get('title', '')}")
    if failed or queued:
        print(f"\nResume: structured_execute.py run {plan_file or '<plan.yaml>'} --resume")


if __name__ == "__main__":
    app()

"""subagent-service: Dockerized FastAPI wrapper around Claude/Codex/Gemini CLIs.

⚠️  DOCKER ONLY — This file runs INSIDE a Docker container managed by run.sh.
    Do NOT run this directly with uvicorn on the host. Use: ./run.sh start

Backend is selected by model name using backends.yml registry.
Two modes:
- POST /chat       → blocking JSON response
- POST /chat/stream → SSE stream (real-time events + heartbeat)

Timeout is inactivity-based (no output for N seconds), not total duration.
"""
from __future__ import annotations

import asyncio
import fnmatch
import json
import os
import shutil
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import yaml
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from task_tracking import (
    TASKS,
    cancel_task,
    init as _init_task_tracking,
    register_proc,
    register_with_dashboard,
    task_complete,
    task_create,
    write_task_state,
)

app = FastAPI(title="subagent-service", description="Multi-backend subagent as a Service")

# Workspace directory — set via WORKSPACE_DIR env var when --workspace is used.
# If set and exists, CLI backends run with cwd=WORKSPACE_DIR so they can see/edit code.
WORKSPACE_DIR: Optional[str] = os.environ.get("WORKSPACE_DIR")
if WORKSPACE_DIR and not Path(WORKSPACE_DIR).is_dir():
    WORKSPACE_DIR = None

# Strip nested-session guard
os.environ.pop("CLAUDECODE", None)

IDLE_TIMEOUT_S = 120
HEARTBEAT_INTERVAL_S = 15
# 10 MB readline buffer — Claude CLI stream-json outputs image data as single
# JSON lines that can exceed asyncio's default 64 KB StreamReader limit.
SUBPROCESS_STREAM_LIMIT = 10 * 1024 * 1024
CLAUDE_HOME = Path.home() / ".claude"
BACKENDS_FILE = Path(__file__).parent / "backends.yml"

# Loaded at startup
BACKENDS: dict = {}
MODEL_INDEX: list[tuple[str, str]] = []  # (glob_pattern, backend_name)

# Usage accumulator — resets on container restart
USAGE_STARTED: str = datetime.now(timezone.utc).isoformat()
USAGE: dict[str, dict] = {}  # backend_name → {requests, tokens_in, tokens_out, cost_usd, errors, total_duration_ms}


def _init_usage(backend: str) -> dict:
    """Get or create usage entry for a backend."""
    if backend not in USAGE:
        USAGE[backend] = {
            "requests": 0,
            "tokens_in": 0,
            "tokens_out": 0,
            "cost_usd": 0.0,
            "errors": 0,
            "total_duration_ms": 0,
        }
    return USAGE[backend]


def _record_usage(backend: str, *, duration_ms: int = 0, cost_usd: float = 0.0,
                   tokens_in: int = 0, tokens_out: int = 0, error: bool = False):
    """Record usage for a completed request."""
    u = _init_usage(backend)
    u["requests"] += 1
    u["total_duration_ms"] += duration_ms
    u["cost_usd"] += cost_usd
    u["tokens_in"] += tokens_in
    u["tokens_out"] += tokens_out
    if error:
        u["errors"] += 1


@app.on_event("startup")
async def load_backends():
    """Load backends.yml and build model→backend index."""
    global BACKENDS, MODEL_INDEX
    if BACKENDS_FILE.exists():
        with open(BACKENDS_FILE) as f:
            data = yaml.safe_load(f)
        BACKENDS = data.get("backends", {})
    else:
        # Fallback: Claude-only
        BACKENDS = {
            "claude": {
                "cli": "claude",
                "prompt_flag": "-p",
                "output_flags": ["--output-format", "stream-json", "--verbose"],
                "max_turns_flag": "--max-turns",
                "model_flag": "--model",
                "system_prompt_flag": "--system-prompt",
                "auth_dir": ".claude",
                "env_strip": ["CLAUDECODE", "CLAUDE_CODE_SSE_PORT", "CLAUDE_CODE_ENTRYPOINT"],
                "default_model": "sonnet",
                "models": [{"pattern": "*"}],
            }
        }

    MODEL_INDEX.clear()
    for backend_name, cfg in BACKENDS.items():
        for m in cfg.get("models", []):
            MODEL_INDEX.append((m["pattern"], backend_name))

    # Register with /dashboard task-monitor
    _init_task_tracking(USAGE)
    register_with_dashboard()
    write_task_state()

    # Prepare writable dirs for Claude
    writable_dirs = [
        "session-env", "file-history", "debug", "paste-cache",
        "image-cache", "shell-snapshots", "ide", "cache",
    ]
    for d in writable_dirs:
        (CLAUDE_HOME / d).mkdir(parents=True, exist_ok=True)


def resolve_backend(model: Optional[str]) -> tuple[str, str]:
    """Resolve model name to (backend_name, model_name).

    Returns the backend name and the model to pass to the CLI.
    If model is None, defaults to claude/sonnet.
    """
    if not model:
        return "claude", BACKENDS.get("claude", {}).get("default_model", "sonnet")

    # Check if model is a backend name directly (e.g. "claude", "codex", "gemini")
    if model in BACKENDS:
        return model, BACKENDS[model].get("default_model", model)

    # Match against patterns
    for pattern, backend_name in MODEL_INDEX:
        if fnmatch.fnmatch(model.lower(), pattern.lower()):
            return backend_name, model

    # Default to claude
    return "claude", model


def _build_cmd(backend_name: str, model: str, prompt: str,
               max_turns: int = 5, system_prompt: Optional[str] = None,
               image_paths: Optional[list[Path]] = None) -> list[str]:
    """Build the CLI command for the given backend."""
    cfg = BACKENDS[backend_name]
    cli = cfg["cli"]
    subcommand = cfg.get("subcommand")

    # Inject image file references into prompt text for all backends
    effective_prompt = inject_image_refs(prompt, image_paths or [])

    cmd = [cli]
    if subcommand:
        cmd.append(subcommand)

    # Prompt
    prompt_flag = cfg.get("prompt_flag")
    if prompt_flag:
        cmd.extend([prompt_flag, effective_prompt])
    else:
        # Positional (codex exec "prompt")
        cmd.append(effective_prompt)

    # Output flags (Claude needs stream-json)
    for flag in cfg.get("output_flags", []):
        cmd.append(flag)

    # Model
    model_flag = cfg.get("model_flag")
    if model_flag and model:
        cmd.extend([model_flag, model])

    # Max turns
    max_turns_flag = cfg.get("max_turns_flag")
    if max_turns_flag:
        cmd.extend([max_turns_flag, str(max_turns)])

    # System prompt
    sp_flag = cfg.get("system_prompt_flag")
    if sp_flag and system_prompt:
        cmd.extend([sp_flag, system_prompt])

    # Backend-specific image flags (e.g. gemini -f file.png)
    cmd.extend(build_image_flags(cfg.get("image_flag"), image_paths or []))

    return cmd


def _clean_env(backend_name: str) -> dict:
    """Return env dict with credential blocklist and backend-specific strips.

    Blocks known-dangerous credential env vars (AWS, API keys, SSH) to prevent
    leaks to subprocess. Preserves EMBEDDING_SERVICE_URL and MEMORY_ARANGO_URL.
    """
    # Block known credential/auth env vars from leaking to subprocesses
    blocklist = {
        "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
        "GH_TOKEN", "GITHUB_TOKEN", "SSH_AUTH_SOCK", "NPM_TOKEN",
        "DOCKER_AUTH", "DOCKER_CONFIG",
        "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY",
        "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID",
    }
    env = {k: v for k, v in os.environ.items() if k not in blocklist}
    cfg = BACKENDS.get(backend_name, {})
    for var in cfg.get("env_strip", []):
        env.pop(var, None)
    # Ensure memory/embedding URLs are always available to subprocesses
    for key in ("EMBEDDING_SERVICE_URL", "MEMORY_ARANGO_URL"):
        if key in os.environ:
            env[key] = os.environ[key]
    return env


from image_io import (
    ImageInput,
    OutputImage,
    build_image_flags,
    collect_output_images,
    inject_image_refs,
    write_input_images,
)
from parse_output import extract_usage_from_events, parse_tokens_from_stderr


class ChatRequest(BaseModel):
    prompt: str
    model: Optional[str] = Field(None, description="Model name — routes to backend automatically")
    max_turns: int = Field(5, ge=1, le=50)
    system_prompt: Optional[str] = None
    idle_timeout: int = Field(IDLE_TIMEOUT_S, ge=10, le=600)
    images: Optional[list[ImageInput]] = Field(None, description="Images to pass to the subagent for vision review (base64)")
    image_paths: Optional[list[str]] = Field(None, description="Container-local file paths to images (use instead of base64 for large images)")
    output_dir: Optional[str] = Field(None, description="Directory inside container to scan for output images")


class ChatResponse(BaseModel):
    response: str
    model: Optional[str] = None
    backend: Optional[str] = None
    exit_code: int
    duration_ms: int
    num_events: int = 0
    cost_usd: Optional[float] = None
    tokens_in: Optional[int] = None
    tokens_out: Optional[int] = None
    images: Optional[list[OutputImage]] = Field(None, description="Images produced by the subagent")



@app.get("/health")
async def health():
    """Health check — reports all backend CLI versions."""
    versions = {}
    for name, cfg in BACKENDS.items():
        try:
            proc = subprocess.run(
                [cfg["cli"], "--version"],
                capture_output=True, text=True, timeout=10,
            )
            versions[name] = proc.stdout.strip() if proc.returncode == 0 else "unknown"
        except Exception:
            versions[name] = "unavailable"
    return {"status": "ok", "backends": versions}


@app.get("/usage")
async def usage():
    """Return accumulated usage stats per backend since container start."""
    totals = {"requests": 0, "tokens_in": 0, "tokens_out": 0,
              "cost_usd": 0.0, "errors": 0, "total_duration_ms": 0}
    for stats in USAGE.values():
        for k in totals:
            totals[k] += stats.get(k, 0)
    return {
        "since": USAGE_STARTED,
        "totals": totals,
        "by_backend": {k: dict(v) for k, v in USAGE.items()},
    }


@app.delete("/usage")
async def reset_usage():
    """Reset accumulated usage counters."""
    global USAGE_STARTED
    USAGE.clear()
    USAGE_STARTED = datetime.now(timezone.utc).isoformat()
    return {"status": "reset"}


@app.get("/backends")
async def list_backends():
    """List available backends with their models from backends.yml."""
    result = {}
    for name, cfg in BACKENDS.items():
        result[name] = {
            "cli": cfg["cli"],
            "default_model": cfg.get("default_model"),
            "models": [m.get("example", m["pattern"]) for m in cfg.get("models", [])],
        }
    return result


@app.get("/models")
async def list_models():
    """Query live model lists from each backend's API using stored OAuth credentials."""
    from model_discovery import discover_all_models

    codex_home = Path.home() / ".codex"
    gemini_home = Path.home() / ".gemini"
    return await discover_all_models(
        BACKENDS, CLAUDE_HOME,
        codex_home if codex_home.is_dir() else None,
        gemini_home if gemini_home.is_dir() else None,
    )


@app.get("/tasks")
async def list_tasks(status: Optional[str] = None):
    """List tracked tasks in task-monitor compatible format.

    Pollable by /dashboard at http://localhost:8620/tasks.
    Optional ?status=running|completed|error filter.
    """
    tasks = list(TASKS.values())
    if status:
        tasks = [t for t in tasks if t.get("status") == status]
    # Update elapsed_seconds for running tasks
    now = time.time()
    for t in tasks:
        if t["status"] == "running":
            t["elapsed_seconds"] = round(now - t["start_time"], 1)
    running = sum(1 for t in TASKS.values() if t["status"] == "running")
    completed = sum(1 for t in TASKS.values() if t["status"] == "completed")
    errored = sum(1 for t in TASKS.values() if t["status"] == "error")
    return {
        "skill": "subagent-service",
        "summary": {"running": running, "completed": completed, "errors": errored},
        "tasks": tasks,
    }


@app.get("/tasks/{task_id}")
async def get_task(task_id: str):
    """Get a single task by ID."""
    if task_id not in TASKS:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    t = TASKS[task_id]
    if t["status"] == "running":
        t["elapsed_seconds"] = round(time.time() - t["start_time"], 1)
    return t


@app.post("/tasks/{task_id}/cancel")
async def cancel_task_endpoint(task_id: str):
    """Kill the subprocess for a running task.

    Used by the orchestrator's watchdog thread when a human touches KILL_<task_id>
    or the project agent decides the subagent has gone off the rails.
    """
    if task_id not in TASKS:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    t = TASKS[task_id]
    if t["status"] != "running":
        raise HTTPException(status_code=409, detail=f"Task {task_id} is {t['status']}, not running")
    killed = cancel_task(task_id)
    if not killed:
        raise HTTPException(status_code=410, detail=f"Task {task_id} process already gone")
    duration_ms = int((time.time() - t["start_time"]) * 1000)
    task_complete(task_id, exit_code=-9, duration_ms=duration_ms, error="cancelled by operator")
    return {"status": "cancelled", "task_id": task_id, "duration_ms": duration_ms}


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """Send a prompt to a subagent and wait for the complete response."""
    backend_name, model = resolve_backend(req.model)
    cfg = BACKENDS.get(backend_name)
    if not cfg:
        raise HTTPException(status_code=400, detail=f"Unknown backend: {backend_name}")

    # --- Image input: file paths (preferred for large images) or base64 ---
    img_tmpdir = None
    image_paths: list[Path] = []
    if req.image_paths:
        image_paths = [Path(p) for p in req.image_paths if Path(p).is_file()]
    elif req.images:
        img_tmpdir = Path(tempfile.mkdtemp(prefix="subagent_img_"))
        image_paths = write_input_images(req.images, img_tmpdir)

    # --- Output dir for collecting generated images ---
    # Always available so agents can write images back even without input images
    out_tmpdir = None
    if req.output_dir:
        output_dir = Path(req.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
    else:
        out_tmpdir = Path(tempfile.mkdtemp(prefix="subagent_out_"))
        output_dir = out_tmpdir

    task_id = task_create(backend_name, model, req.prompt)
    cmd = _build_cmd(backend_name, model, req.prompt, req.max_turns,
                     req.system_prompt, image_paths=image_paths or None)
    t0 = time.monotonic()

    env = _clean_env(backend_name)
    if output_dir:
        env["SUBAGENT_OUTPUT_DIR"] = str(output_dir)

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        cwd=WORKSPACE_DIR,
        limit=SUBPROCESS_STREAM_LIMIT,
    )
    register_proc(task_id, proc)

    try:
        result_text, num_events, events, stderr_text = await _collect_with_idle_timeout(
            proc, req.idle_timeout, backend_name,
        )
    except TimeoutError:
        proc.kill()
        await proc.wait()
        duration_ms = int((time.monotonic() - t0) * 1000)
        task_complete(task_id, exit_code=1, duration_ms=duration_ms,
                       error=f"idle for {req.idle_timeout}s")
        _cleanup_image_dirs(img_tmpdir, out_tmpdir)
        raise HTTPException(
            status_code=504,
            detail=f"{backend_name} idle for {req.idle_timeout}s",
        )
    except Exception as e:
        proc.kill()
        await proc.wait()
        duration_ms = int((time.monotonic() - t0) * 1000)
        task_complete(task_id, exit_code=1, duration_ms=duration_ms, error=str(e))
        _cleanup_image_dirs(img_tmpdir, out_tmpdir)
        raise HTTPException(status_code=500, detail=str(e))

    duration_ms = int((time.monotonic() - t0) * 1000)
    exit_code = proc.returncode or 0

    # Guard: cancel endpoint may have already finalized this task
    already_done = task_id not in TASKS or TASKS[task_id].get("status") != "running"

    if exit_code != 0 and not result_text and not already_done:
        task_complete(task_id, exit_code=exit_code, duration_ms=duration_ms,
                       error=f"exited {exit_code}: {stderr_text[:200]}")
        _cleanup_image_dirs(img_tmpdir, out_tmpdir)
        raise HTTPException(
            status_code=502,
            detail=f"{backend_name} exited {exit_code}: {stderr_text[:500]}",
        )

    # --- Collect output images ---
    output_images = collect_output_images(output_dir) if output_dir else None

    cost_usd, tokens_in, tokens_out = extract_usage_from_events(events)

    # Try stderr for token info from codex/gemini if no structured events
    if not tokens_in and stderr_text:
        t_in, t_out = parse_tokens_from_stderr(stderr_text)
        tokens_in = t_in or tokens_in
        tokens_out = t_out or tokens_out

    _record_usage(backend_name, duration_ms=duration_ms,
                  cost_usd=cost_usd or 0.0,
                  tokens_in=tokens_in or 0, tokens_out=tokens_out or 0,
                  error=exit_code != 0)
    if not already_done:
        task_complete(task_id, exit_code=exit_code, duration_ms=duration_ms,
                       cost_usd=cost_usd or 0.0,
                       tokens_in=tokens_in or 0, tokens_out=tokens_out or 0)

    _cleanup_image_dirs(img_tmpdir, out_tmpdir)

    return ChatResponse(
        response=result_text,
        model=model,
        backend=backend_name,
        exit_code=exit_code,
        duration_ms=duration_ms,
        num_events=num_events,
        cost_usd=cost_usd,
        tokens_in=tokens_in,
        tokens_out=tokens_out,
        images=output_images or None,
    )


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    """Stream subagent response as Server-Sent Events."""
    backend_name, model = resolve_backend(req.model)
    cfg = BACKENDS.get(backend_name)
    if not cfg:
        raise HTTPException(status_code=400, detail=f"Unknown backend: {backend_name}")

    # --- Image input: file paths (preferred for large images) or base64 ---
    img_tmpdir = None
    image_paths: list[Path] = []
    if req.image_paths:
        image_paths = [Path(p) for p in req.image_paths if Path(p).is_file()]
    elif req.images:
        img_tmpdir = Path(tempfile.mkdtemp(prefix="subagent_img_"))
        image_paths = write_input_images(req.images, img_tmpdir)

    # --- Output dir for collecting generated images ---
    out_tmpdir = None
    if req.output_dir:
        output_dir = Path(req.output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
    else:
        out_tmpdir = Path(tempfile.mkdtemp(prefix="subagent_out_"))
        output_dir = out_tmpdir

    task_id = task_create(backend_name, model, req.prompt)
    cmd = _build_cmd(backend_name, model, req.prompt, req.max_turns,
                     req.system_prompt, image_paths=image_paths or None)

    env = _clean_env(backend_name)
    if output_dir:
        env["SUBAGENT_OUTPUT_DIR"] = str(output_dir)

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        cwd=WORKSPACE_DIR,
        limit=SUBPROCESS_STREAM_LIMIT,
    )
    register_proc(task_id, proc)

    async def event_generator():
        t0 = time.monotonic()
        last_event_time = time.monotonic()
        num_events = 0

        # Announce backend + task_id so the caller can cancel
        yield _sse("meta", {"backend": backend_name, "model": model, "task_id": task_id})

        try:
            while True:
                try:
                    line = await asyncio.wait_for(
                        proc.stdout.readline(),
                        timeout=HEARTBEAT_INTERVAL_S,
                    )
                except asyncio.TimeoutError:
                    idle_s = time.monotonic() - last_event_time
                    if idle_s > req.idle_timeout:
                        yield _sse("error", {
                            "message": f"Idle timeout ({req.idle_timeout}s)",
                            "backend": backend_name,
                        })
                        proc.kill()
                        await proc.wait()
                        break
                    yield _sse("heartbeat", {
                        "elapsed_ms": int((time.monotonic() - t0) * 1000),
                        "events_so_far": num_events,
                        "idle_seconds": int(idle_s),
                    })
                    continue

                if not line:
                    break

                last_event_time = time.monotonic()
                line_str = line.decode().strip()
                if not line_str:
                    continue

                try:
                    event = json.loads(line_str)
                    num_events += 1
                    event_type = event.get("type", "unknown")
                    yield _sse(event_type, event)
                except json.JSONDecodeError:
                    # Non-JSON output (codex/gemini plain text)
                    num_events += 1
                    yield _sse("text", {"content": line_str, "backend": backend_name})

        except Exception as e:
            yield _sse("error", {"message": str(e)})

        await proc.wait()
        duration_ms = int((time.monotonic() - t0) * 1000)
        exit_code = proc.returncode or 0
        was_cancelled = exit_code == -9

        # --- Collect and emit output images before done ---
        if output_dir:
            output_images = collect_output_images(output_dir)
            if output_images:
                yield _sse("images", {
                    "images": [img.model_dump() for img in output_images],
                    "count": len(output_images),
                })

        yield _sse("done", {
            "exit_code": exit_code,
            "duration_ms": duration_ms,
            "num_events": num_events,
            "backend": backend_name,
            "cancelled": was_cancelled,
        })

        # Record usage and finalize task (skip if cancel endpoint already finalized)
        _record_usage(backend_name, duration_ms=duration_ms, error=exit_code != 0)
        if task_id in TASKS and TASKS[task_id].get("status") == "running":
            task_complete(task_id, exit_code=exit_code, duration_ms=duration_ms,
                           error="cancelled by operator" if was_cancelled else "")

        # --- Cleanup temp dirs after all events emitted ---
        _cleanup_image_dirs(img_tmpdir, out_tmpdir)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _collect_with_idle_timeout(
    proc: asyncio.subprocess.Process,
    idle_timeout: int,
    backend_name: str,
) -> tuple[str, int, list[dict], str]:
    """Read output from proc, enforcing idle timeout.

    For Claude (stream-json): parses JSON events.
    For Codex/Gemini: collects plain text lines.

    Returns: (result_text, num_events, events, stderr_text)
    Stderr is read with 2s timeout after process completes.
    """
    events: list[dict] = []
    text_lines: list[str] = []
    result_text = ""
    num_events = 0
    is_stream_json = backend_name == "claude"

    while True:
        try:
            line = await asyncio.wait_for(
                proc.stdout.readline(),
                timeout=float(idle_timeout),
            )
        except asyncio.TimeoutError:
            raise TimeoutError(f"No output for {idle_timeout}s")

        if not line:
            break

        line_str = line.decode().strip()
        if not line_str:
            continue

        num_events += 1

        if is_stream_json:
            try:
                event = json.loads(line_str)
                events.append(event)
                if event.get("type") == "result":
                    result_text = event.get("result", result_text)
                elif event.get("type") == "assistant" and not result_text:
                    content = event.get("message", {}).get("content", [])
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "text":
                            result_text = block.get("text", "")
            except json.JSONDecodeError:
                text_lines.append(line_str)
        else:
            text_lines.append(line_str)

    await proc.wait()

    # Read stderr after process completes (with timeout to prevent hangs)
    stderr_text = ""
    if proc.stderr:
        try:
            stderr_text = (await asyncio.wait_for(proc.stderr.read(), timeout=2.0)).decode()
        except asyncio.TimeoutError:
            stderr_text = "(stderr read timeout)"

    if not result_text:
        if text_lines:
            result_text = "\n".join(text_lines)
        else:
            result_text = _extract_text_so_far(events)

    return result_text, num_events, events, stderr_text


def _extract_text_so_far(events: list[dict]) -> str:
    """Best-effort text extraction from collected stream events."""
    texts = []
    for ev in events:
        if ev.get("type") == "assistant":
            for block in ev.get("message", {}).get("content", []):
                if isinstance(block, dict) and block.get("type") == "text":
                    texts.append(block.get("text", ""))
        elif ev.get("type") == "result":
            return ev.get("result", "")
    return "\n".join(texts)


def _cleanup_image_dirs(*dirs: Optional[Path]) -> None:
    """Remove temp image directories if they exist."""
    for d in dirs:
        if d and d.is_dir():
            shutil.rmtree(d, ignore_errors=True)


def _sse(event_type: str, data: dict) -> str:
    """Format a Server-Sent Event."""
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"

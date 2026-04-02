"""FastAPI wrapper around Claude Code CLI (claude -p).

Two modes:
- POST /chat       → blocking JSON response (waits for completion)
- POST /chat/stream → SSE stream (real-time token events + heartbeat)

Both use `claude -p --output-format stream-json --verbose` under the hood.
Streaming proxies events as they arrive. Blocking collects them and
returns the final result.

Timeout is based on *inactivity* (no output for N seconds), not total
duration. A 10-minute run that's actively producing tokens is fine.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

app = FastAPI(title="create-claude", description="Claude Code as a Service")

# Ensure nested-session guard is disabled inside the container
os.environ.pop("CLAUDECODE", None)

# Inactivity timeout: kill claude if no output for this many seconds
IDLE_TIMEOUT_S = 120
# Heartbeat interval for SSE keep-alive
HEARTBEAT_INTERVAL_S = 15

# Claude home — writable copy prepared at startup
CLAUDE_HOME = Path.home() / ".claude"


@app.on_event("startup")
async def prepare_claude_home():
    """Make .claude writable if mounted read-only.

    The host mounts ~/.claude as read-only for security. But Claude Code
    needs to write session-env/, file-history/, etc. We create writable
    directories for those while keeping credentials from the mount.
    """
    writable_dirs = [
        "session-env", "file-history", "debug", "paste-cache",
        "image-cache", "shell-snapshots", "ide", "cache",
    ]
    for d in writable_dirs:
        (CLAUDE_HOME / d).mkdir(parents=True, exist_ok=True)


class ChatRequest(BaseModel):
    prompt: str
    model: Optional[str] = Field(None, description="Model: opus, sonnet, haiku")
    max_turns: int = Field(5, ge=1, le=50)
    system_prompt: Optional[str] = None
    idle_timeout: int = Field(
        IDLE_TIMEOUT_S,
        ge=10,
        le=600,
        description="Kill if no output for N seconds (default 120)",
    )


class ChatResponse(BaseModel):
    response: str
    model: Optional[str] = None
    exit_code: int
    duration_ms: int
    num_events: int = 0
    cost_usd: Optional[float] = None


class SkillRequest(BaseModel):
    skill: str = Field(..., description="Skill name (e.g. taxonomy)")
    args: str = Field("", description="Arguments to pass after skill name")
    model: Optional[str] = None
    max_turns: int = Field(5, ge=1, le=50)
    idle_timeout: int = Field(IDLE_TIMEOUT_S, ge=10, le=600)


def _build_cmd(req: ChatRequest) -> list[str]:
    """Build the claude CLI command."""
    cmd = [
        "claude", "-p", req.prompt,
        "--output-format", "stream-json",
        "--verbose",
    ]
    if req.model:
        cmd.extend(["--model", req.model])
    if req.max_turns:
        cmd.extend(["--max-turns", str(req.max_turns)])
    if req.system_prompt:
        cmd.extend(["--system-prompt", req.system_prompt])
    return cmd


def _clean_env() -> dict:
    """Return env dict with nested-session guards removed."""
    env = os.environ.copy()
    env.pop("CLAUDECODE", None)
    env.pop("CLAUDE_CODE_SSE_PORT", None)
    env.pop("CLAUDE_CODE_ENTRYPOINT", None)
    return env


@app.get("/health")
async def health():
    """Health check — also reports Claude CLI version."""
    try:
        proc = subprocess.run(
            ["claude", "--version"],
            capture_output=True, text=True, timeout=10,
        )
        version = proc.stdout.strip() if proc.returncode == 0 else "unknown"
    except Exception:
        version = "unavailable"
    return {"status": "ok", "claude_version": version}


@app.post("/chat", response_model=ChatResponse)
async def chat(req: ChatRequest):
    """Send a prompt to Claude and wait for the complete response.

    Uses stream-json internally for inactivity-based timeout, but
    collects all output and returns a single JSON response.
    """
    cmd = _build_cmd(req)
    t0 = time.monotonic()

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=_clean_env(),
    )

    events: list[dict] = []
    result_text = ""
    num_events = 0

    try:
        result_text, num_events, events = await _collect_with_idle_timeout(
            proc, req.idle_timeout,
        )
    except TimeoutError:
        proc.kill()
        await proc.wait()
        partial = result_text or _extract_text_so_far(events)
        raise HTTPException(
            status_code=504,
            detail=f"Claude idle for {req.idle_timeout}s. "
                   f"Partial ({num_events} events): {partial[:500]}",
        )
    except Exception as e:
        proc.kill()
        await proc.wait()
        raise HTTPException(status_code=500, detail=str(e))

    duration_ms = int((time.monotonic() - t0) * 1000)
    exit_code = proc.returncode or 0

    if exit_code != 0 and not result_text:
        stderr = ""
        if proc.stderr:
            stderr = (await proc.stderr.read()).decode()
        raise HTTPException(
            status_code=502,
            detail=f"Claude exited {exit_code}: {stderr[:500]}",
        )

    # Extract cost from result event if available
    cost_usd = None
    for ev in reversed(events):
        if ev.get("type") == "result":
            cost_usd = ev.get("total_cost_usd")
            break

    return ChatResponse(
        response=result_text,
        model=req.model,
        exit_code=exit_code,
        duration_ms=duration_ms,
        num_events=num_events,
        cost_usd=cost_usd,
    )


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest):
    """Stream Claude's response as Server-Sent Events.

    Event types:
    - system: init, hook events
    - assistant: text content from Claude
    - result: final result with cost/usage
    - heartbeat: keep-alive (every 15s of processing)
    - error: error occurred
    - done: stream complete with metadata
    """
    cmd = _build_cmd(req)

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=_clean_env(),
    )

    async def event_generator():
        t0 = time.monotonic()
        last_event_time = time.monotonic()
        num_events = 0

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
                            "idle_seconds": int(idle_s),
                        })
                        proc.kill()
                        break
                    yield _sse("heartbeat", {
                        "elapsed_ms": int((time.monotonic() - t0) * 1000),
                        "events_so_far": num_events,
                        "idle_seconds": int(idle_s),
                    })
                    continue

                if not line:
                    break  # EOF

                last_event_time = time.monotonic()
                line_str = line.decode().strip()
                if not line_str:
                    continue

                try:
                    event = json.loads(line_str)
                except json.JSONDecodeError:
                    continue

                num_events += 1
                event_type = event.get("type", "unknown")
                yield _sse(event_type, event)

        except Exception as e:
            yield _sse("error", {"message": str(e)})

        await proc.wait()
        duration_ms = int((time.monotonic() - t0) * 1000)
        yield _sse("done", {
            "exit_code": proc.returncode,
            "duration_ms": duration_ms,
            "num_events": num_events,
        })

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/skill", response_model=ChatResponse)
async def skill(req: SkillRequest):
    """Run a skill through Claude by constructing a prompt."""
    prompt = f"/{req.skill} {req.args}".strip()
    chat_req = ChatRequest(
        prompt=prompt,
        model=req.model,
        max_turns=req.max_turns,
        idle_timeout=req.idle_timeout,
    )
    return await chat(chat_req)


@app.post("/skill/stream")
async def skill_stream(req: SkillRequest):
    """Stream a skill execution as SSE."""
    prompt = f"/{req.skill} {req.args}".strip()
    chat_req = ChatRequest(
        prompt=prompt,
        model=req.model,
        max_turns=req.max_turns,
        idle_timeout=req.idle_timeout,
    )
    return await chat_stream(chat_req)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

async def _collect_with_idle_timeout(
    proc: asyncio.subprocess.Process,
    idle_timeout: int,
) -> tuple[str, int, list[dict]]:
    """Read stream-json lines from proc, enforcing idle timeout.

    Returns (final_text, event_count, all_events).
    """
    events: list[dict] = []
    result_text = ""
    num_events = 0

    while True:
        try:
            line = await asyncio.wait_for(
                proc.stdout.readline(),
                timeout=float(idle_timeout),
            )
        except asyncio.TimeoutError:
            raise TimeoutError(f"No output for {idle_timeout}s")

        if not line:
            break  # EOF

        line_str = line.decode().strip()
        if not line_str:
            continue

        try:
            event = json.loads(line_str)
        except json.JSONDecodeError:
            continue

        num_events += 1
        events.append(event)

        # Extract final text from result event
        if event.get("type") == "result":
            result_text = event.get("result", result_text)
        elif event.get("type") == "assistant" and not result_text:
            content = event.get("message", {}).get("content", [])
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    result_text = block.get("text", "")

    await proc.wait()
    if not result_text:
        result_text = _extract_text_so_far(events)

    return result_text, num_events, events


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


def _sse(event_type: str, data: dict) -> str:
    """Format a Server-Sent Event."""
    return f"event: {event_type}\ndata: {json.dumps(data)}\n\n"

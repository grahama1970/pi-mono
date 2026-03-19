---
name: subagent-service
description: >
  Dockerized multi-backend agent service (FastAPI). Supports Claude, Codex, and
  Gemini backends — selected by model name. Mounts host credentials, all skills
  (225+), persona agents, and connects to host memory/embedding services.
  Solves the nested session problem (claude -p blocked by CLAUDECODE=1).
  REQUIRES DOCKER — this is NOT a local Python service.
triggers:
  - subagent service
  - subagent
  - agent service
  - claude container
  - codex container
  - gemini container
  - agent endpoint
  - agent api
  - spawn agent
  - spawn claude
  - docker agent
  - first class agent
  - composable agent
allowed-tools:
  - Bash
  - Docker
metadata:
  short-description: Dockerized multi-backend agent service (Claude/Codex/Gemini via FastAPI)
provides:
  - subagent-endpoint
  - claude-endpoint
  - codex-endpoint
  - gemini-endpoint
composes:
  - memory
  - embedding
  - task-monitor
read_before_use:
  - server.py
  - backends.yml
  - run.sh
taxonomy:
  - infrastructure
  - create
---

# subagent-service

> **DOCKER ONLY** — This skill runs a FastAPI server inside a Docker container.
> It is NOT a local Python service. Do not attempt to run `server.py` directly
> with uvicorn — use `./run.sh start` which builds and launches the Docker image.

Multi-backend agent service running Claude, Codex, or Gemini behind a unified
FastAPI server in Docker. Backend is selected by model name. Has full access
to all skills, persona agents, and the federated memory system.

## Why

- `claude -p` cannot be called inside an existing Claude Code session (`CLAUDECODE=1` blocks it).
- The project agent needs programmatic access to multiple LLM backends.
- Docker provides clean isolation — no env var conflicts, no nested session crashes.
- Host network mode connects to ArangoDB memory and embedding services.

## Usage

```bash
# Start default instance
./run.sh start

# Start named instances (auto-allocates ports from 8620-8629)
./run.sh start --name reviewer
./run.sh start --name coder --port 8625

# List all instances with health status
./run.sh list

# Stop specific instance / all instances
./run.sh stop reviewer
./run.sh stop --all

# Start without memory/embedding services
./run.sh start --no-memory

# Start bare (no skills, no memory)
./run.sh start --no-skills --no-memory

# Start with workspace (agent can see/edit local code)
./run.sh start --workspace ~/workspace/experiments/pi-mono

# Check status of an instance
./run.sh status reviewer

# Quick test
./run.sh test

# Usage/cost stats
./run.sh usage

# Send prompt to a named instance
./run.sh claude "Review this code" --name reviewer
```

## Multi-Instance

Up to 10 concurrent instances on ports 8620-8629. Each gets a unique name
and Docker labels for discovery. Port allocation skips ports already bound
on the host.

```
./run.sh start                           # "default" on 8620
./run.sh start --name reviewer           # "reviewer" on next free port
./run.sh start --name coder --port 8625  # "coder" on explicit port
./run.sh list                            # tabular status with health
./run.sh stop reviewer                   # stop one
./run.sh stop --all                      # cleanup everything
```

Docker manages lifecycle (`--restart unless-stopped`). No nohup/tmux needed.

## Model → Backend Routing

| Model Pattern | Backend | CLI Command |
|--------------|---------|-------------|
| `opus*`, `sonnet*`, `haiku*`, `claude-*` | Claude | `claude -p` |
| `gpt-*`, `codex*`, `o3*`, `o4*` | Codex | `codex exec` |
| `gemini-*`, `gemini*` | Gemini | `gemini -p` |

If no model is specified, defaults to Claude (sonnet).

## API

> **NOT OpenAI-compatible.** This is NOT a `/v1/chat/completions` endpoint.
> The field is `prompt` (a string), NOT `messages` (an array).
> Do NOT send `{"messages": [{"role": "user", "content": "..."}]}` — it will fail.

### POST /chat (blocking)

```bash
curl -X POST http://localhost:8620/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is 2+2?", "model": "sonnet"}'

# Use Codex
curl -X POST http://localhost:8620/chat \
  -d '{"prompt": "Review this code", "model": "gpt-5.3-codex"}'

# Use Gemini
curl -X POST http://localhost:8620/chat \
  -d '{"prompt": "Explain this paper", "model": "gemini-2.5-pro"}'
```

Response:
```json
{
  "response": "2+2 = 4",
  "model": "sonnet",
  "backend": "claude",
  "exit_code": 0,
  "duration_ms": 1234,
  "num_events": 3,
  "cost_usd": 0.07,
  "tokens_in": 42,
  "tokens_out": 12
}
```

### Image I/O (Vision + Output)

Send base64-encoded images for vision review. Get images back from agents.

```bash
# Send a screenshot for Gemini vision review
curl -X POST http://localhost:8620/chat \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Review this UI screenshot for accessibility issues",
    "model": "gemini-2.5-pro",
    "images": [
      {"data": "<base64>", "media_type": "image/png", "filename": "screenshot.png"}
    ]
  }'
```

Response includes output images when the agent produces them:
```json
{
  "response": "Found 3 accessibility issues...",
  "images": [
    {"data": "<base64>", "media_type": "image/png", "filename": "annotated.png"}
  ]
}
```

How it works:
- **Input**: Base64 images are decoded to temp files. File paths are injected into
  the prompt text as `[Image: /path/to/file.png]`. All backends (Claude, Codex, Gemini)
  read files via their built-in file tools — no backend-specific flags needed.
- **Output**: Agent writes images to `$SUBAGENT_OUTPUT_DIR` (auto-created). After
  completion, all images in that dir are collected and base64-encoded in the response.
- **Cleanup**: Temp dirs are removed after each request.

### POST /chat/stream (SSE)

Real-time streaming via Server-Sent Events. Heartbeats every 15s.

```bash
curl -N -X POST http://localhost:8620/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Explain monads", "model": "opus-4.6"}'
```

### GET /health

Returns `{"status": "ok", "backends": {"claude": "2.1.71", "codex": "0.107.0", "gemini": "0.31.0"}}`.

### GET /backends

Lists available backends with their CLI versions and model patterns.

### GET /usage

Returns accumulated cost/token/request stats per backend since container start.

```json
{
  "since": "2026-03-08T12:00:00Z",
  "totals": {"requests": 5, "tokens_in": 120, "tokens_out": 340, "cost_usd": 0.42},
  "by_backend": {"claude": {...}, "codex": {...}}
}
```

### DELETE /usage

Reset accumulated usage counters.

### GET /tasks

Lists all tracked subagent tasks in task-monitor compatible format. Pollable
by `/dashboard` at `http://localhost:8620/tasks`.

```bash
# All tasks
curl http://localhost:8620/tasks

# Only running tasks
curl http://localhost:8620/tasks?status=running
```

Response:
```json
{
  "skill": "subagent-service",
  "summary": {"running": 1, "completed": 3, "errors": 0},
  "tasks": [
    {
      "task_id": "a1b2c3d4",
      "skill": "subagent-service",
      "backend": "claude",
      "model": "sonnet",
      "prompt_preview": "Explain monads...",
      "status": "running",
      "elapsed_seconds": 12.3,
      "progress_pct": 0.0
    }
  ]
}
```

### GET /tasks/{task_id}

Get a single task by ID.

## Timeout Strategy

Inactivity-based: if no output for `idle_timeout` seconds (default 120,
configurable 10-600), the process is killed and a 504 with partial results
is returned. A long-running active process is fine.

```json
{"prompt": "...", "idle_timeout": 300}
```

## Workspace Access

Use `--workspace PATH` to mount a host directory into the container so the
agent can see and edit local code. The directory is mounted read-write at
`/home/node/workspace` and all CLI backends run with `cwd` set to it.

```bash
# Agent can read/write files in the mounted project
./run.sh start --workspace /home/graham/workspace/experiments/pi-mono
./run.sh claude "List the Python files in the current directory"

# Named instance with workspace
./run.sh start --name coder --workspace ~/my-project
```

Both host (UID 1000) and container `node` user (UID 1000) match, so file
permissions work without issues. For multiple agents writing to the same repo
concurrently, use git worktrees on the host side.

## Architecture

```
Host                            Docker Containers (--network host)
~/.claude/.credentials.json  →  embry-subagent-default  :8620
~/.codex/                    →  embry-subagent-reviewer :8622
~/.gemini/                   →  embry-subagent-coder   :8625
.pi/skills/ (226 skills)     →  (shared read-only mount)
.pi/agents/ (personas)       →  (shared read-only mount)
~/project/ (--workspace)     →  /home/node/workspace (read-write)
                                 ↕ localhost:8529     (ArangoDB /memory)
                                 ↕ localhost:8602     (embedding service)
                                 Label discovery: embry.skill=subagent-service
```

## Operational Requirements for /orchestrate

When dispatching tasks via `/orchestrate`, these settings are **required** — not optional:

### Workspace Mount (MANDATORY for code tasks)

Without `--workspace`, agents can read skills but **cannot see or edit any code**.
The container has no codebase access by default. This is the #1 cause of empty responses.

```bash
# WRONG — agent returns empty response, can't find any files
./run.sh start
./run.sh claude "Implement StatusPill.tsx"  # → empty response

# CORRECT — agent has full read-write access to project
./run.sh start --workspace /home/graham/workspace/experiments/pi-mono
./run.sh claude "Implement StatusPill.tsx"  # → writes files to disk
```

**Verify before running /orchestrate:**
```bash
docker inspect embry-subagent-default --format '{{range .Mounts}}{{.Destination}}{{"\n"}}{{end}}' | grep workspace
```

### Timeout + Max Turns (MANDATORY for multi-task plans)

Default `idle_timeout=120s` and `max_turns=5` are too low for implementation tasks.
Claude spends 60-90s reading the codebase before writing — a 120s idle timeout kills
it mid-read. A 17-task plan needs 30-50 turns.

```bash
# WRONG — hits idle timeout during codebase reading phase
./run.sh claude "Implement 17 tasks" --timeout 120

# CORRECT — enough time for reading + writing + verification
./run.sh claude "Implement 17 tasks" --timeout 600 --max-turns 50
```

### Stream Mode (RECOMMENDED for long-running tasks)

Use `--stream` for tasks > 60s. The blocking `/chat` endpoint buffers all output
until completion. The SSE `/chat/stream` endpoint provides:
- Heartbeats every 15s (proves agent is alive)
- Incremental text output (shows which task is being worked on)
- Proper idle timeout behavior (resets on each event)

```bash
./run.sh claude "Implement tasks" --timeout 600 --max-turns 50 --stream
```

### Backend Routing Convention

| Task Type | Backend | Rationale |
|-----------|---------|-----------|
| Code implementation | `claude` | Best at writing code with tool use |
| Design review | `gemini` | Strong vision, large context for mockups |
| Code review | `codex` | Deep code analysis and reasoning |

## Security

- Credentials are mounted from the host (not baked into the image).
- Container runs as non-root user.
- Host network mode — required for memory/embedding service access.
- Skills and agents mounted read-only.
- Use `--no-skills --no-memory` for isolated/lightweight mode.

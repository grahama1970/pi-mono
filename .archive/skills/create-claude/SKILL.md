---
name: create-claude
description: >
  Spawn a Dockerized Claude Code instance with a FastAPI endpoint.
  Mounts ~/.claude OAuth credentials so the container authenticates via
  the host's Claude Pro/Max subscription. Useful when the project agent
  needs to call Claude programmatically (claude -p can't run inside an
  existing Claude Code session).
triggers:
  - create claude
  - claude api
  - claude endpoint
  - claude container
  - spawn claude
  - claude service
  - claude fastapi
allowed-tools:
  - Bash
  - Docker
metadata:
  short-description: Dockerized Claude Code with FastAPI endpoint
provides:
  - claude-endpoint
composes: []
taxonomy:
  - infrastructure
  - create
---

# create-claude

Spin up a Docker container running Claude Code behind a FastAPI server.

## Why

- `claude -p` cannot be called inside an existing Claude Code session (`CLAUDECODE=1` blocks it).
- The project agent (Pi, orchestrator, other skills) needs programmatic access to Claude reasoning.
- Docker provides clean isolation — no env var conflicts, no nested session crashes.

## Usage

```bash
# Start the Claude endpoint (default port 8620)
./run.sh start

# Start on a custom port
./run.sh start --port 8625

# Stop the container
./run.sh stop

# Check status
./run.sh status

# Quick test
./run.sh test
```

## API

### POST /chat (blocking)

```bash
curl -X POST http://localhost:8620/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What is 2+2?", "model": "sonnet", "max_turns": 1}'
```

Response:
```json
{
  "response": "2+2 = 4",
  "model": "sonnet",
  "exit_code": 0,
  "duration_ms": 1234,
  "num_events": 3
}
```

### POST /chat/stream (SSE)

Real-time streaming via Server-Sent Events. The caller sees tokens as
Claude produces them, plus heartbeats every 15s to confirm it's alive.

```bash
curl -N -X POST http://localhost:8620/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Explain monads", "model": "sonnet"}'
```

Event types:
- `assistant` — partial text content
- `tool_use` — tool invocation
- `result` — final result
- `heartbeat` — keep-alive with elapsed time and event count
- `error` — error occurred (including idle timeout)
- `done` — stream complete with exit code and duration

### POST /skill, POST /skill/stream

Run a skill chain through Claude (blocking or streaming):
```bash
curl -X POST http://localhost:8620/skill \
  -H "Content-Type: application/json" \
  -d '{"skill": "taxonomy", "args": "extract --text \"fault tolerance patterns\"", "model": "sonnet"}'
```

### GET /health

Returns `{"status": "ok", "claude_version": "..."}`.

## Timeout Strategy

No fixed total timeout. Instead, **inactivity-based**: if Claude produces
no output for `idle_timeout` seconds (default 120, configurable 10-600),
the process is killed and a 504 with partial results is returned.

A 10-minute run that's actively producing tokens is fine. 2 minutes of
complete silence means something is stuck.

```json
{"prompt": "...", "idle_timeout": 300}
```

## Architecture

```
Host                          Docker Container
~/.claude/.credentials.json → /home/user/.claude/.credentials.json (read-only mount)
                              Claude Code CLI (npm -g)
                              FastAPI server on 0.0.0.0:8620
                              uvicorn + subprocess claude -p
```

## Security

- OAuth credentials are mounted **read-only**.
- Container runs as non-root user.
- No host network — only the mapped port is exposed.
- No skill directories mounted by default (Claude runs without tools).

# Task List: chutes-call — Centralized Chutes.ai LLM Gateway

**Created**: 2026-03-08
**Goal**: Single shared Docker service that centralizes ALL Chutes.ai LLM calls with global concurrency control, tenacious retries, circuit breaker, and a live dashboard.

## Context

31 skills make Chutes.ai LLM calls through scillm, each with bespoke retry logic (or none).
Chutes has a hard 5-concurrent-connection limit per account. Without centralized coordination,
multiple agents stomp on each other causing ~50% failure rate. scillm's `batch.py` has good
NDJSON streaming but mutates shared state across concurrent tasks (race condition), uses 30s
timeouts on a provider that regularly takes 60s+, and returns `reduce_concurrency` actions
that nothing implements.

This skill is a shared Docker FastAPI service on port 8630 that ALL callers route through.
It enforces the 5-slot global semaphore, handles retries with tenacity, implements a proper
circuit breaker (CLOSED/OPEN/HALF-OPEN), streams NDJSON batch results, and returns structured
request/response objects with cleaned JSON.

## Capability Overlap

- `/memory recall`: Recalled scillm paved path contract, ops-chutes throttle patterns, Chutes TEE issues
- **scillm**: Provides `parallel_acompletions_iter` (batch NDJSON), `chutes_error_hook` (error classification, fallback chain). We take the NDJSON streaming pattern and error classification, but fix shared mutable state, implement actual `reduce_concurrency`, and add proper timeouts
- **ops-chutes**: Provides `ChutesSemaphore` (fcntl.flock, 5-slot), `ChutesClient` (httpx, response validation), budget/quota gating. We take the semaphore concept but use asyncio.Semaphore (cross-coroutine, not cross-process — Docker service IS the single process)
- **subagent-service**: Docker lifecycle pattern (run.sh, Dockerfile, host network, labels). We clone its structure
- **No existing skill** provides: centralized cross-agent concurrency control, circuit breaker, dynamic semaphore resizing, structured request/response objects with JSON cleaning

## Crucial Dependencies (Sanity Scripts)

| Library | API/Method | Sanity Script | Status |
|---------|------------|---------------|--------|
| httpx | `AsyncClient.post()` | N/A (well-known) | - |
| tenacity | `@retry(wait=wait_random_exponential)` | N/A (well-known) | - |
| fastapi | `StreamingResponse` + NDJSON | N/A (well-known) | - |

> No sanity scripts needed — all dependencies are well-known, battle-tested libraries.

## Questions/Blockers

None — all requirements clear from /scillm audit, /ops-chutes audit, and /dogpile research.

## Tasks

### P0: Scaffolding (Sequential)

- [ ] **Task 1**: Create skill directory structure and SKILL.md
  - Agent: general-purpose
  - Parallel: 0
  - Dependencies: none
  - **Files**: `.pi/skills/chutes-call/SKILL.md`, `requirements.txt`, `pyproject.toml`, `backends.yml`
  - **Definition of Done**:
    - Test: `python3 -c "import yaml; d=yaml.safe_load(open('.pi/skills/chutes-call/SKILL.md').read().split('---')[1]); assert len(d.get('triggers',[])) >= 10; assert 'ops-chutes' in d.get('composes',[])"` passes
    - Test: `python3 -c "import yaml; yaml.safe_load(open('.pi/skills/chutes-call/backends.yml')); print('OK')"` passes
    - Assertion: `requirements.txt` lists: fastapi, uvicorn, httpx, tenacity, pyyaml, loguru
    - Assertion: `backends.yml` defines chutes (primary), openrouter (fallback 1), gemini-flash (fallback 2) with model patterns and API bases

### P1: Core Server (Sequential after P0)

- [ ] **Task 2**: Build `server.py` — FastAPI service with single and batch endpoints
  - Agent: general-purpose
  - Parallel: 1
  - Dependencies: Task 1
  - **Files**: `.pi/skills/chutes-call/server.py` (~500 lines max)
  - **Key Components**:
    - **Global semaphore**: `asyncio.Semaphore(5)` — enforces Chutes 5-connection limit
    - **Circuit breaker**: CLOSED/OPEN/HALF-OPEN state machine per backend (trip after 3 consecutive failures, OPEN for 60s, HALF-OPEN probes 1 request)
    - **Endpoints**:
      - `POST /chat` — single call, returns structured `ChatResponse`
      - `POST /batch` — batch calls with NDJSON streaming (`stream=true`) or JSON array (`stream=false`)
      - `GET /health` — service + backend health + circuit states
      - `GET /queue` — dashboard: active calls, queue depth, error rates, cost/min, per-caller stats
      - `GET /usage` — accumulated cost/token stats
      - `DELETE /usage` — reset counters
    - **Request model** (`ChatRequest`):
      - `messages: list[dict]` (required)
      - `model: str = "deepseek-ai/DeepSeek-V3"` (default)
      - `tenacious: bool = False` (normal: 1 retry, fast-fail | tenacious: 5 retries, backoff, fallback)
      - `timeout: int = 60` (per-attempt, escalates per retry in tenacious mode)
      - `temperature: float = 0.0`
      - `max_tokens: int = 4096`
      - `response_format: Optional[dict] = None` (for JSON mode)
      - `caller: str = "unknown"` (for dashboard tracking)
    - **Response model** (`ChatResponse`):
      - `ok: bool`
      - `content: Optional[str]` — cleaned text
      - `json_content: Optional[dict]` — parsed + cleaned JSON (if response_format was JSON)
      - `raw_content: Optional[str]` — uncleaned original
      - `model: str` — actual model used (may differ from requested if fallback)
      - `backend: str` — which backend served it (chutes/openrouter/gemini)
      - `retries: int` — how many retries were needed
      - `elapsed_s: float`
      - `tokens_in: int`, `tokens_out: int`, `cost_usd: float`
      - `error: Optional[str]` — error message if ok=false
      - `circuit_state: str` — CLOSED/OPEN/HALF-OPEN at time of response
    - **Batch response** (NDJSON): one `ChatResponse` per line + summary line
    - **JSON cleaning**: strip markdown fences, repair truncated JSON, handle BOM, normalize whitespace
    - **Per-request isolation**: each batch item gets its own model/backend/retry state (NO shared mutable nonlocal)
    - **Dynamic semaphore**: on 3+ consecutive 429s in 30s window, shrink from 5→3→1; restore gradually on success
    - **Tenacity integration**: `@retry(wait=wait_random_exponential(min=2, max=60), stop=stop_after_attempt(N), retry=retry_if_exception_type(...))` — N=2 for normal, N=5 for tenacious
    - **Timeout escalation** (tenacious mode): attempt 1=60s, attempt 2=120s, attempt 3=180s, attempt 4+=180s
    - **Fallback chain**: Chutes (primary) → OpenRouter (if OPENROUTER_API_KEY set) → Gemini Flash (if GEMINI_API_KEY set) → error
    - **Retry-After parsing**: respect `Retry-After`, `x-ratelimit-reset`, `RateLimit-Reset` headers
    - **Connection pooling**: single `httpx.AsyncClient` with `limits=httpx.Limits(max_connections=10, max_keepalive_connections=5)`, reused across requests
  - **Definition of Done**:
    - Test: `python3 -c "import ast; ast.parse(open('.pi/skills/chutes-call/server.py').read())"` passes
    - Test: `cd .pi/skills/chutes-call && python3 -c "from fastapi.testclient import TestClient; from server import app; c=TestClient(app); r=c.get('/health'); assert r.status_code==200; print('health OK')"` passes
    - Assertion: server.py < 600 lines
    - Assertion: Uses `from loguru import logger` (not logging)
    - Assertion: Uses httpx (not requests)
    - Assertion: Has module docstring describing purpose

- [ ] **Task 3**: Build `client.py` — importable Python client for callers
  - Agent: general-purpose
  - Parallel: 1
  - Dependencies: Task 1
  - **Files**: `.pi/skills/chutes-call/client.py` (~120 lines)
  - **Key Components**:
    - `ChutesCallClient` class wrapping httpx calls to localhost:8630
    - `async def chat(messages, model, tenacious, caller, **kwargs) -> ChatResponse`
    - `async def batch(requests, concurrency, tenacious, stream, caller) -> list[ChatResponse] | AsyncIterator[ChatResponse]`
    - `async def health() -> dict`
    - Sync wrappers: `chat_sync()`, `batch_sync()` for non-async callers
    - Auto-detect port from env `CHUTES_CALL_PORT` or default 8630
  - **Definition of Done**:
    - Test: `python3 -c "import ast; tree=ast.parse(open('.pi/skills/chutes-call/client.py').read()); fns=[n.name for n in ast.walk(tree) if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))]; assert 'chat' in fns or 'chat_sync' in fns; print('OK:', fns)"` passes
    - Assertion: client.py < 150 lines
    - Assertion: All methods have type hints and docstrings
    - Assertion: No retry logic in client (server handles all retries)

### P2: Docker & CLI (Parallel after P1)

- [ ] **Task 4**: Build Dockerfile and run.sh
  - Agent: general-purpose
  - Parallel: 2
  - Dependencies: Task 2
  - **Files**: `.pi/skills/chutes-call/Dockerfile`, `.pi/skills/chutes-call/run.sh`
  - **Dockerfile**: python:3.12-slim, pip install requirements.txt, non-root user, EXPOSE 8630
  - **run.sh**: Same lifecycle pattern as subagent-service (start/stop/status/health/logs/build)
    - `start` — build if needed, docker run with --network host, --restart unless-stopped, mount credentials
    - `stop` — docker rm -f
    - `status` — container inspect + health check
    - `health` — curl /health
    - `logs` — docker logs -f
    - `build` — docker build
    - `test` — start, health check, stop
    - Label: `embry.skill=chutes-call`, `embry.port=8630`
    - Env passthrough: `CHUTES_API_KEY`, `CHUTES_API_TOKEN`, `OPENROUTER_API_KEY`, `GEMINI_API_KEY`
    - NO skills mount, NO workspace mount (pure API proxy)
  - **Definition of Done**:
    - Assertion: `docker build -t chutes-call:latest .` succeeds
    - Assertion: Container starts and `/health` returns 200 within 10s
    - Assertion: Container runs as non-root

- [ ] **Task 5**: Build sanity.sh
  - Agent: general-purpose
  - Parallel: 2
  - Dependencies: Task 2
  - **Files**: `.pi/skills/chutes-call/sanity.sh`
  - **Checks**:
    - Required files exist (SKILL.md, server.py, client.py, Dockerfile, run.sh, backends.yml)
    - Python syntax valid (ast.parse)
    - YAML valid (backends.yml)
    - SKILL.md has triggers
    - Docker available
    - Chutes API key exists in env
    - httpx, tenacity, fastapi importable
  - **Definition of Done**:
    - Assertion: `bash sanity.sh` exits 0 when prerequisites met

### P3: Validation (After all implementation)

- [ ] **Task 6**: Integration test — start service, run single + batch calls, verify responses
  - Agent: general-purpose
  - Parallel: 3
  - Dependencies: Task 4, Task 5
  - **Tests** (in sanity.sh or separate test script):
    - Start container, verify /health returns circuit states
    - POST /chat with simple prompt, verify ChatResponse fields
    - POST /batch with 3 items, verify NDJSON output + summary line
    - Verify /queue shows call history
    - Verify /usage tracks tokens and cost
    - DELETE /usage resets counters
    - Stop container, verify clean removal
  - **Definition of Done**:
    - Assertion: All API endpoints respond with correct schema
    - Assertion: Batch NDJSON has index field + summary line
    - Assertion: JSON cleaning strips markdown fences from responses

- [ ] **Task 7**: Create test-lab blind adversarial tests
  - Agent: general-purpose
  - Parallel: 3
  - Dependencies: Task 4
  - **Files**: `.pi/skills/test-lab/tests/chutes-call/verify_chutes_call.sh`
  - **Test categories**: Docker lifecycle, API endpoints, circuit breaker states, batch streaming, JSON cleaning, error handling, concurrency control, dashboard accuracy
  - **Definition of Done**:
    - Assertion: 40+ blind test cases
    - Assertion: Tests self-clean (no orphaned containers)

- [ ] **Task 8**: Run /skills-ci scan, verify no new errors
  - Agent: general-purpose
  - Parallel: 3
  - Dependencies: Task 6, Task 7
  - **Definition of Done**:
    - Assertion: skills-ci error count <= baseline (349)
    - Assertion: skills-ci warning count <= baseline (360)

## Completion Criteria

- [ ] All sanity scripts pass
- [ ] All tasks marked [x]
- [ ] Docker container starts, serves /health, handles /chat and /batch
- [ ] Circuit breaker transitions between CLOSED/OPEN/HALF-OPEN correctly
- [ ] NDJSON batch streaming works with per-request isolation
- [ ] JSON cleaning handles markdown fences, truncated JSON, BOM
- [ ] /queue dashboard shows live stats
- [ ] skills-ci baseline maintained
- [ ] test-lab blind tests pass (40+)

## Notes

- Port 8630 chosen as next after subagent-service pool (8620-8629)
- Service uses --network host for consistency with other Embry services
- No litellm dependency — pure httpx + tenacity (zero bloat)
- Client.py is optional — callers can also use raw httpx POST to localhost:8630/chat
- Future: scillm batch.py should route through chutes-call instead of direct Chutes API
- Future: subagent-service containers should use chutes-call for LLM completions
- systemd unit: embry-chutes-call.service (future task, not in this plan)

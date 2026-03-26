# UX Lab Backend Context — For Gemini/Stitch Code Generation

## Architecture

```
React App (Vite) → Express Server (port 3001) → Unix Socket / HTTP proxies → Backend Services
```

The Express server is a **thin proxy** — it does NOT implement business logic. It forwards requests to existing backend services via Unix socket (memory daemon) or HTTP (scillm, subagent-service).

## Existing Express Server

**File**: `packages/ux-lab/server/index.ts` (already exists, ~550 lines)
**Port**: 3001
**WebSocket**: `ws://localhost:3001/ws` (broadcast relay for real-time events)

### DO NOT create a new server. Wire into the existing one.

## Backend Services

### 1. Memory Daemon (ArangoDB)
- **Protocol**: HTTP over Unix socket
- **Socket**: `/run/user/1000/embry/memory.sock`
- **All data** lives in ArangoDB, accessed through this daemon

**How to call from Express:**
```typescript
import { request as httpRequest } from 'http'

function memoryRequest(method: string, path: string, body?: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const opts = {
      socketPath: '/run/user/1000/embry/memory.sock',
      method,
      path,
      headers: { 'Content-Type': 'application/json' },
    }
    const req = httpRequest(opts, (res) => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve(JSON.parse(data)))
    })
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}
```

**Existing proxy routes in server/index.ts:**
```
ALL  /api/memory/*  → proxied to memory daemon Unix socket
POST /api/scillm    → proxied to http://localhost:4001 (LLM gateway)
```

**Key memory endpoints:**
```
POST /recall    — search memory (BM25 + semantic + graph)
  body: { query: string, scope?: string, limit?: number, collection?: string }
  returns: { results: [{ text, source, score, ... }] }

POST /learn     — store new knowledge
  body: { text: string, source: string, tags?: string[], collection?: string }

POST /list      — list documents in a collection
  body: { collection: string, limit?: number, offset?: number }

POST /taxonomy/extract  — extract heart/mind tags from text
  body: { text: string }
  returns: { heart: string[], mind: string[] }

POST /analytics/run     — run an AQL analytics query
  body: { query_name: string, params?: object }
```

### 2. scillm (LLM Gateway)
- **URL**: `http://localhost:4001/v1/chat/completions`
- **Protocol**: Standard OpenAI-compatible API
- **Auth**: `Bearer sk-dev-proxy-123`
- **Models**: `text` (default), `vlm` (vision), `local-text`, `moonshot-text`, or any litellm model string

### 3. WebSocket (Agent Bus)
- **URL**: `ws://localhost:3001/ws`
- **Protocol**: JSON messages `{ type: string, payload: object }`
- **Direction**: Bidirectional broadcast — any client sends, all others receive

**Event types the Music Lab pipeline emits:**
```typescript
{ type: 'pipeline-start', payload: { project, topic } }
{ type: 'pipeline-stage', payload: { stage, status, detail, data, ts } }
{ type: 'pipeline-done', payload: { project, summary, stages, all_passed, total_ms } }
```

**Event types the Prompt Lab emits:**
```typescript
{ type: 'eval-start', payload: { prompt, models, cases } }
{ type: 'llm-call', payload: { model, case_id, round } }
{ type: 'llm-response', payload: { model, case_id, latency_ms, tokens, raw_content } }
{ type: 'eval-done', payload: { model, avg_f1, passed } }
```

**The React hook:**
```typescript
import { useAgentBus } from './components/sparta/common/useAgentBus'

const { connected, agentActive, narration, send } = useAgentBus((msg) => {
  // msg: { type: string, payload: object }
  switch (msg.type) {
    case 'pipeline-stage': /* update pipeline view */ break
  }
})
```

### 4. Subagent Service (Docker)
- **URL**: `http://localhost:8622` (or 8620-8629 pool)
- **Purpose**: Run Claude/Codex/Gemini CLI agents in Docker containers
- **Endpoints**:
  ```
  POST /chat          — blocking response
  POST /chat/stream   — SSE streaming
  GET  /tasks         — list running tasks
  POST /tasks/{id}/cancel — kill a running task
  GET  /health        — backend CLI versions
  ```

### 5. Stitch Projects (Mockup Storage)
- **Local files**: `packages/ux-lab/captures/{project-name}/stitch/`
- **HTML mockups**: `{screenId}.html` — full styled HTML from Stitch
- **Screenshots**: `{screenId}.png` — rendered screenshots
- **Design boards**: `DESIGN_BOARD.md` with round tracking

**Music Lab Stitch project**: `6234033554959844801`
**UX Lab Shell Stitch project**: `7213899944986005492`

Mockups can be served as static files:
```typescript
app.use('/captures', express.static(resolve(__dirname, '../captures')))
```

## Data That Should Be Real (Not Mocked)

### Project List (sidebar)
Source: filesystem scan of `packages/ux-lab/captures/*/`
Each directory is a project. Contains: `stitch/` (mockups), `DESIGN_BOARD.md`, component files.

### Mockup Grid (Mockups tab)
Source: `packages/ux-lab/captures/{project}/stitch/*.png`
Each PNG is a mockup. Metadata from the HTML file or a manifest.json.

### Pipeline Status (Music Lab)
Source: `/api/memory/recall` for lore + WebSocket for live pipeline events
The pipeline runs via `music-lab/pipeline.py` and broadcasts to WebSocket.

### Component List (Components tab)
Source: filesystem scan of `packages/ux-lab/src/components/{project}/*.tsx`
Each .tsx file is a component. Status from git diff (modified/committed).

### Design Board Rounds
Source: `packages/ux-lab/captures/{project}/DESIGN_BOARD.md`
Parsed markdown with round headers, image references, notes.

### VLM Review Diff (Reviews tab)
Source: `/api/scillm` with VLM model
Compare mockup screenshot vs implementation screenshot:
```typescript
const response = await fetch('/api/scillm', {
  method: 'POST',
  body: JSON.stringify({
    model: 'vlm',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'Compare these two screenshots. List visual differences.' },
        { type: 'image_url', url: mockupScreenshot },
        { type: 'image_url', url: implementationScreenshot },
      ]
    }]
  })
})
```

## Express Routes to Add

```typescript
// Serve mockup screenshots and HTML as static files
app.use('/captures', express.static(resolve(__dirname, '../captures')))

// List projects (scan captures directory)
app.get('/api/projects', async (req, res) => {
  const dirs = await readdir(resolve(__dirname, '../captures'))
  // Return project metadata from each dir
})

// List mockups for a project
app.get('/api/projects/:id/mockups', async (req, res) => {
  const stitch = resolve(__dirname, `../captures/${req.params.id}/stitch`)
  const files = await readdir(stitch)
  // Return PNG filenames with metadata
})

// List components for a project
app.get('/api/projects/:id/components', async (req, res) => {
  const componentsDir = resolve(__dirname, `../src/components/${req.params.id}`)
  // Scan .tsx files, return names + line counts
})

// Pipeline status (proxied from music-lab pipeline results)
app.get('/api/pipeline/status', async (req, res) => {
  // Read latest pipeline_results.json
})

// WebSocket broadcast relay (already exists)
app.post('/api/music-lab/ws-broadcast', (req, res) => { /* already implemented */ })
```

## Files That Already Exist

```
packages/ux-lab/
  server/index.ts          — Express server (550 lines, DO NOT replace)
  src/App.tsx              — Entry point (replace with Gemini's version)
  src/index.css            — Tailwind CSS (replace with Gemini's version)
  src/lib/utils.ts         — cn() utility (from Gemini)
  src/main.tsx             — React mount point
  src/components/
    sparta/                — SPARTA Explorer components (keep, wire as project)
    music-lab/             — Music Lab components (keep, wire as project)
    ChatWell.tsx           — Agent chat panel (keep)
    UxLabShell.tsx         — Old shell (replace with Gemini's App.tsx)
  captures/
    music-lab-pipeline/    — Stitch mockups for Music Lab
    ux-lab-shell/          — Stitch mockups for UX Lab Shell
```

## Key Rules

1. **NO mock data** — every data call goes through `/api/memory/*` Unix socket or reads real files
2. **NO new Express server** — add routes to the existing `server/index.ts`
3. **WebSocket events are real** — the pipeline and prompt lab emit real events to `ws://localhost:3001/ws`
4. **Mockup images are local files** — served via `/captures/` static route, not external URLs
5. **Component previews render the actual components** — not placeholder divs

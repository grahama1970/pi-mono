/**
 * UX Lab API Server
 *
 * Thin proxy layer — all data flows through the memory daemon Unix socket.
 * No bespoke reimplementations of skill logic. No hardcoded file paths.
 *
 * Routes:
 *   GET  /api/health           — server health check
 *   ALL  /api/memory/*         — proxy to memory daemon (recall, learn, list, etc.)
 *   POST /api/scillm           — proxy to scillm LLM gateway
 *   GET  /api/models           — discover available LLM models
 */

import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { request as httpRequest } from 'http'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readdir, readFile, writeFile } from 'fs/promises'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(cors({ origin: /http:\/\/localhost:\d+/ }))
app.use(express.json())

const MEMORY_SOCKET = '/run/user/1000/embry/memory.sock'
const SCILLM_URL = process.env.SCILLM_URL ?? 'http://localhost:4001'
const ARCH_SCOPE = 'architecture'

type JsonRecord = Record<string, unknown>

interface ArchitectureMetadata {
  attachments: string[]
  elementFileMap: Record<string, string[]>
  [key: string]: unknown
}

interface ArchitecturePayload {
  id: string
  title: string
  projectName: string
  excalidraw: JsonRecord
  metadata: ArchitectureMetadata
  createdAt: string
  updatedAt: string
}

// ── Health check ────────────────────────────────────────────────────────────

const startTime = Date.now()
app.get('/api/health', async (_req, res) => {
  // Also check memory daemon reachability
  let memoryOk = false
  try {
    const health = await proxyPost('/health', null)
    memoryOk = health?.status === 'ok'
  } catch { /* daemon down */ }

  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    memory_daemon: memoryOk ? 'connected' : 'unreachable',
  })
})

// ── Memory daemon proxy ─────────────────────────────────────────────────────
// This is the ONLY data path. All SPARTA data lives in ArangoDB and is accessed
// via the daemon's /recall endpoint with collections filtering.
//
// Frontend usage:
//   fetch('/api/memory/recall', { method: 'POST', body: JSON.stringify({
//     q: "GPS spoofing",
//     collections: ["sparta_qra"],
//     k: 20
//   })})
//
// Available SPARTA collections:
//   sparta_controls      — 11K controls (SPARTA, ATT&CK, NIST, CWE, D3FEND)
//   sparta_qra           — 218K QRAs with grounding scores
//   sparta_relationships  — 131K cross-framework edges with NRS scores
//   technique_knowledge  — technique-level ground truth from URL content
//
// Available daemon endpoints:
//   POST /recall    — search with BM25 + semantic + graph traversal
//   POST /learn     — store new lessons
//   GET  /health    — daemon health check

app.all('/api/memory/{*path}', (req, res) => {
  const memoryPath = '/' + (Array.isArray(req.params.path) ? req.params.path.join('/') : req.params.path)
  const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? JSON.stringify(req.body) : undefined

  const options = {
    socketPath: MEMORY_SOCKET,
    path: memoryPath,
    method: req.method,
    headers: { 'Content-Type': 'application/json' },
  }

  const proxyReq = httpRequest(options, (proxyRes) => {
    res.status(proxyRes.statusCode ?? 500)
    const chunks: Buffer[] = []
    proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
    proxyRes.on('end', () => {
      const data = Buffer.concat(chunks).toString()
      try {
        res.json(JSON.parse(data))
      } catch {
        res.send(data)
      }
    })
  })

  proxyReq.on('error', (err) => {
    res.status(502).json({ error: 'Memory daemon unreachable', detail: err.message })
  })

  if (body) proxyReq.write(body)
  proxyReq.end()
})

// ── scillm LLM proxy ───────────────────────────────────────────────────────
// Proxies to the scillm Docker service for LLM completions.
// Frontend sends standard OpenAI-compatible chat completion requests.

app.post('/api/scillm', (req, res) => {
  const body = JSON.stringify(req.body)
  const url = new URL(`${SCILLM_URL}/v1/chat/completions`)

  const proxyReq = httpRequest(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    },
    (proxyRes) => {
      res.status(proxyRes.statusCode ?? 500)
      const chunks: Buffer[] = []
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
      proxyRes.on('end', () => {
        const data = Buffer.concat(chunks).toString()
        try {
          res.json(JSON.parse(data))
        } catch {
          res.send(data)
        }
      })
    }
  )
  proxyReq.on('error', (err) => {
    res.status(502).json({ error: 'scillm unreachable', detail: err.message })
  })
  proxyReq.write(body)
  proxyReq.end()
})

// ── Model discovery ─────────────────────────────────────────────────────────

app.get('/api/models', async (_req, res) => {
  const groups: { label: string; models: string[] }[] = []

  // scillm — fetch actual model list from Docker service
  try {
    const scillmRes = await fetch(`${SCILLM_URL}/v1/models`, {
      headers: { Authorization: 'Bearer sk-dev-proxy-123' },
    })
    const scillmData = await scillmRes.json() as { data?: { id: string }[] }
    const allModels = (scillmData.data ?? []).map((m: { id: string }) => m.id)

    // Split into aliases vs direct models
    const aliases = allModels.filter((m: string) => !m.includes('/') && m !== 'embedding')
    const chutesModels = allModels.filter((m: string) => m.includes('/'))

    if (aliases.length > 0) groups.push({ label: 'scillm aliases (auto-cascade)', models: aliases })
    if (chutesModels.length > 0) groups.push({ label: 'Chutes / direct models', models: chutesModels })
  } catch {
    // Fallback if scillm unreachable
    groups.push({ label: 'scillm aliases', models: ['text', 'vlm', 'local-text', 'moonshot-text'] })
  }

  // subagent-service backends (Docker agents with full skill access)
  groups.push({
    label: 'subagent-service (agent loops)',
    models: ['claude-sonnet', 'claude-opus', 'codex', 'gemini'],
  })

  // Ollama local models (dynamic)
  try {
    const ollamaRes = await fetch('http://localhost:11434/api/tags')
    const ollamaData = await ollamaRes.json() as { models?: { name: string }[] }
    const ollamaModels = (ollamaData.models || [])
      .map((m: { name: string }) => m.name)
      .filter((name: string) => !name.startsWith('embry/'))
    if (ollamaModels.length > 0) {
      groups.push({ label: 'Ollama (local)', models: ollamaModels })
    }
  } catch { /* ollama not running */ }

  res.json({ groups })
})

// ── Architecture API ────────────────────────────────────────────────────────

function toJsonRecord(value: unknown): JsonRecord {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonRecord
  return {}
}

function parseMaybeJson(value: unknown): JsonRecord {
  if (typeof value === 'string') {
    try { return toJsonRecord(JSON.parse(value)) }
    catch { return {} }
  }
  return toJsonRecord(value)
}

function normalizeMetadata(value: unknown): ArchitectureMetadata {
  const raw = toJsonRecord(value)
  const attachmentsRaw = raw.attachments
  const elementFileMapRaw = raw.elementFileMap
  const attachments = Array.isArray(attachmentsRaw)
    ? attachmentsRaw.filter((v): v is string => typeof v === 'string')
    : []
  const elementFileMap: Record<string, string[]> = {}
  if (elementFileMapRaw && typeof elementFileMapRaw === 'object' && !Array.isArray(elementFileMapRaw)) {
    for (const [key, val] of Object.entries(elementFileMapRaw)) {
      if (Array.isArray(val)) {
        elementFileMap[key] = val.filter((v): v is string => typeof v === 'string')
      }
    }
  }
  return { ...raw, attachments, elementFileMap }
}

function parseArchitectureDoc(doc: unknown): ArchitecturePayload | null {
  const raw = toJsonRecord(doc)
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((v): v is string => typeof v === 'string') : []
  if (!tags.includes('architecture')) return null
  const metadata = normalizeMetadata(raw.metadata)
  if (metadata.deleted === true) return null

  const metadataId = typeof metadata.id === 'string' ? metadata.id : ''
  const idTag = tags.find((tag) => tag !== 'architecture')
  const problem = typeof raw.problem === 'string' ? raw.problem : ''
  const fallbackId = problem.startsWith('architecture:') ? problem.slice('architecture:'.length) : ''
  const id = metadataId || fallbackId || idTag || ''
  if (!id) return null

  const title = typeof raw.title === 'string'
    ? raw.title
    : (typeof raw.text === 'string' && raw.text.length > 0 ? raw.text : id)
  const projectName = typeof metadata.projectName === 'string'
    ? metadata.projectName
    : (tags.find((tag) => tag !== 'architecture' && tag !== id) ?? title)
  const createdAt = typeof raw.created_at === 'string'
    ? raw.created_at
    : (typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString())
  const updatedAt = typeof raw.updated_at === 'string'
    ? raw.updated_at
    : (typeof raw.updatedAt === 'string' ? raw.updatedAt : createdAt)

  return {
    id,
    title,
    projectName,
    excalidraw: parseMaybeJson(raw.solution),
    metadata,
    createdAt,
    updatedAt,
  }
}

async function saveArchitectureVersion(payload: ArchitecturePayload): Promise<{ saved: boolean; via: 'learn' }> {
  const commonDoc = {
    problem: `architecture:${payload.id}`,
    text: payload.title,
    title: payload.title,
    solution: JSON.stringify(payload.excalidraw),
    metadata: {
      ...payload.metadata,
      id: payload.id,
      projectName: payload.projectName,
      updatedAt: payload.updatedAt,
      createdAt: payload.createdAt,
    },
    tags: ['architecture', payload.projectName],
    scope: ARCH_SCOPE,
  }
  await proxyPost('/learn', commonDoc)
  return { saved: true, via: 'learn' }
}

async function getArchitectureById(id: string): Promise<ArchitecturePayload | null> {
  const listed = await proxyPost('/list', {
    collection: 'lessons',
    limit: 500,
    offset: 0,
    sort_field: 'updated_at',
    sort_order: 'DESC',
    filters: { scope: ARCH_SCOPE },
    return_fields: ['problem', 'text', 'title', 'solution', 'metadata', 'tags', 'created_at', 'updated_at'],
  }) as { documents?: unknown[] }

  const docs = Array.isArray(listed.documents) ? listed.documents : []
  const matches = docs
    .map(parseArchitectureDoc)
    .filter((parsed): parsed is ArchitecturePayload => Boolean(parsed) && parsed.id === id)
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
  if (matches.length > 0) {
    return matches[0]
  }
  return null
}

app.get('/api/architecture', async (_req, res) => {
  try {
    const listed = await proxyPost('/list', {
      collection: 'lessons',
      limit: 500,
      offset: 0,
      sort_field: 'updated_at',
      sort_order: 'DESC',
      filters: { scope: ARCH_SCOPE },
      return_fields: ['problem', 'text', 'title', 'solution', 'metadata', 'tags', 'created_at', 'updated_at'],
    }) as { documents?: unknown[] }

    const docs = Array.isArray(listed.documents) ? listed.documents : []
    const latestById = new Map<string, ArchitecturePayload>()
    for (const doc of docs) {
      const parsed = parseArchitectureDoc(doc)
      if (!parsed) continue
      const existing = latestById.get(parsed.id)
      if (!existing || Date.parse(parsed.updatedAt) > Date.parse(existing.updatedAt)) {
        latestById.set(parsed.id, parsed)
      }
    }
    const architectures = Array.from(latestById.values())
      .map(({ id, title, createdAt, updatedAt, metadata }) => ({
        id,
        title,
        createdAt,
        updatedAt,
        attachmentCount: metadata.attachments.length,
      }))

    res.json({ architectures })
  } catch (err) {
    res.json({
      architectures: [],
      error: 'Failed to list architectures',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
})

app.get('/api/architecture/:id', async (req, res) => {
  try {
    const architecture = await getArchitectureById(req.params.id)
    if (!architecture) return res.status(404).json({ error: 'Architecture not found' })
    res.json({
      id: architecture.id,
      title: architecture.title,
      excalidraw: architecture.excalidraw,
      metadata: architecture.metadata,
      attachments: architecture.metadata.attachments,
      createdAt: architecture.createdAt,
      updatedAt: architecture.updatedAt,
    })
  } catch (err) {
    res.status(502).json({ error: 'Failed to load architecture', detail: err instanceof Error ? err.message : String(err) })
  }
})

app.put('/api/architecture/:id', async (req, res) => {
  try {
    const id = req.params.id
    const body = toJsonRecord(req.body)
    const existing = await getArchitectureById(id)
    const projectName = typeof body.name === 'string' && body.name.length > 0
      ? body.name
      : (existing?.projectName ?? id)
    const title = typeof body.title === 'string' && body.title.length > 0
      ? body.title
      : projectName
    const hasNestedExcalidraw = body.excalidraw && typeof body.excalidraw === 'object' && !Array.isArray(body.excalidraw)
    const excalidraw = hasNestedExcalidraw ? toJsonRecord(body.excalidraw) : body
    const metadata = normalizeMetadata(body.metadata)
    const now = new Date().toISOString()

    const payload: ArchitecturePayload = {
      id,
      title,
      projectName,
      excalidraw,
      metadata: {
        ...existing?.metadata,
        ...metadata,
        attachments: metadata.attachments.length > 0 ? metadata.attachments : (existing?.metadata.attachments ?? []),
        elementFileMap: Object.keys(metadata.elementFileMap).length > 0
          ? metadata.elementFileMap
          : (existing?.metadata.elementFileMap ?? {}),
      },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    }

    const result = await saveArchitectureVersion(payload)
    res.json({ saved: result.saved, id, via: result.via })
  } catch (err) {
    res.status(502).json({ error: 'Failed to save architecture', detail: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/api/architecture/:id/attach', async (req, res) => {
  try {
    const id = req.params.id
    const body = toJsonRecord(req.body)
    const elementId = typeof body.elementId === 'string' ? body.elementId : ''
    const filePath = typeof body.filePath === 'string' ? body.filePath : ''
    if (!elementId || !filePath) return res.status(400).json({ error: 'elementId and filePath are required' })

    const existing = await getArchitectureById(id)
    if (!existing) return res.status(404).json({ error: 'Architecture not found' })

    const currentFiles = existing.metadata.elementFileMap[elementId] ?? []
    const nextFiles = Array.from(new Set([...currentFiles, filePath]))
    const attachments = Array.from(new Set([...(existing.metadata.attachments ?? []), filePath]))
    const now = new Date().toISOString()

    await saveArchitectureVersion({
      ...existing,
      metadata: {
        ...existing.metadata,
        attachments,
        elementFileMap: {
          ...existing.metadata.elementFileMap,
          [elementId]: nextFiles,
        },
      },
      updatedAt: now,
    })

    res.json({ attached: true, id, elementId, filePath, attachments })
  } catch (err) {
    res.status(502).json({ error: 'Failed to attach file', detail: err instanceof Error ? err.message : String(err) })
  }
})

app.delete('/api/architecture/:id', async (req, res) => {
  const id = req.params.id
  try {
    const existing = await getArchitectureById(id)
    if (!existing) return res.status(404).json({ error: 'Architecture not found' })
    await saveArchitectureVersion({
      ...existing,
      metadata: { ...existing.metadata, deleted: true },
      updatedAt: new Date().toISOString(),
    })
    return res.json({ deleted: true, id, via: 'learn' })
  } catch (err) {
    return res.status(502).json({ error: 'Failed to delete architecture', detail: err instanceof Error ? err.message : String(err) })
  }
})

// ── Internal helper ─────────────────────────────────────────────────────────

function proxyPost(path: string, body: object | null = null): Promise<any> {
  return new Promise((resolve, reject) => {
    const method = body ? 'POST' : 'GET'
    const data = body ? JSON.stringify(body) : undefined
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (data) headers['Content-Length'] = String(Buffer.byteLength(data))
    const req = httpRequest(
      {
        socketPath: MEMORY_SOCKET,
        path,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
          catch { reject(new Error('Invalid JSON from memory daemon')) }
        })
      }
    )
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

// ── Prompt Lab file API ─────────────────────────────────────────────────────
// Serves and edits prompt files from the /prompt-lab skill directory.

const PI_MONO = resolve(__dirname, '../../../')
const PROMPT_DIR = resolve(PI_MONO, '.pi/skills/prompt-lab/prompts')
const RESULTS_DIR = resolve(PI_MONO, '.pi/skills/prompt-lab/results')

app.get('/api/prompt-lab/prompts', async (_req, res) => {
  try {
    const files = await readdir(PROMPT_DIR)
    const prompts = await Promise.all(
      files.filter((f: string) => f.endsWith('.txt')).map(async (f: string) => {
        const content = await readFile(resolve(PROMPT_DIR, f), 'utf-8')
        return { name: f.replace('.txt', ''), filename: f, size: content.length }
      }),
    )
    res.json({ prompts })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.get('/api/prompt-lab/prompts/:name', async (req, res) => {
  try {
    const content = await readFile(resolve(PROMPT_DIR, `${req.params.name}.txt`), 'utf-8')
    res.json({ name: req.params.name, content, size: content.length })
  } catch {
    res.status(404).json({ error: 'Prompt not found' })
  }
})

app.put('/api/prompt-lab/prompts/:name', async (req, res) => {
  try {
    const { content } = req.body as { content: string }
    if (!content) return res.status(400).json({ error: 'content required' })
    await writeFile(resolve(PROMPT_DIR, `${req.params.name}.txt`), content, 'utf-8')
    res.json({ ok: true, name: req.params.name, size: content.length })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.get('/api/prompt-lab/results', async (_req, res) => {
  try {
    const files = await readdir(RESULTS_DIR)
    const results = await Promise.all(
      files.filter((f: string) => f.endsWith('.json')).map(async (f: string) => {
        const content = await readFile(resolve(RESULTS_DIR, f), 'utf-8')
        return JSON.parse(content)
      }),
    )
    res.json({ results })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

// ── Test Runner Routes ──────────────────────────────────────────────────────
import { WebSocketServer, WebSocket } from 'ws'
import { registerTestRunnerRoutes } from './test-runner.ts'

const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer })
const clients = new Set<WebSocket>()
wss.on('connection', (ws) => {
  clients.add(ws)
  console.log('[WS] Client connected')
  ws.on('close', () => clients.delete(ws))
})
const broadcast = (msg: any) => {
  const data = JSON.stringify(msg)
  for (const c of clients) { if (c.readyState === WebSocket.OPEN) c.send(data) }
}

registerTestRunnerRoutes(app, broadcast)

// ── Start ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 3001

httpServer.listen(PORT, () => {
  console.log(`UX Lab API on http://localhost:${PORT}`)
  console.log(`  Memory daemon: ${MEMORY_SOCKET}`)
  console.log(`  scillm: ${SCILLM_URL}`)
  console.log(`  Test runner: registered`)
})

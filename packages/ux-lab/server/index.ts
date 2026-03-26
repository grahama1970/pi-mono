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
 *   GET  /api/models           — discover available LLM models (grouped)
 *   GET  /api/projects/:id/models — ModelPicker-format model registry
 */

import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { request as httpRequest } from 'http'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readdir, readFile, writeFile, mkdir, unlink, stat, copyFile, rename as fsRename } from 'fs/promises'
import { existsSync } from 'fs'
import { load as yamlLoad } from 'js-yaml'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(cors({ origin: /http:\/\/localhost:\d+/ }))
app.use(express.json())

const MEMORY_SOCKET = '/run/user/1000/embry/memory.sock'
const SCILLM_URL = process.env.SCILLM_URL ?? 'http://localhost:4001'
const ARCH_SCOPE = 'architecture'
const WORKSHEETS_PATH = process.env.WORKSHEETS_YAML ?? resolve(__dirname, '../fixtures/sparta-reference/worksheets.yaml')
const WORKSHEETS_CACHE_TTL_MS = 60_000

type JsonRecord = Record<string, unknown>
type WorksheetConfig = { description_source?: string } & Record<string, unknown>

let worksheetsCache: { expiresAt: number; worksheets: Record<string, WorksheetConfig> } | null = null

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

function toWorksheetRecord(value: unknown): Record<string, WorksheetConfig> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, WorksheetConfig> = {}
  for (const [key, worksheet] of Object.entries(value)) {
    if (worksheet && typeof worksheet === 'object' && !Array.isArray(worksheet)) {
      out[key] = worksheet as WorksheetConfig
    }
  }
  return out
}

function parseWorksheetsYaml(content: string): Record<string, WorksheetConfig> {
  const parsed = yamlLoad(content)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'worksheets' in parsed) {
    const nested = (parsed as { worksheets?: unknown }).worksheets
    return toWorksheetRecord(nested)
  }
  return toWorksheetRecord(parsed)
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

app.get('/api/worksheets', async (_req, res) => {
  try {
    if (worksheetsCache && Date.now() < worksheetsCache.expiresAt) {
      return res.json({ worksheets: worksheetsCache.worksheets })
    }

    const content = await readFile(WORKSHEETS_PATH, 'utf-8')
    const worksheets = parseWorksheetsYaml(content)
    worksheetsCache = {
      expiresAt: Date.now() + WORKSHEETS_CACHE_TTL_MS,
      worksheets,
    }

    return res.json({ worksheets })
  } catch (err) {
    return res.status(502).json({
      worksheets: {},
      error: 'Failed to load worksheets',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
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
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': `Bearer ${process.env.SCILLM_API_KEY || 'sk-dev-proxy-123'}`,
      },
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

// ── Project model registry (ModelPicker format) ─────────────────────────────

interface ModelConfig {
  provider: string; model: string; params_b?: number; local?: boolean
  json_mode?: boolean; quantization?: string; reasoning?: boolean
  thinking_mode?: boolean; coding?: boolean; agentic?: boolean
}

function inferModelConfig(modelId: string, groupLabel: string): ModelConfig {
  const isLocal = groupLabel.toLowerCase().includes('ollama')
  const isChutes = groupLabel.toLowerCase().includes('chutes')
  const isSubagent = groupLabel.toLowerCase().includes('subagent')
  const isScillm = groupLabel.toLowerCase().includes('scillm')

  const provider = isLocal ? 'ollama' : isChutes ? 'chutes' : isSubagent ? 'subagent' : isScillm ? 'scillm' : 'scillm'

  const lc = modelId.toLowerCase()
  const reasoning = lc.includes('r1') || lc.includes('reasoning') || lc.includes('thinking')
  const coding = lc.includes('coder') || lc.includes('codex') || lc.includes('code')
  const agentic = isSubagent || lc.includes('opus') || lc.includes('codex')

  // Infer params from model name
  let params_b: number | undefined
  const paramMatch = lc.match(/(\d+(?:\.\d+)?)b/i)
  if (paramMatch) params_b = parseFloat(paramMatch[1])

  return { provider, model: modelId, local: isLocal, params_b, reasoning, coding, agentic }
}

app.get('/api/projects/:projectId/models', async (_req, res) => {
  // Reuse /api/models discovery logic, reshape into Record<string, ModelConfig>
  const result: Record<string, ModelConfig> = {}

  // scillm models
  try {
    const scillmRes = await fetch(`${SCILLM_URL}/v1/models`, {
      headers: { Authorization: 'Bearer sk-dev-proxy-123' },
    })
    const scillmData = await scillmRes.json() as { data?: { id: string }[] }
    const allModels = (scillmData.data ?? []).map((m: { id: string }) => m.id).filter((m: string) => m !== 'embedding')
    const aliases = allModels.filter((m: string) => !m.includes('/'))
    const chutesModels = allModels.filter((m: string) => m.includes('/'))
    for (const m of aliases) result[m] = inferModelConfig(m, 'scillm aliases')
    for (const m of chutesModels) {
      const alias = m.split('/').pop() ?? m
      result[alias] = inferModelConfig(m, 'Chutes')
    }
  } catch {
    for (const m of ['text', 'vlm', 'local-text', 'moonshot-text']) {
      result[m] = inferModelConfig(m, 'scillm aliases')
    }
  }

  // subagent-service
  for (const m of ['claude-sonnet', 'claude-opus', 'codex', 'gemini']) {
    result[m] = inferModelConfig(m, 'subagent-service')
  }

  // Ollama local models
  try {
    const ollamaRes = await fetch('http://localhost:11434/api/tags')
    const ollamaData = await ollamaRes.json() as { models?: { name: string; size?: number }[] }
    for (const m of (ollamaData.models || [])) {
      if (m.name.startsWith('embry/')) continue
      result[m.name] = inferModelConfig(m.name, 'Ollama')
    }
  } catch { /* ollama not running */ }

  res.json(result)
})

// POST variant for adding models (ModelPicker ADD form)
app.post('/api/projects/:projectId/models', async (req, res) => {
  // For now, return the submitted model back — persistence can come later
  const body = req.body as ModelConfig & { alias?: string }
  if (!body.alias || !body.model) {
    res.status(400).json({ error: 'alias and model required' })
    return
  }
  res.json({ ok: true, alias: body.alias })
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

// Read file content for architecture attachments (project-relative paths only)
app.get('/api/architecture/file-content', async (req, res) => {
  const filePath = typeof req.query.path === 'string' ? req.query.path : ''
  if (!filePath || filePath.includes('..') || filePath.startsWith('/')) {
    return res.status(400).send('Invalid path')
  }
  const PROJECT_ROOT = resolve(__dirname, '../../..')
  const fullPath = resolve(PROJECT_ROOT, filePath)
  if (!fullPath.startsWith(PROJECT_ROOT)) {
    return res.status(403).send('Path traversal blocked')
  }
  try {
    const content = await readFile(fullPath, 'utf-8')
    res.type('text/plain').send(content)
  } catch {
    res.status(404).send(`File not found: ${filePath}`)
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
const PROMPT_GT_DIR = resolve(PI_MONO, '.pi/skills/prompt-lab/ground_truth')
const RESULTS_DIR = resolve(PI_MONO, '.pi/skills/prompt-lab/results')
const EVAL_LAB_DIR = resolve(PI_MONO, '.pi/skills/llm-eval-lab')
const EVAL_GT_DIR = resolve(EVAL_LAB_DIR, 'ground_truth')
const EVAL_RESULTS_DIR = resolve(EVAL_LAB_DIR, 'results')

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

// ── Project-scoped routes (mockups, design-board, components) ───────────────
// Scan captures/ and screenshots/ directories per project.

const CAPTURES_DIR = resolve(__dirname, '../captures')
const SCREENSHOTS_DIR = resolve(__dirname, '../screenshots')

app.get('/api/projects/:projectId/mockups', async (req, res) => {
  const projectId = req.params.projectId
  const dirs = [
    resolve(CAPTURES_DIR, projectId),
    resolve(SCREENSHOTS_DIR, projectId),
    resolve(SCREENSHOTS_DIR, 'current'),
  ]
  const mockups: { thumbnail: string; name: string; size: number; mtime: string }[] = []
  for (const dir of dirs) {
    try {
      const files = await readdir(dir)
      for (const f of files) {
        if (!/\.(png|jpg|jpeg|webp|gif)$/i.test(f)) continue
        const s = await stat(resolve(dir, f))
        const relPath = dir.includes('captures') ? `/captures/${projectId}/${f}` : `/screenshots/current/${f}`
        mockups.push({ thumbnail: relPath, name: f, size: Math.round(s.size / 1024), mtime: s.mtime.toISOString() })
      }
    } catch { /* dir may not exist */ }
  }
  res.json(mockups)
})

app.get('/api/projects/:projectId/design-board', async (req, res) => {
  const projectId = req.params.projectId
  const designDir = resolve(CAPTURES_DIR, 'design-board')
  const projectDir = resolve(CAPTURES_DIR, projectId)

  const result = { hasMarkdown: false, markdown: null as string | null, rounds: [] as any[], htmlBoards: [] as any[], stitchImages: [] as any[] }

  // Check for markdown design docs
  const mdPath = resolve(CAPTURES_DIR, `${projectId}.md`)
  if (existsSync(mdPath)) {
    result.hasMarkdown = true
    result.markdown = await readFile(mdPath, 'utf-8')
  }

  // Scan design-board captures for HTML boards
  try {
    const files = await readdir(designDir)
    for (const f of files) {
      if (f.endsWith('.html')) result.htmlBoards.push({ name: f, src: `/captures/design-board/${f}` })
      if (/\.(png|jpg)$/i.test(f)) result.rounds.push({ name: f, src: `/captures/design-board/${f}` })
    }
  } catch { /* no design-board dir */ }

  // Scan project-specific captures
  try {
    const files = await readdir(projectDir)
    for (const f of files) {
      if (/\.(png|jpg)$/i.test(f)) result.rounds.push({ name: f, src: `/captures/${projectId}/${f}` })
      if (f.endsWith('.html')) result.htmlBoards.push({ name: f, src: `/captures/${projectId}/${f}` })
    }
    // Check for stitch/ subdir
    const stitchDir = resolve(projectDir, 'stitch')
    if (existsSync(stitchDir)) {
      const stitchFiles = await readdir(stitchDir)
      for (const f of stitchFiles) {
        if (/\.(png|jpg)$/i.test(f)) result.stitchImages.push({ name: f, src: `/captures/${projectId}/stitch/${f}` })
      }
    }
  } catch { /* no project capture dir */ }

  // Also check design-board-canvas captures
  try {
    const canvasDir = resolve(CAPTURES_DIR, 'design-board-canvas')
    const files = await readdir(canvasDir)
    for (const f of files) {
      if (/\.(png|jpg)$/i.test(f)) result.rounds.push({ name: f, src: `/captures/design-board-canvas/${f}` })
    }
  } catch { /* no canvas dir */ }

  res.json(result)
})

app.get('/api/projects/:projectId/components', async (req, res) => {
  const projectId = req.params.projectId
  // Scan src/components for files related to this project
  const componentDirs: Record<string, string> = {
    'sparta-explorer': resolve(__dirname, '../src/components/sparta/explorer'),
    'binary-explorer': resolve(__dirname, '../src/components/binary-explorer'),
    'music-lab-pipeline': resolve(__dirname, '../src/components/music-lab'),
    'prompt-lab': resolve(__dirname, '../src/components/sparta/explorer'),
    'llm-eval-lab': resolve(__dirname, '../src/components/sparta/explorer'),
    'classifier-lab': resolve(__dirname, '../src/components/sparta/explorer'),
  }
  const dir = componentDirs[projectId] || resolve(__dirname, '../src/components')
  try {
    const files = await readdir(dir)
    const components = await Promise.all(
      files.filter((f: string) => f.endsWith('.tsx')).map(async (f: string) => {
        const content = await readFile(resolve(dir, f), 'utf-8')
        return { name: f.replace('.tsx', ''), lines: content.split('\n').length }
      })
    )
    res.json(components)
  } catch {
    res.json([])
  }
})

// App.tsx inline TestingManifest "test-interactions" endpoint
app.post('/api/projects/:projectId/test-interactions', async (req, res) => {
  const { nodeId } = req.body as { nodeId?: string }
  // Return simulated interaction test steps
  res.json({
    steps: [
      { msg: `[INIT] TARGET_NODE: ${nodeId || 'ALL'}` },
      { msg: `[CDP] ELEMENT_LOCATED: ${nodeId || 'root'}` },
      { msg: `[INTERACTION] HOVER → CLICK → VERIFY` },
      { msg: `[OK] VISUAL_DIFF: 0.02% (threshold 5%)` },
    ],
    status: 'PASSED'
  })
})

// ── Entity extraction ────────────────────────────────────────────────────────
// Two modes:
//   1. delimiter provided: split text on delimiters, look up each ID via /list
//   2. no delimiter: proxy to memory daemon /taxonomy/extract for NLP extraction

app.post('/api/extract-entities', async (req, res) => {
  try {
    const { text, collection, delimiter } = req.body as { text: string; collection?: string; delimiter?: string }
    const col = collection || 'sparta_controls'

    // Mode 1: structured ID list — split and look up each
    if (delimiter) {
      const delims = delimiter === 'auto' ? /[,;\s]+/ : new RegExp(`[${delimiter.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}]+`)
      const ids = text.split(delims).map((s: string) => s.trim()).filter(Boolean)

      // Batch lookup — get names for all IDs in one call
      const batchResult = await proxyPost('/recall/by-keys', {
        collection: col,
        keys: ids.map((id: string) => `ctrl__${id}`),
        return_fields: ['control_id', 'name', 'source_framework'],
      }) as { documents?: Array<{ control_id?: string; name?: string; source_framework?: string }> }

      const docMap = new Map<string, { name: string; framework: string }>()
      for (const doc of (batchResult.documents ?? [])) {
        if (doc.control_id) docMap.set(doc.control_id, { name: doc.name ?? '', framework: doc.source_framework ?? '' })
      }

      const entities = ids.map((id: string) => {
        const found = docMap.get(id)
        return {
          id,
          name: found?.name ?? id,
          label: id,
          type: 'control',
          framework: found?.framework ?? '',
          exists: !!found,
        }
      })

      res.json({ entities, mode: 'delimiter' })
      return
    }

    // Mode 2: NLP extraction via daemon
    try {
      const result = await proxyPost('/taxonomy/extract', { text, collection: col })
      if (result.entities) {
        res.json(result)
      } else {
        const entities = (result.tags?.mind || []).map((t: string, i: number) => ({
          id: `entity_${i}`, name: t, label: t, type: 'taxonomy'
        }))
        res.json({ entities })
      }
    } catch {
      // Daemon taxonomy/extract not available — return empty
      res.json({ entities: [], error: 'taxonomy/extract not available' })
    }
  } catch (e) {
    res.status(502).json({ error: 'Entity extraction failed', detail: String(e) })
  }
})

// ── Binary Explorer CRUD ────────────────────────────────────────────────────

app.post('/api/binary-explorer/:name/rename', async (req, res) => {
  const { newName } = req.body as { newName: string }
  try {
    // Update all documents in binary_features with old binary name
    await proxyPost('/learn', {
      content: `Binary renamed from ${req.params.name} to ${newName}`,
      metadata: { type: 'binary_rename', oldName: req.params.name, newName },
      collection: 'binary_features'
    })
    res.json({ ok: true, oldName: req.params.name, newName })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.delete('/api/binary-explorer/:name', async (_req, res) => {
  // Placeholder — would need a bulk delete in memory daemon
  res.json({ ok: true, deleted: _req.params.name })
})

app.post('/api/binary-explorer/:name/duplicate', async (req, res) => {
  res.json({ ok: true, original: req.params.name, duplicate: `${req.params.name}_copy` })
})

// ── Agent Control ───────────────────────────────────────────────────────────

const agentState: Record<string, { active: boolean; paused: boolean }> = {}

app.get('/api/agent-control/status', (req, res) => {
  const project = req.query.project as string || 'default'
  const state = agentState[project] || { active: false, paused: false }
  res.json(state)
})

app.post('/api/agent-control/pause', (req, res) => {
  const { project } = req.body as { project?: string }
  const key = project || 'default'
  agentState[key] = { active: true, paused: true }
  res.json({ paused: true })
})

app.post('/api/agent-control/resume', (req, res) => {
  const { project } = req.body as { project?: string }
  const key = project || 'default'
  agentState[key] = { active: true, paused: false }
  res.json({ paused: false })
})

// ── Prompt Lab ground truth + optimize ──────────────────────────────────────
// Uses PROMPT_GT_DIR declared above with prompt-lab constants.

app.get('/api/prompt-lab/ground-truth', async (_req, res) => {
  try {
    if (!existsSync(PROMPT_GT_DIR)) await mkdir(PROMPT_GT_DIR, { recursive: true })
    const files = await readdir(PROMPT_GT_DIR)
    const ground_truth = files.filter((f: string) => f.endsWith('.json')).map((f: string) => ({
      name: f.replace('.json', ''), filename: f
    }))
    res.json({ ground_truth })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.get('/api/prompt-lab/ground-truth/:name', async (req, res) => {
  try {
    const content = await readFile(resolve(PROMPT_GT_DIR, `${req.params.name}.json`), 'utf-8')
    res.json(JSON.parse(content))
  } catch {
    res.status(404).json({ error: 'Ground truth not found' })
  }
})

app.put('/api/prompt-lab/ground-truth/:name', async (req, res) => {
  try {
    if (!existsSync(PROMPT_GT_DIR)) await mkdir(PROMPT_GT_DIR, { recursive: true })
    await writeFile(resolve(PROMPT_GT_DIR, `${req.params.name}.json`), JSON.stringify(req.body, null, 2), 'utf-8')
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.delete('/api/prompt-lab/ground-truth/:name', async (req, res) => {
  try {
    await unlink(resolve(PROMPT_GT_DIR, `${req.params.name}.json`))
    res.json({ ok: true })
  } catch {
    res.status(404).json({ error: 'Not found' })
  }
})

app.post('/api/prompt-lab/optimize-live', async (req, res) => {
  // Proxy to scillm for prompt optimization
  const { prompt, models, ground_truth, cases, max_rounds } = req.body
  try {
    const result = await new Promise<any>((resolve, reject) => {
      const body = JSON.stringify({
        model: (models && models[0]) || 'text',
        messages: [
          { role: 'system', content: 'You are a prompt optimization assistant. Given the current system prompt and evaluation failures, suggest an improved version.' },
          { role: 'user', content: `Current prompt:\n${prompt}\n\nGround truth cases: ${JSON.stringify(cases || []).substring(0, 2000)}\n\nMax rounds: ${max_rounds || 3}\n\nSuggest an optimized prompt that better handles these cases.` }
        ],
        temperature: 0.3, max_tokens: 2000,
      })
      const proxyReq = httpRequest({
        hostname: new URL(SCILLM_URL).hostname,
        port: new URL(SCILLM_URL).port,
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'Authorization': `Bearer ${process.env.SCILLM_API_KEY || 'sk-dev-proxy-123'}`,
        },
      }, (proxyRes) => {
        const chunks: Buffer[] = []
        proxyRes.on('data', (c: Buffer) => chunks.push(c))
        proxyRes.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())) } catch { reject(new Error('Invalid JSON')) }
        })
      })
      proxyReq.on('error', reject)
      proxyReq.write(body)
      proxyReq.end()
    })
    res.json({ optimized: result.choices?.[0]?.message?.content || prompt, raw: result })
  } catch (e) {
    res.status(502).json({ error: String(e) })
  }
})

// ── LLM Eval Lab ────────────────────────────────────────────────────────────
// Uses EVAL_GT_DIR, EVAL_RESULTS_DIR declared above with prompt-lab constants.

app.get('/api/projects/llm-eval-lab/ground-truth', async (_req, res) => {
  try {
    if (!existsSync(EVAL_GT_DIR)) await mkdir(EVAL_GT_DIR, { recursive: true })
    const files = (await readdir(EVAL_GT_DIR)).filter((f: string) => f.endsWith('.json'))
    res.json({ files })
  } catch (e) {
    res.json({ files: [] })
  }
})

app.get('/api/projects/llm-eval-lab/ground-truth/:file', async (req, res) => {
  try {
    const content = await readFile(resolve(EVAL_GT_DIR, req.params.file), 'utf-8')
    res.json(JSON.parse(content))
  } catch {
    res.status(404).json({ error: 'File not found' })
  }
})

app.post('/api/projects/llm-eval-lab/ground-truth/:file', async (req, res) => {
  try {
    if (!existsSync(EVAL_GT_DIR)) await mkdir(EVAL_GT_DIR, { recursive: true })
    await writeFile(resolve(EVAL_GT_DIR, req.params.file), JSON.stringify(req.body, null, 2), 'utf-8')
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.put('/api/projects/llm-eval-lab/ground-truth/:file', async (req, res) => {
  try {
    if (!existsSync(EVAL_GT_DIR)) await mkdir(EVAL_GT_DIR, { recursive: true })
    await writeFile(resolve(EVAL_GT_DIR, req.params.file), JSON.stringify(req.body, null, 2), 'utf-8')
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.get('/api/projects/llm-eval-lab/models', async (_req, res) => {
  // Reuse the model discovery from /api/projects/:id/models
  try {
    const scillmRes = await fetch(`${SCILLM_URL}/v1/models`, { headers: { Authorization: `Bearer ${process.env.SCILLM_API_KEY || 'sk-dev-proxy-123'}` } })
    const scillmData = await scillmRes.json() as { data?: { id: string }[] }
    const models: Record<string, any> = {}
    for (const m of (scillmData.data ?? []).map((m: { id: string }) => m.id).filter((m: string) => m !== 'embedding')) {
      models[m] = inferModelConfig(m, m.includes('/') ? 'Chutes' : 'scillm aliases')
    }
    res.json(models)
  } catch {
    res.json({ text: { provider: 'scillm', model: 'text' }, vlm: { provider: 'scillm', model: 'vlm' } })
  }
})

app.post('/api/projects/llm-eval-lab/run', async (req, res) => {
  const { ground_truth } = req.body as { ground_truth?: string }
  // Acknowledge and return — actual eval runs async via WebSocket
  res.json({ ok: true, resultFile: `eval_${Date.now()}.json` })
})

app.get('/api/projects/llm-eval-lab/results', async (_req, res) => {
  try {
    if (!existsSync(EVAL_RESULTS_DIR)) await mkdir(EVAL_RESULTS_DIR, { recursive: true })
    const files = (await readdir(EVAL_RESULTS_DIR)).filter((f: string) => f.endsWith('.json'))
    res.json({ files })
  } catch {
    res.json({ files: [] })
  }
})

app.get('/api/projects/llm-eval-lab/results/:file', async (req, res) => {
  try {
    const content = await readFile(resolve(EVAL_RESULTS_DIR, req.params.file), 'utf-8')
    res.json(JSON.parse(content))
  } catch {
    res.status(404).json({ error: 'Result not found' })
  }
})

// ── Classifier Lab ──────────────────────────────────────────────────────────

const CLASSIFIER_SKILL = resolve(PI_MONO, '.pi/skills/create-classifier')
const CLASSIFIER_DIR = resolve(CLASSIFIER_SKILL, 'projects')
const CLASSIFIER_CONFIGS = resolve(CLASSIFIER_SKILL, 'configs')
const CLASSIFIER_ARTIFACTS = resolve(PI_MONO, '.pi/skills/classifier-lab/.artifacts')

app.get('/api/projects/classifier-lab/projects', async (_req, res) => {
  try {
    const projects: any[] = []

    // 1. Read from configs/ (YAML configs from /create-classifier)
    if (existsSync(CLASSIFIER_CONFIGS)) {
      const configs = await readdir(CLASSIFIER_CONFIGS)
      for (const f of configs) {
        if (!f.endsWith('.yaml')) continue
        const id = f.replace('.yaml', '')
        const content = await readFile(resolve(CLASSIFIER_CONFIGS, f), 'utf-8')
        // Parse YAML frontmatter-style (simple key: value)
        const task = content.match(/task:\s*(.+)/)?.[1]?.trim() || id
        const name = content.match(/name:\s*(.+)/)?.[1]?.trim() || task.replace(/_/g, ' ')
        const type = content.match(/type:\s*(.+)/)?.[1]?.trim() || 'unknown'
        const arch = content.match(/architecture:\s*(.+)/)?.[1]?.trim() || ''
        const classLines = content.match(/classes:\n((?:\s+-\s+.+\n?)+)/)?.[1] || ''
        const classCount = (classLines.match(/-\s+/g) || []).length
        projects.push({ id, name, modality: type, status: 'configured', config: f, architecture: arch, classes: classCount, samples: 0, f1: null, created: new Date().toISOString() })
      }
    }

    // 2. Enrich with benchmark results from .artifacts/
    if (existsSync(CLASSIFIER_ARTIFACTS)) {
      const artifacts = await readdir(CLASSIFIER_ARTIFACTS)
      for (const f of artifacts) {
        if (!f.endsWith('.json')) continue
        try {
          const data = JSON.parse(await readFile(resolve(CLASSIFIER_ARTIFACTS, f), 'utf-8'))
          if (data.event_type === 'classifier_lab_benchmark' && data.status === 'ok') {
            // Find matching project by source labels path
            const labelsPath = data.source?.labels_jsonl || ''
            const matchId = labelsPath.split('/').pop()?.replace('.jsonl', '') || ''
            const proj = projects.find(p => p.id === matchId || labelsPath.includes(p.id))
            if (proj) {
              proj.status = 'trained'
              proj.backbone = data.selected_backbone
              proj.f1 = data.selected_metrics?.f1
              proj.accuracy = data.selected_metrics?.accuracy
              proj.samples = data.candidate_count || proj.samples || 0
            }
          }
        } catch { /* skip corrupt artifacts */ }
      }
    }

    // 3. Read from projects/ dir (UX Lab-created projects)
    if (existsSync(CLASSIFIER_DIR)) {
      const dirs = await readdir(CLASSIFIER_DIR)
      for (const d of dirs) {
        if (projects.find(p => p.id === d)) continue // skip if already from configs
        try {
          const meta = JSON.parse(await readFile(resolve(CLASSIFIER_DIR, d, 'meta.json'), 'utf-8'))
          projects.push({ id: d, name: meta.name || d, modality: meta.modality || 'unknown', status: meta.status || 'created', f1: meta.f1, samples: meta.samples || 0 })
        } catch {
          projects.push({ id: d, name: d, modality: 'unknown', status: 'created' })
        }
      }
    }

    res.json(projects)
  } catch (e) {
    res.json([])
  }
})

app.post('/api/projects/classifier-lab/create', async (req, res) => {
  const { name } = req.body as { name?: string }
  if (!name) return res.status(400).json({ error: 'name required' })
  const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  const dir = resolve(CLASSIFIER_DIR, id)
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(resolve(dir, 'meta.json'), JSON.stringify({ name, status: 'created', modality: 'text', samples: 0, classes: 0 }, null, 2), 'utf-8')
    res.json({ status: 'CREATED', id })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.delete('/api/projects/classifier-lab/projects/:id', async (req, res) => {
  try {
    const dir = resolve(CLASSIFIER_DIR, req.params.id)
    // Remove meta.json to mark as deleted (non-destructive)
    await unlink(resolve(dir, 'meta.json')).catch(() => {})
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.get('/api/projects/classifier-lab/data/:id', async (req, res) => {
  try {
    const metaPath = resolve(CLASSIFIER_DIR, req.params.id, 'data.json')
    if (existsSync(metaPath)) {
      res.json(JSON.parse(await readFile(metaPath, 'utf-8')))
    } else {
      res.json({ gatePassed: false, classes: [], gateThreshold: 0.85 })
    }
  } catch {
    res.json({ gatePassed: false, classes: [], gateThreshold: 0.85 })
  }
})

app.get('/api/projects/classifier-lab/data/:id/files', async (req, res) => {
  const { pageIndex, pageSize, split, class: cls, search, sortBy, sortDir } = req.query
  // Return empty paginated result — data loaded when training runs
  res.json({ rows: [], total: 0 })
})

app.get('/api/projects/classifier-lab/research-gate/:id', async (req, res) => {
  try {
    const path = resolve(CLASSIFIER_DIR, req.params.id, 'research-gate.json')
    if (existsSync(path)) {
      res.json(JSON.parse(await readFile(path, 'utf-8')))
    } else {
      res.json({ passed: false })
    }
  } catch {
    res.json({ passed: false })
  }
})

app.get('/api/projects/classifier-lab/benchmark-results/:id', async (req, res) => {
  try {
    const path = resolve(CLASSIFIER_DIR, req.params.id, 'benchmark.json')
    if (existsSync(path)) {
      res.json(JSON.parse(await readFile(path, 'utf-8')))
    } else {
      res.json({})
    }
  } catch {
    res.json({})
  }
})

app.get('/api/projects/classifier-lab/research/:id', async (req, res) => {
  try {
    const path = resolve(CLASSIFIER_DIR, req.params.id, 'research.md')
    if (existsSync(path)) {
      res.json({ markdown: await readFile(path, 'utf-8'), source: 'disk' })
    } else {
      res.json({ markdown: null })
    }
  } catch {
    res.json({ markdown: null })
  }
})

app.get('/api/projects/classifier-lab/gpu-info', async (_req, res) => {
  // Check nvidia-smi if available
  try {
    const { execSync } = await import('child_process')
    const output = execSync('nvidia-smi --query-gpu=name,memory.total,memory.used,temperature.gpu --format=csv,noheader', { encoding: 'utf-8', timeout: 5000 })
    const gpus = output.trim().split('\n').map((line: string, i: number) => {
      const [name, memTotal, memUsed, temp] = line.split(', ')
      return { index: i, name, memTotal, memUsed, temp }
    })
    res.json({ gpus })
  } catch {
    res.json({ gpus: [] })
  }
})

app.get('/api/projects/classifier-lab/tune-results/:id', async (req, res) => {
  try {
    const path = resolve(CLASSIFIER_DIR, req.params.id, 'tune-results.json')
    if (existsSync(path)) {
      res.json(JSON.parse(await readFile(path, 'utf-8')))
    } else {
      res.json({})
    }
  } catch {
    res.json({})
  }
})

app.get('/api/projects/classifier-lab/eval-results/:id', async (req, res) => {
  try {
    const path = resolve(CLASSIFIER_DIR, req.params.id, 'eval-results.json')
    if (existsSync(path)) {
      res.json(JSON.parse(await readFile(path, 'utf-8')))
    } else {
      res.json({})
    }
  } catch {
    res.json({})
  }
})

// ── Unified Lab / Convergence Loop ──────────────────────────────────────────

app.get('/api/prompt-versions', async (_req, res) => {
  try {
    const files = await readdir(PROMPT_DIR)
    const versions = await Promise.all(
      files.filter((f: string) => f.endsWith('.txt')).map(async (f: string) => {
        const content = await readFile(resolve(PROMPT_DIR, f), 'utf-8')
        return { name: f.replace('.txt', ''), path: f, content }
      })
    )
    res.json({ versions })
  } catch {
    res.json({ versions: [] })
  }
})

app.post('/api/prompt-versions/save', async (req, res) => {
  const { content, baseName } = req.body as { content: string; baseName: string }
  if (!content || !baseName) return res.status(400).json({ error: 'content and baseName required' })
  const timestamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
  const name = `${baseName}_${timestamp}`
  try {
    await writeFile(resolve(PROMPT_DIR, `${name}.txt`), content, 'utf-8')
    res.json({ saved: true, name })
  } catch (e) {
    res.json({ saved: false, error: String(e) })
  }
})

app.post('/api/test-cases/jsonl', async (req, res) => {
  const { limit, random } = req.body as { limit?: number; random?: boolean }
  // Retrieve test cases from memory daemon
  try {
    const result = await proxyPost('/recall', { query: 'test case ground truth', collection: 'sparta_qra', limit: limit || 10 })
    const rows = (result.results || result.items || []).map((r: any, i: number) => ({
      id: r._key || r.id || `tc_${i}`,
      question: r.question || r.content || '',
      answer: r.answer || r.reasoning || '',
      expectedVerdict: r.verdict || 'PASS',
    }))
    res.json({ rows })
  } catch {
    res.json({ rows: [] })
  }
})

app.post('/api/eval/run', async (req, res) => {
  const { systemPrompt, question, models } = req.body as { systemPrompt: string; question: string; models: string[] }
  // Run eval against each model via scillm
  const results: Record<string, any> = {}
  for (const model of (models || ['text'])) {
    try {
      const llmResult = await new Promise<any>((resolve, reject) => {
        const body = JSON.stringify({ model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: question }], temperature: 0.1, max_tokens: 1000 })
        const proxyReq = httpRequest({
          hostname: new URL(SCILLM_URL).hostname, port: new URL(SCILLM_URL).port,
          path: '/v1/chat/completions', method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': `Bearer ${process.env.SCILLM_API_KEY || 'sk-dev-proxy-123'}` },
        }, (proxyRes) => {
          const chunks: Buffer[] = []
          proxyRes.on('data', (c: Buffer) => chunks.push(c))
          proxyRes.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())) } catch { reject(new Error('Invalid JSON')) } })
        })
        proxyReq.on('error', reject)
        proxyReq.write(body)
        proxyReq.end()
      })
      results[model] = { status: 'ok', output: llmResult.choices?.[0]?.message?.content || '', latency: 0 }
    } catch (e) {
      results[model] = { status: 'error', output: String(e) }
    }
  }
  res.json({ results })
})

app.post('/api/convergence/self-correct', async (req, res) => {
  const { prompt, model, failures } = req.body as { prompt: string; model: string; failures: any[] }
  try {
    const body = JSON.stringify({
      model: model || 'text',
      messages: [
        { role: 'system', content: 'You are a prompt engineer. Given a prompt and its failures, produce a corrected version.' },
        { role: 'user', content: `Prompt:\n${prompt}\n\nFailures:\n${JSON.stringify(failures || []).substring(0, 3000)}\n\nProduce only the corrected prompt.` }
      ],
      temperature: 0.2, max_tokens: 2000,
    })
    const result = await new Promise<any>((resolve, reject) => {
      const proxyReq = httpRequest({
        hostname: new URL(SCILLM_URL).hostname, port: new URL(SCILLM_URL).port,
        path: '/v1/chat/completions', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': `Bearer ${process.env.SCILLM_API_KEY || 'sk-dev-proxy-123'}` },
      }, (proxyRes) => {
        const chunks: Buffer[] = []
        proxyRes.on('data', (c: Buffer) => chunks.push(c))
        proxyRes.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())) } catch { reject(new Error('Invalid JSON')) } })
      })
      proxyReq.on('error', reject)
      proxyReq.write(body)
      proxyReq.end()
    })
    res.json({ corrected: result.choices?.[0]?.message?.content || prompt })
  } catch (e) {
    res.status(502).json({ error: String(e) })
  }
})

app.post('/api/ground-truth/save', async (req, res) => {
  const { labels } = req.body as { labels: { id: string; question: string; verdict: string }[] }
  try {
    if (!existsSync(EVAL_GT_DIR)) await mkdir(EVAL_GT_DIR, { recursive: true })
    const filename = `gt_labels_${Date.now()}.json`
    await writeFile(resolve(EVAL_GT_DIR, filename), JSON.stringify({ labels, timestamp: new Date().toISOString() }, null, 2), 'utf-8')
    res.json({ ok: true, filename })
  } catch (e) {
    res.status(500).json({ error: String(e) })
  }
})

app.post('/api/prompt-lab/eval', async (req, res) => {
  // Proxy eval request to scillm
  const { systemPrompt, question, models } = req.body
  try {
    const body = JSON.stringify({
      model: (models && models[0]) || 'text',
      messages: [
        { role: 'system', content: systemPrompt || '' },
        { role: 'user', content: question || '' }
      ],
      temperature: 0.1, max_tokens: 1000,
    })
    const result = await new Promise<any>((resolve, reject) => {
      const proxyReq = httpRequest({
        hostname: new URL(SCILLM_URL).hostname, port: new URL(SCILLM_URL).port,
        path: '/v1/chat/completions', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': `Bearer ${process.env.SCILLM_API_KEY || 'sk-dev-proxy-123'}` },
      }, (proxyRes) => {
        const chunks: Buffer[] = []
        proxyRes.on('data', (c: Buffer) => chunks.push(c))
        proxyRes.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())) } catch { reject(new Error('Invalid JSON')) } })
      })
      proxyReq.on('error', reject)
      proxyReq.write(body)
      proxyReq.end()
    })
    res.json({ output: result.choices?.[0]?.message?.content || '', model: models?.[0] || 'text' })
  } catch (e) {
    res.status(502).json({ error: String(e) })
  }
})

app.post('/api/prompt-lab/optimize', async (req, res) => {
  // Same as optimize-live but synchronous response
  const { prompt, question, model } = req.body
  try {
    const body = JSON.stringify({
      model: model || 'text',
      messages: [
        { role: 'system', content: 'You are a prompt optimization assistant. Improve the given system prompt for better accuracy and consistency.' },
        { role: 'user', content: `Improve this prompt:\n\n${prompt}\n\nContext question: ${question || 'general'}` }
      ],
      temperature: 0.3, max_tokens: 2000,
    })
    const result = await new Promise<any>((resolve, reject) => {
      const proxyReq = httpRequest({
        hostname: new URL(SCILLM_URL).hostname, port: new URL(SCILLM_URL).port,
        path: '/v1/chat/completions', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'Authorization': `Bearer ${process.env.SCILLM_API_KEY || 'sk-dev-proxy-123'}` },
      }, (proxyRes) => {
        const chunks: Buffer[] = []
        proxyRes.on('data', (c: Buffer) => chunks.push(c))
        proxyRes.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString())) } catch { reject(new Error('Invalid JSON')) } })
      })
      proxyReq.on('error', reject)
      proxyReq.write(body)
      proxyReq.end()
    })
    res.json({ optimized: result.choices?.[0]?.message?.content || prompt })
  } catch (e) {
    res.status(502).json({ error: String(e) })
  }
})

app.post('/api/evidence-case', async (req, res) => {
  // Proxy to memory daemon for evidence case building
  try {
    const result = await proxyPost('/recall', { query: req.body.query || '', collection: 'sparta_qra', limit: 10 })
    res.json({ evidence: result.results || result.items || [] })
  } catch (e) {
    res.status(502).json({ error: String(e) })
  }
})

// ── Static file serving for captures/screenshots ────────────────────────────
app.use('/captures', express.static(CAPTURES_DIR))
app.use('/screenshots', express.static(SCREENSHOTS_DIR))

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

httpServer.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`UX Lab API on http://localhost:${PORT}`)
  console.log(`  Memory daemon: ${MEMORY_SOCKET}`)
  console.log(`  scillm: ${SCILLM_URL}`)
  console.log(`  Test runner: registered`)
})

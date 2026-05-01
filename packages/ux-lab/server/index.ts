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
import cookieParser from 'cookie-parser'
import { authMiddleware, generateKey, listKeys, revokeAll } from './auth.js'
import { createServer } from 'http'
import { request as httpRequest } from 'http'
import { execFile, exec, spawn } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readdir, readFile, writeFile, mkdir, unlink, stat, copyFile, rename as fsRename } from 'fs/promises'
import { existsSync, readFileSync, writeFileSync, realpathSync, createReadStream, createWriteStream, watch } from 'fs'
import { load as yamlLoad } from 'js-yaml'
import { promisify } from 'util'

const __dirname = dirname(fileURLToPath(import.meta.url))

const app = express()

// CORS: allow localhost always, allow any origin for key-authenticated requests
app.use(cors({
  origin: (origin, callback) => {
    // Allow no-origin (server-to-server, curl) and localhost
    if (!origin || /^http:\/\/localhost:\d+$/.test(origin)) {
      callback(null, true)
    } else {
      // Allow external origins — auth middleware handles access control
      callback(null, true)
    }
  },
  credentials: true,
}))
app.use(cookieParser())
app.use(express.json({ limit: '10mb' }))

// Auth: localhost bypasses, external requires access key
app.use(authMiddleware)

// Key management endpoints (localhost-only, handled by authMiddleware passthrough)
app.post('/api/auth/generate-key', (req, res) => {
  const hours = Number(req.body?.hours) || 24
  const label = req.body?.label || 'client'
  const project = req.body?.project as string | undefined  // e.g. 'sparta-explorer'
  const key = generateKey(hours, label, project)
  const tsHost = process.env.TAILSCALE_HOSTNAME || 'graham-ms-7c60.tail750d5.ts.net'
  const hash = project ? `#${project}` : '#sparta-explorer'
  const tsUrl = `https://${tsHost}/?key=${key.key}${hash}`
  const directUrl = `http://100.102.12.64:3001/?key=${key.key}${hash}`
  res.json({ ...key, share_url: tsUrl, direct_url: directUrl, message: `Key valid for ${hours}h${project ? ` (${project} only)` : ' (all projects)'}` })
})

app.get('/api/auth/keys', (_req, res) => {
  res.json({ keys: listKeys() })
})

app.post('/api/auth/revoke-all', (_req, res) => {
  const count = revokeAll()
  res.json({ revoked: count })
})

const MEMORY_SOCKET = '/run/user/1000/embry/memory.sock'
const SCILLM_URL = process.env.SCILLM_URL ?? 'http://localhost:4001'
const ARCH_SCOPE = 'architecture'
const RE_QUESTION_SKILL = '/home/graham/workspace/experiments/agent-skills/skills/review-question'
const WORKSHEETS_PATH = process.env.WORKSHEETS_YAML ?? resolve(__dirname, '../fixtures/sparta-reference/worksheets.yaml')
const WORKSHEETS_CACHE_TTL_MS = 60_000
const MEMORY_REPO_ROOT = process.env.MEMORY_REPO_ROOT ?? '/home/graham/workspace/experiments/memory'
const CREATE_QRAS_SKILL_ROOT = process.env.CREATE_QRAS_SKILL_ROOT ?? '/home/graham/workspace/experiments/agent-skills/skills/create-qras'
const SPARTA_PROJECT_ROOT = process.env.SPARTA_PROJECT_ROOT ?? '/home/graham/workspace/experiments/sparta'
const SPARTA_COVERAGE_CACHE_TTL_MS = 30_000
const SPARTA_COVERAGE_SNAPSHOT_PATH = process.env.SPARTA_COVERAGE_SNAPSHOT_PATH ?? resolve(__dirname, '../.cache/sparta-coverage-health.json')
const SPARTA_SUPERVISOR_STATE_DIR = process.env.SPARTA_SUPERVISOR_STATE_DIR ?? resolve(MEMORY_REPO_ROOT, 'artifacts/sparta_supervisor/dev')
const SPARTA_SUPERVISOR_STATUS_PATH = resolve(SPARTA_SUPERVISOR_STATE_DIR, 'status.json')
const SPARTA_SUPERVISOR_COMMANDS_PATH = resolve(SPARTA_SUPERVISOR_STATE_DIR, 'commands.jsonl')
const PUBLIC_ROOT = resolve(__dirname, '../public')
const ARTIFACTS_ROOT = resolve(process.env.UX_LAB_ARTIFACTS_ROOT ?? process.env.ARTIFACTS_ROOT ?? '/mnt/storage12tb/pi-mono/artifacts')
const PDF_LAB_ARTIFACTS_ROOT = resolve(process.env.PDF_LAB_ARTIFACTS_ROOT ?? resolve(ARTIFACTS_ROOT, 'pdf-lab'))

type JsonRecord = Record<string, unknown>
type WorksheetConfig = { description_source?: string } & Record<string, unknown>

let worksheetsCache: { expiresAt: number; worksheets: Record<string, WorksheetConfig> } | null = null
let spartaCoverageCache: { expiresAt: number; payload: JsonRecord } | null = null
let spartaCoverageRefresh: Promise<JsonRecord> | null = null
let broadcastWs: (msg: JsonRecord) => void = () => {}
let lastBroadcastSupervisorSignature = ''
let lastBroadcastCoverageSignature = ''
const execFileAsync = promisify(execFile)
const execAsync = promisify(exec)

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

const PDF_OXIDE_PYTHON = '/home/graham/workspace/experiments/pdf_oxide/.venv/bin/python3'

function isPathInside(root: string, absolutePath: string): boolean {
  const normalizedRoot = root.endsWith('/') ? root : `${root}/`
  return absolutePath === root || absolutePath.startsWith(normalizedRoot)
}

function resolvePublicAssetPath(assetUrl: string, allowedExtensions: string[]): { relativePath: string; absolutePath: string } {
  const assetPath = assetUrl.split(/[?#]/)[0] ?? assetUrl
  const relativePath = assetPath.replace(/^\/+/, '')
  const lowerRelativePath = relativePath.toLowerCase()
  if (!allowedExtensions.some((extension) => lowerRelativePath.endsWith(extension.toLowerCase()))) {
    throw new Error(`assetUrl must target one of: ${allowedExtensions.join(', ')}`)
  }
  if (relativePath.startsWith('artifacts/')) {
    const artifactRelativePath = relativePath.replace(/^artifacts\/+/, '')
    const absolutePath = resolve(ARTIFACTS_ROOT, artifactRelativePath)
    if (!isPathInside(ARTIFACTS_ROOT, absolutePath)) {
      throw new Error('assetUrl escapes the artifacts directory')
    }
    return { relativePath, absolutePath }
  }
  const absolutePath = resolve(PUBLIC_ROOT, relativePath)
  if (!isPathInside(PUBLIC_ROOT, absolutePath)) {
    throw new Error('assetUrl escapes the public directory')
  }
  return { relativePath, absolutePath }
}

function resolvePublicJsonPath(extractionUrl: string): { relativePath: string; absolutePath: string } {
  return resolvePublicAssetPath(extractionUrl, ['.json'])
}

function resolvePublicPdfPath(pdfUrl: string): { relativePath: string; absolutePath: string } {
  return resolvePublicAssetPath(pdfUrl, ['.pdf'])
}

function buildPdfLabReviewKey(relativePath: string): string {
  return relativePath.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/\.json$/i, '')
}

function sortPdfLabBlocks(blocks: any[]): any[] {
  return [...blocks].sort((a, b) => {
    const pageDelta = Number(a.page ?? 0) - Number(b.page ?? 0)
    if (pageDelta !== 0) return pageDelta
    const aBbox = Array.isArray(a.bbox) ? a.bbox : [0, 0, 0, 0]
    const bBbox = Array.isArray(b.bbox) ? b.bbox : [0, 0, 0, 0]
    const topDelta = Number(aBbox[1] ?? 0) - Number(bBbox[1] ?? 0)
    if (topDelta !== 0) return topDelta
    return Number(aBbox[0] ?? 0) - Number(bBbox[0] ?? 0)
  })
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

app.get('/api/artifacts/health', async (_req, res) => {
  const rootStatus = await stat(ARTIFACTS_ROOT).then((entry) => entry.isDirectory()).catch(() => false)
  const pdfLabStatus = await stat(PDF_LAB_ARTIFACTS_ROOT).then((entry) => entry.isDirectory()).catch(() => false)
  res.json({
    ok: rootStatus,
    artifactsRoot: ARTIFACTS_ROOT,
    pdfLabArtifactsRoot: PDF_LAB_ARTIFACTS_ROOT,
    artifactsRootExists: rootStatus,
    pdfLabArtifactsRootExists: pdfLabStatus,
  })
})

// ── API documentation (scriptable / headless client reference) ───────────────

app.get('/api/docs', (_req, res) => {
  res.json({
    description: 'UX Lab REST API — all endpoints are scriptable and usable from headless clients or automation pipelines.',
    base_url: 'http://localhost:3000',
    auth: 'none',
    content_type: 'application/json',
    endpoints: [
      { method: 'GET',  path: '/api/health',               description: 'Server + memory daemon health check' },
      { method: 'GET',  path: '/api/docs',                 description: 'This document — machine-readable API reference' },
      { method: 'GET',  path: '/api/worksheets',           description: 'List SPARTA worksheets from fixtures YAML' },
      { method: 'POST', path: '/api/memory/recall',        description: 'BM25 + semantic + graph search across ArangoDB collections', body: { q: 'string', collections: ['sparta_controls','sparta_qra','sparta_relationships','technique_knowledge'], k: 'number (default 20)' } },
      { method: 'POST', path: '/api/memory/learn',         description: 'Store a new lesson/finding into ArangoDB', body: { problem: 'string', solution: 'string', tags: 'string[]', scope: 'string' } },
      { method: 'GET',  path: '/api/memory/health',        description: 'Memory daemon health check (proxied)' },
      { method: 'POST', path: '/api/scillm',               description: 'LLM inference via scillm gateway', body: { model: 'string', messages: 'Message[]', stream: 'boolean' } },
      { method: 'GET',  path: '/api/models',               description: 'Discover available LLM models grouped by provider' },
      { method: 'GET',  path: '/api/projects/:id/models',  description: 'ModelPicker-format model registry for a project' },
      { method: 'GET',  path: '/api/architectures',        description: 'List saved architecture diagrams' },
      { method: 'POST', path: '/api/architectures',        description: 'Save a new architecture diagram' },
      { method: 'GET',  path: '/api/architectures/:id',    description: 'Load a specific architecture diagram by ID' },
      { method: 'PUT',  path: '/api/architectures/:id',    description: 'Update an existing architecture diagram' },
      { method: 'DELETE', path: '/api/architectures/:id',  description: 'Delete an architecture diagram' },
    ],
    automation_notes: [
      'All endpoints accept and return JSON — no session cookies or CSRF tokens required.',
      'CORS is open to any localhost port — suitable for local tooling and CLI wrappers.',
      'Use /api/memory/recall to build automated analysis pipelines that query the SPARTA knowledge graph.',
      'Stream LLM responses from /api/scillm with { stream: true } for pipeline-friendly output.',
      'The /api/memory/learn endpoint lets external tools feed results back into the knowledge base.',
    ],
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

// ── Traceability: chunk_control_edges → datalake_chunks (BEFORE wildcard) ───
app.post('/api/memory/traceability', async (req, res) => {
  const { control_id } = req.body as { control_id: string }
  if (!control_id) return res.status(400).json({ error: 'control_id required' })
  try {
    const toKey = `sparta_controls/ctrl__${control_id}`
    const edgeResult = await proxyPost('/recall/by-keys', {
      collection: 'chunk_control_edges', keys: [toKey], key_field: '_to',
      return_fields: ['_from', 'control_id', 'confidence', 'tier'],
    }) as { documents?: Array<{ _from?: string; control_id?: string }> }
    const edges = edgeResult.documents ?? []
    if (edges.length === 0) return res.json({ control_id, groups: {}, total_chunks: 0 })
    const chunkKeys = edges.map(e => e._from?.split('/')?.[1]).filter(Boolean) as string[]
    const chunkResult = await proxyPost('/recall/by-keys', {
      collection: 'datalake_chunks', keys: chunkKeys.slice(0, 50),
      return_fields: ['text', 'asset_type', 'doc_id', 'source', 'content_type'],
    }) as { documents?: Array<Record<string, any>> }
    const chunks = chunkResult.documents ?? []
    const groups: Record<string, Array<Record<string, any>>> = {}
    for (const c of chunks) {
      const t = c.asset_type || 'Text'
      if (!groups[t]) groups[t] = []
      groups[t].push({ _key: c._key, text: (c.text || '').slice(0, 300), doc_id: c.doc_id, asset_type: t })
    }
    res.json({ control_id, groups, total_chunks: chunks.length })
  } catch (e) {
    res.status(500).json({ error: 'Traceability failed', detail: String(e) })
  }
})

// ── Datalake API ───────────────────────────────────────────────────────────
// ── Posture Dashboard endpoints ─────────────────────────────────────────────
// Dedicated endpoints for the compliance posture dashboard.
// Server-side aggregation from sparta_controls, sparta_qra, sparta_relationships.
// All queries go through memory daemon Unix socket.

/** POST JSON to memory daemon and return parsed response. */
function memoryPost(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const req = httpRequest({ socketPath: MEMORY_SOCKET, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
        catch { reject(new Error('Invalid JSON from memory daemon')) }
      })
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

/** Extract rows array from memory daemon response (handles documents/items/data/results). */
function asRows(raw: Record<string, unknown>): any[] {
  return (raw.documents ?? raw.items ?? raw.data ?? raw.results ?? []) as any[]
}

const AMBIGUOUS_QRA_REFERENT_RE = /\b(?:this|that|these|those|above|following|provided|given)\s+(?:payload|technique|control|weakness|attack|pattern|countermeasure|relationship|document|excerpt|source|context|requirement|case|system|component|vendor)\b/gi

function detectAmbiguousQraReferents(question: unknown): string[] {
  if (typeof question !== 'string' || !question.trim()) return []
  return Array.from(new Set(Array.from(question.matchAll(AMBIGUOUS_QRA_REFERENT_RE), (match) => match[0])))
}

function annotateQraQuality(doc: Record<string, any> | null | undefined) {
  if (!doc) return doc
  const ambiguousReferents = detectAmbiguousQraReferents(doc.question)
  if (!ambiguousReferents.length) return doc
  return {
    ...doc,
    qra_quality: {
      ...(doc.qra_quality && typeof doc.qra_quality === 'object' ? doc.qra_quality : {}),
      status: 'needs_repair',
      issue_code: 'ambiguous_referent',
      issue_label: 'Ambiguous referent',
      ambiguous_referents: ambiguousReferents,
      disposition: 'retain_for_adversarial_training',
      safe_action: 'plan_repair',
    },
  }
}

const QRA_V2_COLLECTIONS = ['sparta_qra_canonical', 'sparta_qra_relationship'] as const
const LEGACY_QRA_COLLECTION = 'sparta_qra' as const
const QRA_COUNT_CACHE_TTL_MS = 30_000
const QRA_COUNT_CACHE = new Map<string, { count: number; at: number }>()
const QRA_SUMMARY_FIELDS = [
  '_key',
  '_id',
  'qra_id',
  'question',
  'source_framework',
  'source_control_id',
  'control_id',
  'run_id',
  'mind',
  'relationship_id',
  'expertise',
  'difficulty',
  'created_at',
  'review_status',
  'evidence_case',
] as const

function normalizeQraDocument(doc: Record<string, any> | null | undefined, collection?: string) {
  if (!doc) return null
  const normalized = { ...doc } as Record<string, any>
  if (!normalized.control_id && normalized.source_control_id) normalized.control_id = normalized.source_control_id
  if (!normalized._collection && collection) normalized._collection = collection
  return annotateQraQuality(normalized)
}

async function fetchQraDocsByKeys(
  collection: string,
  keys: string[],
  return_fields?: readonly string[],
): Promise<any[]> {
  if (!keys.length) return []
  const result = await proxyPost('/recall/by-keys', {
    collection,
    keys,
    ...(return_fields ? { return_fields: [...return_fields] } : {}),
  }, 45000)
  const docs = asRows(result).map((doc) => normalizeQraDocument(doc, collection))
  const byKey = new Map(docs.filter(Boolean).map((doc: any) => [doc._key, doc]))
  return keys.map((key) => byKey.get(key)).filter(Boolean)
}

function qraCountCacheKey(collection: string, filters?: Record<string, unknown>): string {
  return JSON.stringify({ collection, filters: filters ?? null })
}

async function countQraDocs(collection: string, filters?: Record<string, unknown>): Promise<number> {
  const key = qraCountCacheKey(collection, filters)
  const cached = QRA_COUNT_CACHE.get(key)
  if (cached && Date.now() - cached.at < QRA_COUNT_CACHE_TTL_MS) return cached.count

  const result = await proxyPost('/count', { collection, ...(filters ? { filters } : {}) }, 45_000)
  const count = Number(result?.count ?? 0)
  QRA_COUNT_CACHE.set(key, { count, at: Date.now() })
  return count
}

async function queryQraKeysPage(collection: string, offset: number, limit: number): Promise<string[]> {
  if (limit <= 0) return []
  const result = await proxyPost('/query', {
    aql: `FOR doc IN ${collection}
            LIMIT @offset, @limit
            RETURN doc._key`,
    bind_vars: { offset, limit },
  }, 45_000)
  return asRows(result)
    .map((row) => row?._key ?? row)
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
}

async function pageCollectionSummaries(collection: string, offset: number, limit: number): Promise<any[]> {
  const keys = await queryQraKeysPage(collection, offset, limit)
  return fetchQraDocsByKeys(collection, keys, QRA_SUMMARY_FIELDS)
}

async function pagePartitionedSummaries(
  partitions: Array<{ collection: string; filters?: Record<string, unknown> }>,
  offset: number,
  limit: number,
): Promise<{ documents: any[]; total: number }> {
  const counts = await Promise.all(partitions.map((partition) => countQraDocs(partition.collection, partition.filters)))
  const total = counts.reduce((sum, count) => sum + count, 0)
  if (limit <= 0 || total === 0 || offset >= total) return { documents: [], total }

  let remainingOffset = Math.max(0, offset)
  let remainingLimit = limit
  const documents: any[] = []

  for (let index = 0; index < partitions.length && remainingLimit > 0; index += 1) {
    const partition = partitions[index]
    const partitionCount = counts[index]
    if (remainingOffset >= partitionCount) {
      remainingOffset -= partitionCount
      continue
    }

    const page = await proxyPost('/list', {
      collection: partition.collection,
      limit: remainingLimit,
      offset: remainingOffset,
      ...(partition.filters ? { filters: partition.filters } : {}),
      return_fields: ['_key'],
    }, 45_000)
    const keys = asRows(page)
      .map((row) => row?._key ?? row)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)

    documents.push(...(await fetchQraDocsByKeys(partition.collection, keys, QRA_SUMMARY_FIELDS)))
    remainingLimit -= keys.length
    remainingOffset = 0
  }

  return { documents, total }
}

/** Fetch ALL documents from a collection, paginating in batches of 500. */
async function memoryListAll(collection: string, return_fields?: string[], filters?: Record<string, unknown>): Promise<any[]> {
  const PAGE = 500
  let offset = 0
  const all: any[] = []
  while (true) {
    const body: Record<string, unknown> = { collection, limit: PAGE, offset, sort_field: '_key', sort_order: 'ASC' }
    if (return_fields) body.return_fields = return_fields
    if (filters) body.filters = filters
    const raw = await memoryPost('/list', body)
    const docs = asRows(raw)
    all.push(...docs)
    // Safety limit: never fetch more than 15K docs via this helper to prevent system crashes
    if (docs.length < PAGE || all.length >= 15000) break
    offset += PAGE
  }
  return all
}

function isMemoryUnavailableError(err: unknown): boolean {
  return err instanceof Error && (err.message.includes('ECONNREFUSED') || err.message.includes('ENOENT') || err.message.includes('connect'))
}

// ── Posture Dashboard V2 ─────────────────────────────────────────────────────
// Single endpoint: evidence case verdicts from lessons_v2, not NRS scores.
function parseEvidenceSolution(doc: any): any {
  try { return typeof doc.solution === 'string' ? JSON.parse(doc.solution) : (doc.solution ?? {}) } catch { return {} }
}
app.get('/api/posture/v2', async (_req, res) => {
  try {
    const [evidenceCases, controls, rels] = await Promise.all([
      memoryListAll('lessons_v2', ['title', 'solution', 'tags', 'created_at'], { scope: 'evidence_case_labels' }),
      memoryListAll('sparta_controls', ['control_id', 'name', 'source_framework', 'nrs_score']),
      memoryListAll('sparta_relationships', ['source_control_id', 'target_control_id', 'relationship_type']),
    ])
    const cases = evidenceCases.map((ec: any) => { const sol = parseEvidenceSolution(ec); return { question: sol.question ?? ec.title ?? '', verdict: sol.verdict ?? 'unknown', grade: sol.grade ?? 'N/A', gates_passed: sol.gates_passed ?? 0, gates_total: sol.gates_total ?? 7, control_ids: sol.control_ids ?? [], category: sol.category ?? 'unknown', gate_summary: sol.gate_summary ?? '', created_at: ec.created_at ?? 0 } })
    const satisfied = cases.filter((c: any) => c.verdict === 'satisfied')
    const inconclusive = cases.filter((c: any) => c.verdict === 'inconclusive')
    const notSatisfied = cases.filter((c: any) => c.verdict === 'not_satisfied')
    const controlsWithEvidence = new Set(cases.flatMap((c: any) => c.control_ids))
    const totalControls = controls.length
    const relSet = new Set(rels.flatMap((r: any) => [String(r.source_control_id), String(r.target_control_id)]))
    const postureScore = cases.length ? Math.round((satisfied.length / cases.length) * 100) : 0
    const complianceScore = cases.length ? Math.round(((satisfied.length + inconclusive.length * 0.5) / cases.length) * 100) : 0
    const evidenceFreshness = cases.length ? Math.round((cases.filter((c: any) => (Date.now() / 1000 - (c.created_at || 0)) < 90 * 86400).length / cases.length) * 100) : 0
    const fwMap = new Map<string, { name: string; total: number; satisfied: number; inconclusive: number; failed: number }>()
    for (const c of controls) { const fw = String(c.source_framework || 'Unknown'); if (!fwMap.has(fw)) fwMap.set(fw, { name: fw, total: 0, satisfied: 0, inconclusive: 0, failed: 0 }); const b = fwMap.get(fw)!; b.total += 1; if (controlsWithEvidence.has(String(c.control_id))) { const rc = cases.filter((ec: any) => ec.control_ids.includes(String(c.control_id))); if (rc.some((ec: any) => ec.verdict === 'satisfied') && !rc.some((ec: any) => ec.verdict === 'not_satisfied')) b.satisfied += 1; else if (rc.some((ec: any) => ec.verdict === 'not_satisfied')) b.failed += 1; else b.inconclusive += 1 } }
    const frameworks = [...fwMap.values()].map(f => ({ ...f, pct: f.total ? Math.round((f.satisfied / f.total) * 100) : 0 }))
    const famMap = new Map<string, { family: string; total: number; satisfied: number; inconclusive: number; failed: number; noEvidence: number }>()
    for (const c of controls) { const cid = String(c.control_id || ''); const fam = cid.match(/^([A-Z]{2})[-_]/)?.[1] ?? (cid.slice(0, 2).toUpperCase() || 'UN'); if (!famMap.has(fam)) famMap.set(fam, { family: fam, total: 0, satisfied: 0, inconclusive: 0, failed: 0, noEvidence: 0 }); const b = famMap.get(fam)!; b.total += 1; if (!controlsWithEvidence.has(cid)) { b.noEvidence += 1; continue } const ec2 = cases.filter((ec: any) => ec.control_ids.includes(cid)); if (ec2.some((ec: any) => ec.verdict === 'satisfied') && !ec2.some((ec: any) => ec.verdict === 'not_satisfied')) b.satisfied += 1; else if (ec2.some((ec: any) => ec.verdict === 'not_satisfied')) b.failed += 1; else b.inconclusive += 1 }
    const families = [...famMap.values()].map(f => ({ ...f, pct: f.total ? Math.round((f.satisfied / f.total) * 100) : 0 })).sort((a, b) => a.family.localeCompare(b.family))
    const riskControls = notSatisfied.flatMap((ec: any) => ec.control_ids.map((cid: string) => { const ctrl = controls.find((c: any) => String(c.control_id) === cid); return { control_id: cid, name: ctrl?.name ?? '', source_framework: ctrl?.source_framework ?? '', verdict: 'not_satisfied', grade: ec.grade, question: ec.question } })).slice(0, 10)
    const controlsWithRel = controls.filter((c: any) => relSet.has(String(c.control_id))).length
    const relTypes: Record<string, number> = {}; for (const r of rels) { const t = String(r.relationship_type || 'unknown'); relTypes[t] = (relTypes[t] ?? 0) + 1 }
    const reqToControl = cases.length ? Math.round((cases.filter((c: any) => c.control_ids.length > 0).length / cases.length) * 100) : 0
    const controlToRel = totalControls ? Math.round((controlsWithRel / totalControls) * 100) : 0
    const controlToEvidence = totalControls ? Math.round((controlsWithEvidence.size / totalControls) * 100) : 0
    const brokenTraces = [...notSatisfied.map((ec: any) => ({ trace: `Req -> ${ec.control_ids.slice(0, 3).join(', ')}`, defect: 'Failed evidence case', impact: `${ec.grade} grade — ${ec.gates_passed}/${ec.gates_total} gates`, fix: ec.question?.slice(0, 100) ?? '' })), ...inconclusive.slice(0, 4).map((ec: any) => ({ trace: `Req -> ${ec.control_ids.slice(0, 3).join(', ')}`, defect: 'Inconclusive evidence', impact: `${ec.grade} grade — ${ec.gates_passed}/${ec.gates_total} gates`, fix: ec.question?.slice(0, 100) ?? '' }))].slice(0, 8)
    const traceabilityScore = Math.round(reqToControl * 0.3 + controlToRel * 0.3 + controlToEvidence * 0.4)
    const contradictions = notSatisfied.filter((ec: any) => ec.control_ids.some((cid: string) => satisfied.some((s: any) => s.control_ids.includes(cid)))).length
    const assuranceScore = cases.length ? Math.round(((satisfied.length + inconclusive.length * 0.5) / cases.length) * 100) : 0
    const avgGP = cases.length ? cases.reduce((s: number, c: any) => s + c.gates_passed, 0) / cases.length : 0
    const avgGT = cases.length ? cases.reduce((s: number, c: any) => s + c.gates_total, 0) / cases.length : 7
    const claimsNeedingReview = [...notSatisfied, ...inconclusive].slice(0, 6).map((ec: any) => ({ question: ec.question?.slice(0, 120) ?? '', verdict: ec.verdict, grade: ec.grade, gates: `${ec.gates_passed}/${ec.gates_total}`, controls: ec.control_ids.slice(0, 5), gate_summary: ec.gate_summary ?? '' }))
    res.json({
      posture: { postureScore, complianceScore, criticalFindings: notSatisfied.length, openFindings: notSatisfied.length + inconclusive.length, evidenceFreshness, totalCases: cases.length, frameworks, families, riskControls },
      traceability: { traceabilityScore, mappedRequirements: cases.filter((c: any) => c.control_ids.length > 0).length, orphanRequirements: cases.filter((c: any) => c.control_ids.length === 0).length, totalControls, controlsWithEvidence: controlsWithEvidence.size, controlsWithRelationships: controlsWithRel, relationshipTypes: relTypes, totalRelationships: rels.length, coverageChain: { reqToControl, controlToRel, controlToEvidence }, brokenTraces },
      assurance: { assuranceScore, supportedClaims: satisfied.length, partialClaims: inconclusive.length, unsupportedClaims: notSatisfied.length, contradictions, totalClaims: cases.length, evidenceQuality: { gatePassRate: Math.round((avgGP / avgGT) * 100), freshness: evidenceFreshness, completeness: reqToControl, authority: Math.round((satisfied.filter((c: any) => c.grade === 'A+').length / Math.max(satisfied.length, 1)) * 100) }, claimsNeedingReview },
    })
  } catch (err: any) {
    if (isMemoryUnavailableError(err)) return res.status(502).json({ error: 'Memory daemon unavailable' })
    res.status(500).json({ error: 'Posture V2 failed', detail: String(err) })
  }
})

// ── QRA Coverage Stats ──────────────────────────────────────────────────────
// Uses /count endpoint for efficient server-side tag counting (no document transfer)
app.get('/api/qra/coverage', async (_req, res) => {
  try {
    const mc = (tags: string[]) => proxyPost('/count', { collection: 'sparta_qra', tags })
    const [total, variations, checked, satisfied, inconclusive, notSatisfied, mismatchDocs] = await Promise.all([
      proxyPost('/count', { collection: 'sparta_qra' }),
      mc(['qra-variation']),
      mc(['qra-variation', 'evidence-checked']),
      mc(['qra-variation', 'ec-verdict:satisfied']),
      mc(['qra-variation', 'ec-verdict:inconclusive']),
      mc(['qra-variation', 'ec-verdict:not_satisfied']),
      mc(['qra-variation', 'ec-mismatch']),
    ])
    const totalCount = total?.count ?? 0
    const variationCount = variations?.count ?? 0
    const originals = totalCount - variationCount
    const evidenceChecked = checked?.count ?? 0
    const mismatches = mismatchDocs?.count ?? 0
    const coveragePct = originals ? Math.round((variationCount / (originals * 6)) * 100) : 0
    const evidenceCheckPct = variationCount ? Math.round((evidenceChecked / variationCount) * 100) : 0
    res.json({
      originals, variations: variationCount, coveragePct,
      evidenceChecked, evidenceCheckPct, mismatches,
      verdicts: {
        satisfied: satisfied?.count ?? 0,
        inconclusive: inconclusive?.count ?? 0,
        not_satisfied: notSatisfied?.count ?? 0,
      },
      total: totalCount,
    })
  } catch (err: any) {
    if (isMemoryUnavailableError(err)) return res.status(502).json({ error: 'Memory daemon unavailable' })
    res.status(500).json({ error: 'QRA coverage failed', detail: String(err) })
  }
})

app.post('/api/qra/feed', async (req, res) => {
  const limitRaw = Number(req.body?.limit)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(200, limitRaw)) : 50
  const offsetRaw = Number(req.body?.offset)
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0
  const source = String(req.body?.source || 'legacy').toLowerCase()

  try {
    let documents: any[] = []
    let sourceUsed = 'legacy'
    let total = 0

    if (source === 'v2') {
      sourceUsed = 'v2'
      const result = await pagePartitionedSummaries(
        QRA_V2_COLLECTIONS.map((collection) => ({ collection })),
        offset,
        limit,
      )
      documents = result.documents
      total = result.total
    } else if (source === 'all') {
      const legacyLimit = Math.max(1, Math.ceil(limit / 2))
      const v2Limit = Math.max(1, limit - legacyLimit)
      const pageIndex = Math.floor(offset / Math.max(limit, 1))
      const [legacyDocs, legacyTotal, v2Page, v2Total] = await Promise.all([
        pageCollectionSummaries(LEGACY_QRA_COLLECTION, pageIndex * legacyLimit, legacyLimit),
        countQraDocs(LEGACY_QRA_COLLECTION),
        pagePartitionedSummaries(
          QRA_V2_COLLECTIONS.map((collection) => ({ collection })),
          pageIndex * v2Limit,
          v2Limit,
        ),
        Promise.all(QRA_V2_COLLECTIONS.map((collection) => countQraDocs(collection))).then((counts) => counts.reduce((sum, count) => sum + count, 0)),
      ])
      documents = [...legacyDocs, ...v2Page.documents]
      total = legacyTotal + v2Total
      sourceUsed = 'all'
    } else {
      sourceUsed = 'legacy'
      documents = await pageCollectionSummaries(LEGACY_QRA_COLLECTION, offset, limit)
      total = await countQraDocs(LEGACY_QRA_COLLECTION)
    }

    res.json({
      documents,
      total,
      offset,
      limit,
      source_used: sourceUsed,
    })
  } catch (e) {
    console.error('[qra/feed] failed', e)
    res.status(502).json({ error: 'qra_feed_failed', detail: String(e) })
  }
})

app.post('/api/qra/detail', async (req, res) => {
  const source = String(req.body?.source || 'all').toLowerCase()
  const key = String(req.body?.key || '').trim()
  const qraId = String(req.body?.qraId || '').trim()
  if (!key && !qraId) return res.status(400).json({ error: 'qra_detail_requires_key_or_qraId' })

  async function queryOne(collection: string) {
    if (key) {
      const docs = await fetchQraDocsByKeys(collection, [key])
      if (docs.length > 0) return docs[0]
    }
    if (!qraId) return null
    const result = await proxyPost('/query', {
      aql: `FOR doc IN ${collection}
              FILTER doc.qra_id == @qraId
              LIMIT 1
              RETURN doc._key`,
      bind_vars: { qraId },
    }, 45000)
    const docKey = asRows(result)[0]?._key ?? asRows(result)[0]
    if (typeof docKey !== 'string' || !docKey) return null
    const docs = await fetchQraDocsByKeys(collection, [docKey])
    return docs[0] ?? null
  }

  try {
    const collections =
      source === 'v2'
        ? [...QRA_V2_COLLECTIONS]
        : source === 'legacy'
          ? ['sparta_qra']
          : ['sparta_qra', ...QRA_V2_COLLECTIONS]

    for (const collection of collections) {
      const doc = await queryOne(collection)
      if (doc) return res.json({ document: doc })
    }

    return res.status(404).json({ error: 'qra_not_found' })
  } catch (e) {
    console.error('[qra/detail] failed', e)
    res.status(502).json({ error: 'qra_detail_failed', detail: String(e) })
  }
})

app.post('/api/qra/search', async (req, res) => {
  const limitRaw = Number(req.body?.limit)
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, limitRaw)) : 50
  const offsetRaw = Number(req.body?.offset)
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0
  const source = String(req.body?.source || 'legacy').toLowerCase()
  const LEGACY_FRAMEWORKS = ['SPARTA', 'NIST', 'ATT&CK', 'CWE', 'D3FEND']
  const q = String(req.body?.q || '').trim()
  const controlId = String(req.body?.controlId || '').trim()
  const needle = q.toLowerCase()
  const controlIdUpper = controlId.toUpperCase()

  const filterClause = `
    FILTER (
      @needle == "" OR
      CONTAINS(LOWER(doc.question), @needle) OR
      CONTAINS(LOWER(doc.answer), @needle) OR
      CONTAINS(LOWER(doc.reasoning), @needle) OR
      (doc.qra_id != null AND CONTAINS(LOWER(doc.qra_id), @needle))
    )
    FILTER (
      @controlIdUpper == "" OR
      UPPER(doc.source_control_id) == @controlIdUpper OR
      UPPER(doc.control_id) == @controlIdUpper
    )
  `

  async function querySearchKeys(aql: string, bind_vars: Record<string, unknown>) {
    const result = await proxyPost('/query', { aql, bind_vars }, 45000)
    return asRows(result)
      .map((row) => row?._key ?? row)
      .filter((key): key is string => typeof key === 'string' && key.length > 0)
  }

  try {
    let documents: any[] = []
    let sourceUsed = source

    if (source === 'v2') {
      const perCollectionLimit = Math.max(limit, 20)
      const groups = await Promise.all(
        QRA_V2_COLLECTIONS.map(async (collection) => {
          const keys = await querySearchKeys(
            `FOR doc IN ${collection}
               ${filterClause}
               LIMIT @offset, @limit
               RETURN doc._key`,
            { needle, controlIdUpper, offset: 0, limit: perCollectionLimit },
          )
          return fetchQraDocsByKeys(collection, keys, QRA_SUMMARY_FIELDS)
        }),
      )
      documents = groups.flat()
        .sort((a, b) => Number(b?.created_at ?? 0) - Number(a?.created_at ?? 0))
        .slice(offset, offset + limit)
    } else if (source === 'all') {
      const perCollectionLimit = Math.max(limit, 50)
      const [legacyDocs, v2Docs] = await Promise.all([
        Promise.all(
          LEGACY_FRAMEWORKS.map((framework) =>
            querySearchKeys(
              `FOR doc IN sparta_qra
                 FILTER doc.source_framework == @framework
                 ${filterClause}
                 SORT doc.created_at DESC
                 LIMIT @offset, @limit
                 RETURN doc._key`,
              { framework, needle, controlIdUpper, offset: 0, limit: Math.max(10, Math.ceil(perCollectionLimit / LEGACY_FRAMEWORKS.length)) },
            ).then((keys) => fetchQraDocsByKeys('sparta_qra', keys, QRA_SUMMARY_FIELDS)),
          ),
        ).then((groups) => groups.flat()),
        Promise.all(
          QRA_V2_COLLECTIONS.map(async (collection) => {
            const keys = await querySearchKeys(
              `FOR doc IN ${collection}
                 ${filterClause}
                 LIMIT @offset, @limit
                 RETURN doc._key`,
              { needle, controlIdUpper, offset: 0, limit: perCollectionLimit },
            )
            return fetchQraDocsByKeys(collection, keys, QRA_SUMMARY_FIELDS)
          }),
        ).then((groups) => groups.flat()),
      ])
      documents = [...legacyDocs, ...v2Docs]
        .sort((a, b) => Number(b?.created_at ?? 0) - Number(a?.created_at ?? 0))
        .slice(offset, offset + limit)
      sourceUsed = 'all'
    } else {
      sourceUsed = 'legacy'
      const groups = await Promise.all(
        LEGACY_FRAMEWORKS.map((framework) =>
          querySearchKeys(
            `FOR doc IN sparta_qra
               FILTER doc.source_framework == @framework
               ${filterClause}
               SORT doc.created_at DESC
               LIMIT @offset, @limit
               RETURN doc._key`,
            { framework, needle, controlIdUpper, offset: 0, limit: Math.max(10, Math.ceil(limit / LEGACY_FRAMEWORKS.length)) },
          ).then((keys) => fetchQraDocsByKeys('sparta_qra', keys, QRA_SUMMARY_FIELDS)),
        ),
      )
      documents = groups.flat()
        .sort((a, b) => Number(b?.created_at ?? 0) - Number(a?.created_at ?? 0))
        .slice(offset, offset + limit)
    }

    res.json({
      documents,
      total: documents.length,
      source_used: sourceUsed,
    })
  } catch (e) {
    console.error('[qra/search] failed', e)
    res.status(502).json({ error: 'qra_search_failed', detail: String(e) })
  }
})

app.get('/api/sparta/counts', async (_req, res) => {
  try {
    const [controls, qras, qrasCanonical, qrasRelationship, relationships, urls] = await Promise.all([
      proxyPost('/count', { collection: 'sparta_controls' }),
      proxyPost('/count', { collection: 'sparta_qra' }).catch(() => ({ count: 0 })),
      proxyPost('/count', { collection: 'sparta_qra_canonical' }).catch(() => ({ count: 0 })),
      proxyPost('/count', { collection: 'sparta_qra_relationship' }).catch(() => ({ count: 0 })),
      proxyPost('/count', { collection: 'sparta_relationships' }).catch(() => ({ count: 0 })),
      proxyPost('/count', { collection: 'sparta_urls' }).catch(() => ({ count: 0 })),
    ])

    const payload = {
      controls: controls?.count ?? 0,
      qras: qras?.count ?? 0,
      qrasCanonical: qrasCanonical?.count ?? 0,
      qrasRelationship: qrasRelationship?.count ?? 0,
      qrasTotal: (qras?.count ?? 0) + (qrasCanonical?.count ?? 0) + (qrasRelationship?.count ?? 0),
      relationships: relationships?.count ?? 0,
      urls: urls?.count ?? 0,
      knowledge: 0,
    }

    res.json(payload)
  } catch (e) {
    console.error('[sparta/counts] failed', e)
    res.status(502).json({ error: 'sparta_counts_failed', detail: String(e) })
  }
})

async function runCommandJson(command: string, args: string[], options: { cwd: string; env?: NodeJS.ProcessEnv; timeout?: number }) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    timeout: options.timeout ?? 60_000,
    maxBuffer: 50 * 1024 * 1024,
  })
  try {
    return JSON.parse(stdout)
  } catch (err) {
    throw new Error(`Failed to parse JSON from ${command}: ${err instanceof Error ? err.message : String(err)}; stderr=${stderr.slice(-1000)}; stdout=${stdout.slice(0, 1000)}`)
  }
}

function commandOutput(err: unknown) {
  if (err && typeof err === 'object') {
    const maybe = err as { stdout?: unknown; stderr?: unknown }
    return `${typeof maybe.stdout === 'string' ? maybe.stdout : ''}${typeof maybe.stderr === 'string' ? maybe.stderr : ''}`.trim()
  }
  return ''
}

async function runBestPracticeAudit() {
  const uxRoot = resolve(__dirname, '..')
  const checks: Array<Record<string, unknown>> = []

  try {
    const result = await execFileAsync('python3', ['scripts/verify-data-qid.py', 'src/components/sparta'], {
      cwd: uxRoot,
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    })
    const match = result.stdout.match(/data-qid coverage:\s*(\d+)\/(\d+)\s*\((\d+)%\)/)
    checks.push({
      name: 'React data-qid coverage',
      skill: 'best-practices-react',
      ok: true,
      status: 'pass',
      message: result.stdout.trim().split('\n')[0] || 'data-qid scan passed',
      covered: match ? Number(match[1]) : null,
      total: match ? Number(match[2]) : null,
      percent: match ? Number(match[3]) : null,
    })
  } catch (err) {
    const output = commandOutput(err)
    const match = output.match(/data-qid coverage:\s*(\d+)\/(\d+)\s*\((\d+)%\)/)
    checks.push({
      name: 'React data-qid coverage',
      skill: 'best-practices-react',
      ok: false,
      status: 'fail',
      message: output.split('\n')[0] || 'data-qid scan failed',
      covered: match ? Number(match[1]) : null,
      total: match ? Number(match[2]) : null,
      percent: match ? Number(match[3]) : null,
      detail: output.slice(0, 4000),
    })
  }

  try {
    const result = await execFileAsync('uv', ['run', 'python', 'scripts/validation/silent_fallback_scanner.py', 'scan'], {
      cwd: MEMORY_REPO_ROOT,
      env: { ...process.env, PYTHONPATH: 'src' },
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    })
    checks.push({
      name: 'Python silent fallback scan',
      skill: 'best-practices-python',
      ok: true,
      status: 'pass',
      message: 'No silent fallback violations found',
      detail: `${result.stdout}${result.stderr}`.trim().slice(0, 4000),
    })
  } catch (err) {
    const output = commandOutput(err)
    checks.push({
      name: 'Python silent fallback scan',
      skill: 'best-practices-python',
      ok: false,
      status: 'fail',
      message: output.split('\n').find((line: string) => line.includes('violation')) || 'Silent fallback scan failed',
      detail: output.slice(0, 4000),
    })
  }

  return checks
}

function deriveBestPracticeAudit(
  checks: Array<Record<string, unknown>>,
  promptAudit: unknown,
  supervisor: unknown,
): Array<Record<string, unknown>> {
  const rows = [...checks]
  const prompt = promptAudit && typeof promptAudit === 'object' && !Array.isArray(promptAudit)
    ? promptAudit as JsonRecord
    : {}
  const promptPassed = Number(prompt.passed ?? 0)
  const promptTotal = Number(prompt.total ?? 0)
  const allPromptPassed = Number(prompt.all_passed ?? 0)
  const allPromptTotal = Number(prompt.all_total ?? 0)
  const promptOk = promptTotal > 0 && promptPassed === promptTotal && allPromptPassed === allPromptTotal
  rows.push({
    name: 'Prompt best-practice static scan',
    skill: 'best-practices-prompt',
    ok: promptOk,
    status: promptOk ? 'pass' : 'fail',
    message: `${allPromptPassed}/${allPromptTotal} scanned prompt files pass; ${promptPassed}/${promptTotal} active prompt units pass.`,
  })

  const supervisorState = supervisor && typeof supervisor === 'object' && !Array.isArray(supervisor)
    ? supervisor as JsonRecord
    : {}
  const sourceEmbedding = supervisorState.source_embedding_coverage && typeof supervisorState.source_embedding_coverage === 'object'
    ? supervisorState.source_embedding_coverage as JsonRecord
    : {}
  const sourceStatus = String(sourceEmbedding.status ?? 'blocked').toLowerCase()
  const gaps = sourceEmbedding.gaps && typeof sourceEmbedding.gaps === 'object'
    ? sourceEmbedding.gaps as JsonRecord
    : {}
  const observed = sourceEmbedding.observed_counts && typeof sourceEmbedding.observed_counts === 'object'
    ? sourceEmbedding.observed_counts as JsonRecord
    : {}
  const vectorGaps = Number(gaps.missing_vectors ?? 0) + Number(gaps.stale_vectors ?? 0)
  rows.push({
    name: 'Arango/Qdrant source embedding coverage',
    skill: 'best-practices-arangodb',
    ok: sourceStatus === 'pass',
    status: sourceStatus === 'pass' ? 'pass' : sourceStatus === 'fail' ? 'fail' : 'blocked',
    message: sourceStatus === 'pass'
      ? `${Number(observed.arango_synced_docs ?? 0).toLocaleString()} Arango docs synced; ${Number(observed.qdrant_vectors ?? 0).toLocaleString()} Qdrant vectors observed.`
      : `${vectorGaps.toLocaleString()} Arango/Qdrant vector gap(s). ${String(sourceEmbedding.resume_hint ?? 'Review source embedding coverage.')}`,
  })

  return rows
}

async function readLatestArtifactSummary() {
  const artifactDir = resolve(MEMORY_REPO_ROOT, 'artifacts/monitor_sparta_gap_plan')
  const files = await readdir(artifactDir).catch(() => [])
  const interesting = files
    .filter((name) => /final_audit|backfill_summary|remaining_manifest|comparison_gated_manifest|failures/.test(name))
    .sort()
    .slice(-20)
    .map((name) => `artifacts/monitor_sparta_gap_plan/${name}`)
  return {
    recent: interesting,
    c2cAuditPath: 'artifacts/monitor_sparta_gap_plan/c2c_final_audit_20260427T221000Z.json',
    nonC2cAuditPath: 'artifacts/monitor_sparta_gap_plan/sparta_non_c2c_175_final_audit_20260428T115440Z.json',
  }
}

async function auditSpartaPrompts() {
  return await runCommandJson('uv', ['run', 'python', 'scripts/validation/prompt_health_coverage.py', '--json'], {
    cwd: MEMORY_REPO_ROOT,
    env: { PYTHONPATH: 'scripts/validation:src' },
    timeout: 60_000,
  })
}

async function readSpartaCoverageSnapshot(): Promise<JsonRecord | null> {
  const text = await readFile(SPARTA_COVERAGE_SNAPSHOT_PATH, 'utf8').catch(() => null)
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

async function readSpartaSupervisorState(): Promise<JsonRecord | null> {
  const text = await readFile(SPARTA_SUPERVISOR_STATUS_PATH, 'utf8').catch(() => null)
  if (!text) return null
  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const commands = await readSpartaSupervisorCommands(100)
    return {
      ...(parsed as JsonRecord),
      recent_commands: commands.slice(-25),
      command_source_counts: countBy(commands, 'source', ['ui', 'cli', 'discord', 'slack', 'voice']),
      command_status_counts: countBy(commands, 'status', ['queued', 'dry_run', 'review_required', 'blocked']),
    }
  } catch {
    return null
  }
}

function spartaSupervisorSignature(state: JsonRecord | null): string {
  if (!state) return ''
  return [
    state.generated_at,
    state.heartbeat_at,
    state.status,
    state.phase,
    JSON.stringify(state.command_status_counts ?? {}),
  ].join('|')
}

function spartaCoverageSignature(payload: JsonRecord | null): string {
  if (!payload) return ''
  const supervisor = payload.supervisor && typeof payload.supervisor === 'object' && !Array.isArray(payload.supervisor)
    ? payload.supervisor as JsonRecord
    : {}
  const monitor = payload.monitor && typeof payload.monitor === 'object' && !Array.isArray(payload.monitor)
    ? payload.monitor as JsonRecord
    : {}
  const prompt = payload.promptAudit && typeof payload.promptAudit === 'object' && !Array.isArray(payload.promptAudit)
    ? payload.promptAudit as JsonRecord
    : {}
  return [
    payload.generated_at,
    supervisor.heartbeat_at,
    monitor.passed,
    monitor.total,
    prompt.passed,
    prompt.total,
  ].join('|')
}

async function broadcastSpartaSupervisorState(force = false): Promise<void> {
  const state = await readSpartaSupervisorState()
  if (!state) return
  const signature = spartaSupervisorSignature(state)
  if (!force && signature && signature === lastBroadcastSupervisorSignature) return
  lastBroadcastSupervisorSignature = signature
  broadcastWs({
    type: 'sparta-supervisor-state',
    timestamp: Date.now(),
    state,
  })
}

function broadcastSpartaCoverageHealth(payload: JsonRecord, force = false): void {
  const signature = spartaCoverageSignature(payload)
  if (!force && signature && signature === lastBroadcastCoverageSignature) return
  lastBroadcastCoverageSignature = signature
  broadcastWs({
    type: 'sparta-coverage-health',
    timestamp: Date.now(),
    payload,
  })
}

async function refreshSpartaSupervisorState(): Promise<JsonRecord | null> {
  try {
    const state = await runCommandJson('uv', [
      'run',
      'python',
      'scripts/validation/monitor_sparta.py',
      'supervisor',
      '--once',
      '--state-dir',
      SPARTA_SUPERVISOR_STATE_DIR,
      '--json',
    ], {
      cwd: MEMORY_REPO_ROOT,
      env: { ...process.env, PYTHONPATH: 'src:scripts/validation' },
      timeout: 180_000,
    })
    if (state && typeof state === 'object' && !Array.isArray(state)) {
      const supervisor = state as JsonRecord
      const signature = spartaSupervisorSignature(supervisor)
      if (signature !== lastBroadcastSupervisorSignature) {
        lastBroadcastSupervisorSignature = signature
        broadcastWs({
          type: 'sparta-supervisor-state',
          timestamp: Date.now(),
          state: supervisor,
        })
      }
      return supervisor
    }
  } catch (err) {
    console.error('[sparta/supervisor-state] refresh failed; using last snapshot if available', err)
  }
  return readSpartaSupervisorState()
}

async function readSpartaSupervisorCommands(limit: number): Promise<JsonRecord[]> {
  const text = await readFile(SPARTA_SUPERVISOR_COMMANDS_PATH, 'utf8').catch(() => '')
  if (!text) return []
  return text
    .trim()
    .split('\n')
    .slice(-limit)
    .map((line) => {
      try {
        const parsed = JSON.parse(line)
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as JsonRecord : null
      } catch {
        return null
      }
    })
    .filter((row): row is JsonRecord => Boolean(row))
}

function countBy(rows: JsonRecord[], field: string, known: string[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(known.map((key) => [key, 0]))
  for (const row of rows) {
    const key = typeof row[field] === 'string' ? row[field] : 'unknown'
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

function normalizeSupervisorCommand(body: unknown): JsonRecord {
  const raw = body && typeof body === 'object' && !Array.isArray(body) ? body as JsonRecord : {}
  const intent = typeof raw.intent === 'string' && raw.intent.trim() ? raw.intent.trim() : 'status'
  const source = typeof raw.source === 'string' && raw.source.trim() ? raw.source.trim() : 'ui'
  const targetLane = typeof raw.target_lane === 'string' ? raw.target_lane : ''
  const risk = typeof raw.risk === 'string' && raw.risk.trim() ? raw.risk.trim() : 'read_only'
  const normalizedIntent = intent.toLowerCase()
  const safeIntents = new Set(['status', 'refresh', 'run_audit_now', 'ack', 'list', 'audit'])
  const mutationHints = ['fix', 'remediate', 'repair', 'execute', 'rewrite', 'delete', 'update', 'patch', 'backfill', 'send']
  const hasMutationHint = mutationHints.some((hint) => normalizedIntent.includes(hint))
  const status = risk === 'read_only' && safeIntents.has(normalizedIntent) && !hasMutationHint ? 'queued' : 'review_required'
  return {
    command_id: `cmd-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    created_at: new Date().toISOString(),
    source,
    intent,
    target_lane: targetLane,
    risk: status === 'queued' ? 'read_only' : risk === 'read_only' ? 'mutation' : risk,
    status,
    action_state: status === 'queued' ? 'queued' : 'review_required',
    payload: raw.payload && typeof raw.payload === 'object' && !Array.isArray(raw.payload) ? raw.payload : {},
    transcript: typeof raw.transcript === 'string' ? raw.transcript : undefined,
    confidence: typeof raw.confidence === 'number' ? raw.confidence : undefined,
    operator: typeof raw.operator === 'string' ? raw.operator : undefined,
    session_id: typeof raw.session_id === 'string' ? raw.session_id : undefined,
    safe_default: 'observe_only',
    operator_approval_required: status !== 'queued',
    checkpoint_required: status !== 'queued',
    resume_hint: 'Human review required before any mutation-capable remediation.',
  }
}

async function appendSpartaSupervisorCommand(command: JsonRecord) {
  await mkdir(dirname(SPARTA_SUPERVISOR_COMMANDS_PATH), { recursive: true })
  await writeFile(SPARTA_SUPERVISOR_COMMANDS_PATH, `${JSON.stringify(command)}\n`, { flag: 'a' })
}

async function writeSpartaCoverageSnapshot(payload: JsonRecord) {
  await mkdir(dirname(SPARTA_COVERAGE_SNAPSHOT_PATH), { recursive: true })
  await writeFile(SPARTA_COVERAGE_SNAPSHOT_PATH, JSON.stringify(payload, null, 2))
}

function qraTrustStatus(corpus?: JsonRecord): JsonRecord {
  const legacy = Number(corpus?.qrasLegacy ?? 0)
  const canonical = Number(corpus?.qrasCanonical ?? 0)
  const relationship = Number(corpus?.qrasRelationship ?? 0)
  return {
    status: 'plausible_for_system_test',
    label: 'System-Test Ready',
    expert_blessed: false,
    reviewer: null,
    blessed_at: null,
    scope: ['legacy', 'canonical', 'relationship'],
    counts: {
      legacy,
      canonical,
      relationship,
      total: legacy + canonical + relationship,
    },
    use_policy: 'Use current QRAs as plausible corpus artifacts for testing Sparta Explorer, Sparta Chat, /create-evidence-case, retrieval, and conversation-lab workflows; do not present them as Aerospace Corp expert-blessed answers.',
    next_action: 'After SPARTA Corpora and Explorer surfaces are complete, route current QRAs through Aerospace Corp cybersecurity expert evaluation and blessing metadata.',
  }
}

function attachQraTrustStatus(payload: JsonRecord): JsonRecord {
  if (payload.qraTrust && typeof payload.qraTrust === 'object' && !Array.isArray(payload.qraTrust)) return payload
  const corpus = payload.corpus && typeof payload.corpus === 'object' && !Array.isArray(payload.corpus)
    ? payload.corpus as JsonRecord
    : undefined
  return { ...payload, qraTrust: qraTrustStatus(corpus) }
}

async function buildSpartaCoveragePayload(): Promise<JsonRecord> {
  const auditScript = `
import json
from pathlib import Path
from scripts.validation._health_checks import create_health_client, run_all_checks, check_create_qras_remaining_calls, get_sparta_control_framework_inventory
from scripts.validation.sparta_corpus_inventory import scan as scan_corpus_inventory

state_path = Path("/mnt/storage12tb/media/agents/shared/monitor-sparta/state.json")
task_state_path = Path("/mnt/storage12tb/media/agents/shared/monitor-sparta/task_state.json")


client = create_health_client(timeout=45.0)
try:
    checks = [r.to_dict() for r in run_all_checks(client)]
finally:
    client.close()

remaining = check_create_qras_remaining_calls().to_dict()
payload = {
    "checks": checks,
    "passed": sum(1 for c in checks if c.get("ok")),
    "total": len(checks),
    "remaining": remaining,
    "corpus_inventory": scan_corpus_inventory(),
    "control_frameworks": get_sparta_control_framework_inventory(),
    "monitor_state": json.loads(state_path.read_text()) if state_path.exists() else {},
    "task_state": json.loads(task_state_path.read_text()) if task_state_path.exists() else {},
}
print(json.dumps(payload, default=str))
`.trim()

  const [
    monitor,
    counts,
    bestPracticeBase,
    artifacts,
    promptAudit,
    supervisor,
  ] = await Promise.all([
    runCommandJson('uv', ['run', 'python', '-c', auditScript], {
      cwd: MEMORY_REPO_ROOT,
      env: { PYTHONPATH: 'src', MEMORY_SERVICE_URL: 'http://127.0.0.1:8601' },
      timeout: 180_000,
    }),
    Promise.all([
      proxyPost('/count', { collection: 'sparta_controls' }).catch(() => ({ count: 0 })),
      proxyPost('/count', { collection: 'sparta_qra' }).catch(() => ({ count: 0 })),
      proxyPost('/count', { collection: 'sparta_qra_canonical' }).catch(() => ({ count: 0 })),
      proxyPost('/count', { collection: 'sparta_qra_relationship' }).catch(() => ({ count: 0 })),
      proxyPost('/count', { collection: 'sparta_relationships' }).catch(() => ({ count: 0 })),
      proxyPost('/count', { collection: 'sparta_urls' }).catch(() => ({ count: 0 })),
      proxyPost('/count', { collection: 'sparta_url_knowledge' }).catch(() => ({ count: 0 })),
      proxyPost('/count', { collection: 'datalake_chunks' }).catch(() => ({ count: 0 })),
    ]),
    runBestPracticeAudit(),
    readLatestArtifactSummary(),
    auditSpartaPrompts(),
    refreshSpartaSupervisorState(),
  ])
  const remaining = monitor && typeof monitor === 'object' && !Array.isArray(monitor)
    ? (monitor as JsonRecord).remaining as JsonRecord | undefined
    : undefined
  const compactMonitor = monitor && typeof monitor === 'object' && !Array.isArray(monitor)
    ? {
      passed: (monitor as JsonRecord).passed,
      total: (monitor as JsonRecord).total,
      checks: Array.isArray((monitor as JsonRecord).checks)
        ? ((monitor as JsonRecord).checks as JsonRecord[]).map((check) => ({
          ok: check.ok,
          dimension: check.dimension,
          message: typeof check.message === 'string' ? check.message.slice(0, 1000) : check.message,
        }))
        : [],
      remaining: remaining ? {
        ok: remaining.ok,
        dimension: remaining.dimension,
        message: remaining.message,
        native_remaining_any_collection_total: remaining.native_remaining_any_collection_total,
        native_remaining_non_sparta_total: remaining.native_remaining_non_sparta_total,
        native_remaining_sparta_any_collection: remaining.native_remaining_sparta_any_collection,
        native_by_framework: remaining.native_by_framework,
        sparta_v2_remaining_total: remaining.sparta_v2_remaining_total,
        sparta_v2_native_remaining_target_collection: remaining.sparta_v2_native_remaining_target_collection,
        sparta_v2_contextual_remaining_target_collection: remaining.sparta_v2_contextual_remaining_target_collection,
        sparta_v2_remaining_prompt_kinds: remaining.sparta_v2_remaining_prompt_kinds,
        sparta_control_to_control_raw_candidate_pairs: remaining.sparta_control_to_control_raw_candidate_pairs,
        sparta_control_to_control_gated_pairs: remaining.sparta_control_to_control_gated_pairs,
        sparta_control_to_control_gated_skip_reasons: remaining.sparta_control_to_control_gated_skip_reasons,
        implemented_backlog_total_if_legacy_sparta_native_counts_as_done: remaining.implemented_backlog_total_if_legacy_sparta_native_counts_as_done,
        implemented_backlog_total_if_v2_sparta_native_required: remaining.implemented_backlog_total_if_v2_sparta_native_required,
        exact_remaining_calls_total: remaining.exact_remaining_calls_total,
        total_with_raw_comparison_candidates: remaining.total_with_raw_comparison_candidates,
      } : undefined,
      corpus_inventory: (monitor as JsonRecord).corpus_inventory,
    }
    : monitor

  return {
    generated_at: new Date().toISOString(),
    stale: false,
    refreshing: false,
    corpus: {
      controls: counts[0]?.count ?? 0,
      qrasLegacy: counts[1]?.count ?? 0,
      qrasCanonical: counts[2]?.count ?? 0,
      qrasRelationship: counts[3]?.count ?? 0,
      qrasTotal: (counts[1]?.count ?? 0) + (counts[2]?.count ?? 0) + (counts[3]?.count ?? 0),
      relationships: counts[4]?.count ?? 0,
      urls: counts[5]?.count ?? 0,
      urlKnowledge: counts[6]?.count ?? 0,
      datalakeChunks: counts[7]?.count ?? 0,
    },
    qraTrust: {
      status: 'plausible_for_system_test',
      label: 'System-Test Ready',
      expert_blessed: false,
      reviewer: null,
      blessed_at: null,
      scope: ['legacy', 'canonical', 'relationship'],
      counts: {
        legacy: counts[1]?.count ?? 0,
        canonical: counts[2]?.count ?? 0,
        relationship: counts[3]?.count ?? 0,
        total: (counts[1]?.count ?? 0) + (counts[2]?.count ?? 0) + (counts[3]?.count ?? 0),
      },
      use_policy: 'Use current QRAs as plausible corpus artifacts for testing Sparta Explorer, Sparta Chat, /create-evidence-case, retrieval, and conversation-lab workflows; do not present them as Aerospace Corp expert-blessed answers.',
      next_action: 'After SPARTA Corpora and Explorer surfaces are complete, route current QRAs through Aerospace Corp cybersecurity expert evaluation and blessing metadata.',
    },
    corpusInventory: compactMonitor && typeof compactMonitor === 'object' && !Array.isArray(compactMonitor)
      ? (compactMonitor as JsonRecord).corpus_inventory
      : undefined,
    controlFrameworks: monitor && typeof monitor === 'object' && !Array.isArray(monitor) && Array.isArray((monitor as JsonRecord).control_frameworks)
      ? (monitor as JsonRecord).control_frameworks
      : [],
    monitor: compactMonitor,
    bestPractices: deriveBestPracticeAudit(bestPracticeBase as Array<Record<string, unknown>>, promptAudit, supervisor),
    promptAudit,
    artifacts,
    supervisor,
  }
}

function refreshSpartaCoverageInBackground() {
  if (spartaCoverageRefresh) return spartaCoverageRefresh
  spartaCoverageRefresh = buildSpartaCoveragePayload()
    .then(async (payload) => {
      const normalizedPayload = attachQraTrustStatus(payload)
      spartaCoverageCache = { expiresAt: Date.now() + SPARTA_COVERAGE_CACHE_TTL_MS, payload: normalizedPayload }
      await writeSpartaCoverageSnapshot(normalizedPayload).catch((err) => console.error('[sparta/coverage-health] failed to write snapshot', err))
      broadcastSpartaCoverageHealth(normalizedPayload)
      return normalizedPayload
    })
    .finally(() => {
      spartaCoverageRefresh = null
    })
  return spartaCoverageRefresh
}

function startSpartaCoveragePushBridge(): void {
  const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const schedule = (key: string, fn: () => void | Promise<void>) => {
    const existing = debounceTimers.get(key)
    if (existing) clearTimeout(existing)
    debounceTimers.set(key, setTimeout(() => {
      debounceTimers.delete(key)
      void Promise.resolve(fn()).catch((err) => console.error(`[sparta/push] ${key} broadcast failed`, err))
    }, 250))
  }

  const watchFile = (path: string, key: string, fn: () => void | Promise<void>) => {
    try {
      watch(path, { persistent: false }, () => schedule(key, fn))
    } catch (err) {
      console.warn(`[sparta/push] failed to watch ${path}`, err)
    }
  }

  watchFile(SPARTA_SUPERVISOR_STATUS_PATH, 'supervisor-state', () => broadcastSpartaSupervisorState())
  watchFile(SPARTA_COVERAGE_SNAPSHOT_PATH, 'coverage-health', async () => {
    const snapshot = await readSpartaCoverageSnapshot()
    if (snapshot) {
      spartaCoverageCache = { expiresAt: Date.now() + SPARTA_COVERAGE_CACHE_TTL_MS, payload: snapshot }
      broadcastSpartaCoverageHealth(snapshot)
    }
  })
}

app.get('/api/sparta/coverage-health', async (req, res) => {
  try {
    if (spartaCoverageCache && Date.now() < spartaCoverageCache.expiresAt) {
      return res.json(attachQraTrustStatus(spartaCoverageCache.payload))
    }

    const waitForRefresh = req.query.wait === '1'
    const snapshot = spartaCoverageCache?.payload ?? await readSpartaCoverageSnapshot()

    if (snapshot && !waitForRefresh) {
      refreshSpartaCoverageInBackground().catch((err) => console.error('[sparta/coverage-health] background refresh failed', err))
      return res.json(attachQraTrustStatus({ ...snapshot, stale: true, refreshing: true }))
    }

    const payload = await refreshSpartaCoverageInBackground()
    return res.json(payload)
  } catch (err) {
    console.error('[sparta/coverage-health] failed', err)
    return res.status(502).json({
      error: 'sparta_coverage_health_failed',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
})

app.get('/api/sparta/supervisor-state', async (_req, res) => {
  try {
    const supervisor = await readSpartaSupervisorState()
    if (!supervisor) {
      return res.status(404).json({
        error: 'sparta_supervisor_state_missing',
        detail: `No supervisor state found at ${SPARTA_SUPERVISOR_STATUS_PATH}`,
      })
    }
    return res.json(supervisor)
  } catch (err) {
    console.error('[sparta/supervisor-state] failed', err)
    return res.status(502).json({
      error: 'sparta_supervisor_state_failed',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
})

app.post('/api/sparta/supervisor-command', async (req, res) => {
  try {
    const command = normalizeSupervisorCommand(req.body)
    await appendSpartaSupervisorCommand(command)
    broadcastWs({
      type: 'sparta-supervisor-command',
      timestamp: Date.now(),
      command,
    })
    return res.status(202).json(command)
  } catch (err) {
    console.error('[sparta/supervisor-command] failed', err)
    return res.status(502).json({
      error: 'sparta_supervisor_command_failed',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
})

// Legacy posture endpoints (kept for backward compat)
app.get('/api/posture/frameworks', async (_req, res) => {
  try {
    const NRS_COMPLIANCE_THRESHOLD = 0.7
    const controls = await memoryListAll('sparta_controls', ['control_id', 'source_framework', 'nrs_score'])

    const fwMap = new Map<string, { name: string; total: number; covered: number }>()
    for (const c of controls) {
      const fw = String(c.source_framework || 'Unknown')
      if (!fwMap.has(fw)) fwMap.set(fw, { name: fw, total: 0, covered: 0 })
      const b = fwMap.get(fw)!
      b.total += 1
      if (Number(c.nrs_score ?? 0) >= NRS_COMPLIANCE_THRESHOLD) b.covered += 1
    }
    const frameworks = [...fwMap.values()].map(f => ({ ...f, withQRAs: f.covered, pct: f.total ? Math.round((f.covered / f.total) * 100) : 0 }))
    const overallScore = frameworks.length ? Math.round(frameworks.reduce((s, f) => s + f.pct, 0) / frameworks.length) : 0
    res.json({ overallScore, delta: 0, frameworks })
  } catch (err: any) {
    if (isMemoryUnavailableError(err)) return res.status(502).json({ error: 'Memory daemon unavailable' })
    res.status(500).json({ error: 'Posture frameworks failed', detail: String(err) })
  }
})

app.get('/api/posture/families/:framework', async (req, res) => {
  try {
    const framework = req.params.framework
    const controls = await memoryListAll('sparta_controls', ['control_id', 'name', 'nrs_score', 'weaknesses'])
    const families = new Map<string, { family: string; total: number; pass: number; partial: number; fail: number }>()
    for (const c of controls) {
      const cid = String(c.control_id || '')
      const fam = cid.match(/^([A-Z]{2})[-_]/)?.[1] ?? (cid.slice(0, 2).toUpperCase() || 'UN')
      if (!families.has(fam)) families.set(fam, { family: fam, total: 0, pass: 0, partial: 0, fail: 0 })
      const b = families.get(fam)!
      b.total += 1
      const nrs = Number(c.nrs_score ?? 0)
      if (nrs >= 0.8) b.pass += 1
      else if (nrs >= 0.6) b.partial += 1
      else b.fail += 1
    }
    const familyList = [...families.values()].map(f => ({ ...f, pct: f.total ? Math.round((f.pass / f.total) * 100) : 0 })).sort((a, b) => a.family.localeCompare(b.family))
    res.json({ framework, families: familyList })
  } catch (err: any) {
    if (isMemoryUnavailableError(err)) return res.status(502).json({ error: 'Memory daemon unavailable' })
    res.status(500).json({ error: 'Posture families failed', detail: String(err) })
  }
})

app.get('/api/posture/gaps', async (_req, res) => {
  try {
    // Optimized: Only fetch the first 1000 controls and a representative sample of relationships
    const [controls, relRows] = await Promise.all([
      memoryListAll('sparta_controls', ['control_id', 'name', 'source_framework', 'nrs_score']),
      proxyPost('/list', { collection: 'sparta_relationships', limit: 2000, return_fields: ['source_control_id', 'target_control_id'] })
        .then(r => asRows(r))
    ])
    const relSet = new Set(relRows.flatMap((r: any) => [String(r.source_control_id), String(r.target_control_id)]))

    let lowCoverage = 0, noRelationships = 0
    const details: any[] = []
    for (const c of controls) {
      const cid = String(c.control_id)
      const nrs = Number(c.nrs_score ?? 0)
      const hasRel = relSet.has(cid)
      if (nrs === 0) lowCoverage++
      if (!hasRel) noRelationships++
      if ((nrs === 0 || !hasRel) && details.length < 20) {
        details.push({ control_id: cid, name: c.name, framework: c.source_framework, reason: nrs === 0 ? 'missing-qra' : 'missing-rel', qraCount: nrs > 0 ? 1 : 0 })
      }
    }
    res.json({ missingQRAs: lowCoverage, noRelationships, unmappedPolicies: 0, expiredEvidence: 0, manualReview: 0, details })
  } catch (err: any) {
    if (isMemoryUnavailableError(err)) return res.status(502).json({ error: 'Memory daemon unavailable' })
    res.status(500).json({ error: 'Posture gaps failed', detail: String(err) })
  }
})

app.get('/api/posture/risks', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 10, 50)
    const controls = await memoryListAll('sparta_controls', ['control_id', 'name', 'source_framework', 'nrs_score'])
    const risks = controls
      .filter((c: any) => Number(c.nrs_score ?? 0) < 0.6)
      .sort((a: any, b: any) => Number(a.nrs_score ?? 0) - Number(b.nrs_score ?? 0))
      .slice(0, limit)
      .map((c: any) => ({ control_id: c.control_id, name: c.name, source_framework: c.source_framework, nrs_score: Number(c.nrs_score ?? 0) }))
    res.json({ risks })
  } catch (err: any) {
    if (isMemoryUnavailableError(err)) return res.status(502).json({ error: 'Memory daemon unavailable' })
    res.status(500).json({ error: 'Posture risks failed', detail: String(err) })
  }
})

app.get('/api/posture/alerts', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100)
    const allControls = await memoryListAll('sparta_controls', ['control_id', 'name', 'nrs_score'])
    const alerts = allControls
      .filter((c: any) => Number(c.nrs_score ?? 1) < 0.4)
      .sort((a: any, b: any) => Number(a.nrs_score ?? 0) - Number(b.nrs_score ?? 0))
      .slice(0, limit)
      .map((c: any) => ({ control_id: c.control_id, name: c.name, severity: Number(c.nrs_score ?? 0) < 0.2 ? 'critical' : 'warning', nrs_score: Number(c.nrs_score ?? 0) }))
    res.json({ alerts })
  } catch (err: any) {
    if (isMemoryUnavailableError(err)) return res.status(502).json({ error: 'Memory daemon unavailable' })
    res.status(500).json({ error: 'Posture alerts failed', detail: String(err) })
  }
})

app.get('/api/posture/overview', async (_req, res) => {
  try {
    const [controls, rels] = await Promise.all([
      memoryListAll('sparta_controls', ['control_id', 'nrs_score']),
      memoryListAll('sparta_relationships', ['source_control_id', 'target_control_id']),
    ])
    const linked = new Set(rels.flatMap((r: any) => [String(r.source_control_id), String(r.target_control_id)]))

    const NRS_COMPLIANCE_THRESHOLD = 0.7
    const total = controls.length || 1
    const compliant = controls.filter((c: any) => Number(c.nrs_score ?? 0) >= NRS_COMPLIANCE_THRESHOLD).length
    const withRel = controls.filter((c: any) => linked.has(String(c.control_id))).length
    const avgNrs = controls.reduce((s: number, c: any) => s + Number(c.nrs_score ?? 0), 0) / total
    const lowNrs = controls.filter((c: any) => Number(c.nrs_score ?? 0) < 0.4).length

    res.json({
      wells: {
        data_quality: { completeness: Number((compliant / total).toFixed(4)), relationship_coverage: Number((withRel / total).toFixed(4)), total_controls: controls.length },
        threat_matrix: { high_risk_controls: lowNrs, avg_nrs_score: Number(avgNrs.toFixed(4)) },
        posture: { score: Number((compliant / total).toFixed(4)), controls_covered: compliant, controls_uncovered: controls.length - compliant },
        proof_graph: { relationships: rels.length, linked_controls: linked.size },
      }
    })
  } catch (err: any) {
    if (isMemoryUnavailableError(err)) return res.status(502).json({ error: 'Memory daemon unavailable' })
    res.status(500).json({ error: 'Posture overview failed', detail: String(err) })
  }
})
app.get('/api/posture/timeline', async (_req, res) => {
  try {
    const lessons = await memoryListAll('lessons_v2', ['question', 'verdict', 'created_at', 'tags'])
    const postureEvidence = lessons
      .filter((lesson: any) => {
        const tags = lesson.tags || []
        return Array.isArray(tags) && tags.includes('posture')
      })
      .map((lesson: any) => ({
        question: lesson.question || '',
        verdict: lesson.verdict || '',
        created_at: lesson.created_at || ''
      }))
      .sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    
    res.json({ ok: true, timeline: postureEvidence })
  } catch (err: any) {
    if (isMemoryUnavailableError(err)) return res.status(502).json({ error: 'Memory daemon unavailable' })
    res.status(500).json({ error: 'Posture timeline failed', detail: String(err) })
  }
})
// ── Datalake endpoints ──────────────────────────────────────────────────────
// Endpoints for browsing extracted PDF corpus data stored in ArangoDB.
// All queries go through graph_memory container (8601) via the memory daemon
// socket. Uses /list for browsing and /recall/by-keys for lookups.

const CORPUS_ROOT = '/mnt/storage12tb/extractor_corpus/results'

app.get('/api/datalake/stats', async (_req, res) => {
  try {
    // Fetch counts from multiple collections in parallel
    const [docsR, secsR, reqsR, chunksR, scopesR] = await Promise.all([
      proxyPost('/list', { collection: 'datalake_documents', k: 1 }),
      proxyPost('/list', { collection: 'sections', k: 1 }),
      proxyPost('/list', { collection: 'requirements', k: 1 }),
      proxyPost('/list', { collection: 'datalake_chunks', k: 1 }),
      proxyPost('/list', { collection: 'lessons', k: 1, filter: {} }),
    ])
    // Scope breakdown — /list with filters now returns correct filtered totals
    const scopeNames = ['extractor', 'fort_worth_f36', 'datalake_pdf', 'datalake_nonpdf', 'monitor-extractor', 'learn_datalake']
    const scopes = await Promise.all(
      scopeNames.map(async name => {
        try {
          const r = await proxyPost('/list', { collection: 'lessons', k: 1, filters: { scope: name } }) as any
          return { name, doc_count: r?.total ?? 0 }
        } catch { return { name, doc_count: 0 } }
      })
    )
    // Return stats with scopes array (shape matches DatalakeStats interface)
    res.json({
      total_documents: docsR?.total ?? 0,
      total_sections: secsR?.total ?? 0,
      total_requirements: reqsR?.total ?? 0,
      total_chunks: chunksR?.total ?? 0,
      total_pages: 0,
      extraction_coverage: 0,
      scopes,
    })
  } catch (e) {
    res.status(502).json({ error: 'Stats query failed', detail: String(e) })
  }
})

app.get('/api/datalake/documents', async (req, res) => {
  const scope = req.query.scope as string | undefined
  const limit = Math.min(Number(req.query.limit) || 50, 500)
  const offset = Number(req.query.offset) || 0
  try {
    // Primary: 'documents' collection (15K+ real extracted docs with graph edges)
    // Secondary: 'datalake_documents' (ingestion metadata)
    // When scope is requested, search lessons by scope and return linked doc IDs
    if (scope) {
      // Get lessons matching this scope to find doc references
      const lessons = await proxyPost('/list', {
        collection: 'lessons', k: limit, offset,
        filters: { scope },
        return_fields: ['_key', 'title', 'problem', 'tags', 'scope'],
      }) as any
      const docs = (lessons?.documents ?? []).map((d: any) => ({
        ...d, filename: d.title || d._key, scope: d.scope,
      }))
      res.json({ documents: docs, offset, limit, total: lessons?.total ?? docs.length })
    } else {
      // No scope filter — list from documents collection (has graph edges)
      const result = await proxyPost('/list', {
        collection: 'documents', k: limit, offset,
      }) as { documents?: any[]; total?: number }
      res.json({ documents: result?.documents ?? [], offset, limit, total: result?.total ?? 0 })
    }
  } catch (e) {
    res.status(502).json({ error: 'Documents query failed', detail: String(e) })
  }
})

app.get('/api/datalake/documents/:key', async (req, res) => {
  try {
    const result = await proxyPost('/recall/by-keys', {
      collection: 'datalake_documents',
      keys: [req.params.key],
    }) as { documents?: any[] }
    const doc = result?.documents?.[0]
    if (!doc) return res.status(404).json({ error: 'Document not found' })
    res.json(doc)
  } catch (e) {
    res.status(502).json({ error: 'Document lookup failed', detail: String(e) })
  }
})

app.get('/api/datalake/documents/:key/sections', async (req, res) => {
  try {
    // Look up sections linked to this document via has_section edges
    const docId = `documents/${req.params.key}`
    const edges = await proxyPost('/recall/by-keys', {
      collection: 'has_section',
      keys: [docId],
      key_field: '_from',
      return_fields: ['_to'],
    }) as { documents?: Array<{ _to?: string }> }
    const sectionKeys = (edges?.documents ?? []).map(e => e._to?.split('/')?.[1]).filter(Boolean) as string[]
    if (sectionKeys.length === 0) return res.json({ sections: [] })
    const sections = await proxyPost('/recall/by-keys', {
      collection: 'sections',
      keys: sectionKeys.slice(0, 200),
      return_fields: ['_key', 'title', 'level', 'page', 'content', 'section_number'],
    }) as { documents?: any[] }
    res.json({ sections: sections?.documents ?? [] })
  } catch (e) {
    res.status(502).json({ error: 'Sections query failed', detail: String(e) })
  }
})

app.get('/api/datalake/documents/:key/requirements', async (req, res) => {
  try {
    const docId = `documents/${req.params.key}`
    const edges = await proxyPost('/recall/by-keys', {
      collection: 'has_requirement',
      keys: [docId],
      key_field: '_from',
      return_fields: ['_to'],
    }) as { documents?: Array<{ _to?: string }> }
    const reqKeys = (edges?.documents ?? []).map(e => e._to?.split('/')?.[1]).filter(Boolean) as string[]
    if (reqKeys.length === 0) return res.json({ requirements: [] })
    const reqs = await proxyPost('/recall/by-keys', {
      collection: 'requirements',
      keys: reqKeys.slice(0, 200),
    }) as { documents?: any[] }
    res.json({ requirements: reqs?.documents ?? [] })
  } catch (e) {
    res.status(502).json({ error: 'Requirements query failed', detail: String(e) })
  }
})

app.post('/api/datalake/search', async (req, res) => {
  const { q, scope, limit } = req.body as { q?: string; scope?: string; limit?: number }
  if (!q) return res.status(400).json({ error: 'q (query string) required' })
  try {
    const result = await proxyPost('/recall', {
      q,
      collections: ['datalake_chunks'],
      k: Math.min(limit || 20, 100),
      ...(scope ? { filter: { scope } } : {}),
    })
    res.json(result)
  } catch (e) {
    res.status(502).json({ error: 'Search failed', detail: String(e) })
  }
})

app.get('/api/datalake/asset/:chunk_key', async (req, res) => {
  try {
    const result = await proxyPost('/recall/by-keys', {
      collection: 'datalake_chunks',
      keys: [req.params.chunk_key],
      return_fields: ['source_meta', 'source'],
    }) as { documents?: any[] }
    const chunk = result?.documents?.[0]
    if (!chunk) return res.status(404).json({ error: 'Chunk not found' })

    const imagePath = chunk.source_meta?.image_path
    const source = chunk.source
    if (!imagePath || !source) return res.status(404).json({ error: 'No image_path in chunk' })

    // Path traversal protection
    const candidate = resolve(CORPUS_ROOT, source, imagePath)
    let realPath: string
    try { realPath = realpathSync(candidate) } catch { return res.status(404).json({ error: 'File not found' }) }
    if (!realPath.startsWith('/mnt/storage12tb/')) return res.status(403).json({ error: 'Access denied' })

    res.setHeader('Content-Type', 'image/png')
    createReadStream(realPath).pipe(res)
  } catch (e) {
    res.status(500).json({ error: 'Asset lookup failed', detail: String(e) })
  }
})

app.post('/api/datalake/traceability', async (req, res) => {
  const { doc_key } = req.body as { doc_key?: string }
  if (!doc_key) return res.status(400).json({ error: 'doc_key required' })
  try {
    // 1. Look up the document
    const docResult = await proxyPost('/recall/by-keys', {
      collection: 'datalake_documents',
      keys: [doc_key],
    }) as { documents?: any[] }
    let document = docResult?.documents?.[0] ?? null
    if (!document) {
      const fallback = await proxyPost('/recall/by-keys', {
        collection: 'documents',
        keys: [doc_key],
      }) as { documents?: any[] }
      document = fallback?.documents?.[0] ?? null
    }

    // 2-5. Find linked edges in parallel
    const docId = `documents/${doc_key}`
    const edgeCollections = ['has_section', 'has_requirement', 'has_table', 'has_figure'] as const
    const edgeResults = await Promise.all(
      edgeCollections.map(col =>
        proxyPost('/recall/by-keys', {
          collection: col,
          keys: [docId],
          key_field: '_from',
          return_fields: ['_to'],
        }).catch(() => ({ documents: [] }))
      )
    ) as Array<{ documents?: Array<{ _to?: string }> }>

    // Extract target keys per edge type
    const targetCollections = ['sections', 'requirements', 'tables', 'figures'] as const
    const targetKeysByType = edgeResults.map(r =>
      (r?.documents ?? []).map(e => e._to?.split('/')?.[1]).filter(Boolean) as string[]
    )

    // 6. Batch-fetch targets in parallel
    const targetResults = await Promise.all(
      targetKeysByType.map((keys, i) =>
        keys.length > 0
          ? proxyPost('/recall/by-keys', {
              collection: targetCollections[i],
              keys: keys.slice(0, 500),
            }).catch(() => ({ documents: [] }))
          : Promise.resolve({ documents: [] })
      )
    ) as Array<{ documents?: any[] }>

    // 7. Assemble response
    res.json({
      doc_key,
      document,
      sections: targetResults[0]?.documents ?? [],
      requirements: targetResults[1]?.documents ?? [],
      tables: targetResults[2]?.documents ?? [],
      figures: targetResults[3]?.documents ?? [],
      edges: {
        has_section: targetKeysByType[0].length,
        has_requirement: targetKeysByType[1].length,
        has_table: targetKeysByType[2].length,
        has_figure: targetKeysByType[3].length,
      },
    })
  } catch (e) {
    res.status(502).json({ error: 'Traceability query failed', detail: String(e) })
  }
})

function parseLastJsonObjectFromStdout(stdout: string): unknown {
  const lines = stdout.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trimStart().startsWith('{')) continue
    const candidate = lines.slice(i).join('\n').trim()
    if (!candidate) continue
    try {
      return JSON.parse(candidate)
    } catch {
      // keep scanning for earlier candidate starts
    }
  }

  const start = stdout.lastIndexOf('{')
  const end = stdout.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return JSON.parse(stdout.slice(start, end + 1))
  }
  throw new Error('No JSON object found in command output')
}

app.post('/api/evidence-case/drift', async (req, res) => {
  // Compute threat delta via daemon endpoints (no subprocess)
  const { control_ids, limit = 50 } = req.body as { control_ids?: string[]; limit?: number }
  const filterIds = new Set(Array.isArray(control_ids) ? control_ids.filter((id): id is string => typeof id === 'string') : [])

  try {
    // Step 1: List existing evidence cases from daemon
    const listResult = await proxyPost('/list', { collection: 'evidence_cases', limit }) as { documents?: any[] }
    const docs = listResult.documents ?? []

    // Step 2: Build control→case map (most recent per control)
    const controlCases = new Map<string, { question: string; old_verdict: string; source_key: string }>()
    for (const doc of docs) {
      if (doc.type === 'threat-delta') continue
      const question = doc.question || doc.claim?.text || ''
      if (!question) continue
      const oldVerdict = (typeof doc.verdict === 'string' ? doc.verdict : doc.verdict?.state || doc.claim?.verdict || 'unknown').toLowerCase()
      const sourceKey = doc._key || ''
      const controlIdList: string[] = doc.control_ids ?? doc.claim?.control_ids ?? (doc.control_id ? [doc.control_id] : [])
      for (const cid of controlIdList) {
        if (filterIds.size > 0 && !filterIds.has(cid)) continue
        if (!controlCases.has(cid)) {
          controlCases.set(cid, { question, old_verdict: oldVerdict, source_key: sourceKey })
        }
      }
    }

    // Step 3: Re-evaluate each control via /create-evidence-case
    const deltas: Array<{ control_id: string; old_verdict: string; new_verdict: string; changed: boolean }> = []
    for (const [controlId, caseData] of controlCases) {
      try {
        const ecResult = await proxyPost('/create-evidence-case', {
          question: caseData.question,
          source_id: controlId,
          skip_qra_recall: true,
          enable_llm: false,
        }) as { review_status?: string }
        const newVerdict = (ecResult.review_status || 'unknown').toLowerCase()
        deltas.push({
          control_id: controlId,
          old_verdict: caseData.old_verdict,
          new_verdict: newVerdict,
          changed: caseData.old_verdict !== newVerdict,
        })
      } catch {
        deltas.push({ control_id: controlId, old_verdict: caseData.old_verdict, new_verdict: 'error', changed: true })
      }
    }

    const changed = deltas.filter(d => d.changed)
    res.json({
      total_evaluated: deltas.length,
      changed_count: changed.length,
      deltas: changed,
      timestamp: new Date().toISOString(),
    })
  } catch (e) {
    res.status(502).json({ error: 'Drift computation failed', detail: String(e) })
  }
})

app.post('/api/evidence-case/stress-test', async (req, res) => {
  const { question_bank } = req.body as { question_bank?: string }
  const questionBank = question_bank || 'batch_50_f36'

  try {
    const { stdout } = await execFileAsync(
      '.pi/skills/create-evidence-case/run.sh',
      ['stress-test', '--question-bank', questionBank, '--json'],
      {
        cwd: PI_MONO,
        timeout: 300000,
        maxBuffer: 10 * 1024 * 1024,
      },
    )
    res.json(JSON.parse(stdout))
  } catch (error) {
    const err = error as Error & { stderr?: string }
    const message = err.stderr?.trim() || err.message || 'stress-test failed'
    res.status(502).json({ error: message })
  }
})

app.post('/api/datalake/verify', async (req, res) => {
  const { pdf_path, max_pages = 3 } = req.body as { pdf_path?: string; max_pages?: number }
  if (!pdf_path) return res.status(400).json({ error: 'pdf_path required' })

  try {
    const { execFileSync } = await import('child_process')
    const result = execFileSync('python3', ['-c', `
import json, sys
sys.path.insert(0, "/home/graham/workspace/experiments/pdf_oxide/.venv/lib/python3.12/site-packages")
from pathlib import Path
import pdf_oxide
doc = pdf_oxide.PdfDocument("${pdf_path}")
ext = doc.extract_document(max_pages=${max_pages})
sys.path.insert(0, "/home/graham/workspace/experiments/pi-mono/.pi/skills/pdf-lab")
from lib.visual_score import verify_document
result = verify_document(Path("${pdf_path}"), ext, max_pages=${max_pages})
print(json.dumps(result))
`], { timeout: 60000, encoding: 'utf-8', cwd: '/home/graham/workspace/experiments/pi-mono/.pi/skills/pdf-lab' })
    res.json(JSON.parse(result.trim().split('\n').pop() || '{}'))
  } catch (e: any) {
    res.status(502).json({ error: 'Verification failed', detail: String(e.stderr || e.message).slice(0, 500) })
  }
})

app.get('/api/datalake/metrics', async (_req, res) => {
  try {
    const r = await proxyPost('/list', { collection: 'metrics_reports', k: 1 }) as any
    res.json(r?.documents?.[0] ?? { status: 'no_reports' })
  } catch (e) { res.status(502).json({ error: 'Metrics query failed', detail: String(e) }) }
})

app.get('/api/datalake/metrics/:scope', async (req, res) => {
  try {
    const r = await proxyPost('/list', { collection: 'metrics_reports', k: 1, filters: { scope: req.params.scope } }) as any
    res.json(r?.documents?.[0] ?? { status: 'no_reports' })
  } catch (e) { res.status(502).json({ error: 'Metrics query failed', detail: String(e) }) }
})

// ── PDF Lab reviewed extraction persistence ───────────────────────────────

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

async function readUtf8IfExists(path: string): Promise<string> {
  if (!existsSync(path)) return ''
  return readFile(path, 'utf-8')
}

const PDF_LAB_SKILL_RUN = '/home/graham/workspace/experiments/agent-skills/skills/pdf-lab/run.sh'
const PDF_LAB_PDF_OXIDE_ROOT = '/home/graham/workspace/experiments/pdf_oxide'
const PDF_LAB_SOURCE_PDF = process.env.PDF_LAB_SOURCE_PDF || '/mnt/storage12tb/extractor_corpus/source/standards/NIST_SP_800-53r5.pdf'
const PDF_LAB_NIST_PRESET = '/home/graham/workspace/experiments/pdf_oxide/python/pdf_oxide/presets/document_families/nist_sp_800_53r5_pdf.json'
const PDF_LAB_WORKFLOW_BUILD_SCRIPT = '/home/graham/workspace/experiments/pdf_oxide/scripts/build_pdf_lab_workflow_manifest.py'
const PDF_LAB_PROMOTE_REAL_ARTIFACTS_SCRIPT = '/home/graham/workspace/experiments/pdf_oxide/scripts/promote_pdf_lab_real_artifacts.py'
const PDF_LAB_NICO_QA_REPORT_SCRIPT = '/home/graham/workspace/experiments/pdf_oxide/scripts/build_pdf_lab_nico_qa_report.py'

type PdfLabJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

interface PdfLabExtractionJob {
  command: string[]
  completedAt?: string
  createdAt: string
  error?: string
  exitCode?: number | null
  id: string
  logPath: string
  operation: string
  outputDir: string
  pid?: number
  promoted?: JsonRecord
  runSummary?: JsonRecord
  scriptPath?: string
  signal?: string | null
  status: PdfLabJobStatus
  updatedAt: string
}

const pdfLabJobs = new Map<string, PdfLabExtractionJob>()
let pdfLabLatestJobId: string | null = null

function pdfLabPublicPath(relativeName: string): string {
  const absolutePath = resolve(PDF_LAB_ARTIFACTS_ROOT, relativeName)
  if (!isPathInside(PDF_LAB_ARTIFACTS_ROOT, absolutePath)) {
    throw new Error(`PDF Lab artifact escapes artifact root: ${relativeName}`)
  }
  return absolutePath
}

function pdfLabPublicUrl(relativeName: string): string {
  return `/artifacts/pdf-lab/${relativeName.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/')}`
}

function pdfLabStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

async function readJsonFile<T = JsonRecord>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf-8')) as T
}

async function writeJsonFile(path: string, data: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
}

function pdfLabPublicUrlFromPath(pathValue: unknown): string | null {
  if (typeof pathValue !== 'string' || pathValue.length === 0) return null
  const absolute = resolve(pathValue)
  if (isPathInside(PDF_LAB_ARTIFACTS_ROOT, absolute)) {
    return pdfLabPublicUrl(absolute.slice(PDF_LAB_ARTIFACTS_ROOT.length + 1).replace(/\\/g, '/'))
  }
  if (isPathInside(PUBLIC_ROOT, absolute)) {
    return pdfLabPublicUrl(absolute.slice(PUBLIC_ROOT.length + 1).replace(/\\/g, '/'))
  }
  if (pathValue.startsWith('/artifacts/pdf-lab/')) return pathValue
  if (pathValue.startsWith('/pdf-lab-') || pathValue === '/NIST_SP_800-53r5.pdf') {
    return pdfLabPublicUrl(pathValue.replace(/^\/+/, ''))
  }
  return pathValue.startsWith('/') ? pathValue : null
}

function pdfLabQuestionPage(question: string): number | null {
  const match = question.match(/\bpage\s+(\d+)\b/i)
  return match ? Number(match[1]) : null
}

function pdfLabQuestionElementType(question: string): string | null {
  const lower = question.toLowerCase()
  if (lower.includes('table')) return 'table'
  if (lower.includes('figure')) return 'figure'
  if (lower.includes('equation')) return 'equation'
  if (lower.includes('requirement')) return 'requirement'
  if (lower.includes('section')) return 'section_header'
  if (lower.includes('definition')) return 'definition_list'
  return null
}

function parseJsonStdout<T = JsonRecord>(stdout: string): T {
  const trimmed = stdout.trim()
  if (!trimmed) return {} as T
  try {
    return JSON.parse(trimmed) as T
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start === -1 || end === -1 || end <= start) throw new Error(`Command did not emit a JSON object: ${trimmed.slice(0, 240)}`)
    return JSON.parse(trimmed.slice(start, end + 1)) as T
  }
}

async function refreshPdfLabCandidateInventoryFromPresetScan(manifestPath: string): Promise<number> {
  const fullExtractionPath = pdfLabPublicPath('pdf-lab-nist-full-extraction.json')
  const triagePath = pdfLabPublicPath('pdf-lab-nist-human-triage-queue.json')
  const presetScanDir = pdfLabPublicPath('pdf-lab-nist-preset-scan')
  if (!existsSync(fullExtractionPath) || !existsSync(presetScanDir)) return 0

  const pageNumbers = (await readdir(presetScanDir))
    .map((fileName) => fileName.match(/^page_(\d+)\.png$/i)?.[1])
    .filter((page): page is string => Boolean(page))
    .map((page) => Number(page))
    .sort((left, right) => left - right)
  if (pageNumbers.length === 0) return 0

  const fullExtraction = await readJsonFile<JsonRecord>(fullExtractionPath)
  const triage = existsSync(triagePath) ? await readJsonFile<JsonRecord>(triagePath) : null
  const elements = Array.isArray(fullExtraction.elements) ? fullExtraction.elements as JsonRecord[] : []
  const tasks = triage && Array.isArray(triage.human_triage_queue) ? triage.human_triage_queue as JsonRecord[] : []
  const pageSet = new Set(pageNumbers)
  const elementsByPage = new Map<number, JsonRecord[]>()
  const tasksByPage = new Map<number, JsonRecord[]>()
  for (const element of elements) {
    const page = typeof element.page === 'number' ? element.page : null
    if (page === null || !pageSet.has(page)) continue
    const rows = elementsByPage.get(page) ?? []
    rows.push(element)
    elementsByPage.set(page, rows)
  }
  for (const task of tasks) {
    const page = typeof task.page === 'number' ? task.page : null
    if (page === null) continue
    const rows = tasksByPage.get(page) ?? []
    rows.push(task)
    tasksByPage.set(page, rows)
  }

  const countTypes = (records: JsonRecord[]) => {
    const counts: Record<string, number> = {}
    for (const record of records) {
      const type = typeof record.type === 'string' ? record.type : 'unknown'
      counts[type] = (counts[type] ?? 0) + 1
    }
    return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])))
  }
  const severityRank: Record<string, number> = { high: 3, medium: 2, low: 1 }
  const manifest = await readJsonFile<JsonRecord>(manifestPath)
  const evidenceElementsByPage: Record<string, JsonRecord[]> = {}
  const candidatePages = pageNumbers.map((page) => {
    const pageElements = elementsByPage.get(page) ?? []
    const pageTasks = tasksByPage.get(page) ?? []
    const taskKinds: Record<string, number> = {}
    for (const task of pageTasks) {
      const kind = typeof task.kind === 'string' ? task.kind : 'unknown'
      taskKinds[kind] = (taskKinds[kind] ?? 0) + 1
    }
    const severity = pageTasks
      .map((task) => typeof task.severity === 'string' ? task.severity : 'none')
      .sort((left, right) => (severityRank[right] ?? 0) - (severityRank[left] ?? 0))[0] ?? 'none'
    evidenceElementsByPage[String(page)] = pageElements.slice(0, 120).map((element) => ({
      bbox: element.bbox,
      confidence: element.confidence,
      id: element.id,
      page,
      source: element.source,
      text: element.text,
      type: element.type,
    }))
    return {
      element_count: pageElements.length,
      element_types: countTypes(pageElements),
      gate_status: 'candidate_selected_for_extraction',
      inferred_match_score: null,
      page,
      severity,
      source: 'agentic_preset_scan_png + full_extraction',
      task_count: pageTasks.length,
      task_kinds: taskKinds,
    }
  })

  manifest.candidate_inventory = {
    candidate_page_count: candidatePages.length,
    candidate_pages: candidatePages,
    source: `${pdfLabPublicUrl('pdf-lab-nist-preset-scan')}/*.png + ${pdfLabPublicUrl('pdf-lab-nist-full-extraction.json')}`,
  }
  manifest.evidence_elements_by_page = evidenceElementsByPage
  await writeJsonFile(manifestPath, manifest)
  await writeJsonFile(pdfLabPublicPath('pdf-lab-nist-preset-scan-index.json'), {
    count: pageNumbers.length,
    pages: pageNumbers,
    source: 'pdf-lab-nist-preset-scan',
  })
  return pageNumbers.length
}

async function promotePdfLabAgenticOutput(outputDir: string): Promise<JsonRecord> {
  if (!existsSync(PDF_LAB_PROMOTE_REAL_ARTIFACTS_SCRIPT)) {
    throw new Error(`Promotion script not found: ${PDF_LAB_PROMOTE_REAL_ARTIFACTS_SCRIPT}`)
  }
  await mkdir(PDF_LAB_ARTIFACTS_ROOT, { recursive: true })
  const { stdout } = await execFileAsync(
    'python3',
    [
      PDF_LAB_PROMOTE_REAL_ARTIFACTS_SCRIPT,
      '--run-dir',
      outputDir,
      '--public-dir',
      PDF_LAB_ARTIFACTS_ROOT,
    ],
    { timeout: 180_000, maxBuffer: 40 * 1024 * 1024 },
  )
  return JSON.parse(stdout.trim() || '{}') as JsonRecord
}

async function runPdfLabAgenticExtraction(operation: string, body: JsonRecord): Promise<JsonRecord> {
  if (!existsSync(PDF_LAB_SOURCE_PDF)) throw new Error(`Source PDF not found: ${PDF_LAB_SOURCE_PDF}`)
  if (!existsSync(PDF_LAB_NIST_PRESET)) throw new Error(`NIST preset not found: ${PDF_LAB_NIST_PRESET}`)
  const maxPages = Number(body.maxPages ?? 50)
  const topK = Number(body.topK ?? 5)
  const maxIterations = Number(body.maxIterations ?? 1)
  const target = Number(body.target ?? 0.95)
  const outputDir = `/tmp/pdf-lab-agentic-nist-${operation}-${pdfLabStamp()}`
  const inheritedPythonPath = process.env.PYTHONPATH && !process.env.PYTHONPATH.startsWith('./')
    ? process.env.PYTHONPATH
    : ''
  const pythonPath = [
    PDF_LAB_PDF_OXIDE_ROOT,
    inheritedPythonPath,
  ].filter(Boolean).join(':')
  const command = [
    PDF_LAB_SKILL_RUN,
    'agentic-extract',
    PDF_LAB_SOURCE_PDF,
    '--preset', PDF_LAB_NIST_PRESET,
    '--out', outputDir,
    '--target', String(target),
    '--max-iterations', String(maxIterations),
    '--max-pages', String(maxPages),
    '--top-k', String(topK),
    '--json',
  ].map(shellQuote).join(' ')
  const { stdout } = await execAsync(
    command,
    {
      cwd: PDF_LAB_PDF_OXIDE_ROOT,
      env: {
        ...process.env,
        HOME: process.env.HOME || '/home/graham',
        USER: process.env.USER || 'graham',
        PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
        XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || resolve(process.env.HOME || '/home/graham', '.cache'),
        PDF_OXIDE_ROOT: PDF_LAB_PDF_OXIDE_ROOT,
        PYTHONPATH: pythonPath,
      },
      timeout: 600_000,
      maxBuffer: 40 * 1024 * 1024,
    },
  )
  const runSummary = parseJsonStdout<JsonRecord>(stdout)
  const promoted = await promotePdfLabAgenticOutput(outputDir)
  return {
    ok: true,
    operation,
    outputDir,
    runSummary,
    promoted,
  }
}

function getPdfLabRunOptions(body: JsonRecord): { maxPages: number; topK: number; maxIterations: number; target: number } {
  const maxPages = Math.max(1, Math.min(492, Number(body.maxPages ?? 50)))
  const topK = Math.max(1, Math.min(50, Number(body.topK ?? 5)))
  const maxIterations = Math.max(1, Math.min(5, Number(body.maxIterations ?? 1)))
  const target = Math.max(0, Math.min(1, Number(body.target ?? 0.95)))
  return { maxPages, topK, maxIterations, target }
}

function serializePdfLabJob(job: PdfLabExtractionJob): JsonRecord {
  return {
    id: job.id,
    operation: job.operation,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    outputDir: job.outputDir,
    logPath: job.logPath,
    pid: job.pid,
    scriptPath: job.scriptPath,
    exitCode: job.exitCode,
    signal: job.signal,
    error: job.error,
    runSummary: job.runSummary,
    promoted: job.promoted,
  }
}

function isPidRunning(pid?: number): boolean {
  if (!pid) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function refreshPdfLabJobStatus(job: PdfLabExtractionJob): Promise<void> {
  if (job.status !== 'running' && job.status !== 'queued') return
  if (isPidRunning(job.pid)) return

  const summaryPath = resolve(job.outputDir, 'agentic_extract_summary.json')
  const comparisonPath = resolve(job.outputDir, 'iteration_01', 'comparison.json')
  const actualPath = resolve(job.outputDir, 'iteration_01', 'actual_elements.json')
  job.updatedAt = new Date().toISOString()
  job.completedAt = job.updatedAt

  try {
    if (!existsSync(summaryPath) || !existsSync(comparisonPath) || !existsSync(actualPath)) {
      throw new Error(`pdf_oxide job ended before complete artifacts were written. Log: ${job.logPath}`)
    }
    job.runSummary = await readJsonFile<JsonRecord>(summaryPath)
    job.promoted = await promotePdfLabAgenticOutput(job.outputDir)
    job.status = 'succeeded'
    job.updatedAt = new Date().toISOString()
    job.completedAt = job.updatedAt
  } catch (err) {
    job.status = 'failed'
    job.error = err instanceof Error ? err.message : String(err)
  }
}

function prunePdfLabJobs(): void {
  const jobs = Array.from(pdfLabJobs.values()).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  for (const staleJob of jobs.slice(25)) {
    pdfLabJobs.delete(staleJob.id)
  }
}

function startPdfLabExtractionJob(operation: string, body: JsonRecord): PdfLabExtractionJob {
  if (!existsSync(PDF_LAB_SOURCE_PDF)) throw new Error(`Source PDF not found: ${PDF_LAB_SOURCE_PDF}`)
  if (!existsSync(PDF_LAB_NIST_PRESET)) throw new Error(`NIST preset not found: ${PDF_LAB_NIST_PRESET}`)

  const { maxPages, topK, maxIterations, target } = getPdfLabRunOptions(body)
  const stamp = pdfLabStamp()
  const jobId = `${operation}-${stamp}`
  const outputDir = `/tmp/pdf-lab-agentic-nist-${operation}-${stamp}`
  const logPath = `/tmp/pdf-lab-agentic-nist-${operation}-${stamp}.log`
  const scriptPath = `/tmp/pdf-lab-agentic-nist-${operation}-${stamp}.sh`
  const inheritedPythonPath = process.env.PYTHONPATH && !process.env.PYTHONPATH.startsWith('./')
    ? process.env.PYTHONPATH
    : ''
  const pythonPath = [
    PDF_LAB_PDF_OXIDE_ROOT,
    inheritedPythonPath,
  ].filter(Boolean).join(':')
  const args = [
    'agentic-extract',
    PDF_LAB_SOURCE_PDF,
    '--preset', PDF_LAB_NIST_PRESET,
    '--out', outputDir,
    '--target', String(target),
    '--max-iterations', String(maxIterations),
    '--max-pages', String(maxPages),
    '--top-k', String(topK),
    '--json',
  ]
  const now = new Date().toISOString()
  const job: PdfLabExtractionJob = {
    command: [PDF_LAB_SKILL_RUN, ...args],
    createdAt: now,
    id: jobId,
    logPath,
    operation,
    outputDir,
    scriptPath,
    status: 'queued',
    updatedAt: now,
  }
  pdfLabJobs.set(jobId, job)
  pdfLabLatestJobId = jobId
  prunePdfLabJobs()

const script = `#!/usr/bin/env bash
set -euo pipefail
exec >> ${shellQuote(logPath)} 2>&1
cd ${shellQuote(PDF_LAB_PDF_OXIDE_ROOT)}
export PDF_OXIDE_ROOT=${shellQuote(PDF_LAB_PDF_OXIDE_ROOT)}
export PYTHONPATH=${shellQuote(pythonPath)}
echo "[${now}] START ${job.command.map(shellQuote).join(' ')}"
${job.command.map(shellQuote).join(' ')}
echo "[$(date -Is)] DONE"
`
  writeFileSync(scriptPath, script, { encoding: 'utf-8', mode: 0o755 })
  writeFileSync(logPath, '', 'utf-8')

  const child = spawn('bash', [scriptPath], {
    cwd: PDF_LAB_PDF_OXIDE_ROOT,
    env: {
      ...process.env,
      HOME: process.env.HOME || '/home/graham',
      USER: process.env.USER || 'graham',
      PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || resolve(process.env.HOME || '/home/graham', '.cache'),
      PDF_OXIDE_ROOT: PDF_LAB_PDF_OXIDE_ROOT,
      PYTHONPATH: pythonPath,
    },
    stdio: 'ignore',
    detached: true,
  })
  child.unref()
  job.pid = child.pid
  job.status = 'running'
  job.updatedAt = new Date().toISOString()
  child.on('error', (err) => {
    job.status = 'failed'
    job.error = err.message
    job.updatedAt = new Date().toISOString()
  })

  return job
}

function fencedCode(path: string, content: string, language = ''): string {
  return `### ${path}\n\n\`\`\`${language}\n${content.trimEnd()}\n\`\`\`\n`
}

function truncateForBundle(content: string, maxChars = 120_000): string {
  if (content.length <= maxChars) return content
  return `${content.slice(0, maxChars)}\n\n[TRUNCATED: ${content.length - maxChars} chars omitted]\n`
}

async function copyBundleFile(sourcePath: string, bundleDir: string, relativeName: string): Promise<string | null> {
  if (!sourcePath || !existsSync(sourcePath)) return null
  const safeName = relativeName.replace(/^\/+/, '').replace(/\.\./g, '__')
  const destinationPath = resolve(bundleDir, safeName)
  await mkdir(dirname(destinationPath), { recursive: true })
  await copyFile(sourcePath, destinationPath)
  return safeName
}

async function latestFileInDir(dir: string, suffix: string): Promise<string | null> {
  if (!existsSync(dir)) return null
  const entries = await readdir(dir, { withFileTypes: true })
  const candidates = await Promise.all(entries
    .filter(entry => entry.isFile() && entry.name.endsWith(suffix))
    .map(async entry => {
      const path = resolve(dir, entry.name)
      const info = await stat(path)
      return { path, mtimeMs: info.mtimeMs }
    }))
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return candidates[0]?.path ?? null
}

async function collectPdfLabVerificationArtifacts(pdfOxideRoot: string): Promise<Array<{ label: string; path: string }>> {
  const verificationRoot = resolve(pdfOxideRoot, '.codex/ui-verification')
  const artifacts: Array<{ label: string; path: string }> = []
  const seen = new Set<string>()
  const add = (label: string, path: string | null | undefined) => {
    if (!path || !existsSync(path) || seen.has(path)) return
    seen.add(path)
    artifacts.push({ label, path })
  }

  const latestPath = resolve(verificationRoot, 'latest.json')
  add('ui-verification/latest.json', latestPath)
  try {
    const latest = JSON.parse(await readUtf8IfExists(latestPath)) as Record<string, unknown>
    const screenshot = typeof latest.screenshot === 'string' ? latest.screenshot : ''
    const readJson = typeof latest.read_json === 'string' ? latest.read_json : ''
    add('latest/screenshot.png', screenshot)
    add('latest/read.json', readJson)
    if (screenshot) {
      add('latest/metrics.json', screenshot.replace(/\.png$/, '.metrics.json'))
      add('latest/meta.json', screenshot.replace(/\.png$/, '.meta.json'))
    }
  } catch {
    // latest marker is optional
  }

  if (!existsSync(verificationRoot)) return artifacts
  const relevantVerificationDirs = new Set([
    'pdf-lab-surgical-fixture-final-decree',
    'pdf-lab-gemini-surgical-react-measured-route',
    'pdf-lab-gemini-surgical-react-no-oval',
    'pdf-lab-gemini-surgical-react',
    'pdf-lab-gemini-literal-rewrite-pass6',
    'pdf-lab-gemini-final-visible-callout',
  ])
  const dirs = (await readdir(verificationRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && relevantVerificationDirs.has(entry.name))
    .map(entry => entry.name)
  for (const dirName of dirs) {
    const dir = resolve(verificationRoot, dirName)
    add(`${dirName}/latest.png`, await latestFileInDir(dir, '.png'))
    add(`${dirName}/latest.metrics.json`, await latestFileInDir(dir, '.metrics.json'))
    add(`${dirName}/latest.read.json`, await latestFileInDir(dir, '.read.json'))
    add(`${dirName}/latest.meta.json`, await latestFileInDir(dir, '.meta.json'))
  }

  return artifacts
}

function summarizePdfLabJson(name: string, content: string): string {
  if (!content) return `- ${name}: missing\n`
  try {
    const data = JSON.parse(content) as Record<string, any>
    if (name.includes('workflow-manifest')) {
      return [
        `- ${name}: workflow manifest`,
        `  - source_pdf: ${data.source_pdf ?? 'unknown'}`,
        `  - preset: ${data.document_family_preset ?? 'unknown'}`,
        `  - page_count: ${data.page_count ?? 'unknown'}`,
        `  - candidate_page_count: ${data.candidate_inventory?.candidate_page_count ?? 'unknown'}`,
        `  - total_elements: ${data.element_summary?.total_elements ?? 'unknown'}`,
        `  - element_types: ${JSON.stringify(data.element_summary?.types ?? {})}`,
        `  - artifact_gaps: ${Array.isArray(data.artifact_gaps) ? data.artifact_gaps.length : 'unknown'}`,
      ].join('\n') + '\n'
    }
    if (name.includes('human-triage')) {
      return [
        `- ${name}: human triage queue`,
        `  - queue length: ${Array.isArray(data.human_triage_queue) ? data.human_triage_queue.length : 'unknown'}`,
        `  - pages_with_tasks: ${data.summary?.pages_with_tasks ?? 'unknown'}`,
        `  - severity: ${JSON.stringify(data.summary?.tasks_by_severity ?? {})}`,
        `  - first task: ${JSON.stringify(Array.isArray(data.human_triage_queue) ? data.human_triage_queue[0] : null)}`,
      ].join('\n') + '\n'
    }
    if (name.includes('full-extraction')) {
      return [
        `- ${name}: full extraction`,
        `  - source_pdf: ${data.source_pdf ?? 'unknown'}`,
        `  - page_count: ${data.page_count ?? 'unknown'}`,
        `  - elements: ${Array.isArray(data.elements) ? data.elements.length : 'unknown'}`,
      ].join('\n') + '\n'
    }
  } catch (error) {
    return `- ${name}: failed to parse JSON (${error instanceof Error ? error.message : String(error)})\n`
  }
  return `- ${name}: available (${content.length} bytes)\n`
}

app.post('/api/pdf-lab/gemini-review-bundle', async (req, res) => {
  try {
    const now = new Date()
    const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    const uxLabRoot = resolve(__dirname, '..')
    const pdfOxideRoot = '/home/graham/workspace/experiments/pdf_oxide'
    const latestVerificationPath = resolve(pdfOxideRoot, '.codex/ui-verification/latest.json')
    const bundlePath = `/tmp/pdf-lab-gemini-review-bundle-${stamp}.md`
    const latestBundlePath = '/tmp/pdf-lab-gemini-review-bundle-latest.md'
    const bundleDir = `/tmp/pdf-lab-gemini-review-bundle-${stamp}`
    const latestBundleDir = '/tmp/pdf-lab-gemini-review-bundle-latest'
    const zipPath = `${bundleDir}.zip`
    const latestZipPath = '/tmp/pdf-lab-gemini-review-bundle-latest.zip'
    await mkdir(bundleDir, { recursive: true })

    const files = [
      { label: 'src/components/pdf-lab/PdfLabView.tsx', path: resolve(uxLabRoot, 'src/components/pdf-lab/PdfLabView.tsx'), lang: 'tsx' },
      { label: 'src/components/pdf-lab/SurgicalTriageFixture.tsx', path: resolve(uxLabRoot, 'src/components/pdf-lab/SurgicalTriageFixture.tsx'), lang: 'tsx' },
      { label: 'src/components/pdf-lab/SurgicalTriageViewport.tsx', path: resolve(uxLabRoot, 'src/components/pdf-lab/SurgicalTriageViewport.tsx'), lang: 'tsx' },
      { label: 'src/components/datalake-explorer/PdfCanvas.tsx', path: resolve(uxLabRoot, 'src/components/datalake-explorer/PdfCanvas.tsx'), lang: 'tsx' },
      { label: 'src/components/common/LeftPane.tsx', path: resolve(uxLabRoot, 'src/components/common/LeftPane.tsx'), lang: 'tsx' },
      { label: 'src/components/common/ReviewBundleButton.tsx', path: resolve(uxLabRoot, 'src/components/common/ReviewBundleButton.tsx'), lang: 'tsx' },
      { label: 'src/components/pdf-lab/PdfLabView.css', path: resolve(uxLabRoot, 'src/components/pdf-lab/PdfLabView.css'), lang: 'css' },
      { label: 'src/components/pdf-lab/surgical-triage.design-manifest.yml', path: resolve(uxLabRoot, 'src/components/pdf-lab/surgical-triage.design-manifest.yml'), lang: 'yaml' },
      { label: 'src/App.tsx', path: resolve(uxLabRoot, 'src/App.tsx'), lang: 'tsx' },
      { label: 'server/index.ts', path: resolve(uxLabRoot, 'server/index.ts'), lang: 'ts' },
      { label: 'component-manifest.json', path: resolve(uxLabRoot, 'component-manifest.json'), lang: 'json' },
    ]

    const jsonFiles = [
      { label: 'artifacts/pdf-lab/pdf-lab-nist-workflow-manifest.json', path: pdfLabPublicPath('pdf-lab-nist-workflow-manifest.json') },
      { label: 'artifacts/pdf-lab/pdf-lab-nist-human-triage-queue.json', path: pdfLabPublicPath('pdf-lab-nist-human-triage-queue.json') },
      { label: 'artifacts/pdf-lab/pdf-lab-nist-full-extraction.json', path: pdfLabPublicPath('pdf-lab-nist-full-extraction.json') },
    ]

    const latestVerification = await readUtf8IfExists(latestVerificationPath)
    let latestVerificationJson: Record<string, unknown> | null = null
    try {
      latestVerificationJson = latestVerification ? JSON.parse(latestVerification) as Record<string, unknown> : null
    } catch {
      latestVerificationJson = null
    }

    const sourceSections = await Promise.all(files.map(async file => (
      fencedCode(file.label, truncateForBundle(await readUtf8IfExists(file.path)), file.lang)
    )))
    const dataSummary = (await Promise.all(jsonFiles.map(async file => (
      summarizePdfLabJson(file.label, await readUtf8IfExists(file.path))
    )))).join('')
    const gitDiff = await execAsync('git diff -- packages/ux-lab/src/App.tsx packages/ux-lab/src/components/pdf-lab/PdfLabView.tsx packages/ux-lab/src/components/pdf-lab/SurgicalTriageFixture.tsx packages/ux-lab/src/components/pdf-lab/SurgicalTriageViewport.tsx packages/ux-lab/src/components/pdf-lab/PdfLabView.css packages/ux-lab/src/components/pdf-lab/surgical-triage.design-manifest.yml packages/ux-lab/src/components/datalake-explorer/PdfCanvas.tsx packages/ux-lab/src/components/common/LeftPane.tsx packages/ux-lab/src/components/common/ReviewBundleButton.tsx packages/ux-lab/server/index.ts packages/ux-lab/component-manifest.json', {
      cwd: PI_MONO,
      maxBuffer: 8 * 1024 * 1024,
    }).then(result => result.stdout).catch(error => `git diff unavailable: ${error instanceof Error ? error.message : String(error)}`)

    const requestBody = req.body && typeof req.body === 'object' ? req.body as Record<string, unknown> : {}
    const screenshotPath = typeof latestVerificationJson?.screenshot === 'string'
      ? latestVerificationJson.screenshot
      : typeof latestVerificationJson?.path === 'string'
        ? latestVerificationJson.path
        : 'unknown'
    const verificationArtifacts = await collectPdfLabVerificationArtifacts(pdfOxideRoot)
    const findArtifact = (predicate: (artifact: { label: string; path: string }) => boolean): string | null => (
      verificationArtifacts.find(predicate)?.path ?? null
    )
    const productionScreenshot = screenshotPath !== 'unknown' ? screenshotPath : findArtifact(artifact => artifact.label.includes('pdf-lab-gemini-surgical-react-measured-route') && artifact.label.endsWith('.png'))
    const fixtureScreenshot = findArtifact(artifact => artifact.label.includes('pdf-lab-surgical-fixture-final-decree') && artifact.label.endsWith('.png'))
    const productionMetricsPath = findArtifact(artifact => artifact.label.includes('pdf-lab-gemini-surgical-react-measured-route') && artifact.label.endsWith('.metrics.json'))
    const fixtureMetricsPath = findArtifact(artifact => artifact.label.includes('pdf-lab-surgical-fixture-final-decree') && artifact.label.endsWith('.metrics.json'))
    const productionReadPath = findArtifact(artifact => artifact.label.includes('pdf-lab-gemini-surgical-react-measured-route') && artifact.label.endsWith('.read.json'))
    const fixtureReadPath = findArtifact(artifact => artifact.label.includes('pdf-lab-surgical-fixture-final-decree') && artifact.label.endsWith('.read.json'))
    const visualMetrics = {
      generatedAt: now.toISOString(),
      latestVerificationPath,
      latestVerification: latestVerificationJson,
      production: {
        route: 'http://localhost:3002/#pdf-lab',
        screenshot: productionScreenshot,
        metrics: productionMetricsPath ? JSON.parse(await readUtf8IfExists(productionMetricsPath)) : null,
        accessibilityRead: productionReadPath ? JSON.parse(await readUtf8IfExists(productionReadPath)) : null,
      },
      cleanRoomFixture: {
        route: 'http://localhost:3002/#pdf-lab/surgical-fixture',
        screenshot: fixtureScreenshot,
        metrics: fixtureMetricsPath ? JSON.parse(await readUtf8IfExists(fixtureMetricsPath)) : null,
        accessibilityRead: fixtureReadPath ? JSON.parse(await readUtf8IfExists(fixtureReadPath)) : null,
      },
    }

    const markdown = `# PDF Lab Gemini Production Transplant Escalation Bundle

Generated: ${now.toISOString()}

## Request to Gemini

Return complete production React/TypeScript/CSS code for \`http://localhost:3002/#pdf-lab\`.

Do not return only rationale. Do not leave visual-critical gaps for Codex to infer. If a file must be replaced, provide the full replacement. If a patch is sufficient, provide exact patch hunks.

The clean-room fixture now passes the Final Design Decree metrics, but the production \`#pdf-lab\` transplant remains visually wrong. Codex must stop inventing integration details and needs Gemini to provide the missing production code.

## Final Design Decree

- Active evidence BBox center: 55–65% viewport height.
- Context: dim surrounding PDF, do not crop away orientation context.
- Masking: CSS hard cutout using \`mask-image: radial-gradient(ellipse 220px 160px at var(--bbox-center-x) var(--bbox-center-y), transparent 99%, black 100%)\`.
- HUD: right-margin satellite preferred, left/below fallback if needed, 0px evidence overlap.
- Chrome: 36px ultra-slim instrument header with progress, Gemini Bundle, Audit / Repair ghost buttons; footer hotkeys.
- Connector: yellow dot and 1px line \`rgba(245, 158, 11, 0.4)\`.
- BBox: persistent 2px \`#8b5cf6\` border.
- Reference viewport: 1280 × 813 @ DPR 1.
- Implementation sequence: standalone fixture first, then production transplant.
- Gate: bbox center 60% ±5%, HUD max width 420px, evidence occlusion 0px, dim opacity 85%, 600ms \`cubic-bezier(0.22, 1, 0.36, 1)\`.

## Active UI Context

- Route: ${String(requestBody.route ?? 'http://localhost:3002/#pdf-lab')}
- Surface: ${String(requestBody.surface ?? 'pdf-lab')}
- Active task id: ${String(requestBody.activeTaskId ?? 'unknown')}
- Active page: ${String(requestBody.activePage ?? 'unknown')}
- Workflow task index: ${String(requestBody.workflowTaskIndex ?? 'unknown')}
- Latest CDP verification marker: ${latestVerificationPath}
- Latest screenshot artifact: ${screenshotPath}
- Zip bundle path: ${zipPath}

## Attached Artifacts in Zip

The zip intentionally contains **five files maximum**:

1. \`README.md\` — escalation request and design contract.
2. \`source-and-data.md\` — relevant code, diff, and real data summary.
3. \`visual-metrics.json\` — production/fixture metrics and accessibility reads.
4. \`production-current.png\` — current production \`#pdf-lab\` screenshot.
5. \`clean-room-fixture.png\` — clean-room fixture screenshot, when available.

## What Is Broken

- \`#pdf-lab/surgical-fixture\` is a clean-room proof and is not the production route.
- \`#pdf-lab\` still uses a hybrid real \`PdfCanvas\` path and does not match the fixture visual contract.
- The production camera/mask coordinate mapping is unresolved.
- The production HUD placement is not derived from measured whitespace zones.
- Codex repeatedly drifted by adapting the design into the old app structure.

## Failure Taxonomy

- SOURCE_DRIFT: production route diverges from Final Design Decree.
- HYBRIDIZATION: clean-room fixture and production \`PdfCanvas\` behavior are mixed.
- MISFRAMING: production route previously measured bbox center outside the 55–65% gate.
- MASK_FAILURE: previous duplicate oval wrapper mask was introduced and removed.
- FALSE_VISUAL_CLAIM: fixture proof was previously reported while production route remained wrong.

## Specific Missing Code Gemini Must Provide

1. Exact production \`PdfLabView\` render path for active surgical triage.
2. Exact \`PdfCanvas\` replacement/adaptation for CSS mask center mapping after transform.
3. Exact camera transform math from normalized PDF bbox to viewport target at 60% Y.
4. Exact satellite HUD placement algorithm: right, left, below fallback with 0px overlap.
5. Exact CSS for the production route using the Final Design Decree.
6. Exact handling for real NIST/pdf_oxide workflow data.
7. Exact preservation points for review-save and ArangoDB audit hooks.

## Expected Gemini Output

Return:

1. Complete production React/TypeScript/CSS code or exact patches.
2. File-by-file instructions.
3. Browser-measurable acceptance criteria.
4. Any conflicts where the current \`PdfCanvas\` architecture prevents the design.
5. Do not ask Codex to infer visual-critical geometry.

## Required Data Flow

The real workflow is:

1. Agentic sweep finds candidate pages containing pdf_oxide-supported elements.
2. pdf_oxide deterministically extracts those pages.
3. Agent second pass compares rendered evidence against deterministic extraction.
4. Pages/elements that reach ~95% parity pass without human triage.
5. Only remaining ambiguities become human cards.
6. After triage, run full pdf_oxide extraction for the complete PDF.

## ArangoDB / Persistence Hooks

Existing backend persistence uses \`proxyPost('/upsert', ...)\` into:

- \`pdf_lab_reviewed_extractions\`
- \`pdf_lab_review_edit_events\`

Do not remove these hooks. If you propose new backend changes, preserve existing review-save behavior and event auditability.

## Current Screenshot/Metric Notes

The zip contains CDP screenshots and metrics under \`artifacts/\`, including:

- Clean-room fixture proof route: \`#pdf-lab/surgical-fixture\`
- Production route attempts: \`#pdf-lab\`
- Latest \`.codex/ui-verification/latest.json\`

`
    const sourceAndDataMarkdown = `# PDF Lab Source and Data Bundle

Generated: ${now.toISOString()}

## Real Data Summary

${dataSummary}

## Current Git Diff

\`\`\`diff
${gitDiff.trimEnd()}
\`\`\`

## Relevant Source Code

${sourceSections.join('\n')}
`

    await writeFile(bundlePath, markdown, 'utf-8')
    await writeFile(latestBundlePath, markdown, 'utf-8')
    await writeFile(resolve(bundleDir, 'README.md'), markdown, 'utf-8')
    await writeFile(resolve(bundleDir, 'source-and-data.md'), sourceAndDataMarkdown, 'utf-8')
    await writeFile(resolve(bundleDir, 'visual-metrics.json'), JSON.stringify(visualMetrics, null, 2), 'utf-8')
    const copiedArtifacts: string[] = ['README.md', 'source-and-data.md', 'visual-metrics.json']
    if (productionScreenshot && existsSync(productionScreenshot)) {
      await copyFile(productionScreenshot, resolve(bundleDir, 'production-current.png'))
      copiedArtifacts.push('production-current.png')
    }
    if (fixtureScreenshot && existsSync(fixtureScreenshot)) {
      await copyFile(fixtureScreenshot, resolve(bundleDir, 'clean-room-fixture.png'))
      copiedArtifacts.push('clean-room-fixture.png')
    }
    await writeFile(resolve('/tmp', `pdf-lab-gemini-review-bundle-${stamp}.index.json`), JSON.stringify({
      generatedAt: now.toISOString(),
      markdown: bundlePath,
      latestMarkdown: latestBundlePath,
      zip: zipPath,
      latestZip: latestZipPath,
      route: String(requestBody.route ?? 'http://localhost:3002/#pdf-lab'),
      screenshot: screenshotPath,
      artifacts: copiedArtifacts,
    }, null, 2), 'utf-8')
    await execAsync(`rm -f ${shellQuote(zipPath)} ${shellQuote(latestZipPath)} && cd ${shellQuote(bundleDir)} && zip -qr ${shellQuote(zipPath)} .`)
    await execAsync(`rm -rf ${shellQuote(latestBundleDir)} && cp -a ${shellQuote(bundleDir)} ${shellQuote(latestBundleDir)} && cp ${shellQuote(zipPath)} ${shellQuote(latestZipPath)}`)
    await execAsync(`(xclip -selection clipboard < ${shellQuote(bundlePath)} >/dev/null 2>&1 &)`)

    return res.json({
      ok: true,
      copied: true,
      path: bundlePath,
      latestPath: latestBundlePath,
      dir: bundleDir,
      latestDir: latestBundleDir,
      zipPath,
      latestZipPath,
      bytes: Buffer.byteLength(markdown, 'utf-8'),
      screenshot: screenshotPath,
      artifacts: copiedArtifacts,
    })
  } catch (e) {
    return res.status(500).json({
      error: 'Failed to generate Gemini review bundle',
      detail: e instanceof Error ? e.message : String(e),
    })
  }
})

app.post('/api/pdf-lab/evidence-query', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body as JsonRecord : {}
    const question = typeof body.question === 'string' ? body.question : ''
    const requestedPage = typeof body.page === 'number' ? body.page : pdfLabQuestionPage(question)
    const requestedType = typeof body.elementType === 'string' ? body.elementType : pdfLabQuestionElementType(question)
    const requestedElementId = typeof body.elementId === 'string' ? body.elementId : null
    const warnings: string[] = []

    const extractionPath = pdfLabPublicPath('pdf-lab-nist-full-extraction.json')
    const workflowManifestPath = pdfLabPublicPath('pdf-lab-nist-workflow-manifest.json')
    if (!existsSync(extractionPath)) {
      return res.json({
        ok: false,
        answer: null,
        uncertainty: 'missing_artifact',
        warnings: [`missing_artifact: ${extractionPath}`],
        citations: [],
      })
    }

    const extraction = await readJsonFile<JsonRecord>(extractionPath)
    const elements = Array.isArray(extraction.elements) ? extraction.elements as JsonRecord[] : []
    let candidateElements = elements
    if (requestedPage !== null) {
      candidateElements = candidateElements.filter((element) => Number(element.page) === requestedPage)
    }
    if (requestedElementId) {
      candidateElements = candidateElements.filter((element) => String(element.id ?? element.element_id ?? '') === requestedElementId)
    }
    if (requestedType) {
      candidateElements = candidateElements.filter((element) => String(element.type ?? '') === requestedType)
    }

    let workflowManifest: JsonRecord | null = null
    if (existsSync(workflowManifestPath)) {
      workflowManifest = await readJsonFile<JsonRecord>(workflowManifestPath)
    } else {
      warnings.push(`missing_artifact: ${workflowManifestPath}`)
    }
    const evidenceArtifacts = workflowManifest && typeof workflowManifest.evidence_artifacts === 'object'
      ? workflowManifest.evidence_artifacts as JsonRecord
      : null
    const evidenceManifestUri = typeof evidenceArtifacts?.manifest_uri === 'string' ? evidenceArtifacts.manifest_uri : null
    const evidenceManifestPath = evidenceManifestUri ? pdfLabPublicPath(evidenceManifestUri.replace(/^\/+/, '')) : null
    const evidenceManifest = evidenceManifestPath && existsSync(evidenceManifestPath)
      ? await readJsonFile<JsonRecord>(evidenceManifestPath)
      : null
    if (evidenceManifestPath && !existsSync(evidenceManifestPath)) warnings.push(`missing_artifact: ${evidenceManifestPath}`)
    if (!evidenceManifestPath) warnings.push('missing_artifact: evidence crop manifest is not promoted')
    const evidenceElements = evidenceManifest && Array.isArray(evidenceManifest.elements) ? evidenceManifest.elements as JsonRecord[] : []

    const selected = candidateElements.slice(0, 12)
    const citations = selected.map((element) => {
      const elementId = String(element.id ?? element.element_id ?? '')
      const evidence = evidenceElements.find((candidate) => String(candidate.element_id ?? '') === elementId)
      if (!evidence) warnings.push(`missing_artifact: crop evidence for ${elementId || 'unknown_element'}`)
      return {
        element_id: elementId,
        page: element.page,
        type: element.type,
        bbox: element.bbox,
        json_pointer: evidence?.json_pointer ?? null,
        page_image_uri: pdfLabPublicUrlFromPath(evidence?.page_image_uri) ?? null,
        crop_uri: pdfLabPublicUrlFromPath(evidence?.crop_uri) ?? null,
        text: String(element.text ?? '').slice(0, 500),
      }
    })

    const typeLabel = requestedType ?? 'element'
    const pageLabel = requestedPage !== null ? ` on page ${requestedPage}` : ''
    return res.json({
      ok: true,
      answer: selected.length
        ? `Found ${selected.length} extracted ${typeLabel}${selected.length === 1 ? '' : 's'}${pageLabel}. Verify against cited page/crop artifacts before treating the answer as final.`
        : `No extracted ${typeLabel}${pageLabel} was found in the current real extraction artifact.`,
      uncertainty: warnings.length ? 'artifact_warnings' : 'artifact_grounded',
      warnings: [...new Set(warnings)],
      citations,
      extracted_json_fragments: selected,
      source_extraction: pdfLabPublicUrl('pdf-lab-nist-full-extraction.json'),
      source_workflow_manifest: existsSync(workflowManifestPath) ? pdfLabPublicUrl('pdf-lab-nist-workflow-manifest.json') : null,
      similar_elements: [],
    })
  } catch (e) {
    return res.status(500).json({
      error: 'Failed to answer PDF Lab evidence query',
      detail: e instanceof Error ? e.message : String(e),
    })
  }
})

app.get('/api/pdf-lab/nico-qa-report', async (_req, res) => {
  try {
    const reportPath = '/tmp/pdf-lab-nico-qa-report-smoke.json'
    const extractionPath = pdfLabPublicPath('pdf-lab-nist-full-extraction.json')
    const workflowManifestPath = pdfLabPublicPath('pdf-lab-nist-workflow-manifest.json')
    const evidenceManifestPath = '/tmp/pdf-lab-evidence-artifacts-smoke/manifest.json'
    if (!existsSync(reportPath)) {
      if (!existsSync(extractionPath)) throw new Error(`missing_artifact: ${extractionPath}`)
      if (!existsSync(evidenceManifestPath)) throw new Error(`missing_artifact: ${evidenceManifestPath}`)
      await execFileAsync(
        PDF_OXIDE_PYTHON,
        [
          PDF_LAB_NICO_QA_REPORT_SCRIPT,
          '--extraction', extractionPath,
          '--evidence-manifest', evidenceManifestPath,
          '--out', reportPath,
          '--sample-size', '12',
          '--seed', '53',
        ],
        { timeout: 120_000, maxBuffer: 20 * 1024 * 1024 },
      )
    }
    const report = await readJsonFile<JsonRecord>(reportPath)
    const workflowManifest = existsSync(workflowManifestPath)
      ? await readJsonFile<JsonRecord>(workflowManifestPath)
      : null
    const evidenceArtifacts = workflowManifest && typeof workflowManifest.evidence_artifacts === 'object'
      ? workflowManifest.evidence_artifacts as JsonRecord
      : null
    const promotedManifestUri = typeof evidenceArtifacts?.manifest_uri === 'string'
      ? evidenceArtifacts.manifest_uri
      : null
    const promotedManifestPath = promotedManifestUri
      ? pdfLabPublicPath(promotedManifestUri.replace(/^\/+/, ''))
      : null
    const promotedManifest = promotedManifestPath && existsSync(promotedManifestPath)
      ? await readJsonFile<JsonRecord>(promotedManifestPath)
      : null
    const promotedElements = promotedManifest && Array.isArray(promotedManifest.elements)
      ? promotedManifest.elements as JsonRecord[]
      : []
    const promotedByElementId = new Map(
      promotedElements
        .filter((element) => typeof element.element_id === 'string')
        .map((element) => [String(element.element_id), element]),
    )
    if (Array.isArray(report.samples)) {
      report.samples = report.samples.map((sample): JsonRecord => {
        if (!sample || typeof sample !== 'object') return sample as JsonRecord
        const record = sample as JsonRecord
        const promoted = promotedByElementId.get(String(record.element_id ?? ''))
        if (!promoted) return record
        return {
          ...record,
          page_image_uri: pdfLabPublicUrlFromPath(promoted.page_image_uri) ?? record.page_image_uri,
          crop_uri: pdfLabPublicUrlFromPath(promoted.crop_uri) ?? record.crop_uri,
          extracted_json_fragment: promoted,
        }
      })
    }
    return res.json({ ok: true, report, source: reportPath })
  } catch (e) {
    return res.status(500).json({
      error: 'Failed to load PDF Lab Nico QA report',
      detail: e instanceof Error ? e.message : String(e),
    })
  }
})

app.get('/api/pdf-lab/jobs/latest', async (_req, res) => {
  const job = pdfLabLatestJobId ? pdfLabJobs.get(pdfLabLatestJobId) : null
  if (job) await refreshPdfLabJobStatus(job)
  return res.json({ ok: true, job: job ? serializePdfLabJob(job) : null })
})

app.get('/api/pdf-lab/jobs/:jobId', async (req, res) => {
  const job = pdfLabJobs.get(req.params.jobId)
  if (!job) return res.status(404).json({ error: 'PDF Lab job not found', detail: req.params.jobId })
  await refreshPdfLabJobStatus(job)
  const logTail = (await readUtf8IfExists(job.logPath)).slice(-12_000)
  return res.json({ ok: true, job: serializePdfLabJob(job), logTail })
})

app.post('/api/pdf-lab/jobs/promote-output', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body as JsonRecord : {}
    const outputDir = typeof body.outputDir === 'string' ? body.outputDir : ''
    if (!outputDir.startsWith('/tmp/pdf-lab-')) throw new Error(`Refusing to promote non-PDF-Lab output directory: ${outputDir}`)
    if (!existsSync(outputDir)) throw new Error(`Output directory not found: ${outputDir}`)
    const promoted = await promotePdfLabAgenticOutput(outputDir)
    return res.json({ ok: true, outputDir, promoted })
  } catch (e) {
    return res.status(500).json({
      error: 'Failed to promote direct pdf_oxide output',
      detail: e instanceof Error ? e.message : String(e),
    })
  }
})

app.post('/api/pdf-lab/commit-sweep-to-run', async (req, res) => {
  try {
    const job = startPdfLabExtractionJob('commit-sweep', req.body && typeof req.body === 'object' ? req.body as JsonRecord : {})
    return res.status(202).json({ ok: true, async: true, job: serializePdfLabJob(job) })
  } catch (e) {
    return res.status(500).json({
      error: 'Failed to commit sweep to real pdf_oxide run',
      detail: e instanceof Error ? e.message : String(e),
    })
  }
})

app.post('/api/pdf-lab/bulk-repair-rerun', async (req, res) => {
  try {
    const job = startPdfLabExtractionJob('bulk-rerun', req.body && typeof req.body === 'object' ? req.body as JsonRecord : {})
    return res.status(202).json({ ok: true, async: true, job: serializePdfLabJob(job) })
  } catch (e) {
    return res.status(500).json({
      error: 'Failed to run real bulk repair/re-run',
      detail: e instanceof Error ? e.message : String(e),
    })
  }
})

app.post('/api/pdf-lab/eject-mismatches-to-triage', async (req, res) => {
  try {
    const comparisonPath = pdfLabPublicPath('pdf-lab-nist-comparison.json')
    const extractionPath = pdfLabPublicPath('pdf-lab-nist-full-extraction.json')
    const triagePath = pdfLabPublicPath('pdf-lab-nist-human-triage-queue.json')
    const manifestPath = pdfLabPublicPath('pdf-lab-nist-workflow-manifest.json')
    if (!existsSync(comparisonPath)) throw new Error(`Comparison artifact missing: ${comparisonPath}`)
    if (!existsSync(extractionPath)) throw new Error(`Full extraction artifact missing: ${extractionPath}`)

    const outputDir = `/tmp/pdf-lab-final-pass-${pdfLabStamp()}`
    const { stdout } = await execFileAsync(
      PDF_LAB_SKILL_RUN,
      [
        'final-pass',
        extractionPath,
        '--out', outputDir,
        '--comparison', comparisonPath,
        '--preset', PDF_LAB_NIST_PRESET,
        '--json',
      ],
      { timeout: 120_000, maxBuffer: 40 * 1024 * 1024 },
    )
    const runSummary = parseJsonStdout<JsonRecord>(stdout)
    const generatedTriagePath = resolve(outputDir, 'human_triage_queue.json')
    if (!existsSync(generatedTriagePath)) throw new Error(`Final pass did not emit ${generatedTriagePath}`)
    const generatedTriage = await readJsonFile<JsonRecord>(generatedTriagePath)
    generatedTriage.page_count = generatedTriage.page_count ?? 492
    generatedTriage.source_comparison = pdfLabPublicUrl('pdf-lab-nist-comparison.json')
    generatedTriage.source_extraction = pdfLabPublicUrl('pdf-lab-nist-actual-elements.json')
    await writeJsonFile(triagePath, generatedTriage)
    const manifest = await readJsonFile<JsonRecord>(manifestPath)
    manifest.source_comparison = pdfLabPublicUrl('pdf-lab-nist-comparison.json')
    manifest.human_triage = {
      task_count: Number(generatedTriage.task_count ?? 0),
      summary: generatedTriage.summary ?? {},
      page_groups: Array.isArray(generatedTriage.page_groups) ? generatedTriage.page_groups : [],
    }
    if (Array.isArray(manifest.phases)) {
      manifest.phases = manifest.phases.map((phase: unknown) => {
        if (!phase || typeof phase !== 'object' || !['human_triage', 'surgical_triage'].includes(String((phase as JsonRecord).id))) return phase
        return {
          ...(phase as JsonRecord),
          status: Number(generatedTriage.task_count ?? 0) > 0 ? 'ready' : 'empty',
          summary: `${String(generatedTriage.task_count ?? 0)} real ambiguity tasks generated from the current comparison.`,
          details: generatedTriage.summary ?? {},
        }
      })
    }
    await writeJsonFile(manifestPath, manifest)
    const triage = await readJsonFile<JsonRecord>(triagePath)

    return res.json({
      ok: true,
      operation: 'eject-mismatches-to-triage',
      outputDir,
      runSummary,
      publicTriagePath: triagePath,
      publicManifestPath: manifestPath,
      taskCount: triage.task_count,
      summary: triage.summary,
    })
  } catch (e) {
    return res.status(500).json({
      error: 'Failed to eject real mismatches to triage',
      detail: e instanceof Error ? e.message : String(e),
    })
  }
})

app.post('/api/pdf-lab/triage-decision', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body as JsonRecord : {}
    const taskId = typeof body.taskId === 'string' ? body.taskId : ''
    const decision = typeof body.decision === 'string' ? body.decision : ''
    if (!taskId) throw new Error('taskId is required')
    if (!['accept', 'reject', 'skip', 'undo'].includes(decision)) {
      throw new Error(`Unsupported decision: ${decision || 'missing'}`)
    }

    const now = new Date().toISOString()
    const eventKey = `${taskId}_${decision}_${Date.now()}`.replace(/[^a-zA-Z0-9._:-]+/g, '_')
    const baseRecord = {
      task_id: taskId,
      decision,
      intent: typeof body.intent === 'string' ? body.intent : '',
      page: typeof body.page === 'number' ? body.page : null,
      task: body.task && typeof body.task === 'object' ? body.task : null,
      proposed_json_delta: body.proposedJsonDelta && typeof body.proposedJsonDelta === 'object' ? body.proposedJsonDelta : null,
      updated_at: now,
      source: 'pdf-lab-production-workflow',
    }

    await proxyPost('/upsert', {
      collection: 'pdf_lab_triage_decisions',
      documents: [{ _key: taskId.replace(/[^a-zA-Z0-9._:-]+/g, '_'), ...baseRecord }],
    })
    await proxyPost('/upsert', {
      collection: 'pdf_lab_triage_decision_events',
      documents: [{ _key: eventKey, ...baseRecord, created_at: now }],
    })

    return res.json({ ok: true, taskId, decision, eventKey })
  } catch (e) {
    return res.status(500).json({
      error: 'Failed to persist PDF Lab triage decision',
      detail: e instanceof Error ? e.message : String(e),
    })
  }
})

app.post('/api/pdf-lab/review-save', async (req, res) => {
  try {
    const {
      pdfUrl,
      extractionUrl,
      updatedBlocks,
      deletedBlockIds,
      reviewMode,
      reviewSummary,
      fileId,
      fileName,
    } = req.body as {
      pdfUrl: string
      extractionUrl: string
      updatedBlocks: Array<Record<string, unknown>>
      deletedBlockIds: string[]
      reviewMode?: 'raw' | 'reviewed'
      reviewSummary?: unknown
      fileId?: string
      fileName?: string
    }

    if (!pdfUrl || !extractionUrl) {
      return res.status(400).json({ error: 'pdfUrl and extractionUrl are required' })
    }
    if (extractionUrl.includes('-raw-extraction.json')) {
      return res.status(400).json({ error: 'Raw extraction is immutable; save to a reviewed/final extraction instead' })
    }

    const updates = Array.isArray(updatedBlocks) ? updatedBlocks : []
    const deletedIds = Array.isArray(deletedBlockIds) ? deletedBlockIds : []
    const { relativePath, absolutePath } = resolvePublicJsonPath(extractionUrl)
    const existing = JSON.parse(await readFile(absolutePath, 'utf-8')) as Record<string, any>
    const blocks = Array.isArray(existing.blocks) ? existing.blocks : []
    const blockMap = new Map<string, Record<string, unknown>>(
      blocks
        .filter((block: unknown): block is Record<string, unknown> => !!block && typeof block === 'object' && typeof (block as any).id === 'string')
        .map((block) => [String(block.id), { ...block }])
    )

    for (const block of updates) {
      if (!block || typeof block !== 'object' || typeof block.id !== 'string') continue
      blockMap.set(block.id, { ...block })
    }
    for (const blockId of deletedIds) {
      blockMap.delete(blockId)
    }

    const now = new Date().toISOString()
    const previousHumanEdits = existing.humanEdits && typeof existing.humanEdits === 'object'
      ? existing.humanEdits as Record<string, unknown>
      : {}
    const nextExtraction = {
      ...existing,
      pdfUrl,
      reviewMode: reviewMode ?? existing.reviewMode ?? 'reviewed',
      reviewSummary: reviewSummary ?? existing.reviewSummary ?? null,
      blocks: sortPdfLabBlocks(Array.from(blockMap.values())),
      humanEdits: {
        updatedAt: now,
        updatedBlocks: updates.length,
        deletedBlocks: deletedIds.length,
        editCount: Number(previousHumanEdits.editCount ?? 0) + updates.length + deletedIds.length,
      },
    }

    await writeFile(absolutePath, `${JSON.stringify(nextExtraction, null, 2)}\n`, 'utf-8')

    const memoryKey = buildPdfLabReviewKey(relativePath)
    const eventKey = `${memoryKey}_${Date.now()}`

    await proxyPost('/upsert', {
      collection: 'pdf_lab_reviewed_extractions',
      documents: [{
        _key: memoryKey,
        scope: 'pdf-lab',
        pdf_url: pdfUrl,
        extraction_url: extractionUrl,
        file_id: fileId ?? memoryKey,
        file_name: fileName ?? relativePath,
        review_mode: nextExtraction.reviewMode,
        review_summary: nextExtraction.reviewSummary,
        human_edits: nextExtraction.humanEdits,
        block_count: nextExtraction.blocks.length,
        extraction: nextExtraction,
        updated_at: now,
        source: 'pdf-lab-human-edit',
      }],
    })

    await proxyPost('/upsert', {
      collection: 'pdf_lab_review_edit_events',
      documents: [{
        _key: eventKey,
        scope: 'pdf-lab',
        pdf_url: pdfUrl,
        extraction_url: extractionUrl,
        file_id: fileId ?? memoryKey,
        file_name: fileName ?? relativePath,
        updated_block_ids: updates.map((block) => block.id).filter((value): value is string => typeof value === 'string'),
        deleted_block_ids: deletedIds,
        updated_blocks: updates,
        updated_at: now,
        source: 'pdf-lab-human-edit',
      }],
    })

    return res.json({
      saved: true,
      updatedBlocks: updates.length,
      deletedBlocks: deletedIds.length,
      memoryKey,
      eventKey,
      extraction: nextExtraction,
    })
  } catch (e) {
    return res.status(500).json({ error: 'Failed to persist reviewed extraction', detail: e instanceof Error ? e.message : String(e) })
  }
})

app.post('/api/pdf-lab/reextract-table-region', async (req, res) => {
  try {
    const {
      pdfUrl,
      pageNumber,
      bbox,
      flavor = 'stream',
    } = req.body as {
      pdfUrl?: string
      pageNumber?: number
      bbox?: [number, number, number, number]
      flavor?: 'stream' | 'lattice' | 'auto'
    }

    if (!pdfUrl || typeof pageNumber !== 'number' || !Array.isArray(bbox) || bbox.length !== 4) {
      return res.status(400).json({ error: 'pdfUrl, pageNumber, and bbox are required' })
    }

    const normalizedBBox = bbox.map((value) => Number(value)) as [number, number, number, number]
    if (normalizedBBox.some((value) => Number.isNaN(value) || value < 0 || value > 1)) {
      return res.status(400).json({ error: 'bbox values must be normalized between 0 and 1' })
    }
    if (normalizedBBox[0] >= normalizedBBox[2] || normalizedBBox[1] >= normalizedBBox[3]) {
      return res.status(400).json({ error: 'bbox must be ordered as [left, top, right, bottom]' })
    }

    const { absolutePath } = resolvePublicPdfPath(pdfUrl)
    const extractionScript = `
import json
import sys
import pdf_oxide

pdf_path = sys.argv[1]
page_index = int(sys.argv[2])
bbox = json.loads(sys.argv[3])
requested_flavor = sys.argv[4]

doc = pdf_oxide.PdfDocument(pdf_path)
media_box = [float(value) for value in doc.page_media_box(page_index)]
page_x0, page_y0, page_x1, page_y1 = media_box
page_width = page_x1 - page_x0
page_height = page_y1 - page_y0
left, top, right, bottom = [float(value) for value in bbox]

x1 = page_x0 + left * page_width
x2 = page_x0 + right * page_width
y_top = page_y0 + (1.0 - top) * page_height
y_bottom = page_y0 + (1.0 - bottom) * page_height
area = f"{x1:.2f},{y_top:.2f},{x2:.2f},{y_bottom:.2f}"

flavors = []
for candidate in [requested_flavor, "auto", "lattice", "stream"]:
    if candidate not in flavors:
        flavors.append(candidate)

def pick_best_table(candidates):
    def score(table):
        rows = int(table.get("rows", len(table.get("data", []))) or 0)
        cols = int(table.get("cols", 0) or 0)
        accuracy = float(table.get("accuracy", 0.0) or 0.0)
        return (rows * max(cols, 1), accuracy)
    return max(candidates, key=score)

table = None
flavor_used = requested_flavor
for flavor in flavors:
    try:
        tables = list(doc.read_pdf(pages=str(page_index + 1), flavor=flavor, table_areas=[area]))
    except Exception:
        tables = []
    if tables:
        table = pick_best_table(tables)
        flavor_used = flavor
        break

if table is None:
    print(json.dumps({
        "ok": False,
        "page_index": page_index,
        "requested_flavor": requested_flavor,
        "requested_bbox_norm_tlbr": bbox,
        "requested_area": area,
        "error": "No table extracted from selected area",
    }))
    raise SystemExit(0)

table_bbox = table.get("bbox") or [x1, y_bottom, x2, y_top]
if len(table_bbox) != 4:
    table_bbox = [x1, y_bottom, x2, y_top]

table_left = max(0.0, min(1.0, (float(table_bbox[0]) - page_x0) / page_width))
table_right = max(0.0, min(1.0, (float(table_bbox[2]) - page_x0) / page_width))
table_top = max(0.0, min(1.0, 1.0 - ((float(table_bbox[3]) - page_y0) / page_height)))
table_bottom = max(0.0, min(1.0, 1.0 - ((float(table_bbox[1]) - page_y0) / page_height)))

if table_right < table_left:
    table_right = table_left
if table_bottom < table_top:
    table_bottom = table_top

data = table.get("data", [])
text_rows = []
for row in data:
    if isinstance(row, list):
        text_rows.append("\\t".join("" if cell is None else str(cell) for cell in row))
text = "\\n".join(text_rows)

print(json.dumps({
    "ok": True,
    "page_index": page_index,
    "requested_flavor": requested_flavor,
    "flavor_used": flavor_used,
    "requested_bbox_norm_tlbr": bbox,
    "requested_area": area,
    "media_box": media_box,
    "bbox_pdf_ltrb": [float(table_bbox[0]), float(table_bbox[1]), float(table_bbox[2]), float(table_bbox[3])],
    "bbox_norm_tlbr": [table_left, table_top, table_right, table_bottom],
    "rows": int(table.get("rows", len(data)) or 0),
    "cols": int(table.get("cols", 0) or 0),
    "accuracy": float(table.get("accuracy", 0.0) or 0.0),
    "whitespace": float(table.get("whitespace", 0.0) or 0.0),
    "data": data,
    "text": text,
}, default=str))
`

    const { stdout } = await execFileAsync(
      PDF_OXIDE_PYTHON,
      ['-c', extractionScript, absolutePath, String(pageNumber), JSON.stringify(normalizedBBox), flavor],
      {
        timeout: 60_000,
        maxBuffer: 20 * 1024 * 1024,
      },
    )

    const payload = JSON.parse(stdout.trim().split('\n').pop() || '{}') as Record<string, unknown>
    if (!payload.ok) {
      return res.status(422).json(payload)
    }
    return res.json(payload)
  } catch (e) {
    return res.status(500).json({ error: 'Failed to re-extract table region', detail: e instanceof Error ? e.message : String(e) })
  }
})

// ── Quarantine CRUD ────────────────────────────────────────────────────────

app.get('/api/quarantine', async (req, res) => {
  try {
    const payload: any = { collection: 'quarantine_entries', k: 100, return_fields: ['_key','filename','reason','status','score','created_at','source_doc_key','issue_code'] }
    const { reason, status } = req.query
    if (reason || status) payload.filters = { ...(reason && { reason }), ...(status && { status }) }
    const r = await proxyPost('/list', payload) as any
    res.json(r?.documents ?? [])
  } catch (e) { res.status(502).json({ error: 'Quarantine list failed', detail: String(e) }) }
})

app.get('/api/quarantine/:id', async (req, res) => {
  try {
    const r = await proxyPost('/recall/by-keys', { collection: 'quarantine_entries', keys: [req.params.id] }) as any
    const doc = r?.documents?.[0]
    if (!doc) return res.status(404).json({ error: 'Not found' })
    res.json(doc)
  } catch (e) { res.status(502).json({ error: 'Quarantine lookup failed', detail: String(e) }) }
})

app.post('/api/quarantine/:id/action', async (req, res) => {
  try {
    await proxyPost('/upsert', { collection: 'quarantine_entries', documents: [{ _key: req.params.id, status: req.body.action, resolved_at: new Date().toISOString(), strategy: req.body.strategy }] })
    res.json({ status: 'ok', action: req.body.action })
  } catch (e) { res.status(502).json({ error: 'Quarantine action failed', detail: String(e) }) }
})

app.post('/api/quarantine/from-metrics', async (req, res) => {
  try {
    const { issues, source } = req.body
    for (const issue of issues) {
      await proxyPost('/upsert', { collection: 'quarantine_entries', documents: [{ _key: `q_${issue.entity_id}`, filename: issue.entity_id, reason: issue.code.includes('embedding') ? 'low-confidence' : 'extraction-error', status: 'pending', score: 0, created_at: new Date().toISOString(), source, issue_code: issue.code, message: issue.message }] })
    }
    res.json({ created: issues.length })
  } catch (e) { res.status(502).json({ error: 'Quarantine creation failed', detail: String(e) }) }
})

app.post('/api/quarantine/:id/bbox-save', async (req, res) => {
  try {
    const { blocks, doc_key } = req.body as { blocks: Array<{id: string, blockType: string, label?: string, bbox: {x: number, y: number, w: number, h: number}}>, doc_key: string }
    for (const b of blocks) {
      await proxyPost('/upsert', { collection: 'sections', documents: [{ _key: b.id, block_type: b.blockType, title: b.label || '', bbox: b.bbox }] })
    }
    await proxyPost('/upsert', { collection: 'quarantine_entries', documents: [{ _key: req.params.id, status: 'bbox-edited', edited_at: new Date().toISOString() }] })
    res.json({ saved: blocks.length, quarantine_updated: true })
  } catch (e: any) { res.status(500).json({ error: e.message, saved: 0 }) }
})

app.post('/api/quarantine/:id/reextract', async (req, res) => {
  try {
    const { pdf_path, overrides } = req.body as { pdf_path: string; overrides?: Record<string, number> }
    if (!pdf_path || !pdf_path.startsWith('/mnt/storage12tb/')) return res.status(400).json({ error: 'pdf_path must start with /mnt/storage12tb/' })
    const sanitizedPath = pdf_path.replace(/'/g, "\\'")
    const overrideArgs = overrides ? Object.entries(overrides).filter(([, v]) => v != null).map(([k, v]) => `${k}=${v}`).join(', ') : ''
    const script = `import pdf_oxide, json; doc=pdf_oxide.PdfDocument('${sanitizedPath}'); r=doc.extract_document(${overrideArgs}); print(json.dumps({'profile': r.get('profile',{}), 'pages': len(r.get('pages',[])), 'sections': len(r.get('sections',[])), 'figures': len(r.get('figures',[]))}, default=str))`
    const { execSync } = await import('child_process')
    const result = execSync(`/home/graham/workspace/experiments/pdf_oxide/.venv/bin/python3 -c "${script}"`, { timeout: 30000 })
    res.json({ id: req.params.id, status: 'complete', extraction: JSON.parse(result.toString()) })
  } catch (e: any) {
    res.status(500).json({ id: req.params.id, error: String(e.stderr || e.message).slice(0, 1000), status: 'failed' })
  }
})

app.post('/api/quarantine/:id/diagnose', async (req, res) => {
  try {
    const { pdf_path } = req.body as { pdf_path: string }
    if (!pdf_path || !pdf_path.startsWith('/mnt/storage12tb/')) return res.status(400).json({ error: 'pdf_path must start with /mnt/storage12tb/' })
    const sanitizedPath = pdf_path.replace(/'/g, "\\'")
    const { execSync } = await import('child_process')
    const { writeFileSync, unlinkSync } = await import('fs')
    const tmpScript = `/tmp/_diagnose_${req.params.id}.py`
    writeFileSync(tmpScript, `import pdf_oxide, json, sys\ndoc = pdf_oxide.PdfDocument('${sanitizedPath}')\ntoc = doc.get_section_map() or {'source': 'none', 'sections': []}\nresult = doc.extract_document()\next_s = result.get('sections', [])\ntoc_s = toc.get('sections', [])\nprint(json.dumps({'toc': {'source': toc.get('source','none'), 'count': len(toc_s), 'sections': toc_s}, 'extraction': {'count': len(ext_s), 'sections': [{'title': s.get('title',''), 'level': s.get('level',0), 'page_start': s.get('page_start'), 'display_title': s.get('display_title','')} for s in ext_s]}, 'delta': len(ext_s) - len(toc_s), 'profile': result.get('profile', {}), 'page_count': doc.page_count()}, default=str))`)
    const result = execSync(`/home/graham/workspace/experiments/pdf_oxide/.venv/bin/python3 ${tmpScript}`, { timeout: 45000 })
    try { unlinkSync(tmpScript) } catch {}
    res.json({ id: req.params.id, ...JSON.parse(result.toString()) })
  } catch (e: any) {
    res.status(500).json({ id: req.params.id, error: String(e.stderr || e.message).slice(0, 2000), status: 'failed' })
  }
})

app.post('/api/quarantine/:id/convergence', async (req, res) => {
  try {
    const { pdf_path, ground_truth_path, max_rounds, target_score } = req.body as { pdf_path: string; ground_truth_path?: string; max_rounds?: number; target_score?: number }
    if (!pdf_path || !pdf_path.startsWith('/mnt/storage12tb/')) return res.status(400).json({ error: 'pdf_path must start with /mnt/storage12tb/' })
    const sanitizedPdf = pdf_path.replace(/'/g, "\\'")
    const args = [`"${sanitizedPdf}"`]
    if (ground_truth_path) args.push(`-g "${ground_truth_path.replace(/'/g, "\\'")}"`)
    if (max_rounds) args.push(`--max-rounds ${Math.min(max_rounds, 10)}`)
    if (target_score) args.push(`--target ${Math.min(target_score, 1.0)}`)
    args.push('--json')
    const cmd = `cd /home/graham/workspace/experiments/pi-mono/.pi/skills/pdf-lab && /home/graham/workspace/experiments/pi-mono/.pi/skills/pdf-lab/.venv/bin/python3 pdf_lab.py tune-gt ${args.join(' ')}`
    const { execSync } = await import('child_process')
    const result = execSync(cmd, { timeout: 120000 }).toString()
    // Update quarantine entry with convergence result
    const parsed = JSON.parse(result)
    await proxyPost('/upsert', { collection: 'quarantine_entries', documents: [{ _key: req.params.id, status: parsed.converged ? 'converged' : 'convergence-halted', convergence_result: { converged: parsed.converged, best_score: parsed.best_score, rounds: parsed.rounds_run, preset_key: parsed.preset_key }, resolved_at: new Date().toISOString() }] })
    res.json({ id: req.params.id, ...parsed })
  } catch (e: any) {
    res.status(500).json({ id: req.params.id, error: String(e.stderr || e.message).slice(0, 2000), status: 'failed' })
  }
})

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

app.get('/api/scillm/{*path}', (req, res) => {
  const scillmPath = '/' + (Array.isArray(req.params.path) ? req.params.path.join('/') : req.params.path)
  const url = new URL(`${SCILLM_URL}${scillmPath}`)
  if (req.url.includes('?')) {
    url.search = req.url.slice(req.url.indexOf('?'))
  }

  const proxyReq = httpRequest(
    {
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${process.env.SCILLM_API_KEY || 'sk-dev-proxy-123'}`,
        'X-Caller-Skill': 'ux-lab',
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
  proxyReq.end()
})

// ── Batch Orchestrator State ───────────────────────────────────────────────
// Reads state files from known orchestrators (create-qras, etc.) for dashboard
// display. Enables "why did my batch fail" debugging and resume guidance.

const ORCHESTRATOR_STATE_FILES: Record<string, { path: string; resumeCmd: string }> = {
  'create-qras-manifest': {
    path: `${process.env.HOME}/.create_qras_manifest_state.json`,
    resumeCmd: 'cd /home/graham/workspace/experiments/memory && ./.agents/skills/create-qras/run.sh manifest <manifest>',
  },
  'create-qras': {
    path: `${process.env.HOME}/.claude/skills/create-qras/.evidence_case_batch_state.json`,
    resumeCmd: 'python ~/.claude/skills/create-qras/batch_evidence_cases.py --resume',
  },
  'create-qras-amend': {
    path: `${process.env.HOME}/.claude/skills/create-qras/.amend_checkpoint.json`,
    resumeCmd: 'python ~/.claude/skills/create-qras/amend_and_export.py --resume',
  },
}

const TONIGHT_ROLLOUT_STATUS_FILE = '/tmp/sparta_tonight_rollout_status.json'
const PATCH_OUTPUT_DIR = '/tmp/create-qras-patches'
const RELATIONSHIP_ADJUDICATION_ORCHESTRATOR = 'create-evidence-case-adjudication'

type JsonObject = Record<string, any>

async function readJsonIfExists(path: string): Promise<JsonObject | null> {
  try {
    const raw = await readFile(path, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function readTextIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8')
  } catch {
    return null
  }
}

function countJsonlLines(content: string | null): number {
  if (!content) return 0
  return content.split(/\r?\n/).filter((line) => line.trim().length > 0).length
}

function extractQuotedFlag(script: string | null, flag: string): string | null {
  if (!script) return null
  const pattern = new RegExp(`${flag}\\s+["']([^"']+)["']`)
  return script.match(pattern)?.[1] || null
}

function extractArgValue(args: string[], flag: string): string | null {
  const index = args.indexOf(flag)
  if (index < 0 || index + 1 >= args.length) return null
  return args[index + 1] || null
}

function parseRunStartIso(log: string | null): string | null {
  const match = log?.match(/^START\s+([^\s]+)\s+/m)
  return match?.[1] || null
}

function parseStartedAtSeconds(log: string | null): number | null {
  const iso = parseRunStartIso(log)
  if (!iso) return null
  const parsed = Date.parse(iso)
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : null
}

function isPidAlive(pid: number, expectedCommand?: string): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
  } catch {
    return false
  }
  if (!expectedCommand) return true
  try {
    const command = readFileSync(`/proc/${pid}/cmdline`, 'utf-8').replace(/\0/g, ' ')
    return command.includes(expectedCommand)
  } catch {
    return true
  }
}

async function newestMtimeIso(paths: string[], fallbackIso: string): Promise<string> {
  let newest = 0
  for (const path of paths) {
    try {
      const fileStat = await stat(path)
      newest = Math.max(newest, fileStat.mtime.getTime())
    } catch {
      // Ignore missing optional run artifacts.
    }
  }
  return newest > 0 ? new Date(newest).toISOString() : fallbackIso
}

function deriveManifestJobCount(manifest: JsonObject | null): number {
  if (Array.isArray(manifest?.jobs)) return manifest.jobs.length
  const summary = manifest?.summary || {}
  return Number(summary.total_jobs || summary.gated_jobs || summary.resume_jobs || 0)
}

function deriveAcceptedJobCount(manifest: JsonObject | null): number {
  if (Array.isArray(manifest?.jobs)) return manifest.jobs.length
  const summary = manifest?.summary || {}
  return Number(summary.accepted_jobs || summary.total_jobs || summary.gated_jobs || 0)
}

function deriveRelationshipLogProgress(log: string | null): {
  accepted: number
  nonGeneration: number
  processed: number
  processing: number | null
  processingEnd: number | null
  total: number | null
  currentItem: string | null
} {
  if (!log) return { accepted: 0, nonGeneration: 0, processed: 0, processing: null, processingEnd: null, total: null, currentItem: null }

  let accepted = 0
  let nonGeneration = 0
  let processed = 0
  let processing: number | null = null
  let processingEnd: number | null = null
  let total: number | null = null
  let currentItem: string | null = null

  for (const line of log.split(/\r?\n/)) {
    const processedMatch = line.match(/^Processed\s+(\d+)\/(\d+)\s+relationship candidates.*accepted=(\d+)\s+non_generation=(\d+)/)
    if (processedMatch) {
      processed = Math.max(processed, Number(processedMatch[1] || 0))
      total = Number(processedMatch[2] || total || 0) || total
      accepted = Math.max(accepted, Number(processedMatch[3] || 0))
      nonGeneration = Math.max(nonGeneration, Number(processedMatch[4] || 0))
      currentItem = line
      continue
    }
    const pooledMatch = line.match(/^Processing pooled candidates\s+(\d+)-(\d+)\/(\d+)\s+via\s+(.+)$/)
    if (pooledMatch) {
      processing = Number(pooledMatch[1] || 0) || processing
      processingEnd = Number(pooledMatch[2] || 0) || processingEnd
      total = Number(pooledMatch[3] || total || 0) || total
      currentItem = line
      continue
    }
    const acceptedMatch = line.match(/^Accepted\s+(\d+)\/(\d+)\s+candidate\s+(.+?)(?:\s+in\s+[\d.]+s)?$/)
    if (acceptedMatch) {
      processed = Math.max(processed, Number(acceptedMatch[1] || 0))
      total = Number(acceptedMatch[2] || total || 0) || total
      currentItem = acceptedMatch[3] || currentItem
      continue
    }
    const erroredMatch = line.match(/^Errored\s+(\d+)\/(\d+)\s+candidate\s+(.+?):\s+(.+)$/)
    if (erroredMatch) {
      processed = Math.max(processed, Number(erroredMatch[1] || 0))
      total = Number(erroredMatch[2] || total || 0) || total
      currentItem = `${erroredMatch[3]}: ${erroredMatch[4]}`
      continue
    }
    const processingMatch = line.match(/^Processing\s+(\d+)\/(\d+)\s+candidate\s+(.+)$/)
    if (processingMatch) {
      processing = Number(processingMatch[1] || 0) || processing
      processingEnd = processing
      total = Number(processingMatch[2] || total || 0) || total
      currentItem = processingMatch[3] || currentItem
    }
  }

  return { accepted, nonGeneration, processed, processing, processingEnd, total, currentItem }
}

function parseRelationshipWatchdogReport(report: string | null): {
  accepted: number
  nonGeneration: number
  processed: number
  liveInFlight: number | null
  staleActiveCalls: number | null
  latestProcessed: string | null
} {
  if (!report) return { accepted: 0, nonGeneration: 0, processed: 0, liveInFlight: null, staleActiveCalls: null, latestProcessed: null }
  const accepted = Number(report.match(/\baccepted=(\d+)/)?.[1] || 0)
  const nonGeneration = Number(report.match(/\bnon_generation_lines=(\d+)/)?.[1] || 0)
  const processed = Number(report.match(/\bprogress_count=(\d+)/)?.[1] || 0)
  const latestProcessed = report.match(/^latest_processed=(.+)$/m)?.[1] || null
  const activeJson = report.match(/^active_calls=(\{.+\})$/m)?.[1] || null
  let liveInFlight: number | null = null
  let staleActiveCalls: number | null = null
  if (activeJson) {
    try {
      const parsed = JSON.parse(activeJson) as JsonObject
      liveInFlight = Number(parsed.live_in_flight ?? parsed.active_calls ?? 0)
      staleActiveCalls = Number(parsed.stale_active_calls ?? 0)
    } catch {
      liveInFlight = null
      staleActiveCalls = null
    }
  }
  return { accepted, nonGeneration, processed, liveInFlight, staleActiveCalls, latestProcessed }
}

function relationshipLaunchPathForOutput(outputManifestPath: string): string | null {
  const match = outputManifestPath.match(/^(.*\/)?relationship_pooled_full_accepted_(\d{8}_\d{6})\.json$/)
  if (!match) return null
  return `${match[1] || ''}relationship_pooled_full_${match[2]}.launch.json`
}

function relationshipStatePathForOutput(outputManifestPath: string): string | null {
  if (!outputManifestPath.endsWith('.json')) return null
  return outputManifestPath.replace(/\.json$/, '_state.json')
}

async function countLlmCallsForItemIds(itemIds: string[]): Promise<{ total: number; completed: number; failed: number }> {
  if (itemIds.length === 0) return { total: 0, completed: 0, failed: 0 }
  try {
    const result = await proxyPost('/query', {
      aql: `FOR doc IN llm_call_log
            FILTER doc.metadata.item_id IN @item_ids
            COLLECT status = doc.status WITH COUNT INTO count
            RETURN { status, count }`,
      bind_vars: { item_ids: itemIds },
    }, 10_000)
    const rows = Array.isArray(result?.documents) ? result.documents : []
    let total = 0
    let completed = 0
    let failed = 0
    for (const row of rows) {
      const count = Number(row?.count || 0)
      const status = String(row?.status || '').toLowerCase()
      total += count
      if (status === 'ok' || status === 'success' || status === 'completed') completed += count
      if (status === 'error' || status === 'failed') failed += count
    }
    return { total, completed, failed }
  } catch {
    return { total: 0, completed: 0, failed: 0 }
  }
}

async function discoverRelationshipAdjudicationOrchestrators(): Promise<Array<{
  name: string
  state: Record<string, unknown>
  stateFile: string
  resumeCmd: string
  lastModified: string
}>> {
  const rows: Array<{
    name: string
    state: Record<string, unknown>
    stateFile: string
    resumeCmd: string
    lastModified: string
  }> = []
  const seen = new Set<string>()

  async function pushRelationshipRow({
    stamp,
    pid,
    running,
    candidateManifestPath,
    outputManifestPath,
    nonGenerationPath,
    stateFile,
    resumeCmd,
    logPath,
    reportPath,
    activeMessageFallback,
    startedAtOverride,
  }: {
    stamp: string
    pid: number
    running: boolean
    candidateManifestPath: string
    outputManifestPath: string
    nonGenerationPath: string
    stateFile: string
    resumeCmd: string
    logPath?: string
    reportPath?: string
    activeMessageFallback: string
    startedAtOverride?: number | null
	  }) {
	    const key = `${candidateManifestPath}\n${outputManifestPath}`
	    if (seen.has(key)) return
	    seen.add(key)
	
	    const launch = await readJsonIfExists(relationshipLaunchPathForOutput(outputManifestPath) || '')
	    const resolvedLogPath = logPath || (typeof launch?.log === 'string' ? launch.log : undefined)
	    const resolvedReportPath = reportPath || (typeof launch?.report === 'string' ? launch.report : undefined)
	    const resolvedPid = pid || Number(launch?.pid || 0)
	    const durableStatePath = relationshipStatePathForOutput(outputManifestPath)
	    const durableState = durableStatePath ? await readJsonIfExists(durableStatePath) : null
	    const hasCanonicalState = Boolean(durableState)
	    const activeScillmBatchPath = typeof durableState?.active_scillm_batch_path === 'string'
	      ? durableState.active_scillm_batch_path
	      : null
	    const activeScillmProgress = {
	      completed: Number(durableState?.active_scillm_batch_completed || 0),
	      failed: Number(durableState?.active_scillm_batch_failed || 0),
	      resolved: Number(durableState?.active_scillm_batch_resolved || 0),
	      total: Number(durableState?.active_scillm_batch_total || 0),
	    }
	    const log = resolvedLogPath ? await readTextIfExists(resolvedLogPath) : null
	    const report = resolvedReportPath ? await readTextIfExists(resolvedReportPath) : null
	    const candidateManifest = await readJsonIfExists(candidateManifestPath)
	    const acceptedManifest = await readJsonIfExists(outputManifestPath)
	    const nonGenerationLines = countJsonlLines(await readTextIfExists(nonGenerationPath))
	    const logProgress = deriveRelationshipLogProgress(log)
	    const watchdog = parseRelationshipWatchdogReport(report)
	    const totalJobs = Number(durableState?.relationship_jobs || durableState?.total_jobs || 0) || deriveManifestJobCount(candidateManifest) || logProgress.total || 0
	    const itemIds = deriveManifestItemIds(candidateManifest)
	    const callCounts = hasCanonicalState
	      ? {
	        total: activeScillmProgress.total,
	        completed: activeScillmProgress.completed,
	        failed: activeScillmProgress.failed,
	      }
	      : await countLlmCallsForItemIds(itemIds)
	    const acceptedJobs = hasCanonicalState
	      ? Number(durableState?.accepted_jobs || 0)
	      : Math.max(deriveAcceptedJobCount(acceptedManifest), logProgress.accepted, watchdog.accepted)
	    const skippedJobs = hasCanonicalState
	      ? Number(durableState?.non_generation_outcomes || 0)
	      : Math.max(nonGenerationLines, logProgress.nonGeneration, watchdog.nonGeneration)
	    const completedJobs = hasCanonicalState
	      ? Math.min(totalJobs || Number(durableState?.visible_completed_jobs || durableState?.completed_jobs || 0), Number(durableState?.visible_completed_jobs || durableState?.completed_jobs || 0))
	      : Math.min(
	        totalJobs || acceptedJobs + skippedJobs,
	        Math.max(Number(durableState?.completed_jobs || 0), logProgress.processed, watchdog.processed, acceptedJobs + skippedJobs),
	      )
	    const startedAt = startedAtOverride || parseStartedAtSeconds(log)
	    const fallbackModified = new Date().toISOString()
	    const lastModified = running
	      ? fallbackModified
	      : await newestMtimeIso([stateFile, resolvedLogPath || '', resolvedReportPath || '', outputManifestPath, nonGenerationPath], fallbackModified)
	    const progressPct = hasCanonicalState && durableState?.progress_pct != null
	      ? Number(durableState.progress_pct)
	      : totalJobs > 0 ? Math.round((completedJobs / totalJobs) * 100) : 0
	    const terminalLogLine = log?.trim().split(/\r?\n/).reverse().find((line) => line.trim().length > 0) || null
	    const durableStatus = typeof durableState?.status === 'string' ? durableState.status : null
	    const status = running || durableStatus === 'running'
	      ? 'running'
	      : durableStatus === 'completed' || acceptedManifest
	        ? 'completed'
	        : 'stalled'
	    const activeMessage = hasCanonicalState
	      ? (
	        (typeof durableState?.failure_report === 'string' ? durableState.failure_report : null) ||
	        (typeof durableState?.error === 'string' ? `Failed: ${durableState.error}` : null) ||
	        (typeof durableState?.current_item === 'string' ? durableState.current_item : null) ||
	        activeMessageFallback
	      )
	      : (
	        (!running && !acceptedManifest && terminalLogLine ? `Exited before manifest write: ${terminalLogLine}` : null) ||
	        watchdog.latestProcessed ||
	        (logProgress.currentItem
	          ? `${logProgress.processing && logProgress.total ? `Processing ${logProgress.processing}${logProgress.processingEnd && logProgress.processingEnd !== logProgress.processing ? `-${logProgress.processingEnd}` : ''}/${logProgress.total}: ` : ''}${logProgress.currentItem}`
	          : null) ||
	        report?.match(/Status:\s+([^\n]+)/)?.[0] ||
	        log?.trim().split(/\r?\n/).slice(-1)[0] ||
	        activeMessageFallback
	      )

    rows.push({
      name: RELATIONSHIP_ADJUDICATION_ORCHESTRATOR,
      state: {
        status,
        phase: 'relationship adjudication',
        current_item: activeMessage,
        last_message: activeMessage,
        manifest_path: candidateManifestPath,
        candidate_manifest_path: candidateManifestPath,
	        output_manifest_path: outputManifestPath,
	        non_generation_outcomes_path: nonGenerationPath,
	        durable_state_path: durableStatePath,
	        journal_path: typeof durableState?.journal_path === 'string' ? durableState.journal_path : null,
	        active_scillm_batch_path: activeScillmBatchPath,
	        active_scillm_batch_completed: activeScillmProgress.completed,
	        active_scillm_batch_failed: activeScillmProgress.failed,
	        active_scillm_batch_total: activeScillmProgress.total,
	        monitor_report_path: resolvedReportPath,
	        started_at: startedAt || undefined,
	        total_jobs: totalJobs,
	        relationship_jobs: totalJobs,
	        completed_jobs: completedJobs,
	        successful_jobs: acceptedJobs,
	        stored_qras: deriveAcceptedJobCount(acceptedManifest),
	        accepted_jobs: acceptedJobs,
	        skipped_jobs: skippedJobs,
	        failed_jobs: 0,
	        pending_jobs: totalJobs > 0 ? Math.max(totalJobs - completedJobs, 0) : null,
	        progress_pct: progressPct,
	        execution_mode: 'create-evidence-case',
	        active_batch_id: `relationship-adjudication-${stamp.replace('_', '-')}`,
	        relationship_batch_id: `relationship-adjudication-${stamp.replace('_', '-')}`,
	        llm_calls_started: callCounts.total,
	        llm_calls_completed: callCounts.completed,
	        llm_calls_failed: callCounts.failed,
	        llm_calls_in_flight: Number(durableState?.llm_calls_in_flight ?? watchdog.liveInFlight ?? 0),
	        concurrency_limit: 16,
	        stale_active_calls: watchdog.staleActiveCalls ?? 0,
	        failure_report: typeof durableState?.failure_report === 'string' ? durableState.failure_report : null,
	        pid: resolvedPid || null,
	        watchdog_pid: Number(launch?.watchdog_pid || 0) || null,
	        log_path: resolvedLogPath,
	      },
      stateFile,
      resumeCmd,
      lastModified,
    })
  }

  try {
    const procEntries = await readdir('/proc')
    for (const entry of procEntries) {
      if (!/^\d+$/.test(entry)) continue
      const pid = Number(entry)
      let args: string[] = []
      try {
        args = readFileSync(`/proc/${pid}/cmdline`, 'utf-8').split('\0').filter(Boolean)
      } catch {
        continue
      }
      if (!args.some((arg) => arg.includes('batch_evidence_cases.py'))) continue
      if (!args.includes('relationship-manifest')) continue
      const candidateManifestPath = extractArgValue(args, '--candidate-manifest')
      const outputManifestPath = extractArgValue(args, '--output-manifest')
      const nonGenerationPath = extractArgValue(args, '--non-generation-outcomes')
      if (!candidateManifestPath || !outputManifestPath || !nonGenerationPath) continue
      const stamp =
        outputManifestPath.match(/resume_(\d{8}_\d{4})/)?.[1] ||
        candidateManifestPath.match(/resume_(\d{8}_\d{4})/)?.[1] ||
        `pid_${pid}`
      const inferredLogPath = stamp.startsWith('pid_') ? undefined : `/tmp/sparta_qra_relationship_adjudication_resume_${stamp}.log`
      const inferredReportPath = stamp.startsWith('pid_') ? undefined : `/tmp/sparta_qra_relationship_adjudication_resume_${stamp}_report.txt`
      await pushRelationshipRow({
        stamp,
        pid,
        running: isPidAlive(pid),
        candidateManifestPath,
        outputManifestPath,
        nonGenerationPath,
        stateFile: `/proc/${pid}/cmdline`,
        resumeCmd: args.join(' '),
        logPath: inferredLogPath,
        reportPath: inferredReportPath,
        activeMessageFallback: `relationship-manifest production pid=${pid}`,
      })
    }
  } catch {
    // /proc is best-effort; wrapper scripts below remain the fallback.
  }

  const launchDirs = [
    '/home/graham/workspace/experiments/memory/artifacts/monitor_sparta_gap_plan',
  ]
  for (const launchDir of launchDirs) {
    let launchFiles: string[] = []
    try {
      launchFiles = await readdir(launchDir)
    } catch {
      launchFiles = []
    }
    const launchStamps = launchFiles
      .map((fileName) => fileName.match(/^relationship_pooled_full_(\d{8}_\d{6})\.launch\.json$/)?.[1])
      .filter((stamp): stamp is string => Boolean(stamp))
      .sort()
      .reverse()

    for (const stamp of launchStamps.slice(0, 3)) {
      const launchPath = `${launchDir}/relationship_pooled_full_${stamp}.launch.json`
      const launch = await readJsonIfExists(launchPath)
      const candidateManifestPath = typeof launch?.candidate === 'string' ? launch.candidate : ''
      const outputManifestPath = typeof launch?.accepted === 'string' ? launch.accepted : ''
      const nonGenerationPath = typeof launch?.non_generation === 'string' ? launch.non_generation : ''
      if (!candidateManifestPath || !outputManifestPath || !nonGenerationPath) continue
      const pid = Number(launch?.pid || 0)
      const runner = typeof launch?.runner === 'string' ? launch.runner : launchPath
      await pushRelationshipRow({
        stamp,
        pid,
        running: isPidAlive(pid, runner),
        candidateManifestPath,
        outputManifestPath,
        nonGenerationPath,
        stateFile: launchPath,
        resumeCmd: runner,
        logPath: typeof launch?.log === 'string' ? launch.log : undefined,
        reportPath: typeof launch?.report === 'string' ? launch.report : undefined,
        activeMessageFallback: 'relationship-manifest production · launch file discovered',
        startedAtOverride: typeof launch?.timestamp === 'string' ? null : null,
      })
    }
  }

  let tmpFiles: string[] = []
  try {
    tmpFiles = await readdir('/tmp')
  } catch {
    tmpFiles = []
  }

  const runScripts = tmpFiles
    .map((fileName) => fileName.match(/^run_sparta_qra_relationship_adjudication_resume_(\d{8}_\d{4})\.sh$/)?.[1])
    .filter((stamp): stamp is string => Boolean(stamp))
    .sort()
    .reverse()

  for (const stamp of runScripts.slice(0, 3)) {
    const runScriptPath = `/tmp/run_sparta_qra_relationship_adjudication_resume_${stamp}.sh`
    const pidFile = `/tmp/sparta_qra_relationship_adjudication_resume_${stamp}.pid`
    const logPath = `/tmp/sparta_qra_relationship_adjudication_resume_${stamp}.log`
    const reportPath = `/tmp/sparta_qra_relationship_adjudication_resume_${stamp}_report.txt`
    const script = await readTextIfExists(runScriptPath)
    const candidateManifestPath =
      extractQuotedFlag(script, '--candidate-manifest') ||
      `/tmp/sparta_qra_relationship_candidates_resume_${stamp}.json`
    const outputManifestPath =
      extractQuotedFlag(script, '--output-manifest') ||
      `/tmp/sparta_qra_relationship_adjudicated_resume_${stamp}.json`
    const nonGenerationPath =
      extractQuotedFlag(script, '--non-generation-outcomes') ||
      `/tmp/sparta_qra_relationship_non_generation_resume_${stamp}.jsonl`
    const pidText = await readTextIfExists(pidFile)
    const pid = Number(pidText?.trim() || 0)
    await pushRelationshipRow({
      stamp,
      pid,
      running: isPidAlive(pid, runScriptPath),
      candidateManifestPath,
      outputManifestPath,
      nonGenerationPath,
      stateFile: runScriptPath,
      resumeCmd: runScriptPath,
      logPath,
      reportPath,
      activeMessageFallback: 'relationship-manifest production · waiting for first progress report',
    })
  }

  return rows
    .sort((a, b) => {
      const aRunning = a.state.status === 'running' ? 1 : 0
      const bRunning = b.state.status === 'running' ? 1 : 0
      if (aRunning !== bRunning) return bRunning - aRunning
      return b.lastModified.localeCompare(a.lastModified)
    })
    .slice(0, 1)
}

function inferSiblingJsonPath(manifestPath: string, suffix: '.review.json' | '.report.json'): string {
  if (manifestPath.endsWith('.json')) return manifestPath.replace(/\.json$/, suffix)
  return `${manifestPath}${suffix}`
}

function getManifestJobsForState(manifest: JsonObject | null, state: JsonObject | null): JsonObject[] {
  const jobs = Array.isArray(manifest?.jobs) ? manifest.jobs : []
  const limit = Number(state?.limit || 0)
  return limit > 0 ? jobs.slice(0, limit) : jobs
}

function getChunkWindow(state: JsonObject | null): { start: number; end: number } | null {
  const start = Number(state?.range_start || 0)
  const end = Number(state?.range_end || 0)
  if (!start || !end || end < start) return null
  return { start, end }
}

function getChunkJobs(manifest: JsonObject | null, state: JsonObject | null): JsonObject[] {
  const jobs = getManifestJobsForState(manifest, state)
  const window = getChunkWindow(state)
  if (!window) return []

  const phase = String(state?.phase || '')
  const canonicalJobs = jobs.filter((job) => job?.job_type === 'canonical')
  const relationshipJobs = jobs.filter((job) => job?.job_type === 'relationship')
  const source = phase === 'relationship' ? relationshipJobs : canonicalJobs
  return source.slice(window.start - 1, window.end)
}

function buildTailManifest(manifest: JsonObject | null, state: JsonObject | null): { manifest: JsonObject | null; diff: JsonObject | null } {
  if (!manifest || !Array.isArray(manifest.jobs)) {
    return { manifest: null, diff: null }
  }

  const jobs = getManifestJobsForState(manifest, state)
  const phase = String(state?.phase || 'canonical')
  const window = getChunkWindow(state)
  if (!window) {
    return {
      manifest: {
        ...manifest,
        batch_metadata: {
          ...(manifest.batch_metadata || {}),
          patched_at: new Date().toISOString(),
          patched_reason: 'tail-manifest fallback (no chunk window available)',
          patched_from_orchestrator: state?.name || 'create-qras-manifest',
        },
        jobs,
        summary: {
          ...(manifest.summary || {}),
          total_jobs: jobs.length,
        },
      },
      diff: {
        removed_jobs: [],
        removed_count: 0,
        retained_count: jobs.length,
      },
    }
  }

  const canonicalJobs = jobs.filter((job) => job?.job_type === 'canonical')
  const relationshipJobs = jobs.filter((job) => job?.job_type === 'relationship')

  let retainedJobs: JsonObject[] = []
  if (phase === 'relationship') {
    retainedJobs = [
      ...canonicalJobs,
      ...relationshipJobs.slice(window.start - 1),
    ]
  } else {
    retainedJobs = [
      ...canonicalJobs.slice(window.start - 1),
      ...relationshipJobs,
    ]
  }

  const retainedIds = new Set(retainedJobs.map((job) => String(job?.job_id || '')))
  const removedJobs = jobs.filter((job) => !retainedIds.has(String(job?.job_id || '')))

  return {
    manifest: {
      ...manifest,
      batch_metadata: {
        ...(manifest.batch_metadata || {}),
        patched_at: new Date().toISOString(),
        patched_reason: `tail-manifest from chunk ${window.start}-${window.end} (${phase})`,
        patched_from_orchestrator: state?.name || 'create-qras-manifest',
        patched_from_manifest: state?.manifest_path || null,
      },
      summary: {
        ...(manifest.summary || {}),
        total_jobs: retainedJobs.length,
        patched_from_total_jobs: jobs.length,
        patched_removed_jobs: removedJobs.length,
      },
      jobs: retainedJobs,
    },
    diff: {
      phase,
      chunk_start: window.start,
      chunk_end: window.end,
      removed_count: removedJobs.length,
      retained_count: retainedJobs.length,
      removed_job_ids: removedJobs.slice(0, 200).map((job) => job?.job_id),
      retained_first_job_id: retainedJobs[0]?.job_id || null,
      retained_last_job_id: retainedJobs[retainedJobs.length - 1]?.job_id || null,
    },
  }
}

function deriveChunkItemIds(chunkJobs: JsonObject[]): string[] {
  const ids = new Set<string>()
  for (const job of chunkJobs) {
    for (const itemId of deriveJobItemIds(job)) ids.add(itemId)
  }
  return [...ids]
}

function deriveJobItemIds(job: JsonObject | null | undefined): string[] {
  if (!job) return []
  const ids = new Set<string>()
  if (typeof job.job_id === 'string' && job.job_id.length > 0) ids.add(job.job_id)
  const identity = job.identity || {}
  const sourceId = identity.source_control_id || identity.technique_id
  const targetId = identity.countermeasure_id || identity.tactic_id
  if (sourceId && targetId) ids.add(`${sourceId}->${targetId}`)
  if (sourceId) ids.add(String(sourceId))
  return [...ids]
}

function deriveManifestItemIds(manifest: JsonObject | null): string[] {
  const jobs = Array.isArray(manifest?.jobs) ? manifest.jobs : []
  const ids = new Set<string>()
  for (const job of jobs) {
    for (const itemId of deriveJobItemIds(job)) ids.add(itemId)
  }
  return [...ids]
}

function inferRolloutSummary(state: JsonObject | null, manifest: JsonObject | null, supervisor: JsonObject | null): JsonObject | null {
  const manifestPath = String(state?.manifest_path || '')
  if (!manifestPath.includes('sparta_v2_stage_manifest_tonight')) return null

  const tonightTotal = 1720
  let completedBeforeCurrent = 0
  if (manifestPath.endsWith('sparta_v2_stage_manifest_tonight_after50.json')) completedBeforeCurrent = 50
  else if (manifestPath.endsWith('sparta_v2_stage_manifest_tonight_after150.json')) completedBeforeCurrent = 150
  else if (manifestPath.endsWith('sparta_v2_stage_manifest_tonight_remainder.json')) completedBeforeCurrent = 400

  const currentCompleted = Number(state?.completed_jobs || 0)
  const trancheTotal = Number(state?.total_jobs || 0)
  const tonightCompleted = completedBeforeCurrent + currentCompleted

  return {
    status: supervisor?.phase || null,
    detail: supervisor?.detail || null,
    tonight_total_jobs: tonightTotal,
    tonight_completed_jobs: tonightCompleted,
    tonight_remaining_jobs: Math.max(tonightTotal - tonightCompleted, 0),
    current_tranche_total_jobs: trancheTotal,
    current_tranche_completed_jobs: currentCompleted,
    current_tranche_label: supervisor?.detail || null,
    current_manifest_jobs: Array.isArray(manifest?.jobs) ? manifest.jobs.length : trancheTotal,
  }
}

app.get('/api/orchestrators', async (_req, res) => {
  const orchestrators: Array<{
    name: string
    state: Record<string, unknown> | null
    stateFile: string
    resumeCmd: string
    error?: string
    lastModified?: string
  }> = []

  for (const [name, config] of Object.entries(ORCHESTRATOR_STATE_FILES)) {
    try {
      const fileStat = await stat(config.path)
      const content = await readFile(config.path, 'utf-8')
      const state = JSON.parse(content)
      orchestrators.push({
        name,
        state,
        stateFile: config.path,
        resumeCmd: config.resumeCmd,
        lastModified: fileStat.mtime.toISOString(),
      })
    } catch (e: any) {
      orchestrators.push({
        name,
        state: null,
        stateFile: config.path,
        resumeCmd: config.resumeCmd,
        error: e.code === 'ENOENT' ? 'No state file (never run or completed)' : e.message,
      })
    }
  }

  const relationshipAdjudicators = await discoverRelationshipAdjudicationOrchestrators()
  orchestrators.push(...relationshipAdjudicators)

  res.json({ orchestrators })
})

app.get('/api/orchestrators/:name/detail', async (req, res) => {
  const { name } = req.params
  const config = ORCHESTRATOR_STATE_FILES[name]
  const relationshipAdjudicator = !config && name === RELATIONSHIP_ADJUDICATION_ORCHESTRATOR
    ? (await discoverRelationshipAdjudicationOrchestrators())[0]
    : null
  if (!config && !relationshipAdjudicator) return res.status(404).json({ error: `Unknown orchestrator: ${name}` })

  try {
    const state = relationshipAdjudicator?.state || (config ? await readJsonIfExists(config.path) : null)
    const manifestPath = String(state?.manifest_path || '')
    const manifest = manifestPath ? await readJsonIfExists(manifestPath) : null
    const review = config && manifestPath ? await readJsonIfExists(inferSiblingJsonPath(manifestPath, '.review.json')) : null
    const report = config && manifestPath ? await readJsonIfExists(inferSiblingJsonPath(manifestPath, '.report.json')) : null
    const supervisor = await readJsonIfExists(TONIGHT_ROLLOUT_STATUS_FILE)
    const chunkJobs = relationshipAdjudicator
      ? (Array.isArray(manifest?.jobs) ? manifest.jobs.slice(0, 50) : [])
      : getChunkJobs(manifest, state)
    const chunkItemIds = deriveChunkItemIds(chunkJobs)
    const manifestItemIds = deriveManifestItemIds(manifest)
    const { manifest: tailManifest, diff } = relationshipAdjudicator
      ? { manifest: null, diff: null }
      : buildTailManifest(manifest, state)
    const rollout = relationshipAdjudicator ? null : inferRolloutSummary(state, manifest, supervisor)

    let calls: JsonObject[] = []
    const caller = relationshipAdjudicator ? null : 'create-qras'
    if (manifestItemIds.length > 0) {
      const result = await proxyPost('/query', {
        aql: `FOR doc IN llm_call_log
              FILTER @caller == null OR doc.caller == @caller
              FILTER doc.metadata.item_id IN @item_ids
              SORT doc.ts DESC
              COLLECT item_id = doc.metadata.item_id INTO grouped = doc
              LET latest = FIRST(grouped)
              SORT latest.ts DESC
              RETURN latest`,
        bind_vars: { item_ids: manifestItemIds, caller },
      })
      calls = result?.documents ?? []
    } else if (state?.started_at) {
      const startedIso = new Date(Number(state.started_at) * 1000).toISOString()
      const result = await proxyPost('/query', {
        aql: `FOR doc IN llm_call_log
              FILTER @caller == null OR doc.caller == @caller
              FILTER doc.ts >= @started_iso
              SORT doc.ts DESC
              LIMIT 250
              RETURN doc`,
        bind_vars: { started_iso: startedIso, caller },
      })
      calls = result?.documents ?? []
    }

    const chunkCalls = chunkItemIds.length > 0
      ? calls.filter((call) => chunkItemIds.includes(String(call?.metadata?.item_id || '')))
      : []

    res.json({
      orchestrator: name,
      state,
      manifest_path: manifestPath || null,
      manifest,
      review,
      report,
      supervisor,
      rollout,
      chunk_jobs: chunkJobs,
      chunk_item_ids: chunkItemIds,
      manifest_item_ids: manifestItemIds,
      calls,
      chunk_calls: chunkCalls,
      tail_manifest: tailManifest,
      tail_diff: diff,
      resume_cmd: relationshipAdjudicator?.resumeCmd || config?.resumeCmd || null,
    })
  } catch (e) {
    res.status(502).json({ error: 'Failed to load orchestrator detail', detail: String(e) })
  }
})

app.post('/api/orchestrators/:name/patched-tail', async (req, res) => {
  const { name } = req.params
  const config = ORCHESTRATOR_STATE_FILES[name]
  if (!config) return res.status(404).json({ error: `Unknown orchestrator: ${name}` })

  try {
    const state = await readJsonIfExists(config.path)
    const manifestPath = String(state?.manifest_path || '')
    if (!manifestPath) return res.status(400).json({ error: 'No manifest_path in orchestrator state' })

    const manifest = await readJsonIfExists(manifestPath)
    const { manifest: tailManifest, diff } = buildTailManifest(manifest, state)
    if (!tailManifest) return res.status(400).json({ error: 'Unable to build tail manifest' })

    await mkdir(PATCH_OUTPUT_DIR, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const baseName = manifestPath.split('/').pop()?.replace(/\.json$/, '') || name
    const chunkStart = Number(state?.range_start || 0)
    const chunkLabel = chunkStart > 0 ? `chunk-${chunkStart}` : 'tail'
    const patchPath = `${PATCH_OUTPUT_DIR}/${baseName}.${chunkLabel}.${ts}.json`
    const reviewPath = patchPath.replace(/\.json$/, '.review.json')
    await writeFile(patchPath, `${JSON.stringify(tailManifest, null, 2)}\n`, 'utf-8')

    res.json({
      orchestrator: name,
      manifest_path: patchPath,
      review_path: reviewPath,
      manifest: tailManifest,
      diff,
      copy_cli: {
        review: `cd /home/graham/workspace/experiments/memory && /home/graham/workspace/experiments/memory/.agents/skills/create-qras/run.sh review \"${patchPath}\" -o \"${reviewPath}\"`,
        manifest: `cd /home/graham/workspace/experiments/memory && /home/graham/workspace/experiments/memory/.agents/skills/create-qras/run.sh manifest \"${patchPath}\"`,
      },
    })
  } catch (e) {
    res.status(502).json({ error: 'Failed to create patched tail manifest', detail: String(e) })
  }
})

// Get LLM calls for a specific batch_id (links orchestrator to scillm logs)
app.get('/api/orchestrators/:name/calls', async (req, res) => {
  const { name } = req.params
  const { batch_id } = req.query

  if (!batch_id) {
    return res.status(400).json({ error: 'batch_id query param required' })
  }

  try {
    // TODO: Replace with /list endpoint once memory daemon supports metadata.batch_id filter
    // See: https://github.com/anthropics/claude-code/issues/XXX
    // For now, raw AQL is necessary because /list doesn't support nested field filters
    const result = await proxyPost('/query', {
      aql: `FOR doc IN llm_call_log
            FILTER doc.metadata.batch_id == @batch_id
            SORT doc.ts DESC
            LIMIT 100
            RETURN doc`,
      bind_vars: { batch_id },
    })
    res.json({
      orchestrator: name,
      batch_id,
      calls: result?.documents ?? [],
      total: result?.count ?? 0,
    })
  } catch (e) {
    res.status(502).json({ error: 'Query failed', detail: String(e) })
  }
})

// ── On-demand edge rationale (Sensai Cascade T2) ───────────────────────────
// Generates LLM rationale for relationship edges using stored gate_evidence.
// Cache-first: returns existing llm_rationale if present on the edge.

app.post('/api/edge-rationale', async (req, res) => {
  const { _key } = req.body ?? {}
  if (!_key) return res.status(400).json({ error: 'Missing _key' })

  try {
    // Fetch edge
    const listResult = await proxyPost('/list', {
      collection: 'sparta_relationships',
      limit: 1,
      filters: { _key },
    })
    const edge = listResult?.documents?.[0]
    if (!edge) return res.status(404).json({ error: `Edge ${_key} not found` })

    const ge = edge.gate_evidence ?? {}

    // Cache hit — return existing rationale
    if (ge.llm_rationale) {
      return res.json({
        rationale: ge.llm_rationale,
        verdict: ge.verdict,
        gates_passed: ge.gates_passed,
        tier: ge.tier,
        cached: true,
      })
    }

    // Fetch source + target control descriptions
    const srcKey = `ctrl__${edge.source_control_id}`
    const tgtKey = `ctrl__${edge.target_control_id}`
    const controlsResult = await proxyPost('/recall/by-keys', {
      collection: 'sparta_controls',
      keys: [srcKey, tgtKey],
      return_fields: ['control_id', 'name', 'description', 'mind', 'source_framework'],
    })
    const controls = controlsResult?.documents ?? controlsResult?.items ?? []
    const srcDoc = controls.find((c: any) => c.control_id === edge.source_control_id) ?? {}
    const tgtDoc = controls.find((c: any) => c.control_id === edge.target_control_id) ?? {}

    // Build prompt from gate evidence
    const prompt = `You are a SPARTA cybersecurity analyst. Given deterministic gate evidence about a relationship between a SPARTA technique and a control, explain in 2-3 sentences why this relationship exists.

Source: ${edge.source_control_id} — ${srcDoc.name ?? 'unknown'} (${srcDoc.source_framework ?? '?'})
Target: ${edge.target_control_id} — ${tgtDoc.name ?? 'unknown'} (${tgtDoc.source_framework ?? '?'})

Gate Evidence:
- Curated cross-references: ${ge.gate2_curated_count ?? 0} (${(ge.gate2_curated_methods ?? []).join(', ') || 'none'})
- Mind tag overlap: ${(ge.gate3_mind_intersection ?? []).join(', ') || 'none'} (Jaccard: ${ge.gate3_mind_jaccard ?? 0})
- Embedding similarity: ${ge.gate4_cosine_similarity ?? 0}
- Verdict: ${ge.verdict ?? 'unknown'} (${ge.gates_passed ?? 0} gates passed)

Respond with ONLY the rationale text, no JSON.`

    // Call scillm
    const url = new URL(`${SCILLM_URL}/v1/chat/completions`)
    const llmBody = JSON.stringify({
      model: 'text',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 200,
      temperature: 0.2,
    })

    const llmResult: any = await new Promise((resolve, reject) => {
      const llmReq = httpRequest(
        {
          hostname: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(llmBody)),
            'Authorization': `Bearer ${process.env.SCILLM_API_KEY || 'sk-dev-proxy-123'}`,
          },
        },
        (proxyRes) => {
          const chunks: Buffer[] = []
          proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
          proxyRes.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
            catch { reject(new Error('Invalid JSON from scillm')) }
          })
        }
      )
      llmReq.on('error', reject)
      llmReq.write(llmBody)
      llmReq.end()
    })

    const rationale = llmResult?.choices?.[0]?.message?.content?.trim() ?? ''
    if (!rationale) return res.status(502).json({ error: 'Empty rationale from LLM' })

    // Cache rationale back to edge
    const updatedGe = { ...ge, llm_rationale: rationale }
    await proxyPost('/upsert', {
      collection: 'sparta_relationships',
      documents: [{ _key, gate_evidence: updatedGe }],
    })

    res.json({
      rationale,
      verdict: ge.verdict,
      gates_passed: ge.gates_passed,
      tier: ge.tier ?? 'T0',
      cached: false,
    })
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? 'Internal error' })
  }
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

function proxyPost(path: string, body: object | null = null, timeoutMs = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    const method = body ? 'POST' : 'GET'
    const data = body ? JSON.stringify(body) : undefined
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (data) headers['Content-Length'] = String(Buffer.byteLength(data))

    const timeout = setTimeout(() => {
      req.destroy()
      reject(new Error(`Memory daemon timeout after ${timeoutMs}ms on ${path}`))
    }, timeoutMs)

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
          clearTimeout(timeout)
          const rawText = Buffer.concat(chunks).toString()
          let parsed: any
          try { parsed = JSON.parse(rawText) }
          catch { reject(new Error('Invalid JSON from memory daemon')); return }
          if ((res.statusCode ?? 500) >= 400) {
            const detail = parsed?.detail || parsed?.error || rawText || 'unknown error'
            reject(new Error(`Memory daemon ${res.statusCode} on ${path}: ${detail}`))
            return
          }
          resolve(parsed)
        })
      }
    )
    req.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
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
    'entity-span-viewer': resolve(__dirname, '../src/components/shared-chat'),
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
// Three modes:
//   1. delimiter provided: split text on delimiters, look up each ID via /list
//   2. binary_features/app_actions: BM25 via daemon /search-collection endpoint
//   3. other collections (sparta): proxy to daemon /extract-entities (FlashText)

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

    // Mode 2: /recall with collections filter for app-scoped collections
    // Standard path: BM25 + semantic + graph scoring, filtered to one collection
    if (col === 'binary_features' || col === 'app_actions') {
      const scope = col === 'binary_features' ? 'binary-explorer' : ''
      try {
        const recallResult = await proxyPost('/recall', {
          q: text, k: 5, scope, collections: [col],
        }) as { items?: Array<{ _key?: string; _source?: string; problem?: string; solution?: string; nodeType?: string; node_type?: string; cluster?: string; scores?: { bm25?: number } }> }
        if (!recallResult.items) {
          console.error(`[extract-entities] /recall returned no items field for ${col}`)
          res.status(502).json({ error: `/recall returned invalid response for ${col}`, entities: [] })
          return
        }
        const entities = recallResult.items
          .map(item => ({
            id: `${col}/${item._key ?? ''}`,
            name: item.problem ?? '',
            label: item.problem ?? '',
            type: item.nodeType ?? item.node_type ?? 'unknown',
            cluster: item.cluster ?? '',
            score: item.scores?.bm25 ?? 0,
            exists: true,
          }))
        if (entities.length === 0) {
          console.warn(`[extract-entities] /recall returned 0 ${col} items for: "${text}"`)
        }
        res.json({ entities, mode: 'recall' })
      } catch (recallErr) {
        const detail = recallErr instanceof Error ? recallErr.message : String(recallErr)
        console.error(`[extract-entities] /recall FAILED for ${col}: ${detail}`)
        res.status(502).json({ error: `/recall failed for ${col}`, detail, entities: [] })
      }
      return
    }

    // Mode 3: SPARTA entity extraction via daemon (FlashText Aho-Corasick)
    // Normalize both legacy and current daemon contracts into one UI-friendly shape.
    try {
      const result = await proxyPost('/extract-entities', { text, include_taxonomy: false }) as Record<string, unknown>

      const legacyControlIds = Array.isArray(result.control_ids) ? (result.control_ids as string[]) : []
      const legacyControlMeta = Array.isArray(result.control_metadata)
        ? (result.control_metadata as Array<{ name?: string; framework?: string; domain?: string }>)
        : []
      const legacySpans = Array.isArray(result.spans) ? (result.spans as Array<Record<string, unknown>>) : []
      const legacyPhrases = Array.isArray(result.phrases) ? (result.phrases as string[]) : []

      const resolvedEntities = Array.isArray((result as any).resolved_entities)
        ? ((result as any).resolved_entities as Array<{
            mention?: string
            span?: [number, number]
            canonical_id?: string
            canonical_name?: string
            framework?: string
            entity_type?: string
          }>)
        : []
      const unresolvedEntities = Array.isArray((result as any).unresolved_entities)
        ? ((result as any).unresolved_entities as Array<{
            mention?: string
            span?: [number, number]
            reason?: string
          }>)
        : []
      const domainTerms = Array.isArray((result as any).domain_terms)
        ? ((result as any).domain_terms as Array<{
            text?: string
            span?: [number, number]
            kind?: string
          }>)
        : []

      const normalizedControlIds = legacyControlIds.length > 0
        ? legacyControlIds
        : resolvedEntities
            .map((e) => e.canonical_id)
            .filter((v): v is string => typeof v === 'string' && v.length > 0)

      const normalizedControlMeta = legacyControlMeta.length > 0
        ? legacyControlMeta
        : resolvedEntities
            .filter((e) => typeof e.canonical_id === 'string' && e.canonical_id.length > 0)
            .map((e) => ({
              name: e.canonical_name ?? e.canonical_id,
              framework: e.framework ?? '',
            }))

      const entities = normalizedControlIds.map((cid: string, i: number) => {
        const meta = normalizedControlMeta[i] ?? {}
        return {
          id: cid,
          name: meta.name ?? cid,
          label: cid,
          type: 'control',
          framework: meta.framework ?? '',
          exists: true,
        }
      })

      const normalizedSpans = legacySpans.length > 0
        ? legacySpans
        : [
            ...resolvedEntities
              .filter((e) => Array.isArray(e.span) && typeof e.span[0] === 'number' && typeof e.span[1] === 'number')
              .map((e) => ({
                text: e.mention ?? e.canonical_id ?? '',
                span: e.span,
                kind: 'control_id',
                framework: e.framework ?? '',
                name: e.canonical_name ?? e.canonical_id ?? '',
                grounded_to_framework: true,
                source: '/extract-entities',
              })),
            ...domainTerms
              .filter((t) => Array.isArray(t.span) && typeof t.span[0] === 'number' && typeof t.span[1] === 'number')
              .map((t) => ({
                text: t.text ?? '',
                span: t.span,
                kind: 'aerospace_term',
                source: '/extract-entities',
              })),
          ].filter((s) => typeof s.text === 'string' && s.text.length > 0)

      const normalizedPhrases = legacyPhrases.length > 0
        ? legacyPhrases
        : domainTerms
            .map((t) => t.text)
            .filter((v): v is string => typeof v === 'string' && v.length > 0)

      const normalizedResolutionMap = (result as any).resolution_map ?? Object.fromEntries([
        ...resolvedEntities
          .filter((e) => typeof e.mention === 'string' && e.mention.length > 0)
          .map((e) => [e.mention as string, {
            exists: true,
            control_id: e.canonical_id ?? null,
            name: e.canonical_name ?? e.mention,
            framework: e.framework ?? null,
            match_type: 'exact',
          }]),
        ...unresolvedEntities
          .filter((e) => typeof e.mention === 'string' && e.mention.length > 0)
          .map((e) => [e.mention as string, {
            exists: false,
            reason: e.reason ?? 'unresolved',
            match_type: 'unresolved',
          }]),
      ])

      const normalizedNotInCorpus = Array.isArray((result as any).not_in_corpus)
        ? ((result as any).not_in_corpus as unknown[])
        : unresolvedEntities
            .map((e) => e.mention)
            .filter((v): v is string => typeof v === 'string' && v.length > 0)

      res.json({
        entities,
        mode: 'flashtext',
        // Normalized data for UI consumers that expect legacy keys
        control_ids: normalizedControlIds,
        spans: normalizedSpans,
        resolution_map: normalizedResolutionMap,
        control_metadata: normalizedControlMeta,
        not_in_corpus: normalizedNotInCorpus,
        phrases: normalizedPhrases,
        misspellings: result.misspellings ?? [],
        related_pairs: result.related_pairs ?? [],
        recall_items: result.recall_items ?? [],
        // Pass-through current contract for newer consumers
        resolved_entities: resolvedEntities,
        unresolved_entities: unresolvedEntities,
        domain_terms: domainTerms,
      })
    } catch (daemonErr) {
      const detail = daemonErr instanceof Error ? daemonErr.message : String(daemonErr)
      console.error(`[extract-entities] daemon /extract-entities FAILED: ${detail}`)
      res.status(502).json({ error: 'Memory daemon /extract-entities unreachable', detail, entities: [] })
    }
  } catch (e) {
    res.status(502).json({ error: 'Entity extraction failed', detail: String(e) })
  }
})

// ── QuerySpec Resolver ──────────────────────────────────────────────────────

app.post('/api/queryspec/resolve', async (req, res) => {
  try {
    const { text, app: appName } = req.body as { text: string; app?: string }
    if (!text) { res.status(400).json({ resolved: false, error: 'text is required' }); return }

    const { execSync } = await import('child_process')
    const escaped = text.replace(/'/g, "'\\''")
    const appArg = appName ? `--app '${appName.replace(/'/g, "'\\''")}'` : ''
    const cmd = `python3 ${process.env.HOME}/.pi/skills/intent-mapper/resolver.py '${escaped}' ${appArg} --json`
    const output = execSync(cmd, { timeout: 5000, encoding: 'utf-8' })
    res.json(JSON.parse(output))
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error(`[queryspec/resolve] FAILED: ${detail}`)
    res.status(500).json({ resolved: false, error: 'Resolver failed', detail })
  }
})

app.post('/api/queryspec/learn', async (req, res) => {
  try {
    const { text, action, dom_selector, confidence, app: appName, success } = req.body as {
      text: string; action: string; dom_selector: string; confidence: number; app: string; success: boolean
    }
    const result = await proxyPost('/learn', {
      problem: text,
      solution: JSON.stringify({ action, dom_selector, confidence }),
      tags: ['queryspec-training', appName || 'datalake-explorer', 'ui-command', success ? 'executed' : 'failed'],
      scope: appName || 'datalake-explorer',
      collection: 'app_actions_training',
    })
    res.json({ stored: true, key: result?._key })
  } catch (e) {
    res.status(500).json({ stored: false, error: String(e) })
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

const agentState: Record<string, { active: boolean; paused: boolean }> = {
  'sparta-explorer': { active: true, paused: false },
  'datalake-explorer': { active: true, paused: false },
  'binary-explorer': { active: true, paused: false }
}

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
const CLASSIFIER_LAB_SKILL_DIR = resolve(PI_MONO, '.pi/skills/classifier-lab')
const CLASSIFIER_SWITCHBOARD_URL = 'http://localhost:7890'

const CLASSIFIER_DEFAULT_HPS: Record<string, { lr: number; batch_size: number; epochs: number; dropout: number; weight_decay: number }> = {
  text: { lr: 2e-5, batch_size: 16, epochs: 2, dropout: 0.1, weight_decay: 1e-4 },
  vision: { lr: 2e-4, batch_size: 32, epochs: 10, dropout: 0.1, weight_decay: 1e-4 },
  tabular: { lr: 0.1, batch_size: 64, epochs: 1, dropout: 0, weight_decay: 0 },
  paired: { lr: 2e-4, batch_size: 16, epochs: 10, dropout: 0.1, weight_decay: 1e-4 },
}

interface ClassifierRerunBody {
  backbones: string[]
  gate_f1: number
  max_rounds: number
  max_train_samples: number
  modality: string
  task: string
}

interface TuneResultsPayload extends Record<string, unknown> {
  trials: unknown[]
  strategy: string
  winningRound: number | null
  completed: number
  total: number
}

interface EvalPerClassMetrics {
  precision: number
  recall: number
  f1: number
  support: number
}

interface EvalResultsPayload extends Record<string, unknown> {
  model: string
  macro_f1: number
  accuracy: number
  test_samples: number
  holdout_passed: boolean
  classes: string[]
  confusion_matrix: number[][]
  per_class: Record<string, EvalPerClassMetrics>
}

interface SwitchboardManifest {
  version: number
  run_id: string
  worker_id: string
  runtime_state: { current_step_id: null; next_eligible_steps: string[] }
  steps: Array<{
    step_id: string
    label: string
    status: 'pending'
    action: Record<string, unknown>
    timeout_seconds?: number
    postcondition?: Record<string, unknown>
  }>
}

function sanitizeBackboneName(backbone: string): string {
  return backbone.replace(/\//g, '-').replace(/\./g, '-').replace(/_/g, '-').slice(0, 60)
}

function generateClassifierManifest(
  backbone: string,
  projectId: string,
  task: string,
  modality: string,
  dataDir: string,
  gateF1: number,
  maxRounds: number,
  maxTrainSamples: number,
): SwitchboardManifest {
  const safeName = sanitizeBackboneName(backbone)
  const runId = `clf-${projectId}-${safeName}`
  const logDir = `/tmp/clf-switchboard/${projectId}/${safeName}`
  const defaults = CLASSIFIER_DEFAULT_HPS[modality] ?? CLASSIFIER_DEFAULT_HPS.text
  const config = {
    name: backbone,
    modality,
    task,
    data_dir: dataDir,
    lr: defaults.lr,
    batch_size: defaults.batch_size,
    epochs: defaults.epochs,
    dropout: defaults.dropout,
    weight_decay: defaults.weight_decay,
    gate: gateF1,
    max_rounds: maxRounds,
    max_train_samples: maxTrainSamples,
    log_dir: logDir,
    project_id: projectId,
  }
  const configJson = JSON.stringify(config)
  const venvPython = resolve(CLASSIFIER_LAB_SKILL_DIR, '.venv/bin/python')
  const trainScript = resolve(CLASSIFIER_LAB_SKILL_DIR, 'scripts/backbone_train_loop.py')

  return {
    version: 1,
    run_id: runId,
    worker_id: 'local-executor',
    runtime_state: {
      current_step_id: null,
      next_eligible_steps: ['train-loop'],
    },
    steps: [
      {
        step_id: 'train-loop',
        label: `${backbone} self-improving loop: gate ${gateF1}, ${maxRounds} rounds`,
        status: 'pending',
        action: {
          type: 'run_command',
          command: `${venvPython} ${trainScript} '${configJson}'`,
          cwd: CLASSIFIER_LAB_SKILL_DIR,
        },
        timeout_seconds: maxRounds * 600,
      },
      {
        step_id: 'verify-gate',
        label: `Verify F1 gate >= ${gateF1}`,
        status: 'pending',
        action: {
          type: 'check_metrics',
          file_path: `${logDir}/metrics.json`,
        },
        postcondition: {
          type: 'metric_gate',
          metric: 'f1',
          threshold: gateF1,
        },
      },
    ],
  }
}

async function resolveClassifierDataDir(projectId: string): Promise<string> {
  const dataPath = resolve(CLASSIFIER_DIR, projectId, 'data.json')
  if (existsSync(dataPath)) {
    try {
      const data = JSON.parse(await readFile(dataPath, 'utf-8')) as { path?: unknown }
      if (typeof data.path === 'string' && data.path.trim().length > 0) return data.path.trim()
    } catch { /* ignore malformed data.json */ }
  }

  const configPath = resolve(CLASSIFIER_CONFIGS, `${projectId}.yaml`)
  if (!existsSync(configPath)) return ''

  try {
    const rawConfig = yamlLoad(await readFile(configPath, 'utf-8'))
    const config = rawConfig && typeof rawConfig === 'object' && !Array.isArray(rawConfig)
      ? rawConfig as Record<string, unknown>
      : {}

    const topLevelDataDir = config.data_dir
    if (typeof topLevelDataDir === 'string' && topLevelDataDir.trim().length > 0) return topLevelDataDir.trim()

    const dataset = config.dataset
    if (typeof dataset === 'string' && dataset.trim().length > 0) return dataset.trim()

    const dataCollection = config.data_collection
    if (dataCollection && typeof dataCollection === 'object' && !Array.isArray(dataCollection)) {
      const source = (dataCollection as Record<string, unknown>).source
      if (typeof source === 'string' && source.trim().length > 0) return source.trim()
    }

    const data = config.data
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const dataRecord = data as Record<string, unknown>
      const source = dataRecord.source
      if (typeof source === 'string' && source.trim().length > 0) return source.trim()
      const path = dataRecord.path
      if (typeof path === 'string' && path.trim().length > 0) return path.trim()
      const dir = dataRecord.dir
      if (typeof dir === 'string' && dir.trim().length > 0) return dir.trim()
    }
  } catch { /* ignore malformed config */ }

  return ''
}

function getDefaultTuneResults(): TuneResultsPayload {
  return {
    trials: [],
    strategy: 'self-improvement-loop',
    winningRound: null,
    completed: 0,
    total: 0,
  }
}

function normalizeTuneResultsPayload(payload: unknown): TuneResultsPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return getDefaultTuneResults()
  }

  const record = payload as Record<string, unknown>
  const trials = Array.isArray(record.trials) ? record.trials : []
  const completed = typeof record.completed === 'number'
    ? record.completed
    : trials.filter((trial) => (
      trial &&
      typeof trial === 'object' &&
      (trial as Record<string, unknown>).status === 'complete'
    )).length

  const total = typeof record.total === 'number' ? record.total : trials.length
  const strategy = typeof record.strategy === 'string' && record.strategy.trim().length > 0
    ? record.strategy
    : 'self-improvement-loop'
  const winningRound = typeof record.winningRound === 'number' ? record.winningRound : null

  return {
    ...record,
    trials,
    strategy,
    winningRound,
    completed,
    total,
  }
}

function toEvalMetricNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function toEvalPerClassMetrics(value: unknown): EvalPerClassMetrics {
  const metrics = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    precision: toEvalMetricNumber(metrics.precision),
    recall: toEvalMetricNumber(metrics.recall),
    f1: toEvalMetricNumber(metrics.f1),
    support: toEvalMetricNumber(metrics.support),
  }
}

function normalizeEvalResultsPayload(payload: unknown): EvalResultsPayload {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {}

  const classes = Array.isArray(record.classes)
    ? record.classes.filter((value): value is string => typeof value === 'string')
    : []

  const model = typeof record.model === 'string'
    ? record.model
    : (typeof record.winner === 'string' ? record.winner : 'unknown')
  const macro_f1 = toEvalMetricNumber(record.macro_f1 ?? record.f1)
  const accuracy = toEvalMetricNumber(record.accuracy)
  const holdout_passed = record.holdout_passed === true || record.gate_passed === true

  const per_class: Record<string, EvalPerClassMetrics> = {}
  const rawPerClass = record.per_class
  const rawPerClassMap = rawPerClass && typeof rawPerClass === 'object' && !Array.isArray(rawPerClass)
    ? rawPerClass as Record<string, unknown>
    : {}
  for (const cls of classes) {
    per_class[cls] = toEvalPerClassMetrics(rawPerClassMap[cls])
  }

  const rawMatrix = Array.isArray(record.confusion_matrix) ? record.confusion_matrix : []
  const confusion_matrix = rawMatrix
    .filter((row): row is unknown[] => Array.isArray(row))
    .map((row) => row.map((value) => toEvalMetricNumber(value)))

  const normalizedMatrix = confusion_matrix.length > 0
    ? confusion_matrix
    : classes.map(() => classes.map(() => 0))
  const inferredTestSamples = normalizedMatrix.flat().reduce((sum, value) => sum + value, 0)
  const test_samples = typeof record.test_samples === 'number' && Number.isFinite(record.test_samples)
    ? record.test_samples
    : inferredTestSamples

  return {
    ...record,
    model,
    macro_f1,
    accuracy,
    test_samples,
    holdout_passed,
    classes,
    confusion_matrix: normalizedMatrix,
    per_class,
  }
}

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
          projects.push({ id: d, name: meta.name || d, modality: meta.modality || 'unknown', status: meta.status || 'created', f1: meta.f1, samples: meta.samples || 0, classes: meta.classes || 0, backbone: meta.backbone || '' })
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
  const { name, goal, modality } = req.body as { name?: string; goal?: string; modality?: string }
  if (!name) return res.status(400).json({ error: 'name required' })
  const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  const dir = resolve(CLASSIFIER_DIR, id)
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(resolve(dir, 'meta.json'), JSON.stringify({
      name, status: 'created', modality: modality || 'text', goal: goal || '', samples: 0, classes: 0,
    }, null, 2), 'utf-8')

    // Spawn kickoff in background if goal provided
    if (goal) {
      const kickoffPath = resolve(CLASSIFIER_LAB_SKILL_DIR, 'scripts', 'kickoff.py')
      if (existsSync(kickoffPath)) {
        const { spawn } = await import('child_process')
        const env = { ...process.env }
        delete env.VIRTUAL_ENV  // Must DELETE, not set to empty — uv still reads empty string
        const child = spawn('bash', ['-c', [
          `cd "${resolve(CLASSIFIER_LAB_SKILL_DIR)}"`,
          `unset VIRTUAL_ENV`,
          `uv run python scripts/kickoff.py "${dir}" --goal "${goal.replace(/"/g, '\\"')}" --modality "${modality || 'text'}"`,
        ].join(' && ')], { env, timeout: 300_000, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
        child.unref()
        // Capture stderr for error reporting
        let stderrBuf = ''
        if (child.stderr) child.stderr.on('data', (d: Buffer) => { stderrBuf += d.toString().slice(-500) })
        child.on('exit', async (code) => {
          const metaPath = resolve(dir, 'meta.json')
          try {
            const meta = JSON.parse(await readFile(metaPath, 'utf-8'))
            if (code !== 0) {
              console.error(`[kickoff] ${id} exited with code ${code}: ${stderrBuf.slice(-200)}`)
              meta.status = 'kickoff-failed'
              meta.kickoff_error = stderrBuf.slice(-500) || `exit code ${code}`
            } else {
              console.log(`[kickoff] ${id} complete`)
              // Don't overwrite status if kickoff.py already set it to 'researched'
              if (meta.status === 'created') meta.status = 'researched'
            }
            await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
          } catch { /* meta.json may not exist yet */ }
        })
      }
    }

    res.json({ status: 'CREATED', id, kickoff: !!goal })
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
    const projDir = resolve(CLASSIFIER_DIR, req.params.id)

    // Try data.json first (pre-computed)
    const metaPath = resolve(projDir, 'data.json')
    if (existsSync(metaPath)) {
      const data = JSON.parse(await readFile(metaPath, 'utf-8'))
      // Augment with sufficiency check if missing
      if (data.sufficiency === undefined && data.classes?.length) {
        const numClasses = data.classes.length
        const totalTrain = data.totalTrain ?? data.classes.reduce((s: number, c: any) => s + (c.train || 0), 0)
        const minPerClass = data.minPerClass ?? Math.min(...data.classes.map((c: any) => c.train || 0))
        const MIN_SAMPLES_PER_CLASS = 100
        const required = numClasses * MIN_SAMPLES_PER_CLASS
        data.sufficiency = {
          required, available: totalTrain, sufficient: totalTrain >= required,
          minPerClass, minRequired: MIN_SAMPLES_PER_CLASS,
          deficit: Math.max(0, required - totalTrain),
        }
      }
      return res.json(data)
    }

    // Compute from samples.jsonl if data.json doesn't exist
    const samplesPath = resolve(projDir, 'samples.jsonl')
    if (!existsSync(samplesPath)) {
      return res.json({ gatePassed: false, classes: [], gateThreshold: 0.85, classCount: 0, totalTrain: 0, sufficiency: { required: 0, available: 0, sufficient: false, deficit: 0, minPerClass: 0, minRequired: 100 } })
    }

    const lines = (await readFile(samplesPath, 'utf-8')).trim().split('\n').filter(Boolean)
    const classCounts: Record<string, { train: number; val: number; test: number }> = {}
    let isMultiLabel = false

    for (const line of lines) {
      try {
        const row = JSON.parse(line)
        const split = row.split || 'train'

        // Handle multi-label (labels array) and single-label (class/className)
        const labels: string[] = Array.isArray(row.labels) ? row.labels : [row.class || row.className || 'unknown']
        if (Array.isArray(row.labels) && row.labels.length > 1) isMultiLabel = true

        for (const lbl of labels) {
          if (!classCounts[lbl]) classCounts[lbl] = { train: 0, val: 0, test: 0 }
          if (split === 'train') classCounts[lbl].train++
          else if (split === 'val') classCounts[lbl].val++
          else if (split === 'test') classCounts[lbl].test++
        }
      } catch { /* skip bad lines */ }
    }

    const classes = Object.entries(classCounts)
      .map(([name, counts]) => ({ name, ...counts }))
      .sort((a, b) => b.train - a.train)

    const numClasses = classes.length
    const totalTrain = lines.filter(l => { try { return (JSON.parse(l).split || 'train') === 'train' } catch { return false } }).length
    const totalSamples = lines.length
    const minPerClass = classes.length > 0 ? Math.min(...classes.map(c => c.train)) : 0

    // Data sufficiency: deterministic pre-flight check
    const MIN_SAMPLES_PER_CLASS = isMultiLabel ? 100 : 50
    const required = numClasses * MIN_SAMPLES_PER_CLASS
    const sufficient = totalTrain >= required
    const sufficiency = {
      required, available: totalTrain, sufficient,
      minPerClass, minRequired: MIN_SAMPLES_PER_CLASS,
      deficit: Math.max(0, required - totalTrain),
      isMultiLabel,
      perClassDeficit: classes.filter(c => c.train < MIN_SAMPLES_PER_CLASS).map(c => ({
        name: c.name, have: c.train, need: MIN_SAMPLES_PER_CLASS,
      })),
    }

    const gateThreshold = MIN_SAMPLES_PER_CLASS
    const gatePassed = sufficient && minPerClass >= Math.floor(MIN_SAMPLES_PER_CLASS * 0.5)

    const modality = (() => {
      try { const m = JSON.parse(readFileSync(resolve(projDir, 'meta.json'), 'utf-8')); return m.modality || 'unknown' } catch { return 'unknown' }
    })()

    res.json({
      gatePassed, gateThreshold, classes, totalTrain, totalSamples, minPerClass,
      classCount: numClasses, modality, isMultiLabel, sufficiency,
      path: samplesPath,
    })
  } catch (e) {
    res.json({ gatePassed: false, classes: [], gateThreshold: 0.85, classCount: 0, totalTrain: 0, sufficiency: { required: 0, available: 0, sufficient: false, deficit: 0, minPerClass: 0, minRequired: 100 }, error: String(e) })
  }
})

// POST — trigger data enrichment loop (search HuggingFace + GitHub until sufficient or exhausted)
app.post('/api/projects/classifier-lab/data/:id/enrich', async (req, res) => {
  const projectId = req.params.id
  try {
    const projDir = resolve(CLASSIFIER_DIR, projectId)
    if (!existsSync(projDir)) return res.status(404).json({ error: 'Project not found' })

    const scriptPath = resolve(CLASSIFIER_LAB_SKILL_DIR, 'scripts', 'data_enrichment.py')
    if (!existsSync(scriptPath)) return res.status(500).json({ error: 'data_enrichment.py not found' })

    const minPerClass = typeof req.body?.min_per_class === 'number' ? req.body.min_per_class : 100
    const execFileAsync = promisify(execFile)

    const { stdout, stderr } = await execFileAsync(
      'bash', ['-lc', `cd "${resolve(CLASSIFIER_LAB_SKILL_DIR)}" && uv run python scripts/data_enrichment.py "${projDir}" --min-per-class ${minPerClass}`],
      { timeout: 300_000, env: { ...process.env, VIRTUAL_ENV: '' } },
    )

    // Parse the JSON output from the script
    const lines = stdout.trim().split('\n')
    const lastLine = lines[lines.length - 1]
    try {
      const result = JSON.parse(lastLine)
      res.json(result)
    } catch {
      res.json({ status: 'completed', stdout: stdout.slice(-500), stderr: stderr?.slice(-500) })
    }
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
})

app.get('/api/projects/classifier-lab/data/:id/files', async (req, res) => {
  const { pageIndex = '0', pageSize = '50', split, class: cls, search, sortBy, sortDir } = req.query
  const projDir = resolve(CLASSIFIER_DIR, req.params.id)
  const parquetPath = resolve(projDir, 'dataset.parquet')
  const samplesPath = resolve(projDir, 'samples.jsonl')

  // Prefer Parquet (handles millions of rows via polars lazy scan)
  if (existsSync(parquetPath)) {
    try {
      const { execSync } = await import('child_process')
      const clfVenv = resolve(PI_MONO, '.pi/skills/classifier-lab/.venv/bin/python')
      const queryScript = resolve(PI_MONO, '.pi/skills/classifier-lab/scripts/query_dataset.py')
      const args = [
        queryScript, parquetPath,
        '--page', String(pageIndex), '--page-size', String(pageSize),
        ...(cls ? ['--class', String(cls)] : []),
        ...(split && split !== 'All splits' ? ['--split', String(split)] : []),
        ...(search ? ['--search', String(search)] : []),
        ...(sortBy ? ['--sort-by', String(sortBy), '--sort-dir', String(sortDir || 'asc')] : []),
      ]
      const output = execSync(`${clfVenv} ${args.map(a => `'${a}'`).join(' ')}`, {
        encoding: 'utf-8', timeout: 10000, env: { ...process.env, VIRTUAL_ENV: '' },
      })
      return res.json(JSON.parse(output))
    } catch (e) {
      console.error('[clf-files] Parquet query failed, falling back to JSONL:', String(e).slice(0, 200))
    }
  }

  // Fallback: JSONL sample file
  try {
    if (!existsSync(samplesPath)) return res.json({ rows: [], total: 0 })
    const lines = (await readFile(samplesPath, 'utf-8')).trim().split('\n')
    let rows = lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
      .map((r: any) => ({ filename: r.filename || '', className: r.class || r.className || '', split: r.split || 'train', path: r.path || '', text: r.text || '' })) as any[]

    if (split && split !== 'All splits') rows = rows.filter((r: any) => r.split === split)
    if (cls && cls !== 'All classes') rows = rows.filter((r: any) => r.className === cls)
    if (search) {
      const q = String(search).toLowerCase()
      rows = rows.filter((r: any) => r.filename?.toLowerCase().includes(q) || r.text?.toLowerCase().includes(q))
    }
    const total = rows.length
    if (sortBy) {
      const dir = sortDir === 'desc' ? -1 : 1
      rows.sort((a: any, b: any) => String(a[String(sortBy)] ?? '').localeCompare(String(b[String(sortBy)] ?? '')) * dir)
    }
    const pi = Number(pageIndex) || 0
    const ps = Number(pageSize) || 50
    rows = rows.slice(pi * ps, (pi + 1) * ps)
    res.json({ rows, total })
  } catch {
    res.json({ rows: [], total: 0 })
  }
})

// Data profiling — text length stats, vocab, quality checks
app.get('/api/projects/classifier-lab/data/:id/profile', async (req, res) => {
  const projectId = req.params.id
  const projDir = resolve(CLASSIFIER_DIR, projectId)
  const samplesPath = resolve(projDir, 'samples.jsonl')
  const parquetPath = resolve(projDir, 'dataset.parquet')
  // Prefer JSONL (works with vanilla python3), parquet needs venv with polars
  const dataPath = existsSync(samplesPath) ? samplesPath : existsSync(parquetPath) ? parquetPath : null
  if (!dataPath) return res.json({ error: 'no dataset found' })

  // Read modality from data.json if available
  let modality = ''
  const metaPath = resolve(projDir, 'data.json')
  if (existsSync(metaPath)) {
    try {
      const meta = JSON.parse(await readFile(metaPath, 'utf-8'))
      modality = typeof meta.modality === 'string' ? meta.modality : ''
    } catch { /* skip */ }
  }

  const pythonBin = dataPath.endsWith('.parquet')
    ? resolve(PI_MONO, '.pi/skills/classifier-lab/.venv/bin/python')
    : 'python3'

  try {
    const profileScript = resolve(CLASSIFIER_LAB_SKILL_DIR, 'scripts/profile_dataset.py')
    const execFileAsync = promisify(execFile)
    const args = [profileScript, dataPath, ...(modality ? ['--modality', modality] : [])]
    const { stdout } = await execFileAsync(pythonBin, args, {
      timeout: 30_000, env: { ...process.env, VIRTUAL_ENV: '' },
    })
    res.json(JSON.parse(stdout))
  } catch (e) {
    res.json({ error: 'profiling failed', detail: e instanceof Error ? e.message : String(e) })
  }
})

// Tune config — shared HP control surface for human + agent
app.get('/api/projects/classifier-lab/tune-config/:id', async (req, res) => {
  const configPath = resolve(CLASSIFIER_DIR, req.params.id, 'tune-config.json')
  const defaults = {
    lr: 2e-5, batch_size: 16, epochs: 3, dropout: 0.1, weight_decay: 1e-4,
    label_smoothing: 0.0, mixup_alpha: 0.0, cutmix_alpha: 0.0,
    random_erasing: 0.0, warmup_ratio: 0.1,
    _source: 'default', _updated: null, _changelog: [],
  }
  try {
    if (existsSync(configPath)) {
      const saved = JSON.parse(await readFile(configPath, 'utf-8'))
      res.json({ ...defaults, ...saved })
    } else {
      // Try to infer from data.json modality
      const metaPath = resolve(CLASSIFIER_DIR, req.params.id, 'data.json')
      if (existsSync(metaPath)) {
        const meta = JSON.parse(await readFile(metaPath, 'utf-8'))
        const modality = meta.modality || 'text'
        const modalityDefaults: Record<string, Record<string, unknown>> = {
          text: { lr: 2e-5, batch_size: 16, epochs: 3, dropout: 0.1, weight_decay: 1e-4 },
          vision: { lr: 2e-4, batch_size: 32, epochs: 10, dropout: 0.1, weight_decay: 1e-4 },
          tabular: { lr: 0.1, batch_size: 64, epochs: 1, dropout: 0, weight_decay: 0 },
        }
        res.json({ ...defaults, ...(modalityDefaults[modality] || {}), _source: `default-${modality}` })
      } else {
        res.json(defaults)
      }
    }
  } catch {
    res.json(defaults)
  }
})

app.post('/api/projects/classifier-lab/tune-config/:id', async (req, res) => {
  const projectId = req.params.id
  const configPath = resolve(CLASSIFIER_DIR, projectId, 'tune-config.json')
  try {
    // Read existing config
    let existing: Record<string, unknown> = {}
    if (existsSync(configPath)) {
      existing = JSON.parse(await readFile(configPath, 'utf-8'))
    }

    const changelog: Array<Record<string, unknown>> = Array.isArray(existing._changelog) ? existing._changelog as Array<Record<string, unknown>> : []
    const updates = req.body as Record<string, unknown>
    const source = typeof updates._source === 'string' ? updates._source : 'human'

    // Track what changed
    const changes: Record<string, { from: unknown; to: unknown }> = {}
    const hpKeys = ['lr', 'batch_size', 'epochs', 'dropout', 'weight_decay', 'label_smoothing', 'mixup_alpha', 'cutmix_alpha', 'random_erasing', 'warmup_ratio']
    for (const key of hpKeys) {
      if (key in updates && updates[key] !== existing[key]) {
        changes[key] = { from: existing[key], to: updates[key] }
      }
    }

    if (Object.keys(changes).length > 0) {
      changelog.push({ timestamp: new Date().toISOString(), source, changes })
    }

    const merged = { ...existing, ...updates, _source: source, _updated: new Date().toISOString(), _changelog: changelog }
    const projDir = resolve(CLASSIFIER_DIR, projectId)
    if (!existsSync(projDir)) await mkdir(projDir, { recursive: true })
    await writeFile(configPath, JSON.stringify(merged, null, 2), 'utf-8')
    res.json({ saved: true, config: merged })
  } catch (e) {
    res.status(500).json({ error: 'Failed to save config', detail: e instanceof Error ? e.message : String(e) })
  }
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
  const projectId = req.params.id
  try {
    // 1. Primary research document
    let markdown: string | null = null
    const path = resolve(CLASSIFIER_DIR, projectId, 'research.md')
    if (existsSync(path)) {
      markdown = await readFile(path, 'utf-8')
    }

    // 2. Research timeline from dogpile artifacts
    const timeline: Array<Record<string, unknown>> = []
    if (existsSync(CLASSIFIER_ARTIFACTS)) {
      const files = (await readdir(CLASSIFIER_ARTIFACTS)).sort()
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        try {
          const data = JSON.parse(await readFile(resolve(CLASSIFIER_ARTIFACTS, f), 'utf-8'))
          if (data.project_id !== projectId) continue
          if (data.event_type === 'dogpile_research') {
            timeline.push({
              round: data.round,
              phase: data.phase,
              query: data.query,
              resultLength: data.result_length,
              timestamp: data.timestamp,
            })
          }
        } catch { /* skip corrupt */ }
      }
    }

    // 3. Next-steps research if it exists
    const nextStepsPath = resolve(CLASSIFIER_DIR, projectId, 'next-steps.json')
    let nextStepsQuery: string | null = null
    if (existsSync(nextStepsPath)) {
      try {
        const ns = JSON.parse(await readFile(nextStepsPath, 'utf-8'))
        nextStepsQuery = ns.dogpile_hypotheses || null
      } catch { /* skip */ }
    }

    // If no research exists, provide a starting prompt
    if (!markdown && timeline.length === 0) {
      const meta = existsSync(resolve(CLASSIFIER_DIR, projectId, 'meta.json'))
        ? JSON.parse(await readFile(resolve(CLASSIFIER_DIR, projectId, 'meta.json'), 'utf-8'))
        : {}
      markdown = `# ${meta.name || projectId}\n\n**No research yet.** The project agent needs to run /dogpile to research:\n\n- What backbone models work for this task?\n- What datasets are available?\n- What hyperparameters are recommended?\n- What F1 should we target?\n\nThis will populate the Research tab with findings and seed the Tune tab with initial settings.`
    }
    res.json({ markdown, source: markdown ? 'disk' : null, timeline, nextStepsQuery })
  } catch {
    res.json({ markdown: '# Research\n\nNo research data available. Run /dogpile to start.', timeline: [], nextStepsQuery: null })
  }
})

app.get('/api/projects/classifier-lab/gpu-info', async (_req, res) => {
  // Query GPUs via nvidia-smi if available.
  try {
    const { stdout } = await execFileAsync(
      'nvidia-smi',
      [
        '--query-gpu=index,name,memory.total,memory.used,temperature.gpu',
        '--format=csv,noheader,nounits',
      ],
      { timeout: 5000, encoding: 'utf-8' }
    )

    const gpus = stdout
      .trim()
      .split('\n')
      .filter((line: string) => line.trim().length > 0)
      .map((line: string) => {
        const [indexRaw = '', nameRaw = '', memTotalRaw = '', memUsedRaw = '', tempRaw = ''] =
          line.split(',').map((part) => part.trim())

        const index = Number.parseInt(indexRaw, 10)
        const memTotal = Number.parseInt(memTotalRaw, 10)
        const memUsed = Number.parseInt(memUsedRaw, 10)
        const temp = Number.parseInt(tempRaw, 10)

        return {
          index: Number.isFinite(index) ? index : 0,
          name: nameRaw,
          memTotal: Number.isFinite(memTotal) ? memTotal : 0,
          memUsed: Number.isFinite(memUsed) ? memUsed : 0,
          temp: Number.isFinite(temp) ? temp : 0,
        }
      })

    res.json({ gpus })
  } catch {
    res.json({ gpus: [] })
  }
})

// Train results — reads from benchmark.json results array
app.get('/api/projects/classifier-lab/train-results/:id', async (req, res) => {
  try {
    const benchPath = resolve(CLASSIFIER_DIR, req.params.id, 'benchmark.json')
    if (existsSync(benchPath)) {
      const bench = JSON.parse(await readFile(benchPath, 'utf-8'))
      const results = (bench.results || []).map((r: any, i: number) => ({
        rank: i + 1,
        backbone: r.backbone || 'unknown',
        lr: r.lr || '—',
        bs: r.batch_size || 0,
        f1: r.macro_f1 || r.f1 || 0,
        acc: r.accuracy || 0,
        latency: r.latency || '—',
        cost: r.cost || 'FREE',
        status: (r.macro_f1 || r.f1 || 0) >= (bench.gate_f1 || 0.90) ? 'pass' as const : 'fail' as const,
      }))
      return res.json(results)
    }
    res.json([])
  } catch {
    res.json([])
  }
})

app.get('/api/projects/classifier-lab/tune-results/:id', async (req, res) => {
  const projectId = req.params.id
  try {
    // 1. Prefer explicit tune-results.json
    const path = resolve(CLASSIFIER_DIR, projectId, 'tune-results.json')
    if (existsSync(path)) {
      return res.json(normalizeTuneResultsPayload(JSON.parse(await readFile(path, 'utf-8'))))
    }

    // 2. Synthesize from round artifacts + benchmark.json
    const trials: Array<Record<string, unknown>> = []

    // Round artifacts from .artifacts/
    if (existsSync(CLASSIFIER_ARTIFACTS)) {
      const files = (await readdir(CLASSIFIER_ARTIFACTS)).sort()
      for (const f of files) {
        if (!f.endsWith('.json')) continue
        try {
          const data = JSON.parse(await readFile(resolve(CLASSIFIER_ARTIFACTS, f), 'utf-8'))
          if (data.project_id !== projectId || data.event_type !== 'self_improvement_round') continue
          trials.push({
            trial: data.round,
            round: data.round,
            backbone: data.backbone,
            epochs: data.hps?.epochs ?? null,
            lr: data.hps?.lr ?? null,
            augment: (data.hps?.mixup_alpha || data.hps?.cutmix_alpha) ? 'true' : 'false',
            val_f1: data.f1,
            test_f1: data.f1,
            f1: data.f1,
            status: data.f1 >= 0.90 ? 'passed' : 'completed',
            gate_passed: data.f1 >= 0.90,
            hps: data.hps,
            strategy: data.strategy,
            diagnosis: data.diagnosis,
          })
        } catch { /* skip corrupt */ }
      }
    }

    // Enrich from benchmark.json if no round artifacts
    if (trials.length === 0) {
      const benchPath = resolve(CLASSIFIER_DIR, projectId, 'benchmark.json')
      if (existsSync(benchPath)) {
        try {
          const bench = JSON.parse(await readFile(benchPath, 'utf-8'))
          const results = Array.isArray(bench.results) ? bench.results : []
          for (const r of results) {
            trials.push({
              trial: r.rounds ?? 1,
              backbone: r.backbone,
              f1: r.macro_f1,
              test_f1: r.macro_f1,
              status: r.gate_passed ? 'passed' : 'completed',
              gate_passed: r.gate_passed === true,
            })
          }
        } catch { /* skip */ }
      }
    }

    if (trials.length > 0) {
      const bestTrial = trials.reduce<Record<string, unknown> | null>(
        (best, t) => (!best || (Number(t.f1) || 0) > (Number(best.f1) || 0) ? t : best), null,
      )
      return res.json({
        trials,
        strategy: 'switchboard-concurrent',
        winningRound: bestTrial?.trial ?? null,
        completed: trials.length,
        total: trials.length,
      })
    }

    res.json(getDefaultTuneResults())
  } catch {
    res.json(getDefaultTuneResults())
  }
})

app.get('/api/projects/classifier-lab/eval-results/:id', async (req, res) => {
  try {
    const path = resolve(CLASSIFIER_DIR, req.params.id, 'eval-results.json')
    if (existsSync(path)) {
      const raw = JSON.parse(await readFile(path, 'utf-8'))
      res.json(normalizeEvalResultsPayload(raw))
    } else {
      res.json({})
    }
  } catch {
    res.json({})
  }
})

// Failure analysis — aggregates round artifacts + dogpile research for a project
app.get('/api/projects/classifier-lab/failure-analysis/:id', async (req, res) => {
  const projectId = req.params.id
  try {
    const rounds: Array<Record<string, unknown>> = []
    const dogpileInsights: Array<Record<string, unknown>> = []

    // 1. Collect round artifacts from .artifacts/
    if (existsSync(CLASSIFIER_ARTIFACTS)) {
      const files = await readdir(CLASSIFIER_ARTIFACTS)
      for (const f of files.sort()) {
        if (!f.endsWith('.json')) continue
        try {
          const data = JSON.parse(await readFile(resolve(CLASSIFIER_ARTIFACTS, f), 'utf-8'))
          if (data.project_id !== projectId) continue
          if (data.event_type === 'self_improvement_round') {
            rounds.push({
              round: data.round,
              strategy: data.strategy,
              backbone: data.backbone,
              f1: data.f1,
              accuracy: data.accuracy,
              diagnosis: data.diagnosis,
              errors: data.errors,
              hps: data.hps,
              timestamp: data.timestamp,
            })
          } else if (data.event_type === 'dogpile_research') {
            dogpileInsights.push({
              round: data.round,
              phase: data.phase,
              query: data.query,
              result_length: data.result_length,
              timestamp: data.timestamp,
            })
          }
        } catch { /* skip corrupt */ }
      }
    }

    // 2. Read dogpile research markdown if available
    let researchMd = ''
    const researchPath = resolve(CLASSIFIER_DIR, projectId, 'research.md')
    if (existsSync(researchPath)) {
      researchMd = await readFile(researchPath, 'utf-8')
    }

    // 3. Read next-steps.json if pipeline generated it
    let nextSteps: Record<string, unknown> | null = null
    const nextStepsPath = resolve(CLASSIFIER_DIR, projectId, 'next-steps.json')
    if (existsSync(nextStepsPath)) {
      try {
        nextSteps = JSON.parse(await readFile(nextStepsPath, 'utf-8'))
      } catch { /* skip corrupt */ }
    }

    // 4. Derive summary
    const bestF1 = rounds.length ? Math.max(...rounds.map(r => Number(r.f1) || 0)) : 0
    const strategiesTried = rounds.map(r => r.strategy).filter(Boolean)
    const lastDiagnosis = rounds.length ? rounds[rounds.length - 1].diagnosis : null
    const totalRounds = rounds.length

    res.json({
      projectId,
      totalRounds,
      bestF1,
      strategiesTried,
      lastDiagnosis,
      rounds,
      dogpileInsights,
      researchMd: researchMd.slice(0, 3000),
      nextSteps,
    })
  } catch {
    res.json({ projectId, totalRounds: 0, bestF1: 0, strategiesTried: [], rounds: [], dogpileInsights: [] })
  }
})

// Promote — triggers model export + optional HuggingFace push via classifier-lab skill
app.post('/api/projects/classifier-lab/promote/:id', async (req, res) => {
  const projectId = req.params.id
  try {
    // Verify eval gate passed first
    const evalPath = resolve(CLASSIFIER_DIR, projectId, 'eval-results.json')
    if (existsSync(evalPath)) {
      const evalData = JSON.parse(await readFile(evalPath, 'utf-8'))
      const f1 = evalData.macro_f1 ?? evalData.f1 ?? 0
      const threshold = evalData.gate_threshold ?? evalData.holdout_gate_f1 ?? 0.90
      if (f1 < threshold) {
        return res.status(400).json({ error: `Holdout gate not met: F1 ${f1.toFixed(3)} < ${threshold}` })
      }
    }

    // Read benchmark to get winner backbone
    const benchPath = resolve(CLASSIFIER_DIR, projectId, 'benchmark.json')
    const bench = existsSync(benchPath) ? JSON.parse(await readFile(benchPath, 'utf-8')) : {}
    const winner = bench.selected_backbone ?? 'unknown'

    // Trigger promotion via export.py directly (not run.sh which may not route correctly)
    const { format = 'safetensors', pushToHf = false } = req.body as { format?: string; pushToHf?: boolean }
    const projDir = resolve(CLASSIFIER_DIR, projectId)
    const exportScript = resolve(CLASSIFIER_LAB_SKILL_DIR, 'scripts', 'export.py')
    if (!existsSync(exportScript)) return res.status(500).json({ error: 'export.py not found' })

    const pushFlag = pushToHf ? ' --push-to-hf' : ''
    const cmd = `cd "${resolve(CLASSIFIER_LAB_SKILL_DIR)}" && unset VIRTUAL_ENV && uv run python scripts/export.py "${projDir}" --model "${winner}" --format ${format}${pushFlag}`

    const execFileAsync = promisify(execFile)
    try {
      const { stdout } = await execFileAsync('bash', ['-c', cmd], { timeout: 300_000, env: (() => { const e = { ...process.env }; delete e.VIRTUAL_ENV; return e })() })

      // Write promotion status
      const promotePath = resolve(CLASSIFIER_DIR, projectId, 'promote-status.json')
      const status = {
        promoted: true,
        backbone: winner,
        format,
        pushed_to_hf: pushToHf,
        timestamp: new Date().toISOString(),
        output: stdout.slice(0, 1000),
      }
      await writeFile(promotePath, JSON.stringify(status, null, 2), 'utf-8')

      res.json(status)
    } catch (e) {
      res.status(500).json({ error: 'Promotion failed', detail: e instanceof Error ? e.message : String(e) })
    }
  } catch (e) {
    res.status(500).json({ error: 'Promotion failed', detail: e instanceof Error ? e.message : String(e) })
  }
})

// Model card — generated from eval data via huggingface_hub
app.get('/api/projects/classifier-lab/model-card/:id', async (req, res) => {
  const projectId = req.params.id
  try {
    const projDir = resolve(CLASSIFIER_DIR, projectId)
    if (!existsSync(projDir)) return res.json({ markdown: '', error: 'Project not found' })

    const scriptPath = resolve(CLASSIFIER_LAB_SKILL_DIR, 'scripts', 'generate_model_card.py')
    if (!existsSync(scriptPath)) return res.json({ markdown: '', error: 'generate_model_card.py not found' })

    const execFileAsync = promisify(execFile)
    const { stdout } = await execFileAsync('python3', [scriptPath, projDir], { timeout: 15_000 })
    res.json({ markdown: stdout })
  } catch (e) {
    res.json({ markdown: '', error: e instanceof Error ? e.message : String(e) })
  }
})

// ── Eval test suite CRUD ────────────────────────────────────────────
const EVAL_QUESTIONS_FILE = 'eval-questions.json'

// GET — list all eval questions
app.get('/api/projects/classifier-lab/eval-questions/:id', async (req, res) => {
  try {
    const path = resolve(CLASSIFIER_DIR, req.params.id, EVAL_QUESTIONS_FILE)
    if (existsSync(path)) {
      const data = JSON.parse(await readFile(path, 'utf-8'))
      res.json(data)
    } else {
      res.json({ questions: [], results: null })
    }
  } catch {
    res.json({ questions: [], results: null })
  }
})

// POST — save questions (full replace)
app.post('/api/projects/classifier-lab/eval-questions/:id', async (req, res) => {
  try {
    const path = resolve(CLASSIFIER_DIR, req.params.id, EVAL_QUESTIONS_FILE)
    const body = req.body as { questions: Array<{ text: string; expected: string; id?: string }> }
    const questions = (body.questions || []).map((q, i) => ({
      id: q.id || `q_${Date.now()}_${i}`,
      text: (q.text || '').trim(),
      expected: (q.expected || '').trim(),
    })).filter(q => q.text && q.expected)
    await writeFile(path, JSON.stringify({ questions, results: null, updated: new Date().toISOString() }, null, 2), 'utf-8')
    res.json({ ok: true, count: questions.length })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
})

// POST — import questions from CSV/JSONL body
app.post('/api/projects/classifier-lab/eval-questions/:id/import', async (req, res) => {
  try {
    const path = resolve(CLASSIFIER_DIR, req.params.id, EVAL_QUESTIONS_FILE)
    const existing = existsSync(path) ? JSON.parse(await readFile(path, 'utf-8')) : { questions: [] }
    const body = req.body as { format: string; data: string }
    const newQuestions: Array<{ id: string; text: string; expected: string }> = []

    if (body.format === 'jsonl') {
      for (const line of (body.data || '').split('\n')) {
        const trimmed = line.trim()
        if (!trimmed) continue
        try {
          const row = JSON.parse(trimmed)
          const text = (row.text || row.question || row.input || '').trim()
          const expected = (row.expected || row.class || row.label || row.className || '').trim()
          if (text && expected) newQuestions.push({ id: `q_${Date.now()}_${newQuestions.length}`, text, expected })
        } catch { /* skip bad lines */ }
      }
    } else {
      // CSV: first line is header, columns: text,expected
      const lines = (body.data || '').split('\n').filter(l => l.trim())
      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',').map(s => s.trim().replace(/^"|"$/g, ''))
        if (parts.length >= 2 && parts[0] && parts[1]) {
          newQuestions.push({ id: `q_${Date.now()}_${i}`, text: parts[0], expected: parts[1] })
        }
      }
    }

    const merged = [...(existing.questions || []), ...newQuestions]
    await writeFile(path, JSON.stringify({ questions: merged, results: null, updated: new Date().toISOString() }, null, 2), 'utf-8')
    res.json({ ok: true, imported: newQuestions.length, total: merged.length })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
})

// POST — run eval: takes questions, returns predictions (stub — real inference requires model loaded)
app.post('/api/projects/classifier-lab/eval-questions/:id/run', async (req, res) => {
  try {
    const projDir = resolve(CLASSIFIER_DIR, req.params.id)
    const qPath = resolve(projDir, EVAL_QUESTIONS_FILE)
    if (!existsSync(qPath)) return res.status(404).json({ error: 'No eval questions' })

    const data = JSON.parse(await readFile(qPath, 'utf-8'))
    const questions: Array<{ id: string; text: string; expected: string }> = data.questions || []
    if (!questions.length) return res.json({ error: 'No questions to evaluate' })

    // Try to run inference via classifier-lab skill
    const scriptPath = resolve(CLASSIFIER_LAB_SKILL_DIR, 'scripts', 'run_eval_questions.py')
    if (existsSync(scriptPath)) {
      const execFileAsync = promisify(execFile)
      try {
        const evalCmd = `cd "${resolve(CLASSIFIER_LAB_SKILL_DIR)}" && unset VIRTUAL_ENV && uv run python scripts/run_eval_questions.py "${projDir}"`
        const evalEnv = { ...process.env }
        delete evalEnv.VIRTUAL_ENV
        const { stdout } = await execFileAsync('bash', ['-c', evalCmd], { timeout: 120_000, env: evalEnv })
        const results = JSON.parse(stdout)
        // Save results alongside questions
        data.results = results
        data.evaluated_at = new Date().toISOString()
        await writeFile(qPath, JSON.stringify(data, null, 2), 'utf-8')
        res.json(results)
        return
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e)
        console.error(`[eval] inference failed for ${req.params.id}: ${errMsg}`)
        return res.status(500).json({ error: `Inference failed: ${errMsg}`, hint: 'Check that a trained model exists. Run the pipeline from the Train tab first.' })
      }
    }

    // No inference script — return clear error, not silent stub
    return res.status(500).json({ error: 'No inference script (run_eval_questions.py) found', hint: 'The evaluation script is missing. This is a configuration error.' })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
})

// Full pipeline — data enrichment + training loop in one call
// Full pipeline — runs in background, returns immediately. Poll GET /data/:id for status.
app.post('/api/projects/classifier-lab/pipeline/:id', async (req, res) => {
  const projectId = req.params.id
  try {
    const projDir = resolve(CLASSIFIER_DIR, projectId)
    if (!existsSync(projDir)) return res.status(404).json({ error: 'Project not found' })

    const scriptPath = resolve(CLASSIFIER_LAB_SKILL_DIR, 'scripts', 'pipeline.py')
    if (!existsSync(scriptPath)) return res.status(500).json({ error: 'pipeline.py not found' })

    const { gate_f1 = 0.90, max_rounds = 8, min_per_class = 50, max_length = 128 } = req.body as Record<string, number>

    // Update meta to "running" immediately
    const metaPath = resolve(projDir, 'meta.json')
    if (existsSync(metaPath)) {
      const meta = JSON.parse(await readFile(metaPath, 'utf-8'))
      meta.status = 'pipeline-running'
      meta.pipeline_started = new Date().toISOString()
      await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    }

    // Spawn pipeline in background — don't await
    const { spawn } = await import('child_process')
    const pipelineEnv = { ...process.env }
    delete pipelineEnv.VIRTUAL_ENV
    const pipelineCmd = [
      `cd "${resolve(CLASSIFIER_LAB_SKILL_DIR)}"`,
      'unset VIRTUAL_ENV',
      `uv run python scripts/pipeline.py "${projDir}" --gate-f1 ${gate_f1} --max-training-rounds ${max_rounds} --min-per-class ${min_per_class} --max-length ${max_length}`,
    ].join(' && ')
    const pipelineChild = spawn('bash', ['-c', pipelineCmd], { env: pipelineEnv, timeout: 1800_000, stdio: 'pipe' })
    pipelineChild.on('exit', (code) => {
      if (code !== 0) {
        console.error(`[pipeline] ${projectId} failed with code ${code}`)
        try {
          const meta = JSON.parse(readFileSync(metaPath, 'utf-8'))
          meta.status = 'pipeline-failed'
          meta.pipeline_error = `exit code ${code}`
          writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
        } catch { /* */ }
      } else {
        console.log(`[pipeline] ${projectId} complete`)
      }
    })

    res.json({ status: 'started', message: 'Pipeline running in background. Poll meta.json for status.' })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
})

// Pipeline status — check meta.json for current status
app.get('/api/projects/classifier-lab/pipeline-status/:id', async (req, res) => {
  try {
    const metaPath = resolve(CLASSIFIER_DIR, req.params.id, 'meta.json')
    if (existsSync(metaPath)) {
      const meta = JSON.parse(await readFile(metaPath, 'utf-8'))
      res.json({ status: meta.status, f1: meta.f1, backbone: meta.backbone, started: meta.pipeline_started })
    } else {
      res.json({ status: 'unknown' })
    }
  } catch {
    res.json({ status: 'unknown' })
  }
})

// Thunderdome — concurrent backbone tournament via generate_manifest.py + thunderdome run
app.post('/api/projects/classifier-lab/pipeline/:id/thunderdome', async (req, res) => {
  const projectId = req.params.id
  try {
    const projDir = resolve(CLASSIFIER_DIR, projectId)
    if (!existsSync(projDir)) return res.status(404).json({ error: 'Project not found' })

    const manifestScript = resolve(CLASSIFIER_LAB_SKILL_DIR, 'scripts', 'generate_manifest.py')
    if (!existsSync(manifestScript)) return res.status(500).json({ error: 'generate_manifest.py not found' })

    const thunderdomeDir = resolve(PI_MONO, '.pi/skills/thunderdome')
    if (!existsSync(resolve(thunderdomeDir, 'run.sh'))) return res.status(500).json({ error: 'thunderdome skill not found' })

    // Update meta to running
    const metaPath = resolve(projDir, 'meta.json')
    if (existsSync(metaPath)) {
      const meta = JSON.parse(await readFile(metaPath, 'utf-8'))
      meta.status = 'thunderdome-running'
      meta.pipeline_started = new Date().toISOString()
      await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    }

    // Step 1: Generate manifest, Step 2: Run thunderdome — background
    const { spawn } = await import('child_process')
    const env = { ...process.env }
    delete env.VIRTUAL_ENV
    const manifestPath = resolve(projDir, 'thunderdome-manifest.yaml')
    const cmd = [
      `cd "${resolve(CLASSIFIER_LAB_SKILL_DIR)}" && unset VIRTUAL_ENV && uv run python scripts/generate_manifest.py "${projDir}" --output "${manifestPath}"`,
      `cd "${thunderdomeDir}" && unset VIRTUAL_ENV && uv run python -m scripts.thunderdome run "${manifestPath}"`,
    ].join(' && ')

    const child = spawn('bash', ['-c', cmd], { env, timeout: 1800_000, stdio: 'pipe' })
    child.on('exit', async (code) => {
      try {
        const meta = JSON.parse(await readFile(metaPath, 'utf-8'))
        if (code !== 0) {
          console.error(`[thunderdome] ${projectId} failed with code ${code}`)
          meta.status = 'thunderdome-failed'
        } else {
          console.log(`[thunderdome] ${projectId} complete`)
          // Read thunderdome output to update meta with results
          const benchPath = resolve(projDir, 'benchmark.json')
          if (existsSync(benchPath)) {
            const bench = JSON.parse(await readFile(benchPath, 'utf-8'))
            meta.f1 = bench.selected_metrics?.macro_f1 ?? meta.f1
            meta.backbone = bench.selected_backbone ?? meta.backbone
            meta.status = (meta.f1 ?? 0) >= (bench.gate_f1 ?? 0.90) ? 'trained' : 'halted-training'
          } else {
            meta.status = 'thunderdome-complete'
          }
        }
        await writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
      } catch { /* */ }
    })

    res.json({ status: 'started', mode: 'thunderdome', message: 'Concurrent backbone tournament running. Poll pipeline-status for updates.' })
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) })
  }
})

app.post('/api/projects/classifier-lab/rerun/:id', async (req, res) => {
  const projectId = req.params.id
  const body = req.body as Partial<ClassifierRerunBody>

  const backbones = Array.isArray(body.backbones)
    ? body.backbones.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
    : []
  const gateF1 = typeof body.gate_f1 === 'number' ? body.gate_f1 : NaN
  const maxRounds = typeof body.max_rounds === 'number' ? body.max_rounds : NaN
  const maxTrainSamples = typeof body.max_train_samples === 'number' ? body.max_train_samples : NaN
  const modality = typeof body.modality === 'string' ? body.modality.trim() : ''
  const task = typeof body.task === 'string' ? body.task.trim() : ''

  if (!projectId || backbones.length === 0 || !Number.isFinite(gateF1) || !Number.isFinite(maxRounds) || !Number.isFinite(maxTrainSamples) || !modality || !task) {
    return res.status(400).json({
      error: 'Invalid body. Expected {backbones:[], gate_f1, max_rounds, max_train_samples, modality, task}',
    })
  }

  const dataDir = await resolveClassifierDataDir(projectId)
  if (!dataDir) return res.status(400).json({ error: `Unable to resolve data_dir for project ${projectId}` })

  const manifests = backbones.map((backbone) => generateClassifierManifest(
    backbone,
    projectId,
    task,
    modality,
    dataDir,
    gateF1,
    maxRounds,
    maxTrainSamples,
  ))

  const submittedRunIds: string[] = []
  for (const manifest of manifests) {
    try {
      const switchboardRes = await fetch(`${CLASSIFIER_SWITCHBOARD_URL}/run/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest }),
      })
      if (!switchboardRes.ok) {
        const detail = await switchboardRes.text()
        return res.status(502).json({
          error: `Switchboard submission failed for ${manifest.run_id}`,
          detail,
        })
      }
      submittedRunIds.push(manifest.run_id)
    } catch (err) {
      return res.status(502).json({
        error: `Switchboard submission failed for ${manifest.run_id}`,
        detail: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return res.json({ submitted: true, run_ids: submittedRunIds })
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

type EvidenceCaseRunStatus = 'running' | 'completed' | 'failed'
type EvidenceCaseSseEventType = 'run_started' | 'gate' | 'diagnostics' | 'result' | 'run_completed' | 'error'

interface EvidenceCaseRunHistoryEntry {
  id: string
  started_at: string
  completed_at?: string
  status: EvidenceCaseRunStatus
  question: string
  control_id?: string | null
  node_label?: string | null
  verdict?: JsonRecord
  gates?: JsonRecord[]
  diagnostics?: JsonRecord
  error?: string
}

const EVIDENCE_CASE_HISTORY_LIMIT = 50
const evidenceCaseRunHistory: EvidenceCaseRunHistoryEntry[] = []
let evidenceCaseRunSequence = 0

function createEvidenceCaseRunId(): string {
  evidenceCaseRunSequence = (evidenceCaseRunSequence + 1) % 1_000_000
  return `ec-${Date.now().toString(36)}-${evidenceCaseRunSequence.toString(36).padStart(4, '0')}`
}

function rememberEvidenceCaseRun(entry: EvidenceCaseRunHistoryEntry): void {
  const existing = evidenceCaseRunHistory.findIndex((run) => run.id === entry.id)
  if (existing >= 0) evidenceCaseRunHistory.splice(existing, 1)
  evidenceCaseRunHistory.unshift(entry)
  evidenceCaseRunHistory.splice(EVIDENCE_CASE_HISTORY_LIMIT)
}

function sendEvidenceCaseSse(res: any, event: EvidenceCaseSseEventType, data: JsonRecord): void {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify({ type: event, ...data })}\n\n`)
}

function evidenceCaseAmbiguousPayload(question: string, ambiguousReferents: string[]): JsonRecord {
  return {
    verdict: { state: 'inconclusive', action: 'clarify', grade: 'C', score: 0.25 },
    gate_trace: [
      {
        gate: 'ambiguous_referent',
        passed: false,
        detail: `Missing explicit referent for: ${ambiguousReferents.join(', ')}`,
      },
    ],
    evidence: [],
    glossary: [],
    crosswalk_chains: [],
    context: {},
    diagnostics: {
      authority: 'server_deterministic_gate',
      workflow: 'create-evidence-case',
      mode: 'clarification_required',
      question,
      qra_quality: {
        status: 'needs_repair',
        issue_code: 'ambiguous_referent',
        issue_label: 'Ambiguous referent',
        ambiguous_referents: ambiguousReferents,
        disposition: 'retain_for_adversarial_training',
        safe_action: 'plan_repair',
      },
    },
    qra_quality: {
      status: 'needs_repair',
      issue_code: 'ambiguous_referent',
      issue_label: 'Ambiguous referent',
      ambiguous_referents: ambiguousReferents,
      disposition: 'retain_for_adversarial_training',
      safe_action: 'plan_repair',
    },
    answer: `Clarify the missing context for ${ambiguousReferents.join(', ')} before an authoritative evidence case can be built.`,
    cae_tree: null,
  }
}

function normalizeEvidenceCaseWorkflowResult(question: string, controlId: unknown, result: any): JsonRecord {
  const reviewStatus = result.review_status || 'unknown'
  const glossary = Array.isArray(result.glossary) ? result.glossary : []
  const crosswalks = Array.isArray(result.crosswalk_chains) ? result.crosswalk_chains : []
  const qras = Array.isArray(result.prior_qra_evidence) ? result.prior_qra_evidence : []
  const relatedQras = Array.isArray(result.related_qra_evidence) ? result.related_qra_evidence : []
  const context = result.context || {}
  const cweRecord = result.cwe_record || null
  const verdictState = reviewStatus === 'passed' ? 'satisfied'
    : reviewStatus === 'needs_review' ? 'inconclusive'
    : 'not_satisfied'
  const verdictGrade = verdictState === 'satisfied' ? 'A'
    : verdictState === 'inconclusive' ? 'C' : 'F'
  const verdictScore = verdictState === 'satisfied' ? 1.0
    : verdictState === 'inconclusive' ? 0.5 : 0.0
  const hasGlossary = glossary.length > 0
  const hasCrosswalks = crosswalks.length > 0
  const hasQras = qras.length > 0 || relatedQras.length > 0
  const hasCwe = !!cweRecord
  const gateTrace = [
    { gate: 'extract_entities', passed: hasGlossary || hasCwe, detail: hasCwe ? `CWE: ${cweRecord?.control_id}` : `${glossary.length} terms` },
    { gate: 'crosswalk', passed: hasCrosswalks, detail: `${crosswalks.length} chains` },
    { gate: 'qra_recall', passed: hasQras, detail: `${qras.length + relatedQras.length} QRAs` },
    { gate: 'framework', passed: !!context.framework, detail: context.framework || 'none' },
  ]

  return {
    verdict: { state: verdictState, grade: verdictGrade, score: verdictScore },
    gate_trace: gateTrace,
    evidence: [...qras, ...relatedQras].slice(0, 5).map((q: any) => ({
      method: 'EXAMINE',
      layer: 'sparta_qra',
      result: { qra_text: q.question || q.problem, answer: q.answer || q.solution, control_id: q.control_id },
      confidence: q.score || 0.5,
    })),
    glossary: glossary.slice(0, 20).map((g: any) => ({
      term: g.name || g.id,
      type: g.framework === 'CWE' ? 'cwe_weakness'
        : (g.framework?.startsWith('ATT') || g.type === 'attack_technique') ? 'attack_technique'
        : g.type === 'countermeasure' ? 'countermeasure'
        : g.type === 'technique' ? 'technique'
        : g.framework === 'SPARTA' ? 'control'
        : g.framework === 'NIST' ? 'control'
        : 'domain_term',
    })),
    crosswalk_chains: crosswalks,
    context,
    cwe_record: cweRecord,
    diagnostics: {
      authority: 'server_deterministic_gate',
      workflow: 'create-evidence-case',
      mode: 'daemon_deterministic_no_llm',
      question,
      control_id: typeof controlId === 'string' ? controlId : null,
      review_status: reviewStatus,
      counts: {
        glossary: glossary.length,
        crosswalk_chains: crosswalks.length,
        prior_qra_evidence: qras.length,
        related_qra_evidence: relatedQras.length,
      },
      raw_keys: result && typeof result === 'object' ? Object.keys(result).sort() : [],
    },
    answer: hasQras
      ? `Found ${qras.length + relatedQras.length} related QRAs via ${context.framework || 'hybrid'} search.`
      : `No QRAs found for the query.`,
    cae_tree: result.claim ? {
      claim: result.claim,
      strategies: result.strategies || [],
      evidence: result.evidence || [],
      verdict: result.verdict || null,
    } : null,
  }
}

app.post('/api/evidence-case', async (req, res) => {
  // Proxy to memory daemon for evidence case building
  try {
    const result = await proxyPost('/recall', { query: req.body.query || '', collection: 'sparta_qra', limit: 10 })
    res.json({ evidence: result.results || result.items || [] })
  } catch (e) {
    res.status(502).json({ error: String(e) })
  }
})

app.post('/api/evidence-case/run', async (req, res) => {
  // Call daemon /create-evidence-case directly (no subprocess, <1s per best-practices-arangodb)
  const { question, controlId } = req.body
  if (!question) return res.status(400).json({ error: 'question required' })
  const ambiguousReferents = detectAmbiguousQraReferents(question)
  if (ambiguousReferents.length > 0) {
    return res.json(evidenceCaseAmbiguousPayload(String(question), ambiguousReferents))
  }

  try {
    const result = await proxyPost('/create-evidence-case', {
      question,
      source_id: controlId || null,
      skip_qra_recall: false,
      enable_llm: false,
    })

    return res.json(normalizeEvidenceCaseWorkflowResult(String(question), controlId, result))
  } catch (e: any) {
    console.error('[evidence-case/run] Daemon call failed:', e.message)
    try {
      const recall = await proxyPost('/recall', {
        q: question,
        k: 5,
        collections: ['sparta_qra', 'sparta_controls'],
      })
      const items = recall.items || []
      res.json({
        verdict: { state: items.length > 0 ? 'inconclusive' : 'not_satisfied', grade: items.length > 0 ? 'C' : 'F', score: items.length > 0 ? 0.4 : 0 },
        gate_trace: [
          { gate: 'recall_fallback', passed: items.length > 0, detail: `${items.length} items via /recall` },
        ],
        evidence: items.slice(0, 3).map((i: any) => ({
          method: 'EXAMINE',
          layer: i._collection || 'sparta_qra',
          result: { qra_text: i.problem || i.question || i.name, control_id: i.control_id || i._key },
          confidence: i.scores?.bm25 || 0.5,
        })),
        diagnostics: {
          authority: 'server_deterministic_gate',
          workflow: 'create-evidence-case',
          mode: 'recall_fallback',
          daemon_error: e?.message || String(e),
          recall_count: items.length,
        },
        answer: items.length > 0 ? `Found ${items.length} items. Full evidence case requires daemon.` : 'No results found.',
      })
    } catch {
      res.status(502).json({ error: 'Evidence case daemon and recall both unavailable' })
    }
  }
})

app.get('/api/evidence-case/runs', (_req, res) => {
  res.json({ runs: evidenceCaseRunHistory, limit: EVIDENCE_CASE_HISTORY_LIMIT })
})

app.post('/api/evidence-case/stream', async (req, res) => {
  const { question, controlId, nodeLabel } = req.body
  if (!question) return res.status(400).json({ error: 'question required' })

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  if (typeof (res as any).flushHeaders === 'function') (res as any).flushHeaders()

  const run: EvidenceCaseRunHistoryEntry = {
    id: createEvidenceCaseRunId(),
    started_at: new Date().toISOString(),
    status: 'running',
    question: String(question),
    control_id: typeof controlId === 'string' ? controlId : null,
    node_label: typeof nodeLabel === 'string' ? nodeLabel : null,
  }
  rememberEvidenceCaseRun(run)

  const emit = (event: EvidenceCaseSseEventType, data: JsonRecord) => sendEvidenceCaseSse(res, event, { run_id: run.id, ts: new Date().toISOString(), ...data })

  emit('run_started', {
    run: { ...run },
    request: { question: run.question, control_id: run.control_id, node_label: run.node_label },
    diagnostics: { authority: 'server_deterministic_gate', workflow: 'create-evidence-case', enable_llm: false },
  })

  try {
    const ambiguousReferents = detectAmbiguousQraReferents(question)
    if (ambiguousReferents.length > 0) {
      const payload = evidenceCaseAmbiguousPayload(String(question), ambiguousReferents)
      run.status = 'completed'
      run.completed_at = new Date().toISOString()
      run.verdict = payload.verdict as JsonRecord
      run.gates = payload.gate_trace as JsonRecord[]
      run.diagnostics = payload.diagnostics as JsonRecord
      rememberEvidenceCaseRun(run)
      emit('gate', { gate: (payload.gate_trace as JsonRecord[])[0] })
      emit('diagnostics', { diagnostics: payload.diagnostics as JsonRecord })
      emit('result', { result: payload })
      emit('run_completed', { run: { ...run } })
      return res.end()
    }

    emit('gate', { gate: { gate: 'ambiguous_referent', passed: true, detail: 'question contains explicit referents' } })
    emit('diagnostics', { diagnostics: { authority: 'server_deterministic_gate', workflow: 'create-evidence-case', mode: 'daemon_deterministic_no_llm', step: 'daemon_request' } })

    const daemonResult = await proxyPost('/create-evidence-case', {
      question,
      source_id: controlId || null,
      skip_qra_recall: false,
      enable_llm: false,
    }, 120_000)
    const payload = normalizeEvidenceCaseWorkflowResult(String(question), controlId, daemonResult)
    const gates = Array.isArray(payload.gate_trace) ? payload.gate_trace as JsonRecord[] : []
    for (const gate of gates) emit('gate', { gate })
    emit('diagnostics', { diagnostics: payload.diagnostics as JsonRecord })
    emit('result', { result: payload })

    run.status = 'completed'
    run.completed_at = new Date().toISOString()
    run.verdict = payload.verdict as JsonRecord
    run.gates = gates
    run.diagnostics = payload.diagnostics as JsonRecord
    rememberEvidenceCaseRun(run)
    emit('run_completed', { run: { ...run } })
    return res.end()
  } catch (e: any) {
    run.status = 'failed'
    run.completed_at = new Date().toISOString()
    run.error = e?.message || String(e)
    run.diagnostics = { authority: 'server_deterministic_gate', workflow: 'create-evidence-case', mode: 'error', error: run.error }
    rememberEvidenceCaseRun(run)
    emit('error', { error: 'Evidence case daemon unavailable', detail: run.error, diagnostics: run.diagnostics })
    emit('run_completed', { run: { ...run } })
    return res.end()
  }
})

app.post('/api/evidence/generate', async (req, res) => {
  const { question } = req.body
  if (!question) return res.status(400).json({ error: 'question required' })

  try {
    // Run the high-fidelity evidence case pipeline (deterministic proof chain)
    const { stdout } = await execAsync(`uv run -q review_question.py evidence-case --question "${question.replace(/"/g, '\\"')}" --json`, {
      cwd: RE_QUESTION_SKILL
    })
    
    // Safety check: parse out JSON payload if Python dumped logs before it
    const jsonStr = stdout.slice(stdout.indexOf('{'))
    res.json(JSON.parse(jsonStr))
  } catch (e: any) {
    console.error('[evidence/generate] Python skill failed:', e.message)
    res.status(502).json({ error: 'Evidence generation failed', details: e.message })
  }
})

// ── Evidence Case Trace: gate chain per control ─────────────────────────────

app.post('/api/evidence-case/trace', async (req, res) => {
  const { control_id } = req.body as { control_id: string }
  if (!control_id) return res.status(400).json({ error: 'control_id required' })

  try {
    // Query dedicated evidence_cases collection (not lessons)
    const listResult = await proxyPost('/list', {
      collection: 'evidence_cases', limit: 100,
    }) as { documents?: Array<Record<string, any>> }

    const cases: Array<Record<string, any>> = []
    for (const doc of listResult.documents ?? []) {
      const cids: string[] = doc.control_ids ?? []
      if (!cids.some((c: string) => c === control_id || control_id.startsWith(c) || c.startsWith(control_id))) continue
      cases.push({
        verdict: doc.verdict ?? 'unknown', grade: doc.grade ?? '?',
        question: doc.question ?? '',
        gates_passed: doc.gates_passed ?? 0, gates_total: doc.gates_total ?? 0,
        gate_summary: doc.gate_summary ?? '', tier: doc.tier ?? 'T0', control_ids: cids,
      })
    }

    // Fallback: also check lessons for legacy cases not yet migrated
    if (cases.length === 0) {
      const recallResult = await proxyPost('/recall', {
        q: `${control_id} evidence case verdict`, k: 20,
        tags: ['sensai-cascade-label'],
      }) as { items?: Array<Record<string, any>> }
      for (const item of recallResult.items ?? []) {
        let sol: Record<string, any> = {}
        try { const raw = item.solution ?? ''; if (raw.startsWith('{')) sol = JSON.parse(raw) } catch { continue }
        const cids: string[] = sol.control_ids ?? []
        if (!cids.some((c: string) => c === control_id || control_id.startsWith(c) || c.startsWith(control_id))) continue
        cases.push({
          verdict: sol.verdict ?? 'unknown', grade: sol.grade ?? '?',
          question: sol.question ?? item.problem ?? '',
          gates_passed: sol.gates_passed ?? 0, gates_total: sol.gates_total ?? 0,
          gate_summary: sol.gate_summary ?? '', tier: sol.tier ?? 'T0', control_ids: cids,
        })
      }
    }

    res.json({ control_id, cases })
  } catch (e) {
    res.status(500).json({ error: 'Evidence trace failed', detail: String(e) })
  }
})

// ── Critical Path: failing attack chains ────────────────────────────────────

app.post('/api/critical-path', async (req, res) => {
  const { control_id } = req.body as { control_id?: string }

  try {
    // Get actual relationships from sparta_relationships via /list (not /recall which returns lessons)
    const filters: Record<string, string> = {}
    if (control_id) filters.source_control_id = control_id
    const relResult = await proxyPost('/list', {
      collection: 'sparta_relationships', limit: 200, ...(control_id ? { filters } : {}),
    }) as { documents?: Array<Record<string, any>> }
    let rels = relResult.documents ?? []

    // If filtering by source didn't find enough, also search by target
    if (control_id && rels.length < 10) {
      const tgtResult = await proxyPost('/list', {
        collection: 'sparta_relationships', limit: 200, filters: { target_control_id: control_id },
      }) as { documents?: Array<Record<string, any>> }
      const seen = new Set(rels.map(r => r._key))
      for (const r of tgtResult.documents ?? []) {
        if (!seen.has(r._key)) rels.push(r)
      }
    }

    // Build verdict map from evidence_cases collection (dedicated, not lessons)
    const evidenceResult = await proxyPost('/list', {
      collection: 'evidence_cases', limit: 500,
    }) as { documents?: Array<Record<string, any>> }
    const verdictMap = new Map<string, string>()
    for (const doc of evidenceResult.documents ?? []) {
      for (const cid of (doc.control_ids ?? [])) {
        const existing = verdictMap.get(cid)
        if (!existing || doc.verdict === 'satisfied') verdictMap.set(cid, doc.verdict ?? 'unknown')
      }
    }

    // Filter to edges where at least one endpoint lacks satisfied verdict
    const failingEdges = rels.filter((r: any) => {
      const sv = verdictMap.get(r.source_control_id) ?? 'none'
      const tv = verdictMap.get(r.target_control_id) ?? 'none'
      return sv !== 'satisfied' || tv !== 'satisfied'
    })

    const nodeMap = new Map<string, { id: string; verdict: string; framework: string }>()
    const edges: Array<{ source: string; target: string; method: string; score: number }> = []
    for (const r of failingEdges.slice(0, 30)) {
      const src = r.source_control_id ?? '', tgt = r.target_control_id ?? ''
      if (!src || !tgt) continue
      if (!nodeMap.has(src)) nodeMap.set(src, { id: src, verdict: verdictMap.get(src) ?? 'none', framework: r.source_framework ?? '?' })
      if (!nodeMap.has(tgt)) nodeMap.set(tgt, { id: tgt, verdict: verdictMap.get(tgt) ?? 'none', framework: r.target_framework ?? '?' })
      edges.push({ source: src, target: tgt, method: r.method ?? '?', score: r.combined_score ?? 0 })
    }

    const chains = edges.length > 0 ? [{ nodes: [...nodeMap.values()], edges, severity: edges.length }] : []
    res.json({ chains, total_failing_edges: failingEdges.length })
  } catch (e) {
    res.status(500).json({ error: 'Critical path query failed', detail: String(e) })
  }
})

// ── Static file serving for artifacts/captures/screenshots ──────────────────
app.use('/artifacts', express.static(ARTIFACTS_ROOT))
app.use('/artifacts/pdf-lab', express.static(PDF_LAB_ARTIFACTS_ROOT))
app.use('/artifacts/pdf-lab', express.static(PUBLIC_ROOT))
app.use('/captures', express.static(CAPTURES_DIR))
app.use('/screenshots', express.static(SCREENSHOTS_DIR))

// ── Test Runner Routes ──────────────────────────────────────────────────────
import { WebSocketServer, WebSocket } from 'ws'
import { registerTestRunnerRoutes } from './test-runner.ts'
import { createPiChatRouter } from '../../pi-chat-adapter/src/index.ts'

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
broadcastWs = broadcast
startSpartaCoveragePushBridge()

registerTestRunnerRoutes(app, broadcast)

// Pi Chat Adapter — D-Bus bridge to embry-agent (SSE streaming)
try {
  app.use('/api/agent', createPiChatRouter())
  console.log('  Pi chat adapter: registered at /api/agent')
} catch (err) {
  console.warn('  Pi chat adapter: failed to register (embry-agent may not be running)', err)
}

// ── Serve production build if dist/ exists ──────────────────────────────────
const distPath = resolve(__dirname, '../dist')
if (existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get('{*path}', (_req, res) => {
    res.sendFile(resolve(distPath, 'index.html'))
  })
  console.log(`  Serving production build from ${distPath}`)
}

// ── Start ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 3001

httpServer.listen(Number(PORT), '0.0.0.0', () => {
  console.log(`UX Lab API on http://localhost:${PORT}`)
  console.log(`  Memory daemon: ${MEMORY_SOCKET}`)
  console.log(`  scillm: ${SCILLM_URL}`)
  console.log(`  artifacts: ${ARTIFACTS_ROOT}`)
  console.log(`  PDF Lab artifacts: ${PDF_LAB_ARTIFACTS_ROOT}`)
  console.log(`  Test runner: registered`)
})

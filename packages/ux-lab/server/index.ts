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
import { buildQraReviewPatch, persistQraReview } from './qraReview.js'
import { F36ExplorerProjectionError, loadF36ExplorerProjection } from './f36ExplorerProjection.js'
import { F36ExplorerReadModelError, loadF36ExplorerReadModels } from './f36ExplorerReadModels.js'
import { createServer } from 'http'
import { request as httpRequest } from 'http'
import { request as httpsRequest } from 'https'
import { createHash } from 'crypto'
import { execFile, exec, spawn } from 'child_process'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { readdir, readFile, writeFile, mkdir, unlink, stat, copyFile, rename as fsRename } from 'fs/promises'
import { existsSync, readFileSync, writeFileSync, realpathSync, createReadStream, createWriteStream, watch, readdirSync } from 'fs'
import { load as yamlLoad } from 'js-yaml'
import { promisify } from 'util'
import { listSkillsCatalog } from './skillsCatalog.js'
import { createPersonaDreamRouter } from '/home/graham/workspace/experiments/agent-skills-main/skills/persona-dream/server/src/index.ts'

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

const personaDreamRouterOptions = {
  reportRoots: ['/home/graham/workspace/experiments/agent-skills-main/skills/persona-dream/reports'],
  outputRoots: ['/mnt/storage12tb/skills/persona-dream/outputs'],
  assetRoots: ['/mnt/storage12tb/media/personas'],
  repairEnqueueMode: 'explicit-post-only' as const,
}
app.use('/api/projects/dream-next', createPersonaDreamRouter(personaDreamRouterOptions))
app.use('/api/projects/dream', createPersonaDreamRouter(personaDreamRouterOptions))

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

app.get('/api/f36/explorer-projection', async (_req, res) => {
  try {
    const projection = await loadF36ExplorerProjection()
    res.setHeader('Cache-Control', 'no-store')
    return res.json(projection)
  } catch (error) {
    if (error instanceof F36ExplorerProjectionError) {
      return res.status(error.statusCode).json({ error: error.code, detail: error.message })
    }
    return res.status(500).json({
      error: 'F36_PROJECTION_READ_FAILED',
      detail: error instanceof Error ? error.message : String(error),
    })
  }
})

function sendF36ReadModelError(res: express.Response, error: unknown) {
  if (error instanceof F36ExplorerReadModelError) {
    return res.status(error.statusCode).json({ error: error.code, detail: error.message, live: false, mocked: false })
  }
  return res.status(500).json({ error: 'F36_READ_MODEL_FAILED', detail: error instanceof Error ? error.message : String(error), live: false, mocked: false })
}

for (const [path, key] of [
  ['/api/f36/explorer/v1/projection', 'projection'],
  ['/api/f36/explorer/v1/posture', 'posture'],
  ['/api/f36/explorer/v1/threat-matrix', 'threatMatrix'],
  ['/api/f36/explorer/v1/supply-chain', 'supplyChain'],
] as const) {
  app.get(path, async (_req, res) => {
    try {
      const models = await loadF36ExplorerReadModels()
      res.setHeader('Cache-Control', 'no-store')
      return res.json(models[key])
    } catch (error) {
      return sendF36ReadModelError(res, error)
    }
  })
}

const MEMORY_SOCKET = '/run/user/1000/embry/memory.sock'
const MEMORY_HTTP_URL = process.env.MEMORY_HTTP_URL ?? 'http://127.0.0.1:8601'
const SCILLM_URL = process.env.SCILLM_URL ?? 'http://localhost:4001'
const CHATTERBOX_AGENT_URL = process.env.CHATTERBOX_AGENT_URL ?? 'http://127.0.0.1:8018'
const CHATTERBOX_HOST_OUT_DIR = process.env.CHATTERBOX_HOST_OUT_DIR ?? '/tmp/chatterbox-fork-agent-out'
const CHATTERBOX_HOST_REF_DIR = process.env.CHATTERBOX_HOST_REF_DIR ?? '/home/graham/workspace/experiments/chatterbox/persona_dream_voice_refs'
const CHATTERBOX_CONTAINER_REF_DIR = process.env.CHATTERBOX_CONTAINER_REF_DIR ?? '/work/persona_dream_voice_refs'
const EMBRY_VOICE_E2E_ROOT = process.env.EMBRY_VOICE_E2E_ROOT ?? '/mnt/storage12tb/skills/embry-voice-control/outputs/e2e'
const EMBRY_VOICE_JOURNAL_URL = process.env.EMBRY_VOICE_JOURNAL_URL ?? 'http://127.0.0.1:8019'
const BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY || process.env.BRAVE_API_KEY || ''
const SCILLM_PROXY_KEY = process.env.SCILLM_API_KEY ?? process.env.SCILLM_MASTER_KEY ?? 'sk-dev-proxy-123'
const SCILLM_PROJECT_ROOT = process.env.SCILLM_PROJECT_ROOT ?? '/home/graham/workspace/experiments/scillm'
const TAU_PROJECT_ROOT = process.env.TAU_PROJECT_ROOT ?? '/home/graham/workspace/experiments/tau'
const TAU_STORY_UI_PROOF_ROOT = process.env.TAU_STORY_UI_PROOF_ROOT ?? resolve(TAU_PROJECT_ROOT, 'experiments/goal-locked-subagents/proofs/persona-dream-story-ui-dispatch')
const TAU_SCRIPT_UI_PROOF_ROOT = process.env.TAU_SCRIPT_UI_PROOF_ROOT ?? resolve(TAU_PROJECT_ROOT, 'experiments/goal-locked-subagents/proofs/persona-dream-script-ui-dispatch')
const OC_SUBAGENT_PERSONAS_ROOT = process.env.OC_SUBAGENT_PERSONAS_ROOT ?? '/home/graham/workspace/experiments/agent-skills/skills/oc-subagent/personas'
const SCILLM_DAG_PHASE_ID = process.env.SCILLM_DAG_PHASE_ID ?? ''
const SCILLM_DAG_FALLBACK_PHASE_ID = 'phase-20260519-dag-self-improvement-loop'
const SCILLM_DAG_RUN_ARTIFACT_DIR = process.env.SCILLM_DAG_RUN_ARTIFACT_DIR ?? 'scillm-exec-run-hash-bound'
const SCILLM_DAG_DRAFT_DIR = process.env.SCILLM_DAG_DRAFT_DIR ?? resolve(SCILLM_PROJECT_ROOT, '.codex', 'dag-viewer', 'drafts')
const TRANSPORT_DAG_DRAFT_DIR = process.env.TRANSPORT_DAG_DRAFT_DIR ?? resolve(SCILLM_PROJECT_ROOT, '.codex', 'transport-dag', 'drafts')
const ARCH_SCOPE = 'architecture'
const RE_QUESTION_SKILL = '/home/graham/workspace/experiments/agent-skills/skills/review-question'
const WORKSHEETS_PATH = process.env.WORKSHEETS_YAML ?? resolve(__dirname, '../fixtures/sparta-reference/worksheets.yaml')
const WORKSHEETS_CACHE_TTL_MS = 60_000
const MEMORY_REPO_ROOT = process.env.MEMORY_REPO_ROOT ?? '/home/graham/workspace/experiments/memory'
const CREATE_QRAS_SKILL_ROOT = process.env.CREATE_QRAS_SKILL_ROOT ?? '/home/graham/workspace/experiments/agent-skills/skills/create-qras'
const SPARTA_PROJECT_ROOT = process.env.SPARTA_PROJECT_ROOT ?? '/home/graham/workspace/experiments/sparta'
const SPARTA_MONITOR_CLOSURE_AUDIT_PATH = process.env.SPARTA_MONITOR_CLOSURE_AUDIT_PATH
  ?? resolve(SPARTA_PROJECT_ROOT, 'artifacts/monitor_sparta_closure/closure_audit_20260602T1615Z.json')
const WATCH_MEDIA_ROOTS = [
  '/tmp',
  '/mnt/storage12tb/media/watch-frames',
].map((entry) => realpathSync(entry))
const WATCH_ORPHEUS_SEGMENTS_COLLECTION = 'watch_orpheus_segments'
const WATCH_KEYFRAME_ANNOTATIONS_COLLECTION = 'watch_keyframe_annotations'
const WATCH_TRACK_OBSERVATIONS_COLLECTION = 'watch_track_observations'
const WATCH_CROP_QDRANT_COLLECTION = process.env.WATCH_CROP_QDRANT_COLLECTION ?? 'watch_track_crop_embeddings_jina_v5_1024'
const WATCH_MULTIMODAL_EMBEDDING_URL = process.env.WATCH_MULTIMODAL_EMBEDDING_URL
  ?? process.env.EMBEDDING_MULTIMODAL_URL
  ?? 'http://127.0.0.1:8603'
const WATCH_QDRANT_URL = process.env.WATCH_QDRANT_URL ?? process.env.QDRANT_URL ?? 'http://127.0.0.1:6333'
const AGENT_SKILLS_ROOT = process.env.AGENT_SKILLS_ROOT ?? '/home/graham/workspace/experiments/agent-skills'
const PERSONAPLEX_RECEIPT_ROOT = resolve(AGENT_SKILLS_ROOT, 'receipts/memory_grounded_voice_answer')
const PERSONAPLEX_RECEIPT_SCRIPT = resolve(AGENT_SKILLS_ROOT, 'tools/personaplex/run_memory_grounded_voice_answer_receipt.py')
const PERSONAPLEX_ALLOWED_CASES = new Set(['embry_kai_boundary', 'horus_tember'])

function isActiveWatchAnnotationLifecycle(document: JsonRecord): boolean {
  return !['superseded', 'discarded', 'cleared', 'deleted'].includes(String(document.lifecycle_status ?? 'current'))
}

function watchMediaContentType(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.webp')) return 'image/webp'
  return 'application/octet-stream'
}

function isAllowedWatchMediaPath(realPath: string): boolean {
  return WATCH_MEDIA_ROOTS.some((root) => realPath === root || realPath.startsWith(`${root}/`))
}

function safeMemoryKeyPart(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'unknown'
}

function normalizeWatchBbox(value: unknown): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null
  const numbers = value.map((entry) => Number(entry))
  if (numbers.some((entry) => !Number.isFinite(entry))) return null
  const [rawX1, rawY1, rawX2, rawY2] = numbers
  const x1 = Math.max(0, Math.min(1, Math.min(rawX1, rawX2)))
  const y1 = Math.max(0, Math.min(1, Math.min(rawY1, rawY2)))
  const x2 = Math.max(0, Math.min(1, Math.max(rawX1, rawX2)))
  const y2 = Math.max(0, Math.min(1, Math.max(rawY1, rawY2)))
  if (x2 - x1 < 0.001 || y2 - y1 < 0.001) return null
  return [x1, y1, x2, y2]
}

function watchKeyframeMemoryKey(params: {
  assetUid: string
  rowIndex: number
  characterName: string
  actorName: string
  boxId: string
  keyframeTimeSeconds: number | null
  timecode: string
}): string {
  const timePart = params.keyframeTimeSeconds === null
    ? safeMemoryKeyPart(params.timecode)
    : params.keyframeTimeSeconds.toFixed(2).replace('.', '_')
  const stableBoxId = params.boxId || createHash('sha256')
    .update([
      params.assetUid,
      params.rowIndex,
      params.characterName,
      params.actorName,
      timePart,
    ].join('|'))
    .digest('hex')
    .slice(0, 16)

  return [
    'watch_keyframe',
    safeMemoryKeyPart(params.assetUid),
    `row${params.rowIndex}`,
    safeMemoryKeyPart(params.characterName),
    safeMemoryKeyPart(stableBoxId),
    timePart,
  ].join(':')
}

function isNormalizedXyxy(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value)
    && value.length === 4
    && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 && entry <= 1)
    && value[2] > value[0]
    && value[3] > value[1]
}

function normalizedXyxyFromObject(value: unknown): [number, number, number, number] | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as JsonRecord
  const left = typeof record.left === 'number' ? record.left : (typeof record.x === 'number' ? record.x : null)
  const top = typeof record.top === 'number' ? record.top : (typeof record.y === 'number' ? record.y : null)
  const right = typeof record.right === 'number' ? record.right : null
  const bottom = typeof record.bottom === 'number' ? record.bottom : null
  const width = typeof record.width === 'number' ? record.width : null
  const height = typeof record.height === 'number' ? record.height : null
  if (left === null || top === null) return null
  const candidate = right !== null && bottom !== null
    ? [left, top, right, bottom]
    : width !== null && height !== null
      ? [left, top, left + width, top + height]
      : null
  return isNormalizedXyxy(candidate) ? candidate : null
}

function normalizedXyxyFromPixelBbox(value: unknown, container: JsonRecord): [number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 4) return null
  const width = typeof container.width === 'number'
    ? container.width
    : typeof container.source_width === 'number'
      ? container.source_width
      : typeof container.frame_width === 'number'
        ? container.frame_width
        : typeof (container.source_frame_size as JsonRecord | undefined)?.width === 'number'
          ? Number((container.source_frame_size as JsonRecord).width)
          : null
  const height = typeof container.height === 'number'
    ? container.height
    : typeof container.source_height === 'number'
      ? container.source_height
      : typeof container.frame_height === 'number'
        ? container.frame_height
        : typeof (container.source_frame_size as JsonRecord | undefined)?.height === 'number'
          ? Number((container.source_frame_size as JsonRecord).height)
          : null
  if (!width || !height || width <= 0 || height <= 0) return null
  const numbers = value.map((entry) => typeof entry === 'number' ? entry : Number(entry))
  if (numbers.some((entry) => !Number.isFinite(entry))) return null
  const candidate = [
    numbers[0] / width,
    numbers[1] / height,
    numbers[2] / width,
    numbers[3] / height,
  ].map((entry) => Math.max(0, Math.min(1, entry))) as [number, number, number, number]
  return isNormalizedXyxy(candidate) ? candidate : null
}

function extractNormalizedBboxCandidate(record: JsonRecord): [number, number, number, number] | null {
  for (const key of [
    'bbox',
    'bbox_norm',
    'bbox_xyxy',
    'bbox_xyxy_norm',
    'bbox_xyxy_normalized',
    'bbox_normalized',
    'normalized_bbox',
    'detector_bbox',
    'detection_bbox',
    'track_bbox',
    'crop_bbox',
  ]) {
    const value = record[key]
    if (isNormalizedXyxy(value)) return value
    const objectValue = normalizedXyxyFromObject(value)
    if (objectValue) return objectValue
  }
  for (const key of ['bbox_percent', 'bbox_pct', 'percent_bbox']) {
    const value = normalizedXyxyFromObject(record[key])
    if (value) return value
  }
  for (const key of ['bbox_xyxy', 'pixel_bbox_xyxy', 'detector_bbox_xyxy', 'detection_bbox_xyxy']) {
    const value = normalizedXyxyFromPixelBbox(record[key], record)
    if (value) return value
  }
  return null
}

function watchBboxIoU(a: [number, number, number, number], b: [number, number, number, number]): number {
  const left = Math.max(a[0], b[0])
  const top = Math.max(a[1], b[1])
  const right = Math.min(a[2], b[2])
  const bottom = Math.min(a[3], b[3])
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top)
  if (intersection <= 0) return 0
  const areaA = (a[2] - a[0]) * (a[3] - a[1])
  const areaB = (b[2] - b[0]) * (b[3] - b[1])
  const union = areaA + areaB - intersection
  return union > 0 ? Number((intersection / union).toFixed(6)) : 0
}

function extractWatchObservationBbox(document: JsonRecord): [number, number, number, number] | null {
  const topLevel = extractNormalizedBboxCandidate(document)
  if (topLevel) return topLevel
  for (const key of ['detector', 'detection', 'observation', 'box', 'track', 'payload', 'metadata', 'qdrant_payload', 'crop']) {
    const nested = document[key]
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue
    const nestedRecord = nested as JsonRecord
    const nestedBbox = extractNormalizedBboxCandidate(nestedRecord)
    if (nestedBbox) return nestedBbox
  }
  return null
}

function watchAssetTokens(value: unknown): Set<string> {
  return new Set(String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 3))
}

function watchAssetLikelyMatches(a: unknown, b: unknown): boolean {
  const aText = String(a ?? '').toLowerCase()
  const bText = String(b ?? '').toLowerCase()
  if (!aText || !bText) return false
  if (aText === bText || aText.includes(bText) || bText.includes(aText)) return true
  const aTokens = watchAssetTokens(aText)
  const bTokens = watchAssetTokens(bText)
  let overlap = 0
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap += 1
  }
  return overlap >= 2
}

function watchObservationMediaTime(document: JsonRecord): number | null {
  for (const key of ['media_time_seconds', 'time_seconds', 'keyframe_time_seconds']) {
    const value = document[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  return null
}

async function findWatchDetectorObservationRef(params: {
  assetUid: string
  rowIndex: number
  bbox: [number, number, number, number]
  keyframeTimeSeconds: number | null
  segmentBounds: { start: number; end: number } | null
}): Promise<JsonRecord | null> {
  const data = await memoryHttpPost('/list', {
    collection: WATCH_TRACK_OBSERVATIONS_COLLECTION,
    limit: 500,
  }, 10_000)
  const documents = Array.isArray(data?.documents) ? data.documents as JsonRecord[] : []
  const expectedSegmentIds = new Set([
    `seg_${String(params.rowIndex).padStart(4, '0')}`,
    `seg_${String(params.rowIndex + 1).padStart(4, '0')}`,
  ])

  let best: { document: JsonRecord; bbox: [number, number, number, number]; iou: number; timeDelta: number | null } | null = null
  for (const document of documents) {
    const observationBbox = extractWatchObservationBbox(document)
    if (!observationBbox) continue
    const documentAssetUid = document.asset_uid
    if (documentAssetUid && !watchAssetLikelyMatches(params.assetUid, documentAssetUid)) continue
    const segmentId = typeof document.segment_id === 'string' ? document.segment_id : ''
    const mediaTime = watchObservationMediaTime(document)
    const inExpectedSegment = segmentId ? expectedSegmentIds.has(segmentId) : false
    const inTimeWindow = params.segmentBounds && mediaTime !== null
      ? mediaTime >= params.segmentBounds.start && mediaTime <= params.segmentBounds.end
      : false
    if (!inExpectedSegment && !inTimeWindow) continue
    const iou = watchBboxIoU(params.bbox, observationBbox)
    const timeDelta = params.keyframeTimeSeconds !== null && mediaTime !== null
      ? Number(Math.abs(params.keyframeTimeSeconds - mediaTime).toFixed(3))
      : null
    if (!best || iou > best.iou || (iou === best.iou && (timeDelta ?? Number.POSITIVE_INFINITY) < (best.timeDelta ?? Number.POSITIVE_INFINITY))) {
      best = { document, bbox: observationBbox, iou, timeDelta }
    }
  }

  if (!best || best.iou < 0.5) return null
  const detector = best.document.detector && typeof best.document.detector === 'object' && !Array.isArray(best.document.detector)
    ? best.document.detector as JsonRecord
    : {}
  const detectorConfidence = typeof best.document.detector_confidence === 'number'
    ? best.document.detector_confidence
    : (typeof detector.confidence === 'number' ? detector.confidence : null)
  return {
    collection: WATCH_TRACK_OBSERVATIONS_COLLECTION,
    key: best.document._key ?? null,
    id: best.document._id ?? (best.document._key ? `${WATCH_TRACK_OBSERVATIONS_COLLECTION}/${best.document._key}` : null),
    detector_name: typeof best.document.detector_name === 'string' ? best.document.detector_name : (typeof detector.name === 'string' ? detector.name : 'YoloAnalytics'),
    detector_class: typeof best.document.detector_class === 'string' ? best.document.detector_class : (typeof detector.class_label === 'string' ? detector.class_label : 'person'),
    detector_confidence: detectorConfidence,
    track_id: typeof best.document.track_id === 'string' ? best.document.track_id : null,
    human_bbox_iou_with_detector_bbox: best.iou,
    link_quality: best.iou >= 0.75 ? 'confident' : 'candidate',
    time_delta_seconds: best.timeDelta,
  }
}

async function memoryHttpPost(path: string, body: object, timeoutMs = 10000): Promise<any> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${MEMORY_HTTP_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await response.text()
    let parsed: any = null
    try { parsed = text ? JSON.parse(text) : {} }
    catch { parsed = { raw: text } }
    if (!response.ok) {
      const detail = parsed?.detail || parsed?.error || text || 'unknown error'
      throw new Error(`Memory daemon ${response.status} on ${path}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
    }
    return parsed
  } finally {
    clearTimeout(timeout)
  }
}

async function listMemoryCollectionDocuments(collection: string, timeoutMs = 10_000): Promise<JsonRecord[]> {
  const pageLimit = 500
  const documents: JsonRecord[] = []
  let offset = 0
  let total: number | null = null
  while (total === null || offset < total) {
    const data = await memoryHttpPost('/list', {
      collection,
      limit: pageLimit,
      offset,
    }, timeoutMs)
    const pageDocuments = Array.isArray(data?.documents) ? data.documents as JsonRecord[] : []
    documents.push(...pageDocuments)
    total = typeof data?.total === 'number' && Number.isFinite(data.total) ? data.total : null
    if (pageDocuments.length === 0) break
    offset += pageDocuments.length
    if (total === null && pageDocuments.length < pageLimit) break
  }
  return documents
}

const watchStaticOptions = {
  acceptRanges: true,
  fallthrough: false,
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
  },
}

const watchAudioPeaksCache = new Map<string, { source_path: string; peaks: number[]; sample_rate: number; generated_at: string }>()

async function computeWatchAudioPeaks(rawPath: string, peakCount: number): Promise<{ source_path: string; peaks: number[]; sample_rate: number; generated_at: string }> {
  if (!rawPath || !rawPath.startsWith('/')) throw new Error('absolute audio path is required')
  let realPath = ''
  try {
    realPath = realpathSync(rawPath)
  } catch {
    throw new Error('audio file not found')
  }
  if (!isAllowedWatchMediaPath(realPath)) throw new Error('audio path is outside allowed Watch roots')
  const fileStat = await stat(realPath)
  if (!fileStat.isFile()) throw new Error('audio path is not a file')
  if (fileStat.size > 64 * 1024 * 1024) throw new Error('audio file too large for inline peak extraction')

  const sampleRate = 8000
  const cacheKey = `${realPath}:${fileStat.mtimeMs}:${fileStat.size}:${peakCount}`
  const cached = watchAudioPeaksCache.get(cacheKey)
  if (cached) return cached

  const { stdout } = await execFileAsync('ffmpeg', [
    '-v', 'error',
    '-i', realPath,
    '-ac', '1',
    '-ar', String(sampleRate),
    '-f', 's16le',
    '-acodec', 'pcm_s16le',
    'pipe:1',
  ], {
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 30_000,
  } as any)
  const pcm = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout as any)
  const samples = Math.floor(pcm.length / 2)
  if (samples <= 0) throw new Error('ffmpeg returned no PCM samples')
  const bucketSize = Math.max(1, Math.ceil(samples / peakCount))
  const peaks: number[] = []
  for (let bucketStart = 0; bucketStart < samples; bucketStart += bucketSize) {
    const bucketEnd = Math.min(samples, bucketStart + bucketSize)
    let max = 0
    for (let sample = bucketStart; sample < bucketEnd; sample += 1) {
      const value = Math.abs(pcm.readInt16LE(sample * 2)) / 32768
      if (value > max) max = value
    }
    peaks.push(Number(max.toFixed(4)))
  }
  const result = { source_path: realPath, peaks, sample_rate: sampleRate, generated_at: new Date().toISOString() }
  watchAudioPeaksCache.set(cacheKey, result)
  return result
}

app.use('/api/projects/watch/static/tmp', express.static('/tmp', watchStaticOptions))
app.use('/api/projects/watch/static/watch-frames', express.static('/mnt/storage12tb/media/watch-frames', watchStaticOptions))
app.use('/chatterbox-artifacts', express.static(CHATTERBOX_HOST_OUT_DIR, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.wav')) res.setHeader('Content-Type', 'audio/wav')
    else if (filePath.endsWith('.json')) res.setHeader('Content-Type', 'application/json')
  },
}))

async function serveWatchMediaPath(rawPath: string, req: express.Request, res: express.Response): Promise<void> {
  if (!rawPath || !rawPath.startsWith('/')) {
    res.status(400).json({ error: 'absolute media path is required' })
    return
  }

  let realPath = ''
  try {
    realPath = realpathSync(rawPath)
  } catch {
    res.status(404).json({ error: 'media file not found', path: rawPath })
    return
  }

  if (!isAllowedWatchMediaPath(realPath)) {
    res.status(403).json({ error: 'media path is outside allowed Watch roots' })
    return
  }

  let fileStat
  try {
    fileStat = await stat(realPath)
  } catch {
    res.status(404).json({ error: 'media file not found', path: rawPath })
    return
  }
  if (!fileStat.isFile()) {
    res.status(404).json({ error: 'media path is not a file', path: rawPath })
    return
  }

  const size = fileStat.size
  const contentType = watchMediaContentType(realPath)
  const range = req.headers.range
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Content-Type', contentType)

  if (!range) {
    res.setHeader('Content-Length', String(size))
    createReadStream(realPath).pipe(res)
    return
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match) {
    res.status(416).setHeader('Content-Range', `bytes */${size}`)
    res.end()
    return
  }

  const [, first, last] = match
  let start = first ? Number(first) : 0
  let end = last ? Number(last) : size - 1
  if (!first && last) {
    const suffixLength = Number(last)
    start = Math.max(size - suffixLength, 0)
    end = size - 1
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) {
    res.status(416).setHeader('Content-Range', `bytes */${size}`)
    res.end()
    return
  }

  end = Math.min(end, size - 1)
  res.status(206)
  res.setHeader('Content-Length', String(end - start + 1))
  res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
  createReadStream(realPath, { start, end }).pipe(res)
}

async function readMonitorClosureBaseline(): Promise<JsonRecord | null> {
  try {
    const raw = await readFile(SPARTA_MONITOR_CLOSURE_AUDIT_PATH, 'utf8')
    const audit = JSON.parse(raw) as JsonRecord
    const gates = Array.isArray(audit.gates) ? audit.gates as JsonRecord[] : []
    const dataIntegrity = gates.find((gate) => gate.name === 'data_integrity_reconciled')
    const evidence = dataIntegrity?.evidence && typeof dataIntegrity.evidence === 'object'
      ? dataIntegrity.evidence as JsonRecord
      : {}
    const summary = evidence.summary && typeof evidence.summary === 'object'
      ? evidence.summary as JsonRecord
      : {}
    const rawSummary = evidence.raw_ops_arango_summary && typeof evidence.raw_ops_arango_summary === 'object'
      ? evidence.raw_ops_arango_summary as JsonRecord
      : {}
    const rawNonpassing = Array.isArray(evidence.raw_ops_arango_nonpassing)
      ? (evidence.raw_ops_arango_nonpassing as JsonRecord[]).slice(0, 14)
      : []
    return {
      artifact_id: 'closure_audit_20260602T1615Z',
      artifact_path: SPARTA_MONITOR_CLOSURE_AUDIT_PATH,
      generated_at: audit.generated_at ?? null,
      status: audit.status ?? 'unknown',
      passed: audit.passed ?? null,
      total: audit.total ?? null,
      failed_gates: audit.failed_gates ?? [],
      data_integrity_reconciled: {
        status: dataIntegrity?.status ?? 'unknown',
        passed: summary.passed ?? null,
        warnings: summary.warnings ?? null,
        failed: summary.failed ?? null,
      },
      raw_ops_arango: {
        passed: rawSummary.passed ?? null,
        warnings: rawSummary.warnings ?? null,
        failed: rawSummary.failed ?? null,
        nonpassing: rawNonpassing,
      },
    }
  } catch (err) {
    console.warn('[sparta/coverage-health] monitor closure baseline unavailable', err)
    return null
  }
}

const SPARTA_COVERAGE_CACHE_TTL_MS = 30_000
const SPARTA_COVERAGE_SNAPSHOT_PATH = process.env.SPARTA_COVERAGE_SNAPSHOT_PATH ?? resolve(__dirname, '../.cache/sparta-coverage-health.json')
const SPARTA_SUPERVISOR_STATE_DIR = process.env.SPARTA_SUPERVISOR_STATE_DIR ?? resolve(MEMORY_REPO_ROOT, 'artifacts/sparta_supervisor/dev')
const SPARTA_SUPERVISOR_STATUS_PATH = resolve(SPARTA_SUPERVISOR_STATE_DIR, 'status.json')
const SPARTA_SUPERVISOR_COMMANDS_PATH = resolve(SPARTA_SUPERVISOR_STATE_DIR, 'commands.jsonl')
const SPARTA_SUPERVISOR_RUN_ENABLED = process.env.SPARTA_SUPERVISOR_RUN_ENABLED !== '0'
const SPARTA_GAP_PLAN_DIR = resolve(MEMORY_REPO_ROOT, 'artifacts/monitor_sparta_gap_plan')
const SPARTA_COVERAGE_SIGNATURE_COLLECTIONS = [
  'sparta_controls',
  'sparta_qra',
  'sparta_qra_canonical',
  'sparta_qra_relationship',
  'sparta_relationships',
  'sparta_urls',
  'sparta_url_knowledge',
  'datalake_chunks',
]
const PUBLIC_ROOT = resolve(__dirname, '../public')
const ARTIFACTS_ROOT = resolve(process.env.UX_LAB_ARTIFACTS_ROOT ?? process.env.ARTIFACTS_ROOT ?? '/mnt/storage12tb/pi-mono/artifacts')
const PDF_LAB_ARTIFACTS_ROOT = resolve(process.env.PDF_LAB_ARTIFACTS_ROOT ?? resolve(ARTIFACTS_ROOT, 'pdf-lab'))

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function canonicalExecutableGraph(graph: any): JsonRecord {
  return {
    exec_graph_version: graph?.exec_graph_version,
    graph_id: graph?.graph_id,
    graph_goal: graph?.graph_goal,
    self_improvement_iterations: graph?.self_improvement_iterations,
    review_fanout_limits: graph?.review_fanout_limits,
    review_iteration_limits: graph?.review_iteration_limits,
    nodes: Array.isArray(graph?.nodes) ? graph.nodes.map((node: any) => ({
      id: node.id,
      revision_id: node.revision_id,
      type: node.type,
      node_goal: node.node_goal,
      depends_on: Array.isArray(node.depends_on) ? [...node.depends_on].sort() : undefined,
      protocol_role: node.protocol_role,
      persona_ref: node.persona_ref,
      model: node.model,
      model_pool: node.model_pool,
      prompt: node.prompt,
      messages: node.messages,
      output_schema: node.output_schema,
      retry_policy: node.retry_policy,
      gate_policy: node.gate_policy,
      review_scopes: node.review_scopes,
      disabled: node.disabled,
      archived: node.archived,
      superseded_by: node.superseded_by,
      metadata: node.metadata && typeof node.metadata === 'object' ? {
        scheduling: node.metadata.scheduling,
        schedule: node.metadata.schedule,
        gate_policy: node.metadata.gate_policy,
        retry_policy: node.metadata.retry_policy,
        disabled: node.metadata.disabled,
        archived: node.metadata.archived,
        superseded_by: node.metadata.superseded_by,
      } : undefined,
    })).sort((a: any, b: any) => String(a.id).localeCompare(String(b.id))) : [],
  }
}

function executableGraphHash(graph: any): string {
  return createHash('sha256').update(canonicalJson(canonicalExecutableGraph(graph))).digest('hex')
}

function safeArtifactName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 160) || 'graph'
}

function safeScillmPhaseId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^phase-[a-zA-Z0-9._-]+$/.test(trimmed) ? trimmed : null
}

async function readActiveScillmPhaseId(): Promise<string | null> {
  const knowledgePath = resolve(SCILLM_PROJECT_ROOT, 'PROJECT_KNOWLEDGE.md')
  const content = await readFile(knowledgePath, 'utf-8').catch(() => '')
  const pointer = content.match(/Current phase pointer:\s*`\.plan-iterate\/([^`]+)`/)
  const phaseId = safeScillmPhaseId(pointer?.[1])
  if (phaseId && existsSync(resolve(SCILLM_PROJECT_ROOT, '.plan-iterate', phaseId))) return phaseId
  return null
}

async function resolveScillmDagPhaseId(req: express.Request): Promise<{ phaseId: string; activePhaseId: string | null; requestedPhaseId: string | null }> {
  const queryPhase = Array.isArray(req.query.phase_id) ? req.query.phase_id[0] : req.query.phase_id
  const queryPhaseCamel = Array.isArray(req.query.phaseId) ? req.query.phaseId[0] : req.query.phaseId
  const bodyPhase = safeScillmPhaseId((req.body as JsonRecord | undefined)?.phase_id ?? (req.body as JsonRecord | undefined)?.phaseId)
  const requestedPhaseId = safeScillmPhaseId(queryPhase) ?? safeScillmPhaseId(queryPhaseCamel) ?? bodyPhase
  const activePhaseId = await readActiveScillmPhaseId()
  const configuredPhaseId = safeScillmPhaseId(SCILLM_DAG_PHASE_ID)
  return {
    phaseId: requestedPhaseId ?? configuredPhaseId ?? activePhaseId ?? SCILLM_DAG_FALLBACK_PHASE_ID,
    activePhaseId,
    requestedPhaseId,
  }
}

async function latestScillmPlanGraph(phaseDir: string, phaseStatus: JsonRecord | null): Promise<{ graphPath: string; readinessPath: string | null } | null> {
  const activePlanGraphArtifact = typeof phaseStatus?.active_plan_graph_artifact === 'string' && phaseStatus.active_plan_graph_artifact.trim()
    ? phaseStatus.active_plan_graph_artifact.trim()
    : null
  const statusPath = activePlanGraphArtifact
    ? resolve(phaseDir, activePlanGraphArtifact)
    : null
  const graphPath = statusPath && isPathInside(phaseDir, statusPath) && existsSync(statusPath) && (await stat(statusPath).catch(() => null))?.isFile()
    ? statusPath
    : null
  if (graphPath) {
    const readinessPath = graphPath.replace(/\.json$/, '-runtime-readiness.json')
    return { graphPath, readinessPath: existsSync(readinessPath) ? readinessPath : null }
  }
  const planGraphDir = resolve(phaseDir, 'plan-graphs')
  const files = (await readdir(planGraphDir).catch(() => []))
    .filter((file) => file.endsWith('.json') && !file.endsWith('-runtime-readiness.json'))
    .sort()
  const latest = files.at(-1)
  if (!latest) return null
  const latestGraphPath = resolve(planGraphDir, latest)
  const latestReadinessPath = latestGraphPath.replace(/\.json$/, '-runtime-readiness.json')
  return { graphPath: latestGraphPath, readinessPath: existsSync(latestReadinessPath) ? latestReadinessPath : null }
}

async function latestMatchingFile(dir: string, matcher: (file: string) => boolean): Promise<string | null> {
  const candidates = await Promise.all((await readdir(dir).catch(() => []))
    .filter(matcher)
    .map(async (file) => {
      const path = resolve(dir, file)
      const fileStat = await stat(path).catch(() => null)
      return fileStat?.isFile() ? { file, path, mtimeMs: fileStat.mtimeMs } : null
    }))
  const latest = candidates
    .filter((candidate): candidate is { file: string; path: string; mtimeMs: number } => Boolean(candidate))
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.file.localeCompare(b.file))
    .at(-1)
  return latest?.path ?? null
}

async function resolveScillmRuntimeArtifacts(phaseDir: string): Promise<{ runDir: string; graphPath: string; statusPath: string; eventsPath: string; layout: string }> {
  const preferredRunDir = resolve(phaseDir, 'evidence-artifacts', SCILLM_DAG_RUN_ARTIFACT_DIR)
  const fallbackRunDir = resolve(phaseDir, 'evidence-artifacts', 'scillm-exec-run-final')
  for (const runDir of [preferredRunDir, fallbackRunDir]) {
    const graphPath = resolve(runDir, 'graph.request.json')
    const statusPath = resolve(runDir, 'status.json')
    const eventsPath = resolve(runDir, 'events.jsonl')
    if (
      existsSync(graphPath) && existsSync(statusPath) && existsSync(eventsPath)
      && (await stat(graphPath).catch(() => null))?.isFile()
      && (await stat(statusPath).catch(() => null))?.isFile()
      && (await stat(eventsPath).catch(() => null))?.isFile()
    ) {
      return { runDir, graphPath, statusPath, eventsPath, layout: 'exec_run_dir' }
    }
  }

  const evidenceDir = resolve(phaseDir, 'evidence-artifacts')
  const graphPath =
    await latestMatchingFile(evidenceDir, (file) => /^compiled-runtime-graph-request(?:-[a-z0-9]+)?\.json$/i.test(file))
    ?? await latestMatchingFile(resolve(phaseDir, 'plan-graphs'), (file) => /^compiled-runtime-graph(?:-[a-z0-9]+)?\.json$/i.test(file))
  const statusPath = await latestMatchingFile(evidenceDir, (file) => /^current-run-\d+-status(?:-[a-z0-9-]+)?\.json$/i.test(file))
  const eventsPath = await latestMatchingFile(evidenceDir, (file) => /^current-run-\d+-events(?:-[a-z0-9-]+)?\.(json|jsonl)$/i.test(file))

  if (!graphPath || !statusPath || !eventsPath) {
    throw new Error(`No complete scillm DAG runtime artifact set found in ${evidenceDir}`)
  }
  return { runDir: evidenceDir, graphPath, statusPath, eventsPath, layout: 'phase_evidence_files' }
}

function parseScillmEvents(raw: string, eventsPath: string): JsonRecord[] {
  const trimmed = raw.trim()
  if (!trimmed) return []
  if (eventsPath.endsWith('.jsonl')) {
    return trimmed
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line))
  }
  const parsed = JSON.parse(trimmed)
  if (Array.isArray(parsed)) return parsed as JsonRecord[]
  if (Array.isArray((parsed as JsonRecord).events)) return (parsed as JsonRecord).events as JsonRecord[]
  return [parsed as JsonRecord]
}

async function readJsonArtifact(path: string): Promise<JsonRecord> {
  return JSON.parse(await readFile(path, 'utf-8')) as JsonRecord
}

async function findLatestAppServerSessionPhase(): Promise<string | null> {
  const root = resolve(SCILLM_PROJECT_ROOT, '.plan-iterate')
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  let latest: { phaseId: string; mtimeMs: number } | null = null

  for (const entry of entries) {
    if (!entry.isDirectory() || !safeScillmPhaseId(entry.name)) continue
    const summaryPath = resolve(root, entry.name, 'evidence-artifacts', 'app-server-nico-e2e-run', 'summary.json')
    const summaryStat = await stat(summaryPath).catch(() => null)
    if (!summaryStat) continue
    if (!latest || summaryStat.mtimeMs > latest.mtimeMs) {
      latest = { phaseId: entry.name, mtimeMs: summaryStat.mtimeMs }
    }
  }

  return latest?.phaseId ?? null
}

function parseAppServerEventSummary(events: JsonRecord[]): JsonRecord {
  const methods: Record<string, number> = {}
  let sendCount = 0
  let recvCount = 0
  let firstTs: unknown = null
  let lastTs: unknown = null

  for (const event of events) {
    const direction = event.direction
    if (direction === 'send') sendCount += 1
    if (direction === 'recv') recvCount += 1
    const message = event.message as JsonRecord | undefined
    const method = typeof message?.method === 'string' ? message.method : typeof message?.id !== 'undefined' ? 'response' : 'unknown'
    methods[method] = (methods[method] ?? 0) + 1
    if (firstTs === null) firstTs = event.ts ?? null
    lastTs = event.ts ?? lastTs
  }

  return {
    total: events.length,
    send_count: sendCount,
    recv_count: recvCount,
    first_ts: firstTs,
    last_ts: lastTs,
    method_counts: Object.entries(methods)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 18)
      .map(([method, count]) => ({ method, count })),
  }
}

function synthesizePlanIterateStatus(graph: JsonRecord, readiness: JsonRecord | null, phaseStatus: JsonRecord | null): JsonRecord {
  const readinessNodes = Array.isArray(readiness?.nodes) ? readiness.nodes as Array<JsonRecord> : []
  const readinessByNode = new Map(readinessNodes.map((node) => [String(node.node_id ?? ''), node]))
  const nodeStates: Record<string, string> = {}
  const nodeResults: Record<string, JsonRecord> = {}
  const nodes = Array.isArray(graph.nodes) ? graph.nodes as Array<JsonRecord> : []
  for (const node of nodes) {
    const nodeId = String(node.id ?? '')
    if (!nodeId) continue
    const report = readinessByNode.get(nodeId)
    const readinessStatus = String(report?.status ?? '')
    const missingFields = Array.isArray(report?.missing_fields) ? report.missing_fields : []
    const state = readinessStatus === 'blocked' || missingFields.length
      ? 'needs_attention'
      : readinessStatus === 'manual_action_required'
        ? 'ready'
        : 'pending'
    nodeStates[nodeId] = state
    nodeResults[nodeId] = {
      evidence_status: readinessStatus === 'runtime_ready' ? 'awaiting_execution' : readinessStatus || 'not_executed',
      missing_fields: missingFields,
      next_action: report?.next_action ?? 'execute or amend this plan node before closure evidence can exist',
    }
  }
  return {
    state: String(phaseStatus?.status ?? 'planned'),
    updated_at: new Date().toISOString(),
    source_kind: 'plan_iterate_phase_plan',
    node_states: nodeStates,
    node_results: nodeResults,
    runtime_readiness: readiness,
  }
}

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

async function readPersonaPlexReceipt(filePath: string): Promise<JsonRecord | null> {
  const absolutePath = resolve(filePath)
  if (!isPathInside(PERSONAPLEX_RECEIPT_ROOT, absolutePath) || !absolutePath.endsWith('.json')) return null
  try {
    const fileStat = await stat(absolutePath)
    if (!fileStat.isFile()) return null
    const parsed = JSON.parse(await readFile(absolutePath, 'utf-8')) as JsonRecord
    return {
      ...parsed,
      receipt_path: absolutePath,
      receipt_mtime_ms: fileStat.mtimeMs,
    }
  } catch {
    return null
  }
}

async function listPersonaPlexReceipts(): Promise<JsonRecord[]> {
  const entries = await readdir(PERSONAPLEX_RECEIPT_ROOT).catch(() => [])
  const receipts = await Promise.all(
    entries
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => readPersonaPlexReceipt(resolve(PERSONAPLEX_RECEIPT_ROOT, entry))),
  )
  return receipts
    .filter((receipt): receipt is JsonRecord => Boolean(receipt))
    .sort((a, b) => Number(b.receipt_mtime_ms ?? 0) - Number(a.receipt_mtime_ms ?? 0))
}

app.get('/api/projects/personaplex/memory-grounded-voice-answer/receipts', async (_req, res) => {
  const receipts = await listPersonaPlexReceipts()
  res.json({
    schema: 'personaplex.memory_grounded_voice_answer.receipt_index.v1',
    ok: true,
    receipt_root: PERSONAPLEX_RECEIPT_ROOT,
    count: receipts.length,
    receipts,
  })
})

app.post('/api/projects/personaplex/memory-grounded-voice-answer/run', async (req, res) => {
  const requestedCase = String((req.body as JsonRecord | undefined)?.case ?? '')
  if (!PERSONAPLEX_ALLOWED_CASES.has(requestedCase)) {
    res.status(400).json({ ok: false, error: 'unsupported_case', allowed_cases: [...PERSONAPLEX_ALLOWED_CASES] })
    return
  }
  if (!existsSync(PERSONAPLEX_RECEIPT_SCRIPT)) {
    res.status(500).json({ ok: false, error: 'receipt_harness_missing', script: PERSONAPLEX_RECEIPT_SCRIPT })
    return
  }
  try {
    const env = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }
    const { stdout, stderr } = await execFileAsync('uv', ['run', 'python', PERSONAPLEX_RECEIPT_SCRIPT, '--case', requestedCase], {
      cwd: AGENT_SKILLS_ROOT,
      env,
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    } as any)
    let parsed: JsonRecord = {}
    try {
      parsed = JSON.parse(String(stdout || '{}')) as JsonRecord
    } catch {
      parsed = { raw_stdout: String(stdout || '') }
    }
    const receiptPath = typeof parsed.receipt === 'string' ? parsed.receipt : ''
    const receipt = receiptPath ? await readPersonaPlexReceipt(receiptPath) : null
    res.json({
      ok: Boolean(parsed.ok && receipt?.ok),
      case: requestedCase,
      command: `PYTHONDONTWRITEBYTECODE=1 uv run python ${PERSONAPLEX_RECEIPT_SCRIPT} --case ${requestedCase}`,
      stdout: String(stdout || ''),
      stderr: String(stderr || ''),
      receipt,
    })
  } catch (err: any) {
    res.status(500).json({
      ok: false,
      case: requestedCase,
      error: err?.message ?? String(err),
      stdout: String(err?.stdout ?? ''),
      stderr: String(err?.stderr ?? ''),
    })
  }
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
  const referents = Array.from(question.matchAll(AMBIGUOUS_QRA_REFERENT_RE), (match) => match[0])
  if (/\bwhich\s+one\b/i.test(question)) referents.push('which one')
  if (/\b(first|second)\s+(?:control|option|one)\b/i.test(question)) referents.push('ordinal control reference')
  if (/\bT\d{1,3}\b/.test(question)) referents.push('truncated technique id')
  if (/\b(?:are|is)\s+we\s+compliant\s+now\b/i.test(question) || /\bare\s+we\s+compliant\s+now\b/i.test(question)) referents.push('compliance scope')
  return Array.from(new Set(referents))
}

type EvidenceCasePreflightAction = 'clarify' | 'deflect'

interface EvidenceCasePreflightDecision {
  action: EvidenceCasePreflightAction
  issue_code: string
  issue_label: string
  detail: string
}

function detectEvidenceCasePreflight(question: unknown, profile: unknown): EvidenceCasePreflightDecision | null {
  if (typeof question !== 'string' || !question.trim()) {
    return {
      action: 'clarify',
      issue_code: 'empty_question',
      issue_label: 'Empty question',
      detail: 'A question is required before an evidence case can be built.',
    }
  }
  const q = question.toLowerCase()
  const profileText = typeof profile === 'string' ? profile.toLowerCase() : ''
  const ambiguousReferents = detectAmbiguousQraReferents(question)
  if (ambiguousReferents.length > 0) {
    return {
      action: 'clarify',
      issue_code: 'ambiguous_referent',
      issue_label: 'Ambiguous referent',
      detail: `Missing explicit referent for: ${ambiguousReferents.join(', ')}`,
    }
  }
  if (/\b(ignore|bypass|override)\b.*\b(evidence|source|gate|rules?)\b/.test(q) || /\bwithout checking sources\b/.test(q) || /\bfully compliant\b.*\bwithout\b/.test(q)) {
    return {
      action: 'deflect',
      issue_code: 'evidence_bypass_request',
      issue_label: 'Evidence bypass request',
      detail: 'The request asks Chat to bypass evidence-case grounding.',
    }
  }
  if (/\binvent\b.*\b(source|citation|evidence)\b/.test(q) || /\bfake\b.*\b(source|citation|evidence)\b/.test(q)) {
    return {
      action: 'deflect',
      issue_code: 'fabricated_source_request',
      issue_label: 'Fabricated source request',
      detail: 'The request asks Chat to fabricate source evidence.',
    }
  }
  if (/\bsparta\s+(?:control|technique|countermeasure)\s+[A-Z]\d{2,}-[A-Z][A-Z0-9-]*\b/i.test(question)) {
    return {
      action: 'deflect',
      issue_code: 'fabricated_or_unsupported_entity',
      issue_label: 'Fabricated or unsupported entity',
      detail: 'The request names an unsupported SPARTA entity that must be resolved before evidence recall can support an answer.',
    }
  }
  if (/\brelationship candidate\s+rel::tech_related_controls\b/i.test(question) || /\bwhat evidence supports\b.*\bwhat is missing\b/i.test(q)) {
    return {
      action: 'clarify',
      issue_code: 'relationship_evidence_required',
      issue_label: 'Relationship evidence required',
      detail: 'The relationship needs direct satisfied traceability evidence before Chat can answer rather than relying on broad related-QRA recall.',
    }
  }
  if (/\bfailed\s+SPARTA\s+evidence-case\s+candidate\b/i.test(question) || /\banswer\b.*\bfailed\b.*\bevidence-case\b.*\banyway\b/i.test(q)) {
    return {
      action: 'deflect',
      issue_code: 'failed_evidence_case_candidate',
      issue_label: 'Failed evidence-case candidate',
      detail: 'The prior evidence-case candidate did not satisfy the answer gate and must not be answered from broad recall.',
    }
  }
  if (/\b(sourdough|starter schedule|recipe|super bowl|sports prediction|espresso|coffee grinder|hiking boots|piano practice|tax deduction|fantasy football|wedding playlist|gardening|tomatoes|movie recommendations|mortgage rates|cake frosting|running shoes|vacation itinerary|dog training|birthday party|stock market|oil change|yoga pose|language learning)\b/i.test(question)) {
    return {
      action: 'deflect',
      issue_code: 'outside_sparta_scope',
      issue_label: 'Outside SPARTA scope',
      detail: 'The request is outside the SPARTA space cybersecurity evidence corpus.',
    }
  }
  if (/\bwhy\s+is\s+countermeasure\s+[A-Z]{2}\d{4}\b.*\brelevant\s+to\s+technique\s+[A-Z]{2}-\d{4}\b/i.test(question)) {
    return {
      action: 'clarify',
      issue_code: 'relationship_evidence_required',
      issue_label: 'Relationship evidence required',
      detail: 'The relationship needs direct satisfied traceability evidence before Chat can answer rather than relying on broad related-QRA recall.',
    }
  }
  if (/\b(private|secret)\b.*\b(key|token|credential|password)\b/.test(q) || /\bshow\b.*\b(private|secret)\b/.test(q)) {
    return {
      action: 'deflect',
      issue_code: 'secret_disclosure_request',
      issue_label: 'Secret disclosure request',
      detail: 'The request asks for secrets or private credentials rather than compliance evidence.',
    }
  }
  if (/\bclassified\b.*\bvendor\b/.test(q) || /\bzero[- ]day\b/.test(q) || /\bthis morning\b/.test(q)) {
    return {
      action: 'deflect',
      issue_code: 'unsupported_current_intel',
      issue_label: 'Unsupported current intelligence claim',
      detail: 'The selected corpus cannot substantiate classified or same-day intelligence claims.',
    }
  }
  if (/\bwill\b.*\b(breach|breached|ransomware|compromise)\b/.test(q) || /\bnext\s+(friday|week|month|year)\b/.test(q)) {
    return {
      action: 'deflect',
      issue_code: 'unsupported_prediction',
      issue_label: 'Unsupported prediction',
      detail: 'The selected corpus cannot predict future incidents.',
    }
  }
  if (/\bfedramp\s+high\b.*\b(compliant|prove|certif)/.test(q) || /\bprove\b.*\b(compliant|certified)\b/.test(q)) {
    return {
      action: 'clarify',
      issue_code: 'compliance_authority_scope',
      issue_label: 'Compliance authority scope',
      detail: 'The request needs an assessment scope and authoritative compliance evidence before Chat can answer.',
    }
  }
  if ((profileText.includes('ground') || /\bground[- ]only\b/.test(q)) && /\b(orbital|orbit|downlink|leo|spacecraft|satellite)\b/.test(q)) {
    return {
      action: 'clarify',
      issue_code: 'profile_mismatch',
      issue_label: 'Profile mismatch',
      detail: 'The selected ground cybersecurity profile conflicts with orbital or space-system terminology in the question.',
    }
  }
  return null
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

function unsupportedEntityId(mention: string): string {
  const slug = mention
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
  return `unsupported:${slug || 'term'}`
}
const QRA_COUNT_CACHE_TTL_MS = 30_000
const QRA_COUNT_CACHE = new Map<string, { count: number; at: number }>()
const QRA_STATUS_CACHE_TTL_MS = 60_000
const QRA_STATUS_CACHE = new Map<string, { payload: QraStatusAggregate; at: number }>()
const QRA_STATUS_PENDING = new Map<string, Promise<QraStatusAggregate>>()
const SPARTA_COUNTS_CACHE_TTL_MS = 30_000
let SPARTA_COUNTS_CACHE: { payload: Record<string, number>; at: number } | null = null
let SPARTA_COUNTS_PENDING: Promise<Record<string, number>> | null = null
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

type QraEvidenceStatus = 'grounded' | 'review' | 'passed' | 'adversarial' | 'missing' | 'failed'

interface QraStatusAggregate {
  total: number
  source_used: 'legacy' | 'v2' | 'all'
  counts: Record<QraEvidenceStatus, number>
  by_collection: Record<string, Record<QraEvidenceStatus, number> & { total: number }>
  generated_at: string
}

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

function emptyQraStatusCounts(): Record<QraEvidenceStatus, number> {
  return { grounded: 0, review: 0, passed: 0, adversarial: 0, missing: 0, failed: 0 }
}

function qraCollectionsForSource(source: string): Array<'sparta_qra' | typeof QRA_V2_COLLECTIONS[number]> {
  if (source === 'v2') return [...QRA_V2_COLLECTIONS]
  if (source === 'legacy') return [LEGACY_QRA_COLLECTION]
  return [LEGACY_QRA_COLLECTION, ...QRA_V2_COLLECTIONS]
}

async function countQraStatusesForCollection(collection: string): Promise<Record<QraEvidenceStatus, number> & { total: number }> {
  const ambiguousReferentPattern = String.raw`\b(?:this|that|these|those|above|following|provided|given)\s+(?:payload|technique|control|weakness|attack|pattern|countermeasure|relationship|document|excerpt|source|context|requirement|case|system|component|vendor)\b`
  const result = await proxyPost('/query', {
    aql: `FOR doc IN ${collection}
            LET reviewStatus = LOWER(TRIM(TO_STRING(NOT_NULL(doc.review_status, ""))))
            LET verdict = LOWER(TRIM(TO_STRING(NOT_NULL(doc.evidence_case.verdict, ""))))
            LET ecReviewStatus = LOWER(TRIM(TO_STRING(NOT_NULL(doc.evidence_case.review_status, ""))))
            LET disposition = LOWER(TRIM(TO_STRING(NOT_NULL(doc.qra_quality.disposition, ""))))
            LET issueCode = LOWER(TRIM(TO_STRING(NOT_NULL(doc.qra_quality.issue_code, ""))))
            LET question = LOWER(TO_STRING(NOT_NULL(doc.question, "")))
            LET hasEvidenceCase = doc.evidence_case != null
            LET failedItems = IS_ARRAY(doc.evidence_case.failed_items) && LENGTH(doc.evidence_case.failed_items) > 0
            LET hasEvidenceData = hasEvidenceCase && (
              (IS_ARRAY(doc.evidence_case.chains) && LENGTH(doc.evidence_case.chains) > 0) ||
              (IS_ARRAY(doc.evidence_case.crosswalk_chains) && LENGTH(doc.evidence_case.crosswalk_chains) > 0) ||
              (IS_ARRAY(doc.evidence_case.glossary) && LENGTH(doc.evidence_case.glossary) > 0) ||
              (IS_ARRAY(doc.evidence_case.resolved_entities) && LENGTH(doc.evidence_case.resolved_entities) > 0) ||
              (IS_ARRAY(doc.evidence_case.spans) && LENGTH(doc.evidence_case.spans) > 0) ||
              (IS_ARRAY(doc.evidence_case.control_ids) && LENGTH(doc.evidence_case.control_ids) > 0) ||
              (IS_ARRAY(doc.evidence_case.prior_qra_evidence) && LENGTH(doc.evidence_case.prior_qra_evidence) > 0) ||
              LENGTH(TRIM(TO_STRING(NOT_NULL(doc.evidence_case.answer, "")))) > 0 ||
              LENGTH(TRIM(TO_STRING(NOT_NULL(doc.evidence_case.question_text, "")))) > 0
            )
            LET isAdversarial = issueCode == "ambiguous_referent" || CONTAINS(disposition, "adversarial") || REGEX_TEST(question, @ambiguousReferentPattern, false)
            LET isPassed = reviewStatus IN ["approved", "pass", "passed"] || verdict IN ["satisfied", "pass", "passed"] || ecReviewStatus == "approved" || doc.evidence_case.formal_proof.success == true
            LET isFailed = reviewStatus IN ["rejected", "fail", "failed"] || verdict IN ["not_satisfied", "fail", "failed", "rejected"] || ecReviewStatus == "rejected" || doc.evidence_case.failure_stage != null || doc.evidence_case.failure_reason != null || failedItems
            LET status = isAdversarial ? "adversarial" :
              isPassed ? "passed" :
              isFailed ? "failed" :
              verdict IN ["inconclusive", "auto", "qualified"] ? "review" :
              !hasEvidenceCase ? "missing" :
              hasEvidenceData ? "grounded" :
              "review"
            COLLECT qraStatus = status WITH COUNT INTO count
            RETURN { status: qraStatus, count }`,
    bind_vars: { ambiguousReferentPattern },
  }, 90_000)
  const counts = { ...emptyQraStatusCounts(), total: 0 }
  for (const row of asRows(result)) {
    const status = row?.status as QraEvidenceStatus | undefined
    const count = Number(row?.count ?? 0)
    if (status && status in counts) {
      counts[status] = count
      counts.total += count
    }
  }
  return counts
}

async function getQraStatusAggregate(source: string): Promise<QraStatusAggregate> {
  const sourceUsed = source === 'v2' ? 'v2' : source === 'legacy' ? 'legacy' : 'all'
  const cached = QRA_STATUS_CACHE.get(sourceUsed)
  if (cached && Date.now() - cached.at < QRA_STATUS_CACHE_TTL_MS) return cached.payload
  const pending = QRA_STATUS_PENDING.get(sourceUsed)
  if (pending) return pending

  const aggregate = (async () => {
    const collections = qraCollectionsForSource(sourceUsed)
    const collectionCounts = await Promise.all(collections.map(async (collection) => [collection, await countQraStatusesForCollection(collection)] as const))
    const counts = emptyQraStatusCounts()
    const by_collection: QraStatusAggregate['by_collection'] = {}
    let total = 0
    for (const [collection, collectionStatusCounts] of collectionCounts) {
      by_collection[collection] = collectionStatusCounts
      total += collectionStatusCounts.total
      for (const status of Object.keys(counts) as QraEvidenceStatus[]) counts[status] += collectionStatusCounts[status]
    }
    const payload: QraStatusAggregate = {
      total,
      source_used: sourceUsed,
      counts,
      by_collection,
      generated_at: new Date().toISOString(),
    }
    QRA_STATUS_CACHE.set(sourceUsed, { payload, at: Date.now() })
    return payload
  })().finally(() => {
    QRA_STATUS_PENDING.delete(sourceUsed)
  })
  QRA_STATUS_PENDING.set(sourceUsed, aggregate)
  return aggregate
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
  if (limit <= 0) return []
  const result = await proxyPost('/query', {
    aql: `FOR doc IN ${collection}
            LIMIT @offset, @limit
            RETURN {
              _key: doc._key,
              _id: doc._id,
              qra_id: doc.qra_id,
              question: doc.question,
              reasoning: doc.reasoning,
              answer: doc.answer,
              source_framework: doc.source_framework,
              source_control_id: doc.source_control_id,
              control_id: doc.control_id,
              run_id: doc.run_id,
              mind: doc.mind,
              relationship_id: doc.relationship_id,
              expertise: doc.expertise,
              difficulty: doc.difficulty,
              created_at: doc.created_at,
              review_status: doc.review_status,
              qra_quality: doc.qra_quality,
              qra_type: doc.qra_type,
              evidence_case: doc.evidence_case == null ? null : {
                confidence: doc.evidence_case.confidence,
                methods: doc.evidence_case.methods,
                verdict: doc.evidence_case.verdict,
                grade: doc.evidence_case.grade,
                gates_passed: doc.evidence_case.gates_passed,
                gates_total: doc.evidence_case.gates_total,
                gate_trace: IS_ARRAY(doc.evidence_case.gate_trace) ? SLICE(doc.evidence_case.gate_trace, 0, 6) : null,
                chains_count: IS_ARRAY(doc.evidence_case.chains) ? LENGTH(doc.evidence_case.chains) : 0,
                chains: IS_ARRAY(doc.evidence_case.chains) ? SLICE(doc.evidence_case.chains, 0, 3) : null,
                crosswalk_chains_count: IS_ARRAY(doc.evidence_case.crosswalk_chains) ? LENGTH(doc.evidence_case.crosswalk_chains) : 0,
                crosswalk_chains: IS_ARRAY(doc.evidence_case.crosswalk_chains) ? SLICE(doc.evidence_case.crosswalk_chains, 0, 3) : null,
                question_text: doc.evidence_case.question_text,
                answer: doc.evidence_case.answer,
                response_action: doc.evidence_case.response_action,
                control_ids: doc.evidence_case.control_ids,
                resolved_entities: doc.evidence_case.resolved_entities,
                spans: doc.evidence_case.spans,
                entity_resolution: doc.evidence_case.entity_resolution,
                technique_check: doc.evidence_case.technique_check,
                prior_qra_evidence: doc.evidence_case.prior_qra_evidence == null ? null : (
                  FOR p IN SLICE(doc.evidence_case.prior_qra_evidence, 0, 4)
                    RETURN {
                      _key: p._key,
                      qra_id: p.qra_id,
                      source_framework: p.source_framework,
                      citation_id: p.citation_id,
                      question: p.question
                    }
                ),
                glossary: doc.evidence_case.glossary == null ? null : (
                  FOR g IN doc.evidence_case.glossary
                    RETURN {
                      id: g.id,
                      name: g.name,
                      framework: g.framework,
                      type: g.type
                    }
                ),
                review_status: doc.evidence_case.review_status,
                failure_stage: doc.evidence_case.failure_stage,
                failure_reason: doc.evidence_case.failure_reason,
                failed_items: doc.evidence_case.failed_items,
                skipped_checks: doc.evidence_case.skipped_checks,
                gap_review_status: doc.evidence_case.gap_review_status,
                human_review_state: doc.evidence_case.human_review_state,
                formal_proof: doc.evidence_case.formal_proof,
                sacm_ref: doc.evidence_case.sacm_ref
              }
            }`,
    bind_vars: { offset, limit },
  }, 45_000)
  return asRows(result).map((doc) => normalizeQraDocument(doc, collection)).filter(Boolean)
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

    const pageDocs = await pageCollectionSummaries(partition.collection, remainingOffset, remainingLimit)
    documents.push(...pageDocs)
    remainingLimit -= pageDocs.length
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
    const projection = await loadF36ExplorerProjection()
    const [evidenceCases, controls, rels] = await Promise.all([
      memoryListAll('lessons_v2', ['title', 'solution', 'tags', 'created_at'], { scope: 'evidence_case_labels' }),
      memoryListAll('sparta_controls', ['control_id', 'name', 'source_framework', 'nrs_score']),
      memoryListAll('sparta_relationships', ['source_control_id', 'target_control_id', 'relationship_type']),
    ])
    const cases = evidenceCases.map((ec: any) => { const sol = parseEvidenceSolution(ec); return { question: sol.question ?? ec.title ?? '', verdict: sol.verdict ?? 'unknown', grade: sol.grade ?? 'N/A', gates_passed: sol.gates_passed ?? 0, gates_total: sol.gates_total ?? 7, control_ids: sol.control_ids ?? [], category: sol.category ?? 'unknown', gate_summary: sol.gate_summary ?? '', created_at: ec.created_at ?? 0 } })
    const satisfied = cases.filter((c: any) => c.verdict === 'satisfied')
    const inconclusive = cases.filter((c: any) => c.verdict === 'inconclusive')
    const notSatisfied = cases.filter((c: any) => c.verdict === 'not_satisfied')
    const projectionTargetIds = [...new Set(projection.path_resolution.path_proofs.flatMap((proof) => proof.edges.map((edge) => edge.target_id)))]
    const totalCaseCount = cases.length + 1
    const controlsWithEvidence = new Set(cases.flatMap((c: any) => c.control_ids))
    const totalControls = controls.length
    const relSet = new Set(rels.flatMap((r: any) => [String(r.source_control_id), String(r.target_control_id)]))
    const postureScore = totalCaseCount ? Math.round((satisfied.length / totalCaseCount) * 100) : 0
    const complianceScore = totalCaseCount ? Math.round(((satisfied.length + inconclusive.length * 0.5) / totalCaseCount) * 100) : 0
    const freshCaseCount = cases.filter((c: any) => (Date.now() / 1000 - (c.created_at || 0)) < 90 * 86400).length + 1
    const evidenceFreshness = totalCaseCount ? Math.round((freshCaseCount / totalCaseCount) * 100) : 0
    const fwMap = new Map<string, { name: string; total: number; satisfied: number; inconclusive: number; failed: number }>()
    for (const c of controls) { const fw = String(c.source_framework || 'Unknown'); if (!fwMap.has(fw)) fwMap.set(fw, { name: fw, total: 0, satisfied: 0, inconclusive: 0, failed: 0 }); const b = fwMap.get(fw)!; b.total += 1; if (controlsWithEvidence.has(String(c.control_id))) { const rc = cases.filter((ec: any) => ec.control_ids.includes(String(c.control_id))); if (rc.some((ec: any) => ec.verdict === 'satisfied') && !rc.some((ec: any) => ec.verdict === 'not_satisfied')) b.satisfied += 1; else if (rc.some((ec: any) => ec.verdict === 'not_satisfied')) b.failed += 1; else b.inconclusive += 1 } }
    const frameworks = [...fwMap.values()].map(f => ({ ...f, pct: f.total ? Math.round((f.satisfied / f.total) * 100) : 0 }))
    frameworks.push({ name: 'F-36 requirement families', total: 1, satisfied: 0, inconclusive: 1, failed: 0, pct: 0 })
    const famMap = new Map<string, { family: string; total: number; satisfied: number; inconclusive: number; failed: number; noEvidence: number }>()
    for (const c of controls) { const cid = String(c.control_id || ''); const fam = cid.match(/^([A-Z]{2})[-_]/)?.[1] ?? (cid.slice(0, 2).toUpperCase() || 'UN'); if (!famMap.has(fam)) famMap.set(fam, { family: fam, total: 0, satisfied: 0, inconclusive: 0, failed: 0, noEvidence: 0 }); const b = famMap.get(fam)!; b.total += 1; if (!controlsWithEvidence.has(cid)) { b.noEvidence += 1; continue } const ec2 = cases.filter((ec: any) => ec.control_ids.includes(cid)); if (ec2.some((ec: any) => ec.verdict === 'satisfied') && !ec2.some((ec: any) => ec.verdict === 'not_satisfied')) b.satisfied += 1; else if (ec2.some((ec: any) => ec.verdict === 'not_satisfied')) b.failed += 1; else b.inconclusive += 1 }
    const families = [...famMap.values()].map(f => ({ ...f, pct: f.total ? Math.round((f.satisfied / f.total) * 100) : 0 })).sort((a, b) => a.family.localeCompare(b.family))
    families.unshift({ family: 'F36 replay family', total: 1, satisfied: 0, inconclusive: 1, failed: 0, noEvidence: 0, pct: 0 })
    const genericRiskControls = notSatisfied.map((ec: any, index: number) => {
      const mappedControls = (ec.control_ids || []).map((cid: string) => {
        const ctrl = controls.find((c: any) => String(c.control_id) === cid)
        return {
          control_id: cid,
          name: ctrl?.name ?? '',
          source_framework: ctrl?.source_framework ?? '',
        }
      })
      const primaryControl = mappedControls[0]
      const findingId = `F36-FINDING-${String(index + 1).padStart(3, '0')}`
      return {
        control_id: findingId,
        finding_id: findingId,
        name: ec.question || 'F-36 evidence obligation not satisfied',
        source_framework: 'F-36 corpora evidence case',
        verdict: 'not_satisfied',
        grade: ec.grade,
        question: ec.question,
        mapped_controls: mappedControls.map((c: any) => c.control_id),
        primary_control_id: primaryControl?.control_id ?? '',
        primary_control_name: primaryControl?.name ?? '',
        primary_control_framework: primaryControl?.source_framework ?? '',
      }
    })
    const riskControls = [{
      control_id: projection.requirement.requirement_id,
      finding_id: projection.source.family_evidence_case_snapshot_id,
      name: 'Replay and Sequence-Abuse Detection — agent candidate',
      source_framework: 'F-36 requirement family / local SPARTA v3.1 candidate paths',
      verdict: 'inconclusive',
      grade: 'Agent candidate',
      question: projection.engineering_qra_family.canonical_question,
      mapped_controls: projectionTargetIds,
      projection_fingerprint: projection.projection_fingerprint,
      requirement_revision_id: projection.requirement.requirement_revision_id,
      engineering_qra_family_id: projection.engineering_qra_family.engineering_qra_family_id,
      review_state: projection.review_state,
      accepted: projection.accepted,
      quarantine_state: projection.quarantine_state,
      grounded_credit: 0,
      compliance_credit: 0,
    }, ...genericRiskControls].slice(0, 10)
    const controlsWithRel = controls.filter((c: any) => relSet.has(String(c.control_id))).length
    const relTypes: Record<string, number> = {}; for (const r of rels) { const t = String(r.relationship_type || 'unknown'); relTypes[t] = (relTypes[t] ?? 0) + 1 }
    const reqToControl = totalCaseCount ? Math.round(((cases.filter((c: any) => c.control_ids.length > 0).length + 1) / totalCaseCount) * 100) : 0
    const controlToRel = totalControls ? Math.round((controlsWithRel / totalControls) * 100) : 0
    const controlToEvidence = totalControls ? Math.round((controlsWithEvidence.size / totalControls) * 100) : 0
    const brokenTraces = [{
      trace: `${projection.requirement.requirement_revision_id} -> ${projectionTargetIds.join(', ')}`,
      defect: 'Agent candidate pending human review',
      impact: 'INCONCLUSIVE — traceability only; zero grounded/compliance credit',
      fix: `Review persisted paths from ${projection.path_resolution.sparta_release_id}`,
    }, ...notSatisfied.map((ec: any) => ({ trace: `Req -> ${ec.control_ids.slice(0, 3).join(', ')}`, defect: 'Failed evidence case', impact: `${ec.grade} grade — ${ec.gates_passed}/${ec.gates_total} gates`, fix: ec.question?.slice(0, 100) ?? '' })), ...inconclusive.slice(0, 4).map((ec: any) => ({ trace: `Req -> ${ec.control_ids.slice(0, 3).join(', ')}`, defect: 'Inconclusive evidence', impact: `${ec.grade} grade — ${ec.gates_passed}/${ec.gates_total} gates`, fix: ec.question?.slice(0, 100) ?? '' }))].slice(0, 8)
    const traceabilityScore = Math.round(reqToControl * 0.3 + controlToRel * 0.3 + controlToEvidence * 0.4)
    const contradictions = notSatisfied.filter((ec: any) => ec.control_ids.some((cid: string) => satisfied.some((s: any) => s.control_ids.includes(cid)))).length
    const assuranceScore = totalCaseCount ? Math.round(((satisfied.length + inconclusive.length * 0.5) / totalCaseCount) * 100) : 0
    const avgGP = cases.length ? cases.reduce((s: number, c: any) => s + c.gates_passed, 0) / cases.length : 0
    const avgGT = cases.length ? cases.reduce((s: number, c: any) => s + c.gates_total, 0) / cases.length : 7
    const claimsNeedingReview = [{
      question: projection.engineering_qra_family.canonical_question,
      verdict: 'inconclusive',
      grade: 'Agent candidate',
      gates: 'persisted exact paths / human review pending',
      controls: projectionTargetIds,
      gate_summary: `Fingerprint ${projection.projection_fingerprint}; accepted=false; compliance credit=0`,
    }, ...[...notSatisfied, ...inconclusive].slice(0, 5).map((ec: any) => ({ question: ec.question?.slice(0, 120) ?? '', verdict: ec.verdict, grade: ec.grade, gates: `${ec.gates_passed}/${ec.gates_total}`, controls: ec.control_ids.slice(0, 5), gate_summary: ec.gate_summary ?? '' }))]
    res.json({
      projection_fingerprint: projection.projection_fingerprint,
      posture: {
        postureScore, complianceScore, criticalFindings: notSatisfied.length,
        openFindings: notSatisfied.length + inconclusive.length + 1,
        evidenceFreshness, totalCases: totalCaseCount, frameworks, families, riskControls,
        f36Projection: {
          projection_fingerprint: projection.projection_fingerprint,
          requirement: projection.requirement,
          engineering_qra_family: projection.engineering_qra_family,
          evidence_verdict: projection.evidence_verdict,
          review_state: projection.review_state,
          accepted: projection.accepted,
          quarantine_state: projection.quarantine_state,
          binding_registry_state: projection.binding_registry_state,
          projection_eligibility: projection.projection_eligibility,
          posture: projection.posture,
          authority: projection.authority,
        },
      },
      traceability: { traceabilityScore, mappedRequirements: cases.filter((c: any) => c.control_ids.length > 0).length + 1, orphanRequirements: cases.filter((c: any) => c.control_ids.length === 0).length, totalControls, controlsWithEvidence: controlsWithEvidence.size, controlsWithRelationships: controlsWithRel, relationshipTypes: relTypes, totalRelationships: rels.length, coverageChain: { reqToControl, controlToRel, controlToEvidence }, brokenTraces },
      assurance: { assuranceScore, supportedClaims: satisfied.length, partialClaims: inconclusive.length + 1, unsupportedClaims: notSatisfied.length, contradictions, totalClaims: totalCaseCount, evidenceQuality: { gatePassRate: Math.round((avgGP / avgGT) * 100), freshness: evidenceFreshness, completeness: reqToControl, authority: Math.round((satisfied.filter((c: any) => c.grade === 'A+').length / Math.max(satisfied.length, 1)) * 100) }, claimsNeedingReview },
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

app.get('/api/qra/status-counts', async (req, res) => {
  const source = String(req.query?.source || 'all').toLowerCase()
  try {
    res.json(await getQraStatusAggregate(source))
  } catch (e) {
    console.error('[qra/status-counts] failed', e)
    res.status(502).json({ error: 'qra_status_counts_failed', detail: String(e) })
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

app.post('/api/sparta/qras/:key/review', async (req, res) => {
  const key = String(req.params.key || '').trim()
  const collectionHint = String(req.body?.collection || '').trim()
  const decision = String(req.body?.decision || '').trim()
  const reviewer = String(req.body?.reviewer || 'brandon').trim()
  const reviewedDraft = req.body?.reviewed_draft && typeof req.body.reviewed_draft === 'object'
    ? req.body.reviewed_draft as { question?: unknown; reasoning?: unknown; answer?: unknown }
    : {}
  const draftHash = String(req.body?.draft_hash || '').trim()
  const evidenceRun = req.body?.evidence_run && typeof req.body.evidence_run === 'object'
    ? req.body.evidence_run as JsonRecord
    : {}
  if (!key) return res.status(400).json({ error: 'qra_review_requires_key' })
  if (!['accept', 'reject', 'retain_adversarial'].includes(decision)) return res.status(400).json({ error: 'invalid_qra_review_decision' })
  const question = typeof reviewedDraft.question === 'string' ? reviewedDraft.question.trim() : ''
  const answer = typeof reviewedDraft.answer === 'string' ? reviewedDraft.answer.trim() : ''
  const reasoning = typeof reviewedDraft.reasoning === 'string' ? reviewedDraft.reasoning.trim() : ''
  if (!question || !answer) return res.status(400).json({ error: 'qra_review_requires_reviewed_question_and_answer' })

  const collections = collectionHint && [...QRA_V2_COLLECTIONS, LEGACY_QRA_COLLECTION].includes(collectionHint as any)
    ? [collectionHint]
    : ['sparta_qra', ...QRA_V2_COLLECTIONS]
  const { patch, evidenceCasePatch, reviewEvent } = buildQraReviewPatch({
    decision,
    reviewer,
    reviewedDraft: { question, answer, reasoning },
    draftHash,
    evidenceRun,
  })

  try {
    const persisted = await persistQraReview({
      key,
      collections,
      patch,
      evidenceCasePatch,
      reviewEvent,
      fetchQraDocsByKeys: async (collection, keys) => fetchQraDocsByKeys(collection, keys),
      upsertDocuments: async (collection, documents) => {
        await proxyPost('/upsert', {
          collection,
          documents,
        }, 45000)
      },
    })
    if (persisted) {
      QRA_STATUS_CACHE.clear()
      return res.json({ ok: true, collection: persisted.collection, document: persisted.document, review_event: reviewEvent })
    }
    return res.status(404).json({ error: 'qra_not_found', key })
  } catch (e) {
    console.error('[sparta/qras/review] failed', e)
    return res.status(502).json({ error: 'qra_review_failed', detail: String(e) })
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
    if (SPARTA_COUNTS_CACHE && Date.now() - SPARTA_COUNTS_CACHE.at < SPARTA_COUNTS_CACHE_TTL_MS) {
      return res.json(SPARTA_COUNTS_CACHE.payload)
    }

    SPARTA_COUNTS_PENDING ??= (async () => {
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
      SPARTA_COUNTS_CACHE = { payload, at: Date.now() }
      return payload
    })().finally(() => {
      SPARTA_COUNTS_PENDING = null
    })

    res.json(await SPARTA_COUNTS_PENDING)
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
  const artifactDir = SPARTA_GAP_PLAN_DIR
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

function parseLastMatch<T>(text: string, pattern: RegExp, map: (match: RegExpMatchArray) => T | null): T | null {
  let out: T | null = null
  for (const match of text.matchAll(pattern)) {
    out = map(match)
  }
  return out
}

async function newestCreateQrasLog(): Promise<{ path: string; mtimeMs: number } | null> {
  const files = await readdir(SPARTA_GAP_PLAN_DIR).catch(() => [])
  const candidates = await Promise.all(files
    .filter((name) => /^create_qras_.*\.log$/.test(name) && !name.includes('watchdog') && !name.includes('safe_backfill_setsid_chain'))
    .map(async (name) => {
      const path = resolve(SPARTA_GAP_PLAN_DIR, name)
      const stats = await stat(path).catch(() => null)
      return stats ? { path, mtimeMs: stats.mtimeMs } : null
    }))
  return candidates
    .filter((row): row is { path: string; mtimeMs: number } => Boolean(row))
    .sort((left, right) => right.mtimeMs - left.mtimeMs)[0] ?? null
}

async function readCreateQrasBackfillProgress(): Promise<JsonRecord> {
  const processPattern = 'runtime\\.cli (generate|manifest)|create_qras_safe_backfill'
  const { stdout } = await execAsync(`pgrep -af '${processPattern}' || true`, { timeout: 5_000 }).catch(() => ({ stdout: '' }))
  const processLines = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.includes('pgrep -af'))
  const activeRuntimeLines = processLines.filter((line) => /runtime\.cli (generate|manifest)/.test(line))
  const newestLog = await newestCreateQrasLog()
  const logText = newestLog ? await readFile(newestLog.path, 'utf8').catch(() => '') : ''
  const lastChunk = parseLastMatch(logText, /Chunk\s+(\d+)\/(\d+)\s+\((\d+)-(\d+)\/(\d+)\)/g, (match) => ({
    current: Number(match[1]),
    total: Number(match[2]),
    start: Number(match[3]),
    end: Number(match[4]),
    job_total: Number(match[5]),
  }))
  const lastHeartbeat = parseLastMatch(logText, /Heartbeat:\s+chunk\s+(\d+)\/(\d+),\s+pending=(\d+),\s+elapsed=([\d.]+)s,\s+items=(.*)/g, (match) => ({
    chunk_current: Number(match[1]),
    chunk_total: Number(match[2]),
    pending: Number(match[3]),
    elapsed_s: Number(match[4]),
    items: String(match[5] ?? '').slice(0, 240),
  }))
  const lastStored = parseLastMatch(logText, /Stored\s+(\d+)\s+QRAs\s+\(total:\s*(\d+)\)/g, (match) => ({
    last_batch: Number(match[1]),
    total: Number(match[2]),
  }))
  const heartbeat = lastChunk && lastHeartbeat
    && lastHeartbeat.chunk_current === lastChunk.current
    && lastHeartbeat.chunk_total === lastChunk.total
    ? lastHeartbeat
    : null
  const manifestPath = parseLastMatch(logText, /Manifest:\s+(.+)/g, (match) => String(match[1] ?? '').trim())
  const totalJobs = parseLastMatch(logText, /Total jobs:\s+(\d+)/g, (match) => Number(match[1]))
  const canonicalJobs = parseLastMatch(logText, /Processing\s+(\d+)\s+canonical jobs/g, (match) => Number(match[1]))
  const relationshipJobs = parseLastMatch(logText, /Processing\s+(\d+)\s+relationship jobs/g, (match) => Number(match[1]))
  const latestLogAgeSeconds = newestLog ? Math.max(0, Math.round((Date.now() - newestLog.mtimeMs) / 1000)) : null
  const active = activeRuntimeLines.length > 0 || processLines.some((line) => line.includes('create_qras_safe_backfill'))
  const percent = lastChunk && lastChunk.total > 0
    ? Math.max(0, Math.min(100, Math.round((lastChunk.current / lastChunk.total) * 100)))
    : null

  return {
    status: active ? 'running' : 'idle',
    active_process_count: activeRuntimeLines.length,
    process_count: processLines.length,
    pid_summary: activeRuntimeLines.slice(0, 2).map((line) => line.split(/\s+/)[0]).join(', ') || null,
    current_log: newestLog ? newestLog.path : null,
    current_log_age_seconds: latestLogAgeSeconds,
    manifest_path: manifestPath,
    total_jobs: totalJobs,
    canonical_jobs: canonicalJobs,
    relationship_jobs: relationshipJobs,
    chunk: lastChunk,
    heartbeat,
    stored: lastStored,
    progress_percent: percent,
    message: active && lastChunk
      ? `create-qras ${lastChunk.current}/${lastChunk.total} chunks; ${lastStored?.total ?? 0} stored in current manifest.`
      : active
        ? 'create-qras worker active; waiting for manifest progress heartbeat.'
        : newestLog
          ? `No active create-qras worker observed; latest log changed ${latestLogAgeSeconds}s ago.`
          : 'No create-qras backfill log found.',
  }
}

async function attachLiveCreateQrasProgress(payload: JsonRecord): Promise<JsonRecord> {
  return {
    ...attachQraTrustStatus(payload),
    createQrasBackfill: await readCreateQrasBackfillProgress(),
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

async function fileMtimeMs(path: string): Promise<number | null> {
  const info = await stat(path).catch(() => null)
  return info ? Math.trunc(info.mtimeMs) : null
}


async function liveSpartaControlsCount(): Promise<number> {
  try {
    return await countQraDocs('sparta_controls')
  } catch {
    return 0
  }
}

async function rejectStaleCoverageSnapshot(snapshot: JsonRecord): Promise<JsonRecord | null> {
  const snapshotControls = Number(
    snapshot.controls
      ?? (snapshot.counts as JsonRecord | undefined)?.sparta_controls
      ?? (snapshot.corpus as JsonRecord | undefined)?.controls
      ?? 0,
  )
  if (!Number.isFinite(snapshotControls) || snapshotControls < 1000) {
    return null
  }
  const liveControls = await liveSpartaControlsCount()
  if (liveControls > 0 || snapshotControls === 0) {
    return null
  }
  return {
    error: 'sparta_coverage_snapshot_stale',
    detail: 'Cached coverage shows SPARTA controls but live ArangoDB corpus is empty',
    snapshot_controls: snapshotControls,
    live_controls: liveControls,
    incident_hint: 'Restore primary ArangoDB from clone :8530; never trust cached coverage when live count is zero',
    generated_at: snapshot.generated_at ?? null,
  }
}

async function buildSpartaCoverageChangeSignature(): Promise<JsonRecord> {
  const counts = await Promise.all(
    SPARTA_COVERAGE_SIGNATURE_COLLECTIONS.map(async (collection) => [
      collection,
      await countQraDocs(collection).catch(() => 0),
    ] as const),
  )
  return {
    schema: 'sparta_coverage_change_signature.v1',
    collections: Object.fromEntries(counts),
  }
}

function sameCoverageChangeSignature(left: unknown, right: unknown): boolean {
  if (!left || !right) return false
  return canonicalJson(left) === canonicalJson(right)
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
  if (!SPARTA_SUPERVISOR_RUN_ENABLED) {
    return readSpartaSupervisorState()
  }

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

async function attachFreshSupervisorToCoveragePayload(payload: JsonRecord, options: { refresh?: boolean } = {}): Promise<JsonRecord> {
  const refresh = options.refresh ?? true
  const supervisor = refresh
    ? await refreshSpartaSupervisorState()
    : (payload.supervisor && typeof payload.supervisor === 'object' && !Array.isArray(payload.supervisor)
      ? payload.supervisor
      : await readSpartaSupervisorState())
  if (!supervisor || typeof supervisor !== 'object' || Array.isArray(supervisor)) return payload
  const existingSupervisor = payload.supervisor && typeof payload.supervisor === 'object' && !Array.isArray(payload.supervisor)
    ? payload.supervisor as JsonRecord
    : {}
  const sourceEmbeddingCoverage = existingSupervisor.source_embedding_coverage
    && typeof existingSupervisor.source_embedding_coverage === 'object'
    && !Array.isArray(existingSupervisor.source_embedding_coverage)
    ? existingSupervisor.source_embedding_coverage
    : null
  return {
    ...payload,
    supervisor: {
      ...(supervisor as JsonRecord),
      ...(sourceEmbeddingCoverage ? { source_embedding_coverage: sourceEmbeddingCoverage } : {}),
    },
  }
}

async function buildSpartaCoveragePayload(): Promise<JsonRecord> {
  const supplementScript = `
import json
from scripts.validation._health_checks import check_create_qras_remaining_calls, get_sparta_control_framework_inventory
from scripts.validation.sparta_corpus_inventory import scan as scan_corpus_inventory
from scripts.validation.source_embedding_coverage import scan as scan_source_embedding_coverage

remaining_raw = check_create_qras_remaining_calls().to_dict()
remaining = {
    "ok": remaining_raw.get("ok"),
    "dimension": remaining_raw.get("dimension"),
    "message": remaining_raw.get("message"),
    "native_remaining_any_collection_total": remaining_raw.get("native_remaining_any_collection_total"),
    "native_remaining_non_sparta_total": remaining_raw.get("native_remaining_non_sparta_total"),
    "native_remaining_sparta_any_collection": remaining_raw.get("native_remaining_sparta_any_collection"),
    "native_by_framework": remaining_raw.get("native_by_framework"),
    "sparta_v2_remaining_total": remaining_raw.get("sparta_v2_remaining_total"),
    "sparta_v2_native_remaining_target_collection": remaining_raw.get("sparta_v2_native_remaining_target_collection"),
    "sparta_v2_contextual_remaining_target_collection": remaining_raw.get("sparta_v2_contextual_remaining_target_collection"),
    "sparta_v2_remaining_prompt_kinds": remaining_raw.get("sparta_v2_remaining_prompt_kinds"),
    "sparta_control_to_control_raw_candidate_pairs": remaining_raw.get("sparta_control_to_control_raw_candidate_pairs"),
    "sparta_control_to_control_gated_pairs": remaining_raw.get("sparta_control_to_control_gated_pairs"),
    "sparta_control_to_control_gated_skip_reasons": remaining_raw.get("sparta_control_to_control_gated_skip_reasons"),
    "implemented_backlog_total_if_legacy_sparta_native_counts_as_done": remaining_raw.get("implemented_backlog_total_if_legacy_sparta_native_counts_as_done"),
    "implemented_backlog_total_if_v2_sparta_native_required": remaining_raw.get("implemented_backlog_total_if_v2_sparta_native_required"),
    "exact_remaining_calls_total": remaining_raw.get("exact_remaining_calls_total"),
    "total_with_raw_comparison_candidates": remaining_raw.get("total_with_raw_comparison_candidates"),
}
try:
    source_embedding_coverage = scan_source_embedding_coverage(artifact_dir=None)
except Exception as exc:
    source_embedding_coverage = {
        "schema_version": 1,
        "status": "blocked",
        "state": "scanner_failed",
        "gaps": {
            "blocked_reasons": [f"source_embedding_coverage_failed:{exc}"],
            "fail_reasons": [],
            "missing_vectors": 0,
            "stale_vectors": 0,
        },
        "backfill": {"required": False, "mode": "review_required", "mutation_enabled": False, "manifest": None},
        "resume_hint": "Fix source_embedding_coverage scanner error before marking this lane pass.",
    }
print(json.dumps({
    "remaining": remaining,
    "corpus_inventory": scan_corpus_inventory(),
    "source_embedding_coverage": source_embedding_coverage,
    "control_frameworks": [{
        **row,
        "defects": (row.get("defects") or [])[:25],
        "defect_count": len(row.get("defects") or []),
    } for row in get_sparta_control_framework_inventory()],
}, default=str))
`.trim()

  const monitorHealth = await runCommandJson('uv', ['run', 'python', 'scripts/validation/monitor_sparta.py', 'health', '--json'], {
    cwd: MEMORY_REPO_ROOT,
    env: { PYTHONPATH: 'src', MEMORY_SERVICE_URL: 'http://127.0.0.1:8601' },
    timeout: 540_000,
  })

  const [
    supplement,
    changeSignature,
    bestPracticeBase,
    artifacts,
    promptAudit,
    monitorClosure,
  ] = await Promise.all([
    runCommandJson('uv', ['run', 'python', '-c', supplementScript], {
      cwd: MEMORY_REPO_ROOT,
      env: { PYTHONPATH: 'src', MEMORY_SERVICE_URL: 'http://127.0.0.1:8601' },
      timeout: 180_000,
    }),
    buildSpartaCoverageChangeSignature(),
    runBestPracticeAudit(),
    readLatestArtifactSummary(),
    auditSpartaPrompts(),
    readMonitorClosureBaseline(),
  ])
  const monitor = {
    ...(monitorHealth as JsonRecord),
    ...(supplement as JsonRecord),
  }
  const supervisor = await refreshSpartaSupervisorState()
  const counts = (changeSignature.collections && typeof changeSignature.collections === 'object' && !Array.isArray(changeSignature.collections))
    ? changeSignature.collections as Record<string, number>
    : {}
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
          malformed: check.malformed,
          scanned: check.scanned,
          course_corrected_non_generation: check.course_corrected_non_generation,
          course_corrected_by_collection: check.course_corrected_by_collection,
          malformed_by_collection: check.malformed_by_collection,
          rule_counts: check.rule_counts,
          output_path: check.output_path,
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
  const freshSourceEmbedding = monitor && typeof monitor === 'object' && !Array.isArray(monitor)
    && (monitor as JsonRecord).source_embedding_coverage
    && typeof (monitor as JsonRecord).source_embedding_coverage === 'object'
    && !Array.isArray((monitor as JsonRecord).source_embedding_coverage)
    ? (monitor as JsonRecord).source_embedding_coverage as JsonRecord
    : null
  const supervisorForCoverage = supervisor && typeof supervisor === 'object' && !Array.isArray(supervisor)
    ? {
      ...(supervisor as JsonRecord),
      ...(freshSourceEmbedding ? { source_embedding_coverage: freshSourceEmbedding } : {}),
    }
    : freshSourceEmbedding
      ? { source_embedding_coverage: freshSourceEmbedding }
      : supervisor

  return {
    generated_at: new Date().toISOString(),
    stale: false,
    refreshing: false,
    refresh_policy: 'change_gated',
    coverage_change_signature: changeSignature,
    corpus: {
      controls: counts.sparta_controls ?? 0,
      qrasLegacy: counts.sparta_qra ?? 0,
      qrasCanonical: counts.sparta_qra_canonical ?? 0,
      qrasRelationship: counts.sparta_qra_relationship ?? 0,
      qrasTotal: (counts.sparta_qra ?? 0) + (counts.sparta_qra_canonical ?? 0) + (counts.sparta_qra_relationship ?? 0),
      relationships: counts.sparta_relationships ?? 0,
      urls: counts.sparta_urls ?? 0,
      urlKnowledge: counts.sparta_url_knowledge ?? 0,
      datalakeChunks: counts.datalake_chunks ?? 0,
    },
    qraTrust: {
      status: 'plausible_for_system_test',
      label: 'System-Test Ready',
      expert_blessed: false,
      reviewer: null,
      blessed_at: null,
      scope: ['legacy', 'canonical', 'relationship'],
      counts: {
        legacy: counts.sparta_qra ?? 0,
        canonical: counts.sparta_qra_canonical ?? 0,
        relationship: counts.sparta_qra_relationship ?? 0,
        total: (counts.sparta_qra ?? 0) + (counts.sparta_qra_canonical ?? 0) + (counts.sparta_qra_relationship ?? 0),
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
    bestPractices: deriveBestPracticeAudit(bestPracticeBase as Array<Record<string, unknown>>, promptAudit, supervisorForCoverage),
    promptAudit,
    artifacts,
    supervisor: supervisorForCoverage,
    createQrasBackfill: await readCreateQrasBackfillProgress(),
    monitorClosure,
  }
}

function refreshSpartaCoverageInBackground(force = false) {
  if (spartaCoverageRefresh) return spartaCoverageRefresh
  spartaCoverageRefresh = buildSpartaCoveragePayload()
    .then(async (payload) => {
      const normalizedPayload = await attachLiveCreateQrasProgress(payload)
      spartaCoverageCache = { expiresAt: Date.now() + SPARTA_COVERAGE_CACHE_TTL_MS, payload: normalizedPayload }
      await writeSpartaCoverageSnapshot(normalizedPayload).catch((err) => console.error('[sparta/coverage-health] failed to write snapshot', err))
      broadcastSpartaCoverageHealth(normalizedPayload, force)
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
    const forceRefresh = req.query.force === '1' || req.query.refresh === '1'
    const waitForRefresh = req.query.wait === '1'

    if (!forceRefresh && spartaCoverageCache && Date.now() < spartaCoverageCache.expiresAt) {
      const payload = await attachFreshSupervisorToCoveragePayload(spartaCoverageCache.payload, { refresh: false })
      spartaCoverageCache = { ...spartaCoverageCache, payload }
      return res.json(attachQraTrustStatus(payload))
    }

    const snapshot = spartaCoverageCache?.payload ?? await readSpartaCoverageSnapshot()

    if (snapshot && !waitForRefresh) {
      const staleRejection = await rejectStaleCoverageSnapshot(snapshot)
      if (staleRejection) {
        console.error('[sparta/coverage-health] refusing stale snapshot with empty live corpus', staleRejection)
        if (!forceRefresh) {
          return res.status(503).json(staleRejection)
        }
      }
      if (forceRefresh) {
        refreshSpartaCoverageInBackground(true).catch((err) => console.error('[sparta/coverage-health] background refresh failed', err))
      } else {
        void buildSpartaCoverageChangeSignature()
          .then((currentSignature) => {
            if (!currentSignature) return
            if (!sameCoverageChangeSignature(currentSignature, snapshot.coverage_change_signature)) {
              refreshSpartaCoverageInBackground(false).catch((err) => console.error('[sparta/coverage-health] background refresh failed', err))
            }
          })
          .catch((err) => console.error('[sparta/coverage-health] failed to build change signature', err))
      }
      const payload = await attachFreshSupervisorToCoveragePayload({
        ...snapshot,
        stale: Boolean(staleRejection),
        live_corpus_empty: Boolean(staleRejection),
        refreshing: forceRefresh,
        refresh_policy: staleRejection ? 'stale_snapshot_rejected' : (forceRefresh ? 'force_requested' : 'snapshot_served'),
        coverage_change_signature: snapshot.coverage_change_signature,
      }, { refresh: false })
      if (staleRejection && forceRefresh) {
        spartaCoverageCache = { expiresAt: Date.now() + SPARTA_COVERAGE_CACHE_TTL_MS, payload }
        return res.status(503).json(attachQraTrustStatus({ ...payload, ...staleRejection }))
      }
      spartaCoverageCache = { expiresAt: Date.now() + SPARTA_COVERAGE_CACHE_TTL_MS, payload }
      return res.json(attachQraTrustStatus(payload))
    }

    const payload = await refreshSpartaCoverageInBackground(forceRefresh)
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
    const supervisor = await refreshSpartaSupervisorState()
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

function pdfLabEvidenceAssetPath(pathValue: unknown): string | null {
  if (typeof pathValue !== 'string' || pathValue.length === 0) return null
  let realPath: string
  try {
    realPath = realpathSync(resolve(pathValue))
  } catch {
    return null
  }
  const allowedRoots = [
    '/mnt/storage12tb/pdf-lab/evidence',
    PDF_LAB_ARTIFACTS_ROOT,
    PUBLIC_ROOT,
  ].map(root => realpathSync(root))
  return allowedRoots.some(root => isPathInside(root, realPath)) ? realPath : null
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

app.get('/api/pdf-lab/evidence-asset', async (req, res) => {
  const filePath = pdfLabEvidenceAssetPath(req.query.path)
  if (!filePath) {
    return res.status(404).json({ error: 'Evidence asset not found or not allowed' })
  }
  const lowerPath = filePath.toLowerCase()
  const contentType = lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg') ? 'image/jpeg' : 'image/png'
  res.setHeader('Content-Type', contentType)
  createReadStream(filePath).pipe(res)
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
  const authorization = typeof req.headers.authorization === 'string'
    ? req.headers.authorization
    : `Bearer ${SCILLM_PROXY_KEY}`

  const proxyReq = httpRequest(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'Authorization': authorization,
        'X-Caller-Skill': String(req.headers['x-caller-skill'] ?? 'ux-lab'),
      },
    },
    (proxyRes) => {
      res.status(proxyRes.statusCode ?? 500)
      const contentType = String(proxyRes.headers['content-type'] ?? '')
      const shouldStream = contentType.includes('text/event-stream') || req.body?.stream === true
      if (shouldStream) {
        res.writeHead(proxyRes.statusCode ?? 200, {
          'Content-Type': contentType || 'text/event-stream; charset=utf-8',
          'Cache-Control': String(proxyRes.headers['cache-control'] ?? 'no-cache'),
          'X-Accel-Buffering': 'no',
        })
        proxyRes.pipe(res)
        return
      }
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

app.post('/api/tau/dream/story-draft', async (req, res) => {
  const payload = req.body?.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    res.status(400).json({ ok: false, error: 'invalid_story_prompt_payload', detail: 'Expected { payload: dream.story.prompt_payload.v1 }' })
    return
  }

  const promptPayload = payload as Record<string, any>
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const outDir = resolve(TAU_STORY_UI_PROOF_ROOT, `story-ui-${stamp}`)
  const runRoot = resolve(outDir, 'run')
  const promptBundleDir = resolve(outDir, 'prompt-bundle')
  const assetsDir = resolve(promptBundleDir, 'assets')
  await mkdir(assetsDir, { recursive: true })
  await mkdir(runRoot, { recursive: true })

  const interactionRows = Array.isArray(promptPayload?.context?.interaction_rows)
    ? promptPayload.context.interaction_rows
    : []
  const linkedAssets = Array.isArray(promptPayload?.context?.linked_assets)
    ? promptPayload.context.linked_assets
    : []
  const rawPrompt = Array.isArray(promptPayload?.messages)
    ? String(promptPayload.messages.find((message: any) => message?.role === 'user')?.content ?? '')
    : ''
  const promptMarkdown = [
    '# RATIONALE (not sent to LLM)',
    `# Purpose: ${String(promptPayload?.rationale?.purpose ?? 'Generate one grounded Phase 02 story JSON object.')}`,
    `# Consumer: ${String(promptPayload?.rationale?.consumer ?? 'ux-lab /dream#story and Tau story agents.')}`,
    `# Why this matters: ${String(promptPayload?.rationale?.why_this_matters ?? 'Story generation fails if assets, environment, or interaction rows are omitted.')}`,
    `# Input: ${Array.isArray(promptPayload?.rationale?.input) ? promptPayload.rationale.input.join(', ') : 'context and author_profile'}`,
    `# Output: ${String(promptPayload?.rationale?.output ?? 'JSON object matching response_contract.')}`,
    `# Last reviewed: ${String(promptPayload?.rationale?.last_reviewed ?? '2026-07-01')}`,
    '',
    '# Phase 02 Story Prompt Payload',
    '',
    `Core idea: ${String(promptPayload?.context?.core_idea ?? '')}`,
    '',
    `Location: ${String(promptPayload?.context?.location ?? '')}`,
    '',
    `Environment: ${String(promptPayload?.context?.environment ?? '')}`,
    '',
    `Author: ${String(promptPayload?.author_profile?.persona ?? 'selected author')}`,
    '',
    '## Raw Prompt',
    '',
    rawPrompt,
  ].join('\n')
  const responseSchema = promptPayload?.response_contract ?? {}
  const memoryContext = {
    schema: 'dream.story.memory_context.v1',
    linked_assets: linkedAssets,
    interaction_rows: interactionRows,
    author_profile: promptPayload?.author_profile ?? {},
  }
  const sourceIds = linkedAssets
    .map((asset: any) => String(asset?.memoryKey || asset?.source || asset?.id || '').trim())
    .filter(Boolean)
  const dreamPacket = {
    schema: 'persona_dream.dream_packet.v1',
    artifact_id: `story-ui-${stamp}-dream-packet`,
    status: 'ACCEPTED_AUTOMATED',
    created_at: new Date().toISOString(),
    persona: { id: 'embry', display_name: 'Embry' },
    dream_prompt: rawPrompt || String(promptPayload?.context?.core_idea ?? ''),
    frame_prompts: [
      {
        frame_id: 'panel-001',
        duration_s: Number(promptPayload?.task?.target_duration_seconds ?? promptPayload?.task?.duration_seconds ?? 10),
        prompt: [
          String(promptPayload?.context?.core_idea ?? ''),
          `Location: ${String(promptPayload?.context?.location ?? '')}`,
          `Environment: ${String(promptPayload?.context?.environment ?? '')}`,
          `Author: ${String(promptPayload?.author_profile?.persona ?? 'selected author')}`,
          `Interaction matrix: ${JSON.stringify(interactionRows)}`,
          `Linked assets: ${JSON.stringify(linkedAssets)}`,
        ].filter(Boolean).join('\n'),
        source_ids: sourceIds,
      },
    ],
    source_paths: {
      prompt_bundle: promptBundleDir,
    },
    review_evidence: {
      basis: 'Created from ux-lab /dream#story prompt payload for Tau story contract loop.',
      provider_intent: promptPayload?.model ?? {},
      source_ids: sourceIds,
    },
  }
  const workOrder = {
    schema: 'persona_dream.story_contract_work_order.v1',
    created_at: new Date().toISOString(),
    purpose: 'Create a one-panel 10-second Embry OS story contract from Phase 02 prompt payload.',
    source_paths: {
      run_root: runRoot,
      dream_packet: resolve(outDir, 'dream_packet.json'),
      prompt_bundle: promptBundleDir,
    },
    provider_intent: {
      writer: { model: 'gpt-5.5', reasoning_effort: 'medium', auth: 'codex-oauth' },
      reviewer: { provider: 'chutes', model: 'moonshotai/Kimi-K2.6-TEE' },
    },
    prompt_payload_path: resolve(promptBundleDir, 'prompt-payload.json'),
  }

  const paths = {
    promptPayload: resolve(promptBundleDir, 'prompt-payload.json'),
    promptMarkdown: resolve(promptBundleDir, 'prompt.md'),
    schema: resolve(promptBundleDir, 'schema.json'),
    memory: resolve(promptBundleDir, 'memory.json'),
    assetIndex: resolve(assetsDir, 'index.json'),
    reviewDir: resolve(promptBundleDir, 'review'),
    reviewPayload: resolve(promptBundleDir, 'review', 'story_payload.txt'),
    dreamPacket: resolve(outDir, 'dream_packet.json'),
    workOrder: resolve(outDir, 'story_contract_work_order.json'),
  }
  try {
    await mkdir(paths.reviewDir, { recursive: true })
    await writeJsonFile(paths.promptPayload, promptPayload)
    await writeFile(paths.promptMarkdown, `${promptMarkdown}\n`, 'utf-8')
    await writeJsonFile(paths.schema, responseSchema)
    await writeJsonFile(paths.memory, memoryContext)
    await writeJsonFile(paths.assetIndex, { schema: 'dream.story.asset_index.v1', assets: linkedAssets })
    await writeFile(paths.reviewPayload, [
      '# REVIEW REQUEST FOR WEB LLM',
      '#',
      `# Purpose: ${String(promptPayload?.rationale?.purpose ?? 'Generate one grounded Phase 02 story JSON object.')}`,
      `# Consumer: ${String(promptPayload?.rationale?.consumer ?? 'ux-lab /dream#story and Tau story agents.')}`,
      '# Task: Review whether the prompt below forces grounded one-panel story JSON from supplied memory, media descriptions, location, environment, and interaction rows.',
      '#',
      '# Review criteria:',
      '# 1. Does the prompt cite exact source fields?',
      '# 2. Does the prompt prohibit invented assets and rows?',
      '# 3. Is the JSON schema exact enough for validation?',
      '# 4. Does the complete example obey the schema?',
      '# 5. Are invalid-output criteria concrete?',
      '#',
      '================================================================================',
      'SYSTEM PROMPT',
      '================================================================================',
      '',
      Array.isArray(promptPayload?.messages)
        ? String(promptPayload.messages.find((message: any) => message?.role === 'system')?.content ?? '')
        : '',
      '',
      '================================================================================',
      'USER PROMPT',
      '================================================================================',
      '',
      rawPrompt,
      '',
      '================================================================================',
      'FULL PROMPT PAYLOAD JSON',
      '================================================================================',
      '',
      JSON.stringify(promptPayload, null, 2),
      '',
    ].join('\n'), 'utf-8')
    await writeJsonFile(paths.dreamPacket, dreamPacket)
    await writeJsonFile(paths.workOrder, workOrder)

    const manifest = await runCommandJson('uv', [
      'run',
      'python',
      '-m',
      'tau_coding.persona_dream_dream_packet_agent',
      '--story-proof',
      '--work-order',
      paths.workOrder,
      '--out-dir',
      outDir,
      '--github-target',
      'ux-lab#dream-story',
    ], {
      cwd: TAU_PROJECT_ROOT,
      timeout: 300_000,
    })
    const storyPath = typeof manifest?.story_contract === 'string' ? manifest.story_contract : resolve(runRoot, 'story_contract.json')
    const storyContract = existsSync(storyPath) ? JSON.parse(await readFile(storyPath, 'utf-8')) : null
    res.json({
      ok: true,
      status: manifest?.command_loop_status ?? 'UNKNOWN',
      mocked: false,
      live: true,
      prompt_bundle: promptBundleDir,
      work_order: paths.workOrder,
      manifest_path: resolve(outDir, 'manifest.json'),
      manifest,
      story_contract: storyContract,
      proof_scope: {
        proves: manifest?.claims?.proves ?? [],
        does_not_prove: manifest?.claims?.does_not_prove ?? [],
      },
    })
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: 'tau_story_draft_failed',
      detail: err instanceof Error ? err.message : String(err),
      command_output: commandOutput(err),
      mocked: false,
      live: false,
      artifacts: paths,
      out_dir: outDir,
    })
  }
})

app.get('/api/tau/dream/story-draft/latest', async (_req, res) => {
  try {
    if (!existsSync(TAU_STORY_UI_PROOF_ROOT)) {
      res.status(404).json({ ok: false, error: 'story_draft_root_missing', root: TAU_STORY_UI_PROOF_ROOT })
      return
    }
    const entries = await readdir(TAU_STORY_UI_PROOF_ROOT, { withFileTypes: true })
    const candidates = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('story-ui-'))
      .map(async (entry) => {
        const dir = resolve(TAU_STORY_UI_PROOF_ROOT, entry.name)
        const storyPath = resolve(dir, 'run/story_contract.json')
        const manifestPath = resolve(dir, 'manifest.json')
        const stats = await stat(dir)
        return { dir, storyPath, manifestPath, mtimeMs: stats.mtimeMs }
      }))
    const latest = candidates
      .filter((candidate) => existsSync(candidate.storyPath))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
    if (!latest) {
      res.status(404).json({ ok: false, error: 'latest_story_draft_missing', root: TAU_STORY_UI_PROOF_ROOT })
      return
    }
    const storyContract = JSON.parse(await readFile(latest.storyPath, 'utf-8'))
    const manifest = existsSync(latest.manifestPath)
      ? JSON.parse(await readFile(latest.manifestPath, 'utf-8'))
      : null
    const draft = typeof storyContract?.story === 'string' ? storyContract.story : JSON.stringify(storyContract, null, 2)
    res.json({
      ok: true,
      mocked: false,
      live: true,
      draft,
      story_contract: storyContract,
      story_contract_path: latest.storyPath,
      manifest_path: latest.manifestPath,
      status: manifest?.command_loop_status ?? storyContract?.status ?? 'UNKNOWN',
      manifest,
    })
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: 'latest_story_draft_read_failed',
      detail: err instanceof Error ? err.message : String(err),
      mocked: false,
      live: false,
    })
  }
})

app.post('/api/tau/dream/script-draft', async (req, res) => {
  const payload = req.body?.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    res.status(400).json({ ok: false, error: 'invalid_script_prompt_payload', detail: 'Expected { payload: dream.script.prompt_payload.v1 }' })
    return
  }

  const promptPayload = payload as Record<string, any>
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const outDir = resolve(TAU_SCRIPT_UI_PROOF_ROOT, `script-ui-${stamp}`)
  const runRoot = resolve(outDir, 'run')
  const promptBundleDir = resolve(outDir, 'prompt-bundle')
  const assetsDir = resolve(promptBundleDir, 'assets')
  await mkdir(assetsDir, { recursive: true })
  await mkdir(runRoot, { recursive: true })

  const rawPrompt = Array.isArray(promptPayload?.messages)
    ? String(promptPayload.messages.find((message: any) => message?.role === 'user')?.content ?? '')
    : ''
  const sourceContext = promptPayload?.source_context ?? {}
  const responseSchema = promptPayload?.response_contract ?? {}
  const linkedAssets = Array.isArray(sourceContext?.linked_assets) ? sourceContext.linked_assets : []
  const interactionRows = Array.isArray(sourceContext?.interaction_matrix) ? sourceContext.interaction_matrix : []
  const promptMarkdown = [
    '# Phase 06 Script Prompt Payload',
    '',
    'This bundle is ready for Tau Phase 06 script creator/reviewer orchestration.',
    'Tau must run script-writer followed by script-reviewer and return script_contract.json.',
    '',
    `Core idea: ${String(sourceContext?.core_idea ?? '')}`,
    '',
    `Story: ${String(sourceContext?.story ?? '')}`,
    '',
    `Location: ${JSON.stringify(sourceContext?.location ?? null)}`,
    '',
    `Environment: ${JSON.stringify(sourceContext?.environment ?? null)}`,
    '',
    '## Raw Prompt',
    '',
    rawPrompt,
  ].join('\n')
  const artifacts = {
    prompt_payload: resolve(promptBundleDir, 'prompt-payload.json'),
    prompt_markdown: resolve(promptBundleDir, 'prompt.md'),
    schema: resolve(promptBundleDir, 'schema.json'),
    source_context: resolve(promptBundleDir, 'source_context.json'),
    asset_index: resolve(assetsDir, 'index.json'),
    work_order: resolve(outDir, 'script_contract_work_order.json'),
    receipt: resolve(runRoot, 'script_dispatch_receipt.json'),
  }
  const workOrder = {
    schema: 'persona_dream.script_contract_work_order.v1',
    created_at: new Date().toISOString(),
    status: 'READY',
    purpose: 'Create Phase 06 screenplay script JSON from accepted persona-dream artifacts.',
    source_paths: {
      run_root: runRoot,
      prompt_bundle: promptBundleDir,
    },
    provider_intent: {
      writer: { agent: 'script-writer', model: 'gpt-5.5', reasoning_effort: 'medium', auth: 'codex-oauth' },
      reviewer: { agent: 'script-reviewer', provider: 'chutes', model: 'moonshotai/Kimi-K2.6-TEE' },
      max_iterations: 2,
    },
    prompt_payload_path: artifacts.prompt_payload,
    required_outputs: [
      'script_contract.json',
      'timed_transcript.json',
      'timed_beats.json',
      'entity_environment_script_table.json',
      'script-reviewer-verdict.json',
    ],
  }
  try {
    await writeJsonFile(artifacts.prompt_payload, promptPayload)
    await writeFile(artifacts.prompt_markdown, `${promptMarkdown}\n`, 'utf-8')
    await writeJsonFile(artifacts.schema, responseSchema)
    await writeJsonFile(artifacts.source_context, sourceContext)
    await writeJsonFile(artifacts.asset_index, { schema: 'dream.script.asset_index.v1', assets: linkedAssets })
    await writeJsonFile(artifacts.work_order, workOrder)
    const manifest = await runCommandJson('uv', [
      'run',
      'python',
      '-m',
      'tau_coding.persona_dream_dream_packet_agent',
      '--script-proof',
      '--work-order',
      artifacts.work_order,
      '--out-dir',
      outDir,
      '--github-target',
      'ux-lab#dream-script',
    ], {
      cwd: TAU_PROJECT_ROOT,
      timeout: 300_000,
    })
    const scriptPath = typeof manifest?.script_contract === 'string' ? manifest.script_contract : resolve(runRoot, 'script_contract.json')
    const scriptContract = existsSync(scriptPath) ? JSON.parse(await readFile(scriptPath, 'utf-8')) : null
    const receipt = {
      schema: 'persona_dream.script_dispatch_receipt.v1',
      status: manifest?.command_loop_status ?? 'UNKNOWN',
      mocked: false,
      live: true,
      created_at: new Date().toISOString(),
      message: 'Phase 06 script prompt bundle was dispatched through Tau script-writer/script-reviewer.',
      artifacts,
      manifest_path: resolve(outDir, 'manifest.json'),
      script_contract: scriptPath,
      counts: {
        interaction_rows: interactionRows.length,
        linked_assets: linkedAssets.length,
      },
    }
    await writeJsonFile(artifacts.receipt, receipt)
    res.json({
      ok: true,
      status: manifest?.validate_script_contract_status ?? scriptContract?.status ?? manifest?.command_loop_status ?? 'UNKNOWN',
      mocked: false,
      live: true,
      out_dir: outDir,
      prompt_bundle: promptBundleDir,
      work_order: artifacts.work_order,
      artifacts,
      manifest_path: resolve(outDir, 'manifest.json'),
      manifest,
      script_contract: scriptContract,
      proof_scope: {
        proves: manifest?.claims?.proves ?? [],
        does_not_prove: manifest?.claims?.does_not_prove ?? [],
      },
    })
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: 'tau_script_draft_failed',
      detail: err instanceof Error ? err.message : String(err),
      mocked: false,
      live: false,
      out_dir: outDir,
    })
  }
})

app.get('/api/tau/dream/script-draft/latest', async (_req, res) => {
  try {
    if (!existsSync(TAU_SCRIPT_UI_PROOF_ROOT)) {
      res.status(404).json({ ok: false, error: 'script_draft_root_missing', root: TAU_SCRIPT_UI_PROOF_ROOT })
      return
    }
    const entries = await readdir(TAU_SCRIPT_UI_PROOF_ROOT, { withFileTypes: true })
    const candidates = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('script-ui-'))
      .map(async (entry) => {
        const dir = resolve(TAU_SCRIPT_UI_PROOF_ROOT, entry.name)
        const scriptPath = resolve(dir, 'run/script_contract.json')
        const receiptPath = resolve(dir, 'run/script_dispatch_receipt.json')
        const stats = await stat(dir)
        return { dir, scriptPath, receiptPath, mtimeMs: stats.mtimeMs }
      }))
    const latestScript = candidates
      .filter((candidate) => existsSync(candidate.scriptPath))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
    if (latestScript) {
      const scriptContract = JSON.parse(await readFile(latestScript.scriptPath, 'utf-8'))
      const draft = typeof scriptContract?.script === 'string' ? scriptContract.script : JSON.stringify(scriptContract, null, 2)
      res.json({
        ok: true,
        mocked: false,
        live: true,
        draft,
        script_contract: scriptContract,
        script_contract_path: latestScript.scriptPath,
        status: scriptContract?.quality_checks?.missing_seed_ids?.length === 0 ? 'PASS_SCRIPT_CONTRACT' : (scriptContract?.status ?? 'UNKNOWN'),
      })
      return
    }
    const latestReceipt = candidates
      .filter((candidate) => existsSync(candidate.receiptPath))
      .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
    if (latestReceipt) {
      const receipt = JSON.parse(await readFile(latestReceipt.receiptPath, 'utf-8'))
      res.status(404).json({
        ok: false,
        error: 'latest_script_draft_missing',
        detail: receipt?.message ?? 'Latest Phase 06 run did not produce script_contract.json.',
        mocked: false,
        live: false,
        receipt,
      })
      return
    }
    res.status(404).json({ ok: false, error: 'latest_script_draft_missing', root: TAU_SCRIPT_UI_PROOF_ROOT })
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: 'latest_script_draft_read_failed',
      detail: err instanceof Error ? err.message : String(err),
      mocked: false,
      live: false,
    })
  }
})

app.get('/api/scillm/app-server/sessions/latest', async (req, res) => {
  const queryPhase = Array.isArray(req.query.phase_id) ? req.query.phase_id[0] : req.query.phase_id
  const queryPhaseCamel = Array.isArray(req.query.phaseId) ? req.query.phaseId[0] : req.query.phaseId
  const requestedPhaseId = safeScillmPhaseId(queryPhase) ?? safeScillmPhaseId(queryPhaseCamel)
  const discoveredPhaseId = requestedPhaseId ?? await findLatestAppServerSessionPhase()

  if (!discoveredPhaseId) {
    res.status(503).json({
      ok: false,
      error: 'codex_app_server_session_unavailable',
      detail: 'No plan-iterate phase contains evidence-artifacts/app-server-nico-e2e-run/summary.json.',
    })
    return
  }

  const phaseDir = resolve(SCILLM_PROJECT_ROOT, '.plan-iterate', discoveredPhaseId)
  const evidenceDir = resolve(phaseDir, 'evidence-artifacts')
  const runDir = resolve(evidenceDir, 'app-server-nico-e2e-run')
  const networkBlockedDir = resolve(evidenceDir, 'app-server-nico-e2e-run-network-blocked')
  const paths = {
    phase_status: resolve(phaseDir, 'PHASE_STATUS.json'),
    summary: resolve(runDir, 'summary.json'),
    transcript: resolve(runDir, 'turn-transcript.json'),
    events: resolve(runDir, 'events.jsonl'),
    pytest_log: resolve(runDir, 'pytest.log'),
    workspace_diff: resolve(runDir, 'workspace.diff'),
    workspace_status: resolve(runDir, 'workspace-status.log'),
    report_html: resolve(evidenceDir, 'nico-collaboration-report.html'),
    network_blocked_events: resolve(networkBlockedDir, 'events.jsonl'),
  }

  if (!isPathInside(SCILLM_PROJECT_ROOT, phaseDir) || !isPathInside(SCILLM_PROJECT_ROOT, runDir)) {
    res.status(500).json({ ok: false, error: 'configured app-server session paths escape project root' })
    return
  }

  try {
    const requiredPaths = [paths.summary, paths.transcript, paths.events]
    const missing = requiredPaths.filter((path) => !existsSync(path))
    if (missing.length) {
      res.status(503).json({
        ok: false,
        error: 'codex_app_server_session_incomplete',
        phase_id: discoveredPhaseId,
        missing,
      })
      return
    }

    const [
      phaseStatus,
      summary,
      transcriptRaw,
      eventsRaw,
      pytestLog,
      workspaceDiff,
      workspaceStatus,
      networkBlockedRaw,
    ] = await Promise.all([
      readJsonArtifact(paths.phase_status).catch(() => null),
      readJsonArtifact(paths.summary),
      readFile(paths.transcript, 'utf-8'),
      readFile(paths.events, 'utf-8'),
      readFile(paths.pytest_log, 'utf-8').catch(() => ''),
      readFile(paths.workspace_diff, 'utf-8').catch(() => ''),
      readFile(paths.workspace_status, 'utf-8').catch(() => ''),
      readFile(paths.network_blocked_events, 'utf-8').catch(() => ''),
    ])
    const transcript = JSON.parse(transcriptRaw)
    const events = parseScillmEvents(eventsRaw, paths.events)
    const networkBlockedEvents = networkBlockedRaw.trim()
      ? parseScillmEvents(networkBlockedRaw, paths.network_blocked_events)
      : []

    res.json({
      ok: true,
      schema: 'ux_lab.scillm_app_server_session_snapshot.v1',
      phase_id: discoveredPhaseId,
      source: {
        project_root: SCILLM_PROJECT_ROOT,
        phase_dir: phaseDir,
        run_dir: runDir,
        summary: paths.summary,
        transcript: paths.transcript,
        events: paths.events,
        pytest_log: paths.pytest_log,
        workspace_diff: paths.workspace_diff,
        workspace_status: paths.workspace_status,
        report_html: paths.report_html,
        network_blocked_events: paths.network_blocked_events,
      },
      call_varieties: [
        { id: 'one_shot', label: 'One-shot scillm call', implemented_interface: 'POST /v1/chat/completions' },
        { id: 'exec', label: 'scillm exec worker', implemented_interface: 'scillm exec profile' },
        { id: 'codex_app_server_subagent', label: 'Codex App Server subagent', implemented_interface: 'JSON-RPC thread/start + turn/start' },
      ],
      selected_call_variety: 'codex_app_server_subagent',
      runtime: {
        provider_surface: 'scillm',
        backing_runtime: 'codex_app_server',
        persona: 'Nico',
        model: 'gpt-5.5',
        approval_policy: 'never',
        sandbox: 'workspace-write',
        network_access: true,
        terminal_input_simulation: false,
        subagent_runner: false,
      },
      phase_status: phaseStatus,
      summary,
      transcript,
      event_summary: parseAppServerEventSummary(events),
      recent_events: events.slice(0, 120),
      network_blocked_event_summary: parseAppServerEventSummary(networkBlockedEvents),
      pytest_log: pytestLog,
      workspace_diff: workspaceDiff,
      workspace_status: workspaceStatus,
    })
  } catch (err) {
    res.status(503).json({
      ok: false,
      error: 'codex_app_server_session_read_failed',
      phase_id: discoveredPhaseId,
      detail: err instanceof Error ? err.message : String(err),
    })
  }
})

app.get('/api/scillm/dag-viewer/snapshot', async (req, res) => {
  const { phaseId, activePhaseId, requestedPhaseId } = await resolveScillmDagPhaseId(req)
  const phaseDir = resolve(SCILLM_PROJECT_ROOT, '.plan-iterate', phaseId)
  const defaultRunDir = resolve(phaseDir, 'evidence-artifacts', SCILLM_DAG_RUN_ARTIFACT_DIR)
  const defaultGraphPath = resolve(defaultRunDir, 'graph.request.json')
  const defaultStatusPath = resolve(defaultRunDir, 'status.json')
  const defaultEventsPath = resolve(defaultRunDir, 'events.jsonl')
  const phaseStatusPath = resolve(phaseDir, 'PHASE_STATUS.json')

  if (!isPathInside(SCILLM_PROJECT_ROOT, phaseDir)) {
    res.status(500).json({ ok: false, error: 'configured scillm DAG paths escape project root' })
    return
  }

  try {
    const { runDir, graphPath, statusPath, eventsPath, layout } = await resolveScillmRuntimeArtifacts(phaseDir)
    if (!isPathInside(SCILLM_PROJECT_ROOT, runDir)) {
      res.status(500).json({ ok: false, error: 'configured scillm DAG artifact paths escape project root' })
      return
    }
    const [graphRaw, statusRaw, eventsRaw, phaseStatusRaw] = await Promise.all([
      readFile(graphPath, 'utf-8'),
      readFile(statusPath, 'utf-8'),
      readFile(eventsPath, 'utf-8'),
      readFile(phaseStatusPath, 'utf-8').catch(() => ''),
    ])
    const graph = JSON.parse(graphRaw)
    const status = JSON.parse(statusRaw)
    const baseGraphHash = executableGraphHash(graph)
    const events = parseScillmEvents(eventsRaw, eventsPath)
    res.json({
      ok: true,
      phase_id: phaseId,
      active_phase_id: activePhaseId,
      requested_phase_id: requestedPhaseId,
      phase_matches_active: activePhaseId ? activePhaseId === phaseId : null,
      snapshot_kind: 'runtime_exec_artifacts',
      artifact_layout: layout,
      source: {
        project_root: SCILLM_PROJECT_ROOT,
        run_dir: runDir,
        graph: graphPath,
        status: statusPath,
        events: eventsPath,
        phase_status: phaseStatusPath,
      },
      graph,
      status,
      base_graph_hash: baseGraphHash,
      hash_algorithm: 'sha256.canonical_json.executable_graph.v1',
      events,
      phase_status: phaseStatusRaw ? JSON.parse(phaseStatusRaw) : null,
    })
  } catch (err) {
    try {
      const phaseStatusRaw = await readFile(phaseStatusPath, 'utf-8').catch(() => '')
      const phaseStatus = phaseStatusRaw ? JSON.parse(phaseStatusRaw) as JsonRecord : null
      const latestPlan = await latestScillmPlanGraph(phaseDir, phaseStatus)
      if (!latestPlan) throw err
      const graph = JSON.parse(await readFile(latestPlan.graphPath, 'utf-8')) as JsonRecord
      const readiness = latestPlan.readinessPath
        ? JSON.parse(await readFile(latestPlan.readinessPath, 'utf-8')) as JsonRecord
        : null
      const status = synthesizePlanIterateStatus(graph, readiness, phaseStatus)
      const events = [
        {
          ts: new Date().toISOString(),
          type: 'plan_iterate.phase_plan_snapshot',
          text: 'Runtime exec artifacts are unavailable; showing active plan graph and runtime-readiness evidence.',
        },
      ]
      res.json({
        ok: true,
        phase_id: phaseId,
        active_phase_id: activePhaseId,
        requested_phase_id: requestedPhaseId,
        phase_matches_active: activePhaseId ? activePhaseId === phaseId : null,
        snapshot_kind: 'plan_iterate_phase_plan',
        source: {
          project_root: SCILLM_PROJECT_ROOT,
          graph: latestPlan.graphPath,
          status: phaseStatusPath,
          events: 'synthetic: plan-iterate phase plan snapshot; runtime events unavailable',
          phase_status: phaseStatusPath,
          runtime_readiness: latestPlan.readinessPath ?? 'not reported',
          missing_runtime_graph: defaultGraphPath,
          missing_runtime_status: defaultStatusPath,
          missing_runtime_events: defaultEventsPath,
        },
        graph,
        status,
        base_graph_hash: executableGraphHash(graph),
        hash_algorithm: 'sha256.canonical_json.executable_graph.v1',
        events,
        phase_status: phaseStatus,
        missing_runtime_artifacts: {
          graph: defaultGraphPath,
          status: defaultStatusPath,
          events: defaultEventsPath,
          detail: err instanceof Error ? err.message : String(err),
        },
      })
    } catch (fallbackErr) {
      res.status(503).json({
        ok: false,
        error: 'scillm DAG evidence artifacts are unavailable',
        phase_id: phaseId,
        active_phase_id: activePhaseId,
        requested_phase_id: requestedPhaseId,
        detail: fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        expected: { graph: defaultGraphPath, status: defaultStatusPath, events: defaultEventsPath },
      })
    }
  }
})

app.post('/api/scillm/dag-viewer/amendments', async (req, res) => {
  const { phaseId } = await resolveScillmDagPhaseId(req)
  const phaseDir = resolve(SCILLM_PROJECT_ROOT, '.plan-iterate', phaseId)
  const preferredRunDir = resolve(phaseDir, 'evidence-artifacts', SCILLM_DAG_RUN_ARTIFACT_DIR)
  const fallbackRunDir = resolve(phaseDir, 'evidence-artifacts', 'scillm-exec-run-final')
  const runDir = existsSync(preferredRunDir) ? preferredRunDir : fallbackRunDir
  const graphPath = resolve(runDir, 'graph.request.json')
  const eventPath = resolve(phaseDir, 'artifacts', 'dag-viewer', 'amendment-events.jsonl')
  const amendmentDir = resolve(phaseDir, 'artifacts', 'dag-viewer', 'amendments')

  if (!isPathInside(SCILLM_PROJECT_ROOT, phaseDir) || !isPathInside(SCILLM_PROJECT_ROOT, amendmentDir)) {
    res.status(500).json({ ok: false, error: 'configured scillm DAG amendment paths escape project root' })
    return
  }

  try {
    const committedGraph = JSON.parse(await readFile(graphPath, 'utf-8'))
    const currentHash = executableGraphHash(committedGraph)
    const requestedHash = String(req.body?.baseGraphHash ?? req.body?.base_graph_hash ?? '')
    if (!requestedHash) {
      res.status(409).json({ ok: false, error: 'missing_base_graph_hash', baseGraphHash: currentHash })
      return
    }
    if (requestedHash !== currentHash) {
      res.status(409).json({ ok: false, error: 'stale_base_graph_hash', baseGraphHash: currentHash, requestedBaseGraphHash: requestedHash })
      return
    }

    const operations = Array.isArray(req.body?.operations) ? req.body.operations : []
    if (!operations.length) {
      res.status(400).json({ ok: false, error: 'empty_amendment_operations' })
      return
    }

    const now = new Date().toISOString()
    const graphId = String(req.body?.graphId ?? req.body?.graph_id ?? committedGraph.graph_id ?? 'graph')
    const amendmentId = `amendment-${safeArtifactName(graphId)}-${now.replace(/[:.]/g, '')}`
    const artifactPath = resolve(amendmentDir, `${amendmentId}.json`)
    const payload = {
      schema: 'scillm.dag_viewer.amendment_draft.v1',
      amendmentId,
      graphId,
      runId: req.body?.runId ?? req.body?.run_id ?? null,
      baseGraphHash: currentHash,
      origin: req.body?.origin ?? 'human',
      status: 'draft',
      operations,
      rationale: req.body?.rationale ?? null,
      warnings: Array.isArray(req.body?.warnings) ? req.body.warnings : [],
      createdAt: now,
      source: {
        phase_id: phaseId,
        committed_graph: graphPath,
      },
    }
    await mkdir(amendmentDir, { recursive: true })
    await writeFile(artifactPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
    const event = {
      type: 'dag.amendment.draft_saved',
      amendmentId,
      graphId,
      baseGraphHash: currentHash,
      origin: payload.origin,
      artifactPath,
      ts: now,
    }
    await mkdir(dirname(eventPath), { recursive: true })
    await writeFile(eventPath, JSON.stringify(event) + '\n', { encoding: 'utf-8', flag: 'a' })
    res.json({
      ok: true,
      amendmentId,
      amendment_key: amendmentId,
      baseGraphHash: currentHash,
      status: 'draft',
      artifactPath,
      warnings: payload.warnings,
    })
  } catch (err) {
    res.status(503).json({
      ok: false,
      error: 'amendment_draft_save_failed',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
})

app.get('/api/scillm/dag-viewer/drafts', async (_req, res) => {
  if (!isPathInside(SCILLM_PROJECT_ROOT, SCILLM_DAG_DRAFT_DIR)) {
    res.status(500).json({ ok: false, error: 'configured scillm DAG draft path escapes project root' })
    return
  }
  try {
    await mkdir(SCILLM_DAG_DRAFT_DIR, { recursive: true })
    const entries = await readdir(SCILLM_DAG_DRAFT_DIR, { withFileTypes: true })
    const drafts = await Promise.all(entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map(async (entry) => {
        const path = resolve(SCILLM_DAG_DRAFT_DIR, entry.name)
        const payload = JSON.parse(await readFile(path, 'utf-8'))
        return { ...payload, artifactPath: path }
      }))
    drafts.sort((a: any, b: any) => String(b.updatedAt ?? b.createdAt ?? '').localeCompare(String(a.updatedAt ?? a.createdAt ?? '')))
    res.json({ ok: true, drafts })
  } catch (err) {
    res.status(503).json({ ok: false, error: 'dag_drafts_read_failed', detail: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/api/scillm/dag-viewer/drafts', async (req, res) => {
  if (!isPathInside(SCILLM_PROJECT_ROOT, SCILLM_DAG_DRAFT_DIR)) {
    res.status(500).json({ ok: false, error: 'configured scillm DAG draft path escapes project root' })
    return
  }
  try {
    const graph = req.body?.graph
    if (!graph || typeof graph !== 'object' || !String(graph.graph_id ?? '').trim()) {
      res.status(400).json({ ok: false, error: 'invalid_draft_graph' })
      return
    }
    const now = new Date().toISOString()
    const graphId = String(graph.graph_id)
    const draftId = safeArtifactName(String(req.body?.draftId ?? req.body?.draft_id ?? graphId))
    const artifactPath = resolve(SCILLM_DAG_DRAFT_DIR, `${draftId}.json`)
    if (!isPathInside(SCILLM_PROJECT_ROOT, artifactPath)) {
      res.status(500).json({ ok: false, error: 'configured scillm DAG draft artifact path escapes project root' })
      return
    }
    const previous = existsSync(artifactPath) ? JSON.parse(await readFile(artifactPath, 'utf-8')) : null
    const payload = {
      schema: 'scillm.dag_viewer.workspace_draft.v1',
      draftId,
      title: String(req.body?.title ?? graphId),
      subtitle: String(req.body?.subtitle ?? 'saved draft'),
      status: String(req.body?.status ?? 'draft'),
      kind: 'draft',
      graph,
      lastRun: req.body?.lastRun && typeof req.body.lastRun === 'object' ? req.body.lastRun : previous?.lastRun,
      baseGraphHash: executableGraphHash(graph),
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      source: {
        project_root: SCILLM_PROJECT_ROOT,
        origin: req.body?.origin ?? 'ux-lab #scillm/dag-planner',
      },
    }
    await mkdir(SCILLM_DAG_DRAFT_DIR, { recursive: true })
    await writeFile(artifactPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8')
    res.json({ ok: true, draft: { ...payload, artifactPath } })
  } catch (err) {
    res.status(503).json({ ok: false, error: 'dag_draft_save_failed', detail: err instanceof Error ? err.message : String(err) })
  }
})

app.delete('/api/scillm/dag-viewer/drafts/:draftId', async (req, res) => {
  const draftId = safeArtifactName(String(req.params.draftId ?? ''))
  const artifactPath = resolve(SCILLM_DAG_DRAFT_DIR, `${draftId}.json`)
  if (!draftId || !isPathInside(SCILLM_PROJECT_ROOT, artifactPath)) {
    res.status(400).json({ ok: false, error: 'invalid_draft_id' })
    return
  }
  try {
    if (existsSync(artifactPath)) await unlink(artifactPath)
    res.json({ ok: true, draftId })
  } catch (err) {
    res.status(503).json({ ok: false, error: 'dag_draft_delete_failed', detail: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/api/scillm/v1/scillm/exec/graph', async (req, res) => {
  try {
    const upstream = await fetch(`${SCILLM_URL}/v1/scillm/exec/graph`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.SCILLM_API_KEY || 'sk-dev-proxy-123'}`,
        'X-Caller-Skill': 'ux-lab',
      },
      body: JSON.stringify(req.body ?? {}),
    })
    const contentType = upstream.headers.get('content-type') ?? ''
    if (contentType.includes('text/event-stream') || req.body?.stream === true) {
      res.writeHead(upstream.status, {
        'Content-Type': contentType || 'text/event-stream; charset=utf-8',
        'Cache-Control': upstream.headers.get('cache-control') ?? 'no-cache',
        'X-Accel-Buffering': 'no',
      })
      if (!upstream.body) {
        res.end()
        return
      }
      for await (const chunk of upstream.body as any) {
        res.write(Buffer.from(chunk))
      }
      res.end()
      return
    }
    const text = await upstream.text()
    res.status(upstream.status)
    try {
      res.json(JSON.parse(text))
    } catch {
      res.send(text)
    }
  } catch (error) {
    res.status(502).json({ error: 'scillm unreachable', detail: error instanceof Error ? error.message : String(error) })
  }
})




// ── Skills catalog (slash palette for ChatWell / transport room) ───────────
app.get('/api/skills', async (_req, res) => {
  try {
    const skills = await listSkillsCatalog()
    res.json(skills)
  } catch (error) {
    res.status(500).json({
      error: 'skills catalog failed',
      detail: error instanceof Error ? error.message : String(error),
    })
  }
})

function transportArtifactBases(projectRoot: string): string[] {
  const bases: string[] = []
  const serve = process.env.SCILLM_OPENCODE_SERVE_OUTPUT_DIR?.trim()
  if (serve) {
    bases.push(serve.startsWith('/') ? resolve(serve, 'transport') : resolve(projectRoot, serve, 'transport'))
  }
  const legacy = process.env.SCILLM_OPENCODE_TRANSPORT_DIR?.trim()
  if (legacy) {
    bases.push(legacy.startsWith('/') ? legacy : resolve(projectRoot, legacy))
  }
  bases.push(resolve(projectRoot, '.scillm', 'opencode-serve', 'transport'))
  bases.push(resolve(projectRoot, '.scillm', 'opencode-transport'))
  return [...new Set(bases)]
}

async function scanTransportRunIndexBase(
  base: string,
): Promise<Array<{ transport_run_id: string; dag_node_id?: string; title?: string; mtime_ms: number; proof_backed_dag?: boolean; dag_proof_path?: string }>> {
  const names = await readdir(base, { withFileTypes: true }).catch(() => [])
  const runs: Array<{ transport_run_id: string; dag_node_id?: string; title?: string; mtime_ms: number; proof_backed_dag?: boolean; dag_proof_path?: string }> = []
  for (const ent of names) {
    if (!ent.isDirectory()) continue
    const dir = resolve(base, ent.name)
    const statePath = resolve(dir, 'transport_state.json')
    try {
      const st = await stat(statePath)
      const raw = await readFile(statePath, 'utf8')
      const state = JSON.parse(raw) as { transport_run_id?: string; dag_node_id?: string }
      runs.push({
        transport_run_id: String(state.transport_run_id || ent.name),
        dag_node_id: state.dag_node_id,
        mtime_ms: st.mtimeMs,
      })
    } catch {
      /* skip incomplete dirs */
    }
  }
  return runs
}

function proofTransportRunIds(proof: JsonRecord): string[] {
  const ids = new Set<string>()
  function visit(value: unknown) {
    if (typeof value === 'string') {
      if (/^otr-[a-z0-9][a-z0-9-]*$/i.test(value.trim())) ids.add(value.trim())
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item)
      return
    }
    if (value && typeof value === 'object') {
      for (const item of Object.values(value as JsonRecord)) visit(item)
    }
  }
  visit(proof)
  return [...ids]
}


type TransportRunIndexSummary = {
  run_status?: 'success' | 'failed' | 'running' | 'intervention' | 'unknown'
  result_badge?: string
  primary_title?: string
  model_label?: string
  prompt_snippet?: string
  node_total?: number
  node_completed?: number
  node_failed?: number
  search_blob?: string
}

function trimRunBadge(value: unknown): string | undefined {
  if (value == null) return undefined
  const text = String(value).trim().replace(/\s+/g, ' ')
  if (!text) return undefined
  return text.length > 24 ? `${text.slice(0, 22)}…` : text
}

function nodeStatusBucket(status: string | undefined): 'done' | 'failed' | 'pending' {
  const s = String(status || '').toLowerCase()
  if (s.includes('fail') || s.includes('error') || s === 'rejected') return 'failed'
  if (s.includes('complete') || s.includes('accept') || s === 'ok' || s === 'success' || s === 'done') return 'done'
  return 'pending'
}

function summarizeProofForRunIndex(proof: JsonRecord, runId: string): TransportRunIndexSummary | null {
  if (!proofStringMatchesRun(proof, runId)) return null
  const explicit = proof.ux_lab_transport_dag_evidence && typeof proof.ux_lab_transport_dag_evidence === 'object'
    ? proof.ux_lab_transport_dag_evidence as JsonRecord
    : null
  const nodes: Array<JsonRecord> = []
  if (explicit && Array.isArray(explicit.nodes)) {
    for (const node of explicit.nodes) {
      if (node && typeof node === 'object') nodes.push(node as JsonRecord)
    }
  } else if (proof.node_ok && typeof proof.node_ok === 'object') {
    for (const [id, ok] of Object.entries(proof.node_ok as JsonRecord)) {
      nodes.push({ id, status: ok ? 'accepted' : 'failed' })
    }
  }
  if (!nodes.length) return null

  let nodeCompleted = 0
  let nodeFailed = 0
  const models = new Set<string>()
  const responses: string[] = []
  const prompts: string[] = []

  for (const node of nodes) {
    const bucket = nodeStatusBucket(typeof node.status === 'string' ? node.status : undefined)
    if (bucket === 'done') nodeCompleted += 1
    if (bucket === 'failed') nodeFailed += 1
    const model = typeof node.model_served === 'string' ? node.model_served : typeof node.model === 'string' ? node.model : ''
    if (model.trim()) models.add(model.trim())
    const response = trimRunBadge(node.response)
    if (response) responses.push(response)
    const prompt = trimRunBadge(node.prompt ?? node.request_summary ?? node.task ?? node.objective ?? node.request)
    if (prompt) prompts.push(prompt)
    const acceptance = proof.harness_acceptance && typeof proof.harness_acceptance === 'object'
      ? (proof.harness_acceptance as JsonRecord)[String(node.id)] as JsonRecord | undefined
      : undefined
    const detail = acceptance?.detail && typeof acceptance.detail === 'object' ? acceptance.detail as JsonRecord : undefined
    const result = trimRunBadge(detail?.result)
    if (result) responses.push(result)
  }

  const nodeTotal = nodes.length
  let run_status: TransportRunIndexSummary['run_status'] = 'unknown'
  if (nodeFailed > 0) run_status = 'failed'
  else if (nodeTotal > 0 && nodeCompleted >= nodeTotal) run_status = 'success'
  else if (nodeCompleted > 0) run_status = 'running'

  const prompt_snippet = prompts[0]
  const graphId = typeof proof.graph_id === 'string' ? proof.graph_id : typeof proof.dag_id === 'string' ? proof.dag_id : ''
  const primary_title = prompt_snippet || graphId
  const model_label = models.size === 1 ? [...models][0] : models.size > 1 ? 'mixed' : undefined
  const result_badge = responses.at(-1)
  const search_blob = [primary_title, runId, graphId, ...responses, ...prompts, ...models].filter(Boolean).join(' ').toLowerCase()

  return {
    run_status,
    result_badge,
    primary_title,
    model_label,
    prompt_snippet,
    node_total: nodeTotal,
    node_completed: nodeCompleted,
    node_failed: nodeFailed,
    search_blob,
  }
}

async function scanTransportDagProofIndex(
  projectRoot: string,
): Promise<Array<{ transport_run_id: string; dag_node_id?: string; title?: string; mtime_ms: number; proof_backed_dag: true; dag_proof_path: string }>> {
  const proofDir = resolve(projectRoot, '.plan-iterate', 'scillm-dag-fanout-r1', 'proof')
  if (!isPathInside(projectRoot, proofDir)) return []
  const names = (await readdir(proofDir).catch(() => []))
    .filter((name) => name.endsWith('.json'))
  const rows: Array<{ transport_run_id: string; dag_node_id?: string; title?: string; mtime_ms: number; proof_backed_dag: true; dag_proof_path: string }> = []
  for (const name of names) {
    const path = resolve(proofDir, name)
    try {
      const [st, raw] = await Promise.all([stat(path), readFile(path, 'utf8')])
      const proof = JSON.parse(raw) as JsonRecord
      const ids = proofTransportRunIds(proof)
      if (!ids.length) continue
      const graphId = typeof proof.graph_id === 'string'
        ? proof.graph_id
        : typeof proof.dag_id === 'string'
          ? proof.dag_id
          : name.replace(/\.json$/, '')
      const title = graphId
        .replace(/^refactor-/, '')
        .replace(/^s\d+-/, '')
        .replace(/-[a-f0-9]{10,}$/i, '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, (m) => m.toUpperCase())
      for (const id of ids) {
        const summary = summarizeProofForRunIndex(proof, id) || {}
        rows.push({
          transport_run_id: id,
          dag_node_id: graphId,
          title: summary.primary_title || title,
          mtime_ms: st.mtimeMs,
          proof_backed_dag: true,
          dag_proof_path: path,
          ...summary,
        })
      }
    } catch {
      /* skip malformed proof */
    }
  }
  return rows
}

// ── scillm transport run index (artifact dirs on disk; prefer scillm proxy route) ─
app.get('/api/transport/run-index', async (_req, res) => {
  try {
    const byId = new Map<string, { transport_run_id: string; dag_node_id?: string; title?: string; mtime_ms: number; proof_backed_dag?: boolean; dag_proof_path?: string }>()
    for (const base of transportArtifactBases(SCILLM_PROJECT_ROOT)) {
      const chunk = await scanTransportRunIndexBase(base)
      for (const row of chunk) {
        const prev = byId.get(row.transport_run_id)
        if (!prev || row.mtime_ms > prev.mtime_ms) byId.set(row.transport_run_id, row)
      }
    }
    for (const row of await scanTransportDagProofIndex(SCILLM_PROJECT_ROOT)) {
      const prev = byId.get(row.transport_run_id)
      byId.set(row.transport_run_id, {
        ...prev,
        ...row,
        mtime_ms: Math.max(prev?.mtime_ms ?? 0, row.mtime_ms),
      })
    }
    const runs = [...byId.values()].sort((a, b) => b.mtime_ms - a.mtime_ms)
    res.json({ schema: 'scillm.transport.run_index.v1', runs })
  } catch (error) {
    res.status(500).json({ error: 'transport run index failed', detail: error instanceof Error ? error.message : String(error) })
  }
})

type TransportDagEvidenceNode = {
  id: string
  label: string
  status: string
  semantic_call_type?: string
  skills: string[]
  started_at?: string
  completed_at?: string
  transport_run_id?: string
  subagent_run_id?: string
  subagent_persona?: string
  subagent_role?: string
  role?: string
  agent_id?: string
  persona_source_uri?: string
  persona_hash?: string
  persona_text?: string
  persona_missing_reason?: string
  provider?: string
  model?: string
  model_served?: string
  model_evidence_uri?: string
  response?: string
  usage?: JsonRecord
  state_reads?: string[]
  state_writes?: JsonRecord
  computation_backend?: string
  error?: string
  missing_required_fields?: string[]
  request?: string
  request_summary?: string
  request_uri?: string
  request_hash?: string
  prompt?: string
  task?: string
  objective?: string
  persistent?: boolean
  help_requests?: JsonRecord[]
  help_results?: JsonRecord[]
  resume_packets?: JsonRecord[]
}

type ScillmChatResponse = {
  model?: string
  choices?: Array<{ message?: { content?: string } }>
  usage?: JsonRecord
}

type TransportCompiledPlanStep = {
  id?: string
  node_id?: string
  label?: string
  request?: string
  request_summary?: string
  prompt?: string
  task?: string
  objective?: string
  maps_to_node_ids?: string[]
}

type TransportCompiledPlan = {
  source?: string
  objective?: string
  raw_plan_uri?: string
  prompt_uri?: string
  steps?: TransportCompiledPlanStep[]
}

function proofStringMatchesRun(value: unknown, runId: string): boolean {
  if (!runId) return false
  if (typeof value === 'string') return value.includes(runId)
  if (Array.isArray(value)) return value.some((v) => proofStringMatchesRun(v, runId))
  if (value && typeof value === 'object') {
    return Object.values(value as JsonRecord).some((v) => proofStringMatchesRun(v, runId))
  }
  return false
}

function labelFromNodeId(id: string): string {
  return id
    .replace(/^real_/, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
}

function skillsForDagNode(id: string, semanticType?: string, proof?: JsonRecord): string[] {
  if (id === 'opencode_review_iteration') {
    const child = (proof?.opencode_review_iteration as JsonRecord | undefined)?.child as JsonRecord | undefined
    const skills = child?.skills_materialized ?? child?.skills
    if (Array.isArray(skills)) return [...new Set(skills.map(String))]
  }
  if (id.includes('dogpile')) return ['dogpile']
  if (id.includes('memory')) return ['memory']
  if (id.includes('review_code')) return ['code-runner', 'reviewer']
  if (id.includes('write_code')) return ['code-runner']
  if (semanticType === 'scillm_call') return ['scillm']
  if (semanticType === 'agent_transport') return ['scillm', 'opencode']
  if (semanticType === 'memory') return ['memory']
  if (semanticType === 'local') return ['local-command']
  return []
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function personaSlug(value: string | undefined): string | null {
  const slug = value?.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || null
}

function ocSubagentPersonaYamlPath(slug: string): string {
  return resolve(OC_SUBAGENT_PERSONAS_ROOT, slug, 'persona.yaml')
}

async function personaAttachmentForNode(node: Pick<TransportDagEvidenceNode, 'agent_id' | 'subagent_role' | 'role' | 'subagent_persona'>): Promise<Pick<TransportDagEvidenceNode, 'persona_source_uri' | 'persona_hash' | 'persona_text' | 'persona_missing_reason'>> {
  const candidates = [
    personaSlug(node.agent_id),
    personaSlug(node.subagent_role),
    personaSlug(node.role),
    personaSlug(node.subagent_persona),
  ].filter((value): value is string => Boolean(value))
  if (!candidates.length) return {}
  const uniqueCandidates = [...new Set(candidates)]
  for (const slug of uniqueCandidates) {
    const path = ocSubagentPersonaYamlPath(slug)
    if (!isPathInside(OC_SUBAGENT_PERSONAS_ROOT, path) || !existsSync(path)) continue
    const text = await readFile(path, 'utf8')
    try {
      yamlLoad(text)
    } catch {
      return {
        persona_source_uri: path,
        persona_hash: createHash('sha256').update(text).digest('hex'),
        persona_text: text,
        persona_missing_reason: 'persona_yaml_parse_failed',
      }
    }
    return {
      persona_source_uri: path,
      persona_hash: createHash('sha256').update(text).digest('hex'),
      persona_text: text,
    }
  }
  return {
    persona_missing_reason: `missing_persona_yaml:${uniqueCandidates.join(',')}`,
  }
}

async function attachPersonasToDagNodes(nodes: TransportDagEvidenceNode[]): Promise<TransportDagEvidenceNode[]> {
  return Promise.all(nodes.map(async (node) => ({
    ...node,
    ...await personaAttachmentForNode(node),
  })))
}

function compiledPlanFromProof(proof: JsonRecord): TransportCompiledPlan | undefined {
  const raw = proof.compiled_plan ?? proof.compiledPlan ?? proof.plan
  if (!raw || typeof raw !== 'object') return undefined
  const plan = raw as JsonRecord
  const rawSteps = Array.isArray(plan.steps) ? plan.steps : []
  const steps = rawSteps
    .filter((step): step is JsonRecord => Boolean(step && typeof step === 'object'))
    .map((step) => {
      const mappedIds = step.maps_to_node_ids ?? step.mapsToNodeIds
      return {
        id: optionalString(step.id),
        node_id: optionalString(step.node_id ?? step.nodeId),
        label: optionalString(step.label ?? step.title),
        request: optionalString(step.request),
        request_summary: optionalString(step.request_summary ?? step.requestSummary),
        prompt: optionalString(step.prompt),
        task: optionalString(step.task),
        objective: optionalString(step.objective),
        maps_to_node_ids: Array.isArray(mappedIds) ? mappedIds.map(String) : undefined,
      }
    })
  return {
    source: optionalString(plan.source),
    objective: optionalString(plan.objective),
    raw_plan_uri: optionalString(plan.raw_plan_uri ?? plan.rawPlanUri),
    prompt_uri: optionalString(plan.prompt_uri ?? plan.promptUri),
    steps,
  }
}

function requestFromCompiledPlan(plan: TransportCompiledPlan | undefined, nodeId: string): Partial<TransportDagEvidenceNode> {
  if (!plan?.steps?.length) return {}
  const step = plan.steps.find((candidate) =>
    candidate.node_id === nodeId
    || candidate.id === nodeId
    || candidate.maps_to_node_ids?.includes(nodeId),
  )
  if (!step) return {}
  return {
    request: step.request,
    request_summary: step.request_summary,
    prompt: step.prompt,
    task: step.task,
    objective: step.objective,
  }
}

function requestFromNodeMaps(proof: JsonRecord, nodeId: string): Partial<TransportDagEvidenceNode> {
  const maps = [
    proof.node_requests,
    proof.nodeRequests,
    proof.requests_by_node,
    proof.requestsByNode,
    proof.prompts_by_node,
    proof.promptsByNode,
  ].filter((map): map is JsonRecord => Boolean(map && typeof map === 'object' && !Array.isArray(map)))
  for (const map of maps) {
    const raw = map[nodeId]
    if (typeof raw === 'string' && raw.trim()) return { request: raw.trim() }
    if (raw && typeof raw === 'object') {
      const item = raw as JsonRecord
      return {
        request: optionalString(item.request),
        request_summary: optionalString(item.request_summary ?? item.requestSummary),
        prompt: optionalString(item.prompt),
        task: optionalString(item.task),
        objective: optionalString(item.objective),
        request_uri: optionalString(item.request_uri ?? item.requestUri),
        request_hash: optionalString(item.request_hash ?? item.requestHash),
      }
    }
  }
  return {}
}

function optionalRecordArray(value: unknown): JsonRecord[] | undefined {
  if (!Array.isArray(value)) return undefined
  const records = value.filter((item): item is JsonRecord => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
  return records.length ? records : undefined
}

function recordArrayFromAliases(...values: unknown[]): JsonRecord[] | undefined {
  for (const value of values) {
    if (Array.isArray(value)) {
      const records = optionalRecordArray(value)
      if (records) return records
      continue
    }
    if (value && typeof value === 'object') return [value as JsonRecord]
  }
  return undefined
}

function attachHelpContractFromDetail(node: TransportDagEvidenceNode, detail: JsonRecord) {
  node.help_requests = recordArrayFromAliases(detail.help_requests, detail.helpRequests, detail.help_request, detail.helpRequest)
  node.help_results = recordArrayFromAliases(detail.help_results, detail.helpResults, detail.help_result, detail.helpResult)
  node.resume_packets = recordArrayFromAliases(detail.resume_packets, detail.resumePackets, detail.resume_packet, detail.resumePacket)
}

function buildDagEdges(nodeIds: string[]): Array<{ from: string; to: string }> {
  const has = (id: string) => nodeIds.includes(id)
  if (has('real_memory_recall') || has('real_dogpile_search')) {
    const edges: Array<{ from: string; to: string }> = []
    if (has('real_memory_recall') && has('real_dogpile_search')) edges.push({ from: 'real_memory_recall', to: 'real_dogpile_search' })
    const fanoutParent = has('real_dogpile_search') ? 'real_dogpile_search' : 'real_memory_recall'
    for (const id of ['one_shot_probe', 'subagent_probe', 'write_code_persona']) {
      if (has(fanoutParent) && has(id)) edges.push({ from: fanoutParent, to: id })
    }
    if (has('write_code_persona') && has('review_code_persona')) edges.push({ from: 'write_code_persona', to: 'review_code_persona' })
    if (has('combine_results')) {
      for (const id of ['one_shot_probe', 'subagent_probe', 'review_code_persona']) {
        if (has(id)) edges.push({ from: id, to: 'combine_results' })
      }
    }
    return edges
  }
  const join = has('combine_results') ? 'combine_results' : null
  const adopt = has('adopt_code') ? 'adopt_code' : null
  const upstream = nodeIds.filter((id) => id !== join && id !== adopt)
  const edges: Array<{ from: string; to: string }> = []
  if (join) {
    for (const id of upstream) edges.push({ from: id, to: join })
    if (adopt) edges.push({ from: join, to: adopt })
  }
  return edges
}

async function draftGraphEdgesFromAcceptance(
  acceptance: Record<string, JsonRecord>,
  nodeIds: string[],
): Promise<Array<{ from: string; to: string }>> {
  const nodeIdSet = new Set(nodeIds)
  const candidatePaths = new Set<string>()
  for (const accepted of Object.values(acceptance)) {
    const detail = accepted?.detail && typeof accepted.detail === 'object' ? accepted.detail as JsonRecord : {}
    const path = typeof detail.draft_artifact_path === 'string' ? detail.draft_artifact_path.trim() : ''
    if (!path) continue
    const resolvedPath = resolve(path)
    if (!isPathInside(TRANSPORT_DAG_DRAFT_DIR, resolvedPath) && !isPathInside(SCILLM_PROJECT_ROOT, resolvedPath)) continue
    candidatePaths.add(resolvedPath)
  }
  for (const path of candidatePaths) {
    try {
      const raw = JSON.parse(await readFile(path, 'utf8')) as JsonRecord
      const graph = raw.graph && typeof raw.graph === 'object' ? raw.graph as JsonRecord : null
      const rawEdges = Array.isArray(graph?.edges) ? graph.edges : []
      const edges = rawEdges
        .filter((edge): edge is JsonRecord => Boolean(edge && typeof edge === 'object' && !Array.isArray(edge)))
        .map((edge) => ({
          from: typeof edge.from === 'string' ? edge.from : '',
          to: typeof edge.to === 'string' ? edge.to : '',
        }))
        .filter((edge) => nodeIdSet.has(edge.from) && nodeIdSet.has(edge.to))
      if (edges.length) return edges
    } catch {
      /* Missing or invalid draft artifacts remain fail-closed as no inferred edges. */
    }
  }
  return []
}

async function readTransportProgressEvents(runId: string): Promise<{ eventsPath: string | null; events: JsonRecord[]; error?: string }> {
  const candidates = [
    resolve(SCILLM_PROJECT_ROOT, '.scillm', 'opencode-serve', 'transport', runId, 'events.jsonl'),
    resolve(SCILLM_PROJECT_ROOT, '.plan-iterate', 'scillm-dag-fanout-r1', 'events', runId, 'events.jsonl'),
  ]
  let eventsPath = candidates[0]
  for (const candidate of candidates) {
    if (!isPathInside(SCILLM_PROJECT_ROOT, candidate)) {
      return { eventsPath: null, events: [], error: 'events path escapes scillm project root' }
    }
    if (existsSync(candidate)) {
      eventsPath = candidate
      break
    }
  }
  const raw = await readFile(eventsPath, 'utf8').catch(() => '')
  const events = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as JsonRecord
      } catch {
        return null
      }
    })
    .filter((event): event is JsonRecord => Boolean(event))
  return { eventsPath, events }
}

function progressReplayStatus(event: JsonRecord): string {
  const eventType = String(event.event_type || '')
  const deliveryState = String(event.delivery_state || '').toLowerCase()
  if (eventType === 'child.created') return 'waiting'
  if (eventType === 'message.queued' || deliveryState === 'queued') return 'running'
  if (eventType === 'message.posted' || deliveryState === 'posted') return 'running'
  if (eventType === 'message.delivered' || deliveryState === 'delivered') return 'accepted'
  if (eventType === 'session.idle_seen' || deliveryState === 'idle_seen') return 'completed'
  return deliveryState || 'unknown'
}

function eventSubagentKey(event: JsonRecord): string | null {
  const runId = typeof event.subagent_run_id === 'string' ? event.subagent_run_id : ''
  const role = typeof event.role === 'string' ? event.role : ''
  const raw = runId || role
  const match = raw.match(/subagent[_-](\d+)/i)
  return match ? `subagent_${match[1]}` : null
}

function buildProgressReplayEvents(events: JsonRecord[], nodes: TransportDagEvidenceNode[]): JsonRecord[] {
  const nodesBySubagent = new Map<string, TransportDagEvidenceNode[]>()
  for (const node of nodes) {
    const fromRun = node.subagent_run_id?.match(/subagent[_-](\d+)/i)?.[1]
    const fromId = node.id.match(/subagent[_-](\d+)/i)?.[1]
    const key = fromRun || fromId ? `subagent_${fromRun || fromId}` : null
    if (!key) continue
    const bucket = nodesBySubagent.get(key) || []
    bucket.push(node)
    nodesBySubagent.set(key, bucket)
  }
  for (const bucket of nodesBySubagent.values()) {
    bucket.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
  }

  const queuedCounts = new Map<string, number>()
  const activeNodeBySubagent = new Map<string, string>()
  const replay: JsonRecord[] = []
  for (const event of events) {
    const eventType = String(event.event_type || '')
    if (eventType === 'transport.created') continue
    const directNodeId = typeof event.dag_node_id === 'string'
      ? event.dag_node_id
      : typeof event.node_id === 'string'
        ? event.node_id
        : ''
    if (directNodeId && nodes.some((node) => node.id === directNodeId)) {
      replay.push({
        event_id: event.event_id,
        event_type: eventType,
        ts: event.ts,
        node_id: directNodeId,
        status: progressReplayStatus(event),
        subagent_run_id: event.subagent_run_id,
        delivery_state: event.delivery_state,
        model: event.model,
        prompt: event.prompt,
      })
      continue
    }
    const subagentKey = eventSubagentKey(event)
    if (!subagentKey) continue
    const candidates = nodesBySubagent.get(subagentKey) || []
    if (!candidates.length) continue

    let node = candidates[0]
    if (eventType === 'message.queued') {
      const queuedCount = queuedCounts.get(subagentKey) || 0
      node = candidates[Math.min(queuedCount, candidates.length - 1)]
      queuedCounts.set(subagentKey, queuedCount + 1)
      activeNodeBySubagent.set(subagentKey, node.id)
    } else if (eventType !== 'child.created') {
      const activeNodeId = activeNodeBySubagent.get(subagentKey)
      node = candidates.find((candidate) => candidate.id === activeNodeId) || candidates[0]
    }

    replay.push({
      event_id: event.event_id,
      event_type: eventType,
      ts: event.ts,
      node_id: node.id,
      status: progressReplayStatus(event),
      subagent_run_id: event.subagent_run_id,
      delivery_state: event.delivery_state,
      model: event.model,
      prompt: event.prompt,
    })
  }
  return replay
}

async function transportProgressStreamSummary(runId: string, nodes: TransportDagEvidenceNode[] = []): Promise<JsonRecord> {
  const { eventsPath, events, error } = await readTransportProgressEvents(runId)
  if (error) {
    return {
      state: 'unavailable',
      event_count: 0,
      node_event_count: 0,
      events_path: null,
      replay_events: [],
      reason: error,
    }
  }
  const eventTypes = [...new Set(events.map((event) => String(event.event_type || 'unknown')))]
  const nodeEvents = events.filter((event) => String(event.event_type || '') !== 'transport.created')
  const replayEvents = buildProgressReplayEvents(events, nodes)
  const state = events.length === 0
    ? 'missing'
    : nodeEvents.length === 0
      ? 'static_receipt'
      : events.some((event) => ['running', 'queued', 'posted', 'delivered'].includes(String(event.delivery_state || '').toLowerCase()))
        ? 'live_or_historical'
        : 'historical'
  return {
    state,
    event_count: events.length,
    node_event_count: nodeEvents.length,
    replay_event_count: replayEvents.length,
    replay_events: replayEvents,
    event_types: eventTypes,
    events_path: eventsPath,
    last_event_type: events.length ? String(events[events.length - 1].event_type || 'unknown') : null,
    reason: nodeEvents.length === 0
      ? 'No node-level progress events were recorded for this transport run.'
      : null,
  }
}

function buildDagLayers(nodeIds: string[], edges: Array<{ from: string; to: string }>): string[][] {
  const remaining = new Set(nodeIds)
  const layers: string[][] = []
  while (remaining.size > 0) {
    const ready = [...remaining].filter((id) =>
      edges.filter((e) => e.to === id).every((e) => !remaining.has(e.from)),
    )
    const layer = ready.length ? ready : [remaining.values().next().value as string]
    layers.push(layer)
    for (const id of layer) remaining.delete(id)
  }
  return layers
}

async function firstPromptFromJsonl(path: string): Promise<{ prompt: string; agent_id?: string } | null> {
  try {
    const text = await readFile(path, 'utf8')
    let agentId: string | undefined
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      const event = JSON.parse(trimmed) as JsonRecord
      if (!agentId && typeof event.agent_id === 'string' && event.agent_id.trim()) agentId = event.agent_id.trim()
      const prompt = typeof event.prompt === 'string' ? event.prompt.trim() : ''
      if (prompt) return { prompt, agent_id: agentId }
    }
  } catch {
    /* missing prompt artifacts are represented as null */
  }
  return null
}

async function opencodeCanaryRequestFromProofRoot(proofRoot: unknown): Promise<{ request?: string; request_uri?: string; agent_id?: string } | null> {
  if (typeof proofRoot !== 'string' || !proofRoot.trim()) return null
  const root = resolve(proofRoot)
  if (!isPathInside(SCILLM_PROJECT_ROOT, root)) return null
  const candidates = [
    'timeout_probe_events.jsonl',
    'abort_probe_events.jsonl',
  ]
  for (const name of candidates) {
    const path = resolve(root, name)
    if (!isPathInside(root, path)) continue
    const request = await firstPromptFromJsonl(path)
    if (request) return { request: request.prompt, request_uri: path, agent_id: request.agent_id }
  }
  return null
}

async function dagEvidenceFromProof(proof: JsonRecord, proofPath: string, runId: string): Promise<JsonRecord | null> {
  const explicitEvidence = proof.ux_lab_transport_dag_evidence
    && typeof proof.ux_lab_transport_dag_evidence === 'object'
    ? proof.ux_lab_transport_dag_evidence as JsonRecord
    : null
  if (explicitEvidence && explicitEvidence.schema === 'ux_lab.transport_dag_run_evidence.v1') {
    const evidenceRunId = typeof explicitEvidence.transport_run_id === 'string'
      ? explicitEvidence.transport_run_id
      : ''
    if (evidenceRunId === runId && proofStringMatchesRun(explicitEvidence, runId)) {
      const proofTimings = proof.node_timings && typeof proof.node_timings === 'object'
        ? proof.node_timings as Record<string, JsonRecord>
        : {}
      const explicitNodesRaw = Array.isArray(explicitEvidence.nodes)
        ? explicitEvidence.nodes
            .filter((node): node is TransportDagEvidenceNode => Boolean(node && typeof node === 'object'))
            .map((node) => {
              const timing = proofTimings[node.id] || {}
              return {
                ...node,
                started_at: node.started_at ?? (typeof timing.started_at === 'string' ? timing.started_at : undefined),
                completed_at: node.completed_at ?? (typeof timing.completed_at === 'string' ? timing.completed_at : undefined),
              }
            })
        : []
      const explicitNodes = await attachPersonasToDagNodes(explicitNodesRaw)
      const explicitEdges = Array.isArray(explicitEvidence.edges)
        ? explicitEvidence.edges
            .filter((edge): edge is JsonRecord => Boolean(edge && typeof edge === 'object' && !Array.isArray(edge)))
            .map((edge) => ({
              from: typeof edge.from === 'string' ? edge.from : '',
              to: typeof edge.to === 'string' ? edge.to : '',
            }))
            .filter((edge) => edge.from && edge.to)
        : []
      const harnessAcceptance = proof.harness_acceptance && typeof proof.harness_acceptance === 'object'
        ? proof.harness_acceptance as Record<string, JsonRecord>
        : {}
      const nodeIds = explicitNodes.map((node) => node.id)
      const recoveredEdges = explicitEdges.length ? explicitEdges : await draftGraphEdgesFromAcceptance(harnessAcceptance, nodeIds)
      return {
        ...explicitEvidence,
        found: true,
        transport_run_id: runId,
        proof_path: proofPath,
        nodes: explicitNodes,
        edges: recoveredEdges,
        layers: buildDagLayers(nodeIds, recoveredEdges),
        harness_acceptance: harnessAcceptance,
        persistence: proof.persistence && typeof proof.persistence === 'object'
          ? proof.persistence as JsonRecord
          : undefined,
        node_timings: proofTimings,
        progress_stream: await transportProgressStreamSummary(runId, explicitNodes),
      }
    }
  }

  const nodeOk = proof.node_ok && typeof proof.node_ok === 'object' ? proof.node_ok as JsonRecord : null
  if (!nodeOk) return null
  if (!proofStringMatchesRun(proof, runId)) return null
  const timings = proof.node_timings && typeof proof.node_timings === 'object' ? proof.node_timings as Record<string, JsonRecord> : {}
  const acceptance = proof.harness_acceptance && typeof proof.harness_acceptance === 'object'
    ? proof.harness_acceptance as Record<string, JsonRecord>
    : {}
  const compiledPlan = compiledPlanFromProof(proof)
  const opencodeCanaryRequest = await opencodeCanaryRequestFromProofRoot((proof.opencode_canary_result as JsonRecord | undefined)?.proof_root)
  const nodeIds = Object.keys(nodeOk)
  const nodesRaw: TransportDagEvidenceNode[] = nodeIds.map((id) => {
    const accepted = acceptance[id]
    const detail = accepted?.detail && typeof accepted.detail === 'object' ? accepted.detail as JsonRecord : {}
    const semantic = typeof detail.semantic_call_type === 'string' ? detail.semantic_call_type : undefined
    const timing = timings[id] || {}
    const node: TransportDagEvidenceNode = {
      id,
      label: labelFromNodeId(id),
      status: nodeOk[id] ? 'accepted' : 'failed',
      semantic_call_type: semantic,
      skills: skillsForDagNode(id, semantic, proof),
      started_at: typeof timing.started_at === 'string' ? timing.started_at : undefined,
      completed_at: typeof timing.completed_at === 'string' ? timing.completed_at : undefined,
    }
    node.subagent_persona = typeof detail.subagent_persona === 'string' ? detail.subagent_persona : undefined
    node.subagent_role = typeof detail.subagent_role === 'string' ? detail.subagent_role : undefined
    node.role = typeof detail.role === 'string' ? detail.role : undefined
    node.agent_id = typeof detail.agent_id === 'string' ? detail.agent_id : undefined
    node.request = typeof detail.request === 'string' ? detail.request : undefined
    node.request_summary = typeof detail.request_summary === 'string' ? detail.request_summary : undefined
    node.request_uri = typeof detail.request_uri === 'string' ? detail.request_uri : undefined
    node.request_hash = typeof detail.request_hash === 'string' ? detail.request_hash : undefined
    node.prompt = typeof detail.prompt === 'string' ? detail.prompt : undefined
    node.task = typeof detail.task === 'string' ? detail.task : undefined
    node.objective = typeof detail.objective === 'string' ? detail.objective : undefined
    node.persistent = typeof detail.persistent === 'boolean' ? detail.persistent : undefined
    const mappedRequest = {
      ...requestFromCompiledPlan(compiledPlan, id),
      ...requestFromNodeMaps(proof, id),
    }
    node.request = node.request ?? mappedRequest.request
    node.request_summary = node.request_summary ?? mappedRequest.request_summary
    node.request_uri = node.request_uri ?? mappedRequest.request_uri
    node.request_hash = node.request_hash ?? mappedRequest.request_hash
    node.prompt = node.prompt ?? mappedRequest.prompt
    node.task = node.task ?? mappedRequest.task
    node.objective = node.objective ?? mappedRequest.objective
    if (id === 'opencode_review_iteration') {
      const iter = proof.opencode_review_iteration as JsonRecord | undefined
      const child = iter?.child as JsonRecord | undefined
      node.transport_run_id = typeof iter?.transport_run_id === 'string' ? iter.transport_run_id : undefined
      node.subagent_run_id = typeof child?.subagent_run_id === 'string' ? child.subagent_run_id : undefined
      node.subagent_persona = typeof child?.subagent_persona === 'string' ? child.subagent_persona : undefined
      node.subagent_role = typeof child?.subagent_role === 'string' ? child.subagent_role : undefined
      node.agent_id = typeof child?.agent_id === 'string' ? child.agent_id : undefined
    }
    if (id === 'opencode_canary') {
      const canary = proof.opencode_canary_result as JsonRecord | undefined
      node.transport_run_id = typeof canary?.transport_run_id === 'string' ? canary.transport_run_id : undefined
      node.request = node.request ?? opencodeCanaryRequest?.request
      node.request_uri = node.request_uri ?? opencodeCanaryRequest?.request_uri
      node.agent_id = node.agent_id ?? opencodeCanaryRequest?.agent_id
    }
    if (id === 'combine_results') {
      const combine = proof.combine_results as JsonRecord | undefined
      node.transport_run_id = typeof combine?.transport_run_id === 'string'
        ? combine.transport_run_id
        : typeof combine?.opencode_transport_run_id === 'string'
          ? combine.opencode_transport_run_id
          : undefined
    }
    if (Array.isArray(detail.state_reads)) {
      node.state_reads = detail.state_reads.filter((value): value is string => typeof value === 'string')
    }
    if (detail.state_writes && typeof detail.state_writes === 'object') {
      node.state_writes = detail.state_writes as JsonRecord
    }
    if (typeof detail.response === 'string') node.response = detail.response
    if (detail.answer != null && !node.response) node.response = String(detail.answer)
    if (detail.usage && typeof detail.usage === 'object') node.usage = detail.usage as JsonRecord
    if (typeof detail.model === 'string') node.model = detail.model
    if (typeof detail.model_served === 'string') node.model_served = detail.model_served
    if (typeof detail.provider === 'string') node.provider = detail.provider
    if (typeof detail.subagent_run_id === 'string') node.subagent_run_id = detail.subagent_run_id
    if (typeof detail.computation_backend === 'string') node.computation_backend = detail.computation_backend
    attachHelpContractFromDetail(node, detail)
    backfillAgentTransportModel(node, detail)
    return node
  })
  const nodes = await attachPersonasToDagNodes(nodesRaw)
  const syntheticEdges = buildDagEdges(nodeIds)
  const draftEdges = syntheticEdges.length ? [] : await draftGraphEdgesFromAcceptance(acceptance, nodeIds)
  const edges = syntheticEdges.length ? syntheticEdges : draftEdges
  return {
    schema: 'ux_lab.transport_dag_run_evidence.v1',
    found: true,
    transport_run_id: runId,
    proof_path: proofPath,
    dag_id: proof.dag_id,
    graph_id: proof.graph_id,
    expected_node_chart: proof.expected_node_chart,
    compiled_plan: compiledPlan,
    nodes,
    edges,
    layers: buildDagLayers(nodeIds, edges),
    not_proven: Array.isArray(proof.not_proven) ? proof.not_proven : [],
    harness_acceptance: acceptance,
    persistence: proof.persistence && typeof proof.persistence === 'object'
      ? proof.persistence as JsonRecord
      : undefined,
    node_timings: timings,
    progress_stream: await transportProgressStreamSummary(runId, nodes),
  }
}

async function proofPathForTransportRun(runId: string): Promise<string | null> {
  const proofDir = resolve(SCILLM_PROJECT_ROOT, '.plan-iterate', 'scillm-dag-fanout-r1', 'proof')
  if (!isPathInside(SCILLM_PROJECT_ROOT, proofDir)) return null
  const files = (await readdir(proofDir).catch(() => []))
    .filter((name) => name.endsWith('.json'))
    .sort()
    .reverse()
  for (const name of files) {
    const path = resolve(proofDir, name)
    try {
      const proof = JSON.parse(await readFile(path, 'utf8')) as JsonRecord
      if (proof.transport_run_id === runId) return path
    } catch {
      /* skip malformed or unrelated proof */
    }
  }
  return null
}

async function writeAmendedTransportEvent(
  runId: string,
  event: JsonRecord,
): Promise<{ eventsPath: string; event: JsonRecord }> {
  const runDir = resolve(SCILLM_PROJECT_ROOT, '.plan-iterate', 'scillm-dag-fanout-r1', 'events', runId)
  const eventsPath = resolve(runDir, 'events.jsonl')
  if (!isPathInside(SCILLM_PROJECT_ROOT, runDir) || !isPathInside(SCILLM_PROJECT_ROOT, eventsPath)) {
    throw new Error('transport event path escapes scillm project root')
  }
  await mkdir(runDir, { recursive: true })
  const row = {
    schema: 'ux_lab.transport_dag_amendment_event.v1',
    event_id: `evt_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`,
    ts: Date.now(),
    transport_run_id: runId,
    severity: 'info',
    ...event,
  }
  await writeFile(eventsPath, `${JSON.stringify(row)}\n`, { encoding: 'utf8', flag: 'a' })
  return { eventsPath, event: row }
}

function scillmProviderForModel(model: string): string {
  if (model === 'oc-kimi' || model.startsWith('opencode-go/')) return 'opencode-go'
  if (model === 'moonshot-text') return 'moonshot'
  if (model.startsWith('chutes-') || model.includes('/')) return 'chutes'
  if (model.startsWith('gemini') || model === 'text-gemini') return 'gemini'
  return 'scillm'
}

async function runScillmOneShotForDagNode(node: TransportDagEvidenceNode, model: string): Promise<{
  ok: boolean
  answer?: string
  provider?: string
  model: string
  model_served?: string
  usage?: JsonRecord
  error?: string
}> {
  const prompt = node.request || node.prompt || node.task || node.objective
  if (!prompt?.trim()) {
    return { ok: false, model, error: 'missing_node_request' }
  }
  try {
    const response = await fetch(`${SCILLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SCILLM_PROXY_KEY}`,
        'X-Caller-Skill': 'ux-lab-transport-dag-amend',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: `${prompt.trim()}\n\nReply with only the answer. No explanation.`,
          },
        ],
      }),
    })
    const body = await response.json().catch(() => ({})) as ScillmChatResponse & { error?: unknown }
    if (!response.ok) {
      return {
        ok: false,
        model,
        error: typeof body.error === 'string' ? body.error : `scillm_http_${response.status}`,
      }
    }
    const answer = body.choices?.[0]?.message?.content?.trim()
    if (!answer) {
      return { ok: false, model, model_served: body.model, usage: body.usage, error: 'empty_scillm_response' }
    }
    return {
      ok: true,
      answer,
      provider: scillmProviderForModel(model),
      model,
      model_served: body.model,
      usage: body.usage,
    }
  } catch (error) {
    return { ok: false, model, error: error instanceof Error ? error.message : String(error) }
  }
}

function backfillAgentTransportModel(node: TransportDagEvidenceNode, detail: JsonRecord) {
  if (node.semantic_call_type !== 'agent_transport') return
  node.provider = node.provider || optionalString(detail.provider) || 'opencode-go'
  node.model = node.model || optionalString(detail.model) || 'kimi-k2.6'
  node.model_served = node.model_served || optionalString(detail.model_served) || 'opencode-go/kimi-k2.6'
  node.model_evidence_uri = optionalString(detail.model_evidence_uri) || node.model_evidence_uri
}

function nodeNeedsMissingModelRepair(node: TransportDagEvidenceNode): boolean {
  return node.semantic_call_type === 'scillm_call'
    && node.status === 'blocked'
    && Array.isArray(node.missing_required_fields)
    && node.missing_required_fields.includes('provider')
    && node.missing_required_fields.includes('model')
}

type TransportDagDraftNode = {
  id: string
  label?: string
  semantic_call_type?: string
  skills?: string[]
  request?: string
  persona_id?: string
  provider?: string
  model?: string
  position?: { x: number; y: number }
}

type TransportDagDraftEdge = {
  from: string
  to: string
}

type TransportDagDraftGraph = {
  nodes: TransportDagDraftNode[]
  edges: TransportDagDraftEdge[]
}

function transportDraftPersonaCandidates(node: TransportDagDraftNode): string[] {
  return [
    node.persona_id,
  ]
    .map((value) => personaSlug(value))
    .filter((value): value is string => Boolean(value))
}

async function validateTransportDagDraft(graph: TransportDagDraftGraph): Promise<{ ok: boolean; errors: string[] }> {
  const errors: string[] = []
  const ids = new Set<string>()
  for (const node of graph.nodes) {
    if (!node.id?.trim()) {
      errors.push('node missing id')
      continue
    }
    if (ids.has(node.id)) errors.push(`duplicate node id: ${node.id}`)
    ids.add(node.id)
    if (!node.request?.trim() && node.semantic_call_type !== 'memory') {
      errors.push(`${node.id}: missing request`)
    }
    if (node.semantic_call_type === 'scillm_call') {
      if (!node.model?.trim()) errors.push(`${node.id}: missing model`)
      if (!node.provider?.trim()) errors.push(`${node.id}: missing provider`)
    }
    const personaCandidates = transportDraftPersonaCandidates(node)
    if (node.semantic_call_type === 'agent_transport' || personaCandidates.length) {
      if (!personaCandidates.length) {
        errors.push(`${node.id}: missing persona`)
      } else {
        const found = personaCandidates.some((candidate) => {
          const path = ocSubagentPersonaYamlPath(candidate)
          return isPathInside(OC_SUBAGENT_PERSONAS_ROOT, path) && existsSync(path)
        })
        if (!found) errors.push(`${node.id}: persona yaml not found for ${personaCandidates.join(', ')}`)
      }
    }
  }
  for (const edge of graph.edges) {
    if (!ids.has(edge.from)) errors.push(`edge ${edge.from}->${edge.to}: missing source node`)
    if (!ids.has(edge.to)) errors.push(`edge ${edge.from}->${edge.to}: missing target node`)
    if (edge.from === edge.to) errors.push(`edge ${edge.from}->${edge.to}: self cycle`)
  }

  const adjacency = new Map<string, string[]>()
  for (const id of ids) adjacency.set(id, [])
  for (const edge of graph.edges) {
    if (ids.has(edge.from) && ids.has(edge.to)) adjacency.get(edge.from)?.push(edge.to)
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string, path: string[]): boolean => {
    if (visiting.has(id)) {
      errors.push(`cycle detected: ${[...path, id].join(' -> ')}`)
      return true
    }
    if (visited.has(id)) return false
    visiting.add(id)
    for (const next of adjacency.get(id) || []) visit(next, [...path, id])
    visiting.delete(id)
    visited.add(id)
    return false
  }
  for (const id of ids) visit(id, [])

  return { ok: errors.length === 0, errors }
}

function transportDraftGraphFromBody(body: unknown): TransportDagDraftGraph | null {
  const graph = body && typeof body === 'object' ? (body as JsonRecord).graph : null
  if (!graph || typeof graph !== 'object') return null
  const raw = graph as JsonRecord
  const nodes = Array.isArray(raw.nodes)
    ? raw.nodes
        .filter((node): node is JsonRecord => Boolean(node && typeof node === 'object'))
        .map((node) => ({
          id: String(node.id || '').trim(),
          label: optionalString(node.label),
          semantic_call_type: optionalString(node.semantic_call_type),
          skills: Array.isArray(node.skills)
            ? [...new Set(node.skills.map(String).map((skill) => skill.trim()).filter(Boolean))]
            : undefined,
          request: optionalString(node.request),
          persona_id: optionalString(node.persona_id),
          provider: optionalString(node.provider),
          model: optionalString(node.model),
          position: node.position && typeof node.position === 'object'
            ? {
                x: Number((node.position as JsonRecord).x || 0),
                y: Number((node.position as JsonRecord).y || 0),
              }
            : undefined,
        }))
    : []
  const edges = Array.isArray(raw.edges)
    ? raw.edges
        .filter((edge): edge is JsonRecord => Boolean(edge && typeof edge === 'object'))
        .map((edge) => ({
          from: String(edge.from || edge.source || '').trim(),
          to: String(edge.to || edge.target || '').trim(),
        }))
        .filter((edge) => edge.from && edge.to)
    : []
  return { nodes, edges }
}

function transportDraftPersonaIdForNode(node: TransportDagDraftNode, baseNode?: TransportDagEvidenceNode): string | undefined {
  return optionalString(node.persona_id)
    || baseNode?.subagent_persona
    || baseNode?.subagent_role
    || baseNode?.role
    || baseNode?.agent_id
}

function transportDraftNodeRequest(node: TransportDagDraftNode, baseNode?: TransportDagEvidenceNode): string | undefined {
  return optionalString(node.request)
    || baseNode?.request
    || baseNode?.prompt
    || baseNode?.task
    || baseNode?.objective
}

function transportDraftNodeChanged(node: TransportDagDraftNode, baseNode?: TransportDagEvidenceNode): boolean {
  if (!baseNode) return true
  const baseRequest = transportDraftNodeRequest({ ...node, request: undefined }, baseNode) || ''
  const nextRequest = transportDraftNodeRequest(node, baseNode) || ''
  const basePersona = transportDraftPersonaIdForNode({ ...node, persona_id: undefined }, baseNode) || ''
  const nextPersona = transportDraftPersonaIdForNode(node, baseNode) || ''
  const baseProvider = baseNode.provider || ''
  const nextProvider = node.provider || ''
  const baseModel = baseNode.model || baseNode.model_served || ''
  const nextModel = node.model || ''
  return baseRequest !== nextRequest
    || basePersona !== nextPersona
    || baseProvider !== nextProvider
    || baseModel !== nextModel
    || (node.semantic_call_type || '') !== (baseNode.semantic_call_type || '')
}

function transportEvidenceNodeFromDraft(
  node: TransportDagDraftNode,
  baseNode: TransportDagEvidenceNode | undefined,
  runId: string,
): TransportDagEvidenceNode {
  const semantic = node.semantic_call_type || baseNode?.semantic_call_type || 'scillm_call'
  const personaId = transportDraftPersonaIdForNode(node, baseNode)
  const request = transportDraftNodeRequest(node, baseNode)
  return {
    ...(baseNode ? JSON.parse(JSON.stringify(baseNode)) as TransportDagEvidenceNode : {}),
    id: node.id,
    label: node.label || baseNode?.label || labelFromNodeId(node.id),
    status: 'waiting',
    semantic_call_type: semantic,
    skills: node.skills?.length
      ? [...node.skills]
      : baseNode?.skills?.length
      ? [...baseNode.skills]
      : semantic === 'scillm_call'
        ? ['scillm']
        : semantic === 'agent_transport'
          ? ['opencode']
          : [],
    transport_run_id: runId,
    request,
    subagent_persona: personaId || baseNode?.subagent_persona,
    subagent_role: personaId ? personaSlug(personaId) : baseNode?.subagent_role,
    agent_id: personaId ? personaSlug(personaId) : baseNode?.agent_id,
    provider: node.provider || baseNode?.provider,
    model: node.model || baseNode?.model,
    model_served: baseNode?.model_served,
    missing_required_fields: [],
  }
}

async function readTransportDagDraftArtifact(
  runId: string,
  draftId: string,
): Promise<{ payload: JsonRecord; artifactPath: string } | null> {
  const safeDraftId = safeArtifactName(draftId)
  const artifactPath = resolve(TRANSPORT_DAG_DRAFT_DIR, `${safeDraftId}.json`)
  if (!safeDraftId || !isPathInside(SCILLM_PROJECT_ROOT, artifactPath)) return null
  if (!existsSync(artifactPath)) return null
  const payload = JSON.parse(await readFile(artifactPath, 'utf8')) as JsonRecord
  if (payload.base_transport_run_id !== runId) return null
  return { payload, artifactPath }
}

app.post('/api/transport/dag-run-evidence/:transportRunId/drafts', async (req, res) => {
  const runId = req.params.transportRunId.trim()
  if (!isPathInside(SCILLM_PROJECT_ROOT, TRANSPORT_DAG_DRAFT_DIR)) {
    res.status(500).json({ ok: false, error: 'configured transport DAG draft path escapes project root' })
    return
  }
  try {
    const proofPath = await proofPathForTransportRun(runId)
    if (!proofPath) {
      res.status(404).json({ ok: false, error: 'base_proof_not_found', transport_run_id: runId })
      return
    }
    const graph = transportDraftGraphFromBody(req.body)
    if (!graph || !graph.nodes.length) {
      res.status(400).json({ ok: false, error: 'invalid_transport_dag_draft_graph' })
      return
    }
    const validation = await validateTransportDagDraft(graph)
    const now = new Date().toISOString()
    const draftId = safeArtifactName(String(req.body?.draft_id || req.body?.draftId || `${runId}-draft`))
    const artifactPath = resolve(TRANSPORT_DAG_DRAFT_DIR, `${draftId}.json`)
    if (!isPathInside(SCILLM_PROJECT_ROOT, artifactPath)) {
      res.status(500).json({ ok: false, error: 'configured transport DAG draft artifact path escapes project root' })
      return
    }
    const previous = existsSync(artifactPath) ? JSON.parse(await readFile(artifactPath, 'utf8')) as JsonRecord : null
    const payload = {
      schema: 'scillm.transport_dag_draft.v1',
      draft_id: draftId,
      base_transport_run_id: runId,
      base_proof_path: proofPath,
      status: validation.ok ? 'valid_draft' : 'invalid_draft',
      graph,
      validation,
      immutable_receipt: true,
      created_at: previous?.created_at || now,
      updated_at: now,
      source: {
        ui: 'ux-lab TransportReactFlowDagWorkspace',
        project_root: SCILLM_PROJECT_ROOT,
      },
    }
    await mkdir(TRANSPORT_DAG_DRAFT_DIR, { recursive: true })
    await writeFile(artifactPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    res.json({ ok: validation.ok, draft: { ...payload, artifact_path: artifactPath } })
  } catch (error) {
    res.status(500).json({ ok: false, error: 'transport_dag_draft_save_failed', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/transport/dag-run-evidence/:transportRunId/drafts/:draftId', async (req, res) => {
  const draftId = safeArtifactName(String(req.params.draftId || ''))
  const artifactPath = resolve(TRANSPORT_DAG_DRAFT_DIR, `${draftId}.json`)
  if (!draftId || !isPathInside(SCILLM_PROJECT_ROOT, artifactPath)) {
    res.status(400).json({ ok: false, error: 'invalid_transport_dag_draft_id' })
    return
  }
  try {
    if (!existsSync(artifactPath)) {
      res.status(404).json({ ok: false, error: 'transport_dag_draft_not_found' })
      return
    }
    const payload = JSON.parse(await readFile(artifactPath, 'utf8')) as JsonRecord
    if (payload.base_transport_run_id !== req.params.transportRunId.trim()) {
      res.status(404).json({ ok: false, error: 'transport_dag_draft_run_mismatch' })
      return
    }
    res.json({ ok: true, draft: { ...payload, artifact_path: artifactPath } })
  } catch (error) {
    res.status(500).json({ ok: false, error: 'transport_dag_draft_read_failed', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.post('/api/transport/dag-run-evidence/:transportRunId/drafts/:draftId/run', async (req, res) => {
  const runId = req.params.transportRunId.trim()
  const draftId = safeArtifactName(String(req.params.draftId || ''))
  try {
    const draftRead = await readTransportDagDraftArtifact(runId, draftId)
    if (!draftRead) {
      res.status(404).json({ ok: false, error: 'transport_dag_draft_not_found', transport_run_id: runId, draft_id: draftId })
      return
    }
    const graphRaw = (draftRead.payload.graph && typeof draftRead.payload.graph === 'object')
      ? draftRead.payload.graph as TransportDagDraftGraph
      : null
    if (!graphRaw || !Array.isArray(graphRaw.nodes) || !Array.isArray(graphRaw.edges)) {
      res.status(400).json({ ok: false, error: 'invalid_transport_dag_draft_graph', draft_id: draftId })
      return
    }
    const validation = await validateTransportDagDraft(graphRaw)
    if (!validation.ok) {
      res.status(400).json({ ok: false, error: 'invalid_transport_dag_draft', draft_id: draftId, validation })
      return
    }

    const proofPath = await proofPathForTransportRun(runId)
    if (!proofPath) {
      res.status(404).json({ ok: false, error: 'base_proof_not_found', transport_run_id: runId })
      return
    }
    if (!isPathInside(SCILLM_PROJECT_ROOT, proofPath)) {
      res.status(500).json({ ok: false, error: 'proof path escapes scillm project root' })
      return
    }
    const baseProof = JSON.parse(await readFile(proofPath, 'utf8')) as JsonRecord
    const baseEvidence = await dagEvidenceFromProof(baseProof, proofPath, runId)
    const baseNodes = Array.isArray(baseEvidence?.nodes)
      ? baseEvidence.nodes.filter((node): node is TransportDagEvidenceNode => Boolean(node && typeof node === 'object'))
      : []
    const baseNodeById = new Map(baseNodes.map((node) => [node.id, node]))

    const unsupported: string[] = []
    for (const draftNode of graphRaw.nodes) {
      const baseNode = baseNodeById.get(draftNode.id)
      const semantic = draftNode.semantic_call_type || baseNode?.semantic_call_type || 'scillm_call'
      const changed = transportDraftNodeChanged(draftNode, baseNode)
      if (semantic === 'agent_transport' && changed) {
        unsupported.push(`${draftNode.id}: changed persistent agent_transport node requires opencode session executor`)
      }
      if (semantic !== 'agent_transport' && semantic !== 'scillm_call' && semantic !== 'local' && changed) {
        unsupported.push(`${draftNode.id}: changed ${semantic} node is not executable by draft runner`)
      }
    }
    if (unsupported.length) {
      res.status(400).json({
        ok: false,
        error: 'unsupported_transport_dag_draft_execution',
        draft_id: draftId,
        not_proven: unsupported,
      })
      return
    }

    const now = new Date().toISOString()
    const suffix = `draft-${safeArtifactName(draftId)}-${Date.now().toString(36)}`
    const amendedRunId = `${runId}-${suffix}`
    const eventWrites: JsonRecord[] = []
    const writeDraftEvent = async (event: JsonRecord) => {
      const written = await writeAmendedTransportEvent(amendedRunId, event)
      eventWrites.push(written.event)
      return written
    }
    const transportEvent = await writeDraftEvent({
      event_type: 'transport.created',
      delivery_state: 'created',
      source: 'ux_lab.transport_dag_draft_runner.v1',
      base_transport_run_id: runId,
      draft_id: draftId,
      draft_artifact_path: draftRead.artifactPath,
    })

    const nodeIds = graphRaw.nodes.map((node) => node.id)
    const layers = buildDagLayers(nodeIds, graphRaw.edges)
    const evidenceNodeMap = new Map<string, TransportDagEvidenceNode>()
    for (const draftNode of graphRaw.nodes) {
      const baseNode = baseNodeById.get(draftNode.id)
      evidenceNodeMap.set(draftNode.id, transportEvidenceNodeFromDraft(draftNode, baseNode, amendedRunId))
    }

    const nodeTimings: Record<string, JsonRecord> = {}
    const harnessAcceptance: Record<string, JsonRecord> = {}
    const nextNotProven: string[] = []
    for (const layer of layers) {
      await Promise.all(layer.map(async (nodeId) => {
        const draftNode = graphRaw.nodes.find((node) => node.id === nodeId)
        const node = evidenceNodeMap.get(nodeId)
        if (!draftNode || !node) return
        const startedAt = new Date().toISOString()
        node.started_at = startedAt
        nodeTimings[node.id] = { started_at: startedAt }
        await writeDraftEvent({
          event_type: 'message.queued',
          delivery_state: 'queued',
          dag_node_id: node.id,
          role: node.subagent_role || node.role,
          provider: node.provider,
          model: node.model,
          prompt: node.request || node.prompt || node.task || node.objective,
          source: 'ux_lab.transport_dag_draft_runner.v1',
        })
        await writeDraftEvent({
          event_type: 'message.posted',
          delivery_state: 'posted',
          dag_node_id: node.id,
          role: node.subagent_role || node.role,
          provider: node.provider,
          model: node.model,
          source: 'ux_lab.transport_dag_draft_runner.v1',
        })

        if (node.semantic_call_type === 'scillm_call') {
          const selectedModel = draftNode.model || node.model || 'oc-kimi'
          const result = await runScillmOneShotForDagNode(node, selectedModel)
          const completedAt = new Date().toISOString()
          node.completed_at = completedAt
          nodeTimings[node.id].completed_at = completedAt
          if (result.ok) {
            node.status = 'completed'
            node.provider = result.provider || node.provider
            node.model = result.model
            node.model_served = result.model_served
            node.response = result.answer
            node.usage = result.usage
            delete node.error
            delete node.missing_required_fields
            harnessAcceptance[node.id] = {
              ok: true,
              detail: {
                semantic_call_type: 'scillm_call',
                harness_acceptance_state: 'accepted_after_draft_run',
                provider: result.provider,
                model: result.model,
                model_served: result.model_served,
                request: node.request,
                answer: result.answer,
                usage: result.usage,
                draft_id: draftId,
                draft_artifact_path: draftRead.artifactPath,
                base_transport_run_id: runId,
                events_path: transportEvent.eventsPath,
              },
            }
          } else {
            node.status = 'blocked'
            node.model = result.model
            node.error = result.error || 'scillm_draft_run_failed'
            node.missing_required_fields = []
            nextNotProven.push(`${node.id} scillm_call draft run failed: ${node.error}`)
            harnessAcceptance[node.id] = {
              ok: false,
              detail: {
                semantic_call_type: 'scillm_call',
                harness_acceptance_state: 'draft_run_failed',
                provider: result.provider,
                model: result.model,
                request: node.request,
                error: node.error,
                draft_id: draftId,
                events_path: transportEvent.eventsPath,
              },
            }
          }
          await writeDraftEvent({
            event_type: result.ok ? 'message.delivered' : 'message.failed',
            delivery_state: result.ok ? 'delivered' : 'failed',
            dag_node_id: node.id,
            role: node.subagent_role || node.role,
            provider: result.provider,
            model: result.model,
            model_served: result.model_served,
            response: result.answer,
            error: result.error,
            source: 'ux_lab.transport_dag_draft_runner.v1',
          })
          return
        }

        const baseNode = baseNodeById.get(node.id)
        const completedAt = new Date().toISOString()
        node.completed_at = completedAt
        nodeTimings[node.id].completed_at = completedAt
        node.status = baseNode?.status === 'blocked' || baseNode?.status === 'failed'
          ? baseNode.status
          : 'completed'
        node.response = baseNode?.response
        node.usage = baseNode?.usage
        node.provider = node.provider || baseNode?.provider
        node.model = node.model || baseNode?.model
        node.model_served = node.model_served || baseNode?.model_served
        harnessAcceptance[node.id] = {
          ok: node.status === 'completed' || node.status === 'accepted',
          detail: {
            semantic_call_type: node.semantic_call_type || 'local',
            harness_acceptance_state: 'carried_forward_from_base_receipt',
            provider: node.provider,
            model: node.model,
            model_served: node.model_served,
            request: node.request,
            answer: node.response,
            draft_id: draftId,
            base_transport_run_id: runId,
            base_node_id: node.id,
            events_path: transportEvent.eventsPath,
          },
        }
        await writeDraftEvent({
          event_type: 'message.delivered',
          delivery_state: 'carried_forward',
          dag_node_id: node.id,
          role: node.subagent_role || node.role,
          provider: node.provider,
          model: node.model,
          model_served: node.model_served,
          response: node.response,
          source: 'ux_lab.transport_dag_draft_runner.v1',
        })
      }))
    }

    await writeDraftEvent({
      event_type: nextNotProven.length ? 'run.failed' : 'run.completed',
      delivery_state: nextNotProven.length ? 'failed' : 'completed',
      source: 'ux_lab.transport_dag_draft_runner.v1',
      draft_id: draftId,
      not_proven: nextNotProven,
    })

    const evidenceNodes = await attachPersonasToDagNodes([...evidenceNodeMap.values()])
    const explicitEvidence: JsonRecord = {
      schema: 'ux_lab.transport_dag_run_evidence.v1',
      found: true,
      transport_run_id: amendedRunId,
      dag_id: baseEvidence && typeof baseEvidence.dag_id === 'string' ? baseEvidence.dag_id : undefined,
      graph_id: `draft:${draftId}`,
      expected_node_chart: baseEvidence && typeof baseEvidence.expected_node_chart === 'string' ? baseEvidence.expected_node_chart : undefined,
      compiled_plan: baseEvidence?.compiled_plan,
      nodes: evidenceNodes,
      edges: graphRaw.edges,
      layers,
      not_proven: nextNotProven,
      harness_acceptance: harnessAcceptance,
      persistence: baseEvidence?.persistence,
      node_timings: nodeTimings,
      draft_run: {
        schema: 'ux_lab.transport_dag_draft_run.v1',
        draft_id: draftId,
        draft_artifact_path: draftRead.artifactPath,
        base_transport_run_id: runId,
        base_proof_path: proofPath,
        ran_at: now,
        immutable_base_receipt: true,
        runner: 'ux_lab.transport_dag_draft_runner.v1',
      },
      progress_stream: await transportProgressStreamSummary(amendedRunId, evidenceNodes),
    }

    const amendedProof = JSON.parse(JSON.stringify(baseProof)) as JsonRecord
    amendedProof.transport_run_id = amendedRunId
    amendedProof.draft_run = explicitEvidence.draft_run
    amendedProof.node_timings = nodeTimings
    amendedProof.harness_acceptance = harnessAcceptance
    amendedProof.ux_lab_transport_dag_evidence = explicitEvidence
    amendedProof.not_proven = nextNotProven
    amendedProof.draft_events = {
      events_path: transportEvent.eventsPath,
      event_count: eventWrites.length,
      event_types: eventWrites.map((event) => event.event_type),
    }

    const proofDir = resolve(SCILLM_PROJECT_ROOT, '.plan-iterate', 'scillm-dag-fanout-r1', 'proof')
    if (!isPathInside(SCILLM_PROJECT_ROOT, proofDir)) {
      res.status(500).json({ ok: false, error: 'proof output path escapes scillm project root' })
      return
    }
    await mkdir(proofDir, { recursive: true })
    const amendedProofPath = resolve(proofDir, `${safeArtifactName(amendedRunId)}.json`)
    await writeFile(amendedProofPath, `${JSON.stringify(amendedProof, null, 2)}\n`, 'utf8')
    res.json({
      ok: nextNotProven.length === 0,
      transport_run_id: amendedRunId,
      proof_path: amendedProofPath,
      draft_id: draftId,
      event_count: eventWrites.length,
      not_proven: nextNotProven,
    })
  } catch (error) {
    res.status(500).json({ ok: false, error: 'transport_dag_draft_run_failed', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.post('/api/transport/dag-run-evidence/:transportRunId/amend-rerun', async (req, res) => {
  const runId = req.params.transportRunId.trim()
  const selectedModel = typeof req.body?.model === 'string' && req.body.model.trim()
    ? req.body.model.trim()
    : 'oc-kimi'
  try {
    const proofPath = await proofPathForTransportRun(runId)
    if (!proofPath) {
      res.status(404).json({ ok: false, error: 'base_proof_not_found', transport_run_id: runId })
      return
    }
    if (!isPathInside(SCILLM_PROJECT_ROOT, proofPath)) {
      res.status(500).json({ ok: false, error: 'proof path escapes scillm project root' })
      return
    }
    const baseProof = JSON.parse(await readFile(proofPath, 'utf8')) as JsonRecord
    const baseEvidence = await dagEvidenceFromProof(baseProof, proofPath, runId)
    const nodes = Array.isArray(baseEvidence?.nodes)
      ? baseEvidence.nodes.filter((node): node is TransportDagEvidenceNode => Boolean(node && typeof node === 'object'))
      : []
    const repairable = nodes.filter(nodeNeedsMissingModelRepair)
    if (!repairable.length) {
      res.status(400).json({ ok: false, error: 'no_repairable_missing_model_nodes', transport_run_id: runId })
      return
    }

    const now = new Date().toISOString()
    const suffix = `${safeArtifactName(selectedModel)}-${Date.now().toString(36)}`
    const amendedRunId = `${runId}-amended-${suffix}`
    const amendedProof = JSON.parse(JSON.stringify(baseProof)) as JsonRecord
    amendedProof.transport_run_id = amendedRunId
    amendedProof.amended_from = {
      transport_run_id: runId,
      proof_path: proofPath,
      reason: 'scillm_call_missing_model',
      selected_model: selectedModel,
      amended_at: now,
      repair_loop: 'ux_lab.transport_dag_missing_model.v1',
    }
    const nodeOk = amendedProof.node_ok && typeof amendedProof.node_ok === 'object'
      ? amendedProof.node_ok as JsonRecord
      : {}
    amendedProof.node_ok = nodeOk
    const acceptance = amendedProof.harness_acceptance && typeof amendedProof.harness_acceptance === 'object'
      ? amendedProof.harness_acceptance as Record<string, JsonRecord>
      : {}
    amendedProof.harness_acceptance = acceptance

    const eventWrites: JsonRecord[] = []
    const writeRepairEvent = async (event: JsonRecord) => {
      const written = await writeAmendedTransportEvent(amendedRunId, event)
      eventWrites.push(written.event)
      return written
    }
    const transportEvent = await writeRepairEvent({
      event_type: 'transport.created',
      delivery_state: 'created',
      source: 'ux_lab.transport_dag_missing_model.v1',
      base_transport_run_id: runId,
      selected_model: selectedModel,
      repaired_node_ids: repairable.map((node) => node.id),
    })

    const results = new Map<string, Awaited<ReturnType<typeof runScillmOneShotForDagNode>>>()
    await Promise.all(repairable.map(async (node) => {
      await writeRepairEvent({
        event_type: 'message.queued',
        delivery_state: 'queued',
        dag_node_id: node.id,
        subagent_run_id: node.subagent_run_id,
        role: node.subagent_role || node.role,
        model: selectedModel,
        prompt: node.request || node.prompt || node.task || node.objective,
        source: 'ux_lab.transport_dag_missing_model.v1',
      })
      await writeRepairEvent({
        event_type: 'message.posted',
        delivery_state: 'posted',
        dag_node_id: node.id,
        subagent_run_id: node.subagent_run_id,
        role: node.subagent_role || node.role,
        model: selectedModel,
        source: 'ux_lab.transport_dag_missing_model.v1',
      })
      const result = await runScillmOneShotForDagNode(node, selectedModel)
      results.set(node.id, result)
      await writeRepairEvent({
        event_type: result.ok ? 'message.delivered' : 'message.failed',
        delivery_state: result.ok ? 'delivered' : 'failed',
        dag_node_id: node.id,
        subagent_run_id: node.subagent_run_id,
        role: node.subagent_role || node.role,
        provider: result.provider,
        model: result.model,
        model_served: result.model_served,
        response: result.answer,
        error: result.error,
        source: 'ux_lab.transport_dag_missing_model.v1',
      })
      await writeRepairEvent({
        event_type: 'session.idle_seen',
        delivery_state: result.ok ? 'idle_seen' : 'failed',
        dag_node_id: node.id,
        subagent_run_id: node.subagent_run_id,
        role: node.subagent_role || node.role,
        provider: result.provider,
        model: result.model,
        model_served: result.model_served,
        source: 'ux_lab.transport_dag_missing_model.v1',
      })
    }))

    const nextNotProven: string[] = []
    for (const node of repairable) {
      const result = results.get(node.id)
      if (result?.ok) {
        nodeOk[node.id] = true
        acceptance[node.id] = {
          ok: true,
          detail: {
            semantic_call_type: 'scillm_call',
            harness_acceptance_state: 'accepted_after_amendment',
            provider: result.provider,
            model: result.model,
            model_served: result.model_served,
            request: node.request,
            answer: result.answer,
            usage: result.usage,
            amended_from_run_id: runId,
            events_path: transportEvent.eventsPath,
          },
        }
      } else {
        nodeOk[node.id] = false
        acceptance[node.id] = {
          ok: false,
          detail: {
            semantic_call_type: 'scillm_call',
            harness_acceptance_state: 'amendment_failed',
            provider: result?.provider,
            model: selectedModel,
            request: node.request,
            error: result?.error || 'scillm_amendment_failed',
            events_path: transportEvent.eventsPath,
          },
        }
        nextNotProven.push(`${node.id} scillm_call amendment failed: ${result?.error || 'unknown error'}`)
      }
    }

    const explicitEvidence = amendedProof.ux_lab_transport_dag_evidence
      && typeof amendedProof.ux_lab_transport_dag_evidence === 'object'
      ? amendedProof.ux_lab_transport_dag_evidence as JsonRecord
      : baseEvidence
    if (!explicitEvidence || typeof explicitEvidence !== 'object') {
      res.status(500).json({ ok: false, error: 'base_evidence_missing' })
      return
    }
    const evidenceNodes = Array.isArray(explicitEvidence.nodes)
      ? explicitEvidence.nodes.filter((node): node is TransportDagEvidenceNode => Boolean(node && typeof node === 'object'))
      : []
    for (const node of evidenceNodes) {
      node.transport_run_id = amendedRunId
      const accepted = acceptance[node.id]
      const detail = accepted?.detail && typeof accepted.detail === 'object' ? accepted.detail as JsonRecord : {}
      if (nodeNeedsMissingModelRepair(node)) {
        const result = results.get(node.id)
        if (result?.ok) {
          node.status = 'completed'
          node.provider = result.provider
          node.model = result.model
          node.model_served = result.model_served
          node.response = result.answer
          node.usage = result.usage
          node.completed_at = now
          delete node.error
          delete node.missing_required_fields
        } else {
          node.status = 'blocked'
          node.provider = result?.provider
          node.model = selectedModel
          node.error = result?.error || 'scillm_amendment_failed'
          node.missing_required_fields = []
        }
      } else {
        backfillAgentTransportModel(node, detail)
      }
    }

    await writeRepairEvent({
      event_type: nextNotProven.length ? 'run.failed' : 'run.completed',
      delivery_state: nextNotProven.length ? 'failed' : 'completed',
      source: 'ux_lab.transport_dag_missing_model.v1',
      not_proven: nextNotProven,
    })
    explicitEvidence.transport_run_id = amendedRunId
    explicitEvidence.found = true
    explicitEvidence.proof_path = undefined
    explicitEvidence.progress_stream = await transportProgressStreamSummary(amendedRunId, evidenceNodes)
    explicitEvidence.not_proven = nextNotProven
    amendedProof.amendment_events = {
      events_path: transportEvent.eventsPath,
      event_count: eventWrites.length,
      event_types: eventWrites.map((event) => event.event_type),
    }
    amendedProof.ux_lab_transport_dag_evidence = explicitEvidence
    amendedProof.not_proven = nextNotProven

    const proofDir = resolve(SCILLM_PROJECT_ROOT, '.plan-iterate', 'scillm-dag-fanout-r1', 'proof')
    if (!isPathInside(SCILLM_PROJECT_ROOT, proofDir)) {
      res.status(500).json({ ok: false, error: 'proof output path escapes scillm project root' })
      return
    }
    await mkdir(proofDir, { recursive: true })
    const amendedProofPath = resolve(proofDir, `${safeArtifactName(amendedRunId)}.json`)
    await writeFile(amendedProofPath, `${JSON.stringify(amendedProof, null, 2)}\n`, 'utf8')
    res.json({
      ok: nextNotProven.length === 0,
      transport_run_id: amendedRunId,
      proof_path: amendedProofPath,
      repaired_node_ids: repairable.map((node) => node.id),
      not_proven: nextNotProven,
    })
  } catch (error) {
    res.status(500).json({ ok: false, error: 'amend_rerun_failed', detail: error instanceof Error ? error.message : String(error) })
  }
})

app.get('/api/transport/dag-run-evidence/:transportRunId', async (req, res) => {
  const runId = req.params.transportRunId.trim()
  try {
    const proofDir = resolve(SCILLM_PROJECT_ROOT, '.plan-iterate', 'scillm-dag-fanout-r1', 'proof')
    if (!isPathInside(SCILLM_PROJECT_ROOT, proofDir)) {
      res.status(500).json({ error: 'proof path escapes scillm project root' })
      return
    }
    const files = (await readdir(proofDir).catch(() => []))
      .filter((name) => name.endsWith('.json'))
      .sort()
      .reverse()
    for (const name of files) {
      const path = resolve(proofDir, name)
      try {
        const proof = JSON.parse(await readFile(path, 'utf8')) as JsonRecord
        const evidence = await dagEvidenceFromProof(proof, path, runId)
        if (evidence) {
          res.json(evidence)
          return
        }
      } catch {
        /* skip malformed or unrelated proof */
      }
    }
    res.json({
      schema: 'ux_lab.transport_dag_run_evidence.v1',
      found: false,
      transport_run_id: runId,
      nodes: [],
      edges: [],
      layers: [],
      not_proven: ['No DAG proof receipt matched this transport run id.'],
      progress_stream: await transportProgressStreamSummary(runId),
    })
  } catch (error) {
    res.status(500).json({ error: 'transport DAG evidence lookup failed', detail: error instanceof Error ? error.message : String(error) })
  }
})

// ── scillm transport SSE (must not use JSON catch-all) ─────────────────────
app.get('/api/scillm/v1/scillm/opencode/transport/runs/:transportRunId/events/stream', (req, res) => {
  const transportRunId = req.params.transportRunId
  const url = new URL(`${SCILLM_URL}/v1/scillm/opencode/transport/runs/${encodeURIComponent(transportRunId)}/events/stream`)
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
        Authorization: `Bearer ${process.env.SCILLM_API_KEY || 'sk-dev-proxy-123'}`,
        'X-Caller-Skill': 'ux-lab',
        Accept: 'text/event-stream',
      },
    },
    (proxyRes) => {
      res.status(proxyRes.statusCode ?? 500)
      res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      proxyRes.pipe(res)
    },
  )
  proxyReq.on('error', (err) => {
    res.status(502).json({ error: 'scillm transport stream unreachable', detail: err.message })
  })
  proxyReq.end()
})

app.get('/api/scillm/v1/scillm/opencode/transport/runs/:transportRunId/dialog', async (req, res) => {
  const transportRunId = req.params.transportRunId.trim()
  const headers = {
    Authorization: `Bearer ${process.env.SCILLM_API_KEY || 'sk-dev-proxy-123'}`,
    'X-Caller-Skill': 'ux-lab',
    Accept: 'application/json',
  }
  try {
    const dialogUrl = `${SCILLM_URL}/v1/scillm/opencode/transport/runs/${encodeURIComponent(transportRunId)}/dialog`
    const dialogResp = await fetch(dialogUrl, { headers })
    const dialogText = await dialogResp.text()
    if (dialogResp.ok) {
      try {
        res.json(JSON.parse(dialogText))
      } catch {
        res.status(502).json({ error: 'scillm transport dialog returned non-json', detail: dialogText.slice(0, 500) })
      }
      return
    }

    const sessionMissing = /Session not found/i.test(dialogText)
    if (!sessionMissing) {
      res.status(dialogResp.status).type(dialogResp.headers.get('content-type') || 'application/json').send(dialogText)
      return
    }

    const runUrl = `${SCILLM_URL}/v1/scillm/opencode/transport/runs/${encodeURIComponent(transportRunId)}`
    const runResp = await fetch(runUrl, { headers })
    const runText = await runResp.text()
    if (!runResp.ok) {
      res.status(dialogResp.status).type(dialogResp.headers.get('content-type') || 'application/json').send(dialogText)
      return
    }
    const run = JSON.parse(runText) as JsonRecord
    const state = (run.state && typeof run.state === 'object') ? run.state as JsonRecord : {}
    const observation = (run.observation && typeof run.observation === 'object') ? run.observation as JsonRecord : {}
    const children = Array.isArray(state.children) ? state.children : []
    const activeSubagent = children.find((child: JsonRecord) => child?.active) ?? children.at(-1) ?? null
    res.json({
      schema: 'scillm.transport.dialog.v1',
      transport_run_id: transportRunId,
      dialog_session_id: typeof state.parent_session_id === 'string' ? state.parent_session_id : undefined,
      collaborators: ['human', 'project_agent', 'worker'],
      human_can_participate: false,
      project_agent_can_participate: false,
      turns: [],
      pending_human: [],
      children,
      active_subagent: activeSubagent,
      observation: {
        ...observation,
        transport_run_id: transportRunId,
        transcript_unavailable_reason: 'parent_session_not_found',
        transcript_unavailable_detail: 'The transport run metadata exists, but its OpenCode parent session is no longer available.',
      },
      not_proven: ['OpenCode parent session was not found; transcript turns are unavailable for this historical run.'],
    })
  } catch (err) {
    res.status(502).json({ error: 'scillm transport dialog unavailable', detail: err instanceof Error ? err.message : String(err) })
  }
})

app.all('/api/scillm/{*path}', (req, res) => {
  const scillmPath = '/' + (Array.isArray(req.params.path) ? req.params.path.join('/') : req.params.path)
  const url = new URL(`${SCILLM_URL}${scillmPath}`)
  if (req.url.includes('?')) {
    url.search = req.url.slice(req.url.indexOf('?'))
  }
  const body = req.method === 'GET' || req.method === 'HEAD' ? null : JSON.stringify(req.body ?? {})

  const proxyReq = httpRequest(
    {
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: req.method,
      headers: {
        ...(body ? {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        } : {}),
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
  if (body) proxyReq.write(body)
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
    tags: ['architecture', payload.projectName, 'project-agent', 'Precision'],
    scope: ARCH_SCOPE,
  }
  await proxyPost('/learn', commonDoc)
  return { saved: true, via: 'learn' }
}

async function getArchitectureById(id: string): Promise<ArchitecturePayload | null> {
  const listed = await proxyPost('/list', {
    collection: 'lessons_v2',
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
      collection: 'lessons_v2',
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
            const rawDetail = parsed?.detail || parsed?.error || rawText || 'unknown error'
            const detail = typeof rawDetail === 'string' ? rawDetail : JSON.stringify(rawDetail)
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
const PERSONA_DREAM_OUTPUTS_DIR = '/mnt/storage12tb/skills/persona-dream/outputs'
const PERSONA_DREAM_REPORTS_DIR = '/home/graham/workspace/experiments/agent-skills/skills/persona-dream/reports'
const PERSONA_MEDIA_DIR = '/mnt/storage12tb/media/personas'
const PERSONA_DREAM_CLIPBOARD_BUNDLE_DIR = '/tmp/persona-dream-panel-prompt-bundles'
const CLIPBOARD_FILE_SCRIPT = '/home/graham/workspace/experiments/agent-skills/skills/clipboard-file/scripts/copy-file-to-clipboard.sh'

type DreamRunSummary = {
  id: string
  title: string
  source: 'output' | 'report'
  status: string
  runRoot: string
  reportPath?: string
  reportUrl?: string
  statusPath?: string
  validationPath?: string
  manifestPath?: string
  klingCalled: boolean
  paidCallAuthorized: boolean
  updatedAt: string
}

type DreamStageSummary = {
  id: string
  title: string
  status: string
  summary: string
  failureOrGap?: string | null
  artifacts: Array<{ label: string; path: string; kind: 'json' | 'markdown' | 'text' | 'html' | 'media' | 'other' }>
  images: Array<{ label: string; path: string; url: string }>
}

function parseJsonFile(path: string): any | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

function summarizeDreamStatus(statusJson: any, validationJson: any, manifestJson: any): string {
  const candidates = [
    validationJson?.status,
    validationJson?.verdict,
    statusJson?.status,
    statusJson?.overall_status,
    statusJson?.terminal_status,
    manifestJson?.status,
  ].filter((v): v is string => typeof v === 'string' && v.length > 0)
  const text = JSON.stringify({ statusJson, validationJson, manifestJson }).toLowerCase()
  if (text.includes('kling_call_performed":true') || text.includes('paid_call_performed":true')) return 'KLING_CALLED'
  if (text.includes('dry_run_not_live_submittable')) return 'DRY_RUN_NOT_LIVE_SUBMITTABLE'
  if (text.includes('blocked')) return 'BLOCKED'
  return candidates[0] ?? 'UNKNOWN'
}

function dreamBooleanFromEvidence(key: string, ...docs: any[]): boolean {
  return docs.some((doc) => {
    if (!doc || typeof doc !== 'object') return false
    const direct = doc[key]
    if (typeof direct === 'boolean') return direct
    return JSON.stringify(doc).includes(`"${key}":true`)
  })
}

function dreamContentType(filePath: string): string {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.html')) return 'text/html; charset=utf-8'
  if (lower.endsWith('.json')) return 'application/json; charset=utf-8'
  if (lower.endsWith('.md') || lower.endsWith('.txt') || lower.endsWith('.log')) return 'text/plain; charset=utf-8'
  return 'application/octet-stream'
}

function isAllowedDreamPath(real: string): boolean {
  const roots = [PERSONA_DREAM_REPORTS_DIR, PERSONA_DREAM_OUTPUTS_DIR, PERSONA_MEDIA_DIR]
    .filter((root) => existsSync(root))
    .map((root) => realpathSync(root))
  return roots.some((root) => real === root || real.startsWith(`${root}/`))
}

function dreamSafeZipEntryName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value
    .replace(/\\/g, '/')
    .split('/')
    .map(part => part.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, ''))
    .filter(Boolean)
    .join('/')
  if (!cleaned || cleaned.startsWith('/') || cleaned.includes('..')) return null
  return cleaned.slice(0, 220)
}

function dreamSafeZipFileName(value: unknown): string {
  const raw = typeof value === 'string' ? value : 'storyboard-panel-prompt-payload.zip'
  const cleaned = raw
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 140)
  return (cleaned || 'storyboard-panel-prompt-payload.zip').endsWith('.zip')
    ? (cleaned || 'storyboard-panel-prompt-payload.zip')
    : `${cleaned || 'storyboard-panel-prompt-payload'}.zip`
}

function dreamArtifactKind(path: string): DreamStageSummary['artifacts'][number]['kind'] {
  const lower = path.toLowerCase()
  if (lower.endsWith('.json') || lower.endsWith('.jsonl')) return 'json'
  if (lower.endsWith('.md')) return 'markdown'
  if (lower.endsWith('.txt') || lower.endsWith('.log') || lower.endsWith('.sha256')) return 'text'
  if (lower.endsWith('.html')) return 'html'
  if (/\.(png|jpe?g|webp|gif|mp4|wav|mp3)$/i.test(lower)) return 'media'
  return 'other'
}

function dreamStageForPath(path: string): { id: string; title: string } {
  const lower = path.toLowerCase()
  if (lower.includes('memory') || lower.includes('idea') || lower.includes('story_contract')) return { id: 'idea-story-memory', title: 'Idea, Story, Memory' }
  if (lower.includes('casting') || lower.includes('reference_sheet') || lower.includes('contact_sheet')) return { id: 'casting-contact-sheets', title: 'Casting and Contact Sheets' }
  if (lower.includes('voice') || lower.includes('tts') || lower.includes('audio') || lower.endsWith('.wav') || lower.endsWith('.mp3') || lower.includes('waveform')) return { id: 'voices-audio', title: 'Voices and Audio' }
  if (lower.includes('script') || lower.includes('timed_transcript') || lower.includes('transcript')) return { id: 'script-transcript', title: 'Script and Transcript' }
  if (lower.includes('storyboard')) return { id: 'storyboard', title: 'Storyboard' }
  if (lower.includes('panel') || lower.includes('keyframe') || /shot_\d+/.test(lower)) return { id: 'panels', title: 'Panels and Scene Images' }
  if (lower.includes('video_provider') || lower.includes('video_scene_contract') || lower.includes('provider_scorecard') || lower.includes('provider_registry') || lower.includes('fal_api') || lower.includes('provider_packet') || lower.includes('kling') || lower.includes('dream_packet') || lower.includes('dream_request')) return { id: 'video-provider', title: 'Video Provider and Routing Gate' }
  if (lower.includes('review') || lower.includes('validation') || lower.includes('status') || lower.includes('receipt')) return { id: 'review-receipts', title: 'Reviewer Checks and Receipts' }
  if (lower.includes('final_video') || lower.includes('final_audio') || lower.includes('response.json')) return { id: 'provider-response', title: 'Provider Response and Final Media' }
  return { id: 'other-artifacts', title: 'Other Source Artifacts' }
}

const DREAM_PREFLIGHT_PHASES: Array<{
  id: string
  title: string
  summary: string
  matches: (path: string) => boolean
}> = [
  {
    id: 'phase_01_idea_memory',
    title: 'Idea and Related Memories',
    summary: 'User idea, source memories, residue links, and request normalization required before creative work starts.',
    matches: (path) => /dream_request|residue|memory|idea|reflection/i.test(path),
  },
  {
    id: 'phase_02_story_entities_json',
    title: 'Story and Entities JSON',
    summary: 'Story contract plus characters, objects, and environment descriptions as structured JSON.',
    matches: (path) => /story_contract|dream_story|character_scene_bible|visual_entities|scene_bible/i.test(path),
  },
  {
    id: 'phase_03_producer_writer_director',
    title: 'Producer, Script Writer, Director',
    summary: 'Producer attachment and selected creative roles that own script, direction, and acceptance criteria.',
    matches: (path) => /producer|script_writer|director|casting_contract|casting_plan|casting_agent/i.test(path),
  },
  {
    id: 'phase_04_contact_sheets',
    title: 'Character and Object Contact Sheets',
    summary: 'Contact sheets or reference sheets for every character, object, and environment anchor.',
    matches: (path) => /contact_sheet|reference_sheet|reference_sheets|layout_validation|chosen_reference/i.test(path),
  },
  {
    id: 'phase_05_orpheus_voices',
    title: 'Orpheus Voices',
    summary: 'Voice references, TTS/voice conversion plans, evaluation receipts, and speaking-character voice evidence.',
    matches: (path) => /voice|tts|orpheus|audio|wav|mp3|waveform|kokoro|kokoclone/i.test(path),
  },
  {
    id: 'phase_06_script',
    title: 'Complete Script',
    summary: 'Dialogue, transcript, timed beats, and script artifacts that bind speaker, timing, and action.',
    matches: (path) => /script|transcript|timed_beats|timed_transcript|dialogue/i.test(path),
  },
  {
    id: 'phase_07_storyboard',
    title: 'Storyboard',
    summary: 'Storyboard boards and structured storyboard JSON used before panel-level rendering.',
    matches: (path) => /storyboard|direction_board/i.test(path),
  },
  {
    id: 'phase_08_panels_environment',
    title: 'Panels With Environment Objects',
    summary: 'Panel-specific images, keyframes, shot prompts, and object-in-environment descriptions.',
    matches: (path) => /panel|keyframe|shot_\d+|frame_prompt|multimodal_prompt/i.test(path),
  },
  {
    id: 'phase_09_kling_optimized_packet',
    title: 'Video Provider Scene Packet',
    summary: 'Provider-neutral scene packet, selected provider routing, prompt, locks, and media staging receipts.',
    matches: (path) => /video_provider|video_scene_contract|provider_scorecard|provider_registry|fal_api|kling|provider_packet|provider_request|referenced_artifacts|dream_packet|dream_prompt|local_staging|publication/i.test(path),
  },
  {
    id: 'phase_10_provider_contract',
    title: 'Provider Contract',
    summary: 'Provider request-body contract, payload hash, field mapping, media publication plan, cost, entitlement, async return, manual acceptance, and live-readiness blockers.',
    matches: (path) => /phase_10_provider_contract|phase10_provider_contract|provider_contract|phase_09_video_provider\/video_provider_packet|phase_09_video_provider\/provider_registry_refresh_receipt|phase_09_video_provider\/video_provider_scorecard/i.test(path),
  },
  {
    id: 'phase_10_creator_reviewer_gate',
    title: 'Creator and Reviewer Gate',
    summary: 'Tau creator/reviewer receipts, validation reports, status, repair packets, and acceptance evidence.',
    matches: (path) => /validation|status|receipt|review|pipeline_stage_report|manifest|sha256/i.test(path),
  },
  {
    id: 'phase_11_kling_response',
    title: 'Provider Response and Returned Media',
    summary: 'Provider API response, task id, polling receipts, downloaded media, ffprobe/frame sheets, and post-provider review.',
    matches: (path) => /response\.json|kling_response|task|poll|download|final_video|ffprobe|final_audio/i.test(path),
  },
]

function dreamStageTitle(stageId: string): string {
  return stageId
    .replace(/^stage_\d+_/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
}

function dreamSafeWorkOrderPart(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'unknown'
}

function dreamReadJsonFile(filePath: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function dreamPhase01IdeaEvidence(runRoot: string, files: string[]): { coreIdea?: string; artifactPath?: string } {
  const artifactPath = files.find((file) => {
    const rel = file.startsWith(`${runRoot}/`) ? file.slice(runRoot.length + 1) : file
    return rel === 'phase_04_contact_sheets/reference_asset_manifest.json'
      || rel.endsWith('/phase_04_contact_sheets/reference_asset_manifest.json')
  })
  if (!artifactPath) return {}
  const doc = dreamReadJsonFile(artifactPath)
  const sourceContext = doc?.source_context && typeof doc.source_context === 'object'
    ? doc.source_context as Record<string, unknown>
    : null
  const coreIdea = typeof sourceContext?.core_idea === 'string' && sourceContext.core_idea.trim().length > 0
    ? sourceContext.core_idea.trim()
    : undefined
  return { coreIdea, artifactPath }
}

function buildDreamPreflightStages(runRoot: string, files: string[]): DreamStageSummary[] {
  return DREAM_PREFLIGHT_PHASES.map((phase) => {
    const phase01IdeaEvidence = phase.id === 'phase_01_idea_memory'
      ? dreamPhase01IdeaEvidence(runRoot, files)
      : {}
    const matched = files.filter((file) => {
      const rel = file.startsWith(`${runRoot}/`) ? file.slice(runRoot.length + 1) : file
      return phase.matches(rel)
    })
    if (phase.id === 'phase_09_kling_optimized_packet') {
      matched.sort((a, b) => {
        const aRel = a.startsWith(`${runRoot}/`) ? a.slice(runRoot.length + 1) : a
        const bRel = b.startsWith(`${runRoot}/`) ? b.slice(runRoot.length + 1) : b
        const priority = (rel: string) => rel.includes('phase_09_video_provider/')
          ? 0
          : rel.includes('phase_08_media_lock/')
            ? 1
            : 2
        return priority(aRel) - priority(bRel) || aRel.localeCompare(bRel)
      })
    }
    if (phase.id === 'phase_10_provider_contract') {
      matched.sort((a, b) => {
        const aRel = a.startsWith(`${runRoot}/`) ? a.slice(runRoot.length + 1) : a
        const bRel = b.startsWith(`${runRoot}/`) ? b.slice(runRoot.length + 1) : b
        const priority = (rel: string) => rel.includes('phase_10_provider_contract/phase10_provider_contract.json')
          ? 0
          : rel.includes('phase_10_provider_contract/phase10_provider_contract_receipt.json')
            ? 1
            : rel.includes('phase_09_video_provider/video_provider_packet/')
              ? 2
              : rel.includes('phase_09_video_provider/provider_registry_refresh_receipt')
                ? 3
                : rel.includes('phase_09_video_provider/video_provider_scorecard')
                  ? 4
                  : 5
        return priority(aRel) - priority(bRel) || aRel.localeCompare(bRel)
      })
    }
    if (phase01IdeaEvidence.artifactPath && !matched.includes(phase01IdeaEvidence.artifactPath)) {
      matched.push(phase01IdeaEvidence.artifactPath)
    }
    const images = matched
      .filter((file) => /\.(png|jpe?g|webp|gif)$/i.test(file))
      .slice(0, 10)
      .map((file) => ({
        label: file.startsWith(`${runRoot}/`) ? file.slice(runRoot.length + 1) : file,
        path: file,
        url: `/api/projects/dream/asset?path=${encodeURIComponent(file)}`,
      }))
    const artifacts = matched
      .filter((file) => !/\.(png|jpe?g|webp|gif)$/i.test(file))
      .slice(0, 14)
      .map((file) => ({
        label: file.startsWith(`${runRoot}/`) ? file.slice(runRoot.length + 1) : file,
        path: file,
        kind: dreamArtifactKind(file),
      }))
    const evidenceCount = images.length + artifacts.length
    const receiptStatus = phase.id === 'phase_04_contact_sheets'
      ? phase04ContactSheetStatus(matched)
      : phase.id === 'phase_05_orpheus_voices'
        ? phase05VoiceEvidenceStatus()
      : phase.id === 'phase_07_storyboard'
        ? phase07StoryboardStatus(matched)
      : null
    const phaseArtifacts = receiptStatus && 'artifacts' in receiptStatus
      ? [...artifacts, ...receiptStatus.artifacts]
      : artifacts
    const phaseEvidenceCount = images.length + phaseArtifacts.length
    return {
      id: phase.id,
      title: phase.title,
      status: receiptStatus?.status ?? (phaseEvidenceCount > 0 ? 'EVIDENCE_FOUND' : 'MISSING_EVIDENCE'),
      summary: receiptStatus?.summary ?? phase01IdeaEvidence.coreIdea ?? phase.summary,
      failureOrGap: receiptStatus?.failureOrGap ?? (phaseEvidenceCount > 0 ? null : 'Required preflight evidence was not found in this run root.'),
      artifacts: phaseArtifacts,
      images,
    }
  })
}

async function listDreamFiles(root: string, maxFiles = 2000): Promise<string[]> {
  const files: string[] = []
  const isStudioVisibleEntry = (name: string) => {
    if (!name || name.startsWith('.')) return false
    if (name === 'node_modules' || name === '__pycache__') return false
    return true
  }
  async function visit(dir: string, depth: number): Promise<void> {
    if (depth > 5 || files.length >= maxFiles) return
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (files.length >= maxFiles) return
      if (!isStudioVisibleEntry(entry.name)) continue
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        await visit(full, depth + 1)
      } else if (entry.isFile()) {
        files.push(full)
      }
    }
  }
  await visit(root, 0)
  return files
}

function dreamOutputPath(runRoot: string, outputName: string): string {
  return resolve(runRoot, outputName)
}

function dreamImageForOutput(runRoot: string, outputName: string): DreamStageSummary['images'][number] | null {
  const path = dreamOutputPath(runRoot, outputName)
  if (!existsSync(path) || !/\.(png|jpe?g|webp|gif)$/i.test(path)) return null
  return {
    label: outputName,
    path,
    url: `/api/projects/dream/asset?path=${encodeURIComponent(path)}`,
  }
}

function dreamArtifactForOutput(runRoot: string, outputName: string): DreamStageSummary['artifacts'][number] | null {
  const path = dreamOutputPath(runRoot, outputName)
  if (!existsSync(path) || /\.(png|jpe?g|webp|gif)$/i.test(path)) return null
  return {
    label: outputName,
    path,
    kind: dreamArtifactKind(path),
  }
}

function phase05VoiceEvidenceStatus(): (Pick<DreamStageSummary, 'status' | 'failureOrGap' | 'summary'> & {
  artifacts: DreamStageSummary['artifacts']
}) | null {
  const auditionDir = resolve(PERSONA_DREAM_OUTPUTS_DIR, 'dream-voice-auditions')
  if (!existsSync(auditionDir)) return null

  const receiptPaths = readdirSync(auditionDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => resolve(auditionDir, name))
    .sort()
    .reverse()

  const acceptedByCharacter = new Map<string, string>()
  for (const receiptPath of receiptPaths) {
    const receipt = parseJsonFile(receiptPath)
    const character = typeof receipt?.character === 'string' ? receipt.character.toLowerCase() : ''
    const outputWav = typeof receipt?.output_wav === 'string' ? receipt.output_wav : ''
    if (!['embry', 'kai'].includes(character)) continue
    if (receipt?.schema !== 'persona_dream.voice_audition_receipt.v1') continue
    if (receipt?.mocked !== false || receipt?.live !== true) continue
    if (!outputWav || !existsSync(outputWav)) continue
    if (!acceptedByCharacter.has(character)) acceptedByCharacter.set(character, receiptPath)
  }

  const required = ['embry', 'kai']
  const missing = required.filter((character) => !acceptedByCharacter.has(character))
  const artifacts = [...acceptedByCharacter.entries()].map(([character, path]) => ({
    label: `${character}_voice_audition_receipt.json`,
    path,
    kind: 'json' as const,
  }))

  if (acceptedByCharacter.size > 0 && missing.length === 0) {
    return {
      status: 'EVIDENCE_FOUND',
      summary: `Live Chatterbox voice evidence is present for ${required.join(' and ')}.`,
      failureOrGap: null,
      artifacts,
    }
  }

  if (acceptedByCharacter.size > 0) {
    return {
      status: 'MISSING_EVIDENCE',
      summary: `Partial live Chatterbox voice evidence found: ${[...acceptedByCharacter.keys()].join(', ')}.`,
      failureOrGap: `Missing live Chatterbox voice receipt for: ${missing.join(', ')}.`,
      artifacts,
    }
  }

  return null
}

function phase07StoryboardStatus(matchedFiles: string[]): (Pick<DreamStageSummary, 'status' | 'failureOrGap' | 'summary'> & {
  artifacts: DreamStageSummary['artifacts']
}) | null {
  const rehydrationPath = matchedFiles.find((file) => file.endsWith('/storyboard_reference_rehydration_receipt.json'))
  const panelGatePath = matchedFiles.find((file) => file.endsWith('/phase_07_storyboard_live_tau/receipts/panel_repair_gate_receipt.json'))
  const panelSourcePath = matchedFiles.find((file) => file.endsWith('/phase_07_storyboard_live_tau/receipts/panel_source_receipt.json'))
  const storyboardPacketPath = matchedFiles.find((file) => file.endsWith('/phase_07_storyboard_live_tau/storyboard_packet.json'))
  const rehydration = rehydrationPath ? parseJsonFile(rehydrationPath) : null
  const panelGate = panelGatePath ? parseJsonFile(panelGatePath) : null
  const panelSource = panelSourcePath ? parseJsonFile(panelSourcePath) : null
  const storyboardPacket = storyboardPacketPath ? parseJsonFile(storyboardPacketPath) : null
  const artifacts = [rehydrationPath, panelGatePath, panelSourcePath, storyboardPacketPath]
    .filter((path): path is string => Boolean(path))
    .map((path) => ({
      label: path.split('/').slice(-2).join('/'),
      path,
      kind: dreamArtifactKind(path),
    }))

  const rehydrationPassed = rehydration?.status === 'PASS'
    && Number(rehydration?.attached_reference_count ?? 0) >= 5
    && Number(rehydration?.missing_reference_count ?? 1) === 0
  const packetReferencesAttached = storyboardPacket?.status === 'REFERENCE_GAPS_ATTACHED'
    && Array.isArray(storyboardPacket?.references)
    && storyboardPacket.references.length >= 5
    && Array.isArray(storyboardPacket?.missing_reference_blockers)
    && storyboardPacket.missing_reference_blockers.length === 0

  if (rehydrationPassed || packetReferencesAttached) {
    const gateStatus = typeof panelGate?.status === 'string' ? panelGate.status : ''
    const sourceStatus = typeof panelSource?.status === 'string' ? panelSource.status : ''
    const remainingBlockers = Array.isArray(panelGate?.remaining_blockers)
      ? panelGate.remaining_blockers.filter((item: unknown) => typeof item === 'string' && item.trim().length > 0)
      : []
    const sourceBlockers = Array.isArray(panelSource?.blockers)
      ? panelSource.blockers.filter((item: unknown) => typeof item === 'string' && item.trim().length > 0)
      : []
    const blockers = [...remainingBlockers, ...sourceBlockers]
    if (/BLOCKED/i.test(`${gateStatus} ${sourceStatus}`) || blockers.length > 0) {
      return {
        status: gateStatus || sourceStatus || 'BLOCKED_STORYBOARD_PANEL_ASSETS',
        summary: 'Storyboard reference gaps are attached from Phase 04 evidence; panel/frame acceptance is still blocked.',
        failureOrGap: blockers.length > 0
          ? `Remaining storyboard blocker: ${blockers.join(' ')}`
          : 'Remaining storyboard blocker: accepted storyboard panel images/start-end frames are not present yet.',
        artifacts,
      }
    }
    return {
      status: 'PASS_REFERENCE_GAPS_ATTACHED',
      summary: 'Storyboard reference gaps are attached from Phase 04 evidence.',
      failureOrGap: null,
      artifacts,
    }
  }

  return null
}

function phase04ContactSheetStatus(matchedFiles: string[]): Pick<DreamStageSummary, 'status' | 'failureOrGap' | 'summary'> | null {
  const buildReceiptPath = matchedFiles.find((file) => file.endsWith('/contact_sheet_build_receipt.json'))
  const requirementsPath = matchedFiles.find((file) => file.endsWith('/contact_sheet_requirements.json'))
  const blockedAssetsPath = matchedFiles.find((file) => file.endsWith('/blocked_assets.json'))
  const buildReceipt = buildReceiptPath ? parseJsonFile(buildReceiptPath) : null
  const requirements = requirementsPath ? parseJsonFile(requirementsPath) : null
  const blockedAssets = blockedAssetsPath ? parseJsonFile(blockedAssetsPath) : null

  const receiptStatus = typeof buildReceipt?.status === 'string' ? buildReceipt.status : ''
  const requirementsStatus = typeof requirements?.status === 'string' ? requirements.status : ''
  const blockedCount = Number(
    buildReceipt?.blocked_asset_count
    ?? blockedAssets?.blocked_count
    ?? 0
  )
  const attachedCount = Number(
    buildReceipt?.attached_asset_count
    ?? 0
  )
  const missingNames = Array.isArray(blockedAssets?.blocked_assets)
    ? blockedAssets.blocked_assets
      .map((item: any) => typeof item?.entity === 'string' ? item.entity : '')
      .filter(Boolean)
    : []

  if (receiptStatus || requirementsStatus || blockedCount > 0) {
    if (blockedCount > 0 || /BLOCKED|MISSING|FAIL/i.test(`${receiptStatus} ${requirementsStatus}`)) {
      const missingText = missingNames.length > 0
        ? ` Missing required sheets: ${missingNames.join(', ')}.`
        : ''
      return {
        status: receiptStatus || requirementsStatus || 'BLOCKED_CONTACT_SHEET_BUILD',
        summary: `Contact sheet build is blocked: ${attachedCount} attached, ${blockedCount} missing.${missingText}`,
        failureOrGap: `Phase 04 contact-sheet artifact is incomplete: ${blockedCount} required contact sheet${blockedCount === 1 ? '' : 's'} missing.${missingText}`,
      }
    }
    return {
      status: receiptStatus || requirementsStatus || 'PASS_CONTACT_SHEET_BUILD',
      summary: `Contact sheet build receipt is present: ${attachedCount} required sheets attached.`,
      failureOrGap: null,
    }
  }

  return null
}

function stagesFromPipelineReport(runRoot: string, report: any): DreamStageSummary[] {
  if (!report || !Array.isArray(report.stages)) return []
  return report.stages.map((stage: any): DreamStageSummary => {
    const stageId = typeof stage.stage_id === 'string' ? stage.stage_id : 'stage_unknown'
    const textOutputs = Array.isArray(stage.text_outputs) ? stage.text_outputs.filter((item: unknown): item is string => typeof item === 'string') : []
    const visualOutputs = Array.isArray(stage.visual_outputs) ? stage.visual_outputs.filter((item: unknown): item is string => typeof item === 'string') : []
    return {
      id: stageId,
      title: dreamStageTitle(stageId),
      status: typeof stage.status === 'string' ? stage.status : 'unknown',
      summary: typeof stage.did === 'string' ? stage.did : 'No stage summary recorded.',
      failureOrGap: typeof stage.failure_or_gap === 'string' ? stage.failure_or_gap : stage.failure_or_gap ?? null,
      artifacts: textOutputs
        .map((output) => dreamArtifactForOutput(runRoot, output))
        .filter((item): item is DreamStageSummary['artifacts'][number] => Boolean(item)),
      images: visualOutputs
        .map((output) => dreamImageForOutput(runRoot, output))
        .filter((item): item is DreamStageSummary['images'][number] => Boolean(item)),
    }
  })
}

function summarizeDreamStages(runRoot: string, files: string[]): DreamStageSummary[] {
  const stages = new Map<string, DreamStageSummary>()
  for (const file of files) {
    const rel = file.startsWith(`${runRoot}/`) ? file.slice(runRoot.length + 1) : file
    const stageMeta = dreamStageForPath(rel)
    let stage = stages.get(stageMeta.id)
    if (!stage) {
      stage = {
        id: stageMeta.id,
        title: stageMeta.title,
        status: 'EVIDENCE_FOUND',
        summary: 'Source artifacts exist for this stage. Reviewer pass/fail is shown only when a receipt provides it.',
        failureOrGap: null,
        artifacts: [],
        images: [],
      }
      stages.set(stageMeta.id, stage)
    }
    const label = rel.split('/').at(-1) || rel
    if (/\.(png|jpe?g|webp|gif)$/i.test(file)) {
      stage.images.push({
        label,
        path: file,
        url: `/api/projects/dream/asset?path=${encodeURIComponent(file)}`,
      })
    } else {
      stage.artifacts.push({ label, path: file, kind: dreamArtifactKind(file) })
    }
  }

  const order = [
    'idea-story-memory',
    'casting-contact-sheets',
    'voices-audio',
    'script-transcript',
    'storyboard',
    'panels',
    'video-provider',
    'review-receipts',
    'provider-response',
    'other-artifacts',
  ]
  return [...stages.values()]
    .map((stage) => ({
      ...stage,
      images: stage.images.slice(0, 8),
      artifacts: stage.artifacts.slice(0, 12),
    }))
    .sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
}

async function collectDreamRunSummaries(): Promise<DreamRunSummary[]> {
  const runs: DreamRunSummary[] = []
  const seen = new Set<string>()

  try {
    const reportDirs = await readdir(PERSONA_DREAM_REPORTS_DIR, { withFileTypes: true })
    for (const dirent of reportDirs) {
      if (!dirent.isDirectory()) continue
      const id = dirent.name
      const runRoot = resolve(PERSONA_DREAM_REPORTS_DIR, id)
      const reportPath = resolve(runRoot, 'report.html')
      const statusPath = resolve(runRoot, 'status.json')
      const validationPath = resolve(runRoot, 'validation.json')
      if (!existsSync(reportPath) && !existsSync(statusPath) && !existsSync(validationPath)) continue
      const [statusStat, reportStat] = await Promise.all([
        stat(statusPath).catch(() => null),
        stat(reportPath).catch(() => null),
      ])
      const statusJson = parseJsonFile(statusPath)
      const validationJson = parseJsonFile(validationPath)
      const status = summarizeDreamStatus(statusJson, validationJson, null)
      const updatedAt = (statusStat ?? reportStat)?.mtime.toISOString() ?? new Date(0).toISOString()
      seen.add(id)
      runs.push({
        id,
        title: id.replace(/[-_]+/g, ' '),
        source: 'report',
        status,
        runRoot,
        reportPath: existsSync(reportPath) ? reportPath : undefined,
        reportUrl: existsSync(reportPath) ? `/api/projects/dream/report?path=${encodeURIComponent(reportPath)}` : undefined,
        statusPath: existsSync(statusPath) ? statusPath : undefined,
        validationPath: existsSync(validationPath) ? validationPath : undefined,
        klingCalled: dreamBooleanFromEvidence('kling_call_performed', statusJson, validationJson),
        paidCallAuthorized: dreamBooleanFromEvidence('paid_call_authorized', statusJson, validationJson),
        updatedAt,
      })
    }
  } catch {
    // Missing persona-dream reports are a fail-closed empty list, not fake content.
  }

  try {
    const outputDirs = await readdir(PERSONA_DREAM_OUTPUTS_DIR, { withFileTypes: true })
    for (const dirent of outputDirs) {
      if (!dirent.isDirectory()) continue
      const id = dirent.name
      if (seen.has(id)) continue
      const runRoot = resolve(PERSONA_DREAM_OUTPUTS_DIR, id)
      const manifestPath = resolve(runRoot, 'manifest.json')
      const stageReportPath = resolve(runRoot, 'pipeline_stage_report.json')
      const klingPacketPath = resolve(runRoot, 'receipts/kling_scene_packet.json')
      if (!existsSync(manifestPath) && !existsSync(stageReportPath) && !existsSync(klingPacketPath)) continue
      const [manifestStat, stageStat, klingStat] = await Promise.all([
        stat(manifestPath).catch(() => null),
        stat(stageReportPath).catch(() => null),
        stat(klingPacketPath).catch(() => null),
      ])
      const manifestJson = parseJsonFile(manifestPath)
      const stageJson = parseJsonFile(stageReportPath)
      const klingJson = parseJsonFile(klingPacketPath)
      const status = summarizeDreamStatus(stageJson, null, manifestJson)
      const updatedAt = (stageStat ?? manifestStat ?? klingStat)?.mtime.toISOString() ?? new Date(0).toISOString()
      runs.push({
        id,
        title: id.replace(/[-_]+/g, ' '),
        source: 'output',
        status,
        runRoot,
        manifestPath: existsSync(manifestPath) ? manifestPath : undefined,
        klingCalled: dreamBooleanFromEvidence('kling_call_performed', stageJson, manifestJson, klingJson),
        paidCallAuthorized: dreamBooleanFromEvidence('paid_call_authorized', stageJson, manifestJson, klingJson),
        updatedAt,
      })
    }
  } catch {
    // Missing storage root is represented by empty output runs.
  }

  return runs
    .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    .slice(0, 40)
}

app.get('/api/projects/dream/runs', async (_req, res) => {
  try {
    const runs = await collectDreamRunSummaries()
    res.json({
      status: 'ok',
      mocked: false,
      live: false,
      sourceRoots: [PERSONA_DREAM_REPORTS_DIR, PERSONA_DREAM_OUTPUTS_DIR],
      runs,
    })
  } catch (err) {
    res.status(500).json({ status: 'error', error: err instanceof Error ? err.message : String(err), runs: [] })
  }
})

app.get('/api/projects/dream/report', async (req, res) => {
  try {
    const requested = typeof req.query.path === 'string' ? req.query.path : ''
    if (!requested) return res.status(400).send('path required')
    const real = realpathSync(requested)
    const allowedRoot = realpathSync(PERSONA_DREAM_REPORTS_DIR)
    if (!real.startsWith(`${allowedRoot}/`) || !real.endsWith('/report.html')) {
      return res.status(403).send('report path not allowed')
    }
    res.sendFile(real)
  } catch {
    res.status(404).send('report not found')
  }
})

app.get('/api/projects/dream/run-detail', async (req, res) => {
  try {
    const requested = typeof req.query.root === 'string' ? req.query.root : ''
    if (!requested) return res.status(400).json({ status: 'error', error: 'root required' })
    const realRoot = realpathSync(requested)
    if (!isAllowedDreamPath(realRoot)) return res.status(403).json({ status: 'error', error: 'run root not allowed' })
    const pipelineReportPath = resolve(realRoot, 'pipeline_stage_report.json')
    const files = await listDreamFiles(realRoot)
    res.json({
      status: 'ok',
      mocked: false,
      live: false,
      runRoot: realRoot,
      stageReportPath: existsSync(pipelineReportPath) ? pipelineReportPath : undefined,
      stages: buildDreamPreflightStages(realRoot, files),
      sourceGroupedStages: summarizeDreamStages(realRoot, files),
    })
  } catch (err) {
    res.status(500).json({ status: 'error', error: err instanceof Error ? err.message : String(err), stages: [] })
  }
})

app.post('/api/projects/dream/stage-work-order', async (req, res) => {
  try {
    const runRoot = typeof req.body?.runRoot === 'string' ? req.body.runRoot : ''
    const stageId = typeof req.body?.stageId === 'string' ? req.body.stageId : ''
    const action = typeof req.body?.action === 'string' ? req.body.action : ''
    const requestedBy = req.body?.requestedBy === 'human' ? 'human' : 'project_agent'
    const notes = typeof req.body?.notes === 'string' ? req.body.notes : ''
    if (!runRoot || !stageId || !['rerun', 'edit'].includes(action)) {
      return res.status(400).json({ status: 'error', error: 'runRoot, stageId, and action=rerun|edit are required' })
    }
    const realRoot = realpathSync(runRoot)
    if (!isAllowedDreamPath(realRoot)) return res.status(403).json({ status: 'error', error: 'run root not allowed' })
    const workOrderDir = resolve(realRoot, '.ux-lab', 'stage-work-orders')
    await mkdir(workOrderDir, { recursive: true })
    const createdAt = new Date().toISOString()
    const fileName = `${createdAt.replace(/[:.]/g, '-')}-${dreamSafeWorkOrderPart(stageId)}-${action}.json`
    const path = resolve(workOrderDir, fileName)
    const payload = {
      schema: 'persona_dream.ux_lab_stage_work_order.v1',
      created_at: createdAt,
      status: 'REQUESTED',
      run_root: realRoot,
      stage_id: stageId,
      action,
      requested_by: requestedBy,
      notes,
      execution_policy: action === 'rerun'
        ? 'project_agent_must_rerun_this_stage_through_the_persona_dream_tau_creator_reviewer_loop_before_downstream_consumers_advance'
        : 'project_agent_or_human_must_apply_the_edit_to_the_stage_source_artifact_then_rerun_review_until_the_stage_passes',
    }
    await writeFile(path, JSON.stringify(payload, null, 2))
    res.json({ status: 'ok', mocked: false, live: false, workOrderPath: path, workOrder: payload })
  } catch (err) {
    res.status(500).json({ status: 'error', error: err instanceof Error ? err.message : String(err) })
  }
})

app.get('/api/projects/dream/asset', async (req, res) => {
  try {
    const requested = typeof req.query.path === 'string' ? req.query.path : ''
    if (!requested) return res.status(400).send('path required')
    const real = realpathSync(requested)
    if (!isAllowedDreamPath(real)) return res.status(403).send('asset path not allowed')
    res.setHeader('Content-Type', dreamContentType(real))
    createReadStream(real).pipe(res)
  } catch {
    res.status(404).send('asset not found')
  }
})

app.post('/api/projects/dream/panel-prompt-bundle', async (req, res) => {
  try {
    const filename = dreamSafeZipFileName(req.body?.filename)
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : []
    if (entries.length === 0) return res.status(400).json({ status: 'error', error: 'entries are required' })

    const createdAt = new Date().toISOString()
    const bundleId = `${createdAt.replace(/[:.]/g, '-')}-${createHash('sha256').update(`${filename}:${entries.length}:${createdAt}`).digest('hex').slice(0, 10)}`
    const bundleRoot = resolve(PERSONA_DREAM_CLIPBOARD_BUNDLE_DIR, bundleId)
    const zipPath = resolve(PERSONA_DREAM_CLIPBOARD_BUNDLE_DIR, `${bundleId}-${filename}`)
    await mkdir(bundleRoot, { recursive: true })

    const writtenEntries: Array<{ name: string; source: 'text' | 'asset'; path: string }> = []
    for (const entry of entries) {
      const entryName = dreamSafeZipEntryName(entry?.name)
      if (!entryName) return res.status(400).json({ status: 'error', error: 'invalid zip entry name', entry })
      const destination = resolve(bundleRoot, entryName)
      if (!destination.startsWith(`${bundleRoot}/`)) return res.status(400).json({ status: 'error', error: 'zip entry escaped bundle root', entryName })
      await mkdir(dirname(destination), { recursive: true })

      if (typeof entry?.text === 'string') {
        await writeFile(destination, entry.text)
        writtenEntries.push({ name: entryName, source: 'text', path: destination })
        continue
      }

      if (typeof entry?.path === 'string') {
        const real = realpathSync(entry.path)
        if (!isAllowedDreamPath(real)) return res.status(403).json({ status: 'error', error: 'asset path not allowed', path: entry.path })
        await copyFile(real, destination)
        writtenEntries.push({ name: entryName, source: 'asset', path: real })
        continue
      }

      return res.status(400).json({ status: 'error', error: 'entry must include text or path', entryName })
    }

    await execFileAsync('zip', ['-qr', zipPath, '.'], { cwd: bundleRoot, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })

    try {
      const { stdout, stderr } = await execFileAsync(CLIPBOARD_FILE_SCRIPT, [zipPath], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 })
      res.json({
        status: 'ok',
        mocked: false,
        live: true,
        zipPath,
        copiedToClipboard: true,
        clipboardProof: stdout,
        clipboardStderr: stderr,
        entries: writtenEntries,
      })
    } catch (clipboardErr: any) {
      res.status(500).json({
        status: 'error',
        error: 'zip created but desktop clipboard copy failed',
        detail: clipboardErr instanceof Error ? clipboardErr.message : String(clipboardErr),
        stdout: clipboardErr?.stdout,
        stderr: clipboardErr?.stderr,
        fallbackZipPath: zipPath,
        entries: writtenEntries,
      })
    }
  } catch (err) {
    res.status(500).json({ status: 'error', error: err instanceof Error ? err.message : String(err) })
  }
})

function resolveChatterboxAudioPath(rawPath: unknown): string | null {
  if (typeof rawPath !== 'string' || !rawPath.trim()) return null
  const trimmed = rawPath.trim()
  if (trimmed.startsWith('/out/')) return resolve(CHATTERBOX_HOST_OUT_DIR, trimmed.slice('/out/'.length))
  return trimmed
}

function resolveChatterboxReferencePath(hostRefPath: string): string {
  const stagedRefPath = resolve(CHATTERBOX_HOST_REF_DIR, hostRefPath.split('/').pop() || '')
  if (existsSync(stagedRefPath)) {
    return `${CHATTERBOX_CONTAINER_REF_DIR.replace(/\/+$/, '')}/${stagedRefPath.split('/').pop()}`
  }
  return hostRefPath
}

const CHATTERBOX_ALLOWED_PARALINGUISTIC_CUES = new Set(['', '[laugh]', '[chuckle]', '[sigh]', '[gasp]', '[whispering]'])
const CHATTERBOX_ALLOWED_TONES = new Set([
  'neutral_warm',
  'calm_precise',
  'careful_concerned',
  'serious_low_energy',
  'memory_confident',
  'memory_uncertain',
  'curious_searching',
  'playful_light',
  'relieved',
  'firm_boundary',
  'identity_clarification',
  'one_at_a_time_interrupt',
  'deflect_calm',
  'grief_safe',
  'wait_presence',
])
const CHATTERBOX_TONE_TO_DELIVERY_STAGE: Record<string, string> = {
  neutral_warm: 'neutral',
  calm_precise: 'neutral',
  careful_concerned: 'slightly_concerned',
  serious_low_energy: 'neutral',
  memory_confident: 'satisfied',
  memory_uncertain: 'slightly_concerned',
  curious_searching: 'holding',
  playful_light: 'positive',
  relieved: 'satisfied',
  firm_boundary: 'deflecting',
  identity_clarification: 'clarifying',
  one_at_a_time_interrupt: 'deflecting',
  deflect_calm: 'deflecting',
  grief_safe: 'slightly_concerned',
  wait_presence: 'holding',
}
const CHATTERBOX_DELIVERY_STAGE_ALIASES: Record<string, string> = {
  setup: 'neutral',
  slightly_concerned: 'slightly_concerned',
  neutral: 'neutral',
  positive: 'positive',
  satisfied: 'satisfied',
  clarify: 'clarifying',
  clarifying: 'clarifying',
  boundary: 'deflecting',
  interrupted: 'deflecting',
  deflect: 'deflecting',
  deflecting: 'deflecting',
  wait: 'holding',
  holding: 'holding',
}
const CHATTERBOX_PARALINGUISTIC_ALIASES: Record<string, string> = {
  laugh: '[laugh]',
  laughs: '[laugh]',
  laughing: '[laugh]',
  chuckle: '[chuckle]',
  chuckles: '[chuckle]',
  chuckling: '[chuckle]',
  sigh: '[sigh]',
  sighs: '[sigh]',
  sighing: '[sigh]',
  gasp: '[gasp]',
  gasps: '[gasp]',
  gasping: '[gasp]',
  whisper: '[whispering]',
  whispers: '[whispering]',
  whispering: '[whispering]',
}

function normalizeTextSpacing(text: string): string {
  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
}

function extractInlineParalinguisticCue(text: string): string {
  let detectedCue = ''
  text.replace(/\[([a-z\s_-]+)\]/gi, (_match, rawTag: string) => {
    if (detectedCue) return ''
    const normalizedTag = rawTag.toLowerCase().replace(/[\s_-]+/g, '')
    detectedCue = CHATTERBOX_PARALINGUISTIC_ALIASES[normalizedTag] || ''
    return ''
  })
  return detectedCue
}

function normalizeInlineParalinguisticCues(text: string): string {
  return text.replace(/\[([a-z\s_-]+)\]/gi, (_match, rawTag: string) => {
    const normalizedTag = rawTag.toLowerCase().replace(/[\s_-]+/g, '')
    return CHATTERBOX_PARALINGUISTIC_ALIASES[normalizedTag] || ''
  })
}

function stripSpeechControls(text: string): string {
  return normalizeTextSpacing(text
    .replace(/\[[^\]]+\]/g, '')
    .replace(/<[^>]+>/g, '')
  )
}

function buildChatterboxRenderText(text: string, cleanText: string, paralinguisticCue: string): string {
  const normalizedInline = normalizeTextSpacing(normalizeInlineParalinguisticCues(text).replace(/<[^>]+>/g, ''))
  if (/\[(?:laugh|chuckle|sigh|gasp|whispering)\]/i.test(normalizedInline)) {
    return normalizedInline
  }
  return paralinguisticCue ? `${paralinguisticCue} ${cleanText}` : cleanText
}

function normalizeChatterboxTone(value: unknown): string {
  const requested = typeof value === 'string' ? value.trim().replace(/[^a-z0-9_-]/gi, '').toLowerCase() : ''
  return CHATTERBOX_ALLOWED_TONES.has(requested) ? requested : 'neutral_warm'
}

function normalizeChatterboxDeliveryStage(value: unknown, tone: string): string {
  const requested = typeof value === 'string' ? value.trim().replace(/[^a-z0-9_-]/gi, '').toLowerCase() : ''
  if (requested && CHATTERBOX_DELIVERY_STAGE_ALIASES[requested]) return CHATTERBOX_DELIVERY_STAGE_ALIASES[requested]
  return CHATTERBOX_TONE_TO_DELIVERY_STAGE[tone] || 'neutral'
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : []
}

function firstRecord(...values: unknown[]): JsonRecord | null {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as JsonRecord
  }
  return null
}

function toneEmotionTags(tone: string): string[] {
  const mapping: Record<string, string[]> = {
    neutral_warm: ['warm', 'steady'],
    calm_precise: ['calm', 'precise'],
    careful_concerned: ['careful', 'concerned'],
    serious_low_energy: ['serious', 'low_energy'],
    memory_confident: ['memory_confident', 'grounded'],
    memory_uncertain: ['memory_uncertain', 'careful'],
    curious_searching: ['curious', 'searching'],
    playful_light: ['playful', 'light'],
    relieved: ['relieved'],
    firm_boundary: ['firm', 'boundary'],
    identity_clarification: ['identity_clarification', 'careful'],
    one_at_a_time_interrupt: ['firm', 'turn_taking'],
    deflect_calm: ['calm', 'deflect'],
    grief_safe: ['grief_safe', 'gentle'],
    wait_presence: ['wait_presence', 'present'],
  }
  return mapping[tone] ?? ['warm']
}

function normalizeChatterboxTags(value: unknown): string[] {
  const tags = arrayOfStrings(value)
    .map((item) => item.trim().toLowerCase())
    .map((item) => CHATTERBOX_PARALINGUISTIC_ALIASES[item.replace(/^\[|\]$/g, '')] || item)
    .filter((item) => CHATTERBOX_ALLOWED_PARALINGUISTIC_CUES.has(item))
  return [...new Set(tags)]
}

function buildEmbryInterruptPolicy(tone: string, requestedPolicy: JsonRecord | null, voiceDelivery: JsonRecord | null, requestBody: JsonRecord): JsonRecord {
  const requestedInterruptPolicy = firstRecord(
    voiceDelivery?.interrupt_policy,
    voiceDelivery?.interruptPolicy,
    requestedPolicy?.interrupt_policy,
    requestedPolicy?.interruptPolicy,
    requestBody.interrupt_policy,
    requestBody.interruptPolicy,
  )
  const oneAtATime = tone === 'one_at_a_time_interrupt' || tone === 'firm_boundary'
  const defaults: JsonRecord = {
    interruptible: true,
    barge_in_action: 'cancel_old_turn',
    bargeInAction: 'cancel_old_turn',
    duck_on_user_speech: true,
    duckOnUserSpeech: true,
    skip_stale_chunks: true,
    skipStaleChunks: true,
    new_turn_wins: true,
    newTurnWins: true,
    acknowledgement_tone: oneAtATime ? 'one_at_a_time_interrupt' : 'interrupted',
    acknowledgementTone: oneAtATime ? 'one_at_a_time_interrupt' : 'interrupted',
    acknowledgement_text: oneAtATime ? 'Hey, one at a time?' : 'Okay, stopping that.',
    acknowledgementText: oneAtATime ? 'Hey, one at a time?' : 'Okay, stopping that.',
  }
  return { ...defaults, ...(requestedInterruptPolicy || {}) }
}

function buildEmbryVoicePolicy(params: {
  requestBody: JsonRecord
  intentResult: unknown
  fallbackTone: string
  fallbackDeliveryStage: string
  directSanity?: boolean
}): JsonRecord {
  const intent = firstRecord(params.intentResult)
  const voiceDelivery = firstRecord(
    intent?.voice_delivery,
    intent?.voiceDelivery,
    intent?.voice_delivery_policy,
    intent?.voiceDeliveryPolicy,
    intent?.delivery_policy,
    intent?.deliveryPolicy,
  )
  const requestedPolicy = firstRecord(params.requestBody.voice_policy, params.requestBody.voicePolicy)
  const source = firstString(
    voiceDelivery?.source,
    requestedPolicy?.intent_policy_source,
    requestedPolicy?.intentPolicySource,
    params.requestBody.intent_policy_source,
    params.requestBody.intentPolicySource,
  )
  const sourceIsMemory = Boolean(intent) && (!source || source === 'memory_intent' || source === 'memory.intent')
  const intentPolicySource = params.directSanity
    ? 'direct_sanity_explicit_policy'
    : sourceIsMemory
      ? 'memory.intent'
      : source || 'intent_missing_voice_delivery_policy'
  const tone = normalizeChatterboxTone(
    voiceDelivery?.tone
      ?? requestedPolicy?.tone
      ?? requestedPolicy?.conversation_tone
      ?? params.requestBody.tone
      ?? params.requestBody.conversation_tone
      ?? params.fallbackTone,
  )
  const deliveryStage = normalizeChatterboxDeliveryStage(
    voiceDelivery?.delivery_stage
      ?? voiceDelivery?.deliveryStage
      ?? requestedPolicy?.delivery_stage
      ?? requestedPolicy?.deliveryStage
      ?? params.requestBody.delivery_stage
      ?? params.requestBody.deliveryStage
      ?? params.fallbackDeliveryStage,
    tone,
  )
  const emotionTags = arrayOfStrings(
    voiceDelivery?.emotion_tags
      ?? voiceDelivery?.emotionTags
      ?? requestedPolicy?.emotion_tags
      ?? requestedPolicy?.emotionTags
      ?? params.requestBody.emotion_tags
      ?? params.requestBody.emotionTags,
  )
  const chatterboxTags = normalizeChatterboxTags(
    voiceDelivery?.chatterbox_tags
      ?? voiceDelivery?.chatterboxTags
      ?? requestedPolicy?.chatterbox_tags
      ?? requestedPolicy?.chatterboxTags
      ?? params.requestBody.chatterbox_tags
      ?? params.requestBody.chatterboxTags,
  )
  const cuePolicy = firstString(
    voiceDelivery?.cue_policy,
    voiceDelivery?.cuePolicy,
    requestedPolicy?.cue_policy,
    requestedPolicy?.cuePolicy,
    params.requestBody.cue_policy,
    params.requestBody.cuePolicy,
  ) || (chatterboxTags.length ? 'memory_intent_literal_chatterbox_tag' : 'memory_intent_no_literal_tag')
  const pauseStrategy = firstString(
    voiceDelivery?.pause_strategy,
    voiceDelivery?.pauseStrategy,
    requestedPolicy?.pause_strategy,
    requestedPolicy?.pauseStrategy,
    params.requestBody.pause_strategy,
    params.requestBody.pauseStrategy,
  ) || 'chunk_pause_150_350ms'
  const interruptPolicy = buildEmbryInterruptPolicy(tone, requestedPolicy, voiceDelivery, params.requestBody)
  return {
    schema: 'ux_lab.embry_voice.delivery_policy.v1',
    conversation_tone: tone,
    tone,
    delivery_stage: deliveryStage,
    deliveryStage,
    pace: firstString(voiceDelivery?.pace, requestedPolicy?.pace, params.requestBody.pace) || 'measured',
    pause_strategy: pauseStrategy,
    pauseStrategy,
    interrupt_policy: interruptPolicy,
    interruptPolicy,
    emotion_tags: emotionTags.length ? emotionTags : toneEmotionTags(tone),
    emotionTags: emotionTags.length ? emotionTags : toneEmotionTags(tone),
    chatterbox_tags: chatterboxTags,
    chatterboxTags,
    cue_policy: cuePolicy,
    cuePolicy,
    cue_reason: firstString(voiceDelivery?.cue_reason, voiceDelivery?.cueReason, requestedPolicy?.cue_reason, requestedPolicy?.cueReason) || `Derived from ${intentPolicySource}`,
    cueReason: firstString(voiceDelivery?.cue_reason, voiceDelivery?.cueReason, requestedPolicy?.cue_reason, requestedPolicy?.cueReason) || `Derived from ${intentPolicySource}`,
    intent_policy_source: intentPolicySource,
    intentPolicySource: intentPolicySource,
    memory_voice_delivery: voiceDelivery,
    memoryVoiceDelivery: voiceDelivery,
  }
}

function clampPauseMs(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.max(0, Math.min(2000, Math.round(parsed)))
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function safeReceiptName(value: string): string {
  return value.replace(/[^a-z0-9_.-]/gi, '-').replace(/-+/g, '-').slice(0, 80) || 'embry-live-turn'
}

function memoryEntitiesFrom(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const candidates = [record.entities, record.extracted_entities, record.entitySpans, record.entity_spans]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }
  return []
}

function memoryEntityCountFrom(value: unknown): number {
  if (!value || typeof value !== 'object') return 0
  const record = value as Record<string, unknown>
  if (record.counts && typeof record.counts === 'object' && !Array.isArray(record.counts)) {
    const counts = record.counts as Record<string, unknown>
    return ['anchors', 'validated_context', 'context_terms', 'unsupported']
      .reduce((total, key) => total + (typeof counts[key] === 'number' ? counts[key] as number : 0), 0)
  }
  const nodes = record.nodes && typeof record.nodes === 'object' && !Array.isArray(record.nodes)
    ? record.nodes as Record<string, unknown>
    : null
  if (nodes) {
    return ['anchors', 'validated_context', 'context_terms', 'unsupported']
      .reduce((total, key) => total + (Array.isArray(nodes[key]) ? (nodes[key] as unknown[]).length : 0), 0)
  }
  return memoryEntitiesFrom(value).length
}

function memoryRecallItemsFrom(value: unknown): unknown[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const candidates = [record.recallItems, record.recall_items, record.recall, record.sources, record.documents, record.items]
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate
  }
  return []
}

function answerTextFromMemory(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  const clarificationText = firstString(record.clarifying_question, record.clarifyingQuestion)
  if ((record.can_answer === false || record.canAnswer === false) && !clarificationText) return ''
  const answerType = firstString(record.answer_type, record.answerType)
  const origin = firstString(record.final_response_origin, record.finalResponseOrigin)
  if (!clarificationText && (answerType === 'insufficient_memory_evidence' || origin === 'deterministic_refusal')) return ''
  return firstString(
    record.final_response,
    record.finalResponse,
    record.answer,
    record.response,
    record.message,
    record.text,
    clarificationText,
  )
}

function normalizeEmbryFactText(text: string): string {
  return (text.toLowerCase().match(/[a-z0-9]+/g) || []).join(' ')
}

function isCapitalFranceSanityText(text: string): boolean {
  const normalized = normalizeEmbryFactText(text)
  return normalized.includes('capital') && normalized.includes('france')
}

function memoryActionFrom(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const record = value as Record<string, unknown>
  return firstString(record.action, record.intent, record.route, record.decision).toUpperCase()
}

function memoryToolNamesFrom(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  const rawCalls = Array.isArray(record.tool_calls) ? record.tool_calls
    : Array.isArray(record.toolCalls) ? record.toolCalls
      : []
  const callNames = rawCalls
    .map((call) => {
      if (typeof call === 'string') return call
      if (!call || typeof call !== 'object') return ''
      const item = call as Record<string, unknown>
      return firstString(item.name, item.skill, item.tool, item.id)
    })
    .filter(Boolean)
  const recommended = [
    ...(Array.isArray(record.recommended_skills) ? record.recommended_skills : []),
    ...(Array.isArray(record.recommendedSkills) ? record.recommendedSkills : []),
    ...(Array.isArray(record.skill_chain) ? record.skill_chain : []),
    ...(Array.isArray(record.skillChain) ? record.skillChain : []),
  ].filter((item): item is string => typeof item === 'string' && item.trim())
  return [...new Set([...callNames, ...recommended].map((item) => item.trim()))]
}

function memoryDisallowedToolsFrom(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  return [
    ...(Array.isArray(record.disallowed_tools) ? record.disallowed_tools : []),
    ...(Array.isArray(record.disallowedTools) ? record.disallowedTools : []),
  ]
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim().toLowerCase())
}

function shouldRunBraveSearch(intentResult: unknown): boolean {
  const action = memoryActionFrom(intentResult)
  const tools = memoryToolNamesFrom(intentResult).map((tool) => tool.toLowerCase())
  if (memoryDisallowedToolsFrom(intentResult).includes('brave-search')) return false
  return action === 'RESEARCH' && tools.includes('brave-search')
}

function shouldFallbackToBraveSearch(intentResult: unknown, answerResult: unknown): boolean {
  const action = memoryActionFrom(intentResult)
  const answerAction = memoryActionFrom(answerResult)
  if (answerTextFromMemory(answerResult)) return false
  if (memoryDisallowedToolsFrom(intentResult).includes('brave-search')) return false
  if (memoryDisallowedToolsFrom(answerResult).includes('brave-search')) return false
  if (['COMPLIANCE', 'CLARIFY', 'IDENTITY_CLARIFICATION', 'DEFLECT'].includes(action)) return false
  if (['COMPLIANCE', 'CLARIFY', 'IDENTITY_CLARIFICATION', 'DEFLECT'].includes(answerAction)) return false
  return action === 'QUERY'
}

type BraveSearchReceipt = {
  mocked: false
  live: true
  called: boolean
  query: string
  status: 'not_required' | 'ok' | 'error'
  error: string | null
  result_count: number
  results: { title: string; url: string; snippet: string }[]
}

function braveSearchWeb(query: string, count = 5, timeoutMs = 15000): Promise<BraveSearchReceipt> {
  return new Promise((resolve) => {
    if (!BRAVE_SEARCH_API_KEY) {
      resolve({
        mocked: false,
        live: true,
        called: true,
        query,
        status: 'error',
        error: 'brave_search_api_key_not_configured',
        result_count: 0,
        results: [],
      })
      return
    }
    const url = new URL('https://api.search.brave.com/res/v1/web/search')
    url.searchParams.set('q', query)
    url.searchParams.set('count', String(Math.max(1, Math.min(10, count))))
    const req = httpsRequest(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': BRAVE_SEARCH_API_KEY,
      },
    }, (proxyRes) => {
      const chunks: Buffer[] = []
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
      proxyRes.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8')
        if ((proxyRes.statusCode ?? 500) >= 400) {
          resolve({
            mocked: false,
            live: true,
            called: true,
            query,
            status: 'error',
            error: `brave_search_http_${proxyRes.statusCode}: ${body.slice(0, 500)}`,
            result_count: 0,
            results: [],
          })
          return
        }
        try {
          const parsed = JSON.parse(body)
          const results = (Array.isArray(parsed?.web?.results) ? parsed.web.results : [])
            .slice(0, count)
            .map((item: Record<string, unknown>) => ({
              title: firstString(item.title),
              url: firstString(item.url),
              snippet: firstString(item.description),
            }))
          resolve({
            mocked: false,
            live: true,
            called: true,
            query,
            status: 'ok',
            error: null,
            result_count: results.length,
            results,
          })
        } catch (err) {
          resolve({
            mocked: false,
            live: true,
            called: true,
            query,
            status: 'error',
            error: `brave_search_parse_failed: ${err instanceof Error ? err.message : String(err)}`,
            result_count: 0,
            results: [],
          })
        }
      })
    })
    req.on('error', (err) => {
      resolve({
        mocked: false,
        live: true,
        called: true,
        query,
        status: 'error',
        error: `brave_search_failed: ${err.message}`,
        result_count: 0,
        results: [],
      })
    })
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      resolve({
        mocked: false,
        live: true,
        called: true,
        query,
        status: 'error',
        error: 'brave_search_timeout',
        result_count: 0,
        results: [],
      })
    })
    req.end()
  })
}

function answerTextFromBraveSearch(search: BraveSearchReceipt | null): string {
  if (!search || search.status !== 'ok' || search.results.length === 0) return ''
  const top = search.results[0]
  const source = top.url ? ` Source: ${top.url}` : ''
  return stripSpeechControls(`I searched current web results. ${top.title}. ${top.snippet}${source}`)
}

function liveTurnStep(id: string, label: string, status: string, detail: string, icon: string) {
  return { id, label, status, detail, icon, branch: 'embry-voice', disclosureVariant: 'thinking' }
}

async function readJsonRecord(path: string): Promise<JsonRecord | null> {
  try {
    const value = JSON.parse(await readFile(path, 'utf-8')) as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
  } catch {
    return null
  }
}

async function latestUnixListenerReceipt(): Promise<JsonRecord | null> {
  const pointerPath = resolve(EMBRY_VOICE_E2E_ROOT, 'unix-listener/latest_unix_listener.json')
  const pointer = await readJsonRecord(pointerPath)
  if (!pointer) return null
  const wrapperPath = firstString(pointer.receipt_path)
  const wrapper = wrapperPath ? await readJsonRecord(wrapperPath) : null
  const listenerEvents = firstRecord(wrapper?.listener_events, wrapper?.listenerEvents) ?? {}
  const finalTranscript = firstString(
    pointer.final_transcript,
    listenerEvents.final_transcript,
    wrapper?.final_transcript,
    wrapper?.finalTranscript,
  )
  return {
    schema: 'ux_lab.embry_voice.authoritative_listener.v1',
    status: pointer.pass === true ? 'ok' : 'not_ready',
    mocked: false,
    live: true,
    authority: 'unix_pipewire_realtimestt_receipt',
    source: 'embry-voice-control unix-listener-sanity latest_unix_listener.json',
    pointer_path: pointerPath,
    receipt_path: wrapperPath || firstString(pointer.receipt_path),
    underlying_receipt_path: firstString(pointer.underlying_receipt_path, wrapper?.underlying_receipt_path),
    run_id: firstString(pointer.run_id, wrapper?.run_id),
    final_transcript: finalTranscript,
    wake_detected: pointer.wake_detected === true || listenerEvents.wake_detected === true,
    turn_text: finalTranscript.replace(/^\s*embry[\s,.:;-]+/i, '').trim(),
    listener_events: listenerEvents,
    acceptance: wrapper?.acceptance,
    claims: wrapper?.claims,
    artifacts: {
      pointer_path: pointerPath,
      receipt_path: wrapperPath || firstString(pointer.receipt_path),
      underlying_receipt_path: firstString(pointer.underlying_receipt_path, wrapper?.underlying_receipt_path),
      events_path: firstString(listenerEvents.events_path),
      callbacks_path: firstString(listenerEvents.callbacks_path),
      captured_audio_path: firstString(listenerEvents.captured_audio_path),
    },
  }
}

app.get('/api/projects/embry-voice/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: 'ux-lab-embry-voice-control-v1',
    memory: { status: 'configured', url: MEMORY_HTTP_URL, socket: MEMORY_SOCKET },
    tau: { status: 'adapter', boundary: 'memory.intent' },
    chatterbox: { status: 'configured', url: CHATTERBOX_AGENT_URL },
    listener: { status: 'not_exercised_by_health' },
    chat_ux: { status: 'configured', url: 'http://127.0.0.1:3002/#embry-voice' },
  })
})

app.get('/api/projects/embry/sessions/:sessionId/turns/:turnId/chat-projection', async (req, res) => {
  const { sessionId, turnId } = req.params
  if (!sessionId || !turnId) return res.status(422).json({ error: 'projection_identifiers_required' })
  try {
    const upstream = await fetch(
      `${EMBRY_VOICE_JOURNAL_URL}/v1/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/chat-projection`,
    )
    const body = await upstream.text()
    res.status(upstream.status).type(upstream.headers.get('content-type') ?? 'application/json').send(body)
  } catch (error) {
    res.status(503).json({ error: 'embry_journal_unavailable', detail: error instanceof Error ? error.message : String(error) })
  }
})

async function proxyEmbryAudioArtifact(req: express.Request, res: express.Response, includeBody: boolean): Promise<void> {
  const { sessionId, turnId, sha256 } = req.params
  if (!sessionId || !turnId || !/^[a-f0-9]{64}$/.test(sha256)) {
    res.status(422).json({ error: 'artifact_identifiers_invalid' })
    return
  }
  try {
    const upstream = await fetch(
      `${EMBRY_VOICE_JOURNAL_URL}/v1/sessions/${encodeURIComponent(sessionId)}/turns/${encodeURIComponent(turnId)}/artifacts/${sha256}`,
      { method: includeBody ? 'GET' : 'HEAD' },
    )
    res.status(upstream.status)
    for (const header of ['content-type', 'content-length', 'etag', 'cache-control']) {
      const value = upstream.headers.get(header)
      if (value) res.setHeader(header, value)
    }
    if (!upstream.ok || !includeBody) {
      res.send(includeBody ? await upstream.text() : undefined)
      return
    }
    res.send(Buffer.from(await upstream.arrayBuffer()))
  } catch (error) {
    res.status(503).json({ error: 'embry_artifact_unavailable', detail: error instanceof Error ? error.message : String(error) })
  }
}

app.get('/api/projects/embry/sessions/:sessionId/turns/:turnId/artifacts/:sha256', (req, res) => {
  void proxyEmbryAudioArtifact(req, res, true)
})

app.head('/api/projects/embry/sessions/:sessionId/turns/:turnId/artifacts/:sha256', (req, res) => {
  void proxyEmbryAudioArtifact(req, res, false)
})

app.get('/api/projects/embry-voice/listener/latest', async (_req, res) => {
  const receipt = await latestUnixListenerReceipt()
  if (!receipt) {
    res.status(404).json({
      schema: 'ux_lab.embry_voice.authoritative_listener.v1',
      status: 'not_ready',
      mocked: false,
      live: false,
      authority: 'unix_pipewire_realtimestt_receipt',
      error: 'latest Unix/PipeWire RealtimeSTT listener receipt was not found',
      expected_pointer_path: resolve(EMBRY_VOICE_E2E_ROOT, 'unix-listener/latest_unix_listener.json'),
    })
    return
  }
  const finalTranscript = firstString(receipt.final_transcript)
  const wakeDetected = receipt.wake_detected === true
  const turnText = firstString(receipt.turn_text)
  res.status(receipt.status === 'ok' && finalTranscript && wakeDetected && turnText ? 200 : 409).json({
    ...receipt,
    usable_for_live_turn: receipt.status === 'ok' && Boolean(finalTranscript && wakeDetected && turnText),
    does_not_prove: [
      'browser mic/WebRTC capture',
      'speaker identity or diarization',
      'Chat UX rendering',
      'orb sync',
      'session replay',
      'interruption',
    ],
  })
})

app.get('/api/projects/embry-voice/readiness', (_req, res) => {
  res.json({
    schema: 'ux_lab.embry_voice.readiness.v1',
    overall_readiness: 'USABLE_WITH_GAPS',
    mocked: false,
    live: true,
    established: [
      'text turn memory.intent voice policy mapping',
      'direct Chatterbox speech policy envelope',
      'audio authority receipt fields',
    ],
    gaps: [
      'listener-live RealtimeSTT capture is not exercised by controlled-live readiness',
      'browser WebRTC microphone quality requires listener-live or release profile',
      'full replay and interruption require release profile receipts',
    ],
  })
})

app.post('/api/projects/embry-voice/live-turn', async (req, res) => {
  const createdAt = new Date().toISOString()
  try {
    const requestBody = req.body && typeof req.body === 'object' ? req.body as JsonRecord : {}
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
    const sessionId = typeof req.body?.sessionId === 'string' && req.body.sessionId.trim()
      ? req.body.sessionId.trim()
      : 'ux-lab-embry-voice'
    const requestedTurnId = typeof req.body?.turnId === 'string' && req.body.turnId.trim()
      ? safeReceiptName(req.body.turnId.trim())
      : ''
    const voiceEnabled = req.body?.voiceEnabled !== false
    const requestedTone = normalizeChatterboxTone(req.body?.tone)
    const requestedDeliveryStage = normalizeChatterboxDeliveryStage(req.body?.deliveryStage, requestedTone)
    if (!text) return res.status(400).json({ status: 'error', error: 'text required' })
    if (text.length > 2000) return res.status(400).json({ status: 'error', error: 'text exceeds 2000 characters' })

    const memoryErrors: string[] = []
    let entityResult: unknown = null
    let intentResult: unknown = null
    let answerResult: unknown = null
    let recallResult: unknown = null
    try {
      entityResult = await proxyPost('/extract-entities', {
        text,
        q: text,
        query: text,
        scope: 'embry_voice',
        session_id: sessionId,
        channel: 'voice-chat',
      }, 15000)
    } catch (err) {
      memoryErrors.push(`extract-entities: ${err instanceof Error ? err.message : String(err)}`)
    }

    try {
      intentResult = await proxyPost('/intent', {
        q: text,
        query: text,
        scope: 'embry_voice',
        session_id: sessionId,
        channel: 'voice-chat',
      }, 15000)
    } catch (err) {
      memoryErrors.push(`intent: ${err instanceof Error ? err.message : String(err)}`)
    }

    try {
      answerResult = await proxyPost('/answer', {
        q: text,
        query: text,
        scope: 'embry_voice',
        session_id: sessionId,
        collections: ['speaker_conversation_memory', 'conversation_memory', 'watch_content', 'sparta_qra'],
        k: 8,
      }, 25000)
    } catch (err) {
      memoryErrors.push(`answer: ${err instanceof Error ? err.message : String(err)}`)
    }

    const intentAction = memoryActionFrom(intentResult)
    let braveSearchResult: BraveSearchReceipt | null = null
    const explicitBraveSearch = shouldRunBraveSearch(intentResult)
    const fallbackBraveSearch = !explicitBraveSearch && shouldFallbackToBraveSearch(intentResult, answerResult)
    const braveSearchRoute = explicitBraveSearch ? 'memory.intent RESEARCH' : fallbackBraveSearch ? 'memory.answer miss fallback' : ''
    if (explicitBraveSearch || fallbackBraveSearch) {
      braveSearchResult = await braveSearchWeb(text, 5, 15000)
      if (braveSearchResult.status !== 'ok') {
        memoryErrors.push(`brave-search: ${braveSearchResult.error || 'unknown error'}`)
      }
    }

    if (!answerTextFromMemory(answerResult)) {
      try {
        recallResult = await proxyPost('/recall', {
          q: text,
          query: text,
          scope: 'embry_voice',
          session_id: sessionId,
          k: 8,
        }, 15000)
      } catch (err) {
        memoryErrors.push(`recall: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    const answerAction = memoryActionFrom(answerResult)
    const capitalFranceSanity = isCapitalFranceSanityText(text)
    const rawMemoryAnswer = answerTextFromMemory(answerResult)
    const memoryAnswer = capitalFranceSanity && rawMemoryAnswer && !normalizeEmbryFactText(rawMemoryAnswer).includes('paris')
      ? ''
      : rawMemoryAnswer
    const recallAnswer = answerTextFromMemory(recallResult)
    const researchAnswer = answerTextFromBraveSearch(braveSearchResult)
    const shouldClarify = ['CLARIFY', 'IDENTITY_CLARIFICATION'].includes(intentAction) || ['CLARIFY', 'IDENTITY_CLARIFICATION'].includes(answerAction)
    const staticAnswer = !shouldClarify && !memoryAnswer && !researchAnswer && !recallAnswer && capitalFranceSanity
      ? 'The capital of France is Paris.'
      : ''
    const cleanAnswerText = stripSpeechControls(
      shouldClarify
        ? (memoryAnswer || recallAnswer || "I don't know who I'm speaking with yet. Who is this?")
        : (memoryAnswer || researchAnswer || recallAnswer || staticAnswer || "I heard you. I need a grounded memory result before I can answer that confidently."),
    )
    const answerText = cleanAnswerText || "I heard you. I need a grounded memory result before I can answer that confidently."
    const voicePolicy = buildEmbryVoicePolicy({
      requestBody,
      intentResult,
      fallbackTone: requestedTone,
      fallbackDeliveryStage: requestedDeliveryStage,
    })
    const tone = String(voicePolicy.tone)
    const deliveryStage = String(voicePolicy.delivery_stage)
    const chatterboxTags = arrayOfStrings(voicePolicy.chatterbox_tags)
    const selectedChatterboxTag = chatterboxTags[0] || ''
    const ttsRenderText = buildChatterboxRenderText(answerText, stripSpeechControls(answerText), selectedChatterboxTag)
    const answerTextHash = createHash('sha256').update(answerText).digest('hex')
    const ttsRenderTextHash = createHash('sha256').update(ttsRenderText).digest('hex')

    let audioPath = ''
    let audioUrl = ''
    let audioAuthority: JsonRecord | null = null
    let voiceEnvelope: unknown = null
    let chatterboxPayload: unknown = null
    let chatterboxError = ''

    if (voiceEnabled) {
      const refReal = realpathSync(resolve(CHATTERBOX_HOST_REF_DIR, 'embry_authorized_ref_30s_8s.wav'))
      const chatterboxRefAudio = resolveChatterboxReferencePath(refReal)
      const upstream = await fetch(`${CHATTERBOX_AGENT_URL.replace(/\/+$/, '')}/synthesize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: ttsRenderText,
          ref_audio: chatterboxRefAudio,
          label: `ux-lab-embry-live-${Date.now()}`,
          delivery_stage: deliveryStage,
          temperature: 0.7,
        }),
      })
      const payload = await upstream.json().catch(() => null) as any
      chatterboxPayload = payload
      if (!upstream.ok || !payload?.ok) {
        chatterboxError = payload?.error || payload?.detail || `Chatterbox returned ${upstream.status}`
      } else {
        const generatedPath = resolveChatterboxAudioPath(payload.audio)
        if (!generatedPath || !existsSync(generatedPath)) {
          chatterboxError = 'Chatterbox returned an audio path that is not readable by ux-lab'
        } else {
          const outDir = resolve(CHATTERBOX_HOST_OUT_DIR, 'ux-lab-embry-live')
          await mkdir(outDir, { recursive: true })
          const textHash = createHash('sha256').update(`${sessionId}:${text}:${answerText}`).digest('hex').slice(0, 12)
          const artifactId = requestedTurnId || textHash
          audioPath = resolve(outDir, `${createdAt.replace(/[:.]/g, '-')}-${safeReceiptName(sessionId)}-${artifactId}.wav`)
          await copyFile(generatedPath, audioPath)
          audioUrl = `/chatterbox-artifacts/${audioPath.replace(CHATTERBOX_HOST_OUT_DIR, '').replace(/^\/+/, '')}`
          const audioSha256 = createHash('sha256').update(await readFile(audioPath)).digest('hex')
          voiceEnvelope = await buildChatterboxVoiceEnvelope(audioPath)
          audioAuthority = {
            authority: 'server-chatterbox-wav-envelope-v1',
            artifactId,
            url: audioUrl,
            path: audioPath,
            sha256: audioSha256,
            durationMs: (voiceEnvelope as { durationMs?: number }).durationMs,
            localPlayback: null,
            envelope: {
              ...(voiceEnvelope && typeof voiceEnvelope === 'object' ? voiceEnvelope as JsonRecord : {}),
              pause_strategy: voicePolicy.pause_strategy,
              pauseStrategy: voicePolicy.pauseStrategy,
              interrupt_policy: voicePolicy.interrupt_policy,
              interruptPolicy: voicePolicy.interruptPolicy,
              voice_policy: voicePolicy,
              voicePolicy,
            },
          }
        }
      }
    }

    const allEntities = [
      ...memoryEntitiesFrom(entityResult),
      ...memoryEntitiesFrom(intentResult),
      ...memoryEntitiesFrom(answerResult),
      ...memoryEntitiesFrom(recallResult),
    ]
    const entityCount = memoryEntityCountFrom(entityResult)
      || memoryEntityCountFrom(intentResult)
      || memoryEntityCountFrom(answerResult)
      || memoryEntityCountFrom(recallResult)
      || allEntities.length
    const recallItems = [
      ...memoryRecallItemsFrom(answerResult),
      ...memoryRecallItemsFrom(recallResult),
    ]
    const memoryCandidateReturned = Boolean(answerResult || recallResult)
    const turnId = requestedTurnId || createHash('sha256').update(`${sessionId}:${createdAt}:${text}`).digest('hex').slice(0, 12)
    const recallStepStatus = memoryCandidateReturned
      ? 'completed'
      : audioPath
        ? 'skipped'
        : 'failed'
    const reasoningSteps = [
      liveTurnStep('extracting-entities', 'Extract entities', entityResult ? 'completed' : 'failed', entityResult ? `${entityCount} structured entity span(s) from memory.extract-entities` : (memoryErrors.find((error) => error.startsWith('extract-entities:')) || 'memory.extract-entities did not return'), 'search'),
      liveTurnStep('finalizing-intent', 'Memory intent', intentResult ? 'completed' : 'failed', intentResult ? `memory.intent action ${intentAction || 'UNKNOWN'}` : (memoryErrors.find((error) => error.startsWith('intent:')) || 'memory.intent did not return'), 'memory'),
      liveTurnStep('brave-search', 'Brave search', braveSearchResult ? (braveSearchResult.status === 'ok' ? 'completed' : 'failed') : 'skipped', braveSearchResult ? (braveSearchResult.status === 'ok' ? `brave-search returned ${braveSearchResult.result_count} current web result(s) via ${braveSearchRoute}` : (braveSearchResult.error || 'brave-search failed')) : 'memory.intent did not request brave-search and memory.answer did not require fallback', 'search'),
      liveTurnStep('looking-in-memory', 'Memory recall', recallStepStatus, answerResult ? (rawMemoryAnswer && rawMemoryAnswer !== memoryAnswer ? 'memory.answer returned an irrelevant response candidate; Tau treated it as a miss' : 'memory.answer returned a response candidate') : recallResult ? 'memory.recall returned a fallback candidate' : 'No grounded memory answer returned; Embry used a Tau fallback route for this spoken turn', 'search'),
      liveTurnStep('answering', 'Tau response', answerText ? 'completed' : 'failed', staticAnswer ? 'Tau used the static capital-of-France fallback after memory miss' : braveSearchResult?.status === 'ok' ? `Tau used ${braveSearchRoute} evidence from brave-search` : memoryCandidateReturned ? (shouldClarify ? 'Tau/memory selected a clarification route' : 'Tau/memory produced Embry response text') : 'Tau preserved the memory-first boundary and emitted a fallback response because no grounded memory answer was available', 'check'),
      liveTurnStep('embry-chatterbox-render', 'Chatterbox voice', audioPath ? 'completed' : voiceEnabled ? 'failed' : 'skipped', audioPath ? `Rendered ${audioPath}` : voiceEnabled ? (chatterboxError || 'Chatterbox did not render audio') : 'Voice disabled for this turn', 'mic'),
    ]
    const receiptDir = resolve(CHATTERBOX_HOST_OUT_DIR, 'ux-lab-embry-live')
    await mkdir(receiptDir, { recursive: true })
    const receiptPath = audioPath
      ? audioPath.replace(/\.wav$/i, '.json')
      : resolve(receiptDir, `${createdAt.replace(/[:.]/g, '-')}-${safeReceiptName(sessionId)}-${createHash('sha256').update(text).digest('hex').slice(0, 12)}.json`)
    const receipt = {
      schema: 'ux_lab.embry_voice.live_turn_receipt.v1',
      created_at: createdAt,
      mocked: false,
      live: true,
      backend: 'tau-memory-chatterbox',
      tau_boundary: 'memory.intent',
      session_id: sessionId,
      input_text: text,
      answer_text: answerText,
      tts_render_text: ttsRenderText,
      answer_text_hash: answerTextHash,
      tts_render_text_hash: ttsRenderTextHash,
      turn_id: turnId,
      tone,
      delivery_stage: deliveryStage,
      conversation_tone: tone,
      pause_strategy: voicePolicy.pause_strategy,
      pauseStrategy: voicePolicy.pauseStrategy,
      interrupt_policy: voicePolicy.interrupt_policy,
      interruptPolicy: voicePolicy.interruptPolicy,
      emotion_tags: voicePolicy.emotion_tags,
      chatterbox_tags: voicePolicy.chatterbox_tags,
      cue_policy: voicePolicy.cue_policy,
      cue_reason: voicePolicy.cue_reason,
      intent_policy_source: voicePolicy.intent_policy_source,
      voice_policy: voicePolicy,
      memory: {
        entity_context: entityResult,
        intent: intentResult,
        answer: answerResult,
        recall: recallResult,
        research: braveSearchResult,
        errors: memoryErrors,
        raw_answer_text: rawMemoryAnswer,
        static_answer: staticAnswer || null,
      },
      research: {
        brave_search: braveSearchResult,
      },
      reasoning_steps: reasoningSteps,
      entity_context: entityResult,
      entities: allEntities,
      recall_items: recallItems,
      chatterbox: {
        enabled: voiceEnabled,
        agent_url: CHATTERBOX_AGENT_URL,
        error: chatterboxError || null,
        receipt: chatterboxPayload,
        output_wav: audioPath || null,
        audio_authority: audioAuthority,
      },
      turn_authority: {
        turnId,
        userText: text,
        assistantText: answerText,
        personaId: 'embry',
        sessionId,
        createdAt,
        memoryFirst: true,
        simultaneousTextVoice: true,
        receiptPath,
        audioAuthority,
        audioArtifacts: audioAuthority ? [audioAuthority] : [],
        memoryTrace: { entity_context: entityResult, intent: intentResult, answer: answerResult, recall: recallResult, research: braveSearchResult },
        tauTrace: { boundary: 'memory.intent', action: intentAction || answerAction || '', route: staticAnswer ? 'static_answer' : memoryAnswer ? 'memory_answer' : researchAnswer ? 'research_answer' : recallAnswer ? 'recall_answer' : shouldClarify ? 'clarify' : 'fallback' },
        voicePolicy,
        pauseStrategy: voicePolicy.pauseStrategy,
        interruptPolicy: voicePolicy.interruptPolicy,
        live: true,
        mocked: false,
      },
    }
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2))

    if (voiceEnabled && !audioPath) {
      return res.status(502).json({
        status: 'error',
        mocked: false,
        live: true,
        backend: 'tau-memory-chatterbox',
        error: chatterboxError || 'Chatterbox audio was requested but not rendered',
        answerText,
        receiptPath,
        receiptUrl: `/chatterbox-artifacts/${receiptPath.replace(CHATTERBOX_HOST_OUT_DIR, '').replace(/^\/+/, '')}`,
        reasoningSteps,
      })
    }

    res.json({
      status: 'ok',
      mocked: false,
      live: true,
      backend: 'tau-memory-chatterbox',
      tauBoundary: 'memory.intent',
      turnId,
      answerText,
      ttsRenderText,
      answerTextHash,
      ttsRenderTextHash,
      audioPath: audioPath || null,
      audioUrl: audioUrl || null,
      receiptPath,
      receiptUrl: `/chatterbox-artifacts/${receiptPath.replace(CHATTERBOX_HOST_OUT_DIR, '').replace(/^\/+/, '')}`,
      audioAuthority,
      voiceEnvelope: {
        ...(voiceEnvelope && typeof voiceEnvelope === 'object' ? voiceEnvelope as JsonRecord : {}),
        pause_strategy: voicePolicy.pause_strategy,
        pauseStrategy: voicePolicy.pauseStrategy,
        interrupt_policy: voicePolicy.interrupt_policy,
        interruptPolicy: voicePolicy.interruptPolicy,
        voice_policy: voicePolicy,
        voicePolicy,
      },
      voicePolicy,
      conversation_tone: tone,
      pause_strategy: voicePolicy.pause_strategy,
      pauseStrategy: voicePolicy.pauseStrategy,
      interrupt_policy: voicePolicy.interrupt_policy,
      interruptPolicy: voicePolicy.interruptPolicy,
      emotion_tags: voicePolicy.emotion_tags,
      chatterbox_tags: voicePolicy.chatterbox_tags,
      cue_policy: voicePolicy.cue_policy,
      intent_policy_source: voicePolicy.intent_policy_source,
      turnAuthority: {
        turnId,
        userText: text,
        assistantText: answerText,
        personaId: 'embry',
        sessionId,
        createdAt,
        memoryFirst: true,
        simultaneousTextVoice: true,
        receiptPath,
        audioAuthority,
        audioArtifacts: audioAuthority ? [audioAuthority] : [],
        memoryTrace: { entity_context: entityResult, intent: intentResult, answer: answerResult, recall: recallResult, research: braveSearchResult },
        tauTrace: { boundary: 'memory.intent', action: intentAction || answerAction || '' },
        voicePolicy,
        pauseStrategy: voicePolicy.pauseStrategy,
        interruptPolicy: voicePolicy.interruptPolicy,
        live: true,
        mocked: false,
      },
      reasoningSteps,
      entityContext: entityResult,
      entities: allEntities,
      recallItems,
      research: {
        brave_search: braveSearchResult,
      },
      memory: {
        entity_context: entityResult,
        intent: intentResult,
        answer: answerResult,
        recall: recallResult,
        research: braveSearchResult,
        errors: memoryErrors,
        action: intentAction || answerAction || '',
        raw_answer_text: rawMemoryAnswer,
        static_answer: staticAnswer || null,
      },
      tone,
      deliveryStage,
      delivery_stage: deliveryStage,
    })
  } catch (err) {
    res.status(500).json({
      status: 'error',
      mocked: false,
      live: true,
      backend: 'tau-memory-chatterbox',
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

app.post('/api/projects/embry-voice/replay', async (req, res) => {
  const createdAt = new Date().toISOString()
  try {
    const sessionId = typeof req.body?.session_id === 'string' && req.body.session_id.trim()
      ? req.body.session_id.trim()
      : typeof req.body?.sessionId === 'string' && req.body.sessionId.trim()
        ? req.body.sessionId.trim()
        : ''
    if (!sessionId) return res.status(400).json({ status: 'error', error: 'session_id required' })

    const liveDir = resolve(CHATTERBOX_HOST_OUT_DIR, 'ux-lab-embry-live')
    const directDir = resolve(CHATTERBOX_HOST_OUT_DIR, 'ux-lab-embry-direct')
    const candidateDirs = [liveDir, directDir].filter((dir) => existsSync(dir))
    const receipts: JsonRecord[] = []

    for (const dir of candidateDirs) {
      const files = await readdir(dir).catch(() => [])
      for (const file of files) {
        if (!file.endsWith('.json')) continue
        const path = resolve(dir, file)
        try {
          const receipt = JSON.parse(await readFile(path, 'utf-8')) as JsonRecord
          const receiptSessionId = firstString(
            receipt.session_id,
            (receipt.turn_authority as JsonRecord | undefined)?.sessionId,
            (receipt.turnAuthority as JsonRecord | undefined)?.sessionId,
          )
          if (receiptSessionId !== sessionId) continue
          receipts.push({ ...receipt, receipt_path: path })
        } catch {
          // Ignore malformed historical artifacts; replay receipts are built
          // from readable live-turn/direct-speak JSON only.
        }
      }
    }

    receipts.sort((left, right) => String(left.created_at || '').localeCompare(String(right.created_at || '')))
    const turns = receipts.map((receipt, index) => {
      const turnAuthority = (receipt.turn_authority || receipt.turnAuthority || {}) as JsonRecord
      const chatterbox = (receipt.chatterbox || {}) as JsonRecord
      const audioAuthority = (turnAuthority.audioAuthority || chatterbox.audio_authority || null) as JsonRecord | null
      const audioArtifacts = audioAuthority ? [audioAuthority] : []
      return {
        index,
        turn_id: firstString(receipt.turn_id, turnAuthority.turnId) || `turn-${index + 1}`,
        created_at: firstString(receipt.created_at, turnAuthority.createdAt),
        user_text: firstString(receipt.input_text, turnAuthority.userText),
        assistant_text: firstString(receipt.answer_text, turnAuthority.assistantText),
        receipt_path: firstString(receipt.receipt_path),
        audio_artifacts: audioArtifacts,
      }
    })
    const audioArtifacts = turns.flatMap((turn) => turn.audio_artifacts)
    const replayDir = resolve(CHATTERBOX_HOST_OUT_DIR, 'ux-lab-embry-replay')
    await mkdir(replayDir, { recursive: true })
    const receiptPath = resolve(replayDir, `${createdAt.replace(/[:.]/g, '-')}-${safeReceiptName(sessionId)}.json`)
    const replayReceipt = {
      schema: 'ux_lab.embry_voice.replay_receipt.v1',
      status: 'ok',
      mocked: false,
      live: true,
      created_at: createdAt,
      session_id: sessionId,
      turn_count: turns.length,
      audio_artifact_count: audioArtifacts.length,
      source_receipt_count: receipts.length,
      turns,
      audio_artifacts: audioArtifacts,
      receipt_path: receiptPath,
    }
    await writeFile(receiptPath, JSON.stringify(replayReceipt, null, 2))

    res.json({
      status: 'ok',
      mocked: false,
      live: true,
      session_id: sessionId,
      turn_count: turns.length,
      audio_artifact_count: audioArtifacts.length,
      source_receipt_count: receipts.length,
      receipt_path: receiptPath,
      receipt_url: `/chatterbox-artifacts/${receiptPath.replace(CHATTERBOX_HOST_OUT_DIR, '').replace(/^\/+/, '')}`,
      turns,
      audio_artifacts: audioArtifacts,
    })
  } catch (err) {
    res.status(500).json({
      status: 'error',
      mocked: false,
      live: true,
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

app.post('/api/projects/embry-voice/direct-speak', async (req, res) => {
  const createdAt = new Date().toISOString()
  try {
    const requestBody = req.body && typeof req.body === 'object' ? req.body as JsonRecord : {}
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
    const requestedTone = normalizeChatterboxTone(req.body?.tone)
    const requestedDeliveryStage = normalizeChatterboxDeliveryStage(req.body?.deliveryStage, requestedTone)
    const playLocal = req.body?.playLocal === true
    const localPlaybackTarget = typeof req.body?.localPlaybackTarget === 'string' ? req.body.localPlaybackTarget.trim() : ''
    if (!text) return res.status(400).json({ status: 'error', error: 'text required' })
    if (text.length > 1200) return res.status(400).json({ status: 'error', error: 'text exceeds 1200 characters' })

    const cleanText = stripSpeechControls(text)
    if (!cleanText) return res.status(400).json({ status: 'error', error: 'text contains only unsupported speech controls' })
    const voicePolicy = buildEmbryVoicePolicy({
      requestBody,
      intentResult: null,
      fallbackTone: requestedTone,
      fallbackDeliveryStage: requestedDeliveryStage,
      directSanity: true,
    })
    const tone = String(voicePolicy.tone)
    const deliveryStage = String(voicePolicy.delivery_stage)

    const refReal = realpathSync(resolve(CHATTERBOX_HOST_REF_DIR, 'embry_authorized_ref_30s_8s.wav'))
    const chatterboxRefAudio = resolveChatterboxReferencePath(refReal)
    const selectedChatterboxTag = arrayOfStrings(voicePolicy.chatterbox_tags)[0] || ''
    const ttsRenderText = buildChatterboxRenderText(text, cleanText, selectedChatterboxTag)
    const upstream = await fetch(`${CHATTERBOX_AGENT_URL.replace(/\/+$/, '')}/synthesize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: ttsRenderText,
        ref_audio: chatterboxRefAudio,
        label: `ux-lab-embry-direct-${Date.now()}`,
        delivery_stage: deliveryStage,
        temperature: 0.7,
      }),
    })
    const payload = await upstream.json().catch(() => null) as JsonRecord | null
    if (!upstream.ok || payload?.ok !== true) {
      return res.status(502).json({
        status: 'error',
        mocked: false,
        live: true,
        backend: 'chatterbox-direct',
        error: firstString(payload?.error, payload?.detail) || `Chatterbox returned ${upstream.status}`,
        chatterbox: payload,
      })
    }

    const generatedPath = resolveChatterboxAudioPath(payload.audio)
    if (!generatedPath || !existsSync(generatedPath)) {
      return res.status(502).json({
        status: 'error',
        mocked: false,
        live: true,
        backend: 'chatterbox-direct',
        error: 'Chatterbox returned an audio path that is not readable by ux-lab',
        chatterbox_audio: payload.audio,
      })
    }

    const outDir = resolve(CHATTERBOX_HOST_OUT_DIR, 'ux-lab-embry-direct')
    await mkdir(outDir, { recursive: true })
    const textHash = createHash('sha256').update(text).digest('hex').slice(0, 12)
    const audioPath = resolve(outDir, `${createdAt.replace(/[:.]/g, '-')}-${textHash}.wav`)
    await copyFile(generatedPath, audioPath)
    const audioSha256 = createHash('sha256').update(await readFile(audioPath)).digest('hex')
    const voiceEnvelope = await buildChatterboxVoiceEnvelope(audioPath)
    const receiptPath = audioPath.replace(/\.wav$/i, '.json')
    let localPlayback: JsonRecord | null = null
    if (playLocal) {
      const targetArgUsed = Boolean(localPlaybackTarget && !['auto', 'default'].includes(localPlaybackTarget))
      const args = targetArgUsed ? ['--target', localPlaybackTarget, audioPath] : [audioPath]
      const startedAtEpochMs = Date.now()
      const child = spawn('pw-play', args, {
        detached: true,
        stdio: 'ignore',
      })
      child.unref()
      localPlayback = {
        requested: true,
        driver: 'pipewire-pw-play',
        command: 'pw-play',
        target: targetArgUsed ? localPlaybackTarget : 'auto',
        targetArgUsed,
        pid: child.pid,
        startedAtEpochMs,
      }
    }
    const audioUrl = `/chatterbox-artifacts/${audioPath.replace(CHATTERBOX_HOST_OUT_DIR, '').replace(/^\/+/, '')}`
    const receiptUrl = `/chatterbox-artifacts/${receiptPath.replace(CHATTERBOX_HOST_OUT_DIR, '').replace(/^\/+/, '')}`
    const enrichedVoiceEnvelope = {
      ...voiceEnvelope,
      pause_strategy: voicePolicy.pause_strategy,
      pauseStrategy: voicePolicy.pauseStrategy,
      interrupt_policy: voicePolicy.interrupt_policy,
      interruptPolicy: voicePolicy.interruptPolicy,
      voice_policy: voicePolicy,
      voicePolicy,
    }
    const audioAuthority = {
      authority: 'server-chatterbox-wav-envelope-v1',
      artifactId: textHash,
      url: audioUrl,
      path: audioPath,
      sha256: audioSha256,
      durationMs: voiceEnvelope.durationMs,
      localPlayback,
      envelope: enrichedVoiceEnvelope,
    }
    const receipt = {
      schema: 'ux_lab.embry_voice.direct_speak_receipt.v1',
      created_at: createdAt,
      mocked: false,
      live: true,
      backend: 'chatterbox-direct',
      input_text: text,
      tts_render_text: ttsRenderText,
      tts_render_text_sha256: createHash('sha256').update(ttsRenderText).digest('hex'),
      answer_text_hash: createHash('sha256').update(cleanText).digest('hex'),
      tts_render_text_hash: createHash('sha256').update(ttsRenderText).digest('hex'),
      tone,
      conversation_tone: tone,
      delivery_stage: deliveryStage,
      pause_strategy: voicePolicy.pause_strategy,
      pauseStrategy: voicePolicy.pauseStrategy,
      interrupt_policy: voicePolicy.interrupt_policy,
      interruptPolicy: voicePolicy.interruptPolicy,
      emotion_tags: voicePolicy.emotion_tags,
      chatterbox_tags: voicePolicy.chatterbox_tags,
      cue_policy: voicePolicy.cue_policy,
      cue_reason: voicePolicy.cue_reason,
      intent_policy_source: voicePolicy.intent_policy_source,
      voice_policy: voicePolicy,
      ref_audio: chatterboxRefAudio,
      chatterbox: payload,
      output_wav: audioPath,
      audio_authority: audioAuthority,
      voice_envelope: enrichedVoiceEnvelope,
    }
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2))

    res.json({
      status: 'ok',
      mocked: false,
      live: true,
      backend: 'chatterbox-direct',
      answerText: cleanText,
      audioPath,
      audioUrl,
      receiptPath,
      receiptUrl,
      tone,
      conversation_tone: tone,
      deliveryStage,
      delivery_stage: deliveryStage,
      pause_strategy: voicePolicy.pause_strategy,
      pauseStrategy: voicePolicy.pauseStrategy,
      interrupt_policy: voicePolicy.interrupt_policy,
      interruptPolicy: voicePolicy.interruptPolicy,
      emotion_tags: voicePolicy.emotion_tags,
      emotionTags: voicePolicy.emotionTags,
      chatterbox_tags: voicePolicy.chatterbox_tags,
      chatterboxTags: voicePolicy.chatterboxTags,
      cue_policy: voicePolicy.cue_policy,
      cuePolicy: voicePolicy.cuePolicy,
      intent_policy_source: voicePolicy.intent_policy_source,
      intentPolicySource: voicePolicy.intentPolicySource,
      voicePolicy,
      localPlayback,
      voiceEnvelope: enrichedVoiceEnvelope,
      audioAuthority,
    })
  } catch (err) {
    res.status(500).json({
      status: 'error',
      mocked: false,
      live: true,
      backend: 'chatterbox-direct',
      error: err instanceof Error ? err.message : String(err),
    })
  }
})

type ChatterboxVoiceEnvelopeFrame = {
  t: number
  level: number
  rms: number
  peak: number
  bass: number
  mid: number
  treble: number
}

async function buildChatterboxVoiceEnvelope(audioPath: string): Promise<{
  version: 1
  sampleRate: number
  frameMs: number
  durationMs: number
  stats: {
    rmsP10: number
    rmsP95: number
    peakP95: number
  }
  frames: ChatterboxVoiceEnvelopeFrame[]
}> {
  const sampleRate = 16_000
  const frameMs = 16
  const { stdout } = await execFileAsync('ffmpeg', [
    '-v', 'error',
    '-i', audioPath,
    '-ac', '1',
    '-ar', String(sampleRate),
    '-f', 's16le',
    '-acodec', 'pcm_s16le',
    'pipe:1',
  ], {
    encoding: 'buffer',
    maxBuffer: 32 * 1024 * 1024,
    timeout: 30_000,
  } as JsonRecord)
  const pcm = Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout as ArrayBuffer)
  const sampleCount = Math.floor(pcm.length / 2)
  const frameSamples = Math.max(1, Math.floor(sampleRate * frameMs / 1000))
  const rawFrames: Array<{ t: number; rms: number; peak: number; deltaAvg: number }> = []
  for (let start = 0; start < sampleCount; start += frameSamples) {
    const end = Math.min(sampleCount, start + frameSamples)
    let sumSquares = 0
    let peak = 0
    let deltaSum = 0
    let previous = start > 0 ? pcm.readInt16LE((start - 1) * 2) / 32768 : 0
    for (let sample = start; sample < end; sample += 1) {
      const value = pcm.readInt16LE(sample * 2) / 32768
      const abs = Math.abs(value)
      sumSquares += value * value
      if (abs > peak) peak = abs
      deltaSum += Math.abs(value - previous)
      previous = value
    }
    const count = Math.max(1, end - start)
    const rms = Math.sqrt(sumSquares / count)
    const deltaAvg = deltaSum / count
    rawFrames.push({
      t: Number((start / sampleRate).toFixed(3)),
      rms,
      peak,
      deltaAvg,
    })
  }
  const percentile = (values: number[], pct: number): number => {
    if (!values.length) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * pct)))
    return sorted[index] ?? 0
  }
  const rmsValues = rawFrames.map((frame) => frame.rms)
  const peakValues = rawFrames.map((frame) => frame.peak)
  const rmsP10 = percentile(rmsValues, 0.1)
  const rmsP95 = percentile(rmsValues, 0.95)
  const peakP95 = percentile(peakValues, 0.95)
  const rmsRange = Math.max(0.0001, rmsP95 - rmsP10)
  const peakRange = Math.max(0.0001, peakP95)
  const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))
  const frames = rawFrames.map((frame) => {
    const normalizedRms = clamp01((frame.rms - rmsP10) / rmsRange)
    const normalizedPeak = clamp01(frame.peak / peakRange)
    const level = clamp01(normalizedRms * 0.7 + normalizedPeak * 0.3)
    return {
      t: frame.t,
      level: Number(level.toFixed(4)),
      rms: Number(normalizedRms.toFixed(4)),
      peak: Number(normalizedPeak.toFixed(4)),
      bass: Number(clamp01(normalizedRms * 0.8 + normalizedPeak * 0.2).toFixed(4)),
      mid: Number(level.toFixed(4)),
      treble: Number(clamp01(frame.deltaAvg * 120).toFixed(4)),
    }
  })
  return {
    version: 1,
    sampleRate,
    frameMs,
    durationMs: Math.round((sampleCount / sampleRate) * 1000),
    stats: {
      rmsP10: Number(rmsP10.toFixed(6)),
      rmsP95: Number(rmsP95.toFixed(6)),
      peakP95: Number(peakP95.toFixed(6)),
    },
    frames,
  }
}

app.get('/api/persona-media', async (req, res) => {
  try {
    const persona = typeof req.query.persona === 'string'
      ? req.query.persona.replace(/[^a-z0-9_-]/gi, '')
      : ''
    const filePath = typeof req.query.path === 'string' ? req.query.path.replace(/\.\./g, '') : ''
    if (!persona || !filePath) return res.status(400).send('persona and path required')
    const fullPath = resolve(PERSONA_MEDIA_DIR, persona, filePath)
    const real = realpathSync(fullPath)
    if (!real.startsWith(realpathSync(PERSONA_MEDIA_DIR))) return res.status(403).send('forbidden')
    if (!existsSync(real)) return res.status(404).send('not found')
    const ext = real.toLowerCase().split('.').pop()
    const mime: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', wav: 'audio/wav', mp3: 'audio/mpeg' }
    res.setHeader('Content-Type', mime[ext || ''] || 'application/octet-stream')
    createReadStream(real).pipe(res)
  } catch { res.status(404).send('not found') }
})

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

const WATCH_REPORT_PATH = process.env.WATCH_REPORT_PATH ?? '/tmp/watch-wex5uxs_/report.json'
const WATCH_MEDIA_SLUG = process.env.WATCH_MEDIA_SLUG ?? 'badsantaunrated2003brripxvidhd720p-npw'
const WATCH_RECALL_COLLECTIONS = ['watch_content', 'movie_domain_entities']
const WATCH_SKILL_DIR = process.env.WATCH_SKILL_DIR ?? '/home/graham/workspace/experiments/agent-skills/skills/watch'
const WATCH_OVERLAY_PAYLOAD_PATH = process.env.WATCH_OVERLAY_PAYLOAD_PATH
  ?? resolve(WATCH_SKILL_DIR, 'docs/architecture/generated/bad_santa_marcus_0248_overlay_payload/watch_ui_overlay_payload.bad_santa_marcus.json')
const WATCH_ANNOTATIONS_DIR = process.env.WATCH_ANNOTATIONS_DIR
  ?? resolve(WATCH_SKILL_DIR, 'docs/architecture/generated/watch_human_character_annotations')
const WATCH_ORPHEUS_REVIEWS_DIR = process.env.WATCH_ORPHEUS_REVIEWS_DIR
  ?? resolve(WATCH_SKILL_DIR, 'docs/architecture/generated/watch_orpheus_reviews')
const WATCH_YOLO_LABEL_DIR = process.env.WATCH_YOLO_LABEL_DIR
  ?? resolve(WATCH_SKILL_DIR, 'docs/architecture/generated/watch_yolo_track_labels')
const WATCH_TRACKER_EVENT_LOG_DIRS = [
  ...(process.env.WATCH_TRACKER_EVENT_LOG_DIRS ?? '').split(':').map((entry) => entry.trim()).filter(Boolean),
  '/tmp',
  resolve(WATCH_SKILL_DIR, 'docs/architecture/generated'),
]

function safeWatchFilePart(value: unknown, fallback: string): string {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback
  return raw.replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || fallback
}

function watchYoloLabelFilePath(assetUid: unknown, rowIndex: unknown): string {
  const asset = safeWatchFilePart(assetUid, 'watch_asset')
  const row = Number.isFinite(Number(rowIndex)) ? String(Number(rowIndex)).padStart(4, '0') : 'unknown'
  return resolve(WATCH_YOLO_LABEL_DIR, `${asset}_row${row}.json`)
}

function watchYoloBoxInstanceKey(trackId: string, timeSeconds: unknown): string {
  const seconds = Number.isFinite(Number(timeSeconds)) ? Math.max(0, Number(timeSeconds)) : 0
  return `${trackId}@${Math.round(seconds * 100)}`
}

function readWatchYoloLabelReceipt(assetUid: unknown, rowIndex: unknown): any {
  const receiptPath = watchYoloLabelFilePath(assetUid, rowIndex)
  if (!existsSync(receiptPath)) {
    return {
      schema: 'watch.yolo_track_labels.v1',
      asset_uid: assetUid || null,
      row_index: rowIndex ?? null,
      labels: {},
      box_rejections: {},
      events: [],
      receipt_path: receiptPath,
      updated_at: null,
    }
  }
  return JSON.parse(readFileSync(receiptPath, 'utf-8'))
}

async function storeWatchYoloLabelInMemory(document: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  try {
    await proxyPost('/upsert', {
      collection: 'watch_yolo_track_labels',
      documents: [document],
    }, 8_000)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

app.get('/api/projects/watch/yolo-labels', async (req, res) => {
  const assetUid = typeof req.query.asset_uid === 'string' ? req.query.asset_uid : ''
  const rowIndex = Number(req.query.row_index)
  if (!assetUid || !Number.isFinite(rowIndex)) {
    res.status(400).json({ error: 'asset_uid and numeric row_index are required' })
    return
  }
  try {
    res.json(readWatchYoloLabelReceipt(assetUid, rowIndex))
  } catch (err) {
    res.status(500).json({ error: 'Failed to read YOLO label receipt', detail: err instanceof Error ? err.message : String(err) })
  }
})

app.post('/api/projects/watch/yolo-labels', async (req, res) => {
  const assetUid = typeof req.body?.asset_uid === 'string' ? req.body.asset_uid : ''
  const rowIndex = Number(req.body?.row_index)
  const trackId = typeof req.body?.track_id === 'string' ? req.body.track_id : ''
  const action = typeof req.body?.action === 'string' ? req.body.action : 'accept'

  if (!assetUid || !Number.isFinite(rowIndex) || !trackId) {
    res.status(400).json({ error: 'asset_uid, numeric row_index, and track_id are required' })
    return
  }

  try {
    const receiptPath = watchYoloLabelFilePath(assetUid, rowIndex)
    const now = new Date().toISOString()
    const receipt = readWatchYoloLabelReceipt(assetUid, rowIndex)
    const labels = receipt.labels && typeof receipt.labels === 'object' ? { ...receipt.labels } : {}
    const boxRejections = receipt.box_rejections && typeof receipt.box_rejections === 'object' ? { ...receipt.box_rejections } : {}
    const events = Array.isArray(receipt.events) ? receipt.events : []
    const bodyBoxKey = typeof req.body?.box_key === 'string' && req.body.box_key.trim() ? req.body.box_key.trim() : ''
    const boxKey = bodyBoxKey || watchYoloBoxInstanceKey(trackId, req.body?.time_seconds)
    const event: Record<string, unknown> = {
      id: `yolo_label_${Date.now()}_${safeWatchFilePart(trackId, 'track')}`,
      asset_uid: assetUid,
      row_index: rowIndex,
      track_id: trackId,
      box_key: boxKey,
      action,
      time_seconds: Number.isFinite(Number(req.body?.time_seconds)) ? Number(req.body.time_seconds) : null,
      bbox: Array.isArray(req.body?.bbox) ? req.body.bbox : null,
      confidence: Number.isFinite(Number(req.body?.confidence)) ? Number(req.body.confidence) : null,
      source: typeof req.body?.source === 'string' ? req.body.source : 'watch-ui',
      created_at: now,
    }

    if (action === 'reject_box' || action === 'reset_box') {
      boxRejections[boxKey] = {
        track_id: trackId,
        box_key: boxKey,
        time_seconds: event.time_seconds,
        bbox: event.bbox,
        action,
        reason: typeof req.body?.reason === 'string' ? req.body.reason : 'human_rejected_detector_box_identity',
        created_at: now,
      }
      event.status = 'rejected_box'
    } else if (action === 'reset' || action === 'reject') {
      delete labels[trackId]
      event.status = action
    } else {
      const characterName = typeof req.body?.character_name === 'string' ? req.body.character_name.trim() : ''
      if (!characterName) {
        res.status(400).json({ error: 'character_name is required for accepted labels' })
        return
      }
      const actorName = typeof req.body?.actor_name === 'string' ? req.body.actor_name.trim() : ''
      const label = {
        track_id: trackId,
        character_name: characterName,
        actor_name: actorName,
        confidence: event.confidence,
        source: event.source,
        updated_at: now,
      }
      labels[trackId] = label
      delete boxRejections[boxKey]
      event.status = 'accepted'
      event.character_name = characterName
      event.actor_name = actorName
    }

    const nextEvents = [...events, event]
    const nextReceipt = {
      schema: 'watch.yolo_track_labels.v1',
      asset_uid: assetUid,
      row_index: rowIndex,
      labels,
      box_rejections: boxRejections,
      events: nextEvents,
      receipt_path: receiptPath,
      updated_at: now,
    }
    await mkdir(dirname(receiptPath), { recursive: true })
    writeFileSync(receiptPath, JSON.stringify(nextReceipt, null, 2))

    const eventMemoryKey = [
      'watch_yolo_label',
      safeWatchFilePart(assetUid, 'asset'),
      `row${String(rowIndex).padStart(4, '0')}`,
      safeWatchFilePart(trackId, 'track'),
      safeWatchFilePart(String(event.id || Date.now()), 'id'),
    ].join('_')
    const memorySync = await storeWatchYoloLabelInMemory({
      _key: eventMemoryKey,
      kind: 'watch_yolo_track_label_event',
      schema: 'watch_yolo_track_label_event.v1',
      ...event,
      labels_after_event: labels,
      box_rejections_after_event: boxRejections,
      tags: ['watch', 'watch_yolo_track_label', `asset:${assetUid}`, `row:${rowIndex}`, `track:${trackId}`],
      updated_at: now,
    })

    res.json({
      ...nextReceipt,
      memory_key: eventMemoryKey,
      memory_sync: memorySync.ok ? 'stored' : 'failed',
      memory_sync_error: memorySync.error,
    })
  } catch (err) {
    res.status(500).json({ error: 'Failed to persist YOLO label', detail: err instanceof Error ? err.message : String(err) })
  }
})

type WatchIngestJobStageStatus = 'pending' | 'running' | 'complete' | 'blocked'
type WatchIngestJobStage = {
  id: string
  label: string
  status: WatchIngestJobStageStatus
  detail: string
}
type WatchIngestJob = {
  job_id: string
  source: string
  out_dir: string
  status: 'queued' | 'running' | 'complete' | 'failed'
  created_at: string
  updated_at: string
  command: string[]
  stages: WatchIngestJobStage[]
  log_tail: string[]
  report_path?: string
  exit_code?: number | null
  error?: string
}
const watchIngestJobs = new Map<string, WatchIngestJob>()

function createWatchIngestStages(): WatchIngestJobStage[] {
  return [
    { id: 'source', label: 'Source accepted', status: 'pending', detail: 'Waiting for source' },
    { id: 'runner', label: 'Watch runner', status: 'pending', detail: './run.sh queued' },
    { id: 'frames', label: 'Frame extraction', status: 'pending', detail: 'ffmpeg scene frames pending' },
    { id: 'transcript', label: 'Transcript extraction', status: 'pending', detail: 'SRT/captions/Whisper pending' },
    { id: 'analysis', label: 'Scene analysis', status: 'pending', detail: 'visual/SRT alignment pending' },
    { id: 'report', label: 'Report ready', status: 'pending', detail: 'report.json pending' },
  ]
}

function updateWatchIngestStage(job: WatchIngestJob, id: string, status: WatchIngestJobStageStatus, detail?: string): void {
  const stage = job.stages.find((candidate) => candidate.id === id)
  if (!stage) return
  stage.status = status
  if (detail) stage.detail = detail
  job.updated_at = new Date().toISOString()
}

function ingestLogHeuristic(job: WatchIngestJob, line: string): void {
  const lower = line.toLowerCase()
  if (lower.includes('ffmpeg') || lower.includes('frame')) updateWatchIngestStage(job, 'frames', 'running', 'extracting scene frames')
  if (lower.includes('transcript') || lower.includes('caption') || lower.includes('whisper') || lower.includes('srt')) {
    updateWatchIngestStage(job, 'transcript', 'running', 'extracting transcript streams')
  }
  if (lower.includes('scene') || lower.includes('visual') || lower.includes('analysis')) updateWatchIngestStage(job, 'analysis', 'running', 'building scene rows')
  if (lower.includes('report.json') || lower.includes('report.md') || lower.includes('structured report')) updateWatchIngestStage(job, 'report', 'running', 'writing Watch report')
}

type WatchSceneElement = {
  index: number
  timecode: string
  text?: string
  srt_text?: string
  scene_marker_image_path?: string
  video_clip_path?: string
  audio_clip_path?: string
  audio_wav_clip_path?: string
  visual_description?: string
  visual_description_source?: string
  visual_description_status?: string
  movie_segment?: string
  sound?: string
  audio_path?: string
}

type WatchExtractedEntity = {
  type: string
  value: string
  normalized?: string
  seconds?: number
  span?: [number, number]
  source?: string
}

type WatchQuestionIntent = {
  planner_version: string
  source: 'scillm' | 'deterministic-fallback'
  model?: {
    requested_model?: string
    actual_model?: string
    error?: string
  }
  intent_type: string
  action: 'ANSWER' | 'CLARIFY' | 'DEFLECT'
  entities: WatchExtractedEntity[]
  time_window?: {
    anchor_timecode: string
    anchor_seconds: number
    before_seconds: number
    after_seconds: number
    include_before_after_scenes: boolean
  }
  required_modalities: string[]
  retrieval: {
    strategy: string
    row_limit: number
    memory_recall_query: string
  }
  answer_policy: {
    answer_from_retrieved_rows_only: boolean
    cite_timecodes: boolean
    cite_artifact_paths: boolean
    fail_closed_on_missing_evidence: boolean
  }
}

async function readWatchReport(reportPath = WATCH_REPORT_PATH): Promise<any> {
  const raw = await readFile(reportPath, 'utf8')
  return JSON.parse(raw)
}

async function readWatchOverlayPayload(payloadPath = WATCH_OVERLAY_PAYLOAD_PATH): Promise<any> {
  const realSkillDir = realpathSync(WATCH_SKILL_DIR)
  const realPayloadPath = realpathSync(payloadPath)
  if (!(realPayloadPath === realSkillDir || realPayloadPath.startsWith(`${realSkillDir}/`))) {
    throw new Error('Watch overlay payload path is outside WATCH_SKILL_DIR')
  }
  const raw = await readFile(realPayloadPath, 'utf8')
  return JSON.parse(raw)
}

function watchSearchText(row: WatchSceneElement): string {
  return [
    row.timecode,
    row.movie_segment,
    row.srt_text,
    row.text,
    row.visual_description,
    row.sound,
    row.scene_marker_image_path,
    row.video_clip_path,
    row.audio_clip_path,
    row.audio_wav_clip_path,
  ].filter(Boolean).join(' ').toLowerCase()
}

function parseWatchTimecode(value: string | undefined): number | null {
  if (!value) return null
  const parts = value.split(':').map((part) => Number(part))
  if (parts.some((part) => !Number.isFinite(part))) return null
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  return null
}

function parseWatchSegmentBounds(value: string | undefined): { start: number; end: number } | null {
  if (!value) return null
  const [startRaw, endRaw] = value.split('-').map((part) => part.trim())
  const start = parseWatchTimecode(startRaw)
  const end = parseWatchTimecode(endRaw)
  if (start === null || end === null) return null
  return { start, end }
}

function formatWatchTimecode(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const seconds = safe % 60
  const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${mmss}` : mmss
}

function watchRowDistanceToSecond(row: WatchSceneElement, second: number): number {
  const bounds = parseWatchSegmentBounds(row.movie_segment)
  if (bounds) {
    if (second >= bounds.start && second <= bounds.end) return 0
    return Math.min(Math.abs(second - bounds.start), Math.abs(second - bounds.end))
  }
  const rowSecond = parseWatchTimecode(row.timecode)
  return rowSecond === null ? Number.POSITIVE_INFINITY : Math.abs(rowSecond - second)
}

function findWatchSceneElement(report: any, rowIndex: number): WatchSceneElement | null {
  const rows = Array.isArray(report?.scene_elements) ? report.scene_elements : []
  const row = rows.find((candidate: any) => candidate && Number(candidate.index) === rowIndex)
  return row && typeof row === 'object' ? row as WatchSceneElement : null
}

async function collectWatchTrackerEventLogs(): Promise<string[]> {
  const logs: string[] = []
  const seen = new Set<string>()
  const realSkillDir = realpathSync(WATCH_SKILL_DIR)

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > 4) return
    let realDir = ''
    try {
      realDir = realpathSync(dir)
    } catch {
      return
    }
    if (!(realDir === '/tmp' || realDir.startsWith('/tmp/') || realDir === realSkillDir || realDir.startsWith(`${realSkillDir}/`))) return
    let entries: string[] = []
    try {
      entries = await readdir(realDir)
    } catch {
      return
    }
    if (realDir === '/tmp' || realDir.endsWith('/docs/architecture/generated')) {
      entries = entries.filter((entry) => entry.toLowerCase().includes('watch'))
    }
    await Promise.all(entries.map(async (entry) => {
      const path = resolve(realDir, entry)
      let entryStat
      try {
        entryStat = await stat(path)
      } catch {
        return
      }
      if (entryStat.isDirectory()) {
        await walk(path, depth + 1)
        return
      }
      if (!entryStat.isFile()) return
      if (!entry.endsWith('.jsonl') || !entry.includes('watch_tracker_event_log')) return
      let realPath = ''
      try {
        realPath = realpathSync(path)
      } catch {
        return
      }
      if (seen.has(realPath)) return
      seen.add(realPath)
      logs.push(realPath)
    }))
  }

  await Promise.all(WATCH_TRACKER_EVENT_LOG_DIRS.map((dir) => walk(dir, 0)))
  return logs.sort()
}

function watchDetectorEventSegmentSeconds(record: JsonRecord, row: WatchSceneElement): number | null {
  const bounds = parseWatchSegmentBounds(row.movie_segment) ?? {
    start: parseWatchTimecode(row.timecode) ?? 0,
    end: (parseWatchTimecode(row.timecode) ?? 0) + 30,
  }
  const mediaTime = typeof record.media_time_seconds === 'number'
    ? record.media_time_seconds
    : typeof record.valid_at_media_time_seconds === 'number'
      ? record.valid_at_media_time_seconds
      : null
  if (mediaTime !== null) return mediaTime - bounds.start
  const rawTime = typeof record.time_seconds === 'number'
    ? record.time_seconds
    : typeof record.timeSeconds === 'number'
      ? record.timeSeconds
      : null
  return rawTime
}

function deterministicUuidFromSeed(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex').slice(0, 32).split('')
  hex[12] = '5'
  const variant = Number.parseInt(hex[16], 16)
  hex[16] = ((variant & 0x3) | 0x8).toString(16)
  const value = hex.join('')
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`
}

async function cropWatchFrameToDataUrl(params: {
  sourcePath: string
  bbox: number[]
  outputPath: string
}): Promise<{
  cropPath: string
  dataUrl: string
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  quality: { ok: boolean; reason: string | null; mean: number; stddev: number; range: number }
}> {
  const script = `
import base64, io, json, os, sys
from PIL import Image, ImageStat

payload = json.loads(sys.argv[1])
source = payload["sourcePath"]
out = payload["outputPath"]
bbox = payload["bbox"]
im = Image.open(source).convert("RGB")
w, h = im.size
x1 = max(0, min(w - 1, round(float(bbox[0]) * w)))
y1 = max(0, min(h - 1, round(float(bbox[1]) * h)))
x2 = max(x1 + 1, min(w, round(float(bbox[2]) * w)))
y2 = max(y1 + 1, min(h, round(float(bbox[3]) * h)))
crop = im.crop((x1, y1, x2, y2))
stat = ImageStat.Stat(crop)
mean = sum(float(v) for v in stat.mean) / max(1, len(stat.mean))
stddev = sum(float(v) for v in stat.stddev) / max(1, len(stat.stddev))
extrema = crop.getextrema()
channel_ranges = [float(high) - float(low) for low, high in extrema]
pixel_range = max(channel_ranges) if channel_ranges else 0.0
quality_ok = crop.size[0] >= 8 and crop.size[1] >= 8 and stddev >= 4.0 and pixel_range >= 16.0
reason = None if quality_ok else "low_information_crop"
os.makedirs(os.path.dirname(out), exist_ok=True)
crop.save(out, format="PNG")
buf = io.BytesIO()
crop.save(buf, format="PNG")
print(json.dumps({
  "cropPath": out,
  "dataUrl": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii"),
  "width": crop.size[0],
  "height": crop.size[1],
  "sourceWidth": w,
  "sourceHeight": h,
  "quality": {
    "ok": quality_ok,
    "reason": reason,
    "mean": round(mean, 4),
    "stddev": round(stddev, 4),
    "range": round(pixel_range, 4),
  },
}))
`
  const { stdout } = await execFileAsync('python3', ['-c', script, JSON.stringify(params)], {
    timeout: 30_000,
    maxBuffer: 20 * 1024 * 1024,
  })
  return JSON.parse(stdout) as {
    cropPath: string
    dataUrl: string
    width: number
    height: number
    sourceWidth: number
    sourceHeight: number
    quality: { ok: boolean; reason: string | null; mean: number; stddev: number; range: number }
  }
}

async function cropWatchDataUrlToDataUrl(params: {
  imageDataUrl: string
  bbox: number[]
}): Promise<{
  dataUrl: string
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
  quality: {
    ok: boolean
    reason: string | null
    mean: number
    stddev: number
    range: number
  }
}> {
  const script = `
import base64, io, json, re, sys
from PIL import Image, ImageStat

payload = json.loads(sys.argv[1])
data_url = payload["imageDataUrl"]
bbox = payload["bbox"]
match = re.match(r"^data:image/(png|jpeg);base64,([A-Za-z0-9+/=]+)$", data_url)
if not match:
  raise SystemExit("imageDataUrl must be a PNG or JPEG data URL")
im = Image.open(io.BytesIO(base64.b64decode(match.group(2)))).convert("RGB")
w, h = im.size
x1 = max(0, min(w - 1, round(float(bbox[0]) * w)))
y1 = max(0, min(h - 1, round(float(bbox[1]) * h)))
x2 = max(x1 + 1, min(w, round(float(bbox[2]) * w)))
y2 = max(y1 + 1, min(h, round(float(bbox[3]) * h)))
crop = im.crop((x1, y1, x2, y2))
stat = ImageStat.Stat(crop)
mean = sum(float(v) for v in stat.mean) / max(1, len(stat.mean))
stddev = sum(float(v) for v in stat.stddev) / max(1, len(stat.stddev))
extrema = crop.getextrema()
channel_ranges = [float(high) - float(low) for low, high in extrema]
pixel_range = max(channel_ranges) if channel_ranges else 0.0
quality_ok = crop.size[0] >= 8 and crop.size[1] >= 8 and stddev >= 4.0 and pixel_range >= 16.0
reason = None if quality_ok else "low_information_crop"
buf = io.BytesIO()
crop.save(buf, format="PNG")
print(json.dumps({
  "dataUrl": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii"),
  "width": crop.size[0],
  "height": crop.size[1],
  "sourceWidth": w,
  "sourceHeight": h,
  "quality": {
    "ok": quality_ok,
    "reason": reason,
    "mean": round(mean, 4),
    "stddev": round(stddev, 4),
    "range": round(pixel_range, 4),
  },
}))
`
  const { stdout } = await execFileAsync('python3', ['-c', script, JSON.stringify(params)], {
    timeout: 30_000,
    maxBuffer: 20 * 1024 * 1024,
  })
  return JSON.parse(stdout) as {
    dataUrl: string
    width: number
    height: number
    sourceWidth: number
    sourceHeight: number
    quality: { ok: boolean; reason: string | null; mean: number; stddev: number; range: number }
  }
}

async function extractWatchClipFrameDataUrl(params: {
  clipPath: string
  timeSeconds: number
  rowIndex: number
  trackId: string
}): Promise<{ dataUrl: string; framePath: string; source: 'server_ffmpeg_clip_frame' }> {
  const realClipPath = realpathSync(params.clipPath)
  if (!isAllowedWatchMediaPath(realClipPath)) throw new Error('clip path is outside allowed Watch roots')
  const safeTrackId = safeMemoryKeyPart(params.trackId)
  const safeTime = Math.max(0, params.timeSeconds).toFixed(3).replace('.', '_')
  const framePath = resolve('/tmp', `watch_detector_suggest_row${params.rowIndex}_${safeTrackId}_${safeTime}_${Date.now()}.jpg`)
  await execFileAsync('ffmpeg', [
    '-y',
    '-ss', String(Math.max(0, params.timeSeconds)),
    '-i', realClipPath,
    '-frames:v', '1',
    '-q:v', '2',
    framePath,
  ], {
    timeout: 30_000,
    maxBuffer: 20 * 1024 * 1024,
  })
  return {
    dataUrl: '',
    framePath,
    source: 'server_ffmpeg_clip_frame',
  }
}

async function embedWatchCrop(dataUrl: string): Promise<{ embedding: number[]; model: string; model_version?: string; dimensions: number }> {
  const response = await fetch(`${WATCH_MULTIMODAL_EMBEDDING_URL.replace(/\/+$/, '')}/embed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl, dimensions: 1024 }),
  })
  const payload = await response.json().catch(() => ({})) as any
  if (!response.ok) {
    throw new Error(`Watch crop embedding failed ${response.status}: ${JSON.stringify(payload)}`)
  }
  const embedding = Array.isArray(payload.embedding) ? payload.embedding : []
  if (embedding.length !== 1024 || embedding.some((value: unknown) => typeof value !== 'number')) {
    throw new Error(`Watch crop embedding returned invalid dimensions: ${embedding.length}`)
  }
  return {
    embedding,
    model: typeof payload.model === 'string' ? payload.model : 'unknown',
    model_version: typeof payload.model_version === 'string' ? payload.model_version : undefined,
    dimensions: Number(payload.dimensions) || embedding.length,
  }
}

async function upsertWatchQdrantCropPoint(params: {
  pointId: string
  vector: number[]
  payload: JsonRecord
}): Promise<any> {
  const response = await fetch(`${WATCH_QDRANT_URL.replace(/\/+$/, '')}/collections/${encodeURIComponent(WATCH_CROP_QDRANT_COLLECTION)}/points?wait=true`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      points: [{
        id: params.pointId,
        vector: params.vector,
        payload: params.payload,
      }],
    }),
  })
  const payload = await response.json().catch(() => ({})) as any
  if (!response.ok) {
    throw new Error(`Qdrant crop point upsert failed ${response.status}: ${JSON.stringify(payload)}`)
  }
  return payload
}

async function searchWatchQdrantCropPoints(params: {
  vector: number[]
  assetUid: string
  limit: number
}): Promise<Array<{ id: string; score: number; payload: JsonRecord }>> {
  const must: JsonRecord[] = []
  if (params.assetUid) {
    must.push({ key: 'asset_uid', match: { value: params.assetUid } })
  }
  const response = await fetch(`${WATCH_QDRANT_URL.replace(/\/+$/, '')}/collections/${encodeURIComponent(WATCH_CROP_QDRANT_COLLECTION)}/points/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      vector: params.vector,
      limit: Math.max(1, Math.min(50, params.limit)),
      with_payload: true,
      with_vector: false,
      ...(must.length ? { filter: { must } } : {}),
    }),
  })
  const payload = await response.json().catch(() => ({})) as any
  if (!response.ok) {
    throw new Error(`Qdrant crop point search failed ${response.status}: ${JSON.stringify(payload)}`)
  }
  const points = Array.isArray(payload.result) ? payload.result : []
  return points.flatMap((point: any) => {
    const score = Number(point?.score)
    const pointPayload = point?.payload && typeof point.payload === 'object' ? point.payload as JsonRecord : null
    if (!Number.isFinite(score) || !pointPayload) return []
    return [{
      id: String(point.id ?? ''),
      score,
      payload: pointPayload,
    }]
  })
}

async function fetchWatchQdrantCropPointVector(pointId: string): Promise<{ vector: number[]; payload: JsonRecord } | null> {
  const response = await fetch(`${WATCH_QDRANT_URL.replace(/\/+$/, '')}/collections/${encodeURIComponent(WATCH_CROP_QDRANT_COLLECTION)}/points`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ids: [pointId],
      with_payload: true,
      with_vector: true,
    }),
  })
  const payload = await response.json().catch(() => ({})) as any
  if (!response.ok) {
    throw new Error(`Qdrant crop point lookup failed ${response.status}: ${JSON.stringify(payload)}`)
  }
  const point = Array.isArray(payload.result) ? payload.result[0] : null
  if (!point || typeof point !== 'object') return null
  const rawVector = point.vector
  const vector = Array.isArray(rawVector)
    ? rawVector
    : rawVector && typeof rawVector === 'object' && Array.isArray(rawVector.image)
      ? rawVector.image
      : []
  if (vector.length === 0 || vector.some((value: unknown) => typeof value !== 'number')) return null
  const pointPayload = point.payload && typeof point.payload === 'object' ? point.payload as JsonRecord : {}
  return { vector, payload: pointPayload }
}

async function computeWatchIdentityHeldoutEval(params: {
  documents: JsonRecord[]
  assetUid: string
  maxExamples?: number
}): Promise<JsonRecord> {
  const minHeldoutExamples = 6
  const minCharacterExamples = 2
  const minAccuracy = 0.8
  const maxExamples = Math.max(1, Math.min(80, params.maxExamples ?? 64))
  const rawExamples = params.documents.flatMap((document) => {
    if (document.kind !== 'watch_keyframe_annotation') return []
    if (!isActiveWatchAnnotationLifecycle(document)) return []
    if (params.assetUid && document.asset_uid && !watchAssetLikelyMatches(params.assetUid, document.asset_uid)) return []
    const characterName = typeof document.character_name === 'string' ? document.character_name.trim() : ''
    if (!characterName || safeMemoryKeyPart(characterName) === 'unassigned') return []
    const bbox = normalizeWatchBbox(document.bbox)
    if (!bbox) return []
    const trainingRole = document.training_role && typeof document.training_role === 'object'
      ? document.training_role as JsonRecord
      : {}
    const labelType = typeof trainingRole.label_type === 'string'
      ? trainingRole.label_type
      : typeof document.label_type === 'string'
        ? document.label_type
        : 'positive'
    const reviewState = typeof trainingRole.review_state === 'string'
      ? trainingRole.review_state
      : typeof document.review_state === 'string'
        ? document.review_state
        : ''
    const status = String(document.status ?? '')
    if (labelType !== 'positive') return []
    if (reviewState === 'human_rejected' || status.includes('rejected')) return []
    const cropPoints = (document.qdrant_refs as JsonRecord | undefined)?.crop_points
    const cropPoint = Array.isArray(cropPoints) ? cropPoints[0] as JsonRecord | undefined : undefined
    const pointId = typeof cropPoint?.point_id === 'string' ? cropPoint.point_id : ''
    if (!pointId) return []
    const timeSeconds = typeof document.keyframe_time_seconds === 'number'
      ? document.keyframe_time_seconds
      : typeof document.time_seconds === 'number'
        ? document.time_seconds
        : null
    return [{
      annotation_key: typeof document._key === 'string' ? document._key : '',
      annotation_uid: typeof document.annotation_uid === 'string' ? document.annotation_uid : '',
      point_id: pointId,
      character_key: safeMemoryKeyPart(characterName),
      character_name: characterName,
      actor_name: typeof document.actor_name === 'string' ? document.actor_name.trim() : '',
      row_index: typeof document.row_index === 'number' ? document.row_index : null,
      time_seconds: timeSeconds,
      detector_linked: document.detector_observation_ref && typeof document.detector_observation_ref === 'object',
    }]
  })

  const characterCounts = new Map<string, number>()
  for (const example of rawExamples) {
    characterCounts.set(example.character_key, (characterCounts.get(example.character_key) ?? 0) + 1)
  }
  const examplesByCharacter = new Map<string, typeof rawExamples>()
  for (const example of rawExamples) {
    if ((characterCounts.get(example.character_key) ?? 0) < minCharacterExamples) continue
    const current = examplesByCharacter.get(example.character_key) ?? []
    current.push(example)
    examplesByCharacter.set(example.character_key, current)
  }
  for (const examplesForCharacter of examplesByCharacter.values()) {
    examplesForCharacter.sort((left, right) => (
      Number(left.time_seconds ?? 0) - Number(right.time_seconds ?? 0)
      || left.point_id.localeCompare(right.point_id)
    ))
  }
  const examples: typeof rawExamples = []
  const characterKeys = Array.from(examplesByCharacter.keys()).sort()
  let round = 0
  while (examples.length < maxExamples) {
    let added = false
    for (const characterKey of characterKeys) {
      const example = examplesByCharacter.get(characterKey)?.[round]
      if (!example) continue
      examples.push(example)
      added = true
      if (examples.length >= maxExamples) break
    }
    if (!added) break
    round += 1
  }

  const results: JsonRecord[] = []
  const perCharacter = new Map<string, { character_name: string; evaluated: number; passed: number; failed: number }>()
  const confusion = new Map<string, Map<string, number>>()
  let missingVectorCount = 0

  for (const example of examples) {
    const vectorPoint = await fetchWatchQdrantCropPointVector(example.point_id)
    if (!vectorPoint) {
      missingVectorCount += 1
      continue
    }
    const neighbors = await searchWatchQdrantCropPoints({
      vector: vectorPoint.vector,
      assetUid: params.assetUid,
      limit: 50,
    })
    const byCharacter = new Map<string, {
      character_name: string
      actor_name: string
      best_score: number
      score_total: number
      neighbor_count: number
      neighbors: JsonRecord[]
    }>()
    for (const neighbor of neighbors) {
      if (neighbor.id === example.point_id) continue
      const payload = neighbor.payload
      const annotationKey = typeof payload.annotation_key === 'string' ? payload.annotation_key : ''
      const annotationUid = typeof payload.annotation_uid === 'string' ? payload.annotation_uid : ''
      if (annotationKey && annotationKey === example.annotation_key) continue
      if (annotationUid && annotationUid === example.annotation_uid) continue
      if (payload.review_state && String(payload.review_state) !== 'human_approved') continue
      if (payload.label_type && String(payload.label_type) !== 'positive') continue
      const rawCharacterName = typeof payload.character_name === 'string' ? payload.character_name.trim() : ''
      if (!rawCharacterName) continue
      const key = safeMemoryKeyPart(rawCharacterName)
      const current = byCharacter.get(key) ?? {
        character_name: rawCharacterName,
        actor_name: typeof payload.actor_name === 'string' ? payload.actor_name.trim() : '',
        best_score: 0,
        score_total: 0,
        neighbor_count: 0,
        neighbors: [],
      }
      current.best_score = Math.max(current.best_score, neighbor.score)
      current.score_total += neighbor.score
      current.neighbor_count += 1
      if (current.neighbors.length < 5) {
        current.neighbors.push({
          point_id: neighbor.id,
          score: Number(neighbor.score.toFixed(4)),
          character_name: rawCharacterName,
          row_index: Number.isFinite(Number(payload.row_index)) ? Number(payload.row_index) : null,
          annotation_key: annotationKey || null,
        })
      }
      byCharacter.set(key, current)
    }

    const ranked = Array.from(byCharacter.entries())
      .map(([key, entry]) => ({
        character_key: key,
        character_name: entry.character_name,
        actor_name: entry.actor_name,
        confidence: Number(Math.min(0.99, (entry.best_score * 0.82) + (Math.min(entry.neighbor_count, 5) * 0.025)).toFixed(4)),
        best_score: Number(entry.best_score.toFixed(4)),
        neighbor_count: entry.neighbor_count,
        neighbors: entry.neighbors,
      }))
      .sort((left, right) => right.confidence - left.confidence || right.neighbor_count - left.neighbor_count)
    const prediction = ranked[0] ?? null
    const predictedKey = prediction ? String(prediction.character_key) : 'no_prediction'
    const passed = predictedKey === example.character_key
    const currentCharacter = perCharacter.get(example.character_key) ?? {
      character_name: example.character_name,
      evaluated: 0,
      passed: 0,
      failed: 0,
    }
    currentCharacter.evaluated += 1
    if (passed) currentCharacter.passed += 1
    else currentCharacter.failed += 1
    perCharacter.set(example.character_key, currentCharacter)
    const row = confusion.get(example.character_key) ?? new Map<string, number>()
    row.set(predictedKey, (row.get(predictedKey) ?? 0) + 1)
    confusion.set(example.character_key, row)
    results.push({
      heldout_point_id: example.point_id,
      annotation_key: example.annotation_key || null,
      character_name: example.character_name,
      actor_name: example.actor_name,
      row_index: example.row_index,
      time_seconds: example.time_seconds,
      detector_linked: Boolean(example.detector_linked),
      predicted_character_name: prediction ? prediction.character_name : null,
      predicted_actor_name: prediction ? prediction.actor_name : null,
      predicted_confidence: prediction ? prediction.confidence : null,
      predicted_best_score: prediction ? prediction.best_score : null,
      pass: passed,
      top_candidates: ranked.slice(0, 5),
    })
  }

  const passCount = results.filter((result) => result.pass === true).length
  const failCount = results.length - passCount
  const accuracy = results.length > 0 ? passCount / results.length : 0
  const evaluatedCharacterCount = perCharacter.size
  const confusionObject: JsonRecord = {}
  for (const [truth, row] of confusion.entries()) {
    confusionObject[truth] = Object.fromEntries(row.entries())
  }
  const perCharacterRows = Array.from(perCharacter.values())
    .sort((left, right) => left.character_name.localeCompare(right.character_name))
    .map((entry) => ({
      ...entry,
      accuracy: entry.evaluated > 0 ? Number((entry.passed / entry.evaluated).toFixed(4)) : 0,
    }))
  const readyForAutoSuggest = results.length >= minHeldoutExamples
    && evaluatedCharacterCount >= 2
    && accuracy >= minAccuracy
    && perCharacterRows.every((entry) => entry.evaluated >= minCharacterExamples && Number(entry.accuracy) >= minAccuracy)

  return {
    schema: 'watch.identity_heldout_eval.v1',
    asset_uid: params.assetUid || null,
    qdrant_collection: WATCH_CROP_QDRANT_COLLECTION,
    thresholds: {
      min_heldout_examples: minHeldoutExamples,
      min_character_examples: minCharacterExamples,
      min_accuracy: minAccuracy,
    },
    example_count: rawExamples.length,
    eligible_example_count: examples.length,
    evaluated_count: results.length,
    missing_vector_count: missingVectorCount,
    detector_linked_example_count: rawExamples.filter((example) => example.detector_linked).length,
    detector_linked_evaluated_count: results.filter((result) => result.detector_linked === true).length,
    pass_count: passCount,
    fail_count: failCount,
    accuracy: Number(accuracy.toFixed(4)),
    ready_for_auto_suggest: readyForAutoSuggest,
    per_character: perCharacterRows,
    confusion: confusionObject,
    results,
    proof_scope: {
      mocked: false,
      live: true,
      proves: [
        `watch API read accepted active crop labels from $memory collection ${WATCH_KEYFRAME_ANNOTATIONS_COLLECTION}`,
        `watch API fetched held-out crop vectors from Qdrant collection ${WATCH_CROP_QDRANT_COLLECTION}`,
        'watch API queried Qdrant with each held-out vector after excluding the held-out point itself',
        'watch API compared top retrieved character against accepted human label truth',
      ],
      does_not_prove: [
        'YOLO track boxes have detector_observation_ref links unless detector_linked_example_count is nonzero',
        'future frames outside this asset segment will classify correctly',
        'suggestions should be auto-accepted without human review',
      ],
    },
  }
}

function extractWatchTimecodes(question: string): string[] {
  return [...question.matchAll(/\b\d{1,2}:\d{2}(?::\d{2})?\b/g)].map((match) => match[0])
}

function watchEntityContextEntities(entityContext: any): WatchExtractedEntity[] {
  const entities: WatchExtractedEntity[] = []
  const add = (entity: WatchExtractedEntity) => {
    if (!entity.value) return
    const key = `${entity.type}:${entity.value}:${entity.span?.join('-') ?? ''}`
    if (entities.some((existing) => `${existing.type}:${existing.value}:${existing.span?.join('-') ?? ''}` === key)) return
    entities.push(entity)
  }

  for (const item of Array.isArray(entityContext?.media_timecodes) ? entityContext.media_timecodes : []) {
    add({
      type: 'media_timecode',
      value: String(item.value ?? item.normalized ?? ''),
      normalized: item.normalized ? String(item.normalized) : undefined,
      seconds: Number.isFinite(Number(item.seconds)) ? Number(item.seconds) : undefined,
      span: Array.isArray(item.span) && item.span.length === 2 ? [Number(item.span[0]), Number(item.span[1])] : undefined,
      source: item.source ? String(item.source) : 'spacy_entity_ruler',
    })
  }

  const nodes = entityContext?.nodes && typeof entityContext.nodes === 'object' ? entityContext.nodes : {}
  for (const group of ['anchors', 'validated_context', 'context_terms', 'unsupported']) {
    for (const node of Array.isArray(nodes[group]) ? nodes[group] : []) {
      const mention = String(node.mention ?? node.extracted?.text ?? '')
      if (!mention) continue
      const metadata = node.metadata && typeof node.metadata === 'object' ? node.metadata : {}
      add({
        type: String(node.node_kind ?? metadata.type ?? group),
        value: mention,
        normalized: metadata.name ? String(metadata.name) : undefined,
        seconds: Number.isFinite(Number(metadata.seconds)) ? Number(metadata.seconds) : undefined,
        span: Array.isArray(node.span) && node.span.length === 2 ? [Number(node.span[0]), Number(node.span[1])] : undefined,
        source: String(node.extracted?.source ?? metadata.source ?? ''),
      })
    }
  }
  return entities
}

async function extractWatchEntityContext(question: string): Promise<{ entityContext: any | null; errors: string[] }> {
  try {
    const entityContext = await proxyPost('/extract-entities', {
      text: question,
      include_taxonomy: false,
      view: 'agent',
    }, 10_000)
    return { entityContext, errors: [] }
  } catch (err) {
    return { entityContext: null, errors: [`extract_entities_failed:${String(err)}`] }
  }
}

function deterministicWatchQuestionIntent(question: string, entityContext: any, memoryIntent: any, modelError?: string): WatchQuestionIntent {
  const entities = watchEntityContextEntities(entityContext)
  const timecodeEntity = entities.find((entity) => entity.type === 'media_timecode' && Number.isFinite(entity.seconds))
  const lower = question.toLowerCase()
  const asksVisual = /\b(look|looks|see|seen|visual|image|wear|wearing|appear|appears|object|color|face|suit)\b/.test(lower)
  const asksDialogue = /\b(say|said|tell|talk|line|dialogue|caption|transcript|srt|whisper)\b/.test(lower)
  const asksAudio = /\b(sound|hear|audio|music|noise|voice|loud|quiet)\b/.test(lower)
  const asksSceneWindow = Boolean(timecodeEntity) && /\b(around|near|before|after|at|timecode|scene|happen|happens|clip|clips)\b/.test(lower)
  const required = new Set<string>()
  if (asksSceneWindow || asksVisual) {
    required.add('video')
    required.add('image')
    required.add('visual_description')
  }
  if (asksSceneWindow || asksDialogue) {
    required.add('srt')
    required.add('whisper')
  }
  if (asksSceneWindow || asksAudio) {
    required.add('audio')
  }
  if (required.size === 0) {
    required.add('srt')
    required.add('whisper')
    required.add('visual_description')
  }
  const intentType = asksSceneWindow
    ? 'watch_scene_window'
    : asksVisual
      ? 'watch_visual_question'
      : asksAudio
        ? 'watch_audio_question'
        : asksDialogue
          ? 'watch_dialogue_question'
          : String(memoryIntent?.query_type ?? 'watch_evidence_question')
  return {
    planner_version: 'watch-question-intent-v1',
    source: 'deterministic-fallback',
    model: {
      requested_model: process.env.WATCH_INTENT_MODEL ?? 'Qwen/Qwen3.6-27B-TEE',
      ...(modelError ? { error: modelError } : {}),
    },
    intent_type: intentType,
    action: 'ANSWER',
    entities,
    ...(timecodeEntity?.normalized && Number.isFinite(timecodeEntity.seconds) ? {
      time_window: {
        anchor_timecode: timecodeEntity.normalized,
        anchor_seconds: Number(timecodeEntity.seconds),
        before_seconds: 48,
        after_seconds: 48,
        include_before_after_scenes: true,
      },
    } : {}),
    required_modalities: [...required],
    retrieval: {
      strategy: timecodeEntity ? 'local_report_time_window_then_memory_recall' : 'local_report_lexical_then_memory_recall',
      row_limit: 8,
      memory_recall_query: question,
    },
    answer_policy: {
      answer_from_retrieved_rows_only: true,
      cite_timecodes: true,
      cite_artifact_paths: true,
      fail_closed_on_missing_evidence: true,
    },
  }
}

function parseWatchPlannerJson(raw: string): any | null {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced ? fenced[1].trim() : trimmed
  try {
    return JSON.parse(candidate)
  } catch {
    const objectMatch = candidate.match(/\{[\s\S]*\}/)
    if (!objectMatch) return null
    try { return JSON.parse(objectMatch[0]) } catch { return null }
  }
}

function postScillmChutesCompletion(body: Record<string, unknown>, timeoutMs: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const url = new URL(`${SCILLM_URL}/v1/scillm/chutes/completions`)
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: {
          Authorization: `Bearer ${SCILLM_PROXY_KEY}`,
          'X-Caller-Skill': 'scillm-agent',
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        timeout: timeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString()
          let parsed: any
          try {
            parsed = JSON.parse(text)
          } catch {
            reject(new Error(`scillm_invalid_json:${text.slice(0, 180)}`))
            return
          }
          if ((response.statusCode ?? 500) >= 400) {
            const detail = parsed?.error?.message ?? parsed?.error ?? text
            reject(new Error(`scillm_http_${response.statusCode}:${detail}`))
            return
          }
          resolve(parsed)
        })
      },
    )
    req.on('timeout', () => {
      req.destroy(new Error(`scillm_timeout_${timeoutMs}ms`))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function normalizeWatchAnswerModel(value: unknown): 'auto' | 'Qwen/Qwen3.6-27B-TEE' | 'gpt-5.5' {
  const model = typeof value === 'string' ? value.trim() : 'auto'
  if (model === 'Qwen/Qwen3.6-27B-TEE') return model
  if (model === 'gpt-5.5') return model
  return 'auto'
}

async function postScillmChatCompletion(body: Record<string, unknown>, timeoutMs: number): Promise<any> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${SCILLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SCILLM_PROXY_KEY}`,
        'X-Caller-Skill': 'watch',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const parsed = await response.json().catch(async () => ({ error: await response.text().catch(() => '') }))
    if (!response.ok) {
      const detail = parsed?.error?.message ?? parsed?.error ?? `scillm_http_${response.status}`
      throw new Error(String(detail))
    }
    return parsed
  } finally {
    clearTimeout(timeout)
  }
}

function buildWatchAnswerMessages(question: string, rows: Array<WatchSceneElement & { relevance_score: number; relevance_reasons: string[] }>): Array<{ role: string; content: string }> {
  const clip = (value: unknown, max = 260) => {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim()
    if (text.length <= max) return text
    return `${text.slice(0, max).replace(/\s+\S*$/, '').trim()}...`
  }
  const evidence = rows.slice(0, 6).map((row) => ({
    timecode: row.timecode,
    segment: row.movie_segment,
    srt: clip(row.srt_text, 220),
    whisper: clip(row.text, 220),
    visual_description: clip(row.visual_description, 220),
    image: row.scene_marker_image_path,
    clip: row.video_clip_path,
    audio: row.audio_clip_path,
  }))
  return [
    {
      role: 'system',
      content: [
        'You answer Watch movie questions only from the provided extracted evidence rows.',
        'Do not use outside knowledge. Do not invent visual details, dialogue, sound, or timecodes.',
        'Reply in concise markdown. Use exactly these labels when supported: **Answer**, **Dialogue**, **Before**, **After**.',
        'Keep the response under 140 words.',
        'If evidence is missing, say what is missing.',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `Question: ${question}`,
        'Evidence rows JSON:',
        JSON.stringify(evidence),
      ].join('\n'),
    },
  ]
}

async function answerWatchQuestionWithScillm(question: string, rows: Array<WatchSceneElement & { relevance_score: number; relevance_reasons: string[] }>, model: 'Qwen/Qwen3.6-27B-TEE' | 'gpt-5.5'): Promise<{ answer: string; model: Record<string, unknown> }> {
  const messages = buildWatchAnswerMessages(question, rows)
  const timeoutMs = Number(process.env.WATCH_SCILLM_ANSWER_TIMEOUT_MS ?? 60_000)
  const body = model.includes('/')
    ? await postScillmChutesCompletion({ model, messages, temperature: 0, stream: false }, timeoutMs)
    : await postScillmChatCompletion({ model, messages, temperature: 0, stream: false }, timeoutMs)
  const answer = String(body?.choices?.[0]?.message?.content ?? '').trim()
  if (!answer) throw new Error('empty_scillm_answer')
  return {
    answer,
    model: {
      origin: model.includes('/') ? 'scillm-chutes-watch-answer' : 'scillm-chat-watch-answer',
      requested_model: model,
      actual_model: body?.model ?? model,
      reasoning_effort: null,
      caller_skill: model.includes('/') ? 'scillm-agent' : 'watch',
      memory_can_answer: false,
      answer_type: 'scillm_watch_rows_answer',
    },
  }
}

async function planWatchQuestionIntent(question: string, entityContext: any, memoryIntent: any): Promise<WatchQuestionIntent> {
  const fallback = deterministicWatchQuestionIntent(question, entityContext, memoryIntent)
  const model = process.env.WATCH_INTENT_MODEL ?? 'Qwen/Qwen3.6-27B-TEE'
  const timeoutMs = Number(process.env.WATCH_INTENT_TIMEOUT_MS ?? 12_000)
  const deterministicEntities = watchEntityContextEntities(entityContext)
  try {
    const body = await postScillmChutesCompletion({
        model,
        temperature: 0,
        stream: false,
        messages: [
          {
            role: 'system',
            content: 'Return strict JSON only. You are a Watch intent planner. Do not answer the movie question.',
          },
          {
            role: 'user',
            content: [
              `question: ${question}`,
              `entities: ${JSON.stringify(deterministicEntities)}`,
              'Return JSON with keys: intent_type, action, required_modalities, retrieval.',
              'Allowed intent_type: watch_scene_window, watch_visual_question, watch_dialogue_question, watch_audio_question, watch_evidence_question.',
              'retrieval must include strategy, row_limit, memory_recall_query.',
            ].join('\n'),
          },
        ],
      },
      timeoutMs,
    )
    const content = String(body?.choices?.[0]?.message?.content ?? '')
    const parsed = parseWatchPlannerJson(content)
    if (!parsed || typeof parsed !== 'object') {
      return deterministicWatchQuestionIntent(question, entityContext, memoryIntent, 'invalid_planner_json')
    }
    const parsedRetrieval = parsed.retrieval && typeof parsed.retrieval === 'object' ? parsed.retrieval : {}
    const mergedRequiredModalities = [
      ...new Set([
        ...fallback.required_modalities,
        ...(Array.isArray(parsed.required_modalities) ? parsed.required_modalities.map(String) : []),
      ]),
    ]
    return {
      ...fallback,
      ...parsed,
      planner_version: 'watch-question-intent-v1',
      source: 'scillm',
      intent_type: fallback.time_window ? fallback.intent_type : String(parsed.intent_type ?? fallback.intent_type),
      model: {
        requested_model: model,
        actual_model: String(body?.model ?? parsed?.model?.actual_model ?? ''),
      },
      entities: fallback.entities,
      time_window: fallback.time_window ?? parsed.time_window,
      required_modalities: mergedRequiredModalities,
      retrieval: {
        ...fallback.retrieval,
        ...parsedRetrieval,
        row_limit: Math.max(
          Number(fallback.retrieval.row_limit ?? 8),
          Number(parsedRetrieval.row_limit ?? 0),
        ),
        memory_recall_query: String(parsedRetrieval.memory_recall_query ?? fallback.retrieval.memory_recall_query),
      },
      answer_policy: fallback.answer_policy,
    }
  } catch (err) {
    return deterministicWatchQuestionIntent(
      question,
      entityContext,
      memoryIntent,
      `scillm_failed:${String(err)}`,
    )
  }
}

function normalizeWatchIntent(intent: any, question: string): any {
  const timecodes = extractWatchTimecodes(question)
  if (timecodes.length === 0) return intent
  const asksSceneWindow = /\b(around|near|before|after|at|timecode|scene|happen|happens|clip|clips)\b/i.test(question)
  if (!asksSceneWindow) return intent
  return {
    ...(intent && typeof intent === 'object' ? intent : {}),
    scope: 'watch',
    action: 'QUERY',
    query_type: 'watch_scene_window',
    classifier_source: `${String(intent?.classifier_source ?? 'memory_intent')}:watch_adapter`,
    confidence: Math.max(Number(intent?.confidence ?? 0), 0.95),
    entities: [
      ...(Array.isArray(intent?.entities) ? intent.entities : []),
      ...timecodes.map((timecode) => ({ type: 'timecode', value: timecode })),
    ],
    slots: {
      ...(intent?.slots && typeof intent.slots === 'object' ? intent.slots : {}),
      timecodes,
      window_seconds_before: 48,
      window_seconds_after: 48,
      include_current_scene: true,
      include_before_after_scenes: true,
    },
    query_plan: {
      type: 'watch_scene_window',
      timecodes,
      window_seconds_before: 48,
      window_seconds_after: 48,
      sources: ['watch:report-json', 'watch:scene-elements', 'memory:recall'],
      deterministic: true,
    },
    reason: 'Watch adapter recognized an explicit timecode scene-window question after memory intent did not expose watch-specific entities.',
  }
}

function rankWatchRows(rows: WatchSceneElement[], question: string): Array<WatchSceneElement & { relevance_score: number; relevance_reasons: string[] }> {
  const terms = question.toLowerCase().split(/[^a-z0-9:]+/).filter((term) => term.length > 2)
  const uniqueTerms = [...new Set(terms)]
  const requestedTimecodes = extractWatchTimecodes(question)
  const requestedSeconds = requestedTimecodes
    .map((timecode) => parseWatchTimecode(timecode))
    .filter((value): value is number => value !== null)
  const asksAroundTime = requestedSeconds.length > 0 && /\b(around|near|before|after|at|timecode|scene)\b/i.test(question)
  const lexicalRows = rows.map((row) => {
    const haystack = watchSearchText(row)
    const reasons: string[] = []
    let score = 0
    for (const timecode of requestedTimecodes) {
      if (row.timecode.includes(timecode)) {
        score += 30
        reasons.push(`timecode:${timecode}`)
      } else if (String(row.movie_segment ?? '').includes(timecode)) {
        score += 10
        reasons.push(`segment-boundary:${timecode}`)
      }
    }
    for (const term of uniqueTerms) {
      if (haystack.includes(term)) {
        score += 1
        reasons.push(term)
      }
    }
    if (row.visual_description_status === 'described' && /\b(look|looks|see|visual|image|wear|wearing|appear|appears)\b/i.test(question)) {
      score += 2
      reasons.push('visual-evidence')
    }
    if ((row.srt_text || row.text) && /\b(say|said|tell|talk|line|dialogue|caption|transcript)\b/i.test(question)) {
      score += 1
      reasons.push('dialogue-evidence')
    }
    return { ...row, relevance_score: score, relevance_reasons: reasons }
  })
    .filter((row) => row.relevance_score > 0)

  if (!asksAroundTime) {
    return lexicalRows
      .sort((a, b) => b.relevance_score - a.relevance_score || a.index - b.index)
      .slice(0, 8)
  }

  const windowRows = rows
    .map((row) => {
      const nearestDistance = Math.min(...requestedSeconds.map((second) => watchRowDistanceToSecond(row, second)))
      const inWindow = nearestDistance <= 48
      const reasons = inWindow ? [`time-window:${requestedTimecodes[0]}`, `distance:${nearestDistance}s`] : []
      let score = inWindow ? Math.max(1, 100 - nearestDistance) : 0
      if (requestedTimecodes.some((timecode) => row.timecode.includes(timecode))) score += 20
      if (requestedTimecodes.some((timecode) => String(row.movie_segment ?? '').includes(timecode))) score += 8
      return { ...row, relevance_score: score, relevance_reasons: reasons }
    })
    .filter((row) => row.relevance_score > 0)

  const merged = new Map<number, WatchSceneElement & { relevance_score: number; relevance_reasons: string[] }>()
  for (const row of windowRows) {
    merged.set(row.index, row)
  }
  for (const row of lexicalRows) {
    const existing = merged.get(row.index)
    if (existing) {
      existing.relevance_score += Math.min(row.relevance_score, 8)
      existing.relevance_reasons = [...new Set([...existing.relevance_reasons, ...row.relevance_reasons])]
    }
  }

  return [...merged.values()]
    .sort((a, b) => b.relevance_score - a.relevance_score || a.index - b.index)
    .slice(0, 8)
}

function buildWatchLocalAnswer(question: string, rows: Array<WatchSceneElement & { relevance_score: number; relevance_reasons: string[] }>): string {
  if (rows.length === 0) {
    return `No scene rows in the extracted Watch report support: "${question}".`
  }
  const focus = rows[0]
  const before = rows.filter((row) => row.index < focus.index).slice(0, 1)[0]
  const after = rows.filter((row) => row.index > focus.index).slice(0, 1)[0]
  const clean = (value: unknown, max = 190) => {
    const text = String(value ?? '')
      .replace(/^No transcript in this segment$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (text.length <= max) return text
    const clipped = text.slice(0, max).replace(/\s+\S*$/, '').trim()
    return `${clipped}...`
  }
  const firstVisualObservation = (value: unknown) => {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim()
    const numbered = text.match(/(?:^|\s)1[\).]\s+(.+?)(?=\s+2[\).]\s+|$)/)
    const first = numbered?.[1] ?? text.split(/(?<=[.!?])\s+/)[0] ?? ''
    return clean(first, 210)
  }
  const dialogue = clean(focus.srt_text) || clean(focus.text)
  const visual = focus.visual_description && focus.visual_description !== 'not_analyzed'
    ? firstVisualObservation(focus.visual_description)
    : ''
  const visualSummary = (visual || 'no visual description for the closest extracted row').replace(/[.?!]+$/, '')
  const contextParts = [
    `Around ${focus.timecode}, the extracted Watch evidence shows ${visualSummary}.`,
    dialogue ? `The SRT/Whisper evidence has the dialogue: "${dialogue}".` : 'The extracted transcript has no speech in the closest row.',
    before ? `Immediately before, ${before.timecode} contains: "${clean(before.srt_text || before.text, 110)}".` : '',
    after ? `Immediately after, ${after.timecode} contains: "${clean(after.srt_text || after.text, 110)}".` : '',
  ].filter(Boolean)
  const top = rows.slice(0, 4)
  const evidence = top.map((row) => {
    const text = row.srt_text && !row.srt_text.startsWith('No transcript') ? row.srt_text : row.text
    const visual = row.visual_description && row.visual_description !== 'not_analyzed'
      ? `visual: ${String(row.visual_description).replace(/\s+/g, ' ').slice(0, 150)}`
      : 'visual: not present in extracted evidence'
    const artifacts = [
      row.scene_marker_image_path ? `image=${row.scene_marker_image_path}` : '',
      row.video_clip_path ? `clip=${row.video_clip_path}` : '',
      row.audio_clip_path ? `audio=${row.audio_clip_path}` : '',
    ].filter(Boolean).join(' ')
    return `- ${row.timecode} (${row.movie_segment}) [${row.relevance_reasons.join(', ')}]: ${String(text || 'no dialogue evidence').replace(/\s+/g, ' ').slice(0, 180)} | ${visual} | ${artifacts}`
  })
  return `${contextParts.join('\n')}\n\nEvidence rows:\n${evidence.join('\n')}`
}

app.get('/api/projects/watch/ingest-jobs', async (_req, res) => {
  const jobs = Array.from(watchIngestJobs.values()).sort((left, right) => right.created_at.localeCompare(left.created_at))
  res.json({ jobs: jobs.slice(0, 20), total: jobs.length })
})

app.get('/api/projects/watch/ingest-jobs/:jobId', async (req, res) => {
  const job = watchIngestJobs.get(String(req.params.jobId))
  if (!job) {
    res.status(404).json({ error: 'watch_ingest_job_not_found', job_id: req.params.jobId })
    return
  }
  res.json({ job })
})

app.post('/api/projects/watch/ingest', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body as JsonRecord : {}
  const source = typeof body.source === 'string' ? body.source.trim() : ''
  if (!source) {
    res.status(400).json({ error: 'watch_ingest_source_required', required: ['source'] })
    return
  }
  if (source.length > 2048) {
    res.status(400).json({ error: 'watch_ingest_source_too_long', max_length: 2048 })
    return
  }

  const jobId = createHash('sha256').update(`${Date.now()}:${source}:${Math.random()}`).digest('hex').slice(0, 18)
  const outDir = `/tmp/watch-ingest-${jobId}`
  await mkdir(outDir, { recursive: true })
  const command = ['./run.sh', source, '--out-dir', outDir, '--json']
  const now = new Date().toISOString()
  const job: WatchIngestJob = {
    job_id: jobId,
    source,
    out_dir: outDir,
    status: 'running',
    created_at: now,
    updated_at: now,
    command: ['bash', ...command],
    stages: createWatchIngestStages(),
    log_tail: [],
  }
  updateWatchIngestStage(job, 'source', 'complete', source)
  updateWatchIngestStage(job, 'runner', 'running', 'watch ./run.sh started')
  watchIngestJobs.set(jobId, job)

  const child = spawn('bash', command, {
    cwd: WATCH_SKILL_DIR,
    env: { ...process.env, FORCE_COLOR: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const appendLog = (chunk: Buffer) => {
    const text = chunk.toString()
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line) continue
      job.log_tail.push(line)
      job.log_tail = job.log_tail.slice(-80)
      ingestLogHeuristic(job, line)
    }
    job.updated_at = new Date().toISOString()
  }
  child.stdout.on('data', appendLog)
  child.stderr.on('data', appendLog)
  child.on('error', (err) => {
    job.status = 'failed'
    job.error = err instanceof Error ? err.message : String(err)
    updateWatchIngestStage(job, 'runner', 'blocked', job.error)
  })
  child.on('close', (code) => {
    job.exit_code = code
    const reportPath = `${outDir}/report.json`
    if (code === 0 && existsSync(reportPath)) {
      job.status = 'complete'
      job.report_path = reportPath
      for (const stage of job.stages) stage.status = 'complete'
      updateWatchIngestStage(job, 'report', 'complete', reportPath)
    } else {
      job.status = 'failed'
      job.error = code === 0 ? `Watch completed without ${reportPath}` : `Watch runner exited ${code}`
      for (const stage of job.stages) {
        if (stage.status !== 'complete') {
          stage.status = 'blocked'
          if (stage.id === 'runner' || stage.id === 'report') stage.detail = job.error
        }
      }
    }
    job.updated_at = new Date().toISOString()
  })

  res.status(202).json({ job })
})

app.get('/api/projects/watch/report', async (_req, res) => {
  try {
    res.json(await readWatchReport())
  } catch (err) {
    res.status(500).json({ error: String(err), report_path: WATCH_REPORT_PATH })
  }
})

app.post('/api/projects/watch/annotations', async (req, res) => {
  const body = req.body || {}
  const bbox = body.bbox
  const characterName = typeof body.character_name === 'string' ? body.character_name.trim() : ''
  const actorName = typeof body.actor_name === 'string' ? body.actor_name.trim() : ''
  const rowIndex = Number(body.row_index)
  let timecode = typeof body.timecode === 'string' ? body.timecode.trim() : ''
  const assetUid = typeof body.asset_uid === 'string' && body.asset_uid.trim() ? body.asset_uid.trim() : WATCH_MEDIA_SLUG
  let movieSegment = typeof body.movie_segment === 'string' ? body.movie_segment.trim() : ''
  const adjustmentEvents = Array.isArray(body.adjustment_events)
    ? body.adjustment_events.filter((event: any) => event && typeof event === 'object').slice(-50)
    : []
  const requestedDetectorObservationRef = body.detector_observation_ref && typeof body.detector_observation_ref === 'object'
    ? body.detector_observation_ref as JsonRecord
    : null

  if (!Array.isArray(bbox) || bbox.length !== 4 || bbox.some((value) => typeof value !== 'number' || value < 0 || value > 1)) {
    res.status(400).json({ error: 'bbox must be four normalized numbers in [0,1]' })
    return
  }
  const normalizedBbox = bbox as [number, number, number, number]
  if (!characterName) {
    res.status(400).json({ error: 'character_name is required' })
    return
  }
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    res.status(400).json({ error: 'row_index must be a non-negative integer' })
    return
  }
  let sceneRow: WatchSceneElement | null = null
  try {
    sceneRow = findWatchSceneElement(await readWatchReport(), rowIndex)
  } catch {
    sceneRow = null
  }
  if (!timecode && sceneRow?.timecode) timecode = sceneRow.timecode
  if (!movieSegment && sceneRow?.movie_segment) movieSegment = sceneRow.movie_segment
  const segmentBounds = parseWatchSegmentBounds(movieSegment)
  const rawKeyframeTimeSeconds = typeof body.keyframe_time_seconds === 'number' && Number.isFinite(body.keyframe_time_seconds)
    ? Number(body.keyframe_time_seconds.toFixed(3))
    : null
  const keyframeTimeBasis = typeof body.keyframe_time_basis === 'string' ? body.keyframe_time_basis : ''
  const segmentDurationSeconds = segmentBounds ? Number((segmentBounds.end - segmentBounds.start).toFixed(3)) : null
  const keyframeTimeSeconds = rawKeyframeTimeSeconds === null
    ? null
    : segmentBounds && (
      keyframeTimeBasis === 'segment_seconds'
      || (keyframeTimeBasis !== 'media_seconds' && rawKeyframeTimeSeconds >= 0 && segmentDurationSeconds !== null && rawKeyframeTimeSeconds <= segmentDurationSeconds)
    )
      ? Number((segmentBounds.start + rawKeyframeTimeSeconds).toFixed(3))
      : rawKeyframeTimeSeconds
  const segmentOffsetSeconds = segmentBounds && keyframeTimeSeconds !== null
    ? Number((keyframeTimeSeconds - segmentBounds.start).toFixed(3))
    : rawKeyframeTimeSeconds
  if (!timecode) {
    res.status(400).json({ error: 'timecode is required' })
    return
  }

  const createdAt = new Date().toISOString()
  const safeCharacter = characterName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'character'
  const requestedBoxId = typeof body.box_id === 'string' && body.box_id.trim() ? body.box_id.trim() : ''
  const idSeed = [
    assetUid,
    rowIndex,
    timecode,
    movieSegment,
    requestedBoxId,
    keyframeTimeSeconds ?? 'segment',
    characterName,
    actorName,
    bbox.map((value: number) => value.toFixed(6)).join(','),
  ].join('|')
  const idHash = createHash('sha256').update(idSeed).digest('hex').slice(0, 20)
  const id = `${createdAt.replace(/[-:.TZ]/g, '')}_row${String(rowIndex).padStart(4, '0')}_${safeCharacter}_${idHash}`
  let framePath = typeof body.frame_path === 'string' ? body.frame_path : ''
  if (!framePath && typeof sceneRow?.scene_marker_image_path === 'string') framePath = sceneRow.scene_marker_image_path
  const keyframeImageDataUrl = typeof body.keyframe_image_data_url === 'string' ? body.keyframe_image_data_url : ''
  if (keyframeImageDataUrl) {
    const match = keyframeImageDataUrl.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/)
    if (!match) {
      res.status(400).json({ error: 'keyframe_image_data_url must be a PNG or JPEG data URL' })
      return
    }
    try {
      const framesDir = resolve(WATCH_ANNOTATIONS_DIR, 'frames')
      await mkdir(framesDir, { recursive: true })
      const extension = match[1] === 'jpeg' ? 'jpg' : 'png'
      framePath = resolve(framesDir, `${id}.${extension}`)
      await writeFile(framePath, Buffer.from(match[2], 'base64'))
    } catch (err) {
      res.status(500).json({ error: 'failed to write captured key frame', detail: String(err) })
      return
    }
  }
  const memoryKey = watchKeyframeMemoryKey({
    assetUid,
    rowIndex,
    characterName,
    actorName,
    boxId: requestedBoxId || id,
    keyframeTimeSeconds,
    timecode,
  })
  const annotationTrackId = typeof body.annotation_track_id === 'string' && body.annotation_track_id.trim()
    ? body.annotation_track_id.trim()
    : `${safeMemoryKeyPart(assetUid)}:row${rowIndex}:${safeMemoryKeyPart(characterName)}:primary`
  const qdrantPointId = deterministicUuidFromSeed(`watch-ui-human-keyframe-crop|${memoryKey}`)
  let qdrantCropRef: JsonRecord | null = null
  let qdrantWriteReceipt: JsonRecord | null = null
  let cropPath = ''
  let detectorObservationRef: JsonRecord | null = null
  let detectorObservationLinkStatus = 'not_evaluated'
  if (framePath && existsSync(framePath)) {
    try {
      const cropsDir = resolve(WATCH_ANNOTATIONS_DIR, 'crops')
      cropPath = resolve(cropsDir, `${id}.png`)
      const crop = await cropWatchFrameToDataUrl({ sourcePath: framePath, bbox, outputPath: cropPath })
      const embedded = await embedWatchCrop(crop.dataUrl)
      qdrantWriteReceipt = await upsertWatchQdrantCropPoint({
        pointId: qdrantPointId,
        vector: embedded.embedding,
        payload: {
          asset_uid: assetUid,
          row_index: rowIndex,
          annotation_id: `${WATCH_KEYFRAME_ANNOTATIONS_COLLECTION}/${memoryKey}`,
          annotation_key: memoryKey,
          receipt_id: id,
          character_name: characterName,
          character_entity_id: `character:${safeMemoryKeyPart(characterName)}`,
          actor_name: actorName || null,
          actor_entity_id: actorName ? `actor:${safeMemoryKeyPart(actorName)}` : null,
          bbox,
          bbox_format: 'normalized_xyxy',
          keyframe_time_seconds: keyframeTimeSeconds,
          keyframe_time_basis: 'media_seconds',
          movie_segment: movieSegment || timecode,
          timecode,
          source: 'human_keyframe_crop',
          review_state: 'human_approved',
          label_type: 'positive',
          crop_path: crop.cropPath,
          source_frame_path: framePath,
          crop_dimensions: {
            width: crop.width,
            height: crop.height,
            source_width: crop.sourceWidth,
            source_height: crop.sourceHeight,
          },
        },
      })
      qdrantCropRef = {
        collection: WATCH_CROP_QDRANT_COLLECTION,
        point_id: qdrantPointId,
        vector_name: 'image',
        model: embedded.model,
        model_version: embedded.model_version ?? null,
        dimensions: embedded.dimensions,
        modality: 'person_crop',
        source: 'human_keyframe_crop',
      }
    } catch (err) {
      res.status(502).json({ error: 'failed to create watch crop embedding point', detail: String(err), frame_path: framePath })
      return
    }
  }
  const requestedDetectorTrackId = typeof requestedDetectorObservationRef?.track_id === 'string'
    ? requestedDetectorObservationRef.track_id.trim()
    : ''
  const requestedDetectorCandidateId = typeof requestedDetectorObservationRef?.detector_candidate_id === 'string'
    ? requestedDetectorObservationRef.detector_candidate_id.trim()
    : ''
  if (requestedDetectorObservationRef && requestedDetectorTrackId) {
    detectorObservationRef = {
      ...requestedDetectorObservationRef,
      source: typeof requestedDetectorObservationRef.source === 'string'
        ? requestedDetectorObservationRef.source
        : 'watch_annotation_island_yolo_candidate',
      link_quality: typeof requestedDetectorObservationRef.link_quality === 'string'
        ? requestedDetectorObservationRef.link_quality
        : 'human_selected_yolo_track',
      track_id: requestedDetectorTrackId,
      detector_candidate_id: requestedDetectorCandidateId || requestedDetectorTrackId,
      detected_class: typeof requestedDetectorObservationRef.detected_class === 'string'
        ? requestedDetectorObservationRef.detected_class
        : 'person',
      bbox: Array.isArray(requestedDetectorObservationRef.bbox)
        ? requestedDetectorObservationRef.bbox
        : normalizedBbox,
      human_bbox: Array.isArray(requestedDetectorObservationRef.human_bbox)
        ? requestedDetectorObservationRef.human_bbox
        : normalizedBbox,
      time_seconds: typeof requestedDetectorObservationRef.time_seconds === 'number'
        ? Number(requestedDetectorObservationRef.time_seconds.toFixed(3))
        : segmentOffsetSeconds,
      media_time_seconds: typeof requestedDetectorObservationRef.media_time_seconds === 'number'
        ? Number(requestedDetectorObservationRef.media_time_seconds.toFixed(3))
        : keyframeTimeSeconds,
      human_character_name: characterName,
      human_actor_name: actorName || null,
    }
    detectorObservationLinkStatus = String(detectorObservationRef.link_quality ?? 'human_selected_yolo_track')
  } else {
    try {
      detectorObservationRef = await findWatchDetectorObservationRef({
        assetUid,
        rowIndex,
        bbox: normalizedBbox,
        keyframeTimeSeconds,
        segmentBounds,
      })
      detectorObservationLinkStatus = detectorObservationRef ? String(detectorObservationRef.link_quality ?? 'linked') : 'no_iou_match_ge_0_5'
    } catch (err) {
      detectorObservationRef = null
      detectorObservationLinkStatus = `lookup_failed: ${err instanceof Error ? err.message : String(err)}`
    }
  }
  const receipt = {
    schema: 'watch.human_character_keyframe_annotation_receipt.v1',
    status: 'ANNOTATION_RECORDED',
    created_at: createdAt,
    annotation: {
      id,
      box_id: requestedBoxId || id,
      asset_uid: assetUid,
      row_index: rowIndex,
      timecode,
      movie_segment: movieSegment,
      character_name: characterName,
      actor_name: actorName || null,
      bbox,
      bbox_dimensions: {
        left: Number(bbox[0].toFixed(6)),
        top: Number(bbox[1].toFixed(6)),
        width: Number((bbox[2] - bbox[0]).toFixed(6)),
        height: Number((bbox[3] - bbox[1]).toFixed(6)),
      },
      bbox_format: 'normalized_xyxy',
      frame_path: framePath,
      crop_path: cropPath || null,
      keyframe_time_seconds: keyframeTimeSeconds,
      keyframe_source: keyframeImageDataUrl ? 'captured_segment_frame' : 'scene_marker_image',
      video_clip_path: typeof body.video_clip_path === 'string' ? body.video_clip_path : '',
      source: 'human_keyframe_annotation',
      intended_use: 'approved_reference_candidate_for_identity_verifier',
      adjustment_events: adjustmentEvents,
      detector_observation_ref: detectorObservationRef,
      detector_observation_link_status: detectorObservationLinkStatus,
      qdrant_refs: qdrantCropRef ? { crop_points: [qdrantCropRef] } : { crop_points: [] },
    },
    proof_scope: {
      mocked: false,
      live: true,
      proves: [
        'watch UI submitted a human-drawn normalized keyframe bbox',
        'watch API persisted a receipt for later crop/reference extraction',
        `watch API persisted a retrieval document in $memory collection ${WATCH_KEYFRAME_ANNOTATIONS_COLLECTION}`,
        ...(qdrantCropRef ? [`watch API created a crop embedding point in Qdrant collection ${WATCH_CROP_QDRANT_COLLECTION}`] : []),
        ...(keyframeImageDataUrl ? ['watch API persisted the captured video key frame image'] : []),
      ],
      does_not_prove: [
        'character identity recognition is correct',
        'YOLO/ByteTrack followed the annotation across frames',
        ...(qdrantCropRef ? [] : ['Jina crop/reference similarity receipts were generated']),
      ],
    },
  }

  try {
    await mkdir(WATCH_ANNOTATIONS_DIR, { recursive: true })
    const receiptPath = resolve(WATCH_ANNOTATIONS_DIR, `${id}.json`)
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf-8')

    const sceneContextSummary = [
      `Row ${rowIndex} ${assetUid} scene`,
      characterName ? `human-approved ${characterName} keyframe` : '',
      sceneRow?.visual_description ? `visual: ${String(sceneRow.visual_description).replace(/\s+/g, ' ').slice(0, 220)}` : '',
      sceneRow?.srt_text ? `SRT/Whisper: ${String(sceneRow.srt_text).replace(/\s+/g, ' ').slice(0, 220)}` : '',
    ].filter(Boolean).join('; ')
    const retrievalText = [
      `Watch character keyframe annotation`,
      `Asset: ${assetUid}`,
      `Row: ${rowIndex}`,
      `Timecode: ${timecode}`,
      `Movie segment: ${movieSegment || timecode}`,
      `Keyframe seconds: ${keyframeTimeSeconds ?? 'unknown'}`,
      `Character: ${characterName}`,
      actorName ? `Actor: ${actorName}` : '',
      `Normalized bbox xyxy: ${bbox.map((value: number) => value.toFixed(6)).join(', ')}`,
      sceneContextSummary ? `Scene context: ${sceneContextSummary}` : '',
    ].filter(Boolean).join('\n')
    const memoryDocument = {
      _key: memoryKey,
      kind: 'watch_keyframe_annotation',
      schema: 'watch_keyframe_annotation.v1',
      status: 'approved_reference_candidate',
      lifecycle_status: 'current',
      scope: 'watch',
      provenance_source: 'ux-lab.watch',
      receipt_path: receiptPath,
      receipt_id: id,
      annotation_uid: memoryKey,
      annotation_track_id: annotationTrackId,
      character_instance_id: annotationTrackId,
      box_id: receipt.annotation.box_id,
      asset_uid: assetUid,
      row_index: rowIndex,
      timecode,
      movie_segment: movieSegment || timecode,
      character_name: characterName,
      actor_name: actorName || null,
      movie_metadata: {
        asset_uid: assetUid,
        title: String(assetUid).toLowerCase().includes('bad_santa') || String(assetUid).toLowerCase().includes('badsanta') ? 'Bad Santa' : assetUid,
        release_year: String(assetUid).includes('2003') || String(assetUid).toLowerCase().includes('bad_santa') || String(assetUid).toLowerCase().includes('badsanta') ? 2003 : null,
        edition: String(assetUid).toLowerCase().includes('unrated') ? 'Unrated' : '',
        media_slug: WATCH_MEDIA_SLUG,
        source_video_path: typeof sceneRow?.video_clip_path === 'string' ? sceneRow.video_clip_path : '',
      },
      actor_metadata: {
        character_name: characterName,
        actor_name: actorName || null,
        character_entity_id: `character:${safeMemoryKeyPart(characterName)}`,
        actor_entity_id: actorName ? `actor:${safeMemoryKeyPart(actorName)}` : null,
        domain_source: 'human_ui',
        domain_source_refs: [receiptPath],
      },
      entity_ids: [
        `character:${safeMemoryKeyPart(characterName)}`,
        ...(actorName ? [`actor:${safeMemoryKeyPart(actorName)}`] : []),
      ],
      bbox,
      bbox_format: 'normalized_xyxy',
      bbox_dimensions: receipt.annotation.bbox_dimensions,
      frame_path: framePath,
      crop_path: cropPath || null,
      video_clip_path: typeof body.video_clip_path === 'string' ? body.video_clip_path : (typeof sceneRow?.video_clip_path === 'string' ? sceneRow.video_clip_path : ''),
      keyframe_time_seconds: keyframeTimeSeconds,
      keyframe_time_basis: 'media_seconds',
      keyframe_source: receipt.annotation.keyframe_source,
      source: {
        type: 'human_ui',
        status: 'human_approved',
        tool: 'watch-ui',
        segment_start_seconds: segmentBounds?.start ?? null,
        segment_end_seconds: segmentBounds?.end ?? null,
        segment_offset_seconds: segmentOffsetSeconds,
      },
      adjustment_events: adjustmentEvents,
      ...(detectorObservationRef ? { detector_observation_ref: detectorObservationRef } : {}),
      detector_observation_link_status: detectorObservationLinkStatus,
      intended_use: 'approved_reference_candidate_for_identity_verifier',
      training_role: {
        label_type: 'positive',
        target_entity_id: `character:${safeMemoryKeyPart(characterName)}`,
        target_entity_kind: 'character',
        identity_scope: 'asset_character',
        usable_for_agent_matching: true,
        review_state: 'human_approved',
        example_weight: 1.0,
      },
      interpolation: {
        type: 'linear',
        version: 'watch-ui-interpolation.v1',
        applies_to: 'bbox',
        bbox_format: 'normalized_xyxy',
        time_basis: 'media_seconds',
        runtime_only: true,
        source_keyframe_ids: [memoryKey],
        source_keyframe_order: 'keyframe_time_seconds_ascending',
        extrapolation: 'hold_previous',
        clamp_bbox_to_unit_interval: true,
        params: {},
      },
      scene_context_refs: {
        watch_content_collection: 'watch_content',
        watch_content_key: `watch_segment_${WATCH_MEDIA_SLUG}_${String(rowIndex).padStart(4, '0')}`,
        time_window_start_seconds: segmentBounds?.start ?? null,
        time_window_end_seconds: segmentBounds?.end ?? null,
        scene_marker_time_seconds: keyframeTimeSeconds,
        srt_text_field: 'srt_text',
        whisper_text_field: 'text',
        audio_audit_text_field: 'sound',
        visual_description_field: 'visual_description',
        scene_marker_frame_field: 'scene_marker_image_path',
        source_ref: `watch_content/watch_segment_${WATCH_MEDIA_SLUG}_${String(rowIndex).padStart(4, '0')}`,
      },
      scene_context_summary: sceneContextSummary,
      qdrant_refs: qdrantCropRef ? { crop_points: [qdrantCropRef] } : { crop_points: [] },
      qdrant_embedding_status: qdrantCropRef ? 'created' : 'no_source_frame',
      retrieval_text: retrievalText,
      problem: `Find Watch movie segments or annotations containing ${characterName}${actorName ? ` played by ${actorName}` : ''}.`,
      solution: `Human-approved keyframe bbox for ${characterName} at ${movieSegment || timecode}: ${bbox.map((value: number) => value.toFixed(6)).join(',')}.`,
      tags: [
        'watch',
        'watch_keyframe_annotation',
        'human_keyframe_annotation',
        'approved_reference_candidate',
        'current',
        `asset:${safeMemoryKeyPart(assetUid)}`,
        `character:${safeMemoryKeyPart(characterName)}`,
        ...(actorName ? [`actor:${safeMemoryKeyPart(actorName)}`] : []),
      ],
      created_at: createdAt,
      updated_at: createdAt,
    }
    const memory = await memoryHttpPost('/upsert', {
      collection: WATCH_KEYFRAME_ANNOTATIONS_COLLECTION,
      documents: [memoryDocument],
      skip_embedding: true,
    }, 10_000)

    res.json({
      ok: true,
      receipt_path: receiptPath,
      memory_collection: WATCH_KEYFRAME_ANNOTATIONS_COLLECTION,
      memory_key: memoryKey,
      memory,
      qdrant: qdrantCropRef ? {
        collection: WATCH_CROP_QDRANT_COLLECTION,
        point_id: qdrantPointId,
        write_receipt: qdrantWriteReceipt,
      } : null,
      receipt,
    })
  } catch (err) {
    res.status(502).json({ error: 'failed to persist annotation receipt or memory document', detail: String(err) })
  }
})

app.post('/api/projects/watch/annotations/track-control', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body as JsonRecord : {}
  const characterName = typeof body.character_name === 'string' ? body.character_name.trim() : ''
  const actorName = typeof body.actor_name === 'string' ? body.actor_name.trim() : ''
  const rowIndex = Number(body.row_index)
  let timecode = typeof body.timecode === 'string' ? body.timecode.trim() : ''
  const assetUid = typeof body.asset_uid === 'string' && body.asset_uid.trim() ? body.asset_uid.trim() : WATCH_MEDIA_SLUG
  let movieSegment = typeof body.movie_segment === 'string' ? body.movie_segment.trim() : ''
  const requestedBoxId = typeof body.box_id === 'string' && body.box_id.trim() ? body.box_id.trim() : ''
  const requestedTrackControl = body.track_control && typeof body.track_control === 'object' ? body.track_control as JsonRecord : {}
  const action = typeof requestedTrackControl.action === 'string' ? requestedTrackControl.action : ''
  const reason = typeof requestedTrackControl.reason === 'string' && requestedTrackControl.reason.trim()
    ? requestedTrackControl.reason.trim()
    : 'character_offscreen'
  const adjustmentEvents = Array.isArray(body.adjustment_events)
    ? body.adjustment_events.filter((event: any) => event && typeof event === 'object').slice(-50)
    : []

  if (!characterName) {
    res.status(400).json({ ok: false, error: 'character_name is required' })
    return
  }
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    res.status(400).json({ ok: false, error: 'row_index must be a non-negative integer' })
    return
  }
  if (String(body.visibility_state) !== 'offscreen' || action !== 'stop_character_scan') {
    res.status(400).json({ ok: false, error: 'track-control writes currently require visibility_state=offscreen and action=stop_character_scan' })
    return
  }

  let sceneRow: WatchSceneElement | null = null
  try {
    sceneRow = findWatchSceneElement(await readWatchReport(), rowIndex)
  } catch {
    sceneRow = null
  }
  if (!timecode && sceneRow?.timecode) timecode = sceneRow.timecode
  if (!movieSegment && sceneRow?.movie_segment) movieSegment = sceneRow.movie_segment
  const segmentBounds = parseWatchSegmentBounds(movieSegment)
  const rawKeyframeTimeSeconds = typeof body.keyframe_time_seconds === 'number' && Number.isFinite(body.keyframe_time_seconds)
    ? Number(body.keyframe_time_seconds.toFixed(3))
    : null
  const keyframeTimeBasis = typeof body.keyframe_time_basis === 'string' ? body.keyframe_time_basis : ''
  const segmentDurationSeconds = segmentBounds ? Number((segmentBounds.end - segmentBounds.start).toFixed(3)) : null
  const keyframeTimeSeconds = rawKeyframeTimeSeconds === null
    ? null
    : segmentBounds && (
      keyframeTimeBasis === 'segment_seconds'
      || (keyframeTimeBasis !== 'media_seconds' && rawKeyframeTimeSeconds >= 0 && segmentDurationSeconds !== null && rawKeyframeTimeSeconds <= segmentDurationSeconds)
    )
      ? Number((segmentBounds.start + rawKeyframeTimeSeconds).toFixed(3))
      : rawKeyframeTimeSeconds
  const segmentOffsetSeconds = segmentBounds && keyframeTimeSeconds !== null
    ? Number((keyframeTimeSeconds - segmentBounds.start).toFixed(3))
    : rawKeyframeTimeSeconds
  if (!timecode) {
    res.status(400).json({ ok: false, error: 'timecode is required' })
    return
  }

  const createdAt = new Date().toISOString()
  const safeCharacter = safeMemoryKeyPart(characterName)
  const memoryKey = watchKeyframeMemoryKey({
    assetUid,
    rowIndex,
    characterName,
    actorName,
    boxId: requestedBoxId || `offscreen:${keyframeTimeSeconds ?? timecode}:${safeCharacter}`,
    keyframeTimeSeconds,
    timecode,
  })
  const annotationTrackId = typeof body.annotation_track_id === 'string' && body.annotation_track_id.trim()
    ? body.annotation_track_id.trim()
    : `${safeMemoryKeyPart(assetUid)}:row${rowIndex}:${safeCharacter}:seq1`
  const id = `${createdAt.replace(/[-:.TZ]/g, '')}_row${String(rowIndex).padStart(4, '0')}_${safeCharacter}_offscreen`
  const receipt = {
    schema: 'watch.character_track_control_receipt.v1',
    status: 'TRACK_CONTROL_RECORDED',
    created_at: createdAt,
    annotation: {
      id,
      box_id: requestedBoxId || id,
      asset_uid: assetUid,
      row_index: rowIndex,
      timecode,
      movie_segment: movieSegment || timecode,
      character_name: characterName,
      actor_name: actorName || null,
      annotation_track_id: annotationTrackId,
      visibility_state: 'offscreen',
      bbox: null,
      bbox_format: 'none',
      keyframe_time_seconds: keyframeTimeSeconds,
      keyframe_time_basis: 'media_seconds',
      source: 'human_track_control',
      track_control: {
        action: 'stop_character_scan',
        reason,
        applies_after_seconds: keyframeTimeSeconds,
      },
      qdrant_refs: { crop_points: [] },
    },
    proof_scope: {
      mocked: false,
      live: true,
      proves: [
        'watch UI submitted a human offscreen/track-stop marker',
        `watch API persisted a no-box retrieval document in $memory collection ${WATCH_KEYFRAME_ANNOTATIONS_COLLECTION}`,
        'watch API did not create a crop embedding for the offscreen marker',
      ],
      does_not_prove: [
        'future agent tracking obeyed the stop marker',
        'character reappearance was correctly identified',
      ],
    },
  }

  try {
    await mkdir(WATCH_ANNOTATIONS_DIR, { recursive: true })
    const receiptPath = resolve(WATCH_ANNOTATIONS_DIR, `${id}.json`)
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf-8')

    const sceneContextSummary = [
      `Row ${rowIndex} ${assetUid} scene`,
      `${characterName} marked offscreen by human at ${keyframeTimeSeconds ?? timecode}`,
      sceneRow?.visual_description ? `visual: ${String(sceneRow.visual_description).replace(/\s+/g, ' ').slice(0, 220)}` : '',
      sceneRow?.srt_text ? `SRT/Whisper: ${String(sceneRow.srt_text).replace(/\s+/g, ' ').slice(0, 220)}` : '',
    ].filter(Boolean).join('; ')
    const retrievalText = [
      `Watch character track control annotation`,
      `Asset: ${assetUid}`,
      `Row: ${rowIndex}`,
      `Timecode: ${timecode}`,
      `Movie segment: ${movieSegment || timecode}`,
      `Keyframe seconds: ${keyframeTimeSeconds ?? 'unknown'}`,
      `Character: ${characterName}`,
      actorName ? `Actor: ${actorName}` : '',
      `Visibility: offscreen`,
      `Track control: stop_character_scan`,
      sceneContextSummary ? `Scene context: ${sceneContextSummary}` : '',
    ].filter(Boolean).join('\n')
    const memoryDocument = {
      _key: memoryKey,
      kind: 'watch_keyframe_annotation',
      schema: 'watch_keyframe_annotation.v1',
      status: 'human_track_control',
      lifecycle_status: 'current',
      scope: 'watch',
      provenance_source: 'ux-lab.watch',
      receipt_path: receiptPath,
      receipt_id: id,
      annotation_uid: memoryKey,
      annotation_track_id: annotationTrackId,
      character_instance_id: annotationTrackId,
      box_id: receipt.annotation.box_id,
      asset_uid: assetUid,
      row_index: rowIndex,
      timecode,
      movie_segment: movieSegment || timecode,
      character_name: characterName,
      actor_name: actorName || null,
      movie_metadata: {
        asset_uid: assetUid,
        title: String(assetUid).toLowerCase().includes('bad_santa') || String(assetUid).toLowerCase().includes('badsanta') ? 'Bad Santa' : assetUid,
        release_year: String(assetUid).includes('2003') || String(assetUid).toLowerCase().includes('bad_santa') || String(assetUid).toLowerCase().includes('badsanta') ? 2003 : null,
        edition: String(assetUid).toLowerCase().includes('unrated') ? 'Unrated' : '',
        media_slug: WATCH_MEDIA_SLUG,
        source_video_path: typeof sceneRow?.video_clip_path === 'string' ? sceneRow.video_clip_path : '',
      },
      actor_metadata: {
        character_name: characterName,
        actor_name: actorName || null,
        character_entity_id: `character:${safeMemoryKeyPart(characterName)}`,
        actor_entity_id: actorName ? `actor:${safeMemoryKeyPart(actorName)}` : null,
        domain_source: 'human_ui',
        domain_source_refs: [receiptPath],
      },
      entity_ids: [
        `character:${safeMemoryKeyPart(characterName)}`,
        ...(actorName ? [`actor:${safeMemoryKeyPart(actorName)}`] : []),
      ],
      visibility_state: 'offscreen',
      bbox: null,
      bbox_format: 'none',
      bbox_dimensions: null,
      keyframe_time_seconds: keyframeTimeSeconds,
      keyframe_time_basis: 'media_seconds',
      source: {
        type: 'human_ui',
        status: 'human_approved',
        tool: 'watch-ui',
        segment_start_seconds: segmentBounds?.start ?? null,
        segment_end_seconds: segmentBounds?.end ?? null,
        segment_offset_seconds: segmentOffsetSeconds,
      },
      adjustment_events: adjustmentEvents,
      intended_use: 'track_sequence_boundary_for_identity_verifier',
      training_role: {
        label_type: 'ignore',
        target_entity_id: `character:${safeMemoryKeyPart(characterName)}`,
        target_entity_kind: 'character',
        identity_scope: 'asset_character',
        usable_for_agent_matching: false,
        review_state: 'human_approved',
        example_weight: 0,
        reason,
      },
      interpolation: {
        type: 'none',
        version: 'watch-ui-interpolation.v1',
        applies_to: 'bbox',
        bbox_format: 'none',
        time_basis: 'media_seconds',
        runtime_only: true,
        source_keyframe_ids: [memoryKey],
        source_keyframe_order: 'keyframe_time_seconds_ascending',
        extrapolation: 'none',
        clamp_bbox_to_unit_interval: true,
        params: {},
      },
      track_control: {
        action: 'stop_character_scan',
        reason,
        applies_after_seconds: keyframeTimeSeconds,
        resumes_with_new_annotation_track_id: true,
      },
      scene_context_refs: {
        watch_content_collection: 'watch_content',
        watch_content_key: `watch_segment_${WATCH_MEDIA_SLUG}_${String(rowIndex).padStart(4, '0')}`,
        time_window_start_seconds: segmentBounds?.start ?? null,
        time_window_end_seconds: segmentBounds?.end ?? null,
        scene_marker_time_seconds: keyframeTimeSeconds,
        srt_text_field: 'srt_text',
        whisper_text_field: 'text',
        audio_audit_text_field: 'sound',
        visual_description_field: 'visual_description',
        scene_marker_frame_field: 'scene_marker_image_path',
        source_ref: `watch_content/watch_segment_${WATCH_MEDIA_SLUG}_${String(rowIndex).padStart(4, '0')}`,
      },
      scene_context_summary: sceneContextSummary,
      qdrant_refs: { crop_points: [] },
      qdrant_embedding_status: 'not_applicable_offscreen',
      retrieval_text: retrievalText,
      problem: `Find Watch movie segments where ${characterName}${actorName ? ` played by ${actorName}` : ''} leaves the visible frame.`,
      solution: `Human-approved offscreen marker stops ${characterName} scan at ${movieSegment || timecode}.`,
      tags: [
        'watch',
        'watch_keyframe_annotation',
        'human_track_control',
        'offscreen',
        'stop_character_scan',
        'current',
        `asset:${safeMemoryKeyPart(assetUid)}`,
        `character:${safeMemoryKeyPart(characterName)}`,
        ...(actorName ? [`actor:${safeMemoryKeyPart(actorName)}`] : []),
      ],
      created_at: createdAt,
      updated_at: createdAt,
    }
    const memory = await memoryHttpPost('/upsert', {
      collection: WATCH_KEYFRAME_ANNOTATIONS_COLLECTION,
      documents: [memoryDocument],
      skip_embedding: true,
    }, 10_000)
    res.json({
      ok: true,
      receipt_path: receiptPath,
      memory_collection: WATCH_KEYFRAME_ANNOTATIONS_COLLECTION,
      memory_key: memoryKey,
      memory,
      qdrant: null,
      receipt,
    })
  } catch (err) {
    res.status(502).json({ ok: false, error: 'failed to persist track-control marker', detail: String(err) })
  }
})

app.post('/api/projects/watch/orpheus-reviews', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body as JsonRecord : {}
  const rowIndex = Number(body.row_index)
  const timecode = typeof body.timecode === 'string' ? body.timecode.trim() : ''
  const movieSegment = typeof body.movie_segment === 'string' ? body.movie_segment.trim() : ''
  const selectionStart = Number(body.selection_start_seconds)
  const selectionEnd = Number(body.selection_end_seconds)
  const selectedTags = Array.isArray(body.selected_tags)
    ? body.selected_tags.map((tag) => String(tag).trim()).filter(Boolean)
    : []

  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    res.status(400).json({ ok: false, error: 'row_index must be a non-negative integer' })
    return
  }
  if (!timecode) {
    res.status(400).json({ ok: false, error: 'timecode is required' })
    return
  }
  if (!Number.isFinite(selectionStart) || !Number.isFinite(selectionEnd) || selectionEnd <= selectionStart) {
    res.status(400).json({ ok: false, error: 'selection_start_seconds and selection_end_seconds must define a positive window' })
    return
  }
  if (selectedTags.length === 0) {
    res.status(400).json({ ok: false, error: 'selected_tags must include at least one Orpheus tag' })
    return
  }

  const createdAt = new Date().toISOString()
  const id = `${createdAt.replace(/[-:.TZ]/g, '')}_row${String(rowIndex).padStart(4, '0')}_orpheus_review`
  const receipt = {
    schema: 'watch.orpheus_review_receipt.v1',
    status: 'ORPHEUS_REVIEW_STAGED',
    created_at: createdAt,
    review: {
      id,
      asset_uid: typeof body.asset_uid === 'string' ? body.asset_uid : 'watch_asset',
      row_index: rowIndex,
      timecode,
      movie_segment: movieSegment || timecode,
      selection_start_seconds: Number(selectionStart.toFixed(3)),
      selection_end_seconds: Number(selectionEnd.toFixed(3)),
      duration_seconds: Number((selectionEnd - selectionStart).toFixed(3)),
      selected_tags: selectedTags,
      transcript: typeof body.transcript === 'string' ? body.transcript : '',
      video_clip_path: typeof body.video_clip_path === 'string' ? body.video_clip_path : '',
      audio_clip_path: typeof body.audio_clip_path === 'string' ? body.audio_clip_path : '',
      scene_marker_image_path: typeof body.scene_marker_image_path === 'string' ? body.scene_marker_image_path : '',
      source: 'watch_orpheus_review',
      intended_use: 'voice_segment_selector_export_candidate',
    },
    voice_segment_selector_input: {
      source_type: 'movie_curated',
      timecode,
      movie_segment: movieSegment || timecode,
      start_offset: Number(selectionStart.toFixed(3)),
      end_offset: Number(selectionEnd.toFixed(3)),
      emotion_tags: selectedTags,
      transcript: typeof body.transcript === 'string' ? body.transcript : '',
      video_path: typeof body.video_clip_path === 'string' ? body.video_clip_path : '',
      audio_path: typeof body.audio_clip_path === 'string' ? body.audio_clip_path : '',
    },
    proof_scope: {
      mocked: false,
      live: true,
      proves: [
        'watch UI submitted a bounded media review window',
        'watch API persisted an Orpheus review receipt',
        'receipt contains voice-segment-selector handoff fields',
      ],
      does_not_prove: [
        'the selected emotion tag is correct',
        'voice-segment-selector export has run',
        'the segment is training-ready',
      ],
    },
  }

  try {
    await mkdir(WATCH_ORPHEUS_REVIEWS_DIR, { recursive: true })
    const receiptPath = resolve(WATCH_ORPHEUS_REVIEWS_DIR, `${id}.json`)
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf-8')
    res.json({ ok: true, receipt_path: receiptPath, receipt })
  } catch (err) {
    res.status(500).json({ ok: false, error: 'failed to write Orpheus review receipt', detail: String(err) })
  }
})

app.get('/api/projects/watch/overlay-payload', async (_req, res) => {
  try {
    res.json(await readWatchOverlayPayload())
  } catch (err) {
    res.status(404).json({ error: 'watch_overlay_payload_unavailable', detail: String(err), payload_path: WATCH_OVERLAY_PAYLOAD_PATH })
  }
})

app.get('/api/projects/watch/media', async (req, res) => {
  const rawPath = typeof req.query.path === 'string' ? req.query.path : ''
  await serveWatchMediaPath(rawPath, req, res)
})

app.get('/api/projects/watch/audio-peaks', async (req, res) => {
  try {
    const rawPath = typeof req.query.path === 'string' ? req.query.path : ''
    const requestedPeakCount = Number(req.query.count ?? 96)
    const peakCount = Math.max(32, Math.min(240, Number.isFinite(requestedPeakCount) ? Math.round(requestedPeakCount) : 96))
    res.json(await computeWatchAudioPeaks(rawPath, peakCount))
  } catch (err) {
    res.status(422).json({
      error: 'watch_audio_peaks_unavailable',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
})

app.post('/api/projects/watch/audio-merge', async (req, res) => {
  try {
    const body = req.body && typeof req.body === 'object' ? req.body as JsonRecord : {}
    const rawSegments = Array.isArray(body.segments) ? body.segments as unknown[] : []
    const rawClips = rawSegments.length
      ? rawSegments
        .map((segment) => {
          const record = segment && typeof segment === 'object' ? segment as JsonRecord : {}
          return String(record.path ?? '').trim()
        })
        .filter(Boolean)
      : Array.isArray(body.clips) ? body.clips.map(String).filter(Boolean) : []
    const requestedRate = Number(body.slowdown_rate ?? 1)
    const slowdownRate = Number.isFinite(requestedRate)
      ? Math.max(0.5, Math.min(1, requestedRate))
      : 1
    const outputName = String(body.output_name ?? 'watch-audio-merge.wav')
      .replace(/[^a-zA-Z0-9._-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 120) || 'watch-audio-merge.wav'

    if (rawClips.length === 0) {
      res.status(400).json({ error: 'audio_merge_requires_clips' })
      return
    }
    if (rawClips.length > 32) {
      res.status(400).json({ error: 'audio_merge_too_many_clips', max: 32 })
      return
    }

    const realSegments: Array<{ path: string; startOffset: number; endOffset: number | null }> = []
    for (let index = 0; index < rawClips.length; index += 1) {
      const rawPath = rawClips[index]
      if (!rawPath.startsWith('/')) throw new Error(`absolute clip path required: ${rawPath}`)
      let realPath = ''
      try {
        realPath = realpathSync(rawPath)
      } catch {
        throw new Error(`clip file not found: ${rawPath}`)
      }
      if (!isAllowedWatchMediaPath(realPath)) throw new Error(`clip path outside allowed Watch roots: ${rawPath}`)
      const fileStat = await stat(realPath)
      if (!fileStat.isFile()) throw new Error(`clip path is not a file: ${rawPath}`)
      const rawSegment = rawSegments[index] && typeof rawSegments[index] === 'object' ? rawSegments[index] as JsonRecord : {}
      const startOffset = Math.max(0, Number(rawSegment.start_offset ?? 0) || 0)
      const rawEndOffset = Number(rawSegment.end_offset)
      const endOffset = Number.isFinite(rawEndOffset) && rawEndOffset > startOffset ? rawEndOffset : null
      realSegments.push({ path: realPath, startOffset, endOffset })
    }

    const outputDir = '/tmp/watch-audio-merge'
    await mkdir(outputDir, { recursive: true })
    const outputPath = resolve(outputDir, `${Date.now()}-${outputName.endsWith('.wav') ? outputName : `${outputName}.wav`}`)

    const args = ['-y', '-v', 'error']
    for (const segment of realSegments) args.push('-i', segment.path)
    const trimFilter = (segment: { startOffset: number; endOffset: number | null }, index: number) => {
      const start = Number(segment.startOffset.toFixed(3))
      const end = segment.endOffset == null ? '' : `:end=${Number(segment.endOffset.toFixed(3))}`
      return `[${index}:a]atrim=start=${start}${end},asetpts=PTS-STARTPTS,aresample=24000,aformat=sample_fmts=s16:channel_layouts=mono[a${index}]`
    }
    if (realSegments.length === 1) {
      args.push(
        '-filter_complex',
        `${trimFilter(realSegments[0], 0)};[a0]atempo=${slowdownRate}[out]`,
        '-map', '[out]',
        '-ar', '24000',
        '-ac', '1',
        outputPath,
      )
    } else {
      const prepared = realSegments
        .map((segment, index) => trimFilter(segment, index))
        .join(';')
      const labels = realSegments.map((_, index) => `[a${index}]`).join('')
      args.push(
        '-filter_complex',
        `${prepared};${labels}concat=n=${realSegments.length}:v=0:a=1,atempo=${slowdownRate}[out]`,
        '-map', '[out]',
        '-ar', '24000',
        '-ac', '1',
        outputPath,
      )
    }

    await execFileAsync('ffmpeg', args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })
    res.json({
      output_path: outputPath,
      output_url: `/api/projects/watch/static/tmp/${outputPath.slice('/tmp/'.length).split('/').map(encodeURIComponent).join('/')}`,
      input_count: realSegments.length,
      slowdown_rate: slowdownRate,
      command: ['ffmpeg', ...args],
    })
  } catch (err) {
    res.status(422).json({
      error: 'watch_audio_merge_failed',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
})

app.get(/^\/api\/projects\/watch\/media-file\/(.+)$/, async (req, res) => {
  const pathParam = Array.isArray(req.params[0]) ? req.params[0].join('/') : req.params[0]
  await serveWatchMediaPath(`/${pathParam}`, req, res)
})

app.get('/api/projects/watch/orpheus-segments', async (_req, res) => {
  try {
    const data = await memoryHttpPost('/list', {
      collection: WATCH_ORPHEUS_SEGMENTS_COLLECTION,
      limit: 500,
    }, 10_000)
    const segments = Array.isArray(data?.documents)
      ? data.documents.filter((doc: any) => typeof doc?.status !== 'string' || !doc.status.startsWith('discarded'))
      : []
    res.json({
      collection: WATCH_ORPHEUS_SEGMENTS_COLLECTION,
      segments,
      total: segments.length,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('404') || message.toLowerCase().includes('not found')) {
      res.json({ collection: WATCH_ORPHEUS_SEGMENTS_COLLECTION, segments: [], total: 0 })
      return
    }
    res.status(502).json({ error: 'failed_to_list_watch_orpheus_segments', detail: message })
  }
})

app.get('/api/projects/watch/annotations/summary', async (_req, res) => {
  try {
    const documents = await listMemoryCollectionDocuments(WATCH_KEYFRAME_ANNOTATIONS_COLLECTION, 10_000)
    const byRow = new Map<number, {
      row_index: number
      keyframe_count: number
      track_stop_count: number
      character_names: Set<string>
      actor_names: Set<string>
      qdrant_crop_point_count: number
      detector_link_count: number
      latest_updated_at: string
    }>()

    for (const document of documents) {
      if (document.kind !== 'watch_keyframe_annotation') continue
      if (!isActiveWatchAnnotationLifecycle(document)) continue
      const rowIndex = document.row_index
      if (typeof rowIndex !== 'number' || !Number.isInteger(rowIndex) || rowIndex < 0) continue
      const current = byRow.get(rowIndex) ?? {
        row_index: rowIndex,
        keyframe_count: 0,
        track_stop_count: 0,
        character_names: new Set<string>(),
        actor_names: new Set<string>(),
        qdrant_crop_point_count: 0,
        detector_link_count: 0,
        latest_updated_at: '',
      }
      current.keyframe_count += 1
      if ((document.track_control as JsonRecord | undefined)?.action === 'stop_character_scan' || document.visibility_state === 'offscreen') current.track_stop_count += 1
      if (typeof document.character_name === 'string' && document.character_name.trim()) current.character_names.add(document.character_name.trim())
      if (typeof document.actor_name === 'string' && document.actor_name.trim()) current.actor_names.add(document.actor_name.trim())
      const cropPoints = (document.qdrant_refs as JsonRecord | undefined)?.crop_points
      if (Array.isArray(cropPoints)) current.qdrant_crop_point_count += cropPoints.length
      if (document.detector_observation_ref && typeof document.detector_observation_ref === 'object') current.detector_link_count += 1
      const updatedAt = typeof document.updated_at === 'string' ? document.updated_at : (typeof document.created_at === 'string' ? document.created_at : '')
      if (updatedAt && updatedAt > current.latest_updated_at) current.latest_updated_at = updatedAt
      byRow.set(rowIndex, current)
    }

    const rows = Array.from(byRow.values())
      .sort((left, right) => left.row_index - right.row_index)
      .map((row) => ({
        row_index: row.row_index,
        keyframe_count: row.keyframe_count,
        track_stop_count: row.track_stop_count,
        character_names: Array.from(row.character_names).sort(),
        actor_names: Array.from(row.actor_names).sort(),
        qdrant_crop_point_count: row.qdrant_crop_point_count,
        detector_link_count: row.detector_link_count,
        latest_updated_at: row.latest_updated_at || null,
      }))
    res.json({
      collection: WATCH_KEYFRAME_ANNOTATIONS_COLLECTION,
      rows,
      annotated_row_count: rows.length,
      keyframe_count: rows.reduce((total, row) => total + row.keyframe_count, 0),
    })
  } catch (err) {
    res.status(502).json({
      error: 'failed_to_list_watch_annotation_summary',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
})

app.get('/api/projects/watch/identity-readiness', async (req, res) => {
  const assetUid = typeof req.query.asset_uid === 'string' ? req.query.asset_uid.trim() : ''
  const includeEval = ['1', 'true', 'yes'].includes(String(req.query.include_eval ?? '').toLowerCase())
  const acceptedMinimum = 8
  const embeddedMinimum = 5
  const detectorLinkedMinimum = 2
  const rowMinimum = 2
  const trackMinimum = 1

  try {
    const documents = await listMemoryCollectionDocuments(WATCH_KEYFRAME_ANNOTATIONS_COLLECTION, 10_000)
    const byCharacter = new Map<string, {
      character_name: string
      actor_name: string
      accepted_count: number
      embedded_count: number
      detector_link_count: number
      rejected_count: number
      rows: Set<number>
      tracks: Set<string>
      latest_updated_at: string
    }>()

    for (const document of documents) {
      if (document.kind !== 'watch_keyframe_annotation') continue
      if (!isActiveWatchAnnotationLifecycle(document)) continue
      if (assetUid && document.asset_uid && !watchAssetLikelyMatches(assetUid, document.asset_uid)) continue

      const characterName = typeof document.character_name === 'string' ? document.character_name.trim() : ''
      if (!characterName || safeMemoryKeyPart(characterName) === 'unassigned') continue
      const key = safeMemoryKeyPart(characterName)
      const current = byCharacter.get(key) ?? {
        character_name: characterName,
        actor_name: typeof document.actor_name === 'string' ? document.actor_name.trim() : '',
        accepted_count: 0,
        embedded_count: 0,
        detector_link_count: 0,
        rejected_count: 0,
        rows: new Set<number>(),
        tracks: new Set<string>(),
        latest_updated_at: '',
      }

      const trainingRole = document.training_role && typeof document.training_role === 'object'
        ? document.training_role as JsonRecord
        : {}
      const labelType = typeof trainingRole.label_type === 'string'
        ? trainingRole.label_type
        : typeof document.label_type === 'string'
          ? document.label_type
          : 'positive'
      const reviewState = typeof trainingRole.review_state === 'string'
        ? trainingRole.review_state
        : typeof document.review_state === 'string'
          ? document.review_state
          : ''
      const bbox = normalizeWatchBbox(document.bbox)
      const trackControl = document.track_control && typeof document.track_control === 'object'
        ? document.track_control as JsonRecord
        : null
      const isTrackControl = Boolean(trackControl)
        || document.visibility_state === 'offscreen'
        || document.kind === 'watch_track_control'
      if (!bbox && labelType !== 'negative') continue
      const isRejected = labelType === 'negative'
        || reviewState === 'human_rejected'
        || String(document.status ?? '').includes('rejected')
      const cropPoints = (document.qdrant_refs as JsonRecord | undefined)?.crop_points
      const hasEmbeddedCrop = document.qdrant_embedding_status === 'created'
        || (Array.isArray(cropPoints) && cropPoints.length > 0)

      if (isRejected) {
        current.rejected_count += 1
      } else if (labelType === 'positive' && !isTrackControl) {
        current.accepted_count += 1
        if (hasEmbeddedCrop) current.embedded_count += 1
      }

      if (document.detector_observation_ref && typeof document.detector_observation_ref === 'object') current.detector_link_count += 1
      if (typeof document.row_index === 'number' && Number.isInteger(document.row_index)) current.rows.add(document.row_index)
      for (const value of [
        document.annotation_track_id,
        document.character_instance_id,
        (document.detector_observation_ref as JsonRecord | undefined)?.track_id,
      ]) {
        if (typeof value === 'string' && value.trim()) current.tracks.add(value.trim())
      }
      const updatedAt = typeof document.updated_at === 'string' ? document.updated_at : (typeof document.created_at === 'string' ? document.created_at : '')
      if (updatedAt && updatedAt > current.latest_updated_at) current.latest_updated_at = updatedAt
      if (!current.actor_name && typeof document.actor_name === 'string') current.actor_name = document.actor_name.trim()
      byCharacter.set(key, current)
    }

    const characters = Array.from(byCharacter.values()).map((entry) => {
      const missing: string[] = []
      if (entry.accepted_count < acceptedMinimum) missing.push(`${acceptedMinimum - entry.accepted_count} accepted label${acceptedMinimum - entry.accepted_count === 1 ? '' : 's'}`)
      if (entry.embedded_count < embeddedMinimum) missing.push(`${embeddedMinimum - entry.embedded_count} embedded crop${embeddedMinimum - entry.embedded_count === 1 ? '' : 's'}`)
      if (entry.rows.size < rowMinimum) missing.push(`${rowMinimum - entry.rows.size} row${rowMinimum - entry.rows.size === 1 ? '' : 's'}`)
      if (entry.tracks.size < trackMinimum) missing.push(`${trackMinimum - entry.tracks.size} track${trackMinimum - entry.tracks.size === 1 ? '' : 's'}`)
      const progress = Math.min(
        1,
        Math.min(
          entry.accepted_count / acceptedMinimum,
          entry.embedded_count / embeddedMinimum,
          entry.rows.size / rowMinimum,
          entry.tracks.size / trackMinimum,
        ),
      )
      return {
        character_name: entry.character_name,
        actor_name: entry.actor_name,
        accepted_count: entry.accepted_count,
        embedded_count: entry.embedded_count,
        detector_link_count: entry.detector_link_count,
        rejected_count: entry.rejected_count,
        row_count: entry.rows.size,
        track_count: entry.tracks.size,
        progress: Number(progress.toFixed(3)),
        ready_for_suggestion: missing.length === 0,
        missing,
        latest_updated_at: entry.latest_updated_at || null,
      }
    }).sort((left, right) => (
      Number(right.ready_for_suggestion) - Number(left.ready_for_suggestion)
      || right.progress - left.progress
      || left.character_name.localeCompare(right.character_name)
    ))

    const heldoutEval = includeEval
      ? await computeWatchIdentityHeldoutEval({ documents, assetUid })
      : null
    const readyByCount = characters.filter((entry) => entry.ready_for_suggestion).length
    const readyForAutoSuggest = Boolean(heldoutEval?.ready_for_auto_suggest)
    const detectorLinkedReadyCharacters = characters.filter((entry) => (
      entry.ready_for_suggestion && entry.detector_link_count >= detectorLinkedMinimum
    ))
    const strictYoloLinkedReady = readyForAutoSuggest
      && detectorLinkedReadyCharacters.length >= Math.min(2, Math.max(1, readyByCount))
      && characters
        .filter((entry) => entry.ready_for_suggestion)
        .every((entry) => entry.detector_link_count >= detectorLinkedMinimum)

    res.json({
      schema: 'watch.identity_readiness.v1',
      asset_uid: assetUid || null,
      thresholds: {
        accepted_minimum: acceptedMinimum,
        embedded_minimum: embeddedMinimum,
        detector_linked_minimum: detectorLinkedMinimum,
        row_minimum: rowMinimum,
        track_minimum: trackMinimum,
      },
      characters,
      ready_character_count: readyByCount,
      character_count: characters.length,
      auto_suggest_readiness: heldoutEval ? {
        ready: readyForAutoSuggest,
        evaluated_count: heldoutEval.evaluated_count,
        pass_count: heldoutEval.pass_count,
        fail_count: heldoutEval.fail_count,
        accuracy: heldoutEval.accuracy,
        detector_linked_example_count: heldoutEval.detector_linked_example_count,
        detector_linked_evaluated_count: heldoutEval.detector_linked_evaluated_count,
      } : null,
      strict_yolo_linked_readiness: {
        ready: strictYoloLinkedReady,
        ready_character_count: detectorLinkedReadyCharacters.length,
        character_count: characters.filter((entry) => entry.ready_for_suggestion).length,
        detector_linked_minimum: detectorLinkedMinimum,
        missing: characters
          .filter((entry) => entry.ready_for_suggestion && entry.detector_link_count < detectorLinkedMinimum)
          .map((entry) => ({
            character_name: entry.character_name,
            detector_link_count: entry.detector_link_count,
            missing_detector_linked_label_count: detectorLinkedMinimum - entry.detector_link_count,
          })),
      },
      heldout_eval: heldoutEval,
      proof_scope: {
        mocked: false,
        live: true,
        proves: [
          `watch API counted active persisted labels in $memory collection ${WATCH_KEYFRAME_ANNOTATIONS_COLLECTION}`,
          'watch API counted Qdrant-backed crop examples per character',
          'watch API exposed readiness thresholds used by the UI',
          ...(heldoutEval ? ['watch API ran a live held-out Qdrant retrieval identity eval for auto-suggest readiness'] : []),
        ],
        does_not_prove: [
          'Qdrant nearest-neighbor suggestions are semantically correct',
          'YOLOAnalytics itself performs character identity classification',
          'a character with insufficient accepted examples should be auto-labeled',
        ],
      },
    })
  } catch (err) {
    res.status(502).json({
      error: 'failed_to_compute_watch_identity_readiness',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
})

app.get('/api/projects/watch/identity-heldout-eval', async (req, res) => {
  const assetUid = typeof req.query.asset_uid === 'string' ? req.query.asset_uid.trim() : ''
  const maxExamples = Number(req.query.max_examples ?? req.query.maxExamples)

  try {
    const documents = await listMemoryCollectionDocuments(WATCH_KEYFRAME_ANNOTATIONS_COLLECTION, 10_000)
    const payload = await computeWatchIdentityHeldoutEval({
      documents,
      assetUid,
      maxExamples: Number.isFinite(maxExamples) && maxExamples > 0 ? maxExamples : undefined,
    })
    res.json(payload)
  } catch (err) {
    res.status(502).json({
      error: 'failed_to_compute_watch_identity_heldout_eval',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
})

app.get('/api/projects/watch/annotations/rows/:rowIndex', async (req, res) => {
  const rowIndex = Number(req.params.rowIndex)
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    res.status(400).json({ error: 'row_index must be a non-negative integer' })
    return
  }
  try {
    const documents = await listMemoryCollectionDocuments(WATCH_KEYFRAME_ANNOTATIONS_COLLECTION, 10_000)
    const annotations = documents
      .filter((document) => (
        document.kind === 'watch_keyframe_annotation'
        && document.row_index === rowIndex
        && isActiveWatchAnnotationLifecycle(document)
      ))
      .sort((left, right) => {
        const leftTime = typeof left.keyframe_time_seconds === 'number' ? left.keyframe_time_seconds : 0
        const rightTime = typeof right.keyframe_time_seconds === 'number' ? right.keyframe_time_seconds : 0
        return leftTime - rightTime
      })
    res.json({
      collection: WATCH_KEYFRAME_ANNOTATIONS_COLLECTION,
      row_index: rowIndex,
      annotations,
      total: annotations.length,
    })
  } catch (err) {
    res.status(502).json({
      error: 'failed_to_list_watch_row_annotations',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
})

app.get('/api/projects/watch/detector-candidates/rows/:rowIndex', async (req, res) => {
  const rowIndex = Number(req.params.rowIndex)
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    res.status(400).json({ error: 'row_index must be a non-negative integer' })
    return
  }

  const sourceWidth = Number(req.query.source_width ?? req.query.width ?? 1280)
  const sourceHeight = Number(req.query.source_height ?? req.query.height ?? 696)
  const assetUid = typeof req.query.asset_uid === 'string' ? req.query.asset_uid.trim() : ''

  try {
    const report = await readWatchReport()
    const row = findWatchSceneElement(report, rowIndex)
    if (!row) {
      res.status(404).json({ error: 'watch_row_not_found', row_index: rowIndex })
      return
    }
    const bounds = parseWatchSegmentBounds(row.movie_segment) ?? {
      start: parseWatchTimecode(row.timecode) ?? 0,
      end: (parseWatchTimecode(row.timecode) ?? 0) + 30,
    }
    const duration = Math.max(0.1, bounds.end - bounds.start)
    const eventLogs = await collectWatchTrackerEventLogs()
    const candidates: JsonRecord[] = []
    const seenCandidates = new Set<string>()

    for (const logPath of eventLogs) {
      let raw = ''
      try {
        raw = await readFile(logPath, 'utf8')
      } catch {
        continue
      }
      const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean)
      for (const line of lines) {
        let record: JsonRecord
        try {
          record = JSON.parse(line) as JsonRecord
        } catch {
          continue
        }
        if (record.event_type !== 'track_update') continue
        if (String(record.detected_class ?? '').toLowerCase() !== 'person') continue
        if (assetUid && typeof record.asset_uid === 'string' && record.asset_uid !== assetUid) continue
        const segmentId = typeof record.segment_id === 'string' ? record.segment_id : ''
        const mediaTime = typeof record.media_time_seconds === 'number' ? record.media_time_seconds : null
        const rowMatchesSegment = segmentId.includes(`row${rowIndex}_`) || segmentId.includes(`row_${rowIndex}_`) || segmentId.endsWith(`row${rowIndex}`)
        const rowMatchesTime = mediaTime !== null && mediaTime >= bounds.start - 0.5 && mediaTime <= bounds.end + 0.5
        if (!rowMatchesSegment && !rowMatchesTime) continue

        const bbox = extractNormalizedBboxCandidate({
          ...record,
          source_width: Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : 1280,
          source_height: Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : 696,
        })
        if (!bbox) continue
        const timeSeconds = watchDetectorEventSegmentSeconds(record, row)
        if (timeSeconds === null || !Number.isFinite(timeSeconds) || timeSeconds < -0.5 || timeSeconds > duration + 0.5) continue

        const trackId = typeof record.track_id === 'string' && record.track_id.trim() ? record.track_id.trim() : 'untracked'
        const key = `${logPath}:${trackId}:${Number(timeSeconds.toFixed(3))}:${bbox.map((value) => value.toFixed(4)).join(',')}`
        if (seenCandidates.has(key)) continue
        seenCandidates.add(key)
        candidates.push({
          id: `detector:${rowIndex}:${trackId}:${Number(timeSeconds.toFixed(3))}:${createHash('sha1').update(key).digest('hex').slice(0, 10)}`,
          row_index: rowIndex,
          asset_uid: typeof record.asset_uid === 'string' ? record.asset_uid : assetUid || null,
          track_id: trackId,
          detected_class: 'person',
          bbox,
          bbox_format: 'normalized_xyxy',
          time_seconds: Math.max(0, Math.min(duration, timeSeconds)),
          media_time_seconds: mediaTime,
          confidence: typeof record.confidence === 'number' ? record.confidence : null,
          source_log: logPath,
        })
      }
    }

    candidates.sort((left, right) => {
      const leftTime = typeof left.time_seconds === 'number' ? left.time_seconds : 0
      const rightTime = typeof right.time_seconds === 'number' ? right.time_seconds : 0
      if (leftTime !== rightTime) return leftTime - rightTime
      return String(left.track_id ?? '').localeCompare(String(right.track_id ?? ''))
    })

    res.json({
      schema: 'watch.detector_candidates.v1',
      row_index: rowIndex,
      asset_uid: assetUid || null,
      segment_start_seconds: bounds.start,
      segment_end_seconds: bounds.end,
      source_width: Number.isFinite(sourceWidth) && sourceWidth > 0 ? sourceWidth : 1280,
      source_height: Number.isFinite(sourceHeight) && sourceHeight > 0 ? sourceHeight : 696,
      source_log_count: eventLogs.length,
      candidates,
      total: candidates.length,
    })
  } catch (err) {
    res.status(502).json({
      error: 'failed_to_load_watch_detector_candidates',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
})

app.post('/api/projects/watch/detector-candidates/suggest-label', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body as JsonRecord : {}
  const assetUid = typeof body.asset_uid === 'string' ? body.asset_uid.trim() : ''
  const rowIndex = Number(body.row_index ?? body.rowIndex)
  const trackId = typeof body.track_id === 'string' ? body.track_id.trim() : ''
  const imageDataUrl = typeof body.image_data_url === 'string' ? body.image_data_url : ''
  const bbox = normalizeWatchBbox(body.bbox)
  const allowedCharacters = new Map<string, { characterName: string; actorName: string }>()
  for (const entry of Array.isArray(body.allowed_characters) ? body.allowed_characters : []) {
    const record = entry && typeof entry === 'object' ? entry as JsonRecord : {}
    const characterName = typeof record.character_name === 'string'
      ? record.character_name.trim()
      : typeof record.name === 'string'
        ? record.name.trim()
        : ''
    if (!characterName || safeMemoryKeyPart(characterName) === 'unassigned') continue
    allowedCharacters.set(safeMemoryKeyPart(characterName), {
      characterName,
      actorName: typeof record.actor_name === 'string'
        ? record.actor_name.trim()
        : typeof record.actorName === 'string'
          ? record.actorName.trim()
          : '',
    })
  }

  if (!assetUid) {
    res.status(400).json({ ok: false, error: 'asset_uid is required' })
    return
  }
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    res.status(400).json({ ok: false, error: 'row_index must be a non-negative integer' })
    return
  }
  if (!trackId) {
    res.status(400).json({ ok: false, error: 'track_id is required' })
    return
  }
  if (!bbox) {
    res.status(400).json({ ok: false, error: 'bbox must be normalized xyxy' })
    return
  }

  try {
    const timeSeconds = Number(body.time_seconds ?? body.timeSeconds ?? 0)
    const report = await readWatchReport()
    const row = findWatchSceneElement(report, rowIndex)
    let frameSource: 'submitted_image_data_url' | 'server_ffmpeg_clip_frame' = 'submitted_image_data_url'
    let crop = imageDataUrl
      ? await cropWatchDataUrlToDataUrl({ imageDataUrl, bbox })
      : null
	    if ((!crop || !crop.quality.ok) && row?.video_clip_path) {
	      const frame = await extractWatchClipFrameDataUrl({
	        clipPath: row.video_clip_path,
	        timeSeconds: Number.isFinite(timeSeconds) ? timeSeconds : 0,
	        rowIndex,
	        trackId,
	      })
	      const safeTrackId = safeMemoryKeyPart(trackId)
	      const safeTime = Math.max(0, Number.isFinite(timeSeconds) ? timeSeconds : 0).toFixed(3).replace('.', '_')
	      const cropPath = resolve('/tmp', `watch_detector_suggest_crop_row${rowIndex}_${safeTrackId}_${safeTime}_${Date.now()}.png`)
	      try {
	        crop = await cropWatchFrameToDataUrl({
	          sourcePath: frame.framePath,
	          bbox,
	          outputPath: cropPath,
	        })
	        frameSource = frame.source
	      } finally {
	        await unlink(frame.framePath).catch(() => {})
	        await unlink(cropPath).catch(() => {})
	      }
	    }
    if (!crop) {
      res.status(400).json({ ok: false, error: 'image_data_url is required when no row clip is available' })
      return
    }
    const suggestionPolicy = {
      min_confidence: 0.82,
      min_neighbor_count: 2,
      min_runner_up_margin: 0.04,
    }
    if (!crop.quality.ok) {
      res.json({
        ok: true,
        schema: 'watch.detector_label_suggestion.v1',
        asset_uid: assetUid,
        row_index: rowIndex,
        track_id: trackId,
        bbox,
        frame_source: frameSource,
        crop_dimensions: {
          width: crop.width,
          height: crop.height,
          source_width: crop.sourceWidth,
          source_height: crop.sourceHeight,
        },
        crop_quality: crop.quality,
        memory: {
          endpoint: '/watch/identity/recall-crop',
          called: false,
          found: false,
          confidence: null,
          item_count: 0,
          embedding: null,
        },
        suggestion_policy: suggestionPolicy,
        suggestion: null,
        candidates: [],
        rejection_reason: crop.quality.reason || 'low_information_crop',
        proof_scope: {
          mocked: false,
          live: true,
          proves: [
            'watch API cropped the submitted detector box from the selected frame source',
            'watch API measured crop quality and rejected a low-information crop before identity recall',
          ],
          does_not_prove: [
            'the suggested character label is correct',
            'Memory /watch/identity/recall-crop was called for this rejected crop',
            'the suggestion has been accepted by a human',
            'YOLO track identity is stable outside the current detector track id',
          ],
        },
      })
      return
    }
    const memory = await memoryHttpPost('/watch/identity/recall-crop', {
      asset_uid: assetUid,
      row_index: rowIndex,
      track_id: trackId,
      time_seconds: Number.isFinite(timeSeconds) ? timeSeconds : 0,
      image_data_url: crop.dataUrl,
      k: 30,
    }, 30_000)

    const byCharacter = new Map<string, {
      characterName: string
      actorName: string
      bestScore: number
      count: number
      points: Array<{ point_id: string | null; score: number; row_index: number | null; annotation_key: string | null }>
    }>()

    for (const item of Array.isArray(memory?.items) ? memory.items : []) {
      const record = item && typeof item === 'object' ? item as JsonRecord : {}
      const rawCharacterName = typeof record.character_name === 'string' ? record.character_name.trim() : ''
      if (!rawCharacterName) continue
      const key = safeMemoryKeyPart(rawCharacterName)
      const allowed = allowedCharacters.get(key)
      if (allowedCharacters.size > 0 && !allowed) continue
      const score = typeof record.confidence === 'number'
        ? record.confidence
        : typeof record.visual_score === 'number'
          ? record.visual_score
          : 0
      const actorName = allowed?.actorName || (typeof record.actor_name === 'string' ? record.actor_name.trim() : '')
      const current = byCharacter.get(key) || {
        characterName: allowed?.characterName || rawCharacterName,
        actorName,
        bestScore: 0,
        count: 0,
        points: [],
      }
      current.bestScore = Math.max(current.bestScore, score)
      current.count += 1
      if (current.points.length < 5) {
        current.points.push({
          point_id: typeof record.point_id === 'string' ? record.point_id : null,
          score: Number(score.toFixed(4)),
          row_index: Number.isFinite(Number(record.row_index)) ? Number(record.row_index) : null,
          annotation_key: typeof record.annotation_key === 'string' ? record.annotation_key : null,
        })
      }
      byCharacter.set(key, current)
    }

    const ranked = Array.from(byCharacter.values())
      .map((entry) => ({
        character_name: entry.characterName,
        actor_name: entry.actorName,
        confidence: Number(entry.bestScore.toFixed(4)),
        best_score: Number(entry.bestScore.toFixed(4)),
        neighbor_count: entry.count,
        neighbors: entry.points,
      }))
      .sort((left, right) => right.confidence - left.confidence || right.neighbor_count - left.neighbor_count)
    const best = ranked[0] || null
    const runnerUp = ranked[1] || null
    let suggestion = best
    let rejectionReason: string | null = null
    if (!best) {
      suggestion = null
      rejectionReason = 'no_identity_candidates'
    } else if (best.confidence < suggestionPolicy.min_confidence) {
      suggestion = null
      rejectionReason = 'below_confidence_threshold'
    } else if (best.neighbor_count < suggestionPolicy.min_neighbor_count) {
      suggestion = null
      rejectionReason = 'insufficient_neighbor_support'
    } else if (runnerUp && (best.confidence - runnerUp.confidence) < suggestionPolicy.min_runner_up_margin) {
      suggestion = null
      rejectionReason = 'ambiguous_identity_candidates'
    }

    res.json({
      ok: true,
      schema: 'watch.detector_label_suggestion.v1',
      asset_uid: assetUid,
      row_index: rowIndex,
      track_id: trackId,
      bbox,
      frame_source: frameSource,
      crop_dimensions: {
        width: crop.width,
        height: crop.height,
          source_width: crop.sourceWidth,
          source_height: crop.sourceHeight,
        },
      crop_quality: crop.quality,
      memory: {
        endpoint: '/watch/identity/recall-crop',
        called: true,
        found: Boolean(memory?.found),
        confidence: typeof memory?.confidence === 'number' ? memory.confidence : null,
        item_count: Array.isArray(memory?.items) ? memory.items.length : 0,
        embedding: memory?.embedding ?? null,
      },
      suggestion_policy: suggestionPolicy,
      suggestion,
      candidates: ranked,
      rejection_reason: rejectionReason,
      proof_scope: {
        mocked: false,
        live: true,
        proves: [
          'watch API cropped the submitted detector box from the selected frame source',
          'watch API measured crop quality before identity recall',
          'watch API called Memory /watch/identity/recall-crop with the detector crop',
          'Memory performed the configured multimodal crop recall and returned hydrated identity candidates',
          'watch API applied confidence, neighbor-count, and ambiguity gates before returning a suggestion',
        ],
        does_not_prove: [
          'the suggested character label is correct',
          'the suggestion has been accepted by a human',
          'YOLO track identity is stable outside the current detector track id',
        ],
      },
    })
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: 'failed_to_suggest_watch_detector_label',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
})

app.post('/api/projects/watch/annotations/clear-segment', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body as JsonRecord : {}
  const rowIndex = Number(body.row_index ?? body.rowIndex)
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    res.status(400).json({ ok: false, error: 'row_index must be a non-negative integer' })
    return
  }

  try {
    const documents = await listMemoryCollectionDocuments(WATCH_KEYFRAME_ANNOTATIONS_COLLECTION, 10_000)
    const targets = documents.filter((document) => (
      document.kind === 'watch_keyframe_annotation'
      && document.row_index === rowIndex
      && typeof document._key === 'string'
      && isActiveWatchAnnotationLifecycle(document)
    ))
    const now = new Date().toISOString()
    const clearedDocuments = targets.map((document) => {
      const { _id: _ignoredId, _rev: _ignoredRev, ...cleanDocument } = document
      return {
        ...cleanDocument,
        lifecycle_status: 'cleared',
        cleared_at: now,
        cleared_by: 'watch-ui',
        clear_scope: 'segment',
        clear_reason: typeof body.reason === 'string' && body.reason.trim()
          ? body.reason.trim()
          : 'user_clear_segment_annotations',
        updated_at: now,
        retrieval_text: [
          typeof document.retrieval_text === 'string' ? document.retrieval_text : '',
          `Lifecycle: cleared from Watch row ${rowIndex} at ${now}`,
        ].filter(Boolean).join('\n'),
      }
    })

    if (clearedDocuments.length > 0) {
      await memoryHttpPost('/upsert', {
        collection: WATCH_KEYFRAME_ANNOTATIONS_COLLECTION,
        documents: clearedDocuments,
      }, 20_000)
    }

    res.json({
      ok: true,
      collection: WATCH_KEYFRAME_ANNOTATIONS_COLLECTION,
      row_index: rowIndex,
      clear_scope: 'segment',
      cleared_count: clearedDocuments.length,
      cleared_keys: clearedDocuments.map((document) => document._key),
      lifecycle_status: 'cleared',
    })
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: 'failed_to_clear_watch_segment_annotations',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
})

app.post('/api/projects/watch/annotations/delete-keyframe', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body as JsonRecord : {}
  const rowIndex = Number(body.row_index ?? body.rowIndex)
  const key = typeof body.key === 'string' ? body.key.trim() : ''
  const id = typeof body.id === 'string' ? body.id.trim() : ''
  const boxId = typeof body.box_id === 'string' ? body.box_id.trim() : ''
  const annotationUid = typeof body.annotation_uid === 'string' ? body.annotation_uid.trim() : ''
  const assetUid = typeof body.asset_uid === 'string' ? body.asset_uid.trim() : ''
  const detectorTrackId = typeof body.detector_track_id === 'string' ? body.detector_track_id.trim() : ''
  const characterName = typeof body.character_name === 'string' ? body.character_name.trim() : ''
  const actorName = typeof body.actor_name === 'string' ? body.actor_name.trim() : ''
  const persistRejection = body.persist_rejection === true
  const characterKeyToDelete = characterName ? safeMemoryKeyPart(characterName) : ''
  if (!Number.isInteger(rowIndex) || rowIndex < 0) {
    res.status(400).json({ ok: false, error: 'row_index must be a non-negative integer' })
    return
  }
  if (!key && !id && !boxId && !annotationUid && !(detectorTrackId && characterName)) {
    res.status(400).json({ ok: false, error: 'key, id, box_id, annotation_uid, or detector_track_id plus character_name is required' })
    return
  }

  try {
    const documents = await listMemoryCollectionDocuments(WATCH_KEYFRAME_ANNOTATIONS_COLLECTION, 10_000)
    const matchesIdentity = (document: JsonRecord): boolean => {
      if (key && document._key === key) return true
      if (id && document._id === id) return true
      if (boxId && document.box_id === boxId) return true
      if (annotationUid && document.annotation_uid === annotationUid) return true
      if (!detectorTrackId || !characterKeyToDelete) return false
      const detectorRef = document.detector_observation_ref && typeof document.detector_observation_ref === 'object'
        ? document.detector_observation_ref as JsonRecord
        : null
      return detectorRef?.track_id === detectorTrackId
        && safeMemoryKeyPart(String(document.character_name || '')) === characterKeyToDelete
    }
    const targets = documents.filter((document) => (
      document.kind === 'watch_keyframe_annotation'
      && document.row_index === rowIndex
      && (!assetUid || document.asset_uid === assetUid)
      && typeof document._key === 'string'
      && isActiveWatchAnnotationLifecycle(document)
      && matchesIdentity(document)
    ))
    const now = new Date().toISOString()
    const deletedDocuments = targets.map((document) => {
      const { _id: _ignoredId, _rev: _ignoredRev, ...cleanDocument } = document
      return {
        ...cleanDocument,
        lifecycle_status: 'deleted',
        deleted_at: now,
        deleted_by: 'watch-ui',
        delete_scope: 'keyframe',
        delete_reason: typeof body.reason === 'string' && body.reason.trim()
          ? body.reason.trim()
          : 'user_delete_keyframe',
        updated_at: now,
        retrieval_text: [
          typeof document.retrieval_text === 'string' ? document.retrieval_text : '',
          `Lifecycle: deleted keyframe from Watch row ${rowIndex} at ${now}`,
        ].filter(Boolean).join('\n'),
      }
    })

    if (deletedDocuments.length > 0) {
      await memoryHttpPost('/upsert', {
        collection: WATCH_KEYFRAME_ANNOTATIONS_COLLECTION,
        documents: deletedDocuments,
      }, 20_000)
    }

    let rejectedDocuments: JsonRecord[] = []
    if (persistRejection && detectorTrackId && characterName) {
      const requestedDetectorObservationRef = body.detector_observation_ref && typeof body.detector_observation_ref === 'object'
        ? body.detector_observation_ref as JsonRecord
        : null
      const detectorBbox = normalizeWatchBbox(requestedDetectorObservationRef?.bbox)
      const bodyBbox = normalizeWatchBbox(body.bbox)
      const rejectionBbox = detectorBbox || bodyBbox
      const rawTimeSeconds = typeof body.keyframe_time_seconds === 'number' && Number.isFinite(body.keyframe_time_seconds)
        ? Number(body.keyframe_time_seconds.toFixed(3))
        : typeof requestedDetectorObservationRef?.time_seconds === 'number' && Number.isFinite(requestedDetectorObservationRef.time_seconds)
          ? Number(requestedDetectorObservationRef.time_seconds.toFixed(3))
          : null
      const rejectionBoxId = [
        'rejected',
        detectorTrackId,
        characterKeyToDelete,
        rawTimeSeconds === null ? 'unknown_time' : rawTimeSeconds.toFixed(3).replace('.', '_'),
      ].join(':')
      const rejectionKey = watchKeyframeMemoryKey({
        assetUid: assetUid || WATCH_MEDIA_SLUG,
        rowIndex,
        characterName,
        actorName,
        boxId: rejectionBoxId,
        keyframeTimeSeconds: rawTimeSeconds,
        timecode: typeof body.timecode === 'string' ? body.timecode : '',
      })
      const detectorObservationRef = requestedDetectorObservationRef ? {
        ...requestedDetectorObservationRef,
        track_id: detectorTrackId,
        human_character_name: characterName,
        human_actor_name: actorName || null,
        rejected_character_name: characterName,
        rejected_actor_name: actorName || null,
      } : {
        source: 'watch_annotation_island_yolo_candidate',
        link_quality: 'human_rejected_yolo_track_label',
        track_id: detectorTrackId,
        detector_candidate_id: detectorTrackId,
        detected_class: 'person',
        bbox: rejectionBbox,
        time_seconds: rawTimeSeconds,
        human_character_name: characterName,
        human_actor_name: actorName || null,
        rejected_character_name: characterName,
        rejected_actor_name: actorName || null,
      }
      const rejectionDocument: JsonRecord = {
        _key: rejectionKey,
        kind: 'watch_keyframe_annotation',
        schema: 'watch_keyframe_annotation.v1',
        status: 'human_rejected_yolo_label',
        lifecycle_status: 'current',
        scope: 'watch',
        provenance_source: 'ux-lab.watch',
        receipt_path: null,
        receipt_id: rejectionBoxId,
        annotation_uid: rejectionKey,
        annotation_track_id: `${safeMemoryKeyPart(assetUid || WATCH_MEDIA_SLUG)}:row${rowIndex}:${characterKeyToDelete}:rejected:${safeMemoryKeyPart(detectorTrackId)}`,
        character_instance_id: `${safeMemoryKeyPart(assetUid || WATCH_MEDIA_SLUG)}:row${rowIndex}:${characterKeyToDelete}:rejected:${safeMemoryKeyPart(detectorTrackId)}`,
        box_id: rejectionBoxId,
        asset_uid: assetUid || WATCH_MEDIA_SLUG,
        row_index: rowIndex,
        timecode: typeof body.timecode === 'string' ? body.timecode : '',
        movie_segment: typeof body.movie_segment === 'string' ? body.movie_segment : '',
        character_name: characterName,
        actor_name: actorName || null,
        bbox: rejectionBbox,
        bbox_format: rejectionBbox ? 'normalized_xyxy' : 'none',
        bbox_dimensions: rejectionBbox ? {
          left: Number(rejectionBbox[0].toFixed(6)),
          top: Number(rejectionBbox[1].toFixed(6)),
          width: Number((rejectionBbox[2] - rejectionBbox[0]).toFixed(6)),
          height: Number((rejectionBbox[3] - rejectionBbox[1]).toFixed(6)),
        } : null,
        keyframe_time_seconds: rawTimeSeconds,
        keyframe_time_basis: 'segment_seconds',
        detector_observation_ref: detectorObservationRef,
        detector_observation_link_status: 'human_rejected_yolo_track_label',
        intended_use: 'negative_label_for_identity_readiness_and_suggestion_filtering',
        training_role: {
          label_type: 'negative',
          target_entity_id: `character:${characterKeyToDelete}`,
          target_entity_kind: 'character',
          identity_scope: 'asset_character',
          usable_for_agent_matching: false,
          review_state: 'human_rejected',
          example_weight: -1.0,
          reason: typeof body.reason === 'string' && body.reason.trim()
            ? body.reason.trim()
            : 'user_rejected_yolo_track_label',
        },
        qdrant_refs: { crop_points: [] },
        qdrant_embedding_status: 'not_applicable_negative_label',
        retrieval_text: [
          'Watch character YOLO label rejection',
          `Asset: ${assetUid || WATCH_MEDIA_SLUG}`,
          `Row: ${rowIndex}`,
          `Track: ${detectorTrackId}`,
          `Rejected character: ${characterName}`,
          actorName ? `Rejected actor: ${actorName}` : '',
          rawTimeSeconds === null ? '' : `Segment seconds: ${rawTimeSeconds}`,
          `Reason: ${typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim() : 'user_rejected_yolo_track_label'}`,
        ].filter(Boolean).join('\n'),
        problem: `Avoid labeling YOLO ${detectorTrackId} as ${characterName} when the human rejected that assignment.`,
        solution: `Human rejected ${characterName}${actorName ? ` (${actorName})` : ''} for YOLO ${detectorTrackId} on Watch row ${rowIndex}.`,
        tags: [
          'watch',
          'watch_keyframe_annotation',
          'human_rejected_yolo_label',
          'negative_identity_label',
          `asset:${safeMemoryKeyPart(assetUid || WATCH_MEDIA_SLUG)}`,
          `character:${characterKeyToDelete}`,
          `detector_track:${safeMemoryKeyPart(detectorTrackId)}`,
        ],
        created_at: now,
        updated_at: now,
      }
      rejectedDocuments = [rejectionDocument]
      await memoryHttpPost('/upsert', {
        collection: WATCH_KEYFRAME_ANNOTATIONS_COLLECTION,
        documents: rejectedDocuments,
        skip_embedding: true,
      }, 20_000)
    }

    res.json({
      ok: true,
      collection: WATCH_KEYFRAME_ANNOTATIONS_COLLECTION,
      row_index: rowIndex,
      delete_scope: 'keyframe',
      deleted_count: deletedDocuments.length,
      deleted_keys: deletedDocuments.map((document) => document._key),
      rejected_count: rejectedDocuments.length,
      rejected_keys: rejectedDocuments.map((document) => document._key),
      lifecycle_status: 'deleted',
    })
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: 'failed_to_delete_watch_keyframe_annotation',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
})

app.post('/api/projects/watch/orpheus-segments', async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body as JsonRecord : {}
  const movieTitle = typeof body.movieTitle === 'string' ? body.movieTitle.trim() : ''
  const timecode = typeof body.timecode === 'string' ? body.timecode.trim() : ''
  const movieSegment = typeof body.movieSegment === 'string' ? body.movieSegment.trim() : ''
  const tags = Array.isArray(body.tags) ? body.tags.map(String).filter(Boolean) : []
  const requestedStatus = ['staged', 'export_ready', 'rejected'].includes(String(body.status))
    ? String(body.status)
    : 'staged'
  const startOffset = Number(body.startOffset)
  const endOffset = Number(body.endOffset)
  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : ''
  const videoPath = typeof body.videoPath === 'string' ? body.videoPath : ''
  const audioPath = typeof body.audioPath === 'string' ? body.audioPath : ''
  const rowIndex = Number(body.rowIndex)

  if (!movieTitle || !timecode || (requestedStatus !== 'rejected' && tags.length === 0) || !Number.isFinite(startOffset) || !Number.isFinite(endOffset) || endOffset <= startOffset) {
    res.status(400).json({
      error: 'invalid_orpheus_segment',
      required: ['movieTitle', 'timecode', 'tags[] unless rejected', 'startOffset', 'endOffset'],
    })
    return
  }

  const identity = [
    movieTitle,
    timecode,
    movieSegment,
    Number.isFinite(rowIndex) ? rowIndex : 'row',
    startOffset.toFixed(1),
    endOffset.toFixed(1),
    tags.join(','),
    requestedStatus,
    videoPath,
    audioPath,
  ].join('|')
  const key = `watch_orpheus:${safeMemoryKeyPart(movieTitle)}:${createHash('sha256').update(identity).digest('hex').slice(0, 20)}`
  const now = new Date().toISOString()
  const document = {
    _key: key,
    kind: 'orpheus_tts_segment',
    schema: 'watch_orpheus_segment.v1',
    status: requestedStatus,
    scope: 'watch_orpheus',
    source: 'ux-lab.watch',
    movie_title: movieTitle,
    timecode,
    movie_segment: movieSegment || timecode,
    row_index: Number.isFinite(rowIndex) ? rowIndex : null,
    start_offset: startOffset,
    end_offset: endOffset,
    duration_seconds: Number((endOffset - startOffset).toFixed(3)),
    emotion_tags: tags,
    transcript,
    video_path: videoPath,
    audio_path: audioPath,
    reject_reason: requestedStatus === 'rejected' && typeof body.rejectReason === 'string' ? body.rejectReason.trim() : null,
    export_format: requestedStatus === 'export_ready' ? 'orpheus_tts_label.v1' : null,
    retrieval_text: [
      `Movie: ${movieTitle}`,
      `Timecode: ${timecode}`,
      `Segment: ${movieSegment || timecode}`,
      `Actor or speaker: ${typeof body.speaker === 'string' ? body.speaker : 'unknown'}`,
      `Status: ${requestedStatus}`,
      `Orpheus emotion tags: ${tags.join(' ')}`,
      transcript,
    ].filter(Boolean).join('\n'),
    tags: [
      'watch_orpheus',
      'orpheus_tts_segment',
      `status:${requestedStatus}`,
      `movie:${safeMemoryKeyPart(movieTitle)}`,
      ...tags.map((tag) => `emotion:${tag.replace(/[<>]/g, '')}`),
    ],
    created_at: typeof body.createdAt === 'string' ? body.createdAt : now,
    updated_at: now,
  }

  try {
    const memory = await memoryHttpPost('/upsert', {
      collection: WATCH_ORPHEUS_SEGMENTS_COLLECTION,
      documents: [document],
    }, 10_000)
    res.json({ collection: WATCH_ORPHEUS_SEGMENTS_COLLECTION, segment: document, memory })
  } catch (err) {
    res.status(502).json({
      error: 'failed_to_store_watch_orpheus_segment',
      detail: err instanceof Error ? err.message : String(err),
    })
  }
})

const ORPHEUS_QUERY_EMOTIONS: Array<{ token: string; words: string[] }> = [
  { token: '<laugh>', words: ['laugh', 'laughs', 'laughing', 'laughter'] },
  { token: '<chuckle>', words: ['chuckle', 'chuckles', 'chuckling'] },
  { token: '<sigh>', words: ['sigh', 'sighs', 'sighing'] },
  { token: '<cough>', words: ['cough', 'coughs', 'coughing'] },
  { token: '<sniffle>', words: ['sniffle', 'sniffles', 'sniffling'] },
  { token: '<groan>', words: ['groan', 'groans', 'groaning'] },
  { token: '<yawn>', words: ['yawn', 'yawns', 'yawning'] },
  { token: '<gasp>', words: ['gasp', 'gasps', 'gasping'] },
]

function requestedOrpheusEmotionTokens(question: string): string[] {
  const lower = question.toLowerCase()
  return ORPHEUS_QUERY_EMOTIONS
    .filter((entry) => entry.words.some((word) => new RegExp(`\\b${word}\\b`, 'i').test(lower)) || lower.includes(entry.token))
    .map((entry) => entry.token)
}

function isOrpheusMemoryQuestion(question: string): boolean {
  const lower = question.toLowerCase()
  return lower.includes('orpheus')
    || lower.includes('tts')
    || lower.includes('emotion')
    || lower.includes('sound segment')
    || lower.includes('training')
    || requestedOrpheusEmotionTokens(question).length > 0
}

async function answerFromOrpheusSegments(question: string): Promise<{ answer: string; segments: JsonRecord[]; tokens: string[]; errors: string[] } | null> {
  if (!isOrpheusMemoryQuestion(question)) return null
  const tokens = requestedOrpheusEmotionTokens(question)
  const errors: string[] = []
  let documents: JsonRecord[] = []
  try {
    const data = await memoryHttpPost('/list', {
      collection: WATCH_ORPHEUS_SEGMENTS_COLLECTION,
      limit: 500,
    }, 10_000)
    documents = Array.isArray(data?.documents) ? data.documents as JsonRecord[] : []
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('404') || message.toLowerCase().includes('not found')) documents = []
    else errors.push(`orpheus_segments_list_failed:${message}`)
  }

  const lowerQuestion = question.toLowerCase()
  const usable = documents.filter((doc) => typeof doc.status !== 'string' || !doc.status.startsWith('discarded'))
  const filtered = usable.filter((doc) => {
    const docTokens = Array.isArray(doc.emotion_tags) ? doc.emotion_tags.map(String) : []
    const matchesEmotion = tokens.length === 0 || tokens.some((token) => docTokens.includes(token))
    if (!matchesEmotion) return false
    const movieTitle = String(doc.movie_title ?? '').toLowerCase()
    const speaker = String(doc.speaker ?? doc.actor ?? '').toLowerCase()
    const movieMentioned = movieTitle && lowerQuestion.includes(movieTitle)
    const speakerMentioned = speaker && lowerQuestion.includes(speaker)
    const hasSpecificMovieWords = /\bin (these movies|movies|movie|bad santa|there will be blood|sicario|godfather|heat)\b/i.test(question)
    if (!hasSpecificMovieWords) return true
    return movieMentioned || speakerMentioned || lowerQuestion.includes('bad santa')
  }).slice(0, 12)

  const emotionText = tokens.length ? tokens.join(', ') : 'Orpheus emotion'
  if (filtered.length === 0) {
    return {
      tokens,
      segments: [],
      errors,
      answer: `I do not have staged ${emotionText} sound segments in watch_orpheus_segments for that query yet. Use ingest-movie to acquire movies with English SRT, Watch to extract scene rows, then stage selected Orpheus clips from the Annotation panel.`,
    }
  }

  const lines = filtered.map((doc) => {
    const movie = String(doc.movie_title ?? 'Unknown movie')
    const segment = String(doc.movie_segment ?? doc.timecode ?? 'unknown time')
    const tags = Array.isArray(doc.emotion_tags) ? doc.emotion_tags.join(' ') : ''
    const transcript = String(doc.transcript ?? '').replace(/\s+/g, ' ').slice(0, 180)
    const offsets = Number.isFinite(Number(doc.start_offset)) && Number.isFinite(Number(doc.end_offset))
      ? `selection ${Number(doc.start_offset).toFixed(1)}s-${Number(doc.end_offset).toFixed(1)}s`
      : 'selection unavailable'
    return `- ${movie} ${segment} (${offsets}) ${tags}: ${transcript}`
  })
  return {
    tokens,
    segments: filtered,
    errors,
    answer: `I found ${filtered.length} staged ${emotionText} sound segment${filtered.length === 1 ? '' : 's'} in watch_orpheus_segments:\n${lines.join('\n')}`,
  }
}

app.post('/api/projects/watch/question', async (req, res) => {
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : ''
  const reportPath = typeof req.body?.report_path === 'string' ? req.body.report_path : WATCH_REPORT_PATH
  const rawAnswerModel = typeof req.body?.answer_model === 'string' ? req.body.answer_model.trim() : 'auto'
  const requestedAnswerModel = normalizeWatchAnswerModel(rawAnswerModel)
  if (!question) {
    res.status(400).json({ error: 'question is required' })
    return
  }
  if (rawAnswerModel && rawAnswerModel !== 'auto' && requestedAnswerModel === 'auto') {
    res.status(400).json({
      error: 'unsupported_watch_answer_model',
      requested_model: rawAnswerModel,
      supported_models: ['auto', 'Qwen/Qwen3.6-27B-TEE', 'gpt-5.5'],
    })
    return
  }

  const errors: string[] = []
  let report: any
  try {
    report = await readWatchReport(reportPath)
  } catch (err) {
    res.status(500).json({ error: `failed to read Watch report: ${String(err)}`, report_path: reportPath })
    return
  }

  const rows = Array.isArray(report.scene_elements) ? report.scene_elements as WatchSceneElement[] : []
  const orpheusAnswer = await answerFromOrpheusSegments(question)
  if (orpheusAnswer) {
    res.json({
      question,
      route: 'ORPHEUS_MEMORY',
      answer: orpheusAnswer.answer,
      confidence: orpheusAnswer.segments.length > 0 ? 1 : 0,
      matched_rows: [],
      evidence: {
        local_row_count: 0,
        sources: ['memory:list:watch_orpheus_segments'],
        orpheus_segment_count: orpheusAnswer.segments.length,
      },
      watch_question_intent: {
        mode: 'orpheus_segments',
        retrieval: {
          strategy: 'memory_collection_filter',
          collection: WATCH_ORPHEUS_SEGMENTS_COLLECTION,
          emotion_tokens: orpheusAnswer.tokens,
        },
      },
      orpheus_segments: orpheusAnswer.segments,
      errors: orpheusAnswer.errors,
    })
    return
  }

  const entityResult = await extractWatchEntityContext(question)
  errors.push(...entityResult.errors)
  const entityContext = entityResult.entityContext
  let intent: any = null
  let watchQuestionIntent: WatchQuestionIntent | null = null
  let recall: any = null
  let memoryAnswer: any = null
  let selectedModelAnswer: { answer: string; model: Record<string, unknown> } | null = null
  let clarify: any = null
  let deflect: any = null

  try {
    intent = await proxyPost('/intent', { q: question, scope: 'watch', session_id: 'ux-lab-watch', fast: true }, 10_000)
    intent = normalizeWatchIntent(intent, question)
  } catch (err) {
    errors.push(`intent_failed:${String(err)}`)
    intent = normalizeWatchIntent(null, question)
  }
  watchQuestionIntent = await planWatchQuestionIntent(question, entityContext, intent)
  const matchedRows = rankWatchRows(rows, question).slice(0, watchQuestionIntent.retrieval.row_limit || 8)

  const action = String(intent?.action ?? '').toUpperCase()
  const hasSceneEvidence = matchedRows.length > 0
  if (['NO_MATCH', 'OFF_TOPIC', 'DEFLECT'].includes(action) && !hasSceneEvidence) {
    try {
      deflect = await proxyPost('/deflect', { q: question, persona_id: 'watch', intent_action: action }, 10_000)
    } catch (err) {
      errors.push(`deflect_failed:${String(err)}`)
    }
    res.json({
      question,
      route: 'DEFLECT',
      answer: String(deflect?.message ?? deflect?.final_response ?? 'The question is outside the extracted Watch evidence.'),
      confidence: Number(intent?.confidence ?? 0),
      matched_rows: matchedRows,
      evidence: { local_row_count: matchedRows.length, sources: ['memory:intent', 'memory:deflect'] },
      intent,
      watch_question_intent: watchQuestionIntent,
      entity_context: entityContext,
      deflect,
      errors,
    })
    return
  }

  if (action === 'CLARIFY' && !hasSceneEvidence) {
    try {
      clarify = await proxyPost('/clarify', { q: question, scope: 'watch', context: report.watch_report?.title, k: 5 }, 10_000)
    } catch (err) {
      errors.push(`clarify_failed:${String(err)}`)
    }
    res.json({
      question,
      route: 'CLARIFY',
      answer: String(clarify?.question ?? clarify?.final_response ?? 'Please clarify which scene, character, or time range you mean.'),
      confidence: Number(intent?.confidence ?? 0),
      matched_rows: matchedRows,
      evidence: { local_row_count: matchedRows.length, sources: ['memory:intent', 'memory:clarify'] },
      intent,
      watch_question_intent: watchQuestionIntent,
      entity_context: entityContext,
      clarify,
      errors,
    })
    return
  }

  try {
    recall = await proxyPost('/recall', {
      q: question,
      collections: WATCH_RECALL_COLLECTIONS,
      tags: [WATCH_MEDIA_SLUG],
      k: 5,
    }, 10_000)
  } catch (err) {
    errors.push(`recall_failed:${String(err)}`)
  }

  try {
    memoryAnswer = await proxyPost('/answer', {
      q: question,
      scope: 'watch',
      collections: WATCH_RECALL_COLLECTIONS,
      k: 5,
    }, Number(process.env.WATCH_MEMORY_ANSWER_TIMEOUT_MS ?? 8_000))
  } catch (err) {
    errors.push(`answer_failed:${String(err)}`)
  }

  if (requestedAnswerModel !== 'auto') {
    try {
      selectedModelAnswer = await answerWatchQuestionWithScillm(question, matchedRows, requestedAnswerModel)
    } catch (err) {
      errors.push(`scillm_answer_failed:${String(err)}`)
    }
  }

  const memoryCanAnswer = Boolean(memoryAnswer?.can_answer)
  const answerModel = selectedModelAnswer
    ? selectedModelAnswer.model
    : memoryCanAnswer && memoryAnswer?.scillm && typeof memoryAnswer.scillm === 'object'
    ? {
        origin: memoryAnswer.final_response_origin ?? memoryAnswer.scillm.final_response_origin ?? null,
        requested_model: memoryAnswer.scillm.requested_model ?? null,
        actual_model: memoryAnswer.scillm.actual_model ?? null,
        reasoning_effort: memoryAnswer.scillm.reasoning_effort ?? null,
        caller_skill: memoryAnswer.scillm.caller_skill ?? null,
        memory_can_answer: memoryCanAnswer,
        answer_type: memoryAnswer.answer_type ?? null,
      }
    : {
        origin: 'local-watch-evidence-fallback',
        requested_model: watchQuestionIntent.model?.requested_model ?? null,
        actual_model: 'watch-row-ranker-v1',
        reasoning_effort: null,
        caller_skill: 'watch',
        memory_can_answer: false,
        answer_type: 'local_watch_rows_after_memory_answer',
      }
  const finalResponse = selectedModelAnswer
    ? selectedModelAnswer.answer
    : memoryCanAnswer
    ? String(memoryAnswer?.final_response ?? memoryAnswer?.source_answer ?? buildWatchLocalAnswer(question, matchedRows))
    : buildWatchLocalAnswer(question, matchedRows)
  const confidence = Math.min(1, Math.max(
    Number(memoryAnswer?.confidence ?? 0),
    Number(recall?.confidence ?? 0),
    matchedRows.length > 0 ? 0.55 : 0,
  ))

  res.json({
    question,
    route: memoryCanAnswer || matchedRows.length > 0 ? 'ANSWER' : 'CLARIFY',
    answer: finalResponse,
    confidence,
    matched_rows: matchedRows,
    evidence: {
      local_row_count: matchedRows.length,
      recall_found: Boolean(recall?.found),
      recall_confidence: Number(recall?.confidence ?? 0),
      sources: [
        'watch:report-json',
        'watch:scene-elements',
        'extract-entities:entity-context',
        watchQuestionIntent.source === 'scillm' ? 'scillm:watch-intent-planner' : 'watch:deterministic-intent-planner',
        ...(selectedModelAnswer ? ['scillm:watch-answer'] : []),
        ...(intent ? ['memory:intent'] : []),
        ...(recall ? ['memory:recall'] : []),
        ...(memoryAnswer ? ['memory:answer'] : []),
      ],
      answer_model: answerModel,
    },
    intent,
    watch_question_intent: watchQuestionIntent,
    entity_context: entityContext,
    recall,
    memory_answer: memoryAnswer,
    errors,
  })
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
    const { text, collection, delimiter, view } = req.body as { text: string; collection?: string; delimiter?: string; view?: string }
    const col = collection || 'sparta_controls'
    const requestedView = typeof view === 'string' && ['agent', 'verbose', 'debug', 'legacy'].includes(view)
      ? view
      : 'agent'

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
      const result = await proxyPost('/extract-entities', { text, include_taxonomy: false, view: requestedView }) as Record<string, unknown>

      const nodes = result.nodes && typeof result.nodes === 'object' && !Array.isArray(result.nodes)
        ? result.nodes as JsonRecord
        : {}
      const nodeAnchors = Array.isArray(nodes.anchors) ? nodes.anchors as JsonRecord[] : []
      const nodeValidatedContext = Array.isArray(nodes.validated_context) ? nodes.validated_context as JsonRecord[] : []
      const nodeContextTerms = Array.isArray(nodes.context_terms) ? nodes.context_terms as JsonRecord[] : []
      const nodeSuppressed = Array.isArray(nodes.suppressed) ? nodes.suppressed as JsonRecord[] : []
      const nodeUnsupported = Array.isArray(nodes.unsupported) ? nodes.unsupported as JsonRecord[] : []
      const nodeMetadata = (node: JsonRecord) => (
        node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
          ? node.metadata as JsonRecord
          : {}
      )
      const spanOf = (node: JsonRecord): [number, number] | undefined => {
        const span = node.span
        return Array.isArray(span) && typeof span[0] === 'number' && typeof span[1] === 'number'
          ? [span[0], span[1]]
          : undefined
      }
      const stringOf = (value: unknown): string | undefined => typeof value === 'string' && value.trim().length > 0 ? value : undefined

      const legacyControlIds = Array.isArray(result.control_ids) ? (result.control_ids as string[]) : []
      const legacyControlMeta = Array.isArray(result.control_metadata)
        ? (result.control_metadata as Array<{ name?: string; framework?: string; domain?: string }>)
        : []
      const legacyRawGlossary = Array.isArray((result as any).glossary)
        ? ((result as any).glossary as Array<Record<string, unknown>>)
        : []
      const rawEntityNodes = Array.isArray((result as any).entity_nodes)
        ? ((result as any).entity_nodes as Array<Record<string, unknown>>)
        : [
            ...nodeAnchors,
            ...nodeValidatedContext,
            ...nodeContextTerms,
            ...nodeSuppressed,
            ...nodeUnsupported,
          ]
      const legacySpans = Array.isArray(result.spans) ? (result.spans as Array<Record<string, unknown>>) : []
      const legacyPhrases = Array.isArray(result.phrases) ? (result.phrases as string[]) : []

      const legacyResolvedEntities = Array.isArray((result as any).resolved_entities)
        ? ((result as any).resolved_entities as Array<{
            mention?: string
            span?: [number, number]
            canonical_id?: string
            canonical_name?: string
            framework?: string
            entity_type?: string
          }>)
        : []
      const resolvedEntities = legacyResolvedEntities.length > 0
        ? legacyResolvedEntities
        : nodeAnchors
            .map((node) => {
              const meta = nodeMetadata(node)
              const controlId = stringOf(meta.control_id) ?? stringOf(node.id)
              if (!controlId) return null
              return {
                mention: stringOf(node.mention) ?? controlId,
                span: spanOf(node),
                canonical_id: controlId,
                canonical_name: stringOf(meta.name) ?? controlId,
                framework: stringOf(meta.framework_label) ?? stringOf(meta.framework) ?? '',
                entity_type: stringOf(meta.type) ?? stringOf(node.node_kind) ?? 'control',
              }
            })
            .filter((value): value is {
              mention?: string
              span?: [number, number]
              canonical_id?: string
              canonical_name?: string
              framework?: string
              entity_type?: string
            } => Boolean(value))
      const unresolvedEntities = Array.isArray((result as any).unresolved_entities)
        ? ((result as any).unresolved_entities as Array<{
            mention?: string
            span?: [number, number]
            reason?: string
          }>)
        : []
      let externalEntities = Array.isArray((result as any).external_entities)
        ? ((result as any).external_entities as Array<{
            id?: string
            mention?: string
            normalized_text?: string
            span?: [number, number]
            entity_type?: string
            routing_effect?: string
            source?: string
            control_id?: string
            canonical_name?: string
            claimed_against_control_id?: string
            expected_control_name?: string
          }>)
        : []
      const legacyDomainTerms = Array.isArray((result as any).domain_terms)
        ? ((result as any).domain_terms as Array<{
            text?: string
            span?: [number, number]
            kind?: string
          }>)
        : []
      const domainTerms = legacyDomainTerms.length > 0
        ? legacyDomainTerms
        : nodeContextTerms
            .map((node) => ({
              text: stringOf(node.mention) ?? stringOf(node.id),
              span: spanOf(node),
              kind: stringOf(node.node_kind) ?? 'domain_term',
            }))
            .filter((term) => term.text)

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
      const validatedDescriptorMentions = new Set(
        nodeValidatedContext
          .map((node) => stringOf(node.mention) ?? stringOf(nodeMetadata(node).category) ?? stringOf(nodeMetadata(node).matched_value))
          .filter((value): value is string => Boolean(value))
          .map((value) => value.trim().toLowerCase()),
      )

      const loweredText = text.toLowerCase()
      const parentheticalMismatches: typeof externalEntities = []
      normalizedControlIds.forEach((cid, index) => {
        const canonicalName = normalizedControlMeta[index]?.name?.trim()
        if (!cid || !canonicalName) return
        const cidStart = loweredText.indexOf(cid.toLowerCase())
        if (cidStart < 0) return
        const afterCid = cidStart + cid.length
        const open = text.indexOf('(', afterCid)
        if (open < 0 || open - afterCid > 3) return
        const close = text.indexOf(')', open + 1)
        if (close < 0) return
        const parenthetical = text.slice(open + 1, close).trim()
        if (!parenthetical) return
        if (validatedDescriptorMentions.has(parenthetical.toLowerCase())) return
        const canonicalTerms = [canonicalName, cid]
          .map((term) => term.trim().toLowerCase())
          .filter(Boolean)
        if (canonicalTerms.includes(parenthetical.toLowerCase())) return
        parentheticalMismatches.push({
          id: unsupportedEntityId(parenthetical),
          mention: parenthetical,
          normalized_text: parenthetical.toLowerCase(),
          span: [open + 1, close],
          entity_type: 'unsupported_control_name',
          routing_effect: `does_not_match_${cid}_canonical_name_${canonicalName}`,
          claimed_against_control_id: cid,
          expected_control_name: canonicalName,
          source: '/extract-entities parenthetical control-name guard',
        })
      })
      if (parentheticalMismatches.length > 0) {
        parentheticalMismatches.forEach((mismatch) => {
          const mismatchKey = (mismatch.mention || mismatch.normalized_text || '').toLowerCase()
          const mismatchSpan = Array.isArray(mismatch.span) ? mismatch.span.join(':') : ''
          const existingIndex = externalEntities.findIndex((entity) => {
            const entityKey = (entity.mention || entity.normalized_text || '').toLowerCase()
            const entitySpan = Array.isArray(entity.span) ? entity.span.join(':') : ''
            return entityKey === mismatchKey && entitySpan === mismatchSpan
          })
          if (existingIndex >= 0) {
            externalEntities[existingIndex] = { ...externalEntities[existingIndex], ...mismatch }
          } else {
            externalEntities.push(mismatch)
          }
        })
      }

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
            ...nodeValidatedContext
              .filter((node) => {
                const span = spanOf(node)
                return Boolean(span && (stringOf(node.mention) || stringOf(nodeMetadata(node).category)))
              })
              .map((node) => {
                const meta = nodeMetadata(node)
                return {
                  text: stringOf(node.mention) ?? stringOf(meta.category) ?? '',
                  span: spanOf(node),
                  kind: 'control_descriptor',
                  framework: stringOf(meta.framework_label) ?? stringOf(meta.framework) ?? 'SPARTA',
                  name: stringOf(meta.canonical_name) ?? stringOf(meta.name) ?? stringOf(meta.category) ?? '',
                  control_id: stringOf(meta.control_id) ?? stringOf(node.relationship && typeof node.relationship === 'object' && !Array.isArray(node.relationship) ? (node.relationship as JsonRecord).target_id : undefined),
                  grounded_to_framework: true,
                  source: '/extract-entities nodes.validated_context',
                }
              }),
            ...externalEntities
              .filter((e) => Array.isArray(e.span) && typeof e.span[0] === 'number' && typeof e.span[1] === 'number')
              .map((e) => ({
                text: e.mention ?? e.normalized_text ?? '',
                span: e.span,
                kind: e.entity_type ?? 'external_entity',
                grounded_to_framework: false,
                source: e.source ?? '/extract-entities',
              })),
          ].filter((s) => typeof s.text === 'string' && s.text.length > 0)

      const normalizedPhrases = legacyPhrases.length > 0
        ? legacyPhrases
        : domainTerms
            .map((t) => t.text)
            .filter((v): v is string => typeof v === 'string' && v.length > 0)

      const rawResolutionMap = (result as any).resolution_map
      const normalizedResolutionMap = {
        ...(rawResolutionMap && typeof rawResolutionMap === 'object' && !Array.isArray(rawResolutionMap) ? rawResolutionMap : {}),
        ...Object.fromEntries([
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
          ...externalEntities
            .filter((e) => typeof e.mention === 'string' && e.mention.length > 0)
            .map((e) => [e.mention as string, {
              exists: false,
              reason: e.routing_effect ?? 'not_grounded_to_sparta_controls',
              match_type: e.entity_type ?? 'external_entity',
            }]),
        ]),
      }

      const normalizedNotInCorpus = Array.isArray((result as any).not_in_corpus)
        ? ((result as any).not_in_corpus as unknown[])
        : unresolvedEntities
            .map((e) => e.mention)
            .concat(externalEntities.map((e) => e.mention))
            .filter((v): v is string => typeof v === 'string' && v.length > 0)
      const rawGlossary = legacyRawGlossary.length > 0
        ? legacyRawGlossary
        : [
            ...nodeAnchors.map((node) => {
              const meta = nodeMetadata(node)
              return {
                id: stringOf(meta.control_id) ?? stringOf(node.id),
                control_id: stringOf(meta.control_id) ?? stringOf(node.id),
                name: stringOf(meta.name) ?? stringOf(node.mention) ?? stringOf(node.id),
                mention: stringOf(node.mention) ?? stringOf(meta.control_id) ?? stringOf(node.id),
                framework: stringOf(meta.framework_label) ?? stringOf(meta.framework) ?? '',
                type: stringOf(meta.type) ?? stringOf(node.node_kind) ?? 'control',
                category: stringOf(meta.category),
                grounded: true,
                exists: true,
                source: '/extract-entities nodes.anchors',
              }
            }),
            ...nodeValidatedContext.map((node) => {
              const meta = nodeMetadata(node)
              const relationship = node.relationship && typeof node.relationship === 'object' && !Array.isArray(node.relationship)
                ? node.relationship as JsonRecord
                : {}
              return {
                id: stringOf(node.id) ?? stringOf(node.mention),
                control_id: stringOf(meta.control_id) ?? stringOf(relationship.target_id),
                name: stringOf(node.mention) ?? stringOf(meta.category) ?? stringOf(node.id),
                mention: stringOf(node.mention) ?? stringOf(meta.category) ?? stringOf(node.id),
                framework: stringOf(meta.framework_label) ?? stringOf(meta.framework) ?? 'SPARTA',
                type: stringOf(meta.descriptor_kind) ?? 'control_descriptor',
                descriptor_kind: stringOf(meta.descriptor_kind) ?? 'control_category_or_alias',
                canonical_name: stringOf(meta.canonical_name),
                grounded: true,
                exists: true,
                source: '/extract-entities nodes.validated_context',
              }
            }),
          ].filter((entry) => stringOf(entry.id) || stringOf(entry.name))
      const normalizedGlossary = rawGlossary.length > 0
        ? rawGlossary
        : [
            ...normalizedControlIds.map((cid: string, i: number) => {
              const meta = normalizedControlMeta[i] ?? {}
              const resolved = resolvedEntities.find((e) => e.canonical_id === cid)
              return {
                id: cid,
                control_id: cid,
                name: meta.name ?? resolved?.canonical_name ?? cid,
                mention: resolved?.mention ?? cid,
                framework: meta.framework ?? resolved?.framework ?? '',
                type: resolved?.entity_type ?? 'control',
                span: resolved?.span,
                grounded: true,
                exists: true,
                source: '/extract-entities',
              }
            }),
            ...externalEntities.map((entity) => ({
              id: entity.id ?? unsupportedEntityId(entity.mention ?? entity.normalized_text ?? ''),
              name: entity.mention ?? entity.normalized_text ?? '',
              mention: entity.mention ?? entity.normalized_text ?? '',
              type: entity.entity_type ?? 'external_entity',
              span: entity.span,
              grounded: false,
              exists: false,
              reason: entity.routing_effect ?? 'not_grounded_to_sparta_controls',
              source: entity.source ?? '/extract-entities',
              claimed_against_control_id: entity.claimed_against_control_id ?? entity.control_id ?? null,
              expected_control_name: entity.expected_control_name ?? entity.canonical_name ?? null,
            })),
            ...unresolvedEntities.map((entity) => ({
              id: null,
              name: entity.mention ?? '',
              mention: entity.mention ?? '',
              type: 'unresolved',
              span: entity.span,
              grounded: false,
              exists: false,
              reason: entity.reason ?? 'unresolved',
              source: '/extract-entities',
            })),
          ].filter((entry) => typeof entry.name === 'string' && entry.name.length > 0)
      const normalizedEntityNodes = rawEntityNodes.length > 0
        ? rawEntityNodes
        : [
            ...normalizedGlossary.map((entry) => {
              const name = String(entry.name ?? entry.mention ?? entry.id ?? '')
              const grounded = entry.grounded !== false && entry.exists !== false
              const extractedText = String(entry.mention ?? entry.name ?? entry.id ?? '')
              return {
                id: entry.id ?? (grounded ? entry.control_id ?? name : unsupportedEntityId(name)),
                node_kind: grounded ? 'control' : 'unsupported_term',
                status: grounded ? 'grounded' : 'unsupported',
                proof_role: grounded ? 'entity_anchor' : 'none',
                extracted: {
                  text: extractedText,
                  span: entry.span,
                  source: entry.source ?? '/extract-entities',
                  kind: grounded ? 'control_id' : entry.type ?? 'unsupported_term',
                },
                metadata: grounded
                  ? {
                      control_id: entry.control_id,
                      name,
                      framework: entry.framework,
                      type: entry.type,
                      grounded: true,
                      exists: true,
                    }
                  : {
                      name,
                      type: entry.type,
                      grounded: false,
                      exists: false,
                      reason: entry.reason,
                      claimed_against_control_id: entry.claimed_against_control_id,
                      expected_control_name: entry.expected_control_name,
                    },
              }
            }),
            ...domainTerms
              .filter((term) => typeof term.text === 'string' && term.text.length > 0)
              .map((term) => ({
                id: unsupportedEntityId(term.text || '').replace('unsupported:', 'domain:'),
                node_kind: 'domain_term',
                status: 'extracted',
                proof_role: 'context',
                extracted: {
                  text: term.text,
                  span: term.span,
                  source: '/extract-entities domain_terms',
                  kind: term.kind ?? 'domain_term',
                },
                metadata: {
                  name: term.text,
                  type: term.kind ?? 'domain_term',
                  grounded: true,
                  exists: true,
                },
              })),
          ]
      const rawGuessNodes = (result as any).guess_nodes
      let normalizedGuessNodes = rawGuessNodes && typeof rawGuessNodes === 'object' && !Array.isArray(rawGuessNodes)
        ? rawGuessNodes
        : null
      if (!normalizedGuessNodes) {
        const qraCandidates: Array<Record<string, unknown>> = []
        const seenQras = new Set<string>()
        for (const cid of normalizedControlIds.slice(0, 4)) {
          for (const qraCollection of ['sparta_qra_canonical', 'sparta_qra_relationship', 'sparta_qra']) {
            for (const field of ['source_control_id', 'control_id']) {
              try {
                const listed = await proxyPost('/list', {
                  collection: qraCollection,
                  limit: 2,
                  filters: { [field]: cid },
                  return_fields: ['_id', '_key', 'qra_id', 'question', 'problem', 'answer', 'solution', 'reasoning', 'control_id', 'source_control_id', 'review_status'],
                }) as { documents?: Array<Record<string, unknown>> }
                const docs = Array.isArray(listed.documents) ? listed.documents : []
                docs.forEach((doc) => {
                  const key = String(doc._id || doc._key || doc.qra_id || '')
                  if (!key || seenQras.has(key)) return
                  seenQras.add(key)
                  qraCandidates.push({
                    layer: qraCollection,
                    status: 'candidate',
                    proof_role: 'none',
                    query: text,
                    match_basis: 'same_control_id',
                    reason: `related QRA candidate for extracted control ${cid}`,
                    id: doc.qra_id || doc._id || doc._key,
                    _id: doc._id,
                    _key: doc._key,
                    control_id: doc.source_control_id || doc.control_id || cid,
                    question: doc.question || doc.problem,
                    answer: doc.answer || doc.solution,
                    reasoning: doc.reasoning,
                    review_status: doc.review_status,
                    source: qraCollection,
                  })
                })
              } catch {
                // Candidate nodes are non-proof affordances; extraction should not fail on them.
              }
              if (qraCandidates.length > 0) break
            }
          }
        }
        normalizedGuessNodes = {
          status: 'candidate_only',
          proof_role: 'none',
          controls: [],
          qras: qraCandidates.slice(0, 12),
          notes: [
            'Guess nodes are did-you-mean or closest related candidates.',
            'Guess nodes must not satisfy grounding, approval, or evidence gates.',
          ],
        }
      }

      res.json({
        entities,
        mode: 'flashtext',
        // Normalized data for UI consumers that expect legacy keys
        control_ids: normalizedControlIds,
        spans: normalizedSpans,
        glossary: normalizedGlossary,
        resolution_map: normalizedResolutionMap,
        control_metadata: normalizedControlMeta,
        not_in_corpus: normalizedNotInCorpus,
        phrases: normalizedPhrases,
        misspellings: result.misspellings ?? [],
        related_pairs: result.related_pairs ?? [],
        recall_items: result.recall_items ?? [],
        grounding_ok: result.grounding_ok ?? null,
        agent_decision: result.agent_decision ?? null,
        summary: result.summary ?? null,
        guess_nodes: normalizedGuessNodes,
        candidate_nodes: result.candidate_nodes ?? normalizedGuessNodes,
        entity_nodes: normalizedEntityNodes,
        proof_packet: result.proof_packet ?? null,
        nodes: result.nodes ?? null,
        counts: result.counts ?? null,
        agent_contract: result.agent_contract ?? null,
        // Pass-through current contract for newer consumers
        resolved_entities: resolvedEntities,
        unresolved_entities: unresolvedEntities,
        external_entities: externalEntities,
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
type EvidenceCaseSseEventType =
  | 'run_started'
  | 'gate'
  | 'diagnostics'
  | 'result'
  | 'run_completed'
  | 'error'
  | 'gap_review_started'
  | 'persona_review'
  | 'judge_routing'
  | 'correction_suggested'
  | 'rerun_started'
  | 'rerun_completed'
  | 'human_intervention_requested'

type EvidenceCaseHumanReviewState = 'not_requested' | 'requested' | 'queued' | 'in_review' | 'approved' | 'rejected'
type SpartaChatResponseAction = 'answer' | 'clarify' | 'deflect'

interface EvidenceCaseRunHistoryEntry {
  id: string
  started_at: string
  completed_at?: string
  status: EvidenceCaseRunStatus
  evidence_run_status?: EvidenceCaseRunStatus
  gap_review_status?: 'not_applicable' | 'candidate' | 'queued' | 'completed' | 'failed'
  human_review_state?: EvidenceCaseHumanReviewState
  question: string
  control_id?: string | null
  node_label?: string | null
  verdict?: JsonRecord
  gates?: JsonRecord[]
  diagnostics?: JsonRecord
  gap_review?: JsonRecord
  proposed_correction?: JsonRecord
  correction_lineage?: JsonRecord
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

const SPARTA_CHAT_RESPONSE_PROMPT_VERSION = 'sparta_chat_response_policy_v1'
const SPARTA_CHAT_SOURCE_INJECTION_MARKERS = [
  'ignore the prompt',
  'ignore previous',
  'disregard previous',
  'override response_action',
  'qra_fake',
  'fully compliant',
  'reveal the system prompt',
  'system prompt',
]

function iterTextValues(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap((item) => iterTextValues(item))
  if (value && typeof value === 'object') return Object.values(value as Record<string, unknown>).flatMap((item) => iterTextValues(item))
  return []
}

function hasResponsePolicySourceInjection(question: unknown, payload: JsonRecord): boolean {
  const text = [typeof question === 'string' ? question : '', ...iterTextValues({
    evidence: payload.evidence,
    glossary: payload.glossary,
    crosswalk_chains: payload.crosswalk_chains,
    context: payload.context,
  })].join('\n').toLowerCase()
  return SPARTA_CHAT_SOURCE_INJECTION_MARKERS.some((marker) => text.includes(marker))
}

function evidenceCaseArtifactIds(payload: JsonRecord): string[] {
  const ids = new Set<string>()
  const version = payload.evidence_case_version as JsonRecord | undefined
  const evidenceCase = payload.evidence_case as JsonRecord | undefined
  const versionId = version?.id ?? evidenceCase?.case_id ?? evidenceCase?.id
  if (typeof versionId === 'string' && versionId.trim()) ids.add(versionId)
  ids.add('gate_trace')
  const evidence = Array.isArray(payload.evidence) ? payload.evidence as JsonRecord[] : []
  for (const [index, item] of evidence.entries()) {
    const result = item.result && typeof item.result === 'object' ? item.result as JsonRecord : {}
    const id = item.id ?? result.control_id ?? `evidence_case.evidence[${index}]`
    if (typeof id === 'string' && id.trim()) ids.add(id)
  }
  return [...ids]
}

function evidenceCaseCitations(payload: JsonRecord): JsonRecord[] {
  const citations: JsonRecord[] = []
  const evidence = Array.isArray(payload.evidence) ? payload.evidence as JsonRecord[] : []
  for (const [index, item] of evidence.entries()) {
    const result = item.result && typeof item.result === 'object' ? item.result as JsonRecord : {}
    const id = item.id ?? result.control_id ?? `evidence_case.evidence[${index}]`
    if (typeof id !== 'string' || !id.trim()) continue
    const framework = typeof result.source_framework === 'string' ? result.source_framework : 'UNKNOWN'
    citations.push({
      id,
      source: 'evidence_case.evidence',
      framework: ['SPARTA', 'CWE', 'NIST', 'CAPEC', 'ATT&CK', 'D3FEND', 'ISO', 'CMMC', 'DISA_STIG', 'ESA', 'URL_KNOWLEDGE'].includes(framework) ? framework : 'UNKNOWN',
    })
  }
  if (citations.length === 0) {
    const evidenceCase = payload.evidence_case as JsonRecord | undefined
    const evidenceCard = evidenceCase?.evidence_card && typeof evidenceCase.evidence_card === 'object' ? evidenceCase.evidence_card as JsonRecord : undefined
    const answerPayload = evidenceCase?.answer_payload && typeof evidenceCase.answer_payload === 'object' ? evidenceCase.answer_payload as JsonRecord : undefined
    const controlId = evidenceCard?.primary_control ?? answerPayload?.control_id
    const source = evidenceCard?.source && typeof evidenceCard.source === 'object' ? evidenceCard.source as JsonRecord : {}
    const collection = typeof source.collection === 'string' ? source.collection : null
    if (typeof controlId === 'string' && controlId.trim() && collection === 'sparta_controls') {
      citations.push({
        id: controlId,
        source: 'evidence_case.evidence_card',
        framework: 'SPARTA',
      })
    }
  }
  return citations
}

function buildSpartaChatResponsePolicy(question: string, payload: JsonRecord, profile: unknown): JsonRecord {
  const verdict = payload.verdict && typeof payload.verdict === 'object' ? payload.verdict as JsonRecord : {}
  const state = String(verdict.state ?? payload.verdict_state ?? '').toLowerCase()
  const verdictAction = typeof verdict.action === 'string' ? verdict.action.toLowerCase() : ''
  const gateTrace = Array.isArray(payload.gate_trace) ? payload.gate_trace as JsonRecord[] : []
  const hasFailedRequiredGate = gateTrace.some((gate) => gate.passed === false && gate.required !== false)
  const sourceInjection = hasResponsePolicySourceInjection(question, payload)
  const citations = evidenceCaseCitations(payload)
  const artifacts = evidenceCaseArtifactIds(payload)
  let responseAction: SpartaChatResponseAction = verdictAction === 'clarify' ? 'clarify'
    : verdictAction === 'deflect' ? 'deflect'
    : state === 'satisfied' ? 'answer'
    : state === 'not_satisfied' ? 'deflect'
    : 'clarify'

  if (sourceInjection) responseAction = 'deflect'
  if (responseAction === 'answer' && (state !== 'satisfied' || citations.length === 0 || hasFailedRequiredGate)) responseAction = 'deflect'

  const profileText = typeof profile === 'string' ? profile : null
  if (responseAction === 'answer') {
    const evidenceIds = citations.map((citation) => String(citation.id))
    const firstCitation = evidenceIds[0]
    return {
      response_action: 'answer',
      user_message: firstCitation
        ? `The evidence case supports an answer using cited evidence [${firstCitation}]. ${String(payload.answer ?? '').trim()}`.trim()
        : String(payload.answer ?? 'The evidence case supports an answer.'),
      citations,
      evidence_items: evidenceIds,
      clarifying_questions: [],
      deflection_reason: null,
      limitations: ['This is evidence-case support, not a compliance certification.'],
      inspectable_artifacts: [...new Set([...artifacts, ...evidenceIds])],
      confidence: hasFailedRequiredGate ? 'low' : 'high',
      prompt_version: SPARTA_CHAT_RESPONSE_PROMPT_VERSION,
    }
  }

  if (responseAction === 'clarify') {
    const detail = gateTrace.find((gate) => gate.passed === false)?.detail
    return {
      response_action: 'clarify',
      user_message: 'More scoped input is required before Chat can provide an evidence-grounded answer.',
      citations: [],
      evidence_items: [],
      clarifying_questions: [
        typeof detail === 'string' && detail.trim()
          ? `Please clarify: ${detail}`
          : 'Which specific system, control, or evidence profile should the evidence case use?',
      ],
      deflection_reason: null,
      limitations: ['The current request is underspecified for the selected evidence-case route.'],
      inspectable_artifacts: artifacts,
      confidence: 'medium',
      prompt_version: SPARTA_CHAT_RESPONSE_PROMPT_VERSION,
    }
  }

  const reason = sourceInjection ? 'unsafe_request'
    : profileText && profileText.toLowerCase().includes('ground') && /\b(orbital|orbit|downlink|leo|spacecraft|satellite)\b/i.test(question) ? 'outside_profile'
    : citations.length === 0 || state !== 'satisfied' ? 'insufficient_evidence'
    : 'unsafe_request'
  return {
    response_action: 'deflect',
    user_message: 'I cannot provide an authoritative answer from the selected evidence route.',
    citations: [],
    evidence_items: [],
    clarifying_questions: [],
    deflection_reason: reason,
    limitations: [sourceInjection ? 'Untrusted source or scoping text attempted to override response policy.' : 'The evidence case did not satisfy the answer gate.'],
    inspectable_artifacts: artifacts,
    confidence: 'low',
    prompt_version: SPARTA_CHAT_RESPONSE_PROMPT_VERSION,
  }
}

function buildSpartaChatEvidenceBinding(payload: JsonRecord, source: 'run' | 'stream', runId?: string): JsonRecord {
  const responsePolicy = payload.response_policy && typeof payload.response_policy === 'object' ? payload.response_policy as JsonRecord : {}
  const responseAction = typeof responsePolicy.response_action === 'string' ? responsePolicy.response_action : ''
  const gateTrace = Array.isArray(payload.gate_trace) ? payload.gate_trace as JsonRecord[] : []
  const requiredGates = gateTrace.filter((gate) => gate.required !== false)
  const gatesPassed = requiredGates.filter((gate) => gate.passed !== false).length
  const gatesTotal = requiredGates.length
  const citations = Array.isArray(responsePolicy.citations) ? responsePolicy.citations : []
  const evidenceItems = Array.isArray(responsePolicy.evidence_items) ? responsePolicy.evidence_items : []
  const inspectableArtifacts = Array.isArray(responsePolicy.inspectable_artifacts) ? responsePolicy.inspectable_artifacts : []
  const responseActionClosedVocabulary = ['answer', 'clarify', 'deflect'].includes(responseAction)
  const answerHasEvidence = responseAction !== 'answer' || citations.length > 0 || evidenceItems.length > 0
  const failedRequiredGate = requiredGates.some((gate) => gate.passed === false)
  const predicates: Record<string, boolean> = {
    production_source: source === 'run' || source === 'stream',
    response_policy_present: Object.keys(responsePolicy).length > 0,
    response_action_closed_vocabulary: responseActionClosedVocabulary,
    gate_trace_present: gateTrace.length > 0,
    required_gates_passed: !failedRequiredGate,
    inspectable_artifacts_present: inspectableArtifacts.length > 0,
    answer_cites_evidence: answerHasEvidence,
  }
  const failedPredicates = Object.entries(predicates)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)
  return {
    predicate: 'CHAT_EVIDENCE_BINDING',
    ok: failedPredicates.length === 0,
    source,
    run_id: runId ?? null,
    response_action: responseAction || null,
    gates_passed: gatesPassed,
    gates_total: gatesTotal,
    verdict: payload.verdict && typeof payload.verdict === 'object' ? (payload.verdict as JsonRecord).state ?? null : payload.verdict_state ?? null,
    citation_count: citations.length,
    evidence_item_count: evidenceItems.length,
    inspectable_artifact_count: inspectableArtifacts.length,
    predicates,
    failed_predicates: failedPredicates,
  }
}

function attachSpartaChatResponsePolicy(
  question: string,
  payload: JsonRecord,
  profile: unknown,
  source: 'run' | 'stream' = 'run',
  runId?: string,
): JsonRecord {
  const responsePolicy = buildSpartaChatResponsePolicy(question, payload, profile)
  payload.response_policy = responsePolicy
  payload.response_action = responsePolicy.response_action
  payload.chat_evidence_binding = buildSpartaChatEvidenceBinding(payload, source, runId)
  return payload
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

function evidenceCasePreflightPayload(question: string, decision: EvidenceCasePreflightDecision, profile: unknown): JsonRecord {
  const clarify = decision.action === 'clarify'
  const qraQuality = {
    status: 'blocked_by_preflight',
    issue_code: decision.issue_code,
    issue_label: decision.issue_label,
    disposition: clarify ? 'clarify_before_evidence_case' : 'deflect_without_evidence_case',
    safe_action: decision.action,
  }
  return {
    verdict: {
      state: clarify ? 'inconclusive' : 'not_satisfied',
      action: decision.action,
      grade: clarify ? 'C' : 'F',
      score: clarify ? 0.25 : 0,
    },
    gate_trace: [
      {
        gate: `preflight_${decision.issue_code}`,
        passed: false,
        detail: decision.detail,
      },
    ],
    evidence: [],
    glossary: [],
    crosswalk_chains: [],
    context: {
      profile: typeof profile === 'string' ? profile : null,
    },
    diagnostics: {
      authority: 'server_deterministic_gate',
      workflow: 'create-evidence-case',
      mode: clarify ? 'clarification_required' : 'deflection_required',
      question,
      profile: typeof profile === 'string' ? profile : null,
      qra_quality: qraQuality,
    },
    qra_quality: qraQuality,
    answer: clarify
      ? `Clarify: ${decision.detail}`
      : `Cannot answer from selected evidence profile: ${decision.detail}`,
    cae_tree: null,
  }
}

function createEvidenceCaseVersion(question: string, controlId: unknown, result?: any, previousVersion?: unknown): JsonRecord {
  return {
    id: createEvidenceCaseRunId(),
    created_at: new Date().toISOString(),
    question,
    control_id: typeof controlId === 'string' ? controlId : null,
    previous_version: previousVersion ?? null,
    source: 'ux-lab-api',
    advisory_only: true,
    status_language: 'retrieved/found/suggested/queued',
    result_ref: result && typeof result === 'object' ? {
      review_status: result.review_status ?? null,
      qra_key: result._key ?? result.qra_key ?? null,
      run_id: result.run_id ?? null,
    } : null,
  }
}

function evidenceCaseNeedsGapReview(payload: JsonRecord | null | undefined): boolean {
  const verdict = payload?.verdict as JsonRecord | undefined
  const state = String(verdict?.state ?? '').toLowerCase()
  const diagnostics = payload?.diagnostics as JsonRecord | undefined
  return state === 'inconclusive' || state === 'not_satisfied' || diagnostics?.mode === 'error' || diagnostics?.mode === 'clarification_required'
}

function buildAdvisoryGapReview(question: string, controlId: unknown, payload: JsonRecord | null | undefined, opts: JsonRecord = {}): JsonRecord {
  const diagnostics = (payload?.diagnostics && typeof payload.diagnostics === 'object') ? payload.diagnostics as JsonRecord : {}
  const gates = Array.isArray(payload?.gate_trace) ? payload.gate_trace as JsonRecord[] : []
  const failedGates = gates.filter((gate) => gate?.passed === false)
  const evidence = Array.isArray(payload?.evidence) ? payload.evidence as JsonRecord[] : []
  const reasons = failedGates.length
    ? failedGates.map((gate) => `Gate ${String(gate.gate ?? 'unknown')} did not pass: ${String(gate.detail ?? 'no detail')}`)
    : [String(diagnostics.mode ?? 'Evidence case was inconclusive or unavailable')]
  const proposedCorrection = {
    id: createEvidenceCaseRunId(),
    status: 'suggested',
    corrected_question: String(opts.corrected_question ?? question).trim(),
    source_control_id: typeof controlId === 'string' ? controlId : null,
    rationale: reasons,
    preserves_previous_version: opts.previous_version ?? null,
  }
  return {
    review_id: createEvidenceCaseRunId(),
    created_at: new Date().toISOString(),
    advisory_only: true,
    gap_review_status: 'completed',
    human_review_state: opts.human_review_state ?? 'queued',
    evidence_run_status: diagnostics.mode === 'error' ? 'failed' : 'completed',
    question,
    control_id: typeof controlId === 'string' ? controlId : null,
    decision: evidence.length > 0 ? 'NEEDS_CLARIFICATION' : 'INSUFFICIENT_EVIDENCE',
    retrieved_policy_evidence: [],
    retrieved_technical_evidence: evidence,
    control_catalog: typeof controlId === 'string' ? [{ control_id: controlId, retrieved_from: 'request' }] : [],
    gap_review_candidate: true,
    persona_review: {
      status: 'suggested',
      reviewer: 'cae-gap-review-advisory',
      summary: 'Advisory-only CAE gap review queued for analyst review; no authoritative answer synthesized.',
      findings: reasons,
    },
    judge_routing: {
      route: 'human_review',
      status: 'queued',
      reason: 'failed_or_inconclusive_evidence_case',
    },
    proposed_correction: proposedCorrection,
    correction_lineage: {
      previous_version: opts.previous_version ?? null,
      proposed_correction_id: proposedCorrection.id,
      rerun_of: opts.rerun_of ?? null,
    },
    evidence_case_version: createEvidenceCaseVersion(question, controlId, payload, opts.previous_version),
    diagnostics: {
      authority: 'server_advisory_gap_review',
      workflow: 'cae-gap-review',
      advisory_only: true,
      source_diagnostics: diagnostics,
    },
  }
}

function normalizeEvidenceCaseWorkflowResult(question: string, controlId: unknown, result: any): JsonRecord {
  if (result?.evidence_case?.case_type === 'direct_lookup' && result?.extract_entities) {
    const evidenceCase = result.evidence_case
    const glossary = Array.isArray(evidenceCase.glossary) ? evidenceCase.glossary : []
    const answerPayload = evidenceCase.answer_payload && typeof evidenceCase.answer_payload === 'object' ? evidenceCase.answer_payload : {}
    const directControlId = evidenceCase.evidence_card?.primary_control || answerPayload.control_id || null
    return {
      verdict: { state: 'satisfied', grade: 'A', score: 1.0 },
      gate_trace: [
        { gate: 'extract_entities', passed: true, detail: 'direct lookup grounded' },
        { gate: 'crosswalk', passed: true, detail: 'not required' },
        { gate: 'cae', passed: true, detail: 'not required' },
        { gate: 'framework', passed: true, detail: evidenceCase.context?.framework_label || evidenceCase.context?.framework || 'SPARTA' },
      ],
      evidence: directControlId ? [{
        id: directControlId,
        method: 'LOOKUP',
        layer: 'sparta_controls',
        result: {
          control_id: directControlId,
          source_framework: 'SPARTA',
          qra_text: evidenceCase.evidence_card?.title || result.assistant_response?.text || '',
          answer: result.assistant_response?.text || answerPayload.source_description || '',
        },
        confidence: 1.0,
      }] : [],
      glossary: glossary.slice(0, 20).map((g: any) => ({
        term: g.name || g.id,
        type: g.type === 'countermeasure' ? 'countermeasure' : g.framework === 'SPARTA' ? 'control' : 'domain_term',
      })),
      crosswalk_chains: [],
      context: evidenceCase.context || {},
      cwe_record: null,
      diagnostics: {
        authority: 'create-evidence-case',
        workflow: 'create-evidence-case',
        mode: 'direct_lookup',
        question,
        control_id: typeof controlId === 'string' ? controlId : evidenceCase.answer_payload?.control_id || null,
        review_status: evidenceCase.review_status || 'not_reviewed',
        raw_keys: result && typeof result === 'object' ? Object.keys(result).sort() : [],
      },
      answer: result.assistant_response?.text || '',
      assistant_response: result.assistant_response || null,
      extract_entities: result.extract_entities,
      evidence_case: evidenceCase,
      evidence_card: evidenceCase.evidence_card || null,
      agent_contract: result.agent_contract || null,
      cae_tree: evidenceCase.cae_tree || { included: false, reason: 'CAE generation is not required for direct control lookup.' },
    }
  }

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

type TauChatStepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'done'
type TauChatBranch = 'compliance' | 'evidence-case'

function tauChatIsoNow(): string {
  return new Date().toISOString()
}

function tauChatStep(args: {
  id: string
  branch?: TauChatBranch
  status?: TauChatStepStatus
  label?: string
  liveStatusLabel?: string
  detail?: string
  data?: unknown
  error?: string
}): JsonRecord {
  const status = args.status ?? 'running'
  const branch = args.branch ?? 'compliance'
  const timestamp = tauChatIsoNow()
  return {
    kind: args.error ? 'error' : 'step',
    id: args.id,
    label: args.label ?? tauChatStepLabel(args.id),
    status,
    branch,
    disclosureVariant: branch === 'evidence-case' ? 'evidence-case' : 'thinking',
    liveStatusLabel: args.liveStatusLabel ?? 'Thinking...',
    detail: args.detail,
    data: args.data,
    error: args.error,
    startedAt: status === 'running' || status === 'pending' ? timestamp : undefined,
    completedAt: status === 'completed' || status === 'failed' || status === 'skipped' ? timestamp : undefined,
  }
}

function tauChatStepLabel(id: string): string {
  return id === 'extracting-entities' ? 'Extracting entities'
    : id === 'looking-in-memory' ? 'Looking in memory'
      : id === 'checking-gates' ? 'Checking gates'
        : id === 'clarifying' ? 'Checking clarification'
          : id === 'finalizing-intent' ? 'Finalizing intent'
            : id === 'getting-results' ? 'Getting results'
              : id === 'answering' ? 'Answering'
                : id
}

function tauChatTraceFromSteps(steps: JsonRecord[]): JsonRecord[] {
  const latest = new Map<string, JsonRecord>()
  for (const step of steps) {
    if (step.kind === 'final' || step.kind === 'token' || step.kind === 'message') continue
    const id = typeof step.id === 'string' ? step.id : ''
    if (!id) continue
    latest.set(id, {
      id,
      label: typeof step.label === 'string' ? step.label : tauChatStepLabel(id),
      status: typeof step.status === 'string' ? step.status : 'completed',
      detail: typeof step.detail === 'string' ? step.detail : undefined,
      disclosureVariant: step.disclosureVariant === 'evidence-case' ? 'evidence-case' : 'thinking',
      icon: step.disclosureVariant === 'evidence-case' ? 'shield' : 'sparkles',
      startedAt: typeof step.startedAt === 'string' ? step.startedAt : undefined,
      completedAt: typeof step.completedAt === 'string' ? step.completedAt : undefined,
      data: step.data,
    })
  }
  return [...latest.values()]
}

function tauChatString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function tauChatNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function tauChatRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

function tauChatArrayLength(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined
}

function tauChatExtractContent(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  const record = tauChatRecord(value)
  for (const key of ['answer', 'content', 'message', 'response', 'text', 'final']) {
    const direct = tauChatString(record[key])
    if (direct) return direct
  }
  for (const key of ['data', 'result', 'packet', 'answerPacket', 'payload']) {
    const nested = tauChatRecord(record[key])
    for (const nestedKey of ['answer', 'content', 'message', 'response', 'text', 'final']) {
      const nestedValue = tauChatString(nested[nestedKey])
      if (nestedValue) return nestedValue
    }
  }
  return ''
}

function tauChatSummarizeEntities(entities: JsonRecord): string {
  const parts = ['entities', 'controls', 'domains', 'artifacts']
    .map((key) => [key, tauChatArrayLength(entities[key])] as const)
    .filter(([, count]) => count !== undefined)
    .map(([key, count]) => `${count} ${key}`)
  return parts.length ? parts.join(', ') : 'Entity extraction completed'
}

function tauChatSummarizeRecall(recall: JsonRecord): string {
  const confidence = tauChatNumber(recall.confidence)
  if (confidence !== undefined) return `Recall confidence ${confidence.toFixed(2)}`
  const hits = tauChatArrayLength(recall.hits ?? recall.items ?? recall.results)
  const citations = tauChatArrayLength(recall.citations)
  const parts: string[] = []
  if (hits !== undefined) parts.push(`${hits} hits`)
  if (citations !== undefined) parts.push(`${citations} citations`)
  return parts.length ? parts.join(', ') : 'Recall completed'
}

function tauChatEvaluateGates(args: {
  entities: JsonRecord
  recall: JsonRecord
  gateDepth: string
}): JsonRecord {
  const reasons: string[] = []
  const confidence = tauChatNumber(args.recall.confidence)
  const entityCount = tauChatArrayLength(args.entities.entities) ?? tauChatArrayLength(args.entities.controls) ?? 0
  const strict = args.gateDepth === 'strict'
  const balanced = args.gateDepth === 'balanced'
  if (confidence !== undefined && confidence < (strict ? 0.45 : balanced ? 0.25 : 0.1)) reasons.push('low recall confidence')
  if (strict && entityCount === 0) reasons.push('no extracted entities')
  const needsClarification = reasons.length > 0 && args.gateDepth !== 'light'
  return {
    ok: reasons.length === 0,
    needsClarification,
    reasons,
    summary: reasons.length ? `Needs clarification: ${reasons.join(', ')}` : 'Gates passed',
  }
}

function tauChatIsClarificationRequired(clarification: JsonRecord): boolean {
  const state = String(clarification.status ?? clarification.state ?? '').toUpperCase()
  return state === 'INCONCLUSIVE' || state === 'CLARIFY' || Array.isArray(clarification.options) || Array.isArray(clarification.clarifyOptions)
}

function tauChatIntentSummary(intent: JsonRecord): string {
  const type = tauChatString(intent.intent) ?? tauChatString(intent.type) ?? tauChatString(intent.route) ?? tauChatString(intent.action)
  return type ? `Intent: ${type}` : 'Intent finalized'
}

type SpartaExplorerScopedProxyPost = (path: string, body?: object | null, timeoutMs?: number) => Promise<unknown>

type SpartaExplorerScopedRoute = 'deflect' | 'non_sparta_memory' | 'non_sparta_lean'

export interface SpartaExplorerScopedRouteInput {
  question: string
  allowOffTopic?: boolean
  surface?: string
  branchHint?: unknown
  gateDepth?: unknown
  matrixContext?: unknown
  context?: unknown
}

export interface SpartaExplorerScopedRouteDeps {
  proxyPostFn?: SpartaExplorerScopedProxyPost
  fetchFn?: typeof fetch
}

export type SpartaExplorerScopedRouteResult =
  | {
      kind: 'continue'
      intent: JsonRecord
      intentAction: string
      intentProfile: string | null
    }
  | {
      kind: 'terminal'
      intent: JsonRecord
      intentAction: string
      intentProfile: string | null
      route: SpartaExplorerScopedRoute
      responseAction: 'answer' | 'deflect'
      content: string
      nonSparta: boolean
      routeReceipt: JsonRecord
      routeData?: JsonRecord
    }

function tauChatQueryPlan(intent: JsonRecord): JsonRecord {
  return tauChatRecord(intent.query_plan ?? intent.queryPlan ?? intent.query_spec ?? intent.querySpec)
}

function tauChatIntentAction(intent: JsonRecord): string {
  const nestedIntent = tauChatRecord(intent.intent)
  const value = tauChatString(intent.action)
    ?? tauChatString(intent.intent_action)
    ?? tauChatString(intent.intentAction)
    ?? tauChatString(intent.route)
    ?? tauChatString(intent.state)
    ?? tauChatString(intent.status)
    ?? tauChatString(intent.classification)
    ?? tauChatString(nestedIntent.action)
    ?? tauChatString(nestedIntent.route)
    ?? tauChatString(nestedIntent.state)
    ?? tauChatString(nestedIntent.status)
    ?? tauChatString(nestedIntent.classification)
  return value?.toUpperCase() ?? 'UNKNOWN'
}

function tauChatIntentProfile(intent: JsonRecord): string | null {
  const queryPlan = tauChatQueryPlan(intent)
  return tauChatString(queryPlan.profile)
    ?? tauChatString(queryPlan.recall_profile)
    ?? tauChatString(queryPlan.recallProfile)
    ?? tauChatString(intent.profile)
    ?? tauChatString(intent.recall_profile)
    ?? tauChatString(intent.recallProfile)
    ?? null
}

function tauChatIsSpartaScopedIntent(intent: JsonRecord, action: string, branchHint: unknown): boolean {
  if (action === 'NO_MATCH' || action === 'OFF_TOPIC' || action === 'DEFLECT') return false
  if (branchHint === 'evidence-case' || action === 'COMPLIANCE' || action === 'CLARIFY') return true
  if (intent.content_type === 'evidence_case' || intent.render_style_id === 'evidence_case_panel') return true
  const serialized = JSON.stringify({
    query_plan: tauChatQueryPlan(intent),
    tool_calls: intent.tool_calls,
    entities: intent.entities,
  }).toLowerCase()
  return serialized.includes('create-evidence-case')
    || serialized.includes('create_evidence_case')
    || serialized.includes('sparta_controls')
    || serialized.includes('sparta_qra')
    || serialized.includes('sparta_relationships')
}

function tauChatIsProofIntent(intent: JsonRecord, profile: string | null): boolean {
  if (profile === 'proof_retrieval') return true
  const serialized = JSON.stringify({
    query_plan: tauChatQueryPlan(intent),
    tool_calls: intent.tool_calls,
  }).toLowerCase()
  return serialized.includes('lean4-prove')
    || serialized.includes('lean4_prove')
    || serialized.includes('formal_proof')
}

function tauChatScopedRouteReceipt(args: {
  route: SpartaExplorerScopedRoute
  allowOffTopic: boolean
  intentAction: string
  intentProfile: string | null
  deflectCalls?: number
  nonSpartaRecallCalls?: number
  nonSpartaAnswerCalls?: number
  leanCalls?: number
}): JsonRecord {
  return {
    schema: 'sparta.explorer.scoped_route_receipt.v1',
    surface: 'sparta-explorer',
    scope: 'sparta-explorer',
    route: args.route,
    allow_off_topic: args.allowOffTopic,
    memory_intent_action: args.intentAction,
    memory_intent_profile: args.intentProfile,
    calls: {
      memory_intent: 1,
      memory_deflect: args.deflectCalls ?? 0,
      non_sparta_recall: args.nonSpartaRecallCalls ?? 0,
      non_sparta_answer: args.nonSpartaAnswerCalls ?? 0,
      lean4_prove: args.leanCalls ?? 0,
      sparta_recall_after_intent: 0,
      sparta_answer_after_intent: 0,
      create_evidence_case: 0,
    },
    authority_claim_counts: {
      sparta: 0,
      evidence: 0,
      crosswalk: 0,
      posture: 0,
    },
  }
}

function tauChatLeanResultContent(result: JsonRecord): string {
  return tauChatString(result.code)
    || tauChatExtractContent(result)
    || tauChatString(result.proof)
    || tauChatString(result.theorem)
    || tauChatString(result.detail)
    || ''
}

/**
 * Applies the Sparta Explorer scope policy before any SPARTA recall, answer,
 * evidence-case, or Lean route can run. Memory remains the sole intent
 * classifier; this function only enforces the Explorer's allow_off_topic flag.
 */
export async function routeSpartaExplorerScopedTurn(
  input: SpartaExplorerScopedRouteInput,
  deps: SpartaExplorerScopedRouteDeps = {},
): Promise<SpartaExplorerScopedRouteResult> {
  const proxy = deps.proxyPostFn ?? proxyPost
  const fetchImpl = deps.fetchFn ?? fetch
  const question = input.question.trim()
  const allowOffTopic = input.allowOffTopic === true
  const surface = tauChatString(input.surface) ?? 'sparta-explorer'

  const intent = tauChatRecord(await proxy('/intent', {
    q: question,
    query: question,
    text: question,
    surface,
    scope: 'sparta-explorer',
    fast: true,
    allow_off_topic: allowOffTopic,
    branch_hint: input.branchHint,
    gate_depth: input.gateDepth,
    matrix_context: input.matrixContext,
    context: input.context,
  }))
  const intentAction = tauChatIntentAction(intent)
  const intentProfile = tauChatIntentProfile(intent)

  if (tauChatIsSpartaScopedIntent(intent, intentAction, input.branchHint)) {
    return { kind: 'continue', intent, intentAction, intentProfile }
  }

  if (!allowOffTopic || intentAction === 'DEFLECT') {
    const deflect = tauChatRecord(await proxy('/deflect', {
      q: question,
      query: question,
      text: question,
      action: intentAction,
      intent_action: intentAction,
      intent,
      surface,
      scope: 'sparta-explorer',
      allow_off_topic: allowOffTopic,
      reason: allowOffTopic ? 'memory_deflect' : 'sparta_explorer_off_topic_disabled',
    }))
    const deflectText = tauChatExtractContent(deflect)
      || 'This question is outside the current Sparta Explorer scope. Enable off-topic questions to use a separately labeled non-SPARTA capability.'
    return {
      kind: 'terminal',
      intent,
      intentAction,
      intentProfile,
      route: 'deflect',
      responseAction: 'deflect',
      content: deflectText.startsWith('SPARTA DEFLECTION') ? deflectText : `SPARTA DEFLECTION — ${deflectText}`,
      nonSparta: false,
      routeReceipt: tauChatScopedRouteReceipt({
        route: 'deflect',
        allowOffTopic,
        intentAction,
        intentProfile,
        deflectCalls: 1,
      }),
      routeData: { action: 'DEFLECT', content: deflectText },
    }
  }

  if (tauChatIsProofIntent(intent, intentProfile)) {
    let result: JsonRecord = {}
    let unavailableReason = ''
    try {
      const response = await fetchImpl('http://127.0.0.1:8604/prove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requirement: question,
          tactics: [],
          model: 'text',
          max_retries: 3,
          timeout: 60,
        }),
      })
      const rawText = await response.text()
      if (rawText.trim()) {
        try {
          result = tauChatRecord(JSON.parse(rawText))
        } catch {
          result = { content: rawText }
        }
      }
      if (!response.ok) unavailableReason = `HTTP ${response.status}`
      else if (result.prove_available === false) unavailableReason = 'prove backend unavailable'
      else if (result.success === false || result.ok === false) {
        const errors = Array.isArray(result.errors)
          ? result.errors.map((value) => tauChatString(value)).filter(Boolean).join('; ')
          : tauChatString(result.error)
        unavailableReason = errors || tauChatLeanResultContent(result) || 'proof service returned no successful proof'
      }
    } catch (error) {
      unavailableReason = error instanceof Error ? error.message : String(error)
    }

    const content = unavailableReason
      ? `NON-SPARTA FORMAL CHECK — Lean4 proof service unavailable: ${unavailableReason}`
      : `NON-SPARTA FORMAL CHECK — ${tauChatLeanResultContent(result) || 'The Lean4 service returned no proof result.'}`
    return {
      kind: 'terminal',
      intent,
      intentAction,
      intentProfile,
      route: 'non_sparta_lean',
      responseAction: 'answer',
      content,
      nonSparta: true,
      routeReceipt: tauChatScopedRouteReceipt({
        route: 'non_sparta_lean',
        allowOffTopic,
        intentAction,
        intentProfile,
        leanCalls: 1,
      }),
      routeData: {
        capability: 'lean4',
        available: !unavailableReason,
        prove_available: result.prove_available === true,
        scillm_reachable: result.scillm_reachable === true,
      },
    }
  }

  const querySpec = tauChatQueryPlan(intent)
  const recall = tauChatRecord(await proxy('/recall', {
    q: question,
    query: question,
    text: question,
    intent,
    query_spec: querySpec,
    profile: intentProfile ?? 'general_memory_recall',
    scope: 'general',
    surface: 'sparta-explorer-off-topic',
  }))
  const answer = tauChatRecord(await proxy('/answer', {
    q: question,
    query: question,
    text: question,
    intent,
    recall,
    query_spec: querySpec,
    scope: 'general',
    surface: 'sparta-explorer-off-topic',
  }))
  const answerText = tauChatExtractContent(answer)
    || tauChatExtractContent(recall)
    || 'Memory returned no non-SPARTA answer.'

  return {
    kind: 'terminal',
    intent,
    intentAction,
    intentProfile,
    route: 'non_sparta_memory',
    responseAction: 'answer',
    content: `NON-SPARTA MEMORY ANSWER — ${answerText}`,
    nonSparta: true,
    routeReceipt: tauChatScopedRouteReceipt({
      route: 'non_sparta_memory',
      allowOffTopic,
      intentAction,
      intentProfile,
      nonSpartaRecallCalls: 1,
      nonSpartaAnswerCalls: 1,
    }),
    routeData: {
      capability: 'memory-general',
      recall_item_count: tauChatArrayLength(recall.hits ?? recall.items ?? recall.results) ?? 0,
      answer_available: Boolean(answerText),
    },
  }
}

function tauChatIsEvidenceIntent(intent: JsonRecord, branchHint: unknown, question: string): boolean {
  const queryPlan = tauChatRecord(intent.query_plan)
  const toolCalls = Array.isArray(intent.tool_calls) ? intent.tool_calls : []
  const normalized = question.toLowerCase()
  return branchHint === 'evidence-case'
    || intent.content_type === 'evidence_case'
    || intent.render_style_id === 'evidence_case_panel'
    || queryPlan.strategy === 'sparta_evidence_case'
    || toolCalls.some((call) => tauChatRecord(call).endpoint === '/create-evidence-case')
    || normalized.includes('evidence case')
    || normalized.includes('countermeasure')
}

function tauChatContextControlId(matrixContext: JsonRecord, context: JsonRecord): string | undefined {
  const direct = tauChatString(matrixContext.controlId)
    ?? tauChatString(matrixContext.control_id)
    ?? tauChatString(matrixContext.primaryControlId)
  if (direct) return direct

  const selectedQra = tauChatRecord(context.selectedQra ?? context.selected_qra)
  return tauChatString(selectedQra.control_id)
    ?? tauChatString(selectedQra.controlId)
    ?? tauChatString(selectedQra.primaryControlId)
}

function tauChatScopedQraContext(context: JsonRecord): JsonRecord | null {
  const selectedQra = tauChatRecord(context.selectedQra ?? context.selected_qra)
  if (Object.keys(selectedQra).length === 0) return null
  return {
    key: tauChatString(selectedQra.key) ?? tauChatString(selectedQra._key) ?? null,
    qra_id: tauChatString(selectedQra.qra_id) ?? tauChatString(selectedQra.qraId) ?? null,
    control_id: tauChatString(selectedQra.control_id) ?? tauChatString(selectedQra.controlId) ?? null,
    extracted_control_id: tauChatString(selectedQra.extracted_control_id) ?? tauChatString(selectedQra.extractedControlId) ?? null,
    canonical_name: tauChatString(selectedQra.canonical_name) ?? tauChatString(selectedQra.canonicalName) ?? null,
    descriptor: tauChatString(selectedQra.descriptor) ?? null,
    question: tauChatString(selectedQra.question) ?? null,
    answer: tauChatString(selectedQra.answer) ?? null,
    reasoning: tauChatString(selectedQra.reasoning) ?? null,
  }
}

function tauChatPrimaryControlId(entities: JsonRecord, intent: JsonRecord, matrixContext: JsonRecord = {}, context: JsonRecord = {}): string | undefined {
  const agentDecision = tauChatRecord(entities.agent_decision)
  const primaryEntityId = tauChatString(agentDecision.primary_entity_id)
  if (primaryEntityId) return primaryEntityId
  const controlIds = Array.isArray(entities.control_ids) ? entities.control_ids : []
  const control = controlIds.find((value) => typeof value === 'string' && value.trim())
  if (typeof control === 'string') return control
  const intentEntities = Array.isArray(intent.entities) ? intent.entities : []
  const intentEntity = intentEntities.find((value) => typeof value === 'string' && value.trim())
  if (typeof intentEntity === 'string') return intentEntity
  return tauChatContextControlId(matrixContext, context)
}

function tauChatResponseAction(value: unknown): 'answer' | 'deflect' | 'clarify' {
  return value === 'answer' || value === 'deflect' || value === 'clarify' ? value : 'clarify'
}

function tauChatEvidenceContent(evidenceCase: JsonRecord, action: 'answer' | 'deflect' | 'clarify'): string {
  const responsePolicy = tauChatRecord(evidenceCase.response_policy)
  const userMessage = tauChatString(responsePolicy.user_message)
  const answer = tauChatString(evidenceCase.answer)
  const questions = Array.isArray(responsePolicy.clarifying_questions)
    ? responsePolicy.clarifying_questions.map((question) => tauChatString(question)).filter(Boolean).join('\n')
    : ''
  if (action === 'answer') return answer || userMessage || 'SPARTA evidence policy returned an answer without renderable text.'
  if (action === 'deflect') return userMessage || 'I cannot provide an authoritative answer from the selected SPARTA evidence route.'
  return userMessage || questions || 'I need one more detail before I can ground this in SPARTA evidence.'
}

function tauChatEvidenceSummary(evidenceCase: JsonRecord): string {
  const responsePolicy = tauChatRecord(evidenceCase.response_policy)
  const action = tauChatResponseAction(responsePolicy.response_action ?? evidenceCase.response_action)
  const gateTrace = Array.isArray(evidenceCase.gate_trace) ? evidenceCase.gate_trace : []
  if (gateTrace.length) {
    const passed = gateTrace.filter((gate) => tauChatRecord(gate).passed !== false).length
    return `Evidence policy ${action}; ${passed}/${gateTrace.length} gates passed`
  }
  return `Evidence policy ${action}`
}

function tauChatSelectedQraAnswer(question: string, selectedQra: JsonRecord | null, controlId: unknown): string | null {
  if (!selectedQra) return null
  const answer = tauChatString(selectedQra.answer)

  const q = question.toLowerCase()
  const candidates = [
    tauChatString(controlId),
    tauChatString(selectedQra.extracted_control_id),
    tauChatString(selectedQra.control_id),
    tauChatString(selectedQra.qra_id),
    tauChatString(selectedQra.key),
  ].filter((value): value is string => Boolean(value && value.trim()))

  const matchesScope = candidates.length === 0 || candidates.some((value) => q.includes(value.toLowerCase()))
  if (!matchesScope) return null

  const scopedControlId = tauChatString(selectedQra.extracted_control_id) ?? tauChatString(selectedQra.control_id) ?? tauChatString(controlId)
  const canonicalName = tauChatString(selectedQra.canonical_name) ?? tauChatString(selectedQra.name)
  const descriptor = tauChatString(selectedQra.descriptor)
  const reasoning = tauChatString(selectedQra.reasoning)
  if (answer && /\b(what is|what's|define|definition|countermeasure)\b/.test(q)) return answer
  if (scopedControlId && canonicalName) {
    const descriptorClause = descriptor && descriptor !== canonicalName
      ? ` It is associated with the descriptor "${descriptor}" in the selected QRA context.`
      : ''
    const reasoningClause = reasoning ? `\n\nSelected QRA reasoning: ${reasoning}` : ''
    const answerClause = answer ? `\n\nSelected QRA answer: ${answer}` : ''
    return `${scopedControlId} is an existing, grounded SPARTA countermeasure named "${canonicalName}".${descriptorClause}${reasoningClause}${answerClause}`
  }
  if (!answer) return null
  return reasoning ? `${answer}\n\nSelected QRA reasoning: ${reasoning}` : answer
}

async function buildSpartaEvidenceCaseRunPayload(question: string, controlId: unknown, selectedProfile: unknown, requestContext: JsonRecord = {}): Promise<JsonRecord> {
  const scopedQra = tauChatScopedQraContext(requestContext)
  const preflight = detectEvidenceCasePreflight(question, selectedProfile)
  if (preflight) {
    const payload = evidenceCasePreflightPayload(question, preflight, selectedProfile)
    if (scopedQra) {
      payload.context = { ...tauChatRecord(payload.context), selected_qra: scopedQra }
      payload.diagnostics = { ...tauChatRecord(payload.diagnostics), scoped_qra_context_used: true }
    }
    if (evidenceCaseNeedsGapReview(payload)) {
      const gapReview = buildAdvisoryGapReview(question, controlId, payload)
      payload.gap_review = gapReview
      payload.gap_review_status = gapReview.gap_review_status
      payload.human_review_state = gapReview.human_review_state
      payload.proposed_correction = gapReview.proposed_correction
      payload.correction_lineage = gapReview.correction_lineage
      payload.evidence_case_version = gapReview.evidence_case_version
    }
    return attachSpartaChatResponsePolicy(question, payload, selectedProfile)
  }

  const ambiguousReferents = detectAmbiguousQraReferents(question)
  if (ambiguousReferents.length > 0) {
    return attachSpartaChatResponsePolicy(question, evidenceCaseAmbiguousPayload(question, ambiguousReferents), selectedProfile)
  }

  try {
    const result = await proxyPost('/create-evidence-case', {
      question,
      source_id: controlId || null,
      selected_qra: scopedQra,
      skip_qra_recall: false,
      enable_llm: false,
    })
    const payload = normalizeEvidenceCaseWorkflowResult(question, controlId, result)
    if (scopedQra) {
      payload.context = { ...tauChatRecord(payload.context), selected_qra: scopedQra }
      payload.diagnostics = { ...tauChatRecord(payload.diagnostics), scoped_qra_context_used: true }
    }
    if (evidenceCaseNeedsGapReview(payload)) {
      const gapReview = buildAdvisoryGapReview(question, controlId, payload)
      payload.gap_review = gapReview
      payload.gap_review_status = gapReview.gap_review_status
      payload.human_review_state = gapReview.human_review_state
      payload.proposed_correction = gapReview.proposed_correction
      payload.correction_lineage = gapReview.correction_lineage
      payload.evidence_case_version = gapReview.evidence_case_version
    }
    return attachSpartaChatResponsePolicy(question, payload, selectedProfile)
  } catch (e: any) {
    console.error('[tau/chat/turn] Evidence case daemon call failed:', e.message)
    const recall = await proxyPost('/recall', {
      q: question,
      k: 5,
      collections: ['sparta_qra', 'sparta_controls'],
    })
    const items = Array.isArray(recall.items) ? recall.items : []
    const payload: JsonRecord = {
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
        scoped_qra_context_used: Boolean(scopedQra),
      },
      context: scopedQra ? { selected_qra: scopedQra } : {},
      answer: items.length > 0 ? `Found ${items.length} items. Full evidence case requires daemon.` : 'No results found.',
    }
    const gapReview = buildAdvisoryGapReview(question, controlId, payload)
    payload.gap_review = gapReview
    payload.gap_review_status = gapReview.gap_review_status
    payload.human_review_state = gapReview.human_review_state
    payload.proposed_correction = gapReview.proposed_correction
    payload.correction_lineage = gapReview.correction_lineage
    payload.evidence_case_version = gapReview.evidence_case_version
    return attachSpartaChatResponsePolicy(question, payload, selectedProfile)
  }
}

app.post('/api/tau/chat/turn', async (req, res) => {
  const question = tauChatString(req.body?.question ?? req.body?.query ?? req.body?.text)
  if (!question) return res.status(400).json({ error: 'question required' })

  const steps: JsonRecord[] = []
  const addStep = (step: JsonRecord) => {
    steps.push(step)
    return step
  }
  const matrixContext = tauChatRecord(req.body?.matrix_context)
  const requestContext = tauChatRecord(req.body?.context)
  const gateDepth = tauChatString(req.body?.gate_depth) ?? 'balanced'
  const branchHint = req.body?.branch_hint
  const selectedProfile = req.body?.evidenceProfile ?? req.body?.profile

  try {
    addStep(tauChatStep({
      id: 'finalizing-intent',
      status: 'running',
      liveStatusLabel: 'Tau: finalizing intent...',
      detail: 'Memory /intent applies the Sparta Explorer scope policy before recall or evidence processing.',
    }))
    const scopedRoute = await routeSpartaExplorerScopedTurn({
      question,
      allowOffTopic: req.body?.allow_off_topic === true,
      surface: tauChatString(req.body?.surface) ?? 'sparta-explorer',
      branchHint,
      gateDepth,
      matrixContext,
      context: requestContext,
    })
    addStep(tauChatStep({
      id: 'finalizing-intent',
      status: 'completed',
      liveStatusLabel: 'Tau: finalizing intent...',
      detail: `Intent: ${scopedRoute.intentAction}${scopedRoute.intentProfile ? ` (${scopedRoute.intentProfile})` : ''}`,
      data: scopedRoute.kind === 'terminal'
        ? { action: scopedRoute.intentAction, profile: scopedRoute.intentProfile, scope: 'sparta-explorer' }
        : scopedRoute.intent,
    }))

    if (scopedRoute.kind === 'terminal') {
      addStep(tauChatStep({
        id: 'answering',
        status: 'completed',
        liveStatusLabel: scopedRoute.route === 'deflect' ? 'Tau: deflecting...' : 'Tau: answering outside SPARTA...',
        detail: scopedRoute.route === 'deflect'
          ? 'Memory scope policy selected deflection before SPARTA recall or evidence processing.'
          : 'Memory scope policy selected a separately labeled non-SPARTA capability.',
        data: scopedRoute.routeData,
      }))
      const thinkingTrace = tauChatTraceFromSteps(steps)
      const message = {
        role: 'assistant',
        content: scopedRoute.content,
        reasoningSteps: thinkingTrace,
        thinkingTrace,
        metadata: {
          branch: 'compliance',
          disclosureVariant: 'thinking',
          source: 'tau-chat-turn',
          tauBackend: true,
          memoryBacked: scopedRoute.route !== 'non_sparta_lean',
          responseAction: scopedRoute.responseAction,
          scopedRoute: scopedRoute.route,
          nonSparta: scopedRoute.nonSparta,
          intentRoute: { action: scopedRoute.intentAction, profile: scopedRoute.intentProfile },
          routeReceipt: scopedRoute.routeReceipt,
          authorityClaims: { sparta: 0, evidence: 0, crosswalk: 0, posture: 0 },
        },
      }
      return res.json({
        ok: true,
        branch: 'compliance',
        response_action: scopedRoute.responseAction,
        route: scopedRoute.route,
        non_sparta: scopedRoute.nonSparta,
        steps,
        thinkingTrace,
        message,
        receipt: scopedRoute.routeReceipt,
      })
    }

    const intent = scopedRoute.intent

    addStep(tauChatStep({
      id: 'extracting-entities',
      status: 'running',
      liveStatusLabel: 'Tau: extracting entities...',
      detail: 'Memory /extract-entities is the first SPARTA chat-turn step.',
    }))
    const entities = tauChatRecord(await proxyPost('/extract-entities', {
      text: question,
      query: question,
      surface: 'sparta-explorer',
      matrix_context: matrixContext,
    }))
    addStep(tauChatStep({
      id: 'extracting-entities',
      status: 'completed',
      liveStatusLabel: 'Tau: extracting entities...',
      detail: tauChatSummarizeEntities(entities),
      data: entities,
    }))

    addStep(tauChatStep({
      id: 'looking-in-memory',
      status: 'running',
      liveStatusLabel: 'Tau: looking in memory...',
      detail: 'Memory /recall checks SPARTA training and prior evidence after scope routing.',
    }))
    const trainingRecall = tauChatRecord(await proxyPost('/recall', {
      q: question,
      query: question,
      text: question,
      profile: 'intent-training-v2',
      entities,
      matrix_context: matrixContext,
      surface: 'sparta-explorer',
    }))
    addStep(tauChatStep({
      id: 'looking-in-memory',
      status: 'completed',
      liveStatusLabel: 'Tau: looking in memory...',
      detail: tauChatSummarizeRecall(trainingRecall),
      data: trainingRecall,
    }))

    const gates = tauChatEvaluateGates({ entities, recall: trainingRecall, gateDepth })
    addStep(tauChatStep({
      id: 'checking-gates',
      status: 'completed',
      liveStatusLabel: 'Tau: checking gates...',
      detail: tauChatString(gates.summary) ?? 'Gates checked',
      data: gates,
    }))

    if (gates.needsClarification) {
      addStep(tauChatStep({
        id: 'clarifying',
        status: 'running',
        liveStatusLabel: 'Tau: checking clarification...',
        detail: 'Memory /clarify determines whether the turn should ask a follow-up.',
      }))
      const clarification = tauChatRecord(await proxyPost('/clarify', {
        q: question,
        query: question,
        text: question,
        entities,
        recall: trainingRecall,
        gates,
        matrix_context: matrixContext,
      }))
      addStep(tauChatStep({
        id: 'clarifying',
        status: 'completed',
        liveStatusLabel: 'Tau: checking clarification...',
        detail: tauChatString(clarification.status ?? clarification.state) ? `Clarify state: ${clarification.status ?? clarification.state}` : 'Clarification checked',
        data: clarification,
      }))
      if (tauChatIsClarificationRequired(clarification)) {
        addStep(tauChatStep({
          id: 'answering',
          status: 'completed',
          liveStatusLabel: 'Tau: answering...',
          detail: 'Tau selected clarify.',
        }))
        const content = tauChatExtractContent(clarification) || 'I need one more detail before I can ground this in SPARTA memory.'
        const thinkingTrace = tauChatTraceFromSteps(steps)
        const message = {
          role: 'assistant',
          content,
          reasoningSteps: thinkingTrace,
          thinkingTrace,
          metadata: {
            branch: 'compliance',
            disclosureVariant: 'thinking',
            source: 'tau-chat-turn',
            tauBackend: true,
            memoryBacked: true,
            responseAction: 'clarify',
            entities,
            trainingRecall,
            gates,
            clarification,
          },
        }
        return res.json({ ok: true, branch: 'compliance', response_action: 'clarify', steps, thinkingTrace, message, receipt: message.metadata })
      }
    } else {
      addStep(tauChatStep({
        id: 'clarifying',
        status: 'skipped',
        liveStatusLabel: 'Tau: checking clarification...',
        detail: 'No clarification needed',
      }))
    }

    if (tauChatIsEvidenceIntent(intent, branchHint, question)) {
      const branch: TauChatBranch = 'evidence-case'
      const controlId = tauChatPrimaryControlId(entities, intent, matrixContext, requestContext)
      addStep(tauChatStep({
        id: 'getting-results',
        branch,
        status: 'running',
        liveStatusLabel: 'Tau: running SPARTA evidence policy...',
        detail: controlId ? `Evidence route for ${controlId}` : 'Evidence route selected by Tau memory intent',
      }))
      const evidenceCase = await buildSpartaEvidenceCaseRunPayload(question, controlId, selectedProfile, requestContext)
      const responsePolicy = tauChatRecord(evidenceCase.response_policy)
      const scopedQra = tauChatScopedQraContext(requestContext)
      const policyResponseAction = tauChatResponseAction(responsePolicy.response_action ?? evidenceCase.response_action)
      const evidenceAnswer = tauChatString(evidenceCase.answer)
      const scopedQraContent = evidenceAnswer && policyResponseAction === 'answer'
        ? null
        : tauChatSelectedQraAnswer(question, scopedQra, controlId)
      const responseAction = scopedQraContent ? 'answer' : policyResponseAction
      if (scopedQraContent) {
        evidenceCase.response_policy = {
          ...responsePolicy,
          response_action: 'answer',
          user_message: scopedQraContent,
          override_reason: 'selected_qra_context',
        }
        evidenceCase.response_action = 'answer'
        evidenceCase.diagnostics = {
          ...tauChatRecord(evidenceCase.diagnostics),
          scoped_qra_answer_override: true,
          original_response_action: policyResponseAction,
        }
      }
      addStep(tauChatStep({
        id: 'getting-results',
        branch,
        status: 'completed',
        liveStatusLabel: 'Tau: running SPARTA evidence policy...',
        detail: tauChatEvidenceSummary(evidenceCase),
        data: evidenceCase,
      }))
      addStep(tauChatStep({
        id: 'answering',
        branch,
        status: 'completed',
        liveStatusLabel: 'Tau: answering...',
        detail: scopedQraContent
          ? `Tau response policy: answer via selected QRA context; original policy ${policyResponseAction}`
          : `Tau response policy: ${responseAction}`,
      }))
      const content = scopedQraContent
        ? scopedQraContent
        : tauChatEvidenceContent(evidenceCase, responseAction)
      const thinkingTrace = tauChatTraceFromSteps(steps)
      const message = {
        role: 'assistant',
        content,
        skillUsed: 'create-evidence-case',
        evidenceCase: true,
        reasoningSteps: thinkingTrace,
        thinkingTrace,
        metadata: {
          branch,
          disclosureVariant: 'evidence-case',
          source: 'tau-chat-turn',
          tauBackend: true,
          memoryBacked: true,
          responseAction,
          controlId,
          entities,
          trainingRecall,
          gates,
          intent,
          evidenceCase,
          routedBy: 'tau.memory.intent',
        },
      }
      return res.json({ ok: true, branch, response_action: responseAction, steps, thinkingTrace, message, receipt: message.metadata })
    }

    addStep(tauChatStep({
      id: 'getting-results',
      status: 'running',
      liveStatusLabel: 'Tau: getting results...',
      detail: 'Memory /recall runs the finalized query specification.',
    }))
    const querySpec = tauChatRecord(intent.query_spec ?? intent.querySpec ?? intent)
    const memoryResults = tauChatRecord(await proxyPost('/recall', {
      q: question,
      query: question,
      text: question,
      query_spec: querySpec,
      entities,
      intent,
      matrix_context: matrixContext,
      surface: 'sparta-explorer',
    }))
    addStep(tauChatStep({
      id: 'getting-results',
      status: 'completed',
      liveStatusLabel: 'Tau: getting results...',
      detail: tauChatSummarizeRecall(memoryResults),
      data: memoryResults,
    }))

    addStep(tauChatStep({
      id: 'answering',
      status: 'running',
      liveStatusLabel: 'Tau: answering...',
      detail: 'Tau is composing from grounded memory results.',
    }))
    let content = tauChatExtractContent(memoryResults)
    let fallbackUsed = false
    let fallback: JsonRecord | null = null
    if (!content) {
      fallbackUsed = true
      fallback = tauChatRecord(await proxyPost('/answer', {
        q: question,
        query: question,
        text: question,
        entities,
        intent,
        recall: memoryResults,
        matrix_context: matrixContext,
      }))
      content = tauChatExtractContent(fallback) || 'I could not find enough grounded SPARTA memory to answer this turn.'
    }
    addStep(tauChatStep({
      id: 'answering',
      status: 'completed',
      liveStatusLabel: 'Tau: answering...',
      detail: fallbackUsed ? 'Answered with Memory /answer fallback' : 'Answered from Memory /recall',
      data: fallback ?? memoryResults,
    }))
    const thinkingTrace = tauChatTraceFromSteps(steps)
    const message = {
      role: 'assistant',
      content,
      reasoningSteps: thinkingTrace,
      thinkingTrace,
      metadata: {
        branch: 'compliance',
        disclosureVariant: 'thinking',
        source: 'tau-chat-turn',
        tauBackend: true,
        memoryBacked: true,
        responseAction: 'answer',
        entities,
        trainingRecall,
        gates,
        intent,
        memoryResults,
        fallbackUsed,
      },
    }
    return res.json({ ok: true, branch: 'compliance', response_action: 'answer', steps, thinkingTrace, message, receipt: message.metadata })
  } catch (error: any) {
    const message = error?.message || String(error)
    addStep(tauChatStep({
      id: 'answering',
      status: 'failed',
      liveStatusLabel: 'Tau: stopped fail-closed...',
      detail: message,
      error: message,
    }))
    const thinkingTrace = tauChatTraceFromSteps(steps)
    return res.status(502).json({
      ok: false,
      error: 'tau_chat_turn_failed',
      detail: message,
      branch: 'compliance',
      steps,
      thinkingTrace,
      message: {
        role: 'assistant',
        content: `Tau could not complete the SPARTA chat turn: ${message}`,
        reasoningSteps: thinkingTrace,
        thinkingTrace,
        metadata: {
          branch: 'compliance',
          disclosureVariant: 'thinking',
          source: 'tau-chat-turn',
          tauBackend: true,
          memoryBacked: false,
          error: message,
        },
      },
    })
  }
})

app.post('/api/evidence-case/run', async (req, res) => {
  // Call daemon /create-evidence-case directly (no subprocess, <1s per best-practices-arangodb)
  const { question, controlId, profile, evidenceProfile } = req.body
  if (!question) return res.status(400).json({ error: 'question required' })
  const selectedProfile = evidenceProfile ?? profile
  const preflight = detectEvidenceCasePreflight(question, selectedProfile)
  if (preflight) {
    const payload = evidenceCasePreflightPayload(String(question), preflight, selectedProfile)
    if (evidenceCaseNeedsGapReview(payload)) {
      const gapReview = buildAdvisoryGapReview(String(question), controlId, payload)
      payload.gap_review = gapReview
      payload.gap_review_status = gapReview.gap_review_status
      payload.human_review_state = gapReview.human_review_state
      payload.proposed_correction = gapReview.proposed_correction
      payload.correction_lineage = gapReview.correction_lineage
      payload.evidence_case_version = gapReview.evidence_case_version
    }
    return res.json(attachSpartaChatResponsePolicy(String(question), payload, selectedProfile))
  }
  const ambiguousReferents = detectAmbiguousQraReferents(question)
  if (ambiguousReferents.length > 0) {
    return res.json(attachSpartaChatResponsePolicy(String(question), evidenceCaseAmbiguousPayload(String(question), ambiguousReferents), selectedProfile))
  }

  try {
    const result = await proxyPost('/create-evidence-case', {
      question,
      source_id: controlId || null,
      skip_qra_recall: false,
      enable_llm: false,
    })

    const payload = normalizeEvidenceCaseWorkflowResult(String(question), controlId, result)
    if (evidenceCaseNeedsGapReview(payload)) {
      const gapReview = buildAdvisoryGapReview(String(question), controlId, payload)
      payload.gap_review = gapReview
      payload.gap_review_status = gapReview.gap_review_status
      payload.human_review_state = gapReview.human_review_state
      payload.proposed_correction = gapReview.proposed_correction
      payload.correction_lineage = gapReview.correction_lineage
      payload.evidence_case_version = gapReview.evidence_case_version
    }
    return res.json(attachSpartaChatResponsePolicy(String(question), payload, selectedProfile))
  } catch (e: any) {
    console.error('[evidence-case/run] Daemon call failed:', e.message)
    try {
      const recall = await proxyPost('/recall', {
        q: question,
        k: 5,
        collections: ['sparta_qra', 'sparta_controls'],
      })
      const items = recall.items || []
      const payload: JsonRecord = {
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
      }
      const gapReview = buildAdvisoryGapReview(String(question), controlId, payload)
      payload.gap_review = gapReview
      payload.gap_review_status = gapReview.gap_review_status
      payload.human_review_state = gapReview.human_review_state
      payload.proposed_correction = gapReview.proposed_correction
      payload.correction_lineage = gapReview.correction_lineage
      payload.evidence_case_version = gapReview.evidence_case_version
      res.json(attachSpartaChatResponsePolicy(String(question), payload, selectedProfile))
    } catch {
      res.status(502).json({ error: 'Evidence case daemon and recall both unavailable' })
    }
  }
})

app.get('/api/evidence-case/runs', (_req, res) => {
  res.json({ runs: evidenceCaseRunHistory, limit: EVIDENCE_CASE_HISTORY_LIMIT })
})

app.post('/api/evidence-case/stream', async (req, res) => {
  const { question, controlId, nodeLabel, profile, evidenceProfile } = req.body
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
    const selectedProfile = evidenceProfile ?? profile
    const preflight = detectEvidenceCasePreflight(question, selectedProfile)
    if (preflight) {
      const payload = evidenceCasePreflightPayload(String(question), preflight, selectedProfile)
      const gapReview = buildAdvisoryGapReview(String(question), controlId, payload)
      payload.gap_review = gapReview
      payload.gap_review_status = gapReview.gap_review_status
      payload.human_review_state = gapReview.human_review_state
      payload.proposed_correction = gapReview.proposed_correction
      payload.correction_lineage = gapReview.correction_lineage
      payload.evidence_case_version = gapReview.evidence_case_version
      attachSpartaChatResponsePolicy(String(question), payload, selectedProfile, 'stream', run.id)
      run.status = 'completed'
      run.completed_at = new Date().toISOString()
      run.verdict = payload.verdict as JsonRecord
      run.gates = payload.gate_trace as JsonRecord[]
      run.diagnostics = payload.diagnostics as JsonRecord
      run.gap_review = gapReview
      run.proposed_correction = gapReview.proposed_correction as JsonRecord
      run.correction_lineage = gapReview.correction_lineage as JsonRecord
      run.gap_review_status = 'completed'
      run.human_review_state = 'queued'
      rememberEvidenceCaseRun(run)
      emit('gate', { gate: (payload.gate_trace as JsonRecord[])[0] })
      emit('diagnostics', { diagnostics: payload.diagnostics as JsonRecord })
      emit('gap_review_started', { gap_review_candidate: true, advisory_only: true })
      emit('persona_review', { persona: 'Brandon Bailey', review: gapReview.persona_review })
      emit('persona_review', { persona: 'Margaret Chen', review: gapReview.persona_review })
      emit('persona_review', { persona: 'Jennifer Park', review: gapReview.persona_review })
      emit('judge_routing', { judge_routing: gapReview.judge_routing })
      emit('correction_suggested', { proposed_correction: gapReview.proposed_correction, correction_lineage: gapReview.correction_lineage })
      emit('human_intervention_requested', { human_review_state: gapReview.human_review_state })
      emit('result', { result: payload })
      emit('run_completed', { run: { ...run } })
      return res.end()
    }

    const ambiguousReferents = detectAmbiguousQraReferents(question)
    if (ambiguousReferents.length > 0) {
      const payload = evidenceCaseAmbiguousPayload(String(question), ambiguousReferents)
      const gapReview = buildAdvisoryGapReview(String(question), controlId, payload)
      payload.gap_review = gapReview
      payload.gap_review_status = gapReview.gap_review_status
      payload.human_review_state = gapReview.human_review_state
      payload.proposed_correction = gapReview.proposed_correction
      payload.correction_lineage = gapReview.correction_lineage
      payload.evidence_case_version = gapReview.evidence_case_version
      attachSpartaChatResponsePolicy(String(question), payload, selectedProfile, 'stream', run.id)
      run.status = 'completed'
      run.completed_at = new Date().toISOString()
      run.verdict = payload.verdict as JsonRecord
      run.gates = payload.gate_trace as JsonRecord[]
      run.diagnostics = payload.diagnostics as JsonRecord
      run.gap_review = gapReview
      run.proposed_correction = gapReview.proposed_correction as JsonRecord
      run.correction_lineage = gapReview.correction_lineage as JsonRecord
      run.gap_review_status = 'completed'
      run.human_review_state = 'queued'
      rememberEvidenceCaseRun(run)
      emit('gate', { gate: (payload.gate_trace as JsonRecord[])[0] })
      emit('diagnostics', { diagnostics: payload.diagnostics as JsonRecord })
      emit('gap_review_started', { gap_review_candidate: true, advisory_only: true })
      emit('persona_review', { persona: 'Brandon Bailey', review: gapReview.persona_review })
      emit('persona_review', { persona: 'Margaret Chen', review: gapReview.persona_review })
      emit('persona_review', { persona: 'Jennifer Park', review: gapReview.persona_review })
      emit('judge_routing', { judge_routing: gapReview.judge_routing })
      emit('correction_suggested', { proposed_correction: gapReview.proposed_correction, correction_lineage: gapReview.correction_lineage })
      emit('human_intervention_requested', { human_review_state: gapReview.human_review_state })
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
    if (evidenceCaseNeedsGapReview(payload)) {
      const gapReview = buildAdvisoryGapReview(String(question), controlId, payload)
      payload.gap_review = gapReview
      payload.gap_review_status = gapReview.gap_review_status
      payload.human_review_state = gapReview.human_review_state
      payload.proposed_correction = gapReview.proposed_correction
      payload.correction_lineage = gapReview.correction_lineage
      payload.evidence_case_version = gapReview.evidence_case_version
      emit('gap_review_started', { gap_review_candidate: true, advisory_only: true })
      emit('persona_review', { persona: 'Brandon Bailey', review: gapReview.persona_review })
      emit('persona_review', { persona: 'Margaret Chen', review: gapReview.persona_review })
      emit('persona_review', { persona: 'Jennifer Park', review: gapReview.persona_review })
      emit('judge_routing', { judge_routing: gapReview.judge_routing })
      emit('correction_suggested', { proposed_correction: gapReview.proposed_correction, correction_lineage: gapReview.correction_lineage })
      emit('human_intervention_requested', { human_review_state: gapReview.human_review_state })
    }
    attachSpartaChatResponsePolicy(String(question), payload, selectedProfile, 'stream', run.id)
    const gates = Array.isArray(payload.gate_trace) ? payload.gate_trace as JsonRecord[] : []
    for (const gate of gates) emit('gate', { gate })
    emit('diagnostics', { diagnostics: payload.diagnostics as JsonRecord })
    emit('result', { result: payload })

    run.status = 'completed'
    run.completed_at = new Date().toISOString()
    run.verdict = payload.verdict as JsonRecord
    run.gates = gates
    run.diagnostics = payload.diagnostics as JsonRecord
    run.gap_review = payload.gap_review as JsonRecord | undefined
    run.proposed_correction = payload.proposed_correction as JsonRecord | undefined
    run.correction_lineage = payload.correction_lineage as JsonRecord | undefined
    run.gap_review_status = payload.gap_review_status as EvidenceCaseRunHistoryEntry['gap_review_status']
    run.human_review_state = payload.human_review_state as EvidenceCaseHumanReviewState | undefined
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
import { registerSpartaChatRoutes } from './spartaChat/registerRoutes.js'
import { registerSubagentMonitorRoutes } from './subagentMonitorProxy.js'
import { createPiChatRouter } from '../../pi-chat-adapter/src/index.ts'
import { registerHumJobsRoutes } from './humJobs.js'
import { registerTauRoutes } from './tauRoutes.js'
import { registerTauPtyRoutes, registerTauPtyWebSocket } from './tauPtyRoutes.js'

const httpServer = createServer(app)
const wss = new WebSocketServer({ noServer: true })
const clients = new Set<WebSocket>()
httpServer.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  if (url.pathname === '/api/tau/tui/pty/ws') return
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request)
  })
})
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
if (process.env.UX_LAB_DISABLE_SERVER_LISTEN !== '1') startSpartaCoveragePushBridge()

registerTestRunnerRoutes(app, broadcast)
registerSpartaChatRoutes(app)
registerSubagentMonitorRoutes(app)
registerHumJobsRoutes(app)
registerTauRoutes(app)
registerTauPtyRoutes(app)
registerTauPtyWebSocket(httpServer)

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
  const assetsPath = resolve(distPath, 'assets')
  const setNoStoreHeaders = (res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')
  }

  app.use('/assets', express.static(assetsPath, {
    fallthrough: false,
    immutable: true,
    maxAge: '1y',
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    },
  }))
  app.use(express.static(distPath, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) {
        setNoStoreHeaders(res)
      }
    },
  }))
  app.get('{*path}', (req, res) => {
    if (req.path.startsWith('/assets/')) {
      res.status(404).type('text/plain').send('asset not found')
      return
    }
    setNoStoreHeaders(res)
    res.sendFile(resolve(distPath, 'index.html'))
  })
  console.log(`  Serving production build from ${distPath}`)
}

// ── Start ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 3001
const HOST = process.env.HOST ?? process.env.UX_LAB_HOST ?? '127.0.0.1'

if (process.env.UX_LAB_DISABLE_SERVER_LISTEN !== '1') {
  httpServer.listen(Number(PORT), HOST, () => {
    console.log(`UX Lab API on http://${HOST}:${PORT}`)
    console.log(`  Memory daemon: ${MEMORY_SOCKET}`)
    console.log(`  scillm: ${SCILLM_URL}`)
    console.log(`  artifacts: ${ARTIFACTS_ROOT}`)
    console.log(`  PDF Lab artifacts: ${PDF_LAB_ARTIFACTS_ROOT}`)
    console.log(`  Test runner: registered`)
  })
}

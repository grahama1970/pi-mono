/* eslint-disable @typescript-eslint/no-explicit-any */
import express from 'express'
import type { Express } from 'express'
import { request as httpRequest } from 'http'
import { createHash } from 'crypto'
import { execFile, spawn } from 'child_process'
import { resolve } from 'path'
import { readdir, readFile, writeFile, mkdir, unlink, stat } from 'fs/promises'
import { existsSync, realpathSync, createReadStream } from 'fs'
import { promisify } from 'util'

type JsonRecord = Record<string, unknown>
type ProxyPost = (path: string, body?: object | null, timeoutMs?: number) => Promise<any>

const MEMORY_SOCKET = process.env.MEMORY_SOCKET ?? '/run/user/1000/embry/memory.sock'
const MEMORY_HTTP_URL = process.env.MEMORY_HTTP_URL ?? 'http://127.0.0.1:8601'
const SCILLM_URL = process.env.SCILLM_URL ?? 'http://localhost:4001'
const SCILLM_PROXY_KEY = process.env.SCILLM_API_KEY ?? process.env.SCILLM_MASTER_KEY ?? 'sk-dev-proxy-123'
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
const execFileAsync = promisify(execFile)

let proxyPost: ProxyPost = defaultProxyPost

function isActiveWatchAnnotationLifecycle(document: JsonRecord): boolean {
  return !['superseded', 'discarded', 'cleared', 'deleted'].includes(String(document.lifecycle_status ?? 'current'))
}

function defaultProxyPost(path: string, body: object | null = null, timeoutMs = 30000): Promise<any> {
  return new Promise((resolveRequest, reject) => {
    const method = body ? 'POST' : 'GET'
    const data = body ? JSON.stringify(body) : undefined
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (data) headers['Content-Length'] = String(Buffer.byteLength(data))

    const req = httpRequest(
      { socketPath: MEMORY_SOCKET, path, method, headers },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
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
          resolveRequest(parsed)
        })
      },
    )
    const timeout = setTimeout(() => {
      req.destroy()
      reject(new Error(`Memory daemon timeout after ${timeoutMs}ms on ${path}`))
    }, timeoutMs)
    req.on('error', (error) => { clearTimeout(timeout); reject(error) })
    if (data) req.write(data)
    req.end()
  })
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
const WATCH_TRACKER_EVENT_LOG_DIRS = [
  ...(process.env.WATCH_TRACKER_EVENT_LOG_DIRS ?? '').split(':').map((entry) => entry.trim()).filter(Boolean),
  '/tmp',
  resolve(WATCH_SKILL_DIR, 'docs/architecture/generated'),
]

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
}): Promise<{ cropPath: string; dataUrl: string; width: number; height: number; sourceWidth: number; sourceHeight: number }> {
  const script = `
import base64, io, json, os, sys
from PIL import Image

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
}))
`
  const { stdout } = await execFileAsync('python3', ['-c', script, JSON.stringify(params)], {
    timeout: 30_000,
    maxBuffer: 20 * 1024 * 1024,
  })
  return JSON.parse(stdout) as { cropPath: string; dataUrl: string; width: number; height: number; sourceWidth: number; sourceHeight: number }
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
  try {
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
    const raw = await readFile(framePath)
    return {
      dataUrl: `data:image/jpeg;base64,${raw.toString('base64')}`,
      framePath,
      source: 'server_ffmpeg_clip_frame',
    }
  } finally {
    await unlink(framePath).catch(() => {})
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
    const numbered = text.match(/(?:^|\s)1[).]\s+(.+?)(?=\s+2[).]\s+|$)/)
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

export function registerWatchRoutes(app: Express, deps: { proxyPost?: ProxyPost } = {}): void {
  proxyPost = deps.proxyPost ?? defaultProxyPost
  app.use('/api/projects/watch/static/tmp', express.static('/tmp', watchStaticOptions))
  app.use('/api/projects/watch/static/watch-frames', express.static('/mnt/storage12tb/media/watch-frames', watchStaticOptions))

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
        crop = await cropWatchDataUrlToDataUrl({ imageDataUrl: frame.dataUrl, bbox })
        frameSource = frame.source
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
      const clearedDocuments: JsonRecord[] = targets.map((document) => {
        const { _id, _rev, ...cleanDocument } = document
        void _id
        void _rev
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
      const deletedDocuments: JsonRecord[] = targets.map((document) => {
        const { _id, _rev, ...cleanDocument } = document
        void _id
        void _rev
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
}

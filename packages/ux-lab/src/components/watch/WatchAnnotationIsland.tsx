import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Move, Pause, Pencil, Play, Trash2 } from 'lucide-react'
import {
  characterKey,
  clamp01,
  appendTrackControlLocally,
  createWatchAnnotationSession,
  deleteExactSelectedKeyframeLocally,
  deriveWatchAnnotationOverlays,
  findExactSelectedKeyframe,
  normalizeBbox,
  normalizeCharacterOptions,
  replaceCanonicalFromHydration,
  rowSegmentDurationSeconds,
  secondsToClock,
  selectedCurrentOverlay,
  selectOverlay,
  setPlayheadSeconds,
  setSelectedCharacter,
  trackStats,
  updateKeyframeBbox,
  upsertHumanKeyframe,
} from './watchAnnotationSession'
import type {
  NormalizedBbox,
  WatchAnnotationCharacterOption,
  WatchAnnotationKeyframe,
  WatchAnnotationOverlay,
  WatchAnnotationSceneRow,
  WatchAnnotationSessionState,
} from './watchAnnotationSession'

type WatchAnnotationTrack = WatchAnnotationSessionState['tracks'][string]

interface MutationReceipt {
  ok?: boolean
  error?: string
  detail?: string
  receipt_path?: string
  [key: string]: unknown
}

export interface WatchAnnotationIslandProps {
  row: WatchAnnotationSceneRow
  reportTitle?: string
  assetUid?: string
  videoSrc?: string
  thumbnailSrc?: string | null
  characters?: Array<string | WatchAnnotationCharacterOption>
  actorByCharacter?: Record<string, string>
  actorForCharacter?: (name: string) => string | null
  onClose?: () => void
}

type DragHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

interface PointerPoint {
  x: number
  y: number
}

interface ManipulationState {
  pointerId: number
  mode: 'move' | 'resize'
  handle?: DragHandle
  keyframeId: string
  createsKeyframe: boolean
  pendingTarget?: boolean
  characterName: string
  actorName: string
  timeSeconds: number
  startBbox: NormalizedBbox
  latestBbox: NormalizedBbox
  startPoint: PointerPoint
}

interface PendingOverlayPointer {
  pointerId: number
  overlay: WatchAnnotationOverlay
  startPoint: PointerPoint
}

type DetectorCandidateRuntimePolicy = 'exact' | 'interpolated' | 'held'

interface DetectorCandidate {
  id: string
  trackId: string
  detectedClass: string
  bbox: NormalizedBbox
  timeSeconds: number
  mediaTimeSeconds?: number | null
  confidence?: number | null
  runtimePolicy?: DetectorCandidateRuntimePolicy
  sourceCandidateIds?: string[]
  sourceTimeSeconds?: number[]
}

interface DetectorCandidateAssignment {
  characterName: string
  actorName: string
  source: 'pending' | 'saved' | 'propagated' | 'suggested'
  keyframe?: WatchAnnotationKeyframe
  confidence?: number
  evidenceCount?: number
  originTrackId?: string
}

interface DetectorLabelRejection {
  trackId: string
  characterName: string
  actorName: string
  source: 'propagated' | 'suggested' | 'saved' | 'pending'
  createdAt: string
}

interface DetectorTrackAssignmentDocument {
  key: string
  id?: string
  boxId?: string
  annotationUid?: string
  characterName: string
  actorName: string
  timeSeconds: number
}

interface DetectorCandidatePayload {
  schema?: string
  candidates?: Array<{
    id?: string
    track_id?: string
    detected_class?: string
    bbox?: unknown
    time_seconds?: number
    media_time_seconds?: number | null
    confidence?: number | null
  }>
  total?: number
}

interface DetectorObservationRefPayload {
  source: 'watch_annotation_island_yolo_candidate'
  link_quality: 'human_selected_yolo_track'
  track_id: string
  detector_candidate_id: string
  detected_class: string
  bbox: NormalizedBbox
  time_seconds: number
  media_time_seconds?: number | null
  confidence?: number | null
  runtime_policy?: DetectorCandidateRuntimePolicy
  source_detector_candidate_ids?: string[]
  source_time_seconds?: number[]
  human_bbox?: NormalizedBbox
}

interface DetectorSuggestionPayload {
  ok?: boolean
  error?: string
  detail?: string
  suggestion?: {
    character_name?: string
    actor_name?: string
    confidence?: number
    best_score?: number
    neighbor_count?: number
  } | null
}

interface IdentityReadinessEntry {
  character_name: string
  actor_name?: string
  accepted_count: number
  embedded_count: number
  detector_link_count: number
  rejected_count: number
  row_count: number
  track_count: number
  progress: number
  ready_for_suggestion: boolean
  missing?: string[]
}

interface IdentityReadinessPayload {
  schema?: string
  error?: string
  detail?: string
  thresholds?: {
    accepted_minimum?: number
    embedded_minimum?: number
    row_minimum?: number
    track_minimum?: number
  }
  characters?: IdentityReadinessEntry[]
  ready_character_count?: number
  character_count?: number
  auto_suggest_readiness?: {
    ready?: boolean
    evaluated_count?: number
    pass_count?: number
    fail_count?: number
    accuracy?: number
    detector_linked_example_count?: number
    detector_linked_evaluated_count?: number
  } | null
  strict_yolo_linked_readiness?: {
    ready?: boolean
    ready_character_count?: number
    character_count?: number
    detector_linked_minimum?: number
    missing?: Array<{
      character_name?: string
      detector_link_count?: number
      missing_detector_linked_label_count?: number
    }>
  } | null
}

function detectorCandidateLabelKey(candidate: DetectorCandidate, characterName: string): string {
  return `${candidate.trackId}:${characterKey(characterName)}`
}

function detectorBaseLabel(candidate: DetectorCandidate): string {
  return `YOLO ${candidate.trackId}`
}

function detectorAssignmentLabel(candidate: DetectorCandidate, assignment?: DetectorCandidateAssignment): string {
  if (!assignment) return detectorBaseLabel(candidate)
  if (assignment.source === 'pending') return 'New target'
  if (assignment.source === 'suggested') {
    const confidence = typeof assignment.confidence === 'number' ? ` ${assignment.confidence.toFixed(2)}` : ''
    return `${assignment.characterName}?${confidence}`
  }
  return assignment.characterName
}

const DETECTOR_TRACK_MATERIALIZATION_MAX_EXAMPLES = 24
const DETECTOR_TRACK_MATERIALIZATION_MIN_SPACING_SECONDS = 0.25
const DETECTOR_TRACK_MATERIALIZATION_SAMPLE_SECONDS = 0.5
const DETECTOR_TRACK_MATERIALIZATION_MAX_INTERPOLATION_GAP_SECONDS = 1.0

function detectorRuntimeCandidate(candidate: DetectorCandidate, runtimePolicy: DetectorCandidateRuntimePolicy): DetectorCandidate {
  return {
    ...candidate,
    runtimePolicy,
    sourceCandidateIds: candidate.sourceCandidateIds || [candidate.id],
    sourceTimeSeconds: candidate.sourceTimeSeconds || [candidate.timeSeconds],
  }
}

function interpolateDetectorBbox(previous: NormalizedBbox, next: NormalizedBbox, ratio: number): NormalizedBbox {
  const t = clamp01(ratio)
  return [
    previous[0] + (next[0] - previous[0]) * t,
    previous[1] + (next[1] - previous[1]) * t,
    previous[2] + (next[2] - previous[2]) * t,
    previous[3] + (next[3] - previous[3]) * t,
  ]
}

function interpolateDetectorCandidate(
  rowIndex: number,
  previous: DetectorCandidate,
  next: DetectorCandidate,
  timeSeconds: number,
): DetectorCandidate {
  const gap = next.timeSeconds - previous.timeSeconds
  const ratio = gap > 0 ? (timeSeconds - previous.timeSeconds) / gap : 0
  const previousMediaTime = typeof previous.mediaTimeSeconds === 'number' ? previous.mediaTimeSeconds : null
  const nextMediaTime = typeof next.mediaTimeSeconds === 'number' ? next.mediaTimeSeconds : null
  const mediaTimeSeconds = previousMediaTime !== null && nextMediaTime !== null
    ? previousMediaTime + (nextMediaTime - previousMediaTime) * clamp01(ratio)
    : null
  const previousConfidence = typeof previous.confidence === 'number' ? previous.confidence : null
  const nextConfidence = typeof next.confidence === 'number' ? next.confidence : null
  const confidence = previousConfidence !== null && nextConfidence !== null
    ? Math.min(previousConfidence, nextConfidence)
    : previousConfidence ?? nextConfidence
  return {
    id: `detector-runtime:${rowIndex}:${previous.trackId}:${timeSeconds.toFixed(3)}`,
    trackId: previous.trackId,
    detectedClass: previous.detectedClass || next.detectedClass,
    bbox: interpolateDetectorBbox(previous.bbox, next.bbox, ratio),
    timeSeconds,
    mediaTimeSeconds,
    confidence,
    runtimePolicy: 'interpolated',
    sourceCandidateIds: [previous.id, next.id],
    sourceTimeSeconds: [previous.timeSeconds, next.timeSeconds],
  }
}

function roundedDetectorTimeSeconds(timeSeconds: number): number {
  return Number(timeSeconds.toFixed(3))
}

function detectorCandidateTimeKey(candidate: DetectorCandidate): string {
  return `${candidate.trackId}:${roundedDetectorTimeSeconds(candidate.timeSeconds).toFixed(3)}`
}

function interpolatedDetectorCandidatesForTrack(rowIndex: number, sameTrack: DetectorCandidate[]): DetectorCandidate[] {
  const interpolated: DetectorCandidate[] = []
  if (sameTrack.length < 2) return interpolated
  const firstTime = sameTrack[0].timeSeconds
  const lastTime = sameTrack[sameTrack.length - 1].timeSeconds
  let sampleTime = Math.ceil(firstTime / DETECTOR_TRACK_MATERIALIZATION_SAMPLE_SECONDS) * DETECTOR_TRACK_MATERIALIZATION_SAMPLE_SECONDS
  let cursor = 0
  while (sampleTime <= lastTime) {
    while (cursor < sameTrack.length - 2 && sameTrack[cursor + 1].timeSeconds < sampleTime) {
      cursor += 1
    }
    const previous = sameTrack[cursor]
    const next = sameTrack[cursor + 1]
    if (!previous || !next || previous.id === next.id) {
      sampleTime += DETECTOR_TRACK_MATERIALIZATION_SAMPLE_SECONDS
      continue
    }
    const gap = next.timeSeconds - previous.timeSeconds
    if (sampleTime > previous.timeSeconds + 0.001 && sampleTime < next.timeSeconds - 0.001 && gap <= DETECTOR_TRACK_MATERIALIZATION_MAX_INTERPOLATION_GAP_SECONDS) {
      interpolated.push(interpolateDetectorCandidate(rowIndex, previous, next, roundedDetectorTimeSeconds(sampleTime)))
    }
    sampleTime += DETECTOR_TRACK_MATERIALIZATION_SAMPLE_SECONDS
  }
  return interpolated
}

function dedupeDetectorCandidatesByTime(candidates: DetectorCandidate[]): DetectorCandidate[] {
  const byTime = new Map<string, DetectorCandidate>()
  for (const candidate of candidates) {
    const key = detectorCandidateTimeKey(candidate)
    const existing = byTime.get(key)
    if (!existing || (!existing.runtimePolicy && candidate.runtimePolicy)) {
      byTime.set(key, candidate)
    }
  }
  return [...byTime.values()].sort((left, right) => left.timeSeconds - right.timeSeconds)
}

function spreadDetectorCandidates(candidates: DetectorCandidate[], maxExamples: number): DetectorCandidate[] {
  if (candidates.length <= maxExamples) return candidates
  const selected: DetectorCandidate[] = []
  const used = new Set<number>()
  for (let index = 0; index < maxExamples; index += 1) {
    const idealIndex = Math.round((index * (candidates.length - 1)) / Math.max(1, maxExamples - 1))
    let candidateIndex = idealIndex
    for (let offset = 0; offset < candidates.length; offset += 1) {
      const left = idealIndex - offset
      const right = idealIndex + offset
      if (left >= 0 && !used.has(left)) {
        candidateIndex = left
        break
      }
      if (right < candidates.length && !used.has(right)) {
        candidateIndex = right
        break
      }
    }
    used.add(candidateIndex)
    selected.push(candidates[candidateIndex])
  }
  return selected.sort((left, right) => left.timeSeconds - right.timeSeconds)
}

function detectorObservationRefForCandidate(
  candidate: DetectorCandidate,
  humanBbox?: NormalizedBbox,
): DetectorObservationRefPayload {
  return {
    source: 'watch_annotation_island_yolo_candidate',
    link_quality: 'human_selected_yolo_track',
    track_id: candidate.trackId,
    detector_candidate_id: candidate.id,
    detected_class: candidate.detectedClass,
    bbox: candidate.bbox,
    time_seconds: candidate.timeSeconds,
    media_time_seconds: candidate.mediaTimeSeconds ?? null,
    confidence: candidate.confidence ?? null,
    ...(candidate.runtimePolicy ? { runtime_policy: candidate.runtimePolicy } : {}),
    ...(candidate.sourceCandidateIds?.length ? { source_detector_candidate_ids: candidate.sourceCandidateIds } : {}),
    ...(candidate.sourceTimeSeconds?.length ? { source_time_seconds: candidate.sourceTimeSeconds } : {}),
    ...(humanBbox ? { human_bbox: humanBbox } : {}),
  }
}

function asAssetUid(reportTitle?: string, explicit?: string): string {
  if (explicit?.trim()) return explicit.trim()
  const fromTitle = (reportTitle || 'watch_asset').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return fromTitle || 'watch_asset'
}

function bboxStyle(bbox: NormalizedBbox): React.CSSProperties {
  const [x1, y1, x2, y2] = bbox
  return {
    left: `${x1 * 100}%`,
    top: `${y1 * 100}%`,
    width: `${(x2 - x1) * 100}%`,
    height: `${(y2 - y1) * 100}%`,
  }
}

function bboxDisplayStyle(bbox: NormalizedBbox, maxY = 0.92): React.CSSProperties {
  const [x1, y1, x2, y2] = bbox
  return bboxStyle([x1, y1, x2, Math.min(y2, maxY)])
}

function normalizeDragBbox(start: PointerPoint, current: PointerPoint, rect: DOMRect): NormalizedBbox {
  const x1 = clamp01(Math.min(start.x, current.x) / rect.width)
  const y1 = clamp01(Math.min(start.y, current.y) / rect.height)
  const x2 = clamp01(Math.max(start.x, current.x) / rect.width)
  const y2 = clamp01(Math.max(start.y, current.y) / rect.height)
  return [x1, y1, x2, y2]
}

function moveBbox(bbox: NormalizedBbox, dx: number, dy: number): NormalizedBbox {
  const [x1, y1, x2, y2] = bbox
  const width = x2 - x1
  const height = y2 - y1
  const nextX1 = Math.max(0, Math.min(1 - width, x1 + dx))
  const nextY1 = Math.max(0, Math.min(1 - height, y1 + dy))
  return [nextX1, nextY1, nextX1 + width, nextY1 + height]
}

function resizeBbox(bbox: NormalizedBbox, handle: DragHandle, dx: number, dy: number): NormalizedBbox {
  let [x1, y1, x2, y2] = bbox
  const minSize = 0.015

  if (handle.includes('w')) x1 = clamp01(x1 + dx)
  if (handle.includes('e')) x2 = clamp01(x2 + dx)
  if (handle.includes('n')) y1 = clamp01(y1 + dy)
  if (handle.includes('s')) y2 = clamp01(y2 + dy)

  if (x2 - x1 < minSize) {
    if (handle.includes('w')) x1 = Math.max(0, x2 - minSize)
    else x2 = Math.min(1, x1 + minSize)
  }

  if (y2 - y1 < minSize) {
    if (handle.includes('n')) y1 = Math.max(0, y2 - minSize)
    else y2 = Math.min(1, y1 + minSize)
  }

  return normalizeBbox([x1, y1, x2, y2]) || bbox
}

function sameBbox(a: NormalizedBbox, b: NormalizedBbox): boolean {
  return a.every((value, index) => Math.abs(value - b[index]) < 0.0005)
}

function bboxIou(a: NormalizedBbox, b: NormalizedBbox): number {
  const left = Math.max(a[0], b[0])
  const top = Math.max(a[1], b[1])
  const right = Math.min(a[2], b[2])
  const bottom = Math.min(a[3], b[3])
  const intersectionWidth = Math.max(0, right - left)
  const intersectionHeight = Math.max(0, bottom - top)
  const intersection = intersectionWidth * intersectionHeight
  const areaA = Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1])
  const areaB = Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])
  const union = areaA + areaB - intersection
  return union > 0 ? intersection / union : 0
}

function runtimeEditKeyframeId(rowIndex: number, characterKeyValue: string): string {
  const safeCharacterKey = characterKeyValue.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'character'
  return `${Date.now()}_row${rowIndex.toString().padStart(4, '0')}_${safeCharacterKey}_runtime_edit`
}

function pointerInElement(event: React.PointerEvent | PointerEvent, rect: DOMRect): PointerPoint {
  return {
    x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
    y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.tagName === 'TEXTAREA') return true
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset'].includes(target.type)
  }
  return false
}

function isInteractiveFormTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return isTypingTarget(target) || target.tagName === 'SELECT'
}

async function readJsonResponse(response: Response): Promise<MutationReceipt> {
  try {
    return await response.json() as MutationReceipt
  } catch {
    return {}
  }
}

async function requestJson(url: string, body: Record<string, unknown>): Promise<MutationReceipt> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await readJsonResponse(response)
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || payload.detail || `watch_annotation_http_${response.status}`)
  }
  return payload
}

function captureVideoFrameDataUrl(video: HTMLVideoElement | null): string | null {
  if (!video || video.videoWidth <= 0 || video.videoHeight <= 0) return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const context = canvas.getContext('2d')
    if (!context) return null
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.84)
  } catch {
    return null
  }
}

function diagnosticImageSummary(dataUrl: string | null, video: HTMLVideoElement | null): Record<string, unknown> {
  if (!dataUrl) {
    return {
      available: false,
      reason: video && video.videoWidth > 0 && video.videoHeight > 0 ? 'capture_failed' : 'video_frame_unavailable',
    }
  }

  let hash = 2166136261
  for (let index = 0; index < dataUrl.length; index += 1) {
    hash ^= dataUrl.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }

  const mimeMatch = /^data:([^;]+);/.exec(dataUrl)
  return {
    available: true,
    mime: mimeMatch?.[1] || 'unknown',
    width: video?.videoWidth || null,
    height: video?.videoHeight || null,
    byte_length: dataUrl.length,
    fnv1a32: (hash >>> 0).toString(16).padStart(8, '0'),
    inline_payload: false,
  }
}

function buttonStyle(active: boolean, danger = false): React.CSSProperties {
  return {
    border: `1px solid ${danger ? 'rgba(248,113,113,0.32)' : active ? 'rgba(45,212,191,0.38)' : 'rgba(148,163,184,0.18)'}`,
    background: danger
      ? active ? 'rgba(127,29,29,0.72)' : 'rgba(127,29,29,0.24)'
      : active ? 'rgba(45,212,191,0.14)' : 'rgba(15,23,42,0.72)',
    color: danger
      ? active ? '#fecaca' : '#9ca3af'
      : active ? '#67e8f9' : '#94a3b8',
    borderRadius: 8,
    padding: '8px 10px',
    fontSize: 11,
    fontWeight: 850,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    cursor: active ? 'pointer' : 'default',
  }
}

function iconButtonStyle(active: boolean, danger = false): React.CSSProperties {
  return {
    ...buttonStyle(active, danger),
    display: 'inline-grid',
    placeItems: 'center',
    width: 36,
    height: 36,
    padding: 0,
  }
}

const HANDLE_ITEMS: Array<{ handle: DragHandle; label: string; style: React.CSSProperties }> = [
  { handle: 'nw', label: 'NW', style: { left: -5, top: -5, cursor: 'nwse-resize' } },
  { handle: 'n', label: 'N', style: { left: '50%', top: -5, marginLeft: -4, cursor: 'ns-resize' } },
  { handle: 'ne', label: 'NE', style: { right: -5, top: -5, cursor: 'nesw-resize' } },
  { handle: 'e', label: 'E', style: { right: -5, top: '50%', marginTop: -4, cursor: 'ew-resize' } },
  { handle: 'se', label: 'SE', style: { right: -5, bottom: -5, cursor: 'nwse-resize' } },
  { handle: 's', label: 'S', style: { left: '50%', bottom: -5, marginLeft: -4, cursor: 'ns-resize' } },
  { handle: 'sw', label: 'SW', style: { left: -5, bottom: -5, cursor: 'nesw-resize' } },
  { handle: 'w', label: 'W', style: { left: -5, top: '50%', marginTop: -4, cursor: 'ew-resize' } },
]

const PENDING_TARGET_OVERLAY_ID = 'pending:new-annotation-target'

export function WatchAnnotationIsland({
  row,
  reportTitle,
  assetUid,
  videoSrc,
  thumbnailSrc,
  characters = [],
  actorByCharacter = {},
  actorForCharacter,
  onClose,
}: WatchAnnotationIslandProps): React.ReactElement {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const sessionRef = useRef<WatchAnnotationSessionState | null>(null)
  const characterSelectRef = useRef<HTMLSelectElement | null>(null)
  const manipulationRef = useRef<ManipulationState | null>(null)
  const pendingOverlayPointerRef = useRef<PendingOverlayPointer | null>(null)

  const actorLookup = useCallback((name: string): string => (
    actorByCharacter[name]
    || actorByCharacter[characterKey(name)]
    || actorForCharacter?.(name)
    || ''
  ), [actorByCharacter, actorForCharacter])

  const characterOptions = useMemo(() => {
    const raw = normalizeCharacterOptions(row, characters)
    return raw.map((option) => ({
      ...option,
      actorName: option.actorName || actorLookup(option.name) || '',
    }))
  }, [actorLookup, characters, row])

  const characterOptionsKey = useMemo(() => (
    characterOptions.map((option) => `${option.name}:${option.actorName || ''}`).join('|')
  ), [characterOptions])

  const [session, setSession] = useState<WatchAnnotationSessionState>(() => (
    createWatchAnnotationSession(row, characterOptions)
  ))
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState('Loading live row annotations...')
  const [drawStart, setDrawStart] = useState<PointerPoint | null>(null)
  const [draftBbox, setDraftBbox] = useState<NormalizedBbox | null>(null)
  const [pendingTargetBbox, setPendingTargetBbox] = useState<NormalizedBbox | null>(null)
  const [selectedDetectorCandidateId, setSelectedDetectorCandidateId] = useState<string | null>(null)
  const [inlineLabelEditorCandidateId, setInlineLabelEditorCandidateId] = useState<string | null>(null)
  const [detectorCandidates, setDetectorCandidates] = useState<DetectorCandidate[]>([])
  const [detectorStatus, setDetectorStatus] = useState('')
  const [detectorSuggestions, setDetectorSuggestions] = useState<Record<string, DetectorCandidateAssignment>>({})
  const [detectorLabelRejections, setDetectorLabelRejections] = useState<Record<string, DetectorLabelRejection>>({})
  const [identityReadiness, setIdentityReadiness] = useState<IdentityReadinessPayload | null>(null)
  const [identityReadinessStatus, setIdentityReadinessStatus] = useState('')
  const [videoDimensions, setVideoDimensions] = useState({ width: 1280, height: 696 })
  const [manualAnnotationEnabled, setManualAnnotationEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [manipulation, setManipulation] = useState<ManipulationState | null>(null)

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    manipulationRef.current = manipulation
  }, [manipulation])

  const segmentDuration = useMemo(() => rowSegmentDurationSeconds(row), [row])
  const resolvedAssetUid = useMemo(() => asAssetUid(reportTitle, assetUid), [assetUid, reportTitle])

  const effectiveVideoSrc = videoSrc || (typeof row.video_clip_path === 'string' ? row.video_clip_path : '')
  const effectiveThumbnailSrc = thumbnailSrc || (typeof row.scene_marker_image_path === 'string' ? row.scene_marker_image_path : '')

  const hydrateRow = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const response = await fetch(`/api/projects/watch/annotations/rows/${encodeURIComponent(String(row.index))}`)
      const payload = await readJsonResponse(response)
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || payload.detail || `watch_row_hydration_http_${response.status}`)
      }
      setSession((current) => replaceCanonicalFromHydration(current, row, payload, characterOptions))
      setStatus('Live row annotations loaded.')
    } catch (error) {
      setStatus(`Hydration failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setLoading(false)
    }
  }, [characterOptionsKey, row.index, row.movie_segment, row.timecode])

  const hydrateDetectorCandidates = useCallback(async (): Promise<void> => {
    try {
      const params = new URLSearchParams({
        asset_uid: resolvedAssetUid,
        source_width: String(videoDimensions.width || 1280),
        source_height: String(videoDimensions.height || 696),
      })
      const response = await fetch(`/api/projects/watch/detector-candidates/rows/${encodeURIComponent(String(row.index))}?${params.toString()}`)
      const payload = await readJsonResponse(response) as DetectorCandidatePayload
      if (!response.ok) throw new Error(String(payload?.schema || `detector_candidates_http_${response.status}`))
      const candidates = Array.isArray(payload.candidates) ? payload.candidates.flatMap((candidate): DetectorCandidate[] => {
        const bbox = normalizeBbox(candidate.bbox)
        const timeSeconds = typeof candidate.time_seconds === 'number' ? candidate.time_seconds : null
        if (!bbox || timeSeconds === null || !Number.isFinite(timeSeconds)) return []
        return [{
          id: candidate.id || `detector:${row.index}:${candidate.track_id || 'track'}:${timeSeconds.toFixed(3)}`,
          trackId: candidate.track_id || 'untracked',
          detectedClass: candidate.detected_class || 'person',
          bbox,
          timeSeconds,
          mediaTimeSeconds: candidate.media_time_seconds,
          confidence: candidate.confidence,
        }]
      }) : []
      setDetectorCandidates(candidates)
      setDetectorStatus(`${candidates.length} YOLO person candidate${candidates.length === 1 ? '' : 's'} loaded.`)
    } catch (error) {
      setDetectorCandidates([])
      setDetectorStatus(`YOLO candidates unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [resolvedAssetUid, row.index, videoDimensions.height, videoDimensions.width])

  const hydrateIdentityReadiness = useCallback(async (): Promise<void> => {
    try {
      const params = new URLSearchParams({ asset_uid: resolvedAssetUid, include_eval: '1' })
      const response = await fetch(`/api/projects/watch/identity-readiness?${params.toString()}`)
      const payload = await readJsonResponse(response) as IdentityReadinessPayload
      if (!response.ok || payload.error) {
        throw new Error(payload.error || payload.detail || `identity_readiness_http_${response.status}`)
      }
      setIdentityReadiness(payload)
      const ready = typeof payload.ready_character_count === 'number' ? payload.ready_character_count : 0
      const total = typeof payload.character_count === 'number'
        ? payload.character_count
        : Array.isArray(payload.characters)
          ? payload.characters.length
          : 0
      const evalStatus = payload.auto_suggest_readiness && typeof payload.auto_suggest_readiness.evaluated_count === 'number'
        ? ` Held-out Qdrant: ${payload.auto_suggest_readiness.pass_count ?? 0}/${payload.auto_suggest_readiness.evaluated_count} (${Math.round(Number(payload.auto_suggest_readiness.accuracy ?? 0) * 100)}%) ${payload.auto_suggest_readiness.ready ? 'ready' : 'pending'}.`
        : ''
      const strict = payload.strict_yolo_linked_readiness
      const strictStatus = strict && typeof strict.ready_character_count === 'number'
        ? ` YOLO-linked labels: ${strict.ready_character_count}/${strict.character_count ?? total} ${strict.ready ? 'ready' : 'pending'}.`
        : ''
      setIdentityReadinessStatus(`${ready}/${total} characters count-ready for YOLO identity suggestions.${evalStatus}${strictStatus}`)
    } catch (error) {
      setIdentityReadiness(null)
      setIdentityReadinessStatus(`Identity readiness unavailable: ${error instanceof Error ? error.message : String(error)}`)
    }
  }, [resolvedAssetUid])

  useEffect(() => {
    setSession((current) => createWatchAnnotationSession(row, characterOptions, current))
    setDraftBbox(null)
    setPendingTargetBbox(null)
    setDrawStart(null)
    setSelectedDetectorCandidateId(null)
    setInlineLabelEditorCandidateId(null)
    setDetectorSuggestions({})
    setDetectorLabelRejections({})
    setStatus('Loading live row annotations...')
    void hydrateRow()
  }, [characterOptionsKey, hydrateRow, row.index, row.movie_segment, row.timecode])

  useEffect(() => {
    void hydrateDetectorCandidates()
  }, [hydrateDetectorCandidates])

  useEffect(() => {
    void hydrateIdentityReadiness()
  }, [hydrateIdentityReadiness])

  const overlays = useMemo(() => deriveWatchAnnotationOverlays(session, session.playheadSeconds), [session])
  const pendingTargetOverlay = useMemo<WatchAnnotationOverlay | null>(() => {
    if (!pendingTargetBbox) return null
    const name = session.selectedCharacterName.trim() || 'New target'
    const actorName = session.selectedActorName.trim() || actorLookup(name)
    return {
      id: PENDING_TARGET_OVERLAY_ID,
      kind: 'pending',
      characterKey: characterKey(name),
      characterName: characterKey(name) === 'unassigned' ? 'New target' : name,
      actorName,
      bbox: pendingTargetBbox,
      timeSeconds: session.playheadSeconds,
      sourceKeyframeIds: [],
      isExactKeyframe: false,
    }
  }, [actorLookup, pendingTargetBbox, session.playheadSeconds, session.selectedActorName, session.selectedCharacterName])
  const renderedOverlays = useMemo(() => (
    pendingTargetOverlay ? [...overlays, pendingTargetOverlay] : overlays
  ), [overlays, pendingTargetOverlay])
  const visibleDetectorCandidates = useMemo(() => {
    const byTrack = new Map<string, DetectorCandidate[]>()
    for (const candidate of detectorCandidates) {
      const trackCandidates = byTrack.get(candidate.trackId)
      if (trackCandidates) {
        trackCandidates.push(candidate)
      } else {
        byTrack.set(candidate.trackId, [candidate])
      }
    }
    const exactDistanceSeconds = 0.055
    const maxInterpolationGapSeconds = 1.0
    const maxHeldDistanceSeconds = 0.26
    const visible: DetectorCandidate[] = []
    for (const trackCandidates of byTrack.values()) {
      const sorted = [...trackCandidates].sort((left, right) => left.timeSeconds - right.timeSeconds)
      let nearest: DetectorCandidate | null = null
      let nearestDistance = Number.POSITIVE_INFINITY
      let previous: DetectorCandidate | null = null
      let next: DetectorCandidate | null = null

      for (const candidate of sorted) {
        const distance = Math.abs(candidate.timeSeconds - session.playheadSeconds)
        if (distance < nearestDistance) {
          nearest = candidate
          nearestDistance = distance
        }
        if (candidate.timeSeconds <= session.playheadSeconds) previous = candidate
        if (!next && candidate.timeSeconds >= session.playheadSeconds) next = candidate
      }

      if (!nearest) continue
      if (nearestDistance <= exactDistanceSeconds) {
        visible.push(detectorRuntimeCandidate(nearest, 'exact'))
        continue
      }
      if (previous && next && previous.id !== next.id) {
        const gap = next.timeSeconds - previous.timeSeconds
        if (gap > 0 && gap <= maxInterpolationGapSeconds) {
          visible.push(interpolateDetectorCandidate(row.index, previous, next, session.playheadSeconds))
          continue
        }
      }
      if (nearestDistance <= maxHeldDistanceSeconds) {
        visible.push(detectorRuntimeCandidate(nearest, 'held'))
      }
    }
    return visible.sort((left, right) => left.trackId.localeCompare(right.trackId))
  }, [detectorCandidates, row.index, session.playheadSeconds])
  function findSavedDetectorAssignment(candidate: DetectorCandidate): DetectorCandidateAssignment | null {
    let best: { distance: number; keyframe: WatchAnnotationKeyframe } | null = null
    for (const track of Object.values(session.tracks)) {
      for (const keyframe of track.keyframes) {
        const detectorRef = keyframe.detectorObservationRef
        if (!detectorRef) continue
        if (detectorRef.track_id !== candidate.trackId && detectorRef.detector_candidate_id !== candidate.id) continue
        const distance = Math.abs(keyframe.timeSeconds - candidate.timeSeconds)
        if (distance > 0.35) continue
        if (!best || distance < best.distance) best = { distance, keyframe }
      }
    }
    if (!best) return null
    return {
      characterName: best.keyframe.characterName,
      actorName: best.keyframe.actorName,
      source: 'saved',
      keyframe: best.keyframe,
    }
  }

  const detectorCandidateAssignments = useMemo(() => {
    const assignments = new Map<string, DetectorCandidateAssignment>()
    type AcceptedTrackAssignment = DetectorCandidateAssignment & {
      keyframeId: string
      keyframeTimeSeconds: number
    }
    const acceptedByTrack = new Map<string, AcceptedTrackAssignment[]>()
    const evidenceCounts = new Map<string, Set<string>>()
    for (const track of Object.values(session.tracks)) {
      for (const keyframe of track.keyframes) {
        const detectorRef = keyframe.detectorObservationRef
        const trackId = typeof detectorRef?.track_id === 'string' ? detectorRef.track_id.trim() : ''
        const keyframeId = keyframe.id || keyframe.recordId || keyframe.recordKey
        if (!trackId || !keyframeId || characterKey(keyframe.characterName) === 'unassigned') continue
        const evidenceKey = `${trackId}:${characterKey(keyframe.characterName)}`
        const evidenceSet = evidenceCounts.get(evidenceKey) || new Set<string>()
        evidenceSet.add(keyframeId)
        evidenceCounts.set(evidenceKey, evidenceSet)
        const entries = acceptedByTrack.get(trackId) || []
        entries.push({
          characterName: keyframe.characterName,
          actorName: keyframe.actorName,
          source: 'propagated',
          keyframe,
          keyframeId,
          keyframeTimeSeconds: keyframe.timeSeconds,
          originTrackId: trackId,
          evidenceCount: evidenceSet.size,
        })
        acceptedByTrack.set(trackId, entries)
      }
    }
    for (const entries of acceptedByTrack.values()) {
      for (const entry of entries) {
        entry.evidenceCount = evidenceCounts.get(`${entry.originTrackId}:${characterKey(entry.characterName)}`)?.size || 1
      }
    }

    const isRejected = (candidate: DetectorCandidate, assignment: DetectorCandidateAssignment | null | undefined): boolean => {
      if (!assignment) return false
      return Boolean(detectorLabelRejections[detectorCandidateLabelKey(candidate, assignment.characterName)])
    }

    const selectedName = session.selectedCharacterName.trim()
    const selectedCandidate = selectedDetectorCandidateId
      ? visibleDetectorCandidates.find((candidate) => candidate.id === selectedDetectorCandidateId) || null
      : null
    const selectedSavedAssignment = selectedCandidate ? findSavedDetectorAssignment(selectedCandidate) : null
    if (
      pendingTargetBbox &&
      selectedDetectorCandidateId &&
      !selectedSavedAssignment &&
      selectedName &&
      characterKey(selectedName) !== 'unassigned'
    ) {
      assignments.set(selectedDetectorCandidateId, {
        characterName: selectedName,
        actorName: session.selectedActorName.trim() || actorLookup(selectedName),
        source: 'pending',
      })
    }

    for (const candidate of visibleDetectorCandidates) {
      if (assignments.has(candidate.id)) continue
      const savedAssignment = findSavedDetectorAssignment(candidate)
      if (savedAssignment && !isRejected(candidate, savedAssignment)) {
        assignments.set(candidate.id, savedAssignment)
        continue
      }
      const propagatedAssignments = acceptedByTrack.get(candidate.trackId) || []
      const propagatedAssignment = propagatedAssignments
        .filter((assignment) => !isRejected(candidate, assignment))
        .sort((left, right) => {
          const leftDistance = Math.abs(left.keyframeTimeSeconds - candidate.timeSeconds)
          const rightDistance = Math.abs(right.keyframeTimeSeconds - candidate.timeSeconds)
          if (leftDistance !== rightDistance) return leftDistance - rightDistance
          return (right.evidenceCount ?? 0) - (left.evidenceCount ?? 0)
        })[0]
      if (propagatedAssignment && !isRejected(candidate, propagatedAssignment)) {
        const {
          keyframeId: _keyframeId,
          keyframeTimeSeconds: _keyframeTimeSeconds,
          ...assignment
        } = propagatedAssignment
        assignments.set(candidate.id, {
          ...assignment,
          source: 'propagated',
          originTrackId: candidate.trackId,
        })
        continue
      }
      const suggestedAssignment = detectorSuggestions[candidate.id]
      if (suggestedAssignment && !isRejected(candidate, suggestedAssignment)) {
        assignments.set(candidate.id, suggestedAssignment)
      }
    }
    return assignments
  }, [
    actorLookup,
    detectorCandidates,
    detectorLabelRejections,
    detectorSuggestions,
    pendingTargetBbox,
    selectedDetectorCandidateId,
    session.selectedActorName,
    session.selectedCharacterName,
    session.tracks,
    visibleDetectorCandidates,
  ])
  const selectedDetectorCandidate = useMemo(() => (
    selectedDetectorCandidateId
      ? visibleDetectorCandidates.find((candidate) => candidate.id === selectedDetectorCandidateId) || null
      : null
  ), [selectedDetectorCandidateId, visibleDetectorCandidates])
  const selectedDetectorAssignment = selectedDetectorCandidate ? detectorCandidateAssignments.get(selectedDetectorCandidate.id) || null : null
  const detectorFirstMode = visibleDetectorCandidates.length > 0
  const manualDrawEnabled = manualAnnotationEnabled
  const displayedOverlays = useMemo(() => (
    detectorFirstMode ? renderedOverlays.filter((overlay) => overlay.kind === 'pending' && manualAnnotationEnabled) : renderedOverlays
  ), [detectorFirstMode, manualAnnotationEnabled, renderedOverlays])
  const exactSelectedKeyframe = useMemo(() => findExactSelectedKeyframe(session), [session])
  const visibleExactSelectedKeyframe = detectorFirstMode ? null : exactSelectedKeyframe
  const activeOverlay = useMemo(() => (
    displayedOverlays.find((overlay) => overlay.id === session.selectedOverlayId) || (detectorFirstMode ? null : selectedCurrentOverlay(session))
  ), [detectorFirstMode, displayedOverlays, session])
  const stats = useMemo(() => trackStats(session), [session])
  const detectorReadinessLedger = useMemo(() => {
    const globalByCharacter = new Map<string, IdentityReadinessEntry>()
    for (const entry of Array.isArray(identityReadiness?.characters) ? identityReadiness.characters : []) {
      if (!entry.character_name) continue
      globalByCharacter.set(characterKey(entry.character_name), entry)
    }
    const acceptedByCharacter = new Map<string, { characterName: string; actorName: string; keyframes: Set<string>; tracks: Set<string> }>()
    for (const candidate of detectorCandidates) {
      const savedAssignment = findSavedDetectorAssignment(candidate)
      const keyframeId = savedAssignment?.keyframe?.id || savedAssignment?.keyframe?.recordId
      if (!savedAssignment || !keyframeId) continue
      const key = characterKey(savedAssignment.characterName)
      const existing = acceptedByCharacter.get(key) || {
        characterName: savedAssignment.characterName,
        actorName: savedAssignment.actorName,
        keyframes: new Set<string>(),
        tracks: new Set<string>(),
      }
      existing.keyframes.add(keyframeId)
      existing.tracks.add(candidate.trackId)
      acceptedByCharacter.set(key, existing)
    }
    const rejectedByCharacter = new Map<string, number>()
    for (const rejection of Object.values(detectorLabelRejections)) {
      const key = characterKey(rejection.characterName)
      rejectedByCharacter.set(key, (rejectedByCharacter.get(key) || 0) + 1)
    }
    const suggestedByCharacter = new Map<string, number>()
    for (const suggestion of Object.values(detectorSuggestions)) {
      const key = characterKey(suggestion.characterName)
      suggestedByCharacter.set(key, (suggestedByCharacter.get(key) || 0) + 1)
    }

    const keys = new Set<string>([
      ...Array.from(globalByCharacter.keys()),
      ...Array.from(acceptedByCharacter.keys()),
      ...Array.from(rejectedByCharacter.keys()),
      ...Array.from(suggestedByCharacter.keys()),
    ])

    return Array.from(keys).map((key) => {
      const global = globalByCharacter.get(key)
      const rowLocal = acceptedByCharacter.get(key)
      const characterName = global?.character_name || rowLocal?.characterName || key
      const actorName = global?.actor_name || rowLocal?.actorName || actorLookup(characterName)
      const accepted = global?.accepted_count ?? rowLocal?.keyframes.size ?? 0
      const tracks = global?.track_count ?? rowLocal?.tracks.size ?? 0
      const rejected = (global?.rejected_count ?? 0) + (rejectedByCharacter.get(key) || 0)
      const progress = typeof global?.progress === 'number' ? global.progress : Math.min(1, accepted / 8)
      return {
        characterName,
        actorName,
        accepted,
        embedded: global?.embedded_count ?? 0,
        detectorLinked: global?.detector_link_count ?? 0,
        rows: global?.row_count ?? 0,
        tracks,
        rejected,
        suggested: suggestedByCharacter.get(key) || 0,
        progress,
        missing: global?.missing ?? [],
        ready: Boolean(global?.ready_for_suggestion),
      }
    }).sort((left, right) => (
      Number(right.ready) - Number(left.ready)
      || right.progress - left.progress
      || left.characterName.localeCompare(right.characterName)
    ))
  }, [actorLookup, detectorCandidates, detectorLabelRejections, detectorSuggestions, identityReadiness, session.tracks])

  function commonMutationBody(timeSeconds: number, mutationAssetUid = resolvedAssetUid): Record<string, unknown> {
    return {
      asset_uid: mutationAssetUid,
      row_index: row.index,
      timecode: row.timecode,
      movie_segment: row.movie_segment || row.timecode,
      frame_path: row.scene_marker_image_path || '',
      video_clip_path: row.video_clip_path || effectiveVideoSrc || '',
      keyframe_time_seconds: timeSeconds,
      keyframe_time_basis: 'segment_seconds',
      source: 'watch_annotation_island',
    }
  }

  async function persistKeyframe(keyframe: {
    bbox: NormalizedBbox
    timeSeconds: number
    characterName: string
    actorName: string
    recordId?: string
    assetUid?: string
    detectorObservationRef?: DetectorObservationRefPayload
  }, keyframeImageDataUrl?: string | null): Promise<void> {
    await requestJson('/api/projects/watch/annotations', {
      ...commonMutationBody(keyframe.timeSeconds, keyframe.assetUid || resolvedAssetUid),
      annotation_id: keyframe.recordId,
      box_id: keyframe.recordId,
      character_name: keyframe.characterName,
      actor_name: keyframe.actorName,
      bbox: keyframe.bbox,
      detector_observation_ref: keyframe.detectorObservationRef,
      keyframe_image_data_url: keyframeImageDataUrl === undefined
        ? captureVideoFrameDataUrl(videoRef.current) || undefined
        : keyframeImageDataUrl || undefined,
    })
  }

  function waitForVideoSeek(video: HTMLVideoElement, timeSeconds: number): Promise<void> {
    const clamped = Math.max(0, Math.min(segmentDuration, timeSeconds))
    if (Math.abs(video.currentTime - clamped) < 0.025 && video.readyState >= 2) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        video.removeEventListener('seeked', onSeeked)
        reject(new Error(`video_seek_timeout:${clamped.toFixed(3)}`))
      }, 3500)
      function onSeeked(): void {
        window.clearTimeout(timeout)
        resolve()
      }
      video.addEventListener('seeked', onSeeked, { once: true })
      video.currentTime = clamped
    })
  }

  function savedDetectorTimesForTrack(trackId: string): number[] {
    const times: number[] = []
    for (const track of Object.values(sessionRef.current?.tracks || session.tracks)) {
      for (const keyframe of track.keyframes) {
        if (keyframe.detectorObservationRef?.track_id === trackId) times.push(keyframe.timeSeconds)
      }
    }
    return times
  }

  function materializationCandidatesForTrack(seed: DetectorCandidate): DetectorCandidate[] {
    const takenTimes = savedDetectorTimesForTrack(seed.trackId)
    const sameTrack = detectorCandidates
      .filter((candidate) => candidate.trackId === seed.trackId && candidate.detectedClass === seed.detectedClass)
      .sort((left, right) => left.timeSeconds - right.timeSeconds)
    const materializationPool = dedupeDetectorCandidatesByTime([
      ...sameTrack,
      ...interpolatedDetectorCandidatesForTrack(row.index, sameTrack),
    ])
    const selected: DetectorCandidate[] = []

    for (const candidate of materializationPool) {
      if (candidate.id === seed.id || Math.abs(candidate.timeSeconds - seed.timeSeconds) < 0.35) continue
      const savedAssignment = findSavedDetectorAssignment(candidate)
      if (savedAssignment && (!candidate.runtimePolicy || Math.abs((savedAssignment.keyframe?.timeSeconds ?? candidate.timeSeconds) - candidate.timeSeconds) < 0.2)) continue
      const tooCloseToSaved = takenTimes.some((timeSeconds) => (
        Math.abs(timeSeconds - candidate.timeSeconds) < DETECTOR_TRACK_MATERIALIZATION_MIN_SPACING_SECONDS
      ))
      if (tooCloseToSaved) continue
      const tooCloseToSelected = selected.some((sample) => (
        Math.abs(sample.timeSeconds - candidate.timeSeconds) < DETECTOR_TRACK_MATERIALIZATION_MIN_SPACING_SECONDS
      ))
      if (tooCloseToSelected) continue
      selected.push(candidate)
    }
    return spreadDetectorCandidates(selected, DETECTOR_TRACK_MATERIALIZATION_MAX_EXAMPLES)
  }

  async function materializeDetectorTrackExamples(
    seed: DetectorCandidate,
    characterName: string,
    actorName: string,
  ): Promise<{ saved: number; skipped: number; total: number }> {
    const video = videoRef.current
    const samples = materializationCandidatesForTrack(seed)
    if (!video || samples.length < 1) return { saved: 0, skipped: 0, total: samples.length }

    const originalTime = video.currentTime
    let saved = 0
    let skipped = 0
    for (const candidate of samples) {
      try {
        setStatus(`Materializing ${characterName} from ${seed.trackId}: ${saved + skipped + 1}/${samples.length} at ${candidate.timeSeconds.toFixed(2)}s...`)
        await waitForVideoSeek(video, candidate.timeSeconds)
        const frameDataUrl = captureVideoFrameDataUrl(video)
        if (!frameDataUrl) {
          skipped += 1
          continue
        }
        await persistKeyframe({
          recordId: `detector_${row.index}_${candidate.id}`.replace(/[^a-zA-Z0-9_-]+/g, '_'),
          characterName,
          actorName,
          bbox: candidate.bbox,
          timeSeconds: candidate.timeSeconds,
          assetUid: resolvedAssetUid,
          detectorObservationRef: detectorObservationRefForCandidate(candidate),
        }, frameDataUrl)
        saved += 1
      } catch {
        skipped += 1
      }
    }

    try {
      await waitForVideoSeek(video, originalTime)
      setSession((state) => setPlayheadSeconds(state, originalTime))
    } catch {
      // The examples are already persisted; a restore failure should not mask that.
    }

    return { saved, skipped, total: samples.length }
  }

  async function deleteExactKeyframe(): Promise<void> {
    const exact = findExactSelectedKeyframe(sessionRef.current || session)
    if (!exact || saving) return
    setSaving(true)
    setStatus(`Deleting exact keyframe for ${exact.characterName} at ${exact.timeSeconds.toFixed(2)}s...`)
    setSession((current) => deleteExactSelectedKeyframeLocally(current))
    try {
      await requestJson('/api/projects/watch/annotations/delete-keyframe', {
        ...commonMutationBody(exact.timeSeconds, exact.assetUid || resolvedAssetUid),
        annotation_id: exact.recordId || exact.id,
        key: exact.recordKey || exact.id,
        box_id: exact.recordId || exact.id,
        character_name: exact.characterName,
        actor_name: exact.actorName,
      })
      await hydrateRow()
      setStatus(`Deleted exact keyframe for ${exact.characterName}.`)
    } catch (error) {
      setStatus(`Delete failed: ${error instanceof Error ? error.message : String(error)}`)
      await hydrateRow()
    } finally {
      setSaving(false)
    }
  }

  async function clearSelectedDetectorLabel(): Promise<void> {
    if (!selectedDetectorCandidate || saving) return
    await clearDetectorCandidateLabel(selectedDetectorCandidate)
  }

  async function fetchPersistedDetectorTrackAssignments(
    candidate: DetectorCandidate,
    characterName: string,
  ): Promise<DetectorTrackAssignmentDocument[]> {
    const response = await fetch(`/api/projects/watch/annotations/rows/${encodeURIComponent(String(row.index))}`)
    const payload = await readJsonResponse(response) as { annotations?: Array<Record<string, unknown>>; error?: string; detail?: string }
    if (!response.ok) throw new Error(payload.error || payload.detail || `watch_row_annotations_http_${response.status}`)

    const targetCharacterKey = characterKey(characterName)
    return (Array.isArray(payload.annotations) ? payload.annotations : []).flatMap((document): DetectorTrackAssignmentDocument[] => {
      const detectorRef = document.detector_observation_ref && typeof document.detector_observation_ref === 'object'
        ? document.detector_observation_ref as Record<string, unknown>
        : null
      if (!detectorRef || detectorRef.track_id !== candidate.trackId) return []
      if (characterKey(String(document.character_name || '')) !== targetCharacterKey) return []
      if (String(document.lifecycle_status || 'current') !== 'current') return []
      if (document.kind !== 'watch_keyframe_annotation') return []
      const key = typeof document._key === 'string' ? document._key : ''
      if (!key) return []
      const detectorRefSeconds = Number(detectorRef.time_seconds)
      const documentSeconds = Number(document.time_seconds)
      const keyframeSeconds = Number(document.keyframe_time_seconds)
      const targetSeconds = Number.isFinite(detectorRefSeconds)
        ? detectorRefSeconds
        : Number.isFinite(documentSeconds)
          ? documentSeconds
          : Number.isFinite(keyframeSeconds)
            ? keyframeSeconds
            : candidate.timeSeconds
      return [{
        key,
        id: typeof document._id === 'string' ? document._id : undefined,
        boxId: typeof document.box_id === 'string' ? document.box_id : undefined,
        annotationUid: typeof document.annotation_uid === 'string' ? document.annotation_uid : undefined,
        characterName: String(document.character_name || characterName),
        actorName: String(document.actor_name || actorLookup(characterName)),
        timeSeconds: targetSeconds,
      }]
    })
  }

  async function clearDetectorCandidateLabel(candidate: DetectorCandidate): Promise<void> {
    if (saving) return
    const savedAssignment = findSavedDetectorAssignment(candidate)
    const visibleAssignment = detectorCandidateAssignments.get(candidate.id)
    const assignmentToClear = savedAssignment || visibleAssignment || null
    const keyframe = assignmentToClear?.keyframe
    if (!assignmentToClear) {
      setDetectorSuggestions((current) => {
        const next = { ...current }
        delete next[candidate.id]
        return next
      })
      if (pendingTargetBbox) {
        cancelPendingTarget()
        setStatus(`Discarded pending label for ${candidate.trackId}; showing ${detectorBaseLabel(candidate)}.`)
      } else {
        setStatus(`${candidate.trackId} has no saved character label to clear.`)
      }
      setInlineLabelEditorCandidateId(null)
      return
    }

    setDetectorLabelRejections((current) => ({
      ...current,
      [detectorCandidateLabelKey(candidate, assignmentToClear.characterName)]: {
        trackId: candidate.trackId,
        characterName: assignmentToClear.characterName,
        actorName: assignmentToClear.actorName,
        source: assignmentToClear.source,
        createdAt: new Date().toISOString(),
      },
    }))
    setDetectorSuggestions((current) => {
      const next = { ...current }
      delete next[candidate.id]
      return next
    })
    setSaving(true)
    setStatus(`Clearing ${assignmentToClear.characterName} label from ${candidate.trackId}...`)
    setSelectedDetectorCandidateId(null)
    setInlineLabelEditorCandidateId(null)
    setPendingTargetBbox(null)
    setDraftBbox(null)
    setSession((current) => {
      const tracks = Object.fromEntries(Object.entries(current.tracks).map(([trackKey, track]) => [
        trackKey,
        {
          ...track,
          keyframes: track.keyframes.filter((trackKeyframe) => (
            !(
              characterKey(trackKeyframe.characterName) === characterKey(assignmentToClear.characterName)
              && trackKeyframe.detectorObservationRef?.track_id === candidate.trackId
            )
          )),
        },
      ]))
      return { ...current, tracks, selectedOverlayId: null, revision: current.revision + 1 }
    })

    try {
      const persistedAssignments = await fetchPersistedDetectorTrackAssignments(candidate, assignmentToClear.characterName)
      const targets = persistedAssignments.length > 0
        ? persistedAssignments
        : keyframe ? [{
          key: keyframe.recordKey || keyframe.id,
          id: undefined,
          boxId: keyframe.recordId || keyframe.id,
          annotationUid: keyframe.recordId || keyframe.id,
          characterName: keyframe.characterName,
          actorName: keyframe.actorName,
          timeSeconds: keyframe.timeSeconds,
        }] : []
      let deletedCount = 0
      for (const target of targets) {
        const receipt = await requestJson('/api/projects/watch/annotations/delete-keyframe', {
          ...commonMutationBody(target.timeSeconds, keyframe?.assetUid || resolvedAssetUid),
          annotation_id: target.annotationUid || target.boxId || target.key,
          key: target.key,
          id: target.id,
          box_id: target.boxId || target.annotationUid || target.key,
          character_name: target.characterName,
          actor_name: target.actorName,
          reason: `clear_yolo_track_label:${candidate.trackId}:${characterKey(assignmentToClear.characterName)}`,
        }) as MutationReceipt & { deleted_count?: number }
        deletedCount += typeof receipt.deleted_count === 'number' ? receipt.deleted_count : 0
      }
      await hydrateRow()
      await hydrateIdentityReadiness()
      setStatus(deletedCount > 0
        ? `Cleared ${deletedCount} ${assignmentToClear.characterName} label${deletedCount === 1 ? '' : 's'} from ${candidate.trackId}; showing ${detectorBaseLabel(candidate)}.`
        : `No persisted keyframe was cleared for ${candidate.trackId}; row reloaded.`)
    } catch (error) {
      setStatus(`Clear label failed: ${error instanceof Error ? error.message : String(error)}`)
      await hydrateRow()
      await hydrateIdentityReadiness()
    } finally {
      setSaving(false)
    }
  }

  async function saveDetectorCandidateLabel(candidate: DetectorCandidate, characterName: string): Promise<void> {
    if (saving) return
    if (!characterName || characterKey(characterName) === 'unassigned') {
      await clearDetectorCandidateLabel(candidate)
      return
    }

    const option = characterOptions.find((candidateOption) => candidateOption.name === characterName)
    const actorName = option?.actorName || actorLookup(characterName)
    const savedAssignment = findSavedDetectorAssignment(candidate)
    const visibleAssignment = detectorCandidateAssignments.get(candidate.id)
    const persistedAssignment = savedAssignment || (visibleAssignment?.keyframe ? visibleAssignment : null)
    const labelChanged = Boolean(persistedAssignment?.keyframe) && (
      characterKey(persistedAssignment?.characterName || '') !== characterKey(characterName)
      || (persistedAssignment?.actorName || '') !== actorName
    )

    if (persistedAssignment?.keyframe && !labelChanged) {
      setSaving(true)
      try {
        const materialized = await materializeDetectorTrackExamples(candidate, characterName, actorName)
        await hydrateRow()
        await hydrateIdentityReadiness()
        setStatus(materialized.total > 0
          ? `${candidate.trackId} already labeled ${characterName}; materialized ${materialized.saved}/${materialized.total} same-track examples.`
          : `${candidate.trackId} is already labeled ${characterName}.`)
      } catch (error) {
        setStatus(`Materialize label failed: ${error instanceof Error ? error.message : String(error)}`)
        await hydrateRow()
        await hydrateIdentityReadiness()
      } finally {
        setSaving(false)
      }
      setInlineLabelEditorCandidateId(null)
      setSelectedDetectorCandidateId(candidate.id)
      setSession((state) => setSelectedCharacter(setPlayheadSeconds(state, candidate.timeSeconds), characterName, actorName))
      return
    }

    const keyframe: WatchAnnotationKeyframe = {
      id: `pending-${Date.now().toString(36)}`,
      rowIndex: row.index,
      characterName,
      actorName,
      bbox: candidate.bbox,
      timeSeconds: candidate.timeSeconds,
      assetUid: resolvedAssetUid,
      detectorObservationRef: detectorObservationRefForCandidate(candidate),
    }

    setSaving(true)
    setStatus(`${persistedAssignment ? 'Updating' : 'Saving'} ${candidate.trackId} label to ${characterName}...`)
    setDetectorLabelRejections((current) => {
      const next = { ...current }
      delete next[detectorCandidateLabelKey(candidate, characterName)]
      return next
    })
    setDetectorSuggestions((current) => {
      const next = { ...current }
      delete next[candidate.id]
      return next
    })
    setSelectedDetectorCandidateId(candidate.id)
    setInlineLabelEditorCandidateId(null)
    setPendingTargetBbox(null)
    setDraftBbox(null)
    setSession((state) => setSelectedCharacter(setPlayheadSeconds(state, candidate.timeSeconds), characterName, actorName))
    try {
      if (persistedAssignment?.keyframe && labelChanged) {
        const oldKeyframe = persistedAssignment.keyframe
        await requestJson('/api/projects/watch/annotations/delete-keyframe', {
          ...commonMutationBody(oldKeyframe.timeSeconds, oldKeyframe.assetUid || resolvedAssetUid),
          annotation_id: oldKeyframe.recordId || oldKeyframe.id,
          key: oldKeyframe.recordKey || oldKeyframe.id,
          box_id: oldKeyframe.recordId || oldKeyframe.id,
          character_name: oldKeyframe.characterName,
          actor_name: oldKeyframe.actorName,
          reason: `replace_yolo_candidate_label:${candidate.trackId}`,
        })
      }
      await persistKeyframe(keyframe)
      const materialized = await materializeDetectorTrackExamples(candidate, characterName, actorName)
      await hydrateRow()
      await hydrateIdentityReadiness()
      setStatus(materialized.total > 0
        ? `${candidate.trackId} labeled ${characterName}; materialized ${materialized.saved}/${materialized.total} same-track examples.`
        : `${candidate.trackId} labeled ${characterName}.`)
    } catch (error) {
      setStatus(`Save label failed: ${error instanceof Error ? error.message : String(error)}`)
      await hydrateRow()
      await hydrateIdentityReadiness()
    } finally {
      setSaving(false)
    }
  }

  async function stopSelectedTrackAtPlayhead(): Promise<void> {
    const current = sessionRef.current || session
    const overlay = selectedCurrentOverlay(current)
    if (!overlay || overlay.isExactKeyframe || saving) return

    const characterName = overlay.characterName || current.selectedCharacterName || 'Unassigned'
    const actorName = overlay.actorName || current.selectedActorName || actorLookup(characterName)
    const timeSeconds = current.playheadSeconds

    setSaving(true)
    setStatus(`Closing ${characterName} track at ${timeSeconds.toFixed(2)}s...`)
    setSession((state) => appendTrackControlLocally(state, {
      characterName,
      actorName,
      timeSeconds,
      kind: 'offscreen',
    }))
    try {
      await requestJson('/api/projects/watch/annotations/track-control', {
        ...commonMutationBody(timeSeconds, resolvedAssetUid),
        character_name: characterName,
        actor_name: actorName,
        visibility_state: 'offscreen',
        track_control: {
          action: 'stop_character_scan',
          reason: 'character_offscreen',
        },
      })
      await hydrateRow()
      setStatus(`Closed ${characterName} track at ${timeSeconds.toFixed(2)}s.`)
    } catch (error) {
      setStatus(`Close failed: ${error instanceof Error ? error.message : String(error)}`)
      await hydrateRow()
    } finally {
      setSaving(false)
    }
  }

  async function deleteVisibleSelection(): Promise<void> {
    const current = sessionRef.current || session
    if (pendingTargetBbox && current.selectedOverlayId === PENDING_TARGET_OVERLAY_ID) {
      cancelPendingTarget()
      return
    }
    if (findExactSelectedKeyframe(current)) {
      await deleteExactKeyframe()
      return
    }
    await stopSelectedTrackAtPlayhead()
  }

  async function clearSegmentAnnotations(): Promise<void> {
    const current = sessionRef.current || session
    const exactCount = trackStats(current).exactKeyframes
    if (saving || exactCount < 1) return
    setSaving(true)
    setStatus(`Clearing ${exactCount} exact keyframe${exactCount === 1 ? '' : 's'} in this segment...`)
    try {
      await requestJson('/api/projects/watch/annotations/clear-segment', {
        asset_uid: resolvedAssetUid,
        row_index: row.index,
        timecode: row.timecode,
        movie_segment: row.movie_segment || row.timecode,
        source: 'watch_annotation_island',
      })
      setDraftBbox(null)
      setPendingTargetBbox(null)
      setDrawStart(null)
      await hydrateRow()
      setStatus(`Cleared ${exactCount} exact keyframe${exactCount === 1 ? '' : 's'} in this segment.`)
    } catch (error) {
      setStatus(`Clear failed: ${error instanceof Error ? error.message : String(error)}`)
      await hydrateRow()
    } finally {
      setSaving(false)
    }
  }

  async function copyAnnotationSnapshotToClipboard(): Promise<void> {
    const current = sessionRef.current || session
    const frameImageDataUrl = captureVideoFrameDataUrl(videoRef.current)
    const frameImage = diagnosticImageSummary(frameImageDataUrl, videoRef.current)
    const visibleOverlays = [
      ...deriveWatchAnnotationOverlays(current, current.playheadSeconds),
      ...(pendingTargetOverlay ? [pendingTargetOverlay] : []),
    ]
    const active = selectedCurrentOverlay(current)
    const selectedTrackKey = characterKey(current.selectedCharacterName)
    const snapshotTrackKeys = new Set<string>([
      selectedTrackKey,
      ...visibleOverlays.map((overlay) => overlay.characterKey),
    ])
    const compactKeyframe = (keyframe: WatchAnnotationKeyframe) => ({
      id: keyframe.id,
      record_id: keyframe.recordId,
      record_key: keyframe.recordKey,
      character_name: keyframe.characterName,
      actor_name: keyframe.actorName,
      bbox: keyframe.bbox,
      time_seconds: keyframe.timeSeconds,
      receipt_file: keyframe.receiptPath ? keyframe.receiptPath.split('/').pop() : undefined,
    })
    const compactOverlay = (overlay: WatchAnnotationOverlay | null) => overlay ? {
      id: overlay.id,
      kind: overlay.kind,
      character_key: overlay.characterKey,
      character_name: overlay.characterName,
      actor_name: overlay.actorName,
      bbox: overlay.bbox,
      time_seconds: overlay.timeSeconds,
      is_exact_keyframe: overlay.isExactKeyframe,
      exact_keyframe_id: overlay.exactKeyframeId,
      source_keyframe_ids: overlay.sourceKeyframeIds,
    } : null
    const relevantSourceIds = new Set<string>(visibleOverlays.flatMap((overlay) => overlay.sourceKeyframeIds))
    const exactSelected = findExactSelectedKeyframe(current)
    if (exactSelected) relevantSourceIds.add(exactSelected.id)
    const compactTrack = (track: WatchAnnotationTrack) => {
      const byRelevance = track.keyframes.filter((keyframe) => {
        if (relevantSourceIds.has(keyframe.id)) return true
        return Math.abs(keyframe.timeSeconds - current.playheadSeconds) <= 0.75
      })
      const sorted = [...byRelevance].sort((left, right) => {
        const leftDistance = Math.abs(left.timeSeconds - current.playheadSeconds)
        const rightDistance = Math.abs(right.timeSeconds - current.playheadSeconds)
        return leftDistance - rightDistance
      })
      const keyframes = sorted.slice(0, 4).map(compactKeyframe)
      return {
        character_name: track.characterName,
        actor_name: track.actorName,
        keyframe_count: track.keyframes.length,
        control_count: track.controls.length,
        keyframes,
        omitted_keyframe_count: Math.max(0, track.keyframes.length - keyframes.length),
        controls: track.controls.filter((control) => Math.abs(control.timeSeconds - current.playheadSeconds) <= 1.0).map((control) => ({
          id: control.id,
          record_id: control.recordId,
          character_name: control.characterName,
          actor_name: control.actorName,
          time_seconds: control.timeSeconds,
          kind: control.kind,
        })),
      }
    }
    const snapshot = {
      schema: 'watch.annotation.debug_snapshot.v1',
      created_at: new Date().toISOString(),
      asset_uid: resolvedAssetUid,
      row: {
        index: row.index,
        timecode: row.timecode,
        movie_segment: row.movie_segment || row.timecode,
        video_clip_path: row.video_clip_path || effectiveVideoSrc || '',
        scene_marker_image_path: row.scene_marker_image_path || effectiveThumbnailSrc || '',
      },
      playhead_seconds: current.playheadSeconds,
      selected: {
        character_name: current.selectedCharacterName,
        actor_name: current.selectedActorName,
        overlay_id: current.selectedOverlayId,
      },
      exact_selected_keyframe: exactSelected ? compactKeyframe(exactSelected) : null,
      active_overlay: compactOverlay(active),
      visible_overlays: visibleOverlays.map(compactOverlay),
      detector: {
        visible_candidates: visibleDetectorCandidates.map((candidate) => {
          const assignment = detectorCandidateAssignments.get(candidate.id)
          return {
            id: candidate.id,
            track_id: candidate.trackId,
            detected_class: candidate.detectedClass,
            bbox: candidate.bbox,
            time_seconds: candidate.timeSeconds,
            media_time_seconds: candidate.mediaTimeSeconds ?? null,
            runtime_policy: candidate.runtimePolicy || null,
            source_candidate_ids: candidate.sourceCandidateIds || [],
            source_time_seconds: candidate.sourceTimeSeconds || [],
            assignment: assignment ? {
              character_name: assignment.characterName,
              actor_name: assignment.actorName,
              source: assignment.source,
              confidence: assignment.confidence,
              evidence_count: assignment.evidenceCount,
            } : null,
          }
        }),
        rejected_labels: Object.values(detectorLabelRejections).map((rejection) => ({
          track_id: rejection.trackId,
          character_name: rejection.characterName,
          actor_name: rejection.actorName,
          source: rejection.source,
          created_at: rejection.createdAt,
        })),
        readiness_ledger: detectorReadinessLedger.map((entry) => ({
          character_name: entry.characterName,
          actor_name: entry.actorName,
          accepted: entry.accepted,
          embedded: entry.embedded,
          detector_linked: entry.detectorLinked,
          rows: entry.rows,
          tracks: entry.tracks,
          rejected: entry.rejected,
          suggested: entry.suggested,
          progress: entry.progress,
          missing: entry.missing,
          ready: entry.ready,
        })),
        identity_readiness_status: identityReadinessStatus,
        identity_readiness_thresholds: identityReadiness?.thresholds ?? null,
      },
      track_summaries: Object.fromEntries(Object.entries(current.tracks).map(([key, track]) => [
        key,
        {
          character_name: track.characterName,
          actor_name: track.actorName,
          keyframe_count: track.keyframes.length,
          control_count: track.controls.length,
        },
      ])),
      tracks: Object.fromEntries(Object.entries(current.tracks).filter(([key]) => snapshotTrackKeys.has(key)).map(([key, track]) => [
        key,
        compactTrack(track),
      ])),
      status,
      frame_image: frameImage,
    }

    const snapshotText = JSON.stringify(snapshot)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(snapshotText)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = snapshotText
        textarea.setAttribute('readonly', 'true')
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        const copied = document.execCommand('copy')
        textarea.remove()
        if (!copied) throw new Error('document.execCommand copy returned false')
      }
      setStatus(`Snapshot copied to clipboard for row ${row.index} at ${current.playheadSeconds.toFixed(2)}s.`)
    } catch (error) {
      setStatus(`Snapshot copy failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function saveDrawnKeyframe(bbox: NormalizedBbox): Promise<void> {
    if (saving) return
    const current = sessionRef.current || session
    const selectedName = current.selectedCharacterName.trim() || 'Unassigned'
    const selectedActor = current.selectedActorName.trim() || actorLookup(selectedName)
    const existingExact = findExactSelectedKeyframe(current)
    if (existingExact) {
      setSelectedDetectorCandidateId(null)
      setPendingTargetBbox(bbox)
      setDraftBbox(bbox)
      setSession((state) => ({ ...state, selectedOverlayId: PENDING_TARGET_OVERLAY_ID, revision: state.revision + 1 }))
      setStatus(`New annotation target ready at ${current.playheadSeconds.toFixed(2)}s. Choose the character, then save the target.`)
      return
    }
    const keyframe: WatchAnnotationKeyframe = {
      id: `pending-${Date.now().toString(36)}`,
      rowIndex: row.index,
      characterName: selectedName,
      actorName: selectedActor,
      bbox,
      timeSeconds: current.playheadSeconds,
      assetUid: resolvedAssetUid,
    }
    setSaving(true)
    setDraftBbox(bbox)
    setStatus(`Saving exact keyframe for ${selectedName} at ${keyframe.timeSeconds.toFixed(2)}s...`)
    setSession((current) => upsertHumanKeyframe(current, keyframe))
    try {
      await persistKeyframe(keyframe)
      setSelectedDetectorCandidateId(null)
      setDraftBbox(null)
      await hydrateRow()
      setStatus(`Exact keyframe saved for ${selectedName}.`)
    } catch (error) {
      setStatus(`Save failed: ${error instanceof Error ? error.message : String(error)}`)
      await hydrateRow()
    } finally {
      setSaving(false)
    }
  }

  async function savePendingTarget(): Promise<void> {
    if (!pendingTargetBbox || saving) return
    const current = sessionRef.current || session
    const selectedName = current.selectedCharacterName.trim() || 'Unassigned'
    if (!selectedName || characterKey(selectedName) === 'unassigned') {
      setStatus('Choose a character before saving the new annotation target.')
      return
    }
    const selectedActor = current.selectedActorName.trim() || actorLookup(selectedName)
    const selectedCandidate = selectedDetectorCandidateId
      ? visibleDetectorCandidates.find((candidate) => candidate.id === selectedDetectorCandidateId) || null
      : null
    const savedAssignment = selectedCandidate ? findSavedDetectorAssignment(selectedCandidate) : null
    const keyframe: WatchAnnotationKeyframe = {
      id: `pending-${Date.now().toString(36)}`,
      rowIndex: row.index,
      characterName: selectedName,
      actorName: selectedActor,
      bbox: pendingTargetBbox,
      timeSeconds: current.playheadSeconds,
      assetUid: resolvedAssetUid,
      detectorObservationRef: selectedCandidate
        ? detectorObservationRefForCandidate(selectedCandidate, pendingTargetBbox)
        : undefined,
    }

    setSaving(true)
    setStatus(`${savedAssignment ? 'Updating' : 'Saving'} YOLO label for ${selectedCandidate?.trackId || 'target'} to ${selectedName}...`)
    if (selectedCandidate) {
      setDetectorLabelRejections((current) => {
        const next = { ...current }
        delete next[detectorCandidateLabelKey(selectedCandidate, selectedName)]
        return next
      })
    }
    try {
      const labelChanged = Boolean(savedAssignment?.keyframe) && (
        characterKey(savedAssignment?.characterName || '') !== characterKey(selectedName)
        || (savedAssignment?.actorName || '') !== selectedActor
      )
      if (savedAssignment?.keyframe && !labelChanged) {
        const materialized = selectedCandidate
          ? await materializeDetectorTrackExamples(selectedCandidate, selectedName, selectedActor)
          : { saved: 0, skipped: 0, total: 0 }
        setSelectedDetectorCandidateId(null)
        setPendingTargetBbox(null)
        setDraftBbox(null)
        await hydrateRow()
        await hydrateIdentityReadiness()
        setStatus(materialized.total > 0
          ? `${selectedCandidate?.trackId || 'YOLO target'} already labeled ${selectedName}; materialized ${materialized.saved}/${materialized.total} same-track examples.`
          : `${selectedCandidate?.trackId || 'YOLO target'} is already labeled ${selectedName}.`)
        return
      }
      if (savedAssignment?.keyframe && labelChanged) {
        const oldKeyframe = savedAssignment.keyframe
        await requestJson('/api/projects/watch/annotations/delete-keyframe', {
          ...commonMutationBody(oldKeyframe.timeSeconds, oldKeyframe.assetUid || resolvedAssetUid),
          annotation_id: oldKeyframe.recordId || oldKeyframe.id,
          key: oldKeyframe.recordKey || oldKeyframe.id,
          box_id: oldKeyframe.recordId || oldKeyframe.id,
          character_name: oldKeyframe.characterName,
          actor_name: oldKeyframe.actorName,
          reason: `replace_yolo_candidate_label:${selectedCandidate?.trackId || 'unknown'}`,
        })
      }
      await persistKeyframe(keyframe)
      const materialized = selectedCandidate
        ? await materializeDetectorTrackExamples(selectedCandidate, selectedName, selectedActor)
        : { saved: 0, skipped: 0, total: 0 }
      setSelectedDetectorCandidateId(null)
      setPendingTargetBbox(null)
      setDraftBbox(null)
      await hydrateRow()
      await hydrateIdentityReadiness()
      setStatus(materialized.total > 0
        ? `${selectedCandidate?.trackId || 'YOLO target'} labeled ${selectedName}; materialized ${materialized.saved}/${materialized.total} same-track examples.`
        : `${selectedCandidate?.trackId || 'YOLO target'} labeled ${selectedName}.`)
    } catch (error) {
      setStatus(`Save failed: ${error instanceof Error ? error.message : String(error)}`)
      await hydrateRow()
      await hydrateIdentityReadiness()
    } finally {
      setSaving(false)
    }
  }

  function cancelPendingTarget(): void {
    setSelectedDetectorCandidateId(null)
    setInlineLabelEditorCandidateId(null)
    setPendingTargetBbox(null)
    setDraftBbox(null)
    setSession((state) => ({ ...state, selectedOverlayId: null, revision: state.revision + 1 }))
    setStatus('New annotation target discarded.')
  }

  function setVideoTime(nextSeconds: number): void {
    const clamped = Math.max(0, Math.min(segmentDuration, nextSeconds))
    const video = videoRef.current
    if (video) video.currentTime = clamped
    setSession((current) => setPlayheadSeconds(current, clamped))
  }

  function frameStep(direction: -1 | 1): void {
    setVideoTime(session.playheadSeconds + direction * (1 / 24))
  }

  function frameStepFromCurrent(direction: -1 | 1): void {
    const current = sessionRef.current || session
    setVideoTime(current.playheadSeconds + direction * (1 / 24))
  }

  function focusCharacterSelect(openPicker = false): void {
    window.setTimeout(() => {
      const select = characterSelectRef.current
      if (!select) return
      select.focus()
      if (!openPicker) return
      try {
        const picker = (select as HTMLSelectElement & { showPicker?: () => void }).showPicker
        if (typeof picker === 'function') picker.call(select)
      } catch {
        // Some browsers only allow focus, not programmatic native-picker opening.
      }
    }, 0)
  }

  async function hydrateDetectorSuggestion(candidate: DetectorCandidate): Promise<void> {
    if (detectorSuggestions[candidate.id]) return
    const frameImageDataUrl = captureVideoFrameDataUrl(videoRef.current)
    if (!frameImageDataUrl) {
      setDetectorStatus(`YOLO candidates loaded; Qdrant suggestion skipped for ${candidate.trackId} because the current video frame is unavailable.`)
      return
    }
    try {
      const response = await fetch('/api/projects/watch/detector-candidates/suggest-label', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          asset_uid: resolvedAssetUid,
          row_index: row.index,
          track_id: candidate.trackId,
          bbox: candidate.bbox,
          time_seconds: candidate.timeSeconds,
          image_data_url: frameImageDataUrl,
          allowed_characters: characterOptions.map((option) => ({
            character_name: option.name,
            actor_name: option.actorName || actorLookup(option.name),
          })),
        }),
      })
      const payload = await readJsonResponse(response) as DetectorSuggestionPayload
      if (!response.ok || payload.ok === false) {
        throw new Error(payload.error || payload.detail || `detector_suggestion_http_${response.status}`)
      }
      const suggestion = payload.suggestion
      const characterName = suggestion?.character_name?.trim()
      if (!characterName || characterKey(characterName) === 'unassigned') {
        setDetectorStatus(`YOLO candidates loaded; no Qdrant label suggestion for ${candidate.trackId}.`)
        return
      }
      const actorName = suggestion?.actor_name?.trim() || actorLookup(characterName)
      const confidence = typeof suggestion?.confidence === 'number' && Number.isFinite(suggestion.confidence)
        ? suggestion.confidence
        : undefined
      const suggestedAssignment: DetectorCandidateAssignment = {
        characterName,
        actorName,
        source: 'suggested',
        confidence,
        evidenceCount: typeof suggestion?.neighbor_count === 'number' ? suggestion.neighbor_count : undefined,
      }
      setDetectorSuggestions((current) => ({
        ...current,
        [candidate.id]: suggestedAssignment,
      }))
      const confidenceText = typeof confidence === 'number' ? ` ${confidence.toFixed(2)}` : ''
      setDetectorStatus(`YOLO candidates loaded; Qdrant suggests ${characterName}?${confidenceText} for ${candidate.trackId}.`)
    } catch (error) {
      setDetectorStatus(`YOLO candidates loaded; Qdrant suggestion failed for ${candidate.trackId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function toggleVideoPlayback(): Promise<void> {
    const video = videoRef.current
    if (!video) return

    try {
      if (video.paused) {
        await video.play()
        setIsPlaying(true)
      } else {
        video.pause()
        setIsPlaying(false)
      }
    } catch (error) {
      setStatus(`Playback failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function onCharacterChange(event: React.ChangeEvent<HTMLSelectElement>): void {
    const name = event.target.value
    const option = characterOptions.find((candidate) => candidate.name === name)
    event.currentTarget.blur()
    setSession((current) => {
      const next = setSelectedCharacter(current, name, option?.actorName || actorLookup(name))
      if (!pendingTargetBbox) return next
      return { ...next, selectedOverlayId: PENDING_TARGET_OVERLAY_ID, revision: next.revision + 1 }
    })
    if (pendingTargetBbox) {
      setStatus(`New annotation target assigned to ${name}. Save the target when ready.`)
    } else if (selectedDetectorCandidate) {
      setStatus(`${selectedDetectorCandidate.trackId} assigned to ${name}. Save the YOLO target when ready, or reset to ${detectorBaseLabel(selectedDetectorCandidate)}.`)
    }
  }

  function onActorNameChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const actorName = event.target.value
    setSession((current) => {
      const next = setSelectedCharacter(current, current.selectedCharacterName, actorName)
      if (!pendingTargetBbox) return next
      return { ...next, selectedOverlayId: PENDING_TARGET_OVERLAY_ID, revision: next.revision + 1 }
    })
  }

  function onVideoTimeUpdate(event: React.SyntheticEvent<HTMLVideoElement>): void {
    const currentTime = event.currentTarget.currentTime
    setSession((current) => setPlayheadSeconds(current, currentTime))
  }

  function onTimelineChange(event: React.ChangeEvent<HTMLInputElement>): void {
    setVideoTime(Number(event.target.value))
  }

  function onTimelineInput(event: React.FormEvent<HTMLInputElement>): void {
    setVideoTime(Number(event.currentTarget.value))
  }

  function selectDetectorCandidate(candidate: DetectorCandidate): void {
    const assignment = detectorCandidateAssignments.get(candidate.id) || findSavedDetectorAssignment(candidate)
    if (!assignment) void hydrateDetectorSuggestion(candidate)
    const nextCharacterName = assignment?.characterName || 'Unassigned'
    const nextActorName = assignment?.actorName || actorLookup(nextCharacterName)
    setManualAnnotationEnabled(false)
    setInlineLabelEditorCandidateId(null)
    setSelectedDetectorCandidateId(candidate.id)
    setPendingTargetBbox(null)
    setDraftBbox(null)
    setSession((state) => ({
      ...setSelectedCharacter(setPlayheadSeconds(state, candidate.timeSeconds), nextCharacterName, nextActorName),
      selectedOverlayId: null,
      revision: state.revision + 1,
    }))
    setVideoTime(candidate.timeSeconds)
    setStatus(assignment
      ? assignment.source === 'suggested'
        ? `${candidate.trackId} suggestion: ${detectorAssignmentLabel(candidate, assignment)}. Accept, change, or reset to ${detectorBaseLabel(candidate)}.`
        : `${candidate.trackId} is ${assignment.source === 'propagated' ? 'propagated as' : 'labeled'} ${assignment.characterName}. Change, save, or reset to ${detectorBaseLabel(candidate)}.`
      : `YOLO ${candidate.detectedClass} box ${candidate.trackId} selected. Choose the character, then save.`)
  }

  function openDetectorLabelEditor(candidate: DetectorCandidate): void {
    const assignment = detectorCandidateAssignments.get(candidate.id) || findSavedDetectorAssignment(candidate)
    if (!assignment) void hydrateDetectorSuggestion(candidate)
    const nextCharacterName = assignment?.characterName || 'Unassigned'
    const nextActorName = assignment?.actorName || actorLookup(nextCharacterName)
    setManualAnnotationEnabled(false)
    setSelectedDetectorCandidateId(candidate.id)
    setInlineLabelEditorCandidateId((current) => current === candidate.id ? null : candidate.id)
    setPendingTargetBbox(null)
    setDraftBbox(null)
    setSession((state) => ({
      ...setSelectedCharacter(setPlayheadSeconds(state, candidate.timeSeconds), nextCharacterName, nextActorName),
      selectedOverlayId: null,
      revision: state.revision + 1,
    }))
    setVideoTime(candidate.timeSeconds)
    setStatus(assignment
      ? assignment.source === 'suggested'
        ? `${candidate.trackId} suggestion: ${detectorAssignmentLabel(candidate, assignment)}. Pick a character to accept/change it, or choose ${detectorBaseLabel(candidate)} to reject.`
        : `${candidate.trackId} is ${assignment.source === 'propagated' ? 'propagated as' : 'labeled'} ${assignment.characterName}. Pick another character here, or choose ${detectorBaseLabel(candidate)} to reset.`
      : `${candidate.trackId} is unlabeled. Pick a character from the label menu.`)
  }

  function onViewportPointerDown(event: React.PointerEvent<HTMLElement>): void {
    if (event.button !== 0 || saving || manipulationRef.current) return
    if (!manualDrawEnabled) return
    if (!session.selectedCharacterName || characterKey(session.selectedCharacterName) === 'unassigned') return
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const localY = event.clientY - rect.top
    if (localY > rect.height * 0.92) return
    const point = pointerInElement(event, rect)
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDrawStart(point)
    setDraftBbox([point.x / rect.width, point.y / rect.height, point.x / rect.width, point.y / rect.height])
  }

  function deferOverlayClickOrDraw(event: React.PointerEvent<HTMLDivElement>, overlay: WatchAnnotationOverlay): void {
    const rect = viewportRef.current?.getBoundingClientRect()
    const viewport = viewportRef.current
    if (!rect || !viewport) return
    if (!manualDrawEnabled) {
      event.preventDefault()
      event.stopPropagation()
      setSession((current) => selectOverlay(current, overlay))
      return
    }
    const selectedKey = characterKey(session.selectedCharacterName)
    if (!session.selectedCharacterName || selectedKey === 'unassigned') {
      event.preventDefault()
      event.stopPropagation()
      setSession((current) => selectOverlay(current, overlay))
      return
    }

    event.preventDefault()
    event.stopPropagation()
    viewport.setPointerCapture(event.pointerId)
    pendingOverlayPointerRef.current = {
      pointerId: event.pointerId,
      overlay,
      startPoint: pointerInElement(event, rect),
    }
  }

  function onViewportPointerMove(event: React.PointerEvent<HTMLElement>): void {
    const pending = pendingOverlayPointerRef.current
    if (pending && pending.pointerId === event.pointerId) {
      if (!manualDrawEnabled) {
        pendingOverlayPointerRef.current = null
        return
      }
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!rect) return
      const point = pointerInElement(event, rect)
      const moved = Math.hypot(point.x - pending.startPoint.x, point.y - pending.startPoint.y)
      if (moved < 4) return
      pendingOverlayPointerRef.current = null
      event.stopPropagation()
      setDrawStart(pending.startPoint)
      setDraftBbox(normalizeDragBbox(pending.startPoint, point, rect))
      return
    }

    if (!drawStart || !manualDrawEnabled) return
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const point = pointerInElement(event, rect)
    event.stopPropagation()
    setDraftBbox(normalizeDragBbox(drawStart, point, rect))
  }

  function onViewportPointerUp(event: React.PointerEvent<HTMLElement>): void {
    const pending = pendingOverlayPointerRef.current
    if (pending && pending.pointerId === event.pointerId) {
      pendingOverlayPointerRef.current = null
      event.stopPropagation()
      setSession((current) => selectOverlay(current, pending.overlay))
      return
    }

    if (!drawStart || !manualDrawEnabled) {
      if (drawStart) {
        setDrawStart(null)
        setDraftBbox(null)
      }
      return
    }
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    const point = pointerInElement(event, rect)
    const bbox = normalizeDragBbox(drawStart, point, rect)
    event.stopPropagation()
    setDrawStart(null)
    if (bbox[2] - bbox[0] < 0.015 || bbox[3] - bbox[1] < 0.015) {
      setDraftBbox(null)
      setStatus('Draw a larger box before saving a keyframe.')
      return
    }
    void saveDrawnKeyframe(bbox)
  }

  function startMove(event: React.PointerEvent<HTMLDivElement>, overlay: WatchAnnotationOverlay): void {
    event.preventDefault()
    event.stopPropagation()
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointerInElement(event, rect)
    const exactKeyframeId = overlay.isExactKeyframe ? overlay.exactKeyframeId : null
    const pendingTarget = overlay.kind === 'pending'
    const nextManipulation: ManipulationState = {
      pointerId: event.pointerId,
      mode: 'move',
      keyframeId: exactKeyframeId || runtimeEditKeyframeId(row.index, overlay.characterKey),
      createsKeyframe: !exactKeyframeId && !pendingTarget,
      pendingTarget,
      characterName: overlay.characterName,
      actorName: overlay.actorName,
      timeSeconds: overlay.timeSeconds,
      startBbox: overlay.bbox,
      latestBbox: overlay.bbox,
      startPoint: point,
    }
    manipulationRef.current = nextManipulation
    setManipulation(nextManipulation)
    setSession((current) => selectOverlay(current, overlay))
  }

  function startResize(event: React.PointerEvent<HTMLDivElement>, overlay: WatchAnnotationOverlay, handle: DragHandle): void {
    event.preventDefault()
    event.stopPropagation()
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointerInElement(event, rect)
    const exactKeyframeId = overlay.isExactKeyframe ? overlay.exactKeyframeId : null
    const pendingTarget = overlay.kind === 'pending'
    const nextManipulation: ManipulationState = {
      pointerId: event.pointerId,
      mode: 'resize',
      handle,
      keyframeId: exactKeyframeId || runtimeEditKeyframeId(row.index, overlay.characterKey),
      createsKeyframe: !exactKeyframeId && !pendingTarget,
      pendingTarget,
      characterName: overlay.characterName,
      actorName: overlay.actorName,
      timeSeconds: overlay.timeSeconds,
      startBbox: overlay.bbox,
      latestBbox: overlay.bbox,
      startPoint: point,
    }
    manipulationRef.current = nextManipulation
    setManipulation(nextManipulation)
    setSession((current) => selectOverlay(current, overlay))
  }

  const commitManipulation = useCallback(async (finished: ManipulationState): Promise<void> => {
    const current = sessionRef.current
    if (!current) return
    if (finished.pendingTarget) {
      if (!sameBbox(finished.latestBbox, finished.startBbox)) {
        setPendingTargetBbox(finished.latestBbox)
        setDraftBbox(finished.latestBbox)
        setSession((state) => ({ ...state, selectedOverlayId: PENDING_TARGET_OVERLAY_ID, revision: state.revision + 1 }))
        setStatus('New annotation target adjusted. Choose the character, then save the target.')
      }
      return
    }
    const track = current.tracks[characterKey(finished.characterName)]
    const keyframe = track?.keyframes.find((candidate) => candidate.id === finished.keyframeId)
    if (sameBbox(finished.latestBbox, finished.startBbox)) return
    const persistedKeyframe = keyframe || {
      id: finished.keyframeId,
      recordId: finished.keyframeId,
      assetUid: resolvedAssetUid,
      characterName: finished.characterName,
      actorName: finished.actorName,
      bbox: finished.latestBbox,
      timeSeconds: finished.timeSeconds,
    }
    const keyframeToSave = { ...persistedKeyframe, bbox: finished.latestBbox, timeSeconds: finished.timeSeconds }
    setSaving(true)
    setStatus(`Saving edited keyframe for ${keyframeToSave.characterName}...`)
    try {
      await persistKeyframe(keyframeToSave)
      await hydrateRow()
      setStatus(`Edited keyframe saved for ${keyframeToSave.characterName}.`)
    } catch (error) {
      setStatus(`Edit save failed: ${error instanceof Error ? error.message : String(error)}`)
      await hydrateRow()
    } finally {
      setSaving(false)
    }
  }, [hydrateRow])

  useEffect(() => {
    function onPointerMove(event: PointerEvent): void {
      const current = manipulationRef.current
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!current || !rect || event.pointerId !== current.pointerId) return

      const point = pointerInElement(event, rect)
      const dx = (point.x - current.startPoint.x) / rect.width
      const dy = (point.y - current.startPoint.y) / rect.height
      const bbox = current.mode === 'move'
        ? moveBbox(current.startBbox, dx, dy)
        : resizeBbox(current.startBbox, current.handle || 'se', dx, dy)

      const nextManipulation = { ...current, latestBbox: bbox }
      manipulationRef.current = nextManipulation
      setManipulation(nextManipulation)
      if (current.pendingTarget) {
        setPendingTargetBbox(bbox)
        setDraftBbox(bbox)
        setSession((state) => ({ ...state, selectedOverlayId: PENDING_TARGET_OVERLAY_ID, revision: state.revision + 1 }))
        return
      }
      setSession((state) => {
        if (!current.createsKeyframe) {
          return updateKeyframeBbox(state, current.keyframeId, bbox)
        }
        const next = upsertHumanKeyframe(state, {
          id: current.keyframeId,
          recordId: current.keyframeId,
          assetUid: resolvedAssetUid,
          characterName: current.characterName,
          actorName: current.actorName,
          bbox,
          timeSeconds: current.timeSeconds,
        })
        return {
          ...next,
          selectedOverlayId: `exact:${characterKey(current.characterName)}:${current.keyframeId}`,
        }
      })
    }

    function onPointerUp(event: PointerEvent): void {
      const current = manipulationRef.current
      if (!current || event.pointerId !== current.pointerId) return
      setManipulation(null)
      manipulationRef.current = null
      void commitManipulation(current)
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [commitManipulation, resolvedAssetUid])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (isTypingTarget(event.target)) return
      const current = sessionRef.current
      if (!current) return

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        void deleteVisibleSelection()
        return
      }

      if (event.key === ' ' || event.key === 'Spacebar') {
        if (isInteractiveFormTarget(event.target)) return
        event.preventDefault()
        void toggleVideoPlayback()
        return
      }

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (isInteractiveFormTarget(event.target)) return
        event.preventDefault()
        frameStepFromCurrent(event.key === 'ArrowLeft' ? -1 : 1)
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  })

  const selectedTrack = session.tracks[characterKey(session.selectedCharacterName)]
  const characterSelectOptions = useMemo(() => {
    const fromTracks = Object.values(session.tracks).map((track) => ({
      name: track.characterName,
      actorName: track.actorName,
    }))
    return normalizeCharacterOptions(row, [...characterOptions, ...fromTracks])
  }, [characterOptions, row, session.tracks])

  return (
    <section
      data-qid="watch:annotation-island"
      style={{
        display: 'grid',
        gridTemplateRows: 'auto minmax(0, 1fr) auto',
        gap: 12,
        width: 'min(1180px, calc(100vw - 32px))',
        maxHeight: 'calc(100vh - 32px)',
        background: '#070b12',
        border: '1px solid rgba(148,163,184,0.24)',
        borderRadius: 16,
        boxShadow: '0 28px 80px rgba(0,0,0,0.55)',
        color: '#e5eefb',
        padding: 14,
        overflow: 'hidden',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ color: '#67e8f9', fontSize: 11, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            Watch annotation session island
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
            <strong style={{ fontSize: 20, fontVariantNumeric: 'tabular-nums' }}>{row.timecode}</strong>
            <span style={{ color: '#94a3b8', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              row {row.index} · {row.movie_segment || 'single frame'} · {stats.exactKeyframes} exact · {stats.controls} controls
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            data-qid="watch:annotation-island:manual-annotation-toggle"
            data-qs-action="WATCH_ANNOTATION_TOGGLE_MANUAL_DRAW"
            aria-label={manualAnnotationEnabled ? 'Disable manual annotation drawing' : 'Enable manual annotation drawing'}
            title={manualAnnotationEnabled ? 'Disable manual annotation drawing' : 'Enable manual annotation drawing for objects or missed people'}
            aria-pressed={manualAnnotationEnabled}
            onClick={() => {
              setManualAnnotationEnabled((enabled) => {
                const next = !enabled
                setStatus(next
                  ? 'Manual annotation drawing enabled. Draw on the video only for objects or missed detections.'
                  : 'Manual annotation drawing disabled. Use YOLO person boxes for character annotation.'
                )
                return next
              })
            }}
            style={iconButtonStyle(true)}
          >
            <Pencil size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            data-qid="watch:annotation-island:snapshot"
            data-qs-action="WATCH_ANNOTATION_SNAPSHOT"
            aria-label="Copy annotation snapshot to clipboard"
            title="Copy current scene and annotation state snapshot to clipboard"
            onClick={() => void copyAnnotationSnapshotToClipboard()}
            style={iconButtonStyle(true)}
          >
            <Camera size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            data-qid="watch:annotation-island:selected-delete"
            data-qs-action="WATCH_ANNOTATION_DELETE_SELECTION"
            aria-label="Delete or close selected annotation"
            title={activeOverlay?.isExactKeyframe ? 'Delete selected exact keyframe' : 'Close selected annotation sequence at this frame'}
            onClick={() => void deleteVisibleSelection()}
            disabled={saving || !activeOverlay}
            style={iconButtonStyle(!saving && Boolean(activeOverlay), true)}
          >
            <Trash2 size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            data-qid="watch:annotation-island:refresh"
            data-qs-action="WATCH_ANNOTATION_REFRESH"
            title="Refresh live row annotations"
            onClick={() => void hydrateRow()}
            disabled={loading || saving}
            style={buttonStyle(!loading && !saving)}
          >
            {loading ? 'Loading' : 'Refresh'}
          </button>
          {onClose ? (
            <button
              type="button"
              data-qid="watch:annotation-island:close"
              data-qs-action="WATCH_ANNOTATION_CLOSE"
              title="Close annotation session"
              onClick={onClose}
              style={{
                ...buttonStyle(true),
                padding: '8px 12px',
              }}
            >
              Close
            </button>
          ) : null}
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 310px', gap: 14, minHeight: 0 }}>
        <div style={{ minWidth: 0, display: 'grid', gridTemplateRows: 'minmax(0, 1fr) auto', gap: 10 }}>
          <div
            ref={viewportRef}
            data-qid="watch:annotation-island:viewport"
            onPointerDown={onViewportPointerDown}
            onPointerMove={onViewportPointerMove}
            onPointerUp={onViewportPointerUp}
            onPointerCancel={onViewportPointerUp}
            style={{
              position: 'relative',
              minHeight: 420,
              borderRadius: 12,
              overflow: 'hidden',
              background: '#020617',
              border: '1px solid rgba(148,163,184,0.18)',
              cursor: manualDrawEnabled && characterKey(session.selectedCharacterName) !== 'unassigned' ? 'crosshair' : 'default',
            }}
          >
            {effectiveVideoSrc ? (
              <video
                ref={videoRef}
                data-qid="watch:annotation-island:video"
                src={effectiveVideoSrc}
                preload="auto"
                playsInline
                controls
                onLoadedMetadata={(event) => {
                  const currentTime = event.currentTarget.currentTime || 0
                  const width = event.currentTarget.videoWidth || 1280
                  const height = event.currentTarget.videoHeight || 696
                  setVideoDimensions((current) => (
                    current.width === width && current.height === height ? current : { width, height }
                  ))
                  setSession((current) => setPlayheadSeconds(current, currentTime))
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onTimeUpdate={onVideoTimeUpdate}
                style={{ display: 'block', width: '100%', height: '100%', minHeight: 420, objectFit: 'contain', background: '#000' }}
              />
            ) : effectiveThumbnailSrc ? (
              <img
                src={effectiveThumbnailSrc}
                alt=""
                style={{ display: 'block', width: '100%', height: '100%', minHeight: 420, objectFit: 'contain', background: '#000' }}
              />
            ) : (
              <div style={{ display: 'grid', placeItems: 'center', minHeight: 420, color: '#64748b', fontSize: 13 }}>
                No video or frame image available for this row.
              </div>
            )}

            <div
              data-qid="watch:annotation-island:draw-surface"
              data-qs-action="WATCH_ANNOTATION_DRAW_ON_FRAME"
              title={manualDrawEnabled ? 'Draw an exact keyframe box on the current frame' : 'Manual drawing disabled while YOLO person boxes are available'}
              onPointerDown={onViewportPointerDown}
              onPointerMove={onViewportPointerMove}
              onPointerUp={onViewportPointerUp}
              onPointerCancel={onViewportPointerUp}
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: 0,
                bottom: '8%',
                zIndex: 6,
                cursor: manualDrawEnabled && characterKey(session.selectedCharacterName) !== 'unassigned' ? 'crosshair' : 'default',
                background: 'transparent',
                pointerEvents: manualDrawEnabled ? 'auto' : 'none',
              }}
            />

            {visibleDetectorCandidates.map((candidate) => {
              const detectorCandidateInteractive = !pendingTargetBbox
              const selectedDetectorCandidate = selectedDetectorCandidateId === candidate.id
              const detectorAssignment = detectorCandidateAssignments.get(candidate.id)
              const assignedDetectorCandidate = Boolean(detectorAssignment)
              return (
              <button
                key={candidate.id}
                type="button"
                data-qid="watch:annotation-island:detector-candidate"
                data-track-id={candidate.trackId}
                data-detected-class={candidate.detectedClass}
                data-runtime-policy={candidate.runtimePolicy || ''}
                data-assigned-character={detectorAssignment?.characterName || ''}
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  selectDetectorCandidate(candidate)
                }}
                style={{
                  ...bboxDisplayStyle(candidate.bbox),
                  position: 'absolute',
                  border: selectedDetectorCandidate
                    ? '2px solid #fbbf24'
                    : assignedDetectorCandidate
                      ? '2px solid #a78bfa'
                      : '2px dashed #22d3ee',
                  background: selectedDetectorCandidate
                    ? 'rgba(251,191,36,0.08)'
                    : assignedDetectorCandidate
                      ? 'rgba(167,139,250,0.08)'
                      : 'rgba(34,211,238,0.055)',
                  boxShadow: selectedDetectorCandidate
                    ? '0 0 0 2px rgba(255,255,255,0.34), 0 0 26px rgba(251,191,36,0.42)'
                    : assignedDetectorCandidate
                      ? '0 0 22px rgba(167,139,250,0.24)'
                      : '0 0 22px rgba(34,211,238,0.24)',
                  borderRadius: 2,
                  boxSizing: 'border-box',
                  zIndex: selectedDetectorCandidate ? 58 : detectorCandidateInteractive ? 50 : 14,
                  pointerEvents: detectorCandidateInteractive ? 'auto' : 'none',
                  cursor: detectorCandidateInteractive ? 'copy' : 'default',
                  padding: 0,
                }}
                title={detectorAssignment
                  ? `${candidate.trackId} ${candidate.runtimePolicy || 'raw'} ${detectorAssignment.source} ${detectorAssignment.characterName}`
                  : `YOLO ${candidate.detectedClass} ${candidate.trackId} ${candidate.runtimePolicy || 'raw'}; select as annotation target`}
              />
              )
            })}

            {visibleDetectorCandidates.map((candidate) => {
              const [x1, y1] = candidate.bbox
              const selectedDetectorCandidate = selectedDetectorCandidateId === candidate.id
              const detectorAssignment = detectorCandidateAssignments.get(candidate.id)
              const detectorLabel = detectorAssignmentLabel(candidate, detectorAssignment)
              const assignedDetectorCandidate = Boolean(detectorAssignment)
              return (
                <React.Fragment key={`${candidate.id}:label-fragment`}>
                <button
                  type="button"
                  data-qid="watch:annotation-island:detector-candidate-label"
                  data-track-id={candidate.trackId}
                  data-runtime-policy={candidate.runtimePolicy || ''}
                  data-assigned-character={detectorAssignment?.characterName || ''}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    openDetectorLabelEditor(candidate)
                  }}
                  style={{
                    position: 'absolute',
                    left: `calc(${x1 * 100}% - 2px)`,
                    top: `max(4px, calc(${y1 * 100}% - 24px))`,
                    zIndex: 180,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    maxWidth: 300,
                    padding: '3px 7px',
                    borderRadius: 5,
                    background: selectedDetectorCandidate ? '#fbbf24' : assignedDetectorCandidate ? '#312e81' : '#083344',
                    border: selectedDetectorCandidate ? '1px solid #fbbf24' : assignedDetectorCandidate ? '1px solid #a78bfa' : '1px solid #22d3ee',
                    color: selectedDetectorCandidate ? '#111827' : assignedDetectorCandidate ? '#ede9fe' : '#cffafe',
                    fontSize: 10,
                    fontWeight: 950,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 6px 18px rgba(0,0,0,0.32)',
                    pointerEvents: 'auto',
                    cursor: 'pointer',
                  }}
                >
                  {detectorLabel}
                </button>
                {inlineLabelEditorCandidateId === candidate.id ? (
                  <>
                  <select
                    data-qid="watch:annotation-island:inline-detector-label-select"
                    data-track-id={candidate.trackId}
                    autoFocus
                    value={detectorAssignment && detectorAssignment.source !== 'pending' ? detectorAssignment.characterName : 'Unassigned'}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                    }}
                    onChange={(event) => {
                      void saveDetectorCandidateLabel(candidate, event.currentTarget.value)
                    }}
                    onBlur={() => {
                      window.setTimeout(() => setInlineLabelEditorCandidateId((current) => (
                        current === candidate.id ? null : current
                      )), 120)
                    }}
                    style={{
                      position: 'absolute',
                      left: `calc(${x1 * 100}% - 2px)`,
                      top: `max(32px, calc(${y1 * 100}% + 4px))`,
                      zIndex: 190,
                      width: 190,
                      borderRadius: 8,
                      border: '1px solid rgba(34,211,238,0.72)',
                      background: '#020617',
                      color: '#e5eefb',
                      padding: '8px 10px',
                      fontSize: 12,
                      fontWeight: 800,
                      boxShadow: '0 16px 34px rgba(0,0,0,0.52)',
                      pointerEvents: 'auto',
                    }}
                  >
                    <option value="Unassigned">{detectorBaseLabel(candidate)}</option>
                    {characterSelectOptions.filter((option) => characterKey(option.name) !== 'unassigned').map((option) => (
                      <option key={`${candidate.id}:${characterKey(option.name)}`} value={option.name}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    data-qid="watch:annotation-island:inline-detector-label-reset"
                    data-track-id={candidate.trackId}
                    onPointerDown={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      void clearDetectorCandidateLabel(candidate)
                    }}
                    onClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      void clearDetectorCandidateLabel(candidate)
                    }}
                    disabled={saving}
                    style={{
                      position: 'absolute',
                      left: `calc(${x1 * 100}% - 2px)`,
                      top: `max(76px, calc(${y1 * 100}% + 42px))`,
                      zIndex: 191,
                      width: 190,
                      borderRadius: 8,
                      border: '1px solid rgba(248,113,113,0.72)',
                      background: 'rgba(69,10,10,0.94)',
                      color: '#fecaca',
                      padding: '7px 10px',
                      fontSize: 11,
                      fontWeight: 900,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      boxShadow: '0 16px 34px rgba(0,0,0,0.52)',
                      pointerEvents: saving ? 'none' : 'auto',
                      cursor: saving ? 'default' : 'pointer',
                    }}
                  >
                    Reset to {detectorBaseLabel(candidate)}
                  </button>
                  </>
                ) : null}
                </React.Fragment>
              )
            })}

            {displayedOverlays.map((overlay) => {
              const exact = overlay.kind === 'exact'
              const pending = overlay.kind === 'pending'
              const selected = activeOverlay?.id === overlay.id
              const overlayInteractive = pending || !detectorFirstMode
              const runtimeColor = pending ? '#2dd4bf' : overlay.kind === 'interpolated' ? '#38bdf8' : '#a78bfa'
              const borderColor = selected ? '#fbbf24' : runtimeColor
              const zIndex = pending && selected
                ? 60
                : selected
                  ? 120
                : exact
                  ? 90
                  : 80
              const label = exact ? 'Exact keyframe' : pending ? 'New annotation target' : overlay.kind === 'interpolated' ? 'Runtime interpolation' : 'Runtime held'
              return (
                <div
                  key={overlay.id}
                  data-qid="watch:annotation-island:overlay"
                  data-character={overlay.characterName}
                  data-overlay-kind={overlay.kind}
                  data-exact={exact ? 'true' : 'false'}
                  data-selected={selected ? 'true' : 'false'}
                  onPointerDown={(event) => {
                    deferOverlayClickOrDraw(event, overlay)
                  }}
                  style={{
                    ...bboxDisplayStyle(overlay.bbox),
                    position: 'absolute',
                    border: selected || exact ? `2px solid ${borderColor}` : `2px dashed ${borderColor}`,
                    background: selected ? 'rgba(251,191,36,0.075)' : 'rgba(14,165,233,0.045)',
                    boxShadow: selected ? `0 0 0 2px rgba(255,255,255,0.42), 0 0 28px ${borderColor}55` : `0 0 18px ${borderColor}33`,
                    borderRadius: 2,
                    boxSizing: 'border-box',
                    zIndex,
                    pointerEvents: overlayInteractive ? 'auto' : 'none',
                    cursor: overlayInteractive ? 'crosshair' : 'default',
                  }}
                  title={`${label}: ${overlay.characterName}`}
                >
                  <div
                    data-qid="watch:annotation-island:overlay-label"
                    style={{
                      position: 'absolute',
                      left: -2,
                      top: 0,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      maxWidth: 360,
                      padding: '3px 7px',
                      borderRadius: 5,
                      background: selected ? '#fbbf24' : '#0f172a',
                      border: selected ? 'none' : `1px solid ${borderColor}`,
                      color: selected ? '#020617' : '#e5eefb',
                      fontSize: 10,
                      fontWeight: 950,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      whiteSpace: 'nowrap',
                      boxShadow: '0 6px 18px rgba(0,0,0,0.32)',
                      zIndex: 220,
                      pointerEvents: 'none',
                      cursor: 'inherit',
                    }}
                  >
                    <span>{overlay.characterName}</span>
                    <span style={{ opacity: 0.72 }}>{exact ? 'exact' : pending ? 'target' : overlay.kind}</span>
                  </div>
                  {selected ? (
                    <div
                      data-qid="watch:annotation-island:overlay-move-handle"
                      data-qs-action="WATCH_ANNOTATION_MOVE_KEYFRAME"
                      title={`Move ${overlay.characterName} annotation`}
                      aria-label={`Move ${overlay.characterName} annotation`}
                      onPointerDown={(event) => startMove(event, overlay)}
                      style={{
                        position: 'absolute',
                        right: -10,
                        top: -10,
                        display: 'grid',
                        placeItems: 'center',
                        width: 18,
                        height: 18,
                        borderRadius: 5,
                        background: '#fbbf24',
                        border: '1px solid rgba(2,6,23,0.4)',
                        color: '#020617',
	                        boxShadow: '0 6px 18px rgba(0,0,0,0.38)',
	                        zIndex: zIndex + 3,
	                        pointerEvents: overlayInteractive ? 'auto' : 'none',
	                        cursor: 'move',
	                      }}
                    >
                      <Move size={12} aria-hidden="true" />
                    </div>
                  ) : null}
                  {selected ? HANDLE_ITEMS.map((item) => (
                    <div
                      key={item.handle}
                      data-qid="watch:annotation-island:resize-handle"
                      data-handle={item.handle}
                      aria-label={`Resize ${item.label}`}
                      onPointerDown={(event) => startResize(event, overlay, item.handle)}
                      style={{
                        position: 'absolute',
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        border: '1px solid #020617',
	                        background: '#fbbf24',
	                        boxShadow: '0 0 0 1px rgba(251,191,36,0.55)',
	                        zIndex: zIndex + 1,
	                        pointerEvents: overlayInteractive ? 'auto' : 'none',
	                        ...item.style,
	                      }}
                    />
                  )) : null}
                </div>
              )
            })}

            {draftBbox && !pendingTargetBbox ? (
              <div
                data-qid="watch:annotation-island:draft-bbox"
                style={{
                  ...bboxStyle(draftBbox),
                  position: 'absolute',
                  border: '2px solid #2dd4bf',
                  background: 'rgba(45,212,191,0.08)',
                  boxShadow: '0 0 24px rgba(45,212,191,0.24)',
                  pointerEvents: 'none',
                  zIndex: 12,
                }}
              />
            ) : null}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr auto', alignItems: 'center', gap: 10 }}>
            <button
              type="button"
              data-qid="watch:annotation-island:play-toggle"
              onClick={() => void toggleVideoPlayback()}
              style={{ ...buttonStyle(Boolean(effectiveVideoSrc)), display: 'inline-flex', alignItems: 'center', gap: 7 }}
              disabled={!effectiveVideoSrc}
              title="Play or pause this clip"
            >
              {isPlaying ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
              {isPlaying ? 'Pause' : 'Play'}
            </button>
            <button type="button" onClick={() => frameStep(-1)} style={buttonStyle(true)}>
              -1 frame
            </button>
            <input
              data-qid="watch:annotation-island:timeline"
              type="range"
              min={0}
              max={segmentDuration}
              step={1 / 24}
              value={Math.max(0, Math.min(segmentDuration, session.playheadSeconds))}
              onInput={onTimelineInput}
              onChange={onTimelineChange}
              style={{ width: '100%' }}
            />
            <button type="button" onClick={() => frameStep(1)} style={buttonStyle(true)}>
              +1 frame
            </button>
          </div>
        </div>

        <aside style={{ display: 'grid', alignContent: 'start', gap: 12, minWidth: 0 }}>
          <section style={{ border: '1px solid rgba(148,163,184,0.16)', borderRadius: 12, padding: 12, background: 'rgba(15,23,42,0.72)' }}>
            <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
              Selected character
            </div>
            <select
              ref={characterSelectRef}
              data-qid="watch:annotation-island:character-select"
              value={session.selectedCharacterName}
              onChange={onCharacterChange}
              style={{
                width: '100%',
                borderRadius: 8,
                border: '1px solid rgba(148,163,184,0.24)',
                background: '#020617',
                color: '#e5eefb',
                padding: '9px 10px',
                fontWeight: 800,
              }}
            >
              {characterSelectOptions.map((option) => (
                <option key={characterKey(option.name)} value={option.name}>
                  {option.name}
                </option>
              ))}
            </select>
            <input
              data-qid="watch:annotation-island:actor-input"
              value={session.selectedActorName || selectedTrack?.actorName || ''}
              onChange={onActorNameChange}
              placeholder="Actor name"
              style={{
                width: '100%',
                marginTop: 8,
                boxSizing: 'border-box',
                borderRadius: 8,
                border: '1px solid rgba(148,163,184,0.18)',
                background: '#020617',
                color: '#cbd5e1',
                padding: '9px 10px',
              }}
            />
            {pendingTargetBbox || selectedDetectorCandidate ? (
              <div
                data-qid="watch:annotation-island:new-target-panel"
                style={{
                  marginTop: 10,
                  paddingTop: 10,
                  borderTop: '1px solid rgba(148,163,184,0.16)',
                  display: 'grid',
                  gap: 8,
                }}
              >
                <div style={{ color: '#2dd4bf', fontSize: 11, fontWeight: 900, textTransform: 'uppercase' }}>
                  {selectedDetectorCandidate ? `YOLO annotation target ${selectedDetectorCandidate.trackId}` : 'New annotation target'}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button
                    type="button"
                    data-qid="watch:annotation-island:save-new-target"
                    data-qs-action="WATCH_ANNOTATION_SAVE_NEW_TARGET"
                    onClick={() => {
                      if (selectedDetectorCandidate) {
                        void saveDetectorCandidateLabel(selectedDetectorCandidate, session.selectedCharacterName)
                        return
                      }
                      void savePendingTarget()
                    }}
                    disabled={saving || characterKey(session.selectedCharacterName) === 'unassigned'}
                    style={buttonStyle(!saving && characterKey(session.selectedCharacterName) !== 'unassigned')}
                  >
                    Save target
                  </button>
                  <button
                    type="button"
                    data-qid="watch:annotation-island:cancel-new-target"
                    data-qs-action="WATCH_ANNOTATION_CANCEL_NEW_TARGET"
                    onClick={cancelPendingTarget}
                    disabled={saving}
                    style={buttonStyle(!saving)}
                  >
                    Cancel
                  </button>
                </div>
                {selectedDetectorAssignment ? (
                  <button
                    type="button"
                    data-qid="watch:annotation-island:clear-detector-label"
                    data-track-id={selectedDetectorCandidate?.trackId || ''}
                    data-assigned-character={selectedDetectorAssignment.characterName}
                    onClick={() => void clearSelectedDetectorLabel()}
                    disabled={saving}
                    style={buttonStyle(!saving, true)}
                  >
                    Reset to {selectedDetectorCandidate ? detectorBaseLabel(selectedDetectorCandidate) : 'YOLO track'}
                  </button>
                ) : null}
              </div>
            ) : null}
          </section>

          <section style={{ border: '1px solid rgba(148,163,184,0.16)', borderRadius: 12, padding: 12, background: 'rgba(15,23,42,0.72)' }}>
            <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
              Current frame
            </div>
            <div style={{ display: 'grid', gap: 7, fontSize: 12, color: '#cbd5e1' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span>Segment seconds</span>
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{session.playheadSeconds.toFixed(3)}s</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span>Clock</span>
                <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{secondsToClock(session.playheadSeconds)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span>Selected exact</span>
                <strong style={{ color: visibleExactSelectedKeyframe ? '#fbbf24' : '#64748b' }}>
                  {visibleExactSelectedKeyframe ? 'yes' : 'no'}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                <span>YOLO boxes</span>
                <strong style={{ color: visibleDetectorCandidates.length > 0 ? '#22d3ee' : '#64748b' }}>
                  {visibleDetectorCandidates.length}
                </strong>
              </div>
            </div>
          </section>

          <section style={{ border: '1px solid rgba(148,163,184,0.16)', borderRadius: 12, padding: 12, background: 'rgba(15,23,42,0.72)', minHeight: 74 }}>
            <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
              Status
            </div>
            <div
              data-qid="watch:annotation-island:status"
              style={{ color: status.startsWith('Hydration failed') || status.includes('failed') ? '#fca5a5' : '#cbd5e1', fontSize: 12, lineHeight: 1.45, wordBreak: 'break-word' }}
            >
              {saving ? 'Writing live API mutation... ' : null}
              {status}
            </div>
            {detectorStatus ? (
              <div style={{ color: detectorStatus.includes('unavailable') ? '#fca5a5' : '#94a3b8', fontSize: 11, lineHeight: 1.35, marginTop: 8 }}>
                {detectorStatus}
              </div>
            ) : null}
          </section>

          <section style={{ border: '1px solid rgba(148,163,184,0.16)', borderRadius: 12, padding: 12, background: 'rgba(15,23,42,0.72)', maxHeight: 150, overflow: 'auto' }}>
            <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
              YOLO person boxes
            </div>
            {visibleDetectorCandidates.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 12 }}>No detector boxes at this frame.</div>
            ) : visibleDetectorCandidates.map((candidate) => {
              const detectorAssignment = detectorCandidateAssignments.get(candidate.id)
              return (
                <button
                  key={candidate.id}
                  type="button"
                  data-qid="watch:annotation-island:detector-candidate-row"
                  data-track-id={candidate.trackId}
                  data-assigned-character={detectorAssignment?.characterName || ''}
                  onClick={() => selectDetectorCandidate(candidate)}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    width: '100%',
                    border: '0',
                    borderBottom: '1px solid rgba(148,163,184,0.08)',
                    background: 'transparent',
                    color: '#cffafe',
                    padding: '7px 0',
                    cursor: 'pointer',
                    textAlign: 'left',
                    fontSize: 12,
                  }}
                >
                  <span>{candidate.trackId}</span>
                  <strong style={{ color: detectorAssignment ? '#a78bfa' : '#22d3ee', textTransform: 'uppercase', fontSize: 10 }}>
                    {detectorAssignment?.source === 'pending'
                      ? 'Target'
                      : detectorAssignment?.source === 'suggested'
                        ? detectorAssignmentLabel(candidate, detectorAssignment)
                        : detectorAssignment?.characterName || candidate.detectedClass}
                  </strong>
                </button>
              )
            })}
          </section>

          <section style={{ border: '1px solid rgba(148,163,184,0.16)', borderRadius: 12, padding: 12, background: 'rgba(15,23,42,0.72)', maxHeight: 150, overflow: 'auto' }}>
            <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
              Identity readiness
            </div>
            {detectorReadinessLedger.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 12 }}>No accepted YOLO-linked labels yet.</div>
            ) : detectorReadinessLedger.map((entry) => (
              <div
                key={entry.characterName}
                data-qid="watch:annotation-island:identity-readiness-row"
                data-character={entry.characterName}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr auto',
                  gap: 8,
                  borderBottom: '1px solid rgba(148,163,184,0.08)',
                  padding: '7px 0',
                  color: '#cbd5e1',
                  fontSize: 12,
                }}
              >
                <span>{entry.characterName}</span>
                <strong style={{ color: entry.ready ? '#2dd4bf' : '#fbbf24', textTransform: 'uppercase', fontSize: 10 }}>
                  {entry.ready ? 'candidate' : 'collecting'}
                </strong>
                <span style={{ color: '#94a3b8', gridColumn: '1 / -1', fontSize: 11 }}>
                  {entry.accepted} accepted · {entry.embedded} embedded · {entry.rows} row{entry.rows === 1 ? '' : 's'} · {entry.tracks} track{entry.tracks === 1 ? '' : 's'}
                  {entry.suggested ? ` · ${entry.suggested} tentative` : ''}
                  {entry.rejected ? ` · ${entry.rejected} rejected` : ''}
                </span>
                <span style={{ color: entry.ready ? '#5eead4' : '#94a3b8', gridColumn: '1 / -1', fontSize: 11 }}>
                  {entry.ready
                    ? 'Enough accepted evidence for detector-box suggestions.'
                    : entry.missing.length > 0
                      ? `Need ${entry.missing.join(', ')}.`
                      : `Progress ${Math.round(entry.progress * 100)}%.`}
                </span>
              </div>
            ))}
            {identityReadinessStatus ? (
              <div
                data-qid="watch:annotation-island:identity-readiness-status"
                style={{
                  color: identityReadinessStatus.includes('unavailable') ? '#fca5a5' : '#94a3b8',
                  fontSize: 10,
                  lineHeight: 1.35,
                  marginTop: 8,
                }}
              >
                {identityReadinessStatus}
              </div>
            ) : null}
            <div style={{ color: '#64748b', fontSize: 10, lineHeight: 1.35, marginTop: 8 }}>
              Same-track labels propagate. Qdrant crop suggestions remain tentative until accepted.
            </div>
          </section>

          <section style={{ border: '1px solid rgba(148,163,184,0.16)', borderRadius: 12, padding: 12, background: 'rgba(15,23,42,0.72)', maxHeight: 170, overflow: 'auto' }}>
            <div style={{ color: '#94a3b8', fontSize: 10, fontWeight: 900, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 8 }}>
              Visible overlays
            </div>
            {displayedOverlays.length === 0 ? (
              <div style={{ color: '#64748b', fontSize: 12 }}>No visible annotation boxes at this frame.</div>
            ) : displayedOverlays.map((overlay) => (
              <button
                key={overlay.id}
                type="button"
                onClick={() => setSession((current) => selectOverlay(current, overlay))}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  width: '100%',
                  border: '0',
                  borderBottom: '1px solid rgba(148,163,184,0.08)',
                  background: 'transparent',
                  color: characterKey(session.selectedCharacterName) === overlay.characterKey ? '#e5eefb' : '#94a3b8',
                  padding: '7px 0',
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 12,
                }}
              >
                <span>{overlay.characterName}</span>
                <strong style={{ color: overlay.kind === 'exact' ? '#fbbf24' : overlay.kind === 'pending' ? '#2dd4bf' : '#38bdf8', textTransform: 'uppercase', fontSize: 10 }}>
                  {overlay.kind}
                </strong>
              </button>
            ))}
          </section>
        </aside>
      </div>

      <footer style={{ display: 'flex', justifyContent: 'space-between', gap: 10, color: '#64748b', fontSize: 11 }}>
        <span>Canonical exact boxes are hydrated from watch_keyframe_annotations; runtime boxes are derived only.</span>
        <span>{loading ? 'Refreshing...' : 'Live endpoints'}</span>
      </footer>
    </section>
  )
}

export default WatchAnnotationIsland

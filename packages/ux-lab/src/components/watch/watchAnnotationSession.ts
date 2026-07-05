export type NormalizedBbox = [number, number, number, number]

export const WATCH_ANNOTATION_EXACT_EPSILON_SECONDS = 0.055

export interface WatchAnnotationSceneRow {
  index: number
  timecode: string
  text?: string
  srt_text?: string
  movie_segment?: string
  scene_marker_image_path?: string
  video_clip_path?: string
  audio_clip_path?: string
  audio_path?: string
  entities?: string[]
  characters?: string[]
  character_names?: string[]
}

export interface WatchAnnotationCharacterOption {
  name: string
  actorName?: string
}

export interface WatchDetectorObservationRef {
  source: 'watch_annotation_island_yolo_candidate'
  link_quality: 'human_selected_yolo_track'
  track_id: string
  detector_candidate_id: string
  detected_class: string
  bbox: NormalizedBbox
  time_seconds: number
  media_time_seconds?: number | null
  confidence?: number | null
  human_bbox?: NormalizedBbox
}

export interface WatchAnnotationKeyframe {
  id: string
  recordId?: string
  recordKey?: string
  assetUid?: string
  rowIndex: number
  characterName: string
  actorName: string
  bbox: NormalizedBbox
  timeSeconds: number
  receiptPath?: string
  createdAt?: string
  detectorObservationRef?: WatchDetectorObservationRef
  raw?: unknown
}

export type WatchTrackControlKind = 'offscreen' | 'stop' | 'track-control'

export interface WatchAnnotationControlMarker {
  id: string
  recordId?: string
  rowIndex: number
  characterName: string
  actorName: string
  timeSeconds: number
  kind: WatchTrackControlKind
  raw?: unknown
}

export interface WatchAnnotationTrack {
  characterKey: string
  characterName: string
  actorName: string
  keyframes: WatchAnnotationKeyframe[]
  controls: WatchAnnotationControlMarker[]
}

export interface WatchAnnotationSessionState {
  rowIndex: number
  segmentStartSeconds: number
  segmentEndSeconds: number
  selectedCharacterName: string
  selectedActorName: string
  selectedOverlayId: string | null
  playheadSeconds: number
  tracks: Record<string, WatchAnnotationTrack>
  revision: number
}

export type WatchAnnotationOverlayKind = 'exact' | 'interpolated' | 'held' | 'pending'

export interface WatchAnnotationOverlay {
  id: string
  kind: WatchAnnotationOverlayKind
  characterKey: string
  characterName: string
  actorName: string
  bbox: NormalizedBbox
  timeSeconds: number
  exactKeyframeId?: string
  sourceKeyframeIds: string[]
  isExactKeyframe: boolean
}

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

function firstString(record: JsonRecord, keys: string[]): string {
  for (const key of keys) {
    const value = asString(record[key])
    if (value) return value
  }
  return ''
}

function firstNumber(record: JsonRecord, keys: string[]): number | null {
  for (const key of keys) {
    const value = asNumber(record[key])
    if (value !== null) return value
  }
  return null
}

function simpleHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
}

export function normalizeBbox(value: unknown): NormalizedBbox | null {
  if (!Array.isArray(value) || value.length !== 4) return null
  const numbers = value.map((item) => asNumber(item))
  if (numbers.some((item) => item === null)) return null
  const [rawX1, rawY1, rawX2, rawY2] = numbers as [number, number, number, number]
  const x1 = clamp01(Math.min(rawX1, rawX2))
  const y1 = clamp01(Math.min(rawY1, rawY2))
  const x2 = clamp01(Math.max(rawX1, rawX2))
  const y2 = clamp01(Math.max(rawY1, rawY2))
  if (x2 - x1 <= 0 || y2 - y1 <= 0) return null
  return [x1, y1, x2, y2]
}

function normalizeDetectorObservationRef(value: unknown): WatchDetectorObservationRef | undefined {
  if (!isRecord(value)) return undefined
  const source = firstString(value, ['source'])
  const trackId = firstString(value, ['track_id', 'trackId'])
  const detectorCandidateId = firstString(value, ['detector_candidate_id', 'detectorCandidateId'])
  const detectedClass = firstString(value, ['detected_class', 'detectedClass']) || 'person'
  const bbox = normalizeBbox(value.bbox)
  const timeSeconds = firstNumber(value, ['time_seconds', 'timeSeconds'])
  if (source !== 'watch_annotation_island_yolo_candidate' || !trackId || !detectorCandidateId || !bbox || timeSeconds === null) {
    return undefined
  }
  const mediaTimeSeconds = firstNumber(value, ['media_time_seconds', 'mediaTimeSeconds'])
  const confidence = firstNumber(value, ['confidence'])
  return {
    source: 'watch_annotation_island_yolo_candidate',
    link_quality: 'human_selected_yolo_track',
    track_id: trackId,
    detector_candidate_id: detectorCandidateId,
    detected_class: detectedClass,
    bbox,
    time_seconds: timeSeconds,
    media_time_seconds: mediaTimeSeconds,
    confidence,
    human_bbox: normalizeBbox(value.human_bbox ?? value.humanBbox) || undefined,
  }
}

export function characterKey(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, ' ')
  return normalized || 'unassigned'
}

export function clockToSeconds(value?: string): number {
  if (!value) return 0
  const match = value.trim().match(/(\d+(?::\d+){0,2})(?:[.,](\d+))?/)
  if (!match) return 0
  const parts = match[1].split(':').map((part) => Number(part))
  if (parts.some((part) => !Number.isFinite(part))) return 0
  const wholeSeconds = parts.reduce((total, part) => (total * 60) + part, 0)
  const fraction = match[2] ? Number(`0.${match[2]}`) : 0
  return wholeSeconds + (Number.isFinite(fraction) ? fraction : 0)
}

function splitSegmentLabel(value?: string): string[] {
  if (!value) return []
  return value.split(/\s*[-–—]\s*/).map((part) => part.trim()).filter(Boolean)
}

export function segmentStartSeconds(value?: string): number {
  const [start] = splitSegmentLabel(value)
  return clockToSeconds(start || value)
}

export function segmentEndSeconds(value?: string): number {
  const parts = splitSegmentLabel(value)
  const end = parts.length > 1 ? parts[parts.length - 1] : parts[0]
  return clockToSeconds(end || value)
}

export function rowSegmentStartSeconds(row: WatchAnnotationSceneRow): number {
  return segmentStartSeconds(row.movie_segment || row.timecode)
}

export function rowSegmentEndSeconds(row: WatchAnnotationSceneRow): number {
  const start = rowSegmentStartSeconds(row)
  const end = segmentEndSeconds(row.movie_segment || row.timecode)
  return end > start ? end : start + 30
}

export function rowSegmentDurationSeconds(row: WatchAnnotationSceneRow): number {
  return Math.max(0.1, rowSegmentEndSeconds(row) - rowSegmentStartSeconds(row))
}

export function secondsToClock(seconds: number): string {
  const safe = Math.max(0, seconds)
  const whole = Math.floor(safe)
  const minutes = Math.floor(whole / 60)
  const secs = whole % 60
  const millis = Math.round((safe - whole) * 1000)
  return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${millis.toString().padStart(3, '0')}`
}

export function normalizeCharacterOptions(
  row: WatchAnnotationSceneRow,
  explicitOptions: Array<string | WatchAnnotationCharacterOption> = [],
): WatchAnnotationCharacterOption[] {
  const options: WatchAnnotationCharacterOption[] = []
  const push = (name: unknown, actorName?: unknown): void => {
    const normalizedName = asString(name)
    if (!normalizedName) return
    const key = characterKey(normalizedName)
    if (options.some((option) => characterKey(option.name) === key)) return
    options.push({ name: normalizedName, actorName: asString(actorName) || undefined })
  }

  explicitOptions.forEach((option) => {
    if (typeof option === 'string') push(option)
    else push(option.name, option.actorName)
  })

  const rowEntities = [
    ...(Array.isArray(row.entities) ? row.entities : []),
    ...(Array.isArray(row.characters) ? row.characters : []),
    ...(Array.isArray(row.character_names) ? row.character_names : []),
  ]

  rowEntities.forEach((name) => push(name))
  if (options.length === 0) push('Unassigned')
  return options
}

export function createWatchAnnotationSession(
  row: WatchAnnotationSceneRow,
  characterOptions: Array<string | WatchAnnotationCharacterOption> = [],
  previous?: WatchAnnotationSessionState | null,
): WatchAnnotationSessionState {
  const options = normalizeCharacterOptions(row, characterOptions)
  const selectedName = previous?.selectedCharacterName || options[0]?.name || 'Unassigned'
  const selectedActor = previous?.selectedActorName || options.find((option) => characterKey(option.name) === characterKey(selectedName))?.actorName || ''
  const tracks: Record<string, WatchAnnotationTrack> = {}

  for (const option of options) {
    const key = characterKey(option.name)
    tracks[key] = {
      characterKey: key,
      characterName: option.name,
      actorName: option.actorName || '',
      keyframes: [],
      controls: [],
    }
  }

  const selectedKey = characterKey(selectedName)
  if (!tracks[selectedKey]) {
    tracks[selectedKey] = {
      characterKey: selectedKey,
      characterName: selectedName,
      actorName: selectedActor,
      keyframes: [],
      controls: [],
    }
  }

  return {
    rowIndex: row.index,
    segmentStartSeconds: rowSegmentStartSeconds(row),
    segmentEndSeconds: rowSegmentEndSeconds(row),
    selectedCharacterName: selectedName,
    selectedActorName: selectedActor,
    selectedOverlayId: null,
    playheadSeconds: previous?.playheadSeconds ?? 0,
    tracks,
    revision: (previous?.revision ?? 0) + 1,
  }
}

function withTrack(
  state: WatchAnnotationSessionState,
  characterName: string,
  actorName = '',
): { state: WatchAnnotationSessionState; track: WatchAnnotationTrack } {
  const key = characterKey(characterName)
  const existing = state.tracks[key]
  if (existing) {
    const updatedTrack = {
      ...existing,
      characterName: existing.characterName || characterName || 'Unassigned',
      actorName: existing.actorName || actorName || '',
    }
    if (updatedTrack === existing) return { state, track: existing }
    const nextState = {
      ...state,
      tracks: { ...state.tracks, [key]: updatedTrack },
      revision: state.revision + 1,
    }
    return { state: nextState, track: updatedTrack }
  }

  const track: WatchAnnotationTrack = {
    characterKey: key,
    characterName: characterName || 'Unassigned',
    actorName,
    keyframes: [],
    controls: [],
  }

  const nextState = {
    ...state,
    tracks: { ...state.tracks, [key]: track },
    revision: state.revision + 1,
  }

  return { state: nextState, track }
}

export function setSelectedCharacter(
  state: WatchAnnotationSessionState,
  characterName: string,
  actorName = '',
): WatchAnnotationSessionState {
  const normalizedName = characterName.trim() || 'Unassigned'
  const ensured = withTrack(state, normalizedName, actorName)
  return {
    ...ensured.state,
    selectedCharacterName: normalizedName,
    selectedActorName: actorName || ensured.track.actorName || '',
    selectedOverlayId: null,
    revision: ensured.state.revision + 1,
  }
}

export function setPlayheadSeconds(
  state: WatchAnnotationSessionState,
  seconds: number,
): WatchAnnotationSessionState {
  const duration = Math.max(0.1, state.segmentEndSeconds - state.segmentStartSeconds)
  const nextSeconds = Math.max(0, Math.min(duration, Number.isFinite(seconds) ? seconds : 0))
  if (Math.abs(nextSeconds - state.playheadSeconds) < 0.0005) return state
  return { ...state, playheadSeconds: nextSeconds, revision: state.revision + 1 }
}

export function selectOverlay(
  state: WatchAnnotationSessionState,
  overlay: WatchAnnotationOverlay,
): WatchAnnotationSessionState {
  return {
    ...setSelectedCharacter(state, overlay.characterName, overlay.actorName),
    selectedOverlayId: overlay.id,
  }
}

function collectCandidateRecords(input: unknown, output: JsonRecord[] = [], seen = new Set<unknown>()): JsonRecord[] {
  if (!input || seen.has(input)) return output
  seen.add(input)

  if (Array.isArray(input)) {
    input.forEach((item) => collectCandidateRecords(item, output, seen))
    return output
  }

  if (!isRecord(input)) return output

  const hasAnnotationShape = (
    Array.isArray(input.bbox)
    || Array.isArray(input.normalized_bbox)
    || Array.isArray(input.box)
    || input.keyframe_time_seconds !== undefined
    || input.control_time_seconds !== undefined
    || input.character_name !== undefined
    || input.characterName !== undefined
  )

  if (hasAnnotationShape) output.push(input)

  Object.entries(input).forEach(([key, value]) => {
    if (
      key === 'bbox'
      || key === 'normalized_bbox'
      || key === 'box'
      || key === 'basis'
      || key === 'metadata'
    ) {
      return
    }
    if (Array.isArray(value) || isRecord(value)) collectCandidateRecords(value, output, seen)
  })

  return output
}

function recordId(prefix: string, rowIndex: number, record: JsonRecord): string {
  const explicit = firstString(record, [
    'box_id',
    'boxId',
    'id',
    '_key',
    'key',
    'annotation_id',
    'record_id',
    'receipt_path',
    'receiptPath',
  ])
  if (explicit) return explicit
  return `${prefix}-${rowIndex}-${simpleHash(JSON.stringify(record))}`
}

function recordCharacter(record: JsonRecord): string {
  return firstString(record, [
    'character_name',
    'characterName',
    'character',
    'entity_name',
    'entityName',
    'track_name',
    'trackName',
    'name',
  ]) || 'Unassigned'
}

function recordActor(record: JsonRecord): string {
  return firstString(record, [
    'actor_name',
    'actorName',
    'actor',
    'performer_name',
    'performerName',
  ])
}

function recordAssetUid(record: JsonRecord): string {
  return firstString(record, [
    'asset_uid',
    'assetUid',
    'movie_asset_uid',
    'movieAssetUid',
  ])
}

function recordTimeSeconds(record: JsonRecord, row: WatchAnnotationSceneRow): number | null {
  const raw = firstNumber(record, [
    'keyframe_time_seconds',
    'keyframeTimeSeconds',
    'control_time_seconds',
    'controlTimeSeconds',
    'time_seconds',
    'timeSeconds',
    'timestamp_seconds',
    'timestampSeconds',
    'seconds',
  ])
  if (raw === null) return null

  const basis = firstString(record, ['keyframe_time_basis', 'time_basis', 'basis']).toLowerCase()
  const start = rowSegmentStartSeconds(row)
  const duration = rowSegmentDurationSeconds(row)
  if (basis.includes('media') || basis.includes('movie') || basis.includes('absolute') || basis.includes('global')) {
    return Math.max(0, raw - start)
  }

  if (!basis && start > 0 && raw > duration + 1) {
    return Math.max(0, raw - start)
  }

  return Math.max(0, raw)
}

function recordKindText(record: JsonRecord): string {
  return [
    record.kind,
    record.type,
    record.event_type,
    record.eventType,
    record.annotation_type,
    record.annotationType,
    record.control_type,
    record.controlType,
    record.visibility,
    record.status,
    record.source,
  ].map((value) => String(value ?? '').toLowerCase()).join(' ')
}

function isControlRecord(record: JsonRecord): boolean {
  const text = recordKindText(record)
  if (text.includes('track-control') || text.includes('track_control')) return true
  if (text.includes('offscreen') || text.includes('stop')) return true
  if (record.is_visible === false || record.visible === false) return true
  if (record.bbox === null || record.normalized_bbox === null) {
    return record.character_name !== undefined || record.characterName !== undefined
  }
  return false
}

function isAdjustmentRecord(record: JsonRecord): boolean {
  const explicitId = firstString(record, ['id', '_key', 'key', 'annotation_id', 'record_id'])
  if (explicitId.startsWith('adjustment-')) return true
  const text = recordKindText(record)
  return (
    text.includes('draw')
    || text.includes('move')
    || text.includes('resize')
    || text.includes('clear')
    || text.includes('delete')
  )
}

function controlKind(record: JsonRecord): WatchTrackControlKind {
  const text = recordKindText(record)
  if (text.includes('stop')) return 'stop'
  if (text.includes('offscreen') || record.is_visible === false || record.visible === false) return 'offscreen'
  return 'track-control'
}

function isRejectedIdentityRecord(record: JsonRecord): boolean {
  const trainingRole = record.training_role && typeof record.training_role === 'object'
    ? record.training_role as JsonRecord
    : record.trainingRole && typeof record.trainingRole === 'object'
      ? record.trainingRole as JsonRecord
      : {}
  const status = firstString(record, ['status']).toLowerCase()
  const reviewState = firstString(trainingRole, ['review_state', 'reviewState']).toLowerCase()
  const labelType = firstString(trainingRole, ['label_type', 'labelType'])
    || firstString(record, ['label_type', 'labelType'])
  const normalizedLabelType = labelType.toLowerCase()
  return (
    status.includes('rejected')
    || reviewState.includes('rejected')
    || normalizedLabelType === 'negative'
  )
}

function parseKeyframeRecord(row: WatchAnnotationSceneRow, record: JsonRecord): WatchAnnotationKeyframe | null {
  if (isRejectedIdentityRecord(record)) return null
  if (isAdjustmentRecord(record)) return null
  if (isControlRecord(record)) return null
  const bbox = normalizeBbox(record.bbox ?? record.normalized_bbox ?? record.box)
  if (!bbox) return null
  const timeSeconds = recordTimeSeconds(record, row)
  if (timeSeconds === null) return null
  const characterName = recordCharacter(record)
  const actorName = recordActor(record)
  const id = recordId('keyframe', row.index, record)
  return {
    id,
    recordId: id,
    recordKey: firstString(record, ['_key', 'key']),
    assetUid: recordAssetUid(record) || undefined,
    rowIndex: row.index,
    characterName,
    actorName,
    bbox,
    timeSeconds,
    receiptPath: firstString(record, ['receipt_path', 'receiptPath']),
    createdAt: firstString(record, ['created_at', 'createdAt']),
    detectorObservationRef: normalizeDetectorObservationRef(record.detector_observation_ref ?? record.detectorObservationRef),
    raw: record,
  }
}

function parseControlRecord(row: WatchAnnotationSceneRow, record: JsonRecord): WatchAnnotationControlMarker | null {
  if (!isControlRecord(record)) return null
  const timeSeconds = recordTimeSeconds(record, row)
  if (timeSeconds === null) return null
  const characterName = recordCharacter(record)
  const actorName = recordActor(record)
  const id = recordId('control', row.index, record)
  return {
    id,
    recordId: id,
    rowIndex: row.index,
    characterName,
    actorName,
    timeSeconds,
    kind: controlKind(record),
    raw: record,
  }
}

export function replaceCanonicalFromHydration(
  previous: WatchAnnotationSessionState,
  row: WatchAnnotationSceneRow,
  payload: unknown,
  characterOptions: Array<string | WatchAnnotationCharacterOption> = [],
): WatchAnnotationSessionState {
  const base = createWatchAnnotationSession(row, characterOptions, previous)
  let nextState: WatchAnnotationSessionState = {
    ...base,
    selectedCharacterName: previous.selectedCharacterName || base.selectedCharacterName,
    selectedActorName: previous.selectedActorName || base.selectedActorName,
    selectedOverlayId: previous.selectedOverlayId,
    playheadSeconds: previous.playheadSeconds,
    revision: previous.revision + 1,
  }

  const records = collectCandidateRecords(payload)
  for (const record of records) {
    const control = parseControlRecord(row, record)
    if (control) {
      const ensured = withTrack(nextState, control.characterName, control.actorName)
      nextState = {
        ...ensured.state,
        tracks: {
          ...ensured.state.tracks,
          [ensured.track.characterKey]: {
            ...ensured.track,
            controls: [...ensured.track.controls, control],
          },
        },
        revision: ensured.state.revision + 1,
      }
      continue
    }

    const keyframe = parseKeyframeRecord(row, record)
    if (!keyframe) continue
    const ensured = withTrack(nextState, keyframe.characterName, keyframe.actorName)
    nextState = {
      ...ensured.state,
      tracks: {
        ...ensured.state.tracks,
        [ensured.track.characterKey]: {
          ...ensured.track,
          keyframes: [...ensured.track.keyframes, keyframe],
        },
      },
      revision: ensured.state.revision + 1,
    }
  }

  const sortedTracks = Object.fromEntries(Object.entries(nextState.tracks).map(([key, track]) => [
    key,
    {
      ...track,
      keyframes: [...track.keyframes].sort((a, b) => a.timeSeconds - b.timeSeconds || a.id.localeCompare(b.id)),
      controls: [...track.controls].sort((a, b) => a.timeSeconds - b.timeSeconds || a.id.localeCompare(b.id)),
    },
  ]))

  const selectedKey = characterKey(nextState.selectedCharacterName)
  const selectedIsPlaceholder = !nextState.selectedCharacterName || selectedKey === 'unassigned'
  const firstAnnotatedTrack = Object.values(sortedTracks).find((track) => track.keyframes.length > 0)
  if (selectedIsPlaceholder && firstAnnotatedTrack) {
    nextState = {
      ...nextState,
      selectedCharacterName: firstAnnotatedTrack.characterName,
      selectedActorName: firstAnnotatedTrack.actorName,
      selectedOverlayId: null,
    }
  }

  const finalSelectedKey = characterKey(nextState.selectedCharacterName)
  if (!sortedTracks[finalSelectedKey]) {
    sortedTracks[finalSelectedKey] = {
      characterKey: finalSelectedKey,
      characterName: nextState.selectedCharacterName || 'Unassigned',
      actorName: nextState.selectedActorName || '',
      keyframes: [],
      controls: [],
    }
  }

  return {
    ...nextState,
    tracks: sortedTracks,
    selectedActorName: nextState.selectedActorName || sortedTracks[finalSelectedKey]?.actorName || '',
    revision: nextState.revision + 1,
  }
}

export function findExactKeyframeForCharacter(
  state: WatchAnnotationSessionState,
  characterName: string,
  timeSeconds = state.playheadSeconds,
): WatchAnnotationKeyframe | null {
  const track = state.tracks[characterKey(characterName)]
  if (!track) return null
  return track.keyframes.find((keyframe) => Math.abs(keyframe.timeSeconds - timeSeconds) <= WATCH_ANNOTATION_EXACT_EPSILON_SECONDS) ?? null
}

export function findExactSelectedKeyframe(state: WatchAnnotationSessionState): WatchAnnotationKeyframe | null {
  if (state.selectedOverlayId?.startsWith('exact:')) {
    for (const track of Object.values(state.tracks)) {
      const selected = track.keyframes.find((keyframe) => (
        `exact:${track.characterKey}:${keyframe.id}` === state.selectedOverlayId
      ))
      if (selected) return selected
    }
  }

  if (state.selectedOverlayId) return null

  const selectedExact = findExactKeyframeForCharacter(state, state.selectedCharacterName, state.playheadSeconds)
  if (selectedExact) return selectedExact

  const activeOverlay = selectedCurrentOverlay(state)
  if (activeOverlay?.isExactKeyframe && activeOverlay.exactKeyframeId) {
    const track = state.tracks[activeOverlay.characterKey]
    return track?.keyframes.find((keyframe) => keyframe.id === activeOverlay.exactKeyframeId) ?? null
  }

  return null
}

function lastControlBetween(track: WatchAnnotationTrack, afterSeconds: number, atSeconds: number): WatchAnnotationControlMarker | null {
  return [...track.controls]
    .reverse()
    .find((control) => control.timeSeconds > afterSeconds + WATCH_ANNOTATION_EXACT_EPSILON_SECONDS && control.timeSeconds <= atSeconds + WATCH_ANNOTATION_EXACT_EPSILON_SECONDS) ?? null
}

function interpolateBbox(a: NormalizedBbox, b: NormalizedBbox, ratio: number): NormalizedBbox {
  const t = clamp01(ratio)
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ]
}

export function deriveWatchAnnotationOverlays(
  state: WatchAnnotationSessionState,
  timeSeconds = state.playheadSeconds,
): WatchAnnotationOverlay[] {
  const overlays: WatchAnnotationOverlay[] = []

  for (const track of Object.values(state.tracks)) {
    if (track.keyframes.length === 0) continue

    const exact = track.keyframes.find((keyframe) => Math.abs(keyframe.timeSeconds - timeSeconds) <= WATCH_ANNOTATION_EXACT_EPSILON_SECONDS)
    if (exact) {
      overlays.push({
        id: `exact:${track.characterKey}:${exact.id}`,
        kind: 'exact',
        characterKey: track.characterKey,
        characterName: track.characterName,
        actorName: exact.actorName || track.actorName,
        bbox: exact.bbox,
        timeSeconds,
        exactKeyframeId: exact.id,
        sourceKeyframeIds: [exact.id],
        isExactKeyframe: true,
      })
      continue
    }

    const previous = [...track.keyframes].reverse().find((keyframe) => keyframe.timeSeconds < timeSeconds)
    if (!previous) continue

    if (lastControlBetween(track, previous.timeSeconds, timeSeconds)) continue

    const next = track.keyframes.find((keyframe) => keyframe.timeSeconds > timeSeconds)
    if (next) {
      const ratio = (timeSeconds - previous.timeSeconds) / Math.max(0.001, next.timeSeconds - previous.timeSeconds)
      overlays.push({
        id: `interpolated:${track.characterKey}:${previous.id}:${next.id}`,
        kind: 'interpolated',
        characterKey: track.characterKey,
        characterName: track.characterName,
        actorName: previous.actorName || next.actorName || track.actorName,
        bbox: interpolateBbox(previous.bbox, next.bbox, ratio),
        timeSeconds,
        sourceKeyframeIds: [previous.id, next.id],
        isExactKeyframe: false,
      })
      continue
    }

    overlays.push({
      id: `held:${track.characterKey}:${previous.id}`,
      kind: 'held',
      characterKey: track.characterKey,
      characterName: track.characterName,
      actorName: previous.actorName || track.actorName,
      bbox: previous.bbox,
      timeSeconds,
      sourceKeyframeIds: [previous.id],
      isExactKeyframe: false,
    })
  }

  return overlays.sort((a, b) => {
    if (a.kind === 'exact' && b.kind !== 'exact') return 1
    if (a.kind !== 'exact' && b.kind === 'exact') return -1
    return a.characterName.localeCompare(b.characterName)
  })
}

export function selectedCurrentOverlay(state: WatchAnnotationSessionState): WatchAnnotationOverlay | null {
  const overlays = deriveWatchAnnotationOverlays(state, state.playheadSeconds)
  if (state.selectedOverlayId) {
    const selectedById = overlays.find((overlay) => overlay.id === state.selectedOverlayId)
    if (selectedById) return selectedById
  }
  return overlays.find((overlay) => overlay.characterKey === characterKey(state.selectedCharacterName)) ?? null
}

export function canStopSelectedTrack(state: WatchAnnotationSessionState): boolean {
  const overlay = selectedCurrentOverlay(state)
  return Boolean(overlay && !overlay.isExactKeyframe)
}

export function upsertHumanKeyframe(
  state: WatchAnnotationSessionState,
  input: {
    id?: string
    recordId?: string
    recordKey?: string
    assetUid?: string
    characterName: string
    actorName?: string
    bbox: NormalizedBbox
    timeSeconds: number
  },
): WatchAnnotationSessionState {
  const ensured = withTrack(state, input.characterName, input.actorName || '')
  const track = ensured.track
  const exactIndex = track.keyframes.findIndex((keyframe) => Math.abs(keyframe.timeSeconds - input.timeSeconds) <= WATCH_ANNOTATION_EXACT_EPSILON_SECONDS)
  const keyframe: WatchAnnotationKeyframe = {
    id: input.id || (exactIndex >= 0 ? track.keyframes[exactIndex].id : `local-keyframe-${Date.now().toString(36)}-${simpleHash(JSON.stringify(input))}`),
    recordId: input.recordId || track.keyframes[exactIndex]?.recordId,
    recordKey: input.recordKey || track.keyframes[exactIndex]?.recordKey,
    assetUid: input.assetUid || track.keyframes[exactIndex]?.assetUid,
    rowIndex: state.rowIndex,
    characterName: input.characterName,
    actorName: input.actorName || track.actorName || '',
    bbox: input.bbox,
    timeSeconds: input.timeSeconds,
  }

  const keyframes = exactIndex >= 0
    ? track.keyframes.map((candidate, index) => index === exactIndex ? { ...candidate, ...keyframe } : candidate)
    : [...track.keyframes, keyframe]

  return {
    ...ensured.state,
    tracks: {
      ...ensured.state.tracks,
      [track.characterKey]: {
        ...track,
        actorName: keyframe.actorName,
        keyframes: keyframes.sort((a, b) => a.timeSeconds - b.timeSeconds || a.id.localeCompare(b.id)),
      },
    },
    revision: ensured.state.revision + 1,
  }
}

export function updateKeyframeBbox(
  state: WatchAnnotationSessionState,
  keyframeId: string,
  bbox: NormalizedBbox,
): WatchAnnotationSessionState {
  let touched = false
  const tracks = Object.fromEntries(Object.entries(state.tracks).map(([key, track]) => {
    const keyframes = track.keyframes.map((keyframe) => {
      if (keyframe.id !== keyframeId) return keyframe
      touched = true
      return { ...keyframe, bbox }
    })
    return [key, { ...track, keyframes }]
  }))

  return touched ? { ...state, tracks, revision: state.revision + 1 } : state
}

export function deleteExactSelectedKeyframeLocally(state: WatchAnnotationSessionState): WatchAnnotationSessionState {
  const exact = findExactSelectedKeyframe(state)
  if (!exact) return state
  const key = characterKey(state.selectedCharacterName)
  const track = state.tracks[key]
  if (!track) return state
  return {
    ...state,
    tracks: {
      ...state.tracks,
      [key]: {
        ...track,
        keyframes: track.keyframes.filter((keyframe) => keyframe.id !== exact.id),
      },
    },
    selectedOverlayId: null,
    revision: state.revision + 1,
  }
}

export function appendTrackControlLocally(
  state: WatchAnnotationSessionState,
  input: {
    characterName: string
    actorName?: string
    timeSeconds: number
    kind?: WatchTrackControlKind
  },
): WatchAnnotationSessionState {
  const ensured = withTrack(state, input.characterName, input.actorName || '')
  const track = ensured.track
  const marker: WatchAnnotationControlMarker = {
    id: `local-control-${Date.now().toString(36)}-${simpleHash(JSON.stringify(input))}`,
    rowIndex: state.rowIndex,
    characterName: input.characterName,
    actorName: input.actorName || track.actorName || '',
    timeSeconds: input.timeSeconds,
    kind: input.kind || 'offscreen',
  }

  return {
    ...ensured.state,
    tracks: {
      ...ensured.state.tracks,
      [track.characterKey]: {
        ...track,
        controls: [...track.controls, marker].sort((a, b) => a.timeSeconds - b.timeSeconds || a.id.localeCompare(b.id)),
      },
    },
    selectedOverlayId: null,
    revision: ensured.state.revision + 1,
  }
}

export function trackStats(state: WatchAnnotationSessionState): { exactKeyframes: number; controls: number; characters: number } {
  const tracks = Object.values(state.tracks)
  return {
    exactKeyframes: tracks.reduce((total, track) => total + track.keyframes.length, 0),
    controls: tracks.reduce((total, track) => total + track.controls.length, 0),
    characters: tracks.length,
  }
}

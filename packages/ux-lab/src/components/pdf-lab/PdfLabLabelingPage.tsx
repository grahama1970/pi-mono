/**
 * PdfLabLabelingPage — drawing-first annotator for /review-extraction
 * expected_elements.json contracts. Built as a focused replacement for
 * Label Studio for our single-page-PDF workflow:
 *
 *   - Canvas is the primary surface (no read-only/edit-mode tabs).
 *   - 11 family chips are always visible on the left, color-coded.
 *   - Click chip → drag rect → done. No keyboard memorization required.
 *   - Right pane: live region list with per-region text_hint / label inputs.
 *   - JSON Import seeds boxes from existing expected_elements.json, VIA
 *     project exports, or LS predictions. Export emits expected_elements.json.
 *
 * Page coords are stored as normalized [0..1] xyxy so the JSON is rendering-
 * resolution independent and matches the matcher contract directly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './PdfLabLabelingPage.css'

const CANONICAL_FAMILIES = [
  { id: 'section_heading',   color: '#a8ff57', hotkey: '1' },
  { id: 'section_label',     color: '#fbbc04', hotkey: '2' },
  { id: 'list',              color: '#4a9eff', hotkey: '3' },
  { id: 'paragraph_block',   color: '#94a3b8', hotkey: '4' },
  { id: 'labeled_paragraph', color: '#ff9500', hotkey: '5' },
  { id: 'table',             color: '#22d3ee', hotkey: '6' },
  { id: 'figure',            color: '#7c3aed', hotkey: '7' },
  { id: 'caption',           color: '#ec407a', hotkey: '8' },
  { id: 'footnote',          color: '#c084fc', hotkey: '9' },
  { id: 'page_chrome_noise', color: '#9aa0a6', hotkey: '0' },
  { id: 'human_decision',    color: '#ff6b6b', hotkey: 'q' },
] as const

type FamilyId = typeof CANONICAL_FAMILIES[number]['id']

type LabelAnchor = 'top-outside' | 'top-inside' | 'bottom-inside' | 'bottom-outside'

interface Region {
  /** Stable client-side id (not persisted directly). */
  id: string
  family: FamilyId
  /** Normalized image coords. Always x0<x1, y0<y1, all in [0,1]. */
  bbox: [number, number, number, number]
  /** Optional, mirror expected_elements.json fields. */
  label?: string
  text_hint?: string
  lead_label?: string
  notes?: string
  /** Where the family tag sits relative to the bbox. Click the tag to
   *  cycle through the four anchored positions. Default `top-outside` =
   *  just above the bbox's top-left, the conventional CVAT / VIA position. */
  labelAnchor?: LabelAnchor
}

const LABEL_ANCHOR_CYCLE: LabelAnchor[] = [
  'top-outside', 'top-inside', 'bottom-inside', 'bottom-outside',
]
function nextAnchor(a: LabelAnchor | undefined): LabelAnchor {
  const idx = LABEL_ANCHOR_CYCLE.indexOf(a ?? 'top-outside')
  return LABEL_ANCHOR_CYCLE[(idx + 1) % LABEL_ANCHOR_CYCLE.length]
}

interface ExpectedElement {
  family: FamilyId
  bbox_hint: [number, number, number, number]
  label?: string | null
  text_hint?: string
  lead_label?: string
  notes?: string
  allowed_types?: string[]
  match_strategy?: string
  desired_role?: string
  desired_lead_label?: string
}

/** Family default `allowed_types` (mirrors ls_to_expected.py). */
const DEFAULT_ALLOWED_TYPES: Record<FamilyId, string[]> = {
  section_heading: ['section_heading'],
  section_label: ['section_label', 'content_label', 'paragraph_block'],
  list: ['list'],
  paragraph_block: ['paragraph_block'],
  labeled_paragraph: ['paragraph_block'],
  table: ['table'],
  figure: ['figure'],
  caption: ['caption'],
  footnote: ['footnote_block', 'paragraph_block'],
  page_chrome_noise: ['header_footer_noise'],
  human_decision: [],
}

function newId(): string {
  return `r_${Math.random().toString(36).slice(2, 10)}`
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}

function normalizeRect(x0: number, y0: number, x1: number, y1: number): [number, number, number, number] {
  const a = Math.min(x0, x1), b = Math.max(x0, x1)
  const c = Math.min(y0, y1), d = Math.max(y0, y1)
  return [clamp01(a), clamp01(c), clamp01(b), clamp01(d)]
}

function regionsToExpected(regions: Region[], slug = 'manual_labeling'): { schema_version: string; slice_id: string; captured_at: string; expected_elements: ExpectedElement[] } {
  return {
    schema_version: 'pdf_lab.golden_slice.v2',
    slice_id: slug,
    captured_at: new Date().toISOString(),
    expected_elements: regions.map(r => {
      const e: ExpectedElement = {
        family: r.family,
        bbox_hint: r.bbox,
        allowed_types: DEFAULT_ALLOWED_TYPES[r.family],
        match_strategy: r.text_hint ? 'text_contains' : 'type_only',
      }
      if (r.label) e.label = r.label
      if (r.text_hint) e.text_hint = r.text_hint
      if (r.lead_label) {
        e.lead_label = r.lead_label
        e.desired_role = 'labeled_paragraph'
        e.desired_lead_label = r.lead_label
      }
      if (r.notes) e.notes = r.notes
      return e
    }),
  }
}

/** Best-effort importer: detects shape and returns regions. Supports
 *  - expected_elements.json (our v2 contract)
 *  - VIA project JSON (single image)
 *  - LS predictions / annotations result-list
 *  Anything unrecognised → empty result + warning.
 */
function importJson(raw: unknown): { regions: Region[]; warnings: string[]; format: string } {
  const warnings: string[] = []
  if (!raw || typeof raw !== 'object') {
    return { regions: [], warnings: ['Top-level JSON must be an object.'], format: 'unknown' }
  }
  const obj = raw as Record<string, unknown>

  // expected_elements.json — our schema.
  if (Array.isArray(obj.expected_elements)) {
    const rows: Region[] = []
    for (const el of obj.expected_elements as ExpectedElement[]) {
      if (!Array.isArray(el.bbox_hint) || el.bbox_hint.length !== 4) {
        warnings.push(`expected_elements: dropped row with bad bbox_hint`)
        continue
      }
      rows.push({
        id: newId(),
        family: el.family,
        bbox: normalizeRect(el.bbox_hint[0], el.bbox_hint[1], el.bbox_hint[2], el.bbox_hint[3]),
        label: el.label ?? undefined,
        text_hint: el.text_hint,
        lead_label: el.lead_label ?? el.desired_lead_label,
        notes: el.notes,
      })
    }
    return { regions: rows, warnings, format: 'expected_elements.json' }
  }

  // VIA project JSON.
  const viaImg = obj._via_img_metadata as Record<string, unknown> | undefined
  if (viaImg && typeof viaImg === 'object') {
    const entries = Object.values(viaImg)
    if (entries.length !== 1) {
      warnings.push(`VIA file has ${entries.length} images; expected 1 — using first`)
    }
    const entry = entries[0] as Record<string, unknown>
    const file_attributes = (entry.file_attributes as Record<string, unknown>) || {}
    const imgW = Number(file_attributes.page_width_px) || 0
    const imgH = Number(file_attributes.page_height_px) || 0
    if (!imgW || !imgH) {
      warnings.push('VIA file_attributes missing page_width_px/page_height_px; cannot map coords')
      return { regions: [], warnings, format: 'via (rejected)' }
    }
    const regions = (entry.regions as Array<Record<string, unknown>>) || []
    const rows: Region[] = []
    for (let i = 0; i < regions.length; i++) {
      const r = regions[i]
      const shape = (r.shape_attributes as Record<string, unknown>) || {}
      const attrs = (r.region_attributes as Record<string, unknown>) || {}
      const family = String(attrs.family || '')
      let rect: [number, number, number, number] | null = null
      if (shape.name === 'rect') {
        const x = Number(shape.x), y = Number(shape.y), w = Number(shape.width), h = Number(shape.height)
        if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(w) && Number.isFinite(h)) {
          rect = [x / imgW, y / imgH, (x + w) / imgW, (y + h) / imgH]
        }
      } else if (shape.name === 'polyline') {
        const xs = (shape.all_points_x as number[]) || []
        const ys = (shape.all_points_y as number[]) || []
        if (xs.length && ys.length && xs.length === ys.length) {
          rect = [Math.min(...xs) / imgW, Math.min(...ys) / imgH, Math.max(...xs) / imgW, Math.max(...ys) / imgH]
          warnings.push(`region#${i} polyline converted to bbox`)
        }
      }
      if (!rect) { warnings.push(`region#${i} unsupported shape: ${shape.name}`); continue }
      // Family migration: legacy chrome → page_chrome_noise + label
      let migratedFamily = family
      let migratedLabel = String(attrs.label || '')
      if (family === 'footer' || family === 'running_header') {
        migratedLabel = migratedLabel || family
        migratedFamily = 'page_chrome_noise'
      }
      if (!CANONICAL_FAMILIES.some(f => f.id === migratedFamily)) {
        warnings.push(`region#${i} family=${JSON.stringify(family)} unknown; skipped`)
        continue
      }
      rows.push({
        id: newId(),
        family: migratedFamily as FamilyId,
        bbox: normalizeRect(rect[0], rect[1], rect[2], rect[3]),
        label: migratedLabel || undefined,
        text_hint: String(attrs.text_hint || '') || undefined,
        lead_label: String(attrs.lead_label || '') || undefined,
        notes: String(attrs.notes || '') || undefined,
      })
    }
    return { regions: rows, warnings, format: 'VIA project' }
  }

  warnings.push('Unrecognised JSON shape — expected expected_elements.json or VIA project export.')
  return { regions: [], warnings, format: 'unknown' }
}

interface DragState {
  startX: number; startY: number
  curX: number; curY: number
  family: FamilyId
}

interface SavedPage {
  slug: string
  imageDataUrl: string
  regions: Region[]
  updatedAt: string
  naturalSize?: { w: number; h: number }
}

const STORAGE_KEY = 'pdf-lab-labeling-pages-v1'

function loadSavedPages(): Record<string, SavedPage> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Record<string, SavedPage>
  } catch {
    return {}
  }
}

function persistSavedPages(pages: Record<string, SavedPage>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pages))
  } catch (err) {
    // Quota exceeded — likely too many pages with embedded images. Skip
    // silently; the in-memory state still works.
    console.warn('[PdfLabLabeling] localStorage save failed:', err)
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(r.error || new Error('FileReader error'))
    r.readAsDataURL(file)
  })
}

function urlToDataUrl(url: string): Promise<string> {
  return fetch(url)
    .then(r => r.blob())
    .then(blob => new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result || ''))
      r.onerror = () => reject(r.error || new Error('FileReader error'))
      r.readAsDataURL(blob)
    }))
}

/** Golden-slice manifest. Each entry is a self-contained project: a
 *  rendered PDF page PNG plus (optionally) an existing expected_elements.json
 *  contract. Click → image + prior regions both load. This is the project
 *  explorer's source of truth; localStorage tracks per-slug edits on top.
 *
 *  To add a slice:
 *    1. Drop the page PNG into `public/pdf-lab-pages/<slug>_page.png`
 *    2. (optional) Drop the contract at
 *       `public/pdf-lab-pages/<slug>.expected_elements.json`
 *    3. Append an entry here.
 */
interface KnownSlice {
  slug: string
  label: string
  imageUrl: string
  expectedElementsUrl?: string
}
const KNOWN_SLICES: KnownSlice[] = [
  {
    slug: 'gs001_intro_page_27',
    label: 'GS001 · Intro · printed pg 1',
    imageUrl: '/pdf-lab-pages/page_0027.png',
    expectedElementsUrl: '/pdf-lab-pages/gs001_intro_page_27.expected_elements.json',
  },
  {
    slug: 'gs002_ac1_page_44',
    label: 'AC-1 · printed pg 18',
    imageUrl: '/pdf-lab-pages/page_0044.png',
  },
  {
    slug: 'gs002_ac2_page_45',
    label: 'GS002 · AC-2 · printed pg 19',
    imageUrl: '/pdf-lab-pages/page_0045.png',
    expectedElementsUrl: '/pdf-lab-pages/gs002_ac2_page_45.expected_elements.json',
  },
]

export function PdfLabLabelingPage() {
  const [activeFamily, setActiveFamily] = useState<FamilyId>('paragraph_block')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [imageNaturalSize, setImageNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const [regions, setRegions] = useState<Region[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [slug, setSlug] = useState('manual_labeling')
  const [warnings, setWarnings] = useState<string[]>([])
  const [savedPages, setSavedPages] = useState<Record<string, SavedPage>>(() => loadSavedPages())
  const [zoom, setZoom] = useState<number>(1)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; regionId?: string } | null>(null)
  // (Removed freeform label-drag state — labels are anchored to one of 4
  //  fixed corner positions; click the tag to cycle through them.)
  /** Region move / resize drag. `mode` records which edge or corner the user
   *  grabbed; 'move' translates the whole rect. We capture the rect at
   *  mousedown so the math is a simple delta-from-start. */
  const [regionDrag, setRegionDrag] = useState<{
    regionId: string
    mode: 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
    startClientX: number
    startClientY: number
    startBbox: [number, number, number, number]
  } | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)
  const imgWrapperRef = useRef<HTMLDivElement>(null)
  const saveTimerRef = useRef<number | null>(null)

  const ZOOM_MIN = 0.25
  const ZOOM_MAX = 8

  const zoomIn = useCallback(() => setZoom(z => Math.min(ZOOM_MAX, z * 1.25)), [])
  const zoomOut = useCallback(() => setZoom(z => Math.max(ZOOM_MIN, z / 1.25)), [])
  const zoomReset = useCallback(() => setZoom(1), [])
  const zoomFit = useCallback(() => {
    if (!canvasRef.current || !imageNaturalSize) return
    const r = canvasRef.current.getBoundingClientRect()
    const padding = 32 // breathing room
    const wRatio = (r.width - padding) / imageNaturalSize.w
    const hRatio = (r.height - padding) / imageNaturalSize.h
    setZoom(Math.max(ZOOM_MIN, Math.min(wRatio, hRatio)))
  }, [imageNaturalSize])

  // On mount: prune stale empty entries from localStorage, then if there is
  // at least one actually-labeled saved page, restore the most recent.
  useEffect(() => {
    const entries = Object.values(savedPages).filter(p => p.regions.length > 0)
    const stale = Object.values(savedPages).filter(p => p.regions.length === 0)
    if (stale.length > 0) {
      setSavedPages(prev => {
        const next = { ...prev }
        for (const p of stale) delete next[p.slug]
        persistSavedPages(next)
        return next
      })
    }
    if (entries.length === 0) return
    const mostRecent = entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
    setSlug(mostRecent.slug)
    setImageUrl(mostRecent.imageDataUrl)
    setImageDataUrl(mostRecent.imageDataUrl)
    setRegions(mostRecent.regions)
    if (mostRecent.naturalSize) setImageNaturalSize(mostRecent.naturalSize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-save on every regions/image/slug change — but ONLY if the page
  // actually has at least one labeled region. Otherwise "load preset →
  // never label → reload" leaves a parade of empty entries in the explorer.
  useEffect(() => {
    if (!imageDataUrl || !slug) return
    if (regions.length === 0) return
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => {
      setSavedPages(prev => {
        const next: Record<string, SavedPage> = { ...prev }
        next[slug] = {
          slug,
          imageDataUrl,
          regions,
          updatedAt: new Date().toISOString(),
          naturalSize: imageNaturalSize ?? undefined,
        }
        persistSavedPages(next)
        return next
      })
    }, 500)
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current)
    }
  }, [regions, imageDataUrl, slug, imageNaturalSize])

  const loadSavedPage = useCallback((p: SavedPage) => {
    setSlug(p.slug)
    setImageUrl(p.imageDataUrl)
    setImageDataUrl(p.imageDataUrl)
    setRegions(p.regions)
    setImageNaturalSize(p.naturalSize ?? null)
    setSelectedId(null)
    setWarnings([`Loaded saved page ${p.slug} (${p.regions.length} regions)`])
  }, [])

  const deleteSavedPage = useCallback((targetSlug: string) => {
    setSavedPages(prev => {
      const next = { ...prev }
      delete next[targetSlug]
      persistSavedPages(next)
      return next
    })
    if (slug === targetSlug) {
      setRegions([])
      setImageUrl(null)
      setImageDataUrl(null)
      setImageNaturalSize(null)
      setSlug('manual_labeling')
    }
  }, [slug])

  const newPage = useCallback(() => {
    setRegions([])
    setImageUrl(null)
    setImageDataUrl(null)
    setImageNaturalSize(null)
    setSlug(`page_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`)
    setSelectedId(null)
    setWarnings([])
  }, [])

  const loadSlice = useCallback(async (slice: KnownSlice) => {
    try {
      // 1. Prefer the local edit if the user already worked on this slug.
      const local = savedPages[slice.slug]
      if (local && local.regions.length > 0) {
        loadSavedPage(local)
        setWarnings([`Loaded saved edit of ${slice.label} (${local.regions.length} regions)`])
        return
      }

      // 2. Otherwise pull the canonical image + (optional) contract.
      const dataUrl = await urlToDataUrl(slice.imageUrl)
      let importedRegions: Region[] = []
      const importWarnings: string[] = []
      if (slice.expectedElementsUrl) {
        try {
          const resp = await fetch(slice.expectedElementsUrl)
          if (resp.ok) {
            const json = await resp.json()
            const { regions: rs, warnings: ws } = importJson(json)
            importedRegions = rs
            importWarnings.push(...ws)
          } else {
            importWarnings.push(`expected_elements.json fetch returned HTTP ${resp.status}`)
          }
        } catch (err) {
          importWarnings.push(`expected_elements.json fetch failed: ${err instanceof Error ? err.message : String(err)}`)
        }
      }

      setSlug(slice.slug)
      setImageUrl(dataUrl)
      setImageDataUrl(dataUrl)
      setRegions(importedRegions)
      setSelectedId(null)
      setWarnings([
        `Loaded ${slice.label} · ${importedRegions.length} region${importedRegions.length === 1 ? '' : 's'} from contract`,
        ...importWarnings,
      ])
    } catch (err) {
      setWarnings([`Failed to load ${slice.label}: ${err instanceof Error ? err.message : String(err)}`])
    }
  }, [savedPages, loadSavedPage])

  /** Convert a client-pixel point to normalized image coords. Uses the
   *  scaled image wrapper rect so the mapping stays correct at any zoom. */
  const clientToNormalized = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const el = imgWrapperRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return null
    return [clamp01((clientX - r.left) / r.width), clamp01((clientY - r.top) / r.height)]
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!imageUrl) return
    const p = clientToNormalized(e.clientX, e.clientY)
    if (!p) return
    setSelectedId(null)
    setDrag({ startX: p[0], startY: p[1], curX: p[0], curY: p[1], family: activeFamily })
  }, [activeFamily, clientToNormalized, imageUrl])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (regionDrag && imageNaturalSize) {
      // Convert pixel delta → normalized [0,1] coords. The wrapper at zoom z
      // is naturalW * z pixels wide; one px on screen = 1 / (naturalW * z)
      // in normalized space.
      const dxN = (e.clientX - regionDrag.startClientX) / (imageNaturalSize.w * zoom)
      const dyN = (e.clientY - regionDrag.startClientY) / (imageNaturalSize.h * zoom)
      const [sx0, sy0, sx1, sy1] = regionDrag.startBbox
      let nx0 = sx0, ny0 = sy0, nx1 = sx1, ny1 = sy1
      switch (regionDrag.mode) {
        case 'move': {
          // Translate, but keep the rect entirely inside [0, 1].
          let tx = dxN, ty = dyN
          if (sx0 + tx < 0) tx = -sx0
          if (sy0 + ty < 0) ty = -sy0
          if (sx1 + tx > 1) tx =  1 - sx1
          if (sy1 + ty > 1) ty =  1 - sy1
          nx0 = sx0 + tx; nx1 = sx1 + tx
          ny0 = sy0 + ty; ny1 = sy1 + ty
          break
        }
        case 'n':  ny0 = clamp01(sy0 + dyN); break
        case 's':  ny1 = clamp01(sy1 + dyN); break
        case 'e':  nx1 = clamp01(sx1 + dxN); break
        case 'w':  nx0 = clamp01(sx0 + dxN); break
        case 'nw': nx0 = clamp01(sx0 + dxN); ny0 = clamp01(sy0 + dyN); break
        case 'ne': nx1 = clamp01(sx1 + dxN); ny0 = clamp01(sy0 + dyN); break
        case 'sw': nx0 = clamp01(sx0 + dxN); ny1 = clamp01(sy1 + dyN); break
        case 'se': nx1 = clamp01(sx1 + dxN); ny1 = clamp01(sy1 + dyN); break
      }
      // Normalize against accidental inversion when a resize crosses through
      // the opposite edge.
      const bbox: [number, number, number, number] = [
        Math.min(nx0, nx1), Math.min(ny0, ny1),
        Math.max(nx0, nx1), Math.max(ny0, ny1),
      ]
      setRegions(prev => prev.map(r => r.id === regionDrag.regionId ? { ...r, bbox } : r))
      return
    }
    if (!drag) return
    const p = clientToNormalized(e.clientX, e.clientY)
    if (!p) return
    setDrag({ ...drag, curX: p[0], curY: p[1] })
  }, [clientToNormalized, drag, regionDrag, imageNaturalSize, zoom])

  const handleMouseUp = useCallback(() => {
    if (regionDrag) { setRegionDrag(null); return }
    if (!drag) return
    const bbox = normalizeRect(drag.startX, drag.startY, drag.curX, drag.curY)
    const w = bbox[2] - bbox[0], h = bbox[3] - bbox[1]
    if (w < 0.005 || h < 0.005) {
      setDrag(null)
      return
    }
    const id = newId()
    setRegions(prev => [...prev, { id, family: drag.family, bbox }])
    setSelectedId(id)
    setDrag(null)
  }, [drag, regionDrag])

  /** Click the family tag → cycle through 4 anchored positions. The label
   *  is always pinned to a corner of the bbox so move/resize keep them
   *  visually attached. */
  const handleLabelClick = useCallback((e: React.MouseEvent, regionId: string) => {
    e.stopPropagation()
    e.preventDefault()
    setRegions(prev => prev.map(r => r.id === regionId
      ? { ...r, labelAnchor: nextAnchor(r.labelAnchor) }
      : r))
  }, [])

  const handleRegionMouseDown = useCallback(
    (e: React.MouseEvent, regionId: string,
     mode: 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' = 'move') => {
      e.stopPropagation()
      e.preventDefault()
      const r = regions.find(rr => rr.id === regionId)
      if (!r) return
      setSelectedId(regionId)
      setRegionDrag({
        regionId, mode,
        startClientX: e.clientX,
        startClientY: e.clientY,
        startBbox: [...r.bbox] as [number, number, number, number],
      })
    }, [regions])

  /** Keybindings:
   *    Esc        → cancel drag/selection/context-menu
   *    Del/BS     → delete selected region
   *    1-9/0/q    → pick family
   *    Ctrl/Cmd + + / = → zoom in
   *    Ctrl/Cmd + -     → zoom out
   *    Ctrl/Cmd + 0     → reset zoom (100%)
   *    Ctrl/Cmd + 9     → fit image to viewport
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.target as HTMLElement)?.tagName === 'INPUT' || (e.target as HTMLElement)?.tagName === 'TEXTAREA') return
      // Zoom shortcuts.
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomIn(); return }
        if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomOut(); return }
        if (e.key === '0')                  { e.preventDefault(); zoomReset(); return }
        if (e.key === '9')                  { e.preventDefault(); zoomFit(); return }
      }
      if (e.key === 'Escape') {
        setDrag(null)
        setSelectedId(null)
        setContextMenu(null)
        return
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        setRegions(prev => prev.filter(r => r.id !== selectedId))
        setSelectedId(null)
        return
      }
      // Family hotkeys — but skip if Ctrl/Cmd held (those mean zoom).
      if (e.ctrlKey || e.metaKey) return
      const match = CANONICAL_FAMILIES.find(f => f.hotkey === e.key.toLowerCase())
      if (match) setActiveFamily(match.id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedId, zoomIn, zoomOut, zoomReset, zoomFit])

  /** Ctrl/Cmd + scroll zooms; plain scroll uses native canvas scrolling. */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    setZoom(z => {
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z * factor))
    })
  }, [])

  /** Right-click context menu — over a region: gives quick zoom + delete +
   *  family pick. Over empty canvas: zoom only. */
  const handleContextMenu = useCallback((e: React.MouseEvent, regionId?: string) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, regionId })
    if (regionId) setSelectedId(regionId)
  }, [])

  // Close context menu on outside click.
  useEffect(() => {
    if (!contextMenu) return
    function onDown() { setContextMenu(null) }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [contextMenu])

  const onFile = useCallback(async (file: File) => {
    // Persist as data URL so reload/saved-pages can rehydrate the image.
    // (URL.createObjectURL would not survive a page reload.)
    const dataUrl = await fileToDataUrl(file)
    setImageUrl(dataUrl)
    setImageDataUrl(dataUrl)
    setRegions([])
    setSelectedId(null)
    const stem = file.name.replace(/\.[^.]+$/, '')
    setSlug(s => (s === 'manual_labeling' || s.startsWith('page_2')) ? stem : s)
  }, [])

  const onJsonImport = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || ''))
        const { regions: imported, warnings: w, format } = importJson(data)
        setRegions(prev => [...prev, ...imported])
        setWarnings([`Imported ${imported.length} regions from ${format}`, ...w])
      } catch (err) {
        setWarnings([`Import failed: ${err instanceof Error ? err.message : String(err)}`])
      }
    }
    reader.readAsText(file)
  }, [])

  const onExport = useCallback(() => {
    const payload = regionsToExpected(regions, slug)
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${slug}_expected_elements.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [regions, slug])

  // Show a preview rect while dragging.
  const previewRect = useMemo(() => {
    if (!drag) return null
    const bbox = normalizeRect(drag.startX, drag.startY, drag.curX, drag.curY)
    return bbox
  }, [drag])

  const activeFamilyDef = CANONICAL_FAMILIES.find(f => f.id === activeFamily)!

  return (
    <div className="pdf-lab-labeling-root" data-qid="pdf-lab:labeling:root">
      <aside className="pdf-lab-labeling-chips" data-qid="pdf-lab:labeling:chip-column">
        {(() => {
          // One unified explorer: known slices first, then any custom local
          // slugs the user added that aren't in the manifest. Each row shows
          // the live region count from the saved-page record (so users can
          // see at-a-glance what's actually labeled vs. blank).
          const knownSlugs = new Set(KNOWN_SLICES.map(s => s.slug))
          const customSavedPages = Object.values(savedPages)
            .filter(p => !knownSlugs.has(p.slug) && p.regions.length > 0)
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

          return (
            <div className="pdf-lab-labeling-pages">
              <div className="pdf-lab-labeling-chips-title">Projects</div>
              {KNOWN_SLICES.map(s => {
                const saved = savedPages[s.slug]
                const isActive = s.slug === slug
                const regionCount = saved?.regions.length ?? 0
                const dirty = saved && saved.regions.length > 0 && imageDataUrl === saved.imageDataUrl ? '·' : ''
                return (
                  <div
                    key={s.slug}
                    className={`pdf-lab-labeling-pages-row ${isActive ? 'is-active' : ''}`}
                    data-qid={`pdf-lab:labeling:project-${s.slug}`}
                  >
                    <button
                      className="pdf-lab-labeling-pages-row-main"
                      onClick={() => loadSlice(s)}
                      title={s.imageUrl}
                    >
                      <span className="pdf-lab-labeling-pages-row-slug">{s.label}</span>
                      <span className="pdf-lab-labeling-pages-row-hint">
                        {regionCount > 0
                          ? `${regionCount} region${regionCount === 1 ? '' : 's'} ${dirty}`
                          : (s.expectedElementsUrl ? 'has contract · click to load' : 'blank · click to label')}
                      </span>
                    </button>
                    {saved && (
                      <button
                        className="pdf-lab-labeling-pages-row-del"
                        onClick={() => deleteSavedPage(s.slug)}
                        title={`Clear local edits for ${s.slug}`}
                      >×</button>
                    )}
                  </div>
                )
              })}
              {customSavedPages.length > 0 && (
                <>
                  <div className="pdf-lab-labeling-pages-section">CUSTOM</div>
                  {customSavedPages.map(p => {
                    const isActive = p.slug === slug
                    return (
                      <div
                        key={p.slug}
                        className={`pdf-lab-labeling-pages-row ${isActive ? 'is-active' : ''}`}
                        data-qid={`pdf-lab:labeling:saved-${p.slug}`}
                      >
                        <button
                          className="pdf-lab-labeling-pages-row-main"
                          onClick={() => loadSavedPage(p)}
                          title={`Updated ${p.updatedAt}`}
                        >
                          <span className="pdf-lab-labeling-pages-row-slug">{p.slug}</span>
                          <span className="pdf-lab-labeling-pages-row-hint">
                            {p.regions.length} region{p.regions.length === 1 ? '' : 's'}
                          </span>
                        </button>
                        <button
                          className="pdf-lab-labeling-pages-row-del"
                          onClick={() => deleteSavedPage(p.slug)}
                          title={`Delete custom slug ${p.slug}`}
                        >×</button>
                      </div>
                    )
                  })}
                </>
              )}
              <button className="pdf-lab-labeling-pages-new" data-qid="pdf-lab:labeling:new-page" onClick={newPage}>
                + Custom page from file
              </button>
            </div>
          )
        })()}

        <div className="pdf-lab-labeling-chips-title">Family</div>
        <div className="pdf-lab-labeling-chips-hint">
          Click a chip, then drag on the page. The badge on the right is a keyboard shortcut.
        </div>
        {CANONICAL_FAMILIES.map(f => (
          <button
            key={f.id}
            data-qid={`pdf-lab:labeling:chip-${f.id}`}
            className={`pdf-lab-labeling-chip ${activeFamily === f.id ? 'is-active' : ''}`}
            style={{ ['--chip-color' as string]: f.color }}
            onClick={() => setActiveFamily(f.id)}
            title={`${f.id} (${f.hotkey})`}
          >
            <span className="pdf-lab-labeling-chip-swatch" />
            <span className="pdf-lab-labeling-chip-label">{f.id}</span>
            <span className="pdf-lab-labeling-chip-hotkey">{f.hotkey}</span>
          </button>
        ))}
      </aside>

      <section className="pdf-lab-labeling-canvas-pane" data-qid="pdf-lab:labeling:canvas-pane">
        <header className="pdf-lab-labeling-canvas-toolbar">
          <label className="pdf-lab-labeling-file">
            <input type="file" accept="image/*" onChange={e => e.target.files?.[0] && onFile(e.target.files[0])} />
            <span>Open page image…</span>
          </label>
          <label className="pdf-lab-labeling-file">
            <input type="file" accept="application/json,.json" onChange={e => e.target.files?.[0] && onJsonImport(e.target.files[0])} />
            <span>Import JSON (VIA / expected_elements)…</span>
          </label>
          <span className="pdf-lab-labeling-spacer" />
          <input
            className="pdf-lab-labeling-slug"
            type="text"
            value={slug}
            onChange={e => setSlug(e.target.value)}
            placeholder="slice_id (slug)"
          />
          <button className="pdf-lab-labeling-export" onClick={onExport} disabled={regions.length === 0}>
            Export expected_elements.json
          </button>
          <span className="pdf-lab-labeling-toolbar-divider" />
          <button className="pdf-lab-labeling-zoom-btn" onClick={zoomOut}     title="Zoom out (Ctrl/Cmd −)">−</button>
          <button className="pdf-lab-labeling-zoom-btn" onClick={zoomFit}     title="Fit to viewport (Ctrl/Cmd 9)">fit</button>
          <button className="pdf-lab-labeling-zoom-btn" onClick={zoomReset}   title="Reset zoom 100% (Ctrl/Cmd 0)">{Math.round(zoom * 100)}%</button>
          <button className="pdf-lab-labeling-zoom-btn" onClick={zoomIn}      title="Zoom in (Ctrl/Cmd +)">+</button>
        </header>

        <div
          ref={canvasRef}
          className="pdf-lab-labeling-canvas"
          data-qid="pdf-lab:labeling:canvas"
          onWheel={handleWheel}
          onContextMenu={e => handleContextMenu(e)}
        >
          {imageUrl ? (
            <div
              ref={imgWrapperRef}
              className="pdf-lab-labeling-canvas-inner"
              style={imageNaturalSize ? {
                width: `${imageNaturalSize.w * zoom}px`,
                height: `${imageNaturalSize.h * zoom}px`,
              } : undefined}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => drag && handleMouseUp()}
            >
              <img
                src={imageUrl}
                alt="Page being annotated"
                className="pdf-lab-labeling-canvas-img"
                onLoad={e => {
                  const img = e.currentTarget
                  setImageNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
                }}
                draggable={false}
              />
              {regions.map(r => {
                const def = CANONICAL_FAMILIES.find(f => f.id === r.family)
                const isSelected = selectedId === r.id
                return (
                  <div
                    key={r.id}
                    className={`pdf-lab-labeling-region ${isSelected ? 'is-selected' : ''}`}
                    onMouseDown={e => handleRegionMouseDown(e, r.id, 'move')}
                    onContextMenu={e => handleContextMenu(e, r.id)}
                    style={{
                      left: `${r.bbox[0] * 100}%`,
                      top: `${r.bbox[1] * 100}%`,
                      width: `${(r.bbox[2] - r.bbox[0]) * 100}%`,
                      height: `${(r.bbox[3] - r.bbox[1]) * 100}%`,
                      borderColor: def?.color ?? '#fff',
                      background: `${def?.color ?? '#fff'}22`,
                    }}
                  >
                    <span
                      className={`pdf-lab-labeling-region-tag tag-anchor-${r.labelAnchor ?? 'top-outside'}`}
                      style={{ background: def?.color ?? '#fff' }}
                      onMouseDown={e => { e.stopPropagation(); e.preventDefault() }}
                      onClick={e => handleLabelClick(e, r.id)}
                      title="Click to cycle: top-outside → top-inside → bottom-inside → bottom-outside"
                    >
                      {r.family}{r.label ? ` · ${r.label.slice(0, 24)}` : ''}
                    </span>
                    {isSelected && (['nw','n','ne','e','se','s','sw','w'] as const).map(dir => (
                      <div
                        key={dir}
                        className={`pdf-lab-labeling-region-handle h-${dir}`}
                        onMouseDown={e => handleRegionMouseDown(e, r.id, dir)}
                        title={`Drag to resize (${dir})`}
                      />
                    ))}
                  </div>
                )
              })}
              {previewRect && (
                <div
                  className="pdf-lab-labeling-region is-preview"
                  style={{
                    left: `${previewRect[0] * 100}%`,
                    top: `${previewRect[1] * 100}%`,
                    width: `${(previewRect[2] - previewRect[0]) * 100}%`,
                    height: `${(previewRect[3] - previewRect[1]) * 100}%`,
                    borderColor: activeFamilyDef.color,
                    background: `${activeFamilyDef.color}22`,
                  }}
                />
              )}
            </div>
          ) : (
            <div className="pdf-lab-labeling-empty">
              Open a page image to start labeling.
              <br /><small>Hotkeys 1-9/0/q pick a family · Esc cancels · Del removes selection · Ctrl-+/-/0/9 zoom · Right-click for menu</small>
            </div>
          )}
        </div>

        {contextMenu && (
          <div
            className="pdf-lab-labeling-ctx-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onMouseDown={e => e.stopPropagation()}
          >
            <button onClick={() => { zoomIn(); setContextMenu(null) }}>Zoom in</button>
            <button onClick={() => { zoomOut(); setContextMenu(null) }}>Zoom out</button>
            <button onClick={() => { zoomFit(); setContextMenu(null) }}>Fit to viewport</button>
            <button onClick={() => { zoomReset(); setContextMenu(null) }}>Reset 100%</button>
            {contextMenu.regionId && (
              <>
                <div className="pdf-lab-labeling-ctx-divider" />
                <div className="pdf-lab-labeling-ctx-header">Change family</div>
                {CANONICAL_FAMILIES.map(f => (
                  <button
                    key={f.id}
                    onClick={() => {
                      setRegions(prev => prev.map(r => r.id === contextMenu.regionId ? { ...r, family: f.id } : r))
                      setContextMenu(null)
                    }}
                  >
                    <span style={{ background: f.color, width: 10, height: 10, display: 'inline-block', borderRadius: 2, marginRight: 6 }} />
                    {f.id}
                  </button>
                ))}
                <div className="pdf-lab-labeling-ctx-divider" />
                <button
                  onClick={() => {
                    setRegions(prev => prev.map(r => r.id === contextMenu.regionId ? { ...r, labelAnchor: undefined } : r))
                    setContextMenu(null)
                  }}
                >Reset label position</button>
                <button
                  className="pdf-lab-labeling-ctx-del"
                  onClick={() => {
                    setRegions(prev => prev.filter(r => r.id !== contextMenu.regionId))
                    setSelectedId(null)
                    setContextMenu(null)
                  }}
                >Delete region</button>
              </>
            )}
          </div>
        )}

        {warnings.length > 0 && (
          <div className="pdf-lab-labeling-warnings" data-qid="pdf-lab:labeling:warnings">
            {warnings.map((w, i) => <div key={i}>· {w}</div>)}
          </div>
        )}
      </section>

      <aside className="pdf-lab-labeling-regions-pane" data-qid="pdf-lab:labeling:regions-pane">
        <div className="pdf-lab-labeling-regions-title">
          Regions ({regions.length})
          {imageNaturalSize && <span className="pdf-lab-labeling-regions-meta">{imageNaturalSize.w}×{imageNaturalSize.h}px</span>}
        </div>
        {regions.length === 0 && (
          <div className="pdf-lab-labeling-regions-empty">No regions yet. Pick a family, drag on the page.</div>
        )}
        {regions.map(r => {
          const def = CANONICAL_FAMILIES.find(f => f.id === r.family)
          const update = (patch: Partial<Region>) => setRegions(prev => prev.map(x => x.id === r.id ? { ...x, ...patch } : x))
          const remove = () => { setRegions(prev => prev.filter(x => x.id !== r.id)); if (selectedId === r.id) setSelectedId(null) }
          return (
            <div
              key={r.id}
              data-qid={`pdf-lab:labeling:region-${r.id}`}
              className={`pdf-lab-labeling-region-row ${selectedId === r.id ? 'is-selected' : ''}`}
              onClick={() => setSelectedId(r.id)}
            >
              <div className="pdf-lab-labeling-region-row-head">
                <span className="pdf-lab-labeling-region-row-swatch" style={{ background: def?.color }} />
                <select value={r.family} onChange={e => update({ family: e.target.value as FamilyId })}>
                  {CANONICAL_FAMILIES.map(f => <option key={f.id} value={f.id}>{f.id}</option>)}
                </select>
                <button className="pdf-lab-labeling-region-row-del" onClick={e => { e.stopPropagation(); remove() }}>×</button>
              </div>
              <input
                type="text"
                value={r.label || ''}
                onChange={e => update({ label: e.target.value || undefined })}
                placeholder="label (e.g. 'AC-2 ACCOUNT MANAGEMENT')"
              />
              <textarea
                rows={2}
                value={r.text_hint || ''}
                onChange={e => update({ text_hint: e.target.value || undefined })}
                placeholder="text_hint — exact text the matcher should find"
              />
              {r.family === 'labeled_paragraph' && (
                <input
                  type="text"
                  value={r.lead_label || ''}
                  onChange={e => update({ lead_label: e.target.value || undefined })}
                  placeholder="lead_label (e.g. 'Discussion:')"
                />
              )}
            </div>
          )
        })}
      </aside>
    </div>
  )
}

/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import type { BboxBlock } from './types'
import { BLOCK_TYPE_COLORS } from './BboxWorkspace'
import { useRegisterAction } from '../../hooks/useRegisterAction'

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

interface PdfCanvasProps {
  pdfUrl: string
  pageNumber: number
  bboxOverlays: BboxBlock[]
  compareOverlays?: BboxBlock[]
  selectedBlockId: string | null
  activeTaskBlockId?: string | null
  onBlockClick: (id: string) => void
  onBlockContextMenu?: (id: string, x: number, y: number) => void
  zoom: number
  editMode?: boolean
  onBlockBBoxChange?: (id: string, bbox: [number, number, number, number]) => void
  onCanvasClick?: () => void
  onCreateBlock?: (bbox: [number, number, number, number]) => void
  fitMode?: 'manual' | 'page'
  interactionMode?: 'draw-block' | 'select-area'
  selectedAreaBBox?: [number, number, number, number] | null
  selectedAreaBlockIds?: string[]
  onSelectArea?: (bbox: [number, number, number, number], blockIds: string[]) => void
  selectedAreaToolbar?: ReactNode
}

type ResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

type EditInteraction =
  | {
      mode: 'drag'
      blockId: string
      start: [number, number]
      originalBbox: [number, number, number, number]
    }
  | {
      mode: 'resize'
      blockId: string
      handle: ResizeHandle
      originalBbox: [number, number, number, number]
    }
  | {
      mode: 'create'
      start: [number, number]
    }
  | {
      mode: 'select-area'
      start: [number, number]
    }

const DEFAULT_DPI = 150
const SCALE = DEFAULT_DPI / 72
const HANDLE_SIZE_PX = 8
const MIN_HANDLE_TARGET_PX = 6

const HANDLE_DEFS: Array<{ key: ResizeHandle; left: string; top: string; cursor: string }> = [
  { key: 'nw', left: '0%', top: '0%', cursor: 'nw-resize' },
  { key: 'n', left: '50%', top: '0%', cursor: 'n-resize' },
  { key: 'ne', left: '100%', top: '0%', cursor: 'ne-resize' },
  { key: 'e', left: '100%', top: '50%', cursor: 'e-resize' },
  { key: 'se', left: '100%', top: '100%', cursor: 'se-resize' },
  { key: 's', left: '50%', top: '100%', cursor: 's-resize' },
  { key: 'sw', left: '0%', top: '100%', cursor: 'sw-resize' },
  { key: 'w', left: '0%', top: '50%', cursor: 'w-resize' },
]

function formatCanvasSemanticLabel(block: Pick<BboxBlock, 'blockType' | 'semanticType'>): string {
  if (block.blockType === 'table' && block.semanticType === 'definition_list') return 'definition list'
  if (block.semanticType) return block.semanticType.replaceAll('_', ' ')
  return block.blockType.replaceAll('_', ' ')
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function moveBBox(
  original: [number, number, number, number],
  dx: number,
  dy: number
): [number, number, number, number] {
  const width = original[2] - original[0]
  const height = original[3] - original[1]
  const x1 = clamp(original[0] + dx, 0, 1 - width)
  const y1 = clamp(original[1] + dy, 0, 1 - height)
  return [x1, y1, x1 + width, y1 + height]
}

function resizeBBox(
  original: [number, number, number, number],
  handle: ResizeHandle,
  point: [number, number],
  minWidth: number,
  minHeight: number
): [number, number, number, number] {
  let [x1, y1, x2, y2] = original
  const [px, py] = point

  if (handle.includes('w')) x1 = clamp(px, 0, x2 - minWidth)
  if (handle.includes('e')) x2 = clamp(px, x1 + minWidth, 1)
  if (handle.includes('n')) y1 = clamp(py, 0, y2 - minHeight)
  if (handle.includes('s')) y2 = clamp(py, y1 + minHeight, 1)

  return [x1, y1, x2, y2]
}

function buildBBoxFromPoints(
  start: [number, number],
  end: [number, number]
): [number, number, number, number] {
  return [
    Math.min(start[0], end[0]),
    Math.min(start[1], end[1]),
    Math.max(start[0], end[0]),
    Math.max(start[1], end[1]),
  ]
}

export default function PdfCanvas({
  pdfUrl,
  pageNumber,
  bboxOverlays,
  compareOverlays = [],
  selectedBlockId,
  activeTaskBlockId = null,
  onBlockClick,
  onBlockContextMenu,
  zoom,
  editMode = false,
  onBlockBBoxChange,
  onCanvasClick,
  onCreateBlock,
  fitMode = 'manual',
  interactionMode = 'draw-block',
  selectedAreaBBox = null,
  selectedAreaBlockIds = [],
  onSelectArea,
  selectedAreaToolbar,
}: PdfCanvasProps) {
  useRegisterAction('pdf:page-wrapper', {
    app: 'datalake-explorer',
    action: 'PDF_PAGE_WRAPPER',
    label: 'Page Wrapper',
    description: 'PDF page wrapper in PdfCanvas',
  })
  useRegisterAction('pdf:canvas', {
    app: 'datalake-explorer',
    action: 'PDF_CANVAS',
    label: 'PDF Canvas',
    description: 'Rendered PDF page canvas in PdfCanvas',
  })
  useRegisterAction('pdf:create-layer', {
    app: 'datalake-explorer',
    action: 'PDF_CREATE_BLOCK',
    label: 'Create Block Layer',
    description: 'Interactive layer for creating reviewed blocks in PdfCanvas',
  })
  useRegisterAction('pdf:block', {
    app: 'datalake-explorer',
    action: 'PDF_SELECT_BLOCK',
    label: 'Select Block',
    description: 'Select or drag a reviewed extraction block in PdfCanvas',
  })
  useRegisterAction('pdf:block-handle', {
    app: 'datalake-explorer',
    action: 'PDF_RESIZE_BLOCK',
    label: 'Resize Block',
    description: 'Resize a reviewed extraction block using drag handles in PdfCanvas',
  })

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const pageWrapperRef = useRef<HTMLDivElement>(null)

  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dims, setDims] = useState({ w: 0, h: 0 })
  const [containerDims, setContainerDims] = useState({ w: 0, h: 0 })
  const [interaction, setInteraction] = useState<EditInteraction | null>(null)
  const [draftCreateBBox, setDraftCreateBBox] = useState<[number, number, number, number] | null>(null)
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null)

  const editable = Boolean(editMode && onBlockBBoxChange)
  const selectingArea = editable && interactionMode === 'select-area'

  useEffect(() => {
    const node = containerRef.current
    if (!node) return

    const update = () => {
      setContainerDims({
        w: node.clientWidth,
        h: node.clientHeight,
      })
    }

    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  const interactiveBlocks = useMemo(() => {
    return [...bboxOverlays].sort((a, b) => {
      const aArea = (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1])
      const bArea = (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1])
      return bArea - aArea
    })
  }, [bboxOverlays])

  const selectedAreaToolbarPosition = useMemo(() => {
    if (!selectedAreaBBox) return null
    const [left, top, , bottom] = selectedAreaBBox
    if (top < 0.1) {
      return {
        left: `${left * 100}%`,
        top: `${bottom * 100}%`,
        transform: 'translateY(8px)',
      }
    }
    return {
      left: `${left * 100}%`,
      top: `${top * 100}%`,
      transform: 'translateY(calc(-100% - 8px))',
    }
  }, [selectedAreaBBox])

  const classifyReviewBand = useCallback((block: BboxBlock): 'low' | 'medium' | 'ghost' => {
    const flagged = Boolean(block.flagged)
    const hasOpenComments = Boolean(block.hasOpenComments || (block.reviewNotes && block.reviewNotes.length > 0))
    if (flagged || block.confidence < 0.6) return 'low'
    if (hasOpenComments || block.confidence < 0.9) return 'medium'
    return 'ghost'
  }, [])

  const getPageRect = useCallback(() => {
    return pageWrapperRef.current?.getBoundingClientRect() ?? overlayRef.current?.getBoundingClientRect() ?? null
  }, [])

  const pointerToNormalized = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const rect = getPageRect()
    if (!rect || rect.width === 0 || rect.height === 0) return null
    const x = clamp((clientX - rect.left) / rect.width, 0, 1)
    const y = clamp((clientY - rect.top) / rect.height, 0, 1)
    return [x, y]
  }, [getPageRect])

  useEffect(() => {
    if (!pdfUrl) return

    let cancelled = false
    setLoading(true)
    setError(null)
    setPdfDoc(null)
    setPage(null)

    const task = pdfjsLib.getDocument(pdfUrl)
    task.promise
      .then((doc) => {
        if (!cancelled) setPdfDoc(doc)
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err)
          setError(msg)
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
      task.destroy()
    }
  }, [pdfUrl])

  useEffect(() => {
    if (!pdfDoc) return

    let cancelled = false
    const pdfPage = pageNumber + 1
    if (pdfPage < 1 || pdfPage > pdfDoc.numPages) {
      setError(`Page ${pdfPage} out of range (1-${pdfDoc.numPages})`)
      setLoading(false)
      return
    }

    pdfDoc.getPage(pdfPage).then((p) => {
      if (!cancelled) {
        setPage(p)
        setLoading(false)
      }
    }).catch((err: unknown) => {
      if (!cancelled) {
        const msg = err instanceof Error ? err.message : String(err)
        setError(msg)
        setLoading(false)
      }
    })

    return () => { cancelled = true }
  }, [pdfDoc, pageNumber])

  useEffect(() => {
    if (!page || !canvasRef.current) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const baseViewport = page.getViewport({ scale: SCALE })
    const liveContainerWidth = containerRef.current?.clientWidth ?? containerDims.w
    const liveContainerHeight = containerRef.current?.clientHeight ?? containerDims.h
    const fittedZoom = fitMode === 'page' && liveContainerWidth > 0 && liveContainerHeight > 0
      ? Math.max(
        0.2,
        Math.min(
          (liveContainerWidth - 36) / baseViewport.width,
          (liveContainerHeight - 36) / baseViewport.height,
        ),
      )
      : zoom
    const viewport = page.getViewport({ scale: SCALE * fittedZoom })
    canvas.width = viewport.width
    canvas.height = viewport.height
    setDims({ w: viewport.width, h: viewport.height })

    let cancelled = false
    const renderTask = page.render({ canvas, canvasContext: ctx, viewport })
    renderTask.promise.catch(() => {
      if (!cancelled) {
        return
      }
    })

    return () => {
      cancelled = true
      renderTask.cancel()
    }
  }, [containerDims.h, containerDims.w, fitMode, page, zoom])

  useEffect(() => {
    if (!overlayRef.current || dims.w === 0) return

    const canvas = overlayRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width = dims.w
    canvas.height = dims.h
    ctx.clearRect(0, 0, dims.w, dims.h)

    for (const block of compareOverlays) {
      const [x1, y1, x2, y2] = block.bbox
      const rx = x1 * dims.w
      const ry = y1 * dims.h
      const rw = (x2 - x1) * dims.w
      const rh = (y2 - y1) * dims.h
      ctx.save()
      ctx.setLineDash([6, 4])
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)'
      ctx.lineWidth = 1.5
      ctx.strokeRect(rx, ry, rw, rh)
      ctx.fillStyle = 'rgba(148, 163, 184, 0.06)'
      ctx.fillRect(rx, ry, rw, rh)
      ctx.restore()
    }

    for (const block of bboxOverlays) {
      const [x1, y1, x2, y2] = block.bbox
      const rx = x1 * dims.w
      const ry = y1 * dims.h
      const rw = (x2 - x1) * dims.w
      const rh = (y2 - y1) * dims.h

      const isSelected = block.id === selectedBlockId
      const isActiveTask = block.id === activeTaskBlockId
      const band = classifyReviewBand(block)
      const isAgentAdded = block.id.startsWith('review:') || (block.cascadeTrail?.some((t: any) => t.tier === 'T2') ?? false)
      const color = band === 'low'
        ? '#FF4D4D'
        : band === 'medium'
          ? '#FFC107'
          : block.humanEdited
            ? '#23c7d9'
            : isAgentAdded
              ? '#a78bfa'
              : BLOCK_TYPE_COLORS[block.blockType]
      const faded = Boolean(selectedBlockId && !isSelected)
      const fillAlpha = isSelected ? '0.12' : band === 'ghost' ? '0.02' : band === 'medium' ? '0.05' : '0.07'

      ctx.fillStyle = isSelected
        ? 'rgba(124, 58, 237, 0.12)'
        : `rgba(${band === 'low' ? '255, 77, 77' : band === 'medium' ? '255, 193, 7' : '224, 224, 224'}, ${faded ? '0.01' : fillAlpha})`
      ctx.fillRect(rx, ry, rw, rh)

      ctx.strokeStyle = isSelected ? '#7c3aed' : color
      ctx.lineWidth = isSelected ? 2 : band === 'ghost' ? 1 : 2
      if (!isSelected) ctx.setLineDash(band === 'medium' ? [6, 4] : band === 'ghost' ? [3, 5] : [])
      ctx.globalAlpha = faded ? 0.12 : isActiveTask ? 1 : band === 'ghost' ? 0.28 : 0.95
      ctx.strokeRect(rx, ry, rw, rh)
      if (isAgentAdded && !isSelected && !block.humanEdited) {
        ctx.setLineDash([4, 4])
        ctx.strokeStyle = '#a78bfa'
        ctx.lineWidth = 1.5
        ctx.globalAlpha = faded ? 0.12 : 0.7
        ctx.strokeRect(rx - 2, ry - 2, rw + 4, rh + 4)
      }
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }
  }, [activeTaskBlockId, bboxOverlays, classifyReviewBand, compareOverlays, selectedBlockId, dims])

  useEffect(() => {
    if (!selectedBlockId) return
    const frame = window.requestAnimationFrame(() => {
      const el = pageWrapperRef.current?.querySelector<HTMLElement>(`[data-qid="pdf:block:${CSS.escape(selectedBlockId)}"]`)
      if (el) {
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
        return
      }
      pageWrapperRef.current?.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [dims.h, dims.w, pageNumber, selectedBlockId])

  useEffect(() => {
    if (!editable || !interaction) return

    const handleMove = (event: MouseEvent) => {
      const pointer = pointerToNormalized(event.clientX, event.clientY)
      const rect = getPageRect()
      if (!pointer || !rect) return
      const minWidth = Math.max(MIN_HANDLE_TARGET_PX / rect.width, 0.003)
      const minHeight = Math.max(MIN_HANDLE_TARGET_PX / rect.height, 0.003)

      if (interaction.mode === 'create' || interaction.mode === 'select-area') {
        setDraftCreateBBox(buildBBoxFromPoints(interaction.start, pointer))
        return
      }

      if (!onBlockBBoxChange) return
      const nextBBox = interaction.mode === 'drag'
        ? moveBBox(
            interaction.originalBbox,
            pointer[0] - interaction.start[0],
            pointer[1] - interaction.start[1]
          )
        : resizeBBox(interaction.originalBbox, interaction.handle, pointer, minWidth, minHeight)

      onBlockBBoxChange(interaction.blockId, nextBBox)
    }

    const handleUp = () => {
      if (interaction.mode === 'create') {
        const rect = getPageRect()
        if (rect && draftCreateBBox && onCreateBlock) {
          const width = draftCreateBBox[2] - draftCreateBBox[0]
          const height = draftCreateBBox[3] - draftCreateBBox[1]
          const minWidth = Math.max(MIN_HANDLE_TARGET_PX / rect.width, 0.003)
          const minHeight = Math.max(MIN_HANDLE_TARGET_PX / rect.height, 0.003)
          if (width >= minWidth && height >= minHeight) onCreateBlock(draftCreateBBox)
          else onCanvasClick?.()
        } else {
          onCanvasClick?.()
        }
        setDraftCreateBBox(null)
      } else if (interaction.mode === 'select-area') {
        if (draftCreateBBox && onSelectArea) {
          const [sx1, sy1, sx2, sy2] = draftCreateBBox
          const selectedBlockIds = bboxOverlays
            .filter((block) => {
              const [bx1, by1, bx2, by2] = block.bbox
              return !(bx2 < sx1 || bx1 > sx2 || by2 < sy1 || by1 > sy2)
            })
            .map((block) => block.id)
          onSelectArea(draftCreateBBox, selectedBlockIds)
        } else {
          onCanvasClick?.()
        }
        setDraftCreateBBox(null)
      }
      setInteraction(null)
    }

    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [bboxOverlays, draftCreateBBox, editable, getPageRect, interaction, onBlockBBoxChange, onCanvasClick, onCreateBlock, onSelectArea, pointerToNormalized])

  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!overlayRef.current || dims.w === 0) return

      const rect = overlayRef.current.getBoundingClientRect()
      const scaleX = dims.w / rect.width
      const scaleY = dims.h / rect.height
      const cx = (e.clientX - rect.left) * scaleX
      const cy = (e.clientY - rect.top) * scaleY

      const nx = cx / dims.w
      const ny = cy / dims.h

      let best: BboxBlock | null = null
      let bestArea = Infinity
      for (const block of bboxOverlays) {
        const [x1, y1, x2, y2] = block.bbox
        if (nx >= x1 && nx <= x2 && ny >= y1 && ny <= y2) {
          const area = (x2 - x1) * (y2 - y1)
          if (area < bestArea) {
            bestArea = area
            best = block
          }
        }
      }

      if (best) onBlockClick(best.id)
      else onCanvasClick?.()
    },
    [bboxOverlays, dims, onBlockClick, onCanvasClick]
  )

  const startDrag = useCallback((event: React.MouseEvent<HTMLDivElement>, block: BboxBlock) => {
    if (!editable) return
    if (event.button !== 0) return
    const pointer = pointerToNormalized(event.clientX, event.clientY)
    if (!pointer) return
    event.preventDefault()
    event.stopPropagation()
    onBlockClick(block.id)
    setInteraction({
      mode: 'drag',
      blockId: block.id,
      start: pointer,
      originalBbox: block.bbox,
    })
  }, [editable, onBlockClick, pointerToNormalized])

  const startResize = useCallback((event: React.MouseEvent<HTMLDivElement>, block: BboxBlock, handle: ResizeHandle) => {
    if (!editable) return
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    onBlockClick(block.id)
    setInteraction({
      mode: 'resize',
      blockId: block.id,
      handle,
      originalBbox: block.bbox,
    })
  }, [editable, onBlockClick])

  if (!pdfUrl) {
    return (
      <div style={centerStyle}>
        <span style={{ color: '#999999', fontFamily: 'monospace', fontSize: '13px' }}>
          No PDF loaded
        </span>
      </div>
    )
  }

  if (error) {
    return (
      <div style={centerStyle}>
        <span style={{ color: '#ff4444', fontFamily: 'monospace', fontSize: '12px', maxWidth: '80%', textAlign: 'center' }}>
          {error}
        </span>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={centerStyle}>
        <Spinner />
        <span style={{ color: '#999999', fontFamily: 'monospace', fontSize: '11px', marginTop: '8px' }}>
          Loading PDF...
        </span>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        overflow: 'auto',
        backgroundColor: '#0f1216',
      }}
    >
      <div
        ref={pageWrapperRef}
        data-qid="pdf:page-wrapper"
        data-qs-action="PDF_PAGE_WRAPPER"
        title="Page Wrapper"
        style={{ position: 'relative', flexShrink: 0, margin: '12px' }}
      >
        <canvas
          ref={canvasRef}
          data-qid="pdf:canvas"
          data-qs-action="PDF_CANVAS"
          title="PDF page canvas"
          style={{ display: 'block' }}
        />
        <canvas
          ref={overlayRef}
          onClick={editable ? undefined : handleOverlayClick}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            pointerEvents: editable ? 'none' : 'auto',
            cursor: editable ? 'default' : 'crosshair',
          }}
        />
        {editable && (
          <div
            data-qid="pdf:create-layer"
            data-qs-action="PDF_CREATE_BLOCK"
            title="Create reviewed block layer"
            style={{
              position: 'absolute',
              inset: 0,
              cursor: interaction?.mode === 'drag'
                ? 'move'
                : interaction?.mode === 'create' || interaction?.mode === 'select-area'
                  ? 'crosshair'
                  : 'default',
            }}
            onMouseDown={(event) => {
              if (event.button !== 0) return
              if (event.target === event.currentTarget) {
                const pointer = pointerToNormalized(event.clientX, event.clientY)
                if (!pointer) return
                setDraftCreateBBox([pointer[0], pointer[1], pointer[0], pointer[1]])
                setInteraction({ mode: selectingArea ? 'select-area' : 'create', start: pointer })
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault()
              if (event.target === event.currentTarget) onCanvasClick?.()
            }}
          >
            {interactiveBlocks.map((block) => {
              const [x1, y1, x2, y2] = block.bbox
              const isSelected = block.id === selectedBlockId
              const isActiveTask = block.id === activeTaskBlockId
              const isAreaSelected = selectedAreaBlockIds.includes(block.id)
              const isHovered = block.id === hoveredBlockId
              const band = classifyReviewBand(block)
              const isAgentAdded = block.id.startsWith('review:') || (block.cascadeTrail?.some((t: any) => t.tier === 'T2') ?? false)
              const baseColor = band === 'low'
                ? '#FF4D4D'
                : band === 'medium'
                  ? '#FFC107'
                  : block.humanEdited
                    ? '#23c7d9'
                    : isAgentAdded
                      ? '#a78bfa'
                      : BLOCK_TYPE_COLORS[block.blockType]
              const faded = Boolean(selectedBlockId && !isSelected)
              return (
                <div
                  key={block.id}
                  data-qid={`pdf:block:${block.id}`}
                  data-qs-action="PDF_SELECT_BLOCK"
                  title={`Select ${formatCanvasSemanticLabel(block)} block ${block.id}`}
                  onMouseDown={(event) => startDrag(event, block)}
                  onClick={(event) => {
                    event.stopPropagation()
                    onBlockClick(block.id)
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    onBlockClick(block.id)
                    onBlockContextMenu?.(block.id, event.clientX, event.clientY)
                  }}
                  onMouseEnter={() => setHoveredBlockId(block.id)}
                  onMouseLeave={() => setHoveredBlockId(prev => prev === block.id ? null : prev)}
                  style={{
                    position: 'absolute',
                    left: `${x1 * 100}%`,
                    top: `${y1 * 100}%`,
                    width: `${(x2 - x1) * 100}%`,
                    height: `${(y2 - y1) * 100}%`,
                    cursor: selectingArea ? 'crosshair' : 'move',
                    border: isSelected
                      ? '2px solid rgba(124, 58, 237, 0.95)'
                      : isAreaSelected
                        ? '2px dashed rgba(245, 158, 11, 0.95)'
                      : band === 'medium'
                        ? `2px dashed ${baseColor}`
                        : band === 'ghost'
                          ? `1px solid rgba(224, 224, 224, 0.24)`
                          : `2px solid ${baseColor}`,
                    boxSizing: 'border-box',
                    zIndex: isSelected ? 20 : 10,
                    overflow: 'visible',
                    opacity: faded ? 0.12 : band === 'ghost' ? 0.32 : 1,
                    boxShadow: isSelected
                      ? '0 0 0 1px rgba(124, 58, 237, 0.2)'
                      : isAreaSelected
                        ? '0 0 0 1px rgba(245, 158, 11, 0.35)'
                      : isActiveTask
                        ? `0 0 0 2px ${baseColor}33`
                      : isHovered
                        ? `0 0 0 1px ${baseColor}55`
                      : isAgentAdded
                        ? '0 0 0 2px rgba(167, 139, 250, 0.25)'
                        : 'none',
                    pointerEvents: selectingArea ? 'none' : 'auto',
                  }}
                >
                  {isSelected && HANDLE_DEFS.map((handle) => (
                    <div
                      key={handle.key}
                      data-qid={`pdf:block-handle:${block.id}:${handle.key}`}
                      data-qs-action="PDF_RESIZE_BLOCK"
                      title={`Resize block ${block.id} from ${handle.key.toUpperCase()} handle`}
                      onMouseDown={(event) => startResize(event, block, handle.key)}
                      style={{
                        position: 'absolute',
                        left: `calc(${handle.left} - ${HANDLE_SIZE_PX / 2}px)`,
                        top: `calc(${handle.top} - ${HANDLE_SIZE_PX / 2}px)`,
                        width: `${HANDLE_SIZE_PX}px`,
                        height: `${HANDLE_SIZE_PX}px`,
                        borderRadius: '1px',
                        backgroundColor: '#7c3aed',
                        border: '1px solid #5b21b6',
                        cursor: handle.cursor,
                      }}
                    />
                  ))}
                </div>
              )
            })}
            {draftCreateBBox && (
              <div
                style={{
                  position: 'absolute',
                  left: `${draftCreateBBox[0] * 100}%`,
                  top: `${draftCreateBBox[1] * 100}%`,
                  width: `${(draftCreateBBox[2] - draftCreateBBox[0]) * 100}%`,
                  height: `${(draftCreateBBox[3] - draftCreateBBox[1]) * 100}%`,
                  border: selectingArea ? '1.5px dashed rgba(245, 158, 11, 0.95)' : '1.5px dashed rgba(35, 199, 217, 0.95)',
                  backgroundColor: selectingArea ? 'rgba(245, 158, 11, 0.08)' : 'rgba(35, 199, 217, 0.08)',
                  boxSizing: 'border-box',
                  pointerEvents: 'none',
                  zIndex: 5,
                }}
              />
            )}
            {selectedAreaBBox && !draftCreateBBox && (
              <div
                style={{
                  position: 'absolute',
                  left: `${selectedAreaBBox[0] * 100}%`,
                  top: `${selectedAreaBBox[1] * 100}%`,
                  width: `${(selectedAreaBBox[2] - selectedAreaBBox[0]) * 100}%`,
                  height: `${(selectedAreaBBox[3] - selectedAreaBBox[1]) * 100}%`,
                  border: '1.5px dashed rgba(245, 158, 11, 0.95)',
                  backgroundColor: 'rgba(245, 158, 11, 0.06)',
                  boxSizing: 'border-box',
                  pointerEvents: 'none',
                  zIndex: 5,
                }}
              />
            )}
            {selectedAreaBBox && selectedAreaToolbar && selectedAreaToolbarPosition && (
              <div
                data-qid="pdf-lab:contextual-toolbar"
                style={{
                  position: 'absolute',
                  left: selectedAreaToolbarPosition.left,
                  top: selectedAreaToolbarPosition.top,
                  transform: selectedAreaToolbarPosition.transform,
                  zIndex: 30,
                  pointerEvents: 'auto',
                }}
              >
                {selectedAreaToolbar}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

const centerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  width: '100%',
  height: '100%',
  backgroundColor: '#0f1216',
}

function Spinner() {
  return (
    <div
      style={{
        width: '24px',
        height: '24px',
        border: '2px solid transparent',
        borderTop: '2px solid #4a9eff',
        borderRadius: '50%',
        animation: 'pdfcanvas-spin 0.8s linear infinite',
      }}
    >
      <style>{`@keyframes pdfcanvas-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}

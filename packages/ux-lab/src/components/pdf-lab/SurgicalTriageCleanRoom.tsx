import { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { ReviewBundleButton } from '../common/ReviewBundleButton'
import { useRegisterAction } from '../../hooks/useRegisterAction'
import './SurgicalTriageCleanRoom.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

export interface SurgicalTriageCleanRoomTask {
  id: string
  question: string
  reasoning: string
  path: string
  severity: string
  bbox: [number, number, number, number]
}

interface SurgicalTriageCleanRoomProps {
  pdfUrl: string
  pageNumber: number
  taskIndex: number
  taskCount: number
  task: SurgicalTriageCleanRoomTask | null
  intentDraft: string
  onIntentChange: (value: string) => void
  onAccept: () => void
  onReject: () => void
  onSkip: () => void
  onPrevious: () => void
  onNext: () => void
  onOpenAudit: () => void
  onOpenQueue: () => void
}

interface PageDims {
  width: number
  height: number
}

const MIN_SCALE = 1.15
const MAX_SCALE = 1.9

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function getVisibleStageSize(node: HTMLDivElement | null): PageDims {
  return {
    width: node?.clientWidth ?? 1280,
    height: node?.clientHeight ?? 733,
  }
}

export function SurgicalTriageCleanRoom(props: SurgicalTriageCleanRoomProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useRegisterAction('pdf-lab:clean-room:queue', {
    app: 'pdf-lab',
    action: 'PDF_LAB_CLEAN_ROOM_OPEN_QUEUE',
    label: 'Open Queue',
    description: 'Open the hidden PDF Lab ambiguity queue',
  })
  useRegisterAction('pdf-lab:clean-room:bundle', {
    app: 'pdf-lab',
    action: 'PDF_LAB_CLEAN_ROOM_GEMINI_BUNDLE',
    label: 'Gemini Bundle',
    description: 'Generate a Gemini review bundle for PDF Lab',
  })
  useRegisterAction('pdf-lab:clean-room:audit', {
    app: 'pdf-lab',
    action: 'PDF_LAB_CLEAN_ROOM_OPEN_AUDIT',
    label: 'Audit / Repair',
    description: 'Open PDF Lab full audit and repair mode',
  })
  useRegisterAction('pdf-lab:clean-room:accept', {
    app: 'pdf-lab',
    action: 'PDF_LAB_CLEAN_ROOM_ACCEPT',
    label: 'Confirm (A)',
    description: 'Confirm the active PDF Lab ambiguity card and advance',
  })
  useRegisterAction('pdf-lab:clean-room:reject', {
    app: 'pdf-lab',
    action: 'PDF_LAB_CLEAN_ROOM_REJECT',
    label: 'Reject (R)',
    description: 'Reject the active PDF Lab ambiguity card and advance',
  })
  useRegisterAction('pdf-lab:clean-room:skip', {
    app: 'pdf-lab',
    action: 'PDF_LAB_CLEAN_ROOM_SKIP',
    label: 'Skip (S)',
    description: 'Skip the active PDF Lab ambiguity card',
  })
  useRegisterAction('pdf-lab:clean-room:intent', {
    app: 'pdf-lab',
    action: 'PDF_LAB_CLEAN_ROOM_INTENT_CHANGE',
    label: 'Intent Correction',
    description: 'Type an intent correction for the active PDF Lab ambiguity card',
  })
  useRegisterAction('pdf-lab:clean-room:previous', {
    app: 'pdf-lab',
    action: 'PDF_LAB_CLEAN_ROOM_PREVIOUS',
    label: 'Previous Card',
    description: 'Move to the previous PDF Lab ambiguity card',
  })
  useRegisterAction('pdf-lab:clean-room:next', {
    app: 'pdf-lab',
    action: 'PDF_LAB_CLEAN_ROOM_NEXT',
    label: 'Next Card',
    description: 'Move to the next PDF Lab ambiguity card',
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return
      const key = event.key.toLowerCase()
      if (key === 'a') props.onAccept()
      if (key === 'r') props.onReject()
      if (key === 's') props.onSkip()
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [props.onAccept, props.onReject, props.onSkip])

  useEffect(() => {
    inputRef.current?.focus()
  }, [props.task?.id])

  const hudSide = props.task && props.task.bbox[2] > 0.72 ? 'left' : 'right'

  if (!props.task) return null

  return (
    <div className="pdf-lab-cr-root" data-qid="pdf-lab:clean-room:root">
      <header className="pdf-lab-cr-header">
        <div className="pdf-lab-cr-header-left">
          <button
            className="pdf-lab-cr-button pdf-lab-cr-menu"
            data-qid="pdf-lab:clean-room:queue"
            data-qs-action="PDF_LAB_CLEAN_ROOM_OPEN_QUEUE"
            title="Open ambiguity queue"
            onClick={props.onOpenQueue}
          >
            ☰
          </button>
          <span>Card {props.taskIndex + 1} / {props.taskCount}</span>
        </div>
        <div className="pdf-lab-cr-title">NIST SP 800-53 Rev. 5 · Surgical Triage</div>
        <div className="pdf-lab-cr-header-actions">
          <ReviewBundleButton
            app="pdf-lab"
            endpoint="/api/pdf-lab/gemini-review-bundle"
            actionId="pdf-lab:clean-room:bundle"
            action="PDF_LAB_CLEAN_ROOM_GEMINI_BUNDLE"
            label="Gemini Bundle"
            className="pdf-lab-cr-button"
            title="Generate Gemini review bundle"
            description="Generate a Gemini review bundle with context, current code, screenshots, and a five-file zip"
            requestBody={{
              surface: 'pdf-lab',
              route: 'http://localhost:3002/#pdf-lab',
              activeTaskId: props.task.id,
              activePage: props.pageNumber + 1,
              workflowTaskIndex: props.taskIndex,
            }}
          />
          <button
            className="pdf-lab-cr-button"
            data-qid="pdf-lab:clean-room:audit"
            data-qs-action="PDF_LAB_CLEAN_ROOM_OPEN_AUDIT"
            title="Enter full Audit/Repair mode"
            onClick={props.onOpenAudit}
          >
            Audit / Repair
          </button>
        </div>
      </header>

      <main className="pdf-lab-cr-stage">
        <CleanPdfEvidence
          pdfUrl={props.pdfUrl}
          pageNumber={props.pageNumber}
          bbox={props.task.bbox}
          hudSide={hudSide}
        />
        <aside className={`pdf-lab-cr-hud pdf-lab-cr-hud-${hudSide}`} data-qid="pdf-lab:clean-room:hud">
          <div className="pdf-lab-cr-meta">
            <span className="pdf-lab-cr-path">{props.task.path}</span>
            <span className={`pdf-lab-cr-severity ${props.task.severity.toLowerCase()}`}>{props.task.severity}</span>
          </div>
          <h2>{props.task.question}</h2>
          <p>{props.task.reasoning}</p>
          <input
            ref={inputRef}
            className="pdf-lab-cr-input"
            data-qid="pdf-lab:clean-room:intent"
            data-qs-action="PDF_LAB_CLEAN_ROOM_INTENT_CHANGE"
            title="Type intent: table, move box up, split row"
            value={props.intentDraft}
            onChange={(event) => props.onIntentChange(event.target.value)}
            placeholder="Type intent: table, move box up, split row..."
            autoFocus
          />
          <div className="pdf-lab-cr-actions">
            <button
              className="pdf-lab-cr-reject"
              data-qid="pdf-lab:clean-room:reject"
              data-qs-action="PDF_LAB_CLEAN_ROOM_REJECT"
              title="Reject this card (R)"
              onClick={props.onReject}
            >
              Reject (R)
            </button>
            <button
              data-qid="pdf-lab:clean-room:skip"
              data-qs-action="PDF_LAB_CLEAN_ROOM_SKIP"
              title="Skip this card (S)"
              onClick={props.onSkip}
            >
              Skip (S)
            </button>
            <button
              className="pdf-lab-cr-confirm"
              data-qid="pdf-lab:clean-room:accept"
              data-qs-action="PDF_LAB_CLEAN_ROOM_ACCEPT"
              title="Confirm this card (A)"
              onClick={props.onAccept}
            >
              Confirm (A)
            </button>
          </div>
        </aside>
      </main>

      <footer className="pdf-lab-cr-footer">
        <div className="pdf-lab-cr-nav">
          <button
            data-qid="pdf-lab:clean-room:previous"
            data-qs-action="PDF_LAB_CLEAN_ROOM_PREVIOUS"
            title="Previous card"
            onClick={props.onPrevious}
          >
            ←
          </button>
          <button
            data-qid="pdf-lab:clean-room:next"
            data-qs-action="PDF_LAB_CLEAN_ROOM_NEXT"
            title="Next card"
            onClick={props.onNext}
          >
            →
          </button>
        </div>
        <div className="pdf-lab-cr-hotkeys">
          USE <kbd>A</kbd> ACCEPT · <kbd>R</kbd> REJECT · <kbd>S</kbd> SKIP
        </div>
        <div>ZEN MODE ACTIVE</div>
      </footer>
    </div>
  )
}

function CleanPdfEvidence({
  pdfUrl,
  pageNumber,
  bbox,
  hudSide,
}: {
  pdfUrl: string
  pageNumber: number
  bbox: [number, number, number, number]
  hudSide: 'left' | 'right'
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState<PDFPageProxy | null>(null)
  const [basePage, setBasePage] = useState<PageDims | null>(null)
  const [stageSize, setStageSize] = useState<PageDims>({ width: 1280, height: 733 })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const update = () => setStageSize(getVisibleStageSize(node))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setError(null)
    setLoading(true)
    const task = pdfjsLib.getDocument(pdfUrl)

    task.promise
      .then((doc) => {
        if (!cancelled) setPdfDoc(doc)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
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

    pdfDoc.getPage(pdfPage)
      .then((loadedPage) => {
        if (cancelled) return
        const viewport = loadedPage.getViewport({ scale: 1 })
        setBasePage({ width: viewport.width, height: viewport.height })
        setPage(loadedPage)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [pageNumber, pdfDoc])

  const renderScale = useMemo(() => {
    if (!basePage) return 2.2
    const [x1, y1, x2, y2] = bbox
    const bboxWidth = Math.max(0.04, x2 - x1)
    const bboxHeight = Math.max(0.04, y2 - y1)
    const targetBBoxWidth = Math.min(stageSize.width * 0.36, 470)
    const targetBBoxHeight = Math.min(stageSize.height * 0.32, 260)
    const widthScale = targetBBoxWidth / (basePage.width * bboxWidth)
    const heightScale = targetBBoxHeight / (basePage.height * bboxHeight)
    return clamp(Math.min(widthScale, heightScale), MIN_SCALE, MAX_SCALE)
  }, [basePage, bbox, stageSize.height, stageSize.width])

  useEffect(() => {
    if (!page || !canvasRef.current) return
    const canvas = canvasRef.current
    const context = canvas.getContext('2d')
    if (!context) return
    const viewport = page.getViewport({ scale: renderScale })
    canvas.width = viewport.width
    canvas.height = viewport.height
    const renderTask = page.render({ canvas, canvasContext: context, viewport })
    renderTask.promise.catch(() => undefined)
    return () => renderTask.cancel()
  }, [page, renderScale])

  const canvasSize = basePage
    ? { width: basePage.width * renderScale, height: basePage.height * renderScale }
    : { width: 0, height: 0 }

  const cameraStyle = useMemo(() => {
    if (!basePage) return undefined
    const [x1, y1, x2, y2] = bbox
    const focusCenterX = ((x1 + x2) / 2) * canvasSize.width
    const focusCenterY = ((y1 + y2) / 2) * canvasSize.height
    const targetX = stageSize.width * (hudSide === 'right' ? 0.36 : 0.64)
    const targetY = stageSize.height * 0.6
    return {
      transform: `translate3d(${targetX - focusCenterX}px, ${targetY - focusCenterY}px, 0)`,
    }
  }, [basePage, bbox, canvasSize.height, canvasSize.width, hudSide, stageSize.height, stageSize.width])

  if (error) return <div className="pdf-lab-cr-error">{error}</div>

  return (
    <div
      ref={viewportRef}
      className="pdf-lab-cr-pdf-viewport"
      data-qid="pdf-lab:clean-room:pdf-viewport"
    >
      {loading && <div className="pdf-lab-cr-loading">Loading PDF evidence…</div>}
      {basePage && (
        <div
          className="pdf-lab-cr-camera"
          data-qid="pdf-lab:clean-room:camera"
          style={cameraStyle}
        >
          <canvas
            ref={canvasRef}
            className="pdf-lab-cr-page-canvas"
            data-qid="pdf-lab:clean-room:canvas"
          />
          <RectangularMask bbox={bbox} />
        </div>
      )}
    </div>
  )
}

function RectangularMask({ bbox }: { bbox: [number, number, number, number] }) {
  const [x1, y1, x2, y2] = bbox
  return (
    <div
      className="pdf-lab-cr-mask-root"
      data-qid="pdf-lab:clean-room:mask"
      aria-hidden
    >
      <div
        className="pdf-lab-cr-mask-segment"
        data-qid="pdf-lab:clean-room:mask:top"
        style={{ left: 0, top: 0, width: '100%', height: `${clamp(y1, 0, 1) * 100}%` }}
      />
      <div
        className="pdf-lab-cr-mask-segment"
        data-qid="pdf-lab:clean-room:mask:bottom"
        style={{ left: 0, top: `${clamp(y2, 0, 1) * 100}%`, width: '100%', bottom: 0 }}
      />
      <div
        className="pdf-lab-cr-mask-segment"
        data-qid="pdf-lab:clean-room:mask:left"
        style={{
          left: 0,
          top: `${clamp(y1, 0, 1) * 100}%`,
          width: `${clamp(x1, 0, 1) * 100}%`,
          height: `${clamp(y2 - y1, 0, 1) * 100}%`,
        }}
      />
      <div
        className="pdf-lab-cr-mask-segment"
        data-qid="pdf-lab:clean-room:mask:right"
        style={{
          left: `${clamp(x2, 0, 1) * 100}%`,
          top: `${clamp(y1, 0, 1) * 100}%`,
          right: 0,
          height: `${clamp(y2 - y1, 0, 1) * 100}%`,
        }}
      />
      <div
        className="pdf-lab-cr-bbox"
        data-qid="pdf-lab:clean-room:bbox"
        style={{
          left: `${clamp(x1, 0, 1) * 100}%`,
          top: `${clamp(y1, 0, 1) * 100}%`,
          width: `${clamp(x2 - x1, 0, 1) * 100}%`,
          height: `${clamp(y2 - y1, 0, 1) * 100}%`,
        }}
      >
        <div className="pdf-lab-cr-thread-dot" />
      </div>
    </div>
  )
}

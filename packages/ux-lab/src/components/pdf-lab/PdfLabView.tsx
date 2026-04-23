import { useState, useEffect, useMemo, useCallback } from 'react'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, FileText, Eye, Pencil, Save, RotateCcw, Trash2, Focus, PanelRightOpen } from 'lucide-react'
import PdfCanvas from '../datalake-explorer/PdfCanvas'
import type { BboxBlock } from '../datalake-explorer/types'
import { BLOCK_TYPE_COLORS, BLOCK_TYPE_LABELS } from '../datalake-explorer/BboxWorkspace'
import BboxEditor from '../datalake-explorer/BboxEditor'
import { LeftPane, LeftPaneSection, paneItemStyle, useLeftPaneSearch } from '../common/LeftPane'
import { ContextMenu, type ContextMenuItem } from '../common/ContextMenu'
import { SharedRightPane } from '../common/SharedRightPane'
import { EMBRY } from '../common/EmbryStyle'

interface PdfLabViewProps {
  pdfUrl?: string
  extractionUrl?: string
}

interface ExtractionData {
  pdfUrl: string
  pageCount: number
  blocks: BboxBlock[]
  reviewMode?: 'raw' | 'reviewed'
  reviewSummary?: {
    reviewedPageCount: number
    totalPages: number
    totalFindings: number
    verdictCounts: {
      accept: number
      needs_human_review: number
    }
    pages: Array<{
      page: number
      pageNumber: number
      verdict: 'accept' | 'needs_human_review' | 'unreviewed'
      totalFindings: number
      missedRegions: number
    }>
  } | null
  humanEdits?: {
    updatedAt: string
    updatedBlocks: number
    deletedBlocks: number
    editCount: number
  } | null
}

interface PdfFile {
  id: string
  name: string
  pdfUrl: string
  extractionUrl: string
}

interface TableRegionReextractResult {
  ok: boolean
  flavor_used: string
  bbox_norm_tlbr: [number, number, number, number]
  rows: number
  cols: number
  accuracy: number
  whitespace: number
  text: string
  data: string[][]
  error?: string
}

// Available PDF files for testing
const PDF_FILES: PdfFile[] = [
  { id: 'nist-sp-800-53r5-429-463-final', name: 'NIST SP 800-53 Rev 5 Pages 429-463 (Final VLM Reviewed)', pdfUrl: '/nist-sp-800-53r5-429-463.pdf', extractionUrl: '/nist-sp-800-53r5-429-463-final-extraction.json' },
  { id: 'nist-sp-800-53r5-429-463-reviewed', name: 'NIST SP 800-53 Rev 5 Pages 429-463 (Reviewed v2)', pdfUrl: '/nist-sp-800-53r5-429-463.pdf', extractionUrl: '/nist-sp-800-53r5-429-463-reviewed-extraction.json' },
  { id: 'nist-sp-800-53r5-429-463-raw', name: 'NIST SP 800-53 Rev 5 Pages 429-463 (Raw v2)', pdfUrl: '/nist-sp-800-53r5-429-463.pdf', extractionUrl: '/nist-sp-800-53r5-429-463-raw-extraction.json' },
  { id: 'nist-like-full-page-reviewed', name: 'NIST-like Full Page (Reviewed v2)', pdfUrl: '/nist_like_full_page.pdf', extractionUrl: '/nist-like-full-page-reviewed-extraction.json' },
  { id: 'nist-like-full-page-raw', name: 'NIST-like Full Page (Raw v2)', pdfUrl: '/nist_like_full_page.pdf', extractionUrl: '/nist-like-full-page-raw-extraction.json' },
  { id: 'nist-v6-loop', name: 'NIST v6 Loop Output (49 pages)', pdfUrl: '/NIST_SP_800-53r5.pdf', extractionUrl: '/nist-v6-loop-extraction.json' },
  { id: 'nist-800-53', name: 'NIST SP 800-53 Rev 5 (Real)', pdfUrl: '/NIST_SP_800-53r5.pdf', extractionUrl: '/nist-800-53-extraction.json' },
  { id: 'nist-real', name: 'NIST Clone (Real Sections)', pdfUrl: '/nist_clone_real.pdf', extractionUrl: '/nist-real-extraction.json' },
  { id: 'nist-full', name: 'NIST Clone (Full)', pdfUrl: '/nist_clone_full.pdf', extractionUrl: '/nist-clone-extraction.json' },
  { id: 'test-clone', name: 'Test Clone', pdfUrl: '/test-clone.pdf', extractionUrl: '/test-clone-extraction.json' },
]

const EDITABLE_BLOCK_TYPES: Array<BboxBlock['blockType']> = [
  'table',
  'header',
  'figure',
  'text',
  'equation',
  'list_item',
  'caption',
  'page_number',
  'boilerplate',
]

function PdfLeftPane({
  files,
  selectedId,
  onSelectFile,
}: {
  files: PdfFile[]
  selectedId: string | null
  onSelectFile: (file: PdfFile) => void
}) {
  const search = useLeftPaneSearch().toLowerCase()
  const filteredFiles = files.filter(f => !search || f.name.toLowerCase().includes(search))

  return (
    <LeftPane title="PDF Lab" searchable searchTestId="pdf-lab:search">
      <LeftPaneSection title={`PDFs (${filteredFiles.length})`}>
        {filteredFiles.map(file => (
          <div
            key={file.id}
            data-qid={`pdf-lab:file:${file.id}`}
            title={file.pdfUrl}
            style={{
              ...paneItemStyle(file.id === selectedId),
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
            onClick={() => onSelectFile(file)}
          >
            <FileText size={14} color={file.id === selectedId ? EMBRY.accent : EMBRY.dim} />
            <span style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
            }}>
              {file.name}
            </span>
          </div>
        ))}
      </LeftPaneSection>
    </LeftPane>
  )
}

export function PdfLabView({ pdfUrl: propPdfUrl, extractionUrl: propExtractionUrl }: PdfLabViewProps) {
  const resolveSelectedFile = useCallback((pdfUrl: string | null | undefined, extractionUrl: string | null | undefined): PdfFile => (
    PDF_FILES.find(
      f => f.pdfUrl === pdfUrl && (!extractionUrl || f.extractionUrl === extractionUrl)
    ) ||
    PDF_FILES.find(f => f.pdfUrl === pdfUrl) ||
    PDF_FILES[0]
  ), [])

  const [selectedFile, setSelectedFile] = useState<PdfFile>(() => {
    const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
    return resolveSelectedFile(propPdfUrl || params.get('pdf'), propExtractionUrl || params.get('extraction'))
  })
  const [extraction, setExtraction] = useState<ExtractionData | null>(null)
  const [baselineExtraction, setBaselineExtraction] = useState<ExtractionData | null>(null)
  const [rawCompareExtraction, setRawCompareExtraction] = useState<ExtractionData | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(0.5)
  const [viewMode, setViewMode] = useState<'fit-page' | 'manual'>('fit-page')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [showRawCompare, setShowRawCompare] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reextractingArea, setReextractingArea] = useState(false)
  const [dirtyBlockIds, setDirtyBlockIds] = useState<Set<string>>(new Set())
  const [deletedBlockIds, setDeletedBlockIds] = useState<Set<string>>(new Set())
  const [newBlockType, setNewBlockType] = useState<BboxBlock['blockType']>('text')
  const [selectionMode, setSelectionMode] = useState<'draw-block' | 'select-area'>('draw-block')
  const [selectedAreaBBox, setSelectedAreaBBox] = useState<[number, number, number, number] | null>(null)
  const [selectedAreaBlockIds, setSelectedAreaBlockIds] = useState<Set<string>>(new Set())
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set(['table', 'header', 'figure', 'text', 'caption', 'page_number', 'boilerplate']))
  const [contextMenu, setContextMenu] = useState<{ blockId: string; x: number; y: number } | null>(null)
  const [showAuditPane, setShowAuditPane] = useState(true)
  const [auditTab, setAuditTab] = useState<'selected' | 'queue' | 'filters'>('queue')

  useEffect(() => {
    const syncSelectedFile = () => {
      const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
      const nextFile = resolveSelectedFile(propPdfUrl || params.get('pdf'), propExtractionUrl || params.get('extraction'))
      setSelectedFile(prev => prev.id === nextFile.id ? prev : nextFile)
    }

    syncSelectedFile()
    window.addEventListener('hashchange', syncSelectedFile)
    return () => window.removeEventListener('hashchange', syncSelectedFile)
  }, [propExtractionUrl, propPdfUrl, resolveSelectedFile])

  const pdfUrl = selectedFile.pdfUrl
  const extractionUrl = selectedFile.extractionUrl

  // Load extraction data when file changes
  useEffect(() => {
    setLoading(true)
    setError(null)
    setSaveError(null)
    setSaveNotice(null)
    setRawCompareExtraction(null)
    setCurrentPage(0)
    setSelectedBlockId(null)
    setEditMode(false)
    setShowRawCompare(false)
    setViewMode('fit-page')
    setSelectionMode('draw-block')
    setSelectedAreaBBox(null)
    setSelectedAreaBlockIds(new Set())
    setDirtyBlockIds(new Set())
    setDeletedBlockIds(new Set())
    setContextMenu(null)
    setReextractingArea(false)
    setShowAuditPane(true)
    setAuditTab('queue')

    fetch(extractionUrl)
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load: ${r.status}`)
        return r.json()
      })
      .then((data: ExtractionData) => {
        setExtraction(data)
        setBaselineExtraction(cloneExtractionData(data))
        setEditMode(data.reviewMode === 'reviewed' && !extractionUrl.includes('-raw-extraction.json'))
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [extractionUrl])

  useEffect(() => {
    const compareFile = findRawCompareFile(selectedFile)
    if (!compareFile) {
      setRawCompareExtraction(null)
      return
    }

    let cancelled = false
    fetch(compareFile.extractionUrl)
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load raw compare: ${r.status}`)
        return r.json()
      })
      .then((data: ExtractionData) => {
        if (!cancelled) setRawCompareExtraction(data)
      })
      .catch(() => {
        if (!cancelled) setRawCompareExtraction(null)
      })

    return () => { cancelled = true }
  }, [selectedFile])

  // Filter blocks for current page and selected types
  const visibleBlocks = extraction?.blocks.filter(
    b => b.page === currentPage && typeFilters.has(b.blockType)
  ) || []
  const rawCompareBlocks = useMemo(() => {
    if (!showRawCompare || !rawCompareExtraction || !extraction) return []
    return rawCompareExtraction.blocks.filter(block => {
      if (block.page !== currentPage || !typeFilters.has(block.blockType)) return false
      const reviewedBlock = extraction.blocks.find(candidate => candidate.id === block.id)
      if (!reviewedBlock) return true
      return reviewedBlock.blockType !== block.blockType || !sameBBox(reviewedBlock.bbox, block.bbox)
    })
  }, [showRawCompare, rawCompareExtraction, extraction, currentPage, typeFilters])

  const selectedBlock = extraction?.blocks.find(b => b.id === selectedBlockId)
  const contextMenuBlock = contextMenu ? extraction?.blocks.find(block => block.id === contextMenu.blockId) ?? null : null
  const currentPageReview = extraction?.reviewSummary?.pages.find(page => page.page === currentPage)
  const isReviewedView = extraction?.reviewMode === 'reviewed'
  const canEditExtraction = isReviewedView && !selectedFile.extractionUrl.includes('-raw-extraction.json')
  const dirtyCount = dirtyBlockIds.size + deletedBlockIds.size
  const displayTitle = splitDisplayName(selectedFile.name)
  const pdfLabel = formatPdfLabel(pdfUrl)
  const reviewedBlocks = useMemo(() => extraction?.blocks.filter(hasReviewChange) ?? [], [extraction])
  const changedBlocksOnCurrentPage = useMemo(
    () => reviewedBlocks.filter(block => block.page === currentPage),
    [reviewedBlocks, currentPage]
  )
  const flaggedPages = useMemo(
    () => extraction?.reviewSummary?.pages.filter(page => page.verdict === 'needs_human_review') ?? [],
    [extraction]
  )
  const changedPages = useMemo(() => {
    const counts = new Map<number, number>()
    for (const block of reviewedBlocks) counts.set(block.page, (counts.get(block.page) ?? 0) + 1)
    return [...counts.entries()]
      .map(([page, count]) => ({ page, count }))
      .sort((a, b) => a.page - b.page)
  }, [reviewedBlocks])
  const nextFlaggedPage = flaggedPages.find(page => page.page > currentPage) ?? flaggedPages[0] ?? null

  const dirtyBlocks = useMemo(() => {
    if (!extraction) return []
    return extraction.blocks.filter(block => dirtyBlockIds.has(block.id))
  }, [dirtyBlockIds, extraction])

  const toggleTypeFilter = (type: string) => {
    setTypeFilters(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  useEffect(() => {
    if (selectedBlockId && extraction && !extraction.blocks.some(block => block.id === selectedBlockId)) {
      setSelectedBlockId(null)
    }
  }, [selectedBlockId, extraction])

  useEffect(() => {
    if (contextMenu && extraction && !extraction.blocks.some(block => block.id === contextMenu.blockId)) {
      setContextMenu(null)
    }
  }, [contextMenu, extraction])

  const markBlockDirty = (blockId: string) => {
    setDirtyBlockIds(prev => {
      const next = new Set(prev)
      next.add(blockId)
      return next
    })
  }

  const clearAreaSelection = useCallback(() => {
    setSelectedAreaBBox(null)
    setSelectedAreaBlockIds(new Set())
  }, [])

  const applyHumanEditMetadata = (block: BboxBlock, note: string): BboxBlock => {
    const reviewNotes = new Set(block.reviewNotes || [])
    reviewNotes.add(note)
    return {
      ...block,
      humanEdited: true,
      humanEditedAt: new Date().toISOString(),
      reviewNotes: [...reviewNotes],
    }
  }

  const updateBlock = useCallback((blockId: string, updater: (block: BboxBlock) => BboxBlock) => {
    setExtraction(prev => {
      if (!prev) return prev
      return {
        ...prev,
        blocks: prev.blocks.map(block => block.id === blockId ? updater(block) : block),
      }
    })
    markBlockDirty(blockId)
    setDeletedBlockIds(prev => {
      const next = new Set(prev)
      next.delete(blockId)
      return next
    })
    setSaveError(null)
    setSaveNotice(null)
  }, [])

  const handleBlockBBoxChange = useCallback((blockId: string, bbox: [number, number, number, number]) => {
    updateBlock(blockId, (block) => {
      if (sameBBox(block.bbox, bbox)) return block
      return applyHumanEditMetadata({ ...block, bbox }, 'Human adjusted bbox in pdf-lab')
    })
  }, [updateBlock])

  const reclassifyBlock = useCallback((blockId: string, newType: BboxBlock['blockType']) => {
    updateBlock(blockId, (block) => {
      if (block.blockType === newType) return block
      return applyHumanEditMetadata({
        ...block,
        blockType: newType,
      }, 'Human reclassified block in pdf-lab')
    })
  }, [updateBlock])

  const handleReclassify = (newType: BboxBlock['blockType']) => {
    if (!selectedBlockId) return
    reclassifyBlock(selectedBlockId, newType)
  }

  const deleteBlock = (blockId: string) => {
    setExtraction(prev => {
      if (!prev) return prev
      return {
        ...prev,
        blocks: prev.blocks.filter(block => block.id !== blockId),
      }
    })
    setDeletedBlockIds(prev => {
      const next = new Set(prev)
      next.add(blockId)
      return next
    })
    setDirtyBlockIds(prev => {
      const next = new Set(prev)
      next.delete(blockId)
      return next
    })
    setSelectedBlockId(prev => prev === blockId ? null : prev)
    setContextMenu(prev => prev?.blockId === blockId ? null : prev)
    setSaveError(null)
    setSaveNotice(null)
  }

  const deleteBlocks = useCallback((blockIds: string[]) => {
    if (blockIds.length === 0) return
    setExtraction(prev => {
      if (!prev) return prev
      const idSet = new Set(blockIds)
      return {
        ...prev,
        blocks: prev.blocks.filter(block => !idSet.has(block.id)),
      }
    })
    setDeletedBlockIds(prev => {
      const next = new Set(prev)
      blockIds.forEach((blockId) => next.add(blockId))
      return next
    })
    setDirtyBlockIds(prev => {
      const next = new Set(prev)
      blockIds.forEach((blockId) => next.delete(blockId))
      return next
    })
    setSelectedBlockId(prev => (prev && blockIds.includes(prev) ? null : prev))
    setContextMenu(prev => (prev && blockIds.includes(prev.blockId) ? null : prev))
    setSaveError(null)
    setSaveNotice(null)
  }, [])

  const handleDeleteSelected = useCallback(() => {
    if (!selectedBlockId) return
    deleteBlock(selectedBlockId)
  }, [selectedBlockId])

  const nudgeSelectedBlock = useCallback((dx: number, dy: number) => {
    if (!selectedBlockId || !selectedBlock) return
    const [x1, y1, x2, y2] = selectedBlock.bbox
    const width = x2 - x1
    const height = y2 - y1
    const nextX1 = clampNormalized(x1 + dx, 0, 1 - width)
    const nextY1 = clampNormalized(y1 + dy, 0, 1 - height)
    const nextBBox: [number, number, number, number] = [
      nextX1,
      nextY1,
      nextX1 + width,
      nextY1 + height,
    ]
    handleBlockBBoxChange(selectedBlockId, nextBBox)
  }, [handleBlockBBoxChange, selectedBlockId, selectedBlock])

  const createBlockFromBBox = useCallback((
    bbox: [number, number, number, number],
    blockType: BboxBlock['blockType'],
    note: string,
    overrides: Partial<BboxBlock> = {},
  ) => {
    const blockId = `human:p${currentPage}:${Date.now()}`
    const createdAt = new Date().toISOString()
    const newBlock: BboxBlock = {
      id: blockId,
      page: currentPage,
      bbox,
      blockType,
      semanticType: toSemanticType(blockType),
      text: '',
      confidence: 1,
      humanEdited: true,
      humanEditedAt: createdAt,
      reviewNotes: [note],
      cascadeTrail: [{
        tier: 'T2',
        tierName: 'Human',
        disposition: 'accept',
        confidence: 1,
      }],
      ...overrides,
      reviewNotes: dedupeNotes([note, ...(overrides.reviewNotes || [])]),
    }
    setExtraction(prev => {
      if (!prev) return prev
      return {
        ...prev,
        blocks: [...prev.blocks, newBlock],
      }
    })
    setTypeFilters(prev => {
      const next = new Set(prev)
      next.add(newBlock.blockType)
      return next
    })
    markBlockDirty(blockId)
    setSelectedBlockId(blockId)
    setSaveError(null)
    setSaveNotice(null)
    clearAreaSelection()
  }, [clearAreaSelection, currentPage])

  const handleCreateBlock = useCallback((bbox: [number, number, number, number]) => {
    createBlockFromBBox(bbox, newBlockType, 'Human created block in pdf-lab')
  }, [createBlockFromBBox, newBlockType])

  const handleAreaSelect = useCallback((bbox: [number, number, number, number], blockIds: string[]) => {
    setSelectedAreaBBox(bbox)
    setSelectedAreaBlockIds(new Set(blockIds))
    setSelectedBlockId(null)
    setContextMenu(null)
  }, [])

  const handleDeleteSelectedArea = useCallback(() => {
    const blockIds = [...selectedAreaBlockIds]
    if (blockIds.length === 0) return
    deleteBlocks(blockIds)
    clearAreaSelection()
    setSaveNotice(`Deleted ${blockIds.length} blocks from selected area`)
  }, [clearAreaSelection, deleteBlocks, selectedAreaBlockIds])

  const handleReplaceAreaWithTable = useCallback(() => {
    if (!selectedAreaBBox) return
    const blockIds = [...selectedAreaBlockIds]
    if (blockIds.length > 0) deleteBlocks(blockIds)
    createBlockFromBBox(selectedAreaBBox, 'table', 'Human promoted selected area to table in pdf-lab')
    setSelectionMode('draw-block')
    setSaveNotice(blockIds.length > 0
      ? `Replaced ${blockIds.length} blocks with a table region`
      : 'Created table region from selected area')
  }, [createBlockFromBBox, deleteBlocks, selectedAreaBBox, selectedAreaBlockIds])

  const handleReextractSelectedArea = useCallback(async () => {
    if (!selectedAreaBBox) return
    setReextractingArea(true)
    setSaveError(null)
    setSaveNotice(null)
    try {
      const response = await fetch('/api/pdf-lab/reextract-table-region', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfUrl,
          pageNumber: currentPage,
          bbox: selectedAreaBBox,
          flavor: 'stream',
        }),
      })
      const payload = await response.json() as TableRegionReextractResult
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error || `Region table extraction failed (${response.status})`)
      }

      const blockIds = [...selectedAreaBlockIds]
      if (blockIds.length > 0) deleteBlocks(blockIds)
      createBlockFromBBox(
        payload.bbox_norm_tlbr,
        'table',
        `Human triggered region table re-extract (${payload.flavor_used}) in pdf-lab`,
        {
          text: payload.text,
          confidence: 1,
          semanticType: payload.rows > 0 && payload.cols > 0
            ? `Table ${payload.rows}x${payload.cols}`
            : 'Table',
          reviewNotes: [
            `Region table re-extract succeeded via ${payload.flavor_used}`,
            `rows=${payload.rows} cols=${payload.cols} accuracy=${Number(payload.accuracy || 0).toFixed(3)}`,
          ],
        },
      )
      setSelectionMode('draw-block')
      setSaveNotice(
        blockIds.length > 0
          ? `Re-extracted table from selected area and replaced ${blockIds.length} blocks`
          : `Re-extracted table from selected area (${payload.rows}×${payload.cols})`,
      )
    } catch (reextractErr) {
      setSaveError(reextractErr instanceof Error ? reextractErr.message : String(reextractErr))
    } finally {
      setReextractingArea(false)
    }
  }, [createBlockFromBBox, currentPage, deleteBlocks, pdfUrl, selectedAreaBBox, selectedAreaBlockIds])

  const handleRevert = () => {
    if (!baselineExtraction) return
    setExtraction(cloneExtractionData(baselineExtraction))
    setDirtyBlockIds(new Set())
    setDeletedBlockIds(new Set())
    clearAreaSelection()
    setSelectedBlockId(null)
    setContextMenu(null)
    setSaveError(null)
    setSaveNotice(null)
  }

  const handleSave = async () => {
    if (!extraction || !canEditExtraction || dirtyCount === 0) return
    setSaving(true)
    setSaveError(null)
    setSaveNotice(null)
    try {
      const response = await fetch('/api/pdf-lab/review-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfUrl,
          extractionUrl,
          updatedBlocks: dirtyBlocks,
          deletedBlockIds: [...deletedBlockIds],
          reviewMode: extraction.reviewMode ?? 'reviewed',
          reviewSummary: extraction.reviewSummary ?? null,
          fileId: selectedFile.id,
          fileName: selectedFile.name,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || payload.detail || `Save failed (${response.status})`)
      setExtraction(payload.extraction)
      setBaselineExtraction(cloneExtractionData(payload.extraction))
      setDirtyBlockIds(new Set())
      setDeletedBlockIds(new Set())
      clearAreaSelection()
      setContextMenu(null)
      setSaveNotice(`Saved ${payload.updatedBlocks} block edits and ${payload.deletedBlocks} deletions`)
      setEditMode(false)
    } catch (saveErr) {
      setSaveError(saveErr instanceof Error ? saveErr.message : String(saveErr))
    } finally {
      setSaving(false)
    }
  }

  // Keyboard navigation
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (editMode && canEditExtraction && !selectedBlockId && selectedAreaBlockIds.size > 0 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault()
          handleDeleteSelectedArea()
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          clearAreaSelection()
          return
        }
      }

      if (editMode && canEditExtraction && selectedBlockId && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const step = e.shiftKey ? 0.005 : 0.001
        if (e.key === 'ArrowRight') {
          e.preventDefault()
          nudgeSelectedBlock(step, 0)
          return
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault()
          nudgeSelectedBlock(-step, 0)
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          nudgeSelectedBlock(0, -step)
          return
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          nudgeSelectedBlock(0, step)
          return
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault()
          handleDeleteSelected()
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setSelectedBlockId(null)
          setContextMenu(null)
          return
        }
      }

      if (e.key === 'ArrowRight' && extraction && currentPage < extraction.pageCount - 1) {
        setCurrentPage(p => p + 1)
      }
      if (e.key === 'ArrowLeft' && currentPage > 0) {
        setCurrentPage(p => p - 1)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [canEditExtraction, clearAreaSelection, currentPage, editMode, extraction, handleDeleteSelected, handleDeleteSelectedArea, nudgeSelectedBlock, selectedAreaBlockIds.size, selectedBlockId])

  const handleSelectFile = (file: PdfFile) => {
    setSelectedFile(file)
    // Update URL without reload
    const newHash = `#pdf-lab?pdf=${encodeURIComponent(file.pdfUrl)}&extraction=${encodeURIComponent(file.extractionUrl)}`
    window.history.replaceState(null, '', newHash)
  }

  const jumpToPage = useCallback((page: number) => {
    setCurrentPage(page)
    setSelectedBlockId(null)
    setContextMenu(null)
    clearAreaSelection()
    setShowAuditPane(true)
    setAuditTab('queue')
  }, [clearAreaSelection])

  const jumpToBlock = useCallback((block: BboxBlock) => {
    setCurrentPage(block.page)
    setSelectedBlockId(block.id)
    setContextMenu(null)
    clearAreaSelection()
    setShowAuditPane(true)
    setAuditTab('selected')
    setTypeFilters(prev => {
      const next = new Set(prev)
      next.add(block.blockType)
      return next
    })
  }, [clearAreaSelection])

  const blockContextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!contextMenuBlock) return []
    const items: ContextMenuItem[] = [
      {
        label: 'Select block',
        icon: <Focus size={12} />,
        shortcut: 'Enter',
        onClick: () => {
          setSelectedBlockId(contextMenuBlock.id)
          setShowAuditPane(true)
          setAuditTab('selected')
        },
        'data-qid': 'pdf-lab:context:select',
        'data-qs-action': 'PDF_LAB_CONTEXT_SELECT',
      },
    ]

    if (canEditExtraction) {
      items.push(
        { separator: true, onClick: () => {} },
        {
          label: 'Delete block',
          icon: <Trash2 size={12} />,
          shortcut: 'Del',
          danger: true,
          onClick: () => deleteBlock(contextMenuBlock.id),
          'data-qid': 'pdf-lab:context:delete',
          'data-qs-action': 'PDF_LAB_CONTEXT_DELETE',
        },
        { separator: true, onClick: () => {} },
        { label: 'Reclassify', header: true, onClick: () => {} },
        ...EDITABLE_BLOCK_TYPES.map((type) => ({
          label: `Set as ${BLOCK_TYPE_LABELS[type]}`,
          disabled: contextMenuBlock.blockType === type,
          onClick: () => reclassifyBlock(contextMenuBlock.id, type),
          'data-qid': `pdf-lab:context:type:${type}`,
          'data-qs-action': `PDF_LAB_CONTEXT_TYPE_${type.toUpperCase()}`,
        }))
      )
    }

    return items
  }, [contextMenuBlock, canEditExtraction, reclassifyBlock])

  const selectedAreaToolbar = selectedAreaBBox && canEditExtraction ? (
    <div style={contextualHudStyle}>
      <button
        data-qid="pdf-lab:context:extract-area-table"
        title="Run pdf_oxide table extraction inside the selected area"
        onClick={handleReextractSelectedArea}
        disabled={!selectedAreaBBox || reextractingArea}
        style={{ ...contextualBtnStyle, opacity: selectedAreaBBox && !reextractingArea ? 1 : 0.45, color: EMBRY.green }}
      >
        <FileText size={13} />
        {reextractingArea ? 'Extracting…' : 'Extract Table'}
      </button>
      <button
        data-qid="pdf-lab:context:area-to-table"
        title="Replace the selected area with a table block"
        onClick={handleReplaceAreaWithTable}
        disabled={!selectedAreaBBox}
        style={{ ...contextualBtnStyle, opacity: selectedAreaBBox ? 1 : 0.45 }}
      >
        <Focus size={13} />
        Area → Table
      </button>
      <button
        data-qid="pdf-lab:context:delete-area"
        title="Delete all blocks in the selected area"
        onClick={handleDeleteSelectedArea}
        disabled={selectedAreaBlockIds.size === 0}
        style={{ ...contextualBtnStyle, opacity: selectedAreaBlockIds.size > 0 ? 1 : 0.45, color: EMBRY.amber }}
      >
        <Trash2 size={13} />
        Delete
      </button>
    </div>
  ) : null

  return (
    <div style={containerStyle}>
      <PdfLeftPane
        files={PDF_FILES}
        selectedId={selectedFile.id}
        onSelectFile={handleSelectFile}
      />

      {/* Main Content */}
      <div style={mainContentStyle}>
        {/* Header */}
        <div data-qid="pdf-lab:header" style={headerStyle}>
          <div style={headerPrimaryRowStyle}>
            <div style={headerIdentityStyle}>
              <div style={headerTitleRowStyle}>
                <Eye size={18} color={EMBRY.accent} />
                <div style={headerTitleTextStyle}>{displayTitle.title}</div>
                {displayTitle.qualifier && (
                  <span style={subtleMetaBadgeStyle}>{displayTitle.qualifier}</span>
                )}
                <span style={headerMetaRowStyle} title={pdfUrl}>{pdfLabel}</span>
                <span style={{
                  ...statusBadgeStyle,
                  color: isReviewedView ? EMBRY.green : EMBRY.dim,
                  borderColor: isReviewedView ? EMBRY.green : EMBRY.border,
                }}>
                  {isReviewedView ? 'FINAL · VLM reviewed' : 'RAW · baseline'}
                </span>
                {extraction?.reviewSummary && (
                  <>
                    <span style={{ ...metricBadgeStyle, color: EMBRY.green, borderColor: `${EMBRY.green}55` }}>
                      <strong style={metricValueStyle}>{extraction.reviewSummary.verdictCounts.accept}</strong>
                      accept
                    </span>
                    <span style={{ ...metricBadgeStyle, color: EMBRY.amber, borderColor: `${EMBRY.amber}55` }}>
                      <strong style={metricValueStyle}>{extraction.reviewSummary.verdictCounts.needs_human_review}</strong>
                      flagged
                    </span>
                    <span style={metricBadgeStyle}>
                      <strong style={metricValueStyle}>{extraction.reviewSummary.totalFindings}</strong>
                      findings
                    </span>
                  </>
                )}
              </div>
            </div>

            <div style={toolbarShellStyle}>
              <div style={toolbarGroupStyle}>
                <button
                  data-qid="pdf-lab:toolbar:toggle-edit"
                  title={canEditExtraction ? 'Toggle bbox edit mode' : 'Raw extraction is read-only'}
                  onClick={() => setEditMode(mode => !mode)}
                  disabled={!canEditExtraction}
                  style={{
                    ...actionBtnStyle,
                    opacity: canEditExtraction ? 1 : 0.45,
                    backgroundColor: editMode ? 'rgba(35, 199, 217, 0.14)' : 'transparent',
                    borderColor: editMode ? `${EMBRY.accent}66` : EMBRY.border,
                    color: editMode ? EMBRY.accent : EMBRY.white,
                  }}
                >
                  <Pencil size={14} />
                  {editMode ? 'Editing On' : 'Enable Edit'}
                </button>
              </div>

              <div style={toolbarGroupStyle}>
                {dirtyCount > 0 && (
                  <button
                    data-qid="pdf-lab:toolbar:revert"
                    title="Discard reviewed changes on this extraction"
                    onClick={handleRevert}
                    disabled={!canEditExtraction}
                    style={{ ...actionBtnStyle, opacity: canEditExtraction ? 1 : 0.45 }}
                  >
                    <RotateCcw size={14} />
                    Revert
                  </button>
                )}
                <button
                  data-qid="pdf-lab:toolbar:save"
                  title="Persist reviewed changes to disk and memory"
                  onClick={handleSave}
                  disabled={dirtyCount === 0 || saving || !canEditExtraction}
                  style={{ ...actionBtnStyle, opacity: dirtyCount > 0 && canEditExtraction ? 1 : 0.45 }}
                >
                  <Save size={14} />
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Content Area */}
        {loading ? (
          <div style={centerStyle}>
            <span style={{ color: EMBRY.dim }}>Loading extraction data...</span>
          </div>
        ) : error ? (
          <div style={centerStyle}>
            <span style={{ color: EMBRY.red }}>Error: {error}</span>
          </div>
        ) : (
          <div style={contentAreaStyle}>
            {/* PDF Canvas */}
            <div style={canvasContainerStyle}>
              {canEditExtraction && (
                <div data-qid="pdf-lab:tool-dock" style={toolDockStyle}>
                  <button
                    data-qid="pdf-lab:toolbar:compare-raw"
                    onClick={() => setShowRawCompare(value => !value)}
                    disabled={!rawCompareExtraction}
                    style={{ ...dockBtnStyle, opacity: rawCompareExtraction ? 1 : 0.45 }}
                    title={rawCompareExtraction ? 'Overlay changed raw blocks for comparison' : 'No raw comparison extraction available'}
                  >
                    <Eye size={14} />
                    {showRawCompare ? 'Hide Raw' : 'Compare Raw'}
                  </button>
                  <button
                    data-qid="pdf-lab:toolbar:select-area"
                    data-qs-action="PDF_LAB_SELECT_AREA"
                    title={selectionMode === 'select-area' ? 'Switch back to draw-block mode' : 'Drag to select an area of existing boxes'}
                    onClick={() => {
                      setSelectionMode(mode => mode === 'select-area' ? 'draw-block' : 'select-area')
                      setSelectedBlockId(null)
                      setContextMenu(null)
                    }}
                    style={{
                      ...dockBtnStyle,
                      color: selectionMode === 'select-area' ? EMBRY.amber : EMBRY.white,
                      borderColor: selectionMode === 'select-area' ? `${EMBRY.amber}66` : EMBRY.border,
                      backgroundColor: selectionMode === 'select-area' ? `${EMBRY.amber}12` : 'rgba(8, 11, 16, 0.88)',
                    }}
                  >
                    <Trash2 size={14} />
                    {selectionMode === 'select-area' ? 'Area Select' : 'Select Area'}
                  </button>
                  {editMode && (
                    <select
                      data-qid="pdf-lab:toolbar:new-block-type"
                      value={newBlockType}
                      onChange={(event) => setNewBlockType(event.target.value as BboxBlock['blockType'])}
                      style={dockSelectStyle}
                      title="Default type for new blocks drawn on the page"
                    >
                      {EDITABLE_BLOCK_TYPES.map(type => (
                        <option key={type} value={type}>{BLOCK_TYPE_LABELS[type]}</option>
                      ))}
                    </select>
                  )}
                </div>
              )}
              <PdfCanvas
                pdfUrl={pdfUrl}
                pageNumber={currentPage}
                bboxOverlays={visibleBlocks}
                compareOverlays={rawCompareBlocks}
                selectedBlockId={selectedBlockId}
                onBlockClick={(blockId) => {
                  setSelectedBlockId(blockId)
                  setShowAuditPane(true)
                  setAuditTab('selected')
                  setContextMenu(null)
                }}
                onBlockContextMenu={(blockId, x, y) => {
                  setSelectedBlockId(blockId)
                  setShowAuditPane(true)
                  setAuditTab('selected')
                  setContextMenu({ blockId, x, y })
                }}
                zoom={zoom}
                fitMode={viewMode === 'fit-page' ? 'page' : 'manual'}
                editMode={editMode && canEditExtraction}
                interactionMode={selectionMode}
                selectedAreaBBox={selectedAreaBBox}
                selectedAreaBlockIds={[...selectedAreaBlockIds]}
                onBlockBBoxChange={editMode && canEditExtraction ? handleBlockBBoxChange : undefined}
                onCanvasClick={() => {
                  setSelectedBlockId(null)
                  setContextMenu(null)
                  clearAreaSelection()
                }}
                onCreateBlock={editMode && canEditExtraction ? handleCreateBlock : undefined}
                onSelectArea={editMode && canEditExtraction ? handleAreaSelect : undefined}
                selectedAreaToolbar={editMode && canEditExtraction ? selectedAreaToolbar : null}
              />
              <div data-qid="pdf-lab:viewport-hud" style={viewportHudStyle}>
                <button
                  data-qid="pdf-lab:toolbar:page-prev"
                  onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                  disabled={currentPage === 0}
                  style={{ ...viewportBtnStyle, opacity: currentPage === 0 ? 0.3 : 1 }}
                  title="Previous page"
                >
                  <ChevronLeft size={15} />
                </button>
                <span
                  data-qid="pdf-lab:status:page-indicator"
                  title="Current page indicator"
                  style={{ fontSize: 11, color: EMBRY.white, minWidth: 92, textAlign: 'center' }}
                >
                  Page {currentPage + 1} of {extraction?.pageCount || '?'}
                </span>
                <button
                  data-qid="pdf-lab:toolbar:page-next"
                  onClick={() => setCurrentPage(p => Math.min((extraction?.pageCount || 1) - 1, p + 1))}
                  disabled={currentPage >= (extraction?.pageCount || 1) - 1}
                  style={{ ...viewportBtnStyle, opacity: currentPage >= (extraction?.pageCount || 1) - 1 ? 0.3 : 1 }}
                  title="Next page"
                >
                  <ChevronRight size={15} />
                </button>
                <div style={viewportDividerStyle} />
                <button
                  data-qid="pdf-lab:toolbar:zoom-out"
                  title="Zoom out"
                  onClick={() => {
                    setViewMode('manual')
                    setZoom(z => Math.max(0.25, z - 0.1))
                  }}
                  style={viewportBtnStyle}
                >
                  <ZoomOut size={15} />
                </button>
                <span style={{ fontSize: 11, minWidth: 42, textAlign: 'center', color: EMBRY.dim }}>
                  {viewMode === 'fit-page' ? 'FIT' : `${Math.round(zoom * 100)}%`}
                </span>
                <button
                  data-qid="pdf-lab:toolbar:zoom-in"
                  title="Zoom in"
                  onClick={() => {
                    setViewMode('manual')
                    setZoom(z => Math.min(2, z + 0.1))
                  }}
                  style={viewportBtnStyle}
                >
                  <ZoomIn size={15} />
                </button>
                <button
                  data-qid="pdf-lab:toolbar:fit-page"
                  data-qs-action="PDF_LAB_FIT_PAGE"
                  title={viewMode === 'fit-page' ? 'Switch to manual zoom controls' : 'Fit the full page in view'}
                  onClick={() => setViewMode(mode => mode === 'fit-page' ? 'manual' : 'fit-page')}
                  style={{
                    ...viewportBtnStyle,
                    color: viewMode === 'fit-page' ? EMBRY.accent : EMBRY.white,
                    borderColor: viewMode === 'fit-page' ? `${EMBRY.accent}55` : 'transparent',
                  }}
                >
                  <Focus size={15} />
                  Fit
                </button>
              </div>
              {(isReviewedView || saveNotice || saveError || (dirtyCount > 0 && canEditExtraction) || reextractingArea) && (
                <div style={floatingStatusStyle}>
                  {isReviewedView && (
                    <span
                      data-qid="pdf-lab:status:mode"
                      style={{
                        ...statusBadgeStyle,
                        color: editMode ? EMBRY.accent : EMBRY.dim,
                        borderColor: editMode ? `${EMBRY.accent}66` : EMBRY.border,
                      }}
                    >
                      {editMode ? 'editing enabled' : 'inspect mode'}
                    </span>
                  )}
                  {dirtyCount > 0 && canEditExtraction && (
                    <span style={{ ...statusBadgeStyle, color: EMBRY.amber, borderColor: `${EMBRY.amber}66` }}>
                      {dirtyCount} unsaved
                    </span>
                  )}
                  {reextractingArea && (
                    <span
                      data-qid="pdf-lab:status:reextracting"
                      style={{ ...statusBadgeStyle, color: EMBRY.green, borderColor: EMBRY.green }}
                    >
                      extracting table…
                    </span>
                  )}
                  {isReviewedView && !editMode && !showAuditPane && !saveNotice && !saveError && (
                    <span style={{ fontSize: 11, color: EMBRY.dim }}>
                      Click a block to inspect. Enable Edit to move, resize, delete, or draw.
                    </span>
                  )}
                  {saveNotice && <span data-qid="pdf-lab:status:notice" style={{ fontSize: 11, color: EMBRY.green }}>{saveNotice}</span>}
                  {saveError && <span data-qid="pdf-lab:status:error" style={{ fontSize: 11, color: EMBRY.red }}>{saveError}</span>}
                </div>
              )}
            </div>

            {showAuditPane && (
              <SharedRightPane
                title="Inspector"
                subtitle={selectedBlock
                  ? `${BLOCK_TYPE_LABELS[selectedBlock.blockType] || selectedBlock.blockType} · page ${selectedBlock.page + 1}`
                  : currentPageReview
                    ? `Page ${currentPage + 1} · ${currentPageReview.verdict} · ${currentPageReview.totalFindings} findings`
                    : `Page ${currentPage + 1}`}
                mode="docked"
                width={380}
                tabs={[
                  { id: 'selected', label: 'Selected' },
                  { id: 'queue', label: 'Queue' },
                  { id: 'filters', label: 'Filters' },
                ]}
                activeTab={auditTab}
                onTabChange={(tab) => setAuditTab(tab as 'selected' | 'queue' | 'filters')}
                onClose={() => setShowAuditPane(false)}
              >
                {auditTab === 'selected' ? (
                  selectedBlock ? (
                    <div style={{ fontSize: 11 }}>
                      {!editMode && canEditExtraction && (
                        <div style={{ marginBottom: 12, padding: 10, backgroundColor: EMBRY.bgDeep, borderRadius: 6, border: `1px solid ${EMBRY.border}` }}>
                          <div style={{ color: EMBRY.white, fontWeight: 600, marginBottom: 4 }}>Read only</div>
                          <div style={{ color: EMBRY.dim, lineHeight: 1.5 }}>
                            This block is selected for inspection. Turn on edit mode to move, resize, delete, or draw replacements.
                          </div>
                        </div>
                      )}
                      {editMode && canEditExtraction && (
                        <div style={{ marginBottom: 12, padding: 8, backgroundColor: EMBRY.bgDeep, borderRadius: 4 }}>
                          <div style={{ ...labelStyle, marginBottom: 6 }}>Edit selected block</div>
                          <BboxEditor
                            block={selectedBlock}
                            onReclassify={handleReclassify}
                            onBboxChange={(bbox) => handleBlockBBoxChange(selectedBlock.id, bbox)}
                            onDelete={handleDeleteSelected}
                          />
                        </div>
                      )}
                      <div style={fieldStyle}>
                        <span style={labelStyle}>Type:</span>
                        <span data-qid="pdf-lab:inspector:type" style={{ color: BLOCK_TYPE_COLORS[selectedBlock.blockType] || EMBRY.white }}>
                          {BLOCK_TYPE_LABELS[selectedBlock.blockType] || selectedBlock.blockType}
                        </span>
                      </div>
                      {selectedBlock.semanticType && (
                        <div style={fieldStyle}>
                          <span style={labelStyle}>Semantic:</span>
                          <span data-qid="pdf-lab:inspector:semantic" style={{ color: EMBRY.white }}>{selectedBlock.semanticType}</span>
                        </div>
                      )}
                      <div style={fieldStyle}>
                        <span style={labelStyle}>Page:</span>
                        <span style={{ color: EMBRY.white }}>{selectedBlock.page + 1}</span>
                      </div>
                      <div style={fieldStyle}>
                        <span style={labelStyle}>Confidence:</span>
                        <span style={{ color: EMBRY.white }}>{(selectedBlock.confidence * 100).toFixed(0)}%</span>
                      </div>
                      {selectedBlock.humanEdited && (
                        <div style={fieldStyle}>
                          <span style={labelStyle}>Human:</span>
                          <span style={{ color: EMBRY.accent }}>
                            edited{selectedBlock.humanEditedAt ? ` · ${selectedBlock.humanEditedAt}` : ''}
                          </span>
                        </div>
                      )}
                      <div style={{ marginTop: 12 }}>
                        <span style={labelStyle}>Text preview:</span>
                        <div data-qid="pdf-lab:inspector:text" style={textPreviewStyle}>{selectedBlock.text || '(empty)'}</div>
                      </div>

                      {selectedBlock.reviewNotes && selectedBlock.reviewNotes.length > 0 && (
                        <div style={{ marginTop: 12 }}>
                          <span style={labelStyle}>Review notes:</span>
                          <div style={qidListStyle}>
                            {selectedBlock.reviewNotes.map((note, i) => (
                              <div key={i} style={qidItemStyle}>{note}</div>
                            ))}
                          </div>
                        </div>
                      )}

                      <details style={{ marginTop: 14 }}>
                        <summary style={{ ...labelStyle, cursor: 'pointer' }}>Technical details</summary>
                        <div style={{ marginTop: 8, display: 'grid', gap: 10 }}>
                          <div>
                            <div style={labelStyle}>BBox</div>
                            <div style={{ fontSize: 9, fontFamily: 'monospace', color: EMBRY.dim, marginTop: 4 }}>
                              [{selectedBlock.bbox.map(n => n.toFixed(3)).join(', ')}]
                            </div>
                          </div>
                          {selectedBlock.tocEntries && selectedBlock.tocEntries.length > 0 && (
                            <div>
                              <div style={labelStyle}>TOC entries</div>
                              <div style={tocListStyle}>
                                {selectedBlock.tocEntries.map((entry, i) => (
                                  <div
                                    key={i}
                                    style={tocEntryStyle}
                                    onClick={() => setCurrentPage(entry.page - 1)}
                                    title={`Go to page ${entry.page}${entry.qid ? ` | ${entry.qid}` : ''}`}
                                  >
                                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {entry.title}
                                    </span>
                                    <span style={{ color: EMBRY.accent, fontWeight: 600, marginLeft: 8 }}>
                                      {entry.page}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {selectedBlock.qids && selectedBlock.qids.length > 0 && (
                            <div>
                              <div style={labelStyle}>QIDs</div>
                              <div style={qidListStyle}>
                                {selectedBlock.qids.map((qid, i) => (
                                  <div key={i} style={qidItemStyle}>{qid}</div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </details>
                    </div>
                  ) : (
                    <div style={{ color: EMBRY.dim, fontSize: 11 }}>
                      Click a block on the page to inspect it here. Queue and Filters stay separate so this pane only describes the selected element.
                    </div>
                  )
                ) : auditTab === 'queue' ? (
                  <div>
                    {currentPageReview && (
                      <div style={{ marginBottom: 12 }}>
                        <span
                          data-qid="pdf-lab:status:page-review"
                          style={{
                            ...statusBadgeStyle,
                            color: currentPageReview.verdict === 'accept' ? EMBRY.green : EMBRY.amber,
                            borderColor: currentPageReview.verdict === 'accept' ? EMBRY.green : EMBRY.amber,
                          }}
                        >
                          page {currentPageReview.verdict === 'accept' ? 'accept' : 'needs review'} · {currentPageReview.totalFindings} findings
                        </span>
                      </div>
                    )}
                    <div style={reviewQueueSectionStyle}>
                      <div style={sidebarSectionTitleStyle}>Review queue</div>
                      <div style={queueMetaRowStyle}>
                        <span style={{ color: EMBRY.dim }}>{flaggedPages.length} flagged pages</span>
                        <span style={{ color: EMBRY.dim }}>{reviewedBlocks.length} changed blocks</span>
                      </div>
                      {nextFlaggedPage && (
                        <button
                          data-qid="pdf-lab:queue:next-flagged"
                          title={`Jump to flagged page ${nextFlaggedPage.pageNumber}`}
                          onClick={() => jumpToPage(nextFlaggedPage.page)}
                          style={queueActionStyle}
                        >
                          Next flagged page · {nextFlaggedPage.pageNumber}
                        </button>
                      )}
                      <div style={{ marginTop: 10 }}>
                        <div style={sidebarSubsectionLabelStyle}>Changed pages</div>
                        <div style={pageChipWrapStyle}>
                          {changedPages.length > 0 ? changedPages.map(({ page, count }) => (
                            <button
                              key={page}
                              data-qid={`pdf-lab:queue:page:${page + 1}`}
                              title={`Jump to page ${page + 1}`}
                              onClick={() => jumpToPage(page)}
                              style={{
                                ...pageChipStyle,
                                borderColor: page === currentPage ? EMBRY.accent : EMBRY.border,
                                color: page === currentPage ? EMBRY.white : EMBRY.dim,
                                backgroundColor: page === currentPage ? 'rgba(124, 58, 237, 0.16)' : EMBRY.bgDeep,
                              }}
                            >
                              p{page + 1} · {count}
                            </button>
                          )) : (
                            <span style={emptyQueueTextStyle}>No reviewed changes yet</span>
                          )}
                        </div>
                      </div>
                      <div style={{ marginTop: 12 }}>
                        <div style={sidebarSubsectionLabelStyle}>Current page changed blocks</div>
                        <div style={queueListStyle}>
                          {changedBlocksOnCurrentPage.length > 0 ? changedBlocksOnCurrentPage.slice(0, 12).map(block => (
                            <button
                              key={block.id}
                              data-qid={`pdf-lab:queue:block:${block.id}`}
                              title={`Select ${BLOCK_TYPE_LABELS[block.blockType] || block.blockType}`}
                              onClick={() => jumpToBlock(block)}
                              style={{
                                ...queueBlockItemStyle,
                                borderColor: block.id === selectedBlockId ? EMBRY.accent : EMBRY.border,
                                backgroundColor: block.id === selectedBlockId ? 'rgba(124, 58, 237, 0.12)' : EMBRY.bgDeep,
                              }}
                            >
                              <span style={{ color: BLOCK_TYPE_COLORS[block.blockType] || EMBRY.white, fontWeight: 600 }}>
                                {BLOCK_TYPE_LABELS[block.blockType] || block.blockType}
                              </span>
                              <span style={{ color: EMBRY.white }}>{block.semanticType || 'Reviewed block'}</span>
                              <span style={queueBlockNoteStyle}>{summarizeReviewNote(block)}</span>
                            </button>
                          )) : (
                            <span style={emptyQueueTextStyle}>No reviewed changes on this page</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div style={reviewQueueSectionStyle}>
                      <div style={sidebarSectionTitleStyle}>Overlay filters</div>
                      <div style={filterChipGroupStyle}>
                        {(['table', 'header', 'text', 'figure', 'equation', 'caption'] as const).map(type => (
                          <button
                            key={type}
                            data-qid={`pdf-lab:filter:${type}`}
                            title={`Toggle ${BLOCK_TYPE_LABELS[type] || type} overlays`}
                            onClick={() => toggleTypeFilter(type)}
                            style={{
                              ...chipStyle,
                              backgroundColor: typeFilters.has(type) ? BLOCK_TYPE_COLORS[type] + '33' : EMBRY.bgDeep,
                              borderColor: typeFilters.has(type) ? BLOCK_TYPE_COLORS[type] : EMBRY.border,
                              color: typeFilters.has(type) ? BLOCK_TYPE_COLORS[type] : EMBRY.dim,
                            }}
                          >
                            {BLOCK_TYPE_LABELS[type] || type}
                          </button>
                        ))}
                      </div>
                      <div style={{ ...queueMetaRowStyle, marginTop: 10 }}>
                        <span data-qid="pdf-lab:status:page-blocks" style={{ color: EMBRY.dim }}>{visibleBlocks.length} blocks</span>
                        {selectedAreaBBox && <span data-qid="pdf-lab:status:area-selection" style={{ color: EMBRY.amber }}>area · {selectedAreaBlockIds.size}</span>}
                      </div>
                      {showRawCompare && rawCompareBlocks.length > 0 && (
                        <div style={{ marginTop: 8 }}>
                          <span style={{ ...statusBadgeStyle, color: EMBRY.amber, borderColor: EMBRY.amber }}>
                            raw compare · {rawCompareBlocks.length} changed
                          </span>
                        </div>
                      )}
                      {editMode && (
                        <div style={{ marginTop: 8, fontSize: 10, color: EMBRY.dim, lineHeight: 1.45 }}>
                          {selectionMode === 'select-area'
                            ? 'Drag to select an area of boxes. Del removes it. Extract Table runs pdf_oxide in that region.'
                            : `Click to select. Drag to move. Handles resize. Draw adds ${BLOCK_TYPE_LABELS[newBlockType]}.`}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </SharedRightPane>
            )}
            {!showAuditPane && (
              <div style={{ ...collapsedPaneRailStyle, borderRight: 'none', borderLeft: `1px solid ${EMBRY.border}` }}>
                <button
                  data-qid="pdf-lab:toolbar:toggle-audit"
                  title="Expand audit pane"
                  onClick={() => setShowAuditPane(true)}
                  style={collapsedPaneButtonStyle}
                >
                  <PanelRightOpen size={18} />
                </button>
              </div>
            )}
          </div>
        )}

        {contextMenu && contextMenuBlock && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            title={`${BLOCK_TYPE_LABELS[contextMenuBlock.blockType] || contextMenuBlock.blockType} · page ${contextMenuBlock.page + 1}`}
            items={blockContextMenuItems}
            onClose={() => setContextMenu(null)}
          />
        )}
      </div>
    </div>
  )
}

function cloneExtractionData(data: ExtractionData): ExtractionData {
  return JSON.parse(JSON.stringify(data)) as ExtractionData
}

function sameBBox(a: [number, number, number, number], b: [number, number, number, number]): boolean {
  return a.every((value, index) => Math.abs(value - b[index]) < 0.000001)
}

function clampNormalized(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function dedupeNotes(notes: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const note of notes) {
    const normalized = note.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function findRawCompareFile(file: PdfFile): PdfFile | null {
  if (file.extractionUrl.includes('-raw-extraction.json')) return null
  return PDF_FILES.find(candidate =>
    candidate.pdfUrl === file.pdfUrl && candidate.extractionUrl.includes('-raw-extraction.json')
  ) || null
}

function toSemanticType(blockType: BboxBlock['blockType']): string {
  switch (blockType) {
    case 'table':
      return 'Table'
    case 'header':
      return 'Header'
    case 'figure':
      return 'Figure'
    case 'text':
      return 'Body'
    case 'equation':
      return 'Equation'
    case 'list_item':
      return 'ListItem'
    case 'caption':
      return 'Caption'
    case 'page_number':
      return 'PageNumber'
    case 'boilerplate':
      return 'Boilerplate'
    default:
      return 'Body'
  }
}

function splitDisplayName(name: string): { title: string; qualifier: string | null } {
  const match = name.match(/^(.*?)(?:\s+\(([^)]+)\))?$/)
  if (!match) return { title: name, qualifier: null }
  return {
    title: match[1]?.trim() || name,
    qualifier: match[2]?.trim() || null,
  }
}

function formatPdfLabel(pdfUrl: string): string {
  const trimmed = pdfUrl.split('/').filter(Boolean).pop()
  return trimmed || pdfUrl
}

function hasReviewChange(block: BboxBlock): boolean {
  return Boolean(block.humanEdited || (block.reviewNotes && block.reviewNotes.length > 0))
}

function summarizeReviewNote(block: BboxBlock): string {
  if (block.humanEdited) return 'Human edited'
  const note = block.reviewNotes?.[0]
  if (!note) return 'Reviewed'
  return note.length > 70 ? `${note.slice(0, 67)}...` : note
}

// Styles using EMBRY theme
const containerStyle: React.CSSProperties = {
  display: 'flex',
  height: '100%',
  backgroundColor: EMBRY.bgDeep,
  color: EMBRY.white,
}

const mainContentStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  overflow: 'hidden',
}

const centerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 1,
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  minHeight: 46,
  padding: '6px 12px',
  borderBottom: `1px solid ${EMBRY.border}`,
  backgroundColor: 'rgba(13, 16, 22, 0.96)',
  backdropFilter: 'blur(10px)',
}

const headerPrimaryRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 10,
  flex: 1,
  minWidth: 0,
}

const headerIdentityStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  flex: '1 1 420px',
}

const headerTitleRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
}

const headerTitleTextStyle: React.CSSProperties = {
  fontSize: 14,
  lineHeight: 1.1,
  fontWeight: 700,
  color: EMBRY.white,
  letterSpacing: '-0.02em',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  maxWidth: 420,
}

const headerMetaRowStyle: React.CSSProperties = {
  fontSize: 10,
  color: EMBRY.dim,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

const subtleMetaBadgeStyle: React.CSSProperties = {
  padding: '1px 6px',
  borderRadius: 999,
  border: `1px solid ${EMBRY.border}`,
  backgroundColor: EMBRY.bgDeep,
  color: EMBRY.dim,
  fontSize: 9,
}

const metricBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '2px 8px',
  fontSize: 9,
  border: '1px solid',
  borderRadius: 999,
  backgroundColor: EMBRY.bgDeep,
  fontFamily: '"JetBrains Mono", monospace',
  color: EMBRY.white,
  borderColor: EMBRY.border,
}

const metricValueStyle: React.CSSProperties = {
  fontWeight: 700,
  color: EMBRY.white,
}

const toolbarShellStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  flexWrap: 'wrap',
  flex: '0 1 auto',
}

const toolbarGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 6,
  flexWrap: 'wrap',
}

const filterChipGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
}

const chipStyle: React.CSSProperties = {
  padding: '3px 10px',
  fontSize: 9,
  border: '1px solid',
  borderRadius: 12,
  cursor: 'pointer',
  background: 'transparent',
  fontFamily: '"JetBrains Mono", monospace',
}

const statusBadgeStyle: React.CSSProperties = {
  padding: '2px 8px',
  fontSize: 9,
  border: '1px solid',
  borderRadius: 999,
  backgroundColor: EMBRY.bgDeep,
  fontFamily: '"JetBrains Mono", monospace',
}

const contentAreaStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  overflow: 'hidden',
  minHeight: 0,
}

const collapsedPaneRailStyle: React.CSSProperties = {
  width: 44,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  paddingTop: 12,
  borderRight: `1px solid ${EMBRY.border}`,
  backgroundColor: EMBRY.bgPanel,
}

const collapsedPaneButtonStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 30,
  height: 30,
  padding: 0,
  borderRadius: 8,
  border: `1px solid ${EMBRY.border}`,
  backgroundColor: EMBRY.bgDeep,
  color: EMBRY.dim,
  cursor: 'pointer',
}

const canvasContainerStyle: React.CSSProperties = {
  flex: 1,
  position: 'relative',
  overflow: 'hidden',
  backgroundColor: EMBRY.bgDeep,
}

const toolDockStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  left: 12,
  zIndex: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 8,
  borderRadius: 12,
  border: `1px solid ${EMBRY.border}`,
  backgroundColor: 'rgba(8, 11, 16, 0.9)',
  backdropFilter: 'blur(12px)',
  boxShadow: '0 10px 32px rgba(0, 0, 0, 0.34)',
}

const dockBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  justifyContent: 'flex-start',
  minWidth: 132,
  padding: '5px 9px',
  fontSize: 10,
  cursor: 'pointer',
  color: EMBRY.white,
  borderRadius: 9,
  border: `1px solid ${EMBRY.border}`,
  backgroundColor: 'rgba(8, 11, 16, 0.88)',
}

const dockSelectStyle: React.CSSProperties = {
  backgroundColor: 'rgba(8, 11, 16, 0.92)',
  border: `1px solid ${EMBRY.border}`,
  color: EMBRY.white,
  fontSize: 10,
  padding: '5px 9px',
  outline: 'none',
  minWidth: 132,
  borderRadius: 9,
}

const viewportHudStyle: React.CSSProperties = {
  position: 'absolute',
  left: '50%',
  bottom: 12,
  transform: 'translateX(-50%)',
  zIndex: 20,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 10px',
  borderRadius: 999,
  border: `1px solid ${EMBRY.border}`,
  backgroundColor: 'rgba(8, 11, 16, 0.9)',
  backdropFilter: 'blur(14px)',
  boxShadow: '0 10px 24px rgba(0, 0, 0, 0.32)',
}

const viewportBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '6px 10px',
  cursor: 'pointer',
  border: `1px solid ${EMBRY.border}`,
  borderRadius: 999,
  color: EMBRY.white,
  backgroundColor: 'transparent',
}

const viewportDividerStyle: React.CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  backgroundColor: EMBRY.border,
  margin: '0 2px',
}

const floatingStatusStyle: React.CSSProperties = {
  position: 'absolute',
  right: 12,
  bottom: 14,
  zIndex: 20,
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  borderRadius: 12,
  border: `1px solid ${EMBRY.border}`,
  backgroundColor: 'rgba(8, 11, 16, 0.88)',
  backdropFilter: 'blur(12px)',
  boxShadow: '0 10px 24px rgba(0, 0, 0, 0.28)',
  maxWidth: 'min(42vw, 520px)',
  flexWrap: 'wrap',
}

const contextualHudStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: 6,
  borderRadius: 12,
  border: `1px solid ${EMBRY.border}`,
  backgroundColor: 'rgba(8, 11, 16, 0.94)',
  backdropFilter: 'blur(12px)',
  boxShadow: '0 12px 24px rgba(0, 0, 0, 0.34)',
}

const contextualBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
  padding: '6px 10px',
  fontSize: 10,
  cursor: 'pointer',
  color: EMBRY.white,
  borderRadius: 9,
  border: `1px solid ${EMBRY.border}`,
  backgroundColor: 'rgba(14, 18, 24, 0.92)',
}

const reviewQueueSectionStyle: React.CSSProperties = {
  marginBottom: 14,
  padding: 10,
  border: `1px solid ${EMBRY.border}`,
  backgroundColor: EMBRY.bgDeep,
  borderRadius: 6,
}

const sidebarSectionTitleStyle: React.CSSProperties = {
  fontWeight: 700,
  color: EMBRY.white,
  fontSize: 12,
  marginBottom: 8,
}

const sidebarSubsectionLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: EMBRY.dim,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: 6,
}

const queueMetaRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  fontSize: 11,
}

const queueActionStyle: React.CSSProperties = {
  width: '100%',
  marginTop: 8,
  backgroundColor: 'rgba(74, 158, 255, 0.14)',
  border: `1px solid ${EMBRY.blue}`,
  color: EMBRY.white,
  borderRadius: 4,
  padding: '6px 8px',
  fontSize: 11,
  cursor: 'pointer',
  textAlign: 'left',
}

const pageChipWrapStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
}

const pageChipStyle: React.CSSProperties = {
  border: '1px solid',
  borderRadius: 999,
  padding: '4px 8px',
  fontSize: 10,
  cursor: 'pointer',
  fontFamily: '"JetBrains Mono", monospace',
}

const queueListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}

const queueBlockItemStyle: React.CSSProperties = {
  border: '1px solid',
  borderRadius: 6,
  padding: '7px 8px',
  textAlign: 'left',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
}

const queueBlockNoteStyle: React.CSSProperties = {
  fontSize: 10,
  color: EMBRY.dim,
  lineHeight: 1.35,
}

const emptyQueueTextStyle: React.CSSProperties = {
  fontSize: 11,
  color: EMBRY.dim,
}

const btnStyle: React.CSSProperties = {
  background: 'transparent',
  border: `1px solid ${EMBRY.border}`,
  borderRadius: 4,
  padding: 4,
  cursor: 'pointer',
  color: EMBRY.dim,
  display: 'flex',
  alignItems: 'center',
}

const actionBtnStyle: React.CSSProperties = {
  ...btnStyle,
  padding: '5px 9px',
  gap: 5,
  color: EMBRY.white,
  fontSize: 10,
}

const fieldStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  padding: '4px 0',
  borderBottom: `1px solid ${EMBRY.border}`,
}

const labelStyle: React.CSSProperties = {
  color: EMBRY.dim,
}

const textPreviewStyle: React.CSSProperties = {
  marginTop: 4,
  padding: 8,
  backgroundColor: EMBRY.bgDeep,
  borderRadius: 4,
  fontSize: 10,
  maxHeight: 200,
  overflow: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  color: EMBRY.white,
  fontFamily: '"JetBrains Mono", monospace',
}

const qidListStyle: React.CSSProperties = {
  marginTop: 4,
  padding: 6,
  backgroundColor: EMBRY.bgDeep,
  borderRadius: 4,
  maxHeight: 80,
  overflow: 'auto',
}

const qidItemStyle: React.CSSProperties = {
  fontSize: 9,
  fontFamily: '"JetBrains Mono", monospace',
  color: EMBRY.accent,
  padding: '2px 0',
}

const tocListStyle: React.CSSProperties = {
  marginTop: 4,
  backgroundColor: EMBRY.bgDeep,
  borderRadius: 4,
  maxHeight: 300,
  overflow: 'auto',
}

const tocEntryStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '4px 8px',
  borderBottom: `1px solid ${EMBRY.border}`,
  fontSize: 10,
  fontFamily: '"JetBrains Mono", monospace',
  color: EMBRY.white,
  cursor: 'pointer',
  transition: 'background 0.1s',
}

export default PdfLabView

import { useState, useEffect, useMemo, useCallback } from 'react'
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, FileText, Eye, Pencil, Save, RotateCcw, Trash2, Focus } from 'lucide-react'
import PdfCanvas from '../datalake-explorer/PdfCanvas'
import type { BboxBlock } from '../datalake-explorer/types'
import { BLOCK_TYPE_COLORS, BLOCK_TYPE_LABELS } from '../datalake-explorer/BboxWorkspace'
import BboxEditor from '../datalake-explorer/BboxEditor'
import { LeftPane, LeftPaneSection, paneItemStyle, useLeftPaneSearch } from '../common/LeftPane'
import { ContextMenu, type ContextMenuItem } from '../common/ContextMenu'
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
  // Get URLs from query params or props
  const params = new URLSearchParams(window.location.hash.split('?')[1] || '')
  const initialPdfUrl = propPdfUrl || params.get('pdf')
  const initialExtractionUrl = propExtractionUrl || params.get('extraction')

  // Find initial file from params or default to first
  const initialFile =
    PDF_FILES.find(
      f => f.pdfUrl === initialPdfUrl && (!initialExtractionUrl || f.extractionUrl === initialExtractionUrl)
    ) ||
    PDF_FILES.find(f => f.pdfUrl === initialPdfUrl) ||
    PDF_FILES[0]

  const [selectedFile, setSelectedFile] = useState<PdfFile>(initialFile)
  const [extraction, setExtraction] = useState<ExtractionData | null>(null)
  const [baselineExtraction, setBaselineExtraction] = useState<ExtractionData | null>(null)
  const [rawCompareExtraction, setRawCompareExtraction] = useState<ExtractionData | null>(null)
  const [currentPage, setCurrentPage] = useState(0)
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)
  const [zoom, setZoom] = useState(0.5)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [showRawCompare, setShowRawCompare] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirtyBlockIds, setDirtyBlockIds] = useState<Set<string>>(new Set())
  const [deletedBlockIds, setDeletedBlockIds] = useState<Set<string>>(new Set())
  const [newBlockType, setNewBlockType] = useState<BboxBlock['blockType']>('text')
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set(['table', 'header', 'figure', 'text', 'caption', 'page_number', 'boilerplate']))
  const [contextMenu, setContextMenu] = useState<{ blockId: string; x: number; y: number } | null>(null)

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
    setDirtyBlockIds(new Set())
    setDeletedBlockIds(new Set())
    setContextMenu(null)

    fetch(extractionUrl)
      .then(r => {
        if (!r.ok) throw new Error(`Failed to load: ${r.status}`)
        return r.json()
      })
      .then((data: ExtractionData) => {
        setExtraction(data)
        setBaselineExtraction(cloneExtractionData(data))
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
  const updatedAtLabel = extraction?.humanEdits?.updatedAt ? formatTimestamp(extraction.humanEdits.updatedAt) : null

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

  const handleBlockBBoxChange = (blockId: string, bbox: [number, number, number, number]) => {
    updateBlock(blockId, (block) => {
      if (sameBBox(block.bbox, bbox)) return block
      return applyHumanEditMetadata({ ...block, bbox }, 'Human adjusted bbox in pdf-lab')
    })
  }

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

  const handleDeleteSelected = () => {
    if (!selectedBlockId) return
    deleteBlock(selectedBlockId)
  }

  const handleCreateBlock = (bbox: [number, number, number, number]) => {
    const blockId = `human:p${currentPage}:${Date.now()}`
    const createdAt = new Date().toISOString()
    const newBlock: BboxBlock = {
      id: blockId,
      page: currentPage,
      bbox,
      blockType: newBlockType,
      semanticType: toSemanticType(newBlockType),
      text: '',
      confidence: 1,
      humanEdited: true,
      humanEditedAt: createdAt,
      reviewNotes: ['Human created block in pdf-lab'],
      cascadeTrail: [{
        tier: 'T2',
        tierName: 'Human',
        disposition: 'accept',
        confidence: 1,
      }],
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
      next.add(newBlockType)
      return next
    })
    markBlockDirty(blockId)
    setSelectedBlockId(blockId)
    setSaveError(null)
    setSaveNotice(null)
  }

  const handleRevert = () => {
    if (!baselineExtraction) return
    setExtraction(cloneExtractionData(baselineExtraction))
    setDirtyBlockIds(new Set())
    setDeletedBlockIds(new Set())
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
      if (e.key === 'ArrowRight' && extraction && currentPage < extraction.pageCount - 1) {
        setCurrentPage(p => p + 1)
      }
      if (e.key === 'ArrowLeft' && currentPage > 0) {
        setCurrentPage(p => p - 1)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [currentPage, extraction])

  const handleSelectFile = (file: PdfFile) => {
    setSelectedFile(file)
    // Update URL without reload
    const newHash = `#pdf-lab?pdf=${encodeURIComponent(file.pdfUrl)}&extraction=${encodeURIComponent(file.extractionUrl)}`
    window.history.replaceState(null, '', newHash)
  }

  const blockContextMenuItems = useMemo<ContextMenuItem[]>(() => {
    if (!contextMenuBlock) return []
    const items: ContextMenuItem[] = [
      {
        label: 'Select block',
        icon: <Focus size={12} />,
        shortcut: 'Enter',
        onClick: () => setSelectedBlockId(contextMenuBlock.id),
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

  return (
    <div style={containerStyle}>
      {/* Left Pane - PDF File Selector */}
      <PdfLeftPane
        files={PDF_FILES}
        selectedId={selectedFile.id}
        onSelectFile={handleSelectFile}
      />

      {/* Main Content */}
      <div style={mainContentStyle}>
        {/* Header */}
        <div style={headerStyle}>
          <div style={headerPrimaryRowStyle}>
            <div style={headerIdentityStyle}>
              <div style={headerTitleRowStyle}>
                <Eye size={18} color={EMBRY.accent} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                  <div style={headerTitleTextStyle}>{displayTitle.title}</div>
                  <div style={headerMetaRowStyle}>
                    {displayTitle.qualifier && (
                      <span style={subtleMetaBadgeStyle}>{displayTitle.qualifier}</span>
                    )}
                    <span title={pdfUrl}>{pdfLabel}</span>
                    {updatedAtLabel && <span>updated {updatedAtLabel}</span>}
                  </div>
                </div>
              </div>
              <div style={headerStatsRowStyle}>
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
                {extraction?.humanEdits && (
                  <span style={metricBadgeStyle}>
                    <strong style={metricValueStyle}>{extraction.humanEdits.editCount}</strong>
                    manual edits
                  </span>
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
                  style={{ ...actionBtnStyle, opacity: canEditExtraction ? 1 : 0.45 }}
                >
                  <Pencil size={14} />
                  {editMode ? 'Editing' : 'Edit'}
                </button>
                {canEditExtraction && (
                  <select
                    data-qid="pdf-lab:toolbar:new-block-type"
                    value={newBlockType}
                    onChange={(event) => setNewBlockType(event.target.value as BboxBlock['blockType'])}
                    style={selectStyle}
                    title="Default type for new blocks drawn on the page"
                  >
                    {EDITABLE_BLOCK_TYPES.map(type => (
                      <option key={type} value={type}>{BLOCK_TYPE_LABELS[type]}</option>
                    ))}
                  </select>
                )}
                <button
                  data-qid="pdf-lab:toolbar:compare-raw"
                  onClick={() => setShowRawCompare(value => !value)}
                  disabled={!rawCompareExtraction}
                  style={{ ...actionBtnStyle, opacity: rawCompareExtraction ? 1 : 0.45 }}
                  title={rawCompareExtraction ? 'Overlay changed raw blocks for comparison' : 'No raw comparison extraction available'}
                >
                  <Eye size={14} />
                  {showRawCompare ? 'Hide Raw' : 'Compare Raw'}
                </button>
              </div>

              <div style={toolbarGroupStyle}>
                <button
                  data-qid="pdf-lab:toolbar:revert"
                  title="Discard reviewed changes on this extraction"
                  onClick={handleRevert}
                  disabled={dirtyCount === 0 || !canEditExtraction}
                  style={{ ...actionBtnStyle, opacity: dirtyCount > 0 && canEditExtraction ? 1 : 0.45 }}
                >
                  <RotateCcw size={14} />
                  Revert
                </button>
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
                <div style={zoomClusterStyle}>
                  <button
                    data-qid="pdf-lab:toolbar:zoom-out"
                    title="Zoom out"
                    onClick={() => setZoom(z => Math.max(0.25, z - 0.1))}
                    style={btnStyle}
                  >
                    <ZoomOut size={16} />
                  </button>
                  <span style={{ fontSize: 11, minWidth: 40, textAlign: 'center', color: EMBRY.dim }}>
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    data-qid="pdf-lab:toolbar:zoom-in"
                    title="Zoom in"
                    onClick={() => setZoom(z => Math.min(2, z + 0.1))}
                    style={btnStyle}
                  >
                    <ZoomIn size={16} />
                  </button>
                </div>
              </div>
              {dirtyCount > 0 && (
                <span style={{ ...statusBadgeStyle, color: EMBRY.amber, borderColor: `${EMBRY.amber}66` }}>
                  {dirtyCount} unsaved
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Type filter chips */}
        <div style={filterBarStyle}>
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
          <div style={filterStatusGroupStyle}>
            <span style={{ fontSize: 11, color: EMBRY.dim }}>
              {visibleBlocks.length} blocks on page {currentPage + 1}
            </span>
            {currentPageReview && (
              <span style={{
                ...statusBadgeStyle,
                color: currentPageReview.verdict === 'accept' ? EMBRY.green : EMBRY.amber,
                borderColor: currentPageReview.verdict === 'accept' ? EMBRY.green : EMBRY.amber,
              }}>
                page {currentPageReview.verdict === 'accept' ? 'accept' : 'needs review'} · {currentPageReview.totalFindings} findings
              </span>
            )}
            {editMode && (
              <span style={{ ...statusBadgeStyle, color: EMBRY.accent, borderColor: EMBRY.accent }}>
                click to select · drag to move · handles resize · right-click menu · draw adds {BLOCK_TYPE_LABELS[newBlockType]}
              </span>
            )}
            {showRawCompare && rawCompareBlocks.length > 0 && (
              <span style={{ ...statusBadgeStyle, color: EMBRY.amber, borderColor: EMBRY.amber }}>
                raw compare · {rawCompareBlocks.length} changed
              </span>
            )}
            {saveNotice && <span style={{ fontSize: 11, color: EMBRY.green }}>{saveNotice}</span>}
            {saveError && <span style={{ fontSize: 11, color: EMBRY.red }}>{saveError}</span>}
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
              <PdfCanvas
                pdfUrl={pdfUrl}
                pageNumber={currentPage}
                bboxOverlays={visibleBlocks}
                compareOverlays={rawCompareBlocks}
                selectedBlockId={selectedBlockId}
                onBlockClick={(blockId) => {
                  setSelectedBlockId(blockId)
                  setContextMenu(null)
                }}
                onBlockContextMenu={(blockId, x, y) => setContextMenu({ blockId, x, y })}
                zoom={zoom}
                editMode={editMode && canEditExtraction}
                onBlockBBoxChange={editMode && canEditExtraction ? handleBlockBBoxChange : undefined}
                onCanvasClick={() => {
                  setSelectedBlockId(null)
                  setContextMenu(null)
                }}
                onCreateBlock={editMode && canEditExtraction ? handleCreateBlock : undefined}
              />
            </div>

            {/* Block inspector sidebar */}
            <div style={sidebarStyle}>
              <div style={{ fontWeight: 600, marginBottom: 8, color: EMBRY.white, fontSize: 12 }}>
                Block Inspector
              </div>
              {selectedBlock ? (
                <div style={{ fontSize: 11 }}>
                  {editMode && canEditExtraction && (
                    <div style={{ marginBottom: 12, padding: 8, backgroundColor: EMBRY.bgDeep, borderRadius: 4 }}>
                      <div style={{ ...labelStyle, marginBottom: 6 }}>Human Edit</div>
                      <BboxEditor
                        block={selectedBlock}
                        onReclassify={handleReclassify}
                        onBboxChange={(bbox) => handleBlockBBoxChange(selectedBlock.id, bbox)}
                        onDelete={handleDeleteSelected}
                      />
                    </div>
                  )}
                  {currentPageReview && (
                    <div style={{ marginBottom: 12, padding: 8, backgroundColor: EMBRY.bgDeep, borderRadius: 4 }}>
                      <div style={{ ...labelStyle, marginBottom: 4 }}>Page Review</div>
                      <div style={{ color: currentPageReview.verdict === 'accept' ? EMBRY.green : EMBRY.amber }}>
                        {currentPageReview.verdict}
                      </div>
                      <div style={{ color: EMBRY.dim, marginTop: 4 }}>
                        {currentPageReview.totalFindings} findings · {currentPageReview.missedRegions} missed regions
                      </div>
                    </div>
                  )}
                  <div style={fieldStyle}>
                    <span style={labelStyle}>Type:</span>
                    <span style={{ color: BLOCK_TYPE_COLORS[selectedBlock.blockType] || EMBRY.white }}>
                      {BLOCK_TYPE_LABELS[selectedBlock.blockType] || selectedBlock.blockType}
                    </span>
                  </div>
                  {selectedBlock.semanticType && (
                    <div style={fieldStyle}>
                      <span style={labelStyle}>Semantic:</span>
                      <span style={{ color: EMBRY.white }}>{selectedBlock.semanticType}</span>
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

                  {/* TOC Entries - structured view with QIDs and clickable page navigation */}
                  {selectedBlock.tocEntries && selectedBlock.tocEntries.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <span style={labelStyle}>TOC Entries ({selectedBlock.tocEntries.length}):</span>
                      <div style={tocListStyle}>
                        {selectedBlock.tocEntries.map((entry, i) => (
                          <div
                            key={i}
                            style={tocEntryStyle}
                            onClick={() => setCurrentPage(entry.page - 1)}
                            title={`Go to page ${entry.page}${entry.qid ? ` | ${entry.qid}` : ''}`}
                          >
                            {entry.qid && (
                              <span style={{ color: EMBRY.accent, fontSize: 8, marginRight: 6, opacity: 0.7 }}>
                                {entry.qid.replace(/\[|\]/g, '').replace('QID_TOC_', '')}
                              </span>
                            )}
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

                  {/* QID markers - only show if no TOC entries (standalone QIDs) */}
                  {selectedBlock.qids && selectedBlock.qids.length > 0 && (!selectedBlock.tocEntries || selectedBlock.tocEntries.length === 0) && (
                    <div style={{ marginTop: 12 }}>
                      <span style={labelStyle}>QIDs ({selectedBlock.qids.length}):</span>
                      <div style={qidListStyle}>
                        {selectedBlock.qids.map((qid, i) => (
                          <div key={i} style={qidItemStyle}>{qid}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Text content - only show if no structured TOC */}
                  {(!selectedBlock.tocEntries || selectedBlock.tocEntries.length === 0) && (
                    <div style={{ marginTop: 12 }}>
                      <span style={labelStyle}>Text:</span>
                      <div style={textPreviewStyle}>{selectedBlock.text || '(empty)'}</div>
                    </div>
                  )}

                  {selectedBlock.reviewNotes && selectedBlock.reviewNotes.length > 0 && (
                    <div style={{ marginTop: 12 }}>
                      <span style={labelStyle}>Review Notes:</span>
                      <div style={qidListStyle}>
                        {selectedBlock.reviewNotes.map((note, i) => (
                          <div key={i} style={qidItemStyle}>{note}</div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* BBox - collapsed by default */}
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ ...labelStyle, cursor: 'pointer' }}>BBox (technical)</summary>
                    <div style={{ fontSize: 9, fontFamily: 'monospace', color: EMBRY.dim, marginTop: 4 }}>
                      [{selectedBlock.bbox.map(n => n.toFixed(3)).join(', ')}]
                    </div>
                  </details>
                </div>
              ) : (
                <div style={{ color: EMBRY.dim, fontSize: 11 }}>
                  {currentPageReview ? `Page ${currentPage + 1}: ${currentPageReview.verdict}, ${currentPageReview.totalFindings} findings` : 'Click a block to inspect'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Page navigation footer */}
        <div style={footerStyle}>
          <button
            onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
            disabled={currentPage === 0}
            style={{ ...navBtnStyle, opacity: currentPage === 0 ? 0.3 : 1 }}
          >
            <ChevronLeft size={16} />
          </button>
          <span style={{ fontSize: 12, color: EMBRY.white }}>
            Page {currentPage + 1} of {extraction?.pageCount || '?'}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min((extraction?.pageCount || 1) - 1, p + 1))}
            disabled={currentPage >= (extraction?.pageCount || 1) - 1}
            style={{ ...navBtnStyle, opacity: currentPage >= (extraction?.pageCount || 1) - 1 ? 0.3 : 1 }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
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

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
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
  flexDirection: 'column',
  gap: 12,
  padding: '12px 16px',
  borderBottom: `1px solid ${EMBRY.border}`,
  backgroundColor: EMBRY.bgPanel,
}

const headerPrimaryRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 16,
  flexWrap: 'wrap',
}

const headerIdentityStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  minWidth: 0,
  flex: '1 1 420px',
}

const headerTitleRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 12,
  minWidth: 0,
}

const headerTitleTextStyle: React.CSSProperties = {
  fontSize: 18,
  lineHeight: 1.2,
  fontWeight: 700,
  color: EMBRY.white,
  letterSpacing: '-0.02em',
}

const headerMetaRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  fontSize: 11,
  color: EMBRY.dim,
}

const subtleMetaBadgeStyle: React.CSSProperties = {
  padding: '2px 6px',
  borderRadius: 999,
  border: `1px solid ${EMBRY.border}`,
  backgroundColor: EMBRY.bgDeep,
  color: EMBRY.dim,
  fontSize: 10,
}

const headerStatsRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
}

const metricBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 8px',
  fontSize: 10,
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
  flexDirection: 'column',
  alignItems: 'flex-end',
  gap: 8,
  flex: '0 1 auto',
}

const toolbarGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  flexWrap: 'wrap',
}

const zoomClusterStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '0 2px',
}

const filterBarStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
  padding: '6px 16px',
  borderBottom: `1px solid ${EMBRY.border}`,
  backgroundColor: EMBRY.bgCard,
}

const filterChipGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
}

const filterStatusGroupStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'flex-end',
  gap: 8,
  flexWrap: 'wrap',
  marginLeft: 'auto',
}

const chipStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: 10,
  border: '1px solid',
  borderRadius: 12,
  cursor: 'pointer',
  background: 'transparent',
  fontFamily: '"JetBrains Mono", monospace',
}

const statusBadgeStyle: React.CSSProperties = {
  padding: '3px 8px',
  fontSize: 10,
  border: '1px solid',
  borderRadius: 999,
  backgroundColor: EMBRY.bgDeep,
  fontFamily: '"JetBrains Mono", monospace',
}

const contentAreaStyle: React.CSSProperties = {
  display: 'flex',
  flex: 1,
  overflow: 'hidden',
}

const canvasContainerStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  backgroundColor: EMBRY.bgDeep,
}

const sidebarStyle: React.CSSProperties = {
  width: 260,
  padding: 12,
  borderLeft: `1px solid ${EMBRY.border}`,
  backgroundColor: EMBRY.bgPanel,
  overflow: 'auto',
}

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 16,
  padding: '8px 16px',
  borderTop: `1px solid ${EMBRY.border}`,
  backgroundColor: EMBRY.bgPanel,
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
  padding: '6px 10px',
  gap: 6,
  color: EMBRY.white,
  fontSize: 11,
}

const selectStyle: React.CSSProperties = {
  backgroundColor: EMBRY.bgDeep,
  border: `1px solid ${EMBRY.border}`,
  borderRadius: 4,
  color: EMBRY.white,
  fontSize: 11,
  padding: '6px 10px',
  outline: 'none',
}

const navBtnStyle: React.CSSProperties = {
  ...btnStyle,
  padding: '6px 12px',
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

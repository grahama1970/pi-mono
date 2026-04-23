import { useState, useEffect, useCallback } from 'react'
import { EMBRY, label, body } from '../common/EmbryStyle'
import { useQRAs } from '../../../hooks/useSpartaCollections'
import type { SpartaQRA, QRASource } from '../../../hooks/useSpartaCollections'
import { useSpartaNav } from './SpartaExplorer'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import { EvidenceView } from './EvidenceView'
import { Search, CheckCircle2, XCircle, FileText, PanelLeftClose, PanelLeft, PanelRightClose, PanelRight, Layers, X, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react'
import { MarkdownRenderer } from '../../shared-chat/MarkdownRenderer'
import { inlineHighlight, spanHighlight } from './explorerUtils'
import type { Span, GlossaryEntryLike, HighlightEmphasis } from './explorerUtils'

type EntityViewMode = 'anchors' | 'context' | 'full'

const ENTITY_VIEW_OPTIONS: Array<{ mode: EntityViewMode; label: string; title: string; minEmphasis: HighlightEmphasis }> = [
  { mode: 'anchors', label: 'Anchors', title: 'Show only primary entities and IDs', minEmphasis: 'high' },
  { mode: 'context', label: 'Context', title: 'Show primary entities plus named phrase context', minEmphasis: 'medium' },
  { mode: 'full', label: 'Full', title: 'Show all available extracted entities after suppression', minEmphasis: 'low' },
]

const ENTITY_VIEW_STORAGE_KEY = 'sparta_qra_entity_view_mode'

function loadEntityViewMode(): EntityViewMode {
  try {
    const value = localStorage.getItem(ENTITY_VIEW_STORAGE_KEY)
    if (value === 'anchors' || value === 'context' || value === 'full') return value
  } catch { /* ignore */ }
  return 'context'
}

function saveEntityViewMode(mode: EntityViewMode) {
  try { localStorage.setItem(ENTITY_VIEW_STORAGE_KEY, mode) } catch { /* ignore */ }
}

function minEmphasisForMode(mode: EntityViewMode): HighlightEmphasis {
  return ENTITY_VIEW_OPTIONS.find((option) => option.mode === mode)?.minEmphasis ?? 'medium'
}

/** Render QRA answer as clean paragraphs with subtle entity highlighting */
function AnswerDisplay({
  text,
  glossary = [],
  minEmphasis = 'medium',
}: {
  text: string
  glossary?: Array<{ id?: string; name?: string; framework?: string; type?: string; description?: string; source?: string }>
  minEmphasis?: HighlightEmphasis
}) {
  if (!text) return null

  // Clean up the text
  const cleaned = text
    .replace(/\[EPISODIC\]\s*/g, '')
    .replace(/\[QRA-GROUNDED\]\s*/g, '\n\n')
    .replace(/\[Prior:\s*([^\]]+)\]/g, '(Prior: $1)')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // Split into paragraphs
  const paragraphs = cleaned.split(/\n\n+/)

  return (
    <>
      {paragraphs.map((para, i) => (
        <p key={i} style={{ margin: '0 0 12px 0', lineHeight: 1.7 }}>
          {inlineHighlight(para.trim(), glossary, { minEmphasis })}
        </p>
      ))}
    </>
  )
}

function statusBadges(q: SpartaQRA, onEvidenceClick?: (e: React.MouseEvent) => void): React.ReactNode {
  const evidencePass = q.evidence_case?.formal_proof?.success
  const humanBlessed = q.evidence_case?.review_status === 'approved'

  const badge = (pass: boolean | undefined, label: string, title: string, onClick?: (e: React.MouseEvent) => void, qid?: string, qsAction?: string) => {
    const color = pass === true ? EMBRY.green : pass === false ? EMBRY.red : EMBRY.dim
    const isClickable = !!onClick
    return (
      <span
        data-qid={qid}
        data-qs-action={qsAction}
        title={title}
        onClick={onClick}
        style={{
          fontSize: 9, fontWeight: 800, padding: '2px 4px', borderRadius: 4,
          color, backgroundColor: `${color}15`, border: `1px solid ${color}30`,
          display: 'flex', alignItems: 'center', gap: 3,
          cursor: isClickable ? 'pointer' : 'default',
          transition: 'all 0.15s',
        }}
      >
        <span style={{ width: 4, height: 4, borderRadius: '50%', backgroundColor: color }} />
        {label}
      </span>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
      {badge(evidencePass, 'EVD', evidencePass === true ? 'Evidence PASS — click to view' : evidencePass === false ? 'Evidence FAIL — click to view' : 'No Evidence — click to view', onEvidenceClick, `qras:action:toggle_evidence`, 'TOGGLE_EVIDENCE')}
      {badge(humanBlessed, 'HMN', humanBlessed ? 'Human Blessed ✓' : 'Unblessed — click for details', () => { /* no-op or simple focus handling */ }, `qras:action:toggle_hmn`, 'TOGGLE_HMN')}
    </div>
  )
}

function prodigyBtn(baseColor: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 32, borderRadius: 6, cursor: 'pointer', transition: 'all 0.2s', padding: '0 16px',
    border: `1px solid ${baseColor}44`, backgroundColor: `${baseColor}12`, color: baseColor,
  }
}

function compactKey(key: string, prefix = 24, suffix = 10): string {
  if (key.length <= prefix + suffix + 3) return key
  return `${key.slice(0, prefix)}...${key.slice(-suffix)}`
}

function deriveEvidenceOutcome(qra: SpartaQRA | undefined): {
  state: 'passed' | 'inconclusive' | 'failed' | 'pending'
  label: string
  shortLabel: string
  color: string
  Icon: typeof CheckCircle2
} {
  const verdict = String(qra?.evidence_case?.verdict ?? '').trim().toLowerCase()
  const gatesPassed = typeof qra?.evidence_case?.gates_passed === 'number' ? qra.evidence_case.gates_passed : undefined
  const gatesTotal = typeof qra?.evidence_case?.gates_total === 'number' ? qra.evidence_case.gates_total : undefined

  if (verdict === 'satisfied') {
    return { state: 'passed', label: 'Passed /create-evidence-case', shortLabel: 'Pass', color: EMBRY.green, Icon: CheckCircle2 }
  }
  if (verdict === 'inconclusive') {
    return { state: 'inconclusive', label: 'Inconclusive evidence case', shortLabel: 'Partial', color: EMBRY.amber, Icon: AlertCircle }
  }
  if (verdict === 'not_satisfied') {
    return { state: 'failed', label: 'Failed /create-evidence-case', shortLabel: 'Fail', color: EMBRY.red, Icon: XCircle }
  }
  if ((gatesTotal ?? 0) > 0) {
    if (gatesPassed === gatesTotal) {
      return { state: 'passed', label: 'Passed /create-evidence-case', shortLabel: 'Pass', color: EMBRY.green, Icon: CheckCircle2 }
    }
    if ((gatesPassed ?? 0) === 0) {
      return { state: 'failed', label: 'Failed /create-evidence-case', shortLabel: 'Fail', color: EMBRY.red, Icon: XCircle }
    }
    return { state: 'inconclusive', label: 'Inconclusive evidence case', shortLabel: 'Partial', color: EMBRY.amber, Icon: AlertCircle }
  }
  return { state: 'pending', label: 'Evidence case not yet run', shortLabel: 'Pending', color: EMBRY.dim, Icon: AlertCircle }
}

function evidenceSummaryLine(qra: SpartaQRA | undefined): string {
  if (!qra?.evidence_case) return 'No evidence-case summary is available yet.'
  const parts = [
    typeof qra.evidence_case.gates_total === 'number'
      ? `${qra.evidence_case.gates_passed ?? 0}/${qra.evidence_case.gates_total} gates`
      : null,
    qra.evidence_case.control_ids?.length ? `${qra.evidence_case.control_ids.length} controls` : null,
    qra.evidence_case.grade ? `grade ${qra.evidence_case.grade}` : null,
    qra.evidence_case.review_status ? `workflow ${qra.evidence_case.review_status}` : null,
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' • ') : 'No evidence-case summary is available yet.'
}

export function QRAsView() {
  const nav = useSpartaNav()
  const controlFilter = nav.tabFilters.QRAs?.controlId
  const qraKeyFilter = nav.tabFilters.QRAs?.qraKey
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")

  // Source filter (v2 vs legacy collections) - must be declared before useQRAs
  const [source, setSource] = useState<QRASource>('legacy')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 500)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const { data: qras = [], loading, error } = useQRAs(debouncedSearch, controlFilter, source)
  const [currentIndex, setCurrentIndex] = useState(0)

  // Reset index when filter changes, or auto-select by qraKey
  useEffect(() => {
    if (qraKeyFilter && qras.length > 0) {
      const idx = qras.findIndex(q => q._key === qraKeyFilter)
      setCurrentIndex(idx >= 0 ? idx : 0)
    } else {
      setCurrentIndex(0)
    }
  }, [controlFilter, debouncedSearch, qraKeyFilter, qras, source])
  const [decisions, setDecisions] = useState<Map<string, 'accept' | 'reject'>>(new Map())
  const [undoTimer, setUndoTimer] = useState<{ key: string; timer: number } | null>(null)

  // Edit mode state
  const [isEditing, setIsEditing] = useState(false)
  const [editData, setEditData] = useState<{ question: string; answer: string; reasoning: string; evidence: string }>({ question: '', answer: '', reasoning: '', evidence: '' })

  // MIND category filter
  const [mindFilter, setMindFilter] = useState<string | null>(null)
  const MIND_TAGS = ['Detect', 'Harden', 'Isolate', 'Recover', 'Respond', 'Design']

  // Resizable / Collapsible State
  const [leftWidth, setLeftWidth] = useState(280)
  const [rightWidth, setRightWidth] = useState(500)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [hoveredQra, setHoveredQra] = useState<string | null>(null)

  // Batch info modal
  const [showBatchModal, setShowBatchModal] = useState(false)
  // Collapsible reasoning
  const [reasoningExpanded, setReasoningExpanded] = useState(false)
  const [entityViewMode, setEntityViewMode] = useState<EntityViewMode>(loadEntityViewMode)

  const current = qras[currentIndex] as SpartaQRA | undefined
  const minHighlightEmphasis = minEmphasisForMode(entityViewMode)
  const currentEvidenceOutcome = deriveEvidenceOutcome(current)
  const currentEvidenceSummary = evidenceSummaryLine(current)

  const [fallbackHighlights, setFallbackHighlights] = useState<Map<string, { spans: Span[]; glossary: GlossaryEntryLike[] }>>(new Map())

  const activeHighlight = current ? fallbackHighlights.get(current._key) : undefined
  const storedSpans = Array.isArray(current?.evidence_case?.spans)
    ? (current!.evidence_case!.spans as Span[])
    : []
  const storedGlossary = Array.isArray(current?.evidence_case?.glossary)
    ? (current!.evidence_case!.glossary as GlossaryEntryLike[])
    : []
  const questionSpans = storedSpans.length > 0 ? storedSpans : (activeHighlight?.spans ?? [])
  const questionGlossary = storedGlossary.length > 0 ? storedGlossary : (activeHighlight?.glossary ?? [])

  useRegisterAction('qras:action:accept', { app: 'sparta-explorer', action: 'ACCEPT_QRA', label: 'Accept QRA', description: 'Mark the current QRA as accepted' })
  useRegisterAction('qras:action:reject', { app: 'sparta-explorer', action: 'REJECT_QRA', label: 'Reject QRA', description: 'Mark the current QRA as rejected' })
  useRegisterAction('qras:action:undo', { app: 'sparta-explorer', action: 'UNDO_DECISION', label: 'Undo Decision', description: 'Undo the last accept/reject decision' })
  useRegisterAction('qras:filter:clear', { app: 'sparta-explorer', action: 'CLEAR_TAB_FILTER', label: 'Clear Filter', description: 'Remove the control filter from QRA view' })
  useRegisterAction('qras:action:edit', { app: 'sparta-explorer', action: 'EDIT_QRA', label: 'Edit QRA', description: 'Edit the current QRA' })
  useRegisterAction('qras:action:toggle_evidence', { app: 'sparta-explorer', action: 'TOGGLE_EVIDENCE', label: 'Toggle Evidence', description: 'View the evidence pane for the selected QRA' })
  useRegisterAction('qras:action:toggle_hmn', { app: 'sparta-explorer', action: 'TOGGLE_HMN', label: 'Toggle Human', description: 'View human review status for QRA' })
  useRegisterAction('qras:display:entity-anchors', { app: 'sparta-explorer', action: 'SET_ENTITY_VIEW_ANCHORS', label: 'Entity View Anchors', description: 'Show only primary entities in the QRA panes' })
  useRegisterAction('qras:display:entity-context', { app: 'sparta-explorer', action: 'SET_ENTITY_VIEW_CONTEXT', label: 'Entity View Context', description: 'Show primary entities plus contextual phrase entities in the QRA panes' })
  useRegisterAction('qras:display:entity-full', { app: 'sparta-explorer', action: 'SET_ENTITY_VIEW_FULL', label: 'Entity View Full', description: 'Show the full extracted entity set in the QRA panes' })

  useEffect(() => {
    saveEntityViewMode(entityViewMode)
  }, [entityViewMode])

  // when current changes, reset edit data
  useEffect(() => {
    if (current) {
      setEditData({ question: current.question || '', answer: current.answer || '', reasoning: current.reasoning || '', evidence: current.evidence || '' })
      setIsEditing(false)
    }
  }, [current])


  useEffect(() => {
    if (!current?._key || !current.question) return
    const hasStoredSpans = Array.isArray(current.evidence_case?.spans) && current.evidence_case.spans.length > 0
    const hasStoredGlossary = Array.isArray(current.evidence_case?.glossary) && current.evidence_case.glossary.length > 0
    if (hasStoredSpans && hasStoredGlossary) return
    if (fallbackHighlights.has(current._key)) return

    let cancelled = false
    fetch('http://localhost:3001/api/extract-entities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: current.question }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return
        const spans = Array.isArray(data?.spans)
          ? (data.spans as Span[]).filter((sp) => Array.isArray(sp?.span) && sp.span.length === 2)
          : []

        const ids = Array.isArray(data?.control_ids) ? (data.control_ids as string[]) : []
        const metadata = Array.isArray(data?.control_metadata) ? data.control_metadata : []
        const entities = Array.isArray(data?.entities) ? data.entities : []

        const glossaryMap = new Map<string, GlossaryEntryLike>()

        ids.forEach((cid: string, idx: number) => {
          if (!cid || typeof cid !== 'string') return
          const meta = metadata[idx] ?? {}
          glossaryMap.set(cid, {
            id: cid,
            name: typeof meta?.name === 'string' && meta.name.trim() ? meta.name : cid,
            framework: typeof meta?.framework === 'string' && meta.framework.trim() ? meta.framework : 'SPARTA',
            description: typeof meta?.description === 'string' ? meta.description : undefined,
            source: typeof meta?.source === 'string' ? meta.source : '/extract-entities',
          })
        })

        entities.forEach((entity: any) => {
          const id = typeof entity?.id === 'string' ? entity.id.trim() : ''
          if (!id || glossaryMap.has(id)) return
          glossaryMap.set(id, {
            id,
            name: typeof entity?.name === 'string' && entity.name.trim() ? entity.name : id,
            framework: typeof entity?.framework === 'string' && entity.framework.trim() ? entity.framework : 'SPARTA',
            source: '/extract-entities',
          })
        })

        const glossaryFromApi: GlossaryEntryLike[] = Array.from(glossaryMap.values())

        if (spans.length === 0 && glossaryFromApi.length === 0) return
        setFallbackHighlights((prev) => {
          if (prev.has(current._key)) return prev
          const next = new Map(prev)
          next.set(current._key, { spans, glossary: glossaryFromApi })
          return next
        })
      })
      .catch(() => { /* no-op: highlighting falls back to regex */ })

    return () => {
      cancelled = true
    }
  }, [current, fallbackHighlights])

  const advance = useCallback((dir: number) => {
    setIsEditing(false)
    setCurrentIndex((i) => Math.max(0, Math.min(qras.length - 1, i + dir)))
  }, [qras.length])

  const handleDecision = useCallback((decision: 'accept' | 'reject') => {
    if (!current) return
    const key = current._key
    setDecisions((prev) => new Map(prev).set(key, decision))

    const grade = decision === 'accept' ? 'PASS' : 'FAIL'
    fetch('http://localhost:3001/api/memory/learn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: 'sparta_qra',
        problem: current.question,
        solution: current.answer,
        metadata: {
          _key: key,
          control_id: current.control_id,
          grade,
          reviewed_by: 'brandon',
          reviewed_at: new Date().toISOString(),
        },
      }),
    }).catch(() => {/* silent — undo handles recovery */})

    if (undoTimer) clearTimeout(undoTimer.timer)
    const timer = window.setTimeout(() => setUndoTimer(null), 10_000)
    setUndoTimer({ key, timer })

    advance(1)
  }, [current, undoTimer, advance])

  const handleEditSave = useCallback(() => {
    if (!current) return
    setIsEditing(false)
    // Post edit modifications to the backend
    fetch('http://localhost:3001/api/memory/learn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        collection: 'sparta_qra',
        problem: editData.question,
        solution: editData.answer,
        metadata: { 
          _key: current._key, 
          control_id: current.control_id, 
          reasoning: editData.reasoning, 
          edited: true, 
          reviewed_by: 'brandon', 
          reviewed_at: new Date().toISOString() 
        },
      }),
    }).catch(() => {})
  }, [current, editData])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (!current) return
      if (!isEditing) {
        if (e.key === 'a' || e.key === 'A' || e.key === '1') { e.preventDefault(); handleDecision('accept'); }
        if (e.key === 'r' || e.key === 'R' || e.key === '2') { e.preventDefault(); handleDecision('reject'); }
        if (e.key === 'e' || e.key === 'E' || e.key === '3') { e.preventDefault(); setIsEditing(true); }
        if (e.key === 'ArrowRight' || e.key === 'j') { e.preventDefault(); advance(1); }
        if (e.key === 'ArrowLeft' || e.key === 'k') { e.preventDefault(); advance(-1); }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [current, handleDecision, advance, isEditing])

  function undoLast() {
    if (!undoTimer) return
    clearTimeout(undoTimer.timer)
    setDecisions((prev) => {
      const next = new Map(prev)
      next.delete(undoTimer.key)
      return next
    })
    setUndoTimer(null)
    advance(-1)
  }

  if (error) {
    return <div style={{ padding: 20, color: EMBRY.red, border: `1px solid ${EMBRY.red}33`, borderRadius: 8, margin: 16 }}>Error: {error}</div>
  }

  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0, backgroundColor: EMBRY.bgDeep }}>
        <div style={{ fontSize: 14, fontWeight: 900, color: EMBRY.white, letterSpacing: 1 }}>QRA REVIEW</div>
        <div style={{ ...label, backgroundColor: EMBRY.bgPanel, padding: '4px 8px', borderRadius: 4 }}>
          {qras.length - currentIndex} Remaining
        </div>
        
        {controlFilter && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', backgroundColor: `${EMBRY.accent}12`, borderRadius: 4, border: `1px solid ${EMBRY.accent}33`, marginLeft: 16 }}>
            <span style={{ fontSize: 10, color: EMBRY.accent }}>Filtered: {controlFilter}</span>
            <button data-qid="qras:filter:clear" data-qs-action="CLEAR_TAB_FILTER" onClick={() => nav.clearTabFilter('QRAs')} title="Clear QRA filter" style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', fontSize: 12 }}>×</button>
          </div>
        )}

        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: EMBRY.dim }}>
          [1/A] Accept • [2/R] Reject • [3/E] Edit | ←→ Navigate
        </span>
        
        {undoTimer && (
          <button data-qid="qras:action:undo" onClick={undoLast} data-qs-action="UNDO_DECISION" title="Undo last decision" style={{
            fontSize: 10, padding: '4px 12px', borderRadius: 4, cursor: 'pointer',
            border: `1px solid ${EMBRY.amber}44`, backgroundColor: `${EMBRY.amber}12`, color: EMBRY.amber,
          }}>
            Undo (10s)
          </button>
        )}
      </div>

      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* LEFT PANE */}
        <div style={{ 
          width: leftCollapsed ? 56 : leftWidth, 
          display: 'flex', 
          flexDirection: 'column', 
          backgroundColor: EMBRY.bgDeep, 
          flexShrink: 0, 
          borderRight: `1px solid ${EMBRY.border}`,
          transition: 'width 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
        }}>
           {leftCollapsed ? (
             <div style={{ padding: '16px 0', display: 'flex', justifyContent: 'center' }}>
               <button title="Expand Left Panel" onClick={() => setLeftCollapsed(false)} style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', padding: 8, borderRadius: 6, transition: 'background-color 0.2s', ':hover': { backgroundColor: EMBRY.bgPanel } } as any}>
                 <PanelLeft size={20} />
               </button>
             </div>
           ) : (
             <>
               <div style={{ padding: '12px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', gap: 12 }}>
                 <div style={{ position: 'relative', flex: 1 }}>
                    <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: EMBRY.dim }} />
                    <input
                      data-qid="qras:search"
                      data-qs-action="SEARCH_QRAS"
                      title="Filter QRAs by question text"
                      type="text"
                      placeholder="Filter..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      style={{
                        width: '100%', padding: '8px 12px 8px 32px', backgroundColor: `${EMBRY.bg}80`,
                        border: `1px solid ${EMBRY.border}`, borderRadius: 6, color: EMBRY.white,
                        fontSize: 12, outline: 'none'
                      }}
                    />
                 </div>
                 <button title="Collapse Left Panel" onClick={() => setLeftCollapsed(true)} style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', padding: 6, borderRadius: 6, transition: 'background-color 0.2s', ':hover': { backgroundColor: EMBRY.bgPanel } } as any}>
                   <PanelLeftClose size={18} />
                 </button>
               </div>

               {/* Source Filter (v2 vs legacy) */}
               <div style={{ padding: '8px 12px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                 <span style={{ fontSize: 9, fontWeight: 600, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 0.5 }}>Source:</span>
                 <div style={{ display: 'flex', gap: 2, backgroundColor: `${EMBRY.bg}60`, borderRadius: 4, padding: 2 }}>
                   {(['legacy', 'v2', 'all'] as QRASource[]).map(s => {
                     const isActive = source === s
                     const label = s === 'v2' ? 'v2' : s === 'legacy' ? 'Legacy' : 'All'
                     return (
                       <button
                         key={s}
                         onClick={() => setSource(s)}
                         style={{
                           fontSize: 9, fontWeight: 600, padding: '4px 10px', borderRadius: 3,
                           minHeight: 44, minWidth: 44,
                           border: 'none',
                           backgroundColor: isActive ? EMBRY.accent : 'transparent',
                           color: isActive ? EMBRY.white : EMBRY.dim,
                           cursor: 'pointer', transition: 'all 0.15s',
                         }}
                       >
                         {label}
                       </button>
                     )
                   })}
                 </div>
               </div>

               {/* MIND Category Filter */}
               <div style={{ padding: '8px 12px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                 {MIND_TAGS.map(tag => {
                   const isActive = mindFilter === tag
                   return (
                     <button
                       key={tag}
                       data-qid={`qras:filter:mind:${tag}`}
                       data-qs-action="FILTER_MIND"
                       title={`Filter by ${tag} category`}
                       onClick={() => setMindFilter(isActive ? null : tag)}
                       style={{
                         fontSize: 9, fontWeight: 600, padding: '3px 8px', borderRadius: 4,
                         minHeight: 44, minWidth: 44,
                         border: `1px solid ${isActive ? EMBRY.accent : EMBRY.border}`,
                         backgroundColor: isActive ? `${EMBRY.accent}20` : 'transparent',
                         color: isActive ? EMBRY.accent : EMBRY.dim,
                         cursor: 'pointer', transition: 'all 0.15s',
                       }}
                     >
                       {tag}
                     </button>
                   )
                 })}
               </div>

               <div style={{ flex: 1, overflowY: 'auto' }}>
                  {loading && <div style={{ padding: 16, color: EMBRY.dim, fontSize: 12 }}>Loading QRAs...</div>}
                  {qras.map((q, idx) => ({ q, idx })).filter(({ q }) => !mindFilter || (q.mind && q.mind.includes(mindFilter))).map(({ q, idx }) => {
                     const isActive = idx === currentIndex
                     
                     return (
                        <div key={q._key} 
                          onMouseEnter={() => setHoveredQra(q._key)}
                          onMouseLeave={() => setHoveredQra(null)}
                          onClick={() => setCurrentIndex(idx)}
                          style={{
                            padding: '10px 12px',
                            borderBottom: `1px solid ${EMBRY.border}`,
                            backgroundColor: isActive ? 'rgba(124, 58, 237, 0.15)' : (hoveredQra === q._key ? 'rgba(255,255,255,0.03)' : 'transparent'),
                            cursor: 'pointer',
                            position: 'relative',
                            transition: 'all 0.2s',
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                               {statusBadges(q, (e) => {
                                 e.stopPropagation()
                                 setCurrentIndex(idx)
                                 setRightCollapsed(false)
                               })}
                            </div>
                           <div style={{ 
                             fontSize: 12, color: isActive ? EMBRY.white : `${EMBRY.white}BB`, 
                             whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', 
                             fontWeight: isActive ? 600 : 400 
                           }}>
                              <><div style={{ fontSize: 10, fontFamily: 'monospace', color: EMBRY.accent, marginBottom: 2 }}>{q.control_id}</div>{q.question}</>
                           </div>

                            {/* Rich hover tooltip — Only render if exactly this item is hovered */}
                            {hoveredQra === q._key && (
                              <div style={{ 
                                position: 'absolute', left: '100%', top: 0, width: 340, zIndex: 1000,
                                backgroundColor: '#111', border: `1px solid #333`,
                                borderRadius: 8, padding: 16, borderLeft: `4px solid ${EMBRY.accent}`,
                                boxShadow: '0 12px 32px rgba(0,0,0,0.7)', pointerEvents: 'none', marginLeft: 12
                              }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                                  <div style={{ fontSize: 9, fontFamily: 'monospace', color: EMBRY.accent, fontWeight: 700 }}>{q.control_id}</div>
                                  <div style={{ fontSize: 10, color: EMBRY.dim }}>{q.source_framework || 'SPARTA'}</div>
                                </div>
                                <div style={{ fontSize: 13, fontWeight: 600, color: EMBRY.white, lineHeight: 1.5 }}>
                                  <><div style={{ fontSize: 10, fontFamily: 'monospace', color: EMBRY.accent, marginBottom: 2 }}>{q.control_id}</div>{q.question}</>
                                </div>
                                <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid #222`, display: 'flex', gap: 12 }}>
                                   <div style={{ fontSize: 10, color: EMBRY.dim }}>Click to inspect reasoning & answer</div>
                                </div>
                              </div>
                            )}
                        </div>
                     )
                  })}
               </div>
             </>
           )}
        </div>

        {/* LEFT RESIZER */}
        {!leftCollapsed && (
           <div 
             style={{ width: 4, cursor: 'col-resize', backgroundColor: 'transparent', zIndex: 10, flexShrink: 0, marginLeft: -2, marginRight: -2 }}
             onMouseDown={(e) => {
               e.preventDefault()
               const startX = e.clientX
               const startWidth = leftWidth
               const onMouseMove = (moveEvent: MouseEvent) => setLeftWidth(Math.max(200, Math.min(600, startWidth + (moveEvent.clientX - startX))))
               const onMouseUp = () => { document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp) }
               document.addEventListener('mousemove', onMouseMove)
               document.addEventListener('mouseup', onMouseUp)
             }}
           />
        )}

        {/* CENTER PANE: Annotator */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: EMBRY.bgPanel, position: 'relative' }}>
           {!current ? (
             <div style={{ color: EMBRY.dim, padding: 40, textAlign: 'center', margin: 'auto' }}>No QRAs to display. Select an item from the queue.</div>
           ) : (
             <>
                {/* Header Strip */}
                <div style={{ padding: '12px 24px', backgroundColor: EMBRY.bgDeep, borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap', gap: 12 }}>
                   <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                     <span style={{ fontSize: 10, fontWeight: 700, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 1 }}>Current QRA</span>
                     <span style={{ fontSize: 12, fontFamily: 'monospace', color: EMBRY.accent, backgroundColor: `${EMBRY.accent}15`, padding: '4px 8px', borderRadius: 4, border: `1px solid ${EMBRY.accent}33` }}>{current.control_id}</span>
                     <span
                       title="Click to copy _key"
                       onClick={() => navigator.clipboard.writeText(current._key)}
                       style={{ fontSize: 10, fontFamily: 'monospace', color: EMBRY.dim, cursor: 'pointer', padding: '2px 6px', borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.05)' }}
                     >
                       {compactKey(current._key)}
                     </span>
                   </div>
                   <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 2, borderRadius: 6, backgroundColor: `${EMBRY.bg}66`, border: `1px solid ${EMBRY.border}` }}>
                        <span style={{ fontSize: 9, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 0.6, paddingLeft: 6 }}>Entities</span>
                        {ENTITY_VIEW_OPTIONS.map((option) => {
                          const isActive = entityViewMode === option.mode
                          const action = option.mode === 'anchors'
                            ? 'SET_ENTITY_VIEW_ANCHORS'
                            : option.mode === 'context'
                              ? 'SET_ENTITY_VIEW_CONTEXT'
                              : 'SET_ENTITY_VIEW_FULL'
                          return (
                            <button
                              key={option.mode}
                              data-qid={`qras:display:entity-${option.mode}`}
                              data-qs-action={action}
                              title={option.title}
                              onClick={() => setEntityViewMode(option.mode)}
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: '5px 8px',
                                borderRadius: 4,
                                border: 'none',
                                backgroundColor: isActive ? `${EMBRY.accent}22` : 'transparent',
                                color: isActive ? EMBRY.accent : EMBRY.dim,
                                cursor: 'pointer',
                              }}
                            >
                              {option.label}
                            </button>
                          )
                        })}
                      </div>
                      {/* Batch info button */}
                      {current.run_id && (
                        <button
                          onClick={() => setShowBatchModal(true)}
                          title={`View batch: ${current.run_id}`}
                          style={{
                            background: 'none', border: `1px solid ${EMBRY.border}`, borderRadius: 4,
                            padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                            color: EMBRY.dim, transition: 'all 0.15s',
                          }}
                          onMouseEnter={e => { e.currentTarget.style.borderColor = EMBRY.accent; e.currentTarget.style.color = EMBRY.accent }}
                          onMouseLeave={e => { e.currentTarget.style.borderColor = EMBRY.border; e.currentTarget.style.color = EMBRY.dim }}
                        >
                          <Layers size={12} />
                          <span style={{ fontSize: 9, fontFamily: 'monospace' }}>
                            {qras.filter(q => q.run_id === current.run_id).length}
                          </span>
                        </button>
                      )}
                      {current.mind && current.mind.map(tag => (
                        <span key={tag} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, backgroundColor: `${EMBRY.accent}15`, color: EMBRY.accent }}>{tag}</span>
                      ))}
                   </div>
                </div>

                {/* SCROLLABLE QRA CONTENT */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 60px', display: 'flex', flexDirection: 'column' }}>
                   {isEditing ? (
                           <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                              <div>
                                 <label style={{ ...label, marginBottom: 6, display: 'block' }}>Question</label>
                                 <textarea 
                                   value={editData.question} onChange={e => setEditData(d => ({ ...d, question: e.target.value }))}
                                   style={{ width: '100%', minHeight: 80, padding: 12, backgroundColor: EMBRY.bgDeep, border: `1px solid ${EMBRY.accent}`, borderRadius: 8, color: EMBRY.white, fontSize: 15, outline: 'none', lineHeight: 1.5 }}
                                 />
                              </div>
                              <div>
                                 <label style={{ ...label, marginBottom: 6, display: 'block' }}>Answer</label>
                                 <textarea 
                                   value={editData.answer} onChange={e => setEditData(d => ({ ...d, answer: e.target.value }))}
                                   style={{ width: '100%', minHeight: 120, padding: 12, backgroundColor: EMBRY.bgDeep, border: `1px solid ${EMBRY.accent}`, borderRadius: 8, color: EMBRY.white, fontSize: 14, outline: 'none', lineHeight: 1.6 }}
                                 />
                              </div>
                              <div>
                                 <label style={{ ...label, marginBottom: 6, display: 'block' }}>Reasoning</label>
                                 <textarea 
                                   value={editData.reasoning} onChange={e => setEditData(d => ({ ...d, reasoning: e.target.value }))}
                                   style={{ width: '100%', minHeight: 100, padding: 12, backgroundColor: EMBRY.bgDeep, border: `1px solid ${EMBRY.border}`, borderRadius: 8, color: EMBRY.dim, fontSize: 13, outline: 'none', lineHeight: 1.5 }}
                                 />
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 4 }}>
                                 <button onClick={() => setIsEditing(false)} style={{ padding: '8px 20px', borderRadius: 8, backgroundColor: 'transparent', border: `1px solid ${EMBRY.dim}`, color: EMBRY.dim, cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
                                 <button onClick={handleEditSave} style={{ padding: '8px 24px', borderRadius: 8, backgroundColor: EMBRY.accent, border: 'none', color: EMBRY.white, cursor: 'pointer', fontWeight: 700 }}>Save Changes</button>
                              </div>
                           </div>
                         ) : (
                           <>
                               <div style={{ marginBottom: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
                                 <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                                   <div style={{ display: 'flex', gap: 10, flex: 1, minWidth: 0 }}>
                                     <currentEvidenceOutcome.Icon size={18} color={currentEvidenceOutcome.color} style={{ flexShrink: 0, marginTop: 2 }} />
                                     <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
                                       <div style={{ fontSize: 10, color: EMBRY.dim, letterSpacing: 1, textTransform: 'uppercase' }}>Question</div>
                                       <div style={{ ...body, fontSize: 15, fontWeight: 500, color: EMBRY.white, lineHeight: 1.7, padding: '4px 0' }}>
                                         {questionSpans.length > 0
                                           ? spanHighlight(editData.question, questionSpans, questionGlossary, { minEmphasis: minHighlightEmphasis })
                                           : inlineHighlight(editData.question, questionGlossary, { minEmphasis: minHighlightEmphasis })}
                                       </div>
                                     </div>
                                   </div>
                                   <span
                                     title={currentEvidenceOutcome.label}
                                     style={{
                                       flexShrink: 0,
                                       display: 'inline-flex',
                                       alignItems: 'center',
                                       gap: 6,
                                       padding: '5px 8px',
                                       borderRadius: 999,
                                       backgroundColor: `${currentEvidenceOutcome.color}16`,
                                       border: `1px solid ${currentEvidenceOutcome.color}33`,
                                       color: currentEvidenceOutcome.color,
                                       fontSize: 9,
                                       fontWeight: 700,
                                       textTransform: 'uppercase',
                                       letterSpacing: 0.8,
                                     }}
                                   >
                                     <currentEvidenceOutcome.Icon size={11} />
                                     {currentEvidenceOutcome.shortLabel}
                                   </span>
                                 </div>
                                 <div style={{
                                   fontSize: 10,
                                   color: EMBRY.dim,
                                   lineHeight: 1.5,
                                   padding: '8px 10px',
                                   borderRadius: 6,
                                   backgroundColor: 'rgba(255,255,255,0.03)',
                                   border: `1px solid ${EMBRY.border}`,
                                 }}>
                                   {currentEvidenceSummary}
                                 </div>
                               </div>
                               <div style={{ ...label, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1, fontSize: 10 }}>Answer</div>
                               <div style={{ ...body, fontSize: 13, color: `${EMBRY.white}E8`, lineHeight: 1.65 }}>
                                 <AnswerDisplay text={editData.answer} glossary={current?.evidence_case?.glossary ?? []} minEmphasis={minHighlightEmphasis} />
                               </div>

                              {editData.reasoning && editData.reasoning.trim().length > 0 && (
                                <div style={{ marginBottom: 16 }}>
                                  <button
                                    onClick={() => setReasoningExpanded(!reasoningExpanded)}
                                    style={{
                                      display: 'flex', alignItems: 'center', gap: 6, background: 'none', border: 'none',
                                      cursor: 'pointer', padding: 0, marginBottom: reasoningExpanded ? 8 : 0,
                                    }}
                                  >
                                    {reasoningExpanded ? <ChevronDown size={14} color={EMBRY.dim} /> : <ChevronRight size={14} color={EMBRY.dim} />}
                                    <span style={{ ...label, textTransform: 'uppercase', letterSpacing: 1, fontSize: 10 }}>Reasoning</span>
                                    {!reasoningExpanded && (
                                      <span style={{ fontSize: 10, color: EMBRY.dim, fontStyle: 'italic', marginLeft: 8 }}>
                                        ({editData.reasoning.split('\n').length} lines)
                                      </span>
                                    )}
                                  </button>
                                  {reasoningExpanded && (
                                    <div style={{
                                      fontSize: 12, color: EMBRY.dim, backgroundColor: 'rgba(0,0,0,0.3)',
                                      padding: 12, borderRadius: 8, border: `1px solid ${EMBRY.border}`, lineHeight: 1.6,
                                    }}>
                                      <MarkdownRenderer content={editData.reasoning} />
                                    </div>
                                  )}
                                </div>
                              )}

                              {editData.evidence && editData.evidence.trim().length > 0 && (
                                <>
                                  <div style={{ ...label, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1, fontSize: 10 }}>Evidence</div>
                                  <div style={{ ...body, fontSize: 13, color: '#e2e8f0', backgroundColor: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 8, border: `1px solid ${EMBRY.border}`, lineHeight: 1.6, marginBottom: 16 }}>
                                    {editData.evidence}
                                  </div>
                                </>
                              )}

                           </>
                   )}
                </div>
             </>
           )}

           {/* Action Bar */}
           {current && !isEditing && (
              <div style={{ 
                position: 'absolute', bottom: 0, left: 0, right: 0, 
                padding: '8px 24px', borderTop: `1px solid ${EMBRY.border}`, backgroundColor: EMBRY.bgDeep,
                display: 'flex', justifyContent: 'center', pointerEvents: 'auto'
              }}>
                 <div style={{ display: 'flex', gap: 12 }}>
                    <button data-qid="qras:action:accept" data-qs-action="ACCEPT_QRA" title="Accept QRA" onClick={() => handleDecision('accept')} style={{ ...prodigyBtn(EMBRY.green) }}>
                       <CheckCircle2 size={14} />
                       <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2 }}>ACCEPT</span>
                       <span style={{ fontSize: 9, opacity: 0.6 }}>[A]</span>
                    </button>
                    <button data-qid="qras:action:reject" data-qs-action="REJECT_QRA" title="Reject QRA" onClick={() => handleDecision('reject')} style={{ ...prodigyBtn(EMBRY.red) }}>
                       <XCircle size={14} />
                       <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.2 }}>REJECT</span>
                       <span style={{ fontSize: 9, opacity: 0.6 }}>[R]</span>
                    </button>
                    <button data-qid="qras:action:edit" data-qs-action="EDIT_QRA" title="Edit QRA" onClick={() => setIsEditing(true)} style={{ ...prodigyBtn(EMBRY.dim) }}>
                       <FileText size={18} />
                       <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1 }}>EDIT</span>
                       <span style={{ fontSize: 10, opacity: 0.6 }}>[E]</span>
                    </button>
                 </div>
              </div>
           )}
        </div>

        {/* RIGHT RESIZER */}
        {!rightCollapsed && (
           <div 
             style={{ width: 4, cursor: 'col-resize', backgroundColor: 'transparent', zIndex: 10, flexShrink: 0, marginLeft: -2, marginRight: -2 }}
             onMouseDown={(e) => {
               e.preventDefault()
               const startX = e.clientX
               const startWidth = rightWidth
               const onMouseMove = (moveEvent: MouseEvent) => setRightWidth(Math.max(300, Math.min(1000, startWidth - (moveEvent.clientX - startX))))
               const onMouseUp = () => { document.removeEventListener('mousemove', onMouseMove); document.removeEventListener('mouseup', onMouseUp) }
               document.addEventListener('mousemove', onMouseMove)
               document.addEventListener('mouseup', onMouseUp)
             }}
           />
        )}

        {/* RIGHT PANE */}
        <div style={{ 
          width: rightCollapsed ? 56 : rightWidth, 
          display: 'flex', 
          flexDirection: 'column', 
          backgroundColor: EMBRY.bgDeep, 
          flexShrink: 0,
          borderLeft: `1px solid ${EMBRY.border}`,
          transition: 'width 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
        }}>
           {rightCollapsed ? (
             <div style={{ padding: '16px 0', display: 'flex', justifyContent: 'center' }}>
               <button title="Expand Right Panel" onClick={() => setRightCollapsed(false)} style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', padding: 8, borderRadius: 6, transition: 'background-color 0.2s', ':hover': { backgroundColor: EMBRY.bgPanel } } as any}>
                 <PanelRight size={20} />
               </button>
             </div>
           ) : (
             <>
               <div style={{ padding: '12px 16px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                 <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: EMBRY.dim, textTransform: 'uppercase' }}>Evidence Context</span>
                 <button title="Collapse Right Panel" onClick={() => setRightCollapsed(true)} style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', padding: 6, borderRadius: 6, transition: 'background-color 0.2s', ':hover': { backgroundColor: EMBRY.bgPanel } } as any}>
                   <PanelRightClose size={18} />
                 </button>
               </div>
               <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                 {current ? (
                    <EvidenceView 
                      question={current.question} 
                      qraKey={current.qra_id || current._key} 
                      reasoning={current.reasoning}
                      answer={current.answer}
                      groundingScore={current.grounding_score}
                      storedEvidenceCase={current.evidence_case as any}
                      minHighlightEmphasis={minHighlightEmphasis}
                    />
                 ) : (
                   <div style={{ ...body, padding: 40, color: EMBRY.dim, textAlign: 'center' }}>
                     Select a QRA to view trace evidence
                   </div>
                 )}
               </div>
             </>
           )}
        </div>
      </div>

      {/* Batch Info Modal */}
      {showBatchModal && current?.run_id && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999,
          backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setShowBatchModal(false)}>
          <div style={{
            width: 520, maxHeight: '80vh', backgroundColor: EMBRY.bgPanel,
            border: `1px solid ${EMBRY.border}`, borderRadius: 12, overflow: 'hidden',
            boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
          }} onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div style={{
              padding: '16px 20px', borderBottom: `1px solid ${EMBRY.border}`,
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              backgroundColor: EMBRY.bgDeep,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Layers size={18} color={EMBRY.accent} />
                <span style={{ fontSize: 13, fontWeight: 700, color: EMBRY.white }}>Batch Information</span>
              </div>
              <button onClick={() => setShowBatchModal(false)} style={{
                background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', padding: 4,
              }}>
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '16px 20px', overflowY: 'auto', maxHeight: 'calc(80vh - 60px)' }}>
              {/* Run ID */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ ...label, fontSize: 9, marginBottom: 4 }}>RUN ID</div>
                <div style={{
                  fontFamily: 'monospace', fontSize: 11, color: EMBRY.accent,
                  backgroundColor: `${EMBRY.accent}10`, padding: '8px 12px', borderRadius: 6,
                  border: `1px solid ${EMBRY.accent}30`, wordBreak: 'break-all',
                }}>
                  {current.run_id}
                </div>
              </div>

              {/* Timestamp extracted from run_id */}
              {(() => {
                const match = current.run_id?.match(/_(\d+)$/)
                if (!match) return null
                const ts = parseInt(match[1], 10)
                const date = new Date(ts)
                return (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ ...label, fontSize: 9, marginBottom: 4 }}>GENERATED AT</div>
                    <div style={{ fontSize: 12, color: EMBRY.dim }}>
                      {date.toLocaleDateString()} {date.toLocaleTimeString()}
                    </div>
                  </div>
                )
              })()}

              {/* Relationship ID if present */}
              {current.relationship_id && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ ...label, fontSize: 9, marginBottom: 4 }}>RELATIONSHIP ID</div>
                  <div style={{
                    fontFamily: 'monospace', fontSize: 11, color: EMBRY.green,
                    backgroundColor: `${EMBRY.green}10`, padding: '8px 12px', borderRadius: 6,
                    border: `1px solid ${EMBRY.green}30`,
                  }}>
                    {current.relationship_id}
                  </div>
                </div>
              )}

              {/* Related QRAs */}
              <div style={{ marginTop: 20 }}>
                <div style={{ ...label, fontSize: 9, marginBottom: 8 }}>
                  QRAs IN THIS BATCH ({qras.filter(q => q.run_id === current.run_id).length})
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {qras.filter(q => q.run_id === current.run_id).map((q, i) => {
                    const isCurrent = q._key === current._key
                    const qraIndex = qras.findIndex(qq => qq._key === q._key)
                    return (
                      <div
                        key={q._key}
                        onClick={() => {
                          setCurrentIndex(qraIndex)
                          setShowBatchModal(false)
                        }}
                        style={{
                          padding: '10px 12px', borderRadius: 6, cursor: 'pointer',
                          backgroundColor: isCurrent ? `${EMBRY.accent}15` : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${isCurrent ? EMBRY.accent : EMBRY.border}`,
                          transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => { if (!isCurrent) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.06)' }}
                        onMouseLeave={e => { if (!isCurrent) e.currentTarget.style.backgroundColor = 'rgba(255,255,255,0.03)' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontSize: 10, fontFamily: 'monospace', color: EMBRY.accent, fontWeight: 600 }}>
                            {q.control_id}
                          </span>
                          {isCurrent && (
                            <span style={{ fontSize: 8, padding: '2px 6px', borderRadius: 4, backgroundColor: EMBRY.accent, color: EMBRY.bgDeep, fontWeight: 700 }}>
                              CURRENT
                            </span>
                          )}
                        </div>
                        <div style={{
                          fontSize: 11, color: isCurrent ? EMBRY.white : EMBRY.dim,
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          <><div style={{ fontSize: 10, fontFamily: 'monospace', color: EMBRY.accent, marginBottom: 2 }}>{q.control_id}</div>{q.question}</>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

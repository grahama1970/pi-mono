import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { EMBRY, label } from '../common/EmbryStyle'
import { qraDetailPost, useQRAs } from '../../../hooks/useSpartaCollections'
import type { SpartaQRA, QRASource } from '../../../hooks/useSpartaCollections'
import { useSpartaNav } from './SpartaExplorer'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import { EvidenceView } from './EvidenceView'
import { Search, CheckCircle2, XCircle, PanelLeftClose, PanelLeft, Layers, X } from 'lucide-react'
import type { HighlightEmphasis } from './explorerUtils'

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

const PANE_PADDING = 16
type EvidenceFilter = 'all' | 'failed' | 'passed'

function deriveEvidenceStatus(q: SpartaQRA): EvidenceFilter {
  const verdict = (q.evidence_case?.verdict || '').trim().toLowerCase()
  if (verdict === 'satisfied' || verdict === 'pass' || verdict === 'passed') return 'passed'
  if (verdict === 'not_satisfied' || verdict === 'fail' || verdict === 'failed' || verdict === 'rejected') return 'failed'
  if (verdict === 'inconclusive' || verdict === 'auto' || verdict === 'qualified') return 'failed'
  if (q.evidence_case?.review_status === 'approved' || q.evidence_case?.formal_proof?.success) return 'passed'
  if (q.evidence_case?.review_status === 'rejected') return 'failed'
  if (q.evidence_case?.review_status === 'pending') return 'failed'
  return q.evidence_case ? 'failed' : 'failed'
}

function statusIndicators(q: SpartaQRA, onEvidenceClick?: (e: React.MouseEvent) => void): React.ReactNode {
  const status = deriveEvidenceStatus(q)
  const color = status === 'passed' ? EMBRY.green : EMBRY.red
  const glow = status === 'passed' ? `${EMBRY.green}33` : `${EMBRY.red}33`
  const title = status === 'passed'
    ? 'Evidence passed or was approved'
    : q.evidence_case
      ? 'Evidence failed or needs review'
      : 'No evidence case attached'

  return (
    <button
      type="button"
      data-qid="qras:action:toggle_evidence"
      data-qs-action="TOGGLE_EVIDENCE"
      aria-label="Evidence status"
      title={title}
      onClick={onEvidenceClick}
      className="press-scale"
      style={{
        width: 32,
        height: 32,
        padding: 0,
        borderRadius: '50%',
        color,
        backgroundColor: 'transparent',
        border: `1px solid ${glow}`,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: onEvidenceClick ? 'pointer' : 'default',
        flexShrink: 0,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: color, boxShadow: status === 'passed' ? 'none' : `0 0 8px ${EMBRY.red}44` }} />
    </button>
  )
}

function decisionBtn(baseColor: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    height: 36, borderRadius: 6, cursor: 'pointer', transition: 'background-color 0.2s, border-color 0.2s, transform 0.15s', padding: '0 14px',
    border: `1px solid ${baseColor}33`, backgroundColor: 'transparent', color: baseColor,
  }
}

function compactKey(key: string, prefix = 24, suffix = 10): string {
  if (key.length <= prefix + suffix + 3) return key
  return `${key.slice(0, prefix)}...${key.slice(-suffix)}`
}

function buildRelatedQras(current: SpartaQRA | undefined, qras: SpartaQRA[]) {
  if (!current) return []
  const byKey = new Map(qras.map((entry) => [entry._key, entry]))
  const byQraId = new Map(qras.filter((entry) => Boolean(entry.qra_id)).map((entry) => [entry.qra_id as string, entry]))
  const explicitKeys = Array.from(new Set([
    ...(current.lineage?.upstream_qra_keys ?? []),
    ...(current.evidence_case?.prior_qra_evidence ?? []).map((entry) => entry._key).filter(Boolean) as string[],
    ...(current.evidence_case?.prior_qra_evidence ?? []).map((entry) => entry.qra_id).filter(Boolean) as string[],
  ]))
  const explicitMatches = explicitKeys
    .map((key) => byKey.get(key) || byQraId.get(key))
    .filter((candidate): candidate is SpartaQRA => Boolean(candidate) && candidate._key !== current._key)

  if (explicitMatches.length > 0) {
    return explicitMatches.slice(0, 4).map((candidate) => ({
      key: candidate._key,
      qraId: candidate.qra_id || candidate._key,
      controlId: candidate.control_id,
      source: candidate.source_framework || 'SPARTA',
      question: candidate.question,
      verdict: deriveEvidenceStatus(candidate),
    }))
  }

  return qras
    .filter((candidate) => {
      if (candidate._key === current._key) return false
      if (current.relationship_id && candidate.relationship_id) {
        return candidate.relationship_id === current.relationship_id
      }
      if (current.run_id && candidate.run_id === current.run_id) {
        return candidate.control_id === current.control_id
          || candidate.source_framework === current.source_framework
          || candidate.qra_type === current.qra_type
      }
      return false
    })
    .slice(0, 4)
    .map((candidate) => ({
      key: candidate._key,
      qraId: candidate.qra_id || candidate._key,
      controlId: candidate.control_id,
      source: candidate.source_framework || 'SPARTA',
      question: candidate.question,
      verdict: deriveEvidenceStatus(candidate),
    }))
}

// Sync selected QRA _key into URL hash params (e.g. #sparta-explorer/qras?qra=abc123)
function syncQraUrl(qraKey: string | undefined) {
  const hash = window.location.hash || ''
  const [pathPart] = hash.split('?')
  const sp = new URLSearchParams()
  if (qraKey) sp.set('qra', qraKey)
  const q = sp.toString()
  window.location.hash = q ? `${pathPart}?${q}` : pathPart
}

export function QRAsView() {
  const nav = useSpartaNav()
  const controlFilter = nav.tabFilters.QRAs?.controlId
  const qraKeyFilter = nav.tabFilters.QRAs?.qraKey
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedSearch, setDebouncedSearch] = useState("")

  // Source filter (v2 vs legacy collections) - must be declared before useQRAs
  const [source, setSource] = useState<QRASource>('legacy')
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>('all')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchQuery), 500)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const { data: qras = [], loading, error } = useQRAs(debouncedSearch, controlFilter, source)
  const [currentIndex, setCurrentIndexRaw] = useState(0)
  const [qraDetails, setQraDetails] = useState<Map<string, SpartaQRA>>(new Map())
  const [detailLoadingKey, setDetailLoadingKey] = useState<string | null>(null)

  // Wrapper that also syncs URL when selection changes
  const setCurrentIndex = useCallback((idx: number | ((prev: number) => number)) => {
    setCurrentIndexRaw((prev) => {
      const next = typeof idx === 'function' ? idx(prev) : idx
      const qra = qras[next]
      if (qra) syncQraUrl(qra._key)
      return next
    })
  }, [qras])

  // Reset index when filter changes, or auto-select by qraKey
  useEffect(() => {
    if (qraKeyFilter && qras.length > 0) {
      const idx = qras.findIndex(q => q._key === qraKeyFilter)
      setCurrentIndexRaw(idx >= 0 ? idx : 0)
    } else {
      setCurrentIndexRaw(0)
    }
  }, [controlFilter, debouncedSearch, qraKeyFilter, qras, source])
  const [decisions, setDecisions] = useState<Map<string, 'accept' | 'reject'>>(new Map())
  const [undoTimer, setUndoTimer] = useState<{ key: string; timer: number } | null>(null)

  // MIND category filter
  const [mindFilter, setMindFilter] = useState<string | null>(null)
  const MIND_TAGS = ['Detect', 'Harden', 'Isolate', 'Recover', 'Respond', 'Design']
  const EVIDENCE_FILTERS: EvidenceFilter[] = ['all', 'failed', 'passed']

  // Resizable / Collapsible State
  const [leftWidth, setLeftWidth] = useState(280)
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [hoveredQra, setHoveredQra] = useState<string | null>(null)

  // Batch info modal
  const [showBatchModal, setShowBatchModal] = useState(false)
  const [entityViewMode, setEntityViewMode] = useState<EntityViewMode>(loadEntityViewMode)
  const [showEntitiesHelp, setShowEntitiesHelp] = useState(false)

  const baseVisibleQras = useMemo(
    () => qras
      .map((q, idx) => ({ q, idx }))
      .filter(({ q }) => !mindFilter || (q.mind && q.mind.includes(mindFilter))),
    [mindFilter, qras],
  )

  const evidenceCounts = useMemo(() => {
    const counts: Record<EvidenceFilter, number> = { all: baseVisibleQras.length, failed: 0, passed: 0 }
    baseVisibleQras.forEach(({ q }) => {
      counts[deriveEvidenceStatus(q)] += 1
    })
    return counts
  }, [baseVisibleQras])

  const visibleQras = useMemo(
    () => baseVisibleQras.filter(({ q }) => evidenceFilter === 'all' || deriveEvidenceStatus(q) === evidenceFilter),
    [baseVisibleQras, evidenceFilter],
  )

  const currentListItem = qras[currentIndex] as SpartaQRA | undefined
  const current = currentListItem ? (qraDetails.get(currentListItem._key) ?? currentListItem) : undefined
  const minHighlightEmphasis = minEmphasisForMode(entityViewMode)

  useRegisterAction('qras:action:accept', { app: 'sparta-explorer', action: 'ACCEPT_QRA', label: 'Accept QRA', description: 'Mark the current QRA as accepted' })
  useRegisterAction('qras:action:reject', { app: 'sparta-explorer', action: 'REJECT_QRA', label: 'Reject QRA', description: 'Mark the current QRA as rejected' })
  useRegisterAction('qras:action:undo', { app: 'sparta-explorer', action: 'UNDO_DECISION', label: 'Undo Decision', description: 'Undo the last accept/reject decision' })
  useRegisterAction('qras:filter:clear', { app: 'sparta-explorer', action: 'CLEAR_TAB_FILTER', label: 'Clear Filter', description: 'Remove the control filter from QRA view' })
  useRegisterAction('qras:action:edit', { app: 'sparta-explorer', action: 'EDIT_QRA', label: 'Edit QRA', description: 'Edit the current QRA' })
  useRegisterAction('qras:action:toggle_evidence', { app: 'sparta-explorer', action: 'TOGGLE_EVIDENCE', label: 'Toggle Evidence', description: 'View the evidence pane for the selected QRA' })
  useRegisterAction('qras:action:toggle_hmn', { app: 'sparta-explorer', action: 'TOGGLE_HMN', label: 'Toggle Human', description: 'View human review status for QRA' })
  useRegisterAction('qras:filter:evidence', { app: 'sparta-explorer', action: 'FILTER_EVIDENCE', label: 'Filter by Evidence Status', description: 'Filter the QRA queue by evidence outcome' })
  useRegisterAction('qras:display:entity-help', { app: 'sparta-explorer', action: 'SHOW_ENTITY_VIEW_HELP', label: 'Entity View Help', description: 'Show help text explaining the entity highlighting controls' })
  useRegisterAction('qras:display:entity-anchors', { app: 'sparta-explorer', action: 'SET_ENTITY_VIEW_ANCHORS', label: 'Entity View Anchors', description: 'Show only primary entities in the QRA panes' })
  useRegisterAction('qras:display:entity-context', { app: 'sparta-explorer', action: 'SET_ENTITY_VIEW_CONTEXT', label: 'Entity View Context', description: 'Show primary entities plus contextual phrase entities in the QRA panes' })
  useRegisterAction('qras:display:entity-full', { app: 'sparta-explorer', action: 'SET_ENTITY_VIEW_FULL', label: 'Entity View Full', description: 'Show the full extracted entity set in the QRA panes' })
  useRegisterAction('qras:trace:select-related', { app: 'sparta-explorer', action: 'SELECT_RELATED_QRA', label: 'Select Related QRA', description: 'Select a related QRA from the evidence trace' })

  useEffect(() => {
    saveEntityViewMode(entityViewMode)
  }, [entityViewMode])

  useEffect(() => {
    if (visibleQras.length === 0) return
    if (!visibleQras.some(({ idx }) => idx === currentIndex)) {
      setCurrentIndex(visibleQras[0].idx)
    }
  }, [currentIndex, visibleQras])

  useEffect(() => {
    if (!currentListItem?._key) return
    if (qraDetails.has(currentListItem._key)) return

    let cancelled = false
    setDetailLoadingKey(currentListItem._key)
    qraDetailPost({
      source,
      key: currentListItem._key,
      qraId: currentListItem.qra_id,
    })
      .then((result) => {
        if (cancelled || !result.document) return
        setQraDetails((prev) => {
          const next = new Map(prev)
          next.set(currentListItem._key, result.document as SpartaQRA)
          return next
        })
      })
      .catch(() => { /* keep lightweight row visible */ })
      .finally(() => {
        if (!cancelled) setDetailLoadingKey((prev) => (prev === currentListItem._key ? null : prev))
      })

    return () => { cancelled = true }
  }, [currentListItem?._key, currentListItem?.qra_id, qraDetails, source])

  const relatedQras = useMemo(() => buildRelatedQras(current, qras), [current, qras])

  const selectRelatedQra = useCallback((identifier: string) => {
    const nextIndex = qras.findIndex((entry) => entry._key === identifier || entry.qra_id === identifier)
    if (nextIndex >= 0) setCurrentIndex(nextIndex)
  }, [qras])

  const advance = useCallback((dir: number) => {
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

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (!current) return
      if (e.key === 'a' || e.key === 'A' || e.key === '1') { e.preventDefault(); handleDecision('accept'); }
      if (e.key === 'r' || e.key === 'R' || e.key === '2') { e.preventDefault(); handleDecision('reject'); }
      if (e.key === 'e' || e.key === 'E' || e.key === '3') {
        e.preventDefault()
        document.querySelector<HTMLElement>('[data-qid="qras:action:edit-answer"]')?.click()
      }
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); setEvidenceFilter('failed') }
      if (e.key === 'p' || e.key === 'P') { e.preventDefault(); setEvidenceFilter('passed') }
      if (e.key === '0' || e.key === 'o' || e.key === 'O') { e.preventDefault(); setEvidenceFilter('all') }
      if (e.key === 'ArrowRight' || e.key === 'j') { e.preventDefault(); advance(1); }
      if (e.key === 'ArrowLeft' || e.key === 'k') { e.preventDefault(); advance(-1); }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [current, handleDecision, advance])

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

  const reviewActions = current ? (
    <>
      <button
        data-qid="qras:action:reject"
        data-qs-action="REJECT_QRA"
        title="Reject QRA"
        onClick={() => handleDecision('reject')}
        className="press-scale"
        style={decisionBtn(EMBRY.red)}
      >
        <XCircle size={14} />
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5 }}>Reject</span>
        <span style={{ fontSize: 9, opacity: 0.65 }}>[R]</span>
      </button>
      <button
        data-qid="qras:action:accept"
        data-qs-action="ACCEPT_QRA"
        title="Accept QRA"
        onClick={() => handleDecision('accept')}
        className="press-scale"
        style={decisionBtn(EMBRY.green)}
      >
        <CheckCircle2 size={14} />
        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.5 }}>Accept</span>
        <span style={{ fontSize: 9, opacity: 0.65 }}>[A]</span>
      </button>
    </>
  ) : null

  if (error) {
    return <div style={{ padding: 20, color: EMBRY.red, border: `1px solid ${EMBRY.red}33`, borderRadius: 8, margin: 16 }}>Error: {error}</div>
  }

  return (
    <div style={{ display: 'flex', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: `8px ${PANE_PADDING}px`, borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0, backgroundColor: EMBRY.bgDeep }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: EMBRY.white, letterSpacing: 0.8 }}>QRA</div>
        <div style={{ ...label, backgroundColor: EMBRY.bgPanel, padding: '3px 7px', borderRadius: 4, fontSize: 9 }}>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{qras.length - currentIndex}</span> left
        </div>
        
        {controlFilter && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', backgroundColor: `${EMBRY.accent}12`, borderRadius: 4, border: `1px solid ${EMBRY.accent}33`, marginLeft: 16 }}>
            <span style={{ fontSize: 10, color: EMBRY.accent }}>Filtered: {controlFilter}</span>
            <button data-qid="qras:filter:clear" data-qs-action="CLEAR_TAB_FILTER" onClick={() => nav.clearTabFilter('QRAs')} title="Clear QRA filter" className="press-scale" style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', fontSize: 12, width: 24, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4 }}>×</button>
          </div>
        )}

        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 9, color: EMBRY.dim }}>
          A accept · R reject · E edit · ←→ move
        </span>
        
        {undoTimer && (
          <button data-qid="qras:action:undo" onClick={undoLast} data-qs-action="UNDO_DECISION" title="Undo last decision" className="press-scale" style={{
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
               <button title="Expand Left Panel" onClick={() => setLeftCollapsed(false)} className="press-scale" style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', padding: 8, borderRadius: 6, transition: 'background-color 0.2s' }}>
                 <PanelLeft size={20} />
               </button>
             </div>
           ) : (
             <>
               <div style={{ position: 'sticky', top: 0, zIndex: 2, backgroundColor: EMBRY.bgDeep }}>
                 <div style={{ padding: '8px 10px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                   <div style={{ position: 'relative', flex: 1 }}>
                      <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: EMBRY.dim }} />
                      <input
                        data-qid="qras:search"
                        data-qs-action="SEARCH_QRAS"
                        title="Filter QRAs by question text"
                        type="text"
                        placeholder="Filter questions or controls..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                          width: '100%', padding: '7px 10px 7px 30px', backgroundColor: `${EMBRY.bg}80`,
                          border: `1px solid ${EMBRY.border}`, borderRadius: 6, color: EMBRY.white,
                          fontSize: 11, outline: 'none'
                        }}
                      />
                   </div>
                   <button title="Collapse Left Panel" onClick={() => setLeftCollapsed(true)} className="press-scale" style={{ background: 'none', border: 'none', color: EMBRY.dim, cursor: 'pointer', padding: 4, borderRadius: 6, transition: 'background-color 0.2s' }}>
                     <PanelLeftClose size={18} />
                   </button>
                 </div>

                 <div style={{ padding: '6px 10px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', flexDirection: 'column', gap: 6 }}>
                   <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                     <span style={{ fontSize: 9, fontWeight: 700, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 0.6 }}>Source:</span>
                     <div style={{ display: 'flex', gap: 2, backgroundColor: `${EMBRY.bg}60`, borderRadius: 6, padding: 2, flex: 1 }}>
                       {(['legacy', 'v2', 'all'] as QRASource[]).map(s => {
                         const isActive = source === s
                         const sourceLabel = s === 'v2' ? 'v2' : s === 'legacy' ? 'Legacy' : 'All'
                         return (
                           <button
                             key={s}
                             onClick={() => setSource(s)}
                             className="press-scale"
                             style={{
                               flex: 1,
                               fontSize: 9,
                               fontWeight: 800,
                               padding: '4px 0',
                               borderRadius: 4,
                               border: 'none',
                               backgroundColor: isActive ? EMBRY.accent : 'transparent',
                               color: isActive ? EMBRY.white : EMBRY.dim,
                               cursor: 'pointer',
                               transition: 'background-color 0.15s, border-color 0.15s, color 0.15s',
                               textTransform: 'uppercase',
                             }}
                           >
                             {sourceLabel}
                           </button>
                         )
                       })}
                     </div>
                   </div>

                   <div style={{ display: 'flex', gap: 4, backgroundColor: `${EMBRY.bg}66`, padding: 2, borderRadius: 6 }}>
                     {EVIDENCE_FILTERS.map(status => {
                       const isActive = evidenceFilter === status
                       const count = evidenceCounts[status]
                       return (
                         <button
                           key={status}
                           data-qid={`qras:filter:evidence:${status}`}
                           data-qs-action="FILTER_EVIDENCE"
                           title={`Filter queue by ${status} evidence status`}
                           onClick={() => setEvidenceFilter(status)}
                           className="press-scale"
                           style={{
                             flex: 1,
                             fontSize: 8.5,
                             fontWeight: 800,
                             padding: '4px 0',
                             borderRadius: 4,
                             border: 'none',
                             backgroundColor: isActive ? EMBRY.bgPanel : 'transparent',
                             color: status === 'failed' && !isActive ? EMBRY.red : isActive ? EMBRY.white : EMBRY.dim,
                             cursor: 'pointer',
                             transition: 'background-color 0.15s, border-color 0.15s, color 0.15s',
                             textTransform: 'uppercase',
                           }}
                         >
                           {status} <span style={{ opacity: 0.72, fontVariantNumeric: "tabular-nums" }}>{count}</span>
                         </button>
                       )
                     })}
                   </div>

                   <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                     {MIND_TAGS.map(tag => {
                       const isActive = mindFilter === tag
                       return (
                         <button
                           key={tag}
                           data-qid={`qras:filter:mind:${tag}`}
                           data-qs-action="FILTER_MIND"
                           title={`Filter by ${tag} category`}
                           onClick={() => setMindFilter(isActive ? null : tag)}
                           className="press-scale"
                           style={{
                             fontSize: 8.5, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                             border: `1px solid ${isActive ? EMBRY.accent : EMBRY.border}`,
                             backgroundColor: isActive ? `${EMBRY.accent}14` : 'transparent',
                             color: isActive ? EMBRY.white : EMBRY.dim,
                             cursor: 'pointer', transition: 'background-color 0.15s, border-color 0.15s, color 0.15s',
                           }}
                         >
                           {tag}
                         </button>
                       )
                     })}
                   </div>
                 </div>

                 <div style={{ display: 'grid', gridTemplateColumns: '24px 80px 56px minmax(0, 1fr)', gap: 12, padding: '6px 10px', borderBottom: `1px solid ${EMBRY.border}`, fontSize: 8.5, fontWeight: 800, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                   <span />
                   <span>Control</span>
                   <span>Source</span>
                   <span>Question</span>
                 </div>
               </div>

               <div style={{ flex: 1, overflowY: 'auto' }}>
                  {loading && (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '32px 16px', color: EMBRY.dim }}>
                      <div className="nvis-spinner nvis-spinner-lg" />
                      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.8, textTransform: 'uppercase' }}>Loading QRAs</span>
                    </div>
                  )}
                  {!loading && visibleQras.length === 0 && (
                    <div style={{ padding: 16, color: EMBRY.dim, fontSize: 11 }}>
                      No QRAs match the active filters.
                    </div>
                  )}
                  {visibleQras.map(({ q, idx }) => {
                     const isActive = idx === currentIndex
                     
                     return (
                        <motion.div
                          key={`${q._key}:${idx}`}
                          data-qid={`qras:item:${q._key}`}
                          data-qs-action="SELECT_QRA"
                          title={q.question}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.2, delay: Math.min(idx * 0.015, 0.3) }}
                          onMouseEnter={() => setHoveredQra(q._key)}
                          onMouseLeave={() => setHoveredQra(null)}
                          onClick={() => setCurrentIndex(idx)}
                          style={{
                            padding: '5px 10px',
                            borderBottom: `1px solid ${EMBRY.border}`,
                            backgroundColor: isActive ? 'rgba(124, 58, 237, 0.08)' : (hoveredQra === q._key ? 'rgba(255,255,255,0.02)' : 'transparent'),
                            cursor: 'pointer',
                            position: 'relative',
                          }}
                        >
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: '24px 80px 56px minmax(0, 1fr)',
                              alignItems: 'center',
                              gap: 12,
                              minWidth: 0,
                            }}
                          >
                            <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                              {statusIndicators(q, (e) => {
                                e.stopPropagation()
                                setCurrentIndex(idx)
                              })}
                            </div>

                            <div style={{ fontSize: 9.5, fontFamily: 'monospace', color: EMBRY.accent, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {q.control_id?.trim() || '—'}
                            </div>

                            <div style={{ fontSize: 9, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {q.source_framework || 'SPARTA'}
                            </div>

                            <div
                              title={q.question}
                              style={{
                                fontSize: 10.5,
                                color: isActive ? EMBRY.white : `${EMBRY.white}B0`,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                fontWeight: isActive ? 600 : 450,
                                lineHeight: 1.25,
                                minWidth: 0,
                              }}
                            >
                              {q.question}
                            </div>
                          </div>
                        </motion.div>
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

        {/* CENTER PANE: Unified decision surface */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', backgroundColor: EMBRY.bgPanel, minWidth: 0, minHeight: 0, overflow: 'hidden' }}>
          {!current ? (
            <div style={{ color: EMBRY.dim, padding: 40, textAlign: 'center', margin: 'auto' }}>No QRAs to display. Select an item from the queue.</div>
          ) : (
            <>
              <div style={{ padding: `12px ${PANE_PADDING + 8}px`, backgroundColor: EMBRY.bgDeep, borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0, flexWrap: 'wrap', gap: 12, position: 'sticky', top: 0, zIndex: 3 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, minWidth: 0 }}>
                    <span style={{ fontSize: 9, fontWeight: 700, color: EMBRY.dim, textTransform: 'uppercase', letterSpacing: 0.8 }}>Decision Surface</span>
                    {current.control_id?.trim() ? (
                      <span style={{ fontSize: 11, fontFamily: 'monospace', color: EMBRY.accent, backgroundColor: `${EMBRY.accent}0d`, padding: '3px 7px', borderRadius: 4, border: `1px solid ${EMBRY.accent}24` }}>{current.control_id}</span>
                    ) : null}
                    <span
                      title="Click to copy _key"
                      onClick={() => navigator.clipboard.writeText(current._key)}
                      style={{ fontSize: 9, fontFamily: 'monospace', color: EMBRY.dim, cursor: 'pointer', padding: '2px 5px', borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.035)', minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 420 }}
                    >
                      {compactKey(current._key)}
                    </span>
                  </div>
                  {current.mind && current.mind.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 8, fontWeight: 800, color: `${EMBRY.dim}cc`, textTransform: 'uppercase', letterSpacing: 0.8 }}>Mind</span>
                      {current.mind.map(tag => (
                        <span
                          key={tag}
                          style={{
                            fontSize: 8.5,
                            padding: '2px 6px',
                            borderRadius: 999,
                            border: `1px solid ${EMBRY.border}`,
                            backgroundColor: 'rgba(255,255,255,0.02)',
                            color: EMBRY.dim,
                            lineHeight: 1.4,
                          }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }}>
                    <button
                      type="button"
                      data-qid="qras:display:entity-help"
                      data-qs-action="SHOW_ENTITY_VIEW_HELP"
                      aria-label="Explain entity highlighting"
                      onMouseEnter={() => setShowEntitiesHelp(true)}
                      onMouseLeave={() => setShowEntitiesHelp(false)}
                      onFocus={() => setShowEntitiesHelp(true)}
                      onBlur={() => setShowEntitiesHelp(false)}
                      className="press-scale"
                      style={{
                        fontSize: 8.5,
                        color: EMBRY.dim,
                        textTransform: 'uppercase',
                        letterSpacing: 0.8,
                        fontWeight: 800,
                        padding: '0 2px',
                        cursor: 'help',
                        border: 'none',
                        background: 'transparent',
                        borderBottom: `1px dotted ${EMBRY.dim}66`,
                      }}
                    >
                      Entities
                    </button>
                    {showEntitiesHelp && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 'calc(100% + 8px)',
                          right: 0,
                          width: 260,
                          maxWidth: 'min(260px, calc(100vw - 48px))',
                          padding: '8px 10px',
                          borderRadius: 6,
                          border: `1px solid ${EMBRY.border}`,
                          backgroundColor: EMBRY.bgDeep,
                          boxShadow: '0 10px 24px rgba(0,0,0,0.35)',
                          color: EMBRY.white,
                          fontSize: 10,
                          lineHeight: 1.45,
                          zIndex: 4,
                          pointerEvents: 'none',
                        }}
                      >
                        Entity highlighting changes how much extracted grounding and context is shown in the question and answer surfaces.
                      </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: 2, borderRadius: 6, backgroundColor: `${EMBRY.bg}4d`, border: `1px solid ${EMBRY.border}` }}>
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
                          className="press-scale"
                          style={{
                            fontSize: 9,
                            fontWeight: 700,
                            padding: '4px 7px',
                            borderRadius: 4,
                            border: 'none',
                            backgroundColor: isActive ? `${EMBRY.accent}16` : 'transparent',
                            color: isActive ? EMBRY.white : EMBRY.dim,
                            cursor: 'pointer',
                          }}
                        >
                          {option.label}
                        </button>
                      )
                    })}
                    </div>
                  </div>
                  {current.run_id && (
                    <button
                      onClick={() => setShowBatchModal(true)}
                      title={`View batch: ${current.run_id}`}
                      className="press-scale"
                      style={{
                        background: 'none', border: `1px solid ${EMBRY.border}`, borderRadius: 4,
                        padding: '3px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                        color: EMBRY.dim,
                      }}
                    >
                      <Layers size={12} />
                      <span style={{ fontSize: 8.5, fontFamily: 'monospace' }}>
                        {qras.filter(q => q.run_id === current.run_id).length}
                      </span>
                    </button>
                  )}
                </div>
              </div>

              <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <EvidenceView
                  question={current.question}
                  qraKey={current.qra_id || current._key}
                  reasoning={current.reasoning}
                  answer={current.answer}
                  groundingScore={current.grounding_score}
                  storedEvidenceCase={current.evidence_case as any}
                  qraFormalProof={current.formal_proof}
                  qraSacmRef={current.sacm_ref}
                  upstreamQRAKeys={current.lineage?.upstream_qra_keys || []}
                  priorQRAEvidence={current.evidence_case?.prior_qra_evidence || []}
                  minHighlightEmphasis={minHighlightEmphasis}
                  reviewActions={reviewActions}
                  relatedQRAs={relatedQras}
                  onSelectRelatedQRA={selectRelatedQra}
                />
              </div>
            </>
          )}
        </div>
      </div>

      {/* Batch Info Modal */}
      <AnimatePresence>
      {showBatchModal && current?.run_id && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          }} onClick={() => setShowBatchModal(false)}>
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
            style={{
              width: 520, maxHeight: '80vh', backgroundColor: EMBRY.bgPanel,
              border: `1px solid ${EMBRY.border}`, borderRadius: 12, overflow: 'hidden',
              boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
            }} onClick={e => e.stopPropagation()}
          >
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
              <button onClick={() => setShowBatchModal(false)} className="press-scale" style={{
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
                        className="elevated-surface"
                        style={{
                          padding: '10px 12px', borderRadius: 6, cursor: 'pointer',
                          backgroundColor: isCurrent ? `${EMBRY.accent}15` : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${isCurrent ? EMBRY.accent : 'transparent'}`,
                          transition: 'background-color 0.15s, border-color 0.15s, color 0.15s',
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
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  )
}

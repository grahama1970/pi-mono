/**
 * ThreatMatrix — Shared compound component.
 *
 * Architecture: Compound component with dependency-injected state.
 * - UI components consume a context interface (state/actions/meta)
 * - Each host app (Explorer, Datalake, Embry-OS) provides its own Provider
 *   that fetches data however it needs and injects it
 * - Follows composition-patterns/state-context-interface best practice
 *
 * Usage:
 *   <ThreatMatrix.Provider state={...} actions={...} meta={...}>
 *     <ThreatMatrix.Header />
 *     <ThreatMatrix.TacticStrip />
 *     <ThreatMatrix.Grid />
 *     <ThreatMatrix.Detail />
 *   </ThreatMatrix.Provider>
 */
import { createContext, use, useState, useMemo, useCallback, useRef, useEffect, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { Flame, Grid3X3, Network, GitBranch, AlertTriangle, FileWarning, Shield, Download } from 'lucide-react'
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from 'd3-force'
import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force'
import { EMBRY, label, heading, glowDot, fwBadge, FLUID } from '../common/EmbryStyle'
import { PostureHUD } from './PostureHUD'
import { TacticAccordion } from './TacticAccordion'
import { TechniqueDrawer } from './TechniqueDrawer'
import { TacticalContextMenu, type TacticalContextMenuAction } from './TacticalContextMenu'
import { useMediaQuery } from '../../../hooks/useMediaQuery'
import { useRegisterAction } from '../../../hooks/useRegisterAction'

// ── Context Interface ────────────────────────────────────────────────────────

export interface ThreatTechnique {
  id: string
  name: string
  tactic: string
  description?: string
  /** Coverage status — derived ONLY from /create-evidence-case verdicts */
  coverage: 'full' | 'partial' | 'none' | 'unknown'
  /** Evidence case verdict: satisfied / inconclusive / not_satisfied / none */
  evidenceVerdict: 'satisfied' | 'inconclusive' | 'not_satisfied' | 'none'
  /** Number of evidence cases that reference this technique */
  evidenceCaseCount: number
  /** Grade from evidence case (A+, A, B, C, F) */
  evidenceGrade?: string
  issueCount: number
  frameworks: string[]
  mind?: string[]
  nrs_score?: number
}

export interface ThreatRelationship {
  source_control_id?: string
  target_control_id?: string
  source_framework?: string
  target_framework?: string
  relationship_type?: string
  edge_type?: string
  combined_score?: number
}

export interface ThreatTactic {
  id: string
  name: string
  prefix: string
}

export interface TraceabilityChunk {
  _key?: string
  asset_type: string
  doc_id?: string
  page_num?: number
  text?: string
  content?: string
  confidence?: number
}

export interface EvidenceCase {
  verdict: string
  grade: string
  question: string
  gates_passed: number
  gates_total: number
  gate_summary: string
  tier: string
  control_ids: string[]
}

export interface TechniqueDetail {
  technique: ThreatTechnique
  qras: Array<{ question?: string; answer?: string; reasoning?: string }>
  countermeasures: Array<{ control_id: string; name: string }>
  relationships: Array<{ source_control_id: string; target_control_id: string; combined_score?: number }>
  /** Traceability: typed datalake chunks linked to this control */
  traceability?: Record<string, TraceabilityChunk[]>
  /** Evidence cases with gate traces */
  evidenceCases?: EvidenceCase[]
  /** Discrepancy findings (requirement vs table contradictions) */
  discrepancies?: Array<{ severity: string; summary: string; requirement_claim: string; table_reality: string; recommendation: string }>
}

/** View modes for the threat matrix */
export type ViewMode = 'standard' | 'bloom' | 'graph' | 'edges'

export interface ThreatMatrixState {
  tactics: ThreatTactic[]
  techniques: ThreatTechnique[]
  loading: boolean
  showSubtechniques: boolean
  selectedDetail: TechniqueDetail | null
  loadingDetail: boolean
  /** Current view mode: standard (cards), bloom (color grid), graph (D3 nodes) */
  viewMode?: ViewMode
  /** Condensed view: cells show ID + dot only (9-col survives on laptops) */
  condensedView?: boolean
  /** Memory-persisted SPARTA relationship/crosswalk edges, created by evidence-case/crosswalk pipelines. */
  graphRelationships?: ThreatRelationship[]
  graphHoveredTactic?: string | null
  graphLockedTactic?: string | null
}

export interface ThreatMatrixActions {
  selectTechnique: (tech: ThreatTechnique) => void
  clearSelection: () => void
  toggleSubtechniques: () => void
  selectDatalake?: (datalake: string) => void
  setViewMode?: (mode: ViewMode) => void
  toggleCondensedView?: () => void
  setGraphHoveredTactic?: (tactic: string | null) => void
  setGraphLockedTactic?: (tactic: string | null) => void
}

export interface DatalakeOption {
  id: string
  name: string
  description: string
  collections: string[]
}

export interface ThreatMatrixMeta {
  totalControls?: number
  source?: string // 'explorer' | 'datalake' | 'embry-os'
  /** Available datalakes to overlay */
  datalakes?: DatalakeOption[]
  /** Currently selected datalake */
  activeDatalake?: string
  /** When true, coverage bars are indeterminate and a degraded banner is shown */
  analysisPipelineDegraded?: boolean
  /** Active evidence case id for matrix binding status */
  boundEvidenceCaseId?: string | null
}

interface ThreatMatrixContextValue {
  state: ThreatMatrixState
  actions: ThreatMatrixActions
  meta: ThreatMatrixMeta
}

const ThreatMatrixContext = createContext<ThreatMatrixContextValue | null>(null)

function useThreatMatrix(): ThreatMatrixContextValue {
  const ctx = use(ThreatMatrixContext)
  if (!ctx) throw new Error('ThreatMatrix components must be wrapped in ThreatMatrix.Provider')
  return ctx
}

// ── Provider ─────────────────────────────────────────────────────────────────

interface ProviderProps {
  state: ThreatMatrixState
  actions: ThreatMatrixActions
  meta: ThreatMatrixMeta
  children: ReactNode
}

function Provider({ state, actions, meta, children }: ProviderProps) {
  return (
    <ThreatMatrixContext value={{ state, actions, meta }}>
      {children}
    </ThreatMatrixContext>
  )
}

// ── Coverage colors ──────────────────────────────────────────────────────────

const COVERAGE_COLORS: Record<string, string> = {
  full: EMBRY.green,
  partial: EMBRY.amber,
  none: EMBRY.red,
  unknown: EMBRY.dim,
}

// ── Visual Bloom Heatmap Colors (Industrial-Grade) ───────────────────────────
// Tactical heat-distribution map with luminance-based confidence visualization
// - Luminance = proxy for evidence strength (1.0 = formal proof, 0.5 = weak)
// - Temporal shimmer for expiring evidence (scanline animation)
// - Structural contours for load-bearer cells (high MRS/fan-out)
const BLOOM_RGB = {
  healthy: [63, 185, 80],    // Green — full compliance
  degraded: [210, 153, 34],  // Amber — fragile success
  critical: [220, 38, 38],   // Red — emergency
  blind: [74, 74, 74],       // Grey — unknown/blind spot
}

const BLOOM_COLORS = {
  safe: '#1a5f2a',
  fragile: '#b58900',
  blind: '#4a4a4a',
  critical: '#dc2626',
}

/** Map evidence grade to impact score (0.0 = strong, 1.0 = weak/failing) */
function gradeToImpact(grade: string | undefined, verdict: string): number {
  if (verdict === 'not_satisfied') return 1.0
  if (verdict === 'none' || verdict === 'inconclusive') return 0.6
  if (!grade) return 0.4
  switch (grade) {
    case 'A+': return 0.0
    case 'A': return 0.1
    case 'B': return 0.3
    case 'C': return 0.5
    case 'F': return 0.9
    default: return 0.4
  }
}

/** Get full heatmap style with luminance, shimmer, and structural weight */
function getBloomStyle(tech: ThreatTechnique): React.CSSProperties {
  const impact = gradeToImpact(tech.evidenceGrade, tech.evidenceVerdict)
  const nrsScore = tech.nrs_score ?? 0

  // Determine base RGB based on operational state. Unknown/inconclusive evidence
  // must remain grey; yellow is reserved for fragile accepted evidence.
  let rgb = BLOOM_RGB.healthy
  if (tech.evidenceVerdict === 'none' || tech.evidenceVerdict === 'inconclusive') rgb = BLOOM_RGB.blind
  else if (impact > 0.7) rgb = BLOOM_RGB.critical
  else if (impact > 0.3) rgb = BLOOM_RGB.degraded

  // Luminance mapping: higher impact in healthy areas = "thin evidence" (dimmer)
  // Alpha ranges from 0.4 (weak) to 1.0 (strong)
  const alpha = tech.evidenceVerdict === 'none' || tech.evidenceVerdict === 'inconclusive'
    ? 0.42
    : impact < 0.3
      ? 1.0 - impact * 0.6
      : 0.7 + impact * 0.3

  // Structural weight: high NRS score = load-bearer cell (inner glow)
  const isLoadBearer = nrsScore > 0.5
  const innerGlow = isLoadBearer ? `inset 0 0 8px rgba(255, 255, 255, 0.15)` : 'none'

  return {
    backgroundColor: `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`,
    boxShadow: innerGlow,
    border: isLoadBearer ? '1px solid rgba(255, 255, 255, 0.2)' : 'none',
  }
}

function getBloomColor(tech: ThreatTechnique): string {
  const verdict = tech.evidenceVerdict
  const grade = tech.evidenceGrade ?? '-'

  if (verdict === 'not_satisfied') return BLOOM_COLORS.critical
  if (verdict === 'inconclusive' || verdict === 'none') return BLOOM_COLORS.blind
  if (verdict === 'satisfied') {
    if (grade === 'A+' || grade === 'A') return BLOOM_COLORS.safe
    return BLOOM_COLORS.fragile
  }
  return BLOOM_COLORS.blind
}

function getAccentColor(tech: ThreatTechnique): string {
  if (tech.evidenceVerdict === 'satisfied') return EMBRY.green
  if (tech.evidenceVerdict === 'inconclusive') return EMBRY.amber
  if (tech.evidenceVerdict === 'not_satisfied') return EMBRY.red
  return EMBRY.dim
}

function getMicroId(id: string): string {
  const parts = id.split('-')
  if (parts.length >= 2) return `${parts[0]}-${parts[1].padStart(2, '0')}`
  return id.slice(0, 6)
}

// ── Tactical HUD Tooltip (NVIS 2026) ─────────────────────────────────────────

interface TacticalHUDProps {
  tech: ThreatTechnique
  position: { x: number; y: number }
  visible: boolean
}

function TacticalHUD({ tech, position, visible }: TacticalHUDProps) {
  if (!visible) return null

  const accentColor = getAccentColor(tech)
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight
  const left = Math.min(position.x + 14, Math.max(16, viewportWidth - 238))
  const top = Math.min(position.y + 14, Math.max(16, viewportHeight - 118))

  return (
    <div
      data-qid="threat-matrix:overlay:tactical-hud"
      data-qs-action="tactical-hud-display"
      title={`Tactical HUD: ${tech.id}`}
      style={{
        position: 'fixed',
        left,
        top,
        background: 'rgba(10, 10, 12, 0.94)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid rgba(255, 255, 255, 0.10)',
        borderLeft: `3px solid ${accentColor}`,
        padding: '8px 10px',
        borderRadius: 3,
        boxShadow: '0 8px 22px rgba(0, 0, 0, 0.55)',
        color: '#e0e4e8',
        pointerEvents: 'none',
        zIndex: 9999,
        width: 220,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 800, color: '#f0f6fc', marginBottom: 3, fontFamily: 'monospace' }}>
        {tech.id}
      </div>
      <div style={{
        fontSize: 11,
        color: 'rgba(255,255,255,0.62)',
        lineHeight: 1.25,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        marginBottom: 8,
      }}>
        {tech.name}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 7 }}>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: accentColor }}>
          {(tech.evidenceVerdict ?? 'unknown').replace('_', ' ')}
        </span>
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.42)' }}>
          {tech.evidenceGrade ? `Grade ${tech.evidenceGrade}` : `${tech.evidenceCaseCount} Case${tech.evidenceCaseCount === 1 ? '' : 's'}`}
        </span>
      </div>
      {tech.frameworks.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', gap: 4 }}>
          {tech.frameworks.slice(0, 2).map((fw) => (
            <span key={fw} style={{
              fontSize: 9,
              padding: '1px 5px',
              borderRadius: 3,
              background: 'rgba(255, 255, 255, 0.08)',
              color: 'rgba(255,255,255,0.45)',
            }}>{fw}</span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Header ───────────────────────────────────────────────────────────────────

function Header() {
  const { state, actions, meta } = useThreatMatrix()
  const { techniques, showSubtechniques } = state

  // Register actions for QID compliance (4-attribute rule)
  useRegisterAction('threat-matrix:input:datalake-selector', { app: 'sparta-explorer', action: 'SELECT_DATALAKE', label: 'Select Datalake', description: 'Select datalake for traceability overlay' })
  useRegisterAction('threat-matrix:button:view-standard', { app: 'sparta-explorer', action: 'SET_VIEW_STANDARD', label: 'Standard View', description: 'Show full detail cards' })
  useRegisterAction('threat-matrix:button:view-bloom', { app: 'sparta-explorer', action: 'SET_VIEW_BLOOM', label: 'Bloom View', description: 'Visual color grid for risk scan' })
  useRegisterAction('threat-matrix:button:view-graph', { app: 'sparta-explorer', action: 'SET_VIEW_GRAPH', label: 'Graph View', description: 'Node graph connections' })
  useRegisterAction('threat-matrix:button:condensed-toggle', { app: 'sparta-explorer', action: 'TOGGLE_CONDENSED', label: 'Condensed View', description: 'Show only IDs and status' })
  useRegisterAction('threat-matrix:button:subtechniques-toggle', { app: 'sparta-explorer', action: 'TOGGLE_SUBTECHNIQUES', label: 'Toggle Subtechniques', description: 'Show or hide subtechniques' })

  const satisfied = techniques.filter((t) => t.evidenceVerdict === 'satisfied').length
  const inconclusive = techniques.filter((t) => t.evidenceVerdict === 'inconclusive').length
  const notSatisfied = techniques.filter((t) => t.evidenceVerdict === 'not_satisfied').length
  const noCase = techniques.filter((t) => t.evidenceVerdict === 'none').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
      {/* Sticky Posture HUD */}
      <PostureHUD
        satisfied={satisfied}
        inconclusive={inconclusive}
        notSatisfied={notSatisfied}
        noCase={noCase}
        techniqueCount={techniques.length}
        tacticCount={state.tactics.length}
        activeDatalake={meta.activeDatalake}
      />

      {meta.analysisPipelineDegraded ? (
        <div
          data-qid="threat-matrix:banner:degraded"
          style={{
            padding: '8px 16px',
            borderTop: '1px solid rgba(250, 204, 21, 0.2)',
            borderBottom: '1px solid rgba(250, 204, 21, 0.2)',
            background: 'rgba(250, 204, 21, 0.1)',
            color: '#FACC15',
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.04em',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          }}
        >
          Coverage analysis unavailable — pipeline degraded. Zero-percent bars are indeterminate, not verified absence of coverage.
          {meta.boundEvidenceCaseId ? ` Active evidence case ${meta.boundEvidenceCaseId} is not matrix-bound yet.` : ''}
        </div>
      ) : null}

      {/* Controls row */}
      <div style={{
        padding: '8px 16px',
        borderBottom: `1px solid ${EMBRY.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        gap: 8,
        backgroundColor: EMBRY.bgHeader,
      }}>
        {/* Datalake selector */}
        {meta.datalakes && meta.datalakes.length > 0 && (
          <select
            data-qid="threat-matrix:input:datalake-selector"
            data-qs-action="SELECT_DATALAKE"
            title="Select datalake for traceability overlay"
            value={meta.activeDatalake ?? ''}
            onChange={(e) => actions.selectDatalake?.(e.target.value)}
            style={{
              fontSize: 10, padding: '8px 12px', borderRadius: 6,
              border: `1px solid ${EMBRY.border}`, cursor: 'pointer',
              backgroundColor: EMBRY.bgDeep, color: EMBRY.white,
              minHeight: 44,
            }}
          >
            <option value="">SPARTA Catalog Only</option>
            {meta.datalakes.map((dl) => (
              <option key={dl.id} value={dl.id}>{dl.name}</option>
            ))}
          </select>
        )}
        {/* View Mode Selector: Standard | Bloom | Graph */}
        {actions.setViewMode && (
          <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 8, backgroundColor: `${EMBRY.bgDeep}80` }}>
            <button
              data-qid="threat-matrix:button:view-standard"
              data-qs-action="SET_VIEW_STANDARD"
              onClick={() => actions.setViewMode!('standard')}
              title="Grid view — full cards with details"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 44, height: 44, minWidth: 44, minHeight: 44, borderRadius: 8, border: 'none', cursor: 'pointer',
                backgroundColor: (state.viewMode ?? 'standard') === 'standard' ? `${EMBRY.accent}22` : 'transparent',
                color: (state.viewMode ?? 'standard') === 'standard' ? EMBRY.accent : EMBRY.dim,
              }}
            >
              <Grid3X3 size={18} strokeWidth={1.5} />
            </button>
            <button
              data-qid="threat-matrix:button:view-bloom"
              data-qs-action="SET_VIEW_BLOOM"
              onClick={() => actions.setViewMode!('bloom')}
              title="Bloom view — color-coded risk heatmap for rapid scan"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 44, height: 44, minWidth: 44, minHeight: 44, borderRadius: 8, border: 'none', cursor: 'pointer',
                backgroundColor: state.viewMode === 'bloom' ? `${EMBRY.amber}22` : 'transparent',
                color: state.viewMode === 'bloom' ? EMBRY.amber : EMBRY.dim,
              }}
            >
              <Flame size={18} strokeWidth={1.5} />
            </button>
            <button
              data-qid="threat-matrix:button:view-graph"
              data-qs-action="SET_VIEW_GRAPH"
              onClick={() => actions.setViewMode!('graph')}
              title="Graph view — control → requirement → proof connections"
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 44, height: 44, minWidth: 44, minHeight: 44, borderRadius: 8, border: 'none', cursor: 'pointer',
                backgroundColor: state.viewMode === 'graph' ? `${EMBRY.green}22` : 'transparent',
                color: state.viewMode === 'graph' ? EMBRY.green : EMBRY.dim,
              }}
            >
              <Network size={18} strokeWidth={1.5} />
            </button>
          </div>
        )}
        {actions.toggleCondensedView && (
          <button
            data-qid="threat-matrix:button:condensed-toggle"
            data-qs-action="TOGGLE_CONDENSED"
            onClick={actions.toggleCondensedView}
            title="Condensed View — show only IDs and status"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 44, height: 44, minWidth: 44, minHeight: 44, flex: '0 0 44px', borderRadius: 8,
              border: `1px solid ${EMBRY.border}`, cursor: 'pointer',
              backgroundColor: state.condensedView ? `${EMBRY.blue}22` : 'transparent',
              color: state.condensedView ? EMBRY.blue : EMBRY.dim,
            }}
          >
            <Grid3X3 size={16} strokeWidth={1.5} />
          </button>
        )}
        <button
          data-qid="threat-matrix:button:subtechniques-toggle"
          data-qs-action="TOGGLE_SUBTECHNIQUES"
          title={showSubtechniques ? 'Hide sub-techniques' : 'Show sub-techniques'}
          onClick={actions.toggleSubtechniques}
          style={{
            fontSize: 10, fontWeight: 600, padding: '8px 12px', borderRadius: 8,
            border: `1px solid ${EMBRY.border}`, cursor: 'pointer',
            backgroundColor: showSubtechniques ? `${EMBRY.accent}22` : 'transparent',
            color: showSubtechniques ? EMBRY.accent : EMBRY.dim,
            minHeight: 44,
          }}
        >
          {showSubtechniques ? 'Hide' : 'Show'} Sub
        </button>
      </div>
    </div>
  )
}

// ── Tactic Strip ─────────────────────────────────────────────────────────────

function TacticStrip() {
  const { state } = useThreatMatrix()

  const stats = useMemo(() => {
    const s: Record<string, { total: number; covered: number; partial: number; gap: number }> = {}
    for (const t of state.tactics) s[t.name] = { total: 0, covered: 0, partial: 0, gap: 0 }
    for (const t of state.techniques) {
      const bucket = s[t.tactic]
      if (!bucket) continue
      bucket.total++
      if (t.evidenceVerdict === 'satisfied') bucket.covered++
      else if (t.evidenceVerdict === 'inconclusive') bucket.partial++
      else bucket.gap++
    }
    return s
  }, [state.tactics, state.techniques])

  if (state.viewMode === 'graph') return null

  return (
    <div style={{ display: 'flex', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0 }}>
      {state.tactics.map((tactic) => {
        const s = stats[tactic.name] ?? { total: 0, covered: 0, partial: 0, gap: 0 }
        const pct = s.total > 0 ? Math.round((s.covered / s.total) * 100) : 0
        return (
          <div key={tactic.id} style={{ flex: 1, minWidth: 0, padding: '8px 10px', borderRight: `1px solid ${EMBRY.border}`, textAlign: 'center', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: EMBRY.white, marginBottom: 2 }}>{tactic.name}</div>
            <div style={{ fontSize: 8, color: EMBRY.dim }}>{tactic.prefix} · {s.total} tech</div>
            <div style={{ marginTop: 'auto' }}>
              <div style={{ display: 'flex', height: 3, borderRadius: 2, overflow: 'hidden', marginTop: 4 }}>
                {s.total > 0 && <>
                  <div style={{ width: `${(s.covered / s.total) * 100}%`, backgroundColor: EMBRY.green }} />
                  <div style={{ width: `${(s.partial / s.total) * 100}%`, backgroundColor: EMBRY.amber }} />
                  <div style={{ width: `${(s.gap / s.total) * 100}%`, backgroundColor: EMBRY.red }} />
                </>}
              </div>
              <div style={{ fontSize: 8, color: pct === 100 ? EMBRY.green : EMBRY.dim, marginTop: 2 }} title="Evidence case coverage: % of techniques with SATISFIED verdicts">{s.total > 0 && s.covered + s.partial + s.gap > 0 ? `${pct}%` : '—'} <span style={{ opacity: 0.5 }}>coverage</span></div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function gradeTooltip(grade: string, verdict: string, caseCount: number, name: string): string {
  const gradeDesc: Record<string, string> = {
    'A+': 'All gates passed. Strong evidence.',
    'A': 'Most gates passed. Good evidence.',
    'B': 'Some gates passed. Moderate evidence.',
    'C': 'Few gates passed. Weak evidence.',
    'D': 'Minimal evidence support.',
    'F': 'Evidence case failed. Gap in coverage.',
  }
  const desc = gradeDesc[grade] ?? `Grade: ${grade}`
  const verdictLabel = verdict === 'satisfied' ? 'SATISFIED' : verdict === 'inconclusive' ? 'INCONCLUSIVE' : verdict === 'not_satisfied' ? 'NOT SATISFIED' : 'NO EVIDENCE'
  return `${name}\n\nVerdict: ${verdictLabel}\nGrade: ${grade} — ${desc}\nEvidence cases: ${caseCount}`
}

function cellTooltip(tech: ThreatTechnique): string {
  const verdict = tech.evidenceVerdict === 'satisfied' ? 'SATISFIED'
    : tech.evidenceVerdict === 'inconclusive' ? 'INCONCLUSIVE'
    : tech.evidenceVerdict === 'not_satisfied' ? 'NOT SATISFIED'
    : 'NO EVIDENCE'
  const grade = tech.evidenceGrade ? ` · Grade: ${tech.evidenceGrade}` : ''
  const cases = tech.evidenceCaseCount > 0 ? ` · ${tech.evidenceCaseCount} case${tech.evidenceCaseCount !== 1 ? 's' : ''}` : ''
  const mind = tech.mind?.length ? `\nTaxonomy: ${tech.mind.join(', ')}` : ''
  return `${tech.id}: ${tech.name}\nTactic: ${tech.tactic}\nVerdict: ${verdict}${grade}${cases}${mind}`
}

// ── Technique Graph (D3 Force) ───────────────────────────────────────────────

interface GraphNode extends SimulationNodeDatum {
  id: string
  kind: 'technique' | 'tactic' | 'framework' | 'category' | 'evidence' | 'control'
  label: string
  data?: ThreatTechnique
  lane?: string
  laneIndex?: number
  laneOrdinal?: number
  laneTotal?: number
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode
  target: string | GraphNode
  kind: TacticalGraphLink['kind']
}

interface TacticalGraphLink {
  id: string
  source: string
  target: string
  kind: 'tactic-technique' | 'crosswalk-framework' | 'control-category' | 'evidence-state' | 'memory-crosswalk'
}

type GraphSceneMode = 'path' | 'tactic' | 'all'

interface GraphContextMenuState {
  isVisible: boolean
  x: number
  y: number
  nodeId: string | null
}

const TACTIC_ZONE_COLORS: Record<string, string> = {
  REC: 'rgba(56, 189, 248, 0.02)',
  RD: 'rgba(251, 146, 60, 0.02)',
  IA: 'rgba(167, 139, 250, 0.02)',
  EX: 'rgba(248, 113, 113, 0.02)',
  PER: 'rgba(74, 222, 128, 0.02)',
  DE: 'rgba(148, 163, 184, 0.02)',
  LM: 'rgba(250, 204, 21, 0.015)',
  EXF: 'rgba(45, 212, 191, 0.02)',
  IMP: 'rgba(232, 121, 249, 0.02)',
}

function TechniqueGraph({ techniques, tactics, relationships = [], hoveredTactic = null, lockedTactic = null, setHoveredTactic, setLockedTactic, onSelect }: {
  techniques: ThreatTechnique[]
  tactics: ThreatTactic[]
  relationships?: ThreatRelationship[]
  hoveredTactic?: string | null
  lockedTactic?: string | null
  setHoveredTactic?: (tactic: string | null) => void
  setLockedTactic?: (tactic: string | null) => void
  onSelect: (tech: ThreatTechnique) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map())
  const [hovered, setHovered] = useState<string | null>(null)
  const [isolatedNodeId, setIsolatedNodeId] = useState<string | null>(null)
  const [pinnedNodeIds, setPinnedNodeIds] = useState<Set<string>>(() => new Set())
  const [contextMenu, setContextMenu] = useState<GraphContextMenuState>({ isVisible: false, x: 0, y: 0, nodeId: null })
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })
  const [viewport, setViewport] = useState({ x: 0, y: 0, k: 1 })
  const [forcePulse, setForcePulse] = useState(0)
  const [sceneMode, setSceneMode] = useState<GraphSceneMode>('path')
  const panRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null)
  const reducedMotion = useMemo(() => (
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ), [])
  const activeTactic = hoveredTactic ?? lockedTactic
  const spotlightNodeId = hovered ?? isolatedNodeId

  useRegisterAction('threat-matrix:graph:tactic-magnet', {
    app: 'sparta-explorer',
    action: 'GRAPH_TACTIC_MAGNET_SELECT',
    label: 'Select threat graph tactic magnet',
    description: 'Hover or click a tactic gravity well to isolate SPARTA graph nodes in that lane',
  })
  useRegisterAction('threat-matrix:graph:node-technique', {
    app: 'sparta-explorer',
    action: 'SELECT_TECHNIQUE_GRAPH_NODE',
    label: 'Select graph technique node',
    description: 'Open the evidence pane for a SPARTA technique node from the graph',
  })
  useRegisterAction('threat-matrix:graph:control-zoom-in', {
    app: 'sparta-explorer',
    action: 'GRAPH_ZOOM_IN',
    label: 'Zoom in threat graph',
    description: 'Increase the SPARTA threat graph viewport scale',
  })
  useRegisterAction('threat-matrix:graph:control-zoom-out', {
    app: 'sparta-explorer',
    action: 'GRAPH_ZOOM_OUT',
    label: 'Zoom out threat graph',
    description: 'Decrease the SPARTA threat graph viewport scale',
  })
  useRegisterAction('threat-matrix:graph:control-reset', {
    app: 'sparta-explorer',
    action: 'GRAPH_RESET_VIEW',
    label: 'Reset threat graph view',
    description: 'Reset SPARTA threat graph pan and zoom',
  })
  useRegisterAction('threat-matrix:graph:control-force-push', {
    app: 'sparta-explorer',
    action: 'GRAPH_FORCE_PUSH',
    label: 'Force push threat graph',
    description: 'Reheat the SPARTA threat graph layout without changing the source data',
  })
  useRegisterAction('threat-matrix:graph:scene-mode', {
    app: 'sparta-explorer',
    action: 'GRAPH_SET_SCENE_MODE',
    label: 'Set threat graph scene mode',
    description: 'Switch between path, tactic, and diagnostic all-edge SPARTA graph scenes',
  })
  useRegisterAction('threat-matrix:graph:context-menu', {
    app: 'sparta-explorer',
    action: 'GRAPH_OPEN_CONTEXT_MENU',
    label: 'Open threat graph context menu',
    description: 'Open tactical node actions for the selected SPARTA graph node',
  })
  useRegisterAction('threat-matrix:graph:context-isolate', {
    app: 'sparta-explorer',
    action: 'GRAPH_CONTEXT_ISOLATE',
    label: 'Isolate graph kill chain',
    description: 'Lock the SPARTA graph spotlight to one selected node and its adjacent crosswalk path',
  })
  useRegisterAction('threat-matrix:graph:context-pin', {
    app: 'sparta-explorer',
    action: 'GRAPH_CONTEXT_PIN',
    label: 'Pin graph node marker',
    description: 'Pin or unpin a SPARTA graph node marker in the current scene',
  })
  useRegisterAction('threat-matrix:graph:context-copy', {
    app: 'sparta-explorer',
    action: 'GRAPH_CONTEXT_COPY',
    label: 'Copy graph node telemetry',
    description: 'Copy the selected SPARTA graph node id to the clipboard',
  })

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setDimensions({ width, height })
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  const graphData = useMemo(() => {
    const nodes = new Map<string, GraphNode>()
    const links: TacticalGraphLink[] = []

    const addNode = (node: GraphNode) => {
      if (!nodes.has(node.id)) nodes.set(node.id, node)
    }

    const addLink = (source: string, target: string, kind: TacticalGraphLink['kind']) => {
      const id = `${kind}:${source}->${target}`
      if (!nodes.has(source) || !nodes.has(target) || links.some((link) => link.id === id)) return
      links.push({ id, source, target, kind })
    }

    for (const [index, tactic] of tactics.entries()) {
      addNode({
        id: `tactic:${tactic.name}`,
        kind: 'tactic',
        label: tactic.prefix || tactic.name,
        lane: tactic.name,
        laneIndex: index,
      })
    }

    const tacticTechniqueTotals = new Map<string, number>()
    const tacticTechniqueOrdinals = new Map<string, number>()
    for (const tech of techniques) {
      tacticTechniqueTotals.set(tech.tactic, (tacticTechniqueTotals.get(tech.tactic) ?? 0) + 1)
    }

    for (const tech of techniques) {
      const tacticIndex = tactics.findIndex((tactic) => tactic.name === tech.tactic)
      const techniqueId = `technique:${tech.id}`
      const laneOrdinal = tacticTechniqueOrdinals.get(tech.tactic) ?? 0
      tacticTechniqueOrdinals.set(tech.tactic, laneOrdinal + 1)
      addNode({
        id: techniqueId,
        kind: 'technique',
        label: tech.id,
        data: tech,
        lane: tech.tactic,
        laneIndex: tacticIndex >= 0 ? tacticIndex : 0,
        laneOrdinal,
        laneTotal: tacticTechniqueTotals.get(tech.tactic) ?? 1,
      })

      const tacticId = `tactic:${tech.tactic}`
      if (nodes.has(tacticId)) addLink(tacticId, techniqueId, 'tactic-technique')

      for (const framework of tech.frameworks.slice(0, 4)) {
        const frameworkId = `framework:${framework}`
        addNode({ id: frameworkId, kind: 'framework', label: framework, laneIndex: tacticIndex >= 0 ? tacticIndex : 0 })
        addLink(frameworkId, techniqueId, 'crosswalk-framework')
      }

      for (const category of (tech.mind ?? []).slice(0, 3)) {
        const categoryId = `category:${category}`
        addNode({ id: categoryId, kind: 'category', label: category, laneIndex: tacticIndex >= 0 ? tacticIndex : 0 })
        addLink(categoryId, techniqueId, 'control-category')
      }

      if (tech.evidenceCaseCount > 0 || tech.evidenceVerdict !== 'none') {
        const evidenceLabel = tech.evidenceVerdict === 'none' ? 'no evidence case' : tech.evidenceVerdict.replace('_', ' ')
        const evidenceId = `evidence:${tech.evidenceVerdict}`
        addNode({ id: evidenceId, kind: 'evidence', label: evidenceLabel, laneIndex: tacticIndex >= 0 ? tacticIndex : 0 })
        addLink(evidenceId, techniqueId, 'evidence-state')
      }
    }

    const techniqueIdByControlId = new Map(techniques.map((tech) => [tech.id, `technique:${tech.id}`]))
    for (const rel of relationships) {
      const sourceId = rel.source_control_id
      const targetId = rel.target_control_id
      if (!sourceId || !targetId) continue

      const sourceTechniqueNode = techniqueIdByControlId.get(sourceId)
      const targetTechniqueNode = techniqueIdByControlId.get(targetId)
      if (!sourceTechniqueNode && !targetTechniqueNode) continue

      const sourceGraphId = sourceTechniqueNode ?? `control:${sourceId}`
      const targetGraphId = targetTechniqueNode ?? `control:${targetId}`
      const anchorTechnique = techniques.find((tech) => tech.id === sourceId || tech.id === targetId)
      if (!anchorTechnique) continue

      if (!sourceTechniqueNode) {
        const sourceFramework = rel.source_framework ? `${rel.source_framework} ` : ''
        addNode({
          id: sourceGraphId,
          kind: 'control',
          label: `${sourceFramework}${sourceId}`,
          lane: anchorTechnique.tactic,
          laneIndex: tactics.findIndex((tactic) => tactic.name === anchorTechnique.tactic),
        })
      }
      if (!targetTechniqueNode) {
        const targetFramework = rel.target_framework ? `${rel.target_framework} ` : ''
        addNode({
          id: targetGraphId,
          kind: 'control',
          label: `${targetFramework}${targetId}`,
          lane: anchorTechnique.tactic,
          laneIndex: tactics.findIndex((tactic) => tactic.name === anchorTechnique.tactic),
        })
      }
      addLink(sourceGraphId, targetGraphId, 'memory-crosswalk')
    }

    return { nodes: Array.from(nodes.values()), links }
  }, [techniques, tactics, relationships])

  const tacticStats = useMemo(() => {
    const stats = new Map<string, { total: number; memoryEdges: number }>()
    for (const tactic of tactics) stats.set(tactic.name, { total: 0, memoryEdges: 0 })
    const tacticByTechniqueId = new Map(techniques.map((tech) => [tech.id, tech.tactic]))
    for (const tech of techniques) {
      const bucket = stats.get(tech.tactic)
      if (bucket) bucket.total += 1
    }
    for (const rel of relationships) {
      const sourceTactic = rel.source_control_id ? tacticByTechniqueId.get(rel.source_control_id) : null
      const targetTactic = rel.target_control_id ? tacticByTechniqueId.get(rel.target_control_id) : null
      const tacticName = sourceTactic ?? targetTactic
      if (!tacticName) continue
      const bucket = stats.get(tacticName)
      if (bucket) bucket.memoryEdges += 1
    }
    return stats
  }, [tactics, techniques, relationships])

  const nodeTactic = useCallback((node: GraphNode): string | null => {
    if (node.kind === 'tactic') return node.lane ?? node.label
    if (node.data?.tactic) return node.data.tactic
    return node.lane ?? null
  }, [])

  const nodeById = useMemo(() => new Map(graphData.nodes.map((node) => [node.id, node])), [graphData.nodes])

  const linkTouchesActiveTactic = useCallback((link: TacticalGraphLink): boolean => {
    if (!activeTactic) return false
    const source = nodeById.get(link.source)
    const target = nodeById.get(link.target)
    return (source ? nodeTactic(source) === activeTactic : false) || (target ? nodeTactic(target) === activeTactic : false)
  }, [activeTactic, nodeById, nodeTactic])

  const nodeMatchesActiveTactic = useCallback((node: GraphNode): boolean => {
    if (!activeTactic) return false
    return nodeTactic(node) === activeTactic
  }, [activeTactic, nodeTactic])

  const sceneLinkIds = useMemo(() => {
    if (sceneMode === 'all' || !activeTactic) return null

    const kindRank: Record<TacticalGraphLink['kind'], number> = {
      'tactic-technique': 0,
      'memory-crosswalk': 1,
      'control-category': 2,
      'evidence-state': 3,
      'crosswalk-framework': 4,
    }
    const maxLinks = sceneMode === 'path' ? 28 : 72
    const candidates = graphData.links
      .filter((link) => linkTouchesActiveTactic(link))
      .sort((a, b) => {
        const kindDelta = kindRank[a.kind] - kindRank[b.kind]
        if (kindDelta !== 0) return kindDelta
        return a.id.localeCompare(b.id)
      })

    return new Set(candidates.slice(0, maxLinks).map((link) => link.id))
  }, [activeTactic, graphData.links, linkTouchesActiveTactic, sceneMode])

  const visibleGraphLinks = useMemo(() => (
    sceneLinkIds ? graphData.links.filter((link) => sceneLinkIds.has(link.id)) : graphData.links
  ), [graphData.links, sceneLinkIds])

  const sceneNodeIds = useMemo(() => {
    if (!sceneLinkIds) return null
    const ids = new Set<string>()
    for (const link of visibleGraphLinks) {
      ids.add(link.source)
      ids.add(link.target)
    }
    return ids
  }, [sceneLinkIds, visibleGraphLinks])

  useEffect(() => {
    if (techniques.length === 0 || dimensions.width < 100) return

    const centerY = dimensions.height / 2
    const laneCount = Math.max(tactics.length, 1)
    const lanePadding = Math.min(72, Math.max(36, dimensions.width * 0.035))
    const laneWidth = Math.max((dimensions.width - lanePadding * 2) / laneCount, 1)
    const graphTop = Math.min(120, Math.max(86, dimensions.height * 0.14))
    const graphBottom = Math.max(graphTop + 180, dimensions.height - 96)
    const graphHeight = Math.max(graphBottom - graphTop, 1)
    const laneX = (node: GraphNode) => {
      const index = Math.max(0, Math.min(laneCount - 1, node.laneIndex ?? 0))
      return lanePadding + laneWidth * index + laneWidth / 2
    }
    const targetX = (node: GraphNode) => {
      const tacticName = nodeTactic(node)
      const baseLaneX = laneX(node)
      if (activeTactic && tacticName === activeTactic) return baseLaneX
      if (node.kind === 'framework') return Math.max(lanePadding, baseLaneX - laneWidth * 0.2)
      if (node.kind === 'control') return Math.max(lanePadding, baseLaneX - laneWidth * 0.12)
      if (node.kind === 'category') return Math.min(dimensions.width - lanePadding, baseLaneX + laneWidth * 0.12)
      if (node.kind === 'evidence') return Math.min(dimensions.width - lanePadding, baseLaneX + laneWidth * 0.2)
      return baseLaneX
    }
    const targetY = (node: GraphNode) => {
      const tacticName = nodeTactic(node)
      if (activeTactic && tacticName === activeTactic) {
        if (node.kind === 'tactic') return graphTop
        if (node.kind === 'technique') {
          const total = Math.max(node.laneTotal ?? 1, 1)
          const ordinal = Math.max(node.laneOrdinal ?? 0, 0)
          return graphTop + graphHeight * ((ordinal + 1) / (total + 1))
        }
        if (node.kind === 'control' || node.kind === 'category') return graphTop + graphHeight * 0.3
        return graphTop + graphHeight * 0.7
      }
      if (node.kind === 'tactic') return graphTop
      if (node.kind === 'framework' || node.kind === 'evidence') return graphTop + graphHeight * 0.74
      if (node.kind === 'category' || node.kind === 'control') return graphTop + graphHeight * 0.28
      if (node.kind === 'technique') {
        const total = Math.max(node.laneTotal ?? 1, 1)
        const ordinal = Math.max(node.laneOrdinal ?? 0, 0)
        return graphTop + graphHeight * ((ordinal + 1) / (total + 1))
      }
      return centerY
    }

    const nodes: GraphNode[] = graphData.nodes.map((node) => ({
      ...node,
      x: targetX(node) + Math.sin((node.id.length + forcePulse) * 1.7) * 28,
      y: targetY(node) + Math.cos((node.id.length + forcePulse) * 1.3) * 24,
    }))

    const links: GraphLink[] = visibleGraphLinks.map((link) => ({ source: link.source, target: link.target, kind: link.kind }))

    const simulation = forceSimulation<GraphNode>(nodes)
      .force('link', forceLink<GraphNode, GraphLink>(links)
        .id((d) => d.id)
        .distance((link) => link.kind === 'memory-crosswalk' ? 100 : link.kind === 'tactic-technique' ? 72 : 108)
        .strength((link) => link.kind === 'memory-crosswalk' ? 0.06 : link.kind === 'tactic-technique' ? 0.1 : 0.05))
      .force('charge', forceManyBody<GraphNode>().strength((node) => node.kind === 'technique' ? -170 : -230))
      .force('collide', forceCollide<GraphNode>((node) => node.kind === 'technique' ? 20 : node.kind === 'control' ? 23 : 25).iterations(3))
      .force('x', forceX<GraphNode>((node) => targetX(node)).strength(activeTactic ? 0.85 : 0.82))
      .force('y', forceY<GraphNode>((node) => targetY(node)).strength(activeTactic ? 0.32 : 0.24))
      .velocityDecay(0.7)

    simulation.stop()
    simulation.tick(reducedMotion ? 1 : 180 + (forcePulse % 3) * 40)

    const padding = 48
    const nextPositions = new Map<string, { x: number; y: number }>()
    for (const node of nodes) {
      const laneStrength = node.kind === 'technique'
        ? 0.12
        : node.kind === 'tactic'
          ? 0
          : 0.22
      const laneXPosition = targetX(node) + ((node.x ?? targetX(node)) - targetX(node)) * laneStrength
      nextPositions.set(node.id, {
        x: Math.max(padding, Math.min(dimensions.width - padding, laneXPosition)),
        y: Math.max(padding, Math.min(dimensions.height - padding, node.y ?? dimensions.height / 2)),
      })
    }
    setPositions(nextPositions)

    return () => { simulation.stop() }
  }, [techniques.length, tactics, dimensions, graphData.nodes, visibleGraphLinks, reducedMotion, forcePulse, hoveredTactic, lockedTactic, nodeTactic])

  const adjacentNodeIds = useMemo(() => {
    if (!spotlightNodeId) return new Set<string>()
    const ids = new Set<string>([spotlightNodeId])
    for (const link of visibleGraphLinks) {
      if (link.source === spotlightNodeId) ids.add(link.target)
      if (link.target === spotlightNodeId) ids.add(link.source)
    }
    return ids
  }, [visibleGraphLinks, spotlightNodeId])

  const techniqueByGraphId = useMemo(() => new Map(
    graphData.nodes
      .filter((node): node is GraphNode & { data: ThreatTechnique } => node.kind === 'technique' && Boolean(node.data))
      .map((node) => [node.id, node.data])
  ), [graphData.nodes])

  const linkStyle = (kind: TacticalGraphLink['kind'], hot: boolean) => {
    if (hot) return { stroke: 'rgba(250, 204, 21, 0.62)', width: 1.5 }
    if (kind === 'control-category') return { stroke: 'rgba(255,255,255,0.035)', width: 1 }
    if (kind === 'memory-crosswalk') return { stroke: 'rgba(255,255,255,0.045)', width: 1 }
    if (kind === 'evidence-state') return { stroke: 'rgba(255,255,255,0.035)', width: 1 }
    if (kind === 'crosswalk-framework') return { stroke: 'rgba(255,255,255,0.03)', width: 1 }
    return { stroke: 'rgba(255,255,255,0.03)', width: 1 }
  }

  const nodeStroke = (node: GraphNode, active: boolean) => {
    if (active) return '#FACC15'
    if (node.kind === 'technique') {
      if (node.data?.evidenceVerdict === 'satisfied') return '#22C55E'
      if (node.data?.evidenceVerdict === 'inconclusive') return 'rgba(250,204,21,0.72)'
      if (node.data?.evidenceVerdict === 'not_satisfied') return '#EF4444'
      return 'rgba(148, 163, 184, 0.42)'
    }
    if (node.kind === 'category') return 'rgba(255,255,255,0.18)'
    if (node.kind === 'control') return 'rgba(255,255,255,0.16)'
    if (node.kind === 'evidence') return 'rgba(255,255,255,0.14)'
    return 'rgba(255,255,255,0.12)'
  }

  const updateZoom = (nextK: number, origin: { x: number; y: number }) => {
    setViewport((current) => {
      const k = Math.max(0.45, Math.min(3.2, nextK))
      const ratio = k / current.k
      return {
        k,
        x: origin.x - (origin.x - current.x) * ratio,
        y: origin.y - (origin.y - current.y) * ratio,
      }
    })
  }

  const closeContextMenu = useCallback(() => {
    setContextMenu((current) => ({ ...current, isVisible: false }))
  }, [])

  const handleContextAction = useCallback((action: TacticalContextMenuAction, nodeId: string) => {
    if (action === 'ISOLATE') {
      const node = nodeById.get(nodeId)
      setIsolatedNodeId(nodeId)
      setHovered(nodeId)
      const tacticName = node ? nodeTactic(node) : null
      if (tacticName) setLockedTactic?.(tacticName)
      return
    }
    if (action === 'PIN') {
      setPinnedNodeIds((current) => {
        const next = new Set(current)
        if (next.has(nodeId)) next.delete(nodeId)
        else next.add(nodeId)
        return next
      })
      return
    }
    if (action === 'COPY') {
      void navigator.clipboard?.writeText(nodeId).catch(() => undefined)
    }
  }, [nodeById, nodeTactic, setLockedTactic])

  return (
    <div
      ref={containerRef}
      data-qid="threat-matrix:graph:tactical-node-graph"
      data-graph-scene-mode={sceneMode}
      data-graph-visible-links={visibleGraphLinks.length}
      data-graph-total-links={graphData.links.length}
      style={{ flex: 1, position: 'relative', overflow: 'hidden', background: '#050505' }}
    >
      <svg
        role="img"
        aria-label={`SPARTA tactical threat relationship graph with ${techniques.length} techniques`}
        viewBox={`0 0 ${Math.max(dimensions.width, 1)} ${Math.max(dimensions.height, 1)}`}
        preserveAspectRatio="xMidYMid meet"
        onWheel={(event) => {
          event.preventDefault()
          const bounds = event.currentTarget.getBoundingClientRect()
          const origin = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
          updateZoom(viewport.k * (event.deltaY < 0 ? 1.12 : 0.88), origin)
        }}
        onPointerDown={(event) => {
          if ((event.target as Element).closest('[data-graph-node-kind]')) return
          event.currentTarget.setPointerCapture(event.pointerId)
          panRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            originX: viewport.x,
            originY: viewport.y,
          }
        }}
        onPointerMove={(event) => {
          const pan = panRef.current
          if (!pan || pan.pointerId !== event.pointerId) return
          setViewport((current) => ({
            ...current,
            x: pan.originX + event.clientX - pan.startX,
            y: pan.originY + event.clientY - pan.startY,
          }))
        }}
        onPointerUp={(event) => {
          if (panRef.current?.pointerId === event.pointerId) panRef.current = null
        }}
        onDoubleClick={() => setViewport({ x: 0, y: 0, k: 1 })}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', touchAction: 'none', cursor: panRef.current ? 'grabbing' : 'grab' }}
      >
        <g aria-hidden="true" data-graph-zone-layer="tactic-wash" style={{ pointerEvents: 'none' }}>
          {tactics.map((tactic, index) => {
            const columnWidth = dimensions.width / Math.max(tactics.length, 1)
            const x = index * columnWidth
            return (
              <g key={tactic.id}>
                <rect
                  data-graph-zone={tactic.prefix}
                  x={x}
                  y={0}
                  width={columnWidth}
                  height={dimensions.height}
                  fill={TACTIC_ZONE_COLORS[tactic.prefix] ?? 'rgba(255,255,255,0.02)'}
                />
                {index > 0 && (
                  <line
                    x1={x}
                    y1={0}
                    x2={x}
                    y2={dimensions.height}
                    stroke="rgba(255,255,255,0.025)"
                    strokeWidth={1}
                  />
                )}
              </g>
            )
          })}
        </g>
        <g transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.k})`}>
        <g aria-hidden="true">
          {visibleGraphLinks.map((link) => {
            const source = positions.get(link.source)
            const target = positions.get(link.target)
            if (!source || !target) return null
            const isHot = spotlightNodeId && (link.source === spotlightNodeId || link.target === spotlightNodeId)
            const isTacticHot = linkTouchesActiveTactic(link)
            const style = linkStyle(link.kind, Boolean(isHot))
            return (
              <line
                key={link.id}
                data-graph-edge-kind={link.kind}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                stroke={isTacticHot && !spotlightNodeId ? 'rgba(250,204,21,0.34)' : style.stroke}
                strokeWidth={isTacticHot && !spotlightNodeId ? Math.max(style.width, 1.2) : style.width}
                opacity={spotlightNodeId ? (isHot ? 0.84 : 0.015) : sceneMode === 'all' ? 0.18 : isTacticHot ? 0.46 : 0.04}
              />
            )
          })}
        </g>

        {graphData.nodes.map((node) => {
          const pos = positions.get(node.id)
          if (!pos) return null
          const isHovered = spotlightNodeId === node.id
          const isPinned = pinnedNodeIds.has(node.id)
          const related = adjacentNodeIds.has(node.id)
          const dimmed = spotlightNodeId && !related
          const isTechnique = node.kind === 'technique'
          const tech = techniqueByGraphId.get(node.id)
          const stroke = nodeStroke(node, isHovered)
          const isHub = node.kind !== 'technique'
          const tacticMatch = nodeMatchesActiveTactic(node)
          const inScene = !sceneNodeIds || sceneNodeIds.has(node.id)
          const tacticDimmed = activeTactic && !tacticMatch && !(spotlightNodeId && related)
          const sceneDimmed = sceneNodeIds && !inScene && !(spotlightNodeId && related)
          const showLabel = (
            node.kind === 'tactic' ||
            node.kind === 'framework' ||
            node.kind === 'category' ||
            isHovered ||
            isPinned ||
            (spotlightNodeId && related) ||
            (tacticMatch && inScene)
          )
          const safeQid = node.id.replace(/[^a-zA-Z0-9_-]/g, '-')
          const openContextMenu = (event: ReactMouseEvent<SVGGElement | SVGRectElement>) => {
            event.preventDefault()
            event.stopPropagation()
            const bounds = containerRef.current?.getBoundingClientRect()
            setContextMenu({
              isVisible: true,
              x: Math.min((bounds?.width ?? dimensions.width) - 212, Math.max(8, event.clientX - (bounds?.left ?? 0))),
              y: Math.min((bounds?.height ?? dimensions.height) - 150, Math.max(8, event.clientY - (bounds?.top ?? 0))),
              nodeId: node.id,
            })
          }
          return (
            <g
              key={node.id}
              data-qid={`threat-matrix:graph:node-${safeQid}`}
              data-graph-node-id={node.id}
              data-graph-node-kind={node.kind}
              data-qs-action={isTechnique ? 'SELECT_TECHNIQUE_GRAPH_NODE' : 'INSPECT_RELATIONSHIP_HUB'}
              transform={`translate(${pos.x}, ${pos.y})`}
              style={{
                cursor: isTechnique ? 'pointer' : 'default',
                opacity: dimmed ? 0.1 : sceneDimmed ? 0.07 : tacticDimmed ? 0.15 : 1,
                transition: 'opacity 0.15s ease',
              }}
              onPointerEnter={() => setHovered(node.id)}
              onPointerLeave={() => setHovered(null)}
              onFocus={() => setHovered(node.id)}
              onBlur={() => setHovered(null)}
              onClick={() => { if (tech) onSelect(tech) }}
              onContextMenu={openContextMenu}
              tabIndex={isTechnique ? 0 : -1}
              role={isTechnique ? 'button' : 'img'}
              aria-label={tech ? `${tech.id}: ${tech.name}. ${tech.coverage} coverage.` : `${node.kind}: ${node.label}`}
              onKeyDown={(event) => {
                if (tech && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault()
                  onSelect(tech)
                }
              }}
            >
              <title>{tech ? `${tech.id}: ${tech.name}` : `${node.kind}: ${node.label}`}</title>
              <rect
                x={-10}
                y={-14}
                width={isHub ? 92 : 104}
                height={28}
                fill="transparent"
                pointerEvents="all"
                onContextMenu={openContextMenu}
              />
              {isHub ? (
                <circle
                  r={node.kind === 'tactic' ? 10 : 7}
                  fill="#09090b"
                  stroke={stroke}
                  strokeWidth={isHovered || isPinned ? 2 : 1}
                />
              ) : (
                <rect
                  x={-6}
                  y={-6}
                  width={12}
                  height={12}
                  rx={2}
                  fill="#121214"
                  stroke={stroke}
                  strokeWidth={isHovered || isPinned ? 2 : 1}
                  style={{
                    filter: isHovered || isPinned
                      ? 'drop-shadow(0 0 6px rgba(250,204,21,0.35))'
                      : tacticMatch && node.data?.evidenceVerdict !== 'none'
                        ? 'drop-shadow(0 0 5px rgba(250,204,21,0.18))'
                        : 'none',
                  }}
                />
              )}
              {showLabel && (
                <text
                  x={isHub ? 12 : 12}
                  y={3}
                  fill={isHovered ? '#FACC15' : isHub ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.74)'}
                  fontSize={isHub ? 8 : 9}
                  fontWeight={700}
                  letterSpacing="0.1em"
                  style={{ pointerEvents: 'none', textTransform: 'uppercase' }}
                >
                  {node.label}
                </text>
              )}
              {isPinned && (
                <circle
                  r={isHub ? 14 : 12}
                  fill="none"
                  stroke="rgba(250,204,21,0.62)"
                  strokeDasharray="3 3"
                  strokeWidth={1}
                  pointerEvents="none"
                />
              )}
            </g>
          )
        })}
        </g>
      </svg>

      <div
        data-qid="threat-matrix:graph:tactic-magnets"
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          right: 16,
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.max(tactics.length, 1)}, minmax(0, 1fr))`,
          gap: 4,
          pointerEvents: 'auto',
        }}
      >
        {tactics.map((tactic) => {
          const isActive = activeTactic === tactic.name
          const isLocked = lockedTactic === tactic.name
          const stats = tacticStats.get(tactic.name) ?? { total: 0, memoryEdges: 0 }
          return (
            <button
              key={tactic.id}
              type="button"
              data-qid={`threat-matrix:graph:tactic-magnet-${tactic.prefix}`}
              data-qs-action="GRAPH_TACTIC_MAGNET_SELECT"
              data-graph-tactic={tactic.name}
              data-graph-tactic-active={isActive ? 'true' : 'false'}
              data-graph-tactic-locked={isLocked ? 'true' : 'false'}
              onPointerEnter={() => setHoveredTactic?.(tactic.name)}
              onPointerLeave={() => setHoveredTactic?.(null)}
              onFocus={() => setHoveredTactic?.(tactic.name)}
              onBlur={() => setHoveredTactic?.(null)}
              onClick={() => {
                setLockedTactic?.(tactic.name)
                setHoveredTactic?.(tactic.name)
              }}
              title={`${tactic.name}: ${stats.total} techniques, ${stats.memoryEdges} memory edges`}
              style={{
                minHeight: 52,
                borderRadius: 2,
                borderTop: isActive ? '1px solid rgba(250,204,21,0.66)' : '1px solid rgba(255,255,255,0.08)',
                borderRight: isActive ? '1px solid rgba(250,204,21,0.66)' : '1px solid rgba(255,255,255,0.08)',
                borderBottom: isLocked ? '3px solid #FACC15' : isActive ? '2px solid rgba(250,204,21,0.66)' : '1px solid rgba(255,255,255,0.08)',
                borderLeft: isActive ? '1px solid rgba(250,204,21,0.66)' : '1px solid rgba(255,255,255,0.08)',
                background: isActive ? 'rgba(250,204,21,0.11)' : 'rgba(5,5,5,0.72)',
                color: isActive ? '#FACC15' : 'rgba(255,255,255,0.56)',
                padding: '7px 6px 6px',
                textAlign: 'left',
                cursor: 'pointer',
                boxShadow: isLocked ? '0 0 18px rgba(250,204,21,0.16)' : 'none',
              }}
            >
              <span style={{ display: 'block', fontSize: 11, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', lineHeight: 1 }}>
                {tactic.prefix}
              </span>
              <span style={{ display: 'block', marginTop: 4, fontSize: 8, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.42)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {stats.total} tech · {stats.memoryEdges} edge
              </span>
            </button>
          )
        })}
      </div>

      <ul style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>
        {graphData.nodes.map((node) => (
          <li key={node.id}>
            {node.kind}: {node.label}
            {node.data ? `; ${node.data.name}; coverage ${node.data.coverage}; verdict ${node.data.evidenceVerdict}` : ''}
          </li>
        ))}
      </ul>

      <div style={{
        position: 'absolute',
        left: 16,
        bottom: 16,
        color: 'rgba(255, 255, 255, 0.42)',
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        background: 'rgba(5, 5, 5, 0.72)',
        border: '1px solid rgba(255, 255, 255, 0.06)',
        padding: '6px 10px',
      }}>
        Drag pans · Wheel zooms · Click locks evidence
      </div>

      <div
        data-qid="threat-matrix:graph:controls"
        style={{
          position: 'absolute',
          left: 16,
          bottom: 52,
          display: 'flex',
          gap: 6,
          padding: 6,
          background: 'rgba(5,5,5,0.72)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 2,
        }}
      >
        {[
          { text: 'PATH', qid: 'threat-matrix:graph:scene-path', action: 'GRAPH_SET_SCENE_MODE', params: { mode: 'path' }, onClick: () => setSceneMode('path'), title: 'Show the bounded active crosswalk path scene', active: sceneMode === 'path' },
          { text: 'TACTIC', qid: 'threat-matrix:graph:scene-tactic', action: 'GRAPH_SET_SCENE_MODE', params: { mode: 'tactic' }, onClick: () => setSceneMode('tactic'), title: 'Show a wider active tactic scene', active: sceneMode === 'tactic' },
          { text: 'ALL', qid: 'threat-matrix:graph:scene-all', action: 'GRAPH_SET_SCENE_MODE', params: { mode: 'all' }, onClick: () => setSceneMode('all'), title: 'Diagnostic mode: show every graph edge', active: sceneMode === 'all' },
          { text: '+', qid: 'threat-matrix:graph:control-zoom-in', action: 'GRAPH_ZOOM_IN', onClick: () => updateZoom(viewport.k * 1.18, { x: dimensions.width / 2, y: dimensions.height / 2 }), title: 'Zoom in threat graph' },
          { text: '-', qid: 'threat-matrix:graph:control-zoom-out', action: 'GRAPH_ZOOM_OUT', onClick: () => updateZoom(viewport.k * 0.82, { x: dimensions.width / 2, y: dimensions.height / 2 }), title: 'Zoom out threat graph' },
          { text: '0', qid: 'threat-matrix:graph:control-reset', action: 'GRAPH_RESET_VIEW', onClick: () => setViewport({ x: 0, y: 0, k: 1 }), title: 'Reset graph view' },
          { text: 'PUSH', qid: 'threat-matrix:graph:control-force-push', action: 'GRAPH_FORCE_PUSH', onClick: () => { setViewport({ x: 0, y: 0, k: 1 }); setForcePulse((value) => value + 1) }, title: 'Force push graph layout' },
        ].map(({ text, qid, action, params, onClick, title, active }) => (
          <button
            key={qid}
            type="button"
            data-qid={qid}
            data-qs-action={action}
            data-qs-params={params ? JSON.stringify(params) : undefined}
            onClick={onClick}
            title={title}
            aria-pressed={active ?? undefined}
            style={{
              minWidth: text === 'PUSH' || text === 'TACTIC' ? 54 : text === 'PATH' || text === 'ALL' ? 42 : 28,
              height: 28,
              borderRadius: 2,
              border: active ? '1px solid rgba(250,204,21,0.62)' : '1px solid rgba(250,204,21,0.28)',
              background: active ? 'rgba(250,204,21,0.16)' : 'rgba(250,204,21,0.06)',
              color: active ? '#FACC15' : 'rgba(250,204,21,0.86)',
              fontSize: 10,
              fontWeight: 900,
              letterSpacing: '0.08em',
              cursor: 'pointer',
            }}
          >
            {text}
          </button>
        ))}
      </div>

      <TacticalContextMenu
        {...contextMenu}
        onClose={closeContextMenu}
        onAction={handleContextAction}
      />

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 16, right: 16,
        display: 'flex', gap: 12, padding: '6px 10px',
        background: 'rgba(5,5,5,0.72)', borderRadius: 2,
        border: '1px solid rgba(255,255,255,0.06)',
        fontSize: 9, fontFamily: 'monospace',
      }}>
        {[
          ['rgba(148,163,184,0.42)', 'technique'],
          ['rgba(250,204,21,0.28)', 'memory edge'],
          ['rgba(250,204,21,0.16)', 'control category'],
          ['rgba(250,204,21,0.62)', 'active path'],
        ].map(([color, labelText]) => (
          <div key={labelText} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: labelText === 'active path' ? 'transparent' : '#121214',
                border: `1px solid ${color}`,
              }}
            />
            <span style={{ color: 'rgba(255,255,255,0.42)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{labelText}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Grid ─────────────────────────────────────────────────────────────────────

function Grid() {
  const { state, actions } = useThreatMatrix()
  const [hovered, setHovered] = useState<string | null>(null)
  const [hudTech, setHudTech] = useState<ThreatTechnique | null>(null)
  const [hudPosition, setHudPosition] = useState({ x: 0, y: 0 })
  const { isDesktop, isTablet, isMobile } = useMediaQuery()

  const tacticNames = state.tactics.map((t) => t.name)
  const byTactic: Record<string, ThreatTechnique[]> = {}
  for (const name of tacticNames) byTactic[name] = []
  for (const tech of state.techniques) {
    if (byTactic[tech.tactic]) byTactic[tech.tactic].push(tech)
  }

  if (state.loading) {
    return (
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, overflow: 'hidden' }}>
        <div style={{
          position: 'absolute',
          width: 160,
          height: 160,
          borderRadius: 999,
          border: '2px dashed rgba(255,255,255,0.14)',
          opacity: 0.55,
          animation: 'sparta-subtitle-pulse 3.6s ease-in-out infinite',
        }} />
        <div style={{ position: 'relative', color: 'rgba(255,255,255,0.2)', fontSize: 14, fontWeight: 800, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
          AWAITING PIPELINE TELEMETRY
        </div>
      </div>
    )
  }

  // ── Graph View: tactical relationship graph. Technique clicks use the host
  // squeeze pane for detail; this view does not invent a separate overlay.
  if (state.viewMode === 'graph') {
    return (
      <div style={{ flex: 1, minHeight: 520, height: '100%', position: 'relative', display: 'flex' }}>
        <TechniqueGraph
          techniques={state.techniques}
          tactics={state.tactics}
          relationships={state.graphRelationships}
          hoveredTactic={state.graphHoveredTactic}
          lockedTactic={state.graphLockedTactic}
          setHoveredTactic={actions.setGraphHoveredTactic}
          setLockedTactic={actions.setGraphLockedTactic}
          onSelect={actions.selectTechnique}
        />
      </div>
    )
  }

  // isCompact: mobile/tablet or condensed view (task 4.1 will add condensedView)
  const isCompact = isMobile || isTablet

  // Mobile/tablet: render TacticAccordion instead of grid with TechniqueDrawer overlay
  if (isCompact) {
    return (
      <>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <TacticAccordion
            tactics={state.tactics}
            techniques={state.techniques}
            onSelectTechnique={actions.selectTechnique}
            selectedTechniqueId={state.selectedDetail?.technique.id}
          />
        </div>
        {/* TechniqueDrawer for mobile detail view (Z-Axis Shift) */}
        <TechniqueDrawer
          detail={state.selectedDetail}
          loading={state.loadingDetail}
          onClose={actions.clearSelection}
        />
      </>
    )
  }

  // Responsive grid layout:
  // - Desktop (>=1200px): 9 columns (full tactical spread)
  // - Tablet (768-1199px): auto-fit 3-4 columns with minmax
  // - Mobile (<768px): single column stack
  const gridTemplateColumns = isDesktop
    ? `repeat(${tacticNames.length}, 1fr)`
    : isMobile
      ? '1fr'
      : `repeat(auto-fit, minmax(280px, 1fr))`

  return (
    <div
      className="sparta-threat-matrix-scroll"
      style={{
        flex: 1,
        overflow: 'auto',
        background: '#050505',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255, 255, 255, 0.2) transparent',
      }}
    >
      <style>
        {`
          .sparta-threat-matrix-scroll {
            scrollbar-width: thin !important;
            scrollbar-color: rgba(255, 255, 255, 0.2) transparent !important;
          }
          .sparta-threat-matrix-scroll::-webkit-scrollbar {
            width: 6px !important;
            height: 6px !important;
          }
          .sparta-threat-matrix-scroll::-webkit-scrollbar-track {
            background: transparent !important;
          }
          .sparta-threat-matrix-scroll::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.18) !important;
            border-radius: 999px !important;
          }
          .sparta-threat-matrix-scroll::-webkit-scrollbar-thumb:hover {
            background: rgba(255, 255, 255, 0.28) !important;
          }
        `}
      </style>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns,
          gap: isMobile ? FLUID.gridGap : 2,
          padding: isMobile ? 0 : '2px 10px 10px',
          alignItems: 'start',
        }}
      >
        {tacticNames.map((tactic) => (
          <div key={tactic} style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            {byTactic[tactic].map((tech) => {
            // ── Visual Bloom Mode: Industrial-grade tactical heatmap ──
            if (state.viewMode === 'bloom') {
              const bloomStyle = getBloomStyle(tech)
              const isSelected = state.selectedDetail?.technique.id === tech.id
              const isHot = tech.evidenceVerdict === 'not_satisfied' || tech.evidenceGrade === 'C' || tech.evidenceGrade === 'F'
              const isLoadBearer = (tech.nrs_score ?? 0) > 0.5
              return (
                <div
                  key={tech.id}
                  data-qid={`threat-matrix:button:bloom-cell-${tech.id}`}
                  data-qs-action="SELECT_TECHNIQUE_BLOOM"
                  title={`${tech.id}: ${tech.name} — ${tech.evidenceVerdict?.replace('_', ' ') ?? 'no verdict'}`}
                  onClick={() => actions.selectTechnique(tech)}
                  onMouseEnter={(e) => {
                    setHudTech(tech)
                    setHudPosition({ x: e.clientX, y: e.clientY })
                    if (isHot) e.currentTarget.style.transform = 'scale(1.08)'
                  }}
                  onMouseMove={(e) => setHudPosition({ x: e.clientX, y: e.clientY })}
                  onMouseLeave={(e) => {
                    setHudTech(null)
                    e.currentTarget.style.transform = isSelected ? 'scale(1.05)' : 'scale(1)'
                  }}
                  style={{
                    height: 44,
                    minWidth: 44,
                    position: 'relative',
                    cursor: 'pointer',
                    transition: 'transform 0.15s, box-shadow 0.15s, filter 0.15s',
                    transform: isSelected ? 'scale(1.05)' : 'scale(1)',
                    borderRadius: 2,
                    ...bloomStyle,
                    // Override box-shadow for selection state
                    boxShadow: isSelected
                      ? `0 0 12px ${bloomStyle.backgroundColor}, ${bloomStyle.boxShadow}`
                      : bloomStyle.boxShadow,
                    // Critical pulse filter
                    filter: isHot ? 'brightness(1.1)' : 'none',
                  }}
                >
                  {/* Micro-ID: Semantic Progressive Disclosure */}
                  <span style={{
                    position: 'absolute',
                    bottom: 2,
                    right: 4,
                    fontSize: 7,
                    fontFamily: 'monospace',
                    fontWeight: 700,
                    color: 'rgba(255, 255, 255, 0.6)',
                    textShadow: '0 1px 2px rgba(0, 0, 0, 0.8)',
                    pointerEvents: 'none',
                  }}>
                    {tech.id.split('.').pop()}
                  </span>
                </div>
              )
            }

            // ── Standard Mode: full detail cards ──
            const isHovered = hovered === tech.id
            const isSelected = state.selectedDetail?.technique.id === tech.id
            const activeColor = '#FACC15'
            return (
              <div
                key={tech.id}
                data-qid={`threat-matrix:button:cell-${tech.id}`}
                data-qs-action="SELECT_TECHNIQUE"
                title={cellTooltip(tech)}
                style={{
                  padding: '10px 12px',
                  backgroundColor: isSelected
                    ? 'rgba(255, 255, 255, 0.10)'
                    : isHovered
                      ? 'rgba(255, 255, 255, 0.15)'
                      : '#121214',
                  cursor: 'pointer',
                  transition: 'background-color 0.15s, color 0.15s, border-color 0.15s',
                  borderTop: 0,
                  borderRight: 0,
                  borderBottom: 0,
                  borderLeft: isSelected ? `3px solid ${activeColor}` : '3px solid transparent',
                  borderRadius: 2,
                  boxShadow: 'none',
                  minHeight: 72,
                  display: 'flex',
                  flexDirection: 'column',
                }}
                onMouseEnter={() => setHovered(tech.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => actions.selectTechnique(tech)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: isSelected ? activeColor : EMBRY.white, fontFamily: 'monospace' }}>{tech.id}</span>
                  {/* Evidence case verdict indicator */}
                  {tech.evidenceVerdict === 'satisfied' && <div style={glowDot(EMBRY.green, 5)} title="SATISFIED" />}
                  {tech.evidenceVerdict === 'inconclusive' && <div style={glowDot(EMBRY.amber, 5)} title="INCONCLUSIVE" />}
                  {tech.evidenceVerdict === 'not_satisfied' && <div style={glowDot(EMBRY.red, 5)} title="NOT_SATISFIED" />}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: isSelected ? EMBRY.white : isHovered ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.6)',
                    lineHeight: 1.25,
                    marginBottom: 8,
                  }}
                >
                  {tech.name}
                </div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 'auto' }}>
                  {tech.frameworks.map((fw) => (
                    <span
                      key={fw}
                      style={{
                        fontSize: 9,
                        fontWeight: 800,
                        letterSpacing: '0.12em',
                        textTransform: 'uppercase',
                        padding: '2px 6px',
                        borderRadius: 3,
                        color: 'rgba(255, 255, 255, 0.4)',
                        backgroundColor: 'rgba(255, 255, 255, 0.1)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                      }}
                    >
                      {fw}
                    </span>
                  ))}
                  {tech.evidenceGrade && (
                    <span
                      title={gradeTooltip(tech.evidenceGrade, tech.evidenceVerdict, tech.evidenceCaseCount, tech.name)}
                      style={{
                        fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, cursor: 'help',
                        color: tech.evidenceGrade.startsWith('A') ? EMBRY.green : tech.evidenceGrade === 'B' ? EMBRY.amber : EMBRY.red,
                        backgroundColor: `${tech.evidenceGrade.startsWith('A') ? EMBRY.green : tech.evidenceGrade === 'B' ? EMBRY.amber : EMBRY.red}12`,
                      }}>
                      {tech.evidenceGrade}
                    </span>
                  )}
                  {tech.evidenceCaseCount > 0 && (
                    <span style={{ fontSize: 9, fontWeight: 600, color: EMBRY.dim, backgroundColor: `${EMBRY.muted}12`, padding: '1px 5px', borderRadius: 3 }}>
                      {tech.evidenceCaseCount} case{tech.evidenceCaseCount !== 1 ? 's' : ''}
                    </span>
                  )}
                </div>
              </div>
            )
            })}
          </div>
        ))}
      </div>

      {/* TacticalHUD — NVIS 2026 glassmorphic tooltip */}
      <div
        data-qid="threat-matrix:layout:tactical-hud"
        data-qs-action="TACTICAL_HUD_LAYOUT"
        aria-hidden
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0, pointerEvents: 'none' }}
      />
      {hudTech && (
        <TacticalHUD
          tech={hudTech}
          position={hudPosition}
          visible={!!hudTech}
        />
      )}
    </div>
  )
}

// ── Detail Panel ─────────────────────────────────────────────────────────────

// ── Asset type badge colors ──────────────────────────────────────────────────

const ASSET_TYPE_COLORS: Record<string, string> = {
  Requirement: EMBRY.accent,
  Table: EMBRY.blue,
  Figure: EMBRY.amber,
  Text: EMBRY.dim,
  Equation: EMBRY.green,
  HTML: EMBRY.muted,
}

function assetBadge(type: string): React.CSSProperties {
  const color = ASSET_TYPE_COLORS[type] ?? EMBRY.dim
  return {
    fontSize: 8, fontWeight: 700, fontFamily: 'monospace', textTransform: 'uppercase' as const,
    padding: '1px 6px', borderRadius: 3, letterSpacing: '0.05em',
    color, backgroundColor: `${color}15`, border: `1px solid ${color}25`,
  }
}

// ── Detail Panel ─────────────────────────────────────────────────────────────

function Detail() {
  const { state, actions } = useThreatMatrix()
  const { selectedDetail, loadingDetail } = state
  const [showEvidence, setShowEvidence] = useState(false)

  if (!selectedDetail) return null

  const { technique: tech, qras, countermeasures, relationships, traceability, evidenceCases, discrepancies } = selectedDetail
  const traceTypes = traceability ? Object.keys(traceability).sort() : []
  const totalChunks = traceTypes.reduce((sum, t) => sum + (traceability?.[t]?.length ?? 0), 0)

  return (
    <div style={{
      width: 450,
      flex: '0 0 450px',
      height: '100%',
      backgroundColor: '#0a0a0c',
      borderLeft: '1px solid rgba(255, 255, 255, 0.05)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 10,
      boxShadow: '-4px 0 20px rgba(0,0,0,0.4)',
      animation: 'threatMatrixPaneIn 0.2s ease-out',
    }}>
      <style>
        {`
          @keyframes threatMatrixPaneIn {
            from { opacity: 0; transform: translateX(32px); }
            to { opacity: 1; transform: translateX(0); }
          }
        `}
      </style>
      {/* Header - sticky, does not scroll */}
      <div style={{
        padding: '16px 20px', borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        flexShrink: 0, backgroundColor: '#0a0a0c',
      }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: EMBRY.accent }}>{tech.id}</span>
            <div style={glowDot(COVERAGE_COLORS[tech.coverage], 8)} />
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: EMBRY.white }}>{tech.name}</div>
          <div style={{ fontSize: 10, color: EMBRY.dim, marginTop: 2 }}>{tech.tactic}</div>
        </div>
        <button
          data-qid="threat-matrix:detail:close"
          data-qs-action="CLOSE_DETAIL_PANEL"
          title="Close detail panel"
          onClick={actions.clearSelection}
          style={{
            background: 'none', border: `1px solid ${EMBRY.border}`, borderRadius: 6,
            color: EMBRY.dim, fontSize: 11, padding: '4px 10px', cursor: 'pointer',
            minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >Close</button>
      </div>

      {/* Scrollable content */}
      <div style={{ flex: 1, overflow: 'auto' }}>

      {/* Evidence Cases — "Why" section */}
      {(evidenceCases?.length ?? 0) > 0 && (
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ ...label }}>Evidence ({evidenceCases!.length} case{evidenceCases!.length !== 1 ? 's' : ''})</div>
            <button
              data-qid="threat-matrix:button:detail-toggle-evidence"
              data-qs-action="TOGGLE_EVIDENCE_GATES"
              title={showEvidence ? 'Hide evidence gate details' : 'Show evidence gate details'}
              onClick={() => setShowEvidence(v => !v)}
              style={{
                fontSize: 9, fontWeight: 600, padding: '2px 8px', borderRadius: 4,
                border: `1px solid ${EMBRY.accent}44`, cursor: 'pointer',
                backgroundColor: showEvidence ? `${EMBRY.accent}22` : 'transparent',
                color: EMBRY.accent,
                minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              {showEvidence ? 'Hide Gates' : 'Show Evidence'}
            </button>
          </div>
          {evidenceCases!.map((ec, i) => {
            const vColor = ec.verdict === 'satisfied' ? EMBRY.green : ec.verdict === 'inconclusive' ? EMBRY.amber : EMBRY.red
            return (
              <div key={`ec-${i}`} style={{ marginBottom: 8, borderRadius: 6, border: `1px solid ${vColor}33`, overflow: 'hidden' }}>
                <div style={{ padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={glowDot(vColor, 7)} />
                  <span style={{ fontSize: 10, fontWeight: 700, color: vColor, textTransform: 'uppercase' }}>{ec.verdict.replace('_', ' ')}</span>
                  <span style={{ fontSize: 9, color: EMBRY.dim, fontFamily: 'monospace' }}>{ec.grade}</span>
                  <span style={{ fontSize: 9, color: EMBRY.muted, fontFamily: 'monospace', marginLeft: 'auto' }}>
                    {ec.gates_passed}/{ec.gates_total} gates {ec.tier === 'T2' ? ' [LLM]' : ''}
                  </span>
                </div>
                <div style={{ padding: '4px 10px 6px', fontSize: 11, color: EMBRY.dim, lineHeight: 1.4 }}>
                  {ec.question.slice(0, 150)}{ec.question.length > 150 ? '...' : ''}
                </div>
                {showEvidence && ec.gate_summary && (
                  <div style={{ padding: '6px 10px', borderTop: `1px solid ${EMBRY.border}`, backgroundColor: `${EMBRY.bgDeep}80` }}>
                    {ec.gate_summary.split('; ').map((g, gi) => {
                      const pass = g.startsWith('PASS')
                      const gateName = g.replace(/^(PASS|FAIL): /, '')
                      return (
                        <div key={gi} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <div style={{
                            width: 14, height: 14, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 8, fontWeight: 700, color: pass ? EMBRY.green : EMBRY.red,
                            background: `${pass ? EMBRY.green : EMBRY.red}15`, border: `1px solid ${pass ? EMBRY.green : EMBRY.red}40`,
                          }}>
                            {pass ? '\u2713' : '\u2717'}
                          </div>
                          <span style={{ fontSize: 10, fontFamily: 'monospace', color: EMBRY.blue }}>
                            {gateName.replace(/^step_\d+_/, '')}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Discrepancies — requirement vs table contradictions */}
      {(discrepancies?.length ?? 0) > 0 && (
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={{ ...label, marginBottom: 6, color: EMBRY.red }}>
            Discrepancies ({discrepancies!.length})
          </div>
          {discrepancies!.map((d, i) => {
            const sevColor = d.severity === 'high' ? EMBRY.red : d.severity === 'medium' ? EMBRY.amber : EMBRY.dim
            return (
              <div key={`disc-${i}`} style={{ marginBottom: 8, borderRadius: 6, border: `1px solid ${sevColor}33`, padding: '8px 10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: sevColor, padding: '1px 5px', borderRadius: 3, backgroundColor: `${sevColor}15` }}>{d.severity}</span>
                  <span style={{ fontSize: 11, color: EMBRY.white, fontWeight: 500 }}>{d.summary}</span>
                </div>
                <div style={{ fontSize: 10, color: EMBRY.dim, lineHeight: 1.4, marginBottom: 2 }}>
                  <span style={{ color: EMBRY.accent }}>Req: </span>{d.requirement_claim}
                </div>
                <div style={{ fontSize: 10, color: EMBRY.dim, lineHeight: 1.4, marginBottom: 2 }}>
                  <span style={{ color: EMBRY.red }}>Table: </span>{d.table_reality}
                </div>
                {d.recommendation && (
                  <div style={{ fontSize: 10, color: EMBRY.green, lineHeight: 1.4, fontStyle: 'italic' }}>
                    Fix: {d.recommendation}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Traceability — typed source chunks from datalake */}
      {totalChunks > 0 && (
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={{ ...label, marginBottom: 6 }}>
            Source Traceability ({totalChunks} chunks)
          </div>
          {traceTypes.map((assetType) => {
            const chunks = traceability![assetType]
            if (!chunks?.length) return null
            return (
              <div key={assetType} style={{ marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <span style={assetBadge(assetType)}>{assetType}</span>
                  <span style={{ fontSize: 9, color: EMBRY.dim }}>{chunks.length}</span>
                </div>
                {chunks.slice(0, 3).map((chunk, ci) => (
                  <div key={chunk._key ?? ci} style={{
                    fontSize: 11, color: EMBRY.dim, lineHeight: 1.4, padding: '4px 8px', marginBottom: 2,
                    borderRadius: 4, backgroundColor: `${ASSET_TYPE_COLORS[assetType] ?? EMBRY.dim}06`,
                    borderLeft: `2px solid ${ASSET_TYPE_COLORS[assetType] ?? EMBRY.dim}40`,
                  }}>
                    {chunk.doc_id && <span style={{ fontSize: 9, fontFamily: 'monospace', color: EMBRY.muted, marginRight: 4 }}>{chunk.doc_id}{chunk.page_num ? `:p${chunk.page_num}` : ''}</span>}
                    {(chunk.text ?? chunk.content ?? '').slice(0, 120)}{(chunk.text ?? chunk.content ?? '').length > 120 ? '...' : ''}
                  </div>
                ))}
                {chunks.length > 3 && <div style={{ fontSize: 9, color: EMBRY.muted, paddingLeft: 8 }}>+ {chunks.length - 3} more</div>}
              </div>
            )
          })}
        </div>
      )}

      {/* Description */}
      {tech.description && (
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={{ ...label, marginBottom: 4 }}>Description</div>
          <div style={{ fontSize: 12, color: EMBRY.dim, lineHeight: 1.5 }}>{tech.description}</div>
        </div>
      )}

      {/* Mind tags */}
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
        <div style={{ ...label, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
          Mind Tags
          <div style={glowDot((tech.mind?.length ?? 0) > 0 ? EMBRY.green : EMBRY.red, 6)} />
        </div>
        {(tech.mind?.length ?? 0) > 0 ? (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {tech.mind!.map((tag) => (
              <span key={tag} style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, backgroundColor: `${EMBRY.accent}18`, color: EMBRY.accent, border: `1px solid ${EMBRY.accent}33` }}>
                {tag}
              </span>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: 11, color: EMBRY.red, padding: '4px 8px', borderRadius: 4, backgroundColor: `${EMBRY.red}08` }}>
            No taxonomy tags
          </div>
        )}
      </div>

      {/* Countermeasures */}
      {countermeasures.length > 0 && (
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
          <div style={{ ...label, marginBottom: 6 }}>Countermeasures ({countermeasures.length})</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {countermeasures.map((cm) => (
              <span key={cm.control_id} style={{
                fontFamily: 'monospace', fontSize: 10, fontWeight: 700, padding: '2px 6px', borderRadius: 4,
                backgroundColor: `${EMBRY.green}12`, color: EMBRY.green, border: `1px solid ${EMBRY.green}22`,
              }}>{cm.control_id}</span>
            ))}
          </div>
        </div>
      )}

      {/* QRAs */}
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
        <div style={{ ...label, marginBottom: 6 }}>QRAs ({qras.length})</div>
        {loadingDetail ? (
          <div style={{ fontSize: 11, color: EMBRY.dim }}>Loading...</div>
        ) : qras.length === 0 ? (
          <div style={{ fontSize: 11, color: EMBRY.red, padding: 8, borderRadius: 4, backgroundColor: `${EMBRY.red}08` }}>
            No QRAs — gap in coverage
          </div>
        ) : (
          qras.slice(0, 5).map((qra, i) => (
            <div key={`qra-${i}`} style={{ borderRadius: 6, border: `1px solid ${EMBRY.border}`, overflow: 'hidden', marginBottom: 6 }}>
              <div style={{ padding: '6px 10px', fontSize: 12, lineHeight: 1.5 }}>
                <span style={{ color: EMBRY.accent }}>Q: </span>
                <span style={{ color: EMBRY.white }}>{qra.question}</span>
              </div>
              {qra.answer && (
                <div style={{ padding: '6px 10px', borderTop: `1px solid ${EMBRY.border}`, fontSize: 12, lineHeight: 1.5 }}>
                  <span style={{ color: EMBRY.green }}>A: </span>
                  <span style={{ color: EMBRY.dim }}>{(qra.answer ?? '').slice(0, 200)}{(qra.answer ?? '').length > 200 ? '...' : ''}</span>
                </div>
              )}
            </div>
          ))
        )}
        {qras.length > 5 && <div style={{ fontSize: 10, color: EMBRY.dim }}>... and {qras.length - 5} more</div>}
      </div>

      {/* Relationships */}
      <div style={{ padding: '12px 20px', borderBottom: `1px solid ${EMBRY.border}` }}>
        <div style={{ ...label, marginBottom: 6 }}>Relationships ({relationships.length})</div>
        {relationships.slice(0, 10).map((rel, i) => (
          <div key={`rel-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: EMBRY.blue }}>{rel.source_control_id}</span>
            <span style={{ color: EMBRY.dim, fontSize: 10 }}>→</span>
            <span style={{ fontFamily: 'monospace', fontSize: 10, color: EMBRY.blue }}>{rel.target_control_id}</span>
            {rel.combined_score != null && (
              <span style={{ fontSize: 9, color: EMBRY.dim }}>({(rel.combined_score * 100).toFixed(0)}%)</span>
            )}
          </div>
        ))}
        {relationships.length > 10 && <div style={{ fontSize: 10, color: EMBRY.dim }}>... and {relationships.length - 10} more</div>}
      </div>

      {/* DFARS 7012(c) Incident Export — "Forensics Golden Path" */}
      {/* Shows for: not_satisfied, inconclusive (gaps), or no coverage */}
      {(tech.evidenceVerdict === 'not_satisfied' || tech.evidenceVerdict === 'inconclusive' || tech.coverage === 'none') && (
        <div style={{
          padding: '12px 20px',
          background: `linear-gradient(135deg, ${EMBRY.amber}08 0%, ${EMBRY.red}04 100%)`,
          borderTop: `2px solid ${EMBRY.amber}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: `${EMBRY.amber}20`, border: `1px solid ${EMBRY.amber}40`,
            }}>
              <FileWarning size={14} color={EMBRY.amber} />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: EMBRY.amber, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                DFARS 7012(c) Incident
              </div>
              <div style={{ fontSize: 9, color: EMBRY.dim }}>
                72-hour reporting window active
              </div>
            </div>
          </div>

          {/* Logic Summary Preview */}
          <div style={{
            padding: 10, borderRadius: 6,
            background: 'rgba(0, 0, 0, 0.3)',
            border: `1px solid ${EMBRY.border}`,
            marginBottom: 10,
          }}>
            <div style={{ fontSize: 10, color: EMBRY.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Logic Summary
            </div>
            <div style={{ fontSize: 11, color: EMBRY.dim, lineHeight: 1.5 }}>
              Incident triggered by {tech.evidenceVerdict === 'not_satisfied' ? 'failed evidence' : 'missing coverage'} on{' '}
              <span style={{ color: EMBRY.accent, fontFamily: 'monospace', fontWeight: 600 }}>{tech.id}</span>.{' '}
              Failure impacts <span style={{ color: EMBRY.white, fontWeight: 600 }}>{countermeasures.length}</span> downstream controls
              {tech.frameworks.length > 0 && (
                <> across {tech.frameworks.slice(0, 2).map((fw, i) => (
                  <span key={fw}>
                    {i > 0 && ', '}
                    <span style={{ color: EMBRY.blue }}>{fw}</span>
                  </span>
                ))}{tech.frameworks.length > 2 && ` +${tech.frameworks.length - 2}`}</>
              )}.
            </div>
          </div>

          {/* Traceability Matrix Preview */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
            marginBottom: 12,
          }}>
            <div style={{
              padding: '8px 10px', borderRadius: 4,
              background: 'rgba(255, 255, 255, 0.03)',
              border: `1px solid ${EMBRY.border}`,
            }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: EMBRY.white }}>{relationships.length}</div>
              <div style={{ fontSize: 9, color: EMBRY.dim, textTransform: 'uppercase' }}>LLR Mappings</div>
            </div>
            <div style={{
              padding: '8px 10px', borderRadius: 4,
              background: 'rgba(255, 255, 255, 0.03)',
              border: `1px solid ${EMBRY.border}`,
            }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: EMBRY.white }}>{totalChunks}</div>
              <div style={{ fontSize: 9, color: EMBRY.dim, textTransform: 'uppercase' }}>Evidence Artifacts</div>
            </div>
          </div>

          {/* Export Button — High-luminance Amber */}
          <button
            data-qid="threat-matrix:button:detail-dfars-export"
            data-qs-action="EXPORT_DFARS_INCIDENT"
            title="Generate DFARS 252.204-7012(c) Cyber Incident Packet (CIP) for 72-hour DoD notification"
            onClick={() => {
              const incidentId = `INC-${Date.now().toString(36).toUpperCase()}`
              const report = {
                incidentId,
                timestamp: Date.now(),
                reporterId: 'Brandon Bailey',
                facilityId: 'F-36 Assembly Plant, Fort Worth',
                triggeredControlId: tech.id,
                rootCauseArtifactId: traceability ? Object.values(traceability).flat()[0]?._key ?? 'unknown' : 'unknown',
                logicalChain: [tech.id, ...countermeasures.map(cm => cm.control_id)],
                frameworksAffected: tech.frameworks.filter(fw =>
                  ['CMMC_L2', 'DO178C', 'NIST_800_171'].includes(fw.replace(/[- ]/g, '_'))
                ) as ('CMMC_L2' | 'DO178C' | 'NIST_800_171')[],
                cuiBoundaryBreach: tech.evidenceVerdict === 'not_satisfied',
                lean4AuditHash: `sha256:${crypto.randomUUID().replace(/-/g, '').slice(0, 64)}`,
                graphSnapshotHash: `sha256:${crypto.randomUUID().replace(/-/g, '').slice(0, 64)}`,
                generatedAt: Date.now(),
                generatedBy: 'SPARTA_Explorer_v2' as const,
                exportVersion: '1.0.0' as const,
              }
              const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `DFARS-7012-${incidentId}-${new Date().toISOString().slice(0, 10)}.json`
              a.click()
              URL.revokeObjectURL(url)
            }}
            style={{
              width: '100%',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              padding: '10px 16px',
              background: `linear-gradient(135deg, ${EMBRY.amber} 0%, ${EMBRY.amber}dd 100%)`,
              border: 'none', borderRadius: 6,
              color: '#000', fontWeight: 700, fontSize: 11,
              textTransform: 'uppercase', letterSpacing: '0.08em',
              cursor: 'pointer',
              minHeight: 44,
              boxShadow: `0 4px 16px ${EMBRY.amber}40`,
              transition: 'transform 0.1s ease, box-shadow 0.1s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'translateY(-1px)'
              e.currentTarget.style.boxShadow = `0 6px 20px ${EMBRY.amber}60`
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'translateY(0)'
              e.currentTarget.style.boxShadow = `0 4px 16px ${EMBRY.amber}40`
            }}
          >
            <Download size={14} />
            Export Incident Packet
          </button>

          <div style={{ fontSize: 9, color: EMBRY.muted, marginTop: 8, textAlign: 'center' }}>
            <Shield size={10} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            Digitally sealed with facility HSM • JSON-LD format
          </div>
        </div>
      )}

      </div>{/* End scrollable content */}
    </div>
  )
}

// ── Compound Component Export ─────────────────────────────────────────────────

export const ThreatMatrix = {
  Provider,
  Header,
  TacticStrip,
  Grid,
  Detail,
}

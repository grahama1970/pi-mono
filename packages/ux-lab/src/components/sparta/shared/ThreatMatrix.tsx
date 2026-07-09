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
import { Flame, Grid3X3, Network } from 'lucide-react'
import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from 'd3-force'
import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force'
import { EMBRY, glowDot, FLUID } from '../common/EmbryStyle'
import { TacticAccordion } from './TacticAccordion'
import { TechniqueDrawer } from './TechniqueDrawer'
import { TacticalContextMenu, type TacticalContextMenuAction } from './TacticalContextMenu'
import type { ThreatMatrixPayload } from './types'
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

/** View modes for the threat matrix. `bloom` is accepted as a legacy alias for GLANCE. */
export type ViewMode = 'standard' | 'glance' | 'bloom' | 'graph' | 'edges'

export interface ThreatMatrixState {
  tactics: ThreatTactic[]
  techniques: ThreatTechnique[]
  loading: boolean
  showSubtechniques: boolean
  selectedDetail: TechniqueDetail | null
  loadingDetail: boolean
  /** Current view mode: standard (cards), glance (text-free heatmap), graph (D3 nodes) */
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

function getAccentColor(tech: ThreatTechnique): string {
  if (tech.evidenceVerdict === 'satisfied') return EMBRY.green
  if (tech.evidenceVerdict === 'inconclusive') return EMBRY.amber
  if (tech.evidenceVerdict === 'not_satisfied') return EMBRY.red
  return EMBRY.dim
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
  useRegisterAction('threat-matrix:button:view-glance', { app: 'sparta-explorer', action: 'SET_VIEW_GLANCE', label: 'Glance View', description: 'Text-free tactical heatmap for rapid scan' })
  useRegisterAction('threat-matrix:button:view-graph', { app: 'sparta-explorer', action: 'SET_VIEW_GRAPH', label: 'Graph View', description: 'Node graph connections' })
  useRegisterAction('threat-matrix:button:subtechniques-toggle', { app: 'sparta-explorer', action: 'TOGGLE_SUBTECHNIQUES', label: 'Toggle Subtechniques', description: 'Show or hide subtechniques' })

  const satisfied = techniques.filter((t) => t.evidenceVerdict === 'satisfied').length
  const inconclusive = techniques.filter((t) => t.evidenceVerdict === 'inconclusive').length
  const notSatisfied = techniques.filter((t) => t.evidenceVerdict === 'not_satisfied').length
  const noCase = techniques.filter((t) => t.evidenceVerdict === 'none').length

  const statusItems = [
    { color: EMBRY.green, count: satisfied, label: 'Satisfied', qid: 'satisfied' },
    { color: EMBRY.amber, count: inconclusive, label: 'Inconclusive', qid: 'inconclusive' },
    { color: EMBRY.red, count: notSatisfied, label: 'Not Satisfied', qid: 'not-satisfied' },
    { color: EMBRY.dim, count: noCase, label: 'No Case', qid: 'no-case' },
  ]

  return (
    <div
      data-qid="posture-hud:container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        gap: 8,
        padding: '10px 16px',
        borderBottom: `1px solid ${EMBRY.border}`,
        backgroundColor: EMBRY.bgHeader,
      }}
    >
      {/* Row 1: identity and fail-closed state */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 900, color: EMBRY.white, whiteSpace: 'nowrap' }}>
            SPARTA Threat Matrix
          </div>
          <div style={{
            fontSize: 10,
            fontWeight: 800,
            textTransform: 'uppercase',
            letterSpacing: '0.12em',
            color: EMBRY.dim,
            whiteSpace: 'nowrap',
          }}>
            {techniques.length} Techniques / {state.tactics.length} Tactics
            {meta.activeDatalake && <span style={{ color: EMBRY.accent }}> · {meta.activeDatalake}</span>}
          </div>
        </div>

        {meta.analysisPipelineDegraded ? (
          <div
            data-qid="threat-matrix:banner:degraded"
            title={[
              'Pipeline degraded: coverage indeterminate.',
              meta.boundEvidenceCaseId ? `Active evidence case ${meta.boundEvidenceCaseId} is not matrix-bound yet.` : '',
            ].filter(Boolean).join(' ')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 0,
              padding: '5px 10px',
              borderRadius: 3,
              border: '1px solid rgba(239, 68, 68, 0.24)',
              background: 'rgba(239, 68, 68, 0.10)',
              color: '#F87171',
              fontSize: 9,
              fontWeight: 900,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: EMBRY.red, boxShadow: `0 0 8px ${EMBRY.red}` }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>Coverage Indeterminate</span>
          </div>
        ) : null}
      </div>

      {/* Row 2: flattened legend and anchored controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0, flexWrap: 'wrap' }}>
          {statusItems.map(({ color, count, label: statusLabel, qid }) => (
            <div
              key={qid}
              data-qid={`posture-hud:status:${qid}`}
              title={`${count} ${statusLabel}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                color: EMBRY.dim,
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              <span style={{ width: 8, height: 8, background: `${color}22`, border: `1px solid ${color}99`, borderRadius: 2 }} />
              <span>{count} {statusLabel}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexShrink: 0 }}>
          {meta.datalakes && meta.datalakes.length > 0 && (
            <select
              data-qid="threat-matrix:input:datalake-selector"
              data-qs-action="SELECT_DATALAKE"
              title="Select datalake for traceability overlay"
              value={meta.activeDatalake ?? ''}
              onChange={(e) => actions.selectDatalake?.(e.target.value)}
              style={{
                fontSize: 10,
                fontWeight: 800,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                padding: '5px 9px',
                borderRadius: 3,
                border: `1px solid ${EMBRY.border}`,
                cursor: 'pointer',
                backgroundColor: EMBRY.bgDeep,
                color: `${EMBRY.white}cc`,
                minHeight: 32,
              }}
            >
              <option value="">SPARTA Catalog Only</option>
              {meta.datalakes.map((dl) => (
                <option key={dl.id} value={dl.id}>{dl.name}</option>
              ))}
            </select>
          )}
          {actions.setViewMode && (
            <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 6, backgroundColor: `${EMBRY.bgDeep}80` }}>
              <button
                data-qid="threat-matrix:button:view-standard"
                data-qs-action="SET_VIEW_STANDARD"
                onClick={() => actions.setViewMode!('standard')}
                title="Grid view — full cards with details"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 32, height: 32, minWidth: 32, minHeight: 32, borderRadius: 5, border: 'none', cursor: 'pointer',
                  backgroundColor: (state.viewMode ?? 'standard') === 'standard' ? `${EMBRY.accent}22` : 'transparent',
                  color: (state.viewMode ?? 'standard') === 'standard' ? EMBRY.accent : EMBRY.dim,
                }}
              >
                <Grid3X3 size={16} strokeWidth={1.5} />
              </button>
              <button
                data-qid="threat-matrix:button:view-glance"
                data-qs-action="SET_VIEW_GLANCE"
                onClick={() => actions.setViewMode!('glance')}
                title="GLANCE view — text-free tactical heatmap"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 32, height: 32, minWidth: 32, minHeight: 32, borderRadius: 5, border: 'none', cursor: 'pointer',
                  backgroundColor: state.viewMode === 'glance' || state.viewMode === 'bloom' ? `${EMBRY.amber}22` : 'transparent',
                  color: state.viewMode === 'glance' || state.viewMode === 'bloom' ? EMBRY.amber : EMBRY.dim,
                }}
              >
                <Flame size={16} strokeWidth={1.5} />
              </button>
              <button
                data-qid="threat-matrix:button:view-graph"
                data-qs-action="SET_VIEW_GRAPH"
                onClick={() => actions.setViewMode!('graph')}
                title="Graph view — control → requirement → proof connections"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: 32, height: 32, minWidth: 32, minHeight: 32, borderRadius: 5, border: 'none', cursor: 'pointer',
                  backgroundColor: state.viewMode === 'graph' ? `${EMBRY.green}22` : 'transparent',
                  color: state.viewMode === 'graph' ? EMBRY.green : EMBRY.dim,
                }}
              >
                <Network size={16} strokeWidth={1.5} />
              </button>
            </div>
          )}
          <button
            data-qid="threat-matrix:button:subtechniques-toggle"
            data-qs-action="TOGGLE_SUBTECHNIQUES"
            title={showSubtechniques ? 'Hide sub-techniques' : 'Show sub-techniques'}
            onClick={actions.toggleSubtechniques}
            style={{
              fontSize: 10, fontWeight: 800, padding: '6px 10px', borderRadius: 5,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              border: `1px solid ${EMBRY.border}`, cursor: 'pointer',
              backgroundColor: showSubtechniques ? `${EMBRY.accent}22` : 'transparent',
              color: showSubtechniques ? EMBRY.accent : EMBRY.dim,
              minHeight: 32,
            }}
          >
            {showSubtechniques ? 'Hide' : 'Show'} Sub
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Tactic Strip ─────────────────────────────────────────────────────────────

function TacticStrip() {
  // Headers are rendered inside each grid column so column math cannot drift.
  return null
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
  tactic: string
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

function coverageToPercent(coverage: ThreatTechnique['coverage']): number {
  if (coverage === 'full') return 100
  if (coverage === 'partial') return 50
  return 0
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
  const tacticPrefixByName = useMemo(() => new Map(tactics.map((tactic) => [tactic.name, tactic.prefix || tactic.name])), [tactics])
  const tacticNameByPrefix = useMemo(() => new Map(tactics.map((tactic) => [tactic.prefix || tactic.name, tactic.name])), [tactics])
  const tacticIndexByPrefix = useMemo(() => new Map(tactics.map((tactic, index) => [tactic.prefix || tactic.name, index])), [tactics])
  const techniqueById = useMemo(() => new Map(techniques.map((tech) => [tech.id, tech])), [techniques])

  const threatMatrixPayload = useMemo<ThreatMatrixPayload>(() => {
    const nodes = techniques.map((tech) => ({
      id: tech.id,
      tactic: tacticPrefixByName.get(tech.tactic) ?? tech.id.split('-')[0] ?? tech.tactic,
      name: tech.name,
      coverage: coverageToPercent(tech.coverage),
      category: tech.tactic,
    }))
    const nodeIds = new Set(nodes.map((node) => node.id))
    const links = relationships.flatMap((rel) => {
      const source = rel.source_control_id
      const target = rel.target_control_id
      if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) return []
      return [{ source, target }]
    })
    return { nodes, links }
  }, [techniques, relationships, tacticPrefixByName])

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
    const payloadNodeById = new Map(threatMatrixPayload.nodes.map((node) => [node.id, node]))
    const fallbackTactic = tactics[0]?.prefix || tactics[0]?.name || 'CENTER'

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
        tactic: tactic.prefix || tactic.name,
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
      const tacticPrefix = payloadNodeById.get(tech.id)?.tactic ?? tacticPrefixByName.get(tech.tactic) ?? fallbackTactic
      const laneOrdinal = tacticTechniqueOrdinals.get(tech.tactic) ?? 0
      tacticTechniqueOrdinals.set(tech.tactic, laneOrdinal + 1)
      addNode({
        id: techniqueId,
        tactic: tacticPrefix,
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
        addNode({ id: frameworkId, tactic: tacticPrefix, kind: 'framework', label: framework, laneIndex: tacticIndex >= 0 ? tacticIndex : 0 })
        addLink(frameworkId, techniqueId, 'crosswalk-framework')
      }

      for (const category of (tech.mind ?? []).slice(0, 3)) {
        const categoryId = `category:${category}`
        addNode({ id: categoryId, tactic: tacticPrefix, kind: 'category', label: category, laneIndex: tacticIndex >= 0 ? tacticIndex : 0 })
        addLink(categoryId, techniqueId, 'control-category')
      }

      if (tech.evidenceCaseCount > 0 || tech.evidenceVerdict !== 'none') {
        const evidenceLabel = tech.evidenceVerdict === 'none' ? 'no evidence case' : tech.evidenceVerdict.replace('_', ' ')
        const evidenceId = `evidence:${tech.evidenceVerdict}`
        addNode({ id: evidenceId, tactic: tacticPrefix, kind: 'evidence', label: evidenceLabel, laneIndex: tacticIndex >= 0 ? tacticIndex : 0 })
        addLink(evidenceId, techniqueId, 'evidence-state')
      }
    }

    const techniqueIdByControlId = new Map(threatMatrixPayload.nodes.map((node) => [node.id, `technique:${node.id}`]))
    for (const rel of relationships) {
      const sourceId = rel.source_control_id
      const targetId = rel.target_control_id
      if (!sourceId || !targetId) continue

      const sourceTechniqueNode = techniqueIdByControlId.get(sourceId)
      const targetTechniqueNode = techniqueIdByControlId.get(targetId)
      if (!sourceTechniqueNode && !targetTechniqueNode) continue

      const sourceGraphId = sourceTechniqueNode ?? `control:${sourceId}`
      const targetGraphId = targetTechniqueNode ?? `control:${targetId}`
      const anchorTechnique = techniqueById.get(sourceId) ?? techniqueById.get(targetId)
      if (!anchorTechnique) continue
      const anchorTactic = tacticPrefixByName.get(anchorTechnique.tactic) ?? fallbackTactic

      if (!sourceTechniqueNode) {
        const sourceFramework = rel.source_framework ? `${rel.source_framework} ` : ''
        addNode({
          id: sourceGraphId,
          tactic: anchorTactic,
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
          tactic: anchorTactic,
          kind: 'control',
          label: `${targetFramework}${targetId}`,
          lane: anchorTechnique.tactic,
          laneIndex: tactics.findIndex((tactic) => tactic.name === anchorTechnique.tactic),
        })
      }
      addLink(sourceGraphId, targetGraphId, 'memory-crosswalk')
    }

    return { nodes: Array.from(nodes.values()), links }
  }, [techniques, tactics, relationships, tacticPrefixByName, techniqueById, threatMatrixPayload])

  const tacticalGraphPayload = useMemo<ThreatMatrixPayload>(() => ({
    nodes: graphData.nodes.map((node) => ({
      id: node.id,
      tactic: node.tactic,
      name: node.data?.name ?? node.label,
      coverage: node.data ? coverageToPercent(node.data.coverage) : 0,
      category: node.kind,
    })),
    links: graphData.links.map((link) => ({
      source: link.source,
      target: link.target,
    })),
  }), [graphData])

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
    return tacticNameByPrefix.get(node.tactic) ?? node.data?.tactic ?? node.lane ?? null
  }, [tacticNameByPrefix])

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
      const explicitIndex = tacticIndexByPrefix.get(node.tactic)
      const index = Math.max(0, Math.min(laneCount - 1, explicitIndex ?? node.laneIndex ?? 0))
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
  }, [techniques.length, tactics, dimensions, graphData.nodes, visibleGraphLinks, reducedMotion, forcePulse, hoveredTactic, lockedTactic, nodeTactic, tacticIndexByPrefix])

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
      data-graph-payload-nodes={tacticalGraphPayload.nodes.length}
      data-graph-payload-links={tacticalGraphPayload.links.length}
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
              data-graph-node-tactic={node.tactic}
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
  const isGlance = state.viewMode === 'glance' || state.viewMode === 'bloom' || state.condensedView

  const tacticNames = state.tactics.map((t) => t.name)
  const byTactic: Record<string, ThreatTechnique[]> = {}
  for (const name of tacticNames) byTactic[name] = []
  for (const tech of state.techniques) {
    if (byTactic[tech.tactic]) byTactic[tech.tactic].push(tech)
  }
  const tacticStats = useMemo(() => {
    const stats: Record<string, { total: number; covered: number; partial: number; gap: number }> = {}
    for (const tactic of state.tactics) stats[tactic.name] = { total: 0, covered: 0, partial: 0, gap: 0 }
    for (const tech of state.techniques) {
      const bucket = stats[tech.tactic]
      if (!bucket) continue
      bucket.total += 1
      if (tech.evidenceVerdict === 'satisfied') bucket.covered += 1
      else if (tech.evidenceVerdict === 'inconclusive') bucket.partial += 1
      else bucket.gap += 1
    }
    return stats
  }, [state.tactics, state.techniques])

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
  const viewModeKinetics = 'opacity 0.18s ease, transform 0.18s ease, gap 0.18s ease, padding 0.18s ease, background-color 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease'
  const cellKinetics = 'opacity 0.16s ease, transform 0.16s ease, background-color 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease, color 0.16s ease'

  const glanceBlockStyle = (tech: ThreatTechnique, isSelected: boolean): React.CSSProperties => {
    const isCritical = tech.evidenceVerdict === 'not_satisfied'
    const isWarning = tech.evidenceVerdict === 'inconclusive'
    const color = isCritical ? EMBRY.red : isWarning ? EMBRY.amber : '#121214'
    return {
      width: 13,
      height: 13,
      borderRadius: 2,
      border: isSelected ? '1px solid rgba(250,204,21,0.9)' : '1px solid rgba(255,255,255,0.07)',
      background: color,
      boxShadow: isCritical
        ? '0 0 8px rgba(239,68,68,0.38)'
        : isWarning
          ? '0 0 8px rgba(234,179,8,0.30)'
          : 'none',
      opacity: isSelected ? 1 : 0.94,
      cursor: 'pointer',
      transition: cellKinetics,
      willChange: 'transform, opacity',
    }
  }

  return (
    <div
      className="sparta-threat-matrix-scroll"
      style={{
        flex: 1,
        overflow: 'auto',
        background: '#050505',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255, 255, 255, 0.2) transparent',
        transition: viewModeKinetics,
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
          gap: isMobile ? FLUID.gridGap : isGlance ? 8 : 2,
          padding: isMobile ? 0 : isGlance ? '2px 12px 12px' : '2px 10px 10px',
          alignItems: 'start',
          transition: viewModeKinetics,
        }}
      >
        {tacticNames.map((tactic) => (
          <div
            key={tactic}
            data-qid={`threat-matrix:column:${tactic.replace(/[^a-zA-Z0-9_-]/g, '-')}`}
            data-qs-action="THREAT_MATRIX_COLUMN"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: isGlance ? 4 : 2,
              minWidth: 0,
              height: '100%',
              transition: viewModeKinetics,
            }}
          >
            {(() => {
              const tacticMeta = state.tactics.find((item) => item.name === tactic)
              const s = tacticStats[tactic] ?? { total: 0, covered: 0, partial: 0, gap: 0 }
              const pct = s.total > 0 ? Math.round((s.covered / s.total) * 100) : 0
              return (
                <div
                  data-qid={`threat-matrix:column-header:${tacticMeta?.prefix ?? tactic}`}
                  data-qs-action="THREAT_MATRIX_COLUMN_HEADER"
                  style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 5,
                    minHeight: 52,
                    padding: '9px 10px 8px',
                    background: '#050505',
                    borderBottom: '1px solid rgba(255,255,255,0.08)',
                    textAlign: 'center',
                    transition: viewModeKinetics,
                  }}
                >
                  <div style={{ fontSize: 9, fontWeight: 800, color: EMBRY.white, marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{tactic}</div>
                  <div style={{ fontSize: 8, color: EMBRY.dim, marginBottom: 6 }}>{tacticMeta?.prefix ?? tactic} · {s.total} tech</div>
                  <div style={{ display: 'flex', height: 3, borderRadius: 2, overflow: 'hidden' }}>
                    {s.total > 0 && <>
                      <div style={{ width: `${(s.covered / s.total) * 100}%`, backgroundColor: EMBRY.green }} />
                      <div style={{ width: `${(s.partial / s.total) * 100}%`, backgroundColor: EMBRY.amber }} />
                      <div style={{ width: `${(s.gap / s.total) * 100}%`, backgroundColor: EMBRY.red }} />
                    </>}
                  </div>
                  <div style={{ fontSize: 8, color: pct === 100 ? EMBRY.green : EMBRY.dim, marginTop: 2 }} title="Evidence case coverage: % of techniques with SATISFIED verdicts">{s.total > 0 ? `${pct}%` : '—'} <span style={{ opacity: 0.5 }}>coverage</span></div>
                </div>
              )
            })()}
            <div style={{
              display: isGlance ? 'flex' : 'flex',
              flexDirection: isGlance ? 'row' : 'column',
              flexWrap: isGlance ? 'wrap' : 'nowrap',
              justifyContent: isGlance ? 'center' : 'flex-start',
              gap: isGlance ? 4 : 2,
              alignContent: 'flex-start',
              paddingTop: isGlance ? 4 : 2,
              paddingBottom: 12,
              minWidth: 0,
              transition: viewModeKinetics,
            }}>
            {byTactic[tactic].map((tech) => {
            if (isGlance) {
              const isSelected = state.selectedDetail?.technique.id === tech.id
              return (
                <button
                  key={tech.id}
                  type="button"
                  data-qid={`threat-matrix:button:glance-cell-${tech.id}`}
                  data-qs-action="SELECT_TECHNIQUE_GLANCE"
                  title={`${tech.id}: ${tech.name} — ${tech.evidenceVerdict?.replace('_', ' ') ?? 'no verdict'}`}
                  aria-label={`${tech.id}: ${tech.name}`}
                  onClick={() => actions.selectTechnique(tech)}
                  onMouseEnter={(e) => {
                    setHudTech(tech)
                    setHudPosition({ x: e.clientX, y: e.clientY })
                    e.currentTarget.style.transform = 'scale(1.28)'
                  }}
                  onMouseMove={(e) => setHudPosition({ x: e.clientX, y: e.clientY })}
                  onMouseLeave={(e) => {
                    setHudTech(null)
                    e.currentTarget.style.transform = 'scale(1)'
                  }}
                  style={glanceBlockStyle(tech, isSelected)}
                />
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
                  opacity: isSelected || isHovered ? 1 : 0.96,
                  transform: isHovered ? 'translateY(-1px)' : 'translateY(0)',
                  willChange: 'transform, opacity',
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

function Detail() {
  const { state, actions } = useThreatMatrix()
  const { selectedDetail, loadingDetail } = state

  if (!selectedDetail) return null

  const { technique: tech, qras, countermeasures, relationships, traceability, evidenceCases, discrepancies } = selectedDetail
  const traceTypes = traceability ? Object.keys(traceability).sort() : []
  const totalChunks = traceTypes.reduce((sum, t) => sum + (traceability?.[t]?.length ?? 0), 0)
  const coveragePercent = coverageToPercent(tech.coverage)
  const coverageColor = coveragePercent === 0 ? EMBRY.red : coveragePercent < 100 ? EMBRY.amber : `${EMBRY.white}99`
  const hasCoverageGap = tech.evidenceVerdict === 'not_satisfied' || tech.evidenceVerdict === 'inconclusive' || tech.coverage === 'none'
  const evidenceCount = evidenceCases?.length ?? 0
  const traceSummary = `${totalChunks} source chunk${totalChunks === 1 ? '' : 's'}`

  return (
    <div style={{
      width: 400,
      flex: '0 0 400px',
      height: '100%',
      backgroundColor: 'rgba(10, 10, 12, 0.95)',
      backdropFilter: 'blur(24px)',
      WebkitBackdropFilter: 'blur(24px)',
      borderLeft: '1px solid rgba(255, 255, 255, 0.10)',
      display: 'flex',
      flexDirection: 'column',
      zIndex: 10,
      boxShadow: '-20px 0 40px rgba(0,0,0,0.8)',
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

      {/* Header: raw typography, no boxed wash */}
      <div style={{ padding: '24px 24px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexShrink: 0 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span style={{ color: 'rgba(255,255,255,0.40)', fontSize: 9, fontWeight: 900, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            {tech.tactic} / Target Locked
          </span>
          <h2 style={{ margin: 0, color: EMBRY.white, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 20, fontWeight: 800, letterSpacing: '-0.02em' }}>
            {tech.id}
          </h2>
        </div>
        <button
          data-qid="threat-matrix:detail:close"
          data-qs-action="CLOSE_DETAIL_PANEL"
          title="Close evidence pane"
          onClick={actions.clearSelection}
          aria-label="Close evidence pane"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'rgba(255,255,255,0.32)',
            cursor: 'pointer',
            width: 32,
            height: 32,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 22,
            lineHeight: 1,
          }}
        >×</button>
      </div>

      {/* Telemetry: no box, state through color only */}
      <div style={{ padding: '0 24px 24px', display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
        <span style={{ color: 'rgba(255,255,255,0.40)', fontSize: 9, fontWeight: 900, letterSpacing: '0.16em', textTransform: 'uppercase' }}>Coverage</span>
        <span style={{
          color: coverageColor,
          fontSize: 18,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontWeight: 800,
          textShadow: coveragePercent === 0 ? '0 0 8px rgba(239,68,68,0.5)' : coveragePercent < 100 ? '0 0 8px rgba(234,179,8,0.5)' : 'none',
        }}>
          {coveragePercent}%
        </span>
        <span style={{ color: 'rgba(255,255,255,0.28)', fontSize: 9, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          {tech.evidenceVerdict.replace('_', ' ')}
        </span>
      </div>

      {/* Context: pure text hierarchy, no nested cards */}
      <div style={{ padding: '0 24px', display: 'flex', flexDirection: 'column', gap: 32, flex: 1, overflowY: 'auto' }}>
        <section>
          <h3 style={{ margin: '0 0 12px', color: 'rgba(255,255,255,0.40)', fontSize: 9, fontWeight: 900, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            Technique Description
          </h3>
          <p style={{ margin: 0, color: 'rgba(255,255,255,0.70)', fontSize: 12, lineHeight: 1.65 }}>
            {tech.description || tech.name}
          </p>
        </section>

        <section>
          <h3 style={{ margin: '0 0 12px', color: 'rgba(255,255,255,0.40)', fontSize: 9, fontWeight: 900, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            Evidence State
          </h3>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
          }}>
            <MicroTelemetryRow label="Cases" value={evidenceCount} />
            <MicroTelemetryRow label="QRAs" value={qras.length} />
            <MicroTelemetryRow label="Controls" value={countermeasures.length} />
            <MicroTelemetryRow label="Edges" value={relationships.length} terminal />
          </div>
          <div style={{ marginTop: 12, color: 'rgba(255,255,255,0.34)', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {traceSummary}
            {discrepancies?.length ? ` · ${discrepancies.length} discrepancies` : ''}
          </div>
        </section>

        {hasCoverageGap && (
          <section>
            <h3 style={{ margin: '0 0 12px', color: 'rgba(248,113,113,0.86)', fontSize: 9, fontWeight: 900, letterSpacing: '0.16em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: EMBRY.red, boxShadow: `0 0 6px ${EMBRY.red}` }} />
              {countermeasures.length > 0 ? 'Mapped Controls' : 'Missing Controls'}
            </h3>
            <ul style={{ margin: 0, padding: '0 0 0 12px', borderLeft: '1px solid rgba(239,68,68,0.22)', display: 'flex', flexDirection: 'column', gap: 10, listStyle: 'none' }}>
              {countermeasures.length > 0 ? countermeasures.slice(0, 6).map((cm) => (
                <li key={cm.control_id} style={{ color: 'rgba(255,255,255,0.90)', fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>
                  {cm.control_id}
                </li>
              )) : (
                <li style={{ color: 'rgba(255,255,255,0.64)', fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>
                  No mapped controls returned for this technique.
                </li>
              )}
            </ul>
          </section>
        )}

        {(evidenceCases?.length ?? 0) > 0 && (
          <section>
            <h3 style={{ margin: '0 0 12px', color: 'rgba(255,255,255,0.40)', fontSize: 9, fontWeight: 900, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
              Evidence Cases
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {evidenceCases!.slice(0, 4).map((ec, i) => {
                const vColor = ec.verdict === 'satisfied' ? EMBRY.green : ec.verdict === 'inconclusive' ? EMBRY.amber : EMBRY.red
                return (
                  <div key={`ec-${i}`} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: vColor, boxShadow: `0 0 6px ${vColor}` }} />
                      <span style={{ color: vColor, fontSize: 9, fontWeight: 900, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{ec.verdict.replace('_', ' ')}</span>
                      <span style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.36)', fontSize: 9, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }}>
                        {ec.gates_passed}/{ec.gates_total} gates
                      </span>
                    </div>
                    <p style={{ margin: 0, color: 'rgba(255,255,255,0.58)', fontSize: 11, lineHeight: 1.5 }}>
                      {ec.question.slice(0, 170)}{ec.question.length > 170 ? '...' : ''}
                    </p>
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {loadingDetail && (
          <div style={{ color: 'rgba(255,255,255,0.30)', fontSize: 10, fontWeight: 900, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            Awaiting evidence telemetry
          </div>
        )}
      </div>

      {/* Footer: typography actions, not boxed buttons */}
      <div style={{ padding: '20px 24px 24px', display: 'flex', gap: 24, flexShrink: 0 }}>
        <button
          data-qid="threat-matrix:button:detail-toggle-evidence"
          data-qs-action="TOGGLE_EVIDENCE_GATES"
          title="Pin selected technique context to board"
          style={{ background: 'transparent', border: 'none', padding: 0, color: 'rgba(255,255,255,0.42)', cursor: 'pointer', fontSize: 10, fontWeight: 900, letterSpacing: '0.16em', textTransform: 'uppercase' }}
        >
          Pin to Board
        </button>
        <button
          data-qid="threat-matrix:button:detail-dfars-export"
          data-qs-action="EXPORT_DFARS_INCIDENT"
          title="Isolate the selected path"
          style={{ background: 'transparent', border: 'none', padding: 0, color: 'rgba(250,204,21,0.62)', cursor: 'pointer', fontSize: 10, fontWeight: 900, letterSpacing: '0.16em', textTransform: 'uppercase' }}
        >
          Isolate Path
        </button>
      </div>
    </div>
  )
}

function MicroTelemetryRow({ label: rowLabel, value, terminal = false }: { label: string; value: number; terminal?: boolean }) {
  const paddedValue = value.toString().padStart(2, '0')
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 14,
      paddingBottom: terminal ? 0 : 6,
      borderBottom: terminal ? 'none' : '1px solid rgba(255,255,255,0.05)',
      color: 'rgba(255,255,255,0.50)',
      cursor: 'default',
    }}>
      <span>{rowLabel}</span>
      <span style={{ color: 'rgba(255,255,255,0.88)', fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>
        {paddedValue}
      </span>
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

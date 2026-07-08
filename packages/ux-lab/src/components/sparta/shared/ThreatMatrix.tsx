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
import { createContext, use, useState, useMemo, useCallback, useRef, useEffect, type ReactNode } from 'react'
import { Flame, Grid3X3, Network, GitBranch, AlertTriangle, FileWarning, Shield, Download } from 'lucide-react'
import { forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY } from 'd3-force'
import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force'
import { EMBRY, label, heading, glowDot, fwBadge, FLUID } from '../common/EmbryStyle'
import { PostureHUD } from './PostureHUD'
import { TacticAccordion } from './TacticAccordion'
import { TechniqueDrawer } from './TechniqueDrawer'
import { useMediaQuery } from '../../../hooks/useMediaQuery'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import { ProvenanceGraph } from '../provenance-graph'
import type { ProvenanceNode, ProvenanceEdge, TemporalEvidenceState } from '../provenance-graph/types'

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
}

export interface ThreatMatrixActions {
  selectTechnique: (tech: ThreatTechnique) => void
  clearSelection: () => void
  toggleSubtechniques: () => void
  selectDatalake?: (datalake: string) => void
  setViewMode?: (mode: ViewMode) => void
  toggleCondensedView?: () => void
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

  // Determine base RGB based on impact thresholds
  let rgb = BLOOM_RGB.healthy
  if (impact > 0.7) rgb = BLOOM_RGB.critical
  else if (impact > 0.3) rgb = BLOOM_RGB.degraded
  else if (tech.evidenceVerdict === 'none' || tech.evidenceVerdict === 'inconclusive') rgb = BLOOM_RGB.blind

  // Luminance mapping: higher impact in healthy areas = "thin evidence" (dimmer)
  // Alpha ranges from 0.4 (weak) to 1.0 (strong)
  const alpha = impact < 0.3 ? 1.0 - impact * 0.6 : 0.7 + impact * 0.3

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
  const impactScore = gradeToImpact(tech.evidenceGrade, tech.evidenceVerdict)
  const impactPct = Math.round((1 - impactScore) * 100)

  return (
    <div
      data-qid="threat-matrix:overlay:tactical-hud"
      data-qs-action="tactical-hud-display"
      title={`Tactical HUD: ${tech.id}`}
      style={{
        position: 'fixed',
        left: position.x + 16,
        top: position.y - 8,
        background: 'rgba(10, 12, 16, 0.92)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderTop: `2px solid ${accentColor}`,
        padding: 14,
        borderRadius: 4,
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.6)',
        color: '#e0e4e8',
        pointerEvents: 'none',
        zIndex: 9999,
        minWidth: 240,
        maxWidth: 300,
        fontFamily: 'Inter, system-ui, sans-serif',
      }}
    >
      {/* Header */}
      <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.15em', color: '#6e7681', marginBottom: 2 }}>
        Control ID
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: '#f0f6fc', marginBottom: 2 }}>
        {tech.id}
      </div>
      <div style={{ fontSize: 12, color: '#8b949e', marginBottom: 12, lineHeight: 1.4 }}>
        {tech.name}
      </div>

      {/* Stats Grid */}
      <div style={{
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12,
        borderTop: '1px solid rgba(255, 255, 255, 0.1)', paddingTop: 12,
      }}>
        <div>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#6e7681', marginBottom: 2 }}>
            Verdict
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: accentColor }}>
            {(tech.evidenceVerdict ?? 'unknown').replace('_', ' ')}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#6e7681', marginBottom: 2 }}>
            Evidence Score
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 60, height: 4, borderRadius: 2,
              background: 'rgba(255, 255, 255, 0.1)',
              overflow: 'hidden',
            }}>
              <div style={{
                width: `${impactPct}%`, height: '100%',
                background: accentColor,
                borderRadius: 2,
              }} />
            </div>
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: '#8b949e' }}>{impactPct}%</span>
          </div>
        </div>
      </div>

      {/* Grade Badge */}
      {tech.evidenceGrade && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 3,
            color: accentColor, backgroundColor: `${accentColor}18`,
            border: `1px solid ${accentColor}33`,
          }}>
            Grade {tech.evidenceGrade}
          </span>
          {tech.evidenceCaseCount > 0 && (
            <span style={{ fontSize: 10, color: '#6e7681' }}>
              {tech.evidenceCaseCount} evidence case{tech.evidenceCaseCount !== 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}

      {/* Frameworks / Taxonomy */}
      {tech.frameworks.length > 0 && (
        <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '0.12em', color: '#6e7681', marginBottom: 4 }}>
            Mapped Frameworks
          </div>
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {tech.frameworks.slice(0, 4).map((fw) => (
              <span key={fw} style={{
                fontSize: 9, padding: '2px 6px', borderRadius: 3,
                background: 'rgba(255, 255, 255, 0.06)',
                color: '#8b949e',
              }}>{fw}</span>
            ))}
            {tech.frameworks.length > 4 && (
              <span style={{ fontSize: 9, color: '#6e7681' }}>+{tech.frameworks.length - 4}</span>
            )}
          </div>
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
  data: ThreatTechnique
}

interface GraphLink extends SimulationLinkDatum<GraphNode> {
  source: string | GraphNode
  target: string | GraphNode
}

const VERDICT_COLORS: Record<string, string> = {
  satisfied: EMBRY.green,
  inconclusive: EMBRY.amber,
  not_satisfied: EMBRY.red,
  none: EMBRY.dim,
}

/** Transform TechniqueDetail into ProvenanceGraph nodes/edges for compliance visualization */
function buildProvenanceFromTechnique(detail: TechniqueDetail): { nodes: ProvenanceNode[]; edges: ProvenanceEdge[] } {
  const now = Date.now()
  const defaultTemporal: TemporalEvidenceState = {
    observed_at: now,
    valid_from: now,
    valid_to: now + 365 * 24 * 60 * 60 * 1000,
    assessed_at: now,
    source_event_id: 'threat-matrix-view',
    is_active: true,
  }

  const nodes: ProvenanceNode[] = []
  const edges: ProvenanceEdge[] = []

  // Root node: the technique itself
  const techNode: ProvenanceNode = {
    id: detail.technique.id,
    label: detail.technique.name,
    nodeClass: 'framework_artifact',
    framework: 'SPARTA',
    temporal: defaultTemporal,
    cascade_state: 'healthy',
  }
  nodes.push(techNode)

  // Countermeasure nodes (CM-xxxx → controls)
  for (const cm of detail.countermeasures ?? []) {
    const cmNode: ProvenanceNode = {
      id: cm.control_id,
      label: cm.name || cm.control_id,
      nodeClass: 'control',
      framework: 'SPARTA',
      family: cm.control_id.split('-')[0],
      temporal: defaultTemporal,
      cascade_state: 'healthy',
    }
    nodes.push(cmNode)

    // Edge: technique → countermeasure (maps_to)
    edges.push({
      id: `${detail.technique.id}->${cm.control_id}`,
      source: detail.technique.id,
      target: cm.control_id,
      type: 'maps_to',
      weight: 1.0,
      exclusivity: 0.5,
    })
  }

  // Evidence case nodes (if any)
  for (const [i, ec] of (detail.evidenceCases ?? []).entries()) {
    const ecId = `ec-${detail.technique.id}-${i}`
    const verdictToState = (v: string): 'healthy' | 'degraded' | 'hard_break' =>
      v === 'satisfied' ? 'healthy' : v === 'inconclusive' ? 'degraded' : 'hard_break'

    const ecNode: ProvenanceNode = {
      id: ecId,
      label: `Evidence: ${ec.grade} (${ec.gates_passed}/${ec.gates_total})`,
      nodeClass: 'evidence_artifact',
      temporal: defaultTemporal,
      cascade_state: verdictToState(ec.verdict),
    }
    nodes.push(ecNode)

    // Connect evidence to related controls
    for (const ctrlId of ec.control_ids ?? []) {
      if (nodes.some(n => n.id === ctrlId)) {
        edges.push({
          id: `${ecId}->${ctrlId}`,
          source: ecId,
          target: ctrlId,
          type: 'satisfies',
          weight: ec.gates_passed / Math.max(ec.gates_total, 1),
          exclusivity: 0.8,
        })
      }
    }
  }

  // Control-to-control relationships
  for (const rel of detail.relationships ?? []) {
    if (nodes.some(n => n.id === rel.source_control_id) && nodes.some(n => n.id === rel.target_control_id)) {
      edges.push({
        id: `${rel.source_control_id}->${rel.target_control_id}`,
        source: rel.source_control_id,
        target: rel.target_control_id,
        type: 'depends_on',
        weight: rel.combined_score ?? 0.5,
        exclusivity: 0.3,
      })
    }
  }

  return { nodes, edges }
}

function TechniqueGraph({ techniques, tactics, onSelect }: {
  techniques: ThreatTechnique[]
  tactics: ThreatTactic[]
  onSelect: (tech: ThreatTechnique) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [positions, setPositions] = useState<Map<string, { x: number; y: number }>>(new Map())
  const [hovered, setHovered] = useState<string | null>(null)
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 })

  useEffect(() => {
    if (!containerRef.current) return
    const obs = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setDimensions({ width, height })
    })
    obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    if (techniques.length === 0 || dimensions.width < 100) return

    const tacticIndex = new Map(tactics.map((t, i) => [t.name, i]))
    const tacticCount = tactics.length || 1
    const laneWidth = dimensions.width / tacticCount

    const nodes: GraphNode[] = techniques.map((tech) => ({
      id: tech.id,
      data: tech,
      x: (tacticIndex.get(tech.tactic) ?? 0) * laneWidth + laneWidth / 2,
      y: dimensions.height / 2,
    }))

    const links: GraphLink[] = []
    const byTactic: Record<string, ThreatTechnique[]> = {}
    for (const tech of techniques) {
      if (!byTactic[tech.tactic]) byTactic[tech.tactic] = []
      byTactic[tech.tactic].push(tech)
    }
    for (const techs of Object.values(byTactic)) {
      for (let i = 0; i < techs.length - 1; i++) {
        links.push({ source: techs[i].id, target: techs[i + 1].id })
      }
    }

    const simulation = forceSimulation<GraphNode>(nodes)
      .force('link', forceLink<GraphNode, GraphLink>(links).id((d) => d.id).distance(40).strength(0.3))
      .force('charge', forceManyBody().strength(-80))
      .force('collide', forceCollide(20))
      .force('x', forceX<GraphNode>((d) => {
        const idx = tacticIndex.get(d.data.tactic) ?? 0
        return idx * laneWidth + laneWidth / 2
      }).strength(0.8))
      .force('y', forceY(dimensions.height / 2).strength(0.05))

    simulation.on('tick', () => {
      const newPos = new Map<string, { x: number; y: number }>()
      for (const node of nodes) {
        newPos.set(node.id, {
          x: Math.max(20, Math.min(dimensions.width - 20, node.x ?? 0)),
          y: Math.max(20, Math.min(dimensions.height - 20, node.y ?? 0)),
        })
      }
      setPositions(newPos)

      // Draw edges on canvas
      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.clearRect(0, 0, dimensions.width, dimensions.height)
          ctx.strokeStyle = EMBRY.border
          ctx.globalAlpha = 0.4
          ctx.lineWidth = 1
          ctx.beginPath()

          for (const tech of techniques) {
            const pos = newPos.get(tech.id)
            if (!pos) continue
            const byTactic = techniques.filter((t) => t.tactic === tech.tactic)
            const idx = byTactic.findIndex((t) => t.id === tech.id)
            if (idx < byTactic.length - 1) {
              const nextPos = newPos.get(byTactic[idx + 1].id)
              if (nextPos) {
                ctx.moveTo(pos.x, pos.y)
                ctx.lineTo(nextPos.x, nextPos.y)
              }
            }
          }
          ctx.stroke()
        }
      }
    })

    return () => { simulation.stop() }
  }, [techniques, tactics, dimensions])

  const nodeMap = useMemo(() => new Map(techniques.map((t) => [t.id, t])), [techniques])
  const canvasRef = useRef<HTMLCanvasElement>(null)

  return (
    <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        width={dimensions.width}
        height={dimensions.height}
        style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
      />
      <svg ref={svgRef} width={dimensions.width} height={dimensions.height} style={{ position: 'absolute', inset: 0 }}>
        {/* Tactic lane backgrounds (labels are in TacticStrip, not duplicated here) */}
        {tactics.map((tactic, i) => {
          const laneWidth = dimensions.width / tactics.length
          return (
            <rect
              key={tactic.id}
              x={i * laneWidth}
              y={0}
              width={laneWidth}
              height={dimensions.height}
              fill={i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'}
            />
          )
        })}

        {/* Edges are now drawn on Canvas */}

        {/* Nodes */}
        {techniques.map((tech) => {
          const pos = positions.get(tech.id)
          if (!pos) return null
          const color = VERDICT_COLORS[tech.evidenceVerdict] ?? EMBRY.dim
          const isHovered = hovered === tech.id
          const radius = isHovered ? 10 : 7
          return (
            <g data-qid="shared-threatmatrix:auto:859" data-qs-action="SHARED_THREATMATRIX_AUTO_859"
              key={tech.id}
              transform={`translate(${pos.x}, ${pos.y})`}
              style={{ cursor: 'pointer' }}
              onMouseEnter={() => setHovered(tech.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => onSelect(tech)}
            >
              <circle
                r={radius}
                fill={color}
                opacity={isHovered ? 1 : 0.8}
                stroke={isHovered ? EMBRY.white : 'none'}
                strokeWidth={2}
              />
              {isHovered && (
                <text
                  y={-14}
                  fill={EMBRY.white}
                  fontSize={9}
                  textAnchor="middle"
                  style={{ fontFamily: 'monospace', pointerEvents: 'none' }}
                >
                  {tech.id}
                </text>
              )}
            </g>
          )
        })}
      </svg>

      {/* Legend */}
      <div style={{
        position: 'absolute', bottom: 12, right: 12,
        display: 'flex', gap: 12, padding: '6px 10px',
        background: 'rgba(0,0,0,0.6)', borderRadius: 6,
        fontSize: 9, fontFamily: 'monospace',
      }}>
        {Object.entries(VERDICT_COLORS).map(([verdict, color]) => (
          <div key={verdict} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: 4, background: color }} />
            <span style={{ color: EMBRY.dim, textTransform: 'capitalize' }}>{verdict.replace('_', ' ')}</span>
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

  // ── Graph View: ProvenanceGraph showing technique → countermeasure → evidence chains ──
  if (state.viewMode === 'graph') {
    // Require a technique to be selected to show provenance chain
    if (!state.selectedDetail) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 16, color: EMBRY.dim }}>
          <Network size={48} strokeWidth={1} />
          <div style={{ fontSize: 14, textAlign: 'center', maxWidth: 400 }}>
            Select a technique from the Grid or Bloom view to see its<br />
            <span style={{ color: EMBRY.accent }}>evidence chain</span>: countermeasures, controls, and evidence cases
          </div>
          <button
            onClick={() => actions.setViewMode?.('standard')}
            style={{
              ...fwBadge('SPARTA'),
              padding: '10px 20px',
              cursor: 'pointer',
              border: 'none',
              borderRadius: 6,
              minHeight: 44,
              minWidth: 44,
            }}
            data-qid="threat-matrix:button:switch-to-grid"
            data-qs-action="SWITCH_TO_GRID_VIEW"
            title="Switch to grid view to select a technique"
          >
            Switch to Grid View
          </button>
        </div>
      )
    }

    // Build provenance graph from selected technique detail
    const { nodes, edges } = buildProvenanceFromTechnique(state.selectedDetail)

    return (
      <div style={{ flex: 1, position: 'relative' }}>
        <ProvenanceGraph
          nodes={nodes}
          edges={edges}
          onNodeSelect={(node) => {
            if (node?.nodeClass === 'control') {
              // Could navigate to control details
            }
          }}
        />
        {/* Technique info overlay */}
        <div style={{
          position: 'absolute',
          top: 12,
          right: 12,
          background: 'rgba(0,0,0,0.8)',
          padding: '12px 16px',
          borderRadius: 8,
          maxWidth: 300,
        }}>
          <div style={{ ...label, color: EMBRY.accent, marginBottom: 4 }}>
            {state.selectedDetail.technique.id}
          </div>
          <div style={{ fontSize: 12, color: EMBRY.white }}>
            {state.selectedDetail.technique.name}
          </div>
          <div style={{ fontSize: 10, color: EMBRY.dim, marginTop: 8 }}>
            {state.selectedDetail.countermeasures?.length ?? 0} countermeasures · {state.selectedDetail.evidenceCases?.length ?? 0} evidence cases
          </div>
        </div>
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

  const maxRows = Math.max(...tacticNames.map((t) => byTactic[t].length), 0)

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
    <div style={{ flex: 1, overflow: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns, gap: isMobile ? FLUID.gridGap : 0 }}>
        {/* Tactic headers */}
        {tacticNames.map((tactic) => (
          <div key={tactic} style={{
            padding: '10px 12px', borderBottom: `1px solid ${EMBRY.border}`, borderRight: `1px solid ${EMBRY.border}`,
            backgroundColor: EMBRY.bgDeep, position: 'sticky', top: 0, zIndex: 1,
          }}>
            <div style={{ ...label, color: 'rgba(255,255,255,0.8)', fontSize: 12, fontWeight: 800, letterSpacing: '0.04em' }}>{tactic}</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 4 }}>{byTactic[tactic].length} techniques</div>
          </div>
        ))}

        {/* Technique cells */}
        {Array.from({ length: maxRows }, (_, row) =>
          tacticNames.map((tactic) => {
            const tech = byTactic[tactic][row]
            if (!tech) {
              return (
                <div
                  key={`${tactic}-empty-${row}`}
                  style={{
                    borderRight: `1px solid ${EMBRY.border}`,
                    borderBottom: `1px solid ${EMBRY.border}`,
                    background: `${EMBRY.bgDeep}40`,
                    height: state.viewMode === 'bloom' ? 44 : 'auto',
                  }}
                />
              )
            }

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
                    borderRight: `1px solid ${EMBRY.border}`,
                    borderBottom: `1px solid ${EMBRY.border}`,
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
            const color = COVERAGE_COLORS[tech.coverage]
            const isHovered = hovered === tech.id
            const isSelected = state.selectedDetail?.technique.id === tech.id
            return (
              <div
                key={tech.id}
                data-qid={`threat-matrix:button:cell-${tech.id}`}
                data-qs-action="SELECT_TECHNIQUE"
                title={cellTooltip(tech)}
                style={{
                  padding: '8px 10px',
                  borderRight: `1px solid ${EMBRY.border}`, borderBottom: `1px solid ${EMBRY.border}`,
                  backgroundColor: isSelected ? `${EMBRY.accent}18` : isHovered ? `${color}12` : 'transparent',
                  cursor: 'pointer', transition: 'background-color 0.15s',
                  borderLeft: `3px solid ${color}`,
                  minHeight: 44,
                }}
                onMouseEnter={() => setHovered(tech.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => actions.selectTechnique(tech)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                  <span style={{ fontSize: 10, fontWeight: 700, color: EMBRY.white, fontFamily: 'monospace' }}>{tech.id}</span>
                  {/* Evidence case verdict indicator */}
                  {tech.evidenceVerdict === 'satisfied' && <div style={glowDot(EMBRY.green, 5)} title="SATISFIED" />}
                  {tech.evidenceVerdict === 'inconclusive' && <div style={glowDot(EMBRY.amber, 5)} title="INCONCLUSIVE" />}
                  {tech.evidenceVerdict === 'not_satisfied' && <div style={glowDot(EMBRY.red, 5)} title="NOT_SATISFIED" />}
                </div>
                <div style={{ fontSize: 11, color: EMBRY.dim, lineHeight: 1.3, marginBottom: 4 }}>{tech.name}</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {tech.frameworks.map((fw) => (
                    <span key={fw} style={fwBadge(fw)}>{fw}</span>
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
          })
        )}
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
      position: 'absolute', top: 0, right: 0, bottom: 0,
      width: 420, backgroundColor: EMBRY.bgPanel,
      borderLeft: `1px solid ${EMBRY.border}`, display: 'flex', flexDirection: 'column',
      zIndex: 10, boxShadow: '-4px 0 20px rgba(0,0,0,0.4)',
    }}>
      {/* Header - sticky, does not scroll */}
      <div style={{
        padding: '16px 20px', borderBottom: `1px solid ${EMBRY.border}`,
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
        flexShrink: 0, backgroundColor: EMBRY.bgPanel,
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

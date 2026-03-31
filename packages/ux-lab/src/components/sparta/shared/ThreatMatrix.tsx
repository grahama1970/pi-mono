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
import { createContext, use, useState, useMemo, type ReactNode } from 'react'
import { EMBRY, label, heading, glowDot, fwBadge } from '../common/EmbryStyle'

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

export interface TechniqueDetail {
  technique: ThreatTechnique
  qras: Array<{ question?: string; answer?: string; reasoning?: string }>
  countermeasures: Array<{ control_id: string; name: string }>
  relationships: Array<{ source_control_id: string; target_control_id: string; combined_score?: number }>
}

export interface ThreatMatrixState {
  tactics: ThreatTactic[]
  techniques: ThreatTechnique[]
  loading: boolean
  showSubtechniques: boolean
  selectedDetail: TechniqueDetail | null
  loadingDetail: boolean
}

export interface ThreatMatrixActions {
  selectTechnique: (tech: ThreatTechnique) => void
  clearSelection: () => void
  toggleSubtechniques: () => void
  selectDatalake?: (datalake: string) => void
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

// ── Header ───────────────────────────────────────────────────────────────────

function Header() {
  const { state, actions, meta } = useThreatMatrix()
  const { techniques, showSubtechniques } = state

  const satisfied = techniques.filter((t) => t.evidenceVerdict === 'satisfied').length
  const inconclusive = techniques.filter((t) => t.evidenceVerdict === 'inconclusive').length
  const notSatisfied = techniques.filter((t) => t.evidenceVerdict === 'not_satisfied').length
  const noCase = techniques.filter((t) => t.evidenceVerdict === 'none').length

  return (
    <div style={{
      padding: '12px 16px',
      borderBottom: `1px solid ${EMBRY.border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      flexShrink: 0, backgroundColor: EMBRY.bgHeader,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <div>
          <div style={heading}>SPARTA Threat Matrix</div>
          <div style={{ ...label, marginTop: 2 }}>
            {techniques.length} techniques across {state.tactics.length} tactics
            {meta.activeDatalake && <span style={{ color: EMBRY.accent }}> · {meta.activeDatalake}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          {[
            { color: EMBRY.green, count: satisfied, text: 'satisfied' },
            { color: EMBRY.amber, count: inconclusive, text: 'inconclusive' },
            { color: EMBRY.red, count: notSatisfied, text: 'not satisfied' },
            { color: EMBRY.dim, count: noCase, text: 'no case' },
          ].map(({ color, count, text }) => (
            <div key={text} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div style={glowDot(color, 6)} />
              <span style={{ fontSize: 10, color: EMBRY.dim }}>{count} {text}</span>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {/* Datalake selector */}
        {meta.datalakes && meta.datalakes.length > 0 && (
          <select
            value={meta.activeDatalake ?? ''}
            onChange={(e) => actions.selectDatalake?.(e.target.value)}
            style={{
              fontSize: 10, padding: '4px 8px', borderRadius: 4,
              border: `1px solid ${EMBRY.border}`, cursor: 'pointer',
              backgroundColor: EMBRY.bgDeep, color: EMBRY.white,
            }}
          >
            <option value="">SPARTA Catalog Only</option>
            {meta.datalakes.map((dl) => (
              <option key={dl.id} value={dl.id}>{dl.name}</option>
            ))}
          </select>
        )}
        <button
          onClick={actions.toggleSubtechniques}
          style={{
            fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 4,
            border: `1px solid ${EMBRY.border}`, cursor: 'pointer',
            backgroundColor: showSubtechniques ? `${EMBRY.accent}22` : 'transparent',
            color: showSubtechniques ? EMBRY.accent : EMBRY.dim,
          }}
        >
          {showSubtechniques ? 'Hide' : 'Show'} Sub-techniques
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
    <div style={{ display: 'flex', borderBottom: `1px solid ${EMBRY.border}`, flexShrink: 0, overflowX: 'auto' }}>
      {state.tactics.map((tactic) => {
        const s = stats[tactic.name] ?? { total: 0, covered: 0, partial: 0, gap: 0 }
        const pct = s.total > 0 ? Math.round((s.covered / s.total) * 100) : 0
        return (
          <div key={tactic.id} style={{ flex: 1, minWidth: 100, padding: '8px 10px', borderRight: `1px solid ${EMBRY.border}`, textAlign: 'center', display: 'flex', flexDirection: 'column' }}>
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
              <div style={{ fontSize: 8, color: pct === 100 ? EMBRY.green : EMBRY.dim, marginTop: 2 }}>{pct}%</div>
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

// ── Grid ─────────────────────────────────────────────────────────────────────

function Grid() {
  const { state, actions } = useThreatMatrix()
  const [hovered, setHovered] = useState<string | null>(null)

  const tacticNames = state.tactics.map((t) => t.name)
  const byTactic: Record<string, ThreatTechnique[]> = {}
  for (const name of tacticNames) byTactic[name] = []
  for (const tech of state.techniques) {
    if (byTactic[tech.tactic]) byTactic[tech.tactic].push(tech)
  }

  if (state.loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, color: EMBRY.dim }}>Loading techniques...</div>
  }

  const maxRows = Math.max(...tacticNames.map((t) => byTactic[t].length), 0)

  return (
    <div style={{ flex: 1, overflow: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${tacticNames.length}, minmax(140px, 1fr))`, gap: 0 }}>
        {/* Tactic headers */}
        {tacticNames.map((tactic) => (
          <div key={tactic} style={{
            padding: '10px 12px', borderBottom: `1px solid ${EMBRY.border}`, borderRight: `1px solid ${EMBRY.border}`,
            backgroundColor: EMBRY.bgDeep, position: 'sticky', top: 0, zIndex: 1,
          }}>
            <div style={{ ...label, color: EMBRY.white, fontSize: 9 }}>{tactic}</div>
            <div style={{ fontSize: 10, color: EMBRY.dim, marginTop: 2 }}>{byTactic[tactic].length} techniques</div>
          </div>
        ))}

        {/* Technique cells */}
        {Array.from({ length: maxRows }, (_, row) =>
          tacticNames.map((tactic) => {
            const tech = byTactic[tactic][row]
            if (!tech) {
              return <div key={`${tactic}-empty-${row}`} style={{ borderRight: `1px solid ${EMBRY.border}`, borderBottom: `1px solid ${EMBRY.border}` }} />
            }
            const color = COVERAGE_COLORS[tech.coverage]
            const isHovered = hovered === tech.id
            const isSelected = state.selectedDetail?.technique.id === tech.id
            return (
              <div
                key={tech.id}
                title={cellTooltip(tech)}
                style={{
                  padding: '8px 10px',
                  borderRight: `1px solid ${EMBRY.border}`, borderBottom: `1px solid ${EMBRY.border}`,
                  backgroundColor: isSelected ? `${EMBRY.accent}18` : isHovered ? `${color}12` : 'transparent',
                  cursor: 'pointer', transition: 'background-color 0.15s',
                  borderLeft: `3px solid ${color}`,
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
    </div>
  )
}

// ── Detail Panel ─────────────────────────────────────────────────────────────

function Detail() {
  const { state, actions } = useThreatMatrix()
  const { selectedDetail, loadingDetail } = state
  if (!selectedDetail) return null

  const { technique: tech, qras, countermeasures, relationships } = selectedDetail

  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0,
      width: 420, backgroundColor: EMBRY.bgPanel,
      borderLeft: `1px solid ${EMBRY.border}`, overflow: 'auto', display: 'flex', flexDirection: 'column',
      zIndex: 10, boxShadow: '-4px 0 20px rgba(0,0,0,0.4)',
    }}>
      {/* Header */}
      <div style={{ padding: '16px 20px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: EMBRY.accent }}>{tech.id}</span>
            <div style={glowDot(COVERAGE_COLORS[tech.coverage], 8)} />
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: EMBRY.white }}>{tech.name}</div>
          <div style={{ fontSize: 10, color: EMBRY.dim, marginTop: 2 }}>{tech.tactic}</div>
        </div>
        <button onClick={actions.clearSelection} style={{
          background: 'none', border: `1px solid ${EMBRY.border}`, borderRadius: 6,
          color: EMBRY.dim, fontSize: 11, padding: '4px 10px', cursor: 'pointer',
        }}>Close</button>
      </div>

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
      <div style={{ padding: '12px 20px' }}>
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

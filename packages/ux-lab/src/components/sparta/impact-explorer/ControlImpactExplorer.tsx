/**
 * ControlImpactExplorer — "What breaks if this control/evidence degrades?"
 *
 * Architecture per ChatGPT + Gemini synthesis:
 * - Impact summary strip (top): hard dependents, soft at-risk, mapped advisory
 * - 2-hop neighborhood graph (center): forward cascade (risk) or reverse (remediation)
 * - Detail drawer (right): simulation panel with grade dropdown
 *
 * Node classes (5):
 * - evidence_artifact: PDF chunk, attestation, scan result
 * - assessment_objective: NIST 800-171A assessment procedure
 * - control: CMMC/NIST control requirement
 * - control_family: AC, IA, SC, etc.
 * - cross_framework: mapped ISO/800-53 control (advisory)
 *
 * Edge types:
 * - satisfies: evidence → assessment objective (hard)
 * - partially_supports: evidence → objective (soft, lowers confidence)
 * - depends_on: control → control (hard cascade)
 * - inherits_from: control → shared evidence (provenance)
 * - maps_to: control → cross-framework (advisory, no hard cascade)
 *
 * Three-band cascade:
 * - broken (red): minimum required support no longer met
 * - at_risk (amber): still supportable but weak/inconclusive
 * - unaffected (dim): only mapping ripple, no direct dependency
 */
import { useState, useMemo, useCallback } from 'react'
import * as d3 from 'd3'
import { EMBRY, card, label, heading, glowDot } from '../common/EmbryStyle'
import { GraphExplorer } from '../../graph-explorer'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import { AlertTriangle, Shield, ArrowDownRight, ArrowUpLeft, Layers, Filter, Download } from 'lucide-react'

// ── Types ────────────────────────────────────────────────────────────────

export type NodeClass = 'evidence_artifact' | 'assessment_objective' | 'control' | 'control_family' | 'cross_framework'
export type EdgeType = 'satisfies' | 'partially_supports' | 'depends_on' | 'inherits_from' | 'maps_to'
export type CascadeState = 'broken' | 'at_risk' | 'unaffected' | 'selected'
export type GradeValue = 'A+' | 'A' | 'B' | 'C' | 'inconclusive' | 'not_satisfied'

export interface ImpactNode {
  id: string
  label: string
  nodeClass: NodeClass
  framework?: string
  family?: string
  verdict?: 'satisfied' | 'inconclusive' | 'not_satisfied' | 'none'
  grade?: GradeValue
  cascadeState?: CascadeState
  explanation?: string
}

export interface ImpactEdge {
  source: string
  target: string
  edgeType: EdgeType
  weight?: number
}

export interface ImpactSummary {
  hardDependents: number
  softAtRisk: number
  mappedAdvisory: number
  strengtheningOpportunities: number
}

export interface ControlImpactExplorerProps {
  nodes: ImpactNode[]
  edges: ImpactEdge[]
  selectedNodeId?: string | null
  onNodeSelect?: (node: ImpactNode | null) => void
  onExport?: (affectedNodes: ImpactNode[], rationale: string) => void
}

// ── Constants ────────────────────────────────────────────────────────────

const NODE_CLASS_COLORS: Record<NodeClass, string> = {
  evidence_artifact: EMBRY.blue,
  assessment_objective: EMBRY.accent,
  control: EMBRY.green,
  control_family: EMBRY.muted,
  cross_framework: EMBRY.dim,
}

const NODE_CLASS_LABELS: Record<NodeClass, string> = {
  evidence_artifact: 'Evidence',
  assessment_objective: 'Objective',
  control: 'Control',
  control_family: 'Family',
  cross_framework: 'Mapped',
}

const CASCADE_COLORS: Record<CascadeState, string> = {
  broken: '#dc2626',
  at_risk: '#d97706',
  unaffected: '#4a4a4a',
  selected: EMBRY.accent,
}

const EDGE_TYPE_STYLES: Record<EdgeType, { color: string; dashArray: string; propagates: 'hard' | 'soft' | 'advisory' }> = {
  satisfies: { color: EMBRY.green, dashArray: 'none', propagates: 'hard' },
  partially_supports: { color: EMBRY.amber, dashArray: '4 2', propagates: 'soft' },
  depends_on: { color: EMBRY.red, dashArray: 'none', propagates: 'hard' },
  inherits_from: { color: EMBRY.blue, dashArray: '2 2', propagates: 'soft' },
  maps_to: { color: EMBRY.dim, dashArray: '6 3', propagates: 'advisory' },
}

const GRADE_OPTIONS: GradeValue[] = ['A+', 'A', 'B', 'C', 'inconclusive', 'not_satisfied']

// ── Cascade computation (BFS with typed propagation) ─────────────────────

function computeCascade(
  nodes: ImpactNode[],
  edges: ImpactEdge[],
  selectedId: string | null,
  simulatedGrade: GradeValue | null,
  direction: 'downstream' | 'upstream',
): Map<string, CascadeState> {
  const result = new Map<string, CascadeState>()
  if (!selectedId) return result

  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const selectedNode = nodeMap.get(selectedId)
  if (!selectedNode) return result

  result.set(selectedId, 'selected')

  // Build adjacency based on direction
  const adj = new Map<string, Array<{ targetId: string; edgeType: EdgeType }>>()
  for (const e of edges) {
    const [from, to] = direction === 'downstream' ? [e.source, e.target] : [e.target, e.source]
    const list = adj.get(from) ?? []
    list.push({ targetId: to, edgeType: e.edgeType })
    adj.set(from, list)
  }

  // Determine cascade severity based on simulated grade
  const effectiveGrade = simulatedGrade ?? selectedNode.grade ?? 'A'
  const isHardFailure = effectiveGrade === 'not_satisfied'
  const isSoftFailure = effectiveGrade === 'inconclusive' || effectiveGrade === 'C'

  // BFS with 2-hop limit
  const queue: Array<{ id: string; depth: number; propagation: 'hard' | 'soft' | 'advisory' }> = []
  for (const neighbor of adj.get(selectedId) ?? []) {
    const style = EDGE_TYPE_STYLES[neighbor.edgeType]
    queue.push({ id: neighbor.targetId, depth: 1, propagation: style.propagates })
  }

  while (queue.length > 0) {
    const { id, depth, propagation } = queue.shift()!
    if (result.has(id) || depth > 2) continue

    let state: CascadeState = 'unaffected'
    if (propagation === 'hard' && isHardFailure) {
      state = 'broken'
    } else if (propagation === 'hard' && isSoftFailure) {
      state = 'at_risk'
    } else if (propagation === 'soft') {
      state = isHardFailure ? 'at_risk' : 'unaffected'
    }
    // advisory stays unaffected

    result.set(id, state)

    if (depth < 2) {
      for (const neighbor of adj.get(id) ?? []) {
        const style = EDGE_TYPE_STYLES[neighbor.edgeType]
        const nextProp = propagation === 'advisory' ? 'advisory' : style.propagates
        queue.push({ id: neighbor.targetId, depth: depth + 1, propagation: nextProp })
      }
    }
  }

  return result
}

// ── Component ────────────────────────────────────────────────────────────

export function ControlImpactExplorer({
  nodes,
  edges,
  selectedNodeId = null,
  onNodeSelect,
  onExport,
}: ControlImpactExplorerProps) {
  useRegisterAction('impact-downstream', { app: 'sparta-explorer', action: 'SHOW_DOWNSTREAM_RISK', label: 'Downstream Risk', description: 'Show controls affected if this evidence/control degrades' })
  useRegisterAction('impact-upstream', { app: 'sparta-explorer', action: 'SHOW_UPSTREAM_SUPPORT', label: 'Upstream Support', description: 'Show evidence and controls that strengthen this control' })

  const [direction, setDirection] = useState<'downstream' | 'upstream'>('downstream')
  const [simulatedGrade, setSimulatedGrade] = useState<GradeValue | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState({
    frameworks: new Set<string>(),
    families: new Set<string>(),
    edgeTypes: new Set<EdgeType>(),
    onlyHardDeps: false,
  })

  // Compute cascade state for all nodes
  const cascadeMap = useMemo(
    () => computeCascade(nodes, edges, selectedNodeId, simulatedGrade, direction),
    [nodes, edges, selectedNodeId, simulatedGrade, direction],
  )

  // Apply cascade state to nodes
  const nodesWithCascade = useMemo(() => {
    return nodes.map(n => ({
      ...n,
      cascadeState: cascadeMap.get(n.id) ?? undefined,
    }))
  }, [nodes, cascadeMap])

  // Filter to 2-hop neighborhood
  const visibleNodeIds = useMemo(() => {
    const ids = new Set<string>()
    for (const [id, state] of cascadeMap) {
      if (state !== undefined) ids.add(id)
    }
    // Always include selected node's direct connections for context
    for (const e of edges) {
      if (e.source === selectedNodeId || e.target === selectedNodeId) {
        ids.add(e.source)
        ids.add(e.target)
      }
    }
    return ids
  }, [cascadeMap, edges, selectedNodeId])

  const filteredNodes = useMemo(() => {
    let result = nodesWithCascade.filter(n => visibleNodeIds.has(n.id))
    if (filters.frameworks.size > 0) {
      result = result.filter(n => !n.framework || filters.frameworks.has(n.framework))
    }
    if (filters.families.size > 0) {
      result = result.filter(n => !n.family || filters.families.has(n.family))
    }
    return result
  }, [nodesWithCascade, visibleNodeIds, filters])

  const filteredEdges = useMemo(() => {
    const nodeIdSet = new Set(filteredNodes.map(n => n.id))
    let result = edges.filter(e => nodeIdSet.has(e.source) && nodeIdSet.has(e.target))
    if (filters.edgeTypes.size > 0) {
      result = result.filter(e => filters.edgeTypes.has(e.edgeType))
    }
    if (filters.onlyHardDeps) {
      result = result.filter(e => EDGE_TYPE_STYLES[e.edgeType].propagates === 'hard')
    }
    return result
  }, [filteredNodes, edges, filters])

  // Impact summary
  const summary: ImpactSummary = useMemo(() => {
    let hard = 0, soft = 0, advisory = 0, opportunities = 0
    for (const [id, state] of cascadeMap) {
      if (id === selectedNodeId) continue
      if (state === 'broken') hard++
      else if (state === 'at_risk') soft++
      else if (state === 'unaffected') advisory++
    }
    if (direction === 'upstream') {
      opportunities = [...cascadeMap.values()].filter(s => s === 'unaffected').length
    }
    return { hardDependents: hard, softAtRisk: soft, mappedAdvisory: advisory, strengtheningOpportunities: opportunities }
  }, [cascadeMap, selectedNodeId, direction])

  const selectedNode = nodes.find(n => n.id === selectedNodeId)

  // Graph callbacks
  const nodeColor = useCallback((n: ImpactNode) => {
    if (n.cascadeState === 'selected') return `${EMBRY.accent}25`
    if (n.cascadeState === 'broken') return `${CASCADE_COLORS.broken}20`
    if (n.cascadeState === 'at_risk') return `${CASCADE_COLORS.at_risk}18`
    return `${NODE_CLASS_COLORS[n.nodeClass]}15`
  }, [])

  const nodeStroke = useCallback((n: ImpactNode) => {
    if (n.cascadeState === 'selected') return EMBRY.accent
    if (n.cascadeState === 'broken') return CASCADE_COLORS.broken
    if (n.cascadeState === 'at_risk') return CASCADE_COLORS.at_risk
    return NODE_CLASS_COLORS[n.nodeClass]
  }, [])

  const nodeOpacity = useCallback((n: ImpactNode) => {
    if (!n.cascadeState) return 0.2
    return n.cascadeState === 'unaffected' ? 0.4 : 1
  }, [])

  const edgeColor = useCallback((e: ImpactEdge) => EDGE_TYPE_STYLES[e.edgeType].color, [])
  const edgeOpacity = useCallback((e: ImpactEdge) => EDGE_TYPE_STYLES[e.edgeType].propagates === 'advisory' ? 0.15 : 0.4, [])

  const tooltipContent = useCallback((n: ImpactNode) => {
    const classColor = NODE_CLASS_COLORS[n.nodeClass]
    const stateLabel = n.cascadeState === 'broken' ? 'BROKEN' : n.cascadeState === 'at_risk' ? 'AT RISK' : n.cascadeState === 'selected' ? 'SELECTED' : 'Unaffected'
    const stateColor = CASCADE_COLORS[n.cascadeState ?? 'unaffected']
    return [
      `<div style="margin-bottom:4px"><span style="color:${classColor};font-weight:700">${n.id}</span></div>`,
      `<div style="color:${EMBRY.white};margin-bottom:3px">${n.label}</div>`,
      `<div style="font-size:10px;color:${classColor}">${NODE_CLASS_LABELS[n.nodeClass]}</div>`,
      `<div style="font-size:10px;color:${stateColor};font-weight:700;margin-top:4px">${stateLabel}</div>`,
      n.explanation ? `<div style="font-size:9px;color:${EMBRY.dim};margin-top:2px">${n.explanation}</div>` : '',
    ].join('')
  }, [])

  const handleExport = () => {
    const affected = nodesWithCascade.filter(n => n.cascadeState === 'broken' || n.cascadeState === 'at_risk')
    const rationale = `Forward cascade from ${selectedNodeId} (simulated: ${simulatedGrade ?? 'baseline'}). ${summary.hardDependents} broken, ${summary.softAtRisk} at risk.`
    onExport?.(affected, rationale)
  }

  return (
    <div style={{ ...card, padding: 0, display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Impact Summary Strip */}
      <div style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${EMBRY.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        backgroundColor: EMBRY.bgHeader,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shield size={16} color={EMBRY.accent} />
          <span style={{ ...heading, fontSize: 13 }}>Control Impact Explorer</span>
        </div>

        {selectedNode && (
          <>
            <div style={{ width: 1, height: 20, backgroundColor: EMBRY.border }} />
            <div style={{ fontSize: 11, color: EMBRY.white }}>
              Selected: <span style={{ fontFamily: 'monospace', color: EMBRY.accent }}>{selectedNode.id}</span>
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 10 }}>
              <span style={{ color: CASCADE_COLORS.broken }}>
                <strong>{summary.hardDependents}</strong> broken
              </span>
              <span style={{ color: CASCADE_COLORS.at_risk }}>
                <strong>{summary.softAtRisk}</strong> at risk
              </span>
              <span style={{ color: EMBRY.dim }}>
                <strong>{summary.mappedAdvisory}</strong> advisory
              </span>
              {direction === 'upstream' && (
                <span style={{ color: EMBRY.green }}>
                  <strong>{summary.strengtheningOpportunities}</strong> opportunities
                </span>
              )}
            </div>
          </>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {/* Direction toggle */}
          <div style={{ display: 'flex', gap: 2, padding: 2, borderRadius: 6, backgroundColor: `${EMBRY.bgDeep}80` }}>
            <button
              data-qid="impact:direction:downstream"
              data-qs-action="SET_DIRECTION_DOWNSTREAM"
              title="Downstream Risk — what breaks if this degrades"
              onClick={() => setDirection('downstream')}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px',
                borderRadius: 4, border: 'none', cursor: 'pointer',
                backgroundColor: direction === 'downstream' ? `${EMBRY.red}22` : 'transparent',
                color: direction === 'downstream' ? EMBRY.red : EMBRY.dim,
                fontSize: 10, fontWeight: 600,
              }}
            >
              <ArrowDownRight size={12} /> Risk
            </button>
            <button
              data-qid="impact:direction:upstream"
              data-qs-action="SET_DIRECTION_UPSTREAM"
              title="Upstream Support — what strengthens this control"
              onClick={() => setDirection('upstream')}
              style={{
                display: 'flex', alignItems: 'center', gap: 4, padding: '6px 10px',
                borderRadius: 4, border: 'none', cursor: 'pointer',
                backgroundColor: direction === 'upstream' ? `${EMBRY.green}22` : 'transparent',
                color: direction === 'upstream' ? EMBRY.green : EMBRY.dim,
                fontSize: 10, fontWeight: 600,
              }}
            >
              <ArrowUpLeft size={12} /> Support
            </button>
          </div>

          <button
            data-qid="impact:filters"
            data-qs-action="TOGGLE_FILTERS"
            title="Filter controls and edges"
            onClick={() => setShowFilters(!showFilters)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 36, height: 36, borderRadius: 6, border: `1px solid ${EMBRY.border}`,
              cursor: 'pointer', backgroundColor: showFilters ? `${EMBRY.accent}22` : 'transparent',
              color: showFilters ? EMBRY.accent : EMBRY.dim,
            }}
          >
            <Filter size={14} />
          </button>

          <button
            data-qid="impact:export"
            data-qs-action="EXPORT_AFFECTED"
            title="Export affected controls and rationale"
            onClick={handleExport}
            disabled={!selectedNodeId}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 36, height: 36, borderRadius: 6, border: `1px solid ${EMBRY.border}`,
              cursor: selectedNodeId ? 'pointer' : 'not-allowed',
              backgroundColor: 'transparent',
              color: selectedNodeId ? EMBRY.dim : `${EMBRY.dim}44`,
            }}
          >
            <Download size={14} />
          </button>
        </div>
      </div>

      {/* Legend */}
      <div style={{
        padding: '6px 16px',
        borderBottom: `1px solid ${EMBRY.border}`,
        display: 'flex',
        gap: 12,
        fontSize: 9,
        color: EMBRY.dim,
        alignItems: 'center',
      }}>
        <span style={{ fontWeight: 700, color: EMBRY.white }}>Nodes:</span>
        {Object.entries(NODE_CLASS_LABELS).map(([cls, lbl]) => (
          <span key={cls} style={{ color: NODE_CLASS_COLORS[cls as NodeClass] }}>● {lbl}</span>
        ))}
        <span style={{ width: 1, height: 10, backgroundColor: EMBRY.border }} />
        <span style={{ fontWeight: 700, color: EMBRY.white }}>State:</span>
        <span style={{ color: CASCADE_COLORS.broken }}>● broken</span>
        <span style={{ color: CASCADE_COLORS.at_risk }}>● at risk</span>
        <span style={{ color: CASCADE_COLORS.unaffected }}>○ unaffected</span>
      </div>

      {/* Main content: Graph + optional drawer */}
      <div style={{ flex: 1, display: 'flex', position: 'relative' }}>
        {/* Graph */}
        <div style={{ flex: 1 }}>
          {filteredNodes.length === 0 ? (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              height: '100%', flexDirection: 'column', gap: 12, color: EMBRY.dim,
            }}>
              <Layers size={48} strokeWidth={1} style={{ opacity: 0.3 }} />
              <div style={{ fontSize: 13 }}>Select a control to analyze impact</div>
              <div style={{ fontSize: 11, maxWidth: 300, textAlign: 'center', lineHeight: 1.5 }}>
                Click any control in the matrix to see its 2-hop cascade neighborhood
              </div>
            </div>
          ) : (
            <GraphExplorer<ImpactNode, ImpactEdge>
              nodes={filteredNodes}
              edges={filteredEdges}
              nodeRadius={() => 18}
              nodeColor={nodeColor}
              nodeOpacity={nodeOpacity}
              nodeStroke={nodeStroke}
              nodeStrokeWidth={() => 2.5}
              edgeColor={edgeColor}
              edgeOpacity={edgeOpacity}
              edgeWidth={() => 1.5}
              tooltipContent={tooltipContent}
              onNodeClick={(n) => onNodeSelect?.(n)}
              selectedNodeId={selectedNodeId}
              showMinimap
              chargeStrength={-800}
              linkDistance={120}
            />
          )}
        </div>

        {/* Detail Drawer */}
        {selectedNode && (
          <div style={{
            width: 320,
            backgroundColor: EMBRY.bgPanel,
            borderLeft: `1px solid ${EMBRY.border}`,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Node header */}
            <div style={{ padding: '16px', borderBottom: `1px solid ${EMBRY.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <div style={glowDot(NODE_CLASS_COLORS[selectedNode.nodeClass], 8)} />
                <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: EMBRY.white }}>
                  {selectedNode.id}
                </span>
              </div>
              <div style={{ fontSize: 12, color: EMBRY.dim, lineHeight: 1.4 }}>{selectedNode.label}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                  backgroundColor: `${NODE_CLASS_COLORS[selectedNode.nodeClass]}15`,
                  color: NODE_CLASS_COLORS[selectedNode.nodeClass],
                }}>
                  {NODE_CLASS_LABELS[selectedNode.nodeClass]}
                </span>
                {selectedNode.grade && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 3,
                    backgroundColor: selectedNode.grade.startsWith('A') ? `${EMBRY.green}15` : `${EMBRY.amber}15`,
                    color: selectedNode.grade.startsWith('A') ? EMBRY.green : EMBRY.amber,
                  }}>
                    {selectedNode.grade}
                  </span>
                )}
              </div>
            </div>

            {/* Simulation panel */}
            <div style={{ padding: '16px', borderBottom: `1px solid ${EMBRY.border}` }}>
              <div style={{ ...label, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={12} color={EMBRY.amber} />
                Simulate Degradation
              </div>
              <select
                data-qid="impact:simulate-grade"
                title="Simulate what happens if this control degrades to a different grade"
                value={simulatedGrade ?? ''}
                onChange={(e) => setSimulatedGrade(e.target.value as GradeValue || null)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 6,
                  border: `1px solid ${EMBRY.border}`,
                  backgroundColor: EMBRY.bgDeep,
                  color: EMBRY.white,
                  fontSize: 12,
                  cursor: 'pointer',
                  minHeight: 44,
                }}
              >
                <option value="">Baseline (current state)</option>
                {GRADE_OPTIONS.map(g => (
                  <option key={g} value={g}>
                    Simulate: {g === 'not_satisfied' ? 'Not Satisfied' : g === 'inconclusive' ? 'Inconclusive' : `Grade ${g}`}
                  </option>
                ))}
              </select>
              {simulatedGrade && (
                <div style={{
                  marginTop: 8, padding: 8, borderRadius: 4,
                  backgroundColor: `${CASCADE_COLORS[simulatedGrade === 'not_satisfied' ? 'broken' : 'at_risk']}15`,
                  fontSize: 10, color: EMBRY.dim, lineHeight: 1.4,
                }}>
                  {simulatedGrade === 'not_satisfied' && (
                    <>Hard failure: {summary.hardDependents} controls lose minimum required support</>
                  )}
                  {simulatedGrade === 'inconclusive' && (
                    <>Soft degradation: {summary.softAtRisk} controls now inconclusive or weak</>
                  )}
                  {(simulatedGrade === 'C' || simulatedGrade === 'B') && (
                    <>Grade slip: downstream controls may degrade confidence</>
                  )}
                  {(simulatedGrade === 'A+' || simulatedGrade === 'A') && (
                    <>Strong support maintained — minimal cascade</>
                  )}
                </div>
              )}
            </div>

            {/* Impact breakdown */}
            <div style={{ padding: '16px', flex: 1 }}>
              <div style={{ ...label, marginBottom: 12 }}>Impact Breakdown</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{
                  padding: 10, borderRadius: 6, border: `1px solid ${CASCADE_COLORS.broken}33`,
                  backgroundColor: `${CASCADE_COLORS.broken}08`,
                }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: CASCADE_COLORS.broken }}>{summary.hardDependents}</div>
                  <div style={{ fontSize: 10, color: EMBRY.dim }}>Hard dependents — minimum support lost</div>
                </div>
                <div style={{
                  padding: 10, borderRadius: 6, border: `1px solid ${CASCADE_COLORS.at_risk}33`,
                  backgroundColor: `${CASCADE_COLORS.at_risk}08`,
                }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: CASCADE_COLORS.at_risk }}>{summary.softAtRisk}</div>
                  <div style={{ fontSize: 10, color: EMBRY.dim }}>At risk — now weak or inconclusive</div>
                </div>
                <div style={{
                  padding: 10, borderRadius: 6, border: `1px solid ${EMBRY.border}`,
                  backgroundColor: `${EMBRY.dim}08`,
                }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: EMBRY.dim }}>{summary.mappedAdvisory}</div>
                  <div style={{ fontSize: 10, color: EMBRY.dim }}>Advisory — mapping only, no direct dependency</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default ControlImpactExplorer

/**
 * LemmaGraph — SPARTA Lemma Viewer variant of the shared GraphExplorer.
 *
 * Thin wrapper: proof-status callbacks (sorry contamination, trust boundaries,
 * confidence arcs) delegated to the domain-agnostic graph engine.
 */
import { useCallback, useMemo, useState } from 'react'
import * as d3 from 'd3'
import { EMBRY, card, label, heading, glowDot } from '../common/EmbryStyle'
import { GraphExplorer } from '../../graph-explorer'
import { useRegisterAction } from '../../../hooks/useRegisterAction'

// ── Domain types (preserved interface for SpartaExplorer.tsx) ────────────

export interface GraphNode {
  id: string
  label: string
  framework: string
  size?: number
  proofStatus?: 'proved' | 'sorry' | 'partial' | 'axiom'
  sourceCount?: number
  confidence?: number
}

export interface GraphEdge {
  source: string
  target: string
  method: string
  validated: boolean
  proofDepth?: number
}

export interface LemmaGraphProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  onNodeClick?: (node: GraphNode) => void
  mode?: 'full' | 'critical-path'
}

// ── Helpers ──────────────────────────────────────────────────────────────

function proofColor(status: string, mode: string): string {
  if (mode === 'critical-path') return status === 'sorry' ? EMBRY.red : EMBRY.amber
  switch (status) {
    case 'proved': return EMBRY.green
    case 'sorry': return EMBRY.red
    case 'axiom': return EMBRY.blue
    default: return EMBRY.amber
  }
}

function proofIcon(status: string): string {
  switch (status) {
    case 'proved': return '✓'
    case 'sorry': return '⚠'
    case 'axiom': return '∎'
    default: return '◐'
  }
}

function computeSorryContamination(nodes: GraphNode[], edges: GraphEdge[]): Map<string, boolean> {
  const adjForward = new Map<string, string[]>()
  for (const e of edges) { const t = adjForward.get(e.source) ?? []; t.push(e.target); adjForward.set(e.source, t) }
  const sorryIds = new Set(nodes.filter(n => n.proofStatus === 'sorry').map(n => n.id))
  const taintedIds = new Set<string>()
  const queue = [...sorryIds]
  while (queue.length > 0) {
    const cur = queue.shift()!
    for (const next of adjForward.get(cur) ?? []) {
      if (!taintedIds.has(next) && !sorryIds.has(next)) { taintedIds.add(next); queue.push(next) }
    }
  }
  const result = new Map<string, boolean>()
  for (const n of nodes) result.set(n.id, taintedIds.has(n.id))
  return result
}

// ── Component ───────────────────────────────────────────────────────────

export function LemmaGraph({ nodes, edges, onNodeClick, mode = 'full' }: LemmaGraphProps) {
  useRegisterAction('sparta-show-critical-path', { app: 'sparta-explorer', action: 'SHOW_CRITICAL_PATH', label: 'Show Critical Path', description: 'Display failing attack chains in the proof graph' })
  useRegisterAction('sparta-show-proof-graph', { app: 'sparta-explorer', action: 'SHOW_PROOF_GRAPH', label: 'Show Proof Graph', description: 'Display the full proof graph with lemma verification status' })

  const [activeFrameworks, setActiveFrameworks] = useState<Set<string>>(new Set())
  const allFrameworks = [...new Set(nodes.map((n) => n.framework))]

  const filteredNodes = activeFrameworks.size === 0 ? nodes : nodes.filter((n) => activeFrameworks.has(n.framework))
  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id))
  const filteredEdges = edges.filter((e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target))
  const taintMap = useMemo(() => computeSorryContamination(filteredNodes, filteredEdges), [filteredNodes, filteredEdges])

  function toggleFramework(fw: string) {
    setActiveFrameworks((prev) => { const next = new Set(prev); if (next.has(fw)) next.delete(fw); else next.add(fw); return next })
  }

  const NODE_RADIUS = 22

  const nodeColor = useCallback((node: GraphNode) => {
    const tainted = taintMap.get(node.id)
    if (node.proofStatus === 'sorry') return '#dc262622'
    if (tainted) return '#e8520015'
    if (mode === 'critical-path') return (node.confidence ?? 0.5) < 0.3 ? `${EMBRY.red}22` : `${EMBRY.amber}18`
    if (node.proofStatus === 'proved') return `${EMBRY.green}18`
    if (node.proofStatus === 'axiom') return `${EMBRY.blue}18`
    return `${EMBRY.amber}15`
  }, [taintMap, mode])

  const nodeStroke = useCallback((node: GraphNode) => EMBRY.fw[node.framework] ?? EMBRY.dim, [])

  const edgeColor = useCallback((edge: GraphEdge, src: GraphNode, tgt: GraphNode) => {
    const srcClean = src.proofStatus === 'proved' && !taintMap.get(src.id)
    const tgtTainted = tgt.proofStatus === 'sorry' || taintMap.get(tgt.id)
    if (srcClean && tgtTainted) return '#ff6b35'
    if (!edge.validated) return EMBRY.red
    const avgConf = ((src.confidence ?? 0.5) + (tgt.confidence ?? 0.5)) / 2
    return avgConf > 0.7 ? EMBRY.green : avgConf > 0.4 ? EMBRY.amber : EMBRY.red
  }, [taintMap])

  const edgeWidth = useCallback((edge: GraphEdge, src: GraphNode, tgt: GraphNode) => {
    const srcClean = src.proofStatus === 'proved' && !taintMap.get(src.id)
    const tgtTainted = tgt.proofStatus === 'sorry' || taintMap.get(tgt.id)
    if (srcClean && tgtTainted) return 3
    if (!edge.validated) return 1
    return 1 + ((src.confidence ?? 0.5) + (tgt.confidence ?? 0.5)) / 2 * 7
  }, [taintMap])

  const edgeMarkerEnd = useCallback((edge: GraphEdge) => edge.validated ? 'arrow-valid' : 'arrow-invalid', [])

  const renderDefs = useCallback((defs: d3.Selection<SVGDefsElement, unknown, null, undefined>) => {
    defs.append('style').text(`@keyframes sorry-pulse{0%,100%{stroke-opacity:.3}50%{stroke-opacity:.6}}.sorry-halo{animation:sorry-pulse 1.8s ease-in-out infinite}@keyframes taint-pulse{0%,100%{stroke-opacity:.15}50%{stroke-opacity:.4}}.taint-halo{animation:taint-pulse 2.4s ease-in-out infinite}`)
    const hatch = defs.append('pattern').attr('id', 'sorry-hatch').attr('patternUnits', 'userSpaceOnUse').attr('width', 6).attr('height', 6).attr('patternTransform', 'rotate(45)')
    hatch.append('line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 6).attr('stroke', '#e85200').attr('stroke-width', 1.5).attr('stroke-opacity', 0.35)
    for (const [id, color] of [['arrow-valid', EMBRY.green], ['arrow-invalid', EMBRY.red]] as const) {
      defs.append('marker').attr('id', id).attr('viewBox', '0 -6 12 12').attr('refX', NODE_RADIUS + 14).attr('refY', 0)
        .attr('markerWidth', 14).attr('markerHeight', 14).attr('orient', 'auto')
        .append('path').attr('d', 'M0,-5L12,0L0,5').attr('fill', color).attr('opacity', 0.7)
    }
  }, [])

  const renderNodeExtras = useCallback((
    nodeG: d3.Selection<SVGGElement, (GraphNode & d3.SimulationNodeDatum), SVGGElement, unknown>,
    _degree: Map<string, number>,
  ) => {
    const arc = d3.arc()
    nodeG.append('path').attr('class', 'confidence-arc')
      .attr('d', (d) => arc({ innerRadius: NODE_RADIUS + 5, outerRadius: NODE_RADIUS + 8, startAngle: 0, endAngle: (d.confidence ?? 0.5) * Math.PI * 2 } as d3.DefaultArcObject))
      .attr('fill', (d) => proofColor(d.proofStatus ?? 'partial', mode)).attr('opacity', 1.0)
      .attr('stroke', (d) => proofColor(d.proofStatus ?? 'partial', mode)).attr('stroke-width', 1)

    nodeG.append('circle').attr('class', 'glow-ring').attr('r', NODE_RADIUS + 4).attr('fill', 'none')
      .attr('stroke', (d) => proofColor(d.proofStatus ?? 'partial', mode)).attr('stroke-opacity', 0.35).attr('stroke-width', 5)
      .attr('stroke-dasharray', (d) => d.proofStatus === 'sorry' ? '4 3' : 'none')

    nodeG.filter((d) => d.proofStatus === 'sorry').append('circle').attr('class', 'sorry-halo').attr('r', NODE_RADIUS + 12)
      .attr('fill', 'none').attr('stroke', '#dc2626').attr('stroke-width', 2).attr('stroke-opacity', 0.3)
    nodeG.filter((d) => taintMap.get(d.id) === true).append('circle').attr('class', 'taint-halo').attr('r', NODE_RADIUS + 10)
      .attr('fill', 'none').attr('stroke', EMBRY.amber).attr('stroke-width', 2).attr('stroke-dasharray', '3 2').attr('stroke-opacity', 0.25)
    nodeG.filter((d) => taintMap.get(d.id) === true).append('circle').attr('r', NODE_RADIUS - 1).attr('fill', 'url(#sorry-hatch)').attr('stroke', 'none').attr('pointer-events', 'none')

    nodeG.append('text').attr('class', 'proof-icon').attr('x', NODE_RADIUS - 4).attr('y', -NODE_RADIUS + 6)
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
      .attr('fill', (d) => proofColor(d.proofStatus ?? 'partial', mode)).attr('font-size', 10).attr('font-weight', 900)
      .text((d) => proofIcon(d.proofStatus ?? 'partial'))

    const bx = -(NODE_RADIUS + 4), by = NODE_RADIUS + 2
    nodeG.filter((d) => (d.sourceCount ?? 0) === 0).append('circle').attr('cx', bx).attr('cy', by).attr('r', 9)
      .attr('fill', 'none').attr('stroke', EMBRY.amber).attr('stroke-width', 1.5).attr('stroke-dasharray', '3 2')
    nodeG.filter((d) => (d.sourceCount ?? 0) === 0).append('text').attr('x', bx).attr('y', by + 1)
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'central').attr('fill', EMBRY.amber).attr('font-size', 9).attr('font-weight', 900).attr('font-family', 'monospace').text('?')
    nodeG.filter((d) => (d.sourceCount ?? 0) > 0).append('circle').attr('cx', bx).attr('cy', by).attr('r', 9)
      .attr('fill', '#1e40af').attr('stroke', '#3b82f6').attr('stroke-width', 1.5)
    nodeG.filter((d) => (d.sourceCount ?? 0) > 0).append('text').attr('x', bx).attr('y', by + 1)
      .attr('text-anchor', 'middle').attr('dominant-baseline', 'central').attr('fill', EMBRY.white).attr('font-size', 7).attr('font-weight', 900).attr('font-family', 'monospace')
      .text((d) => `${d.sourceCount}`)

    nodeG.append('text').attr('dy', 1).attr('text-anchor', 'middle').attr('dominant-baseline', 'central')
      .attr('fill', EMBRY.white).attr('font-size', 13).attr('font-weight', 700).attr('font-family', 'monospace')
      .style('paint-order', 'stroke fill').attr('stroke', EMBRY.bgDeep).attr('stroke-width', 3).text((d) => d.id)
  }, [taintMap, mode])

  const tooltipContent = useCallback((node: GraphNode, connEdges: GraphEdge[]) => {
    const fwColor = EMBRY.fw[node.framework] ?? EMBRY.dim
    const methods = [...new Set(connEdges.map((e: any) => e.method))].join(', ')
    const tainted = taintMap.get(node.id)
    const pColor = tainted ? EMBRY.amber : proofColor(node.proofStatus ?? 'partial', mode)
    const pLabel = node.proofStatus === 'sorry' ? 'SORRY' : tainted ? `${(node.proofStatus ?? 'partial').toUpperCase()} (tainted)` : (node.proofStatus ?? 'partial').toUpperCase()
    return [
      `<div style="margin-bottom:4px"><span style="color:${fwColor};font-weight:900;font-size:13px">${node.id}</span> <span style="color:${EMBRY.dim};font-size:10px">${node.framework}</span></div>`,
      `<div style="color:${EMBRY.white};margin-bottom:3px">${node.label}</div>`,
      `<div style="color:${pColor};font-size:10px;font-weight:700;margin-bottom:3px">${proofIcon(node.proofStatus ?? 'partial')} ${pLabel}</div>`,
      tainted ? `<div style="color:${EMBRY.amber};font-size:9px;margin-bottom:3px">⚠ Depends on sorry ancestor</div>` : '',
      `<div style="color:${EMBRY.dim};font-size:10px">${connEdges.length} edges${methods ? ` · ${methods}` : ''}</div>`,
    ].join('')
  }, [taintMap, mode])

  const provedCount = filteredNodes.filter((n) => n.proofStatus === 'proved').length
  const sorryCount = filteredNodes.filter((n) => n.proofStatus === 'sorry').length
  const axiomCount = filteredNodes.filter((n) => n.proofStatus === 'axiom').length
  const partialCount = filteredNodes.filter((n) => !n.proofStatus || n.proofStatus === 'partial').length
  const taintedCount = [...taintMap.values()].filter(Boolean).length
  const validatedCount = filteredEdges.filter((e) => e.validated).length
  const unvalidatedCount = filteredEdges.filter((e) => !e.validated).length

  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div><div style={heading}>Lemma Proof Graph</div><div style={{ ...label, marginTop: 2 }}>{filteredNodes.length} lemmas · {filteredEdges.length} edges</div></div>
        <div style={{ display: 'flex', gap: 6 }}>
          {allFrameworks.map((fw) => {
            const color = EMBRY.fw[fw] ?? EMBRY.dim; const isActive = activeFrameworks.size === 0 || activeFrameworks.has(fw)
            return <button key={fw} data-qid={`lemma-fw-${fw}`} onClick={() => toggleFramework(fw)} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${isActive ? color : EMBRY.border}`, backgroundColor: isActive ? `${color}18` : 'transparent', opacity: isActive ? 1 : 0.4, transition: 'all 0.15s' }}><div style={glowDot(color, 6)} /><span style={{ fontSize: 9, color: isActive ? color : EMBRY.dim, fontWeight: 700 }}>{fw}</span></button>
          })}
          {activeFrameworks.size > 0 && <button data-qid="lemma-fw-reset" onClick={() => setActiveFrameworks(new Set())} style={{ fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 4, cursor: 'pointer', border: `1px solid ${EMBRY.border}`, backgroundColor: 'transparent', color: EMBRY.dim }}>ALL</button>}
        </div>
      </div>

      <div style={{ padding: '4px 16px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', gap: 12, fontSize: 9, alignItems: 'center', color: EMBRY.dim }}>
        <span style={{ fontWeight: 700, color: EMBRY.white, marginRight: 4 }}>Proof:</span>
        <span style={{ color: EMBRY.green }}>● proved</span><span style={{ color: EMBRY.red }}>● sorry</span>
        <span style={{ color: EMBRY.amber }}>● incomplete</span><span style={{ color: EMBRY.blue }}>● axiom</span>
        <span style={{ color: '#e85200', borderBottom: '1px dashed #e85200' }}>◧ tainted</span>
        <span style={{ marginLeft: 'auto', fontWeight: 700, color: EMBRY.white }}>Edges:</span>
        <span style={{ color: EMBRY.green }}>— validated</span><span style={{ color: EMBRY.red }}>┄ unvalidated</span>
        <span style={{ color: '#ff6b35' }}>━ trust boundary</span>
      </div>

      <GraphExplorer<GraphNode, GraphEdge>
        nodes={filteredNodes} edges={filteredEdges} nodeRadius={() => NODE_RADIUS}
        nodeColor={nodeColor} nodeOpacity={() => 1} nodeStroke={nodeStroke} nodeStrokeWidth={() => 3.5}
        renderNodeExtras={renderNodeExtras as any} edgeColor={edgeColor as any} edgeWidth={edgeWidth as any}
        edgeOpacity={(e) => e.validated ? 0.6 : 0.25} edgeMarkerEnd={edgeMarkerEnd}
        edgeLabel={(e) => e.method} renderDefs={renderDefs} tooltipContent={tooltipContent as any}
        onNodeClick={onNodeClick} showMinimap chargeStrength={-1200} linkDistance={200}
      />

      <div style={{ padding: '8px 16px', borderTop: `1px solid ${EMBRY.border}`, display: 'flex', gap: 12, fontSize: 10, flexWrap: 'wrap' }}>
        {provedCount > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ color: EMBRY.green, fontWeight: 900 }}>✓</span><span style={{ color: EMBRY.dim }}>{provedCount} proved</span></div>}
        {sorryCount > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ color: EMBRY.red, fontWeight: 900 }}>⚠</span><span style={{ color: EMBRY.red }}>{sorryCount} sorry</span></div>}
        {taintedCount > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ color: EMBRY.amber, fontWeight: 900 }}>⚠</span><span style={{ color: EMBRY.amber }}>{taintedCount} tainted</span></div>}
        {axiomCount > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ color: EMBRY.blue, fontWeight: 900 }}>∎</span><span style={{ color: EMBRY.dim }}>{axiomCount} axiom</span></div>}
        {partialCount > 0 && <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ color: EMBRY.amber, fontWeight: 900 }}>◐</span><span style={{ color: EMBRY.dim }}>{partialCount} incomplete</span></div>}
        <div style={{ width: 1, height: 12, backgroundColor: EMBRY.border, alignSelf: 'center' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={glowDot(EMBRY.green, 5)} /><span style={{ color: EMBRY.dim }}>{validatedCount} validated</span></div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}><div style={glowDot(EMBRY.red, 5)} /><span style={{ color: EMBRY.dim }}>{unvalidatedCount} unvalidated</span></div>
      </div>
    </div>
  )
}

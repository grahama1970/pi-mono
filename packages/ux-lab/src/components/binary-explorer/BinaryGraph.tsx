/**
 * BinaryGraph — Binary Explorer variant of the shared GraphExplorer.
 *
 * Thin wrapper that passes binary-specific callbacks (node shapes, colors,
 * CWE taxonomy, selection behavior) to the domain-agnostic graph engine.
 *
 * Composition pattern: explicit variant per composition-patterns/patterns-explicit-variants.
 */
import React, { useRef, useEffect, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { EMBRY } from '../common/EmbryStyle'
import { GraphExplorer } from '../graph-explorer'
import type { SelectionContext } from '../graph-explorer'
import type { BinaryGraphNode, BinaryGraphEdge } from '../../hooks/useBinaryData'
import { NODE_TYPE_COLORS } from '../../hooks/useBinaryData'

// ── Props (preserved interface for BinaryExplorerView.tsx) ──────────────

export interface BinaryGraphProps {
  nodes: BinaryGraphNode[]
  edges: BinaryGraphEdge[]
  matchedNodeIds?: Set<string>
  visitedNodeIds?: Set<string>
  onNodeClick?: (node: BinaryGraphNode) => void
  onNodeHover?: (node: BinaryGraphNode | null) => void
  onContextMenu?: (node: BinaryGraphNode, x: number, y: number) => void
  layoutMode?: 'organic' | 'stratified' | 'clustered' | 'hierarchical'
  selectedNodeId?: string | null
  graphSvgRef?: React.MutableRefObject<SVGSVGElement | null>
  expandedNodeIds?: Set<string>
  perspective?: string
  taxonomyMap?: Map<string, { mind: string[]; cwe: string[]; attack: string[]; d3fend: string[]; nist: string[] }>
  activeTypeFilters?: Set<string>
  onToggleTypeFilter?: (type: string) => void
}

// ── Domain constants ────────────────────────────────────────────────────

const EDGE_COLORS: Record<string, string> = {
  contains: '#64748b', payload: '#2196F3', emits: '#FF9800',
  triggers: '#4CAF50', has_parameter: '#9C27B0',
}

const EDGE_WIDTHS: Record<string, number> = {
  contains: 1.2, payload: 2.0, emits: 2.4,
  triggers: 3.0, has_parameter: 1.5,
}

const TIER_COLORS: Record<string, string> = { '0': '#00ff88', '1': '#4a9eff', '2': '#ffaa00' }

// ── Node shape: event→diamond, schema→square, cli_command→triangle ─────

function binaryNodeShapePath(node: BinaryGraphNode, radius: number): string {
  if (radius === 0) return 'M0,0'
  const r = radius
  if (node.nodeType === 'event') return `M0,${-r} L${r},0 L0,${r} L${-r},0 Z`
  if (node.nodeType === 'schema') {
    const s = r * 0.88
    return `M${-s},${-s} L${s},${-s} L${s},${s} L${-s},${s} Z`
  }
  if (node.nodeType === 'cli_command') return `M0,${-r} L${r * 0.93},${r * 0.6} L${-r * 0.93},${r * 0.6} Z`
  const k = r * 0.5523
  return `M0,${-r} C${k},${-r} ${r},${-k} ${r},0 C${r},${k} ${k},${r} 0,${r} C${-k},${r} ${-r},${k} ${-r},0 C${-r},${-k} ${-k},${-r} 0,${-r} Z`
}

function binaryNodeRadius(node: BinaryGraphNode, deg: number): number {
  const base = Math.min(14, 6 + Math.log10(deg + 1) * 3)
  switch (node.nodeType) {
    case 'namespace': return Math.min(16, base + 2)
    case 'schema': return Math.min(12, base + 1)
    case 'state_machine': return Math.min(11, base + 1)
    case 'event': return Math.max(5, base - 1)
    case 'parameter': return Math.max(4, base - 2)
    default: return base
  }
}

function binaryStratifiedY(node: BinaryGraphNode): number {
  if (node.nodeType === 'cli_command' || node.nodeType === 'namespace') return 0.15
  if (node.nodeType === 'rpc') return 0.35
  if (node.nodeType === 'event') return 0.65
  if (node.nodeType === 'state_machine' || node.nodeType === 'parameter' || node.nodeType === 'schema') return 0.85
  return 0.5
}

// ── Component ───────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function BinaryGraph({ nodes, edges, matchedNodeIds, visitedNodeIds, onNodeClick, onNodeHover, onContextMenu, layoutMode = 'organic', selectedNodeId = null, graphSvgRef, taxonomyMap, activeTypeFilters, onToggleTypeFilter }: BinaryGraphProps) {
  const [activeLayout, setActiveLayout] = useState(layoutMode)
  const taxonomyRef = useRef(taxonomyMap)
  taxonomyRef.current = taxonomyMap
  const selectedNodeIdRef = useRef(selectedNodeId)
  selectedNodeIdRef.current = selectedNodeId
  const visitedRef = useRef(visitedNodeIds)
  visitedRef.current = visitedNodeIds
  const svgRef = graphSvgRef ?? useRef<SVGSVGElement>(null)

  useEffect(() => { setActiveLayout(layoutMode) }, [layoutMode])

  const hasCwe = useCallback((id: string) => {
    const tax = taxonomyRef.current?.get(id)
    return !!(tax && (tax.cwe?.length > 0 || tax.attack?.length > 0))
  }, [])

  // ── Callbacks for GraphExplorer ─────────────────────────────────────

  const nodeColor = useCallback((node: BinaryGraphNode) =>
    hasCwe(node.id) ? '#ef4444' : (NODE_TYPE_COLORS[node.nodeType] ?? EMBRY.dim)
  , [hasCwe])

  const nodeStroke = useCallback((node: BinaryGraphNode) => {
    if (node.id === selectedNodeIdRef.current) return EMBRY.white
    return hasCwe(node.id) ? '#fca5a5' : (NODE_TYPE_COLORS[node.nodeType] ?? EMBRY.dim)
  }, [hasCwe])

  const nodeStrokeWidth = useCallback((node: BinaryGraphNode, deg: number) => {
    if (node.id === selectedNodeIdRef.current) return 2.5
    if (hasCwe(node.id)) return 2
    if (deg > 15) return 2.5
    if (deg > 8) return 2.0
    if (deg > 4) return 1.5
    return 1
  }, [hasCwe])

  const edgeColor = useCallback((_edge: BinaryGraphEdge) => EDGE_COLORS[_edge.edgeType] ?? EMBRY.dim, [])
  const edgeWidth = useCallback((_edge: BinaryGraphEdge) => (EDGE_WIDTHS[_edge.edgeType] ?? 1.0) * 0.4, [])
  const edgeMarkerEnd = useCallback((edge: BinaryGraphEdge) => edge.edgeType !== 'contains' ? `arrow-${edge.edgeType}` : null, [])
  const edgeLabelFn = useCallback((edge: BinaryGraphEdge) => edge.edgeType.replace(/_/g, ' '), [])

  // ── SVG defs: arrowhead markers per edge type ───────────────────────

  const renderDefs = useCallback((defs: d3.Selection<SVGDefsElement, unknown, null, undefined>) => {
    defs.html(`<style>@keyframes pulse-ring{0%{r:14;opacity:.8}50%{r:22;opacity:.2}100%{r:14;opacity:.8}}.pulse-ring{animation:pulse-ring 1.5s ease-in-out infinite}</style>`)
    for (const [type, color] of Object.entries(EDGE_COLORS)) {
      if (type === 'contains') continue
      defs.append('marker').attr('id', `arrow-${type}`).attr('viewBox', '0 -3 6 6')
        .attr('refX', 6).attr('refY', 0).attr('markerWidth', 4).attr('markerHeight', 4).attr('orient', 'auto')
        .append('path').attr('d', 'M0,-3L6,0L0,3').attr('fill', color).attr('opacity', 0.6)
    }
  }, [])

  // ── Node extras: CWE rings, tier badges, mind-tag dots, hub badges ──

  const renderNodeExtras = useCallback((
    nodeG: d3.Selection<SVGGElement, BinaryGraphNode & d3.SimulationNodeDatum, SVGGElement, unknown>,
    degree: Map<string, number>,
  ) => {
    const r = (d: BinaryGraphNode & d3.SimulationNodeDatum) => {
      const base = binaryNodeRadius(d, degree.get(d.id) ?? 0)
      return hasCwe(d.id) ? base * 1.3 : base
    }

    // State machine ring
    nodeG.filter((d) => d.nodeType === 'state_machine')
      .append('circle').attr('class', 'state-ring').attr('cx', 0).attr('cy', 0).attr('r', (d) => r(d) + 3)
      .attr('fill', 'none').attr('stroke', NODE_TYPE_COLORS.state_machine).attr('stroke-width', 1).attr('stroke-opacity', 0.4).attr('stroke-dasharray', '2,2')

    // CWE hazard ring + glow
    nodeG.filter((d) => hasCwe(d.id))
      .append('circle').attr('class', 'cwe-ring').attr('cx', 0).attr('cy', 0).attr('r', (d) => r(d) + 8)
      .attr('fill', 'none').attr('stroke', '#ef4444').attr('stroke-width', 3).attr('stroke-opacity', 0.85).attr('stroke-dasharray', '4,2')
    nodeG.filter((d) => hasCwe(d.id))
      .append('circle').attr('class', 'cwe-glow').attr('cx', 0).attr('cy', 0).attr('r', (d) => r(d) + 14)
      .attr('fill', 'none').attr('stroke', '#ef4444').attr('stroke-width', 2).attr('stroke-opacity', 0.25)

    // CWE badge dot
    nodeG.filter((d) => { const tax = taxonomyRef.current?.get(d.id); return !!(tax && tax.cwe?.length > 0) })
      .append('circle').attr('class', 'cwe-badge').attr('cx', (d) => r(d) - 1).attr('cy', (d) => r(d) - 1)
      .attr('r', 3).attr('fill', '#ef4444').attr('stroke', '#7f1d1d').attr('stroke-width', 0.5)

    // Tier badge
    nodeG.append('circle').attr('class', 'tier-badge').attr('cx', (d) => r(d) - 2).attr('cy', (d) => -(r(d) - 2))
      .attr('r', 3).attr('fill', (d) => TIER_COLORS[d.tier] ?? EMBRY.muted).attr('stroke', EMBRY.bgDeep).attr('stroke-width', 1).attr('opacity', 0.8)

    // SPARTA mind-tag dot
    nodeG.filter((d) => (taxonomyRef.current?.get(d.id)?.mind?.length ?? 0) > 0)
      .append('circle').attr('class', 'mind-tag-dot').attr('cx', (d) => -(r(d) - 2)).attr('cy', (d) => r(d) - 2)
      .attr('r', 3.5).attr('fill', '#9C27B0').attr('stroke', EMBRY.bgDeep).attr('stroke-width', 1).attr('opacity', 0.9)
      .append('title').text((d) => 'SPARTA: ' + (taxonomyRef.current?.get(d.id)?.mind ?? []).join(', '))

    // Hub badge
    nodeG.filter((d) => (degree.get(d.id) ?? 0) > 8)
      .append('text').attr('class', 'hub-badge').attr('dy', (d) => -(r(d) + 6)).attr('text-anchor', 'middle')
      .attr('fill', EMBRY.accent).attr('font-size', 7).attr('font-weight', 700).attr('font-family', 'JetBrains Mono, monospace')
      .text((d) => `${degree.get(d.id)}`)
  }, [hasCwe])

  // ── Tooltip ─────────────────────────────────────────────────────────

  const tooltipContent = useCallback((node: BinaryGraphNode, connectedEdges: BinaryGraphEdge[], deg: number) => {
    const color = NODE_TYPE_COLORS[node.nodeType] ?? EMBRY.dim
    const top3 = connectedEdges.slice(0, 3).map((e: any) => {
      const other = (e.source?.id ?? e.source) === node.id ? (e.target?.label ?? e.target) : (e.source?.label ?? e.source)
      const l = typeof other === 'string' ? other : other?.toString() ?? ''
      return l.length > 20 ? l.slice(0, 18) + '…' : l
    })
    const tierColor = node.tier === 'T0' ? '#4CAF50' : node.tier === 'T1' ? '#2196F3' : '#FF9800'
    const mindTags = taxonomyRef.current?.get(node.id)?.mind ?? []
    return [
      `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><div style="font-weight:900;font-size:13px;color:${color}">${node.label}</div><div style="font-size:8px;padding:1px 4px;border:1px solid ${tierColor};color:${tierColor};text-transform:uppercase">${node.tier || '??'}</div></div>`,
      `<div style="font-size:10px;color:${EMBRY.dim};margin:3px 0">${node.nodeType.replace('_', ' ')} · ${deg} connections</div>`,
      top3.length > 0 ? `<div style="font-size:9px;color:${EMBRY.muted};margin-bottom:6px">${top3.join(', ')}</div>` : '',
      node.description ? `<div style="font-size:10px;color:${EMBRY.white};opacity:0.8;margin:6px 0;line-height:1.4;white-space:normal;max-width:240px">${node.description}</div>` : '',
      mindTags.length > 0 ? `<div style="margin-top:6px;display:flex;gap:3px;flex-wrap:wrap">${mindTags.map(t => `<span style="font-size:7px;padding:1px 4px;border-radius:2px;background:#9C27B015;border:1px solid #9C27B044;color:#CE93D8">${t}</span>`).join('')}</div>` : '',
      `<div style="font-size:8px;color:${EMBRY.accent};margin-top:8px;font-weight:700;text-transform:uppercase">click to select · dbl-click to focus</div>`,
    ].join('')
  }, [])

  // ── Selection visuals: 1-hop edge reveal + hierarchy ────────────────

  const applySelectionVisuals = useCallback((ctx: SelectionContext<BinaryGraphNode, BinaryGraphEdge>) => {
    const { targetId, simNodes, simEdges, degree, nodeGs, edgeLines, edgeLabels } = ctx
    const visited = visitedRef.current
    const hasFilter = matchedNodeIds && matchedNodeIds.size > 0
    const isMatched = (id: string) => !hasFilter || matchedNodeIds!.has(id)

    if (!targetId) {
      edgeLines.transition().duration(200).attr('stroke-opacity', 0.15)
      edgeLabels.transition().duration(200).attr('opacity', 0)
      nodeGs.select('.node-shape').transition().duration(200).attr('stroke', 'none').attr('stroke-width', 0)
      nodeGs.transition().duration(200).attr('opacity', (n: any) => isMatched(n.id) ? 1 : 0.12)
      nodeGs.select('.node-label').transition().duration(200).attr('opacity', (n: any) => n.nodeType === 'namespace' ? 1 : 0)
      if (visited && visited.size > 0) {
        nodeGs.select('.node-shape').transition().duration(200)
          .attr('stroke', (n: any) => visited.has(n.id) ? EMBRY.accent : 'none')
          .attr('stroke-width', (n: any) => visited.has(n.id) ? 1.5 : 0)
          .attr('stroke-opacity', (n: any) => visited.has(n.id) ? 0.3 : 0)
      }
      return
    }

    const connIds = new Set<string>([targetId])
    const shownEdges = new Set<typeof simEdges[0]>()
    const hop1 = simEdges.filter((e: any) => (e.source?.id ?? e.source) === targetId || (e.target?.id ?? e.target) === targetId)
    const typePriority: Record<string, number> = { triggers: 0, emits: 1, payload: 2, has_parameter: 3, contains: 4 }
    hop1.sort((a: any, b: any) => (typePriority[a.edgeType] ?? 5) - (typePriority[b.edgeType] ?? 5))
    hop1.slice(0, 15).forEach((e: any) => { shownEdges.add(e); connIds.add(e.source?.id ?? e.source); connIds.add(e.target?.id ?? e.target) })

    edgeLines.transition().duration(200)
      .attr('stroke-opacity', (e: any) => shownEdges.has(e) ? 0.85 : 0)
      .attr('stroke-width', (e: any) => shownEdges.has(e) ? (EDGE_WIDTHS[e.edgeType] ?? 1.0) * 1.5 : 0)
    edgeLabels.transition().duration(200).attr('opacity', (e: any) => shownEdges.has(e) ? 0.85 : 0)

    const hasVisibleEdges = shownEdges.size > 0
    nodeGs.transition().duration(200).attr('opacity', (n: any) => {
      if (n.id === targetId) return 1
      if (connIds.has(n.id)) return 0.70
      if (visited && visited.has(n.id)) return 0.50
      return hasVisibleEdges ? 0.30 : 0.70
    })
    nodeGs.select('.node-shape').transition().duration(200)
      .attr('stroke', (n: any) => n.id === targetId ? EMBRY.white : visited?.has(n.id) ? EMBRY.accent : 'none')
      .attr('stroke-width', (n: any) => n.id === targetId ? 3 : visited?.has(n.id) ? 1.5 : 0)
      .attr('stroke-opacity', (n: any) => n.id === targetId ? 1 : visited?.has(n.id) ? 0.4 : 0)
    nodeGs.select('.node-label').transition().duration(200)
      .attr('opacity', (n: any) => connIds.has(n.id) ? 1 : visited?.has(n.id) ? 0.7 : 0)
    nodeGs.select('.node-shape').attr('filter', (n: any) => n.id === targetId ? 'url(#node-glow)' : 'none')
    nodeGs.select('.pulse-ring').remove()
    nodeGs.filter((n: any) => n.id === targetId)
      .append('circle').attr('class', 'pulse-ring').attr('r', (n: any) => binaryNodeRadius(n, degree.get(n.id) ?? 0) + 6)
      .attr('fill', 'none').attr('stroke', EMBRY.accent).attr('stroke-width', 1.5).attr('opacity', 0.8)
  }, [matchedNodeIds])

  // ── Taxonomy re-coloring ────────────────────────────────────────────

  const taxonomySize = taxonomyMap?.size ?? 0
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !taxonomyMap || taxonomyMap.size === 0) return
    const d3svg = d3.select(svg)
    d3svg.selectAll<SVGPathElement, BinaryGraphNode & d3.SimulationNodeDatum>('.node-shape')
      .attr('fill', (nd) => hasCwe(nd.id) ? '#ef4444' : (NODE_TYPE_COLORS[nd.nodeType] ?? EMBRY.dim))
      .attr('fill-opacity', (nd) => hasCwe(nd.id) ? 0.9 : 0.7)
      .attr('stroke', (nd) => nd.id === selectedNodeIdRef.current ? EMBRY.white : hasCwe(nd.id) ? '#fca5a5' : (NODE_TYPE_COLORS[nd.nodeType] ?? EMBRY.dim))
      .attr('stroke-width', (nd) => nd.id === selectedNodeIdRef.current ? 2.5 : hasCwe(nd.id) ? 2 : 1)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taxonomySize])

  // ── Matched node highlighting ───────────────────────────────────────

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const zoomG = d3.select(svg).select('g.zoom-container')
    if (zoomG.empty()) return
    const nGs = zoomG.select('g.nodes').selectAll<SVGGElement, BinaryGraphNode & d3.SimulationNodeDatum>('g')
    if (nGs.empty()) return
    const filtering = matchedNodeIds && matchedNodeIds.size > 0
    nGs.transition().duration(200).attr('opacity', (d) => !filtering || matchedNodeIds!.has(d.id) ? 1 : 0.12)
    if (filtering) {
      nGs.selectAll<SVGPathElement, BinaryGraphNode & d3.SimulationNodeDatum>('.node-shape').transition().duration(200)
        .attr('stroke', (d) => matchedNodeIds!.has(d.id) ? '#39FF14' : (d.id === selectedNodeIdRef.current ? '#fff' : (NODE_TYPE_COLORS[d.nodeType] ?? '#6b7280')))
        .attr('stroke-width', (d) => matchedNodeIds!.has(d.id) ? 3 : (d.id === selectedNodeIdRef.current ? 2.5 : 1))
        .attr('filter', (d) => matchedNodeIds!.has(d.id) ? 'url(#glow)' : 'none')
      nGs.selectAll<SVGTextElement, BinaryGraphNode & d3.SimulationNodeDatum>('.node-label').transition().duration(200)
        .attr('opacity', (d) => matchedNodeIds!.has(d.id) || d.nodeType === 'namespace' ? 1 : 0)
    } else {
      nGs.selectAll<SVGPathElement, BinaryGraphNode & d3.SimulationNodeDatum>('.node-shape').transition().duration(200)
        .attr('stroke', (d) => d.id === selectedNodeIdRef.current ? '#fff' : (NODE_TYPE_COLORS[d.nodeType] ?? '#6b7280'))
        .attr('stroke-width', (d) => d.id === selectedNodeIdRef.current ? 2.5 : 1).attr('filter', 'none')
      const transform = d3.zoomTransform(svg)
      const labelOpacity = transform.k > 1.5 ? Math.min(0.8, (transform.k - 1.5) * 2) : 0
      nGs.selectAll<SVGTextElement, BinaryGraphNode & d3.SimulationNodeDatum>('.node-label').transition().duration(200)
        .attr('opacity', (d) => d.nodeType === 'namespace' ? 1 : labelOpacity)
    }
  }, [matchedNodeIds])

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <div style={{ padding: 0, overflow: 'hidden', flex: '1 1 0%', minHeight: 0, display: 'flex', flexDirection: 'column', borderRadius: 0 }} tabIndex={0}>
      {/* Legend */}
      <div style={{ padding: '6px 12px', borderBottom: `1px solid ${EMBRY.border}`, display: 'flex', gap: 12, fontSize: 9, alignItems: 'center', color: EMBRY.dim, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {Object.entries(NODE_TYPE_COLORS).map(([type, color]) => {
            const S = 10
            let shapeEl: React.ReactNode
            if (type === 'event') shapeEl = <svg width={S} height={S} viewBox="-5 -5 10 10" style={{ flexShrink: 0 }}><path d="M0,-4 L4,0 L0,4 L-4,0 Z" fill={color} fillOpacity={0.8} /></svg>
            else if (type === 'schema') shapeEl = <svg width={S} height={S} viewBox="-5 -5 10 10" style={{ flexShrink: 0 }}><rect x="-3.5" y="-3.5" width="7" height="7" fill={color} fillOpacity={0.8} /></svg>
            else if (type === 'cli_command') shapeEl = <svg width={S} height={S} viewBox="-5 -5 10 10" style={{ flexShrink: 0 }}><path d="M0,-4 L3.8,2.4 L-3.8,2.4 Z" fill={color} fillOpacity={0.8} /></svg>
            else if (type === 'state_machine') shapeEl = <svg width={S + 2} height={S + 2} viewBox="-6 -6 12 12" style={{ flexShrink: 0 }}><circle r="3.5" fill={color} fillOpacity={0.8} /><circle r="5" fill="none" stroke={color} strokeWidth="0.8" strokeOpacity={0.5} strokeDasharray="2,1.5" /></svg>
            else shapeEl = <svg width={S} height={S} viewBox="-5 -5 10 10" style={{ flexShrink: 0 }}><circle r="3.5" fill={color} fillOpacity={0.8} /></svg>
            const isFiltered = activeTypeFilters && activeTypeFilters.size > 0
            const isActive = !isFiltered || activeTypeFilters!.has(type)
            return (
              <span key={type} id={`be-legend-${type}`} data-qid={`be-legend-filter-${type}`} data-qs-action="TOGGLE_TYPE_FILTER" data-qs-params={JSON.stringify({ type })} onClick={() => onToggleTypeFilter?.(type)}
                style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: onToggleTypeFilter ? 'pointer' : 'default', opacity: isActive ? 1 : 0.3, textDecoration: activeTypeFilters?.has(type) ? 'underline' : 'none', transition: 'opacity 0.15s' }}>
                {shapeEl}{type.replace(/_/g, ' ')}
              </span>
            )
          })}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          {(['organic', 'hierarchical', 'stratified', 'clustered'] as const).map((mode) => (
            <button key={mode} data-qid={`be-layout-${mode}`} data-qs-action="SET_LAYOUT" data-qs-params={JSON.stringify({ mode })} onClick={() => setActiveLayout(mode)}
              title={mode === 'organic' ? 'Force-directed' : mode === 'hierarchical' ? 'Sugiyama DAG' : mode === 'stratified' ? 'Layer by type' : 'Cluster by namespace'}
              style={{ fontSize: 8, padding: '1px 6px', cursor: 'pointer', fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase', letterSpacing: '0.04em', border: `1px solid ${activeLayout === mode ? EMBRY.accent : EMBRY.border}`, background: activeLayout === mode ? `${EMBRY.accent}22` : 'transparent', color: activeLayout === mode ? EMBRY.accent : EMBRY.muted, borderRadius: 0 }}>
              {mode === 'organic' ? 'FORCE' : mode === 'hierarchical' ? 'HIERARCHY' : mode === 'stratified' ? 'LAYERS' : 'CLUSTERS'}
            </button>
          ))}
        </div>
        <span style={{ color: EMBRY.muted }}>{nodes.length} nodes</span>
        <span style={{ color: EMBRY.muted, fontSize: 8, opacity: 0.7 }}>
          <kbd style={{ padding: '0 3px', background: '#1a1a1a', border: `1px solid ${EMBRY.border}`, borderRadius: 1, fontSize: 7 }}>F</kbd> fit
          {' '}<kbd style={{ padding: '0 3px', background: '#1a1a1a', border: `1px solid ${EMBRY.border}`, borderRadius: 1, fontSize: 7 }}>Esc</kbd> desel
        </span>
      </div>

      {/* Graph Engine */}
      <div style={{ position: 'relative', flex: '1 1 0%', minHeight: 0 }}>
        <GraphExplorer<BinaryGraphNode, BinaryGraphEdge>
          nodes={nodes} edges={edges} layoutMode={activeLayout}
          stratifiedYFn={binaryStratifiedY} clusterKeyFn={(n) => n.cluster}
          nodeShapePath={binaryNodeShapePath} nodeRadius={binaryNodeRadius}
          nodeColor={nodeColor} nodeOpacity={() => 0.7} nodeStroke={nodeStroke} nodeStrokeWidth={nodeStrokeWidth}
          renderNodeExtras={renderNodeExtras as any} edgeColor={edgeColor as any} edgeWidth={edgeWidth as any}
          edgeOpacity={() => 0.15} edgeMarkerEnd={edgeMarkerEnd} edgeLabel={edgeLabelFn}
          renderDefs={renderDefs} tooltipContent={tooltipContent as any}
          selectedNodeId={selectedNodeId} onNodeClick={onNodeClick} onNodeHover={onNodeHover} onContextMenu={onContextMenu}
          applySelectionVisuals={applySelectionVisuals as any}
          matchedNodeIds={matchedNodeIds} visitedNodeIds={visitedNodeIds}
          showMinimap showHulls graphSvgRef={svgRef}
        />
        {/* Edge Type Legend */}
        <div style={{ position: 'absolute', bottom: 10, left: 10, zIndex: 10, background: 'rgba(16,16,20,0.85)', border: `1px solid ${EMBRY.border}`, borderRadius: 4, padding: '6px 10px', backdropFilter: 'blur(8px)', fontSize: 11, fontFamily: 'JetBrains Mono, monospace', color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: 3, pointerEvents: 'none' }}>
          <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', color: EMBRY.dim, marginBottom: 2 }}>Edges</div>
          {([['contains', '#64748b', 'none'], ['payload', '#2196F3', 'none'], ['emits', '#FF9800', 'none'], ['triggers', '#4CAF50', 'none'], ['has_parameter', '#9C27B0', '3,2']] as const).map(([lbl, col, dash]) => (
            <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <svg width="20" height="6"><line x1="0" y1="3" x2="20" y2="3" stroke={col} strokeWidth={lbl === 'triggers' ? 2.5 : 1.5} strokeDasharray={dash} /></svg>
              <span style={{ fontSize: 9 }}>{lbl.replace('_', ' ')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

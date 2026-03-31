import { useRef, useEffect, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { EMBRY, card, label, heading, glowDot } from '../common/EmbryStyle'

export interface GraphNode {
  id: string
  label: string
  framework: string
  size?: number
  /** Rob Armstrong: proof status — proved, sorry (unproved subgoal), partial, axiom */
  proofStatus?: 'proved' | 'sorry' | 'partial' | 'axiom'
  /** Brandon Bailey: number of source documents tracing to this node */
  sourceCount?: number
  /** Brandon Bailey: fidelity confidence 0–1 derived from source quality */
  confidence?: number
}

export interface GraphEdge {
  source: string
  target: string
  method: string
  validated: boolean
  /** Rob Armstrong: depth in proof tree (0 = root axiom) */
  proofDepth?: number
}

export interface LemmaGraphProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  onNodeClick?: (node: GraphNode) => void
  /** 'full' = all nodes, 'critical-path' = only failing chains (red/amber) */
  mode?: 'full' | 'critical-path'
}

interface SimNode extends d3.SimulationNodeDatum {
  id: string
  label: string
  framework: string
  size: number
  proofStatus: 'proved' | 'sorry' | 'partial' | 'axiom'
  sourceCount: number
  confidence: number
  /** R4 Rob: true when node is proved locally but has sorry ancestor(s) */
  sorryTainted: boolean
}

interface SimEdge extends d3.SimulationLinkDatum<SimNode> {
  method: string
  validated: boolean
  proofDepth: number
}

export function LemmaGraph({ nodes, edges, onNodeClick, mode = 'full' }: LemmaGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 })
  const [activeFrameworks, setActiveFrameworks] = useState<Set<string>>(new Set())

  // Derive which frameworks exist in data
  const allFrameworks = [...new Set(nodes.map((n) => n.framework))]

  // Filter: empty set = show all, otherwise only active
  const filteredNodes = activeFrameworks.size === 0
    ? nodes
    : nodes.filter((n) => activeFrameworks.has(n.framework))
  const filteredNodeIds = new Set(filteredNodes.map((n) => n.id))
  const filteredEdges = edges.filter((e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target))

  function toggleFramework(fw: string) {
    setActiveFrameworks((prev) => {
      const next = new Set(prev)
      if (next.has(fw)) {
        next.delete(fw)
      } else {
        next.add(fw)
      }
      return next
    })
  }

  const setupSimulation = useCallback(() => {
    const svg = svgRef.current
    if (!svg || filteredNodes.length === 0) return

    const { width, height } = dimensions

    // Clear previous
    d3.select(svg).selectAll('*').remove()

    const root = d3.select(svg)
      .attr('viewBox', `0 0 ${width} ${height}`)

    const nodeRadius = 22

    // Zoom container — everything goes inside this group
    const zoomG = root.append('g').attr('class', 'zoom-container')

    // SVG defs — arrowhead markers + sorry pulse animation
    const defs = root.append('defs')

    // Rob Armstrong: sorry pulse + tainted node hatching animation styles
    const style = root.append('style')
    style.text(`
      @keyframes sorry-pulse {
        0%, 100% { stroke-opacity: 0.3; r: ${nodeRadius + 10}; }
        50% { stroke-opacity: 0.6; r: ${nodeRadius + 16}; }
      }
      .sorry-halo { animation: sorry-pulse 1.8s ease-in-out infinite; }
      @keyframes taint-pulse {
        0%, 100% { stroke-opacity: 0.15; }
        50% { stroke-opacity: 0.4; }
      }
      .taint-halo { animation: taint-pulse 2.4s ease-in-out infinite; }
    `)
    // R4 Rob: diagonal hatch pattern for sorry-tainted nodes
    const hatch = defs.append('pattern')
      .attr('id', 'sorry-hatch')
      .attr('patternUnits', 'userSpaceOnUse')
      .attr('width', 6).attr('height', 6)
      .attr('patternTransform', 'rotate(45)')
    // R5: orange-red hatch (#e85200) to distinguish from sorry-red (#dc2626)
    hatch.append('line')
      .attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 6)
      .attr('stroke', '#e85200').attr('stroke-width', 1.5).attr('stroke-opacity', 0.35)
    // R5: larger arrowheads (10→14) per Rob — direction must survive zoom-out
    for (const [id, color] of [['arrow-valid', EMBRY.green], ['arrow-invalid', EMBRY.red]] as const) {
      defs.append('marker')
        .attr('id', id)
        .attr('viewBox', '0 -6 12 12')
        .attr('refX', nodeRadius + 14)
        .attr('refY', 0)
        .attr('markerWidth', 14)
        .attr('markerHeight', 14)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L12,0L0,5')
        .attr('fill', color)
        .attr('opacity', 0.7)
    }

    // d3.zoom with scroll-wheel zoom + pan
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 4])
      .on('zoom', (event) => {
        zoomG.attr('transform', event.transform)
      })
    root.call(zoom)

    // Double-click to reset zoom
    root.on('dblclick.zoom', () => {
      root.transition().duration(300).call(zoom.transform, d3.zoomIdentity)
    })

    // Build simulation data
    const simNodes: SimNode[] = filteredNodes.map((n) => ({
      id: n.id, label: n.label, framework: n.framework, size: n.size ?? 1,
      proofStatus: n.proofStatus ?? 'partial',
      sourceCount: n.sourceCount ?? 0,
      confidence: n.confidence ?? 0.5,
      sorryTainted: false, // computed below
    }))

    const simEdges: SimEdge[] = filteredEdges
      .filter((e) => simNodes.some((n) => n.id === e.source) && simNodes.some((n) => n.id === e.target))
      .map((e) => ({ source: e.source, target: e.target, method: e.method, validated: e.validated, proofDepth: e.proofDepth ?? 0 }))

    // R4 Rob Armstrong: compute sorry contamination via BFS from sorry nodes
    // A "proved" node is tainted if ANY ancestor in the DAG has proofStatus=sorry
    const adjReverse = new Map<string, string[]>() // target → sources (upstream)
    for (const e of filteredEdges) {
      const targets = adjReverse.get(e.target) ?? []
      targets.push(e.source)
      adjReverse.set(e.target, targets)
    }
    const sorryIds = new Set(simNodes.filter(n => n.proofStatus === 'sorry').map(n => n.id))
    // BFS forward from sorry nodes through DAG edges (source→target = implication)
    const adjForward = new Map<string, string[]>()
    for (const e of filteredEdges) {
      const targets = adjForward.get(e.source) ?? []
      targets.push(e.target)
      adjForward.set(e.source, targets)
    }
    const taintedIds = new Set<string>()
    const queue = [...sorryIds]
    while (queue.length > 0) {
      const cur = queue.shift()!
      for (const next of adjForward.get(cur) ?? []) {
        if (!taintedIds.has(next) && !sorryIds.has(next)) {
          taintedIds.add(next)
          queue.push(next)
        }
      }
    }
    for (const n of simNodes) {
      n.sorryTainted = taintedIds.has(n.id)
    }

    // Tooltip div
    let tooltipEl = svg.parentElement?.querySelector('.graph-tooltip') as HTMLDivElement | null
    if (!tooltipEl) {
      tooltipEl = document.createElement('div')
      tooltipEl.className = 'graph-tooltip'
      Object.assign(tooltipEl.style, {
        position: 'absolute', pointerEvents: 'none', opacity: '0',
        padding: '8px 12px', borderRadius: '6px',
        backgroundColor: '#1a1a2e', border: `1px solid ${EMBRY.border}`,
        fontSize: '11px', fontFamily: 'monospace', color: EMBRY.white,
        whiteSpace: 'nowrap', zIndex: '10', transition: 'opacity 0.15s',
        boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
      })
      svg.parentElement?.appendChild(tooltipEl)
    }

    // Force simulation — strong repulsion to prevent clustering
    // R5: increased charge -800→-1200, collision 50→70 per Brandon/Rob center-cluster feedback
    const simulation = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink<SimNode, SimEdge>(simEdges).id((d) => d.id).distance(200))
      .force('charge', d3.forceManyBody().strength(-1200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(70))
      .force('x', d3.forceX(width / 2).strength(0.04))
      .force('y', d3.forceY(height / 2).strength(0.04))

    // --- Edges ---
    const edgeGroup = zoomG.append('g').attr('class', 'edges')

    // R5 Rob: helper to detect trust-boundary edges (clean→tainted/sorry transitions)
    const isTrustBoundary = (d: SimEdge) => {
      const src = simNodes.find(n => n.id === ((d.source as SimNode).id ?? d.source))
      const tgt = simNodes.find(n => n.id === ((d.target as SimNode).id ?? d.target))
      if (!src || !tgt) return false
      const srcClean = src.proofStatus === 'proved' && !src.sorryTainted
      const tgtTainted = tgt.proofStatus === 'sorry' || tgt.sorryTainted
      return srcClean && tgtTainted
    }

    const edgeLines = edgeGroup.selectAll('line')
      .data(simEdges)
      .join('line')
      .attr('stroke', (d) => {
        // R5: trust-boundary edges get distinct orange highlight
        if (isTrustBoundary(d)) return '#ff6b35'
        if (!d.validated) return EMBRY.red
        const srcNode = simNodes.find(n => n.id === ((d.source as SimNode).id ?? d.source))
        const tgtNode = simNodes.find(n => n.id === ((d.target as SimNode).id ?? d.target))
        const avgConf = ((srcNode?.confidence ?? 0.5) + (tgtNode?.confidence ?? 0.5)) / 2
        return avgConf > 0.7 ? EMBRY.green : avgConf > 0.4 ? EMBRY.amber : EMBRY.red
      })
      .attr('stroke-width', (d) => {
        // R5: trust-boundary edges are thicker
        if (isTrustBoundary(d)) return 3
        if (!d.validated) return 1
        const srcNode = simNodes.find(n => n.id === ((d.source as SimNode).id ?? d.source))
        const tgtNode = simNodes.find(n => n.id === ((d.target as SimNode).id ?? d.target))
        const avgConf = ((srcNode?.confidence ?? 0.5) + (tgtNode?.confidence ?? 0.5)) / 2
        return 1 + avgConf * 7
      })
      .attr('stroke-opacity', (d) => isTrustBoundary(d) ? 0.8 : d.validated ? 0.6 : 0.25)
      .attr('stroke-dasharray', (d) => d.validated ? 'none' : '4 3')
      .attr('marker-end', (d) => d.validated ? 'url(#arrow-valid)' : 'url(#arrow-invalid)')

    const edgeLabels = edgeGroup.selectAll('text')
      .data(simEdges)
      .join('text')
      .attr('fill', EMBRY.white)
      .attr('font-size', 9)
      .attr('font-weight', 700)
      .attr('text-anchor', 'middle')
      .attr('opacity', 0)
      .text((d) => d.method)

    // --- Nodes ---
    const nodeGroup = zoomG.append('g').attr('class', 'nodes')

    const nodeGs = nodeGroup.selectAll('g')
      .data(simNodes)
      .join('g')
      .style('cursor', 'pointer')
      .on('click', (_event, d) => {
        const original = nodes.find((n) => n.id === d.id)
        if (original && onNodeClick) onNodeClick(original)
      })
      .on('mouseenter', function (_event, d) {
        d3.select(this).select('.glow-ring')
          .transition().duration(150)
          .attr('stroke-opacity', 0.7).attr('stroke-width', 6).attr('r', nodeRadius + 8)
        d3.select(this).select('.node-circle')
          .transition().duration(150)
          .attr('stroke-width', 3)
          .attr('fill', () => `${EMBRY.fw[d.framework] ?? EMBRY.dim}33`)

        // Show connected edge labels, highlight connected edges
        edgeLabels.transition().duration(150).attr('opacity', (e) => {
          const src = (e.source as SimNode).id
          const tgt = (e.target as SimNode).id
          return (src === d.id || tgt === d.id) ? 1 : 0
        })
        edgeLines.transition().duration(150)
          .attr('stroke-opacity', (e) => {
            const src = (e.source as SimNode).id; const tgt = (e.target as SimNode).id
            return (src === d.id || tgt === d.id) ? 1 : 0.08
          })
          .attr('stroke-width', (e) => {
            const src = (e.source as SimNode).id; const tgt = (e.target as SimNode).id
            return (src === d.id || tgt === d.id) ? 2.5 : (e.validated ? 1.5 : 1)
          })

        // Dim unconnected nodes
        nodeGs.transition().duration(150).attr('opacity', (n) => {
          if (n.id === d.id) return 1
          const connected = simEdges.some((e) => {
            const src = (e.source as SimNode).id ?? e.source
            const tgt = (e.target as SimNode).id ?? e.target
            return (src === d.id && tgt === n.id) || (tgt === d.id && src === n.id)
          })
          return connected ? 1 : 0.2
        })

        // Tooltip
        if (tooltipEl) {
          const fwColor = EMBRY.fw[d.framework] ?? EMBRY.dim
          const connEdges = simEdges.filter((e) => {
            const src = (e.source as SimNode).id; const tgt = (e.target as SimNode).id
            return src === d.id || tgt === d.id
          })
          const methods = [...new Set(connEdges.map((e) => e.method))].join(', ')
          const pColor = d.sorryTainted ? EMBRY.amber : proofColor(d.proofStatus)
          const pLabel = d.proofStatus === 'sorry' ? 'SORRY (unproved)'
            : d.sorryTainted ? `${d.proofStatus.toUpperCase()} (sorry-tainted)`
            : d.proofStatus.toUpperCase()
          tooltipEl.innerHTML = [
            `<div style="margin-bottom:4px"><span style="color:${fwColor};font-weight:900;font-size:13px">${d.id}</span> <span style="color:${EMBRY.dim};font-size:10px">${d.framework}</span></div>`,
            `<div style="color:${EMBRY.white};margin-bottom:3px">${d.label}</div>`,
            `<div style="display:flex;gap:8px;margin-bottom:3px">`,
            `<span style="color:${pColor};font-size:10px;font-weight:700">${proofIcon(d.proofStatus)} ${pLabel}</span>`,
            d.confidence > 0 ? `<span style="color:${EMBRY.dim};font-size:10px">${(d.confidence * 100).toFixed(0)}% confidence</span>` : '',
            `</div>`,
            d.sorryTainted ? `<div style="color:${EMBRY.amber};font-size:9px;margin-bottom:3px">⚠ Unsound: depends on sorry ancestor</div>` : '',
            `<div style="color:${EMBRY.dim};font-size:10px">${connEdges.length} edge${connEdges.length !== 1 ? 's' : ''}${methods ? ` · ${methods}` : ''}${d.sourceCount > 0 ? ` · ${d.sourceCount} sources` : ''}</div>`,
          ].join('')
          tooltipEl.style.opacity = '1'
          // Position relative to SVG container using getBoundingClientRect
          const svgRect = svg.getBoundingClientRect()
          const svgPoint = svg.createSVGPoint()
          svgPoint.x = d.x ?? 0; svgPoint.y = d.y ?? 0
          const ctm = zoomG.node()?.getScreenCTM()
          if (ctm) {
            const screenPt = svgPoint.matrixTransform(ctm)
            tooltipEl.style.left = `${screenPt.x - svgRect.left + nodeRadius + 8}px`
            tooltipEl.style.top = `${screenPt.y - svgRect.top - 20}px`
          }
        }
      })
      .on('mouseleave', function () {
        d3.select(this).select('.glow-ring')
          .transition().duration(200)
          .attr('stroke-opacity', 0.2).attr('stroke-width', 3).attr('r', nodeRadius + 4)
        d3.select(this).select('.node-circle')
          .transition().duration(200)
          .attr('stroke-width', 3.5)
          .attr('fill', (d) => nodeFill(d as SimNode))
        edgeLabels.transition().duration(200).attr('opacity', 0)
        edgeLines.transition().duration(200)
          .attr('stroke-opacity', (d) => d.validated ? 0.5 : 0.25)
          .attr('stroke-width', (d) => d.validated ? 1.5 : 1)
        nodeGs.transition().duration(200).attr('opacity', 1)
        if (tooltipEl) tooltipEl.style.opacity = '0'
      })

    // Proof status colors (Rob Armstrong requirements)
    // In critical-path mode, everything is red/amber — these are failing chains
    const proofColor = (status: string) => {
      if (mode === 'critical-path') {
        return status === 'sorry' ? EMBRY.red : EMBRY.amber
      }
      switch (status) {
        case 'proved': return EMBRY.green
        case 'sorry': return EMBRY.red
        case 'axiom': return EMBRY.blue
        default: return EMBRY.amber // partial
      }
    }

    const proofIcon = (status: string) => {
      switch (status) {
        case 'proved': return '✓'
        case 'sorry': return '⚠'  // Rob: flag unproved subgoals
        case 'axiom': return '∎'
        default: return '◐'       // partial
      }
    }

    // Confidence arc (Brandon Bailey: fidelity scoring)
    const arc = d3.arc<SimNode>()
    nodeGs.append('path')
      .attr('class', 'confidence-arc')
      .attr('d', (d) => {
        const endAngle = d.confidence * Math.PI * 2
        return arc({
          innerRadius: nodeRadius + 5,
          outerRadius: nodeRadius + 8,
          startAngle: 0,
          endAngle,
        } as d3.DefaultArcObject, d)
      })
      .attr('fill', (d) => proofColor(d.proofStatus))
      .attr('opacity', 1.0)
      .attr('stroke', (d) => proofColor(d.proofStatus))
      .attr('stroke-width', 1)

    // Glow ring — color based on proof status, not just framework
    nodeGs.append('circle')
      .attr('class', 'glow-ring')
      .attr('r', nodeRadius + 4)
      .attr('fill', 'none')
      .attr('stroke', (d) => proofColor(d.proofStatus))
      .attr('stroke-opacity', 0.35)
      .attr('stroke-width', 5)
      .attr('stroke-dasharray', (d) => d.proofStatus === 'sorry' ? '4 3' : 'none')

    // Rob Armstrong: sorry nodes get pulsing red halo
    nodeGs.filter((d) => d.proofStatus === 'sorry')
      .append('circle')
      .attr('class', 'sorry-halo')
      .attr('r', nodeRadius + 12)
      .attr('fill', 'none')
      .attr('stroke', '#dc2626')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.3)

    // R4 Rob: sorry-tainted nodes get amber pulsing halo + hatch overlay
    nodeGs.filter((d) => d.sorryTainted)
      .append('circle')
      .attr('class', 'taint-halo')
      .attr('r', nodeRadius + 10)
      .attr('fill', 'none')
      .attr('stroke', EMBRY.amber)
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '3 2')
      .attr('stroke-opacity', 0.25)

    // R5: Node fill encodes proof status. Tainted uses distinct orange-red (#e85200)
    // In critical-path mode, nodes are red (failing) or amber (inconclusive)
    const nodeFill = (d: SimNode) => {
      if (mode === 'critical-path') {
        return d.confidence < 0.3 ? `${EMBRY.red}22` : `${EMBRY.amber}18`
      }
      if (d.proofStatus === 'sorry') return '#dc262622'
      if (d.sorryTainted) return '#e8520015' // R5: distinct orange-red, not amber
      if (d.proofStatus === 'proved') return `${EMBRY.green}18`
      if (d.proofStatus === 'axiom') return `${EMBRY.blue}18`
      return `${EMBRY.amber}15` // incomplete (partial)
    }

    nodeGs.append('circle')
      .attr('class', 'node-circle')
      .attr('r', nodeRadius)
      .attr('fill', (d) => nodeFill(d))
      .attr('stroke', (d) => EMBRY.fw[d.framework] ?? EMBRY.dim)
      .attr('stroke-width', 3.5)

    // R4 Rob: hatch overlay on sorry-tainted nodes (shows contamination clearly)
    nodeGs.filter((d) => d.sorryTainted)
      .append('circle')
      .attr('r', nodeRadius - 1)
      .attr('fill', 'url(#sorry-hatch)')
      .attr('stroke', 'none')
      .attr('pointer-events', 'none')

    // Proof status icon (top-right corner)
    nodeGs.append('text')
      .attr('class', 'proof-icon')
      .attr('x', nodeRadius - 4)
      .attr('y', -nodeRadius + 6)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', (d) => proofColor(d.proofStatus))
      .attr('font-size', 10)
      .attr('font-weight', 900)
      .text((d) => proofIcon(d.proofStatus))

    // Source count badge (bottom-left, Brandon: source traceability)
    // R3: push badge further outward to avoid confidence arc overlap
    // R3: zero-source nodes get hollow "?" badge as distinct warning signal
    const badgeCx = -(nodeRadius + 4)
    const badgeCy = nodeRadius + 2

    // Zero-source badge (Brandon R2: "zero-source node is a red flag")
    nodeGs.filter((d) => d.sourceCount === 0)
      .append('circle')
      .attr('cx', badgeCx)
      .attr('cy', badgeCy)
      .attr('r', 9)
      .attr('fill', 'none')
      .attr('stroke', EMBRY.amber)
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '3 2')

    nodeGs.filter((d) => d.sourceCount === 0)
      .append('text')
      .attr('x', badgeCx)
      .attr('y', badgeCy + 1)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', EMBRY.amber)
      .attr('font-size', 9)
      .attr('font-weight', 900)
      .attr('font-family', 'monospace')
      .text('?')

    // Positive source count badge
    nodeGs.filter((d) => d.sourceCount > 0)
      .append('circle')
      .attr('cx', badgeCx)
      .attr('cy', badgeCy)
      .attr('r', 9)
      .attr('fill', '#1e40af')
      .attr('stroke', '#3b82f6')
      .attr('stroke-width', 1.5)

    nodeGs.filter((d) => d.sourceCount > 0)
      .append('text')
      .attr('x', badgeCx)
      .attr('y', badgeCy + 1)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', EMBRY.white)
      .attr('font-size', 7)
      .attr('font-weight', 900)
      .attr('font-family', 'monospace')
      .text((d) => d.sourceCount)

    // Node ID (readable)
    nodeGs.append('text')
      .attr('dy', 1)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central')
      .attr('fill', EMBRY.white)
      .attr('font-size', 13)
      .attr('font-weight', 700)
      .attr('font-family', 'monospace')
      .style('paint-order', 'stroke fill')
      .attr('stroke', EMBRY.bgDeep)
      .attr('stroke-width', 3)
      .text((d) => d.id)

    // Node label below circle
    nodeGs.append('text')
      .attr('dy', nodeRadius + 13)
      .attr('text-anchor', 'middle')
      .attr('fill', EMBRY.white)
      .attr('font-size', 10)
      .attr('font-weight', 600)
      .style('paint-order', 'stroke fill')
      .attr('stroke', EMBRY.bgDeep)
      .attr('stroke-width', 3)
      .text((d) => d.label.length > 20 ? `${d.label.slice(0, 20)}…` : d.label)

    // Drag (works with zoom)
    const drag = d3.drag<SVGGElement, SimNode>()
      .on('start', (event, d) => {
        if (!event.active) simulation.alphaTarget(0.3).restart()
        d.fx = d.x; d.fy = d.y
      })
      .on('drag', (event, d) => {
        d.fx = event.x; d.fy = event.y
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0)
        d.fx = null; d.fy = null
      })

    nodeGs.call(drag)

    // Tick
    simulation.on('tick', () => {
      edgeLines
        .attr('x1', (d) => (d.source as SimNode).x!)
        .attr('y1', (d) => (d.source as SimNode).y!)
        .attr('x2', (d) => (d.target as SimNode).x!)
        .attr('y2', (d) => (d.target as SimNode).y!)
      edgeLabels
        .attr('x', (d) => ((d.source as SimNode).x! + (d.target as SimNode).x!) / 2)
        .attr('y', (d) => ((d.source as SimNode).y! + (d.target as SimNode).y!) / 2 - 6)
      nodeGs.attr('transform', (d) => `translate(${d.x},${d.y})`)
    })

    return () => {
      simulation.stop()
      if (tooltipEl) tooltipEl.style.opacity = '0'
    }
  }, [filteredNodes, filteredEdges, dimensions, onNodeClick, nodes])

  useEffect(() => {
    return setupSimulation()
  }, [setupSimulation])

  // Observe container size
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const container = svg.parentElement
    if (!container) return
    const observer = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect
      if (width > 0) setDimensions({ width, height: Math.max(350, width * 0.65) })
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const validatedCount = filteredEdges.filter((e) => e.validated).length
  const unvalidatedCount = filteredEdges.filter((e) => !e.validated).length
  // Rob Armstrong: proof completeness counts
  const provedCount = filteredNodes.filter((n) => n.proofStatus === 'proved').length
  const sorryCount = filteredNodes.filter((n) => n.proofStatus === 'sorry').length
  const axiomCount = filteredNodes.filter((n) => n.proofStatus === 'axiom').length
  const partialCount = filteredNodes.filter((n) => !n.proofStatus || n.proofStatus === 'partial').length
  // R4 Rob: count sorry-tainted nodes (proved locally but upstream sorry)
  // Compute here for display — mirrors the BFS in setupSimulation
  const taintedCount = (() => {
    const fwdAdj = new Map<string, string[]>()
    for (const e of filteredEdges) {
      const t = fwdAdj.get(e.source) ?? []
      t.push(e.target)
      fwdAdj.set(e.source, t)
    }
    const sorrySet = new Set(filteredNodes.filter(n => n.proofStatus === 'sorry').map(n => n.id))
    const tainted = new Set<string>()
    const q = [...sorrySet]
    while (q.length > 0) {
      const cur = q.shift()!
      for (const next of fwdAdj.get(cur) ?? []) {
        if (!tainted.has(next) && !sorrySet.has(next)) { tainted.add(next); q.push(next) }
      }
    }
    return tainted.size
  })()
  // Brandon Bailey: average source confidence
  const nodesWithConf = filteredNodes.filter((n) => n.confidence != null && n.confidence > 0)
  const avgConfidence = nodesWithConf.length > 0
    ? nodesWithConf.reduce((sum, n) => sum + (n.confidence ?? 0), 0) / nodesWithConf.length
    : 0

  return (
    <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: `1px solid ${EMBRY.border}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <div style={heading}>Lemma Proof Graph</div>
          <div style={{ ...label, marginTop: 2 }}>
            {filteredNodes.length} lemmas · {filteredEdges.length} edges
            {avgConfidence > 0 && (
              <span style={{ color: avgConfidence > 0.7 ? EMBRY.green : EMBRY.amber, marginLeft: 6 }}>
                {(avgConfidence * 100).toFixed(0)}% avg confidence
              </span>
            )}
            {activeFrameworks.size > 0 && (
              <span style={{ color: EMBRY.accent, marginLeft: 6 }}>
                (filtered)
              </span>
            )}
          </div>
        </div>

        {/* Clickable framework filter legend */}
        <div style={{ display: 'flex', gap: 6 }}>
          {allFrameworks.map((fw) => {
            const color = EMBRY.fw[fw] ?? EMBRY.dim
            const isActive = activeFrameworks.size === 0 || activeFrameworks.has(fw)
            return (
              <button
                key={fw}
                onClick={() => toggleFramework(fw)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '3px 8px', borderRadius: 4, cursor: 'pointer',
                  border: `1px solid ${isActive ? color : EMBRY.border}`,
                  backgroundColor: isActive ? `${color}18` : 'transparent',
                  opacity: isActive ? 1 : 0.4,
                  transition: 'all 0.15s',
                }}
              >
                <div style={glowDot(color, 6)} />
                <span style={{ fontSize: 9, color: isActive ? color : EMBRY.dim, fontWeight: 700 }}>{fw}</span>
              </button>
            )
          })}
          {activeFrameworks.size > 0 && (
            <button
              onClick={() => setActiveFrameworks(new Set())}
              style={{
                fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
                cursor: 'pointer', border: `1px solid ${EMBRY.border}`,
                backgroundColor: 'transparent', color: EMBRY.dim,
              }}
            >
              ALL
            </button>
          )}
        </div>
      </div>

      {/* R4 Rob: Proof status legend — primary visual channel explanation */}
      <div style={{
        padding: '4px 16px',
        borderBottom: `1px solid ${EMBRY.border}`,
        display: 'flex',
        gap: 12,
        fontSize: 9,
        alignItems: 'center',
        color: EMBRY.dim,
      }}>
        <span style={{ fontWeight: 700, color: EMBRY.white, marginRight: 4 }}>Proof:</span>
        <span style={{ color: EMBRY.green }}>● proved</span>
        <span style={{ color: EMBRY.red }}>● sorry</span>
        <span style={{ color: EMBRY.amber }}>● incomplete</span>
        <span style={{ color: EMBRY.blue }}>● axiom</span>
        <span style={{ color: '#e85200', borderBottom: '1px dashed #e85200' }}>◧ tainted</span>
        <span style={{ marginLeft: 'auto', fontWeight: 700, color: EMBRY.white }}>Edges:</span>
        <span style={{ color: EMBRY.green }}>— validated</span>
        <span style={{ color: EMBRY.red }}>┄ unvalidated</span>
        <span style={{ color: '#ff6b35' }}>━ trust boundary</span>
      </div>

      {/* D3 Force Graph */}
      <div style={{ backgroundColor: EMBRY.bgDeep, position: 'relative', overflow: 'hidden' }}>
        <svg
          ref={svgRef}
          style={{ width: '100%', height: 'auto', display: 'block' }}
        />
        {/* Zoom hint */}
        <div style={{
          position: 'absolute', bottom: 6, right: 10,
          fontSize: 9, color: EMBRY.muted,
          pointerEvents: 'none',
        }}>
          scroll to zoom · drag to pan · dbl-click to reset
        </div>
      </div>

      {/* Stats bar — proof completeness (Rob) + edge validation + confidence (Brandon) */}
      <div style={{
        padding: '8px 16px',
        borderTop: `1px solid ${EMBRY.border}`,
        display: 'flex',
        gap: 12,
        fontSize: 10,
        flexWrap: 'wrap',
      }}>
        {/* Proof status counts (Rob Armstrong) */}
        {provedCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: EMBRY.green, fontWeight: 900 }}>✓</span>
            <span style={{ color: EMBRY.dim }}>{provedCount} proved</span>
          </div>
        )}
        {sorryCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: EMBRY.red, fontWeight: 900 }}>⚠</span>
            <span style={{ color: EMBRY.red }}>{sorryCount} sorry</span>
          </div>
        )}
        {taintedCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: EMBRY.amber, fontWeight: 900 }}>⚠</span>
            <span style={{ color: EMBRY.amber }}>{taintedCount} tainted</span>
          </div>
        )}
        {axiomCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: EMBRY.blue, fontWeight: 900 }}>∎</span>
            <span style={{ color: EMBRY.dim }}>{axiomCount} axiom</span>
          </div>
        )}
        {partialCount > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: EMBRY.amber, fontWeight: 900 }}>◐</span>
            <span style={{ color: EMBRY.dim }}>{partialCount} incomplete</span>
          </div>
        )}
        {/* Separator */}
        <div style={{ width: 1, height: 12, backgroundColor: EMBRY.border, alignSelf: 'center' }} />
        {/* Edge validation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={glowDot(EMBRY.green, 5)} />
          <span style={{ color: EMBRY.dim }}>{validatedCount} validated</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={glowDot(EMBRY.red, 5)} />
          <span style={{ color: EMBRY.dim }}>{unvalidatedCount} unvalidated</span>
        </div>
      </div>
    </div>
  )
}

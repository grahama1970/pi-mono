/**
 * BinaryGraph — D3 force-directed graph for Binary Explorer.
 *
 * Click-to-reveal: edges hidden by default, shown for clicked node (max 10).
 * Hover: tooltip only. Color by node type.
 */
import React, { useRef, useEffect, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { EMBRY } from '../common/EmbryStyle'
import type { BinaryGraphNode, BinaryGraphEdge } from '../../hooks/useBinaryData'
import { NODE_TYPE_COLORS } from '../../hooks/useBinaryData'

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
  /** SPARTA mind tags + taxonomy per node — drives tag dots and coloring on graph */
  taxonomyMap?: Map<string, { mind: string[]; cwe: string[]; attack: string[]; d3fend: string[]; nist: string[] }>
  /** Active node type filters — when non-empty, only these types are shown */
  activeTypeFilters?: Set<string>
  /** Toggle a node type in the filter set */
  onToggleTypeFilter?: (type: string) => void
}

interface SimNode extends d3.SimulationNodeDatum {
  id: string; label: string; nodeType: string; cluster: string
  tier: string; confidence: number; description?: string
}

interface SimEdge extends d3.SimulationLinkDatum<SimNode> {
  edgeType: string; sharedField?: string
}

const EDGE_COLORS: Record<string, string> = {
  contains: '#64748b', payload: '#2196F3', emits: '#FF9800',
  triggers: '#4CAF50', has_parameter: '#9C27B0',
}

// Gemini R3: edge thickness by semantic weight (bumped 1.5x for clarity)
const EDGE_WIDTHS: Record<string, number> = {
  contains: 1.2, payload: 2.0, emits: 2.4,
  triggers: 3.0, has_parameter: 1.5,
}

// Shape path generators: each centered at origin, radius r.
// event→diamond, schema→square, cli_command→triangle, all others→circle (bezier).
function nodeShapePath(type: string, radius: number): string {
  if (radius === 0) return 'M0,0'
  const r = radius
  if (type === 'event') {
    return `M0,${-r} L${r},0 L0,${r} L${-r},0 Z`
  }
  if (type === 'schema') {
    const s = r * 0.88
    return `M${-s},${-s} L${s},${-s} L${s},${s} L${-s},${s} Z`
  }
  if (type === 'cli_command') {
    return `M0,${-r} L${r * 0.93},${r * 0.6} L${-r * 0.93},${r * 0.6} Z`
  }
  // Cubic bezier circle approximation
  const k = r * 0.5523
  return `M0,${-r} C${k},${-r} ${r},${-k} ${r},0 C${r},${k} ${k},${r} 0,${r} C${-k},${r} ${-r},${k} ${-r},0 C${-r},${-k} ${-k},${-r} 0,${-r} Z`
}

// Gemini design spec: logarithmic size-by-degree with type overrides
function nodeRadius(type: string, deg = 0): number {
  const base = Math.min(14, 6 + Math.log10(deg + 1) * 3)
  switch (type) {
    case 'namespace': return Math.min(16, base + 2)
    case 'schema': return Math.min(12, base + 1)
    case 'state_machine': return Math.min(11, base + 1)
    case 'rpc': return base
    case 'cli_command': return base
    case 'event': return Math.max(5, base - 1)
    case 'parameter': return Math.max(4, base - 2)
    default: return base
  }
}

// Compute convex hull path from a set of points with padding
function hullPath(points: [number, number][], pad = 16): string {
  if (points.length < 3) {
    // For 1-2 points, draw a circle/ellipse around them
    const cx = points.reduce((s, p) => s + p[0], 0) / points.length
    const cy = points.reduce((s, p) => s + p[1], 0) / points.length
    return `M${cx - pad},${cy} A${pad},${pad} 0 1,1 ${cx + pad},${cy} A${pad},${pad} 0 1,1 ${cx - pad},${cy}Z`
  }
  const hull = d3.polygonHull(points)
  if (!hull) return ''
  // Pad the hull outward
  const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length
  const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length
  const padded = hull.map(([x, y]) => {
    const dx = x - cx, dy = y - cy
    const dist = Math.sqrt(dx * dx + dy * dy) || 1
    return [x + (dx / dist) * pad, y + (dy / dist) * pad] as [number, number]
  })
  return `M${padded.map(p => p.join(',')).join('L')}Z`
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function BinaryGraph({ nodes, edges, matchedNodeIds, visitedNodeIds, onNodeClick, onNodeHover, onContextMenu, layoutMode = 'organic', selectedNodeId = null, graphSvgRef, taxonomyMap, activeTypeFilters, onToggleTypeFilter }: BinaryGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null)
  const [activeLayout, setActiveLayout] = useState<'organic' | 'stratified' | 'clustered' | 'hierarchical'>(layoutMode)
  const clickedRef = useRef<string | null>(null)
  const onNodeClickRef = useRef(onNodeClick)
  onNodeClickRef.current = onNodeClick
  const onContextMenuRef = useRef(onContextMenu)
  onContextMenuRef.current = onContextMenu

  // Sync activeLayout when prop changes (external control still works)
  useEffect(() => { setActiveLayout(layoutMode) }, [layoutMode])

  // Sync external ref
  useEffect(() => { if (graphSvgRef) graphSvgRef.current = svgRef.current }, [graphSvgRef])

  // Stable references — only rebuild simulation when data actually changes
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const matchedRef = useRef(matchedNodeIds)
  nodesRef.current = nodes
  edgesRef.current = edges
  matchedRef.current = matchedNodeIds
  const taxonomyRef = useRef(taxonomyMap)
  taxonomyRef.current = taxonomyMap

  const hasFilter = matchedNodeIds && matchedNodeIds.size > 0
  const isMatched = (id: string) => !hasFilter || matchedNodeIds!.has(id)

  const selectedNodeIdRef = useRef(selectedNodeId)
  selectedNodeIdRef.current = selectedNodeId
  const visitedRef = useRef(visitedNodeIds)
  visitedRef.current = visitedNodeIds

  useEffect(() => {
    const svg = svgRef.current
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (svg && (svg as any).__applySelection) {
      // Only call if the node exists in the current simulation (prevents crash when
      // scene changes and simulation rebuilds in the same render cycle)
      if (!selectedNodeId || nodes.some(n => n.id === selectedNodeId)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(svg as any).__applySelection(selectedNodeId)
      }
    }
  }, [selectedNodeId, visitedNodeIds, nodes])

  // Re-color nodes when taxonomy data arrives (CWE-tagged nodes turn red)
  const taxonomySize = taxonomyMap?.size ?? 0
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !taxonomyMap || taxonomyMap.size === 0) return
    const d3svg = d3.select(svg)
    d3svg.selectAll<SVGPathElement, SimNode>('.node-shape')
      .attr('fill', (nd) => {
        const tax = taxonomyMap.get(nd.id)
        return (tax && (tax.cwe?.length > 0 || tax.attack?.length > 0)) ? '#ef4444' : (NODE_TYPE_COLORS[nd.nodeType] ?? EMBRY.dim)
      })
      .attr('fill-opacity', (nd) => {
        const tax = taxonomyMap.get(nd.id)
        return (tax && (tax.cwe?.length > 0 || tax.attack?.length > 0)) ? 0.9 : 0.7
      })
      .attr('stroke', (nd) => {
        const tax = taxonomyMap.get(nd.id)
        if (nd.id === selectedNodeIdRef.current) return EMBRY.white
        return (tax && (tax.cwe?.length > 0 || tax.attack?.length > 0)) ? '#fca5a5' : (NODE_TYPE_COLORS[nd.nodeType] ?? EMBRY.dim)
      })
      .attr('stroke-width', (nd) => {
        const tax = taxonomyMap.get(nd.id)
        if (nd.id === selectedNodeIdRef.current) return 2.5
        return (tax && (tax.cwe?.length > 0 || tax.attack?.length > 0)) ? 2 : 1
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taxonomySize])

  // Rebuild when data shape OR taxonomy changes (CWE coloring needs fresh D3 setup)
  const dataKey = `${nodes.length}:${edges.length}:${taxonomySize}`

  const setupSimulation = useCallback(() => {
    const svg = svgRef.current
    const filteredNodes = nodesRef.current
    const filteredEdges = edgesRef.current
    if (!svg || filteredNodes.length === 0) return

    if (!dimensions) return // Wait for ResizeObserver to provide real dimensions
    const { width, height } = dimensions
    d3.select(svg).selectAll('*').remove()

    const root = d3.select(svg).attr('viewBox', `0 0 ${width} ${height}`)
    const bgRect = root.append('rect').attr('width', width).attr('height', height).attr('fill', EMBRY.bgDeep).style('cursor', 'grab')

    // SVG defs: animations + arrowhead markers
    const defs = root.append('defs')
    defs.html(`
      <style>
        @keyframes pulse-ring {
          0% { r: 14; opacity: 0.8; }
          50% { r: 22; opacity: 0.2; }
          100% { r: 14; opacity: 0.8; }
        }
        .pulse-ring { animation: pulse-ring 1.5s ease-in-out infinite; }
      </style>
    `)
    // Arrowhead markers for directional edges
    for (const [type, color] of Object.entries(EDGE_COLORS)) {
      if (type === 'contains') continue // structural = no arrow
      defs.append('marker')
        .attr('id', `arrow-${type}`)
        .attr('viewBox', '0 -3 6 6')
        .attr('refX', 6).attr('refY', 0)
        .attr('markerWidth', 4).attr('markerHeight', 4)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-3L6,0L0,3')
        .attr('fill', color)
        .attr('opacity', 0.6)
    }
    // Glow filter for selected nodes
    const glow = defs.append('filter').attr('id', 'node-glow')
      .attr('x', '-50%').attr('y', '-50%').attr('width', '200%').attr('height', '200%')
    glow.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur')
    glow.append('feFlood').attr('flood-color', EMBRY.accent).attr('flood-opacity', '0.4').attr('result', 'color')
    glow.append('feComposite').attr('in', 'color').attr('in2', 'blur').attr('operator', 'in').attr('result', 'glow')
    const glowMerge = glow.append('feMerge')
    glowMerge.append('feMergeNode').attr('in', 'glow')
    glowMerge.append('feMergeNode').attr('in', 'SourceGraphic')

    const zoomG = root.append('g').attr('class', 'zoom-container').attr('id', 'zoom-container-content')
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 5])
      .on('zoom', (event) => {
        const { transform } = event
        zoomG.attr('transform', transform)

        // Adjust label visibility based on zoom level
        const scale = transform.k
        const labelOpacity = scale > 1.5 ? Math.min(0.8, (scale - 1.5) * 2) : 0

        zoomG.selectAll<SVGTextElement, SimNode>('.node-label')
          .filter((d) => {
            return d.nodeType !== 'namespace' && clickedRef.current !== d.id
          })
          .attr('opacity', labelOpacity)

        // Update minimap viewport rectangle
        updateMinimapViewport(transform)
      })
    root.call(zoom)
    // dblclick.zoom is set after fitToGraph is defined (see below)

    // ── Minimap (D3-managed, updates on zoom + tick) ──
    const MM_W = 120, MM_H = 80, MM_PAD = 10
    const mmG = root.append('g').attr('class', 'minimap')
      .attr('transform', `translate(${width - MM_W - MM_PAD}, ${height - MM_H - MM_PAD})`)
    mmG.append('rect').attr('width', MM_W).attr('height', MM_H)
      .attr('fill', EMBRY.bgDeep).attr('stroke', EMBRY.muted).attr('stroke-width', 1).attr('rx', 2)
    const mmNodesG = mmG.append('g').attr('class', 'mm-nodes')
    const mmViewport = mmG.append('rect').attr('class', 'mm-viewport')
      .attr('fill', 'none').attr('stroke', EMBRY.accent).attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '3,2').attr('stroke-opacity', 0.6).attr('rx', 1)

    // Minimap state — updated by tick and zoom
    let mmScaleX = 1, mmScaleY = 1, mmOffX = 0, mmOffY = 0

    const updateMinimapNodes = (nodes: { x: number; y: number; nodeType: string }[]) => {
      if (nodes.length === 0) return
      const xs = nodes.map(n => n.x), ys = nodes.map(n => n.y)
      const xMin = Math.min(...xs) - 30, xMax = Math.max(...xs) + 30
      const yMin = Math.min(...ys) - 30, yMax = Math.max(...ys) + 30
      const gW = xMax - xMin || 1, gH = yMax - yMin || 1
      mmScaleX = MM_W / gW; mmScaleY = MM_H / gH
      const sc = Math.min(mmScaleX, mmScaleY)
      mmScaleX = sc; mmScaleY = sc
      mmOffX = (MM_W - gW * sc) / 2 - xMin * sc
      mmOffY = (MM_H - gH * sc) / 2 - yMin * sc

      const sel = mmNodesG.selectAll<SVGCircleElement, typeof nodes[0]>('circle').data(nodes)
      sel.join('circle')
        .attr('cx', d => d.x * mmScaleX + mmOffX)
        .attr('cy', d => d.y * mmScaleY + mmOffY)
        .attr('r', 1.5)
        .attr('fill', d => NODE_TYPE_COLORS[d.nodeType] ?? EMBRY.dim)
        .attr('opacity', 0.8)
    }

    const updateMinimapViewport = (transform: d3.ZoomTransform) => {
      // Map the visible viewport into minimap coordinates
      const vx = -transform.x / transform.k
      const vy = -transform.y / transform.k
      const vw = width / transform.k
      const vh = height / transform.k
      mmViewport
        .attr('x', vx * mmScaleX + mmOffX)
        .attr('y', vy * mmScaleY + mmOffY)
        .attr('width', vw * mmScaleX)
        .attr('height', vh * mmScaleY)
    }

    // Click minimap to pan main graph
    mmG.on('click', function (event) {
      const [mx, my] = d3.pointer(event)
      // Convert minimap coords to graph coords
      const gx = (mx - mmOffX) / mmScaleX
      const gy = (my - mmOffY) / mmScaleY
      const currentTransform = d3.zoomTransform(svg)
      d3.select(svg).transition().duration(300).call(
        zoom.transform,
        d3.zoomIdentity.translate(width / 2, height / 2).scale(currentTransform.k).translate(-gx, -gy)
      )
    })

    // ── Simulation data (deterministic initial positions via hash seeding) ──
    const hashStr = (s: string): number => {
      let h = 0
      for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0
      return h
    }
    const simNodes: SimNode[] = filteredNodes.map((n) => {
      const h1 = hashStr(n.id), h2 = hashStr(n.id + '_y')
      return {
        id: n.id, label: n.label, nodeType: n.nodeType, cluster: n.cluster,
        tier: n.tier, confidence: n.confidence, description: n.description,
        x: width / 2 + (h1 % 400) - 200,  // Seed within center ±200px
        y: height / 2 + (h2 % 400) - 200,
      }
    })
    const simEdges: SimEdge[] = filteredEdges
      .filter((e) => simNodes.some((n) => n.id === e.source) && simNodes.some((n) => n.id === e.target))
      .map((e) => ({ source: e.source, target: e.target, edgeType: e.edgeType, sharedField: e.sharedField }))

    // Precompute degree for hub detection + edge ranking
    const degree = new Map<string, number>()
    for (const e of simEdges) {
      const s = typeof e.source === 'string' ? e.source : (e.source as SimNode).id
      const t = typeof e.target === 'string' ? e.target : (e.target as SimNode).id
      degree.set(s, (degree.get(s) ?? 0) + 1)
      degree.set(t, (degree.get(t) ?? 0) + 1)
    }

    // ── Tooltip ──
    let tooltipEl = svg.parentElement?.querySelector('.graph-tooltip') as HTMLDivElement | null
    if (!tooltipEl) {
      tooltipEl = document.createElement('div')
      tooltipEl.className = 'graph-tooltip'
      Object.assign(tooltipEl.style, {
        position: 'absolute', pointerEvents: 'none', opacity: '0',
        padding: '8px 12px', borderRadius: '0',
        backgroundColor: '#1a1a2e', border: `1px solid ${EMBRY.border}`,
        fontSize: '11px', fontFamily: 'JetBrains Mono, monospace', color: EMBRY.white,
        whiteSpace: 'nowrap', zIndex: '10', transition: 'opacity 0.15s',
        boxShadow: '0 4px 20px rgba(0,0,0,0.6)', maxWidth: '300px',
      })
      svg.parentElement?.appendChild(tooltipEl)
    }

    // ── Force simulation (Gemini-tuned for Bloom-like spread) ──
    const padding = 40
    const area = width * height
    const chargeStrength = -Math.max(800, area / (simNodes.length * 1.2))

    // LOD thresholds: SVG without WebGL tops out around 200–300 nodes before the
    // frame budget is exhausted. Above these thresholds we trade layout quality for
    // responsiveness — faster decay, weaker/no collision, capped charge distance.
    const LARGE_GRAPH = simNodes.length > 200
    const HUGE_GRAPH  = simNodes.length > 400

    // Seed deterministic initial positions (circle layout) so graph is readable from first frame.
    // Without this, D3 uses Math.random() and graph looks different every render.
    const cx = width / 2, cy = height / 2
    simNodes.forEach((n, i) => {
      if (n.x === undefined || n.y === undefined) {
        const angle = (2 * Math.PI * i) / simNodes.length
        const radius = Math.min(width, height) * 0.35
        n.x = cx + radius * Math.cos(angle)
        n.y = cy + radius * Math.sin(angle)
      }
    })

    // Faster alpha decay for large graphs so the simulation converges and stops sooner.
    // Default 0.008 keeps ticking ~1200 frames; at N=500 that is ~5 s of jank.
    const alphaDecayVal = HUGE_GRAPH ? 0.04  : LARGE_GRAPH ? 0.02  : 0.008
    const alphaMinVal   = HUGE_GRAPH ? 0.002 : LARGE_GRAPH ? 0.001 : 0.0005

    const simulation = d3.forceSimulation(simNodes)
      .force('link', d3.forceLink<SimNode, SimEdge>(simEdges).id((d) => d.id).distance(150).strength(0.35))
      .force('charge', d3.forceManyBody().strength(chargeStrength).distanceMax(
        // Limit charge distance for huge graphs — Barnes-Hut still has to evaluate
        // distant clusters and at N>400 the per-tick cost is measurable.
        HUGE_GRAPH ? 400 : Math.max(width, height) * 1.5
      ))
      // Disable collision for huge graphs: forceCollide is O(N log N) per tick and
      // dominates frame time at N>400 with no perceptible benefit at that density.
      .force('collision', HUGE_GRAPH ? null : d3.forceCollide().radius((d) => {
        const n = d as SimNode; return nodeRadius(n.nodeType, degree.get(n.id) ?? 0) + 30
      }).strength(LARGE_GRAPH ? 0.5 : 0.9))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(0.08))
      .force('x', d3.forceX(width / 2).strength(0.05))
      .force('y', d3.forceY(height / 2).strength(0.05))
      .alpha(0.2)
      .alphaDecay(alphaDecayVal)
      .alphaMin(alphaMinVal)
      .alphaTarget(0)
      .velocityDecay(LARGE_GRAPH ? 0.6 : 0.55) // Higher decay = more stable, less jitter

    if (activeLayout === 'stratified') {
      const getY = (type: string) => {
        if (type === 'cli_command' || type === 'namespace') return height * 0.15
        if (type === 'rpc') return height * 0.35
        if (type === 'event') return height * 0.65
        if (type === 'state_machine' || type === 'parameter' || type === 'schema') return height * 0.85
        return height * 0.5
      }
      simulation
        .force('y', d3.forceY((d) => getY((d as SimNode).nodeType)).strength(0.12))
        .force('x', d3.forceX(width / 2).strength(0.02))
    } else if (activeLayout === 'clustered') {
      // Group nodes by namespace/cluster into spatial regions
      const clusters = [...new Set(simNodes.map(n => n.cluster))]
      const cols = Math.ceil(Math.sqrt(clusters.length))
      const clusterPos: Record<string, { x: number; y: number }> = {}
      clusters.forEach((c, i) => {
        const col = i % cols
        const row = Math.floor(i / cols)
        clusterPos[c] = {
          x: (col + 0.5) / cols * width,
          y: (row + 0.5) / Math.ceil(clusters.length / cols) * height,
        }
      })
      simulation
        .force('x', d3.forceX((d) => clusterPos[(d as SimNode).cluster]?.x ?? width / 2).strength(0.15))
        .force('y', d3.forceY((d) => clusterPos[(d as SimNode).cluster]?.y ?? height / 2).strength(0.15))
    } else if (activeLayout === 'hierarchical') {
      // DAG rank assignment for call/data-flow graphs (Sugiyama-style, simplified).
      // Assigns ranks via BFS from zero-in-degree roots so callers appear above callees.
      // Fixed fx/fy positions prevent simulation drift — layout is stable by construction.
      const adjOut = new Map<string, string[]>()
      const inDeg = new Map<string, number>()
      for (const n of simNodes) { adjOut.set(n.id, []); inDeg.set(n.id, 0) }
      for (const e of simEdges) {
        const s = typeof e.source === 'string' ? e.source : (e.source as SimNode).id
        const t = typeof e.target === 'string' ? e.target : (e.target as SimNode).id
        adjOut.get(s)?.push(t)
        inDeg.set(t, (inDeg.get(t) ?? 0) + 1)
      }
      const rank = new Map<string, number>()
      const bfsQueue: string[] = []
      for (const n of simNodes) {
        if ((inDeg.get(n.id) ?? 0) === 0) { rank.set(n.id, 0); bfsQueue.push(n.id) }
      }
      // Fallback for fully cyclic graphs: treat all nodes as rank 0 roots
      if (bfsQueue.length === 0) simNodes.forEach(n => { rank.set(n.id, 0); bfsQueue.push(n.id) })
      let bqi = 0
      while (bqi < bfsQueue.length) {
        const cur = bfsQueue[bqi++]
        const r = rank.get(cur) ?? 0
        for (const t of (adjOut.get(cur) ?? [])) {
          if (!rank.has(t) || rank.get(t)! < r + 1) {
            rank.set(t, r + 1)
            bfsQueue.push(t)
          }
        }
      }
      // Unranked nodes (disconnected) go at rank 0
      let maxRank = 0
      for (const n of simNodes) {
        if (!rank.has(n.id)) rank.set(n.id, 0)
        const r = rank.get(n.id)!
        if (r > maxRank) maxRank = r
      }
      // Group by rank, sort within rank by degree (hubs centred — reduces visual crossings)
      const rankGroups = new Map<number, SimNode[]>()
      for (const n of simNodes) {
        const r = rank.get(n.id) ?? 0
        if (!rankGroups.has(r)) rankGroups.set(r, [])
        rankGroups.get(r)!.push(n)
      }
      // Barycenter heuristic: sort within each rank by avg neighbor index in previous rank.
      // Top-down pass minimizes edge crossings vs degree-only sort.
      const rankOrder: Record<string, number> = {}
      for (const [, ns] of [...rankGroups.entries()].sort(([a], [b]) => a - b)) {
        ns.sort((a, b) => {
          const getBC = (n: SimNode) => {
            const indices: number[] = []
            for (const e of simEdges) {
              const s = typeof e.source === 'string' ? e.source : (e.source as SimNode).id
              const t = typeof e.target === 'string' ? e.target : (e.target as SimNode).id
              const other = s === n.id ? t : t === n.id ? s : null
              if (other !== null && rankOrder[other] !== undefined) indices.push(rankOrder[other])
            }
            return indices.length ? indices.reduce((acc, v) => acc + v, 0) / indices.length : -(degree.get(n.id) ?? 0)
          }
          return getBC(a) - getBC(b)
        })
        ns.forEach((n, i) => { rankOrder[n.id] = i })
      }
      // Assign fixed positions: callers at top, callees at bottom
      const vPad = 60
      const rankSpacing = Math.min(130, (height - vPad * 2) / Math.max(maxRank, 1))
      for (const [r, ns] of rankGroups) {
        const y = vPad + r * rankSpacing
        const xStep = (width - padding * 2) / (ns.length + 1)
        ns.forEach((n, i) => {
          n.fx = padding + (i + 1) * xStep
          n.fy = y
          n.x = n.fx
          n.y = n.fy
        })
      }
    }

    // --- Pre-warm the simulation (CRITICAL for preventing violent jitter) ---
    // Run ticks synchronously before any DOM rendering to seed positions.
    // 500 ticks × O(N log N) per tick ≈ 1.4 M ops at N=400 — blocks the main thread
    // for several hundred ms. Scale down for large graphs: fewer ticks, but the
    // faster alphaDecay above means the live simulation converges just as quickly.
    const preWarmTicks = HUGE_GRAPH ? 50 : LARGE_GRAPH ? 150 : 500
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const savedAlpha = simulation.alpha()
    simulation.alpha(0.8) // Temporarily high energy for pre-warm
    for (let i = 0; i < preWarmTicks; ++i) simulation.tick()
    // After pre-warm: set alpha just above alphaMin so simulation runs ~10 more
    // ticks for final adjustment then stops. This makes the layout deterministic —
    // the same data always produces the same node positions regardless of when
    // the screenshot is captured.
    simulation.alpha(alphaMinVal * 2)

    // ── Node radius function (defined early so event handlers can capture it) ──
    const r = (d: SimNode) => {
      const base = nodeRadius(d.nodeType, degree.get(d.id) ?? 0)
      const tax = taxonomyRef.current?.get(d.id)
      return (tax && (tax.cwe?.length > 0 || tax.attack?.length > 0)) ? base * 1.3 : base
    }
    const nodeImportance = (d: SimNode): number => {
      const deg = degree.get(d.id) ?? 0
      if (d.nodeType === 'namespace') return 1.0
      if (deg > 20) return 1.0
      if (deg > 10) return 0.85
      if (deg > 5) return 0.6
      return 0.4
    }

    // ── Grouping Hulls (behind edges and nodes) ──
    const hullGroup = zoomG.append('g').attr('class', 'hulls')
    const clusterGroups = new Map<string, SimNode[]>()
    for (const n of simNodes) {
      const key = n.cluster || 'unknown'
      if (!clusterGroups.has(key)) clusterGroups.set(key, [])
      clusterGroups.get(key)!.push(n)
    }
    // Only draw hulls for clusters with 4+ nodes (avoids noise on small groups)
    const hullData = [...clusterGroups.entries()].filter(([, ns]) => ns.length >= 4)
    const hullPaths = hullGroup.selectAll('path')
      .data(hullData, ([k]) => k).join('path')
      .attr('fill', 'none') // No fill — just outline, avoids purple wash
      .attr('stroke', EMBRY.accent)
      .attr('stroke-opacity', 0.25)
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '6,3')
      .attr('d', ([, ns]) => hullPath(ns.map(n => [n.x!, n.y!] as [number, number]), 12))
    // Hull labels
    hullGroup.selectAll('text')
      .data(hullData, ([k]) => k).join('text')
      .attr('class', 'hull-label')
      .attr('text-anchor', 'middle')
      .attr('fill', EMBRY.white)
      .attr('font-size', 10)
      .attr('font-weight', 700)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('opacity', 0.75)
      .style('paint-order', 'stroke fill')
      .attr('stroke', EMBRY.bgDeep)
      .attr('stroke-width', 3)
      .attr('x', ([, ns]) => ns.reduce((s, n) => s + (n.x ?? 0), 0) / ns.length)
      .attr('y', ([, ns]) => ns.reduce((s, n) => s + (n.y ?? 0), 0) / ns.length)
      .text(([k]) => k)

    // ── Edges (paths for curvature + arrowheads, hidden by default) ──
    const edgeGroup = zoomG.append('g').attr('class', 'edges')
    const edgeLines = edgeGroup.selectAll('path')
      .data(simEdges).join('path')
      .attr('fill', 'none')
      .attr('stroke', (d) => EDGE_COLORS[d.edgeType] ?? EMBRY.dim)
      .attr('stroke-width', (d) => (EDGE_WIDTHS[d.edgeType] ?? 1.0) * 0.4)
      .attr('stroke-opacity', 0.15)
      .attr('marker-end', (d) => d.edgeType !== 'contains' ? `url(#arrow-${d.edgeType})` : null)

    // ── Edge Labels (hidden by default, shown on node select) ──
    const edgeLabelGroup = zoomG.append('g').attr('class', 'edge-labels')
    const edgeLabels = edgeLabelGroup.selectAll('text')
      .data(simEdges).join('text')
      .attr('font-size', 7)
      .attr('font-family', 'JetBrains Mono, monospace')
      .attr('fill', (d) => EDGE_COLORS[d.edgeType] ?? EMBRY.dim)
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('opacity', 0)
      .attr('pointer-events', 'none')
      .text((d) => d.edgeType.replace(/_/g, ' '))

    // ── Nodes ──
    const nodeGroup = zoomG.append('g').attr('class', 'nodes')
      .attr('role', 'list')
      .attr('aria-label', `Graph nodes: ${simNodes.length} features`)
    const nodeGs = nodeGroup.selectAll('g')
      .data(simNodes).join('g')
      .style('cursor', 'pointer')
      .attr('opacity', (d) => isMatched(d.id) ? 1 : 0.12)
      .attr('tabindex', 0)
      .attr('role', 'listitem')
      .attr('aria-label', (d) => `${d.label} (${d.nodeType}, ${degree.get(d.id) ?? 0} connections)`)
      .on('focus', function () { d3.select(this).select('.node-shape').attr('stroke', '#fff').attr('stroke-width', 2.5).attr('stroke-opacity', 1) })
      .on('blur', function () { d3.select(this).select('.node-shape').attr('stroke', 'none').attr('stroke-width', 0) })

    // ── Auto-Fit Camera ──
    const fitToGraph = () => {
      const xExt = d3.extent(simNodes, d => d.x!) as [number, number]
      const yExt = d3.extent(simNodes, d => d.y!) as [number, number]
      if (xExt[0] === undefined || yExt[0] === undefined) return

      const gWidth = xExt[1] - xExt[0]
      const gHeight = yExt[1] - yExt[0]
      if (gWidth === 0 || gHeight === 0) return

      const paddedWidth = gWidth + 80
      const paddedHeight = gHeight + 80

      const fitScale = Math.min(width / paddedWidth, height / paddedHeight)
      const targetScale = Math.max(fitScale, 0.6) // Allow more zoom out for large graphs
      const gCX = (xExt[0] + xExt[1]) / 2
      const gCY = (yExt[0] + yExt[1]) / 2

      d3.select(svg).transition().duration(750)
        .call(zoom.transform, d3.zoomIdentity.translate(width / 2, height / 2).scale(targetScale).translate(-gCX, -gCY))
    }

    // Double-click to fit graph to viewport (not reset to origin)
    root.on('dblclick.zoom', () => fitToGraph())
    // Expose for keyboard shortcut
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(svg as any).__fitToGraph = fitToGraph

    // ── Imperative Selection Bridge ──
    const applySelection = (targetId: string | null) => {
      // Guard: if simulation was torn down (SVG cleared), bail
      if (!svg.querySelector('g.zoom-container')) return
      try { return _applySelection(targetId) } catch (e) { console.warn('applySelection error:', e) }
    }
    const _applySelection = (targetId: string | null) => {
      clickedRef.current = targetId
      const visited = visitedRef.current
      // Announce selection to screen readers
      const announceEl = document.getElementById('be-graph-announce')
      if (announceEl) {
        if (targetId) {
          const node = simNodes.find(n => n.id === targetId)
          const deg = degree.get(targetId) ?? 0
          announceEl.textContent = node ? `Selected ${node.label}, ${node.nodeType}, ${deg} connections` : ''
        } else {
          announceEl.textContent = 'Selection cleared'
        }
      }

      if (!targetId) {
        // Deselect: edges nearly invisible until a node is selected — prevents hairball
        edgeLines.transition().duration(200).attr('stroke-opacity', 0.15)
        edgeLabels.transition().duration(200).attr('opacity', 0)
        nodeGs.select('.node-shape').transition().duration(200)
          .attr('stroke', 'none').attr('stroke-width', 0)
        // Visited breadcrumb nodes keep a subtle ring even when deselected
        nodeGs.transition().duration(200).attr('opacity', (n) => isMatched(n.id) ? 1 : 0.12)
        nodeGs.select('.node-label').transition().duration(200)
          .attr('opacity', (n) => (n as SimNode).nodeType === 'namespace' ? 1 : 0)
        // Show visited trail rings
        if (visited && visited.size > 0) {
          nodeGs.select('.node-shape').transition().duration(200)
            .attr('stroke', (n) => visited.has((n as SimNode).id) ? EMBRY.accent : 'none')
            .attr('stroke-width', (n) => visited.has((n as SimNode).id) ? 1.5 : 0)
            .attr('stroke-opacity', (n) => visited.has((n as SimNode).id) ? 0.3 : 0)
        }
        return
      }

      // Find domain node
      const d = simNodes.find((n) => n.id === targetId)
      if (!d) return

      // Select: show 1-hop edges only, capped at 15 for visual clarity
      const shownEdges = new Set<SimEdge>()
      const connIds = new Set<string>([d.id])

      const hop1Edges = simEdges.filter((e) => {
        const s = (e.source as SimNode).id; const t = (e.target as SimNode).id
        return s === d.id || t === d.id
      })
      // Sort by edge type priority: triggers > emits > payload > has_parameter > contains
      const typePriority: Record<string, number> = { triggers: 0, emits: 1, payload: 2, has_parameter: 3, contains: 4 }
      hop1Edges.sort((a, b) => (typePriority[a.edgeType] ?? 5) - (typePriority[b.edgeType] ?? 5))
      hop1Edges.slice(0, 15).forEach(e => {
        shownEdges.add(e)
        connIds.add((e.source as SimNode).id)
        connIds.add((e.target as SimNode).id)
      })

      // Pure visual changes — NO physics restart, NO camera zoom.
      // Flush edge positions now (the tick loop skips path updates when no node is
      // selected, so edges may have stale 'd' attributes if the simulation moved
      // nodes after the last deselect).
      edgeLines.attr('d', (e) => {
        const sx = (e.source as SimNode).x!, sy = (e.source as SimNode).y!
        const tx = (e.target as SimNode).x!, ty = (e.target as SimNode).y!
        if (e.edgeType === 'contains') {
          const mx = (sx + tx) / 2, my = (sy + ty) / 2
          const dx2 = tx - sx, dy2 = ty - sy
          const len = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1
          const cx2 = mx + (-dy2 / len) * 18, cy2 = my + (dx2 / len) * 18
          return `M${sx},${sy} Q${cx2},${cy2} ${tx},${ty}`
        }
        return `M${sx},${sy} L${tx},${ty}`
      })
      edgeLines.transition().duration(200)
        .attr('stroke-opacity', (e) => shownEdges.has(e) ? 0.85 : 0)
        .attr('stroke-width', (e) => shownEdges.has(e) ? (EDGE_WIDTHS[e.edgeType] ?? 1.0) * 1.5 : 0)

      // Show edge labels for selected node's edges
      edgeLabels.transition().duration(200)
        .attr('opacity', (e) => shownEdges.has(e) ? 0.85 : 0)
      // Position labels at edge midpoint
      edgeLabels.attr('x', (e) => {
        const sx = (e.source as SimNode).x!, tx = (e.target as SimNode).x!
        return (sx + tx) / 2
      }).attr('y', (e) => {
        const sy = (e.source as SimNode).y!, ty = (e.target as SimNode).y!
        return (sy + ty) / 2 - 6
      })

      // Visual hierarchy: Target=100%, connected=70%, visited=50%, unrelated=dimmed
      // Gemini interaction model: dim unrelated to 30%, connected 70%, visited 50%
      // If no visible edges, don't over-dim (node is isolated in scene)
      const hasVisibleEdges = shownEdges.size > 0
      nodeGs.transition().duration(200)
        .attr('opacity', (n) => {
          if (n.id === targetId) return 1
          if (connIds.has(n.id)) return 0.70
          if (visited && visited.has(n.id)) return 0.50
          return hasVisibleEdges ? 0.30 : 0.70
        })

      nodeGs.select('.node-shape').transition().duration(200)
        .attr('stroke', (n) => {
          const id = (n as SimNode).id
          if (id === targetId) return EMBRY.white
          if (visited && visited.has(id)) return EMBRY.accent
          return 'none'
        })
        .attr('stroke-width', (n) => {
          const id = (n as SimNode).id
          if (id === targetId) return 3
          if (visited && visited.has(id)) return 1.5
          return 0
        })
        .attr('stroke-opacity', (n) => {
          const id = (n as SimNode).id
          if (id === targetId) return 1
          if (visited && visited.has(id)) return 0.4
          return 0
        })

      // Show labels on trace nodes + visited trail
      nodeGs.select('.node-label').transition().duration(200)
        .attr('opacity', (n) => {
          const id = (n as SimNode).id
          if (connIds.has(id)) return 1
          if (visited && visited.has(id)) return 0.7
          return 0
        })

      // Glow filter on selected node + pulsing ring
      nodeGs.select('.node-shape')
        .attr('filter', (n) => (n as SimNode).id === targetId ? 'url(#node-glow)' : 'none')
      nodeGs.select('.pulse-ring').remove()
      nodeGs.filter((n) => n.id === targetId)
        .append('circle')
        .attr('class', 'pulse-ring')
        .attr('r', (n) => r(n) + 6)
        .attr('fill', 'none')
        .attr('stroke', EMBRY.accent)
        .attr('stroke-width', 1.5)
        .attr('opacity', 0.8)
    }

    // Expose panToNode for external navigation (e.g., from relationship chips)
    // Allows optional scale for "zoom in" intents
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(svg as any).__panToNode = (nodeId: string, scale?: number) => {
      const target = simNodes.find((n) => n.id === nodeId)
      if (!target || target.x == null || target.y == null) return
      const currentTransform = d3.zoomTransform(svg)
      const targetScale = scale || currentTransform.k

      // Pan to center the target node at requested scale
      d3.select(svg).transition().duration(750).ease(d3.easeCubicInOut).call(
        zoom.transform,
        d3.zoomIdentity
          .translate(width / 2, height / 2)
          .scale(targetScale)
          .translate(-target.x, -target.y)
      )
    }

    // Expose for external control
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(svg as any).__applySelection = applySelection

    // Initial sync
    applySelection(selectedNodeIdRef.current)

    // Background click → deselect (clicking empty space clears selection)
    bgRect.on('click', () => {
      applySelection(null)
    })

    // Click → tell React it clicked (single-click only, not after drag)
    nodeGs.on('click', function (_event, d) {
      if (_wasDraggedRef.current) { _wasDraggedRef.current = false; return }
      if (onNodeClickRef.current) {
        const original = nodes.find((n) => n.id === d.id)
        if (original) onNodeClickRef.current(original)
      }
    })

    // Keyboard navigation — Enter to select, arrow keys to move between nodes
    nodeGs.on('keydown', function (event: KeyboardEvent, d) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const original = nodes.find((n) => n.id === d.id)
        if (original && onNodeClickRef.current) onNodeClickRef.current(original)
      } else if (event.key === 'Escape') {
        event.preventDefault()
        applySelection(null)
        // Return focus to SVG container
        svg.focus()
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault()
        const allGs = nodeGroup.selectAll<SVGGElement, SimNode>('g').nodes()
        const idx = allGs.indexOf(this as SVGGElement)
        const next = allGs[(idx + 1) % allGs.length]
        if (next) (next as HTMLElement).focus()
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault()
        const allGs = nodeGroup.selectAll<SVGGElement, SimNode>('g').nodes()
        const idx = allGs.indexOf(this as SVGGElement)
        const prev = allGs[(idx - 1 + allGs.length) % allGs.length]
        if (prev) (prev as HTMLElement).focus()
      }
    })

    // Double-click → zoom in and center on node (stop dblclick.zoom from firing on the svg)
    nodeGs.on('dblclick', function (event, d) {
      event.stopPropagation()
      const currentTransform = d3.zoomTransform(svg)
      const targetScale = Math.min(Math.max(currentTransform.k * 1.5, 2), 4)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(svg as any).__panToNode?.(d.id, targetScale)
    })

    // Right-click → context menu
    nodeGs.on('contextmenu', function (event, d) {
      event.preventDefault()
      event.stopPropagation()
      if (onContextMenuRef.current) {
        const original = nodes.find((n) => n.id === d.id)
        if (original) onContextMenuRef.current(original, event.clientX, event.clientY)
      }
    })

    // Hover → tooltip only
    nodeGs.on('mouseenter', function (_event, d) {
      d3.select(this).raise()
      const original = nodes.find((n) => n.id === d.id)
      if (onNodeHover && original) onNodeHover(original)

      // Restore floating tooltip IF zoomed out (best for quick scanning)
      const transform = d3.zoomTransform(svg)
      if (tooltipEl && transform.k <= 1.5) {
        const color = NODE_TYPE_COLORS[d.nodeType] ?? EMBRY.dim
        const deg = degree.get(d.id) ?? 0
        const top3 = simEdges
          .filter((e) => (e.source as SimNode).id === d.id || (e.target as SimNode).id === d.id)
          .slice(0, 3)
          .map((e) => {
            const other = (e.source as SimNode).id === d.id ? (e.target as SimNode) : (e.source as SimNode)
            return other.label.length > 20 ? other.label.slice(0, 18) + '…' : other.label
          })

        const tierLabel = d.tier === '0' ? 'Deterministic (Regex)' : d.tier === '1' ? 'Structural (AST)' : 'Inference (LLM)'
        const tierColor = d.tier === '0' ? '#4CAF50' : d.tier === '1' ? '#2196F3' : '#FF9800'

        tooltipEl.innerHTML = [
          `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
             <div style="font-weight:900;font-size:13px;color:${color}">${d.label}</div>
             <div style="font-size:8px;padding:1px 4px;border:1px solid ${tierColor};color:${tierColor};text-transform:uppercase">${d.tier ? 'T'+d.tier : '??'}</div>
           </div>`,
          `<div style="font-size:10px;color:${EMBRY.dim};margin:3px 0">${d.nodeType.replace('_', ' ')} · ${deg} connections</div>`,
          `<div style="font-size:9px;color:${tierColor};margin-bottom:6px;font-style:italic">${tierLabel} · ${Math.round((d.confidence ?? 0) * 100)}% confidence</div>`,
          top3.length > 0 ? `<div style="font-size:9px;color:${EMBRY.muted};margin-bottom:6px">${top3.join(', ')}</div>` : '',
          d.description ? `<div style="font-size:10px;color:${EMBRY.white};opacity:0.8;margin:6px 0;line-height:1.4;white-space:normal;max-width:240px">${d.description}</div>` : '',
          (() => { const mindTags = taxonomyRef.current?.get(d.id)?.mind ?? []; return mindTags.length > 0 ? `<div style="margin-top:6px;display:flex;gap:3px;flex-wrap:wrap">${mindTags.map(t => `<span style="font-size:7px;padding:1px 4px;border-radius:2px;background:#9C27B015;border:1px solid #9C27B044;color:#CE93D8">${t}</span>`).join('')}</div>` : '' })(),
          `<div style="font-size:8px;color:${EMBRY.accent};margin-top:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em">click to select · dbl-click to focus</div>`,
        ].join('')
        tooltipEl.style.opacity = '1'
        const svgRect = svg.getBoundingClientRect()
        const pt = svg.createSVGPoint()
        pt.x = d.x ?? 0; pt.y = d.y ?? 0
        const ctm = zoomG.node()?.getScreenCTM()
        if (ctm) {
          const sp = pt.matrixTransform(ctm)
          tooltipEl.style.left = `${sp.x - svgRect.left + 16}px`
          tooltipEl.style.top = `${sp.y - svgRect.top - 10}px`
        }
      }

      // Show label on hover (unless already showing from click)
      if (clickedRef.current !== d.id) {
        d3.select(this).select('.node-label').transition().duration(80).attr('opacity', 1)
      }

      // Hover ring — visible affordance that this node is clickable
      d3.select(this).select('.hover-ring').remove()
      d3.select(this).append('circle')
        .attr('class', 'hover-ring')
        .attr('r', nodeRadius(d.nodeType, degree.get(d.id) ?? 0) + 6)
        .attr('fill', 'none')
        .attr('stroke', EMBRY.white)
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.3)
        .attr('pointer-events', 'none')
    })
    .on('mouseleave', function (_event, d) {
      if (onNodeHover) onNodeHover(null)
      if (tooltipEl) tooltipEl.style.opacity = '0'
      // Hide label unless it's the clicked node or a namespace
      if (clickedRef.current !== d.id && d.nodeType !== 'namespace') {
        d3.select(this).select('.node-label').transition().duration(150).attr('opacity', 0)
      }
      d3.select(this).select('.hover-ring').remove()
    })

    // ── Node shapes: logarithmic size-by-degree with entrance animation ──
    // (r and nodeImportance defined earlier, before event handlers)

    // Tier badge colors
    const TIER_COLORS: Record<string, string> = { '0': '#00ff88', '1': '#4a9eff', '2': '#ffaa00' }

    // Invisible hit area — minimum 20px radius click target
    nodeGs.append('circle')
      .attr('class', 'hit-area')
      .attr('cx', 0).attr('cy', 0)
      .attr('r', (d) => Math.max(20, r(d) + 10))
      .attr('fill', 'transparent')
      .style('cursor', 'pointer')

    // Main node shape — path so each type gets a distinct visual shape (circle/diamond/square/triangle)
    // Nodes with CWE tags get a red-tinted fill for security visual triage
    const hasCwe = (id: string) => {
      const tax = taxonomyRef.current?.get(id)
      return tax && (tax.cwe?.length > 0 || tax.attack?.length > 0)
    }
    nodeGs.append('path')
      .attr('class', 'node-shape')
      .attr('d', 'M0,0') // start collapsed for entrance animation
      .attr('fill', (d) => hasCwe(d.id) ? '#ef4444' : (NODE_TYPE_COLORS[d.nodeType] ?? EMBRY.dim))
      .attr('fill-opacity', (d) => hasCwe(d.id) ? 0.9 : nodeImportance(d))
      .attr('stroke', (d) => d.id === selectedNodeIdRef.current ? EMBRY.white : hasCwe(d.id) ? '#fca5a5' : (NODE_TYPE_COLORS[d.nodeType] ?? EMBRY.dim))
      .attr('stroke-width', (d) => d.id === selectedNodeIdRef.current ? 2.5 : hasCwe(d.id) ? 2 : 1)
      .attr('stroke-dasharray', (d) => d.tier === 'T1' ? '4,2' : d.tier === 'T2' ? '1,2' : 'none')
      .attr('stroke-opacity', (d) => nodeImportance(d) * 0.6)
      .transition()
      .delay((_d, i) => Math.min(i * 12, 500))
      .duration(350)
      .ease(d3.easeCubicOut)
      .attr('d', (d) => nodeShapePath(d.nodeType, r(d)))

    // State machine: additional ring for visual distinction
    nodeGs.filter((d) => d.nodeType === 'state_machine')
      .append('circle')
      .attr('class', 'state-ring')
      .attr('cx', 0).attr('cy', 0)
      .attr('r', (d) => r(d) + 3)
      .attr('fill', 'none')
      .attr('stroke', NODE_TYPE_COLORS.state_machine)
      .attr('stroke-width', 1)
      .attr('stroke-opacity', 0.4)
      .attr('stroke-dasharray', '2,2')

    // CWE hazard ring — red outer ring on nodes with CWE vulnerability tags
    nodeGs.filter((d) => {
      const tax = taxonomyRef.current?.get(d.id)
      return tax && (tax.cwe?.length > 0 || tax.attack?.length > 0)
    })
      .append('circle')
      .attr('class', 'cwe-ring')
      .attr('cx', 0).attr('cy', 0)
      .attr('r', (d) => r(d) + 5)
      .attr('fill', 'none')
      .attr('stroke', '#ef4444')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.7)
      .attr('stroke-dasharray', '3,2')

    // CWE badge — small red dot at bottom-right of nodes with CWE tags
    nodeGs.filter((d) => {
      const tax = taxonomyRef.current?.get(d.id)
      return tax && tax.cwe?.length > 0
    })
      .append('circle')
      .attr('class', 'cwe-badge')
      .attr('cx', (d) => r(d) - 1)
      .attr('cy', (d) => r(d) - 1)
      .attr('r', 3)
      .attr('fill', '#ef4444')
      .attr('stroke', '#7f1d1d')
      .attr('stroke-width', 0.5)

    // Tier badge — small colored dot at top-right of node
    nodeGs.append('circle')
      .attr('class', 'tier-badge')
      .attr('cx', (d) => r(d) - 2)
      .attr('cy', (d) => -(r(d) - 2))
      .attr('r', 3)
      .attr('fill', (d) => TIER_COLORS[d.tier] ?? EMBRY.muted)
      .attr('stroke', EMBRY.bgDeep)
      .attr('stroke-width', 1)
      .attr('opacity', 0.8)


    // SPARTA mind-tag badge — purple dot at bottom-left for tagged nodes
    nodeGs.filter((d) => (taxonomyRef.current?.get(d.id)?.mind?.length ?? 0) > 0)
      .append('circle')
      .attr('class', 'mind-tag-dot')
      .attr('cx', (d) => -(r(d) - 2))
      .attr('cy', (d) => r(d) - 2)
      .attr('r', 3.5)
      .attr('fill', '#9C27B0')
      .attr('stroke', EMBRY.bgDeep)
      .attr('stroke-width', 1)
      .attr('opacity', 0.9)
      .append('title')
      .text((d) => 'SPARTA: ' + (taxonomyRef.current?.get(d.id)?.mind ?? []).join(', '))

    // Hub badge (edge count) for nodes with >8 connections
    nodeGs.filter((d) => (degree.get(d.id) ?? 0) > 8)
      .append('text')
      .attr('class', 'hub-badge')
      .attr('dy', (d) => -(r(d) + 6))
      .attr('text-anchor', 'middle')
      .attr('fill', EMBRY.accent)
      .attr('font-size', 7)
      .attr('font-weight', 700)
      .attr('font-family', 'JetBrains Mono, monospace')
      .text((d) => `${degree.get(d.id)}`)

    // Node label (with text shadow for contrast)
    nodeGs.append('text')
      .attr('class', 'node-label')
      .attr('dy', (d) => r(d) + 10)
      .attr('text-anchor', 'middle')
      .attr('fill', EMBRY.dim)
      .attr('font-size', 9)
      .attr('font-weight', 600)
      .attr('font-family', 'JetBrains Mono, monospace')
      .style('paint-order', 'stroke fill')
      .attr('stroke', EMBRY.bgDeep)
      .attr('stroke-width', 3)
      .style('filter', 'drop-shadow(0 0 2px rgba(0,0,0,0.6))')
      .attr('opacity', (d) => {
        if (d.nodeType === 'namespace') return 1
        if ((degree.get(d.id) ?? 0) > 5) return 0.7
        return 0
      })
      .text((d) => d.label.length > 28 ? `${d.label.slice(0, 26)}…` : d.label)

    // ── Drag ──
    // Shared flag: set true on drag, checked in click handler to suppress false clicks
    let _wasDraggedRef = { current: false }
    const drag = d3.drag<SVGGElement, SimNode, d3.SubjectPosition>()
      .on('start', (event, d) => {
        _wasDraggedRef.current = false
        // Hierarchical mode uses fixed positions — don't heat up the simulation
        if (!event.active && activeLayout !== 'hierarchical') simulation.alphaTarget(0.1).restart()
        d.fx = d.x; d.fy = d.y
      })
      .on('drag', (event, d) => { _wasDraggedRef.current = true; d.fx = event.x; d.fy = event.y })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0)
        // Hierarchical: keep node pinned at its dragged position to preserve rank layout
        // Organic/stratified/clustered: release so physics can settle
        if (activeLayout !== 'hierarchical') { d.fx = null; d.fy = null }
      })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nodeGs.call(drag as any) // Type assertion necessary due to complex D3 Selection overlap with React types

    // ── Position persistence ──
    // Use a stable key that includes node IDs, not just count (prevents cross-graph collisions)
    const posKey = `binary-graph-pos-${simNodes.slice(0, 5).map(n => n.id).join(',')}-${simNodes.length}`
    const savePositions = () => {
      const positions: Record<string, { x: number; y: number }> = {}
      for (const d of simNodes) {
        if (d.x != null && d.y != null) positions[d.id] = { x: d.x, y: d.y }
      }
      try { localStorage.setItem(posKey, JSON.stringify(positions)) } catch {}
    }
    let tickCount = 0

    // ── Tick ──
    simulation.on('tick', () => {
      // LOD: for large graphs skip DOM writes on odd ticks — physics still advances
      // every tick but we paint half as often, halving layout-phase jank.
      if (LARGE_GRAPH && tickCount % 2 !== 0) { tickCount++; return }

      // Soft boundary — gently push nodes back toward viewport, not hard clamp
      const margin = 50
      const pushStrength = 0.5
      for (const d of simNodes) {
        if (d.x! < margin) d.vx! += (margin - d.x!) * pushStrength
        else if (d.x! > width - margin) d.vx! -= (d.x! - (width - margin)) * pushStrength
        if (d.y! < margin) d.vy! += (margin - d.y!) * pushStrength
        else if (d.y! > height - margin) d.vy! -= (d.y! - (height - margin)) * pushStrength
      }

      // Edge paths: recompute every tick so edges are visible at low opacity.
      // For huge graphs (>500 edges), throttle to every 3rd tick.
      if (tickCount % (HUGE_GRAPH ? 3 : 1) === 0) {
        edgeLines.attr('d', (d) => {
          const sx = (d.source as SimNode).x!, sy = (d.source as SimNode).y!
          const tx = (d.target as SimNode).x!, ty = (d.target as SimNode).y!
          if (d.edgeType === 'contains') {
            // Quadratic curve — offset perpendicular to line
            const mx = (sx + tx) / 2, my = (sy + ty) / 2
            const dx = tx - sx, dy = ty - sy
            const len = Math.sqrt(dx * dx + dy * dy) || 1
            const cx = mx + (-dy / len) * 18, cy = my + (dx / len) * 18
            return `M${sx},${sy} Q${cx},${cy} ${tx},${ty}`
          }
          return `M${sx},${sy} L${tx},${ty}`
        })
      }
      nodeGs.attr('transform', (d) => `translate(${d.x},${d.y})`)

      // Update edge label positions (only when visible = node selected)
      if (clickedRef.current !== null) {
        edgeLabels.attr('x', (e) => ((e.source as SimNode).x! + (e.target as SimNode).x!) / 2)
          .attr('y', (e) => ((e.source as SimNode).y! + (e.target as SimNode).y!) / 2 - 6)
      }

      // Hull positions: throttle more aggressively for large graphs — convex hull
      // is decorative and recomputing it every tick is wasteful at N>200.
      const hullInterval = LARGE_GRAPH ? 4 : 1
      if (tickCount % hullInterval === 0) {
        hullPaths.attr('d', ([, ns]) => hullPath(ns.map(n => [n.x!, n.y!] as [number, number]), 12))
        hullGroup.selectAll<SVGTextElement, [string, SimNode[]]>('.hull-label')
          .attr('x', ([, ns]) => ns.reduce((s, n) => s + (n.x ?? 0), 0) / ns.length)
          .attr('y', ([, ns]) => ns.reduce((s, n) => s + (n.y ?? 0), 0) / ns.length)
      }

      // Update minimap nodes every 10 ticks (hide minimap when <15 nodes — not useful)
      if (tickCount % 10 === 0) {
        mmG.attr('display', simNodes.length < 15 ? 'none' : 'block')
        updateMinimapNodes(simNodes.map(n => ({ x: n.x!, y: n.y!, nodeType: n.nodeType })))
        updateMinimapViewport(d3.zoomTransform(svg))
      }

      // Save positions periodically (every 100 ticks) for persistence
      if (++tickCount % 100 === 0) savePositions()
    })

    // Restore saved positions if available (before pre-warm, so they seed the layout)
    try {
      const saved = localStorage.getItem(posKey)
      if (saved) {
        const positions = JSON.parse(saved) as Record<string, { x: number; y: number }>
        let restored = 0
        for (const d of simNodes) {
          const p = positions[d.id]
          if (p) { d.x = p.x; d.y = p.y; restored++ }
        }
        // If most positions restored, skip high-energy pre-warm
        if (restored > simNodes.length * 0.8) {
          simulation.alpha(0.05) // Gentle settle only
        }
      }
    } catch {}

    // Fit graph when simulation settles
    let initialFitDone = false
    simulation.on('end', () => {
      savePositions()
      if (!initialFitDone && !selectedNodeIdRef.current) {
        initialFitDone = true
        fitToGraph()
      }
    })

    return () => { simulation.stop(); if (tooltipEl) tooltipEl.style.opacity = '0' }
  // Rebuild on data change, layout change, OR when dimensions first arrive (null → measured).
  // ResizeObserver debounces at 150ms so resize-triggered rebuilds are rare.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataKey, activeLayout, dimensions])

  useEffect(() => { return setupSimulation() }, [setupSimulation])

  // On resize: just update viewBox and re-fit — DON'T rebuild simulation
  useEffect(() => {
    const svg = svgRef.current
    if (!svg || !dimensions) return
    const { width, height } = dimensions
    d3.select(svg).attr('viewBox', `0 0 ${width} ${height}`)
    // Update the background rect
    d3.select(svg).select('rect').attr('width', width).attr('height', height)
  }, [dimensions])

  // Update node opacity when matchedNodeIds changes (without rebuilding simulation)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const zoomG = d3.select(svg).select('g.zoom-container')
    if (zoomG.empty()) return
    const nodeGs = zoomG.select('g.nodes').selectAll<SVGGElement, SimNode>('g')
    if (nodeGs.empty()) return

    const filtering = matchedNodeIds && matchedNodeIds.size > 0
    nodeGs.transition().duration(200)
      .attr('opacity', (d: SimNode) => !filtering || matchedNodeIds!.has(d.id) ? 1 : 0.12)

    // Enhanced match highlighting: green stroke + glow for matched nodes
    if (filtering) {
      nodeGs.selectAll<SVGPathElement, SimNode>('.node-shape').transition().duration(200)
        .attr('stroke', (d) => matchedNodeIds!.has(d.id) ? '#39FF14' : (d.id === selectedNodeIdRef.current ? '#fff' : (NODE_TYPE_COLORS[d.nodeType] ?? '#6b7280')))
        .attr('stroke-width', (d) => matchedNodeIds!.has(d.id) ? 3 : (d.id === selectedNodeIdRef.current ? 2.5 : 1))
        .attr('filter', (d) => matchedNodeIds!.has(d.id) ? 'url(#glow)' : 'none')
    } else {
      nodeGs.selectAll<SVGPathElement, SimNode>('.node-shape').transition().duration(200)
        .attr('stroke', (d) => d.id === selectedNodeIdRef.current ? '#fff' : (NODE_TYPE_COLORS[d.nodeType] ?? '#6b7280'))
        .attr('stroke-width', (d) => d.id === selectedNodeIdRef.current ? 2.5 : 1)
        .attr('filter', 'none')
    }

    // Ensure matched nodes also display their labels to be easily found
    if (filtering) {
      nodeGs.selectAll<SVGTextElement, SimNode>('.node-label').transition().duration(200)
        .attr('opacity', (d) => matchedNodeIds!.has(d.id) || d.nodeType === 'namespace' ? 1 : 0)
    } else {
      // Revert to zoom-based opacity when filter is cleared
      const transform = d3.zoomTransform(svg)
      const labelOpacity = transform.k > 1.5 ? Math.min(0.8, (transform.k - 1.5) * 2) : 0
      nodeGs.selectAll<SVGTextElement, SimNode>('.node-label').transition().duration(200)
        .attr('opacity', (d) => d.nodeType === 'namespace' ? 1 : labelOpacity)
    }
  }, [matchedNodeIds])

  // Observe container size
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const container = svg.parentElement
    if (!container) return
    let resizeTimer: ReturnType<typeof setTimeout>
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0) {
        // Debounce to prevent rapid rebuilds during layout reflow
        clearTimeout(resizeTimer)
        resizeTimer = setTimeout(() => setDimensions({ width, height }), 150)
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  // Keyboard shortcuts: F = fit-to-graph, Escape = deselect
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const svg = svgRef.current
      if (!svg) return
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (e.key === 'f' || e.key === 'F') { if ((svg as any).__fitToGraph) (svg as any).__fitToGraph() }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (e.key === 'Escape') { if ((svg as any).__applySelection) (svg as any).__applySelection(null) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <div style={{ padding: 0, overflow: 'hidden', flex: '1 1 0%', minHeight: 0, display: 'flex', flexDirection: 'column', borderRadius: 0 }} tabIndex={0}>
      {/* Legend */}
      <div style={{
        padding: '6px 12px', borderBottom: `1px solid ${EMBRY.border}`,
        display: 'flex', gap: 12, fontSize: 9, alignItems: 'center', color: EMBRY.dim, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {Object.entries(NODE_TYPE_COLORS).map(([type, color]) => {
            // Match shapes used in nodeShapePath: diamond=event, square=schema, triangle=cli_command, double-ring=state_machine, circle=rest
            const S = 10
            let shapeEl: React.ReactNode
            if (type === 'event') {
              // Diamond
              shapeEl = (
                <svg width={S} height={S} viewBox="-5 -5 10 10" style={{ flexShrink: 0 }}>
                  <path d="M0,-4 L4,0 L0,4 L-4,0 Z" fill={color} fillOpacity={0.8} />
                </svg>
              )
            } else if (type === 'schema') {
              // Square
              shapeEl = (
                <svg width={S} height={S} viewBox="-5 -5 10 10" style={{ flexShrink: 0 }}>
                  <rect x="-3.5" y="-3.5" width="7" height="7" fill={color} fillOpacity={0.8} />
                </svg>
              )
            } else if (type === 'cli_command') {
              // Triangle
              shapeEl = (
                <svg width={S} height={S} viewBox="-5 -5 10 10" style={{ flexShrink: 0 }}>
                  <path d="M0,-4 L3.8,2.4 L-3.8,2.4 Z" fill={color} fillOpacity={0.8} />
                </svg>
              )
            } else if (type === 'state_machine') {
              // Circle with dashed outer ring
              shapeEl = (
                <svg width={S + 2} height={S + 2} viewBox="-6 -6 12 12" style={{ flexShrink: 0 }}>
                  <circle r="3.5" fill={color} fillOpacity={0.8} />
                  <circle r="5" fill="none" stroke={color} strokeWidth="0.8" strokeOpacity={0.5} strokeDasharray="2,1.5" />
                </svg>
              )
            } else {
              // Circle (namespace, rpc, parameter, etc.)
              shapeEl = (
                <svg width={S} height={S} viewBox="-5 -5 10 10" style={{ flexShrink: 0 }}>
                  <circle r="3.5" fill={color} fillOpacity={0.8} />
                </svg>
              )
            }
            const isFiltered = activeTypeFilters && activeTypeFilters.size > 0
            const isActive = !isFiltered || activeTypeFilters!.has(type)
            return (
              <span key={type} id={`be-legend-${type}`}
                onClick={() => onToggleTypeFilter?.(type)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 3,
                  cursor: onToggleTypeFilter ? 'pointer' : 'default',
                  opacity: isActive ? 1 : 0.3,
                  textDecoration: activeTypeFilters?.has(type) ? 'underline' : 'none',
                  transition: 'opacity 0.15s',
                }}>
                {shapeEl}
                {type.replace(/_/g, ' ')}
              </span>
            )
          })}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center' }}>
          {(['organic', 'hierarchical', 'stratified', 'clustered'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setActiveLayout(mode)}
              title={
                mode === 'organic' ? 'Force-directed (explore clusters)' :
                mode === 'hierarchical' ? 'Sugiyama DAG — callers top, callees bottom' :
                mode === 'stratified' ? 'Layer by node type' :
                'Group by namespace cluster'
              }
              style={{
                fontSize: 8, padding: '1px 6px', cursor: 'pointer',
                fontFamily: 'JetBrains Mono, monospace', textTransform: 'uppercase',
                letterSpacing: '0.04em', border: `1px solid ${activeLayout === mode ? EMBRY.accent : EMBRY.border}`,
                background: activeLayout === mode ? `${EMBRY.accent}22` : 'transparent',
                color: activeLayout === mode ? EMBRY.accent : EMBRY.muted,
                borderRadius: 0,
              }}
            >
              {mode === 'organic' ? 'FORCE' : mode === 'hierarchical' ? 'HIERARCHY' : mode === 'stratified' ? 'LAYERS' : 'CLUSTERS'}
            </button>
          ))}
        </div>
        <span style={{ color: EMBRY.muted }}>
          {nodes.length} nodes
        </span>
        <span style={{ color: EMBRY.muted, fontSize: 8, opacity: 0.7 }}>
          <kbd style={{ padding: '0 3px', background: '#1a1a1a', border: `1px solid ${EMBRY.border}`, borderRadius: 1, fontSize: 7 }}>F</kbd> fit
          {' '}<kbd style={{ padding: '0 3px', background: '#1a1a1a', border: `1px solid ${EMBRY.border}`, borderRadius: 1, fontSize: 7 }}>Esc</kbd> desel
          {' '}<kbd style={{ padding: '0 3px', background: '#1a1a1a', border: `1px solid ${EMBRY.border}`, borderRadius: 1, fontSize: 7 }}>←→</kbd> nav
          {' '}<kbd style={{ padding: '0 3px', background: '#1a1a1a', border: `1px solid ${EMBRY.border}`, borderRadius: 1, fontSize: 7 }}>Enter</kbd> select
        </span>
      </div>

      {/* SVG Container */}
      <div style={{ backgroundColor: EMBRY.bgDeep, position: 'relative', overflow: 'hidden', flex: '1 1 0%', minHeight: 0 }}>
        <svg ref={svgRef} role="img" aria-label={`Interactive graph: ${nodes.length} nodes. Arrow keys to navigate, Enter to select, Escape to deselect.`} style={{ width: '100%', height: '100%', display: 'block' }} />
        {/* Screen reader announcements for state changes */}
        <div id="be-graph-announce" aria-live="polite" aria-atomic="true" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0,0,0,0)' }} />

        {/* Tooltip (D3 managed) */}
        <div id="graph-tooltip" style={{
          position: 'absolute', pointerEvents: 'none', zIndex: 1000,
          background: 'rgba(5, 5, 5, 0.95)', border: `1px solid ${EMBRY.border}`,
          padding: '10px 14px', borderRadius: 0, opacity: 0,
          boxShadow: '0 8px 32px rgba(0,0,0,0.8)', backdropFilter: 'blur(12px)',
          minWidth: 180, maxWidth: 300, color: '#fff', fontSize: 11,
          transition: 'opacity 0.15s',
        }} />
      </div>
    </div>
  )
}

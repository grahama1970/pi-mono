/**
 * BinaryGraphWebGL — Canvas-based force-directed graph using react-force-graph-2d.
 *
 * Drop-in replacement for BinaryGraph (SVG). Same props interface.
 * Uses HTML5 Canvas (WebGL-accelerated compositing) for 1000+ node performance.
 */
import { useRef, useEffect, useState, useCallback, useMemo, useImperativeHandle, forwardRef } from 'react'
import ForceGraph2D from 'react-force-graph-2d'
import type { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d'
import * as d3Force from 'd3-force'
import { EMBRY } from '../common/EmbryStyle'
import type { BinaryGraphNode, BinaryGraphEdge } from '../../hooks/useBinaryData'
import { NODE_TYPE_COLORS } from '../../hooks/useBinaryData'

// Re-export the same props interface for drop-in compatibility
export interface BinaryGraphProps {
  nodes: BinaryGraphNode[]
  edges: BinaryGraphEdge[]
  matchedNodeIds?: Set<string>
  visitedNodeIds?: Set<string>
  onNodeClick?: (node: BinaryGraphNode) => void
  onNodeHover?: (node: BinaryGraphNode | null) => void
  onContextMenu?: (node: BinaryGraphNode, x: number, y: number) => void
  layoutMode?: 'organic' | 'stratified' | 'clustered'
  selectedNodeId?: string | null
  graphRef?: React.MutableRefObject<BinaryGraphWebGLHandle | null>
  expandedNodeIds?: Set<string>
  perspective?: string
}

/** Imperative handle exposed to parent for panToNode / fitToGraph / applySelection */
export interface BinaryGraphWebGLHandle {
  panToNode: (nodeId: string, scale?: number) => void
  fitToGraph: (duration?: number) => void
  applySelection: (targetId: string | null) => void
}

// ── Constants (mirrored from BinaryGraph.tsx for visual parity) ──

const EDGE_COLORS: Record<string, string> = {
  contains: '#64748b', payload: '#2196F3', emits: '#FF9800',
  triggers: '#4CAF50', has_parameter: '#9C27B0',
}

const EDGE_WIDTHS: Record<string, number> = {
  contains: 1.2, payload: 2.0, emits: 2.4,
  triggers: 3.0, has_parameter: 1.5,
}

const TIER_COLORS: Record<string, string> = { T0: '#00ff88', T1: '#4a9eff', T2: '#ffaa00' }

// Edge type priority for sorting: triggers > emits > payload > has_parameter > contains
const EDGE_TYPE_PRIORITY: Record<string, number> = {
  triggers: 0, emits: 1, payload: 2, has_parameter: 3, contains: 4,
}

/** Logarithmic size-by-degree with type overrides (matches SVG version) */
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

// ── Graph node/link types for force-graph ──

interface FGNode {
  id: string
  label: string
  nodeType: string
  cluster: string
  tier: string
  confidence: number
  description?: string
  fields?: string[]
  states?: string[]
  source_pattern?: string
  // Computed at graph build time
  __degree: number
  __radius: number
  __color: string
  __importance: number
  // Added by force simulation at runtime
  x?: number
  y?: number
  vx?: number
  vy?: number
}

interface FGLink {
  source: string
  target: string
  edgeType: string
  sharedField?: string
}

type FGNodeObj = NodeObject<FGNode>
type FGLinkObj = LinkObject<FGNode, FGLink>

/** Compute convex hull from points; returns padded polygon or null */
function computeHull(points: [number, number][], pad = 12): [number, number][] | null {
  if (points.length < 3) return null
  // Graham scan / gift wrap — use a simple approach
  // Sort by x then y
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (O: [number, number], A: [number, number], B: [number, number]) =>
    (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0])

  const lower: [number, number][] = []
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop()
    lower.push(p)
  }
  const upper: [number, number][] = []
  for (const p of sorted.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop()
    upper.push(p)
  }
  upper.pop()
  lower.pop()
  const hull = lower.concat(upper)
  if (hull.length < 3) return null

  // Pad outward from centroid
  const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length
  const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length
  return hull.map(([x, y]) => {
    const dx = x - cx, dy = y - cy
    const dist = Math.sqrt(dx * dx + dy * dy) || 1
    return [x + (dx / dist) * pad, y + (dy / dist) * pad] as [number, number]
  })
}

// ── Component ──

export const BinaryGraphWebGL = forwardRef<BinaryGraphWebGLHandle, BinaryGraphProps>(
  function BinaryGraphWebGL(
    { nodes, edges, matchedNodeIds, visitedNodeIds, onNodeClick, onNodeHover,
      onContextMenu, layoutMode = 'organic', selectedNodeId = null, graphRef },
    ref,
  ) {
    const fgRef = useRef<ForceGraphMethods<FGNodeObj, FGLinkObj> | undefined>(undefined)
    const containerRef = useRef<HTMLDivElement>(null)
    const [dimensions, setDimensions] = useState<{ width: number; height: number }>({ width: 800, height: 600 })
    const selectedRef = useRef(selectedNodeId)
    selectedRef.current = selectedNodeId
    const visitedRef = useRef(visitedNodeIds)
    visitedRef.current = visitedNodeIds

    // ── Build graph data ──
    const { graphData, degreeMap, clusterGroups } = useMemo(() => {
      const deg = new Map<string, number>()
      const nodeSet = new Set(nodes.map(n => n.id))
      const validEdges = edges.filter(e => nodeSet.has(e.source) && nodeSet.has(e.target))

      for (const e of validEdges) {
        deg.set(e.source, (deg.get(e.source) ?? 0) + 1)
        deg.set(e.target, (deg.get(e.target) ?? 0) + 1)
      }

      const clusters = new Map<string, string[]>()
      const fgNodes: FGNode[] = nodes.map(n => {
        const d = deg.get(n.id) ?? 0
        const r = nodeRadius(n.nodeType, d)
        const color = NODE_TYPE_COLORS[n.nodeType] ?? EMBRY.dim
        const importance = n.nodeType === 'namespace' ? 1.0 : d > 20 ? 1.0 : d > 10 ? 0.85 : d > 5 ? 0.6 : 0.4
        const key = n.cluster || 'unknown'
        if (!clusters.has(key)) clusters.set(key, [])
        clusters.get(key)!.push(n.id)
        return {
          id: n.id, label: n.label, nodeType: n.nodeType, cluster: n.cluster,
          tier: n.tier, confidence: n.confidence, description: n.description,
          fields: n.fields, states: n.states, source_pattern: n.source_pattern,
          __degree: d, __radius: r, __color: color, __importance: importance,
        }
      })

      const fgLinks: FGLink[] = validEdges.map(e => ({
        source: e.source, target: e.target, edgeType: e.edgeType, sharedField: e.sharedField,
      }))

      return {
        graphData: { nodes: fgNodes, links: fgLinks },
        degreeMap: deg,
        clusterGroups: clusters,
      }
    }, [nodes, edges])

    // ── Selection state (which edges/nodes to highlight) ──
    const [shownEdgeKeys, setShownEdgeKeys] = useState<Set<string>>(new Set())
    const [connectedIds, setConnectedIds] = useState<Set<string>>(new Set())

    const hasFilter = matchedNodeIds && matchedNodeIds.size > 0
    const isMatched = useCallback(
      (id: string) => !hasFilter || matchedNodeIds!.has(id),
      [hasFilter, matchedNodeIds],
    )

    // ── Imperative API ──
    const applySelection = useCallback((targetId: string | null) => {
      selectedRef.current = targetId
      if (!targetId) {
        setShownEdgeKeys(new Set())
        setConnectedIds(new Set())
        return
      }

      // Find 1-hop edges, sorted by priority, capped at 15
      const hop1 = graphData.links.filter(e => {
        const s = typeof e.source === 'string' ? e.source : (e.source as FGNodeObj)?.id
        const t = typeof e.target === 'string' ? e.target : (e.target as FGNodeObj)?.id
        return s === targetId || t === targetId
      })
      hop1.sort((a, b) => (EDGE_TYPE_PRIORITY[a.edgeType] ?? 5) - (EDGE_TYPE_PRIORITY[b.edgeType] ?? 5))
      const shown = hop1.slice(0, 15)

      const edgeKeys = new Set<string>()
      const connIds = new Set<string>([targetId])
      for (const e of shown) {
        const s = typeof e.source === 'string' ? e.source : (e.source as FGNodeObj)?.id
        const t = typeof e.target === 'string' ? e.target : (e.target as FGNodeObj)?.id
        if (s && t) {
          edgeKeys.add(`${s}→${t}→${e.edgeType}`)
          connIds.add(s)
          connIds.add(t)
        }
      }
      setShownEdgeKeys(edgeKeys)
      setConnectedIds(connIds)
    }, [graphData.links])

    const panToNode = useCallback((nodeId: string, scale?: number) => {
      const fg = fgRef.current
      if (!fg) return
      const node = graphData.nodes.find(n => n.id === nodeId)
      if (!node || node.x == null || node.y == null) return
      const currentZoom = fg.zoom()
      const targetScale = scale || currentZoom
      fg.centerAt(node.x, node.y, 750)
      if (scale) fg.zoom(targetScale, 750)
    }, [graphData.nodes])

    const fitToGraph = useCallback((duration = 750) => {
      fgRef.current?.zoomToFit(duration, 80)
    }, [])

    // Expose handle via ref
    useImperativeHandle(ref, () => ({ panToNode, fitToGraph, applySelection }), [panToNode, fitToGraph, applySelection])
    // Also expose on graphRef prop for compatibility
    useEffect(() => {
      if (graphRef) graphRef.current = { panToNode, fitToGraph, applySelection }
    }, [graphRef, panToNode, fitToGraph, applySelection])

    // Sync selection from prop changes
    useEffect(() => { applySelection(selectedNodeId) }, [selectedNodeId, applySelection])

    // ── Observe container size ──
    useEffect(() => {
      const el = containerRef.current
      if (!el) return
      let timer: ReturnType<typeof setTimeout>
      const observer = new ResizeObserver(entries => {
        const { width, height } = entries[0].contentRect
        if (width > 0 && height > 0) {
          clearTimeout(timer)
          timer = setTimeout(() => setDimensions({ width, height }), 150)
        }
      })
      observer.observe(el)
      return () => observer.disconnect()
    }, [])

    // ── Configure forces after mount ──
    useEffect(() => {
      const fg = fgRef.current
      if (!fg) return

      // Match the SVG version's force configuration
      const area = dimensions.width * dimensions.height
      const nodeCount = graphData.nodes.length || 1
      const chargeStrength = -Math.max(800, area / (nodeCount * 1.2))

      const charge = fg.d3Force('charge')
      if (charge && 'strength' in charge) {
        ;(charge as any).strength(chargeStrength)
          .distanceMax(Math.max(dimensions.width, dimensions.height) * 1.5)
      }

      const link = fg.d3Force('link')
      if (link && 'distance' in link) {
        ;(link as any).distance(150).strength(0.35)
      }

      const center = fg.d3Force('center')
      if (center && 'strength' in center) {
        ;(center as any).strength(0.08)
      }

      // Layout modes
      if (layoutMode === 'stratified') {
        fg.d3Force('y', d3Force.forceY((d: any) => {
          const type = d.nodeType
          if (type === 'cli_command' || type === 'namespace') return dimensions.height * 0.15
          if (type === 'rpc') return dimensions.height * 0.35
          if (type === 'event') return dimensions.height * 0.65
          if (type === 'state_machine' || type === 'parameter' || type === 'schema') return dimensions.height * 0.85
          return dimensions.height * 0.5
        }).strength(0.12) as any)
        fg.d3Force('x', d3Force.forceX(dimensions.width / 2).strength(0.02) as any)
      }

      fg.d3ReheatSimulation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [graphData.nodes.length, layoutMode, dimensions])

    // Fit on initial engine stop
    const initialFitRef = useRef(false)
    const handleEngineStop = useCallback(() => {
      if (!initialFitRef.current && !selectedRef.current) {
        initialFitRef.current = true
        fgRef.current?.zoomToFit(750, 80)
      }
    }, [])

    // Reset initialFit when data changes
    useEffect(() => { initialFitRef.current = false }, [graphData])

    // ── Custom node canvas rendering ──
    const nodeCanvasObject = useCallback((node: FGNodeObj, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as FGNodeObj & FGNode
      if (n.x == null || n.y == null) return
      const x = n.x, y = n.y
      const r = n.__radius ?? 6
      const color = n.__color ?? EMBRY.dim
      const importance = n.__importance ?? 0.4
      const selected = selectedRef.current
      const visited = visitedRef.current
      const isTarget = n.id === selected
      const isConnected = selected ? connectedIds.has(n.id) : false
      const isVisited = visited?.has(n.id) ?? false
      const hasSelection = !!selected
      const hasVisibleEdges = shownEdgeKeys.size > 0

      // Compute opacity (matches SVG applySelection logic)
      let opacity: number
      if (!hasSelection) {
        opacity = isMatched(n.id) ? importance : 0.12
      } else if (isTarget) {
        opacity = 1
      } else if (isConnected) {
        opacity = 0.70
      } else if (isVisited) {
        opacity = 0.50
      } else {
        opacity = hasVisibleEdges ? 0.30 : 0.70
      }

      ctx.save()
      ctx.globalAlpha = opacity

      // Glow filter for selected node
      if (isTarget) {
        ctx.shadowColor = EMBRY.accent
        ctx.shadowBlur = 12
      }

      // Main circle
      ctx.beginPath()
      ctx.arc(x, y, r, 0, 2 * Math.PI)
      ctx.fillStyle = color
      ctx.fill()

      // Stroke: selected = white, visited = accent, tier dash patterns
      if (isTarget) {
        ctx.strokeStyle = EMBRY.white
        ctx.lineWidth = 3
        ctx.stroke()
      } else if (isVisited && hasSelection) {
        ctx.strokeStyle = EMBRY.accent
        ctx.lineWidth = 1.5
        ctx.globalAlpha = opacity * 0.4
        ctx.stroke()
        ctx.globalAlpha = opacity
      } else {
        // Subtle type-color stroke for normal nodes
        ctx.strokeStyle = color
        ctx.lineWidth = 1
        ctx.globalAlpha = opacity * 0.6
        if (n.tier === 'T1') ctx.setLineDash([4, 2])
        else if (n.tier === 'T2') ctx.setLineDash([1, 2])
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = opacity
      }

      ctx.shadowBlur = 0

      // State machine ring
      if (n.nodeType === 'state_machine') {
        ctx.beginPath()
        ctx.arc(x, y, r + 3, 0, 2 * Math.PI)
        ctx.strokeStyle = NODE_TYPE_COLORS.state_machine
        ctx.lineWidth = 1
        ctx.globalAlpha = opacity * 0.4
        ctx.setLineDash([2, 2])
        ctx.stroke()
        ctx.setLineDash([])
        ctx.globalAlpha = opacity
      }

      // Pulsing ring for selected node (static since canvas redraws every frame)
      if (isTarget) {
        ctx.beginPath()
        const pulseR = r + 6 + Math.sin(Date.now() / 300) * 4
        ctx.arc(x, y, pulseR, 0, 2 * Math.PI)
        ctx.strokeStyle = EMBRY.accent
        ctx.lineWidth = 1.5
        ctx.globalAlpha = 0.4 + Math.sin(Date.now() / 300) * 0.3
        ctx.stroke()
        ctx.globalAlpha = opacity
      }

      // Tier badge dot at top-right
      const tierColor = TIER_COLORS[n.tier]
      if (tierColor) {
        ctx.beginPath()
        ctx.arc(x + r - 2, y - (r - 2), 3, 0, 2 * Math.PI)
        ctx.fillStyle = tierColor
        ctx.globalAlpha = 0.8
        ctx.fill()
        ctx.strokeStyle = EMBRY.bgDeep
        ctx.lineWidth = 1
        ctx.stroke()
        ctx.globalAlpha = opacity
      }

      // Hub badge (edge count) for nodes with >8 connections
      const deg = n.__degree ?? 0
      if (deg > 8) {
        ctx.font = `bold ${7 / globalScale > 7 ? 7 : 7}px JetBrains Mono, monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'bottom'
        ctx.fillStyle = EMBRY.accent
        ctx.globalAlpha = opacity
        ctx.fillText(`${deg}`, x, y - r - 4)
      }

      // Node label
      const showLabel = (() => {
        if (n.nodeType === 'namespace') return true
        if (hasSelection && isTarget) return true
        if (hasSelection && isConnected) return true
        if (hasSelection && isVisited) return true
        if (hasFilter && matchedNodeIds!.has(n.id)) return true
        if (deg > 8 && globalScale > 0.8) return true
        return globalScale > 1.5
      })()

      if (showLabel) {
        const label = n.label.length > 22 ? `${n.label.slice(0, 20)}…` : n.label
        const fontSize = Math.max(8, 8 / globalScale > 12 ? 12 : 8)
        ctx.font = `600 ${fontSize}px JetBrains Mono, monospace`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'top'

        // Text shadow (stroke behind fill)
        ctx.strokeStyle = EMBRY.bgDeep
        ctx.lineWidth = 3 / globalScale
        ctx.lineJoin = 'round'
        ctx.globalAlpha = opacity
        ctx.strokeText(label, x, y + r + 4)
        ctx.fillStyle = EMBRY.dim
        ctx.fillText(label, x, y + r + 4)
      }

      ctx.restore()
    }, [connectedIds, shownEdgeKeys, isMatched, hasFilter, matchedNodeIds])

    // ── Custom link canvas rendering ──
    const linkCanvasObject = useCallback((link: FGLinkObj, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const l = link as FGLinkObj & FGLink
      const source = l.source as FGNodeObj
      const target = l.target as FGNodeObj
      if (!source?.x || !source?.y || !target?.x || !target?.y) return

      const sx = source.x, sy = source.y
      const tx = target.x, ty = target.y
      const edgeType = l.edgeType
      const color = EDGE_COLORS[edgeType] ?? EMBRY.dim
      const baseWidth = EDGE_WIDTHS[edgeType] ?? 1.0

      // Build edge key for visibility check
      const sId = (source as FGNodeObj & FGNode).id
      const tId = (target as FGNodeObj & FGNode).id
      const edgeKey = `${sId}→${tId}→${edgeType}`
      const isShown = shownEdgeKeys.has(edgeKey)
      const hasSelection = !!selectedRef.current

      // Edges hidden by default; only shown for selected node's 1-hop
      if (hasSelection && !isShown) return
      if (!hasSelection) return // No selection = no edges visible (matches SVG behavior)

      const width = baseWidth * 1.2

      ctx.save()
      ctx.strokeStyle = color
      ctx.lineWidth = width / globalScale
      ctx.globalAlpha = 0.9

      ctx.beginPath()
      if (edgeType === 'contains') {
        // Quadratic curve — offset perpendicular to line
        const mx = (sx + tx) / 2, my = (sy + ty) / 2
        const dx = tx - sx, dy = ty - sy
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const cx = mx + (-dy / len) * 18, cy = my + (dx / len) * 18
        ctx.moveTo(sx, sy)
        ctx.quadraticCurveTo(cx, cy, tx, ty)
      } else {
        ctx.moveTo(sx, sy)
        ctx.lineTo(tx, ty)
      }
      ctx.stroke()

      // Arrowhead for directional edges (not 'contains')
      if (edgeType !== 'contains') {
        const dx = tx - sx, dy = ty - sy
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const targetR = (target as FGNodeObj & FGNode).__radius ?? 6
        // Position arrowhead at edge of target node
        const ax = tx - (dx / len) * (targetR + 2)
        const ay = ty - (dy / len) * (targetR + 2)
        const angle = Math.atan2(dy, dx)
        const arrowSize = Math.max(4, 6 / globalScale)

        ctx.fillStyle = color
        ctx.globalAlpha = 0.6
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(
          ax - arrowSize * Math.cos(angle - Math.PI / 6),
          ay - arrowSize * Math.sin(angle - Math.PI / 6),
        )
        ctx.lineTo(
          ax - arrowSize * Math.cos(angle + Math.PI / 6),
          ay - arrowSize * Math.sin(angle + Math.PI / 6),
        )
        ctx.closePath()
        ctx.fill()
      }

      ctx.restore()
    }, [shownEdgeKeys])

    // ── Hull overlay (drawn on post-render) ──
    const onRenderFramePost = useCallback((ctx: CanvasRenderingContext2D, _globalScale: number) => {
      // Draw convex hull outlines for clusters with 4+ nodes
      for (const [clusterName, nodeIds] of clusterGroups.entries()) {
        if (nodeIds.length < 4) continue
        const points: [number, number][] = []
        for (const id of nodeIds) {
          const n = graphData.nodes.find(n => n.id === id) as FGNodeObj | undefined
          if (n?.x != null && n?.y != null) points.push([n.x, n.y])
        }
        const hull = computeHull(points, 12)
        if (!hull || hull.length < 3) continue

        ctx.save()
        ctx.strokeStyle = EMBRY.accent
        ctx.globalAlpha = 0.25
        ctx.lineWidth = 1
        ctx.setLineDash([6, 3])
        ctx.beginPath()
        ctx.moveTo(hull[0][0], hull[0][1])
        for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i][0], hull[i][1])
        ctx.closePath()
        ctx.stroke()
        ctx.setLineDash([])

        // Hull label
        const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length
        const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length
        ctx.font = 'bold 10px JetBrains Mono, monospace'
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        ctx.strokeStyle = EMBRY.bgDeep
        ctx.lineWidth = 3
        ctx.lineJoin = 'round'
        ctx.globalAlpha = 0.75
        ctx.strokeText(clusterName, cx, cy)
        ctx.fillStyle = EMBRY.white
        ctx.fillText(clusterName, cx, cy)
        ctx.restore()
      }
    }, [clusterGroups, graphData.nodes])

    // ── Node pointer area (hit target — minimum 20px) ──
    const nodePointerAreaPaint = useCallback((node: FGNodeObj, paintColor: string, ctx: CanvasRenderingContext2D) => {
      const n = node as FGNodeObj & FGNode
      if (n.x == null || n.y == null) return
      const r = Math.max(20, (n.__radius ?? 6) + 10)
      ctx.fillStyle = paintColor
      ctx.beginPath()
      ctx.arc(n.x, n.y, r, 0, 2 * Math.PI)
      ctx.fill()
    }, [])

    // ── Event handlers ──
    const handleNodeClick = useCallback((node: FGNodeObj) => {
      const n = node as FGNodeObj & FGNode
      const original = nodes.find(nd => nd.id === n.id)
      if (original && onNodeClick) onNodeClick(original)
    }, [nodes, onNodeClick])

    const handleNodeHover = useCallback((node: FGNodeObj | null) => {
      if (!onNodeHover) return
      if (!node) { onNodeHover(null); return }
      const n = node as FGNodeObj & FGNode
      const original = nodes.find(nd => nd.id === n.id)
      onNodeHover(original ?? null)
    }, [nodes, onNodeHover])

    const handleNodeRightClick = useCallback((node: FGNodeObj, event: MouseEvent) => {
      event.preventDefault()
      if (!onContextMenu) return
      const n = node as FGNodeObj & FGNode
      const original = nodes.find(nd => nd.id === n.id)
      if (original) onContextMenu(original, event.clientX, event.clientY)
    }, [nodes, onContextMenu])

    const handleBackgroundClick = useCallback(() => {
      // Deselect on background click
      if (selectedRef.current && onNodeClick) {
        // Notify parent of deselection by passing the currently selected node
        // Parent should handle toggling selection off
      }
    }, [onNodeClick])

    // Double-click to fit
    const handleBackgroundDblClick = useCallback(() => {
      fgRef.current?.zoomToFit(750, 80)
    }, [])

    return (
      <div style={{ padding: 0, overflow: 'hidden', flex: '1 1 0%', minHeight: 0, display: 'flex', flexDirection: 'column', borderRadius: 0 }}>
        {/* Legend */}
        <div style={{
          padding: '6px 12px', borderBottom: `1px solid ${EMBRY.border}`,
          display: 'flex', gap: 12, fontSize: 9, alignItems: 'center', color: EMBRY.dim, flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            {Object.entries(NODE_TYPE_COLORS).filter(([k]) => k !== 'parameter').map(([type, color]) => (
              <span key={type} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                <span style={{ width: 6, height: 6, backgroundColor: color, display: 'inline-block', borderRadius: '50%' }} />
                {type.replace('_', ' ')}
              </span>
            ))}
          </div>
          <span style={{ marginLeft: 'auto', color: EMBRY.muted }}>
            {nodes.length} nodes · WebGL
          </span>
        </div>

        {/* Canvas Container */}
        <div
          ref={containerRef}
          style={{ backgroundColor: EMBRY.bgDeep, position: 'relative', overflow: 'hidden', flex: '1 1 0%', minHeight: 0 }}
          onDoubleClick={handleBackgroundDblClick}
        >
          <ForceGraph2D
            ref={fgRef as any}
            graphData={graphData as any}
            width={dimensions.width}
            height={dimensions.height}
            backgroundColor={EMBRY.bgDeep}
            nodeId="id"
            linkSource="source"
            linkTarget="target"
            // Node rendering
            nodeRelSize={20}
            nodeCanvasObjectMode={() => 'replace'}
            nodeCanvasObject={nodeCanvasObject}
            nodePointerAreaPaint={nodePointerAreaPaint}
            // Link rendering
            linkCanvasObjectMode={() => 'replace'}
            linkCanvasObject={linkCanvasObject}
            // Force engine
            warmupTicks={500}
            cooldownTicks={200}
            d3AlphaDecay={0.008}
            d3AlphaMin={0.0005}
            d3VelocityDecay={0.4}
            onEngineTick={undefined}
            onEngineStop={handleEngineStop}
            // Zoom
            minZoom={0.2}
            maxZoom={5}
            // Interaction
            onNodeClick={handleNodeClick}
            onNodeRightClick={handleNodeRightClick}
            onNodeHover={handleNodeHover}
            onBackgroundClick={handleBackgroundClick}
            enableNodeDrag={true}
            enableZoomInteraction={true}
            enablePanInteraction={true}
            // Canvas overlay for hulls
            onRenderFramePost={onRenderFramePost}
          />
        </div>
      </div>
    )
  },
)

// Helper: get d3-force functions for layout modes
function await_d3_forces() {
  // d3-force is already imported at the top
  return { forceY: d3Force.forceY, forceX: d3Force.forceX }
}

export default BinaryGraphWebGL

/**
 * ProvenanceGraph — Day 2 Compliance Cascade Visualization
 *
 * Military-grade provenance viewer for F-36 assembly plant compliance officers.
 * Synthesizes Gemini + ChatGPT architecture into production implementation.
 *
 * Key capabilities:
 * - PageRank-style iterative convergence for cycle handling
 * - Temporal decay projection ("what breaks in 90 days?")
 * - Supplier isolation simulation
 * - MRS remediation planning
 * - Hybrid Canvas/SVG rendering for 77k+ edges
 * - Fixed X swimlane with D3-force Y positioning
 */
import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react'
import type {
  ProvenanceNode,
  ProvenanceEdge,
  ProvenanceGraphProps,
  CascadeState,
  VisualState,
  ForensicsEvent,
} from './types'
import { useWeightedImpact } from './useWeightedImpact'
import { useDecayHorizon, getDecayColor, getPulseFrequency } from './useDecayHorizon'
import { useRemediationPlanner, findQuickWins } from './useRemediationPlanner'
import { useSwimlaneLayout, groupBySupplierTier, type LayoutNode } from './useSwimlaneLayout'

// ── Visual Constants ─────────────────────────────────────────────────────

const NODE_RADIUS = 12
const EDGE_WIDTH = 2
const SWIMLANE_HEADER_HEIGHT = 40

const CASCADE_COLORS: Record<CascadeState, string> = {
  'root_failure': '#dc2626',  // Red-600
  'hard_break': '#ef4444',    // Red-500
  'degraded': '#f59e0b',      // Amber-500
  'advisory': '#eab308',      // Yellow-500
  'healthy': '#22c55e',       // Green-500
  'selected': '#3b82f6',      // Blue-500
}

const EDGE_COLORS: Record<string, string> = {
  'inherits_from': '#dc2626',
  'satisfies': '#dc2626',
  'depends_on': '#dc2626',
  'partially_supports': '#f59e0b',
  'replaces_support_for': '#f59e0b',
  'maps_to': '#6b7280',
  'supersedes': '#9ca3af',
}

// ── Visual State Calculator ──────────────────────────────────────────────

function computeVisualState(
  node: ProvenanceNode,
  cascadeState: CascadeState,
  isSelected: boolean
): VisualState {
  if (isSelected) {
    return { inner: 'green', border: 'green', opacity: 1.0 }
  }

  switch (cascadeState) {
    case 'root_failure':
      return { inner: 'red', border: 'red-pulse', opacity: 1.0 }
    case 'hard_break':
      return { inner: 'red', border: 'red', opacity: 0.9 }
    case 'degraded':
      return { inner: 'amber', border: 'amber', opacity: 0.8 }
    case 'advisory':
      return { inner: 'amber', border: 'none', opacity: 0.6 }
    case 'healthy':
      return { inner: 'green', border: 'none', opacity: 1.0 }
    default:
      return { inner: 'dim', border: 'none', opacity: 0.5 }
  }
}

// ── Canvas Edge Renderer ─────────────────────────────────────────────────

function renderEdgesCanvas(
  ctx: CanvasRenderingContext2D,
  edges: { source: LayoutNode; target: LayoutNode; edge: ProvenanceEdge }[],
  cascadeStates: Map<string, CascadeState>
) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)

  edges.forEach(({ source, target, edge }) => {
    const sourceState = cascadeStates.get(source.id) ?? 'healthy'
    const targetState = cascadeStates.get(target.id) ?? 'healthy'

    // Determine edge color based on propagation type and cascade state
    let color = EDGE_COLORS[edge.type] ?? '#6b7280'
    let opacity = 0.6

    if (sourceState === 'root_failure' || sourceState === 'hard_break') {
      color = CASCADE_COLORS[sourceState]
      opacity = 0.8
    } else if (sourceState === 'degraded') {
      opacity = 0.5
    }

    ctx.beginPath()
    ctx.strokeStyle = color
    ctx.globalAlpha = opacity * edge.weight
    ctx.lineWidth = EDGE_WIDTH * (edge.exclusivity > 0.5 ? 1.5 : 1.0)

    // Draw curved edge
    const midX = (source.x + target.x) / 2
    const midY = (source.y + target.y) / 2 - 20

    ctx.moveTo(source.x, source.y)
    ctx.quadraticCurveTo(midX, midY, target.x, target.y)
    ctx.stroke()

    // Draw arrowhead
    const angle = Math.atan2(target.y - midY, target.x - midX)
    const arrowSize = 6

    ctx.beginPath()
    ctx.moveTo(target.x, target.y)
    ctx.lineTo(
      target.x - arrowSize * Math.cos(angle - Math.PI / 6),
      target.y - arrowSize * Math.sin(angle - Math.PI / 6)
    )
    ctx.lineTo(
      target.x - arrowSize * Math.cos(angle + Math.PI / 6),
      target.y - arrowSize * Math.sin(angle + Math.PI / 6)
    )
    ctx.closePath()
    ctx.fillStyle = color
    ctx.fill()
  })

  ctx.globalAlpha = 1.0
}

// ── SVG Node Component ───────────────────────────────────────────────────

interface NodeCircleProps {
  layoutNode: LayoutNode
  cascadeState: CascadeState
  isSelected: boolean
  impactScore: number
  onSelect: (node: ProvenanceNode) => void
  pulseFrequency: number
}

const NodeCircle: React.FC<NodeCircleProps> = ({
  layoutNode,
  cascadeState,
  isSelected,
  impactScore,
  onSelect,
  pulseFrequency,
}) => {
  const visual = computeVisualState(layoutNode.node, cascadeState, isSelected)
  const fillColor = CASCADE_COLORS[cascadeState] ?? '#6b7280'

  const handleClick = useCallback(() => {
    onSelect(layoutNode.node)
  }, [layoutNode.node, onSelect])

  return (
    <g data-qid="provenance-graph-provenancegraph:auto:169" data-qs-action="PROVENANCE_GRAPH_PROVENANCEGRAPH_AUTO_169"
      transform={`translate(${layoutNode.x}, ${layoutNode.y})`}
      onClick={handleClick}
      style={{ cursor: 'pointer' }}
    >
      {/* Outer glow for cascade state */}
      {visual.border !== 'none' && (
        <circle
          r={NODE_RADIUS + 4}
          fill="none"
          stroke={fillColor}
          strokeWidth={2}
          opacity={visual.border === 'red-pulse' ? 0.8 : 0.5}
          className={pulseFrequency > 0 ? 'animate-pulse' : ''}
        />
      )}

      {/* Main node circle */}
      <circle
        r={NODE_RADIUS}
        fill={fillColor}
        opacity={visual.opacity}
        stroke={isSelected ? '#3b82f6' : 'none'}
        strokeWidth={isSelected ? 3 : 0}
      />

      {/* Impact score indicator (inner ring) */}
      {impactScore > 0 && (
        <circle
          r={NODE_RADIUS * impactScore}
          fill="none"
          stroke="#000"
          strokeWidth={1}
          opacity={0.3}
        />
      )}

      {/* Node label */}
      <text
        y={NODE_RADIUS + 14}
        textAnchor="middle"
        fontSize={10}
        fill="#e5e7eb"
        className="select-none pointer-events-none"
      >
        {layoutNode.node.label.slice(0, 12)}
        {layoutNode.node.label.length > 12 && '…'}
      </text>
    </g>
  )
}

// ── Swimlane Header ──────────────────────────────────────────────────────

interface SwimlaneHeaderProps {
  label: string
  x: number
  width: number
  nodeCount: number
  affectedCount: number
}

const SwimlaneHeader: React.FC<SwimlaneHeaderProps> = ({
  label,
  x,
  width,
  nodeCount,
  affectedCount,
}) => (
  <g transform={`translate(${x}, 0)`}>
    <rect
      x={0}
      y={0}
      width={width}
      height={SWIMLANE_HEADER_HEIGHT}
      fill="#1f2937"
      stroke="#374151"
      strokeWidth={1}
    />
    <text
      x={width / 2}
      y={24}
      textAnchor="middle"
      fontSize={12}
      fontWeight={600}
      fill="#e5e7eb"
    >
      {label}
    </text>
    <text
      x={width / 2}
      y={38}
      textAnchor="middle"
      fontSize={10}
      fill={affectedCount > 0 ? '#f59e0b' : '#6b7280'}
    >
      {affectedCount > 0 ? `${affectedCount}/${nodeCount} affected` : `${nodeCount} nodes`}
    </text>
  </g>
)

// ── Control Panel ────────────────────────────────────────────────────────

interface ControlPanelProps {
  horizonDays: number
  onHorizonChange: (days: number) => void
  virtualTaints: Set<string>
  onTaintToggle: (supplierId: string) => void
  suppliers: { id: string; name: string }[]
  expandedTier: number
  onTierExpand: (tier: number) => void
}

const ControlPanel: React.FC<ControlPanelProps> = ({
  horizonDays,
  onHorizonChange,
  virtualTaints,
  onTaintToggle,
  suppliers,
  expandedTier,
  onTierExpand,
}) => (
  <div className="absolute top-4 left-4 bg-gray-800/90 rounded-lg p-4 w-64 space-y-4">
    {/* Decay Horizon Slider */}
    <div>
      <label className="text-xs text-gray-400 uppercase tracking-wider">
        Decay Horizon
      </label>
      <div className="flex items-center gap-2 mt-1">
        <input data-qid="provenance-graph-provenancegraph:auto:301" data-qs-action="PROVENANCE_GRAPH_PROVENANCEGRAPH_AUTO_301"
          type="range"
          min={0}
          max={365}
          value={horizonDays}
          onChange={e => onHorizonChange(Number(e.target.value))}
          className="flex-1"
        />
        <span className="text-sm text-gray-300 w-16">
          {horizonDays === 0 ? 'Now' : `+${horizonDays}d`}
        </span>
      </div>
    </div>

    {/* Supplier Isolation */}
    <div>
      <label className="text-xs text-gray-400 uppercase tracking-wider">
        Supplier Simulation
      </label>
      <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
        {suppliers.slice(0, 10).map(s => (
          <label key={s.id} className="flex items-center gap-2 text-sm">
            <input data-qid="provenance-graph-provenancegraph:auto:321" data-qs-action="PROVENANCE_GRAPH_PROVENANCEGRAPH_AUTO_321"
              type="checkbox"
              checked={virtualTaints.has(s.id)}
              onChange={() => onTaintToggle(s.id)}
              className="rounded border-gray-600"
            />
            <span className={virtualTaints.has(s.id) ? 'text-red-400' : 'text-gray-300'}>
              {s.name}
            </span>
          </label>
        ))}
      </div>
    </div>

    {/* Tier Expansion */}
    <div>
      <label className="text-xs text-gray-400 uppercase tracking-wider">
        Supply Chain Tier
      </label>
      <div className="flex gap-1 mt-1">
        {[1, 2, 3].map(tier => (
          <button data-qid="provenance-graph-provenancegraph:auto:341" data-qs-action="PROVENANCE_GRAPH_PROVENANCEGRAPH_AUTO_341"
            key={tier}
            onClick={() => onTierExpand(tier)}
            className={`px-3 py-1 rounded text-sm ${
              expandedTier === tier
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Tier {tier}
          </button>
        ))}
      </div>
    </div>
  </div>
)

// ── Remediation Sidebar ──────────────────────────────────────────────────

interface RemediationSidebarProps {
  actions: ReturnType<typeof useRemediationPlanner>['actions']
  onSelectNode: (nodeId: string) => void
}

const RemediationSidebar: React.FC<RemediationSidebarProps> = ({
  actions,
  onSelectNode,
}) => {
  const quickWins = findQuickWins({ actions, totalRestorable: 0, byAuthority: { direct: [], supplier_outreach: [], formal_reproof: [] } })

  return (
    <div className="absolute top-4 right-4 bg-gray-800/90 rounded-lg p-4 w-72">
      <h3 className="text-sm font-semibold text-gray-200 mb-3">
        Remediation Priority (MRS)
      </h3>

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {quickWins.map((action, i) => (
          <button data-qid="provenance-graph-provenancegraph:auto:379" data-qs-action="PROVENANCE_GRAPH_PROVENANCEGRAPH_AUTO_379"
            key={action.node_id}
            onClick={() => onSelectNode(action.node_id)}
            className="w-full text-left p-2 rounded bg-gray-700/50 hover:bg-gray-700 transition-colors"
          >
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-200 truncate flex-1">
                {i + 1}. {action.label}
              </span>
              <span className={`text-xs px-1.5 py-0.5 rounded ${
                action.authority === 'direct' ? 'bg-green-900 text-green-300' :
                action.authority === 'supplier_outreach' ? 'bg-amber-900 text-amber-300' :
                'bg-red-900 text-red-300'
              }`}>
                {action.authority.replace('_', ' ')}
              </span>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              MRS: {action.restoration_score.toFixed(1)} • {action.downstream_count} downstream
            </div>
          </button>
        ))}

        {quickWins.length === 0 && (
          <div className="text-sm text-gray-500 text-center py-4">
            No remediation actions needed
          </div>
        )}
      </div>
    </div>
  )
}

// ── Forensics Panel ──────────────────────────────────────────────────────

interface ForensicsPanelProps {
  selectedNode: ProvenanceNode | null
  events: ForensicsEvent[]
  cascadeState: CascadeState | undefined
  impactScore: number
}

const ForensicsPanel: React.FC<ForensicsPanelProps> = ({
  selectedNode,
  events,
  cascadeState,
  impactScore,
}) => {
  if (!selectedNode) return null

  const nodeEvents = events.filter(e => e.node_id === selectedNode.id)

  return (
    <div className="absolute bottom-4 left-4 right-4 bg-gray-800/95 rounded-lg p-4 max-h-48 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-200">
          {selectedNode.label}
        </h3>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs ${
            cascadeState === 'healthy' ? 'bg-green-900 text-green-300' :
            cascadeState === 'degraded' ? 'bg-amber-900 text-amber-300' :
            'bg-red-900 text-red-300'
          }`}>
            {cascadeState}
          </span>
          <span className="text-xs text-gray-400">
            Impact: {(impactScore * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 text-xs">
        <div>
          <span className="text-gray-500">Class:</span>
          <span className="text-gray-300 ml-1">{selectedNode.nodeClass}</span>
        </div>
        <div>
          <span className="text-gray-500">Framework:</span>
          <span className="text-gray-300 ml-1">{selectedNode.framework ?? 'N/A'}</span>
        </div>
        <div>
          <span className="text-gray-500">DAL:</span>
          <span className="text-gray-300 ml-1">{selectedNode.dal_level ?? 'N/A'}</span>
        </div>
      </div>

      {/* Temporal State */}
      <div className="mt-3 pt-3 border-t border-gray-700">
        <div className="grid grid-cols-4 gap-2 text-xs">
          <div>
            <span className="text-gray-500 block">Valid From</span>
            <span className="text-gray-300">
              {new Date(selectedNode.temporal.valid_from).toLocaleDateString()}
            </span>
          </div>
          <div>
            <span className="text-gray-500 block">Valid To</span>
            <span className={`${
              selectedNode.temporal.valid_to < Date.now() ? 'text-red-400' : 'text-gray-300'
            }`}>
              {new Date(selectedNode.temporal.valid_to).toLocaleDateString()}
            </span>
          </div>
          <div>
            <span className="text-gray-500 block">Assessed</span>
            <span className="text-gray-300">
              {new Date(selectedNode.temporal.assessed_at).toLocaleDateString()}
            </span>
          </div>
          <div>
            <span className="text-gray-500 block">Status</span>
            <span className={selectedNode.temporal.is_active ? 'text-green-400' : 'text-gray-500'}>
              {selectedNode.temporal.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>
      </div>

      {/* Event Timeline */}
      {nodeEvents.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          <span className="text-xs text-gray-500 uppercase tracking-wider">
            Event History
          </span>
          <div className="mt-1 space-y-1">
            {nodeEvents.slice(0, 3).map((event, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-gray-500">
                  {new Date(event.timestamp).toLocaleString()}
                </span>
                <span className={`px-1 rounded ${
                  event.event_type === 'expiration' ? 'bg-red-900/50 text-red-300' :
                  event.event_type === 'verification' ? 'bg-green-900/50 text-green-300' :
                  'bg-gray-700 text-gray-300'
                }`}>
                  {event.event_type}
                </span>
                <span className="text-gray-400 truncate flex-1">
                  {event.description}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Main Component ───────────────────────────────────────────────────────

export const ProvenanceGraph: React.FC<ProvenanceGraphProps> = ({
  nodes,
  edges,
  onNodeSelect,
  onExport,
  initialDecayHorizon = 0,
  contractConfig,
  virtualTaints: externalTaints,
  onSupplierKillSwitch,
  width = 1100,
  height = 800,
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const pickingCanvasRef = useRef<HTMLCanvasElement | null>(null)

  // State
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [horizonDays, setHorizonDays] = useState(initialDecayHorizon)
  const [internalTaints, setInternalTaints] = useState<Set<string>>(new Set())

  // Use external taints if provided, otherwise use internal state
  const virtualTaints = externalTaints ?? internalTaints
  const setVirtualTaints = onSupplierKillSwitch
    ? (fn: (prev: Set<string>) => Set<string>) => {
        const next = fn(virtualTaints)
        const added = [...next].find(id => !virtualTaints.has(id))
        const removed = [...virtualTaints].find(id => !next.has(id))
        onSupplierKillSwitch(added ?? removed ?? '')
      }
    : setInternalTaints
  const [expandedTier, setExpandedTier] = useState(1)
  const [forensicsEvents] = useState<ForensicsEvent[]>([])
  const [selectedEdge, setSelectedEdge] = useState<ProvenanceEdge | null>(null)

  // Derived state
  const rootFailures = useMemo(() => {
    const expired = new Set<string>()
    nodes.forEach(n => {
      if (n.temporal.valid_to < Date.now()) expired.add(n.id)
      if (!n.temporal.is_active) expired.add(n.id)
    })
    return expired
  }, [nodes])

  // Hooks
  const { impactMap, cascadeStates, converged } = useWeightedImpact(
    nodes,
    edges,
    rootFailures,
    virtualTaints
  )

  const decayResult = useDecayHorizon(nodes, edges, horizonDays, virtualTaints)

  const remediationPlan = useRemediationPlanner(
    nodes,
    edges,
    cascadeStates,
    impactMap
  )

  const layout = useSwimlaneLayout(nodes, edges, {
    width,
    height,
    padding: 60,
  })

  // Initialize ghost canvas for O(1) edge picking
  useEffect(() => {
    pickingCanvasRef.current = document.createElement('canvas')
    pickingCanvasRef.current.width = layout.bounds.width
    pickingCanvasRef.current.height = layout.bounds.height
  }, [layout.bounds.width, layout.bounds.height])

  // Extract supplier list for control panel
  const suppliers = useMemo(() => {
    return nodes
      .filter(n => n.nodeClass === 'supplier')
      .map(n => ({ id: n.supplier_id ?? n.id, name: n.label }))
  }, [nodes])

  // Selected node
  const selectedNode = useMemo(
    () => nodes.find(n => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  )

  // Handlers
  const handleNodeSelect = useCallback((node: ProvenanceNode) => {
    setSelectedNodeId(prev => prev === node.id ? null : node.id)
    onNodeSelect?.(node)
  }, [onNodeSelect])

  const handleTaintToggle = useCallback((supplierId: string) => {
    if (onSupplierKillSwitch) {
      onSupplierKillSwitch(supplierId)
    } else {
      setInternalTaints(prev => {
        const next = new Set(prev)
        if (next.has(supplierId)) {
          next.delete(supplierId)
        } else {
          next.add(supplierId)
        }
        return next
      })
    }
  }, [onSupplierKillSwitch])

  const handleSelectNodeById = useCallback((nodeId: string) => {
    const node = nodes.find(n => n.id === nodeId)
    if (node) {
      setSelectedNodeId(nodeId)
      onNodeSelect?.(node)
    }
  }, [nodes, onNodeSelect])

  // Render edges on visible canvas AND picking canvas
  useEffect(() => {
    const canvas = canvasRef.current
    const pickingCanvas = pickingCanvasRef.current
    if (!canvas || !pickingCanvas) return

    const ctx = canvas.getContext('2d')
    const pCtx = pickingCanvas.getContext('2d', { willReadFrequently: true })
    if (!ctx || !pCtx) return

    // Render visible edges
    renderEdgesCanvas(ctx, layout.edges, cascadeStates)

    // Render picking buffer with unique RGB-encoded IDs
    pCtx.clearRect(0, 0, pickingCanvas.width, pickingCanvas.height)
    layout.edges.forEach(({ source, target }, index) => {
      // Map index to unique RGB color
      const r = (index >> 16) & 0xFF
      const g = (index >> 8) & 0xFF
      const b = index & 0xFF

      pCtx.beginPath()
      pCtx.strokeStyle = `rgb(${r},${g},${b})`
      pCtx.lineWidth = 6 // Thicker hit-area for 44px touch targets

      const midX = (source.x + target.x) / 2
      const midY = (source.y + target.y) / 2 - 20
      pCtx.moveTo(source.x, source.y)
      pCtx.quadraticCurveTo(midX, midY, target.x, target.y)
      pCtx.stroke()
    })
  }, [layout.edges, cascadeStates])

  // O(1) edge picking via ghost canvas
  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    const pickingCanvas = pickingCanvasRef.current
    if (!canvas || !pickingCanvas) return

    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top - SWIMLANE_HEADER_HEIGHT

    const pCtx = pickingCanvas.getContext('2d')
    if (!pCtx) return

    const pixel = pCtx.getImageData(x, y, 1, 1).data
    if (pixel[3] > 0) { // Not transparent
      const edgeIndex = (pixel[0] << 16) | (pixel[1] << 8) | pixel[2]
      const edge = layout.edges[edgeIndex]?.edge
      if (edge) {
        setSelectedEdge(edge)
      }
    }
  }, [layout.edges])

  // Swimlane stats
  const swimlaneStats = useMemo(() => {
    const stats = new Map<string, { total: number; affected: number }>()
    layout.swimlanes.forEach(lane => {
      stats.set(lane.name, { total: 0, affected: 0 })
    })

    layout.nodes.forEach(n => {
      const stat = stats.get(n.swimlane)
      if (stat) {
        stat.total++
        const state = cascadeStates.get(n.id)
        if (state && state !== 'healthy' && state !== 'selected') {
          stat.affected++
        }
      }
    })

    return stats
  }, [layout.nodes, layout.swimlanes, cascadeStates])

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full bg-gray-900 overflow-hidden"
      style={{ minHeight: layout.bounds.height + SWIMLANE_HEADER_HEIGHT }}
    >
      {/* Canvas layer for edges (clickable for O(1) edge picking) */}
      <canvas data-qid="provenance-graph-provenancegraph:auto:736" data-qs-action="PROVENANCE_GRAPH_PROVENANCEGRAPH_AUTO_736"
        ref={canvasRef}
        width={layout.bounds.width}
        height={layout.bounds.height}
        className="absolute top-10 left-0 cursor-crosshair"
        onClick={handleCanvasClick}
      />

      {/* SVG layer for nodes and headers */}
      <svg
        width={layout.bounds.width}
        height={layout.bounds.height + SWIMLANE_HEADER_HEIGHT}
        className="absolute top-0 left-0"
      >
        {/* Swimlane headers */}
        {layout.swimlanes.map(lane => {
          const stat = swimlaneStats.get(lane.name)
          return (
            <SwimlaneHeader
              key={lane.name}
              label={lane.label}
              x={lane.x}
              width={lane.width}
              nodeCount={stat?.total ?? 0}
              affectedCount={stat?.affected ?? 0}
            />
          )
        })}

        {/* Swimlane dividers */}
        {layout.swimlanes.map((lane, i) => (
          <line
            key={`div-${lane.name}`}
            x1={lane.x + lane.width}
            y1={SWIMLANE_HEADER_HEIGHT}
            x2={lane.x + lane.width}
            y2={layout.bounds.height + SWIMLANE_HEADER_HEIGHT}
            stroke="#374151"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
        ))}

        {/* Nodes */}
        <g transform={`translate(0, ${SWIMLANE_HEADER_HEIGHT})`}>
          {layout.nodes.map(layoutNode => {
            const cascadeState = cascadeStates.get(layoutNode.id) ?? 'healthy'
            const impactScore = impactMap.get(layoutNode.id) ?? 0
            const pulseFrequency = getPulseFrequency(layoutNode.node.temporal.valid_to)

            return (
              <NodeCircle
                key={layoutNode.id}
                layoutNode={layoutNode}
                cascadeState={cascadeState}
                isSelected={layoutNode.id === selectedNodeId}
                impactScore={impactScore}
                onSelect={handleNodeSelect}
                pulseFrequency={pulseFrequency}
              />
            )
          })}
        </g>
      </svg>

      {/* Control Panel */}
      <ControlPanel
        horizonDays={horizonDays}
        onHorizonChange={setHorizonDays}
        virtualTaints={virtualTaints}
        onTaintToggle={handleTaintToggle}
        suppliers={suppliers}
        expandedTier={expandedTier}
        onTierExpand={setExpandedTier}
      />

      {/* Remediation Sidebar */}
      <RemediationSidebar
        actions={remediationPlan.actions}
        onSelectNode={handleSelectNodeById}
      />

      {/* Forensics Panel */}
      <ForensicsPanel
        selectedNode={selectedNode}
        events={forensicsEvents}
        cascadeState={selectedNode ? cascadeStates.get(selectedNode.id) : undefined}
        impactScore={selectedNode ? (impactMap.get(selectedNode.id) ?? 0) : 0}
      />

      {/* Status Bar */}
      <div className="absolute bottom-0 left-0 right-0 h-8 bg-gray-800 border-t border-gray-700 flex items-center px-4 text-xs text-gray-400">
        <span>
          Nodes: {nodes.length} • Edges: {edges.length}
        </span>
        <span className="mx-4">|</span>
        <span className={converged ? 'text-green-400' : 'text-amber-400'}>
          Cascade: {converged ? 'Converged' : 'Computing...'}
        </span>
        <span className="mx-4">|</span>
        <span>
          Horizon: +{horizonDays}d ({decayResult.expiringCount} expiring, {decayResult.rippleCount} ripple)
        </span>
        {decayResult.criticalNodes.length > 0 && (
          <>
            <span className="mx-4">|</span>
            <span className="text-red-400">
              {decayResult.criticalNodes.length} critical (&lt;7d)
            </span>
          </>
        )}
      </div>
    </div>
  )
}

export default ProvenanceGraph

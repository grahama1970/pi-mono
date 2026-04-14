/**
 * NetworkGraph — D3 force-directed graph showing scillm call flows
 *
 * Visualizes: Callers (skills) → scillm → Providers
 * Uses react-force-graph-2d for Canvas rendering (performance with real-time updates)
 *
 * DESIGN.md equivalent:
 * | Dimension      | Visual Channel | Scale    | Justification                    |
 * |----------------|----------------|----------|----------------------------------|
 * | Node Type      | Color          | Nominal  | Caller=blue, Hub=green, Provider=amber |
 * | Call Volume    | Node Size      | Log      | Prevents large nodes dominating  |
 * | Error Rate     | Link Color     | Diverging| Green=ok, Red=errors             |
 * | Active Calls   | Animation      | Binary   | Pulse effect for in-flight       |
 */
import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import ForceGraph2D from 'react-force-graph-2d';
import type { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d';
import { EMBRY } from '../common/EmbryStyle';
import type { LogEntry, SkillUsage } from '../../hooks/useScillmData';

// Node types for the flow graph
type NodeType = 'caller' | 'hub' | 'provider';

interface GraphNode {
  id: string;
  label: string;
  nodeType: NodeType;
  calls: number;
  errors: number;
  // Computed
  __radius: number;
  __color: string;
}

interface GraphLink {
  source: string;
  target: string;
  calls: number;
  errors: number;
  errorRate: number;
}

type FGNodeObj = NodeObject<GraphNode>;
type FGLinkObj = LinkObject<GraphNode, GraphLink>;

// Colors by node type
const NODE_COLORS: Record<NodeType, string> = {
  caller: EMBRY.blue,    // Skills calling scillm
  hub: EMBRY.green,      // scillm proxy
  provider: EMBRY.amber, // Backend providers
};

// Provider display names
const PROVIDER_LABELS: Record<string, string> = {
  chutes: 'Chutes',
  google: 'Google',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  moonshot: 'Moonshot',
  zhipu: 'ZhiPu',
  unknown: 'Unknown',
};

function nodeRadius(calls: number): number {
  // Log scale: base 6px, grows with log of calls
  return Math.min(24, 6 + Math.log10(calls + 1) * 4);
}

interface Props {
  logs: LogEntry[];
  skills: SkillUsage[];
  activeCalls?: { call_id: string; caller: string; provider: string }[];
}

export function NetworkGraph({ logs, skills, activeCalls = [] }: Props) {
  const fgRef = useRef<ForceGraphMethods<FGNodeObj, FGLinkObj>>();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 400, height: 300 });
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);

  // Build graph data from logs
  const { nodes, links } = useMemo(() => {
    // Aggregate by caller and provider
    const callerStats = new Map<string, { calls: number; errors: number }>();
    const providerStats = new Map<string, { calls: number; errors: number }>();
    const flowStats = new Map<string, { calls: number; errors: number }>();

    for (const log of logs) {
      const caller = log.caller || 'unknown';
      const provider = log.provider || 'unknown';
      const isError = log.status === 'error';

      // Caller stats
      if (!callerStats.has(caller)) callerStats.set(caller, { calls: 0, errors: 0 });
      const cs = callerStats.get(caller)!;
      cs.calls++;
      if (isError) cs.errors++;

      // Provider stats
      if (!providerStats.has(provider)) providerStats.set(provider, { calls: 0, errors: 0 });
      const ps = providerStats.get(provider)!;
      ps.calls++;
      if (isError) ps.errors++;

      // Flow: caller → provider
      const flowKey = `${caller}→${provider}`;
      if (!flowStats.has(flowKey)) flowStats.set(flowKey, { calls: 0, errors: 0 });
      const fs = flowStats.get(flowKey)!;
      fs.calls++;
      if (isError) fs.errors++;
    }

    // Build nodes
    const graphNodes: GraphNode[] = [];

    // Caller nodes
    for (const [caller, stats] of callerStats) {
      const r = nodeRadius(stats.calls);
      graphNodes.push({
        id: `caller:${caller}`,
        label: caller,
        nodeType: 'caller',
        calls: stats.calls,
        errors: stats.errors,
        __radius: r,
        __color: NODE_COLORS.caller,
      });
    }

    // Hub node (scillm)
    const totalCalls = logs.length;
    const totalErrors = logs.filter(l => l.status === 'error').length;
    graphNodes.push({
      id: 'hub:scillm',
      label: 'scillm',
      nodeType: 'hub',
      calls: totalCalls,
      errors: totalErrors,
      __radius: Math.min(32, 12 + Math.log10(totalCalls + 1) * 5),
      __color: NODE_COLORS.hub,
    });

    // Provider nodes
    for (const [provider, stats] of providerStats) {
      const r = nodeRadius(stats.calls);
      graphNodes.push({
        id: `provider:${provider}`,
        label: PROVIDER_LABELS[provider] || provider,
        nodeType: 'provider',
        calls: stats.calls,
        errors: stats.errors,
        __radius: r,
        __color: NODE_COLORS.provider,
      });
    }

    // Build links (caller → hub, hub → provider)
    const graphLinks: GraphLink[] = [];

    // Caller → Hub links
    for (const [caller, stats] of callerStats) {
      graphLinks.push({
        source: `caller:${caller}`,
        target: 'hub:scillm',
        calls: stats.calls,
        errors: stats.errors,
        errorRate: stats.errors / stats.calls,
      });
    }

    // Hub → Provider links
    for (const [provider, stats] of providerStats) {
      graphLinks.push({
        source: 'hub:scillm',
        target: `provider:${provider}`,
        calls: stats.calls,
        errors: stats.errors,
        errorRate: stats.errors / stats.calls,
      });
    }

    return { nodes: graphNodes, links: graphLinks };
  }, [logs]);

  // Track active call animations
  const activeNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const call of activeCalls) {
      ids.add(`caller:${call.caller}`);
      ids.add('hub:scillm');
      ids.add(`provider:${call.provider}`);
    }
    return ids;
  }, [activeCalls]);

  // ResizeObserver for responsive sizing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      if (width > 0 && height > 0) {
        setDimensions({ width, height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Configure forces
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    // Horizontal layout: callers left, hub center, providers right
    const charge = fg.d3Force('charge');
    if (charge && 'strength' in charge) {
      (charge as any).strength(-200).distanceMax(300);
    }

    const link = fg.d3Force('link');
    if (link && 'distance' in link) {
      (link as any).distance(80).strength(0.5);
    }

    // Initial layout positions (X force to arrange by type)
    fg.d3Force('x', null); // Remove default
    fg.d3Force('y', null);
  }, [nodes.length]);

  // Initial positioning by node type
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;

    // Set initial positions based on type
    for (const node of nodes as FGNodeObj[]) {
      if (node.nodeType === 'caller') {
        node.fx = undefined;
        node.x = -dimensions.width / 4 + (Math.random() - 0.5) * 50;
        node.y = (Math.random() - 0.5) * dimensions.height * 0.6;
      } else if (node.nodeType === 'hub') {
        node.fx = 0; // Fix hub in center
        node.fy = 0;
      } else if (node.nodeType === 'provider') {
        node.fx = undefined;
        node.x = dimensions.width / 4 + (Math.random() - 0.5) * 50;
        node.y = (Math.random() - 0.5) * dimensions.height * 0.6;
      }
    }

    fg.d3ReheatSimulation();
  }, [nodes, dimensions]);

  // Node renderer
  const paintNode = useCallback((node: FGNodeObj, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const { x, y, label, __radius, __color, nodeType, calls, errors } = node;
    if (x == null || y == null) return;

    const isActive = activeNodeIds.has(node.id);
    const isHovered = hoveredNode?.id === node.id;
    const r = __radius;

    // Glow for active nodes
    if (isActive) {
      ctx.beginPath();
      ctx.arc(x, y, r + 6, 0, Math.PI * 2);
      ctx.fillStyle = `${__color}40`;
      ctx.fill();
    }

    // Main circle
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = isHovered ? __color : `${__color}cc`;
    ctx.fill();

    // Border
    ctx.strokeStyle = isHovered ? EMBRY.white : __color;
    ctx.lineWidth = isHovered ? 2 : 1;
    ctx.stroke();

    // Error indicator (red arc)
    if (errors > 0 && calls > 0) {
      const errorAngle = (errors / calls) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(x, y, r + 2, -Math.PI / 2, -Math.PI / 2 + errorAngle);
      ctx.strokeStyle = EMBRY.red;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Label (only at sufficient zoom)
    if (globalScale > 0.6 || isHovered) {
      const fontSize = Math.max(8, 10 / globalScale);
      ctx.font = `${isHovered ? 'bold ' : ''}${fontSize}px "JetBrains Mono", monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = EMBRY.white;
      ctx.fillText(label, x, y + r + 4);
    }
  }, [activeNodeIds, hoveredNode]);

  // Link renderer
  const paintLink = useCallback((link: FGLinkObj, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const source = link.source as FGNodeObj;
    const target = link.target as FGNodeObj;
    if (!source.x || !source.y || !target.x || !target.y) return;

    const { calls, errorRate } = link;
    const width = Math.max(0.5, Math.min(4, Math.log10(calls + 1) * 1.5));

    // Color based on error rate
    const color = errorRate > 0.2 ? EMBRY.red : errorRate > 0.05 ? EMBRY.amber : `${EMBRY.dim}80`;

    ctx.beginPath();
    ctx.moveTo(source.x, source.y);
    ctx.lineTo(target.x, target.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();

    // Arrow head
    const angle = Math.atan2(target.y - source.y, target.x - source.x);
    const targetR = (target as any).__radius || 10;
    const arrowX = target.x - Math.cos(angle) * (targetR + 4);
    const arrowY = target.y - Math.sin(angle) * (targetR + 4);
    const arrowSize = Math.max(3, width * 2);

    ctx.beginPath();
    ctx.moveTo(arrowX, arrowY);
    ctx.lineTo(
      arrowX - arrowSize * Math.cos(angle - Math.PI / 6),
      arrowY - arrowSize * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      arrowX - arrowSize * Math.cos(angle + Math.PI / 6),
      arrowY - arrowSize * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }, []);

  // Tooltip on hover
  const handleNodeHover = useCallback((node: FGNodeObj | null) => {
    setHoveredNode(node as GraphNode | null);
  }, []);

  if (nodes.length === 0) {
    return (
      <div
        style={{
          height: 300,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: EMBRY.dim,
          fontSize: 12,
          fontFamily: 'monospace',
        }}
      >
        No call data available
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: 300,
        position: 'relative',
        backgroundColor: EMBRY.bgDeep,
        border: `1px solid ${EMBRY.border}`,
        overflow: 'hidden',
      }}
    >
      <ForceGraph2D
        ref={fgRef}
        width={dimensions.width}
        height={dimensions.height}
        graphData={{ nodes, links }}
        nodeId="id"
        nodeCanvasObject={paintNode}
        nodePointerAreaPaint={(node, color, ctx) => {
          const r = (node as FGNodeObj).__radius || 10;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, r + 4, 0, Math.PI * 2);
          ctx.fill();
        }}
        linkCanvasObject={paintLink}
        linkDirectionalArrowLength={0} // Custom arrows in paintLink
        onNodeHover={handleNodeHover}
        cooldownTicks={100}
        d3AlphaDecay={0.02}
        d3VelocityDecay={0.3}
        enableNodeDrag={true}
        enableZoomPanInteraction={true}
        minZoom={0.3}
        maxZoom={4}
      />

      {/* Legend */}
      <div
        style={{
          position: 'absolute',
          top: 8,
          left: 8,
          display: 'flex',
          gap: 12,
          padding: '4px 8px',
          backgroundColor: `${EMBRY.bgPanel}dd`,
          borderRadius: 0,
          fontSize: 9,
          fontFamily: 'monospace',
          color: EMBRY.dim,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: NODE_COLORS.caller }} />
          Callers
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: NODE_COLORS.hub }} />
          scillm
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: NODE_COLORS.provider }} />
          Providers
        </span>
      </div>

      {/* Tooltip */}
      {hoveredNode && (
        <div
          style={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            padding: '8px 12px',
            backgroundColor: EMBRY.bgCard,
            border: `1px solid ${EMBRY.border}`,
            borderRadius: 0,
            fontSize: 11,
            fontFamily: 'monospace',
            color: EMBRY.white,
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{hoveredNode.label}</div>
          <div style={{ color: EMBRY.dim }}>
            Calls: {hoveredNode.calls} | Errors: {hoveredNode.errors}
            {hoveredNode.errors > 0 && (
              <span style={{ color: EMBRY.red, marginLeft: 8 }}>
                ({((hoveredNode.errors / hoveredNode.calls) * 100).toFixed(1)}% error rate)
              </span>
            )}
          </div>
        </div>
      )}

      {/* Active calls indicator */}
      {activeCalls.length > 0 && (
        <div
          style={{
            position: 'absolute',
            top: 8,
            right: 8,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '4px 10px',
            backgroundColor: `${EMBRY.green}20`,
            border: `1px solid ${EMBRY.green}40`,
            borderRadius: 0,
            fontSize: 10,
            fontFamily: 'monospace',
            color: EMBRY.green,
          }}
        >
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              backgroundColor: EMBRY.green,
              animation: 'pulse 1s infinite',
            }}
          />
          {activeCalls.length} active
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
        }
      `}</style>
    </div>
  );
}

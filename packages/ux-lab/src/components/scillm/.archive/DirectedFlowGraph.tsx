/**
 * DirectedFlowGraph — 3-column flow visualization for scillm
 *
 * Layout: Callers → scillm Hub → Providers
 * - Active flows have animated "marching ants" effect
 * - Path thickness = call volume
 * - Latency tags show current response time
 */
import { useMemo, useRef, useEffect, useState } from 'react';
import { EMBRY } from '../common/EmbryStyle';
import type { LogEntry, SkillUsage } from '../../hooks/useScillmData';

interface Props {
  logs: LogEntry[];
  skills: SkillUsage[];
  activeCalls?: ActiveCall[];
}

interface ActiveCall {
  call_id: string;
  caller: string;
  provider: string;
  elapsed_ms: number;
}

// Node positioning
const COLUMN_X = { caller: 100, hub: 300, provider: 500 };
const NODE_HEIGHT = 60;
const NODE_GAP = 16;
const NODE_WIDTH = 160;

interface NodePos {
  id: string;
  x: number;
  y: number;
  label: string;
  type: 'caller' | 'hub' | 'provider';
  calls: number;
  errors: number;
  latencyMs?: number;
  isActive: boolean;
}

export function DirectedFlowGraph({ logs, skills, activeCalls = [] }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 600, height: 400 });

  // Observe container size
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

  // Build node positions
  const { callerNodes, providerNodes, hubNode, paths } = useMemo(() => {
    // Aggregate stats
    const callerStats = new Map<string, { calls: number; errors: number; latency: number[] }>();
    const providerStats = new Map<string, { calls: number; errors: number; latency: number[] }>();

    for (const log of logs) {
      const caller = log.caller || 'unknown';
      const provider = log.provider || 'unknown';

      if (!callerStats.has(caller)) callerStats.set(caller, { calls: 0, errors: 0, latency: [] });
      const cs = callerStats.get(caller)!;
      cs.calls++;
      if (log.status === 'error') cs.errors++;
      if (log.duration_ms) cs.latency.push(log.duration_ms);

      if (!providerStats.has(provider)) providerStats.set(provider, { calls: 0, errors: 0, latency: [] });
      const ps = providerStats.get(provider)!;
      ps.calls++;
      if (log.status === 'error') ps.errors++;
      if (log.duration_ms) ps.latency.push(log.duration_ms);
    }

    // Active call lookup
    const activeCallers = new Set(activeCalls.map(c => c.caller));
    const activeProviders = new Set(activeCalls.map(c => c.provider));

    // Top N callers
    const topCallers = Array.from(callerStats.entries())
      .sort((a, b) => b[1].calls - a[1].calls)
      .slice(0, 5);

    // Top N providers
    const topProviders = Array.from(providerStats.entries())
      .sort((a, b) => b[1].calls - a[1].calls)
      .slice(0, 5);

    // Calculate vertical positions
    const callerStartY = 40;
    const providerStartY = 40;
    const hubY = dimensions.height / 2 - NODE_HEIGHT / 2;

    // Scale X positions to container width
    const xScale = dimensions.width / 600;
    const callerX = 20;
    const hubX = dimensions.width / 2 - NODE_WIDTH / 2;
    const providerX = dimensions.width - NODE_WIDTH - 20;

    const callerNodes: NodePos[] = topCallers.map(([name, stats], i) => {
      const avgLatency = stats.latency.length > 0
        ? Math.round(stats.latency.reduce((a, b) => a + b, 0) / stats.latency.length)
        : undefined;
      return {
        id: `caller:${name}`,
        x: callerX,
        y: callerStartY + i * (NODE_HEIGHT + NODE_GAP),
        label: name,
        type: 'caller' as const,
        calls: stats.calls,
        errors: stats.errors,
        latencyMs: avgLatency,
        isActive: activeCallers.has(name),
      };
    });

    const providerNodes: NodePos[] = topProviders.map(([name, stats], i) => {
      const avgLatency = stats.latency.length > 0
        ? Math.round(stats.latency.reduce((a, b) => a + b, 0) / stats.latency.length)
        : undefined;
      return {
        id: `provider:${name}`,
        x: providerX,
        y: providerStartY + i * (NODE_HEIGHT + NODE_GAP),
        label: name,
        type: 'provider' as const,
        calls: stats.calls,
        errors: stats.errors,
        latencyMs: avgLatency,
        isActive: activeProviders.has(name),
      };
    });

    const totalCalls = logs.length;
    const totalErrors = logs.filter(l => l.status === 'error').length;
    const hubNode: NodePos = {
      id: 'hub:scillm',
      x: hubX,
      y: hubY,
      label: 'scillm',
      type: 'hub',
      calls: totalCalls,
      errors: totalErrors,
      isActive: activeCalls.length > 0,
    };

    // Build paths
    const paths: { from: NodePos; to: NodePos; isActive: boolean; volume: number }[] = [];

    // Caller → Hub
    for (const caller of callerNodes) {
      const isActive = activeCallers.has(caller.label);
      paths.push({
        from: caller,
        to: hubNode,
        isActive,
        volume: caller.calls,
      });
    }

    // Hub → Provider
    for (const provider of providerNodes) {
      const isActive = activeProviders.has(provider.label);
      paths.push({
        from: hubNode,
        to: provider,
        isActive,
        volume: provider.calls,
      });
    }

    return { callerNodes, providerNodes, hubNode, paths };
  }, [logs, activeCalls, dimensions]);

  // Max volume for stroke scaling
  const maxVolume = Math.max(...paths.map(p => p.volume), 1);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: 320,
        position: 'relative',
        backgroundColor: EMBRY.bgDeep,
        border: `1px solid ${EMBRY.border}`,
        overflow: 'hidden',
      }}
    >
      {/* SVG paths layer */}
      <svg
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
        }}
      >
        <defs>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {paths.map((path, i) => {
          const fromX = path.from.x + NODE_WIDTH;
          const fromY = path.from.y + NODE_HEIGHT / 2;
          const toX = path.to.x;
          const toY = path.to.y + NODE_HEIGHT / 2;

          // Bezier control points for curved path
          const midX = (fromX + toX) / 2;
          const d = `M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`;

          const strokeWidth = 1 + (path.volume / maxVolume) * 3;
          const baseColor = path.isActive ? EMBRY.green : `${EMBRY.dim}60`;

          return (
            <g key={i}>
              {/* Background path */}
              <path
                d={d}
                fill="none"
                stroke={`${EMBRY.dim}30`}
                strokeWidth={strokeWidth + 2}
              />
              {/* Main path */}
              <path
                d={d}
                fill="none"
                stroke={baseColor}
                strokeWidth={strokeWidth}
                strokeDasharray={path.isActive ? '10,5' : 'none'}
                filter={path.isActive ? 'url(#glow)' : 'none'}
                style={{
                  animation: path.isActive ? 'flowMove 1s linear infinite' : 'none',
                }}
              />
            </g>
          );
        })}
      </svg>

      {/* Nodes */}
      {callerNodes.map(node => (
        <FlowNode key={node.id} node={node} color={EMBRY.blue} />
      ))}

      <FlowNode node={hubNode} color={EMBRY.green} isHub />

      {providerNodes.map(node => (
        <FlowNode key={node.id} node={node} color={EMBRY.amber} />
      ))}

      {/* CSS Animation */}
      <style>{`
        @keyframes flowMove {
          from { stroke-dashoffset: 15; }
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
}

function FlowNode({
  node,
  color,
  isHub = false,
}: {
  node: NodePos;
  color: string;
  isHub?: boolean;
}) {
  const borderStyle = node.isActive
    ? `2px solid ${EMBRY.green}`
    : `1px solid ${EMBRY.border}`;

  const glowStyle = node.isActive
    ? `0 0 12px ${EMBRY.green}40`
    : 'none';

  return (
    <div
      style={{
        position: 'absolute',
        left: node.x,
        top: node.y,
        width: NODE_WIDTH,
        height: isHub ? 80 : NODE_HEIGHT,
        backgroundColor: EMBRY.bgCard,
        border: borderStyle,
        borderTop: isHub ? `3px solid ${color}` : `3px solid ${color}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: glowStyle,
        transition: 'box-shadow 0.3s, border 0.3s',
      }}
    >
      {/* Type label */}
      <span
        style={{
          fontSize: 9,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          color: EMBRY.dim,
          marginBottom: 2,
        }}
      >
        {node.type === 'caller' ? 'Caller' : node.type === 'hub' ? 'Hub' : 'Provider'}
      </span>

      {/* Name */}
      <span
        style={{
          fontSize: isHub ? 16 : 12,
          fontWeight: 700,
          color: EMBRY.white,
          maxWidth: NODE_WIDTH - 16,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={node.label}
      >
        {node.label}
      </span>

      {/* Stats */}
      {!isHub && node.latencyMs && (
        <span
          style={{
            fontSize: 9,
            marginTop: 4,
            padding: '2px 6px',
            backgroundColor: `${EMBRY.green}20`,
            color: EMBRY.green,
          }}
        >
          {node.latencyMs}ms
        </span>
      )}

      {isHub && (
        <span style={{ fontSize: 10, color: EMBRY.dim, marginTop: 4 }}>
          {node.calls} calls
        </span>
      )}

      {/* Active indicator */}
      {node.isActive && (
        <span
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            width: 6,
            height: 6,
            backgroundColor: EMBRY.green,
            borderRadius: '50%',
            animation: 'pulse 1s infinite',
          }}
        />
      )}
    </div>
  );
}

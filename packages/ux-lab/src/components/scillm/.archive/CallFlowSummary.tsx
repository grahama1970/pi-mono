/**
 * CallFlowSummary — 3-column layout showing call flow through scillm
 *
 * Replaces the force-directed NetworkGraph with a clearer visualization:
 * - Left: Top callers (skills) ranked by call volume
 * - Center: scillm hub status (throughput, errors, active calls)
 * - Right: Top providers ranked by call volume
 *
 * Each column shows: name, call count, error indicator, mini sparkline
 */
import { useMemo } from 'react';
import { EMBRY } from '../common/EmbryStyle';
import type { LogEntry, SkillUsage } from '../../hooks/useScillmData';

interface Props {
  logs: LogEntry[];
  skills: SkillUsage[];
  activeCalls?: number;
}

// Mini sparkline component (last 10 data points)
function Sparkline({ data, color, height = 16 }: { data: number[]; color: string; height?: number }) {
  if (data.length < 2) return null;

  const max = Math.max(...data, 1);
  const width = 60;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// Status badge
function StatusBadge({ errorRate }: { errorRate: number }) {
  const color = errorRate > 0.1 ? EMBRY.red : errorRate > 0.02 ? EMBRY.amber : EMBRY.green;
  const label = errorRate > 0.1 ? 'ERROR' : errorRate > 0.02 ? 'WARN' : 'OK';

  return (
    <span
      style={{
        fontSize: 8,
        fontWeight: 700,
        padding: '2px 4px',
        color,
        backgroundColor: `${color}15`,
        border: `1px solid ${color}30`,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}
    >
      {label}
    </span>
  );
}

// Caller/Provider row
function FlowRow({
  name,
  calls,
  errorRate,
  sparkData,
  color,
}: {
  name: string;
  calls: number;
  errorRate: number;
  sparkData: number[];
  color: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 0',
        borderBottom: `1px solid ${EMBRY.border}`,
      }}
    >
      <span
        style={{
          flex: 1,
          fontSize: 11,
          fontFamily: 'monospace',
          color: EMBRY.white,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={name}
      >
        {name}
      </span>
      <span
        style={{
          fontSize: 11,
          fontFamily: 'monospace',
          color: EMBRY.dim,
          minWidth: 32,
          textAlign: 'right',
        }}
      >
        {calls}
      </span>
      <StatusBadge errorRate={errorRate} />
      <Sparkline data={sparkData} color={color} />
    </div>
  );
}

// Column header
function ColumnHeader({ title, color }: { title: string; color: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 8,
        paddingBottom: 8,
        borderBottom: `1px solid ${EMBRY.border}`,
      }}
    >
      <div style={{ width: 3, height: 12, backgroundColor: color }} />
      <span
        style={{
          fontSize: 9,
          fontWeight: 900,
          textTransform: 'uppercase',
          letterSpacing: '0.15em',
          color: EMBRY.dim,
        }}
      >
        {title}
      </span>
    </div>
  );
}

export function CallFlowSummary({ logs, skills, activeCalls = 0 }: Props) {
  // Compute provider stats
  const providerStats = useMemo(() => {
    const stats = new Map<string, { calls: number; errors: number; history: number[] }>();

    // Initialize with empty history buckets
    const now = Date.now();
    const bucketMs = 60000; // 1 minute buckets
    const numBuckets = 10;

    for (const log of logs) {
      const provider = log.provider || 'unknown';
      if (!stats.has(provider)) {
        stats.set(provider, { calls: 0, errors: 0, history: new Array(numBuckets).fill(0) });
      }
      const s = stats.get(provider)!;
      s.calls++;
      if (log.status === 'error') s.errors++;

      // Add to time bucket
      const logTime = new Date(log.ts).getTime();
      const bucketIdx = Math.floor((now - logTime) / bucketMs);
      if (bucketIdx >= 0 && bucketIdx < numBuckets) {
        s.history[numBuckets - 1 - bucketIdx]++;
      }
    }

    return Array.from(stats.entries())
      .map(([name, s]) => ({
        name,
        calls: s.calls,
        errorRate: s.calls > 0 ? s.errors / s.calls : 0,
        history: s.history,
      }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 6);
  }, [logs]);

  // Compute caller stats with history
  const callerStats = useMemo(() => {
    const stats = new Map<string, { calls: number; errors: number; history: number[] }>();
    const now = Date.now();
    const bucketMs = 60000;
    const numBuckets = 10;

    for (const log of logs) {
      const caller = log.caller || 'unknown';
      if (!stats.has(caller)) {
        stats.set(caller, { calls: 0, errors: 0, history: new Array(numBuckets).fill(0) });
      }
      const s = stats.get(caller)!;
      s.calls++;
      if (log.status === 'error') s.errors++;

      const logTime = new Date(log.ts).getTime();
      const bucketIdx = Math.floor((now - logTime) / bucketMs);
      if (bucketIdx >= 0 && bucketIdx < numBuckets) {
        s.history[numBuckets - 1 - bucketIdx]++;
      }
    }

    return Array.from(stats.entries())
      .map(([name, s]) => ({
        name,
        calls: s.calls,
        errorRate: s.calls > 0 ? s.errors / s.calls : 0,
        history: s.history,
      }))
      .sort((a, b) => b.calls - a.calls)
      .slice(0, 6);
  }, [logs]);

  // Hub stats
  const hubStats = useMemo(() => {
    const total = logs.length;
    const errors = logs.filter(l => l.status === 'error').length;
    const errorRate = total > 0 ? errors / total : 0;

    // Calls per minute (last 10 minutes)
    const now = Date.now();
    const history: number[] = [];
    for (let i = 9; i >= 0; i--) {
      const start = now - (i + 1) * 60000;
      const end = now - i * 60000;
      const count = logs.filter(l => {
        const t = new Date(l.ts).getTime();
        return t >= start && t < end;
      }).length;
      history.push(count);
    }

    const recentCalls = history.reduce((a, b) => a + b, 0);
    const callsPerMin = recentCalls / 10;

    return { total, errors, errorRate, callsPerMin, history };
  }, [logs]);

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr auto 1fr',
        gap: 16,
        padding: 16,
        backgroundColor: EMBRY.bgPanel,
        border: `1px solid ${EMBRY.border}`,
      }}
    >
      {/* Left: Callers */}
      <div>
        <ColumnHeader title="Top Callers" color={EMBRY.blue} />
        {callerStats.length === 0 ? (
          <div style={{ fontSize: 11, color: EMBRY.dim, padding: '12px 0' }}>
            No caller data
          </div>
        ) : (
          callerStats.map(s => (
            <FlowRow
              key={s.name}
              name={s.name}
              calls={s.calls}
              errorRate={s.errorRate}
              sparkData={s.history}
              color={EMBRY.blue}
            />
          ))
        )}
      </div>

      {/* Center: Hub */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 24px',
          borderLeft: `1px solid ${EMBRY.border}`,
          borderRight: `1px solid ${EMBRY.border}`,
          minWidth: 140,
        }}
      >
        <div
          style={{
            fontSize: 9,
            fontWeight: 900,
            textTransform: 'uppercase',
            letterSpacing: '0.15em',
            color: EMBRY.dim,
            marginBottom: 12,
          }}
        >
          scillm Hub
        </div>

        {/* Activity indicator */}
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            backgroundColor: hubStats.errorRate > 0.1 ? `${EMBRY.red}20` : `${EMBRY.green}20`,
            border: `2px solid ${hubStats.errorRate > 0.1 ? EMBRY.red : EMBRY.green}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 12,
          }}
        >
          <span
            style={{
              fontSize: 14,
              fontWeight: 700,
              fontFamily: 'monospace',
              color: hubStats.errorRate > 0.1 ? EMBRY.red : EMBRY.green,
            }}
          >
            {activeCalls > 0 ? activeCalls : hubStats.callsPerMin.toFixed(0)}
          </span>
        </div>

        <div style={{ fontSize: 10, color: EMBRY.dim, marginBottom: 4 }}>
          {activeCalls > 0 ? 'active' : 'calls/min'}
        </div>

        {/* Mini stats */}
        <div
          style={{
            display: 'flex',
            gap: 12,
            fontSize: 10,
            fontFamily: 'monospace',
          }}
        >
          <span style={{ color: EMBRY.white }}>{hubStats.total} total</span>
          {hubStats.errors > 0 && (
            <span style={{ color: EMBRY.red }}>{hubStats.errors} err</span>
          )}
        </div>

        {/* Throughput sparkline */}
        <div style={{ marginTop: 12 }}>
          <Sparkline data={hubStats.history} color={EMBRY.green} height={24} />
        </div>
      </div>

      {/* Right: Providers */}
      <div>
        <ColumnHeader title="Top Providers" color={EMBRY.amber} />
        {providerStats.length === 0 ? (
          <div style={{ fontSize: 11, color: EMBRY.dim, padding: '12px 0' }}>
            No provider data
          </div>
        ) : (
          providerStats.map(s => (
            <FlowRow
              key={s.name}
              name={s.name}
              calls={s.calls}
              errorRate={s.errorRate}
              sparkData={s.history}
              color={EMBRY.amber}
            />
          ))
        )}
      </div>
    </div>
  );
}

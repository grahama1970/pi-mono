import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle, HelpCircle, XCircle } from 'lucide-react';
import { EMBRY } from '../common/EmbryStyle';
import { GateChain, type GateStep } from '../sparta/query/GateChain';
import { RecallCard } from '../sparta/query/RecallCard';

interface EvidenceCaseData {
  verdict: string;
  grade: string;
  gates_passed: number;
  gates_total: number;
  gate_summary: string;
  control_ids: string[];
  tier: string;
  drift?: { old_verdict: string; new_verdict: string; timestamp: string };
  recall_count?: number;
  recall_breakdown?: Record<string, number>;
  source_traceability?: Record<string, number>;
}

interface ReasoningBlockProps {
  data: EvidenceCaseData;
  onNavigateToControl?: (id: string) => void;
  onNavigateToSource?: (sourceId: string) => void;
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.3,
  color: EMBRY.textMuted,
  textTransform: 'uppercase',
};

const bodyStyle: React.CSSProperties = {
  fontSize: 13,
  color: EMBRY.text,
};

function normalizeVerdict(v: string): 'satisfied' | 'inconclusive' | 'not_satisfied' {
  const n = (v || '').toLowerCase();
  if (n === 'satisfied' || n === 'allow' || n === 'pass') return 'satisfied';
  if (n === 'inconclusive' || n === 'partial' || n === 'unknown') return 'inconclusive';
  return 'not_satisfied';
}

export default function ReasoningBlock({
  data,
  onNavigateToControl,
  onNavigateToSource,
}: ReasoningBlockProps) {
  const [level, setLevel] = useState<0 | 1 | 2>(0);

  const verdictMeta = useMemo(() => {
    const v = normalizeVerdict(data.verdict || data.grade);
    if (v === 'satisfied') {
      return { icon: CheckCircle, color: EMBRY.green, label: 'SATISFIED' };
    }
    if (v === 'inconclusive') {
      return { icon: HelpCircle, color: EMBRY.amber, label: 'INCONCLUSIVE' };
    }
    return { icon: XCircle, color: EMBRY.red, label: 'NOT SATISFIED' };
  }, [data.verdict, data.grade]);

  const parsedGates: GateStep[] = useMemo(() => {
    // Prefer gate_trace array (live endpoint), fall back to gate_summary string (stored)
    if (Array.isArray(data.gate_trace) && data.gate_trace.length > 0) {
      return data.gate_trace.map((g: any) => ({
        gate: g.gate ?? g.name ?? 'Gate',
        passed: !!g.passed,
        detail: g.detail ?? '',
        duration: g.duration,
      }));
    }
    if (!data.gate_summary) return [];
    return data.gate_summary
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((chunk) => {
        const [statusRaw, ...nameParts] = chunk.split(':');
        const status = (statusRaw || '').trim().toUpperCase();
        const name = nameParts.join(':').trim() || 'Gate';
        return {
          gate: name,
          passed: status === 'PASS' || status === 'PASSED' || status === 'TRUE',
          detail: '',
        };
      });
  }, [data.gate_trace, data.gate_summary]);

  const sourceTypeCount = Object.keys(data.source_traceability || {}).length;
  const driftText = data.drift
    ? `${data.drift.old_verdict} → ${data.drift.new_verdict}`
    : 'Stable';

  const VerdictIcon = verdictMeta.icon;

  return (
    <div
      style={{
        border: `1px solid ${EMBRY.border}`,
        borderLeft: `3px solid ${EMBRY.accent}`,
        background: EMBRY.surface,
        borderRadius: 8,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <VerdictIcon size={16} color={verdictMeta.color} />
          <span style={{ ...bodyStyle, fontWeight: 700, color: verdictMeta.color }}>
            {verdictMeta.label}
          </span>
          <span style={{ ...bodyStyle, color: EMBRY.textMuted }}>
            · {data.gates_passed}/{data.gates_total} gates
          </span>

          {data.drift && (
            <div
              style={{
                background: `${EMBRY.amber}1a`,
                color: EMBRY.amber,
                padding: '2px 6px',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                marginLeft: 'auto',
                marginRight: 12,
              }}
            >
              <AlertTriangle size={12} />
              DRIFT DETECTED
            </div>
          )}

          <button
            aria-label={`Toggle reasoning detail level (currently level ${level})`}
            onClick={() => setLevel((prev) => (prev === 2 ? 0 : ((prev + 1) as 0 | 1 | 2)))}
            style={{
              marginLeft: 'auto',
              border: `1px solid ${EMBRY.border}`,
              background: EMBRY.surfaceAlt,
              color: EMBRY.text,
              padding: '4px 8px',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            Level {level}
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={labelStyle}>Gates</span>
          <span style={bodyStyle}>
            {data.gates_passed}/{data.gates_total} passed
          </span>
          {data.control_ids?.length ? (
            <>
              <span style={{ ...bodyStyle, color: EMBRY.textMuted }}>·</span>
              <span style={labelStyle}>Controls</span>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {data.control_ids.map((id) => (
                  <button
                    key={id}
                    onClick={() => onNavigateToControl?.(id)}
                    style={{
                      border: `1px solid ${EMBRY.border}`,
                      background: EMBRY.surfaceAlt,
                      color: EMBRY.text,
                      borderRadius: 12,
                      padding: '2px 8px',
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    {id}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {level >= 1 && (
        <div
          style={{
            padding: 16,
            borderTop: `1px solid ${EMBRY.border}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            background: EMBRY.surfaceAlt,
          }}
        >
          {/* Level 1: horizontal gate pills (compact) */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {parsedGates.map((g, i) => (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontSize: 10, fontFamily: 'monospace', fontWeight: 600,
                padding: '2px 8px', borderRadius: 12,
                color: g.passed ? EMBRY.green : EMBRY.red,
                background: `${g.passed ? EMBRY.green : EMBRY.red}15`,
                border: `1px solid ${g.passed ? EMBRY.green : EMBRY.red}33`,
              }}>
                {g.passed ? '\u2713' : '\u2717'} {g.gate.replace(/^step_\d+_/, '')}
              </span>
            ))}
          </div>

          {/* Level 2: full vertical GateChain (on drill) */}
          {level >= 2 && parsedGates.length > 0 && (
            <GateChain gates={parsedGates} verdict={data.verdict} tier={data.tier} />
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <div style={{ border: `1px solid ${EMBRY.border}`, borderRadius: 8, padding: 10, background: EMBRY.surface }}>
              <span style={labelStyle}>Recall Breakdown</span>
              <div style={{ ...bodyStyle, fontFamily: 'monospace', marginTop: 6 }}>
                {data.recall_count ?? 0} items
              </div>
            </div>
            <div style={{ border: `1px solid ${EMBRY.border}`, borderRadius: 8, padding: 10, background: EMBRY.surface }}>
              <span style={labelStyle}>Drift Status</span>
              <div style={{ ...bodyStyle, fontFamily: 'monospace', marginTop: 6 }}>{driftText}</div>
            </div>
            <div style={{ border: `1px solid ${EMBRY.border}`, borderRadius: 8, padding: 10, background: EMBRY.surface }}>
              <span style={labelStyle}>Source Trace</span>
              <div style={{ ...bodyStyle, fontFamily: 'monospace', marginTop: 6 }}>
                {sourceTypeCount} types
              </div>
            </div>
          </div>
        </div>
      )}

      {level >= 2 && (
        <div style={{ padding: 16, borderTop: `1px solid ${EMBRY.border}` }}>
          <RecallCard
            recallCount={data.recall_count ?? 0}
            recallBreakdown={data.recall_breakdown || {}}
            sourceTraceability={data.source_traceability || {}}
            onNavigateToSource={onNavigateToSource}
          />
        </div>
      )}
    </div>
  );
}
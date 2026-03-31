/**
 * ThinkingChain — Visual process tree for multi-step skill execution.
 * Based on Stitch design af7a6407 (NVIS_TERMINAL_V4).
 *
 * Shows agent reasoning as a connected chain of skill invocations:
 *   /memory recall → /dogpile research → /extract-controls → /scillm → /memory learn
 *
 * Dashed vertical connector line between steps.
 * Collapsible: summary line by default, expand for all steps.
 */
import { useState, memo } from 'react';
import { ChevronDown } from 'lucide-react';

export interface ThinkingStep {
  id: string;
  skill: string;
  status: 'running' | 'done' | 'failed' | 'pending';
  summary: string;
  detail?: string;
  duration?: number;
  confidence?: number;
  resultCount?: number;
}

interface Props {
  steps: ThinkingStep[];
  title?: string;
}

const STATUS = {
  done:    { color: '#00ff88', icon: '✓' },
  running: { color: '#4a9eff', icon: '●' },
  failed:  { color: '#ff4444', icon: '✗' },
  pending: { color: '#334155', icon: '○' },
} as const;

function fmtDuration(ms?: number): string {
  if (!ms) return '';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const ThinkingChain = memo(function ThinkingChain({ steps, title }: Props) {
  const [expanded, setExpanded] = useState(false);
  const doneCount = steps.filter(s => s.status === 'done').length;
  const failedCount = steps.filter(s => s.status === 'failed').length;
  const isRunning = steps.some(s => s.status === 'running');

  const summaryText = isRunning
    ? `Running ${steps.length} skills...`
    : failedCount > 0
      ? `Ran ${steps.length} skills, ${failedCount} failed`
      : `Ran ${steps.length} skills, ${doneCount} succeeded`;

  return (
    <div style={{ margin: '12px 0' }} data-qid="thinking-chain">
      {/* Summary line — Claude Desktop tool-action pattern */}
      <button
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          fontSize: 13, color: '#64748b', background: 'none', border: 'none',
          cursor: 'pointer', padding: '6px 0', fontFamily: 'var(--font-ui)', textAlign: 'left',
        }}
        data-qid="thinking-chain:toggle"
      >
        {isRunning && (
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#4a9eff', animation: 'pulse 1.2s infinite', flexShrink: 0 }} />
        )}
        <span>{title || summaryText}</span>
        <ChevronDown size={12} style={{ color: '#334155', transform: expanded ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0 }} />
      </button>

      {/* Expanded step tree */}
      {expanded && (
        <div style={{ position: 'relative', paddingLeft: 11, marginTop: 8 }}>
          {/* Dashed connector */}
          <div style={{
            position: 'absolute', left: 11, top: 12, bottom: 12, width: 1,
            background: 'repeating-linear-gradient(to bottom, #00ff88 0, #00ff88 4px, transparent 4px, transparent 8px)',
            opacity: 0.25,
          }} />
          {steps.map((step, i) => (
            <StepItem key={step.id} step={step} isLast={i === steps.length - 1} />
          ))}
        </div>
      )}
    </div>
  );
});

export default ThinkingChain;

// ── Step ────────────────────────────────────────────────────────────────────

const StepItem = memo(function StepItem({ step, isLast }: { step: ThinkingStep; isLast: boolean }) {
  const [open, setOpen] = useState(false);
  const { color, icon } = STATUS[step.status];

  return (
    <div style={{ display: 'flex', gap: 12, position: 'relative', zIndex: 1, marginBottom: isLast ? 0 : 16 }}
         data-qid={`thinking-chain:step:${step.id}`}>
      <div style={{
        width: 22, height: 22, borderRadius: '50%', flexShrink: 0, marginTop: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `${color}15`, border: `1px solid ${color}30`,
        fontSize: 10, fontWeight: 700, color,
        animation: step.status === 'running' ? 'pulse 1.2s infinite' : 'none',
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 10, fontFamily: 'var(--font-mono)', fontWeight: 600,
            background: 'rgba(74,158,255,0.1)', color: '#4a9eff',
            padding: '1px 6px', borderRadius: 3, border: '1px solid rgba(74,158,255,0.2)',
            textTransform: 'uppercase', letterSpacing: -0.3,
          }}>/{step.skill}</span>
          <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'var(--font-ui)' }}>{step.summary}</span>
          {step.confidence !== undefined && (
            <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: step.confidence > 0.7 ? '#00ff88' : '#ffaa00' }}>
              {(step.confidence * 100).toFixed(0)}%
            </span>
          )}
          <span style={{ fontSize: 9, fontFamily: 'var(--font-mono)', color: '#334155', marginLeft: 'auto' }}>
            {fmtDuration(step.duration)}
          </span>
        </div>
        {step.detail && (
          <>
            <button onClick={() => setOpen(v => !v)}
              style={{ fontSize: 10, color: '#334155', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0', fontFamily: 'var(--font-mono)' }}
              data-qid={`thinking-chain:step:${step.id}:detail`}
            >{open ? '▾ hide' : '▸ detail'}</button>
            {open && (
              <div style={{
                fontSize: 11, fontFamily: 'var(--font-mono)', color: '#a1a1aa',
                background: 'rgba(28,27,27,0.5)', padding: '8px 10px', borderRadius: 4,
                border: '1px solid rgba(255,255,255,0.04)', marginTop: 4,
                whiteSpace: 'pre-wrap', lineHeight: 1.5,
              }}>{step.detail}</div>
            )}
          </>
        )}
      </div>
    </div>
  );
});

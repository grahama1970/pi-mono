import React, { useState, useMemo, memo } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * ReasoningChain.tsx
 * 
 * NVIS MIL-STD-3009 compliant reasoning timeline.
 * Built for Embry OS // TAC-HUD.
 */

// --- Types ---

export interface ReasoningStep {
  id: string;
  type: 'recall' | 'skill' | 'text' | 'pending';
  skill?: string;
  status: 'running' | 'done' | 'failed' | 'pending';
  summary: string;
  detail?: string;
  duration?: number;
  confidence?: number;
  recallItems?: Array<{
    problem: string;
    solution: string;
    scores: { bm25: number; graph: number; dense: number; freshness: number };
  }>;
}

interface ReasoningChainProps {
  steps: ReasoningStep[];
  chainTitle?: string;
}

// --- Constants & Styles ---

const NVIS = {
  green: 'var(--nvis-green, #00ff88)',
  red: 'var(--nvis-red, #ff4444)',
  amber: 'var(--nvis-amber, #ffaa00)',
  blue: 'var(--nvis-blue, #4a9eff)',
  accent: 'var(--nvis-accent, #7c3aed)',
  white: 'var(--nvis-text, #e2e8f0)',
  dim: 'var(--nvis-dim, #64748b)',
  muted: 'var(--nvis-muted, #334155)',
  bgCard: 'var(--nvis-bg-card, #1a1a1a)',
  bgDeep: 'var(--nvis-bg-deep, #0b1220)',
  border: 'var(--nvis-border, rgba(255, 255, 255, 0.13))',
  borderSubtle: 'var(--nvis-border-subtle, rgba(255, 255, 255, 0.06))',
};

const FONTS = {
  heading: 'var(--font-heading, "Space Grotesk", sans-serif)',
  ui: 'var(--font-ui, "Inter", sans-serif)',
  mono: 'var(--font-mono, "JetBrains Mono", monospace)',
};

const ANIM = `
@keyframes nvis-fade-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes nvis-pulse {
  0% { opacity: 1; }
  50% { opacity: 0.4; }
  100% { opacity: 1; }
}

@keyframes nvis-settle {
  0% { transform: scale(1); }
  50% { transform: scale(1.15); }
  100% { transform: scale(1); }
}
`;

// --- Sub-components ---

const ScoreBar = memo(({ label, value }: { label: string; value: number }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
    <span style={{ fontSize: 9, fontFamily: FONTS.mono, color: NVIS.dim, width: 45, textAlign: 'right' }}>{label}</span>
    <div style={{ flex: 1, height: 4, background: NVIS.bgDeep, borderRadius: 2, overflow: 'hidden', position: 'relative' }}>
      <div 
        style={{ 
          height: '100%', 
          width: `${Math.min(100, value * 100)}%`, 
          background: value > 0.8 ? NVIS.green : value > 0.5 ? NVIS.blue : NVIS.amber,
          transition: 'width 0.6s ease-out'
        }} 
      />
    </div>
    <span style={{ fontSize: 9, fontFamily: FONTS.mono, color: NVIS.white, width: 25 }}>{value.toFixed(2)}</span>
  </div>
));

const StatusDot = memo(({ status }: { status: ReasoningStep['status'] }) => {
  const isRunning = status === 'running';
  const isDone = status === 'done';
  const isFailed = status === 'failed';
  
  let color = NVIS.muted;
  let icon = '○';
  if (isDone) { color = NVIS.green; icon = '✓'; }
  if (isRunning) { color = NVIS.blue; icon = '●'; }
  if (isFailed) { color = NVIS.red; icon = '✗'; }

  return (
    <div style={{
      width: 22,
      height: 22,
      borderRadius: '50%',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 10,
      fontWeight: 700,
      color,
      background: `${color}15`,
      border: `1px solid ${color}40`,
      animation: isRunning ? 'nvis-pulse 1.2s infinite' : isDone ? 'nvis-settle 0.3s ease-out' : 'none',
      transition: 'all 0.2s ease-out',
      zIndex: 2,
      flexShrink: 0
    }}>
      {icon}
    </div>
  );
});

const StepContent = memo(({ step }: { step: ReasoningStep }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (step.type === 'text') {
    return (
      <div style={{ 
        color: NVIS.white, 
        fontSize: 15, 
        fontFamily: FONTS.ui, 
        lineHeight: 1.5,
        padding: '2px 0 12px 0'
      }}>
        {step.summary}
      </div>
    );
  }

  return (
    <div style={{ paddingBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {step.skill && (
          <span style={{
            fontSize: 10,
            fontFamily: FONTS.mono,
            fontWeight: 600,
            background: `${NVIS.blue}15`,
            color: NVIS.blue,
            padding: '2px 6px',
            borderRadius: 3,
            border: `1px solid ${NVIS.blue}30`,
            textTransform: 'uppercase'
          }}>
            /{step.skill}
          </span>
        )}
        <span style={{ fontSize: 13, color: step.status === 'pending' ? NVIS.muted : NVIS.dim, fontFamily: FONTS.ui }}>
          {step.summary}
        </span>
        {step.confidence !== undefined && (
          <span style={{ 
            fontSize: 10, 
            fontFamily: FONTS.mono, 
            color: step.confidence > 0.8 ? NVIS.green : NVIS.amber,
            background: `${step.confidence > 0.8 ? NVIS.green : NVIS.amber}10`,
            padding: '0 4px',
            borderRadius: 2
          }}>
            {(step.confidence * 100).toFixed(0)}%
          </span>
        )}
        {step.duration && (
          <span style={{ fontSize: 9, fontFamily: FONTS.mono, color: NVIS.muted, marginLeft: 'auto' }}>
            {step.duration < 1000 ? `${step.duration}ms` : `${(step.duration / 1000).toFixed(1)}s`}
          </span>
        )}
      </div>

      {(step.detail || step.recallItems) && (
        <button
          onClick={() => setIsOpen(!isOpen)}
          data-qid={`step-detail-toggle:${step.id}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'none',
            border: 'none',
            color: NVIS.muted,
            fontSize: 10,
            fontFamily: FONTS.mono,
            cursor: 'pointer',
            padding: '6px 0',
            minHeight: 32,
          }}
        >
          {isOpen ? '▾ HIDE' : '▸ DETAIL'}
        </button>
      )}

      {isOpen && (
        <div style={{
          marginTop: 4,
          padding: 12,
          background: NVIS.bgDeep,
          borderRadius: 6,
          border: `1px solid ${NVIS.borderSubtle}`,
          fontSize: 11,
          fontFamily: FONTS.mono,
          color: NVIS.white,
          animation: 'nvis-fade-in 0.2s ease-out'
        }}>
          {step.detail && <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{step.detail}</div>}
          
          {step.recallItems && step.recallItems.map((item, idx) => (
            <div key={idx} style={{ 
              marginTop: idx > 0 ? 12 : 0, 
              paddingTop: idx > 0 ? 12 : 0, 
              borderTop: idx > 0 ? `1px solid ${NVIS.borderSubtle}` : 'none' 
            }}>
              <div style={{ color: NVIS.blue, marginBottom: 4 }}>→ {item.problem}</div>
              <div style={{ color: NVIS.dim, marginBottom: 8 }}>{item.solution}</div>
              <div style={{ maxWidth: 200 }}>
                <ScoreBar label="BM25" value={item.scores.bm25} />
                <ScoreBar label="GRAPH" value={item.scores.graph} />
                <ScoreBar label="DENSE" value={item.scores.dense} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

// --- Main Component ---

const ReasoningChain = ({ steps, chainTitle }: ReasoningChainProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const stats = useMemo(() => {
    const done = steps.filter(s => s.status === 'done').length;
    const isRunning = steps.some(s => s.status === 'running');
    const lastActive = steps.findLast(s => s.status === 'done' || s.status === 'running');
    return { done, isRunning, summary: lastActive?.summary || 'Initializing...' };
  }, [steps]);

  return (
    <div 
      className="nvis-reasoning-chain"
      style={{ 
        width: '100%', 
        maxWidth: 800, 
        margin: '16px 0',
        background: NVIS.bgCard,
        border: `1px solid ${NVIS.border}`,
        borderRadius: 12,
        overflow: 'hidden'
      }}
      data-qid="reasoning-chain"
    >
      <style>{ANIM}</style>
      
      {/* Summary Header (Level 1 Collapse) */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        data-qid="reasoning-chain-summary"
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '12px 16px',
          background: 'none',
          border: 'none',
          textAlign: 'left',
          cursor: 'pointer',
          minHeight: 44,
          transition: 'background 0.2s',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
      >
        <div style={{ 
          width: 8, 
          height: 8, 
          borderRadius: '50%', 
          background: stats.isRunning ? NVIS.blue : NVIS.green,
          animation: stats.isRunning ? 'nvis-pulse 1.2s infinite' : 'none',
          boxShadow: stats.isRunning ? `0 0 8px ${NVIS.blue}` : 'none'
        }} />
        
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: NVIS.white, fontFamily: FONTS.ui }}>
            {chainTitle || (stats.isRunning ? 'Processing request...' : 'Process complete')}
          </span>
          <span style={{ fontSize: 10, color: NVIS.dim, fontFamily: FONTS.mono, textTransform: 'uppercase', marginTop: 2 }}>
            {stats.done} steps verified · {steps.length} total
          </span>
        </div>

        <ChevronDown 
          size={16} 
          style={{ 
            color: NVIS.muted, 
            transform: isExpanded ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
          }} 
        />
      </button>

      {/* Expanded Chain (Vertical Timeline) */}
      {isExpanded && (
        <div 
          style={{ 
            padding: '8px 20px 20px 20px', 
            position: 'relative',
            animation: 'nvis-fade-in 0.25s ease-out'
          }}
        >
          {/* Timeline Connector Line */}
          <div style={{
            position: 'absolute',
            left: 30,
            top: 24,
            bottom: 40,
            width: 1,
            borderLeft: `1px dashed ${NVIS.green}40`,
            zIndex: 0,
            transition: 'height 0.4s ease-in-out'
          }} />

          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {steps.map((step, idx) => (
              <div 
                key={step.id} 
                style={{ 
                  display: 'flex', 
                  gap: 16, 
                  position: 'relative',
                  animation: `nvis-fade-in 250ms ease-out ${idx * 50}ms both`
                }}
              >
                {/* Visual Marker Column */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 22 }}>
                  {step.type !== 'text' ? (
                    <StatusDot status={step.status} />
                  ) : (
                    <div style={{ width: 22 }} /> // Spacer for text alignment
                  )}
                </div>

                {/* Content Column */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <StepContent step={step} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default memo(ReasoningChain);
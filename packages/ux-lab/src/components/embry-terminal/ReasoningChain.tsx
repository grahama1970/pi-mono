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
  startedAt?: number;
  confidence?: number;
  recallItems?: Array<{
    _key?: string;
    _source?: string;
    problem: string;
    solution: string;
    scores: { bm25: number; graph: number; dense: number; freshness: number };
  }>;
  children?: ReasoningStep[];
}

interface ReasoningChainProps {
  steps: ReasoningStep[];
  chainTitle?: string;
  /** Which LLM agent ran this chain (shown as badge in header) */
  agent?: string;
  /** Session ID for audit trail */
  sessionId?: string;
  /** User who initiated this chain */
  user?: string;
}

// --- Constants & Styles ---

const NVIS = {
  green: 'var(--nvis-green, #00ff88)',
  red: 'var(--nvis-red, #ff4444)',
  amber: 'var(--nvis-amber, #ffaa00)',
  blue: 'var(--nvis-blue, #60a5fa)',
  accent: 'var(--nvis-accent, #a78bfa)',
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

const ChildSteps = memo(({ children, parentId }: { children: ReasoningStep[]; parentId: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <div style={{ marginLeft: 24, paddingTop: 4 }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        data-qid={`step-children-toggle:${parentId}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          background: 'none', border: 'none', color: NVIS.muted,
          fontSize: 10, fontFamily: FONTS.mono, cursor: 'pointer', padding: '4px 0', minHeight: 28,
        }}
      >
        {isOpen ? '▾' : '▸'} {children.length} sub-step{children.length > 1 ? 's' : ''}
      </button>
      {isOpen && (
        <div style={{ position: 'relative', borderLeft: `0.5px dashed ${NVIS.green}30`, paddingLeft: 12 }}>
          {children.map((child, idx) => (
            <div key={child.id} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0',
              animation: `nvis-fade-in 200ms ease-out ${idx * 50}ms both`,
            }}>
              <div style={{
                width: 16, height: 16, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 8, fontWeight: 700, flexShrink: 0,
                color: child.status === 'done' ? NVIS.green : child.status === 'running' ? NVIS.blue : child.status === 'failed' ? NVIS.red : NVIS.muted,
                background: `${child.status === 'done' ? NVIS.green : child.status === 'running' ? NVIS.blue : NVIS.muted}15`,
                border: `1px solid ${child.status === 'done' ? NVIS.green : child.status === 'running' ? NVIS.blue : NVIS.muted}40`,
                animation: child.status === 'running' ? 'nvis-pulse 1.2s infinite' : 'none',
              }}>
                {child.status === 'done' ? '✓' : child.status === 'running' ? '●' : child.status === 'failed' ? '✗' : '○'}
              </div>
              {child.skill && (
                <span style={{
                  fontSize: 9, fontFamily: FONTS.mono, fontWeight: 600,
                  background: `${NVIS.blue}15`, color: NVIS.blue,
                  padding: '1px 4px', borderRadius: 2, border: `1px solid ${NVIS.blue}30`,
                }}>/{child.skill}</span>
              )}
              <span style={{ fontSize: 11, color: NVIS.dim, fontFamily: FONTS.ui }}>{child.summary}</span>
              {child.duration && (
                <span style={{ fontSize: 9, fontFamily: FONTS.mono, color: NVIS.muted, marginLeft: 'auto' }}>
                  {child.duration < 1000 ? `${child.duration}ms` : `${(child.duration / 1000).toFixed(1)}s`}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
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
        {(step.duration || step.startedAt) && (
          <span style={{ fontSize: 9, fontFamily: FONTS.mono, color: NVIS.muted, marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {step.startedAt && <span title="Wall-clock start time">{new Date(step.startedAt).toLocaleTimeString()}</span>}
            {step.duration && <span>{step.duration < 1000 ? `${step.duration}ms` : `${(step.duration / 1000).toFixed(1)}s`}</span>}
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
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ color: NVIS.blue }}>→ {item.problem}</span>
                {item._key && <span style={{ fontSize: 8, color: NVIS.muted }} title={`Document key: ${item._key}${item._source ? ` (${item._source})` : ''}`}>🔗 {item._key.slice(0, 8)}</span>}
              </div>
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

      {/* Nested children (sub-steps) — collapsible independently */}
      {step.children && step.children.length > 0 && (
        <ChildSteps children={step.children} parentId={step.id} />
      )}
    </div>
  );
});

// --- Main Component ---

const ReasoningChain = ({ steps, chainTitle, agent, sessionId, user }: ReasoningChainProps) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const stats = useMemo(() => {
    const done = steps.filter(s => s.status === 'done').length;
    const isRunning = steps.some(s => s.status === 'running');
    const lastActive = steps.findLast(s => s.status === 'done' || s.status === 'running');
    const confSteps = steps.filter(s => s.confidence !== undefined);
    const avgConf = confSteps.length > 0 ? confSteps.reduce((sum, s) => sum + (s.confidence || 0), 0) / confSteps.length : null;
    const totalMs = steps.reduce((sum, s) => sum + (s.duration || 0), 0);
    return { done, isRunning, summary: lastActive?.summary || 'Initializing...', avgConf, totalMs };
  }, [steps]);

  // Agent badge element (reused in running + collapsed states)
  const agentBadge = agent ? (
    <span title={`Agent: ${agent} — LLM backend processing this chain`} style={{ fontSize: 10, fontFamily: FONTS.mono, color: NVIS.accent, marginLeft: 6, padding: '0 4px', background: `${NVIS.accent}15`, borderRadius: 3, cursor: 'help' }}>{agent}</span>
  ) : null;

  // Confidence badge element
  const confBadge = stats.avgConf !== null ? (
    <span title="Average confidence across all steps (BM25 + cosine + graph combined score)" style={{
      fontSize: 10, fontFamily: FONTS.mono, padding: '0 4px', borderRadius: 3, cursor: 'help',
      background: stats.avgConf > 0.8 ? `${NVIS.green}15` : stats.avgConf > 0.5 ? `${NVIS.amber}15` : `${NVIS.red}15`,
      color: stats.avgConf > 0.8 ? NVIS.green : stats.avgConf > 0.5 ? NVIS.amber : NVIS.red,
    }}>conf {Math.round(stats.avgConf * 100)}%</span>
  ) : null;

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
          gap: 8,
          padding: '10px 16px',
          background: 'none',
          border: 'none',
          textAlign: 'left',
          cursor: 'pointer',
          minHeight: 40,
          transition: 'background 0.2s',
        }}
        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
        onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
      >
        {stats.isRunning ? (
          // Running state: "● Thinking... · 3/6"
          <span style={{
            fontSize: 13,
            fontFamily: FONTS.ui,
            color: NVIS.dim,
            display: 'flex',
            alignItems: 'center',
            gap: 0,
            flex: 1,
          }}>
            <span style={{
              color: NVIS.blue,
              animation: 'nvis-pulse 1.2s infinite',
              marginRight: 6,
              fontSize: 10,
            }}>●</span>
            <span style={{ color: NVIS.white, fontWeight: 600 }}>
              {chainTitle || 'Thinking...'}
            </span>
            {agentBadge}
            <span style={{ color: NVIS.dim, margin: '0 4px' }}>·</span>
            <span style={{ fontSize: 11, fontFamily: FONTS.mono, color: NVIS.dim }}>
              {stats.done}/{steps.length}
            </span>
          </span>
        ) : (
          // Collapsed/done state: "▸ Thinking · claude · 6 steps · 12s · conf 91%"
          <span style={{
            fontSize: 13,
            fontFamily: FONTS.ui,
            display: 'flex',
            alignItems: 'center',
            gap: 0,
            flex: 1,
          }}>
            <span style={{ color: NVIS.muted, marginRight: 6, fontSize: 10 }}>
              {isExpanded ? '▾' : '▸'}
            </span>
            <span style={{ color: NVIS.white, fontWeight: 600 }}>
              {chainTitle || 'Thinking'}
            </span>
            {agentBadge}
            <span style={{ color: NVIS.dim, margin: '0 4px' }}>·</span>
            <span title="Tool invocations: memory recall, skill execution, LLM inference" style={{ fontSize: 11, fontFamily: FONTS.mono, color: NVIS.dim, cursor: 'help' }}>
              {stats.done} steps
            </span>
            {stats.totalMs > 0 && (
              <>
                <span style={{ color: NVIS.dim, margin: '0 4px' }}>·</span>
                <span style={{ fontSize: 11, fontFamily: FONTS.mono, color: NVIS.dim }}>
                  {stats.totalMs < 1000 ? `${stats.totalMs}ms` : `${(stats.totalMs / 1000).toFixed(1)}s`}
                </span>
              </>
            )}
            {confBadge && (
              <>
                <span style={{ color: NVIS.dim, margin: '0 4px' }}>·</span>
                {confBadge}
              </>
            )}
          </span>
        )}

        {!stats.isRunning && (
          <ChevronDown
            size={14}
            style={{
              color: NVIS.muted,
              transform: isExpanded ? 'rotate(180deg)' : 'none',
              transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
              flexShrink: 0,
            }}
          />
        )}
      </button>

      {/* Audit metadata bar — visible when expanded */}
      {isExpanded && (sessionId || user) && (
        <div style={{
          display: 'flex', gap: 12, padding: '4px 16px 6px', borderBottom: `1px solid ${NVIS.borderSubtle}`,
          fontSize: 10, fontFamily: FONTS.mono, color: NVIS.muted,
        }}>
          {user && <span title="User who initiated this chain">user: {user}</span>}
          {sessionId && <span title="Session ID for audit trail">session: {sessionId}</span>}
          <span title="Chain start time">{new Date().toISOString().slice(0, 19)}Z</span>
        </div>
      )}

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
                  animation: `nvis-fade-in 250ms ease-out ${idx * 50}ms both`,
                  borderBottom: idx < steps.length - 1 ? `1px solid ${NVIS.borderSubtle}` : 'none',
                  paddingBottom: idx < steps.length - 1 ? 4 : 0,
                  marginBottom: idx < steps.length - 1 ? 4 : 0,
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
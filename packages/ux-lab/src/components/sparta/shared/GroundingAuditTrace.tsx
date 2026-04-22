/**
 * GroundingAuditTrace — Circuit-style visualization of evidence-to-answer mappings.
 *
 * Transforms grounding_audit JSON into an interactive "logic trace" showing
 * how each answer sentence connects to source evidence quotes.
 *
 * Features:
 * - Vertical trace line with gradient (green → cyan)
 * - Staggered entry animation (CSS, no framer-motion)
 * - Grounding score indicator (green >90%, amber otherwise)
 * - SOURCE_ID badges with truncated quote preview
 * - Spectral shimmer for "analyzing" state
 * - F-36 glass cockpit node styling
 *
 * Complies with:
 * - NVIS 2026 White Phosphor palette
 * - prefers-reduced-motion support
 */
import { memo, useEffect, useState } from 'react'
import { Link2, ShieldCheck, AlertTriangle } from 'lucide-react'
import { useReducedMotion } from '../../../hooks/useReducedMotion'

const NVIS = {
  phosphor: '#e0e4e8',
  cyan: '#00d1ff',
  green: '#3fb950',
  amber: '#d29922',
  dim: '#8b949e',
  glassBg: 'rgba(18, 19, 21, 0.85)',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
  traceGradient: 'linear-gradient(180deg, #3fb950 0%, #00d1ff 100%)',
}

const STAGGER_DELAY = 120

export interface AuditStep {
  answer_sentence: string
  supported_by_quote_index: number
}

export interface EvidenceQuote {
  quote: string
  relevance?: string
}

export interface GroundingAuditTraceProps {
  audit: AuditStep[]
  quotes: EvidenceQuote[]
  groundingScore?: number
  isAnalyzing?: boolean
  onQuoteClick?: (index: number) => void
  onSentenceHover?: (index: number | null) => void
}

interface TraceStepProps {
  step: AuditStep
  index: number
  isLast: boolean
  quote?: EvidenceQuote
  scoreColor: string
  reduceMotion: boolean
  onQuoteClick?: (index: number) => void
  onSentenceHover?: (index: number | null) => void
}

const TraceStep = memo(function TraceStep({
  step,
  index,
  isLast,
  quote,
  scoreColor,
  reduceMotion,
  onQuoteClick,
  onSentenceHover,
}: TraceStepProps) {
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (reduceMotion) {
      setIsVisible(true)
      return
    }
    const timer = setTimeout(() => setIsVisible(true), index * STAGGER_DELAY)
    return () => clearTimeout(timer)
  }, [index, reduceMotion])

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        position: 'relative',
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? 'translateX(0)' : 'translateX(-10px)',
        transition: reduceMotion ? 'none' : 'opacity 300ms ease-out, transform 300ms ease-out',
      }}
      onMouseEnter={() => onSentenceHover?.(index)}
      onMouseLeave={() => onSentenceHover?.(null)}
    >
      {/* F-36 Glass Cockpit Logic Node + Trace Line */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        {/* Outer Glass Ring */}
        <div
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: 'rgba(63, 185, 80, 0.08)',
            backdropFilter: 'blur(4px)',
            WebkitBackdropFilter: 'blur(4px)',
            border: '1px solid rgba(63, 185, 80, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginTop: 2,
            zIndex: 1,
          }}
        >
          {/* Inner Core Node */}
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: `radial-gradient(circle at 30% 30%, ${NVIS.green}, #1a5f2a)`,
              boxShadow: `0 0 8px ${NVIS.green}, inset 0 1px 2px rgba(255,255,255,0.3)`,
            }}
          />
        </div>
        {!isLast && (
          <div
            style={{
              width: 1,
              height: 40,
              background: NVIS.traceGradient,
              opacity: 0.4,
            }}
          />
        )}
      </div>

      {/* Content: Sentence + Source Link */}
      <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? 0 : 16 }}>
        <p
          style={{
            fontSize: 13,
            fontWeight: 300,
            color: NVIS.phosphor,
            marginBottom: 6,
            lineHeight: 1.5,
          }}
        >
          "{step.answer_sentence}"
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button
            data-qid={`evidence:grounding:source-${step.supported_by_quote_index}`}
            data-qs-action={`VIEW_SOURCE_QUOTE_${step.supported_by_quote_index}`}
            title={`View source quote ${step.supported_by_quote_index}`}
            onClick={() => onQuoteClick?.(step.supported_by_quote_index)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '2px 8px',
              background: 'rgba(0, 209, 255, 0.1)',
              border: '1px solid rgba(0, 209, 255, 0.3)',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 10,
              fontFamily: "'SF Mono', Monaco, monospace",
              color: NVIS.cyan,
              minHeight: 44,
              minWidth: 44,
            }}
          >
            <Link2 size={10} />
            <span>Q{step.supported_by_quote_index}</span>
          </button>
          <span
            style={{
              fontSize: 10,
              fontStyle: 'italic',
              color: 'rgba(139, 148, 158, 0.7)',
              maxWidth: 280,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {quote?.quote?.substring(0, 50)}...
          </span>
        </div>
      </div>
    </div>
  )
})

export const GroundingAuditTrace = memo(function GroundingAuditTrace({
  audit,
  quotes,
  groundingScore = 98,
  isAnalyzing = false,
  onQuoteClick,
  onSentenceHover,
}: GroundingAuditTraceProps) {
  const reduceMotion = useReducedMotion()

  const scoreColor = groundingScore > 90 ? NVIS.green : NVIS.amber
  const ScoreIcon = groundingScore > 90 ? ShieldCheck : AlertTriangle
  const statusLabel = groundingScore > 90 ? 'VERIFIED' : 'REVIEW'

  return (
    <div
      data-qid="evidence:grounding:trace"
      className={isAnalyzing && !reduceMotion ? 'shimmer-active' : ''}
      style={{
        padding: 20,
        background: NVIS.glassBg,
        borderRadius: 12,
        borderLeft: `2px solid ${scoreColor}`,
        position: 'relative',
      }}
    >
      {/* Trace Header Label */}
      <div
        style={{
          position: 'absolute',
          top: -10,
          left: 8,
          fontSize: 8,
          fontFamily: "'SF Mono', Monaco, monospace",
          color: scoreColor,
          background: '#0d1117',
          padding: '0 4px',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        AUDIT_TRACE_{statusLabel}
      </div>

      {/* Header with Score */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          paddingBottom: 12,
          borderBottom: `1px solid ${NVIS.glassBorder}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ScoreIcon size={14} color={scoreColor} strokeWidth={1.5} />
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.1em',
              color: scoreColor,
              textTransform: 'uppercase',
            }}
          >
            Grounding Audit
          </span>
        </div>
        <div
          style={{
            fontSize: 11,
            fontFamily: "'SF Mono', Monaco, monospace",
            color: scoreColor,
          }}
        >
          {groundingScore}%
        </div>
      </div>

      {/* Trace Logic Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {audit.map((step, idx) => (
          <TraceStep
            key={idx}
            step={step}
            index={idx}
            isLast={idx === audit.length - 1}
            quote={quotes[step.supported_by_quote_index]}
            scoreColor={scoreColor}
            reduceMotion={reduceMotion}
            onQuoteClick={onQuoteClick}
            onSentenceHover={onSentenceHover}
          />
        ))}
      </div>

      {/* Spectral Shimmer Keyframes */}
      <style>{`
        @keyframes spectral-shimmer {
          0% { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
        .shimmer-active {
          background: linear-gradient(90deg,
            rgba(18, 19, 21, 0.85) 25%,
            rgba(0, 209, 255, 0.08) 50%,
            rgba(18, 19, 21, 0.85) 75%) !important;
          background-size: 200% 100% !important;
          animation: spectral-shimmer 3s infinite linear;
        }
      `}</style>
    </div>
  )
})

export default GroundingAuditTrace

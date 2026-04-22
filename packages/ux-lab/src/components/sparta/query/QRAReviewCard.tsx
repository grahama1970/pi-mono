/**
 * QRAReviewCard — Human-in-the-loop QRA review with grounding audit trace.
 *
 * Displays:
 * - Question / Reasoning / Answer fields
 * - Evidence quotes (collapsible)
 * - GroundingAuditTrace with circuit-style logic mapping
 * - Review actions: Bless(B), Correct(C), Skip(S), Reject(R)
 * - Correction mode with inline edit + reason field
 *
 * Complies with:
 * - NVIS 2026 White Phosphor palette
 * - COTS C02: 44px minimum touch targets
 * - prefers-reduced-motion support
 */
import { memo, useState, useCallback } from 'react'
import { Check, X, Edit3, SkipForward, ChevronDown, ChevronUp } from 'lucide-react'
import { GroundingAuditTrace, type AuditStep, type EvidenceQuote } from '../shared/GroundingAuditTrace'
import { useReducedMotion } from '../../../hooks/useReducedMotion'
import { useQRAReviewHotkeys } from '../../../hooks/useQRAReviewHotkeys'

const NVIS = {
  phosphor: '#e0e4e8',
  cyan: '#00d1ff',
  green: '#3fb950',
  amber: '#d29922',
  red: '#f85149',
  dim: '#8b949e',
  muted: '#6e7681',
  bgDeep: '#08090a',
  bgPanel: '#0d1117',
  bgCard: '#161b22',
  glassBg: 'rgba(18, 19, 21, 0.85)',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
}

export type QRAStatus = 'needs_review' | 'approved' | 'corrected' | 'rejected' | 'skipped'

export interface QRAData {
  _key: string
  question: string
  reasoning: string
  answer: string
  evidence_quotes: EvidenceQuote[]
  grounding_audit?: AuditStep[]
  grounding_score?: number
  status?: QRAStatus
  corrected_answer?: string
  correction_reason?: string
  reviewed_by?: string
  reviewed_at?: string
}

export interface QRAReviewCardProps {
  qra: QRAData
  onBless?: (key: string) => void
  onCorrect?: (key: string, correctedAnswer: string, reason: string) => void
  onSkip?: (key: string) => void
  onReject?: (key: string, reason: string) => void
  onQuoteClick?: (quoteIndex: number) => void
}

const StatusBadge = memo(function StatusBadge({ status }: { status: QRAStatus }) {
  const config: Record<QRAStatus, { label: string; color: string; icon: string }> = {
    needs_review: { label: 'Needs Review', color: NVIS.amber, icon: '⏳' },
    approved: { label: 'Approved', color: NVIS.green, icon: '✓' },
    corrected: { label: 'Corrected', color: NVIS.cyan, icon: '✏️' },
    rejected: { label: 'Rejected', color: NVIS.red, icon: '✗' },
    skipped: { label: 'Skipped', color: NVIS.dim, icon: '→' },
  }
  const { label, color, icon } = config[status]

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 10,
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.06em',
        padding: '4px 10px',
        borderRadius: 12,
        background: `${color}15`,
        color,
        border: `1px solid ${color}30`,
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </div>
  )
})

const ActionButton = memo(function ActionButton({
  variant,
  label,
  shortcut,
  icon: Icon,
  onClick,
  disabled,
}: {
  variant: 'bless' | 'correct' | 'skip' | 'reject' | 'save' | 'cancel'
  label: string
  shortcut?: string
  icon: typeof Check
  onClick: () => void
  disabled?: boolean
}) {
  const colors: Record<string, { bg: string; border: string; text: string }> = {
    bless: { bg: `${NVIS.green}15`, border: `${NVIS.green}40`, text: NVIS.green },
    correct: { bg: `${NVIS.cyan}10`, border: `${NVIS.cyan}30`, text: NVIS.cyan },
    skip: { bg: 'transparent', border: NVIS.glassBorder, text: NVIS.dim },
    reject: { bg: `${NVIS.red}10`, border: `${NVIS.red}30`, text: NVIS.red },
    save: { bg: NVIS.cyan, border: NVIS.cyan, text: NVIS.bgDeep },
    cancel: { bg: 'transparent', border: NVIS.glassBorder, text: NVIS.dim },
  }
  const c = colors[variant]

  return (
    <button
      data-qid={`qra:action:${variant}`}
      data-qs-action={`QRA_${variant.toUpperCase()}`}
      title={`${label} this QRA${shortcut ? ` (${shortcut})` : ''}`}
      onClick={onClick}
      disabled={disabled}
      style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        padding: '12px 16px',
        minHeight: 48,
        borderRadius: 8,
        fontSize: 13,
        fontWeight: 600,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.text,
        opacity: disabled ? 0.5 : 1,
        transition: 'all 0.15s',
      }}
    >
      <Icon size={16} strokeWidth={2} />
      <span>{label}</span>
      {shortcut && (
        <span
          style={{
            fontSize: 10,
            fontFamily: "'SF Mono', Monaco, monospace",
            padding: '2px 6px',
            background: 'rgba(0,0,0,0.3)',
            borderRadius: 4,
          }}
        >
          {shortcut}
        </span>
      )}
    </button>
  )
})

export const QRAReviewCard = memo(function QRAReviewCard({
  qra,
  onBless,
  onCorrect,
  onSkip,
  onReject,
  onQuoteClick,
}: QRAReviewCardProps) {
  const reduceMotion = useReducedMotion()
  const [isCorrectMode, setIsCorrectMode] = useState(false)
  const [correctedAnswer, setCorrectedAnswer] = useState(qra.answer)
  const [correctionReason, setCorrectionReason] = useState('')
  const [showEvidence, setShowEvidence] = useState(qra.evidence_quotes.length <= 2)
  const [highlightedSentence, setHighlightedSentence] = useState<number | null>(null)

  const status = qra.status ?? 'needs_review'
  const isReviewed = status !== 'needs_review'

  const handleBless = useCallback(() => {
    onBless?.(qra._key)
  }, [onBless, qra._key])

  const handleStartCorrect = useCallback(() => {
    setIsCorrectMode(true)
    setCorrectedAnswer(qra.answer)
    setCorrectionReason('')
  }, [qra.answer])

  const handleSaveCorrection = useCallback(() => {
    if (correctionReason.trim()) {
      onCorrect?.(qra._key, correctedAnswer, correctionReason)
      setIsCorrectMode(false)
    }
  }, [onCorrect, qra._key, correctedAnswer, correctionReason])

  const handleCancelCorrection = useCallback(() => {
    setIsCorrectMode(false)
    setCorrectedAnswer(qra.answer)
    setCorrectionReason('')
  }, [qra.answer])

  const handleSkip = useCallback(() => {
    onSkip?.(qra._key)
  }, [onSkip, qra._key])

  const handleReject = useCallback(() => {
    const reason = prompt('Reason for rejection:')
    if (reason) {
      onReject?.(qra._key, reason)
    }
  }, [onReject, qra._key])

  useQRAReviewHotkeys({
    enabled: true,
    isCorrectMode,
    isReviewed,
    onBless: handleBless,
    onCorrect: handleStartCorrect,
    onSkip: handleSkip,
    onReject: handleReject,
    onCancelCorrect: handleCancelCorrection,
    onSaveCorrect: handleSaveCorrection,
  })

  return (
    <div
      data-qid="qra:review:card"
      style={{
        background: NVIS.bgCard,
        border: `1px solid ${NVIS.glassBorder}`,
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          background: 'rgba(0,0,0,0.3)',
          borderBottom: `1px solid ${NVIS.glassBorder}`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 14 }}>📋</span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: NVIS.amber,
            }}
          >
            QRA Pair
          </span>
        </div>
        <StatusBadge status={status} />
      </div>

      {/* Body */}
      <div style={{ padding: 16 }}>
        {/* Question */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: NVIS.muted, marginBottom: 6 }}>
            Question
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, color: NVIS.cyan, lineHeight: 1.5 }}>
            {qra.question}
          </div>
        </div>

        {/* Reasoning */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: NVIS.muted, marginBottom: 6 }}>
            Reasoning
          </div>
          <div style={{ fontSize: 13, color: NVIS.phosphor, lineHeight: 1.6 }}>
            {qra.reasoning}
          </div>
        </div>

        {/* Answer (or Correction Mode) */}
        {isCorrectMode ? (
          <div
            style={{
              background: NVIS.bgPanel,
              border: `2px solid ${NVIS.cyan}`,
              borderRadius: 12,
              padding: 16,
              marginBottom: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 6,
                  background: `${NVIS.cyan}20`,
                  border: `1px solid ${NVIS.cyan}40`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Edit3 size={14} color={NVIS.cyan} />
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: NVIS.phosphor }}>Course Correction</div>
                <div style={{ fontSize: 11, color: NVIS.dim }}>Edit while preserving evidence grounding</div>
              </div>
            </div>

            {/* Original (struck through) */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: NVIS.dim, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                Answer
                <span style={{ fontSize: 8, padding: '2px 6px', background: `${NVIS.dim}20`, borderRadius: 4 }}>Original</span>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: NVIS.muted,
                  padding: '10px 12px',
                  background: 'rgba(0,0,0,0.3)',
                  borderRadius: 6,
                  textDecoration: 'line-through',
                  opacity: 0.6,
                }}
              >
                {qra.answer}
              </div>
            </div>

            {/* Editable correction */}
            <textarea
              data-qid="qra:correction:input"
              value={correctedAnswer}
              onChange={(e) => setCorrectedAnswer(e.target.value)}
              placeholder="Enter corrected answer..."
              style={{
                width: '100%',
                padding: '12px 14px',
                background: NVIS.bgPanel,
                border: `1px solid ${NVIS.cyan}40`,
                borderRadius: 8,
                fontSize: 13,
                color: NVIS.phosphor,
                lineHeight: 1.6,
                resize: 'vertical',
                minHeight: 80,
                fontFamily: 'inherit',
              }}
            />

            {/* Reason field */}
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: `1px solid ${NVIS.glassBorder}` }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: NVIS.cyan, marginBottom: 6 }}>
                Correction Reason (Required)
              </div>
              <input
                data-qid="qra:correction:reason"
                type="text"
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                placeholder="Why is this correction needed?"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  background: NVIS.bgPanel,
                  border: `1px solid ${NVIS.glassBorder}`,
                  borderRadius: 6,
                  fontSize: 12,
                  color: NVIS.phosphor,
                }}
              />
            </div>

            {/* Correction actions */}
            <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
              <ActionButton variant="cancel" label="Cancel" icon={X} onClick={handleCancelCorrection} />
              <ActionButton variant="save" label="Save Correction" icon={Check} onClick={handleSaveCorrection} disabled={!correctionReason.trim()} />
            </div>
          </div>
        ) : (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: NVIS.muted, marginBottom: 6 }}>
              Answer
            </div>
            <div
              style={{
                fontSize: 13,
                color: NVIS.phosphor,
                lineHeight: 1.6,
                padding: '10px 12px',
                background: 'rgba(0,0,0,0.3)',
                border: `1px solid ${NVIS.glassBorder}`,
                borderRadius: 6,
              }}
            >
              {qra.corrected_answer ?? qra.answer}
            </div>
          </div>
        )}

        {/* Evidence Quotes (Collapsible) */}
        <div style={{ marginBottom: 16, borderTop: `1px solid ${NVIS.glassBorder}`, paddingTop: 16 }}>
          <button
            data-qid="qra:evidence:toggle"
            data-qs-action="TOGGLE_EVIDENCE_QUOTES"
            title={`${showEvidence ? 'Hide' : 'Show'} evidence quotes`}
            onClick={() => setShowEvidence(!showEvidence)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              width: '100%',
              padding: 0,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontSize: 9,
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
              color: NVIS.muted,
              marginBottom: showEvidence ? 12 : 0,
              minHeight: 44,
            }}
          >
            Evidence Quotes
            <span style={{ color: NVIS.dim }}>({qra.evidence_quotes.length})</span>
            {showEvidence ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {showEvidence && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {qra.evidence_quotes.slice(0, 3).map((eq, i) => (
                <div
                  key={i}
                  data-qid={`qra:evidence:quote-${i}`}
                  data-qs-action={`VIEW_EVIDENCE_QUOTE_${i}`}
                  title={`View evidence quote ${i}: ${eq.quote.slice(0, 50)}...`}
                  onClick={() => onQuoteClick?.(i)}
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: '10px 12px',
                    background: highlightedSentence !== null && qra.grounding_audit?.some(a => a.supported_by_quote_index === i) ? `${NVIS.cyan}15` : `${NVIS.cyan}05`,
                    borderLeft: `2px solid ${NVIS.cyan}`,
                    borderRadius: '0 6px 6px 0',
                    cursor: 'pointer',
                    transition: reduceMotion ? 'none' : 'background 0.2s',
                    minHeight: 44,
                  }}
                >
                  <span style={{ fontSize: 9, fontWeight: 700, color: NVIS.cyan, fontFamily: "'SF Mono', Monaco, monospace", flexShrink: 0 }}>[{i}]</span>
                  <span style={{ fontSize: 12, color: NVIS.dim, fontStyle: 'italic', lineHeight: 1.5 }}>
                    {eq.quote}
                  </span>
                </div>
              ))}
              {qra.evidence_quotes.length > 3 && (
                <button
                  style={{
                    padding: '6px 12px',
                    background: 'transparent',
                    border: `1px dashed ${NVIS.glassBorder}`,
                    borderRadius: 6,
                    fontSize: 11,
                    color: NVIS.dim,
                    cursor: 'pointer',
                  }}
                >
                  +{qra.evidence_quotes.length - 3} more quotes
                </button>
              )}
            </div>
          )}
        </div>

        {/* Grounding Audit Trace */}
        {qra.grounding_audit && qra.grounding_audit.length > 0 && (
          <GroundingAuditTrace
            audit={qra.grounding_audit}
            quotes={qra.evidence_quotes}
            groundingScore={qra.grounding_score}
            onQuoteClick={onQuoteClick}
            onSentenceHover={setHighlightedSentence}
          />
        )}
      </div>

      {/* Review Actions */}
      {!isReviewed && !isCorrectMode && (
        <div
          style={{
            display: 'flex',
            gap: 12,
            padding: 16,
            background: NVIS.bgCard,
            borderTop: `1px solid ${NVIS.glassBorder}`,
          }}
        >
          <ActionButton variant="bless" label="Bless" shortcut="B" icon={Check} onClick={handleBless} />
          <ActionButton variant="correct" label="Correct" shortcut="C" icon={Edit3} onClick={handleStartCorrect} />
          <ActionButton variant="skip" label="Skip" shortcut="S" icon={SkipForward} onClick={handleSkip} />
          <ActionButton variant="reject" label="Reject" shortcut="R" icon={X} onClick={handleReject} />
        </div>
      )}

      {/* Reviewed Banner */}
      {isReviewed && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 16px',
            background: status === 'approved' || status === 'corrected' ? `${NVIS.green}10` : status === 'rejected' ? `${NVIS.red}10` : 'transparent',
            borderTop: `1px solid ${status === 'approved' || status === 'corrected' ? `${NVIS.green}30` : status === 'rejected' ? `${NVIS.red}30` : NVIS.glassBorder}`,
          }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: '50%',
              background: status === 'approved' || status === 'corrected' ? NVIS.green : status === 'rejected' ? NVIS.red : NVIS.dim,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: NVIS.bgDeep,
              fontSize: 12,
            }}
          >
            {status === 'approved' || status === 'corrected' ? '✓' : status === 'rejected' ? '✗' : '→'}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: status === 'approved' || status === 'corrected' ? NVIS.green : status === 'rejected' ? NVIS.red : NVIS.dim }}>
              QRA {status === 'approved' ? 'Approved' : status === 'corrected' ? 'Corrected' : status === 'rejected' ? 'Rejected' : 'Skipped'}
            </div>
            {qra.reviewed_by && (
              <div style={{ fontSize: 10, color: NVIS.dim }}>
                by {qra.reviewed_by} · {qra.reviewed_at ?? 'Just now'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
})

export default QRAReviewCard

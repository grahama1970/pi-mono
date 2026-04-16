/**
 * InlineEvidenceCase — Renders evidence case cards inline in chat.
 * Shows verdict, tier, gates passed/total, and collapsible gate trace.
 * COTS compliant: fonts >= 12px, touch targets >= 44px, data-qid on ALL elements.
 */

import { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink, CheckCircle, XCircle, HelpCircle } from 'lucide-react'
import type { EvidenceCaseData } from './types'
import { EMBRY } from '../sparta/common/EmbryStyle'

export interface InlineEvidenceCaseProps {
  data: EvidenceCaseData
  onViewDetails?: () => void
  loading?: boolean
}

const VERDICT_COLORS = {
  PASS: '#00ff88',
  FAIL: '#ff4444',
  UNKNOWN: '#ffaa00',
} as const

const TIER_LABELS = {
  TIER_1: 'Informational',
  TIER_2: 'Grounded',
  TIER_3: 'Verified',
} as const

export function InlineEvidenceCase({ data, onViewDetails, loading }: InlineEvidenceCaseProps) {
  const [expanded, setExpanded] = useState(false)

  if (loading) {
    return (
      <div
        data-qid={`evidence-case:skeleton:${data.qraKey}`}
        title="Loading evidence case..."
        style={{
          background: EMBRY.surface,
          borderRadius: 8,
          padding: 16,
          marginTop: 8,
          animation: 'pulse 1.5s ease-in-out infinite',
        }}
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <div style={{ width: 60, height: 24, background: 'rgba(255,255,255,0.05)', borderRadius: 4 }} />
          <div style={{ width: 80, height: 24, background: 'rgba(255,255,255,0.05)', borderRadius: 4 }} />
        </div>
        <div style={{ height: 8, background: 'rgba(255,255,255,0.05)', borderRadius: 4, marginBottom: 8 }} />
        <div style={{ height: 14, width: '80%', background: 'rgba(255,255,255,0.05)', borderRadius: 4 }} />
      </div>
    )
  }

  const verdictColor = VERDICT_COLORS[data.verdict] || VERDICT_COLORS.UNKNOWN
  const tierLabel = TIER_LABELS[data.tier] || data.tier
  const VerdictIcon = data.verdict === 'PASS' ? CheckCircle : data.verdict === 'FAIL' ? XCircle : HelpCircle

  // Parse metadata for gates if available
  const gatesPassed = data.metadata?.gates_passed ?? 0
  const gatesTotal = data.metadata?.gates_total ?? 0
  const gateTrace = data.metadata?.gate_trace ?? []
  const progressPercent = gatesTotal > 0 ? (gatesPassed / gatesTotal) * 100 : 0

  return (
    <div
      data-qid={`evidence-case:container:${data.qraKey}`}
      data-qs-action="EVIDENCE_CASE_CONTAINER"
      title={`Evidence case for ${data.qraKey}`}
      style={{
        background: EMBRY.surface,
        border: `1px solid ${verdictColor}33`,
        borderLeft: `3px solid ${verdictColor}`,
        borderRadius: 8,
        padding: 12,
        marginTop: 8,
      }}
    >
      {/* Header: Verdict + Tier badges */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
        <span
          data-qid={`evidence-case:verdict:${data.qraKey}`}
          title={`Verdict: ${data.verdict}`}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: `${verdictColor}22`,
            color: verdictColor,
            fontSize: 12,
            fontWeight: 600,
            padding: '4px 10px',
            borderRadius: 12,
            fontFamily: 'var(--font-mono)',
          }}
        >
          <VerdictIcon size={14} />
          {data.verdict}
        </span>
        <span
          data-qid={`evidence-case:tier:${data.qraKey}`}
          title={`Evidence tier: ${tierLabel}`}
          style={{
            background: 'rgba(74, 158, 255, 0.15)',
            color: '#4a9eff',
            fontSize: 11,
            padding: '3px 8px',
            borderRadius: 10,
            fontFamily: 'var(--font-sans)',
          }}
        >
          {tierLabel}
        </span>
        <span
          data-qid={`evidence-case:qra-key:${data.qraKey}`}
          title={`Control: ${data.qraKey}`}
          style={{
            color: EMBRY.muted,
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
          }}
        >
          {data.qraKey}
        </span>
      </div>

      {/* Gates progress bar */}
      {gatesTotal > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span
              data-qid={`evidence-case:gates-label:${data.qraKey}`}
              title="Gates passed"
              style={{ color: EMBRY.muted, fontSize: 11, fontFamily: 'var(--font-sans)' }}
            >
              Gates
            </span>
            <span
              data-qid={`evidence-case:gates-count:${data.qraKey}`}
              title={`${gatesPassed} of ${gatesTotal} gates passed`}
              style={{ color: EMBRY.text, fontSize: 11, fontFamily: 'var(--font-mono)' }}
            >
              {gatesPassed}/{gatesTotal}
            </span>
          </div>
          <div
            data-qid={`evidence-case:progress-bar:${data.qraKey}`}
            title={`${Math.round(progressPercent)}% complete`}
            style={{
              background: 'rgba(255,255,255,0.1)',
              borderRadius: 4,
              height: 6,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${progressPercent}%`,
                height: '100%',
                background: verdictColor,
                borderRadius: 4,
                transition: 'width 0.3s ease',
              }}
            />
          </div>
        </div>
      )}

      {/* Description */}
      {data.description && (
        <p
          data-qid={`evidence-case:description:${data.qraKey}`}
          title={data.description}
          style={{
            color: EMBRY.text,
            fontSize: 13,
            margin: '8px 0',
            lineHeight: 1.4,
            fontFamily: 'var(--font-sans)',
          }}
        >
          {data.description}
        </p>
      )}

      {/* Collapsible gate trace */}
      {gateTrace.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            data-qid={`evidence-case:toggle-trace:${data.qraKey}`}
            data-qs-action="EVIDENCE_CASE_TOGGLE_TRACE"
            title={expanded ? 'Collapse gate trace' : 'Expand gate trace'}
            onClick={() => setExpanded(!expanded)}
            style={{
              background: 'none',
              border: 'none',
              color: EMBRY.muted,
              fontSize: 12,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              padding: '4px 0',
              minHeight: 44,
              fontFamily: 'var(--font-sans)',
            }}
          >
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            Gate Trace ({gateTrace.length})
          </button>
          {expanded && (
            <div
              data-qid={`evidence-case:trace-panel:${data.qraKey}`}
              title="Gate trace details"
              style={{
                background: 'rgba(0,0,0,0.2)',
                borderRadius: 4,
                padding: 8,
                marginTop: 4,
              }}
            >
              {gateTrace.map((gate: any, i: number) => (
                <div
                  key={i}
                  data-qid={`evidence-case:gate:${data.qraKey}:${i}`}
                  title={`Gate ${i + 1}: ${gate.name || gate.gate_id || 'Unknown'}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 0',
                    borderBottom: i < gateTrace.length - 1 ? '1px solid rgba(255,255,255,0.05)' : 'none',
                  }}
                >
                  <span style={{ color: gate.passed ? '#00ff88' : '#ff4444', fontSize: 12 }}>
                    {gate.passed ? '✓' : '✗'}
                  </span>
                  <span style={{ color: EMBRY.text, fontSize: 12, fontFamily: 'var(--font-mono)' }}>
                    {gate.name || gate.gate_id || `Gate ${i + 1}`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* View Full Case button */}
      {onViewDetails && (
        <button
          data-qid={`evidence-case:view-details:${data.qraKey}`}
          data-qs-action="EVIDENCE_CASE_VIEW_DETAILS"
          title="View full evidence case"
          onClick={onViewDetails}
          style={{
            background: `${EMBRY.accent}22`,
            border: `1px solid ${EMBRY.accent}`,
            color: EMBRY.accent,
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 12,
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 12,
            minHeight: 44,
            fontFamily: 'var(--font-sans)',
          }}
        >
          <ExternalLink size={14} />
          View Full Case
        </button>
      )}
    </div>
  )
}

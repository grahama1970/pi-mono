/**
 * BuildingEvidenceCase — Orchestrator for animated evidence case building.
 *
 * Composes:
 * - EvidenceCaseFlow: 4-stage pipeline header
 * - AnimatedStep[]: Individual gates with staggered entrance
 * - AnimatedConnector[]: SVG lines between steps
 *
 * Features:
 * - Skeleton loading when streaming starts but no steps yet
 * - Collapse to summary when complete (expandable)
 * - prefers-reduced-motion support
 *
 * Complies with:
 * - COTS C02: 44px minimum touch targets
 * - NVIS Class A: White Phosphor palette
 * - 4-Attribute Rule: data-qid, data-qs-action, title, useRegisterAction
 */
import { memo, useState, useMemo } from 'react'
import { ChevronDown, ChevronUp, Check, AlertTriangle } from 'lucide-react'
import { EvidenceCaseFlow, type FlowPhase } from './EvidenceCaseFlow'
import { AnimatedStep, type StepStatus } from './AnimatedStep'
import { AnimatedConnector } from './AnimatedConnector'
import { useReducedMotion } from '../../../hooks/useReducedMotion'
import { useRegisterAction } from '../../../hooks/useRegisterAction'

const NVIS = {
  phosphor: '#e0e4e8',
  cyan: '#00d1ff',
  green: '#3fb950',
  red: '#f85149',
  dim: '#8b949e',
  glassBg: 'rgba(18, 19, 21, 0.85)',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
}

export interface BuildingStep {
  id: string
  type: string
  status: StepStatus
  summary: string
  detail?: string
  duration?: number
}

export interface BuildingEvidenceCaseProps {
  steps: BuildingStep[]
  isStreaming?: boolean
  title?: string
}

function derivePhase(steps: BuildingStep[]): FlowPhase {
  if (steps.length === 0) return 'question'

  const allDone = steps.every(s => s.status === 'done' || s.status === 'failed')
  const anyFailed = steps.some(s => s.status === 'failed')

  if (allDone) return 'complete'

  const runningStep = steps.find(s => s.status === 'running')
  const runningType = runningStep?.type.toLowerCase() ?? ''

  if (runningType.includes('recall') || runningType.includes('fetch') || runningType.includes('assembly')) {
    return 'assembly'
  }
  if (runningType.includes('gate') || runningType.includes('eval') || runningType.includes('check')) {
    return 'evaluation'
  }
  if (runningType.includes('synth') || runningType.includes('answer') || runningType.includes('response')) {
    return 'synthesis'
  }

  const lastDoneIndex = steps.findLastIndex(s => s.status === 'done')
  if (lastDoneIndex >= 0) {
    const progress = (lastDoneIndex + 1) / steps.length
    if (progress < 0.33) return 'assembly'
    if (progress < 0.66) return 'evaluation'
    return 'synthesis'
  }

  return 'assembly'
}

const Skeleton = memo(function Skeleton() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[0, 1, 2].map(i => (
        <div
          key={i}
          style={{
            height: 40,
            borderRadius: 6,
            background: `linear-gradient(90deg, ${NVIS.glassBg} 0%, ${NVIS.dim}20 50%, ${NVIS.glassBg} 100%)`,
            backgroundSize: '200% 100%',
            animation: `shimmer 1.5s infinite`,
            animationDelay: `${i * 200}ms`,
          }}
        />
      ))}
      <style>{`
        @keyframes shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  )
})

const CompleteSummary = memo(function CompleteSummary({
  steps,
  isExpanded,
  onToggle,
}: {
  steps: BuildingStep[]
  isExpanded: boolean
  onToggle: () => void
}) {
  const doneCount = steps.filter(s => s.status === 'done').length
  const failedCount = steps.filter(s => s.status === 'failed').length
  const totalDuration = steps.reduce((sum, s) => sum + (s.duration ?? 0), 0)
  const allPassed = failedCount === 0

  return (
    <button
      data-qid="evidence:building:summary"
      data-qs-action="TOGGLE_EVIDENCE_DETAILS"
      title={isExpanded ? 'Collapse evidence case details' : 'Expand evidence case details'}
      onClick={onToggle}
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 12px',
        background: allPassed ? `${NVIS.green}10` : `${NVIS.red}10`,
        border: `1px solid ${allPassed ? NVIS.green : NVIS.red}30`,
        borderRadius: 8,
        cursor: 'pointer',
        minHeight: 44,
      }}
    >
      <div
        style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: allPassed ? `${NVIS.green}20` : `${NVIS.red}20`,
          color: allPassed ? NVIS.green : NVIS.red,
        }}
      >
        {allPassed ? <Check size={14} strokeWidth={2.5} /> : <AlertTriangle size={14} strokeWidth={2} />}
      </div>
      <div style={{ flex: 1, textAlign: 'left' }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: NVIS.phosphor }}>
          Evidence Case {allPassed ? 'Complete' : 'Failed'}
        </div>
        <div style={{ fontSize: 10, color: NVIS.dim, marginTop: 2 }}>
          {doneCount} passed{failedCount > 0 ? `, ${failedCount} failed` : ''} &middot;{' '}
          {totalDuration < 1000 ? `${totalDuration}ms` : `${(totalDuration / 1000).toFixed(1)}s`}
        </div>
      </div>
      {isExpanded ? (
        <ChevronUp size={16} color={NVIS.dim} />
      ) : (
        <ChevronDown size={16} color={NVIS.dim} />
      )}
    </button>
  )
})

export const BuildingEvidenceCase = memo(function BuildingEvidenceCase({
  steps,
  isStreaming = false,
  title = 'Building Evidence Case',
}: BuildingEvidenceCaseProps) {
  const reduceMotion = useReducedMotion()
  const [isExpanded, setIsExpanded] = useState(true)

  useRegisterAction('evidence:building:toggle', {
    app: 'sparta-explorer',
    action: 'TOGGLE_EVIDENCE_DETAILS',
    label: 'Toggle Evidence Details',
    description: 'Expand or collapse evidence case step details',
    tags: ['sparta', 'evidence', 'toggle'],
  })

  const phase = useMemo(() => derivePhase(steps), [steps])
  const isComplete = phase === 'complete'
  const showSkeleton = isStreaming && steps.length === 0

  return (
    <div
      data-qid="evidence:building:container"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 12,
        background: NVIS.glassBg,
        border: `1px solid ${NVIS.glassBorder}`,
        borderRadius: 10,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
      }}
    >
      {/* Header */}
      {!isComplete && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            paddingBottom: 8,
            borderBottom: `1px solid ${NVIS.glassBorder}`,
          }}
        >
          <div
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: NVIS.cyan,
              boxShadow: `0 0 8px ${NVIS.cyan}`,
              animation: reduceMotion ? 'none' : 'pulse 1.5s infinite',
            }}
          />
          <span style={{ fontSize: 12, fontWeight: 600, color: NVIS.phosphor }}>{title}</span>
          <span
            style={{
              fontSize: 9,
              fontFamily: 'monospace',
              color: NVIS.dim,
              marginLeft: 'auto',
            }}
          >
            {steps.filter(s => s.status === 'done').length}/{steps.length} gates
          </span>
        </div>
      )}

      {/* Flow pipeline (only when active) */}
      {!isComplete && !showSkeleton && <EvidenceCaseFlow currentPhase={phase} />}

      {/* Complete summary with expand/collapse */}
      {isComplete && (
        <CompleteSummary
          steps={steps}
          isExpanded={isExpanded}
          onToggle={() => setIsExpanded(!isExpanded)}
        />
      )}

      {/* Skeleton loading */}
      {showSkeleton && <Skeleton />}

      {/* Step list with connectors */}
      {!showSkeleton && (isExpanded || !isComplete) && steps.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {steps.map((step, i) => (
            <div key={step.id}>
              <AnimatedStep
                index={i}
                status={step.status}
                label={step.summary || step.type.replace(/^step_\d+_/, '')}
                detail={step.detail}
                duration={step.duration}
              />
              {i < steps.length - 1 && (
                <div style={{ paddingLeft: 14 }}>
                  <AnimatedConnector
                    active={step.status === 'done' && steps[i + 1]?.status === 'running'}
                    complete={step.status === 'done' && steps[i + 1]?.status !== 'pending'}
                    height={12}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Keyframes */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  )
})

export default BuildingEvidenceCase

import React, { useMemo, useState } from 'react'
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  FileText,
  MessageSquare,
  Loader2,
  Mic,
  Shield,
  Sparkles,
  Tag,
  Target,
  XCircle,
} from 'lucide-react'
import type { DisclosureVariant, ThinkingTraceLikeStep } from './memory-turn'
import type { ThinkingTraceLeadingIcon } from './thinkingTraceHelpers'

export type ThinkingTraceStep = ThinkingTraceLikeStep

export function useThinkingTrace(defaultOpen = false) {
  const [open, setOpen] = useState(defaultOpen)
  return {
    open,
    setOpen,
    toggle: () => setOpen((value) => !value),
  }
}

export interface ThinkingTraceProps {
  steps?: ThinkingTraceStep[]
  title?: string
  label?: string
  currentLabel?: string
  disclosureVariant?: DisclosureVariant
  leadingIcon?: ThinkingTraceLeadingIcon
  placement?: 'header' | 'footer'
  displayMode?: 'current' | 'full'
  defaultOpen?: boolean
  isStreaming?: boolean
  className?: string
  dataQid?: string
}

export function ThinkingTrace({
  steps = [],
  title = 'Thinking',
  currentLabel,
  disclosureVariant = 'thinking',
  leadingIcon = disclosureVariant === 'evidence-case' ? 'shield' : 'sparkle',
  placement = 'footer',
  displayMode = 'full',
  defaultOpen = false,
  isStreaming = false,
  className,
  dataQid,
}: ThinkingTraceProps): JSX.Element | null {
  const [open, setOpen] = useState(defaultOpen)
  const visibleSteps = useMemo(() => {
    if (displayMode === 'current') {
      const running = [...steps].reverse().find((step) => step.status === 'running')
      return running ? [running] : steps.slice(-1)
    }
    return steps
  }, [displayMode, steps])

  if (!steps.length && !isStreaming && !currentLabel) return null

  const resolvedCurrent = currentLabel ?? visibleSteps[visibleSteps.length - 1]?.label ?? title
  const qid = dataQid ?? (disclosureVariant === 'evidence-case' ? 'shared-chat:thinking:evidence-case' : 'shared-chat:thinking')
  const failedStep = steps.find((step) => step.status === 'failed')
  const runningStep = [...steps].reverse().find((step) => step.status === 'running')
  const pipelineSteps = title === 'Watch thinking' ? steps.filter((step) => step.id !== 'watch-scene-context') : steps
  const pipelineCompletedCount = pipelineSteps.filter((step) => step.status === 'completed' || step.status === 'skipped').length
  const pipelineTotalCount = Math.max(pipelineSteps.length, 1)
  const pipelineRunningStep = [...pipelineSteps].reverse().find((step) => step.status === 'running')
  const activeStep = pipelineRunningStep ?? runningStep
  const statusLabel = failedStep
    ? `Process stopped: ${failedStep.label}`
    : isStreaming
      ? currentLabel ?? activeStep?.label ?? resolvedCurrent
      : completedStatusLabel(title, pipelineSteps, pipelineCompletedCount, pipelineTotalCount)

  return (
    <section
      className={['chat-thinking-trace', 'chat-thinking-trace--process', className].filter(Boolean).join(' ')}
      data-qid={qid}
      data-disclosure-variant={disclosureVariant}
      data-placement={placement}
      data-state={failedStep ? 'failed' : isStreaming ? 'processing' : 'ready'}
      style={{
        marginTop: placement === 'header' ? 0 : 10,
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        className="chat-thinking-trace__status"
        data-qid={`${qid}:toggle`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '9px 10px',
          border: 0,
          background: 'transparent',
          color: '#e9edf3',
          cursor: 'pointer',
          font: 'inherit',
          textAlign: 'left',
        }}
      >
        <span className="chat-thinking-trace__leading-icon" aria-hidden="true">
          <TraceLeadingIcon leadingIcon={leadingIcon} />
        </span>
        <span className="chat-thinking-trace__status-copy">
          <span className="chat-thinking-trace__status-label">{statusLabel}</span>
        </span>
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>

      {open && (
        <ol
          className="chat-thinking-trace__pipeline"
          data-qid={`${qid}:steps`}
          style={{
            margin: 0,
            padding: '8px 10px 10px 18px',
            listStyle: 'none',
            display: 'grid',
            gap: 4,
          }}
        >
          {(visibleSteps.length ? visibleSteps : [{ id: 'current', label: resolvedCurrent, status: 'running' as const }]).map((step) => (
            <li
              className="chat-thinking-trace__pipeline-step"
              key={`${step.id}-${step.status ?? 'pending'}`}
              data-qid={`${qid}:step:${step.id}`}
              data-status={step.status ?? 'pending'}
              style={{ display: 'grid', gridTemplateColumns: '16px 1fr', gap: 8, alignItems: 'start' }}
            >
              <span className="chat-thinking-trace__pipeline-icon">
                <StepStatusIcon id={step.id} status={step.status} />
              </span>
              <span>
                <span style={{ display: 'block', color: '#dce5f3', fontSize: 12, fontWeight: 650 }}>{step.label}</span>
                {step.detail && (
                  <span style={{ display: 'block', color: '#8e9aae', fontSize: 11, lineHeight: 1.45, marginTop: 2 }}>{step.detail}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export function TraceLeadingIcon({ leadingIcon }: { leadingIcon: ThinkingTraceLeadingIcon }): JSX.Element | null {
  if (leadingIcon === 'none') return null
  if (leadingIcon === 'shield') return <Shield size={16} strokeWidth={1.7} />
  if (leadingIcon === 'mic') return <Mic size={16} strokeWidth={1.7} />
  return <Sparkles size={16} strokeWidth={1.7} />
}

export function ThinkingTraceToggle({
  open,
  onToggle,
  label = 'Show thinking',
  liveLabel,
  isLive = false,
  leadingIcon = 'sparkle',
}: {
  open: boolean
  onToggle: () => void
  label?: string
  currentStep?: ThinkingTraceStep | null
  liveLabel?: string
  isLive?: boolean
  leadingIcon?: ThinkingTraceLeadingIcon
  messageId?: string
}): JSX.Element {
  return (
    <button type="button" className="chat-thinking-trace__status" onClick={onToggle} aria-expanded={open}>
      <TraceLeadingIcon leadingIcon={leadingIcon} />
      <span>{isLive && liveLabel ? liveLabel : label}</span>
      {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
    </button>
  )
}

export function ThinkingTraceSteps({
  steps,
  displayMode = 'full',
  style,
}: {
  steps: ThinkingTraceStep[]
  messageId?: string
  displayMode?: ThinkingTraceProps['displayMode']
  style?: React.CSSProperties
}): JSX.Element {
  const visibleSteps = displayMode === 'current' ? steps.slice(-1) : steps
  return (
    <ol style={style}>
      {visibleSteps.map((step) => (
        <li key={`${step.id}-${step.status ?? 'pending'}`}>
          <StepStatusIcon id={step.id} status={step.status} /> {step.label}
        </li>
      ))}
    </ol>
  )
}

function StepStatusIcon({ id, status }: { id?: string; status?: ThinkingTraceStep['status'] }): JSX.Element {
  if (status === 'failed') return <XCircle size={15} strokeWidth={1.7} aria-hidden="true" />
  if (status === 'running') return <Loader2 className="chat-thinking-trace__running-spinner" size={15} strokeWidth={1.7} aria-hidden="true" />
  switch (id) {
    case 'watch-scene-context':
      return <FileText size={15} strokeWidth={1.7} aria-hidden="true" />
    case 'classifying-intent':
      return <Target size={15} strokeWidth={1.7} aria-hidden="true" />
    case 'extracting-entities':
      return <Tag size={15} strokeWidth={1.7} aria-hidden="true" />
    case 'looking-in-memory':
    case 'persona-recall':
      return <Archive size={15} strokeWidth={1.7} aria-hidden="true" />
    case 'create-evidence-case':
      return <Shield size={15} strokeWidth={1.7} aria-hidden="true" />
    case 'answering':
    case 'persona-answer':
      return <MessageSquare size={15} strokeWidth={1.7} aria-hidden="true" />
    default:
      return status === 'completed' || status === 'skipped'
        ? <CheckCircle2 size={15} strokeWidth={1.7} aria-hidden="true" />
        : <Circle size={15} strokeWidth={1.7} aria-hidden="true" />
  }
}

function completedStatusLabel(
  title: string,
  steps: ThinkingTraceStep[],
  completedCount: number,
  totalCount: number,
): string {
  const finalStep = [...steps].reverse().find((step) => step.status === 'completed' || step.status === 'skipped')
  const finalLabel = finalStep?.label ?? title
  if (title === 'Watch thinking') {
    if (completedCount >= totalCount && totalCount > 0) return 'Report ready'
    return `${finalLabel} (${completedCount}/${totalCount})`
  }
  return `${finalLabel} (${completedCount}/${totalCount})`
}

export default ThinkingTrace

/**
 * EvidenceCaseFlow — Four-stage pipeline visualization.
 *
 * Stages:
 *   1. Question Received — User input captured
 *   2. Evidence Assembly — Recall + sources gathered
 *   3. Gate Evaluation — CAE gates evaluated
 *   4. Answer Synthesis — Final response generated
 *
 * Complies with:
 * - COTS C02: 44px minimum touch targets
 * - NVIS Class A: White Phosphor palette
 * - 4-Attribute Rule: data-qid, data-qs-action, title, useRegisterAction
 */
import { memo } from 'react'
import { MessageSquare, Database, Shield, Sparkles } from 'lucide-react'
import { useReducedMotion } from '../../../hooks/useReducedMotion'
import { useMediaQuery } from '../../../hooks/useMediaQuery'

export type FlowPhase = 'question' | 'assembly' | 'evaluation' | 'synthesis' | 'complete'

interface EvidenceCaseFlowProps {
  currentPhase: FlowPhase
}

const NVIS = {
  phosphor: '#e0e4e8',
  cyan: '#00d1ff',
  green: '#3fb950',
  dim: '#8b949e',
  glassBg: 'rgba(18, 19, 21, 0.85)',
  glassBorder: 'rgba(255, 255, 255, 0.08)',
}

const STAGES = [
  { id: 'question', label: 'Question', icon: MessageSquare },
  { id: 'assembly', label: 'Evidence Assembly', icon: Database },
  { id: 'evaluation', label: 'Gate Evaluation', icon: Shield },
  { id: 'synthesis', label: 'Answer Synthesis', icon: Sparkles },
] as const

function getStageStatus(stageId: string, currentPhase: FlowPhase): 'inactive' | 'active' | 'complete' {
  const stageOrder = ['question', 'assembly', 'evaluation', 'synthesis']
  const currentIndex = stageOrder.indexOf(currentPhase)
  const stageIndex = stageOrder.indexOf(stageId)

  if (currentPhase === 'complete') return 'complete'
  if (stageIndex < currentIndex) return 'complete'
  if (stageIndex === currentIndex) return 'active'
  return 'inactive'
}

const StageIndicator = memo(function StageIndicator({
  stage,
  status,
  reduceMotion,
}: {
  stage: typeof STAGES[number]
  status: 'inactive' | 'active' | 'complete'
  reduceMotion: boolean
}) {
  const Icon = stage.icon
  const transitionDuration = reduceMotion ? '0ms' : '300ms'

  const colorMap = {
    inactive: NVIS.dim,
    active: NVIS.cyan,
    complete: NVIS.green,
  }

  const color = colorMap[status]
  const isActive = status === 'active'

  return (
    <div
      data-qid={`evidence:flow:stage:${stage.id}`}
      title={`${stage.label}: ${status}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        flex: 1,
        minWidth: 0,
        opacity: status === 'inactive' ? 0.4 : 1,
        transition: `opacity ${transitionDuration}`,
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: `${color}15`,
          border: `1px solid ${color}40`,
          boxShadow: isActive ? `0 0 12px ${color}40` : 'none',
          transition: `all ${transitionDuration}`,
        }}
      >
        <Icon size={18} strokeWidth={1.5} style={{ color }} />
      </div>
      <span
        style={{
          fontSize: 9,
          fontWeight: 600,
          color,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          textAlign: 'center',
          transition: `color ${transitionDuration}`,
        }}
      >
        {stage.label}
      </span>
    </div>
  )
})

const Connector = memo(function Connector({
  active,
  complete,
  reduceMotion,
  vertical,
}: {
  active: boolean
  complete: boolean
  reduceMotion: boolean
  vertical: boolean
}) {
  const transitionDuration = reduceMotion ? '0ms' : '400ms'
  const color = complete ? NVIS.green : active ? NVIS.cyan : NVIS.dim

  if (vertical) {
    return (
      <div
        style={{
          width: 2,
          height: 16,
          margin: '4px auto',
          background: complete || active ? color : `${NVIS.dim}40`,
          borderRadius: 1,
          transition: `background ${transitionDuration}`,
          boxShadow: active ? `0 0 6px ${color}` : 'none',
        }}
      />
    )
  }

  return (
    <div
      style={{
        flex: '0 0 24px',
        height: 2,
        margin: '18px 0',
        background: complete || active ? color : `${NVIS.dim}40`,
        borderRadius: 1,
        transition: `background ${transitionDuration}`,
        boxShadow: active ? `0 0 6px ${color}` : 'none',
      }}
    />
  )
})

export const EvidenceCaseFlow = memo(function EvidenceCaseFlow({ currentPhase }: EvidenceCaseFlowProps) {
  const reduceMotion = useReducedMotion()
  const { isMobile } = useMediaQuery()

  const getConnectorState = (index: number) => {
    const stageOrder = ['question', 'assembly', 'evaluation', 'synthesis']
    const currentIndex = stageOrder.indexOf(currentPhase)
    if (currentPhase === 'complete') return { active: false, complete: true }
    if (index < currentIndex) return { active: false, complete: true }
    if (index === currentIndex) return { active: true, complete: false }
    return { active: false, complete: false }
  }

  if (isMobile) {
    return (
      <div
        data-qid="evidence:flow:container"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          padding: '12px 16px',
          background: NVIS.glassBg,
          borderRadius: 10,
          border: `1px solid ${NVIS.glassBorder}`,
        }}
      >
        {STAGES.map((stage, i) => {
          const status = getStageStatus(stage.id, currentPhase)
          const connectorState = i < STAGES.length - 1 ? getConnectorState(i) : null

          return (
            <div key={stage.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <StageIndicator stage={stage} status={status} reduceMotion={reduceMotion} />
              {connectorState && (
                <Connector
                  active={connectorState.active}
                  complete={connectorState.complete}
                  reduceMotion={reduceMotion}
                  vertical
                />
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div
      data-qid="evidence:flow:container"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '12px 16px',
        background: NVIS.glassBg,
        borderRadius: 10,
        border: `1px solid ${NVIS.glassBorder}`,
      }}
    >
      {STAGES.map((stage, i) => {
        const status = getStageStatus(stage.id, currentPhase)
        const connectorState = i < STAGES.length - 1 ? getConnectorState(i) : null

        return (
          <div key={stage.id} style={{ display: 'contents' }}>
            <StageIndicator stage={stage} status={status} reduceMotion={reduceMotion} />
            {connectorState && (
              <Connector
                active={connectorState.active}
                complete={connectorState.complete}
                reduceMotion={reduceMotion}
                vertical={false}
              />
            )}
          </div>
        )
      })}
    </div>
  )
})

export default EvidenceCaseFlow

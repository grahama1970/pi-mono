import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react'
import type { TransportDialogTurn } from './types'
import { extractProofRoundLabel, parseDisplayMessages } from './messageParse'
import { filterDisplayMessages, type StreamViewPreset } from './streamFilter'
import { buildTimelineSegments } from './timelineLayout'
import { TransportMessageCard, TransportSpawnDispatchCard } from './TransportMessageCard'
import type { Skill } from '../../shared-chat/types'

export type TransportTimelineHandle = {
  scrollToAnchor: (anchorId: string) => void
  scrollToTop: () => void
}

export const TransportMessageTimeline = forwardRef(function TransportMessageTimeline(
  {
    turns,
    runId,
    dagNodeId,
    skills,
    workerUrl,
    streamPreset,
    highlightAnchor,
    onSelectCall,
  }: {
    turns: TransportDialogTurn[]
    runId: string
    dagNodeId?: string
    skills?: Skill[]
    workerUrl?: string
    streamPreset: StreamViewPreset
    highlightAnchor?: string | null
    onSelectCall?: (subagentRunId: string) => void
  },
  ref: React.Ref<TransportTimelineHandle>,
) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const allMessages = useMemo(() => parseDisplayMessages(turns), [turns])
  const messages = useMemo(
    () => filterDisplayMessages(allMessages, streamPreset),
    [allMessages, streamPreset],
  )
  const segments = useMemo(() => buildTimelineSegments(messages), [messages])
  const roundLabel = extractProofRoundLabel(runId, dagNodeId)

  useImperativeHandle(ref, () => ({
    scrollToAnchor(anchorId: string) {
      const root = scrollRef.current
      if (!root) return
      const el = root.querySelector(`[data-anchor="${anchorId}"]`)
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    },
    scrollToTop() {
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
    },
  }), [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length])

  useEffect(() => {
    if (!highlightAnchor) return
    const root = scrollRef.current
    if (!root) return
    const el = root.querySelector(`[data-anchor="${highlightAnchor}"]`)
    if (el instanceof HTMLElement) {
      el.classList.add('tr-jump-anchor')
      const t = window.setTimeout(() => el.classList.remove('tr-jump-anchor'), 2000)
      return () => window.clearTimeout(t)
    }
    return undefined
  }, [highlightAnchor])

  return (
    <div
      ref={scrollRef}
      className={`tr-chat-scroll`}
      data-qid="transport:timeline"
    >
      <div className="tr-proof-round">
        <div className="tr-round-header" data-qid="transport:timeline:round">
          <div className="tr-round-badge">{roundLabel}</div>
          <span className="tr-round-legend">Parties in this round: Human · Reviewer · Worker</span>
        </div>

        <div className="tr-round-messages">
          {segments.length === 0 ? (
            <p className="tr-timeline-empty">No messages in this view. Try Handoffs or Full trace.</p>
          ) : (
            segments.map((seg) => {
              if (seg.type === 'nested') {
                const spawnEntry = seg.messages.find((m) => m.message.kind === 'agent_card')
                const taskEntry = seg.messages.find((m) => m.message.kind === 'task_card')
                const rest = seg.messages.filter(
                  (m) => m.message.kind !== 'agent_card' && m.message.kind !== 'task_card',
                )
                return (
                  <div
                    key={seg.nestId}
                    className="tr-nested-execution-block"
                    data-anchor={seg.anchorId}
                    data-qid="transport:nested-worker"
                  >
                    {spawnEntry && (
                      <TransportSpawnDispatchCard
                        spawn={spawnEntry.message}
                        task={taskEntry?.message}
                        skills={skills}
                        workerUrl={workerUrl}
                        stagger={Math.min(spawnEntry.index * 0.04, 0.32)}
                        onInspectCall={
                          spawnEntry.message.metadata.subagentRunId && onSelectCall
                            ? () => onSelectCall(spawnEntry.message.metadata.subagentRunId!)
                            : undefined
                        }
                      />
                    )}
                    {rest.map(({ message, index }) => (
                      <TransportMessageCard
                        key={message.id}
                        message={message}
                        skills={skills}
                        workerUrl={workerUrl}
                        index={index}
                      />
                    ))}
                  </div>
                )
              }
              const anchor =
                seg.message.kind === 'agent_card' ? 'phase-reviewer' : undefined
              return (
                <div key={seg.message.id} data-anchor={anchor}>
                  <TransportMessageCard
                    message={seg.message}
                    skills={skills}
                    workerUrl={workerUrl}
                    index={seg.index}
                    onInspectCall={
                      seg.message.metadata.subagentRunId && onSelectCall
                        ? () => onSelectCall(seg.message.metadata.subagentRunId!)
                        : undefined
                    }
                  />
                </div>
              )
            })
          )}
          <div ref={endRef} />
        </div>
      </div>
    </div>
  )
})

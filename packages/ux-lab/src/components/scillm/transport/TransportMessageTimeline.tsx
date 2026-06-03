import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { TransportDialogTurn, TransportStreamEvent } from './types'
import { extractProofRoundLabel, parseDisplayMessages } from './messageParse'
import { filterDisplayMessages, type StreamViewPreset } from './streamFilter'
import { buildTimelineSegments } from './timelineLayout'
import { resolveSubagentRunId, type TransportCallRow } from './callInspector'
import { TransportMessageCard } from './TransportMessageCard'
import type { Skill } from '../../shared-chat/types'
import { attachmentsForMessage } from './messageAttachments'
import { buildReasoningByCall } from './reasoningByCall'
import { buildStructuredAttachmentIndex } from './attachmentEvents'
import { buildToolTraceByCall } from './toolTraceByCall'
import { isNearBottom, shouldShowScrollToBottom } from './transportScroll'
import { useRegisterAction } from '../../../hooks/useRegisterAction'

export type TransportTimelineHandle = {
  scrollToAnchor: (anchorId: string) => void
  scrollToTop: () => void
  scrollToBottom: () => void
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
    calls,
    events,
    selectedCallId,
    selectedMessageId,
    onSelectCall,
  }: {
    turns: TransportDialogTurn[]
    runId: string
    dagNodeId?: string
    skills?: Skill[]
    workerUrl?: string
    streamPreset: StreamViewPreset
    highlightAnchor?: string | null
    calls: TransportCallRow[]
    events: TransportStreamEvent[]
    selectedCallId: string | null
    selectedMessageId: string | null
    onSelectCall?: (subagentRunId: string, messageId?: string) => void
  },
  ref: React.Ref<TransportTimelineHandle>,
) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const nearBottomRef = useRef(true)
  const [showScrollDown, setShowScrollDown] = useState(false)

  const allMessages = useMemo(() => parseDisplayMessages(turns), [turns])
  const messages = useMemo(
    () => filterDisplayMessages(allMessages, streamPreset),
    [allMessages, streamPreset],
  )
  const reasoningByCall = useMemo(() => buildReasoningByCall(events), [events])
  const toolTraceByCall = useMemo(() => buildToolTraceByCall(events), [events])
  const structuredAttachments = useMemo(
    () => buildStructuredAttachmentIndex(events, runId),
    [events, runId],
  )
  const segments = useMemo(() => buildTimelineSegments(messages), [messages])

  const attachmentPropsFor = (
    message: import('./messageParse').DisplayMessage,
    nestMessages?: import('./messageParse').DisplayMessage[],
  ) => {
    const row = attachmentsForMessage(
      message,
      calls,
      events,
      nestMessages,
      reasoningByCall,
      toolTraceByCall,
      structuredAttachments,
      runId,
    )
    if (!row) return {}
    return { attachments: row, transportRunId: runId }
  }
  const roundLabel = extractProofRoundLabel(runId, dagNodeId)

  const selectFromMessage = (message: import('./messageParse').DisplayMessage, nestMessages?: import('./messageParse').DisplayMessage[]) => {
    if (!onSelectCall) return
    const callId = resolveSubagentRunId(message, calls, nestMessages)
    if (!callId) return
    onSelectCall(callId, message.id)
  }

  const syncScrollAffordance = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const near = isNearBottom(el.scrollHeight, el.scrollTop, el.clientHeight)
    nearBottomRef.current = near
    setShowScrollDown(shouldShowScrollToBottom(el.scrollHeight, el.scrollTop, el.clientHeight))
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    endRef.current?.scrollIntoView({ behavior })
    nearBottomRef.current = true
    window.requestAnimationFrame(syncScrollAffordance)
  }, [syncScrollAffordance])

  useRegisterAction('transport:timeline:scroll-bottom', {
    app: 'ux-lab',
    action: 'TRANSPORT_SCROLL_TO_BOTTOM',
    label: 'Scroll collaboration thread to bottom',
    description: 'Jump to the latest message in the transport room',
  })

  useImperativeHandle(ref, () => ({
    scrollToAnchor(anchorId: string) {
      const root = scrollRef.current
      if (!root) return
      const el = root.querySelector(`[data-anchor="${anchorId}"]`)
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        window.requestAnimationFrame(syncScrollAffordance)
      }
    },
    scrollToTop() {
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      window.requestAnimationFrame(syncScrollAffordance)
    },
    scrollToBottom() {
      scrollToBottom('smooth')
    },
  }), [scrollToBottom, syncScrollAffordance])

  useEffect(() => {
    if (nearBottomRef.current) {
      scrollToBottom('smooth')
    } else {
      syncScrollAffordance()
    }
  }, [messages.length, scrollToBottom, syncScrollAffordance])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return undefined
    syncScrollAffordance()
    const observer = new ResizeObserver(() => syncScrollAffordance())
    observer.observe(el)
    return () => observer.disconnect()
  }, [syncScrollAffordance, segments.length])

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
    <div className="transport-chat-scroll-host" data-qid="transport:scroll:host">
      <div
        ref={scrollRef}
        className="tr-chat-scroll transport-chat-well"
        data-qid="transport:timeline"
        onScroll={syncScrollAffordance}
      >
        <div className="tr-proof-round">
          <div className="tr-round-header" data-qid="transport:timeline:round">
            <div className="tr-round-badge">{roundLabel}</div>
            <span className="tr-round-legend">Parties in this round: Human · Project agent · Subagent — Harness events inline</span>
          </div>

          <div className="tr-round-messages">
            {segments.length === 0 ? (
              <p className="tr-timeline-empty">No messages in this view. Try Handoffs or Full trace.</p>
            ) : (
              segments.map((seg) => {
                if (seg.type === 'nested') {
                  return (
                    <div
                      key={seg.nestId}
                      className="transport-chat-thread-group"
                      data-anchor={seg.anchorId}
                      data-qid="transport:nested-worker"
                    >
                      {seg.messages.map(({ message, index }) => (
                        <TransportMessageCard
                          key={message.id}
                          message={message}
                          skills={skills}
                          workerUrl={workerUrl}
                          {...attachmentPropsFor(message, seg.messages.map((m) => m.message))}
                          index={index}
                          selectedCallId={selectedCallId}
                          selectedMessageId={selectedMessageId}
                          onSelectCall={() => selectFromMessage(message, seg.messages.map((m) => m.message))}
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
                      {...attachmentPropsFor(seg.message)}
                      index={seg.index}
                      selectedCallId={selectedCallId}
                      selectedMessageId={selectedMessageId}
                      onSelectCall={() => selectFromMessage(seg.message)}
                    />
                  </div>
                )
              })
            )}
            <div ref={endRef} data-qid="transport:timeline:end" />
          </div>
        </div>
      </div>

      <button
        type="button"
        className={`transport-scroll-to-bottom${showScrollDown ? ' transport-scroll-to-bottom--visible' : ''}`}
        data-qid="transport:timeline:scroll-bottom"
        data-qs-action="TRANSPORT_SCROLL_TO_BOTTOM"
        aria-label="Scroll to bottom"
        title="Scroll to latest messages"
        onClick={() => scrollToBottom('smooth')}
      >
        <ChevronDown size={20} strokeWidth={2} aria-hidden />
      </button>
    </div>
  )
})

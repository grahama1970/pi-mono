/**
 * TransportCollaborationRoom — conversation-first three-way collaboration UI.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TransportRoomHeader } from './TransportRoomHeader'
import { TransportNowStrip } from './TransportNowStrip'
import { TransportCallInspector } from './TransportCallInspector'
import {
  buildCallInspectorView,
  defaultSelectedCallId,
  mergeTransportCalls,
} from './callInspector'
import { TransportMessageTimeline, type TransportTimelineHandle } from './TransportMessageTimeline'
import { TransportComposer } from './TransportComposer'
import type { ComposerSpeaker } from './TransportCollaborationRoom.types'
import { SPEAKER_LABEL } from './TransportCollaborationRoom.types'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import {
  fetchTransportDialog,
  fetchTransportRun,
  fetchTransportRunIndex,
  openTransportEventStream,
  postTransportDialog,
} from './transportClient'
import {
  MOCK_TRANSPORT_RUN_ID,
  mockTransportDialog,
  mockTransportRun,
  mockTransportEvents,
} from './transportFixtures'
import {
  historyEntryFromState,
  loadTransportRunHistory,
  mergeRunIndex,
  touchTransportRun,
  type TransportRunHistoryEntry,
} from './transportRunHistory'
import { TransportRunSidebar } from './TransportRunSidebar'
import './transport-room.css'
import { useSkillsCatalog } from '../../../hooks/useSkillsCatalog'
import { deriveRunHealth } from './runHealth'
import { extractSkillSlugs, primarySkillSlug } from './skillSyntax'
import type { TransportDialogResponse, TransportRunResponse, TransportStreamEvent } from './types'

export interface TransportCollaborationRoomProps {
  mode?: 'mock' | 'live'
  initialRunId?: string
}

const DEFAULT_LIVE_RUN_ID = 'otr-proof-r008'
const POLL_MS = 4000
const MAX_EVENTS = 250

export function TransportCollaborationRoom({
  mode = 'live',
  initialRunId,
}: TransportCollaborationRoomProps) {
  const isMock = mode === 'mock'
  const [runId, setRunId] = useState(initialRunId || (isMock ? MOCK_TRANSPORT_RUN_ID : DEFAULT_LIVE_RUN_ID))
  const [draftRunId, setDraftRunId] = useState(runId)
  const [runHistory, setRunHistory] = useState<TransportRunHistoryEntry[]>(() =>
    isMock
      ? [{ transport_run_id: MOCK_TRANSPORT_RUN_ID, dag_node_id: 'transport-review-r008', last_opened_at: Date.now() }]
      : loadTransportRunHistory(),
  )
  const [dialog, setDialog] = useState<TransportDialogResponse | null>(isMock ? mockTransportDialog : null)
  const [runState, setRunState] = useState<TransportRunResponse | null>(isMock ? mockTransportRun : null)
  const [events, setEvents] = useState<TransportStreamEvent[]>([])
  const [loading, setLoading] = useState(!isMock)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [streamConnected, setStreamConnected] = useState(false)
  const [lastRefreshAt, setLastRefreshAt] = useState<number | null>(isMock ? Date.now() : null)
  const [composerSpeaker, setComposerSpeaker] = useState<ComposerSpeaker>('human')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [metaOpen, setMetaOpen] = useState(true)
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null)
  const [highlightAnchor, setHighlightAnchor] = useState<string | null>(null)
  const streamPreset = 'handoffs' as const
  const timelineRef = useRef<TransportTimelineHandle>(null)
  const skills = useSkillsCatalog()

  useRegisterAction('transport:action:open-worker', {
    app: 'ux-lab',
    action: 'TRANSPORT_ROOM_OPEN_WORKER',
    label: 'Open OpenCode worker trace',
    description: 'Open browser_worker_url for full tool/reasoning trace',
  })

  const refreshRunIndex = useCallback(async () => {
    if (isMock) return
    try {
      const remote = await fetchTransportRunIndex()
      setRunHistory((local) => mergeRunIndex(local, remote))
    } catch {
      /* keep local */
    }
  }, [isMock])

  useEffect(() => { void refreshRunIndex() }, [refreshRunIndex])

  const refresh = useCallback(async () => {
    if (isMock) {
      setDialog(mockTransportDialog)
      setRunState(mockTransportRun)
      setError(null)
      setLastRefreshAt(Date.now())
      return
    }
    const id = runId.trim()
    if (!id) {
      setError('transport run id is required')
      return
    }
    setLoading(true)
    setError(null)
    try {
      const [dialogResp, runResp] = await Promise.all([
        fetchTransportDialog(id),
        fetchTransportRun(id),
      ])
      setDialog(dialogResp)
      setRunState(runResp)
      setRunHistory(touchTransportRun(id, historyEntryFromState(runResp.state)))
      setLastRefreshAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
      void refreshRunIndex()
    }
  }, [isMock, runId, refreshRunIndex])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (isMock || !runId.trim()) return undefined
    const timer = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(timer)
  }, [isMock, runId, refresh])

  useEffect(() => {
    if (isMock || !runId.trim()) {
      setStreamConnected(false)
      return undefined
    }
    const close = openTransportEventStream(
      runId.trim(),
      {
        onEvent: (event) => {
          setStreamConnected(true)
          setEvents((prev) => [...prev.slice(-(MAX_EVENTS - 1)), event])
          if (
            event.event_type === 'message.completed'
            || event.event_type === 'child.created'
            || event.event_type === 'transport.child.created'
            || event.delivery_state === 'completed'
          ) {
            void refresh()
          }
        },
        onError: () => setStreamConnected(false),
      },
      { timeoutS: 120, afterLine: 0 },
    )
    return () => {
      close()
      setStreamConnected(false)
    }
  }, [isMock, runId, refresh])

  const turns = dialog?.turns ?? []
  const observation = dialog?.observation ?? runState?.observation
  const workerUrl = observation?.browser_worker_url ?? ''
  const pendingCount = dialog?.pending_human?.length ?? 0
  const activeChild = runState?.state?.children?.find((c) => c.active) ?? runState?.state?.children?.slice(-1)[0]
  const runHealth = deriveRunHealth({
    runId,
    dagNodeId: runState?.state?.dag_node_id,
    pendingCount,
    deliveryState: activeChild?.delivery_state,
    sseLive: streamConnected,
    events,
    workerTraceAvailable: Boolean(workerUrl),
    isMock,
  })

  const calls = useMemo(
    () => mergeTransportCalls(dialog, runState),
    [dialog, runState],
  )

  useEffect(() => {
    if (isMock) {
      setEvents(mockTransportEvents)
    } else {
      setEvents([])
    }
    setSelectedCallId(null)
  }, [runId, isMock])

  useEffect(() => {
    if (calls.length === 0) {
      setSelectedCallId(null)
      return
    }
    setSelectedCallId((current) => {
      if (current && calls.some((c) => c.subagent_run_id === current)) return current
      return defaultSelectedCallId(calls, dialog)
    })
  }, [calls, dialog])

  const selectedCall = useMemo(
    () => calls.find((c) => c.subagent_run_id === selectedCallId) ?? null,
    [calls, selectedCallId],
  )

  const callInspector = useMemo(
    () => buildCallInspectorView({
      call: selectedCall,
      allEvents: events,
      turns,
      parentModel: observation?.parent_ui_model,
    }),
    [selectedCall, events, turns, observation?.parent_ui_model],
  )

  const handleSelectCall = useCallback((id: string) => {
    setSelectedCallId(id)
    setMetaOpen(true)
  }, [])

  const handleSend = useCallback(async (text: string) => {
    if (!text.trim()) return
    if (isMock) {
      setDialog((current) => {
        const base = current ?? mockTransportDialog
        return {
          ...base,
          turns: [
            ...base.turns,
            {
              message_id: `mock-${Date.now()}`,
              collaborator: composerSpeaker === 'human' ? 'human' : 'project_agent',
              speaker: SPEAKER_LABEL[composerSpeaker],
              text: text.trim(),
            },
          ],
        }
      })
      setLastRefreshAt(Date.now())
      return
    }
    setSending(true)
    try {
      const slugs = extractSkillSlugs(text)
      const primary = primarySkillSlug(text, skills)
      if (primary && slugs.length > 0) {
        await postTransportDialog(runId.trim(), {
          speaker: SPEAKER_LABEL[composerSpeaker],
          body: text.trim(),
          execute_skills: true,
        })
      } else {
        await postTransportDialog(runId.trim(), {
          speaker: SPEAKER_LABEL[composerSpeaker],
          body: text.trim(),
          execute_skills: false,
        })
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }, [isMock, runId, refresh, composerSpeaker, skills])

  const selectRun = useCallback((id: string) => {
    const trimmed = id.trim()
    if (!trimmed) return
    setRunId(trimmed)
    setDraftRunId(trimmed)
    setEvents([])
    setSelectedCallId(null)
    if (!isMock) {
      setRunHistory(touchTransportRun(trimmed, {}))
    }
  }, [isMock])

  return (
    <div className={`transport-room transport-room--${isMock ? 'mock' : 'live'}`} data-qid="transport:room:root">
      <div className={`transport-room__shell${sidebarCollapsed ? ' transport-room__shell--sidebar-collapsed' : ''}${metaOpen ? '' : ' transport-room__shell--meta-closed'}`}>
        <TransportRunSidebar
          runs={runHistory}
          activeRunId={runId}
          activeRunHealth={runHealth}
          calls={calls}
          selectedCallId={selectedCallId}
          onSelectCall={handleSelectCall}
          draftRunId={draftRunId}
          onDraftChange={setDraftRunId}
          onSelect={selectRun}
          onApplyDraft={() => selectRun(draftRunId.trim())}
          isMock={isMock}
          collapsed={sidebarCollapsed}
        />

        <div className="transport-main">
          <TransportRoomHeader
            runId={runId}
            onRefresh={() => void refresh()}
            loading={loading}
            streamConnected={streamConnected}
            isMock={isMock}
            lastRefreshAt={lastRefreshAt}
            metaOpen={metaOpen}
            onMetaToggle={() => setMetaOpen((v) => !v)}
            sidebarCollapsed={sidebarCollapsed}
            onSidebarToggle={() => setSidebarCollapsed((v) => !v)}
            runHealth={runHealth}
          />

          <TransportNowStrip health={runHealth} />

          {error && (
            <div className="transport-room-error" data-qid="transport:room:error" role="alert">{error}</div>
          )}

          <div className="transport-body-row">
            <main className="transport-chat-column" data-qid="transport:room:chat">
<TransportMessageTimeline
                ref={timelineRef}
                turns={turns}
                runId={runId}
                dagNodeId={runState?.state?.dag_node_id}
                skills={skills}
                workerUrl={workerUrl}
                streamPreset={streamPreset}
                highlightAnchor={highlightAnchor}
                onSelectCall={handleSelectCall}
              />
              <TransportComposer
                speaker={composerSpeaker}
                onSpeakerChange={setComposerSpeaker}
                onSend={(t) => void handleSend(t)}
                skills={skills}
                pendingCount={pendingCount}
              />
            </main>

            {metaOpen && (
              <TransportCallInspector
                inspector={callInspector}
                runHealth={runHealth}
                workerUrl={workerUrl}
                runId={runId}
                streamConnected={streamConnected}
                isMock={isMock}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

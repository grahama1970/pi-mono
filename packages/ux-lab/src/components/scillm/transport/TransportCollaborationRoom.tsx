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
import { SPEAKER_LABEL } from './TransportCollaborationRoom.types'
import type { ComposerSpeaker } from './TransportCollaborationRoom.types'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import {
  fetchMergedTransportRunIndex,
  fetchServeTransportDialog,
  fetchServeTransportRun,
  fetchTransportDialog,
  fetchTransportRun,
  isServeChildRunId,
  openServeEventStream,
  openTransportEventStream,
  postCollaborationDialog,
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
import { deriveRunHealth, type RunHealth } from './runHealth'
import { extractSkillSlugs, primarySkillSlug } from './skillSyntax'
import type { TransportDialogResponse, TransportRunResponse, TransportStreamEvent } from './types'

export interface TransportCollaborationRoomProps {
  mode?: 'mock' | 'live'
  initialRunId?: string
}

const TRANSPORT_UI_REV = '2026-06-02-persona'
const DEFAULT_LIVE_RUN_ID = ''
const POLL_MS = 4000
const SERVE_POLL_MS = 1500
const MAX_EVENTS = 250




function TransportServeChildBanner({ runId, runHealth }: { runId: string; runHealth: RunHealth }) {
  if (!isServeChildRunId(runId)) return null
  const terminal = runHealth.kind === 'completed' || runHealth.kind === 'aborted'
  return (
    <div className="transport-stale-run-banner" data-qid="transport:serve-child-banner" role="status">
      <strong>OpenCode serve child</strong>
      {' '}
      {terminal
        ? 'PDF Lab serve child — terminal timeline is available from poll + SSE replay.'
        : 'PDF Lab serve child — timeline streams live (poll + SSE).'}
      {' '}
      Project agent: <code>@project-agent</code> in the composer. <strong>Worker trace</strong> opens the full monitor.
    </div>
  )
}

function TransportStaleRunBanner({
  runId,
  activeChild,
}: {
  runId: string
  activeChild?: { agent_id?: string; agent?: string; subagent_kind?: string; role?: string } | null
}) {
  if (isServeChildRunId(runId)) return null
  if (!activeChild) return null
  if ((activeChild.agent_id || activeChild.agent || '').trim()) return null
  if (activeChild.subagent_kind === 'opencode_serve') return null
  return (
    <div className="transport-stale-run-banner" data-qid="transport:stale-run-banner" role="status">
      <strong>This run has no worker template id.</strong>
      {' '}
      Personas stay generic (e.g. “Reviewer”) until you start a new transport run with{' '}
      <code>agent_id</code> (e.g. <code>code-reviewer</code>).
      {' '}
      Run <code>scripts/transport_opencode_review_round.sh 009</code> in scillm, then open the new run id here.
    </div>
  )
}

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [metaOpen, setMetaOpen] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1400 : false,
  )
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null)
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null)
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
      const remote = await fetchMergedTransportRunIndex()
      setRunHistory((local) => mergeRunIndex(local, remote))
    } catch {
      /* keep local */
    }
  }, [isMock])

  useEffect(() => { void refreshRunIndex() }, [refreshRunIndex])
  useEffect(() => {
    if (isMock || initialRunId || runId.trim()) return
    void (async () => {
      try {
        const remote = await fetchMergedTransportRunIndex()
        if (!remote.length) return
        const newest = [...remote].sort((a, b) => (b.mtime_ms || 0) - (a.mtime_ms || 0))[0]
        if (newest?.transport_run_id) {
          setRunId(newest.transport_run_id)
          setDraftRunId(newest.transport_run_id)
        }
      } catch {
        /* keep empty */
      }
    })()
  }, [isMock, initialRunId, runId])



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
      const serveChild = isServeChildRunId(id)
      const [dialogResp, runResp] = await Promise.all([
        serveChild ? fetchServeTransportDialog(id) : fetchTransportDialog(id),
        serveChild ? fetchServeTransportRun(id) : fetchTransportRun(id),
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
    const serveChild = isServeChildRunId(runId.trim())
    const active = serveChild && (runState?.state?.children?.some((c) => c.active) ?? false)
    const ms = serveChild && active ? SERVE_POLL_MS : POLL_MS
    const timer = window.setInterval(() => void refresh(), ms)
    return () => window.clearInterval(timer)
  }, [isMock, runId, refresh, runState?.state?.children])

  useEffect(() => {
    if (isMock || !runId.trim()) {
      setStreamConnected(false)
      return undefined
    }
    const serveChild = isServeChildRunId(runId.trim())
    const openStream = serveChild ? openServeEventStream : openTransportEventStream
    const close = openStream(
      runId.trim(),
      {
        onEvent: (event) => {
          setStreamConnected(true)
          setEvents((prev) => [...prev.slice(-(MAX_EVENTS - 1)), event])
          if (
            event.event_type === 'message.completed'
            || event.event_type === 'child.created'
            || event.event_type === 'transport.child.created'
            || event.event_type === 'run.completed'
            || event.event_type === 'run.timeout'
            || event.event_type === 'run.failed'
            || event.delivery_state === 'completed'
            || event.delivery_state === 'timed_out'
            || event.delivery_state === 'failed'
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
    setSelectedMessageId(null)
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
      focusMessageId: selectedMessageId,
    }),
    [selectedCall, events, turns, observation?.parent_ui_model, selectedMessageId],
  )

  const handleSelectCall = useCallback((id: string, messageId?: string) => {
    setSelectedCallId(id)
    setSelectedMessageId(messageId ?? null)
    setMetaOpen(true)
  }, [])

  const handleSend = useCallback(async (body: string, speaker: ComposerSpeaker = 'human') => {
    const trimmed = body.trim()
    if (!trimmed) return
    if (isMock) {
      setDialog((current) => {
        const base = current ?? mockTransportDialog
        return {
          ...base,
          turns: [
            ...base.turns,
            {
              message_id: `mock-${Date.now()}`,
              collaborator: speaker === 'human' ? 'human' : 'project_agent',
              speaker: SPEAKER_LABEL[speaker],
              text: trimmed,
            },
          ],
        }
      })
      setLastRefreshAt(Date.now())
      return
    }
    setSending(true)
    try {
      const slugs = extractSkillSlugs(trimmed)
      const primary = primarySkillSlug(trimmed, skills)
      if (primary && slugs.length > 0) {
        await postCollaborationDialog(runId.trim(), {
          speaker: SPEAKER_LABEL[speaker],
          body: trimmed,
          execute_skills: true,
        })
      } else {
        await postCollaborationDialog(runId.trim(), {
          speaker: SPEAKER_LABEL[speaker],
          body: trimmed,
          execute_skills: false,
        })
      }
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSending(false)
    }
  }, [isMock, runId, refresh, skills])

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        const target = e.target as HTMLElement | null
        if (target?.closest('input, textarea, [contenteditable="true"]')) return
        e.preventDefault()
        const next = window.prompt('Transport run id', runId)
        if (next?.trim()) selectRun(next.trim())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [runId, selectRun])

  return (
    <div className={`transport-room transport-room--${isMock ? 'mock' : 'live'}`} data-qid="transport:room:root">
      <div className={`transport-room__shell${sidebarCollapsed ? ' transport-room__shell--sidebar-collapsed' : ''}${metaOpen ? '' : ' transport-room__shell--meta-closed'}`}>
        <TransportRunSidebar
          runs={runHistory}
          activeRunId={runId}
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
          {/* ui bundle: {TRANSPORT_UI_REV} */}
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
            dagNodeId={runState?.state?.dag_node_id}
          />

          {runHealth.nextAction ? <TransportNowStrip health={runHealth} /> : null}

          {error && (
            <div className="transport-room-error" data-qid="transport:room:error" role="alert">{error}</div>
          )}

          <TransportServeChildBanner runId={runId} runHealth={runHealth} />
          <TransportStaleRunBanner runId={runId} activeChild={dialog?.active_subagent ?? null} />

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
                calls={calls}
                events={events}
                selectedCallId={selectedCallId}
                selectedMessageId={selectedMessageId}
                onSelectCall={handleSelectCall}
              />
              <TransportComposer
                onSend={(t, s) => void handleSend(t, s)}
                skills={skills}
                sending={sending}
                pendingCount={pendingCount}
                readOnly={!isMock && (isServeChildRunId(runId) ? dialog?.project_agent_can_participate === false : dialog?.human_can_participate === false)}
                readOnlyNote={
                  !isMock && isServeChildRunId(runId)
                    ? 'Serve child (oc-*): live transcript + SSE. Type @project-agent … to post as project agent (mirrored into the OpenCode session).'
                    : undefined
                }
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

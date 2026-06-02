import { useMemo } from 'react'
import { Plus } from 'lucide-react'
import { LeftPane, LeftPaneSection, paneItemStyle, useLeftPaneSearch, useLeftPaneSort } from '../../common/LeftPane'
import { EMBRY, label } from '../../common/EmbryStyle'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import './transport-room.css'
import type { TransportRunHistoryEntry } from './transportRunHistory'
import type { RunHealth } from './runHealth'
import type { TransportCallRow } from './callInspector'

function paneButtonClass(selected: boolean): string {
  return selected ? 'transport-pane-item transport-pane-item--selected' : 'transport-pane-item'
}

function CallList({
  calls,
  selectedCallId,
  onSelectCall,
}: {
  calls: TransportCallRow[]
  selectedCallId: string | null
  onSelectCall: (id: string) => void
}) {
  if (calls.length === 0) {
    return (
      <div style={{ padding: '8px 16px 12px', color: EMBRY.dim, fontSize: 11 }}>
        No worker calls on this run yet.
      </div>
    )
  }
  return calls.map((call) => {
    const selected = call.subagent_run_id === selectedCallId
    const kind = call.subagent_kind || call.role || 'worker'
    const meta = [call.agent, call.delivery_state].filter(Boolean).join(' · ')
    return (
      <button
        key={call.subagent_run_id}
        type="button"
        className={paneButtonClass(selected)}
        style={paneItemStyle(selected)}
        data-qid={`transport:call:${call.subagent_run_id}`}
        data-qs-action="TRANSPORT_CALL_SELECT"
        title={`Inspect call ${call.subagent_run_id}`}
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelectCall(call.subagent_run_id)}
      >
        <span className="transport-pane-item__title" style={{ fontWeight: selected ? 700 : 400 }}>
          {kind}
          {call.attempt_id != null ? ` · attempt ${call.attempt_id}` : ''}
        </span>
        {meta ? <span className="transport-pane-item__meta">{meta}</span> : null}
        <span className="transport-pane-item__id">{call.subagent_run_id}</span>
      </button>
    )
  })
}

function RunList({
  runs,
  activeRunId,
  activeRunHealth,
  onSelect,
}: {
  runs: TransportRunHistoryEntry[]
  activeRunId: string
  activeRunHealth?: RunHealth
  onSelect: (runId: string) => void
}) {
  const search = useLeftPaneSearch().toLowerCase()
  const sortMode = useLeftPaneSort()
  const filtered = useMemo(() => {
    let list = runs
    if (search) {
      list = list.filter((r) =>
        r.transport_run_id.toLowerCase().includes(search)
        || (r.dag_node_id || '').toLowerCase().includes(search)
        || (r.title || '').toLowerCase().includes(search),
      )
    }
    if (sortMode === 'alpha') {
      return [...list].sort((a, b) => a.transport_run_id.localeCompare(b.transport_run_id))
    }
    return [...list].sort((a, b) => b.last_opened_at - a.last_opened_at)
  }, [runs, search, sortMode])

  if (filtered.length === 0) {
    return (
      <div style={{ padding: '12px 16px', color: EMBRY.dim, fontSize: 11 }}>
        No transport runs match.
      </div>
    )
  }

  return filtered.map((row) => {
    const selected = row.transport_run_id === activeRunId
    const dateLabel = row.last_opened_at ? new Date(row.last_opened_at).toLocaleString() : ''
    const meta = [row.dag_node_id, dateLabel].filter(Boolean).join(' • ')
    const healthColor =
      activeRunHealth?.kind === 'running' ? EMBRY.amber
      : activeRunHealth?.kind === 'completed' ? EMBRY.green
      : activeRunHealth?.kind === 'aborted' ? EMBRY.red
      : EMBRY.dim
    return (
      <button
        key={row.transport_run_id}
        type="button"
        className={paneButtonClass(selected)}
        style={paneItemStyle(selected)}
        data-qid={`transport:run:${row.transport_run_id}`}
        data-qs-action="TRANSPORT_RUN_SELECT"
        title={`Open transport run ${row.transport_run_id}`}
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(row.transport_run_id)}
      >
        <span className="transport-pane-item__title" style={{ fontWeight: selected ? 700 : 400 }}>
          {row.transport_run_id}
        </span>
        {meta ? <span className="transport-pane-item__meta">{meta}</span> : null}
        {selected && activeRunHealth ? (
          <span className="transport-pane-item__badge" style={{ color: healthColor }}>
            {activeRunHealth.label}
          </span>
        ) : null}
      </button>
    )
  })
}

export function TransportRunSidebar({
  runs,
  activeRunId,
  activeRunHealth,
  calls,
  selectedCallId,
  onSelectCall,
  draftRunId,
  onDraftChange,
  onSelect,
  onApplyDraft,
  isMock,
  collapsed = false,
}: {
  runs: TransportRunHistoryEntry[]
  activeRunId: string
  activeRunHealth?: RunHealth
  calls: TransportCallRow[]
  selectedCallId: string | null
  onSelectCall: (id: string) => void
  draftRunId: string
  onDraftChange: (value: string) => void
  onSelect: (runId: string) => void
  onApplyDraft: () => void
  isMock: boolean
  collapsed?: boolean
}) {
  useRegisterAction('transport:call-sidebar:select', {
    app: 'ux-lab',
    action: 'TRANSPORT_CALL_SELECT',
    label: 'Select transport call',
    description: 'Inspect a child worker call',
  })

  useRegisterAction('transport:run-sidebar:select', {
    app: 'ux-lab',
    action: 'TRANSPORT_RUN_SELECT',
    label: 'Select transport run',
    description: 'Open a transport collaboration run from history',
  })

  useRegisterAction('transport:room:apply-run', {
    app: 'ux-lab',
    action: 'TRANSPORT_ROOM_APPLY_RUN',
    label: 'Load transport run',
    description: 'Load the typed transport run id',
  })


  useRegisterAction('transport:room:run-id', {
    app: 'ux-lab',
    action: 'TRANSPORT_ROOM_RUN_ID_INPUT',
    label: 'Transport run id input',
    description: 'Type a transport run id to load',
  })

  return (
    <div className={collapsed ? 'transport-sidebar transport-sidebar--collapsed' : 'transport-sidebar'}>
      <LeftPane
        title={collapsed ? '' : 'Transport runs'}
        width={collapsed ? 56 : 260}
        searchable={!collapsed}
        collapsible={false}
        searchTestId="transport:runs:search"
        searchPlaceholder="Filter runs..."
        sortable={!collapsed}
        sortModes={['recent', 'alpha']}
      >
        {!isMock && !collapsed && (
          <div style={{ padding: '8px 12px', borderBottom: `1px solid ${EMBRY.border}` }}>
            <div style={{ ...label, marginBottom: 6 }}>Load run id</div>
            <input
              data-qid="transport:room:run-id"
              data-qs-action="TRANSPORT_ROOM_RUN_ID_INPUT"
              title="Transport run id"
              aria-label="Transport run id"
              value={draftRunId}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onApplyDraft() }}
              style={{
                width: '100%',
                boxSizing: 'border-box',
                padding: '8px 10px',
                background: EMBRY.bgDeep,
                border: `1px solid ${EMBRY.border}`,
                borderRadius: 6,
                color: EMBRY.white,
                fontSize: 11,
                fontFamily: 'monospace',
              }}
            />
            <button
              type="button"
              data-qid="transport:room:apply-run"
              data-qs-action="TRANSPORT_ROOM_APPLY_RUN"
              title="Load transport run"
              onClick={onApplyDraft}
              className="transport-btn transport-sidebar-run-btn"
              style={{
                marginTop: 8,
                width: '100%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                background: EMBRY.bgDeep,
                border: `1px solid ${EMBRY.border}`,
                borderRadius: 6,
                color: EMBRY.white,
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              <Plus size={14} />
              Load run
            </button>
          </div>
        )}
        <LeftPaneSection title={collapsed ? '' : 'History'}>
          <RunList
            runs={runs}
            activeRunId={activeRunId}
            activeRunHealth={activeRunHealth}
            onSelect={onSelect}
          />
        </LeftPaneSection>
        {!collapsed && calls.length > 0 && (
          <LeftPaneSection title="Calls">
            <CallList calls={calls} selectedCallId={selectedCallId} onSelectCall={onSelectCall} />
          </LeftPaneSection>
        )}
      </LeftPane>
    </div>
  )
}

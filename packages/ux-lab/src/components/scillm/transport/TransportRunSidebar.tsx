import { useMemo, useState } from 'react'
import { FolderOpen } from 'lucide-react'
import { LeftPane, LeftPaneSection, paneItemStyle, useLeftPaneSearch } from '../../common/LeftPane'
import { EMBRY } from '../../common/EmbryStyle'
import { useRegisterAction } from '../../../hooks/useRegisterAction'
import './transport-room.css'
import type { TransportRunHistoryEntry } from './transportRunHistory'
import type { TransportCallRow } from './callInspector'
import { formatAgo, runDisplayName } from './transportTime'

function paneButtonClass(selected: boolean, extra = ''): string {
  return `${selected ? 'transport-pane-item transport-pane-item--selected' : 'transport-pane-item'}${extra}`
}

function RunRow({
  row,
  selected,
  isActive,
  onSelect,
}: {
  row: TransportRunHistoryEntry
  selected: boolean
  isActive: boolean
  onSelect: () => void
}) {
  const name = runDisplayName(row)
  const ago = row.last_opened_at ? formatAgo(row.last_opened_at) : ''
  const tip = [name, row.transport_run_id, row.dag_node_id, row.last_opened_at ? new Date(row.last_opened_at).toLocaleString() : '']
    .filter(Boolean)
    .join('\n')

  return (
    <button
      type="button"
      className={paneButtonClass(selected)}
      style={paneItemStyle(selected)}
      data-qid={`transport:run:${row.transport_run_id}`}
      data-qs-action="TRANSPORT_RUN_SELECT"
      title={tip}
      aria-current={selected ? 'true' : undefined}
      onClick={onSelect}
    >
      {isActive ? (
        <span className="transport-run-dot transport-run-dot--active" aria-hidden />
      ) : (
        <span className="transport-run-dot-spacer" aria-hidden />
      )}
      <span className="transport-pane-item__body">
        <span className="transport-pane-item__title">{name}</span>
        {ago ? <span className="transport-pane-item__ago">{ago}</span> : null}
      </span>
    </button>
  )
}

export function TransportRunSidebar({
  runs,
  activeRunId,
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
  const [loadOpen, setLoadOpen] = useState(false)
  const search = useLeftPaneSearch().toLowerCase()

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

  const current = useMemo(
    () => runs.find((r) => r.transport_run_id === activeRunId),
    [runs, activeRunId],
  )

  const history = useMemo(() => {
    let list = runs.filter((r) => r.transport_run_id !== activeRunId)
    if (search) {
      list = list.filter((r) =>
        r.transport_run_id.toLowerCase().includes(search)
        || (r.dag_node_id || '').toLowerCase().includes(search),
      )
    }
    return [...list].sort((a, b) => b.last_opened_at - a.last_opened_at)
  }, [runs, activeRunId, search])

  return (
    <div className={collapsed ? 'transport-sidebar transport-sidebar--collapsed' : 'transport-sidebar'}>
      <LeftPane
        title={collapsed ? '' : 'Transport runs'}
        width={collapsed ? 56 : 248}
        searchable={!collapsed}
        collapsible={false}
        sortable={false}
        searchTestId="transport:runs:search"
        searchPlaceholder="Search runs…"
      >
        {!collapsed && !isMock && (
          <div className="transport-sidebar__load">
            <button
              type="button"
              className="transport-sidebar__load-toggle"
              data-qid="transport:room:load-run-toggle"
              title="Load run by id (Ctrl+O)"
              aria-expanded={loadOpen}
              onClick={() => setLoadOpen((v) => !v)}
            >
              <FolderOpen size={14} aria-hidden />
              <span>Load run…</span>
            </button>
            {loadOpen && (
              <div className="transport-sidebar__load-panel">
                <input
                  data-qid="transport:room:run-id"
                  data-qs-action="TRANSPORT_ROOM_RUN_ID_INPUT"
                  aria-label="Transport run id"
                  value={draftRunId}
                  onChange={(e) => onDraftChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onApplyDraft()
                    if (e.key === 'Escape') setLoadOpen(false)
                  }}
                  className="transport-sidebar__load-input"
                  placeholder="otr-proof-r008"
                />
                <button
                  type="button"
                  className="transport-sidebar__load-apply"
                  data-qid="transport:room:apply-run"
                  data-qs-action="TRANSPORT_ROOM_APPLY_RUN"
                  onClick={() => {
                    onApplyDraft()
                    setLoadOpen(false)
                  }}
                >
                  Open
                </button>
              </div>
            )}
          </div>
        )}

        {!collapsed && current && (
          <LeftPaneSection title="Current">
            <div className="transport-sidebar__current">
              <RunRow
                row={current}
                selected
                isActive
                onSelect={() => onSelect(current.transport_run_id)}
              />
            </div>
          </LeftPaneSection>
        )}

        {!collapsed && (
          <LeftPaneSection title="History">
            {history.length === 0 ? (
              <p className="transport-sidebar__empty">No other runs</p>
            ) : (
              history.map((row) => (
                <RunRow
                  key={row.transport_run_id}
                  row={row}
                  selected={false}
                  isActive={false}
                  onSelect={() => onSelect(row.transport_run_id)}
                />
              ))
            )}
          </LeftPaneSection>
        )}

        {!collapsed && calls.length > 0 && (
          <LeftPaneSection title="Calls">
            {calls.map((call) => {
              const selected = call.subagent_run_id === selectedCallId
              const kind = call.subagent_kind || call.role || 'worker'
              return (
                <button
                  key={call.subagent_run_id}
                  type="button"
                  className={paneButtonClass(selected)}
                  style={paneItemStyle(selected)}
                  data-qid={`transport:call:${call.subagent_run_id}`}
                  data-qs-action="TRANSPORT_CALL_SELECT"
                  title={call.subagent_run_id}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onSelectCall(call.subagent_run_id)}
                >
                  <span className="transport-pane-item__line">
                    <span className="transport-pane-item__title">{kind}</span>
                  </span>
                </button>
              )
            })}
          </LeftPaneSection>
        )}
      </LeftPane>
    </div>
  )
}

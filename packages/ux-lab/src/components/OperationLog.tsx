import { useState, useRef, useEffect } from 'react'
import { useAgentStore } from '../store/agentStore'
import { NVIS, OP_COLORS as THEME_OP_COLORS } from '../theme'
import { timeAgo } from '../utils/timeago'
import type { CanvasOperation } from '../types'

const OP_COLORS: Record<string, string> = {
  ...THEME_OP_COLORS,
}

const styles = {
  panel: {
    display: 'flex',
    flexDirection: 'column' as const,
    backgroundColor: NVIS.BG_SECONDARY,
    maxHeight: 320,
    overflow: 'hidden',
    borderTop: `1px solid ${NVIS.DIM}`,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '6px 10px',
    borderBottom: `1px solid ${NVIS.DIM}`,
    flexShrink: 0,
  },
  title: {
    fontSize: 11,
    fontWeight: 600,
    color: NVIS.WHITE,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  filterSelect: {
    fontSize: 11,
    backgroundColor: NVIS.BG_TERTIARY,
    color: NVIS.DIM,
    border: `1px solid ${NVIS.DIM}`,
    borderRadius: 4,
    padding: '2px 6px',
    outline: 'none',
  },
  list: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: 4,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 6px',
    borderRadius: 4,
    fontSize: 11,
    color: NVIS.DIM,
  },
  dot: (color: string) => ({
    width: 6,
    height: 6,
    borderRadius: '50%',
    backgroundColor: color,
    flexShrink: 0,
  }),
  agentName: {
    fontWeight: 600,
    color: NVIS.WHITE,
    flexShrink: 0,
  },
  opBadge: (color: string) => ({
    fontSize: 10,
    fontWeight: 600,
    color,
    backgroundColor: color + '1a',
    padding: '1px 5px',
    borderRadius: 3,
    flexShrink: 0,
  }),
  elementType: {
    fontSize: 10,
    color: NVIS.DIM,
    fontFamily: 'monospace',
    flexShrink: 0,
  },
  reason: {
    fontSize: 11,
    color: NVIS.DIM,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    flex: 1,
    minWidth: 0,
  },
  timestamp: {
    fontSize: 10,
    color: NVIS.DIM,
    fontFamily: 'monospace',
    flexShrink: 0,
    marginLeft: 'auto',
  },
  emptyState: {
    color: NVIS.DIM,
    fontSize: 12,
    textAlign: 'center' as const,
    padding: '20px 10px',
  },
}

/** Filter ops by agent name. Exported for testability. */
export function filterOps(ops: CanvasOperation[], agentFilter: string): CanvasOperation[] {
  if (agentFilter === 'all') return ops
  return ops.filter((op) => op.agent === agentFilter)
}

/** Truncate text to maxLen characters, adding ellipsis if needed. */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 1) + '\u2026'
}

export function OperationLog() {
  const ops = useAgentStore((s) => s.ops)
  const agents = useAgentStore((s) => s.agents)
  const [agentFilter, setAgentFilter] = useState('all')
  const listRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new ops arrive
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [ops.length])

  const filtered = filterOps(ops, agentFilter)
  const agentNames = Object.values(agents).map((a) => a.name)
  // Also collect agent ids that appear in ops but might not be registered
  const opAgentIds = [...new Set(ops.map((o) => o.agent))]

  return (
    <div style={styles.panel} data-testid="operation-log">
      <div style={styles.header}>
        <span style={styles.title}>Operations</span>
        <select
          style={styles.filterSelect}
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          data-testid="agent-filter"
        >
          <option value="all">All agents</option>
          {opAgentIds.map((id) => {
            const agent = agents[id]
            return (
              <option key={id} value={id}>
                {agent?.name ?? id}
              </option>
            )
          })}
        </select>
      </div>

      <div style={styles.list} ref={listRef}>
        {filtered.length === 0 ? (
          <div style={styles.emptyState}>No operations yet</div>
        ) : (
          filtered.map((op, i) => {
            const agent = agents[op.agent]
            const dotColor = agent?.color ?? NVIS.DIM
            const opColor = OP_COLORS[op.op] ?? NVIS.DIM
            const elementType = op.element?.type

            return (
              <div key={`${op.timestamp}-${i}`} style={styles.row} data-testid="op-row">
                <span style={styles.dot(dotColor)} />
                <span style={styles.agentName}>{agent?.name ?? op.agent}</span>
                <span style={styles.opBadge(opColor)}>{op.op}</span>
                {elementType && <span style={styles.elementType}>{elementType}</span>}
                {op.reason && <span style={styles.reason} title={op.reason}>{truncate(op.reason, 60)}</span>}
                <span style={styles.timestamp}>{timeAgo(op.timestamp)}</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

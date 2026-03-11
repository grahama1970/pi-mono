import { useAgentStore } from '../store/agentStore'
import { NVIS, STATUS_COLORS } from '../theme'
import type { AgentRegistration, CanvasOperation } from '../types'

/** Map agent status to display color */
export function statusDisplayColor(status: AgentRegistration['status']): string {
  return STATUS_COLORS[status]
}

/** Get the count of ops for a given agent */
export function opsCountForAgent(ops: CanvasOperation[], agentId: string): number {
  return ops.filter((op) => op.agent === agentId).length
}

/** Get the most recent op reason for an agent, or undefined */
export function lastOpReason(ops: CanvasOperation[], agentId: string): string | undefined {
  for (let i = ops.length - 1; i >= 0; i--) {
    if (ops[i].agent === agentId && ops[i].reason) {
      return ops[i].reason
    }
  }
  return undefined
}

const styles = {
  panel: {
    width: 220,
    backgroundColor: NVIS.BG_SECONDARY,
    borderLeft: `1px solid ${NVIS.DIM}`,
    display: 'flex',
    flexDirection: 'column' as const,
    overflow: 'hidden',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 12px',
    borderBottom: `1px solid ${NVIS.DIM}`,
  },
  headerTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: NVIS.WHITE,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  countBadge: {
    fontSize: 10,
    fontWeight: 600,
    backgroundColor: NVIS.BG_TERTIARY,
    color: NVIS.WHITE,
    padding: '1px 6px',
    borderRadius: 8,
    minWidth: 16,
    textAlign: 'center' as const,
  },
  content: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: 8,
  },
  agentItem: {
    padding: '8px 10px',
    borderRadius: 6,
    backgroundColor: NVIS.BG_TERTIARY,
    marginBottom: 6,
  },
  agentHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  colorDot: (color: string) => ({
    width: 8,
    height: 8,
    borderRadius: '50%',
    backgroundColor: color,
    flexShrink: 0,
  }),
  agentName: {
    fontSize: 13,
    fontWeight: 600,
    color: NVIS.WHITE,
    margin: 0,
  },
  statusText: (color: string) => ({
    fontSize: 11,
    color,
    margin: 0,
  }),
  opCount: {
    fontSize: 11,
    color: NVIS.DIM,
    margin: '2px 0 0',
  },
  lastReason: {
    fontSize: 10,
    color: NVIS.DIM,
    margin: '2px 0 0',
    fontStyle: 'italic' as const,
  },
  emptyState: {
    color: NVIS.DIM,
    fontSize: 12,
    textAlign: 'center' as const,
    padding: '20px 10px',
  },
}

export function AgentPanel() {
  const agents = useAgentStore((s) => s.agents)
  const ops = useAgentStore((s) => s.ops)

  const agentList = Object.values(agents)

  return (
    <div style={styles.panel} data-testid="agent-panel">
      <div style={styles.header}>
        <span style={styles.headerTitle}>Agents</span>
        <span style={styles.countBadge}>{agentList.length}</span>
      </div>
      <div style={styles.content}>
        {agentList.length === 0 ? (
          <div style={styles.emptyState}>No agents connected</div>
        ) : (
          agentList.map((agent) => {
            const count = opsCountForAgent(ops, agent.id)
            const reason = lastOpReason(ops, agent.id)
            const sColor = statusDisplayColor(agent.status)

            return (
              <div key={agent.id} style={styles.agentItem} data-testid={`agent-item-${agent.id}`}>
                <div style={styles.agentHeader}>
                  <div style={styles.colorDot(agent.color)} />
                  <span style={styles.agentName}>{agent.name}</span>
                </div>
                <div style={styles.statusText(sColor)}>{agent.status}</div>
                <div style={styles.opCount}>{count} operation{count !== 1 ? 's' : ''}</div>
                {reason && <div style={styles.lastReason}>{reason}</div>}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

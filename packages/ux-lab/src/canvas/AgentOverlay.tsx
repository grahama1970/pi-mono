import { useAgentStore } from '../store/agentStore'
import { useCanvasStore } from '../store/canvasStore'
import { STATUS_COLORS } from '../theme'
import type { AgentRegistration, AgentZone } from '../types'

/** Map agent status to a CSS color */
export function statusColor(status: AgentRegistration['status']): string {
  return STATUS_COLORS[status]
}

/** Convert a zone in canvas-space to screen-space CSS given viewport transform */
export function zoneToScreen(
  zone: AgentZone,
  viewport: { x: number; y: number; zoom: number },
): { left: number; top: number; width: number; height: number } {
  return {
    left: zone.x * viewport.zoom + viewport.x,
    top: zone.y * viewport.zoom + viewport.y,
    width: zone.width * viewport.zoom,
    height: zone.height * viewport.zoom,
  }
}

const styles = {
  overlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none' as const,
    overflow: 'hidden',
  },
  zone: (color: string, isWorking: boolean) => ({
    position: 'absolute' as const,
    border: `2px dashed ${color}`,
    backgroundColor: isWorking ? `${color}1a` : 'transparent', // 10% opacity hex
    borderRadius: 4,
    pointerEvents: 'none' as const,
  }),
  label: (color: string) => ({
    position: 'absolute' as const,
    top: -10,
    left: 4,
    backgroundColor: color,
    color: '#ffffff',
    fontSize: 10,
    fontWeight: 600,
    padding: '1px 6px',
    borderRadius: 8,
    whiteSpace: 'nowrap' as const,
    lineHeight: '16px',
  }),
  statusDot: (color: string, pulsing: boolean) => ({
    display: 'inline-block',
    width: 6,
    height: 6,
    borderRadius: '50%',
    backgroundColor: color,
    marginLeft: 4,
    verticalAlign: 'middle',
    animation: pulsing ? 'agent-pulse 1.5s ease-in-out infinite' : 'none',
  }),
}

export function AgentOverlay() {
  const agents = useAgentStore((s) => s.agents)
  const viewport = useCanvasStore((s) => s.viewport)

  const agentList = Object.values(agents)

  if (agentList.length === 0) return null

  return (
    <div style={styles.overlay} data-testid="agent-overlay">
      {agentList.map((agent) => {
        if (!agent.zone) return null

        const screen = zoneToScreen(agent.zone, viewport)
        const isWorking = agent.status === 'working'
        const dotColor = statusColor(agent.status)
        const isDone = agent.status === 'done'

        return (
          <div
            key={agent.id}
            style={{
              ...styles.zone(agent.color, isWorking),
              left: screen.left,
              top: screen.top,
              width: screen.width,
              height: screen.height,
            }}
            data-testid={`agent-zone-${agent.id}`}
          >
            <div style={styles.label(agent.color)}>
              {agent.name}
              {isDone ? (
                <span style={{ marginLeft: 4, fontSize: 10 }}>&#10003;</span>
              ) : (
                <span style={styles.statusDot(dotColor, isWorking)} />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

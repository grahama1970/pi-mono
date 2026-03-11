import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'http'
import { z } from 'zod'
import type { CanvasState } from './canvas-state.ts'
import type { AgentRegistration, CanvasOperation, CourseCorrection } from '../src/types.ts'

const MAX_OPS_LOG = 500

// --- Zod schemas for WS messages ---

const AgentRegisterSchema = z.object({
  type: z.literal('agent:register'),
  name: z.string().min(1),
  color: z.string().min(1),
  zone: z
    .object({
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .optional(),
})

const CanvasOperationSchema = z.object({
  agent: z.string(),
  op: z.enum(['create', 'update', 'delete', 'select']),
  timestamp: z.number(),
  element: z
    .object({
      type: z.string(),
      id: z.string().optional(),
      x: z.number().optional(),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      props: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  id: z.string().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
  reason: z.string().optional(),
})

const AgentOpSchema = z.object({
  type: z.literal('agent:op'),
  operation: CanvasOperationSchema,
})

const AgentStatusSchema = z.object({
  type: z.literal('agent:status'),
  agentId: z.string(),
  status: z.enum(['idle', 'working', 'done', 'error']),
})

const AgentPromptSchema = z.object({
  type: z.literal('agent:prompt'),
  from: z.string(),
  target: z.string(),
  message: z.string(),
})

const WsMessageSchema = z.discriminatedUnion('type', [
  AgentRegisterSchema,
  AgentOpSchema,
  AgentStatusSchema,
  AgentPromptSchema,
])

// --- State ---

const agents = new Map<string, AgentRegistration>()
const opsLog: CanvasOperation[] = []

// --- Exported state accessors ---

export function getAgents(): AgentRegistration[] {
  return Array.from(agents.values())
}

export function getAgent(id: string): AgentRegistration | undefined {
  return agents.get(id)
}

export function getOpsLog(last?: number): CanvasOperation[] {
  if (last !== undefined && last > 0) {
    return opsLog.slice(-last)
  }
  return [...opsLog]
}

export function registerAgent(data: {
  name: string
  color: string
  zone?: { x: number; y: number; width: number; height: number }
}): AgentRegistration {
  const id = crypto.randomUUID()
  const agent: AgentRegistration = {
    id,
    name: data.name,
    color: data.color,
    zone: data.zone,
    status: 'idle',
  }
  agents.set(id, agent)
  return agent
}

export function unregisterAgent(id: string): boolean {
  return agents.delete(id)
}

export function applyOperation(
  op: CanvasOperation,
  canvasState: CanvasState,
): void {
  switch (op.op) {
    case 'create':
      if (op.element) {
        canvasState.addElement({
          type: op.element.type,
          x: op.element.x ?? 0,
          y: op.element.y ?? 0,
          width: op.element.width ?? 100,
          height: op.element.height ?? 100,
          props: op.element.props ?? {},
        })
      }
      break
    case 'update':
      if (op.id) {
        const updates: Record<string, unknown> = {}
        if (op.element) {
          if (op.element.x !== undefined) updates.x = op.element.x
          if (op.element.y !== undefined) updates.y = op.element.y
          if (op.element.width !== undefined) updates.width = op.element.width
          if (op.element.height !== undefined)
            updates.height = op.element.height
          if (op.element.props !== undefined) updates.props = op.element.props
        }
        if (op.props) updates.props = op.props
        canvasState.updateElement(op.id, updates)
      }
      break
    case 'delete':
      if (op.id) {
        canvasState.removeElement(op.id)
      }
      break
    case 'select':
      if (op.id) {
        canvasState.setSelection([op.id])
      }
      break
  }

  // Append to circular ops log
  opsLog.push(op)
  if (opsLog.length > MAX_OPS_LOG) {
    opsLog.splice(0, opsLog.length - MAX_OPS_LOG)
  }
}

export function clearState(): void {
  agents.clear()
  opsLog.length = 0
}

// --- WebSocket broadcast helpers ---

let wssInstance: WebSocketServer | null = null

export function broadcastToAll(msg: unknown): number {
  if (!wssInstance) return 0
  const data = JSON.stringify(msg)
  let count = 0
  for (const client of wssInstance.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data)
      count++
    }
  }
  return count
}

export function getConnectedClientCount(): number {
  if (!wssInstance) return 0
  let count = 0
  for (const client of wssInstance.clients) {
    if (client.readyState === WebSocket.OPEN) {
      count++
    }
  }
  return count
}

function broadcastToOthers(sender: WebSocket, msg: unknown): void {
  if (!wssInstance) return
  const data = JSON.stringify(msg)
  for (const client of wssInstance.clients) {
    if (client !== sender && client.readyState === WebSocket.OPEN) {
      client.send(data)
    }
  }
}

// --- Setup ---

export function createWebSocketServer(
  server: Server,
  canvasState: CanvasState,
): WebSocketServer {
  const wss = new WebSocketServer({ server })
  wssInstance = wss

  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(raw))
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }))
        return
      }

      const result = WsMessageSchema.safeParse(parsed)
      if (!result.success) {
        ws.send(
          JSON.stringify({
            type: 'error',
            message: 'Invalid message',
            details: result.error.issues,
          }),
        )
        return
      }

      const msg = result.data

      switch (msg.type) {
        case 'agent:register': {
          const agent = registerAgent({
            name: msg.name,
            color: msg.color,
            zone: msg.zone,
          })
          broadcastToAll({ type: 'agent:registered', agent })
          break
        }

        case 'agent:op': {
          applyOperation(msg.operation, canvasState)
          broadcastToOthers(ws, {
            type: 'agent:op',
            operation: msg.operation,
          })
          break
        }

        case 'agent:status': {
          const agent = agents.get(msg.agentId)
          if (agent) {
            agent.status = msg.status
            broadcastToAll({
              type: 'agent:status-changed',
              agentId: msg.agentId,
              status: msg.status,
            })
          }
          break
        }

        case 'agent:prompt': {
          const correction: CourseCorrection = {
            from: msg.from,
            target: msg.target,
            message: msg.message,
            timestamp: Date.now(),
          }
          broadcastToAll({ type: 'agent:correction', correction })
          break
        }
      }
    })
  })

  return wss
}

// Re-export the schema for use in REST routes
export { CanvasOperationSchema }

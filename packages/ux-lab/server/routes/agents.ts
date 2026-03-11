import { Router } from 'express'
import { z } from 'zod'
import type { CanvasState } from '../canvas-state.ts'
import {
  registerAgent,
  unregisterAgent,
  getAgents,
  getAgent,
  getOpsLog,
  applyOperation,
  broadcastToAll,
  getConnectedClientCount,
  CanvasOperationSchema,
} from '../ws-handler.ts'

const RegisterAgentSchema = z.object({
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

const OpsArraySchema = z.array(CanvasOperationSchema)

export function createAgentsRouter(state: CanvasState): Router {
  const router = Router()

  // POST /api/v1/agents/register — register a new agent
  router.post('/register', (req, res) => {
    const result = RegisterAgentSchema.safeParse(req.body)
    if (!result.success) {
      res
        .status(400)
        .json({ error: 'Validation failed', details: result.error.issues })
      return
    }
    const agent = registerAgent(result.data)
    broadcastToAll({ type: 'agent:registered', agent })
    res.status(201).json(agent)
  })

  // GET /api/v1/agents — list all registered agents
  router.get('/', (_req, res) => {
    res.json(getAgents())
  })

  // POST /api/v1/agents/:id/ops — submit operations for an agent
  router.post('/:id/ops', (req, res) => {
    const agent = getAgent(req.params.id)
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }

    const result = OpsArraySchema.safeParse(req.body)
    if (!result.success) {
      res
        .status(400)
        .json({ error: 'Validation failed', details: result.error.issues })
      return
    }

    const applied = []
    for (const op of result.data) {
      applyOperation(op, state)
      broadcastToAll({ type: 'agent:op', operation: op })
      applied.push(op)
    }

    res.json({ applied: applied.length, ops: applied })
  })

  // DELETE /api/v1/agents/:id — unregister an agent
  router.delete('/:id', (req, res) => {
    const removed = unregisterAgent(req.params.id)
    if (!removed) {
      res.status(404).json({ error: 'Agent not found' })
      return
    }
    res.status(204).send()
  })

  return router
}

const PromptSchema = z.object({
  message: z.string().min(1),
  target: z.string().default('all'),
})

// Separate router for /api/v1/ops/log and /api/v1/prompt (mounted at /api/v1)
export function createOpsLogRouter(): Router {
  const router = Router()

  router.get('/ops/log', (req, res) => {
    const last = parseInt(req.query.last as string) || 50
    res.json(getOpsLog(last))
  })

  // POST /api/v1/prompt — send a course correction to agents
  router.post('/prompt', (req, res) => {
    const result = PromptSchema.safeParse(req.body)
    if (!result.success) {
      res
        .status(400)
        .json({ error: 'Validation failed', details: result.error.issues })
      return
    }

    const { message, target } = result.data
    const delivered = broadcastToAll({
      type: 'agent:correction',
      from: 'human',
      target,
      message,
      timestamp: Date.now(),
    })

    res.json({ delivered_ws: delivered })
  })

  return router
}

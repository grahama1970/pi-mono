import { Router } from 'express'
import { z } from 'zod'
import { decomposePrompt, createAgentAssignments } from '../design-orchestrator.ts'

const DesignRequestSchema = z.object({
  prompt: z.string().min(1),
  phases: z.array(z.enum(['skeleton', 'content', 'refine'])).optional(),
  agents: z.number().int().min(1).max(10).optional(),
  brief: z.string().optional(),
})

export function createDesignRouter(): Router {
  const router = Router()

  // POST /api/v1/design — decompose a prompt into a design plan
  router.post('/design', (req, res) => {
    const result = DesignRequestSchema.safeParse(req.body)
    if (!result.success) {
      res
        .status(400)
        .json({ error: 'Validation failed', details: result.error.issues })
      return
    }

    const { prompt, phases, agents: _agents } = result.data

    const plan = decomposePrompt(prompt)

    // Override phases if caller specified
    if (phases && phases.length > 0) {
      plan.phases = phases
    }

    const assignments = createAgentAssignments(plan)

    res.json({
      plan: {
        prompt: plan.prompt,
        zones: plan.zones,
        phases: plan.phases,
        agentCount: plan.agentCount,
      },
      assignments: assignments.map((a) => ({
        agentName: a.agentName,
        color: a.color,
        zone: a.zone,
        ops: {
          skeleton: a.ops[0] ?? [],
          content: a.ops[1] ?? [],
          refine: a.ops[2] ?? [],
        },
      })),
    })
  })

  return router
}

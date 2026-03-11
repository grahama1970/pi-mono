import { Router } from 'express'
import { z } from 'zod'
import type { CanvasState } from '../canvas-state.ts'

const CreateElementSchema = z.object({
  type: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number().optional().default(100),
  height: z.number().optional().default(100),
  props: z.record(z.string(), z.unknown()).optional().default({}),
})

const UpdateElementSchema = z.object({
  type: z.string().optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
})

export function createElementsRouter(state: CanvasState): Router {
  const router = Router()

  router.get('/', (_req, res) => {
    res.json(state.getAllElements())
  })

  router.get('/:id', (req, res) => {
    const element = state.getElement(req.params.id)
    if (!element) {
      res.status(404).json({ error: 'Element not found' })
      return
    }
    res.json(element)
  })

  router.post('/', (req, res) => {
    const result = CreateElementSchema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues })
      return
    }
    const element = state.addElement(result.data)
    res.status(201).json(element)
  })

  router.patch('/:id', (req, res) => {
    const result = UpdateElementSchema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues })
      return
    }
    const updated = state.updateElement(req.params.id, result.data)
    if (!updated) {
      res.status(404).json({ error: 'Element not found' })
      return
    }
    res.json(updated)
  })

  router.delete('/:id', (req, res) => {
    const removed = state.removeElement(req.params.id)
    if (!removed) {
      res.status(404).json({ error: 'Element not found' })
      return
    }
    res.status(204).send()
  })

  return router
}

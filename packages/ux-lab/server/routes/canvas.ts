import { Router } from 'express'
import { z } from 'zod'
import type { CanvasState } from '../canvas-state.ts'
import { exportCanvas } from '../../src/export/index.ts'

const ExportSchema = z.object({
  format: z.enum(['json', 'react', 'svg', 'png']),
})

const LoadSchema = z.object({
  elements: z.record(
    z.string(),
    z.object({
      id: z.string(),
      type: z.string(),
      x: z.number(),
      y: z.number(),
      width: z.number(),
      height: z.number(),
      props: z.record(z.string(), z.unknown()),
    }),
  ),
})

export function createCanvasRouter(state: CanvasState): Router {
  const router = Router()

  router.get('/selection', (_req, res) => {
    res.json({ selectedIds: state.selectedIds })
  })

  router.post('/undo', (_req, res) => {
    const success = state.undo()
    res.json({ success, elements: state.getAllElements() })
  })

  router.post('/redo', (_req, res) => {
    const success = state.redo()
    res.json({ success, elements: state.getAllElements() })
  })

  router.post('/export', (req, res) => {
    const result = ExportSchema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues })
      return
    }
    const elements = state.getAllElements()
    const { format } = result.data

    if (format === 'json') {
      res.json({ format, content: elements })
    } else {
      const exportResult = exportCanvas(elements, format)
      res.json({ format, content: exportResult.content })
    }
  })

  router.get('/save', (_req, res) => {
    res.json(state.toJSON())
  })

  router.post('/load', (req, res) => {
    const result = LoadSchema.safeParse(req.body)
    if (!result.success) {
      res.status(400).json({ error: 'Validation failed', details: result.error.issues })
      return
    }
    state.loadFromJSON(result.data.elements)
    res.json({ success: true, elements: state.getAllElements() })
  })

  return router
}

import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { CanvasState } from './canvas-state.ts'
import { createElementsRouter } from './routes/elements.ts'
import { createCanvasRouter } from './routes/canvas.ts'
import { createAgentsRouter, createOpsLogRouter } from './routes/agents.ts'
import { createCompositionRouter } from './routes/composition.ts'
import { createDocumentRouter } from './routes/document.ts'
import { createDesignRouter } from './routes/design.ts'
import { createWebSocketServer } from './ws-handler.ts'

export const state = new CanvasState()

export const app = express()

app.use(cors({ origin: 'http://localhost:3000' }))
app.use(express.json())

// Health check
const startTime = Date.now()
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    elements: Object.keys(state.elements).length,
    uptime: Math.floor((Date.now() - startTime) / 1000),
  })
})

// API routes
app.use('/api/v1/elements', createElementsRouter(state))
app.use('/api/v1', createCanvasRouter(state))
app.use('/api/v1/agents', createAgentsRouter(state))
app.use('/api/v1', createOpsLogRouter())
app.use('/api/v1', createCompositionRouter())
app.use('/api/v1', createDocumentRouter(state))
app.use('/api/v1', createDesignRouter())

// Error handling middleware
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err.stack)
    res.status(500).json({ error: 'Internal server error' })
  },
)

// Create HTTP server for both Express and WebSocket
export const httpServer = createServer(app)

// Attach WebSocket server
export const wss = createWebSocketServer(httpServer, state)

// Only listen when run directly (not when imported for tests)
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('server/index.ts') ||
    process.argv[1].endsWith('server/index.js'))

if (isMain) {
  const PORT = process.env.PORT ?? 3001
  httpServer.listen(PORT, () => {
    console.log(`Paper Clone API running on http://localhost:${PORT}`)
  })
}

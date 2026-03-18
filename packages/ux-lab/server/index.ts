/**
 * UX Lab API Server
 *
 * Thin proxy layer — all data flows through the memory daemon Unix socket.
 * No bespoke reimplementations of skill logic. No hardcoded file paths.
 *
 * Routes:
 *   GET  /api/health           — server health check
 *   ALL  /api/memory/*         — proxy to memory daemon (recall, learn, list, etc.)
 *   POST /api/scillm           — proxy to scillm LLM gateway
 *   GET  /api/models           — discover available LLM models
 */

import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { request as httpRequest } from 'http'

const app = express()
app.use(cors({ origin: /http:\/\/localhost:\d+/ }))
app.use(express.json())

const MEMORY_SOCKET = '/run/user/1000/embry/memory.sock'
const SCILLM_URL = process.env.SCILLM_URL ?? 'http://localhost:4001'

// ── Health check ────────────────────────────────────────────────────────────

const startTime = Date.now()
app.get('/api/health', async (_req, res) => {
  // Also check memory daemon reachability
  let memoryOk = false
  try {
    const health = await proxyPost('/health', null)
    memoryOk = health?.status === 'ok'
  } catch { /* daemon down */ }

  res.json({
    status: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
    memory_daemon: memoryOk ? 'connected' : 'unreachable',
  })
})

// ── Memory daemon proxy ─────────────────────────────────────────────────────
// This is the ONLY data path. All SPARTA data lives in ArangoDB and is accessed
// via the daemon's /recall endpoint with collections filtering.
//
// Frontend usage:
//   fetch('/api/memory/recall', { method: 'POST', body: JSON.stringify({
//     q: "GPS spoofing",
//     collections: ["sparta_qra"],
//     k: 20
//   })})
//
// Available SPARTA collections:
//   sparta_controls      — 11K controls (SPARTA, ATT&CK, NIST, CWE, D3FEND)
//   sparta_qra           — 218K QRAs with grounding scores
//   sparta_relationships  — 131K cross-framework edges with NRS scores
//   technique_knowledge  — technique-level ground truth from URL content
//
// Available daemon endpoints:
//   POST /recall    — search with BM25 + semantic + graph traversal
//   POST /learn     — store new lessons
//   GET  /health    — daemon health check

app.all('/api/memory/{*path}', (req, res) => {
  const memoryPath = '/' + (Array.isArray(req.params.path) ? req.params.path.join('/') : req.params.path)
  const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? JSON.stringify(req.body) : undefined

  const options = {
    socketPath: MEMORY_SOCKET,
    path: memoryPath,
    method: req.method,
    headers: { 'Content-Type': 'application/json' },
  }

  const proxyReq = httpRequest(options, (proxyRes) => {
    res.status(proxyRes.statusCode ?? 500)
    const chunks: Buffer[] = []
    proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
    proxyRes.on('end', () => {
      const data = Buffer.concat(chunks).toString()
      try {
        res.json(JSON.parse(data))
      } catch {
        res.send(data)
      }
    })
  })

  proxyReq.on('error', (err) => {
    res.status(502).json({ error: 'Memory daemon unreachable', detail: err.message })
  })

  if (body) proxyReq.write(body)
  proxyReq.end()
})

// ── scillm LLM proxy ───────────────────────────────────────────────────────
// Proxies to the scillm Docker service for LLM completions.
// Frontend sends standard OpenAI-compatible chat completion requests.

app.post('/api/scillm', (req, res) => {
  const body = JSON.stringify(req.body)
  const url = new URL(`${SCILLM_URL}/v1/chat/completions`)

  const proxyReq = httpRequest(
    {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    },
    (proxyRes) => {
      res.status(proxyRes.statusCode ?? 500)
      const chunks: Buffer[] = []
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
      proxyRes.on('end', () => {
        const data = Buffer.concat(chunks).toString()
        try {
          res.json(JSON.parse(data))
        } catch {
          res.send(data)
        }
      })
    }
  )
  proxyReq.on('error', (err) => {
    res.status(502).json({ error: 'scillm unreachable', detail: err.message })
  })
  proxyReq.write(body)
  proxyReq.end()
})

// ── Model discovery ─────────────────────────────────────────────────────────

app.get('/api/models', async (_req, res) => {
  const groups: { label: string; models: string[] }[] = []

  // scillm aliases (always available)
  groups.push({
    label: 'scillm aliases',
    models: ['text', 'vlm', 'local-text', 'moonshot-text'],
  })

  // Ollama local models (dynamic)
  try {
    const ollamaRes = await fetch('http://localhost:11434/api/tags')
    const ollamaData = await ollamaRes.json() as { models?: { name: string }[] }
    const ollamaModels = (ollamaData.models || [])
      .map((m: { name: string }) => m.name)
      .filter((name: string) => !name.startsWith('embry/'))
    if (ollamaModels.length > 0) {
      groups.push({ label: 'Ollama (local)', models: ollamaModels })
    }
  } catch { /* ollama not running */ }

  res.json({ groups })
})

// ── Internal helper ─────────────────────────────────────────────────────────

function proxyPost(path: string, body: object | null = null): Promise<any> {
  return new Promise((resolve, reject) => {
    const method = body ? 'POST' : 'GET'
    const data = body ? JSON.stringify(body) : undefined
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (data) headers['Content-Length'] = String(Buffer.byteLength(data))
    const req = httpRequest(
      {
        socketPath: MEMORY_SOCKET,
        path,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
          catch { reject(new Error('Invalid JSON from memory daemon')) }
        })
      }
    )
    req.on('error', reject)
    if (data) req.write(data)
    req.end()
  })
}

// ── Start ───────────────────────────────────────────────────────────────────

const httpServer = createServer(app)
const PORT = process.env.PORT ?? 3001

httpServer.listen(PORT, () => {
  console.log(`UX Lab API on http://localhost:${PORT}`)
  console.log(`  Memory daemon: ${MEMORY_SOCKET}`)
  console.log(`  scillm: ${SCILLM_URL}`)
})

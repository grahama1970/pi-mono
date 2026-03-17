import express from 'express'
import cors from 'cors'
import { createServer } from 'http'
import { request as httpRequest } from 'http'
import { execFile } from 'child_process'
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'fs'
import { readdir } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

const app = express()
app.use(cors({ origin: /http:\/\/localhost:\d+/ }))
app.use(express.json())

const MEMORY_SOCKET = '/run/user/1000/embry/memory.sock'

// Health check
const startTime = Date.now()
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: Math.floor((Date.now() - startTime) / 1000) })
})

// Proxy to /memory daemon via Unix socket
app.all('/api/memory/{*path}', (req, res) => {
  const memoryPath = '/' + req.params.path
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

// What-if analysis proxy to /lean4-prove CLI
const LEAN4_PROVE_DIR = '/home/graham/workspace/experiments/pi-mono/.pi/skills/lean4-prove'
app.post('/api/what-if', (req, res) => {
  const { control, param, value, dry_run } = req.body as {
    control?: string; param?: string; value?: string; dry_run?: boolean
  }
  if (!control || !param || value === undefined) {
    res.status(400).json({ error: 'Missing required fields: control, param, value' })
    return
  }
  const args = [
    'qra_consistency.py', 'what-if',
    '--control', control,
    '--param', param,
    '--value', String(value),
    '--output-format', 'json',
  ]
  if (dry_run !== false) args.push('--dry-run')

  execFile('python', args, { cwd: LEAN4_PROVE_DIR, timeout: 30000 }, (err, stdout, stderr) => {
    if (err) {
      res.status(500).json({ error: 'what-if failed', detail: stderr || err.message })
      return
    }
    try {
      res.json(JSON.parse(stdout))
    } catch {
      res.status(500).json({ error: 'Invalid JSON from what-if', raw: stdout.slice(0, 500) })
    }
  })
})

// Helper: proxy POST to memory daemon and return parsed JSON
function memoryPost(path: string, body: object): Promise<any> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = httpRequest(
      {
        socketPath: MEMORY_SOCKET,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
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
    req.write(data)
    req.end()
  })
}

// Load test cases from ArangoDB — random sample, by topic search, or by control
app.post('/api/test-cases/sample', async (req, res) => {
  const { limit = 10 } = req.body as { limit?: number }
  try {
    const data = await memoryPost('/list', {
      collection: 'sparta_qra',
      limit: Math.min(limit, 50),
      random: true,
    })
    const rows = (data.documents || []).map((d: any) => ({
      id: d.control_id || d._key,
      label: d.control_id ? `${d.control_id} — ${(d.question || '').slice(0, 60)}` : d._key,
      question: d.question,
      answer: d.answer,
      confidence: d.confidence,
      cells: {},
    }))
    res.json({ count: rows.length, rows })
  } catch (err: any) {
    res.status(502).json({ error: 'Memory daemon error', detail: err.message })
  }
})

app.post('/api/test-cases/search', async (req, res) => {
  const { query, limit = 10 } = req.body as { query: string; limit?: number }
  if (!query) { res.status(400).json({ error: 'Missing: query' }); return }
  try {
    const data = await memoryPost('/recall', {
      q: query,
      limit: Math.min(limit, 50),
    })
    const rows = (data.results || []).map((d: any) => ({
      id: d.control_id || d._key || d.qra_id,
      label: d.control_id ? `${d.control_id} — ${(d.question || '').slice(0, 60)}` : (d.problem || d.question || '').slice(0, 70),
      question: d.question || d.problem,
      answer: d.answer || d.solution,
      confidence: d.confidence,
      cells: {},
    }))
    res.json({ count: rows.length, rows })
  } catch (err: any) {
    res.status(502).json({ error: 'Memory daemon error', detail: err.message })
  }
})

// Proxy to scillm LLM gateway
const SCILLM_URL = 'http://localhost:4001'
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

// Prompt Lab eval — runs prompt_lab.py eval via CLI
// CLI: prompt_lab.py eval -p <prompt_name> -m <model> -n <cases> [-v]
const PROMPT_LAB_DIR = '/home/graham/workspace/experiments/pi-mono/.pi/skills/prompt-lab'
app.post('/api/prompt-lab/eval', (req, res) => {
  const { promptName, model, cases } = req.body as {
    promptName?: string; model?: string; cases?: number
  }
  const args = [
    `${PROMPT_LAB_DIR}/run.sh`, 'eval',
    '-p', promptName || 'taxonomy_v1',
    '-m', model || 'text',
    '-n', String(cases || 5),
    '-v',
  ]

  execFile('bash', args, { cwd: PROMPT_LAB_DIR, timeout: 120000, env: { ...process.env, VIRTUAL_ENV: '' } }, (err, stdout, stderr) => {
    if (err) {
      res.status(500).json({ error: 'prompt-lab eval failed', detail: (stderr || err.message).slice(0, 2000) })
      return
    }
    // Try to parse JSON from stdout, fall back to raw
    try {
      res.json(JSON.parse(stdout))
    } catch {
      res.json({ raw: stdout.slice(0, 5000), stderr: stderr.slice(0, 1000) })
    }
  })
})

// Prompt Lab optimize — runs prompt_lab.py optimize
app.post('/api/prompt-lab/optimize', (req, res) => {
  const { promptName, model } = req.body as {
    promptName?: string; model?: string
  }
  const args = [
    `${PROMPT_LAB_DIR}/run.sh`, 'optimize',
    '-p', promptName || 'taxonomy_v1',
    '-m', model || 'text',
  ]

  execFile('bash', args, { cwd: PROMPT_LAB_DIR, timeout: 180000, env: { ...process.env, VIRTUAL_ENV: '' } }, (err, stdout, stderr) => {
    if (err) {
      res.status(500).json({ error: 'prompt-lab optimize failed', detail: (stderr || err.message).slice(0, 2000) })
      return
    }
    try {
      res.json(JSON.parse(stdout))
    } catch {
      res.json({ raw: stdout.slice(0, 5000), stderr: stderr.slice(0, 1000) })
    }
  })
})

// Run eval for a single test case against selected models via scillm
app.post('/api/eval/run', (req, res) => {
  const { systemPrompt, question, models, judgeModel } = req.body as {
    systemPrompt: string; question: string; models: string[]; judgeModel?: string
  }
  if (!systemPrompt || !question || !models?.length) {
    res.status(400).json({ error: 'Missing: systemPrompt, question, models[]' })
    return
  }

  const results: Record<string, unknown> = {}
  let completed = 0

  for (const model of models) {
    const body = JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
      temperature: 0.1,
      max_tokens: 512,
    })

    const url = new URL(`${SCILLM_URL}/v1/chat/completions`)
    const startMs = Date.now()

    const proxyReq = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (proxyRes) => {
        const chunks: Buffer[] = []
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
        proxyRes.on('end', () => {
          const latencyMs = Date.now() - startMs
          const raw = Buffer.concat(chunks).toString()
          try {
            const parsed = JSON.parse(raw)
            const output = parsed.choices?.[0]?.message?.content ?? ''
            results[model] = { output, latencyMs, status: 'ok' }
          } catch {
            results[model] = { output: raw.slice(0, 500), latencyMs, status: 'error' }
          }
          completed++
          if (completed === models.length) {
            res.json({ question, results })
          }
        })
      }
    )
    proxyReq.on('error', (err) => {
      results[model] = { output: '', latencyMs: 0, status: 'error', error: err.message }
      completed++
      if (completed === models.length) {
        res.json({ question, results })
      }
    })
    proxyReq.write(body)
    proxyReq.end()
  }
})

// Dynamic model discovery — aggregates Ollama, scillm aliases, and subagents
app.get('/api/models', async (_req, res) => {
  const groups: { label: string; models: string[] }[] = []

  // 1. scillm aliases (always available)
  groups.push({
    label: 'scillm aliases',
    models: ['text', 'deepseek', 'vlm', 'local-text', 'moonshot-text'],
  })

  // 2. Ollama local models
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

  // 3. Subagents (Docker /subagent-service)
  groups.push({
    label: 'Subagents (Docker)',
    models: [
      'claude-sonnet-4-20250514',
      'claude-opus-4-20250514',
      'gpt-5.3-codex',
      'gemini-2.5-pro',
    ],
  })

  res.json({ groups })
})

// Self-correct a prompt using scillm meta-model
app.post('/api/convergence/self-correct', async (req, res) => {
  const { prompt, model, failures } = req.body as {
    prompt: string; model?: string; failures?: { question: string; output: string; reason: string }[]
  }
  if (!prompt) {
    res.status(400).json({ error: 'Missing: prompt' })
    return
  }

  const failureExamples = (failures || [])
    .map((f, i) => `Failure ${i + 1}:\n  Q: ${f.question}\n  Output: ${f.output?.slice(0, 200)}\n  Reason: ${f.reason}`)
    .join('\n\n')

  const metaPrompt = `You are a prompt engineering expert. The following system prompt produced failures when evaluated against security QRA test cases.

CURRENT PROMPT:
${prompt}

FAILURES:
${failureExamples || 'No specific failures provided.'}

Analyze the failures and produce an IMPROVED version of the system prompt that addresses the root causes. Return ONLY the improved prompt text, nothing else.`

  const body = JSON.stringify({
    model: model || 'text',
    messages: [{ role: 'user', content: metaPrompt }],
    temperature: 0.3,
    max_tokens: 1024,
  })

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
      const chunks: Buffer[] = []
      proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk))
      proxyRes.on('end', () => {
        const raw = Buffer.concat(chunks).toString()
        try {
          const parsed = JSON.parse(raw)
          const corrected = parsed.choices?.[0]?.message?.content ?? ''
          res.json({ corrected_prompt: corrected.trim() })
        } catch {
          res.status(500).json({ error: 'Invalid JSON from scillm', raw: raw.slice(0, 500) })
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

// Create evidence case for a test case row
app.post('/api/evidence-case', (req, res) => {
  const { question, controlId } = req.body as { question: string; controlId?: string }
  if (!question) {
    res.status(400).json({ error: 'Missing: question' })
    return
  }

  const EVIDENCE_CASE_DIR = '/home/graham/workspace/experiments/pi-mono/.pi/skills/create-evidence-case'
  const args = ['run.sh', 'build', '--question', question, '--output-format', 'json']
  if (controlId) args.push('--control', controlId)

  execFile('bash', args, { cwd: EVIDENCE_CASE_DIR, timeout: 120000 }, (err, stdout, stderr) => {
    if (err) {
      res.status(500).json({ error: 'evidence-case failed', detail: stderr || err.message })
      return
    }
    try {
      res.json(JSON.parse(stdout))
    } catch {
      res.json({ raw: stdout.slice(0, 5000) })
    }
  })
})

// Load test cases from training JSONL
const TRAIN_JSONL = join(homedir(), '.pi/skills/create-gpt/data/qra-assessor/sft/train.jsonl')
app.post('/api/test-cases/jsonl', (req, res) => {
  const { limit = 10, random = false } = req.body as { limit?: number; random?: boolean }
  try {
    const lines = readFileSync(TRAIN_JSONL, 'utf-8').split('\n').filter(Boolean)
    let selected: { idx: number; line: string }[]
    if (random && limit < lines.length) {
      const indices = new Set<number>()
      while (indices.size < Math.min(limit, lines.length)) {
        indices.add(Math.floor(Math.random() * lines.length))
      }
      selected = Array.from(indices).map((i) => ({ idx: i, line: lines[i] }))
    } else {
      selected = lines.slice(0, limit).map((line, i) => ({ idx: i, line }))
    }

    const rows = selected.map(({ idx, line }) => {
      const obj = JSON.parse(line)
      const msgs = obj.messages || []
      const userMsg = msgs.find((m: any) => m.role === 'user')?.content || ''
      const assistantMsg = msgs.find((m: any) => m.role === 'assistant')?.content || ''
      let expectedVerdict = 'FAIL'
      try {
        const parsed = JSON.parse(assistantMsg)
        if (parsed.grade === 'PASS') expectedVerdict = 'PASS'
      } catch {
        if (/\bPASS\b/.test(assistantMsg)) expectedVerdict = 'PASS'
      }
      return { id: String(idx + 1), question: userMsg, answer: assistantMsg, expectedVerdict }
    })

    res.json({ count: rows.length, rows })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to read JSONL', detail: err.message })
  }
})

// List available cascade grader prompt versions
const PROMPTS_DIR = join(homedir(), '.pi/skills/prompt-lab/prompts')
app.get('/api/prompt-versions', async (_req, res) => {
  try {
    const files = await readdir(PROMPTS_DIR)
    const versions = files
      .filter((f) => f.startsWith('cascade_grader_') && f.endsWith('.txt'))
      .sort()
      .map((f) => ({
        name: f.replace('.txt', ''),
        path: join(PROMPTS_DIR, f),
        content: readFileSync(join(PROMPTS_DIR, f), 'utf-8'),
      }))
    res.json({ versions })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to read prompt versions', detail: err.message })
  }
})

// Save a new prompt version to /prompt-lab/prompts
app.post('/api/prompt-versions/save', async (req, res) => {
  const { content, baseName = 'cascade_grader' } = req.body as { content: string; baseName?: string }
  if (!content) {
    res.status(400).json({ error: 'Missing: content' })
    return
  }
  try {
    mkdirSync(PROMPTS_DIR, { recursive: true })
    const files = await readdir(PROMPTS_DIR)
    const versionNums = files
      .filter((f) => f.startsWith(`${baseName}_v`) && f.endsWith('.txt'))
      .map((f) => {
        const m = f.match(/_v(\d+)\.txt$/)
        return m ? parseInt(m[1], 10) : 0
      })
    const nextVersion = versionNums.length > 0 ? Math.max(...versionNums) + 1 : 1
    const name = `${baseName}_v${nextVersion}`
    const filePath = join(PROMPTS_DIR, `${name}.txt`)
    writeFileSync(filePath, content, 'utf-8')
    res.json({ saved: true, name, path: filePath })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save prompt version', detail: err.message })
  }
})

// Save human label overrides
const GROUND_TRUTH_DIR = join(homedir(), '.pi/skills/prompt-lab/ground_truth')
app.post('/api/ground-truth/save', (req, res) => {
  const { labels } = req.body as { labels: { id: string; question: string; verdict: string }[] }
  if (!labels?.length) {
    res.status(400).json({ error: 'Missing: labels[]' })
    return
  }
  try {
    mkdirSync(GROUND_TRUTH_DIR, { recursive: true })
    const lines = labels.map((l) => JSON.stringify({ id: l.id, question: l.question, verdict: l.verdict, timestamp: new Date().toISOString() }))
    appendFileSync(join(GROUND_TRUTH_DIR, 'human_labels.jsonl'), lines.join('\n') + '\n')
    res.json({ saved: labels.length })
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to save labels', detail: err.message })
  }
})

const httpServer = createServer(app)

const PORT = process.env.PORT ?? 3001
httpServer.listen(PORT, () => {
  console.log(`UX Lab API on http://localhost:${PORT} (proxies /memory at ${MEMORY_SOCKET}, scillm at ${SCILLM_URL})`)
})

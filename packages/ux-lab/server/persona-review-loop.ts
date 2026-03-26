/**
 * Persona Review Convergence Loop
 *
 * Runs per-feature-group reviews across 3 personas via /subagent-service SSE.
 * Each round: review all groups → fix weaknesses → re-review with prior context.
 * Updates persona-review-report.md and stores each review to /memory.
 *
 * Usage: npx tsx server/persona-review-loop.ts [--round N] [--group NAME]
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { request as httpRequest } from 'http'
import { Socket } from 'net'

const __dirname = dirname(fileURLToPath(import.meta.url))
const WORKSPACE = resolve(__dirname, '..')
const REPORT_PATH = resolve(WORKSPACE, 'persona-review-report.md')
const REPORT_DIR = resolve(WORKSPACE, 'convergence-reports')
const MEMORY_SOCKET = '/run/user/1000/embry/memory.sock'
const SUBAGENT_PORT = Number(process.env.SUBAGENT_PORT || 8620)
const TARGET_SCORE = 8.0
const MAX_ROUNDS = 5

// ── Persona config ──────────────────────────────────────────────────────────

interface Persona {
  name: string
  slug: string
  manifest: string
  model: string
  agentMd: string
}

const PERSONAS: Persona[] = [
  {
    name: 'Tim Blazytko', slug: 'tim-blazytko',
    manifest: 'tim-blazytko-review.test.json', model: 'sonnet',
    agentMd: resolve(WORKSPACE, '../../.pi/agents/tim-blazytko/AGENTS.md'),
  },
  {
    name: 'Gynvael Coldwind', slug: 'gynvael-coldwind',
    manifest: 'gynvael-coldwind-review.test.json', model: 'sonnet',
    agentMd: resolve(WORKSPACE, '../../.pi/agents/gynvael-coldwind/AGENTS.md'),
  },
  {
    name: 'LiveOverflow', slug: 'liveoverflow',
    manifest: 'liveoverflow-review.test.json', model: 'sonnet',
    agentMd: resolve(WORKSPACE, '../../.pi/agents/liveoverflow/AGENTS.md'),
  },
]

// ── Group → source file mapping ─────────────────────────────────────────────

const GROUP_FILES: Record<string, string> = {
  'first-impressions': 'src/components/binary-explorer/BinaryExplorerView.tsx (lines 1-200)',
  'graph-navigation': 'src/components/binary-explorer/BinaryGraph.tsx',
  'graph-exploration': 'src/components/binary-explorer/BinaryGraph.tsx',
  'graph-interaction': 'src/components/binary-explorer/BinaryGraph.tsx',
  'code-view': 'src/components/binary-explorer/CodePane.tsx',
  'node-detail': 'src/components/binary-explorer/BinaryExplorerView.tsx (lines 800-1100)',
  'chat-analysis': 'src/components/binary-explorer/BinaryExplorerView.tsx (lines 1200-1500)',
  'chat-exploration': 'src/components/binary-explorer/BinaryExplorerView.tsx (lines 1200-1500)',
  'table-view': 'src/components/binary-explorer/BinaryExplorerView.tsx (lines 1000-1200)',
  'symbol-tree': 'src/components/binary-explorer/SymbolTree.tsx',
  'progressive-disclosure': 'src/components/binary-explorer/BinaryExplorerView.tsx (lines 580-650)',
  'search-and-filter': 'src/components/binary-explorer/BinaryExplorerView.tsx (lines 400-550)',
  'vulnerability-hunting': 'src/components/binary-explorer/BinaryExplorerView.tsx (lines 1300-1500)',
  'visual-design': 'src/components/common/EmbryStyle.ts',
  'perspective-views': 'src/components/binary-explorer/BinaryExplorerView.tsx (lines 300-400)',
  'scene-management': 'src/components/binary-explorer/BinaryExplorerView.tsx (lines 550-620)',
  'investigation-journal': 'src/components/common/InvestigationJournal.tsx',
  'taxonomy-integration': 'src/components/binary-explorer/BinaryExplorerView.tsx (lines 270-350)',
  'automation': 'server/index.ts',
  'data-structures': 'src/components/binary-explorer/BinaryExplorerView.tsx (lines 800-1000)',
  'cross-references': 'src/components/binary-explorer/BinaryExplorerView.tsx (lines 900-1000)',
  'state-machines': 'src/components/binary-explorer/BinaryExplorerView.tsx (lines 1100-1200)',
  'performance': 'src/components/binary-explorer/BinaryGraph.tsx',
  'context-menu': 'src/components/common/ContextMenu.tsx',
  'ctf-workflow': 'src/components/common/InvestigationJournal.tsx',
  'learning-path': 'src/components/binary-explorer/BinaryExplorerView.tsx (lines 100-300)',
  'accessibility': 'src/components/binary-explorer/BinaryExplorerView.tsx',
  'error-states': 'src/components/binary-explorer/BinaryExplorerView.tsx (lines 1500-1550)',
}

// ── Types ───────────────────────────────────────────────────────────────────

interface ReviewResult {
  round: number
  persona: string
  group: string
  tests: number
  source: string
  score: number
  verdict: string
  weaknesses: string[]
  changes: string[]
  professionalImpact: string
  priorWeaknessAddressed: string
  durationMs: number
}

interface GroupInfo {
  group: string
  testCount: number
  criteria: string[]
}

// ── Load manifest groups ────────────────────────────────────────────────────

function loadGroups(manifestPath: string): GroupInfo[] {
  const manifest = JSON.parse(readFileSync(resolve(WORKSPACE, manifestPath), 'utf-8'))
  const groups: Record<string, GroupInfo> = {}
  for (const test of manifest.tests) {
    const g = test.group || 'unknown'
    if (!groups[g]) groups[g] = { group: g, testCount: 0, criteria: [] }
    groups[g].testCount++
    for (const step of test.steps || []) {
      if (step.action === 'persona_review' && step.review_criteria) {
        if (!groups[g].criteria.includes(step.review_criteria)) {
          groups[g].criteria.push(step.review_criteria)
        }
      }
    }
  }
  return Object.values(groups)
}

// ── SSE stream subagent call ────────────────────────────────────────────────

function streamSubagent(prompt: string, model: string): Promise<{ result: string; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ model, prompt, workspace: WORKSPACE })
    const req = httpRequest(
      { hostname: 'localhost', port: SUBAGENT_PORT, path: '/chat/stream', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let resultText = ''
        let durationMs = 0
        let currentEvent = ''
        let buffer = ''

        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString()
          const lines = buffer.split('\n')
          buffer = lines.pop() || '' // keep incomplete line

          for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed.startsWith('event: ')) {
              currentEvent = trimmed.slice(7)
            } else if (trimmed.startsWith('data: ')) {
              try {
                const data = JSON.parse(trimmed.slice(6))
                if (currentEvent === 'text') {
                  // Live progress — print to console
                  const msg = data?.message?.content
                  if (Array.isArray(msg)) {
                    for (const c of msg) {
                      if (c.type === 'tool_use') process.stdout.write(`    [tool] ${c.name}\n`)
                    }
                  }
                } else if (currentEvent === 'result') {
                  resultText = data.result || ''
                } else if (currentEvent === 'done') {
                  durationMs = data.duration_ms || 0
                }
              } catch {}
            }
          }
        })
        res.on('end', () => resolve({ result: resultText, durationMs }))
        res.on('error', reject)
      }
    )
    req.on('error', reject)
    req.setTimeout(300_000, () => { req.destroy(); reject(new Error('timeout')) })
    req.write(payload)
    req.end()
  })
}

// ── Parse review JSON from response ─────────────────────────────────────────

function parseReview(text: string): { score: number; verdict: string; weaknesses: string[]; changes: string[]; professionalImpact: string } | null {
  // Try whole text as JSON
  try { const p = JSON.parse(text); if (p.score) return p } catch {}
  // Try markdown fence
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
  if (fenceMatch) { try { const p = JSON.parse(fenceMatch[1]); if (p.score) return p } catch {} }
  // Try brace matching
  let depth = 0, start = -1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') { if (depth === 0) start = i; depth++ }
    else if (text[i] === '}') { depth--; if (depth === 0 && start >= 0) {
      try { const p = JSON.parse(text.slice(start, i + 1)); if (p.score) return p } catch {}
      start = -1
    }}
  }
  return null
}

// ── Store to /memory via Unix socket ────────────────────────────────────────

function memoryLearn(problem: string, solution: string, tags: string[]): Promise<void> {
  return new Promise((res) => {
    try {
      const sock = new Socket()
      sock.connect(MEMORY_SOCKET, () => {
        const body = JSON.stringify({ problem, solution, tags, scope: 'binary-explorer-reviews' })
        const reqStr = `POST /learn HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
        sock.write(reqStr)
        sock.on('data', () => { sock.end(); res() })
        sock.on('error', () => res())
        setTimeout(() => { sock.end(); res() }, 5000)
      })
      sock.on('error', () => res())
    } catch { res() }
  })
}

// ── Build review prompt ─────────────────────────────────────────────────────

function buildPrompt(persona: Persona, group: GroupInfo, sourceFile: string, priorWeaknesses: string[]): string {
  const agentProfile = existsSync(persona.agentMd)
    ? readFileSync(persona.agentMd, 'utf-8').slice(0, 1500) : ''

  const criteriaBlock = group.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')

  let priorBlock = ''
  if (priorWeaknesses.length > 0) {
    priorBlock = `\n## Prior Round Weaknesses (verify if fixed)\n${priorWeaknesses.map((w, i) => `${i + 1}. ${w}`).join('\n')}\n`
  }

  return `You are ${persona.slug.replace(/-/g, ' ')}, reverse engineering expert.

${agentProfile}

## Task: Review "${group.group}" feature (${group.testCount} test cases)

Read the source file: ${sourceFile}
If the file is large, read the section indicated in parentheses.

## Review Criteria (from test manifest)
${criteriaBlock}
${priorBlock}
## Response Format

Return ONLY JSON:
{"verdict":"PASS" or "FAIL","score":1-10,"strengths":["..."],"weaknesses":["..."],"changes":["..."],"professional_impact":"..."}

9-10=production (IDA/Ghidra level), 7-8=usable for real work, 5-6=promising, 3-4=prototype, 1-2=broken.
Be specific. Reference line numbers and variable names from the source.`
}

// ── Update markdown report ──────────────────────────────────────────────────

function appendToReport(review: ReviewResult): void {
  let content = existsSync(REPORT_PATH) ? readFileSync(REPORT_PATH, 'utf-8') : ''
  if (!content.includes('| Round |')) {
    content = `# Binary Explorer Persona Review Report

One row per persona × group × round. Filter/group by any column.

| Round | Persona | Group | Tests | Source | Score | Verdict | Top Weakness | Prior Weakness Addressed |
|-------|---------|-------|-------|--------|-------|---------|--------------|-------------------------|\n`
  }
  const topW = review.weaknesses[0] || '—'
  const row = `| ${review.round} | ${review.persona} | ${review.group} | ${review.tests} | ${review.source} | ${review.score}/10 | ${review.verdict} | ${topW.slice(0, 60)} | ${review.priorWeaknessAddressed.slice(0, 40)} |`
  content += row + '\n'
  writeFileSync(REPORT_PATH, content)
}

// ── Main loop ───────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true })

  // Reset report
  writeFileSync(REPORT_PATH, '')

  // Load all persona groups
  const personaGroups: { persona: Persona; groups: GroupInfo[] }[] = PERSONAS.map(p => ({
    persona: p,
    groups: loadGroups(p.manifest),
  }))

  const totalGroups = personaGroups.reduce((sum, pg) => sum + pg.groups.length, 0)
  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  PERSONA REVIEW CONVERGENCE LOOP`)
  console.log(`  ${totalGroups} group reviews per round (${PERSONAS.length} personas)`)
  console.log(`  Target: ${TARGET_SCORE}/10 avg | Max: ${MAX_ROUNDS} rounds`)
  console.log(`${'═'.repeat(60)}\n`)

  // Track prior weaknesses per persona+group for round N+1 context
  const priorWeaknesses: Record<string, string[]> = {}

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`  ROUND ${round}`)
    console.log(`${'─'.repeat(60)}`)

    const roundResults: ReviewResult[] = []

    for (const { persona, groups } of personaGroups) {
      console.log(`\n  ${persona.name} (${groups.length} groups, model: ${persona.model})`)

      // Run groups concurrently in batches of 3
      for (let i = 0; i < groups.length; i += 3) {
        const batch = groups.slice(i, i + 3)
        const promises = batch.map(async (group) => {
          const key = `${persona.slug}:${group.group}`
          const prior = priorWeaknesses[key] || []
          const sourceFile = GROUP_FILES[group.group] || 'src/components/binary-explorer/BinaryExplorerView.tsx'
          const prompt = buildPrompt(persona, group, sourceFile, prior)

          console.log(`    ${group.group} (${group.testCount} tests)...`)

          try {
            const { result, durationMs } = await streamSubagent(prompt, persona.model)
            const parsed = result ? parseReview(result) : null

            if (!parsed) {
              console.log(`      EMPTY (${durationMs}ms)`)
              return null
            }

            const review: ReviewResult = {
              round,
              persona: persona.name,
              group: group.group,
              tests: group.testCount,
              source: sourceFile.split('/').pop() || '',
              score: parsed.score,
              verdict: parsed.verdict,
              weaknesses: parsed.weaknesses || [],
              changes: parsed.changes || [],
              professionalImpact: parsed.professional_impact || '',
              priorWeaknessAddressed: prior.length > 0 ? `R${round - 1}: ${prior[0]?.slice(0, 40)}` : '—',
              durationMs,
            }

            console.log(`      ${parsed.score}/10 (${parsed.verdict}) [${(durationMs / 1000).toFixed(0)}s]`)

            // Update report
            appendToReport(review)

            // Store to /memory
            await memoryLearn(
              `PERSONA_REVIEW:binary-explorer:r${round}:${persona.slug}:${group.group} — ${parsed.score}/10`,
              JSON.stringify(review),
              ['persona-review', 'binary-explorer', persona.slug, group.group, `round-${round}`]
            )

            // Track weaknesses for next round
            priorWeaknesses[key] = parsed.weaknesses?.slice(0, 3) || []

            return review
          } catch (err: any) {
            console.log(`      ERROR: ${err.message}`)
            return null
          }
        })

        const results = await Promise.all(promises)
        roundResults.push(...results.filter((r): r is ReviewResult => r !== null))
      }
    }

    // Round summary
    const scores = roundResults.map(r => r.score)
    const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
    const passed = scores.filter(s => s >= 8).length

    console.log(`\n  ROUND ${round} SUMMARY: ${avg.toFixed(1)}/10 avg | ${passed}/${scores.length} PASS`)

    // Save round JSON
    writeFileSync(
      resolve(REPORT_DIR, `round-${round}.json`),
      JSON.stringify({ round, avg, passed, total: scores.length, results: roundResults }, null, 2)
    )

    if (avg >= TARGET_SCORE) {
      console.log(`\n  >>> TARGET REACHED: ${avg.toFixed(1)} >= ${TARGET_SCORE} <<<`)
      break
    }

    if (round < MAX_ROUNDS) {
      // Collect top weaknesses for fix guidance
      const allWeaknesses = roundResults.flatMap(r => r.weaknesses)
      const weakCounts: Record<string, number> = {}
      for (const w of allWeaknesses) { weakCounts[w] = (weakCounts[w] || 0) + 1 }
      const topWeak = Object.entries(weakCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)

      console.log(`\n  TOP WEAKNESSES TO FIX:`)
      for (const [w, count] of topWeak) {
        console.log(`    ${count}x ${w.slice(0, 80)}`)
      }

      console.log(`\n  Waiting for fixes before round ${round + 1}...`)
      console.log(`  Create file: convergence-reports/round-${round}-fixed.signal`)

      const signalPath = resolve(REPORT_DIR, `round-${round}-fixed.signal`)
      const start = Date.now()
      while (Date.now() - start < 600_000) {
        if (existsSync(signalPath)) { console.log(`  Signal received.\n`); break }
        await new Promise(r => setTimeout(r, 3000))
      }
    }
  }

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  CONVERGENCE LOOP COMPLETE`)
  console.log(`  Report: ${REPORT_PATH}`)
  console.log(`${'═'.repeat(60)}\n`)
}

main().catch(console.error)

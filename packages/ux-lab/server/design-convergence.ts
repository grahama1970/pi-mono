/**
 * Design Convergence Loop
 *
 * Self-improvement loop for Binary Explorer UX:
 * 1. Take screenshots of current state
 * 2. Send to 3 persona subagents (Tim=Codex, Gynvael=Claude, LiveOverflow=Gemini)
 * 3. Each persona reviews via VLM + /memory recall + their AGENTS.md expertise
 * 4. Collect scores + criticisms
 * 5. Project agent (this script's caller) applies fixes
 * 6. Re-run until avg >= 8 or max 10 rounds
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const SERVER_URL = 'http://localhost:3001'
const TARGET_SCORE = 8.0
const MAX_ROUNDS = 10
const SAMPLE_SIZE = 5 // tests per persona per round
const REPORT_DIR = resolve(__dirname, '../convergence-reports')
const CONVERGENCE_PROMPT_PATH = resolve(__dirname, '../../../.pi/skills/prompt-lab/prompts/convergence_advice_v1.txt')

// Persona → subagent mapping
const PERSONAS = [
    {
      slug: 'tim-blazytko',
      manifest: 'tim-blazytko-review.test.json',
      model: 'codex',       // agentic, automation-focused
      agentMd: resolve(__dirname, '../../../.pi/agents/tim-blazytko/AGENTS.md'),
    },
    {
      slug: 'gynvael-coldwind',
      manifest: 'gynvael-coldwind-review.test.json',
      model: 'claude-opus-4-6',  // methodical, precise
      agentMd: resolve(__dirname, '../../../.pi/agents/gynvael-coldwind/AGENTS.md'),
    },
    {
      slug: 'liveoverflow',
      manifest: 'liveoverflow-review.test.json',
      model: 'gemini-3-flash-preview', // educational, visual
      agentMd: resolve(__dirname, '../../../.pi/agents/liveoverflow/AGENTS.md'),
    },
]

const WORKSPACE = resolve(__dirname, '..')

interface ReviewResult {
  persona: string
  testId: string
  score: number
  weaknesses: string[]
  suggestions: string[]
  fullText: string
}

interface RoundReport {
  round: number
  avgScore: number
  reviewCount: number
  perPersona: { persona: string; avg: number; count: number }[]
  criticisms: { category: string; count: number; examples: string[] }[]
  reviews: ReviewResult[]
  timestamp: string
}

// ── Test Runner integration ──────────────────────────────────────────────────

async function runSampledReviews(manifest: string, sampleSize: number, round: number): Promise<string> {
  // Load manifest to pick a rotating sample
  const mRes = await fetch(`${SERVER_URL}/api/test-runner/manifest?file=${encodeURIComponent(manifest)}`)
  const mData = await mRes.json() as any
  const tests: any[] = mData.tests || []

  const groups: Record<string, string[]> = {}
  for (const t of tests) {
    groups[t.group] = groups[t.group] || []
    groups[t.group].push(t.id)
  }
  const groupNames = Object.keys(groups)
  const sample: string[] = []
  for (let i = 0; i < sampleSize && i < groupNames.length; i++) {
    const gIdx = (i + (round - 1) * sampleSize) % groupNames.length
    const group = groups[groupNames[gIdx]]
    const tIdx = (round - 1) % group.length
    sample.push(group[tIdx])
  }

  const res = await fetch(`${SERVER_URL}/api/test-runner/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file: manifest, tests: sample, baseUrl: 'http://localhost:5173' }),
  })
  const { runId } = await res.json() as { runId: string }
  return runId
}

async function pollRunResults(runId: string, timeoutMs = 180_000): Promise<any[]> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`${SERVER_URL}/api/test-runner/results/${runId}`)
    const data = await res.json() as any
    if (data.status !== 'RUNNING') return data.results || []
    await new Promise(r => setTimeout(r, 5000))
  }
  const res = await fetch(`${SERVER_URL}/api/test-runner/results/${runId}`)
  const data = await res.json() as any
  return data.results || []
}

function extractReviews(results: any[], persona: string): ReviewResult[] {
  const reviews: ReviewResult[] = []
  for (const r of results) {
    for (const s of r.steps || []) {
      const actual = String(s.actual || '')
      const scoreMatch = actual.match(/Score:\s*(\d+(?:\.\d+)?)\s*\/\s*10/)
      if (!scoreMatch) continue
      const score = parseFloat(scoreMatch[1])
      const lines = actual.split('\n')
      const weaknesses: string[] = []
      const suggestions: string[] = []
      let section: 'none' | 'weak' | 'change' = 'none'
      for (const line of lines) {
        const l = line.trim()
        if (/weakness/i.test(l)) { section = 'weak'; continue }
        if (/what.*change|suggest/i.test(l)) { section = 'change'; continue }
        if (/strength/i.test(l)) { section = 'none'; continue }
        if (l.startsWith('- ') || l.startsWith('* ')) {
          if (section === 'weak') weaknesses.push(l.slice(2).trim())
          else if (section === 'change') suggestions.push(l.slice(2).trim())
        }
      }
      reviews.push({ persona, testId: r.testId, score, weaknesses, suggestions, fullText: actual })
      break
    }
  }
  return reviews
}

// ── Subagent persona consultation ────────────────────────────────────────────

async function consultPersona(
  persona: typeof PERSONAS[0],
  reviews: ReviewResult[],
  round: number,
  screenshotPath: string | null,
): Promise<string> {
  const agentProfile = existsSync(persona.agentMd)
    ? readFileSync(persona.agentMd, 'utf-8').slice(0, 1500)
    : ''

  const weakSummary = reviews
    .flatMap(r => r.weaknesses)
    .slice(0, 15)
    .map((w, i) => `${i + 1}. ${w}`)
    .join('\n')

  const sugSummary = reviews
    .flatMap(r => r.suggestions)
    .slice(0, 10)
    .map((s, i) => `${i + 1}. ${s}`)
    .join('\n')

  const scores = reviews.map(r => r.score)
  const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
  const delta = Math.max(0, TARGET_SCORE - avg)

  const promptTemplate = existsSync(CONVERGENCE_PROMPT_PATH)
    ? readFileSync(CONVERGENCE_PROMPT_PATH, 'utf-8')
    : `You are {persona_name}.\n{agent_profile}\nRound: {round}\nAvg: {avg_score}\nDelta: {delta}\nWeaknesses:\n{weaknesses}\nSuggestions:\n{suggestions}`
  const prompt = promptTemplate
    .replace('{persona_name}', persona.slug.replace(/-/g, ' '))
    .replace('{agent_profile}', agentProfile)
    .replace('{round}', String(round))
    .replace('{avg_score}', avg.toFixed(1))
    .replace('{delta}', delta.toFixed(1))
    .replace('{weaknesses}', weakSummary || 'None listed')
    .replace('{suggestions}', sugSummary || 'None listed')

  try {
    const res = await fetch('http://localhost:8620/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: persona.model,
        prompt,
        workspace: WORKSPACE,
      }),
    })
    const data = await res.json() as any
    return data.response || 'No response from persona agent'
  } catch (e) {
    return `Persona agent unreachable: ${e}`
  }
}

// ── Criticism categorization ─────────────────────────────────────────────────

function categorizeCriticisms(reviews: ReviewResult[]) {
  const cats: Record<string, string[]> = {}
  for (const r of reviews) {
    for (const w of [...r.weaknesses, ...r.suggestions]) {
      const wl = w.toLowerCase()
      let cat = 'other'
      if (/empty|blank|placeholder|start exploring/.test(wl)) cat = 'empty-canvas'
      else if (/schema|struct|field|type|offset/.test(wl)) cat = 'schema-detail'
      else if (/disassembl|assembly|hex|asm/.test(wl)) cat = 'disassembly'
      else if (/loading|progress|spinner/.test(wl)) cat = 'loading-indicator'
      else if (/tree|hierarch|collaps/.test(wl)) cat = 'tree-view'
      else if (/tooltip|onboard|tutorial|beginner|guide/.test(wl)) cat = 'onboarding'
      else if (/layout|zoom|fit/.test(wl)) cat = 'graph-layout'
      else if (/select|highlight|glow|border/.test(wl)) cat = 'selection-feedback'
      else if (/undo|redo|history/.test(wl)) cat = 'undo-redo'
      else if (/breadcrumb|navigation|path/.test(wl)) cat = 'navigation'
      else if (/context menu|right-click/.test(wl)) cat = 'context-menu'
      else if (/error|offline|network|retry/.test(wl)) cat = 'error-states'
      cats[cat] = cats[cat] || []
      cats[cat].push(w)
    }
  }
  return Object.entries(cats)
    .map(([category, examples]) => ({ category, count: examples.length, examples }))
    .sort((a, b) => b.count - a.count)
}

// ── Main Loop ────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(REPORT_DIR, { recursive: true })

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  DESIGN CONVERGENCE LOOP`)
  console.log(`  Target: ${TARGET_SCORE}/10 avg | Max: ${MAX_ROUNDS} rounds`)
  console.log(`  ${SAMPLE_SIZE} tests/persona/round = ${SAMPLE_SIZE * PERSONAS.length} reviews/round`)
  console.log(`  Personas: ${PERSONAS.map(p => `${p.slug} (${p.model})`).join(', ')}`)
  console.log(`${'═'.repeat(60)}\n`)

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    console.log(`\n${'─'.repeat(60)}`)
    console.log(`  ROUND ${round}/${MAX_ROUNDS}`)
    console.log(`${'─'.repeat(60)}`)

    // 1. Run sampled persona reviews via test runner
    console.log(`\n[1] Running ${SAMPLE_SIZE} reviews per persona...`)
    const allReviews: ReviewResult[] = []

    for (const persona of PERSONAS) {
      console.log(`  ${persona.slug} (${persona.model})...`)
      const runId = await runSampledReviews(persona.manifest, SAMPLE_SIZE, round)
      const results = await pollRunResults(runId)
      const reviews = extractReviews(results, persona.slug)
      allReviews.push(...reviews)
      const scores = reviews.map(r => r.score).filter(s => s > 0)
      const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0
      console.log(`    ${scores.length} reviews, avg ${avg.toFixed(1)}/10`)
    }

    // 2. Score check
    const allScores = allReviews.map(r => r.score).filter(s => s > 0)
    const overallAvg = allScores.length > 0 ? allScores.reduce((a, b) => a + b, 0) / allScores.length : 0
    console.log(`\n[2] Overall: ${overallAvg.toFixed(1)}/10 (${allScores.length} reviews)`)

    const perPersona = PERSONAS.map(p => {
      const pScores = allReviews.filter(r => r.persona === p.slug).map(r => r.score).filter(s => s > 0)
      return { persona: p.slug, avg: pScores.length > 0 ? pScores.reduce((a, b) => a + b, 0) / pScores.length : 0, count: pScores.length }
    })
    for (const pp of perPersona) {
      console.log(`    ${pp.persona}: ${pp.avg.toFixed(1)}/10 (${pp.count} reviews)`)
    }

    if (overallAvg >= TARGET_SCORE) {
      console.log(`\n✓ TARGET REACHED: ${overallAvg.toFixed(1)} >= ${TARGET_SCORE}`)
      writeFileSync(resolve(REPORT_DIR, 'CONVERGED.json'), JSON.stringify({ round, avgScore: overallAvg, timestamp: new Date().toISOString() }, null, 2))
      break
    }

    // 3. Categorize criticisms
    const criticisms = categorizeCriticisms(allReviews)
    console.log(`\n[3] Top criticisms:`)
    for (const c of criticisms.slice(0, 6)) {
      console.log(`    ${c.count}x ${c.category}`)
    }

    // 4. Consult each persona subagent for prioritized fix advice
    console.log(`\n[4] Consulting persona subagents for fix advice...`)
    const personaAdvice: Record<string, string> = {}
    for (const persona of PERSONAS) {
      const pReviews = allReviews.filter(r => r.persona === persona.slug)
      if (pReviews.length === 0) continue
      console.log(`  Asking ${persona.slug} (${persona.model}) for top 3 fixes...`)
      const advice = await consultPersona(persona, pReviews, round, null)
      personaAdvice[persona.slug] = advice
      console.log(`    Response: ${advice.substring(0, 150)}...`)
    }

    // 5. Save round report
    const report: RoundReport = {
      round,
      avgScore: overallAvg,
      reviewCount: allScores.length,
      perPersona,
      criticisms,
      reviews: allReviews,
      timestamp: new Date().toISOString(),
    }
    const reportPath = resolve(REPORT_DIR, `round-${round}.json`)
    writeFileSync(reportPath, JSON.stringify(report, null, 2))

    // Save persona advice separately for easy reading
    const advicePath = resolve(REPORT_DIR, `round-${round}-advice.md`)
    const adviceMd = PERSONAS.map(p => {
      const pAvg = perPersona.find(pp => pp.persona === p.slug)?.avg ?? 0
      return `## ${p.slug} (${pAvg.toFixed(1)}/10, via ${p.model})\n\n${personaAdvice[p.slug] || 'No response'}`
    }).join('\n\n---\n\n')
    writeFileSync(advicePath, `# Round ${round} Persona Advice\n\nOverall avg: ${overallAvg.toFixed(1)}/10\n\n${adviceMd}`)

    console.log(`\n[5] Reports saved:`)
    console.log(`    ${reportPath}`)
    console.log(`    ${advicePath}`)

    // 6. Wait for project agent to apply fixes
    console.log(`\n[6] WAITING FOR CODE FIXES...`)
    console.log(`    Read: ${advicePath}`)
    console.log(`    When done, create: convergence-reports/round-${round}-fixed.signal`)

    const signalPath = resolve(REPORT_DIR, `round-${round}-fixed.signal`)
    const waitStart = Date.now()
    const MAX_WAIT = 600_000
    while (Date.now() - waitStart < MAX_WAIT) {
      if (existsSync(signalPath)) {
        console.log(`\n    Signal received! Continuing to round ${round + 1}...`)
        await new Promise(r => setTimeout(r, 5000)) // HMR settle
        break
      }
      await new Promise(r => setTimeout(r, 3000))
    }
    if (Date.now() - waitStart >= MAX_WAIT) {
      console.log(`\n    Timeout (10min). Moving to next round anyway.`)
    }
  }

  console.log(`\n${'═'.repeat(60)}`)
  console.log(`  CONVERGENCE LOOP COMPLETE`)
  console.log(`${'═'.repeat(60)}\n`)
}

main().catch(console.error)

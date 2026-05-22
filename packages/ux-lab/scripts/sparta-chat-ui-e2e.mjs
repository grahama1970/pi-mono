#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { chromium } from 'playwright'

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(name)
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function classifyWorkspace(text) {
  if (/\bNOT_SATISFIED\b/i.test(text)) return 'deflect'
  if (/\bINCONCLUSIVE\b/i.test(text)) return 'clarify'
  if (/\bSATISFIED\b/i.test(text)) return 'answer'
  return 'unknown'
}

function scopeForCase(testCase) {
  return String(testCase.profile || '').startsWith('f36') ? 'f36' : 'sparta'
}

async function ensureParent(path) {
  await mkdir(dirname(path), { recursive: true })
}

async function runCase(browser, testCase, options) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  const started = new Date().toISOString()
  const screenshot = resolve(options.screenshotDir, `${testCase.id}.png`)
  const result = {
    id: testCase.id,
    profile: testCase.profile,
    strata: testCase.strata || [],
    question: testCase.question,
    command: `/create-evidence-case ${testCase.question}`,
    started,
    completed: null,
    passed: false,
    action: 'unknown',
    failures: [],
    screenshot,
    workspace_excerpt: '',
  }

  try {
    await page.goto(options.baseUrl, { waitUntil: 'networkidle', timeout: options.timeoutMs })
    const input = page.locator('[data-qid="sparta:hud:input"]')
    if (!(await input.isVisible({ timeout: 2_000 }).catch(() => false))) {
      await page.locator('[data-qid="sparta:button:embry-assistant"]').click({ timeout: options.timeoutMs })
    }
    await input.waitFor({ state: 'visible', timeout: options.timeoutMs })

    const scope = scopeForCase(testCase)
    await page.locator(`[data-qid="sparta:button:chat-scope-${scope}"]`).click({ timeout: options.timeoutMs })
    await input.fill(`/create-evidence-case ${testCase.question}`)
    await page.locator('[data-qid="sparta:hud:transmit"]').click({ timeout: options.timeoutMs })

    await page.waitForSelector('[data-qid="sparta:evidence-workspace"]', { timeout: options.timeoutMs })
    const workspace = page.locator('[data-qid="sparta:evidence-workspace"]')
    let workspaceText = ''
    const deadline = Date.now() + options.timeoutMs
    while (Date.now() < deadline) {
      workspaceText = (await workspace.innerText({ timeout: 2_000 }).catch(() => '')).replace(/\s+/g, ' ').trim()
      if (/Final verdict/i.test(workspaceText) && classifyWorkspace(workspaceText) !== 'unknown') break
      await page.waitForTimeout(500)
    }
    result.workspace_excerpt = workspaceText.slice(0, 1200)
    result.action = classifyWorkspace(workspaceText)
    if (result.action === 'unknown') {
      result.failures.push('evidence workspace did not render a classifiable final verdict')
    }

    if (!Array.isArray(testCase.acceptable_actions) || !testCase.acceptable_actions.includes(result.action)) {
      result.failures.push(`expected action in ${(testCase.acceptable_actions || []).join(',')} but got ${result.action}`)
    }
    if (testCase.min_evidence_items && result.action === 'answer' && !/\bqra recall\b/i.test(workspaceText)) {
      result.failures.push('answer did not visibly include qra recall gate')
    }
    if (testCase.require_qra_gate && result.action === 'answer' && !/\b\d+\s+QRAs?\b/i.test(workspaceText)) {
      result.failures.push('answer did not visibly include QRA count')
    }

    await page.screenshot({ path: screenshot, fullPage: true })
    result.passed = result.failures.length === 0
  } catch (error) {
    result.failures.push(error instanceof Error ? error.message : String(error))
    await page.screenshot({ path: screenshot, fullPage: true }).catch(() => {})
  } finally {
    result.completed = new Date().toISOString()
    await context.close()
  }
  return result
}

async function main() {
  const manifestPath = arg('--manifest', 'test-manifests/sparta-chat-core-e2e.json')
  const outputJson = arg('--output-json', '/tmp/sparta-chat-ui-e2e-summary.json')
  const outputJsonl = arg('--output-jsonl', '/tmp/sparta-chat-ui-e2e-results.jsonl')
  const screenshotDir = arg('--screenshot-dir', '/tmp/sparta-chat-ui-e2e-screenshots')
  const baseUrl = arg('--base-url', 'http://localhost:3002/#sparta-explorer/chat')
  const timeoutMs = Number(arg('--timeout-ms', '90000'))
  const limit = Number(arg('--limit', '0'))
  const failFast = hasFlag('--fail-fast')

  await ensureParent(outputJson)
  await ensureParent(outputJsonl)
  await mkdir(screenshotDir, { recursive: true })

  const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))
  const cases = (limit > 0 ? manifest.cases.slice(0, limit) : manifest.cases)
  const browser = await chromium.launch({ headless: true })
  const results = []
  try {
    for (const testCase of cases) {
      const result = await runCase(browser, testCase, { baseUrl, timeoutMs, screenshotDir })
      results.push(result)
      console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.id} ${result.action}`)
      if (!result.passed && failFast) break
    }
  } finally {
    await browser.close()
  }

  const summary = {
    schema: 'sparta.chat.ui_e2e.v1',
    manifest: manifestPath,
    base_url: baseUrl,
    screenshot_dir: screenshotDir,
    total: results.length,
    passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length,
    by_action: results.reduce((acc, r) => {
      acc[r.action] = (acc[r.action] || 0) + 1
      return acc
    }, {}),
    failures: results.filter(r => !r.passed).map(r => ({ id: r.id, action: r.action, failures: r.failures, screenshot: r.screenshot })),
    completed_at: new Date().toISOString(),
  }

  await writeFile(outputJson, `${JSON.stringify(summary, null, 2)}\n`)
  await writeFile(outputJsonl, results.map(r => JSON.stringify(r)).join('\n') + '\n')
  console.log(`summary ${outputJson}`)
  console.log(`jsonl ${outputJsonl}`)
  if (summary.failed > 0) process.exit(1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

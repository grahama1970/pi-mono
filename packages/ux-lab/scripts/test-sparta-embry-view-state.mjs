import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const url = process.argv[2] ?? 'http://localhost:3002/?chatMode=triage#sparta-explorer/coverage'
const outputDir = resolve(process.argv[3] ?? 'packages/ux-lab/.codex/test-interactions/sparta-embry-view-state-controller')

const results = {
  schema: 'ux_lab.sparta_embry_view_state_controller.results.v1',
  mocked: false,
  live: true,
  url,
  passed: 0,
  failed: 0,
  checks: [],
}

function record(name, passed, detail = {}) {
  results.checks.push({ name, passed, ...detail })
  if (passed) results.passed += 1
  else results.failed += 1
}

async function mode(page) {
  return page.locator("[data-qid='coverage-mode-root']").getAttribute('data-page-distance-mode')
}

async function expectMode(page, expected, name) {
  await page.waitForFunction(
    ([selector, expectedMode]) => document.querySelector(selector)?.getAttribute('data-page-distance-mode') === expectedMode,
    ["[data-qid='coverage-mode-root']", expected],
    { timeout: 5000 },
  )
  const actual = await mode(page)
  record(name, actual === expected, { expected, actual })
}

await mkdir(outputDir, { recursive: true })
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } })

try {
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector("[data-qid='coverage-mode-root']", { timeout: 15000 })
  await expectMode(page, '5ft', 'url-chatMode-triage-starts-5ft')

  await page.dispatchEvent('body', 'keydown', { key: 'a', code: 'KeyA', bubbles: true })
  await expectMode(page, 'lean-in', 'keyboard-keydown-switches-lean-in')

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('sparta:embry-voice-state', { detail: { state: 'listening', surface: 'sparta-explorer' } }))
  })
  await expectMode(page, '5ft', 'embry-listening-switches-5ft')

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('sparta:embry-idle', { detail: { source: 'deterministic-test' } }))
  })
  await expectMode(page, '10ft', 'embry-idle-switches-10ft')

  await page.click("[data-qid='sparta:button:embry-assistant']")
  await page.waitForSelector("[data-qid='sparta:chat:shell:slideover:well:voice']", { timeout: 5000 })
  await page.click("[data-qid='sparta:chat:shell:slideover:well:voice']")
  await expectMode(page, '5ft', 'sparta-chat-voice-button-switches-5ft')

  const screenshot = resolve(outputDir, 'final.png')
  await page.screenshot({ path: screenshot, fullPage: true })
  results.screenshot = screenshot
} catch (error) {
  record('script-error', false, { error: error instanceof Error ? error.message : String(error) })
} finally {
  await browser.close()
}

const output = resolve(outputDir, 'results.json')
await writeFile(output, JSON.stringify(results, null, 2))
console.log(JSON.stringify(results, null, 2))
process.exit(results.failed === 0 ? 0 : 1)

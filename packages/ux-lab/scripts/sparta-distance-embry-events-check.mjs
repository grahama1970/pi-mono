import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const baseUrl = process.env.SPARTA_DISTANCE_URL || 'http://localhost:3002/#sparta-explorer/qras'
const outputDir = process.env.SPARTA_DISTANCE_OUT || '/tmp/sparta-distance-embry-events'

async function modeOf(page) {
  return page.evaluate(() => {
    const root = document.querySelector('[data-page-distance-mode]')
    return root?.getAttribute('data-page-distance-mode') ?? null
  })
}

async function assertMode(page, expected, label) {
  try {
    await page.waitForFunction(
      ({ expectedMode }) => {
        const root = document.querySelector('[data-page-distance-mode]')
        return root?.getAttribute('data-page-distance-mode') === expectedMode
      },
      { expectedMode: expected },
      { timeout: 5000 },
    )
  } catch (error) {
    const observed = await modeOf(page).catch(() => null)
    throw new Error(`${label}: timed out waiting for ${expected}; observed ${observed}; ${error instanceof Error ? error.message : String(error)}`)
  }
  const observed = await modeOf(page)
  if (observed !== expected) throw new Error(`${label}: expected ${expected}, observed ${observed}`)
  return { label, expected, observed, ok: true }
}

async function main() {
  await mkdir(outputDir, { recursive: true })
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const observedEvents = []
  try {
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-page-distance-mode]', { timeout: 15000 })
    await page.evaluate(() => {
      window.__spartaDistanceEvents = []
      window.addEventListener('sparta:embry-view-state', (event) => {
        window.__spartaDistanceEvents.push(event.detail)
      })
    })

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('sparta:embry-idle', { detail: { source: 'proof-script' } })))
    const idle = await assertMode(page, '10ft', 'idle event moves QRAs to 10ft')
    await page.screenshot({ path: path.join(outputDir, '01-idle-10ft.png'), fullPage: true })

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('sparta:embry-voice-state', { detail: { state: 'listening', surface: 'sparta-explorer', source: 'proof-script' } })))
    const spoken = await assertMode(page, '5ft', 'voice listening event moves QRAs to 5ft')
    await page.screenshot({ path: path.join(outputDir, '02-listening-5ft.png'), fullPage: true })

    await page.mouse.move(500, 420)
    const pointer = await assertMode(page, 'lean-in', 'mouse movement moves QRAs to lean-in')
    await page.screenshot({ path: path.join(outputDir, '03-pointer-lean-in.png'), fullPage: true })

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('sparta:embry-voice-state', { detail: { state: 'speaking', surface: 'sparta-explorer', source: 'proof-script' } })))
    const speaking = await assertMode(page, '5ft', 'voice speaking event moves QRAs back to 5ft')
    await page.screenshot({ path: path.join(outputDir, '04-speaking-5ft.png'), fullPage: true })

    await page.keyboard.press('A')
    const key = await assertMode(page, 'lean-in', 'keydown moves QRAs to lean-in')
    await page.screenshot({ path: path.join(outputDir, '05-key-lean-in.png'), fullPage: true })

    observedEvents.push(...await page.evaluate(() => window.__spartaDistanceEvents ?? []))
    const result = {
      ok: true,
      mocked: false,
      live: true,
      url: baseUrl,
      outputDir,
      assertions: [idle, spoken, pointer, speaking, key],
      observedEvents,
      screenshots: [
        path.join(outputDir, '01-idle-10ft.png'),
        path.join(outputDir, '02-listening-5ft.png'),
        path.join(outputDir, '03-pointer-lean-in.png'),
        path.join(outputDir, '04-speaking-5ft.png'),
        path.join(outputDir, '05-key-lean-in.png'),
      ],
    }
    await writeFile(path.join(outputDir, 'results.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result, null, 2))
  } catch (error) {
    const result = {
      ok: false,
      mocked: false,
      live: true,
      url: baseUrl,
      outputDir,
      error: error instanceof Error ? error.message : String(error),
      observedEvents,
    }
    await writeFile(path.join(outputDir, 'results.json'), JSON.stringify(result, null, 2))
    console.error(JSON.stringify(result, null, 2))
    process.exitCode = 1
  } finally {
    await browser.close()
  }
}

await main()

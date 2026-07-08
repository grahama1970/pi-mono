import { chromium } from 'playwright'

const url = process.argv[2] || 'http://localhost:3002/?chatMode=glance&entityProof5=1783440079222#sparta-explorer/qras'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const result = {
  url,
  mocked: false,
  live: true,
  checks: {},
}

try {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForSelector('[data-qid="sparta:kiosk:root"]', { timeout: 15000 })
  result.checks.initialKioskRootCount = await page.locator('[data-qid="sparta:kiosk:root"]').count()
  result.checks.initialSearch = await page.evaluate(() => window.location.search)

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('sparta:embry-voice-state', { detail: { state: 'listening' } }))
  })
  await page.waitForFunction(() => window.location.search.includes('chatMode=triage'), null, { timeout: 5000 })
  await page.waitForSelector('[data-qid="sparta:triage:root"]', { timeout: 5000 })
  result.checks.voiceTriageRootCount = await page.locator('[data-qid="sparta:triage:root"]').count()
  result.checks.voiceSearch = await page.evaluate(() => window.location.search)
  result.checks.voiceStateText = await page.locator('[data-qid="embry:voice-state"]').first().textContent().catch(() => null)

  await page.keyboard.press('a')
  await page.waitForFunction(() => window.location.search.includes('chatMode=drilldown'), null, { timeout: 5000 })
  result.checks.keySearch = await page.evaluate(() => window.location.search)
  result.checks.keyKioskRootCount = await page.locator('[data-qid="sparta:kiosk:root"]').count()
  result.checks.keyTriageRootCount = await page.locator('[data-qid="sparta:triage:root"]').count()

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('sparta:embry-idle'))
  })
  await page.waitForFunction(() => window.location.search.includes('chatMode=glance'), null, { timeout: 5000 })
  await page.waitForSelector('[data-qid="sparta:kiosk:root"]', { timeout: 5000 })
  result.checks.idleSearch = await page.evaluate(() => window.location.search)
  result.checks.idleKioskRootCount = await page.locator('[data-qid="sparta:kiosk:root"]').count()

  result.pass = result.checks.initialKioskRootCount > 0
    && result.checks.voiceTriageRootCount > 0
    && result.checks.voiceSearch.includes('chatMode=triage')
    && result.checks.voiceStateText === 'SPEAKING'
    && result.checks.keySearch.includes('chatMode=drilldown')
    && result.checks.keyKioskRootCount === 0
    && result.checks.keyTriageRootCount === 0
    && result.checks.idleKioskRootCount > 0
    && result.checks.idleSearch.includes('chatMode=glance')
} finally {
  await browser.close()
}

console.log(JSON.stringify(result, null, 2))
if (!result.pass) process.exit(1)

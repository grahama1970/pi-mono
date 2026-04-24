import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1720, height: 1400 } });
await page.goto('http://localhost:3002/#sparta-explorer/qras', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(20000);
const verifyButton = page.locator('[data-qid="qras:evidence:step:verify"]');
if (await verifyButton.count()) {
  await verifyButton.first().click({ force: true });
  await page.waitForTimeout(500);
}
const html = await page.content();
for (const marker of ['Lean4 formalization', 'Prior QRA evidence', 'Upstream / related QRAs']) {
  const idx = html.indexOf(marker);
  console.log(`MARKER:${marker}`);
  console.log(idx >= 0 ? html.slice(Math.max(0, idx - 120), Math.min(html.length, idx + 500)) : 'NOT_FOUND');
}
await page.screenshot({ path: '/tmp/sparta_trace_probe.png', fullPage: true });
await browser.close();

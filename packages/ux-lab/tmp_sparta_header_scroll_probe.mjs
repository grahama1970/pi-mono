import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1720, height: 1200 } });
await page.goto('http://localhost:3002/#sparta-explorer/qras', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(20000);
const trace = page.locator('[data-qid="qras:evidence:step:verify"]');
if (await trace.count()) {
  await trace.first().click({ force: true });
  await page.waitForTimeout(300);
}
await page.evaluate(() => {
  const candidates = Array.from(document.querySelectorAll('div'));
  const scroller = candidates.find((el) => getComputedStyle(el).overflowY === 'auto' && el.scrollHeight > el.clientHeight && el.textContent?.includes('Evidence Trace'));
  if (scroller) scroller.scrollTop = 700;
});
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/sparta_header_scroll_probe.png', fullPage: false });
console.log('HEADER_TEXT_COUNT', await page.locator('text=Decision Surface').count());
await browser.close();

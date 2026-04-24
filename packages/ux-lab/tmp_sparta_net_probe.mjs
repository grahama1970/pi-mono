import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1720, height: 1080 } });
page.on('response', async (res) => {
  if (res.status() >= 400) {
    const req = res.request();
    console.log('HTTP', res.status(), res.url(), req.method(), req.postData() || '');
  }
});
page.on('requestfailed', req => console.log('REQFAIL', req.failure()?.errorText, req.url()));
page.on('console', msg => {
  if (msg.type() === 'error') console.log('CONSOLE', msg.text());
});
await page.goto('http://localhost:3002/#sparta-explorer/qras', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(12000);
await browser.close();

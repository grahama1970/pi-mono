import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1720, height: 1080 } });
page.on('console', msg => console.log('console:', msg.type(), msg.text()));
page.on('pageerror', err => console.log('pageerror:', err.message));
await page.goto('http://localhost:3002/#sparta-explorer/qras', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(20000);
const body = await page.locator('body').innerText();
console.log('BODY_SNIPPET_START');
console.log(body.slice(0, 3000));
console.log('BODY_SNIPPET_END');
console.log('QRA_ITEM_COUNT', await page.locator('[data-qid^="qras:item:"]').count().catch(() => 0));
console.log('REJECT_COUNT', await page.locator('[data-qid="qras:action:reject"]').count().catch(() => 0));
await page.screenshot({ path: '/tmp/sparta_ui_live_check.png', fullPage: true });
await browser.close();

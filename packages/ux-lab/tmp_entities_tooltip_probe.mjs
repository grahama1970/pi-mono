import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1720, height: 1080 } });
await page.goto('http://localhost:3002/#sparta-explorer/qras', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(12000);
await page.locator('[data-qid="qras:display:entity-help"]').hover();
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/sparta_entities_tooltip.png', fullPage: false });
await browser.close();

import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const seen = [];
page.on('response', async (resp) => {
  const url = resp.url();
  if (url.includes('localhost:3001') || url.includes('/api/')) {
    seen.push({ url, status: resp.status(), method: resp.request().method() });
  }
});
await page.goto('http://localhost:3002/#sparta-explorer/qras', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
const out = await page.evaluate(() => ({
  hash: location.hash,
  title: document.title,
  bodyText: document.body.innerText,
  localStorage: Object.fromEntries([...Array(localStorage.length)].map((_, i) => {
    const k = localStorage.key(i); return [k, k ? localStorage.getItem(k) : null];
  })),
  sessionStorage: Object.fromEntries([...Array(sessionStorage.length)].map((_, i) => {
    const k = sessionStorage.key(i); return [k, k ? sessionStorage.getItem(k) : null];
  })),
  qids: Array.from(document.querySelectorAll('[data-qid]')).map(el => ({
    qid: el.getAttribute('data-qid'),
    text: (el.textContent || '').trim().slice(0, 120),
  })).slice(0, 120),
}));
console.log(JSON.stringify({ out, seen }, null, 2));
await browser.close();

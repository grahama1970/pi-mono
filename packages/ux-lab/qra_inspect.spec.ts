import { test } from '@playwright/test';

test('inspect qra route state', async ({ page }) => {
  const seen: Array<{url:string,status:number,method:string}> = [];
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('localhost:3001') || url.includes('/api/')) {
      seen.push({ url, status: resp.status(), method: resp.request().method() });
    }
  });
  await page.goto('http://localhost:3002/#sparta-explorer/qras', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(8000);
  const state = await page.evaluate(() => ({
    hash: location.hash,
    bodyText: document.body.innerText.slice(0, 5000),
    localStorage: Object.fromEntries([...Array(localStorage.length)].map((_, i) => { const k = localStorage.key(i)!; return [k, localStorage.getItem(k)]; })),
    sessionStorage: Object.fromEntries([...Array(sessionStorage.length)].map((_, i) => { const k = sessionStorage.key(i)!; return [k, sessionStorage.getItem(k)]; })),
    qids: Array.from(document.querySelectorAll('[data-qid]')).map(el => [el.getAttribute('data-qid'), (el.textContent||'').trim().slice(0,80)]),
  }));
  console.log(JSON.stringify({ state, seen }, null, 2));
});

#!/usr/bin/env node
/**
 * Deterministic CDP capture runner for persona reviews.
 * Uses raw CDP WebSocket — no createHarness (avoids hydration check failures).
 * Navigates to Binary Explorer Components tab, captures screenshots per group.
 *
 * Usage:
 *   node sim/run_cdp_captures.cjs
 *   node sim/run_cdp_captures.cjs --group first-impressions
 *   node sim/run_cdp_captures.cjs --list
 */
'use strict';
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const UX_LAB = path.resolve(__dirname, '..');
const MANIFEST = path.join(UX_LAB, 'persona-review-manifest.json');
const CAPTURES = path.join(UX_LAB, 'captures', 'persona-reviews');
const BASE = process.env.UX_LAB_URL || 'http://localhost:3002';
const PORT = Number(process.env.CDP_PORT || 9253);
const args = process.argv.slice(2);
const onlyGroup = args.includes('--group') ? args[args.indexOf('--group')+1] : null;
const flagList = args.includes('--list');

// ── Raw CDP connection (bypasses createHarness hydration) ──────────
async function connectCDP(port) {
  const pages = await new Promise((res, rej) => {
    http.get(`http://localhost:${port}/json`, r => {
      let d = ''; r.on('data', c => d += c);
      r.on('end', () => { try { res(JSON.parse(d)); } catch(e) { rej(e); } });
    }).on('error', rej);
  });
  if (!pages || !pages.length) throw new Error('No CDP pages');
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
  let msgId = 1;
  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = msgId++;
    const t = setTimeout(() => rej(new Error(`CDP timeout: ${method}`)), 20000);
    const handler = raw => {
      const m = JSON.parse(raw.toString());
      if (m.id === id) { ws.off('message', handler); clearTimeout(t); res(m); }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  return { send, close: () => ws.close() };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Navigate to Binary Explorer Components tab and wait for render
async function navigateToBinaryExplorer(cdp) {
  await cdp.send('Page.navigate', { url: `${BASE}/#binary-explorer` });
  await sleep(3000);
  // Remove any Vite error overlay
  await cdp.send('Runtime.evaluate', { expression: `document.querySelector('vite-error-overlay')?.remove()` });
  // Click Binary Explorer in sidebar
  await cdp.send('Runtime.evaluate', { expression: `(()=>{const ds=[...document.querySelectorAll('div')];const be=ds.find(d=>d.textContent.includes('Binary Explorer')&&d.textContent.includes('ELF')&&d.offsetHeight>0);if(be)be.click()})()`, returnByValue: true });
  await sleep(1000);
  // Click Components tab
  await cdp.send('Runtime.evaluate', { expression: `(()=>{const els=[...document.querySelectorAll('*')];const c=els.find(e=>e.textContent.trim()==='Components'&&e.offsetWidth>0&&e.children.length===0);if(c)c.click()})()`, returnByValue: true });
  await sleep(3000);
  // Click both seed buttons to populate the graph with namespaces + top hubs
  await cdp.send('Runtime.evaluate', { expression: `(()=>{const btns=[...document.querySelectorAll('button')];const ns=btns.find(b=>/seed.*namespace/i.test(b.textContent));const hubs=btns.find(b=>/seed.*hub/i.test(b.textContent));if(ns)ns.click();if(hubs)hubs.click();return (ns?'namespaces ':'')+(hubs?'hubs':'')||'no seed btns'})()`, returnByValue: true }).then(r => console.log('Seed:', r.result?.result?.value));
  await sleep(4000);
}

// PRE: click a node so detail panel is visible, then screenshot
const PRE = [
  {a:'wait',ms:500},
  {a:'ss',n:'01-initial'},
  {a:'eval',s:`document.querySelector('g.nodes circle')?.dispatchEvent(new MouseEvent('click',{bubbles:true}))`},
  {a:'wait',ms:1500},
  {a:'ss',n:'02-with-selection'},
];
const GROUPS = {
  'first-impressions':     [...PRE, {a:'ss',n:'02-viewport'}],
  'graph-navigation':      [...PRE, {a:'eval',s:`document.querySelector('g.nodes circle')?.dispatchEvent(new MouseEvent('click',{bubbles:true}))`},{a:'wait',ms:1000},{a:'ss',n:'02-click'},{a:'eval',s:`document.querySelector('g.nodes circle')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`},{a:'wait',ms:2000},{a:'ss',n:'03-expand'}],
  'node-detail':           [...PRE, {a:'eval',s:`document.querySelector('g.nodes circle')?.dispatchEvent(new MouseEvent('click',{bubbles:true}))`},{a:'wait',ms:1000},{a:'ss',n:'02-detail'}],
  'symbol-tree':           [...PRE],
  'table-view':            [...PRE, {a:'eval',s:`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/table/i.test(b.textContent));if(b){b.click();return 'ok'}return 'none'})()`},{a:'wait',ms:1000},{a:'ss',n:'02-table'}],
  'taxonomy-integration':  [...PRE],
  'code-view':             [...PRE, {a:'eval',s:`document.querySelector('g.nodes circle')?.dispatchEvent(new MouseEvent('click',{bubbles:true}))`},{a:'wait',ms:1000},{a:'eval',s:`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/code|asm/i.test(b.textContent));if(b){b.click();return 'ok'}return 'none'})()`},{a:'wait',ms:1000},{a:'ss',n:'02-code'}],
  'chat-analysis':         [...PRE, {a:'ss',n:'02-chat'}],
  'chat-exploration':      [...PRE, {a:'ss',n:'02-chat'}],
  'automation':            [...PRE],
  'perspective-views':     [...PRE, {a:'eval',s:`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/security/i.test(b.textContent));if(b){b.click();return 'ok'}return 'none'})()`},{a:'wait',ms:1000},{a:'ss',n:'02-security'}],
  'scene-management':      [...PRE],
  'investigation-journal': [...PRE, {a:'eval',s:`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/journal/i.test(b.textContent));if(b){b.click();return 'ok'}return 'none'})()`},{a:'wait',ms:1000},{a:'ss',n:'02-journal'}],
  'data-structures':       [...PRE, {a:'eval',s:`document.querySelector('g.nodes circle')?.dispatchEvent(new MouseEvent('click',{bubbles:true}))`},{a:'wait',ms:1000},{a:'ss',n:'02-data'}],
  'graph-exploration':     [...PRE, {a:'ss',n:'02-colors'}],
  'search-and-filter':     [...PRE],
  'context-menu':          [...PRE, {a:'eval',s:`(()=>{const n=document.querySelector('g.nodes circle');if(!n)return;const r=n.getBoundingClientRect();n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.x+5,clientY:r.y+5}))})()`},{a:'wait',ms:500},{a:'ss',n:'02-ctx'}],
  'cross-references':      [...PRE, {a:'eval',s:`document.querySelector('g.nodes circle')?.dispatchEvent(new MouseEvent('click',{bubbles:true}))`},{a:'wait',ms:1000},{a:'ss',n:'02-xrefs'}],
  'state-machines':        [...PRE],
  'performance':           [...PRE],
  'progressive-disclosure':[{a:'nav',r:'binary-explorer/droid'},{a:'wait',ms:1000},{a:'ss',n:'01-early'},{a:'wait',ms:3000},{a:'ss',n:'02-loaded'}],
  'learning-path':         [...PRE],
  'vulnerability-hunting': [...PRE],
  'visual-design':         [...PRE],
  'ctf-workflow':          [...PRE, {a:'eval',s:`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/journal/i.test(b.textContent));if(b){b.click();return 'ok'}return 'none'})()`},{a:'wait',ms:1000},{a:'ss',n:'02-journal'}],
  'graph-interaction':     [...PRE, {a:'eval',s:`document.querySelector('g.nodes circle')?.dispatchEvent(new MouseEvent('click',{bubbles:true}))`},{a:'wait',ms:500},{a:'ss',n:'02-click'}],
  'accessibility':         [...PRE],
  'error-states':          [...PRE, {a:'nav',r:'binary-explorer/nonexistent'},{a:'wait',ms:2000},{a:'ss',n:'02-error'},{a:'nav',r:'binary-explorer/droid'},{a:'wait',ms:2000},{a:'ss',n:'03-recovery'}],
};

async function run() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  let groups = [...new Set(manifest.reviews.map(r => r.group))];

  if (flagList) {
    console.log(groups.length + ' groups:');
    groups.forEach(g => console.log('  ' + g));
    process.exit(0);
  }

  if (onlyGroup) groups = groups.filter(g => g === onlyGroup);
  console.log(`CDP CAPTURES: ${groups.length} groups, port ${PORT}`);

  const cdp = await connectCDP(PORT);
  console.log('Connected\n');

  // Initial navigation to Binary Explorer Components tab
  await navigateToBinaryExplorer(cdp);
  console.log('Binary Explorer loaded\n');

  let captured = 0, failed = 0, summary = {};

  for (const g of groups) {
    const dir = path.join(CAPTURES, g);
    fs.mkdirSync(dir, { recursive: true });
    const steps = GROUPS[g] || PRE;
    let shots = 0;
    for (const s of steps) {
      try {
        if (s.a === 'nav') {
          await cdp.send('Page.navigate', {url:`${BASE}/#${s.r}`});
          await sleep(2000);
          // Re-dismiss overlay and re-select Components tab for binary-explorer routes
          await cdp.send('Runtime.evaluate', { expression: `document.querySelector('vite-error-overlay')?.remove()` });
          if (s.r.startsWith('binary-explorer')) {
            await cdp.send('Runtime.evaluate', { expression: `(()=>{const ds=[...document.querySelectorAll('div')];const be=ds.find(d=>d.textContent.includes('Binary Explorer')&&d.textContent.includes('ELF')&&d.offsetHeight>0);if(be)be.click()})()`, returnByValue: true });
            await sleep(500);
            await cdp.send('Runtime.evaluate', { expression: `(()=>{const els=[...document.querySelectorAll('*')];const c=els.find(e=>e.textContent.trim()==='Components'&&e.offsetWidth>0&&e.children.length===0);if(c)c.click()})()`, returnByValue: true });
            await sleep(2000);
          }
        }
        else if (s.a === 'wait') { await sleep(s.ms); }
        else if (s.a === 'ss') {
          const r = await cdp.send('Page.captureScreenshot', {format:'png'});
          if (r.result?.data) {
            fs.writeFileSync(path.join(dir, s.n+'.png'), Buffer.from(r.result.data, 'base64'));
            shots++; captured++;
          }
        }
        else if (s.a === 'eval') {
          await cdp.send('Runtime.evaluate', { expression: s.s, returnByValue: true });
        }
      } catch(e) { failed++; console.log(`  ! ${g}/${s.a}: ${e.message}`); }
    }
    summary[g] = shots;
    console.log(`  ${shots>0?'OK':'!!'} ${g}: ${shots}`);
  }
  cdp.close();
  fs.mkdirSync(CAPTURES, {recursive:true});
  fs.writeFileSync(path.join(CAPTURES,'capture-summary.json'), JSON.stringify({captured,failed,groups:summary,completed_at:new Date().toISOString()},null,2));
  console.log(`\nDone: ${captured} captured, ${failed} failed`);
  process.exit(failed>0?1:0);
}
run().catch(e=>{console.error(e.message);process.exit(1)});

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
  // Upscale viewport to 1440x900 for readable screenshots
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return { send, close: () => ws.close() };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Capture a clipped screenshot of a specific DOM element by selector
async function clipScreenshot(cdp, selector, outPath) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: `(()=>{const el=document.querySelector('${selector}');if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`,
    returnByValue: true,
  });
  const rect = r.result?.result?.value;
  if (!rect || rect.width < 10 || rect.height < 10) return false;
  // Ensure clip is within viewport and has minimum size
  const clip = {
    x: Math.max(0, rect.x),
    y: Math.max(0, rect.y),
    width: Math.min(rect.width, 1440 - rect.x),
    height: Math.min(rect.height, 900 - rect.y),
    scale: 2, // 2x for readability
  };
  const ss = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
  if (ss.result?.data) {
    fs.writeFileSync(outPath, Buffer.from(ss.result.data, 'base64'));
    return true;
  }
  return false;
}

// Poll DOM until a selector exists and has content, or timeout (default 5s)
async function waitForSelector(cdp, selector, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `(()=>{const el=document.querySelector('${selector}');return el && el.offsetHeight > 0 ? 'found' : null})()`,
      returnByValue: true,
    });
    if (r.result?.result?.value === 'found') return true;
    await sleep(200);
  }
  return false;
}

// Poll until an element with given id has non-empty textContent
async function waitForContent(cdp, id, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `(()=>{const el=document.getElementById('${id}');return el && el.textContent.trim().length > 10 ? 'ready' : null})()`,
      returnByValue: true,
    });
    if (r.result?.result?.value === 'ready') return true;
    await sleep(200);
  }
  return false;
}

// Navigate to Binary Explorer Components tab and wait for render
async function navigateToBinaryExplorer(cdp) {
  // Clear cache to ensure latest code is loaded
  await cdp.send('Network.enable');
  await cdp.send('Network.clearBrowserCache');
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
  // Wait for taxonomy loading to complete (up to 25s — 200 nodes in batches of 20)
  // The "Loading taxonomy..." text disappears when done. We poll for its absence.
  console.log('Waiting for taxonomy...');
  await sleep(5000); // Give taxonomy batches a head start
  const taxStart = Date.now();
  while (Date.now() - taxStart < 20000) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `(()=>{const txt=document.body.innerText;if(txt.includes('Loading taxonomy'))return 'loading';return 'done'})()`,
      returnByValue: true,
    });
    if (r.result?.result?.value === 'done') {
      console.log(`Taxonomy loaded (${5000 + Date.now()-taxStart}ms)`);
      break;
    }
    await sleep(1000);
  }
}

// PRE: click a security-relevant node (auth/rpc/event) so detail+code panel shows with CWE tags
const CLICK_NODE = `(()=>{
  const circles = [...document.querySelectorAll('g.nodes g')];
  // Prefer nodes with security-relevant names (auth, validate, credential, session, encrypt)
  const securityKeywords = /auth|credential|session|encrypt|token|cert|valid|perm|access|priv/i;
  const sec = circles.find(g => {
    const text = g.querySelector('text');
    return text && securityKeywords.test(text.textContent) && text.textContent.length > 3;
  });
  // Fallback: any non-namespace node with a meaningful label
  const fn = sec || circles.find(g => {
    const text = g.querySelector('text');
    return text && !/namespace/i.test(text.textContent) && text.textContent.length > 3 && !/^\\d+$/.test(text.textContent);
  });
  const target = fn || circles[0];
  if (target) {
    const shape = target.querySelector('circle,rect,polygon,path');
    if (shape) shape.dispatchEvent(new MouseEvent('click', {bubbles:true}));
    return 'clicked: ' + (target.querySelector('text')?.textContent || '?');
  }
  return 'no nodes';
})()`;
const PRE = [
  {a:'wait',ms:500},
  {a:'ss',n:'01-initial'},
  {a:'eval',s:CLICK_NODE},
  {a:'wait',ms:1500},
  {a:'ss',n:'02-with-selection'},
];

// Click node by type (schema, state_machine, etc.) — falls back to CLICK_NODE
const CLICK_TYPE = (type) => `(()=>{
  const nodes = [...document.querySelectorAll('g.nodes g')];
  const match = nodes.find(g => {
    const shape = g.querySelector('rect,circle,polygon,path');
    if (!shape) return false;
    const d = shape.__data__ || g.__data__;
    return d && d.nodeType === '${type}';
  });
  // Fallback: try matching by label text
  const byLabel = !match && nodes.find(g => {
    const text = g.querySelector('text.node-label');
    return text && /${type === 'schema' ? 'schema|struct|field' : type === 'state_machine' ? 'fsm|state|machine' : type}/i.test(text.textContent);
  });
  const target = match || byLabel || nodes.find(g => g.querySelector('text')?.textContent?.length > 3);
  if (target) {
    const shape = target.querySelector('circle,rect,polygon,path');
    if (shape) shape.dispatchEvent(new MouseEvent('click', {bubbles:true}));
    return 'clicked:' + (target.querySelector('text')?.textContent || '?');
  }
  return 'none';
})()`;

// Click the hub node with most connections
const CLICK_HUB = `(()=>{
  const nodes = [...document.querySelectorAll('g.nodes g')];
  // Hub badge text shows connection count — find highest
  let best = null, bestDeg = 0;
  for (const g of nodes) {
    const badge = g.querySelector('.hub-badge');
    if (badge) {
      const deg = parseInt(badge.textContent) || 0;
      if (deg > bestDeg) { bestDeg = deg; best = g; }
    }
  }
  // Fallback: node with most visible connections
  if (!best) best = nodes.find(g => g.querySelector('text')?.textContent?.length > 3) || nodes[0];
  if (best) {
    const shape = best.querySelector('circle,rect,polygon,path');
    if (shape) shape.dispatchEvent(new MouseEvent('click', {bubbles:true}));
    return 'hub:' + (best.querySelector('text')?.textContent || '?') + ' deg=' + bestDeg;
  }
  return 'none';
})()`;

// Expand a node by double-clicking (triggers neighbor expansion)
const EXPAND_HUB = (idx) => `(()=>{
  const nodes = [...document.querySelectorAll('g.nodes g')];
  const badges = nodes.filter(g => g.querySelector('.hub-badge'));
  const target = badges[${idx}] || nodes[${idx + 2}];
  if (target) {
    const shape = target.querySelector('circle,rect,polygon,path');
    if (shape) shape.dispatchEvent(new MouseEvent('dblclick', {bubbles:true}));
    return 'expanded:' + (target.querySelector('text')?.textContent || '?');
  }
  return 'none';
})()`;

// Helpers using element IDs for reliable targeting
const clickTab = (tabId) => `(()=>{const t=document.getElementById('be-tab-${tabId}');if(t){t.click();return 'tab:${tabId}'}return 'no #be-tab-${tabId}'})()`;
const switchPerspective = (val) => `(()=>{const sel=document.getElementById('be-perspective');if(sel){sel.value='${val}';sel.dispatchEvent(new Event('change',{bubbles:true}));return 'perspective:${val}'}return 'no #be-perspective'})()`;
const clickJournal = `(()=>{const j=document.getElementById('be-journal-tab');if(j){j.click();return 'journal'}return 'no #be-journal-tab'})()`;
const clickAnalysis = `(()=>{const btns=[...document.querySelectorAll('button')];const a=btns.find(b=>/ANALYSIS/i.test(b.textContent)&&b.offsetWidth>0);if(a){a.click();return 'analysis'}return 'no analysis tab'})()`;

// Reusable expand-capture sequences for panel closeups
const expandPanel = (id, w, h) => ({a:'eval',s:`(()=>{const el=document.getElementById('${id}');if(el){el.style.position='fixed';el.style.left='0';el.style.top='0';el.style.width='${w}px';el.style.height='${h}px';el.style.zIndex='9999';return 'expanded'}return 'no #${id}'})()`});
const restorePanel = (id) => ({a:'eval',s:`(()=>{const el=document.getElementById('${id}');if(el){el.style.position='';el.style.left='';el.style.top='';el.style.width='';el.style.height='';el.style.zIndex=''}})()`});
const detailCloseup = (name) => [expandPanel('be-detail-panel',800,900),{a:'wait',ms:300},{a:'ssClip',sel:'#be-detail-panel',n:name},restorePanel('be-detail-panel')];
const rightPaneCloseup = (name) => [expandPanel('be-right-pane',600,900),{a:'wait',ms:300},{a:'ssClip',sel:'#be-right-pane',n:name},restorePanel('be-right-pane')];
const graphCloseup = (name) => [expandPanel('be-graph-pane',900,900),{a:'wait',ms:300},{a:'ssClip',sel:'#be-graph-pane',n:name},restorePanel('be-graph-pane')];

const GROUPS = {
  // Tim: each group gets unique interaction showing relevant feature
  'first-impressions':     [...PRE, {a:'eval',s:clickTab('table')},{a:'wait',ms:500},{a:'ss',n:'03-feature-table'}],
  'graph-navigation':      [...PRE, {a:'eval',s:`document.querySelectorAll('g.nodes g')[2]?.querySelector('circle,rect')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`},{a:'wait',ms:1500},{a:'ss',n:'03-expanded'}],
  'node-detail':           [
    {a:'wait',ms:500},{a:'ss',n:'01-initial'},
    // Click mcp_auth_required — has BOTH CWE and ATT&CK tags
    {a:'eval',s:`(()=>{const n=[...document.querySelectorAll('g.nodes g')].find(g=>g.querySelector('text')?.textContent?.includes('mcp_auth_required'));if(n){n.querySelector('circle,rect,polygon,path')?.dispatchEvent(new MouseEvent('click',{bubbles:true}));return 'clicked mcp_auth_required'}return 'miss'})()`},
    {a:'wait',ms:2000},
    {a:'eval',s:clickTab('summary')},{a:'wait',ms:500},{a:'ss',n:'02-summary'},
    ...detailCloseup('03-summary-closeup'),
    // Show connections tab with edge type grouping
    {a:'eval',s:clickTab('connections')},{a:'wait',ms:500},
    ...detailCloseup('04-connections-closeup'),
    // Show raw JSON tab
    {a:'eval',s:clickTab('raw')},{a:'wait',ms:500},
    ...detailCloseup('05-raw-closeup')],
  'symbol-tree':           [...PRE, {a:'eval',s:clickTab('connections')},{a:'wait',ms:500},{a:'ss',n:'03-connections-tree'}],
  'table-view':            [
    // Custom: click node, switch to table tab, show full page + expanded table closeup with CWE/ATT&CK badges + CSV export visible
    {a:'wait',ms:500},{a:'eval',s:CLICK_NODE},{a:'wait',ms:1500},
    {a:'eval',s:clickTab('table')},{a:'wait',ms:1000},
    // Type a filter to show the clear button (x) is functional
    {a:'eval',s:`(()=>{const inp=document.getElementById('be-table-filter');if(inp){const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(inp,'auth');inp.dispatchEvent(new Event('input',{bubbles:true}));return 'filtered auth'}return 'no filter'})()`},
    {a:'wait',ms:500},
    {a:'ss',n:'01-table-filtered'},
    // Clear filter to show full table
    {a:'eval',s:`(()=>{const inp=document.getElementById('be-table-filter');if(inp){const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(inp,'');inp.dispatchEvent(new Event('input',{bubbles:true}));return 'cleared'}return 'no filter'})()`},
    {a:'wait',ms:500},
    // Expand detail panel wider for table readability — 1000px wide to show all columns
    {a:'eval',s:`(()=>{const dp=document.getElementById('be-detail-panel');if(dp){dp.style.position='fixed';dp.style.left='0';dp.style.top='0';dp.style.width='1200px';dp.style.height='900px';dp.style.zIndex='9999';return 'expanded'}return 'no panel'})()`},
    {a:'wait',ms:300},{a:'ssClip',sel:'#be-detail-panel',n:'02-table-closeup'},
    {a:'eval',s:`(()=>{const dp=document.getElementById('be-detail-panel');if(dp){dp.style.position='';dp.style.left='';dp.style.top='';dp.style.width='';dp.style.height='';dp.style.zIndex=''}})()`}],
  'taxonomy-integration':  [
    // Click security-relevant node, switch to Security perspective, click CWE badge to show chain tree
    {a:'wait',ms:500},{a:'eval',s:CLICK_NODE},{a:'wait',ms:2000},
    {a:'eval',s:switchPerspective('security')},{a:'wait',ms:2000},
    // Click the FIRST CWE badge in the detail panel to trigger taxonomy chain fetch
    {a:'eval',s:`(()=>{const badges=[...document.querySelectorAll('[id^="be-cwe-"]')];if(badges.length>0){badges[0].click();return 'clicked: '+badges[0].id}return 'no CWE badges'})()`},
    {a:'wait',ms:4000}, // Wait for chain to load + taxonomy coloring to propagate to graph
    // Graph closeup showing CWE-tagged nodes (red tint) vs normal nodes
    ...graphCloseup('01-cwe-graph-closeup'),
    // Full page: graph with CWE-colored nodes + detail panel with chain tree
    {a:'ss',n:'02-chain-active'},
    // Detail closeup showing CWE badges + THREAT MATRIX chain tree
    ...detailCloseup('03-chain-closeup')],
  'code-view':             [...PRE, {a:'eval',s:clickTab('code')},{a:'waitSel',sel:'[data-testid="code-pane"]',timeout:4000},{a:'wait',ms:500},{a:'ss',n:'03-code-view'},
    // Expand detail panel to full height for code closeup, then capture
    {a:'eval',s:`(()=>{const dp=document.getElementById('be-detail-panel');if(dp){dp.style.position='fixed';dp.style.left='0';dp.style.top='0';dp.style.width='800px';dp.style.height='900px';dp.style.zIndex='9999';return 'expanded'}return 'no panel'})()`},
    {a:'wait',ms:500},{a:'ssClip',sel:'#be-detail-panel',n:'04-code-closeup'},
    {a:'eval',s:`(()=>{const dp=document.getElementById('be-detail-panel');if(dp){dp.style.position='';dp.style.left='';dp.style.top='';dp.style.width='';dp.style.height='';dp.style.zIndex=''}})()`}],
  'chat-analysis':         [
    // Skip 01-initial — VLM needs to see chat, not empty graph
    {a:'wait',ms:500},{a:'eval',s:CLICK_NODE},{a:'wait',ms:1500},
    {a:'ss',n:'01-graph-with-chat'},
    {a:'eval',s:`(()=>{const rp=document.getElementById('be-right-pane');if(rp){rp.style.position='fixed';rp.style.left='0';rp.style.top='0';rp.style.width='600px';rp.style.height='900px';rp.style.zIndex='9999';return 'widened'}return 'no pane'})()`},
    {a:'wait',ms:300},{a:'ssClip',sel:'#be-right-pane',n:'02-chat-closeup'},
    {a:'eval',s:`(()=>{const rp=document.getElementById('be-right-pane');if(rp){rp.style.position='';rp.style.left='';rp.style.top='';rp.style.width='';rp.style.height='';rp.style.zIndex=''}})()` }],
  'chat-exploration':      [
    {a:'wait',ms:500},{a:'ss',n:'01-initial'},
    {a:'eval',s:CLICK_NODE},{a:'wait',ms:1500},{a:'ss',n:'02-with-selection'},
    // Show the Analysis/chat tab (not journal) — this is where suggested queries appear
    {a:'eval',s:clickAnalysis},{a:'wait',ms:500},
    ...rightPaneCloseup('03-chat-closeup')],
  'automation':            [...PRE, {a:'eval',s:clickTab('raw')},{a:'wait',ms:500},{a:'ss',n:'01-raw-api'},
    // Detail closeup showing API endpoints + curl examples at top of Raw tab
    ...detailCloseup('02-api-closeup'),
    // Also show the chat pane with suggested queries (API discoverability)
    {a:'eval',s:clickAnalysis},{a:'wait',ms:500},
    ...rightPaneCloseup('03-chat-closeup')],
  'perspective-views':     [...PRE, {a:'eval',s:switchPerspective('security')},{a:'wait',ms:1500},{a:'ss',n:'03-security'}],
  'scene-management':      [
    // Custom PRE: click node, then save scenes, then show full page with scenes + closeup of toolbar
    {a:'wait',ms:500},{a:'eval',s:CLICK_NODE},{a:'wait',ms:1500},
    {a:'eval',s:`(()=>{const inp=document.querySelector('input[placeholder*="name"]')||document.querySelector('input[placeholder*="Name"]');if(inp){const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(inp,'initial-triage');inp.dispatchEvent(new Event('input',{bubbles:true}));inp.dispatchEvent(new Event('change',{bubbles:true}));const btn=document.getElementById('be-scene-save');if(btn)btn.click();return 'saved 1'}return 'no input'})()`},
    {a:'wait',ms:2000},
    {a:'eval',s:`(()=>{const inp=document.querySelector('input[placeholder*="name"]')||document.querySelector('input[placeholder*="Name"]');if(inp){const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(inp,'auth-deep-dive');inp.dispatchEvent(new Event('input',{bubbles:true}));inp.dispatchEvent(new Event('change',{bubbles:true}));const btn=document.getElementById('be-scene-save');if(btn)btn.click();return 'saved 2'}return 'no input'})()`},
    {a:'wait',ms:2000},
    {a:'ss',n:'01-scenes-saved'},
    // Expand graph pane for toolbar closeup showing SCENE: label, SAVE, LOAD dropdown, EXPORT
    {a:'eval',s:`(()=>{const gp=document.getElementById('be-graph-pane');if(gp){gp.style.position='fixed';gp.style.left='0';gp.style.top='0';gp.style.width='900px';gp.style.height='900px';gp.style.zIndex='9999';return 'expanded'}return 'no pane'})()`},
    {a:'wait',ms:300},{a:'ssClip',sel:'#be-graph-pane',n:'02-toolbar-closeup'},
    {a:'eval',s:`(()=>{const gp=document.getElementById('be-graph-pane');if(gp){gp.style.position='';gp.style.left='';gp.style.top='';gp.style.width='';gp.style.height='';gp.style.zIndex=''}})()`}],
  'investigation-journal': [...PRE, {a:'eval',s:clickJournal},{a:'waitId',id:'be-journal-export-writeup',timeout:3000},{a:'wait',ms:500},{a:'ss',n:'03-journal'},
    // Temporarily widen right pane for readable journal closeup
    {a:'eval',s:`(()=>{const rp=document.getElementById('be-right-pane');if(rp){rp.style.position='fixed';rp.style.left='0';rp.style.top='0';rp.style.width='600px';rp.style.height='900px';rp.style.zIndex='9999';return 'widened'}return 'no pane'})()`},
    {a:'wait',ms:300},{a:'ssClip',sel:'#be-right-pane',n:'04-journal-closeup'},
    // Restore
    {a:'eval',s:`(()=>{const rp=document.getElementById('be-right-pane');if(rp){rp.style.position='';rp.style.left='';rp.style.top='';rp.style.width='';rp.style.height='';rp.style.zIndex=''}})()` }],
  // Gynvael groups — targeted node clicks + relevant tab closeups
  'data-structures':       [
    {a:'wait',ms:500},{a:'ss',n:'01-initial'},
    // Click ax0 (ConnectionInfo) — 12 fields, all typed (string/literal), 0 unknown
    {a:'eval',s:`(()=>{
      const nodes = [...document.querySelectorAll('g.nodes g')];
      const match = nodes.find(g => {
        const d = g.__data__ || g.querySelector('path')?.__data__;
        return d && d.id && d.id.includes(':ax0');
      }) || nodes.find(g => {
        const d = g.__data__ || g.querySelector('path')?.__data__;
        return d && d.id && d.id.includes(':Gy0');
      }) || nodes.find(g => {
        const d = g.__data__ || g.querySelector('path')?.__data__;
        return d && d.nodeType === 'schema';
      });
      if (match) {
        const shape = match.querySelector('circle,rect,polygon,path');
        if (shape) shape.dispatchEvent(new MouseEvent('click', {bubbles:true}));
        return 'clicked:' + (match.querySelector('text')?.textContent || '?');
      }
      return 'no schema node found';
    })()`},{a:'wait',ms:1500},{a:'ss',n:'02-with-selection'},
    {a:'eval',s:clickTab('ast')},{a:'wait',ms:500},{a:'ss',n:'03-ast-fields'},
    ...detailCloseup('04-ast-closeup')],
  'graph-exploration':     [
    {a:'wait',ms:500},{a:'ss',n:'01-initial'},
    // Click legend to toggle filter — demonstrates interactivity
    {a:'eval',s:`(()=>{const l=document.getElementById('be-legend-event');if(l){l.click();return 'toggled event'}return 'no legend'})()`},
    {a:'wait',ms:500},{a:'ss',n:'02-legend-filter'},
    // Restore and click a node
    {a:'eval',s:`(()=>{const l=document.getElementById('be-legend-event');if(l)l.click()})()`},
    {a:'wait',ms:300},{a:'eval',s:CLICK_NODE},{a:'wait',ms:1000},
    {a:'ss',n:'03-with-selection'},
    ...graphCloseup('04-graph-closeup')],
  'search-and-filter':     [
    {a:'wait',ms:500},{a:'ss',n:'01-initial'},
    // Use the TABLE filter (not left pane) to trigger graph highlighting
    {a:'eval',s:clickTab('table')},{a:'wait',ms:500},
    {a:'eval',s:`(()=>{const inp=document.getElementById('be-table-filter');if(inp){const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(inp,'auth');inp.dispatchEvent(new Event('input',{bubbles:true}));return 'filtered auth via table'}return 'no table filter'})()`},
    {a:'wait',ms:1500},
    // Full page screenshot shows graph dimming (non-matches at 0.12 opacity) + table filtered
    {a:'ss',n:'02-search-active'},
    // Graph closeup — wait extra for D3 to apply matched node highlighting
    {a:'wait',ms:500},
    ...graphCloseup('03-search-graph'),
    ...detailCloseup('04-search-table-closeup')],
  'context-menu':          [...PRE, {a:'eval',s:`(()=>{const n=document.querySelector('g.nodes circle');if(!n)return;const r=n.getBoundingClientRect();n.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:r.x+5,clientY:r.y+5}))})()`},{a:'wait',ms:500},{a:'ss',n:'03-ctx'}],
  'cross-references':      [
    {a:'wait',ms:500},{a:'ss',n:'01-initial'},
    // Click kill_worker_session — has 4 edge types (contains, emits, has_parameter, payload)
    {a:'eval',s:`(()=>{const nodes=[...document.querySelectorAll('g.nodes g')];const match=nodes.find(g=>{const t=g.querySelector('text');return t&&/kill_worker|session_notification|update_session/i.test(t.textContent)});const target=match||nodes.find(g=>g.querySelector('.hub-badge'))||nodes[0];if(target){target.querySelector('circle,rect,polygon,path')?.dispatchEvent(new MouseEvent('click',{bubbles:true}));return 'clicked:'+target.querySelector('text')?.textContent}return 'none'})()`},
    {a:'wait',ms:1500},{a:'ss',n:'02-with-selection'},
    {a:'eval',s:clickTab('connections')},{a:'wait',ms:500},{a:'ss',n:'03-connections'},
    ...detailCloseup('04-connections-closeup')],
  'state-machines':        [
    {a:'wait',ms:500},{a:'ss',n:'01-initial'},
    // Click state_machine node to show dashed ring + states data
    {a:'eval',s:CLICK_TYPE('state_machine')},{a:'wait',ms:1500},{a:'ss',n:'02-with-selection'},
    {a:'eval',s:clickTab('ast')},{a:'wait',ms:500},{a:'ss',n:'03-states'},
    ...detailCloseup('04-states-closeup')],
  'performance':           [
    {a:'wait',ms:500},
    // Expand 2 hub nodes to get more nodes in graph (triggers minimap at >15)
    {a:'eval',s:EXPAND_HUB(0)},{a:'wait',ms:2000},
    {a:'eval',s:EXPAND_HUB(1)},{a:'wait',ms:2000},
    // Fit-to-graph to show minimap with full graph visible
    {a:'eval',s:`(()=>{const svgs=[...document.querySelectorAll('svg')];const svg=svgs.find(s=>s.__fitToGraph);if(svg){svg.__fitToGraph();return 'fit:'+svgs.indexOf(svg)}return 'no fitToGraph found'})()`},
    {a:'wait',ms:1000},
    {a:'ss',n:'01-expanded-graph'},
    {a:'eval',s:CLICK_NODE},{a:'wait',ms:1000},{a:'ss',n:'02-with-selection'},
    ...graphCloseup('03-perf-closeup')],
  // LiveOverflow groups — beginner-friendly captures showing discoverability
  'progressive-disclosure':[
    // Show sparse initial graph (few nodes), then expand to show progressive materialization
    {a:'wait',ms:500},{a:'ss',n:'01-seeded-graph'},
    // Click a node to show detail + chat panel
    {a:'eval',s:CLICK_NODE},{a:'wait',ms:1500},
    // Expand a hub to show nodes materializing
    {a:'eval',s:EXPAND_HUB(0)},{a:'wait',ms:2000},{a:'ss',n:'02-after-expand'},
    ...graphCloseup('03-graph-closeup'),
    // Switch to Analysis tab before right pane closeup
    {a:'eval',s:clickAnalysis},{a:'wait',ms:500},
    ...rightPaneCloseup('04-chat-closeup')],
  'learning-path':         [
    {a:'wait',ms:500},{a:'ss',n:'01-initial'},
    {a:'eval',s:CLICK_NODE},{a:'wait',ms:1500},{a:'ss',n:'02-with-selection'},
    // Ensure Analysis tab is active, then show chat pane with suggested queries
    {a:'eval',s:clickAnalysis},{a:'wait',ms:500},
    ...rightPaneCloseup('03-chat-closeup'),
    ...detailCloseup('04-detail-closeup')],
  'vulnerability-hunting': [
    {a:'wait',ms:500},{a:'ss',n:'01-initial'},
    {a:'eval',s:CLICK_NODE},{a:'wait',ms:1500},
    {a:'eval',s:switchPerspective('security')},{a:'wait',ms:1500},{a:'ss',n:'02-security-view'},
    // Show detail panel with CWE tags
    ...detailCloseup('03-detail-closeup'),
    // Show table with CWE/ATT&CK columns
    {a:'eval',s:clickTab('table')},{a:'wait',ms:500},
    ...detailCloseup('04-table-closeup')],
  'visual-design':         [
    {a:'wait',ms:500},{a:'ss',n:'01-initial'},
    {a:'eval',s:CLICK_NODE},{a:'wait',ms:1000},{a:'ss',n:'02-with-selection'},
    // Graph closeup showing legend bar, node shapes, edge colors
    ...graphCloseup('03-graph-closeup')],
  'ctf-workflow':          [...PRE, {a:'eval',s:clickJournal},{a:'wait',ms:500},{a:'ss',n:'03-journal'},...rightPaneCloseup('04-journal-closeup')],
  'graph-interaction':     [
    {a:'wait',ms:500},{a:'ss',n:'01-initial'},
    // Click node — shows pulse ring, edge highlighting, detail panel
    {a:'eval',s:CLICK_NODE},{a:'wait',ms:800},{a:'ss',n:'02-selected'},
    // Double-click to expand neighbors
    {a:'eval',s:`document.querySelectorAll('g.nodes g')[3]?.querySelector('circle,rect')?.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`},
    {a:'wait',ms:2000},{a:'ss',n:'03-dblclick-expand'},
    ...graphCloseup('04-interaction-closeup')],
  'accessibility':         [
    {a:'wait',ms:500},{a:'ss',n:'01-initial'},
    {a:'eval',s:CLICK_NODE},{a:'wait',ms:1000},{a:'ss',n:'02-with-selection'},
    // Graph closeup showing keyboard hints (F=fit Esc=desel) in legend bar
    ...graphCloseup('03-keyboard-help'),
    // Detail closeup showing labeled export buttons and tabs
    ...detailCloseup('04-detail-closeup')],
  'error-states':          [
    {a:'wait',ms:500},{a:'ss',n:'01-initial'},
    {a:'eval',s:CLICK_NODE},{a:'wait',ms:1500},
    // Use TABLE filter with nonexistent term to show empty/filtered state
    {a:'eval',s:clickTab('table')},{a:'wait',ms:500},
    {a:'eval',s:`(()=>{const inp=document.getElementById('be-table-filter');if(inp){const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(inp,'zzz_nonexistent');inp.dispatchEvent(new Event('input',{bubbles:true}));return 'filtered zzz'}return 'no filter'})()`},
    {a:'wait',ms:500},{a:'ss',n:'02-empty-filter'},
    // Graph closeup showing dimmed nodes (all filtered out)
    ...graphCloseup('03-dimmed-graph'),
    // Clear and search "error" to show matching
    {a:'eval',s:`(()=>{const inp=document.getElementById('be-table-filter');if(inp){const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(inp,'auth');inp.dispatchEvent(new Event('input',{bubbles:true}));return 'filtered auth'}return 'no filter'})()`},
    {a:'wait',ms:500},{a:'ss',n:'04-auth-filter'}],
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
    // Clean old screenshots to prevent stale files confusing VLM (which takes first+last)
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.png')) fs.unlinkSync(path.join(dir, f));
      }
    }
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
        else if (s.a === 'waitSel') {
          await waitForSelector(cdp, s.sel, s.timeout || 5000);
        }
        else if (s.a === 'waitId') {
          await waitForContent(cdp, s.id, s.timeout || 5000);
        }
        else if (s.a === 'ssClip') {
          // Clipped screenshot of a specific element (2x scale for readability)
          const ok = await clipScreenshot(cdp, s.sel, path.join(dir, s.n + '.png'));
          if (ok) { shots++; captured++; }
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

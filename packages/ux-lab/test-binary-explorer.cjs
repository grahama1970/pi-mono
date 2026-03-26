#!/usr/bin/env node
/**
 * Binary Explorer CDP Integration Test
 *
 * Tests every interaction path via Chrome DevTools Protocol.
 * Run: node test-binary-explorer.js
 * Requires: Express server on :3001, Chrome installed
 */
const http = require('http');
const WebSocket = require('ws');
const { execSync, spawn } = require('child_process');

const SERVER = 'http://localhost:3001';
const URL = `${SERVER}/#binary-explorer/droid`;
let ws, id = 1, chrome;
const errors = [];
const results = [];

function send(method, params = {}) {
  return new Promise((resolve) => {
    const msgId = id++;
    const handler = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id === msgId) { ws.off('message', handler); resolve(msg); }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

async function evaluate(expr) {
  const res = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (res.result?.exceptionDetails) {
    const desc = res.result.exceptionDetails.exception?.description || res.result.exceptionDetails.text;
    throw new Error(desc);
  }
  return res.result?.result?.value;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function test(name, fn) {
  try {
    await fn();
    results.push({ name, pass: true });
    console.log(`  ✓ ${name}`);
  } catch (e) {
    results.push({ name, pass: false, error: e.message.split('\n')[0] });
    console.log(`  ✗ ${name}: ${e.message.split('\n')[0]}`);
  }
}

async function run() {
  // Start Chrome
  chrome = spawn('google-chrome-stable', [
    '--headless=new', '--disable-gpu', '--remote-debugging-port=9230',
    '--window-size=1920,1080', 'about:blank'
  ], { stdio: 'ignore' });
  await sleep(3000);

  // Connect via CDP
  const pages = await new Promise((resolve) => {
    http.get('http://localhost:9230/json', (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
  });
  ws = new WebSocket(pages[0].webSocketDebuggerUrl);
  await new Promise(r => ws.on('open', r));

  // Capture all runtime exceptions
  await send('Runtime.enable');
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.method === 'Runtime.exceptionThrown') {
      const desc = msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text;
      errors.push(desc.split('\n').slice(0, 3).join(' | '));
    }
  });

  console.log('\n=== BINARY EXPLORER TEST SUITE ===\n');
  console.log('Phase 1: Initial Load\n');

  // Navigate
  await send('Page.navigate', { url: URL });
  await sleep(5000);

  await test('Page loads without errors', async () => {
    if (errors.length > 0) throw new Error(errors.join('; '));
  });

  await test('Empty scene shown (0 nodes in graph)', async () => {
    const count = await evaluate("document.querySelectorAll('g.nodes g').length");
    if (count !== 0) throw new Error(`Expected 0 nodes, got ${count}`);
  });

  await test('Seed buttons visible', async () => {
    const buttons = await evaluate(`
      [...document.querySelectorAll('button')].map(b => b.textContent).filter(t => t.includes('Seed'))
    `);
    if (!buttons || buttons.length < 2) throw new Error(`Expected seed buttons, got: ${JSON.stringify(buttons)}`);
  });

  await test('Scene counter shows 0/N', async () => {
    const text = await evaluate("document.body.innerText");
    if (!text.includes('in scene') && !text.includes('EMPTY SCENE')) throw new Error('No scene indicator found');
  });

  console.log('\nPhase 2: Seed Namespaces\n');

  await test('Click "Seed: Namespaces" adds nodes', async () => {
    const before = errors.length;
    await evaluate("document.querySelectorAll('button').forEach(b => { if (b.textContent.includes('Seed: Namespaces')) b.click() })");
    await sleep(3000);
    if (errors.length > before) throw new Error('Exception after seed: ' + errors.slice(before).join('; '));
    const count = await evaluate("document.querySelectorAll('g.nodes g').length");
    if (count < 2) throw new Error(`Expected >=2 namespace nodes, got ${count}`);
  });

  await test('Namespace labels visible', async () => {
    const labels = await evaluate(`
      [...document.querySelectorAll('g.nodes text.node-label')].filter(t => parseFloat(t.getAttribute('opacity')) > 0.5).map(t => t.textContent)
    `);
    if (!labels || labels.length === 0) throw new Error('No visible labels');
  });

  console.log('\nPhase 3: Click First Node\n');

  await test('Click node #0 — no crash', async () => {
    const before = errors.length;
    await evaluate("document.querySelectorAll('g.nodes g')[0]?.dispatchEvent(new MouseEvent('click', {bubbles:true}))");
    await sleep(2000);
    if (errors.length > before) throw new Error('Exception: ' + errors.slice(before).join('; '));
  });

  await test('Clicking added neighbors to scene', async () => {
    const count = await evaluate("document.querySelectorAll('g.nodes g').length");
    if (count < 3) throw new Error(`Expected neighbors added, got ${count} nodes`);
  });

  await test('Edges visible after click', async () => {
    const visibleEdges = await evaluate(`
      [...document.querySelectorAll('g.edges path')].filter(p => parseFloat(p.getAttribute('stroke-opacity')) > 0.1).length
    `);
    if (visibleEdges < 1) throw new Error(`Expected visible edges, got ${visibleEdges}`);
  });

  await test('Selected node has glow filter', async () => {
    const hasGlow = await evaluate(`
      [...document.querySelectorAll('g.nodes circle.node-shape')].some(c => c.getAttribute('filter')?.includes('node-glow'))
    `);
    if (!hasGlow) throw new Error('No glow filter on selected node');
  });

  console.log('\nPhase 4: Click Second Node\n');

  await test('Click node #1 — no crash', async () => {
    const before = errors.length;
    await evaluate("document.querySelectorAll('g.nodes g')[1]?.dispatchEvent(new MouseEvent('click', {bubbles:true}))");
    await sleep(2000);
    if (errors.length > before) throw new Error('Exception: ' + errors.slice(before).join('; '));
  });

  await test('Click node #2 — no crash', async () => {
    const before = errors.length;
    const nodeCount = await evaluate("document.querySelectorAll('g.nodes g').length");
    if (nodeCount > 2) {
      await evaluate("document.querySelectorAll('g.nodes g')[2]?.dispatchEvent(new MouseEvent('click', {bubbles:true}))");
      await sleep(2000);
    }
    if (errors.length > before) throw new Error('Exception: ' + errors.slice(before).join('; '));
  });

  console.log('\nPhase 5: Rapid-Fire Clicks (stress test)\n');

  await test('Rapid click 5 nodes in 1 second — no crash', async () => {
    const before = errors.length;
    for (let i = 0; i < 5; i++) {
      await evaluate(`document.querySelectorAll('g.nodes g')[${i}]?.dispatchEvent(new MouseEvent('click', {bubbles:true}))`);
      await sleep(200);
    }
    await sleep(2000);
    if (errors.length > before) throw new Error('Exception: ' + errors.slice(before).join('; '));
  });

  await test('Graph still has nodes after rapid clicks', async () => {
    const count = await evaluate("document.querySelectorAll('g.nodes g').length");
    if (count < 2) throw new Error(`Graph collapsed to ${count} nodes`);
  });

  console.log('\nPhase 6: Scene Controls\n');

  await test('Click "CLEAR" resets to empty scene', async () => {
    const before = errors.length;
    await evaluate("document.querySelectorAll('button').forEach(b => { if (b.textContent === 'CLEAR') b.click() })");
    await sleep(2000);
    if (errors.length > before) throw new Error('Exception: ' + errors.slice(before).join('; '));
    const count = await evaluate("document.querySelectorAll('g.nodes g').length");
    if (count > 0) throw new Error(`Expected 0 nodes after clear, got ${count}`);
  });

  await test('Click "Show All" loads all nodes', async () => {
    const before = errors.length;
    await evaluate("document.querySelectorAll('button').forEach(b => { if (b.textContent.includes('Show All')) b.click() })");
    await sleep(3000);
    if (errors.length > before) throw new Error('Exception: ' + errors.slice(before).join('; '));
    const count = await evaluate("document.querySelectorAll('g.nodes g').length");
    if (count < 50) throw new Error(`Expected many nodes, got ${count}`);
  });

  console.log('\nPhase 7: Click Nodes With Full Graph\n');

  await test('Click node in full graph — no crash', async () => {
    const before = errors.length;
    await evaluate("document.querySelectorAll('g.nodes g')[5]?.dispatchEvent(new MouseEvent('click', {bubbles:true}))");
    await sleep(2000);
    if (errors.length > before) throw new Error('Exception: ' + errors.slice(before).join('; '));
  });

  await test('Click different node in full graph — no crash', async () => {
    const before = errors.length;
    await evaluate("document.querySelectorAll('g.nodes g')[20]?.dispatchEvent(new MouseEvent('click', {bubbles:true}))");
    await sleep(2000);
    if (errors.length > before) throw new Error('Exception: ' + errors.slice(before).join('; '));
  });

  await test('Rapid click 10 nodes in full graph — no crash', async () => {
    const before = errors.length;
    for (let i = 0; i < 10; i++) {
      await evaluate(`document.querySelectorAll('g.nodes g')[${i * 10}]?.dispatchEvent(new MouseEvent('click', {bubbles:true}))`);
      await sleep(100);
    }
    await sleep(3000);
    if (errors.length > before) throw new Error('Exception: ' + errors.slice(before).join('; '));
  });

  console.log('\nPhase 8: Layout Switching\n');

  await test('Switch to STRATIFIED layout — no crash', async () => {
    const before = errors.length;
    await evaluate("document.querySelectorAll('button').forEach(b => { if (b.textContent === 'STRATIFIED') b.click() })");
    await sleep(3000);
    if (errors.length > before) throw new Error('Exception: ' + errors.slice(before).join('; '));
    const count = await evaluate("document.querySelectorAll('g.nodes g').length");
    if (count < 10) throw new Error(`Graph lost nodes on layout switch: ${count}`);
  });

  await test('Switch to CLUSTERED layout — no crash', async () => {
    const before = errors.length;
    await evaluate("document.querySelectorAll('button').forEach(b => { if (b.textContent === 'CLUSTERED') b.click() })");
    await sleep(3000);
    if (errors.length > before) throw new Error('Exception: ' + errors.slice(before).join('; '));
  });

  await test('Switch back to ORGANIC — no crash', async () => {
    const before = errors.length;
    await evaluate("document.querySelectorAll('button').forEach(b => { if (b.textContent === 'ORGANIC') b.click() })");
    await sleep(3000);
    if (errors.length > before) throw new Error('Exception: ' + errors.slice(before).join('; '));
  });

  // Summary
  console.log('\n=== RESULTS ===\n');
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`${passed} passed, ${failed} failed out of ${results.length} tests`);
  if (failed > 0) {
    console.log('\nFailed tests:');
    results.filter(r => !r.pass).forEach(r => console.log(`  ✗ ${r.name}: ${r.error}`));
  }
  if (errors.length > 0) {
    console.log(`\nTotal runtime exceptions captured: ${errors.length}`);
    errors.forEach(e => console.log(`  ${e.substring(0, 120)}`));
  }

  ws.close();
  chrome.kill();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => {
  console.error('Test runner crashed:', e);
  if (chrome) chrome.kill();
  process.exit(1);
});

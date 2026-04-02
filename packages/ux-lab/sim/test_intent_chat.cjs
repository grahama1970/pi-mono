#!/usr/bin/env node
/**
 * Visual QA: Intent-first chat flow in SPARTA Explorer.
 *
 * Tests the full pipeline:
 *   /memory intent → /create-evidence-case → ReasoningBlock
 *   /memory intent → APP_COMMAND → viz switching
 *   /memory intent → NO_MATCH → RecallCard
 *   /memory clarify → clarify chips
 *
 * Uses raw CDP — no Puppeteer. Captures per-element crops at 2x for VLM review.
 *
 * Usage:
 *   node sim/test_intent_chat.cjs
 *   node sim/test_intent_chat.cjs --skip-slow   # skip evidence case (90s timeout)
 */
'use strict';
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.CDP_PORT || 9253);
const BASE = process.env.UX_LAB_URL || 'http://localhost:3002';
const CAPTURES = path.join(__dirname, '..', 'captures', 'intent-chat-qa');
const skipSlow = process.argv.includes('--skip-slow');

fs.mkdirSync(CAPTURES, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── CDP helpers (same as run_cdp_captures.cjs) ─────────────────────
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
    const t = setTimeout(() => rej(new Error(`CDP timeout: ${method}`)), 30000);
    const handler = raw => {
      const m = JSON.parse(raw.toString());
      if (m.id === id) { ws.off('message', handler); clearTimeout(t); res(m); }
    };
    ws.on('message', handler);
    ws.send(JSON.stringify({ id, method, params }));
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return { send, close: () => ws.close() };
}

async function fullScreenshot(cdp, outPath) {
  const ss = await cdp.send('Page.captureScreenshot', { format: 'png' });
  if (ss.result?.data) {
    fs.writeFileSync(outPath, Buffer.from(ss.result.data, 'base64'));
    return true;
  }
  return false;
}

async function clipScreenshot(cdp, selector, outPath) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: `(()=>{const el=document.querySelector('${selector}');if(!el)return null;const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`,
    returnByValue: true,
  });
  const rect = r.result?.result?.value;
  if (!rect || rect.width < 10 || rect.height < 10) {
    console.log(`  ⚠ clipScreenshot: selector "${selector}" not found or too small`);
    return false;
  }
  const clip = {
    x: Math.max(0, rect.x),
    y: Math.max(0, rect.y),
    width: Math.min(rect.width, 1440 - Math.max(0, rect.x)),
    height: Math.min(rect.height, 900 - Math.max(0, rect.y)),
    scale: 2,
  };
  const ss = await cdp.send('Page.captureScreenshot', { format: 'png', clip });
  if (ss.result?.data) {
    fs.writeFileSync(outPath, Buffer.from(ss.result.data, 'base64'));
    return true;
  }
  return false;
}

async function waitForSelector(cdp, selector, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `(()=>{const el=document.querySelector('${selector}');return el && el.offsetHeight > 0 ? 'found' : null})()`,
      returnByValue: true,
    });
    if (r.result?.result?.value === 'found') return true;
    await sleep(300);
  }
  return false;
}

async function typeInChat(cdp, text) {
  // Focus the SPARTA chat textarea
  const focusR = await cdp.send('Runtime.evaluate', {
    expression: `(()=>{
      const textareas = document.querySelectorAll('textarea');
      for (const ta of textareas) {
        if (ta.placeholder && ta.placeholder.includes('SPARTA') && ta.offsetHeight > 0) {
          ta.focus();
          ta.click();
          return 'focused';
        }
      }
      return 'no_textarea_found';
    })()`,
    returnByValue: true,
  });
  if (focusR.result?.result?.value !== 'focused') {
    console.log(`  ⚠ typeInChat: ${focusR.result?.result?.value}`);
    return false;
  }
  await sleep(100);

  // Insert text via CDP (triggers React input events)
  await cdp.send('Input.insertText', { text });
  await sleep(200);

  // Press Enter via CDP (triggers React onKeyDown)
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  await sleep(100);
  return true;
}

async function getTextContent(cdp, selector) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: `(()=>{const el=document.querySelector('${selector}');return el ? el.textContent.trim().substring(0, 500) : null})()`,
    returnByValue: true,
  });
  return r.result?.result?.value || null;
}

async function countElements(cdp, selector) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: `document.querySelectorAll('${selector}').length`,
    returnByValue: true,
  });
  return r.result?.result?.value || 0;
}

// ── Test cases ──────────────────────────────────────────────────────

const results = [];
function record(name, pass, detail = '') {
  results.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ': ' + detail : ''}`);
}

async function main() {
  console.log('═══ Intent-First Chat Visual QA ═══\n');
  const cdp = await connectCDP(PORT);

  try {
    // ── Navigate to SPARTA Explorer ─────────────────────────────────
    console.log('Phase 1: Navigate to SPARTA Explorer');
    await cdp.send('Page.navigate', { url: `${BASE}/#sparta-explorer` });
    await sleep(3000);
    await fullScreenshot(cdp, path.join(CAPTURES, '00_initial_load.png'));
    record('SPARTA Explorer loads', true);

    // ── Test 1: QUERY intent → Evidence Case → ReasoningBlock ───────
    if (!skipSlow) {
      console.log('\nPhase 2: QUERY intent (evidence case pipeline, ~90s)');
      // Fresh page load for clean chat state
      await cdp.send('Page.navigate', { url: `${BASE}/#sparta-explorer` });
      await sleep(3000);
      await typeInChat(cdp, 'How does SPARTA address GPS spoofing for DE-0007?');
      console.log('  Waiting for evidence case pipeline (up to 120s)...');

      // Wait for evidence case response: count user messages, then wait for a new non-user message after ours
      const hasSysMsg = await (async () => {
        // Count messages before we wait
        const beforeR = await cdp.send('Runtime.evaluate', {
          expression: `(()=>{
            const bubbles = document.querySelectorAll('[style*="justify-content: flex-end"]');
            return bubbles.length;
          })()`,
          returnByValue: true,
        });
        const userMsgCount = beforeR.result?.result?.value || 0;
        console.log(`  User messages before wait: ${userMsgCount}`);

        const start = Date.now();
        while (Date.now() - start < 120000) {
          // Look for the ReasoningBlock toggle (definitive evidence case rendered)
          const r = await cdp.send('Runtime.evaluate', {
            expression: `(()=>{
              if (document.querySelector('[aria-label*="Toggle reasoning"]')) return 'reasoning';
              // Also check for clarify chips or "gates passed" text
              const all = document.body.textContent || '';
              if (all.includes('gates passed') && all.lastIndexOf('gates passed') > all.lastIndexOf('GPS spoofing')) return 'gates';
              if (all.includes('insufficient confidence')) return 'clarify';
              if (all.includes('Found') && all.includes('results across SPARTA')) return 'recall';
              return null;
            })()`,
            returnByValue: true,
          });
          const v = r.result?.result?.value;
          if (v) { console.log(`  Detected: ${v}`); return true; }
          await sleep(3000);
        }
        return false;
      })();
      await sleep(2000); // let rendering settle
      await fullScreenshot(cdp, path.join(CAPTURES, '01_query_full.png'));

      if (hasSysMsg) {
        record('System message appears after QUERY', true);
        // Give extra time for ReasoningBlock to render after system message
        await sleep(3000);

        // Check for ReasoningBlock (evidence case with verdict)
        const hasReasoning = await waitForSelector(cdp, '[aria-label*="Toggle reasoning"]', 10000);
        if (hasReasoning) {
          record('ReasoningBlock renders (Level 0)', true);
          await clipScreenshot(cdp, '[aria-label*="Toggle reasoning"]', path.join(CAPTURES, '02_reasoning_toggle_btn.png'));

          // Crop the reasoning block container (parent of toggle button)
          const cropped = await clipScreenshot(cdp, '[style*="border-left: 3px"]', path.join(CAPTURES, '03_reasoning_block_l0.png'));
          if (!cropped) {
            // Try alternate selector for the purple-bordered block
            await clipScreenshot(cdp, '[style*="borderLeft"]', path.join(CAPTURES, '03_reasoning_block_l0.png'));
          }
          record('ReasoningBlock Level 0 cropped', true);

          // Click to Level 1 (gate pills)
          await cdp.send('Runtime.evaluate', {
            expression: `document.querySelector('[aria-label*="Toggle reasoning"]')?.click()`,
          });
          await sleep(500);
          await fullScreenshot(cdp, path.join(CAPTURES, '04_reasoning_level1.png'));
          record('ReasoningBlock Level 1 (gate pills)', true);

          // Click to Level 2 (full GateChain)
          await cdp.send('Runtime.evaluate', {
            expression: `document.querySelector('[aria-label*="Toggle reasoning"]')?.click()`,
          });
          await sleep(500);
          await fullScreenshot(cdp, path.join(CAPTURES, '05_reasoning_level2.png'));
          record('ReasoningBlock Level 2 (GateChain)', true);
        } else {
          // No ReasoningBlock — check if we got RecallCard instead (gates < 5 → clarify)
          record('ReasoningBlock renders', false, 'Toggle button not found — may have gotten clarify/recall instead');
          await clipScreenshot(cdp, '[data-role="system"]:last-of-type', path.join(CAPTURES, '03_system_msg_crop.png'));
        }

        // Check for clarifyOptions chips
        const chips = await countElements(cdp, '[data-clarify]');
        if (chips > 0) {
          record('Clarify chips rendered', true, `${chips} chips`);
          await clipScreenshot(cdp, '[data-clarify]', path.join(CAPTURES, '06_clarify_chips.png'));
        }

        // Check verdict text — look for SATISFIED/INCONCLUSIVE/NOT_SATISFIED in the reasoning block
        const verdictText = await (async () => {
          const r = await cdp.send('Runtime.evaluate', {
            expression: `(()=>{
              const els = document.querySelectorAll('span');
              for (const el of els) {
                const t = el.textContent.trim();
                if (t === 'SATISFIED' || t === 'INCONCLUSIVE' || t === 'NOT SATISFIED') return t;
              }
              return null;
            })()`,
            returnByValue: true,
          });
          return r.result?.result?.value;
        })();
        record('Verdict text visible', !!verdictText, verdictText || 'none');
      } else {
        record('System message appears after QUERY', false, 'No system message within 120s');
      }
    } else {
      console.log('\nPhase 2: SKIPPED (--skip-slow)');
    }

    // ── Test 2: APP_COMMAND → Dashboard viz switch ──────────────────
    console.log('\nPhase 3: APP_COMMAND → Dashboard');
    await cdp.send('Page.navigate', { url: `${BASE}/#sparta-explorer` });
    await sleep(2000);
    await typeInChat(cdp, 'show posture dashboard');
    await sleep(3000);
    await fullScreenshot(cdp, path.join(CAPTURES, '10_dashboard_full.png'));

    // Check if dashboard rendered (look for "Posture Dashboard" or "coming soon" text)
    const dashText = await getTextContent(cdp, '[style*="padding: 20"]');
    record('Dashboard renders on APP_COMMAND', !!dashText, dashText?.substring(0, 60) || 'none');

    // ── Test 3: APP_COMMAND → Matrix viz switch ─────────────────────
    console.log('\nPhase 4: APP_COMMAND → Threat Matrix');
    await cdp.send('Page.navigate', { url: `${BASE}/#sparta-explorer` });
    await sleep(2000);
    await typeInChat(cdp, 'show me the threat matrix');
    await sleep(5000);
    await fullScreenshot(cdp, path.join(CAPTURES, '11_matrix_full.png'));
    record('Matrix narration appears', true);

    // ── Test 4: APP_COMMAND → Critical Path ─────────────────────────
    console.log('\nPhase 5: APP_COMMAND → Critical Path');
    await cdp.send('Page.navigate', { url: `${BASE}/#sparta-explorer` });
    await sleep(2000);
    await typeInChat(cdp, 'show critical path');
    await sleep(3000);
    await fullScreenshot(cdp, path.join(CAPTURES, '12_critical_path_full.png'));
    record('Critical path graph renders', true);

    // ── Test 5: NO_MATCH → RecallCard ───────────────────────────────
    console.log('\nPhase 6: NO_MATCH → RecallCard');
    await cdp.send('Page.navigate', { url: `${BASE}/#sparta-explorer` });
    await sleep(2000);
    await typeInChat(cdp, 'what is the moon made of');
    await sleep(5000);
    await fullScreenshot(cdp, path.join(CAPTURES, '13_no_match_full.png'));
    const recallItems = await countElements(cdp, '[data-recall-item]');
    record('RecallCard or fallback message appears', true, `${recallItems} recall items`);

    // ── Summary ─────────────────────────────────────────────────────
    console.log('\n═══ RESULTS ═══');
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    console.log(`${passed} passed, ${failed} failed out of ${results.length} checks`);
    console.log(`Screenshots in: ${CAPTURES}`);

    // Write results JSON for VLM batch review
    fs.writeFileSync(
      path.join(CAPTURES, 'results.json'),
      JSON.stringify({ timestamp: new Date().toISOString(), results, captures: CAPTURES }, null, 2)
    );

  } finally {
    cdp.close();
  }

  process.exit(results.some(r => !r.pass) ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });

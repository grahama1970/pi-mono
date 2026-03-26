/**
 * CDP Interaction Harness for UX Lab projects
 *
 * Connects to Chrome via the remote debugging protocol (raw WebSocket — no Puppeteer),
 * navigates to any UX Lab hash route, waits for React hydration, and exposes a
 * high-level interaction API that returns structured JSON per call.
 *
 * Usage (programmatic):
 *   const { createHarness } = require('./cdp-harness.cjs');
 *   const h = await createHarness({ port: 9252, route: 'binary-explorer/droid' });
 *   await h.screenshot('initial');
 *   const count = await h.getSceneCount();
 *   await h.close();
 *
 * Usage (self-test):
 *   node packages/ux-lab/sim/cdp-harness.cjs --self-test
 */

'use strict';

const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------
const DEFAULT_PORT = 9252;
const DEFAULT_BASE_URL = 'http://localhost:3001';
const DEFAULT_HYDRATION_TIMEOUT_MS = 10000;
const DEFAULT_POLL_INTERVAL_MS = 200;
const SCREENSHOT_DIR = '/tmp';

// ---------------------------------------------------------------------------
// Low-level CDP connection
// ---------------------------------------------------------------------------

/**
 * Open a raw CDP WebSocket to the first available page on `port`.
 * Returns { ws, send, close, errors } where:
 *   send(method, params) → Promise<CDPResponse>
 *   errors               → Array of Runtime.exceptionThrown payloads
 */
async function openCDP(port) {
  const pages = await new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}/json`, res => {
      let data = '';
      res.on('data', chunk => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Failed to parse /json: ${e.message}`)); }
      });
    }).on('error', err => reject(new Error(`Cannot reach CDP on port ${port}: ${err.message}`)));
  });

  if (!pages || pages.length === 0) {
    throw new Error(`No pages found on CDP port ${port}`);
  }

  const wsUrl = pages[0].webSocketDebuggerUrl;
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  let msgId = 1;
  const errors = [];

  // Collect all Runtime.exceptionThrown events
  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.method === 'Runtime.exceptionThrown') {
        errors.push({
          timestamp: Date.now(),
          description:
            msg.params?.exceptionDetails?.exception?.description ||
            msg.params?.exceptionDetails?.text ||
            'Unknown runtime exception',
          raw: msg.params,
        });
      }
    } catch (_) {/* ignore parse errors */}
  });

  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = msgId++;
      const timeout = setTimeout(
        () => reject(new Error(`CDP timeout for ${method} (id=${id})`)),
        15000
      );
      const handler = raw => {
        let m;
        try { m = JSON.parse(raw.toString()); } catch (_) { return; }
        if (m.id === id) {
          ws.off('message', handler);
          clearTimeout(timeout);
          resolve(m);
        }
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ id, method, params }), sendErr => {
        if (sendErr) {
          ws.off('message', handler);
          clearTimeout(timeout);
          reject(sendErr);
        }
      });
    });

  const close = () => {
    try { ws.close(); } catch (_) {}
  };

  return { ws, send, close, errors };
}

// ---------------------------------------------------------------------------
// React hydration wait
// ---------------------------------------------------------------------------

/**
 * Poll until `#root` (or `[data-reactroot]`) has non-empty text content,
 * which signals that React has mounted.
 */
async function waitForHydration(evalFn, { timeoutMs = DEFAULT_HYDRATION_TIMEOUT_MS, pollMs = DEFAULT_POLL_INTERVAL_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const text = await evalFn(
      `(document.getElementById('root') || document.querySelector('[data-reactroot]') || document.body).innerText.trim().length`
    );
    if (typeof text === 'number' && text > 10) return true;
    await sleep(pollMs);
  }
  throw new Error(`React hydration timed out after ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = ms => new Promise(r => setTimeout(r, ms));

function ok(result) {
  return { ok: true, result };
}

function fail(error) {
  return { ok: false, error: String(error) };
}

// ---------------------------------------------------------------------------
// Harness factory
// ---------------------------------------------------------------------------

/**
 * Create and connect a CDP harness.
 *
 * @param {object} opts
 * @param {number}  [opts.port=9252]          Chrome remote debugging port
 * @param {string}  [opts.route]              Hash route, e.g. 'binary-explorer/droid'
 * @param {string}  [opts.baseUrl]            Base URL (default http://localhost:3001)
 * @param {number}  [opts.hydrationTimeout]   ms to wait for React mount
 * @returns {Promise<Harness>}
 */
async function createHarness(opts = {}) {
  const {
    port = DEFAULT_PORT,
    route,
    baseUrl = DEFAULT_BASE_URL,
    hydrationTimeout = DEFAULT_HYDRATION_TIMEOUT_MS,
  } = opts;

  const cdp = await openCDP(port);

  // Enable runtime event stream (needed for exceptionThrown)
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');

  // Navigate
  const targetUrl = route
    ? `${baseUrl}/#${route}`
    : baseUrl;

  await cdp.send('Page.navigate', { url: targetUrl });

  // Internal evaluate helper: returns unwrapped JS value or throws
  const rawEval = async expr => {
    const res = await cdp.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.result?.exceptionDetails) {
      const msg =
        res.result.exceptionDetails.exception?.description ||
        res.result.exceptionDetails.text ||
        'Script exception';
      throw new Error(msg);
    }
    return res.result?.result?.value;
  };

  // Wait for hydration
  await waitForHydration(rawEval, { timeoutMs: hydrationTimeout });

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Type text into an element matching `selector`.
   * Uses the React-compatible synthetic input setter.
   * @returns {{ ok, result: { selector, text } } | { ok, error }}
   */
  async function type(selector, text) {
    try {
      await rawEval(`
        (function(){
          var el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('Element not found: ${selector}');
          var setter = Object.getOwnPropertyDescriptor(
            el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
            'value'
          ).set;
          setter.call(el, ${JSON.stringify(text)});
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        })()
      `);
      return ok({ selector, text });
    } catch (e) {
      return fail(e.message);
    }
  }

  /**
   * Click the first element matching `selector`.
   * @returns {{ ok, result: { selector } } | { ok, error }}
   */
  async function click(selector) {
    try {
      await rawEval(`
        (function(){
          var el = document.querySelector(${JSON.stringify(selector)});
          if (!el) throw new Error('Element not found: ${selector}');
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        })()
      `);
      return ok({ selector });
    } catch (e) {
      return fail(e.message);
    }
  }

  /**
   * Evaluate an arbitrary JS expression in page context.
   * @returns {{ ok, result: any } | { ok, error }}
   */
  async function evaluate(script) {
    try {
      const value = await rawEval(script);
      return ok(value);
    } catch (e) {
      return fail(e.message);
    }
  }

  /**
   * Capture a PNG screenshot saved to SCREENSHOT_DIR/<name>.png.
   * @returns {{ ok, result: { path: string } } | { ok, error }}
   */
  async function screenshot(name) {
    try {
      const res = await cdp.send('Page.captureScreenshot', { format: 'png' });
      if (!res.result?.data) throw new Error('No screenshot data returned');
      const filePath = path.join(SCREENSHOT_DIR, `${name}.png`);
      fs.writeFileSync(filePath, Buffer.from(res.result.data, 'base64'));
      return ok({ path: filePath });
    } catch (e) {
      return fail(e.message);
    }
  }

  /**
   * Assert that `text` appears somewhere in document.body.innerText.
   * @returns {{ ok, result: { found: true, text } } | { ok, error }}
   */
  async function assertText(text) {
    try {
      const found = await rawEval(
        `document.body.innerText.includes(${JSON.stringify(text)})`
      );
      if (!found) {
        return fail(`assertText: "${text}" not found in page`);
      }
      return ok({ found: true, text });
    } catch (e) {
      return fail(e.message);
    }
  }

  /**
   * Return the current scene counter string, e.g. "3/42 in scene".
   * Returns null if no counter is visible.
   * @returns {{ ok, result: string|null } | { ok, error }}
   */
  async function getSceneCount() {
    try {
      const match = await rawEval(
        `(document.body.innerText.match(/\\d+\\/\\d+ in scene/) || [null])[0]`
      );
      return ok(match || null);
    } catch (e) {
      return fail(e.message);
    }
  }

  /**
   * Return an array of visible node label strings from the graph canvas.
   * Works with g.nodes > g elements that contain text.
   * @returns {{ ok, result: string[] } | { ok, error }}
   */
  async function getNodeLabels() {
    try {
      const labels = await rawEval(
        `[...document.querySelectorAll('g.nodes g text, g.nodes g [class*="label"]')]
          .map(el => el.textContent.trim())
          .filter(t => t.length > 0)`
      );
      return ok(Array.isArray(labels) ? labels : []);
    } catch (e) {
      return fail(e.message);
    }
  }

  /**
   * Return the current query specification object from the React app state.
   * Reads window.__querySpec if set, otherwise attempts to find it in
   * the React fibre tree or returns null.
   * @returns {{ ok, result: object|null } | { ok, error }}
   */
  async function getQuerySpec() {
    try {
      const spec = await rawEval(`
        (function(){
          if (window.__querySpec !== undefined) return window.__querySpec;
          // Try to find QuerySpec in React fibre
          var root = document.getElementById('root') || document.querySelector('[data-reactroot]');
          if (!root) return null;
          var key = Object.keys(root).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
          if (!key) return null;
          function findInFibre(node, depth) {
            if (depth > 20 || !node) return null;
            if (node.memoizedState && node.memoizedState.queue) {
              var s = node.memoizedState;
              while (s) {
                if (s.memoizedState && typeof s.memoizedState === 'object' && s.memoizedState.query !== undefined) {
                  return s.memoizedState;
                }
                s = s.next;
              }
            }
            var r = findInFibre(node.child, depth + 1) || findInFibre(node.sibling, depth + 1);
            return r;
          }
          return findInFibre(root[key], 0);
        })()
      `);
      return ok(spec !== undefined ? spec : null);
    } catch (e) {
      return fail(e.message);
    }
  }

  /**
   * Return all runtime errors captured since connection opened.
   */
  function getRuntimeErrors() {
    return [...cdp.errors];
  }

  /**
   * Close the WebSocket connection.
   */
  function close() {
    cdp.close();
  }

  return {
    type,
    click,
    evaluate,
    screenshot,
    assertText,
    getSceneCount,
    getNodeLabels,
    getQuerySpec,
    getRuntimeErrors,
    close,
    // Expose raw CDP send for advanced usage
    _send: cdp.send,
  };
}

// ---------------------------------------------------------------------------
// Self-test mode
// ---------------------------------------------------------------------------

async function selfTest() {
  const results = { passed: 0, failed: 0, tests: [] };

  function record(name, passed, detail) {
    results.tests.push({ name, passed, detail });
    if (passed) results.passed++;
    else results.failed++;
    const icon = passed ? '✓' : '✗';
    console.log(`  ${icon} ${name}${detail ? ': ' + detail : ''}`);
  }

  console.log('\n=== CDP HARNESS SELF-TEST ===\n');

  // --- Unit: ok() / fail() helpers ---
  (() => {
    const r1 = ok(42);
    record('ok() sets ok=true', r1.ok === true && r1.result === 42, JSON.stringify(r1));
    const r2 = fail('oops');
    record('fail() sets ok=false', r2.ok === false && r2.error === 'oops', JSON.stringify(r2));
  })();

  // --- Unit: sleep is a function ---
  record('sleep returns Promise', sleep(0) instanceof Promise, '');

  // --- Integration: connect to Chrome ---
  let harness = null;
  try {
    harness = await createHarness({
      port: DEFAULT_PORT,
      route: 'binary-explorer/droid',
    });
    record('createHarness connected', true, `port=${DEFAULT_PORT}`);
  } catch (e) {
    record('createHarness connected', false, e.message);
    console.log('\n[SELF-TEST] Chrome not reachable — skipping integration tests.');
    console.log(JSON.stringify({ ...results, skipped: true }, null, 2));
    process.exit(0);
  }

  try {
    // screenshot
    const ss = await harness.screenshot('self-test-initial');
    record('screenshot()', ss.ok, ss.ok ? ss.result.path : ss.error);

    // evaluate
    const ev = await harness.evaluate('typeof document');
    record('evaluate()', ev.ok && ev.result === 'object', JSON.stringify(ev.result));

    // assertText — expect some content
    const at = await harness.assertText(' ');  // any space character
    record('assertText() (truthy)', at.ok, '');

    // getSceneCount
    const sc = await harness.getSceneCount();
    record('getSceneCount() returns ok', sc.ok, JSON.stringify(sc.result));

    // getNodeLabels
    const nl = await harness.getNodeLabels();
    record('getNodeLabels() returns array', nl.ok && Array.isArray(nl.result), `count=${nl.result?.length}`);

    // getQuerySpec
    const qs = await harness.getQuerySpec();
    record('getQuerySpec() returns ok', qs.ok, typeof qs.result);

    // type() — into any input if present
    const typeRes = await harness.type('input', 'hello');
    record('type() executes without throw', typeRes.ok || typeRes.error.includes('not found'), typeRes.error || 'ok');

    // click() — missing selector should fail gracefully
    const clickFail = await harness.click('#nonexistent-element-xyz');
    record('click() fails gracefully on missing', !clickFail.ok && typeof clickFail.error === 'string', clickFail.error);

    // getRuntimeErrors
    const errs = harness.getRuntimeErrors();
    record('getRuntimeErrors() returns array', Array.isArray(errs), `count=${errs.length}`);

  } finally {
    harness.close();
  }

  console.log(`\n=== RESULTS: ${results.passed} passed, ${results.failed} failed ===\n`);
  console.log(JSON.stringify(results, null, 2));

  process.exit(results.failed > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Exports + CLI entry point
// ---------------------------------------------------------------------------

module.exports = { createHarness };

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    selfTest().catch(e => {
      console.error('FATAL:', e.message);
      process.exit(1);
    });
  } else {
    console.log('Usage: node cdp-harness.cjs --self-test');
    console.log('       const { createHarness } = require("./cdp-harness.cjs")');
    process.exit(0);
  }
}

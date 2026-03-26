/**
 * Blind Interaction Evaluator for UX Lab
 *
 * Implements the /test-lab pattern: the evaluator captures the *actual* result
 * of a command without ever seeing the expected (ground-truth) answer.
 * A separate grading step (grade-batch.py, task 8) compares actual vs expected.
 *
 * Usage (programmatic):
 *   const { evaluateInteraction } = require('./evaluate-interaction.cjs');
 *   const result = await evaluateInteraction('show me all syscalls', harness);
 *   // => { command, queryspec, scene_count, selected_node, screenshot_path, errors[] }
 *
 * Usage (CLI):
 *   node packages/ux-lab/sim/evaluate-interaction.cjs \
 *       --command "show me all syscalls" \
 *       [--port 9252] [--route binary-explorer/droid] [--timeout 15000]
 *
 * Design rules (NON-NEGOTIABLE):
 *   - Does NOT load any expected / ground-truth data
 *   - Does NOT compare actual output against anything
 *   - Captures exactly: QuerySpec, scene_count, selected_node, screenshot_path, errors[]
 *   - All errors are returned in errors[] — never thrown — so the batch runner can
 *     continue even when a single command fails
 */

'use strict';

const path = require('path');
const { createHarness } = require('./cdp-harness.cjs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PORT             = 9252;
const DEFAULT_BASE_URL         = 'http://localhost:3001';
const DEFAULT_ROUTE            = 'binary-explorer/droid';
const DEFAULT_RESPONSE_TIMEOUT = 15000;   // ms to wait for LLM / UI response
const POLL_INTERVAL_MS         = 300;

// Benchmark targets for batch coverage
const TARGET_TEXT_COMMANDS  = 200;  // minimum text command samples for full coverage
const TARGET_VOICE_COMMANDS = 50;   // minimum voice command samples for full coverage

// Patterns that indicate the LLM asked for clarification rather than acting
const CLARIFY_PATTERNS = [
  /\bdo you mean\b/i,
  /\bcould you clarify\b/i,
  /\bdid you mean\b/i,
  /\bplease clarify\b/i,
  /\bcan you be more specific\b/i,
  /\bwhich .+ do you mean\b/i,
  /\bI('m| am) not sure what you mean\b/i,
  /\bclarify\b.*\bwhich\b/i,
];

/**
 * Test whether an assistant response text indicates the LLM triggered a
 * clarification prompt (i.e. asked the user to disambiguate) rather than
 * immediately executing a UI command or answering directly.
 *
 * @param {string|null} responseText
 * @returns {boolean}
 */
function detectClarifyTriggered(responseText) {
  if (!responseText) return false;
  return CLARIFY_PATTERNS.some(re => re.test(responseText));
}

// Selectors — must match the React app's DOM structure
const CHAT_INPUT_SELECTOR      = 'textarea[data-testid="chat-input"], textarea.chat-input, input[data-testid="chat-input"], input.chat-input';
const SUBMIT_BUTTON_SELECTOR   = 'button[data-testid="chat-submit"], button.chat-submit, button[type="submit"]';
const SELECTED_NODE_SELECTOR   = '[data-testid="selected-node-label"], .selected-node-label, g.nodes g.selected text, g.nodes g[aria-selected="true"] text';
const QUERYSPEC_DETAILS_SELECTOR = 'details[data-testid="queryspec-details"], details.queryspec-details, details';
const RESPONSE_READY_SELECTOR  = '[data-testid="chat-response"]:not(.loading), .chat-message.assistant:last-child:not(.loading), .chat-response:not(.streaming)';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Slugify a command string into a filesystem-safe name for the screenshot.
 * @param {string} cmd
 * @returns {string}
 */
function slugify(cmd) {
  return cmd
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ---------------------------------------------------------------------------
// Core: submitCommand
// ---------------------------------------------------------------------------

/**
 * Type `command` into the chat input and submit it.
 * Tries the submit button first; falls back to Enter keypress.
 *
 * @param {object} harness  - CDP harness instance
 * @param {string} command  - Natural-language command string
 * @returns {Promise<string[]>} - Any errors encountered during submission
 */
async function submitCommand(harness, command) {
  const errs = [];

  // 1. Locate + focus + type into chat input
  const typeResult = await harness.type(CHAT_INPUT_SELECTOR, command);
  if (!typeResult.ok) {
    errs.push(`type into chat input: ${typeResult.error}`);
    // Attempt fallback: any visible textarea
    const fallback = await harness.type('textarea', command);
    if (!fallback.ok) {
      errs.push(`type fallback textarea: ${fallback.error}`);
      return errs;  // Cannot submit without an input
    }
  }

  // 2. Submit via button or Enter
  const clickResult = await harness.click(SUBMIT_BUTTON_SELECTOR);
  if (!clickResult.ok) {
    // Fallback: dispatch Enter on the input
    const enterResult = await harness.evaluate(`
      (function(){
        var el = document.querySelector(${JSON.stringify(CHAT_INPUT_SELECTOR)})
               || document.querySelector('textarea')
               || document.querySelector('input');
        if (!el) return false;
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup',   { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        return true;
      })()
    `);
    if (!enterResult.ok || !enterResult.result) {
      errs.push(`submit (button + Enter fallback both failed): ${clickResult.error}`);
    }
  }

  return errs;
}

// ---------------------------------------------------------------------------
// Core: waitForResponse
// ---------------------------------------------------------------------------

/**
 * Wait until the chat produces a non-loading assistant response OR a UI command
 * is dispatched (QuerySpec action = UI_COMMAND).  Polls the DOM.
 *
 * Resolution criteria (any one is sufficient):
 *   a) A non-loading assistant message appears in the chat
 *   b) window.__querySpec is populated (set by the app after intent classification)
 *   c) The scene counter changes (UI command navigated to a new scene)
 *   d) Timeout — we return what we have; errors[] will note the timeout
 *
 * @param {object} harness
 * @param {number} timeoutMs
 * @param {string} initialSceneCount - scene count before submission (may be null)
 * @returns {Promise<{ timedOut: boolean }>}
 */
async function waitForResponse(harness, timeoutMs, initialSceneCount) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    // Check for non-loading response element
    const hasResponse = await harness.evaluate(`
      !!document.querySelector(${JSON.stringify(RESPONSE_READY_SELECTOR)})
    `);
    if (hasResponse.ok && hasResponse.result) return { timedOut: false };

    // Check if window.__querySpec appeared
    const hasQuerySpec = await harness.evaluate(
      `typeof window.__querySpec !== 'undefined' && window.__querySpec !== null`
    );
    if (hasQuerySpec.ok && hasQuerySpec.result) return { timedOut: false };

    // Check if scene count changed (UI_COMMAND navigated)
    const currentScene = await harness.getSceneCount();
    if (
      currentScene.ok &&
      currentScene.result !== null &&
      currentScene.result !== initialSceneCount
    ) {
      return { timedOut: false };
    }

    await sleep(POLL_INTERVAL_MS);
  }

  return { timedOut: true };
}

// ---------------------------------------------------------------------------
// Core: captureQuerySpec
// ---------------------------------------------------------------------------

/**
 * Retrieve the QuerySpec from the page.
 *
 * Strategy (in order):
 *   1. window.__querySpec (set by app after intent classification)
 *   2. JSON text inside a <details> element matching QUERYSPEC_DETAILS_SELECTOR
 *   3. Fibre-tree search via harness.getQuerySpec()
 *
 * @param {object} harness
 * @returns {Promise<object|null>}
 */
async function captureQuerySpec(harness) {
  // Strategy 1: window global
  const fromGlobal = await harness.evaluate(
    `(typeof window.__querySpec !== 'undefined') ? JSON.parse(JSON.stringify(window.__querySpec)) : null`
  );
  if (fromGlobal.ok && fromGlobal.result !== null) return fromGlobal.result;

  // Strategy 2: <details> element text content
  const fromDetails = await harness.evaluate(`
    (function(){
      var detailsEl = document.querySelector(${JSON.stringify(QUERYSPEC_DETAILS_SELECTOR)});
      if (!detailsEl) return null;
      var pre = detailsEl.querySelector('pre, code');
      var text = pre ? pre.textContent : detailsEl.textContent;
      text = text.trim();
      // Strip leading summary text up to first '{'
      var start = text.indexOf('{');
      if (start === -1) return null;
      try { return JSON.parse(text.slice(start)); } catch(_) { return null; }
    })()
  `);
  if (fromDetails.ok && fromDetails.result !== null) return fromDetails.result;

  // Strategy 3: fibre-tree search
  const fromFibre = await harness.getQuerySpec();
  if (fromFibre.ok && fromFibre.result !== null) return fromFibre.result;

  return null;
}

// ---------------------------------------------------------------------------
// Core: captureSelectedNode
// ---------------------------------------------------------------------------

/**
 * Return the label of the currently selected graph node, or null.
 *
 * @param {object} harness
 * @returns {Promise<string|null>}
 */
async function captureSelectedNode(harness) {
  const fromTestId = await harness.evaluate(`
    (function(){
      var el = document.querySelector(${JSON.stringify(SELECTED_NODE_SELECTOR)});
      return el ? el.textContent.trim() : null;
    })()
  `);
  if (fromTestId.ok && fromTestId.result) return fromTestId.result;

  // Fallback: look for highlighted / selected class on graph nodes
  const fromClass = await harness.evaluate(`
    (function(){
      var el = document.querySelector(
        'g.nodes g.highlighted text, g.nodes g.active text, g.nodes .selected text'
      );
      return el ? el.textContent.trim() : null;
    })()
  `);
  if (fromClass.ok && fromClass.result) return fromClass.result;

  return null;
}

// ---------------------------------------------------------------------------
// Public API: evaluateInteraction
// ---------------------------------------------------------------------------

/**
 * Blind evaluator — grades a single command without seeing expected output.
 *
 * @param {string} command   - Natural-language command to evaluate
 * @param {object} harness   - Connected CDP harness (from createHarness())
 * @param {object} [opts]
 * @param {number}  [opts.responseTimeout=15000]  ms to wait for response
 * @param {string}  [opts.screenshotPrefix='eval'] prefix for screenshot filename
 * @param {boolean} [opts.isVoice=false]           true when command originates from voice input
 *
 * @returns {Promise<EvaluationResult>}
 *
 * @typedef {object} EvaluationResult
 * @property {string}       command           - The original command string
 * @property {object|null}  queryspec         - Captured QuerySpec IR (or null)
 * @property {object|null}  actual_queryspec  - Alias of queryspec (for grading-step compatibility)
 * @property {string|null}  scene_count       - Scene counter string e.g. "3/42 in scene"
 * @property {string|null}  selected_node     - Label of selected graph node (or null)
 * @property {string|null}  screenshot_path   - Absolute path to saved PNG (or null)
 * @property {boolean}      clarify_triggered - True if LLM asked for clarification
 * @property {boolean}      is_voice          - True if command came from voice input
 * @property {string[]}     errors            - Non-fatal errors collected during run
 */
async function evaluateInteraction(command, harness, opts = {}) {
  const {
    responseTimeout = DEFAULT_RESPONSE_TIMEOUT,
    screenshotPrefix = 'eval',
    isVoice = false,
  } = opts;

  const errors = [];

  // Snapshot runtime errors before interaction so we only report new ones
  const errorsBefore = harness.getRuntimeErrors().length;

  // ── 1. Capture initial scene count (baseline for change detection) ────────
  const initialScene = await harness.getSceneCount();
  const initialSceneCount = initialScene.ok ? initialScene.result : null;

  // ── 2. Type command + submit ──────────────────────────────────────────────
  const submitErrs = await submitCommand(harness, command);
  errors.push(...submitErrs);

  // If submission completely failed, still return a partial result
  if (submitErrs.length > 0 && submitErrs.some(e => e.startsWith('type into'))) {
    return {
      command,
      queryspec: null,
      scene_count: initialSceneCount,
      selected_node: null,
      screenshot_path: null,
      errors,
    };
  }

  // ── 3. Wait for response ──────────────────────────────────────────────────
  const { timedOut } = await waitForResponse(harness, responseTimeout, initialSceneCount);
  if (timedOut) {
    errors.push(`response timeout after ${responseTimeout}ms`);
  }

  // Brief settle time to let React finish any pending state updates
  await sleep(300);

  // ── 4. Capture QuerySpec ──────────────────────────────────────────────────
  let queryspec = null;
  try {
    queryspec = await captureQuerySpec(harness);
  } catch (e) {
    errors.push(`captureQuerySpec threw: ${e.message}`);
  }

  // ── 5. Capture scene count ────────────────────────────────────────────────
  let scene_count = null;
  try {
    const sc = await harness.getSceneCount();
    scene_count = sc.ok ? sc.result : null;
    if (!sc.ok) errors.push(`getSceneCount: ${sc.error}`);
  } catch (e) {
    errors.push(`getSceneCount threw: ${e.message}`);
  }

  // ── 6. Capture selected node label ────────────────────────────────────────
  let selected_node = null;
  try {
    selected_node = await captureSelectedNode(harness);
  } catch (e) {
    errors.push(`captureSelectedNode threw: ${e.message}`);
  }

  // ── 7. Screenshot ─────────────────────────────────────────────────────────
  let screenshot_path = null;
  try {
    const screenshotName = `${screenshotPrefix}-${slugify(command)}-${Date.now()}`;
    const ss = await harness.screenshot(screenshotName);
    if (ss.ok) {
      screenshot_path = ss.result.path;
    } else {
      errors.push(`screenshot: ${ss.error}`);
    }
  } catch (e) {
    errors.push(`screenshot threw: ${e.message}`);
  }

  // ── 8. Detect clarify_triggered ───────────────────────────────────────────
  let clarify_triggered = false;
  try {
    const responseText = await harness.evaluate(`
      (function(){
        var el = document.querySelector(
          '[data-testid="chat-response"]:last-child, .chat-message.assistant:last-child, .chat-response:last-child'
        );
        return el ? el.textContent.trim() : null;
      })()
    `);
    if (responseText.ok) {
      clarify_triggered = detectClarifyTriggered(responseText.result);
    }
  } catch (e) {
    errors.push(`clarify_triggered detection threw: ${e.message}`);
  }

  // ── 9. Collect any new runtime errors from the page ───────────────────────
  const allRuntimeErrors = harness.getRuntimeErrors();
  const newRuntimeErrors = allRuntimeErrors.slice(errorsBefore);
  for (const re of newRuntimeErrors) {
    errors.push(`runtime: ${re.description}`);
  }

  // ── 10. Return structured result (NO comparison against expected) ──────────
  return {
    command,
    queryspec,
    actual_queryspec: queryspec,   // grading-step alias — same value, different key
    scene_count,
    selected_node,
    screenshot_path,
    clarify_triggered,
    is_voice: isVoice,
    errors,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help')) {
    console.log([
      '',
      'Usage:',
      '  node evaluate-interaction.cjs --command <text> [options]',
      '',
      'Options:',
      '  --command   <text>    Natural-language command to evaluate (required)',
      '  --port      <number>  Chrome CDP port (default: 9252)',
      '  --route     <string>  Hash route, e.g. binary-explorer/droid (default: ' + DEFAULT_ROUTE + ')',
      '  --timeout   <ms>      Response wait timeout in ms (default: ' + DEFAULT_RESPONSE_TIMEOUT + ')',
      '  --prefix    <string>  Screenshot filename prefix (default: eval)',
      '  --voice               Mark command as originating from voice input (sets is_voice=true)',
      '  --dry-run             Skip CDP connection; emit mock result with zeroed fields (CI-safe)',
      '',
      'Output:',
      '  JSON to stdout: {',
      '    command, queryspec, actual_queryspec, scene_count,',
      '    selected_node, screenshot_path, clarify_triggered, is_voice, errors[]',
      '  }',
      '',
      'Benchmark targets:',
      '  Text commands : ' + TARGET_TEXT_COMMANDS,
      '  Voice commands: ' + TARGET_VOICE_COMMANDS,
      '',
      'Example:',
      '  node evaluate-interaction.cjs --command "show me all syscalls" --route binary-explorer/droid',
      '  node evaluate-interaction.cjs --command "open network graph" --voice',
      '  node evaluate-interaction.cjs --command "show syscalls" --dry-run',
      '',
    ].join('\n'));
    process.exit(0);
  }

  // Parse args
  const get = flag => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
  };
  const has = flag => args.includes(flag);

  const command  = get('--command');
  const isDryRun = has('--dry-run');
  const isVoice  = has('--voice');

  if (!command) {
    console.error('Error: --command is required');
    process.exit(1);
  }

  const port    = parseInt(get('--port')    || DEFAULT_PORT, 10);
  const route   = get('--route')   || DEFAULT_ROUTE;
  const timeout = parseInt(get('--timeout') || DEFAULT_RESPONSE_TIMEOUT, 10);
  const prefix  = get('--prefix')  || 'eval';

  // --dry-run: output a zeroed mock result without touching CDP (CI-safe)
  if (isDryRun) {
    const dryResult = {
      command,
      queryspec: null,
      actual_queryspec: null,
      scene_count: null,
      selected_node: null,
      screenshot_path: null,
      clarify_triggered: false,
      is_voice: isVoice,
      errors: [],
    };
    process.stdout.write(JSON.stringify(dryResult, null, 2) + '\n');
    process.exit(0);
  }

  let harness;
  try {
    harness = await createHarness({ port, route, baseUrl: DEFAULT_BASE_URL });
  } catch (e) {
    const result = {
      command,
      queryspec: null,
      actual_queryspec: null,
      scene_count: null,
      selected_node: null,
      screenshot_path: null,
      clarify_triggered: false,
      is_voice: isVoice,
      errors: [`createHarness failed: ${e.message}`],
    };
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(1);
  }

  let result;
  try {
    result = await evaluateInteraction(command, harness, {
      responseTimeout: timeout,
      screenshotPrefix: prefix,
      isVoice,
    });
  } finally {
    harness.close();
  }

  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(result.errors.length > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Exports + CLI guard
// ---------------------------------------------------------------------------

module.exports = {
  evaluateInteraction,
  detectClarifyTriggered,
  TARGET_TEXT_COMMANDS,
  TARGET_VOICE_COMMANDS,
};

if (require.main === module) {
  main().catch(e => {
    console.error('FATAL:', e.message);
    process.exit(1);
  });
}

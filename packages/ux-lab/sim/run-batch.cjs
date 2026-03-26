/**
 * run-batch.cjs — Batch interaction runner for Binary Explorer
 *
 * Orchestrates a full batch of 200 text + 50 voice commands against the
 * Binary Explorer via CDP (headless Chrome). Implements the /test-lab blind
 * evaluation pattern: captures actual results without grading.
 *
 * Pipeline per command:
 *   1. CLEAR scene (navigate to fresh route → React state reset)
 *   2. Seed namespaces (standard binary starting state)
 *   3. Type command into chat, submit
 *   4. Wait for response
 *   5. Capture QuerySpec, scene state, screenshot
 *   6. Check for 'Did you mean' clarify trigger
 *   7. Append result JSONL line
 *
 * Output JSONL schema:
 *   { command, expected, actual_queryspec, scene_count, clarify_triggered,
 *     screenshot_path, is_voice, errors[], ts_ms }
 *
 * Usage:
 *   node packages/ux-lab/sim/run-batch.cjs --binary droid --output /tmp/batch.jsonl
 *   node packages/ux-lab/sim/run-batch.cjs --dry-run --limit 3
 *   node packages/ux-lab/sim/run-batch.cjs --manifest commands.jsonl --limit 10
 *
 * Flags:
 *   --binary   <name>   Binary to test against (default: droid)
 *   --manifest <path>   JSONL manifest of commands (auto-generated if omitted)
 *   --output   <path>   Output JSONL path (default: /tmp/batch-results.jsonl)
 *   --limit    <n>      Max commands to run (default: unlimited)
 *   --port     <n>      Chrome CDP port (default: 9252)
 *   --base-url <url>    Vite dev server base URL (default: http://localhost:3001)
 *   --timeout  <ms>     Per-command response timeout (default: 15000)
 *   --dry-run           Simulate batch without connecting to Chrome
 *   --no-screenshots    Skip screenshot capture (faster)
 *   --help              Show usage
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_PORT          = 9252;
const DEFAULT_BASE_URL      = 'http://localhost:3001';
const DEFAULT_BINARY        = 'droid';
const DEFAULT_OUTPUT        = '/tmp/batch-results.jsonl';
const DEFAULT_TIMEOUT_MS    = 15000;
const DEFAULT_TEXT_TARGET   = 200;
const DEFAULT_VOICE_TARGET  = 50;
const SEED_SETTLE_MS        = 800;   // wait after seeding namespaces
const CLEAR_SETTLE_MS       = 400;   // wait after clearing scene
const BETWEEN_CMD_MS        = 200;   // brief pause between commands

// Selector for checking 'Did you mean' clarify trigger in chat
const CHAT_MESSAGES_SELECTOR = '.chat-message, [data-testid="chat-response"], .chat-response, .assistant-message';
const CHAT_INPUT_SELECTOR    = 'textarea[data-testid="chat-input"], textarea.chat-input, input[data-testid="chat-input"], input.chat-input, textarea';
const SUBMIT_SELECTOR        = 'button[data-testid="chat-submit"], button.chat-submit, button[type="submit"]';
const RESPONSE_READY_SEL     = '[data-testid="chat-response"]:not(.loading), .chat-message.assistant:last-child:not(.loading), .chat-response:not(.streaming)';
const POLL_MS                = 300;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const sleep = ms => new Promise(r => setTimeout(r, ms));

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const get = flag => {
    const i = args.indexOf(flag);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : null;
  };
  return {
    binary:       get('--binary')   || DEFAULT_BINARY,
    manifest:     get('--manifest') || null,
    output:       get('--output')   || DEFAULT_OUTPUT,
    limit:        get('--limit')    ? parseInt(get('--limit'), 10) : null,
    port:         parseInt(get('--port') || DEFAULT_PORT, 10),
    baseUrl:      get('--base-url') || DEFAULT_BASE_URL,
    timeout:      parseInt(get('--timeout') || DEFAULT_TIMEOUT_MS, 10),
    dryRun:       args.includes('--dry-run'),
    noScreenshots: args.includes('--no-screenshots'),
    help:         args.includes('--help') || args.includes('-h'),
  };
}

function showHelp() {
  console.log(`
run-batch.cjs — Batch interaction runner for Binary Explorer

Usage:
  node run-batch.cjs [options]

Options:
  --binary   <name>   Binary to test (default: ${DEFAULT_BINARY})
  --manifest <path>   JSONL manifest file (auto-generated if omitted)
  --output   <path>   Results output JSONL (default: ${DEFAULT_OUTPUT})
  --limit    <n>      Max commands to process
  --port     <n>      Chrome CDP port (default: ${DEFAULT_PORT})
  --base-url <url>    Dev server URL (default: ${DEFAULT_BASE_URL})
  --timeout  <ms>     Per-command response timeout (default: ${DEFAULT_TIMEOUT_MS})
  --dry-run           Simulate without connecting to Chrome
  --no-screenshots    Skip screenshot capture
  --help              Show this help

Output JSONL schema:
  { command, expected, actual_queryspec, scene_count,
    clarify_triggered, screenshot_path, is_voice, errors[], ts_ms }

Examples:
  node run-batch.cjs --dry-run --limit 3
  node run-batch.cjs --binary droid --output /tmp/droid-batch.jsonl
  node run-batch.cjs --manifest /tmp/commands.jsonl --limit 50
`);
}

// ---------------------------------------------------------------------------
// Built-in command manifest (used when no --manifest is provided)
// Covers 200 text + 50 voice interactions for the droid binary
// ---------------------------------------------------------------------------

const STATIC_FEATURES = {
  droid: [
    { _key: 'droid:session_notification', label: 'Session Notification', name: 'session_notification', node_type: 'rpc',          namespace: 'droid' },
    { _key: 'droid:request_permission',   label: 'Request Permission',   name: 'request_permission',   node_type: 'rpc',          namespace: 'droid' },
    { _key: 'droid:automation',           label: 'automation',           name: 'automation',           node_type: 'namespace',    namespace: 'automation' },
    { _key: 'droid:start_automation',     label: 'Start Automation',     name: 'start_automation',     node_type: 'rpc',          namespace: 'automation' },
    { _key: 'droid:automation_event',     label: 'Automation Event',     name: 'automation_event',     node_type: 'event',        namespace: 'automation' },
    { _key: 'droid:terminal',             label: 'terminal',             name: 'terminal',             node_type: 'namespace',    namespace: 'terminal' },
    { _key: 'droid:terminal_output',      label: 'Terminal Output',      name: 'terminal_output',      node_type: 'event',        namespace: 'terminal' },
    { _key: 'droid:AgentState',           label: 'Agent State',          name: 'AgentState',           node_type: 'state_machine', namespace: 'droid' },
    { _key: 'droid:SessionSchema',        label: 'Session Schema',       name: 'SessionSchema',        node_type: 'schema',       namespace: 'droid' },
    { _key: 'droid:run',                  label: 'run',                  name: 'run',                  node_type: 'cli_command',  namespace: 'droid' },
  ],
  daemon: [
    { _key: 'daemon:schedule_job',        label: 'Schedule Job',         name: 'schedule_job',         node_type: 'rpc',          namespace: 'daemon' },
    { _key: 'daemon:cancel_job',          label: 'Cancel Job',           name: 'cancel_job',           node_type: 'rpc',          namespace: 'daemon' },
    { _key: 'daemon:worker',              label: 'worker',               name: 'worker',               node_type: 'namespace',    namespace: 'worker' },
    { _key: 'daemon:worker_started',      label: 'Worker Started',       name: 'worker_started',       node_type: 'event',        namespace: 'worker' },
    { _key: 'daemon:JobState',            label: 'Job State',            name: 'JobState',             node_type: 'state_machine', namespace: 'daemon' },
    { _key: 'daemon:JobSchema',           label: 'Job Schema',           name: 'JobSchema',            node_type: 'schema',       namespace: 'daemon' },
    { _key: 'daemon:status',              label: 'status',               name: 'status',               node_type: 'cli_command',  namespace: 'daemon' },
  ],
};

const TEXT_TEMPLATES = [
  // SELECT_NODE variations
  (f) => [
    { command: `Please select the ${f.label} node in the graph.`,                    action: 'SELECT_NODE', difficulty: 'easy',   variation: 'formal' },
    { command: `click on ${f.name}`,                                                  action: 'SELECT_NODE', difficulty: 'medium', variation: 'casual' },
    { command: `Select ${f.label}`,                                                   action: 'SELECT_NODE', difficulty: 'easy',   variation: 'imperative' },
    { command: `Can you show me the ${f.label}?`,                                     action: 'SELECT_NODE', difficulty: 'easy',   variation: 'question' },
    { command: `I want see the ${f.name} please`,                                     action: 'SELECT_NODE', difficulty: 'medium', variation: 'non_native' },
    { command: `show me ${f.name.split('_')[0]}`,                                     action: 'SELECT_NODE', difficulty: 'hard',   variation: 'partial_name' },
    { command: `focus ${f.name.toUpperCase()}`,                                       action: 'SELECT_NODE', difficulty: 'medium', variation: 'wrong_case' },
    { command: `highlight the ${f.label} node`,                                       action: 'SELECT_NODE', difficulty: 'easy',   variation: 'synonym' },
  ],
  // VIEW_ALL variations
  () => [
    { command: 'Please reset the graph to show all nodes.',                           action: 'VIEW_ALL', difficulty: 'easy',   variation: 'formal' },
    { command: 'show everything',                                                      action: 'VIEW_ALL', difficulty: 'easy',   variation: 'casual' },
    { command: 'View all',                                                             action: 'VIEW_ALL', difficulty: 'easy',   variation: 'imperative' },
    { command: 'Can you zoom out to show all nodes?',                                  action: 'VIEW_ALL', difficulty: 'easy',   variation: 'question' },
    { command: 'show me all things in graph',                                          action: 'VIEW_ALL', difficulty: 'medium', variation: 'non_native' },
    { command: 'zoom out',                                                             action: 'VIEW_ALL', difficulty: 'medium', variation: 'abbreviated' },
    { command: 'reset view',                                                           action: 'VIEW_ALL', difficulty: 'easy',   variation: 'reset' },
    { command: 'show all nodes in binary explorer',                                    action: 'VIEW_ALL', difficulty: 'easy',   variation: 'verbose' },
  ],
  // FILTER_TYPE variations
  (f) => [
    { command: `Show only ${f.node_type} nodes`,                                      action: 'FILTER_TYPE', difficulty: 'easy',   variation: 'imperative' },
    { command: `filter by ${f.node_type}`,                                             action: 'FILTER_TYPE', difficulty: 'easy',   variation: 'casual' },
    { command: `Can you display just the ${f.node_type} nodes?`,                       action: 'FILTER_TYPE', difficulty: 'easy',   variation: 'question' },
    { command: `I only want to see ${f.node_type}s`,                                   action: 'FILTER_TYPE', difficulty: 'medium', variation: 'non_native' },
    { command: `hide everything except ${f.node_type}`,                                action: 'FILTER_TYPE', difficulty: 'medium', variation: 'negative' },
  ],
  // EXPAND_NAMESPACE variations
  (f) => [
    { command: `expand the ${f.namespace} namespace`,                                 action: 'EXPAND_NAMESPACE', difficulty: 'easy',   variation: 'formal' },
    { command: `open ${f.namespace}`,                                                  action: 'EXPAND_NAMESPACE', difficulty: 'easy',   variation: 'casual' },
    { command: `Show everything in ${f.namespace}`,                                    action: 'EXPAND_NAMESPACE', difficulty: 'easy',   variation: 'imperative' },
    { command: `drill into ${f.namespace}`,                                            action: 'EXPAND_NAMESPACE', difficulty: 'medium', variation: 'synonym' },
    { command: `load namespace ${f.namespace}`,                                        action: 'EXPAND_NAMESPACE', difficulty: 'easy',   variation: 'technical' },
  ],
  // CHANGE_PERSPECTIVE variations
  () => [
    { command: 'Switch to security perspective',                                       action: 'CHANGE_PERSPECTIVE', difficulty: 'easy',   variation: 'formal' },
    { command: 'security view please',                                                 action: 'CHANGE_PERSPECTIVE', difficulty: 'easy',   variation: 'casual' },
    { command: 'Can you switch to data flow perspective?',                              action: 'CHANGE_PERSPECTIVE', difficulty: 'easy',   variation: 'question' },
    { command: 'set layout to stratified',                                             action: 'CHANGE_LAYOUT',      difficulty: 'easy',   variation: 'imperative' },
    { command: 'use clustered layout',                                                 action: 'CHANGE_LAYOUT',      difficulty: 'easy',   variation: 'casual' },
    { command: 'organic layout',                                                       action: 'CHANGE_LAYOUT',      difficulty: 'easy',   variation: 'abbreviated' },
    { command: 'overview mode',                                                        action: 'CHANGE_PERSPECTIVE', difficulty: 'easy',   variation: 'abbreviated' },
    { command: 'switch to protocol view',                                              action: 'CHANGE_PERSPECTIVE', difficulty: 'easy',   variation: 'synonym' },
  ],
  // SEARCH variations
  (f) => [
    { command: `search for ${f.name}`,                                                action: 'SEARCH', difficulty: 'easy',   variation: 'imperative' },
    { command: `find ${f.label}`,                                                      action: 'SEARCH', difficulty: 'easy',   variation: 'casual' },
    { command: `Can you find the ${f.label} node?`,                                    action: 'SEARCH', difficulty: 'easy',   variation: 'question' },
    { command: `look up ${f.name}`,                                                    action: 'SEARCH', difficulty: 'easy',   variation: 'synonym' },
    { command: `where is ${f.label}`,                                                  action: 'SEARCH', difficulty: 'medium', variation: 'conversational' },
  ],
];

const VOICE_NOISE_PATTERNS = [
  s => s,                                                       // clean
  s => s.replace(/\b(\w+)\b/g, (w, _, i) => i === 0 ? w : w), // no change
  s => s.toLowerCase(),                                         // lowercase
  s => s.replace(/_/g, ' '),                                    // underscores→spaces
  s => s.replace(/please/gi, 'lease'),                          // dropped leading consonant
  s => s.replace(/the /gi, 'uh '),                              // filler word swap
  s => s.replace(/select/gi, 'sect'),                           // STT truncation
  s => s.replace(/show/gi, 'sho'),                              // STT error
  s => s.replace(/namespace/gi, 'name space'),                  // word split
  s => s.replace(/filter/gi, 'philter'),                        // homophone
];

/**
 * Build the command manifest for a given binary.
 * Returns an array of { command, expected_action, expected_target, difficulty,
 *                       variation, binary, is_voice }.
 *
 * @param {string} binary
 * @param {number|null} limit
 * @returns {Array<object>}
 */
function buildManifest(binary, limit) {
  const features = STATIC_FEATURES[binary] || STATIC_FEATURES[DEFAULT_BINARY];
  const commands = [];

  // ── Generate text commands ─────────────────────────────────────────────────
  for (const f of features) {
    for (const tmpl of TEXT_TEMPLATES) {
      const variants = tmpl(f);
      for (const v of variants) {
        if (commands.filter(c => !c.is_voice).length >= DEFAULT_TEXT_TARGET) break;
        commands.push({
          command:         v.command,
          expected_action: v.action,
          expected_target: f._key || null,
          difficulty:      v.difficulty,
          variation:       v.variation,
          binary,
          is_voice:        false,
        });
      }
    }
  }

  // Pad to 200 text commands with diverse single-word / short-form commands
  const padCommands = [
    { command: 'overview',        expected_action: 'VIEW_ALL',           difficulty: 'easy',   variation: 'minimal' },
    { command: 'reset',           expected_action: 'VIEW_ALL',           difficulty: 'easy',   variation: 'minimal' },
    { command: 'help',            expected_action: 'SHOW_HELP',          difficulty: 'easy',   variation: 'minimal' },
    { command: 'what is this?',   expected_action: 'EXPLAIN',            difficulty: 'easy',   variation: 'question' },
    { command: 'explain',         expected_action: 'EXPLAIN',            difficulty: 'easy',   variation: 'minimal' },
    { command: 'connections',     expected_action: 'SHOW_CONNECTIONS',   difficulty: 'easy',   variation: 'minimal' },
    { command: 'events only',     expected_action: 'FILTER_TYPE',        difficulty: 'medium', variation: 'abbreviated' },
    { command: 'RPCs',            expected_action: 'FILTER_TYPE',        difficulty: 'medium', variation: 'abbreviated' },
    { command: 'schemas',         expected_action: 'FILTER_TYPE',        difficulty: 'medium', variation: 'abbreviated' },
    { command: 'show state machines', expected_action: 'FILTER_TYPE',   difficulty: 'easy',   variation: 'imperative' },
    { command: 'go back',         expected_action: 'NAVIGATE_BACK',      difficulty: 'easy',   variation: 'conversational' },
    { command: 'undo',            expected_action: 'NAVIGATE_BACK',      difficulty: 'easy',   variation: 'minimal' },
    { command: 'zoom in',         expected_action: 'ZOOM_IN',            difficulty: 'easy',   variation: 'imperative' },
    { command: 'zoom out',        expected_action: 'ZOOM_OUT',           difficulty: 'easy',   variation: 'imperative' },
    { command: 'fit graph',       expected_action: 'FIT_GRAPH',          difficulty: 'easy',   variation: 'imperative' },
    { command: 'center graph',    expected_action: 'FIT_GRAPH',          difficulty: 'easy',   variation: 'synonym' },
    { command: 'highlight all connected nodes', expected_action: 'SELECT_CONNECTED', difficulty: 'medium', variation: 'verbose' },
    { command: 'what does this node do?', expected_action: 'EXPLAIN_NODE', difficulty: 'medium', variation: 'question' },
    { command: 'show me the AST', expected_action: 'SHOW_AST',           difficulty: 'easy',   variation: 'imperative' },
    { command: 'raw data',        expected_action: 'SHOW_RAW',           difficulty: 'easy',   variation: 'minimal' },
  ];
  while (commands.filter(c => !c.is_voice).length < DEFAULT_TEXT_TARGET) {
    const pad = padCommands[commands.filter(c => !c.is_voice).length % padCommands.length];
    commands.push({ ...pad, binary, is_voice: false, expected_target: null });
  }

  // ── Generate voice commands (STT-noisy versions of text commands) ──────────
  const textSample = commands.filter(c => !c.is_voice).slice(0, DEFAULT_VOICE_TARGET);
  for (let i = 0; i < DEFAULT_VOICE_TARGET; i++) {
    const src = textSample[i % textSample.length];
    const noiseFn = VOICE_NOISE_PATTERNS[i % VOICE_NOISE_PATTERNS.length];
    const voiceTranscript = noiseFn(src.command);
    commands.push({
      command:         voiceTranscript,
      original_text:   src.command,
      expected_action: src.expected_action,
      expected_target: src.expected_target || null,
      difficulty:      src.difficulty,
      variation:       `voice_${src.variation}`,
      binary,
      is_voice:        true,
      stt_confidence:  0.70 + Math.random() * 0.28, // simulated STT confidence
    });
  }

  // Apply limit
  if (limit !== null && limit > 0) {
    return commands.slice(0, limit);
  }
  return commands;
}

/**
 * Load a JSONL manifest from disk.
 * @param {string} filePath
 * @returns {Array<object>}
 */
function loadManifest(filePath) {
  const lines = fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  return lines.map((line, i) => {
    try { return JSON.parse(line); }
    catch (e) { throw new Error(`Manifest line ${i + 1} is invalid JSON: ${e.message}`); }
  });
}

// ---------------------------------------------------------------------------
// CDP scene management
// ---------------------------------------------------------------------------

/**
 * Clear the current scene by navigating to the binary-explorer route.
 * This resets React state fully (fresh mount).
 *
 * @param {object} harness   - CDP harness instance
 * @param {object} cdpSend   - Raw CDP send function
 * @param {string} route     - Route to navigate to
 * @param {string} baseUrl
 */
async function clearScene(harness, cdpSend, route, baseUrl) {
  const url = `${baseUrl}/#${route}`;
  await cdpSend('Page.navigate', { url });
  await sleep(CLEAR_SETTLE_MS);
  // Wait for React to re-hydrate
  try {
    await waitForHydration(harness);
  } catch (_) { /* tolerate if already hydrated */ }
}

/**
 * Simple hydration check — waits for body text to appear.
 * @param {object} harness
 */
async function waitForHydration(harness) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const r = await harness.evaluate(
      `(document.getElementById('root') || document.body).innerText.trim().length`
    );
    if (r.ok && typeof r.result === 'number' && r.result > 10) return;
    await sleep(200);
  }
}

/**
 * Seed the standard namespace set for the binary.
 * Calls the backend /api/v1/binary/{binary}/seed if available,
 * otherwise relies on the default route load (already done in clearScene).
 *
 * @param {object} harness
 * @param {string} binary
 * @param {string} baseUrl
 */
async function seedNamespaces(harness, binary, baseUrl) {
  // Attempt backend seed API
  const seedResult = await harness.evaluate(`
    (async function() {
      try {
        const r = await fetch(${JSON.stringify(baseUrl + '/api/v1/binary/' + binary + '/seed')}, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ binary: ${JSON.stringify(binary)} })
        });
        return r.ok ? 'seeded' : ('http_' + r.status);
      } catch(e) {
        return 'fetch_error:' + e.message;
      }
    })()
  `);

  // Regardless of seed API result, wait for the graph to stabilise
  await sleep(SEED_SETTLE_MS);
  return seedResult.ok ? seedResult.result : null;
}

// ---------------------------------------------------------------------------
// Interaction capture
// ---------------------------------------------------------------------------

/**
 * Submit a command in the chat and capture the response.
 *
 * @param {object} harness
 * @param {string} command
 * @param {number} timeoutMs
 * @returns {Promise<{
 *   actual_queryspec: object|null,
 *   scene_count: string|null,
 *   clarify_triggered: boolean,
 *   response_text: string|null,
 *   screenshot_path: string|null,
 *   errors: string[]
 * }>}
 */
async function captureInteraction(harness, command, timeoutMs, opts = {}) {
  const { noScreenshots = false, screenshotPrefix = 'batch' } = opts;
  const errors = [];

  // ── Get baseline scene count ──────────────────────────────────────────────
  const baselineScene = await harness.getSceneCount();
  const initialSceneCount = baselineScene.ok ? baselineScene.result : null;

  // ── Clear any previous __querySpec ───────────────────────────────────────
  await harness.evaluate('window.__querySpec = undefined;').catch(() => {});

  // ── Type command ──────────────────────────────────────────────────────────
  let typeOk = false;
  const typeResult = await harness.type(CHAT_INPUT_SELECTOR, command);
  if (typeResult.ok) {
    typeOk = true;
  } else {
    errors.push(`type(chat): ${typeResult.error}`);
    const fallback = await harness.type('textarea', command);
    if (fallback.ok) { typeOk = true; }
    else { errors.push(`type(fallback): ${fallback.error}`); }
  }

  if (!typeOk) {
    return {
      actual_queryspec: null, scene_count: initialSceneCount,
      clarify_triggered: false, response_text: null,
      screenshot_path: null, errors,
    };
  }

  // ── Submit ────────────────────────────────────────────────────────────────
  const clickResult = await harness.click(SUBMIT_SELECTOR);
  if (!clickResult.ok) {
    // Fallback: Enter keydown on input
    await harness.evaluate(`
      (function(){
        var el = document.querySelector(${JSON.stringify(CHAT_INPUT_SELECTOR)}) || document.querySelector('textarea');
        if (el) {
          el.dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', keyCode:13, bubbles:true }));
          el.dispatchEvent(new KeyboardEvent('keyup',   { key:'Enter', keyCode:13, bubbles:true }));
        }
      })()
    `);
  }

  // ── Wait for response ─────────────────────────────────────────────────────
  const deadline = Date.now() + timeoutMs;
  let responded = false;
  while (Date.now() < deadline && !responded) {
    const hasEl = await harness.evaluate(
      `!!document.querySelector(${JSON.stringify(RESPONSE_READY_SEL)})`
    );
    if (hasEl.ok && hasEl.result) { responded = true; break; }

    const hasSpec = await harness.evaluate(
      `typeof window.__querySpec !== 'undefined' && window.__querySpec !== null`
    );
    if (hasSpec.ok && hasSpec.result) { responded = true; break; }

    const cur = await harness.getSceneCount();
    if (cur.ok && cur.result !== null && cur.result !== initialSceneCount) {
      responded = true; break;
    }
    await sleep(POLL_MS);
  }
  if (!responded) errors.push(`response timeout after ${timeoutMs}ms`);

  // Brief settle for React state flush
  await sleep(300);

  // ── Capture QuerySpec ─────────────────────────────────────────────────────
  let actual_queryspec = null;
  try {
    // Strategy 1: window global
    const fromGlobal = await harness.evaluate(
      `(typeof window.__querySpec !== 'undefined') ? JSON.parse(JSON.stringify(window.__querySpec)) : null`
    );
    if (fromGlobal.ok && fromGlobal.result !== null) {
      actual_queryspec = fromGlobal.result;
    } else {
      // Strategy 2: details element
      const fromDetails = await harness.evaluate(`
        (function(){
          var d = document.querySelector('details[data-testid="queryspec-details"], details.queryspec-details, details');
          if (!d) return null;
          var pre = d.querySelector('pre, code');
          var text = (pre ? pre.textContent : d.textContent).trim();
          var start = text.indexOf('{');
          if (start === -1) return null;
          try { return JSON.parse(text.slice(start)); } catch(_) { return null; }
        })()
      `);
      if (fromDetails.ok && fromDetails.result !== null) {
        actual_queryspec = fromDetails.result;
      } else {
        // Strategy 3: harness fibre search
        const qs = await harness.getQuerySpec();
        if (qs.ok && qs.result !== null) actual_queryspec = qs.result;
      }
    }
  } catch (e) {
    errors.push(`captureQuerySpec: ${e.message}`);
  }

  // ── Capture scene count ───────────────────────────────────────────────────
  let scene_count = null;
  try {
    const sc = await harness.getSceneCount();
    scene_count = sc.ok ? sc.result : null;
    if (!sc.ok) errors.push(`getSceneCount: ${sc.error}`);
  } catch (e) {
    errors.push(`getSceneCount: ${e.message}`);
  }

  // ── Capture response text + clarify check ─────────────────────────────────
  let response_text = null;
  let clarify_triggered = false;
  try {
    const textResult = await harness.evaluate(`
      (function(){
        var msgs = document.querySelectorAll(${JSON.stringify(CHAT_MESSAGES_SELECTOR)});
        if (!msgs.length) return null;
        var last = msgs[msgs.length - 1];
        return last ? last.innerText || last.textContent || null : null;
      })()
    `);
    if (textResult.ok && textResult.result) {
      response_text = String(textResult.result).trim();
      clarify_triggered = /did you mean/i.test(response_text) ||
                          /clarif/i.test(response_text) ||
                          /did you want/i.test(response_text);
    }
  } catch (e) {
    errors.push(`captureResponseText: ${e.message}`);
  }

  // ── Screenshot ────────────────────────────────────────────────────────────
  let screenshot_path = null;
  if (!noScreenshots) {
    try {
      const name = `${screenshotPrefix}-${slugify(command)}-${Date.now()}`;
      const ss = await harness.screenshot(name);
      if (ss.ok) {
        screenshot_path = ss.result.path;
      } else {
        errors.push(`screenshot: ${ss.error}`);
      }
    } catch (e) {
      errors.push(`screenshot: ${e.message}`);
    }
  }

  // ── Collect runtime errors ────────────────────────────────────────────────
  const runtimeErrs = harness.getRuntimeErrors();
  for (const re of runtimeErrs) {
    errors.push(`runtime: ${re.description}`);
  }

  return { actual_queryspec, scene_count, clarify_triggered, response_text, screenshot_path, errors };
}

// ---------------------------------------------------------------------------
// DRY-RUN simulation
// ---------------------------------------------------------------------------

/**
 * Produce a simulated result without connecting to Chrome.
 * @param {object} cmd  - Command manifest entry
 * @param {number} idx
 * @returns {object}  - BatchResult
 */
function dryRunResult(cmd, idx) {
  return {
    index:             idx,
    command:           cmd.command,
    binary:            cmd.binary || DEFAULT_BINARY,
    is_voice:          cmd.is_voice || false,
    expected: {
      action: cmd.expected_action || null,
      target: cmd.expected_target || null,
    },
    actual_queryspec:  { action: cmd.expected_action, target: cmd.expected_target, _dry_run: true },
    scene_count:       '1/10 in scene',
    clarify_triggered: false,
    response_text:     '[dry-run] simulated response',
    screenshot_path:   null,
    errors:            [],
    ts_ms:             Date.now(),
    dry_run:           true,
  };
}

// ---------------------------------------------------------------------------
// Main batch runner
// ---------------------------------------------------------------------------

async function runBatch(opts) {
  const {
    binary, manifest: manifestPath, output, limit, port, baseUrl,
    timeout, dryRun, noScreenshots,
  } = opts;

  // Load or build manifest
  let commands;
  if (manifestPath) {
    console.error(`[run-batch] Loading manifest: ${manifestPath}`);
    commands = loadManifest(manifestPath);
    if (limit !== null) commands = commands.slice(0, limit);
  } else {
    console.error(`[run-batch] Building built-in manifest for binary="${binary}"`);
    commands = buildManifest(binary, limit);
  }

  const textCount  = commands.filter(c => !c.is_voice).length;
  const voiceCount = commands.filter(c =>  c.is_voice).length;
  console.error(`[run-batch] Commands: ${commands.length} total (${textCount} text, ${voiceCount} voice)`);

  // Prepare output file
  const outDir = path.dirname(output);
  if (outDir && outDir !== '.' && !fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const outStream = fs.createWriteStream(output, { flags: 'w' });
  const appendResult = (obj) => outStream.write(JSON.stringify(obj) + '\n');

  // ── DRY-RUN path ──────────────────────────────────────────────────────────
  if (dryRun) {
    console.error('[run-batch] DRY-RUN mode — no Chrome connection');
    const summary = { passed: 0, total: commands.length, errors: 0 };
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      const result = dryRunResult(cmd, i);
      appendResult(result);
      summary.passed++;
      if (i < 5 || commands.length <= 10) {
        console.error(`  [${i + 1}/${commands.length}] ${cmd.is_voice ? '🎤' : '💬'} ${cmd.command.slice(0, 60)}`);
      }
    }
    outStream.end();
    await new Promise(r => outStream.on('finish', r));
    console.error(`[run-batch] DRY-RUN complete → ${output}`);
    console.log(JSON.stringify({ status: 'ok', dry_run: true, ...summary, output }));
    return 0;
  }

  // ── LIVE path — connect to Chrome ─────────────────────────────────────────
  const { createHarness } = require('./cdp-harness.cjs');
  const route = `binary-explorer/${binary}`;

  console.error(`[run-batch] Connecting to CDP on port ${port}…`);
  let harness;
  try {
    harness = await createHarness({ port, route, baseUrl });
  } catch (e) {
    console.error(`[run-batch] FATAL: Cannot connect to Chrome: ${e.message}`);
    console.error(`  Ensure Chrome is running:  chromium --headless=new --remote-debugging-port=${port} --no-sandbox`);
    outStream.end();
    return 1;
  }

  // Expose raw CDP send for clearScene
  const cdpSend = harness._send;

  const summary = { passed: 0, failed: 0, clarify_count: 0, total: commands.length };

  try {
    for (let i = 0; i < commands.length; i++) {
      const cmd = commands[i];
      const label = `[${i + 1}/${commands.length}]`;
      const icon  = cmd.is_voice ? '🎤' : '💬';
      console.error(`${label} ${icon} ${cmd.command.slice(0, 70)}`);

      // ── a. Clear scene ─────────────────────────────────────────────────
      try {
        await clearScene(harness, cdpSend, route, baseUrl);
      } catch (e) {
        console.error(`  ⚠ clearScene: ${e.message}`);
      }

      // ── b. Seed namespaces ─────────────────────────────────────────────
      try {
        await seedNamespaces(harness, binary, baseUrl);
      } catch (e) {
        console.error(`  ⚠ seedNamespaces: ${e.message}`);
      }

      // ── c-f. Submit + capture ──────────────────────────────────────────
      let interaction;
      try {
        interaction = await captureInteraction(harness, cmd.command, timeout, {
          noScreenshots,
          screenshotPrefix: `batch-${binary}-${i}`,
        });
      } catch (e) {
        interaction = {
          actual_queryspec: null, scene_count: null,
          clarify_triggered: false, response_text: null,
          screenshot_path: null, errors: [`captureInteraction threw: ${e.message}`],
        };
      }

      // ── g. Write result ────────────────────────────────────────────────
      const result = {
        index:   i,
        command: cmd.command,
        binary:  cmd.binary || binary,
        is_voice: cmd.is_voice || false,
        expected: {
          action: cmd.expected_action || null,
          target: cmd.expected_target || null,
        },
        actual_queryspec:  interaction.actual_queryspec,
        scene_count:       interaction.scene_count,
        clarify_triggered: interaction.clarify_triggered,
        response_text:     interaction.response_text,
        screenshot_path:   interaction.screenshot_path,
        errors:            interaction.errors,
        ts_ms:             Date.now(),
      };

      appendResult(result);

      if (interaction.errors.length === 0) {
        summary.passed++;
        console.error(`  ✓ queryspec=${JSON.stringify(result.actual_queryspec?.action || null)} scene=${result.scene_count}`);
      } else {
        summary.failed++;
        console.error(`  ✗ errors: ${interaction.errors.slice(0, 2).join('; ')}`);
      }
      if (interaction.clarify_triggered) {
        summary.clarify_count++;
        console.error(`  💡 clarify triggered`);
      }

      await sleep(BETWEEN_CMD_MS);
    }
  } finally {
    harness.close();
    outStream.end();
    await new Promise(r => outStream.on('finish', r));
  }

  const percent = summary.total > 0
    ? Math.round((summary.passed / summary.total) * 100)
    : 0;

  console.error(`\n[run-batch] Done: ${summary.passed}/${summary.total} ok (${percent}%), ${summary.clarify_count} clarify → ${output}`);
  console.log(JSON.stringify({ status: 'ok', ...summary, percent_ok: percent, output }));
  return summary.failed > 0 ? 1 : 0;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const opts = parseArgs(process.argv);

  if (opts.help) {
    showHelp();
    process.exit(0);
  }

  const code = await runBatch(opts);
  process.exit(code);
}

// ---------------------------------------------------------------------------
// Exports + CLI guard
// ---------------------------------------------------------------------------

module.exports = { runBatch, buildManifest, dryRunResult };

if (require.main === module) {
  main().catch(e => {
    console.error('FATAL:', e.message);
    process.exit(1);
  });
}

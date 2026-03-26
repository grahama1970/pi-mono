// server/test-runner.ts — CDP-based (no Puppeteer)
import { Express } from 'express';
import { readFileSync, mkdirSync, existsSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { request as httpRequest } from 'http';

const CDP_PORT = Number(process.env.CDP_PORT || 9252);
const CDP_HEADLESS_PORT = 9253; // Port for our own headless Chrome when user's Chrome lacks CDP

/** Lightweight CDP client — connects to existing Chrome via DevTools Protocol */
class CDPClient {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private handlers = new Map<number, (msg: any) => void>();

  private childProcess: any = null;

  async connect(): Promise<void> {
    let pages: any[] | undefined;
    let port = CDP_PORT;

    // Try user's Chrome first
    try {
      pages = await this._getPages(CDP_PORT);
      console.log(`[CDP] Connected to user Chrome on port ${CDP_PORT}`);
    } catch {
      // Launch headless fallback
      console.log(`[CDP] User Chrome not on port ${CDP_PORT}, launching headless on ${CDP_HEADLESS_PORT}...`);
      await this._launchHeadless();
      port = CDP_HEADLESS_PORT;
      for (let i = 0; i < 15; i++) {
        try { pages = await this._getPages(CDP_HEADLESS_PORT); break; } catch { await new Promise(r => setTimeout(r, 1000)); }
      }
    }
    if (!pages || pages.length === 0) throw new Error(`No CDP pages found on port ${port}`);

    // Find a page with our UX Lab URL, or use the first page
    const target = pages.find((p: any) => p.url?.includes('localhost:5173') || p.url?.includes('localhost:3001') || p.url?.includes('localhost:3002'))
      || pages.find((p: any) => p.type === 'page' && !p.url?.includes('devtools'))
      || pages[0];

    if (!target?.webSocketDebuggerUrl) throw new Error(`No CDP target found on port ${port}`);

    this.ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      this.ws!.on('open', resolve);
      this.ws!.on('error', reject);
      setTimeout(() => reject(new Error('CDP WebSocket timeout')), 5000);
    });

    this.ws.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString());
      if (msg.id && this.handlers.has(msg.id)) {
        this.handlers.get(msg.id)!(msg);
        this.handlers.delete(msg.id);
      }
    });

    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }

  async send(method: string, params: Record<string, unknown> = {}): Promise<any> {
    if (!this.ws) throw new Error('CDP not connected');
    const id = ++this.msgId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.handlers.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
      this.handlers.set(id, (msg) => { clearTimeout(timeout); resolve(msg); });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression: string): Promise<any> {
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) {
      throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || 'Eval error');
    }
    return r.result?.result?.value;
  }

  async navigate(url: string): Promise<void> {
    await this.send('Page.navigate', { url });
    // Wait for load
    await new Promise(r => setTimeout(r, 2000));
  }

  async screenshot(path: string): Promise<void> {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(path, Buffer.from(r.result.data, 'base64'));
  }

  close(): void {
    if (this.ws) { this.ws.close(); this.ws = null; }
    this.handlers.clear();
    if (this.childProcess) {
      try { this.childProcess.kill(); } catch {}
      this.childProcess = null;
    }
  }

  private async _getPages(port: number): Promise<any[]> {
    return new Promise((resolve, reject) => {
      httpRequest(`http://localhost:${port}/json`, (res) => {
        let data = '';
        res.on('data', (c: string) => data += c);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { reject(new Error('Bad JSON')); }
        });
      }).on('error', reject).end();
    });
  }

  private async _launchHeadless(): Promise<void> {
    const { spawn } = await import('child_process');
    this.childProcess = spawn('/usr/bin/google-chrome-stable', [
      '--headless=new', '--no-sandbox', '--disable-gpu',
      '--remote-debugging-port=' + CDP_HEADLESS_PORT,
      '--window-size=1920,1080',
      'about:blank',
    ], { stdio: 'ignore', detached: false });
  }
}

interface TestStep {
  action: string;
  selector?: string;
  text?: string;
  dx?: number;
  dy?: number;
  ms?: number;
  name?: string;
  type?: string;
  property?: string;
  operator?: string;
  value?: any;
  script?: string;
  hash?: string;
  url?: string;
  attr?: string;
  minDx?: number;
  minDy?: number;
  // Persona review fields
  persona?: string;       // persona slug (e.g. 'tim-blazytko')
  persona_scope?: string; // memory scope for persona QRAs
  review_criteria?: string; // what the persona should evaluate
  // Fix-forward mode fields
  on_fail?: 'skip' | 'stop' | 'fix';
  fix_scope?: string[];  // files the fixer is allowed to edit
  max_retries?: number;  // default 3
}

interface FixAttempt {
  attempt: number;
  error: string;
  screenshot?: string;
  diagnosis?: string;
  diff?: string;
  result: 'fixed' | 'still_failing' | 'escalated';
}

interface FixLog {
  stepName: string;
  totalAttempts: number;
  resolved: boolean;
  attempts: FixAttempt[];
}

interface TestDefinition {
  id: string;
  group: string;
  label: string;
  steps: TestStep[];
}

interface RunResult {
  runId: string;
  mode: 'standard' | 'fix-forward';
  status: 'RUNNING' | 'PASSED' | 'FAILED' | 'ABORTED';
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  results: any[];
  fixLog: FixLog[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    fixed: number;
  };
}

const RESULTS_DIR = resolve(process.cwd(), 'test-results');
const MANIFEST_PATH = resolve(process.cwd(), 'test-manifest.json');

// In-memory store for results (persisted to disk optionally)
const runHistory = new Map<string, RunResult>();
let activeCDP: CDPClient | null = null;
let activeRunId: string | null = null;

function scanTestIds(dir: string): string[] {
  const ids = new Set<string>();
  const pattern = /data-testid[={"']+([^"'}]+)/g;
  function walk(d: string) {
    try {
      for (const f of readdirSync(d)) {
        const fp = join(d, f);
        if (statSync(fp).isDirectory() && !f.startsWith('.') && f !== 'node_modules') walk(fp);
        else if (f.endsWith('.tsx') || f.endsWith('.ts')) {
          const content = readFileSync(fp, 'utf-8');
          let m;
          while ((m = pattern.exec(content)) !== null) {
            const val = m[1].replace(/\$\{.*?\}/g, '*'); // template literals → wildcard
            ids.add(val);
          }
          pattern.lastIndex = 0;
        }
      }
    } catch (_) {}
  }
  walk(dir);
  return [...ids].sort();
}

export function registerTestRunnerRoutes(app: Express, broadcast: (msg: any) => void) {

  // Ensure results directory exists
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });

  app.get('/api/test-runner/coverage', (req, res) => {
    try {
      const srcDir = resolve(process.cwd(), 'src');
      const allTestIds = scanTestIds(srcDir);
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
      const testedSelectors = new Set<string>();
      for (const test of manifest.tests) {
        for (const step of test.steps) {
          if (step.selector) {
            const match = step.selector.match(/data-testid[='"]*([^'"\]]+)/);
            if (match) testedSelectors.add(match[1]);
          }
        }
      }
      const untested = allTestIds.filter(id => !testedSelectors.has(id) && !testedSelectors.has(id.replace('*', '')));
      res.json({ total: allTestIds.length, tested: testedSelectors.size, untested, allTestIds });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // List available test manifests
  app.get('/api/test-runner/manifests', (_req, res) => {
    try {
      const cwd = process.cwd();
      const files = readdirSync(cwd).filter(f => f.endsWith('.test.json') || f === 'test-manifest.json');
      const manifests = files.map(f => {
        try {
          const data = JSON.parse(readFileSync(resolve(cwd, f), 'utf-8'));
          const tests = data.tests || [];
          const groups = [...new Set(tests.map((t: any) => t.group))] as string[];
          return { name: f.replace('.test.json', '').replace('test-manifest', 'all'), file: f, testCount: tests.length, groups };
        } catch { return { name: f, file: f, testCount: 0, groups: [] }; }
      });
      res.json({ manifests });
    } catch (e) {
      res.json({ manifests: [] });
    }
  });

  // Manifest CRUD operations
  app.post('/api/test-runner/manifests/:file/rename', (req, res) => {
    try {
      const oldFile = resolve(process.cwd(), req.params.file.replace(/[^a-zA-Z0-9._-]/g, ''));
      const newFile = resolve(process.cwd(), (req.body.newName || '').replace(/[^a-zA-Z0-9._-]/g, ''));
      if (!existsSync(oldFile)) return res.status(404).json({ error: 'NOT_FOUND' });
      const { renameSync } = require('fs');
      renameSync(oldFile, newFile);
      res.json({ status: 'RENAMED', from: req.params.file, to: req.body.newName });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/test-runner/manifests/:file/duplicate', (req, res) => {
    try {
      const srcFile = resolve(process.cwd(), req.params.file.replace(/[^a-zA-Z0-9._-]/g, ''));
      const dstFile = resolve(process.cwd(), (req.body.newName || '').replace(/[^a-zA-Z0-9._-]/g, ''));
      if (!existsSync(srcFile)) return res.status(404).json({ error: 'NOT_FOUND' });
      const { copyFileSync } = require('fs');
      copyFileSync(srcFile, dstFile);
      res.json({ status: 'DUPLICATED', to: req.body.newName });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/test-runner/manifests/:file', (req, res) => {
    try {
      const file = resolve(process.cwd(), req.params.file.replace(/[^a-zA-Z0-9._-]/g, ''));
      if (!existsSync(file)) return res.status(404).json({ error: 'NOT_FOUND' });
      if (req.params.file === 'test-manifest.json') return res.status(400).json({ error: 'CANNOT_DELETE_DEFAULT' });
      const { unlinkSync } = require('fs');
      unlinkSync(file);
      res.json({ status: 'DELETED' });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/test-runner/manifest', (req, res) => {
    try {
      const file = (req.query.file as string) || 'test-manifest.json';
      // Sanitize — only allow .json files in cwd
      const safeName = file.replace(/[^a-zA-Z0-9._-]/g, '');
      const filePath = resolve(process.cwd(), safeName);
      const manifest = JSON.parse(readFileSync(filePath, 'utf-8'));
      res.json(manifest);
    } catch (e) {
      res.status(500).json({ error: 'FAILED_TO_READ_MANIFEST' });
    }
  });

  app.post('/api/test-runner/run', async (req, res) => {
    const { tests: requestedTests, group, headless: headlessParam, file } = req.body;
    // headless: true (default) = no visible browser, false = human watches agent work
    const headlessMode = headlessParam !== false;
    // Load specific manifest file or default
    const manifestFile = file ? resolve(process.cwd(), file.replace(/[^a-zA-Z0-9._-]/g, '')) : MANIFEST_PATH;
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf-8'));

    let testsToRun: TestDefinition[] = manifest.tests;
    if (group) testsToRun = testsToRun.filter(t => t.group === group);
    if (requestedTests) testsToRun = testsToRun.filter(t => requestedTests.includes(t.id));

    const runId = randomUUID();
    const runDir = join(RESULTS_DIR, runId);
    mkdirSync(join(runDir, 'screenshots'), { recursive: true });

    const runResult: RunResult = {
      runId,
      mode: 'standard',
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      results: [],
      fixLog: [],
      summary: { total: testsToRun.length, passed: 0, failed: 0, skipped: 0, fixed: 0 }
    };

    runHistory.set(runId, runResult);
    res.json({ runId, totalTests: testsToRun.length, status: 'RUNNING' });

    // Start background execution — pass headless mode
    executeTestRun(runId, testsToRun, manifest.baseUrl, broadcast, headlessMode);
  });

  app.get('/api/test-runner/results/:runId', (req, res) => {
    const result = runHistory.get(req.params.runId);
    if (!result) return res.status(404).json({ error: 'RUN_NOT_FOUND' });
    res.json(result);
  });

  // Manifest CRUD
  app.put('/api/test-runner/manifest', (req, res) => {
    try {
      writeFileSync(MANIFEST_PATH, JSON.stringify(req.body, null, 2));
      res.json({ status: 'SAVED', tests: req.body.tests?.length || 0 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/test-runner/manifest/test', (req, res) => {
    try {
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
      const newTest = req.body;
      if (!newTest.id || !newTest.steps) return res.status(400).json({ error: 'Missing id or steps' });
      manifest.tests = manifest.tests.filter((t: any) => t.id !== newTest.id);
      manifest.tests.push(newTest);
      writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
      res.json({ status: 'ADDED', testId: newTest.id, total: manifest.tests.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete('/api/test-runner/manifest/test/:id', (req, res) => {
    try {
      const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));
      const before = manifest.tests.length;
      manifest.tests = manifest.tests.filter((t: any) => t.id !== req.params.id);
      writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
      res.json({ status: 'DELETED', testId: req.params.id, removed: before - manifest.tests.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/test-runner/abort', async (req, res) => {
    if (activeCDP) {
      activeCDP.close();
      activeCDP = null;
      if (activeRunId) {
        const run = runHistory.get(activeRunId);
        if (run) run.status = 'ABORTED';
      }
      res.json({ status: 'ABORTED' });
    } else {
      res.status(400).json({ error: 'NO_ACTIVE_RUN' });
    }
  });

  // ── Fix-Forward Mode ──────────────────────────────────────────────
  // When a step fails, dispatches to /subagent-service (Codex) to fix the bug,
  // then retries the step. Escalates to human after max_retries.
  app.post('/api/test-runner/run-fix-forward', async (req, res) => {
    const { tests: requestedTests, group, headless: headlessParam, fixBackend } = req.body;
    const headlessMode = headlessParam !== false;
    const backend = fixBackend || 'codex'; // codex | claude | gemini
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf-8'));

    let testsToRun: TestDefinition[] = manifest.tests;
    if (group) testsToRun = testsToRun.filter(t => t.group === group);
    if (requestedTests) testsToRun = testsToRun.filter(t => requestedTests.includes(t.id));

    const runId = randomUUID();
    const runDir = join(RESULTS_DIR, runId);
    mkdirSync(join(runDir, 'screenshots'), { recursive: true });
    mkdirSync(join(runDir, 'fixes'), { recursive: true });

    const runResult: RunResult = {
      runId,
      mode: 'fix-forward',
      status: 'RUNNING',
      startedAt: new Date().toISOString(),
      results: [],
      fixLog: [],
      summary: { total: testsToRun.length, passed: 0, failed: 0, skipped: 0, fixed: 0 }
    };

    runHistory.set(runId, runResult);
    res.json({ runId, totalTests: testsToRun.length, status: 'RUNNING', mode: 'fix-forward', backend });

    // Execute with fix-forward loop
    executeFixForwardRun(runId, testsToRun, manifest.baseUrl, broadcast, headlessMode, backend);
  });

  // Serve screenshots
  app.get('/test-results/:runId/screenshots/:name', (req, res) => {
    const filePath = join(RESULTS_DIR, req.params.runId, 'screenshots', req.params.name);
    if (existsSync(filePath)) res.sendFile(filePath);
    else res.status(404).send('Not found');
  });
}

async function executeTestRun(runId: string, tests: TestDefinition[], baseUrl: string, broadcast: (msg: any) => void, headless: boolean = true) {
  activeRunId = runId;
  const startTs = Date.now();

  broadcast({ type: 'test-run-start', payload: { runId, totalTests: tests.length, headless } });

  try {
    // Connect to existing Chrome via CDP — no Puppeteer, no new browser launch
    activeCDP = new CDPClient();
    await activeCDP.connect();
    console.log(`[TEST_RUNNER] CDP connected`);

    for (const test of tests) {
      if (!activeCDP) break; // Aborted

      const testStart = Date.now();
      const testResult = { testId: test.id, status: 'RUNNING', steps: [] as any[], durationMs: 0 };

      broadcast({ type: 'test-step', payload: { runId, testId: test.id, action: 'START', status: 'RUNNING' } });

      try {
        for (const step of test.steps) {
          const stepResult = await executeStep(activeCDP!, step, runId);
          testResult.steps.push({ ...step, ...stepResult });
          
          broadcast({
            type: 'test-step',
            payload: {
              runId,
              testId: test.id,
              step: step.action,
              selector: step.selector,
              url: step.url,
              hash: step.hash,
              status: stepResult.status,
              detail: stepResult.detail,
              expected: (stepResult as any).expected,
              actual: (stepResult as any).actual,
              screenshotUrl: stepResult.screenshotUrl
            }
          });

          if (stepResult.status === 'FAILED') throw new Error(stepResult.detail);
        }

        testResult.status = 'PASSED';
      } catch (err: any) {
        testResult.status = 'FAILED';
      } finally {
        testResult.durationMs = Date.now() - testStart;
        const run = runHistory.get(runId)!;
        run.results.push(testResult);
        if (testResult.status === 'PASSED') run.summary.passed++;
        else run.summary.failed++;

        broadcast({ type: 'test-result', payload: { runId, testId: test.id, status: testResult.status, durationMs: testResult.durationMs } });

        // CDP uses existing tab — no page close needed
      }
    }
  } catch (err) {
    console.error('[TEST_RUNNER] Critical failure:', err);
  } finally {
    if (activeCDP) {
      activeCDP.close();
      activeCDP = null;
    }
    
    const run = runHistory.get(runId)!;
    run.status = run.summary.failed > 0 ? 'FAILED' : 'PASSED';
    run.completedAt = new Date().toISOString();
    run.durationMs = Date.now() - startTs;
    
    broadcast({ type: 'test-run-done', payload: { runId, status: run.status, summary: run.summary, durationMs: run.durationMs } });
    activeRunId = null;
  }
}

async function executeStep(cdp: CDPClient, step: TestStep, runId: string): Promise<{ status: 'PASSED' | 'FAILED', detail?: string, screenshotUrl?: string }> {
  try {
    switch (step.action) {
      case 'click': {
        await cdp.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(step.selector)}); if (!el) throw new Error('Not found: ${step.selector}'); el.click(); return 'clicked'; })()`);
        return { status: 'PASSED', actual: `Clicked ${step.selector}` };
      }

      case 'rightclick': {
        await cdp.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(step.selector)}); if (!el) throw new Error('Not found'); const rect = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: rect.left+10, clientY: rect.top+10 })); return 'right-clicked'; })()`);
        break;
      }

      case 'type': {
        await cdp.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(step.selector)}); if (!el) throw new Error('Not found'); const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; nativeSetter.call(el, ${JSON.stringify(step.text)}); el.dispatchEvent(new Event('input', { bubbles: true })); return 'typed'; })()`);
        return { status: 'PASSED', actual: `Typed "${step.text}" into ${step.selector}` };
      }

      case 'clear': {
        await cdp.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(step.selector)}); if (!el) throw new Error('Not found'); const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set; nativeSetter.call(el, ''); el.dispatchEvent(new Event('input', { bubbles: true })); return 'cleared'; })()`);
        return { status: 'PASSED', actual: `Cleared ${step.selector}` };
      }

      case 'wait':
        await new Promise(r => setTimeout(r, step.ms || 1000));
        return { status: 'PASSED', actual: `Waited ${step.ms || 1000}ms` };

      case 'navigate':
        if (step.url) await cdp.navigate(step.url);
        if (step.hash) await cdp.evaluate(`window.location.hash = ${JSON.stringify(step.hash)}`);
        return { status: 'PASSED', actual: `Navigated to ${step.url || '#' + step.hash}` };

      case 'screenshot': {
        const screenshotPath = `screenshots/${step.name}_${Date.now()}.png`;
        const fullPath = join(RESULTS_DIR, runId, screenshotPath);
        mkdirSync(join(RESULTS_DIR, runId, 'screenshots'), { recursive: true });
        await cdp.screenshot(fullPath);
        return { status: 'PASSED', screenshotUrl: `/test-results/${runId}/${screenshotPath}` };
      }

      case 'drag': {
        await cdp.evaluate(`(() => { const el = document.querySelector(${JSON.stringify(step.selector)}); if (!el) throw new Error('Not found'); const rect = el.getBoundingClientRect(); const cx = rect.left + rect.width/2; const cy = rect.top + rect.height/2; el.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, clientX:cx, clientY:cy })); el.dispatchEvent(new MouseEvent('mousemove', { bubbles:true, clientX:cx+${step.dx||0}, clientY:cy+${step.dy||0} })); el.dispatchEvent(new MouseEvent('mouseup', { bubbles:true, clientX:cx+${step.dx||0}, clientY:cy+${step.dy||0} })); return 'dragged'; })()`);
        break;
      }

      case 'evaluate': {
        const result = await cdp.evaluate(step.script!);
        return { status: 'PASSED', actual: String(result ?? 'undefined') };
      }

      case 'assert': {
        // Returns { pass: boolean, expected: string, actual: string }
        const assertScript = `
          (function() {
            var a = ${JSON.stringify({ type: step.type, selector: step.selector, text: step.text, property: step.property, operator: step.operator, value: step.value })};
            var el = a.selector ? document.querySelector(a.selector) : null;
            function cmp(actual, op, expected) {
              if (op === 'eq') return actual == expected;
              if (op === 'gt') return actual > expected;
              if (op === 'lt') return actual < expected;
              if (op === 'gte') return actual >= expected;
              if (op === 'lte') return actual <= expected;
              if (op === 'contains') return String(actual).includes(expected);
              return false;
            }
            if (a.type === 'exists') {
              return { pass: !!el, expected: 'element exists', actual: el ? 'found' : 'not found' };
            }
            if (a.type === 'not_exists') {
              return { pass: !el, expected: 'element absent', actual: el ? 'found (unexpected)' : 'absent' };
            }
            if (a.type === 'visible') {
              var vis = el ? (el.offsetWidth > 0 && el.offsetHeight > 0) : false;
              return { pass: vis, expected: 'visible', actual: vis ? 'visible' : (el ? 'hidden/zero-size' : 'not found') };
            }
            if (a.type === 'text_contains') {
              var text = (el ? el.innerText : '') || document.body.innerText;
              var found = text.includes(a.text);
              var snippet = text.substring(0, 120).replace(/\\n/g, ' ');
              return { pass: found, expected: 'contains "' + a.text + '"', actual: found ? 'found in text' : 'not found. Text: "' + snippet + '..."' };
            }
            if (a.type === 'count') {
              var count = document.querySelectorAll(a.selector).length;
              var ok = cmp(count, a.operator, a.value);
              return { pass: ok, expected: 'count ' + a.operator + ' ' + a.value, actual: 'count: ' + count };
            }
            if (a.type === 'style') {
              if (!el) return { pass: false, expected: a.property + ' ' + a.operator + ' ' + a.value, actual: 'element not found' };
              var val = parseFloat(window.getComputedStyle(el)[a.property]);
              var ok2 = cmp(val, a.operator, a.value);
              return { pass: ok2, expected: a.property + ' ' + a.operator + ' ' + a.value, actual: a.property + ': ' + val + 'px' };
            }
            if (a.type === 'moved') return { pass: true, expected: 'element moved', actual: 'moved' };
            return { pass: false, expected: 'unknown assert type', actual: a.type };
          })()
        `;
        const result = await cdp.evaluate(assertScript) as { pass: boolean; expected: string; actual: string };
        // Auto-screenshot on assert
        const assertScreenPath = `screenshots/assert_${step.type}_${Date.now()}.png`;
        try {
          mkdirSync(join(RESULTS_DIR, runId, 'screenshots'), { recursive: true });
          await cdp.screenshot(join(RESULTS_DIR, runId, assertScreenPath));
        } catch (_) { /* screenshot optional */ }
        if (!result.pass) {
          return {
            status: 'FAILED',
            detail: `Assertion failed: ${step.type} on ${step.selector || 'page'}`,
            expected: result.expected,
            actual: result.actual,
            screenshotUrl: `/test-results/${runId}/${assertScreenPath}`,
          };
        }
        return {
          status: 'PASSED',
          expected: result.expected,
          actual: result.actual,
          screenshotUrl: `/test-results/${runId}/${assertScreenPath}`,
        };
      }
      case 'visual_assert': {
        // Take screenshot → send to Gemini VLM → pass/fail based on visual assessment
        const vsScreenPath = `screenshots/visual_${step.name || 'check'}_${Date.now()}.png`;
        const vsFullPath = join(RESULTS_DIR, runId, vsScreenPath);
        await cdp.screenshot(vsFullPath);

        // Read screenshot as base64
        const imgBase64 = readFileSync(vsFullPath).toString('base64');

        // Build VLM prompt from step.text (the visual assertion criteria)
        const vlmPrompt = step.text || 'Is this graph visualization rendering correctly with visible nodes, edges, and labels?';

        try {
          const vlmRes = await fetch('http://localhost:4001/v1/chat/completions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer sk-dev-proxy-123' },
            body: JSON.stringify({
              model: 'vlm-openrouter',
              messages: [{
                role: 'user',
                content: [
                  { type: 'image_url', image_url: { url: `data:image/png;base64,${imgBase64}` } },
                  { type: 'text', text: `You are a UI test evaluator. Answer PASS or FAIL followed by a one-line reason.\n\nCriteria: ${vlmPrompt}` }
                ]
              }],
              temperature: 0.1,
              max_tokens: 100,
            }),
          });

          const vlmData = await vlmRes.json() as any;
          const vlmAnswer = vlmData.choices?.[0]?.message?.content || 'No VLM response';
          const passed = vlmAnswer.toUpperCase().startsWith('PASS');

          return {
            status: passed ? 'PASSED' : 'FAILED',
            expected: vlmPrompt,
            actual: vlmAnswer,
            screenshotUrl: `/test-results/${runId}/${vsScreenPath}`,
          };
        } catch (vlmErr: any) {
          return {
            status: 'FAILED',
            detail: `VLM unreachable: ${vlmErr.message}`,
            expected: vlmPrompt,
            actual: 'VLM service unavailable',
            screenshotUrl: `/test-results/${runId}/${vsScreenPath}`,
          };
        }
        }
        case 'persona_review': {
          const personaSlug = step.persona || 'unknown';
          const reviewCriteria = step.review_criteria || step.text || 'Evaluate this reverse engineering tool interface.';
          const reviewUrl = step.url || await cdp.evaluate('window.location.href');

          // Load prompt from /prompt-lab
          const prPromptDir = resolve(process.cwd(), '..', '..', '.pi', 'skills', 'prompt-lab', 'prompts');
          const prTemplate = existsSync(join(prPromptDir, 'persona_review_v1.txt'))
            ? readFileSync(join(prPromptDir, 'persona_review_v1.txt'), 'utf-8')
            : 'You are {persona_name}. Navigate to {review_url}. Review against: {review_criteria}. Return JSON verdict.';

          // Load AGENTS.md
          const prAgentPath = join(resolve(process.cwd(), '..', '..'), '.pi', 'agents', personaSlug, 'AGENTS.md');
          const prAgentProfile = existsSync(prAgentPath) ? readFileSync(prAgentPath, 'utf-8').slice(0, 1500) : '';

          const personaPrompt = prTemplate
            .replace('{persona_name}', personaSlug.replace(/-/g, ' '))
            .replace('{agent_profile}', prAgentProfile)
            .replace('{persona_context}', '')
            .replace('{review_criteria}', `Navigate to ${reviewUrl} and evaluate: ${reviewCriteria}`);

          // Per-persona model routing
          const prModels: Record<string, string> = {
            'tim-blazytko': 'sonnet', 'gynvael-coldwind': 'sonnet', 'liveoverflow': 'gemini-2.5-flash',
          };

          try {
            const subagentPort = Number(process.env.SUBAGENT_PORT || 8620);
            const subagentModel = prModels[personaSlug] || 'codex';
            console.log(`[PERSONA_REVIEW] ${personaSlug} via ${subagentModel} on port ${subagentPort}...`);

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 180_000); // 3 min timeout

            const prRes = await fetch(`http://localhost:${subagentPort}/chat`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              signal: controller.signal,
              body: JSON.stringify({
                model: subagentModel,
                prompt: personaPrompt,
                workspace: resolve(process.cwd()),
              }),
            });
            clearTimeout(timeoutId);

            const prData = await prRes.json() as any;
            console.log(`[PERSONA_REVIEW] ${personaSlug}: exit=${prData.exit_code}, response_len=${(prData.response||'').length}`);
            const prAnswer = prData.response || 'No persona review response';
            const prPassed = prAnswer.toUpperCase().includes('"PASS"') || prAnswer.includes('"verdict": "PASS"');

            return {
              status: prPassed ? 'PASSED' : 'FAILED',
              expected: `${personaSlug}: ${reviewCriteria}`,
              actual: prAnswer,
            };
          } catch (prErr: any) {
            return {
              status: 'FAILED',
              detail: `Persona review subagent unreachable: ${prErr.message}`,
              expected: `${personaSlug}: ${reviewCriteria}`,
              actual: 'Subagent service unavailable',
            };
          }
        }
      }
    return { status: 'PASSED' };
  } catch (err: any) {
    return { status: 'FAILED', detail: err.message };
  }
}

// ── Fix-Forward Execution ──────────────────────────────────────────
// Runs tests with on_fail:'fix' steps that dispatch to /subagent-service
// for automated bug fixing, then retry.

async function executeFixForwardRun(
  runId: string,
  tests: TestDefinition[],
  baseUrl: string,
  broadcast: (msg: any) => void,
  headless: boolean,
  fixBackend: string,
) {
  activeRunId = runId;
  const startTs = Date.now();
  const SUBAGENT_URL = 'http://localhost:8787'; // /subagent-service Docker endpoint

  broadcast({ type: 'test-run-start', payload: { runId, totalTests: tests.length, headless, mode: 'fix-forward' } });

  try {
    activeCDP = new CDPClient();
    await activeCDP.connect();
    console.log(`[FIX-FORWARD] Connected to Chrome via CDP on port ${CDP_PORT}`);

    for (const test of tests) {
      if (!activeCDP) break;

      const testStart = Date.now();
      const testResult = { testId: test.id, status: 'RUNNING', steps: [] as any[], durationMs: 0 };

      broadcast({ type: 'test-step', payload: { runId, testId: test.id, action: 'START', status: 'RUNNING', mode: 'fix-forward' } });

      try {

        for (const step of test.steps) {
          let stepResult = await executeStep(page, step, runId);
          testResult.steps.push({ ...step, ...stepResult });

          broadcast({
            type: 'test-step',
            payload: { runId, testId: test.id, step: step.action, selector: step.selector, status: stepResult.status, detail: stepResult.detail }
          });

          // ── Fix-forward loop on failure ────────────────────────
          if (stepResult.status === 'FAILED' && step.on_fail === 'fix') {
            const maxRetries = step.max_retries || 3;
            const fixLog: FixLog = {
              stepName: step.name || `${step.action}:${step.selector || ''}`,
              totalAttempts: 0,
              resolved: false,
              attempts: [],
            };

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
              fixLog.totalAttempts = attempt;

              broadcast({
                type: 'fix-attempt',
                payload: { runId, testId: test.id, stepName: fixLog.stepName, attempt, maxRetries, status: 'diagnosing' }
              });

              // Capture failure screenshot
              const fixScreenPath = `screenshots/fix_${test.id}_${attempt}_${Date.now()}.png`;
              let screenshotBase64 = '';
              try {
                await activeCDP!.screenshot(join(RESULTS_DIR, runId, fixScreenPath));
                screenshotBase64 = readFileSync(join(RESULTS_DIR, runId, fixScreenPath)).toString('base64');
              } catch { /* */ }

              // Classify failure — infra failures escalate immediately
              const errorText = stepResult.detail || '';
              const isInfra = /ECONNREFUSED|ENOTFOUND|timeout|net::ERR_|PROTOCOL_ERROR/.test(errorText);
              if (isInfra) {
                fixLog.attempts.push({
                  attempt, error: errorText, screenshot: fixScreenPath,
                  diagnosis: 'Infrastructure failure — escalating to human',
                  result: 'escalated',
                });
                broadcast({
                  type: 'fix-attempt',
                  payload: { runId, testId: test.id, stepName: fixLog.stepName, attempt, status: 'escalated', reason: 'Infrastructure failure' }
                });
                break;
              }

              // Build fix prompt for subagent
              const fixPrompt = [
                `## Bug Fix Request (Fix-Forward Test Runner)`,
                ``,
                `**Step**: ${step.name || step.action}`,
                `**Action**: ${step.action} on ${step.selector || 'page'}`,
                `**Error**: ${errorText}`,
                step.fix_scope?.length ? `**Allowed files**: ${step.fix_scope.join(', ')}` : '',
                `**Previous attempts**: ${attempt - 1}`,
                fixLog.attempts.length ? `**Previous fixes that didn't work**: ${fixLog.attempts.map(a => a.diagnosis).join('; ')}` : '',
                ``,
                `Fix the bug. Return ONLY the file path and minimal diff. Do not change files outside the allowed scope.`,
                `After fixing, the test step "${step.name || step.action}" should pass.`,
              ].filter(Boolean).join('\n');

              // Dispatch to /subagent-service
              let diagnosis = 'No response from fix agent';
              let diff = '';
              try {
                const model = fixBackend === 'codex' ? 'codex' : fixBackend === 'claude' ? 'claude-sonnet-4-20250514' : 'gemini-2.5-flash';
                const agentRes = await fetch(`${SUBAGENT_URL}/v1/chat/completions`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    model,
                    messages: [
                      { role: 'system', content: 'You are a bug-fixing agent. Diagnose the failure and provide a minimal fix. Output a brief diagnosis line, then the file path and unified diff.' },
                      {
                        role: 'user',
                        content: screenshotBase64
                          ? [
                              { type: 'text', text: fixPrompt },
                              { type: 'image_url', image_url: { url: `data:image/png;base64,${screenshotBase64}` } },
                            ]
                          : fixPrompt,
                      },
                    ],
                    temperature: 0.2,
                    max_tokens: 2000,
                  }),
                });
                const agentData = await agentRes.json() as any;
                const response = agentData.choices?.[0]?.message?.content || '';
                diagnosis = response.split('\n')[0] || 'Unknown diagnosis';
                diff = response;

                // Save the fix response
                writeFileSync(
                  join(RESULTS_DIR, runId, 'fixes', `fix_${test.id}_attempt${attempt}.md`),
                  `# Fix Attempt ${attempt}\n\n## Error\n${errorText}\n\n## Agent Response\n${response}`
                );
              } catch (agentErr: any) {
                diagnosis = `Fix agent unreachable: ${agentErr.message}`;
              }

              broadcast({
                type: 'fix-attempt',
                payload: { runId, testId: test.id, stepName: fixLog.stepName, attempt, status: 'fix-applied', diagnosis }
              });

              // Wait for HMR to pick up changes (Vite auto-reloads)
              await new Promise(r => setTimeout(r, 3000));

              // Reload page and retry the step
              try {
                await activeCDP!.evaluate('window.location.reload()'); await new Promise(r => setTimeout(r, 3000));
                await new Promise(r => setTimeout(r, 2000));
              } catch { /* page may have navigated */ }

              stepResult = await executeStep(page, step, runId);

              fixLog.attempts.push({
                attempt, error: errorText, screenshot: fixScreenPath,
                diagnosis, diff: diff.substring(0, 1000),
                result: stepResult.status === 'PASSED' ? 'fixed' : 'still_failing',
              });

              if (stepResult.status === 'PASSED') {
                fixLog.resolved = true;
                broadcast({
                  type: 'fix-attempt',
                  payload: { runId, testId: test.id, stepName: fixLog.stepName, attempt, status: 'resolved', diagnosis }
                });
                break;
              }
            }

            // Record fix log
            const run = runHistory.get(runId)!;
            run.fixLog.push(fixLog);

            if (fixLog.resolved) {
              run.summary.fixed++;
              // Update step result to reflect the fix
              testResult.steps[testResult.steps.length - 1] = { ...step, ...stepResult, fixedAfter: fixLog.totalAttempts };
            } else {
              // Escalate — stop this test
              broadcast({
                type: 'fix-escalate',
                payload: { runId, testId: test.id, stepName: fixLog.stepName, attempts: fixLog.totalAttempts, lastError: stepResult.detail }
              });
              throw new Error(`Step "${fixLog.stepName}" failed after ${fixLog.totalAttempts} fix attempts — escalating to human`);
            }
          } else if (stepResult.status === 'FAILED' && step.on_fail === 'skip') {
            // Skip mode — mark as skipped and continue
            testResult.steps[testResult.steps.length - 1].status = 'SKIPPED';
            continue;
          } else if (stepResult.status === 'FAILED') {
            // Default: stop on failure
            throw new Error(stepResult.detail);
          }
        }

        testResult.status = 'PASSED';
      } catch (err: any) {
        testResult.status = 'FAILED';
      } finally {
        testResult.durationMs = Date.now() - testStart;
        const run = runHistory.get(runId)!;
        run.results.push(testResult);
        if (testResult.status === 'PASSED') run.summary.passed++;
        else run.summary.failed++;

        broadcast({ type: 'test-result', payload: { runId, testId: test.id, status: testResult.status, durationMs: testResult.durationMs } });
      }
    }
  } catch (err) {
    console.error('[FIX_FORWARD] Critical failure:', err);
  } finally {
    if (activeCDP) {
      activeCDP.close();
      activeCDP = null;
    }

    const run = runHistory.get(runId)!;
    run.status = run.summary.failed > 0 ? 'FAILED' : 'PASSED';
    run.completedAt = new Date().toISOString();
    run.durationMs = Date.now() - startTs;

    broadcast({
      type: 'test-run-done',
      payload: {
        runId, status: run.status, mode: 'fix-forward',
        summary: run.summary, fixLog: run.fixLog, durationMs: run.durationMs,
      }
    });
    activeRunId = null;
  }
}

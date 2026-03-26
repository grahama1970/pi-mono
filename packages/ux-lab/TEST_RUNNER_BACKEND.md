# UX Lab Test Runner — Backend Design

## Architecture

```
Testing Tab (React) → Express API → Puppeteer CDP → Chrome (headless) → Screenshots + Results
                   ↘ WebSocket (live progress)
```

The test runner lives server-side in the Express process. It launches headless Chrome via Puppeteer, executes tests from the manifest, captures screenshots, and streams results back via WebSocket.

## Manifest Format (test-manifest.json)

The YAML manifest must be converted to a machine-executable JSON format. Each test has a CSS selector, an action, and an assertion.

```json
{
  "version": 1,
  "baseUrl": "http://localhost:3001",
  "tests": [
    {
      "id": "sidebar_collapse",
      "group": "sidebar",
      "label": "Collapse sidebar",
      "steps": [
        { "action": "click", "selector": "button:has(svg.lucide-panel-left-close)" },
        { "action": "wait", "ms": 500 },
        { "action": "screenshot", "name": "sidebar_collapsed" },
        { "action": "assert", "type": "style", "selector": "aside", "property": "width", "operator": "lt", "value": 60 }
      ]
    },
    {
      "id": "sidebar_search",
      "group": "sidebar",
      "label": "Filter projects by search",
      "steps": [
        { "action": "type", "selector": "input[placeholder*='Search']", "text": "Binary" },
        { "action": "wait", "ms": 300 },
        { "action": "screenshot", "name": "sidebar_filtered" },
        { "action": "assert", "type": "count", "selector": "[class*='cursor-pointer']:has(h4)", "operator": "eq", "value": 1 }
      ]
    },
    {
      "id": "card_drag",
      "group": "design_board",
      "label": "Drag card to reposition",
      "steps": [
        { "action": "click", "selector": "button:has-text('Design Board')" },
        { "action": "wait", "ms": 1000 },
        { "action": "drag", "selector": "[class*='cursor-grab']:first-child", "dx": 200, "dy": 100 },
        { "action": "screenshot", "name": "card_dragged" },
        { "action": "assert", "type": "moved", "selector": "[class*='cursor-grab']:first-child", "minDx": 50 }
      ]
    },
    {
      "id": "context_menu_card",
      "group": "design_board",
      "label": "Right-click card shows context menu",
      "steps": [
        { "action": "rightclick", "selector": "[class*='cursor-grab']:first-child" },
        { "action": "wait", "ms": 300 },
        { "action": "screenshot", "name": "context_menu_card" },
        { "action": "assert", "type": "text_contains", "selector": "[class*='z-[1000]']", "text": "Delete" },
        { "action": "assert", "type": "text_contains", "selector": "[class*='z-[1000]']", "text": "Bring Forward" }
      ]
    }
  ]
}
```

### Action Types

| Action | Fields | Description |
|--------|--------|-------------|
| `click` | `selector` | Click an element |
| `rightclick` | `selector` | Right-click an element |
| `type` | `selector`, `text` | Type text into an input |
| `clear` | `selector` | Clear an input |
| `hover` | `selector` | Hover over an element |
| `drag` | `selector`, `dx`, `dy` | Mouse drag from element center by dx,dy pixels |
| `scroll` | `selector?`, `dx`, `dy` | Scroll (wheel event), ctrl+scroll for zoom |
| `navigate` | `url` or `hash` | Navigate to URL or set hash |
| `wait` | `ms` | Wait N milliseconds |
| `screenshot` | `name` | Capture full-page screenshot, saved to test-results/{run_id}/ |
| `assert` | (varies by type) | Assert a condition — test fails if assertion fails |
| `evaluate` | `script` | Run arbitrary JS in page context, return value |

### Assertion Types

| Type | Fields | Description |
|------|--------|-------------|
| `exists` | `selector` | Element exists in DOM |
| `not_exists` | `selector` | Element does NOT exist |
| `text_contains` | `selector`, `text` | Element innerText contains string |
| `count` | `selector`, `operator`, `value` | Count of matching elements (eq, gt, lt, gte, lte) |
| `style` | `selector`, `property`, `operator`, `value` | Computed style value comparison |
| `visible` | `selector` | Element is visible (not display:none, not zero-size) |
| `moved` | `selector`, `minDx?`, `minDy?` | Element position changed since last measurement |
| `attribute` | `selector`, `attr`, `operator`, `value` | Element attribute value |
| `screenshot_diff` | `name`, `reference`, `threshold` | Compare screenshot to reference (future: VLM-based) |

## Express Endpoints

### `POST /api/test-runner/run`

Start a test run. Returns immediately with a `runId`. Results stream via WebSocket.

```typescript
// Request
{
  tests?: string[],  // Optional: run only these test IDs. Omit = run all.
  group?: string,     // Optional: run only this group
}

// Response
{
  runId: string,
  totalTests: number,
  status: "RUNNING"
}
```

### `GET /api/test-runner/manifest`

Return the parsed manifest.

```typescript
// Response
{
  version: number,
  tests: TestDefinition[],
  groups: string[]  // unique group names
}
```

### `GET /api/test-runner/results/:runId`

Get results for a completed or in-progress run.

```typescript
// Response
{
  runId: string,
  status: "RUNNING" | "PASSED" | "FAILED" | "ABORTED",
  startedAt: string,
  completedAt?: string,
  durationMs?: number,
  results: [{
    testId: string,
    status: "PASSED" | "FAILED" | "SKIPPED" | "RUNNING",
    steps: [{
      action: string,
      status: "PASSED" | "FAILED",
      detail?: string,     // error message on failure
      screenshotUrl?: string  // "/test-results/{runId}/{name}.png"
    }],
    durationMs: number
  }],
  summary: {
    total: number,
    passed: number,
    failed: number,
    skipped: number
  }
}
```

### `POST /api/test-runner/abort`

Abort a running test. Kills the Puppeteer browser.

```typescript
// Request
{ runId: string }
// Response
{ status: "ABORTED" }
```

### `GET /api/test-runner/screenshot/:runId/:name`

Serve a screenshot from a test run.

## WebSocket Events (via existing /ws bus)

Progress events broadcast during a test run:

```typescript
{ type: "test-run-start", payload: { runId, totalTests } }
{ type: "test-step",     payload: { runId, testId, step, action, status, detail?, screenshotUrl? } }
{ type: "test-result",   payload: { runId, testId, status, durationMs } }
{ type: "test-run-done", payload: { runId, status, summary, durationMs } }
```

## Server Implementation (server/test-runner.ts)

```typescript
import puppeteer, { Browser, Page } from 'puppeteer';
import { readFileSync, mkdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';
import { WebSocketServer } from 'ws';
import { parse as parseYaml } from 'yaml'; // or convert manifest to JSON

interface TestStep {
  action: string;
  selector?: string;
  text?: string;
  dx?: number;
  dy?: number;
  ms?: number;
  name?: string;
  type?: string;       // assertion type
  property?: string;
  operator?: string;
  value?: number | string;
  script?: string;
  hash?: string;
  url?: string;
  threshold?: number;
  reference?: string;
  attr?: string;
  minDx?: number;
  minDy?: number;
}

interface TestDefinition {
  id: string;
  group: string;
  label: string;
  steps: TestStep[];
}

// Key design decisions:
// 1. ONE browser instance per run (not per test) — faster, less memory
// 2. Tests run sequentially — state accumulates (sidebar collapses stay collapsed)
// 3. Each test group reloads the page — clean state per group
// 4. Screenshots go to test-results/{runId}/ — served as static files
// 5. Results broadcast via existing WebSocket bus
// 6. Puppeteer uses system Chrome at /usr/bin/google-chrome-stable
// 7. Max run time: 5 minutes, then auto-abort
```

## File Structure

```
packages/ux-lab/
  server/
    index.ts            — existing Express server, add test-runner routes
    test-runner.ts      — NEW: Puppeteer test execution engine
  test-manifest.json    — NEW: machine-executable manifest (converted from YAML)
  test-results/         — NEW: screenshots and result JSON per run
    {runId}/
      screenshots/
        sidebar_collapsed.png
        card_dragged.png
      results.json
```

## Frontend (Testing Tab) Needs

The React TestingManifest component should:
1. `GET /api/test-runner/manifest` on mount — display test list with groups
2. "Run All" / "Run Group" / "Run Single" buttons → `POST /api/test-runner/run`
3. Listen to WebSocket for `test-step` / `test-result` / `test-run-done` events
4. Show live progress: current test, step logs, pass/fail badges
5. Display screenshots inline (click to expand)
6. Show summary: passed/failed/total with timing

## Key Rules

1. **CDP over WebSocket** — Puppeteer connects to Chrome via CDP, NOT xdotool/xte mouse hijacking
2. **Headless Chrome** — `--headless=new` flag, does NOT steal the user's browser
3. **Screenshots are evidence** — every test step that modifies state should screenshot
4. **No mock results** — every pass/fail comes from real Puppeteer assertions
5. **Manifest on disk** — not hardcoded in React, loaded from `test-manifest.json`
6. **Static file serving** — screenshots served via `/test-results/` Express static route

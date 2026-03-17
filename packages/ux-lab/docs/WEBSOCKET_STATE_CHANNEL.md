# WebSocket State Channel for /test-interactions

## Problem

Current `/test-interactions` verification uses CDP string-scraping:
```js
const text = await page.$eval('body', el => el.textContent);
assert(text.includes('Controls'));  // WRONG: finds hidden tab content
```

This passed 44/45 tests while Sources showed 0 for 3 frameworks — string presence in DOM doesn't mean correct rendering.

## Architecture: CDP Drives, WebSocket Verifies

```
┌──────────────┐     CDP (clicks, keys)     ┌──────────────────┐
│  Playwright   │ ─────────────────────────► │  SPARTA Explorer  │
│  Test Runner  │                             │  (React App)      │
│               │ ◄───────────────────────── │                    │
│               │     WebSocket (state)       │  useExplorerState │
└──────────────┘                             └──────────────────┘
```

### CDP (Chrome DevTools Protocol) — INPUT
- Navigate to URL
- Click tabs, buttons, rows
- Type in search inputs
- Press keyboard shortcuts
- Take screenshots

### WebSocket — VERIFICATION
- App reports its own structured state
- Test runner asserts against state, not DOM strings

## State Shape

```typescript
interface ExplorerState {
  activeTab: string;               // "overview" | "controls" | "qras" | etc.
  tabData: {
    [tabName: string]: {
      loaded: boolean;
      rowCount: number;
      searchQuery: string;
      selectedId: string | null;
      slideoverOpen: boolean;
      error: string | null;
    }
  };
  frameworkCounts: Record<string, number>;  // { SPARTA: 198, ATT&CK: 2641, ... }
  collectionCounts: Record<string, number>; // { controls: 11234, qras: 218000, ... }
}
```

## Implementation Plan

### 1. React Hook: `useExplorerState`
Broadcast state changes via `window.__EXPLORER_STATE__` or a WebSocket server.

### 2. Express Server: WebSocket Endpoint
Add `/ws/state` to the existing Express server. On connect, send current state. On app state change, push update.

### 3. Test Runner: WebSocket Client
Replace `text.includes()` checks with:
```js
const state = await wsClient.getState();
assert.equal(state.activeTab, 'controls');
assert.equal(state.tabData.controls.rowCount, 120);
```

## Priority: Medium
This is an architectural improvement. Current Playwright tests work for most cases. The WebSocket channel prevents false-positive tests when DOM contains hidden tab content.

## Filed As Bug
String-scraping passed 44/45 while 3 frameworks showed 0. WebSocket state verification would have caught this immediately.

# QuerySpec Pipeline Walkthrough: What Actually Happens Today

**Date:** 2026-03-31
**Reviewed by:** Tim Blazytko (RE expert, requested)
**User concern:** "Your QuerySpec integration is aspirational and created an extremely shallow non-working version"

---

## The User's Command

User types in Binary Explorer chat:
> "click tunnel.* namespace and show the related nodes"

What SHOULD happen: entities extracted, QuerySpec constructed, node selected + neighbors expanded, evidence chain shown.

What ACTUALLY happens today: **LLM prose response.** Let me trace exactly why.

---

## Step-by-Step: What Fires in the Code

### Step 0: Chat Input (BinaryExplorerView.tsx:1121)

```typescript
async function sendChat() {
  const text = chatInput.trim()  // "click tunnel.* namespace and show the related nodes"
```

### Step 1: Exact Match Check (line 1150-1159)

```typescript
const exactMatch = data.graphNodes.find(n =>
  n.label.toLowerCase() === text.toLowerCase()
)
```

**Result:** No match. "click tunnel.* namespace and show the related nodes" doesn't match any node label exactly.

### Step 2: Partial Match Check (line 1162-1169)

```typescript
const partialMatches = data.graphNodes.filter(n =>
  n.label.toLowerCase().includes(text.toLowerCase())
)
```

**Result:** No match. The full sentence doesn't substring-match any label.

### Step 3: Entity Extraction (line 1177-1202)

```typescript
const res = await fetch('/api/extract-entities', {
  method: 'POST',
  body: JSON.stringify({ text, collection: 'binary_features' })
})
```

**What happens:** POST to UX Lab server → proxied to memory daemon `/extract-entities`.

**PROBLEM 1:** The server proxy at `server/index.ts:993` uses delimiter mode by default, splitting on commas/spaces. It doesn't use FlashText NLP mode for natural language. The phrase "click tunnel.* namespace and show the related nodes" gets split into individual tokens ["click", "tunnel.*", "namespace", "and", "show", "the", "related", "nodes"], each looked up individually.

**Result:** `tunnel.*` might match `binary_features/droid:ns:tunnel.*` if it's in the binary. But the entity extraction is doing token lookup, not NLP entity recognition.

**Actual result (from testing):** `mentionedEntities = [{id: "binary_features/droid:ns:tunnel.*", label: "tunnel.* namespace", nodeType: "namespace"}]` — it DOES find the entity via token matching because "tunnel.*" matches a node name.

### Step 4: Memory Recall Interceptor (line 1215-1241)

```typescript
const recallRes = await fetch(`${API}/api/memory/recall`, {
  body: JSON.stringify({
    q: entityCtx ? `${text} ${entityCtx}` : text,
    k: 3,
    labels: ['intent-training-v2']
  })
})
```

**What happens:** Searches `lessons` collection for docs tagged `intent-training-v2` that semantically match the query.

**PROBLEM 2:** The `intent-training-v2` corpus has ~77 training docs (from a previous session). The query "click tunnel.* namespace and show the related nodes [namespace] tunnel.* namespace" may not match any training doc with >0.85 similarity.

**Result:** `intentFound = false` — similarity too low, falls through.

### Step 5: /memory intent (line 1248-1264)

```typescript
const intentRes = await fetch(`${API}/api/memory/intent`, {
  body: JSON.stringify({ q: text, scope: 'binary-explorer', fast: false }),
})
```

**What happens:** POST to memory daemon's IntentMapper.infer() — the 8-step cascade.

**PROBLEM 3:** The IntentMapper was designed for SPARTA queries, not Binary Explorer commands. Its `scope: 'binary-explorer'` path hits:
1. Self-correction check — no prior query, passes
2. Recall grounding — searches `intent-training-v2`, low confidence
3. Entity pre-scan — extracts control IDs via regex patterns (CWE-xxx, T1xxx) — none found in "click tunnel.*"
4. Ambiguity gate — query has domain keywords, passes
5. T0.5 classifier — may return `QUERY` not `UI_COMMAND` (it wasn't trained on Binary Explorer commands)
6. LLM enrichment — calls scillm, may return `{action: "QUERY", entities: ["tunnel"], keywords: ["namespace", "related"]}` — NOT a UI_COMMAND
7. SFT fallback — Qwen model, similar issue
8. Rule fallback — builds minimal QuerySpec with `action: "QUERY"`

**Result:** `intentData = {action: "QUERY", ...}` — the intent pipeline returns QUERY, not UI_COMMAND. `intentFound = true` but `action !== 'NO_MATCH'` so it enters the intent handler.

### Step 6: Intent Handler (line 1267-1343)

```typescript
if (intentFound && intentData) {
  const { ui_action, target_node_id, expand_hops = 1, perspective: intentP } = intentData
```

**PROBLEM 4:** `intentData.ui_action` is undefined (it returned `action: "QUERY"`, not `ui_action: "SELECT_NODE"`). So:

```typescript
if (ui_action === 'SELECT_NODE' || (target_node_id && !ui_action)) {
  // SKIPPED — ui_action is undefined AND target_node_id is undefined
}
```

None of the command handlers match. `executedMsg` stays empty.

```typescript
if (executedMsg) {
  // SKIPPED — no command executed
  return
}
```

### Step 7: Falls Through to LLM Chat (line 1346+)

```typescript
// 1. Local Search: binary features for grounded context
const localSearchCtx = await searchBinaryFeatures(text)

// 2. Memory Recall: ArangoDB QRA lessons via memory daemon proxy
let memoryRecallCtx = ''
// ...

// 3. Send to scillm for prose response
```

**Result:** The query gets sent to scillm LLM with binary feature context, and the user gets a prose response: "Here's a breakdown of tunnel.* namespace and its related nodes..."

**The command was never executed.** The node was never selected. The neighbors were never expanded. The user gets text instead of action.

---

## Where the Pipeline Breaks (5 Failure Points)

| # | Where | What Breaks | Why |
|---|-------|-------------|-----|
| 1 | Entity extraction | Uses delimiter mode, not NLP | Server proxy default is delimiter, not FlashText |
| 2 | Recall interceptor | No high-confidence match in intent-training-v2 | Only 77 training docs, threshold 0.85 is strict |
| 3 | /memory intent | Returns QUERY not UI_COMMAND | IntentMapper wasn't trained for Binary Explorer commands |
| 4 | Intent handler | No ui_action field → falls through | QUERY action has no ui_action, command dispatch doesn't fire |
| 5 | No fallback | Entities were extracted but ignored | When intent returns QUERY + entities exist, nothing tries SELECT_NODE |

---

## What the New app_actions Collection Adds (and What It Doesn't)

### What was built:
- `app_actions` collection in ArangoDB with 6 registered actions
- `app_actions_search` ArangoSearch view for BM25 recall
- Recall source declaration so `/recall` can search it
- Whitelisted in memory daemon for list/by-keys access

### What it does NOT do yet:
- Binary Explorer does NOT query `app_actions` during chat — the code still uses the old `/memory intent` path
- Actions are NOT registered on app boot — they were manually inserted via Python script
- No `useRegisterAction` hook exists in React code
- No evidence case construction — entities + candidate actions are never sent to Opus together
- No training pair storage — successful executions aren't stored back to ArangoDB
- Embeddings are missing (dense=0.00) — only BM25 matching works

### What would need to change in BinaryExplorerView.tsx to actually work:

```typescript
// After entity extraction (Step 3), BEFORE /memory intent:
// NEW: Query app_actions for matching commands
const actionsRes = await fetch(`${API}/api/memory/recall`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    q: text,
    k: 5,
    scope: 'binary-explorer',
    collections: ['app_actions'],
    tags: ['queryspec-action'],
  })
})
const candidateActions = actionsRes.ok ? (await actionsRes.json()).items : []

// If entities + candidate actions found:
if (mentionedEntities.length > 0 && candidateActions.length > 0) {
  // Send to /scillm Opus with evidence:
  // - Original NL
  // - Extracted entities with definitions
  // - Candidate actions from app_actions
  // → Opus picks the right action
  // → App executes by _key
  // → Store training pair
}
```

This code does NOT exist today. The wiring is aspirational.

---

## What IS Working (Honestly)

1. **Accessibility:** tabindex, aria-label, keyboard nav (←→ Enter Esc), focus ring, aria-live announcements — these are real, committed, functional
2. **Evidence display:** When a command IS executed (via the old intent path), the chat shows extracted entities + QuerySpec + source — not just prose
3. **VLM review pipeline:** 34/34 screenshots captured, honest scoring (7.6 avg with real failures identified)
4. **Regex heuristic removed:** The bespoke .includes() intent parsing is gone, /memory intent is the sole path
5. **app_actions collection:** Created, indexed, searchable via BM25, accessible via httpx

---

## What's NOT Working (Honestly)

1. **The command pipeline end-to-end:** User types command → gets prose, not action execution
2. **app_actions → Binary Explorer wiring:** Collection exists but app doesn't query it
3. **useRegisterAction hook:** Doesn't exist — actions were manually inserted
4. **Evidence case for commands:** Not built — no entity + candidate action → Opus → QuerySpec flow
5. **Training pair storage:** Not wired — successful executions don't store back to ArangoDB
6. **Embeddings on app_actions:** Missing — only BM25, no cosine similarity

---

## The Gap Between Architecture and Implementation

**Architecture (documented in memory):**
```
Voice → /extract-entities → /memory recall (definitions) → /scillm Opus (evidence + actions → QuerySpec) → deterministic execution → store training pair
```

**Reality (in code today):**
```
Text → entity extraction (works) → /memory intent (returns QUERY not UI_COMMAND) → falls through → LLM prose
```

The architecture is sound. The `app_actions` collection, the ArangoSearch view, the recall source declaration, the taxonomy intent tags — all infrastructure exists. But the last 100 lines of code that wire Binary Explorer's chat to actually USE this infrastructure were not written.

---

## What Needs to Happen Next

1. **Wire app_actions recall into sendChat()** — after entity extraction, before /memory intent, query app_actions for candidate commands
2. **Build the evidence case** — entities + candidates + NL → /scillm Opus → QuerySpec
3. **Execute by _key** — match Opus output to registered action, call handler
4. **Store training pair** — every (NL, entities, candidates, QuerySpec, executed) → /memory learn
5. **Build useRegisterAction hook** — React components register on mount, unregister on unmount
6. **Register on boot** — Binary Explorer registers all actions to app_actions on load

Items 1-4 are ~80 lines in BinaryExplorerView.tsx.
Items 5-6 are ~40 lines as a shared React hook.

---

## Tim Blazytko Review (Pending)

*Tim has not reviewed this walkthrough yet. His concerns as an RE automation expert would be:*
- Does the pipeline add latency to the interaction? (entity extraction + recall + Opus = how many ms?)
- Is the QuerySpec vocabulary sufficient for RE workflows? (6 actions is thin)
- Can the pipeline handle compound commands? ("select auth, expand 2 hops, switch to security view")
- What happens when /extract-entities can't ground an entity? (the binary doesn't have that function)

---

## Bottom Line

**Will the voice→QuerySpec pipeline work?** The architecture is correct and the infrastructure (collection, view, recall source, taxonomy edges) is built. But the wiring from Binary Explorer's chat to the app_actions pipeline is not connected. Today, every NL command falls through to LLM prose.

**What's genuinely different from previous attempts?**
1. Actions stored in ArangoDB with BM25 search (not regex matching)
2. /memory recall finds candidate commands by semantic similarity
3. Opus labels with full evidence context (not guessing from NL alone)
4. Every execution becomes training data for the 32B model

**What's the same?** The sendChat() function still routes to /memory intent which returns QUERY, and the command dispatch still only fires on UI_COMMAND. The last-mile wiring is missing.

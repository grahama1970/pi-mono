# Round 9 Persona Advice

Overall avg: 5.8/10

## tim-blazytko (5.4/10, via codex)

Persona agent unreachable: TypeError: fetch failed

---

## gynvael-coldwind (5.8/10, via codex)

Memory recall checked first via `/recall` API: `found=true`, `should_scan=false`, `confidence=0.954`. Prior memory matches your exact complaint pattern (assembly view missing, investigation workflow gaps).
1. **P0: Add a real RE tri-pane (Graph + Disassembly + Hex), synced by selection**
1. What’s wrong: You currently have a graph shell without byte-level truth. No disassembly pane, no hex dump, no instruction-level context, no syntax highlighting. That is not a binary explorer.
2. How to fix:
- Layout: 3 columns on desktop: left `Function/State tree`, center `Graph`, right split `Disasm` (top) + `Hex` (bottom).
- Clicking any function/state node loads both disasm and raw bytes at matching address/offset.
- Color rules (high contrast): opcodes `#ff5ca8`, registers `#56d6ff`, immediates `#ffd166`, addresses `#9aa4b2`, comments `#7f8c98`.
- Hex view: 16-byte rows, offset column, ASCII column, selected instruction byte-range highlight.
3. Why it matters: RE decisions are made on bytes/instructions, not abstract nodes. Without this, I cannot validate control flow or spot obfuscation tricks.
2. **P0: Make the state machine/call graph actually render and navigable (kill “No nodes in scene”)**
1. What’s wrong: “No nodes in scene” with no diagnosis means the core feature is effectively broken. Also no visible states, transitions, initial/error/final markers.
2. How to fix:
- Replace empty text with typed empty states: `Loading`, `Filtered out`, `No extraction result`, `Parser error`, each with next action button.
- Render state nodes as circles, transitions as labeled arrows, initial state with double ring, terminal/error with distinct icon + color.
- Add `Trace Path` control: pick start node + event sequence, animate transitions step-by-step.
3. Why it matters: Protocol RE is state-machine work. If transitions are invisible or non-interactive, I cannot reason about auth bypasses, dead states, or unexpected transitions.
3. **P1: Add attack-surface call-tracing controls (depth + indirect calls + path highlight)**
1. What’s wrong: No caller/callee tracing, no indirect call handling, no entry-to-target pathing. That blocks vulnerability triage.
2. How to fix:
- Add top toolbar controls: `Call Depth` slider (1-8), `Include Indirect Calls` toggle, `Show Paths To…` search box.
- On selection, highlight inbound/outbound paths with strong color separation (e.g., callers orange, callees cyan, selected path yellow).
- Add one-click preset queries: `Paths to dangerous sinks`, `Who calls this RPC`, `Unreachable functions`.
3. Why it matters: Real RE workflow is graph traversal under uncertainty. I need fast dependency tracing to map exploit paths and prioritize audit targets.
These 3 changes move the tool from “metadata viewer” to “actual reverse-engineering workstation,” which is what will raise your score fast.

---

## liveoverflow (6.2/10, via gemini-3-flash-preview)

Persona agent unreachable: TypeError: fetch failed
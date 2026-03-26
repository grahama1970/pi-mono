# Round 5 Persona Advice

Overall avg: 6.2/10

## tim-blazytko (6.2/10, via codex)

Persona agent unreachable: TypeError: fetch failed

---

## gynvael-coldwind (6.4/10, via codex)

`/memory recall` attempt: blocked in this environment (`.pi/skills/memory/run.sh` requires `uv`, which is not installed), so no prior memory hits were retrievable.
1. **Add real type-overlay + union visualization (highest impact)**
What is wrong: The UI talks about source/binary exploration, but there is no byte-level memory layout, no union overlap view, no tagged-union dispatch, no variant switching. For RE, that is a core capability gap.
How to fix: Add a right-side `Memory Layout` panel with hex rows (`0x00, 0x10...`) and overlay colors per field. Use semi-transparent overlays for overlapping union members (e.g. variant A = cyan, B = amber), and highlight tag/discriminator field in a distinct color (red border + badge `tag=2 -> VariantB`). Add a `Union Explorer` list with clickable variants and synchronized highlight in hex + graph + decompiled view.
Why it matters: Reverse engineering is about competing interpretations of the same bytes. If I cannot switch interpretations live, I cannot validate hypotheses quickly.
2. **Add a proper Symbols table (virtualized, sortable, fixed header, regex filter)**
What is wrong: No obvious symbol/function table means core navigation is missing. Graph-only navigation does not scale.
How to fix: Add a dedicated `Symbols` tab/panel with fixed header columns: `Name | Addr | Size | Xrefs | Type | Module`. Make it virtualized (react-window or equivalent), keyboard navigable (`j/k`, Enter), sortable per column, and regex filter input (`/^handle_.*/`) plus `Hide unmatched` toggle. Keep header anchored while scrolling.
Why it matters: On large binaries, RE starts with triage through symbols/imports/strings. Without fast tabular navigation, I waste time fighting UI instead of analyzing code.
3. **Make analysis state persistent and reusable (filter presets + bookmarks)**
What is wrong: No visible save/restore for filters/views. Iterative RE sessions lose context.
How to fix: Add `Presets` control near filter bar: `Save`, `Load`, `Update`, `Delete`. Persist regex filters, hidden node classes, selected symbol, graph camera/zoom, and open side panels. Add quick bookmarks (`B` to bookmark current symbol/view, `Shift+B` list) and workspace-scoped storage.
Why it matters: Real reversing is multi-session and collaborative. If I cannot restore “auth path triage” or “network parser chain” instantly, tool friction kills workflow velocity.

---

## liveoverflow (6.0/10, via gemini-3-flash-preview)

Persona agent unreachable: TypeError: fetch failed
# Round 1 Persona Advice

Overall avg: 5.9/10

## tim-blazytko (6.5/10, via codex)

1. **Expose real binary truth in the table/tree (Address/Size/Entropy + Raw ELF view + sort/export)**
- **What’s wrong:** The current tree is an abstraction (`daemon.*` buckets, counts) with no VA/RVA, size, or entropy, and no clear sort/export path. For RE, that’s hiding ground truth.
- **How to fix it:**
- Add a `Raw ELF View` toggle at the top of the left pane (next to filter/search).
- In raw mode, show direct section/symbol entries, not namespace aggregation.
- Default visible columns: `Name | VA/RVA | Size | Entropy | Type | Tags`.
- Add `Columns` button (right of table header) with checkboxes; persist in local storage per project.
- Add `Sort By` dropdown (`Address`, `Name`, `Size`, `Entropy`, `Type`) + ascending/descending toggle.
- Add `Export CSV/JSON` button in the same toolbar.
- Make columns resizable with drag handles; use monospace for address/size cells.
- **Why it matters for my workflow:** I need immediate correlation with IDA/Ghidra/debugger addresses and fast triage of suspicious regions (high entropy, odd size, unknown type). If I can’t sort/export raw symbols, I leave your UI and script it myself.
2. **Fix graph usability: no-empty state + explicit layout selector + density controls**
- **What’s wrong:** First load looks broken (empty center), and force layout without structure controls is wrong for call/RPC graphs. Dense binaries become spaghetti.
- **How to fix it:**
- Replace blank viewport with a clear empty-state card centered on canvas:
- Title: `No nodes selected`
- Subtitle: `Select a namespace/symbol from the left to render graph`
- Primary button: `Load Sample Graph`
- Secondary: `Ingest Binary`
- Add a persistent layout bar above graph: `Force | Hierarchical | Dagre | Radial`.
- Default rule: `<150 nodes => Force`, `>=150 => Dagre` (auto-switch toast, user-overridable).
- Add toggles: `Edge Bundling`, `Cluster by Namespace`, `Prevent Overlap`.
- Add mini legend with node/edge counts in top-right.
- **Why it matters for my workflow:** I need structure discovery, not pretty physics. Call hierarchy and subsystem boundaries are the core questions. Wrong defaults waste time and hide attack paths.
3. **Make RPC nodes actionable: schema + calling convention + auth + code linkage**
- **What’s wrong:** RPC nodes are currently labels without interface semantics or implementation linkage. No params/return schema, no calling convention, no auth metadata, no xrefs to code.
- **How to fix it:**
- On node click, open right-side `Node Details` panel with sections:
- `Interface`: params (type/width), return type/schema
- `Execution`: calling convention (`sysv`, `fastcall`, etc.), thunk/wrapper flags
- `Security`: auth requirements (`admin`, token-bound, capability check), trust boundary tags
- `Implementation`: symbol name, address(es), xref count, jump-to-disassembly action
- Add inline badges on node cards: `AUTH`, `UNAUTH`, `ADMIN`, `TOKEN`, color-coded (`red` unauth, `amber` partial, `green` enforced).
- Add `Generate Fuzz Harness` action for selected RPC (AFL++/libFuzzer stub with inferred argument types).
- **Why it matters for my workflow:** RE is about moving from interface to exploitability fast. Without auth context + real function linkage, I cannot prioritize targets or hand off cleanly to fuzzing/exploitation.
Memory note: recall could not be completed in this environment due missing `graph_memory` module, so this prioritization is based on your provided convergence findings.

---

## gynvael-coldwind (5.4/10, via codex)

1. Ship a real **code pane** by default (not an empty graph)
- What’s wrong: On load, the central workspace is effectively blank/abstract. For RE, that means zero immediate foothold: no instructions, no bytes, no addresses.
- How to fix: Replace default center view with a split `Disassembly | Hex` layout.
- Left: disassembly table (`VA`, `bytes`, `mnemonic`, `operands`) on dark neutral background (`#111317`), active row highlight in amber (`#d9a441`).
- Right: hex dump with synchronized caret/selection and ASCII gutter.
- Top of pane: function selector + entry-point jump button (`_start`/`main`).
- Keep graph as a secondary tab: `Graph`, not the landing screen.
- Why it matters: I need first-byte-to-first-instruction continuity immediately. If I can’t see bytes and mnemonics at open, I can’t validate parsing, control flow, or patchability.
2. Add **binary ground-truth panel** (sections, segments, symbols, imports, entropy)
- What’s wrong: You show aggregate counts (“334 features, 755 edges”), but no ELF/PE reality: sections, offsets, flags, entrypoint, imports, PLT/GOT, entropy hotspots.
- How to fix: Add a left docked `Binary Facts` panel with fixed-width rows:
- `Entry point`, `Image base`, `Arch`, `Endian`, `Bitness`.
- Section table: name, file offset, VA, size, perms, entropy (with mini heat bar).
- Imports/exports with quick filter (`libc`, `ntdll`, etc.).
- Click any row to jump disasm/hex to exact offset.
- Why it matters: RE starts with trust anchors. Sections and symbols tell me packing risk, attack surface, and where to dig first. Without this, your tool is exploratory art, not analysis infrastructure.
3. Make graph semantically useful: **typed nodes, shapes, filters, and CFG mode**
- What’s wrong: Current graph is low-signal and partially empty. Node semantics are unclear; no visible CFG branch logic; legend/filtering is too weak for real triage.
- How to fix:
- Enforce node shape taxonomy: function=rectangle, basic block=diamond, import=hexagon, data object=circle.
- Keep color but don’t rely on it; add shape + label prefixes (`fn:`, `bb:`, `imp:`).
- Add interactive legend with toggles and counts (`Functions 182`, `Imports 47`, etc.).
- Add `CFG mode` toggle: from selected function, render basic blocks + taken/fallthrough edges with directional arrows.
- Default camera fit to non-empty subgraph; never show an empty canvas on load.
- Why it matters: A graph only helps RE when it preserves control-flow semantics and lets me isolate noise fast. Typed, filterable CFG is actionable; abstract hub maps are not.
Memory recall note: I attempted `.pi/skills/memory/run.sh recall ...`, but this environment is missing `uv`, so recall could not execute.

---

## liveoverflow (5.8/10, via gemini-3-flash-preview)

Persona agent unreachable: TypeError: fetch failed
# Round 10 Persona Advice

Overall avg: 5.5/10

## tim-blazytko (5.2/10, via codex)

Persona agent unreachable: TypeError: fetch failed

---

## gynvael-coldwind (5.4/10, via codex)

Memory recall was attempted, but the local memory tool failed (`.pi/skills/memory/run.sh ...` exits because `uv` is missing).
So here is the hard-priority list based on your round-10 gaps.
1. **Add a real Struct Layout pane (byte-accurate)**
- **What’s wrong:** You show relationships, not memory truth. No offsets, no padding bytes, no alignment boundaries, no packing/ABI assumptions.
- **How to fix:** Add a docked right pane: `Struct Layout`.
- Table columns: `Offset | Size | Field | Type | Notes`
- Render explicit padding rows as `__padN` in red/hatched background.
- Show alignment markers every 8/16 bytes in gutter.
- Header tags: `ABI: x86_64 SysV`, `Packing: default / #pragma pack(1) / __attribute__((packed))`.
- Selecting a graph node auto-focuses the corresponding struct and highlights touched fields.
- **Why it matters:** Reverse engineering structs is about byte layout first. Without this, I cannot reliably reconstruct protocol/data formats or trust inferred C definitions.
2. **Integrate synchronized disasm + decompiler pane (not just graph)**
- **What’s wrong:** The tool is currently an exploration graph, not a RE workbench. No visible decompiled C, no control-flow reconstruction workflow.
- **How to fix:** 3-pane layout:
- Left: graph
- Center: decompiled C
- Bottom: assembly/CFG tabs
- Cross-highlighting: click node/block in graph -> jump to C line + asm block; click variable in C -> highlight defining/use nodes.
- Add inline rename/type edit in C (`N` rename, `T` set type), persisted back to graph labels.
- **Why it matters:** Graph-only analysis stalls on real binaries. I need semantic code + low-level ground truth side-by-side to validate hypotheses quickly.
3. **Make edge semantics always visible (type + direction), not hover-only**
- **What’s wrong:** Edge meaning is ambiguous during dense analysis. No persistent labels/arrows/style differences kills flow tracing.
- **How to fix:** Define fixed visual grammar with legend in top-right:
- `CALL`: green solid, arrowhead
- `DATA REF`: blue dashed
- `IMPORT`: orange thick
- `JMP/CFG`: gray thin
- Optional always-on short labels near midpoint (`call`, `xref`, `imp`), with declutter toggle.
- Add edge bundling for high-degree nodes and keep direction arrows visible at all zoom levels.
- **Why it matters:** In RE, I trace control/data flow constantly. If edge semantics require hover, I lose speed and make mistakes in complex graphs.

---

## liveoverflow (6.0/10, via gemini-3-flash-preview)

Persona agent unreachable: TypeError: fetch failed
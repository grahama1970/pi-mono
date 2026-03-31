# Stitch Design Prompt: ThinkingChain Component

## What to Design

A "Thinking Chain" component for Embry Terminal — an iPad agent control surface with NVIS MIL-STD-3009 dark theme.

When a user invokes a multi-step skill chain (e.g., `/create-evidence-case for CMMC compliance`), the agent runs a series of sub-steps. The ThinkingChain shows this as a **visual process tree** inline in the conversation.

## Example Chain

```
/create-evidence-case for CMMC compliance
  ├ /memory recall — searching prior evidence... ✓ 0.84 confidence (1.2s)
  ├ /dogpile — researching 3 sources... ✓ found 12 results (4.8s)
  ├ /extract-controls — extracting NIST controls... ✓ 47 controls (2.1s)
  ├ /scillm — synthesizing claims from evidence... ● running...
  └ /memory learn — storing evidence case (pending)
```

## Design Requirements

1. **Matches Claude Desktop's tool-action pattern** — see `ref-claude-desktop-chat.png` and `ref-claude-desktop-annotated.png`. In Claude Desktop, tool actions appear as muted text lines with `>` chevrons between message paragraphs. Our ThinkingChain follows the same pattern but shows multiple steps as a connected tree.

2. **Each step shows:**
   - Skill name as a blue badge (`/memory`, `/dogpile`, etc.)
   - Status icon: ● running (blue pulse), ✓ done (green), ✗ failed (red), ○ pending (dim)
   - One-line summary ("searching prior evidence...")
   - Duration right-aligned (1.2s)
   - Optional: confidence score, result count

3. **Collapsible:** Default shows the summary line (like "Ran 5 skills, 4 succeeded >"). Click expands to show all steps. Each step is also expandable to show detailed output.

4. **Vertical connector lines** between steps (like a git log graph or CI pipeline).

5. **NVIS colors** — see DESIGN.md. Background #141414, steps on #1a1a1a cards, green #00ff88, red #ff4444, blue #4a9eff, amber #ffaa00, accent #7c3aed.

6. **iPad touch-friendly** — 44px minimum tap targets. Steps are tappable to expand.

7. **Left-aligned, no bubble** — matches agent message pattern.

8. **The whole chain is ONE block** in the conversation, not separate messages.

## References (in this bundle)

- `ref-claude-desktop-chat.png` — Claude Desktop showing tool actions ("Created 7 files >")
- `ref-claude-desktop-annotated.png` — Annotated: user bubble right, agent text left, tool actions muted
- `ref-atomic-ops-stitch.png` — Our ATOMIC_OPS Stitch design (NVIS visual language)
- `ref-embry-mockup.png` — Our approved Embry Terminal mockup (conversation + artifact)
- `DESIGN.md` — NVIS MIL-STD-3009 design system (colors, fonts, borders)

## What NOT to Design

- Don't design the full page — just the ThinkingChain component
- Don't use bright borders or pure white
- Don't add icons/avatars — use color-coded status dots
- Don't make it look like a CI dashboard — it should feel like part of the conversation

## Inspiration

- GitHub Actions workflow run viewer (vertical steps with status)
- Vercel deployment log (collapsible build steps)
- Linear's activity feed (timestamped actions in a thread)
- Claude Desktop's "Created a file, read a file >" pattern (muted, collapsible)

## Variation Directions

1. **MINIMAL**: Just text lines with status dots and connector lines. Like `git log --oneline`.
2. **CARD**: Each step is a mini-card with rounded corners and subtle background.
3. **TIMELINE**: Vertical timeline with dots on a line, content to the right.

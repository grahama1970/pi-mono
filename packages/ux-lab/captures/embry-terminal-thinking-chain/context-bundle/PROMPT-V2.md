# Stitch Design Prompt V2: Unified Reasoning Chain

## What Changed from V1

The ThinkingChain is NOT a separate component from the message. It IS the message.
Everything the agent does — recall, reasoning text, skill calls, results — is ONE
connected visual flow with a vertical timeline.

## The Core UX Moment

The user sends "/create-evidence-case for CMMC compliance" and watches the agent
build its reasoning chain in real-time. Steps appear one by one with tasteful
animations. The vertical connector grows as new steps materialize. The active step
pulses. Completed steps settle into a quiet done state.

This is like watching a GitHub Actions workflow execute — but embedded in a conversation,
not on a separate page.

## The Unified Timeline

Everything is one connected flow with a dashed vertical line:

```
USER: /create-evidence-case for CMMC compliance
                                        ↑ right-aligned bubble

AGENT REASONING CHAIN:                  ↓ left-aligned, one connected block
┊
├─● /memory recall                      ✓ done (1.2s)
│  │ 84% confidence · 2 results
│  └─ "SPARTA extraction fails..."      ← collapsible detail
│     → "Flatten hierarchy..."
│     BM25 ████████░░ 0.92
│     Graph █████░░░░░ 0.70
┊
├─  "Based on memory, we've hit this    ← agent text flows in the timeline
│   before. Applying both patterns..."   (not separate from the chain)
┊
├─● /dogpile                            ✓ done (4.8s)
│    Researching CMMC Level 2...
│    12 results from Brave, ArXiv
┊
├─● /extract-controls                   ✓ done (2.1s)
│    Extracted 110 NIST 800-171 controls
┊
├─● /scillm                            ● running...
│    Synthesizing claims from evidence   ← pulse animation
┊
└─○ /memory learn                       ○ pending
     Storing evidence case               ← dimmed, waiting
```

## Animation Requirements

When each step appears:

1. **Fade-slide-in**: New step fades in from slight Y offset (6px up) over 250ms
2. **Connector grows**: The dashed vertical line extends to reach the new step (height transition)
3. **Running pulse**: Active step's status dot pulses blue (opacity 1 → 0.5 → 1, 1.2s loop)
4. **Completion settle**: When step finishes, dot transitions from blue pulse to green check (200ms color+scale transition). A brief scale-up (1.1x) then settle to 1x.
5. **Text streaming**: Agent text content appears character-by-character or word-by-word in the text blocks (like ChatGPT/Claude streaming)
6. **No jank**: Use CSS transitions and `will-change: transform, opacity`. No layout shifts — new steps append at the bottom, never reflow existing content.

## What Each Step Type Looks Like

### Skill step (with status)
- Left: status dot (22px circle, color by status)
- Center: skill badge (blue, monospace) + summary text (dim) + optional detail
- Right: duration (mono, dim)
- Collapsible: click to show detail output

### Recall step (special variant of skill)
- Same as skill step but with:
  - Confidence badge instead of duration
  - Collapsible results list with score bars
  - Green left-border on the results

### Text step (agent reasoning)
- No status dot — just flowing text in the timeline
- Slightly indented to align with skill step content
- Uses Inter font at 15px (readable, not military)

### Pending step
- Dimmed status dot (○)
- Dimmed text
- No duration (hasn't started)

## Colors (NVIS)
- Done: #00ff88 (green)
- Running: #4a9eff (blue) with pulse
- Failed: #ff4444 (red)
- Pending: #334155 (muted)
- Skill badge: #4a9eff on rgba(74,158,255,0.1)
- Connector: #00ff88 at 25% opacity, dashed (4px dash, 4px gap)
- Text: #e2e8f0 (Inter, 15px)
- Summary: #64748b (Inter, 11px)
- Duration: #334155 (JetBrains Mono, 9px)

## Stitch Project
Add as new screen to: https://stitch.withgoogle.com/projects/14053463581115336829

## Variations
1. **TIMELINE**: Vertical dashed line with dots (described above)
2. **INDENT**: No connector line, just progressive indentation per depth level
3. **CARD-STREAM**: Each step is a mini-card that slides in from the left

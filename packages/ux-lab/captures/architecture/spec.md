# Architecture Editor — Stitch Design Spec

**Device**: desktop

## What This Is

Visual architecture diagram editor where a human and AI agent co-edit system pipeline diagrams. Solves the problem of agents hallucinating architecture by providing a shared visual source of truth that persists across sessions.

## The User

Graham — data scientist and agentic researcher. Draws pipeline diagrams (boxes with labels, arrows showing data flow) to communicate system architecture to AI agents. Needs version history so he can see what the agent changed.

## Real Data

Architecture being edited: "QuerySpec Omnibar Pipeline"
- 5 pipeline stages as boxes: Intent Classifier → /extract-entities → /recall → SFT Model → /execute-queryspec
- Each box shows: name, tech (e.g. "FlashText + AQL"), latency ("<50ms")
- Arrows between boxes labeled with data: "action: UI_COMMAND", "entities: [...]", "QuerySpec JSON"
- Version list: v3 (current, 2026-03-25), v2 (2026-03-24), v1 (2026-03-23)
- Change attribution: "Graham drew boxes", "Agent added latency annotations"

## Layout

```
+--[ versions ]--+--[ toolbar: select|rect|arrow|text ]----------+--[ details ]--+
| v3 (current)   |                                                | Component:    |
|   Mar 25 👤+🤖 |   ┌──────────┐    ┌──────────┐                | /extract-ent  |
| v2             |   │ Intent   │───→│ Extract  │                | Tech: Flash...|
|   Mar 24 👤    |   │Classifier│    │ Entities │                | Latency: <50ms|
| v1             |   └──────────┘    └────┬─────┘                | Files:        |
|   Mar 23 🤖    |                        │                       |  entity_ext.py|
|                |                        ▼                       |  trace.py     |
|                |              ┌──────────────┐                  |               |
|                |              │   /recall    │                  | Edges:        |
|                |              │ BM25+Cosine  │                  |  → SFT Model  |
|                |              └──────┬───────┘                  |  ← Classifier |
|                |                     │                          |               |
|                |                     ▼                          +---------------+
|                |            ┌─────────────────┐                                 |
|                |            │  SFT Model 7B   │                                 |
|                |            │ queryspec-v3-sft │                                 |
|                |            └────────┬────────┘                                 |
|                |                     │                                           |
|                |                     ▼                                           |
|                |          ┌───────────────────┐                                  |
|                |          │/execute-queryspec  │                                  |
|                |          │  deterministic     │                                  |
|                |          └───────────────────┘                                  |
|                |                                                                 |
+----------------+--[ version timeline: v1 ──── v2 ──── v3 (now) ]───────────────+
```

## Tone / Aesthetic Direction

Excalidraw-meets-Figma inside a dark tactical HUD. The canvas is freeform like Excalidraw (hand-drawn feel optional). The chrome around it (versions sidebar, details panel, toolbar) is NVIS tactical like the rest of UX Lab.

## Design System

- Background: #141414
- Surface: #1a1a1a
- Text: #e2e8f0
- Accent: #7c3aed (purple)
- Success: #00ff88 (green)
- Fonts: Space Grotesk (headlines), JetBrains Mono (code/details)
- 0px border radius everywhere (tactical aesthetic)

## What NOT To Create

- No flowchart-specific tool (Mermaid, draw.io) — this is freeform like Excalidraw
- No file browser / code editor — the details panel shows metadata, not source code
- No chat interface — this is a drawing tool, not a conversation
- No rounded corners or card-based layout

## Variations

1. **Excalidraw-dominant**: Full canvas with floating toolbars, versions as a collapsible drawer
2. **Split-panel**: Fixed left versions + center canvas + fixed right details (like Figma)
3. **Timeline-first**: Version timeline prominent at top, canvas below, details on hover

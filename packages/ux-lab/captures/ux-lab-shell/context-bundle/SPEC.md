# UX Lab Shell — Design Context Bundle

## Stitch Project
https://stitch.withgoogle.com/projects/7213899944986005492

## What to Build
A desktop IDE-like shell for design-to-code projects. VS Code-style collapsible project sidebar on the left, active project content on the right.

## Files in This Bundle

| File | Purpose |
|------|---------|
| DESIGN.md | EMBRY NVIS design system (colors, typography, spacing) |
| initial-mockup.png | Stitch's first attempt at the shell layout |
| reference-stem-viewer.png | Graham's approved S03 stem viewer (quality bar) |
| reference-lyrics-editor.png | S04 lyrics editor with phonetic popover |
| reference-s00-thought.png | S00 thought stage with heart taxonomy |

## Projects the Shell Hosts
- SPARTA Explorer (8 tab views — existing)
- Music Lab Pipeline (10 stages — new)
- Prompt Lab (eval + optimize views — existing)

## Each Project Shows
- 🎨 Mockups — screenshot grid of approved designs
- 🧩 Components — React file list with build status
- 📋 Design Board — iteration rounds with comparison PNGs
- ✅ Reviews — VLM visual diff (mockup vs implementation)

## Key Design Directions
- Collapsible sidebar (240px → 48px icon rail)
- Dark theme NVIS: #141414 bg, #1a1a1a cards, #7c3aed accent
- Thin stroke SVG icons (not emoji)
- Status badges: green=approved, amber=draft, red=needs review

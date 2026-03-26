# Prompt Lab Eval Table Redesign

## Current Problems
- Pass/Fail icons with no actual/expected diff
- Massive horizontal spacing wastes screen
- No confidence scores or partial success
- System prompt well too small
- No frozen columns on scroll

## Target Format (CSV-style dense table)
```
Prompt / Test Case,Expected Tags,Qwen-1.7b,Qwen-7b,Qwen-8b
Registry Run Keys,"Persist, Registry",❌ None,✅ Pass,✅ Pass
SQL Injection,"Injection, Input",✅ Pass,✅ Pass,✅ Pass
Clear Event Logs,"Evasive, Stealth",❌ Stealth,⚠️ Partial,✅ Pass
Account Mgmt,"Loyalty, Harden",❌ User,✅ Pass,✅ Pass
```

## Key Requirements
- Show WHAT the model actually returned (not just pass/fail)
- ⚠️ Partial for near-misses
- ❌ shows what was wrong ("None", "Stealth" = what it returned instead)
- Dense layout — scale to 10+ models horizontally
- Sticky first column on scroll
- Diff view: expected vs actual tags highlighted
- System prompt well needs to be full-width, scrollable, showing the actual prompt text
- Confidence heatmap coloring (green→yellow→red gradient, not binary)

## File: PromptLabView.tsx
Location: packages/ux-lab/src/components/sparta/explorer/PromptLabView.tsx

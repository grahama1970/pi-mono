# LLM Eval Lab — Model Evaluation Dashboard

## Context
A utility app for evaluating LLM models against ground truth test cases.
The user picks a ground truth file + threshold, runs models smallest-to-largest,
and sees which model is cheapest/fastest while meeting accuracy requirements.

This is NOT a complex analytics dashboard. It is a clear, focused utility tool.
Think VS Code terminal panel or Postman — functional, dense, developer-focused.

## Theme (NVIS MIL-STD-3009 Dark)
- Background: #0b1220
- Surface: #111827
- Border: #1e293b
- Text primary: #e2e8f0
- Text secondary: #94a3b8
- Accent purple: #7c3aed
- Green (pass): #00ff88
- Red (fail): #ff4444
- Yellow (warn): #fbbf24
- Font: Inter or system-ui, monospace for data

## Layout: 3-Pane Horizontal

### Left Pane (25%) — Configuration
- **Ground Truth selector**: dropdown of available .json files
- **Threshold slider**: 0.50 — 1.00 with current value displayed (e.g., "80%")
- **Model filter**: toggle buttons for "Local" / "API" / "All"
- **System prompt**: optional textarea (collapsed by default, expandable)
- **Cost estimation** section (collapsed):
  - Batch size input (default 90,000)
  - Avg input/output tokens
- **[Run Find-Minimum]** button — purple accent, prominent
- **[Compare Models]** button — secondary, outline style

### Middle Pane (25%) — Model Registry
- Table showing available models sorted by params_b:
  - Columns: Alias | Size | Provider | JSON | Caps
  - Example rows:
    - qwen3:1.7b | 1.7B | ollama | Y | -
    - qwen2.5-coder:7b | 7B | ollama | Y | code
    - qwen3:8b | 8B | ollama | Y | reason, think
    - deepseek | 671B | chutes | Y | reason, code, F1:0.93
  - Rows are checkable to select which models to compare
  - Green highlight on the row that passes threshold (the "winner")
  - Red rows for models that failed
  - Gray/dim rows for untested models

### Right Pane (50%) — Results
- **Status bar** at top: "Testing qwen3:8b (3/7)..." with progress indicator
- **Results table** (grows as models are tested):
  - Columns: Model | Size | Provider | JSON% | Action% | Time | Status
  - Green row = PASS, red = FAIL
  - The first PASS row gets a star/badge: "RECOMMENDED"
- **Cost comparison table** (shown after winner found, if --with-cost):
  - Provider | Model | In $/M | Out $/M | Est. Cost | Est. Time
  - Cheapest row highlighted green
- **Winner banner** at bottom:
  - "RECOMMENDED: qwen3:8b (8B, ollama) — 87% accuracy, $0.00/batch"
  - Or: "No model met 80% threshold" in red
- **Judge verdict** section (when using judge command):
  - Side-by-side output comparison
  - Meta-model verdict with reasoning

## Key Interactions
- Selecting a ground truth file auto-loads its test cases count
- Running find-minimum disables controls, streams results row-by-row
- Clicking a model row in results expands per-case details
- Winner row is always visible (pinned/scrolled into view)

## What NOT To Create
- No tabs — everything visible at once in 3 panes
- No charts or visualizations — this is a data table tool
- No drag-and-drop or complex interactions
- No sidebar navigation
- Not a marketing page — this is a developer tool

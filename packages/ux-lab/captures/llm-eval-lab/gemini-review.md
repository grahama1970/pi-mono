# Gemini Design Review — LLM Eval Lab

Alright, let's get into this. You've got a solid foundation with the NVIS theme and a clear purpose: finding the smallest LLM. That's a focused utility, not a dashboard, which I appreciate. But right now, it's a bit of a sprawl. We need to tighten it up, make it more intentional, and ensure every pixel works for the developer.

Here are three takes, from a light polish to a full rethink, keeping the developer's workflow and density in mind.

---

## Take A: Minimal Changes (Polish & Refine)

This take assumes we keep the current general layout (config on left, models/results on right, with model selection at the top), but we fix the glaring issues with spacing, alignment, and hierarchy.

### 1. What's working
*   **Theme Adherence:** The NVIS MIL-STD-3009 dark theme is generally followed, with good base colors.
*   **Core Functionality:** The System Prompt, Test Cases selector, Threshold slider, and Run button are present and functional.
*   **Immediate Feedback:** The per-case pass/fail/partial indicators are clear at a glance.
*   **Model Checkboxes:** A quick way to select models for evaluation.
*   **Overall Density:** There's a good amount of information on screen, which is suitable for a developer tool.

### 2. What's not working
*   **Pane Definition:** The 3-pane layout specified is not visually distinct. The "Configuration" pane bleeds into the "Models/Results" area without clear separation, and the "Model Registry" isn't a dedicated pane or table.
*   **Information Hierarchy & Grouping:**
    *   The `CONFIGURATION` heading is too large and visually disconnected from its content.
    *   The `SYSTEM PROMPT` heading and `Test Cases` are too close to their respective content, lacking breathing room.
    *   The model selection (`MODELS (3/6)`) feels like a floating element, not clearly part of a pane or distinct section.
    *   The `Test Case`, `Expected`, and model result columns are merged into one giant table, making it hard to mentally separate the input (test cases) from the outputs (model results). The `Expected` column is visually weak.
    *   The "Totals" row is important but gets lost at the bottom.
*   **Spacing & Alignment:**
    *   Inconsistent vertical spacing throughout. Elements are often either too cramped or too far apart.
    *   Horizontal alignment issues, especially between `Test Case` descriptions and their `Expected` values.
    *   The `Run` button feels a bit lonely and could be better aligned.
    *   `Test Case` descriptions are truncated, forcing horizontal scrolling or mental effort.
*   **Typography & Contrast:**
    *   `Test Case` descriptions are small and low-contrast (`text-secondary` on `surface` is fine, but the size makes it harder).
    *   `Expected` tags are too dark and blend into the background. They should stand out as key ground truth.
    *   The provider tags (`local`, `openai`, `chutes`) have inconsistent styling (some are light on dark, some dark on light) and contrast.
    *   The threshold `75%` is small.
*   **Missing Elements (from spec):** Model filter buttons (`Local`/`API`/`All`), Cost Estimation section, Compare Models button, and the explicit Model Registry *table* are absent.

### 3. Concrete changes

*   **Pane Separation:**
    *   Introduce a subtle vertical border (`border: #1e293b`) to clearly separate the Left Pane (Configuration) from the combined Middle/Right Pane.
    *   Add a horizontal border (`border: #1e293b`) below the model selection/threshold/run button row to delineate the "configuration" of the run from the "results" grid.
*   **Left Pane (Configuration):**
    *   **Heading:** Change `CONFIGURATION` to `EVALUATION SETTINGS`. Use `text-primary`, `font-semibold`, and a slightly smaller size (e.g., `text-lg` instead of `text-2xl`). Give it more top/bottom padding.
    *   **System Prompt:** Increase vertical padding around the `SYSTEM PROMPT` heading and the textarea. Use a slightly lighter border (`#1e293b`) for the textarea. Implement the "collapsed by default" functionality.
    *   **Test Cases:** Ensure `taxonomy (demo)` dropdown and `8 cases` are vertically aligned and have consistent horizontal padding.
    *   **Model Filters:** Add the `All` / `Local` / `API` / `Clear` toggle buttons *above* the model checkboxes, as specified. Style them as small, secondary buttons.
    *   **Cost Estimation:** Add a collapsed section for `Cost Estimation` below System Prompt.
    *   **Action Buttons:** Move the `Run` button to the bottom of the Configuration pane, making it more prominent (`accent-purple` background, `text-primary`). Add the `[Compare Models]` button next to it, styled as a secondary outline button.
*   **Right Pane (Models & Results):**
    *   **Model Selection:**
        *   Align `MODELS (3/6)` heading with the left edge of the model checkboxes.
        *   Make model checkboxes more compact. Ensure provider tags (`local`, `openai`, `chutes`) are consistently styled as small, subtle secondary text or small badges with consistent colors (e.g., `text-secondary` on `surface` or `border` background).
        *   Align the threshold slider and `75%` value better. Make `75%` `accent-purple` and `font-bold`.
    *   **Results Grid Headings:**
        *   `Test Case` column: Give it more width to prevent truncation. Use `text-primary` for the main title, `text-secondary` for the description.
        *   `Expected` column: Use a distinct `surface` background for the tags (e.g., a darker shade of `#111827` or a lighter shade of `#0b1220`) with `text-primary` for the actual tags, making them more legible.
        *   Model column headers (`qwen3:1.7b`):
            *   Model name (`qwen3:1.7b`): `text-primary`, `font-bold`.
            *   Size/Provider (`1.7B · local`): `text-secondary`, smaller font.
            *   Percentage (`25%`): `font-bold`, colored with `red`/`green`/`yellow` as appropriate.
            *   The winner star (`⭐`) should be a small badge next to the percentage or model name, not floating.
    *   **Results Grid Rows:**
        *   Add subtle horizontal dividers (`border: #1e293b`) between each test case row to improve readability.
        *   Ensure `Partial` status uses `yellow` (`#fbbf24`) for its icon and text.
        *   **Totals Row:** Give the `Totals` row a slightly darker `surface` background (`#101622` if available, or just a thicker top border) to visually separate it. Ensure percentages are colored correctly.
    *   **Missing Result Elements:** Add a placeholder for the `Status bar` (e.g., "Ready to run" or "No models selected") at the top of the results area.

---

## Take B: Layout Restructure (Better Information Architecture)

This take strictly adheres to the specified 3-pane layout, dedicating each pane to a distinct functional area: Configuration, Model Registry, and Results. This will require significant rearrangement.

### 1. What's working
*   The core components (System Prompt, Test Cases, Threshold, Models, Results) are all present.
*   The overall goal of finding the minimum model is clear.
*   The NVIS dark theme is a strong foundation.

### 2. What's not working
*   **Fundamental Layout Mismatch:** The current implementation *does not* follow the 3-pane horizontal layout (25% | 25% | 50%). The "Model Registry" (middle pane) is entirely missing as a distinct table, and its function is currently crammed into a horizontal list at the top of the "results" area.
*   **Redundant Information:** Model names, sizes, and providers are duplicated between the selection area and the result column headers.
*   **Scalability Issues:**
    *   The horizontal model selection becomes unwieldy with many models.
    *   The per-case results grid, if always shown, will become extremely wide and require excessive horizontal scrolling as more models are selected.
*   **Workflow Disconnect:** The "registry" of *all* models isn't clearly separate from the *selected* models being evaluated.
*   **Missing Spec Elements:** The explicit `Model Registry` table (Alias, Size, Provider, JSON, Caps), the `Status bar`, `Cost comparison table`, `Winner banner`, and `Judge verdict` sections are absent or not clearly defined.

### 3. Concrete changes

*   **Strict 3-Pane Horizontal Layout:**
    *   Implement three distinct vertical panes with clear borders (`border: #1e293b`).
    *   Pane 1 (Left, 25%): Configuration.
    *   Pane 2 (Middle, 25%): Model Registry (a *table* of all available models).
    *   Pane 3 (Right, 50%): Results (focused on aggregate scores and winner).

*   **Left Pane (25%) — Configuration:**
    *   **Heading:** `EVALUATION SETTINGS` (`text-primary`, `font-semibold`, appropriate size).
    *   **Content:**
        *   `Ground Truth selector` (the `taxonomy (demo)` dropdown) and `8 cases` count.
        *   `Threshold slider` with `75%` display (`accent-purple`, `font-bold`).
        *   `Model filter` toggle buttons (`Local` / `API` / `All`) to filter the *Middle Pane's* registry.
        *   `System prompt` (collapsed by default).
        *   `Cost estimation` section (collapsed by default).
        *   **Action Buttons (at bottom):** `[Run Find-Minimum]` (prominent, `accent-purple`) and `[Compare Models]` (secondary, outline style).

*   **Middle Pane (25%) — Model Registry:**
    *   **Heading:** `AVAILABLE MODELS (X/Y)` (`text-primary`, `font-semibold`).
    *   **Content:** A scrollable table of *all* available models, sorted by `params_b` (size).
        *   **Columns:** `Checkbox | Alias | Size | Provider | JSON | Caps`.
        *   **Rows:**
            *   `qwen3:1.7b | 1.7B | ollama | Y | -`
            *   `qwen2.5-coder:7b | 7B | ollama | Y | code`
            *   `qwen3:8b | 8B | ollama | Y | reason, think`
            *   `deepseek | 671B | chutes | Y | reason, code, F1:0.93`
            *   `gpt-4o | 200B | openai | Y | -`
            *   `gemini-flash | 5B | google | Y | -`
        *   **Visual Cues:**
            *   Rows are checkable to select models for evaluation.
            *   Post-run, the row corresponding to the "winner" (from the Right Pane) gets a subtle green highlight (`green` as a light background tint).
            *   Rows for models that failed to meet the threshold (if tested) could have a red highlight.
            *   Untested models remain standard.

*   **Right Pane (50%) — Results:**
    *   **Heading:** `EVALUATION RESULTS` (`text-primary`, `font-semibold`).
    *   **Status Bar (at top):** `Testing qwen3:8b (3/7)...` with a slim progress indicator (e.g., a progress bar below the heading).
    *   **Results Table:** This table shows results *only for the models selected in the Middle Pane and run*.
        *   **Columns:** `Model | Size | Provider | JSON% | Action% | Time | Status`.
        *   **Rows:** Appear as models are tested.
            *   Green row = PASS (`green` background tint).
            *   Red row = FAIL (`red` background tint).
            *   The first PASS row gets a "RECOMMENDED" badge/star.
        *   **Interaction:** Clicking a model row here *expands* to show the per-case details (the `Test Case`, `Expected`, `Actual`, `Status` grid, replacing the current always-visible grid). This keeps the main results pane clean.
    *   **Cost Comparison Table (below results):** `Provider | Model | In $/M | Out $/M | Est. Cost | Est. Time`. Highlight the cheapest row with `green`.
    *   **Winner Banner (at bottom):** Prominent, e.g., "✨ RECOMMENDED: qwen3:8b (8B, ollama) — 87% accuracy, $0.00/batch" in `text-primary` on a slightly contrasting `surface` background. Or "No model met 80% threshold" in `red`.
    *   **Judge Verdict Section:** Collapsible, shown below the winner banner if applicable.

*   **
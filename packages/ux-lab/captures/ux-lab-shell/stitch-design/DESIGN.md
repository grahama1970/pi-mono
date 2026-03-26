# Design System Document: Tactical Information Architecture

## 1. Overview & Creative North Star

### Creative North Star: "The Tactical HUD"
This design system moves away from the "friendly" softness of modern SaaS and toward the high-stakes, high-contrast environment of military aviation. Inspired by **NVIS MIL-STD-3009**, the system prioritizes legibility under duress, functional color-coding, and a zero-latency aesthetic.

We break the "template" look through **Intentional Asymmetry**. Navigation is anchored to rigid vertical axis, while data visualizations and content cards utilize tonal shifts to "float" without the use of primitive drop shadows. This creates a signature "glass-cockpit" feel—technical, authoritative, and unapologetically premium.

---

## 2. Colors

### The Tactical Palette
The palette is built on deep, obsidian-like foundations to ensure that functional neon accents "pop" with maximum luminance.

*   **Background (Surface):** `#141414` – The base void.
*   **Panel (Surface-Low):** `#111111` – Structural sidebars or headers.
*   **Card (Surface-High):** `#1a1a1a` – Interactive containers.
*   **Inset (Surface-Lowest):** `#0b1220` – Deep wells for code or data inputs.

### Functional Tokens (NVIS Verified)
*   **Primary/Interactive:** `#7c3aed` (Accent) – Used for selection and focus.
*   **Success:** `#00ff88` – System "Go" and active states.
*   **Danger:** `#ff4444` – Critical errors or destructive actions.
*   **Warning:** `#ffaa00` – Cautions and state transitions.
*   **Info:** `#4a9eff` – Non-critical telemetry.

### The "No-Line" Rule
**Prohibit 1px solid opaque borders for sectioning.** Boundaries are defined by background shifts (e.g., a Card `#1a1a1a` sitting on a Background `#141414`). If a boundary is visually required, use the **Ghost Border**: `rgba(255,255,255,0.13)` at 1px.

---

## 3. Typography

The typographic hierarchy is a dialogue between brutalist geometry and functional clarity.

*   **Display & Headlines (Space Grotesk):** High-character, wide-set geometry. Used to command attention. 
    *   *Scale:* 1.5rem to 3.5rem.
*   **Body & UI (Inter):** Neutral, highly legible sans-serif for descriptions and labels.
    *   *Scale:* 0.75rem to 1.125rem.
*   **Telemetry & Data (JetBrains Mono):** **Mandatory for all numbers.** The monospaced nature prevents "jumping" during real-time data updates and reinforces the tactical aesthetic.

---

## 4. Elevation & Depth

We reject the traditional "shadow-up" philosophy. In this system, depth is **Tonal & Subtractive.**

### Tonal Layering
Depth is achieved by "stacking" surface tiers.
1.  **Level 0 (Base):** Background `#141414`.
2.  **Level 1 (Subtractive):** Inset `#0b1220` for data fields (feels "etched" into the screen).
3.  **Level 2 (Additive):** Card `#1a1a1a` (feels "raised" via lightness, not shadow).

### The Glassmorphism Rule
For floating elements (modals, tooltips, or top-level navigation), use:
*   **Background:** `rgba(26, 26, 26, 0.8)`
*   **Backdrop-blur:** `12px`
*   **Border:** `1px solid rgba(255, 255, 255, 0.13)`
This creates a "frosted HUD" effect that integrates with the underlying telemetry rather than obscuring it.

---

## 5. Components

### Buttons
*   **Primary:** Background `#7c3aed`, Text `#e2e8f0`. Hard 0px corners.
*   **Tactical (Active):** Background `#00ff88`, Text `#111111` (Black). Use for "Deploy" or "Submit" actions.
*   **Ghost:** Transparent background, `1px solid rgba(255,255,255,0.13)`.

### Input Fields
*   **Style:** Background `#0b1220` (Inset). 
*   **State:** On focus, the border shifts from `rgba(255,255,255,0.13)` to `#7c3aed`.
*   **Data:** Use JetBrains Mono for all user-inputted text.

### Progress Bars & Gauges
*   **Visuals:** No rounded caps (0px radius). 
*   **Segmented:** Use vertical gaps to show "steps" rather than a smooth fill, mimicking old-school hardware LEDs.

### Cards & Lists
*   **NO DIVIDERS.** Use a 1.75rem (Token 8) vertical gap to separate list items. 
*   **Selection:** Active list items should use a thick (4px) vertical left-accent in `#7c3aed` rather than a full background fill.

---

## 6. Do’s and Don’ts

### Do
*   **Use JetBrains Mono for ALL numbers.** This is non-negotiable for the HUD aesthetic.
*   **Embrace negative space.** High-contrast layouts require room to breathe to avoid visual "noise."
*   **Use thin-stroke SVG icons.** Icons should look like technical schematics, not filled illustrations.

### Don't
*   **Don't use Border Radius.** This system is 0px across the board. Roundness implies "consumer friendly"; we are "mission critical."
*   **Don't use standard drop shadows.** Use background color shifts and backdrop blurs only.
*   **Don't use low-contrast text.** secondary text must never drop below `#64748b` to ensure NVIS-level legibility.
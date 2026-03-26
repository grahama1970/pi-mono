My goal here was to create a high-density, immediately scannable view that feels like a professional audio tool, not a decorative chart. It needs to sit comfortably next to the piano roll, so I used the same dark theme and color language.

- **Layout & Typography:** I went with a single card (`#1a1a1a`) on the deep-space background (`#0b1220`). It’s clean. The header contains the track title and the stem toggles, keeping controls close to the context. I'm using our standard system font, but I've chosen a monospace for the lyric overlays because timing is key, and character width matters there.

- **Waveform:** I chose a single, smooth path (`<path>`) instead of a series of bars. It's less noisy and gives a clearer sense of the audio's dynamic contour. I’m only showing the vocal stem by default, using the purple `--accent` color, because it’s usually the primary focus. This keeps the initial view clean. The other stems can be toggled on.

- **Data Layers & Hierarchy:** This is where the design does the heavy lifting. The information is layered visually to prevent a chaotic mess:
    1.  **Background:** The faintest layer is the section markers (`Intro`, `Verse`). The alternating light/dark background fill (`rgba(255,255,255,0.02)`) provides structure without being distracting. The labels are at the top, out of the way.
    2.  **Waveform:** The most prominent visual element, centered vertically.
    3.  **Timing Grid:** This is the critical part. I intentionally separated the "expected" and "actual" beats.
        -   *Expected beats* (from the piano roll) are subtle, thin white markers at the *bottom* of the view. They are the ground truth, the grid.
        -   *Actual beats* (from analysis) are sharp, NVIS green (`#00ff88`) markers at the *top*. Placing them at the top makes them easy to spot and compare against the bottom grid. The green is our "pass" or "nominal" color, so you see where things are correct.
    4.  **Drift Highlights:** The problem areas. I'm using colored `rects` with low opacity (`0.15` to `0.2`) to create a "highlight" effect over the affected region. The color signals severity: amber for medium drift, red for high. I've also added connecting lines to explicitly link the expected beat to the actual, drifted beat, which makes the time-shift obvious. The red line is solid and thicker because it's a critical error.
    5.  **Lyrics:** These are placed at the bottom, near the expected beat grid, with small tick marks showing the exact start of the word. They're in the `--text-dim` color so they don't fight with the waveform.

- **Controls:** The stem toggles are designed as pills. The `active` state has a subtle background and a colored border matching the instrument. This is more space-efficient than checkboxes and feels more integrated. The color dot provides a quick reference that links back to the colors used in the piano roll.

I think this layering approach makes the complex data digestible. You see the overall shape first, then the green markers show you the rhythm, and finally, the red/amber zones draw your eye to the specific problems that need fixing.
This iteration directly addresses Nico's feedback from Round 1. My goal was to resolve all blocking issues while improving the overall clarity and utility of the chart.

1.  **[FIXED] Legend (`HIGH`):** I've added a legend in the top-right corner. It's compact and clearly maps each NVIS color to its corresponding data dimension. This was the most critical fix for discoverability.

2.  **[FIXED] Tooltip & Data Integrity (`HIGH` / `MEDIUM`):** I designed the hover interaction, mocking it up over 'Round 2' for clarity.
    *   A vertical line indicates the currently hovered "round".
    *   A tooltip appears, providing a detailed breakdown of scores for that round.
    *   Crucially, for `timing_drift_ms`, the tooltip now displays both the normalized value used for the Y-axis (`0.30`) and the raw source value in parentheses (`30ms`). This resolves the data integrity concern by providing full context without compromising the unified Y-axis. The aggregate score is given prominence at the top of the tooltip.

3.  **[FIXED] Line Visibility (`MEDIUM`):** I've increased the `stroke-width` of all data lines to `2px` (and the aggregate to `3px`). This makes them thicker than the `1px` grid lines, ensuring the `key_match` line is clearly visible even when its value is `0.0`.

4.  **[FIXED] Dynamic Threshold (`LOW`):** I added a text label, "Threshold 0.3", next to the dashed line. This makes it clear that the threshold is a specific, likely configurable, value and not just an arbitrary line.

I believe these changes resolve all of Nico's points from the first round. The chart is now far more informative and directly usable. The tooltip design provides a clear path for implementation and handles the data normalization issue elegantly.

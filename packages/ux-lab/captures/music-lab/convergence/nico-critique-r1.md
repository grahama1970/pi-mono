Here's a review of the `mockup-r1.html` for the ConvergenceChart component.

The design has a strong foundation and aligns well with the NVIS aesthetic, but there are several critical issues related to data clarity and discoverability that prevent it from being usable.

### Findings

| Severity | Category | Description & Suggestion |
| :--- | :--- | :--- |
| **HIGH** | Data Integrity | **Description**: The 'timing_drift_ms' dimension is normalized against an assumed maximum, which is not documented and makes the chart misleading. **Suggestion**: The normalization must be explicit. Most importantly, the hover tooltip must show the raw value (e.g., '15ms') to provide full context. |
| **HIGH** | Discoverability | **Description**: The chart is missing a legend, making it impossible to know what each colored line represents. **Suggestion**: A legend is essential. Add one to map colors to dimension names. |
| **MEDIUM** | Accessibility | **Description**: The 'key_match' line, at a constant 0.0, is visually indistinguishable from the bottom axis line. **Suggestion**: The data line needs to be visually distinct even at zero, perhaps by ensuring it draws on top of the axis and is slightly thicker than grid lines. |
| **MEDIUM** | Interaction | **Description**: The hover tooltip, a key requirement, has not been designed. **Suggestion**: A mockup of the tooltip is needed to understand how a user will inspect the data points in detail. |
| **LOW** | Component API | **Description**: The convergence threshold is hardcoded. This should be a dynamic property. **Suggestion**: Add a label to the threshold line (e.g., 'Threshold: 0.3') to imply it's a configurable value. |

### Conclusion

The design is not ready for implementation. The two HIGH-severity issues (missing legend, misleading data normalization) must be addressed. I recommend a second round focusing on adding the legend and designing the tooltip interaction, which will also provide a natural place to solve the data normalization problem.

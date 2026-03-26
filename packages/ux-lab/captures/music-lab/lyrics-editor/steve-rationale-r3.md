
This round is about convergence. I've focused on directly addressing Nico's final critiques from R2 to create a design that is robust, scalable, and prioritizes direct manipulation.

1.  **Horizontally Scrolling Timeline (Addresses R2-MED-01)**: This was the main blocker. I've now wrapped the entire timeline (header and rows) in a container (`.timeline-container`) with `overflow-x: auto`. I've also expanded the `beat-ruler` and `syllable-timeline` to be much wider than the container (simulating an 8-bar section) to demonstrate how horizontal scrolling would work. The beat ruler is now `sticky` so it stays visible as you scroll down through multiple phrases. This visually confirms the design's scalability for longer musical sections.

2.  **Direct-Manipulation Editing (Addresses R2-LOW-01, R2-LOW-02)**: I've removed the separate "Properties Panel" and integrated its functionality directly into the syllable components, as Nico suggested.
    *   **Interactive Dynamics**: The `dynamics` badge now has a hover effect and a `cursor: pointer`, clearly indicating it's clickable. The `title` attribute "Click to cycle dynamics" makes the interaction explicit. This is much faster than editing in a separate panel.
    *   **Syllable Text Editing**: I've added a hover state to the `.syllable-text-label` and a `title` attribute "Double-click to edit". This provides the explicit affordance for manual syllabification correction that was missing. I've reverted the main phrase text to be a non-editable label (`.phrase-text-display`) to simplify the editing model: you edit syllables directly, and the phrase text above is a reflection of that. This feels more aligned with the tool's purpose.

3.  **Structured Direction Input (Addresses R2-LOW-03)**: I've replaced the free-form text input for vocal direction with a `.direction-dropdown`. This uses the same pattern as the `emotion` selector, ensuring data consistency and a more guided user experience. I've placed it directly above the syllable it applies to, making it clear and contextual.

By solving the scrolling issue and moving all editing controls to be directly on the elements they manipulate, I believe this design is now far more elegant, intuitive, and technically sound. It resolves the final MEDIUM-severity issue and all LOW-severity issues. This should be ready for approval.

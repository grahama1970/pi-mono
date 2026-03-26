
For my first pass on the LyricsEditor, I focused on establishing a clear, data-dense, and functional foundation using our EMBRY design system. My goal was to make it feel like a specialized production tool, not a word processor.

1.  **Core Structure & Hierarchy**: I've used a dark theme (`#0b1220` background, `#1a1a1a` for the main editor card) to create a focused environment suitable for a studio setting. I established a clear hierarchy: large section headers ("Verse 1"), followed by phrase rows, which contain the syllable-level details. This top-down structure should make the song easy to parse.

2.  **Phrase as a "Unit"**: Each phrase is contained in its own row with a subtle background, treating it as a distinct editable block. I've placed the phrase-level `emotion` control (as a dropdown) on the left, clearly associating it with the entire phrase that follows. This keeps the primary interaction area—the syllable track—uncluttered.

3.  **Syllable Granularity & Interaction**: This is the core of the editor. I designed each syllable as a distinct "chip." The syllable text is prominent, with the beat timing and dynamics annotation sitting below it. I used a color scale for dynamics (from blue for `pp` to red for `ff`) to make them quickly scannable. The `direction` tag (e.g., "whisper") is styled like a small pill above the syllable to save vertical space but remain noticeable. Hovering on a syllable provides a visual affordance, indicating it's an interactive element.

4.  **Rhythm & Timing**: The `syllable-track` is where the musicality comes in. While the `left: X%` positioning is just a stand-in for real beat-based positioning, the intent is to visually represent the rhythmic placement of each word. The vertical line on the left of the track is a subtle nod to a timeline or the start of a measure.

5.  **Controls & Actions**: The "Add Phrase" button is styled as a dashed block at the bottom, making it a clear, non-distracting dropzone for adding new content.

I believe this initial design provides a strong, scalable structure. It surfaces all the required data points from the JSON schema in a way that prioritizes the producer's workflow: section → phrase → syllable details.

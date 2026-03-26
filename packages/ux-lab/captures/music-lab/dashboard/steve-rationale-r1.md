My goal for the first round was to establish a strong, clear compositional structure that respects the requested proportions and creates a cohesive feel. I'm starting with a dark, focused theme using the EMBRY tokens, which I think is perfect for a data-dense tool like this.

- **Layout & Proportions**: I used CSS Grid to define the main layout. It's perfect for this kind of "holy grail" layout variant. I've set the row heights to match the `40% / 25% / 35%` split requested. The top two panes span both columns, creating a clear hierarchy where the Piano Roll is the primary focus, followed by the Waveform for alignment. The bottom two panes are equal partners. The `16px` gap between all elements provides clear separation without feeling disconnected.

- **Header**: I put all the global controls and metadata in a single header card at the top. This keeps the song's vital stats (Title, Key, BPM) and the convergence status/selector always visible. It frames the workspace. The status indicator uses the NVIS colors for at-a-glance understanding, and I used the accent color for the active round button to draw the eye.

- **Panes**: Each pane is a "card" with a consistent border, radius, and padding. The small, uppercase header inside each pane clearly labels its function without shouting. This modular approach means we can refine the internals of each pane later without breaking the overall dashboard's look and feel.

- **Placeholders & Timeline**: I've added simple, stylized placeholders to show the intent for each pane. The crucial detail is that the horizontal axis represents time across the Piano Roll, Waveform, and even the Lyrics (with the highlighted word). I haven't implemented a literal shared playhead yet, but the composition implies it. The repeating background in the piano roll hints at beat divisions.

I feel this is a solid foundation. It's organized, respects the brand tokens, and establishes a clear visual hierarchy for Graham's workflow.
Alright, I've dug into Nico's feedback from the first round. He was right, it was pretty but not functional enough. This second pass is all about making it a real, usable tool while keeping the aesthetic tight.

Here’s what I changed and why:

1.  **Fixed Un-clickable Notes (HIGH):** This was the biggest problem. Those tiny 4-pixel drum hits were a joke. I attacked this on two fronts. First, every single note in the main piano roll now has a minimum height of `10px`. They can be wider, but never shorter. This immediately makes them selectable. But the bigger move was pulling drums out entirely into their own dedicated **percussion lane** at the bottom. Kick, Snare, Hat — they each get their own row with big, beefy `24px` targets. It’s impossible to miss them now. This cleans up the melodic view and treats rhythmic elements with the respect they deserve.

2.  **You Are Here → The Playhead (HIGH):** Can't believe I missed this. I've added a `2px` amber (`#ffaa00`) playhead, absolutely positioned so it glides over everything else. I gave it a subtle glow to make sure it's the focal point during playback. It's the anchor for the whole view; without it, you're lost. Now, you're not.

3.  **Color is Not Enough (WCAG / HIGH):** Nico was 100% correct about accessibility. Relying on color alone is a rookie mistake. I’ve added SVG fill patterns for each instrument. Bass gets clean horizontal lines, keys get vertical ones, synth and guitar get opposing diagonal hatches. Vocals stay solid since they're the hero element. This not only makes it WCAG compliant but adds a nice, subtle texture that helps distinguish everything even for users with perfect vision. It just feels more professional. The legend is also updated with `12x12` swatches showing these new patterns.

4.  **Seeing the Whole Song (HIGH):** The 8-bar view was claustrophobic. You couldn't see the forest for the trees. I've introduced a **minimap** at the top that shows a high-level view of the entire 64-bar structure. A highlighted window on the minimap shows you which 8 bars you're currently looking at in the main editor. This is standard practice in every DAW for a reason—it gives you context. It also proves the design can scale and implies the `viewport` props Nico was asking for.

5.  **Saner Pitch Labels & Hover States (MEDIUM):** The old pitch labels were sparse and unhelpful. I've replaced them with proper labels for every natural note (C, D, E, etc.) down the side, which is how musicians actually think. The space now feels much more intentionally musical. I also added a simple, clean hover state to all notes—a brightened stroke and a slight glow. It’s a small touch, but it’s the kind of instant feedback that makes an interface feel alive and responsive.

This revision is a massive step forward in usability. It addresses all the critical blockers and the key medium-priority items. It feels less like a static picture and more like an interactive instrument. Let's see what Nico thinks.

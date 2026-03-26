Yes! This is **exactly** how PersonaPlex connects to `/memory`.

By tagging voice models with Federated Taxonomy (Bridge Attributes), we enable **semantic search for voices** and **dynamic text driving**:

## 1. The Bridge (Taxonomy)

1.  **Ingestion**: `voice.py` extracts tags from transcripts (e.g., "Precision", "Resilience").
2.  **Storage**: Tags are saved in `voice_metadata.json` and the Memory Graph.
3.  **Recall**: The system traverses `Query -> Bridge(Resilience) -> Persona -> Voice`.

## 2. Dynamic Text Driving

This allows the **text** to drive the **voice** realistically:

- **Scenario**: The LLM generates a line of dialogue tagged with `{ "intent": "Command", "bridge": "Authority" }`.
- **Dynamic Selection**: PersonaPlex queries the graph for a voice adapter that matches `["Authority", "Resilience"]`.
- **Result**: The character's voice _shifts_ to sound more authoritative for that specific line, rather than using a flat, static embedding.

## 3. Feedback Loop

- **Memory** learns which voices yield better engagement for specific taxonomy tags.
- The system self-optimizes: "Use _Voice A_ for _Intimacy_, use _Voice B_ for _Precision_."

This creates a living, breathing persona that adapts its vocal "posture" to the semantic content of its speech.

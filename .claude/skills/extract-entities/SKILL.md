---
name: extract-entities
description: >
  Extract control IDs, domain phrases, taxonomy tags, and relationship data from question text.
  Composes /memory (hybrid search, control lookup, relationship check) and /taxonomy (bridge attributes).
  Returns structured EntityExtractionResult that defines the shape of evidence cases, conversations,
  and QRA reviews before any LLM runs. Zero LLM cost — pure regex + BM25 + ArangoSearch.
allowed-tools: [Bash, Read]
triggers:
  - extract entities
  - what entities
  - what controls
  - decompose question
  - parse question
metadata:
  short-description: Extract controls, phrases, and relationships from question text
  author: "Horus"
  version: "0.1.0"
provides:
  - entity-extraction
composes:
  - memory
  - taxonomy
---

# /extract-entities

Extract control IDs, domain phrases, control metadata, relationship edges, and taxonomy tags from any question text. The extraction result defines the shape of the evidence tree before any gates or LLM calls run.

## Usage

```bash
# Extract entities from a question
./run.sh extract "What does radar spoofing have to do with SV-AC-2 and CWE-89?"

# Include taxonomy bridge attributes
./run.sh extract --taxonomy "How do NIST 800-171 requirements align with SPARTA defenses?"

# JSON output for piping
./run.sh extract --json "Tell me about Control SV-CF-1 as it relates to D3FEND"
```

## Output

```json
{
  "control_ids": ["SV-AC-2", "CWE-89"],
  "phrases": ["radar spoofing"],
  "phrase_controls": ["SV-CF-1", "SV-CF-3"],
  "all_control_ids": ["CWE-89", "SV-AC-2", "SV-CF-1", "SV-CF-3"],
  "control_metadata": [
    {"control_id": "SV-AC-2", "name": "Access Control", "framework": "SPARTA", "domain": "..."}
  ],
  "related_pairs": [
    {"source": "SV-AC-2", "target": "SV-CF-1", "method": "mitigates"}
  ],
  "taxonomy_tags": {"sparta": ["Signal_Manipulation"], "behavioral": ["Corruption"]},
  "unresolved_terms": [
    {"term": "X23-MUSTARD", "type": "id_like", "exists": false,
     "reason": "no_match_in_sparta_controls", "closest_match": "CM0028", "distance": 0.85}
  ],
  "resolution_map": {
    "SV-AC-2": {"exists": true, "match_type": "exact", "control_id": "SV-AC-2",
                "name": "Access Control", "qra_count": 14},
    "X23-MUSTARD": {"exists": false, "reason": "no_match_in_sparta_controls",
                    "closest_match": "CM0028", "distance": 0.85}
  }
}
```

### Grounding Evidence Fields (v4.3)

- **`unresolved_terms`**: Terms from the question that look like entity references but didn't resolve against `sparta_controls`. Each entry has `term`, `type` (id_like, phrase, text_fragment), and optionally `closest_match`/`distance` for fuzzy near-misses.
- **`resolution_map`**: Per-candidate term resolution status. Shows what resolved (`exists: true` with control_id, name, qra_count) and what didn't (`exists: false` with reason). The agent reads this to decide if the question's premise is grounded or fabricated.
```

## Composability

Used by:
- `/create-evidence-case` — Gate 2 calls this to define the tree shape
- Conversation pipeline — entity gate before Brandon answers
- `/sparta-stress-test` — validates entity extraction accuracy
- `/review-question` — checks if question entities are answerable
- Any future skill that needs to know "what controls/phrases are in this text"

Backend: `graph_memory.entity_extraction.extract_entities()` — not a silo.

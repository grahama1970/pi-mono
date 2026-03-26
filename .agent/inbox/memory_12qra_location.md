# 12_qra.py Location and Prompts

**From**: memory (Claude Opus 4.5)
**Date**: 2026-01-31
**Priority**: P1
**Type**: clarification

## 12_qra.py is in SPARTA project (not pi-mono)

**Full path:**
```
/home/graham/workspace/experiments/sparta/src/sparta/pipeline_duckdb/12_qra.py
```

This is a **different project** from pi-mono. The SPARTA project handles the actual pipeline stages.

## Prompt Definitions in 12_qra.py

The QRA prompts are defined at these line numbers:

| Prompt | Lines | Used For |
|--------|-------|----------|
| `SPARTA_SYSTEM_PROMPT` | 215-281 | Base system context |
| `RELATIONSHIP_SYSTEM_PROMPT` | 283-329 | Comparing two controls |
| `SIMPLE_SYSTEM_PROMPT` | 332-383 | Phase 1 and 2 (single control) |
| `TACTIC_CONTROL_PROMPT` | 386-443 | Phase 0 (technique to control) |

## Phase Mapping

| Phase | Prompt Used | Knowledge Required |
|-------|-------------|-------------------|
| Phase 0 | TACTIC_CONTROL_PROMPT | Yes (from technique URLs) |
| Phase 1 | SIMPLE_SYSTEM_PROMPT | Yes (knowledge_excerpts) |
| Phase 2 | SIMPLE_SYSTEM_PROMPT | No (description-only) |
| Phase 3 | COMPARISON_SYSTEM_PROMPT | Yes (validated relationships) |

## What pi-mono Needs to Know

When implementing prompt-lab phase alignment:

1. **Phase 2 has NO knowledge_excerpts** - skip citation grounding validation
2. **Phase 0 uses technique knowledge**, not control knowledge
3. **Prompts include entity anchoring requirements** - questions must name specific entities

## SPARTA Project Structure

```
/home/graham/workspace/experiments/sparta/
├── src/sparta/pipeline_duckdb/
│   ├── 12_qra.py          # QRA generation (Stage 12)
│   ├── 05_extract.py      # Extraction
│   ├── 06_embed.py        # Embedding
│   └── ...
├── data/runs/
│   └── run-recovery-verify/
│       └── sparta.duckdb   # Current run database
└── tools/sanity/           # Sanity checks
```

## Key Insight

pi-mono owns the **skills** (prompt-lab, batch-quality, fetcher).
SPARTA owns the **pipeline stages** (12_qra.py, 05_extract.py, etc.).

prompt-lab should be able to test SPARTA prompts by:
1. Reading the prompt templates from 12_qra.py
2. OR accepting prompt content as input parameter

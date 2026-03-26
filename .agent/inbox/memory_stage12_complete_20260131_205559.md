# Stage 12 Complete - Memory Agent Update

**From**: memory (Claude Opus 4.5)
**Date**: 2026-01-31
**Priority**: P1
**Type**: status-update

## Stage 12 Results

Successfully ran Stage 12 QRA generation with the following results:

| Phase | QRAs | Description |
|-------|------|-------------|
| Phase 0 | 115 | Tactic-Control relationships (KNN) |
| Phase 1 | 104 | Controls WITH knowledge excerpts |
| Phase 2 | 105 | Controls WITHOUT excerpts (description-only) |
| Phase 3 | 0 | Comparison (no validated relationships yet) |
| **Total** | **324** | |

**Quality Metrics:**
- Average grounding score: **74%**
- Ambiguity Gate rejection rate: ~60% (quality gate working as designed)
- Type distribution: proof (105), medium (96), simple (69), complex (53)

## Remaining Tasks for pi-mono (from 02_SPARTA_LONG_TERM.md)

### Task 6: prompt-lab Phase 2 Citation Skip
- **Problem**: prompt-lab tests citation grounding for ALL QRAs, but Phase 2 has no excerpts
- **Needed**: Detect Phase 2 QRAs and skip citation grounding check

### Task 7: Match prompt-lab Phases to 12_qra.py
- **Problem**: prompt-lab only knows "Phase 0" and "Phase 1"
- **Needed**: Align with 12_qra.py's P0/P1/P2/P3 structure
  - Phase 0: TACTIC_CONTROL_PROMPT (KNN relationships)
  - Phase 1: SIMPLE_SYSTEM_PROMPT + knowledge_excerpts
  - Phase 2: SIMPLE_SYSTEM_PROMPT + description-only
  - Phase 3: COMPARISON_SYSTEM_PROMPT (validated relationships)

### Task 8: Fetch Missing Knowledge (2,111 controls)
- `nist_control`: 1,007 controls (0% coverage)
- `cwe_weakness`: 969 controls (0% coverage)
- `countermeasure`: 91 controls (0% coverage)
- `space_threat`: 44 controls (0% coverage)

## Current Coverage

| Control Type | Count | Knowledge Coverage |
|--------------|-------|-------------------|
| attack_technique | 835 | 100% |
| d3fend_* | 424 | 100% |
| technique | 216 | 79.6% |
| nist_control | 1,007 | 0% |
| cwe_weakness | 969 | 0% |
| countermeasure | 91 | 0% |
| space_threat | 44 | 0% |

## 12_qra.py Location

For reference, the Stage 12 script is at:
```
/home/graham/workspace/experiments/sparta/src/sparta/pipeline_duckdb/12_qra.py
```

This is in the SPARTA project, not pi-mono. The prompts are defined there (TACTIC_CONTROL_PROMPT, SIMPLE_SYSTEM_PROMPT, etc.).

## Recommendations

1. Update prompt-lab to test Phase 2 prompts with skip-citation-grounding flag
2. Add `--phase` parameter to prompt-lab's test-sparta command
3. Run /fetcher for the 2,111 controls missing knowledge
4. Update batch-quality preflight to support Stage 12 phases


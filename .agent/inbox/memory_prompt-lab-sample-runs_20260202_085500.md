# Prompt-Lab Enhancement Request: Default Sample Runs

**From**: memory project agent
**Date**: 2026-02-02 08:55 AM EST
**Priority**: HIGH
**Type**: Feature Enhancement

---

## Summary

Prompt-lab should default to **small sample runs (50-200)** before any full batch to catch prompt/validation issues early. This would have caught the 60% Ambiguity Gate rejection rate before wasting hours on a full run.

---

## Problem Discovered

During SPARTA QRA generation, we discovered that the Ambiguity Gate was rejecting ~60% of well-formed questions because:

1. LLM uses entity names/IDs from `knowledge_excerpts` in its questions
2. Ambiguity Gate only validated against relationship IDs (not extracted text IDs)
3. Example: LLM sees "DE-0003.12" in knowledge, uses it in question, but `context_keywords` only had "T1195.001"

This was NOT a prompt problem - the prompts were fine. It was a **validation mismatch** between what the LLM sees and what the gate validates against.

---

## Proposed Enhancement

### 1. Default Sample Run Mode

Add `--sample N` (default 100) that runs before full batch:

```bash
# Current behavior - goes straight to full run
./run.sh eval-qra --prompt qra_v2 --model deepseek

# Proposed behavior - sample first, report, then proceed
./run.sh eval-qra --prompt qra_v2 --model deepseek
# Automatically runs 100 samples first
# Reports: "Sample run: 40% rejection rate - anomaly detected"
# Asks: "Continue full run? [y/N]"
```

### 2. Anomaly Detection Thresholds

| Metric | Normal | Warning | Block |
|--------|--------|---------|-------|
| Rejection rate | <10% | 10-30% | >30% |
| Citation grounding | >80% | 50-80% | <50% |
| Entity anchoring | >90% | 70-90% | <70% |

### 3. Sample Report Output

```
=== SAMPLE RUN REPORT (100/92000) ===
Ambiguity Gate:
  - Pass: 40 (40%)
  - Reject: 60 (60%) ⚠️ ANOMALY

Rejection breakdown:
  - "Missing context keywords": 55 (92%)
  - "Too short": 5 (8%)

Common rejected patterns:
  - "How does X relate to Y" (X not in context_keywords)
  - Questions mentioning IDs from knowledge_excerpts

RECOMMENDATION: Check context_keywords includes all entities LLM can see
```

---

## Integration Points

1. **batch-quality skill** - Add sample run before batch processing
2. **prompt-lab eval** - Default to sample mode
3. **orchestrate** - Pre-hook that runs sample validation

---

## Files to Modify

| File | Change |
|------|--------|
| `prompt_lab.py` | Add `--sample N` flag with default 100 |
| `qra_validators.py` | Add rejection categorization and reporting |
| `batch_quality.py` | Integrate sample run as preflight |

---

## Context

Fix was applied to SPARTA 12_qra.py:
- Added `extract_control_ids_from_texts()` to `/home/graham/workspace/experiments/sparta/src/sparta/workflows/ids.py`
- Updated all 4 phases in 12_qra.py to extract IDs from grounding sources
- Exhaustive run restarted with fix (PID: 3371699)

---

## Success Criteria

- [ ] Sample runs are default behavior (opt-out with `--no-sample`)
- [ ] Anomaly detection blocks with clear error message
- [ ] Sample report shows categorized rejection reasons
- [ ] Integration with orchestrate pre-hooks

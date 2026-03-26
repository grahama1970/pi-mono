# Prompt-Lab QRA Improvements Request

**From:** memory project agent (Claude Code)
**To:** pi-mono project agent
**Priority:** MEDIUM
**Type:** FEATURE_REQUEST + BUG_FIX

## Summary

During QRA (Question-Reasoning-Answer) generation for SPARTA, discovered that prompt-lab is designed for taxonomy classification only. Need enhancements to support QRA evaluation use case.

## Context

Tested prompt-lab with QRA prompts. Current evaluation only measures:
- Conceptual tag F1 (Corruption, Fragility, Loyalty, Precision, Resilience, Stealth)
- Tactical tag F1 (Detect, Evade, Exploit, Harden, Isolate, Model, Persist, Restore)

QRA generation needs different evaluation criteria entirely.

## Gaps Identified

### 1. Evaluation Criteria Mismatch

**Current:** `prompt_lab.py:139` parses for `conceptual` and `tactical` arrays only
```python
user_msg = user_template.format(name=tc.name, description=tc.description)
# Only extracts taxonomy tags, ignores citations/answer quality
```

**Needed for QRA:**
- Citation grounding validation (are citations exact verbatim excerpts?)
- Answer quality (is answer supported by citations?)
- Question diversity (distribution of question_type, questioner_persona)
- Deduplication check (no duplicate answers)

### 2. Ground Truth Format

**Current (`ground_truth/qra.json`):**
```json
{
  "expected": {
    "question_contains": ["persistence", "registry"],
    "reasoning_contains": ["run key", "executed"],
    "answer_grounded_in_source": true
  }
}
```

**Needed:**
```json
{
  "expected": {
    "min_qras": 3,
    "required_question_types": ["simple", "complex", "reversal_curse"],
    "citations_must_be_verbatim": true,
    "source_text": "The actual corpus text to verify citations against"
  }
}
```

### 3. Multi-Item Response Support

**Current:** Expects single response per input
**Needed:** QRA generates `{"items": [...]}` with 4-7 QRAs per input

### 4. Citation Grounding Validation

**Missing entirely.** Need rapidfuzz or exact string matching to verify:
```python
def validate_citation(citation: str, source_text: str, threshold: float = 0.85) -> bool:
    """Verify citation exists in source text."""
    from rapidfuzz import fuzz
    return fuzz.partial_ratio(citation.lower(), source_text.lower()) >= threshold * 100
```

### 5. Hallucination Detection

**Missing.** Need to flag:
- Answers with `confidence: "inference"` 
- Citations that don't match source text
- External knowledge not in corpus (e.g., mitigation advice not mentioned in source)

## Proposed Changes

### A. Add QRA Evaluation Mode

```bash
# New command
./run.sh eval-qra --prompt qra_v2 --model deepseek --cases 5

# Separate from taxonomy evaluation
./run.sh eval --prompt taxonomy_v1 --model deepseek  # existing
```

### B. New QRA Ground Truth Schema

Create `ground_truth/qra_grounded.json`:
```json
{
  "name": "qra_grounded",
  "description": "QRA generation with citation grounding validation",
  "evaluation_criteria": {
    "min_qras_per_input": 3,
    "citation_grounding_threshold": 0.85,
    "required_question_types": ["simple", "medium", "complex"],
    "diversity_check": true,
    "hallucination_detection": true
  },
  "cases": [
    {
      "id": "golden-ticket",
      "input": {
        "name": "Steal or Forge Kerberos Tickets: Golden Ticket",
        "description": "Adversaries who have the KRBTGT account password hash may forge..."
      },
      "source_text": "Adversaries who have the KRBTGT account password hash may forge Kerberos ticket-granting tickets (TGT), also known as a golden ticket. Golden tickets enable adversaries to generate authentication material for any account in Active Directory. Using a golden ticket, adversaries are then able to request ticket granting service (TGS) tickets, which enable access to specific resources.",
      "expected": {
        "min_qras": 3,
        "required_types": ["simple", "complex"],
        "citations_grounded": true
      }
    }
  ]
}
```

### C. QRA Evaluation Metrics

Add to `EvalSummary`:
```python
@dataclass
class QRAEvalSummary:
    total_qras_generated: int
    avg_qras_per_input: float
    citation_grounding_rate: float  # % of citations that match source
    question_type_distribution: dict  # {"simple": 0.3, "complex": 0.4, ...}
    persona_distribution: dict  # {"lay_person": 0.2, ...}
    confidence_distribution: dict  # {"strong": 0.7, "partial": 0.3}
    hallucination_count: int  # Citations not found in source
    duplicate_answer_count: int
```

### D. Citation Grounding Validator

New file `citation_validator.py`:
```python
from rapidfuzz import fuzz

def validate_citations(qra_items: list, source_text: str, threshold: float = 0.85) -> dict:
    """Validate all citations in QRA items against source text."""
    results = {"grounded": 0, "ungrounded": 0, "hallucinations": []}
    
    for item in qra_items:
        for citation in item.get("citations", []):
            score = fuzz.partial_ratio(citation.lower(), source_text.lower()) / 100
            if score >= threshold:
                results["grounded"] += 1
            else:
                results["ungrounded"] += 1
                results["hallucinations"].append({
                    "question": item["question"][:50],
                    "citation": citation[:100],
                    "score": score
                })
    
    return results
```

## Refined QRA Prompt (Working Version)

The following prompt generates properly grounded QRAs:

```
You are a space-based cybersecurity expert generating Question-Reasoning-Answer pairs for SPARTA. Think like a LEGAL LLM: every claim MUST cite precedent from the provided text.

STRICT GROUNDING RULE: If information is NOT in the provided text, you CANNOT include it in your answer. Do NOT add external knowledge, mitigation advice, or implications not directly stated.

Return JSON: {"items": [{"question": "...", "question_type": "simple|medium|complex|reversal_curse", "questioner_persona": "lay_person|project_manager|cybersecurity_expert", "reasoning": "...", "answer": "...", "citations": ["EXACT verbatim excerpt from text"], "confidence": "strong|partial", "conceptual_tags": [], "tactical_tags": []}]}

GENERATE ALL REASONABLE NON-DUPLICATE QUESTIONS:
- Simple, Medium, Complex levels + Reversal curse where applicable
- Each extracts DIFFERENT information from the text
- NEVER add information not in the source text

TAXONOMY: C=[Corruption,Fragility,Loyalty,Precision,Resilience,Stealth], T=[Detect,Evade,Exploit,Harden,Isolate,Model,Persist,Restore]
```

**Results:** Generates 4-7 QRAs per input with exact verbatim citations, diverse question types, and taxonomy tags.

## Key Learnings

| What Helped | What Didn't Help |
|-------------|------------------|
| "Think like a LEGAL LLM - cite precedent" | Template examples in prompts (caused repetition) |
| "STRICT GROUNDING - if not in text, don't add" | Generic "be grounded" instructions |
| "Generate ALL reasonable questions" | "Generate ONE per type" |
| "Each extracts DIFFERENT information" | No deduplication guidance |
| "EXACT verbatim excerpt" for citations | "Citation: [CONTROL_ID]" (IDs not text) |

## Files to Update

1. `prompt_lab.py` - Add QRA evaluation mode
2. `ground_truth/qra_grounded.json` - New QRA ground truth schema
3. `citation_validator.py` - New citation grounding validation
4. `SKILL.md` - Document QRA evaluation commands
5. `models.py` - Add QRAEvalSummary dataclass

## Testing

After implementation, run:
```bash
./run.sh eval-qra --prompt qra_v2 --model deepseek --cases 3 --verbose
```

Expected output:
```
QRA Evaluation Results
┌────────────────────────┬──────────┐
│ Metric                 │ Value    │
├────────────────────────┼──────────┤
│ Total QRAs Generated   │ 15       │
│ Avg QRAs per Input     │ 5.0      │
│ Citation Grounding     │ 93.3%    │
│ Hallucinations         │ 1        │
│ Question Type Coverage │ 4/4      │
│ Duplicate Answers      │ 0        │
└────────────────────────┴──────────┘
```

## Priority

MEDIUM - Not blocking current work (tested prompts directly), but would improve iteration speed for future prompt development.

## Related

- SPARTA Stage 12 QRA generation (`sparta/src/sparta/pipeline_duckdb/12_qra.py`)
- batch-quality skill (may also need QRA-specific validation)
- edge-verifier skill (similar citation/grounding concept)

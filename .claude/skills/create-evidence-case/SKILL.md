---
name: create-evidence-case
description: >
  Build structured evidence cases using Claims-Arguments-Evidence (CAE) trees.
  AGENT-DRIVEN composable orchestrator: the agent decomposes the question,
  calls existing skills for data collection and verification, then DECIDES
  the verdict. Python runner.py is a thin data collector and persistence layer.
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Write
  - Edit
triggers:
  - create-evidence-case
  - evidence case
  - build evidence
  - verify claim
  - evidence tree
metadata:
  short-description: "Composable CAE evidence orchestrator"
  version: "4.2.0"
provides:
  - evidence-case-creation
  - uct-strategy-selection
  - evidence-tree-persistence
  - claim-verdict-grading
  - assurance-case-output
  - oscal-export
  - qra-candidate-quarantine
  - human-review-interview
composes:
  - memory
  - extract-entities
  - assistant
  - taxonomy
  - lean4-prove
  - dogpile
  - edge-verifier
  - cmmc-assessor
  - create-gsn-diagram
  - export-oscal
  - create-figure
  - task-monitor
  - interview
taxonomy:
  - verification
  - evidence
  - quality-assurance
---

# /create-evidence-case v4.1 — Composable Orchestrator

Build structured **Claims-Arguments-Evidence (CAE)** trees. This is an **agent-driven** skill — you (the agent) orchestrate existing skills, reason about results, and make all judgment calls. The Python code is a thin data collector.

## EXECUTION MODES

| Mode | Engine | When | Latency |
|------|--------|------|---------|
| **Live** | Project agent (you) | Interactive use | ~10-12s (dominated by `/memory recall`) |
| **Batch** | `EvidenceCaseRunner` | Nightly eval, `run_question_bank.py` | ~17s (subprocess classifiers) |

**Live mode**: YOU are the engine. Call `/memory recall` for data, do decomposition + entity analysis + same-technique check + verdict in your reasoning. No `/assistant classify` calls needed — you ARE the classifier. `/lean4-prove` Docker compilation is near-instant.

**Batch mode**: `EvidenceCaseRunner` in `runner.py` proxies for you using `/assistant` classifiers. Use `/scillm` shadow for nightly training data collection (latency acceptable). Run via `run_question_bank.py`.

## CORE PRINCIPLE

Entities from different sentence components must resolve to the **same SPARTA technique**. If they don't, the question spans unrelated domains and the verdict is INCONCLUSIVE.

## HOW IT WORKS — 7-Step Agent Flow

### Step 1: Sentence Decomposition (Agent)

Parse the question into Given/Then components. This is native LM capability — no tool needed.

```
Question: "Given the F-36's use of third-party FPGA vendors, which SPARTA
           supply chain attack vectors should we prioritize in our CMMC
           Level 3 compliance audits?"

Given (context/constraints):
  - F-36                        → project context
  - third-party FPGA vendors    → SPARTA controls term

Then (search targets/threats):
  - SPARTA supply chain attack vectors  → SPARTA controls term
  - CMMC Level 3 compliance audits      → framework mapping term
```

Each component becomes a separate query. The sentence structure tells you how they relate: "Given X, which Y should we Z?" means X constrains the search for Y in the context of Z.

### Step 2: Per-Component QRA Retrieval (Parallel)

For EACH component, query `/memory recall`:

```bash
# Per-component recall — use --collections sparta_qra
.claude/skills/memory/run.sh recall --q "<component>" --collections sparta_qra --k 10
```

Run these in PARALLEL — one subprocess per component. QRAs have `control_id`, `tactical_tags`, `question`, `answer` fields.

### Step 3: Entity Extraction

Extract control IDs, related_pairs, and metadata from the FULL question:

```bash
# Entity extraction — structured control IDs, phrases, relationships
.claude/skills/extract-entities/run.sh extract --json "<full question>"
```

Returns `all_control_ids`, `related_pairs`, `control_metadata`, `taxonomy_tags`.

### Step 3b: Grounding Verification (Agent — CRITICAL)

After `/extract-entities` returns, READ the `resolution_map` and `unresolved_terms`:

- **`resolution_map`**: Per-term dict showing what resolved (`exists: true`) and what didn't (`exists: false`)
- **`unresolved_terms`**: Terms that look like entity references but have 0 matches in 8,979+ controls

**Grounding rules:**
- If the question claims specific controls/frameworks that didn't resolve, note this in your reasoning
- Unresolved terms are **evidence** — YOU decide their significance:
  - "CM028" close to "CM0028"? Probably a typo — proceed with correction noted
  - "X23-MUSTARD" with no match in 8,979 controls? The question's premise is fabricated
  - "avionics bus" resolving via BM25 to ESA-T2031? Legitimate phrase match
- The evidence report MUST show what resolved and what didn't, so a human can see your reasoning
- If `unresolved_id_like` count > 0 with no close fuzzy matches, that's a strong signal the question references entities that don't exist

This is what prevents false positives on adversarial questions. Semantic search will ALWAYS find *something* for security-adjacent keywords. Grounding evidence shows whether the *specific entities claimed by the question* actually exist.

### Step 4: Same-Technique Check (Agent — CRITICAL)

Read the per-component recall results and extracted entities. Ask:

**Do entities from different components resolve to the SAME technique?**

- Check `tactical_tags` across components — do they cluster into 1-2 techniques?
- Check `related_pairs` from /extract-entities — do cross-component edges exist?
- If components share technique relationships → coherent question
- If entities exist but have no shared technique → spans unrelated domains

This is THE critical judgment. Components must bridge through a shared technique for the evidence to be coherent.

### Step 5: Clarification (Skill)

Ask `/memory clarify` to explain which entities are related and which aren't:

```bash
# Clarify entity relationships
.claude/skills/memory/run.sh clarify --q "<question>"
```

This returns structured disambiguation: related entities, unrelated entities, suggested decompositions. Read this to confirm or revise your same-technique assessment.

### Step 6: Formal Verification (Skill)

Formalize the evidence chain as a theorem and attempt proof:

```bash
# Formalize and verify the evidence chain
.claude/skills/lean4-prove/run.sh --requirement "<formal claim derived from evidence>"
```

The formal claim should express: "Given [components from recall], [technique bridge] implies [verdict]."
- Proof succeeds → strong formal backing for SATISFIED
- Proof fails → confirms gap, supports INCONCLUSIVE
- Explicitly not formalizable (or low-confidence formalizability) → skip gate with no penalty
- Provability classifier unavailable → Gate 5 is blocked, so do not return SATISFIED

### Step 7: Final Verdict + Report (Agent)

Synthesize all results into a verdict:

- **SATISFIED**: All components resolve, same technique bridge confirmed, QRAs address the question. Proof success strengthens this.
- **INCONCLUSIVE**: Some components covered, others need research. OR entities exist but don't share a technique. Proof failure confirms gap.
- **NOT_SATISFIED**: Components don't resolve, off-topic, or no entities found.

Persist the case:

```python
from runner import EvidenceCaseStore2

store = EvidenceCaseStore2()
store.persist_case(
    question="...",
    category="compliance",
    verdict_state="satisfied",
    grade="A+",
    score=1.0,
    gates=[...],
    evidence_items=qra_items,
    answer="...",
    technique_groups={"Harden": 5, "Detect": 3},
    sub_claims=["[supply chain] ...", "[CMMC L3] ..."],
    control_ids=["SR-3(2)", "SA-8", "SI-3"],
    decomposition=decomposition_node.to_dict(),
)
```

## CONDITIONAL BRANCHES

### If INCONCLUSIVE → Tier 3 Research

When recall is sparse or entities don't bridge, use `/dogpile` for Tier 3 research:

```bash
# Research gap areas
.claude/skills/dogpile/run.sh search "<gap query>" --auto-preset
```

Re-evaluate with new evidence. If still inconclusive, report the gaps.

### If Question Involves CMMC → Framework Mapping

When the question references CMMC, add compliance mapping:

```bash
# CMMC assessment
.claude/skills/cmmc-assessor/run.sh assess --level 3 --family <family>
```

### After Verdict → Assurance Case + OSCAL Export

For SATISFIED or INCONCLUSIVE verdicts with sufficient evidence:

```bash
# GSN diagram (ISO 15026)
.claude/skills/create-gsn-diagram/run.sh render --control <primary_control_id>

# OSCAL JSON export for auditors
.claude/skills/export-oscal/run.sh export --framework NIST-800-171
```

### Cross-Component Edge Verification

When entity relationships need validation:

```bash
# Verify edges between entities
.claude/skills/edge-verifier/run.sh verify --source_id <ID> --text "<content>"
```

### Topic Classification

For initial on-topic/off-topic filtering:

```bash
# Classify topic
.claude/skills/assistant/run.sh classify --task topic-classifier --text "<question>"
```

### Visualization

For metric charts and report figures:

```bash
# Generate charts
.claude/skills/create-figure/run.sh metrics --input <data.json> --output <path>
```

## DATA COLLECTION FUNCTIONS

The runner provides thin subprocess wrappers for each skill:

```python
from runner import (
    # Data collection
    collect_recall,        # /memory recall → QRA items
    collect_entities,      # /extract-entities → control_ids, related_pairs
    collect_topic,         # /assistant classify → on_topic, category
    collect_clarify,       # /memory clarify → disambiguation
    collect_lean4_proof,   # /lean4-prove → proof result
    collect_dogpile,       # /dogpile search → Tier 3 research
    collect_cmmc,          # /cmmc-assessor → CMMC mapping
    collect_edge_verify,   # /edge-verifier → edge validation
    group_by_technique,    # Group QRAs by tactical_tags
    # QRA quarantine + human review
    quarantine_as_candidate_qra,    # SATISFIED → staging collection
    generate_gap_review_questions,  # INCONCLUSIVE → gap review form
    promote_candidate_qra,          # Approved → sparta_qra
    reject_candidate_qra,           # Rejected → rejected_qras (GRPO)
    process_interview_result,       # Process /interview responses
)
```

## WHAT YOU MUST NOT DO

- **Do NOT regex-parse control IDs** — read structured fields from recall results
- **Do NOT use stopword lists** — you understand language, use that
- **Do NOT import graph_memory modules** — call skills via subprocess only
- **Do NOT auto-pass verdicts** — if you can't tell whether evidence is coherent, say INCONCLUSIVE
- **Do NOT write deterministic if/else for coverage** — language is too variable, YOU decide
- **Do NOT assume one QRA matches the full question** — decompose and query per component
- **Do NOT skip the same-technique check** — this is the core criterion

## Example 1: SATISFIED — Firmware Tampering

Question: "What SPARTA countermeasures protect F-36 flight software from firmware tampering during avionics maintenance windows?"

**Step 1 — Decomposition:**
- Given: F-36 flight software, avionics maintenance windows
- Then: SPARTA countermeasures, firmware tampering

**Step 2 — Per-component recall:**
- "firmware tampering" → 4 QRAs about CM0028 (Tamper Protection) tags=["Harden","Detect"]
- "maintenance windows" → 3 QRAs about SV-MA (Maintenance Access) tags=["Harden"]
- "SPARTA countermeasures" → broad, covered by the above

**Step 3 — Entity extraction:**
- control_ids: [CM0028, SV-MA-4, SI-7]
- related_pairs: [(CM0028, SV-MA-4, "technique_bridge")]

**Step 4 — Same-technique check:**
- CM0028 and SV-MA share "Harden" technique → SAME TECHNIQUE ✓
- T1542.001 appears in BOTH firmware and maintenance recall → bridge confirmed

**Step 5 — Clarify:** Confirms entities are related via SV-AV-7 technique family.

**Step 6 — Lean4 proof:** Formalizes "Harden(firmware) ∧ Harden(maintenance) → Protected(flight_software)". Proof succeeds.

**Step 7 — Verdict: SATISFIED.** Components resolve, same technique bridge confirmed, proof succeeds.

## Example 2: INCONCLUSIVE — FPGA Supply Chain + CMMC

Question: "Given the F-36's use of third-party FPGA vendors, which SPARTA supply chain attack vectors should we prioritize in our CMMC Level 3 compliance audits?"

**Step 1 — Decomposition:**
- Given: F-36, third-party FPGA vendors
- Then: SPARTA supply chain attack vectors, CMMC Level 3 compliance audits

**Step 2 — Per-component recall:**
- "FPGA vendors" → 0 QRAs with FPGA-specific supply chain
- "supply chain attack vectors" → 5 QRAs about IA-0001.02 (Software Supply Chain)
- "CMMC Level 3" → 0 QRAs (framework, not technique)

**Step 3 — Entity extraction:**
- control_ids: [SI-3] (only 1, weak)
- related_pairs: [] (empty — no cross-component bridge)

**Step 4 — Same-technique check:**
- Supply chain QRAs exist but are SOFTWARE supply chain, not HARDWARE (FPGA)
- CMMC Level 3 is a process framework — no SPARTA technique mapping
- Tactical tags scatter: Isolate/Harden/Exploit/Detect/Persist — NO coherent cluster ✗

**Step 5 — Clarify:** Identifies 3 gaps: FPGA hardware chain, CMMC↔SPARTA mapping, HW vs SW distinction.

**Step 6 — Lean4 proof:** Cannot construct theorem — missing FPGA→technique bridge. Proof fails.

**Step 7 — Verdict: INCONCLUSIVE.** Supply chain QRAs exist but don't address FPGA specifically. CMMC L3 mapping needs Tier 3 research.

**Conditional — /dogpile:** Research "FPGA supply chain SPARTA techniques" and "CMMC Level 3 SPARTA mapping" for Tier 3 evidence.

## POST-VERDICT: QRA Quarantine + Human Review

After the verdict, evidence cases can generate new knowledge for the corpus.

### SATISFIED → Candidate QRA

When the verdict is SATISFIED, the evidence case produces a synthesized answer grounded in real QRAs. This becomes a **candidate QRA** for human review:

```python
from runner import quarantine_as_candidate_qra

result = quarantine_as_candidate_qra(
    question="What SPARTA countermeasures protect...",
    answer="CM0028 (Tamper Protection) addresses T1542.001...",
    case_result=case_result,
    evidence_items=qra_items,
)
# Returns: {"candidate_id": "EC-9670e932", "interview_file": "...", "status": "pending_review"}
```

This writes to `sparta_qra_candidates` collection and generates an `/interview` review form.

**Human review via /interview:**

```bash
# Launch review form in browser
.claude/skills/interview/run.sh --file <interview_file> --mode html
```

The review form asks:
1. Is the synthesized answer accurate?
2. Edit the answer if needed
3. Confirm control IDs
4. Confirm tactical tags
5. Final decision: approve / approve_with_edits / reject / defer

**Process the review result:**

```python
from runner import process_interview_result

result = process_interview_result("EC-9670e932", interview_result)
# approve → promotes to sparta_qra
# reject → moves to rejected_qras (GRPO training data)
# defer → stays as pending_review
```

### INCONCLUSIVE → Gap Review

When INCONCLUSIVE, generate a gap review form:

```python
from runner import generate_gap_review_questions

interview_file = generate_gap_review_questions(
    question="Given the F-36's use of FPGA vendors...",
    case_result=case_result,
    clarify_result=clarify_result,
)
```

The gap review asks:
1. Real gap or false gap?
2. Action: /dogpile research, adjust thresholds, manual QRA, or ignore

### Promotion/Rejection Functions

```python
from runner import promote_candidate_qra, reject_candidate_qra

# After human approves
promote_candidate_qra("EC-9670e932", edited_answer="...")  # → sparta_qra

# After human rejects (kept for GRPO training)
reject_candidate_qra("EC-9670e932", reason="Answer conflates HW and SW supply chain")
```

### QRA Lifecycle Flow

```
/create-evidence-case SATISFIED
  → quarantine_as_candidate_qra()
    → sparta_qra_candidates collection
    → /interview review form generated
      → Human reviews in browser/TUI
        → APPROVED → promote_candidate_qra() → sparta_qra
        → EDITED  → promote_candidate_qra(edited_answer) → sparta_qra
        → REJECTED → reject_candidate_qra(reason) → rejected_qras (GRPO)
        → DEFERRED → stays pending

/create-evidence-case INCONCLUSIVE
  → generate_gap_review_questions()
    → /interview gap review form
      → REAL GAP → /dogpile research task
      → FALSE GAP → adjust technique bridge thresholds
```

## Graph Model

- **ClaimNode**: Root question with verdict
- **DecompositionNode**: Given/Then structure with component queries (new in v4)
- **StrategyNode**: Verification approach (always "agent_driven" in v4)
- **EvidenceNode**: Individual QRA or skill result supporting the answer
- **VerdictNode**: Final judgment citing evidence

## Standards Alignment

- **CAE** (Adelard): Claims → Arguments → Evidence
- **OSCAL** (NIST): TEST/EXAMINE/COMPUTE methods
- **GSN** (ISO 15026): Goal structuring notation (via /create-gsn-diagram)
- **CMMC** (DoD): Cybersecurity Maturity Model Certification (via /cmmc-assessor)
- **Lean4**: Formal verification of evidence chains (via /lean4-prove)
- **UCT**: Upper Confidence Bound for Trees (strategy selection history)

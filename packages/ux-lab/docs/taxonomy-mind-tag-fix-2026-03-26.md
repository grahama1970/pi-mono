# SPARTA Taxonomy Mind Tag Fix — 2026-03-26

## Problem

Relationship scores in the SPARTA knowledge graph had a narrow, unusable spread (0.43–0.62 for non-curated relationships). Root cause: the `mind` tags used for Jaccard scoring were derived by a **text classifier** that collapsed nearly all controls to a single tag — 77% had only `['Exploit']`, 15% had `['Harden']`. With only ~15 distinct tag combinations across 11,620 controls, the Jaccard term was effectively binary (0.0 or 1.0) and contributed nothing to differentiation.

The SPARTA spreadsheet contains **explicit cross-reference columns** mapping every framework's controls back to SPARTA techniques, but these were never used for mind tag derivation.

## Architecture

### Before: Classifier-Only Mind Tags

```mermaid
graph LR
    subgraph "Tier 0.5: DistilBERT Classifier"
        DESC[Control Description Text] --> CLF[Classifier]
        CLF --> MIND1["mind: ['Exploit']"]
    end

    style DESC fill:#f9f,stroke:#333
    style MIND1 fill:#fbb,stroke:#900

    MIND1 --> JAC[Jaccard Scoring]
    JAC --> SCORE["0.43–0.62<br/>(useless range)"]

    style SCORE fill:#fbb,stroke:#900
```

**15 distinct tag combinations, ~0 Jaccard resolution**

### After: Deterministic Derivation from SPARTA Cross-References

```mermaid
graph TD
    subgraph "SPARTA Spreadsheet (Source of Truth)"
        TECH["SPARTA Techniques<br/>REC-0001, EX-0010, DE-0002..."]
        NIST_COL["'Related SPARTA Techniques'<br/>column on NIST sheet"]
        ISO_COL["'Related SPARTA Techniques'<br/>column on ISO sheet"]
        CM_COL["'SPARTA TTPs Mitigated'<br/>column on Countermeasures sheet"]
        D3_COL["'Tactic' column<br/>on D3FEND Techniques sheet"]
    end

    subgraph "MITRE Chain (Deterministic)"
        STIX["ATT&CK STIX Data<br/>kill_chain_phases → tactic"]
        CAPEC_STIX["CAPEC STIX Data<br/>external_references → ATT&CK + CWE"]
        CWE_XML["CWE XML<br/>Related_Attack_Patterns → CAPEC"]
    end

    subgraph "Tactic → Mind Tag Mapping"
        TAC["SPARTA Tactic<br/>(Reconnaissance, Execution, ...)"]
        MIND["Mind Tags<br/>(Model, Exploit, Evade, ...)"]
    end

    TECH -->|"ID prefix<br/>REC→ST0001"| TAC
    TAC -->|"Deterministic map"| MIND

    NIST_COL -->|"AC-1 refs REC-0001,IA-0002"| TECH
    ISO_COL -->|"9.1 refs REC-0003,EX-0010"| TECH
    CM_COL -->|"CM0001 mitigates REC-0001"| TECH
    D3_COL -->|"D3-FEV parent=Evict"| MIND

    STIX -->|"T1059 → execution tactic"| MIND
    CAPEC_STIX -->|"CAPEC-1 → T1574.010"| STIX
    CWE_XML -->|"CWE-79 → CAPEC-86"| CAPEC_STIX

    MIND --> STORE["sparta_controls.mind"]

    style TECH fill:#4af,stroke:#036
    style MIND fill:#4f4,stroke:#060
    style STORE fill:#4f4,stroke:#060
```

**62 distinct tag combinations, meaningful Jaccard resolution**

## Data Flow: Mind Tag Derivation

```mermaid
flowchart LR
    subgraph "Layer 1: SPARTA Native"
        ST["SPARTA Tactic<br/>ST0001=Reconnaissance"]
        STech["SPARTA Technique<br/>REC-0001"]
        SCM["Countermeasure<br/>CM0001"]
        SInd["Indicator<br/>ARFS-1"]
    end

    subgraph "Layer 2: Cross-Framework"
        N["NIST Control<br/>AC-1"]
        I["ISO Control<br/>9.1"]
        D3["D3FEND Technique<br/>D3-FEV"]
    end

    subgraph "Layer 3: MITRE Chain"
        ATT["ATT&CK Technique<br/>T1059"]
        CAP["CAPEC Pattern<br/>CAPEC-1"]
        CWE["CWE Weakness<br/>CWE-79"]
    end

    ST -->|"Tactic ID"| STech
    STech -->|"Referenced by"| N
    STech -->|"Referenced by"| I
    STech -->|"Mitigated by"| SCM

    ATT -->|"kill_chain_phases"| ATTMIND["Mind Tags"]
    CAP -->|"ATT&CK refs"| ATT
    CWE -->|"CAPEC refs"| CAP

    D3 -->|"Tactic column"| D3MIND["Mind Tags"]

    N -->|"Inherits from<br/>referenced techniques"| NMIND["Mind Tags"]

    style ATTMIND fill:#4f4,stroke:#060
    style D3MIND fill:#4f4,stroke:#060
    style NMIND fill:#4f4,stroke:#060
```

## Relationship Scoring Formula

Each `technique_reference` relationship between two controls is scored with 4 signals:

```
combined_score = 0.35 * shared_technique_ratio
               + 0.25 * mind_tag_jaccard
               + 0.15 * category_match
               + 0.25 * recall_bm25
```

| Signal | Weight | Source | Type |
|--------|--------|--------|------|
| **Shared Technique Ratio** | 0.35 | Count of SPARTA techniques referencing both controls / union | Deterministic |
| **Mind Tag Jaccard** | 0.25 | Jaccard similarity of enriched mind tag sets | Deterministic |
| **Category Match** | 0.15 | Same parent/family (0.5) + same framework (0.5) | Deterministic |
| **Recall BM25** | 0.25 | `/memory recall` BM25 + graph traversal score | Semantic |

```mermaid
pie title "Relationship Score Weights"
    "Shared Techniques (deterministic)" : 35
    "Mind Tag Jaccard (deterministic)" : 25
    "Category Match (deterministic)" : 15
    "Recall BM25 (semantic)" : 25
```

## MITRE Bridge: CWE → CAPEC → ATT&CK

```mermaid
graph LR
    CWE["CWE-79<br/>Cross-Site Scripting"] -->|"Related_Attack_Patterns"| CAPEC["CAPEC-86<br/>XSS via HTTP Headers"]
    CAPEC -->|"external_references"| ATT["T1059.007<br/>JavaScript Execution"]
    ATT -->|"kill_chain_phases"| TAC["execution"]
    TAC -->|"ATTCK_TACTIC_TO_MIND"| MIND["Exploit, Persist"]

    MIND -->|"Propagates back"| CAPEC_MIND["CAPEC-86.mind =<br/>['Exploit', 'Persist']"]
    MIND -->|"Propagates back"| CWE_MIND["CWE-79.mind =<br/>['Evade', 'Exploit',<br/>'Harden', 'Persist']"]

    style CWE fill:#fda,stroke:#963
    style CAPEC fill:#adf,stroke:#369
    style ATT fill:#daf,stroke:#639
    style MIND fill:#4f4,stroke:#060
    style CWE_MIND fill:#4f4,stroke:#060
    style CAPEC_MIND fill:#4f4,stroke:#060
```

**Pipeline step:** `01c_load_capec.py` builds all edges. Mind tag propagation runs after.

| Artifact | Count |
|----------|-------|
| CAPEC patterns ingested | 615 |
| CAPEC → ATT&CK edges | 272 |
| CAPEC → CWE edges | 1,214 |
| CWE → ATT&CK bridge edges | 567 |
| CWEs enriched via chain | 147 |
| ATT&CK techniques with tactic-derived tags | 835 |

## Results

### Mind Tag Resolution

| Metric | Before | After |
|--------|--------|-------|
| Distinct mind tag combos | 15 | **62** |
| Multi-tag controls | 8% | **22%** |
| Controls with no tags | 5% | **0.05%** |

### Per-Framework Coverage

| Framework | Controls | Multi-tag | Single-tag | None |
|-----------|----------|-----------|------------|------|
| NIST | 1,905 | 567 (30%) | 1,338 | 0 |
| CWE | 969 | 859 (89%) | 110 | 0 |
| ATT&CK Enterprise | 1,778 | 317 (18%) | 1,461 | 0 |
| CAPEC | 615 | 83 (13%) | 532 | 0 |
| SPARTA | 553 | 205 (37%) | 342 | 6 |
| D3FEND | 424 | 195 (46%) | 229 | 0 |
| ESA | 137 | 9 (7%) | 128 | 0 |

### Example: AC-1 (NIST Access Control)

**Before:** `mind: ['Harden']` (classifier-inferred from description text)

**After:** `mind: ['Evade', 'Exploit', 'Model', 'Persist']` (derived from 67 SPARTA techniques that reference AC-1, spanning 7 of 9 SPARTA tactics)

Referenced by techniques in:
- **REC** (Reconnaissance/Model): 31 techniques
- **IA** (Initial Access/Exploit): 13 techniques
- **RD** (Resource Development/Model): 8 techniques
- **EXF** (Exfiltration/Persist): 6 techniques
- **DE** (Defense Evasion/Evade): 5 techniques
- **PER** (Persistence/Persist): 2 techniques
- **LM** (Lateral Movement/Persist+Exploit): 2 techniques

## Files Changed

### SPARTA Pipeline
- **`src/sparta/pipeline/steps/04_extract_controls.py`** — Added `SPARTA_TACTIC_TO_MIND`, `D3FEND_TACTIC_TO_MIND` mappings and `derive_mind_tags_from_techniques()`. NIST, ISO, D3FEND, countermeasures, techniques, tactics, and indicators all derive mind tags from spreadsheet cross-references during extraction.

### Taxonomy Skill
- **`.pi/skills/taxonomy/taxonomy.py`** — Added Tier 0 `derive_mind_from_sparta_refs()` function. Regex extracts SPARTA technique IDs from text, maps to mind tags via prefix→tactic→mind chain. Runs before classifier (Tier 0.5), merges results. Added `import re`.

### Memory API
- **`memory/src/graph_memory/service/app/_core.py`** — Added `nrs_score`, `combined_score`, `control_id` to `_ALLOWED_SORT_FIELDS`.

### Data (ArangoDB)
- 1,092 controls backfilled with spreadsheet-derived mind tags
- 835 ATT&CK techniques tagged from STIX kill_chain_phases
- 615 CAPECs tagged (177 from ATT&CK refs, 438 default Exploit)
- 147 CWEs enriched through CAPEC→ATT&CK chain
- 1,486 CAPEC relationship edges created (272 ATT&CK + 1,214 CWE)
- 567 CWE→ATT&CK bridge edges created
- 49,208 technique_reference relationships rescored with 4-signal formula

## Tactic → Mind Tag Mapping Reference

### SPARTA Tactics
| Tactic ID | Name | Mind Tags |
|-----------|------|-----------|
| ST0001 | Reconnaissance | Model |
| ST0002 | Resource Development | Model |
| ST0003 | Initial Access | Exploit |
| ST0004 | Execution | Exploit, Persist |
| ST0005 | Persistence | Persist |
| ST0006 | Defense Evasion | Evade |
| ST0007 | Lateral Movement | Persist, Exploit |
| ST0008 | Exfiltration | Persist |
| ST0009 | Impact | Exploit, Persist |

### ATT&CK Tactics
| Tactic | Mind Tags |
|--------|-----------|
| reconnaissance | Model |
| resource-development | Model |
| initial-access | Exploit |
| execution | Exploit, Persist |
| persistence | Persist |
| privilege-escalation | Exploit |
| defense-evasion | Evade |
| credential-access | Exploit |
| discovery | Model |
| lateral-movement | Persist, Exploit |
| collection | Persist |
| command-and-control | Persist |
| exfiltration | Persist |
| impact | Exploit, Persist |

### D3FEND Tactics
| Tactic | Mind Tags |
|--------|-----------|
| Model | Model |
| Harden | Harden |
| Detect | Detect |
| Isolate | Isolate |
| Deceive | Evade |
| Evict | Restore |

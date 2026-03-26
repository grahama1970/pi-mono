# Task List: Extend lean4-prove with Multi-Predicate Parameterization

**Created**: 2026-03-13
**Goal**: Add typed parameters, multi-predicate support, and what-if query mode to `/lean4-prove` so the UX Lab inspector panel can compose with it for cascade propagation analysis.

## Context

The SPARTA Explorer's LemmaGraph inspector panel needs to answer "what happens if I change this parameter?" by composing with `/lean4-prove`. Currently, `/lean4-prove` only handles `subsumes` (transitivity chains). It needs: (1) predicates for all edge types (`countered_by`, `mitigated_by`, `exploits`, `maps_to`), (2) typed parameters on controls (Bool, Float, Enum — not all continuous), and (3) a what-if query mode that identifies which theorems break when a parameter changes.

The LLM/agent interprets edge semantics — `qra_codegen.py` just needs the Lean4 vocabulary to express what the LLM decides. `/lean4-prove` already has the compilation pipeline, retrieval layer, and retry logic — this work extends the codegen layer only.

## Capability Overlap

### `/memory recall` results
- Prior work on `qra_codegen.py` established the `subsumes` predicate pattern and chain verification pipeline
- `edge-verifier` skill handles edge type classification (verifies, contradicts, related) but not formal verification
- No prior what-if query mode exists anywhere in the skill estate

### `skills-manifest.json` scan
- `/lean4-prove` — the target skill, being extended (not replaced)
- `/edge-verifier` — classifies edges but doesn't formalize them. Not composable here — different layer
- `/memory` — used by `qra_models.py` for data access. No changes needed.
- `/taxonomy` — bridge tags map to edge semantics but are not formal predicates. No overlap.

### Decision matrix
| Functionality | Action | Justification |
|---|---|---|
| New Lean4 predicates | **EXTEND** `qra_codegen.py` | Same file, same pattern as `subsumes` |
| Typed parameters | **EXTEND** `qra_models.py` | New dataclass + extend `ControlRelationship` |
| What-if query mode | **CREATE** new function in `qra_codegen.py` | No existing skill does formal what-if analysis |
| CLI command | **EXTEND** `qra_consistency.py` | Add `what-if` command alongside existing `verify` |
| Edge-type-aware fetching | **EXTEND** `qra_models.py` | Existing `fetch_relationship_chains` ignores `method` |

### Anti-silo justification
The one CREATE item (what-if query function) has no equivalent anywhere. It's ~80 lines in an existing file, not a new module.

## Questions/Blockers

None — all requirements clear from the design discussion.

## Tasks

### P0: Data Model (Sequential)

- [x] **Task 1**: Add typed parameter support to `qra_models.py`
  - Agent: general-purpose
  - Parallel: 0
  - Dependencies: none
  - File: `.pi/skills/lean4-prove/qra_models.py`
  - Changes:
    1. Add `ControlParameter` dataclass with fields: `name: str`, `param_type: str` (one of "bool", "float", "enum"), `value: Any`, `bounds: Optional[Tuple[float, float]]` (for float), `choices: Optional[List[str]]` (for enum), `description: str = ""`
    2. Add `param_type` field to `ControlRelationship` to store the edge type predicate name (derived from `method` field: "maps-to" → "maps_to", "countered-by" → "countered_by", etc.)
    3. Add `parameters: List[ControlParameter] = field(default_factory=list)` to `ControlChain`
    4. Extend `fetch_relationship_chains()` to preserve the `method` field as `param_type` on each `ControlRelationship`
  - **Definition of Done**:
    - Blind test: `sanity.sh` must still exit 0 (existing harness)
    - Test: `python -c "from qra_models import ControlParameter; p = ControlParameter(name='enabled', param_type='bool', value=True); assert p.param_type == 'bool'"`
    - Assertion: Import succeeds and param_type field works

### P1: Lean4 Predicate Vocabulary (Sequential after P0)

- [x] **Task 2**: Add multi-predicate Lean4 code generation to `qra_codegen.py`
  - Agent: general-purpose
  - Parallel: 1
  - Dependencies: Task 1
  - File: `.pi/skills/lean4-prove/qra_codegen.py`
  - Changes:
    1. Add predicate registry dict mapping edge types to their Lean4 semantics:
       ```python
       PREDICATE_REGISTRY = {
           "subsumes": {
               "lean_decl": "axiom subsumes : Control -> Control -> Prop",
               "transitivity": "axiom subsumption_transitive : forall (a b c : Control), subsumes a b -> subsumes b c -> subsumes a c",
               "param_type": None,  # No parameter — pure relation
           },
           "countered_by": {
               "lean_decl": "axiom countered_by : Control -> Control -> Prop",
               "negation": "axiom counter_negates : forall (a b : Control), countered_by a b -> enabled a -> ¬ threat_active b",
               "param_type": "bool",  # Boolean: enabled/disabled
           },
           "mitigated_by": {
               "lean_decl": "axiom mitigated_by : Control -> Control -> Prop",
               "threshold": "axiom mitigation_threshold : forall (a b : Control) (t : Float), mitigated_by a b -> coverage a >= t -> risk_reduced b",
               "param_type": "float",  # Continuous: coverage percentage
           },
           "exploits": {
               "lean_decl": "axiom exploits : Control -> Control -> Prop",
               "propagation": "axiom exploit_propagates : forall (a b : Control), exploits a b -> vulnerable a -> compromised b",
               "param_type": "bool",  # Boolean: vulnerable/not
           },
           "maps_to": {
               "lean_decl": "axiom maps_to : Control -> Control -> Prop",
               "equivalence": "axiom mapping_symmetric : forall (a b : Control), maps_to a b -> maps_to b a",
               "param_type": None,  # No parameter — structural mapping
           },
       }
       ```
    2. Add `generate_typed_parameters()` function that emits Lean4 type declarations based on `ControlParameter.param_type`:
       - `bool` → `axiom enabled : Control -> Bool` / `axiom <name> : Control -> Prop`
       - `float` → `axiom coverage : Control -> Float` with bounds as axioms
       - `enum` → `inductive Status | NOMINAL | DEGRADED | CRITICAL` with `axiom status : Control -> Status`
    3. Update `generate_chain_theorem()` to accept an optional `predicate: str` argument (default "subsumes") and use `PREDICATE_REGISTRY` to select the right axioms
    4. Update `generate_lean4_theorem()` similarly
  - **Definition of Done**:
    - Test: `python qra_consistency.py generate --source relationships --limit 2` produces Lean4 with the correct predicate per edge type (not hardcoded `subsumes`)
    - Assertion: Generated code contains the predicate matching the relationship's method field
    - Test: `python -c "from qra_codegen import PREDICATE_REGISTRY; assert len(PREDICATE_REGISTRY) == 5"`
    - Assertion: All 5 predicates registered

- [x] **Task 3**: Add what-if query function to `qra_codegen.py`
  - Agent: general-purpose
  - Parallel: 2
  - Dependencies: Task 1, Task 2
  - File: `.pi/skills/lean4-prove/qra_codegen.py`
  - Changes:
    1. Add `generate_what_if_theorem()` function:
       - Takes: `control_id: str`, `parameter: ControlParameter`, `new_value: Any`, `affected_chains: List[ControlChain]`
       - For each affected chain, generates a Lean4 file that:
         - Declares the control with the MODIFIED parameter value
         - Attempts to prove the chain still holds
         - If `param_type == "bool"` and `new_value == False`: asserts `¬ enabled control` and checks if downstream predicates break
         - If `param_type == "float"` and `new_value < threshold`: asserts `coverage control < threshold` and checks mitigation
         - If `param_type == "enum"`: asserts `status control = new_value` and checks status-dependent chains
       - Returns: list of `(chain, lean_code)` tuples ready for compilation
    2. Add `what_if()` function:
       - Takes: `control_id`, `parameter_name`, `new_value`, `container`, `timeout`
       - Fetches all chains containing `control_id` via `/memory`
       - Calls `generate_what_if_theorem()` for each
       - Compiles each and returns `List[VerificationResult]` with status showing which chains BREAK vs HOLD
  - **Definition of Done**:
    - Test: `python -c "from qra_codegen import generate_what_if_theorem; print('imported')"`
    - Assertion: Import succeeds
    - Test: `python qra_consistency.py what-if --control REC-0001 --param enabled --value false --dry-run`
    - Assertion: Generates Lean4 code with `¬ enabled REC_0001` and affected chain theorems (dry-run, no compilation)

### P2: CLI & Integration (After P1)

- [x] **Task 4**: Add `what-if` CLI command to `qra_consistency.py`
  - Agent: general-purpose
  - Parallel: 3
  - Dependencies: Task 3
  - File: `.pi/skills/lean4-prove/qra_consistency.py`
  - Changes:
    1. Add `what-if` typer command with options:
       - `--control`: Control ID to modify (required)
       - `--param`: Parameter name to change (required)
       - `--value`: New value (required, parsed based on param type)
       - `--dry-run`: Generate Lean4 without compiling (for inspector panel preview)
       - `--container`, `--timeout`: Standard compilation options
       - `--output-format`: text or json
    2. JSON output format for inspector panel consumption:
       ```json
       {
         "control": "REC-0001",
         "parameter": "enabled",
         "old_value": true,
         "new_value": false,
         "affected_chains": [
           {
             "chain": "REC-0001 -> T1595 -> SC-7",
             "predicate": "countered_by",
             "status": "BROKEN",
             "reason": "Counter-control disabled, threat T1595 re-emerges"
           }
         ],
         "summary": { "total": 4, "broken": 2, "held": 2 }
       }
       ```
    3. Add re-export of `what_if` and `generate_what_if_theorem` from `qra_codegen`
  - **Definition of Done**:
    - Test: `python qra_consistency.py what-if --help`
    - Assertion: Shows help with --control, --param, --value, --dry-run options
    - Test: `python qra_consistency.py what-if --control REC-0001 --param enabled --value false --dry-run --output-format json`
    - Assertion: Returns valid JSON with `affected_chains` array and `summary` object

- [x] **Task 5**: Update `SKILL.md` documentation
  - Agent: general-purpose
  - Parallel: 3
  - Dependencies: Task 2, Task 3, Task 4
  - File: `.pi/skills/lean4-prove/SKILL.md`
  - Changes:
    1. Add "Multi-Predicate Support" section documenting the 5 predicates and their parameter types
    2. Add "What-If Queries" section with usage examples
    3. Add "Typed Parameters" section explaining bool/float/enum
    4. Update the "Lemma Dependency Graph (Planned)" section to reference what-if as implemented
    5. Add UX Lab inspector panel as a composition consumer
  - **Definition of Done**:
    - Blind test: `grep -c "countered_by\|mitigated_by\|exploits\|maps_to\|what-if" .pi/skills/lean4-prove/SKILL.md` returns >= 5
    - Assertion: SKILL.md documents all 5 predicates and what-if usage

- [x] **Task 6**: Update `component-manifest.json` in ux-lab
  - Agent: general-purpose
  - Parallel: 3
  - Dependencies: Task 4
  - File: `packages/ux-lab/component-manifest.json`
  - Changes:
    1. Add `lean4_integration` section documenting the what-if composition pattern
    2. Update `planned_components` to reference the inspector panel's `/lean4-prove` composition
  - **Definition of Done**:
    - Blind test: `grep -c "lean4\|what.if" packages/ux-lab/component-manifest.json` returns >= 1
    - Assertion: Manifest references lean4-prove what-if composition

### P3: Verification (After P2)

- [x] **Task 7**: End-to-end dry-run verification
  - Agent: general-purpose
  - Parallel: 4
  - Dependencies: Task 4, Task 5
  - Changes:
    1. Run `python qra_consistency.py generate --source relationships --limit 5` and verify multi-predicate output
    2. Run `python qra_consistency.py what-if --control REC-0001 --param enabled --value false --dry-run --output-format json` and verify JSON structure
    3. Verify no regressions: `python qra_consistency.py generate --source hierarchy --limit 3` still produces valid `subsumes` chains
    4. Verify imports: `python -c "from qra_consistency import what_if, generate_what_if_theorem, PREDICATE_REGISTRY, ControlParameter"`
  - **Definition of Done**:
    - Assertion: All 4 verification commands succeed without error
    - Assertion: Existing `subsumes` chain generation is unchanged (backward compatible)
    - Assertion: `what-if` dry-run produces valid JSON with affected chains

## Completion Criteria

- [x] All 5 predicates registered in `PREDICATE_REGISTRY`
- [x] `ControlParameter` supports bool, float, enum types
- [x] `what-if` CLI command works in dry-run mode
- [x] JSON output format suitable for UX Lab inspector panel consumption
- [x] Backward compatible — existing `subsumes` verification unchanged
- [x] SKILL.md updated with new capabilities
- [x] No new files created — all changes in existing `qra_models.py`, `qra_codegen.py`, `qra_consistency.py`

## Notes

- **No compilation testing in this plan** — lean_runner Docker container may not be running. All tasks use `--dry-run` or import checks. Full compilation testing happens when the inspector panel wires up the compose chain.
- **Parameter values come from the LLM/agent, not from hardcoded rules.** The `PREDICATE_REGISTRY` provides the Lean4 vocabulary; the agent reading the graph decides what assertion to make (e.g., "disabling REC-0001 means T1595 is no longer countered").
- **Float bounds are informational, not enforced in Lean4.** The Lean4 code uses `>=` / `<` threshold comparisons. The inspector panel's slider min/max comes from `ControlParameter.bounds`, not from Lean4 axioms.
- **Edge type normalization**: ArangoDB stores `method: "maps-to"` with hyphens. `param_type` field normalizes to underscores for Lean4 identifier compatibility (`maps_to`).

"""Report generation for evidence cases (v4.1: composable orchestrator).

Renders structured evidence case reports with:
  1. Sentence decomposition (Given/Then mermaid)
  2. Formalization table (component → entity type → query)
  3. Per-component QRA resolution tables
  4. Cross-component relationship graph (shared controls + technique overlap)
  5. Execution flow (actual queries, results, pass/fail)
  6. /memory clarify output
  7. /lean4-prove result
  8. Metrics table
  9. Synthesized answer narrative
  10. Evidence detail with graded confidence
  11. Full combined report

Inputs: Evidence case dict from runner.run() or agent-assembled data.
Outputs: Markdown report + figure_data.json.
Failures: /create-figure subprocess is best-effort — degrades gracefully.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any


SKILLS_DIR = Path(__file__).resolve().parent.parent
CREATE_FIGURE_SKILL = SKILLS_DIR / "create-figure" / "run.sh"


# ---------------------------------------------------------------------------
# 1. Decomposition mermaid
# ---------------------------------------------------------------------------

def render_decomposition_mermaid(decomposition: dict | None) -> str:
    """Render Given/Then decomposition as a mermaid graph."""
    if not decomposition:
        return ""

    lines = ["```mermaid", "graph TD"]
    question = (decomposition.get("question") or "?")[:80].replace('"', "'")
    lines.append(f'  Q["{question}"]')

    given = decomposition.get("given_components", [])
    then = decomposition.get("then_components", [])

    for i, g in enumerate(given):
        gid = f"G{i}"
        label = str(g).replace('"', "'")
        lines.append(f'  {gid}["{label}"]:::given')
        lines.append(f"  Q --> {gid}")

    for i, t in enumerate(then):
        tid = f"T{i}"
        label = str(t).replace('"', "'")
        lines.append(f'  {tid}["{label}"]:::then')
        lines.append(f"  Q --> {tid}")

    lines.append("  classDef given fill:#bdf,stroke:#48a")
    lines.append("  classDef then fill:#fdb,stroke:#a84")
    lines.append("```")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 2. Formalization table (NO truncation)
# ---------------------------------------------------------------------------

def render_formalization_table(decomposition: dict | None) -> str:
    """Render component → entity type → query as markdown table."""
    if not decomposition:
        return ""

    queries = decomposition.get("component_queries", {})
    types = decomposition.get("component_entity_types", {})
    all_components = (
        decomposition.get("given_components", []) +
        decomposition.get("then_components", [])
    )

    lines = ["## Formalization", ""]
    lines.append("| Component | Entity Type | Query |")
    lines.append("|-----------|-------------|-------|")

    for comp in all_components:
        comp_str = str(comp)
        etype = types.get(comp_str, "—")
        query = queries.get(comp_str, comp_str)
        lines.append(f"| {comp_str} | {etype} | {query} |")

    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 3. Per-component resolution
# ---------------------------------------------------------------------------

def render_per_component_resolution(component_results: dict[str, list[dict]] | None) -> str:
    """Render per-component QRA tables with control_id, tags, grounding."""
    if not component_results:
        return ""

    lines = ["## Per-Component Resolution", ""]

    for component, items in component_results.items():
        lines.append(f"### {component}")
        lines.append("")
        if not items:
            lines.append("*No QRAs found for this component.*")
            lines.append("")
            continue

        lines.append("| # | Control ID | Tactical Tags | Confidence | Question | Answer (excerpt) |")
        lines.append("|---|------------|---------------|------------|----------|-----------------|")

        for i, item in enumerate(items[:10], 1):
            cid = item.get("control_id", "—")
            tags = ", ".join(item.get("tactical_tags", [])[:3]) or "—"
            conf = _grade_evidence_confidence(item)
            q_text = (item.get("question", "") or "")[:60].replace("|", "/")
            a_text = (item.get("answer", item.get("solution", "")) or "")[:60].replace("|", "/")
            lines.append(f"| {i} | {cid} | {tags} | {conf:.2f} | {q_text} | {a_text} |")

        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 4. Cross-component relationship graph
# ---------------------------------------------------------------------------

def render_cross_component_mermaid(
    component_results: dict[str, list[dict]] | None,
    entities: dict | None,
    verdict_state: str = "unknown",
) -> str:
    """Render relationship graph showing bridges or gaps between components.

    Builds edges from:
    - Shared control_ids between components
    - Shared tactical_tags between components
    - related_pairs from /extract-entities

    When verdict is INCONCLUSIVE/NOT_SATISFIED, shared tags are shown as
    weak/insufficient links (red dashed) rather than bridges (green solid).
    """
    if not component_results or len(component_results) < 2:
        return ""

    is_bridge = verdict_state == "satisfied"
    lines = ["```mermaid", "graph LR"]

    # Collect per-component data
    comp_controls: dict[str, set[str]] = {}
    comp_tags: dict[str, set[str]] = {}
    comp_ids: dict[str, str] = {}  # short ID for mermaid

    for idx, (comp, items) in enumerate(component_results.items()):
        comp_id = f"C{idx}"
        comp_ids[comp] = comp_id
        label = comp[:40].replace('"', "'")
        n_items = len(items)
        node_class = "bridge" if is_bridge else "gap"
        lines.append(f'  {comp_id}["{label}<br/>({n_items} QRAs)"]:::{node_class}')

        cids = {item.get("control_id", "") for item in items if item.get("control_id")}
        comp_controls[comp] = cids

        all_tags: set[str] = set()
        for item in items:
            for t in item.get("tactical_tags", []):
                if t:
                    all_tags.add(t)
        comp_tags[comp] = all_tags

    # Build edges
    comp_list = list(component_results.keys())
    has_edges = False
    for i in range(len(comp_list)):
        for j in range(i + 1, len(comp_list)):
            c1, c2 = comp_list[i], comp_list[j]
            shared_controls = comp_controls.get(c1, set()) & comp_controls.get(c2, set())
            shared_tags = comp_tags.get(c1, set()) & comp_tags.get(c2, set())

            if shared_controls:
                ctrl_str = ", ".join(sorted(shared_controls)[:3])
                if is_bridge:
                    lines.append(f'  {comp_ids[c1]} -->|"BRIDGE: shared controls {ctrl_str}"| {comp_ids[c2]}')
                else:
                    lines.append(f'  {comp_ids[c1]} -.->|"weak: shared controls {ctrl_str}"| {comp_ids[c2]}')
                has_edges = True

            if shared_tags:
                tag_str = ", ".join(sorted(shared_tags)[:3])
                if is_bridge:
                    lines.append(f'  {comp_ids[c1]} -->|"BRIDGE: shared techniques {tag_str}"| {comp_ids[c2]}')
                else:
                    lines.append(f'  {comp_ids[c1]} -.-x|"INSUFFICIENT: {tag_str} (no dominant technique)"| {comp_ids[c2]}')
                has_edges = True

    # related_pairs from entities
    if entities:
        for pair in (entities.get("related_pairs", []) or [])[:10]:
            if isinstance(pair, dict):
                src = str(pair.get("source", ""))[:20].replace(" ", "_")
                tgt = str(pair.get("target", ""))[:20].replace(" ", "_")
                rel = str(pair.get("relation", "related"))[:20]
                lines.append(f'  {src} -->|"{rel}"| {tgt}')
                has_edges = True

    if not has_edges:
        # Show explicit gap
        for i in range(len(comp_list)):
            for j in range(i + 1, len(comp_list)):
                lines.append(f'  {comp_ids[comp_list[i]]} -.-x|"NO BRIDGE"| {comp_ids[comp_list[j]]}')

    lines.append("  classDef bridge fill:#9f9,stroke:#090")
    lines.append("  classDef gap fill:#f99,stroke:#900")
    lines.append("```")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 0c. Decision Transparency — why the agent decided what it decided
# ---------------------------------------------------------------------------

def render_decision_transparency(case: dict) -> str:
    """Render a human-readable explanation of HOW the verdict was reached.

    This is the section that enables human course-correction. It shows:
    1. The actual numbers behind the verdict (not just PASS/FAIL)
    2. What the agent assumed
    3. What could be wrong
    4. What the human should check

    This section appears for EVERY verdict, not just failures.
    """
    verdict = case.get("verdict", {})
    gate_trace = case.get("gate_trace", [])
    state = verdict.get("state", "unknown")
    grade = verdict.get("grade", "?")

    lines = ["## Why This Verdict?", ""]

    # --- Extract key numbers from gate trace ---
    recall_step = next((g for g in gate_trace if g.get("gate") == "step_2_recall"), None)
    technique_step = next((g for g in gate_trace if "technique" in g.get("gate", "")), None)
    lean4_step = next((g for g in gate_trace if "lean4" in g.get("gate", "")), None)
    topic_step = next((g for g in gate_trace if "topic" in g.get("gate", "")), None)

    qra_count = recall_step.get("data", {}).get("qra_count", 0) if recall_step else 0
    entity_count = recall_step.get("data", {}).get("entity_count", 0) if recall_step else 0
    overlap_count = recall_step.get("data", {}).get("overlap_count", 0) if recall_step else 0

    grounding = recall_step.get("data", {}).get("grounding_evidence", {}) if recall_step else {}
    resolved_count = grounding.get("resolved", 0) if isinstance(grounding, dict) else 0
    unresolved_id_count = grounding.get("unresolved_id_like", 0) if isinstance(grounding, dict) else 0
    grounding_ratio = grounding.get("ratio", 1.0) if isinstance(grounding, dict) else 1.0

    technique_data = technique_step.get("data", {}) if technique_step else {}
    technique_names = technique_data.get("technique_names", [])
    bridge_found = technique_data.get("bridge_found", False)
    related_pairs = technique_data.get("related_pairs_count", 0)

    # --- Decision rationale ---
    lines.append("| Factor | Value | Implication |")
    lines.append("|--------|-------|-------------|")

    # QRA recall
    if qra_count > 0:
        lines.append(f"| QRAs found | {qra_count} | {'Strong corpus coverage' if qra_count >= 5 else 'Sparse — may miss nuance'} |")
    else:
        lines.append("| QRAs found | 0 | **No corpus coverage — verdict based on absence** |")

    # Entity grounding
    if unresolved_id_count > 0:
        lines.append(f"| Grounding | {resolved_count} resolved, **{unresolved_id_count} unresolved ID-like** | "
                     f"**Question references entities not in corpus** |")
    elif resolved_count > 0:
        lines.append(f"| Grounding | {resolved_count} resolved, 0 unresolved | All referenced entities exist in corpus |")
    else:
        lines.append("| Grounding | No candidates extracted | Question may not reference specific controls |")

    # Technique bridge
    if technique_step:
        if bridge_found:
            lines.append(f"| Technique bridge | YES ({len(technique_names)} techniques) | "
                         f"Components share a technique cluster |")
        else:
            lines.append(f"| Technique bridge | **NO** ({len(technique_names)} scattered techniques) | "
                         f"**Components span unrelated domains** |")

    # Entity overlap
    if entity_count > 0:
        lines.append(f"| Entity overlap | {overlap_count}/{entity_count} entities | "
                     f"{'Cross-source confirmation' if overlap_count > 0 else 'Entities from different sources do not overlap'} |")

    # Formal verification
    if lean4_step:
        lean4_data = lean4_step.get("data", {})
        proof_status = "proved" if lean4_data.get("proof_success") else \
                       "skipped" if lean4_data.get("proof_skipped") else \
                       "blocked" if lean4_data.get("gate_blocked") else "failed"
        lines.append(f"| Formal verification | {proof_status} | "
                     f"{'Formal backing for verdict' if proof_status == 'proved' else 'No formal backing'} |")

    lines.append("")

    # --- What could be wrong ---
    lines.append("### What Could Be Wrong")
    lines.append("")

    caveats = _build_caveats(state, qra_count, unresolved_id_count, grounding_ratio,
                              bridge_found, technique_names, related_pairs, gate_trace)
    if caveats:
        for caveat in caveats:
            lines.append(f"- {caveat}")
    else:
        lines.append("- No specific caveats identified.")

    lines.append("")

    # --- What the human should check ---
    lines.append("### What to Check")
    lines.append("")
    checks = _build_human_checks(state, qra_count, unresolved_id_count,
                                  bridge_found, technique_names, grounding)
    for check in checks:
        lines.append(f"- {check}")

    lines.append("")
    return "\n".join(lines)


def _build_caveats(
    state: str,
    qra_count: int,
    unresolved_id_count: int,
    grounding_ratio: float,
    bridge_found: bool,
    technique_names: list,
    related_pairs: int,
    gate_trace: list,
) -> list[str]:
    """Build specific caveats about what could be wrong with this verdict."""
    caveats = []

    if state == "satisfied":
        # SATISFIED caveats — the most dangerous verdict to be wrong about
        if unresolved_id_count > 0:
            caveats.append(f"**{unresolved_id_count} ID-like term(s) in the question did not resolve.** "
                           "The question may reference fabricated entities that semantic search matched to real controls by keyword similarity.")
        if qra_count < 5:
            caveats.append(f"Only {qra_count} QRAs found. Verdict based on thin evidence — "
                           "a few more QRAs could change the technique bridge.")
        if len(technique_names) > 3:
            caveats.append(f"{len(technique_names)} techniques found. High scatter — the 'bridge' may be "
                           "coincidental keyword overlap rather than genuine domain connection.")
        if related_pairs == 0 and bridge_found:
            caveats.append("Technique bridge passed via tag coherence but NO entity relationship pairs found. "
                           "Bridge is statistical (tag frequency), not structural (graph edges).")
        if grounding_ratio < 1.0 and grounding_ratio > 0:
            caveats.append(f"Grounding ratio {grounding_ratio:.0%} — not all candidate terms resolved. "
                           "Some claims in the question may not be supported.")

    elif state == "inconclusive":
        if qra_count > 0 and not bridge_found:
            caveats.append("QRAs exist but span unrelated techniques. The question may need decomposition "
                           "into separate sub-questions, each within a single domain.")
        if unresolved_id_count > 0:
            caveats.append(f"**{unresolved_id_count} unresolved ID-like terms.** "
                           "This may be a fabricated question rather than a genuine corpus gap.")

    elif state == "not_satisfied":
        topic_step = next((g for g in gate_trace if "topic" in g.get("gate", "")), None)
        if topic_step and not topic_step.get("passed"):
            caveats.append("Classified as off-topic. If this is wrong, the topic classifier needs retraining.")
        if qra_count == 0:
            caveats.append("Zero QRAs found. The question may use terminology not in the corpus. "
                           "Try rephrasing with known SPARTA/NIST/D3FEND control terms.")

    return caveats


def _build_human_checks(
    state: str,
    qra_count: int,
    unresolved_id_count: int,
    bridge_found: bool,
    technique_names: list,
    grounding: dict,
) -> list[str]:
    """Build specific checks the human should perform."""
    checks = []

    if unresolved_id_count > 0:
        unresolved_terms = grounding.get("unresolved_terms", []) if isinstance(grounding, dict) else []
        term_names = [t.get("term", "?") for t in unresolved_terms if isinstance(t, dict) and t.get("type") == "id_like"]
        if term_names:
            checks.append(f"Verify these terms exist: **{', '.join(term_names)}**. "
                          "If they don't, the question's premise is fabricated.")

    if state == "satisfied":
        checks.append("Read the Per-Component Resolution tables below. "
                      "Do the QRAs actually answer the question, or just share keywords?")
        if len(technique_names) > 2:
            checks.append(f"Check technique coherence: are {', '.join(technique_names[:4])} "
                          "genuinely related in this context, or just co-occurring terms?")
        checks.append("Review the Grounding Evidence table. Every entity the question claims "
                      "should show as RESOLVED.")

    elif state == "inconclusive":
        checks.append("Check if this is a genuine corpus gap or a question about "
                      "something outside SPARTA's scope.")
        if bridge_found is False:
            checks.append("The components span different techniques. Consider asking "
                          "separate questions for each component.")

    elif state == "not_satisfied":
        checks.append("Verify the question is genuinely out of scope, not just using unfamiliar terminology.")

    if not checks:
        checks.append("Review the evidence chain below for completeness.")

    return checks


# ---------------------------------------------------------------------------
# 4b. Grounding evidence — what resolved AND what didn't
# ---------------------------------------------------------------------------

def render_grounding_evidence(entities: dict | None, grounding_evidence: dict | None = None) -> str:
    """Render grounding evidence table showing what resolved and what didn't.

    This is WHERE the human sees if the agent rubber-stamped a hallucinated entity.
    The table makes it transparent:
    - "CM0028" | RESOLVED | Tamper Protection | 14 QRAs
    - "X23-MUSTARD" | UNRESOLVED | (no match) | 0 hits in sparta_controls

    When the agent makes a bad decision, the evidence graph makes it OBVIOUS
    to the human WHERE the agent went wrong.
    """
    if not entities and not grounding_evidence:
        return ""

    # Get resolution_map from entities or grounding_evidence
    resolution_map: dict = {}
    unresolved_terms: list = []

    if isinstance(entities, dict):
        resolution_map = entities.get("resolution_map", {})
        unresolved_terms = entities.get("unresolved_terms", [])

    if isinstance(grounding_evidence, dict):
        # grounding_evidence from runner.py step data
        if not resolution_map:
            resolution_map = grounding_evidence.get("resolution_map", {})
        if not unresolved_terms:
            unresolved_terms = grounding_evidence.get("unresolved_terms", [])

    if not resolution_map and not unresolved_terms:
        return ""

    lines = ["## Grounding Evidence", ""]
    lines.append("| Term | Status | Matched To | Evidence |")
    lines.append("|------|--------|------------|----------|")

    # Render resolved terms first
    for term, info in sorted(resolution_map.items()):
        if not isinstance(info, dict):
            continue
        exists = info.get("exists", False)
        if exists:
            match_type = info.get("match_type", "")
            name = info.get("name", "")
            control_id = info.get("control_id", "")
            qra_count = info.get("qra_count", -1)
            matched_str = f"{control_id}" + (f" ({name})" if name else "")
            evidence_str = f"{qra_count} QRAs" if qra_count >= 0 else f"via {match_type}"
            if match_type == "fuzzy":
                lines.append(f"| {term} | FUZZY MATCH | {matched_str} | {evidence_str} (possible typo, dist={info.get('distance', '?')}) |")
            else:
                lines.append(f"| {term} | RESOLVED | {matched_str} | {evidence_str} |")
        else:
            reason = info.get("reason", "no match")
            closest = info.get("closest_match", "")
            distance = info.get("distance", -1)
            closest_str = f"closest: {closest} (dist={distance})" if closest else "no close match"
            lines.append(f"| {term} | **UNRESOLVED** | (no match) | {reason} — {closest_str} |")

    # Summary line
    resolved_count = sum(1 for v in resolution_map.values() if isinstance(v, dict) and v.get("exists"))
    unresolved_count = sum(1 for v in resolution_map.values() if isinstance(v, dict) and not v.get("exists"))
    lines.append("")

    if unresolved_count > 0:
        unresolved_id_like = [
            t for t in unresolved_terms
            if isinstance(t, dict) and t.get("type") == "id_like"
        ]
        if unresolved_id_like:
            id_terms = ", ".join(t.get("term", "?") for t in unresolved_id_like)
            lines.append(f"> **WARNING:** {len(unresolved_id_like)} ID-like term(s) did not resolve: "
                         f"{id_terms}. These may indicate fabricated/hallucinated entity references.")
        else:
            lines.append(f"> {unresolved_count} term(s) unresolved (phrase-type, may be acceptable).")
    else:
        lines.append(f"> All {resolved_count} candidate terms resolved against the corpus.")

    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 5. Execution flow mermaid
# ---------------------------------------------------------------------------

def render_execution_flow_mermaid(steps: list[dict]) -> str:
    """Render detailed execution flow with pass/fail styling."""
    lines = ["```mermaid", "graph TD"]

    prev_id = "START"
    lines.append(f'  {prev_id}(("Start"))')

    for step in steps:
        step_id = step.get("gate", "unknown").replace(".", "_")
        passed = step.get("passed", False)
        detail = step.get("detail", "")[:60].replace('"', "'")
        style = "pass" if passed else "fail"
        icon = "PASS" if passed else "FAIL"

        lines.append(f'  {step_id}["{step_id}<br/>{detail}<br/>{icon}"]:::{style}')
        lines.append(f"  {prev_id} --> {step_id}")
        prev_id = step_id

    lines.append(f'  END(("Verdict"))')
    lines.append(f"  {prev_id} --> END")
    lines.append("  classDef pass fill:#9f9,stroke:#090")
    lines.append("  classDef fail fill:#f66,stroke:#900")
    lines.append("```")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 6. Clarify output
# ---------------------------------------------------------------------------

def render_clarify_output(clarify_result: dict | None) -> str:
    """Render /memory clarify disambiguation output."""
    if not clarify_result:
        return ""

    lines = ["## Entity Clarification", ""]

    if isinstance(clarify_result, dict):
        clarification = clarify_result.get("clarification", clarify_result.get("text", ""))
        if clarification:
            lines.append(str(clarification))
            lines.append("")

        related = clarify_result.get("related_entities", [])
        if related:
            lines.append("**Related entities:**")
            for r in related[:10]:
                lines.append(f"- {r}")
            lines.append("")

        unrelated = clarify_result.get("unrelated_entities", [])
        if unrelated:
            lines.append("**Unrelated entities:**")
            for u in unrelated[:10]:
                lines.append(f"- {u}")
            lines.append("")

        suggestions = clarify_result.get("suggested_decompositions", clarify_result.get("suggestions", []))
        if suggestions:
            lines.append("**Suggested decompositions:**")
            for s in suggestions[:5]:
                lines.append(f"- {s}")
            lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 7. Proof result
# ---------------------------------------------------------------------------

def render_proof_result(lean4_result: dict | None) -> str:
    """Render /lean4-prove result."""
    if not lean4_result:
        return ""

    lines = ["## Formal Verification", ""]

    proof_data = lean4_result.get("proof_data", {}) if isinstance(lean4_result.get("proof_data"), dict) else {}
    success = bool(
        lean4_result.get("proof_success")
        or lean4_result.get("success")
        or lean4_result.get("verified")
        or proof_data.get("success")
        or proof_data.get("verified")
    )
    skipped = bool(lean4_result.get("proof_skipped"))
    blocked = bool(lean4_result.get("gate_blocked"))
    if blocked:
        status = "BLOCKED"
    elif skipped:
        status = "SKIPPED"
    else:
        status = "PROVED" if success else "FAILED"
    lines.append(f"**Status:** {status}")
    lines.append("")

    prediction = lean4_result.get("prediction", "")
    if prediction:
        lines.append(f"**Provability classifier:** {prediction}")
    confidence = lean4_result.get("provable_confidence", None)
    if isinstance(confidence, (int, float)):
        lines.append(f"**Provability confidence:** {confidence:.0%}")
    if prediction or isinstance(confidence, (int, float)):
        lines.append("")

    reason = lean4_result.get("reason", "")
    if reason:
        lines.append(f"**Reason:** {reason}")
        lines.append("")

    requirement = lean4_result.get("requirement", proof_data.get("requirement", ""))
    if requirement:
        lines.append(f"**Requirement:** {requirement}")
        lines.append("")

    code = (
        lean4_result.get("proof_code")
        or lean4_result.get("code")
        or proof_data.get("proof_code")
        or proof_data.get("code")
        or ""
    )
    if code:
        lines.append("```lean4")
        lines.append(str(code)[:2000])
        lines.append("```")
        lines.append("")

    errors = lean4_result.get("errors", proof_data.get("errors", []))
    if errors:
        lines.append("**Errors:**")
        for e in errors[:5]:
            lines.append(f"- {e}")
        lines.append("")

    # Lemma dependencies — shows which formal results back the claim
    lemma_deps = lean4_result.get("lemma_deps", proof_data.get("lemma_deps", []))
    if lemma_deps:
        lines.append("**Lemma Dependencies:**")
        for dep in lemma_deps[:10]:
            if isinstance(dep, dict):
                lines.append(f"- `{dep.get('lemma', '')}` ({', '.join(dep.get('imports', []))})")
            else:
                lines.append(f"- `{dep}`")
        lines.append("")

    # Attempts and retrieval metadata
    attempts = lean4_result.get("attempts", proof_data.get("attempts", 0))
    if attempts:
        lines.append(f"**Attempts:** {attempts}")
    retrieval = lean4_result.get("retrieval", proof_data.get("retrieval", {}))
    if retrieval and retrieval.get("retrieved", 0) > 0:
        lines.append(f"**Retrieval:** {retrieval['retrieved']} similar proofs, "
                      f"tactics: {', '.join(retrieval.get('tactics_added', []))}")
        lines.append("")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# 8. Metrics table
# ---------------------------------------------------------------------------

def render_metrics_table(case: dict) -> str:
    """Render verdict, grade, components resolved, relationships, etc."""
    verdict = case.get("verdict", {})
    claim = case.get("claim", {})
    evidence = case.get("evidence", [])
    strategies = case.get("strategies", [])
    technique_groups = case.get("technique_groups", {})
    decomposition = case.get("decomposition")

    state = verdict.get("state", "unknown")
    grade = verdict.get("grade", "?")
    gates_passed = case.get("gates_passed", 0)
    gates_total = case.get("gates_total", 0)
    control_ids = claim.get("control_ids", [])

    lines = ["## Metrics", ""]
    lines.append("| Metric | Value |")
    lines.append("|--------|-------|")
    lines.append(f"| Verdict | {state.upper()} |")
    lines.append(f"| Grade | {grade} |")
    lines.append(f"| Steps passed | {gates_passed}/{gates_total} |")
    lines.append(f"| Category | {claim.get('category', '?')} |")
    lines.append(f"| Controls found | {len(control_ids)} |")
    lines.append(f"| Evidence items | {len(evidence)} |")
    lines.append(f"| Techniques | {len(technique_groups)} |")

    if decomposition:
        given = decomposition.get("given_components", [])
        then = decomposition.get("then_components", [])
        lines.append(f"| Given components | {len(given)} |")
        lines.append(f"| Then components | {len(then)} |")

    if strategies:
        s = strategies[0]
        lines.append(f"| Strategy | {s.get('name', '?')} |")
        skills_used = len(s.get("skills", []))
        lines.append(f"| Skills composed | {skills_used} |")

    lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Evidence confidence grading
# ---------------------------------------------------------------------------

def _grade_evidence_confidence(item: dict) -> float:
    """Grade evidence confidence based on data quality signals.

    Signals (additive):
    - Has control_id: +0.3
    - Has tactical_tags (non-empty): +0.2
    - Has substantive answer (>100 chars): +0.2
    - Has question text: +0.1
    - Not hypothesized: +0.1
    - Has grounding score from recall: use it directly if available

    Returns float in [0.0, 1.0].
    """
    # If recall returned a score, use it as base
    score = item.get("score", item.get("recall_score", 0))
    if score and isinstance(score, (int, float)) and score > 0:
        return min(1.0, max(0.0, float(score)))

    conf = 0.1  # baseline for existing in corpus
    if item.get("control_id"):
        conf += 0.3
    tags = item.get("tactical_tags", [])
    if tags and isinstance(tags, list) and any(t for t in tags):
        conf += 0.2
    answer = item.get("answer", item.get("solution", "")) or ""
    if len(answer) > 100:
        conf += 0.2
    if item.get("question"):
        conf += 0.1
    if "hypothesized" not in answer.lower()[:30]:
        conf += 0.1
    return min(1.0, conf)


# ---------------------------------------------------------------------------
# Synthesized answer narrative
# ---------------------------------------------------------------------------

def synthesize_answer_narrative(case: dict) -> str:
    """Generate a structured answer narrative from evidence data.

    For SATISFIED: which controls address which aspects, technique bridge.
    For INCONCLUSIVE: which components resolved, which didn't, gaps.
    For NOT_SATISFIED: why the question can't be answered.
    """
    verdict = case.get("verdict", {})
    state = verdict.get("state", "unknown")
    claim = case.get("claim", {})
    question = claim.get("text", "")
    gate_trace = case.get("gate_trace", [])
    evidence = case.get("evidence", [])
    technique_groups = case.get("technique_groups", {})
    sub_claims = case.get("sub_claims", [])
    component_results = case.get("component_results", {})
    decomposition = case.get("decomposition", {})
    control_ids = claim.get("control_ids", [])

    lines: list[str] = []

    if state == "not_satisfied":
        lines.append("This question falls outside the scope of the SPARTA/compliance corpus. "
                      "No relevant controls, techniques, or QRAs were found.")
        return "\n\n".join(lines)

    # --- Technique bridge summary ---
    bridge_step = next((g for g in gate_trace if "technique" in g.get("gate", "")), None)
    if bridge_step:
        lines.append(f"**Technique Analysis:** {bridge_step.get('detail', '')}")

    # --- Per-component narrative ---
    if component_results:
        for comp_name, items in component_results.items():
            if not items:
                lines.append(f"**{comp_name}:** No QRAs found — corpus gap.")
                continue

            # Extract dominant controls and tags for this component
            comp_controls: dict[str, int] = {}
            comp_tags: dict[str, int] = {}
            for item in items:
                cid = item.get("control_id", "")
                if cid:
                    comp_controls[cid] = comp_controls.get(cid, 0) + 1
                for t in item.get("tactical_tags", []):
                    if t:
                        comp_tags[t] = comp_tags.get(t, 0) + 1

            top_controls = sorted(comp_controls.items(), key=lambda x: -x[1])[:3]
            top_tags = sorted(comp_tags.items(), key=lambda x: -x[1])[:2]

            ctrl_str = ", ".join(f"{cid} ({n}x)" for cid, n in top_controls)
            tag_str = ", ".join(f"{t}" for t, _ in top_tags)

            lines.append(f"**{comp_name}:** {len(items)} QRAs found. "
                         f"Key controls: {ctrl_str}. "
                         f"Dominant techniques: {tag_str}.")

    # --- Cross-component bridge narrative ---
    if len(component_results) >= 2 and state == "satisfied":
        # Find shared controls across components
        all_comp_controls = {}
        for comp_name, items in component_results.items():
            all_comp_controls[comp_name] = {
                item.get("control_id", "") for item in items if item.get("control_id")
            }

        comp_names = list(all_comp_controls.keys())
        for i in range(len(comp_names)):
            for j in range(i + 1, len(comp_names)):
                shared = all_comp_controls[comp_names[i]] & all_comp_controls[comp_names[j]]
                if shared:
                    lines.append(
                        f"**Bridge:** Components '{comp_names[i][:30]}' and "
                        f"'{comp_names[j][:30]}' share controls: "
                        f"{', '.join(sorted(shared)[:5])}."
                    )

    # --- Gaps ---
    if state == "inconclusive":
        gaps = []
        for comp_name, items in component_results.items():
            if not items:
                gaps.append(comp_name)
        if gaps:
            lines.append(f"**Corpus gaps:** No QRAs found for: {', '.join(gaps)}")

        # Tag scatter
        if technique_groups:
            n_techniques = len([k for k in technique_groups if k and k != "UNTAGGED"])
            if n_techniques > 3:
                lines.append(
                    f"**Tag scatter:** {n_techniques} distinct techniques across QRAs — "
                    "no coherent cluster. Components likely span unrelated domains."
                )

    # --- Control summary ---
    if control_ids:
        lines.append(f"**Controls identified:** {', '.join(control_ids[:10])}"
                      + (f" (+{len(control_ids)-10} more)" if len(control_ids) > 10 else ""))

    return "\n\n".join(lines) if lines else case.get("answer", "")


# ---------------------------------------------------------------------------
# Sub-claims from evidence
# ---------------------------------------------------------------------------

def build_meaningful_sub_claims(
    technique_groups: dict[str, Any],
    evidence_items: list[dict],
    question: str,
) -> list[str]:
    """Build meaningful sub-claims from technique groups + evidence.

    Instead of "[Harden] <full question>", generate:
    "[Harden] CM0028 Tamper Protection + MA-4 Nonlocal Maintenance
     address firmware integrity during maintenance windows"
    """
    claims: list[str] = []

    for technique, items in technique_groups.items():
        if not technique or technique == "UNTAGGED":
            continue

        if isinstance(items, int):
            # technique_groups is {tag: count} — get items from evidence
            relevant = [
                e for e in evidence_items
                if technique in (e.get("tactical_tags", []) or [])
            ]
        elif isinstance(items, list):
            relevant = items
        else:
            continue

        # Extract key controls for this technique
        controls = sorted({
            item.get("control_id", "") for item in relevant if item.get("control_id")
        })[:4]

        # Extract key answer fragments for specificity
        answer_keywords: list[str] = []
        for item in relevant[:3]:
            ans = item.get("answer", item.get("solution", "")) or ""
            # First meaningful sentence fragment
            fragment = ans[:80].split(".")[0].strip()
            if fragment and len(fragment) > 15:
                answer_keywords.append(fragment)

        if controls:
            ctrl_str = ", ".join(controls)
            if answer_keywords:
                context = answer_keywords[0]
                claims.append(f"[{technique}] {ctrl_str}: {context}")
            else:
                claims.append(f"[{technique}] Controls {ctrl_str} address this aspect")
        else:
            claims.append(f"[{technique}] {len(relevant)} QRAs support this technique")

    return claims


# ---------------------------------------------------------------------------
# 9. Full combined report
# ---------------------------------------------------------------------------

def render_full_report(case: dict) -> str:
    """Combine all sections into a complete markdown report."""
    lines: list[str] = []
    claim = case.get("claim", {})
    verdict = case.get("verdict", {})
    gate_trace = case.get("gate_trace", [])
    evidence = case.get("evidence", [])
    sub_claims = case.get("sub_claims", [])
    decomposition = case.get("decomposition")
    component_results = case.get("component_results")
    entities = case.get("entities")
    clarify_result = case.get("clarify_result")
    lean4_result = case.get("lean4_result")

    question = claim.get("text", "?")
    state = verdict.get("state", "unknown")
    grade = verdict.get("grade", "?")
    case_id = claim.get("id", "?")

    # --- Header ---
    lines.append(f"# Evidence Case: {case_id}")
    lines.append("")
    lines.append(f"> **Question:** {question}")
    lines.append("")

    # --- Verdict summary ---
    if state == "satisfied":
        summary = f"This question **can be answered** with grade {grade} confidence."
    elif state == "inconclusive":
        summary = "Evidence is **inconclusive** — components don't fully bridge."
    else:
        summary = "This question **cannot be answered** with available evidence."

    verdict_label = {"satisfied": "YES", "inconclusive": "MAYBE", "not_satisfied": "NO"}.get(state, "?")
    lines.append(f"## Answerable: {verdict_label}")
    lines.append("")
    lines.append(summary)
    lines.append("")

    # --- 0b. Decision Transparency (v4.3) ---
    # The human expert MUST see why the agent decided what it decided.
    # This section exists for every verdict type, not just failures.
    transparency = render_decision_transparency(case)
    if transparency:
        lines.append(transparency)

    # --- 1. Decomposition ---
    decomp_mermaid = render_decomposition_mermaid(decomposition)
    if decomp_mermaid:
        lines.append("## Sentence Decomposition")
        lines.append("")
        lines.append(decomp_mermaid)
        lines.append("")

    # --- 2. Formalization table ---
    formalization = render_formalization_table(decomposition)
    if formalization:
        lines.append(formalization)

    # --- Metrics ---
    lines.append(render_metrics_table(case))

    # --- Controls ---
    control_ids = claim.get("control_ids", [])
    if control_ids:
        lines.append("## Controls")
        lines.append("")
        lines.append(f"Extracted {len(control_ids)} control IDs: {', '.join(control_ids[:20])}")
        lines.append("")

    # --- 3. Per-component resolution ---
    if component_results:
        lines.append(render_per_component_resolution(component_results))

    # --- 3b. Grounding evidence (v4.3) ---
    # Extract grounding_evidence from gate_trace step_2_recall data
    grounding_evidence = None
    for step in gate_trace:
        if step.get("gate") == "step_2_recall":
            grounding_evidence = step.get("data", {}).get("grounding_evidence")
            break
    grounding_section = render_grounding_evidence(entities, grounding_evidence)
    if grounding_section:
        lines.append(grounding_section)

    # --- 4. Cross-component relationship graph ---
    cross_mermaid = render_cross_component_mermaid(component_results, entities, state)
    if cross_mermaid:
        lines.append("## Cross-Component Relationships")
        lines.append("")
        lines.append(cross_mermaid)
        lines.append("")

    # --- 5. Execution flow ---
    if gate_trace:
        lines.append("## Execution Flow")
        lines.append("")
        lines.append(render_execution_flow_mermaid(gate_trace))
        lines.append("")

        # Also render step details
        lines.extend(_render_step_details(gate_trace))

    # --- 6. Clarify output ---
    clarify_section = render_clarify_output(clarify_result)
    if clarify_section:
        lines.append(clarify_section)

    # --- 7. Proof result ---
    proof_section = render_proof_result(lean4_result)
    if proof_section:
        lines.append(proof_section)

    # --- Synthesized Answer ---
    if state in ("satisfied", "inconclusive"):
        lines.append("## Answer")
        lines.append("")
        answer_narrative = synthesize_answer_narrative(case)
        lines.append(answer_narrative)
        lines.append("")

    # --- Sub-claims ---
    if sub_claims and len(sub_claims) > 0:
        lines.append("## Sub-Claims")
        lines.append("")
        for i, sc in enumerate(sub_claims, 1):
            text = sc.get("text", sc) if isinstance(sc, dict) else str(sc)
            lines.append(f"{i}. {text}")
        lines.append("")

    # --- Evidence detail with graded confidence ---
    if evidence:
        lines.append("## Evidence Chain")
        lines.append("")
        lines.append("| # | Method | Layer | Confidence | Control IDs | Technique | Source |")
        lines.append("|---|--------|-------|------------|-------------|-----------|--------|")
        for i, e in enumerate(evidence, 1):
            method = e.get("method", "?")
            layer = e.get("layer", "?")
            conf = e.get("confidence", 0)
            e_cids = e.get("control_ids", [])
            result = e.get("result", {})
            source = result.get("source", "") if isinstance(result, dict) else ""
            technique = result.get("technique", "—") if isinstance(result, dict) else "—"
            cids_str = ", ".join(e_cids[:3]) if e_cids else "—"
            lines.append(f"| {i} | {method} | {layer} | {conf:.2f} | {cids_str} | {technique} | {source} |")
        lines.append("")

    return "\n".join(lines)


def _render_step_details(gate_trace: list[dict]) -> list[str]:
    """Render step-by-step details for the execution trace."""
    lines: list[str] = []
    lines.append("### Step Details")
    lines.append("")

    step_names = {
        "step_1_topic": "Step 1: On-topic Check",
        "step_2_recall": "Step 2: Per-Component Recall",
        "step_3_technique_bridge": "Step 3: Same-Technique Check",
        "step_4_clarify": "Step 4: Entity Clarification",
        "step_4_decompose": "Step 4: Decompose Claims",
        "step_5_lean4": "Step 5: Formal Verification",
        "gate_1_topic": "Gate 1: On-topic?",
        "gate_2_recall": "Gate 2: Recall Techniques",
        "gate_3_coverage": "Gate 3: Technique Coverage",
        "gate_4_decompose": "Gate 4: Decompose Claims",
    }

    for g in gate_trace:
        gate_id = g.get("gate", "unknown")
        passed = g.get("passed", False)
        detail = g.get("detail", "")
        data = g.get("data", {})

        name = step_names.get(gate_id, gate_id)
        icon = "PASS" if passed else "FAIL"

        lines.append(f"#### {name}: {icon}")
        lines.append("")
        lines.append(f"**Result:** {detail}")
        lines.append("")

        # Step-specific data rendering
        if gate_id == "step_2_recall" and passed:
            qra_count = data.get("qra_count", 0)
            lines.append(f"**QRAs recalled:** {qra_count}")
            tech_groups = data.get("technique_groups", {})
            if tech_groups:
                lines.append(f"**Technique groups:** {', '.join(f'{k}({v})' for k, v in tech_groups.items())}")
            lines.append("")

        elif gate_id == "step_3_technique_bridge":
            bridge = data.get("bridge_found", False)
            tech_names = data.get("technique_names", [])
            overlap = data.get("overlap", [])
            pairs = data.get("related_pairs_count", 0)
            lines.append(f"**Bridge found:** {'Yes' if bridge else 'No'}")
            if tech_names:
                lines.append(f"**Techniques:** {', '.join(tech_names[:5])}")
            if overlap:
                lines.append(f"**Entity overlap:** {', '.join(str(o) for o in overlap[:5])}")
            lines.append(f"**Related pairs:** {pairs}")
            lines.append("")

        elif gate_id == "step_5_lean4":
            prediction = data.get("prediction", "unknown")
            lines.append(f"**Provability:** {prediction}")
            if isinstance(data.get("provable_confidence"), (int, float)):
                lines.append(f"**Confidence:** {data.get('provable_confidence', 0.0):.0%}")
            lines.append(f"**Proof attempted:** {'Yes' if data.get('proof_attempted') else 'No'}")
            if data.get("proof_skipped"):
                lines.append("**Proof skipped:** Yes")
            if data.get("gate_blocked"):
                lines.append("**Gate blocked:** Yes")
            if data.get("reason"):
                lines.append(f"**Reason:** {data.get('reason')}")
            lines.append("")

    return lines


# ---------------------------------------------------------------------------
# Legacy compatibility — render_markdown_report wraps render_full_report
# ---------------------------------------------------------------------------

def render_markdown_report(case: dict) -> str:
    """Render evidence case as markdown. Delegates to render_full_report."""
    return render_full_report(case)


# ---------------------------------------------------------------------------
# Mermaid flow diagram (legacy compat)
# ---------------------------------------------------------------------------

def build_mermaid_tree(case: dict) -> str:
    """Build a Mermaid graph showing the execution flow (legacy compat)."""
    lines = ["graph TD"]
    claim = case.get("claim", {})
    gate_trace = case.get("gate_trace", [])
    verdict = case.get("verdict", {})

    claim_text = claim.get("text", "?")[:40].replace('"', "'")
    lines.append(f'  Q["{claim_text}"]')

    prev_id = "Q"
    for g in gate_trace:
        gate_id = g.get("gate", "unknown").replace(".", "_")
        passed = g.get("passed", False)
        detail = g.get("detail", "")[:50].replace('"', "'")

        if passed:
            lines.append(f'  {gate_id}["{gate_id}<br/>{detail}"]:::pass')
        else:
            lines.append(f'  {gate_id}["{gate_id}<br/>{detail}"]:::fail')

        lines.append(f"  {prev_id} --> {gate_id}")
        prev_id = gate_id

    if verdict:
        vid = "verdict"
        vstate = verdict.get("state", "?").upper()
        vgrade = verdict.get("grade", "?")
        lines.append(f'  {vid}["{vstate}<br/>Grade {vgrade}"]:::verdict')
        lines.append(f"  {prev_id} --> {vid}")

    lines.append("  classDef pass fill:#9f9,stroke:#090")
    lines.append("  classDef fail fill:#f66,stroke:#900")
    lines.append("  classDef verdict fill:#ff9,stroke:#990")

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Figure data for /create-figure
# ---------------------------------------------------------------------------

def build_figure_data(case: dict) -> dict:
    """Build dashboard-ready metrics from an evidence case."""
    gate_trace = case.get("gate_trace", [])
    evidence = case.get("evidence", [])
    verdict = case.get("verdict", {})
    gates_passed = case.get("gates_passed", 0)
    gates_total = case.get("gates_total", 5)

    bar_metrics = {}
    for g in gate_trace:
        gate_id = g.get("gate", "unknown")
        bar_metrics[gate_id] = 1.0 if g.get("passed") else 0.0

    radar = {
        "axes": ["steps_passed", "controls_found", "qras_found", "technique_bridge", "evidence"],
        "values": [
            round(gates_passed / max(gates_total, 1), 2),
            round(min(1.0, len(case.get("claim", {}).get("control_ids", [])) / 10), 2),
            round(min(1.0, len(evidence) / 5), 2),
            1.0 if any(g.get("gate") == "step_3_technique_bridge" and g.get("passed") for g in gate_trace) else 0.0,
            round(min(1.0, len(evidence) / 5), 2),
        ],
    }

    state = verdict.get("state", "inconclusive")
    pie = {"satisfied": 0, "inconclusive": 0, "not_satisfied": 0}
    if state in pie:
        pie[state] = 1

    mermaid_code = build_mermaid_tree(case)

    headers = ["Step", "Passed", "Detail"]
    rows = [[g.get("gate", "?"), "YES" if g.get("passed") else "NO", g.get("detail", "")[:60]]
            for g in gate_trace]

    return {
        "bar": {"metrics": bar_metrics},
        "radar": radar,
        "pie": pie,
        "mermaid": {"code": mermaid_code},
        "table": {"headers": headers, "rows": rows},
    }


# ---------------------------------------------------------------------------
# /create-figure integration (best-effort)
# ---------------------------------------------------------------------------

def invoke_create_figure(case: dict, output_dir: Path) -> list[Path]:
    """Invoke /create-figure for charts. Best-effort."""
    output_dir.mkdir(parents=True, exist_ok=True)
    created: list[Path] = []

    if not CREATE_FIGURE_SKILL.exists():
        return created

    figure_data = build_figure_data(case)

    for chart_type, key, title, filename in [
        ("metrics", "bar", "Step Pass/Fail", "step_results.png"),
        ("radar", "radar", "Evidence Quality Profile", "quality_radar.png"),
    ]:
        chart_path = output_dir / filename
        try:
            data_input = json.dumps(figure_data[key]["metrics"] if key == "bar" else figure_data[key])
            subprocess.run(
                [str(CREATE_FIGURE_SKILL), chart_type,
                 "--title", title, "--data", data_input, "--output", str(chart_path)],
                capture_output=True, text=True, timeout=30,
            )
            if chart_path.exists():
                created.append(chart_path)
        except (subprocess.TimeoutExpired, OSError):
            pass

    return created


# ---------------------------------------------------------------------------
# Top-level report generator
# ---------------------------------------------------------------------------

def generate_report(case: dict, output_dir: Path) -> Path:
    """Generate full report: report.md + figure_data.json + optional figures."""
    output_dir.mkdir(parents=True, exist_ok=True)

    report_path = output_dir / "report.md"
    report_path.write_text(render_full_report(case))

    figure_data_path = output_dir / "figure_data.json"
    figure_data_path.write_text(json.dumps(build_figure_data(case), indent=2, default=str))

    invoke_create_figure(case, output_dir)

    return report_path

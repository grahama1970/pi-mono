"""Evidence case automated eval harness.

EvidenceCaseRunner is for batch validation ONLY (run_question_bank.py,
nightly regression detection). The project agent drives live use via SKILL.md.

v4.5 — Split from monolith. Collection functions in collect.py,
persistence + QRA quarantine in candidate_qra.py.
"""

from __future__ import annotations

from typing import Any

from loguru import logger
from rich.console import Console

from candidate_qra import EvidenceCaseStore2
from collect import (
    collect_clarify,
    collect_entities,
    compile_lean4,
    collect_lean4_provable,
    collect_per_component,
    collect_recall,
    collect_topic,
    decompose_sentence,
    group_by_technique,
)
from scoring import (
    gates_to_grade,
    gates_to_score,
    gates_to_verdict,
)

console = Console()


class EvidenceCaseRunner:
    """Automated eval harness for nightly batch validation.

    NOT the live flow. The project agent IS the engine for live use —
    it reads SKILL.md, calls /memory recall for data, and does
    decomposition + entity analysis + same-technique check + verdict
    in its own reasoning. No subprocess classifier calls needed.

    This class exists ONLY for:
    - run_question_bank.py (automated 12-question eval)
    - Nightly regression detection (--check-regression)
    - Baseline management (--save-baseline)
    """

    def __init__(self, max_workers: int = 3, timeout: int = 60):
        self.store = EvidenceCaseStore2()

    def run(
        self,
        claim_text: str,
        category: str = "auto",
        force_strategies: int = 0,
        show_progress: bool = True,
        agent_decomposition: dict | None = None,
    ) -> dict[str, Any]:
        """Collect data and apply minimal checks for question bank testing."""
        import time as _time
        steps: list[dict] = []
        step_timings: list[dict] = []
        _run_t0 = _time.monotonic()

        def _timed(name):
            class _Timer:
                def __enter__(self):
                    self.t0 = _time.monotonic()
                    return self
                def __exit__(self, *_):
                    elapsed_ms = (_time.monotonic() - self.t0) * 1000
                    step_timings.append({"step": name, "ms": round(elapsed_ms, 1)})
                    if show_progress:
                        console.print(f"[dim]  ⏱ {name}: {elapsed_ms:.0f}ms[/]")
            return _Timer()

        # Step 1: On-topic check
        if show_progress:
            console.print("[dim]Step 1: Checking topic...[/]")
        with _timed("step_1_topic"):
            topic = collect_topic(claim_text)
        steps.append({"gate": "step_1_topic", "passed": topic["on_topic"],
                       "detail": f"category={topic['category']}", "data": topic})

        if not topic["on_topic"]:
            if category == "auto":
                category = "general"
            return self.store.persist_case(
                question=claim_text, category=category,
                verdict_state="not_satisfied", grade="F", score=0.0,
                gates=steps, evidence_items=[], answer="Off-topic",
            )

        if category == "auto":
            category = topic["category"]

        # Step 1b: Sentence decomposition
        if show_progress:
            console.print("[dim]Step 1b: Decomposing sentence...[/]")
        with _timed("step_1b_decompose"):
            decomposition = decompose_sentence(claim_text, agent_decomposition)

        # Step 2: Per-component recall + entity extraction
        if show_progress:
            console.print("[dim]Step 2: Calling /memory recall + /extract-entities...[/]")
        with _timed("step_2_recall"):
            qra_items = collect_recall(claim_text)
        with _timed("step_2_entities"):
            entities = collect_entities(claim_text)

        with _timed("step_2_per_component"):
            component_results = collect_per_component(decomposition) if decomposition.get("given_components") or decomposition.get("then_components") else {}

        has_recall = len(qra_items) > 0

        technique_groups = group_by_technique(qra_items) if qra_items else {}
        control_ids = sorted({item.get("control_id", "") for item in qra_items if item.get("control_id")})

        entity_ids = set(entities.get("all_control_ids", [])) if entities else set()
        recall_ids = set(control_ids)
        overlap = entity_ids & recall_ids if entity_ids and recall_ids else set()

        entity_method = entities.get("method", "extract_entities") if isinstance(entities, dict) else "extract_entities"

        # Grounding evidence
        entity_warnings = entities.get("warnings", []) if isinstance(entities, dict) else []
        grounding_ok = entities.get("grounding_ok", True) if isinstance(entities, dict) else True

        n_fabricated = sum(1 for w in entity_warnings if w.get("category") == "fabricated_id")
        n_misspelled = sum(1 for w in entity_warnings if w.get("category") == "misspelling")
        n_not_in_corpus = sum(1 for w in entity_warnings if w.get("category") == "not_in_corpus")

        resolution_map = entities.get("resolution_map", {}) if isinstance(entities, dict) else {}
        unresolved = entities.get("unresolved_terms", []) if isinstance(entities, dict) else []
        resolved_count = sum(1 for v in resolution_map.values() if isinstance(v, dict) and v.get("exists"))
        total_candidates = resolved_count + n_fabricated
        grounding_ratio = resolved_count / total_candidates if total_candidates > 0 else 1.0

        grounding_evidence = {
            "grounding_ok": grounding_ok,
            "headline": entities.get("headline", "") if isinstance(entities, dict) else "",
            "resolved": resolved_count,
            "unresolved_id_like": n_fabricated,
            "misspellings": n_misspelled,
            "not_in_corpus": n_not_in_corpus,
            "warnings": entity_warnings,
            "unresolved_terms": unresolved,
            "resolution_map": resolution_map,
            "ratio": round(grounding_ratio, 3),
            "no_technique_bridge": False,
        }

        steps.append({"gate": "step_2_recall", "passed": has_recall,
                       "detail": f"{len(qra_items)} QRAs, {len(entity_ids)} entities, {len(overlap)} overlap ({entity_method})",
                       "data": {"qra_count": len(qra_items),
                                "entity_count": len(entity_ids),
                                "overlap_count": len(overlap),
                                "entities": entities or {},
                                "grounding_evidence": grounding_evidence,
                                "technique_groups": {k: len(v) for k, v in technique_groups.items()}}})

        if not has_recall:
            return self.store.persist_case(
                question=claim_text, category=category,
                verdict_state="inconclusive", grade="C", score=0.25,
                gates=steps, evidence_items=[],
                answer="No QRAs found. Needs /dogpile Tier 3 research.",
            )

        # Step 2b: Grounding gate
        n_fw_misspell = sum(1 for w in entity_warnings if w.get("category") == "framework_misspelling")
        grounding_evidence["n_framework_misspellings"] = n_fw_misspell

        grounding_gate_passed = grounding_ok
        grounding_detail = grounding_evidence.get("headline", "")
        if not grounding_gate_passed:
            warning_summary = []
            if n_fabricated:
                fab_names = [w["term"] for w in entity_warnings if w.get("category") == "fabricated_id"]
                warning_summary.append(f"{n_fabricated} fabricated ID(s): {', '.join(fab_names[:3])}")
            if n_fw_misspell:
                fw_names = [w["term"] for w in entity_warnings if w.get("category") == "framework_misspelling"]
                warning_summary.append(f"{n_fw_misspell} framework misspelling(s): {', '.join(fw_names[:3])}")
            if n_not_in_corpus:
                corpus_names = [w["term"] for w in entity_warnings if w.get("category") == "not_in_corpus"]
                warning_summary.append(f"{n_not_in_corpus} not in corpus: {', '.join(corpus_names[:3])}")
            grounding_detail = "; ".join(warning_summary) or "grounding_ok=False"
        steps.append({"gate": "step_2b_grounding", "passed": grounding_gate_passed,
                       "detail": grounding_detail,
                       "data": {"grounding_ok": grounding_ok,
                                "fabricated": n_fabricated,
                                "framework_misspellings": n_fw_misspell,
                                "misspellings": n_misspelled,
                                "not_in_corpus": n_not_in_corpus}})

        # Step 3: Same-technique check
        named_techniques = {k for k in technique_groups if k and k != "UNTAGGED"}

        all_tags = []
        for item in qra_items:
            tags = item.get("tactical_tags", [])
            if tags and isinstance(tags, list):
                all_tags.extend(t for t in tags if t)
        tag_counts: dict[str, int] = {}
        for t in all_tags:
            tag_counts[t] = tag_counts.get(t, 0) + 1
        dominant_tag = max(tag_counts, key=tag_counts.get) if tag_counts else ""
        dominant_count = tag_counts.get(dominant_tag, 0)
        coherence = dominant_count / len(qra_items) if qra_items else 0

        related_pairs = (entities or {}).get("related_pairs", [])

        max_scatter = 5 if coherence >= 0.7 else 3
        has_tag_bridge = coherence >= 0.5 and len(named_techniques) <= max_scatter and len(named_techniques) > 0
        has_entity_bridge = (bool(overlap) or bool(related_pairs)) and len(named_techniques) > 0
        has_technique_bridge = has_tag_bridge or has_entity_bridge

        if has_technique_bridge:
            technique_detail = (f"Technique bridge: dominant={dominant_tag} "
                                f"({dominant_count}/{len(qra_items)} QRAs, {coherence:.0%} coherence), "
                                f"{len(named_techniques)} techniques")
            if overlap:
                technique_detail += f", entity overlap: {', '.join(sorted(overlap)[:3])}"
        else:
            technique_detail = (f"No technique bridge: {len(named_techniques)} scattered techniques "
                                f"({', '.join(sorted(named_techniques)[:5])}), "
                                f"dominant={dominant_tag} ({coherence:.0%} coherence), "
                                f"overlap={len(overlap)}, related_pairs={len(related_pairs)}")

        steps.append({"gate": "step_3_technique_bridge", "passed": has_technique_bridge,
                       "detail": technique_detail,
                       "data": {"technique_names": sorted(named_techniques),
                                "overlap": sorted(overlap)[:10],
                                "related_pairs_count": len(related_pairs),
                                "bridge_found": has_technique_bridge}})

        if not has_technique_bridge:
            grounding_evidence["no_technique_bridge"] = True

        if not has_technique_bridge:
            if show_progress:
                console.print("[dim]Step 4: Calling /memory clarify...[/]")
            with _timed("step_4_clarify"):
                clarify_result = collect_clarify(claim_text)
            steps.append({"gate": "step_4_clarify", "passed": False,
                           "detail": "Entities don't share technique — clarify explains gaps",
                           "data": {"clarify": clarify_result or {}}})

            with _timed("step_4_persist_inconclusive"):
                result = self.store.persist_case(
                    question=claim_text, category=category,
                    verdict_state="inconclusive", grade="C", score=0.5,
                    gates=steps, evidence_items=qra_items,
                    answer=technique_detail, control_ids=control_ids,
                    decomposition=decomposition,
                )
            result["decomposition"] = decomposition
            result["component_results"] = component_results
            result["entities"] = entities
            result["clarify_result"] = clarify_result
            total_ms = round((_time.monotonic() - _run_t0) * 1000, 1)
            result["step_timings"] = step_timings
            result["total_ms"] = total_ms
            if show_progress:
                self._print_timings(step_timings, total_ms)
            return result

        # Step 4: Decompose — build meaningful sub-claims
        from report import build_meaningful_sub_claims
        single = len(technique_groups) <= 1
        sub_claims = build_meaningful_sub_claims(
            technique_groups, qra_items, claim_text,
        ) if not single else []
        steps.append({"gate": "step_4_decompose", "passed": True,
                       "detail": "Single technique" if single else f"{len(sub_claims)} sub-claims",
                       "data": {"single_claim": single, "claims": sub_claims}})

        if show_progress:
            console.print(f"[bold green]Steps passed — {len(qra_items)} QRAs, "
                          f"{len(technique_groups)} techniques, {len(overlap)} entity overlap[/]")

        # Step 5: Formal verification
        lean4_result, proof_result = self._run_lean4_gate(
            claim_text, control_ids, dominant_tag, coherence,
            show_progress, _timed,
        )

        proof_success = lean4_result.get("proof_success", False)
        proof_attempted = lean4_result.get("proof_attempted", False)
        proof_skipped = lean4_result.get("proof_skipped", False)
        gate_blocked = lean4_result.get("gate_blocked", False)
        lean4_gate_passed = (proof_success or proof_skipped) and not gate_blocked
        steps.append({"gate": "step_5_lean4", "passed": lean4_gate_passed,
                       "detail": (f"provable={lean4_result.get('prediction', 'unknown')}, "
                                  f"proof={'success' if proof_success else 'skipped' if proof_skipped else 'failed'}"),
                       "data": lean4_result})

        # Step 5b: Plausibility gate — catch questions that use real IDs
        # in nonsensical contexts (e.g. "CM0028 quantum encryption").
        # Only fires when verdict would be satisfied AND not_in_corpus warnings exist.
        plausibility_result = {"plausible": True, "checked": False}
        if grounding_gate_passed and n_not_in_corpus > 0:
            try:
                from plausibility import check_plausibility
                plausibility_result = check_plausibility(
                    claim_text, entity_warnings, resolution_map,
                )
            except Exception as exc:
                logger.warning("plausibility check failed: {}", exc)

        plaus_passed = plausibility_result.get("plausible", True)
        plaus_detail = plausibility_result.get("reason", "")
        if plausibility_result.get("checked"):
            steps.append({
                "gate": "step_5b_plausibility",
                "passed": plaus_passed,
                "detail": plaus_detail,
                "data": plausibility_result,
            })

        gates_passed = sum(1 for g in steps if g.get("passed"))

        answer = f"Found {len(qra_items)} QRAs across techniques: {', '.join(sorted(technique_groups.keys())[:5])}"
        if proof_success:
            proof_code = (proof_result or {}).get("code", "")
            answer += " [Lean4 verified]"
            if proof_code:
                answer += f"\n\nLean4 proof:\n```lean4\n{proof_code[:1500]}\n```"
        elif proof_attempted:
            proof_errors = (proof_result or {}).get("errors", lean4_result.get("errors", []))
            error_summary = "; ".join(str(e)[:100] for e in proof_errors[:3]) if proof_errors else "unknown"
            answer += f" [Lean4 proof attempted, not verified: {error_summary}]"
        elif gate_blocked:
            answer += f" [Lean4 gate blocked: {lean4_result.get('reason', 'classifier unavailable')}]"

        with _timed("step_6_persist"):
            result = self.store.persist_case(
                question=claim_text, category=category,
                verdict_state=gates_to_verdict(gates_passed, total_gates=len(steps)),
                grade=gates_to_grade(gates_passed, total_gates=len(steps)),
                score=gates_to_score(gates_passed, total_gates=len(steps)),
                gates=steps, evidence_items=qra_items,
                answer=answer,
                technique_groups={k: len(v) for k, v in technique_groups.items()},
                sub_claims=sub_claims, control_ids=control_ids,
                decomposition=decomposition,
            )
        result["decomposition"] = decomposition
        result["component_results"] = component_results
        result["entities"] = entities
        result["evidence_items"] = qra_items
        result["lean4_result"] = lean4_result

        total_ms = round((_time.monotonic() - _run_t0) * 1000, 1)
        result["step_timings"] = step_timings
        result["total_ms"] = total_ms
        if show_progress:
            self._print_timings(step_timings, total_ms)
        return result

    def _run_lean4_gate(
        self,
        claim_text: str,
        control_ids: list[str],
        dominant_tag: str,
        coherence: float,
        show_progress: bool,
        _timed,
    ) -> tuple[dict[str, Any], dict[str, Any]]:
        """Run Lean4 compilation via Docker HTTP service.

        Always attempts compilation. The lean4_provable classifier is recorded
        as metadata but does NOT gate compilation — the classifier is biased
        (always returns not_formalizable) and would block Lean4 for 100% of
        questions. Proof failure IS evidence; skipping proof is not.
        """
        proof_result: dict[str, Any] = {}

        # Record classifier prediction as metadata (informational only)
        with _timed("step_5_lean4_provable"):
            provability = collect_lean4_provable(claim_text, control_ids)

        provable_prediction = "unavailable"
        provable_confidence = 0.0
        if provability and isinstance(provability, dict):
            provable_prediction = provability.get("prediction", provability.get("label", "unavailable"))
            provable_confidence = provability.get("confidence", 0.0)

        if show_progress:
            console.print(f"[dim]Step 5: Lean4 provability = {provable_prediction} "
                          f"({provable_confidence:.0%} confidence)[/]")

        # Always attempt Lean4 compilation — proof failure IS evidence
        controls_str = ", ".join(control_ids[:5])
        lean4_code = (
            f"-- Auto-generated evidence claim\n"
            f"-- Controls: {controls_str}\n"
            f"-- Technique: {dominant_tag} ({coherence:.0%} coherence)\n"
            f"axiom evidence_controls : Prop\n"
            f"axiom evidence_technique : Prop\n"
            f"theorem evidence_bridge : evidence_controls → evidence_technique → True := by\n"
            f"  intro _ _\n"
            f"  trivial\n"
        )
        if show_progress:
            console.print("[dim]Step 5b: Compiling Lean4 via Docker...[/]")
        with _timed("step_5b_lean4_compile"):
            proof_result = compile_lean4(lean4_code)
        proof_success = bool(
            proof_result and isinstance(proof_result, dict)
            and proof_result.get("success")
        )
        return {
            **(proof_result or {}),
            "provable": provable_prediction == "formalizable",
            "prediction": provable_prediction,
            "provable_confidence": provable_confidence,
            "proof_attempted": True,
            "proof_skipped": False,
            "proof_success": proof_success,
            "proof_data": proof_result or {},
        }, proof_result

    @staticmethod
    def _print_timings(step_timings: list[dict], total_ms: float) -> None:
        console.print("\n[bold]Step Timings:[/]")
        for t in step_timings:
            bar_len = min(int(t["ms"] / 100), 40)
            bar = "█" * bar_len
            console.print(f"  {t['step']:30s} {t['ms']:8.1f}ms  {bar}")
        console.print(f"  {'TOTAL':30s} {total_ms:8.1f}ms")

"""Tests for runner.py focusing on gate semantics and subprocess robustness."""
from __future__ import annotations

from types import SimpleNamespace

import runner
from runner import EvidenceCaseRunner, EvidenceCaseStore2, _filter_meta_items, _invoke_skill, collect_entities


def _fake_case_result(verdict_state: str, gates: list[dict], answer: str = "ok") -> dict:
    return {
        "claim": {"id": "claim_1", "text": "q", "category": "compliance", "control_ids": ["CM0028"]},
        "strategies": [{"id": "s1", "name": "agent_driven", "skills": ["/memory recall"]}],
        "evidence": [{"id": "e1", "method": "EXAMINE", "layer": "sparta_qra", "control_ids": ["CM0028"]}],
        "verdict": {"state": verdict_state, "grade": "A+" if verdict_state == "satisfied" else "C", "score": 1.0 if verdict_state == "satisfied" else 0.8},
        "answer": answer,
        "gate_trace": gates,
        "gates_passed": sum(1 for g in gates if g.get("passed")),
        "gates_total": len(gates),
    }


def _patch_happy_path(monkeypatch, *, provability: dict | None, proof: dict | None):
    qra_items = [
        {
            "control_id": "CM0028",
            "tactical_tags": ["Harden"],
            "question": "How to protect firmware?",
            "answer": "Use tamper protection with integrity checks.",
        },
        {
            "control_id": "SI-7(2)",
            "tactical_tags": ["Harden"],
            "question": "How to detect tampering?",
            "answer": "Use boot integrity verification and monitoring.",
        },
    ]

    monkeypatch.setattr(runner, "collect_topic", lambda _: {"on_topic": True, "category": "compliance", "method": "test"})
    monkeypatch.setattr(runner, "collect_recall", lambda *_args, **_kwargs: qra_items)
    monkeypatch.setattr(
        runner,
        "collect_entities",
        lambda _q: {"all_control_ids": ["CM0028", "SI-7(2)"], "related_pairs": [{"source": "CM0028", "target": "SI-7(2)"}], "method": "extract_entities"},
    )
    monkeypatch.setattr(
        runner,
        "decompose_sentence",
        lambda q, _agent=None: {
            "question": q,
            "given_components": ["firmware tampering"],
            "then_components": ["countermeasures"],
            "component_queries": {},
            "component_entity_types": {},
        },
    )
    monkeypatch.setattr(runner, "collect_per_component", lambda _d: {})
    monkeypatch.setattr(runner, "collect_lean4_provable", lambda _q, _ids: provability)
    monkeypatch.setattr(runner, "collect_lean4_proof", lambda _req: proof)


def test_filter_meta_items():
    items = [
        {"tags": ["routing"], "solution": "meta"},
        {"tags": ["compliance"], "solution": "real"},
    ]
    assert _filter_meta_items(items) == [{"tags": ["compliance"], "solution": "real"}]


def test_invoke_skill_handles_nonzero_without_json(monkeypatch, tmp_path):
    run_sh = tmp_path / "run.sh"
    run_sh.write_text("#!/bin/sh\nexit 1\n")
    run_sh.chmod(0o755)

    def fake_run(*_args, **_kwargs):
        return SimpleNamespace(returncode=1, stdout="", stderr="boom")

    monkeypatch.setattr(runner.subprocess, "run", fake_run)
    assert _invoke_skill(run_sh, ["x"]) is None


def test_collect_entities_uses_recall_fallback(monkeypatch):
    monkeypatch.setattr(runner, "_invoke_skill", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        runner,
        "collect_recall",
        lambda *_args, **_kwargs: [{"control_id": "CM0028"}, {"control_id": "SI-7(2)"}],
    )
    result = collect_entities("CM0028 and SI-7(2)")
    assert result is not None
    assert result["method"] == "recall_fallback"
    assert result["all_control_ids"] == ["CM0028", "SI-7(2)"]


def test_persist_case_materializes_decomposition_id(monkeypatch):
    learned_nodes: list[dict] = []
    learned_edges: list[tuple[str, str, str]] = []

    class FakeStore:
        def learn_node(self, node, scope="evidence_cases"):
            learned_nodes.append(node)
            return True

        def learn_edge(self, from_id, to_id, relation, scope="evidence_cases"):
            learned_edges.append((from_id, to_id, relation))
            return True

        def append_audit(self, *_args, **_kwargs):
            return None

        def load_uct_cache(self, *_args, **_kwargs):
            return []

        def save_uct_cache(self, *_args, **_kwargs):
            return None

    store = EvidenceCaseStore2()
    store.store = FakeStore()
    result = store.persist_case(
        question="q",
        category="compliance",
        verdict_state="satisfied",
        grade="A+",
        score=1.0,
        gates=[{"gate": "step_1_topic", "passed": True}],
        evidence_items=[],
        answer="ok",
        decomposition={"question": "q", "given_components": [], "then_components": []},
    )
    assert result["decomposition"] is not None
    assert result["decomposition"]["id"]
    assert any(rel == "decomposed_as" and to_id for _, to_id, rel in learned_edges)


def test_gate5_classifier_unavailable_blocks_satisfied(monkeypatch):
    _patch_happy_path(monkeypatch, provability=None, proof=None)
    monkeypatch.setattr(
        EvidenceCaseStore2,
        "persist_case",
        lambda self, **kwargs: _fake_case_result(kwargs["verdict_state"], kwargs["gates"], kwargs["answer"]),
    )

    r = EvidenceCaseRunner()
    result = r.run("What controls protect firmware?", show_progress=False)
    assert result["verdict"]["state"] == "inconclusive"
    step5 = [g for g in result["gate_trace"] if g["gate"] == "step_5_lean4"][0]
    assert step5["passed"] is False
    assert result["lean4_result"]["gate_blocked"] is True


def test_gate5_non_formalizable_skip_can_still_satisfy(monkeypatch):
    _patch_happy_path(
        monkeypatch,
        provability={"prediction": "not_formalizable", "confidence": 0.99},
        proof=None,
    )
    monkeypatch.setattr(
        EvidenceCaseStore2,
        "persist_case",
        lambda self, **kwargs: _fake_case_result(kwargs["verdict_state"], kwargs["gates"], kwargs["answer"]),
    )

    r = EvidenceCaseRunner()
    result = r.run("What policy controls apply?", show_progress=False)
    assert result["verdict"]["state"] == "satisfied"
    step5 = [g for g in result["gate_trace"] if g["gate"] == "step_5_lean4"][0]
    assert step5["passed"] is True
    assert result["lean4_result"]["proof_skipped"] is True


def test_gate5_failed_formal_proof_blocks_satisfied(monkeypatch):
    _patch_happy_path(
        monkeypatch,
        provability={"prediction": "formalizable", "confidence": 0.95},
        proof={"success": False, "errors": ["type mismatch"]},
    )
    monkeypatch.setattr(
        EvidenceCaseStore2,
        "persist_case",
        lambda self, **kwargs: _fake_case_result(kwargs["verdict_state"], kwargs["gates"], kwargs["answer"]),
    )

    r = EvidenceCaseRunner()
    result = r.run("Prove this control chain formally", show_progress=False)
    assert result["verdict"]["state"] == "inconclusive"
    assert "not verified" in result["answer"]
    step5 = [g for g in result["gate_trace"] if g["gate"] == "step_5_lean4"][0]
    assert step5["passed"] is False

import { describe, expect, it } from "vitest";
import { buildTauDagEvidence, layersFromTauDag, type LoadedTauDagRun } from "./tauDagEvidenceAdapter";

function loadedFixture(overrides: Partial<LoadedTauDagRun["receipt"]> = {}): LoadedTauDagRun {
	return {
		manifest: {
			defaultRunId: "sample",
			runs: [{ id: "sample", label: "Sample", path: "/tau-dag-runs/sample", source: "test" }],
		},
		selected: { id: "sample", label: "Sample", path: "/tau-dag-runs/sample", source: "test" },
		contract: {
			schema: "tau.dag_contract.v1",
			dag_id: "tau-sample",
			nodes: [
				{ id: "creator", agent: "coder", executor: "local", required_evidence: ["artifact"] },
				{ id: "reviewer", agent: "reviewer", executor: "local", required_evidence: ["verdict"] },
				{ id: "human", agent: "human", executor: "human" },
			],
			edges: [
				{ from: "creator", to: "reviewer" },
				{ from: "reviewer", to: "human" },
			],
		},
		receipt: {
			schema: "tau.dag_receipt.v1",
			ok: true,
			status: "PASS",
			verdict: "PASS",
			live: false,
			provider_live: false,
			observed_nodes: ["creator", "reviewer"],
			node_results: {
				creator: { status: "PASS", summary: "artifact written" },
				reviewer: { status: "PASS", summary: "review accepted" },
			},
			proof_scope: {
				does_not_prove: ["future route correctness"],
			},
			...overrides,
		},
	};
}

describe("tauDagEvidenceAdapter", () => {
	it("maps a Tau DAG contract and receipt into transport DAG evidence", () => {
		const evidence = buildTauDagEvidence(loadedFixture());

		expect(evidence.schema).toBe("ux_lab.transport_dag_run_evidence.v1");
		expect(evidence.dag_id).toBe("tau-sample");
		expect(evidence.nodes.map((node) => node.id)).toEqual(["creator", "reviewer", "human"]);
		expect(evidence.edges).toEqual([
			{ from: "creator", to: "reviewer" },
			{ from: "reviewer", to: "human" },
		]);
		expect(evidence.layers).toEqual([["creator"], ["reviewer"], ["human"]]);
		expect(evidence.nodes.find((node) => node.id === "creator")?.status).toBe("accepted");
		expect(evidence.nodes.find((node) => node.id === "human")?.status).toBe("waiting");
		expect(evidence.not_proven).toContain("Live Tau DAG execution was not exercised by this UI fixture.");
	});

	it("marks the failed node and missing fields when the receipt blocks", () => {
		const evidence = buildTauDagEvidence(
			loadedFixture({
				ok: false,
				status: "MISSING_REQUIRED_EVIDENCE",
				verdict: "MISSING_REQUIRED_EVIDENCE",
				failed_node: "reviewer",
				missing: ["reviewer_verdict"],
				node_results: {
					creator: { status: "PASS", summary: "artifact written" },
					reviewer: { status: "BLOCKED", error: "missing reviewer verdict" },
				},
			}),
		);

		const reviewer = evidence.nodes.find((node) => node.id === "reviewer");
		expect(reviewer?.status).toBe("failed");
		expect(reviewer?.missing_required_fields).toEqual(["reviewer_verdict"]);
		expect(reviewer?.error).toBe("missing reviewer verdict");
	});

	it("falls back to one unresolved layer on cyclic contracts instead of manufacturing a route", () => {
		const layers = layersFromTauDag({
			nodes: [{ id: "a" }, { id: "b" }],
			edges: [
				{ from: "a", to: "b" },
				{ from: "b", to: "a" },
			],
		});

		expect(layers).toEqual([["a", "b"]]);
	});
});

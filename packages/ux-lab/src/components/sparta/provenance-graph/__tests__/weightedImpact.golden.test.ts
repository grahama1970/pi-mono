/**
 * TQL-5 Golden File Tests for computeWeightedImpact
 *
 * DO-330 Tool Qualification Level 5 compliance:
 * - Deterministic output verification
 * - Invariant property testing
 * - Bit-identical regression guards
 *
 * These tests MUST pass for DER sign-off.
 */
import { beforeAll, describe, expect, it } from "vitest";
import goldenOutput from "../__fixtures__/f36-golden-output-001.json";
import goldenScenario from "../__fixtures__/f36-golden-scenario-001.json";
import type { ProvenanceEdge, ProvenanceNode } from "../types";
import { computePropagationRule, computeWeightedImpact } from "../useWeightedImpact";
import { assertSupersedesIntegrity, validateSupersedesChain } from "../validateSupersedesChain";

describe("TQL-5 Golden File Validation", () => {
	let nodes: ProvenanceNode[];
	let edges: ProvenanceEdge[];

	beforeAll(() => {
		nodes = goldenScenario.nodes as ProvenanceNode[];
		edges = goldenScenario.edges as ProvenanceEdge[];
	});

	describe("Scenario: Baseline (expired evidence only)", () => {
		it("should converge with correct impact scores", () => {
			const rootFailures = new Set<string>();
			const virtualTaints = new Set<string>();

			// Mark expired evidence as root failure
			const now = Date.now();
			nodes.forEach((n) => {
				if (n.temporal.valid_to < now) {
					rootFailures.add(n.id);
				}
			});

			const result = computeWeightedImpact(nodes, edges, rootFailures, virtualTaints);
			const expected = goldenOutput.scenarios["scenario-baseline"];

			expect(result.converged).toBe(expected.converged);

			// Verify impact scores within epsilon
			Object.entries(expected.impactMap).forEach(([nodeId, expectedScore]) => {
				const actualScore = result.impactMap.get(nodeId) ?? 0;
				expect(actualScore).toBeCloseTo(expectedScore as number, 2);
			});
		});
	});

	describe("Scenario: Single Tier-1 Failure (Noisy-OR Redundancy)", () => {
		it("should show reduced impact due to RR redundancy", () => {
			const rootFailures = new Set(["supplier-pratt-whitney"]);
			const virtualTaints = new Set(["PW-001"]);

			// Also mark expired evidence
			const now = Date.now();
			nodes.forEach((n) => {
				if (n.temporal.valid_to < now) {
					rootFailures.add(n.id);
				}
			});

			const result = computeWeightedImpact(nodes, edges, rootFailures, virtualTaints);
			// Framework objective should survive at degraded due to Noisy-OR
			const frameworkImpact = result.impactMap.get("framework-do178c-obj-6-3") ?? 0;
			expect(frameworkImpact).toBeLessThan(0.7); // Not hard_break
			expect(frameworkImpact).toBeGreaterThan(0.2); // But degraded

			expect(result.cascadeStates.get("framework-do178c-obj-6-3")).toBe("degraded");
		});
	});

	describe("Scenario: Both Tier-1 Failure (No Redundancy)", () => {
		it("should show higher impact when both sources fail", () => {
			const rootFailures = new Set(["supplier-pratt-whitney", "supplier-rolls-royce"]);
			const virtualTaints = new Set(["PW-001", "RR-001"]);

			const now = Date.now();
			nodes.forEach((n) => {
				if (n.temporal.valid_to < now) {
					rootFailures.add(n.id);
				}
			});

			const result = computeWeightedImpact(nodes, edges, rootFailures, virtualTaints);

			// Both evidence artifacts become root_failure (supplier_id matches virtualTaints)
			expect(result.cascadeStates.get("evidence-pw-do178c-cert")).toBe("root_failure");
			expect(result.cascadeStates.get("evidence-rr-do178c-cert")).toBe("root_failure");

			// Framework impact should be higher than single-failure case
			const frameworkImpact = result.impactMap.get("framework-do178c-obj-6-3") ?? 0;
			const singleFailureImpact =
				goldenOutput.scenarios["scenario-pw-failure"].impactMap["framework-do178c-obj-6-3"];

			expect(frameworkImpact).toBeGreaterThan(singleFailureImpact as number);
		});
	});

	describe("Scenario: Tier-2 Cascade", () => {
		it("should cascade from Tier-2 to dependent Tier-3", () => {
			const rootFailures = new Set<string>();
			const virtualTaints = new Set(["HW-001"]);

			const now = Date.now();
			nodes.forEach((n) => {
				if (n.temporal.valid_to < now) {
					rootFailures.add(n.id);
				}
			});

			const result = computeWeightedImpact(nodes, edges, rootFailures, virtualTaints);

			// Honeywell should be root failure
			expect(result.cascadeStates.get("supplier-honeywell")).toBe("root_failure");

			// Moog should be affected via depends_on edge
			const moogImpact = result.impactMap.get("supplier-moog") ?? 0;
			expect(moogImpact).toBeGreaterThan(0);

			// AC-2 should survive (degraded) due to shared pen test
			const ac2Impact = result.impactMap.get("control-ac-2") ?? 0;
			expect(ac2Impact).toBeLessThan(0.7); // Not hard_break
		});
	});
});

describe("TQL-5 Invariant Properties", () => {
	let nodes: ProvenanceNode[];
	let edges: ProvenanceEdge[];

	beforeAll(() => {
		nodes = goldenScenario.nodes as ProvenanceNode[];
		edges = goldenScenario.edges as ProvenanceEdge[];
	});

	it("MONOTONICITY: Adding failures must not decrease total impact", () => {
		const emptyFailures = new Set<string>();
		const singleFailure = new Set(["supplier-pratt-whitney"]);
		const doubleFailure = new Set(["supplier-pratt-whitney", "supplier-rolls-royce"]);

		const result0 = computeWeightedImpact(nodes, edges, emptyFailures, new Set());
		const result1 = computeWeightedImpact(nodes, edges, singleFailure, new Set(["PW-001"]));
		const result2 = computeWeightedImpact(nodes, edges, doubleFailure, new Set(["PW-001", "RR-001"]));

		const totalImpact = (map: Map<string, number>) => Array.from(map.values()).reduce((a, b) => a + b, 0);

		expect(totalImpact(result1.impactMap)).toBeGreaterThanOrEqual(totalImpact(result0.impactMap));
		expect(totalImpact(result2.impactMap)).toBeGreaterThanOrEqual(totalImpact(result1.impactMap));
	});

	it("IDEMPOTENCY: Same input must produce identical output", () => {
		const failures = new Set(["supplier-pratt-whitney"]);
		const taints = new Set(["PW-001"]);

		const result1 = computeWeightedImpact(nodes, edges, failures, taints);
		const result2 = computeWeightedImpact(nodes, edges, failures, taints);

		expect(result1.iterations).toBe(result2.iterations);
		expect(result1.converged).toBe(result2.converged);

		nodes.forEach((n) => {
			const score1 = result1.impactMap.get(n.id) ?? 0;
			const score2 = result2.impactMap.get(n.id) ?? 0;
			expect(score1).toBe(score2); // Bit-identical, not approximate
		});
	});

	it("CONSERVATISM: hard_break edges must propagate at d=1.0", () => {
		const hardBreakEdge = edges.find((e) => e.type === "inherits_from");
		expect(hardBreakEdge).toBeDefined();

		const rule = computePropagationRule(hardBreakEdge!);
		expect(rule).toBe("hard_break");
	});

	it("NOISY_OR: Shared evidence (exclusivity<1) reduces cascade", () => {
		// Single source failure
		const singleFailure = new Set(["supplier-pratt-whitney"]);
		const result1 = computeWeightedImpact(nodes, edges, singleFailure, new Set(["PW-001"]));

		// Both sources fail
		const bothFailure = new Set(["supplier-pratt-whitney", "supplier-rolls-royce"]);
		const result2 = computeWeightedImpact(nodes, edges, bothFailure, new Set(["PW-001", "RR-001"]));

		// With exclusivity=0.5 on satisfies edges (effectiveWeight=0.5 < 0.7 → confidence_degradation)
		// propagationFactor = dampen = 0.85
		// single failure: taint = 1.0 × 0.85 × 1.0 × 0.5 = 0.425 → impact = 0.425
		// both fail: 1 - (1 - 0.425)^2 = 0.669375
		const impact1 = result1.impactMap.get("framework-do178c-obj-6-3") ?? 0;
		const impact2 = result2.impactMap.get("framework-do178c-obj-6-3") ?? 0;

		expect(impact1).toBeCloseTo(0.425, 2); // Single source with dampen
		expect(impact2).toBeGreaterThan(impact1); // Both fail is worse
		expect(impact2).toBeCloseTo(0.669375, 2); // Noisy-OR with dampen: 1-(1-0.425)^2
		expect(impact2).toBeLessThan(1.0); // But still not total failure (exclusivity < 1)
	});

	it("DECAY_HORIZON_MONOTONICITY: Future time must not decrease impact", () => {
		// Simulate decay horizon by marking more evidence as expired
		const futureNodes = nodes.map((n) => ({
			...n,
			temporal: {
				...n.temporal,
				// Shift valid_to backwards to simulate "90 days from now"
				valid_to: n.temporal.valid_to - 90 * 24 * 60 * 60 * 1000,
			},
		})) as ProvenanceNode[];

		const resultNow = computeWeightedImpact(nodes, edges, new Set(), new Set());
		const resultFuture = computeWeightedImpact(futureNodes, edges, new Set(), new Set());

		const totalNow = Array.from(resultNow.impactMap.values()).reduce((a, b) => a + b, 0);
		const totalFuture = Array.from(resultFuture.impactMap.values()).reduce((a, b) => a + b, 0);

		// Moving forward in time should only increase impact (more expirations)
		expect(totalFuture).toBeGreaterThanOrEqual(totalNow);
	});
});

describe("Edge Case: DAL-E Visibility Floor", () => {
	it("DAL-E evidence should have non-zero impact (CM visibility)", () => {
		// Create a DAL-E edge
		const dalEEdge: ProvenanceEdge = {
			id: "test-dal-e",
			source: "test-source",
			target: "test-target",
			type: "satisfies",
			weight: 1.0,
			dal_level: "E",
			exclusivity: 1.0,
		};

		const rule = computePropagationRule(dalEEdge);

		// DAL-E should still propagate (at 0.1 floor), not be invisible
		// The multiplier is 0.1, so effective weight = 1.0 * 0.1 * 1.0 * 1.0 = 0.1
		// This should be advisory_only (< 0.3)
		expect(rule).toBe("advisory_only");
	});
});

describe("TQL-5 Supersedes Chain Validation (Kahn's Algorithm)", () => {
	it("should validate clean supersedes chain", () => {
		const validNodes: ProvenanceNode[] = [
			{
				id: "v3",
				label: "Evidence v3",
				nodeClass: "evidence_artifact",
				temporal: {
					valid_from: Date.now(),
					valid_to: Date.now() + 365 * 24 * 60 * 60 * 1000,
					is_active: true,
					supersedes_id: "v2",
				},
			},
			{
				id: "v2",
				label: "Evidence v2",
				nodeClass: "evidence_artifact",
				temporal: {
					valid_from: Date.now() - 365 * 24 * 60 * 60 * 1000,
					valid_to: Date.now(),
					is_active: false,
					superseded_at: Date.now(),
					supersedes_id: "v1",
				},
			},
			{
				id: "v1",
				label: "Evidence v1",
				nodeClass: "evidence_artifact",
				temporal: {
					valid_from: Date.now() - 730 * 24 * 60 * 60 * 1000,
					valid_to: Date.now() - 365 * 24 * 60 * 60 * 1000,
					is_active: false,
					superseded_at: Date.now() - 365 * 24 * 60 * 60 * 1000,
				},
			},
		] as ProvenanceNode[];

		const result = validateSupersedesChain(validNodes);
		expect(result.valid).toBe(true);
		expect(result.cycleNodes).toHaveLength(0);
		expect(result.chainDepth).toBe(2); // v3 -> v2 -> v1
	});

	it("should detect circular supersedes chain", () => {
		const cyclicNodes: ProvenanceNode[] = [
			{
				id: "a",
				label: "Evidence A",
				nodeClass: "evidence_artifact",
				temporal: {
					valid_from: Date.now(),
					valid_to: Date.now() + 365 * 24 * 60 * 60 * 1000,
					is_active: true,
					supersedes_id: "b",
				},
			},
			{
				id: "b",
				label: "Evidence B",
				nodeClass: "evidence_artifact",
				temporal: {
					valid_from: Date.now(),
					valid_to: Date.now() + 365 * 24 * 60 * 60 * 1000,
					is_active: true,
					supersedes_id: "a",
				},
			},
		] as ProvenanceNode[];

		const result = validateSupersedesChain(cyclicNodes);
		expect(result.valid).toBe(false);
		expect(result.cycleNodes.length).toBeGreaterThan(0);
	});

	it("should detect orphaned supersedes references", () => {
		const orphanNodes: ProvenanceNode[] = [
			{
				id: "current",
				label: "Current Evidence",
				nodeClass: "evidence_artifact",
				temporal: {
					valid_from: Date.now(),
					valid_to: Date.now() + 365 * 24 * 60 * 60 * 1000,
					is_active: true,
					supersedes_id: "deleted-node",
				},
			},
		] as ProvenanceNode[];

		const result = validateSupersedesChain(orphanNodes);
		expect(result.orphanedRefs).toHaveLength(1);
		expect(result.orphanedRefs[0]).toEqual({ nodeId: "current", targetId: "deleted-node" });
	});

	it("assertSupersedesIntegrity should throw on cycle", () => {
		const cyclicNodes: ProvenanceNode[] = [
			{
				id: "x",
				label: "X",
				nodeClass: "evidence_artifact",
				temporal: { valid_from: Date.now(), valid_to: Date.now() + 1000, is_active: true, supersedes_id: "y" },
			},
			{
				id: "y",
				label: "Y",
				nodeClass: "evidence_artifact",
				temporal: { valid_from: Date.now(), valid_to: Date.now() + 1000, is_active: true, supersedes_id: "x" },
			},
		] as ProvenanceNode[];

		expect(() => assertSupersedesIntegrity(cyclicNodes)).toThrow("CIRCULAR_VERSIONING_DETECTED");
	});
});

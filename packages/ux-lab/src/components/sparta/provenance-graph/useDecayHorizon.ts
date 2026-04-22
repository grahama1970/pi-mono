/**
 * useDecayHorizon — Temporal projection for evidence expiration
 *
 * Gemini's "Decay Horizon Slider": projects graph state into future window.
 * When slider moves to +N days, treats evidence expiring before that as failed.
 *
 * ChatGPT's temporal model: `observed_at`, `valid_from`, `valid_to`, `assessed_at`
 */
import { useMemo } from "react";
import type { ProvenanceEdge, ProvenanceNode } from "./types";
import { computeWeightedImpact, type WeightedImpactResult } from "./useWeightedImpact";

export interface DecayHorizonResult extends WeightedImpactResult {
	expiringCount: number; // Nodes expiring within horizon
	rippleCount: number; // Additional nodes affected by cascade
	criticalNodes: string[]; // IDs of nodes expiring < 7 days
	warningNodes: string[]; // IDs of nodes expiring 7-30 days
}

export function computeDecayHorizon(
	nodes: ProvenanceNode[],
	edges: ProvenanceEdge[],
	horizonDays: number,
	virtualTaints: Set<string> = new Set(),
): DecayHorizonResult {
	const now = Date.now();
	const horizonMs = horizonDays * 24 * 60 * 60 * 1000;
	const criticalMs = 7 * 24 * 60 * 60 * 1000;
	const warningMs = 30 * 24 * 60 * 60 * 1000;

	// Identify nodes expiring within horizon
	const expiringNodes = new Set<string>();
	const criticalNodes: string[] = [];
	const warningNodes: string[] = [];

	nodes.forEach((n) => {
		if (!n.temporal.is_active) return;
		if (n.temporal.superseded_at) return;

		const expiresAt = n.temporal.valid_to;
		const timeToExpiry = expiresAt - now;

		if (timeToExpiry < horizonMs) {
			expiringNodes.add(n.id);

			if (timeToExpiry < 0) {
				criticalNodes.push(n.id); // Already expired
			} else if (timeToExpiry < criticalMs) {
				criticalNodes.push(n.id); // < 7 days
			} else if (timeToExpiry < warningMs) {
				warningNodes.push(n.id); // 7-30 days
			}
		}
	});

	// Run weighted impact with expiring nodes as root failures
	const result = computeWeightedImpact(nodes, edges, expiringNodes, virtualTaints);

	// Count ripple effect (affected but not expiring themselves)
	const rippleCount = [...result.impactMap.entries()].filter(
		([id, score]) => score > 0 && !expiringNodes.has(id),
	).length;

	return {
		...result,
		expiringCount: expiringNodes.size,
		rippleCount,
		criticalNodes,
		warningNodes,
	};
}

// ── React Hook ───────────────────────────────────────────────────────────

export function useDecayHorizon(
	nodes: ProvenanceNode[],
	edges: ProvenanceEdge[],
	horizonDays: number,
	virtualTaints: Set<string> = new Set(),
): DecayHorizonResult {
	return useMemo(
		() => computeDecayHorizon(nodes, edges, horizonDays, virtualTaints),
		[nodes, edges, horizonDays, virtualTaints],
	);
}

// ── Pulse Frequency Calculator (Gemini's NVIS pattern) ───────────────────

export function getPulseFrequency(expiresAt: number): number {
	const now = Date.now();
	const daysToExpiry = (expiresAt - now) / (24 * 60 * 60 * 1000);

	if (daysToExpiry < 0) return 0; // Static red (expired)
	if (daysToExpiry < 7) return 3; // Fast pulse (3Hz)
	if (daysToExpiry < 30) return 1; // Medium pulse (1Hz)
	if (daysToExpiry < 60) return 0.5; // Slow shimmer (0.5Hz)
	return 0; // Steady (no pulse)
}

export function getDecayColor(expiresAt: number): string {
	const now = Date.now();
	const daysToExpiry = (expiresAt - now) / (24 * 60 * 60 * 1000);

	if (daysToExpiry < 0) return "#dc2626"; // Red (expired)
	if (daysToExpiry < 7) return "#dc2626"; // Red (critical)
	if (daysToExpiry < 30) return "#d97706"; // Amber (warning)
	if (daysToExpiry < 90) return "#eab308"; // Yellow (caution)
	return "#e0e4e8"; // Phosphor (healthy)
}

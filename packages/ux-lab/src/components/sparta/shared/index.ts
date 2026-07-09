/**
 * Shared SPARTA components — compound components with dependency-injected state.
 *
 * These components are designed to be used across multiple host apps:
 * - SPARTA Explorer (:3002)
 * - Datalake Viewer (:5181)
 * - Embry-OS
 *
 * Each host app creates its own Provider that fetches data and injects it.
 * The shared components only own rendering — never data fetching.
 */

export type {
	EvidenceCasePrefill,
	EvidenceCaseSubmission,
	EvidenceVerdict,
} from "./EvidenceCasePanel";
export { EvidenceCasePanel } from "./EvidenceCasePanel";
export { EvidenceCaseTrace } from "./EvidenceCaseTrace";
export type {
	DatalakeOption,
	TechniqueDetail,
	ThreatMatrixActions,
	ThreatMatrixMeta,
	ThreatMatrixState,
	ThreatTactic,
	ThreatTechnique,
} from "./ThreatMatrix";
export { ThreatMatrix } from "./ThreatMatrix";
export type { TacticalEdge, TacticalNode, ThreatMatrixPayload } from "./types";

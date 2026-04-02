/**
 * shared-chat — Unified chat component library for Embry Terminal + SPARTA Explorer.
 */

export type { GateChainProps, GateStep } from "../sparta/query/GateChain";
export { GateChain } from "../sparta/query/GateChain";
export type { RecallCardProps } from "../sparta/query/RecallCard";
// Re-export SPARTA query components (no move — just unified access)
export { RecallCard } from "../sparta/query/RecallCard";
export { ThreatMatrixCard } from "../sparta/query/ThreatMatrixCard";
// Shared components
export { ActivityFeed } from "./ActivityFeed";
export type { DeepLinkAction, DeepLinkConfig } from "./DeepLinks";
export { configureDeepLinks, executePrimaryAction, resolveEntityActions } from "./DeepLinks";
export type { DeltaItem, DeltaReport } from "./DeltaReportCard";
export { DeltaReportCard } from "./DeltaReportCard";
// Entity highlighting
export { classifyEntity, ENTITY_PATTERN, ENTITY_STYLES, getEntityStyle, highlightEntities } from "./highlightEntities";
export { InlineArtifact } from "./InlineArtifact";
export { MarkdownRenderer } from "./MarkdownRenderer";
export { PresenceBar } from "./PresenceBar";
export type { SkillPaletteProps } from "./SkillPalette";
export { SkillPalette } from "./SkillPalette";
export { SuggestionCard } from "./SuggestionCard";
export { ToolAction } from "./ToolAction";
// Types
export type {
	ActivityEvent,
	Agent,
	AgentSuggestion,
	Artifact,
	CascadeLayer,
	ChatMessage,
	EntityRef,
	EntityType,
	EvidenceCaseData,
	EvidenceGate,
	PresenceEntry,
	ReasoningStep,
	RecallItem,
	RecallResult,
	Skill,
	ThreatMatrixSummary,
} from "./types";
// Hooks
export { useActivityFeed } from "./useActivityFeed";
export type { CascadeConfig, CascadePipeline, CascadeResult } from "./useCascadePipeline";
export { useCascadePipeline } from "./useCascadePipeline";

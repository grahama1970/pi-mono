/**
 * SuggestionCard — Agent finding as an actionable card inline in chat.
 * Accept/reject buttons, entity-highlighted control ID, confidence badge.
 */
import { memo, useCallback } from "react";
import type { AgentSuggestion, EntityType } from "./types";
import { highlightEntities } from "./highlightEntities";
import { useRegisterAction } from "../../hooks/useRegisterAction";

interface SuggestionCardProps {
	suggestion: AgentSuggestion;
	onAccept?: (id: string) => void;
	onReject?: (id: string) => void;
	onDiscuss?: (controlId: string) => void;
	onEntityClick?: (entity: string, type: EntityType) => void;
}

function btnStyle(color: string): React.CSSProperties {
	return {
		background: `${color}10`, border: `1px solid ${color}40`, color,
		fontSize: 11, fontFamily: "var(--font-ui)", padding: "5px 14px",
		borderRadius: 6, cursor: "pointer", fontWeight: 500, transition: "background 0.15s",
	};
}

export const SuggestionCard = memo(function SuggestionCard({
	suggestion, onAccept, onReject, onDiscuss, onEntityClick,
}: SuggestionCardProps) {
	const isPending = suggestion.status === "pending";
	const isResolved = suggestion.status !== "pending";
	const borderColor = suggestion.status === "accepted" ? "#00ff88" : suggestion.status === "rejected" ? "#ff444440" : "#7c3aed";

	const handleAccept = useCallback(() => onAccept?.(suggestion.id), [onAccept, suggestion.id]);
	const handleReject = useCallback(() => onReject?.(suggestion.id), [onReject, suggestion.id]);
	const handleDiscuss = useCallback(() => onDiscuss?.(suggestion.controlId), [onDiscuss, suggestion.controlId]);

	useRegisterAction(`suggestion:accept:${suggestion.id}`, { app: "shared-chat", action: "SUGGESTION_ACCEPT", label: "Accept Suggestion", description: `Accept agent suggestion for ${suggestion.controlId}` });
	useRegisterAction(`suggestion:reject:${suggestion.id}`, { app: "shared-chat", action: "SUGGESTION_REJECT", label: "Reject Suggestion", description: `Reject agent suggestion for ${suggestion.controlId}` });
	useRegisterAction(`suggestion:discuss:${suggestion.id}`, { app: "shared-chat", action: "SUGGESTION_DISCUSS", label: "Discuss Suggestion", description: `Open discussion about ${suggestion.controlId}` });

	const confPct = suggestion.confidence > 1 ? Math.min(Math.round(suggestion.confidence), 100) : Math.round(suggestion.confidence * 100);

	return (
		<div style={{
			border: `1px solid ${borderColor}`, borderRadius: 10, background: isResolved ? "#18181b80" : "#18181b",
			padding: "12px 14px", margin: "10px 0", opacity: isResolved ? 0.65 : 1, transition: "opacity 0.2s",
		}}>
			<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
				<span style={{ fontSize: 11, color: "#7c3aed", fontFamily: "var(--font-mono)" }}>💡 Suggestion from {suggestion.agent}</span>
				<span style={{
					marginLeft: "auto", fontSize: 10, fontFamily: "var(--font-mono)", padding: "1px 6px", borderRadius: 4,
					background: confPct > 70 ? "#00ff8815" : "#ffaa0015", color: confPct > 70 ? "#00ff88" : "#ffaa00",
				}}>{confPct}%</span>
			</div>
			<div style={{ fontSize: 13, color: "#e2e8f0", lineHeight: 1.5, fontFamily: "var(--font-ui)" }}>
				{highlightEntities(suggestion.controlId, onEntityClick)}{" — "}{suggestion.finding}
			</div>
			{suggestion.evidence && (
				<div style={{
					marginTop: 6, fontSize: 11, color: "#94a3b8", lineHeight: 1.4,
					borderLeft: "2px solid rgba(255,255,255,0.06)", paddingLeft: 8,
				}}>{suggestion.evidence.slice(0, 200)}{suggestion.evidence.length > 200 ? "..." : ""}</div>
			)}
			{isPending && (
				<div style={{ display: "flex", gap: 8, marginTop: 10 }}>
					{onAccept && <button onClick={handleAccept} data-qs-action="SUGGESTION_ACCEPT" data-qid={`suggestion:accept:${suggestion.id}`} title={`Accept suggestion for ${suggestion.controlId}`} style={btnStyle("#00ff88")}>Accept</button>}
					{onReject && <button onClick={handleReject} data-qs-action="SUGGESTION_REJECT" data-qid={`suggestion:reject:${suggestion.id}`} title={`Reject suggestion for ${suggestion.controlId}`} style={btnStyle("#ff4444")}>Reject</button>}
					{onDiscuss && <button onClick={handleDiscuss} data-qs-action="SUGGESTION_DISCUSS" data-qid={`suggestion:discuss:${suggestion.id}`} title={`Discuss ${suggestion.controlId} in chat`} style={btnStyle("#4a9eff")}>Discuss</button>}
				</div>
			)}
			{isResolved && (
				<div style={{ marginTop: 8, fontSize: 11, color: suggestion.status === "accepted" ? "#00ff88" : "#ff4444", fontFamily: "var(--font-mono)" }}>
					{suggestion.status === "accepted" ? "✓ Accepted" : "✗ Rejected"}{suggestion.resolvedBy && ` by ${suggestion.resolvedBy}`}
				</div>
			)}
		</div>
	);
});

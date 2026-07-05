/**
 * ActivityFeed — Scrollable list of real-time agent events.
 * NVIS dark theme with colored left borders per event type.
 */
import { memo, useEffect, useRef } from "react";
import { useRegisterAction } from "../../hooks/useRegisterAction";
import type { ActivityEvent, EntityType } from "./types";
import { getEntityStyle } from "./highlightEntities";

const EVENT_STYLES: Record<string, { color: string; icon: string }> = {
	agent_started: { color: "#4a9eff", icon: "●" },
	agent_completed: { color: "#00ff88", icon: "✓" },
	agent_finding: { color: "#ffaa00", icon: "⚠" },
	suggestion: { color: "#7c3aed", icon: "💡" },
	suggestion_resolved: { color: "#64748b", icon: "─" },
};

function relativeTime(ts: number): string {
	const diff = Math.floor((Date.now() - ts) / 1000);
	if (diff < 10) return "just now";
	if (diff < 60) return `${diff}s ago`;
	if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
	return `${Math.floor(diff / 3600)}h ago`;
}

function feedBtnStyle(color: string): React.CSSProperties {
	return {
		background: "none",
		border: `1px solid ${color}40`,
		color,
		fontSize: 10,
		padding: "1px 6px",
		borderRadius: 3,
		cursor: "pointer",
		marginLeft: 4,
	};
}

interface ActivityFeedProps {
	events: ActivityEvent[];
	onAcceptSuggestion?: (id: string) => void;
	onRejectSuggestion?: (id: string) => void;
	onEntityClick?: (entity: string, type: EntityType) => void;
	maxVisible?: number;
}

export const ActivityFeed = memo(function ActivityFeed({
	events,
	onAcceptSuggestion,
	onRejectSuggestion,
	onEntityClick,
	maxVisible = 20,
}: ActivityFeedProps) {
	const endRef = useRef<HTMLDivElement>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const userScrolled = useRef(false);

	useEffect(() => {
		if (!userScrolled.current) {
			endRef.current?.scrollIntoView({ behavior: "smooth" });
		}
	}, [events.length]);

	const visible = events.slice(-maxVisible);

	return (
		<div
			ref={containerRef}
			onScroll={() => {
				const el = containerRef.current;
				if (!el) return;
				userScrolled.current = el.scrollHeight - el.scrollTop - el.clientHeight > 40;
			}}
			style={{ maxHeight: 240, overflowY: "auto", fontSize: 12, fontFamily: "var(--font-ui, sans-serif)" }}
		>
			{visible.length === 0 && (
				<div style={{ padding: "12px 8px", color: "#64748b", fontSize: 11, textAlign: "center" }}>No activity yet</div>
			)}
			{visible.map((ev, idx) => {
				const style = EVENT_STYLES[ev.type] || EVENT_STYLES.agent_completed;
				const entityStyle = ev.entity && ev.entityType ? getEntityStyle(ev.entityType) : null;
				return (
					<div
						key={`${ev.type}-${ev.timestamp}-${idx}`}
						style={{
							display: "flex", gap: 8, padding: "6px 8px",
							borderLeft: `2px solid ${style.color}`,
							animation: idx === visible.length - 1 ? "activitySlideIn 0.25s ease-out" : undefined,
						}}
					>
						<span style={{ color: style.color, fontSize: 11, flexShrink: 0, width: 14, textAlign: "center" }}>{style.icon}</span>
						<div style={{ flex: 1, minWidth: 0 }}>
							<div style={{ color: "#e2e8f0", lineHeight: 1.4 }}>
								{ev.type === "agent_started" && (<><span style={{ color: "#4a9eff" }}>{ev.agent}</span> analyzing {ev.project}...</>)}
								{ev.type === "agent_completed" && (<><span style={{ color: "#00ff88" }}>{ev.agent}</span> {ev.summary?.slice(0, 80)}</>)}
								{ev.type === "agent_finding" && (<>
									{ev.entity && entityStyle ? (
										<span onClick={() => ev.entity && ev.entityType && onEntityClick?.(ev.entity, ev.entityType)}
											data-qs-action="ACTIVITY_NAVIGATE_ENTITY" data-qid={`activity:entity:${ev.entity}`} title={`Click to navigate to ${ev.entity}`}
											style={{ color: entityStyle.color, cursor: "pointer", fontFamily: "var(--font-mono)" }}>{ev.entity}</span>
									) : null}{" "}{ev.finding || ev.summary}
								</>)}
								{ev.type === "suggestion" && (<>
									Suggestion: <span style={{ color: "#7c3aed" }}>{ev.controlId}</span>{" — "}{ev.finding?.slice(0, 60)}
									{onAcceptSuggestion && ev.id && (
										<span style={{ marginLeft: 8 }}>
											<button onClick={() => onAcceptSuggestion(ev.id!)} data-qs-action="ACTIVITY_ACCEPT_SUGGESTION" data-qid={`activity:accept:${ev.id}`} title="Accept suggestion" style={feedBtnStyle("#00ff88")}>✓</button>
											<button onClick={() => onRejectSuggestion?.(ev.id!)} data-qs-action="ACTIVITY_REJECT_SUGGESTION" data-qid={`activity:reject:${ev.id}`} title="Reject suggestion" style={feedBtnStyle("#ff4444")}>✗</button>
										</span>
									)}
								</>)}
								{ev.type === "suggestion_resolved" && (<>{ev.controlId} — {ev.status === "accepted" ? "accepted" : "rejected"}</>)}
							</div>
							<div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{relativeTime(ev.timestamp)}</div>
						</div>
					</div>
				);
			})}
			<div ref={endRef} />
			<style>{"@keyframes activitySlideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }"}</style>
		</div>
	);
});

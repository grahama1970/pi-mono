/**
 * PresenceBar — Horizontal strip of avatar circles showing who's connected.
 * Compact mode: dots only (sidebar). Full mode: dots + names (top bar).
 */
import { memo, useState } from "react";
import type { PresenceEntry } from "./types";

const STATUS_COLORS: Record<string, string> = {
	active: "#00ff88",
	idle: "#ffaa00",
	offline: "#64748b",
};

interface PresenceBarProps {
	entries: PresenceEntry[];
	compact?: boolean;
}

export const PresenceBar = memo(function PresenceBar({ entries, compact = false }: PresenceBarProps) {
	const [hoveredId, setHoveredId] = useState<string | null>(null);
	const visible = entries.slice(0, 8);
	const overflow = entries.length - visible.length;

	if (entries.length === 0) return null;

	return (
		<div style={{
			display: "flex", alignItems: "center", gap: compact ? 4 : 8,
			padding: compact ? "4px 0" : "6px 12px",
			borderBottom: compact ? undefined : "1px solid rgba(255,255,255,0.06)",
		}}>
			{visible.map((entry) => {
				const color = STATUS_COLORS[entry.status] || STATUS_COLORS.offline;
				const isHovered = hoveredId === entry.userId;
				const size = compact ? 20 : 26;
				return (
					<div key={entry.userId} onMouseEnter={() => setHoveredId(entry.userId)} onMouseLeave={() => setHoveredId(null)} style={{ position: "relative" }}>
						<div style={{
							width: size, height: size, borderRadius: "50%",
							border: `2px solid ${color}`, background: entry.isAgent ? `${color}20` : "#18181b",
							display: "flex", alignItems: "center", justifyContent: "center",
							fontSize: compact ? 9 : 11, color, fontWeight: 600,
							fontFamily: "var(--font-ui, sans-serif)",
							transition: "transform 0.15s", transform: isHovered ? "scale(1.15)" : "scale(1)",
						}}>
							{entry.isAgent ? "🤖" : entry.displayName.charAt(0).toUpperCase()}
						</div>
						{!compact && (
							<span style={{ fontSize: 10, color: "#94a3b8", fontFamily: "var(--font-ui)", marginLeft: 2, whiteSpace: "nowrap" }}>
								{entry.displayName.split(" ")[0]}
							</span>
						)}
						{isHovered && (
							<div style={{
								position: "absolute", top: size + 4, left: "50%", transform: "translateX(-50%)",
								background: "rgba(2,6,23,0.92)", border: "1px solid rgba(255,255,255,0.15)",
								borderRadius: 6, padding: "4px 8px", fontSize: 10, color: "#e2e8f0",
								fontFamily: "var(--font-ui)", whiteSpace: "nowrap", zIndex: 50, pointerEvents: "none",
							}}>
								{entry.displayName}{entry.project && <span style={{ color: "#64748b" }}> — {entry.project}</span>}
							</div>
						)}
					</div>
				);
			})}
			{overflow > 0 && (
				<div style={{
					width: compact ? 20 : 26, height: compact ? 20 : 26, borderRadius: "50%",
					border: "1px solid rgba(255,255,255,0.1)", background: "#27272a",
					display: "flex", alignItems: "center", justifyContent: "center",
					fontSize: 9, color: "#94a3b8", fontFamily: "var(--font-mono)",
				}}>+{overflow}</div>
			)}
		</div>
	);
});

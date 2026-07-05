/**
 * DeltaReportCard — Git-driven security drift detection card.
 * Shows entity transitions (satisfied → not_satisfied) with colored status chips.
 */
import { memo } from "react";
import type { EntityType } from "./types";
import { highlightEntities } from "./highlightEntities";

export interface DeltaItem {
	entity: string;
	entityType?: EntityType;
	from: string;
	to: string;
	reason?: string;
	commitSha?: string;
}

export interface DeltaReport {
	title: string;
	timestamp: number;
	items: DeltaItem[];
}

interface DeltaReportCardProps {
	report: DeltaReport;
	onEntityClick?: (entity: string, type: EntityType) => void;
}

const STATUS_COLORS: Record<string, string> = {
	satisfied: "#00ff88",
	not_satisfied: "#ff4444",
	inconclusive: "#ffaa00",
	no_evidence: "#64748b",
};

export const DeltaReportCard = memo(function DeltaReportCard({ report, onEntityClick }: DeltaReportCardProps) {
	// data-qid on container below
	return (
		<div style={{
			border: "1px solid rgba(255,255,255,0.1)", borderRadius: 10,
			background: "#18181b", padding: "12px 14px", margin: "10px 0",
		}}>
			<div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0", marginBottom: 8, fontFamily: "var(--font-ui)" }}>
				{report.title}
			</div>
			{report.items.map((item, idx) => (
				<div key={idx} style={{
					display: "flex", alignItems: "center", gap: 8, padding: "6px 0",
					borderTop: idx > 0 ? "1px solid rgba(255,255,255,0.04)" : undefined,
				}}>
					<div style={{ flex: 1, minWidth: 0 }}>
						{highlightEntities(item.entity, onEntityClick)}
					</div>
					<span style={{
						fontSize: 10, fontFamily: "var(--font-mono)", padding: "1px 6px",
						borderRadius: 4, background: `${STATUS_COLORS[item.from] || "#64748b"}20`,
						color: STATUS_COLORS[item.from] || "#64748b",
					}}>{item.from}</span>
					<span style={{ color: "#64748b", fontSize: 10 }}>→</span>
					<span style={{
						fontSize: 10, fontFamily: "var(--font-mono)", padding: "1px 6px",
						borderRadius: 4, background: `${STATUS_COLORS[item.to] || "#64748b"}20`,
						color: STATUS_COLORS[item.to] || "#64748b",
					}}>{item.to}</span>
					{item.commitSha && (
						<span style={{ fontSize: 9, color: "#475569", fontFamily: "var(--font-mono)" }}>
							{item.commitSha.slice(0, 7)}
						</span>
					)}
				</div>
			))}
		</div>
	);
});

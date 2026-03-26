/**
 * Shared NVIS table styles for SPARTA Explorer views.
 * Magnetic hover, status badges, utility bar patterns.
 */
import { EMBRY } from "../../common/EmbryStyle";

// ── Magnetic hover row styles ──────────────────────────────────────────────
// Apply via onMouseEnter/onMouseLeave on <tr> or row <div>

export function applyMagneticHover(el: HTMLElement, isSelected: boolean) {
	if (isSelected) return;
	el.style.backgroundColor = `${EMBRY.bg}` === el.style.backgroundColor ? "" : "#1c1f26";
	el.style.borderLeftColor = EMBRY.green;
	el.style.filter = "brightness(1.2)";
}

export function removeMagneticHover(el: HTMLElement, isSelected: boolean) {
	if (isSelected) return;
	el.style.backgroundColor = "";
	el.style.borderLeftColor = "transparent";
	el.style.filter = "";
}

// Row base style for magnetic hover
export const magneticRow: React.CSSProperties = {
	borderLeft: "3px solid transparent",
	transition: "background-color 0.1s, border-left-color 0.1s, filter 0.1s",
	cursor: "pointer",
};

export const magneticRowSelected: React.CSSProperties = {
	backgroundColor: "#1c1f26",
	borderLeftColor: EMBRY.blue,
};

// ── Status helpers ─────────────────────────────────────────────────────────

export type StatusLevel = "high" | "medium" | "low" | "none";

export function nrsToStatus(nrsScore: number | undefined): StatusLevel {
	if (nrsScore == null) return "none";
	if (nrsScore >= 0.8) return "low"; // compliant / good
	if (nrsScore >= 0.6) return "medium"; // needs attention
	return "high"; // high risk
}

export function tierToStatus(t0?: boolean, t15?: boolean, t2?: boolean): StatusLevel {
	if (t2 === true) return "low";
	if (t15 === true) return "low";
	if (t0 === true) return "medium";
	if (t0 === false) return "high";
	return "none";
}

const STATUS_COLORS: Record<StatusLevel, string> = {
	high: "#ff4d4d",
	medium: "#ffcc00",
	low: "#00ff88",
	none: "#444444",
};

const STATUS_LABELS: Record<StatusLevel, string> = {
	high: "High Risk",
	medium: "Medium",
	low: "Compliant",
	none: "Unknown",
};

// Row accent border color based on status
export function statusBorderColor(status: StatusLevel): string {
	return STATUS_COLORS[status];
}

// Row subtle background based on status
export function statusRowBg(status: StatusLevel): string {
	const c = STATUS_COLORS[status];
	return `${c}08`; // 3% opacity
}

// ── Status badge styles ────────────────────────────────────────────────────

export function statusBadgeStyle(status: StatusLevel): React.CSSProperties {
	const color = STATUS_COLORS[status];
	return {
		fontSize: 9,
		fontWeight: 800,
		textTransform: "uppercase",
		letterSpacing: "0.5px",
		padding: "2px 8px",
		borderRadius: 10,
		color,
		backgroundColor: `${color}1a`,
		border: `1px solid ${color}`,
		whiteSpace: "nowrap",
	};
}

export function statusBadgeLabel(status: StatusLevel): string {
	return STATUS_LABELS[status];
}

// ── ID cell style (cyan → green on hover) ──────────────────────────────────

export const idCellStyle: React.CSSProperties = {
	color: "#4cc9f0", // cyan accent
	fontWeight: 700,
	fontFamily: '"JetBrains Mono", "SF Mono", monospace',
	transition: "color 0.2s",
};

// ── Utility bar button style ───────────────────────────────────────────────

export const utilBtnStyle: React.CSSProperties = {
	background: "#1a1d23",
	border: `1px solid ${EMBRY.border}`,
	color: EMBRY.dim,
	padding: "6px 12px",
	borderRadius: 4,
	fontSize: 11,
	cursor: "pointer",
	display: "flex",
	alignItems: "center",
	gap: 4,
	transition: "0.2s",
};

// ── Copy to clipboard with toast ───────────────────────────────────────────

export function copyControlLink(controlId: string): Promise<void> {
	const url = `${window.location.origin}/control/${controlId}`;
	return navigator.clipboard.writeText(url);
}

export function exportControlCSV(controlId: string, name: string, framework: string, description: string) {
	const rows = [
		["Control ID", "Name", "Framework", "Description"],
		[controlId, name, framework, description.replace(/"/g, '""')],
	];
	const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
	const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `${controlId}_export.csv`;
	a.click();
	URL.revokeObjectURL(url);
}

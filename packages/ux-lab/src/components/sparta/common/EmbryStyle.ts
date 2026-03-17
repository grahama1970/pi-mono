/** EmbryStyle — shared design tokens matching /create-evidence-case viewer */

export const EMBRY = {
	// Backgrounds (dark → light)
	bg: "#141414",
	bgCard: "#1a1a1a",
	bgPanel: "#111111",
	bgDeep: "#0b1220",
	bgHeader: "#0f172a",

	// Border
	border: "rgba(255, 255, 255, 0.13)",
	borderHover: "rgba(255, 255, 255, 0.25)",

	// NVIS MIL-STD-3009
	green: "#00ff88",
	red: "#ff4444",
	amber: "#ffaa00",
	blue: "#4a9eff",
	accent: "#7c3aed",
	white: "#e2e8f0", // slate-200
	dim: "#64748b", // slate-500
	muted: "#334155", // slate-700

	// Framework colors
	fw: {
		SPARTA: "#7c3aed",
		"ATT&CK": "#ff4444",
		D3FEND: "#00ff88",
		NIST: "#4a9eff",
		CWE: "#ffaa00",
	} as Record<string, string>,
} as const;

/** Card wrapper style */
export const card = {
	backgroundColor: EMBRY.bgCard,
	border: `1px solid ${EMBRY.border}`,
	borderRadius: 12,
	padding: 20,
} as const;

/** Panel wrapper (darker than card) */
export const panel = {
	backgroundColor: EMBRY.bgPanel,
	border: `1px solid ${EMBRY.border}`,
	borderRadius: 12,
	padding: 16,
} as const;

/** Section label — 10px uppercase tracking-widest */
export const label = {
	fontSize: 10,
	fontWeight: 700,
	textTransform: "uppercase" as const,
	letterSpacing: "0.15em",
	color: EMBRY.dim,
} as const;

/** Section heading */
export const heading = {
	fontSize: 14,
	fontWeight: 900,
	color: EMBRY.white,
	letterSpacing: "-0.02em",
} as const;

/** Body text */
export const body = {
	fontSize: 13,
	color: EMBRY.white,
	lineHeight: 1.6,
} as const;

/** Status glow dot */
export function glowDot(color: string, size = 8): React.CSSProperties {
	return {
		width: size,
		height: size,
		borderRadius: "50%",
		backgroundColor: color,
		boxShadow: `0 0 10px ${color}99`,
		flexShrink: 0,
	};
}

/** Framework badge */
export function fwBadge(framework: string): React.CSSProperties {
	const color = EMBRY.fw[framework] ?? EMBRY.dim;
	return {
		fontSize: 9,
		fontWeight: 700,
		padding: "2px 6px",
		borderRadius: 4,
		color,
		backgroundColor: `${color}18`,
		border: `1px solid ${color}33`,
		letterSpacing: "0.05em",
	};
}

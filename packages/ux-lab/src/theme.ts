/** NVIS MIL-STD-3009 color palette — Embry OS design system */
export const NVIS = {
	BG_PRIMARY: "#0a0a1a", // deep dark background
	BG_SECONDARY: "#111128", // panels, sidebars
	BG_TERTIARY: "#1a1a3e", // hover/active states
	GREEN: "#00ff88", // healthy, success, active agent, nominal
	RED: "#ff4444", // error, failed, critical
	AMBER: "#ffaa00", // warning, working, degraded
	BLUE: "#44aaff", // info, selected
	WHITE: "#c8c8c8", // primary text
	DIM: "#505050", // muted text, borders
	YELLOW: "#ffe600", // unknown status
	ACCENT: "#7c3aed", // Embry purple, primary actions
} as const;

/** Status-to-color mapping (NVIS convention) */
export const STATUS_COLORS = {
	working: NVIS.GREEN,
	idle: NVIS.DIM,
	done: NVIS.GREEN,
	error: NVIS.RED,
} as const;

/** Operation type-to-color mapping */
export const OP_COLORS = {
	create: NVIS.GREEN,
	update: NVIS.BLUE,
	delete: NVIS.RED,
	select: NVIS.DIM,
} as const;

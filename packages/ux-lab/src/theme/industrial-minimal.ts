// theme/industrial-minimal.ts — 2026 Design Tokens

export const THEME = {
	// Backgrounds
	bg: "#0D0E10", // Matte Obsidian
	bgElevated: "#13141A", // Slight lift
	bgGlass: "rgba(255, 255, 255, 0.03)",
	bgGlassHover: "rgba(255, 255, 255, 0.06)",

	// Text
	text: "#E0E4E8", // Ice White
	textMuted: "#9CA3AF", // WCAG-safe muted
	textDim: "#6B7280", // Labels only (large text)

	// Borders
	border: "rgba(255, 255, 255, 0.08)",
	borderHover: "rgba(255, 255, 255, 0.2)",
	borderFocus: "rgba(255, 255, 255, 0.3)",

	// Accents
	accent: "#00D1FF", // Cyan (desktop)
	accentNVIS: "#33E0A1", // Green-shifted (NVIS-safe)

	// Status (with shapes for accessibility)
	status: {
		satisfied: { color: "#33E0A1", icon: "✓" },
		inconclusive: { color: "#FBBF24", icon: "⚠" },
		not_satisfied: { color: "#EF4444", icon: "✗" },
		none: { color: "#6B7280", icon: "○" },
	},

	// Shadows
	shadow: {
		sm: "0 2px 8px rgba(0, 0, 0, 0.3)",
		md: "0 8px 32px rgba(0, 0, 0, 0.4)",
		lg: "0 16px 48px rgba(0, 0, 0, 0.5)",
		glow: (color: string) => `0 0 20px ${color}40`,
	},

	// Motion
	motion: {
		fast: "0.15s ease",
		normal: "0.2s ease",
		slow: "0.3s ease-out",
	},

	// Spacing (8px grid)
	space: {
		xs: 4,
		sm: 8,
		md: 12,
		lg: 16,
		xl: 24,
		xxl: 32,
	},

	// Touch targets (COTS minimum)
	touch: {
		min: 44,
	},

	// Typography
	font: {
		sans: "'Inter', -apple-system, sans-serif",
		mono: "'JetBrains Mono', 'Fira Code', monospace",
		size: {
			xs: 11,
			sm: 12,
			base: 14,
			lg: 16,
			xl: 20,
		},
		weight: {
			normal: 400,
			medium: 500,
			semibold: 600,
			bold: 700,
		},
	},

	// Radius
	radius: {
		sm: 6,
		md: 12,
		lg: 16,
		full: 9999,
	},
} as const;

export type Theme = typeof THEME;
export type Verdict = keyof typeof THEME.status;

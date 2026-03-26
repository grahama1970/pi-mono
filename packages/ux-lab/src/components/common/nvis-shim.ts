/**
 * NVIS → EMBRY compatibility shim.
 *
 * Skill components (learn-datalake, create-evidence-case, etc.) import
 * `{ NVIS } from '../theme'`. When those components are imported into
 * the Explorer via @skills alias, Vite resolves '../theme' to this shim,
 * mapping NVIS tokens to EMBRY so everything shares one design system.
 */
import { EMBRY } from "./EmbryStyle";

export const NVIS = {
	bg: EMBRY.bg,
	surface: EMBRY.bgCard,
	surface2: EMBRY.bgPanel,
	border: EMBRY.border,
	borderSolid: EMBRY.border,
	accent: EMBRY.accent,
	green: EMBRY.green,
	amber: EMBRY.amber,
	red: EMBRY.red,
	white: EMBRY.white,
	dim: EMBRY.dim,
	blue: EMBRY.blue,
	cyan: "#00e5ff",
	yellow: "#ffe600",
	green700: EMBRY.green,
	amber700: EMBRY.amber,
	red600: EMBRY.red,
} as const;

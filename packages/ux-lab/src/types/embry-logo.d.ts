declare module "@embry/logo" {
	import type { ComponentType } from "react";

	export type EmbryState = "idle" | "listening" | "thinking" | "synthesizing" | "speaking";

	export interface EmbryThinkingIconProps {
		size?: number;
		state?: EmbryState;
		thinking?: boolean;
		audioLevel?: number;
		nvis?: boolean;
		distance?: "far" | "mid" | "close" | "hud" | "phone";
		particleDensity?: number;
		letterScale?: number;
		particleAlphaScale?: number;
		particleBlendToBackground?: number;
		glowAlphaScale?: number;
		glowBlendToBackground?: number;
		ringWidthScale?: number;
		ringAlphaScale?: number;
		speakingRippleCount?: number;
		breathAmpScale?: number;
		breathHzScale?: number;
		letterMorphOnTransition?: boolean;
		drawLetter?: boolean;
		hypnoticMode?: boolean;
		ringScale?: number;
		particleSizeScale?: number;
		letterAsParticles?: boolean;
		particleOrbitScale?: number;
		transparentBackground?: boolean;
		showStars?: boolean;
		className?: string;
		"aria-label"?: string;
	}

	export const EmbryThinkingIcon: ComponentType<EmbryThinkingIconProps>;
}

/**
 * useMediaQuery — Responsive breakpoint hook for SPARTA components.
 *
 * Breakpoints (COTS-compliant, matches tablet/mobile form factors):
 * - Desktop: >= 1200px (full 9-column matrix)
 * - Tablet: 768px - 1199px (accordion or 3-4 column auto-fit)
 * - Mobile: < 768px (single column stack)
 */
import { useEffect, useState } from "react";

export interface MediaQueryState {
	isDesktop: boolean;
	isTablet: boolean;
	isMobile: boolean;
	/** Current viewport width (for fine-grained layout decisions) */
	width: number;
}

const BREAKPOINTS = {
	desktop: 1200,
	tablet: 768,
} as const;

export function useMediaQuery(): MediaQueryState {
	const [state, setState] = useState<MediaQueryState>(() => {
		if (typeof window === "undefined") {
			return { isDesktop: true, isTablet: false, isMobile: false, width: 1920 };
		}
		const w = window.innerWidth;
		return {
			isDesktop: w >= BREAKPOINTS.desktop,
			isTablet: w >= BREAKPOINTS.tablet && w < BREAKPOINTS.desktop,
			isMobile: w < BREAKPOINTS.tablet,
			width: w,
		};
	});

	useEffect(() => {
		const update = () => {
			const w = window.innerWidth;
			setState({
				isDesktop: w >= BREAKPOINTS.desktop,
				isTablet: w >= BREAKPOINTS.tablet && w < BREAKPOINTS.desktop,
				isMobile: w < BREAKPOINTS.tablet,
				width: w,
			});
		};

		window.addEventListener("resize", update, { passive: true });
		return () => window.removeEventListener("resize", update);
	}, []);

	return state;
}

export default useMediaQuery;

/**
 * useReducedMotion — Respect user's motion preferences.
 *
 * Returns true if user has prefers-reduced-motion: reduce enabled.
 * Use this to disable or minimize animations for accessibility.
 *
 * Usage:
 *   const reduceMotion = useReducedMotion()
 *   const duration = reduceMotion ? 0 : 300
 */
import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
	const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => {
		if (typeof window === "undefined") return false;
		return window.matchMedia(QUERY).matches;
	});

	useEffect(() => {
		const mediaQuery = window.matchMedia(QUERY);

		const handleChange = (event: MediaQueryListEvent) => {
			setPrefersReducedMotion(event.matches);
		};

		mediaQuery.addEventListener("change", handleChange);
		return () => mediaQuery.removeEventListener("change", handleChange);
	}, []);

	return prefersReducedMotion;
}

export default useReducedMotion;

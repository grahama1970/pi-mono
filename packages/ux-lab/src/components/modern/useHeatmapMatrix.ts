// useHeatmapMatrix.ts — Heatmap state + cell styling logic

import { useCallback, useMemo, useState } from "react";
import type { Verdict } from "../../theme/industrial-minimal";
import { THEME } from "../../theme/industrial-minimal";

type Grade = "A+" | "A" | "B" | "C" | "F" | "-";

export interface TechniqueCell {
	id: string;
	name: string;
	tactic: string;
	verdict: Verdict;
	grade: Grade;
	caseCount: number;
}

interface HeatmapState {
	enabled: boolean;
	gradeFilters: Set<Grade>;
	showZeroEvidence: boolean;
}

function getCoverageIntensity(cell: TechniqueCell): number {
	const verdictWeight: Record<Verdict, number> = {
		satisfied: 1,
		inconclusive: 0.5,
		not_satisfied: 0.2,
		none: 0,
	};
	const gradeWeight: Record<Grade, number> = {
		"A+": 1,
		A: 0.85,
		B: 0.7,
		C: 0.4,
		F: 0.1,
		"-": 0,
	};
	return verdictWeight[cell.verdict] * gradeWeight[cell.grade];
}

function getHeatmapColor(intensity: number): string {
	if (intensity === 0) return "#333333";
	if (intensity >= 0.8) return THEME.status.satisfied.color;
	if (intensity >= 0.5) return "#7acc7a";
	if (intensity >= 0.3) return THEME.status.inconclusive.color;
	return THEME.status.not_satisfied.color;
}

export function useHeatmapMatrix(techniques: TechniqueCell[]) {
	const [state, setState] = useState<HeatmapState>({
		enabled: false,
		gradeFilters: new Set(),
		showZeroEvidence: false,
	});

	const toggleHeatmap = useCallback(() => {
		setState((s) => ({ ...s, enabled: !s.enabled }));
	}, []);

	const toggleGradeFilter = useCallback((g: Grade) => {
		setState((s) => {
			const next = new Set(s.gradeFilters);
			next.has(g) ? next.delete(g) : next.add(g);
			return { ...s, gradeFilters: next };
		});
	}, []);

	const toggleZeroEvidence = useCallback(() => {
		setState((s) => ({ ...s, showZeroEvidence: !s.showZeroEvidence }));
	}, []);

	const visibleCells = useMemo(() => {
		return techniques.filter((t) => {
			if (state.gradeFilters.size > 0 && !state.gradeFilters.has(t.grade)) {
				return false;
			}
			if (state.showZeroEvidence && t.caseCount > 0) {
				return false;
			}
			return true;
		});
	}, [techniques, state.gradeFilters, state.showZeroEvidence]);

	const tacticCoverage = useMemo(() => {
		const byTactic = new Map<string, number[]>();
		for (const t of techniques) {
			if (!byTactic.has(t.tactic)) byTactic.set(t.tactic, []);
			byTactic.get(t.tactic)!.push(getCoverageIntensity(t));
		}
		const result = new Map<string, number>();
		byTactic.forEach((v, k) => {
			result.set(k, Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100));
		});
		return result;
	}, [techniques]);

	const getCellClass = useCallback(
		(cell: TechniqueCell): string => {
			if (!state.enabled) return "matrix-cell";

			const isSafe = cell.verdict === "satisfied" && cell.grade !== "C" && cell.grade !== "F";
			const isWeak = cell.verdict === "inconclusive" || cell.verdict === "not_satisfied";
			const isCritical = cell.grade === "C" || cell.grade === "F";

			return [
				"matrix-cell",
				isSafe ? "safe-cell" : "",
				isWeak ? "weak-cell" : "",
				isCritical ? "pulse-highlight" : "",
			]
				.filter(Boolean)
				.join(" ");
		},
		[state.enabled],
	);

	const getCellStyle = useCallback(
		(cell: TechniqueCell): React.CSSProperties => {
			if (!state.enabled) return {};

			const intensity = getCoverageIntensity(cell);
			const isSafe = cell.verdict === "satisfied" && cell.grade !== "C" && cell.grade !== "F";

			return {
				backgroundColor: getHeatmapColor(intensity),
				opacity: isSafe ? 0.3 : 1,
				filter: isSafe ? "grayscale(80%)" : "none",
				transition: `opacity ${THEME.motion.normal}, filter ${THEME.motion.normal}`,
			};
		},
		[state.enabled],
	);

	return {
		state,
		toggleHeatmap,
		toggleGradeFilter,
		toggleZeroEvidence,
		visibleCells,
		tacticCoverage,
		getCellClass,
		getCellStyle,
	};
}

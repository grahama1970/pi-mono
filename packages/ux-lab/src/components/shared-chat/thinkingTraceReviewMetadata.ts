/** Review hints for thinking/evidence disclosure toggles (DOM + subagent bundles). */

export function thinkingToggleReviewRole(disclosureVariant: "thinking" | "evidence-case"): string {
	return disclosureVariant === "evidence-case" ? "evidence disclosure toggle" : "thinking disclosure toggle";
}

export function thinkingToggleReviewExpectedState(args: {
	disclosureVariant: "thinking" | "evidence-case";
	open: boolean;
	isLive: boolean;
	leadingIcon: "sparkle" | "shield" | "none";
}): string {
	const { disclosureVariant, open, isLive, leadingIcon } = args;
	if (isLive) {
		return "Live compact task row with animated status; no expanded well header until complete.";
	}
	if (disclosureVariant === "evidence-case") {
		if (open) {
			return "Expanded evidence disclosure; 'Show evidence case' label visible with step detail in content well.";
		}
		return "Collapsed compact task row; shield icon; task phrase only — no 'Show evidence case' header text until expanded.";
	}
	if (open) {
		return "Expanded thinking disclosure; 'Show thinking' label visible with step detail in content well.";
	}
	const iconHint = leadingIcon === "sparkle" ? "sparkle icon; " : "";
	return `Collapsed compact task row; ${iconHint}task phrase only — no 'Show thinking' header text until expanded.`;
}

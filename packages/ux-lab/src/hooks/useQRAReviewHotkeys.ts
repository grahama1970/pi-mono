/**
 * useQRAReviewHotkeys — Keyboard shortcuts for QRA review workflow.
 *
 * Hotkeys:
 * - B: Bless (approve) the current QRA
 * - C: Enter correction mode
 * - S: Skip to next QRA
 * - R: Reject the current QRA
 * - Escape: Cancel correction mode
 * - Enter (in correction mode): Save correction
 *
 * Disabled when:
 * - Focus is in an input/textarea/contenteditable
 * - Modal is open
 * - QRA is already reviewed
 */
import { useCallback, useEffect, useRef } from "react";

export interface QRAReviewHotkeysOptions {
	enabled?: boolean;
	isCorrectMode?: boolean;
	isReviewed?: boolean;
	onBless?: () => void;
	onCorrect?: () => void;
	onSkip?: () => void;
	onReject?: () => void;
	onCancelCorrect?: () => void;
	onSaveCorrect?: () => void;
}

function isInputFocused(): boolean {
	const active = document.activeElement;
	if (!active) return false;
	const tag = active.tagName.toLowerCase();
	if (tag === "input" || tag === "textarea" || tag === "select") return true;
	if ((active as HTMLElement).isContentEditable) return true;
	return false;
}

export function useQRAReviewHotkeys({
	enabled = true,
	isCorrectMode = false,
	isReviewed = false,
	onBless,
	onCorrect,
	onSkip,
	onReject,
	onCancelCorrect,
	onSaveCorrect,
}: QRAReviewHotkeysOptions): void {
	const handlersRef = useRef({ onBless, onCorrect, onSkip, onReject, onCancelCorrect, onSaveCorrect });

	useEffect(() => {
		handlersRef.current = { onBless, onCorrect, onSkip, onReject, onCancelCorrect, onSaveCorrect };
	}, [onBless, onCorrect, onSkip, onReject, onCancelCorrect, onSaveCorrect]);

	const handleKeyDown = useCallback(
		(e: KeyboardEvent) => {
			if (!enabled) return;
			if (isReviewed && !isCorrectMode) return;

			const key = e.key.toLowerCase();
			const handlers = handlersRef.current;

			// Escape always works (cancel correction)
			if (key === "escape" && isCorrectMode) {
				e.preventDefault();
				handlers.onCancelCorrect?.();
				return;
			}

			// Enter in correction mode (but not in textarea — let textarea handle newlines)
			if (key === "enter" && isCorrectMode && e.ctrlKey) {
				e.preventDefault();
				handlers.onSaveCorrect?.();
				return;
			}

			// Don't intercept when typing in inputs (except for escape above)
			if (isInputFocused()) return;

			// Review hotkeys (only when not in correct mode)
			if (!isCorrectMode) {
				switch (key) {
					case "b":
						e.preventDefault();
						handlers.onBless?.();
						break;
					case "c":
						e.preventDefault();
						handlers.onCorrect?.();
						break;
					case "s":
						e.preventDefault();
						handlers.onSkip?.();
						break;
					case "r":
						e.preventDefault();
						handlers.onReject?.();
						break;
				}
			}
		},
		[enabled, isCorrectMode, isReviewed],
	);

	useEffect(() => {
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [handleKeyDown]);
}

export default useQRAReviewHotkeys;

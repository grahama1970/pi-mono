import { useEffect } from "react";
import { useCanvasStore } from "../store/canvasStore";

export function useKeyboardShortcuts() {
	const undo = useCanvasStore((s) => s.undo);
	const redo = useCanvasStore((s) => s.redo);
	const removeElements = useCanvasStore((s) => s.removeElements);
	const setSelection = useCanvasStore((s) => s.setSelection);

	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			const target = e.target as HTMLElement;
			// Ignore shortcuts when typing in input/textarea/select
			if (
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.tagName === "SELECT" ||
				target.isContentEditable
			) {
				return;
			}

			const ctrl = e.ctrlKey || e.metaKey;

			// Ctrl+Z: undo
			if (ctrl && e.key === "z" && !e.shiftKey) {
				e.preventDefault();
				undo();
				return;
			}

			// Ctrl+Y or Ctrl+Shift+Z: redo
			if (ctrl && (e.key === "y" || (e.key === "z" && e.shiftKey) || (e.key === "Z" && e.shiftKey))) {
				e.preventDefault();
				redo();
				return;
			}

			// Delete/Backspace: remove selected elements (single history entry for batch)
			if (e.key === "Delete" || e.key === "Backspace") {
				e.preventDefault();
				const { selectedIds } = useCanvasStore.getState();
				removeElements(selectedIds);
				setSelection([]);
				return;
			}

			// Ctrl+A: select all
			if (ctrl && e.key === "a") {
				e.preventDefault();
				const { elements } = useCanvasStore.getState();
				setSelection(Object.keys(elements));
				return;
			}
		};

		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [undo, redo, removeElements, setSelection]);
}

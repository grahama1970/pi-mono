import type { CanvasElement } from "../types";

export function exportAsJson(elements: CanvasElement[]): string {
	return JSON.stringify(elements, null, 2);
}

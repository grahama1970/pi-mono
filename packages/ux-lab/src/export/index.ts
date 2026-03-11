import type { CanvasElement } from "../types";
import { exportAsJson } from "./json-generator.ts";
import { exportAsReact } from "./react-generator.ts";
import { exportAsSvg } from "./svg-generator.ts";

export type ExportFormat = "react" | "svg" | "json" | "png";

export interface ExportResult {
	format: ExportFormat;
	content: string;
}

export function exportCanvas(elements: CanvasElement[], format: ExportFormat): ExportResult {
	switch (format) {
		case "react":
			return { format, content: exportAsReact(elements) };
		case "svg":
			return { format, content: exportAsSvg(elements) };
		case "json":
			return { format, content: exportAsJson(elements) };
		case "png":
			// PNG export requires canvas rendering (use browser canvas.toDataURL())
			return { format, content: "// PNG export requires canvas rendering (use browser canvas.toDataURL())" };
	}
}

export { exportAsJson } from "./json-generator.ts";
export { exportAsReact } from "./react-generator.ts";
export { exportAsSvg } from "./svg-generator.ts";

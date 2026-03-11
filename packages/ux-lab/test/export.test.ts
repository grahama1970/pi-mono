import { describe, expect, it } from "vitest";
import { exportCanvas } from "../src/export/index.ts";
import { exportAsJson } from "../src/export/json-generator.ts";
import { exportAsReact } from "../src/export/react-generator.ts";
import { exportAsSvg } from "../src/export/svg-generator.ts";
import type { CanvasElement } from "../src/types";

function makeElement(overrides: Partial<CanvasElement> & { type: string }): CanvasElement {
	return {
		id: overrides.id ?? "el-1",
		type: overrides.type,
		x: overrides.x ?? 0,
		y: overrides.y ?? 0,
		width: overrides.width ?? 100,
		height: overrides.height ?? 40,
		props: overrides.props ?? {},
	};
}

describe("React Generator", () => {
	it("exports a button element with className", () => {
		const el = makeElement({
			type: "paper:button",
			props: { buttonText: "Click Me", variant: "primary" },
		});
		const result = exportAsReact([el]);
		expect(result).toContain("<button");
		expect(result).toContain("className=");
		expect(result).toContain("Click Me");
		expect(result).toContain("bg-blue-600");
	});

	it("exports a card element with title and body", () => {
		const el = makeElement({
			type: "paper:card",
			width: 280,
			height: 160,
			props: { cardTitle: "My Card", cardBody: "Some body text" },
		});
		const result = exportAsReact([el]);
		expect(result).toContain("<div");
		expect(result).toContain("rounded-lg");
		expect(result).toContain("shadow-md");
		expect(result).toContain("<h3");
		expect(result).toContain("My Card");
		expect(result).toContain("<p");
		expect(result).toContain("Some body text");
	});

	it("maps textStyle h1 to <h1> tag", () => {
		const el = makeElement({
			type: "paper:text",
			props: { textStyle: "h1", text: "Big Title" },
		});
		const result = exportAsReact([el]);
		expect(result).toContain("<h1");
		expect(result).toContain("Big Title");
		expect(result).toContain("text-4xl");
	});

	it("maps textStyle h2 to <h2> tag", () => {
		const el = makeElement({
			type: "paper:text",
			props: { textStyle: "h2", text: "Sub Title" },
		});
		const result = exportAsReact([el]);
		expect(result).toContain("<h2");
		expect(result).toContain("Sub Title");
	});

	it("maps textStyle h3 to <h3> tag", () => {
		const el = makeElement({
			type: "paper:text",
			props: { textStyle: "h3", text: "Section" },
		});
		const result = exportAsReact([el]);
		expect(result).toContain("<h3");
	});

	it("maps textStyle body to <p> tag", () => {
		const el = makeElement({
			type: "paper:text",
			props: { textStyle: "body", text: "Paragraph text" },
		});
		const result = exportAsReact([el]);
		expect(result).toContain("<p");
		expect(result).toContain("Paragraph text");
	});

	it("maps textStyle caption to <span> tag", () => {
		const el = makeElement({
			type: "paper:text",
			props: { textStyle: "caption", text: "Fine print" },
		});
		const result = exportAsReact([el]);
		expect(result).toContain("<span");
		expect(result).toContain("Fine print");
	});

	it("exports container with children and infers layout", () => {
		const container = makeElement({
			id: "container-1",
			type: "paper:container",
			x: 0,
			y: 0,
			width: 400,
			height: 300,
			props: { layout: "flex-row", gap: 8 },
		});
		const child1 = makeElement({
			id: "child-1",
			type: "paper:button",
			x: 10,
			y: 10,
			width: 100,
			height: 40,
			props: { buttonText: "First", variant: "primary" },
		});
		const child2 = makeElement({
			id: "child-2",
			type: "paper:button",
			x: 120,
			y: 10,
			width: 100,
			height: 40,
			props: { buttonText: "Second", variant: "secondary" },
		});
		const result = exportAsReact([container, child1, child2]);
		expect(result).toContain("flex flex-row");
		expect(result).toContain("First");
		expect(result).toContain("Second");
		// children should be sorted by x for flex-row
		const firstIdx = result.indexOf("First");
		const secondIdx = result.indexOf("Second");
		expect(firstIdx).toBeLessThan(secondIdx);
	});

	it("exports multiple elements as a complete component", () => {
		const elements = [
			makeElement({
				id: "a",
				type: "paper:button",
				x: 0,
				y: 0,
				props: { buttonText: "Btn", variant: "primary" },
			}),
			makeElement({
				id: "b",
				type: "paper:text",
				x: 0,
				y: 50,
				props: { textStyle: "h1", text: "Title" },
			}),
		];
		const result = exportAsReact(elements);
		expect(result).toContain("export default function CanvasExport");
		expect(result).toContain("Btn");
		expect(result).toContain("Title");
		expect(result).toContain("relative");
		expect(result).toContain("min-h-screen");
	});

	it("returns minimal component for empty elements", () => {
		const result = exportAsReact([]);
		expect(result).toContain("export default function CanvasExport");
		expect(result).toContain("relative");
	});

	it("applies primary variant styling to button", () => {
		const el = makeElement({
			type: "paper:button",
			props: { buttonText: "Go", variant: "primary" },
		});
		const result = exportAsReact([el]);
		expect(result).toContain("bg-blue-600");
		expect(result).toContain("text-white");
	});

	it("applies secondary variant styling to button", () => {
		const el = makeElement({
			type: "paper:button",
			props: { buttonText: "Go", variant: "secondary" },
		});
		const result = exportAsReact([el]);
		expect(result).toContain("bg-slate-500");
		expect(result).toContain("text-white");
	});

	it("applies outline variant styling to button", () => {
		const el = makeElement({
			type: "paper:button",
			props: { buttonText: "Go", variant: "outline" },
		});
		const result = exportAsReact([el]);
		expect(result).toContain("border");
		expect(result).toContain("text-blue-600");
		expect(result).toContain("bg-transparent");
	});

	it("exports navbar with logo and links", () => {
		const el = makeElement({
			type: "paper:navbar",
			width: 800,
			height: 56,
			props: { logoText: "MyApp", navLinks: ["Home", "About", "Blog"] },
		});
		const result = exportAsReact([el]);
		expect(result).toContain("<nav");
		expect(result).toContain("MyApp");
		expect(result).toContain("Home");
		expect(result).toContain("About");
		expect(result).toContain("Blog");
		expect(result).toContain("flex");
		expect(result).toContain("items-center");
		expect(result).toContain("justify-between");
	});

	it("exports rect with inline dimensions", () => {
		const el = makeElement({
			type: "rect",
			width: 200,
			height: 150,
			props: { fill: "#3b82f6" },
		});
		const result = exportAsReact([el]);
		expect(result).toContain("bg-blue-500");
		expect(result).toContain("width: 200");
		expect(result).toContain("height: 150");
	});

	it("exports circle with rounded-full", () => {
		const el = makeElement({
			type: "circle",
			width: 50,
			height: 50,
			props: { fill: "#ef4444" },
		});
		const result = exportAsReact([el]);
		expect(result).toContain("rounded-full");
		expect(result).toContain("bg-red-500");
	});

	it("exports line as <hr>", () => {
		const el = makeElement({
			type: "line",
			width: 200,
			height: 0,
		});
		const result = exportAsReact([el]);
		expect(result).toContain("<hr");
	});

	it("falls back to inline style for non-standard colors", () => {
		const el = makeElement({
			type: "rect",
			width: 100,
			height: 100,
			props: { fill: "#abc123" },
		});
		const result = exportAsReact([el]);
		expect(result).toContain("backgroundColor: '#abc123'");
	});

	it("exports container with flex-col layout", () => {
		const container = makeElement({
			id: "c1",
			type: "paper:container",
			x: 0,
			y: 0,
			width: 400,
			height: 300,
			props: { layout: "flex-col", gap: 8 },
		});
		const child1 = makeElement({
			id: "ch1",
			type: "paper:text",
			x: 10,
			y: 10,
			width: 200,
			height: 30,
			props: { textStyle: "h2", text: "Top" },
		});
		const child2 = makeElement({
			id: "ch2",
			type: "paper:text",
			x: 10,
			y: 50,
			width: 200,
			height: 30,
			props: { textStyle: "body", text: "Bottom" },
		});
		const result = exportAsReact([container, child1, child2]);
		expect(result).toContain("flex flex-col");
		// children sorted by y for flex-col
		const topIdx = result.indexOf("Top");
		const bottomIdx = result.indexOf("Bottom");
		expect(topIdx).toBeLessThan(bottomIdx);
	});
});

describe("SVG Generator", () => {
	it("produces valid SVG string with viewBox", () => {
		const elements = [
			makeElement({ type: "rect", x: 10, y: 20, width: 100, height: 50, props: { fill: "#ff0000" } }),
			makeElement({ id: "el-2", type: "circle", x: 200, y: 30, width: 60, height: 60, props: { fill: "#00ff00" } }),
		];
		const result = exportAsSvg(elements);
		expect(result).toContain("<svg");
		expect(result).toContain('xmlns="http://www.w3.org/2000/svg"');
		expect(result).toContain("viewBox=");
		expect(result).toContain("<rect");
		expect(result).toContain("<circle");
	});

	it("returns valid SVG with default viewBox for empty elements", () => {
		const result = exportAsSvg([]);
		expect(result).toContain("<svg");
		expect(result).toContain('viewBox="0 0 800 600"');
		expect(result).toContain("<!-- Empty canvas -->");
	});

	it("exports button as group with rect and text", () => {
		const el = makeElement({
			type: "paper:button",
			props: { buttonText: "Click", variant: "primary" },
		});
		const result = exportAsSvg([el]);
		expect(result).toContain("<g>");
		expect(result).toContain("Click");
		expect(result).toContain('rx="6"');
	});

	it("calculates viewBox from element bounds", () => {
		const elements = [makeElement({ type: "rect", x: 50, y: 100, width: 200, height: 150 })];
		const result = exportAsSvg(elements);
		expect(result).toContain('viewBox="50 100 200 150"');
	});
});

describe("JSON Generator", () => {
	it("returns parseable JSON", () => {
		const elements = [makeElement({ type: "rect", props: { fill: "#000" } })];
		const result = exportAsJson(elements);
		const parsed = JSON.parse(result);
		expect(Array.isArray(parsed)).toBe(true);
		expect(parsed).toHaveLength(1);
		expect(parsed[0].type).toBe("rect");
	});

	it("returns empty array JSON for no elements", () => {
		const result = exportAsJson([]);
		const parsed = JSON.parse(result);
		expect(parsed).toEqual([]);
	});
});

describe("Export Orchestrator", () => {
	it("routes to react generator", () => {
		const elements = [makeElement({ type: "paper:button", props: { buttonText: "X" } })];
		const result = exportCanvas(elements, "react");
		expect(result.format).toBe("react");
		expect(result.content).toContain("export default function");
	});

	it("routes to svg generator", () => {
		const elements = [makeElement({ type: "rect" })];
		const result = exportCanvas(elements, "svg");
		expect(result.format).toBe("svg");
		expect(result.content).toContain("<svg");
	});

	it("routes to json generator", () => {
		const elements = [makeElement({ type: "rect" })];
		const result = exportCanvas(elements, "json");
		expect(result.format).toBe("json");
		JSON.parse(result.content); // should not throw
	});
});

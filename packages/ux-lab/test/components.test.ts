import { beforeEach, describe, expect, it } from "vitest";
import { TOOLS } from "../src/components/Toolbar";
import { useCanvasStore } from "../src/store/canvasStore";

function resetStore() {
	useCanvasStore.setState({
		elements: {},
		selectedIds: [],
		viewport: { x: 0, y: 0, zoom: 1 },
		past: [],
		future: [],
	});
}

describe("Toolbar", () => {
	it("TOOLS list contains all expected shape tools", () => {
		const toolIds = TOOLS.map((t) => t.id);
		expect(toolIds).toContain("rect");
		expect(toolIds).toContain("circle");
		expect(toolIds).toContain("text");
		expect(toolIds).toContain("line");
	});

	it("TOOLS list contains all expected component tools", () => {
		const toolIds = TOOLS.map((t) => t.id);
		expect(toolIds).toContain("paper:button");
		expect(toolIds).toContain("paper:card");
		expect(toolIds).toContain("paper:navbar");
		expect(toolIds).toContain("paper:container");
	});

	it("TOOLS list contains select and pan modes", () => {
		const toolIds = TOOLS.map((t) => t.id);
		expect(toolIds).toContain("select");
		expect(toolIds).toContain("pan");
	});

	it("every tool has a label and icon", () => {
		for (const tool of TOOLS) {
			expect(tool.label).toBeTruthy();
			expect(tool.icon).toBeTruthy();
			expect(tool.category).toMatch(/^(shape|component|mode)$/);
		}
	});

	it("has correct category assignments", () => {
		const shapes = TOOLS.filter((t) => t.category === "shape");
		const components = TOOLS.filter((t) => t.category === "component");
		const modes = TOOLS.filter((t) => t.category === "mode");
		expect(shapes).toHaveLength(4);
		expect(components).toHaveLength(4);
		expect(modes).toHaveLength(2);
	});
});

describe("PropertiesPanel (store reads)", () => {
	beforeEach(resetStore);

	it("selected element is readable from store", () => {
		const id = useCanvasStore.getState().addElement({
			type: "rect",
			x: 50,
			y: 75,
			width: 200,
			height: 150,
			props: { fill: "#ff0000", stroke: "#000000" },
		});
		useCanvasStore.getState().setSelection([id]);

		const state = useCanvasStore.getState();
		const selected = state.selectedIds.map((sid) => state.elements[sid]).filter(Boolean);
		expect(selected).toHaveLength(1);
		expect(selected[0].x).toBe(50);
		expect(selected[0].y).toBe(75);
		expect(selected[0].width).toBe(200);
		expect(selected[0].height).toBe(150);
		expect(selected[0].props.fill).toBe("#ff0000");
	});

	it("updateElement modifies props that PropertiesPanel would edit", () => {
		const id = useCanvasStore.getState().addElement({
			type: "paper:button",
			x: 0,
			y: 0,
			width: 120,
			height: 40,
			props: { buttonText: "Click", variant: "primary", size: "md" },
		});

		useCanvasStore.getState().updateElement(id, {
			props: { buttonText: "Submit", variant: "secondary", size: "lg" },
		});

		const el = useCanvasStore.getState().elements[id];
		expect(el.props.buttonText).toBe("Submit");
		expect(el.props.variant).toBe("secondary");
		expect(el.props.size).toBe("lg");
	});

	it("updateElement changes position", () => {
		const id = useCanvasStore.getState().addElement({
			type: "circle",
			x: 10,
			y: 20,
			width: 80,
			height: 80,
			props: {},
		});

		useCanvasStore.getState().updateElement(id, { x: 300, y: 400 });
		const el = useCanvasStore.getState().elements[id];
		expect(el.x).toBe(300);
		expect(el.y).toBe(400);
	});

	it("no selected elements returns empty", () => {
		useCanvasStore.getState().addElement({
			type: "rect",
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			props: {},
		});
		// No selection
		const state = useCanvasStore.getState();
		const selected = state.selectedIds.map((sid) => state.elements[sid]).filter(Boolean);
		expect(selected).toHaveLength(0);
	});
});

describe("Keyboard shortcuts (store actions)", () => {
	beforeEach(resetStore);

	it("undo reverses addElement", () => {
		useCanvasStore.getState().addElement({
			type: "rect",
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			props: {},
		});
		expect(Object.keys(useCanvasStore.getState().elements)).toHaveLength(1);
		useCanvasStore.getState().undo();
		expect(Object.keys(useCanvasStore.getState().elements)).toHaveLength(0);
	});

	it("redo re-applies after undo", () => {
		const id = useCanvasStore.getState().addElement({
			type: "rect",
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			props: {},
		});
		useCanvasStore.getState().undo();
		expect(useCanvasStore.getState().elements[id]).toBeUndefined();
		useCanvasStore.getState().redo();
		expect(useCanvasStore.getState().elements[id]).toBeDefined();
	});

	it("removeElement deletes selected elements", () => {
		const id1 = useCanvasStore.getState().addElement({
			type: "rect",
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			props: {},
		});
		const id2 = useCanvasStore.getState().addElement({
			type: "circle",
			x: 100,
			y: 100,
			width: 50,
			height: 50,
			props: {},
		});
		useCanvasStore.getState().setSelection([id1, id2]);

		// Simulate Delete key: remove all selected
		const { selectedIds } = useCanvasStore.getState();
		for (const id of selectedIds) {
			useCanvasStore.getState().removeElement(id);
		}
		useCanvasStore.getState().setSelection([]);

		expect(Object.keys(useCanvasStore.getState().elements)).toHaveLength(0);
		expect(useCanvasStore.getState().selectedIds).toHaveLength(0);
	});

	it("select all sets all element ids", () => {
		useCanvasStore.getState().addElement({
			type: "rect",
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			props: {},
		});
		useCanvasStore.getState().addElement({
			type: "circle",
			x: 50,
			y: 50,
			width: 60,
			height: 60,
			props: {},
		});
		useCanvasStore.getState().addElement({
			type: "paper:button",
			x: 200,
			y: 200,
			width: 120,
			height: 40,
			props: {},
		});

		// Simulate Ctrl+A
		const { elements } = useCanvasStore.getState();
		useCanvasStore.getState().setSelection(Object.keys(elements));

		expect(useCanvasStore.getState().selectedIds).toHaveLength(3);
	});
});

describe("StatusBar (store reads)", () => {
	beforeEach(resetStore);

	it("zoom defaults to 100%", () => {
		const { viewport } = useCanvasStore.getState();
		expect(Math.round(viewport.zoom * 100)).toBe(100);
	});

	it("zoom updates when setViewport is called", () => {
		useCanvasStore.getState().setViewport({ zoom: 1.5 });
		const { viewport } = useCanvasStore.getState();
		expect(Math.round(viewport.zoom * 100)).toBe(150);
	});

	it("selection count reflects selected ids", () => {
		const id = useCanvasStore.getState().addElement({
			type: "rect",
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			props: {},
		});
		useCanvasStore.getState().setSelection([id]);
		expect(useCanvasStore.getState().selectedIds).toHaveLength(1);
	});

	it("element count matches store elements", () => {
		useCanvasStore.getState().addElement({
			type: "rect",
			x: 0,
			y: 0,
			width: 100,
			height: 100,
			props: {},
		});
		useCanvasStore.getState().addElement({
			type: "circle",
			x: 50,
			y: 50,
			width: 80,
			height: 80,
			props: {},
		});
		expect(Object.keys(useCanvasStore.getState().elements)).toHaveLength(2);
	});
});

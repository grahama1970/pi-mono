import { beforeEach, describe, expect, it } from "vitest";
import { useCanvasStore } from "../src/store/canvasStore";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function makeElement(
	overrides: Partial<{
		type: string;
		x: number;
		y: number;
		width: number;
		height: number;
		props: Record<string, unknown>;
	}> = {},
) {
	return {
		type: overrides.type ?? "rect",
		x: overrides.x ?? 0,
		y: overrides.y ?? 0,
		width: overrides.width ?? 100,
		height: overrides.height ?? 100,
		props: overrides.props ?? {},
	};
}

describe("canvasStore", () => {
	beforeEach(() => {
		// Reset store to initial state before each test
		useCanvasStore.setState({
			elements: {},
			selectedIds: [],
			viewport: { x: 0, y: 0, zoom: 1 },
			past: [],
			future: [],
		});
	});

	describe("addElement", () => {
		it("returns a valid UUID", () => {
			const id = useCanvasStore.getState().addElement(makeElement());
			expect(id).toMatch(UUID_REGEX);
		});

		it("adds the element to the store", () => {
			const id = useCanvasStore.getState().addElement(makeElement({ type: "paper:button", x: 10, y: 20 }));
			const el = useCanvasStore.getState().elements[id];
			expect(el).toBeDefined();
			expect(el.type).toBe("paper:button");
			expect(el.x).toBe(10);
			expect(el.y).toBe(20);
			expect(el.id).toBe(id);
		});
	});

	describe("updateElement", () => {
		it("modifies element properties", () => {
			const id = useCanvasStore.getState().addElement(makeElement({ x: 0, y: 0 }));
			useCanvasStore.getState().updateElement(id, { x: 50, y: 75 });
			const el = useCanvasStore.getState().elements[id];
			expect(el.x).toBe(50);
			expect(el.y).toBe(75);
		});

		it("preserves the element id even if updates include a different id", () => {
			const id = useCanvasStore.getState().addElement(makeElement());
			useCanvasStore.getState().updateElement(id, { id: "bogus" } as never);
			expect(useCanvasStore.getState().elements[id]).toBeDefined();
			expect(useCanvasStore.getState().elements[id].id).toBe(id);
		});

		it("does nothing for a nonexistent id", () => {
			const before = useCanvasStore.getState().elements;
			useCanvasStore.getState().updateElement("nonexistent", { x: 999 });
			expect(useCanvasStore.getState().elements).toBe(before);
		});
	});

	describe("removeElement", () => {
		it("removes the element from the store", () => {
			const id = useCanvasStore.getState().addElement(makeElement());
			expect(useCanvasStore.getState().elements[id]).toBeDefined();
			useCanvasStore.getState().removeElement(id);
			expect(useCanvasStore.getState().elements[id]).toBeUndefined();
		});

		it("does nothing for a nonexistent id", () => {
			const _id = useCanvasStore.getState().addElement(makeElement());
			const before = useCanvasStore.getState().past.length;
			useCanvasStore.getState().removeElement("nonexistent");
			// past should not grow if nothing was removed
			expect(useCanvasStore.getState().past.length).toBe(before);
		});
	});

	describe("undo", () => {
		it("restores previous state after addElement", () => {
			const id = useCanvasStore.getState().addElement(makeElement());
			expect(Object.keys(useCanvasStore.getState().elements)).toHaveLength(1);
			useCanvasStore.getState().undo();
			expect(Object.keys(useCanvasStore.getState().elements)).toHaveLength(0);
			expect(useCanvasStore.getState().elements[id]).toBeUndefined();
		});

		it("does nothing when past is empty", () => {
			const before = useCanvasStore.getState().elements;
			useCanvasStore.getState().undo();
			expect(useCanvasStore.getState().elements).toBe(before);
		});

		it("restores previous state after updateElement", () => {
			const id = useCanvasStore.getState().addElement(makeElement({ x: 10 }));
			useCanvasStore.getState().updateElement(id, { x: 99 });
			expect(useCanvasStore.getState().elements[id].x).toBe(99);
			useCanvasStore.getState().undo();
			expect(useCanvasStore.getState().elements[id].x).toBe(10);
		});
	});

	describe("redo", () => {
		it("re-applies after undo", () => {
			const id = useCanvasStore.getState().addElement(makeElement({ x: 42 }));
			useCanvasStore.getState().undo();
			expect(useCanvasStore.getState().elements[id]).toBeUndefined();
			useCanvasStore.getState().redo();
			expect(useCanvasStore.getState().elements[id]).toBeDefined();
			expect(useCanvasStore.getState().elements[id].x).toBe(42);
		});

		it("does nothing when future is empty", () => {
			useCanvasStore.getState().addElement(makeElement());
			const before = useCanvasStore.getState().elements;
			useCanvasStore.getState().redo();
			expect(useCanvasStore.getState().elements).toBe(before);
		});

		it("clears future on new mutation after undo", () => {
			useCanvasStore.getState().addElement(makeElement());
			useCanvasStore.getState().undo();
			expect(useCanvasStore.getState().future).toHaveLength(1);
			useCanvasStore.getState().addElement(makeElement());
			expect(useCanvasStore.getState().future).toHaveLength(0);
		});
	});

	describe("history max", () => {
		it("caps past at 50 entries", () => {
			for (let i = 0; i < 51; i++) {
				useCanvasStore.getState().addElement(makeElement({ x: i }));
			}
			expect(useCanvasStore.getState().past).toHaveLength(50);
		});
	});

	describe("setSelection", () => {
		it("sets selected ids", () => {
			useCanvasStore.getState().setSelection(["a", "b"]);
			expect(useCanvasStore.getState().selectedIds).toEqual(["a", "b"]);
		});
	});

	describe("setViewport", () => {
		it("partially updates viewport", () => {
			useCanvasStore.getState().setViewport({ zoom: 2 });
			const vp = useCanvasStore.getState().viewport;
			expect(vp.zoom).toBe(2);
			expect(vp.x).toBe(0);
			expect(vp.y).toBe(0);
		});
	});

	describe("loadFromJSON", () => {
		it("replaces all elements and clears history", () => {
			const id = useCanvasStore.getState().addElement(makeElement());
			expect(useCanvasStore.getState().past).toHaveLength(1);

			const imported = {
				ext1: { id: "ext1", type: "circle", x: 1, y: 2, width: 3, height: 4, props: { fill: "red" } },
			};
			useCanvasStore.getState().loadFromJSON(imported);

			expect(useCanvasStore.getState().elements.ext1).toBeDefined();
			expect(useCanvasStore.getState().elements[id]).toBeUndefined();
			expect(useCanvasStore.getState().past).toHaveLength(0);
			expect(useCanvasStore.getState().future).toHaveLength(0);
		});
	});

	describe("toJSON", () => {
		it("returns the elements record", () => {
			const id = useCanvasStore.getState().addElement(makeElement({ type: "paper:card" }));
			const json = useCanvasStore.getState().toJSON();
			expect(json[id]).toBeDefined();
			expect(json[id].type).toBe("paper:card");
		});
	});

	describe("clear", () => {
		it("empties everything", () => {
			useCanvasStore.getState().addElement(makeElement());
			useCanvasStore.getState().setSelection(["foo"]);
			useCanvasStore.getState().clear();

			const state = useCanvasStore.getState();
			expect(Object.keys(state.elements)).toHaveLength(0);
			expect(state.selectedIds).toHaveLength(0);
			expect(state.past).toHaveLength(0);
			expect(state.future).toHaveLength(0);
		});
	});
});

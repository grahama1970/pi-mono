import type { Canvas, FabricObject } from "fabric";
import { Circle, classRegistry, Line, Rect, Textbox } from "fabric";
import { useEffect, useRef } from "react";
import { registerAllObjects } from "../objects/registry";
import { useCanvasStore } from "../store/canvasStore";
import type { CanvasElement } from "../types";

// Ensure custom objects are registered before we try to create them
registerAllObjects();

/**
 * Create a Fabric object from a CanvasElement store entry.
 * Uses the classRegistry for paper:* types, falls back to built-in shapes.
 */
function createFabricObject(el: CanvasElement): FabricObject | null {
	const CustomClass = classRegistry.getClass(el.type);

	if (CustomClass) {
		// paper:* types — pass props as constructor options
		const obj = new CustomClass({
			...el.props,
			left: el.x,
			top: el.y,
			width: el.width,
			height: el.height,
		});
		(obj as FabricObject & { id?: string }).id = el.id;
		return obj as FabricObject;
	}

	// Built-in shapes
	const common = {
		left: el.x,
		top: el.y,
		width: el.width,
		height: el.height,
		fill: (el.props.fill as string) ?? "#2563eb",
		stroke: (el.props.stroke as string) ?? undefined,
	};

	let obj: FabricObject | null = null;

	switch (el.type) {
		case "rect":
			obj = new Rect(common);
			break;
		case "circle":
			obj = new Circle({
				...common,
				radius: Math.min(el.width, el.height) / 2,
			});
			break;
		case "line":
			obj = new Line([el.x, el.y, el.x + el.width, el.y + el.height], {
				stroke: (el.props.stroke as string) ?? "#000000",
			});
			break;
		case "textbox":
			obj = new Textbox((el.props.text as string) ?? "Text", {
				...common,
				fontSize: (el.props.fontSize as number) ?? 16,
			});
			break;
		default:
			// Unknown type — create a rect as placeholder
			obj = new Rect(common);
			break;
	}

	if (obj) {
		(obj as FabricObject & { id?: string }).id = el.id;
	}

	return obj;
}

/**
 * Find a Fabric object on the canvas by its custom `id` property.
 */
function findObjectById(canvas: Canvas, id: string): FabricObject | undefined {
	return canvas.getObjects().find((obj) => (obj as FabricObject & { id?: string }).id === id);
}

/**
 * Apply store element updates to an existing Fabric object.
 */
function applyUpdates(obj: FabricObject, el: CanvasElement): void {
	obj.set({
		left: el.x,
		top: el.y,
		width: el.width,
		height: el.height,
	});

	// Apply common props
	if (el.props.fill !== undefined) {
		obj.set("fill", el.props.fill as string);
	}
	if (el.props.stroke !== undefined) {
		obj.set("stroke", el.props.stroke as string);
	}

	obj.setCoords();
}

/**
 * Synchronization hook that bridges the Zustand store and Fabric canvas.
 *
 * - Subscribes to store element changes and reflects them on the canvas.
 * - Listens to Fabric `object:modified` events and writes back to the store.
 * - Uses a ref flag to prevent sync loops.
 */
export function useCanvasSync(canvas: Canvas | null): void {
	const isSyncing = useRef(false);
	const knownIds = useRef<Set<string>>(new Set());

	// Store -> Canvas sync
	useEffect(() => {
		if (!canvas) return;

		const unsubscribe = useCanvasStore.subscribe((state, prevState) => {
			if (isSyncing.current) return;
			if (state.elements === prevState.elements) return;

			isSyncing.current = true;
			try {
				const currentIds = new Set(Object.keys(state.elements));
				const previousIds = knownIds.current;

				// Detect additions
				for (const id of currentIds) {
					if (!previousIds.has(id)) {
						const el = state.elements[id];
						const obj = createFabricObject(el);
						if (obj) {
							canvas.add(obj);
						}
					}
				}

				// Detect removals
				for (const id of previousIds) {
					if (!currentIds.has(id)) {
						const obj = findObjectById(canvas, id);
						if (obj) {
							canvas.remove(obj);
						}
					}
				}

				// Detect updates (elements that exist in both but may have changed)
				for (const id of currentIds) {
					if (previousIds.has(id)) {
						const el = state.elements[id];
						const prevEl = prevState.elements[id];
						if (el !== prevEl) {
							const obj = findObjectById(canvas, id);
							if (obj) {
								applyUpdates(obj, el);
							}
						}
					}
				}

				knownIds.current = currentIds;
				canvas.requestRenderAll();
			} finally {
				isSyncing.current = false;
			}
		});

		// Initialize: sync any elements already in the store onto the canvas
		const initialState = useCanvasStore.getState();
		const initialIds = Object.keys(initialState.elements);
		if (initialIds.length > 0) {
			isSyncing.current = true;
			try {
				for (const id of initialIds) {
					if (!findObjectById(canvas, id)) {
						const obj = createFabricObject(initialState.elements[id]);
						if (obj) {
							canvas.add(obj);
						}
					}
				}
				knownIds.current = new Set(initialIds);
				canvas.requestRenderAll();
			} finally {
				isSyncing.current = false;
			}
		}

		return unsubscribe;
	}, [canvas]);

	// Canvas -> Store sync (object:modified events from user interaction)
	useEffect(() => {
		if (!canvas) return;

		const handleObjectModified = (opt: { target?: FabricObject }) => {
			if (isSyncing.current) return;
			const obj = opt.target;
			if (!obj) return;

			const id = (obj as FabricObject & { id?: string }).id;
			if (!id) return;

			isSyncing.current = true;
			try {
				const updateElement = useCanvasStore.getState().updateElement;
				updateElement(id, {
					x: obj.left ?? 0,
					y: obj.top ?? 0,
					width: (obj.width ?? 0) * (obj.scaleX ?? 1),
					height: (obj.height ?? 0) * (obj.scaleY ?? 1),
				});
			} finally {
				isSyncing.current = false;
			}
		};

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		canvas.on("object:modified", handleObjectModified as any);

		return () => {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			canvas.off("object:modified", handleObjectModified as any);
		};
	}, [canvas]);
}

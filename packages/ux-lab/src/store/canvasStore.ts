import { v4 as uuidv4 } from "uuid";
import { create } from "zustand";
import type { CanvasElement } from "../types";

export type { CanvasElement } from "../types";

export interface CanvasState {
	elements: Record<string, CanvasElement>;
	selectedIds: string[];
	viewport: { x: number; y: number; zoom: number };
	// History for undo/redo
	past: Array<Record<string, CanvasElement>>;
	future: Array<Record<string, CanvasElement>>;
	// Actions
	addElement: (element: Omit<CanvasElement, "id">) => string;
	updateElement: (id: string, updates: Partial<CanvasElement>) => void;
	removeElement: (id: string) => void;
	removeElements: (ids: string[]) => void;
	setSelection: (ids: string[]) => void;
	setViewport: (viewport: Partial<CanvasState["viewport"]>) => void;
	undo: () => void;
	redo: () => void;
	// Serialization
	toJSON: () => Record<string, CanvasElement>;
	loadFromJSON: (data: Record<string, CanvasElement>) => void;
	clear: () => void;
}

const MAX_HISTORY = 50;

function pushHistory(
	past: Array<Record<string, CanvasElement>>,
	elements: Record<string, CanvasElement>,
): Array<Record<string, CanvasElement>> {
	const newPast = [...past, structuredClone(elements)];
	if (newPast.length > MAX_HISTORY) {
		return newPast.slice(newPast.length - MAX_HISTORY);
	}
	return newPast;
}

export const useCanvasStore = create<CanvasState>((set, get) => ({
	elements: {},
	selectedIds: [],
	viewport: { x: 0, y: 0, zoom: 1 },
	past: [],
	future: [],

	addElement: (element) => {
		const id = uuidv4();
		const state = get();
		set({
			elements: {
				...state.elements,
				[id]: { ...element, id },
			},
			past: pushHistory(state.past, state.elements),
			future: [],
		});
		return id;
	},

	updateElement: (id, updates) => {
		const state = get();
		const existing = state.elements[id];
		if (!existing) return;
		set({
			elements: {
				...state.elements,
				[id]: { ...existing, ...updates, id },
			},
			past: pushHistory(state.past, state.elements),
			future: [],
		});
	},

	removeElement: (id) => {
		const state = get();
		if (!state.elements[id]) return;
		const { [id]: _, ...remaining } = state.elements;
		set({
			elements: remaining,
			past: pushHistory(state.past, state.elements),
			future: [],
		});
	},

	removeElements: (ids) => {
		const state = get();
		const toRemove = ids.filter((id) => state.elements[id]);
		if (toRemove.length === 0) return;
		const remaining = { ...state.elements };
		for (const id of toRemove) {
			delete remaining[id];
		}
		set({
			elements: remaining,
			past: pushHistory(state.past, state.elements),
			future: [],
		});
	},

	setSelection: (ids) => {
		set({ selectedIds: ids });
	},

	setViewport: (viewport) => {
		const state = get();
		set({ viewport: { ...state.viewport, ...viewport } });
	},

	undo: () => {
		const state = get();
		if (state.past.length === 0) return;
		const previous = state.past[state.past.length - 1];
		const newFuture = [structuredClone(state.elements), ...state.future];
		set({
			elements: previous,
			past: state.past.slice(0, -1),
			future: newFuture.length > MAX_HISTORY ? newFuture.slice(0, MAX_HISTORY) : newFuture,
		});
	},

	redo: () => {
		const state = get();
		if (state.future.length === 0) return;
		const next = state.future[0];
		set({
			elements: next,
			past: [...state.past, structuredClone(state.elements)],
			future: state.future.slice(1),
		});
	},

	toJSON: () => {
		return structuredClone(get().elements);
	},

	loadFromJSON: (data) => {
		set({
			elements: structuredClone(data),
			past: [],
			future: [],
		});
	},

	clear: () => {
		set({
			elements: {},
			selectedIds: [],
			past: [],
			future: [],
		});
	},
}));

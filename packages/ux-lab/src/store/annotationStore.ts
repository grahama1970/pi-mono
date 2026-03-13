import { create } from "zustand";
import type { AnnotationItem, EntityLabel } from "../types";

export interface AnnotationState {
	items: AnnotationItem[];
	currentIndex: number;
	availableLabels: Array<{ name: string; color: string }>;
	activeLabel: string | null;

	// Actions
	loadItems: (items: AnnotationItem[]) => void;
	accept: () => void;
	reject: () => void;
	skip: () => void;
	nextItem: () => void;
	prevItem: () => void;
	addLabel: (itemId: string, start: number, end: number, label: string) => void;
	removeLabel: (itemId: string, labelIndex: number) => void;
	setActiveLabel: (name: string | null) => void;
}

const DEFAULT_LABELS = [
	{ name: "CONTROL_ID", color: "#00ff88" },
	{ name: "TECHNIQUE", color: "#44aaff" },
	{ name: "TACTIC", color: "#ffaa00" },
	{ name: "THREAT", color: "#ff4444" },
	{ name: "EVIDENCE", color: "#7c3aed" },
];

function decideAndAdvance(
	items: AnnotationItem[],
	currentIndex: number,
	status: "accepted" | "rejected" | "skipped",
): Partial<AnnotationState> {
	const updated = items.map((item, i) => (i === currentIndex ? { ...item, status } : item));
	const nextIndex = Math.min(currentIndex + 1, updated.length - 1);
	return { items: updated, currentIndex: nextIndex };
}

export const useAnnotationStore = create<AnnotationState>((set, get) => ({
	items: [],
	currentIndex: 0,
	availableLabels: DEFAULT_LABELS,
	activeLabel: null,

	loadItems: (items) => set({ items, currentIndex: 0 }),

	accept: () => {
		const { items, currentIndex } = get();
		if (items.length === 0) return;
		set(decideAndAdvance(items, currentIndex, "accepted"));
	},

	reject: () => {
		const { items, currentIndex } = get();
		if (items.length === 0) return;
		set(decideAndAdvance(items, currentIndex, "rejected"));
	},

	skip: () => {
		const { items, currentIndex } = get();
		if (items.length === 0) return;
		set(decideAndAdvance(items, currentIndex, "skipped"));
	},

	nextItem: () => {
		const { items, currentIndex } = get();
		if (currentIndex < items.length - 1) {
			set({ currentIndex: currentIndex + 1 });
		}
	},

	prevItem: () => {
		const { currentIndex } = get();
		if (currentIndex > 0) {
			set({ currentIndex: currentIndex - 1 });
		}
	},

	addLabel: (itemId, start, end, label) => {
		const { items, availableLabels } = get();
		const labelDef = availableLabels.find((l) => l.name === label);
		if (!labelDef) return;
		const newLabel: EntityLabel = {
			start,
			end,
			label,
			color: labelDef.color,
		};
		set({
			items: items.map((item) => (item.id === itemId ? { ...item, labels: [...item.labels, newLabel] } : item)),
		});
	},

	removeLabel: (itemId, labelIndex) => {
		const { items } = get();
		set({
			items: items.map((item) =>
				item.id === itemId
					? {
							...item,
							labels: item.labels.filter((_, i) => i !== labelIndex),
						}
					: item,
			),
		});
	},

	setActiveLabel: (name) => set({ activeLabel: name }),
}));

/**
 * useLinkBus — Lightweight pub/sub for cross-pane line linking.
 *
 * Modeled after Godbolt's EventHub. When the user hovers a line in CodePane,
 * it emits a LinkLineEvent. The graph subscribes and highlights the node.
 * When a node is clicked in the graph, it emits back and the CodePane scrolls.
 *
 * Usage:
 *   const bus = useLinkBus()
 *   bus.emit({ sourceNodeId: 'x', sourceLine: 5, sender: 'code', reveal: true })
 *   bus.subscribe((evt) => { ... })
 */
import { useCallback, useEffect, useRef } from "react";

export interface LinkLineEvent {
	/** The node ID whose code is being referenced */
	sourceNodeId: string;
	/** Line number in the code (0-indexed) */
	sourceLine?: number;
	/** Which pane emitted this event */
	sender: "code" | "graph" | "detail" | "chat";
	/** Whether to scroll/pan the target pane to this line/node */
	reveal: boolean;
	/** Optional: specific token/label text to highlight */
	label?: string;
}

type Listener = (event: LinkLineEvent) => void;

// Singleton bus shared across all components via ref
const listeners = new Set<Listener>();

export function useLinkBus() {
	const listenerRef = useRef<Listener | null>(null);

	const emit = useCallback((event: LinkLineEvent) => {
		for (const fn of listeners) {
			fn(event);
		}
	}, []);

	const subscribe = useCallback((fn: Listener) => {
		listenerRef.current = fn;
		listeners.add(fn);
		return () => {
			listeners.delete(fn);
			listenerRef.current = null;
		};
	}, []);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			if (listenerRef.current) {
				listeners.delete(listenerRef.current);
			}
		};
	}, []);

	return { emit, subscribe };
}

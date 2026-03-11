import { Canvas } from "fabric";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCanvasStore } from "../store/canvasStore";

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 20.0;

export interface Viewport {
	x: number;
	y: number;
}

export interface UseCanvasReturn {
	canvasRef: React.RefObject<HTMLCanvasElement | null>;
	canvas: Canvas | null;
	zoom: number;
	viewport: Viewport;
	setZoom: (level: number, point?: { x: number; y: number }) => void;
	panTo: (x: number, y: number) => void;
	zoomToFit: () => void;
}

export function clampZoom(z: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/**
 * Compute the new viewport transform after zooming toward a point.
 * Returns a new 6-element transform array.
 */
export function computeZoomTransform(
	currentTransform: number[],
	newZoom: number,
	point: { x: number; y: number },
): number[] {
	const clamped = clampZoom(newZoom);
	const oldZoom = currentTransform[0];
	const out = [...currentTransform];

	// Zoom toward cursor: adjust pan so the point under cursor stays fixed
	out[0] = clamped;
	out[3] = clamped;
	out[4] = point.x - (point.x - currentTransform[4]) * (clamped / oldZoom);
	out[5] = point.y - (point.y - currentTransform[5]) * (clamped / oldZoom);

	return out;
}

/**
 * Compute a pan transform. Returns a new 6-element transform array.
 */
export function computePanTransform(currentTransform: number[], x: number, y: number): number[] {
	const out = [...currentTransform];
	out[4] = x;
	out[5] = y;
	return out;
}

export function useCanvas(): UseCanvasReturn {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const canvasInstance = useRef<Canvas | null>(null);
	const [canvas, setCanvas] = useState<Canvas | null>(null);
	const [zoom, setZoomState] = useState(1);
	const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0 });

	const syncState = useCallback((c: Canvas) => {
		const vt = c.viewportTransform;
		setZoomState(vt[0]);
		setViewport({ x: vt[4], y: vt[5] });
		// Mirror viewport to the Zustand store so StatusBar and other consumers read correct values
		useCanvasStore.getState().setViewport({ x: vt[4], y: vt[5], zoom: vt[0] });
	}, []);

	// Initialize canvas
	useEffect(() => {
		const el = canvasRef.current;
		if (!el) return;

		const c = new Canvas(el, {
			skipOffscreen: true,
			selection: true,
			renderOnAddRemove: true,
		});

		canvasInstance.current = c;
		setCanvas(c);
		syncState(c);

		return () => {
			c.dispose();
			canvasInstance.current = null;
			setCanvas(null);
		};
	}, [syncState]);

	const setZoom = useCallback(
		(level: number, point?: { x: number; y: number }) => {
			const c = canvasInstance.current;
			if (!c) return;

			const center = point ?? {
				x: c.getWidth() / 2,
				y: c.getHeight() / 2,
			};

			const newVt = computeZoomTransform(c.viewportTransform, level, center);
			c.setViewportTransform(newVt as Canvas["viewportTransform"]);
			c.requestRenderAll();
			syncState(c);
		},
		[syncState],
	);

	const panTo = useCallback(
		(x: number, y: number) => {
			const c = canvasInstance.current;
			if (!c) return;

			const newVt = computePanTransform(c.viewportTransform, x, y);
			c.setViewportTransform(newVt as Canvas["viewportTransform"]);
			c.requestRenderAll();
			syncState(c);
		},
		[syncState],
	);

	const zoomToFit = useCallback(() => {
		const c = canvasInstance.current;
		if (!c) return;

		const objects = c.getObjects();
		if (objects.length === 0) {
			// Reset to identity
			c.setViewportTransform([1, 0, 0, 1, 0, 0] as Canvas["viewportTransform"]);
			c.requestRenderAll();
			syncState(c);
			return;
		}

		// Calculate bounding box of all objects
		let minX = Infinity,
			minY = Infinity,
			maxX = -Infinity,
			maxY = -Infinity;
		for (const obj of objects) {
			const bound = obj.getBoundingRect();
			minX = Math.min(minX, bound.left);
			minY = Math.min(minY, bound.top);
			maxX = Math.max(maxX, bound.left + bound.width);
			maxY = Math.max(maxY, bound.top + bound.height);
		}

		const contentWidth = maxX - minX;
		const contentHeight = maxY - minY;
		if (contentWidth === 0 || contentHeight === 0) return;

		const canvasWidth = c.getWidth();
		const canvasHeight = c.getHeight();
		const padding = 40;

		const scaleX = (canvasWidth - padding * 2) / contentWidth;
		const scaleY = (canvasHeight - padding * 2) / contentHeight;
		const newZoom = clampZoom(Math.min(scaleX, scaleY));

		const centerX = (minX + maxX) / 2;
		const centerY = (minY + maxY) / 2;

		const vt: number[] = [
			newZoom,
			0,
			0,
			newZoom,
			canvasWidth / 2 - centerX * newZoom,
			canvasHeight / 2 - centerY * newZoom,
		];

		c.setViewportTransform(vt as Canvas["viewportTransform"]);
		c.requestRenderAll();
		syncState(c);
	}, [syncState]);

	return { canvasRef, canvas, zoom, viewport, setZoom, panTo, zoomToFit };
}

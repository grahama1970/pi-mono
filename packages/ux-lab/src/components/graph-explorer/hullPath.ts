/**
 * Convex hull path utility for cluster outlines.
 * Extracted from BinaryGraph.tsx for reuse across graph viewers.
 */
import * as d3 from "d3";

/** Compute padded convex hull SVG path from a set of 2D points. */
export function hullPath(points: [number, number][], pad = 16): string {
	if (points.length < 3) {
		// For 1-2 points, draw a circle/ellipse around them
		const cx = points.reduce((s, p) => s + p[0], 0) / points.length;
		const cy = points.reduce((s, p) => s + p[1], 0) / points.length;
		return `M${cx - pad},${cy} A${pad},${pad} 0 1,1 ${cx + pad},${cy} A${pad},${pad} 0 1,1 ${cx - pad},${cy}Z`;
	}
	const hull = d3.polygonHull(points);
	if (!hull) return "";
	// Pad the hull outward from centroid
	const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length;
	const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length;
	const padded = hull.map(([x, y]) => {
		const dx = x - cx,
			dy = y - cy;
		const dist = Math.sqrt(dx * dx + dy * dy) || 1;
		return [x + (dx / dist) * pad, y + (dy / dist) * pad] as [number, number];
	});
	return `M${padded.map((p) => p.join(",")).join("L")}Z`;
}

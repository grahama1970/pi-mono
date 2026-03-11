import { describe, expect, it } from "vitest";
import { clampZoom, computePanTransform, computeZoomTransform } from "../src/canvas/useCanvas";

describe("clampZoom", () => {
	it("returns the value when within bounds", () => {
		expect(clampZoom(1)).toBe(1);
		expect(clampZoom(5)).toBe(5);
		expect(clampZoom(0.5)).toBe(0.5);
	});

	it("clamps to minimum 0.1", () => {
		expect(clampZoom(0.05)).toBe(0.1);
		expect(clampZoom(0)).toBe(0.1);
		expect(clampZoom(-1)).toBe(0.1);
	});

	it("clamps to maximum 20.0", () => {
		expect(clampZoom(20)).toBe(20);
		expect(clampZoom(25)).toBe(20);
		expect(clampZoom(100)).toBe(20);
	});

	it("handles exact boundary values", () => {
		expect(clampZoom(0.1)).toBe(0.1);
		expect(clampZoom(20.0)).toBe(20.0);
	});
});

describe("computeZoomTransform", () => {
	const identity = [1, 0, 0, 1, 0, 0];

	it("sets zoom level in transform[0] and transform[3]", () => {
		const result = computeZoomTransform(identity, 2, { x: 0, y: 0 });
		expect(result[0]).toBe(2);
		expect(result[3]).toBe(2);
	});

	it("clamps zoom to min/max", () => {
		const tooLow = computeZoomTransform(identity, 0.01, { x: 0, y: 0 });
		expect(tooLow[0]).toBe(0.1);
		expect(tooLow[3]).toBe(0.1);

		const tooHigh = computeZoomTransform(identity, 50, { x: 0, y: 0 });
		expect(tooHigh[0]).toBe(20);
		expect(tooHigh[3]).toBe(20);
	});

	it("zooms toward cursor position — origin stays fixed when zooming at origin", () => {
		const result = computeZoomTransform(identity, 2, { x: 0, y: 0 });
		// When zooming at origin (0,0), pan should remain 0
		expect(result[4]).toBe(0);
		expect(result[5]).toBe(0);
	});

	it("zooms toward cursor — point under cursor stays fixed", () => {
		// Start at identity (zoom=1, pan=0,0), zoom to 2x at point (100, 100)
		const result = computeZoomTransform(identity, 2, { x: 100, y: 100 });
		// The point (100,100) in screen coords should map to the same world coord
		// Before: world = (screen - pan) / zoom = (100 - 0) / 1 = 100
		// After:  world = (screen - newPan) / newZoom = (100 - result[4]) / 2
		// These should be equal: 100 = (100 - result[4]) / 2 => result[4] = -100
		expect(result[4]).toBe(-100);
		expect(result[5]).toBe(-100);
	});

	it("preserves off-diagonal transform elements", () => {
		const skewed = [1, 0.5, 0.3, 1, 10, 20];
		const result = computeZoomTransform(skewed, 2, { x: 0, y: 0 });
		expect(result[1]).toBe(0.5);
		expect(result[2]).toBe(0.3);
	});

	it("does not mutate the input array", () => {
		const original = [1, 0, 0, 1, 50, 50];
		const copy = [...original];
		computeZoomTransform(original, 3, { x: 100, y: 100 });
		expect(original).toEqual(copy);
	});
});

describe("computePanTransform", () => {
	it("sets pan values in transform[4] and transform[5]", () => {
		const identity = [1, 0, 0, 1, 0, 0];
		const result = computePanTransform(identity, 150, -200);
		expect(result[4]).toBe(150);
		expect(result[5]).toBe(-200);
	});

	it("preserves zoom and other transform values", () => {
		const zoomed = [2, 0, 0, 2, 100, 100];
		const result = computePanTransform(zoomed, 50, 75);
		expect(result[0]).toBe(2);
		expect(result[3]).toBe(2);
		expect(result[1]).toBe(0);
		expect(result[2]).toBe(0);
		expect(result[4]).toBe(50);
		expect(result[5]).toBe(75);
	});

	it("does not mutate the input array", () => {
		const original = [1, 0, 0, 1, 10, 20];
		const copy = [...original];
		computePanTransform(original, 999, 888);
		expect(original).toEqual(copy);
	});

	it("handles negative pan values", () => {
		const identity = [1, 0, 0, 1, 0, 0];
		const result = computePanTransform(identity, -500, -300);
		expect(result[4]).toBe(-500);
		expect(result[5]).toBe(-300);
	});
});

describe("zoom + pan composition", () => {
	it("zoom then pan produces correct transform", () => {
		const identity = [1, 0, 0, 1, 0, 0];
		const zoomed = computeZoomTransform(identity, 3, { x: 200, y: 200 });
		const panned = computePanTransform(zoomed, zoomed[4] + 50, zoomed[5] + 50);

		expect(panned[0]).toBe(3); // zoom preserved
		expect(panned[3]).toBe(3);
		expect(panned[4]).toBe(zoomed[4] + 50);
		expect(panned[5]).toBe(zoomed[5] + 50);
	});

	it("successive zooms at same point converge", () => {
		let vt = [1, 0, 0, 1, 0, 0];
		const point = { x: 300, y: 300 };

		// Zoom in 10 times by 10% each
		for (let i = 0; i < 10; i++) {
			vt = computeZoomTransform(vt, vt[0] * 1.1, point);
		}

		// The world coordinate under the cursor should remain the same
		// world = (screen - pan) / zoom
		const worldX = (point.x - vt[4]) / vt[0];
		const worldY = (point.y - vt[5]) / vt[3];

		// Original world coord at identity: (300 - 0) / 1 = 300
		expect(worldX).toBeCloseTo(300, 5);
		expect(worldY).toBeCloseTo(300, 5);
	});
});

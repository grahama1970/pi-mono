import { describe, expect, test } from "vitest";
import {
	isCharacterOffscreenAtTime,
	runtimeTrackedKeyframeBoxAtTime,
	type WatchKeyframeAnnotationBox,
} from "./watchAnnotationTracking";

const boxes: WatchKeyframeAnnotationBox[] = [
	{
		id: "kf-1",
		characterName: "Alice",
		actorName: "Actor A",
		timestampSeconds: 1,
		bbox: [0.1, 0.1, 0.3, 0.4],
		annotationTrackId: "row4:alice:seq1",
		visibilityState: "visible",
		status: "receipt_written",
	},
	{
		id: "kf-2",
		characterName: "Alice",
		actorName: "Actor A",
		timestampSeconds: 3,
		bbox: [0.3, 0.1, 0.5, 0.4],
		annotationTrackId: "row4:alice:seq1",
		visibilityState: "visible",
		status: "receipt_written",
	},
	{
		id: "stop-1",
		characterName: "Alice",
		actorName: "Actor A",
		timestampSeconds: 4,
		bbox: null,
		annotationTrackId: "row4:alice:seq1",
		visibilityState: "offscreen",
		trackControlAction: "stop_character_scan",
		status: "receipt_written",
	},
	{
		id: "kf-3",
		characterName: "Alice",
		actorName: "Actor A",
		timestampSeconds: 6,
		bbox: [0.6, 0.2, 0.8, 0.5],
		annotationTrackId: "row4:alice:seq2",
		visibilityState: "visible",
		status: "receipt_written",
	},
];

describe("watch annotation runtime tracking", () => {
	test("interpolates visible keyframes and stops at offscreen controls", () => {
		expect(runtimeTrackedKeyframeBoxAtTime(boxes, 0.5, "Alice")).toBeNull();

		const exact = runtimeTrackedKeyframeBoxAtTime(boxes, 1.05, "Alice");
		expect(exact?.runtimePolicy).toBe("exact_keyframe");
		expect(exact?.sourceKeyframeId).toBe("kf-1");

		const interpolated = runtimeTrackedKeyframeBoxAtTime(boxes, 2, "Alice");
		expect(interpolated?.runtimePolicy).toBe("linear_interpolated_keyframe");
		expect(interpolated?.bbox).toEqual([0.2, 0.1, 0.4, 0.4]);

		const held = runtimeTrackedKeyframeBoxAtTime(boxes, 3.5, "Alice");
		expect(held?.runtimePolicy).toBe("hold_from_last_keyframe_until_offscreen");
		expect(held?.bbox).toEqual([0.3, 0.1, 0.5, 0.4]);

		expect(runtimeTrackedKeyframeBoxAtTime(boxes, 4, "Alice")).toBeNull();
		expect(runtimeTrackedKeyframeBoxAtTime(boxes, 5, "Alice")).toBeNull();
		expect(isCharacterOffscreenAtTime(boxes, "Alice", 5)).toBe(true);

		const reappeared = runtimeTrackedKeyframeBoxAtTime(boxes, 6.2, "Alice");
		expect(reappeared?.runtimePolicy).toBe("hold_from_last_keyframe_until_offscreen");
		expect(reappeared?.sourceKeyframeId).toBe("kf-3");
		expect(isCharacterOffscreenAtTime(boxes, "Alice", 6.2)).toBe(false);

		const singleKeyframeOnly: WatchKeyframeAnnotationBox[] = [boxes[0]];
		const singleHeld = runtimeTrackedKeyframeBoxAtTime(singleKeyframeOnly, 1.35, "Alice");
		expect(singleHeld?.runtimePolicy).toBe("hold_from_last_keyframe_until_offscreen");
		expect(singleHeld?.sourceKeyframeId).toBe("kf-1");
	});

	test("allows legacy track id reuse after an offscreen control", () => {
		const reusedTrackAfterStop: WatchKeyframeAnnotationBox[] = [
			{
				id: "legacy-kf-1",
				characterName: "Willie",
				actorName: "Billy Bob Thornton",
				timestampSeconds: 2,
				bbox: [0.2, 0.2, 0.4, 0.6],
				annotationTrackId: "row9:willie:seq1",
				visibilityState: "visible",
				status: "receipt_written",
			},
			{
				id: "legacy-stop-1",
				characterName: "Willie",
				actorName: "Billy Bob Thornton",
				timestampSeconds: 3,
				bbox: null,
				annotationTrackId: "row9:willie:seq1",
				visibilityState: "offscreen",
				trackControlAction: "stop_character_scan",
				status: "receipt_written",
			},
			{
				id: "legacy-kf-2",
				characterName: "Willie",
				actorName: "Billy Bob Thornton",
				timestampSeconds: 19.25,
				bbox: [0.4, 0.0, 0.7, 0.8],
				annotationTrackId: "row9:willie:seq1",
				visibilityState: "visible",
				status: "receipt_written",
			},
		];

		const heldAfterReusedTrackStop = runtimeTrackedKeyframeBoxAtTime(reusedTrackAfterStop, 19.5, "Willie");
		expect(heldAfterReusedTrackStop?.runtimePolicy).toBe("hold_from_last_keyframe_until_offscreen");
		expect(heldAfterReusedTrackStop?.sourceKeyframeId).toBe("legacy-kf-2");
	});

	test("keeps a YOLO-linked character unassigned after a stop until reassigned", () => {
		const row10TrackEvents: WatchKeyframeAnnotationBox[] = [
			{
				id: "row10-track15-willie-kf-1",
				characterName: "Willie",
				actorName: "Billy Bob Thornton",
				timestampSeconds: 0.9,
				bbox: [0.2, 0.05, 0.5, 0.9],
				annotationTrackId: "bad_santa:row10:yolo:track_15",
				visibilityState: "visible",
				status: "receipt_written",
			},
			{
				id: "row10-track15-stop-1",
				characterName: "Willie",
				actorName: "Billy Bob Thornton",
				timestampSeconds: 1.792,
				bbox: null,
				annotationTrackId: "bad_santa:row10:yolo:track_15",
				visibilityState: "offscreen",
				trackControlAction: "stop_character_scan",
				status: "receipt_written",
			},
			{
				id: "row10-track15-willie-kf-2",
				characterName: "Willie",
				actorName: "Billy Bob Thornton",
				timestampSeconds: 4.542,
				bbox: [0.25, 0.1, 0.55, 0.85],
				annotationTrackId: "bad_santa:row10:yolo:track_15",
				visibilityState: "visible",
				status: "receipt_written",
			},
		];

		const beforeStop = runtimeTrackedKeyframeBoxAtTime(row10TrackEvents, 1.25, "Willie");
		expect(beforeStop?.runtimePolicy).toBe("hold_from_last_keyframe_until_offscreen");
		expect(beforeStop?.sourceKeyframeId).toBe("row10-track15-willie-kf-1");

		expect(runtimeTrackedKeyframeBoxAtTime(row10TrackEvents, 2.02, "Willie")).toBeNull();
		expect(runtimeTrackedKeyframeBoxAtTime(row10TrackEvents, 3.5, "Willie")).toBeNull();
		expect(isCharacterOffscreenAtTime(row10TrackEvents, "Willie", 3.5)).toBe(true);
		expect(runtimeTrackedKeyframeBoxAtTime(row10TrackEvents, 3.5, "Unassigned")).toBeNull();

		const afterReassignment = runtimeTrackedKeyframeBoxAtTime(row10TrackEvents, 5.0, "Willie");
		expect(afterReassignment?.runtimePolicy).toBe("hold_from_last_keyframe_until_offscreen");
		expect(afterReassignment?.sourceKeyframeId).toBe("row10-track15-willie-kf-2");
		expect(isCharacterOffscreenAtTime(row10TrackEvents, "Willie", 5.0)).toBe(false);
	});
});

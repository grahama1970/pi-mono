export type NormalizedBbox = [number, number, number, number];

export type WatchKeyframeAnnotationBox = {
	id: string;
	bbox?: NormalizedBbox | null;
	characterName?: string;
	actorName?: string;
	timestampSeconds?: number | null;
	status?: "draft" | "receipt_written" | string;
	annotationTrackId?: string;
	visibilityState?: "visible" | "offscreen" | string;
	trackControlAction?: "stop_character_scan" | string;
	receiptPath?: string;
};

export type AnnotationRuntimePolicy =
	| "exact_keyframe"
	| "linear_interpolated_keyframe"
	| "hold_from_last_keyframe_until_offscreen";

export type RuntimeTrackedKeyframeBox = WatchKeyframeAnnotationBox & {
	bbox: NormalizedBbox;
	timestampSeconds: number;
	visibilityState: "visible";
	runtimePolicy: AnnotationRuntimePolicy;
	sourceKeyframeId?: string;
	interpolationStartId?: string;
	interpolationEndId?: string;
	effectiveTrackId: string;
};

export type RuntimeTrackingOptions = {
	exactToleranceSeconds?: number;
};

type TimedAnnotationEvent = WatchKeyframeAnnotationBox & {
	timestampSeconds: number;
	effectiveTrackId: string;
};

type VisibleTimedAnnotationEvent = TimedAnnotationEvent & {
	bbox: NormalizedBbox;
};

const DEFAULT_EXACT_TOLERANCE_SECONDS = 0.18;
const TIME_EPSILON_SECONDS = 0.000_001;

function finiteSeconds(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function clamp01(value: number): number {
	if (value < 0) return 0;
	if (value > 1) return 1;
	return value;
}

function safeAnnotationIdPart(value: unknown): string {
	return (
		String(value ?? "")
			.trim()
			.toLowerCase()
			.replace(/[^a-z0-9._:-]+/g, "_")
			.replace(/^_+|_+$/g, "")
			.slice(0, 80) || "unknown"
	);
}

export function sameAnnotationCharacter(left: string | undefined, right: string | undefined): boolean {
	return (
		String(left ?? "")
			.trim()
			.toLowerCase() ===
		String(right ?? "")
			.trim()
			.toLowerCase()
	);
}

export function hasVisibleAnnotationBbox(
	box: WatchKeyframeAnnotationBox,
): box is WatchKeyframeAnnotationBox & { bbox: NormalizedBbox } {
	return box.visibilityState !== "offscreen" && Array.isArray(box.bbox) && box.bbox.length === 4;
}

export function isStopCharacterScanEvent(box: WatchKeyframeAnnotationBox): boolean {
	return box.visibilityState === "offscreen" && box.trackControlAction === "stop_character_scan";
}

export function interpolateNormalizedBbox(a: NormalizedBbox, b: NormalizedBbox, ratio: number): NormalizedBbox {
	const t = clamp01(ratio);
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
}

function compareEventsByTimeThenKind(left: WatchKeyframeAnnotationBox, right: WatchKeyframeAnnotationBox): number {
	const leftTime = finiteSeconds(left.timestampSeconds) ? left.timestampSeconds : 0;
	const rightTime = finiteSeconds(right.timestampSeconds) ? right.timestampSeconds : 0;
	if (leftTime !== rightTime) return leftTime - rightTime;
	return Number(isStopCharacterScanEvent(left)) - Number(isStopCharacterScanEvent(right));
}

function annotationEventsForCharacter(
	boxes: WatchKeyframeAnnotationBox[],
	characterName: string,
): TimedAnnotationEvent[] {
	const sorted = boxes
		.filter((box) => sameAnnotationCharacter(box.characterName, characterName) && finiteSeconds(box.timestampSeconds))
		.sort(compareEventsByTimeThenKind);

	let implicitSequenceIndex = 1;
	const characterPart = safeAnnotationIdPart(characterName);
	const events: TimedAnnotationEvent[] = [];

	for (const box of sorted) {
		if (!finiteSeconds(box.timestampSeconds)) continue;
		const effectiveTrackId = box.annotationTrackId || `implicit:${characterPart}:seq${implicitSequenceIndex}`;
		events.push({
			...box,
			timestampSeconds: box.timestampSeconds,
			effectiveTrackId,
		});
		if (isStopCharacterScanEvent(box)) implicitSequenceIndex += 1;
	}

	return events;
}

function trackGroups(events: TimedAnnotationEvent[]): TimedAnnotationEvent[][] {
	const byTrack = new Map<string, TimedAnnotationEvent[]>();
	for (const event of events) {
		const group = byTrack.get(event.effectiveTrackId) ?? [];
		group.push(event);
		byTrack.set(event.effectiveTrackId, group);
	}
	return Array.from(byTrack.values()).map((group) =>
		group.sort((left, right) => left.timestampSeconds - right.timestampSeconds),
	);
}

function visibleEvents(events: TimedAnnotationEvent[]): VisibleTimedAnnotationEvent[] {
	return events
		.filter((event): event is VisibleTimedAnnotationEvent => hasVisibleAnnotationBbox(event))
		.sort((left, right) => left.timestampSeconds - right.timestampSeconds);
}

function stopEvents(events: TimedAnnotationEvent[]): TimedAnnotationEvent[] {
	return events.filter(isStopCharacterScanEvent).sort((left, right) => left.timestampSeconds - right.timestampSeconds);
}

function firstStopAfter(stops: TimedAnnotationEvent[], timestampSeconds: number): TimedAnnotationEvent | null {
	return stops.find((stop) => stop.timestampSeconds > timestampSeconds + TIME_EPSILON_SECONDS) ?? null;
}

function lastStopAtOrBefore(stops: TimedAnnotationEvent[], timestampSeconds: number): TimedAnnotationEvent | null {
	return [...stops].reverse().find((stop) => stop.timestampSeconds <= timestampSeconds + TIME_EPSILON_SECONDS) ?? null;
}

function runtimeBoxFromExact(event: VisibleTimedAnnotationEvent): RuntimeTrackedKeyframeBox {
	return {
		...event,
		bbox: event.bbox,
		timestampSeconds: event.timestampSeconds,
		visibilityState: "visible",
		runtimePolicy: "exact_keyframe",
		sourceKeyframeId: event.id,
		effectiveTrackId: event.effectiveTrackId,
	};
}

function runtimeBoxFromHold(previous: VisibleTimedAnnotationEvent, timeSeconds: number): RuntimeTrackedKeyframeBox {
	return {
		...previous,
		id: `held-${previous.id}-${Math.round(timeSeconds * 100)}`,
		bbox: previous.bbox,
		timestampSeconds: timeSeconds,
		visibilityState: "visible",
		runtimePolicy: "hold_from_last_keyframe_until_offscreen",
		sourceKeyframeId: previous.id,
		effectiveTrackId: previous.effectiveTrackId,
	};
}

function runtimeBoxFromInterpolation(
	previous: VisibleTimedAnnotationEvent,
	next: VisibleTimedAnnotationEvent,
	timeSeconds: number,
): RuntimeTrackedKeyframeBox {
	const start = previous.timestampSeconds;
	const end = next.timestampSeconds;
	const ratio = end === start ? 0 : (timeSeconds - start) / (end - start);
	return {
		...previous,
		id: `interpolated-${previous.id}-${next.id}-${Math.round(timeSeconds * 100)}`,
		bbox: interpolateNormalizedBbox(previous.bbox, next.bbox, ratio),
		characterName: previous.characterName || next.characterName,
		actorName: previous.actorName || next.actorName,
		timestampSeconds: timeSeconds,
		status: "draft",
		annotationTrackId: previous.annotationTrackId || next.annotationTrackId,
		visibilityState: "visible",
		runtimePolicy: "linear_interpolated_keyframe",
		interpolationStartId: previous.id,
		interpolationEndId: next.id,
		effectiveTrackId: previous.effectiveTrackId,
	};
}

export function runtimeTrackedKeyframeBoxAtTime(
	boxes: WatchKeyframeAnnotationBox[],
	timeSeconds: number,
	characterName: string,
	options: RuntimeTrackingOptions = {},
): RuntimeTrackedKeyframeBox | null {
	if (!finiteSeconds(timeSeconds)) return null;
	const exactToleranceSeconds = options.exactToleranceSeconds ?? DEFAULT_EXACT_TOLERANCE_SECONDS;
	const events = annotationEventsForCharacter(boxes, characterName);
	if (events.length === 0) return null;

	const candidates: Array<{
		box: RuntimeTrackedKeyframeBox;
		priority: number;
		previousTime: number;
		exactDistance: number;
	}> = [];

	for (const eventsInTrack of trackGroups(events)) {
		const stops = stopEvents(eventsInTrack);
		const latestPriorStop = lastStopAtOrBefore(stops, timeSeconds);
		const visibles = visibleEvents(eventsInTrack).filter(
			(event) =>
				!latestPriorStop || event.timestampSeconds > latestPriorStop.timestampSeconds + TIME_EPSILON_SECONDS,
		);
		if (visibles.length === 0) continue;

		const exact = visibles
			.filter((event) => Math.abs(event.timestampSeconds - timeSeconds) <= exactToleranceSeconds)
			.sort(
				(left, right) =>
					Math.abs(left.timestampSeconds - timeSeconds) - Math.abs(right.timestampSeconds - timeSeconds),
			)[0];

		if (exact) {
			candidates.push({
				box: runtimeBoxFromExact(exact),
				priority: 3,
				previousTime: exact.timestampSeconds,
				exactDistance: Math.abs(exact.timestampSeconds - timeSeconds),
			});
			continue;
		}

		const previous = [...visibles]
			.reverse()
			.find((event) => event.timestampSeconds <= timeSeconds + TIME_EPSILON_SECONDS);
		if (!previous) continue;

		const stopAfterPrevious = firstStopAfter(stops, previous.timestampSeconds);
		if (stopAfterPrevious && timeSeconds >= stopAfterPrevious.timestampSeconds - TIME_EPSILON_SECONDS) continue;

		const next = visibles.find(
			(event) => event.id !== previous.id && event.timestampSeconds >= timeSeconds - TIME_EPSILON_SECONDS,
		);

		if (
			next &&
			next.timestampSeconds > previous.timestampSeconds + TIME_EPSILON_SECONDS &&
			(!stopAfterPrevious || next.timestampSeconds < stopAfterPrevious.timestampSeconds - TIME_EPSILON_SECONDS)
		) {
			candidates.push({
				box: runtimeBoxFromInterpolation(previous, next, timeSeconds),
				priority: 2,
				previousTime: previous.timestampSeconds,
				exactDistance: Number.POSITIVE_INFINITY,
			});
			continue;
		}

		candidates.push({
			box: runtimeBoxFromHold(previous, timeSeconds),
			priority: 1,
			previousTime: previous.timestampSeconds,
			exactDistance: Number.POSITIVE_INFINITY,
		});
	}

	if (candidates.length === 0) return null;

	candidates.sort((left, right) => {
		if (left.priority !== right.priority) return right.priority - left.priority;
		if (left.exactDistance !== right.exactDistance) return left.exactDistance - right.exactDistance;
		return right.previousTime - left.previousTime;
	});

	return candidates[0].box;
}

export function isCharacterOffscreenAtTime(
	boxes: WatchKeyframeAnnotationBox[],
	characterName: string,
	timeSeconds: number,
): boolean {
	const latest = boxes
		.filter(
			(box) =>
				sameAnnotationCharacter(box.characterName, characterName) &&
				finiteSeconds(box.timestampSeconds) &&
				box.timestampSeconds <= timeSeconds,
		)
		.sort((a, b) => (b.timestampSeconds ?? 0) - (a.timestampSeconds ?? 0))[0];
	return !!latest && isStopCharacterScanEvent(latest);
}

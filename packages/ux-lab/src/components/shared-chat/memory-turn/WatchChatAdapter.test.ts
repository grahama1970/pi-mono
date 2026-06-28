import { describe, expect, it } from "vitest";
import { collectMemoryTurn } from "./MemoryTurnAdapter";
import { WatchChatAdapter, type WatchSceneRow } from "./WatchChatAdapter";

function jsonResponse(payload: unknown, status = 200): Response {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

const frameBackedRows: WatchSceneRow[] = [
	{
		timecode: "00:42",
		text: "Willie walks into the store.",
		movie_segment: "00:40-00:45",
		visual_description: "Willie is wearing a red Santa suit near a store display.",
		scene_marker_image_path: "/tmp/watch/frame_0042.jpg",
		video_clip_path: "/tmp/watch/clip_0042.mp4",
	},
];

describe("WatchChatAdapter evidence-first visual answers", () => {
	it("prefers loaded frame-backed Watch evidence over a remote transcript-only appearance answer", async () => {
		const adapter = new WatchChatAdapter({
			reportPath: "/tmp/watch/report.json",
			answerModel: "watch-row-ranker-v1",
			reportRows: frameBackedRows,
			fetch: async () =>
				jsonResponse({
					answer: "Remote transcript answer: Willie is discussed in dialogue.",
					route: "ANSWER",
					matched_rows: [{ timecode: "00:42", text: "Willie walks into the store." }],
				}),
		});

		const { message } = await collectMemoryTurn(adapter.sendTurn({ text: "What does Willie look like?" }));

		expect(message.content).toContain("From the extracted Watch visual evidence");
		expect(message.content).toContain("Willie is wearing a red Santa suit");
		expect(message.content).toContain("image=/tmp/watch/frame_0042.jpg");
		expect(message.content).not.toContain("Remote transcript answer");
		expect(message.metadata?.matchedRows).toMatchObject([
			{
				timecode: "00:42",
				scene_marker_image_path: "/tmp/watch/frame_0042.jpg",
				video_clip_path: "/tmp/watch/clip_0042.mp4",
			},
		]);
		expect(message.metadata?.answerPacket).toMatchObject({
			local_fallback: true,
			remote_answer_packet: {
				answer: "Remote transcript answer: Willie is discussed in dialogue.",
			},
		});
	});

	it("fails closed for appearance questions when loaded Watch rows have no frame or video evidence", async () => {
		const adapter = new WatchChatAdapter({
			reportPath: "/tmp/watch/report.json",
			answerModel: "watch-row-ranker-v1",
			reportRows: [
				{
					timecode: "00:42",
					text: "Willie is mentioned in dialogue.",
					movie_segment: "00:40-00:45",
				},
			],
			fetch: async () =>
				jsonResponse({
					answer: "Remote prose answer: Willie looks like Santa.",
					route: "ANSWER",
					matched_rows: [{ timecode: "00:42", text: "Willie is mentioned in dialogue." }],
				}),
		});

		const { message } = await collectMemoryTurn(adapter.sendTurn({ text: "What does Willie look like?" }));

		expect(message.content).toContain("not present in extracted visual evidence");
		expect(message.content).toContain("Willie");
		expect(message.content).not.toContain("Remote prose answer");
		expect(message.metadata?.matchedRows).toEqual([]);
		expect(message.metadata?.answerPacket).toMatchObject({
			route: "CLARIFY",
			visual_evidence_missing: true,
			remote_answer_packet: {
				answer: "Remote prose answer: Willie looks like Santa.",
			},
		});
	});
});

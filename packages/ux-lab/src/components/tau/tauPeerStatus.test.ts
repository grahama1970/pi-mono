import { describe, expect, it } from "vitest";
import type { Loop2Event, Loop2HarnessPeerMessage, Loop2Summary } from "../scillm/loop2EvidenceAdapter";
import {
	readTauPeerMonitorConfig,
	summarizeTauLoopMonitor,
	summarizeTauPeerMessage,
	validateAndSummarizeTauPeerMessage,
} from "./tauPeerStatus";

const VALID_PEER: Loop2HarnessPeerMessage = {
	schema: "tau.loop_harness_peer_message.v1",
	message_type: "loop2_receipt_available",
	ready: true,
	status: "PASS",
	mocked: false,
	live: true,
	proof_scope: "one bounded loop2 repair node",
	producer: {
		harness: "tau",
		run_id: "loop2-tau-stress-math_add-1782507220-da39d0",
		node_id: "tau-stress-math_add",
	},
	schemas: {
		transport_dag_evidence: "ux_lab.transport_dag_run_evidence.v1",
	},
	endpoints: {
		summary: "http://127.0.0.1:4321/api/loop2/runs/run/summary",
		peer_message: "http://127.0.0.1:4321/api/loop2/runs/run/peer-message",
	},
	claims: {
		proves: ["loop2 executed one bounded repair-node contract"],
		does_not_prove: ["full DAG scheduling"],
	},
	switchboard: {
		id: "tau-loop2_receipt_available-run",
		from: "tau",
		to: "pi-mono",
		type: "info",
		priority: "normal",
		subject: "Tau Loop2 receipt available: loop2-tau-stress-math_add-1782507220-da39d0",
		message: "Tau Loop2 receipt is available.",
		timestamp: "2026-06-26T22:00:00Z",
		metadata: {
			schema: "tau.loop_harness_peer_message.v1",
			ready: true,
			run_id: "loop2-tau-stress-math_add-1782507220-da39d0",
			claims: {
				proves: ["loop2 executed one bounded repair-node contract"],
				does_not_prove: ["full DAG scheduling"],
			},
		},
	},
};

const VALID_SUMMARY: Loop2Summary = {
	schema: "loop2.summary.v1",
	run_id: "loop2-tau-stress-math_add-1782507220-da39d0",
	state: {
		schema: "tau.loop_receipt.current_state.v1",
		state: "ended",
		event_count: 6,
		last_event_type: "receipt_written",
	},
	receipt: {
		schema: "loop2.final_receipt.v1",
		status: "PASS",
		mocked: false,
		live: true,
		proof_scope: "one bounded loop2 repair node",
		claims: {
			proves: ["loop2 executed one bounded repair-node contract"],
			does_not_prove: ["full DAG scheduling"],
		},
	},
};

const VALID_EVENTS: Loop2Event[] = [
	{
		schema: "loop2.event.v1",
		run_id: "loop2-tau-stress-math_add-1782507220-da39d0",
		event_type: "node_started",
		message: "started",
	},
	{
		schema: "loop2.event.v1",
		run_id: "loop2-tau-stress-math_add-1782507220-da39d0",
		event_type: "receipt_written",
		message: "final receipt written",
	},
];

describe("tauPeerStatus", () => {
	it("prefers URL monitor config over localStorage", () => {
		const storage = {
			getItem: (key: string) => (key === "loop2:lastRunId" ? "stored-run" : null),
		};

		expect(readTauPeerMonitorConfig("?loop2BaseUrl=http://127.0.0.1:9999&loop2RunId=url-run", storage)).toEqual({
			baseUrl: "http://127.0.0.1:9999",
			runId: "url-run",
			configured: true,
			source: "url",
		});
	});

	it("reads localStorage monitor config when URL has no run id", () => {
		const storage = {
			getItem: (key: string) => {
				if (key === "loop2:baseUrl") return "http://127.0.0.1:4321";
				if (key === "loop2:lastRunId") return "stored-run";
				return null;
			},
		};

		expect(readTauPeerMonitorConfig("", storage)).toEqual({
			baseUrl: "http://127.0.0.1:4321",
			runId: "stored-run",
			configured: true,
			source: "localStorage",
		});
	});

	it("summarizes missing peer message as fail-closed unavailable", () => {
		const summary = summarizeTauPeerMessage(null, [], "monitor not reachable");

		expect(summary.label).toBe("UNAVAILABLE");
		expect(summary.detail).toBe("monitor not reachable");
	});

	it("accepts valid Tau peer envelopes and preserves does_not_prove", () => {
		const summary = validateAndSummarizeTauPeerMessage(VALID_PEER);

		expect(summary.label).toBe("READY");
		expect(summary.runId).toBe("loop2-tau-stress-math_add-1782507220-da39d0");
		expect(summary.switchboardTarget).toBe("pi-mono");
		expect(summary.switchboardSubject).toBe(
			"Tau Loop2 receipt available: loop2-tau-stress-math_add-1782507220-da39d0",
		);
		expect(summary.doesNotProve).toEqual(["full DAG scheduling"]);
	});

	it("rejects peer envelopes that erase proof boundaries", () => {
		const summary = validateAndSummarizeTauPeerMessage({
			...VALID_PEER,
			claims: { proves: ["claim"], does_not_prove: [] },
			switchboard: {
				...VALID_PEER.switchboard,
				metadata: {
					...VALID_PEER.switchboard?.metadata,
					claims: { proves: ["claim"], does_not_prove: [] },
				},
			},
		});

		expect(summary.label).toBe("INVALID");
		expect(summary.detail).toContain("claims.does_not_prove must be preserved");
		expect(summary.detail).toContain("switchboard.metadata.claims.does_not_prove must be preserved");
	});

	it("summarizes live Loop2 summary and replayed events without upgrading proof scope", () => {
		const summary = summarizeTauLoopMonitor(VALID_SUMMARY, VALID_EVENTS);

		expect(summary.label).toBe("READY");
		expect(summary.runState).toBe("ended");
		expect(summary.receiptStatus).toBe("PASS");
		expect(summary.eventCount).toBe(2);
		expect(summary.lastEventType).toBe("receipt_written");
		expect(summary.mocked).toBe(false);
		expect(summary.live).toBe(true);
		expect(summary.doesNotProve).toEqual(["full DAG scheduling"]);
	});

	it("rejects malformed Loop2 summaries instead of showing ready", () => {
		const summary = summarizeTauLoopMonitor(
			{ ...VALID_SUMMARY, schema: "wrong.schema" as "loop2.summary.v1" },
			VALID_EVENTS,
		);

		expect(summary.label).toBe("INVALID");
		expect(summary.detail).toContain("summary schema must be loop2.summary.v1");
	});
});

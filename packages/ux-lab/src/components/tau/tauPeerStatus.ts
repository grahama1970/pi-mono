import {
	type Loop2Event,
	type Loop2HarnessPeerMessage,
	type Loop2MonitorConfig,
	type Loop2Summary,
	validateLoop2HarnessPeerMessage,
} from "../scillm/loop2EvidenceAdapter";

export type TauPeerMonitorConfig = Loop2MonitorConfig & {
	configured: boolean;
	source: "url" | "localStorage" | "default";
};

export type TauPeerStatusSummary = {
	label: "READY" | "INVALID" | "UNAVAILABLE" | "UNCONFIGURED";
	detail: string;
	statusColor: string;
	runId?: string;
	proofScope?: string;
	switchboardTarget?: string;
	switchboardSubject?: string;
	doesNotProve: string[];
};

export type TauLoopMonitorSummary = {
	label: "READY" | "INVALID" | "UNAVAILABLE";
	detail: string;
	statusColor: string;
	runId?: string;
	runState?: string;
	receiptStatus?: string;
	eventCount: number;
	lastEventType?: string;
	lastEventMessage?: string;
	mocked?: boolean;
	live?: boolean;
	proofScope?: string;
	doesNotProve: string[];
};

const DEFAULT_BASE_URL = "http://127.0.0.1:4321";

export function readTauPeerMonitorConfig(
	locationSearch: string,
	storage: Pick<Storage, "getItem"> | undefined,
): TauPeerMonitorConfig {
	const params = new URLSearchParams(locationSearch);
	const urlBaseUrl = params.get("loop2BaseUrl") || params.get("tauPeerBaseUrl");
	const urlRunId = params.get("loop2RunId") || params.get("tauPeerRunId");
	if (urlRunId) {
		return {
			baseUrl: urlBaseUrl || DEFAULT_BASE_URL,
			runId: urlRunId,
			configured: true,
			source: "url",
		};
	}

	const storedBaseUrl = storage?.getItem("loop2:baseUrl") || storage?.getItem("tau:peerBaseUrl");
	const storedRunId = storage?.getItem("loop2:lastRunId") || storage?.getItem("tau:peerRunId");
	if (storedRunId) {
		return {
			baseUrl: storedBaseUrl || DEFAULT_BASE_URL,
			runId: storedRunId,
			configured: true,
			source: "localStorage",
		};
	}

	return {
		baseUrl: storedBaseUrl || urlBaseUrl || DEFAULT_BASE_URL,
		runId: "",
		configured: false,
		source: "default",
	};
}

export function summarizeTauPeerMessage(
	message: Loop2HarnessPeerMessage | null,
	validationErrors: string[],
	unavailableReason?: string,
): TauPeerStatusSummary {
	if (!message) {
		return {
			label: unavailableReason ? "UNAVAILABLE" : "UNCONFIGURED",
			detail: unavailableReason || "Set loop2:lastRunId or add ?loop2RunId=<run_id> to read a Tau peer envelope.",
			statusColor: unavailableReason ? "#f59e0b" : "#64748b",
			doesNotProve: [],
		};
	}

	const doesNotProve = message.claims?.does_not_prove ?? [];
	if (validationErrors.length > 0) {
		return {
			label: "INVALID",
			detail: validationErrors.join("; "),
			statusColor: "#ef4444",
			runId: message.producer?.run_id,
			proofScope: message.proof_scope,
			switchboardTarget: message.switchboard?.to,
			switchboardSubject: message.switchboard?.subject,
			doesNotProve,
		};
	}

	return {
		label: "READY",
		detail: `${message.producer.run_id} exposes ${Object.keys(message.endpoints ?? {}).length} monitor endpoints.`,
		statusColor: "#22c55e",
		runId: message.producer.run_id,
		proofScope: message.proof_scope,
		switchboardTarget: message.switchboard?.to,
		switchboardSubject: message.switchboard?.subject,
		doesNotProve,
	};
}

export function validateAndSummarizeTauPeerMessage(message: Loop2HarnessPeerMessage): TauPeerStatusSummary {
	return summarizeTauPeerMessage(message, validateLoop2HarnessPeerMessage(message));
}

export function summarizeTauLoopMonitor(
	summary: Loop2Summary | null,
	events: Loop2Event[] | null,
	unavailableReason?: string,
): TauLoopMonitorSummary {
	if (!summary) {
		return {
			label: "UNAVAILABLE",
			detail: unavailableReason || "Tau monitor summary is not available.",
			statusColor: "#f59e0b",
			eventCount: 0,
			doesNotProve: [],
		};
	}

	const errors: string[] = [];
	if (summary.schema !== "loop2.summary.v1") errors.push("summary schema must be loop2.summary.v1");
	if (!summary.run_id) errors.push("summary run_id is required");
	if (!summary.receipt) errors.push("summary receipt is required");
	if (!summary.state) errors.push("summary state is required");

	const eventRows = events ?? [];
	const lastEvent = eventRows[eventRows.length - 1];
	const receiptStatus = summary.receipt?.status;
	const runState = summary.state?.state || summary.state?.status;
	const doesNotProve = summary.receipt?.claims?.does_not_prove ?? [];

	if (errors.length > 0) {
		return {
			label: "INVALID",
			detail: errors.join("; "),
			statusColor: "#ef4444",
			runId: summary.run_id,
			runState,
			receiptStatus,
			eventCount: eventRows.length,
			lastEventType: lastEvent?.event_type,
			lastEventMessage: lastEvent?.message,
			mocked: summary.receipt?.mocked,
			live: summary.receipt?.live,
			proofScope: summary.receipt?.proof_scope,
			doesNotProve,
		};
	}

	return {
		label: receiptStatus === "PASS" ? "READY" : "INVALID",
		detail: `${summary.run_id} summary reports ${eventRows.length} replayable Loop2 events.`,
		statusColor: receiptStatus === "PASS" ? "#22c55e" : "#ef4444",
		runId: summary.run_id,
		runState,
		receiptStatus,
		eventCount: eventRows.length,
		lastEventType: lastEvent?.event_type || summary.state?.last_event_type,
		lastEventMessage: lastEvent?.message,
		mocked: summary.receipt?.mocked,
		live: summary.receipt?.live,
		proofScope: summary.receipt?.proof_scope,
		doesNotProve,
	};
}

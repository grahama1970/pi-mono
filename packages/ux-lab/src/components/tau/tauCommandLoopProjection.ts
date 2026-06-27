import { apiUrl } from "../../lib/apiBase";

export interface TauCommandLoopGithubProjectionReceipt {
	schema: "tau.command_loop_explicit_ticket_source_summary.v1";
	summaryPath: string;
	sourceLoopReceiptPath: string;
	reconciliationReceiptPath: string;
	actualReconciliationStepReceiptPath: string;
	ticketSourcePath: string;
	transportReceiptPath: string;
	dryRun: boolean;
	applied: boolean;
	mocked: boolean;
	live: boolean;
	commandCount: number;
	reconciliationCounts: {
		keep: number;
		close: number;
		migrate: number;
		regenerate: number;
	};
	commands: string[];
}

export type TauCommandLoopGithubProjectionState =
	| { ok: true; receipt: TauCommandLoopGithubProjectionReceipt }
	| { ok: false; error: string; detail: string; summaryPath?: string; proofRoot?: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringField(record: Record<string, unknown>, field: string, errors: string[]): string {
	const value = record[field];
	if (typeof value === "string" && value.trim()) return value;
	errors.push(`${field} must be a non-empty string`);
	return "";
}

function booleanField(record: Record<string, unknown>, field: string, errors: string[]): boolean {
	const value = record[field];
	if (typeof value === "boolean") return value;
	errors.push(`${field} must be boolean`);
	return false;
}

function numberField(record: Record<string, unknown>, field: string, errors: string[]): number {
	const value = record[field];
	if (typeof value === "number" && Number.isFinite(value)) return value;
	errors.push(`${field} must be a finite number`);
	return 0;
}

export function parseTauCommandLoopGithubProjectionResponse(payload: unknown): TauCommandLoopGithubProjectionState {
	if (!isRecord(payload)) {
		return { ok: false, error: "invalid_response", detail: "Tau projection response must be an object" };
	}

	if (payload.ok !== true) {
		return {
			ok: false,
			error: typeof payload.error === "string" ? payload.error : "tau_command_loop_projection_unavailable",
			detail:
				typeof payload.detail === "string" ? payload.detail : "Tau command-loop projection receipt is unavailable.",
			summaryPath: typeof payload.summaryPath === "string" ? payload.summaryPath : undefined,
			proofRoot: typeof payload.proofRoot === "string" ? payload.proofRoot : undefined,
		};
	}

	const receipt = isRecord(payload.receipt) ? payload.receipt : null;
	if (!receipt) {
		return { ok: false, error: "invalid_receipt", detail: "Tau projection response omitted receipt object" };
	}

	const errors: string[] = [];
	const counts = isRecord(receipt.reconciliationCounts) ? receipt.reconciliationCounts : {};
	const commands =
		Array.isArray(receipt.commands) && receipt.commands.every((command) => typeof command === "string")
			? receipt.commands
			: [];
	if (!Array.isArray(receipt.commands) || receipt.commands.some((command) => typeof command !== "string")) {
		errors.push("commands must be a string array");
	}

	const parsed: TauCommandLoopGithubProjectionReceipt = {
		schema: stringField(receipt, "schema", errors) as TauCommandLoopGithubProjectionReceipt["schema"],
		summaryPath: stringField(receipt, "summaryPath", errors),
		sourceLoopReceiptPath: stringField(receipt, "sourceLoopReceiptPath", errors),
		reconciliationReceiptPath: stringField(receipt, "reconciliationReceiptPath", errors),
		actualReconciliationStepReceiptPath: stringField(receipt, "actualReconciliationStepReceiptPath", errors),
		ticketSourcePath: stringField(receipt, "ticketSourcePath", errors),
		transportReceiptPath: stringField(receipt, "transportReceiptPath", errors),
		dryRun: booleanField(receipt, "dryRun", errors),
		applied: booleanField(receipt, "applied", errors),
		mocked: booleanField(receipt, "mocked", errors),
		live: booleanField(receipt, "live", errors),
		commandCount: numberField(receipt, "commandCount", errors),
		reconciliationCounts: {
			keep: numberField(counts, "keep", errors),
			close: numberField(counts, "close", errors),
			migrate: numberField(counts, "migrate", errors),
			regenerate: numberField(counts, "regenerate", errors),
		},
		commands,
	};

	if (parsed.schema !== "tau.command_loop_explicit_ticket_source_summary.v1") {
		errors.push("schema must be tau.command_loop_explicit_ticket_source_summary.v1");
	}
	if (errors.length > 0) {
		return { ok: false, error: "invalid_receipt", detail: errors.join("; "), summaryPath: parsed.summaryPath };
	}
	return { ok: true, receipt: parsed };
}

export async function loadTauCommandLoopGithubProjection(
	fetcher: typeof fetch = fetch,
): Promise<TauCommandLoopGithubProjectionState> {
	const response = await fetcher(apiUrl("/tau/command-loop/github-projection"));
	const text = await response.text();
	let payload: unknown = {};
	try {
		payload = text ? JSON.parse(text) : {};
	} catch {
		return { ok: false, error: "invalid_json", detail: text || "Tau projection endpoint returned invalid JSON" };
	}
	const parsed = parseTauCommandLoopGithubProjectionResponse(payload);
	if (!response.ok && parsed.ok) {
		return { ok: false, error: "http_error", detail: `Tau projection endpoint returned ${response.status}` };
	}
	return parsed;
}

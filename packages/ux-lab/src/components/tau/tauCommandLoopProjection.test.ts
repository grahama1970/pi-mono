import { describe, expect, it } from "vitest";
import {
	loadTauCommandLoopGithubProjection,
	parseTauCommandLoopGithubProjectionResponse,
} from "./tauCommandLoopProjection";

const VALID_RESPONSE = {
	ok: true,
	receipt: {
		schema: "tau.command_loop_explicit_ticket_source_summary.v1",
		summaryPath: "/tmp/tau-command-loop-explicit-ticket-source-proof/summary.json",
		sourceLoopReceiptPath:
			"/tmp/tau-command-loop-explicit-ticket-source-proof/command-loop/command-loop-receipt.json",
		reconciliationReceiptPath:
			"/tmp/tau-command-loop-explicit-ticket-source-proof/command-loop/command-artifacts/command-loop-step-001/goal-guardian-reconciliation-receipt.json",
		actualReconciliationStepReceiptPath:
			"/tmp/tau-command-loop-explicit-ticket-source-proof/command-loop/command-loop-step-001.receipt.json",
		ticketSourcePath: "/tmp/tau-command-loop-explicit-ticket-source-proof/ticket-source.json",
		transportReceiptPath:
			"/tmp/tau-command-loop-explicit-ticket-source-proof/command-loop-reconciliation-github-transport.json",
		dryRun: true,
		applied: false,
		mocked: false,
		live: true,
		commandCount: 2,
		reconciliationCounts: {
			keep: 1,
			close: 0,
			migrate: 3,
			regenerate: 0,
		},
		commands: [
			"gh issue comment 123 --repo grahama1970/chatgpt-lab --body-file -",
			"gh issue edit 123 --repo grahama1970/chatgpt-lab --add-label agent-work,next:human,executor:human,goal-change --remove-label next:goal-guardian,agent-active",
		],
	},
};

describe("tauCommandLoopProjection", () => {
	it("accepts a normalized command-loop GitHub projection receipt", () => {
		const parsed = parseTauCommandLoopGithubProjectionResponse(VALID_RESPONSE);

		expect(parsed).toMatchObject({
			ok: true,
			receipt: {
				summaryPath: "/tmp/tau-command-loop-explicit-ticket-source-proof/summary.json",
				dryRun: true,
				applied: false,
				commandCount: 2,
				reconciliationCounts: { keep: 1, close: 0, migrate: 3, regenerate: 0 },
			},
		});
		if (parsed.ok) {
			expect(parsed.receipt.commands[0]).toBe("gh issue comment 123 --repo grahama1970/chatgpt-lab --body-file -");
		}
	});

	it("fails closed for an unavailable endpoint response", () => {
		const parsed = parseTauCommandLoopGithubProjectionResponse({
			ok: false,
			error: "tau_command_loop_projection_unavailable",
			detail: "Tau command-loop summary receipt not found",
			summaryPath: "/tmp/tau-command-loop-explicit-ticket-source-proof/summary.json",
		});

		expect(parsed).toEqual({
			ok: false,
			error: "tau_command_loop_projection_unavailable",
			detail: "Tau command-loop summary receipt not found",
			summaryPath: "/tmp/tau-command-loop-explicit-ticket-source-proof/summary.json",
			proofRoot: undefined,
		});
	});

	it("refuses malformed receipts instead of fabricating projection metadata", () => {
		const parsed = parseTauCommandLoopGithubProjectionResponse({
			ok: true,
			receipt: {
				...VALID_RESPONSE.receipt,
				commandCount: "two",
				commands: [["gh", "issue", "comment"]],
			},
		});

		expect(parsed).toMatchObject({
			ok: false,
			error: "invalid_receipt",
		});
		expect(parsed.ok ? "" : parsed.detail).toContain("commandCount must be a finite number");
		expect(parsed.ok ? "" : parsed.detail).toContain("commands must be a string array");
	});

	it("loads the Tau projection endpoint through the API helper", async () => {
		const calls: string[] = [];
		const fetcher = async (url: RequestInfo | URL) => {
			calls.push(String(url));
			return new Response(JSON.stringify(VALID_RESPONSE), { status: 200 });
		};

		const parsed = await loadTauCommandLoopGithubProjection(fetcher as typeof fetch);

		expect(calls).toEqual(["/api/tau/command-loop/github-projection"]);
		expect(parsed).toMatchObject({
			ok: true,
			receipt: {
				summaryPath: "/tmp/tau-command-loop-explicit-ticket-source-proof/summary.json",
				commandCount: 2,
			},
		});
	});

	it("fails closed when the endpoint returns invalid JSON", async () => {
		const fetcher = async () => new Response("not-json", { status: 200 });

		const parsed = await loadTauCommandLoopGithubProjection(fetcher as typeof fetch);

		expect(parsed).toEqual({
			ok: false,
			error: "invalid_json",
			detail: "not-json",
		});
	});

	it("fails closed when HTTP status contradicts a valid-looking receipt", async () => {
		const fetcher = async () => new Response(JSON.stringify(VALID_RESPONSE), { status: 503 });

		const parsed = await loadTauCommandLoopGithubProjection(fetcher as typeof fetch);

		expect(parsed).toEqual({
			ok: false,
			error: "http_error",
			detail: "Tau projection endpoint returned 503",
		});
	});
});

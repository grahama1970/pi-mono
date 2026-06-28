#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const proofPath = process.env.TAU_UI_HANDOFF_PROOF;
const tauProjectRoot = process.env.TAU_PROJECT_ROOT ?? "/home/graham/workspace/experiments/tau";
const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const outputRoot = process.env.TAU_UI_HANDOFF_COMMAND_LOOP_PROOF_DIR
	?? `/tmp/tau-ui-handoff-command-loop-proof-${timestamp}`;
const maxSteps = process.env.TAU_UI_HANDOFF_COMMAND_LOOP_MAX_STEPS ?? "1";

function fail(message, extra = {}) {
	return {
		schema: "tau.ui_handoff_command_loop_proof.v1",
		ok: false,
		mocked: false,
		live: false,
		error: message,
		...extra,
	};
}

function isRecord(value) {
	return value && typeof value === "object" && !Array.isArray(value);
}

function requiredString(record, field) {
	const value = record?.[field];
	return typeof value === "string" && value.trim() ? value : null;
}

async function readJson(filePath) {
	const parsed = JSON.parse(await readFile(filePath, "utf8"));
	if (!isRecord(parsed)) throw new Error(`${filePath} root is not a JSON object`);
	return parsed;
}

export function validateBrowserProof(proof) {
	const errors = [];
	if (proof.schema !== "tau.live_memory_chat_browser_proof.v1") {
		errors.push("browser proof schema must be tau.live_memory_chat_browser_proof.v1");
	}
	if (proof.ok !== true) errors.push("browser proof ok must be true");
	if (proof.mocked !== false) errors.push("browser proof must be mocked=false");
	if (proof.live !== true) errors.push("browser proof must be live=true");
	const handoff = isRecord(proof.handoff) ? proof.handoff : null;
	if (!handoff) {
		errors.push("browser proof missing handoff");
		return { errors, handoff: null };
	}
	if (handoff.schema !== "tau.agent_handoff.v1") errors.push("handoff schema must be tau.agent_handoff.v1");
	const nextAgent = isRecord(handoff.next_agent) ? handoff.next_agent : null;
	if (!requiredString(nextAgent, "name")) errors.push("handoff next_agent.name is required");
	if (requiredString(nextAgent, "name") === "human") {
		errors.push("handoff already routes to human; no subagent command-loop execution is needed");
	}
	const goal = isRecord(handoff.goal) ? handoff.goal : null;
	if (!requiredString(goal, "goal_hash")) errors.push("handoff goal.goal_hash is required");
	return { errors, handoff };
}

export function validateCommandLoop(loopReceipt, expected) {
	const errors = [];
	if (loopReceipt.schema !== "tau.agent_handoff_command_loop_receipt.v1") {
		errors.push("command loop receipt schema mismatch");
	}
	if (loopReceipt.ok !== true) errors.push("command loop receipt ok must be true");
	if (loopReceipt.mocked !== false) errors.push("command loop receipt must be mocked=false");
	if (loopReceipt.live !== true) errors.push("command loop receipt must be live=true");
	if (loopReceipt.step_count !== 1) errors.push("command loop must run exactly one step");
	if (loopReceipt.status !== "WAITING") errors.push("command loop status must be WAITING");
	if (loopReceipt.terminal_agent !== "human") errors.push("command loop must stop at human");
	if (loopReceipt.stop_reason !== "next_agent_is_human") {
		errors.push("command loop stop_reason must be next_agent_is_human");
	}
	const dispatches = Array.isArray(loopReceipt.dispatches) ? loopReceipt.dispatches : [];
	const firstDispatch = isRecord(dispatches[0]) ? dispatches[0] : null;
	if (!firstDispatch) {
		errors.push("command loop missing first dispatch");
		return { errors, firstDispatch: null, firstCommand: null };
	}
	if (firstDispatch.selected_agent !== expected.nextAgent) {
		errors.push(`selected_agent must be ${expected.nextAgent}`);
	}
	if (firstDispatch.ok !== true) errors.push("first dispatch ok must be true");
	if (firstDispatch.mocked !== false) errors.push("first dispatch must be mocked=false");
	if (firstDispatch.live !== true) errors.push("first dispatch must be live=true");
	const commandResults = Array.isArray(firstDispatch.command_results)
		? firstDispatch.command_results
		: [];
	const firstCommand = isRecord(commandResults[0]) ? commandResults[0] : null;
	if (!firstCommand) {
		errors.push("first dispatch missing command result");
		return { errors, firstDispatch, firstCommand: null };
	}
	if (firstCommand.exit_code !== 0) errors.push("selected subagent command exit_code must be 0");
	if (firstCommand.timed_out !== false) errors.push("selected subagent command must not time out");
	const responseProjection = isRecord(firstDispatch.response_projection)
		? firstDispatch.response_projection
		: null;
	if (!responseProjection || responseProjection.next_agent !== "human") {
		errors.push("response projection must route next_agent to human");
	}
	return { errors, firstDispatch, firstCommand };
}

export async function main() {
	await mkdir(outputRoot, { recursive: true });
	const summaryPath = path.join(outputRoot, "summary.json");

	if (!proofPath) {
		const summary = fail("TAU_UI_HANDOFF_PROOF is required", { outputRoot, summaryPath });
		await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
		console.error(JSON.stringify(summary, null, 2));
		process.exit(64);
	}

	let browserProof;
	try {
		browserProof = await readJson(proofPath);
	} catch (error) {
		const summary = fail("browser proof unreadable", {
			outputRoot,
			summaryPath,
			proofPath,
			detail: error instanceof Error ? error.message : String(error),
		});
		await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
		console.error(JSON.stringify(summary, null, 2));
		process.exit(1);
	}

	const browserValidation = validateBrowserProof(browserProof);
	if (browserValidation.errors.length || !browserValidation.handoff) {
		const summary = fail("browser proof is not a runnable live handoff proof", {
			outputRoot,
			summaryPath,
			proofPath,
			browserValidation,
		});
		await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
		console.error(JSON.stringify(summary, null, 2));
		process.exit(1);
	}

	const handoff = browserValidation.handoff;
	const goal = isRecord(handoff.goal) ? handoff.goal : {};
	const nextAgent = handoff.next_agent.name;
	const startHandoffPath = path.join(outputRoot, "start-handoff.json");
	const receiptDir = path.join(outputRoot, "command-loop");
	await mkdir(receiptDir, { recursive: true });
	await writeFile(startHandoffPath, `${JSON.stringify(handoff, null, 2)}\n`, "utf8");

	const args = [
		"run",
		"tau",
		"handoff-command-loop",
		"--start",
		startHandoffPath,
		"--receipt-dir",
		receiptDir,
		"--max-steps",
		maxSteps,
		"--agents-root",
		"experiments/goal-locked-subagents/agent-command-specs",
		"--command-spec-root",
		"experiments/goal-locked-subagents/agent-command-specs",
		"--active-goal-hash",
		goal.goal_hash,
	];

	let commandExitCode = 0;
	let stdout = "";
	let stderr = "";
	try {
		const result = await execFileAsync("uv", args, {
			cwd: tauProjectRoot,
			maxBuffer: 1024 * 1024 * 8,
		});
		stdout = result.stdout;
		stderr = result.stderr;
	} catch (error) {
		commandExitCode = typeof error.code === "number" ? error.code : 1;
		stdout = typeof error.stdout === "string" ? error.stdout : "";
		stderr = typeof error.stderr === "string" ? error.stderr : String(error);
	}

	const commandLoopReceiptPath = path.join(receiptDir, "command-loop-receipt.json");
	let commandLoopReceipt = null;
	let commandLoopReadError = null;
	try {
		commandLoopReceipt = await readJson(commandLoopReceiptPath);
	} catch (error) {
		commandLoopReadError = error instanceof Error ? error.message : String(error);
	}

	const commandLoopValidation = commandLoopReceipt
		? validateCommandLoop(commandLoopReceipt, { nextAgent })
		: { errors: ["command loop receipt was not readable"], firstDispatch: null, firstCommand: null };
	const ok = commandExitCode === 0 && commandLoopValidation.errors.length === 0;
	const summary = {
		schema: "tau.ui_handoff_command_loop_proof.v1",
		ok,
		mocked: false,
		live: true,
		outputRoot,
		summaryPath,
		proofPath,
		tauProjectRoot,
		startHandoffPath,
		commandLoopReceiptPath,
		commandExitCode,
		command: ["uv", ...args],
		browserProof: {
			schema: browserProof.schema,
			scenario: browserProof.scenario,
			screenshot: browserProof.screenshot,
			mocked: browserProof.mocked,
			live: browserProof.live,
		},
		startHandoff: {
			schema: handoff.schema,
			previousSubagent: handoff.previous_subagent,
			nextAgent,
			executor: handoff.next_agent.executor ?? null,
			goal: handoff.goal,
			target: handoff.github,
			resultStatus: handoff.result?.status ?? null,
		},
		commandLoop: commandLoopReceipt
			? {
					schema: commandLoopReceipt.schema,
					ok: commandLoopReceipt.ok,
					status: commandLoopReceipt.status,
					mocked: commandLoopReceipt.mocked,
					live: commandLoopReceipt.live,
					stepCount: commandLoopReceipt.step_count,
					selectedAgent: commandLoopValidation.firstDispatch?.selected_agent ?? null,
					terminalAgent: commandLoopReceipt.terminal_agent,
					stopReason: commandLoopReceipt.stop_reason,
					firstCommandExitCode: commandLoopValidation.firstCommand?.exit_code ?? null,
				}
			: null,
		errors: [...browserValidation.errors, ...commandLoopValidation.errors],
		commandLoopReadError,
		stdoutTail: stdout.slice(-4000),
		stderrTail: stderr.slice(-4000),
		claims: {
			proves: [
				"A live Tau browser proof emitted a tau.agent_handoff.v1 routed to a non-human next_agent.",
				"Tau command-loop consumed that browser-extracted handoff through a Tau-owned command-spec overlay.",
				"The selected subagent command exited 0 and emitted a schema-valid handoff routed to human.",
			],
			does_not_prove: [
				"Live GitHub mutation.",
				"Final Sparta Chat readiness.",
				"Unbounded autonomous subagent operation.",
			],
		},
		capturedAt: new Date().toISOString(),
	};
	await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
	console.log(JSON.stringify(summary, null, 2));
	process.exit(ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(async (error) => {
		await mkdir(outputRoot, { recursive: true });
		const summaryPath = path.join(outputRoot, "summary.json");
		const summary = fail("unexpected proof runner error", {
			outputRoot,
			summaryPath,
			detail: error instanceof Error ? error.stack ?? error.message : String(error),
		});
		await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
		console.error(JSON.stringify(summary, null, 2));
		process.exit(1);
	});
}

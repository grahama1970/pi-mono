#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const proofRunner = path.join(scriptDir, "tau-live-memory-chat-proof.mjs");
const scenarios = [
	{ name: "compliance", expected: { mocked: false, live: true, nextAgent: "reviewer" } },
	{ name: "compliance-invalid-recall", expected: { mocked: true, live: false, handoffAbsent: true } },
	{ name: "deflect", expected: { mocked: false, live: true, nextAgent: "human" } },
	{ name: "answer", expected: { mocked: false, live: true, nextAgent: "reviewer" } },
	{ name: "research", expected: { mocked: false, live: true, nextAgent: "research-auditor" } },
	{ name: "clarify", expected: { mocked: true, live: false, nextAgent: "human" } },
	{ name: "clarify-invalid-product", expected: { mocked: true, live: false, handoffAbsent: true } },
	{ name: "deflect-invalid-product", expected: { mocked: true, live: false, handoffAbsent: true } },
	{ name: "answer-invalid-product", expected: { mocked: true, live: false, handoffAbsent: true } },
	{ name: "clarify-availability", expected: { mocked: false, live: true, clarifyAvailable: false } },
	{ name: "intent-unavailable", expected: { mocked: true, live: false, handoffAbsent: true } },
];

const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const outputRoot =
	process.env.TAU_CHAT_SUITE_PROOF_DIR ?? `/tmp/tau-memory-chat-proof-suite-${timestamp}`;

function scenarioProofDir(name) {
	return path.join(outputRoot, name);
}

async function runScenario(scenario) {
	const proofDir = scenarioProofDir(scenario.name);
	await mkdir(proofDir, { recursive: true });
	const startedAt = new Date().toISOString();
	let exitCode = 0;
	let stdout = "";
	let stderr = "";
	try {
		const result = await execFileAsync(process.execPath, [proofRunner], {
			env: {
				...process.env,
				TAU_CHAT_SCENARIO: scenario.name,
				TAU_CHAT_PROOF_DIR: proofDir,
			},
			maxBuffer: 1024 * 1024 * 8,
		});
		stdout = result.stdout;
		stderr = result.stderr;
	} catch (error) {
		exitCode = typeof error.code === "number" ? error.code : 1;
		stdout = typeof error.stdout === "string" ? error.stdout : "";
		stderr = typeof error.stderr === "string" ? error.stderr : String(error);
	}
	const proofPath = path.join(proofDir, "proof.json");
	let proof = null;
	let readError = null;
	try {
		proof = JSON.parse(await readFile(proofPath, "utf8"));
	} catch (error) {
		readError = error instanceof Error ? error.message : String(error);
	}
	const assertions = validateScenarioProof(proof, scenario.expected);
	const ok = exitCode === 0 && Boolean(proof?.ok) && Object.values(assertions).every(Boolean);
	return {
		name: scenario.name,
		ok,
		exitCode,
		startedAt,
		finishedAt: new Date().toISOString(),
		proofPath,
		proofReadError: readError,
		mocked: proof?.mocked ?? null,
		live: proof?.live ?? null,
		handoffNextAgent: proof?.handoff?.next_agent?.name ?? null,
		handoffStatus: proof?.handoff?.result?.status ?? null,
		clarifyAvailable: proof?.clarifyAvailable ?? null,
		screenshot: proof?.screenshot ?? null,
		assertions,
		stdoutTail: tail(stdout),
		stderrTail: tail(stderr),
	};
}

function validateScenarioProof(proof, expected) {
	if (!proof || typeof proof !== "object") {
		return {
			proof_loaded: false,
		};
	}
	const assertions = {
		proof_loaded: true,
		proof_ok: proof.ok === true,
		mocked_matches: proof.mocked === expected.mocked,
		live_matches: proof.live === expected.live,
	};
	if (expected.nextAgent) {
		assertions.next_agent_matches = proof.handoff?.next_agent?.name === expected.nextAgent;
		assertions.handoff_schema_valid = proof.handoff?.schema === "tau.agent_handoff.v1";
	}
	if (expected.handoffAbsent) {
		assertions.handoff_absent = proof.handoff === null;
		assertions.handoff_absence_reason_recorded = proof.handoffExtractionError === "handoff marker not found";
	}
	if (typeof expected.clarifyAvailable === "boolean") {
		assertions.clarify_available_matches = proof.clarifyAvailable === expected.clarifyAvailable;
	}
	return assertions;
}

function tail(text) {
	if (!text) return "";
	const lines = text.trim().split("\n");
	return lines.slice(Math.max(0, lines.length - 20)).join("\n");
}

async function main() {
	await mkdir(outputRoot, { recursive: true });
	const results = [];
	for (const scenario of scenarios) {
		results.push(await runScenario(scenario));
	}
	const summary = {
		schema: "tau.memory_chat_proof_suite.v1",
		ok: results.every((result) => result.ok),
		mocked: results.some((result) => result.mocked === true),
		live: results.some((result) => result.live === true),
		outputRoot,
		scenarioCount: results.length,
		liveScenarioCount: results.filter((result) => result.live === true).length,
		mockedScenarioCount: results.filter((result) => result.mocked === true).length,
		results,
		capturedAt: new Date().toISOString(),
		claims: {
			proves: [
				"Tau chat browser route proofs can be run as one auditable suite.",
				"Successful route proofs extract or check tau.agent_handoff.v1 JSON according to each route boundary.",
				"Mocked route proofs are labeled mocked=true/live=false and do not upgrade live Memory confidence.",
			],
			does_not_prove: [
				"Final Sparta Chat readiness.",
				"Live CLARIFY emission from Memory intent.",
				"Live GitHub mutation or subagent execution from the browser chat.",
			],
		},
	};
	const summaryPath = path.join(outputRoot, "summary.json");
	await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
	console.log(JSON.stringify({ summaryPath, ...summary }, null, 2));
	process.exit(summary.ok ? 0 : 1);
}

void main();

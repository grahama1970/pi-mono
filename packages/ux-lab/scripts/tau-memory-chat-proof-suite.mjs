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
	{ name: "intent-unsupported-action", expected: { mocked: true, live: false, handoffAbsent: true } },
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
	const persistedExpectation = await readPersistedExpectation(proof?.subagentReceiptExpectation?.artifactPath);
	if (scenario.expected.nextAgent) {
		assertions.subagent_receipt_expectation_artifact_readable = persistedExpectation.ok;
		assertions.subagent_receipt_expectation_artifact_schema =
			persistedExpectation.json?.schema === "tau.subagent_receipt_expectation.v1";
		assertions.subagent_receipt_expectation_artifact_next_agent =
			persistedExpectation.json?.nextAgent === scenario.expected.nextAgent;
	}
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
		githubProjectionLabels: proof?.githubProjection?.labels ?? null,
		githubTransportCommandCount: proof?.githubTransportReceipt?.commandCount ?? null,
		githubTransportValidationRenderedSchema: proof?.githubTransportValidationRendered?.schema ?? null,
		githubTransportValidationSchema: proof?.githubTransportValidation?.body?.receipt?.schema ?? null,
		handoffOrchestratorIntakeSchema: proof?.handoffOrchestratorIntake?.schema ?? null,
		handoffOrchestratorIntakeAccepted: proof?.handoffOrchestratorIntake?.accepted ?? null,
		subagentReceiptExpectationSchema: proof?.subagentReceiptExpectation?.schema ?? null,
		subagentReceiptExpectationNextAgent: proof?.subagentReceiptExpectation?.nextAgent ?? null,
		subagentReceiptExpectationArtifactPath: proof?.subagentReceiptExpectation?.artifactPath ?? null,
		subagentReceiptExpectationArtifactReadable: persistedExpectation.ok,
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
		assertions.github_projection_target_present = Boolean(
			proof.githubProjection?.target?.repo && proof.githubProjection?.target?.target,
		);
		assertions.github_projection_next_label_matches =
			proof.githubProjection?.labels?.add?.includes(`next:${expected.nextAgent}`) === true;
		assertions.github_projection_agent_work_label =
			proof.githubProjection?.labels?.add?.includes("agent-work") === true;
		assertions.github_projection_executor_label_present =
			Array.isArray(proof.githubProjection?.labels?.add)
			&& proof.githubProjection.labels.add.some((label) => /^executor:/.test(label));
		assertions.github_projection_stale_labels_removed =
			proof.githubProjection?.labels?.remove?.includes("agent-active") === true
			&& proof.githubProjection?.labels?.remove?.includes("agent-blocked") === true;
		assertions.github_transport_receipt_ok = proof.githubTransportReceipt?.ok === true;
		assertions.github_transport_receipt_dry_run =
			proof.githubTransportReceipt?.dryRun === true && proof.githubTransportReceipt?.applied === false;
		assertions.github_transport_command_count_matches =
			Array.isArray(proof.githubTransportReceipt?.commands)
			&& proof.githubTransportReceipt.commands.length === proof.githubTransportReceipt.commandCount
			&& proof.githubTransportReceipt.commandCount > 0;
		assertions.github_transport_validation_rendered_schema =
			proof.githubTransportValidationRendered?.schema === "tau.handoff_github_transport_validation.v1";
		assertions.github_transport_validation_rendered_dry_run =
			proof.githubTransportValidationRendered?.dryRun === true
			&& proof.githubTransportValidationRendered?.applied === false;
		assertions.handoff_orchestrator_intake_schema =
			proof.handoffOrchestratorIntake?.schema === "tau.handoff_orchestrator_intake.v1";
		assertions.handoff_orchestrator_intake_accepted = proof.handoffOrchestratorIntake?.accepted === true;
		assertions.handoff_orchestrator_intake_next_agent_matches =
			proof.handoffOrchestratorIntake?.nextAgent === expected.nextAgent;
		assertions.handoff_orchestrator_intake_dry_run =
			proof.handoffOrchestratorIntake?.dryRun === true && proof.handoffOrchestratorIntake?.applied === false;
		assertions.subagent_receipt_expectation_schema =
			proof.subagentReceiptExpectation?.schema === "tau.subagent_receipt_expectation.v1";
		assertions.subagent_receipt_expectation_next_agent_matches =
			proof.subagentReceiptExpectation?.nextAgent === expected.nextAgent;
		assertions.subagent_receipt_expectation_required_handoff_schema =
			proof.subagentReceiptExpectation?.requiredReceipt?.schema === "tau.agent_handoff.v1";
		assertions.subagent_receipt_expectation_requires_next_agent =
			proof.subagentReceiptExpectation?.requiredReceipt?.next_agent_required === true;
		assertions.subagent_receipt_expectation_dry_run =
			proof.subagentReceiptExpectation?.dryRun === true && proof.subagentReceiptExpectation?.applied === false;
		assertions.subagent_receipt_expectation_persisted =
			proof.subagentReceiptExpectation?.persisted === true;
		assertions.subagent_receipt_expectation_artifact_path_present =
			typeof proof.subagentReceiptExpectation?.artifactPath === "string"
			&& proof.subagentReceiptExpectation.artifactPath.includes("/tau-subagent-receipt-expectations/");
		assertions.github_transport_server_validation_ok = proof.githubTransportValidation?.ok === true;
		assertions.github_transport_server_validation_schema =
			proof.githubTransportValidation?.body?.receipt?.schema === "tau.handoff_github_transport_validation.v1";
		assertions.github_transport_server_validation_dry_run =
			proof.githubTransportValidation?.body?.receipt?.dryRun === true
			&& proof.githubTransportValidation?.body?.receipt?.applied === false;
	}
	if (expected.handoffAbsent) {
		assertions.handoff_absent = proof.handoff === null;
		assertions.handoff_absence_reason_recorded = proof.handoffExtractionError === "handoff JSON object not found";
	}
	if (typeof expected.clarifyAvailable === "boolean") {
		assertions.clarify_available_matches = proof.clarifyAvailable === expected.clarifyAvailable;
	}
	return assertions;
}

async function readPersistedExpectation(artifactPath) {
	if (typeof artifactPath !== "string" || !artifactPath) {
		return { ok: false, json: null, error: "artifact path missing" };
	}
	try {
		const json = JSON.parse(await readFile(artifactPath, "utf8"));
		return { ok: true, json, error: null };
	} catch (error) {
		return { ok: false, json: null, error: error instanceof Error ? error.message : String(error) };
	}
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
				"Successful handoff route proofs POST the rendered dry-run GitHub transport receipt to the Tau server validator.",
				"Successful handoff route proofs extract the rendered tau.handoff_github_transport_validation.v1 JSON.",
				"Successful handoff route proofs extract the rendered tau.handoff_orchestrator_intake.v1 JSON.",
				"Successful handoff route proofs extract the rendered tau.subagent_receipt_expectation.v1 JSON.",
				"Successful handoff route proofs read the persisted tau.subagent_receipt_expectation.v1 artifact from disk.",
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

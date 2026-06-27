#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const url = process.env.TAU_CHAT_URL ?? "http://127.0.0.1:3002/#tau";
const scenarioName = process.env.TAU_CHAT_SCENARIO ?? "compliance";
const scenarios = {
	compliance: {
		prompt: "How does Tau handle a CWE-287 SPARTA evidence case?",
		waitFor: "Tau routed this turn through Memory intent into a compliance evidence path.",
		expectedNextAgent: "reviewer",
		assertions(chatText, memoryRequests) {
			return {
				compliance_lead_visible: chatText.includes(
					"Tau routed this turn through Memory intent into a compliance evidence path.",
				),
				memory_action_visible: /action\s+COMPLIANCE/.test(chatText),
				recall_product_visible: /endpoint\s+\/recall/.test(chatText),
				handoff_section_visible: chatText.includes("Tau handoff JSON contract"),
				handoff_schema_visible: chatText.includes("schema") && chatText.includes("tau.agent_handoff.v1"),
				reviewer_next_agent_visible:
					/next agent\s+reviewer/.test(chatText) || chatText.includes('"name": "reviewer"'),
				github_projection_visible: chatText.includes("Tau command-loop GitHub projection receipt"),
				intent_request_seen: memoryRequests.some(
					(request) => request.url.includes("/api/memory/intent") && request.status >= 200 && request.status < 300,
				),
				recall_request_seen: memoryRequests.some(
					(request) => request.url.includes("/api/memory/recall") && request.status >= 200 && request.status < 300,
				),
			};
		},
	},
	"compliance-invalid-recall": {
		prompt: "How does Tau handle a CWE-287 SPARTA evidence case?",
		waitFor: "Tau stopped fail-closed while running /recall.",
		waitForHandoff: false,
		mockedMemory: true,
		mockResponses: {
			"/api/memory/intent": {
				action: "COMPLIANCE",
				confidence: 0.94,
				response_mode: "evidence_case",
				content_type: "evidence",
				entities: ["CWE-287"],
				frameworks: ["CWE"],
				recall_profile: "exact_control_lookup",
				k: 12,
			},
			"/api/memory/recall": {
				found: true,
				confidence: 8.2,
				results: [{ _key: "ctrl__CWE-287" }],
			},
		},
		assertions(chatText, memoryRequests) {
			return {
				fail_closed_lead_visible: chatText.includes("Tau stopped fail-closed while running /recall."),
				invalid_recall_reason_visible: chatText.includes("Memory /recall missing items array"),
				no_handoff_section_visible: !chatText.includes("Tau handoff JSON contract"),
				no_reviewer_next_agent_visible: !/next agent\s+reviewer/.test(chatText) && !chatText.includes('"name": "reviewer"'),
				intent_request_seen: memoryRequests.some(
					(request) => request.url.includes("/api/memory/intent") && request.status >= 200 && request.status < 300,
				),
				recall_request_seen: memoryRequests.some(
					(request) => request.url.includes("/api/memory/recall") && request.status >= 200 && request.status < 300,
				),
				answer_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/answer")),
				deflect_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/deflect")),
			};
		},
	},
	deflect: {
		prompt: "what is the weather?",
		waitFor: "Tau routed this turn to Memory deflect.",
		expectedNextAgent: "human",
		assertions(chatText, memoryRequests) {
			return {
				deflect_lead_visible: chatText.includes("Tau routed this turn to Memory deflect."),
				memory_action_visible: /action\s+NO_MATCH/.test(chatText),
				deflect_product_visible: /endpoint\s+\/deflect/.test(chatText),
				should_deflect_visible: /should deflect\s+true/.test(chatText),
				handoff_section_visible: chatText.includes("Tau handoff JSON contract"),
				handoff_schema_visible: chatText.includes("schema") && chatText.includes("tau.agent_handoff.v1"),
				human_next_agent_visible: /next agent\s+human/.test(chatText) || chatText.includes('"name": "human"'),
				intent_request_seen: memoryRequests.some(
					(request) => request.url.includes("/api/memory/intent") && request.status >= 200 && request.status < 300,
				),
				deflect_request_seen: memoryRequests.some(
					(request) => request.url.includes("/api/memory/deflect") && request.status >= 200 && request.status < 300,
				),
				recall_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/recall")),
			};
		},
	},
	"deflect-invalid-product": {
		prompt: "what is the weather?",
		waitFor: "Tau stopped fail-closed while running /deflect.",
		waitForHandoff: false,
		mockedMemory: true,
		mockResponses: {
			"/api/memory/intent": {
				action: "DEFLECT",
				confidence: 0.89,
				response_mode: null,
				content_type: "deflection",
				entities: [],
				frameworks: [],
				recall_profile: null,
			},
			"/api/memory/deflect": {
				schema: "memory.deflect.v1",
				should_deflect: false,
				deflection_type: "none",
			},
		},
		assertions(chatText, memoryRequests) {
			return {
				fail_closed_lead_visible: chatText.includes("Tau stopped fail-closed while running /deflect."),
				invalid_deflect_reason_visible: chatText.includes("Memory /deflect did not confirm deflection"),
				no_handoff_section_visible: !chatText.includes("Tau handoff JSON contract"),
				no_human_next_agent_visible: !/next agent\s+human/.test(chatText) && !chatText.includes('"name": "human"'),
				intent_request_seen: memoryRequests.some(
					(request) => request.url.includes("/api/memory/intent") && request.status >= 200 && request.status < 300,
				),
				deflect_request_seen: memoryRequests.some(
					(request) => request.url.includes("/api/memory/deflect") && request.status >= 200 && request.status < 300,
				),
				recall_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/recall")),
				answer_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/answer")),
			};
		},
	},
	clarify: {
		prompt: "How do I secure it?",
		waitFor: "Tau routed this turn to Memory clarify.",
		expectedNextAgent: "human",
		mockedMemory: true,
		mockResponses: {
			"/api/memory/intent": {
				action: "CLARIFY",
				confidence: 0.58,
				response_mode: "clarify",
				content_type: "clarification",
				entities: [],
				frameworks: [],
				recall_profile: null,
			},
			"/api/memory/clarify": {
				schema: "memory.clarify.v1",
				needs_clarification: true,
				questions: ["Which system, asset, or evidence case should Tau secure?"],
			},
		},
		assertions(chatText, memoryRequests) {
			return {
				clarify_lead_visible: chatText.includes("Tau routed this turn to Memory clarify."),
				memory_action_visible: /action\s+CLARIFY/.test(chatText),
				clarify_product_visible: /endpoint\s+\/clarify/.test(chatText),
				clarify_question_visible: chatText.includes("Which system, asset, or evidence case should Tau secure?"),
				handoff_section_visible: chatText.includes("Tau handoff JSON contract"),
				handoff_schema_visible: chatText.includes("schema") && chatText.includes("tau.agent_handoff.v1"),
				human_next_agent_visible: /next agent\s+human/.test(chatText) || chatText.includes('"name": "human"'),
				intent_request_seen: memoryRequests.some(
					(request) => request.url.includes("/api/memory/intent") && request.status >= 200 && request.status < 300,
				),
				clarify_request_seen: memoryRequests.some(
					(request) => request.url.includes("/api/memory/clarify") && request.status >= 200 && request.status < 300,
				),
				recall_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/recall")),
				answer_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/answer")),
				deflect_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/deflect")),
			};
		},
	},
	"clarify-invalid-product": {
		prompt: "How do I secure it?",
		waitFor: "Tau stopped fail-closed while running /clarify.",
		waitForHandoff: false,
		mockedMemory: true,
		mockResponses: {
			"/api/memory/intent": {
				action: "CLARIFY",
				confidence: 0.58,
				response_mode: "clarify",
				content_type: "clarification",
				entities: [],
				frameworks: [],
				recall_profile: null,
			},
			"/api/memory/clarify": {
				schema: "memory.clarify.v1",
				needs_clarification: true,
				questions: [],
			},
		},
		assertions(chatText, memoryRequests) {
			return {
				fail_closed_lead_visible: chatText.includes("Tau stopped fail-closed while running /clarify."),
				invalid_clarify_reason_visible: chatText.includes("Memory /clarify requested clarification without questions"),
				no_handoff_section_visible: !chatText.includes("Tau handoff JSON contract"),
				no_human_next_agent_visible: !/next agent\s+human/.test(chatText) && !chatText.includes('"name": "human"'),
				intent_request_seen: memoryRequests.some(
					(request) => request.url.includes("/api/memory/intent") && request.status >= 200 && request.status < 300,
				),
				clarify_request_seen: memoryRequests.some(
					(request) => request.url.includes("/api/memory/clarify") && request.status >= 200 && request.status < 300,
				),
				recall_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/recall")),
				answer_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/answer")),
				deflect_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/deflect")),
			};
		},
	},
	answer: {
		prompt: "What is the current project status?",
		waitFor: "Tau routed this turn to Memory answer.",
		expectedNextAgent: "reviewer",
		assertions(chatText, memoryRequests) {
			return {
				answer_lead_visible: chatText.includes("Tau routed this turn to Memory answer."),
				memory_action_visible: /action\s+QUERY/.test(chatText),
				response_mode_visible: /response mode\s+memory_grounded_answer/.test(chatText),
				answer_product_visible: /endpoint\s+\/answer/.test(chatText),
				can_answer_visible: /can answer\s+true/.test(chatText),
				handoff_section_visible: chatText.includes("Tau handoff JSON contract"),
				handoff_schema_visible: chatText.includes("schema") && chatText.includes("tau.agent_handoff.v1"),
				reviewer_next_agent_visible:
					/next agent\s+reviewer/.test(chatText) || chatText.includes('"name": "reviewer"'),
				intent_request_seen: memoryRequests.some(
					(request) => request.url.includes("/api/memory/intent") && request.status >= 200 && request.status < 300,
				),
				answer_request_seen: memoryRequests.some(
					(request) => request.url.includes("/api/memory/answer") && request.status >= 200 && request.status < 300,
				),
				recall_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/recall")),
			};
		},
	},
	"answer-invalid-product": {
		prompt: "What is the current project status?",
		waitFor: "Tau stopped fail-closed while running /answer.",
		waitForHandoff: false,
		mockedMemory: true,
		mockResponses: {
			"/api/memory/intent": {
				action: "ANSWER",
				confidence: 0.91,
				response_mode: "memory_grounded_answer",
				content_type: "markdown",
				entities: ["Tau"],
				frameworks: [],
				recall_profile: "procedural_memory",
			},
			"/api/memory/answer": {
				schema: "memory.answer.v1",
				can_answer: false,
				answer_type: "insufficient_memory_evidence",
			},
		},
		assertions(chatText, memoryRequests) {
			return {
				fail_closed_lead_visible: chatText.includes("Tau stopped fail-closed while running /answer."),
				invalid_answer_reason_visible: chatText.includes("Memory /answer did not confirm can_answer=true"),
				no_handoff_section_visible: !chatText.includes("Tau handoff JSON contract"),
				no_reviewer_next_agent_visible: !/next agent\s+reviewer/.test(chatText) && !chatText.includes('"name": "reviewer"'),
				intent_request_seen: memoryRequests.some(
					(request) => request.url.includes("/api/memory/intent") && request.status >= 200 && request.status < 300,
				),
				answer_request_seen: memoryRequests.some(
					(request) => request.url.includes("/api/memory/answer") && request.status >= 200 && request.status < 300,
				),
			};
		},
	},
	research: {
		prompt: "search the web for latest Chutes pricing",
		waitFor: "Tau identified a research route and stopped before unsupported web claims.",
		expectedNextAgent: "research-auditor",
		assertions(chatText, memoryRequests) {
			return {
				research_lead_visible: chatText.includes(
					"Tau identified a research route and stopped before unsupported web claims.",
				),
				memory_action_visible: /action\s+RESEARCH/.test(chatText),
				research_product_not_called_visible: chatText.includes("Memory product: not called in this slice."),
				handoff_section_visible: chatText.includes("Tau handoff JSON contract"),
				handoff_schema_visible: chatText.includes("schema") && chatText.includes("tau.agent_handoff.v1"),
				research_next_agent_visible:
					/next agent\s+research-auditor/.test(chatText) || chatText.includes('"name": "research-auditor"'),
				intent_request_seen: memoryRequests.some(
					(request) => request.url.includes("/api/memory/intent") && request.status >= 200 && request.status < 300,
				),
				recall_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/recall")),
				answer_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/answer")),
				deflect_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/deflect")),
			};
		},
	},
	"clarify-availability": {
		prompt: "CLARIFY availability probe",
		candidatePrompts: [
			"How do I secure it?",
			"Assess compliance for this system",
			"What control applies?",
			"Can you explain this?",
			"Which one should I use?",
			"What is the relationship?",
			"Use that evidence case",
			"Is it compliant?",
		],
	},
};
const scenario = scenarios[scenarioName];
if (!scenario) {
	console.error(`Unknown TAU_CHAT_SCENARIO ${scenarioName}. Expected one of: ${Object.keys(scenarios).join(", ")}`);
	process.exit(2);
}
const prompt = process.env.TAU_CHAT_PROMPT ?? scenario.prompt;
const outDir =
	process.env.TAU_CHAT_PROOF_DIR ??
	`/tmp/tau-live-memory-chat-proof-${scenarioName}-${new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z")}`;

function compact(text) {
	return text.replace(/\s+/g, " ");
}

function extractTauHandoff(rawText) {
	const marker = "Tau handoff JSON contract";
	const markerIndex = rawText.indexOf(marker);
	if (markerIndex < 0) {
		return { ok: false, error: "handoff marker not found", json: null };
	}
	const handoffText = rawText
		.slice(markerIndex)
		.split("\n")
		.filter((line) => !/^\d+$/.test(line.trim()))
		.join("\n");
	const start = handoffText.indexOf("{");
	if (start < 0) {
		return { ok: false, error: "handoff JSON start not found", json: null };
	}
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let index = start; index < handoffText.length; index += 1) {
		const char = handoffText[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (char === "\\") {
			escaped = true;
			continue;
		}
		if (char === '"') {
			inString = !inString;
			continue;
		}
		if (inString) continue;
		if (char === "{") depth += 1;
		if (char === "}") {
			depth -= 1;
			if (depth === 0) {
				const source = handoffText.slice(start, index + 1);
				try {
					return { ok: true, error: null, json: JSON.parse(source) };
				} catch (error) {
					return {
						ok: false,
						error: error instanceof Error ? error.message : String(error),
						json: null,
					};
				}
			}
		}
	}
	return { ok: false, error: "handoff JSON end not found", json: null };
}

function handoffProofAssertions(handoffExtraction, expectedNextAgent) {
	const handoff = handoffExtraction.json;
	return {
		handoff_json_extracted: handoffExtraction.ok,
		handoff_schema_valid: handoff?.schema === "tau.agent_handoff.v1",
		handoff_goal_present: Boolean(handoff?.goal?.goal_id && handoff?.goal?.goal_hash),
		handoff_context_present: Boolean(handoff?.context?.summary && Array.isArray(handoff?.context?.artifacts)),
		handoff_result_present: Boolean(handoff?.result?.status && handoff?.result?.summary && Array.isArray(handoff?.result?.evidence)),
		handoff_next_agent_matches: expectedNextAgent ? handoff?.next_agent?.name === expectedNextAgent : Boolean(handoff?.next_agent?.name),
		handoff_stop_condition_present: typeof handoff?.stop_condition === "string" && handoff.stop_condition.length > 0,
	};
}

function failClosedHandoffAbsenceAssertions(handoffExtraction) {
	return {
		handoff_json_absent: !handoffExtraction.ok,
		handoff_absence_reason_recorded: handoffExtraction.error === "handoff marker not found",
	};
}

async function main() {
	await mkdir(outDir, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 1,
	});
	const errors = [];
	const memoryRequests = [];

	page.on("pageerror", (error) => errors.push(`pageerror:${error.message}`));
	page.on("console", (message) => {
		if (["error", "warning"].includes(message.type())) {
			errors.push(`console:${message.type()}:${message.text()}`);
		}
	});
	page.on("response", (response) => {
		const responseUrl = response.url();
		if (responseUrl.includes("/api/memory/")) {
			memoryRequests.push({
				method: response.request().method(),
				url: responseUrl,
				status: response.status(),
			});
		}
	});
	if (scenario.mockResponses) {
		for (const [endpoint, responseBody] of Object.entries(scenario.mockResponses)) {
			await page.route(`**${endpoint}`, async (route) => {
				await route.fulfill({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify(responseBody),
				});
			});
		}
	}

	try {
		await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
		if (scenario.candidatePrompts) {
			const intentResults = await page.evaluate(async (prompts) => {
				const results = [];
				for (const q of prompts) {
					const response = await fetch("/api/memory/intent", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ q, scope: "tau", session_id: "tau-chat", fast: true }),
					});
					let body = null;
					try {
						body = await response.json();
					} catch {
						body = { parse_error: true };
					}
					results.push({
						q,
						status: response.status,
						action: body?.action ?? null,
						confidence: body?.confidence ?? null,
						response_mode: body?.response_mode ?? null,
						content_type: body?.content_type ?? null,
						recall_profile: body?.recall_profile ?? null,
					});
				}
				return results;
			}, scenario.candidatePrompts);
			const visibleAssertions = {
				intent_probe_count: intentResults.length === scenario.candidatePrompts.length,
				intent_requests_all_200: intentResults.every((result) => result.status >= 200 && result.status < 300),
				clarify_not_emitted: intentResults.every((result) => result.action !== "CLARIFY"),
				observed_non_clarify_actions: intentResults.some((result) => result.action && result.action !== "CLARIFY"),
			};
			const ok = Object.values(visibleAssertions).every(Boolean);
			const screenshot = path.join(outDir, "tau-live-memory-chat.png");
			await page.screenshot({ path: screenshot, fullPage: true });
			const proof = {
				schema: "tau.live_memory_chat_browser_proof.v1",
				ok,
				mocked: false,
				live: true,
				scenario: scenarioName,
				url,
				prompt,
				clarifyAvailable: intentResults.some((result) => result.action === "CLARIFY"),
				candidatePrompts: scenario.candidatePrompts,
				intentResults,
				visibleAssertions,
				memoryRequests,
				errors,
				screenshot,
				capturedAt: new Date().toISOString(),
			};
			await writeFile(path.join(outDir, "proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
			console.log(JSON.stringify({ artifactRoot: outDir, ...proof }, null, 2));
			await browser.close();
			process.exit(ok ? 0 : 1);
		}

		await page.locator('[data-qid="tau:chat:shell:well:input"]').fill(prompt);
		await page.locator('[data-qid="tau:chat:shell:well:send"]').click();
		await page.waitForFunction(
			(expected) => document.body.innerText.includes(expected),
			scenario.waitFor,
			{ timeout: 30_000 },
		);
		if (scenario.waitForHandoff !== false) {
			await page.waitForFunction(
				() => document.body.innerText.includes("Tau handoff JSON contract"),
				null,
				{ timeout: 30_000 },
			);
		}

		const rawChatText = await page.locator('[data-qid="tau:chat:shell:well"]').innerText();
		const chatText = compact(rawChatText);
		const handoffExtraction = extractTauHandoff(rawChatText);
		const handoffAssertions =
			scenario.waitForHandoff === false
				? failClosedHandoffAbsenceAssertions(handoffExtraction)
				: handoffProofAssertions(handoffExtraction, scenario.expectedNextAgent);
		const visibleAssertions = {
			prompt_visible: chatText.includes(prompt),
			...scenario.assertions(chatText, memoryRequests),
			...handoffAssertions,
		};
		const ok = Object.values(visibleAssertions).every(Boolean);
		const screenshot = path.join(outDir, "tau-live-memory-chat.png");
		await page.screenshot({ path: screenshot, fullPage: true });
		const proof = {
			schema: "tau.live_memory_chat_browser_proof.v1",
			ok,
			mocked: Boolean(scenario.mockedMemory),
			live: !scenario.mockedMemory,
			scenario: scenarioName,
			url,
			prompt,
			visibleAssertions,
			handoff: handoffExtraction.ok ? handoffExtraction.json : null,
			handoffExtractionError: handoffExtraction.error,
			memoryRequests,
			errors,
			screenshot,
			capturedAt: new Date().toISOString(),
		};
		await writeFile(path.join(outDir, "proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
		console.log(JSON.stringify({ artifactRoot: outDir, ...proof }, null, 2));
		await browser.close();
		process.exit(ok ? 0 : 1);
	} catch (error) {
		errors.push(error instanceof Error ? error.stack || error.message : String(error));
		const screenshot = path.join(outDir, "tau-live-memory-chat-failed.png");
		await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
		const proof = {
			schema: "tau.live_memory_chat_browser_proof.v1",
			ok: false,
			mocked: false,
			live: true,
			scenario: scenarioName,
			url,
			prompt,
			visibleAssertions: {},
			memoryRequests,
			errors,
			screenshot,
			capturedAt: new Date().toISOString(),
		};
		await writeFile(path.join(outDir, "proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
		console.error(JSON.stringify({ artifactRoot: outDir, ...proof }, null, 2));
		await browser.close();
		process.exit(1);
	}
}

void main();

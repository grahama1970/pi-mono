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
				handoff_github_projection_json_visible: chatText.includes("Tau handoff GitHub projection JSON contract"),
				handoff_github_transport_receipt_visible: chatText.includes("Tau handoff GitHub transport receipt JSON contract"),
				handoff_schema_visible: chatText.includes("schema") && chatText.includes("tau.agent_handoff.v1"),
				reviewer_next_agent_visible:
					/next agent\s+reviewer/.test(chatText) || chatText.includes('"name": "reviewer"'),
				command_loop_github_projection_visible: chatText.includes("Tau command-loop GitHub projection receipt"),
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
				handoff_github_projection_json_visible: chatText.includes("Tau handoff GitHub projection JSON contract"),
				handoff_github_transport_receipt_visible: chatText.includes("Tau handoff GitHub transport receipt JSON contract"),
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
				handoff_github_projection_json_visible: chatText.includes("Tau handoff GitHub projection JSON contract"),
				handoff_github_transport_receipt_visible: chatText.includes("Tau handoff GitHub transport receipt JSON contract"),
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
				handoff_github_projection_json_visible: chatText.includes("Tau handoff GitHub projection JSON contract"),
				handoff_github_transport_receipt_visible: chatText.includes("Tau handoff GitHub transport receipt JSON contract"),
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
				handoff_github_projection_json_visible: chatText.includes("Tau handoff GitHub projection JSON contract"),
				handoff_github_transport_receipt_visible: chatText.includes("Tau handoff GitHub transport receipt JSON contract"),
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
	"intent-unavailable": {
		prompt: "How does Tau handle a CWE-287 SPARTA evidence case?",
		waitFor: "Tau could not start the Memory-backed turn because Memory /intent was unavailable.",
		waitForHandoff: false,
		mockedMemory: true,
		mockResponses: {
			"/api/memory/intent": {
				__status: 503,
				body: {
					error: "intent unavailable in proof fixture",
				},
			},
		},
		assertions(chatText, memoryRequests) {
			return {
				fail_closed_intent_visible: chatText.includes(
					"Tau could not start the Memory-backed turn because Memory /intent was unavailable.",
				),
				no_memory_route_visible: !chatText.includes("Tau routed this turn"),
				no_handoff_section_visible: !chatText.includes("Tau handoff JSON contract"),
				no_next_agent_visible: !/next agent\s+/.test(chatText),
				intent_request_failed_seen: memoryRequests.some(
					(request) => request.url.includes("/api/memory/intent") && request.status === 503,
				),
				recall_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/recall")),
				answer_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/answer")),
				clarify_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/clarify")),
				deflect_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/deflect")),
			};
		},
	},
	"intent-unsupported-action": {
		prompt: "What should Tau do with this unknown Memory route?",
		waitFor: "Tau stopped fail-closed because Memory /intent returned an unsupported route.",
		waitForHandoff: false,
		mockedMemory: true,
		mockResponses: {
			"/api/memory/intent": {
				action: "BANANA",
				confidence: 0.88,
				response_mode: null,
				content_type: null,
				entities: ["Tau"],
				frameworks: [],
				recall_profile: null,
			},
		},
		assertions(chatText, memoryRequests) {
			return {
				fail_closed_unsupported_intent_visible: chatText.includes(
					"Tau stopped fail-closed because Memory /intent returned an unsupported route.",
				),
				unsupported_action_visible: chatText.includes("Intent action: BANANA"),
				unsupported_reason_visible: chatText.includes("Memory /intent action BANANA is not a supported Tau route"),
				route_endpoint_not_called_visible: chatText.includes("Memory route endpoint") && chatText.includes("not called"),
				no_handoff_section_visible: !chatText.includes("Tau handoff JSON contract"),
				no_next_agent_visible: !/next agent\s+/.test(chatText),
				intent_request_seen: memoryRequests.some(
					(request) => request.url.includes("/api/memory/intent") && request.status >= 200 && request.status < 300,
				),
				recall_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/recall")),
				answer_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/answer")),
				clarify_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/clarify")),
				deflect_request_absent: !memoryRequests.some((request) => request.url.includes("/api/memory/deflect")),
			};
		},
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

function renderedJsonObjects(rawText) {
	const text = rawText
		.split("\n")
		.filter((line) => !/^\d+$/.test(line.trim()))
		.join("\n");
	const objects = [];
	for (let start = text.indexOf("{"); start >= 0; start = text.indexOf("{", start + 1)) {
		let depth = 0;
		let inString = false;
		let escaped = false;
		for (let index = start; index < text.length; index += 1) {
			const char = text[index];
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
					const source = text.slice(start, index + 1);
					try {
						objects.push(JSON.parse(source));
					} catch {
						// Not a standalone JSON object rendered by the chat.
					}
					break;
				}
			}
		}
	}
	return objects;
}

function extractTauHandoff(rawText) {
	const handoff = renderedJsonObjects(rawText).find(
		(item) =>
			item?.schema === "tau.agent_handoff.v1"
			&& item?.previous_subagent === "webgpt-ticket-author"
			&& item?.next_agent
			&& typeof item.next_agent.name === "string",
	);
	return handoff
		? { ok: true, error: null, json: handoff }
		: { ok: false, error: "handoff JSON object not found", json: null };
}

function extractTauCandidateSubagentHandoff(rawText) {
	const handoff = renderedJsonObjects(rawText).find(
		(item) =>
			item?.schema === "tau.agent_handoff.v1"
			&& typeof item?.previous_subagent === "string"
			&& item.previous_subagent !== "webgpt-ticket-author"
			&& item?.next_agent
			&& typeof item.next_agent.name === "string",
	);
	return handoff
		? { ok: true, error: null, json: handoff }
		: { ok: false, error: "candidate subagent handoff JSON object not found", json: null };
}

function extractTauSubagentHandoffValidation(rawText) {
	const validation = renderedJsonObjects(rawText).find(
		(item) => item?.schema === "tau.subagent_handoff_validation.v1",
	);
	return validation
		? { ok: true, error: null, json: validation }
		: { ok: false, error: "subagent handoff validation JSON object not found", json: null };
}

function extractTauGithubProjection(rawText) {
	const projection = renderedJsonObjects(rawText).find(
		(item) => item?.contract === "tau.handoff_github_projection.rendered.v1",
	);
	return projection
		? { ok: true, error: null, json: projection }
		: { ok: false, error: "github projection JSON object not found", json: null };
}

function extractTauGithubTransportReceipt(rawText) {
	const receipt = renderedJsonObjects(rawText).find(
		(item) => item?.schema === "tau.handoff_github_transport_receipt.v1",
	);
	return receipt
		? { ok: true, error: null, json: receipt }
		: { ok: false, error: "github transport receipt JSON object not found", json: null };
}

function extractTauGithubTransportValidation(rawText) {
	const validation = renderedJsonObjects(rawText).find(
		(item) => item?.schema === "tau.handoff_github_transport_validation.v1",
	);
	return validation
		? { ok: true, error: null, json: validation }
		: { ok: false, error: "github transport validation JSON object not found", json: null };
}

function extractTauHandoffOrchestratorIntake(rawText) {
	const intake = renderedJsonObjects(rawText).find(
		(item) => item?.schema === "tau.handoff_orchestrator_intake.v1",
	);
	return intake
		? { ok: true, error: null, json: intake }
		: { ok: false, error: "handoff orchestrator intake JSON object not found", json: null };
}

function extractTauSubagentReceiptExpectation(rawText) {
	const expectation = renderedJsonObjects(rawText).find(
		(item) => item?.schema === "tau.subagent_receipt_expectation.v1",
	);
	return expectation
		? { ok: true, error: null, json: expectation }
		: { ok: false, error: "subagent receipt expectation JSON object not found", json: null };
}

async function validateTauGithubTransportReceipt(page, receipt) {
	if (!receipt) return { ok: false, status: null, body: null, error: "github transport receipt is missing" };
	return page.evaluate(async (payload) => {
		try {
			const response = await fetch("/api/tau/handoff/transport/validate", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			let body = null;
			try {
				body = await response.json();
			} catch {
				body = { parse_error: true };
			}
			return {
				ok: response.ok && body?.ok === true,
				status: response.status,
				body,
				error: response.ok ? null : body?.detail || body?.error || `HTTP ${response.status}`,
			};
		} catch (error) {
			return {
				ok: false,
				status: null,
				body: null,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}, receipt);
}

function handoffProofAssertions(
	handoffExtraction,
	projectionExtraction,
	transportReceiptExtraction,
	renderedTransportValidationExtraction,
	orchestratorIntakeExtraction,
	subagentReceiptExpectationExtraction,
	candidateSubagentHandoffExtraction,
	subagentHandoffValidationExtraction,
	transportValidation,
	expectedNextAgent,
) {
	const handoff = handoffExtraction.json;
	const projection = projectionExtraction.json;
	const transportReceipt = transportReceiptExtraction.json;
	const renderedTransportValidation = renderedTransportValidationExtraction.json;
	const orchestratorIntake = orchestratorIntakeExtraction.json;
	const subagentReceiptExpectation = subagentReceiptExpectationExtraction.json;
	const candidateSubagentHandoff = candidateSubagentHandoffExtraction.json;
	const subagentHandoffValidation = subagentHandoffValidationExtraction.json;
	const validationReceipt = transportValidation?.body?.receipt;
	return {
		handoff_json_extracted: handoffExtraction.ok,
		handoff_schema_valid: handoff?.schema === "tau.agent_handoff.v1",
		handoff_goal_present: Boolean(handoff?.goal?.goal_id && handoff?.goal?.goal_hash),
		handoff_context_present: Boolean(handoff?.context?.summary && Array.isArray(handoff?.context?.artifacts)),
		handoff_result_present: Boolean(handoff?.result?.status && handoff?.result?.summary && Array.isArray(handoff?.result?.evidence)),
		handoff_next_agent_matches: expectedNextAgent ? handoff?.next_agent?.name === expectedNextAgent : Boolean(handoff?.next_agent?.name),
		handoff_stop_condition_present: typeof handoff?.stop_condition === "string" && handoff.stop_condition.length > 0,
		handoff_github_projection_json_extracted: projectionExtraction.ok,
		handoff_github_projection_ok: projection?.ok === true,
		handoff_github_target_present: Boolean(projection?.target?.repo && projection?.target?.target),
		handoff_github_agent_work_label: projection?.labels?.add?.includes("agent-work") === true,
		handoff_github_next_label_matches:
			typeof handoff?.next_agent?.name === "string"
			&& projection?.labels?.add?.includes(`next:${handoff.next_agent.name}`) === true,
		handoff_github_executor_label_matches:
			typeof handoff?.next_agent?.executor === "string"
			&& projection?.labels?.add?.includes(`executor:${handoff.next_agent.executor}`) === true,
		handoff_github_stale_labels_removed:
			projection?.labels?.remove?.includes("agent-active") === true
			&& projection?.labels?.remove?.includes("agent-blocked") === true,
		handoff_github_comment_embeds_json:
			projection?.comment?.body_marker === "<!-- tau-agent-handoff:v1 -->"
			&& projection?.comment?.body_embeds_handoff_json === true,
		handoff_github_transport_receipt_extracted: transportReceiptExtraction.ok,
		handoff_github_transport_receipt_ok: transportReceipt?.ok === true,
		handoff_github_transport_receipt_dry_run: transportReceipt?.dryRun === true && transportReceipt?.applied === false,
		handoff_github_transport_command_count_matches:
			Array.isArray(transportReceipt?.commands)
			&& transportReceipt.commands.length === transportReceipt.commandCount
			&& transportReceipt.commandCount > 0,
		handoff_github_transport_command_targets_repo:
			Array.isArray(transportReceipt?.commands)
			&& typeof projection?.target?.repo === "string"
			&& transportReceipt.commands.some((command) => command.includes(`--repo ${projection.target.repo}`)),
		handoff_github_transport_labels_match_projection:
			Array.isArray(transportReceipt?.labels?.add)
			&& Array.isArray(projection?.labels?.add)
			&& projection.labels.add.every((label) => transportReceipt.labels.add.includes(label)),
		handoff_github_transport_validation_rendered: renderedTransportValidationExtraction.ok,
		handoff_github_transport_validation_rendered_schema:
			renderedTransportValidation?.schema === "tau.handoff_github_transport_validation.v1",
		handoff_github_transport_validation_rendered_dry_run:
			renderedTransportValidation?.dryRun === true && renderedTransportValidation?.applied === false,
		handoff_orchestrator_intake_extracted: orchestratorIntakeExtraction.ok,
		handoff_orchestrator_intake_schema:
			orchestratorIntake?.schema === "tau.handoff_orchestrator_intake.v1",
		handoff_orchestrator_intake_accepted:
			orchestratorIntake?.ok === true && orchestratorIntake?.accepted === true,
		handoff_orchestrator_intake_next_agent_matches:
			typeof handoff?.next_agent?.name === "string" && orchestratorIntake?.nextAgent === handoff.next_agent.name,
		handoff_orchestrator_intake_dry_run:
			orchestratorIntake?.dryRun === true && orchestratorIntake?.applied === false,
		subagent_receipt_expectation_extracted: subagentReceiptExpectationExtraction.ok,
		subagent_receipt_expectation_schema:
			subagentReceiptExpectation?.schema === "tau.subagent_receipt_expectation.v1",
		subagent_receipt_expectation_next_agent_matches:
			typeof handoff?.next_agent?.name === "string" && subagentReceiptExpectation?.nextAgent === handoff.next_agent.name,
		subagent_receipt_expectation_required_handoff_schema:
			subagentReceiptExpectation?.requiredReceipt?.schema === "tau.agent_handoff.v1",
		subagent_receipt_expectation_requires_next_agent:
			subagentReceiptExpectation?.requiredReceipt?.next_agent_required === true,
		subagent_receipt_expectation_goal_matches_handoff:
			subagentReceiptExpectation?.goal?.goal_hash === handoff?.goal?.goal_hash,
		subagent_receipt_expectation_dry_run:
			subagentReceiptExpectation?.dryRun === true && subagentReceiptExpectation?.applied === false,
		subagent_receipt_expectation_persisted:
			subagentReceiptExpectation?.persisted === true,
		subagent_receipt_expectation_artifact_path_present:
			typeof subagentReceiptExpectation?.artifactPath === "string"
			&& subagentReceiptExpectation.artifactPath.includes("/tau-subagent-receipt-expectations/"),
		candidate_subagent_handoff_extracted: candidateSubagentHandoffExtraction.ok,
		candidate_subagent_handoff_schema:
			candidateSubagentHandoff?.schema === "tau.agent_handoff.v1",
		candidate_subagent_handoff_previous_matches_expectation:
			candidateSubagentHandoff?.previous_subagent === subagentReceiptExpectation?.requiredReceipt?.previous_subagent,
		candidate_subagent_handoff_goal_matches_expectation:
			candidateSubagentHandoff?.goal?.goal_hash === subagentReceiptExpectation?.goal?.goal_hash,
		candidate_subagent_handoff_declares_noop:
			candidateSubagentHandoff?.result?.status === "NOOP",
		subagent_handoff_validation_extracted: subagentHandoffValidationExtraction.ok,
		subagent_handoff_validation_schema:
			subagentHandoffValidation?.schema === "tau.subagent_handoff_validation.v1",
		subagent_handoff_validation_candidate_only:
			subagentHandoffValidation?.executed === false && subagentHandoffValidation?.candidateOnly === true,
		subagent_handoff_validation_previous_matches:
			subagentHandoffValidation?.previousSubagent === subagentReceiptExpectation?.requiredReceipt?.previous_subagent,
		subagent_handoff_validation_goal_matches_expectation:
			subagentHandoffValidation?.goal?.goal_hash === subagentReceiptExpectation?.goal?.goal_hash,
		handoff_github_transport_server_validation_ok: transportValidation?.ok === true,
		handoff_github_transport_server_validation_schema:
			validationReceipt?.schema === "tau.handoff_github_transport_validation.v1",
		handoff_github_transport_server_validation_dry_run:
			validationReceipt?.dryRun === true && validationReceipt?.applied === false,
	};
}

function failClosedHandoffAbsenceAssertions(handoffExtraction) {
	return {
		handoff_json_absent: !handoffExtraction.ok,
		handoff_absence_reason_recorded: handoffExtraction.error === "handoff JSON object not found",
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
				const status = typeof responseBody?.__status === "number" ? responseBody.__status : 200;
				const body = Object.hasOwn(responseBody, "body") ? responseBody.body : responseBody;
				await route.fulfill({
					status,
					contentType: "application/json",
					body: JSON.stringify(body),
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
		const githubProjectionExtraction = extractTauGithubProjection(rawChatText);
		const githubTransportReceiptExtraction = extractTauGithubTransportReceipt(rawChatText);
		const githubTransportValidationExtraction = extractTauGithubTransportValidation(rawChatText);
		const handoffOrchestratorIntakeExtraction = extractTauHandoffOrchestratorIntake(rawChatText);
		const subagentReceiptExpectationExtraction = extractTauSubagentReceiptExpectation(rawChatText);
		const candidateSubagentHandoffExtraction = extractTauCandidateSubagentHandoff(rawChatText);
		const subagentHandoffValidationExtraction = extractTauSubagentHandoffValidation(rawChatText);
		const githubTransportValidation =
			scenario.waitForHandoff === false
				? { ok: false, status: null, body: null, error: "handoff not expected" }
				: await validateTauGithubTransportReceipt(page, githubTransportReceiptExtraction.json);
		const handoffAssertions =
			scenario.waitForHandoff === false
				? failClosedHandoffAbsenceAssertions(handoffExtraction)
				: handoffProofAssertions(
						handoffExtraction,
						githubProjectionExtraction,
						githubTransportReceiptExtraction,
						githubTransportValidationExtraction,
						handoffOrchestratorIntakeExtraction,
						subagentReceiptExpectationExtraction,
						candidateSubagentHandoffExtraction,
						subagentHandoffValidationExtraction,
						githubTransportValidation,
						scenario.expectedNextAgent,
					);
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
			githubProjection: githubProjectionExtraction.ok ? githubProjectionExtraction.json : null,
			githubTransportReceipt: githubTransportReceiptExtraction.ok ? githubTransportReceiptExtraction.json : null,
			githubTransportValidationRendered: githubTransportValidationExtraction.ok
				? githubTransportValidationExtraction.json
				: null,
			handoffOrchestratorIntake: handoffOrchestratorIntakeExtraction.ok
				? handoffOrchestratorIntakeExtraction.json
				: null,
			subagentReceiptExpectation: subagentReceiptExpectationExtraction.ok
				? subagentReceiptExpectationExtraction.json
				: null,
			candidateSubagentHandoff: candidateSubagentHandoffExtraction.ok
				? candidateSubagentHandoffExtraction.json
				: null,
			subagentHandoffValidation: subagentHandoffValidationExtraction.ok
				? subagentHandoffValidationExtraction.json
				: null,
			githubTransportValidation,
			handoffExtractionError: handoffExtraction.error,
			githubProjectionExtractionError: githubProjectionExtraction.error,
			githubTransportReceiptExtractionError: githubTransportReceiptExtraction.error,
			githubTransportValidationExtractionError: githubTransportValidationExtraction.error,
			handoffOrchestratorIntakeExtractionError: handoffOrchestratorIntakeExtraction.error,
			subagentReceiptExpectationExtractionError: subagentReceiptExpectationExtraction.error,
			candidateSubagentHandoffExtractionError: candidateSubagentHandoffExtraction.error,
			subagentHandoffValidationExtractionError: subagentHandoffValidationExtraction.error,
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

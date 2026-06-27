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
	deflect: {
		prompt: "what is the weather?",
		waitFor: "Tau routed this turn to Memory deflect.",
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
	answer: {
		prompt: "What is the current project status?",
		waitFor: "Tau routed this turn to Memory answer.",
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
	research: {
		prompt: "search the web for latest Chutes pricing",
		waitFor: "Tau identified a research route and stopped before unsupported web claims.",
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

	try {
		await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
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

		const chatText = compact(await page.locator('[data-qid="tau:chat:shell:well"]').innerText());
		const visibleAssertions = {
			prompt_visible: chatText.includes(prompt),
			...scenario.assertions(chatText, memoryRequests),
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

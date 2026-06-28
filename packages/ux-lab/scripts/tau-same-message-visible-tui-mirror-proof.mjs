import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
const url = process.env.TAU_CHAT_URL || "http://127.0.0.1:3002/#tau";
const prompt =
	process.env.TAU_CHAT_PROMPT || "How does Tau handle a CWE-287 SPARTA evidence case?";
const outDir = process.env.TAU_PROOF_OUT_DIR || `/tmp/tau-same-message-visible-tui-mirror-${timestamp}`;
const timeoutMs = Number(process.env.TAU_PROOF_TIMEOUT_MS || "45000");

function compact(value) {
	return String(value || "").replace(/\s+/g, " ").trim();
}

async function innerText(page, qid) {
	return page.locator(`[data-qid="${qid}"]`).innerText({ timeout: 5_000 }).catch(() => "");
}

async function visibleStageSamples(page) {
	return page.locator('[data-qid^="tau:tui-mirror:visible-stage:"]').evaluateAll((nodes) =>
		nodes.map((node) => {
			const element = /** @type {HTMLElement} */ (node);
			const rect = element.getBoundingClientRect();
			return {
				qid: element.getAttribute("data-qid") || "",
				text: element.innerText || element.textContent || "",
				visible: rect.width > 0 && rect.height > 0,
			};
		}),
	);
}

function duplicateValues(values) {
	const seen = new Set();
	const duplicates = new Set();
	for (const value of values) {
		if (seen.has(value)) duplicates.add(value);
		seen.add(value);
	}
	return [...duplicates].sort();
}

async function main() {
	await mkdir(outDir, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({
		viewport: { width: 1440, height: 1200 },
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
		await page.locator('[data-qid="tau:chat:shell:well:input"]').fill(prompt, { timeout: 10_000 });
		await page.locator('[data-qid="tau:chat:shell:well:send"]').click({ timeout: 10_000 });

		await page.waitForFunction(
			(expectedPrompt) => document.body.innerText.includes(expectedPrompt),
			prompt,
			{ timeout: timeoutMs },
		);
		await page.waitForFunction(
			() => document.body.innerText.includes("Tau handoff JSON contract"),
			null,
			{ timeout: timeoutMs },
		);
		await page.waitForFunction(
			() => {
				const summary = document.querySelector('[data-qid="tau:tui-mirror:same-turn-summary"]');
				const text = summary?.textContent || "";
				return text.includes("COMPLIANCE") && text.includes("reviewer");
			},
			null,
			{ timeout: timeoutMs },
		);
		await page.waitForFunction(
			() =>
				[...document.querySelectorAll('[data-qid^="tau:tui-mirror:visible-stage:"]')].some((node) =>
					(node.textContent || "").includes("Accessing Memory"),
				),
			null,
			{ timeout: timeoutMs },
		);

		const chatText = await innerText(page, "tau:chat:shell:well");
		const sameTurnSummary = await innerText(page, "tau:tui-mirror:same-turn-summary");
		const currentStage = await innerText(page, "tau:tui-mirror:current-stage");
		const receiptStream = await innerText(page, "tau:tui-mirror:receipt-stream");
		const visibleStages = await visibleStageSamples(page);
		const visibleStageQids = visibleStages.map((stage) => stage.qid).filter(Boolean);
		const duplicateQids = duplicateValues(visibleStageQids);

		const assertions = {
			prompt_visible_in_chat: chatText.includes(prompt),
			compliance_chat_visible: chatText.includes("COMPLIANCE"),
			handoff_visible_in_chat: chatText.includes("tau.agent_handoff.v1"),
			same_turn_summary_visible: compact(sameTurnSummary).length > 0,
			same_turn_route_compliance_visible: sameTurnSummary.includes("COMPLIANCE"),
			same_turn_next_agent_reviewer_visible: sameTurnSummary.includes("reviewer"),
			same_turn_intent_stage_visible: visibleStages.some((stage) =>
				stage.text.includes("Getting Intent"),
			),
			same_turn_recall_stage_visible: visibleStages.some((stage) =>
				stage.text.includes("Accessing Memory"),
			),
			same_turn_evidence_stage_visible: visibleStages.some((stage) =>
				stage.text.includes("Creating Evidence Case"),
			),
			visible_stage_qids_unique: duplicateQids.length === 0,
			receipt_stream_still_present: receiptStream.includes("tau.tui_receipt_stream_view.v1"),
			memory_intent_200_seen: memoryRequests.some(
				(request) => request.url.includes("/api/memory/intent") && request.status === 200,
			),
			memory_recall_200_seen: memoryRequests.some(
				(request) => request.url.includes("/api/memory/recall") && request.status === 200,
			),
		};
		const ok = Object.values(assertions).every(Boolean) && errors.length === 0;
		const screenshot = path.join(outDir, "same-message-visible-tui-mirror.png");
		await page.screenshot({ path: screenshot, fullPage: true });

		const proof = {
			schema: "tau.same_message_visible_tui_mirror_browser_proof.v1",
			ok,
			mocked: false,
			live: true,
			url,
			prompt,
			screenshot,
			assertions,
			memoryRequests,
			errors,
			sampledText: {
				sameTurnSummary: compact(sameTurnSummary),
				currentStage: compact(currentStage),
				receiptStream: compact(receiptStream),
				visibleStages,
				duplicateQids,
			},
			claims: {
				proves: [
					"A live Tau chat COMPLIANCE turn renders tau.agent_handoff.v1 in the chat well.",
					"The side TUI mirror shows the same-turn Memory route, next agent, and visible stage list for that same browser turn.",
					"The visible TUI stage qids are unique for repeated stage names.",
					"The receipt stream remains present alongside the same-turn mirror.",
				],
				does_not_prove: [
					"Interactive Textual TUI embedding.",
					"PersonaPlex audio synthesis.",
					"Applied GitHub mutation for this browser turn.",
					"Semantic correctness of the evidence case.",
					"Final Sparta Chat readiness.",
				],
			},
			capturedAt: new Date().toISOString(),
		};
		await writeFile(path.join(outDir, "proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
		console.log(JSON.stringify({ artifactRoot: outDir, ...proof }, null, 2));
		await browser.close();
		process.exit(ok ? 0 : 1);
	} catch (error) {
		errors.push(error instanceof Error ? error.stack || error.message : String(error));
		const screenshot = path.join(outDir, "same-message-visible-tui-mirror-failed.png");
		await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
		const proof = {
			schema: "tau.same_message_visible_tui_mirror_browser_proof.v1",
			ok: false,
			mocked: false,
			live: true,
			url,
			prompt,
			screenshot,
			assertions: {},
			memoryRequests,
			errors,
			capturedAt: new Date().toISOString(),
		};
		await writeFile(path.join(outDir, "proof.json"), `${JSON.stringify(proof, null, 2)}\n`);
		console.error(JSON.stringify({ artifactRoot: outDir, ...proof }, null, 2));
		await browser.close();
		process.exit(1);
	}
}

void main();

#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "Z");
const url = process.env.TAU_CHAT_URL || "http://127.0.0.1:3002/#tau";
const outDir = process.env.TAU_PROOF_OUT_DIR || `/tmp/tau-tui-source-boundary-${timestamp}`;
const timeoutMs = Number(process.env.TAU_PROOF_TIMEOUT_MS || "45000");

function compact(value) {
	return String(value || "").replace(/\s+/g, " ").trim();
}

async function innerText(page, qid) {
	return page.locator(`[data-qid="${qid}"]`).innerText({ timeout: 10_000 }).catch(() => "");
}

async function hiddenJson(page, qid) {
	const raw = await page.locator(`[data-qid="${qid}"]`).textContent({ timeout: 10_000 });
	return JSON.parse(raw || "{}");
}

async function main() {
	await mkdir(outDir, { recursive: true });
	const browser = await chromium.launch({ headless: true });
	const page = await browser.newPage({
		viewport: { width: 1440, height: 900 },
		deviceScaleFactor: 1,
	});

	const errors = [];
	page.on("pageerror", (error) => errors.push(`pageerror:${error.message}`));
	page.on("console", (message) => {
		if (["error", "warning"].includes(message.type())) {
			errors.push(`console:${message.type()}:${message.text()}`);
		}
	});

	try {
		await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
		await page.waitForSelector('[data-qid="tau:tui-mirror:source-boundary"]', { timeout: timeoutMs });
		await page.waitForSelector('[data-qid="tau:tui-mirror:source-boundary-json"]', {
			state: "attached",
			timeout: timeoutMs,
		});

		const bodyText = await page.locator("body").innerText({ timeout: 10_000 });
		const sourceBoundaryText = await innerText(page, "tau:tui-mirror:source-boundary");
		const sourceBoundaryJson = await hiddenJson(page, "tau:tui-mirror:source-boundary-json");
		const receiptStreamText = await innerText(page, "tau:tui-mirror:receipt-stream");
		const chatParityText = await innerText(page, "tau:tui-mirror:chat-parity");
		const visiblePanelBox = await page.locator('[data-qid="tau:tui-mirror:source-boundary"]').boundingBox();

		const assertions = {
			source_boundary_panel_visible: Boolean(visiblePanelBox && visiblePanelBox.width > 0 && visiblePanelBox.height > 0),
			active_source_live_receipt_stream_visible: sourceBoundaryText.includes("Live receipt stream"),
			receipt_stream_live_boundary_visible: sourceBoundaryText.includes("mocked=false live=true"),
			textual_tui_fixture_boundary_visible:
				sourceBoundaryText.includes("fixture-proof-attached") &&
				sourceBoundaryText.includes("mocked=true") &&
				sourceBoundaryText.includes("live=false"),
			source_boundary_json_schema: sourceBoundaryJson.schema === "tau.tui_source_boundary.v1",
			source_boundary_json_active_source: sourceBoundaryJson.activeSource === "receipt-stream",
			source_boundary_json_receipt_stream_live:
				sourceBoundaryJson.receiptStream?.attached === true &&
				sourceBoundaryJson.receiptStream?.mocked === "false" &&
				sourceBoundaryJson.receiptStream?.live === "true",
			source_boundary_json_textual_tui_fixture:
				sourceBoundaryJson.textualTui?.state === "fixture-proof-attached" &&
				sourceBoundaryJson.textualTui?.mocked === "true" &&
				sourceBoundaryJson.textualTui?.live === "false",
			source_boundary_non_claim_interactive_textual_tui:
				Array.isArray(sourceBoundaryJson.claims?.does_not_prove) &&
				sourceBoundaryJson.claims.does_not_prove.includes("interactive browser-embedded Textual TUI"),
			receipt_stream_hidden_text_present: receiptStreamText.includes("tau.tui_receipt_stream_view.v1"),
			chat_parity_non_claim_visible: chatParityText.includes("not an interactive Textual TUI"),
			no_crash_log_visible: !bodyText.includes("CRASH LOG"),
			no_resize_observer_overlay_visible: !bodyText.includes("ResizeObserver loop"),
		};

		const ok = Object.values(assertions).every(Boolean) && errors.length === 0;
		const screenshot = path.join(outDir, "tau-tui-source-boundary.png");
		await page.screenshot({ path: screenshot, fullPage: true });

		const proof = {
			schema: "tau.tui_source_boundary_browser_proof.v1",
			ok,
			mocked: false,
			live: true,
			url,
			screenshot,
			assertions,
			errors,
			sampledText: {
				sourceBoundary: compact(sourceBoundaryText),
				receiptStream: compact(receiptStreamText),
				chatParity: compact(chatParityText),
			},
			sourceBoundary: sourceBoundaryJson,
			claims: {
				proves: [
					"The Tau UX Lab side pane exposes a visible TUI source boundary.",
					"The active side-pane source is a live receipt stream with mocked=false and live=true.",
					"The Textual TUI artifact is explicitly fixture-backed with mocked=true and live=false.",
					"The browser surface no longer shows the ResizeObserver crash overlay for this proof run.",
				],
				does_not_prove: [
					"interactive browser-embedded Textual TUI",
					"PTY attachment to a running Tau process",
					"live provider or Memory calls from the Textual renderer",
					"final Sparta Chat readiness",
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
		const screenshot = path.join(outDir, "tau-tui-source-boundary-failed.png");
		await page.screenshot({ path: screenshot, fullPage: true }).catch(() => undefined);
		const proof = {
			schema: "tau.tui_source_boundary_browser_proof.v1",
			ok: false,
			mocked: false,
			live: true,
			url,
			screenshot,
			assertions: {},
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

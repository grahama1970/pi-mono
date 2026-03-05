/**
 * Tests for cli-wrapper.ts — WezTerm CLI subprocess wrapper.
 *
 * Tests validation logic and error classification.
 * Tests that hit the actual wezterm binary are skipped if it's not running.
 */

import { describe, expect, it } from "vitest";
import * as cli from "./cli-wrapper.js";

describe("validatePaneId (via splitPane)", () => {
	it("rejects negative pane IDs", async () => {
		await expect(cli.splitPane({ paneId: -1 })).rejects.toThrow("Invalid pane_id");
	});

	it("rejects NaN pane IDs", async () => {
		await expect(cli.splitPane({ paneId: NaN })).rejects.toThrow("Invalid pane_id");
	});

	it("rejects float pane IDs", async () => {
		await expect(cli.splitPane({ paneId: 1.5 })).rejects.toThrow("Invalid pane_id");
	});

	it("rejects Infinity", async () => {
		await expect(cli.splitPane({ paneId: Infinity })).rejects.toThrow("Invalid pane_id");
	});
});

describe("validatePaneId (via sendText)", () => {
	it("rejects negative pane IDs", async () => {
		await expect(cli.sendText(-5, "hello")).rejects.toThrow("Invalid pane_id");
	});

	it("rejects float pane IDs", async () => {
		await expect(cli.sendText(3.14, "hello")).rejects.toThrow("Invalid pane_id");
	});
});

describe("validatePaneId (via getText)", () => {
	it("rejects negative pane IDs", async () => {
		await expect(cli.getText(-1)).rejects.toThrow("Invalid pane_id");
	});
});

describe("validatePaneId (via activatePane)", () => {
	it("rejects negative pane IDs", async () => {
		await expect(cli.activatePane(-1)).rejects.toThrow("Invalid pane_id");
	});
});

describe("splitPane validation", () => {
	it("rejects percent below 1", async () => {
		await expect(cli.splitPane({ percent: 0 })).rejects.toThrow("Invalid percent");
	});

	it("rejects percent above 99", async () => {
		await expect(cli.splitPane({ percent: 100 })).rejects.toThrow("Invalid percent");
	});

	it("rejects empty command strings", async () => {
		await expect(cli.splitPane({ command: ["ls", ""] })).rejects.toThrow("empty strings");
	});
});

describe("listPanes error handling", () => {
	it("fails gracefully when WezTerm is not running", { timeout: 15_000 }, async () => {
		await expect(cli.listPanes()).rejects.toThrow();
	});
});

describe("spawnWorkspace error handling", () => {
	it("fails gracefully when WezTerm is not running", { timeout: 15_000 }, async () => {
		await expect(cli.spawnWorkspace({ workspace: "test-ws" })).rejects.toThrow();
	});
});

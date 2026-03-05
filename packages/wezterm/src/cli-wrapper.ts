/**
 * Typed wrapper around `wezterm cli` subcommands.
 * Uses execFile (not exec) to prevent shell injection.
 */

import { execFile } from "node:child_process";
import type { PaneInfo, SpawnWorkspaceOptions, SplitPaneOptions } from "./types.js";

const WEZTERM = process.env.WEZTERM_EXECUTABLE ?? "wezterm";

function exec(args: string[], signal?: AbortSignal): Promise<string> {
	return new Promise((resolve, reject) => {
		if (args.length === 0) {
			reject(new Error("wezterm cli: empty command"));
			return;
		}

		execFile(WEZTERM, ["cli", ...args], { timeout: 10_000, signal }, (err, stdout, stderr) => {
			if (err) {
				const cmd = args[0];
				const code = (err as NodeJS.ErrnoException).code;
				if (stderr?.includes("failed to connect")) {
					reject(new Error(`wezterm cli ${cmd} failed: WezTerm not running or socket unreachable`));
				} else if (code === "ETIMEDOUT") {
					reject(new Error(`wezterm cli ${cmd} timed out after 10s`));
				} else if (code === "ENOENT") {
					reject(new Error(`wezterm cli ${cmd} failed: '${WEZTERM}' not found (check WEZTERM_EXECUTABLE)`));
				} else if (code === "ABORT_ERR") {
					reject(new Error(`wezterm cli ${cmd} was cancelled`));
				} else {
					reject(new Error(`wezterm cli ${cmd} failed: ${stderr || err.message}`));
				}
			} else {
				resolve(stdout);
			}
		});
	});
}

function validatePaneId(paneId: number): void {
	if (!Number.isInteger(paneId) || paneId < 0) {
		throw new Error(`Invalid pane_id: ${paneId} (must be non-negative integer)`);
	}
}

function parsePaneId(stdout: string, cmd: string): number {
	const paneId = parseInt(stdout.trim(), 10);
	if (Number.isNaN(paneId) || paneId < 0) {
		throw new Error(`wezterm cli ${cmd} returned invalid pane ID: ${stdout.trim()}`);
	}
	return paneId;
}

export async function listPanes(signal?: AbortSignal): Promise<PaneInfo[]> {
	const stdout = await exec(["list", "--format", "json"], signal);
	if (!stdout.trim()) {
		return [];
	}
	try {
		return JSON.parse(stdout) as PaneInfo[];
	} catch (e) {
		throw new Error(`wezterm cli list returned invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
	}
}

export async function splitPane(opts: SplitPaneOptions = {}, signal?: AbortSignal): Promise<number> {
	const args = ["split-pane"];

	if (opts.direction === "bottom") {
		args.push("--bottom");
	}
	if (opts.direction === "right") {
		args.push("--right");
	}

	if (opts.paneId !== undefined) {
		validatePaneId(opts.paneId);
		args.push("--pane-id", String(opts.paneId));
	}
	if (opts.cwd) {
		args.push("--cwd", opts.cwd);
	}
	if (opts.percent !== undefined) {
		if (opts.percent < 1 || opts.percent > 99) {
			throw new Error(`Invalid percent: ${opts.percent} (must be 1-99)`);
		}
		args.push("--percent", String(opts.percent));
	}
	if (opts.command && opts.command.length > 0) {
		if (opts.command.some((c) => c === "")) {
			throw new Error("Command array contains empty strings");
		}
		args.push("--", ...opts.command);
	}

	const stdout = await exec(args, signal);
	return parsePaneId(stdout, "split-pane");
}

export async function sendText(paneId: number, text: string, signal?: AbortSignal): Promise<void> {
	validatePaneId(paneId);
	await exec(["send-text", "--pane-id", String(paneId), "--no-paste", text], signal);
}

export async function getText(
	paneId: number,
	startLine?: number,
	endLine?: number,
	signal?: AbortSignal,
): Promise<string> {
	validatePaneId(paneId);
	const args = ["get-text", "--pane-id", String(paneId)];
	if (startLine !== undefined) {
		args.push("--start-line", String(startLine));
	}
	if (endLine !== undefined) {
		args.push("--end-line", String(endLine));
	}
	return await exec(args, signal);
}

export async function activatePane(paneId: number, signal?: AbortSignal): Promise<void> {
	validatePaneId(paneId);
	await exec(["activate-pane", "--pane-id", String(paneId)], signal);
}

export async function spawnWorkspace(opts: SpawnWorkspaceOptions, signal?: AbortSignal): Promise<number> {
	const args = ["spawn", "--new-window", "--workspace", opts.workspace];
	if (opts.cwd) {
		args.push("--cwd", opts.cwd);
	}
	if (opts.command && opts.command.length > 0) {
		args.push("--", ...opts.command);
	}
	const stdout = await exec(args, signal);
	return parsePaneId(stdout, "spawn");
}

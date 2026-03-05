/**
 * Typed wrapper around `wezterm cli` subcommands.
 * Uses execFile (not exec) to prevent shell injection.
 */

import { execFile } from "node:child_process";
import type { PaneInfo, SpawnWorkspaceOptions, SplitPaneOptions, WorkspaceInfo } from "./types.js";
import { KEY_SEQUENCES } from "./types.js";

const WEZTERM = process.env.WEZTERM_EXECUTABLE ?? "wezterm";

/** Read workspace from environment for workspace-relative routing */
export function currentWorkspace(): string | undefined {
	return process.env.WEZMUX_WORKSPACE_ID || undefined;
}

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

export async function listWorkspaces(signal?: AbortSignal): Promise<WorkspaceInfo[]> {
	const panes = await listPanes(signal);
	const workspaceMap = new Map<string, { paneIds: number[]; hasActive: boolean }>();

	for (const pane of panes) {
		const ws = workspaceMap.get(pane.workspace);
		if (ws) {
			ws.paneIds.push(pane.pane_id);
			if (pane.is_active) ws.hasActive = true;
		} else {
			workspaceMap.set(pane.workspace, {
				paneIds: [pane.pane_id],
				hasActive: pane.is_active,
			});
		}
	}

	return Array.from(workspaceMap.entries()).map(([name, ws]) => ({
		name,
		paneCount: ws.paneIds.length,
		isActive: ws.hasActive,
		paneIds: ws.paneIds,
	}));
}

export async function renameWorkspace(oldName: string, newName: string, signal?: AbortSignal): Promise<void> {
	await exec(["rename-workspace", "--workspace", oldName, newName], signal);
}

export async function switchWorkspace(name: string, signal?: AbortSignal): Promise<void> {
	const panes = await listPanes(signal);
	const targetPane = panes.find((p) => p.workspace === name);
	if (!targetPane) {
		throw new Error(`Workspace "${name}" not found`);
	}
	await activatePane(targetPane.pane_id, signal);
}

export async function closeWorkspace(name: string, signal?: AbortSignal): Promise<number> {
	const panes = await listPanes(signal);
	const workspacePanes = panes.filter((p) => p.workspace === name);
	if (workspacePanes.length === 0) {
		throw new Error(`Workspace "${name}" not found`);
	}
	for (const pane of workspacePanes) {
		await killPane(pane.pane_id, signal);
	}
	return workspacePanes.length;
}

export async function killPane(paneId: number, signal?: AbortSignal): Promise<void> {
	validatePaneId(paneId);
	await exec(["kill-pane", "--pane-id", String(paneId)], signal);
}

export async function sendKeys(paneId: number, keys: string[], signal?: AbortSignal): Promise<void> {
	validatePaneId(paneId);
	const sequence = keys
		.map((key) => {
			const seq = KEY_SEQUENCES[key];
			if (seq) return seq;
			if (key.length === 1) return key;
			throw new Error(`Unknown key: "${key}". Valid keys: ${Object.keys(KEY_SEQUENCES).join(", ")}`);
		})
		.join("");
	await exec(["send-text", "--pane-id", String(paneId), "--no-paste", sequence], signal);
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

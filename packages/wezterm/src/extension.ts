/**
 * Pi extension — 18 WezTerm tools + /panes command.
 *
 * Control flow: Embry OS → Pi (D-Bus) → WezTerm (CLI)
 *
 * Tool errors return { error: true } in details to provide user-friendly messages
 * without triggering retries. If multiple WezTerm instances are running,
 * commands target the first instance only.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as cli from "./cli-wrapper.js";
import type { ManagedPane, PaneInfo } from "./types.js";

// In-memory pane tracking. Not persisted across Pi restarts.
const managedPanes = new Map<number, ManagedPane>();

let cleanupInterval: ReturnType<typeof setInterval> | undefined;
let cleanupRunning = false;

export default function weztermExtension(pi: ExtensionAPI) {
	// Periodic cleanup to remove stale pane references
	if (cleanupInterval) clearInterval(cleanupInterval);

	cleanupInterval = setInterval(async () => {
		if (cleanupRunning) return;
		cleanupRunning = true;
		try {
			const cleanupPromise = cli.listPanes();
			let timeoutHandle: ReturnType<typeof setTimeout>;
			const timeoutPromise = new Promise<PaneInfo[]>((_, reject) => {
				timeoutHandle = setTimeout(() => reject(new Error("cleanup timeout")), 5000);
			});

			const panes = await Promise.race([cleanupPromise, timeoutPromise]).finally(() => {
				clearTimeout(timeoutHandle!);
			});
			const validIds = new Set(panes.map((p) => p.pane_id));
			const now = Date.now();

			for (const [id, managed] of managedPanes.entries()) {
				// Remove if pane no longer exists OR entry is >1hr old (handles ID reuse after crashes)
				if (!validIds.has(id) || now - managed.createdAt > 3_600_000) {
					managedPanes.delete(id);
				}
			}
		} catch {
			// WezTerm offline or cleanup timed out; skip
		} finally {
			cleanupRunning = false;
		}
	}, 60_000);

	// --- Tools ---

	pi.registerTool({
		name: "wezterm_list_panes",
		label: "List Panes",
		description:
			"List all WezTerm panes. Optionally filter by workspace name. Returns pane IDs, titles, working directories, and dimensions.",
		parameters: Type.Object({
			workspace: Type.Optional(Type.String({ description: "Filter panes to this workspace" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { workspace } = params as { workspace?: string };
			const effectiveWorkspace = workspace ?? cli.currentWorkspace();
			let panes: PaneInfo[];
			try {
				panes = await cli.listPanes(_signal);
			} catch (e) {
				return {
					content: [{ type: "text", text: `Failed to list panes: ${e instanceof Error ? e.message : String(e)}` }],
					details: { error: true, count: 0 },
				};
			}

			if (effectiveWorkspace) {
				panes = panes.filter((p) => p.workspace === effectiveWorkspace);
			}
			return {
				content: [{ type: "text", text: JSON.stringify(panes, null, 2) }],
				details: { count: panes.length, workspace: effectiveWorkspace ?? "all" },
			};
		},
	});

	pi.registerTool({
		name: "wezterm_list_workspaces",
		label: "List Workspaces",
		description:
			"List all WezTerm workspaces with pane counts and active status. Returns workspace names, pane counts, and which workspace is currently active.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			try {
				const workspaces = await cli.listWorkspaces(_signal);
				return {
					content: [{ type: "text", text: JSON.stringify(workspaces, null, 2) }],
					details: { count: workspaces.length },
				};
			} catch (e) {
				return {
					content: [
						{ type: "text", text: `Failed to list workspaces: ${e instanceof Error ? e.message : String(e)}` },
					],
					details: { error: true, count: 0 },
				};
			}
		},
	});

	pi.registerTool({
		name: "wezterm_switch_workspace",
		label: "Switch Workspace",
		description: "Switch to a named WezTerm workspace by activating one of its panes.",
		parameters: Type.Object({
			workspace: Type.String({ description: "Name of the workspace to switch to" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { workspace } = params as { workspace: string };
			try {
				await cli.switchWorkspace(workspace, _signal);
			} catch (e) {
				return {
					content: [
						{ type: "text", text: `Failed to switch workspace: ${e instanceof Error ? e.message : String(e)}` },
					],
					details: { error: true, workspace },
				};
			}
			return {
				content: [{ type: "text", text: `Switched to workspace "${workspace}"` }],
				details: { workspace },
			};
		},
	});

	pi.registerTool({
		name: "wezterm_rename_workspace",
		label: "Rename Workspace",
		description: "Rename an existing WezTerm workspace.",
		parameters: Type.Object({
			old_name: Type.String({ description: "Current workspace name" }),
			new_name: Type.String({ description: "New workspace name" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { old_name, new_name } = params as { old_name: string; new_name: string };
			if (!new_name || !/^[a-zA-Z0-9_-]+$/.test(new_name)) {
				return {
					content: [{ type: "text", text: `Invalid workspace name: "${new_name}" (must match [a-zA-Z0-9_-]+)` }],
					details: { error: true },
				};
			}
			try {
				await cli.renameWorkspace(old_name, new_name, _signal);
			} catch (e) {
				return {
					content: [
						{ type: "text", text: `Failed to rename workspace: ${e instanceof Error ? e.message : String(e)}` },
					],
					details: { error: true, old_name, new_name },
				};
			}
			return {
				content: [{ type: "text", text: `Renamed workspace "${old_name}" to "${new_name}"` }],
				details: { old_name, new_name },
			};
		},
	});

	pi.registerTool({
		name: "wezterm_close_workspace",
		label: "Close Workspace",
		description:
			"Close an entire WezTerm workspace by killing all its panes. Cannot close the last remaining workspace.",
		parameters: Type.Object({
			workspace: Type.String({ description: "Name of the workspace to close" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { workspace } = params as { workspace: string };
			try {
				const workspaces = await cli.listWorkspaces(_signal);
				if (workspaces.length <= 1) {
					return {
						content: [{ type: "text", text: "Cannot close the last remaining workspace" }],
						details: { error: true, workspace },
					};
				}
				const count = await cli.closeWorkspace(workspace, _signal);
				return {
					content: [{ type: "text", text: `Closed workspace "${workspace}" (${count} panes killed)` }],
					details: { workspace, panesKilled: count },
				};
			} catch (e) {
				return {
					content: [
						{ type: "text", text: `Failed to close workspace: ${e instanceof Error ? e.message : String(e)}` },
					],
					details: { error: true, workspace },
				};
			}
		},
	});

	pi.registerTool({
		name: "wezterm_send_keys",
		label: "Send Keys",
		description:
			"Send key sequences to a WezTerm pane. Use named keys like 'Ctrl-C', 'Enter', 'Tab', 'Escape', 'Up', 'Down', etc. Single characters are sent as-is.",
		parameters: Type.Object({
			pane_id: Type.Number({ description: "Target pane ID" }),
			keys: Type.Array(Type.String(), {
				description:
					"Key sequence. Named keys: Ctrl-C, Ctrl-D, Ctrl-Z, Ctrl-L, Ctrl-A, Ctrl-E, Ctrl-K, Ctrl-U, Ctrl-W, Ctrl-R, Enter, Tab, Escape, Backspace, Up, Down, Left, Right, Home, End, PageUp, PageDown, Delete. Single chars sent as-is.",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { pane_id, keys } = params as { pane_id: number; keys: string[] };
			try {
				await cli.sendKeys(pane_id, keys, _signal);
			} catch (e) {
				return {
					content: [{ type: "text", text: `Failed to send keys: ${e instanceof Error ? e.message : String(e)}` }],
					details: { error: true, paneId: pane_id },
				};
			}
			return {
				content: [{ type: "text", text: `Sent ${keys.length} key(s) to pane ${pane_id}: ${keys.join(", ")}` }],
				details: { paneId: pane_id, keys },
			};
		},
	});

	pi.registerTool({
		name: "wezterm_kill_pane",
		label: "Kill Pane",
		description: "Kill/close a specific WezTerm pane by its ID.",
		parameters: Type.Object({
			pane_id: Type.Number({ description: "Pane ID to kill" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { pane_id } = params as { pane_id: number };
			try {
				await cli.killPane(pane_id, _signal);
				managedPanes.delete(pane_id);
			} catch (e) {
				return {
					content: [{ type: "text", text: `Failed to kill pane: ${e instanceof Error ? e.message : String(e)}` }],
					details: { error: true, paneId: pane_id },
				};
			}
			return {
				content: [{ type: "text", text: `Killed pane ${pane_id}` }],
				details: { paneId: pane_id },
			};
		},
	});

	pi.registerTool({
		name: "wezterm_notify",
		label: "Send Notification",
		description: "Send a desktop notification via freedesktop notify-send. Appears in KDE/GNOME notification center.",
		parameters: Type.Object({
			title: Type.String({ description: "Notification title" }),
			body: Type.Optional(Type.String({ description: "Notification body text" })),
			urgency: Type.Optional(
				Type.Union([Type.Literal("low"), Type.Literal("normal"), Type.Literal("critical")], {
					description: "Urgency level (default: normal)",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { title, body, urgency } = params as {
				title: string;
				body?: string;
				urgency?: "low" | "normal" | "critical";
			};
			try {
				await cli.notify(title, body ?? "", urgency, _signal);
			} catch (e) {
				return {
					content: [{ type: "text", text: `Failed to notify: ${e instanceof Error ? e.message : String(e)}` }],
					details: { error: true },
				};
			}
			return {
				content: [{ type: "text", text: `Notification sent: "${title}"` }],
				details: { title },
			};
		},
	});

	pi.registerTool({
		name: "wezterm_split_pane",
		label: "Split Pane",
		description:
			"Split an existing WezTerm pane to create a new one. Returns the new pane ID. Use direction 'right' or 'bottom'.",
		parameters: Type.Object({
			direction: Type.Optional(
				Type.Union([Type.Literal("right"), Type.Literal("bottom")], {
					description: "Split direction: 'right' (vertical split) or 'bottom' (horizontal split). Default: right",
				}),
			),
			pane_id: Type.Optional(Type.Number({ description: "Pane to split. Defaults to active pane." })),
			cwd: Type.Optional(Type.String({ description: "Working directory for the new pane" })),
			command: Type.Optional(Type.Array(Type.String(), { description: "Command to run in the new pane" })),
			percent: Type.Optional(Type.Number({ description: "Size percentage for the new pane (1-99)" })),
			purpose: Type.Optional(Type.String({ description: "Label describing this pane's purpose for tracking" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { direction, pane_id, cwd, command, percent, purpose } = params as {
				direction?: "right" | "bottom";
				pane_id?: number;
				cwd?: string;
				command?: string[];
				percent?: number;
				purpose?: string;
			};

			let newPaneId: number;
			try {
				newPaneId = await cli.splitPane({ direction, paneId: pane_id, cwd, command, percent }, _signal);
			} catch (e) {
				return {
					content: [{ type: "text", text: `Failed to split pane: ${e instanceof Error ? e.message : String(e)}` }],
					details: { error: true },
				};
			}

			let paneInfo: PaneInfo | undefined;
			try {
				const panes = await cli.listPanes(_signal);
				paneInfo = panes.find((p) => p.pane_id === newPaneId);
			} catch {
				// Failed to get workspace info; proceed with defaults
			}

			managedPanes.set(newPaneId, {
				paneId: newPaneId,
				workspace: paneInfo?.workspace ?? "default",
				purpose: purpose ?? "unnamed",
				createdAt: Date.now(),
			});

			return {
				content: [{ type: "text", text: `Created pane ${newPaneId}` }],
				details: {
					paneId: newPaneId,
					direction: direction ?? "right",
					purpose: purpose ?? "unnamed",
					workspace: paneInfo?.workspace ?? "default",
				},
			};
		},
	});

	pi.registerTool({
		name: "wezterm_send_text",
		label: "Send Text",
		description:
			"Send text/commands to a specific WezTerm pane. The text is sent as keystrokes. Include \\n to press Enter.",
		parameters: Type.Object({
			pane_id: Type.Number({ description: "Target pane ID" }),
			text: Type.String({ description: "Text to send. Include \\n for Enter key." }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { pane_id, text } = params as { pane_id: number; text: string };
			try {
				await cli.sendText(pane_id, text, _signal);
			} catch (e) {
				return {
					content: [{ type: "text", text: `Failed to send text: ${e instanceof Error ? e.message : String(e)}` }],
					details: { error: true, paneId: pane_id },
				};
			}
			return {
				content: [{ type: "text", text: `Sent ${text.length} chars to pane ${pane_id}` }],
				details: { paneId: pane_id, length: text.length },
			};
		},
	});

	pi.registerTool({
		name: "wezterm_get_text",
		label: "Get Text",
		description: "Read the visible text content from a WezTerm pane. Optionally specify a line range for scrollback.",
		parameters: Type.Object({
			pane_id: Type.Number({ description: "Pane ID to read from" }),
			start_line: Type.Optional(Type.Number({ description: "Start line (negative for scrollback, e.g. -50)" })),
			end_line: Type.Optional(Type.Number({ description: "End line" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { pane_id, start_line, end_line } = params as {
				pane_id: number;
				start_line?: number;
				end_line?: number;
			};
			let text: string;
			try {
				text = await cli.getText(pane_id, start_line, end_line, _signal);
			} catch (e) {
				return {
					content: [{ type: "text", text: `Failed to get text: ${e instanceof Error ? e.message : String(e)}` }],
					details: { error: true, paneId: pane_id },
				};
			}
			return {
				content: [{ type: "text", text }],
				details: { paneId: pane_id, lines: text.split("\n").length },
			};
		},
	});

	pi.registerTool({
		name: "wezterm_activate_pane",
		label: "Activate Pane",
		description: "Focus/activate a specific WezTerm pane by its ID.",
		parameters: Type.Object({
			pane_id: Type.Number({ description: "Pane ID to activate" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { pane_id } = params as { pane_id: number };
			try {
				await cli.activatePane(pane_id, _signal);
			} catch (e) {
				return {
					content: [
						{ type: "text", text: `Failed to activate pane: ${e instanceof Error ? e.message : String(e)}` },
					],
					details: { error: true, paneId: pane_id },
				};
			}
			return {
				content: [{ type: "text", text: `Activated pane ${pane_id}` }],
				details: { paneId: pane_id },
			};
		},
	});

	pi.registerTool({
		name: "wezterm_spawn_workspace",
		label: "Spawn Workspace",
		description:
			"Create a new named WezTerm workspace in a new window. Returns the initial pane ID. Workspace names must match [a-zA-Z0-9_-]+.",
		parameters: Type.Object({
			workspace: Type.String({ description: "Workspace name" }),
			cwd: Type.Optional(Type.String({ description: "Working directory" })),
			command: Type.Optional(Type.Array(Type.String(), { description: "Initial command to run" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { workspace, cwd, command } = params as {
				workspace: string;
				cwd?: string;
				command?: string[];
			};

			if (!workspace || !/^[a-zA-Z0-9_-]+$/.test(workspace)) {
				return {
					content: [{ type: "text", text: `Invalid workspace name: "${workspace}" (must match [a-zA-Z0-9_-]+)` }],
					details: { error: true },
				};
			}

			let paneId: number;
			try {
				paneId = await cli.spawnWorkspace({ workspace, cwd, command }, _signal);
			} catch (e) {
				return {
					content: [
						{ type: "text", text: `Failed to spawn workspace: ${e instanceof Error ? e.message : String(e)}` },
					],
					details: { error: true, workspace },
				};
			}

			managedPanes.set(paneId, {
				paneId,
				workspace,
				purpose: "workspace-root",
				createdAt: Date.now(),
			});

			return {
				content: [{ type: "text", text: `Created workspace "${workspace}" with pane ${paneId}` }],
				details: { paneId, workspace },
			};
		},
	});

	// --- G1: Auto-diagnosis — read last error + pane context ---

	pi.registerTool({
		name: "wezterm_diagnose_error",
		label: "Diagnose Last Error",
		description:
			"Read the last failed command's context (exit code, command, cwd) and the recent terminal output. Use this to diagnose errors proactively. Returns error metadata plus the last 30 lines of the active pane.",
		parameters: Type.Object({
			pane_id: Type.Optional(Type.Number({ description: "Pane to read output from. Defaults to active pane." })),
			lines: Type.Optional(Type.Number({ description: "Number of scrollback lines to capture (default: 30)" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { pane_id, lines } = params as { pane_id?: number; lines?: number };
			const numLines = lines ?? 30;

			const lastError = await cli.getLastError();

			let output = "";
			try {
				const panes = await cli.listPanes(_signal);
				const targetId = pane_id ?? panes.find((p) => p.is_active)?.pane_id;
				if (targetId !== undefined) {
					output = await cli.getText(targetId, -numLines, undefined, _signal);
				}
			} catch {
				// Terminal output unavailable; error context alone is still useful
			}

			if (!lastError && !output) {
				return {
					content: [{ type: "text", text: "No error context available. The last command may have succeeded." }],
					details: { error: false },
				};
			}

			const parts: string[] = [];
			if (lastError) {
				parts.push(
					`Exit code: ${lastError.exit_code}`,
					`Command: ${lastError.command}`,
					`Directory: ${lastError.cwd}`,
					`Time: ${new Date(lastError.timestamp * 1000).toISOString()}`,
					"",
				);
			}
			if (output) {
				parts.push("Terminal output (last lines):", "---", output);
			}

			return {
				content: [{ type: "text", text: parts.join("\n") }],
				details: {
					exit_code: lastError?.exit_code,
					command: lastError?.command,
					has_output: output.length > 0,
				},
			};
		},
	});

	// --- G2: Block context — capture terminal output as agent context ---

	pi.registerTool({
		name: "wezterm_get_last_output",
		label: "Get Last Output",
		description:
			"Capture the last N lines of terminal output from a pane. Use this to provide context about what happened in the terminal — command results, errors, logs, etc.",
		parameters: Type.Object({
			pane_id: Type.Optional(Type.Number({ description: "Pane to read from. Defaults to active pane." })),
			lines: Type.Optional(Type.Number({ description: "Number of lines to capture (default: 50, max: 200)" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { pane_id, lines } = params as { pane_id?: number; lines?: number };
			const numLines = Math.min(lines ?? 50, 200);

			let targetId = pane_id;
			if (targetId === undefined) {
				const panes = await cli.listPanes(_signal);
				targetId = panes.find((p) => p.is_active)?.pane_id;
			}
			if (targetId === undefined) {
				return {
					content: [{ type: "text", text: "No active pane found" }],
					details: { error: true },
				};
			}

			let text: string;
			try {
				text = await cli.getText(targetId, -numLines, undefined, _signal);
			} catch (e) {
				return {
					content: [{ type: "text", text: `Failed to get output: ${e instanceof Error ? e.message : String(e)}` }],
					details: { error: true, paneId: targetId },
				};
			}

			return {
				content: [{ type: "text", text }],
				details: { paneId: targetId, lines: text.split("\n").length },
			};
		},
	});

	// --- G4: Structured interactive control ---

	pi.registerTool({
		name: "wezterm_interact",
		label: "Run and Capture",
		description:
			"Send a command to a pane, wait for the output to stabilize, and return the new output. Use this for interactive sessions (REPLs, debuggers, database shells) where you need to see the result before deciding the next action.",
		parameters: Type.Object({
			pane_id: Type.Number({ description: "Pane to interact with" }),
			command: Type.String({ description: "Command to send (Enter is appended automatically)" }),
			timeout_ms: Type.Optional(Type.Number({ description: "Max wait time in milliseconds (default: 10000)" })),
			settle_ms: Type.Optional(
				Type.Number({
					description: "Time with no new output before considering output stable (default: 500)",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { pane_id, command, timeout_ms, settle_ms } = params as {
				pane_id: number;
				command: string;
				timeout_ms?: number;
				settle_ms?: number;
			};

			let output: string;
			try {
				output = await cli.interact(pane_id, command, { timeoutMs: timeout_ms, settlMs: settle_ms }, _signal);
			} catch (e) {
				return {
					content: [{ type: "text", text: `Interact failed: ${e instanceof Error ? e.message : String(e)}` }],
					details: { error: true, paneId: pane_id },
				};
			}

			return {
				content: [{ type: "text", text: output || "(no output)" }],
				details: { paneId: pane_id, outputLines: output.split("\n").length },
			};
		},
	});

	// --- G5: Proactive error check — read shell hook error file ---

	pi.registerTool({
		name: "wezterm_check_error",
		label: "Check for Errors",
		description:
			"Check if the user's last shell command failed. Reads the error context file written by the embry-agentic.zsh shell hook. Returns null if no recent error. Use this proactively to offer help when errors occur.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
			const lastError = await cli.getLastError();

			if (!lastError) {
				return {
					content: [{ type: "text", text: "No recent errors detected." }],
					details: { has_error: false },
				};
			}

			// Check if the error is stale (>60 seconds old)
			const age = Math.floor(Date.now() / 1000) - lastError.timestamp;
			if (age > 60) {
				return {
					content: [{ type: "text", text: `Last error was ${age}s ago (stale). No recent errors.` }],
					details: { has_error: false, stale: true, age },
				};
			}

			return {
				content: [
					{
						type: "text",
						text: `Error detected ${age}s ago:\n  Command: ${lastError.command}\n  Exit code: ${lastError.exit_code}\n  Directory: ${lastError.cwd}`,
					},
				],
				details: {
					has_error: true,
					exit_code: lastError.exit_code,
					command: lastError.command,
					cwd: lastError.cwd,
					age,
				},
			};
		},
	});

	// --- /panes command ---

	pi.registerCommand("panes", {
		description: "List all WezTerm panes with managed labels",
		handler: async (_args, ctx) => {
			try {
				const panes = await cli.listPanes();
				const lines = panes.map((p) => {
					const managed = managedPanes.get(p.pane_id);
					const label = managed ? ` [${managed.purpose}]` : "";
					const active = p.is_active ? " *" : "";
					const zoomed = p.is_zoomed ? " [Z]" : "";
					return `  ${p.pane_id}: ${p.title}${label}${active}${zoomed} (${p.workspace}) ${p.size.cols}x${p.size.rows}`;
				});

				const managedCount = panes.filter((p) => managedPanes.has(p.pane_id)).length;
				const summary = `Panes: ${panes.length} total, ${managedCount} managed\n`;
				ctx.ui.notify(summary + lines.join("\n"));
			} catch (e) {
				ctx.ui.notify(`Failed to list panes: ${e instanceof Error ? e.message : String(e)}`);
			}
		},
	});
}

/** D-Bus state schema — matches org.embry.Agent.GetState response */
export interface DBusAgentState {
	isStreaming: boolean;
	currentModel: string;
	sessionName: string;
	sessionId: string;
	thinkingLevel: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	messageCount: number;
}

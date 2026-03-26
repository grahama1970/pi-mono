# Code Review Request: @embry/pi-wezterm

## Context

This is a new package (`pi-mono/packages/wezterm/`) that integrates Pi (an LLM agent harness) with WezTerm terminal. It provides:

1. **Pi Extension** (TypeScript): 6 LLM-callable tools for controlling WezTerm via `wezterm cli` subcommands
2. **WezTerm Lua Config**: Status bar, tab titles, keybindings, D-Bus state polling for passive agent display
3. **Python Bridge**: CLI helper for sending D-Bus commands (Ask/Steer/Abort) from WezTerm keybindings

### Architecture
- **Control flow:** Embry OS → D-Bus → Pi Agent → `wezterm cli` (Pi drives WezTerm)
- **Display flow:** Pi state (D-Bus) → WezTerm Lua (busctl poll) → status bar/tabs

### Key Reference Patterns
- Extension API: `ExtensionAPI` from `@mariozechner/pi-coding-agent`, tools registered with TypeBox schemas
- D-Bus: bus `org.embry.Agent`, path `/org/embry/Agent`, interface `org.embry.Agent`
- `DBusAgentState`: `{ isStreaming, currentModel, sessionName, sessionId, thinkingLevel, messageCount }`

## Review Focus

Be **brutal**. Evaluate:
1. **Architecture**: Is the layering correct? Any unnecessary coupling?
2. **Correctness**: Will `wezterm cli` commands actually work as wrapped? JSON parsing edge cases?
3. **Error handling**: Missing error paths, uncaught exceptions, silent failures?
4. **Security**: Command injection via user-provided strings? Shell escaping?
5. **Consistency**: Does this follow pi-mono patterns (TypeBox, extension API, naming)?
6. **Lua correctness**: WezTerm API usage, event handler signatures, module loading?
7. **Resource leaks**: Process spawning, polling intervals, state management?
8. **Edge cases**: What happens when WezTerm isn't running? Multiple instances? Race conditions?

## Files Under Review

### src/types.ts
```typescript
/**
 * Types for WezTerm CLI integration.
 *
 * PaneInfo mirrors wezterm's CliListResultItem JSON output.
 */

export interface PaneSize {
	rows: number;
	cols: number;
	pixel_width: number;
	pixel_height: number;
	dpi: number;
}

export interface PaneInfo {
	window_id: number;
	tab_id: number;
	pane_id: number;
	workspace: string;
	size: PaneSize;
	title: string;
	cwd: string;
	cursor_x: number;
	cursor_y: number;
	cursor_shape: string;
	cursor_visibility: string;
	left_col: number;
	top_row: number;
	tab_title: string;
	window_title: string;
	is_active: boolean;
	is_zoomed: boolean;
	tty_name: string | null;
}

export type SplitDirection = "right" | "bottom";

export interface ManagedPane {
	paneId: number;
	workspace: string;
	purpose: string;
	createdAt: number;
}

export interface SplitPaneOptions {
	direction?: SplitDirection;
	paneId?: number;
	cwd?: string;
	command?: string[];
	percent?: number;
}

export interface SpawnWorkspaceOptions {
	workspace: string;
	cwd?: string;
	command?: string[];
}
```

### src/cli-wrapper.ts
```typescript
/**
 * Typed wrapper around `wezterm cli` subcommands.
 * Each function calls execFile and parses stdout.
 */

import { execFile } from "node:child_process";
import type { PaneInfo, SplitPaneOptions, SpawnWorkspaceOptions } from "./types.js";

const WEZTERM = process.env.WEZTERM_EXECUTABLE ?? "wezterm";

function exec(args: string[]): Promise<string> {
	return new Promise((resolve, reject) => {
		execFile(WEZTERM, ["cli", ...args], { timeout: 10_000 }, (err, stdout, stderr) => {
			if (err) {
				reject(new Error(`wezterm cli ${args[0]} failed: ${stderr || err.message}`));
			} else {
				resolve(stdout);
			}
		});
	});
}

export async function listPanes(): Promise<PaneInfo[]> {
	const stdout = await exec(["list", "--format", "json"]);
	return JSON.parse(stdout) as PaneInfo[];
}

export async function splitPane(opts: SplitPaneOptions = {}): Promise<number> {
	const args = ["split-pane"];

	if (opts.direction === "bottom") {
		args.push("--bottom");
	}
	// default is right (no flag needed, but be explicit)
	if (opts.direction === "right") {
		args.push("--right");
	}

	if (opts.paneId !== undefined) {
		args.push("--pane-id", String(opts.paneId));
	}
	if (opts.cwd) {
		args.push("--cwd", opts.cwd);
	}
	if (opts.percent !== undefined) {
		args.push("--percent", String(opts.percent));
	}
	if (opts.command && opts.command.length > 0) {
		args.push("--", ...opts.command);
	}

	const stdout = await exec(args);
	// split-pane prints the new pane ID
	return parseInt(stdout.trim(), 10);
}

export async function sendText(paneId: number, text: string): Promise<void> {
	await exec(["send-text", "--pane-id", String(paneId), "--no-paste", text]);
}

export async function getText(paneId: number, startLine?: number, endLine?: number): Promise<string> {
	const args = ["get-text", "--pane-id", String(paneId)];
	if (startLine !== undefined) {
		args.push("--start-line", String(startLine));
	}
	if (endLine !== undefined) {
		args.push("--end-line", String(endLine));
	}
	return await exec(args);
}

export async function activatePane(paneId: number): Promise<void> {
	await exec(["activate-pane", "--pane-id", String(paneId)]);
}

export async function spawnWorkspace(opts: SpawnWorkspaceOptions): Promise<number> {
	const args = ["spawn", "--new-window", "--workspace", opts.workspace];
	if (opts.cwd) {
		args.push("--cwd", opts.cwd);
	}
	if (opts.command && opts.command.length > 0) {
		args.push("--", ...opts.command);
	}
	const stdout = await exec(args);
	return parseInt(stdout.trim(), 10);
}
```

### src/extension.ts
```typescript
/**
 * Pi extension — 6 WezTerm tools + /panes command.
 *
 * Control flow: Embry OS → Pi (D-Bus) → WezTerm (CLI)
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as cli from "./cli-wrapper.js";
import type { ManagedPane } from "./types.js";

const managedPanes = new Map<number, ManagedPane>();

export default function weztermExtension(pi: ExtensionAPI) {
	// --- Tools ---

	pi.registerTool({
		name: "wezterm_list_panes",
		label: "List Panes",
		description:
			"List all WezTerm panes. Optionally filter by workspace name. Returns pane IDs, titles, working directories, and dimensions.",
		parameters: Type.Object({
			workspace: Type.Optional(Type.String({ description: "Filter panes to this workspace" })),
		}),
		async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
			const { workspace } = params as { workspace?: string };
			let panes = await cli.listPanes();
			if (workspace) {
				panes = panes.filter((p) => p.workspace === workspace);
			}
			return {
				content: [{ type: "text", text: JSON.stringify(panes, null, 2) }],
				details: { count: panes.length, workspace: workspace ?? "all" },
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
		async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
			const { direction, pane_id, cwd, command, percent, purpose } = params as {
				direction?: "right" | "bottom";
				pane_id?: number;
				cwd?: string;
				command?: string[];
				percent?: number;
				purpose?: string;
			};
			const newPaneId = await cli.splitPane({
				direction,
				paneId: pane_id,
				cwd,
				command,
				percent,
			});

			// Track managed panes
			const panes = await cli.listPanes();
			const paneInfo = panes.find((p) => p.pane_id === newPaneId);
			managedPanes.set(newPaneId, {
				paneId: newPaneId,
				workspace: paneInfo?.workspace ?? "default",
				purpose: purpose ?? "unnamed",
				createdAt: Date.now(),
			});

			return {
				content: [{ type: "text", text: `Created pane ${newPaneId}` }],
				details: { paneId: newPaneId, direction: direction ?? "right", purpose: purpose ?? "unnamed" },
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
		async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
			const { pane_id, text } = params as { pane_id: number; text: string };
			await cli.sendText(pane_id, text);
			return {
				content: [{ type: "text", text: `Sent ${text.length} chars to pane ${pane_id}` }],
				details: { paneId: pane_id, length: text.length },
			};
		},
	});

	pi.registerTool({
		name: "wezterm_get_text",
		label: "Get Text",
		description:
			"Read the visible text content from a WezTerm pane. Optionally specify a line range for scrollback.",
		parameters: Type.Object({
			pane_id: Type.Number({ description: "Pane ID to read from" }),
			start_line: Type.Optional(
				Type.Number({ description: "Start line (negative for scrollback, e.g. -50)" }),
			),
			end_line: Type.Optional(Type.Number({ description: "End line" })),
		}),
		async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
			const { pane_id, start_line, end_line } = params as {
				pane_id: number;
				start_line?: number;
				end_line?: number;
			};
			const text = await cli.getText(pane_id, start_line, end_line);
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
		async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
			const { pane_id } = params as { pane_id: number };
			await cli.activatePane(pane_id);
			return {
				content: [{ type: "text", text: `Activated pane ${pane_id}` }],
				details: { paneId: pane_id },
			};
		},
	});

	pi.registerTool({
		name: "wezterm_spawn_workspace",
		label: "Spawn Workspace",
		description: "Create a new named WezTerm workspace in a new window. Returns the initial pane ID.",
		parameters: Type.Object({
			workspace: Type.String({ description: "Workspace name" }),
			cwd: Type.Optional(Type.String({ description: "Working directory" })),
			command: Type.Optional(Type.Array(Type.String(), { description: "Initial command to run" })),
		}),
		async execute(_toolCallId, params, _onUpdate, _ctx, _signal) {
			const { workspace, cwd, command } = params as {
				workspace: string;
				cwd?: string;
				command?: string[];
			};
			const paneId = await cli.spawnWorkspace({ workspace, cwd, command });

			managedPanes.set(paneId, {
				paneId,
				workspace,
				purpose: `workspace-root`,
				createdAt: Date.now(),
			});

			return {
				content: [{ type: "text", text: `Created workspace "${workspace}" with pane ${paneId}` }],
				details: { paneId, workspace },
			};
		},
	});

	// --- /panes command ---

	pi.registerCommand("panes", async (ctx) => {
		try {
			const panes = await cli.listPanes();
			const lines = panes.map((p) => {
				const managed = managedPanes.get(p.pane_id);
				const label = managed ? ` [${managed.purpose}]` : "";
				return `  ${p.pane_id}: ${p.title}${label} (${p.workspace}) ${p.size.cols}x${p.size.rows}`;
			});
			ctx.ui.notify(`Panes (${panes.length}):\n${lines.join("\n")}`);
		} catch (e) {
			ctx.ui.notify(`Failed to list panes: ${e instanceof Error ? e.message : String(e)}`);
		}
	});
}
```

### src/index.ts
```typescript
export { default } from "./extension.js";
export * from "./types.js";
export * from "./cli-wrapper.js";
```

### lua/wezterm.lua
```lua
-- wezterm.lua — Embry OS WezTerm configuration
-- Requires embry modules for agent state display.
local wezterm = require("wezterm")
local embry = require("embry")

local config = wezterm.config_builder()

-- Appearance
config.color_scheme = "Dracula (Official)"
config.font = wezterm.font("JetBrains Mono", { weight = "Medium" })
config.font_size = 13.0
config.line_height = 1.1

-- Tab bar
config.use_fancy_tab_bar = false
config.tab_bar_at_bottom = true
config.hide_tab_bar_if_only_one_tab = false
config.tab_max_width = 32
config.show_new_tab_button_in_tab_bar = false

-- Window
config.window_padding = { left = 4, right = 4, top = 4, bottom = 4 }
config.window_decorations = "RESIZE"
config.adjust_window_size_when_changing_font_size = false

-- Status bar
config.enable_scroll_bar = false

-- Wire up Embry OS event handlers
embry.setup(config)

return config
```

### lua/embry/init.lua
```lua
-- embry/init.lua — Module loader for Embry OS WezTerm integration
local M = {}

M.state = require("embry.state")
M.status_bar = require("embry.status-bar")
M.tab_title = require("embry.tab-title")
M.keybindings = require("embry.keybindings")

function M.setup(config)
	M.status_bar.setup(config)
	M.tab_title.setup(config)
	M.keybindings.setup(config)
end

return M
```

### lua/embry/state.lua
```lua
-- embry/state.lua — D-Bus polling + state cache
-- Polls org.embry.Agent via busctl, caches result with adaptive interval.
local wezterm = require("wezterm")

local M = {}

local POLL_FAST = 0.5 -- seconds, when streaming
local POLL_NORMAL = 2 -- seconds, when idle
local POLL_OFFLINE = 5 -- seconds, when agent unreachable

local BUS_NAME = "org.embry.Agent"
local OBJECT_PATH = "/org/embry/Agent"
local INTERFACE = "org.embry.Agent"

local cached_state = nil
local last_poll = 0
local poll_interval = POLL_NORMAL
local consecutive_failures = 0

-- Default state when agent is unreachable
local OFFLINE_STATE = {
	isStreaming = false,
	currentModel = "",
	sessionName = "",
	sessionId = "",
	thinkingLevel = "off",
	messageCount = 0,
	online = false,
}

-- Parse busctl output: 's "{"key":"value",...}"' → table
local function parse_busctl_output(stdout)
	-- busctl returns: s "json-string-here"
	local json_str = stdout:match('^s "(.+)"')
	if not json_str then
		-- Try without the 's ' prefix (varies by busctl version)
		json_str = stdout:match('"(.+)"')
	end
	if not json_str then
		return nil
	end
	-- Unescape embedded quotes
	json_str = json_str:gsub('\\"', '"')
	local ok, result = pcall(wezterm.json_parse, json_str)
	if ok then
		return result
	end
	return nil
end

function M.get()
	local now = os.clock()
	if cached_state and (now - last_poll) < poll_interval then
		return cached_state
	end

	local success, stdout, _stderr = wezterm.run_child_process({
		"busctl",
		"--user",
		"call",
		BUS_NAME,
		OBJECT_PATH,
		INTERFACE,
		"GetState",
	})

	if success then
		local state = parse_busctl_output(stdout)
		if state then
			state.online = true
			cached_state = state
			last_poll = now
			consecutive_failures = 0

			-- Adaptive interval: poll faster when streaming
			if state.isStreaming then
				poll_interval = POLL_FAST
			else
				poll_interval = POLL_NORMAL
			end

			return cached_state
		end
	end

	-- Agent not reachable — back off with consecutive failures
	consecutive_failures = consecutive_failures + 1
	poll_interval = math.min(POLL_OFFLINE * consecutive_failures, 30)
	cached_state = OFFLINE_STATE
	last_poll = now
	return cached_state
end

function M.invalidate()
	last_poll = 0
end

return M
```

### lua/embry/status-bar.lua
```lua
-- embry/status-bar.lua — update-status handler
-- Left: model name, thinking level, streaming indicator
-- Right: session name, workspace, message count
local wezterm = require("wezterm")
local state = require("embry.state")

local M = {}

-- Shorten model names for display
local MODEL_SHORT = {
	["claude-opus-4-6"] = "opus",
	["claude-sonnet-4-6"] = "sonnet",
	["claude-haiku-4-5-20251001"] = "haiku",
}

local THINKING_ICONS = {
	off = "",
	minimal = "~",
	low = ".",
	medium = "..",
	high = "...",
	xhigh = "!",
}

local function shorten_model(name)
	if not name or name == "" then
		return "?"
	end
	if MODEL_SHORT[name] then
		return MODEL_SHORT[name]
	end
	-- Strip common prefixes and date suffixes
	local short = name:gsub("^claude%-", ""):gsub("%-20%d+$", "")
	if #short > 12 then
		short = short:sub(1, 12)
	end
	return short
end

function M.setup(config)
	config.enable_scroll_bar = false

	wezterm.on("update-status", function(window, _pane)
		local agent = state.get()

		-- Left status: agent info
		local left = {}
		if not agent.online then
			table.insert(left, { Foreground = { Color = "#666666" } })
			table.insert(left, { Text = " agent: offline " })
		else
			-- Model name
			table.insert(left, { Foreground = { Color = "#8be9fd" } })
			table.insert(left, { Text = " " .. shorten_model(agent.currentModel) })

			-- Thinking level (if not off)
			local thinking = agent.thinkingLevel or "off"
			if thinking ~= "off" then
				local icon = THINKING_ICONS[thinking] or thinking
				table.insert(left, { Foreground = { Color = "#6272a4" } })
				table.insert(left, { Text = " T:" .. icon })
			end

			-- Streaming indicator
			if agent.isStreaming then
				table.insert(left, { Foreground = { Color = "#f1fa8c" } })
				table.insert(left, { Text = " thinking..." })
			end

			table.insert(left, { Text = " " })
		end
		window:set_left_status(wezterm.format(left))

		-- Right status: session info
		local right = {}
		if agent.online then
			-- Session name
			if agent.sessionName and agent.sessionName ~= "" then
				table.insert(right, { Foreground = { Color = "#bd93f9" } })
				table.insert(right, { Text = " " .. agent.sessionName })
			end

			-- Message count
			if agent.messageCount and agent.messageCount > 0 then
				table.insert(right, { Foreground = { Color = "#6272a4" } })
				table.insert(right, { Text = " [" .. agent.messageCount .. "] " })
			else
				table.insert(right, { Text = " " })
			end
		end
		window:set_right_status(wezterm.format(right))
	end)
end

return M
```

### lua/embry/tab-title.lua
```lua
-- embry/tab-title.lua — format-tab-title handler
-- Shows tab index, process/agent icon, truncated title, workspace indicator
local wezterm = require("wezterm")

local M = {}

local PROCESS_ICONS = {
	["pi"] = " ",
	["node"] = " ",
	["python"] = " ",
	["python3"] = " ",
	["nvim"] = " ",
	["vim"] = " ",
	["zsh"] = " ",
	["bash"] = " ",
	["fish"] = " ",
	["htop"] = " ",
	["btop"] = " ",
	["git"] = " ",
	["cargo"] = " ",
	["npm"] = " ",
	["bun"] = " ",
	["claude"] = " ",
	["codex"] = " ",
}

local function get_process_name(pane)
	-- Try foreground process name first, fall back to title
	local name = pane.foreground_process_name or ""
	-- Extract basename
	name = name:match("([^/\\]+)$") or name
	return name:lower()
end

local function get_icon(pane)
	local proc = get_process_name(pane)
	for pattern, icon in pairs(PROCESS_ICONS) do
		if proc:find(pattern, 1, true) then
			return icon
		end
	end
	return ""
end

local function truncate(s, max_len)
	if not s then
		return ""
	end
	if #s <= max_len then
		return s
	end
	return s:sub(1, max_len - 1) .. "~"
end

function M.setup(config)
	wezterm.on("format-tab-title", function(tab, _tabs, _panes, _cfg, hover, _max_width)
		local pane = tab.active_pane
		local title = pane.title
		local icon = get_icon(pane)
		local index = tab.tab_index + 1

		-- Workspace prefix if not "default"
		local ws = tab.active_pane.user_vars and tab.active_pane.user_vars.workspace or nil
		local ws_prefix = ""
		if ws and ws ~= "" and ws ~= "default" then
			ws_prefix = ws .. ":"
		end

		-- Zoomed indicator
		local zoom = ""
		if tab.active_pane.is_zoomed then
			zoom = " [Z]"
		end

		-- Highlight active/hovered tab
		local bg
		if tab.is_active then
			bg = "#44475a"
		elseif hover then
			bg = "#3a3d4d"
		else
			bg = "#282a36"
		end

		return {
			{ Background = { Color = bg } },
			{ Text = " " .. index .. " " .. icon .. ws_prefix .. truncate(title, 18) .. zoom .. " " },
		}
	end)
end

return M
```

### lua/embry/keybindings.lua
```lua
-- embry/keybindings.lua — Pane navigation + agent interaction keybindings
-- CTRL+A leader (tmux-style), plus agent ask/steer/abort shortcuts.
local wezterm = require("wezterm")
local act = wezterm.action

local M = {}

-- Bridge script path (adjacent to lua/)
local BRIDGE = (function()
	-- Resolve relative to this file's location
	local info = debug.getinfo(1, "S")
	local src = info.source:match("^@(.+)$")
	if src then
		local dir = src:match("^(.+)/[^/]+$")
		if dir then
			return dir .. "/../../bin/embry-wezterm-bridge"
		end
	end
	return "embry-wezterm-bridge"
end)()

function M.setup(config)
	config.leader = { key = "a", mods = "CTRL", timeout_milliseconds = 1000 }

	config.keys = {
		-- === Pane splitting ===
		{ key = "|", mods = "LEADER|SHIFT", action = act.SplitHorizontal({ domain = "CurrentPaneDomain" }) },
		{ key = "-", mods = "LEADER", action = act.SplitVertical({ domain = "CurrentPaneDomain" }) },

		-- === Pane navigation ===
		{ key = "h", mods = "LEADER", action = act.ActivatePaneDirection("Left") },
		{ key = "j", mods = "LEADER", action = act.ActivatePaneDirection("Down") },
		{ key = "k", mods = "LEADER", action = act.ActivatePaneDirection("Up") },
		{ key = "l", mods = "LEADER", action = act.ActivatePaneDirection("Right") },

		-- === Pane resize ===
		{ key = "H", mods = "LEADER|SHIFT", action = act.AdjustPaneSize({ "Left", 5 }) },
		{ key = "J", mods = "LEADER|SHIFT", action = act.AdjustPaneSize({ "Down", 5 }) },
		{ key = "K", mods = "LEADER|SHIFT", action = act.AdjustPaneSize({ "Up", 5 }) },
		{ key = "L", mods = "LEADER|SHIFT", action = act.AdjustPaneSize({ "Right", 5 }) },

		-- === Pane zoom ===
		{ key = "z", mods = "LEADER", action = act.TogglePaneZoomState },

		-- === Tab management ===
		{ key = "c", mods = "LEADER", action = act.SpawnTab("CurrentPaneDomain") },
		{ key = "n", mods = "LEADER", action = act.ActivateTabRelative(1) },
		{ key = "p", mods = "LEADER", action = act.ActivateTabRelative(-1) },

		-- === Close pane ===
		{ key = "x", mods = "LEADER", action = act.CloseCurrentPane({ confirm = true }) },

		-- === Copy mode ===
		{ key = "[", mods = "LEADER", action = act.ActivateCopyMode },

		-- === Agent interaction (Phase 3) ===

		-- Ask agent: opens input prompt, sends via D-Bus
		{
			key = "a",
			mods = "CTRL|SHIFT",
			action = act.PromptInputLine({
				description = "Ask the agent:",
				action = wezterm.action_callback(function(_window, _pane, line)
					if line and line ~= "" then
						wezterm.run_child_process({
							BRIDGE, "ask", line,
						})
					end
				end),
			}),
		},

		-- Steer agent: send mid-run steering message
		{
			key = "s",
			mods = "CTRL|SHIFT",
			action = act.PromptInputLine({
				description = "Steer the agent:",
				action = wezterm.action_callback(function(_window, _pane, line)
					if line and line ~= "" then
						wezterm.run_child_process({
							BRIDGE, "steer", line,
						})
					end
				end),
			}),
		},

		-- Abort agent
		{
			key = "q",
			mods = "CTRL|SHIFT",
			action = wezterm.action_callback(function(_window, _pane)
				wezterm.run_child_process({ BRIDGE, "abort" })
			end),
		},
	}
end

return M
```

### bin/embry-wezterm-bridge
```python
#!/usr/bin/env python3
"""
embry-wezterm-bridge — D-Bus helper for WezTerm agent keybindings.

Sends Ask, Steer, FollowUp, and Abort commands to org.embry.Agent
via busctl. Designed to be called from WezTerm Lua callbacks.

Usage:
    embry-wezterm-bridge ask "your prompt here"
    embry-wezterm-bridge steer "steering message"
    embry-wezterm-bridge followup "follow-up message"
    embry-wezterm-bridge abort
    embry-wezterm-bridge state
"""

import json
import subprocess
import sys

BUS_NAME = "org.embry.Agent"
OBJECT_PATH = "/org/embry/Agent"
INTERFACE = "org.embry.Agent"


def busctl_call(method: str, signature: str = "", *args: str) -> tuple[bool, str]:
    """Call a D-Bus method via busctl. Returns (success, stdout)."""
    cmd = [
        "busctl", "--user", "call",
        BUS_NAME, OBJECT_PATH, INTERFACE,
        method,
    ]
    if signature:
        cmd.append(signature)
        cmd.extend(args)

    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return result.returncode == 0, result.stdout.strip()
    except subprocess.TimeoutExpired:
        return False, "timeout"
    except FileNotFoundError:
        return False, "busctl not found"


def cmd_ask(prompt: str) -> int:
    """Send an AskAsync request to the agent."""
    ok, out = busctl_call("AskAsync", "s", prompt)
    if ok:
        print(f"Asked: {prompt[:60]}...")
        return 0
    print(f"Failed to ask: {out}", file=sys.stderr)
    return 1


def cmd_steer(message: str) -> int:
    """Send a Steer message to redirect the running agent."""
    ok, out = busctl_call("Steer", "s", message)
    if ok:
        print(f"Steered: {message[:60]}...")
        return 0
    print(f"Failed to steer: {out}", file=sys.stderr)
    return 1


def cmd_followup(message: str) -> int:
    """Send a FollowUp message after agent completes."""
    ok, out = busctl_call("FollowUp", "s", message)
    if ok:
        print(f"Follow-up: {message[:60]}...")
        return 0
    print(f"Failed to follow up: {out}", file=sys.stderr)
    return 1


def cmd_abort() -> int:
    """Abort the running agent."""
    ok, out = busctl_call("Abort")
    if ok:
        print("Agent aborted.")
        return 0
    print(f"Failed to abort: {out}", file=sys.stderr)
    return 1


def cmd_state() -> int:
    """Get and print the current agent state."""
    ok, out = busctl_call("GetState")
    if not ok:
        print(f"Agent offline: {out}", file=sys.stderr)
        return 1

    # Parse busctl output: s "json..."
    import re
    match = re.match(r'^s "(.+)"$', out)
    if match:
        json_str = match.group(1).replace('\\"', '"')
        try:
            state = json.loads(json_str)
            print(json.dumps(state, indent=2))
            return 0
        except json.JSONDecodeError:
            pass

    print(out)
    return 0


COMMANDS = {
    "ask": (cmd_ask, 1, "ask <prompt>"),
    "steer": (cmd_steer, 1, "steer <message>"),
    "followup": (cmd_followup, 1, "followup <message>"),
    "abort": (cmd_abort, 0, "abort"),
    "state": (cmd_state, 0, "state"),
}


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print("Usage: embry-wezterm-bridge <command> [args]")
        print("\nCommands:")
        for name, (_, _, usage) in sorted(COMMANDS.items()):
            print(f"  {usage}")
        return 0

    cmd_name = sys.argv[1]
    if cmd_name not in COMMANDS:
        print(f"Unknown command: {cmd_name}", file=sys.stderr)
        return 1

    func, nargs, usage = COMMANDS[cmd_name]
    remaining = sys.argv[2:]

    if len(remaining) < nargs:
        print(f"Usage: embry-wezterm-bridge {usage}", file=sys.stderr)
        return 1

    if nargs == 0:
        return func()
    elif nargs == 1:
        return func(" ".join(remaining))
    else:
        return func(*remaining[:nargs])


if __name__ == "__main__":
    sys.exit(main())
```

### scripts/install.sh
```bash
#!/usr/bin/env bash
# install.sh — Symlink Embry OS WezTerm config into place.
# Backs up existing config if present.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LUA_DIR="$(cd "$SCRIPT_DIR/../lua" && pwd)"
WEZTERM_DIR="${HOME}/.config/wezterm"

echo "Installing Embry OS WezTerm config..."
echo "  Source: ${LUA_DIR}"
echo "  Target: ${WEZTERM_DIR}"

mkdir -p "$WEZTERM_DIR"

# Backup existing wezterm.lua if it exists and isn't already our symlink
if [ -e "$WEZTERM_DIR/wezterm.lua" ] && [ ! -L "$WEZTERM_DIR/wezterm.lua" ]; then
	BACKUP="$WEZTERM_DIR/wezterm.lua.backup.$(date +%Y%m%d%H%M%S)"
	echo "  Backing up existing config → $BACKUP"
	mv "$WEZTERM_DIR/wezterm.lua" "$BACKUP"
elif [ -L "$WEZTERM_DIR/wezterm.lua" ]; then
	echo "  Removing existing symlink: $WEZTERM_DIR/wezterm.lua"
	rm "$WEZTERM_DIR/wezterm.lua"
fi

# Backup existing embry/ if it exists and isn't already our symlink
if [ -e "$WEZTERM_DIR/embry" ] && [ ! -L "$WEZTERM_DIR/embry" ]; then
	BACKUP="$WEZTERM_DIR/embry.backup.$(date +%Y%m%d%H%M%S)"
	echo "  Backing up existing embry/ → $BACKUP"
	mv "$WEZTERM_DIR/embry" "$BACKUP"
elif [ -L "$WEZTERM_DIR/embry" ]; then
	echo "  Removing existing symlink: $WEZTERM_DIR/embry"
	rm "$WEZTERM_DIR/embry"
fi

# Create symlinks
ln -s "$LUA_DIR/wezterm.lua" "$WEZTERM_DIR/wezterm.lua"
ln -s "$LUA_DIR/embry" "$WEZTERM_DIR/embry"

echo "Done. Restart WezTerm to apply."
echo ""
echo "Status bar will show 'agent: offline' until pi-dbus is running."
```

### package.json
```json
{
	"name": "@embry/pi-wezterm",
	"version": "0.1.0",
	"description": "Pi extension for WezTerm terminal control — spawn panes, send commands, read output",
	"type": "module",
	"exports": {
		".": {
			"import": "./dist/index.js",
			"types": "./dist/index.d.ts"
		}
	},
	"scripts": {
		"build": "tsc -p tsconfig.build.json",
		"install-lua": "bash scripts/install.sh"
	},
	"dependencies": {
		"@mariozechner/pi-coding-agent": "0.37.3",
		"@mariozechner/pi-ai": "0.37.3",
		"@sinclair/typebox": "^0.34.0"
	},
	"devDependencies": {
		"typescript": "^5.7.0"
	},
	"files": [
		"dist",
		"lua",
		"scripts"
	]
}
```

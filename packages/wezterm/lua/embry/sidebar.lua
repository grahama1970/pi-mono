-- embry/sidebar.lua — Sidebar workspace list + agent state display
-- Sends workspace entries and agent state to the native sidebar widget.
local wezterm = require("wezterm")
local state = require("embry.state")
local notifications = require("embry.notifications")

local M = {}

-- Workspace color/pin state (persisted per-session in Lua)
local workspace_colors = {}
local workspace_pinned = {}

-- Shorten model names for display
local MODEL_SHORT = {
	["claude-opus-4-6"] = "Opus 4.6",
	["claude-sonnet-4-6"] = "Sonnet 4.6",
	["claude-haiku-4-5-20251001"] = "Haiku 4.5",
}

local THINKING_LABELS = {
	off = "Off",
	minimal = "Minimal",
	low = "Low",
	medium = "Medium",
	high = "High",
	xhigh = "Extended",
}

local function shorten_model(name)
	if not name or name == "" then
		return "Unknown"
	end
	if MODEL_SHORT[name] then
		return MODEL_SHORT[name]
	end
	local short = name:gsub("^claude%-", ""):gsub("%-20%d+$", "")
	if #short > 16 then
		short = short:sub(1, 16)
	end
	return short
end

local function format_agent_content(agent)
	local lines = {}

	if not agent.online then
		table.insert(lines, "Status: Offline")
		return table.concat(lines, "\n")
	end

	if agent.isStreaming then
		table.insert(lines, "Status: Streaming...")
	else
		table.insert(lines, "Status: Ready")
	end

	table.insert(lines, "Model: " .. shorten_model(agent.currentModel))

	local thinking = agent.thinkingLevel or "off"
	table.insert(lines, "Thinking: " .. (THINKING_LABELS[thinking] or thinking))

	if agent.sessionName and agent.sessionName ~= "" then
		table.insert(lines, "Session: " .. agent.sessionName)
	end

	if agent.messageCount and agent.messageCount > 0 then
		table.insert(lines, "Messages: " .. tostring(agent.messageCount))
	end

	return table.concat(lines, "\n")
end

local function collect_workspaces(window)
	local mux_window = window:mux_window()
	if not mux_window then
		return {}
	end

	local active_workspace = mux_window:get_workspace()
	local all_workspaces = wezterm.mux.get_workspace_names()
	local entries = {}

	for i, ws_name in ipairs(all_workspaces) do
		table.insert(entries, {
			name = ws_name,
			color = workspace_colors[ws_name],
			pinned = workspace_pinned[ws_name] or false,
			order = i,
			unread_count = notifications.get_unread(ws_name),
			active = (ws_name == active_workspace),
		})
	end

	return entries
end

-- Public API for Lua scripts to set workspace colors
function M.set_workspace_color(name, color)
	workspace_colors[name] = color
end

function M.set_workspace_pinned(name, pinned)
	workspace_pinned[name] = pinned
end

function M.setup(_config)
	wezterm.on("update-status", function(window, _pane)
		-- Clear unread for the currently active workspace
		local mux_window = window:mux_window()
		if mux_window then
			local active_ws = mux_window:get_workspace()
			notifications.clear_unread(active_ws)
		end

		-- Update workspace list
		local ws_ok, entries = pcall(collect_workspaces, window)
		if ws_ok and entries then
			pcall(function()
				window:update_workspaces(entries)
			end)
		end

		-- Update agent state content
		local ok, agent = pcall(state.get)
		if ok then
			local content = format_agent_content(agent)
			pcall(function()
				window:set_sidebar_content(content)
			end)
		end
	end)
end

return M

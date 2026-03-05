-- embry/sidebar.lua — Sidebar content formatter for agent state display
-- Formats agent state into structured text for the WezTerm sidebar widget.
local wezterm = require("wezterm")
local state = require("embry.state")

local M = {}

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

local function format_sidebar_content(agent)
	local lines = {}

	-- Header
	table.insert(lines, "--- Embry Agent ---")
	table.insert(lines, "")

	if not agent.online then
		table.insert(lines, "Status: Offline")
		table.insert(lines, "")
		table.insert(lines, "Agent not running.")
		table.insert(lines, "Start with: pi --mode rpc")
		return table.concat(lines, "\n")
	end

	-- Status
	if agent.isStreaming then
		table.insert(lines, "Status: Streaming...")
	else
		table.insert(lines, "Status: Ready")
	end
	table.insert(lines, "")

	-- Model
	table.insert(lines, "Model: " .. shorten_model(agent.currentModel))

	-- Thinking level
	local thinking = agent.thinkingLevel or "off"
	table.insert(lines, "Thinking: " .. (THINKING_LABELS[thinking] or thinking))
	table.insert(lines, "")

	-- Session info
	if agent.sessionName and agent.sessionName ~= "" then
		table.insert(lines, "Session: " .. agent.sessionName)
	end
	if agent.sessionId and agent.sessionId ~= "" then
		local short_id = agent.sessionId:sub(1, 8)
		table.insert(lines, "ID: " .. short_id .. "...")
	end

	-- Message count
	if agent.messageCount and agent.messageCount > 0 then
		table.insert(lines, "Messages: " .. tostring(agent.messageCount))
	end

	return table.concat(lines, "\n")
end

function M.setup(_config)
	wezterm.on("update-status", function(window, _pane)
		local ok, agent = pcall(state.get)
		if not ok then
			return
		end
		local content = format_sidebar_content(agent)
		-- pcall: set_sidebar_content only exists on patched WezTerm builds
		local set_ok, err = pcall(function()
			window:set_sidebar_content(content)
		end)
		if not set_ok then
			wezterm.log_warn("embry sidebar: " .. tostring(err))
		end
	end)
end

return M

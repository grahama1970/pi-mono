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

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
		-- Note: user_vars.workspace requires shell integration (OSC 1337) which most shells don't set.
		-- Fall back to the tab's workspace field which WezTerm populates natively.
		local ws = (tab.active_pane.user_vars and tab.active_pane.user_vars.workspace)
			or tab.active_pane.workspace
			or nil
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

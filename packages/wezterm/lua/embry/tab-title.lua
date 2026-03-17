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
	-- Window title: "Pi Term - <cwd basename>" instead of default "$W"
	wezterm.on("format-window-title", function(tab, _pane, _tabs, _panes, _cfg)
		local pane = tab.active_pane
		local title = pane.title or ""
		-- Try to extract cwd basename for a clean title
		local url = pane.current_working_dir
		if url then
			local path = url.file_path or tostring(url)
			path = path:gsub("/$", "")
			local basename = path:match("([^/]+)$")
			if basename then
				return "Pi Term - " .. basename
			end
		end
		if title ~= "" then
			return "Pi Term - " .. truncate(title, 40)
		end
		return "Pi Term"
	end)

	wezterm.on("format-tab-title", function(tab, _tabs, _panes, _cfg, hover, _max_width)
		local pane = tab.active_pane
		local title = pane.title
		local icon = get_icon(pane)
		local index = tab.tab_index + 1

		-- Workspace prefix if not "default"
		local ws = (pane.user_vars and pane.user_vars.workspace) or nil
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

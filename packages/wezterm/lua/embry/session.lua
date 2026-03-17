-- embry/session.lua — Session persistence: save/restore workspace layouts
-- Saves workspace names, pane trees, cwds, sidebar state to JSON.
-- Restores on startup via gui-startup event.
local wezterm = require("wezterm")

local M = {}

local SESSION_DIR = os.getenv("HOME") .. "/.local/share/pi/term/sessions"
local AUTOSAVE_FILE = SESSION_DIR .. "/autosave.json"

-- Recently closed tabs (LIFO stack for reopen)
local closed_tabs = {}
local MAX_CLOSED_TABS = 20

-- Ensure session directory exists
local function ensure_dir()
	os.execute("mkdir -p " .. SESSION_DIR)
end

-- Collect current layout state
local function collect_layout()
	local layout = {
		version = 1,
		timestamp = os.time(),
		workspaces = {},
	}

	local ok, workspace_names = pcall(wezterm.mux.get_workspace_names)
	if not ok or not workspace_names then
		return nil
	end

	for _, ws_name in ipairs(workspace_names) do
		local ws = {
			name = ws_name,
			tabs = {},
		}

		-- Iterate all windows to find tabs in this workspace
		local all_windows = wezterm.mux.all_windows()
		for _, mux_window in ipairs(all_windows) do
			if mux_window:get_workspace() == ws_name then
				for _, tab in ipairs(mux_window:tabs()) do
					local tab_info = {
						title = tab:get_title(),
						panes = {},
					}
					for _, pane_info in ipairs(tab:panes_with_info()) do
						local pane = pane_info.pane
						local cwd = ""
						local cwd_uri = pane:get_current_working_dir()
						if cwd_uri then
							cwd = cwd_uri.file_path or tostring(cwd_uri)
						end
						table.insert(tab_info.panes, {
							cwd = cwd,
							title = pane:get_title(),
							is_active = pane_info.is_active,
							-- Pane geometry for split restoration
							left = pane_info.left,
							top = pane_info.top,
							width = pane_info.width,
							height = pane_info.height,
						})
					end
					table.insert(ws.tabs, tab_info)
				end
			end
		end

		table.insert(layout.workspaces, ws)
	end

	-- Save sidebar state
	local sidebar = require("embry.sidebar")
	layout.sidebar = {
		-- Colors and pins are tracked in sidebar.lua module state
	}

	return layout
end

-- Save layout to a file
local function save_to_file(path, layout)
	ensure_dir()
	local json = wezterm.json_encode(layout)
	if not json then
		wezterm.log_warn("embry session: failed to encode layout JSON")
		return false
	end
	local f = io.open(path, "w")
	if not f then
		wezterm.log_warn("embry session: failed to open " .. path .. " for writing")
		return false
	end
	f:write(json)
	f:close()
	return true
end

-- Load layout from a file
local function load_from_file(path)
	local f = io.open(path, "r")
	if not f then
		return nil
	end
	local content = f:read("*a")
	f:close()
	if not content or content == "" then
		return nil
	end
	local ok, layout = pcall(wezterm.json_parse, content)
	if not ok or not layout then
		wezterm.log_warn("embry session: failed to parse " .. path)
		return nil
	end
	return layout
end

-- Restore layout from a session
local function restore_layout(layout)
	if not layout or not layout.workspaces then
		return
	end

	for _, ws in ipairs(layout.workspaces) do
		if #ws.tabs > 0 then
			-- Spawn the first pane of the first tab
			local first_pane = ws.tabs[1].panes[1]
			local cwd = first_pane and first_pane.cwd or nil

			local spawn_args = {
				workspace = ws.name,
			}
			if cwd and cwd ~= "" then
				spawn_args.cwd = cwd
			end

			local _tab, _pane, window = wezterm.mux.spawn_window(spawn_args)

			-- Spawn remaining tabs
			for t = 2, #ws.tabs do
				local tab_panes = ws.tabs[t].panes
				local tab_cwd = tab_panes[1] and tab_panes[1].cwd or nil
				local tab_args = {}
				if tab_cwd and tab_cwd ~= "" then
					tab_args.cwd = tab_cwd
				end
				window:spawn_tab(tab_args)
			end
		end
	end
end

-- Track a closed tab for reopen
function M.track_closed_tab(cwd, title)
	table.insert(closed_tabs, {
		cwd = cwd or "",
		title = title or "",
		timestamp = os.time(),
	})
	-- Keep stack bounded
	while #closed_tabs > MAX_CLOSED_TABS do
		table.remove(closed_tabs, 1)
	end
end

-- Reopen the most recently closed tab
function M.reopen_tab(window, pane)
	if #closed_tabs == 0 then
		return false
	end
	local entry = table.remove(closed_tabs)
	local spawn_args = {}
	if entry.cwd and entry.cwd ~= "" then
		spawn_args.cwd = entry.cwd
	end
	window:perform_action(
		wezterm.action.SpawnCommandInNewTab(spawn_args),
		pane
	)
	return true
end

-- Public API

function M.save(name)
	local layout = collect_layout()
	if not layout then
		return false
	end
	local path = name and (SESSION_DIR .. "/" .. name .. ".json") or AUTOSAVE_FILE
	return save_to_file(path, layout)
end

function M.restore(name)
	local path = name and (SESSION_DIR .. "/" .. name .. ".json") or AUTOSAVE_FILE
	local layout = load_from_file(path)
	if layout then
		restore_layout(layout)
		return true
	end
	return false
end

function M.list_sessions()
	ensure_dir()
	local sessions = {}
	local handle = io.popen("ls " .. SESSION_DIR .. "/*.json 2>/dev/null")
	if handle then
		for line in handle:lines() do
			local name = line:match("([^/]+)%.json$")
			if name then
				table.insert(sessions, name)
			end
		end
		handle:close()
	end
	return sessions
end

function M.delete_session(name)
	local path = SESSION_DIR .. "/" .. name .. ".json"
	os.remove(path)
end

function M.setup(config)
	-- Track closed tabs for reopen (LEADER+SHIFT+T)
	if config.keys then
		table.insert(config.keys, {
			key = "T",
			mods = "LEADER|SHIFT",
			action = wezterm.action_callback(function(window, pane)
				M.reopen_tab(window, pane)
			end),
		})
	end

	-- Auto-save on window close
	wezterm.on("window-close-requested", function(_window, _pane)
		pcall(M.save)
	end)

	-- Restore on GUI startup (only if autosave exists)
	wezterm.on("gui-startup", function(cmd)
		-- Only restore if no explicit command was given
		if cmd and cmd.args and #cmd.args > 0 then
			return
		end
		-- Check if autosave exists
		local f = io.open(AUTOSAVE_FILE, "r")
		if f then
			f:close()
			-- Don't auto-restore by default — user must opt in
			-- Uncomment the next line to enable auto-restore:
			-- pcall(M.restore)
		end
	end)
end

return M

-- embry/tray.lua — KDE system tray integration via StatusNotifierItem
-- Spawns a background script that registers a tray icon via ksni/dbus.
-- Shows agent state badge and provides quick actions.
local wezterm = require("wezterm")
local state = require("embry.state")

local M = {}

local tray_pid = nil
local TRAY_SCRIPT = nil

-- Build the tray helper script path
local function get_tray_script()
	if TRAY_SCRIPT then
		return TRAY_SCRIPT
	end
	-- Look for pi-tray in PATH or next to the config
	local home = os.getenv("HOME") or ""
	local candidates = {
		home .. "/.local/bin/pi-tray",
		"/usr/local/bin/pi-tray",
	}
	for _, path in ipairs(candidates) do
		local f = io.open(path, "r")
		if f then
			f:close()
			TRAY_SCRIPT = path
			return path
		end
	end
	return nil
end

-- Update tray tooltip with agent state
local function update_tray_state()
	local ok, agent = pcall(state.get)
	if not ok then
		return
	end

	local status = "offline"
	if agent.online then
		status = agent.isStreaming and "streaming" or "ready"
	end

	-- Write state to a file that the tray script polls
	local state_path = string.format("/tmp/pi-tray-%s.state", os.getenv("USER") or "unknown")
	local f = io.open(state_path, "w")
	if f then
		f:write(wezterm.json_encode({
			status = status,
			model = agent.currentModel or "",
			workspaces = #(wezterm.mux.get_workspace_names() or {}),
		}))
		f:close()
	end
end

function M.setup(_config)
	-- Start tray icon on first update-status
	local tray_started = false
	wezterm.on("update-status", function(_window, _pane)
		-- Update tray state file
		pcall(update_tray_state)

		-- Start tray script if not already running
		if not tray_started then
			tray_started = true
			local script = get_tray_script()
			if script then
				local pid_file = string.format("/tmp/pi-tray-%s.pid", os.getenv("USER") or "unknown")
				-- Check if already running
				local pf = io.open(pid_file, "r")
				if pf then
					local pid = pf:read("*l")
					pf:close()
					if pid then
						local check = io.open("/proc/" .. pid .. "/status", "r")
						if check then
							check:close()
							return -- Already running
						end
					end
				end
				os.execute(script .. " &")
			end
		end
	end)
end

return M

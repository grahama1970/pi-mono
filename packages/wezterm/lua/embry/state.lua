-- embry/state.lua — D-Bus polling + signal file hybrid state cache
-- Primary: reads state from signal file written by signal-monitor.sh
-- Fallback: polls org.embry.Agent via busctl when signal file is stale.
local wezterm = require("wezterm")

local M = {}

local POLL_FAST = 0.5 -- seconds, when streaming
local POLL_NORMAL = 2 -- seconds, when idle
local POLL_OFFLINE = 5 -- seconds, when agent unreachable
local SIGNAL_STALE_THRESHOLD = 10 -- seconds before signal file is considered stale

local BUS_NAME = "org.embry.Agent"
local OBJECT_PATH = "/org/embry/Agent"
local INTERFACE = "org.embry.Agent"

local SIGNAL_FILE = "/tmp/embry-agent-state-" .. (os.getenv("USER") or "unknown")

local cached_state = nil
local last_poll = 0
local poll_interval = POLL_NORMAL
local consecutive_failures = 0
local monitor_spawned = false

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

local function parse_busctl_output(stdout)
	if not stdout or stdout == "" then
		return nil
	end

	-- Modern systemd: s "json"
	local json_str = stdout:match('^s "(.+)"')
	if not json_str then
		-- Older systemd: "json"
		json_str = stdout:match('^"(.+)"')
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

-- Try to read state from the signal monitor file
local function read_signal_file()
	local f = io.open(SIGNAL_FILE, "r")
	if not f then
		return nil, true -- no file, considered stale
	end
	local content = f:read("*a")
	f:close()

	if not content or content == "" then
		return nil, true
	end

	-- Check file freshness by parsing the timestamp from JSON
	local ok, signal = pcall(wezterm.json_parse, content)
	if not ok or not signal then
		return nil, true
	end

	local file_time = signal.timestamp or 0
	local now = os.time()
	local is_stale = (now - file_time) > SIGNAL_STALE_THRESHOLD

	return signal, is_stale
end

local function spawn_monitor()
	if monitor_spawned then
		return
	end
	monitor_spawned = true

	-- Find the signal-monitor.sh script relative to this lua file
	-- It's in the same directory as state.lua
	local script_dir = nil
	local has_debug, d = pcall(function() return debug.getinfo(1, "S").source:match("@(.*/)") end)
	if has_debug and d then script_dir = d else script_dir = wezterm.config_dir .. "/embry/" end
	
	if not script_dir then
		return
	end
	local script_path = script_dir .. "signal-monitor.sh"

	-- Check if file exists
	local f = io.open(script_path, "r")
	if not f then
		return
	end
	f:close()

	-- Spawn the monitor in the background
	wezterm.background_child_process({ "bash", script_path })
end

local function poll_busctl()
	local success, stdout, _stderr = wezterm.run_child_process({
		"busctl",
		"--user",
		"--timeout=10",
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
			return state
		end
	end
	return nil
end

function M.get()
	-- Use os.time() (wall-clock seconds) not os.clock() (CPU time).
	-- os.clock() doesn't advance during suspend/sleep, breaking cache interval logic.
	local now = os.time()
	if cached_state and (now - last_poll) < poll_interval then
		return cached_state
	end

	-- Ensure the background monitor is running
	spawn_monitor()

	-- Try signal file first (fast path: <1ms file read vs ~5ms busctl spawn)
	local signal, is_stale = read_signal_file()

	if signal and not is_stale then
		-- Signal file is fresh — extract state from it
		-- The signal file contains event data; we still need the full state
		-- from busctl for the complete picture, but we can use cached + signal
		-- to avoid busctl calls when things are actively updating
		if signal.body and type(signal.body) == "table" and signal.body.isStreaming ~= nil then
			-- Merge signal body into cached state to avoid losing fields
			-- that may not be present in every signal update
			local new_state = {}
			-- Start from OFFLINE_STATE defaults, then layer cached, then signal
			for k, v in pairs(OFFLINE_STATE) do new_state[k] = v end
			if cached_state then
				for k, v in pairs(cached_state) do new_state[k] = v end
			end
			for k, v in pairs(signal.body) do new_state[k] = v end
			new_state.online = true
			cached_state = new_state
			last_poll = now
			consecutive_failures = 0
			if signal.body.isStreaming then
				poll_interval = POLL_FAST
			else
				poll_interval = POLL_NORMAL
			end
			return cached_state
		end
		-- Signal exists but doesn't contain full state — still need busctl
		-- but we know the agent is alive, so no backoff
		consecutive_failures = 0
	end

	-- Fallback: poll via busctl
	local state = poll_busctl()
	if state then
		cached_state = state
		last_poll = now
		consecutive_failures = 0
		if state.isStreaming then
			poll_interval = POLL_FAST
		else
			poll_interval = POLL_NORMAL
		end
		return cached_state
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
	-- Reset backoff on manual invalidation
	consecutive_failures = 0
	poll_interval = POLL_NORMAL
end

return M

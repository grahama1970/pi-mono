-- embry/signals.lua — Event dispatcher for D-Bus signal streaming
-- Polls the signal file written by signal-monitor.sh and emits WezTerm events.
local wezterm = require("wezterm")
local state = require("embry.state")

local M = {}

local SIGNAL_FILE = "/tmp/embry-agent-state-" .. (os.getenv("USER") or "unknown")
local POLL_INTERVAL = 0.2 -- seconds

local last_signal_json = ""
local last_streaming = false
local timer_running = false

local function read_signal_file()
	local f = io.open(SIGNAL_FILE, "r")
	if not f then
		return nil
	end
	local content = f:read("*a")
	f:close()
	if not content or content == "" then
		return nil
	end
	return content
end

local function dispatch_events()
	local content = read_signal_file()
	if not content or content == last_signal_json then
		return
	end
	last_signal_json = content

	-- Parse the JSON signal
	local ok, signal = pcall(wezterm.json_parse, content)
	if not ok or not signal then
		return
	end

	-- Invalidate state cache so next state.get() reads fresh data
	state.invalidate()

	-- Emit events based on signal type (pcall to prevent listener errors killing the loop)
	local sig_name = signal.signal
	if sig_name == "PropertiesChanged" then
		pcall(wezterm.emit, "embry-state-changed")
	elseif sig_name == "MessageUpdate" then
		pcall(wezterm.emit, "embry-message-update", signal.body)
	elseif sig_name == "ToolExecution" then
		local tool_name = ""
		if type(signal.body) == "table" then
			tool_name = signal.body.tool or ""
		end
		pcall(wezterm.emit, "embry-tool-call", tool_name)
	elseif sig_name == "AgentEnd" then
		pcall(wezterm.emit, "embry-agent-end")
	elseif sig_name == "Error" then
		pcall(wezterm.emit, "embry-error", signal.body)
	elseif sig_name == "Ready" then
		pcall(wezterm.emit, "embry-ready")
	end

	-- Track streaming state transitions
	local agent = state.get()
	if agent.isStreaming and not last_streaming then
		pcall(wezterm.emit, "embry-streaming-start")
	elseif not agent.isStreaming and last_streaming then
		pcall(wezterm.emit, "embry-streaming-end")
	end
	last_streaming = agent.isStreaming
end

local function poll_loop()
	local ok, err = pcall(dispatch_events)
	if not ok then
		wezterm.log_warn("embry signals: dispatch error: " .. tostring(err))
	end
	-- Always re-schedule even if dispatch_events errored
	wezterm.time.call_after(POLL_INTERVAL, poll_loop)
end

function M.setup(_config)
	if timer_running then
		return
	end
	timer_running = true
	-- Start the recurring poll timer
	wezterm.time.call_after(POLL_INTERVAL, poll_loop)
end

return M

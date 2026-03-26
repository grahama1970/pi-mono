-- embry/browser.lua — Browser sidecar management for Pi Term
-- Spawns and controls pi-webview processes per workspace.
-- Uses X11 reparenting for visual embedding in the terminal window.
local wezterm = require("wezterm")

local M = {}

-- Per-workspace browser state: { socket_path, xid, url, title }
local browsers = {}

-- Config defaults
local config = {
	binary = "pi-webview",
	default_url = "about:blank",
	width_percent = 40,
	position = "right",
	allowed_hosts = {}, -- empty = allow all; e.g. {"localhost", "github.com", "google.com"}
}

function M.setup(opts)
	if opts then
		for k, v in pairs(opts) do
			config[k] = v
		end
	end
end

-- Get socket path for a workspace
local function socket_path(workspace)
	local user = os.getenv("USER") or "unknown"
	local safe_ws = workspace:gsub("[^%w%-_]", "_")
	return string.format("/tmp/pi-term-browser-%s-%s.sock", user, safe_ws)
end

-- Send a JSON command to the browser via its Unix socket
local function send_command(workspace, cmd_table)
	local sock = socket_path(workspace)
	local json = wezterm.json_encode(cmd_table)
	local ok, _, _ = pcall(wezterm.run_child_process, {
		"/bin/sh",
		"-c",
		string.format("echo '%s' | socat - UNIX-CONNECT:%s", json, sock),
	})
	return ok
end

-- Attempt X11 reparenting of browser window into WezTerm
local function try_reparent(workspace)
	local state = browsers[workspace]
	if not state or state.xid then
		return
	end
	-- Check events file for Ready event with XID
	local events_path = state.socket_path .. ".events"
	local f = io.open(events_path, "r")
	if not f then
		return
	end
	for line in f:lines() do
		local ok, event = pcall(wezterm.json_decode, line)
		if ok and event and event.event == "ready" and event.xid and event.xid > 0 then
			state.xid = event.xid
		end
	end
	f:close()

	if not state.xid then
		return
	end

	-- Reparent using xdotool
	local wt_success, wt_stdout, _ = wezterm.run_child_process({
		"xdotool",
		"search",
		"--name",
		"WezTerm",
	})
	if wt_success and wt_stdout then
		local wt_xid = wt_stdout:match("(%d+)")
		if wt_xid then
			wezterm.run_child_process({
				"xdotool",
				"windowreparent",
				tostring(state.xid),
				wt_xid,
			})
			wezterm.run_child_process({
				"xdotool",
				"windowmove",
				tostring(state.xid),
				"60%",
				"0",
			})
		end
	end
end

-- Open a browser in the current workspace
function M.open(window, url)
	local workspace = window:active_workspace()
	if not workspace then
		workspace = "default"
	end

	-- If already open, just navigate
	if browsers[workspace] then
		if url then
			send_command(workspace, { cmd = "navigate", url = url })
		end
		return browsers[workspace]
	end

	url = url or config.default_url
	local sock = socket_path(workspace)
	local safe_ws = workspace:gsub("[^%w%-_]", "_")

	-- Spawn pi-webview as a background process (non-blocking)
	local allow_hosts_flag = ""
	if config.allowed_hosts and #config.allowed_hosts > 0 then
		allow_hosts_flag = " --allow-hosts " .. table.concat(config.allowed_hosts, ",")
	end
	local cmd = string.format(
		"%s --socket %s --url %s%s > /tmp/pi-webview-%s.log 2>&1 &",
		config.binary,
		sock,
		url,
		allow_hosts_flag,
		safe_ws
	)
	os.execute(cmd)

	browsers[workspace] = {
		socket_path = sock,
		xid = nil,
		url = url,
		title = "",
	}

	-- Schedule reparenting attempt after webview starts up
	wezterm.time.call_after(1, function()
		try_reparent(workspace)
	end)

	return browsers[workspace]
end

-- Navigate to a URL
function M.navigate(window, url)
	local workspace = window:active_workspace() or "default"
	if browsers[workspace] then
		send_command(workspace, { cmd = "navigate", url = url })
		browsers[workspace].url = url
	end
end

-- Browser back
function M.back(window)
	local workspace = window:active_workspace() or "default"
	send_command(workspace, { cmd = "back" })
end

-- Browser forward
function M.forward(window)
	local workspace = window:active_workspace() or "default"
	send_command(workspace, { cmd = "forward" })
end

-- Browser reload
function M.reload(window)
	local workspace = window:active_workspace() or "default"
	send_command(workspace, { cmd = "reload" })
end

-- Close browser for workspace
function M.close(window)
	local workspace = window:active_workspace() or "default"
	if browsers[workspace] then
		send_command(workspace, { cmd = "close" })
		os.remove(browsers[workspace].socket_path)
		os.remove(browsers[workspace].socket_path .. ".events")
		browsers[workspace] = nil
	end
end

-- Execute JavaScript in the browser
function M.eval(window, js, id)
	local workspace = window:active_workspace() or "default"
	send_command(workspace, { cmd = "eval", js = js, id = id })
end

-- Take a DOM snapshot (returns HTML via events)
function M.snapshot(window, id)
	local workspace = window:active_workspace() or "default"
	send_command(workspace, { cmd = "snapshot", id = id })
end

-- Take a screenshot (saves to path)
function M.screenshot(window, path, id)
	local workspace = window:active_workspace() or "default"
	send_command(workspace, { cmd = "screenshot", path = path, id = id })
end

-- Click an element by CSS selector
function M.click(window, selector, id)
	local workspace = window:active_workspace() or "default"
	send_command(workspace, { cmd = "click", selector = selector, id = id })
end

-- Type text into a focused element
function M.type_text(window, selector, text, id)
	local workspace = window:active_workspace() or "default"
	send_command(workspace, { cmd = "type", selector = selector, text = text, id = id })
end

-- Get cookies from the browser
function M.get_cookies(window, id)
	local workspace = window:active_workspace() or "default"
	send_command(workspace, { cmd = "get_cookies", id = id })
end

-- Clear storage (localStorage, sessionStorage, cookies)
function M.clear_storage(window, id)
	local workspace = window:active_workspace() or "default"
	send_command(workspace, { cmd = "clear_storage", id = id })
end

-- Fill a form field
function M.fill(window, selector, value, id)
	local workspace = window:active_workspace() or "default"
	send_command(workspace, { cmd = "fill", selector = selector, value = value, id = id })
end

-- Open browser in a split pane (right or down)
function M.open_split(window, direction, url)
	local workspace = window:active_workspace()
	if not workspace then
		workspace = "default"
	end

	url = url or config.default_url
	local sock = socket_path(workspace)

	-- If already open, just navigate
	if browsers[workspace] then
		if url then
			send_command(workspace, { cmd = "navigate", url = url })
		end
		return browsers[workspace]
	end

	local safe_ws = workspace:gsub("[^%w%-_]", "_")
	local allow_hosts_flag = ""
	if config.allowed_hosts and #config.allowed_hosts > 0 then
		allow_hosts_flag = " --allow-hosts " .. table.concat(config.allowed_hosts, ",")
	end
	local cmd = string.format(
		"%s --socket %s --url %s%s > /tmp/pi-webview-%s.log 2>&1 &",
		config.binary,
		sock,
		url,
		allow_hosts_flag,
		safe_ws
	)
	os.execute(cmd)

	browsers[workspace] = {
		socket_path = sock,
		xid = nil,
		url = url,
		title = "",
		split_direction = direction or "right",
	}

	wezterm.time.call_after(1, function()
		try_reparent(workspace)
	end)

	return browsers[workspace]
end

-- Check if browser is open for workspace
function M.is_open(window)
	local workspace = window:active_workspace() or "default"
	return browsers[workspace] ~= nil
end

-- Get browser state for workspace
function M.get_state(window)
	local workspace = window:active_workspace() or "default"
	return browsers[workspace]
end

-- Poll events from the browser (call periodically from a timer)
function M.poll_events(workspace)
	if not browsers[workspace] then
		return nil
	end
	local events_path = browsers[workspace].socket_path .. ".events"
	local f = io.open(events_path, "r")
	if not f then
		return nil
	end
	local events = {}
	for line in f:lines() do
		local ok, event = pcall(wezterm.json_decode, line)
		if ok and event then
			table.insert(events, event)
			if event.event == "url_changed" then
				browsers[workspace].url = event.url
			elseif event.event == "title_changed" then
				browsers[workspace].title = event.title
			end
		end
	end
	f:close()
	-- Truncate after reading
	f = io.open(events_path, "w")
	if f then
		f:close()
	end
	return events
end

-- G3: Show git diff in browser for inline code review
function M.show_diff(window, diff_args)
	local workspace = window:active_workspace() or "default"

	-- Generate diff HTML
	local args = diff_args or ""
	local success, stdout, stderr = wezterm.run_child_process({
		"/bin/sh",
		"-c",
		string.format("cd '%s' && git diff %s 2>/dev/null", os.getenv("HOME") or "/tmp", args),
	})

	-- Also try the pane's cwd for the diff
	local pane = window:active_pane()
	if pane then
		local cwd = pane:get_current_working_dir()
		if cwd then
			local dir = cwd.file_path or tostring(cwd)
			if dir and dir ~= "" then
				success, stdout, stderr = wezterm.run_child_process({
					"/bin/sh",
					"-c",
					string.format("cd '%s' && git diff %s 2>/dev/null", dir, args),
				})
			end
		end
	end

	if not success or not stdout or stdout == "" then
		return false, "No diff output (clean working tree or not a git repo)"
	end

	-- Convert diff to HTML with syntax highlighting
	local html = [[<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Git Diff Review</title>
<style>
body { font-family: 'JetBrains Mono', monospace; font-size: 13px; background: #282a36; color: #f8f8f2; margin: 0; padding: 8px; }
.file-header { background: #44475a; padding: 6px 10px; margin-top: 12px; border-radius: 4px 4px 0 0; font-weight: bold; color: #bd93f9; }
.hunk-header { background: #363949; padding: 2px 10px; color: #6272a4; font-style: italic; }
.line { padding: 0 10px; white-space: pre-wrap; word-break: break-all; }
.add { background: rgba(80, 250, 123, 0.15); color: #50fa7b; }
.del { background: rgba(255, 85, 85, 0.15); color: #ff5555; }
.ctx { color: #6272a4; }
</style></head><body>]]

	for line in stdout:gmatch("[^\n]+") do
		local escaped = line:gsub("&", "&amp;"):gsub("<", "&lt;"):gsub(">", "&gt;")
		if line:match("^diff %-%-git") or line:match("^index ") then
			-- skip binary noise
		elseif line:match("^%-%-%- ") or line:match("^%+%+%+ ") then
			html = html .. '<div class="file-header">' .. escaped .. "</div>\n"
		elseif line:match("^@@") then
			html = html .. '<div class="hunk-header">' .. escaped .. "</div>\n"
		elseif line:match("^%+") then
			html = html .. '<div class="line add">' .. escaped .. "</div>\n"
		elseif line:match("^%-") then
			html = html .. '<div class="line del">' .. escaped .. "</div>\n"
		else
			html = html .. '<div class="line ctx">' .. escaped .. "</div>\n"
		end
	end
	html = html .. "</body></html>"

	-- Write to temp file and open in browser
	local user = os.getenv("USER") or "unknown"
	local diff_file = string.format("/tmp/pi-term-diff-%s.html", user)
	local f = io.open(diff_file, "w")
	if f then
		f:write(html)
		f:close()
	end

	-- Open or navigate browser to the diff
	local file_url = "file://" .. diff_file
	if browsers[workspace] then
		send_command(workspace, { cmd = "navigate", url = file_url })
	else
		M.open(window, file_url)
	end

	return true, "Diff loaded in browser"
end

return M

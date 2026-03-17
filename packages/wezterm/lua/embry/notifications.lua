-- embry/notifications.lua — Desktop notifications + unread state tracking
-- Uses notify-send (freedesktop) for KDE/GNOME desktop toasts.
-- Tracks per-workspace unread counts for sidebar badges.
local wezterm = require("wezterm")

local M = {}

-- Per-workspace unread counts (workspace_name -> count)
local unread_counts = {}
-- Last notification time per workspace (for suppression dedup)
local last_notify_time = {}
-- Minimum interval between desktop toasts for the same workspace (seconds)
local DEDUP_INTERVAL = 5

-- Custom notification command (set via config)
local custom_notify_command = nil

function M.set_custom_command(cmd)
	custom_notify_command = cmd
end

-- Check if a workspace is currently active (visible to user)
local function is_workspace_active(workspace_name)
	local ok, names = pcall(wezterm.mux.get_workspace_names)
	if not ok then
		return false
	end
	-- The active workspace is the first one returned by the mux
	-- We need to check via the active workspace API
	local active = wezterm.mux.get_active_workspace and wezterm.mux.get_active_workspace()
	return active == workspace_name
end

-- Send a desktop notification via notify-send (freedesktop)
local function send_desktop_notification(title, body, urgency)
	urgency = urgency or "normal"
	local args = {
		"notify-send",
		"--app-name=Pi Term",
		"--urgency=" .. urgency,
		title,
		body or "",
	}
	pcall(wezterm.run_child_process, args)
end

-- Send via custom command if configured
local function send_custom_notification(title, body, workspace)
	if not custom_notify_command then
		return
	end
	local env = {
		PI_TERM_NOTIFICATION_TITLE = title,
		PI_TERM_NOTIFICATION_BODY = body or "",
		PI_TERM_NOTIFICATION_WORKSPACE = workspace or "",
	}
	-- Build env prefix for the shell command
	local env_str = ""
	for k, v in pairs(env) do
		env_str = env_str .. k .. "=" .. wezterm.shell_quote_arg(v) .. " "
	end
	pcall(wezterm.run_child_process, { "/bin/sh", "-c", env_str .. custom_notify_command })
end

-- Public API: send a notification
-- Handles suppression, dedup, desktop toast, and custom command
function M.notify(opts)
	local title = opts.title or "Pi Term"
	local body = opts.body or ""
	local workspace = opts.workspace
	local urgency = opts.urgency or "normal"

	-- Increment unread count for the workspace
	if workspace then
		unread_counts[workspace] = (unread_counts[workspace] or 0) + 1
	end

	-- Suppression: don't toast if workspace is currently active and window is focused
	if workspace and is_workspace_active(workspace) then
		return
	end

	-- Dedup: don't toast if we just sent one for this workspace
	if workspace then
		local now = os.time()
		local last = last_notify_time[workspace] or 0
		if (now - last) < DEDUP_INTERVAL then
			return
		end
		last_notify_time[workspace] = now
	end

	-- Send desktop notification
	send_desktop_notification(title, body, urgency)

	-- Send via custom command if configured
	send_custom_notification(title, body, workspace)
end

-- Get unread count for a workspace
function M.get_unread(workspace)
	return unread_counts[workspace] or 0
end

-- Clear unread count for a workspace (called on workspace switch)
function M.clear_unread(workspace)
	unread_counts[workspace] = 0
end

-- Clear all unread counts
function M.clear_all()
	unread_counts = {}
end

-- Get workspace with most recent/highest unread count
function M.most_unread_workspace()
	local max_count = 0
	local max_ws = nil
	for ws, count in pairs(unread_counts) do
		if count > max_count then
			max_count = count
			max_ws = ws
		end
	end
	return max_ws, max_count
end

function M.setup(config)
	-- Read custom notification command from config
	if config.notification_command then
		custom_notify_command = config.notification_command
	end

	-- Listen for embry signal events and auto-notify
	wezterm.on("embry-agent-end", function()
		-- Agent finished — notify if workspace is not active
		local active = wezterm.mux.get_active_workspace and wezterm.mux.get_active_workspace()
		-- Notify all non-active workspaces that have agents
		M.notify({
			title = "Agent Complete",
			body = "Agent has finished processing",
			workspace = active,
		})
	end)

	-- Listen for OSC 777/9 toast notifications from terminal programs
	-- This increments unread counts for the workspace containing the pane
	wezterm.on("toast-notification", function(window, pane)
		local ws = window:active_workspace()
		if ws then
			-- The toast was already shown by the Rust handler;
			-- we just need to track unread state for the sidebar
			local active = wezterm.mux.get_active_workspace and wezterm.mux.get_active_workspace()
			if ws ~= active then
				unread_counts[ws] = (unread_counts[ws] or 0) + 1
			end
		end
	end)

	wezterm.on("embry-error", function(err_body)
		local msg = type(err_body) == "string" and err_body or "Agent error occurred"
		local active = wezterm.mux.get_active_workspace and wezterm.mux.get_active_workspace()
		M.notify({
			title = "Agent Error",
			body = msg,
			workspace = active,
			urgency = "critical",
		})
	end)
end

return M

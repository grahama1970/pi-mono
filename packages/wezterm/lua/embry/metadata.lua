-- embry/metadata.lua — Per-workspace metadata collectors
-- Collects git branch, cwd, listening ports for sidebar display.
local wezterm = require("wezterm")

local M = {}

-- Per-workspace metadata cache (workspace_name -> table)
local workspace_meta = {}
local BRANCH_POLL_INTERVAL = 5 -- seconds
local timer_running = false

-- Read git branch from a directory's .git/HEAD
local function read_git_branch(cwd)
	if not cwd or cwd == "" then
		return nil
	end
	local f = io.open(cwd .. "/.git/HEAD", "r")
	if not f then
		return nil
	end
	local content = f:read("*l")
	f:close()
	if not content then
		return nil
	end
	-- "ref: refs/heads/main" -> "main"
	local branch = content:match("^ref: refs/heads/(.+)$")
	if branch then
		return branch
	end
	-- Detached HEAD: return short SHA
	if #content >= 7 then
		return content:sub(1, 7)
	end
	return nil
end

-- Get metadata for a workspace
function M.get(workspace)
	return workspace_meta[workspace] or {}
end

-- Set metadata fields for a workspace
function M.set(workspace, fields)
	if not workspace_meta[workspace] then
		workspace_meta[workspace] = {}
	end
	for k, v in pairs(fields) do
		workspace_meta[workspace][k] = v
	end
end

-- Format metadata for sidebar display (newline-delimited)
function M.format_for_sidebar(workspace)
	local meta = workspace_meta[workspace]
	if not meta then
		return nil
	end
	local parts = {}
	if meta.git_branch and meta.git_branch ~= "" then
		table.insert(parts, " " .. meta.git_branch)
	end
	if meta.cwd and meta.cwd ~= "" then
		-- Truncate long paths
		local short_cwd = meta.cwd:match("([^/]+)$") or meta.cwd
		table.insert(parts, " " .. short_cwd)
	end
	if meta.progress_pct then
		local bar_len = 10
		local filled = math.floor(meta.progress_pct / 100 * bar_len)
		local bar = string.rep("#", filled) .. string.rep("-", bar_len - filled)
		table.insert(parts, "[" .. bar .. "] " .. meta.progress_pct .. "%")
	end
	if #parts == 0 then
		return nil
	end
	return table.concat(parts, "  ")
end

function M.setup(_config)
	if timer_running then
		return
	end
	timer_running = true

	-- Periodically collect git branch info from active pane cwds
	local function poll_metadata()
		local ok, err = pcall(function()
			local all_workspaces = wezterm.mux.get_workspace_names()
			for _, ws_name in ipairs(all_workspaces) do
				-- Try to get the active pane's cwd for this workspace
				-- (We can only easily get the active pane for the current workspace)
				if not workspace_meta[ws_name] then
					workspace_meta[ws_name] = {}
				end
			end

			-- For the active workspace, read git branch from the focused pane
			local active_ws = wezterm.mux.get_active_workspace and wezterm.mux.get_active_workspace()
			if active_ws then
				local pane = wezterm.mux.get_active_pane and wezterm.mux.get_active_pane()
				if pane then
					local cwd_uri = pane:get_current_working_dir()
					if cwd_uri then
						local cwd = cwd_uri.file_path or tostring(cwd_uri)
						if not workspace_meta[active_ws] then
							workspace_meta[active_ws] = {}
						end
						workspace_meta[active_ws].cwd = cwd
						workspace_meta[active_ws].git_branch = read_git_branch(cwd)
					end
				end
			end
		end)
		if not ok then
			wezterm.log_warn("embry metadata: poll error: " .. tostring(err))
		end
		wezterm.time.call_after(BRANCH_POLL_INTERVAL, poll_metadata)
	end

	wezterm.time.call_after(BRANCH_POLL_INTERVAL, poll_metadata)
end

return M

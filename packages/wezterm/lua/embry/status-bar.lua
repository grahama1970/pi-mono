-- embry/status-bar.lua — update-status handler
-- Design Board spec (Round 5):
--   Left:   π-term │ git branch │ pi-mono state
--   Right:  cwd | session
local wezterm = require("wezterm")
local state = require("embry.state")

local M = {}

local MODEL_SHORT = {
	["claude-opus-4-6"] = "opus",
	["claude-sonnet-4-6"] = "sonnet",
	["claude-haiku-4-5-20251001"] = "haiku",
}

local function shorten_model(name)
	if not name or name == "" then return "?" end
	if MODEL_SHORT[name] then return MODEL_SHORT[name] end
	local short = name:gsub("^claude%-", ""):gsub("%-20%d+$", "")
	if #short > 12 then short = short:sub(1, 12) end
	return short
end

-- Git branch for current pane cwd
local function git_branch(pane)
	local url = pane:get_current_working_dir()
	if not url then return nil end
	local path = url.file_path or tostring(url)
	local ok, stdout = pcall(function()
		local success, out, _ = wezterm.run_child_process({ "git", "-C", path, "rev-parse", "--abbrev-ref", "HEAD" })
		if success then return out end
		return nil
	end)
	if ok and stdout and stdout ~= "" then
		return stdout:gsub("%s+$", "")
	end
	return nil
end

local function short_cwd(pane)
	local url = pane:get_current_working_dir()
	if not url then return nil end
	local path = url.file_path or tostring(url)
	path = path:gsub("/$", "")
	return path:match("([^/]+)$") or path
end

function M.setup(config)
	wezterm.on("update-status", function(window, pane)
		local agent = state.get()

		-- ── LEFT : π │ git branch │ agent state ────────────────────
		local left = {}

		table.insert(left, { Foreground = { Color = "#bd93f9" } })
		table.insert(left, { Text = " π " })
		table.insert(left, { Foreground = { Color = "#00e5cc" } })
		table.insert(left, { Text = "│ " })

		local branch = git_branch(pane)
		if branch then
			table.insert(left, { Foreground = { Color = "#50fa7b" } })
			table.insert(left, { Text = " " .. branch .. " " })
			table.insert(left, { Foreground = { Color = "#6272a4" } })
			table.insert(left, { Text = "│ " })
		end

		if not agent.online then
			table.insert(left, { Foreground = { Color = "#6272a4" } })
			table.insert(left, { Text = "pi-mono offline " })
		else
			table.insert(left, { Foreground = { Color = "#8be9fd" } })
			if agent.isStreaming then
				table.insert(left, { Text = "pi-mono thinking… " })
			else
				table.insert(left, { Text = "pi-mono idle " })
			end
			table.insert(left, { Foreground = { Color = "#6272a4" } })
			table.insert(left, { Text = shorten_model(agent.currentModel) .. " " })
		end

		window:set_left_status(wezterm.format(left))

		-- ── RIGHT : cwd | session ────────────────────────────────────
		local right = {}

		local cwd = short_cwd(pane)
		if cwd then
			table.insert(right, { Foreground = { Color = "#6272a4" } })
			table.insert(right, { Text = " " })
			table.insert(right, { Foreground = { Color = "#f8f8f2" } })
			table.insert(right, { Text = cwd })
		end

		if agent.online then
			if agent.sessionName and agent.sessionName ~= "" then
				table.insert(right, { Foreground = { Color = "#bd93f9" } })
				table.insert(right, { Text = " | " .. agent.sessionName })
			end
			if agent.messageCount and agent.messageCount > 0 then
				table.insert(right, { Foreground = { Color = "#6272a4" } })
				table.insert(right, { Text = " [" .. agent.messageCount .. "]" })
			end
		end

		table.insert(right, { Text = " " })
		window:set_right_status(wezterm.format(right))
	end)
end

return M

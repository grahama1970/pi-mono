-- embry/keybindings.lua — Pane navigation, workspace management, + agent interaction keybindings
-- CTRL+A leader (tmux-style), plus agent ask/steer/abort shortcuts.
local wezterm = require("wezterm")
local act = wezterm.action

local M = {}

-- Pi CLI for agent communication (pi -p for single-shot prompts)
local PI_CMD = "pi"

function M.setup(config)
	config.leader = { key = "a", mods = "CTRL", timeout_milliseconds = 1000 }

	config.keys = {
		-- === Pane splitting ===
		{ key = "|", mods = "LEADER|SHIFT", action = act.SplitHorizontal({ domain = "CurrentPaneDomain" }) },
		{ key = "-", mods = "LEADER", action = act.SplitVertical({ domain = "CurrentPaneDomain" }) },

		-- === Pane navigation ===
		{ key = "h", mods = "LEADER", action = act.ActivatePaneDirection("Left") },
		{ key = "j", mods = "LEADER", action = act.ActivatePaneDirection("Down") },
		{ key = "k", mods = "LEADER", action = act.ActivatePaneDirection("Up") },
		{ key = "l", mods = "LEADER", action = act.ActivatePaneDirection("Right") },

		-- === Pane resize ===
		{ key = "H", mods = "LEADER|SHIFT", action = act.AdjustPaneSize({ "Left", 5 }) },
		{ key = "J", mods = "LEADER|SHIFT", action = act.AdjustPaneSize({ "Down", 5 }) },
		{ key = "K", mods = "LEADER|SHIFT", action = act.AdjustPaneSize({ "Up", 5 }) },
		{ key = "L", mods = "LEADER|SHIFT", action = act.AdjustPaneSize({ "Right", 5 }) },

		-- === Pane zoom ===
		{ key = "z", mods = "LEADER", action = act.TogglePaneZoomState },

		-- === Tab management ===
		{ key = "t", mods = "LEADER", action = act.SpawnTab("CurrentPaneDomain") },
		{ key = "n", mods = "LEADER", action = act.ActivateTabRelative(1) },
		{ key = "p", mods = "LEADER", action = act.ActivateTabRelative(-1) },

		-- === Workspace management ===
		-- LEADER+c: new workspace (prompts for name)
		{
			key = "c",
			mods = "LEADER",
			action = act.PromptInputLine({
				description = "New workspace name:",
				action = wezterm.action_callback(function(window, _pane, line)
					if line and line ~= "" then
						window:perform_action(
							act.SwitchToWorkspace({ name = line }),
							_pane
						)
					end
				end),
			}),
		},
		-- LEADER+w: close current workspace (confirm)
		{
			key = "w",
			mods = "LEADER",
			action = wezterm.action_callback(function(window, pane)
				local workspace = pane:get_domain_name() ~= "" and pane:get_domain_name() or "default"
				-- Get workspace from mux
				local mux_window = window:mux_window()
				if mux_window then
					workspace = mux_window:get_workspace()
				end
				window:perform_action(
					act.PromptInputLine({
						description = "Close workspace '" .. workspace .. "'? (y/n):",
						action = wezterm.action_callback(function(w, p, line)
							if line == "y" or line == "Y" then
								-- Close all tabs in this workspace
								local mw = w:mux_window()
								if mw then
									for _, tab in ipairs(mw:tabs()) do
										tab:activate()
										for _, pn in ipairs(tab:panes()) do
											pn:move_to_new_window()
										end
									end
								end
							end
						end),
					}),
					pane
				)
			end),
		},
		-- LEADER+,: rename workspace
		{
			key = ",",
			mods = "LEADER",
			action = act.PromptInputLine({
				description = "Rename workspace to:",
				action = wezterm.action_callback(function(window, pane, line)
					if line and line ~= "" then
						local mux_window = window:mux_window()
						if mux_window then
							mux_window:set_workspace(line)
						end
					end
				end),
			}),
		},
		-- LEADER+1-9: switch to workspace by index
		{ key = "1", mods = "LEADER", action = act.SwitchWorkspaceRelative(0) },
		{ key = "2", mods = "LEADER", action = act.SwitchWorkspaceRelative(1) },
		{ key = "3", mods = "LEADER", action = act.SwitchWorkspaceRelative(2) },
		{ key = "4", mods = "LEADER", action = act.SwitchWorkspaceRelative(3) },
		{ key = "5", mods = "LEADER", action = act.SwitchWorkspaceRelative(4) },
		{ key = "6", mods = "LEADER", action = act.SwitchWorkspaceRelative(5) },
		{ key = "7", mods = "LEADER", action = act.SwitchWorkspaceRelative(6) },
		{ key = "8", mods = "LEADER", action = act.SwitchWorkspaceRelative(7) },
		{ key = "9", mods = "LEADER", action = act.SwitchWorkspaceRelative(8) },
		-- LEADER+s: workspace switcher (fuzzy)
		{ key = "s", mods = "LEADER", action = act.ShowLauncherArgs({ flags = "FUZZY|WORKSPACES" }) },
		-- LEADER+u: jump to workspace with most unread notifications
		{
			key = "u",
			mods = "LEADER",
			action = wezterm.action_callback(function(window, pane)
				local notifications = require("embry.notifications")
				local ws, count = notifications.most_unread_workspace()
				if ws and count > 0 then
					window:perform_action(act.SwitchToWorkspace({ name = ws }), pane)
				end
			end),
		},

		-- === Browser sidecar ===
		-- LEADER+b: toggle browser
		{
			key = "b",
			mods = "LEADER",
			action = wezterm.action_callback(function(window, pane)
				local browser = require("embry.browser")
				if browser.is_open(window) then
					browser.close(window)
				else
					browser.open(window)
				end
			end),
		},
		-- LEADER+g: navigate browser (go to URL)
		{
			key = "g",
			mods = "LEADER",
			action = wezterm.action_callback(function(window, pane)
				local browser = require("embry.browser")
				window:perform_action(
					act.PromptInputLine({
						description = "Navigate to URL:",
						action = wezterm.action_callback(function(w, p, url)
							if url and url ~= "" then
								if not url:match("^https?://") then
									url = "https://" .. url
								end
								if browser.is_open(w) then
									browser.navigate(w, url)
								else
									browser.open(w, url)
								end
							end
						end),
					}),
					pane
				)
			end),
		},

		-- LEADER+d: show git diff in browser for review
		{
			key = "d",
			mods = "LEADER",
			action = wezterm.action_callback(function(window, pane)
				local browser = require("embry.browser")
				local ok, msg = browser.show_diff(window)
				if not ok then
					window:toast_notification("Pi Term", msg or "No diff available", nil, 3000)
				end
			end),
		},

		-- LEADER+D: show staged diff (git diff --cached)
		{
			key = "D",
			mods = "LEADER|SHIFT",
			action = wezterm.action_callback(function(window, pane)
				local browser = require("embry.browser")
				local ok, msg = browser.show_diff(window, "--cached")
				if not ok then
					window:toast_notification("Pi Term", msg or "No staged diff", nil, 3000)
				end
			end),
		},

		-- LEADER+SHIFT+B: split browser right
		{
			key = "B",
			mods = "LEADER|SHIFT",
			action = wezterm.action_callback(function(window, pane)
				local browser = require("embry.browser")
				browser.open_split(window, "right")
			end),
		},

		-- === Sidebar focus toggle ===
		-- LEADER+e: toggle sidebar focus / visibility
		{
			key = "e",
			mods = "LEADER",
			action = wezterm.action_callback(function(window, _pane)
				local overrides = window:get_config_overrides() or {}
				local current = overrides.enable_sidebar
				if current == nil then
					current = true
				end
				overrides.enable_sidebar = not current
				window:set_config_overrides(overrides)
			end),
		},

		-- LEADER+0: pure terminal mode — collapse all panels
		{
			key = "0",
			mods = "LEADER",
			action = wezterm.action_callback(function(window, _pane)
				local overrides = window:get_config_overrides() or {}
				overrides.enable_sidebar = false
				window:set_config_overrides(overrides)
			end),
		},

		-- === Close pane ===
		{ key = "x", mods = "LEADER", action = act.CloseCurrentPane({ confirm = true }) },

		-- === Copy mode ===
		{ key = "[", mods = "LEADER", action = act.ActivateCopyMode },

		-- === Agent interaction ===

		-- LEADER+Enter: open inline Pi chat pane at bottom (or focus existing one)
		{
			key = "Enter",
			mods = "LEADER",
			action = wezterm.action_callback(function(window, pane)
				-- Look for an existing Pi pane in this tab
				local tab = pane:tab()
				if tab then
					for _, p in ipairs(tab:panes()) do
						local title = p:get_title()
						if title and title:match("^pi") then
							p:activate()
							return
						end
					end
				end
				-- No existing Pi pane — split bottom 30% and launch Pi chat
				pane:split({
					direction = "Bottom",
					size = 0.3,
					args = { "pi", "--mode", "chat" },
				})
			end),
		},

		-- Ask agent: opens input prompt, sends to Pi
		{
			key = "a",
			mods = "CTRL|SHIFT",
			action = act.PromptInputLine({
				description = "Ask the agent:",
				action = wezterm.action_callback(function(_window, _pane, line)
					if line and line ~= "" then
						wezterm.run_child_process({
							PI_CMD, "-p", line,
						})
					end
				end),
			}),
		},

		-- Steer agent: send mid-run steering message
		{
			key = "s",
			mods = "CTRL|SHIFT",
			action = act.PromptInputLine({
				description = "Steer the agent:",
				action = wezterm.action_callback(function(_window, _pane, line)
					if line and line ~= "" then
						wezterm.run_child_process({
							PI_CMD, "-p", "steer: " .. line,
						})
					end
				end),
			}),
		},

		-- Follow-up: send a follow-up after agent completes
		{
			key = "f",
			mods = "CTRL|SHIFT",
			action = act.PromptInputLine({
				description = "Follow-up with agent:",
				action = wezterm.action_callback(function(_window, _pane, line)
					if line and line ~= "" then
						wezterm.run_child_process({
							PI_CMD, "-p", line,
						})
					end
				end),
			}),
		},

		-- Abort agent
		{
			key = "q",
			mods = "CTRL|SHIFT",
			action = wezterm.action_callback(function(_window, _pane)
				wezterm.run_child_process({ PI_CMD, "-p", "abort current task" })
			end),
		},
	}
end

return M

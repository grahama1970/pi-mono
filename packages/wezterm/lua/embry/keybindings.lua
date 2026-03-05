-- embry/keybindings.lua — Pane navigation, workspace management, + agent interaction keybindings
-- CTRL+A leader (tmux-style), plus agent ask/steer/abort shortcuts.
local wezterm = require("wezterm")
local act = wezterm.action

local M = {}

-- Bridge script (installed to ~/.local/bin by install.sh)
local BRIDGE = "embry-wezterm-bridge"

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

		-- === Close pane ===
		{ key = "x", mods = "LEADER", action = act.CloseCurrentPane({ confirm = true }) },

		-- === Copy mode ===
		{ key = "[", mods = "LEADER", action = act.ActivateCopyMode },

		-- === Agent interaction ===

		-- Ask agent: opens input prompt, sends via D-Bus
		{
			key = "a",
			mods = "CTRL|SHIFT",
			action = act.PromptInputLine({
				description = "Ask the agent:",
				action = wezterm.action_callback(function(_window, _pane, line)
					if line and line ~= "" then
						wezterm.run_child_process({
							BRIDGE, "ask", line,
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
							BRIDGE, "steer", line,
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
							BRIDGE, "followup", line,
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
				wezterm.run_child_process({ BRIDGE, "abort" })
			end),
		},
	}
end

return M

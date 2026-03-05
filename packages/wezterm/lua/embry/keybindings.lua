-- embry/keybindings.lua — Pane navigation + agent interaction keybindings
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
		{ key = "c", mods = "LEADER", action = act.SpawnTab("CurrentPaneDomain") },
		{ key = "n", mods = "LEADER", action = act.ActivateTabRelative(1) },
		{ key = "p", mods = "LEADER", action = act.ActivateTabRelative(-1) },

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

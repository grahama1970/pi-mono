-- embry/palette.lua — Command palette with searchable actions and shortcut hints
local wezterm = require("wezterm")
local act = wezterm.action

local M = {}

-- Build the palette action list with keybinding hints
local function build_palette_choices()
	return {
		{ id = "new_workspace", label = "New Workspace                    LEADER+c" },
		{ id = "switch_workspace", label = "Switch Workspace (fuzzy)         LEADER+s" },
		{ id = "rename_workspace", label = "Rename Workspace                 LEADER+," },
		{ id = "close_workspace", label = "Close Workspace                  LEADER+w" },
		{ id = "jump_unread", label = "Jump to Unread                   LEADER+u" },
		{ id = "split_right", label = "Split Pane Right                 LEADER+|" },
		{ id = "split_down", label = "Split Pane Down                  LEADER+-" },
		{ id = "close_pane", label = "Close Pane                       LEADER+x" },
		{ id = "zoom_pane", label = "Toggle Zoom                      LEADER+z" },
		{ id = "new_tab", label = "New Tab                          LEADER+t" },
		{ id = "copy_mode", label = "Copy Mode                        LEADER+[" },
		{ id = "toggle_sidebar", label = "Toggle Sidebar" },
		{ id = "open_vscode", label = "Open in VS Code" },
		{ id = "open_cursor", label = "Open in Cursor" },
		{ id = "open_kate", label = "Open in Kate" },
		{ id = "open_nvim", label = "Open in Neovim" },
		{ id = "reload_config", label = "Reload Configuration" },
		{ id = "agent_ask", label = "Ask Agent                        CTRL+SHIFT+a" },
		{ id = "agent_steer", label = "Steer Agent                      CTRL+SHIFT+s" },
		{ id = "agent_abort", label = "Abort Agent                      CTRL+SHIFT+q" },
		{ id = "save_session", label = "Save Session" },
		{ id = "save_session_as", label = "Save Session As..." },
		{ id = "restore_session", label = "Restore Session..." },
	}
end

-- Execute a palette action
local function execute_action(window, pane, action_id)
	if action_id == "new_workspace" then
		window:perform_action(
			act.PromptInputLine({
				description = "New workspace name:",
				action = wezterm.action_callback(function(w, p, line)
					if line and line ~= "" then
						w:perform_action(act.SwitchToWorkspace({ name = line }), p)
					end
				end),
			}),
			pane
		)
	elseif action_id == "switch_workspace" then
		window:perform_action(act.ShowLauncherArgs({ flags = "FUZZY|WORKSPACES" }), pane)
	elseif action_id == "rename_workspace" then
		window:perform_action(
			act.PromptInputLine({
				description = "Rename workspace to:",
				action = wezterm.action_callback(function(w, p, line)
					if line and line ~= "" then
						local mw = w:mux_window()
						if mw then
							mw:set_workspace(line)
						end
					end
				end),
			}),
			pane
		)
	elseif action_id == "close_workspace" then
		window:perform_action(act.CloseCurrentPane({ confirm = true }), pane)
	elseif action_id == "jump_unread" then
		local notifications = require("embry.notifications")
		local ws, count = notifications.most_unread_workspace()
		if ws and count > 0 then
			window:perform_action(act.SwitchToWorkspace({ name = ws }), pane)
		end
	elseif action_id == "split_right" then
		window:perform_action(act.SplitHorizontal({ domain = "CurrentPaneDomain" }), pane)
	elseif action_id == "split_down" then
		window:perform_action(act.SplitVertical({ domain = "CurrentPaneDomain" }), pane)
	elseif action_id == "close_pane" then
		window:perform_action(act.CloseCurrentPane({ confirm = true }), pane)
	elseif action_id == "zoom_pane" then
		window:perform_action(act.TogglePaneZoomState, pane)
	elseif action_id == "new_tab" then
		window:perform_action(act.SpawnTab("CurrentPaneDomain"), pane)
	elseif action_id == "copy_mode" then
		window:perform_action(act.ActivateCopyMode, pane)
	elseif action_id == "toggle_sidebar" then
		-- Toggle sidebar via config override
		local overrides = window:get_config_overrides() or {}
		overrides.enable_sidebar = not (overrides.enable_sidebar ~= false)
		window:set_config_overrides(overrides)
	elseif action_id == "open_vscode" then
		local cwd = pane:get_current_working_dir()
		if cwd then
			wezterm.run_child_process({ "code", tostring(cwd.file_path or cwd) })
		end
	elseif action_id == "open_cursor" then
		local cwd = pane:get_current_working_dir()
		if cwd then
			wezterm.run_child_process({ "cursor", tostring(cwd.file_path or cwd) })
		end
	elseif action_id == "open_kate" then
		local cwd = pane:get_current_working_dir()
		if cwd then
			wezterm.run_child_process({ "kate", tostring(cwd.file_path or cwd) })
		end
	elseif action_id == "open_nvim" then
		window:perform_action(
			act.SpawnCommandInNewTab({
				args = { "nvim", "." },
			}),
			pane
		)
	elseif action_id == "reload_config" then
		wezterm.reload_configuration()
	elseif action_id == "agent_ask" then
		window:perform_action(
			act.PromptInputLine({
				description = "Ask the agent:",
				action = wezterm.action_callback(function(_w, _p, line)
					if line and line ~= "" then
						wezterm.run_child_process({ "embry-wezterm-bridge", "ask", line })
					end
				end),
			}),
			pane
		)
	elseif action_id == "agent_steer" then
		window:perform_action(
			act.PromptInputLine({
				description = "Steer the agent:",
				action = wezterm.action_callback(function(_w, _p, line)
					if line and line ~= "" then
						wezterm.run_child_process({ "embry-wezterm-bridge", "steer", line })
					end
				end),
			}),
			pane
		)
	elseif action_id == "agent_abort" then
		wezterm.run_child_process({ "embry-wezterm-bridge", "abort" })
	elseif action_id == "save_session" then
		local session = require("embry.session")
		session.save()
	elseif action_id == "save_session_as" then
		window:perform_action(
			act.PromptInputLine({
				description = "Session name:",
				action = wezterm.action_callback(function(_w, _p, line)
					if line and line ~= "" then
						local session = require("embry.session")
						session.save(line)
					end
				end),
			}),
			pane
		)
	elseif action_id == "restore_session" then
		local session = require("embry.session")
		local sessions = session.list_sessions()
		if #sessions > 0 then
			local choices = {}
			for _, name in ipairs(sessions) do
				table.insert(choices, { id = name, label = name })
			end
			window:perform_action(
				act.InputSelector({
					title = "Restore Session",
					choices = choices,
					fuzzy = true,
					action = wezterm.action_callback(function(_w, _p, id)
						if id then
							session.restore(id)
						end
					end),
				}),
				pane
			)
		end
	end
end

function M.setup(config)
	-- Add LEADER+P keybinding for command palette
	if config.keys then
		table.insert(config.keys, {
			key = "P",
			mods = "LEADER|SHIFT",
			action = act.InputSelector({
				title = "Command Palette",
				choices = build_palette_choices(),
				fuzzy = true,
				action = wezterm.action_callback(function(window, pane, id, label)
					if id then
						execute_action(window, pane, id)
					end
				end),
			}),
		})
	end
end

return M

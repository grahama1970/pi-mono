-- embry/init.lua — Module loader for Embry OS WezTerm integration
local wezterm = require("wezterm")

local M = {}

M.state = require("embry.state")
M.status_bar = require("embry.status-bar")
M.tab_title = require("embry.tab-title")
M.keybindings = require("embry.keybindings")
M.signals = require("embry.signals")
M.notifications = require("embry.notifications")
M.sidebar = require("embry.sidebar")

function M.setup(config)
	M.status_bar.setup(config)
	M.tab_title.setup(config)
	M.keybindings.setup(config)
	M.signals.setup(config)
	M.notifications.setup(config)
	M.sidebar.setup(config)

	-- Set workspace env vars in spawned panes (Task 1.8: cmux parity #10)
	config.set_environment_variables = config.set_environment_variables or {}
	wezterm.on("spawn-command", function(args)
		local ws = args.workspace or "default"
		args.set_environment_variables = args.set_environment_variables or {}
		args.set_environment_variables["WEZMUX_WORKSPACE_ID"] = ws
		return args
	end)
end

return M

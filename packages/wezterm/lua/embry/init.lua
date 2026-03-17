-- embry/init.lua — Module loader for Embry OS WezTerm integration
local wezterm = require("wezterm")

local M = {}

M.state = require("embry.state")
M.status_bar = require("embry.status-bar")
M.tab_title = require("embry.tab-title")
M.keybindings = require("embry.keybindings")
M.signals = require("embry.signals")
M.notifications = require("embry.notifications")
M.metadata = require("embry.metadata")
M.sidebar = require("embry.sidebar")
M.palette = require("embry.palette")
M.session = require("embry.session")
M.browser = require("embry.browser")
M.tray = require("embry.tray")

function M.setup(config)
	M.status_bar.setup(config)
	M.tab_title.setup(config)
	M.keybindings.setup(config)
	M.signals.setup(config)
	M.notifications.setup(config)
	M.metadata.setup(config)
	M.sidebar.setup(config)
	M.palette.setup(config)
	M.session.setup(config)
	M.browser.setup(config)
	M.tray.setup(config)

	-- Set workspace env vars in spawned panes (Task 1.8: cmux parity #10)
	config.set_environment_variables = config.set_environment_variables or {}
	wezterm.on("spawn-command", function(args)
		local ws = args.workspace or "default"
		args.set_environment_variables = args.set_environment_variables or {}
		args.set_environment_variables["PI_TERM_WORKSPACE_ID"] = ws
		return args
	end)

	-- Track closed panes for reopen (#25)
	wezterm.on("pane-close-requested", function(pane)
		local cwd = ""
		local cwd_uri = pane:get_current_working_dir()
		if cwd_uri then
			cwd = cwd_uri.file_path or tostring(cwd_uri)
		end
		M.session.track_closed_tab(cwd, pane:get_title())
	end)
end

return M

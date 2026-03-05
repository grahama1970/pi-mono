-- embry/init.lua — Module loader for Embry OS WezTerm integration
local M = {}

M.state = require("embry.state")
M.status_bar = require("embry.status-bar")
M.tab_title = require("embry.tab-title")
M.keybindings = require("embry.keybindings")
M.signals = require("embry.signals")
M.sidebar = require("embry.sidebar")

function M.setup(config)
	M.status_bar.setup(config)
	M.tab_title.setup(config)
	M.keybindings.setup(config)
	M.signals.setup(config)
	M.sidebar.setup(config)
end

return M

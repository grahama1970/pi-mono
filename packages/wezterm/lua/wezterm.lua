-- wezterm.lua — Embry OS WezTerm configuration
-- Requires embry modules for agent state display.
local wezterm = require("wezterm")
local embry = require("embry")

local config = wezterm.config_builder()

-- Appearance
config.color_scheme = "Dracula (Official)"
config.font = wezterm.font("JetBrains Mono", { weight = "Medium" })
config.font_size = 13.0
config.line_height = 1.1

-- Tab bar
config.use_fancy_tab_bar = false
config.tab_bar_at_bottom = true
config.hide_tab_bar_if_only_one_tab = false
config.tab_max_width = 32
config.show_new_tab_button_in_tab_bar = false

-- Window
config.window_padding = { left = 4, right = 4, top = 4, bottom = 4 }
config.window_decorations = "RESIZE"
config.adjust_window_size_when_changing_font_size = false

-- Status bar
config.enable_scroll_bar = false

-- Pane dimming (unfocused panes)
config.inactive_pane_hsb = {
	saturation = 0.9,
	brightness = 0.85,
}

-- Sidebar (workspace navigator + agent state)
config.enable_sidebar = true
config.sidebar_position = "Left"
config.sidebar_width = "24cell"

-- Wire up Embry OS event handlers
embry.setup(config)

return config

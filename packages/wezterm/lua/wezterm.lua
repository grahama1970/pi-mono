-- wezterm.lua — Pi-Term configuration (Warp-parity minimal aesthetic)
local wezterm = require("wezterm")
local embry = require("embry")

local config = wezterm.config_builder()

-- ── Appearance ────────────────────────────────────────────────────────────────
-- Near-black background matching Warp's aesthetic (#0d0e11)
config.color_scheme = "Tokyo Night"
config.colors = {
	background = "#0d0e11", -- Tokyo Night Dark
	cursor_bg = "#52ad70",
	tab_bar = {
		background = "#0d0e11",
		active_tab = {
			bg_color = "#0d0e11",
			fg_color = "#c0caf5",
			intensity = "Normal",
			underline = "None",
			italic = false,
			strikethrough = false,
		},
		inactive_tab = {
			bg_color = "#0d0e11",
			fg_color = "#565f89",
		},
		inactive_tab_hover = {
			bg_color = "#16161e",
			fg_color = "#c0caf5",
		},
		new_tab = {
			bg_color = "#0d0e11",
			fg_color = "#565f89",
		},
		new_tab_hover = {
			bg_color = "#16161e",
			fg_color = "#c0caf5",
		},
	},
}

config.font = wezterm.font("JetBrains Mono", { weight = "Medium" })
config.font_size = 13.0
config.line_height = 1.2

-- ── Tab bar (top, minimal like Warp) ─────────────────────────────────────────
config.use_fancy_tab_bar = false
config.tab_bar_at_bottom = false          -- top like Warp
config.hide_tab_bar_if_only_one_tab = true -- hide when single tab (clean!)
config.tab_max_width = 24
config.show_new_tab_button_in_tab_bar = false -- no + button clutter

-- ── Window chrome ─────────────────────────────────────────────────────────────
-- Use KDE native title bar — removes the ugly $W green icon entirely
config.window_padding = { left = 8, right = 8, top = 8, bottom = 0 }
config.window_decorations = "TITLE | RESIZE"
config.adjust_window_size_when_changing_font_size = false

-- ── Scrollback ────────────────────────────────────────────────────────────────
config.enable_scroll_bar = false
config.scrollback_lines = 10000

-- ── Mouse ─────────────────────────────────────────────────────────────────────
config.bypass_mouse_reporting_modifiers = "SHIFT"
config.swallow_mouse_click_on_pane_focus = false
config.swallow_mouse_click_on_window_focus = false

-- ── Paste ─────────────────────────────────────────────────────────────────────
config.canonicalize_pasted_newlines = "CarriageReturn"

-- ── Pane dimming ─────────────────────────────────────────────────────────────
config.inactive_pane_hsb = {
	saturation = 0.8,
	brightness = 0.7,
}

-- ── Cursor ────────────────────────────────────────────────────────────────────
config.default_cursor_style = "BlinkingBar"
config.cursor_blink_rate = 500

-- ── Sidebar ───────────────────────────────────────────────────────────────────
config.enable_sidebar = true
config.sidebar_position = "Right"
config.sidebar_width = "24cell"

-- ── Wayland / GPU ─────────────────────────────────────────────────────────────
config.front_end = "WebGpu"
config.webgpu_power_preference = "HighPerformance"
config.enable_wayland = true

-- ── Embry OS event handlers ───────────────────────────────────────────────────
embry.setup(config)

return config

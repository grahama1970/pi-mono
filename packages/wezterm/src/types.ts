/**
 * Types for WezTerm CLI integration.
 *
 * PaneInfo mirrors wezterm's CliListResultItem JSON output.
 */

export interface PaneSize {
	rows: number;
	cols: number;
	pixel_width: number;
	pixel_height: number;
	dpi: number;
}

export interface PaneInfo {
	window_id: number;
	tab_id: number;
	pane_id: number;
	workspace: string;
	size: PaneSize;
	title: string;
	cwd: string;
	cursor_x: number;
	cursor_y: number;
	cursor_shape: string;
	cursor_visibility: string;
	left_col: number;
	top_row: number;
	tab_title: string;
	window_title: string;
	is_active: boolean;
	is_zoomed: boolean;
	tty_name: string | null;
}

export type SplitDirection = "right" | "bottom";

export interface ManagedPane {
	paneId: number;
	workspace: string;
	purpose: string;
	createdAt: number;
}

export interface SplitPaneOptions {
	direction?: SplitDirection;
	paneId?: number;
	cwd?: string;
	command?: string[];
	percent?: number;
}

export interface SpawnWorkspaceOptions {
	workspace: string;
	cwd?: string;
	command?: string[];
}

export interface WorkspaceInfo {
	name: string;
	paneCount: number;
	isActive: boolean;
	paneIds: number[];
}

/** Key name → escape sequence mapping for sendKeys */
export const KEY_SEQUENCES: Record<string, string> = {
	Enter: "\r",
	Tab: "\t",
	Escape: "\x1b",
	Backspace: "\x7f",
	"Ctrl-C": "\x03",
	"Ctrl-D": "\x04",
	"Ctrl-Z": "\x1a",
	"Ctrl-L": "\x0c",
	"Ctrl-A": "\x01",
	"Ctrl-E": "\x05",
	"Ctrl-K": "\x0b",
	"Ctrl-U": "\x15",
	"Ctrl-W": "\x17",
	"Ctrl-R": "\x12",
	Up: "\x1b[A",
	Down: "\x1b[B",
	Right: "\x1b[C",
	Left: "\x1b[D",
	Home: "\x1b[H",
	End: "\x1b[F",
	PageUp: "\x1b[5~",
	PageDown: "\x1b[6~",
	Delete: "\x1b[3~",
};

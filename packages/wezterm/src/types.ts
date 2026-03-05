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

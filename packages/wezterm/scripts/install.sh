#!/usr/bin/env bash
# install.sh — Symlink Embry OS WezTerm config into place.
# Backs up existing config if present.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LUA_DIR="$(cd "$SCRIPT_DIR/../lua" && pwd)"
BIN_DIR="$(cd "$SCRIPT_DIR/../bin" && pwd)"
WEZTERM_DIR="${HOME}/.config/wezterm"
LOCAL_BIN="${HOME}/.local/bin"

if [ ! -d "$LUA_DIR" ]; then
	echo "Error: Lua directory not found: $LUA_DIR" >&2
	exit 1
fi

if [ ! -d "$BIN_DIR" ]; then
	echo "Error: Bin directory not found: $BIN_DIR" >&2
	exit 1
fi

echo "Installing Embry OS WezTerm config..."
echo "  Source: ${LUA_DIR}"
echo "  Bridge: ${BIN_DIR}"
echo "  Target: ${WEZTERM_DIR}"

mkdir -p "$WEZTERM_DIR"
mkdir -p "$LOCAL_BIN"

# Handle wezterm.lua: broken symlink → remove, valid symlink → remove, file → backup
if [ -L "$WEZTERM_DIR/wezterm.lua" ] && [ ! -e "$WEZTERM_DIR/wezterm.lua" ]; then
	echo "  Removing broken symlink: $WEZTERM_DIR/wezterm.lua"
	rm "$WEZTERM_DIR/wezterm.lua"
elif [ -L "$WEZTERM_DIR/wezterm.lua" ]; then
	echo "  Removing existing symlink: $WEZTERM_DIR/wezterm.lua"
	rm "$WEZTERM_DIR/wezterm.lua"
elif [ -e "$WEZTERM_DIR/wezterm.lua" ]; then
	BACKUP="$WEZTERM_DIR/wezterm.lua.backup.$(date +%Y%m%d%H%M%S)"
	echo "  Backing up existing config → $BACKUP"
	mv "$WEZTERM_DIR/wezterm.lua" "$BACKUP"
fi

# Handle embry/: broken symlink → remove, valid symlink → remove, dir → backup
if [ -L "$WEZTERM_DIR/embry" ] && [ ! -e "$WEZTERM_DIR/embry" ]; then
	echo "  Removing broken symlink: $WEZTERM_DIR/embry"
	rm "$WEZTERM_DIR/embry"
elif [ -L "$WEZTERM_DIR/embry" ]; then
	echo "  Removing existing symlink: $WEZTERM_DIR/embry"
	rm "$WEZTERM_DIR/embry"
elif [ -e "$WEZTERM_DIR/embry" ]; then
	BACKUP="$WEZTERM_DIR/embry.backup.$(date +%Y%m%d%H%M%S)"
	echo "  Backing up existing embry/ → $BACKUP"
	mv "$WEZTERM_DIR/embry" "$BACKUP"
fi

# Create config symlinks
ln -s "$LUA_DIR/wezterm.lua" "$WEZTERM_DIR/wezterm.lua"
ln -s "$LUA_DIR/embry" "$WEZTERM_DIR/embry"

# Install bridge to PATH
chmod +x "$BIN_DIR/embry-wezterm-bridge"

if [ -L "$LOCAL_BIN/embry-wezterm-bridge" ]; then
	rm "$LOCAL_BIN/embry-wezterm-bridge"
fi
ln -s "$BIN_DIR/embry-wezterm-bridge" "$LOCAL_BIN/embry-wezterm-bridge"
echo "  Installed bridge: $LOCAL_BIN/embry-wezterm-bridge"

echo ""
echo "Done. Restart WezTerm to apply."
echo "Status bar will show 'agent: offline' until pi-dbus is running."
echo ""
echo "NOTE: Ensure ~/.local/bin is in your PATH for keybindings to work."
echo "Test bridge with: embry-wezterm-bridge state"

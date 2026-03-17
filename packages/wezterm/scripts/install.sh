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

echo "Installing Pi Term config..."
echo "  Source: ${LUA_DIR}"
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

# Install pi-term launcher
if [ -x "$BIN_DIR/pi-term" ]; then
	ln -sf "$BIN_DIR/pi-term" "$LOCAL_BIN/pi-term"
	echo "  Installed: $LOCAL_BIN/pi-term → $BIN_DIR/pi-term"
fi

SHELL_DIR="$(cd "$SCRIPT_DIR/../shell" && pwd)"

# Install shell integration: add source line to .zshrc if not present
SHELL_SOURCE="source ${SHELL_DIR}/embry-agentic.zsh"
if [ -f "$SHELL_DIR/embry-agentic.zsh" ]; then
	if ! grep -qF "embry-agentic.zsh" "${HOME}/.zshrc" 2>/dev/null; then
		echo "" >> "${HOME}/.zshrc"
		echo "# Embry OS agentic shell hooks" >> "${HOME}/.zshrc"
		echo "[[ -f ${SHELL_DIR}/embry-agentic.zsh ]] && ${SHELL_SOURCE}" >> "${HOME}/.zshrc"
		echo "  Added shell hooks to ~/.zshrc"
	else
		echo "  Shell hooks already in ~/.zshrc"
	fi
fi

echo ""
echo "Done. Restart WezTerm to apply Pi Term config."
echo "Status bar will show 'agent: offline' until pi-dbus is running."
echo ""
echo "New shell functions: ask, fix, grab"
echo "  ask \"how do I ...\"   — ask Pi directly from the shell"
echo "  fix                  — diagnose last failed command"
echo "  grab [N]             — capture last N lines of output"
echo ""
echo "Requires: pi CLI in PATH (install from pi-mono)"

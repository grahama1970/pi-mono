# embry-agentic.zsh — Agentic shell hooks for Pi Term
#
# Source this file in your .zshrc:
#   source ~/workspace/experiments/pi-mono/packages/wezterm/shell/embry-agentic.zsh
#
# Features:
#   1. Proactive error detection — notifies Pi when commands fail
#   2. "ask" shell function — ask Pi without leaving the terminal
#   3. Last command capture — makes terminal output available as agent context

# Guard: only load once
[[ -n "$__EMBRY_AGENTIC_LOADED" ]] && return
__EMBRY_AGENTIC_LOADED=1

# --- 1. Proactive Error Detection ---
# After each command, if it failed, write the error context to a file
# that Pi can read. Also send a WezTerm user notification via OSC 777.

__embry_last_cmd=""

# preexec: capture the command before it runs
__embry_preexec() {
    __embry_last_cmd="$1"
}

# precmd: check exit code after command completes
__embry_postcmd() {
    local exit_code=$?
    # Skip if no command was run or exit was 0 (success) or 130 (CTRL+C)
    [[ -z "$__embry_last_cmd" ]] && return
    [[ $exit_code -eq 0 || $exit_code -eq 130 ]] && { __embry_last_cmd=""; return; }

    # Write error context to a temp file for Pi to read
    local err_file="/tmp/embry-last-error-${USER}"
    printf '{"exit_code":%d,"command":"%s","cwd":"%s","timestamp":%d}\n' \
        "$exit_code" \
        "$(echo "$__embry_last_cmd" | sed 's/"/\\"/g')" \
        "$PWD" \
        "$(date +%s)" \
        > "$err_file"

    # Send WezTerm toast notification (OSC 777)
    printf '\033]777;notify;Command Failed;%s exited %d\033\\' \
        "${__embry_last_cmd:0:60}" "$exit_code"

    __embry_last_cmd=""
}

# Hook into zsh's preexec and precmd arrays
autoload -Uz add-zsh-hook
add-zsh-hook preexec __embry_preexec
add-zsh-hook precmd __embry_postcmd

# --- 2. Inline "ask" function ---
# Type: ask "how do I find large files" — sends to Pi directly
ask() {
    if [[ -z "$1" ]]; then
        echo "Usage: ask \"your question\""
        return 1
    fi
    pi -p "$*"
}

# --- 3. Fix: pipe last command output to Pi for diagnosis ---
# Usage: fix
# Captures last error context and asks Pi to diagnose
fix() {
    local err_file="/tmp/embry-last-error-${USER}"
    local context=""
    if [[ -f "$err_file" ]]; then
        context=$(cat "$err_file")
    fi

    pi -p "The last command failed. Error context: ${context}. Please diagnose the error and suggest a fix."
}

# --- 4. Last command output capture ---
# Makes terminal output available for agent context via a temp file.
# Uses wezterm cli get-text if available.
grab() {
    local lines="${1:-50}"
    if command -v wezterm >/dev/null 2>&1; then
        wezterm cli get-text --start-line "-${lines}" 2>/dev/null
    else
        echo "(wezterm cli not available — use copy mode to select text)"
    fi
}

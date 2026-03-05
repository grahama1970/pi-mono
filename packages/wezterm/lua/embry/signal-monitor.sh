#!/bin/bash
# embry/signal-monitor.sh — Background D-Bus signal monitor
# Watches org.embry.Agent signals and writes state to a temp file.
# Spawned by state.lua via wezterm.background_child_process().

set -euo pipefail

STATE_FILE="/tmp/embry-agent-state-${USER}"
PID_FILE="/tmp/embry-signal-monitor-${USER}.pid"

cleanup() {
    rm -f "$PID_FILE"
    exit 0
}
trap cleanup EXIT INT TERM

# Exit if another instance is already running
if [ -f "$PID_FILE" ]; then
    OTHER_PID=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$OTHER_PID" ] && kill -0 "$OTHER_PID" 2>/dev/null; then
        exit 0
    fi
    # Stale PID file — remove it
    rm -f "$PID_FILE"
fi

echo $$ > "$PID_FILE"

# Ensure busctl is available
if ! command -v busctl &>/dev/null; then
    exit 1
fi

# Monitor D-Bus signals from org.embry.Agent
# busctl monitor outputs structured text blocks separated by blank lines.
# We parse each block to extract signal name and body.
busctl monitor --user --match "type=signal,sender=org.embry.Agent" 2>/dev/null | \
while IFS= read -r line; do
    # Accumulate lines for each message block
    if [ -z "$line" ]; then
        # End of block — process accumulated data
        if [ -n "${signal_member:-}" ]; then
            # Build JSON from parsed fields
            case "$signal_member" in
                PropertiesChanged)
                    # Extract changed properties from the body
                    # Body contains interface name and changed property dict
                    if [ -n "${body_json:-}" ]; then
                        printf '{"signal":"PropertiesChanged","timestamp":%d,"body":%s}\n' \
                            "$(date +%s)" "$body_json" > "$STATE_FILE"
                    fi
                    ;;
                MessageUpdate|ToolExecution|AgentEnd|Error|Ready)
                    printf '{"signal":"%s","timestamp":%d,"body":%s}\n' \
                        "$signal_member" "$(date +%s)" "${body_json:-\"{}\"}" > "$STATE_FILE"
                    ;;
            esac
        fi
        # Reset for next block
        signal_member=""
        body_json=""
        in_body=false
        continue
    fi

    # Parse member (signal name)
    if [[ "$line" =~ ^[[:space:]]*Member=(.+)$ ]]; then
        signal_member="${BASH_REMATCH[1]}"
    fi

    # Parse message body — look for the string payload
    # busctl monitor shows body as: STRING "content"
    if [[ "$line" =~ ^[[:space:]]*STRING[[:space:]]+\"(.*)\"$ ]]; then
        raw="${BASH_REMATCH[1]}"
        # Unescape embedded quotes
        raw="${raw//\\\"/\"}"
        # Check if the content looks like JSON
        if [[ "$raw" == "{"* ]]; then
            body_json="$raw"
        else
            body_json="\"$raw\""
        fi
    fi

    # Note: PropertiesChanged signals wrap values in VARIANT containers
    # (DICT_ENTRY with STRING key + VARIANT value). We don't parse these
    # because building JSON from bash dict entries is fragile. Instead,
    # PropertiesChanged signals are emitted with a null body, and state.lua
    # falls back to a busctl GetState call for the full state. This is
    # acceptable because PropertiesChanged fires infrequently.
done

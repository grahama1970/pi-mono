#!/usr/bin/env bash
# Strip inherited venv to prevent uv conflicts in cross-skill subprocess calls
unset VIRTUAL_ENV
#
# /ux-lab Skill Runner
# Agent-controllable design canvas with REST API.
#
# Usage:
#   ./run.sh start
#   ./run.sh create --type rect --x 100 --y 100 --fill "#3b82f6"
#   ./run.sh export --format react
#   ./run.sh stop
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$(dirname "$(dirname "$SCRIPT_DIR")")")"
PACKAGE_DIR="${PROJECT_ROOT}/packages/ux-lab"
PID_FILE="/tmp/ux-lab.pid"
API_BASE="http://localhost:3001/api"

show_help() {
    cat <<'EOF'
/ux-lab — Agent-controllable design canvas

Commands:
  start                  Launch dev server in background
  stop                   Kill background dev server
  status                 Health check the running server
  create                 Add element to canvas
  select                 Get current canvas selection
  update <id>            Patch element properties by ID
  delete <id>            Remove element by ID
  list                   List all elements on canvas
  export                 Export canvas (react, json)
  undo                   Undo last action
  redo                   Redo last undone action
  screenshot             Capture canvas as PNG (--output <file> to save)
  review                 Trigger design review of current canvas
  test                   Trigger test-interactions on current canvas
  load-brief             Load a DESIGN_BOARD.md file
  save                   Save canvas state as JSON to stdout
  save-doc               Save full .ux.json document (--name, --output)
  load-doc               Load .ux.json document (--file <path>)
  pages                  List pages in current document
  add-page               Add page to document (--name)
  load                   Load canvas state from stdin or --file
  agent-join <json>      Register agent (POST /api/v1/agents/register)
  agent-ops <id> <json>  Submit ops for agent (POST /api/v1/agents/:id/ops)
  prompt <msg> [--agent] Send course correction to agents
  watch                  Poll ops log (Ctrl+C to stop)
  agents                 List registered agents
  ops-log [--last N]     Get operation log
  design <prompt>        Decompose prompt into zones and generate agent plan
  help                   Show this help

Create Options:
  --type <type>          Element type: rect, text, circle, button, image, group
  --x <n>               X position (default: 0)
  --y <n>               Y position (default: 0)
  --text <str>           Text content (for text/button types)
  --fill <color>         Fill color (hex or named)
  --variant <v>          Component variant (e.g. primary, secondary)

Export Options:
  --format <fmt>         Export format: react, json (default: json)

Load Options:
  --file <path>          Load canvas state from file (otherwise reads stdin)

Examples:
  ./run.sh start
  ./run.sh create --type rect --x 100 --y 100 --fill "#3b82f6"
  ./run.sh create --type text --x 200 --y 50 --text "Hello World"
  ./run.sh create --type button --x 100 --y 300 --text "Click Me" --variant primary
  ./run.sh list
  ./run.sh update abc123 --fill "#ef4444" --x 200
  ./run.sh delete abc123
  ./run.sh export --format react
  ./run.sh undo
  ./run.sh redo
  ./run.sh screenshot
  ./run.sh save > design.json
  ./run.sh load --file design.json
  ./run.sh stop
EOF
}

cmd_start() {
    if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
        echo "ux-lab already running (PID $(cat "$PID_FILE"))"
        return 0
    fi

    if [[ ! -f "${PACKAGE_DIR}/package.json" ]]; then
        echo "ERROR: package.json not found at ${PACKAGE_DIR}"
        exit 1
    fi

    echo "Starting ux-lab dev server..."
    cd "$PACKAGE_DIR"
    nohup npm run dev > /tmp/ux-lab.log 2>&1 &
    echo $! > "$PID_FILE"
    echo "PID $(cat "$PID_FILE") saved to ${PID_FILE}"

    # Wait up to 10s for health
    for i in $(seq 1 10); do
        if curl -sf "${API_BASE}/health" > /dev/null 2>&1; then
            echo "ux-lab is healthy (took ${i}s)"
            return 0
        fi
        sleep 1
    done

    echo "WARNING: health check did not pass within 10s — server may still be starting"
    echo "Check logs: /tmp/ux-lab.log"
    return 1
}

cmd_stop() {
    if [[ ! -f "$PID_FILE" ]]; then
        echo "No PID file found at ${PID_FILE}"
        return 0
    fi

    local pid
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
        # Kill the process group (npm run dev spawns children)
        kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
        echo "Stopped ux-lab (PID ${pid})"
    else
        echo "Process ${pid} not running"
    fi
    rm -f "$PID_FILE"
}

cmd_status() {
    curl -sf "${API_BASE}/health" && echo "" || {
        echo "ux-lab is not responding"
        exit 1
    }
}

cmd_create() {
    local type="" x="" y="" text="" fill="" variant=""

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --type)    type="$2";    shift 2 ;;
            --x)       x="$2";      shift 2 ;;
            --y)       y="$2";      shift 2 ;;
            --text)    text="$2";   shift 2 ;;
            --fill)    fill="$2";   shift 2 ;;
            --variant) variant="$2"; shift 2 ;;
            *) echo "Unknown create option: $1"; exit 1 ;;
        esac
    done

    if [[ -z "$type" ]]; then
        echo "ERROR: --type is required"
        exit 1
    fi

    # Build JSON payload
    local json="{"
    json+="\"type\":\"${type}\""
    [[ -n "$x" ]]       && json+=",\"x\":${x}"
    [[ -n "$y" ]]       && json+=",\"y\":${y}"
    [[ -n "$text" ]]    && json+=",\"text\":\"${text}\""
    [[ -n "$fill" ]]    && json+=",\"fill\":\"${fill}\""
    [[ -n "$variant" ]] && json+=",\"variant\":\"${variant}\""
    json+="}"

    curl -sf -X POST "${API_BASE}/v1/elements" \
        -H "Content-Type: application/json" \
        -d "$json"
    echo ""
}

cmd_select() {
    curl -sf "${API_BASE}/v1/selection"
    echo ""
}

cmd_update() {
    local id="$1"; shift

    local json="{"
    local first=true
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --x|--y)
                [[ "$first" == "false" ]] && json+=","
                json+="\"${1#--}\":${2}"
                first=false
                shift 2 ;;
            --text|--fill|--variant)
                [[ "$first" == "false" ]] && json+=","
                json+="\"${1#--}\":\"${2}\""
                first=false
                shift 2 ;;
            *)
                echo "Unknown update option: $1"; exit 1 ;;
        esac
    done
    json+="}"

    curl -sf -X PATCH "${API_BASE}/v1/elements/${id}" \
        -H "Content-Type: application/json" \
        -d "$json"
    echo ""
}

cmd_delete() {
    local id="$1"
    curl -sf -X DELETE "${API_BASE}/v1/elements/${id}"
    echo ""
}

cmd_list() {
    curl -sf "${API_BASE}/v1/elements"
    echo ""
}

cmd_export() {
    local format="json"
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --format) format="$2"; shift 2 ;;
            *) echo "Unknown export option: $1"; exit 1 ;;
        esac
    done

    curl -sf -X POST "${API_BASE}/v1/export" \
        -H "Content-Type: application/json" \
        -d "{\"format\":\"${format}\"}"
    echo ""
}

cmd_undo() {
    curl -sf -X POST "${API_BASE}/v1/undo"
    echo ""
}

cmd_redo() {
    curl -sf -X POST "${API_BASE}/v1/redo"
    echo ""
}

cmd_screenshot() {
    local output=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --output) output="$2"; shift 2 ;;
            *) shift ;;
        esac
    done

    RESULT=$(curl -sf "${API_BASE}/v1/screenshot")
    if [[ -n "$output" ]]; then
        echo "$RESULT" | jq -r '.dataUrl' | sed 's|data:image/png;base64,||' | base64 -d > "$output"
        echo "Screenshot saved to $output"
    else
        echo "$RESULT" | jq .
    fi
}

cmd_review() {
    curl -sf -X POST "${API_BASE}/v1/review" | jq .
}

cmd_test_interactions() {
    curl -sf -X POST "${API_BASE}/v1/test" | jq .
}

cmd_load_brief() {
    local path="$1"
    if [[ -z "$path" ]]; then
        echo "ERROR: path argument required"
        exit 1
    fi
    curl -sf -X POST "${API_BASE}/v1/load-brief" \
        -H "Content-Type: application/json" \
        -d "{\"path\":\"$path\"}" | jq .
}

cmd_agent_join() {
    local json="$1"
    if [[ -z "$json" ]]; then
        echo "ERROR: JSON body required (e.g. '{\"name\":\"my-agent\",\"color\":\"#ff0000\"}')"
        exit 1
    fi
    curl -sf -X POST "${API_BASE}/v1/agents/register" \
        -H "Content-Type: application/json" \
        -d "$json" | jq .
}

cmd_agent_ops() {
    local agent_id="$1"; shift
    local json="$1"
    if [[ -z "$agent_id" || -z "$json" ]]; then
        echo "ERROR: agent-ops requires <agent-id> <json-body>"
        exit 1
    fi
    curl -sf -X POST "${API_BASE}/v1/agents/${agent_id}/ops" \
        -H "Content-Type: application/json" \
        -d "$json" | jq .
}

cmd_prompt() {
    shift 2>/dev/null || true
    local MESSAGE=""
    local AGENT="all"
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --agent) AGENT="$2"; shift 2 ;;
            *) MESSAGE="$MESSAGE $1"; shift ;;
        esac
    done
    curl -s -X POST "${API_BASE}/v1/prompt" \
        -H "Content-Type: application/json" \
        -d "{\"message\":\"${MESSAGE## }\",\"target\":\"$AGENT\"}" | jq .
}

cmd_watch() {
    echo "Watching operations (Ctrl+C to stop)..."
    while true; do
        curl -s "${API_BASE}/v1/ops/log?last=1" | jq -c '.[-1] // empty'
        sleep 1
    done
}

cmd_agents() {
    curl -sf "${API_BASE}/v1/agents" | jq .
}

cmd_ops_log() {
    local last=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --last) last="$2"; shift 2 ;;
            *) echo "Unknown ops-log option: $1"; exit 1 ;;
        esac
    done
    if [[ -n "$last" ]]; then
        curl -sf "${API_BASE}/v1/ops/log?last=${last}" | jq .
    else
        curl -sf "${API_BASE}/v1/ops/log" | jq .
    fi
}

cmd_save_doc() {
    local name="" output=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --name)   name="$2";   shift 2 ;;
            --output) output="$2"; shift 2 ;;
            *) echo "Unknown save-doc option: $1"; exit 1 ;;
        esac
    done

    local json="{"
    local first=true
    if [[ -n "$name" ]]; then
        json+="\"name\":\"${name}\""
        first=false
    fi
    if [[ -n "$output" ]]; then
        [[ "$first" == "false" ]] && json+=","
        json+="\"path\":\"${output}\""
    fi
    json+="}"

    local result
    result=$(curl -sf -X POST "${API_BASE}/v1/document/save" \
        -H "Content-Type: application/json" \
        -d "$json")

    if [[ -n "$output" ]]; then
        echo "Document saved to ${output}"
    else
        echo "$result"
    fi
}

cmd_load_doc() {
    local file=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --file) file="$2"; shift 2 ;;
            *) echo "Unknown load-doc option: $1"; exit 1 ;;
        esac
    done

    if [[ -z "$file" ]]; then
        echo "ERROR: --file is required"
        exit 1
    fi

    local content
    content="$(cat "$file")"
    curl -sf -X POST "${API_BASE}/v1/document/load" \
        -H "Content-Type: application/json" \
        -d "{\"content\":$(echo "$content" | jq -Rs .)}" | jq .
}

cmd_pages() {
    curl -sf "${API_BASE}/v1/pages" | jq .
}

cmd_add_page() {
    local name=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --name) name="$2"; shift 2 ;;
            *) echo "Unknown add-page option: $1"; exit 1 ;;
        esac
    done

    if [[ -z "$name" ]]; then
        echo "ERROR: --name is required"
        exit 1
    fi

    curl -sf -X POST "${API_BASE}/v1/pages" \
        -H "Content-Type: application/json" \
        -d "{\"name\":\"${name}\"}" | jq .
}

cmd_design() {
    local prompt="$1"
    if [[ -z "$prompt" ]]; then
        echo "ERROR: prompt argument required"
        echo "Usage: ./run.sh design \"dashboard with navbar and sidebar\""
        exit 1
    fi
    curl -sf -X POST "${API_BASE}/v1/design" \
        -H "Content-Type: application/json" \
        -d "{\"prompt\":$(echo "$prompt" | jq -Rs .)}" | jq .
}

cmd_save() {
    curl -sf "${API_BASE}/v1/save"
    echo ""
}

cmd_load() {
    local file=""
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --file) file="$2"; shift 2 ;;
            *) echo "Unknown load option: $1"; exit 1 ;;
        esac
    done

    if [[ -n "$file" ]]; then
        curl -sf -X POST "${API_BASE}/v1/load" \
            -H "Content-Type: application/json" \
            -d @"$file"
    else
        curl -sf -X POST "${API_BASE}/v1/load" \
            -H "Content-Type: application/json" \
            -d @-
    fi
    echo ""
}

case "${1:-help}" in
    start)       shift; cmd_start "$@" ;;
    stop)        shift; cmd_stop "$@" ;;
    status)      shift; cmd_status "$@" ;;
    create)      shift; cmd_create "$@" ;;
    select)      shift; cmd_select "$@" ;;
    update)      shift; cmd_update "$@" ;;
    delete)      shift; cmd_delete "$@" ;;
    list)        shift; cmd_list "$@" ;;
    export)      shift; cmd_export "$@" ;;
    undo)        shift; cmd_undo "$@" ;;
    redo)        shift; cmd_redo "$@" ;;
    screenshot)  shift; cmd_screenshot "$@" ;;
    review)      shift; cmd_review "$@" ;;
    test)        shift; cmd_test_interactions "$@" ;;
    load-brief)  shift; cmd_load_brief "$@" ;;
    save)        shift; cmd_save "$@" ;;
    save-doc)    shift; cmd_save_doc "$@" ;;
    load-doc)    shift; cmd_load_doc "$@" ;;
    pages)       shift; cmd_pages "$@" ;;
    add-page)    shift; cmd_add_page "$@" ;;
    load)        shift; cmd_load "$@" ;;
    agent-join)  shift; cmd_agent_join "$@" ;;
    agent-ops)   shift; cmd_agent_ops "$@" ;;
    prompt)      cmd_prompt "$@" ;;
    watch)       shift; cmd_watch "$@" ;;
    agents)      shift; cmd_agents "$@" ;;
    ops-log)     shift; cmd_ops_log "$@" ;;
    design)      shift; cmd_design "$@" ;;
    help|--help|-h) show_help ;;
    *)
        echo "Unknown command: $1"
        echo "Run './run.sh help' for usage."
        exit 1
        ;;
esac
